> **Provenance:** an independent research run done in Claude Cowork on 2026-10-13, written without seeing the drafts in `docs/research/`. It has not been re-verified, except where the spot-check log in [INDEX.md](INDEX.md) says so. The text below is copied unchanged.

# Part 3: AI models for Phase 4 (local, permissive licences)

*LightBench research brief, Part 3. Researched 2026-10-13 from primary sources: GitHub LICENSE files and READMEs, Hugging Face model cards and file listings, papers, Google Patents, GitHub/MDN/WebKit docs. The earlier drafts were not read. Cross-references: Part 2 (`DETAIL_DENOISE_SHARPEN.md`) for AI denoise and RawNIND; Part 4 (`DEPTH_OF_FIELD.md`) for depth models and Apple US 10,410,327; `LIGHTCRAFT_AI_NOTES.md` (another agent's notes on LightCraft) for LightCraft's model choices.*

> **How to read this.** Quotes are copied from the cited pages. The fetch tool cuts quotes at about 125 characters, so some are sentence fragments. **[unconfirmed]** = not verified from a primary source in this session. **[analysis]** / **[estimate]** = my own reasoning, not a published number. Patent entries are public facts only, not legal opinion. Google Patents' "status" and "anticipated expiration" are Google's own estimates, which it labels "an assumption and is not a legal conclusion".

---

## Decisions this changes

| Current decision | Verdict | Reasoning (one line) | Key source |
|---|---|---|---|
| **MI-GAN** for fill/Remove | **Supports** (with caveats) | Code **and** weights are MIT (separate `LICENSE-WEIGHTS` file); 5.98 M params; official 28.1 MB ONNX pipeline; a GPL-3.0 browser app already runs it on WebGPU/wasm. Caveats: training data (Places365, FFHQ is BY-NC-SA) and NVIDIA-notice files in the training code (not needed for ONNX inference). | `Picsart-AI-Research/MI-GAN` LICENSE, LICENSE-WEIGHTS; ICCV 2023 paper; `lxfater/inpaint-web` |
| **LaMa optional** | **Mixed** | Code is Apache-2.0, but upstream states **no separate weights licence** (only third-party HF mirrors are tagged apache-2.0). Big-LaMa ONNX is 208 MB fp32, fixed 512×512, about 8× MI-GAN's FLOPs at 512. **Moebius** (Apache-2.0 code and weights, June 2026) is a new rival for the "optional HQ" slot. | `advimman/lama` LICENSE/README; `Carve/LaMa-ONNX`; `hustvl/Moebius` README |
| **SAM 2.1 Tiny** | **Supports** (training-data caveat) | "The SAM 2 model checkpoints … are licensed under Apache 2.0"; Tiny is 38.9 M params; ONNX fp16 encoder 67 MB + decoder 10.5 MB exists. Training mix includes SA-1B, which is "Research purposes only". | `facebookresearch/sam2` README; `onnx-community/sam2.1-hiera-tiny-ONNX`; arXiv 2408.00714 |
| **BiRefNet** | **Mixed** | Code and HF weights are MIT, so the licence passes. But full BiRefNet is "0.2B params" (490 MB fp16 ONNX) and needs ONNX graph surgery to run on WebGPU; **BiRefNet_lite** (44.4 M, 115 MB fp16) is the realistic browser pick. DIS5K's terms PDF could not be read (robots-blocked). | HF `ZhengPeng7/BiRefNet*`; `onnx-community/BiRefNet*-ONNX`; `runes/birefnet-lite-webgpu` |
| **RawNIND undecided (GPL)** | **Mixed (new fact, from Part 2)** | Upstream: "The weights are dual licensed GPL3 + CC-BY-4.0"; darktable-ai's card lists only GPL-3.0; LightCraft's manifest also says GPL-3.0. Ask the author whether CC-BY-4.0 alone may be chosen. | Part 2 §(d); `LIGHTCRAFT_AI_NOTES.md` |
| **No-AI Remove reworked to avoid PatchMatch random search and propagation** | **Supports** (with a wording fact) | US 8,285,055 is listed **Active, anticipated expiry 2031-04-09**; its claim 1 recites a neighbour-derived mapping phase **and** a phase "obtained by perturbing" a mapping. The word "random" appears only in dependent claims 12 and 20. Continuation US 8,811,749 (Active, to 2029-04-27) recites "propagating" and "perturbing". So the rework should avoid *any* perturbation-plus-propagation iteration, not just randomness. Facts only. | Google Patents US8285055B1, US8811749B1 |

---

## Summary

For **inpainting** (clipped-highlight fill and AI Remove), **MI-GAN** remains the best fit: MIT code, MIT weights, about 6 M parameters, an official ONNX pipeline that crops around the hole and blends the result back, and an existing GPL-3.0 browser precedent. **LaMa** is licence-clean only through its Apache-2.0 code licence; upstream gives no separate weight terms. Its available ONNX is also about seven times larger (208 MB vs 28 MB) and fixed at 512×512. **Moebius** (HUST, released 2026-06-18) exists and states "Both the code and the pretrained model weights of Moebius are released under the Apache License 2.0". It is a 226 M-parameter latent model whose VAE is downloaded from PixelHacker, and it has no browser port; it is a later "HQ" candidate. Every diffusion option checked fails the owner's rule (SD = OpenRAIL-M/++ use restrictions; FLUX.1 Fill = non-commercial) or is far too large (Kandinsky 2.2, Apache-2.0, 1B+). For **masking**, **SAM 2.1 Tiny** (Apache-2.0 checkpoints) for click-to-select plus **BiRefNet_lite** (MIT) for one-click subject is the right pair. BRIA RMBG, EdgeSAM, SegFormer and MAT are excluded on licence grounds. Sky masks have only weak permissive options: U²-Net-based sky weights with MIT tags but no documented training data. **ProRAW** DNGs carry semantic masks (DNG 1.6 tags `SemanticName` 0xCD2E, `SemanticInstanceID` 0xCD30, `MaskSubArea` 0xCD38), which LightBench can read for free on iPhone files. For **delivery**, small models can be served same-origin from GitHub Pages (1 GB site, 100 MiB per git file, soft 100 GB/month). Larger optional models fit Hugging Face, which transformers.js fetches cross-origin by default. **GitHub Release assets lack CORS** according to an open community bug. For **WebGPU**, the spec default storage binding is 128 MiB, but about 91% of surveyed devices report at least 1 GiB, and `shader-f16` is at about 94%. Plan an fp32 fallback, and watch for fp16 overflow and bindings-per-stage limits in ONNX Runtime Web.

---

## 1. Clipped highlight / shadow fill

### 1.1 Comparison table (inpainting engines usable for fill)

| Candidate | Weights licence | Code licence | Training data | Params / size | Input res | Runtime / speed | Quality limits | Patents |
|---|---|---|---|---|---|---|---|---|
| **MI-GAN** (Picsart, ICCV 2023) | **MIT**: `LICENSE-WEIGHTS` "MIT License", "Copyright (c) 2024 Picsart AI Research (PAIR)". HF `andraniksargsyan/migan`: "License: mit" | **MIT**: "Copyright (c) 2024 Picsart AI Research (PAIR)". But `torch_utils/` and `dnnlib/` carry "Copyright (c) 2021, NVIDIA CORPORATION" and "without an express license agreement from NVIDIA CORPORATION is strictly prohibited" (training code only) | Places365-Standard: "Places365-Standard subset, which contains ∼ 1.8 million images"; FFHQ (60k) for the face model. Distilled from a Co-Mod-GAN teacher | 5.98 M (512) / 5.95 M (256); 15.69 GFLOPs at 512. ONNX: `migan_pipeline_v2.onnx` 28.1 MB, `migan.onnx` 29.5 MB (fp32). fp16/int8: none published | Fixed 256 or 512 inside the graph; the pipeline takes any H×W uint8 and crops a square box around the hole | Paper: mobile **CPU** 256 px, e.g. iPhone 14 Pro Max "296.00" ms, Galaxy S8 "1476.40" ms. No published WebGPU number. Browser precedent: inpaint-web, "powered by webgpu and wasm on the browser" | 8-bit sRGB in/out; large holes are filled from a 512² crop then upscaled, so they go soft **[analysis]** | None found specific to MI-GAN **[not exhaustively searched]** |
| **LaMa / Big-LaMa** (Samsung, 2021) | **Not stated upstream.** Third-party mirrors: HF `smartywu/big-lama` "License: apache-2.0"; `Carve/LaMa-ONNX` "License: apache-2.0" | **Apache-2.0**: "Copyright [2021] Samsung Research" | Places365-Challenge for Big-LaMa: "Places365-Challenge: Train(476GB) … (to train Big-Lama)"; CelebA-HQ for the face model | MI-GAN paper lists LaMa at "27.05" M and 128.06 GFLOPs at 512. Carve ONNX `lama_fp32.onnx` 208 MB, which implies about 52 M fp32 params (Big-LaMa) **[analysis]** | Carve ONNX: "The input shape is fixed at 512x512 pixels." | No published browser timing. Uses FFT (Fourier convolutions); ORT WebGPU lists `DFT` as supported (opset 17+) | Strong on large holes and repetitive structure (FFC). 8-bit sRGB | None found **[not exhaustively searched]** |
| **Moebius** (HUST `hustvl`, 2026) | **Apache-2.0** (GitHub README): "Both the code and the pretrained model weights of Moebius are released under the Apache License 2.0"; "Commercial use of the weights and the images produced with them is permitted." HF `hustvl/Moebius` tag: "License: mit" (**inconsistent tags, both permissive**) | Apache-2.0 | **Not stated.** Teacher is PixelHacker ("from our PixelHacker (teacher) strictly within the latent space"). Separate `ft_ffhq` weights were fine-tuned on FFHQ (BY-NC-SA dataset) | "0.22B (226M) parameters"; HF repo total 3.62 GB (four variants). VAE: downloaded from `hustvl/PixelHacker`; config name `PixelHacker_sdvae_f8d4` suggests an SD-style f8/4-channel VAE **[unconfirmed]**. PixelHacker HF tag "License: mit" | 512×512 in the published speed test | "26.01 milliseconds per step" on an NVIDIA L40S (Gigazine report of the paper); step count not stated. No ONNX or browser port | Latent diffusion-style: generative, can invent objects. Paper claims "10B-level performance" **[not verified]** | None found |
| **Co-Mod-GAN** | Not stated (Google Drive) | **Mixed**: permissive part (Zhao et al. 2020) **plus** "Nvidia Source Code License-NC": "The Work and any derivative works thereof only may be used or intended for use non-commercially." | Places365-Challenge, FFHQ | "79.79" M at 512 (MI-GAN paper) | 512 | None | Large | — | **Excluded** (NC code) |
| **FcF** (SHI Labs) | Not stated | Apache-2.0 **plus** bundled "NVIDIA Source Code License for StyleGAN2 with Adaptive Discriminator Augmentation (ADA)": "only may be used or intended for use non-commercially" | Places2, CelebA-HQ (25 M images seen) | — | 256/512 | None | — | **Excluded** (NC code in repo) |
| **MAT** | "The code and models in this repo are for research purposes only." | Same | Places (8 M), CelebA-HQ, FFHQ | — | multiples of 512 | — | — | **Excluded** |
| **SD 1.x / 2.x / XL inpainting** | CreativeML **OpenRAIL-M** (1.x) / **OpenRAIL++-M** (2.x, XL): "The restrictions set forth in Attachment A are considered Use-based restrictions." | — | LAION | ~0.9–3.5 B **[unconfirmed]** | 512–1024 | Impractical in browser | Generative | **Excluded** (RAIL) |
| **FLUX.1 Fill [dev]** | "flux-1-dev-non-commercial-license"; gated | — | — | 12B | — | — | — | **Excluded** (NC). FLUX.1 [schnell] is "apache-2.0" but **no schnell Fill variant** is listed on its card |
| **Kandinsky 2.2 inpaint** | "License: apache-2.0" | — | — | decoder "1B params" (plus prior) | 768 | Far too large for browser **[analysis]** | Generative | Passes licence; impractical |
| **HDRCNN** (Eilertsen 2017; single-image highlight reconstruction) | **Not stated** (`hdrcnn_params.npz`) | BSD-3: "The code is distributed under a BSD license." | Not specified | — | 8-bit LDR input | — | Trained to reconstruct "image regions where information has been lost due to sensor saturation"; display-referred, not raw | — |
| **SingleHDR** (Liu 2020) | Not stated | **No licence found** on the repo page | HDR-Synth, HDR-Real, RAISE, HDR-Eye (terms not stated) | — | LDR | — | — | Not usable until licensed |

### 1.2 Workflow (owner's design), with notes

1. **Recover first.** LightBench's existing darktable-derived highlight reconstruction recovers anything that one or two channels still hold. **[analysis]** The AI mask should be "all three channels at or above the clip point *after* recovery", i.e. only where nothing is left.
2. **Buffer slider.** Dilate the "nothing left" mask by N px. The same slider can extend into fringe areas that recovery reconstructed poorly (magenta/cyan fringes). MI-GAN's pipeline already dilates the mask 3×3 and Gaussian-feathers it (5×5, σ 1.0) before compositing (`create_onnx_pipeline.py`). LightBench should do its own feathering in linear light and feed MI-GAN a hard mask **[analysis]**.
3. **Preview before Go.** Show the clipped mask (and the buffer ring in a second colour) as an overlay. This is cheap (a threshold pass) and needs no model.
4. **Output.** Write the generated pixels to a separate, removable layer flagged "generated" in the sidecar, and store the model ID + SHA-256 so old edits can be reproduced (process-version rule) **[analysis]**.
5. **What makes clipped fill different from Remove [analysis]:**
   - In a clipped area the *brightness is known to be at least the clip level*, and opposed-channel recovery often gives a hue estimate. The fill can be **constrained**: inpaint on a tone-mapped copy, convert back to linear, then lift any generated pixel that falls below the clip threshold. Remove has no such bound.
   - Clipped regions are usually smooth (sky, specular, lamps). The model should *continue gradients*, not invent objects, which favours small GAN/FFC models (MI-GAN, LaMa) over diffusion (Moebius), which may hallucinate clouds or texture.
   - MI-GAN and LaMa are trained on 8-bit sRGB photos. LightBench must tone-map the crop to display range (e.g. the sigmoid), inpaint, then invert the tone map. The inversion is ill-conditioned near white, so the clip-level constraint above matters.
6. **Shadow fill: worth doing? [analysis]** Not as a generative fill. In raw files, shadows are rarely "empty": values at the black level still carry signal plus noise, and the real problem is noise, which Part 2's AI denoise addresses. A true "nothing left" shadow (crushed to black in the camera's own processing) is uncommon in raw and is usually intended (silhouettes). Generating content there invents scene detail the photographer never captured. Recommendation: offer **shadow noise reduction / denoise**, not shadow fill. Revisit only if users ask.

### 1.3 Pick: clipped fill

**MI-GAN 512 (Places2)**, run on a tone-mapped crop with the clip-level constraint, on a removable "generated" layer. It is the only candidate with explicit permissive *weights* terms, a tiny download (28 MB), and a browser precedent. LaMa stays an optional "large hole" engine *only if* the owner accepts weights covered solely by the repo's Apache-2.0 licence.

---

## 2. Masking

### 2.1 Comparison table

| Candidate | Weights licence | Code licence | Training data | Params / size | Input res | Runtime / speed | Quality limits | Patents |
|---|---|---|---|---|---|---|---|---|
| **SAM 2.1 Hiera-Tiny** | "The SAM 2 model checkpoints, SAM 2 demo code (front-end and back-end), and SAM 2 training code are licensed under Apache 2.0". HF `facebook/sam2.1-hiera-tiny`: "apache-2.0" | Apache-2.0 | "Our released model is trained on SA-V manual + Internal and SA-1B"; mix "∼15.2% SA-1B, ∼70% SA-V and ∼14.8% Internal". SA-V: "CC BY 4.0". SA-1B: "Research purposes only" | "38.9" M. `onnx-community/sam2.1-hiera-tiny-ONNX`: encoder fp32 134 MB, **fp16 67 MB**, int8 52.6 MB, q4f16 28.5 MB; decoder fp16 10.5 MB, int8 8.66 MB | 1024 **[unconfirmed]** | "91.2" FPS on "an A100 with torch 2.5.1, cuda 12.4". WebSAM runs SAM 2.1 Tiny–Large "entirely in-browser via WebGPU + ONNX" (no timings) | Click/box prompts; no semantic classes; video memory not needed for stills | — |
| SAM 2.1 Small / Base+ / Large | Apache-2.0 (same sentence) | Apache-2.0 | as above | "46" / "80.8" / "224.4" M | 1024 | "84.8" / "64.1" / "39.5" FPS (A100) | Better edges with size | — |
| **SAM 1** (ViT-B/L/H) | "The model is licensed under the Apache 2.0 license." | Apache-2.0 | SA-1B ("Research purposes only") | ViT-H encoder "632M" (MobileSAM README) | 1024 | Heavy | Superseded by SAM 2.1 | — |
| **MobileSAM** | Apache-2.0 (repo sidebar; README states none) | Apache-2.0 | Distilled from SAM (SA-1B) | Encoder "Tiny-ViT (5M)" | 1024 | "8ms" encoder + "4ms" decoder on one GPU (unnamed); about 3 s on a Mac i5 CPU | Lower quality than SAM 2.1 | — |
| **EfficientSAM** (Ti/S) | Apache-2.0 (repo sidebar; README states none) | Apache-2.0 | SA-1B-derived **[unconfirmed]** | Not stated on README | 1024 **[unconfirmed]** | ONNX encoder/decoder published | — | — |
| **SlimSAM** (-50/-77) | Apache-2.0 (repo sidebar) | Apache-2.0 | "0.1\% (10k)" of SAM data | "9.1M" (overall figure); WebSAM's SlimSAM-77 int8 is 14 MB | 1024 | transformers.js support announced 2024-01-10; WebSAM uses it as the WASM fallback | Coarser masks | — |
| **EdgeSAM** | "NTU S-Lab License 1.0": "Redistribution and use for non-commercial purpose in source and binary forms" | same | — | 9.6 M | — | "38.7" FPS iPhone 14 | — | **Excluded** (NC) |
| **BiRefNet** (general, Swin-L) | HF `ZhengPeng7/BiRefNet`: "License: mit" | MIT: "Copyright (c) 2024 ZhengPeng" | General model: DIS5K-TR, DIS-TEs, DUTS-TR_TE, HRSOD, UHRSD, HRS10K, TR-P3M-10k, TE-P3M-500, TR-humans. **DIS5K terms PDF: robots-blocked, not read.** P3M-10k: "Agreement (MIT License)" per its README | "0.2B params"; ONNX fp32 973 MB, **fp16 490 MB** | 1024×1024 | README: ONNX SwinL "~165ms on an A100"; "5.5G" memory for 1024 | Best dichotomous edges (hair-level) | — |
| **BiRefNet_HR / HR-matting / matting** | each HF card: "mit" | MIT | HR: 2048 training; matting: P3M-10k, AM-2k, AIM-500, Distinctions-646, etc. (terms not checked) | "0.2B params" each | 2048×2048 (HR) | Heavier still | Matting = soft alpha | — |
| **BiRefNet_lite** (Swin-T) | HF `ZhengPeng7/BiRefNet_lite`: "mit"; `onnx-community/BiRefNet_lite-ONNX`: "License: mit" | MIT | Same general mix | "44.4M params"; ONNX fp32 224 MB, **fp16 115 MB** | 1024×1024 | transformers.js `image-segmentation` pipeline. Third-party WebGPU port: "~700 ms/frame warm at 1024×1024" on RTX 4090, Chrome, ORT-web 1.27, after graph surgery | Slightly lower metrics than Swin-L (README: S 0.882 vs 0.911 on DIS-VD) | — |
| **IS-Net / DIS** | Not stated; `isnet-general-use.pth` "for general use" | "Our code and evaluation metric use Apache License 2.0." | DIS5K (terms PDF not readable) | — | 1024 | — | Older than BiRefNet | — |
| **U²-Net / U²-NetP** | Not stated | Apache-2.0 (repo sidebar) | DUTS-TR | "176.3 MB" / "4.7 MB" | 320 | Light | Saliency, soft edges | — |
| **BRIA RMBG-1.4 / 2.0** | 1.4: "a Creative Commons license for non-commercial use"; 2.0: "CC BY-NC 4.0 license for non-commercial use" | — | BRIA "fully licensed" images | 44.1 M / ~0.2 B | 1024 | — | — | **Excluded** (NC) |
| **MediaPipe Selfie Multiclass** | Model card: "Apache License, Version 2.0" | Apache-2.0 (samples) | "thousands of samples with diverse identities" | small (float32 TFLite) | 256×256 | MediaPipe Tasks Web (WASM/WebGL) | Six classes: "background, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 others"; low res, selfie framing; "not intended for … applications that require pixel perfect masks" | — |
| **Sky: U²-Net sky weights** (xiongzhu666) | Repo "MIT license"; HF conversions `twistlabs/fotometis-sky` (2.5 MB, 384²) and `chili-raw` (512², "MIT") | MIT | **Not specified** | 167 MB full ONNX (Baidu); 2 MB demo model | 384–512 | Light | Unknown data; the full high-precision model "isn't public" | — |
| **Sky: SegFormer-B2 sky/water/person** (`Realcat/skywater_seg`) | HF "License: mit" | — | **ADE20K**: "Researcher shall use the Database only for non-commercial research and educational purposes." Base SegFormer code: "NVIDIA Source Code License for SegFormer" ("research or evaluation purposes only") | 24.7 M; ONNX fp16 48 MB | 384² | — | — | **Excluded in practice** (NC base model and data) |

**LightCraft cross-reference** (from `LIGHTCRAFT_AI_NOTES.md`, attributed to that agent's reading of `storytold/lightcraft`): LightCraft uses **SAM 3** only as a user-downloaded model under "Meta's SAM License … a separate, non-OSI licence", and does Select Subject/Sky/Background with a "saliency heuristic, no segmentation model". Its ROADMAP says "No permissively licensed sky-segmentation or raw-denoise model was found." This supports LightBench's SAM 3 exclusion and the finding that permissive sky models are weak.

### 2.2 Apple ProRAW semantic mattes (free masks on iPhone files)

- **What is stored.** Apple (WWDC21 session 10160): "we store semantic masks in the ProRAW for regions such a people, skin, and sky"; "the inclusion of these mattes is automatic and scene dependent." Core Image exposes `auxiliarySemanticSegmentation{Glasses,Hair,Skin,Sky,Teeth}Matte` plus `auxiliaryPortraitEffectsMatte` (Apple `CIImageOption` docs). Which of these a given ProRAW DNG holds: **[unconfirmed]**, scene-dependent.
- **DNG 1.6 tags** (exiv2 tag reference):
  - `0xcd2e` (52526) **SemanticName**: "A string that identifies the semantic mask."
  - `0xcd30` (52528) **SemanticInstanceID**: "A string that identifies a specific instance in a semantic mask."
  - `0xcd38` (52536) **MaskSubArea**: "This tag identifies the crop rectangle of this IFD's mask, relative to the main image."
  - Library of Congress (DNG 1.6 format page): semantic masks live in IFDs with NewSubFileType "65540 (10004.H)" and PhotometricInterpretation "52527 (CD2F.H)"; "Each semantic mask IFD should include a SemanticName tag with a unique string that identifies the purpose of the mask."
- **How to read it in LightBench [analysis]:** walk IFD0's SubIFDs and pick those with NewSubFileType 65540. Read `SemanticName` (and `SemanticInstanceID` for per-person masks), decode the 8-bit mask, and place it with `MaskSubArea`, scaled to the raw's default crop. The exact SemanticName strings Apple writes were **not confirmed**. ExifTool's forum shows Apple's aux-type URN style "urn:com:apple:photo:2019:aux:semanticskinmatte" and says some auxiliary images "seem to be stored in JPEG format". The Adobe DNG 1.7.1 spec PDF was **robots-blocked**, so the compression type is unverified.

### 2.3 Pick: masking

- **Click-to-select / object:** **SAM 2.1 Tiny**, fp16 encoder (67 MB) + fp16 decoder (10.5 MB), with SlimSAM-77 int8 (14 MB, WASM) as the no-WebGPU fallback, as WebSAM does. Encode once per image and cache the embedding.
- **Select Subject / Background (one click):** **BiRefNet_lite** fp16 (115 MB). Keep full BiRefNet / BiRefNet_HR as an optional "high quality" download for desktop GPUs.
- **People parts:** MediaPipe Selfie Multiclass (Apache-2.0) as a quick first version. It is low-res (256²), so refine edges with BiRefNet/guided filter **[analysis]**.
- **Sky:** use **ProRAW masks when present**. Otherwise **[analysis]** combine a classical sky prior (top-connected, bright, low-texture, blue-ish in linear) with SAM 2.1 Tiny auto-prompts, and refine with a guided filter. Do not ship SegFormer/ADE20K models. The MIT-tagged U²-Net sky weights have no documented training data, so flag them as an owner decision.

---

## 3. AI Remove (object removal brush)

### 3.1 Comparison table

The same engines as §1.1, re-ranked for Remove:

| Candidate | Weights / code licence | Size | Fits Remove? | Notes |
|---|---|---|---|---|
| **MI-GAN 512** | MIT / MIT | 28.1 MB ONNX | **Yes (default)** | Good on small/medium objects; fixed 512 crop limits big holes |
| **LaMa (Big-LaMa)** | Not stated (mirrors: apache-2.0) / Apache-2.0 | 208 MB fp32 ONNX | Yes (optional) | Better large-hole structure (FFC); fixed 512; no browser timing |
| **Moebius** | Apache-2.0 (README) / Apache-2.0; HF tag mit | 226 M params + PixelHacker VAE; ~0.45 GB fp16 for the denoiser alone **[estimate: 226 M × 2 bytes]** | Later (HQ) | No ONNX port; multi-step; generative. Training data undisclosed |
| **Classical (no-AI) Remove** | own code | 0 | Yes | Must avoid the PatchMatch claim elements (see §5) |
| SD / FLUX Fill / MAT / Co-Mod-GAN / FcF | RAIL / NC | — | No | Excluded (see §7) |

### 3.2 How Remove differs from clipped fill [analysis]

| | Clipped fill | Remove |
|---|---|---|
| What's under the mask | Real scene, brightness ≥ clip, hue partly known | Unknown (an object is hiding it) |
| Constraint available | Lower bound on luminance; recovered-channel hints | None, except context |
| Desired behaviour | Continue smooth gradients; no new objects | Plausible background; structure continuation |
| Mask source | Automatic (threshold + buffer) | User brush (+ SAM 2.1 to snap to the object) |
| Colour space issue | Must work near/above white (tone-map → inpaint → invert) | Mid-tones; a display-referred model is fine on a tone-mapped crop |
| Shadow/reflection of object | n/a | Users expect the object's shadow removed too, so the mask must include it (SAM won't) |

### 3.3 Pick: AI Remove

**MI-GAN by default; LaMa as an optional "large object" engine (owner decision on weights terms); Moebius tracked for later.** Use SAM 2.1 Tiny to snap the brush to the object, then dilate the mask by a few pixels.

---

## 4. AI denoise

See **Part 2**. In short: permissive RGB options are NAFNet (MIT), Restormer (MIT) and SCUNet (Apache-2.0). RawNIND UtNet2 is darktable 5.6's default, with weights "dual licensed GPL3 + CC-BY-4.0" upstream and GPL-3.0 on darktable-ai's card and in LightCraft's manifest. LightCraft downloads `rawdenoise-nind.dtmodel` (57,700,134 bytes) only "after the user accepts its terms" (`LIGHTCRAFT_AI_NOTES.md`).

---

## 5. Patents to note (facts only)

| Patent | Assignee | Status / anticipated expiry (Google) | Gist of claim 1 (verbatim fragments) |
|---|---|---|---|
| **US 8,285,055 B1** "Determining correspondence between image regions" (Barnes, Goldman, Shechtman) | Adobe Inc. (orig. Adobe Systems) | **Active**; **2031-04-09** (adjusted). Filed 2009-02-27; priority 2008-09-10; granted 2012-10-09. Maintenance-fee events not shown **[unconfirmed]** | "performing iterative evaluations of the first and second regions, each iterative evaluation including at least"; "(i) a first evaluation phase selecting a best mapping for the first patch, according to a distance metric,"; "the best mapping selected from among the first mapping and a second mapping"; "obtained from mappings of nearby pixels, and"; "(ii) a second evaluation phase selecting one of the best mapping and a third mapping"; "obtained by perturbing the second mapping". Independent claims 1 and 22. **Claim 1 recites both a neighbour-derived (propagation-like) phase and a perturbation phase; "random" appears only in dependent claims 12 and 20.** |
| **US 8,811,749 B1** (continuation, same title and inventors) | Adobe | **Active**; **2029-04-27**. Filed 2012-09-10; granted 2014-08-19 | "propagating the identified mapping to a second patch to generate a propagated mapping"; "perturbing the propagated mapping to generate a perturbed mapping"; "assigning one of the propagated mapping and the perturbed mapping to the second patch". Independent claims 1, 7, 13 |
| US 8,407,575 B1 "Video content summary" (parent; 8,285,055 is a CIP of it) | Adobe | Active; 2031-08-14 | Zoomable video-summary layouts and animation; not inpainting |
| **US 8,818,135 B1** "Low memory content aware fill" (Goldman, Shechtman) | Adobe | **Active**; **2033-02-23**. Priority 2012-02-22; granted 2014-08-26 | From the summary (claims not read in full): low-res copy with a matching hole → find source patches there → map their locations to the full-res image and load only those patches → fill. Fragment: "identifying at least one first-image source patch in the first image based on a location" |
| US 12,136,199 B2 "Automatic synthesis of a content-aware sampling region for a content-aware fill" | Adobe **[from search-result title]** | **Page did not load** (permission timeout) | **[unconfirmed]** |
| **Wexler/Shechtman/Irani 2007 space-time completion** | — | **No patent found** in a Google Patents–restricted search **[not exhaustive]**. Related: **US 8,542,908 B2** "Bidirectional similarity of signals" (Simakov, Irani, Caspi, Shechtman), Yeda Research, **Active, 2030-05-09**. It cites Wexler et al. and says its coherence term "is similar to the objective function optimized in the data completion work". Its claim 1 was not read (abstract: "matching at least some patches of the first signal with patches of the second signal for data completeness") | — |
| **Apple US 10,410,327** "Shallow depth of field rendering" | Apple Inc | Active; 2038-05-25 | See Part 4 §1.5 (blur-map-weighted gather; random sampling only in dependent claim 3) |

No patents were found on MI-GAN, LaMa, SAM 2 or BiRefNet in this session (not searched exhaustively).

---

## 6. Model delivery

### 6.1 Comparison table

| Host | Size limits (quoted) | Bandwidth / rate | Cross-origin (CORS) | Terms relevant to LightBench |
|---|---|---|---|---|
| **GitHub Pages** (same origin) | "Published GitHub Pages sites may be no larger than 1 GB." No per-file limit stated on the Pages page. The Git limit "GitHub blocks files larger than 100 MiB" applies to repo-sourced files (a 50 MiB push warning) | "a *soft* bandwidth limit of 100 GB per month"; "rate limits may apply" (HTTP 429); deploy timeout 10 min | Same origin, so no CORS needed | "not intended for or allowed to be used as a free web-hosting service to run your online business," … "or providing commercial software as a service (SaaS)." A free GPL app is not that **[analysis]** |
| **GitHub Releases** | "Each file included in a release must be under 2 GiB."; "Up to 1000 release assets" | "There is no limit on the total size of a release, nor bandwidth usage." | **Evidence says no.** Community discussion #45446 (Bug, opened 2023-01-26, "Unanswered"): "the release assets download bucket do not support CORS". Workarounds posted: Cloudflare Worker proxy; Action copying assets to a repo served raw | — |
| **Hugging Face Hub** | Not checked | Resolvers ("URLs that contain a `/resolve/` segment"): anonymous "3,000" per IP per 5-min window (free user 5,000), "subject to change over time" | **Indirect evidence yes** for simple GETs: transformers.js in the browser loads models from HF by default (`remoteHost`: "Defaults to the Hugging Face Hub"). A Jan 2026 forum report: "Simple GET requests work fine through the CDN redirect", but "Range requests fail with CORS preflight errors when redirected to cas-bridge.xethub.hf.co". No HF staff confirmation | ToS has no hotlinking clause found; "we reserve the right to suspend or terminate your access … with or without cause". Signed-URL behaviour of the redirect: **[unconfirmed]** |

**Bandwidth arithmetic [analysis]:** 100 GB/month on Pages ≈ 3,600 first-time MI-GAN downloads (28 MB) or ≈ 1,300 SAM 2.1 Tiny fp16 sets (≈ 78 MB). After that, models come from the local cache.

### 6.2 Browser storage (for cached models)

| Browser | Per-origin quota (quoted) | Eviction |
|---|---|---|
| Chromium | "an origin can store up to 60% of the total disk size in both persistent and best-effort modes" | LRU under storage pressure; persisted origins skipped |
| Firefox | Best-effort: smaller of "10% of the total disk size" or "10 GiB" (group limit); persisted: "up to 50% of the total disk size, capped at 8 TiB" | Prompt shown for `persist()` |
| Safari 17+ (macOS 14 / iOS 17) | Browser apps: "up to 60% of the total disk space"; other apps: "up to 15%"; overall cap 80% / 20% | Can evict a site that "has not been interacted with by the user for some time" (MDN: "in the last seven days of browser use" with tracking prevention on). `persist()` granted "based on heuristics like whether the website is opened as a Home Screen Web App" |

ONNX Runtime Web's docs suggest caching "by using the Cache API or Origin private file system". transformers.js uses the Cache API by default (`useBrowserCache`).

### 6.3 Pick: delivery

**[analysis]**
- Ship **MI-GAN and SAM 2.1 Tiny (fp16) same-origin on GitHub Pages**: about 106 MB, all files under 100 MiB.
- Put optional large models (LaMa, BiRefNet full/HR, later Moebius) on **Hugging Face**, pinned to a commit hash and checked by SHA-256 in the app. Use plain GETs (no Range) to stay clear of the preflight report.
- Don't rely on GitHub Release assets from the browser.
- Store models in OPFS or the Cache API, and call `navigator.storage.persist()` after the first model download.
- Follow LightCraft's consent pattern: a pinned manifest plus a licence-acceptance step before the first download (`LIGHTCRAFT_AI_NOTES.md`).

---

## 7. WebGPU limits for inference

### 7.1 Table

| Limit / feature | Spec default (MDN `GPUSupportedLimits`) | Field data (web3dsurvey; sample size and date not stated) | Impact |
|---|---|---|---|
| `maxStorageBufferBindingSize` | 134217728 (128 MiB) | ≥128 MiB: 100%; ≥256 MiB: 98%; ≥1 GiB: **91%**; ≥2 GiB−1: 16% | The largest single weight/activation tensor bound to a shader. Big-LaMa's and BiRefNet's large conv weights fit; request the adapter's limit, since ORT's option "Cannot exceed the adapter's reported limit" |
| `maxBufferSize` | 268435456 (256 MiB) | ≥2 GiB−1: about **78%**; 1–1.25 GiB band: about 10% | Same |
| `maxStorageBuffersPerShaderStage` | 8 | — (one ORT error shows a device reporting 16) | **BiRefNet hits this**: "MaxStorageBuffersPerShaderStage (16) exceeded. Created 33 bindings." Fixed by rewriting wide Split/Concat into trees (`yamura4/RMBG-2.0-WebGPU`; `runes/birefnet-lite-webgpu`) |
| `maxComputeWorkgroupStorageSize` | 16384 bytes | — | Matters for hand-written WGSL kernels |
| `shader-f16` | optional feature | **93.95%** overall; Mac 99.81%, iOS 99.99%, Windows 91.11%, Android 86%, Linux **73.53%** | Ship fp16 models with an fp32 fallback |
| WASM memory (ORT Web) | — | — | "WebAssembly has a memory limit of 4GB"; "there is no way for ONNX Runtime Web to run models larger than 4GB"; protobuf max "2GB". The BiRefNet_lite port hit "std::bad_alloc" when an op fell back to CPU |

### 7.2 Known ONNX Runtime Web issues relevant here

- **CPU fallback ops**: an op without a WebGPU kernel (variadic `Sum` in BiRefNet) falls back to wasm and can exhaust the 4 GB heap. Fix: offline graph surgery (`runes/birefnet-lite-webgpu`).
- **fp16 overflow on WebGPU**: issue #26732 ("fp16 and q4f16 Gemma 3 models produce invalid outputs on WebGPU due to overflow"): "Once it saturates, NaN propagates". Fixed model-side with Clip nodes. A runtime fix is undecided. **Relevance [analysis]:** HDR-range (linear) inputs to fp16 models can overflow; feed tone-mapped [0,1] data.
- **Graph capture** only "When a model has fully static shapes and all kernels run on WebGPU" (ORT WebGPU EP docs). MI-GAN's pipeline has dynamic H×W, so export a fixed-crop core model for graph capture **[analysis]**.
- `DFT` is supported in the WebGPU EP (opset 17+), which LaMa's FFC needs. Carve notes the dynamo export "works slowly" and recommends `lama_fp32.onnx`.

---

## 8. Recommended pick per feature (summary)

| Feature | Pick | Why |
|---|---|---|
| Clipped highlight fill | **MI-GAN 512** on a tone-mapped crop, clip-level constraint, removable "generated" layer | Only candidate with explicit permissive weights, tiny, browser precedent |
| Shadow fill | **Don't build**; route to denoise | Shadows rarely lack data in raw; generation would invent content |
| Masking: object | **SAM 2.1 Tiny** fp16 (+ SlimSAM-77 fallback) | Apache-2.0 checkpoints; ~78 MB fp16; proven in-browser |
| Masking: subject/background | **BiRefNet_lite** fp16 (full/HR optional) | MIT; full model too big for default |
| Masking: people parts | MediaPipe Selfie Multiclass + edge refinement | Apache-2.0; 6 classes |
| Masking: sky | ProRAW masks if present; else classical + SAM prompts | No clean permissive sky model with known data |
| AI Remove | **MI-GAN** default, LaMa optional, Moebius later | As above |
| AI denoise | See Part 2 | — |
| Delivery | Pages for small models; HF (pinned + SHA-256) for optional; OPFS/Cache + `persist()` | Release assets lack CORS |
| WebGPU | Request adapter limits; fp16 with fp32 fallback; graph surgery for wide ops | Field data above |

---

## 9. Excluded and why

| Item | Reason | Quote / source |
|---|---|---|
| SAM 3 | Owner rule; non-OSI licence | LightCraft NOTICE (per `LIGHTCRAFT_AI_NOTES.md`): "Meta's SAM License … a separate, non-OSI licence" |
| Stable Diffusion inpainting (1.x, 2.x, XL) | RAIL use restrictions | OpenRAIL-M and OpenRAIL++-M: "The restrictions set forth in Attachment A are considered Use-based restrictions."; Attachment A begins "In any way that violates any applicable national, federal, state, local or international law or regulation;" and "To generate or disseminate verifiably false information and/or content with the purpose of harming others;" (CompVis/stable-diffusion LICENSE; SDXL base LICENSE.md, "CreativeML Open RAIL++-M License dated July 26, 2023") |
| FLUX.1 Fill [dev] | Non-commercial | HF: "flux-1-dev-non-commercial-license"; gated |
| MAT | Research only | "The code and models in this repo are for research purposes only." |
| Co-Mod-GAN | NC code | "The Work and any derivative works thereof only may be used or intended for use non-commercially." |
| FcF | NC code bundled | NVIDIA StyleGAN2-ADA licence, same sentence |
| EdgeSAM | NC | "Redistribution and use for non-commercial purpose in source and binary forms" |
| BRIA RMBG-1.4 / 2.0 | NC | "The model is released under a CC BY-NC 4.0 license for non-commercial use." / "a Creative Commons license for non-commercial use" |
| SegFormer-based sky models | NC base code and NC data | "As used herein, "non-commercially" means for research or evaluation purposes only."; ADE20K: "only for non-commercial research and educational purposes" |
| SingleHDR | No licence found | Repo page shows no LICENSE |
| Marigold (depth, also used for some fill pipelines) | RAIL | See Part 4 |

**GPL-3.0 weights (listed separately, undecided):** RawNIND UtNet2 (see Part 2). No GPL-only inpainting or masking weights were found. inpaint-web is a GPL-3.0 *app* using MIT MI-GAN weights.

---

## 10. Open questions for the owner

1. **Training data.** MI-GAN, LaMa, SAM 2.1 and BiRefNet all have permissive *weights* licences but were trained partly on datasets with restrictive terms: Places365 ("The copyright of all the images belongs to the image owners"), FFHQ (BY-NC-SA), SA-1B ("Research purposes only"), and DIS5K (terms unreadable here). Is a permissive weights licence enough, or must the training data be permissive too? If the latter, almost nothing qualifies.
2. **LaMa weights terms.** LaMa's repo is Apache-2.0, but the weights have no licence of their own. Is "covered by the repo licence" good enough for an optional download?
3. **Moebius.** Its weights are Apache-2.0, but its training data is undisclosed, and it needs a separate VAE (from PixelHacker, MIT-tagged). Worth tracking as a future "HQ fill", or out of scope as too generative?
4. **Shadow fill.** OK to drop generative shadow fill and point users to denoise instead?
5. **Sky models.** Accept MIT-tagged U²-Net sky weights whose training data isn't documented, or stick to ProRAW masks + classical/SAM?
6. **Hosting.** OK to host optional models on Hugging Face (third-party CDN, rate-limited per IP) with SHA-256 pinning? Or mirror everything to Pages (1 GB cap, 100 MiB per file)?
7. **Consent step.** Do you want a licence-acceptance screen before each model's first download (LightCraft's pattern)?
8. **Patents.** The no-AI Remove must avoid an iterative "neighbour mapping + perturbed mapping" search (US 8,285,055 / 8,811,749, listed active to 2031 / 2029). Do you want counsel to review the reworked algorithm before release?
9. **RawNIND.** Ask the author whether "GPL3 + CC-BY-4.0" means you may choose CC-BY-4.0 (Part 2).

---

## 11. Items I could not verify

- **DIS5K terms of use**: PDF robots-blocked (`github.com/.../raw/...`), and raw.githubusercontent returned binary.
- SAM 2.1 input resolution (1024): not confirmed this session. transformers.js support for SAM 2: **[unconfirmed]** (the ONNX repo exists with transformers.js-style file names; no model card).
- EfficientSAM parameter counts; SD parameter counts.
- Moebius VAE identity and training data; Moebius step count; the HF tag (mit) vs README (Apache-2.0) mismatch. The arXiv page (2606.19195) did not load (permission timeout).
- Exact `SemanticName` strings in ProRAW files and the mask compression; the Adobe DNG spec PDF was robots-blocked.
- Hugging Face signed-URL / CDN redirect details and official CORS policy.
- GitHub Pages per-file limit for Actions-deployed artifacts (only the Git 100 MiB limit is documented).
- US 12,136,199 details (page did not load); maintenance-fee status of US 8,285,055; full claim 1 text of US 8,818,135 and US 8,542,908.
- No published WebGPU latency with named hardware for MI-GAN, LaMa or SAM 2.1 Tiny.

---

## Sources

**Inpainting**
- MI-GAN: https://github.com/Picsart-AI-Research/MI-GAN ; https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE ; https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE-WEIGHTS ; https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/torch_utils/misc.py ; https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/dnnlib/util.py ; https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/scripts/create_onnx_pipeline.py ; https://huggingface.co/andraniksargsyan/migan (+ /tree/main) ; paper: https://openaccess.thecvf.com/content/ICCV2023/papers/Sargsyan_MI-GAN_A_Simple_Baseline_for_Image_Inpainting_on_Mobile_Devices_ICCV_2023_paper.pdf
- inpaint-web: https://github.com/lxfater/inpaint-web
- LaMa: https://raw.githubusercontent.com/advimman/lama/main/LICENSE ; https://raw.githubusercontent.com/advimman/lama/main/README.md ; https://huggingface.co/smartywu/big-lama ; https://huggingface.co/Carve/LaMa-ONNX (+ /tree/main)
- Places365: https://raw.githubusercontent.com/CSAILVision/places365/master/README.md ; http://places2.csail.mit.edu/download.html
- FFHQ: https://raw.githubusercontent.com/NVlabs/ffhq-dataset/master/README.md
- Co-Mod-GAN: https://github.com/zsyzzsoft/co-mod-gan ; https://raw.githubusercontent.com/zsyzzsoft/co-mod-gan/master/LICENSE.txt
- SH-GAN: https://github.com/SHI-Labs/SH-GAN
- FcF: https://raw.githubusercontent.com/SHI-Labs/FcF-Inpainting/main/README.md ; https://raw.githubusercontent.com/SHI-Labs/FcF-Inpainting/main/LICENSE
- MAT: https://raw.githubusercontent.com/fenglinglwb/MAT/main/README.md
- Moebius: https://github.com/hustvl/Moebius ; https://raw.githubusercontent.com/hustvl/Moebius/main/README.md ; https://huggingface.co/hustvl/Moebius (+ /tree/main) ; https://github.com/hustvl/PixelHacker ; https://huggingface.co/hustvl/PixelHacker ; https://gigazine.net/gsc_news/en/20260623-moebius-image-inpainting-framework ; arXiv 2606.19195 (did not load)
- Stable Diffusion licences: https://raw.githubusercontent.com/CompVis/stable-diffusion/main/LICENSE ; https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/raw/main/LICENSE.md (SD2-inpainting pages returned errors)
- FLUX: https://huggingface.co/black-forest-labs/FLUX.1-Fill-dev ; https://huggingface.co/black-forest-labs/FLUX.1-schnell
- Kandinsky: https://huggingface.co/kandinsky-community/kandinsky-2-2-decoder-inpaint
- HDR: https://github.com/gabrieleilertsen/hdrcnn ; https://github.com/alex04072000/SingleHDR

**Masking**
- SAM 2: https://raw.githubusercontent.com/facebookresearch/sam2/main/README.md ; https://huggingface.co/facebook/sam2.1-hiera-tiny ; https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/tree/main/onnx ; https://arxiv.org/abs/2408.00714 ; SA-V: https://ai.meta.com/datasets/segment-anything-video/ ; SA-1B: https://ai.meta.com/datasets/segment-anything/ ; WebSAM: https://xevion.dev/projects/websam
- SAM 1: https://raw.githubusercontent.com/facebookresearch/segment-anything/main/README.md
- MobileSAM: https://github.com/ChaoningZhang/MobileSAM ; EfficientSAM: https://github.com/yformer/EfficientSAM ; SlimSAM: https://github.com/czg1225/SlimSAM ; EdgeSAM: https://raw.githubusercontent.com/chongzhou96/EdgeSAM/master/README.md , https://raw.githubusercontent.com/chongzhou96/EdgeSAM/master/LICENSE
- BiRefNet: https://raw.githubusercontent.com/ZhengPeng7/BiRefNet/main/README.md ; https://raw.githubusercontent.com/ZhengPeng7/BiRefNet/main/LICENSE ; https://huggingface.co/ZhengPeng7/BiRefNet ; https://huggingface.co/ZhengPeng7/BiRefNet_lite ; https://huggingface.co/ZhengPeng7/BiRefNet_HR ; https://huggingface.co/ZhengPeng7/BiRefNet-matting ; https://huggingface.co/onnx-community/BiRefNet_lite-ONNX ; https://huggingface.co/onnx-community/BiRefNet-ONNX/tree/main/onnx ; https://huggingface.co/runes/birefnet-lite-webgpu ; https://huggingface.co/yamura4/RMBG-2.0-WebGPU
- DIS / IS-Net: https://raw.githubusercontent.com/xuebinqin/DIS/main/README.md ; https://raw.githubusercontent.com/xuebinqin/DIS/main/LICENSE.md ; DIS5K terms PDF (robots-blocked)
- P3M: https://raw.githubusercontent.com/JizhiziLi/P3M/master/README.md
- U²-Net: https://github.com/xuebinqin/U-2-Net
- BRIA: https://huggingface.co/briaai/RMBG-2.0 ; https://huggingface.co/briaai/RMBG-1.4
- MediaPipe: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter ; https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf
- Sky: https://github.com/xiongzhu666/Sky-Segmentation-and-Post-processing ; https://huggingface.co/twistlabs/fotometis-sky ; https://huggingface.co/chili-raw/chiliraw-models ; https://huggingface.co/Realcat/skywater_seg ; https://github.com/Parskatt/skyseg ; https://raw.githubusercontent.com/NVlabs/SegFormer/master/LICENSE ; https://ade20k.csail.mit.edu/terms/
- ProRAW / DNG: https://nonstrict.eu/wwdcindex/wwdc2021/10160/ ; https://developer.apple.com/documentation/coreimage/ciimageoption.md ; https://developer.apple.com/tutorials/data/documentation/avfoundation/avsemanticsegmentationmatte.md ; https://exiv2.org/tags.html ; https://loc.gov/preservation/digital/formats/fdd/fdd000628.shtml ; https://exiftool.org/forum/index.php?msg=75136 ; https://exiftool.org/forum/index.php?msg=75150

**Patents**
- https://patents.google.com/patent/US8285055B1/en ; https://patents.google.com/patent/US8811749B1/en ; https://patents.google.com/patent/US8407575B1/en ; https://patents.google.com/patent/US8818135B1/en ; https://patents.google.com/patent/US8542908B2/en ; https://patents.google.com/patent/US12136199B2/en (did not load) ; Apple: https://patents.google.com/patent/US10410327B2/en (via Part 4)

**Delivery and storage**
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits ; https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github ; https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases ; https://github.com/orgs/community/discussions/45446
- https://huggingface.co/docs/hub/rate-limits ; https://huggingface.co/terms-of-service ; https://huggingface.co/docs/transformers.js/custom_usage ; https://huggingface.co/docs/transformers.js/api/env ; https://discuss.huggingface.co/t/cors-support-for-http-range-requests-on-dataset-files/172172
- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria ; https://webkit.org/blog/14403/updates-to-storage-policy/

**WebGPU / ONNX Runtime Web**
- https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedLimits ; https://web3dsurvey.com/webgpu/limits/maxStorageBufferBindingSize ; https://web3dsurvey.com/webgpu/limits/maxBufferSize ; https://web3dsurvey.com/webgpu/features/shader-f16
- https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html ; https://onnxruntime.ai/docs/tutorials/web/large-models.html ; https://raw.githubusercontent.com/microsoft/onnxruntime/main/js/web/docs/webgpu-operators.md ; https://github.com/microsoft/onnxruntime/issues/26732

**Cross-references**
- `/home/claude/research/DETAIL_DENOISE_SHARPEN.md` (Part 2); `/home/claude/research/DEPTH_OF_FIELD.md` (Part 4); `/home/claude/research/LIGHTCRAFT_AI_NOTES.md` (LightCraft notes, another agent)
