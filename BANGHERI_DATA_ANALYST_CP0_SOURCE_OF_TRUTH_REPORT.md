# BANGHERI_DATA_ANALYST_CP0_SOURCE_OF_TRUTH_REPORT.md

**Checkpoint:** CP0 — Source of Truth Verification
**Project:** BangHeri Data Analyst
**Peran:** Implementer/Auditor (READ-ONLY)
**Tanggal audit:** 2026-08-10
**Auditor:** opencode (deepseek-v4-flash-free) — sesi audit mandiri

---

## 1. Executive Summary

Audit read-only terhadap repositori `bangheri-data-analyst` telah dilaksanakan tanpa
mengubah satu pun file sumber, konfigurasi, commit, ataupun remote.

Hasil kunci:

1. **Proyek TIDAK berada di bawah version control.** Tidak ada `.git` di dalam
   direktori proyek maupun direktori induk. Tidak ada branch, commit, HEAD, tag,
   remote, ataupun upstream yang dapat dilaporkan. Ini adalah **P1 — production
   blocker** utama: source of truth berbasis git tidak dapat ditetapkan, dan semua
   file tidak terlindungi dari kehilangan data.
2. **Struktur kode lengkap dan sesuai CLAUDE.md** — frontend SPA, orchestrator
   Express lokal, dan remote agent bundle. Semua file wajib yang di-check tersedia.
3. **Kontrak laporan terverifikasi sinkron** di `src/types.ts`, `agent/AGENTS.md`,
   dan `build_report.py`. Workflow prompt terbukti duplikat di `server.ts` dan
   `agent/AGENTS.md`.
4. **Satu klaim CLAUDE.md terbukti keliru di level runtime**: modul persistensi
   `src/lib/firestore.ts` (localStorage) ada, tetapi **tidak diimpor/dipakai sama
   sekali oleh `src/App.tsx`** — dead code. Laporan tidak pernah benar-benar
   disimpan di browser.
5. **Model ID hard-coded di 2 lokasi** (`server/lib/agentClient.ts:51` dan
   `agent/agent.yaml:2`). Parameterisasi parsial ada (`opts.agentName`) tetapi
   tidak digunakan; tidak ada state frontend, tidak ada allowlist server, tidak
   ada profil `fast/balanced/deep`. Readiness model selection **rendah**.
6. **Hygiene secret baik saat ini**: tidak ada `.env*` maupun file credential di
   repositori. Namun `.env` polos TIDAK tercakup `.gitignore` (hanya `*.local`),
   dan tidak ada `.env.example`.
7. **Tidak ada test, CI, Docker, PRD, ADR, maupun deployment guide.** Satu-satunya
   gate otomatis adalah `npm run lint` (typecheck `tsc --noEmit`).

**Final Gate Decision: `CP0 FAIL — SOURCE OF TRUTH NOT ESTABLISHED`** — karena
prasyarat paling dasar dari CP0 (identitas git: branch/commit/remote) tidak ada.
Remediasi utamanya singkat dan mekanis (inisialisasi VCS di luar checkpoint ini),
setelah itu audit ulang diharapkan lulus menuju CP1 Baseline.

---

## 2. Audit Scope and Safety Constraints

**Lingkup:**
- Pemeriksaan read-only penuh terhadap seluruh file proyek (tidak termasuk
  `node_modules/`, `dist/`, `output/`, `.git/` — semuanya tidak ada).
- Verifikasi bukti aktual terhadap klaim `CLAUDE.md`, `package.json`, dan kode.

**Aturan keselamatan yang dipatuhi (konfirmasi):**
1. Tidak ada perubahan source code / konfigurasi. ✔
2. Tidak menjalankan formatter, fixer, migration, install, build, server, test. ✔
3. Tidak ada commit, tag, branch, pull, push, stash, reset, checkout, clean, merge. ✔
4. Tidak membaca/mencetak isi API key, token, credential, `.env*`. ✔
5. Nama environment variable dilaporkan; nilai disamarkan. ✔
6. Tidak menghapus/memindahkan file. ✔
7. Tidak menginstal dependency. ✔
8. Working tree tidak dapat dievaluasi (bukan git repo) — dicatat sebagai temuan. ✔
9. `CLAUDE.md` tidak dianggap benar sebelum diverifikasi terhadap repository. ✔
10. Satu-satunya file yang dibuat: laporan ini. ✔

---

## 3. Repository Identity

| Item | Hasil |
|---|---|
| `pwd` | `/home/bang/projects/bangheri-data-analyst` |
| Root repository (`git rev-parse --show-toplevel`) | **TIDAK ADA — bukan git repository** (`fatal: not a git repository`) |
| Branch aktif | N/A (tidak ada git repo) |
| Commit HEAD (full/short) | N/A |
| Commit date | N/A |
| Tag yang menunjuk HEAD | N/A |
| Remote (sanitized) | N/A |
| Upstream branch | N/A |
| Ahead/behind upstream | N/A |
| `git status --short` | N/A |
| `git status --branch --short` | N/A |
| Direktori induk (`/home/bang/projects`, `/home/bang`) | Juga bukan git repo |

**Catatan:** Direktori proyek hanya berisi file `.gitignore` (bukan `.git/`).
Proyek saudara lain di `/home/bang/projects` (`ATS BangHeri`, `sakura-sensei`,
`AI-Assistant`) adalah git repo, tetapi tidak berada di jalur induk proyek ini.

**Bukti:** `ls -la` tidak menampilkan `.git`; `git rev-parse --show-toplevel`
menghasilkan `fatal: not a git repository` di proyek dan seluruh parent path.

---

## 4. Working Tree State

Tidak dapat dinilai karena **bukan git repository**. Tidak ada staging, tidak ada
untracked files yang dapat dihitung oleh git. Secara praktik, seluruh 31 file
proyek adalah "untracked" dari perspektif VCS.

**Implikasi:** Tidak ada baseline hash untuk memastikan integritas file antar
sesi. Setiap modifikasi file tidak dapat dilacak/rollback.

---

## 5. Verified Project Structure

Struktur lengkap (semua file non-generated):

```
/home/bang/projects/bangheri-data-analyst/
├── CLAUDE.md                 (7.4 KB, docs pengembangan)
├── README.md                 (scaffold AI Studio)
├── metadata.json             (metadata AI Studio app)
├── package.json              (npm — name masih "echo-radio")
├── package-lock.json         (lockfile npm)
├── tsconfig.json             (TS ESNext, bundler resolution, @/* alias)
├── vite.config.ts            (React + Tailwind v4 plugin, HMR toggle)
├── eslint.config.js          (merujuk @firebase/eslint-plugin-security-rules)
├── index.html                (entry HTML SPA)
├── index.css                 (0 byte — file kosong di root)
├── server.ts                 (1401 baris — orchestrator Express)
├── server/
│   └── lib/
│       ├── agentClient.ts    (357 baris — Gemini Interactions API client)
│       └── jsonExtractor.ts  (26 baris — ekstraksi blok JSON dari teks)
├── src/
│   ├── main.tsx              (entry React)
│   ├── App.tsx               (2502 baris — SPA utama)
│   ├── types.ts              (AnalysisReport, UploadedFile, dll)
│   ├── index.css             (Tailwind v4 + font)
│   └── lib/
│       └── firestore.ts      (72 baris — localStorage, DEAD CODE)
└── agent/                    (bundle remote — TIDAK jalan di mesin ini)
    ├── AGENTS.md             (system prompt / workflow contract)
    ├── agent.yaml            (base_agent + tools)
    ├── requirements.txt      (pandas, numpy, matplotlib)
    └── skills/
        ├── data-explorer/SKILL.md
        ├── python-data/SKILL.md
        ├── reporting/SKILL.md + scripts/build_report.py (288 baris)
        └── visualization/SKILL.md + scripts/make_chart.py
```

### Konfirmasi keberadaan file wajib

| File | Status | Path aktual |
|---|---|---|
| `CLAUDE.md` | ✔ ADA | `/home/bang/projects/bangheri-data-analyst/CLAUDE.md` |
| `package.json` | ✔ ADA | root |
| lockfile | ✔ ADA | `package-lock.json` |
| `server.ts` | ✔ ADA | root (1401 baris) |
| `src/App.tsx` | ✔ ADA | (2502 baris) |
| `src/types.ts` | ✔ ADA | |
| `src/lib/firestore.ts` | ✔ ADA | (dead code — tidak dipakai) |
| `server/lib/agentClient.ts` | ✔ ADA | |
| `agent/AGENTS.md` | ✔ ADA | |
| `agent/agent.yaml` | ✔ ADA | |
| `agent/skills/` | ✔ ADA | 4 skill (data-explorer, python-data, reporting, visualization) |
| `agent/skills/**/build_report.py` | ✔ ADA | `agent/skills/reporting/scripts/build_report.py` |
| `agent/skills/**/make_chart.py` | ✔ ADA | `agent/skills/visualization/scripts/make_chart.py` |

**Tidak ada:** direktori `scripts/` di root, `tests/`, `.github/`, Docker file,
shell scripts.

---

## 6. Runtime and Build Contract

### Package manager & Node
- **Package manager:** npm (lockfile `package-lock.json` v3, `"type": "module"`).
- **Node version:** TIDAK dideklarasikan (tidak ada field `engines`).

### Scripts (`package.json`)
| Script | Perintah | Fungsi |
|---|---|---|
| `dev` | `tsx server.ts` | Dev — Express + Vite middleware, 1 proses, port 3000 (auto-increment) |
| `build` | `vite build && esbuild server.ts --bundle ... --outfile=dist/server.cjs` | Produksi: frontend `dist/` + server bundle `dist/server.cjs` |
| `start` | `node dist/server.cjs` | Produksi (butuh build dulu) |
| `preview` | `vite preview` | Preview frontend |
| `clean` | `rm -rf dist` | Bersihkan build |
| `lint` | `tsc --noEmit` | **Satu-satunya gate otomatis (typecheck)** |

**Tidak ada** script `test` dan tidak ada script type-check terpisah.

### Entry points
- **Dev:** `server.ts:1401` (`startServer()`) → port `3000` (`server.ts:180`), listen `0.0.0.0`, SPA dilayani Vite middleware (`server.ts:1362-1367`).
- **Produksi:** `dist/server.cjs`; server melayani `dist/` statis + fallback `index.html` (`server.ts:1356-1375`), dengan fallback ke Vite dev middleware bila `dist/index.html` tidak ada.
- **Frontend entry:** `index.html` → `/src/main.tsx` → `src/App.tsx`.

### Dependency utama
- **Runtime server:** `express`, `@google/genai`, `multer`, `archiver`, `dotenv`.
- **Frontend:** `react` 19, `react-dom`, `react-markdown` + `remark-gfm`, `jspdf` + `jspdf-autotable`, `html2canvas`, `lucide-react`, `motion`, `pako`, `jszip`.
- **Build/tooling:** `vite` 6, `esbuild`, `tsx`, `typescript` ~5.8, `tailwindcss` 4, `@vitejs/plugin-react`, `@tailwindcss/vite`.

### Port & environment variables (nama saja, tanpa nilai)
- **Port:** 3000 (auto-increment bila sibuk; `startListening` di `server.ts:1377-1396`).
- **Wajib:** `GEMINI_API_KEY` (dibaca `server.ts:5`, `agentClient.ts:71/104`; presence check `server.ts:647`).
- **Opsional:** `DAILY_QUOTA_LIMIT` (`server.ts:247`), `NODE_ENV` (`server.ts:320, 1356`), `DISABLE_HMR` (`vite.config.ts:17`).

### Build produksi
✔ Menghasilkan **dua artefak**: frontend SPA (`dist/`) dan server bundle
(`dist/server.cjs`). **Jangan menjalankan script** (sesuai aturan CP0) — klaim
diverifikasi dari definisi script `package.json:8` dan kode `server.ts:1356`.

---

## 7. Managed Agent Dependency Map

Semua referensi terhadap managed agent & model (tidak termasuk `node_modules`).

### `antigravity-preview-05-2026` (model / base agent)

| File:Line | Fungsi | Dependency kritis migrasi | Model bisa diganti langsung? |
|---|---|---|---|
| `server/lib/agentClient.ts:51` | `opts.agentName ?? "antigravity-preview-05-2026"` — nilai `agent` di payload `POST /interactions` | **YA — kritis.** Ini yang menentukan agent yang dipanggil Google | Sebagian: sudah diparameterisasi via `opts.agentName`, tetapi **tidak ada pemanggil yang mengoper nilai** → efektif hard-coded |
| `agent/agent.yaml:2` | `base_agent: antigravity-preview-05-2026` — kontrak base agent yang di-bundle ke sandbox (`/.agents/agent.yaml`) | **YA — kritis.** Mendeklarasikan base agent + contract tools | Bisa diganti string, tetapi terikat pada managed-agent contract (tools, skill scripts, schema) |
| `CLAUDE.md:42` | Dokumentasi arsitektur | Tidak | N/A (docs) |

**Kesimpulan D:** Model ID **efektif hard-coded** di 2 tempat kritis. Nilai string
bisa diganti langsung, namun **secara semantik terikat pada managed-agent
contract** (Interactions API + `code_execution` + `google_search` + skill bundle).

### Interactions API & createInteraction

| File:Line | Fungsi |
|---|---|
| `server/lib/agentClient.ts:46` | `API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"` |
| `server/lib/agentClient.ts:48` | `createInteraction()` — POST `/interactions` |
| `server/lib/agentClient.ts:100-114` | Header `x-goog-api-key`, `Api-Revision: 2026-05-20`, `x-server-timeout: 600` |
| `server/lib/agentClient.ts:124-190` | `streamInteraction()` — parse SSE |
| `server/lib/agentClient.ts:196-357` | `parseAgentEvent()` — translate event Interactions → `AgentEvent` |
| `server.ts:10, 783` | Import & pemanggilan `createInteraction` |

### `environmentId` / `environment_id`

| File:Line | Fungsi |
|---|---|
| `agentClient.ts:13, 65-66` | Opsi `environmentId` → payload `environment.env_id` |
| `server.ts:88-104` | `extractEnvironmentId()` — ekstrak dari resource interaction |
| `server.ts:440, 453` | Terima dari client; `isFollowUp = !!environmentId` |
| `server.ts:604` | `sendSessionEnvironment()` ke frontend |
| `server.ts:1040` | Download snapshot: `/files/environment-${envId}:download?alt=media` |
| `App.tsx:193-201, 220, 508, 646-652` | Tangkap & kirim balik `environmentId` untuk follow-up |

### Tools (`code_execution`, `google_search`)

| File:Line | Fungsi |
|---|---|
| `agent/agent.yaml:5-6` | `google_search`, `code_execution` |
| `agent/AGENTS.md:47, 64-66` | Kontrak eksekusi agent (kode), follow-up execution-only |
| `agentClient.ts:250` | Deteksi `code_execution_call` |
| `server.ts:492-499` | Prompt follow-up "one code_execution call" |

### Sandbox, snapshot, tar, report.json

| File:Line | Fungsi |
|---|---|
| `agent/AGENTS.md:10-14, 64-93` | Konvensi path sandbox: `/.agents/data/*.csv`, `./workspace/data/`, `analysis/*.csv`, `charts/*.png`, `report.json` |
| `server.ts:40-86` | `extractTarInMemory()` — tar parser buatan tangan |
| `server.ts:1040-1061` | Download snapshot + extract in-memory |
| `server.ts:1084-1096` | Ambil `report.json` dari tar |
| `agent/skills/reporting/scripts/build_report.py:275-281` | Tulis `{workspace}/data/report.json` |

### inlineSources

| File:Line | Fungsi |
|---|---|
| `agentClient.ts:16-19` | Tipe source: inline / gcs / repository |
| `server.ts:118-137` | `loadAgentFiles()` — bundle seluruh `agent/` → `/.agents/` |
| `server.ts:657-680` | Agent files + CSV user sebagai inlineSources |
| `server.ts:786-789` | Follow-up: `inlineSources: undefined` (reuse environment) |

### Follow-up interaction

| File:Line | Fungsi |
|---|---|
| `server.ts:483-499` | Prompt "execution-only" untuk follow-up |
| `server.ts:450-453` | Reuse environment; tidak chain ke interaction sebelumnya |
| `server.ts:636` | Log "Continuing session in active environment" |

---

## 8. Contract Synchronization Matrix

Verifikasi klaim `CLAUDE.md` terhadap bukti aktual.

| # | Klaim | Keputusan | Bukti (file:line) |
|---|---|---|---|
| 1 | Workflow prompt diduplikasi di `server.ts` dan `agent/AGENTS.md` | **VERIFIED** | Prompt lengkap di `server.ts:483-559` (follow-up 483-499, initial 500-559); workflow identik di `agent/AGENTS.md:45-93` (setup/explore/analyze/visualize/report, hard budget 10 calls, follow-up execution-only). Keduanya merujuk skill scripts yang sama (`make_chart.py`, `build_report.py`). |
| 2 | Schema laporan ada di `src/types.ts`, `agent/AGENTS.md`, `build_report.py` | **VERIFIED** | `AnalysisReport` di `src/types.ts:24-35` (dataset_name, question, title, executive_summary, insights[], charts[], tables[], methodology?, recommendations?, generated_at?). JSON schema di `agent/AGENTS.md:95-141` (kontrak `data/report.json`). Emisi di `build_report.py:228-257` (build_report → dict dengan field yang sama). Kunci `charts[].image`/`caption` optional di types & AGENTS; `build_report.py:234-242` mengisi `title/file/caption/type`. Minor drift: `build_report.py` tidak mengisi `caption` selain `""` dan tidak memiliki field `image` (diisi server setelah ekstraksi tar) — kompatibel. |
| 3 | Upload CSV dibatasi 1 MB | **VERIFIED** | `server.ts:372-377` — `MAX_INLINE_SIZE = 1 * 1024 * 1024` (1MB); di atas itu error meminta GCS URI. Multer outer limit 50MB (`server.ts:334`). |
| 4 | Grafik disimpan ke `output/<runId>/charts/` | **VERIFIED** | `server.ts:1068-1109` — `chartRunDir = output/<runId>/charts`; tulis PNG + `chartImages[base] = /output/<runId>/charts/<base>`; statis di `server.ts:186` (`app.use("/output", express.static(...))`). |
| 5 | Laporan dipersistensikan via localStorage | **PARTIALLY VERIFIED (drift)** | Modul `src/lib/firestore.ts:20-71` membaca/menulis `saved_reports` di localStorage (`getReports`, `saveReport`, `deleteReport`). **Namun tidak ada satu pun impor/pemakaian dari `src/App.tsx`** (grep seluruh `src/` — hanya definisi di `firestore.ts`). Modul ini **dead code**; laporan tidak benar-benar disimpan. |
| 6 | Firebase, GCS, quota tracking sengaja di-stub | **VERIFIED** | `deleteGcsFiles` disabled (`server.ts:419-421`); `/api/download-file` → 500 "GCS bucket is not configured" (`server.ts:423-425`); `/api/clear-files` → no-op (`server.ts:427-429`); `/api/analyze` log "Skipping daily quota tracking" (`server.ts:468`); `/api/quota` → unlimited di non-produksi (`server.ts:319-329`); `getUserHash` fixed `"dev-user-hash"` (`server.ts:267-270`). |
| 7 | Follow-up menggunakan environment sandbox yang sama | **VERIFIED** | `server.ts:453` (`isFollowUp = !!environmentId`), `server.ts:786-788` (`inlineSources: undefined` untuk follow-up — tidak re-bundle agent files), `server.ts:450-452` (reuse environment, tanpa chaining). Frontend mengirim `environmentId` di `src/App.tsx:508`. |
| 8 | Production build menggunakan Vite dan esbuild | **VERIFIED** | `package.json:8` — `build`: `vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs`. |
| 9 | Server produksi menyajikan hasil build frontend | **VERIFIED (dengan catatan)** | `server.ts:1356-1375` — bila `NODE_ENV=production` dan `dist/index.html` ada: `express.static(distPath)` + SPA fallback `res.sendFile(dist/index.html)`. **Catatan:** bila `dist/` hilang, server **diam-diam fallback ke Vite dev middleware** (`server.ts:1356-1367`) — perilaku ini menutupi kegagalan build dan bisa mengecoh pengujian produksi. |

**Keputusan kontrak:** 8 dari 9 klaim VERIFIED (2 di antaranya dengan catatan
minor), 1 PARTIALLY VERIFIED (klaim persistensi localStorage).

---

## 9. Model Selection Readiness

### Temuan audit (tanpa implementasi)
- **Hard-coded model ID:** YA — `server/lib/agentClient.ts:51` (default
  `"antigravity-preview-05-2026"`; parameter `opts.agentName` ada tetapi tidak
  pernah dioper pemanggil) dan `agent/agent.yaml:2` (`base_agent`).
- **Lokasi yang harus berubah untuk model registry:**
  1. `server/lib/agentClient.ts:51` — sumber nilai `agent` di payload.
  2. `agent/agent.yaml:2` — kontrak `base_agent` yang di-bundle ke sandbox.
  3. `server.ts:783` — pemanggilan `createInteraction` (perlu meneruskan model terpilih).
  4. `agent/AGENTS.md` + `server.ts:483-559` — prompt workflow (bila perilaku model berbeda antar profil).
- **Frontend state/config pemilihan model:** TIDAK ADA. `src/App.tsx` tidak memiliki state model; payload `/api/analyze` (`src/App.tsx:504-513`) hanya `question, datasetName, generationId, environmentId, files`.
- **API menerima model dari client?** TIDAK. `server.ts:435-442` (destrukturisasi body `/api/analyze`) tidak membaca field model.
- **Server allowlist:** TIDAK ADA.
- **Model dapat dipilih tanpa merusak managed-agent workflow?** Berisiko. Agent dieksekusi via Interactions API sebagai satu managed-agent (agent name) dengan contract tools `google_search`/`code_execution`, skill bundle, hard budget 10 calls, dan schema `report.json`. Memilih model yang tidak kompatibel dengan contract tersebut (mis. tanpa `code_execution`) akan memutus alur profil → analisis → chart → report.
- **Potensi manipulasi model ID dari client:** Saat ini tidak mungkin (API tidak menerima field model). **Tetapi** `environmentId` dan `generationId` diterima dari client; `generationId` divalidasi regex (`server.ts:1069`), `environmentId` dipakai langsung dalam URL download `environment-${envId}:download` (`server.ts:1040`) — perlu validasi/escaping (lihat P2-02).
- **Kebutuhan validasi server-side:** WAJIB — allowlist di sisi server; client tidak boleh mengirim arbitrary model ID.
- **Pengaruh pilihan model:** tools (agent.yaml), structured report (prompt + skills), sandbox (environment), timeout (600s di `agentClient.ts:105`), biaya (beda harga/model), dan follow-up (reuse environment — model harus konsisten per session).
- **Komponen yang perlu masuk PRD & ADR:** registry model curated, server-side allowlist, profil `fast/balanced/deep`, pemetaan profil→modelID, keputusan apakah agent bundle berubah per profil, strategi biaya/quota per profil, kebijakan kegagalan/sandbox reuse.

### Kesiapan MVP (curated Gemini models, allowlist server, profil fast/balanced/deep, API key server, belum BYOK/multi-provider, tanpa arbitrary model ID)
| Aspek | Status |
|---|---|
| Daftar curated model | Belum ada — perlu PRD |
| Allowlist server-side | Tidak ada — perlu implementasi |
| Profil `fast/balanced/deep` | Tidak ada — perlu desain |
| API key di server | ✔ Sudah (`GEMINI_API_KEY` di `agentClient.ts`) |
| BYOK / multi-provider | Tidak relevan (di luar scope MVP) ✔ |
| Pencegahan arbitrary model ID | ✔ Saat ini aman (tidak ada input), tetapi akan menjadi gap bila input ditambahkan tanpa allowlist |

**Kesimpulan F:** Readiness model selection = **LOW**. Fondasi (API key server,
interaksi terpusat di `agentClient.ts`) bagus, tetapi semua komponen pemilihan
model harus dibangun dari nol.

---

## 10. Secret and Repository Hygiene

| Pemeriksaan | Hasil |
|---|---|
| `.env*` di-ignore? | **Sebagian.** `*.local` mencakup `.env.local` ✔; **`.env` polos TIDAK di-ignore** ✘ (`.gitignore` tidak memuat baris `.env` atau `*.env`) |
| File dengan nama mengindikasikan credential | Tidak ada (scan semua file: tidak ada `*key*`, `*secret*`, `*token*`, `*credential*`, `service-account.json` — hanya `.gitignore` yang memuat `service-account.json` sebagai pola ignore) |
| File rahasia ter-track git | N/A — bukan git repo; tidak ada file `.env*` sama sekali di direktori |
| Generated output ter-track | N/A — tidak ada `output/`, `dist/`, `node_modules/` saat ini |
| `dist/`, `output/`, log, cache, temp di-ignore | `dist` ✔, `node_modules` ✔, log ✔ (`*.log`, `npm-debug`), `dist-ssr` ✔, `*.local` ✔, `service-account.json` ✔. **`output/` TIDAK di-ignore** (CLAUDE.md menyatakan sengaja; tanpa git ini belum berdampak) |
| File besar / artefak tak wajar | Tidak ada — terbesar `package-lock.json` (288 KB, normal) |
| Dugaan secret | **Tidak ditemukan nilai secret.** Tidak ada file `.env*`, tidak ada key/token literal dalam kode yang di-scan (referensi `process.env.GEMINI_API_KEY` hanya nama variable) |

**Catatan keamanan:** `server.ts:19-38` mencoba `getGcpAccessToken()` dari metadata
server Google di tiap `/api/analyze` (`server.ts:774`) dan pada upload GCS
(`server.ts:477`). Di luar Google Cloud, panggilan ini gagal dengan cepat dan
diam-diam (log warning) — bukan risiko secret, hanya jejak dead-path GCS.

---

## 11. Tests, CI, and Documentation Inventory

| Item | Status | Catatan |
|---|---|---|
| PRD | ✘ Tidak ada | |
| ADR | ✘ Tidak ada | |
| README | ✔ Ada | Minimal — scaffold AI Studio (`README.md`), tidak ada arsitektur/deployment |
| Deployment guide | ✘ Tidak ada | |
| Security/privacy documentation | ✘ Tidak ada | |
| Test files (`*.test.*`, `*.spec.*`) | ✘ Tidak ada | |
| Test framework | ✘ Tidak ada | Satu-satunya gate: `npm run lint` (tsc `--noEmit`) |
| CI workflow (`.github/`) | ✘ Tidak ada | |
| Production checklist | ✘ Tidak ada | |
| Rollback procedure | ✘ Tidak ada (dan tanpa VCS, rollback tidak mungkin) | |
| Dokumentasi pengembangan | ✔ Ada | `CLAUDE.md` — komprehensif (arsitektur, invariants, stub, konvensi) |

**Gap utama:** tidak ada pengujian otomatis selain typecheck; tidak ada CI; tidak
ada dokumentasi operasional/produksi.

---

## 12. Risks and Findings

### Severity Legend
- **P0** — critical / security / data-loss
- **P1** — production blocker
- **P2** — important hardening
- **P3** — improvement

### Findings

| ID | Severity | Temuan | Bukti | Rekomendasi |
|---|---|---|---|---|
| P1-01 | **P1** | **Bukan git repository** — tanpa branch, commit, remote, tag, upstream. Seluruh 31 file tidak terlacak; source of truth git tidak ada; tidak ada proteksi kehilangan data; tidak ada baseline integritas antar sesi. | `git rev-parse --show-toplevel` → fatal di proyek dan semua parent; `ls -la` tanpa `.git/` | Inisialisasi VCS (di luar CP0): `git init`, baseline commit, attach remote. Setelah itu ulang CP0. |
| P2-01 | **P2** | Modul persistensi `src/lib/firestore.ts` (localStorage) adalah **dead code** — klaim CLAUDE.md "persistence is localStorage only" tidak berlaku di runtime; laporan tidak pernah disimpan. | Grep `firestore\|saveReport` di `src/App.tsx` → 0 match; hanya definisi di `firestore.ts:20-71` | Putuskan: wiring ulang ke UI, atau hapus + koreksi CLAUDE.md. |
| P2-02 | **P2** | `environmentId` dari client dipakai langsung dalam URL download tanpa sanitasi karakter (`/files/environment-${envId}:download`). Potensi path/query injection ke URL Interactions API (envId `/.` atau `?` dapat mengubah request). | `server.ts:1040` (envId dari `req.body.environmentId` via `server.ts:440`); `extractEnvironmentId` (`server.ts:88-104`) hanya men-strip prefix, tidak sanitasi | Validasi `envId` dengan regex ketat sebelum dipakai di URL; reject bila tidak cocok. |
| P2-03 | **P2** | `.env` polos tidak tercakup `.gitignore` (hanya `*.local`). Saat git di-inisialisasi, `GEMINI_API_KEY` di `.env` berisiko ter-commit. | `.gitignore:13` (`*.local`) — tanpa baris `.env`/`*.env` | Tambah `*.env` + `.env` ke `.gitignore` sebelum git init. |
| P2-04 | **P2** | Tidak ada `.env.example` yang mendokumentasikan variable wajib (`GEMINI_API_KEY`) dan opsional (`DAILY_QUOTA_LIMIT`, `NODE_ENV`, `DISABLE_HMR`). Onboarding & deployment manual rentan salah konfigurasi. | Scan file → tidak ada `.env.example` | Buat `.env.example` berisi nama variable saja (tanpa nilai). |
| P2-05 | **P2** | Tidak ada test framework, test files, maupun CI. Satu-satunya gate adalah typecheck (`npm run lint`). Produksi tanpa jaring pengaman fungsional. | `package.json:12` (lint = tsc); find → 0 test files; tidak ada `.github/` | Tambah minimal smoke test untuk alur upload→analyze→snapshot; pertimbangkan CI (jenis pekerjaan di luar CP0). |
| P2-06 | **P2** | Duplikasi prompt workflow (`server.ts:483-559` vs `agent/AGENTS.md:45-93`) adalah invariant yang harus dirawat bersamaan; tanpa pengujian diff, drift tidak terdeteksi. | Bukti duplikasi di Section 8 (#1) | Mekanisme verifikasi drift (checklist CI atau komentar penanda). |
| P3-01 | **P3** | `eslint.config.js:1` mengimpor `@firebase/eslint-plugin-security-rules` yang **tidak ada di `package.json`** devDependencies → konfigurasi ESLint tidak dapat dijalankan. | `eslint.config.js:1` vs `package.json:37-50` | Tambah dependency atau hapus konfigurasi firebase plugin. |
| P3-02 | **P3** | `index.css` root kosong (0 byte) sedangkan styling ada di `src/index.css` — duplikasi membingungkan. | `index.css` (0 B) vs `src/index.css` (41 baris) | Hapus file kosong atau perjelas. |
| P3-03 | **P3** | `package.json:2` name masih `"echo-radio"` (leftover scaffold AI Studio). | `package.json:2` | Rename saat ada kesempatan (pastikan lockfile ikut diperbarui). |
| P3-04 | **P3** | Node version tidak dipin (`engines` tidak ada) → reproduksibilitas build tidak terjaga. | `package.json` tanpa `engines` | Tambah field `engines` + `.nvmrc`/`.node-version`. |
| P3-05 | **P3** | `output/` (scratch: chart PNG + quota cache) tidak di-ignore; tanpa git, belum berdampak, tetapi akan mencemari repo bila git init. | `.gitignore` tanpa `output/`; `CLAUDE.md:110` mengakuinya | Tambah `output/` ke `.gitignore` saat VCS diinisialisasi. |
| P3-06 | **P3** | Dead-path GCS/Firebase masih hidup di kode: `getGcpAccessToken()` dipanggil di setiap `/api/analyze` (`server.ts:774`) dan blok GCS download script (`server.ts:682-767`) walau GCS di-stub. Jejak kode yang membingungkan + warning noise. | `server.ts:19-38, 474-479, 682-767, 773-778` | Bersihkan saat refactor (jaga agar tidak merusak stub intent). |

**Ringkasan severity:** P0 = 0, P1 = 1, P2 = 6, P3 = 6. Total 13 findings.

---

## 13. Production Blockers

Blockers yang harus diselesaikan sebelum proyek dianggap siap produksi:

1. **P1-01 — Tidak ada version control.** Tanpa git, tidak ada baseline,
   auditability, maupun rollback. Ini prasyarat mutlak CP1 Baseline.
2. **P2-01 — Fitur penyimpanan laporan tidak berfungsi** (dead code) — bertentangan
   dengan klaim fungsionalitas produk.
3. **P2-02 — Validasi `environmentId`** pada URL download snapshot (hardening
   keamanan minimal sebelum produksi).
4. **P2-05 — Tidak ada gate pengujian fungsional/CI** untuk alur end-to-end.

---

## 14. Recommended Next Checkpoint

| Urutan | Checkpoint | Prasyarat | Lingkup |
|---|---|---|---|
| CP0 (ini) | Source of truth | — | Selesai — **FAIL** |
| Pre-CP1 | Inisialisasi VCS (di luar read-only): `git init` + baseline commit + remote, `.gitignore` ditambah `*.env`, `.env`, `output/` | Keputusan pemilik | Membuat repo dapat diaudit |
| CP1 | **Baseline** | VCS tersedia, CP0 ulang lulus | Snapshot integritas, pin Node, dokumentasi env |
| CP2 | **Hardening** | CP1 | Resolusi P2 (firestore wiring atau pembersihan, validasi envId, .env.example, test smoke + CI) |
| CP3 | **Model selection MVP** | CP2 | Registry curated + allowlist server + profil fast/balanced/deep (perlu PRD/ADR dulu) |
| CP4 | **Produksi** | CP3 | Deployment guide, checklist produksi, rollback procedure |

**Jangan mulai CP1** sampai VCS diinisialisasi dan CP0 diulang.

---

## 15. Evidence Appendix

Perintah read-only yang dijalankan (tanpa mutasi):

- `pwd`; `ls -la`
- `git rev-parse --show-toplevel` / `--abbrev-ref HEAD` / `rev-parse HEAD` / `log -1` / `remote -v` / `status --short` / `status --branch --short` / `tag --points-at HEAD` → semuanya `fatal: not a git repository`
- `find` untuk pemetaan struktur, file tersembunyi, test/CI/docker/shell
- `du -sh`/`du -ah` untuk ukuran dan deteksi file besar
- `grep -rn` untuk: `antigravity-preview-05-2026`, `createInteraction`, `environmentId`, `code_execution`, `google_search`, `sandbox/snapshot/tar/report.json/inlineSources/follow-up`, `model`, `localStorage/firestore/saveReport`
- `read` penuh untuk: `CLAUDE.md`, `package.json`, `README.md`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `eslint.config.js`, `metadata.json`, `index.html`, `agentClient.ts`, `types.ts`, `firestore.ts`, `agent.yaml`, `build_report.py`, `main.tsx`, `requirements.txt`, segmen `server.ts` (1-200, 330-459, 470-559, 640-789, 940-1119, 1352-1401), segmen `src/App.tsx` (470-529)
- `wc -l` untuk ukuran file utama

Referensi garis bukti penting:

- Model: `server/lib/agentClient.ts:51`, `agent/agent.yaml:2`
- API base + header: `server/lib/agentClient.ts:46, 100-114`
- Tar parser: `server.ts:40-86`; download snapshot: `server.ts:1040`
- Output chart: `server.ts:1072-1113`; statis `/output`: `server.ts:186`
- Upload 1MB: `server.ts:372-377`
- Stubs: `server.ts:419-429, 468, 267-270`
- Prompt duplikat: `server.ts:483-559` ↔ `agent/AGENTS.md:45-93`
- Schema laporan: `src/types.ts:24-35`, `agent/AGENTS.md:95-141`, `build_report.py:228-257`
- Persistensi dead code: `src/lib/firestore.ts:20-71` (tanpa pemakai di `src/App.tsx`)
- Payload frontend: `src/App.tsx:504-513`; fetch: `src/App.tsx:521`
- Produksi statis: `server.ts:1356-1375`
- Build: `package.json:8`

---

## 16. Final Gate Decision

### `CP0 FAIL — SOURCE OF TRUTH NOT ESTABLISHED`

**Alasan:** Pemeriksaan wajib Section A (identitas repository) tidak dapat
dipenuhi sama sekali — proyek **bukan git repository**: tidak ada branch, commit,
HEAD, remote, tag, ataupun upstream. Tanpa VCS, tidak ada baseline source of truth
yang dapat ditetapkan, diverifikasi lintas sesi, maupun di-rollback, dan seluruh
31 file proyek berisiko kehilangan data tanpa pelacakan.

**Sifat keputusan ini dapat dipulihkan dengan cepat:** inisialisasi VCS (`git
init` + baseline commit + remote, plus penambahan `*.env`, `.env`, `output/` ke
`.gitignore`) dilakukan di luar checkpoint read-only ini, lalu **CP0 diulang**.
Sisa temuan (P2-01 s/d P2-06, P3-01 s/d P3-06) tidak bersifat memblokir penetapan
source of truth tetapi wajib dijadwalkan di CP2 (hardening) sebelum produksi.

**Daftar blocker untuk resolusi sebelum CP1:**
1. (P1-01) Tidak ada version control → wajib diinisialisasi.
2. (P2-02) Validasi `environmentId` pada URL download snapshot.
3. (P2-03) `.gitignore` belum mencakup `.env` polos.

---
*Laporan ini dihasilkan sepenuhnya read-only. Tidak ada source code, konfigurasi,
commit, atau remote yang diubah.*
