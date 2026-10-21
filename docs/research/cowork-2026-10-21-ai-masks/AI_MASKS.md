# AI_MASKS.md: research check for LightBench AI masks (subject, people, face, sky)

- **Date read:** 2026-10-21. Every source below was read on this date unless noted.
- **Prompt:** COWORK_AI_MASKS_2026-10-21.md
- **Scope:** facts only. This is not legal advice.

**How the quotes were obtained**

- **GitHub files** (README, LICENSE, source code): downloaded raw from raw.githubusercontent.com, so those quotes are exact.
- **Hugging Face, arXiv, Meta, Google and dataset pages:** read through a web-fetch tool that passes each page through a summarising model. Quotes from these are as close to the original as the tool returned. Long passages are paraphrased and marked as such.
- **Secondary sources** (third-party pages) are labelled *secondary*.

**Re-checked by hand after the research pass.** Each of these matched:

- the SAM 2 paper's "released model" sentence;
- the WIDER FACE licence line;
- the Depth Anything 3 checkpoint/licence table;
- the training-data sentence on the BiRefNet_lite Hugging Face card.

---

## 1. Passes the owner's rule?

| Model | Weights licence | Training datasets named? | Dataset terms (short) | Verdict |
|---|---|---|---|---|
| **SAM 2.1 Hiera Tiny** | Apache-2.0 | **Partly.** SA-1B, SA-V, DAVIS, MOSE and YouTubeVOS are named. The released model also used Meta's unnamed **"Internal" licensed video** (about 14.8% of the training mix). | SA-1B: research only. SA-V: CC BY 4.0. Internal: not published. | **Fails** (internal data) |
| **SlimSAM-77** | Apache-2.0 | Yes. 10,000 images of SA-1B; base model is SAM-B, which was trained on SA-1B. | SA-1B: research only | **Passes with plain-words note** |
| **BiRefNet_lite (1024, general)** | MIT | Yes, but the sources **conflict**. The GitHub README lists DIS5K, DUTS, HRSOD, UHRSD, HRS10K, P3M-10k and TR-humans. The Hugging Face card says only "trained on DIS-TR". | DIS5K: non-commercial research. DUTS: "all rights reserved", no explicit commercial term. HRSOD: no terms found. UHRSD and HRS10K: their repos are MIT, but it is unclear whether that covers the data. P3M-10k: MIT, for research. TR-humans: Apache-2.0, AI-generated. | **Passes with plain-words note.** Caveat: the conflict and the missing terms. |
| **BiRefNet_lite-2K** | MIT through the GitHub repo. The Hugging Face repo has **no licence metadata**. | Yes. The 1024 list plus AM-2k, AIM-500, Human-2k, Distinctions-646, HIM2K, PPM-100 and BG-20k. | Adds PPM-100 (CC BY-NC-SA mattes), Distinctions-646 (academic / non-commercial) and HIM2K (no terms found). | **Unclear.** Licence metadata is missing, and the ONNX is 316 MB. |
| **MediaPipe Selfie Multiclass** | Apache-2.0 | **No.** The card says "thousands of samples with diverse identities". | n/a | **Fails** |
| **YuNet** (OpenCV Zoo) | MIT | Yes. WIDER FACE is named in the training repo (libfacedetection.train). | WIDER FACE: "cc by-nc-nd" | **Passes with plain-words note** |
| **BlazeFace short-range** | Apache-2.0 | **No.** Images were captured in-house on smartphones. | n/a | **Fails** |
| **DA3NESTED-GIANT-LARGE(-1.1)** (has sky output) | CC BY-NC 4.0 | Mostly (see DA3 below) | n/a | **Fails** (weights licence) |
| **DA3METRIC-LARGE** (has sky output) | Apache-2.0 | **Partly.** The paper says "14 datasets" but names 13. The teacher model's synthetic datasets are named. The source of the sky-mask labels is not stated. | Several named sets are non-commercial; not checked one by one | **Unclear.** Also 1.34 GB fp32 / 669 MB fp16. |
| **DA3MONO-LARGE** (has sky output) | Apache-2.0 | **No** for the student model: "unlabeled images" are not named in the DA3 paper. | n/a | **Fails as published** |
| **DA3-SMALL / DA3-BASE** | Apache-2.0 | Yes, named public datasets | n/a | n/a (**no sky output**) |
| **EfficientViT-Seg B1, ADE20K** (sky option) | Apache-2.0 | Yes. ADE20K, plus an ImageNet-pretrained backbone ("ImageNet-1K" per the classification README). | ADE20K: non-commercial research and education. ImageNet terms not checked. | **Passes with plain-words note.** No hosted ONNX. |
| **EfficientViT-Seg B0, Cityscapes** (sky option) | Apache-2.0 | Yes. Cityscapes plus ImageNet. | Cityscapes: non-commercial | **Passes with plain-words note.** Street scenes only. |
| **SegFormer-B0 ADE20K** (NVIDIA / Xenova) | NVIDIA licence, non-commercial | Yes, ADE20K | ADE20K: non-commercial research | **Fails** (weights licence) |
| **RF-DETR-Seg N / S** | Apache-2.0 | **Partly.** COCO is named, and Objects365 is named for pre-training. The pre-training masks are **SAM 2 pseudo-labels** (SAM 2 used internal data). The DINOv2 backbone was trained on LVD-142M, which is not released. | COCO: annotations CC BY 4.0, images under Flickr terms. Objects365: "academic purpose only". | **Unclear** (owner's call on the upstream data) |

**Bottom line**

- **Pass with a plain-words note:** SlimSAM-77 (subject), BiRefNet_lite 1024 (subject/people), YuNet (face), and EfficientViT-Seg (sky; no ready ONNX).
- **Fail:** SAM 2.1 (internal data), both MediaPipe models (unnamed data), DA3 Nested and DA3 Mono, and SegFormer.
- **Unclear:** DA3-Metric, BiRefNet_lite-2K and RF-DETR-Seg.

---

## 2. Verdicts, item by item

### 2.1 SAM 2.1 Hiera Tiny (Meta)

**Checkpoint licence: Confirmed, Apache-2.0.**
- README, "License" section: *"The SAM 2 model checkpoints, SAM 2 demo code (front-end and back-end), and SAM 2 training code are licensed under Apache 2.0"*.
  - Source: https://raw.githubusercontent.com/facebookresearch/sam2/main/README.md
- BSD-3 covers only `LICENSE_cctorch` (an optional post-processing step) and the SA-V evaluation code.
- Checkpoint: `sam2.1_hiera_tiny.pt`, 38.9M params, released 2024-09-29 (README table).

**Training data: Partly. The released model includes unpublished internal data.**

All quotes are from the SAM 2 paper, https://arxiv.org/pdf/2408.00714v2:

- §5.2: *"We also used internally available licensed video data to further augment our training set."*
- §5.2: *"Our internal dataset is comprised of 62.9K videos and 69.6K masklets…"*
- App. D.2.2: *"Our released model is trained on SA-V manual + Internal and SA-1B."* (re-checked by hand)
- App. D.2.2: *"The training data mixture consists of ∼15.2% SA-1B, ∼70% SA-V and ∼14.8% Internal."*
- App. D.2.1: *"We first pre-train SAM 2 on static images on the SA-1B dataset."*

**SAM 2.1 data: Not found.**
- The paper's footnote says its results use the improved version (*"denoted as 'SAM 2.1'"*), but it gives no separate data statement.
- Meta's SAM 2.1 blog post (https://ai.meta.com/blog/fair-news-segment-anything-2-1-meta-spirit-lm-layer-skip-salsa-lingua/) describes only new augmentation, longer sequences and positional-encoding changes. It names no datasets.
- There is no evidence that 2.1 dropped the Internal data.

**SA-1B terms: Confirmed, research only.**
- Source: https://ai.meta.com/datasets/segment-anything/
  - *"License: Limited; see full license language for use"*
  - *"Intended Use Cases: Research purposes only"*
  - *"The images are licensed from a large photo company."*
- The original SAM README names the licence as the *"SA-1B Dataset Research License"*. The full licence text is on the downloads page, which was blocked (see section 3).

**SA-V terms: Confirmed, CC BY 4.0.**
- Source: https://ai.meta.com/datasets/segment-anything-video/
  - *"License: CC BY 4.0"*
  - *"Videos were collected via a contracted third-party company."*
- The repo's `sav_dataset/README.md` says: *"The videos and annotations in SA-V Dataset are released under CC BY 4.0."*

**ONNX export: Partly.**
- Repo: `onnx-community/sam2.1-hiera-tiny-ONNX` (https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX)
  - **No model card and no licence metadata.**
  - `config.json` declares `"architectures": ["Sam2Model"]` and `transformers.js_config`.
- Weight file sizes (each `.onnx_data` file sits beside a graph file of about 0.2–0.4 MB):

| Variant | vision_encoder | prompt_encoder_mask_decoder |
|---|---|---|
| fp32 | 134.1 MB | 21.0 MB |
| fp16 | 67.0 MB | 10.5 MB |
| int8 | 52.6 MB | 8.7 MB |
| q4f16 | 28.5 MB | 4.6 MB |

- **transformers.js:** the README lists "Segment Anything 2", and the library has a `Sam2Model` class.
- **No SAM 2-specific WebGPU demo was found.**
- Related version fact: npm `@huggingface/transformers` 4.3.1 (2026-10-06) depends on `onnxruntime-web 1.31.0-dev.20260914`, not 1.30.0.

### 2.1b SlimSAM-77

**Licence: Confirmed, Apache-2.0.**
- Repo LICENSE: https://raw.githubusercontent.com/czg1225/SlimSAM/master/LICENSE
- Hugging Face metadata says apache-2.0 for both `Zigeng/SlimSAM-uniform-77` and `Xenova/slimsam-77-uniform`.

**Training data: Confirmed.**
- Paper https://arxiv.org/pdf/2312.05284v4, §4.1:
  - *"trained … using only 0.1% (10,000 images) of the SA-1B dataset"*
  - *"The base model of our framework is SAM-B."*
- SAM-B is the original SAM, which is Apache-2.0 and trained on SA-1B (segment-anything README).
- The paper does not say how the 10k images were selected.
- The parameter count differs between sources: the paper says 9.1M; the Hugging Face card says 5.7M.

**ONNX: Confirmed.**
- Repo: `Xenova/slimsam-77-uniform`

| Variant | vision_encoder | prompt_encoder_mask_decoder |
|---|---|---|
| fp32 | 23.3 MB | 16.6 MB |
| fp16 | 12.2 MB | 8.6 MB |
| quantized | 8.9 MB | 4.9 MB |

**WebGPU: Confirmed.**
- The Hugging Face space `Xenova/segment-anything-webgpu` loads `Xenova/slimsam-77-uniform` with `device: "webgpu"`, `dtype: "fp16"` (transformers.js 3.3.3).
- The transformers.js test suite also uses this model.

### 2.2 BiRefNet-lite

**Training data: Partly. Every set is named, but the sources conflict.**

GitHub README model zoo (https://raw.githubusercontent.com/ZhengPeng7/BiRefNet/main/README.md):
- The lite model is the `swin_v1_tiny` "general use" row:
  > "DIS5K-TR, DIS-TEs, DUTS-TR_TE, HRSOD-TR_TE, UHRSD-TR_TE, HRS10K-TR_TE, TR-P3M-10k, TE-P3M-500-NP, TE-P3M-500-P, TR-humans | swin_v1_tiny | DIS-VD"
- The Hugging Face lite card says to set `bb` to `swin_v1_t` for this tiny version.

Hugging Face card `ZhengPeng7/BiRefNet_lite` (https://huggingface.co/ZhengPeng7/BiRefNet_lite), re-checked by hand:
- *"This BiRefNet for standard dichotomous image segmentation (DIS) is trained on DIS-TR and validated on DIS-TEs and DIS-VD."*
- **This contradicts the GitHub row.** The same sentence appears on the general BiRefNet card, so it may have been copied across. Neither source settles which is correct.

BiRefNet_lite-2K:
- There is no row for it in the GitHub table.
- Its Hugging Face card lists a larger set: DIS5K, HRS10K, UHRSD, P3M-10k, TR-humans, AM-2k, AIM-500, Human-2k (composited with BG-20k), Distinctions-646 (composited with BG-20k), HIM2K and PPM-100. This list is paraphrased; the fetch tool would not quote it in full.

The paper (arXiv 2401.03407) covers only the academic models (DIS5K-TR, HRSOD/UHRSD/DUTS, CAMO/COD10K). It does not mention the lite or general models.

**TR-humans** (https://huggingface.co/datasets/schirrmacher/humans):
- Apache-2.0.
- **Synthetic:** people were generated with LayerDiffuse (a Stable Diffusion extension) and composited with IC-Light. *"I created more than 7.000 images with people and diverse backgrounds."*
- The card does not say where all the backgrounds came from.

**Dataset terms:**

| Dataset | Verdict | Quote / source |
|---|---|---|
| DIS5K | Confirmed: non-commercial | *"The Dataset is available for non-commercial use in research or educational purpose."* / *"…commercial use of this dataset is prohibited…"*. Source: https://raw.githubusercontent.com/xuebinqin/DIS/main/DIS5K-Dataset-Terms-of-Use.pdf |
| DUTS | Partly | *"All rights reserved by the original authors of DUTS Image Dataset."* No explicit commercial term. Source: http://saliencydetection.net/duts/ |
| HRSOD | Not found | No terms; no LICENSE file. Source: https://github.com/yi94code/HRSOD |
| UHRSD | Partly | *"can be used for training and testing in future research."* The repo is MIT; unclear whether that covers the data. Source: https://github.com/iCVTEAM/PGNet |
| HRS10K | Partly | No dataset terms. The repo is MIT; unclear whether that covers the data. Source: https://github.com/DrowsyMon/RMFormer |
| P3M-10k | Partly | Agreement: *"The Dataset is under MIT license."* / *"aimed to aid research efforts…"*. Source: https://jizhizili.github.io/files/p3m_dataset_agreement/P3M-10k_Dataset_Release_Agreement.pdf |
| PPM-100 (2K only) | Confirmed: non-commercial mattes | *"All annotated alpha mattes in PPM are released under the Creative Commons Attribution NonCommercial ShareAlike 4.0"*. Source: https://github.com/ZHKKKe/PPM |
| Distinctions-646 (2K only) | Confirmed: academic / non-commercial | *"If you use it for non-commercial uses, please send us an email"*. Source: https://github.com/yuhaoliu7456/CVPR2020-HAttMatting |
| HIM2K (2K only) | Not found | No terms. Source: https://github.com/nowsyn/InstMatt |
| AM-2k, BG-20k, AIM-500 (2K only) | Partly | Only the README link text "Agreement (MIT License)". The agreement PDFs were not opened. |
| Human-2K (2K only) | Partly | The TIMI-Net repo says *"only for research purpose"*. The link between TIMI-Net and Human-2K comes from a secondary survey. |

**Weights licence**
- **Confirmed MIT** for the lite (1024) model:
  - GitHub LICENSE: *"MIT License / Copyright (c) 2024 ZhengPeng"*
  - Hugging Face API for BiRefNet_lite: `license: mit`
- **BiRefNet_lite-2K:** the Hugging Face repo has no licence field. Its card shows only an MIT badge.

**ONNX: Partly. The files exist; WebGPU needs a patched graph (secondary).**
- GitHub release v1:
  - `BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx`: 214 MB
  - `BiRefNet_lite-general-2K-epoch_232.onnx`: 316 MB
- `onnx-community/BiRefNet_lite-ONNX` (MIT):
  - `onnx/model.onnx`: 224 MB
  - `onnx/model_fp16.onnx`: 115 MB
  - Card snippet: `pipeline('image-segmentation', 'onnx-community/BiRefNet_lite-ONNX')`
  - WebGPU is not mentioned.
- *Secondary* evidence:
  - The transformers.js leaderboard shows a completed `webgpu` / `fp32` run.
  - `jiabins0303/birefnet-lite-1024-webgpu` reports that the stock graph's `Split` nodes don't compile on WebGPU, and that the emulated `deform_conv2d` falls back to the CPU EP. It offers a patched fp16 export (115 MB) that needs `maxStorageBuffersPerShaderStage >= 8`.
  - `runes/birefnet-lite-webgpu` makes a similar claim and uses ORT Web 1.27.0.
- **Nothing found tested on ORT Web 1.30.0.**

### 2.3 MediaPipe Selfie Multiclass (Google)

Model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf

**Training data: Not found (not named).**
- The only statement is *"Model is trained on thousands of samples with diverse identities…"*.
- The card's only dataset section describes the evaluation set: 918 images.

**Licence: Confirmed, Apache-2.0.**
- Card: *"Licensed under: Apache License, Version 2.0"*.

**Format: TFLite only from Google.**
- About 16.4 MB (*secondary*, Hugging Face re-upload).
- *Secondary* community ONNX: `FreeHugsForRobots/ps-skin-seg`, `selfie_multiclass_256x256.onnx`, 16.5 MB.

**WebGPU: Contradicted.**
- In `@mediapipe/tasks-vision` the delegate is `'CPU' | 'GPU'`. The GPU path creates a **WebGL** context: *"The task will initialize a WebGL context…"* (`vision_task_options.d.ts`, google-ai-edge/mediapipe).
- No WebGPU option was found.

### 2.4 YuNet (OpenCV Zoo)

**Licence: Confirmed, MIT.**
- README: *"All files in this directory are licensed under MIT License."*
  - Source: https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/README.md
- The current training repo is BSD-3-Clause.

**Training data: Partly.**
- The OpenCV Zoo README cites WIDER Face only for evaluation, and points to libfacedetection.train for training.
- libfacedetection.train README:
  - *"YuNet face detection training on WIDER Face."*
  - At the pinned commit: *"We relabled the WIDER Face train set using RetinaFace"*
  - Current master: *"The labelv2 annotations come from SCRFD."*
- The paper's abstract page names WIDER FACE only for evaluation. The full paper body was not read.

**WIDER FACE terms: Confirmed** (re-checked by hand). Source: http://shuoyang1213.me/WIDERFACE/
- *"Creative Common License (cc by-nc-nd)"*. No version number is given.
- *"images are selected from the publicly available WIDER dataset"*
- The page has **no** separate "non-commercial research" wording, and does not say the images come from Flickr. Its only Flickr line refers to AFW.
- *Secondary:* the Hugging Face dataset card says `cc-by-nc-nd-4.0` and *"Images are retrieved using search engines like Google and Bing."*

**ONNX files** (sizes from the Git LFS pointers):

| File | Size |
|---|---|
| `face_detection_yunet_2026may.onnx` (new default; dynamic input; same weights as 2023mar) | 229,738 B |
| `face_detection_yunet_2023mar.onnx` | 232,589 B |
| `face_detection_yunet_2023mar_int8.onnx` | 100,416 B |

**ORT Web: Partly (secondary only).**
- `skillsafe-ai/yunet` shows `onnxruntime-web` with `executionProviders: ["webgpu","wasm"]`.
- No official example; not tested.

### 2.4b BlazeFace short-range (Google)

Model card: https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf

- **Training data: not named.** The card says *"All dataset images were captured on a diverse set of front- and back-facing smartphone cameras."* It names no public dataset.
- **Licence:** *"Apache License, Version 2.0"*.
- **Format:**
  - TFLite (official), about 230 kB (*secondary*).
  - Community ONNX, `unity/inference-engine-blaze-face`, 418 kB (*secondary*).

### 2.5 Sky

#### Depth Anything 3

**Which checkpoints output sky, and their licences: Confirmed** (README table, re-checked by hand).
- Source: https://raw.githubusercontent.com/ByteDance-Seed/Depth-Anything-3/main/README.md

| Checkpoint | Params | Sky seg | Licence |
|---|---|---|---|
| DA3NESTED-GIANT-LARGE(-1.1) | 1.40B | Yes | CC BY-NC 4.0 |
| DA3-GIANT(-1.1) | 1.15B | No | CC BY-NC 4.0 |
| DA3-LARGE(-1.1) | 0.35B | No | CC BY-NC 4.0 |
| DA3-BASE | 0.12B | No | Apache 2.0 |
| DA3-SMALL | 0.08B | No | Apache 2.0 |
| DA3METRIC-LARGE | 0.35B | Yes | Apache 2.0 |
| DA3MONO-LARGE | 0.35B | Yes | Apache 2.0 |

- The Hugging Face cards match:
  - DA3MONO-LARGE and DA3METRIC-LARGE are `apache-2.0` and list "Sky Segmentation".
  - DA3NESTED-GIANT-LARGE-1.1 is `cc-by-nc-4.0` (*"Non-commercial use only"*).

**Training data: Partly.**
- README / cards: *"All models are trained exclusively on public academic datasets."*
- Paper (arXiv 2511.10647):
  - It names the main-series datasets (Table 1).
  - It names the teacher's 20 synthetic datasets: *"We train the teacher model exclusively on synthetic data"*.
- **DA3MONO-LARGE:** *"training the monocular student on unlabeled images with teacher-generated pseudo-labels"*. **The images are not named** in the DA3 paper.
- **DA3METRIC-LARGE:** *"We trained our metric depth model on 14 datasets, including Taskonomy… DIML (Outdoor)… DDAD,"*
  - Only 13 are named: Taskonomy, DIML-Outdoor, DDAD, Argoverse, Lyft, PandaSet, Waymo, ScanNet++, ARKitScenes, Map-free, DSEC, DrivingStereo, Cityscapes.
  - Stereo labels come from FoundationStereo predictions.
- **Sky-mask labels:** the source is not stated.
- The terms of each individual dataset were **not checked**.

**ONNX: community exports only.**
- `Heliosoph/da3metric-large-onnx` (apache-2.0):
  - Includes the sky output: *"`sky >= 0.5` is the upstream sky-mask threshold"*.
  - Sizes: 1.34 GB fp32 / 669 MB fp16.
- `SpatialHub/depth-anything-3-onnx` has mono and metric exports of about 1.34 GB each. Whether they include the sky output is not stated.
- **No browser evidence was found for any checkpoint with a sky output.** Browser and transformers.js evidence exists only for DA3-Small, which has no sky output.

#### Other small sky / semantic segmentation models

**ADE20K terms** (https://ade20k.csail.mit.edu/terms):
- *"MIT, CSAIL does not own the copyright of the images."*
- *"Researcher shall use the Database only for non-commercial research and educational purposes."*
- ADE20K has a `sky` class.

**Cityscapes** (home page; the licence page was not opened):
- *"…freely available to academic and non-academic entities for non-commercial purposes"*.

| Candidate | Verdict | Key facts |
|---|---|---|
| **EfficientViT-Seg B1 (ADE20K)** | Passes with plain-words note | <ul><li>Hugging Face `han-cai/efficientvit-seg`: `apache-2.0`.</li><li>Trained on ADE20K; backbone pretrained on ImageNet.</li><li>`efficientvit_seg_b1_ade20k.pt`: 19.3 MB, 4.8M params.</li><li>No hosted ONNX: the README says *"To generate ONNX files, please refer to onnx_export.py"*.</li><li>Not tested in ORT Web.</li></ul> |
| **EfficientViT-Seg B0 (Cityscapes)** | Passes with plain-words note | <ul><li>Apache-2.0.</li><li>`.pt` file: 2.9 MB.</li><li>Street-scene domain.</li></ul> |
| SegFormer-B0 ADE20K | Fails | <ul><li>NVIDIA licence §3.3: *"…only may be used or intended for use non-commercially…"*.</li><li>The Xenova ONNX would otherwise be ideal: 15.3 MB fp32, 7.9 MB fp16, 4.4 MB quantized.</li></ul> |
| Realcat/skywater_seg | Unclear | <ul><li>Tagged MIT; trained on ADE20K; ONNX 99 MB fp32 / 50 MB fp16.</li><li>But its MiT-B2 encoder weights come from smp, whose MiT source is under the *"NVIDIA Source Code License"*.</li></ul> |
| OneFormer Swin-T ADE20K | Unclear | <ul><li>Tagged MIT.</li><li>Backbone pretraining not stated.</li><li>203 MB; no ONNX found.</li></ul> |
| Mask2Former / MaskFormer | Fails | Model-zoo weights are CC BY-NC 4.0. |
| DINOv2 ViT-S/14 + ADE20K linear head | Unclear | <ul><li>Apache-2.0.</li><li>Backbone trained on LVD-142M; the same backbone family as the accepted Depth Anything V2 Small.</li><li>No ONNX found.</li></ul> |
| DINOv3-based models | Fail | Custom "DINOv3 License". |
| torchvision DeepLabV3-MobileNetV3 | Fails for sky | Uses the 20 VOC classes, which have no sky class. |
| skyseg (U²-Net, xiongzhu666) | Fails | <ul><li>MIT.</li><li>Training data not named: *"We couldn't public the high-precision model because it used in our product"*.</li></ul> |

**Conclusion:**
- No small sky model with permissive weights and named data ships a ready ONNX.
- **EfficientViT-Seg B1 (ADE20K)** is the closest. It passes the rule with an ADE20K note, but needs an in-house ONNX export and testing on ORT Web 1.30.0.

### 2.6 RF-DETR-Seg N / S (Roboflow)

**Weights licence: Confirmed, Apache-2.0.**
- README (https://raw.githubusercontent.com/roboflow/rf-detr/develop/README.md):
  - *"| RF-DETR-Seg-N | … | Apache 2.0 |"* and *"| RF-DETR-Seg-S | … | Apache 2.0 |"*
- PML 1.0 applies only to the Plus *detection* models (Atto, Femto, Pico, XL, 2XL).
- `config.py`: the Seg Nano and Seg Small configs inherit `license: str = "Apache-2.0"`.

**Training data: Partly.**
- Paper (https://arxiv.org/html/2511.09554v2):
  - *"we pre-train RF-DETR-Seg on Objects-365 … psuedo-labeled with SAM2 … instance masks"*. The misspelling is in the original.
  - It uses a DINOv2 backbone.
- Hugging Face card (Roboflow/rf-detr-seg-nano): *"trained on the standard COCO 2017 instance segmentation label space"*.
- Upstream:
  - DINOv2 model card: *"Training data: LVD-142M"*. LVD-142M is curated from named sets plus *"a publicly available repository of crawled web data"* and is not released.
  - DINOv2 weights are Apache-2.0.
  - SAM 2 was trained partly on Internal data (see 2.1).

**COCO terms: Confirmed.** Source: https://raw.githubusercontent.com/cocodataset/cocodataset.github.io/master/dataset/termsofuse.htm (the file the cocodataset.org terms tab loads).
- *"The annotations in this dataset along with this website belong to the COCO Consortium and are licensed under a Creative Commons Attribution 4.0 License."*
- *"The COCO Consortium does not own the copyright of the images. Use of the images must abide by the Flickr Terms of Use."*

**Objects365 terms: Confirmed.** Source: https://www.objects365.org/download.html
- *"The Objects365 dataset is available for the academic purpose only."*
- Annotations are CC BY 4.0.

**ONNX: Partly.**
- Export: `model.export()` writes `{variant}.onnx` with opset 17 (rfdetr.roboflow.com docs).
- No official ONNX on Hugging Face.
- *Secondary:* `PierreMarieCurie/rf-detr-onnx` (apache-2.0):
  - `rf-detr-seg-nano.onnx`: 122.6 MB
  - `rf-detr-seg-small.onnx`: 123.2 MB
- **transformers.js does not support the Seg variant.** Its registry has only `RFDetrForObjectDetection`.

**Browser evidence: Not found for N/S.**
- The only Seg browser evidence is *secondary*: `AnnotateIt/rfdetr-seg-medium-coco-onnx`, tested on *"onnxruntime-web 1.24.3, WASM EP, single thread"*. That is Seg-Medium, on WASM, not WebGPU.

---

## 3. Blocked or failed sources

| Source | Result | What was done instead |
|---|---|---|
| curl / API calls to huggingface.co, arxiv.org and storage.googleapis.com | Proxy 403 (CONNECT rejected) | Read through the web-fetch tool. Paraphrase limits apply. |
| Official byte sizes of the MediaPipe `.tflite` files (storage.googleapis.com) | Binary only, or 403 | Used secondary Hugging Face re-uploads |
| SA-1B Dataset Research License full text (ai.meta.com/datasets/segment-anything-downloads) | Fetch error / 403 | Used the dataset page summary and the README licence name |
| Meta CDN PDF of the SAM 2 paper | URL too long / 403 | Used the arXiv v2 PDF. Its text stopped at App. F.3.2, so App. H (model/data cards) was not read. |
| api.github.com / `gh api` (sam2, opencv_zoo, BiRefNet, rf-detr) | "GitHub access to this repository is not enabled for this session" | Used raw.githubusercontent.com and release asset pages |
| github.com tree page for face_detection_yunet | ROBOTS_DISALLOWED | Used raw files |
| cocodataset.org/termsofuse.htm | Fetch error; the #termsofuse tab is loaded by JavaScript | Used the official GitHub Pages source file |
| repo.roboflow.com `.pth` HEAD requests | Proxy 403 | The `.pth` sizes for Seg-N/S are not confirmed |
| cityscapes-dataset.com/license | Not opened | Quoted the home page |
| YuNet full paper (Springer) | Abstract page only | Training data taken from the training repo |
| BiRefNet_lite-2K training list; AM-2k, BG-20k and AIM-500 agreement PDFs | Fetch tool would only paraphrase; PDFs not opened | Marked Partly |
| Terms of each individual DA3 / DA3-Metric training dataset; ImageNet terms | Not checked | Flagged as open items |

**Open items worth a follow-up, if the owner wants:**
- SAM 2.1's training data (paper App. H, or ask Meta).
- Whether the BiRefNet_lite Hugging Face card or the GitHub row is correct.
- The DA3-Metric "14th dataset".
- An in-house ONNX export of EfficientViT-Seg B1, tested on ORT Web 1.30.0 with WebGPU.
