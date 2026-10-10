# Third-party software

LightBench is licensed under GPL-3.0-or-later (see [LICENSE](LICENSE)). It includes or uses the
following third-party components, each under its own license.

| Component | Used for | License |
|---|---|---|
| [LibRaw](https://www.libraw.org/) 0.22.1 | Reading camera RAW files | LGPL-2.1 or CDDL-1.0 (shipped as a separate, replaceable `.wasm` file) |
| [@colorhythm/libraw-wasm](https://github.com/colorhythm/libraw-wasm) | WebAssembly build + bindings for LibRaw | MIT |
| [SQLite](https://sqlite.org/) / [@sqlite.org/sqlite-wasm](https://github.com/sqlite/sqlite-wasm) | Library catalog database | Public domain / Apache-2.0 |
| [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) | Cross-origin isolation on GitHub Pages | MIT |
| [React](https://react.dev/) | User interface | MIT |
| [Vite](https://vite.dev/), [TypeScript](https://www.typescriptlang.org/), [oxlint](https://oxc.rs/) | Build tools (not shipped) | MIT / Apache-2.0 / MIT |

Test photos used during development come from
[immich-app/test-assets](https://github.com/immich-app/test-assets) (public domain) and are not included
in this repository.
