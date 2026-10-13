> **Provenance:** an independent research run done in Claude Cowork on 2026-10-13, written without seeing the drafts in `docs/research/`. It has not been re-verified, except where the spot-check log in [INDEX.md](INDEX.md) says so. The text below is copied unchanged.

# LightCraft: AI models, licences and runtime (notes for the Part 3 author)

Researched 2026-10-13 from `storytold/lightcraft`, branch `master`, workspace version 0.7.1 (`Cargo.toml`). The commit hash and date are not visible (the GitHub commits page is robots-blocked).

**Project licence:**
- "LightCraft is dual-licensed under MIT or Apache-2.0, at your option." (README)
- "crates/segment is licensed under the Apache License 2.0 only (LICENSE-APACHE), not under the MIT option." (NOTICE)
- Copyright line: "Copyright (c) 2026 ArtCraft Team and the LightCraft contributors" (LICENSE-MIT).

## Summary table

| Feature | Model | Weights licence (as LightCraft states it) | Runtime | Delivery | Status (their docs) |
|---|---|---|---|---|---|
| Object / "Describe" masks | **SAM 3** ("Segment Anything with Concepts, Meta 2025"); no size variants named | "Meta's SAM License … a separate, non-OSI licence" (NOTICE). ai-masks.md: "a custom licence that is not an OSI open-source licence." | `candle` 0.9.2 (pure Rust); "Metal on macOS, CPU elsewhere (for now)"; the web build renders stored masks but does not run the model | Not bundled: "The SAM 3 weights are not part of LightCraft and are never distributed with it." `facebook/sam3` on Hugging Face is gated, and the built-in mirror list is empty. In-app dialog: "about 3.4 GB" | parity.md 🟡; ROADMAP: "download not yet hosted" |
| Select Subject / Sky / Background | **No model**: "saliency heuristic, no segmentation model" / "heuristic" | n/a | classical | n/a | 🟡 |
| People parts, object detection for remove | none | — | — | — | ⬜ |
| AI denoise | **RawNIND UtNet2 (Bayer)**, version "1.0" | "GPL-3.0" (weights). Code doc: "Its weights are GPL-3.0; the training pictures are CC BY 4.0 and CC0." | Own pure-Rust ONNX reader and CPU executor (`lightcraft-denoise`, "pure-Rust CPU inference"; `faer` GEMM); GPU only "over TCP" on another machine; no `ort` | Opt-in Cargo feature `rawnind-model` ("Product-policy switch: absent by default"). Downloads `https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel` (57,700,134 bytes; entry `model_bayer.onnx`; tile 512, overlap 64) only "after the user accepts its terms". NOTICE: "Enabling that offer in releases remains a maintainer decision." | Inconsistent: README "🚧 (Bayer, user-installed weights)"; parity.md ⬜ "settings field reserved, not rendered"; ROADMAP "no AI denoise" |
| Content-aware / generative remove | **No model.** "heal with automatic source; no patch synthesis"; ROADMAP: "PatchMatch remove ⬜"; generative remove 🚫 out of scope | — | — | — | 🟡 / 🚫 |
| Lens blur / depth | **No model**; `LensBlur` settings struct only | — | — | — | ⬜ |
| Super resolution, Raw Details | none | — | — | — | ⬜ |

## Points for the Part 3 author

1. **SAM 3 is excluded by the LightBench owner.** LightCraft is the case in point: it ships SAM 3 support only as a user-downloaded, non-OSI-licensed model. It does not change the exclusion.
2. **RawNIND weights are GPL-3.0** according to LightCraft's own manifest. It points to darktable-ai's `release-5.6.0` asset `rawdenoise-nind.dtmodel`. This belongs in the brief's separate "GPL-3.0 weights" list. **[unconfirmed]** whether the darktable-ai licence files say the same; the darktable-ai repo itself was not read here.
3. ROADMAP: "No permissively licensed sky-segmentation or raw-denoise model was found," and the project "may need to train our own." This is a third party's search result, not proof that none exists.
4. **Delivery pattern worth noting:** weights are never bundled. There is a SHA-256-pinned download manifest, a licence-acceptance step before use, and a staging filename "while it waits for the user to accept its terms". This consent-gated approach fits LightBench's local-only rule.
5. **Runtime:** LightCraft avoids ONNX Runtime entirely. It uses its own Rust ONNX reader and CPU executor for denoise, and candle for SAM 3. Its web build is WebGL2 (eframe/glow), not WebGPU, and does not run either model (docs/web.md, docs/ai-masks.md). It offers no browser-inference precedent for LightBench.

## Sources
- README: https://raw.githubusercontent.com/storytold/lightcraft/master/README.md
- NOTICE: https://raw.githubusercontent.com/storytold/lightcraft/master/NOTICE
- LICENSE-MIT: https://raw.githubusercontent.com/storytold/lightcraft/master/LICENSE-MIT
- Cargo.toml: https://raw.githubusercontent.com/storytold/lightcraft/master/Cargo.toml
- docs/ai-masks.md: https://raw.githubusercontent.com/storytold/lightcraft/master/docs/ai-masks.md
- docs/parity.md: https://raw.githubusercontent.com/storytold/lightcraft/master/docs/parity.md
- ROADMAP.md: https://raw.githubusercontent.com/storytold/lightcraft/master/ROADMAP.md
- docs/web.md: https://raw.githubusercontent.com/storytold/lightcraft/master/docs/web.md
- crates/denoise/Cargo.toml: https://raw.githubusercontent.com/storytold/lightcraft/master/crates/denoise/Cargo.toml
- crates/denoise/src/lib.rs: https://raw.githubusercontent.com/storytold/lightcraft/master/crates/denoise/src/lib.rs
- crates/denoise-core/src/known.rs: https://raw.githubusercontent.com/storytold/lightcraft/master/crates/denoise-core/src/known.rs
- crates/develop/src/settings.rs: https://raw.githubusercontent.com/storytold/lightcraft/master/crates/develop/src/settings.rs
