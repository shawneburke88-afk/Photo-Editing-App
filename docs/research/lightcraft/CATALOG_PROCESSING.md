# LightCraft processing crates: catalogue for LightBench

_Read-only review, 2026-10-12. Source: LightCraft v0.7.1, commit `701f78ea2e586d4748705f10fdf5c4181dc1fd49`, shallow clone at
`scratchpad/ext/lightcraft` (all LightCraft paths below are relative to it). Nothing was built or run. I read the code;
test counts are `#[test]` attributes counted with grep, so they are approximate. "LightCraft says" marks the project's own
claims, which I have not checked. "Not verified" marks my own inferences._

**Licence in one line.** Every crate here is `MIT OR Apache-2.0` (workspace `Cargo.toml`: `license = "MIT OR Apache-2.0"`;
`NOTICE`). Both licences are compatible with LightBench's GPL-3.0-or-later. Copying or porting code needs the copyright line
(`Copyright (c) 2026 ArtCraft Team and the LightCraft contributors`) and the MIT or Apache text in `THIRD_PARTY_NOTICES.md`.
The "ArtCraft" name and logos are trademarks (`docs/brand/LICENSE-brand.txt`) and must not be reused.

**The WebAssembly picture.** `apps/lightcraft-web` compiles the whole egui app to wasm32 and draws it with WebGL2
(`docs/web.md`). It renders with the **CPU** pipeline in up to four Web Workers (no wasm threads). The GPU crate compiles to
a stub on wasm32 (`crates/gpu/Cargo.toml`: wgpu is `cfg(not(target_arch = "wasm32"))`; `crates/gpu/src/lib.rs` doc:
"The browser build has no GPU path yet"). So **LightCraft's WGSL has never run under browser WebGPU.** The web app is one
monolithic egui canvas, so it cannot be embedded in LightBench's React UI.

## Summary table

| Crate | Purpose | Maturity | Licence | WASM-ready | Verdict | Effort |
|---|---|---|---|---|---|---|
| `develop` | Lightroom-shaped edit model (every slider), control table, presets/Amount, process versions | ~28 tests; no TODOs; stable schema with versioning | MIT/Apache | Yes (pure serde; used in the web build) | **Idea only.** Use it as a reference for the shape of the edit model; adopt the *process version* idea now | S |
| `pipeline` | CPU reference develop pipeline: geometry/lens/Upright, WB, local tone, tone map, colour, detail, masks, spots | ~175 tests; no TODOs; LightCraft says tone/detail are "tuned by eye", fidelity unmeasured (`docs/gaps.md` #3) | MIT/Apache | Yes (CPU, the web build uses it; single-threaded there) | **Port selected parts** (geometry frame, Upright, warp maths, guided-filter tricks). **Avoid** tone/colour/detail, which would put a second, non-darktable pipeline beside ours | M (geometry + Upright) |
| `engine` | App façade: session, commands, library, import/export, render jobs, lens-profile lookup, crs XMP mapping, denoise queue | ~795 tests; 62.6 k lines; mostly library/app code | MIT/Apache | Partly (the web build uses it minus denoise/SAM/fetch) | **Idea only** (export details, lens lookup flow) | — |
| `gpu` | wgpu/WGSL twin of the CPU pipeline, with fallbacks and equivalence tests | ~46 tests; 26-case CPU/GPU equivalence (LightCraft says max 1 LSB on Apple M4 Pro) | MIT/Apache | **No** (native only; stub on wasm32) | **Port individual kernels** (the `geom.wgsl` warp maths). Not drop-in: shaders use storage buffers, a generated prelude and native wgpu, and have never run in a browser | S–M |
| `geom` | Points, affine/homography, **crop model**, crop-handle dragging, interval arithmetic | ~34 tests + 3 proptest blocks | MIT/Apache | Yes (serde only) | **Port to TypeScript** (the crop model and drag rules) | S |
| `lensdb` | Reads lensfun-format XML, lens matching, distortion/TCA/vignetting models, fit to DNG polynomials | ~17 tests; LightCraft says "not yet validated against real photos" (`docs/lens-profiles.md`) | MIT/Apache; **lensfun data CC-BY-SA 3.0, not bundled** | Parsing yes (`LensDb::parse(&str)`); `load_dir` needs a filesystem | **Port parts plus reuse the lensfun data** (see the caveats on accuracy and interpolation) | M |
| `denoise` | Bayer AI-denoise runtime: own ONNX subset reader, CPU executor (faer), remote tiles | ~28 tests; Bayer only; no weights shipped | MIT/Apache; the only offered weights (RawNIND) are **GPL-3.0** | Inference not built for web; metadata compiles | **Idea only** (LightBench plans ONNX Runtime Web) | — |
| `denoise-core` | Model manifests and licence gating, Bayer packing, overlapping tiles and blending, cache format | ~37 tests | MIT/Apache | Yes | **Idea only / small port** (tile blending, Bayer packing, highlight protection) | S |
| `merge` | HDR merge (align, deghost) and panorama (MOPS features, RANSAC, bundle adjustment, multi-band blend), output to linear DNG | ~20 tests, synthetic scenes only (`docs/merge.md`) | MIT/Apache, "from published papers" | Compiles in the web build, but has no file access there; depends on LightCraft's raw/codecs crates | **Port later** (Phase 5) or use as a reference | L |
| `inpaint` | PatchMatch completion (Wexler/Barnes) + membrane (Poisson) fill; ported from PhotoCraft | ~5 tests; small (859 lines), deterministic | MIT/Apache (PhotoCraft port, `NOTICE`) | Yes (rayon is off on wasm32; no other dependencies) | **Port to TypeScript/WGSL, or compile to WASM**, as a classical Remove/Heal fill beside LaMa | S–M |

---

## `develop` (`crates/develop`, 2.7 k lines)

1. **Purpose.** The non-destructive edit model: `DevelopSettings` is plain serde data that the pipeline evaluates
   (`crates/develop/src/lib.rs`). Every slider is addressed by id through one control table.
   **Tools in the model** (`crates/develop/src/settings.rs`):
   - Profile and amount, Treatment (colour/B&W), White balance (mode, temp, tint, Kelvin/legacy scale).
   - Light: Exposure, Contrast, Highlights, Shadows, Whites, Blacks; HDR (enabled, max EV).
   - Tone curve: parametric (highlights/lights/darks/shadows plus splits), point curves for master/R/G/B, refine saturation.
   - Colour: Vibrance, Saturation; 8-band HSL mixer; Point Colour list; B&W mix; colour grading (3 wheels + global, blending, balance).
   - Calibration (shadows tint, R/G/B primary hue/saturation).
   - Effects (Texture, Clarity, Dehaze); Vignette (amount, midpoint, roundness, feather, highlights, style); Grain.
   - Detail: sharpen amount/radius/detail/masking; luminance NR and colour NR with sub-sliders; AI Denoise amount.
   - Optics: remove CA, profile on/off with distortion/vignetting amounts, purple/green defringe, manual distortion,
     vignetting and midpoint, manual CA red/blue.
   - Geometry: Upright mode (Off/Auto/Guided/Level/Vertical/Full), up to 4 guides, a **stored Upright homography**, and the
     manual Vertical/Horizontal/Rotate/Aspect/Scale/Offset X/Y sliders, plus Constrain Crop.
   - Crop: normalised rect + angle, aspect lock, flip H/V. Orientation.
   - Masks (brush, linear, radial, colour/luminance/depth range, AI shapes) with local adjustments; Spots; Red eye; Lens blur.
   - `disabled_sections` (per-section eye toggles).
   - Embedded lens data types (`EmbeddedLens`, `EmbeddedWarp`, `EmbeddedWarpStage`, `EmbeddedVignette`): DNG
     `WarpRectilinear(2)` and `FixVignetteRadial` forms (`settings.rs:690–750`).
2. **Files and functions read.**
   - `lib.rs`: `for_raw`, `merged`, `hash64` (FNV-1a over JSON), `effective`, `reset_section`, `denoise_amount`.
   - `settings.rs`: `ProcessVersion`, `Process::{V1,V2}`, and every struct above.
   - `controls.rs`: `Section`, `Track`, `CONTROLS`, `get`/`set` by id.
   - `presets.rs`: `SettingsGroup`, `scale_patch`, `apply_partial`, `Preset::apply`.
3. **Maturity.** ~28 tests (serde round trips; legacy WB scale; process versions in `tests_process.rs`). No
   TODO/unimplemented markers (clippy denies `todo`/`unimplemented` in every crate). `docs/process-versions.md`: V1 is frozen;
   V2 (Highlights/Shadows median base, issue #632) is the latest.
4. **Licence.** MIT OR Apache-2.0. No bundled data.
5. **Dependencies and WASM.** serde, serde_json, miniz_oxide, `lightcraft-geom`, `lightcraft-color`. Pure Rust, no threads,
   no SIMD. Compiled into the web build.
6. **Relation to LightBench.** LightBench's `web/src/engine/develop/settings.ts` is a much smaller schema with `version: 1`
   (a *schema* version) and an `advanced` block of darktable module parameters. LightCraft's model is Lightroom-shaped through
   and through (Lightroom units and slider semantics). LightBench is "Lightroom-style controls on a darktable engine", so the
   *control surface* overlaps but what the values mean does not.
   Worth noting:
   - **Process versions** (`settings.rs:15–100`, `docs/process-versions.md`). A change that alters how existing settings render
     ships as a new process. Old edits keep their look until "Update to Current Process". Copy/paste/presets never carry the
     process. LightBench has nothing like this yet. It will need it as soon as Phase 3 changes how an existing slider renders
     (e.g. turning on the tone equalizer's guided filter).
   - **Amount** (`presets.rs:159–198`) interpolates every JSON number linearly, including Kelvin, and switches discrete values
     at 50 %. LightBench's Amount (PHASE2 Part 8) blends white balance in mireds and log tint and keeps the Auto record true.
     **LightBench's is better.**
   - The stored Upright homography (`Geometry::upright_transform`): see Top recommendations.
7. **Reuse verdict: idea only (S).** Adopt the process-version mechanism and use the crop/geometry/optics field layout as a
   checklist. Do not port the schema: it would import Lightroom's slider semantics, which LightBench maps onto darktable modules.

## `pipeline` (`crates/pipeline`, 11.5 k lines)

1. **Purpose.** The CPU reference develop pipeline. Input: scene-linear Rec.2020, already demosaiced and EXIF-oriented, at any
   resolution. Output: display-encoded image plus histogram (`crates/pipeline/src/lib.rs:1–21`).
   Stage order:
   1. Geometry: one resample, then defringe.
   2. Scene-linear: WB, exposure, dehaze, local tone, texture, clarity, masks.
   3. Tone map on luminance.
   4. Colour in OkLCh.
   5. Display: gamut map, encode, curves, vignette, grain.

   **Tools and where they live:**
   - **Geometry frame** (orientation → lens warp → perspective → crop/straighten → flips, *one* resample): `geometry.rs`
     (`Frame::with_lens`, `constrain_to_image`, `sample_plan`, `sample`, `perspective`).
   - **Manual Transform** (keystone as a virtual camera rotation `K·R·K⁻¹`, rotate, aspect, scale, offset): `transform.rs`
     (`manual`, `recentre`, `DEFAULT_FOCAL = 1.5` half-long-edge units ≈ 27 mm).
   - **Upright** (own gradient line-segment detector, vanishing points by RANSAC + least squares, Level/Vertical/Full/Auto/Guided):
     `upright.rs` (`detect_segments`, `vanishing_point`, `reliable`, `analyze`, `solve`, `solve_guided`, `analyze_source` at
     1024 px with a cache, `level_degrees` for the crop tool's Auto straighten, `resolve`, `homography`).
   - **Optics** (`Warp`: inverse map with manual distortion, embedded DNG `WarpRectilinear`/`WarpRectilinear2`, per-channel CA
     scale, radial vignetting gain; automatic lateral-CA estimate; defringe): `optics.rs` (`Warp::from_settings`,
     `corrected_to_source`, `gain`, `block_coverage`, `embedded_warp`, `embedded_stage`, `reorient_lens`, `estimate_lateral_ca`,
     `defringe`).
   - **White balance**: camera-space re-evaluation of the colour matrices at the chosen white when the raw has a camera colour
     model, Bradford otherwise (`local.rs:15–160`, `wb_matrix_for`, `legacy_to_kelvin`).
   - **Highlights/Shadows**: log-luminance gain weighted by an edge-aware base layer. The base is a fast guided filter of
     (V2) a separable median of log luminance (`local.rs:163–300`, `tone_base`; applied in `finish.rs:~470`).
   - **Texture/Clarity/Sharpening**: unsharp-style detail bands on log luminance (`finish.rs:~495–520`).
   - **Luminance/colour NR**: guided filter on log luminance; chromaticity blur (`local.rs:294–368`).
   - **Dehaze**: dark channel plus airlight (`local.rs:428+`, `finish.rs:~447`).
   - **Tone map**: an extended-Reinhard luminance curve around grey 0.18 with whites/blacks/contrast, an identity "display"
     curve for JPEGs, and HDR variants (`tone.rs`).
   - **Colour**: vibrance, saturation, 8-band mixer, B&W, 3-way grading, calibration, all in OkLCh (`colorops.rs`).
   - **Auto** (`auto.rs`): exposure from the scene log-average (slope −0.41 EV/EV, which LightCraft says was regressed against
     Lightroom's Auto on 24 Sony raws); the other sliders are a fixed recipe. Also auto WB (grey world).
   - **Masks** (`masks.rs`), **spots** (clone, heal by frequency separation, remove, content-aware fill via `inpaint`)
     (`spots.rs`), dust/blemish detection (`dust.rs`, `blemish.rs`), red/pet eye (`redeye.rs`), culling metrics (`cull.rs`),
     `.cube` 3D LUT profiles (`lut.rs`), built-in looks (`profiles.rs`), output spaces/depths/soft proof (`output.rs`), overlays
     (`visualize.rs`), DNG `ProfileGainTableMap` (`local_tone.rs`).
   - **Stage cache**: exposure is a gain applied in the per-pixel stage. The spatial planes are computed before exposure,
     because filters on log luminance are shift-equivariant (`lib.rs:18–21`, `finish.rs`).
2. **Files read:** `lib.rs` (header, `SourceInfo`, `RenderRequest`, `PixelWindow`), `tone.rs`, `local.rs` (outline + key
   functions), `geometry.rs`, `transform.rs`, `upright.rs` (in full), `optics.rs` (outline + header), `finish.rs:395–560`,
   `auto.rs`, and the module docs of the rest.
3. **Maturity.** ~175 tests. They include Upright on synthetic scenes (`tests_geometry.rs:330–490`: converging verticals,
   tilted horizon, Full, Guided, resolution independence, "Auto leaves natural scenes nearly alone"). No TODO markers.
   - `docs/parity-checklist.md:180–221` marks the light, curve, detail, optics, Upright and transform rows as ✅. "✅" means
     *implemented*, not matched to Lightroom.
   - `docs/gaps.md` #3: "tone, highlights, texture / clarity / dehaze, NR and sharpening are tuned by eye … no side-by-side suite".
   - Gap #8: no lens database beyond embedded data.
4. **Licence.** MIT OR Apache-2.0.
5. **Dependencies and WASM.** rayon (row parallelism), serde, and the internal `raster`, `color`, `raw`, `inpaint` crates. No
   SIMD intrinsics, no unsafe (`#![forbid(unsafe_code)]`). Compiled into the web build (CPU only, in workers). With no wasm
   threads, rayon presumably runs on one thread there (not verified).
6. **Relation to darktable / LightBench.**
   - **Tone model.** LightCraft: one luminance tone curve (extended Reinhard). RGB is scaled by `o/Y`, which preserves
     chromaticity, then highlights are desaturated above the peak. LightBench: darktable **sigmoid**, per-channel with hue
     preservation (`web/src/engine/color/sigmoid.ts`). Different models; LightCraft's is not darktable's.
   - **Highlights/Shadows.** LightCraft's approach is *close in spirit* to darktable's tone equalizer with its guided filter: a
     log-luminance gain driven by an edge-aware base. LightBench uses the tone equalizer in **global** mode (PHASE1: "no guided
     filter, RGB average"). The guided mode is planned.
   - **Colour.** LightCraft: OkLCh. LightBench plans darktable colour balance rgb.
   - **Geometry.** LightCraft's order (lens → perspective → crop → flips) matches darktable's module order
     (`lens` #15 → `ashift` #18 → `flip` #19 → `crop` #30; `docs/DARKTABLE_MODULES.md:52`). It collapses them into **one**
     resample; darktable resamples per distorting module.
   - **Upright.** darktable `ashift` uses LSD lines, RANSAC and a Nelder–Mead fit of rotation, lens shift and shear, with the
     **EXIF focal length and crop factor** (`ashift.c`; `DEFAULT_F_LENGTH 28.0` only when EXIF is missing). LightCraft uses its
     own detector and a **fixed** focal of 1.5 half-long-edges unless two vanishing points give one (`upright.rs:458–498`).
   - Status in LightBench: crop/straighten (Phase 1 plan, not built), lens, CA, Upright, curves, HSL, grading, detail, effects,
     masks and heal (Phase 3).
7. **Reuse verdict: port selected parts (M); avoid the tone/colour/detail stages.**
   - Port the geometry frame (`geometry.rs`), the Upright reliability gates and Auto policy (`upright.rs:427–535`), the warp maths
     (`optics.rs:134–240`) and the stage-cache trick (exposure as a shift on log planes).
   - Do not port the tone map, OkLCh colour ops, sharpening or NR. LightCraft says they are tuned by eye. Using them would put a
     second, non-darktable processing model beside LightBench's darktable one, so slider behaviour would depend on which engine
     a tool came from.

## `engine` (`crates/engine`, 62.6 k lines)

1. **Purpose.** The LightCraft façade (layer L4): session, command registry, history, render jobs and view-models, plus
   library, import, export, sidecars, Lightroom catalog import, presets, faces, AI masks, denoise queue and merge orchestration.
   Processing-relevant files:
   - `media.rs`: render jobs; picks GPU or CPU.
   - `export.rs`: JPEG/PNG/TIFF/WebP/AVIF/JXL; Mitchell resize (`export.rs:575`); **output sharpening** (`export.rs:172`,
     `:1348`); JPEG size limit.
   - `lens_profiles.rs`: embedded correction first, else a lensfun lookup from `LIGHTCRAFT_LENSFUN_DIR`.
   - `crs.rs`: maps Lightroom `crs:` XMP to LightCraft settings.
   - `camera_preview.rs`: fits a per-file camera look to the embedded JPEG.
   - `denoise.rs`, `merge.rs`, `presets.rs`, `cmd/develop.rs`, `cmd/curves.rs`, `cmd/masks.rs`.
2. **Files read:** the module docs of every source file; `lens_profiles.rs` in full; export resampling lines.
3. **Maturity.** ~795 tests. Gaps and parity are tracked in `docs/gaps.md` (28 ranked gaps; "~340–600 h to beta").
4. **Licence.** MIT OR Apache-2.0. Uses third-party crates such as harfrust and ab_glyph (not audited here).
5. **Dependencies and WASM.** rayon, serde, every LightCraft crate; `lightcraft-fetch` is native only; the `denoise`/`sam`
   features are off for the web. Compiled into `apps/lightcraft-web`.
6. **Relation to LightBench.** Mostly app/library code outside this catalogue's scope. Relevant points:
   - **Export.** LightCraft renders straight at output size through the geometry resample (bilinear from a Mitchell-prefiltered
     source) and resizes with Mitchell. LightBench develops at full resolution and then resamples with **Lanczos3 in linear
     light**, as darktable's high-quality export does (PHASE1 Part 3). LightBench's is the higher-quality design.
   - **Output sharpening.** LightCraft has it; LightBench does not (Lightroom has it).
7. **Reuse verdict: idea only.** The lens lookup order (embedded first, then database, matched on EXIF make/model/lens with
   the crop factor from the 35 mm-equivalent focal length when the camera is unknown; `lens_profiles.rs:37–60`) and output
   sharpening are worth copying as ideas.

## `gpu` (`crates/gpu`, 7.1 k lines incl. ~1.5 k WGSL)

1. **Purpose.** A wgpu compute twin of the CPU pipeline. The CPU stays the oracle (`crates/gpu/src/lib.rs:1–21`,
   `docs/gpu-pipeline.md`).
   Kernels in `src/wgsl/`:
   - `geom`: orientation, affine resample, full lens + perspective warp.
   - `resize`; `blur`: box passes approximating a Gaussian.
   - `map`: log luminance, dark channel, guided-filter steps, WB, NR, red eye.
   - `mask`: shapes, combine, finalize.
   - `finish`: the whole per-pixel stage.
   - `nn_conv`/`nn_pool`: AI denoise.
2. **Files read:** `lib.rs` header, `Cargo.toml`, `wgsl/geom.wgsl` in full, the outlines of `finish.wgsl`/`map.wgsl`/
   `mask.wgsl`/`blur.wgsl`, and grep of `render.rs`/`params.rs`.
3. **Maturity.** ~46 tests. `tests/equivalence.rs` renders 26 settings cases on CPU and GPU. LightCraft says the difference is
   max 1 LSB, mean ≤ 0.0003 LSB, on an Apple M4 Pro (Metal); the tests skip when no adapter exists. `gaps.md` #27: "GPU path
   proven on Apple only".
   - DNG `WarpRectilinear2` chains are **not** on the GPU: they fall back to the CPU (`render.rs:619`, `Warp::needs_f64`).
   - Defringe and spot removal run on the CPU inside a GPU render.
4. **Licence.** MIT OR Apache-2.0.
5. **Dependencies and WASM.** wgpu 30 (Metal/Vulkan/DX12, no GL), pollster, bytemuck; native only. Images are `array<f32>`
   **storage buffers** in interleaved RGB, not textures. Parameters come through `pu()`/`pf()` accessors and constants
   generated into a WGSL prelude from CPU values (`docs/gpu-pipeline.md` "Structure"). **Not WASM-ready.**
6. **Relation to LightBench.** LightBench runs WebGPU in the browser with `rgba16float` textures, and its kernels are
   darktable translations. The useful parts are:
   - **The warp maths** in `geom.wgsl:69–197`: inverse perspective in centred coordinates, embedded DNG radial + tangential
     polynomial per channel, radial vignetting gain, per-channel TCA samples.
   - **Robustness patterns**: short submissions (≤ 16 M invocations, about 4 MP bands) to avoid watchdog resets on integrated
     GPUs; error scopes; readback timeouts; a "wrote alpha everywhere" completeness check; re-rendering an all-black result on
     the CPU; buffer-limit checks against WebGPU-default limits. See `docs/gpu-pipeline.md` "Limits, failures".
   - The CPU/GPU equivalence-test idea.
7. **Reuse verdict: port individual kernels (S–M).** Translate `geom.wgsl`'s warp functions into LightBench's texture-based
   pass. Do not try to reuse the shader files directly: they depend on the prelude, the buffer layout and native wgpu, and have
   never been validated under browser WebGPU (Tint/Dawn uniformity rules may differ; not verified). Note that the resample is
   **bilinear**. darktable's default warp interpolator is **bicubic** and its scaling default is **lanczos3**
   (`darktableconfig.xml.in:2819–2843`).

## `geom` (`crates/geom`, 1.5 k lines)

1. **Purpose.** Resolution-independent geometry: `Point`, `Vec2`, `Rect`, `Affine`, `Homography` (incl. `from_quads`),
   `Orientation` (EXIF 1–8), and the `Real` trait with an outward-rounded `Interval` type (bounds for the GPU coverage mask).
   - **Crop model** (`src/crop.rs`): a normalised axis-aligned rect in the *straightened* frame plus an angle in −45..45 °.
     Functions: `output_to_source`, `is_within_image`, `constrained` (move toward the centre, then shrink),
     `with_angle` (keeps the crop if it still fits, else the largest crop of its aspect; one code path for every way of setting
     the angle, issue #742), `max_inscribed_scale`, `crop_fit_angle`.
   - **Crop dragging** (`src/crop_drag.rs`, `drag_crop`). Guarantees:
     - the result stays inside the rotated image;
     - the opposite edges stay put;
     - the aspect lock holds on every handle;
     - the frame stops at the image edge and slides along it;
     - hostile numbers are rejected.
2. **Files read:** `crop.rs` in full, `crop_drag.rs:1–140`, the outlines of `lib.rs`/`real.rs`/`homography.rs`.
3. **Maturity.** ~34 tests + 3 proptest blocks (property tests on crop invariants). No TODOs.
4. **Licence.** MIT OR Apache-2.0.
5. **Dependencies and WASM.** serde only. WASM-ready.
6. **Relation to LightBench.** darktable splits framing across `flip` (orientation), `ashift` (rotation), `crop` (ROI only,
   normalised cx/cy/cw/ch + ratio) and the deprecated `clipping` (`DARKTABLE_MODULES.md:78,101,290`). LightBench wants
   Lightroom-style Crop & Straighten controls, and LightCraft's model is exactly that, in a clean and well-tested form.
7. **Reuse verdict: port to TypeScript (S).** About 700 lines of pure maths with a property-test suite to translate alongside.
   Credit LightCraft (MIT) in the file header and in THIRD_PARTY_NOTICES. Skip `Interval`/`Real`: they exist only for
   LightCraft's f64 coverage mask.

## `lensdb` (`crates/lensdb`, 1.0 k lines)

1. **Purpose** (`crates/lensdb/src/lib.rs:1–17`).
   - Read lensfun-format XML.
   - Identify the camera (mount, crop factor) and lens from EXIF strings, by token matching: every number in the database name
     must appear in the EXIF name, and the makers must agree.
   - Models (`model.rs`): distortion `poly3`/`poly5`/`ptlens`, TCA `linear`/`poly3`, vignetting `pa`.
   - Interpolate per shot:
     - distortion and TCA: by focal length, by evaluating both neighbours;
     - vignetting: linear in focal, in stops of aperture, in 1/distance.
   - Convert by least squares to the DNG `WarpRectilinear` (even polynomial `k0 + k1 r² + k2 r⁴ + k3 r⁶`) and
     `FixVignetteRadial` forms. The pipeline then applies one warp path for all sources (`Profile::correction`).
   - LightCraft says: "no lensfun code was read".
2. **Files read:** `lib.rs` (header, types, function list), `model.rs:1–75` + fit signatures.
3. **Maturity.** ~17 tests on synthetic profiles. `docs/lens-profiles.md` "Limits":
   - raws only;
   - focus distance not read (vignetting uses the farthest calibrated distance);
   - no manual lens picker;
   - "Not yet validated against real photos and another renderer";
   - the lensfun `<center>` offsets are ignored.
4. **Licence.** Code MIT OR Apache-2.0. **The lensfun database is CC-BY-SA 3.0. LightCraft never bundles it**: users point
   `LIGHTCRAFT_LENSFUN_DIR` at it. LightBench's own RESEARCH.md:88 records the same licence ("LGPL-3 lib, CC-BY-SA-3.0
   database"). Whether LightBench may *bundle* the database as separate data next to GPL code is a licensing question for the
   owner, not settled here.
5. **Dependencies and WASM.** quick-xml; `LensDb::parse(&str)` is filesystem-free, so WASM-capable. `load_dir` uses `std::fs`.
6. **Relation to darktable / LightBench.** darktable's `lens.cc` calls the **lensfun library** (LGPL-3) and also implements
   embedded maker metadata for Sony, Fuji, DNG, Olympus and Panasonic (`lens.cc:2208–2450`, `_init_coeffs_md_v2`). LightBench
   plans "camera-embedded first, then Lensfun".
   Accuracy caveats, from reading the code (my analysis, not verified by running anything):
   - **The refit adds error.** `MAX_WARP_ERROR = 0.001` of the half diagonal (`lib.rs:34`), which is about 3.6 px on a
     6000 × 4000 image. `poly3`/`poly5` and linear TCA are exactly representable in the even form. **`ptlens` (odd r and r³
     terms) and `poly3` TCA (c·r term) are not**, so those are approximated, possibly up to that cap.
   - **Interpolation differs from lensfun.** Lensfun interpolates between calibrations in its own way, which darktable inherits
     by calling the library. LightCraft's scheme is its own, so results can differ from darktable's for zooms between
     calibrated focal lengths.
7. **Reuse verdict: port parts + data reuse (M).**
   - Port the XML reading, the EXIF matching heuristics and the model formulas to TypeScript.
   - Evaluate lensfun models **directly in WGSL** instead of refitting them to the DNG polynomial.
   - For interpolation and normalisation, follow the lensfun library source (LGPL-3, compatible with GPL-3) so LightBench
     matches darktable.
   - Get the data from lensfun's `data/db`, under CC-BY-SA 3.0, with attribution.

## `denoise` + `denoise-core` (`crates/denoise` 3.3 k lines, `crates/denoise-core` 2.2 k lines)

1. **Purpose.** AI raw denoise as a step "between the sensor and the demosaic" (`crates/denoise/src/lib.rs`, `docs/denoise.md`).
   - `denoise-core`:
     - model manifest with licence and commercial-use fields, validated as untrusted JSON (`manifest.rs`, `licence.rs`);
     - known models (`known.rs`: only `rawnind-bayer`, **GPL-3.0** weights);
     - bounded zip extraction (`archive.rs`);
     - Bayer layouts and 4-plane packing with mirrored edges (`bayer.rs`);
     - overlapping tiles with edge-fading weights (`tiles.rs`);
     - the run loop: scale matching per tile, clipped-highlight protection, blending (`run.rs`);
     - the half-float `.lcdn` cache (`product.rs`).
   - `denoise`:
     - its own bounded ONNX subset reader (`onnx.rs`, `onnx_proto.rs`);
     - a CPU executor on faer-core GEMM (`cpu.rs`, `net.rs`);
     - a remote-GPU tile protocol over LAN/VPN (`remote.rs`).
   - The GPU executor is in `crates/gpu/src/nn.rs` + `nn_conv.wgsl`.
2. **Files read:** the module docs of every file, `known.rs:1–60`, `docs/denoise.md`.
3. **Maturity.** ~28 + ~37 tests. Bayer only (no X-Trans), no weights shipped. LightCraft says: "No measured quality parity
   with Lightroom is claimed". AI denoise is 🟡 in the parity checklist.
4. **Licence.** Code MIT OR Apache-2.0. **RawNIND weights GPL-3.0**: opt-in download behind a Cargo feature, and "Enabling that
   offer in releases remains a maintainer decision" (`NOTICE`). The `.dtmodel` handling in `archive.rs` suggests the weights are
   packaged the way darktable packages models (not verified).
5. **Dependencies and WASM.** `denoise-core` is WASM-ready (serde, sha2, miniz_oxide, rayon). `denoise` inference uses
   faer-core 0.17.1, which includes architecture-specific assembly; LightCraft says the web build "reports inference
   unavailable".
6. **Relation to LightBench.** LightBench Phase 4 plans "AI denoise (NAFNet-class)" on ONNX Runtime Web with **permissive
   models only**. RawNIND's GPL-3.0 weights fit LightBench's own GPL licence, but GPL is copyleft, not "permissive". Whether
   they qualify under the owner's rule (2026-10-11) is the owner's call. darktable's profiled denoise (`denoiseprofile` #11) is
   the planned classical path.
7. **Reuse verdict: idea only, plus an optional small port (S).** Worth reusing:
   - the Bayer-to-4-plane packing contract ("normalized, black-subtracted, non-white-balanced RGGB → camera RGB");
   - tile overlap with edge-fade weights and per-tile scale matching;
   - clipped-highlight protection;
   - putting denoise *before* demosaic, with the Amount blended there;
   - licence fields in the model manifest.

   Do not port the ONNX executor: ORT Web replaces it.

## `merge` (`crates/merge`, 3.9 k lines)

1. **Purpose.** HDR merge and panorama stitching (`crates/merge/src/lib.rs`, `docs/merge.md`).
   - **HDR** (`hdr.rs`): order frames by EXIF exposure; middle frame is the reference; auto-align (`align.rs`: features → RANSAC
     homography/similarity/translation); measured exposure ratios; weights favour longer exposures and drop saturated pixels;
     deghost masks; output a linear float DNG (`output.rs`).
   - **Panorama** (`pano/*`):
     - MOPS features (`features.rs`) and pairwise RANSAC (`ransac.rs`, deterministic xorshift);
     - Brown & Lowe verification;
     - focal length from the homographies, rotations along a maximum spanning tree, Levenberg–Marquardt bundle adjustment
       (`pano/camera.rs`);
     - spherical/cylindrical/perspective projection;
     - gain compensation; Voronoi-like seams; multi-band blending in log space (`pano/blend.rs`);
     - boundary warp (separable stretch), auto crop (maximal rectangle), push–pull edge fill (`pano/finish.rs`).
2. **Files read:** `lib.rs` and the module docs of every file, `docs/merge.md`.
3. **Maturity.** ~20 tests, all on synthetic scenes. LightCraft says: HDR alignment < 0.3 px, exposure error < 0.02 EV;
   panorama rotations < 0.1°. Known gaps:
   - no lens model in the bundle adjustment;
   - no 360° wrap;
   - no camera response curve for JPEG brackets;
   - Boundary Warp is not content-preserving;
   - no file access in the browser build.
4. **Licence.** MIT OR Apache-2.0. LightCraft says: "our own implementation from published papers … no code from GPL projects
   was consulted".
5. **Dependencies and WASM.** rayon, serde, thiserror, plus LightCraft's `raw`, `codecs`, `meta`, `scenes` crates for frame
   loading. Compiles in the web build, but calling it from LightBench would drag in LightCraft's decoders unless the algorithms
   are extracted.
6. **Relation to LightBench.** HDR/panorama merge is Phase 5. darktable has only a basic raw HDR merge
   (`DARKTABLE_MODULES.md:635`) and no panorama.
7. **Reuse verdict: port later or reference (L).** It is a coherent, paper-based design. When Phase 5 comes, translate the
   algorithm modules (features, ransac, linalg, hdr, pano) to TypeScript, or compile an extracted subset to WASM. Note its
   `Homography`/RANSAC maths could also back a future "align" feature.

## `inpaint` (`crates/inpaint`, 0.9 k lines)

1. **Purpose.** Content-aware hole filling for the Remove tool (`crates/inpaint/src/lib.rs`):
   - `complete` / `complete_with`: multi-scale Wexler EM completion with PatchMatch nearest-neighbour fields, cancellable;
   - `membrane_fill`: harmonic (Laplace) fill by cascadic SOR (successive over-relaxation), used to seed the coarsest level and
     as a fallback.

   Deterministic (fixed-seed hash RNG) and thread-count independent. Used by `pipeline/src/spots.rs` ("Fill").
2. **Files read:** `lib.rs`, the module docs of `patchmatch.rs` and `membrane.rs`.
3. **Maturity.** ~5 tests (hostile sizes, cancellation). Small and focused.
4. **Licence.** MIT OR Apache-2.0. A port of PhotoCraft (`storytold/photocraft`, also MIT OR Apache-2.0); each ported file
   says so (`NOTICE`).
5. **Dependencies and WASM.** None except rayon, which is excluded on wasm32 (`Cargo.toml`). WASM-ready.
6. **Relation to LightBench.** Phase 3 plans heal/clone. darktable's `retouch` (#25) offers clone, heal, blur and fill, but no
   patch synthesis. Phase 4 plans LaMa for AI remove. A classical PatchMatch fill is a no-model, no-download option between
   the two.
7. **Reuse verdict: port to TypeScript (S–M), or compile this one crate to WASM (S).** It has no dependencies, so a
   wasm-bindgen build is the cheapest real reuse in this whole scope. It would still add a Rust toolchain, which PLAN.md chose
   to avoid, so a TypeScript port (about 800 lines) is probably the better fit. PatchMatch's random search is a poor fit for
   WGSL; keep it on the CPU in a worker.

---

## Revisit completed LightBench features

_Each completed LightBench feature in this area, compared with LightCraft's equivalent. Bias: keep what follows darktable
unless LightCraft shows a concrete, checkable improvement._

| LightBench feature (where) | LightCraft equivalent (where) | Recommendation |
|---|---|---|
| **Raw prepare, white level from rawspeed `cameras.xml` by mode/ISO** (`web/src/engine/raw/camera-db.ts`, `white-level.ts`) | Outside this scope (`crates/raw`); not compared in depth | **Keep.** No evidence to change. |
| **Highlight reconstruction: darktable inpaint opposed, on the CFA** (`web/src/engine/gpu/raw-pipeline.wgsl`) | Own diffusion-based rebuild on *demosaiced* camera RGB with WB-aware neutral clipping (`crates/raw/src/highlight.rs:1–30`, `reconstruct*`) | **Keep.** Optionally **improve the tests (S)**: `highlight.rs:14–22` lists three ways colour leaked into rebuilt highlights. (a) Taking colour from dark foliage or lens fringes nearby. (b) A colour model that doesn't render WB-neutral as neutral. (c) Pale partly clipped skies turning teal when darkened (Highlights −, Exposure −, Whites −). Use these as regression scenes for LightBench's opposed inpaint, especially once camera profiles or colour calibration arrive. |
| **RCD demosaic (darktable), bilinear option** (`demosaic.wgsl`) | AHD default, PPG, bilinear, X-Trans directional (`crates/raw/src/demosaic/mod.rs`); previews binned 2× from the mosaic (`RawImage::develop_binned`, `docs/gpu-pipeline.md` "Opening a photo") | **Keep RCD.** It is darktable's default and already runs on the GPU. Binning previews is an *idea* to measure only if preview speed falls short of the budgets (M). Binning changes preview pixels and would break "truthful preview", so it would need the owner's sign-off. |
| **Exposure with +0.7 EV base** | No base exposure; the tone curve is anchored at grey 0.18 (`crates/pipeline/src/tone.rs`) | **Keep.** The +0.7 EV belongs to the sigmoid design. Nothing to learn here. |
| **Sigmoid display transform, per channel with hue preservation** (`web/src/engine/color/sigmoid.ts`) | Extended-Reinhard luminance curve (`tone.rs:120–175`); "tuned by eye", fidelity unmeasured (`docs/gaps.md` #3) | **Keep.** Replacing it would depart from darktable for a model LightCraft itself hasn't validated. **Add process versions (S)** before any Phase 3 change to tone behaviour (see Top recommendations #1). |
| **Tone equalizer sliders (Highlights/Shadows/Whites/Blacks), global mode, "RGB average" estimator** (`web/src/engine/color/tone-equalizer.ts`, PHASE1) | Highlights/Shadows as log-luminance gain on a guided-filter base; V2 adds a separable median first, so twigs and texture keep their contrast (`local.rs:257–300`, issue #632). Exposure is applied as a shift, so the base isn't recomputed during exposure drags (`lib.rs:18–21`) | **Done in process version 2** ([PHASE3.md Part 10](../../PHASE3.md#part-10-the-tone-equalizer-as-darktables-defaults-process-version-2)). On the two questions below: at darktable's defaults the EIGF's output scales exactly with exposure (in log terms, shifts), apart from floors far below −8 EV, so LightBench measures the mask once and exposure only scales it; and darktable has no `reload_defaults` for the module, and its "mask blending \| all purposes" preset equals the defaults. Original note: **Improve (M), already planned.** Implement darktable's guided-filter mode. Two LightCraft ideas carry over without leaving darktable. (1) A guided filter on log luminance is shift-equivariant (adding c to the input adds c to the output; my derivation from `q = mean(a)·p + mean(b)`), so the mask can be computed once and exposure drags only shift it. Check whether darktable's EIGF variant keeps this property before relying on it. (2) LightCraft says the median pre-filter fixed halos/flattening on thin bright features; test it against darktable's "edges refinement/feathering" before adopting. Also note: darktable's *parameter defaults* are `details = EIGF` and `method = RGB euclidean norm` (`toneequal.c:190–191`), while LightBench uses "RGB average". I did not check whether darktable's presets override this; worth a look when the guided mode lands. |
| **Vibrance/Saturation: simple chroma scaling** (PHASE1) | OkLCh vibrance/saturation (`crates/pipeline/src/colorops.rs`) | **Keep the plan** (darktable colour balance rgb in Phase 3). Don't adopt OkLCh: that would be a second colour model. |
| **White balance (temperature.c), picker with loupe** | Camera-space re-evaluation of the matrices at the chosen white (DNG-style), Bradford fallback, Kelvin vs legacy scale migration (`local.rs:15–160`) | **Keep.** LightCraft's method needs dual-illuminant camera matrices. LibRaw supplies one. One *idea* only if LightBench ever changes WB semantics: LightCraft's `legacy_to_kelvin` migration shows how to keep old edits looking the same (with process versions). |
| **Auto solver: targets, per-slider cost, look presets, strength, slider choice** (`web/src/engine/develop/auto.ts`) | Exposure from the scene log-average (−0.41 EV/EV plus an offset), other sliders fixed (`crates/pipeline/src/auto.rs:25–103`) | **Keep LightBench's.** It is more capable. *Idea (S):* LightCraft's regression ("Lightroom Auto exposure falls 0.41 EV per EV of scene log-average, r = −0.92, 24 Sony raws") could serve as a sanity check on Auto Natural's exposure across a test set. It is LightCraft's measurement, unverified. |
| **Histogram, J/O clipping, sensor clipping** (darktable-based, PHASE1 Part 2b) | Histogram of the 8-bit output; no sensor-clipping overlay found in pipeline/gpu (grep for "clipping") | **Keep.** LightBench's is more complete. |
| **Export: full-res develop → Lanczos3 in linear light → colorout; jpegli; dither for 8-bit PNG/TIFF** (PHASE1 Part 3) | Renders at output size through bilinear-from-Mitchell geometry, Mitchell resize, **optional output sharpening**, JPEG size limit (`crates/engine/src/export.rs:172, 575, 1348`) | **Keep the pipeline.** It is higher quality and follows darktable. **Improve (S–M, optional):** add output sharpening (screen/matte/glossy), a Lightroom feature LightBench lacks. darktable has no direct equivalent; it could be an `sharpen`/`diffuse` pass after `finalscale`. This needs the owner's go-ahead as a new feature, not a fix. |
| **Copy/paste/presets Amount** (`web/src/develop/presets.ts`, PHASE2 Parts 7–8) | Linear interpolation of JSON numbers (incl. Kelvin), discrete values switch at 50 % (`crates/develop/src/presets.rs:159–198`) | **Keep LightBench's.** Mired/log-tint blending and the Auto record are better. Carry over one rule once process versions exist: **copy/paste/presets never carry the process version** (`docs/process-versions.md`). |
| **Background batch developer** (`web/src/develop/batch.ts`: one photo at a time on its own GPU engine) | Desktop render pool; the web build uses up to four CPU workers; prefetches the next and previous photo (`docs/web.md`, `docs/gpu-pipeline.md` "Opening a photo") | **Keep.** On WebGPU, one engine at a time is sensible. *Idea (S):* LightCraft's neighbour prefetch in Develop (stepping in about 50 ms, LightCraft says) applies to the filmstrip, not to batch. |
| **Zoomed view via mip chain** (PHASE1) | Windowed renders at 1:1 with whole-frame values (airlight, NR size) passed in (`lib.rs` `PixelWindow`, `docs/gpu-pipeline.md` "windows_match") | **Keep for now.** Revisit when spatial filters (guided tone equalizer, dehaze, NR) arrive. Then a zoomed render must take frame-wide values from the whole image, as LightCraft does. |

---

## Top recommendations for LightBench in this area (ranked)

1. **Add a process version to the edit format now (S).** One integer next to `version` in `settings.ts`. Rules:
   - missing means V1;
   - new photos and Reset get the latest;
   - copy/paste/presets never carry it;
   - "Update to current process" is one history step.

   Model: `crates/develop/src/settings.rs:15–100`, `docs/process-versions.md`. Phase 3 will change how existing sliders render
   (the guided tone equalizer, maybe colour balance rgb behind Vibrance/Saturation). Without this, every saved edit and XMP
   sidecar changes look silently, which the release-discipline rule (USABILITY "Release discipline") forbids.

2. **Crop & Straighten: port LightCraft's crop model and drag rules (S), keep darktable's order.**
   - **Model.** A normalised crop rect in the straightened frame plus an angle; flips and orientation separate; aspect lock as
     (w, h). See `crates/geom/src/crop.rs`, `crop_drag.rs`.
   - **Invariants**, all on one code path (as LightCraft's issue #742 found necessary):
     - the crop is always inside the rotated image;
     - every way of setting the angle goes through `with_angle`;
     - the drag stops at the edge and slides along it.
   - **Auto straighten** in the crop tool can reuse the Upright "Level" analysis (`upright.rs:572–577`).
   - Store the crop in normalised coordinates of the *transformed* (lens + perspective corrected) image, as LightCraft does
     (`geometry.rs:1–6`), so masks and spots (Phase 3) stay attached when lens or Upright settings change.

3. **Build lens + perspective + crop as one composite inverse warp in a single WGSL pass (M).**
   - **Order.** Output px → crop/straighten/flip affine → inverse Upright/Transform homography (centred coordinates) → lens
     distortion → per-channel TCA → source px, plus the vignetting gain at the source position. This is darktable's order
     (`lens` #15 → `ashift` #18 → `flip` #19 → `crop` #30), but sampled once instead of once per module, so there is less
     softening. Reference maths: `crates/gpu/src/wgsl/geom.wgsl:69–197`, `crates/pipeline/src/optics.rs:134–240`.
   - **Differences from LightCraft:**
     - **Do TCA in camera RGB, before `colorin`.** darktable's lens module also runs before `colorin` (#34). LightCraft's source
       is already Rec.2020, so its per-channel CA scale acts on mixed channels. My analysis: a per-channel warp does not commute
       with the 3×3 colour matrix, whereas a common warp does. So put at least the TCA part where darktable has it.
     - **Use bicubic or better for the warp** (darktable's default warp interpolator is bicubic, `darktableconfig.xml.in:2819`),
       at least for export. LightCraft samples bilinearly.
     - **Cache the warped image by a geometry key**, so exposure and tone drags don't re-warp (as LightCraft's stage cache does).
   - **Constrain Crop** (shrink the crop until no blank area shows, `geometry.rs:84–110`) is a cheap, useful option.

4. **Lens corrections, embedded first (M), with LightCraft's evidence as validation cautions.**
   - **Translate darktable's `lens.cc` embedded path** (`_init_coeffs_md_v2`, Sony/Fuji/DNG/Olympus/Panasonic). It is
     LightBench's chosen base.
   - **LibRaw's WASM build probably doesn't expose these maker tags** (not verified). LightBench's own TIFF/EXIF reader
     (`web/src/engine/meta/exif.ts`) would need extending: Sony `0x7037/0x7035/0x7032` in the ARW raw IFD (darktable
     `exif.cc:1384–1391`); Fuji `GeometricDistortionParams`/`VignettingParams`/`ChromaticAberrationParams`.
   - **Where LightCraft is more cautious than darktable** (LightCraft's claims, worth testing on the owner's cameras):
     - Sony: it trusts the distortion table **only on the ILCE-7RM4A** and refuses the A7 III table after an unverified corner
       warp. darktable applies the three Sony tables to any body that has them.
     - Sony: use the main raw-IFD table, not the similarly named MakerNote table, which has different values.
     - Sony: centre the warp on the DNG default crop (`docs/sony-lens-corrections.md`).
     - Fuji: index the table at the **source** radius, with a frame-filling zoom; skip bodies whose stored scale is wrong.
     - Fuji: applying the CA table after LightCraft's demosaic made fringes *worse* (`docs/fuji-lens-corrections.md`). This may
       be specific to LightCraft's demosaic or to its Rec.2020 application point; unverified for darktable/RCD.
   - **Validation harness.** Copy LightCraft's method: render uncorrected vs corrected, compare against the camera JPEG with
     high-passed-luminance NCC or SIFT residuals. Do this first for the owner's **Nikon and Sony** test bodies.
   - **Nikon NEF has no embedded correction in either project**, so Nikon users need lensfun. That makes step 5 important for
     LightBench's first camera.

5. **Lensfun (M).**
   - Port LightCraft's XML reading and EXIF lens matching (`crates/lensdb/src/lib.rs`), but **evaluate the lensfun models
     directly in the shader** instead of refitting them to the DNG polynomial: the refit allows up to 0.001 of the half diagonal
     (about 3.6 px at 24 MP) and can't represent `ptlens` or `poly3` TCA exactly.
   - Follow the lensfun library's own interpolation and normalisation (LGPL-3, compatible with GPL-3) so results match
     darktable's.
   - Data: the lensfun DB is CC-BY-SA 3.0. **The owner decides** between bundling it with attribution and downloading it on
     first use (LightCraft makes users supply it).
   - Add what LightCraft lacks: focus distance for vignetting, a manual lens picker, and lensfun's `<center>` offsets.

6. **Upright: build on darktable `ashift`, and add LightCraft's guard rails (M).**
   - Keep darktable's LSD + RANSAC + fit with the **EXIF focal length and crop factor**. LightCraft's fixed 27 mm-equivalent
     guess (`transform.rs:13`) is weaker for long or wide lenses.
   - From LightCraft (`crates/pipeline/src/upright.rs:427–535`):
     - **Reliability gates**: ≥ 3 inlier segments, total length ≥ ¼ of the long edge, spread ≥ ⅕ of the long edge, ≥ 60 % of
       the family agreeing, and a vanishing point well outside the frame (> 2 half-long-edges). A vanishing point inside the
       frame is a road or sun rays, not camera tilt.
     - **Auto policy**: Full only if the correction is < 20°, else Vertical if < 25°, else Level only if ≤ 5°; a roll implied
       by the verticals must be confirmed by the horizontals.
     - **Guided mode**: up to 4 guides, with one-guide-of-a-kind meaning "level".
   - **Store the solved transform in the edit** (LightCraft stores a homography: `Geometry::upright_transform`; darktable stores
     the fitted rotation/lens-shift/shear). Previews, exports, batch paste and other browsers then render identically without
     re-running analysis.
   - Auto must be re-solved per photo on paste, matching LightBench's "Auto re-run" rule.

7. **GPU robustness patterns before the pipeline grows (S–M).** From `docs/gpu-pipeline.md` "Limits, failures":
   - split long passes into short submissions (LightCraft: ≤ 16 M invocations, about 4 MP bands) to avoid driver watchdog
     resets on integrated GPUs such as the owner's Iris Xe;
   - check that every output pixel was written, and re-render an all-black result;
   - catch device loss and validation errors with error scopes;
   - keep a CPU-vs-GPU or reference-image equivalence test per tool.

   LightBench has no CPU fallback, so the practical form is "detect and tell the user" plus reference-image tests.

8. **Heal/Remove (Phase 3): consider a TypeScript port of `crates/inpaint` (S–M).** A deterministic PatchMatch "Fill" next to
   darktable `retouch`'s clone/heal, before LaMa arrives in Phase 4. It needs no model download and no licence decision.

9. **Later (Phase 5): `crates/merge` as the reference design for HDR/panorama (L).** The algorithms are from papers and
   MIT/Apache. Port them when the time comes; don't pull in its LightCraft decoder dependencies.

**What not to take:** LightCraft's tone map, OkLCh colour tools, sharpening, NR, dehaze and Auto recipe. They are its own
models, which LightCraft itself says are tuned by eye and unmeasured. Mixing them into LightBench's darktable pipeline would give two
inconsistent behaviours behind one set of sliders.

## Things I could not determine

- Whether LightCraft's WGSL compiles and validates under browser WebGPU (Tint/Dawn). It has only run on native wgpu.
- Whether rayon really runs single-threaded inside LightCraft's wasm workers (the web build works, per `docs/web.md`, but I
  didn't trace rayon's fallback).
- Whether LibRaw's WASM build exposes Sony/Fuji lens-correction tags.
- How closely LightCraft's lens interpolation matches lensfun's. LightCraft says it never read lensfun code and hasn't
  validated against another renderer.
- Whether the lensfun database can be bundled with a GPL-3.0 web app as separate CC-BY-SA 3.0 data. This needs the owner's or a
  licensing review, not my reading.
- All accuracy and performance numbers quoted from LightCraft docs are theirs, unreproduced.
