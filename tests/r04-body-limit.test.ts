/**
 * CP6.2C — R04 JSON body safety ceiling tests (node:test via tsx).
 *
 * - unit tests exercise jsonBodyErrorHandler / JSON_BODY_LIMIT directly;
 * - HTTP tests use a MINI Express app (real express.json + the real
 *   jsonBodyErrorHandler) on 127.0.0.1:0 — never imports server.ts, so no
 *   startup side effects (cleanup, agent yaml sync, provider, listener);
 * - every listener is closed via try/finally (plus a global after() sweep);
 * - only loopback connections; no external network/provider/metadata calls;
 * - oversized payloads are kept just above the 10 MiB limit.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { ErrorRequestHandler } from "express";
import type { Server } from "http";
import {
  JSON_BODY_LIMIT,
  jsonBodyErrorHandler,
  jsonBodyErrorMessage,
} from "../server/lib/bodyLimit.ts";

const LIMIT = 10 * 1024 * 1024;

// ── shared helpers ────────────────────────────────────────────────────────

const liveServers: Server[] = [];

after(async () => {
  await Promise.all(
    liveServers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
        }),
    ),
  );
});

function createMiniApp() {
  const app = express();
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(jsonBodyErrorHandler);
  app.post("/echo", (req, res) => {
    res.status(200).json({ ok: true, body: req.body });
  });
  return app;
}

function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
      } else {
        reject(new Error("mini app did not bind a port"));
      }
    });
    server.on("error", reject);
  });
}

async function withServer<T>(
  app: express.Express,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const { server, baseUrl } = await listen(app);
  liveServers.push(server);
  try {
    return await fn(baseUrl);
  } finally {
    const idx = liveServers.indexOf(server);
    if (idx >= 0) liveServers.splice(idx, 1);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function post(baseUrl: string, body: string) {
  return fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function oversizedValidJson(): string {
  // `{"data":"...x"}` — valid JSON, total length = LIMIT + 1 (just above limit).
  const fill = "x".repeat(LIMIT - 10);
  return `{"data":"${fill}"}`;
}

// ── A. unit / handler ─────────────────────────────────────────────────────

function mockRes() {
  return {
    statusCode: null as number | null,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

test("U1 JSON_BODY_LIMIT is exactly 10 * 1024 * 1024", () => {
  assert.equal(JSON_BODY_LIMIT, LIMIT);
  assert.equal(JSON_BODY_LIMIT, 10_485_760);
});

test("U2 entity.too.large -> 413 with the fixed public message", () => {
  const res = mockRes();
  let forwarded: unknown = "NOT-CALLED";
  jsonBodyErrorHandler(
    { type: "entity.too.large" } as never,
    {} as never,
    res as never,
    (err: unknown) => {
      forwarded = err;
    },
  );
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.body, { error: jsonBodyErrorMessage() });
  assert.equal(forwarded, "NOT-CALLED", "next must not be called for known errors");
});

test("U3 entity.parse.failed -> 400 with the fixed public message", () => {
  const res = mockRes();
  let forwarded: unknown = "NOT-CALLED";
  jsonBodyErrorHandler(
    { type: "entity.parse.failed" } as never,
    {} as never,
    res as never,
    (err: unknown) => {
      forwarded = err;
    },
  );
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Invalid JSON request body." });
  assert.equal(forwarded, "NOT-CALLED", "next must not be called for known errors");
});

test("U4 other error -> next(err) with the same object, untouched", () => {
  const custom = new Error("boom");
  const res = mockRes();
  let forwarded: unknown;
  jsonBodyErrorHandler(
    custom as never,
    {} as never,
    res as never,
    (err: unknown) => {
      forwarded = err;
    },
  );
  assert.equal(forwarded, custom, "same error object passed to next");
  assert.equal(res.statusCode, null, "no response written for unknown errors");
});

// ── B. HTTP mini app ──────────────────────────────────────────────────────

test("M1 normal JSON below limit -> 200 with parsed body", async () => {
  await withServer(createMiniApp(), async (baseUrl) => {
    const res = await post(baseUrl, JSON.stringify({ hello: "world" }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, body: { hello: "world" } });
  });
});

test("M2 oversized VALID JSON (>10MiB) -> 413 JSON", async () => {
  await withServer(createMiniApp(), async (baseUrl) => {
    const body = oversizedValidJson();
    assert.ok(Buffer.byteLength(body) > LIMIT, "payload must exceed the limit");
    const res = await post(baseUrl, body);
    assert.equal(res.status, 413);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: jsonBodyErrorMessage() });
    assert.ok(
      !text.includes("x".repeat(1000)),
      "413 response must not echo the raw request body",
    );
  });
});

test("M3 oversized MALFORMED JSON (>10MiB) -> 413 JSON", async () => {
  await withServer(createMiniApp(), async (baseUrl) => {
    const body = "a".repeat(LIMIT + 1);
    const res = await post(baseUrl, body);
    assert.equal(res.status, 413);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: jsonBodyErrorMessage() });
  });
});

test("M4 malformed JSON below limit -> 400 JSON", async () => {
  await withServer(createMiniApp(), async (baseUrl) => {
    const res = await post(baseUrl, '{"data": }');
    assert.equal(res.status, 400);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await res.json(), { error: "Invalid JSON request body." });
  });
});

test("M5 normal request AFTER a 413 succeeds", async () => {
  await withServer(createMiniApp(), async (baseUrl) => {
    const oversized = await post(baseUrl, oversizedValidJson());
    assert.equal(oversized.status, 413);

    const normal = await post(baseUrl, JSON.stringify({ hello: "again" }));
    assert.equal(normal.status, 200);
    assert.deepEqual(await normal.json(), { ok: true, body: { hello: "again" } });
  });
});

test("M6 413/400 responses leak no raw body, stack, or err.message", async () => {
  await withServer(createMiniApp(), async (baseUrl) => {
    const big = await post(baseUrl, oversizedValidJson());
    assert.equal(big.status, 413);
    const bigText = await big.text();
    assert.equal(
      bigText,
      JSON.stringify({ error: jsonBodyErrorMessage() }),
      "413 body must be exactly the fixed public message",
    );
    assert.ok(
      !bigText.includes("x".repeat(1000)),
      "413 response must not echo the raw request body",
    );

    const mal = await post(baseUrl, '{"data": }');
    assert.equal(mal.status, 400);
    const malText = await mal.text();
    assert.equal(
      malText,
      JSON.stringify({ error: "Invalid JSON request body." }),
      "400 body must be exactly the fixed public message",
    );
  });
});

test("M7 error responses carry Content-Type application/json", async () => {
  await withServer(createMiniApp(), async (baseUrl) => {
    const big = await post(baseUrl, oversizedValidJson());
    assert.equal(big.status, 413);
    assert.match(big.headers.get("content-type") ?? "", /^application\/json/);

    const mal = await post(baseUrl, '{"data": }');
    assert.equal(mal.status, 400);
    assert.match(mal.headers.get("content-type") ?? "", /^application\/json/);
  });
});

test("M8 HTTP passthrough: non-body-parser error reaches downstream recorder unchanged", async () => {
  const app = express();
  const custom = new Error("custom-boom");
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use((_req, _res, next) => {
    next(custom);
  });
  app.use(jsonBodyErrorHandler);
  const recorder: ErrorRequestHandler = (err, _req, res, _next) => {
    res.status(599).json({ captured: err === custom });
  };
  app.use(recorder);

  await withServer(app, async (baseUrl) => {
    const res = await post(baseUrl, "{}");
    assert.equal(res.status, 599);
    assert.deepEqual(await res.json(), { captured: true });
  });
});

test("M9 no listener is left open", async () => {
  await withServer(createMiniApp(), async (baseUrl) => {
    await post(baseUrl, JSON.stringify({ ping: 1 }));
  });
  assert.equal(liveServers.length, 0, "withServer must close its listener");
});
