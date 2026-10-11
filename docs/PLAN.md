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
- **Part 3, Export, XMP sidecars and JPEG editing:** next.

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
  5. You choose how to import: **Copy** to a destination, or **Add** photos in place.
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
  - LightBench's own edit settings and history go in a separate `lightbench:` namespace that other apps
    ignore.
  - Reading sidecars back recovers the edits if browser storage is cleared, or on another computer.
  - Existing sidecars written by other apps are preserved: LightBench updates only its own fields and the
    standard fields above.

### Phase 2 — Library depth
Collections, smart collections, collection sets, hierarchical keywords, EXIF/IPTC editing,
metadata presets, import presets, stacks, virtual copies, compare and survey views, presets,
copy/paste/sync settings across many photos, **Lightroom catalog/XMP import (ratings, keywords,
collections)**.

### Phase 3 — Editing depth
More darktable modules behind Lightroom-style controls (color balance rgb, filmic, denoise (profiled),
diffuse or sharpen, AMaZE and X-Trans demosaic). Tone curve (parametric + point, RGB), HSL / color mixer, point color, color grading, sharpening
and noise reduction, lens profile corrections (lensfun), chromatic aberration, transform/upright,
vignette and grain, dehaze, camera profiles, masking (brush, linear, radial, color/luminance range),
heal and clone, snapshots, soft proofing.

### Phase 4 — Local AI
Subject / sky / object / background masks (SAM 2 / MobileSAM), AI remove (LaMa),
AI denoise (NAFNet-class), assisted culling (sharpness, eyes-open), face grouping, content search.
Model licenses checked individually (avoid non-commercial weights).

### Phase 5 — Output and advanced
HDR and panorama merge, HDR editing and export (AVIF / JPEG XL / gain-map JPEG), map module,
print module, slideshow, web gallery, book module, plugin system.

### Phase 6 — Desktop app (Tauri)
Native file management, tethered capture, card auto-import, watched folders, larger memory,
faster native processing. Same UI and engine as the website.

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
