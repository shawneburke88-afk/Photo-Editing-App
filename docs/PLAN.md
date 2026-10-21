# Project Plan — LightBench

_Updated 2026-10-21 (first written 2026-10-10). Based on [RESEARCH.md](RESEARCH.md) and the owner's answers below. The order of the remaining work up to 1.0 is in [ROADMAP.md](ROADMAP.md); what each part does is in the phase documents ([PHASE3.md](PHASE3.md) has the parts up to 25 and the changes since)._

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

### Phase 0 — Foundations and spikes  _(built, see [PHASE0.md](PHASE0.md))_
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
- **Part 2b, Histogram + Auto** (owner's request, 2026-10-11): built.
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
diffuse or sharpen, AMaZE and X-Trans demosaic (_X-Trans built, Part 5_)). Tone curve (parametric + point, RGB; _built, Part 12_), HSL / color mixer and point color (_built, Part 15_), color grading (_built, Part 17_), sharpening
and noise reduction (_built, Part 13_), lens profile corrections (lensfun), chromatic aberration, transform/upright,
vignette and grain, dehaze, texture and clarity, glow (_built, Part 25_), camera profiles, masking (brush, linear, radial, color/luminance range; _built, Part 23_),
heal and clone (_built with the Remove brush, Part 11_), snapshots (_built, Part 19_), soft proofing (_built, Part 20_). Develop tools in **one scrolling stack in workflow order, Crop & Lens first, with a jump bar of group buttons** (owner, after round 2; replaces the earlier tabs plan; see USABILITY.md). **Tool search** comes at the end of this phase, once most tools exist.

**Part 1 — built, see [PHASE3.md](PHASE3.md#part-1-process-versions-the-tool-stack-and-crop):** process versions, the tool stack with its jump bar (Crop and Basic so far), and crop, straighten, rotate 90° and flip. Engineering decisions made with it (owner, 2026-10-12, after reviewing LightCraft's code catalogue):
- **Process versions.** Every edit records the version of LightBench's rendering it uses (`process` in the develop settings, separate from the settings' schema `version`). Edits saved before 0.3.0 are version 1; new edits get the current version. Rendering reads each version's own parameters, so a later rendering change never silently changes an existing edit; an older edit offers **Update to current process** (one history step, so it can be compared and undone). There are two renderings: version 1, and version 2 since Part 10 (the tone equalizer's new defaults for Highlights, Shadows, Whites and Blacks).
- **One geometry pass.** Lens correction → perspective (Upright) → flip → crop, darktable's order, are combined into one map from output pixels to the sensor and resampled once (bicubic, darktable's default warp interpolation), never once per tool. Whole-pixel maps (no straighten angle) aren't resampled at all. The warped image is cached, so tone and colour sliders never warp again. Rotate/flip/crop/straighten are built; lens and perspective will join the same map.
- **Crop coordinates** are stored relative to the geometry-corrected image (after lens and perspective), so crops stay on the same content when lens or Upright settings change. (Masks, Part 23, went further: their points are stored in sensor coordinates, like the Remove spots, so they also follow the content when the angle, Upright or the lens correction change later; owner's decision, 2026-10-13.)
- **The crop model** (a rectangle in the straightened frame plus an angle; flips separate) and its drag rules are ported from LightCraft (MIT), with tests.
- **Later in Phase 3:** write Lightroom's `crs:Crop*` sidecar fields for interop (not done; LightBench's crop lives in `lightbench:Develop`).

**Part 3 — Transform and Upright built, see [PHASE3.md](PHASE3.md#part-3-transform-and-upright)** (owner, 2026-10-12): Upright Auto, Level, Vertical, Full and Guided on darktable's rotate-and-perspective engine (LSD line detection, its fit with the photo's own focal length) with LightCraft's guards against false corrections; Lightroom's Transform sliders; the solved correction stored in the edit; the photo fitted so no empty corners show; Auto straighten in the crop group. It joins the one geometry pass before straightening; lens correction will sit in front of it, and line detection will then look at the lens-corrected photo.

**Parts 4, 7, 9 and 10 — built, see [PHASE3.md](PHASE3.md):** extras (twin sidecars, preview colour, GPS, IPTC, Display P3, JPEG Tint; [Part 4](PHASE3.md#part-4-extras--twin-sidecars-preview-colour-gps-iptc-display-p3-jpeg-tint)); Lightroom's crop, straighten, orientation, Transform and Upright read from and written to sidecars ([Part 7](PHASE3.md#part-7-lightrooms-crop-straighten-orientation-transform-and-upright-in-sidecars)); lens and X-Trans follow-ups ([Part 9](PHASE3.md#part-9-lens-and-x-trans-follow-ups-and-a-keyboard-test-fix)); the tone equalizer's new defaults as **process version 2** ([Part 10](PHASE3.md#part-10-the-tone-equalizer-as-darktables-defaults-process-version-2)).

**Part 2 — lens corrections built, see [PHASE3.md](PHASE3.md#part-2-lens-corrections):** distortion, chromatic aberration (TCA) and vignetting, from the camera's own correction data when the RAW carries it (Sony, Fujifilm, Olympus/OM System, DNG, Panasonic, as darktable's lens module reads them), otherwise from Lensfun's database (owner, 2026-10-12). The database is LightBench's pinned copy, downloaded on first use and kept for offline use, not part of the install. On by default for new edits (Auto); edits saved before keep it off and look exactly as before. The lens function joins the single geometry resample; the photo is enlarged just enough that no empty border shows, so crops don't move. A **Lens** section in the Crop & Lens group shows which data corrected the photo and lets the camera or lens be picked, with Distortion and Vignetting amounts and a chromatic aberration switch.

**Part 5 — phone DNGs (linear DNG) and Fujifilm X-Trans built, see [PHASE3.md](PHASE3.md#part-5-phone-dngs-linear-dng-and-fujifilm-x-trans):** the two RAW layouts LightBench used to refuse now open, develop, thumbnail and export. Linear DNGs (Apple ProRAW, phone and converter DNGs) go through the RAW steps without a demosaic and use the DNG colour model (dual-illuminant ColorMatrix/ForwardMatrix interpolated by white balance, ported from LightCraft); X-Trans photos get darktable's default Markesteijn 1-pass demosaic translated to WebGPU. Bayer DNGs LibRaw has no matrix for (e.g. Google Pixel) also use the DNG colour model instead of failing. Old edits of Bayer photos render byte-identically. **Follow-ups:** ProRAW's semantic masks (sky, person mattes) for Phase 4 masks; the DNG profile look (ProfileHueSatMap/LookTable/ToneCurve); the DNG colour model for Bayer DNGs that already open (needs a new process version); Markesteijn 3-pass.

**Part 6 — rating keys and a one-time refresh of older photos built, see [PHASE3.md](PHASE3.md#part-6-rating-keys-and-a-one-time-refresh-of-older-photos)** (owner, 2026-10-12): ] / [ raise or lower the rating and Shift+0–5 rates and goes to the next photo, in both shortcut sets (Lightroom's keys), in the Library, culling, Compare and Survey; [ and ] stay free in Develop for a future brush. Photos added before the extras bundle get their GPS and, for unedited photos with an Adobe RGB camera preview, a corrected thumbnail, once, in the background (catalog schema 13), skipping folders without permission until they can be read.

**Part 8 — output sharpening on Export built, see [PHASE3.md](PHASE3.md#part-8-output-sharpening-on-export)** (owner, 2026-10-12): Lightroom's Export choices, Sharpen for Screen / Matte paper / Glossy paper with Low / Standard / High, off by default, plus a Resolution (ppi) field. darktable's unsharp mask on L* runs on the GPU after the final resize, sized by the print resolution or by how much the photo is downsized, with a halo limit; the strength table is LightBench's own (Lightroom's PhotoKit algorithm isn't public), checked by eye and not yet on prints. Exports without it are byte-identical. **Follow-up:** test prints on matte and glossy paper to check the table.

**Part 11 — the Remove brush (Remove, Heal and Clone without AI) built, see [PHASE3.md](PHASE3.md#part-11-the-remove-brush--remove-heal-and-clone-without-ai)** (owner, 2026-10-12): paint over dust, wires or small objects and LightBench fills the spot from its surroundings (patch-based completion: Wexler et al.'s EM in Newson et al.'s multi-scale form with texture features; the search is hierarchical block matching, not PatchMatch, by the owner's decision of 2026-10-13 after the patent search); each spot can be switched to Heal or Clone (darktable's), its source dragged, and its size, feather and opacity changed, one history step each; Q, [ ], { }, H and Delete in a keyboard context of their own. Spots are stored in sensor coordinates as darktable's retouch stores its shapes, applied before the single geometry pass, computed once with a stored seed and source so every rendering and export gets the same pixels, and never travel with Copy, presets or Auto Sync unless ticked. Old edits are byte-identical; no new process version. **Open:** patents on the replacement search and on Wexler et al.'s method were searched but no claims were read (Part 11's licence section); Remove is slightly worse than with PatchMatch on brick-like textures; Lightroom's Visualize Spots and `crs:RetouchInfo` interop; structure-aware fills for large holes.

**Part 12 — the Tone Curve built, see [PHASE3.md](PHASE3.md#part-12-the-tone-curve)** (owner, 2026-10-13, after the research in `docs/research/TONE_CURVE.md`): a Tone Curve group after Basic with Regions (Lightroom's parametric curve, LightBench's own shape), RGB/Red/Green/Blue point curves on darktable's monotone spline (plus a no-overshoot step), the curve's input histogram behind the graph on the histogram's own axis, hue-keeping colour with a Refine Saturation slider (Adobe's method by default: Largest channel at 100 %), a targeted adjustment tool with a hover marker, arrow keys and anchor points, clipping shown while dragging, keyboard and screen-reader control of points, presets, Copy/Paste and preset Amount, and Lightroom's tone curve fields read and (under Part 7's rules) written. It acts after Contrast, on the tones shown. Off by default; old edits render byte-identically. **Later:** eyedroppers, match a reference photo or the camera's JPEG, an auto curve (built in Part 21), the "what Basic did" ghost, option C (the curve's axis applied before the sigmoid), Hue/Sat curves with the Colour tools.

**Part 13 — Detail (sharpening and noise reduction) built, see [PHASE3.md](PHASE3.md#part-13-detail--sharpening-and-noise-reduction)** (owner, 2026-10-13, after [research/DETAIL_DENOISE_SHARPEN.md](research/DETAIL_DENOISE_SHARPEN.md)): a Detail group after the Tone Curve with Lightroom's sliders. Noise reduction is darktable's denoise (profiled) (wavelets, Y0U0V0) with darktable's per-camera noise profiles, downloaded on first use like Lensfun; sharpening is darktable's capture sharpening (Richardson–Lucy deconvolution, from RawTherapee), run after the denoise, with an automatic radius measured from the raw data that Radius multiplies, and its blur as two 1-D passes. The slider mappings are LightBench's own. Sharpening is on for new RAW photos (Amount 40, or 25 above ISO 1000), off for JPEGs; noise reduction is off by default; edits saved before keep both off and render byte-identically. Copy/Paste, presets, history and Lightroom's Detail fields in sidecars. The unsharp mask stays only on Export (Part 8); diffuse or sharpen isn't used.

**Part 14 — GPU robustness built, see [PHASE3.md](PHASE3.md#part-14-gpu-robustness)** (owner, 2026-10-13, after the diagnoses in `docs/diagnosis/`): GPU work in Export, the background developer and the 100 % view runs inside the device's error scopes, so a failed command never becomes a black file or thumbnail; lost devices are replaced and the photo retried once (never after a validation error), with messages for people; exports over the card's buffer limits are refused up front. The WebGPU present test runs once per page at start-up (skipped on software adapters), so it no longer loses every other GPU device when Develop opens. Develop makes a new engine after a lost device and shows a short notice. Background GPU work waits while Develop draws (a foreground gate that can't starve or deadlock), and background engines free each photo's textures. Old edits are byte-identical. The Remove brush's pins now map through the drawing on screen (the earlier `e2e-remove` failures were stale pins, not fills). **Open:** nothing was tried on a real GPU (driver resets, out of memory, present failures); `unload()`'s saving wasn't measurable on SwiftShader. Develop's own engine got its error guard in the hardening build (below). **0.6.8 freeze report** (Part 14's last section): replaced textures are now freed as soon as the drawings that may use them end, and the white balance picker's loupe no longer runs a full-size Detail pass; `memoryStats()` reports the engine's GPU memory.

**Part 15 — the Colour Mixer and Point Color built, see [PHASE3.md](PHASE3.md#part-15-colour-mixer-and-point-color)** (owner, 2026-10-13, after [research/COLOUR_MIXER_EFFECTS.md](research/COLOUR_MIXER_EFFECTS.md) Part A): a Colour group after the Tone Curve with Lightroom's eight bands × Hue, Saturation and Luminance and a Point Color tab (up to 8 picked colours with shifts, Variance and Range), on darktable's color equalizer translated to WebGPU (darktable UCS 22, hue tables, saturation weight, both guided filters with the halo guard as a tiled pre-pass, gamut mapping), before the sigmoid. Band centres are LightCraft's guess at Lightroom's, converted to UCS hue; the bands blend by LightCraft's raised cosine, so nothing overshoots. Targeted adjustment tool with a hover readout and keys, Alt-drag Visualize, Copy/Paste, preset Amount, Lightroom's HSL fields read and written (Point Color not exchanged: its field is undocumented). Off by default; old edits render byte-identically; no new process version. **Later:** B&W mix (`crs:GrayMixer`), Hue/Sat curves, darktable's larger filter radii. (Colour grading came with Part 17.)

**Part 16 — GPU benchmark built, see [PHASE3.md](PHASE3.md#part-16-gpu-benchmark)** (coordinator, 2026-10-13, IMPROVEMENTS.md C20a): a GPU benchmark section in System Check that times the pipeline's stages (Stage A with rawprepare, highlights and demosaic, the lens warp, the tone mask, denoise and capture sharpening, the display pass at fit and 100 % with and without a Tone Curve, a Remove spot, the export render, JPEG encoding, thumbnails) on synthetic 24 and 45 MP Bayer, 26 MP X-Trans and 24 MP sRGB images, through the engine's own API, with timestamp queries per pass where available and wall-clock times always; median and min after warm-ups, Quick and Full modes, Cancel, recovery from a lost device, memory estimated from the engine's allocations, and Copy results as Markdown or JSON (nothing is sent). Lazy-loaded; rendering unchanged. **Open:** a fixed set of real photos; time budgets confirmed on the owner's GPU. The release check came with the hardening build (below: a speed check on every push to main, warnings only). (The Colour Mixer rows, guided filter on and off, came with Part 15.)

**Part 17 — Colour Grading built, see [PHASE3.md](PHASE3.md#part-17-colour-grading)** (owner, 2026-10-14, after [research/COLOUR_GRADING.md](research/COLOUR_GRADING.md); Adobe's facts checked by Cowork the same day): a Colour Grading group after the Colour Mixer (jump bar "Grading") with Lightroom's four wheels (Shadows, Midtones, Highlights, Global: hue and saturation as a point on the wheel, a Luminance slider, number fields), Blending and Balance, in 3-Way and single-wheel views, on darktable's color balance rgb translated to WGSL, before the sigmoid and after the mixer: Shadows → lift, Highlights → gain, Midtones → power, Global → darktable's offset added in proportion to each pixel's luminance (an even tint, unaffected by Blending and Balance), Blending → the masks' fall-off, Balance → their middle-grey fulcrum; the rest of the module under Advanced. Gestures as Adobe describes Lightroom's (Shift, Ctrl/⌘, Alt, double-click, Alt-drag on Blending), full keyboard and screen-reader control, Copy/Paste, preset Amount (wheels blended as colour vectors), Lightroom's hybrid Split Toning / ColorGrade sidecar fields read and written (old Split Toning sidecars read with Blending 100). The stage is skipped when it changes nothing and adds only what the grade changes, so old edits render byte-identically; no new process version. Basic's Vibrance and Saturation are unchanged. **Later:** a hover readout of the range masks, darktable's checkerboard mask previews and JzAzBz formula, a "pick the opposite colour" eyedropper; confirming the hue scale and Blending-100 rule against a sidecar Lightroom wrote.

**Part 18 — culling helpers built, see [PHASE3.md](PHASE3.md#part-18-culling-helpers)** (owner, 2026-10-13, after [research/CULLING_HELPERS.md](research/CULLING_HELPERS.md)): without AI or downloads, each photo's camera preview is measured on the CPU in a pausable background pass right after Open folder or Import (which keep their old speed; owner, 2026-10-14), and older photos once: tiled sharpness weighted by the camera's AF point where the file records it, shake, exposure, and 64-bit perceptual hashes, with sub-second time and frame counters for burst order (catalog schema 14, a `photo_analysis` table; nothing in sidecars). The Library shows switchable badges (possibly soft, shake, clipped, look-alike, best in stack, suggested reject) with reasons, sorts and filters by sharpness, Auto-stacks by look-alikes with a strictness slider, selects the best of each stack, and suggests rejects that only Apply flags, in one step Undo reverses; Z in culling zooms to the measured focus point. Old edits render identically. **Open:** thresholds tuned on a labelled set of the owner's photos; more cameras' AF points (Canon, Nikon, Pentax); faces and blinks with the Phase 4 runtime.

**Part 19 — snapshots built, see [PHASE3.md](PHASE3.md#part-19-snapshots)** (owner, 2026-10-14, after [research/SNAPSHOTS_PROOFING_SEARCH.md](research/SNAPSHOTS_PROOFING_SEARCH.md) Part A and Cowork's check of it): named copies of a photo's full develop settings (process version included) with the time they were made, listed in a Snapshots panel between Presets and History; the default name is a date/time stamp (as Lightroom's, per a secondary source), edited as the snapshot is made. Click applies one as one undoable history step "Snapshot: name"; hover previews it on the photo; Update with current settings, Rename, Delete (each undoable) and **Set as Before**, which makes `\` compare against it until cleared or another photo is shown; a History step's menu has "Create snapshot from this step". **Ctrl+Alt+N** makes one everywhere and **Ctrl+N** too in the installed app window (`display-mode: standalone`, where Chromium reserves no keys; in a tab Ctrl+N stays the browser's). Stored in a new catalog table (schema 15, deleted with the photo) and in the photo's sidecar as `lightbench:Snapshots` (JSON, like `lightbench:Develop`; a virtual copy's inside its `lightbench:Versions` entry), read back on Open folder/Import and by Read changes (merged by snapshot); Lightroom's own snapshot field is undocumented and not touched. Virtual copies have their own; Copy/Paste, Sync and presets don't carry them. Applying an older snapshot keeps its process version; nothing renders differently. **Open:** a split or side-by-side comparison (darktable, Lightroom); Lightroom's sharing of snapshots between a photo and its copies; a limit on their number (research Q A4).

**Part 20 — soft proofing built, see [PHASE3.md](PHASE3.md#part-20-soft-proofing)** (owner, 2026-10-14, after [research/SNAPSHOTS_PROOFING_SEARCH.md](research/SNAPSHOTS_PROOFING_SEARCH.md) Part B and its Cowork check): Lightroom-style soft proofing in Develop. **S** turns it on, **Shift+S** shows the destination gamut warning (Adobe's keys); a bar under the toolbar holds the profile, the rendering intent (Relative Colorimetric with black point compensation by default; Perceptual, Saturation, Absolute), Simulate Paper & Ink, a screen gamut warning labelled sRGB or Display P3 (browsers don't expose the monitor's profile), the destination gamut warning and **Create Proof Copy** (a virtual copy named after the profile). Profiles: sRGB, Adobe RGB (1998)-compatible and Display P3 written by LightBench from published primaries, plus printer and paper ICC files loaded from disk and kept in this browser (RGB as Lightroom; CMYK also works). Little CMS (lcms-wasm, MIT, lazily loaded in a worker) bakes a 65³ table per profile and options; the display shader samples it only while proofing, so with proofing off everything renders byte-identically, and the histogram follows the proof. Firefox, whose canvases can't hold Display P3, now gets sRGB with a note. Proofing never changes exports; settings are a view kept in this browser, not in edits or sidecars. **Later:** "Export with this profile" for loaded printer profiles; offering a proof copy when an edit starts in proof mode (Lightroom does, per search summaries only); checking against Lightroom and real printer profiles.

**Part 21 — section eyes and Tone Curve Auto built, see [PHASE3.md](PHASE3.md#part-21-section-eyes-and-tone-curve-auto)** (owner, 2026-10-14: "not all modules have eyes... the white balance and tone sections within don't have eyes"; for the Tone Curve, "all three" Auto options and "Keep as is" for the layout): an eye per section inside the groups, next to the group eyes, in each section's heading (Crop, Transform, Lens; White balance, Tone, Presence; Sharpening, Noise reduction) or as a row of small labelled eyes under the view tabs (the Tone Curve's Regions, RGB, Red, Green and Blue; the Colour Mixer's Mixer and Point Color; Colour Grading's four wheels). A section's eye shows the photo and histogram with that section exactly as its own Reset sets it (white balance As Shot, with the RAW stage rebuilt so the view is pixel-identical; a RAW's default sharpening), nothing saved; the group eye still hides the whole group and overrides; the badge names sections; every eye resets on another photo. The Tone Curve gets an **Auto** row under its presets: Auto contrast (a gentle S-curve on the RGB point curve fitted to the curve's input histogram, never clipping more than the current curve), Auto colour (small bounded R/G/B curve moves that neutralise a cast; white balance untouched), Suggestions (the presets and both Auto results drawn on the photo, hover to preview, click to apply) and an Amount that changes the step in place. LightBench's own methods; only curve settings are written, so no new process version. **Later:** Auto colour from near-neutral pixels rather than whole-channel percentiles; a per-section eye for Remove's single spots; tuning the Auto contrast target on the owner's photos.

**Part 22 — CPU budget, multi-core Remove and overlapped export built, see [PHASE3.md](PHASE3.md#part-22-cpu-budget-multi-core-remove-and-overlapped-export)** (owner, 2026-10-14, after the GPU benchmark on the RTX 4000 Ada showed the CPU steps, not the GPU, as the bottleneck): one CPU budget of half the logical cores shared by Remove's fill workers, Export's encoders, Open folder's and Import's probes and the background passes, foreground work first (background passes pause between items); Remove's fills on several workers (chunks and each fill's two completions in parallel, and the patch vectors, searches and votes split through shared memory), byte-identical to main; Export encodes (JPEG, PNG, TIFF) on encoder workers while the GPU develops the next photo, finishing files strictly in photo order, with memory bounded. No setting, no process version; old edits and exported files are byte-identical. **Open:** speed-ups on a real GPU and a many-core CPU are unmeasured (SwiftShader on a shared 4-core machine only); a GPU port of the fill search (needs a process version).

**Part 23 — masking built, see [PHASE3.md](PHASE3.md#part-23-masking)** (owner's decisions 1–14, 2026-10-13/14, in [research/MASKING.md](research/MASKING.md); Adobe's facts checked by Cowork, [research/cowork-2026-10-13b/B_MASKING.md](research/cowork-2026-10-13b/B_MASKING.md)): a docked **Masks** group with Brush, Linear and Radial gradients, Luminance and Colour (OkLab) ranges, Add/Subtract/Intersect and Invert, Amount (0–200 %, an assumption), Feather and Refine, and local Temp, Tint, Exposure, Contrast (scene-referred), Highlights, Shadows, Whites, Blacks, Saturation and Vibrance; drawn on the photo (Adobe's keys Shift+W, K, M, Shift+M, Shift+J, Shift+Q, O, Shift+O, Alt+O, H, [ ]), Lightroom's six overlay modes, pen pressure (off by default), group and per-mask eyes. Points in sensor coordinates (masks follow their content through crop, angle, Upright and lens changes); darktable's combine maths and falloffs as LightBench's own; rasterised on the GPU per 1024 px tile at the drawing's resolution (Develop, histogram, thumbnails, Export at full size), before the sigmoid; range masks measure after white balance and exposure. **Design-around** (decision 12): range masks apply to the whole photo, never intersected with or subtracted from a shape; no automatic colour-aware brush. Copy/Paste (unticked, added to the target's), presets (no brush strokes), history, snapshots, virtual copies, `lightbench:` sidecar fields; Lightroom's `crs:` masks read best-effort (experimental) and never written, a `.acr` file noticed. Caps 64 / 32 / 10,000. Old edits render byte-identically; no new process version. **Next (built in Part 24):** the AI Depth range mask. **Later:** spatial local sliders as their global tools land, darktable XMP export of masks, a Lightroom-written sidecar to confirm the `crs:` decoding.

**Part 24 — AI Depth range mask and model delivery built, see [PHASE3.md](PHASE3.md#part-24-ai-depth-range-mask-and-model-delivery)** (owner's decisions 2, 10 and 12 in [research/MASKING.md](research/MASKING.md); delivery decided 2026-10-17, recorded in [research/PHASE4_MODELS.md](research/PHASE4_MODELS.md#model-delivery)): LightBench's first downloaded AI model, **Depth Anything V2 Small** (Apache-2.0; training sets named publicly, some with non-commercial or research-only terms, said so in plain words), as a **Depth range** part of the range family (no Depth ∩ shape). **Delivery foundation for Phase 4:** a pinned manifest (`web/models/manifest.json`), the deploy fetching each file by exact URL and SHA-256 into the Pages site (not in git, not precached), an opt-in dialog (size, licence, training data), Cache Storage on the device with SHA-256 checks, offline use, Settings → AI models (info and removal), and **one runtime** (ONNX Runtime Web 1.30.0, native WebGPU provider, in a worker on its own GPU device; fp16 only with `shader-f16`; a WebAssembly CPU fallback without WebGPU; a 3-minute watchdog). The depth map is stored **inside the edit and the .xmp** (8-bit, sensor frame, MED + DEFLATE + base64), so other machines draw it without the model. **Pinned** (2026-10-20) by the "AI models" GitHub Action at commit `4472b7362082ad9968fee890ca0f1e5aca36b93d` (fp16 49,642,442 bytes, fp32 99,060,839 bytes), with the real-model check passing there. Released in 0.6.13. **Later:** the other Phase 4 models on the same runtime and delivery; the real model's speed on the owner's GPU and the sidecar size per range; recomputing on paste automatically.

**Part 25 — effects built, see [PHASE3.md](PHASE3.md#part-25-effects)** (owner's answers 2026-10-17 and the decisions after Cowork's patent check, in [research/EFFECTS_DESIGN.md](research/EFFECTS_DESIGN.md)): **Texture**, **Clarity** and **Dehaze** in Basic → Presence, and a new **Effects** group (jump bar "Effects") with **Post-Crop Vignetting** (Highlight Priority as a scene-linear gain before the sigmoid with highlight protection; Color Priority and Paint Overlay on the display image; darktable's centre and shape under Advanced), **Grain** (darktable's 3D simplex grain and paper response, a seed stored per edit and new for a virtual copy, LightBench's Roughness, colour grain under Advanced) and **Glow** (LightBench's scene-linear glow before the sigmoid: Bloom, Diffusion, Halation; Range, Spread, Warmth; ranges LightBench's own). Texture/Clarity are darktable's contrast & texture (EIGF bands; Clarity coarse + medium with LightCraft's mid-tone weight, Texture fine; radii within the crop); Dehaze is darktable's haze removal before Exposure (distance 0.2 under Advanced, negative allowed, statistics within the crop, full-resolution guided filter) under the owner's **binding constraints**: strength and distance always the user's, darktable's constant-eps colour guided filter on the RGB minimum, no output-side clean-up, no trained model or multi-frame airlight. Section and group eyes; masks gain local Texture, Clarity, Dehaze (a fourth mask plane) and a local Glow amount; Copy/Paste and Sync; Lightroom's `crs:` Texture, Clarity2012, Dehaze, PostCropVignette\*, Grain\* read at import and written back under Part 7's rules, Glow's fields read only. Export gains **Dither JPEGs** (off by default; exports unchanged). Old edits render byte-identically; no new process version. **Later:** real-GPU timings (ten benchmark rows), a Lightroom-written sidecar to confirm the field encodings, Lightroom's Glow amount field.

**Since Part 25** (each built, see the linked section of [PHASE3.md](PHASE3.md)):
- **Diagnostics** (0.6.8; [PHASE3.md](PHASE3.md#diagnostics-flight-recorder)): Settings → Diagnostics → **Record diagnostics**, off by default, keeps a log of Develop's actions and the GPU engines' events in the browser's storage (it survives a crash or power-off; never file names, folders or pixels), with **Export diagnostics…** and **Clear**; a GPU memory readout; a one-time tip when LightBench runs on integrated Intel graphics.
- **Develop groups start collapsed** (owner, 2026-10-19; [PHASE3.md](PHASE3.md#develop-groups-start-collapsed-owner-2026-10-19)): every group and secondary section starts closed, and what the user opens is remembered.
- **Import speed** (owner, 2026-10-20; 0.6.10; [PHASE3.md](PHASE3.md#import-speed-owner-2026-10-20)): every step timed into the Diagnostics log; the import finishes once every file is copied and checked, and sidecar details fill in afterwards in the background (also after a restart; catalog schema 17); RAWs first, 2–3 copies at once, **RAW only**. Measured no faster on the build machine (one shared disk); a real card is the test.
- **Zoom levels** (owner, 2026-10-19; 0.6.12; [PHASE3.md](PHASE3.md#zoom-levels-owner-2026-10-19)): Fit, 25 %, 50 %, 100 %, 200 %, 400 % and 800 % from a Zoom menu, = / − and Z, Ctrl/⌘ + wheel toward the pointer; above 100 % the photo's own pixels are enlarged without smoothing.
- **Hardening and cleanup** (owner, 2026-10-21; [PHASE3.md](PHASE3.md#hardening-and-cleanup-owner-2026-10-21)): no visible features apart from the graphics messages. Develop's own GPU engine now handles a lost device and the errors nothing else caught (out of memory, internal, validation): logged to Diagnostics, a plain message, a fresh engine and the photo drawn again, at most 3 times in 2 minutes, then a message with what to do and **Try again**; the full-size develop and export allocations are checked for out of memory. A speed check runs the GPU benchmark on every push to main and every pull request (warnings only). Each release is tagged, and the website can be rolled back to a tag from the Actions tab ([ROLLBACK.md](ROLLBACK.md)). These docs were brought up to date.

**Keyboard and display** (owner, after round 2; can land in any phase): remappable shortcuts with a Lightroom-compatible preset, UI scaling, every core action reachable by keyboard. **Built** in Phase 2 ([PHASE2.md, Part 12](PHASE2.md#part-12-keyboard-and-display-settings)): Settings with shortcut sets, the ? list, command search, slider keys, interface size and photo background.
**Later in Phase 3 or after:** read and write darktable XMP develop edits (R2 18), once more darktable tools exist in LightBench.

### Phase 4 — Local AI
Subject / sky / object / background masks, AI remove, AI denoise, assisted culling (eyes-open; sharpness, shake, exposure and look-alikes are built without AI, PHASE3.md Part 18), face grouping, content search. The first model is in: the AI Depth range mask (PHASE3.md Part 24, 0.6.13), with the delivery and runtime the others reuse.

**Order (owner, 2026-10-21; [ROADMAP.md](ROADMAP.md)):** hardening → **AI Remove** (Moebius) → **AI masks** (click/hover select, people/faces, sky, subject; in 1.0) → **AI Denoise** (RawNIND) → tool search → camera profiles → library gaps → 1.0. Hardware for 1.0: the owner's laptop only. Lightroom interop ships unverified, said plainly.

Model licenses checked individually: **permissive only** — code and weights must allow any use, including commercial (owner, 2026-10-11, re-confirmed after the AI research even though LightBench won't be sold, because the public website's users are bound by each model's licence and the GPL allows no extra restrictions). Non-commercial, research-only and field-of-use-restricted models (e.g. SAM 3) are excluded, also as optional downloads. **Training data** (owner, 2026-10-21, option B): mostly named; a small unpublished share or an unpublished foundation model is allowed when the model info says so in plain words; publishers that name no data only as exceptions the owner approves one at a time (so far RawNIND, Moebius and MediaPipe Selfie Multiclass). Details in [research/PHASE4_MODELS.md](research/PHASE4_MODELS.md#model-rule-relaxed-owner-2026-10-21).

**Models decided:** Depth Anything V2 Small (built); **Moebius** for AI Remove, downloaded in the app from Hugging Face at a pinned commit (about 1.24 GB; 2026-10-21, replacing the earlier GitHub Release plan); **RawNIND** for AI Denoise (GPL-3.0 exception); for the AI masks, SAM 2.1, BiRefNet_lite, SlimSAM-77, YuNet, RF-DETR-Seg, MediaPipe Selfie Multiclass, DA3-Metric-Large and EfficientViT-Seg are eligible, to be settled in that build ([research/AI_MODELS.md](research/AI_MODELS.md#owners-decisions-2026-10-21-ai-masks)).
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
  darktable 5.6 ships SAM 2.1 (Hiera small) and SegNext for masks (`data/ai_models.json`). Training data re-checked on
  2026-10-21 ([research/cowork-2026-10-21-ai-masks/AI_MASKS.md](research/cowork-2026-10-21-ai-masks/AI_MASKS.md)),
  after which the owner relaxed the rule and chose the AI masks order (above).

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
- **Speed:** agreed slider-to-preview time budgets, checked by an automated speed test before each release; published minimum browsers and GPUs. Budgets are confirmed on the owner's GPU before they are fixed. The measuring tool is System Check's GPU benchmark (PHASE3.md Part 16). _Built in the hardening build:_ the **Speed check** workflow runs the benchmark's Quick mode on GitHub's software GPU on every push to main and every pull request and compares it with a committed baseline, **warnings only** ([PHASE3.md](PHASE3.md#hardening-and-cleanup-owner-2026-10-21) says what it measures and can't catch). _Not yet:_ time budgets (they need the owner's GPU) and the published minimum browsers and GPUs.
- **Release notes in the app:** new features, bug fixes, and "what moved" notes when a control moves or is renamed.
- **Rollback:** the previous website version stays one click away. _Built in the hardening build:_ each deploy of main is tagged `v<version>`, and **Build and deploy site** → Run workflow → **Roll back the website** deploys a tag again ([ROLLBACK.md](ROLLBACK.md)). Installed apps offer the earlier version with Reload.
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
| Thumbnail speed and copy speed from the card | Shows whether reading only the preview bytes is urgent; also whether the parallel copies of Import speed (0.6.10) help on a real card |
| Backup copy to a second drive | Confirms the backup option on real hardware |
| The AI Depth model on the owner's GPU | Its real speed and look in the browser (the real model has only been checked in Node by the "AI models" Action on GitHub's servers) |

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
- Camera profiles: what v1 contains ([ROADMAP.md](ROADMAP.md#5-questions-for-the-owner), question 4; the owner asked what camera profiles are). Tool search naming was decided on 2026-10-21: other apps' names find LightBench's tools, and results show only LightBench's names.
