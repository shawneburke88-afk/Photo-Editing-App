> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-17. The prompt is reproduced at the end. Copied verbatim below this line; not re-verified here except where its own spot-check log says so. Facts only, not legal advice.

# AI Remove models: verification (COWORK_AI_REMOVE_2026-10-17)

Verification for LightBench's AI Remove: Moebius as the best-quality option, LightBench's own ONNX copies as GitHub Release assets, and small models for a future mobile version. All sources were read on 2026-10-17. Verdicts are **Confirmed / Contradicted / Partly / Not found**. Facts only, not legal advice.

Structure: Decisions table → spot-check log → Part A, Moebius (items 1–5) → Parts B–C, mobile models and hosting (items 6–9). Blocked sources are listed at the end of each part.

---

## Decisions this changes

| Item | Fact found | What LightBench should do differently |
|---|---|---|
| 1. Moebius weights licence | **Permissive.** GitHub README: "Both the code and the pretrained model weights of Moebius are released under the Apache License 2.0" and "Commercial use of the weights and the images produced with them is permitted." The sidebar says "Apache-2.0 license". The HF card is tagged MIT and has no LICENSE file. The README covers "the pretrained model weights" without naming files; the checkpoints listed are `pretrained`, `ft_places2`, `ft_celebahq` and `ft_ffhq`. **The VAE is not in the Moebius repo**, so the Moebius licence doesn't cover it. | Ship Moebius's UNet under **Apache-2.0**, the licence stated in the README, and note the MIT tag on HF in the model notice. Owner's rule: passes. |
| **2. VAE: the key finding** | **It is SDXL's VAE.** PixelHacker's paper: "we use the pretrained SDXL-VAE". Moebius: "Download the checkpoint of VAE and put it into ./weight/vae", from `hustvl/PixelHacker`'s `vae` folder (fp16, 167 MB). Licence tags: PixelHacker's HF card says "License: mit"; `stabilityai/sdxl-vae` says "License: mit"; `madebyollin/sdxl-vae-fp16-fix` says "License: mit" and "is specifically based on SDXL-VAE (0.9)". **None of these repos has a LICENSE file or a copyright line.** The same VAE weights are also distributed inside SDXL base 1.0 under CreativeML Open RAIL++-M, which has use-based restrictions, and SDXL 0.9 was released under a research licence (Part A). Which exact checkpoint PixelHacker copied isn't stated. Its config (`force_upcast: false`, `sample_size: 512`) matches fp16-fix, which is the Part A agent's inference, not proof. | **Owner decision needed.** On the tags alone, every hosted copy says MIT, so the "permissive weights" rule passes. The provenance chain, though, runs through releases under RAIL/research licences, and no MIT licence text exists to reproduce. Options: (a) accept on the strength of Stability's own MIT tag on `stabilityai/sdxl-vae`, and cite that repo in the NOTICE; (b) treat the VAE as RAIL-encumbered and exclude Moebius; (c) look for an independently trained, permissively licensed VAE with the same latent format. That would need retraining or validation and isn't available off the shelf. |
| 3. Redistributing ONNX copies | **Moebius (Apache-2.0):** §4 requires including a copy of the licence, marking modified files as changed (the ONNX conversion counts), and keeping any NOTICE; no NOTICE file was found. **VAE (MIT tag only):** MIT asks you to include the copyright and permission notice, but none is published to copy. | Bundle Apache-2.0 LICENSE text with the Moebius ONNX files and state "converted to ONNX by LightBench" in each Release. For the VAE, include the MIT licence text and cite `stabilityai/sdxl-vae` and `hustvl/PixelHacker` as the source, saying no upstream copyright line exists. |
| 4. Training data, for the notice | PixelHacker's 14M pre-training set: "trained with LCG on 14M image-mask pairs". Named sources are COCONut-Large, Object365V2 and GoogleLandmarkV2, plus **an unnamed 7.49M-image self-collected set**. PixelHacker was fine-tuned "on Places2, CelebA-HQ, and FFHQ". Moebius's fine-tuning data is shown only by its folder names (`ft_places2`, `ft_celebahq`, `ft_ffhq`); its distillation data is **Not found**. | The owner already accepts this. Put these facts in the model notice, including that about half the pre-training images are unnamed. |
| 5. Browser port | `simonw/moebius-web` works: fp32, opset 18, 1.24 GB, ORT-web 1.27.0, WebGPU with a WASM fallback. Its README says "Apache 2.0, inherited from the upstream". The GitHub repo has no LICENSE file; its HF repo has one. **No GPU timing published.** Upstream CFG defaults disagree (2.0, 2.5, 4.5). One operator issue reported: Conv3d on Safari. ORT issue search was blocked. | Plan your own export (fp16 to cut the download size), measure speed yourself, and pick and document one CFG default. Expect Safari problems. Every file in a 1.24 GB fp32 export is under the 2 GiB Release limit. |
| 6. MI-GAN (mobile) | **Passes.** `LICENSE-WEIGHTS` is MIT. The ONNX export and inference model import no `dnnlib`/`torch_utils` (only `scripts/demo.py` and the training code do). Teacher: the authors' own re-trained Co-Mod-GAN (the official Co-Mod-GAN code is BSD-2 plus an NVIDIA non-commercial licence). Training data: Places365-Standard and FFHQ (named; FFHQ's own licence is BY-NC-SA per batch 1). Only a 512 ONNX is published (about 28–30 MB). Phone timings exist; there is no browser timing. | **MI-GAN stays the mobile pick.** Use only the ONNX/inference path, never the demo or training code. Record the FFHQ data-licence caveat in the notice. |
| 7. LaMa / big-lama | No formal weights licence beyond the repo's Apache-2.0; only an informal author comment. Places365-Challenge. ONNX about 208 MB. ORT-web supports the DFT op on WebGPU and WASM. The common ONNX export uses MatMul/Cos/Sin instead (graph not inspected). | Not for mobile (too big); weights licence still informal. No change. |
| 8. Newer small models (2025–26) | **None qualifies.** The only file under 100 MB found is OpenCV's 92.6 MB quantised Big-LaMa, which inherits LaMa's licence caveat. RETHINED (2025) has no released weights. | No new candidate. Re-check periodically. |
| 9. GitHub Release hosting | GitHub Docs: "Each file included in a release must be under 2 GiB. There is no limit on the total size of a release, nor bandwidth usage." Another GitHub page ties the limit to the plan's Git LFS limit (2 GB on Free/Pro). The Acceptable Use Policy (§9) allows throttling or suspension for "significantly excessive" bandwidth. | Release hosting works. Keep every file under 2 GB and split if needed. Watch the "significantly excessive bandwidth" clause if Moebius downloads grow. Keep a fallback host in mind. |

## Spot-check log (main session, 2026-10-17)

Re-fetched from primary sources, all matching the part files:

- github.com/hustvl/Moebius README: the Apache-2.0 sentence, the commercial-use sentence, and the VAE download instruction (PixelHacker `vae` folder). **Confirmed.**
- huggingface.co/hustvl/PixelHacker: "License: mit", with no other licence statement. **Confirmed.**
- huggingface.co/stabilityai/sdxl-vae: "License: mit"; the card links to SDXL base 0.9. **Confirmed.**
- huggingface.co/madebyollin/sdxl-vae-fp16-fix: "License: mit"; "is specifically based on SDXL-VAE (0.9)". **Confirmed.**
- arXiv 2504.20438 (PixelHacker): "we use the pretrained SDXL-VAE"; "trained with LCG on 14M image-mask pairs". **Confirmed.**
- docs.github.com "About releases": "Each file included in a release must be under 2 GiB. There is no limit on the total size of a release, nor bandwidth usage." **Confirmed.**

Note: the Moebius README's licence sentence ends "…the same license used by the Qwen model family", quoted as written.

---

# Part A: Moebius verification (items 1–5)

Read date for every source: **2026-10-17**, unless noted. Quotes were pulled through WebFetch, which hands back short extracts. They are verbatim as returned, but they are not screenshots. Facts only; no legal advice. **[secondary]** marks a source that is not the rights-holder or author. **[analysis]** marks my own inference.

## Headline: the VAE

- **The VAE is SDXL's VAE.** PixelHacker's paper (arXiv 2504.20438) says: "In all experiments, we use the pretrained SDXL-VAE and freeze its parameters." Moebius tells users to download that same VAE from `hustvl/PixelHacker/vae`.
- **The SDXL-VAE repos are tagged MIT, not RAIL.** `stabilityai/sdxl-vae` front-matter reads `license: mit`, and its card has no licence text. `madebyollin/sdxl-vae-fp16-fix` also reads `license: mit`. Neither repo has a LICENSE file or a copyright line.
- **The same VAE family is also shipped under restrictive licences elsewhere:**
  - inside `stabilityai/stable-diffusion-xl-base-1.0` (its `vae/` folder), which is under the **CreativeML Open RAIL++-M** licence with use-based restrictions;
  - inside SDXL 0.9, which was under the "SDXL 0.9 Research License" (gated). `madebyollin`'s fp16-fix is "specifically based on SDXL-VAE (0.9)".
- **Which exact checkpoint PixelHacker saved is not stated anywhere.**

So the standalone VAE repos carry a permissive tag, but the same weights also circulate under RAIL and research licences. Which licence applies to PixelHacker's copy is a question for the owner or the authors.

---

## Item 1. Weights licence: **Partly** (permissive throughout, but the GitHub and HF licences conflict)

| Sub-item | Verdict | Evidence |
|---|---|---|
| README licence section | **Confirmed** (Apache-2.0) | "Both the code and the pretrained model weights of Moebius are released under the Apache License 2.0"; "Commercial use of the weights and the images produced with them is permitted." (https://raw.githubusercontent.com/hustvl/Moebius/main/README.md) |
| LICENSE file | **Confirmed** (Apache-2.0) | "Apache License" / "Version 2.0, January 2004". The appendix is filled in as "Copyright 2024 Moebius Authors". Sidebar: "Apache-2.0 license". (https://raw.githubusercontent.com/hustvl/Moebius/main/LICENSE; https://github.com/hustvl/Moebius) |
| NOTICE file | **Not found** | None in the GitHub root listing (assets, config, data, infer, library, model_lib, moonlight, removal/v1_2, run, LICENSE, README.md, requirements.txt, train_distillation.py, utils*.py). The tree listing was truncated ("View all files"), and tree pages are robots-blocked. |
| All checkpoints covered? | **Partly** | The README sentence covers "the pretrained model weights" without naming files. It lists four checkpoints, each a single `diffusion_pytorch_model.bin`: `pretrained`, `ft_places2`, `ft_celebahq`, `ft_ffhq`. **No VAE is in the Moebius repo.** The VAE comes from PixelHacker (Item 2), so the Moebius licence does not cover it. |
| HF repo hosting the weights | **Confirmed** | `huggingface.co/hustvl/Moebius` (3.62 GB). Uploaded by AnduinD; the `pretrained` commit is `0fc199d`. |
| HF model card licence | **Contradicted** (says MIT, not Apache) | Tag "License: mit". The card body has no licence text. The repo holds only `.gitattributes`, `README.md` (297 B) and the four folders, with **no LICENSE file**. (https://huggingface.co/hustvl/Moebius) |

**Compared with prior work:** this agrees with batch 1 (Apache-2.0 README, MIT HF tag) and batch 2 F3 (the conflict). New here: the LICENSE copyright line ("2024 Moebius Authors") and confirmation that the HF repo has no licence file.

## Item 2. The VAE: **Partly** (SDXL-VAE origin Confirmed; exact checkpoint Not found)

| Sub-item | Verdict | Evidence |
|---|---|---|
| Files Moebius tells users to download | **Confirmed** | "Download the checkpoint of VAE and put it into ./weight/vae." The link goes to `huggingface.co/hustvl/PixelHacker/tree/main/vae`, which holds `config.json` (788 B) and `diffusion_pytorch_model.bin` (167 MB, pickle imports `torch.HalfStorage`, so fp16). Commit `e62bf3d` by AnduinD. (Moebius README; https://huggingface.co/hustvl/PixelHacker/tree/main/vae) |
| Brief's claim "Moebius README gives scaling_factor 0.13025" | **Partly** | The value is in **PixelHacker's** `vae/config.json` ("scaling_factor": 0.13025), not in the Moebius README. Moebius's `config/model_cfg/moebius.yaml` has only `model_name: 'sdvae_f8d4'`, `downsample_ratio: 8`, `embed_dim: 4`. Moebius loads the VAE with `AutoencoderKL.from_pretrained(model_cfg["vae"]['model_dir'])` (`utils_train.py`). |
| PixelHacker GitHub licence | **Confirmed** (Apache-2.0) | LICENSE: "Apache License", "Version 2.0, January 2004". The appendix is **unfilled**: "Copyright [yyyy] [name of copyright owner]". The README badge reads "License-Apache_2.0". The README does not mention SDXL, Stability AI or madebyollin. (https://raw.githubusercontent.com/hustvl/PixelHacker/main/LICENSE, …/README.md) |
| PixelHacker HF card licence | **Contradicted** (says MIT) | "License: mit". The card has no licence text and no statement about the VAE. The repo holds `.gitattributes`, `README.md` (300 B) and the folders `ft_celebahq`, `ft_ffhq`, `ft_places2`, `pretrained`, `vae` (14 GB total), with no LICENSE file. (https://huggingface.co/hustvl/PixelHacker) |
| Is it SDXL's VAE? | **Confirmed** (by the paper) | PixelHacker paper: "In all experiments, we use the pretrained SDXL-VAE and freeze its parameters." (https://arxiv.org/abs/2504.20438, as returned by WebFetch). The paper does not name the Hugging Face repo or version. |
| Which SDXL-VAE checkpoint? | **Not found** (the config points to madebyollin's fp16-fix) | See the config table below. PixelHacker's `sample_size: 512` and `force_upcast: false` match **`madebyollin/sdxl-vae-fp16-fix`**. They do not match `stabilityai/sdxl-vae` (`sample_size: 1024`, no `force_upcast` key). This is **[analysis]**, not proof: a tensor-hash comparison would settle it. |
| `stabilityai/sdxl-vae` licence | **Contradicted** (it is MIT, not RAIL++-M) | README front-matter: `license: mit`. The body has no licence text and the repo has no LICENSE file. The card says the authors "train the same autoencoder architecture used for the original Stable Diffusion" "at a larger batch-size (256 vs 9)". Files: `diffusion_pytorch_model.bin`, `diffusion_pytorch_model.safetensors` and `sdxl_vae.safetensors`, 335 MB each. Initial commit 2023-06-22 by rromb. "update vae weights" was committed 2023-07-26 and reverted the next day ("Revert "update vae weights"", palp, 2023-07-27). (https://huggingface.co/stabilityai/sdxl-vae, /raw/main/README.md, /commits/main) |
| `madebyollin/sdxl-vae-fp16-fix` licence | **Confirmed** (MIT) | Front-matter: `license: mit`; no LICENSE file. "SDXL-VAE-FP16-Fix is the [SDXL VAE](https://huggingface.co/stabilityai/sdxl-vae)*," "but modified to run in fp16 precision without generating NaNs." Footnote: "`sdxl-vae-fp16-fix` is specifically based on [SDXL-VAE (0.9)]" "but it works with SDXL 1.0 too". (https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/raw/main/README.md) |
| Same VAE family under RAIL++-M | **Confirmed** (context) | `stabilityai/stable-diffusion-xl-base-1.0` is tagged "License: openrail++", and its card says "License: [CreativeML Open RAIL++-M License]". Its `vae/` folder holds `diffusion_pytorch_model.safetensors` (335 MB), `.fp16.safetensors` (167 MB) and a flax file. The LICENSE defines "Model" to include "learnt weights, parameters (including optimizer states)". Paragraph 5: "The restrictions set forth in Attachment A are considered Use-based restrictions." "Therefore You cannot use the Model and the Derivatives of the Model for the specified restricted uses." Attachment A, item 1: "In any way that violates any applicable national, federal, state, local or international law or regulation;". Item 2: "For the purpose of exploiting, harming or attempting to exploit or harm minors in any way;". (https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/raw/main/LICENSE.md). **Not verified:** whether those `vae/` tensors are identical to `stabilityai/sdxl-vae`. |
| SDXL 0.9 (source of the "0.9" VAE) | **Confirmed** (context) | `stabilityai/stable-diffusion-xl-base-0.9`: licence "other", linked as "SDXL 0.9 Research License"; "SDXL 0.9 is licensed under the SDXL Research License, Copyright (c) Stability AI Ltd. All Rights Reserved."; gated. (https://huggingface.co/stabilityai/stable-diffusion-xl-base-0.9) |

**VAE `config.json` comparison** (all fetched 2026-10-17):

| Field | `hustvl/PixelHacker/vae` | `stabilityai/sdxl-vae` | `madebyollin/sdxl-vae-fp16-fix` |
|---|---|---|---|
| `scaling_factor` | 0.13025 | 0.13025 | 0.13025 |
| `latent_channels` | 4 | 4 | 4 |
| `block_out_channels` | [128, 256, 512, 512] | [128, 256, 512, 512] | [128, 256, 512, 512] |
| `sample_size` | **512** | **1024** | **512** |
| `force_upcast` | **false** | *(absent)* | **false** |
| `_name_or_path` | `""` | `"."` | `"."` |
| `_diffusers_version` | 0.30.2 | 0.18.0.dev0 | 0.18.0.dev0 |
| Extra keys | `latents_mean/std: null`, `shift_factor: null`, `mid_block_add_attention`, `use_quant_conv`, `use_post_quant_conv` | — | — |
| Weight file dtype | fp16 `.bin`, 167 MB | fp32, 335 MB | fp32, 335 MB |

**[analysis]** The extra keys and the empty `_name_or_path` are what diffusers 0.30.x writes on `save_pretrained`, so the VAE was re-saved, and its fp16 storage means it was cast. For context, SD 1.x VAEs use 0.18215, so 0.13025 is the SDXL value; the simonw port also calls it "not the usual SD `0.18215`".

**Compared with prior work:** batch 2 found that the config "matches the SDXL-VAE family (unconfirmed)" and that both SDXL-VAE repos are tagged MIT. **This batch confirms the SDXL-VAE origin from the PixelHacker paper.** It also adds the `sample_size` / `force_upcast` match to fp16-fix, and the RAIL++-M (base 1.0) and research-licence (0.9) context.

## Item 3. Redistribution of ONNX copies: **Partly**

| Licence | Redistribution terms (quoted) | Attribution / NOTICE |
|---|---|---|
| Moebius (Apache-2.0, GitHub) | §4: "You must give any other recipients of the Work or Derivative Works a copy of this License; and" / "You must cause any modified files to carry prominent notices stating that You changed the files; and" / "You must retain, in the Source form of any Derivative Works that You distribute, all copyright, patent, …" / "If the Work includes a 'NOTICE' text file …" | No NOTICE file found. The copyright line to retain is "Copyright 2024 Moebius Authors". |
| Moebius / PixelHacker (MIT, HF tags) | No MIT text, copyright holder or LICENSE file is published in either HF repo, so there is **no notice text to reproduce** beyond the tag. | **Not found** |
| PixelHacker (Apache-2.0, GitHub) | Same §4 as above | Appendix copyright **unfilled**; no NOTICE found. |
| `stabilityai/sdxl-vae`, `madebyollin/sdxl-vae-fp16-fix` (MIT tags) | No LICENSE file and no copyright line in either repo | **Not found** |
| SDXL base 1.0 (RAIL++-M), only if PixelHacker's VAE is taken to derive from it | §4(a): "Use-based restrictions as referenced in paragraph 5 MUST be included as an enforceable provision" "by You in any type of legal agreement (e.g. a license) governing the use and/or distribution" "of the Model or Derivatives of the Model," "and You shall give notice to subsequent users You Distribute to, that the Model or Derivatives" "of the Model are subject to paragraph 5." Paragraph 5 also says: "You shall require all of Your users who use the Model or a Derivative of the Model" "to comply with the terms of this paragraph (paragraph 5)." | Copyright "Copyright (c) 2023 Stability AI" |

**Precedent [secondary, third-party]:** `simonw/Moebius-ONNX` already redistributes ONNX copies of both the Moebius UNet and the PixelHacker VAE. It is tagged "License: apache-2.0", ships an 11.2 kB `LICENSE`, and says "Licensed under Apache 2.0, inherited from the upstream hustvl/Moebius" and "all model credit belongs to the original authors". It gives no separate licence for the VAE.

## Item 4. Training data, for the model notice: **Partly** (PixelHacker's sources are mostly named; Moebius's distillation data is Not found)

- **PixelHacker pre-training (14 M): Partly named.** This contradicts the brief's "stays unnamed". All quotes are from https://arxiv.org/abs/2504.20438:
  - "we first construct a large-scale dataset containing 14 million image-mask pairs"; "4.3M 'foreground' image-mask pairs and 9.7M 'background' image-mask pairs."
  - Sources: "COCONut-Large (0.36M images), Object365V2 (2.02M images), GoogleLandmarkV2 (4.13M images)" and "a natural scene dataset (7.49M images) that we curated and collected." That last set is about 53% of the images, and its origin is not named.
  - Masks: "adopt an Auto-Labeling framework" integrating "AlphaCLIP and SAM to obtain fine-grained segmentation masks for foreground and background."
  - Pre-training at "a resolution of 512×512" for "200K iterations". The PixelHacker README does not describe the dataset.
- **PixelHacker fine-tuning: Confirmed.** "we fine-tune PixelHacker on Places2, CelebA-HQ, and FFHQ" (120K / 90K / 60K iterations, as summarised by WebFetch).
- **Moebius distillation data: Not found.** The README, project page, HF card and the arXiv HTML pages I could read don't state it. The paper says "We set PixelHacker [54], a SOTA LCG-based model, as our teacher network." `utils_train.py` takes data from configurable `--train_data_path` / `--data_config` and names no dataset.
- **Moebius fine-tuning: Partly.** The checkpoint folders are named `ft_places2`, `ft_celebahq` and `ft_ffhq`. The paper says "fine-tuning on established academic benchmarks (e.g., Places2, CelebA-HQ) remains the standard evaluation paradigm." The README gives download sources: Places2 (official page), CelebA-HQ (OpenXLab), FFHQ (Google Drive). Iteration counts: Not found. The arXiv HTML content past about character 68,000 did not contain the implementation-details section.
- **Venue:** the arXiv page lists "arXiv:2606.19195v1, submitted 17 June 2026" with no conference. The README calls it ECCV'26 ("accepted to ECCV'26", as summarised).

**Compared with prior work:** batch 1 said the training data was "Not stated". The PixelHacker paper names three of its four sources.

## Item 5. Running in a browser

### 5a. Browser/ONNX ports

- **`simonw/moebius-web` + `simonw/Moebius-ONNX`: Confirmed** (third-party port, made with Claude Code). The only other ports found are `iky1e/moebius-pretrained-mlx-f32` (MLX) and a ComfyUI extension (`b2renger/ComfyUI_moebius_inpainting`). Neither is a browser port, and I did not open them.

| Field | Finding | Source |
|---|---|---|
| Repos | Code: github.com/simonw/moebius-web. Weights: huggingface.co/simonw/Moebius-ONNX. Demo: simonw.github.io/moebius-web/ | README; HF card; blog https://simonwillison.net/2026/Jun/22/porting-moebius/ |
| Licence | README: "Apache 2.0, inherited from the upstream". **The GitHub repo shows no sidebar licence and no LICENSE file in its root listing.** HF repo: tag apache-2.0 plus a `LICENSE` (11.2 kB) | github.com/simonw/moebius-web; HF tree |
| Export | `python/export_onnx.py`: `--opset` default 18, `torch.onnx.export`. notes.md: "torch.onnx.export (legacy tracer, opset 18) traced all 3 graphs cleanly." Only the batch axis is dynamic; spatial size is fixed. UNet inputs: `latent` (B,9,64,64), `timesteps` int64, `input_ids` int64; output `noise`. VAE encoder outputs `moments` (B,8,64,64) | raw export_onnx.py; notes.md |
| Precision | fp32: "These are fp32 exports, for numeric parity with the reference pipeline." fp16 is a TODO ("fp16 export to ~450MB UNet"); "VAE fp16 unstable: decoder Cast issue." | HF card; notes.md |
| Files and sizes | `unet.onnx` 907 MB, `vae_decoder.onnx` 198 MB, `vae_encoder.onnx` 137 MB; repo total 1.24 GB. The README says "~1.27 GB", which is the figure in the brief | HF tree; README |
| ORT-web version | notes.md: "onnxruntime-web (1.27.0)". `web/package.json`: `"onnxruntime-web": "^1.20.1"` (a semver range) | raw notes.md, package.json |
| Execution provider | `import * as ort from "onnxruntime-web/webgpu"`; `"gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"]`; `graphOptimizationLevel: "all"`. The code reports `ep[0]`, not the EP that was actually selected | raw web/src/pipeline.ts |
| Measured speed | **Not found** for any GPU or browser. The only measurement is "~8.9 s/step on CPU (×19 steps + CFG ×2 = 38 UNet passes ≈ 2:48 total)" on Apple Silicon, using the PyTorch reference (torch 2.7.1). research.md *estimates* "several hundred ms to ~1.5s/step on a decent laptop via WebGPU". Hackaday [secondary] reports no speed either | notes.md (GitHub and HF); research.md; hackaday.com 2026-07-10 |
| Parity | decoder max\|Δ\|≈5.7e-5; UNet ≈3.6e-6 (CPU EP); full-pipeline mean\|Δ\|≈0.0022 | HF card |

### 5b. Moebius inference settings (upstream code): **Partly** (the defaults disagree)

| Setting | Value (quoted) | Source |
|---|---|---|
| Steps | `--num-step` default 20; `__call__` `num_steps=20,` with `strength=0.99,`. The port says "20 steps with `strength≈0.99` ⇒ 19 actual steps." The paper's Table 1 lists 20 steps as the "default setting" | infer/utils.py; removal/v1_2/pipeline.py; arXiv HTML |
| Scheduler | `DDIMScheduler`, `beta_start=0.00085, beta_end=0.012, beta_schedule="scaled_linear",` `num_train_timesteps=1000, clip_sample=False` | infer/utils.py |
| Guidance (CFG) | **Three different defaults:** `--cfg` default 2.5 (utils.py); README example `--cfg 2.0`; pipeline `guidance_scale=4.5,`. The port's UI defaults to 2. CFG uses class-id embeddings, not text: `self.input_ids` is built from integer ids (cond 0–9, uncond 10–19). No text encoder, `encoder_hidden_states` or `added_cond_kwargs` | utils.py; README; pipeline.py; port pipeline.ts / index.html |
| Resolution | `image_size: 512` (moebius.yaml); `--resolution` default 512. The pipeline scales the short side to 512 and floors each side to a multiple of 64 (`w_t // 64 * 64`). The port is fixed at 512×512 because "the model's cross-attention uses a relative-position embedding tied to the trained resolution" | moebius.yaml; utils.py; pipeline.py; simonw HF card |
| Mask format | Greyscale L, thresholded: `input_mask.point(lambda x: 0 if x < 255 / 2 else 255, 'L')`. **White (255) = hole**, since the masked image is `image * (1 - mask)`. Dilation is off by default (`mask_dilate_kernel_size=0`). UNet input has 9 channels: noisy latent (4) + mask (1) + masked-image latent (4) | pipeline.py; moebius.yaml (`in_channels: 9`) |
| Image normalisation | `/ 255. * 2 - 1` → [-1, 1] | pipeline.py |
| Noise offset | `--noise-offset` default 0.0357 (the pipeline default is None) | utils.py; pipeline.py |
| Paste-back | `--pst` default True; GaussianBlur(radius=3) mask blend | utils.py; pipeline.py |
| Run dtype | Pipeline built with `dtype=torch.float` | utils.py |

Latency: "26.01 ms per step on a single GPU". The README, project page and paper don't name the GPU or the resolution. The batch-1 "L40S" came from Gigazine **[secondary]** and was not re-checked here.

### 5c. ORT-web WebGPU operator problems: **Partly**

- **Reported by the port:**
  - Safari: "The self-attention `pos_conv` is exported as Conv2d rather than Conv3d so the graph compiles on Safari's Metal WebGPU backend" (moebius-web README). notes.md: Conv3d "runs on a naive WebGPU kernel that may be slow"; "Einsum ✓" registered.
  - GroupNorm is decomposed into covered ops, which "still needs confirming in the browser".
  - **Inconsistency:** `export_onnx.py` contains no Conv3d→Conv2d patch, so the patch must live elsewhere (not located).
- **ONNX Runtime GitHub issues naming Moebius: Not found.** The issue search page was robots-blocked, and web searches returned none. #26732 (fp16 overflow on WebGPU, Gemma 3) is general fp16 context only.

## File and licence table

| File | Size | Host | Licence as stated (quoted) |
|---|---|---|---|
| `pretrained/diffusion_pytorch_model.bin` (Moebius UNet, fp32 `FloatStorage`) | 905 MB | huggingface.co/hustvl/Moebius | HF: "License: mit"; GitHub: "released under the Apache License 2.0" |
| `ft_places2/…bin`, `ft_celebahq/…bin`, `ft_ffhq/…bin` | 905 MB each | same | same |
| `vae/diffusion_pytorch_model.bin` (fp16 `HalfStorage`) | 167 MB | huggingface.co/hustvl/PixelHacker | HF: "License: mit"; GitHub: Apache-2.0 (unfilled appendix); paper: "pretrained SDXL-VAE" |
| `vae/config.json` | 788 B | same | same |
| `diffusion_pytorch_model.bin` / `.safetensors` / `sdxl_vae.safetensors` | 335 MB each | huggingface.co/stabilityai/sdxl-vae | `license: mit` (front-matter only; no LICENSE file) |
| `diffusion_pytorch_model.bin` / `.safetensors` / `sdxl.vae.safetensors` / `sdxl_vae.safetensors` | 335 MB each | huggingface.co/madebyollin/sdxl-vae-fp16-fix | `license: mit` (front-matter only; no LICENSE file) |
| `vae/diffusion_pytorch_model.safetensors` / `.fp16.safetensors` | 335 MB / 167 MB | huggingface.co/stabilityai/stable-diffusion-xl-base-1.0 | "License: openrail++" / "CreativeML Open RAIL++-M License" |
| `unet.onnx` | 907 MB | huggingface.co/simonw/Moebius-ONNX | "License: apache-2.0" + LICENSE 11.2 kB |
| `vae_decoder.onnx` | 198 MB | same | same |
| `vae_encoder.onnx` | 137 MB | same | same |

**[analysis]** An fp32 ONNX set for LightBench matching the port would be about 1.24 GB (UNet 907 + encoder 137 + decoder 198 MB).

## Blocked or unread sources

| URL | Problem |
|---|---|
| https://github.com/hustvl/Moebius/tree/main/infer, …/tree/main/config | ROBOTS_DISALLOWED (individual files read via raw.githubusercontent.com instead) |
| https://github.com/microsoft/onnxruntime/issues?q=Moebius | ROBOTS_DISALLOWED |
| https://arxiv.org/abs/2606.19195 | Proxy HTTP 429 (rate limited; told not to retry). Used https://arxiv.org/html/2606.19195v1 and https://huggingface.co/papers/2606.19195 instead. |
| https://arxiv.org/html/2606.19195v1 (implementation-details section) | Read at offsets 0, 30000, 60000 and 68000; the section was not found in the returned text |
| https://dev.to/nerdhead_01/running-a-200m-parameter-inpainting-model-entirely-in-the-browser-3bg6 | Fetch refused (earlier client_error); not read, so it is unknown whether this is a separate port |
| Moebius `encode_clean_latents` / `predict_noise` helpers; the location of the port's Conv3d→Conv2d patch | Not located (not fetched) |
| The Moebius paper's own statement of the VAE | Paper (HTML) says only "a pre-trained VAE" with an LDM citation; it does not name SDXL |


---

# LightBench AI Remove: Parts B and C (items 6–9). Mobile models and hosting

All sources were read on **2026-10-17** unless a line says otherwise. Quotes are verbatim and short. **[secondary]** marks a source that isn't the model's own author or vendor. **[analysis]** marks my inference, not a source statement. This file states facts only; it isn't legal advice.

Prior work was used for context only. Every point below was re-checked at its source. Agreements and differences are listed in the last section.

---

## Summary of verdicts

| Item | Sub-item | Verdict |
|---|---|---|
| 6 MI-GAN | LICENSE-WEIGHTS is MIT | **Confirmed** |
| 6 | Released ONNX/inference path needs no NVIDIA-licensed code | **Confirmed** for `create_onnx_pipeline.py` and `migan_inference.py`. **Partly**: `scripts/demo.py` pulls in `torch_utils` indirectly, and exporting from a training `.pkl` may need it |
| 6 | Teacher is Co-Mod-GAN; teacher licence | **Confirmed** (teacher). **Partly** (licence): MI-GAN used its own PyTorch re-implementation, trained by the MI-GAN authors. Official Co-Mod-GAN code is BSD-2 plus Nvidia Source Code License-NC |
| 6 | Training data named (Places2, CelebA-HQ, FFHQ) | **Partly**: Places365-Standard and FFHQ are named. CelebA-HQ is **not** used for MI-GAN |
| 6 | ONNX sizes (256/512) | **Partly**: 512 is published (28.1 MB pipeline, 29.5 MB core). No official 256 ONNX |
| 6 | Browser/mobile benchmark | **Partly**: paper (mobile CPU at 256 px) and LiteRT card (Pixel 8a). No browser timing |
| 7 LaMa | Weights licence beyond the repo's Apache-2.0 | **Not found** (formal). Only an informal author comment, plus apache-2.0 tags on third-party mirrors |
| 7 | Training data named | **Confirmed**: Places365-Challenge for Big-LaMa |
| 7 | ONNX size | **Confirmed**: Carve `lama_fp32.onnx` 208 MB. OpenCV Zoo quantized 92.6 MB |
| 7 | DFT op in ORT-web WebGPU / WASM | **Confirmed**: supported in both (opset 17–19, 20+). Whether Carve's graph contains DFT at all: **Not found** (code says it uses MatMul/Cos/Sin) |
| 7 | Mobile benchmark | **Partly**: Qualcomm LaMa-Dilated (CelebA-HQ checkpoint, NPU). None for Big-LaMa |
| 8 Newer small model (2025–2026) | Qualifies under the owner's rule | **Not found**: no new model qualifies. The only sub-100 MB 2025 artefact is a quantized repackaging of Big-LaMa (see the table) |
| 9 GitHub Releases | Per-file limit | **Confirmed** ("under 2 GiB"), but a second GitHub doc words it differently |
| 9 | Bandwidth | **Confirmed**: Releases docs state no limit. The Acceptable Use Policies keep a right to throttle or suspend "significantly excessive" use |

---

## Item 6. MI-GAN (Picsart AI Research, ICCV 2023)

### 6a. Weights licence: **Confirmed (MIT)**
`LICENSE-WEIGHTS`, in full apart from the standard MIT body:
> "MIT License" · "Copyright (c) 2024 Picsart AI Research (PAIR)" · "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software…" · "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software."
— https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE-WEIGHTS

- The code `LICENSE` is also "MIT License", "Copyright (c) 2024 Picsart AI Research (PAIR)". — https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE
- `LICENSE-WEIGHTS` doesn't list which files it covers. The README has **no licence section**. — https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/README.md
- HF `andraniksargsyan/migan` has the tag "License: mit", a 1.08 kB `LICENSE` file and an empty card ("README.md exists but content is empty"). — https://huggingface.co/andraniksargsyan/migan
- [analysis] The MIT condition means a redistributed ONNX file must carry the copyright and permission notice.

### 6b. NVIDIA-licensed code (`dnnlib/`, `torch_utils/`): **Confirmed not needed** for the released ONNX/inference path, with two caveats (**Partly**)
NVIDIA header found in `torch_utils/misc.py` and `dnnlib/util.py`:
> "# Copyright (c) 2021, NVIDIA CORPORATION.  All rights reserved." … "Any use, reproduction, disclosure or distribution of this software and related documentation without an express license agreement from NVIDIA CORPORATION is strictly prohibited."
— https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/torch_utils/misc.py ; https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/dnnlib/util.py

Import lines, file by file:

| File | Role | Imports NVIDIA code? | Evidence (verbatim imports) |
|---|---|---|---|
| `lib/model_zoo/migan_inference.py` | Inference generator used for ONNX | **No** | Only `import numpy as np`, `import torch`, `import torch.nn as nn`, `import torch.nn.functional as F` |
| `scripts/create_onnx_pipeline.py` | Builds `migan_pipeline_v2.onnx` | **No** | Stdlib, cv2, numpy, onnxruntime, PIL, torch, torchvision, tqdm, and `from lib.model_zoo.migan_inference import Generator as MIGAN`. Loads `torch.load(model_path)` into a state dict ("Saved .pt model path.") |
| `scripts/export_inference_model.py` | Training `.pkl` → `migan.pt` / `migan.onnx` | **No direct import**, but see caveat 2 | `from lib.model_zoo.migan_inference import Generator as MIGANGenerator`. Reads `pickle.Unpickler(f).load()` and `resume_data["G_ema"]` from "Path to model (pkl)." |
| `lib/model_zoo/migan.py` | **Training** generator | **Yes** | `from torch_utils.ops import upfirdn2d, conv2d_resample` |
| `lib/model_zoo/comodgan.py` | Co-Mod-GAN teacher | **Yes** | `from torch_utils import misc` · `from torch_utils.ops import upfirdn2d` |
| `scripts/demo.py` | PyTorch demo | **Indirectly** | `from lib.model_zoo.migan_inference import Generator as MIGAN` **and** `from lib.model_zoo.comodgan import (…)`, and comodgan imports `torch_utils` |

URLs: https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/lib/model_zoo/migan_inference.py ; …/scripts/create_onnx_pipeline.py ; …/scripts/export_inference_model.py ; …/lib/model_zoo/migan.py ; …/lib/model_zoo/comodgan.py ; …/scripts/demo.py

- The README's ONNX recipe starts from the released `.pt`: "--model-path ./models/migan_512_places2.pt". `.pkl` appears only in the export-from-training step ("PATH_TO_BEST_PLACES512_PKL").
- **Caveat 1:** running `scripts.demo` imports `torch_utils` through `comodgan.py`, even for MI-GAN.
- **Caveat 2:** [analysis] Unpickling a training `.pkl` needs every class stored in it to be importable. If the snapshot holds `torch_utils` objects, `export_inference_model.py` would need them. Not verified; LightBench doesn't need this step.
- Export settings: the pipeline uses `opset_version=17` with dynamic `height`/`width`. The core `migan.onnx` export uses `opset_version=12`. The pipeline dilates the mask (`F.max_pool2d(mask, 3, stride=1, padding=1)`) and blurs it (`kernel_size=5, sigma=1.0`).

### 6c. Distillation teacher and its licence: **Confirmed (teacher) / Partly (licence)**
- Paper: "we choose Co-Mod-GAN [65] as a teacher network for MI-GAN". "For Co-Mod-GAN we re-implemented it in PyTorch [43], and trained and tested the replicated version." "All the models besides Co-Mod-GAN are taken from their official repositories." — https://openaccess.thecvf.com/content/ICCV2023/papers/Sargsyan_MI-GAN_A_Simple_Baseline_for_Image_Inpainting_on_Mobile_Devices_ICCV_2023_paper.pdf
- So the teacher is the MI-GAN authors' own re-implementation, not the official Co-Mod-GAN release. MI-GAN's Drive also hosts its teacher checkpoints (README: "download pre-trained Co-Mod-GAN models from…", e.g. `comodgan_256_ffhq.pt`). No separate licence for them is stated.
- Official Co-Mod-GAN `LICENSE.txt` has two blocks:
  - BSD-style: "Copyright (c) 2020, Shengyu Zhao, Jonathan Cui, Yilun Sheng, Yue Dong," … "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:"
  - "LICENSE FOR stylegan2", "Nvidia Source Code License-NC": "The Work and any derivative works thereof only may be used or intended for use non-commercially."
  — https://raw.githubusercontent.com/zsyzzsoft/co-mod-gan/master/LICENSE.txt
- The Co-Mod-GAN README has no licence sentence and no stated weights licence. Its pretrained models include Places2 512 and FFHQ 512/1024. — https://raw.githubusercontent.com/zsyzzsoft/co-mod-gan/master/README.md
- [analysis] LightBench would ship only the MI-GAN student, which `LICENSE-WEIGHTS` covers. The teacher's code lineage (StyleGAN2/NVIDIA) shows up only in `torch_utils/` and the training files.

### 6d. Training data: **Partly**
- "To train our models on Places2 dataset we use Places365-Standard subset, which contains ∼ 1.8 million images." (Sec. 4.1)
- FFHQ: "We train the teacher Co-Mod-GAN model and our 256 resolution model on FFHQ by using randomly chosen 60, 000 images".
- **CelebA-HQ is not used to train MI-GAN.** The paper mentions CelebA only for a comparison model: "we have used the model trained on CelebA [38] dataset". Places365-**Challenge** isn't mentioned.
- Released models: `migan_512_places2.pt`, `migan_256_places2.pt`, `migan_256_ffhq.pt` (README).
- [analysis] For general photo removal, the Places2 model's training data is publicly named.

### 6e. ONNX file sizes: **Partly** (512 only, officially)
| File | Size | Source |
|---|---|---|
| `migan_pipeline_v2.onnx` (MI-GAN-512-Places2 pipeline; any H×W uint8 in) | **28.1 MB** | https://huggingface.co/andraniksargsyan/migan/tree/main ("5 commits") |
| `migan.onnx` (core generator; resolution not stated on HF) | **29.5 MB** | same |
| 256 ONNX | **Not published** officially. Export it with `--resolution 256` | README |
| [secondary] LiteRT `migan_fp16.tflite` (512 Places2) | 16.3 MB | https://huggingface.co/litert-community/MI-GAN-512-Places2-LiteRT |
| [secondary] MLX fp16 256 Places2 | 12.6 MB, "Weights license: mit" | https://huggingface.co/mlx-community/MI-GAN-256-places2-fp16 |

Parameters (paper, Tables 1–2): 5.95 M at 256 (11.19 GFLOPs) and 5.98 M at 512 (15.69 GFLOPs).

### 6f. Browser and mobile benchmarks: **Partly**
- **Paper (mobile CPU, 256 px, ONNX):** "All models in Table 3 are using CPUs of mobile devices and are deployed by using the neural network framework ONNX". MI-GAN mean latency: iPhone 7 1030.25 ms, iPhone X 630.80, iPad mini 5 552.40, iPhone 14 Pro Max 296.00, Galaxy Tab S7+ 686.17, Galaxy S8 1476.40, vivo Y12 2918.08 ms.
- **[secondary] LiteRT community (Google's LiteRT org on HF):** Pixel 8a (Tensor G3, Android 16), fp16. LiteRT `CompiledModel` GPU "~6 ms". TFLite GPU delegate (OpenCL) 68.1 ms. XNNPACK CPU "declined the graph". — https://huggingface.co/litert-community/MI-GAN-512-Places2-LiteRT
- **[secondary] RETHINED paper (2025)** measured MI-GAN at 2300.80 ms on an iPhone XS and 1200.80 ms on an iPad Pro M2. Resolution isn't stated in Table 2; Table 3 gives 1024² and 2048². — https://arxiv.org/pdf/2503.14757
- **Browser:** `lxfater/inpaint-web` (GPL-3.0) is "powered by webgpu and wasm on the browser" and credits MI-GAN. **No timings, devices or ORT version** are given. — https://github.com/lxfater/inpaint-web. MI-GAN's README lists it ("an open-source tool for in-browser inpainting") and `inpaint_wechat` ("a WeChat mini-program for on-device inpainting").
- **[secondary] Flutter `seika`:** runs MI-GAN and LaMa through ONNX Runtime on iOS/Android ("onnxruntime-objc 1.23.0"). It lists MI-GAN at "80 MB" and its speed only as "Fast"; no timings. — https://pub.dev/documentation/seika/latest/
- **No published ONNX Runtime Web timing on named hardware was found.**

---

## Item 7. LaMa / Big-LaMa (Samsung, 2021)

### 7a. Weights licence beyond the repo's Apache-2.0: **Not found** (no formal statement)
- Repo `LICENSE`: "Apache License", "Version 2.0, January 2004", appendix "Copyright [2021] Samsung Research". — https://raw.githubusercontent.com/advimman/lama/main/LICENSE
- The README has **no licence section**. Its download is a third-party mirror: "The best model (Places2, Places Challenge):" `curl -LJO https://huggingface.co/smartywu/big-lama/resolve/main/big-lama.zip`. — https://raw.githubusercontent.com/advimman/lama/main/README.md
- Issue #230, "LaMa Pre-trained Model License (from authors of Inpaint Anything)", asks: "may I ask if the license of the weights is the same as this repo (Apache 2.0)?" Reply from **senya-ashukha** (Arsenii Ashukha, a LaMa author): "on the license --- I'm quite sure that repo says apache 2.0 ;-)". Date and state weren't visible in this read; the prior file recorded 2023-04-25, closed. — https://github.com/advimman/lama/issues/230
- HF `smartywu/big-lama`: "License: apache-2.0". The card says: "We host the pretrained model here for easier download by the community:". One file, `big-lama.zip` **381 MB**; "3 commits", 1 contributor (smartywu). — https://huggingface.co/smartywu/big-lama ; …/tree/main
- HF `Carve/LaMa-ONNX`: "License: apache-2.0", uploader org **Carve**. The tree page shows "This model has 1 file scanned as suspicious", while every listed file is shown as "Safe" (new observation). — https://huggingface.co/Carve/LaMa-ONNX ; …/tree/main

### 7b. Training data: **Confirmed**
- "# Places365-Challenge: Train(476GB) from High-resolution images (to train Big-Lama)" (README). Places365-Standard and CelebA-HQ are listed for other LaMa configs.
- [secondary] LibreYOLO's card for the OpenCV graph: "The graph was trained on Places365-Challenge." — https://huggingface.co/LibreYOLO/LibreLaMab-restore

### 7c. ONNX sizes: **Confirmed**
| File | Size | Notes | Source |
|---|---|---|---|
| Carve `lama_fp32.onnx` (recommended) | **208 MB** | opset 17, "Custom FourierUnitJIT"; "The input shape is fixed at 512x512 pixels." | https://huggingface.co/Carve/LaMa-ONNX |
| Carve `lama.onnx` | 207 MB | opset 18, dynamo export, "Custom DFT irfftn Logic"; card says it runs slowly | same |
| [secondary] OpenCV Zoo `inpainting_lama_2025jan.onnx` | **92.6 MB** | "Model source: ONNX" → `Carve/LaMa-ONNX/blob/main/lama_fp32.onnx`; "All files in this directory are licensed under Apache License". LibreYOLO describes it as a "fixed-512 QDQ ONNX graph" at opset 21 | https://huggingface.co/opencv/inpainting_lama ; …/tree/main |
| [secondary] Qualcomm LaMa-Dilated | 174 MB float, 45.6 M params | "Model checkpoint: Dilated CelebAHQ" (a face model, not Big-LaMa) | https://huggingface.co/qualcomm/LaMa-Dilated |
| [secondary] `mlboydaisuke/LaMa-CoreML` | 187 MB `.mlpackage.zip` | "License: apache-2.0"; about 600 MB peak RAM; iOS 17+ | https://huggingface.co/mlboydaisuke/LaMa-CoreML |

The MI-GAN paper lists LaMa at 27.05 M params (128.06 GFLOPs at 512).

### 7d. FFT/DFT and ONNX Runtime Web: **Confirmed (op support) / Not found (whether the graph uses DFT)**
- **WebGPU EP (JSEP operator list):** "| DFT | ai.onnx(17-19,20+) |  |". MatMul, Cos and Sin are also listed. — https://raw.githubusercontent.com/microsoft/onnxruntime/main/js/web/docs/webgpu-operators.md
- **Native WebGPU EP source:** `KERNEL_CREATE_INFO_VERSIONED(17, 19, DFT),` · `KERNEL_CREATE_INFO(20, DFT),`. No STFT. — https://raw.githubusercontent.com/microsoft/onnxruntime/main/onnxruntime/core/providers/webgpu/webgpu_execution_provider.cc
- **WASM:** the ORT-web README says "ONNX Runtime Web currently support all operators in ai.onnx and ai.onnx.ml." The CPU kernel table registers DFT for opsets [17, 19] and 20+, float/double. — https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/README.md ; https://raw.githubusercontent.com/microsoft/onnxruntime/main/docs/OperatorKernels.md
- **WebNN:** no DFT row. — https://raw.githubusercontent.com/microsoft/onnxruntime/main/js/web/docs/webnn-operators.md
- **Does Carve's recommended graph use DFT?** The fork's `FourierUnitJIT` avoids `torch.fft` and computes the DFT by matrix multiplication: "cos_part = torch.cos(-2 * torch.pi * n[:, None] * k / N)", "real_part = torch.matmul(x, cos_part)". The default `FourierUnit` uses "torch.fft.rfftn". — https://raw.githubusercontent.com/Carve-Photos/lama/main/saicinpainting/training/modules/ffc.py
  - [secondary] artiva-ai: "the FFT of the Fourier units is written with MatMul/Cos/Sin" "so it runs on WebGPU." — https://huggingface.co/artiva-ai/modelos
  - [analysis] `lama_fp32.onnx` therefore probably has **no DFT node**. The graph wasn't inspected, so this is unconfirmed; run the T3 test in `verify2/F_MODEL_DELIVERY.md`.
- No GitHub issue reporting DFT failures on ORT-web was found (search only; not exhaustive).
- **[secondary] Browser precedent:** `luojiyin1987/Instant-Cleanup` (MIT) loads "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx" with `onnxruntime-web@1.26.0`; it "prefers WebGPU, and falls back to single-threaded WASM". No timings. — https://github.com/luojiyin1987/Instant-Cleanup

### 7e. Mobile benchmark: **Partly**
- [secondary] Qualcomm AI Hub, **LaMa-Dilated (CelebA-HQ checkpoint)** at 512×512, float, NPU: Snapdragon 8 Elite Gen 5 (ONNX) 34.369 ms; 8 Elite (TFLite) 41.616 ms; 8 Gen 1 (ONNX) 109.352 ms. — https://huggingface.co/qualcomm/LaMa-Dilated
- RETHINED left LaMa out of its device table because of its memory footprint. — https://arxiv.org/pdf/2503.14757
- **No Big-LaMa (Places) phone benchmark was found.**

---

## Item 8. Newer small inpainting models (2025–2026): **Not found**. None qualifies

Owner's rule: permissive weights, publicly named training data, under ~100 MB, and runs in ORT-web or on phones. No model **first released in 2025–2026** meets all four. Results:

- **RETHINED** (Crisalix/NVIDIA/UPF et al., WACV 2025): "latency at or below 30 ms" on mobile devices. The paper says "Code and dataset here." with no URL. **No weights or licence were found.** Training images come from "DF2K original dataset" (DIV2K, Flickr2K, CAFHQ). A US patent PDF titled "Method for high resolution image inpainting…" (US 12165294) came up in search; its link to RETHINED was **not verified**. — https://arxiv.org/abs/2503.14757 ; https://arxiv.org/pdf/2503.14757
- **OpenCV Zoo `inpainting_lama_2025jan`** (2025): a quantized repackaging of Big-LaMa, not a new model. 92.6 MB, Apache-2.0 (OpenCV), Places365-Challenge. It inherits LaMa's informal weights-licence status (7a). No browser or phone timing.
- **MI-GAN successors:** none found from Picsart. Only third-party conversions exist: LiteRT fp16 16.3 MB, MLX fp16, and `FreeHugsForRobots/ps-inpaint-migan` ("Bare generator extracted from andraniksargsyan/migan migan_pipeline_v2.onnx", "License: mit"). — https://huggingface.co/FreeHugsForRobots/ps-inpaint-migan
- **"MobileInpaint" / "TinyInpaint":** **Not found** as models.
- **Diffusion object removers (2025):** too large, and some have restrictive licences. Example: ObjectClear, "built on SDXL-Inpainting", "licensed under NTU S-Lab License 1.0". — https://github.com/zjx0101/ObjectClear. Moebius (0.22 B, about 1.27 GB) is Part A's model.
- **Apple Clean Up, Google Magic Eraser, Samsung Object Eraser:** no public weights were found (not searched in depth).
- **GitHub topic `object-removal`** (sorted by updated): the browser and on-device repos all reuse **LaMa** or **MI-GAN**. — https://github.com/topics/object-removal?o=desc&s=updated

### Candidate comparison table

| Model | Weights licence | Code licence | Training data | ONNX size | Browser / mobile evidence | Passes owner's rule? |
|---|---|---|---|---|---|---|
| **MI-GAN 512 Places2** (2023) | **MIT** (`LICENSE-WEIGHTS`) | MIT. NVIDIA-notice `torch_utils/`/`dnnlib/` used only by training/demo | Places365-Standard (~1.8 M); teacher re-trained by the authors | **28.1 MB** pipeline / 29.5 MB core (fp32) | Paper: phone CPU 296–2918 ms at 256; LiteRT Pixel 8a GPU ~6 ms / 68.1 ms **[secondary]**; inpaint-web (WebGPU/wasm, no timings) | **Yes** |
| **MI-GAN 256 Places2/FFHQ** | MIT | MIT | Places365-Standard / FFHQ 60k | No official ONNX (exportable) | Paper Table 3 (256) | **Yes** (would need LightBench's own export) |
| **Big-LaMa** (Carve ONNX) | No formal statement. Repo Apache-2.0; author: "quite sure… apache 2.0"; mirrors tagged apache-2.0 | Apache-2.0 | Places365-Challenge | 208 MB fp32 | Instant-Cleanup (ORT-web 1.26, WebGPU→WASM, no timings) **[secondary]** | **Partly**: data named, weights terms informal, over 100 MB |
| **OpenCV Zoo LaMa 2025jan** (quantized) | Apache-2.0 (OpenCV directory statement), on top of LaMa's informal status | Apache-2.0 | Places365-Challenge | **92.6 MB** (QDQ, opset 21) | None found | **Partly**: under 100 MB, but same weights-terms caveat; QDQ on ORT-web WebGPU untested |
| **LaMa-Dilated** (Qualcomm) | apache-2.0 tag; points to LaMa licence | Apache-2.0 | Not stated (checkpoint "Dilated CelebAHQ", faces) | 174 MB | Snapdragon NPU 34–109 ms **[secondary]** | **No**: face checkpoint, over 100 MB, data not stated |
| **RETHINED** (2025) | Not released | Not released | Not named (DF2K images for its dataset) | n/a | Paper: iPhone XS 112.3 ms, iPad Pro M2 17.59 ms | **No**: no weights |
| **ObjectClear** (2025) | NTU S-Lab License 1.0 | same | OBER dataset | SDXL-scale (multi-GB) | n/a | **No** |
| **Co-Mod-GAN** (teacher) | Not stated | BSD-2 + Nvidia Source Code License-NC | Places2, FFHQ | n/a (79.79 M params) | Paper: phone CPU 1374–4475 ms at 256 | **No** |

---

## Item 9. GitHub Release assets

### 9a. Per-file limit: **Confirmed**, with a wording difference between two docs
- "Each file included in a release must be under 2 GiB." · "Up to 1000 release assets may be associated with a single release." — https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
- The "About large files" page puts it differently: "each individual file must be smaller than the maximum file size limit for Git LFS on your plan." — https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
- Git LFS maximums: GitHub Free "2 GB", Pro "2 GB", Team "4 GB", Enterprise Cloud "5 GB". — https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage
- [analysis] On a Free or Pro account the two pages roughly agree (about 2 GB). Keep each asset **under 2 GiB** to satisfy both. Moebius's ~1.27 GB total is fine if no single file reaches 2 GiB.

### 9b. Bandwidth: **Confirmed** (no stated limit, plus a reserved right to throttle)
- "There is no limit on the total size of a release, nor bandwidth usage." — About releases (URL above)
- "If you need to distribute large files within your repository, you can create releases on GitHub.com" · "We don't limit the total size of the binary files in the release or the bandwidth used to deliver them." — About large files (URL above)

### 9c. Acceptable Use and Terms: **Confirmed** (general clauses only; nothing specific to releases)
- AUP **§9 "Excessive Bandwidth Use"**: "The Service's bandwidth limitations vary based on the features you use." · "If we determine your bandwidth usage to be significantly excessive in relation to other users of similar features," · "we reserve the right to suspend your Account, throttle your file hosting, or otherwise limit your activity" · "until you can reduce your bandwidth consumption." · "We also reserve the right—after providing advance notice—to delete repositories" · "that we determine to be placing undue strain on our infrastructure." — https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies
- AUP §6: "You will not reproduce, duplicate, copy, sell, resell or exploit any portion of the Service" without express written permission.
- The AUP doesn't mention CDN use or binary distribution specifically.
- Terms of Service ("Effective date: April 27, 2026"), §C: "You agree that you will not under any circumstances violate our Acceptable Use Policies or Community Guidelines." The words "bandwidth" and "throttling" don't appear in the ToS. — https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- Repo size guidance (for git content, not release assets): "We recommend repositories remain small, ideally less than 1 GB, and less than 5 GB is strongly recommended." · "GitHub blocks files larger than 100 MiB." — About large files

### 9d. Related: CORS on release downloads (context)
- Community discussion #45446, "Download release assets and zipball with CORS" (opened Jan 26, 2023; "Unanswered"; labelled Bug). The release assets bucket lacks CORS. Latest comments are from Nov 2025; no staff reply. — https://github.com/orgs/community/discussions/45446
- [analysis] This doesn't affect the owner's plan, where the user clicks a link and then picks the downloaded files in the app. It would matter only if the app tried to `fetch()` assets directly.

---

## Agreement with prior work

| Prior claim (file) | Now |
|---|---|
| MI-GAN code and weights MIT; NVIDIA files only in training code (PHASE4) | **Agrees.** Refined: `scripts/demo.py` also pulls in `torch_utils` via `comodgan.py`; the ONNX pipeline script does not |
| MI-GAN data: Places365-Standard, FFHQ (PHASE4) | **Agrees.** The brief's "CelebA-HQ" is not used by MI-GAN |
| Co-Mod-GAN weights licence "Not stated"; code BSD + NVIDIA NC (PHASE4) | **Agrees.** New: MI-GAN's teacher was its own PyTorch re-implementation, trained by the MI-GAN authors |
| MI-GAN ONNX 28.1 MB / 29.5 MB (PHASE4, F) | **Agrees.** New: LiteRT fp16 16.3 MB with Pixel 8a timings **[secondary]** |
| LaMa weights: no upstream statement; informal "quite sure… apache 2.0" (F6) | **Agrees** |
| Carve 208 MB, opset 17, fixed 512; DFT presence "Not found" (F) | **Agrees.** New: the FourierUnitJIT code uses MatMul/Cos/Sin, so probably no DFT node (unconfirmed); ORT DFT support confirmed for WebGPU (JSEP and native) and WASM |
| smartywu `big-lama.zip` 381 MB, 3 commits (F) | **Agrees** |
| Releases "under 2 GiB", 1000 assets, no bandwidth limit (PHASE4) | **Agrees.** New: the "About large files" wording ties the limit to the Git LFS plan maximum; AUP §9 quoted |
| New | OpenCV Zoo 92.6 MB quantized LaMa (2025); Qualcomm LaMa-Dilated NPU timings; Carve repo shows "1 file scanned as suspicious" |

## Blocked or unavailable sources
- https://github.com/opencv/opencv_zoo/tree/main/models/inpainting_lama: **ROBOTS_DISALLOWED**. Used the HF mirror and the raw README instead.
- https://dev.to/nerdhead_01/running-a-200m-parameter-inpainting-model-entirely-in-the-browser-3bg6: fetch error.
- MI-GAN Google Drive folder (https://drive.google.com/drive/folders/1xNtvN2lto0p5yFKOEEg9RioMjGrYM74w): file list not visible, so `.pt` sizes are unknown.
- https://github.com/zsyzzsoft/co-mod-gan (HTML): licence section not rendered. Used raw `LICENSE.txt` and `README.md`.
- Carve `README.md` raw: the tool returned a summary only, not verbatim text. Quotes come from the rendered card.
- Issue #230 date and state weren't visible in this read; the values given are from the prior file.
- Not inspected (needs a local tool): the op list inside `lama_fp32.onnx` and `inpainting_lama_2025jan.onnx`.

---

## The Cowork prompt

    # Research verification for LightBench: AI Remove models (Cowork prompt, 2026-10-17)
    
    You are verifying facts for **LightBench**, a free GPL-3.0 photo editor that runs in the browser (WebGPU, ONNX Runtime Web) and keeps all photos on the user's device.
    
    **Owner's decisions (2026-10-17):**
    - **Moebius** (HUST + vivo, ECCV 2026; https://github.com/hustvl/Moebius) will be the **best-quality AI Remove**, an optional ~1.27 GB download. The owner accepts it **even if its teacher model's training data stays unnamed** (an exception to LightBench's rule that training data must be publicly named). The **weights' licences must still be permissive**.
    - LightBench will publish its **own ONNX conversion** of Moebius as **GitHub Release assets**; the app shows a download link and the user picks the files.
    - A **smaller model for a future mobile version** will be chosen later; research it now.
    
    The build environment can't open Hugging Face, arXiv or many vendor sites, so check each item at its **primary source**.
    
    ## How to work
    - Open each primary source (model card, LICENSE file, README, paper, config file).
    - Give a verdict per item: **Confirmed**, **Contradicted** (say what is true instead), **Partly** or **Not found**.
    - Quote the exact text, short and verbatim, with its URL and the date you read it.
    - Label secondary sources as secondary. Don't guess. Facts only, no legal advice.
    
    ## What to return
    One Markdown file, `AI_REMOVE_MODELS.md`, starting with a **"Decisions this changes"** table, then the verdicts item by item, then a list of blocked sources.
    
    ## Items
    
    ### Part A: Moebius (best quality)
    1. **Weights licence.** Quote Moebius's README licence section and LICENSE file. Are all Moebius checkpoint files covered (UNet and any others)? Which Hugging Face repo hosts them, and does its model card state a licence?
    2. **The VAE.** Moebius's README says the VAE comes from `hustvl/PixelHacker` (config `scaling_factor: 0.13025`, matching SDXL's VAE). Find:
       - the exact VAE files Moebius tells users to download, and the repo/model card hosting them;
       - the licence stated for those files (PixelHacker's repo licence, its HF card, and whether it is in fact `stabilityai/sdxl-vae` or derived from it);
       - if it is SDXL's VAE: the licence on `stabilityai/sdxl-vae` (or `madebyollin/sdxl-vae-fp16-fix` if that is what's used) — quote it.
    3. **Redistribution.** Do the Moebius and VAE licences allow LightBench to redistribute converted (ONNX) copies as GitHub Release assets? Quote any NOTICE or attribution requirements.
    4. **Training data, for the model notice** (the owner accepts it either way): what PixelHacker's paper and README say about its ~14 M image–mask pre-training set (sources named or not), and what Moebius fine-tunes on (Places2, CelebA-HQ, FFHQ?). Quote the sentences.
    5. **Running it in a browser.**
       - `moebius-web` (or any other browser/ONNX port): repo URL, licence, how it exported the ONNX (scripts, opset, fp16/fp32), file names and sizes, which ONNX Runtime Web version and execution provider, measured speed on any named GPU.
       - Moebius's inference settings: number of diffusion steps, guidance, input resolution, mask format.
       - Any ONNX Runtime Web WebGPU operator problems reported for it.
    
    ### Part B: smaller models for a future mobile version
    6. **MI-GAN** (https://github.com/Picsart-AI-Research/MI-GAN): quote `LICENSE-WEIGHTS`; confirm whether the released ONNX/inference path needs any NVIDIA-licensed code (`dnnlib/`, `torch_utils/`); its distillation teacher (Co-Mod-GAN) and that teacher's licence; training data named; ONNX file sizes (256/512); any browser/mobile benchmark.
    7. **LaMa / big-lama** (https://github.com/advimman/lama): is there any licence statement for the weights beyond the repo's Apache-2.0 LICENSE (README, Hugging Face card `smartywu/big-lama`, `Carve/LaMa-ONNX`)? Training data named; ONNX size; the FFT/DFT operator's support in ONNX Runtime Web (WebGPU and WASM); any mobile benchmark.
    8. **Any newer small inpainting model (2025–2026)** with permissive weights, named training data and under ~100 MB that runs in ONNX Runtime Web or on phones. Give licence, training data, size and evidence for each.
    
    ### Part C: hosting
    9. **GitHub Release assets:** confirm the current per-file size limit and any bandwidth or "acceptable use" limits for large binary downloads (GitHub Docs, "About releases" and the Terms/Acceptable Use for release assets). Quote them.
