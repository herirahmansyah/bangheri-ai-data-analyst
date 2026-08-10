# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**BangHeri Data Analyst** — a data-analysis web app. A user uploads CSV(s), asks a business
question, and a **Gemini Managed Agent** autonomously profiles the data, runs Pandas/scikit-learn
in a remote sandbox, renders charts, and returns an interactive report. Originally scaffolded from
Google AI Studio (the `package.json` `name` is still the leftover `echo-radio`).

## Commands

```bash
npm run dev      # tsx server.ts — Express + Vite middleware, single process on port 3000
npm run build    # vite build (SPA → dist/) + esbuild server.ts → dist/server.cjs
npm run start    # node dist/server.cjs — production (needs a prior build)
npm run lint     # tsc --noEmit — the ONLY check in this repo
npm run clean    # rm -rf dist
```

- There is **no test framework**. `npm run lint` (typecheck) is the only automated gate.
- `npm run dev` serves both the API and the frontend from one process (Vite runs as Express
  middleware). The port auto-increments if 3000 is busy (see `startListening` in `server.ts`).
- **Required env:** `GEMINI_API_KEY` in `.env.local` (falls back to `.env`). In hosted AI Studio
  it is injected, so a missing file is fine there. Optional: `DAILY_QUOTA_LIMIT`, `NODE_ENV`,
  `DISABLE_HMR=true`.

## Architecture — three tiers, one of them runs remotely

The most important thing to understand: **the `agent/` directory does NOT run on this machine.**
It is a bundle of files shipped to a Gemini-hosted Linux sandbox where the actual analysis happens.

1. **Frontend SPA** (`src/App.tsx`, ~2500 lines, single file) — upload UI, chat/follow-up,
   live activity log, report dashboard, and PDF export (jsPDF). Talks to the local server over a
   `fetch`-based **SSE stream** (not `EventSource` — it reads the response body reader manually).
   Report persistence is **localStorage only** (`src/lib/firestore.ts` — despite the name, Firestore
   is stubbed out; it just reads/writes `saved_reports` in localStorage).

2. **Local orchestrator** (`server.ts` + `server/lib/`) — an Express proxy between the browser and
   Google's **Interactions API** (`generativelanguage.googleapis.com/v1beta`, agent
   `antigravity-preview-05-2026`). Its job for each analysis:
   - `POST /api/analyze` bundles the entire `agent/` tree (via `loadAgentFiles`, mapped to
     `/.agents/` in the sandbox) **plus** the user's inline CSVs as `inlineSources`, then calls
     `createInteraction` (`server/lib/agentClient.ts`).
   - It streams the agent's SSE events back to the browser, translating raw Interactions API events
     into `AgentEvent`s (`parseAgentEvent` in `agentClient.ts`).
   - When the agent signals the report is saved (or the stream ends), the server downloads the
     sandbox's filesystem as a **tar snapshot** (`environment-<envId>:download`), extracts it *in
     memory* (`extractTarInMemory` — a hand-rolled tar parser), pulls out `report.json` + chart
     PNGs, writes PNGs to `output/<runId>/charts/`, and emits a final `report_data` SSE event.
   - Chart images are served from `/output/...` static files, referenced by the report's `charts[].image`.

3. **Remote agent** (`agent/`) — the SOP + skills executed inside the sandbox:
   - `agent/AGENTS.md` — the agent's system prompt / workflow contract.
   - `agent/agent.yaml` — agent id, base model, and enabled tools (`google_search`, `code_execution`).
   - `agent/requirements.txt` — pandas/numpy/matplotlib installed at runtime in the sandbox.
   - `agent/skills/*/SKILL.md` + `scripts/` — `visualization/make_chart.py` and
     `reporting/build_report.py` are invoked by the agent via `code_execution`.

### The end-to-end flow

```
browser upload → POST /api/upload (inline, 1MB cap) → CSV held in browser state
   → POST /api/analyze (question + CSV content + generationId [+ environmentId for follow-ups])
   → server bundles agent/ + CSVs as inlineSources → createInteraction (SSE)
   → agent runs Python in sandbox: profile → analyze → make_chart.py → build_report.py
   → sandbox writes ./workspace/data/report.json + ./workspace/charts/*.png
   → server downloads tar snapshot, extracts report.json + PNGs → SSE "report_data"
   → frontend renders dashboard
```

Follow-up questions **reuse the same `environmentId`** (the sandbox stays warm) instead of
re-uploading; the server sends an "execution-only" prompt and does not re-bundle agent files.

## Cross-cutting invariants (edit these together)

- **The analysis prompt is duplicated.** `server.ts` inlines the full workflow prompt (the
  `isFollowUp ? ... : ...` block in `/api/analyze`) and `agent/AGENTS.md` describes the same
  workflow. If you change the workflow, the hard call budget, or the skill script invocations,
  update **both** or the agent's behavior and its instructions will drift.

- **The report schema lives in three places** and must stay identical:
  `src/types.ts` (`AnalysisReport`), the JSON schema block in `agent/AGENTS.md`, and whatever
  `agent/skills/reporting/scripts/build_report.py` actually emits.

- **The report contract is `./workspace/data/report.json` in the sandbox.** The frontend renders
  100% from it. The prompt hammers this ("blank dashboard" warning) because if the agent stops
  before `build_report.py` runs, the user sees nothing. `server.ts` has layered fallbacks (recover
  text from `steps[]`, parse inline ```json blocks via `jsonExtractor.ts`, or synthesize a report
  from raw CSVs in the tar) — keep these when refactoring the stream handler.

- **Sandbox paths are fixed conventions**: input CSVs land at `/.agents/data/*.csv`, are copied to
  `./workspace/data/`, analysis tables go to `./workspace/data/analysis/*.csv`, charts to
  `./workspace/charts/*.png`, report to `./workspace/data/report.json`. The skill scripts and the
  prompt both hardcode these.

## Things that are intentionally stubbed / disabled

Do not "fix" these without checking intent — they were deliberately gutted for the current
inline-only deployment:

- **Firebase / GCS**: `ensureFirebaseAdmin`, `deleteGcsFiles`, `getUserHash` (returns a fixed
  `dev-user-hash`), and the `/api/download-file`, `/api/clear-files` handlers are no-ops/stubs.
  Uploads are inline-only with a **1 MB per-file cap** (`/api/upload`); larger files are meant to
  go through a GCS URI path that is only partially wired.
- **Quota tracking**: file-backed (`output/quota_cache.json`) and effectively bypassed —
  `/api/analyze` logs "Skipping daily quota tracking" and `/api/quota` returns unlimited in dev.
- **`output/` is a scratch dir**: chart PNGs and quota cache live here; directories older than 24h
  are auto-deleted on startup and on each `/api/analyze` (`cleanUpOldGenerations`). It is not
  gitignored explicitly but is regenerable — treat it as disposable.

## Conventions

- TypeScript is run directly via `tsx`/esbuild; `.ts` extensions are imported explicitly
  (`allowImportingTsExtensions`). `@/*` aliases the repo root (`vite.config.ts` + `tsconfig.json`).
- The server sets all HTTP timeouts to `0` — agent interactions are long-running; don't reintroduce
  timeouts on the analyze path.
- SSE keep-alive: a 15s heartbeat comment (`:\n\n`) is sent to survive idle-dropping proxies.
