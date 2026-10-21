# Phase 4 models: clipped-area fill, depth of field, masks, AI Remove, denoise

**Prepared for:** Shawn Burke (LightBench) · **Research date:** 2026-10-13 · **Follows:**
[AI_MODELS.md](AI_MODELS.md) (2026-10-11), which covers masks, selection and AI Auto in depth. This document adds the
owner's 2026-10-12 requests and re-checks the masking licences.

**The owner's rules for AI models** (PLAN.md, Phase 4):
- **Permissive licences only.** Code and weights must allow any use, including commercial. No non-commercial,
  research-only or use-restricted ("responsible AI") licences. No SAM 3, also not as an optional download.
- **Everything runs locally**, on the user's GPU, in the browser.
- **Nothing made up.** "(unverified)" marks anything not read at its primary source, and "(estimate)" marks numbers that
  weren't measured.
- This is not legal advice. Where a licence or patent question is open, the facts are listed and the decision is the
  owner's.

**Contents:**
- [Summary](#summary)
- [How this was researched](#how-this-was-researched)
- [Licence notes that apply throughout](#licence-notes-that-apply-throughout)
- [Inpainting candidates (sections 1 and 4)](#inpainting-candidates-shared-by-sections-1-and-4)
- [1. Clipped highlight/shadow fill](#1-clipped-highlight-and-shadow-fill)
- [2. AI depth of field](#2-ai-depth-of-field)
- [3. Masking](#3-masking-subject-sky-background-people)
- [4. AI Remove](#4-ai-remove-generative-fill-for-the-remove-brush)
- [5. AI denoise](#5-ai-denoise)
- [Model delivery](#model-delivery)
- [WebGPU limits](#webgpu-limits-for-in-browser-inference)
- [Excluded and why](#excluded-and-why)
- [Open questions for the owner](#open-questions-for-the-owner)

---

## Summary

| Feature | Recommended pick | Licence evidence | Size | Why |
|---|---|---|---|---|
| **1. Clipped highlight/shadow fill** | **MI-GAN 512 (Places2)** by default; **LaMa (big-lama)** as an optional higher-quality download | MI-GAN `LICENSE-WEIGHTS`: "MIT License … Copyright (c) 2024 Picsart AI Research (PAIR)" ([file](https://github.com/Picsart-AI-Research/MI-GAN/blob/main/LICENSE-WEIGHTS)). LaMa `LICENSE`: Apache-2.0, "Copyright [2021] Samsung Research" ([file](https://github.com/advimman/lama/blob/main/LICENSE)) | MI-GAN: 5.89 M params (counted from its code), ≈ 24 MB fp32 / ≈ 12 MB fp16 (estimate). LaMa: 208,044,816-byte fp32 ONNX (search result), ≈ 52 M params (estimate) | The only inpainting weights found with an **explicit** permissive weights licence that are small enough for any GPU and already run in a browser (inpaint-web: ONNX Runtime Web + WebGPU). It is used only where no data is left; recovery stays darktable's. See §1 for the "recover first" design |
| **2. AI depth of field** | **Depth Anything V2 Small** (confirmed) + layered, scene-linear bokeh rendering | "Depth-Anything-V2-Small model is under the Apache-2.0 license. Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license." ([README](https://github.com/DepthAnything/Depth-Anything-V2#license)) | 24.8 M params (README); fp16 ≈ 50 MB (estimate) | Relative depth is mathematically enough for depth grading (blur ∝ \|disparity − focus disparity\|). Full write-up: **[DEPTH_OF_FIELD.md](DEPTH_OF_FIELD.md)** |
| **3. Masks** (subject, sky, background, people) | Unchanged from AI_MODELS.md: **SAM 2.1 Tiny** (click/hover), **BiRefNet-lite** (subject), **MediaPipe Selfie Multiclass** (people parts), sky by rule + DA2 depth; **ProRAW mattes** when present | SAM 2: "The SAM 2 model checkpoints … are licensed under Apache 2.0" ([README](https://github.com/facebookresearch/sam2#license)). BiRefNet: MIT ([LICENSE](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE)). Selfie Multiclass: Apache 2.0 model card (AI_MODELS.md) | see §3 | Re-checked; nothing changed. RMBG (BRIA) confirmed excluded; EdgeSAM confirmed excluded |
| **4. AI Remove** | Same models as §1: **MI-GAN** default, **LaMa** optional. **Moebius** (0.22 B diffusion) is a possible later "best quality" option | Moebius: "Both the code and the pretrained model weights of Moebius are released under the Apache License 2.0 … Commercial use of the weights and the images produced with them is permitted." ([README](https://github.com/hustvl/Moebius)) | Moebius ONNX ≈ 1.24–1.27 GB fp32 (moebius-web) | Object removal needs better structure than filling a blown sky, so LaMa matters more here. Moebius is a single 1.27 GB download and ~20 diffusion steps with guidance; licence caveats in §4 |
| **5. AI denoise** | Owner's call: **NAFNet (SIDD)**, MIT; or darktable-ai's **NIND / RawNIND** models, **GPL-3.0 weights** | NAFNet LICENSE: MIT ([file](https://github.com/megvii-research/NAFNet/blob/main/LICENSE)). darktable-ai cards: NIND "License: GPL-3.0"; RawNIND "License: GPL-3.0" | 108.4 MB (NAFNet), 55.0 / 57.7 MB packages (NIND / RawNIND), darktable-ai | RawNIND works on raw data, which fits LightBench's RAW pipeline. GPL-3.0 weights are copyleft, not non-commercial. Whether they are acceptable is the owner's decision (§5) |

**Biggest open points:**
- **Training data.** Every inpainting model found trains on Places2, CelebA-HQ and/or FFHQ. Places' image terms couldn't
  be read; FFHQ is non-commercial. The owner needs a policy, as with SA-1B for SAM 2.1.
- **Delivery.** GitHub Pages' soft bandwidth limit of 100 GB/month is small for model files. GitHub Releases assets sent
  no CORS headers in a test. A pinned Hugging Face repo works from browsers (other apps do it) but has rate limits.
- **Patents.** No patent was found for LaMa or MI-GAN (searches not conclusive). Picsart holds an inpainting patent whose relation to MI-GAN is unknown. Apple holds
  shallow-depth-of-field rendering patents (claims not read).

## Independent check (Cowork, 2026-10-13)

An independent research run in Claude Cowork, written without seeing this draft:
[cowork-2026-10-13/PHASE4_MODELS.md](cowork-2026-10-13/PHASE4_MODELS.md), with its LightCraft notes in
[LIGHTCRAFT_AI_NOTES.md](cowork-2026-10-13/LIGHTCRAFT_AI_NOTES.md). Its claims were not re-checked here, except the items
in its [spot-check log](cowork-2026-10-13/INDEX.md): RawNIND's README, MI-GAN's `LICENSE-WEIGHTS`, SAM 2's licence and
Tiny's size, and US 8,285,055.

**Its verdicts on the owner's decisions** (from its "Decisions this changes" table):

| Owner's decision | Cowork verdict |
|---|---|
| MI-GAN for fill and Remove | **Supports**, with caveats. Code and weights are both MIT (separate `LICENSE-WEIGHTS`); 5.98 M params; official 28.1 MB ONNX pipeline; a GPL-3.0 browser app runs it. Caveats: training data (Places365; FFHQ is BY-NC-SA) and NVIDIA-notice files in the training code, which ONNX inference doesn't need. |
| LaMa optional | **Mixed.** Apache-2.0 code, but no separate weights licence upstream. Its ONNX is 208 MB fp32 at a fixed 512×512, about 8× MI-GAN's FLOPs. Moebius (Apache-2.0 code and weights, June 2026) is a rival for the optional slot. |
| SAM 2.1 Tiny | **Supports**, with a training-data caveat: Apache-2.0 checkpoints, 38.9 M params, but the training mix includes SA-1B ("Research purposes only"). |
| BiRefNet | **Mixed.** The MIT licence passes, but the full model is "0.2B params" (490 MB fp16) and needs ONNX graph surgery for WebGPU; **BiRefNet_lite** (44.4 M, 115 MB fp16) is the realistic browser pick. |
| RawNIND undecided (GPL) | **Mixed, new fact:** upstream says "The weights are dual licensed GPL3 + CC-BY-4.0"; darktable-ai's card and LightCraft's manifest say GPL-3.0. Ask the author whether CC-BY-4.0 alone may be chosen. |
| No-AI Remove avoids PatchMatch random search and propagation | **Supports, with a wording fact.** US 8,285,055 is listed Active, anticipated expiry 2031-04-09. Its claim 1 recites a mapping "obtained from mappings of nearby pixels" **and** one "obtained by perturbing" a mapping; "random" is only in dependent claims. Continuation US 8,811,749 (Active, to 2029-04-27) recites "propagating" and "perturbing". So avoid any perturb-plus-propagate iteration, not just randomness. Facts only. |

The two Cowork files differ on which dependent claims of US 8,285,055 say "random": its PHASE4 file says 12 and 20; its
spot-check log (re-fetched) says 4, 11, 12 and 20.

**Where it adds to or differs from this draft** (as the Cowork file states them):
- **Moebius:** it found no ONNX or browser port (this draft cites moebius-web running it on WebGPU at about 1.27 GB
  fp32). It notes the HF tag says MIT while the README says Apache-2.0 (both permissive), and that the training data is
  undisclosed.
- **Shadow fill:** it recommends not building generative shadow fill and pointing users to denoise instead. This draft
  keeps both sides as the owner asked (open question 7).
- **BRIA RMBG-1.4:** its card reads "a Creative Commons license for non-commercial use", confirming the exclusion this
  draft assumed.
- **WebGPU field data** (web3dsurvey): `maxStorageBufferBindingSize` ≥ 1 GiB on 91 % and ≥ 2 GiB − 1 on 16 % of
  devices; `maxBufferSize` ≥ 2 GiB − 1 on about 78 %; `shader-f16` on 93.95 % (Linux 73.53 %). This draft's search
  snippet put 2 GiB − 4 on ~79 % for `maxStorageBufferBindingSize`. BiRefNet exceeds `maxStorageBuffersPerShaderStage`
  without graph surgery.
- **Delivery:** it agrees GitHub Release assets lack CORS (from an open GitHub community bug report; this draft tested
  the headers with curl). It adds a forum report that Range requests to Hugging Face fail CORS preflight on the CDN
  redirect, while plain GETs work, and suggests small models same-origin on Pages, optional ones on HF pinned by commit
  and SHA-256.
- **Patents:** it adds US 8,818,135 (Adobe, low-memory content-aware fill, Active to 2033-02-23), US 8,542,908 (Yeda,
  bidirectional similarity, Active to 2030-05-09; claim 1 not read) and the facts on Apple's US 10,410,327 (see
  [DEPTH_OF_FIELD.md](DEPTH_OF_FIELD.md)).
- **ProRAW masks:** it gives the DNG 1.6 tag numbers but could not confirm Apple's `SemanticName` strings (this draft has
  them from LightCraft's code).

---

## How this was researched

- **Date:** 13 October 2026.
- **Read at the source** (GitHub raw files and shallow clones; the commits are the HEADs on that date):
  - MI-GAN `2b793c5`, Moebius `b88d462`, PixelHacker, LaMa `786f593`, MAT, Co-Mod-GAN, FcF, AOT-GAN, ZITS, IOPaint;
  - inpaint-web `d1b6cfd`, moebius-web `080be6e`;
  - HDRCNN, ExpandNet, HDRUNet, Deep-HdrReconstruction (Santos et al.);
  - Depth Anything V2 `a561b84`, BiRefNet `c4d6496`, SAM 2 `2b90b9f`;
  - darktable-ai `f1a46e2` model cards;
  - CompVis Stable Diffusion LICENSE, Stability `generative-models` SDXL licence, FLUX licence, Kandinsky 2 and 3;
  - NAFNet, SCUNet, rawnind_jddc, nind-denoise;
  - GitHub's docs source (`github/docs`), Hugging Face's docs source (`huggingface/hub-docs`) and MDN's source
    (`mdn/content`);
  - the WebGPU spec source (`gpuweb/gpuweb`), Dawn `bf94d83` (`src/dawn/native/Limits.cpp`) and ONNX Runtime `9036f07`
    (`js/web`).
- **Measured here:**
  - MI-GAN's parameter count, by counting the layers in `lib/model_zoo/migan_inference.py`: 5,893,158 learnable
    parameters at 512, plus 80,208 fixed filter weights stored as parameters.
  - The CORS headers of GitHub release assets and of raw.githubusercontent.com, with `curl` and an `Origin` header.
- **Blocked by the network proxy** (claims resting on them are marked):
  - huggingface.co (model cards, file sizes);
  - arxiv.org, openaccess.thecvf.com and most paper sites;
  - docs.github.com (read via its GitHub source instead);
  - helpx.adobe.com, patents.google.com, places2.csail.mit.edu, the SIDD site, web3dsurvey.com.

  Search-engine results were used only as pointers, and the text says so wherever a claim rests on one.
- **Nothing was run.** No model was executed and no browser speed was measured.

---

## Licence notes that apply throughout

- **Apache-2.0 vs MIT on patents (fact, not advice):**
  - Apache-2.0 §3 grants a patent licence from each contributor for their contributions.
  - MIT and BSD licences contain no patent wording.
  - Apple's sample-code licence (Depth Pro) explicitly grants no patent rights: "no other rights or licenses … are
    granted by Apple herein, including but not limited to any patent rights" ([LICENSE](https://github.com/apple/ml-depth-pro/blob/main/LICENSE)).
- **Weights licence vs training data.** Most models below state a permissive weights licence but were trained on datasets
  with non-commercial or unknown terms. AI_MODELS.md already raised this for SA-1B (SAM 2.1) and DIS5K (BiRefNet). It
  applies again here:
  - **Places2/Places365.** The Places365 README says only that "The pretrained places-CNN models can be used under the
    Creative Common License (Attribution CC BY)" and "The copyright of all the images belongs to the image owners"
    ([README](https://github.com/CSAILVision/places365)). The image-download terms are on places2.csail.mit.edu
    (blocked, **unverified**).
  - **FFHQ** is CC BY-NC-SA 4.0 per NVIDIA's dataset repo (**unverified** here; not opened). Avoid FFHQ-trained
    checkpoints. LightBench only needs the Places2 ones anyway.
- **"Responsible AI" licences** (CreativeML OpenRAIL-M, OpenRAIL++-M) attach use restrictions that must be passed on to
  every user. Paragraph 5 of OpenRAIL-M: "You shall require all of Your users who use the Model or a Derivative of the
  Model to comply with the terms of this paragraph (paragraph 5)" ([CompVis LICENSE](https://github.com/CompVis/stable-diffusion/blob/main/LICENSE)).
  That is a field-of-use restriction of the kind the owner excludes (see Excluded).

---

## Inpainting candidates (shared by sections 1 and 4)

| Model | Code licence | Weights licence (evidence) | Training data (authors' statements) | Size | Input | Browser runtime | Quality limits | Patent facts |
|---|---|---|---|---|---|---|---|---|
| **MI-GAN** (Picsart AI Research, ICCV 2023) | MIT ([LICENSE](https://github.com/Picsart-AI-Research/MI-GAN/blob/main/LICENSE)). **But** the repo also contains NVIDIA files (`dnnlib/`, `torch_utils/`) whose headers say "Any use, reproduction, disclosure or distribution … without an express license agreement from NVIDIA CORPORATION is strictly prohibited". The inference model (`lib/model_zoo/migan_inference.py`) imports only numpy and torch, and LightBench would use only the exported ONNX | **MIT**, separate `LICENSE-WEIGHTS` file; the README says "see LICENSE-WEIGHTS for the license" | Places2 (256/512) and FFHQ (256) checkpoints. Trained by **distillation from a Co-Mod-GAN teacher** (README, "Co-Mod-GAN training"). Co-Mod-GAN's licence is BSD for its own code, but it bundles StyleGAN2 under "Nvidia Source Code License-NC" ([LICENSE.txt](https://github.com/zsyzzsoft/co-mod-gan/blob/master/LICENSE.txt)) | **5.89 M params** (counted from the code); ≈ 24 MB fp32 / 12 MB fp16 (estimate). The search snippet of the paper's figure lists 5.9 M | Fixed 512×512 (the inference code fixes noise/filter buffers to the resolution). The ONNX pipeline "does … cropping around the mask, resize to 512x512 … resizing to original, blending" (README) | **Yes:** inpaint-web (GPL-3.0) runs `migan_pipeline_v2.onnx` with `onnxruntime-web` and `executionProviders: ['webgpu' or 'wasm']` (`src/adapters/inpainting.ts:207`). No published browser timing. The supplement reports ~539 ms on an iPhone 14 Pro Max for the 512 model (search snippet, **unverified**) | README: "when inpainting high resolution images the best results can be achieved with small, incremental brush strokes (if the inpainting area is large)". GAN fills can repeat textures on large holes | Search found no MI-GAN patent. Picsart holds US 11,967,050 "Onion convolution-based inpainting of images" (title only; its relation to MI-GAN is unknown) |
| **LaMa / big-lama** (Samsung AI Center, WACV 2022) | Apache-2.0 ([LICENSE](https://github.com/advimman/lama/blob/main/LICENSE)) | Not stated separately. The README points to `huggingface.co/smartywu/big-lama` and a Google Drive folder. The HF ONNX `Carve/LaMa-ONNX` is tagged apache-2.0 (search result, **unverified**) | Big LaMa: "Places Challenge" (README, `Places365-Challenge: Train(476GB)`); CelebA-HQ models also exist | 208,044,816 bytes fp32 ONNX for `Carve/LaMa-ONNX` (search result, **unverified**), i.e. ≈ 52 M params and fp16 ≈ 104 MB (estimates) | Trained at 256; "generalizes surprisingly well to much higher resolutions (~2k❗️)" (README). The Carve ONNX is fixed at 512×512 (search result) | ONNX Runtime Web. The `DFT` op its Fourier convolutions may need is listed for the WebGPU EP ([webgpu-operators.md](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md)); whether Carve's graph uses it is **unverified**. transformers.js has no inpainting models (4.3.1 registry). No browser timing found | Strong on large masks and periodic structure (README claim). Blurs fine texture at large scale (general knowledge, unverified) | Search found no LaMa patent (not conclusive). Apache-2.0 §3 patent grant from contributors |
| **Moebius** (HUST + vivo, ECCV 2026) | Apache-2.0 ([LICENSE](https://github.com/hustvl/Moebius/blob/main/LICENSE)) | "Both the code and the pretrained model weights of Moebius are released under the Apache License 2.0 … Commercial use of the weights and the images produced with them is permitted." (README §License). **The VAE is a separate download** from `hustvl/PixelHacker` (README "Model Checkpoints"). Its config has `scaling_factor: 0.13025`, which matches SDXL's VAE. Its own licence is **unverified**: the PixelHacker repo is Apache-2.0, and mirrors tag `stabilityai/sdxl-vae` MIT (search result) | Distilled from the PixelHacker teacher, which was pre-trained on ~14 M image–mask pairs whose sources weren't named in any result found (**unverified**). Fine-tunes on Places2, CelebA-HQ and FFHQ | 226.04 M params (moebius-web `notes.md`). ONNX: UNet ~907 MB + VAE encoder ~137 MB + decoder ~198 MB fp32 (moebius-web `understanding.md`). fp16 UNet ~450 MB (planned, untested there) | Fixed 512×512 ("the model's cross-attention uses a position embedding tied to the trained resolution", moebius-web README) | **Yes:** moebius-web runs it with ONNX Runtime Web 1.27 on WebGPU, ~20 DDIM steps × 2 (classifier-free guidance). CPU reference: "~8.9 s/step on CPU … CPU/WASM is unusable" (`notes.md`). Its notes report a Safari Metal compile failure | The README claims parity with FLUX.1-Fill-dev "across 6 benchmarks" (authors' claim). 1.27 GB first download | none found (not searched in depth) |
| **AOT-GAN** (2022) | Apache-2.0 ([README](https://github.com/researchmm/AOT-GAN-for-Inpainting): "This project is released under the Apache 2.0 license") | Repo licence only (Google Drive weights) | Places2, CelebA-HQ | not measured | not checked | none found | Older; weaker than LaMa in later papers (unverified) | not searched |
| **ZITS** (2022) | Apache-2.0 ([LICENSE](https://github.com/DQiaole/ZITS_inpainting/blob/main/LICENSE)) | Repo licence only | Places2 + an indoor set; needs a separate wireframe model (LSM-HAWP) | multi-model, large | not checked | none found | Good line/structure continuation (paper claim, not read). Complex pipeline | not searched |
| Kandinsky 2.2 inpaint | Apache-2.0 ([license](https://github.com/ai-forever/Kandinsky-2/blob/main/license)) | Repo licence; HF card unverified | "trained on a large-scale image-text dataset LAION HighRes and fine-tuned on our internal datasets" (README, 2.1) | UNet 1.2 B (2.0) + CLIP image encoder 1.8 B (README) | 512–768 | none found | Too big for a browser | — |

**Why not the others:** see [Excluded and why](#excluded-and-why) (MAT, Co-Mod-GAN, FcF, the Stable Diffusion
inpainting checkpoints, FLUX Fill, SingleHDR).

---

## 1. Clipped highlight and shadow fill

### The owner's requirement (PLAN.md, 2026-10-12)
- **Recover first; AI only where nothing is left.**
  - Partly clipped areas use darktable's highlight reconstruction (LightBench's default "inpaint opposed", PHASE1.md).
  - AI fills only areas with no data: all channels clipped, or crushed to black.
- **Thresholds and buffer.** A threshold each for highlights and shadows, and a **buffer** slider that grows or shrinks
  the area. The buffer "can still extend the AI fill over the fringe that recovery handled".
- **Preview before Go:** the area is shown on the photo before anything is generated.
- **Labelled as generated**, on a **separate, removable layer**.

### How a model fits this (design notes; untested)

1. **The mask is LightBench's own**, with no model involved.
   - **Highlights:** photosites where *every* colour is at the white level in a small neighbourhood. These are the pixels
     "inpaint opposed" can't reconstruct, because it needs at least one unclipped channel.
   - **Shadows:** photosites at or below the black level plus a noise floor.
   - **Buffer:** a signed morphological dilate/erode in pixels.
   - **Preview:** the existing sensor-clipping overlay (PHASE3 Part 9, "lost detail" mode) already maps the shown image
     back to photosites, so it can preview this mask.
2. **Crop and resize** per connected region, as MI-GAN's ONNX pipeline does: crop around the mask, resize to 512×512,
   then paste back with blending (MI-GAN README, "For Developers").
3. **Domain.** These models were trained on display-referred 8-bit images (Places2). Feed them the photo through a fixed
   tone curve, then convert the result back to scene-linear.
4. **Physical constraint.**
   - A blown highlight was **at least** as bright as the clip level. Keep the model's chroma and texture, but force the
     filled luminance to be ≥ the clip level in scene-linear. Otherwise the AI can make a blown sky darker than its
     unclipped surroundings.
   - Crushed shadows were **at most** the black floor. Their fill matters only when the user lifts the shadows; it
     should stay below that floor at the original exposure.
5. **A layer, not pixels baked in.** Store it like the Remove spots (PHASE3 Part 11): the mask parameters, the model id
   and its SHA-256, and the crop boxes, plus the generated patch, so renders and exports don't re-run the model.
   - GPU floating point may differ between devices, so caching the patch is safer than relying on re-running it.
     MI-GAN's noise is a fixed buffer baked into the export (`noise_const`, `migan_inference.py`), so it is
     deterministic on one device.
   - Label it "Generated", with an eye toggle and Delete.

### HDR / highlight-reconstruction models

| Model | Code licence | Weights licence | Training data | Notes | Verdict |
|---|---|---|---|---|---|
| HDRCNN (Eilertsen et al., SIGGRAPH Asia 2017) | BSD: "The code is distributed under a BSD license" ([README](https://github.com/gabrieleilertsen/hdrcnn)) | Not stated; weights on computergraphics.on.liu.se | HDR image/video collections (not checked) | Predicts the magnitude of saturated regions from **8-bit LDR**. README: "a value around *1.1-1.3* may be a good idea, since this prevents underestimation of the brightest pixels, which otherwise is common (e.g. due to limitations in the training data)" | **Not recommended.** LightBench has RAW data, and darktable's reconstruction already uses what is left |
| Santos et al., *Single Image HDR Reconstruction Using a CNN with Masked Features and Perceptual Loss* (SIGGRAPH 2020) | BSD 3-Clause ([LICENSE](https://github.com/marcelsan/Deep-HdrReconstruction/blob/master/LICENSE)) | Not stated (Google Drive) | not checked | "recovering the saturated pixels of a single input LDR image in a visually pleasing way" (README). The closest in spirit to the owner's request | **Hold:** the weights licence is unstated, and it is LDR-based |
| ExpandNet (Marnerides et al., 2018) | BSD ([LICENSE](https://github.com/dmarnerides/hdr-expandnet/blob/master/LICENSE)) | not stated | not checked | LDR → HDR expansion | Not recommended |
| HDRUNet (NTIRE 2021) | MIT ([LICENSE](https://github.com/chxy95/HDRUNet/blob/master/LICENSE)) | Repo includes `pretrained_model` (README) | NTIRE 2021 HDR challenge data (terms not checked) | Single-frame LDR → HDR | Not recommended |
| SingleHDR (Liu et al., CVPR 2020) | **No LICENSE file** (404 on master) | — | — | — | **Excluded** (no licence) |

These models solve a different problem from the owner's: recovering *how bright* a blown area was from an 8-bit JPEG.
With RAW files, that magnitude is unknowable once every channel is clipped, and darktable's reconstruction already uses
any channel that survived. **What's missing is plausible texture and colour, which is an inpainting job.**

### Recommendation for §1
- **MI-GAN 512 Places2** as the default:
  - weights explicitly MIT;
  - about 12–24 MB;
  - proven in browsers with ONNX Runtime Web on WebGPU;
  - blown skies and specular areas are usually low-texture, which suits it.
- **LaMa** as the optional "higher quality" download for large blown areas: Apache-2.0 code; ~200 MB fp32, ~100 MB fp16
  (estimate).
- **Unresolved:** the weights licence statement for LaMa (the Apache-2.0 repo licence only), the Places2 image terms
  (unverified), and MI-GAN's training dependence on NVIDIA-licensed code and a Co-Mod-GAN teacher (facts above; the
  owner's call).

---

## 2. AI depth of field

The full research (the depth→blur maths, rendering methods, foreground problems, UI precedents and a costed
recommendation) is in **[DEPTH_OF_FIELD.md](DEPTH_OF_FIELD.md)**. In brief:

| Candidate | Code licence | Weights licence | Size | Browser | Verdict |
|---|---|---|---|---|---|
| **Depth Anything V2 Small** | Apache-2.0 ([LICENSE](https://github.com/DepthAnything/Depth-Anything-V2/blob/main/LICENSE)) | **Apache-2.0**: "Depth-Anything-V2-Small model is under the Apache-2.0 license" (README) | 24.8 M; fp16 ≈ 50 MB (estimate) | transformers.js `depth_anything` (4.3.1 `registry.js:537`); official WebGPU demo loads `onnx-community/depth-anything-v2-small` (AI_MODELS.md). No browser timing published | **Pick** |
| DA2 Base/Large/Giant | Apache-2.0 | **CC-BY-NC-4.0** (README) | 97.5 M+ | — | Excluded |
| DA2 Metric-Small (Hypersim/VKITTI) | Apache-2.0 | unclear (the README's licence line names only "Depth-Anything-V2-Small"); Virtual KITTI 2 data likely NC (unverified) | 24.8 M | — | Hold; not needed |
| Depth Anything 3 SMALL / BASE / MONO-LARGE / METRIC-LARGE | Apache-2.0 | "Apache 2.0" in the README table; GIANT/LARGE/NESTED are CC BY-NC 4.0 | 0.08 B / 0.12 B / 0.35 B / 0.35 B | not in transformers.js 4.3.1; ONNX unverified | Optional later (MONO-LARGE adds sky segmentation) |
| Apple Depth Pro | Apple sample-code licence ("personal, non-exclusive", no patent rights) | same | not measured | transformers.js `depth_pro` | Excluded (custom licence) |
| MiDaS v3.1 / DPT | MIT ([LICENSE](https://github.com/isl-org/MiDaS/blob/master/LICENSE)) | repo MIT; weights on GitHub releases | 85.8 MB–1.58 GB (AI_MODELS.md) | transformers.js `dpt` | Fallback only |
| Metric3D v2 | BSD 2-Clause | not stated; "For further commercial inquiries, please contact …" (README) | ViT-S variant | ONNX on HF (unverified) | Hold |
| Marigold | Apache-2.0 | OpenRAIL++-M (use restrictions) | diffusion-sized | — | Excluded |
| UniDepth | — | CC BY-NC 4.0 | — | — | Excluded |

**Subject for auto focus:** reuse §3's subject mask (BiRefNet-lite, or SAM 2.1 from a click). The focus plane is the
median disparity inside it.

**Rendering (not a model):**
- layered, depth-sliced compositing with normalised alpha (MPIB, Apache-2.0);
- circular separable kernels (Garcia, MIT reference) or FFT per slice;
- in LightBench's scene-linear light, so bokeh highlights keep their energy;
- details and sources in DEPTH_OF_FIELD.md §2–3.

---

## 3. Masking: subject, sky, background, people

AI_MODELS.md (2026-10-11) is the full study. This re-check confirms its licence findings and adds the points the brief
asked about.

| Model | Code licence | Weights licence (quoted) | Training-data caveat | Size | Input | Browser | Verdict |
|---|---|---|---|---|---|---|---|
| **SAM 1** (Meta, 2023) | Apache-2.0 | "The model is licensed under the [Apache 2.0 license]" ([README](https://github.com/facebookresearch/segment-anything#license)) | SA-1B: "By downloading the datasets you agree that you have read and accepted the terms of the SA-1B Dataset Research License" (same README) | ViT-B / ViT-L / ViT-H (sizes not re-checked) | 1024 | transformers.js `sam` | Superseded by SAM 2.1 |
| **SAM 2 / 2.1** | Apache-2.0 | "The SAM 2 model checkpoints, SAM 2 demo code (front-end and back-end), and SAM 2 training code are licensed under Apache 2.0" ([README](https://github.com/facebookresearch/sam2#license)) | SA-V (README); SA-1B per darktable-ai's card (AI_MODELS.md) | Tiny 38.9 M (fp16 ≈ 78 MB, estimate) | 1024 | transformers.js `sam2` (4.3.1 `registry.js:491`) | **Default click/hover** |
| EfficientSAM, MobileSAM, SlimSAM | Apache-2.0 (repo LICENSE files; AI_MODELS.md) | repo licence (HF cards unverified) | SA-1B | 9–26 M | 1024 | SlimSAM-77 in the official transformers.js hover demo | SlimSAM-77 = low-end fallback |
| EdgeSAM | **S-Lab License 1.0**: "Redistribution and use for non-commercial purpose in source and binary forms … are permitted" ([LICENSE](https://github.com/chongzhou96/EdgeSAM/blob/master/LICENSE)) | same | — | — | — | — | **Excluded** |
| **U²-Net / U²-Netp** | Apache-2.0 ([LICENSE](https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE)) | repo licence (unverified for weights) | DUTS-TR (README; terms not checked) | 176 MB / 4.6 MB ONNX (rembg assets) | 320 ("please keep the input size as 320x320", README) | ONNX Runtime Web | Tiny fallback only |
| **IS-Net (DIS)** | Apache-2.0: "Our code and evaluation metric use Apache License 2.0" ([README](https://github.com/xuebinqin/DIS)) | **not stated** (the README covers "code and evaluation metric") | DIS5K: "commercial use of this dataset is prohibited" ([terms PDF](https://github.com/xuebinqin/DIS/blob/main/DIS5K-Dataset-Terms-of-Use.pdf), AI_MODELS.md) | 178.6 MB ONNX | 1024 (unverified) | ONNX Runtime Web | Superseded by BiRefNet |
| **BiRefNet** (checked carefully) | **MIT**: "MIT License Copyright (c) 2024 ZhengPeng" ([LICENSE](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE)); the README badge links the same file | The repo's MIT licence. The weights are in the same repo's GitHub releases ([v1](https://github.com/ZhengPeng7/BiRefNet/releases/tag/v1)) and on HF (HF card licence **unverified**). No separate weights licence was found | The "general use" models list DIS5K-TR, DIS-TEs, DUTS, HRSOD, UHRSD, HRS10K, P3M-10k, TR-humans … (README model zoo). DIS5K is non-commercial (above). P3M-10k's and AM-2k's terms were **not checked** | lite (Swin-T) 224 MB fp32 ONNX; general (Swin-L) 973 MB (AI_MODELS.md) | 1024 (lite-2K: 2560×1440) | transformers.js `birefnet` (`registry.js:656`); the README credits an in-browser ONNX Runtime Web use | **Default subject**, with the training-data caveat |
| **BRIA RMBG-1.4 / 2.0** | — | **RMBG-2.0:** BiRefNet's README: "their weights are for only **non-commercial use**". Mirrors of BRIA's card say "source-available … for non-commercial use" and offer a paid commercial licence (search results). **RMBG-1.4:** BRIA's card couldn't be read (HF blocked) | BRIA's private data | — | — | — | **Excluded** (2.0 confirmed by a second source; 1.4 assumed the same until the card can be read) |
| **MediaPipe Selfie Multiclass** | Apache-2.0 | "Apache License, Version 2.0" (model card PDF, AI_MODELS.md) | see the model card (AI_MODELS.md) | 16.4 MB | 256 (file name `selfie_multiclass_256x256`) | `@mediapipe/tasks-vision` | **Default people parts** |
| **Sky** | — | — | — | — | — | — | No small, clearly licensed sky model found (AI_MODELS.md). Options: **(a)** ProRAW sky matte when present; **(b)** a rule on DA2 depth + colour + position, refined by SAM 2.1; **(c)** DA3 MONO-LARGE's sky head (Apache 2.0, 0.35 B) as an optional download. The U²-Netp sky model in xiongzhu666's repo has unstated training data, and its author kept the good model private: "We couldn't public the high-precision model because it used in our product" ([README](https://github.com/xiongzhu666/Sky-Segmentation-and-Post-processing)) |

**No-model option for iPhone ProRAW:**
- DNG 1.6 semantic masks are single-channel mattes in their own IFDs (NewSubFileType 10004.H, PhotometricInterpretation
  52527) with a `SemanticName` such as `urn:com:apple:photo:2020:aux:semanticskymatte`. LightCraft reads them in
  `crates/raw/src/semantic.rs`.
- Its name table maps `semanticskymatte`, `semanticskinmatte`, `semantichairmatte`, `semanticteethmatte`,
  `semanticglassesmatte` and `portraiteffectsmatte` (person) (`crates/engine/src/files.rs:580-590`, commit `701f78e`).
- LightCraft's code is MIT/Apache, so it can be ported (LIGHTCRAFT.md). LightBench left these masks for Phase 4
  (PHASE3.md Part 5).

---

## 4. AI Remove (generative fill for the Remove brush)

**How it plugs in:** the Remove brush already has a list of modes (`engine/develop/spots.ts`, `SPOT_MODES`), and "the
stored spot already holds everything an AI fill would need (stroke, source, seed)" (PHASE3 Part 11, on
`lightbench/remove`). An "AI" mode is one more entry.

**How this differs from §1:**

| | Clipped-area fill (§1) | Object removal (§4) |
|---|---|---|
| Hole shape | Large, soft-edged regions (sky, windows, speculars) | Strokes and blobs around objects |
| What's around it | Usually smooth gradients | Structure: lines, edges, repeating texture |
| Brightness | Constrained (≥ clip level, or ≤ black floor) | Free; must match its surroundings |
| What fails | Darker-than-clip fills; colour casts | Leftover object shadows; broken lines; copying the object back |
| Model need | Low texture; small is fine | Structure continuation; LaMa (and Moebius) matter more |
| Mask helper | Computed from the raw data | Brush, or a SAM 2.1 click mask dilated a little |

**Recommendation for §4:**
- **The same MI-GAN default and LaMa option** as §1, so one model download serves both tools.
- **Moebius** is the candidate for a later "best quality" mode. Its own licence is the clearest of all the inpainting
  models, explicitly allowing commercial use of the weights and of generated images. **But:**
  - it is a 1.27 GB fp32 download (moebius-web);
  - it runs ~20 diffusion steps × 2 on WebGPU only; CPU is "unusable" per its porter's notes;
  - its VAE's licence and its teacher's training data are unverified;
  - it was released in June 2026.
- **The no-AI PatchMatch Remove** (on `lightbench/remove`) stays the zero-download default. Its patent question
  (Adobe US 8,285,055, adjusted expiry 2031 per Google Patents via search, PHASE3 Part 11) is separate. LaMa, MI-GAN and
  Moebius are feed-forward or diffusion networks and don't use PatchMatch's randomized correspondence search.

---

## 5. AI denoise

| Model | Code licence | Weights licence | Training data | Size / input | Notes |
|---|---|---|---|---|---|
| **NAFNet (SIDD, width 32)** | MIT ([LICENSE](https://github.com/megvii-research/NAFNet/blob/main/LICENSE)) | MIT per darktable-ai's card: "Model license: MIT" ([card](https://github.com/darktable-org/darktable-ai/blob/main/models/denoise-nafnet/README.md)) | SIDD smartphone pairs. darktable-ai's card says "Training data license: MIT"; SIDD's own licence page was blocked, and only a doubtful third-party site says MIT (**unverified**) | 108.4 MB package; float32 [1,3,768,768] tiles | Works on **display-referred RGB** after demosaic, not on raw data |
| **NIND denoise** (darktable-ai `denoise-nind`) | GPL-3.0 ([nind-denoise](https://github.com/trougnouf/nind-denoise)) | "License: GPL-3.0" ([card](https://github.com/darktable-org/darktable-ai/blob/main/models/denoise-nind/README.md)) | "CC BY 4.0 / CC0 (per-image, Wikimedia Commons)" | 55.0 MB; [1,3,768,768] | Clean data provenance |
| **RawNIND** (darktable-ai `rawdenoise-nind`) | GPL-3.0 ([rawnind_jddc](https://github.com/trougnouf/rawnind_jddc)) | "License: GPL-3.0" ([card](https://github.com/darktable-org/darktable-ai/blob/main/models/rawdenoise-nind/README.md)) | RawNIND (same authors; open licences per card) | 57.7 MB; `model_bayer.onnx` [1,4,512,512] → [1,3,1024,1024]; `model_linear.onnx` [1,3,512,512] in `lin_rec2020` | **Raw / linear Rec.2020 input fits LightBench's pipeline.** The Bayer variant also demosaics |
| SCUNet | Apache-2.0 ([LICENSE](https://github.com/cszn/SCUNet/blob/main/LICENSE)) | repo licence | not checked | not checked | Not checked further |

**GPL-3.0 weights in a GPL-3.0 app: the facts only.**
- GPL-3.0 is copyleft, not non-commercial. Commercial use and redistribution are allowed if the GPL's conditions are met.
- darktable-ai, itself a GPL-3.0 repository, requires "Model weights must be released under a license compatible with
  GPL-3.0" (README, quoted in AI_MODELS.md). darktable ships these models.
- The owner's rule says "permissive only". GPL is not usually called permissive, so whether GPL-3.0 weights qualify for
  LightBench is **the owner's call**.

---

## Model delivery

**Owner's decision (2026-10-17), built in PHASE3.md Part 24 with Depth Anything V2 Small, the first downloaded model:**
the models are served from **LightBench's own GitHub Pages site** (same origin: no CORS question). They are **not in
git**: the deploy workflow fetches each pinned file by exact URL (`huggingface.co/<repo>/resolve/<commit>/<path>`) into
`dist/models/` and checks its byte count and SHA-256 (`web/scripts/models.mjs`), failing the build on a mismatch. The
app downloads a model **once, only after the user agrees** (a dialog with its size, licence and a plain-words
training-data note), checks the same SHA-256 (compiled into the app from `web/models/manifest.json`), keeps it in Cache
Storage (`ai-models`, never precached by the service worker), works offline afterwards, and removes it in Settings → AI
models. One runtime, **ONNX Runtime Web** (MIT, pinned 1.30.0, its native WebGPU provider in a worker), serves it and is
meant to serve the later models. Devices with `shader-f16` get the fp16 file, others fp32 (F9 below). The manifest is
pinned (2026-10-20, Depth Anything V2 Small at commit `4472b7362082ad9968fee890ca0f1e5aca36b93d`). huggingface.co was
blocked from the build machine, so, by the owner's choice (2026-10-19), it is pinned and checked by the **"AI
models" GitHub Action** (`.github/workflows/ai-models.yml`, run by hand from the Actions tab with "Use workflow from" the
branch with the AI code). The Action runs `pin`, then a real-model check in Node through the app's own preprocessing
(`web/scripts/models-check.mjs`), then commits the manifest (PHASE3.md Part 24, "Pinning and checking the models").
Pages' limits: 1 GB per site (the two DA-V2 files are about 149 MB), 100 GB a month soft bandwidth (about 800 fp32 or
1,300 fp16 first installs a month, runtime included: arithmetic).

**The plan (before the decision):** download on first use from LightBench's own pinned copy, the way Lensfun data is handled:
- not precached by the service worker;
- fetched once into Cache Storage under its own cache name;
- named by the source commit;
- re-tried when offline (`web/lensfun-plugin.ts`, PHASE3 Part 2).

For models, add a SHA-256 check and a licence dialog before download, as LightCraft (`crates/faces`) and darktable do.

| Host | Limits (cited) | CORS / browser use | Fit |
|---|---|---|---|
| **GitHub Pages** (LightBench's site; deployed with `actions/upload-pages-artifact` per `.github/workflows/deploy.yml`) | "Published GitHub Pages sites may be no larger than 1 GB." Source repositories: "a recommended limit of 1 GB". "a _soft_ bandwidth limit of 100 GB per month". Deployments time out after 10 minutes ([github-pages-limits.md](https://github.com/github/docs/blob/main/content/pages/getting-started-with-github-pages/github-pages-limits.md)). A file in git above **100 MiB** is blocked (warning at 50 MiB) ([large_files.yml](https://github.com/github/docs/blob/main/data/variables/large_files.yml)). A per-file limit for Actions-deployed Pages artifacts isn't stated on that page (**unverified**) | Same origin, so no CORS question | **Small models only.** 100 GB/month is about 4,000 downloads of a 24 MB MI-GAN, or 500 of a 200 MB LaMa (arithmetic). The page also says Pages is "not intended for or allowed to be used as a free web-hosting service to run your online business … or … commercial software as a service (SaaS)" |
| **GitHub Releases** | "Each file included in a release must be under 2 GiB. There is no limit on the total size of a release, nor bandwidth usage." Up to 1000 assets per release ([about-releases.md](https://github.com/github/docs/blob/main/content/repositories/releasing-projects-on-github/about-releases.md) with [`large_files.yml`](https://github.com/github/docs/blob/main/data/variables/large_files.yml) / [`releases.yml`](https://github.com/github/docs/blob/main/data/variables/releases.yml)) | **Tested 2026-10-13 with `curl -H 'Origin: …'`:** `github.com/…/releases/download/…` answers **302 with no `Access-Control-Allow-Origin`**, and the redirect target on `release-assets.githubusercontent.com` answered 206 with **no `Access-Control-Allow-Origin`** either. A browser `fetch` from LightBench's origin would therefore be blocked (inferred from headers; not tested in a browser). darktable downloads natively, so this doesn't affect it | **Fine for the Tauri app; not usable directly from the website** without a CORS proxy |
| **raw.githubusercontent.com** | Files in git: 100 MiB maximum (above) | Sends `access-control-allow-origin: *` (tested) | Possible for small models, but GitHub doesn't present it as a CDN (its terms on heavy use were not read; **unverified**) |
| **Hugging Face Hub** (a LightBench-owned repo, URLs pinned to a commit: `…/resolve/<commit>/<file>`) | Public storage for free accounts: "Best-effort"; recommended file size "<200GB" ([storage-limits.md](https://github.com/huggingface/hub-docs/blob/main/docs/hub/storage-limits.md)). Rate limits per 5-minute window: anonymous users **3,000 "Resolvers" requests per IP** ([rate-limits.md](https://github.com/huggingface/hub-docs/blob/main/docs/hub/rate-limits.md), "in September '25") | Works from browsers in practice: inpaint-web (`src/adapters/cache.ts`) and moebius-web (GitHub Pages) fetch `huggingface.co/…/resolve/main/…` directly. moebius-web's notes: `resolve` answers **302 to a signed CDN URL with rotating query parameters**, so the HTTP cache never hits. The fix is to store the bytes in Cache Storage keyed by the stable `resolve` URL (`notes.md`, "Model caching"). HF's terms on hotlinking were **not read** (site blocked) | **Best fit for the website:** no bandwidth cap is stated, CORS works, and a commit-pinned URL plus SHA-256 gives a "pinned copy". **Unverified:** the terms of service and acceptable use for hotlinking from a public app |

**Browser storage (Chromium):**
- "an origin can store up to 60% of the total disk size in both persistent and best-effort modes"
  ([MDN, Storage quotas](https://github.com/mdn/content/blob/main/files/en-us/web/api/storage_api/storage_quotas_and_eviction_criteria/index.md)).
  This covers the Cache API, IndexedDB and OPFS together.
- `navigator.storage.persist()`: "Safari and most Chromium-based browsers … automatically approve or deny the request
  based on the user's history of interaction with the site and do not show any prompts" (same page).
- **Large single files:** "the maximum size of an ArrayBuffer in Chrome is 0x7fe00000 bytes (around 2GB)". A protobuf
  (ONNX) file is limited to 2 GB (larger models need external data). "WebAssembly has a memory limit of 4GB … there is no
  way for ONNX Runtime Web to run models larger than 4GB"
  ([ORT Web: large models](https://github.com/microsoft/onnxruntime/blob/gh-pages/docs/tutorials/web/large-models.md)).
  Every model recommended here is far below these limits. Moebius at 1.27 GB fits, as three files.

---

## WebGPU limits for in-browser inference

| Limit | Spec default (guaranteed) | Chrome (Dawn) exposes these tiers | Typical reported values |
|---|---|---|---|
| `maxStorageBufferBindingSize` | 134,217,728 bytes (128 MiB) ([spec source](https://github.com/gpuweb/gpuweb/blob/main/spec/index.bs), limits table) | 128 MiB, 256 MiB, 512 MiB, 1 GiB, 2 GiB − 4, 4 GiB − 4 ([Dawn `Limits.cpp`](https://github.com/google/dawn/blob/main/src/dawn/native/Limits.cpp), commit `bf94d83`) | Per web3dsurvey, from a search snippet (**unverified**; site blocked): **2,147,483,644 (2 GiB − 4) on ~79 % of all reports**; on macOS, Intel GPUs mostly report 2 GiB − 4 and NVIDIA 1 GiB |
| `maxBufferSize` | 268,435,456 bytes (256 MiB) | 256 MiB, 1 GiB, 2 GiB, 4 GiB − 4 (same file) | not found |
| `maxComputeWorkgroupStorageSize` | 16,384 bytes | 16 KiB, 32 KiB, 48 KiB, 64 KiB | not found |
| `maxComputeInvocationsPerWorkgroup` | 256 (128 in compatibility mode) | 128, 256, 1024 | not found |
| `shader-f16` | Optional feature: "Allows the use of the half-precision floating-point type f16 in WGSL" (spec) | Requested by ONNX Runtime Web when available: `requireFeatureIfAvailable('shader-f16')` (`js/web/lib/wasm/jsep/backend-webgpu.ts:253`) | Share of adapters with f16 not found (**unverified**) |

**What this means for LightBench:**
- ONNX Runtime Web asks for the adapter's own `maxStorageBufferBindingSize` and `maxBufferSize` (`backend-webgpu.ts`
  lines 233–237), not the defaults.
- The models recommended here (MI-GAN, DA2-Small, SAM 2.1 Tiny, BiRefNet-lite) are far below 128 MiB per tensor
  (estimate from their total sizes). They should run even at the spec defaults.
- Without `shader-f16`, fp16 weights still save download size, but compute may be in fp32. The transformers.js demo
  picks fp16 only "when available" (AI_MODELS.md).
- The **integrated vs discrete** difference reported in the snippet is about buffer limits, not speed. No published
  browser speed was found for any model here. Measuring on the owner's GPU and on an integrated GPU is the first Phase 4
  task (as AI_MODELS.md also says).

---

## Excluded and why

| Model | Reason | Evidence |
|---|---|---|
| **Stable Diffusion 1.5 inpainting** (runwayml) | CreativeML OpenRAIL-M: use restrictions in Attachment A ("You agree not to use the Model or Derivatives of the Model: …"), which must be imposed on every user (paragraph 5) | [CompVis LICENSE](https://github.com/CompVis/stable-diffusion/blob/main/LICENSE). Runway's own repo LICENSE returned 404. That the inpainting checkpoint carries the same licence is from its HF card (**unverified**; HF blocked) |
| **Stable Diffusion 2 inpainting** | CreativeML Open RAIL++-M per Azure/Replicate listings (search results; the HF card and Stability's `stablediffusion` repo could not be read). The RAIL++-M text has the same Attachment A pattern: "The restrictions set forth in Attachment A are considered Use-based restrictions" | Same pattern verified in [LICENSE-SDXL1.0](https://github.com/Stability-AI/generative-models/blob/main/model_licenses/LICENSE-SDXL1.0) |
| **SDXL inpainting** | CreativeML Open RAIL++-M (SDXL base licence, above); the inpainting checkpoint's own card is unverified | as above |
| **FLUX.1 Fill [dev]** | "FLUX.1 [dev] Non-Commercial License … solely for your Non-Commercial Purposes", and the licence names "FLUX.1 Fill [dev]" | [LICENSE-FLUX1-dev](https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-dev) |
| **MAT** (Mask-Aware Transformer) | CC BY-NC 4.0 ("Attribution-NonCommercial 4.0 International") | [LICENSE](https://github.com/fenglinglwb/MAT/blob/main/LICENSE) |
| **Co-Mod-GAN** | Bundles StyleGAN2 under "Nvidia Source Code License-NC" | [LICENSE.txt](https://github.com/zsyzzsoft/co-mod-gan/blob/master/LICENSE.txt) |
| **FcF-Inpainting** | Apache-2.0 "except for the third-party components listed below": "stylegan2-ada-pytorch is released under the NVIDIA Source Code License" | [LICENSE](https://github.com/SHI-Labs/FcF-Inpainting/blob/main/LICENSE) |
| **Kandinsky 2.2 / 3 inpainting** | Licence OK (Apache-2.0 repos), but billions of parameters and LAION-scraped training data; not browser-sized | [Kandinsky-2 README](https://github.com/ai-forever/Kandinsky-2), [Kandinsky-3 README](https://github.com/ai-forever/Kandinsky-3) |
| **SingleHDR** | No licence file | `LICENSE` 404 on `alex04072000/SingleHDR` master |
| **BRIA RMBG-2.0** (and 1.4 pending its card) | Non-commercial weights | [BiRefNet README](https://github.com/ZhengPeng7/BiRefNet) ("for only non-commercial use") |
| **EdgeSAM** | S-Lab License 1.0, non-commercial | [LICENSE](https://github.com/chongzhou96/EdgeSAM/blob/master/LICENSE) |
| **SAM 3 / 3.1** | SAM License: field-of-use (ITAR/military) limits, no reverse engineering (owner's rule) | AI_MODELS.md |
| **Depth Anything V2 Base/Large/Giant**, DA3 GIANT/LARGE/NESTED | CC-BY-NC-4.0 | DA2 / DA3 READMEs |
| **Apple Depth Pro** | Apple sample-code licence: "personal" licence, no patent rights | [LICENSE](https://github.com/apple/ml-depth-pro/blob/main/LICENSE) |
| **UniDepth** | CC BY-NC 4.0 | [LICENSE](https://github.com/lpiccinelli-eth/UniDepth/blob/main/LICENSE) |
| **Marigold** | OpenRAIL++-M (use restrictions) | [LICENSE-MODEL.txt](https://github.com/prs-eth/Marigold/blob/main/LICENSE-MODEL.txt) |
| **Boosting Monocular Depth** (depth refinement) | "This software is for academic use only" | [LICENSE](https://github.com/compphoto/BoostingMonocularDepth/blob/main/LICENSE) |
| **EBB! / PyNET-Bokeh** (learned bokeh) | CC BY-NC-SA 4.0 | [PyNET-Bokeh README](https://github.com/aiff22/PyNET-Bokeh) |
| **Held, not excluded:** Metric3D (weights terms unstated), MoGe-2 (weights card unverified), DA2 Metric-Small (licence unclear, VKITTI2 data), Santos et al. HDR (weights unstated) | — | see sections 1–2 |

---

## Owner's decisions so far (2026-10-13)

- **GPL-3.0 weights** (RawNIND for AI Denoise): to be decided when Phase 4 starts.
- **RawNIND (2026-10-13, after the Cowork report and the groundwork in [PHASE4_GROUNDWORK.md](PHASE4_GROUNDWORK.md)):** accepted under **GPL-3.0**. Its weights are offered as an optional download with credit given. Under either reading of "dual licensed GPL3 + CC-BY-4.0" GPL-3.0 use is allowed, and LightBench is itself GPL-3.0, so the author is not being asked. This is the one exception to the permissive-only rule for models. Not a legal opinion.
- **AI denoise order (2026-10-13):** RawNIND first, as the opt-in AI Denoise; measure it against the profiled denoise on the owner's photos; train our own ([DENOISE_TRAINING_PLAN.md](DENOISE_TRAINING_PLAN.md)) only if RawNIND falls short on browser speed or size, or on the owner's cameras.
- **RawNIND training-data check (2026-10-14, after Cowork batch 2):** an independent check found that RawNIND's clean "extraraw" set is rebuilt from all of raw.pixls.us without a licence filter, so the released weights may include CC BY-NC-SA images [unverified]; the Dataverse licence is still unread ([cowork-2026-10-13b/G_DENOISE_TRAINING_DATA.md](cowork-2026-10-13b/G_DENOISE_TRAINING_DATA.md)). **Owner's decision:** keep "RawNIND first", but verify its training data (Dataverse licence, and the author if needed) before integrating it, and decide then.
- **Training-data rule clarified (2026-10-14, after Cowork batch 3):** for downloaded models, "training-data provenance must be known" means the training data is **publicly disclosed (named)**. Weights must still be permissive. Non-commercial or research-only terms on disclosed training sets don't disqualify permissive weights. This is the owner's policy, not a legal opinion. Under this rule, per [cowork-2026-10-14-batch3/](cowork-2026-10-14-batch3/INDEX.md):
  - **Pass:** Depth Anything V2 Small (Apache-2.0; data named, including SA-1B and vKITTI2) and BlazeFace full-range (Apache-2.0, "consented images").
  - **Fail:** DINOv2 (LVD-142M undisclosed), DINOv3 (custom licence with use bans), MediaPipe Selfie Multiclass (no data source stated) and LAION-trained OpenCLIP (its own card excludes deployment).
  - **Depth Anything 3:** MONO-LARGE (student images undisclosed) and METRIC-LARGE (Waymo terms name trained models) are excluded.
  - **Sky:** no small permissive sky model exists, so Masking's sky starts non-AI.
- **RawNIND: one-off exception to the training-data rule (owner, 2026-10-14, after the RawNIND check in [cowork-2026-10-14-rawnind/](cowork-2026-10-14-rawnind/RAWNIND_TRAINING_DATA.md)).** The paper (arXiv 2501.08924v2, §IV-A.2) says training added "11,815 Bayer images captured with several cameras from our personal collection" (unpublished) and "561 Bayer images from numerous cameras available on the raw.pixls.us platform" (a site that mixes CC0 files with legacy CC BY-NC-SA ones; no licence filter in the gathering script). Whether the shipped darktable-ai checkpoints (2024-02-21, 2024-10-09) used that data is not proven: the per-run `args.yaml` in the author's Google Drive and the Dataverse terms could not be read. **Decision:** for RawNIND only, "described in the paper" counts as disclosed. The rule stays "publicly disclosed (named)" for every other model. RawNIND stays "first" for AI Denoise, under GPL-3.0. Its model notice (in the app and in THIRD_PARTY_NOTICES.md) must say, in plain words, that the weights were likely trained partly on the authors' unpublished photos and on raw.pixls.us files, some of which may carry non-commercial licences. Still open, not blocking: the Dataverse licence of the RawNIND pairs; a cleaner denoise-only release the author says is "planned for the relatively near future" (watch for it; prefer it if it drops the extra data). Not a legal opinion.
- **AI Remove: Moebius as the best-quality option (owner, 2026-10-17, after [cowork-2026-10-17-ai-remove/](cowork-2026-10-17-ai-remove/AI_REMOVE_MODELS.md)).**
  - **Model:** Moebius (HUST + vivo; UNet 226 M params) as an optional best-quality AI Remove. Its weights: "Both the code and the pretrained model weights of Moebius are released under the Apache License 2.0" (GitHub README; LICENSE "Copyright 2024 Moebius Authors"); its Hugging Face card is tagged MIT with no licence file. Shipped under Apache-2.0, noting the MIT tag.
  - **Second exception to the training-data rule** (after RawNIND): accepted even though not all training data is named. Facts for the model notice: the PixelHacker teacher was pre-trained on 14 M image–mask pairs from COCONut-Large, Object365V2, GoogleLandmarkV2 and "a natural scene dataset (7.49M images) that we curated and collected" (unnamed, about half the images), then fine-tuned on Places2, CelebA-HQ and FFHQ; Moebius's distillation data is not stated.
  - **VAE: the owner accepts PixelHacker's copy** (`hustvl/PixelHacker/vae`, fp16, 167 MB), as Moebius instructs, relying on its "License: mit" tag. Facts recorded: it is SDXL's VAE ("we use the pretrained SDXL-VAE", PixelHacker paper); its config matches `madebyollin/sdxl-vae-fp16-fix`; every standalone copy (PixelHacker, `stabilityai/sdxl-vae`, fp16-fix) is tagged MIT but none has a LICENSE file or copyright line; the same VAE family also ships inside SDXL base 1.0 under CreativeML Open RAIL++-M and SDXL 0.9 was under a research licence. Not a legal opinion.
  - **Delivery: LightBench's own ONNX conversion, published as GitHub Release assets** by a manually run GitHub Action (each file < 2 GiB; Releases state no bandwidth limit, but GitHub's Acceptable Use Policies allow throttling "significantly excessive" use). The app shows the size, licences and the training-data note, links to the Release, the user downloads and picks the files, the app verifies SHA-256 and caches them on the device. Each Release carries the Apache-2.0 text, "converted to ONNX by LightBench", and the VAE's MIT tag with its sources (`hustvl/PixelHacker`, `stabilityai/sdxl-vae`) and the note that no upstream copyright line exists.
  - **Build notes:** fp32 ≈ 1.24 GB (UNet 907 MB, VAE encoder 137 MB, decoder 198 MB, per the third-party `simonw/Moebius-ONNX`); try fp16 to cut it (the port reports fp16 VAE decoder instability). 20 DDIM steps with strength 0.99 (19 actual), 512 px, white = hole, 9-channel UNet input, class-id CFG with three conflicting upstream defaults (2.0, 2.5, 4.5): pick one and document it. Conv3d → Conv2d needed for Safari's WebGPU. No browser GPU timing has been published; measure.
  - **Mobile / small model: decide later.** Facts so far: MI-GAN passes the rule (weights MIT, inference path needs no NVIDIA code, trained on Places365-Standard and FFHQ, 512 ONNX ≈ 28–30 MB); LaMa's weights licence is still informal (≈ 208 MB, or 92.6 MB quantised by OpenCV); no newer small model qualifies.
- **Face / blink runtime: decide at Phase 4 (owner, 2026-10-14).** Options recorded:
  - (a) convert BlazeFace (Apache-2.0) and, if allowed, Face Landmarker to ONNX and run them in the single Phase 4 runtime on WebGPU;
  - (b) MediaPipe Tasks for Web, which is WebGL2/WASM only and has sent usage stats to Google with no opt-out since v1.1.0. It would need a pinned version, a CSP blocking the endpoint, and a privacy note.
  Either way: full-range BlazeFace first, then crop faces for landmarks; test which eye `eyeBlinkLeft` means.
- The other open questions below are taken up when Phase 4 starts. The depth-of-field approach is in [DEPTH_OF_FIELD.md](DEPTH_OF_FIELD.md); its "blur grows in front of and behind the focus plane" requirement is the owner's (2026-10-12/13).
- Sources marked unverified or "from search results" could not be opened from the build machine (the environment's network policy blocks those sites).
- **After the Cowork report (2026-10-13), no-AI Remove:** PR #36's search was reviewed against claim 1 of US 8,285,055
  and the wording of US 8,811,749 (a neighbour-derived mapping plus a perturbed mapping). It has no neighbour-derived
  step. The owner kept it as it is (2026-10-13). This is not a legal opinion.


## Open questions for the owner

1. **Training-data policy.** Accept permissively licensed weights trained on Places2 (image terms unverified),
   CelebA-HQ, DIS5K or SA-1B? The same question as for SAM 2.1 and BiRefNet in AI_MODELS.md. FFHQ-trained checkpoints
   would be avoided either way.
2. **MI-GAN's provenance.** Its weights are MIT, but it was distilled from a Co-Mod-GAN teacher, and its training code
   includes NVIDIA-licensed files. OK?
3. **LaMa's weights** have no licence statement apart from the Apache-2.0 repo LICENSE. Accept that as covering them?
   (The HF card says apache-2.0 per search; unverified.)
4. **Moebius** for a later "best quality" Remove? It needs a 1.27 GB download and WebGPU only, and its VAE licence and
   its teacher's 14 M-image training set need checking.
5. **GPL-3.0 weights** (NIND / RawNIND denoise): acceptable under "permissive only"?
6. **Where to host the models.**
   - Hugging Face, a LightBench-owned repo with commit-pinned URLs, works from browsers. Its terms for hotlinking from a
     public app were not read.
   - GitHub Pages: small models only (100 GB/month soft bandwidth).
   - GitHub Releases: not reachable from the website because of CORS, but fine for the Tauri app.
7. **Clipped-shadow fill.** Crushed shadows were *at most* the black floor, so AI there only shows when the user lifts
   the shadows. Keep both sides, as asked, or start with highlights?
8. **Patents** (facts only):
   - Apple's shallow-depth-of-field rendering patents (US 10,410,327 B2 and others; claims not read).
   - The Adobe PatchMatch patent for the no-AI Remove (PHASE3 Part 11).
   - Take advice before release?
9. **Speed.** Measure on the owner's GPU and an integrated GPU first: DA2-Small, MI-GAN 512, LaMa 512 and SAM 2.1 Tiny,
   in Chrome with WebGPU, fp16 and fp32.
