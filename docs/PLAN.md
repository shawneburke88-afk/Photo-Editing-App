# Project Plan — Lightroom-class Photo Editor

_Status: draft, 2026-10-10. Based on [RESEARCH.md](RESEARCH.md) and the owner's answers below._

## Decisions made

| Topic | Decision |
|---|---|
| License | **GPL-3.0-or-later**. We may port code and algorithms from darktable / RawTherapee (with attribution). |
| Platform | **Website first** (GitHub Pages, everything runs in the browser), **desktop app later** from the same code. |
| Primary test target | **Windows + Chrome / Edge**. Firefox and Safari supported with reduced file management. |
| First milestone | **Thin end-to-end slice**: import → library → basic edits → export. Then deepen each area. |
| Edit model | **Lightroom-style controls on a darktable-style engine** (scene-referred, linear float). Advanced controls in expandable sections. |
| AI | **Local only**: open models running on the user's GPU in the browser. No cloud services. |
| Lightroom migration | Import **ratings, flags, color labels, keywords, collections**. Edits are not migrated. |
| Roles | Claude writes the code; the owner tests each stage on the live site and gives feedback. |

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

## Proposed architecture

```
┌────────────────────────── Browser (GitHub Pages) ──────────────────────────┐
│  UI: TypeScript + React  (Library · Develop · Export · Import dialogs)     │
│        │                                                                   │
│  Platform layer (web impl now, Tauri desktop impl later)                   │
│   • Files: File System Access API (Chrome/Edge) / OPFS fallback            │
│   • Catalog: SQLite-WASM stored in OPFS                                    │
│   • AI: ONNX Runtime Web (WebGPU)                                          │
│        │                                                                   │
│  Core engine: Rust → WebAssembly, in Web Workers                           │
│   • RAW decode (LibRaw-wasm or rawler — decided by spike)                  │
│   • Pipeline: wgpu / WGSL compute shaders, rgba16float, WebGL2 fallback    │
│   • Color: scene-referred linear → sigmoid/AgX display transform, lcms2    │
│   • Edit model, presets, XMP read/write, metadata                          │
└────────────────────────────────────────────────────────────────────────────┘
```

The same Rust core and React UI are later packaged with **Tauri** for a desktop app, which adds
native file access, tethering, card auto-import and native GPU performance.

## Roadmap

Lightroom Classic is the product of a large team over many years. Full parity is a long-term goal;
each phase below delivers usable software on the live site.

### Phase 0 — Foundations and spikes
- Repo scaffolding, build tooling, GitHub Actions → GitHub Pages deploy, `coi-serviceworker`.
- **Spike A:** RAW decode in browser — LibRaw-wasm vs rawler-wasm: camera coverage, speed, size.
- **Spike B:** WebGPU pipeline on a 24–60 MP image — interactive slider speed on Chrome/Edge.
- **Spike C:** File System Access API — pick a folder, persist permission, read/write sidecars.
- **Spike D:** SQLite-WASM catalog in OPFS — 50k-photo synthetic catalog query speed.

### Phase 1 — Thin end-to-end slice (first usable version)
- **Import:** pick a card or folder; Add-in-place or Copy to a destination; date-based folders;
  rename template; duplicate detection; thumbnails from embedded previews.
- **Library:** grid and loupe views, flags (P/X/U), stars (0–5), color labels (6–9),
  basic filter bar, folder tree, keyboard navigation.
- **Develop (basic):** white balance, exposure, contrast, highlights, shadows, whites, blacks,
  texture/clarity (basic), vibrance, saturation, crop/straighten/rotate, before/after, undo history.
- **Export:** JPEG / PNG / TIFF, resize, quality, filename template, metadata include/exclude.
- **Sidecars:** write edits and ratings to XMP so nothing is locked into our catalog.

### Phase 2 — Library depth
Collections, smart collections, collection sets, hierarchical keywords, EXIF/IPTC editing,
metadata presets, import presets, stacks, virtual copies, compare and survey views, presets,
copy/paste/sync settings across many photos, **Lightroom catalog/XMP import (ratings, keywords,
collections)**.

### Phase 3 — Editing depth
Tone curve (parametric + point, RGB), HSL / color mixer, point color, color grading, sharpening
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
- Repo visibility: GitHub Pages on a free account requires a **public** repo (also expected for GPL).
- App name.
- Cameras / RAW formats the owner shoots (determines which decoder must be tested first).
