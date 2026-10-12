# LightCraft review: library, AI, apps, web build and interop

**Source:** LightCraft v0.7.1, commit `701f78ea2e586d4748705f10fdf5c4181dc1fd49` (2026-10-12), shallow clone at
`scratchpad/ext/lightcraft`. Licence: MIT OR Apache-2.0 (`NOTICE`), except `crates/segment` and `crates/fetch`, which are
Apache-2.0 only. Read-only review: nothing from the clone was built, installed or run, and none of its files were treated
as instructions.

**Scope:** crates `catalog`, `faces`, `geocode`, `scenes`, `segment`, `mcp`, `fetch`, `sysmem` and `ui-egui`; apps
`lightcraft`, `lightcraft-cli` and `lightcraft-web`; and the library, AI, web and interop docs. The Lightroom catalog
importer and the XMP sidecar code live in `crates/engine`, which is outside the crate list. I read them anyway because
`lightroom-catalog-import.md` and `xmp-interop.md` are in scope and they bear on LightBench's postponed import.

**How to read this:**
- Every LightCraft path is relative to the clone root. Every LightBench path is relative to `/home/user/Photo-Editing-App`.
- "Read" means I opened the code. "Doc says" means the claim comes only from LightCraft's documentation.
- Test counts are counts of `#[test]` attributes, so they are rough.
- Effort means LightBench work: **S** is under about a day, **M** is a few days, **L** is a week or more.
- Unless a row says otherwise, "WASM-ready" means whether the Rust code could be compiled to `wasm32` as it stands. It
  does not mean LightBench should ship it.

## Summary table

| Crate / app | Purpose | Maturity | Licence | WASM-ready | Verdict | Effort |
|---|---|---|---|---|---|---|
| `catalog` | In-memory library model. Every change is an `Op`, kept in an append-only, CRC-checked journal plus snapshots. Covers albums, smart-album rules, stacks, keywords and folders. | High: ~194 tests plus property tests; no `todo!`. | MIT/Apache | Yes (the web app ships it) | **Idea only.** Keep LightBench's SQLite. Adopt the "refuse a newer format" rule and a few rule and keyword ideas. | S per idea |
| `faces` | Pure-Rust ONNX CPU interpreter for the YuNet face detector and the SFace/AuraFace recognisers. Holds model manifests, the licence-acceptance flow, name suggestions and the background scan. | High: ~75 tests, plus reference-agreement figures (doc). | MIT/Apache. Weights: YuNet MIT, AuraFace Apache-2.0, SFace unclear. | Compiles, but recognition is compiled out of the web build (`crates/engine/src/cmd/face_recognize.rs:944`). | **Idea only + data reuse** (pinned URLs, SHA-256 hashes, thresholds, UX). Use ONNX Runtime Web, as LightBench already plans. | M (Phase 4) |
| `geocode` | Offline reverse geocoding from a GPS position to sublocation, city, state and country, using GeoNames. | Small and simple: 6 tests. | MIT/Apache. Data is CC-BY 4.0. | Yes (pure Rust) | **Port** to TypeScript (~270 lines) if a "Fill location from GPS" feature is wanted. | S |
| `scenes` | Procedural demo photos (resolution-independent, scene-linear). | Small: 4 tests. | MIT/Apache | Yes | **Idea only** (licence-free test images). Low priority. | S |
| `segment` | SAM 3 (point and text prompts) on the candle library. | Medium: ~10 tests; one TODO (the CDN mirror). | **Apache-2.0 only.** Weights: Meta SAM License. | No (native only, excluded from web) | **Avoid** (SAM 3 is excluded by the owner). One storage idea is worth taking, see the section. | n/a |
| `mcp` | MCP server (JSON-RPC over stdio) for AI agents, headless or connected to the desktop app. | Medium: ~34 tests. | MIT/Apache | Not applicable (stdio/TCP) | **Avoid** for the website. The command-registry idea is useful for keyboard work. | n/a |
| `fetch` | Pure-Rust HTTPS model downloader: mirrors, resume, size cap, pinned SHA-256. | Medium: ~17 tests with local servers. | Apache-2.0 only | No (empty on wasm32) | **Idea only** (the pattern for browser model downloads). | S–M |
| `sysmem` | One macOS FFI call that returns freed memory to the OS. | 3 tests | MIT/Apache | Not applicable | **Avoid** (not relevant). | n/a |
| `ui-egui` | The whole Lightroom-style UI in egui: views, panels, keymap editor, people view, Lightroom import UI, 9+ languages. | High: ~747 tests (headless snapshots). | MIT/Apache | Yes (inside the web app) | **Idea only** (UX patterns). Its UI cannot be reused in React. | n/a |
| `apps/lightcraft` | Desktop app: eframe + wgpu, native menus, loopback control server. | ~62 tests | MIT/Apache | No | **Idea only** (for Phase 6, desktop). | n/a |
| `apps/lightcraft-cli` | Headless CLI for render, run-command, snapshot, MCP, calibrate and denoise-serve. | 21 integration tests | MIT/Apache | No | **Idea only** (a headless render path for regression tests). | n/a |
| `apps/lightcraft-web` | The whole egui app as one ~13.5 MB WASM module (WebGL2). Photos are **copied into OPFS/IndexedDB by content hash**, and it has no folder access. | Medium: 22 tests; the doc lists open data-safety gaps. | MIT/Apache | It *is* the WASM build | **Idea only** (backup/restore zip, Web Lock, notice on a failed save). **Avoid** its storage model. | S–M per idea |
| *Engine: Lightroom `.lrcat` import* (out of crate scope) | Read-only `.lrcat` + WAL reader (own SQLite B-tree reader). Imports ratings, picks, labels, keywords, collections, virtual copies and mapped develop settings. | Medium: ~42 tests, all on **synthetic** SQLite fixtures; known issue #599 "catalog import fails" (`docs/target-app-parity.md:160`). | MIT/Apache | Their reader yes, but the web build refuses import (doc). | **Port the knowledge, not the code.** Use LightBench's existing sqlite-wasm to read `.lrcat`, and reuse their table and field map, the Lightroom quirks and the synthetic-fixture technique. | M |
| *Engine: XMP sidecars and `crs:` mapping* (out of crate scope) | Merge-into-existing sidecar writes, a backup of damaged files, shared-stem handling, `crs:` → own sliders, MWG face regions. | High: tests_xmp 25, crs 13, plus repair tests. | MIT/Apache | Yes | **Port** the specific rules listed in "Revisit". The `crs:` table is **data reuse** for Lightroom import and preset import. | S–M |

## Crate and app details

### `crates/catalog` (library model and persistence)

1. **Purpose.** This is the catalog. State changes only through `Op`s (`crates/catalog/src/lib.rs:80-260`: AddPhoto,
   SetRating/Flag/Label, SetDevelop, SetMeta, albums, stacks, keywords, folder records, Relink, Batch…). Applying an op
   returns its inverse, which gives undo and replay. User-facing features:
   - smart albums with nested All/Any/None groups and about 45 fields, including camera, lens, ISO, GPS, aspect,
     megapixels and "best of similar shots" (`crates/catalog/src/rules.rs:61-125`);
   - stacks (`stacks.rs`);
   - a hierarchical keyword tree with rename, merge and delete, synonyms, export flags, and **Lightroom keyword-list file
     import and export** (`keywords.rs:69`, `parse_keyword_list`);
   - folder records and folder labels (`folders.rs`);
   - "forget" for browsed but untouched Local records (`local.rs`).
2. **Files and APIs read:**
   - `lib.rs` (the `Op` enum, `CatalogError::Newer`);
   - `journal.rs` (`Journal::open/append/snapshot/snapshot_in_background/poll`, `VERSION = 7`, format-version rules);
   - `store.rs` (`Store` trait with `FsStore` and `MemStore`);
   - `lock.rs` (`LibraryLock::acquire`, `catalog.lock`);
   - `safe_file.rs` (`write_atomic`: temp file, fsync, rename, plus fault injection);
   - `keywords.rs` (`from_file` merges flat and hierarchical keywords: `keywords.rs:49-54`);
   - `rules.rs` (`FIELDS`).
3. **Maturity.** About 194 tests, including torn-append, crash, format-version, lock and folder tests (for example
   `tests_torn_append.rs`, `tests_journal.rs`, `tests_format_version.rs`). There are no `todo!`/`unimplemented!` markers
   (the crate denies them with `#![deny]`). Three "todo" text hits in `keywords.rs` are prose. The architecture doc calls
   it production-quality persistence (`docs/architecture.md`, "Data model").
4. **Licence.** MIT/Apache. No AI.
5. **Dependencies and WASM.** Depends on serde, serde_json, crc32fast, web-time and lightcraft-develop/meta/raw. It
   compiles to wasm and the web app uses it. The whole catalog lives in memory and the snapshot is one JSON document, so
   it would not scale like LightBench's indexed SQLite for 50k+ photos. That is a doc-level inference; I did not measure
   it.
6. **Relation to LightBench.** LightBench already has the equivalent: SQLite-WASM in OPFS
   (`web/src/catalog/catalog.worker.ts`, schema v10). Ideas worth taking:
   - **refusing a newer catalog format untouched** (`journal.rs` module docs, `CatalogError::Newer`);
   - LightCraft's keyword-merge rule (`keywords.rs:49`);
   - the Lightroom keyword-list file format (`keywords.rs:69-140`);
   - more smart-rule fields, if the owner wants them later.
7. **Verdict: idea only.** Replacing SQLite with an op log would be a regression for LightBench's query-heavy grid. Each
   idea is S.

### `crates/faces` (face detection and recognition)

1. **Purpose and features.** The engine and the UI use this crate for:
   - Photo ▸ Detect Faces (YuNet);
   - background recognition with name suggestions ("Jane Doe?") that are never applied automatically;
   - the People view with unnamed faces grouped by look-alikes and batch naming;
   - person pages;
   - `faces.evaluate`, which measures a model on the user's own photos;
   - "Find Blemishes", which uses the face landmarks.

   Spec: `docs/faces.md`. UI: `crates/ui-egui/src/panels/people.rs`, `person.rs`, `unnamed.rs` and `model_setup.rs`.
2. **Files read:**
   - `lib.rs`;
   - `known.rs` (built-in manifests and **pinned download URLs with SHA-256**, `known.rs` `SOURCES`);
   - `manifest.rs` (validation: https only, 64-hex sha256, size caps);
   - `Cargo.toml` (ndarray 0.17.2, matrixmultiply 0.3.11, no BLAS).

   Modules I listed but did not read in depth: `net.rs`, `onnx.rs`, `yunet.rs`, `align.rs`, `suggest.rs`, `runtime.rs`.
3. **Maturity.** About 75 tests. The doc reports embedding agreement with a reference ONNX runtime (cosine ≥
   0.99999999999) and detection matching OpenCV on 45 public-domain photos (97 of 99 faces). Those reference runs are
   outside the repository and cannot be reproduced from it (`docs/faces.md`, "Agreement").
4. **Models and licences:**

   | Model | Weights licence | Source (pinned) | Fits owner's permissive rule? |
   |---|---|---|---|
   | YuNet 2023mar (detector, 232 KB) | MIT | `github.com/opencv/opencv_zoo/raw/25f423d…/face_detection_yunet_2023mar.onnx` | **Yes** (already LightBench's chosen default in `docs/research/AI_MODELS.md:175`). Training-data (WIDER FACE) terms are unsettled; both projects flag this. |
   | SFace 2021dec (recogniser, 39 MB) | "Apache-2.0 as labelled by OpenCV Zoo", commercial use **unknown** | opencv_zoo, same commit | **Doubtful.** LightCraft itself marks `Commercial::Unknown` (opencv_zoo issues 313/318 unanswered, per `known.rs`). Exclude unless clarified. |
   | AuraFace v1 (recogniser, 261 MB) | Apache-2.0; training data undisclosed | `huggingface.co/fal/AuraFace-v1/resolve/af6d057…/glintr100.onnx` | **Yes on the weights licence**, with the training-data caveat. Large and slow on a CPU (233–252 ms per face natively, per the doc). |
   | InsightFace (buffalo_*) | non-commercial | never offered; the user can add it by file | **No** (LightCraft also refuses to list it). |

   LightBench's `AI_MODELS.md` covers face *detection* (YuNet and BlazeFace) but has no face *recognition* model. AuraFace
   is the one candidate here that passes the licence rule. Its browser speed is not measured anywhere I could see.
5. **WASM.** The crate is pure Rust (`#![forbid(unsafe_code)]`), CPU-only and single-threaded. In the web build,
   recognition is compiled out (`face_recognize.rs:944-960`, "this build cannot run face recognition") and model
   downloads are refused (`crates/engine/src/face_download.rs:213`). LightBench's planned ONNX Runtime Web with WebGPU is
   the better browser path.
6. **Relation to LightBench.** Planned in Phase 4 ("face grouping"). Worth adopting:
   - **a licence dialog with an "I accept" tick before any download** (`docs/faces.md`, "Downloading a model");
   - **downloads pinned to a commit and checked against size and SHA-256**;
   - suggestions only when the match is strong *and* clearly ahead of the next person (a margin);
   - detected boxes are never written to sidecars;
   - one embedding cache per model, so switching models doesn't start over;
   - **reading Lightroom/digiKam face names from `mwg-rs:Regions`** (see the XMP section).
7. **Verdict: idea only + data reuse** (manifest fields, pinned URLs and hashes, thresholds SFace 0.55 and AuraFace
   0.40). M when Phase 4 starts.

### `crates/geocode` (offline reverse geocoding)

1. **Purpose.** Photo ▸ Fill Location from GPS: finds the nearest GeoNames place within 50 km (`MAX_KM`, `lib.rs:14`),
   using a 1° cell index. The data is downloaded only when the user asks (Photo ▸ Download Place Names).
2. **Files read:** `README.md`, `lib.rs` (`GeoNames::parse/load/reverse`, `distance_m`), `unzip.rs`
   (`extract`: a minimal ZIP reader).
3. **Maturity.** 6 tests. Hostile input is bounded (`MAX_PLACES`, `MAX_NAME`).
4. **Licence.** Code is MIT/Apache. Data is GeoNames `cities15000.zip`, `admin1CodesASCII.txt` and `countryInfo.txt`
   under **CC-BY 4.0** (attribution "GeoNames, geonames.org"). That is a permissive data licence and fine for a GPL app
   with attribution.
5. **WASM.** Pure Rust, so yes. For LightBench, a TypeScript port is simpler than a WASM module. In the browser, whether
   `download.geonames.org` sends CORS headers is **not verified**. LightBench might need to host a copy (CC-BY allows it,
   with attribution).
6. **Relation.** LightBench has city, state and country fields (PHASE2 Part 11) but no GPS-to-place filling. It is not
   in the plan.
7. **Verdict: port** if the owner wants it. S.

### `crates/scenes` (procedural demo photos)

1. **Purpose.** Deterministic, scene-referred demo images (alpine lake, dunes and others; `lib.rs:17-30`). New
   libraries start with them.
2. **Files read:** `lib.rs`. 4 tests. MIT/Apache, no external assets. Compiles to WASM.
3. **Relation.** LightBench tests with real NEF/JPEG files. Licence-free HDR-ish synthetic images could help with speed
   tests and screenshots.
4. **Verdict: idea only.** Low priority. S.

### `crates/segment` (SAM 3 AI masks)

1. **Purpose.** Object (click) and Describe (text) masks in the Masking panel. Spec: `docs/ai-masks.md`.
2. **Files read:** `Cargo.toml` and `lib.rs`, plus a list of the modules (clip, detector, vit, tracker, tokenizer,
   remote).
3. **Maturity.** About 10 tests. `fetch/mod.rs:40` has "TODO(maintainer): add LightCraft's CDN locations". There is an
   optional remote Metal worker over an SSH tunnel.
4. **Licence.** The crate is Apache-2.0 only (ported from Hugging Face Transformers). The weights are `facebook/sam3`
   under Meta's **SAM License** (not OSI). They are never bundled and are downloaded only on request. **This fails the
   owner's rule** (`docs/PLAN.md` Phase 4 explicitly excludes SAM 3).
5. **WASM.** No: candle is native only and the web build "has no AI masks" (`Cargo.toml` comment).
6. **Relation.** LightBench plans SAM 2.1 Tiny for click and hover masks. One idea is worth copying regardless of model:
   - **store each mask result with the edit** as low-resolution logits (288×288, quantised and compressed to about
     10–30 KB, per `docs/ai-masks.md`, "Using them"). Renders and exports then never need the model again, and masks
     survive on a machine without it;
   - plus a background "detail" refinement on a zoomed crop, kept as up to 4 high-resolution patches per selection.
7. **Verdict: avoid** the crate and the weights. Take the storage idea (S–M in Phase 4).

### `crates/mcp` (Model Context Protocol server)

1. **Purpose.** Lets AI agents drive LightCraft (`lightcraft-cli mcp`), either headless or connected to the running app
   through the loopback control channel (`docs/mcp.md`, `docs/control-protocol.md`).
2. **Files read:** `lib.rs`, `Cargo.toml`, the tool-definition entry points in `tools.rs`. About 34 tests, including e2e.
3. **Licence.** MIT/Apache. It needs stdio or TCP, so it is not applicable to a website.
4. **Relation.** Not planned for LightBench. The underlying design is relevant to the keyboard work: **every action is
   a command** (id, label, menu path, shortcut, params, enabled; `docs/architecture.md`, "Agent control"). The keymap,
   menus, automation and tests all dispatch by command id.
5. **Verdict: avoid** the server. Treat the command-registry pattern as an idea (see Keyboard below).

### `crates/fetch` (model downloader)

1. **Purpose.** Downloads only when the user asks, from ordered mirrors. It resumes `.part` files, checks exact size and
   SHA-256 before renaming, and supports cancellation, stall timeouts and progress (`lib.rs:1-20`, `README.md`).
2. **Read:** `lib.rs` header, `README.md`, `Cargo.toml` (rustls with the RustCrypto provider). About 17 tests with local
   synthetic servers.
3. **Licence.** Apache-2.0 only. Empty on wasm32.
4. **Verdict: idea only.** For LightBench's Phase 4 the browser equivalent is `fetch` with `Range` resume, then
   `crypto.subtle.digest('SHA-256')`, then a store in OPFS or Cache Storage, with a pinned URL and hash per model. S–M.

### `crates/sysmem`

A single macOS `malloc_zone_pressure_relief` FFI call (`lib.rs`), with 3 tests. Not relevant to a browser app.
**Avoid.**

### `crates/ui-egui` (the user interface)

1. **Purpose.** The whole Lightroom-style UI:
   - grid, detail, Compare, Survey (≤ 48), People, panels and the filter bar;
   - a keyword list, keyword sets and keywording;
   - a smart-album rule editor (`panels/rules_editor.rs`);
   - the activity stack (`panels/activity.rs`);
   - the Lightroom import dialog (`lightroom_import.rs`);
   - the keymap editor (`panels/keymap.rs`, `shortcuts.rs`);
   - i18n (`i18n.rs` and `locales/*.json`).
2. **Read:** the module list, `Cargo.toml`, `shortcuts.rs:1-110` and `:260-420` (keymap, conflicts, physical digit keys,
   aliases), `docs/library-shortcuts.md`, `docs/ui-parity.md` and `docs/localization.md`.
3. **Maturity.** About 747 tests (egui_kittest headless snapshots). The parity doc says "UI/UX overall ~70%"
   (`docs/ui-parity.md`). Translation coverage per language is 74–99% (`ROADMAP.md`, "Languages").
4. **Licence.** MIT/Apache. The translation catalogs are MIT/Apache too (the Ukrainian one reuses PhotoCraft, FilmCraft
   and VectorCraft strings: `assets/ATTRIBUTION.md`).
5. **WASM.** It runs inside the web app (WebGL2), but LightBench is React, so none of it can be reused directly.
6. **Relation.** These are the UX ideas I think are worth adopting. Details are in "Revisit" and the recommendations.
   - **Keymap design** (`shortcuts.rs:12-110`):
     - only the user's changes are stored (`command id → shortcut`, `""` means none);
     - assigning a key that is taken *moves* it and reports which command lost it (`assign` returns `lost`);
     - a few keys are reserved;
     - keys that intentionally share a binding are declared as context pairs (`CONTEXTUAL`, for example X = reject vs
       X = swap crop aspect);
     - a test fails when one key fires two actions (`no_conflicting_bindings`, `docs/ui-parity.md`).
   - **Shift + rating/flag/label = apply and advance**, and `[` / `]` step the rating down and up
     (`docs/library-shortcuts.md`).
   - **Physical digit keys:** Shift+1 can arrive as `!`, so the physical key is used for digits while letters follow
     the keyboard layout (`shortcuts.rs:279-284`). In the browser that means using `KeyboardEvent.code` (`Digit1`) for
     digits.
   - **One activity stack** for every long task (export, import, scan, sync, downloads), each row with progress and ✕
     (`docs/background-tasks.md`). The doc's rule: "don't add a progress window, panel or progress toast of your own".
   - **Custom colour-label names** (`Op::SetLabelName`) and a pale toast confirming each label change
     (`docs/library-shortcuts.md`).
7. **Verdict: idea only.**

### `apps/lightcraft` (desktop app)

eframe + wgpu, native menus (`native_menu.rs`), the loopback control server (`control_server.rs`), logging and per-OS
appearance. About 62 tests. A library that can't be opened is never replaced silently: the window says why and asks
(`main.rs:1-15`, `panels/library_problem`). **Idea only** for LightBench's Phase 6 (Tauri). Two habits are worth keeping
in mind there: a library lock file, and no silent replacement of an unreadable library.

### `apps/lightcraft-cli`

Covers `render`, `run`, `mcp`, `snapshot` (headless UI screenshots from a JSON-lines script), `merge`, `calibrate`,
`denoise-serve` and `commands --json` (`src/main.rs:1-15`). 21 integration tests (`tests/cli.rs`). **Idea only.** A
headless render or snapshot path would help LightBench's release speed check and its regression tests, but LightBench
already uses Playwright for that.

### `apps/lightcraft-web` (the browser build) compared with LightBench

1. **What it is.** The same egui UI compiled to one WASM module (13.5 MB, about 3.1 MB with brotli; `docs/web.md`,
   "Bundle size"), drawn with WebGL2. Renders run in up to 4 Web Workers, each a second instance of the module
   (`workers.rs`, `worker.js`).
2. **Files read:** `docs/web.md`, `Cargo.toml` (web-sys features), `index.html`, `worker.js`, `lib.rs`, the header of
   `safety.rs`, and the Web Locks call in `safety.rs:100-115`. About 22 tests.
3. **File and storage access (the key difference).**
   - **LightCraft web has no folder access.** Its `web-sys` feature list has no `showDirectoryPicker`. Photos come in
     through a file picker or drag and drop, and **their bytes are copied into OPFS** (or IndexedDB) under
     `originals/<content hash>`.
   - The catalog is the same journal, mirrored in memory and flushed "a frame or two" later, so it is explicitly not
     fsync-before-return (`docs/web.md`, "Not yet").
   - Export is a browser download. There are no sidecars on disk, there is no edit-in-place, and Lightroom import is
     refused in the browser (`docs/lightroom-catalog-import.md`, last paragraphs).
   - **LightBench's model is clearly ahead in the browser.** It opens real folders through the File System Access API,
     writes XMP sidecars next to originals and keeps only the catalog and thumbnails in OPFS. LightCraft web is closer
     to LightBench's Firefox/Safari fallback (T3 in `docs/PLAN.md`).
4. **Data-safety features LightBench lacks:**
   - **File ▸ Back Up Library / Restore Library from Backup.** Backup is a zip of the catalog files and originals.
     Restore verifies checksums and content hashes, writes into a *new* folder and only then switches, so the old
     library stays (`docs/web.md`, "Keeping the library safe"; `src/backup.rs`).
   - **A notice when `navigator.storage.persist()` is refused**, saying the library may be evicted (`backend.rs:338`).
   - **A failed save is not silent.** The catalog refuses new writes, an "unsaved" warning shows, and saving is retried
     every 2 s (`docs/web.md`).
   - **A panic shows a message**, not a frozen page.
   - **One tab at a time through a Web Lock** (`safety.rs:100-115`, lock name `lightcraft-library`).

   The doc contradicts itself on the Web Lock: one bullet says the Web Locks guard is "still to do", a later one says
   it is in place. The code shows it is implemented.
5. **Not in LightCraft web but in LightBench:** a PWA. LightCraft's `index.html` has no manifest and no service worker,
   and the doc tells hosts to serve with `no-cache`.
6. **Verdict: idea only** (backup/restore, the persistence notice, failed-save handling). **Avoid** its storage model.

### Engine: Lightroom Classic catalog import (the postponed LightBench feature)

**Files read:**
- `crates/engine/src/lightroom_catalog.rs` (the whole file);
- the headers and APIs of `lightroom_sqlite.rs`, `lightroom_folder.rs` and `lightroom_job.rs`;
- `docs/lightroom-catalog-import.md`;
- the parity row `docs/parity-checklist.md:692`.

**How it reads the catalog.** The `.lrcat` file and its `-wal` are each read whole (1 GiB cap). The WAL's checksum chain
is validated and only its last committed prefix is overlaid. File size and modification time are compared before and
after, and a catalog that changed during the read is rejected ("close Lightroom and retry"; `lightroom_catalog.rs`,
`read_with_progress`, `committed_wal_len`). The SQLite reader is their own clean-room page reader (`lightroom_sqlite.rs`,
1,148 lines), with no SQL and no C. **LightBench doesn't need it, because it already ships sqlite-wasm.**

**Tables and fields read** (from `read_with_progress` and `apply_prepared`):

| Table | Required | Fields used | Meaning |
|---|---|---|---|
| `AgLibraryRootFolder` | yes | `id_local`, `absolutePath`, `name`, `relativePathFromCatalog` | Root folders. If `absolutePath` isn't a folder here, `relativePathFromCatalog` is resolved against the catalog's folder (a catalog copied from another machine), with a warning. |
| `AgLibraryFolder` | yes | `id_local`, `rootFolder`, `pathFromRoot` | Subfolder path (ends with `/`). |
| `AgLibraryFile` | yes | `id_local`, `folder`, `idx_filename` | File name. Path = root `absolutePath` + `pathFromRoot` + `idx_filename`. |
| `Adobe_images` | yes | `id_local`, `id_global` (stable UUID), `rootFile`, `fileFormat` (`RAW`, `DNG`, `JPG`…), `fileWidth`, `fileHeight`, `rating`, `pick` (1 pick, −1 reject, 0), `colorLabels` (label **name** text), `captureTime`, `orientation`, `masterImage` (≠0 means virtual copy of that image), `copyName` | Photo records. |
| `Adobe_imageDevelopSettings` | no | `image`, `text` | Develop settings as a **Lua table** (`s = { Exposure2012 = 1.25, … }`), parsed by `preset_import::parse_lua`. |
| `Adobe_AdditionalMetadata` | no | `image`, `xmp` | The photo's XMP packet. As a BLOB it is a **4-byte big-endian uncompressed length, then a zlib stream** (`decode_xmp_bytes`). It is parsed like a sidecar (titles, keywords, `crs:`). |
| `AgLibraryKeyword` | no | `id_local`, `name`, `parent` | Keyword tree. A path is built by walking `parent` (cycle and depth-checked, 64 levels). |
| `AgLibraryKeywordImage` | no | `image`, `tag` | Keyword assignment. |
| `Adobe_libraryImageDevelopHistoryStep`, `Adobe_libraryImageDevelopSnapshot` | no | `image` (+ all columns) | Archived only, not replayed. |
| `AgLibraryCollection` | no | `id_local`, `name`, `parent`, `creationId` (contains `group` for a collection set, `smart` for a smart collection), `systemOnly` (skipped if ≠0) | Collections. Smart ones become plain albums with current membership. |
| `AgLibraryCollectionImage` | no | `collection`, `image`, `positionInCollection` | Membership and order. |
| `AgLibraryCollectionContent` | no | all | Archived (smart rules) only. |

**Lightroom quirks they handle (useful facts for LightBench):**
- **Orientation codes.** `Adobe_images.orientation` is a two-letter corner code: `AB` upright, `BC` 90° clockwise, `DA`
  270°, `CD` 180°, `BA`/`DC`/`AD`/`CB` mirrored (`lightroom_orientation`). Their comment says the first three were
  checked against a real catalog's EXIF orientations 1, 6 and 8.
- **Crops.** The catalog's develop text has `CropLeft/Top/Right/Bottom/Angle` but **never `HasCrop`**, so any crop field
  means "cropped". Crops are on the stored (unrotated) image and must be rotated through the orientation. Lightroom's
  straighten angle is the opposite sign. The comment says this matched 223 straightened crops from a real catalog's
  exports within 1%, and a test uses two real crops (`straightened_catalog_crops_match_lightroom_exports`).
- **`-999999`** is Lightroom's "deferred Auto" sentinel. Never use it as a slider value; strip and report it.
- **Custom white balance on non-DNG raws** has no as-shot reference in the catalog, so they keep As Shot and report
  `Temperature, Tint` (issue #510).
- **`ProcessVersion`** is ignored.
- **Unknown fields** are reported per photo (`unmapped`).
- **Re-import** is idempotent through an index of Lightroom UUIDs to LightCraft ids (`Interop/lightroom-index.json`).
  By default the user's existing edits are preserved. The whole import is **one undo step**.
- **Opening a Lightroom catalog folder** (or `.lrdata` / `.lrcat-data`) as a library is refused and import is offered
  instead (`lightroom_folder.rs`). Only names are checked.

**Not covered:**
- **Lightroom stacks.** No stack table is read; I found no "stack" anywhere in the `lightroom_*.rs` files. LightBench's
  owner wants stacks, so the table names must come from a real catalog. Names commonly cited elsewhere are
  `AgLibraryFolderStack` / `AgLibraryFolderStackImage`; **unverified**.
- Camera profiles, AI masks, and history replay.
- Known open issue #599, "catalog import fails" (`docs/target-app-parity.md:160`); I couldn't see its details.

**How it is tested.** About 42 tests, all on **synthetic SQLite files built in test code from the public file format**
(`native_catalog()` and `photo_tables()` in `lightroom_catalog.rs` tests: one row per table, with the real table and
column names). The WAL checksum is tested on synthetic frames. **No real `.lrcat` is in the repository**
(`find -iname '*.lrcat*'` found nothing), and the comments say real-catalog checks were done locally.
- **This does not unblock LightBench with real data.**
- It *does* give a verified-looking schema map and a technique. LightBench can create a small `.lrcat`-shaped database
  with sqlite-wasm in a unit test (same table and column names, a Lua develop string, a zlib XMP blob with the 4-byte
  length prefix), build the importer against it now, and have the owner confirm on a real catalog later. The schema
  facts above come from LightCraft's code and comments; I could not verify them against Lightroom.

**Browser path for LightBench (my assessment, not tested):**
1. The user picks the catalog folder (read-only FSA).
2. Read the `.lrcat` `File` into sqlite-wasm (deserialize into memory, or import into OPFS) and open it read-only.
3. If a non-empty `.lrcat-wal` exists, either ask the user to close Lightroom or port LightCraft's committed-WAL overlay
   (about 60 lines: `committed_wal_len`, `wal_checksum`). Whether sqlite-wasm applies a WAL copied in beside the database
   is unverified.
4. Very large catalogs (hundreds of MB) are a memory concern. LightCraft caps at 1 GiB.

**Verdict: port the knowledge and the fixture technique.** Re-implement in TypeScript on sqlite-wasm. Effort M for
ratings, flags, labels, keywords, virtual copies and the Basic sliders (with the Lua parser and `crs:` mapping). Stacks
need their own research.

### Engine: XMP sidecars and the `crs:` mapping (interop details LightBench should match)

**Files read:**
- `crates/engine/src/sidecar.rs:1-30`, `:120-240` and `:645-670`;
- `crates/catalog/src/keywords.rs:49-54`;
- `docs/xmp-interop.md` (the whole document);
- grep hits in `crates/meta/src/xmp.rs` (owned fields).

**Rules, compared with LightBench's `web/src/sidecar/xmp.ts`:**

| Topic | LightCraft | LightBench | Assessment |
|---|---|---|---|
| Sidecar name | `<stem>.xmp`; reads `<file>.xmp` and `.XMP` too | `<stem>.xmp`; reads `<file>.xmp` (`findSidecar`, `web/src/import/run.ts`) | Same. |
| **Shared stem** (`A.NEF` + `A.JPG`) | The stem sidecar belongs to the raw (else first by name). The other photo writes and reads `A.JPG.xmp`, falling back to `A.xmp` for reading (`sidecar.rs:14-18`, `StemOwners`). | The RAW owns `A.xmp`. **The JPEG's own rating and keywords are not saved** (PHASE2 Part 5, "Limitation"). | **LightCraft is better.** Adopt it. |
| Keywords written | `dc:subject` only; another app's `lr:hierarchicalSubject` is left stale (their own limit) | `dc:subject` (every level) + `lr:hierarchicalSubject` | **LightBench is better.** Keep. |
| **Keywords read** | Hierarchical paths **plus flat `dc:subject` terms not covered by any level of a path** (`keywords.rs:49-54`) | `lr:hierarchicalSubject` **or else** `dc:subject` (`xmp.ts`, `readXmp`). Flat-only keywords are **dropped** when any hierarchy exists. | **Improve** (S). |
| Reject | Reads `xmp:Rating="-1"` as reject; writes stars in `xmp:Rating` and the flag in `lc:flag` | Writes `xmp:Rating=-1` when rejected (darktable/Bridge convention) and keeps stars in `lightbench:Rating` | Both are defensible. LightBench's choice hides a rejected photo's stars from other apps; acceptable. |
| Rating precedence on read | Sidecar standard fields win | **`lightbench:Rating`/`Flag` win over `xmp:Rating`** (`readXmp`) | **Improve** (S). If Lightroom or Bridge changes the stars after LightBench wrote the file, re-reading restores LightBench's stale value. Inferred from the code; not tested. |
| Damaged sidecar | Copied to `<name>.xmp.bak-<time>` (never overwritten), then replaced (`sidecar.rs:391-424`) | Left unchanged, and the error is shown in status (`writeXmp` throws) | LightBench's choice is safer for foreign data but blocks saving forever. Optional improvement: offer "back up and replace". S. |
| Write atomicity | temp + fsync + rename | `createWritable()` then close (the browser commits through a swap file) | Equivalent in practice. Keep. |
| `xmp:MetadataDate` | Not written (`crates/meta/src/xmp.rs` has no MetadataDate) | Written on every change | LightBench is better. Keep. |
| Capture time / GPS from sidecar | Read when the file has none (`exif:DateTimeOriginal` → `photoshop:DateCreated` → `xmp:CreateDate`) | Not read | Small improvement for scans and JPEGs without EXIF. S. |
| Extra IPTC fields | Owns `Iptc4xmpCore:Location` (sublocation), `xmpRights:Marked` (copyright status), `xmpRights:UsageTerms`, `Iptc4xmpCore:AltTextAccessibility`, `ExtDescrAccessibility` | Not handled (they are preserved, as unknown properties are) | **Improve** if wanted: sublocation and copyright status are standard Lightroom Metadata-panel fields. S. |
| Face regions | Reads `mwg-rs:Regions` (MWG) as named people. Never writes them and keeps them byte for byte. Handles `stArea` normalisation and Lightroom's `mwg-rs:Rotation` for EXIF orientations 6, 8 and 3. | Preserved, not read | Idea for Lightroom migration and Phase 4 faces. M. |
| `crs:` develop fields | Read (approximate), never written. Skipped when `crs:AlreadyApplied="True"`. Only 2012 names (`Exposure2012`, `Contrast2012`…). `ProcessVersion` ignored. Unmapped fields reported. | Not read (T5 "edits not migrated") | **Data reuse** for the postponed import's "approximate Basic sliders". The mapping table in `docs/xmp-interop.md` (`Exposure2012` 1:1 EV; `Contrast/Highlights/Shadows/Whites/Blacks2012` −100..100 1:1; `WhiteBalance` names; `Temperature`/`Tint` with the As-Shot caveat; `Vibrance`, `Saturation`, `Texture`, `Clarity2012`, `Dehaze`) is a ready spec. Note Lightroom's numbers are on Adobe's scales; LightBench's darktable-based sliders will need their own scaling. |
| Preset files | `.lcpreset` JSON export and import; reads Lightroom `.xmp` and `.lrtemplate` presets, Luminar `.lmp` and `.cube` LUTs | Presets live only in the browser catalog, with no files (PHASE2 Part 8, "Limitations") | Improve (see "Revisit"). |

## Revisit completed LightBench features

For each feature already built (PHASE2 Parts 1–11, and the keyboard plan), this section compares it with LightCraft and
recommends keep, improve or replace. I recommend no change where LightBench is already as good or better.

| LightBench feature (where) | LightCraft equivalent (where) | Recommendation |
|---|---|---|
| **Open folder / indexer** (`web/src/library/indexer.ts`, `FolderPanel.tsx`; PHASE2 Part 1) | Desktop "Local" browsing plus **Synchronize Folder**: import new files, relink renamed or moved files (matched by content hash, or by size + dimensions when there is no hash), move missing photos to Recently Deleted, and **read sidecars that other apps saved after the photo was last edited here** (`crates/engine/src/sync.rs`, `cmd/sync.rs:36`; `docs/parity-checklist.md:696`). The web build cannot open folders at all. | **Improve, not replace.** (1) Use the `sidecar_written_at` column LightBench already stores (`catalog.worker.ts:127`, written at `:1228`, **never read**): on ⟳, compare each sidecar's `File.lastModified` with it and offer to read newer sidecars (M). (2) Missing-photo detection and relink are already planned (PHASE2 Part 1, "Not yet"). LightCraft's two-step "scan, then act on exactly the scan shown" and its size + dimensions fallback are good models (M). |
| **Import from card** (`web/src/import/run.ts`, `ImportDialog.tsx`) | Import with Add/Copy/Move, **duplicates by content hash**, and **each copy verified against the hash computed while probing (or byte-compared), with a bad copy removed and reported** (`crates/engine/src/import.rs:6-9`, `:526-536`). | **Improve** (M). `copyInto` (`run.ts:64-87`) streams the file without read-back verification and treats an existing same-name, **same-size** file as "already copied". People format cards after importing, so a verify step (re-read the destination and compare a hash, or bytes for small files) is worth the extra read. Keep the rest. |
| **Full-screen culling** (`web/src/library/CullView.tsx`, `CullPane.tsx`) | Ratings, flags and labels with auto-advance; Compare and Survey act on the active photo (`docs/library-shortcuts.md`). | **Keep.** LightBench's "keys go to the photo on screen" rule and the fixed list are equal or better. Optional: Shift+key = apply and advance once (see Keyboard). |
| **Keywords** (`KeywordEditor.tsx`, sidecar read/write in `xmp.ts`) | Keyword tree with rename, merge, delete, synonyms, export flags and **Lightroom keyword-list text import/export** (`crates/catalog/src/keywords.rs:69`); flat + hierarchical merge on read (`:49-54`). | **Improve** (S): read both `lr:hierarchicalSubject` and flat `dc:subject` terms that no path covers. **Improve** (M, optional): keyword-list file import (tab-indented, `{synonym}`, `[excluded]`), which is how Lightroom users export their keyword tree. It also helps the postponed migration. Rename/merge is already on LightBench's "not yet" list. |
| **Collections, smart collections, Quick Collection** (`CollectionList.tsx`, `CollectionDialog.tsx`, `catalog/smart.ts`) | Albums and folders of albums; smart rules with nested All/Any/None groups and about 45 fields (`crates/catalog/src/rules.rs:61-125`). **No Quick Collection** (`docs/ui-parity.md`, "painter tool, quick collection" gaps). Album names are not written to sidecars. | **Keep.** LightBench's sidecar persistence of collection names and its Quick Collection go further. Camera, lens and ISO rules and nested groups are ready ideas if the owner later wants them (S–M). Collection sets are already on LightBench's "not yet" list. |
| **Stacks** (`catalog/stacks.ts`, `lightbench:Stack`) | Stacks as journaled ops (`crates/catalog/src/stacks.rs`), not written to sidecars. | **Keep.** LightBench's sidecar persistence is better. |
| **Virtual copies** (`lightbench:Versions` in the original's sidecar) | `copy_of` / `copy_name`; **copies are skipped when writing sidecars** (`sidecar.rs:548`). | **Keep.** LightBench is better. |
| **XMP sidecar read/write and interop** (`web/src/sidecar/xmp.ts`, `sync.ts`) | `docs/xmp-interop.md`; `sidecar.rs`. | **Improve.** In order: (1) keyword read union (S); (2) prefer `xmp:Rating` over a disagreeing `lightbench:Rating` unless the photo is rejected (S); (3) shared-stem ownership: a JPEG next to a RAW writes `A.JPG.xmp` (S–M, fixes PHASE2 Part 5's limitation); (4) capture time and GPS fallback from the sidecar (S); (5) optional `Iptc4xmpCore:Location` and `xmpRights:Marked` (S); (6) "back up and replace" for an unreadable sidecar, only as an explicit user action (S). **Durability gap to check:** the sidecar queue (`sync.ts`: `pending` and `blocked` per folder) lives in memory and is flushed on `pagehide`. A crash, or a reload while write permission is still pending, appears to leave sidecars stale with nothing that remembers it. I did not find a persisted "sidecar out of date" marker; that is inferred from the code and **should be verified**. A dirty flag set on change and cleared on write would close it (S). |
| **Compare / Survey** (`CullView.tsx`, `compare.ts`, `survey.ts`) | Compare and Survey (≤ 48), active photo receives keys. | **Keep.** No concrete gap found. LightBench's tests and documentation are more thorough here. |
| **Metadata editing and metadata presets** (`MetadataPanel.tsx`, `library/metadata.ts`, `metadataPresets.ts`) | Owns title, caption, creator, copyright, copyright status, usage terms, URL, sublocation, city, state, country, alt text and extended description; GeoNames fill from GPS. | **Keep, with small additions** (S): Sublocation (`Iptc4xmpCore:Location`) and Copyright Status (`xmpRights:Marked`) are the gaps against Lightroom's basic IPTC set. Optional GPS → place fill (port `crates/geocode`, S, if the owner wants it). |
| **Develop presets** (`web/src/develop/presets.ts`) | `.lcpreset` export and import, plus import of Lightroom `.xmp` / `.lrtemplate` presets, Luminar looks and `.cube` LUTs (`docs/xmp-interop.md`, "Preset files"). | **Improve** (S): a JSON export/import of user presets (LightBench lists this as a limitation; clearing browser storage loses presets). (M, later): Lightroom `.xmp` preset import shares the `crs:` mapping with the postponed catalog import, so build both once. |
| **Import presets** (`web/src/import/importPresets.ts`) | Not examined in depth; not determined. | **Keep.** |
| **PWA, offline, update notice** (`web/src/pwa/sw.ts`, `register.ts`, `release-notes.json`) | **None.** LightCraft web has no manifest and no service worker (`apps/lightcraft-web/index.html`), and the hosting doc says serve with `no-cache`. | **Keep.** LightBench is ahead. |
| **Catalog robustness** (`web/src/catalog/catalog.worker.ts`, `client.ts`) | Format versions with **newer-format refusal**, a lock file or Web Lock, torn-append recovery, damaged-log quarantine, a web backup/restore zip, a failed-save notice and a persistence notice (`crates/catalog/src/journal.rs`; `docs/web.md`). | **Improve:**<br>(1) **Refuse or read-only on a newer schema** (S). `migrate()` returns silently when `user_version >= SCHEMA_VERSION` (`catalog.worker.ts:54-55`), so an older build (the planned one-click rollback, or a stale cached version) would write to a newer catalog. Give `>` its own message.<br>(2) **Catalog backup/export and restore** (M). Nothing exists today. Presets, smart-collection rules, metadata and import presets live only in the OPFS catalog. sqlite-wasm's OPFS SAH-pool utility has export and import helpers; I recall them as `exportFile` / `importDb`, **API names to verify**.<br>(3) **Tell the user when persistent storage is refused** (S). `requestPersistentStorage()`'s result is ignored (`LibraryView.tsx:153,175,652`).<br>(4) Multi-tab is already guarded by the SAH-pool lock with a clear message (`catalog.worker.ts:36-44`), so **keep** that. A `navigator.locks` guard is only needed if a second tab must be stopped *before* the worker starts; optional. |
| **Keyboard shortcuts** (plan: `docs/PLAN.md` "Keyboard and display", `docs/USABILITY.md:71,131,163`; in progress on `lightbench/keyboard`, not on `main`) | Keymap in `crates/ui-egui/src/shortcuts.rs`, editor in `panels/keymap.rs`, 7 keymap tests (`tests_keymap.rs`); `docs/library-shortcuts.md`; `docs/ui-parity.md` "Shortcuts". | **Adopt these specifics in the plan** (none conflicts with it):<br>• Store only overrides (`commandId → key`, `""` = unbound).<br>• Assigning a taken key moves it and tells the user which command lost it.<br>• Reserve browser-critical keys (Ctrl+W, Ctrl+T, Ctrl+N cannot be captured in a browser tab anyway).<br>• Declare intentional same-key pairs by context, and add a unit test that fails when one key fires two actions.<br>• Digits by `KeyboardEvent.code`, so Shift+1 works on every layout; letters by `key`, so they follow the layout.<br>• Text fields keep their keys.<br>• Lightroom-preset candidates: Shift+P/X/U/0–5/6–9 apply and advance; `[` / `]` step the rating. LightCraft documents these with Adobe's public pages as its reference (`docs/library-shortcuts.md`, end). I did not re-check them against Adobe.<br>• A single command registry (id, label, default key, enabled), shared by menus, the keymap editor and the tests (`docs/architecture.md`, "Agent control"). |

## Top recommendations for LightBench in this area

Ranked by value for effort. Where something is unverified, the item says so.

1. **Unblock the postponed Lightroom import with LightCraft's schema map and synthetic fixtures (M).** Build the reader
   on LightBench's own sqlite-wasm, using:
   - the table and field list above (`AgLibraryRootFolder` → `AgLibraryFolder` → `AgLibraryFile` → `Adobe_images` with
     `rating`, `pick`, `colorLabels`, `masterImage`, `copyName`, `orientation`, `captureTime`);
   - keywords from `AgLibraryKeyword` / `AgLibraryKeywordImage`;
   - XMP from `Adobe_AdditionalMetadata`, whose blob is a 4-byte big-endian length followed by zlib;
   - develop settings from the Lua text in `Adobe_imageDevelopSettings`.

   Unit-test against a small `.lrcat`-shaped database built in the test, then have the owner confirm on a real catalog.
   Stacks are not covered by LightCraft and need their own (unverified) research.
2. **Fix the XMP read rules (S, three small changes in `web/src/sidecar/xmp.ts`):**
   - union flat `dc:subject` terms with `lr:hierarchicalSubject`;
   - prefer `xmp:Rating` when it disagrees with `lightbench:Rating`, except for rejects;
   - fall back to sidecar capture time and GPS.
3. **Refuse a newer catalog schema (S)** in `catalog.worker.ts` `migrate()`, before the planned rollback ships.
4. **Catalog backup/restore (M)** plus **a notice when persistent storage is refused (S).** LightCraft web's approach
   (zip, verify, restore into a new slot, keep the old one) is the model.
5. **Verify copies on card import (M)** by read-back with a hash or byte compare, as LightCraft's `copy_new` does,
   because users wipe cards afterwards.
6. **Shared-stem sidecars (S–M):** a JPEG paired with a RAW writes `A.JPG.xmp`, as LightCraft's `StemOwners` does. This
   removes PHASE2 Part 5's limitation.
7. **Detect sidecars changed by other apps (M)** using the existing, unused `sidecar_written_at` column. Also verify, and
   if needed close, the in-memory sidecar queue's durability gap with a persisted dirty flag (S).
8. **Keyboard branch (S, design only):** override-only keymap, move-and-report on conflicts, a no-duplicate-binding
   test, digits by `KeyboardEvent.code`, Shift = apply and advance, `[`/`]` ratings, one command registry.
9. **Presets as files (S):** a JSON export/import of user presets now. Lightroom `.xmp` preset import later shares the
   `crs:` mapping with item 1.
10. **Phase 4 AI, ideas only:**
    - a licence-acceptance dialog before each model download;
    - commit-pinned URLs with SHA-256 checks;
    - masks stored as small quantised logits with the edit, so renders never need the model;
    - face suggestions only with a clear margin over the runner-up, never applied automatically.

    On licences: **AuraFace v1 (Apache-2.0)** is the one face *recogniser* here that passes the owner's rule (training
    data undisclosed). SFace's commercial status is unclear, and InsightFace and SAM 3 are excluded.

**Avoid:**
- LightCraft web's storage model: photos copied into browser storage, and no sidecars on disk.
- The egui UI, which cannot be reused in React.
- `crates/segment` and its SAM 3 weights.
- The MCP and control servers, which a website cannot host.
- Replacing SQLite with LightCraft's in-memory op-log catalog.

**Could not determine:**
- The cause of LightCraft's open issue #599 ("catalog import fails").
- Whether sqlite-wasm applies a copied `-wal` file.
- Whether `download.geonames.org` allows browser (CORS) downloads.
- LightCraft's import-preset behaviour.
