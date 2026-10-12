# LightCraft: review for LightBench

_Written 2026-10-12. Source: the shallow clone in a local shallow clone (single commit `701f78e`, "Release 0.7.1", 2026-10-12). I only read the files. Nothing was built or run. All paths below are relative to the clone unless they start with `darktable:` (the local darktable source, `/home/user/darktable-org/darktable-full/src`) or `LightBench:` (`/home/user/Photo-Editing-App`). Everything marked **(unverified)** is my reading or inference and was not checked against a running program, a real file or a primary source._

## Summary

- **What it is.** LightCraft is a pure-Rust copy of Lightroom (about 202,000 lines, written in about two weeks, mostly by AI agents) that also runs in the browser. Its own documents call it **alpha**. In the browser, all image processing runs on the CPU in WebAssembly. Its WebGPU path is not done. So its speed figures don't apply to LightBench's WebGPU engine.
- **Licence.** The code is MIT OR Apache-2.0, except `crates/segment` and `crates/fetch`, which are Apache-2.0 only. Both licences are compatible with LightBench's GPL-3.0: we can port code with attribution. It **bundles no lens data**. Lensfun is read from a folder the user supplies. The only third-party data it ships is 52 camera matrices fitted from rawtoaces-data (Apache-2.0, plus CC-BY-4.0 for the CIE colour-matching functions). Its AI masks need **SAM 3**, which LightBench's rules exclude.
- **Most useful for us:**
  - **Crop:** its crop-geometry code is small, well tested and Lightroom-like.
  - **Upright:** its design notes, especially storing the solved transform and its rules for when Auto may act.
  - **Lens corrections:** its method for checking embedded corrections against the camera's own JPEG.
  - **Fujifilm:** its measured findings on Fuji lens tables.
  - **Lightroom catalog:** a working map of the tables, fields and decoding needed for import.
- **Use with care:**
  - darktable's `lens.cc` already reads embedded corrections for more makers (Sony, Fujifilm, DNG, Olympus, Panasonic) than LightCraft does. LightCraft trusts Sony data on **one body only** and found problems on others. Neither program corrects Nikon from embedded data.
  - LightCraft's catalog import has **no stacks**, and its tests use synthetic SQLite files. It does **not remove** our need for a real catalog to test against, but it lowers the risk.

---

## 1. What LightCraft is

### Architecture
- **Workspace.** 24 library crates, 3 apps and `xtask`, arranged in layers L0–L6. A build check enforces that no crate below L5 depends on the UI (`docs/architecture.md`).
  - L0 maths, colour, rasters and TIFF.
  - L1 `raw` decoders, `codecs`, `meta` (EXIF/XMP/IPTC), `develop` (the edit model).
  - L2 `pipeline`: the CPU renderer, which is also the reference.
  - L3 `gpu`, `catalog`, `preview`, `merge`, `segment`.
  - L4 `engine`: commands, history, import, export, Lightroom import.
  - L5 `ui-egui`, `mcp`.
  - L6 the desktop, CLI and web apps.
- **Everything is a command.** Each command has an id, label, menu path, shortcut and parameters. The UI, CLI, a JSON control channel and an MCP server all call commands by id (`docs/architecture.md`, "Agent control").
- **One resample for all geometry.** The pipeline works in linear float, independent of resolution. It caches stages, keeps a source pyramid, and does lens correction, perspective, crop, straighten and flips in **one** resample (`crates/pipeline/src/geometry.rs`, `crates/pipeline/src/optics.rs`).
- **GPU.** `crates/gpu` runs the same stages as WGSL compute shaders through wgpu (Metal, DX12, Vulkan). It is checked against the CPU path to within 1/255 and falls back to the CPU on any error (`docs/gpu-pipeline.md`).
- **Web build.** `apps/lightcraft-web` runs the same egui UI compiled to WebAssembly and drawn with WebGL2.
  - Rendering runs in up to four Web Workers, each with its own copy of the module.
  - The library is kept in OPFS, or IndexedDB as a fallback.
  - About 3.1 MB over the wire with brotli (`docs/web.md`).
  - On wasm32 the GPU crate "compiles to the CPU fallback": WebGPU is listed as an open item (`docs/gpu-pipeline.md`, lines ~128 and ~302).
  - Not available in the browser: Lightroom catalog import, model downloads, JPEG XL export and the control channel/MCP (`docs/web.md` "Not yet"; `docs/lightroom-catalog-import.md`; `crates/fetch/src/lib.rs`).

### Maturity: what its own documents say
- **Overall** (`ROADMAP.md`, reviewed 2026-10-10/11):
  - Stage **alpha**.
  - Checklist breadth 81.1% of 517 rows.
  - "Ready for real work" about 61%; beta is 340–600 agent-hours away.
- **"Optics, lens profiles, crop and geometry"** is rated 50% ready, 80% breadth.
- **Main gaps** (`docs/gaps.md`):
  1. Camera colour is estimated per file from the camera JPEG, not measured.
  2. CR3 works on 4 verified bodies.
  3. Rendering is "tuned by eye" and not measured against Lightroom.
  4. AI masks are heuristics, except SAM 3.
  5. "No lens profile database".
  6. Tests run in CI on FreeBSD only.
  7. Windows and Linux runtimes are little tested.
- **Crop and rotate rows** are all ✅ (`docs/parity-checklist.md` §H). Upright and manual transform are ✅. "Lens profile corrections" is 🟡 (row LR-EDIT-OPTICS-PROFILE).
- **Its documents disagree in places.**
  - `docs/raw-parity.md` "Lens profiles" still lists 0 database and no Fujifilm.
  - `docs/fuji-lens-corrections.md` and `crates/lensdb` show both exist.
  - Take any single document's figures with care.

### Dates and version
- `Cargo.toml`: version 0.7.1, Rust edition 2024, licence `MIT OR Apache-2.0`.
- The roadmap progress log starts on 2026-09-30, with "≈ 8 h elapsed" the same day. `docs/whats-new.md` runs from 2026-10-02 to 2026-10-11.
- Hours in the documents are "Opus 5.5 agent wall-clock hours" (`ROADMAP.md`). In other words, it is a very young code base, written very fast and mostly by agents.

---

## 2. Licensing, precisely

| Part | Licence | Source |
|---|---|---|
| Most crates and apps | MIT OR Apache-2.0, at your option | `Cargo.toml` `[workspace.package]`, `LICENSE-MIT`, `LICENSE-APACHE` |
| `crates/segment` (SAM 3 inference, ported from Hugging Face Transformers) | **Apache-2.0 only** | `crates/segment/Cargo.toml`, `NOTICE` |
| `crates/fetch` (HTTPS model downloader) | **Apache-2.0 only**; I found no reason given | `crates/fetch/Cargo.toml`, `crates/fetch/README.md` |
| `crates/inpaint` (PatchMatch / membrane fill) | MIT OR Apache-2.0; ported from PhotoCraft, "Copyright the PhotoCraft contributors" | `NOTICE`, `crates/inpaint/src/lib.rs` |
| Camera matrices for 52 bodies, `crates/raw/src/spectral_table.rs` | Fitted from rawtoaces-data v1.1.0 (Apache-2.0; spectral data by Weta Digital, scitech, NPL) and the CIE 1931 colour-matching functions (CC-BY-4.0) | `NOTICE`, `assets/ATTRIBUTION.md` |
| Camera colour profiles `assets/camera-profiles/*.json` (ILCE-7CR, ILCE-7M4, X-H2S, X-T4); Sony DRO-off curve `assets/camera-tone/sony-dro-off.json` | MIT OR Apache-2.0; fitted to contributors' and CC0 photos | `assets/ATTRIBUTION.md` |
| Inter font | SIL OFL 1.1 | `assets/fonts/OFL-Inter.txt` |
| Showcase photos (Ansel Adams, Lange, NASA) | Public domain | `assets/ATTRIBUTION.md` |
| App icon | MIT OR Apache-2.0 | `assets/app-icon/LICENSE.txt` |
| ArtCraft name, wordmark and logos (`docs/brand/`) | **Trademarks, not open source.** Forks must remove them and must not imply ArtCraft endorsement | `docs/brand/LICENSE-brand.txt` |
| Lens data | **None bundled.** Lensfun XML is read from `LIGHTCRAFT_LENSFUN_DIR`; LightCraft says lensfun data is CC-BY-SA 3.0 | `docs/lens-profiles.md`, `crates/engine/src/lens_profiles.rs` |
| GeoNames place names | Downloaded on request, CC-BY-4.0, not bundled | `NOTICE` |
| `craft-ui` UI library (git dependency) | Not checked; it is UI code we would not reuse | `Cargo.toml` |

### What LightBench (GPL-3.0-or-later) can reuse
This is my understanding, not legal advice.

- **Code.** MIT code, and Apache-2.0 code under GPLv3 (the FSF lists Apache-2.0 as compatible with GPLv3), can be translated into TypeScript or WGSL and shipped under GPL-3.0. For the dual-licensed crates, choosing the MIT option is simplest.
  - Keep "Copyright (c) 2026 ArtCraft Team and the LightCraft contributors" and the MIT licence text in `LightBench: THIRD_PARTY_NOTICES.md`.
  - Mark each ported file as ported and modified, as LightCraft itself does for PhotoCraft code.
  - For anything from `crates/segment` or `crates/fetch` (Apache-only), include the Apache-2.0 text, the relevant `NOTICE` lines and a statement of changes. Nothing in those two crates is needed now.
- **Data.**
  - The 52 spectral matrices: usable with Apache-2.0 attribution, plus CC-BY-4.0 attribution to the CIE and credit to the rawtoaces-data measurers.
  - The four camera-profile JSON files: usable under MIT. They are tied to LightCraft's own profile format and colour pipeline, so they are of little use to a darktable-based engine.
  - LightBench already gets matrices through LibRaw and darktable.
- **Facts.** Model lists, tag numbers and measured findings (for example Fujifilm's table layout) are not copyrightable as facts. Cite them anyway.
- **Names.** Do not use the ArtCraft marks or the "LightCraft" name to describe LightBench, beyond plain-text credit.
- **Lensfun.** The licence is CC-BY-SA 3.0 per LightCraft's doc **(unverified here; check lensfun's own README)**. Downloading it on first use, as the owner chose, keeps it separate from LightBench's code. If LightBench ever hosts a copy (for example on the Pages site), that copy must carry attribution and stay under CC-BY-SA. CC-BY-SA 3.0 is not formally GPL-compatible; 4.0 is one-way compatible. So keep lensfun data a separate download, not merged into the code.

### Against the owner's permissive-only AI rule
- **SAM 3:** used by Object/Describe masks (`crates/segment`, `docs/ai-masks.md`). The weights are under Meta's SAM License. This is **excluded** by the owner's rule. Do not take this path.
- **AI raw denoise:** offers RawNIND UtNet2 weights under **GPL-3.0** as an opt-in (`NOTICE`). The default build only accepts user-supplied models.
  - GPL-3.0 allows commercial use but is copyleft, not "permissive".
  - Whether that is acceptable is **an owner decision**. RawNIND's training-data terms were not checked.
- **YuNet face detection:** the weights are MIT, but LightCraft itself flags that the WIDER FACE training data has its own terms (`docs/faces.md`, line ~12). LightBench's own AI research already lists YuNet; the same caveat applies.
- **Face recognition models:** user-supplied (AuraFace mentioned, size 261 MB). LightCraft lets users add non-commercial models such as InsightFace for their own use (`docs/faces.md`, line ~68). LightBench's rule excludes offering those, even as optional downloads.
- **Safe on this rule:** the heuristic masks, PatchMatch inpainting, and the face-model download dialog, which shows licence, commercial use and training data before download (`docs/faces.md`, "Downloading a model").

---

## 3. Directly useful for each near-term item

### 3.1 Crop / Straighten / Rotate / Flip, and the tool stack

**What LightCraft does**

- **Crop model** (`crates/geom/src/crop.rs`, `CropGeometry`):
  - The crop is a normalized rectangle in the straightened frame, plus an angle (−45…45°, clockwise positive).
  - 90° rotation is a separate `orientation` in the develop settings (`crates/engine/src/cmd/library.rs`, `rotate`, commands `photo.rotateLeft/Right`, ⌘[ / ⌘]).
  - Flips are `crop.flip_h/flip_v` (`crates/develop/src/settings.rs` `Crop`), applied to the output and shown in the crop view too (`crates/pipeline/src/geometry.rs` comment "a flip is not part of the crop").
- **One rule for every way of setting the angle** (`CropGeometry::with_angle`): keep the crop if it still fits inside the rotated photo; otherwise use the largest centred crop of the same aspect.
  - This applies to the rotate handle, the slider, the typed Angle field and the API.
  - It fixed a bug where exports showed smeared edge pixels (issue #742, `docs/parity-checklist.md` row LR-CROP-STRAIGHTEN).
  - It uses a closed-form largest-inscribed-rectangle helper (`max_inscribed_scale`, `crop_fit_angle`).
- **Handle drags** (`crates/geom/src/crop_drag.rs`, `drag_crop`). Guarantees, for any input:
  - the result stays inside the rotated image;
  - the edges opposite the handle stay put;
  - an aspect lock holds on every handle;
  - a drag stops at the image edge and slides along it (bisection).
  - Shift keeps the current proportions for one drag only; the Lock toggle is untouched (`crates/engine/src/cmd/develop.rs`, `crop.drag`).
- **Commands** (`crates/engine/src/cmd/develop.rs`):
  - `crop.aspect`: presets original, free, current, toggle, 1×1, 4×5, 8.5×11, 5×7, 2×3, 4×3, 16×9, 16×10, or a custom W×H.
  - `crop.rotateAspect` (key **X**), `crop.straighten`, `crop.autoStraighten`, `crop.reset`.
- **Straighten tool** (`crates/ui-egui/src/panels/detail.rs`, `straighten_overlay`):
  - Drag a line along a horizon or vertical. It snaps to the nearest axis within ±45°, so a near-vertical line straightens plumb lines.
  - Double-click runs Auto.
  - In the crop tool, ⌘-drag draws a level line without switching tools.
  - Dragging outside the box rotates it, with a curved double-arrow cursor and a live angle readout (`rotate_cursor`, `angle_readout`; issue #534).
  - An Angle field accepts typed values, including a decimal comma; Esc cancels.
- **Auto straighten** uses the Upright line detector and only acts when horizontals and verticals agree (`crates/pipeline/src/upright.rs`, `level_degrees`).
- **Display details:**
  - Overlays: thirds, grid, golden ratio, diagonal, triangle, golden spiral; ⇧O mirrors them (`crates/ui-egui/src/panels/crop_overlay.rs`, row LR-CROP-OVERLAY).
  - The area outside a rotated box is dimmed as one mesh, so wedges are never double-dimmed (`outside_crop_mesh`, issue #731).
  - Double-click inside the box, or Return, applies the crop.
- **Constrain Crop** (after lens or perspective warps): shrinks the crop about its centre until no blank area remains. It does this by binary search, checking 49 points per edge through the warp. It runs at render time and is not stored (`crates/pipeline/src/geometry.rs`, `constrain_to_image`).
- **On-screen behaviour.** In LightCraft's crop view the **image stays unrotated and the box rotates** ("The image is shown unrotated in the crop view", `detail.rs` around line 2286). As I understand Lightroom, it rotates the photo under a level box **(unverified here)**. This is a visible UX choice for the owner.

**How darktable differs** (verified that the files exist; behaviour from memory, **unverified in detail**)
- darktable splits this work across several modules: crop (`darktable: iop/crop.c`), rotation and perspective (`iop/ashift.c`), orientation (`iop/flip.c`) and lens (`iop/lens.cc`).
- Each module has its own parameters, and each distorting module resamples on its own.
- The angle comes from ashift's rotation slider or a drawn line.

**Ideas for LightBench**
- Use a Lightroom-style crop state: rect + angle + aspect lock + flips, with orientation separate. The renderer can map it onto darktable's crop, ashift and flip parameters, or do it in one combined WGSL resample.
  - LightCraft shows the single-resample approach works and keeps detail: one interpolation instead of three or four.
  - The choice is engineering, not capability. Check it against darktable before deciding, per the owner's "darktable first" rule.
- Port `with_angle`, `max_inscribed_scale`, `crop_fit_angle` and `drag_crop` (about 680 lines of Rust in total, with tests) into TypeScript. They encode the Lightroom behaviours people expect (constrain to image, anchored edges, aspect lock, sliding at edges) and their tests are a ready checklist.
- Copy these interaction details:
  - ⌘-drag to level inside the crop tool;
  - double-click for Auto;
  - snapping to the nearest axis;
  - typed angle with a decimal comma;
  - angle readout while rotating;
  - X swaps the aspect;
  - Shift keeps the ratio for one drag.
- **Tool stack and jump bar.** LightCraft has no scrolling stack with a jump bar. It uses Lightroom-style tool modes (Edit / Crop / Masking / Remove) and dockable panels. One thing worth taking: an **eye toggle on each group header** that turns that group's adjustments off without losing them (row LR-EDIT-SECTION-TOGGLE, `cmd:develop.sectionEnabled`). It fits the stack well.

### 3.2 Lens corrections

**Where LightCraft's lens data comes from.** There is **no lens database of its own and no bundled data.** There are two sources:

1. **Corrections embedded in the raw file**, turned into DNG `WarpRectilinear` / `FixVignetteRadial` opcodes so they all share one path (`crates/engine/src/files.rs`, `embedded_lens`):
   - **DNG:** opcode lists, including DNG 1.6 `WarpRectilinear2` chains (row LR-EDIT-OPTICS-PROFILE).
   - **Panasonic / Leica RW2:** tag `0x0119` distortion (`crates/raw/src/vendor/rw2.rs`, `distortion`). Validated on 79 photos from 13 bodies.
   - **Sony ARW:** tag `0x7037`, distortion only, **for the ILCE-7RM4A only** (`crates/raw/src/vendor/arw_lens.rs`, `distortion`, exact check `model != "ILCE-7RM4A"`).
     - Vignetting and lateral CA tables are not decoded.
     - Other bodies are refused on purpose. LightCraft says refusing the A7 III tables "resolves the unverified corner warp identified in review" (`docs/sony-lens-corrections.md`).
   - **Fujifilm RAF:** tags `0xf00b` (distortion) and `0xf010` (vignetting), for 59 listed bodies (`crates/raw/src/vendor/raf_lens.rs`, `VALIDATED`).
     - Lateral CA (`0xf00f`) is **not** applied. In LightCraft's pipeline it over-corrected (`docs/fuji-lens-corrections.md`).
     - Bodies whose table scale doesn't match the image half-diagonal are skipped: X-S20, X-T30 III, X-M5, X-T5 in crop.
   - **Nikon:** nothing.
2. **A lensfun-format XML database that the user supplies**, from the folder named in `LIGHTCRAFT_LENSFUN_DIR` (`crates/engine/src/lens_profiles.rs`, `database`, `lookup`, `for_raw`; parser and maths in `crates/lensdb/src/lib.rs` and `model.rs`).
   - Used only when the file has no embedded correction.
   - Because it is set by an environment variable, in practice it is desktop and CLI only **(inferred: the browser has no environment)**.
   - There is no switch for it in Settings yet (row LR-EDIT-OPTICS-PROFILE).
   - **The lensfun path's details** (`crates/lensdb`, `docs/lens-profiles.md`):
     - **Supported models:** distortion poly3 / poly5 / ptlens, TCA linear / poly3, vignetting `pa`.
     - **Lens matching:**
       - names are split into words;
       - every number in the database name must appear in the EXIF name, and the other way round;
       - makers must agree;
       - a mount mismatch costs a 0.8 factor;
       - the score must be at least 0.6 (`find_lens`, `name_score`).
     - **Interpolation:**
       - by focal length, linearly;
       - vignetting by aperture in stops and by 1/distance;
       - focus distance is not read yet.
     - **Conversion:** each profile is converted by least squares into the DNG polynomials and rejected if the error exceeds 0.001 of the half-diagonal or the map folds (`Profile::correction`, `fit_even4`, `fit_gain5`).
     - **Not handled:** lensfun's `<center>` offsets and fisheye lenses.
     - **Not validated:** "Not yet validated against real photos and another renderer" (`docs/lens-profiles.md`, Limits).

**On by default.** New imports have embedded corrections switched on (`docs/sony-lens-corrections.md`). "Reload from Disk" reads lens data for photos imported without it, and switches correction on only for photos still at their import settings (issue #314, row LR-EDIT-OPTICS-PROFILE). This matches the owner's "on by default when a profile is found" without touching existing edits.

**How darktable differs** (verified in `darktable: common/exif.cc`, `_check_lens_correction_data`, and `iop/lens.cc`, "embedded metadata" method)
- darktable reads embedded corrections for **Sony** (distortion **and** CA **and** vignetting, from `0x7037` / `0x7035` / `0x7032` in SubImage1, any model whose counts are consistent), **Fujifilm** (distortion, CA and vignetting, 9- or 11-knot layouts, with a 1.25 factor for crop mode), **DNG**, **Olympus** (`0x150a` distortion, `0x150c` CA) and **Panasonic** (`0x0119`).
- Like LightCraft, it has nothing for Nikon.
- Its lensfun method calls the lensfun library (LGPL) directly.
- So for Sony and Fujifilm, darktable already does **more** than LightCraft. LightCraft's contribution is evidence about where those tables can go wrong.

**Ideas for LightBench**
- **Embedded corrections:** use darktable's embedded-metadata code as the base. It is GPL and covers more makers. Then apply LightCraft's caution and testing method:
  - **Sony.** Before trusting a body, compare our corrected render with the camera's own lens-corrected JPEG near edges and corners, the way LightCraft did with feature residuals (`docs/sony-lens-corrections.md`, Validation). LightCraft found per-body differences in scale and normalization. darktable applies all bodies. **We don't know which is right for the owner's Sony body. Test it.**
  - **Fujifilm.** Cross-check darktable's reader against LightCraft's findings:
    - `scale × n` = half-diagonal;
    - some bodies store the 40 MP value;
    - lookup by source radius with the camera's frame-filling zoom;
    - the sign is confirmed.
    LightCraft's claim that the CA table over-corrects **conflicts with darktable applying it**. Treat it as unresolved and test it.
  - **Nikon** (the owner's D5200) will rely on lensfun.
- **Lensfun in the browser:** port LightCraft's `crates/lensdb` to TypeScript (about 1,000 lines of Rust including tests). It is self-contained:
  - XML loading;
  - EXIF name matching;
  - interpolation;
  - conversion to radial polynomials that one WGSL warp can apply.

  The alternative, compiling the lensfun C library to WASM, is heavier. Darktable's lensfun code is a check on the maths, especially the normalization (distortion radius 1 = half the shorter side; vignetting radius 1 = the corner, per `crates/lensdb/src/model.rs`).
- **Data download.** Fetch the lensfun `data/db/*.xml` on first use. Options:
  - straight from GitHub (whether raw.githubusercontent.com allows cross-origin requests is **unverified**);
  - a copy on the Pages site, which then must carry CC-BY-SA attribution.

  This is an owner choice. Keep the version and SHA-256 of what was downloaded, as LightCraft's `crates/fetch` does for models.
- **Engineering details worth copying:**
  - Turn all lens sources into one internal form, so one control ("Enable profile corrections", plus distortion and vignetting amounts) drives them all.
  - Refuse to apply a correction whose fit error is too large or whose map folds.
  - Store which source was used, so the UI can say "From the camera's own data" or "From lensfun: <lens name>".

### 3.3 Transform / Upright

**What LightCraft does** (`crates/pipeline/src/upright.rs`; settings `Geometry` and `Upright` in `crates/develop/src/settings.rs`)
- **Modes:** Off, Auto, Guided, Level, Vertical, Full. Manual sliders: vertical, horizontal, rotate, aspect, scale, offset X/Y. Plus Constrain Crop.
- **Line detection** is its own design:
  - Sobel gradients;
  - region growing by the orientation of the edge;
  - a fitted line segment per region;
  - minimum length 4% of the long edge (`detect_segments`).
  - It runs on the lens-corrected image at 1,024 px and is cached (`analyze_source`).
- **Vanishing points:** RANSAC plus a weighted least-squares refinement, with a reliability gate (`analyze`, `reliable`).
- **Correction:** a virtual camera rotation K·R·K⁻¹. The focal length is estimated from orthogonal vanishing points when possible (`solve`).
- **Auto rules** (`solve`, `Upright::Auto`):
  - a camera roll must be confirmed by the horizontals (within 3°);
  - Full only if the rotation is under 20°;
  - otherwise Vertical if under 25°;
  - otherwise Level only for tilts of 5° or less.
  - These are guards against "correcting" trees or roads.
- **Guided:** up to 4 drawn lines (`solve_guided`). Two lines near vertical fix verticals, two near horizontal fix horizontals, one of a kind only levels. ⇧G starts Guided (row KEY-GUIDEDUPRIGHT).
- **The solved transform is stored** in the settings (`Geometry.upright_transform`), so preview and export use exactly the same matrix and do not re-detect lines. `resolve` fills it in for settings that name a mode but carry no transform, such as XMP imports.
- **Tests are on synthetic scenes only** (`crates/pipeline/src/tests_geometry.rs`: `upright_vertical_fixes_converging_verticals`, `upright_level_straightens_a_tilted_horizon`, `guided_upright_from_two_vertical_guides`, `upright_auto_leaves_natural_scenes_nearly_alone`). I found no comparison with Lightroom.

**How darktable differs**
- darktable's ashift (`darktable: iop/ashift.c`, `ashift_lsd.c`) uses the LSD line detector and fits rotation, vertical/horizontal lens shift and shear by optimization.
- It has methods auto / quad / lines and fit flags such as `ASHIFT_FIT_VERTICALLY` and `ASHIFT_FIT_BOTH`.
- These map closely onto Lightroom's Level / Vertical / Full / Guided.

**Ideas for LightBench**
- Keep darktable's ashift as the engine (owner's "darktable first" rule). Map: Level → rotation only; Vertical → rotation + vertical shift; Full → both; Guided → ashift's line or quad methods.
- Adopt from LightCraft:
  1. Store the fitted result so renders are deterministic.
  2. Its conservative Auto rules.
  3. Reuse the same line analysis for the crop's Auto straighten.
  4. Show a fine grid while a transform slider is dragged (row LR-EDIT-GEOM-GRID).
  5. Read `crs:PerspectiveUpright` codes 0–5 on XMP import (0 off, 1 auto, 2 level, 3 vertical, 4 full, 5 guided; `crates/engine/src/crs.rs`, `docs/xmp-interop.md`).

### 3.4 Lightroom catalog import (postponed)

**What LightCraft reads** (`crates/engine/src/lightroom_catalog.rs`, `read_with_progress`, `apply_prepared`; SQLite reader `crates/engine/src/lightroom_sqlite.rs`)

| Table | Columns used | For |
|---|---|---|
| `AgLibraryRootFolder` | `id_local`, `absolutePath`, `name`, `relativePathFromCatalog` | root folders; falls back to the path relative to the catalog when the absolute path is missing |
| `AgLibraryFolder` | `id_local`, `rootFolder`, `pathFromRoot` | folders |
| `AgLibraryFile` | `id_local`, `folder`, `idx_filename` | file names |
| `Adobe_images` | `id_local`, `id_global`, `rootFile`, `rating`, `pick` (1 pick, −1 reject), `colorLabels` (text name, matched to label names), `captureTime`, `orientation`, `fileWidth`, `fileHeight`, `fileFormat`, `masterImage` + `copyName` (virtual copies) | the photo record |
| `Adobe_imageDevelopSettings` | `image`, `text` (a Lua table, e.g. `s = { CropAngle = … }`) | develop settings, parsed by `crate::preset_import::parse_lua` and mapped through the same `crs:` mapper as XMP |
| `Adobe_AdditionalMetadata` | `image`, `xmp` (a BLOB: 4-byte big-endian length, then zlib) | the XMP packet (`decode_xmp_bytes`) |
| `AgLibraryKeyword`, `AgLibraryKeywordImage` | `id_local`, `name`, `parent`; `tag`, `image` | hierarchical keywords (parent chain, cycle-checked) |
| `AgLibraryCollection`, `AgLibraryCollectionImage`, `AgLibraryCollectionContent` | (whole rows) | collections; smart collections become plain albums |
| `Adobe_libraryImageDevelopHistoryStep`, `Adobe_libraryImageDevelopSnapshot` | (whole rows) | archived only, not turned into editable history |

**Useful details to reuse**
- **Lightroom's `orientation` codes** (`AB` upright, `BC` quarter turn clockwise, `DA` counter-clockwise, `BA` mirrored), mapped to the 8 EXIF orientations (`lightroom_orientation`).
- **Crop conversion:**
  - `CropLeft/Top/Right/Bottom` are on the stored, unoriented image.
  - The angle turns the other way from LightCraft's, and the other way again when the photo is mirrored (`catalog_crop`).
  - Its comment says that on a real catalog this reproduced the aspect of **all 223 straightened crops** in Lightroom's exports to within 1%.
  - A test uses two settings strings and export sizes from a real catalog (`straightened_catalog_crops_match_lightroom_exports`).
  - Catalog settings have crop fields but no `HasCrop`, so any crop field means "cropped" (`mapped_settings`).
- **Special values:**
  - Lightroom's `-999999` (deferred Auto) is dropped, never clamped into a slider (`strip_lua_sentinels`).
  - A Custom white balance on raws that LightCraft edits on a relative scale stays As Shot and is reported (issue #510).
- **Safety:**
  - read-only;
  - committed `-wal` pages are applied after their checksums are validated (`committed_wal_len`);
  - the read is refused if the catalog changes during the read;
  - limits: 1 GiB database, 1 million rows per table;
  - one undo step;
  - recovery archives of the source settings.

**Not covered:** **stacks.** No stack table is read, and the owner chose to import stacks. LightBench would have to identify Lightroom's stack tables itself. I did not verify their names. The desktop only; the browser build refuses catalog import.

**How it was tested**
- Unit tests build tiny SQLite files in code, one row per table (`native_catalog`, `photo_tables`, `reads_native_sqlite_tables_without_lightroom_or_external_processes`), plus hand-made rows (`sample`).
- Real-catalog evidence is limited to the two crop cases and the comment about 223 crops. No real `.lrcat` is in the repository.
- `AGENTS.md` (line 60, read as data) says the maintainers observe an installed Lightroom without changing it, and issues #510, #730 and #891 suggest real users ran the import.

**Could it unblock our postponed import?** **Partly.**
- **It gives** a credible, permissively licensed map of the tables and columns, the XMP BLOB format, the Lua settings format, orientation codes, the crop mapping and the pitfalls. LightBench could build synthetic `.lrcat` fixtures from it with sql.js or its existing SQLite-WASM.
- **It does not give** proof that the schema is the same across Lightroom versions, or anything for stacks.
- **My recommendation:** still test on at least one real catalog before calling it supported. Alternatively, ship it marked "experimental, untested on real catalogs", which would be an owner decision.
- **Browser specifics to check in a spike:**
  - The user would pick the catalog's folder (to get the `-wal` file too).
  - SQLite-WASM would open the bytes read-only.
  - Applying a pending WAL may need care; closing Lightroom first probably avoids it **(unverified)**.
  - `DecompressionStream('deflate')` can decode the XMP BLOBs **(the zlib-wrapped "deflate" format, unverified in our code)**.
- darktable's `develop/lightroom.c` (already noted in `LightBench: docs/USABILITY.md`) handles the XMP side. LightCraft adds the catalog side.

### 3.5 XMP interop and process versions

- **Sidecar writing** (`docs/xmp-interop.md`):
  - It writes standard fields and keeps its full edit as JSON in `lc:settings`.
  - It **merges into an existing sidecar, keeping every other namespace byte for byte**.
  - An unreadable sidecar is backed up to `<name>.xmp.bak-<time>` before it is replaced.
  - `xmp:Rating="-1"` reads as reject.
  - With RAW+JPEG pairs sharing a name, the raw owns `NAME.xmp` and the JPEG uses `NAME.JPG.xmp`.
  - LightBench already merges (`LightBench: web/src/sidecar/sync.ts`, `writeXmp(existing, …)`) and has an `owner` notion. Compare the backup-on-unreadable and the RAW+JPEG rules.
- **Reading `crs:` develop fields:** the table in `docs/xmp-interop.md` maps Lightroom's fields to its controls. It can be checked against darktable's `lightroom.c` for our approximate "Basic sliders" import. Notes:
  - Only names from process version 2012 on are read.
  - `crs:AlreadyApplied="True"` packets are skipped.
  - Red/green/blue curves are applied only if the master and all three channel curves are present. That is its observation of Lightroom Classic, **unverified**.
  - Saved `UprightTransform_*` matrices are not imported; the mode is re-solved and the user is warned.
- **Caution, an inconsistency I found:**
  - The XMP path (`crates/engine/src/crs.rs`, crop block around line 436) copies `CropAngle` and the crop edges as they are.
  - The catalog path (`catalog_crop`) reverses the angle and re-orients the edges.
  - I could not tell which is right for sidecars. darktable's `lightroom.c` also reverses `CropAngle` (line 501), but into its own module's convention.
  - LightBench should test rotated and straightened Lightroom sidecars when it gets there.
- **Process versions** (`docs/process-versions.md`; `ProcessVersion` in `crates/develop/src/settings.rs`):
  - Each photo records which rendering process interprets its settings.
  - A change that alters how existing settings look ships as a new version. Old photos keep theirs until "Update to Current Process".
  - Settings with no version field load as V1. Copy, paste and presets never carry the version.
  - Unknown future numbers load and are kept.
  - LightBench's settings carry `version: 1` (`LightBench: web/src/engine/develop/settings.ts`), which looks like a schema version, not this.
  - Given the owner's "compatible edits" release rule, and that slider-to-darktable mappings will be retuned, **this is worth adopting early**. Rough size S–M.

### 3.6 Keyboard shortcuts (follow-ups from `docs/library-shortcuts.md` and `crates/ui-egui/src/shortcuts.rs`)

- **`[` / `]` step ratings** down and up, one undo step for the selection. In Develop masking and Remove, the same keys resize the brush, and Shift+`[` / `]` changes feather.
- **Shift + 0–9 / P / X / U applies and moves to the next photo.** Handle Shift+digit by **physical key** (`KeyboardEvent.code`), because Shift+1 reports `!` on many layouts. Letters follow the layout (`KeyboardEvent.key`).
- **Purple has no number key**, matching Lightroom Classic per LightCraft's reading of Adobe's help page. That reading is **unverified by us**.
- **X** swaps the crop aspect in the crop tool. **A** toggles the aspect lock (row LR-CROP-ASPECT).
- **The user's keymap is stored as differences from the defaults** (`Keymap`), and some keys are reserved (`RESERVED`).
- **Secondary (alias) bindings**, plus a unit test `no_conflicting_bindings` that fails when one key would trigger two actions (`docs/ui-parity.md`, "Shortcuts"). That test is cheap and worth having for the Lightroom preset.
- **Text fields keep their keys.** LightBench already does this (`LightBench: web/src/lib/keys.ts`, `isTextEntry`).

### 3.7 Later Phase 3 tools and Phase 4 AI

- **Tone curve.** `crates/pipeline/src/finish.rs`, `curve_luts`, shows Lightroom's parametric curve: 4 regions with 3 movable split points, composed with point curves.
  - The formula is LightCraft's own and tuned by eye. Use it for the UI's meaning, not for image quality.
  - Field names and defaults are in `crates/develop/src/controls.rs` (e.g. `curve.splitShadows` default 25).
- **HSL, colour grading, point colour, calibration.** `docs/xmp-interop.md` lists Lightroom's 8 HSL bands and the colour grading fields (Shadows/Midtones/Highlights/Global, Blending, Balance). This is useful for naming and for XMP import.
- **Masking.**
  - Mask types: brush, linear, radial, luminance/colour/depth range; add/subtract/intersect; invert (`docs/xmp-interop.md` "Local corrections").
  - **It reuses sky and person mattes that some DNGs carry (e.g. iPhone ProRAW)**, without any AI model (row LR-MASK-SKY, `crates/raw/src/semantic.rs`). This is a free, permissive win for phone DNGs.
  - Its Subject and Sky heuristics are weak by its own account (`docs/gaps.md` #5).
- **Heal and remove.**
  - **PatchMatch content-aware fill** (`crates/inpaint`, MIT, from published papers). It is a non-AI Remove that LightBench could offer before, or alongside, LaMa.
  - **Find Dust Spots** (`crates/pipeline/src/dust.rs`).
  - **Visualize Spots** (key A), red eye and catchlight (`crates/ui-egui/src/panels/right.rs`).
- **AI downloads (Phase 4).**
  - `crates/fetch`: mirrors, resume via `.part` files, pinned size and SHA-256, deletion on a failed check.
  - The face-model dialog shows licence, commercial use and training data before download.
  - Both match LightBench's "download on first use" plan. The fetch crate is native-only, so take it as a design, not code.

---

## 4. Other ideas worth considering

| Idea | Why | Rough size |
|---|---|---|
| **Check lens corrections against the camera's own JPEG** (feature residuals, or correlation after a warp), on a public CC0 corpus with pinned SHA-256 (`docs/fuji-lens-corrections.md` Validation; `docs/sony-lens-corrections.md`) | Lets us test lens and geometry work without Lightroom, which fits "do not make things up" | M |
| **Scripted slider benchmark at a URL** (`?bench` logs time from `develop.set` to the new texture; `docs/web.md`, "Measuring") | A ready pattern for the owner's "automated speed test before each release" | S |
| **Render only the visible window at 1:1** (`Frame::window`, `crates/pipeline/src/geometry.rs`; gap 4 in `docs/gaps.md`) | Makes "100% always shows true pixels" fast, not "a few seconds" | M |
| **Library backup and restore as a zip, plus a one-tab lock (Web Locks API)** (`docs/web.md`, "Keeping the library safe") | Data safety for an OPFS library; two tabs can overwrite each other. A quick grep found `navigator.storage.persist` in LightBench but no Web Locks or backup; please confirm | S–M |
| **Turn a mask or adjustment group off with an eye on its header** (row LR-EDIT-SECTION-TOGGLE) | Before/after per group in the scrolling stack, without losing settings | S |
| **Sky and person mattes embedded in DNGs** (`crates/raw/src/semantic.rs`) | Instant masks for iPhone ProRAW users with no AI model | S–M |
| **Non-AI content-aware fill (PatchMatch)** (`crates/inpaint`) | A permissive Remove fallback that works without downloading a model | M |
| **A test hook, e.g. `window.lightbench.command(id, json)`**, as LightCraft's `lightcraft.command` (`docs/web.md`, "Automation") | Lets headless-browser tests drive the real app | S |

---

## 5. Things to avoid, and cautions

- **Maturity and quality.** By its own account LightCraft is alpha:
  - render quality is tuned by eye;
  - camera colour is estimated per file from the embedded JPEG for most cameras (`docs/camera-preview-colour.md`);
  - tests run in CI only on FreeBSD (`docs/gaps.md` #1, #3, #9).

  Do **not** take its image-processing maths (tone curve, colour, sharpening) over darktable's. Use LightCraft for UI behaviour, file-format facts, data structures and test methods.
- **Its documents contradict each other in places** (lens status in `docs/raw-parity.md` vs `docs/fuji-lens-corrections.md`). Cite the code first.
- **Contradictions with darktable to resolve by testing, not by choosing a side:**
  - Sony embedded tables: one body in LightCraft, all bodies in darktable.
  - The Fujifilm CA table: not applied in LightCraft, applied in darktable.
  - The sign of the crop angle on XMP import.
- **Its descriptions of Lightroom's behaviour** are "observed" or "inferred" (e.g. lens profiles being always on in DNGs; the R/G/B curve rule). If LightBench relies on any of them, label them as unverified.
- **Lensfun conversion:** fitting lensfun's models into DNG polynomials is an approximation, and LightCraft has not validated it on real photos (`docs/lens-profiles.md`). If we port it, test on real lenses, starting with the owner's D5200 kit lens. Whether lensfun has a profile for that lens is **unverified**.
- **AI to stay away from** (owner's permissive-only rule):
  - SAM 3 code paths and weights (`crates/segment`);
  - InsightFace and other non-commercial face models;
  - RawNIND GPL denoise weights (owner decision).
- **Trademarks:** none of the ArtCraft marks may be used. Don't present LightBench as related to LightCraft.
- **Performance figures** from LightCraft's browser build are CPU-in-WASM and don't transfer to LightBench's WebGPU pipeline.
- **The clone is untrusted content.** I read its `AGENTS.md` and `CLAUDE.md` only as data.

---

## Main files read

- **Licensing and status:** `NOTICE`, `Cargo.toml`, `assets/ATTRIBUTION.md`, `docs/brand/LICENSE-brand.txt`, `ROADMAP.md`, `docs/gaps.md`, `docs/architecture.md`, `docs/web.md`, `docs/gpu-pipeline.md` (parts), `docs/parity-checklist.md` (geometry, lens and shortcut rows), `docs/whats-new.md` (parts).
- **Lens:** `docs/lens-profiles.md`, `docs/sony-lens-corrections.md`, `docs/fuji-lens-corrections.md`, `docs/raw-parity.md` (lens section).
- **Interop and keys:** `docs/lightroom-catalog-import.md`, `docs/xmp-interop.md`, `docs/process-versions.md`, `docs/library-shortcuts.md`.
- **Code:**
  - `crates/lensdb/src/{lib,model}.rs`, `crates/engine/src/lens_profiles.rs`, `crates/engine/src/files.rs` (`embedded_lens`);
  - `crates/raw/src/vendor/{arw_lens,raf_lens,rw2}.rs` (parts);
  - `crates/geom/src/{crop,crop_drag}.rs`;
  - `crates/pipeline/src/{upright,geometry,optics,finish}.rs` (parts);
  - `crates/engine/src/cmd/{develop,library}.rs` (crop and rotate);
  - `crates/ui-egui/src/panels/detail.rs` (straighten and crop gestures), `crates/ui-egui/src/shortcuts.rs` (header);
  - `crates/engine/src/lightroom_catalog.rs`, `crates/engine/src/crs.rs` (crop and Upright).
- **darktable:** `common/exif.cc` (`_check_lens_correction_data`), `iop/lens.cc` (embedded metadata), `iop/ashift.c` (methods and fit flags), `develop/lightroom.c` (crop angle).
