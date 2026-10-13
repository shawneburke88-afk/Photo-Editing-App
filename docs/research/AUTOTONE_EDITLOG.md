# Auto (my style) and the edit log: research and plan

_Research and planning only. Prepared 2026-10-13 against `main` at `a0f8353` (LightBench 0.5.4, catalog schema 13). Nothing in the repository was changed._

**Markers.** `[code]` = read in the repository (file and line given). `[doc]` = stated in LightBench's docs. `[estimate]` = a number worked out here, not measured. `[idea]` = a design proposal. `[unconfirmed]` = from memory or not checked. `[needs review]` = legal or policy matters that need a proper review. This plan gives facts and considerations, not legal advice.

---

## Summary

1. **Most of the training data already exists.** The `edits` table holds every photo's final settings, with their process version, plus the full history JSON. The history records which steps came from Auto, Paste, Sync, presets and Lightroom. The `photos` table holds EXIF, ratings, flags and virtual copies. `auto_targets` holds the owner's saved looks. **Three things are missing:** (a) features of the photo *before* editing, (b) any record of exports, and (c) timestamps on ratings and flags. Library thumbnails can't stand in for (a) because they show the *edited* photo.
2. **The edit log should be one small features table**, filled only when the owner turns it on. Labels (the final sliders) are not copied into it. They are read live from `edits` when a model is trained, so deleting or changing an edit can never leave a stale copy. Expected size: **about 1.5 KB per photo, or about 5–8 KB with a 64–96 px thumbnail** [estimate].
3. **Recommended model path:** kNN, then ridge or a small MLP, all trained in the browser in a worker, in milliseconds to seconds, with no GPU needed. The model predicts either the **look targets** that the existing solver already reaches (median, end points, spread, colourfulness) or the **correction to the rule-based Auto**. Both formulations fall back to today's Auto when data is thin. A thumbnail CNN is a later experiment, trained in Python on the owner's GPU.
4. **The output stays ordinary sliders** (owner's Phase 4 rule). "My style" can be stored as an ordinary `AutoTarget` inside the existing `AutoRecord`, so older LightBench builds still read and re-run it.
5. **Pooling other users' data:** the recommendation is **(a), on-device models only**. Option (b), donating features, needs a server LightBench doesn't have, would change the "Your photos never leave your computer" promise, and mainly helps cold start. A pooled prior for cold start can be had without collecting anything (§5.4). Option (c), federated learning, is not worth it at LightBench's scale.

---

## 1. What already exists

### 1.1 Data a training set needs, and where it lives

| Need | Where it is today | Exact fields | Gaps for training |
|---|---|---|---|
| **Original file reference** | `photos` → `folders` → `roots`, plus the folder handle in IndexedDB | `photos.folder_id`, `file_name`, `original_name`, `file_type`, `file_size`, `file_modified`, `captured_at`, `version` (0 = original, ≥ 1 = virtual copy), `version_name`, `stack_id`; `folders.root_id`, `folders.path`; `roots.name`; handle in IndexedDB db `lightbench`, store `handles` [code: `catalog/catalog.worker.ts:102-129, 218-247`; `platform/handle-store.ts`] | Reading pixels again needs the folder connected and permission granted. That matters for backfill (§2.6). |
| **Camera / exposure EXIF** | `photos` | `camera_make`, `camera_model`, `lens`, `iso`, `shutter`, `aperture`, `focal_length`, `width`, `height`, `orientation`, `gps_lat/lon/alt` (v12) [code: worker `:111-120, 318-320`] | No body serial number is stored [code: not in schema]. That is good for privacy. |
| **Final settings** | `edits.settings` (JSON of `DevelopSettings`) | `edits.photo_id` (PK, `ON DELETE CASCADE`), `settings`, `history`, `updated_at` (Unix **seconds**, set on every save) [code: worker `:135-140, 1164-1170`] | None. All Basic sliders, white balance, vibrance, saturation, tone curve, detail and geometry are there [code: `engine/develop/settings.ts:32-95`]. |
| **Process version** | Inside the settings JSON | `DevelopSettings.process` (1 or 2 today; 2 = `TONE_EQ_PROCESS`, which changed what Highlights, Shadows, Whites and Blacks do) [code: `engine/develop/process.ts:88-145`] | Slider *values* mean different renderings in PV 1 and PV 2, so a slider-predicting model must be trained per PV or use PV-free labels (§3.2). |
| **History** | `edits.history` (JSON of `SavedHistory`) | `steps[{label, settings}]` (each step a full settings snapshot) and `index` [code: `develop/history.ts:52-58`] | **No timestamps are saved** (only kept in memory) [code: `history.ts:52`]. At most 200 steps [code: `:20`]. Drags within 1.5 s merge into one step [code: `:19`]. The labels tell how a value got there: `Auto: <look>`, `Auto Sync`, `Paste settings`, `Sync settings`, `Preset: <name>`, `Reset`, `Lightroom settings…`, `Update to process N`, slider names [code: `develop/DevelopView.tsx:624-1202`, `develop/batch.ts:41-47`]. |
| **Auto provenance** | Inside settings | `DevelopSettings.auto: AutoRecord \| null` = `{target: AutoTarget, sliders, strength}`. It is **cleared when one of Auto's sliders is then moved by hand** [code: `settings.ts:68-72`; `DevelopView.tsx:579-588`; `paste.ts:343`] | This is a ready-made signal. `auto` still set means "accepted Auto as is". The `Auto:` step's settings followed by a different final value means "Auto, then corrected by the owner". |
| **Owner's saved looks** | `auto_targets` | `id`, `name`, `target` (JSON `AutoTarget`), `created_at` [code: worker `:146-151`] | These are explicit statements of style, but few in number. |
| **Presets** | `presets` | `id`, `name`, `preset` (JSON), `created_at` [code: worker `:262-267`] | A preset step marks values that were not chosen per photo. |
| **Ratings, flags, labels** | `photos` | `rating` 0–5, `flag` −1/0/1, `color_label` 0–5 [code: worker `:122-124`] | Only the **current** value. There is no time and no history of changes (`update()` [code: worker `:1225-1238`]). |
| **Export records** | **None** | `export/run.ts` reads from the catalog (`getPhoto`, `getEdit`, keywords, metadata) and writes nothing back [code: `export/run.ts:138-207`] | "Exported" can't be used as a finished signal until it is recorded (§2.3). |
| **Sidecars** | `<photo>.xmp` next to the file | `xmp:Rating`, `xmp:Label`, `lightbench:Rating`/`Flag`, `lightbench:Develop` (current settings JSON), keywords, collections, stack, virtual copies, IPTC metadata, Lightroom `crs:` fields [code: `sidecar/xmp.ts:1-80, 351`] | **No history and no features.** The sidecar can rebuild final settings and ratings if the catalog is lost, but not the training features. |
| **Thumbnails** | OPFS `<slot.thumbsDir>/<id>.jpg` | 512 px JPEG, quality 0.82, rendered **with the current edit** [code: `catalog/thumbs.ts:13-18`; `develop/source.ts:132-138`]; at import it is the RAW's embedded preview [doc PLAN Phase 1] | Shows the *output*, not the input, so it **can't be a model input**. |
| **Backups** | ZIP of catalog + thumbnails + settings, with checksums [code: `backup/backup.ts:1-9`] | — | A new table inside the catalog would be backed up automatically. That is a decision for the owner (§2.5). |
| **Preferences** | `localStorage` key `lightbench.settings` (keyboard, display); the Auto look is in `lightbench.autoTarget` [code: `settings/store.ts:30`; `DevelopView.tsx:158`] | — | The on/off switch for the edit log can live here or in the catalog (§2.5). |

### 1.2 The Auto that exists (Phase 1 Part 2b, Phase 2 Part 7)

- **Measurement.** `DevelopEngine.renderStats(u, wb, maxSize = 256)` develops the photo at ≤ 256 px on the GPU. It returns `ImageStats`: 256-bin R, G, B and luma histograms of display-encoded sRGB, the pixel count, counts of highlight- and shadow-clipped pixels (the same test as the overlay), and mean chroma (max − min channel) [code: `engine/gpu/develop-engine.ts:149-166, 1663-1680`]. `metricsFromStats` reduces this to `Metrics` {p005, p10, p25, median, p75, p995, highlightClip, shadowClip, chroma} [code: `engine/develop/auto.ts:13-63`].
- **Targets.** `AutoTarget` = {median, low, high, spread or null, contrast?, vibrance?, maxHighlightClip, chroma or null}. Six built-in looks (Natural, Vivid, Landscape, Portrait, Low-key, High-key), "match a reference photo" (metrics from its thumbnail) and saved targets (metrics of the current rendering) [code: `auto.ts:85-136`; `DevelopView.tsx:627-711`].
- **Solver.** `solveAuto` runs a golden-section search per slider, minimising (miss / tolerance)² + (slider / scale)². It does two passes over Exposure → Contrast (if spread is set) → Whites → Blacks, then Highlights if clipping exceeds the limit, then Vibrance. Each cost evaluation is one `renderStats` call [code: `auto.ts:204-288`].
  - **Auto sets Exposure, Contrast, Highlights (range −100…0 only), Whites, Blacks and Vibrance.** **Shadows has no rule** (a full Auto resets it to 0), and **white balance is left alone** by the owner's decision [code: `auto.ts:139-175, 216-219`; doc PLAN "Auto and white balance"].
- **Options.** Strength 0–150 % and a choice of sliders [code: `auto.ts:155-168`; `develop/AutoControls.tsx`]. Paste and Sync re-run Auto per photo from the `AutoRecord` [code: `develop/batch.ts:73-87`].
- **Speed.** "Several seconds per photo on the software GPU used for testing … still needs measuring on the owner's GPU" [doc PHASE2.md:157].

**Consequence for learning:** the existing `AutoTarget` is already a compact "style" vector, and `targetFromMetrics` already turns a finished rendering into one [code: `auto.ts:124-136`]. A model that predicts an `AutoTarget` per photo reuses the solver and keeps the results as sliders without new machinery. That is the cheapest first model (§3.2, formulation T).

---

## 2. Edit-log design (local, opt-in)

### 2.1 Principles

- **Read-only with respect to edits.** The log never writes `edits`, settings, history or sidecars. Every rendering stays byte-identical, and **no new process version** is needed.
- **Off by default, invisible when off.** When off, no table rows are written, no extra rendering is done and no UI appears except one line in Settings (§2.5).
- **On device only.** No network code is involved. Export is a file the owner saves. That matches the existing backup model [code: `backup/backup.ts:1-2`].
- **Features are a cache; labels are live.** The log stores only what can't be recovered cheaply: the measurement of the *unedited* photo. Final settings, ratings, flags and history are read from the catalog when training or exporting. Changing an edit therefore updates the label, and removing a photo removes everything (`ON DELETE CASCADE`).

### 2.2 What is logged per photo

**Input features**, measured once per photo at **default develop settings** (`defaultsFor(kind, iso)`: as-shot white balance, Auto lens, base exposure +0.7 EV, sigmoid defaults [code: `settings.ts:96-150`]) with the **photo's current geometry**. That is the same input "Auto (my style)" will see when the owner crops first and then presses Auto [idea]:

| Feature group | Content | Size (packed) [estimate] |
|---|---|---|
| Tone histogram | luma, 64 bins (from `ImageStats.luma`'s 256), normalised, uint16 | 128 B |
| Colour histograms | R, G, B, 32 bins each, uint16 | 192 B |
| Metrics at defaults | the 9 `Metrics` fields + per-channel p50/p995, float32 | ≈ 60 B |
| Full-frame stats | the same metrics without the crop, for when Auto runs before cropping | ≈ 60 B |
| Sensor / scene | fraction of sensor-clipped pixels (the Shift+O measurement) [unconfirmed: whether `renderStats` indicators expose it as a count], as-shot WB temperature/tint, source kind (raw / rgb) | ≈ 20 B |
| EXIF | log2 ISO, log2 shutter, log2 aperture, focal length, **EV100 = log2(N²/t) − log2(ISO/100)** (a scene-brightness estimate, a strong cue for night/indoor/day [idea]), camera model and lens as hashed IDs, local hour of capture | ≈ 40 B |
| Thumbnail (optional, for the later CNN) | 64–96 px long edge at defaults, JPEG/WebP | **≈ 3–6 KB** [estimate, not measured] |
| Rule-based Auto output (for the residual model and A/B) | the six sliders `solveAuto` gives with the **Natural** look at strength 100 % | ≈ 30 B |
| Bookkeeping | feature-layout version, LightBench version, PV used, `computed_at` | ≈ 30 B |

**Total: about 0.6 KB without a thumbnail, about 4–7 KB with one; about 1.5 KB and 5–8 KB with SQLite overhead** [estimate]. For 10,000 logged photos that is about 15 MB without thumbnails or 50–80 MB with them [estimate].

**Not logged:** GPS (no expected value for tone; a privacy liability), file names and paths (the `photo_id` link is enough), keywords, captions, and full-size pixels.

**Labels (read live at training/export time, not stored):**
- **Final Basic sliders.** From `edits.settings`: exposure, contrast, highlights, shadows, whites, blacks; later `whiteBalance` (mode, temperature, tint), vibrance, saturation. Plus `process`.
- **Final-render metrics.** `Metrics` of the photo **as edited**, the input to `targetFromMetrics`. Unlike the sliders, these are process-version-free. Computing them needs one `renderStats` at the final settings, so they are **cached** next to the features and invalidated when `edits.updated_at` changes [idea].
- **Provenance.** Derived from the history labels (§1.1):

| Provenance | Rule [idea] | Default training weight [estimate] |
|---|---|---|
| `manual` | At least one tone-slider step after the last Auto/Paste/Preset step, and no `auto` record | 1.0 |
| `auto-corrected` | An `Auto:` step exists and the final tone sliders differ from it (`auto` is null) | 1.0 (also gives the pair "Auto proposed → owner chose") |
| `auto-kept` | Final `auto` record still set (rule-based) | 0.5 (approval, but not a choice) |
| `mystyle-kept` | Final `auto` record set by "My style" | **0.0–0.3**, to avoid the model learning from its own output (feedback loop) |
| `pasted` / `synced` / `preset-only` / `lightroom-only` / `import-only` | The last tone change came from Paste, Sync, a preset or a Lightroom step, with no later manual tone step | 0 (not chosen for this photo); 0.3 for Sync groups [estimate] |

### 2.3 The "finished" signal

There is no export record and no time on ratings or flags today (§1.1). Proposal:

- **New: record exports.** Add `photos.exported_at` (Unix seconds), set by `export/run.ts` on success. It is useful outside the log too (a "Recently exported" smart collection) [idea]. Whether it is recorded while the log is **off** is an owner question (Q4).
- **Finished = not rejected (flag ≠ −1) AND tone provenance weight > 0 AND any of:**
  - exported (`exported_at` set), **or**
  - rating ≥ **3** [owner to choose N], **or**
  - flag = picked, **or**
  - `edits.updated_at` at least **14 days** ago with at least one manual tone step [estimate; owner to choose].
- **Keep and expose the reason** (exported / rated / picked / aged), so evaluation can report each subset. Exported or rated photos are the strongest labels.
- **Known biases:**
  - The owner finishes photos they like, so the training set leans towards keepers (selection bias).
  - Burst and stack siblings are near duplicates. Evaluation must group by capture session (§3.5).

### 2.4 Schema additions (migration to version 14)

Additive only, in the same style as v4–v13 [code: worker `:154-328`]: new tables and nullable columns, no rebuild of `photos`. `SCHEMA_VERSION` becomes 14 [code: `catalog/schema.ts:3`], so older builds refuse the catalog (existing behaviour, `NEWER_CATALOG_MESSAGE`).

```sql
-- v14: the edit log (on-device training data for "Auto (my style)"). Written only while the log is on.
CREATE TABLE edit_features (
  photo_id      INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  layout        INTEGER NOT NULL,      -- feature layout version; a new layout recomputes lazily
  app_version   TEXT    NOT NULL,      -- LightBench version that measured it
  process       INTEGER NOT NULL,      -- process version used for the default rendering
  features      BLOB    NOT NULL,      -- packed float32/uint16 (§2.2)
  thumb         BLOB,                  -- optional 64–96 px default rendering (JPEG/WebP)
  auto_standard TEXT,                  -- JSON: rule-based Auto sliders (Natural, 100 %)
  final_metrics TEXT,                  -- JSON Metrics of the edited rendering (cache)
  final_at      INTEGER,               -- edits.updated_at the cache belongs to
  excluded      INTEGER NOT NULL DEFAULT 0,  -- "don't learn from this photo"
  computed_at   INTEGER NOT NULL
);
-- Trained models (weights are tiny: JSON or float32 BLOB) and their evaluation.
CREATE TABLE style_models (
  id          INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL,        -- 'knn' | 'ridge' | 'mlp' | 'gbdt' | 'cnn'
  formulation TEXT    NOT NULL,        -- 'target' | 'residual' | 'sliders'
  layout      INTEGER NOT NULL,
  process     INTEGER,                 -- NULL for process-free formulations
  samples     INTEGER NOT NULL,
  weights     BLOB    NOT NULL,
  report      TEXT,                    -- JSON: leave-one-out errors, ΔE2000, A/B score
  active      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
-- Blind A/B choices (§3.5); also usable as preference training data later.
CREATE TABLE style_trials (
  id INTEGER PRIMARY KEY,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  model_id INTEGER REFERENCES style_models(id) ON DELETE SET NULL,
  shown_left TEXT NOT NULL, choice TEXT NOT NULL CHECK (choice IN ('left','right','same')),
  at INTEGER NOT NULL
);
ALTER TABLE photos ADD COLUMN exported_at INTEGER;  -- see Q4
```

- **Virtual copies** each have their own row. They share the file but not the edit. Features are identical, so they're computed once per file and copied [idea].
- **Removing a photo** cascades. "Delete my edit log" is `DELETE FROM edit_features; DELETE FROM style_models; DELETE FROM style_trials;` plus `VACUUM` so the pages are really freed [idea].

### 2.5 Switch, defaults, export and deletion

| Item | Recommendation |
|---|---|
| Switch | Settings → **"Learn my editing style (on this computer)"**, **off by default** for every user. When off: no rows, no rendering work, no prompts. The "My style" entry in Auto's list says "Set up…" only after it is turned on. |
| Where the switch lives | In the catalog (one row of a small `app_settings` table, or `style_models` presence), not `localStorage`. The library and its log then move together through backup and restore [idea]. |
| What turning it on does | Starts logging photos as they are opened in Develop, and offers a one-time **"Learn from photos you've already edited"** backfill (§2.6). |
| Thumbnails | A sub-option, **on** when the log is on: it is the owner's own device, and a later CNN needs them. Never included in any donation (§5). |
| Backups | **Included** by default. The log is part of the library, and the backup is a local file [code: `backup/backup.ts:1-2`]. A tick box "Leave out the edit log" [idea]. |
| Export for training | "Export training data…" writes a ZIP: `features.jsonl` (one line per photo: features, labels, PV, provenance, finished reason, group IDs for capture session/stack/file), `thumbs/<n>.webp` if any, and `README.txt` with the field list and layout version. File names, paths and GPS are left out. Photo IDs are replaced by random per-export IDs. |
| Deletion | "Delete edit log" (with confirmation and size shown) and per-photo "Don't learn from this photo" (`excluded = 1`). Turning the switch off asks: keep or delete? |
| Rendering safety | The log only *reads* settings and calls `renderStats`/`renderImage` on a **separate engine instance**, like `BatchDeveloper` does [code: `develop/batch.ts:89-100`]. A unit test asserts that `edits`, the history and the sidecar bytes are unchanged after logging [idea]. |

### 2.6 When features are computed

- **On open in Develop** (photo already decoded): one `renderStats` at defaults, one at final settings, optionally one 96 px `renderImage`. It runs **after** the first display, at idle priority. Cost: a few small renders, likely tens of milliseconds on a discrete GPU [estimate; unmeasured]. The rule-based Auto output costs one `solveAuto`, about 50–70 measurements, so it waits until idle (several seconds on SwiftShader [doc]).
- **On leaving the photo or saving the edit:** refresh `final_metrics` if `edits.updated_at` changed.
- **Backfill:** a background job over edited photos that have no features, one photo at a time on its own engine. It needs the folders connected, skips missing files, and can be paused [idea; modelled on `BatchDeveloper`].

---

## 3. Model

### 3.1 Outputs

- **First:** Exposure, Contrast, Highlights, Shadows, Whites, Blacks.
  - **Shadows is new.** The rule-based Auto never sets it [code: `auto.ts:216-219`].
  - **Highlights may go positive.** The solver's range is −100…0 [code: `auto.ts:171`]. The owner's edits may not be.
- **Later:** Vibrance, Saturation, and **white balance as an offset from as-shot** (Δ temperature in mireds, Δ tint).
  - WB is an **owner decision**: today's Auto deliberately leaves WB alone (Q6).

### 3.2 Three formulations (all produce ordinary sliders)

| Code | What the model predicts | Then | Strengths | Weaknesses |
|---|---|---|---|---|
| **T: target** | A per-photo `AutoTarget`: median, low, high, spread, chroma, maxHighlightClip. Labels = `targetFromMetrics(final_metrics)` | The existing `solveAuto` finds the sliders | Few outputs (6). **Process-version-free.** Captures looks made with any tool (tone curve, presets), because it learns the result, not the route. Reuses tested code. **Backward compatible**: the prediction *is* an `AutoTarget` in an `AutoRecord`, which older builds re-run as is. Needs the least data [estimate]. | Can't learn *how* the owner gets there (Shadows vs Exposure vs curve). Limited to what the solver reaches. Costs a solver run (several seconds on SwiftShader [doc]). |
| **R: residual** | Δ sliders = owner's final − rule-based Auto (Natural) | Add to the rule-based Auto result | At zero data it **is** today's Auto, so the cold-start blend comes for free. Learns systematic corrections ("always +0.3 EV on backlit shots, Shadows +25"). | Needs `auto_standard` for every training photo (one solver run each in backfill). Labels are **per process version**. |
| **S: sliders** | The six sliders directly | Apply directly | The fastest at run time (no solver). | **Redundant sliders**: several combinations give near-identical renders, so slider error is noisy, and ΔE (§3.5) is the fairer metric. Per PV. Needs the most data. |

**Recommendation [idea]:**
1. Ship **T** first. It matches IMPROVEMENTS C19(a) "learn the owner's targets" [doc].
2. Add **R** for Shadows and Highlights > 0.
3. Evaluate **S** only if R's ΔE is clearly better and speed matters.

### 3.3 Candidates and how much data each needs

All sizes are far below 1 MB. **Data needs are estimates** for a single owner with a fairly consistent style. They are counted as *finished* photos, after grouping bursts.

| Model | Size [estimate] | Data to beat the rule-based Auto [estimate] | Data to plateau [estimate] | Train where | Notes |
|---|---|---|---|---|---|
| **Per-camera mean offset** (baseline) | < 1 KB | 20–50 | ~100 | Browser, instant | Shows whether a model beats "always nudge by the owner's average". |
| **kNN** (k = 5–10, standardised features, distance-weighted) | = the features (≈ 1 KB/photo) | **20–50** | 300–1,000 | Browser, no training | Explainable ("like these 5 photos of yours") and a natural confidence (distance). Great for cold start. |
| **Ridge / multi-output linear** | ≈ 5 KB | 30–100 | 300–500 | Browser, closed form, milliseconds | Robust with little data. A good T and R workhorse. |
| **Gradient-boosted trees** (6 regressors, depth 3–4, 100–300 trees) | 100–400 KB | 200–500 | 1,000–3,000 | Browser (own TS trainer, about 300–500 lines) or Python (LightGBM/XGBoost) | Handles mixed EXIF and histogram features well. A browser GBDT library was not checked [unconfirmed]. |
| **Small MLP** (≈ 120 → 64 → 64 → 6, ≈ 12 K params) | ≈ 50 KB fp32 | 300–1,000 | 2,000–5,000 | **Browser, TypeScript in a worker**: ≈ 1,000 samples × 200 epochs × 3 × 2 × 12 K ≈ 15 GFLOP, so seconds on a CPU [estimate] | Needs weight decay, early stopping and an ensemble of 3–5 for confidence. |
| **Tiny CNN on the 64–96 px default thumbnail** (+ the histogram/EXIF vector) | 100–600 KB | **2,000–10,000** from scratch | 10,000+ | **Python on the owner's GPU** (minutes [estimate]), inference in the browser | Can see content (sky, faces, backlight) that histograms miss. With so few photos per owner it will likely overfit. A pretrained backbone would help but brings the **training-data policy question** (IMPROVEMENTS §5 Q1). Phase 4 masks (region stats as features) are a cheaper way to get content awareness [doc PLAN Phase 4]. |

### 3.4 Training in the browser or in Python

| | In the browser, on device | Python on the owner's GPU (RTX 4000 Ada, laptop variant inferred [doc IMPROVEMENTS §2.0]) |
|---|---|---|
| Suits | kNN, ridge, MLP, GBDT: everything except the CNN | All, including the CNN, plus research (feature selection, ablations) |
| Compute | CPU in a Web Worker is enough (§3.3). WebGPU isn't needed for these sizes. | Overkill for the small models. Minutes for a tiny CNN [estimate]. |
| Effort | S–M: own TS code (ridge ≈ 100 lines, MLP with Adam ≈ 300, GBDT ≈ 400–500) [estimate]. No new dependencies. | S for the scripts. Needs the export (§2.5), then a way to bring weights back (an import button). |
| Users | **Every** LightBench user can learn their own style. Fits "Local only" [doc PLAN Decisions]. | Only the owner (or technical users). |
| Determinism | The trained model is data; inference output is **rounded to slider steps and stored as ordinary values**, so rendering stays deterministic. Re-running may differ in the last step between browsers (`Math.exp` etc. are implementation-approximated in ECMAScript [unconfirmed: from memory]), much as today's Auto depends on GPU measurements. | Same once the weights are imported. |
| **Recommendation** | **Default path.** Retrain automatically in the background after every 25 newly finished photos [estimate], and keep the last 3 models. | **Research path** for the CNN and for choosing features and formulations before building the in-app version. |

Building backprop kernels for WebGPU training by hand would be L effort. Libraries with WebGPU training (TF.js WebGPU backend, ONNX Runtime Web training) exist [unconfirmed: current status and licences not checked]. They aren't needed for the recommended models.

### 3.5 Evaluation

- **Splits.** Use **grouped** cross-validation, not plain leave-one-out:
  - group by **capture session** (same day + camera, with gaps < 2 h [idea]), by stack, and by file (virtual copies);
  - otherwise near-duplicate burst frames leak between train and test and flatter the model.
  - Exact leave-one-*group*-out for kNN and ridge (cheap); 5–10-fold grouped for MLP/GBDT.
- **Metrics:**
  1. **Slider error**: MAE per slider in its own units (EV for Exposure, points for the others), vs the owner's final.
  2. **Rendered ΔE2000** (CIEDE2000, Sharma et al. 2005 formulas [unconfirmed: not re-read]). Render the predicted and the owner's settings at the same ≤ 512 px with every non-Basic setting taken from the owner's edit, convert display sRGB → CIELAB (D65), and report the per-pixel mean and 95th percentile. This is the fairer metric, because slider combinations are redundant (§3.2).
     - No ΔE2000 code exists in the repo [code: grep found none]. About 80 lines of TS plus tests [estimate].
  3. **Target error** for formulation T: |median|, |low|, |high|, |spread| misses in luminance units (the solver's own tolerance is 0.02 [code: `auto.ts:178`]).
- **Baselines.** Always report the **rule-based Auto** (Natural, and the owner's most-used look) and the "owner's mean offset" baseline side by side. A model ships only if it beats both on median ΔE2000 [idea; owner to set the bar].
- **Blind A/B.** A "Compare Autos" session: for N photos not in training, show the rule-based Auto and "my style" side by side, left/right randomised, labels hidden. The owner picks left, right or same, recorded in `style_trials`.
  - With 100 decisive trials, 60 wins gives one-sided p ≈ 0.028; with 50 trials, 33 wins gives p ≈ 0.016 (exact binomial, computed here).
  - Roughly **50–100 trials** are enough to show a clear preference [estimate].
- **Cold-start curve.** Re-run the grouped evaluation on random subsets of 10, 25, 50, 100, 200… finished photos. Plot ΔE against n for each model and the blend (below). This answers "how many edits until it helps?" with the owner's own data.
- **Blending with the rule-based Auto** [idea]:
  - **R** blends by construction.
  - For **T** and **S**, blend: `final = w · model + (1 − w) · rule`, with `w = n / (n + k)` (k ≈ 30–50 [estimate], fitted on the cold-start curve), times a per-photo confidence c ∈ [0, 1] from (i) the kNN distance to the nearest training photos and (ii) the spread of an ensemble's predictions.
  - Below **n ≈ 20** finished photos, "My style" isn't offered.

---

## 4. UX

- **Auto's look list** [code: `develop/AutoControls.tsx:25-45`] gets a **"My style"** group at the top once a model exists: **"Auto (my style)"**. The built-in looks remain as **"Auto (standard)"**. One Auto button; the chosen entry is remembered as today (`lightbench.autoTarget`).
- **Confidence line** under the button [idea]: "My style · High confidence · learned from 340 of your edits · similar: [5 small thumbnails]". The thumbnails are the kNN neighbours, which gives an honest explanation. Low confidence says "mostly standard Auto for this photo" (the blend weight).
- **Always ordinary sliders.**
  - The result is one history step `Auto: My style`, with the usual Strength and slider ticks [code: `AutoControls.tsx:60-95`].
  - Moving a slider clears the record, as today [code: `DevelopView.tsx:585`].
  - Store the prediction in the `AutoRecord`:
    - **T:** `target` = the predicted `AutoTarget` (so older builds can re-run it);
    - **all formulations:** add an optional `model: {id, createdAt}`, so Paste and Auto Sync **re-predict per photo** rather than reusing one target. Older builds ignore the extra field and fall back to the stored target. That is a settings-JSON addition, not a rendering change, so **no PV** is needed.
- **Settings → "My style"** panel:
  - status (photos logged / finished / used, size on disk);
  - **Retrain now**;
  - the model history with each version's evaluation report;
  - **Use previous model**;
  - **Reset** (deletes models, keeps the log);
  - **Delete edit log**;
  - **Export training data…**;
  - **Import model…** (for weights trained in Python);
  - **Compare Autos** (the blind A/B).
- **Per photo:** "Don't learn from this photo" in the Develop menu (sets `excluded`).
- **Batch:** Auto Sync with "My style" re-predicts per photo, using the existing batch path [code: `develop/batch.ts:73-87`].

---

## 5. Data from other users: options for the owner

_Facts and considerations, not legal advice. All law references are general and marked **[needs review]**._

Starting point: LightBench promises "Your photos never leave your computer" [doc README]. Its AI policy is "Local only … No cloud services" [doc PLAN Decisions]. GitHub Pages hosts static files only, so there is no endpoint to receive data. The app's network requests found in the code are same-origin `GET`s for its own assets (LibRaw WASM, the Lensfun and noise-profile databases, the service worker) [code: `engine/lens/lens-db.ts:46-56`, `engine/detail/noise-db.ts:51-61`, `pwa/sw.ts:74-119`]. Nothing is uploaded today.

### 5.1 Option (a): none; per-user on-device models (recommended)

- **How:** §2–§4 as written. Every user who turns the log on gets their own model, trained on their own device.
- **Infrastructure:** none. **Promise:** unchanged. **Law:** no personal data is collected by the project, so the privacy-law questions below don't arise for LightBench [needs review: a light check is still sensible].
- **Value for "my style":** the best match by definition, because the model learns from the target user only. The cost is **cold start**: below roughly 20–50 finished photos it is mostly the rule-based Auto [estimate].

### 5.2 Option (b): opt-in donation of derived features (no images)

**What would be sent:** only the compact vector (§2.2) **minus** thumbnails, GPS, timestamps (or only a coarse hour), file names and serials, plus the final Basic sliders, PV and provenance. Each donation would carry a random ID per donation batch, not per user, unless per-user modelling is wanted (that is a trade-off, below).

**Server needs (LightBench has none):**

| Route | What it needs | Notes |
|---|---|---|
| **Manual file donation** | Nothing new: the user exports a donation file (§2.5, stricter filter) and sends it to the owner by email | No server and no automatic upload, so the in-app promise is kept. Consent is explicit by the act of sending. Doesn't scale. **Don't use public GitHub issues or PRs**: the attachments would be public. |
| **An upload endpoint** | An HTTPS endpoint (e.g. a serverless function + object storage [idea; providers and costs not checked]), abuse protection, storage, access control, a deletion route, logs policy | The first time LightBench sends user-derived data anywhere: the README promise and PLAN's "No cloud services" would need rewording. Ongoing operations and security work for the owner. |
| **A third-party form or analytics service** | Account with a vendor | Moves data to a third party, so its terms and privacy policy matter. Not recommended. |

**Consent text (draft) [idea]:**
> **Share anonymous editing statistics?** If you agree, LightBench sends a small summary of photos you've finished: brightness and colour histograms of the unedited photo, camera exposure settings (ISO, shutter, aperture), and the values of six tone sliders. **No photos, thumbnails, file names, locations (GPS), dates or camera serial numbers are sent.** It is used only to improve the starting point of Auto (my style) for everyone. You can stop at any time in Settings, and ask for your contributions to be deleted using the code shown there. Your photos never leave your computer.

**Anonymisation and re-identification risks:**

| Data | Risk | Mitigation [idea] |
|---|---|---|
| **GPS** | Directly locates homes and routines | Never sent |
| **Capture timestamps** | Together with camera and lens, can link a donation to someone's public photos (e.g. a Flickr or 500px upload with EXIF) | Drop, or keep only the hour of day |
| **Camera body serial / lens serial** | Unique device identifier. Not in LightBench's catalog [code], but present in RAW EXIF | Never read for the log |
| **Camera + lens + rare focal lengths** | Rare combinations narrow people down | Coarsen (sensor class, or drop the model); minimum-count suppression on the server |
| **Thumbnails, even 64 px** | Faces, places, home interiors; recognisable images | **Never donated** |
| **Histograms + EXIF vector** | Low on its own; a precise histogram can match a specific published photo | Coarser bins (16–32), small noise |
| **Upload metadata** (IP address, time, user agent) | Identifies the sender regardless of content | Server must not log IPs, or must drop them quickly; this is a server policy question |
| **Per-user grouping** | Needed for personalised pooled models; makes donations a profile | Prefer per-batch IDs; or per-user IDs that are random and deletable |

**Privacy law, in general terms [needs review]:**
- **GDPR** (EU/EEA users) [needs review: from memory]:
  - "Personal data" is any information relating to an identified or identifiable person (Art. 4(1)).
  - Truly anonymous data falls outside it (Recital 26). Pseudonymous data with per-user IDs, timestamps or EXIF probably does not count as anonymous.
  - Consent must be freely given, specific, informed, unambiguous and as easy to withdraw as to give (Art. 4(11), Art. 7).
  - Data subjects have rights of access and erasure (Arts. 15, 17).
  - A website receiving such data would need a privacy notice and a lawful basis.
- **Canada's PIPEDA** [needs review: from memory]:
  - It applies to private-sector organisations collecting personal information **in the course of commercial activities**.
  - Whether a free, non-commercial GPL project falls under it is unclear. A review should settle it.
  - Its principles (meaningful consent, limiting collection, safeguards, retention limits, access) are good practice either way.
  - Provincial laws (e.g. **Quebec's private-sector act as amended by "Law 25"**) may also apply depending on where the owner and users are [unconfirmed; needs review].
- **Other jurisdictions** (e.g. US state laws) [needs review].
- **Retention and deletion** [idea]:
  - Keep raw donations at most 12–24 months; keep aggregated models longer.
  - Show each donor a random deletion code.
  - Define how deletion reaches models already trained (usually: deleted from the data now, gone from models at the next retrain).

**Effect on the promise:** with a server, LightBench would no longer be strictly local-only. The truthful wording becomes "Your photos never leave your computer; if you opt in, anonymous editing statistics are sent." Manual file donation keeps the in-app promise intact.

**Value for model quality:**
- **Pooled taste vs "my style":** a model trained on everyone's slider values regresses to an **average style**. For the owner that is a different taste, and averaging styles tends towards bland results.
- **What does transfer across users:** the *correction* part of editing, such as fixing under-exposure, high-ISO night shots, backlight, and holding highlights. These are shared, much like FiveK's experts agree more on exposure than on style [unconfirmed: from memory of the FiveK paper, Bychkovsky et al., CVPR 2011].
- **Published work on collaborative personalisation of enhancement** (Kang et al., CVPR 2010; Caicedo et al., CVPR 2011) reported that pooling across users helps when each user has few examples, if the model separates shared and per-user parts [unconfirmed: from memory, not re-read].
- **So a pooled prior is useful for cold start, not as the style itself:** pooled model → prior; the owner's data → residual on top (formulation R with a pooled base). Its value fades after a few hundred of the owner's own edits [estimate].
- **The amount of value depends on how many users donate.** A handful of donors adds little beyond the rule-based Auto [estimate].

### 5.3 Option (c): federated learning

- **What it is:** each browser trains on its own data and sends only model updates; a coordinator averages them (federated averaging).
- **Feasibility in LightBench:**
  - The model is tiny, so traffic and compute are trivial.
  - But federated learning **still needs a server** (coordination, update collection, model distribution).
  - Client availability is sporadic (a browser tab).
  - Secure aggregation, so the server can't read single updates, is a significant protocol to implement [unconfirmed: e.g. Bonawitz et al. 2017, from memory].
  - With few participants, individual updates can leak training data (gradient inversion) [unconfirmed]. The standard remedy is differential-privacy noise, which at small participant counts swamps the signal [estimate].
- **Effort:** L–XL, plus permanent operations.
- **Value:** at best the same pooled prior as (b), at much higher complexity. **Not recommended** unless LightBench grows to many active users and a server already exists for other reasons.

### 5.4 A pooled-style prior without collecting anything [idea]

These options give most of the cold-start value of (b) while keeping (a)'s promise:
1. **Synthetic correction prior.** Perturb well-exposed photos (exposure, contrast, white/black points) and learn to undo the perturbation [doc IMPROVEMENTS A7 "Synthetic alternative"]. It teaches correction, not taste. It needs licence-clean photos: the owner's own, or CC BY/CC0 sets with their attribution (IMPROVEMENTS §4).
2. **The owner's own model as a shipped starter.** The owner trains on their own edits and publishes the small weights as a static file (like Lensfun's data, downloaded on first use [code: `engine/lens/lens-db.ts`]). Other users' "My style" starts from it as the prior, and their own edits replace it on device. The data is licence-clean (the owner's own) [doc IMPROVEMENTS A7]. The question is whether the owner wants their taste as everyone's default (Q9).
3. **The existing rule-based Auto** remains the zero-data prior in formulation R.

---

## 6. Effort and phased plan

| Phase | Content | Effort | Depends on | Exit check |
|---|---|---|---|---|
| **E0 Measure first** | Time `renderStats` at 256 px and a full `solveAuto` on the owner's GPU (the open item in PHASE2:157). Count edited photos by provenance and finished reason with a read-only SQL query in a dev build. | S | — | Numbers for §2.6 and an answer to "is there enough data today?" |
| **E1 Edit log** | Migration v14; switch in Settings (off); feature capture on Develop open; `final_metrics` cache; provenance and finished rules; `exported_at`; export ZIP; delete; per-photo exclude; tests that edits and sidecars are untouched | M | — | Owner turns it on; the log is ≈ 1.5–8 KB per photo; export opens in Python |
| **E2 Backfill** | Background "learn from photos already edited" job (separate engine, pausable, skips disconnected folders) | S–M | E1 | Owner's existing edits logged |
| **E3 Offline study** (Python, owner's GPU, or a dev page) | Grouped leave-one-out for baselines, kNN, ridge on T and R; ΔE2000 renders (needs a CIEDE2000 helper and a headless render path, or a dev-page harness in the app); cold-start curve | S–M | E2, ≥ 100 finished photos [estimate] | **Decision gate:** does any model beat the rule-based Auto on median ΔE? Which formulation? |
| **E4 "Auto (my style)" in app** | In-worker training (kNN + ridge; MLP if E3 says so); `style_models`; prediction with confidence and blending; Auto list entry; `AutoRecord.model`; Paste/Auto Sync re-predict; Settings panel | M | E3 | Works on the owner's photos with confidence shown |
| **E5 Blind A/B** | Compare Autos session; `style_trials`; report | S | E4 | ≥ 50–100 trials; a significant preference, or not |
| **E6 Extensions** | Vibrance/Saturation, WB offsets (if Q6 yes); GBDT; thumbnail CNN trained in Python + Import model; Phase 4 region stats (subject, sky, faces) as features | M–L | E5; Phase 4 masks | Each must beat E4 in E3's harness |
| **E7 Pooled prior without collection** (§5.4) | Synthetic correction prior and/or the owner's published starter model | S–M | E4 | Better cold-start curve at n ≤ 50 |
| **E8 Donation (only if chosen)** | (b) manual file route: S. (b) server route: L + legal review + operations. (c): L–XL | S / L / XL | Owner decision; review | — |

**Total to a usable "Auto (my style)" (E0–E5): about M–L** [estimate]. Most of the elapsed time is the owner finishing enough photos for E3, not code.

**Risks:**
- Too little or too inconsistent data: the E3 gate catches it.
- The feedback loop from accepted "My style" results: down-weight them (§2.2).
- Process-version changes invalidate slider labels: prefer T, or retrain per PV.
- Selection bias towards keepers.
- The rule-based Auto's speed on integrated GPUs, which affects T and backfill (E0).

---

## 7. Open questions for the owner

1. **Turn the log on for yourself now?** Should the log exist at all for other users of the public site, still off by default and on-device? (Recommended: yes for both, off by default.)
2. **Finished signal:** rating ≥ **3**? Picked counts? Age threshold **14 days**? Count exports only when recorded (they aren't today)?
3. **Thumbnails in the log** (64–96 px, about 3–6 KB each, needed only for a later CNN): on by default when the log is on?
4. **`exported_at`:** record exports always (useful for a "Recently exported" collection), or only while the log is on?
5. **Backups:** include the edit log by default?
6. **White balance:** today's Auto leaves WB alone by your decision. Should "My style" learn and set WB offsets (and Vibrance/Saturation) later?
7. **First formulation:** start with **T** (predict look targets; the solver sets sliders; PV-free; older builds can re-run it) and add Shadows via **R**, as recommended?
8. **Data from other users:** (a) only (recommended), (a) + manual file donation, or a server route (accepting the change to "never leaves your computer" and a legal review)?
9. **Your own model as everyone's starter prior** (§5.4 option 2): acceptable to publish your taste as a small static file?
10. **The A/B bar:** what result would make "My style" worth keeping (e.g. you prefer it in ≥ 60 % of blind trials and it has lower median ΔE than standard Auto)?
11. **Backfill:** willing to reconnect the folders of your already-edited photos so features can be computed? (IMPROVEMENTS §5 Q9 asked about labelling 200–500 photos; with the log, no extra labelling is needed, only finished edits.)

---

## Sources read for this plan

- `docs/PLAN.md`: Decisions (AI local only, Auto and WB), Phase 1 Part 2b, Phase 2 (Auto tunable), Phase 4 ("Results stay ordinary, editable sliders").
- `docs/research/IMPROVEMENTS.md`: §2 (A7 row and notes), C19 row, §3, §5.
- `docs/research/AI_MODELS.md` §3: no licence-clean pretrained tone model; FiveK and PPR10K terms.
- `docs/PHASE2.md:157`: Auto speed.
- `README.md`: the "never leave your computer" promise.
- Code, all under `web/src/`:
  - `engine/develop/auto.ts`, `engine/develop/settings.ts`, `engine/develop/process.ts`, `engine/gpu/develop-engine.ts`
  - `catalog/schema.ts`, `catalog/catalog.worker.ts`, `catalog/types.ts`, `catalog/thumbs.ts`
  - `develop/history.ts`, `develop/DevelopView.tsx`, `develop/AutoControls.tsx`, `develop/batch.ts`, `develop/paste.ts`, `develop/source.ts`
  - `sidecar/xmp.ts`, `export/run.ts`, `backup/backup.ts`, `settings/store.ts`, `platform/handle-store.ts`, `engine/lens/lens-db.ts`, `engine/detail/noise-db.ts`, `pwa/sw.ts`
- No web sources were fetched for this plan. Statements about law, papers and libraries are marked [unconfirmed] or [needs review].

---

## Owner's decisions (2026-10-13)

- **Other users' data:** per-user models only, trained on each user's own device. No collection, upload or donation flow, so LightBench stays local-only.
- **Edit log:** later, not in the next build slot.
