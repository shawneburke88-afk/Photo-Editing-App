# Third-party software

LightBench is licensed under GPL-3.0-or-later (see [LICENSE](LICENSE)). It includes or uses the
following third-party components, each under its own license.

| Component | Used for | License |
|---|---|---|
| [darktable](https://github.com/darktable-org/darktable) (code translated to WGSL/TypeScript, from commit `6271f53`, Oct 2026) | RCD demosaic, inpaint-opposed highlight reconstruction, sigmoid tone mapping, tone equalizer, white balance (temperature/tint), CIE colour tables | GPL-3.0-or-later. Copyright © darktable developers. RCD by Luis Sanz Rodríguez. |
| [rawspeed](https://github.com/darktable-org/rawspeed) camera database (`data/cameras.xml`, converted to `web/src/engine/raw/camera-db.json` by `web/scripts/build-camera-db.mjs`) | Sensor white levels per camera, mode and ISO; the selection logic follows rawspeed's `Camera::getSensorInfo` | Data: CC-BY-SA 3.0 (the converted JSON stays under CC-BY-SA 3.0). Copyright © rawspeed and darktable contributors. |
| [LibRaw](https://www.libraw.org/) 0.22.1 | Reading camera RAW files | LGPL-2.1 or CDDL-1.0 (shipped as a separate, replaceable `.wasm` file) |
| [@colorhythm/libraw-wasm](https://github.com/colorhythm/libraw-wasm) | WebAssembly build + bindings for LibRaw | MIT |
| [SQLite](https://sqlite.org/) / [@sqlite.org/sqlite-wasm](https://github.com/sqlite/sqlite-wasm) | Library catalog database | Public domain / Apache-2.0 |
| [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) | Cross-origin isolation on GitHub Pages | MIT |
| [React](https://react.dev/) | User interface | MIT |
| [Vite](https://vite.dev/), [TypeScript](https://www.typescriptlang.org/), [oxlint](https://oxc.rs/) | Build tools (not shipped) | MIT / Apache-2.0 / MIT |

Test photos used during development come from
[immich-app/test-assets](https://github.com/immich-app/test-assets) (public domain) and are not included
in this repository.
