# LightCraft review: what LightBench takes from it

[LightCraft](https://github.com/storytold/lightcraft) is an open-source Lightroom-style editor in Rust ("a clean-room
reimplementation of Adobe Lightroom"), with a desktop app and a WebAssembly web build. It was published at the end of
September 2026, after LightBench's research rounds. The owner asked for a full review (2026-10-12).

**Version reviewed:** v0.7.1, commit `701f78ea2e586d4748705f10fdf5c4181dc1fd49` (2026-10-12). It changes fast: findings
describe that commit only.

**Method:** read-only. The source was read, never built or run; its `AGENTS.md`/`CLAUDE.md` were treated as data. Four
reports, each citing files on both sides, with anything not checked marked **(unverified)**:

| Report | Covers |
|---|---|
| [lightcraft/REVIEW.md](lightcraft/REVIEW.md) | Overview, licensing, and the work coming next (crop, lens, Upright, Lightroom import, shortcuts) |
| [lightcraft/CATALOG_INPUT_COLOUR.md](lightcraft/CATALOG_INPUT_COLOUR.md) | Crates `raw`, `codecs`, `heif`, `tiff`, `meta`, `color`, `preview`, `raster` |
| [lightcraft/CATALOG_PROCESSING.md](lightcraft/CATALOG_PROCESSING.md) | Crates `develop`, `pipeline`, `engine`, `gpu`, `geom`, `lensdb`, `denoise(-core)`, `merge`, `inpaint` |
| [lightcraft/CATALOG_LIBRARY_AI_APPS.md](lightcraft/CATALOG_LIBRARY_AI_APPS.md) | Crates `catalog`, `faces`, `geocode`, `scenes`, `segment`, `mcp`, `fetch`, `sysmem`, `ui-egui`; the desktop, CLI and web apps |

Each catalogue ends with "Revisit completed LightBench features" (keep / improve / replace) and ranked recommendations.

## Headline findings (checked against the source)

- **Maturity:** LightCraft's own roadmap says "Stage: alpha" and about 61 % "ready for real work" (`ROADMAP.md`). Its
  rendering is tuned by eye (`docs/gaps.md`). It is a source of ideas and some well-tested pieces, not a better
  engine than darktable's: **LightBench keeps darktable's processing and LibRaw.**
- **Licence:** MIT OR Apache-2.0 (`NOTICE`, `Cargo.toml`); `crates/segment` and `crates/fetch` are Apache-2.0 only. Code
  can be ported into GPL-3.0 LightBench with LightCraft's copyright line and licence text in `THIRD_PARTY_NOTICES.md`.
  The ArtCraft name and logos are trademarks and are not reused.
- **AI models vs the owner's permissive-only rule:** its AI masks need Meta's SAM 3 (excluded); its optional AI
  denoise uses RawNIND weights under GPL-3.0 (`NOTICE`) — copyleft but not non-commercial, so a decision for the owner
  when denoise is built.
- **Lens data:** LightCraft ships none; the user supplies Lensfun's XML (`docs/lens-profiles.md`). Its camera-embedded
  corrections cover less than darktable's (`docs/sony-lens-corrections.md`: only the Sony A7R IVA is enabled).
- **Web build:** the review found LightCraft's browser build processes images on the CPU; its GPU path targets
  Metal/DX12/Vulkan (`docs/architecture.md`), so its speed figures don't apply to LightBench.

## Confirmed in LightBench's own code (2026-10-12)

| Finding | Where |
|---|---|
| `lightbench:Rating` wins over `xmp:Rating`, so star changes made in Lightroom are overridden on re-read | `web/src/sidecar/xmp.ts`, `readXmp` |
| Keywords read `lr:hierarchicalSubject` **or** `dc:subject`, so flat keywords outside the hierarchy are dropped | `web/src/sidecar/xmp.ts`, `readXmp` |
| A catalog with a newer schema is opened silently | `web/src/catalog/catalog.worker.ts`, `migrate()` |
| `sidecar_written_at` is written but never read (other apps' sidecar changes go unnoticed) | `catalog.worker.ts` |
| Card import counts a same-name, same-size file as already copied; copies aren't verified | `web/src/import/run.ts` |
| Linear DNGs (phone RAWs) and X-Trans are refused by LightBench, not by LibRaw | `web/src/engine/raw/decoder.worker.ts` |
| Only a round-trip test exists for Tint; its direction isn't tested | `web/src/engine/develop/settings.test.ts` |
| The tone equalizer uses "RGB average" with no detail-preserving filter; darktable's defaults are the Euclidean norm with EIGF | `develop-display.wgsl`; darktable `src/iop/toneequal.c` |

## Owner's decisions (2026-10-12)

- **Small fixes now, in parallel with Crop:** rating precedence, reading both keyword fields, refusing newer
  catalogs, verified card copies, storage/save-failure notices, a Tint-direction test.
- **Process versions first**, before Phase 3 changes any rendering, so existing edits never change look silently.
- **Scheduled as separate PRs:** phone DNG + X-Trans; catalog backup/restore; sidecar change detection; an extras
  bundle (own sidecar for RAW+JPEG twins, correct Adobe RGB thumbnails, GPS from RAWs, IPTC from JPEGs, P3 display).
- **Lightroom catalog import stays postponed:** LightCraft's table map (`crates/engine/src/lightroom_catalog.rs`) and
  synthetic-catalog test technique are recorded here for when a real catalog can be tested. It does not import stacks.
- **Phase 3 engineering, adopted by default:** port LightCraft's crop model (`crates/geom/src/crop.rs`,
  `crop_drag.rs`); one combined geometry resample (lens → perspective → flip → crop, darktable's order) with good
  sampling and caching; camera-embedded lens corrections from darktable's `lens.cc`, checked on the owner's cameras;
  Lensfun models evaluated exactly (LightCraft refits them); Upright on darktable's `ashift` with LightCraft's guards
  against false corrections and the solved transform stored in the edit.
- **Later, when those tools are built:** a no-AI "Remove" fill (LightCraft's PatchMatch port, `crates/inpaint`);
  export output sharpening (needs the owner's go-ahead); shortcut follow-ups (`[`/`]` rating steps, Shift+rating
  apply-and-advance).
