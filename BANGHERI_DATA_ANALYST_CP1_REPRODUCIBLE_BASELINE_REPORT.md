# BANGHERI_DATA_ANALYST_CP1_REPRODUCIBLE_BASELINE_REPORT.md

**Checkpoint:** CP1 — Reproducible Baseline Verification
**Project:** BangHeri Data Analyst
**Peran:** Implementer/Auditor
**Tanggal:** 2026-08-10
**Referensi historis:** laporan CP0, Pre-CP1, dan CP0 Closure (semua di-commit)

---

## 1. Executive Summary

Baseline project telah diuji secara end-to-end dan terkendali untuk membuktikan
reproducibility-nya: install → type-check → lint → build → startup → smoke test →
cleanup → integrity. Pengujian dilakukan **tanpa mengubah source code, manifest,
lockfile, maupun konfigurasi**; seluruh artefak sementara (node_modules, dist,
output, log) berada di path yang di-ignore dan tidak di-commit.

Hasil:

| Gate | Hasil |
|---|---|
| Install (`npm ci`) | **PASS** (exit 0, 518 paket, 11s) |
| Type-check (`tsc --noEmit`) | **PASS** (exit 0, 0 error) |
| Lint (`npm run lint` = `tsc --noEmit`) | **PASS** (exit 0) — catatan: sesungguhnya typecheck, bukan linter sungguhan |
| Automated tests | **NOT AVAILABLE** (tidak ada script/test framework/test files) |
| Production build | **PASS** (exit 0, frontend + server bundle + sourcemap) |
| Production startup | **PASS** (listen `0.0.0.0:3000`, bind benar) |
| Smoke test lokal | **PASS** (index 200, asset statis 200, SPA fallback, tanpa exception) |
| Cleanup proses | **PASS** (PID dihentikan, port bebas, tanpa orphan) |
| Tracked integrity | **PASS** (package.json, lockfile, agregat tracked identik) |

Temuan tidak memblokir reproducibility: tidak ada automated test, tidak ada
linter sungguhan, 12 vulnerability dependency (belum diremediasi), warning chunk
build >500kB, dan dependency deprecation. Semua tergolong gap kualitas yang
terdokumentasi.

**Final Gate Decision: `CP1 CONDITIONAL PASS — BASELINE RUNS WITH DOCUMENTED QUALITY GAPS`**

---

## 2. Scope and Safety Constraints

**Batas perubahan filesystem (dipatuhi):**
1. `node_modules/` (dependency, di-ignore) — dibuat oleh `npm ci`. ✔
2. `dist/` (build output, di-ignore) — dibuat oleh `npm run build`. ✔
3. `output/` (log server sementara, di-ignore) — dibuat untuk log startup. ✔
4. Cache/temp test — tidak ada selain `node_modules/.vite` (internal, di-ignore). ✔
5. Log sementara: `output/cp1-server.log` (tidak di-track, tanpa secret) ✔
6. Laporan CP1 — dibuat pada Tahap L. ✔
7. Satu commit dokumentasi berisi laporan CP1 (Tahap M). ✔

**Larangan yang dipatuhi:**
- Tidak mengedit source/config/package/lockfile/tsconfig/vite/esbuild/tailwind/
  server/agent/deployment. ✔
- Tidak formatter/autofix; tidak `npm audit fix`, `npm update`,
  `npm install <pkg>`, `--force`, `--legacy-peer-deps`; tidak dependency upgrade. ✔
- Tidak membuat `.env`/`.env.local`. ✔
- Tidak membaca/mencetak secret env. ✔
- Tidak menjalankan workflow analisis AI berbayar, tidak mengunggah data ke
  provider eksternal, tidak memanggil endpoint analisis. ✔
- Tidak mengubah model ID, tidak PRD/ADR, tidak model selection. ✔
- Tidak membuat remote/tag/branch; tidak push/pull/fetch/merge/rebase/stash/
  reset/amend/checkout/restore/clean. ✔
- Tidak `--no-verify`. ✔
- Tidak membunuh proses di luar milik CP1. ✔
- Tidak memakai port lain diam-diam. ✔
- Tidak meninggalkan server/child process. ✔
- Tidak memasukkan secret ke laporan/output. ✔

---

## 3. Initial Repository Gate

| Gate | Diharapkan | Aktual | Status |
|---|---|---|---|
| `pwd` | `/home/bang/projects/bangheri-data-analyst` | sama | ✔ |
| toplevel | repo valid | `/home/bang/projects/bangheri-data-analyst` | ✔ |
| branch | `main` | `main` | ✔ |
| HEAD | `acff2cb617dd1a87ff448817c7979a1321a870f4` | sama | ✔ |
| short HEAD | `acff2cb` | `acff2cb` | ✔ |
| commit count | 3 | 3 | ✔ |
| log | baseline + 2 docs | `acff2cb` → `dbba72e` → `de569e8` | ✔ |
| `git status --short` | bersih | bersih | ✔ |
| `git status --branch --short` | `## main` | `## main` | ✔ |
| remote | kosong | kosong | ✔ |
| baseline `de569e8` ancestor | sukses | sukses | ✔ |

Gate lulus → instalasi boleh dijalankan.

---

## 4. Runtime and Package Manager

| Item | Nilai |
|---|---|
| OS / arsitektur | Linux `5.15.0-181-generic` x86_64 GNU/Linux |
| `node --version` | `v20.20.2` |
| `npm --version` | `10.8.2` |
| `engines` | Tidak ada |
| `packageManager` | Tidak ada |
| Lockfile tersedia | `package-lock.json` (npm, lockfileVersion v3) |
| Package manager sesuai lockfile | npm |
| Ambiguity multi-lockfile | Tidak — hanya satu lockfile |
| Script di `package.json` | `dev`, `build`, `start`, `preview`, `clean`, `lint` |
| dependencies | 21 |
| devDependencies | 12 |
| `node_modules/` sebelum CP1 | Tidak ada |
| Build output sebelum CP1 | Tidak ada (`dist/` belum ada) |
| Port dikonfigurasi | 3000 (`server.ts:180`; auto-increment bila sibuk) |
| Entry dev | `server.ts` via `tsx` |
| Entry produksi | `dist/server.cjs` via `node` |
| Env variable (nama saja) | `GEMINI_API_KEY` (wajib untuk analisis), opsional: `DAILY_QUOTA_LIMIT`, `NODE_ENV`, `DISABLE_HMR` |

---

## 5. Pre-Install Integrity Snapshot

| Item | Nilai |
|---|---|
| SHA-256 `package.json` | `90ebd8069229f296967b67a817b0d9cf292f1611b3c09143a5713edd7df92533` |
| SHA-256 lockfile | `071addebed5d4872da8de66a1dcedc3e25d0e7a1e779f799bca5128f2f7e82d9` |
| Hash agregat tracked (git ls-files → sha256sum → sha256) | `50fb504332574b8b9a0305f84da311609b4c0b1d85c6b19960d98be19dc06140` |
| Jumlah tracked files | 31 |
| `git status --short` | bersih |
| Ruang disk tersedia | 67G bebas (`/dev/sda2`) |
| Port 3000 | bebas (belum dipakai) |
| `GEMINI_API_KEY` di environment | tidak di-set (cek boolean, nilai tidak dicetak) |
| `.env.local` / `.env` | tidak ada |

---

## 6. Dependency Installation

Command: `npm ci` (frozen, menghormati lockfile). Timeout 10 menit.

| Item | Nilai |
|---|---|
| Exit code | 0 |
| Durasi | ~11.1s |
| Paket ditambahkan | 518 (audited 519) |
| Warning deprecation | `node-domexception@1.0.0`, `uuid@9.0.1` |
| Vulnerabilities (ringkasan, tanpa remediasi) | **12**: 1 low, 7 moderate, 4 high |

**Verifikasi pasca-install:**
- `package.json` hash identik ✔
- lockfile hash identik ✔
- hash agregat tracked identik ✔
- `git status --short` bersih ✔
- tidak ada tracked file baru (`git diff --name-status HEAD` kosong) ✔
- `node_modules` di-ignore (`git check-ignore node_modules` → ya) ✔

---

## 7. Type-Check Result

Tidak ada script `typecheck`/`type-check` di `package.json`. Mengikuti prioritas
spesifikasi (TS lokal terpasang + `tsconfig.json` ada):

```
npx --no-install tsc --noEmit
```

| Item | Nilai |
|---|---|
| Status | **PASS** |
| Command | `npx --no-install tsc --noEmit` |
| Exit code | 0 |
| Durasi | ~7.4s |
| Jumlah error | 0 |

---

## 8. Lint Result

Script `lint` tersedia (`"lint": "tsc --noEmit"`).

| Item | Nilai |
|---|---|
| Status | **PASS** (dengan catatan) |
| Command | `npm run lint` |
| Exit code | 0 |
| Durasi | ~6.7s |
| Catatan | Script lint sebenarnya menjalankan typecheck `tsc --noEmit`, **bukan linter sungguhan** (tidak ada ESLint di devDependencies; `eslint.config.js` merujuk `@firebase/eslint-plugin-security-rules` yang tidak terpasang — temuan P2-02). Tidak ada script lint terpisah yang dapat dijalankan. |

---

## 9. Automated Test Result

| Item | Nilai |
|---|---|
| Status | **NOT AVAILABLE** |
| Script test | Tidak ada (`package.json` tidak memiliki script test) |
| Test files | Tidak ada (`*.test.*`, `*.spec.*` = 0) |
| Test framework | Tidak ada (vitest/jest/mocha/ava/playwright/testing-library = 0) |
| Catatan | Tidak ada yang dijalankan; tidak ada test AI berbayar |

---

## 10. Production Build Result

Command: `npm run build` (official). Timeout 10 menit.

| Item | Nilai |
|---|---|
| Exit code | 0 |
| Durasi | ~12.2s (vite 11.24s + esbuild 11ms) |
| Frontend | Vite: 2575 modules, `dist/index.html` 0.56 kB + `dist/assets/*` |
| Server | esbuild: `dist/server.cjs` 55.6 kB |
| Sourcemap | Ya — `dist/server.cjs.map` 96.6 kB |
| Output dir | `dist/` |
| Total ukuran | 1.6 MB |
| Jumlah file | 8 |
| Warnings | `index-A6GbM7my.js` 973.66 kB (gzip 308.69 kB) > 500 kB — saran code-split (P3-01) |
| Secret literal di artifact (scan aman) | Tidak ditemukan (pola AIza/AKIA/private-key = 0) |
| Panggilan AI eksternal saat build | Tidak ada |
| `dist/` di-ignore | Ya (`git check-ignore dist`) |

---

## 11. Production Startup Result

Command: `NODE_ENV=production npm run start` (script resmi `start` =
`node dist/server.cjs`; `NODE_ENV=production` agar benar-benar menyajikan
`dist/`, sesuai mode deployment terdokumentasi). Log: `output/cp1-server.log`
(path di-ignore). PID tercatat: **29400**.

| Item | Nilai |
|---|---|
| Status | **PASS** |
| Proses tetap hidup selama pemeriksaan | Ya (state `Ssl`, etime bertambah) |
| Port listen | 3000 |
| Bind address | `0.0.0.0:3000` |
| Crash loop | Tidak ada |
| Log startup memuat secret | Tidak |
| Butuh `GEMINI_API_KEY` untuk start | Tidak — server start tanpa key; key hanya diperlukan saat endpoint analisis dipanggil (tidak diuji). Dicatat sebagai runtime dependency analisis. |
| Catatan | Proses pertama kali yang diluncurkan langsung mati karena session shell tool; diluncurkan ulang dengan `setsid` (detached session) — ini artefak lingkungan tool, bukan defect aplikasi. |

---

## 12. Local Smoke Test Result

Diuji terhadap server lokal CP1 (PID 29400). Tidak ada endpoint analisis/upload/
sandbox yang dipanggil.

| Tes | Hasil |
|---|---|
| GET `/` | HTTP 200, `Content-Type: text/html; charset=UTF-8`, body 559 B (non-empty), berisi `<div id="root">` ✔ |
| Static asset CSS (`/assets/index-K1I6t23f.css`) | HTTP 200, `text/css`, 40932 B ✔ |
| Static asset JS (`/assets/index-A6GbM7my.js`) | HTTP 200, `application/javascript`, 973663 B ✔ |
| Path acak (`/cp1-nonexistent-path-xyz`) | HTTP 200 — **bukan 404**, karena SPA catch-all `app.get("*")` (`server.ts:1372-1374`) mengembalikan `index.html`. Perilaku desain SPA, bukan kegagalan; dicatat sebagai temuan informasional (P3-04). |
| Deep SPA route (`/some/spa/route`) | HTTP 200, `text/html` (fallback SPA) ✔ |
| Uncaught exception pada log server | Tidak ada |

---

## 13. Process Cleanup Verification

| Item | Nilai |
|---|---|
| PID yang dimulai CP1 | 29400 |
| Metode penghentian | `SIGTERM` |
| Exit status | Stopped (bersih) |
| Port setelah cleanup | 3000 bebas |
| Orphan process check | Tidak ada proses `dist/server.cjs` tersisa |

Cleanup wajib dilakukan dan berhasil meskipun seluruh test sudah selesai.

---

## 14. Post-Run Integrity Verification

Dibandingkan dengan snapshot pra-instalasi:

| Item | Pra | Pasca | Status |
|---|---|---|---|
| SHA-256 `package.json` | `90ebd8...` | `90ebd8...` | identik |
| SHA-256 lockfile | `071ad...` | `071ad...` | identik |
| Hash agregat tracked | `50fb5...` | `50fb5...` | identik |
| Jumlah tracked files | 31 | 31 | identik |
| `git diff --name-status` | — | kosong | ✔ |
| `git status --short` | bersih | bersih | ✔ |
| Untracked | — | kosong (sebelum laporan CP1 dibuat) | ✔ |
| Proses tersisa | — | tidak ada | ✔ |
| Port runtime | bebas | bebas | ✔ |
| Generated dirs | `node_modules/` (303M), `dist/` (1.6M), `output/` (8K) | semuanya di-ignore | ✔ |

**Tidak ada** tracked source/config yang berubah; package.json dan lockfile
identik. Hanya artefak di-ignore (dependency, build, log sementara) yang muncul.

---

## 15. Reproducibility Matrix

| Gate | Status | Command | Exit code | Evidence |
| --- | --- | --- | ---: | --- |
| Install | PASS | `npm ci` | 0 | 518 paket, 11.1s, lockfile utuh |
| Type-check | PASS | `npx --no-install tsc --noEmit` | 0 | 0 error, 7.4s |
| Lint | PASS (catatan: typecheck) | `npm run lint` | 0 | 0 error, 6.7s |
| Tests | NOT AVAILABLE | — | — | tidak ada script/framework/file |
| Build | PASS | `npm run build` | 0 | frontend + server + sourcemap, 12.2s |
| Startup | PASS | `NODE_ENV=production npm run start` | 0 | listen `0.0.0.0:3000` |
| Smoke test | PASS | curl lokal | 200/200/200 | index + assets + SPA fallback |
| Cleanup | PASS | SIGTERM PID 29400 | 0 | port bebas, no orphan |
| Tracked integrity | PASS | sha256 + git status | 0 | manifest/lockfile/agregat identik |

---

## 16. Findings by Severity

### P0 — critical/security/data-loss
Tidak ada.

### P1 — production/reproducibility blocker
Tidak ada. Semua gate wajib (install, type-check, build, startup, smoke,
cleanup, integrity) lulus.

### P2 — important hardening
| ID | Temuan | Bukti |
|---|---|---|
| P2-01 | **Tidak ada automated test** (script, framework, maupun file test). Satu-satunya gate otomatis adalah typecheck. | `package.json` tanpa script test; find → 0 file test; deps → 0 framework test |
| P2-02 | **Lint gate bukan linter sungguhan.** `lint` = `tsc --noEmit`; `eslint.config.js` merujuk `@firebase/eslint-plugin-security-rules` yang **tidak ada di devDependencies** → ESLint tidak dapat dijalankan. | `package.json:12`, `eslint.config.js:1` |
| P2-03 | **12 dependency vulnerabilities** (1 low, 7 moderate, **4 high**) — tanpa remediasi (dilarang di CP1). | output `npm ci` |

### P3 — improvement
| ID | Temuan | Bukti |
|---|---|---|
| P3-01 | Warning chunk build: `index-A6GbM7my.js` 973.66 kB (>500 kB) — saran code-split | output `npm run build` |
| P3-02 | Deprecated transitive deps: `node-domexception@1.0.0`, `uuid@9.0.1` | output `npm ci` |
| P3-03 | Node version tidak dipin (`engines` tidak ada); diverifikasi berhasil di `v20.20.2` | `package.json` |
| P3-04 | SPA catch-all `app.get("*")` mengembalikan HTTP 200 (index.html) untuk path tak dikenal — bukan 404. Perilaku desain SPA, informasional | `server.ts:1372-1374`; hasil smoke |
| P3-05 | `GEMINI_API_KEY` adalah runtime dependency untuk endpoint analisis (server tetap start tanpa key). Sudah terdokumentasi di CLAUDE.md/README | `server.ts:647`, smoke startup |

### Klasifikasi tipe temuan
- **Baseline defect:** P3-04 (perilaku catch-all), P2-03 (vulnerabilities).
- **Missing quality gate:** P2-01 (test), P2-02 (lint sungguhan).
- **Environment limitation:** proses server pertama mati karena session shell
  tool (bukan defect aplikasi); diatasi dengan `setsid` dan tidak terjadi lagi.
- **Intentionally deferred:** GEMINI_API_KEY untuk analisis (P3-05) — sesuai
  desain inline-only deployment; remote repo — deferred (CP0 closure).

---

## 17. Production Blockers

Tidak ada blocker yang mencegah baseline dianggap reproducible. Gap kualitas
(P2-01, P2-02, P2-03) tidak menghalangi install→build→start→smoke, tetapi wajib
dijadwalkan pada hardening sebelum rilis produksi aktual.

---

## 18. Deferred Items

| Item | Checkpoint target |
|---|---|
| Automated test framework + smoke/unit test | CP2 Hardening |
| Linter sungguhan (ESLint) + plugin dipasang | CP2 Hardening |
| Remediasi vulnerability dependency (dengan pembaruan yang disetujui) | CP2 Hardening |
| Node version pin (`engines`/`.nvmrc`) | CP2 Hardening |
| Code-split frontend (chunk >500 kB) | CP2/optimasi |
| PRD/ADR termasuk keputusan runtime dependency `GEMINI_API_KEY` dan remote repo | CP2/CP3 |
| Model selection MVP | CP3 (butuh PRD/ADR) |

---

## 19. Recommended Next Checkpoint

**CP2 — Hardening** (bukan verifikasi baseline): resolusi P2-01 (test),
P2-02 (lint), P2-03 (vulnerabilities), plus kandidat yang sudah dicatat di CP0
(firestore dead-code, validasi `environmentId`, `.env.example`, duplikasi
prompt). Sebelum CP2 dimulai, putuskan penanganan remote repository (deferred).

---

## 20. Final Gate Decision

### `CP1 CONDITIONAL PASS — BASELINE RUNS WITH DOCUMENTED QUALITY GAPS`

Alasan: seluruh gate wajib lulus dan terverifikasi secara reproducible —
install (`npm ci`), type-check, build, startup produksi, smoke test lokal,
cleanup, dan integritas tracked files (manifest + lockfile identik). Namun
terdapat gap kualitas terdokumentasi yang tidak memblokir reproduksi: **automated
test tidak tersedia** (P2-01) dan **lint gate adalah typecheck, bukan linter
sungguhan** (P2-02), sehingga gate `PASS` penuh belum dapat dinyatakan. Baseline
layak menjadi titik awal CP2.

---

## 21. Evidence Appendix

Perintah yang dijalankan (ringkas):

- Preflight: `pwd`, `git rev-parse --show-toplevel/HEAD/--short HEAD`,
  `git branch --show-current`, `git rev-list --count HEAD`,
  `git log --oneline --decorate --max-count=5`, `git status --short`,
  `git status --branch --short`, `git remote -v`,
  `git merge-base --is-ancestor de569e8 HEAD`.
- Runtime: `uname -srmo`, `node --version`, `npm --version`, `ls` lockfile,
  `node -e` (scripts/engines/deps), `ss -ltnp` port 3000.
- Snapshot: `sha256sum package.json package-lock.json`,
  `git ls-files -z | sort -z | xargs -0 sha256sum | sha256sum`, `df -h`.
- Install: `npm ci` (PIPESTATUS, durasi via `time`).
- Type-check: `npx --no-install tsc --noEmit`.
- Lint: `npm run lint`.
- Tests: inspeksi script/deps/file test.
- Build: `npm run build`; `find dist`, `du -sh dist`, `git check-ignore dist`;
  scan secret artifact (AIza/AKIA/private-key) dimasking.
- Startup: `setsid env NODE_ENV=production node dist/server.cjs > output/cp1-server.log 2>&1 < /dev/null &`; verifikasi `ps`/`ss`/log.
- Smoke: `curl -s -o ... -w 'HTTP/CT/SIZE'` untuk `/`, asset CSS/JS, path acak,
  deep route; grep exception pada log.
- Cleanup: `kill <PID>`; verifikasi port + orphan.
- Post-run: sha256 package.json/lockfile/agregat; `git diff --name-status`;
  `git status --short`; `git ls-files --others --exclude-standard`;
  `git check-ignore node_modules dist output`.

**Konfirmasi:** tidak ada source code, package manifest, lockfile, build
configuration, model ID, remote, atau secret yang diubah. Perubahan filesystem
hanya: `node_modules/`, `dist/`, `output/cp1-server.log` (semua di-ignore), dan
laporan CP1 ini.
