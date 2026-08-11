/**
 * CP5.2 — Chart image URL guard (single source of truth).
 *
 * Used IDENTICALLY by the dashboard render (`ChartImage`) and the PDF/export
 * fetch path, so a URL that renders is always one the export will also fetch.
 *
 * Policy: only same-origin resources whose canonical, normalized pathname
 * genuinely sits under `/output/` are allowed.
 *
 * Rejects:
 *   - empty / non-string values;
 *   - protocol-relative URLs (`//host/...`);
 *   - absolute URLs and ANY RFC3986 scheme (http:, https:, data:, blob:,
 *     file:, javascript:, vbscript:, …) — same-origin `http://`/`https://`
 *     forms are caught by the origin comparison below;
 *   - userinfo (`@`);
 *   - query strings and fragments (not needed for charts);
 *   - literal or percent-encoded backslashes (`\`, `%5c`);
 *   - path traversal segments `.` / `..` (literal or percent-encoded, e.g.
 *     `%2e%2e`) anywhere in the decoded pathname;
 *   - canonicalized pathnames that escape `/output/` (`/output/../x` becomes
 *     `/x` after WHATWG normalization and fails the prefix check).
 *
 * Invalid URLs never reach a `fetch()` or an `<img>` load.
 */

const BASE_ORIGIN = "http://app.local";

export function isSafeChartUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.trim() === "") return false;
  const candidate = url.trim();

  // Protocol-relative URL.
  if (candidate.startsWith("//")) return false;

  // Must be a root-absolute path (the server always emits "/output/...").
  // This also rejects relative URLs such as "../output/x.png" or "output/x.png",
  // which a browser would resolve against the current page path (ambiguous).
  if (!candidate.startsWith("/")) return false;

  // Any scheme prefix (http:, data:, blob:, javascript:, …).
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return false;

  // Literal backslash traversal attempts.
  if (candidate.includes("\\")) return false;

  // Userinfo is not valid for a chart path.
  if (candidate.includes("@")) return false;

  // No query strings or fragments are ever needed for charts.
  if (candidate.includes("?") || candidate.includes("#")) return false;

  // Parse against a fixed base and require the canonical origin to match it.
  // WHATWG parsing also collapses literal `..` segments here.
  let parsed: URL;
  try {
    parsed = new URL(candidate, BASE_ORIGIN);
  } catch {
    return false;
  }
  if (parsed.origin !== BASE_ORIGIN) return false;

  // Fully decode the canonical pathname. Throws on malformed percent-encoding
  // (e.g. "%zz") — reject those too.
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }

  // Reject percent-encoded backslashes that survive decoding.
  if (pathname.includes("\\")) return false;

  // Must live strictly under the app's /output/ tree.
  if (!pathname.startsWith("/output/")) return false;

  // No `.` / `..` path segments (literal, or decoded from %2e / %2e%2e /
  // %2E%2E / unicode dot-lookalikes that decode to "." / "..").
  const segments = pathname.split("/");
  if (segments.some((seg) => seg === "." || seg === "..")) return false;

  return true;
}
