# Third-party software

LightBench is licensed under GPL-3.0-or-later (see [LICENSE](LICENSE)). It includes or uses the
following third-party components, each under its own license.

| Component | Used for | License |
|---|---|---|
| [darktable](https://github.com/darktable-org/darktable) (code translated to WGSL/TypeScript, from commit `6271f53`, Oct 2026) | RCD demosaic, inpaint-opposed highlight reconstruction, sigmoid tone mapping, tone equalizer, white balance (temperature/tint), CIE colour tables; Transform/Upright: the perspective model, line selection, outlier removal, fit and automatic crop of "rotate and perspective" (`src/iop/ashift.c` → `web/src/engine/develop/ashift.ts`) | GPL-3.0-or-later. Copyright © darktable developers. RCD by Luis Sanz Rodríguez. darktable credits ShiftN by Marcus Hebel as the inspiration of ashift. |
| [LSD — Line Segment Detector](http://dx.doi.org/10.5201/ipol.2012.gjmr-lsd) version 1.6, as included in darktable (`src/iop/ashift_lsd.c`, translated to TypeScript in `web/src/engine/develop/lsd.ts`) | Finding straight lines for Upright and Auto straighten | AGPL-3.0-or-later. Copyright © 2007-2011 Rafael Grompone von Gioi. GPL-3.0 section 13 allows combining it with GPL-3.0 code (as darktable does); the AGPL's own terms stay with this file, including its section 13 (users who interact with a modified version over a network must be offered its source). LightBench's source is public on GitHub (https://github.com/shawneburke88-afk/Photo-Editing-App), and the app links to it from Settings and System Check (owner's decision, 2026-10-12). |
| Nelder-Mead simplex by Michael F. Hutt, as included in darktable (`src/iop/ashift_nmsimplex.c`, translated to TypeScript in `web/src/engine/develop/nmsimplex.ts`) | Fitting Upright's perspective model and its automatic crop | MIT (text in the file's header). Copyright © 1997-2011 Michael F. Hutt; darktable's changes GPL-3.0-or-later. |
| [rawspeed](https://github.com/darktable-org/rawspeed) camera database (`data/cameras.xml`, converted to `web/src/engine/raw/camera-db.json` by `web/scripts/build-camera-db.mjs`) | Sensor white levels per camera, mode and ISO; the selection logic follows rawspeed's `Camera::getSensorInfo` | Data: CC-BY-SA 3.0 (the converted JSON stays under CC-BY-SA 3.0). Copyright © rawspeed and darktable contributors. |
| [jpegli](https://github.com/google/jpegli) (commit `031a007`), compiled to WebAssembly by `web/scripts/build-jpegli.sh` | JPEG export encoder | BSD-3-Clause plus Google's patent grant (`web/src/vendor/jpegli/LICENSE`, `PATENTS`). Copyright © the JPEG XL Project Authors. |
| [Highway](https://github.com/google/highway) (linked into the jpegli WebAssembly) | SIMD support for jpegli | Apache-2.0 or BSD-3-Clause, at the user's choice (`web/src/vendor/jpegli/LICENSE.highway`). |
| [LightCraft](https://github.com/storytold/lightcraft) (commit `701f78e`: `crates/geom/src/crop.rs` and `crop_drag.rs`, translated to TypeScript and modified in `web/src/engine/develop/crop.ts`; `crates/pipeline/src/upright.rs`, parts translated and modified in `web/src/engine/develop/upright.ts`; `crates/raw/src/preview.rs` `embedded_preview_color_space`, in `web/src/engine/meta/preview-space.ts`; `crates/meta/src/iptc.rs` `parse_iptc` and `container.rs` `photoshop_iptc`, in `web/src/engine/meta/iptc.ts`; the RAW+JPEG sidecar naming rule of `crates/engine/src/sidecar.rs`, in `web/src/sidecar/naming.ts`) | The crop model and the rules for dragging crop handles; Upright's guards against false corrections (reliability gates, level consensus, Auto's limits); the colour space of RAWs' embedded previews; reading IPTC-IIM from JPEGs; which twin owns `NAME.xmp` | MIT OR Apache-2.0, used here under the MIT License (text below). Copyright (c) 2026 ArtCraft Team and the LightCraft contributors. |
| [LibRaw](https://www.libraw.org/) 0.22.1 | Reading camera RAW files | LGPL-2.1 or CDDL-1.0 (shipped as a separate, replaceable `.wasm` file) |
| [@colorhythm/libraw-wasm](https://github.com/colorhythm/libraw-wasm) | WebAssembly build + bindings for LibRaw | MIT |
| [SQLite](https://sqlite.org/) / [@sqlite.org/sqlite-wasm](https://github.com/sqlite/sqlite-wasm) | Library catalog database | Public domain / Apache-2.0 |
| [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) 0.1.7 | No longer shipped. LightBench's own service worker (`web/src/pwa/sw.ts`) reproduces its COOP/COEP header logic for cross-origin isolation on GitHub Pages | MIT. Copyright © Guido Zuidhof and contributors. |
| [React](https://react.dev/) | User interface | MIT |
| [Vite](https://vite.dev/), [TypeScript](https://www.typescriptlang.org/), [oxlint](https://oxc.rs/) | Build tools (not shipped) | MIT / Apache-2.0 / MIT |

Test photos used during development come from
[immich-app/test-assets](https://github.com/immich-app/test-assets) (public domain) and are not included
in this repository.

## LightCraft licence (MIT)

`web/src/engine/develop/crop.ts` (and its tests in `crop.test.ts`) is a translation of LightCraft's crop model,
modified by the LightBench contributors (2026); the file's header lists the changes. Parts of
`web/src/engine/develop/upright.ts` (the vanishing-point helpers, `reliable`, `level_angle` and the Auto policy of
LightCraft's `crates/pipeline/src/upright.rs`) are translated and modified the same way; that file's header says how.
`web/src/engine/meta/preview-space.ts` (preview colour space) and `web/src/engine/meta/iptc.ts` (IPTC-IIM, extended to
more datasets), with parts of their tests, are translations of LightCraft code modified by the LightBench contributors
(2026), and `web/src/sidecar/naming.ts` follows LightCraft's naming rule for RAW+JPEG sidecars. LightCraft offers its
code under the MIT License or the Apache License 2.0; LightBench uses it under the MIT License:

```
MIT License

Copyright (c) 2026 ArtCraft Team and the LightCraft contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
