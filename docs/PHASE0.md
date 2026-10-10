# Phase 0 — Foundations and Spikes

_2026-10-10. Built and tested in a cloud container. **Results from the owner's Windows PC are still
needed**. Run the System Check page on the live site and paste the report back._

## What was built

- **Site scaffolding:** Vite + React + TypeScript app in `web/`, published to GitHub Pages by
  `.github/workflows/deploy.yml` on every push to `main`.
- **System Check page:** four spikes the owner can run on their own computer, each with plain-language
  results and a copyable report.
- **Cross-origin isolation on GitHub Pages:** handled by `coi-serviceworker`. It was tested on a plain
  static server under the `/Photo-Editing-App/` sub-path, with no special headers, and the page reached
  `crossOriginIsolated = true`.

## Spike results

The test machine was a cloud container with **no graphics card** (Chromium's SwiftShader software
renderer) and 4 CPU threads. Its GPU timings are therefore far slower than on a real PC. They prove the
pipeline works and is correct, not how fast it is.

### A. RAW decoding in the browser: works

LibRaw 0.22.1 compiled to WebAssembly (`@colorhythm/libraw-wasm`) supports 1,274 cameras. Tested on
public-domain samples:

| File | Camera | Embedded preview | Full sensor decode |
|---|---|---|---|
| philadelphia.nef (15 MB) | Nikon D700, 12 MP | 2–5 ms | 1.1 s |
| 12bit-compressed.arw (25 MB) | Sony A6300, 24 MP | ~1 ms | 0.3 s |
| 14bit-uncompressed.arw (50 MB) | Sony A7 II, 24 MP | ~3 ms | 0.2 s |

- Embedded JPEG previews come out almost instantly. Import and library thumbnails can use them, the way
  Lightroom's "Embedded & Sidecar" previews do.
- The decoder `.wasm` is 853 KB (330 KB compressed). It is single-threaded, so it needs no special
  headers.
- **rawler (Rust) comparison:** it compiles to WebAssembly with some work but was not benchmarked; see the note at the end of this file.

### B. GPU develop pipeline (WebGPU): works, speed still to be measured on a real GPU

- Pipeline:
  1. Upload the sensor data.
  2. Bilinear demosaic, then white balance, highlight clip and the camera matrix to linear sRGB, all in a
     compute shader into an `rgba16float` image.
  3. On every slider change, redraw with exposure, contrast and saturation, a sigmoid display transform
     and the sRGB output curve.
- Colours match the camera's own JPEG preview on all three test files.
- Software-renderer timings: one-time GPU processing 1.5–5 s per photo, slider redraw about 16 ms. A real
  GPU should be much faster; the owner's report will show by how much.
- **Found:** some setups cannot draw WebGPU output straight to the screen. The test container cannot, for
  example. The renderer detects this and switches to a slower "compatibility mode" that copies frames
  through the CPU. The report shows which mode was used.
- The bilinear demosaic is spike quality. Phase 1 replaces it with darktable's RCD demosaic.

### C. Folder access: works (Chromium)

- Folder scan, reading RAW files from it, and the write test (create, read back, delete a temp file) all
  work.
- Headless testing used the browser's private storage in place of a real folder, because the native
  folder picker can't be automated. Checks still needed on the owner's PC:
  - real folder picking;
  - the "Reconnect" flow after a reload (persistent permission);
  - import speed on a real folder.

### D. Catalog database: works and is fast

SQLite 3.53.4 in OPFS (the `opfs-sahpool` backend), with a synthetic 50,000-photo library:

| Operation | Time |
|---|---|
| Insert 50,000 photos (+150,000 keyword links) | 1.8 s |
| Build indexes | 0.4 s |
| Grid page (newest 200) | 3 ms |
| Filter 4★+ & picked | 19 ms |
| Folder view | 2 ms |
| Keyword search | 2.5 ms |
| File-name text search | 11 ms |
| Folder tree with counts | 7 ms |
| Set rating on 500 photos | 54 ms |

The database file was 8.1 MB. Every query was well under the ~100 ms threshold at which a delay becomes
noticeable.

## Decisions

- **RAW decoder:** LibRaw (WebAssembly). It has the widest camera support and a mature codebase, and it
  already works.
- **Engine language:** TypeScript + WGSL for now instead of Rust (see [PLAN.md](PLAN.md#architecture)).
  This is an engineering choice and reduces no capability.
- **No darktable code is in Phase 0.** The demosaic and tone curve here are simplified placeholders,
  written from scratch. In Phase 1 the owner chose to replace them with code translated from darktable's
  modules (see [PLAN.md](PLAN.md)).

## Still open / to do in Phase 1

- Owner's report from Windows + Chrome/Edge (real GPU speed, real folders, persistent permission).
- Mip-mapped preview (zoomed-out views alias slightly with plain bilinear sampling).
- Non-Bayer sensors (Fujifilm X-Trans, Foveon) are detected and reported as "not supported yet".

## Note: rawler (Rust) as an alternative decoder

rawler 0.8 compiles to `wasm32-unknown-unknown`, but not out of the box. Two dependencies (`uuid` and
`getrandom`) needed their browser randomness features switched on. The unoptimised module came to
6.4 MB, against 0.85 MB for LibRaw. It was **not benchmarked**: running it needs `wasm-bindgen` glue
code, and LibRaw already covers the target cameras. rawler stays an option if a Rust core is introduced
later.
