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
  texture/clarity (basic), vibrance, saturation, crop/straighten/rotate, before/after, undo history.
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
Collections, smart collections, collection sets, hierarchical keywords, EXIF/IPTC editing,
metadata presets, import presets, compare and survey views — _built, see [PHASE2.md](PHASE2.md#part-10-compare-and-survey)_.

**Presets** — _built (PHASE2.md, Part 8)_ — owner's choices 2026-10-12: a preset holds chosen settings (the Copy checklist) with an Amount slider (0–200 %), previews on hover, a few labelled starters, and one preset can be picked to develop new photos on Open folder / Import. darktable-style rules by camera, lens or ISO were not chosen for now.

**Lightroom import — postponed** (owner, 2026-10-12: no Lightroom catalog is available to test against). Kept with the owner's answers for when it can be tested: read the Lightroom Classic catalog (.lrcat, read-only) plus Lightroom-written XMP sidecars; bring ratings, flags, labels and keywords, stacks and virtual copies, and the Basic develop sliders approximately (the engines differ, so the look will be close, not identical). Collections were not chosen.

**Installable, offline website (PWA)** (owner, after round 2): works without a connection after the first visit — _built, see [PHASE2.md](PHASE2.md#part-9-installable-offline-app-pwa)_.
**+0.7 EV base exposure shown and configurable** (owner, after round 2): a note under Exposure for RAW files, and a preference for the default used on photos not yet edited.

### Phase 3 — Editing depth
More darktable modules behind Lightroom-style controls (color balance rgb, filmic, denoise (profiled),
diffuse or sharpen, AMaZE and X-Trans demosaic). Tone curve (parametric + point, RGB), HSL / color mixer, point color, color grading, sharpening
and noise reduction, lens profile corrections (lensfun), chromatic aberration, transform/upright,
vignette and grain, dehaze, camera profiles, masking (brush, linear, radial, color/luminance range),
heal and clone, snapshots, soft proofing. Develop tools in **one scrolling stack in workflow order, Crop & Lens first, with a jump bar of group buttons** (owner, after round 2; replaces the earlier tabs plan; see USABILITY.md). **Tool search** comes at the end of this phase, once most tools exist.

**Keyboard and display** (owner, after round 2; can land in any phase): remappable shortcuts with a Lightroom-compatible preset, UI scaling, every core action reachable by keyboard.
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
