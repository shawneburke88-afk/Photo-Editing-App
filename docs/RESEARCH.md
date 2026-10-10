# Research Summary — Lightroom-class Photo Editor

_Researched 2026-10-10. Some sources (Adobe help pages, MDN, caniuse, GitHub API) were
unreachable from the research environment, so several facts come from search snippets
or secondary sources. Items marked **(unverified)** must be checked before we rely on them._

---

## 1. Target: Lightroom feature inventory

Lightroom comes in two products:
- **Lightroom Classic (LrC)** — desktop, local catalog, the most complete feature set.
- **Lightroom (cloud)** — desktop/mobile/web, files stored in Adobe cloud, simpler library.

We treat **Lightroom Classic** as the primary parity target. Cloud-only features are noted.

### Import & file management
- Import from card / folder / drive; tethered capture (LrC).
- Copy, Copy as DNG, Move, Add (in place).
- Rename templates, second-copy backup on import, import presets.
- Apply metadata presets, keywords, develop presets on import.
- Duplicate detection (filename + capture time + size); cross-folder duplicate detection (LrC 15.4).
- Preview tiers: Minimal, Embedded/Sidecar, Standard, 1:1, Smart Previews (offline editing proxies).
- DNG conversion; "Render to DNG" (bakes edits, LrC 15.5).

### Library / catalog
- Single SQLite catalog (.lrcat); optional XMP sidecar writing.
- Folders, collections, smart collections, collection sets.
- Flags, 0–5 stars, color labels; keyword hierarchy; EXIF/IPTC editing; metadata presets.
- Library filter bar (text / attribute / metadata columns).
- Stacks, virtual copies, AI auto-stacking (LrC 15.0).
- Faces / People (AI). AI content search ("dog", "beach") — cloud Lightroom only.
- AI Assisted Culling (similarity, sharpness, eyes-open scoring).
- Map module (GPS, tracklogs), Compare and Survey views.

### Develop
- Basic tone, parametric + point curves, HSL/Color Mixer, Point Color, Color Grading.
- Detail (sharpen, NR), lens profiles + CA, Transform/Upright, Effects (vignette, grain,
  dehaze, texture, clarity), Calibration, crop/straighten, red-eye, Auto.
- Profiles: Adobe raw, camera matching, creative, Adaptive (AI).
- Enhance (AI): Denoise, Raw Details, Super Resolution.
- Masking: brush, linear, radial; color/luminance/depth range;
  AI Subject/Sky/Background/Objects/People (parts)/Landscape (sky, water, vegetation, …).
- Remove: heal, clone, Content-Aware Remove (AI, local), Generative Remove (cloud AI),
  Distraction Removal (people, reflections, dust).
- Lens Blur (AI depth). HDR / Panorama / HDR-Pano merge to DNG.
- HDR editing & HDR export (AVIF, JXL, gain-map JPEG).
- Presets (incl. Adaptive presets with Amount slider), history, snapshots, before/after,
  copy/paste/sync settings, soft proofing.

### Output
- Export: JPEG/TIFF/PSD/DNG/PNG/AVIF/JXL, resize, output sharpening, watermark,
  metadata filtering, export presets, post-processing actions.
- Edit in external editor. Print, Slideshow, Web, Book modules (LrC). Publish Services.

### Other
- Lua plugin SDK (LrC). Extensive keyboard workflow. GPU acceleration.

Sources: Adobe LrC release notes, LrC/Lr feature comparison, masking and remove-tool help
pages (see agent-cited URLs in git history / this doc's history).

---

## 2. Open-source building blocks

### Full applications (reference designs)

| Project | Stack | License | Status | Notes |
|---|---|---|---|---|
| darktable | C / GTK / OpenCL | GPL-3.0+ | Very active (5.6.2, Oct 2026) | Scene-referred pipeline, filmic/sigmoid/AgX, strong masks, XMP. Steep UX. |
| RawTherapee | C++ / GTKmm | GPL-3.0 | Active (5.13, Jul 2026) | Best-in-class demosaic, capture sharpening. No DAM. |
| ART | C++ | GPL-3.0 (unverified) | Monthly releases | Simplified RawTherapee. |
| digiKam | C++ / Qt6 | GPL-2.0+ (unverified) | Active (9.1) | Strong DAM, faces, metadata; basic raw editing. |
| vkdt | C / Vulkan | BSD-2 + some GPL-3 files | 1.0 (Dec 2025) | Full GPU node-graph pipeline. Expert UX. |
| RapidRAW | Tauri + Rust + React + wgpu | **AGPL-3.0** | Very active (~10k stars) | Closest modern analog. Local ONNX AI (SAM 2, LaMa, CLIP, Depth Anything). **No web version.** |
| Ansel, Filmulator, LightZone, PhotoFlow | various | GPL / BSD | low activity | Minor reference value. |

No browser/WASM port of darktable, RawTherapee or ART was found.

### Libraries

| Component | License | Browser (WASM) | Role |
|---|---|---|---|
| LibRaw | LGPL-2.1 **or** CDDL-1.0 | Yes (libraw-wasm builds) | RAW decoding |
| rawler (Rust) | LGPL-2.1 | Should compile; no published build found | RAW decoding (used by RapidRAW) |
| LittleCMS (lcms2) | MIT | Yes (compiles easily) | ICC color management |
| OpenColorIO | BSD-3 | Shader generation portable | Color pipelines / ACES |
| lensfun | LGPL-3 lib, **CC-BY-SA-3.0 database** | Possible | Lens correction |
| libvips | LGPL-2.1+ | Yes (wasm-vips) | Fast low-memory image ops / export |
| libheif | LGPL-3 (some codecs GPL) | Yes (libheif-js) | HEIF/AVIF |
| Exiv2 | **GPL-2.0+** | — | Metadata (license is restrictive) |
| ExifTool | Perl Artistic/GPL | Not practical | Metadata (server/CLI only) |

### AI models (run locally via ONNX Runtime)

| Model | License | Use |
|---|---|---|
| SAM 2 / MobileSAM | Apache-2.0 | Click-to-mask, subject masks |
| U²-Net | Apache-2.0 | Subject/background masks |
| LaMa | Apache-2.0 | Content-aware remove |
| NAFNet / Restormer | MIT | AI denoise |
| BRIA RMBG-2.0 | **Non-commercial** without paid license | Avoid |

### Ideas worth borrowing
- **Scene-referred pipeline** (darktable): linear float processing, exposure/WB early,
  single display transform (filmic/sigmoid/AgX) at the end.
- **Non-destructive edits** as an ordered parameter stack, stored in catalog + XMP sidecars.
- **Cached pixel pipe**: separate preview/full-res pipes, process only visible region.
- **GPU node graph** (vkdt): each module is a compute shader; data stays on the GPU.

### Licensing summary (not legal advice)
- Copying code from darktable/RawTherapee (GPL-3.0) → the whole app must be GPL-3.0,
  including the website bundle (shipping JS/WASM to browsers is widely regarded as distribution).
- Copying RapidRAW (AGPL-3.0) → whole app AGPL-3.0, network clause applies to the website.
- Reimplementing *algorithms* from papers/docs is generally fine; copying code is not.
- LGPL libraries (LibRaw, libvips, rawler): usable in any app if kept as replaceable
  modules and their own modifications are published. LibRaw's CDDL option avoids relinking issues.
- MIT/BSD/Apache components: attribution only.

---

## 3. Website vs desktop feasibility

### Hosting on GitHub Pages
- Static hosting only → all processing runs in the user's browser (photos never uploaded).
- GitHub Pages cannot set custom headers. WASM multithreading needs COOP/COEP headers;
  the `coi-serviceworker` workaround is used by an existing GitHub-Pages RAW viewer (pg0/raw-viewer).

### Browser capability snapshot

| Capability | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| WebGPU | Win/macOS/ChromeOS; Linux partial (v144+, GPU-dependent) | Windows (v141+), macOS (v145+); Linux in progress | 26+ only |
| Real folder access (read/write, persistent) | Yes (File System Access API) | No — read-only one-time import | No — read-only one-time import |
| Private browser storage (OPFS) | Yes | Yes | Yes |
| SQLite catalog in browser | Yes | Yes | Yes (16.4+) |
| Local AI (ONNX Runtime Web + WebGPU) | Yes | Partial | Partial |

**Practical upshot:** the full Lightroom-style "manage my photo folders in place" experience
in a browser works only in **Chrome/Edge**. Firefox/Safari users would import copies into
browser storage instead.

### What a browser cannot do well
- Tethered shooting (desktop only, realistically).
- Auto-detect card insertion / watch folders.
- Very large images/catalogs (WASM memory ~2–4 GB; iOS tighter).
- Write exports next to originals outside Chrome/Edge (falls back to downloads).

### Recommended architecture (draft — pending decisions)
1. **Core engine in Rust** (decode, GPU pipeline via wgpu/WGSL, edit model, catalog logic),
   compiled to WebAssembly for the website and natively for an optional desktop app.
2. **Shared TypeScript UI** (React or Svelte) used by both.
3. **Platform layer** with two implementations:
   - Web: File System Access API / OPFS, SQLite-WASM, ONNX Runtime Web.
   - Desktop (Tauri v2, optional later): native files, SQLite, native ONNX, tethering.

### Items to verify before committing
- rawler compiles and runs as wasm32.
- Safari Memory64 support.
- WebKitGTK WebGPU support (affects a Linux Tauri build).
- Licenses of specific libraw-wasm packages.
