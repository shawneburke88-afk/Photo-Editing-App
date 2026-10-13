> **Provenance:** an independent research run done in Claude Cowork on 2026-10-13, written without seeing the drafts in `docs/research/`. It has not been re-verified, except where the spot-check log below says so. The text below is copied unchanged.

# LightBench research: 2026-10-13 (index)

Four documents, one per part of the brief, plus LightCraft notes. Each document has its own "Decisions this changes" box, quotes, [unconfirmed] labels, open questions and sources. None of this research opened the earlier drafts, as the owner asked.

| File | Part |
|---|---|
| `TONE_CURVE.md` | 1: Tone curve workflow (now includes LightCraft) |
| `DETAIL_DENOISE_SHARPEN.md` | 2: Sharpening and noise reduction |
| `PHASE4_MODELS.md` | 3: AI models for Phase 4, model delivery, WebGPU limits, patents |
| `DEPTH_OF_FIELD.md` | 4: AI depth of field with depth grading |
| `LIGHTCRAFT_AI_NOTES.md` | Supporting notes: LightCraft's AI models and licences |

## Decisions this changes (combined)

| Owner decision | Verdict | Where |
|---|---|---|
| Tone curve after Contrast (sigmoid) | **Supports** (darktable's tone curve, ART and LightCraft all apply theirs after the tone map). Caveat: darktable's manual recommends doing most work before the display transform. | Part 1 |
| Parametric kept as "Regions" | **Supports** | Part 1 |
| Stronger colour with contrast, plus a "Saturation" slider | **Behaviour supported; name is Mixed.** "Saturation" collides with Lightroom's main slider; consider "Curve Saturation" / "Refine Saturation". A hue-preserving ("film-like") curve is suggested as the default colour model. | Part 1 |
| R/G/B curves in | **Supports** | Part 1 |
| Richardson–Lucy-style capture sharpening | **Supports** (darktable 5.4.0 added capture sharpening in demosaic, credited to RawTherapee's algorithm) | Part 2 |
| …applied after profiled denoise | **Mixed.** darktable and RawTherapee sharpen *before* their main denoise, with a noise mask. darktable's manual nonetheless says denoise should come before sharpening. | Part 2 |
| On by default for new RAWs, Amount 40 | **Mixed.** Lightroom's raw default is 40, but darktable leaves capture sharpening off by default and calls auto-apply safe only below ISO 1000. | Part 2 |
| RawNIND undecided (GPL) | **Mixed, new fact.** Upstream: "The weights are dual licensed GPL3 + CC-BY-4.0". Ask the author whether CC-BY-4.0 alone may be used. | Parts 2 & 3 |
| MI-GAN (fill/Remove) | **Supports.** Code and weights are both MIT. Training-data caveat. | Part 3 |
| LaMa optional | **Mixed.** Code is Apache-2.0, but upstream gives no separate weights licence. 208 MB ONNX at a fixed 512 px. Moebius (Apache-2.0) is a rival for the optional slot. | Part 3 |
| SAM 2.1 Tiny | **Supports.** Apache-2.0 checkpoints, 38.9M parameters. SA-1B training-data caveat. | Part 3 |
| BiRefNet | **Mixed.** The MIT licence passes, but the full model is about 490 MB fp16 and needs ONNX fixes for WebGPU. **BiRefNet_lite** is the realistic browser pick. | Part 3 |
| No-AI Remove avoids PatchMatch random search and propagation | **Supports, with a wording fact.** Claim 1 of US 8,285,055 (Active, anticipated expiry 2031-04-09) says "perturbing", not "random". Avoid any perturb-plus-propagate scheme, not just randomness. Related patent US 8,811,749 runs to 2029. | Part 3 |
| Depth Anything V2 Small | **Supports.** Apache-2.0; Base/Large are CC-BY-NC. Relative inverse depth is enough for two-sided blur, so no metric depth is needed. Depth Anything 3 Small/Base/Mono-Large (Apache-2.0) and MoGe-2 (MIT) are worth evaluating. | Part 4 |

## Spot-check log (main session, 2026-10-13)

These decision-critical quotes were re-fetched independently from the primary source and matched:

- RawNIND README: "The weights are dual licensed GPL3 + CC-BY-4.0" (github.com/trougnouf/rawnind_jddc). **Confirmed.**
- MI-GAN `LICENSE-WEIGHTS` is the MIT License, "Copyright (c) 2024 Picsart AI Research (PAIR)". **Confirmed.**
- SAM 2: "The SAM 2 model checkpoints, SAM 2 demo code (front-end and back-end), and SAM 2 training code are licensed under Apache 2.0"; sam2.1_hiera_tiny is 38.9M parameters. **Confirmed.**
- US 8,285,055 (Google Patents): Adobe Inc., Active, anticipated expiration 2031-04-09 (Google flags both as assumptions). Claim 1 includes "a third mapping obtained by perturbing the second mapping". "Random" appears in claims 4, 11, 12 and 20, not in claim 1. **Confirmed.**
- darktable 5.4.0 release post: "A new section Capture Sharpening is added into the demosaic module." **Confirmed.** The release post itself does not credit RawTherapee. The credit is in the source header (`src/iop/demosaicing/capture.c`): "Credits go to: Ingo Weyrich … he implemented the original algorithm for rawtherapee." **Confirmed.**
- **Wording caution:** darktable's capture.c never names Richardson–Lucy. Its loop (blur → divide → blur → multiply) is *structurally* RL-like, with Gaussian kernels and no measured PSF. Treat "is a Richardson–Lucy loop" in Part 2 as a description, not darktable's own claim.

Not spot-checked here: the remaining quotes. Each file marks what its author could not verify.

## Environment notes

- `gh api` was blocked in this environment, so GitHub source was read through web pages. Some pages were robots-blocked or truncated; each file says where.
- Quotes pass through a page-to-text tool that cuts them at about 125 characters, so some appear as marked fragments.
