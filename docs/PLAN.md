# Project Plan — LightBench

_Updated 2026-10-10. Based on [RESEARCH.md](RESEARCH.md) and the owner's answers below._

## Decisions made

| Topic | Decision |
|---|---|
| License | **GPL-3.0-or-later**. We may port code and algorithms from darktable / RawTherapee (with attribution). |
| Platform | **Website first** (GitHub Pages, everything runs in the browser), **desktop app later** from the same code. |
| Primary test target | **Windows + Chrome / Edge**. Firefox and Safari supported with reduced file management. |
| First milestone | **Thin end-to-end slice**: import → library → basic edits → export. Then deepen each area. |
| Edit model | **Lightroom-style controls on a darktable-style engine** (scene-referred, linear float). Advanced controls in expandable sections. |
| darktable code | Image processing is **translated from darktable's source** (GPL-3.0) into WebGPU shaders, keeping its copyright notices. Starts in **Phase 1** (owner's decision, 2026-10-10). |
| AI | **Local only**: open models running on the user's GPU in the browser. No cloud services. |
| Lightroom migration | Import **ratings, flags, color labels, keywords, collections**. Edits are not migrated. |
| Roles | Claude writes the code; the owner tests each stage on the live site and gives feedback. |
| Name | **LightBench** (the owner's first choice, "DarkRoom", clashes with an existing photo app). |
| Cameras to test first | **Nikon (NEF)** and **Sony (ARW)**. |
| Git workflow | `main` publishes the site. Work happens on a feature branch and is merged via pull requests the owner approves. |
| darktable first | Before designing a feature, review how darktable does it (full source kept locally; module catalogue in [DARKTABLE_MODULES.md](DARKTABLE_MODULES.md)), then improve the usability. Not just a port (owner, 2026-10-11). |
| Usability | Clean layout, most-used adjustments most prominent, tools grouped by task, sublabels and tooltips that explain each control and its pitfalls. See [USABILITY.md](USABILITY.md). |
| Clipping warning (J) | Shows **lost detail**: sensor clipping plus pure white/black on screen. darktable's own indicator modes stay available (owner, 2026-10-11). |
| Auto and white balance | Auto leaves white balance alone, like Lightroom. White balance gets a **picker with a magnifying loupe** (W) using darktable's spot-picker maths (owner, 2026-10-11). |

## Guiding principles

1. **Approachable by default, full power on demand.** Common controls are visible; advanced ones sit
   in expandable sections or an "advanced" toggle, never removed.
2. **No silent capability cuts.** Any time approachability, browser limits, or effort would reduce a
   capability compared to Lightroom Classic, it goes into the [Tradeoff register](#tradeoff-register)
   and the owner is asked first.
3. **Non-destructive always.** Originals are never modified. Edits are a parameter stack stored in
   the catalog and optionally in XMP sidecars.
4. **Private by design.** Photos never leave the user's computer.
5. **Honest about uncertainty.** Spikes (small experiments) come before big commitments.

## Architecture

```
┌────────────────────────── Browser (GitHub Pages) ──────────────────────────┐
│  UI: TypeScript + React  (Library · Develop · Export · Import)             │
│        │                                                                   │
│  Platform layer (web implementation now, Tauri desktop later)              │
│   • Files: File System Access API (Chrome/Edge) / OPFS fallback            │
│   • Catalog: SQLite-WASM stored in OPFS                                    │
│   • AI: ONNX Runtime Web (WebGPU)                                          │
│        │                                                                   │
│  Engine (Web Workers + GPU)                                                │
│   • RAW decode: LibRaw 0.22 compiled to WebAssembly                        │
│   • Pipeline: WebGPU compute/render shaders (WGSL), rgba16float, linear    │
│   • Colour: scene-referred linear → sigmoid display transform              │
│   • Edit model, presets, XMP read/write, metadata                          │
└────────────────────────────────────────────────────────────────────────────┘
```

**Change from the first draft (engineering choice, no capability impact):** the draft put the engine in
Rust compiled to WebAssembly. Phase 0 showed the browser path works without it — LibRaw is already
available as WebAssembly and the image processing runs in WGSL shaders on the GPU. So the engine starts
in TypeScript + WGSL, avoiding a second language and build chain while the app takes shape. The WGSL
shaders run unchanged under Rust's `wgpu`, so a Rust core can be introduced later (for the desktop app or
CPU-heavy algorithms) without rewriting the image pipeline.

The same UI and engine are later packaged with **Tauri** for a desktop app, which adds native file
access, tethering, card auto-import and native performance.

## Roadmap

Lightroom Classic is the product of a large team over many years. Full parity is a long-term goal;
each phase below delivers usable software on the live site.

### Phase 0 — Foundations and spikes  _(built — awaiting results from the owner's PC, see [PHASE0.md](PHASE0.md))_
- Repo scaffolding, build tooling, GitHub Actions → GitHub Pages deploy, `coi-serviceworker`.
- **Spike A:** RAW decode in browser — LibRaw-wasm (chosen) vs rawler-wasm: camera coverage, speed, size.
- **Spike B:** WebGPU pipeline on a 24 MP image — interactive slider speed on Chrome/Edge.
- **Spike C:** File System Access API — pick a folder, persist permission, read/write sidecars.
- **Spike D:** SQLite-WASM catalog in OPFS — 50k-photo synthetic catalog query speed.
- All four are on the site's **System Check** page, with a copyable report.

### Phase 1 — Thin end-to-end slice (first usable version)

Delivered in three parts:
- **Part 1, Import + Library:** merged.
- **Part 2, Develop with darktable processing:** built, see [PHASE1.md](PHASE1.md).
- **Part 2b, Histogram + Auto** (owner's request, 2026-10-11): built, awaiting PR once PR #4 is merged.
  - **Histogram:** live in Develop, drawn as darktable draws it (log scale by default), with clipping triangles.
  - **Clipping warnings:** **J** (or darktable's **O**) paints lost detail; **Shift+O** shows sensor
    clipping only. darktable's four display-clipping modes and thresholds are in the histogram menu.
  - **White balance picker (W)** with a loupe that follows the cursor.
  - **Auto button:** moves the visible sliders as one history step, aiming at a chosen target profile:
    - **built-in looks** (Natural, Vivid, Landscape, Portrait, Low-key, High-key);
    - **match a reference photo**;
    - **the owner's own saved targets.**
  - **Hints and tooltips** for every Basic slider.
  - Resizable left panel with History docked under the histogram.
- **Part 3, Export, XMP sidecars and JPEG editing:** built, see [PHASE1.md](PHASE1.md#part-3-export-xmp-sidecars-jpeg-editing). The JPEG encoder (jpegli) and its defaults were chosen by a benchmark ([JPEG_ENCODER_BENCHMARK.md](research/JPEG_ENCODER_BENCHMARK.md)).
  - Export follow-ups suggested by the benchmark:
    - **AVIF** export: 22–36 % smaller than JPEG; all major browsers display it.
    - An optional **"optimise PNG"** step (oxipng): −8 to −11 %.
    - **JPEG XL** once Safari and Edge support it fully.
    - "Target a perceptual quality" mode: not yet (too slow in the browser).
- The tone curve stays with the Phase 3 colour tools.

Non-destructive editing: originals are never modified. Edits are settings re-applied to the original on every render, as in Lightroom. Virtual copies (Phase 2) and snapshots (Phase 3) build on this.

- **Import wizard** (Chrome/Edge):
  1. Click **Import** and choose the card or source folder in the Windows folder picker. Subfolders are
     included.
  2. A grid of thumbnails appears, built from each RAW file's embedded preview and loaded
     progressively.
  3. Photos already imported are greyed out and unticked. LightBench recognises them by matching file
     name, capture time and file size against the catalog and the destination folder. New photos are
     ticked.
  4. You tick or untick photos individually, select all or none, shift-click a range, or filter by
     shooting date.
  5. Import **copies** to a destination. (Adding photos where they are moved to **Open folder** in Phase 2.)
     - Destination layout: **by date**, `YYYY/YYYY-MM-DD/` (owner's choice).
     - **Optional renaming templates**, off by default: Date-Sequence, or Custom name + number.
     - **Second backup copy**: copies each original untouched to a backup folder, for example on an
       external drive.
  6. Imported photos appear in the library as they are copied.
  - _Still to do:_
    - Read only the embedded-preview bytes from each file, not the whole RAW, so thumbnails load fast
      from slow cards.
    - Measure copy speed on a real card.
    - Verify whether a drive's top-level folder (`E:\`) can be picked in Chrome, or only `E:\DCIM`.
- **Library:** grid and loupe views, flags (P/X/U), stars (0–5), color labels (6–9),
  basic filter bar, folder tree, keyboard navigation.
- **Develop (basic):** white balance, exposure, contrast, highlights, shadows, whites, blacks,
  texture/clarity (basic), vibrance, saturation, crop/straighten/rotate (_built in Phase 3, Part 1_), before/after, undo history.
- **darktable processing core:** replace the Phase 0 placeholder processing with code translated from
  darktable's modules: demosaic (RCD), highlight reconstruction, exposure, white balance, input colour
  profile and sigmoid tone mapping. The Lightroom-style sliders drive these modules.
- **Export:** JPEG / PNG / TIFF, resize, quality, filename template, metadata include/exclude.
- **XMP sidecars** (owner's decisions, 2026-10-11):
  - **Written automatically, always**, like darktable. Every edit, rating, flag, colour label and keyword
    change also updates a `.xmp` file next to the photo. Write permission is asked once per folder.
  - **Standard fields** for ratings, labels and keywords (`xmp:Rating`, `xmp:Label`, `dc:subject`,
    `lr:hierarchicalSubject`), so Lightroom, darktable and Bridge can read them.
  - LightBench's own edit settings go in a separate `lightbench:` namespace that other apps ignore.
  - **Lightroom-style names** (`DSC_0001.xmp`), owner's choice 2026-10-11: Lightroom, Bridge and Capture One
    read them; darktable imports them when it has no sidecar of its own.
  - Written whenever a rating, flag, label or edit changes (not for untouched photos at import).
  - Reading sidecars back recovers the edits if browser storage is cleared, or on another computer.
  - Existing sidecars written by other apps are preserved: LightBench updates only its own fields and the
    standard fields above.

### Phase 2 — Library depth
**Open folder (browse before import)**, **full-screen culling**, **hierarchical keywords**, **collections / smart collections / Quick Collection**, **stacks**, **virtual copies**, **copy / paste / sync settings with a tunable Auto** and **presets** — _built, see [PHASE2.md](PHASE2.md)_ — owner's choice 2026-10-11: open any folder and start culling (flags, stars, labels) at once. **One library model** (owner, after the round-2 research): opening a folder adds it to the library in place (no copying), it is indexed in the background, and every library feature works on it; there is no separate browse mode. Removing a folder from LightBench never deletes files.
**Auto, tunable** (owner, after round 2): a strength slider, a choice of which sliders Auto may touch, and Auto re-run per photo when applied to many photos — _built (PHASE2.md, Part 7)_.
Collections, smart collections, collection sets, hierarchical keywords, EXIF/IPTC editing (_IPTC core fields built:
title, caption, creator, copyright, location, see [PHASE2.md](PHASE2.md#part-11-metadata-metadata-presets-and-import-presets); EXIF fields not editable yet_),
metadata presets and import presets (_built, PHASE2.md Part 11_), compare and survey views (_built, see [PHASE2.md](PHASE2.md#part-10-compare-and-survey)_).

**Presets** — _built (PHASE2.md, Part 8)_ — owner's choices 2026-10-12: a preset holds chosen settings (the Copy checklist) with an Amount slider (0–200 %), previews on hover, a few labelled starters, and one preset can be picked to develop new photos on Open folder / Import. darktable-style rules by camera, lens or ISO were not chosen for now.

**Lightroom import — postponed** (owner, 2026-10-12: no Lightroom catalog is available to test against). Kept with the owner's answers for when it can be tested: read the Lightroom Classic catalog (.lrcat, read-only) plus Lightroom-written XMP sidecars; bring ratings, flags, labels and keywords, stacks and virtual copies, and the Basic develop sliders approximately (the engines differ, so the look will be close, not identical). Collections were not chosen.

**Installable, offline website (PWA)** (owner, after round 2): works without a connection after the first visit — _built, see [PHASE2.md](PHASE2.md#part-9-installable-offline-app-pwa)_.
**+0.7 EV base exposure shown and configurable** (owner, after round 2): a note under Exposure for RAW files, and a preference for the default used on photos not yet edited.

### Phase 3 — Editing depth
More darktable modules behind Lightroom-style controls (color balance rgb, filmic, denoise (profiled) (_built, Part 13_),
diffuse or sharpen, AMaZE and X-Trans demosaic (_X-Trans built, Part 5_)). Tone curve (parametric + point, RGB; _built, Part 12_), HSL / color mixer and point color (_built, Part 15_), color grading, sharpening
and noise reduction (_built, Part 13_), lens profile corrections (lensfun), chromatic aberration, transform/upright,
vignette and grain, dehaze, camera profiles, masking (brush, linear, radial, color/luminance range),
heal and clone (_built with the Remove brush, Part 11_), snapshots, soft proofing. Develop tools in **one scrolling stack in workflow order, Crop & Lens first, with a jump bar of group buttons** (owner, after round 2; replaces the earlier tabs plan; see USABILITY.md). **Tool search** comes at the end of this phase, once most tools exist.

**Part 1 — built, see [PHASE3.md](PHASE3.md#part-1-process-versions-the-tool-stack-and-crop):** process versions, the tool stack with its jump bar (Crop and Basic so far), and crop, straighten, rotate 90° and flip. Engineering decisions made with it (owner, 2026-10-12, after reviewing LightCraft's code catalogue):
- **Process versions.** Every edit records the version of LightBench's rendering it uses (`process` in the develop settings, separate from the settings' schema `version`). Edits saved before 0.3.0 are version 1; new edits get the current version. Rendering reads each version's own parameters, so a later rendering change never silently changes an existing edit; an older edit offers **Update to current process** (one history step, so it can be compared and undone). Today there is one rendering (version 1).
- **One geometry pass.** Lens correction → perspective (Upright) → flip → crop, darktable's order, are combined into one map from output pixels to the sensor and resampled once (bicubic, darktable's default warp interpolation), never once per tool. Whole-pixel maps (no straighten angle) aren't resampled at all. The warped image is cached, so tone and colour sliders never warp again. Rotate/flip/crop/straighten are built; lens and perspective will join the same map.
- **Crop coordinates** are stored relative to the geometry-corrected image (after lens and perspective), so crops (and later masks) stay on the same content when lens or Upright settings change.
- **The crop model** (a rectangle in the straightened frame plus an angle; flips separate) and its drag rules are ported from LightCraft (MIT), with tests.
- **Later in Phase 3:** write Lightroom's `crs:Crop*` sidecar fields for interop (not done; LightBench's crop lives in `lightbench:Develop`).

**Part 3 — Transform and Upright built, see [PHASE3.md](PHASE3.md#part-3-transform-and-upright)** (owner, 2026-10-12): Upright Auto, Level, Vertical, Full and Guided on darktable's rotate-and-perspective engine (LSD line detection, its fit with the photo's own focal length) with LightCraft's guards against false corrections; Lightroom's Transform sliders; the solved correction stored in the edit; the photo fitted so no empty corners show; Auto straighten in the crop group. It joins the one geometry pass before straightening; lens correction will sit in front of it, and line detection will then look at the lens-corrected photo.

**Part 2 — lens corrections built, see [PHASE3.md](PHASE3.md#part-2-lens-corrections):** distortion, chromatic aberration (TCA) and vignetting, from the camera's own correction data when the RAW carries it (Sony, Fujifilm, Olympus/OM System, DNG, Panasonic, as darktable's lens module reads them), otherwise from Lensfun's database (owner, 2026-10-12). The database is LightBench's pinned copy, downloaded on first use and kept for offline use, not part of the install. On by default for new edits (Auto); edits saved before keep it off and look exactly as before. The lens function joins the single geometry resample; the photo is enlarged just enough that no empty border shows, so crops don't move. A **Lens** section in the Crop & Lens group shows which data corrected the photo and lets the camera or lens be picked, with Distortion and Vignetting amounts and a chromatic aberration switch.

**Part 5 — phone DNGs (linear DNG) and Fujifilm X-Trans built, see [PHASE3.md](PHASE3.md#part-5-phone-dngs-linear-dng-and-fujifilm-x-trans):** the two RAW layouts LightBench used to refuse now open, develop, thumbnail and export. Linear DNGs (Apple ProRAW, phone and converter DNGs) go through the RAW steps without a demosaic and use the DNG colour model (dual-illuminant ColorMatrix/ForwardMatrix interpolated by white balance, ported from LightCraft); X-Trans photos get darktable's default Markesteijn 1-pass demosaic translated to WebGPU. Bayer DNGs LibRaw has no matrix for (e.g. Google Pixel) also use the DNG colour model instead of failing. Old edits of Bayer photos render byte-identically. **Follow-ups:** ProRAW's semantic masks (sky, person mattes) for Phase 4 masks; the DNG profile look (ProfileHueSatMap/LookTable/ToneCurve); the DNG colour model for Bayer DNGs that already open (needs a new process version); Markesteijn 3-pass.

**Part 6 — rating keys and a one-time refresh of older photos built, see [PHASE3.md](PHASE3.md#part-6-rating-keys-and-a-one-time-refresh-of-older-photos)** (owner, 2026-10-12): ] / [ raise or lower the rating and Shift+0–5 rates and goes to the next photo, in both shortcut sets (Lightroom's keys), in the Library, culling, Compare and Survey; [ and ] stay free in Develop for a future brush. Photos added before the extras bundle get their GPS and, for unedited photos with an Adobe RGB camera preview, a corrected thumbnail, once, in the background (catalog schema 13), skipping folders without permission until they can be read.

**Part 8 — output sharpening on Export built, see [PHASE3.md](PHASE3.md#part-8-output-sharpening-on-export)** (owner, 2026-10-12): Lightroom's Export choices, Sharpen for Screen / Matte paper / Glossy paper with Low / Standard / High, off by default, plus a Resolution (ppi) field. darktable's unsharp mask on L* runs on the GPU after the final resize, sized by the print resolution or by how much the photo is downsized, with a halo limit; the strength table is LightBench's own (Lightroom's PhotoKit algorithm isn't public), checked by eye and not yet on prints. Exports without it are byte-identical. **Follow-up:** test prints on matte and glossy paper to check the table.

**Part 11 — the Remove brush (Remove, Heal and Clone without AI) built, see [PHASE3.md](PHASE3.md#part-11-the-remove-brush--remove-heal-and-clone-without-ai)** (owner, 2026-10-12): paint over dust, wires or small objects and LightBench fills the spot from its surroundings (patch-based completion: Wexler et al.'s EM in Newson et al.'s multi-scale form with texture features; the search is hierarchical block matching, not PatchMatch, by the owner's decision of 2026-10-13 after the patent search); each spot can be switched to Heal or Clone (darktable's), its source dragged, and its size, feather and opacity changed, one history step each; Q, [ ], { }, H and Delete in a keyboard context of their own. Spots are stored in sensor coordinates as darktable's retouch stores its shapes, applied before the single geometry pass, computed once with a stored seed and source so every rendering and export gets the same pixels, and never travel with Copy, presets or Auto Sync unless ticked. Old edits are byte-identical; no new process version. **Open:** patents on the replacement search and on Wexler et al.'s method were searched but no claims were read (Part 11's licence section); Remove is slightly worse than with PatchMatch on brick-like textures; Lightroom's Visualize Spots and `crs:RetouchInfo` interop; structure-aware fills for large holes.

**Part 12 — the Tone Curve built, see [PHASE3.md](PHASE3.md#part-12-the-tone-curve)** (owner, 2026-10-13, after the research in `docs/research/TONE_CURVE.md`): a Tone Curve group after Basic with Regions (Lightroom's parametric curve, LightBench's own shape), RGB/Red/Green/Blue point curves on darktable's monotone spline (plus a no-overshoot step), the curve's input histogram behind the graph on the histogram's own axis, hue-keeping colour with a Refine Saturation slider (Adobe's method by default: Largest channel at 100 %), a targeted adjustment tool with a hover marker, arrow keys and anchor points, clipping shown while dragging, keyboard and screen-reader control of points, presets, Copy/Paste and preset Amount, and Lightroom's tone curve fields read and (under Part 7's rules) written. It acts after Contrast, on the tones shown. Off by default; old edits render byte-identically. **Later:** eyedroppers, match a reference photo or the camera's JPEG, an auto curve, the "what Basic did" ghost, option C (the curve's axis applied before the sigmoid), Hue/Sat curves with the Colour tools.

**Part 13 — Detail (sharpening and noise reduction) built, see [PHASE3.md](PHASE3.md#part-13-detail--sharpening-and-noise-reduction)** (owner, 2026-10-13, after [research/DETAIL_DENOISE_SHARPEN.md](research/DETAIL_DENOISE_SHARPEN.md)): a Detail group after the Tone Curve with Lightroom's sliders. Noise reduction is darktable's denoise (profiled) (wavelets, Y0U0V0) with darktable's per-camera noise profiles, downloaded on first use like Lensfun; sharpening is darktable's capture sharpening (Richardson–Lucy deconvolution, from RawTherapee), run after the denoise, with an automatic radius measured from the raw data that Radius multiplies, and its blur as two 1-D passes. The slider mappings are LightBench's own. Sharpening is on for new RAW photos (Amount 40, or 25 above ISO 1000), off for JPEGs; noise reduction is off by default; edits saved before keep both off and render byte-identically. Copy/Paste, presets, history and Lightroom's Detail fields in sidecars. The unsharp mask stays only on Export (Part 8); diffuse or sharpen isn't used.

**Part 15 — the Colour Mixer and Point Color built, see [PHASE3.md](PHASE3.md#part-15-colour-mixer-and-point-color)** (owner, 2026-10-13, after [research/COLOUR_MIXER_EFFECTS.md](research/COLOUR_MIXER_EFFECTS.md) Part A): a Colour group after the Tone Curve with Lightroom's eight bands × Hue, Saturation and Luminance and a Point Color tab (up to 8 picked colours with shifts, Variance and Range), on darktable's color equalizer translated to WebGPU (darktable UCS 22, hue tables, saturation weight, both guided filters with the halo guard as a tiled pre-pass, gamut mapping), before the sigmoid. Band centres are LightCraft's guess at Lightroom's, converted to UCS hue; the bands blend by LightCraft's raised cosine, so nothing overshoots. Targeted adjustment tool with a hover readout and keys, Alt-drag Visualize, Copy/Paste, preset Amount, Lightroom's HSL fields read and written (Point Color not exchanged: its field is undocumented). Off by default; old edits render byte-identically; no new process version. **Later:** Colour grading, B&W mix (`crs:GrayMixer`), Hue/Sat curves, darktable's larger filter radii.

**Keyboard and display** (owner, after round 2; can land in any phase): remappable shortcuts with a Lightroom-compatible preset, UI scaling, every core action reachable by keyboard. **Built** in Phase 2 ([PHASE2.md, Part 12](PHASE2.md#part-12-keyboard-and-display-settings)): Settings with shortcut sets, the ? list, command search, slider keys, interface size and photo background.
**Later in Phase 3 or after:** read and write darktable XMP develop edits (R2 18), once more darktable tools exist in LightBench.

### Phase 4 — Local AI
Subject / sky / object / background masks (SAM 2 / MobileSAM), AI remove (LaMa),
AI denoise (NAFNet-class), assisted culling (sharpness, eyes-open), face grouping, content search.
Model licenses checked individually: **permissive only** — code and weights must allow any use, including commercial (owner, 2026-10-11, re-confirmed after the AI research even though LightBench won't be sold, because the public website's users are bound by each model's licence and the GPL allows no extra restrictions). Non-commercial, research-only and field-of-use-restricted models (e.g. SAM 3) are excluded, also as optional downloads.
Owner's requests (2026-10-11), to be built on the AI masks:
- **AI-assisted Auto**: finds the subject, sky, faces and background, measures each region in the scene-linear
  data, and drives the existing Auto solver with per-region goals (e.g. subject at mid-grey, sky not clipped,
  faces at skin brightness). Results stay ordinary, editable sliders.
- **Auto for a selected area**: with a mask selected, Auto sets that mask's adjustments from its own pixels only.
- **Hover selection previews**: moving the cursor over the photo outlines the object under it live (a SAM-style
  model reads the image once, then outlines what is under the cursor in milliseconds); a click makes it a mask.
- **Model downloads**: on first use, as darktable does; a small default model per tool with an optional
  higher-quality download (owner: "let the user choose").
- Model research (done 2026-10-11): [research/AI_MODELS.md](research/AI_MODELS.md). Defaults proposed: SAM 2.1 Tiny
  (hover/click), BiRefNet-lite (subject), MediaPipe Selfie Multiclass (people), YuNet (faces), Depth Anything V2 Small;
  SAM 3 excluded by its licence; no pretrained tone model has usable training data, so AI Auto is built on masks.
  The owner picks models before Phase 4. darktable 5.6 ships SAM 2.1 (Hiera small) and SegNext for masks
  (`data/ai_models.json`).

Owner's requests (2026-10-12), decided after discussion:
- **Fill clipped highlights and shadows.** Both blown highlights and crushed shadows, each with its own threshold and
  a **buffer** slider (grows or shrinks the area), shown as an on-photo preview before pressing Go.
  - **Recover first, AI only where nothing is left:** partly clipped areas use real reconstruction (darktable's
    highlight reconstruction, already in LightBench); AI fills only areas with no data left (all channels clipped,
    or crushed to black). The buffer can still extend the AI fill over the fringe that recovery handled, where the
    owner judges recovery looks worse.
  - AI-filled areas are **invented, not recovered**: label them as generated and keep them as a separate, removable
    layer.
  - The model needs research: no inpainting model's licence has been checked yet against the permissive-only rule
    (LaMa is planned for AI remove but unverified). A no-AI patch-based fill is built (the Remove brush, PHASE3.md
    Part 11) and could fill small areas.
- **AI remove** joins the Remove brush as a fourth spot mode next to Remove, Heal and Clone (`SPOT_MODES` in
  `engine/develop/spots.ts`); a spot already stores its stroke, source and seed.
- **AI depth of field (lens blur).** Blur that grows with distance from the focus plane, both in front and behind
  (more bokeh for objects further from the focus distance), not just "blur everything except the subject".
  - A **strength** slider; **click to set the focus point**, with a focus-range slider; **auto focus on the detected
    subject** to start; **refine the depth map with a brush** (hair, glass, fences); a choice of **bokeh shape**
    (round, cat's-eye, aperture-blade polygon).
  - Depth from **Depth Anything V2 Small** (Apache-2.0, about 50 MB, official in-browser WebGPU demo), already the
    proposed depth model above; its larger checkpoints are non-commercial and excluded.
  - Lightroom has a comparable Lens Blur (unverified against Adobe's docs).
- **When:** both in Phase 4, as planned; inpainting-model licence research when Phase 4 starts.

### Phase 5 — Output and advanced
HDR and panorama merge, HDR editing and export (AVIF / JPEG XL / gain-map JPEG), map module,
print module, slideshow, web gallery, book module, plugin system.

### Phase 6 — Desktop app (Tauri)
Native file management, tethered capture, card auto-import, watched folders, larger memory,
faster native processing. Same UI and engine as the website.

### Every release (owner, after round 2)
- **Speed:** agreed slider-to-preview time budgets, checked by an automated speed test before each release; published minimum browsers and GPUs. Budgets are confirmed on the owner's GPU before they are fixed.
- **Release notes in the app:** new features, bug fixes, and "what moved" notes when a control moves or is renamed.
- **Rollback:** the previous website version stays one click away.
- **Compatible edits:** older and newer versions can read each other's saved edits.

### Later — Mobile (to explore)
Owner's direction (2026-10-11): a mobile version later, for **iPhone, iPad and Android phones**. What it is for (culling and light edits, or full editing) is not decided yet; until then, keep code mobile-friendly (no desktop-only assumptions in the engine, touch-capable controls).
Known constraints to plan for (to verify when this starts):
- Phone browsers can't open folders like desktop Chrome, so photos would come through the phone's photo picker into app storage; a Tauri 2 mobile app would get proper library access.
- Memory: editing at screen resolution and tiled full-size export, because phones cap memory per app or tab.
- GPU: WebGPU is in Chrome on Android and in Safari since iOS 26 (device support to check); phones throttle when hot.
- AI: small default models only.
- Interface: touch layout (bigger controls, swipe culling, bottom panel).

## Owner tests pending

Tests the owner will run later. They are deferred because there is no SD card reader for the laptop.

| Test | Why it matters |
|---|---|
| Import from a real SD card (D5200), both **Copy** and **Add** | Confirms the full card workflow in Edge |
| Can Edge pick the card's top level (`E:\`), or only `E:\DCIM`? | Decides the import window's guidance text |
| Thumbnail speed and copy speed from the card | Shows whether reading only the preview bytes is urgent |
| Backup copy to a second drive | Confirms the backup option on real hardware |

## Tradeoff register

Capabilities that would be **reduced** vs Lightroom Classic. Each requires the owner's sign-off.

| # | Capability | Reduction | Reason | Status |
|---|---|---|---|---|
| T1 | Tethered capture | Not available on the website | Browser cannot control cameras reliably | Accepted (comes with desktop app, Phase 6) |
| T2 | Card auto-import / watched folders | Not available on the website | Browser cannot detect device insertion | Accepted (desktop app, Phase 6) |
| T3 | Edit in place in Firefox / Safari | Files imported as copies into browser storage | No folder write API in those browsers | Accepted (Chrome/Edge is primary) |
| T4 | Generative Remove / Expand | Local AI only; lower quality than Adobe Firefly | Owner chose no cloud AI | Accepted |
| T5 | Lightroom edit migration | Edits not imported | Adobe processing is proprietary; results would not match | Accepted |

## Open questions
- None blocking. Phase 1 starts once the owner's System Check report is in.
