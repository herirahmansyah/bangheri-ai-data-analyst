<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/4da09e69-7bdc-4127-8269-2d036df7eb4a

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and set `PORT`/`NODE_ENV` as needed.
   No Gemini key is configured server-side — this app is **BYOK**.
3. Run the app:
   `npm run dev`

## Bring Your Own Key (BYOK)

This app has **no server-side Gemini API key**. Each user supplies their own
Gemini API key in the UI header (`Gemini Key` field):

- The key is held **only in browser memory** for the life of the page. It is
  **not** written to `localStorage`, `sessionStorage`, cookies, or the URL.
- On `Run`, the key is sent to this app's `/api/analyze` in the
  `x-gemini-api-key` header, then forwarded **only to Google** (the Gemini
  Interactions API) so the analysis can run. `/api/upload` and `/api/health`
  never receive the key.
- **Boundary (stated correctly):** because the key travels in a request header
  over HTTPS, the user who controls their own browser **can** see it in the
  browser's Network DevTools — that is inherent to BYOK and expected. The key
  is deliberately kept out of every other surface: it is never placed in a
  URL, a request body, a response body, browser console output, analytics,
  server logs, SSE events, generated files, reports, or any persistent
  storage.
- Because analysis runs in Google's remote sandbox, some data you upload (CSV
  contents) is processed there. The API key itself is **not** embedded in the
  sandbox source, prompts, or the sandbox network allowlist.
- Use the **Clear** button next to the field to remove the key from memory.
- Your Gemini key carries **your quota and billing responsibility**. Usage
  against your key is limited per-request (a lightweight abuse guard, not a
  spending cap). Monitor usage in Google AI Studio.
- The server never logs, stores, or returns the key. A malformed/empty key is
  rejected by `/api/analyze` with a `400` before any network call.

## CP5.3 — Logging policy & controlled live-test boundary

### Server logging policy (no raw exceptions, no user content)

The server logs **metadata only** — never raw exceptions and never user data.

- **Never logged:** `Error` objects, `err.message`, `err.stack`, `err.cause`,
  raw upstream request/response bodies or headers, request payloads, the Gemini
  BYOK key, the GCS/Google token, or internal request URLs.
- **Never logged (user content):** question/prompt substrings, dataset names,
  `generationId`, `environmentId`/`interactionId` values, uploaded file names or
  GCS URIs, or agent output text / tool arguments / tool results.
- **Logged instead:** fixed diagnostic metadata — operation name, a diagnostic
  code (e.g. `UNEXPECTED_ANALYZE_ERROR`, `SNAPSHOT_PROCESSING_FAILED`), an error
  class name only from a small allowlist (see `server/lib/safeDiagnostics.ts`),
  an upstream HTTP status, and booleans/counts.
- The browser always receives the safe messages already applied in CP5.2; raw
  error text is never forwarded.

### Body handling on upstream non-2xx: cancel/discard, never read

When the Interactions API or the snapshot endpoint returns non-2xx, the server
**cancels and discards the body without reading it** (`response.body.cancel()`).
The body is never buffered, logged, or forwarded, and `response.text()` /
`response.json()` are never called on it — upstream bodies can echo secret
material (e.g. a prefix of the caller's API key).

### Controlled live test — FIRST STAGE ONLY (never run inside this repo process)

The very first live Gemini call is tightly bounded:

**May use (first stage only):**
- exactly **one** Gemini developer API key owned by the project owner;
- **one** local, fully synthetic CSV, **≤ 20 rows**, containing no personal data;
- a normal local upload (inline, 1 MB cap);
- `catalogId: antigravity`;
- one simple analysis question;
- **one** fresh analysis — nothing else.

**Must NOT use (first stage):**
- GCS URIs;
- `googleToken` / OAuth tokens;
- production or personal datasets;
- follow-up / `environmentId` continuation;
- a second API key;
- any other model/agent;
- large uploads.

Follow-up questions and a second key are only tested in a **later, separate
stage**, after the first fresh analysis succeeds and its logs/output have been
checked.

### `PUBLIC_BASE_URL` boundary

- The Gemini sandbox **cannot reach** `localhost` on the developer's laptop; a
  sandbox callback to this app therefore requires a public HTTPS URL that truly
  routes to this service.
- **Proof from source:** for a fresh local CSV (inline content, no GCS), the
  sandbox **does not need a callback** to `PUBLIC_BASE_URL`. The only code that
  embeds `PUBLIC_BASE_URL` into the sandbox payload is the generated
  `download_gcs.py` script, which is only created when the request contains GCS
  files (`server.ts`, `hasGcsFiles` / `gcsFilesToDownload`). Inline CSVs are
  shipped directly as `inlineSources` and never trigger the script, so the first
  stage (inline synthetic CSV) runs without the sandbox calling back.
- Recommended option **when a callback is needed** (e.g. GCS or a public
  end-to-end test): a temporary/private Render preview with
  `autoDeploy: false` and a manual deployment. CP5.3 performs **no deploy and no
  tunnel**.
- **Never** put the Gemini API key into the Render environment: the key stays
  BYOK, sent per-request in the `x-gemini-api-key` header.
- `PUBLIC_BASE_URL` is **not a secret**, but it must equal the deployment origin
  so the app is reachable under the URL it advertises.

### `googleToken` / GCS token separation (audit summary)

- `googleToken` sent by the browser in the request body is **accepted but never
  used** by the server (dead field, no read/forward/log). It is documented as a
  **separate secret** from the Gemini BYOK key and is **excluded** from the first
  controlled live test.
- The **GCS path** (server-side `getGcpAccessToken()` → `gcsToken`) is only
  exercised when a request contains GCS files. When active, the token is
  embedded in the generated sandbox source (`download_gcs.py`, as the `token`
  literal) and attached as an `Authorization: Bearer` transform for the
  `storage.googleapis.com` domain in the sandbox network allowlist. The wildcard
  egress entry carries **no** token transform, so the token is not attached to
  arbitrary domains by the platform — but LLM-generated sandbox code *could*
  read the embedded script source, so this path is disabled from the first live
  test and needs its own security checkpoint before public production.