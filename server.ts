import dotenv from "dotenv";
// Load local environment overrides (.env.local takes precedence over .env).
// In hosted environments (e.g. AI Studio) the API key is injected directly,
// so a missing file here is fine.
dotenv.config({ path: [".env.local", ".env"] });

import express from "express";
import path from "path";
import {
  createInteraction,
  streamInteraction,
  API_BASE_URL,
} from "./server/lib/agentClient.ts";
import { extractJsonBlocks } from "./server/lib/jsonExtractor.ts";
import {
  resolveCatalogId,
  catalogContainsAgentName,
  listCatalog,
} from "./server/lib/modelCatalog.ts";
import {
  validateApiKey,
  type KeyValidationFailureReason,
} from "./server/lib/keyValidation.ts";
import {
  classifyUpstreamError,
  upstreamErrorMessage,
} from "./server/lib/upstreamErrors.ts";
import {
  safeErrorClass,
  safeLog,
} from "./server/lib/safeDiagnostics.ts";
import { resolveGcsToken } from "./server/lib/gcpToken.ts";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";

function extractTarInMemory(tarBuffer: Buffer): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  let offset = 0;

  while (offset + 512 <= tarBuffer.length) {
    let isEnd = true;
    for (let i = 0; i < 512; i++) {
      if (tarBuffer[offset + i] !== 0) {
        isEnd = false;
        break;
      }
    }
    if (isEnd) break;

    let name = "";
    for (let i = 0; i < 100; i++) {
      const charCode = tarBuffer[offset + i];
      if (charCode === 0) break;
      name += String.fromCharCode(charCode);
    }
    name = name.trim();

    let sizeStr = "";
    for (let i = 124; i < 136; i++) {
      const charCode = tarBuffer[offset + i];
      if (charCode === 0 || charCode === 32) continue;
      sizeStr += String.fromCharCode(charCode);
    }
    const size = parseInt(sizeStr, 8);

    const typeflag = tarBuffer[offset + 156];
    const isRegularFile = typeflag === 0 || typeflag === 48;

    offset += 512; // skip header

    if (name && isRegularFile && !isNaN(size) && size > 0) {
      if (offset + size <= tarBuffer.length) {
        files[name] = tarBuffer.subarray(offset, offset + size);
      }
    }

    const paddedSize = Math.ceil(size / 512) * 512;
    offset += paddedSize;
  }

  return files;
}

function extractEnvironmentId(interaction: any): string | undefined {
  if (!interaction || typeof interaction !== "object") return undefined;
  const environment = interaction.environment;
  const candidates = [
    environment?.env_id,
    environment?.environment_id,
    environment?.id,
    environment?.name,
    interaction.environment_id,
    interaction.env_id,
  ];
  const value = candidates.find(
    (candidate) => typeof candidate === "string" && candidate.trim(),
  );
  if (typeof value !== "string") return undefined;
  return value.replace(/^environments?\//, "").replace(/^environment-/, "");
}

function extractInteractionId(interaction: any): string | undefined {
  if (!interaction || typeof interaction !== "object") return undefined;
  const value =
    interaction.name || interaction.id || interaction.interaction_id;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

type AgentSource =
  | { type: "inline"; content: string; target: string }
  | { type: "gcs"; source: string; target: string }
  | { type: "repository"; source: string; target: string };

function loadAgentFiles(dir: string, basePath: string): AgentSource[] {
  let files: AgentSource[] = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const targetPath = path.posix.join(basePath, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(loadAgentFiles(fullPath, targetPath));
    } else {
      files.push({
        type: "inline",
        content: fs.readFileSync(fullPath, "utf-8"),
        target: targetPath,
      });
    }
  }
  return files;
}

const activeGenerations = new Map<string, AbortController>();

function cleanUpOldGenerations() {
  const outputDir = path.join(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) return;

  const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours threshold
  const now = Date.now();

  try {
    const items = fs.readdirSync(outputDir);
    for (const item of items) {
      if (item.startsWith(".")) continue; // ignore hidden items
      const itemPath = path.join(outputDir, item);
      const stats = fs.statSync(itemPath);

      if (stats.isDirectory()) {
        const age = now - stats.mtimeMs;
        if (age > maxAgeMs) {
          console.log(
            `[cleanup] A generation directory is older than 24 hours (${Math.round(age / 1000 / 60 / 60)} hrs). Deleting to prevent storage bloat.`,
          );
          try {
            fs.rmSync(itemPath, { recursive: true, force: true });
            const zipPath = `${itemPath}.zip`;
            if (fs.existsSync(zipPath)) {
              fs.unlinkSync(zipPath);
            }
          } catch (itemErr) {
            safeLog("error", "cleanup", "DELETE_FAILED", {
              error_class: safeErrorClass(itemErr),
            });
          }
        }
      }
    }
  } catch (err) {
    safeLog("error", "cleanup", "CLEANUP_SCAN_FAILED", {
      error_class: safeErrorClass(err),
    });
  }
}

function resolvePort(): number {
  const raw = process.env.PORT;
  if (typeof raw === "string" && raw.trim() !== "") {
    const trimmed = raw.trim();
    const parsed = parseInt(trimmed, 10);
    if (
      !isNaN(parsed) &&
      parsed >= 1 &&
      parsed <= 65535 &&
      String(parsed) === trimmed
    ) {
      return parsed;
    }
    console.warn(
      `[config] Invalid PORT "${raw}" — falling back to 3000.`,
    );
  }
  return 3000;
}

// Public base URL used by sandbox scripts that need to reach THIS server
// (e.g. the generated GCS download script). It is deliberately NOT derived
// from client-controlled Host / x-forwarded-proto headers — those are a code
// injection vector into generated Python source. It is validated at startup:
// - production requires an absolute https:// URL (fail-closed).
// - development falls back to an explicit, safe http://localhost:<port>.
function resolvePublicBaseUrl(port: number): string {
  const raw = (process.env.PUBLIC_BASE_URL || "").trim();
  const isProduction = process.env.NODE_ENV === "production";
  if (raw === "") {
    if (isProduction) {
      console.error(
        "[config] REFUSING TO START in NODE_ENV=production: PUBLIC_BASE_URL is required and must be an absolute https:// URL " +
          "reachable from the Gemini sandbox (e.g. https://your-app.onrender.com). " +
          "The service will exit now.",
      );
      process.exit(1);
    }
    const fallback = `http://localhost:${port}`;
    console.warn(
      `[config] PUBLIC_BASE_URL unset — using local fallback ${fallback} (development only).`,
    );
    return fallback;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    if (isProduction) {
      console.error(
        `[config] REFUSING TO START: PUBLIC_BASE_URL "${raw}" is not a valid absolute URL. The service will exit now.`,
      );
      process.exit(1);
    }
    const fallback = `http://localhost:${port}`;
    console.warn(
      `[config] Invalid PUBLIC_BASE_URL "${raw}" — using local fallback ${fallback} (development only).`,
    );
    return fallback;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    if (isProduction) {
      console.error(
        `[config] REFUSING TO START: PUBLIC_BASE_URL "${raw}" must use https:// in production. The service will exit now.`,
      );
      process.exit(1);
    }
    console.warn(
      `[config] PUBLIC_BASE_URL "${raw}" uses a non-http(s) scheme — using it is not supported; falling back to local.`,
    );
    return `http://localhost:${port}`;
  }
  if (isProduction && parsed.protocol !== "https:") {
    console.error(
      `[config] REFUSING TO START: PUBLIC_BASE_URL "${raw}" must use https:// in production. The service will exit now.`,
    );
    process.exit(1);
  }
  if (!parsed.hostname) {
    if (isProduction) {
      console.error(
        `[config] REFUSING TO START: PUBLIC_BASE_URL "${raw}" has no host. The service will exit now.`,
      );
      process.exit(1);
    }
    return `http://localhost:${port}`;
  }
  // Normalize: strip trailing slash and any path/query/fragment.
  return `${parsed.protocol}//${parsed.host}`;
}

// Guard against silent drift between agent/agent.yaml (base_agent) and the
// server-side model catalog. Warn loudly if they disagree.
function verifyAgentYamlSync(): void {
  try {
    const yamlPath = path.join(process.cwd(), "agent", "agent.yaml");
    if (!fs.existsSync(yamlPath)) {
      console.warn(
        "[catalog] agent/agent.yaml not found — cannot verify agent sync.",
      );
      return;
    }
    const yamlText = fs.readFileSync(yamlPath, "utf-8");
    const match = yamlText.match(/^\s*base_agent:\s*["']?([A-Za-z0-9_.-]+)["']?/m);
    const yamlAgent = match ? match[1] : null;
    if (!yamlAgent) {
      console.warn("[catalog] Could not parse base_agent from agent/agent.yaml.");
      return;
    }
    if (!catalogContainsAgentName(yamlAgent)) {
      console.error(
        `[catalog] MISMATCH: agent/agent.yaml base_agent "${yamlAgent}" is NOT in the server catalog ` +
          `[${listCatalog().map((e) => e.agentName).join(", ")}]. The runtime payload would silently use a ` +
          "different agent than the bundled one. Refusing to continue in production.",
      );
      if (process.env.NODE_ENV === "production") {
        process.exit(1);
      }
    } else {
      console.log(
        `[catalog] agent/agent.yaml base_agent "${yamlAgent}" matches the server catalog.`,
      );
    }
  } catch (err) {
    safeLog("warn", "catalog", "YAML_SYNC_CHECK_FAILED", {
      error_class: safeErrorClass(err),
    });
  }
}

async function startServer() {
  const app = express();
  const PORT = resolvePort();

  // Trust exactly ONE reverse-proxy hop (Render's platform proxy sits directly
  // in front of this service). With `trust proxy: 1`, Express derives req.ip
  // from the right-most untrusted entry of X-Forwarded-For — i.e. the real
  // client as seen by that single proxy — so a client-sent X-Forwarded-For
  // cannot spoof the IP used for per-IP rate limiting. This assumes Render
  // always proxies requests (never a direct connection to the origin port).
  app.set("trust proxy", 1);

  // Run initial cleanup on startup
  cleanUpOldGenerations();

  // Validate PUBLIC_BASE_URL (used by sandbox scripts to reach THIS server)
  // and verify agent/agent.yaml stays in sync with the model catalog.
  const publicBaseUrl = resolvePublicBaseUrl(PORT);
  verifyAgentYamlSync();

  app.use(express.json({ limit: "50mb" }));
  app.use("/output", express.static(path.join(process.cwd(), "output")));

  // ── BYOK (Bring Your Own Key) ───────────────────────────────────────
  // Each analysis request carries the user's Gemini API key in the
  // `x-gemini-api-key` header. The server reads it into a LOCAL variable for
  // that request only — it is never stored on module scope, in process.env,
  // in a database, on disk, in a cookie, in a server-side session, in the
  // URL, in analytics, or in logs. There is NO server-side fallback key.
  // /api/health and /api/upload do NOT need a key (they never call Gemini).
  const analyzeHits = new Map<string, number[]>();
  // Per-key limiter buckets. Keyed by SHA-256 FINGERPRINT of the user's key
  // (never the key itself). Fingerprints live only in memory, are never
  // logged or returned to the client, and reset on restart. This is an abuse
  // GUARD, not a spending cap — real cost control needs persistent state.
  const analyzeKeyHits = new Map<string, number[]>();

  function rateLimitKey(key: string, windowMs: number, max: number): boolean {
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (analyzeHits.get(key) || []).filter((t) => t > cutoff);
    if (timestamps.length >= max) {
      analyzeHits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    analyzeHits.set(key, timestamps);
    return true;
  }

  function rateLimitKeyedByFingerprint(
    fingerprint: string,
    windowMs: number,
    max: number,
  ): boolean {
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (analyzeKeyHits.get(fingerprint) || []).filter(
      (t) => t > cutoff,
    );
    if (timestamps.length >= max) {
      analyzeKeyHits.set(fingerprint, timestamps);
      return false;
    }
    timestamps.push(now);
    analyzeKeyHits.set(fingerprint, timestamps);
    return true;
  }

  function keyFingerprint(apiKey: string): string {
    return crypto.createHash("sha256").update(apiKey, "utf8").digest("hex");
  }

  function clientIp(req: express.Request): string {
    // `trust proxy: 1` (set above) makes req.ip reliable under a single
    // reverse-proxy hop (Render). The fallback covers direct/local access.
    return req.ip || req.socket?.remoteAddress || "unknown";
  }

  // Read + validate the BYOK key from the request header using the single
  // centralized validator (server/lib/keyValidation.ts). Returns the validated
  // key string (used only in local request scope) or the failure reason.
  // Invalid keys are rejected here — BEFORE fingerprinting, catalog
  // processing, or any network call. The key itself is never logged, stored,
  // or returned; only a 400 with a safe message is.
  function extractValidApiKey(
    req: express.Request,
  ): { apiKey: string; reason: null } | { apiKey: null; reason: KeyValidationFailureReason } {
    const validation = validateApiKey(req.headers["x-gemini-api-key"]);
    if (validation.reason !== null) {
      // `reason` is null iff valid; narrows the union without needing
      // strictNullChecks (repo tsconfig has `strict` disabled).
      return { apiKey: null, reason: validation.reason };
    }
    return { apiKey: req.headers["x-gemini-api-key"] as string, reason: null };
  }

  const API_KEY_ERROR_MESSAGES: Record<KeyValidationFailureReason, string> = {
    MISSING:
      "Missing x-gemini-api-key header. This endpoint is BYOK: provide your own Gemini API key.",
    MULTIPLE_VALUES:
      "Invalid x-gemini-api-key header: multiple values are not allowed.",
    NOT_STRING: "Invalid x-gemini-api-key header value.",
    BLANK: "Invalid x-gemini-api-key header: the key is blank.",
    INVALID_CHARS:
      "Invalid x-gemini-api-key header: the key contains unsupported characters.",
    TOO_LONG:
      "Invalid x-gemini-api-key header: the key is too long (maximum 1024 bytes).",
  };

  // Apply conservative rate limits to the analysis endpoint. The GLOBAL
  // private-preview limiter was removed in CP5.1 (no service-wide cap).
  // Order per request: 1) BYOK key present + format-valid  2) per-IP limiter
  //   3) per-key fingerprint limiter  4) /api/analyze handler.
  // - 6 attempts per minute per IP for /api/analyze
  // - 20 analyses per 10 minutes per key (abuse guard, in-memory)
  // - 6 uploads per minute per IP for /api/upload (no Gemini, no key needed)
  app.post("/api/analyze", (req, res, next) => {
    const extracted = extractValidApiKey(req);
    if (!extracted.apiKey) {
      return res.status(400).json({
        error: API_KEY_ERROR_MESSAGES[extracted.reason],
      });
    }
    if (!rateLimitKey(`analyze:${clientIp(req)}`, 60_000, 6)) {
      return res.status(429).json({
        error:
          "Too many analysis requests. Please wait a moment and try again.",
      });
    }
    const fingerprint = keyFingerprint(extracted.apiKey);
    if (!rateLimitKeyedByFingerprint(fingerprint, 10 * 60_000, 20)) {
      return res.status(429).json({
        error:
          "Too many analysis requests for this Gemini API key. Please wait a few minutes (abuse guard, not a spending cap).",
      });
    }
    next();
  });

  // API routes FIRST
  app.post("/api/cancel-show", (req, res) => {
    const { generationId } = req.body;
    if (generationId && activeGenerations.has(generationId)) {
      console.log(`[cancel-show] Human requested abort (generation registered).`);
      activeGenerations.get(generationId)?.abort();
      activeGenerations.delete(generationId);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Not found or already completed" });
    }
  });

  app.get("/api/download-proxy", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      res.status(400).send("Missing url parameter");
      return;
    }
    try {
      const parsedUrl = new URL(targetUrl);
      if (!parsedUrl.hostname.endsWith("storage.googleapis.com") && !parsedUrl.hostname.endsWith("googleusercontent.com")) {
        res.status(403).send("Forbidden: Domain not allowed");
        return;
      }
      const response = await fetch(targetUrl);
      if (!response.ok) {
        res
          .status(response.status)
          .send(`Failed to fetch: ${response.statusText}`);
        return;
      }
      res.setHeader(
        "Content-Type",
        response.headers.get("Content-Type") || "application/octet-stream",
      );
      res.setHeader("Access-Control-Allow-Origin", "*");

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.send(buffer);
    } catch (err) {
      safeLog("error", "download-proxy", "PROXY_FETCH_FAILED", {
        error_class: safeErrorClass(err),
      });
      res.status(500).send("Failed to download the requested file.");
    }
  });

  const QUOTA_CACHE_FILE = path.join(
    process.cwd(),
    "output",
    "quota_cache.json",
  );
  const DEFAULT_QUOTA_LIMIT = 999999;

  function getQuotaLimit(): number {
    const limitStr = process.env.DAILY_QUOTA_LIMIT;
    if (limitStr) {
      const parsed = parseInt(limitStr, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
    return DEFAULT_QUOTA_LIMIT;
  }

  function getTodayStr(): string {
    return new Date().toISOString().split("T")[0];
  }

  let isFirebaseAdminInitialized = false;

  function ensureFirebaseAdmin() {
    // Firebase is disabled
  }

  async function getUserHash(req: express.Request): Promise<string | null> {
    // Fallback during local development or unauthenticated preview testing
    return "dev-user-hash";
  }

  function getQuotaCount(userHash: string | null): number {
    if (!userHash) return 0;
    try {
      const outputDir = path.dirname(QUOTA_CACHE_FILE);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      if (fs.existsSync(QUOTA_CACHE_FILE)) {
        const data = fs.readFileSync(QUOTA_CACHE_FILE, "utf-8");
        const cache = JSON.parse(data);
        const cacheKey = `${getTodayStr()}_${userHash}`;
        return cache[cacheKey] || 0;
      }
    } catch (err) {
      safeLog("error", "quota", "CACHE_READ_FAILED", {
        error_class: safeErrorClass(err),
      });
    }
    return 0;
  }

  function incrementQuotaCount(userHash: string | null): void {
    if (!userHash) return;
    try {
      const outputDir = path.dirname(QUOTA_CACHE_FILE);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      let cache: Record<string, number> = {};
      if (fs.existsSync(QUOTA_CACHE_FILE)) {
        try {
          const data = fs.readFileSync(QUOTA_CACHE_FILE, "utf-8");
          cache = JSON.parse(data);
        } catch (e) {
          safeLog("error", "quota", "CACHE_PARSE_FAILED", {
            error_class: safeErrorClass(e),
          });
        }
      }
      const cacheKey = `${getTodayStr()}_${userHash}`;
      cache[cacheKey] = (cache[cacheKey] || 0) + 1;
      fs.writeFileSync(
        QUOTA_CACHE_FILE,
        JSON.stringify(cache, null, 2),
        "utf-8",
      );
    } catch (err) {
      safeLog("error", "quota", "CACHE_WRITE_FAILED", {
        error_class: safeErrorClass(err),
      });
    }
  }

  app.get("/api/quota", async (req, res) => {
    if (process.env.NODE_ENV !== "production") {
      return res.json({ used: 0, limit: 999999 });
    }
    const userHash = await getUserHash(req);
    const limit = getQuotaLimit();
    if (!userHash) {
      return res.json({ used: 0, limit });
    }
    const count = getQuotaCount(userHash);
    return res.json({ used: count, limit });
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 1 * 1024 * 1024 }, // 1MB limit
  });

  const uploadSingle = upload.single("file");

  app.post(
    "/api/upload",
    (req, res, next) => {
      if (!rateLimitKey(`upload:${clientIp(req)}`, 60_000, 6)) {
        return res.status(429).json({
          error:
            "Too many uploads. Please wait a moment and try again.",
        });
      }
      next();
    },
    (req, res, next) => {
      uploadSingle(req, res, (err) => {
        if (err) {
          if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
              return res
                .status(413)
                .json({
                  error:
                    "File is too large. The maximum allowed size is 1MB.",
                });
            }
            return res
              .status(400)
              .json({ error: "Upload rejected by the server." });
          }
          safeLog("error", "api/upload", "UPLOAD_MIDDLEWARE_FAILED", {
            error_class: safeErrorClass(err),
          });
          return res
            .status(500)
            .json({ error: "An unknown error occurred during upload." });
        }
        next();
      });
    },
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        // Inline limit: 1 MB per file (multer also enforces the same cap)
        const MAX_INLINE_SIZE = 1 * 1024 * 1024; // 1 MB
        if (req.file.size > MAX_INLINE_SIZE) {
          return res.status(413).json({
            error: `File "${req.file.originalname}" is ${(req.file.size / (1024 * 1024)).toFixed(2)} MB, which exceeds the 1MB upload limit.`,
          });
        }

        const content = req.file.buffer.toString("utf-8");
        const safeOriginalName = req.file.originalname.replace(
          /[^a-zA-Z0-9._-]/g,
          "_",
        );
        let gsUri: string | undefined = undefined;
        let url: string | undefined = undefined;

        try {
          const sessionId =
            typeof req.body?.sessionId === "string"
              ? req.body.sessionId.trim()
              : "default";
          const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
          const filename = `uploads/${sessionId}/${uniqueSuffix}-${safeOriginalName}`;

          // Firebase upload omitted
        } catch (gcsErr) {
          safeLog("warn", "api/upload", "GCS_UPLOAD_OMITTED", {
            error_class: safeErrorClass(gcsErr),
          });
        }

        console.log(
          `[api/upload] Processed inline CSV upload (${req.file.size} bytes).`,
        );
        return res.json({
          name: req.file.originalname,
          content,
          size: req.file.size,
          gsUri,
          url,
        });
      } catch (err: any) {
        safeLog("error", "api/upload", "CSV_UPLOAD_FAILED", {
          error_class: safeErrorClass(err),
        });
        res.status(500).json({ error: "Upload failed. Please try again." });
      }
    },
  );

  async function deleteGcsFiles(files: any[]) {
    // Disabled
  }

  app.get("/api/download-file", async (req, res) => {
    return res.status(500).send("GCS bucket is not configured on Firebase Admin");
  });

  app.post("/api/clear-files", async (req, res) => {
    return res.json({ success: true });
  });

  app.post("/api/analyze", async (req, res) => {
    // Run background cleanup whenever a new analysis is requested to optimize disk space
    cleanUpOldGenerations();

    // BYOK: validate + read the user's key ONCE, into a local variable scoped
    // to this request. It is passed by argument to every Google fetch this
    // request makes and is never stored anywhere. Same centralized validator
    // as the middleware (defense in depth).
    const extracted = extractValidApiKey(req);
    if (!extracted.apiKey) {
      return res.status(400).json({
        error: API_KEY_ERROR_MESSAGES[extracted.reason],
      });
    }
    const apiKey = extracted.apiKey;

    const {
      question,
      files,
      datasetName = "Dataset",
      generationId,
      environmentId,
      catalogId,
      googleToken,
    } = req.body;

    // Resolve the client-supplied catalogId against the server allowlist
    // BEFORE any Gemini network call. Unknown IDs get a 400.
    const catalogEntry = resolveCatalogId(catalogId);
    if (!catalogEntry) {
      return res.status(400).json({
        error:
          "Unknown catalogId. The browser must send one of the server-approved catalog ids (see server/lib/modelCatalog.ts).",
      });
    }

    if (!question || typeof question !== "string" || question.trim() === "") {
      return res
        .status(400)
        .json({ error: "Missing required field: question" });
    }

    // Reusing the environment is sufficient. Do not chain to the prior
    // interaction because the report can be retrieved before that interaction
    // has formally completed in the hosted runtime.
    const isFollowUp = !!environmentId;
    const uploadedFiles: Array<{ name: string; content?: string; gsUri?: string }> =
      Array.isArray(files)
        ? files.filter(
            (f: any) =>
              f &&
              typeof f.name === "string" &&
              ((typeof f.content === "string" && f.content.trim() !== "") ||
                (typeof f.gsUri === "string" && f.gsUri.trim() !== "")),
          )
        : [];
    if (!isFollowUp && uploadedFiles.length === 0) {
      return res.status(400).json({ error: "Provide at least one CSV file." });
    }

    console.log(`[analyze] Skipping daily quota tracking as requested.`);

    const effectiveDatasetName = datasetName;

    const gcsFiles = uploadedFiles.filter((f) => f.gsUri);
    const hasGcsFiles = gcsFiles.length > 0;
    const gcsToken = await resolveGcsToken(hasGcsFiles);
    let gcsInstructions = "";
    if (hasGcsFiles) {
      gcsInstructions = `The user uploaded ${gcsFiles.length} file(s) to Google Cloud Storage. First, you MUST run \`python /.agents/download_gcs.py\` to download them to /.agents/data/ before doing anything else.`;
    }

    let prompt = "";

    if (isFollowUp) {
      prompt = `You are an expert data analyst continuing an analysis of the dataset "${effectiveDatasetName}".


FOLLOW-UP BUSINESS QUESTION:
${question}


EXECUTE IMMEDIATELY:
- Your first response MUST be one code_execution call. Do not explain, plan, quote these instructions, or print code as text.
- In that one call, discover source files with glob.glob('./workspace/data/*.csv'), clear prior files under data/analysis/ and charts/, analyze the question with Pandas, save result CSVs, and optionally create up to three charts with the existing make_chart.py script.
- Do not delete source CSVs, profile.json, or the existing report.json before the replacement report is ready.
- Do not import seaborn, scipy, statsmodels, or other unlisted packages. Use Pandas, NumPy, and the provided chart script.
- If the data cannot answer the question or analysis fails, write data/analysis/limitations.csv with columns limitation, detail, and required_data.
- ALWAYS finish the same code_execution call by running:
 python3 /.agents/skills/reporting/scripts/build_report.py --workspace ./workspace --question "${question.replace(/"/g, '\\"')}" --dataset-name "${effectiveDatasetName.replace(/"/g, '\\"')}"
- After the tool output contains "Report saved", return one short sentence and make no more tool calls.`;
    } else {
      const fileNames = uploadedFiles.map((f) => f.name).join(", ");
      const dataSourceInstructions = `The user provided ${uploadedFiles.length} CSV file(s). ${gcsInstructions} The files will be located at /.agents/data/. Copy them all into ./workspace/data/ before profiling: \`cp /.agents/data/*.csv ./workspace/data/\`. Provided file(s): ${fileNames}.`;

      prompt = `You are an expert data analyst. Dataset name: "${effectiveDatasetName}".


DATA SOURCE:
${dataSourceInstructions}


BUSINESS QUESTION:
${question}


WORKFLOW REQUIREMENT:
You MUST follow this workflow in order. Keep the run short: use one Python script for profiling and one Python script for the requested analysis instead of creating many exploratory scripts. You MUST NOT finish your response until all steps are completed and 'build_report.py' prints that report.json was saved.
HARD LIMIT: You have at most 10 code-execution calls for the entire run. Use one setup call, one combined profiling call, one combined analysis call, up to three chart calls, and one report call. Do not run ad hoc inspection, describe, correlation, validation, package-check, or report-preview commands. Put required calculations into the two scripts. Once build_report.py prints "Report saved", immediately conclude without another tool call.


1. STAGE & SET UP: Create directories, copy the data, and install the core requirements immediately. Do not assume matplotlib is installed:
  mkdir -p ./workspace/data ./workspace/charts ./workspace/data/analysis && \
  cp /.agents/data/*.csv ./workspace/data/ && \
  pip install -r /.agents/requirements.txt --break-system-packages --prefer-binary --no-cache-dir
  Install scikit-learn separately only if the question genuinely requires an ML model.


2. EXPLORE: Write and run one concise Pandas profiling script that understands the columns and types and writes './workspace/data/profile.json'. The data-explorer skill is agent-driven; there is no profile_data.py supplied by the skill.


3. ANALYZE & SAVE: Write and execute a Python pandas script to perform the data aggregations and calculations needed to answer the question.
  CRITICAL: You MUST save any result tables as CSV files under './workspace/data/analysis/' (e.g., './workspace/data/analysis/streak_data.csv'). Do NOT save files in other folders.


4. VISUALIZE: Create high-quality PNG charts for your findings. Run the visualization script on your saved analysis CSVs:
  python3 /.agents/skills/visualization/scripts/make_chart.py --workspace ./workspace --data data/analysis/<your_csv>.csv --type <bar|line|scatter|pie|heatmap> --x <col> --y <col> --title "<Chart Title>" --output charts/<chart_name>.png


5. BUILD REPORT: Compile everything into the final interactive report JSON by running:
  python3 /.agents/skills/reporting/scripts/build_report.py --workspace ./workspace --question "${question.replace(/"/g, '\\"')}" --dataset-name "${effectiveDatasetName.replace(/"/g, '\\"')}"


CRITICAL RULE FOR RE-ENTRANCY & COMPLETION:
The frontend UI depends 100% on './workspace/data/report.json' to render the charts and tables on the screen. If you output your final textual response or stop calling tools before running step 5 (build_report.py), the user will see a completely blank dashboard!
Therefore, please make sure to run both 'make_chart.py' and 'build_report.py' successfully in the sandbox before concluding your turn.


*SANDBOX TOOL TIP:* Since you run in a Python code_execution sandbox, you should run all shell commands (like directory creation, make_chart.py, or build_report.py scripts) by prefixing them with a "!" in your code cells or by using Python's 'os.system()' or 'subprocess' modules. Do not output plain bash commands or hallucinate external tool calls.


Example of the required execution order:
\`\`\`python
import os
# Stage data and install core dependencies first
os.system("mkdir -p ./workspace/data ./workspace/charts ./workspace/data/analysis && cp /.agents/data/*.csv ./workspace/data/ && pip install -r /.agents/requirements.txt --break-system-packages --prefer-binary --no-cache-dir")


# Explore and profile using Pandas here, then write ./workspace/data/profile.json directly.
# Do not call a nonexistent profiling helper script.


# Analyze & Save CSV
import pandas as pd
df = pd.read_csv('./workspace/data/...')
# ... perform calculations ...
df.to_csv('./workspace/data/analysis/results.csv', index=False)


# Visualize PNG chart
os.system("python3 /.agents/skills/visualization/scripts/make_chart.py --workspace ./workspace --data data/analysis/results.csv --type bar --x col1 --y col2 --title 'Title' --output charts/my_chart.png")


# Compile report immediately after charts (deterministic and network-free)
os.system("""python3 /.agents/skills/reporting/scripts/build_report.py --workspace ./workspace --question "${question.replace(/"/g, '\\"')}" --dataset-name "${effectiveDatasetName.replace(/"/g, '\\"')}" """)
\`\`\``;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const sendEvent = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    let reportDelivered = false;
    let streamFailed = false;
    const sendError = (message: string) => {
      streamFailed = true;
      sendEvent({ type: "error", message });
    };
    let sentSessionEnvironmentId: string | undefined;
    const sendSessionEnvironment = (environmentIdValue: string | undefined) => {
      if (
        !environmentIdValue ||
        environmentIdValue === sentSessionEnvironmentId
      )
        return;
      sentSessionEnvironmentId = environmentIdValue;
      sendEvent({ type: "session", environmentId: environmentIdValue });
    };
    sendSessionEnvironment(
      typeof environmentId === "string" ? environmentId : undefined,
    );

    // Send a heartbeat every 15 seconds to keep the connection alive
    // (useful for proxies like VS Code port forwarding that drop idle connections)
    const heartbeatInterval = setInterval(() => {
      res.write(`:\n\n`); // SSE comment/ping
    }, 15000);

    let isFinished = false;
    const abortController = new AbortController();

    if (generationId) {
      activeGenerations.set(generationId, abortController);
    }

    req.on("aborted", () => {
      if (!isFinished) {
        console.log(
          `[analyze] Client aborted request. Agent will continue running in background unless explicitly cancelled.`,
        );
      }
      clearInterval(heartbeatInterval);
    });
    req.on("close", () => {
      clearInterval(heartbeatInterval);
    });

    try {
      let agentFiles: AgentSource[] = [];
      if (isFollowUp) {
        console.log(
          "[analyze] Continuing session in the active environment without interaction chaining.",
        );
        sendEvent({
          type: "info",
          message: "Continuing session in active environment...",
        });
      } else {
        console.log(
          `[analyze] Request accepted. catalogId="${catalogEntry.id}", files=${uploadedFiles.length}.`,
        );
        sendEvent({
          type: "info",
          message: "Provisioning analysis environment...",
        });

        console.log(
          "[analyze] Loading agent files from the bundled agent tree.",
        );
        agentFiles = loadAgentFiles(
          path.join(process.cwd(), "agent"),
          "/.agents",
        );

        // Add user dataset files (inline CSVs or GCS URIs)
        uploadedFiles.forEach((f) => {
          const safeName = path.posix
            .basename(f.name)
            .replace(/[^a-zA-Z0-9._-]/g, "_");
          if (f.content) {
            agentFiles.push({
              type: "inline",
              content: f.content,
              target: `/.agents/data/${safeName}`,
            });
          } else if (f.gsUri) {
            agentFiles.push({
              type: "gcs",
              source: f.gsUri,
              target: "/.agents/data",
            });
          }
        });

        // Uploads are fetched from GCS inside the sandbox via /.agents/download_gcs.py.
        // SECURITY (CP5): the script URL is PUBLIC_BASE_URL — an env-validated
        // value — NEVER the client-controlled Host / x-forwarded-proto headers.
        // All dynamic values are embedded with JSON.stringify (safe serialization)
        // via string concatenation, NOT quote interpolation into a template.
        if (hasGcsFiles) {
          const gcsFilesToDownload = gcsFiles.map((f) => {
            const safeName = path.posix
              .basename(f.name)
              .replace(/[^a-zA-Z0-9._-]/g, "_");
            let gcsPath = "";
            const uri = f.gsUri || "";
            if (uri.startsWith("gs://")) {
              const parts = uri.slice(5).split("/", 1);
              gcsPath = uri.slice(5 + parts[0].length + 1);
            }
            return {
              source: f.gsUri,
              filename: gcsPath,
              target: `/.agents/data/${safeName}`,
            };
          });

          const filesLiteral = JSON.stringify(gcsFilesToDownload);
          const serverUrlLiteral = JSON.stringify(publicBaseUrl);
          const tokenLiteral = gcsToken ? JSON.stringify(gcsToken) : "None";

          const gcsDownloadScript = [
            "import urllib.request",
            "import urllib.parse",
            "import os",
            "",
            "files = " + filesLiteral,
            "",
            "server_url = " + serverUrlLiteral,
            "token = " + tokenLiteral,
            'os.makedirs("/.agents/data", exist_ok=True)',
            "",
            "for f in files:",
            '   filename = f["filename"]',
            '   # 1. First attempt: Download via the secure local Express download proxy',
            '   proxy_url = f"{server_url}/api/download-file?filename={urllib.parse.quote(filename)}"',
            '   print(f"Attempting download for {filename} via proxy: {proxy_url}")',
            "   try:",
            '       req = urllib.request.Request(proxy_url)',
            '       with urllib.request.urlopen(req) as response, open(f["target"], "wb") as out:',
            "           out.write(response.read())",
            '       print(f"Successfully downloaded {filename} via Express proxy")',
            "       continue",
            "   except Exception as proxy_err:",
            '       print(f"Express proxy download failed: {proxy_err}. Falling back to direct GCS download...")',
            "",
            "   # 2. Second attempt / fallback: Direct GCS API download",
            '   uri = f["source"]',
            '   if uri.startswith("gs://"):',
            '       parts = uri[5:].split("/", 1)',
            "       bucket = parts[0]",
            "       obj = parts[1]",
            "       encoded_obj = urllib.parse.quote(obj)",
            '       url_json = f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/{encoded_obj}?alt=media"',
            '       url_xml = f"https://storage.googleapis.com/{bucket}/{encoded_obj}"',
            "",
            "       success = False",
            "       for url in [url_json, url_xml]:",
            "           req = urllib.request.Request(url)",
            "           if token:",
            '               req.add_header("Authorization", "Bearer " + token)',
            "           try:",
            '               with urllib.request.urlopen(req) as response, open(f["target"], "wb") as out:',
            "                   out.write(response.read())",
            '               print(f"Successfully downloaded {f[\'source\']} from {url}")',
            "               success = True",
            "               break",
            "           except Exception as e:",
            '               print(f"Failed download from {url}: {e}")',
            "       if not success:",
            '           print(f"Failed all download attempts for {f[\'source\']}")',
            "",
          ].join("\n");
          agentFiles.push({
            type: "inline",
            content: gcsDownloadScript,
            target: `/.agents/download_gcs.py`,
          });
        }
        console.log(
          `[analyze] Finished loading agent files (source: ${uploadedFiles.length} uploaded file(s)). Count: ${agentFiles.length}`,
        );
      }

      console.log(
        `[analyze] GCS access token present: ${gcsToken ? "yes" : "no"}.`,
      );

      console.log(
        `[analyze] Calling createInteraction with agent="${catalogEntry.agentName}" (catalogId="${catalogEntry.id}").`,
      );
      const response = await createInteraction({
        prompt,
        agentName: catalogEntry.agentName,
        apiKey,
        stream: true,
        inlineSources: isFollowUp
          ? undefined
          : agentFiles.length > 0
            ? agentFiles
            : undefined,
        environmentId: isFollowUp ? environmentId : undefined,
        gcsToken: gcsToken || undefined,
        signal: abortController.signal,
      });

      console.log(
        `[analyze] Gemini API responded. HTTP Status: ${response.status}`,
      );

      if (!response.ok) {
        // CP5.2 + CP5.3: never forward or READ the raw upstream body.
        // Upstream error bodies can echo secret material (e.g. a prefix of the
        // API key), so the body is cancelled/discarded WITHOUT reading it —
        // never buffered, logged, or forwarded. No response.text()/json() here.
        const status = response.status;
        try {
          await response.body?.cancel();
        } catch {
          // ignore cancel/discard errors
        }
        const kind = classifyUpstreamError(status);
        console.error(
          `[analyze] Upstream error (${status}) — mapped to "${kind}". Raw upstream body not logged or forwarded.`,
        );
        sendError(upstreamErrorMessage(kind));
        res.end();
        return;
      }

      console.log(
        `[analyze] Response remains ok. Constructing SSE stream reader...`,
      );
      let accumulatedText = "";
      let envId: string | undefined = environmentId;
      let interactionId: string | undefined;
      let reportArtifactReady = false;

      let eventCount = 0;
      for await (const event of streamInteraction(response)) {
        eventCount++;
        console.log(
          `[analyze] SSE yields streaming event #${eventCount}: type="${event.type}"`,
        );
        if (event.type === "done") {
          console.log(
            `[analyze] Received explicit "done" marker from interaction stream.`,
          );
          break;
        }
        if (event.type === "interaction") {
          envId = extractEnvironmentId(event.interaction) || envId;
          interactionId =
            extractInteractionId(event.interaction) || interactionId;
          sendSessionEnvironment(envId);
          console.log(
            "[analyze] Interaction created. Environment recovered from event.",
          );
        }
        if (event.type === "complete") {
          envId = extractEnvironmentId(event.interaction) || envId;
          interactionId =
            extractInteractionId(event.interaction) || interactionId;
          sendSessionEnvironment(envId);
          console.log(
            "[analyze] Interaction completed. Environment recovered from event.",
          );
          const usage = event.interaction?.usage as any;
          if (usage) {
            console.log(
              `[agent] Token usage: ${usage.total_tokens} total tokens (${usage.total_input_tokens} input, ${usage.total_output_tokens} output, ${usage.total_thought_tokens || 0} thought, ${usage.total_cached_tokens || 0} cached)`,
            );
          }

          // Fallback extraction: iterate and combine text from all elements of the steps array
          const stepsObj = event.interaction?.steps as any[];
          if (Array.isArray(stepsObj)) {
            let combinedStepsText = "";
            for (const step of stepsObj) {
              const isReasoningStep =
                step.type === "thinking" ||
                step.type === "thought" ||
                step.type === "reasoning";
              if (!isReasoningStep && Array.isArray(step.content)) {
                for (const part of step.content) {
                  if (part && typeof part === "object") {
                    if (part.type === "text" && part.text) {
                      combinedStepsText += part.text;
                    } else if (part.text && part.type !== "thought") {
                      combinedStepsText += part.text;
                    }
                  } else if (typeof part === "string") {
                    combinedStepsText += part;
                  }
                }
              }
            }
            if (
              combinedStepsText &&
              combinedStepsText.length > accumulatedText.length
            ) {
              console.log(
                `[analyze] Dynamic steps recovery: Reconstructed text of length ${combinedStepsText.length} exceeds accumulated text of length ${accumulatedText.length}. Restoring fallback text.`,
              );
              accumulatedText = combinedStepsText;
            }
          }
        }

        // Log events to the terminal as well (metadata only — never agent
        // output text, tool arguments, or tool results).
        if (event.type === "thinking")
          console.log("[agent] thinking delta received.");
        else if (event.type === "tool_call") {
          console.log(`[agent] tool_call received (tool=${event.name}).`);
        } else if (event.type === "tool_result") {
          console.log(`[agent] tool_result received (tool=${event.name}).`);
          if (
            event.result?.includes("Report saved to") &&
            event.result.includes("report.json")
          ) {
            reportArtifactReady = true;
            console.log(
              "[analyze] Agent confirmed report.json was saved in the sandbox.",
            );
          }
        } else if (event.type === "text") {
          console.log("[agent] text output segment received.");
        }

        sendEvent(event);

        if (event.type === "text" && event.text) {
          accumulatedText += event.text;
        }
        if (reportArtifactReady && envId) {
          console.log(
            "[analyze] report.json is ready; stopping stream consumption and retrieving the sandbox snapshot.",
          );
          break;
        }
      }

      // If the hosted SSE connection closed before interaction.completed,
      // recover the environment ID from the interaction resource itself.
      if (!envId && interactionId) {
        try {
          const interactionPath = interactionId.startsWith("interactions/")
            ? interactionId
            : `interactions/${interactionId}`;
          const interactionRes = await fetch(
            `${API_BASE_URL}/${interactionPath}`,
            {
              headers: {
                "x-goog-api-key": apiKey,
                "Api-Revision": "2026-05-20",
                "x-goog-api-client": "applet-ai-data-analyst/1.0.0",
              },
            },
          );
          if (interactionRes.ok) {
            const interactionData = await interactionRes.json();
            envId = extractEnvironmentId(interactionData);
            sendSessionEnvironment(envId);
            console.log(
              "[analyze] Recovered environment ID from interaction resource.",
            );
          } else {
            console.warn(
              `[analyze] Could not recover interaction metadata (HTTP ${interactionRes.status}).`,
            );
          }
        } catch (metadataErr) {
          safeLog("warn", "analyze", "INTERACTION_METADATA_RECOVERY_FAILED", {
            error_class: safeErrorClass(metadataErr),
          });
        }
      }

      // Fallback: if the agent emitted the report JSON inline in its text output, parse it.
      if (accumulatedText) {
        try {
          const blocks = extractJsonBlocks(accumulatedText);
          const reportBlock = blocks
            .reverse()
            .find(
              (b: any) =>
                b &&
                typeof b === "object" &&
                (b.executive_summary || b.insights || b.title),
            );
          if (reportBlock) {
            reportDelivered = true;
            sendEvent({ type: "report_data", data: reportBlock });
          }
        } catch (e) {
          safeLog("error", "analyze", "JSON_BLOCK_PARSE_FAILED", {
            error_class: safeErrorClass(e),
          });
        }
      }

      if (envId) {
        sendEvent({
          type: "info",
          message: reportArtifactReady
            ? "Report created. Retrieving dashboard files..."
            : "Retrieving report and charts from the analysis environment...",
        });
        try {
          const downloadUrl = `${API_BASE_URL}/files/environment-${envId}:download?alt=media`;
          let res: Response | null = null;
          for (let attempt = 1; attempt <= 5; attempt++) {
            res = await fetch(downloadUrl, {
              headers: { "x-goog-api-key": apiKey },
            });
            if (
              res.ok ||
              ![404, 409, 425].includes(res.status) ||
              attempt === 5
            )
              break;
            console.log(
              `[analyze] Environment snapshot not ready (attempt ${attempt}/5). Retrying...`,
            );
            await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
          }

          if (res?.ok) {
            const arrayBuffer = await res.arrayBuffer();
            const tarBuffer = Buffer.from(arrayBuffer);
            const extractedFiles = extractTarInMemory(tarBuffer);

            let report: any = null;
            // Map of chart basename -> chart image URL
            const chartImages: Record<string, string> = {};

            // Prepare run directory for chart image output
            let runId = "gen-" + Math.random().toString(36).substring(2, 10);
            if (typeof generationId === "string" && /^[A-Za-z0-9_-]+$/.test(generationId)) {
              runId = generationId;
            }
            const outputDirRoot = path.join(process.cwd(), "output");
            let chartRunDir = path.join(outputDirRoot, runId, "charts");
            if (fs.existsSync(chartRunDir)) {
              runId = `${runId}-${Date.now()}`;
              chartRunDir = path.join(outputDirRoot, runId, "charts");
            }
            fs.mkdirSync(chartRunDir, { recursive: true });

            for (const [filePath, fileContent] of Object.entries(
              extractedFiles,
            )) {
              const normalized = filePath.replace(/^\.\//, "");
              if (
                normalized.endsWith("data/report.json") ||
                normalized.endsWith("/report.json") ||
                normalized === "report.json"
              ) {
                try {
                  report = JSON.parse(fileContent.toString("utf8"));
                } catch (err) {
                  safeLog("error", "analyze", "REPORT_JSON_PARSE_FAILED", {
                    error_class: safeErrorClass(err),
                  });
                }
              } else if (
                normalized.includes("charts/") &&
                /\.(png|jpg|jpeg)$/i.test(normalized)
              ) {
                let base = normalized.split("/").pop() as string;
                if (!/^[A-Za-z0-9_.-]+\.(png|jpe?g)$/i.test(base)) {
                  const ext = base.split(".").pop() || "png";
                  base = `chart-${Object.keys(chartImages).length + 1}.${ext}`;
                }
                const targetFilePath = path.join(chartRunDir, base);
                try {
                  fs.writeFileSync(targetFilePath, fileContent);
                  chartImages[base] = `/output/${runId}/charts/${base}`;
                } catch (writeErr) {
                  safeLog("error", "analyze", "CHART_WRITE_FAILED", {
                    error_class: safeErrorClass(writeErr),
                  });
                }
              }
            }

            const reportMatchesCurrentQuestion =
              typeof report?.question === "string" &&
              report.question.trim().toLowerCase() ===
                question.trim().toLowerCase();
            if (
              isFollowUp &&
              !reportArtifactReady &&
              !reportMatchesCurrentQuestion
            ) {
              console.warn(
                "[analyze] Follow-up stream ended without producing a replacement report. Preserving the existing dashboard.",
              );
              sendError(
                "The follow-up analysis stopped before it could update the dashboard. Your previous report has been preserved; please try the question again.",
              );
              return;
            }

            if (!report) {
              console.log(
                "[analyze] report.json was not found in the tar archive. Generating server-side fallback report...",
              );
              const displayTables: any[] = [];

              for (const [filePath, fileContent] of Object.entries(
                extractedFiles,
              )) {
                const normalized = filePath.replace(/^\.\//, "");
                if (
                  normalized.endsWith(".csv") &&
                  !normalized.includes("data/report.json")
                ) {
                  try {
                    const csvText = fileContent.toString("utf8");
                    const lines = csvText
                      .split("\n")
                      .map((l) => l.trim())
                      .filter(Boolean);
                    if (lines.length > 0) {
                      const headers = lines[0]
                        .split(",")
                        .map((h) => h.replace(/^["']|["']$/g, ""));
                      const rows = lines.slice(1, 21).map((line) => {
                        return line
                          .split(",")
                          .map((val) => val.replace(/^["']|["']$/g, ""));
                      });
                      const filename =
                        normalized.split("/").pop() || "table.csv";
                      const title = filename
                        .replace(/\.csv$/i, "")
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase());
                      displayTables.push({
                        title,
                        columns: headers,
                        rows,
                        caption: `Generated data table: ${filename}`,
                      });
                    }
                  } catch (csvErr) {
                    safeLog("error", "analyze", "CSV_FALLBACK_PARSE_FAILED", {
                      error_class: safeErrorClass(csvErr),
                    });
                  }
                }
              }

              if (
                displayTables.length > 0 ||
                Object.keys(chartImages).length > 0 ||
                accumulatedText
              ) {
                let summary =
                  "The data analyst has finished processing your calculations.";
                if (accumulatedText) {
                  summary = accumulatedText
                    .replace(/```json[\s\S]*?```/g, "")
                    .trim();
                  if (summary.length > 500) {
                    summary = summary.substring(0, 500) + "...";
                  }
                }

                report = {
                  dataset_name: effectiveDatasetName || "Dataset",
                  question: question,
                  title: `Analysis Report: ${effectiveDatasetName || "Dataset"}`,
                  executive_summary: summary,
                  insights: [
                    {
                      title: "Calculations Completed",
                      detail:
                        "The analysis successfully completed the necessary Python computations. Explore the generated data tables and supporting documents below.",
                      metric: "Status",
                      value: "Success",
                    },
                  ],
                  charts: [],
                  tables: displayTables,
                  methodology:
                    "Computed using Pandas inside the sandboxed data analyst workspace.",
                  recommendations: [
                    "Review the structured output tables and charts below for specific metrics.",
                  ],
                  generated_at: new Date().toISOString().split("T")[0],
                };
              }
            }

            if (report) {
              // Embed chart image data into the referenced chart entries by matching basename.
              if (Array.isArray(report.charts)) {
                for (const chart of report.charts) {
                  if (
                    chart &&
                    typeof chart === "object" &&
                    typeof chart.file === "string"
                  ) {
                    const base = chart.file.split("/").pop() as string;
                    if (chartImages[base]) {
                      chart.image = chartImages[base];
                    }
                  }
                }
              }

              // Append any rendered charts the report didn't explicitly reference.
              const referenced = new Set(
                (Array.isArray(report.charts) ? report.charts : [])
                  .map((c: any) =>
                    typeof c?.file === "string"
                      ? c.file.split("/").pop()
                      : null,
                  )
                  .filter(Boolean),
              );
              const extras = Object.keys(chartImages)
                .filter((base) => !referenced.has(base))
                .map((base) => ({
                  title: base.replace(/\.[^.]+$/, "").replace(/_/g, " "),
                  file: `charts/${base}`,
                  caption: "",
                  type: "bar",
                  image: chartImages[base],
                }));
              if (extras.length > 0) {
                report.charts = [
                  ...(Array.isArray(report.charts) ? report.charts : []),
                  ...extras,
                ];
              }

              reportDelivered = true;
              sendEvent({ type: "report_data", data: report });
            } else {
              console.error(
                "report.json was not found in the extracted tar archive",
              );
              sendError("The analysis ran but report.json was not produced.");
            }
          } else {
            // CP5.2 + CP5.3: never forward or read the raw snapshot error body
            // (may echo secrets). Cancel/discard it without reading, then map
            // the status to a safe, human message.
            const errStatus = res ? res.status : 0;
            try {
              await res?.body?.cancel();
            } catch {
              // ignore cancel/discard errors
            }
            const kind = classifyUpstreamError(errStatus);
            console.error(
              `[analyze] Snapshot download failed (status ${errStatus}) — mapped to "${kind}". Raw upstream body not logged or forwarded.`,
            );
            if (
              kind === "not_found" ||
              errStatus === 409 ||
              errStatus === 425
            ) {
              sendError(
                "The previous analysis session has expired or the remote environment has been recycled due to inactivity. Please start a fresh analysis session by uploading your CSV files again.",
              );
            } else {
              sendError(upstreamErrorMessage(kind));
            }
          }
        } catch (err: any) {
          safeLog("error", "analyze", "SNAPSHOT_PROCESSING_FAILED", {
            error_class: safeErrorClass(err),
          });
          sendError(
            "There was a problem retrieving the analysis output. Please try again.",
          );
        }
      }

      isFinished = true;
      if (!reportDelivered && !streamFailed) {
        sendError(
          "The analysis stream ended before a dashboard report was produced.",
        );
      }
      if (reportDelivered && !streamFailed) {
        sendEvent({ type: "status", status: "completed" });
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log(`[analyze] Agent interaction aborted successfully.`);
      } else {
        safeLog("error", "analyze", "UNEXPECTED_ANALYZE_ERROR", {
          error_class: safeErrorClass(err),
        });
        // CP5.2 + CP5.3: never forward raw error text (may contain internal
        // URLs or payload fragments) — send a safe generic message instead.
        sendError(
          "Something went wrong while processing your analysis. Please try again.",
        );
      }
    } finally {
      isFinished = true;
      clearInterval(heartbeatInterval);
      if (generationId) {
        activeGenerations.delete(generationId);
      }
      res.end();

      // Files are kept for follow-up chats. They are only deleted when clicking "New Analysis" (POST /api/clear-files).
      /*
     if (!isFollowUp && uploadedFiles.length > 0) {
       deleteGcsFiles(uploadedFiles).catch(err => {
         safeLog("error", "analyze", "BACKGROUND_GCS_DELETE_FAILED", {
           error_class: safeErrorClass(err),
         });
       });
     }
     */
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Offline BYOK key-format check. Uses the SAME centralized validator as
  // /api/analyze (server/lib/keyValidation.ts) so behavior cannot drift.
  // It only validates that the value looks like a plausible API key; it does
  // NOT call Gemini, does NOT require the AIza prefix (the current
  // source/docs do not guarantee every supported key uses it), does NOT store
  // the key, does NOT log it, and does NOT return it. This is a UX hint only —
  // a "valid format" key can still fail auth at the API.
  app.post("/api/key-check", (req, res) => {
    const validation = validateApiKey(req.body?.key);
    const formatValid = validation.valid;
    res.json({
      format_valid: formatValid,
      format_invalid: !formatValid,
    });
  });

  // Vite middleware for development (with a robust fallback to dev middleware if dist/index.html is missing)
  const distPath = path.join(process.cwd(), "dist");
  const indexHtmlExists = fs.existsSync(path.join(distPath, "index.html"));

  if (process.env.NODE_ENV !== "production" || !indexHtmlExists) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "Production mode enabled, but dist/index.html not found. Falling back to Vite dev server middleware to ensure app stays operational.",
      );
    }
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    // Express 5 format for catch-all (if using express 5) or Express 4. Let's use *all for v5 or * for v4.
    // We can use default express 4 catch-all
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const startListening = (port: number) => {
    const server = app
      .listen(port, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${port}`);
      })
      .on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          console.log(`Port ${port} is in use, trying ${port + 1}...`);
          startListening(port + 1);
        } else {
          console.error(`[server] Listen failed (port ${port}).`);
        }
      });

    // Disable timeouts for long-running agent interactions
    server.setTimeout(0);
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.keepAliveTimeout = 0;
  };

  startListening(PORT);
}

startServer();
