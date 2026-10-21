# Local AI models for LightBench: masks, selection and AI Auto

**Prepared for:** Shawn Burke (LightBench) · **Research date:** 2026-10-11 · **Scope:** open models LightBench could run locally (browser via ONNX Runtime Web + WebGPU or transformers.js; later native in Tauri) for hover/click selection, one-click masks, AI-assisted Auto and Auto for a masked area.

**Contents:** [Summary](#summary) · [How this was researched](#how-this-was-researched) · [By provider](#by-provider) · [darktable's AI models](#darktables-ai-models-from-its-code) · [1. Hover/click selection](#1-hover-and-click-object-selection) · [2. One-click masks](#2-one-click-masks) · [3. AI-driven Auto](#3-ai-driven-auto) · [4. Auto for a selected area](#4-auto-for-a-selected-area) · [Excluded models](#excluded-models) · [Open questions](#open-questions-and-hands-on-tests) · [Owner's decisions (2026-10-21): AI masks](#owners-decisions-2026-10-21-ai-masks)

> **Update (2026-10-21).** A training-data check of the mask models followed on 2026-10-21
> ([cowork-2026-10-21-ai-masks/AI_MASKS.md](cowork-2026-10-21-ai-masks/AI_MASKS.md)), and the owner relaxed the model
> rule and chose the AI masks models and order: see [the decisions at the end](#owners-decisions-2026-10-21-ai-masks).
> The tables below are the 2026-10-11 research as it was.

---

## Summary

All sizes below are approximate. "fp16 ≈" figures are estimates (parameters × 2 bytes), not measured files, unless a file size is quoted.

| Tool | Default (small) | Optional "high quality" download | Why |
|---|---|---|---|
| Hover / click selection | **SAM 2.1 Hiera Tiny** (38.9 M params; fp16 ≈ 78 MB; darktable's fp32 package is 143 MB) | **SAM 2.1 Hiera Base+** (80.8 M; fp16 ≈ 162 MB; darktable fp32 package 309 MB). Evaluate **SegNext ViT-B HQ** (darktable's HQ choice, 423 MB) as an alternative | Apache-2.0 code *and* checkpoints. transformers.js supports SAM 2. All SAM 2 sizes share the same small decoder, so hover speed depends mostly on the decoder, and the encoder runs once per image. |
| Low-end fallback for hover | **SlimSAM-77** (9.1 M params; fp16 ≈ 18 MB) | n/a | Apache-2.0. It is the model in the official transformers.js "Segment Anything WebGPU" demo, which already decodes on every `mousemove`. Lower quality (67.4 % vs 73.4 % MIoU for SAM-B in its own table). |
| Click selection, alternative to test | **Google MediaPipe MagicTouch** (6.2 MB v1; 30.5 MB v2) | n/a | Model card: Apache 2.0, intended for "Photo editing". Runs in browsers through MediaPipe's `tasks-vision` package. It has no cached encoder, so every hover position is a full run; speed for hover is untested. v2 licence unverified. |
| Main subject / background | **BiRefNet-lite** (Swin-T; 224 MB fp32 ONNX, fp16 ≈ 112 MB) | **BiRefNet general** (Swin-L; 973 MB fp32 ONNX) | MIT code and weights (repo licence). transformers.js supports BiRefNet. **Caveat:** trained partly on DIS5K, whose terms are non-commercial. |
| People (portrait parts) | **MediaPipe Selfie Multiclass** (16.4 MB; hair, face-skin, body-skin, clothes) | **RF-DETR-Seg-N/S** (Apache-2.0, 33.6–33.7 M params; COCO "person" instance masks) | Model cards / README state Apache-2.0. RF-DETR browser support for segmentation is unverified. |
| Faces | **YuNet** (MIT, 232 KB ONNX) | **BlazeFace short-range** (Apache-2.0, 230 KB) | Tiny. Use the face boxes as SAM box prompts to get a face mask. |
| Sky | No small, clearly licensed sky model found. Suggest a **rule on depth + colour + position**, refined with SAM (needs testing) | **Depth Anything 3 MONO-LARGE** (Apache 2.0 per its README; 0.35 B params, fp16 ≈ 700 MB; outputs depth *and* sky segmentation) | DA3's ONNX/browser support is unverified. |
| Depth (for Auto) | **Depth Anything V2 Small** (Apache-2.0, 24.8 M; fp16 ≈ 50 MB) | **Depth Anything 3 MONO-LARGE** (as above) | DA2-Small has an official transformers.js WebGPU fp16 demo. DA2 Base/Large are CC-BY-NC-4.0 and excluded. |
| Text / concept selection ("sky", "person") | Not in the default install | **Florence-2-base-ft** (0.23 B; MIT per secondary sources, unverified) or **OWLv2 B/16** (Apache-2.0 code and checkpoints, 590 MiB) to find boxes, then SAM 2.1 to cut the mask | **SAM 3 is excluded**: its "SAM License" adds trade-control/military field-of-use limits and a no-reverse-engineering clause, and the checkpoints are gated. |
| Global tone/exposure prediction | **None recommended** | None | Permissive-code models exist (3D-LUT, HDRNet, Exposure, DeepLPF, AdaInt, NeurOP), but all the pretrained weights found were trained on MIT-Adobe FiveK and/or PPR10K, whose licences are research-only / non-commercial. Build Auto from AI masks + measured statistics instead. |

**Licence surprises**

1. **SAM 3 / SAM 3.1** is not Apache-2.0. It uses a custom "SAM License" with ITAR/military/weapons end-use limits, a ban on reverse engineering, and termination on breach ([LICENSE §1.b.iv–v, §6](https://github.com/facebookresearch/sam3/blob/main/LICENSE)). The same pattern applies to **DINOv3** ([LICENSE.md](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md)).
2. **Weights licence ≠ training-data licence.** SAM 2.1 weights are Apache-2.0, but darktable's own model card says the SA-1B training data is under a "custom Meta research-only license" ([darktable-ai card](https://github.com/darktable-org/darktable-ai/blob/main/models/mask-object-sam21-small/README.md)). darktable ships it anyway as its default. BiRefNet, ISNet, SAM-HQ and SegNext-HQ all trained on DIS5K, whose terms say "commercial use of this dataset is prohibited" ([DIS5K terms PDF](https://github.com/xuebinqin/DIS/blob/main/DIS5K-Dataset-Terms-of-Use.pdf)). Whether such limits reach a model's users is legally unsettled (unverified; not legal advice).
3. **MIT-Adobe FiveK** images may be used "solely for your own research purposes", not "for or directed toward commercial advantage or monetary compensation" (licence text, read from a [third-party copy](https://github.com/IEEE1858/Psychophysics/blob/main/imagerank/client/public/licenses/LicenseAdobe.txt) because the official site was blocked).
4. **Depth Anything V2 / V3 and Video Depth Anything:** only the small (and, for DA3, BASE/SMALL/METRIC-LARGE/MONO-LARGE) checkpoints are Apache-2.0. The others are CC-BY-NC-4.0.
5. **CLIPSeg** says "The MIT license does not apply to these weights" ([README](https://github.com/timojl/clipseg#weights)). The weights licence is therefore unknown.
6. **RF-DETR** mixes licences in one repo. N/S/M/L and all Seg models are Apache 2.0; Atto/Femto/Pico/XL/2XL detection models are "PML 1.0" ([README](https://github.com/roboflow/rf-detr)).
7. **Apple** releases its code under MIT or its own sample-code licence, but model weights such as MobileCLIP's use the "Apple ML Research Model" terms: "exclusively for Research Purposes" ([LICENSE_MODELS](https://github.com/apple/ml-mobileclip/blob/main/LICENSE_MODELS)). **Adobe Research** releases use the "Adobe Research License", "for noncommercial research purposes only" ([example](https://github.com/adobe-research/EntitySeg-Dataset/blob/main/LICENSE.md)). **NVIDIA** research code (SegFormer, RADIO, E-RADIO) is non-commercial; only C-RADIO uses the custom "NVIDIA Open Model License" ([RADIO README](https://github.com/NVlabs/RADIO#licensing)).
8. **DINOv2 is not uniform.** The main DINOv2 code and weights are Apache 2.0, but the XRay-DINO and Cell-DINO weights in the same repository are under the "FAIR Noncommercial Research License" ([README](https://github.com/facebookresearch/dinov2)).

---

## How this was researched

- **Date:** 11 October 2026.
- **darktable:** read from the local checkout `/home/user/darktable-org/darktable-full` (master, commit `6271f53`, 2026-10-11; release notes are drafted as 5.8.0). The [darktable-ai](https://github.com/darktable-org/darktable-ai) repository was cloned (commit `f1a46e2`, 2026-09-28). Asset sizes were read with HTTP HEAD requests on its `release-5.6.0` assets.
- **Licences:** read from each project's LICENSE and README on GitHub (raw files), or from official model-card PDFs on `storage.googleapis.com` (MediaPipe).
- **Browser support:** read from the published npm package `@huggingface/transformers` 4.3.1 (2026-10-06) and the [transformers.js-examples](https://github.com/huggingface/transformers.js-examples) repository (commit `204b094`).
- **What could not be accessed.** The network proxy blocked **huggingface.co** (model cards, ONNX file lists and sizes), **arxiv.org**, **ai.meta.com**, **data.csail.mit.edu** (FiveK), **ade20k.csail.mit.edu**, **developers.google.com**, **opensource.microsoft.com**, **web.archive.org** and **gnu.org**. So:
  - Hugging Face model-card licence fields could not be checked directly. Where a licence is only stated on Hugging Face, it is marked **(unverified)**.
  - ONNX sizes on Hugging Face (Xenova / onnx-community) could not be measured. fp16 sizes are estimates from parameter counts.
  - Search-engine snippets were used only as pointers. Claims that rest on them say so.
- **Provider sweep:** after the first pass, a second pass checked Google, Meta, Apple, Microsoft, NVIDIA, Intel, ByteDance/HKU, Alibaba, Adobe and community ports one by one (see [By provider](#by-provider)). MediaPipe model-card PDFs were downloaded from `storage.googleapis.com/mediapipe-assets/` and model file sizes read with HEAD requests on `storage.googleapis.com/mediapipe-models/`.
- **Not tested:** no model was run. No speed figures here were measured on the owner's GPU.

---

## By provider

"Usable" means code and weights licences both allow use in a GPL-3.0 app by anyone, including commercially, and both were read at the primary source. Training-data caveats are noted separately.

| Provider | What was checked | Usable for LightBench | Not usable (reason) / unverified |
|---|---|---|---|
| **Google** (MediaPipe, TF, Research) | **MagicTouch interactive segmenter** v1: 512×512×4 input (RGB + prior map from the click); card says "LICENSED UNDER Apache License, Version 2.0", date Mar 13 2023, intended use "Photo editing", "Object annotation"; trained on images "including consented images of people" ([card PDF](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf)); 6,227,884 bytes. **MagicTouch v2** (`interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task`, 30,525,312 bytes, modified 2026-06-11), referenced in the [tasks-vision web README](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md). **Selfie Segmentation** (Apache 2.0 card, 249 KB). **Selfie Multiclass** (Apache 2.0 card, 16.4 MB). **Hair segmenter** (781,618 bytes). **DeepLab v3** (2,780,176 bytes; PASCAL VOC classes, no sky). **BlazeFace** short-range (Apache 2.0 card) and full-range (1,083,786 bytes). **Face Mesh V2 / face landmarker** (Apache 2.0 [card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf); `.task` 3,758,596 bytes). **HDRNet** (Apache-2.0 code). **OWL-ViT/OWLv2** (Apache-2.0 code and checkpoints). **TF.js ARPortraitDepth** (repo Apache-2.0). Runtime: `@mediapipe/tasks-vision` 1.1.0, Apache-2.0 (npm, 2026-10-06); its README loads the tasks from WASM files via `FilesetResolver.forVisionTasks(".../tasks-vision/wasm")`. Whether it uses WebGPU was not checked (unverified). | MagicTouch v1, Selfie, Selfie Multiclass, BlazeFace, Face Mesh V2, OWLv2 | MagicTouch v2, hair segmenter, DeepLab v3, BlazeFace full-range: card not found (unverified; repo is Apache-2.0). HDRNet pretrained weights: FiveK data (research-only). ARPortraitDepth weights licence unverified. No Google sky, saliency or general depth model found |
| **Meta** (FAIR) | SAM, SAM 2/2.1, EdgeTAM, EfficientSAM, EfficientTAM: Apache-2.0 code and checkpoints. SAM 3/3.1: SAM License. DINOv2: "code and model weights are released under the Apache License 2.0" incl. ADE20K segmentation and NYU depth heads ([README](https://github.com/facebookresearch/dinov2#license)). DINOv3: DINOv3 License. VGGT: "VGGT License v1" ([LICENSE.txt](https://github.com/facebookresearch/vggt/blob/main/LICENSE.txt)). Sapiens: CC BY-NC 4.0. Mask2Former: MIT. | SAM 2.1 family, EdgeTAM, EfficientSAM/TAM, SAM 1, DINOv2 (+ heads), Mask2Former code | SAM 3/3.1, DINOv3, VGGT (custom licences); Sapiens (NC); XRay-/Cell-DINO (FAIR NC). SA-1B training data research-only (see Summary) |
| **Apple** | Depth Pro: Apple sample-code licence, "personal, non-exclusive license … to use, reproduce, modify and redistribute", no patent rights ([LICENSE](https://github.com/apple/ml-depth-pro/blob/main/LICENSE)); same style for FastViT, MobileOne, AIM, ml-cvnets (MobileViT, DeepLabv3). MobileCLIP: MIT code, models under "Apple ML Research Model" terms (research only), data CC-BY-NC-ND ([README](https://github.com/apple/ml-mobileclip#license)). | None recommended | Depth Pro: GPL-3.0 compatibility of the "personal" sample-code licence is unclear (unverified); checkpoint size not measured (Apple CDN blocked). MobileCLIP: research-only weights |
| **Microsoft** | Florence-2 base/large (MIT per secondary sources; HF blocked, unverified). MoGe-1/2: MIT code ([README](https://github.com/microsoft/MoGe#️-license)); weights on HF, licence unverified. X-Decoder: MIT code. | Florence-2 *if* the HF card confirms MIT | MoGe weights unverified; others are large research models |
| **NVIDIA** | SegFormer: "non-commercially … for research or evaluation purposes only" ([LICENSE](https://github.com/NVlabs/SegFormer/blob/master/LICENSE)). RADIO / E-RADIO: NVIDIA Source Code License, non-commercial. C-RADIO v3/v4: "NVIDIA Open Model License" ([README](https://github.com/NVlabs/RADIO#licensing)); licence PDF not reachable. | None | SegFormer and RADIO (NC). C-RADIO: custom licence, text unverified, and it is a backbone, not a ready mask model |
| **Intel** (ISL) | MiDaS v2.1/v3/v3.1: MIT ([LICENSE](https://github.com/isl-org/MiDaS/blob/master/LICENSE)); weights on GitHub releases, e.g. `midas_v21_small_256.pt` 85.8 MB, `dpt_swin2_tiny_256.pt` 172.2 MB, `dpt_levit_224.pt` 204.5 MB, `dpt_beit_large_512.pt` 1.58 GB (HEAD). DPT: MIT. ZoeDepth: MIT. | MiDaS (code + weights under repo MIT) | Superseded in quality by Depth Anything V2 Small (not benchmarked here). Training-data mix not checked |
| **ByteDance / HKU** (Depth Anything) | V1: repo Apache-2.0 ([LICENSE](https://github.com/LiheYoung/Depth-Anything/blob/main/LICENSE)); per-size weights licence not stated in README (unverified). V2: Small Apache-2.0, others CC-BY-NC-4.0. V3: SMALL/BASE/METRIC-LARGE/MONO-LARGE Apache 2.0, GIANT/LARGE/NESTED CC BY-NC 4.0. Video Depth Anything: Small Apache-2.0, others CC-BY-NC-4.0. | DA2-Small, DA3 MONO-LARGE / METRIC-LARGE / SMALL / BASE, VDA-Small | All larger NC checkpoints |
| **Alibaba** (DAMO / ModelScope) | ModelScope library is Apache-2.0 ([LICENSE](https://github.com/modelscope/modelscope/blob/master/LICENSE)). Models such as `damo/cv_unet_universal-matting` exist, but their licences live on modelscope.cn, which was blocked. | None verified | Unverified |
| **Adobe** (Research) | Adobe Research License: "noncommercial research purposes only" ([EntitySeg-Dataset](https://github.com/adobe-research/EntitySeg-Dataset/blob/main/LICENSE.md)). FiveK (Adobe + MIT): research-only. | None | NC |
| **Community ports** | **Xenova / onnx-community** (Hugging Face): conversions keep the source model's licence; their cards could not be read (HF blocked). transformers.js 4.3.1 itself is Apache-2.0 (npm). **rembg** (MIT) hosts ONNX of U²-Net, ISNet, BiRefNet and SAM ViT-B on [GitHub releases](https://github.com/danielgatis/rembg/releases/tag/v0.0.0). **darktable-ai** (GPL-3.0 repo) hosts ONNX of SAM 2.1 T/S/B+ and SegNext with model cards. **OpenCV Zoo** hosts YuNet (MIT). | Use as download sources where the underlying model is usable | Each port's licence is only as good as its source; check each card |

---

## darktable's AI models (from its code)

### What ships and how

| Item | Detail | Source |
|---|---|---|
| Build | AI is a compile-time option, `USE_AI` (default OFF). Downloads need `USE_AI_DOWNLOAD` (default ON when `USE_AI` is on). | `dev-doc/AI.md:36-44` |
| Runtime opt-in | `plugins/ai/enabled` defaults to **false**. "AI features are disabled by default in preferences and must be enabled by the user." | `data/darktableconfig.xml.in:481-487`; `README.md:89-95` |
| Disabled means | No ONNX Runtime loaded, no model folders created, AI modules hide themselves. | `dev-doc/AI.md:46-56` |
| Catalogue | `data/ai_models.json` lists 5 models (below). | `data/ai_models.json:1-40` |
| Download source | Repository setting `plugins/ai/repository`, default `darktable-org/darktable-ai`. | `data/darktableconfig.xml.in:509-515` |
| Release lookup | Fetches `https://raw.githubusercontent.com/<repo>/HEAD/releases-index.json`, which maps darktable version → release tag. Then fetches that release's `versions.json` (version + sha256 per model). | `src/common/ai_models.c:174-200, 296-310` |
| Asset | `<model-id>.dtmodel` (a zip of `config.json` + ONNX files) from `https://github.com/<repo>/releases/download/<tag>/<asset>`. sha256 is checked. | `src/common/ai_models.c:554, 2005, 2162-2165`; `dev-doc/AI.md:296-317` |
| Updates | `plugins/ai/auto_check_updates` defaults to true. Third-party repositories can be added. | `data/darktableconfig.xml.in:489-492, 517`; `RELEASE_NOTES.md:227-232` |
| Defaults | Preferences has a "download / update default" button. It downloads every model with `"default": true`. | `src/gui/preferences_ai.c:1174-1200, 2821-2822` |
| Active model | Per-task setting `plugins/ai/models/active/<task>`. If unset, the first downloaded model marked default for that task is used. | `src/common/ai_models.c:61, 2849-2885` |
| Execution provider | `plugins/ai/provider` defaults to `auto`: CoreML (macOS), DirectML (Windows), CUDA → MIGraphX → ROCm (Linux), else CPU. | `data/darktableconfig.xml.in:496-500`; `dev-doc/AI.md:172-180` |

### Catalogue in `data/ai_models.json`

| id | Task | Default | Architecture | Package size (release-5.6.0) | Licence per darktable-ai model card |
|---|---|---|---|---|---|
| `mask-object-sam21-small` | mask | **yes** | SAM 2.1 Hiera Small (`arch: sam2`) | 169.6 MB | Apache-2.0; SA-1B training data "custom Meta research-only license" |
| `mask-object-segnext-b2hq` | mask | no | SegNext ViT-B SAx2, HQSeg-44K fine-tune (`arch: segnext`) | 422.7 MB | MIT; HQSeg-44K "mixed" |
| `denoise-nind` | denoise | yes | UNet, NIND dataset | 55.0 MB | GPL-3.0; data CC BY 4.0 / CC0 |
| `rawdenoise-nind` | rawdenoise | yes | UtNet2, RawNIND | 57.7 MB | GPL-3.0; data CC BY 4.0 / CC0 |
| `upscale-realplksr` | upscale | yes | RealPLKSR ×2/×4 | 54.9 MB | MIT; DF2K "Flickr2K without an explicit open-source license" |

Sources: `data/ai_models.json:4-38`; model cards in [darktable-ai/models](https://github.com/darktable-org/darktable-ai/tree/main/models); sizes from HEAD requests on `https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/<id>.dtmodel`.

The darktable-ai repository has more models than darktable's catalogue: `mask-object-sam21-tiny` (143.3 MB), `mask-object-sam21-base-plus` (308.5 MB), `denoise-nafnet` (108.4 MB), `upscale-bsrgan` (124.1 MB) and `embedding-openclip-rn101-yfcc15m` ([darktable-ai README](https://github.com/darktable-org/darktable-ai)). Its repository licence is GPL-3.0. Its stated rules: "Model weights must be released under a license compatible with GPL-3.0 … Proprietary or non-commercial-only models are not accepted", and "Models trained on undisclosed or scraped personal data without consent are not accepted" (darktable-ai `README.md:111-125`).

### How darktable runs the mask models

| Aspect | Detail | Source |
|---|---|---|
| Split | `encoder.onnx` + `decoder.onnx` per model. | `src/common/ai/segmentation.c:344-361` |
| Input | Image resized so the long side is 1024 px, zero-padded to 1024×1024. SAM uses ImageNet mean/std; SegNext bakes normalisation into the graph. | `segmentation.c:31-32, 104-160`; `dev-doc/AI_Tasks.md:36-46` |
| Render size | The image is rendered at 1536 px long side for edge refinement, even though the encoder sees 1024. | `src/develop/masks/object.c:54-59` |
| Encoder | Runs once per image on a background thread. Results are cached on disk per image + crop/rotate hash. | `object.c:246-421`; `segmentation.c:1229, 1324` |
| Decoder | **Forced to CPU** ("lightweight and hardware acceleration adds more overhead than it saves"). SAM 2 decoder needs `num_labels=1` override. | `segmentation.c:352-357, 498-507` |
| Prompts | SAM 2.1: points + boxes, 3 candidate masks, best IoU picked, low-res mask fed back. SegNext: points only, 1 mask, full-res previous mask fed back. | `dev-doc/AI_Tasks.md:29-34, 76-91`; `segmentation.c:48-53, 473-571` |
| Post-processing | Joint-bilateral upsampling guided by luma; optional DenseCRF refinement; potrace vectorisation into a path mask. | `segmentation.c:193-280`; `object.c:93-99, 754` |
| Hover | **No hover preview.** `mouse_moved` only redraws the cursor. The decoder runs on button release (click). | `object.c:1400-1434, 1376-1385` |

**Notes.** The darktable-ai SegNext card cites arXiv 2312.01171, but the SegNext repository cites [arXiv 2404.00741](https://github.com/uncbiag/SegNext) for the same CVPR 2024 paper. One of them is wrong (unverified which; arXiv was blocked).

---

## 1. Hover and click object selection

### How it works in practice

SAM-style models split into a heavy **image encoder** (once per image) and a light **prompt decoder** (per point or box). Hover previews mean running the decoder on every cursor move. The official transformers.js demo does exactly this: it listens to `mousemove`, sets one point, and calls `decode()`, dropping intermediate events while a decode is running ([index.js:35-79, 243-251](https://github.com/huggingface/transformers.js-examples/blob/main/segment-anything-webgpu/index.js)). It uses `Xenova/slimsam-77-uniform` with `dtype: "fp16"` and `device: "webgpu"` (lines 289-294).

### Candidates

| Model | What it's for | Code licence | Weights licence | Size | ONNX available | Browser evidence | Quality evidence | Verdict |
|---|---|---|---|---|---|---|---|---|
| **SAM 2.1 Hiera Tiny** (Meta, Sept 2024) | Point/box segmentation | Apache-2.0 ([LICENSE](https://github.com/facebookresearch/sam2/blob/main/LICENSE)) | Apache-2.0: "The SAM 2 model checkpoints … are licensed under Apache 2.0" ([README](https://github.com/facebookresearch/sam2#license)) | 38.9 M params ([README table](https://github.com/facebookresearch/sam2#model-description)); darktable fp32 package 143.3 MB; fp16 ≈ 78 MB | Yes: darktable-ai `.dtmodel` (GPL-3.0 repo); onnx-community/SharpAI exports on HF (licence unverified) | transformers.js 4.3.1 maps `sam2` → `Sam2Model` (`src/models/registry.js:491`). [next-sam](https://github.com/geronimi73/next-sam) (MIT) runs SAM 2 tiny with onnxruntime-web WebGPU (`app/SAM2.js:8-10`). No published per-stage latency found | SA-V test J&F 76.5 vs 79.5 for Large ([README](https://github.com/facebookresearch/sam2#model-description)) | **Default** |
| SAM 2.1 Hiera Small | Same | Apache-2.0 | Apache-2.0 | 46 M; darktable fp32 169.6 MB | darktable-ai | as above | J&F 76.6 | Good middle option; darktable's default |
| **SAM 2.1 Hiera Base+** | Same | Apache-2.0 | Apache-2.0 | 80.8 M; darktable fp32 308.5 MB | darktable-ai | as above | J&F 78.2 | **HQ option** |
| SAM 2.1 Hiera Large | Same | Apache-2.0 | Apache-2.0 | 224.4 M | HF third-party (unverified) | none found | J&F 79.5 | Too big for a browser default |
| **SlimSAM-77** (NUS, Jan 2024) | Pruned SAM ViT-B | Apache-2.0 ([LICENSE](https://github.com/czg1225/SlimSAM/blob/master/LICENSE)) | Apache-2.0 (repo licence; HF card unverified) | 9.1 M params, 23 G MACs ([README](https://github.com/czg1225/SlimSAM)); fp16 ≈ 18 MB | Xenova/slimsam-77-uniform (HF, unverified) | Official transformers.js hover demo (above) | 67.40 % MIoU vs SAM-B 73.37 %, SAM-H 78.30 % (SlimSAM's own table, `images/paper/compare_tab1.PNG`) | **Low-end fallback** |
| SlimSAM-50 | Same | Apache-2.0 | Apache-2.0 | 26 M | HF (unverified) | transformers.js `sam` | 72.33 % MIoU (same table) | Alternative fallback |
| MobileSAM (Kyung Hee Univ., 2023) | Tiny-ViT SAM | Apache-2.0 ([LICENSE](https://github.com/ChaoningZhang/MobileSAM/blob/master/LICENSE)) | Apache-2.0 (repo) | 9.66 M (5 M encoder + 3.876 M decoder) ([README](https://github.com/ChaoningZhang/MobileSAM)) | Export script in repo | none checked | 62.73 % MIoU (SlimSAM table) | Superseded |
| EfficientSAM (Meta, Dec 2023) | Small SAM | Apache-2.0 ([LICENSE](https://github.com/yformer/EfficientSAM/blob/main/LICENSE)) | Apache-2.0 (repo) | Ti 10 M, S 26 M (SlimSAM table) | ONNX on HF Space ([README](https://github.com/yformer/EfficientSAM)) | none checked | 69.42 % / 71.19 % MIoU (SlimSAM table) | Possible; not better than SAM 2.1 Tiny |
| EfficientViT-SAM (MIT Han Lab, 2024) | Fast SAM | Apache-2.0 ([LICENSE](https://github.com/mit-han-lab/efficientvit/blob/master/LICENSE)) | Apache-2.0 (repo; HF card unverified) | L0 34.8 M … XL1 203.3 M ([README](https://github.com/mit-han-lab/efficientvit/blob/master/applications/efficientvit_sam/README.md)) | Export scripts in repo | none found | COCO box-prompt mAP 45.7–47.8 (same README) | Worth a test if SAM 2.1 Tiny is slow |
| EdgeTAM (Meta, 2025) | On-device SAM 2 | Apache-2.0 | Apache-2.0: "checkpoints and code are licensed under Apache 2.0" ([README](https://github.com/facebookresearch/EdgeTAM#license)) | not stated in README | HF (unverified) | transformers.js maps `edgetam` (`registry.js:492`) | 1-click mIoU 55.5 vs 61.9 for SAM 2.1 on SA-23; 40.4 FPS vs 1.3 on iPhone 15 Pro Max ([README](https://github.com/facebookresearch/EdgeTAM)) | Fallback if encoder speed matters more than quality |
| EfficientTAM (Meta, 2024) | Small SAM 2 | Apache-2.0 | Apache-2.0 ([README](https://github.com/yformer/EfficientTAM)) | not checked | not checked | none found | ">10 frames per second … on iPhone 15" | Not needed for stills |
| SAM-HQ / Light HQ-SAM (ETH, 2023) | Sharper boundaries | Apache-2.0 ([LICENSE](https://github.com/SysCV/sam-hq/blob/main/LICENSE)) | Apache-2.0 (repo; HF unverified) | Light HQ-SAM uses Tiny-ViT | Decoder export script | none found | Repo claims 41.2 FPS for Light HQ-SAM | Training data HQSeg-44K includes DIS5K ([train README](https://github.com/SysCV/sam-hq/blob/main/train/README.md)) |
| **SegNext ViT-B SAx2 HQ** (UNC, CVPR 2024) | Click segmentation, fine edges | MIT ([LICENSE](https://github.com/uncbiag/SegNext/blob/main/LICENSE)) | MIT (repo); checkpoint on Google Drive | darktable package 422.7 MB; encoder ≈ 339 MB + decoder ≈ 103 MB ([card](https://github.com/darktable-org/darktable-ai/blob/main/models/mask-object-segnext-b2hq/README.md)) | darktable-ai | none found | HQSeg-44K 5-mIoU 91.75, DAVIS 91.87 ([README](https://github.com/uncbiag/SegNext)) | **HQ alternative to test.** Its decoder is ~5× SAM's; hover speed unknown. Points only. Trained on HQSeg-44K (includes DIS5K) |
| **MediaPipe MagicTouch** (Google, Mar 2023; v2 2026) | Click → object mask (one network, RGB + click "prior map") | Apache-2.0 (MediaPipe) | v1: Apache License 2.0 ([model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf)); v2: unverified | v1 6.2 MB (float32 TFLite); v2 30.5 MB (int8 `.task`) | TFLite / `.task`, not ONNX | `InteractiveSegmenter` in `@mediapipe/tasks-vision` ([README](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md)) | v1 card reports IoU 86–89 by skin-tone group; ~130 ms CPU / 67 ms GPU on Pixel 6 per a search snippet of Google's guide (unverified) | **Test as a light alternative.** Card lists "Small objects / people too far away" as out of scope |
| TinySAM (Huawei, 2023) | Small SAM | Apache-2.0 ([README](https://github.com/xinghaochen/TinySAM#license)) | Apache-2.0 (repo) | not checked | not checked | none found | not checked | Not prioritised |

### Notes

- **Speed evidence is thin.** The only official browser figure found is Microsoft's February 2024 claim that WebGPU sped up the original SAM encoder about 19× and decoder about 3.8× over WASM on an RTX 3060 laptop. This comes from a search snippet of [the ONNX Runtime blog](https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/); the page itself was blocked (unverified). No published millisecond timings for SAM 2.1 encoder vs decoder on WebGPU were found.
- **Known export pitfalls.** next-sam notes that a session with providers `["webgpu","cpu"]` fails, so it picks one (`app/SAM2.js:82-92`). It loads the encoder as a pre-optimised `.ort` file (`app/SAM2.js:8`). darktable needs a `num_labels` override and reduced graph optimisation for the SAM 2 decoder (`dev-doc/AI.md:122-141`).
- **Decoder on CPU.** darktable runs the decoder on CPU on purpose (`segmentation.c:352-357`). For hover in a browser, test both WebGPU and WASM for the decoder.

---

## 2. One-click masks

### Main subject / background

| Model | What it's for | Code licence | Weights licence | Size | ONNX available | Browser evidence | Quality evidence | Verdict |
|---|---|---|---|---|---|---|---|---|
| **BiRefNet** (Zheng Peng et al., 2024) | Salient object / background removal | MIT ([LICENSE](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE)) | MIT (repo licence; HF card unverified) | general Swin-L ONNX 972.7 MB; lite Swin-T ONNX 224.0 MB (rembg assets, HEAD) | Yes: [BiRefNet releases v1](https://github.com/ZhengPeng7/BiRefNet/releases/tag/v1) and [rembg v0.0.0](https://github.com/danielgatis/rembg/releases/tag/v0.0.0) | transformers.js maps `birefnet` to image segmentation (`registry.js:656`). README credits SafeResize for running BiRefNet_lite "entirely in your browser with ONNX Runtime Web" ([README](https://github.com/ZhengPeng7/BiRefNet)) | ONNX ≈ 165 ms (Swin-L) / 93.8 ms (Swin-T) on A100 at 1024² (README) | **Default (lite), HQ (general).** Training sets include DIS5K (non-commercial) and others ([model zoo](https://github.com/ZhengPeng7/BiRefNet#model-zoo)) |
| ISNet (DIS) (Qin et al., 2022) | Dichotomous segmentation | Apache-2.0 ([LICENSE.md](https://github.com/xuebinqin/DIS/blob/main/LICENSE.md)) | Apache-2.0 covers "code and evaluation metric"; weights unstated (unverified) | 178.6 MB ONNX (rembg) | rembg | none checked | — | Superseded by BiRefNet; DIS5K non-commercial |
| U²-Net / U²-Net-p (2020) | Saliency | Apache-2.0 ([LICENSE](https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE)) | Apache-2.0 (repo; unverified for weights) | 176.0 MB / **4.6 MB** ONNX (rembg) | rembg | none checked | — | u2netp is a tiny emergency fallback |
| MODNet (2020) | Portrait matting | Apache-2.0 | Apache-2.0: "The code, models, and demos … are released under the Apache License 2.0" ([README](https://github.com/ZHKKKe/MODNet#license)) | not measured | Xenova/modnet (HF, unverified) | Official transformers.js WebGPU demo uses `Xenova/modnet` ([App.jsx:30-35](https://github.com/huggingface/transformers.js-examples/blob/main/remove-background-webgpu/src/App.jsx)) | — | Portraits only. Training data not checked |
| BEN2 Base (Prama LLC, 2025) | Background removal | MIT ([LICENSE](https://github.com/PramaLLC/BEN2/blob/main/LICENSE)) | "Our Base model is open source" (weights on HF, licence unverified) | ONNX on HF (size unverified) | HF | none found | — | Trained on DIS5K + "22K proprietary" data ([README](https://github.com/PramaLLC/BEN2)). Hold |

### People and faces

| Model | What it's for | Code licence | Weights licence | Size | ONNX available | Browser evidence | Quality evidence | Verdict |
|---|---|---|---|---|---|---|---|---|
| **MediaPipe Selfie Multiclass** (Google) | Background, hair, body-skin, face-skin, clothes, others | Apache-2.0 (MediaPipe) | **Apache License, Version 2.0** ([model card PDF](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf)) | 16.4 MB TFLite (HEAD on `selfie_multiclass_256x256.tflite`) | TFLite only; ONNX conversions are third-party | `@mediapipe/tasks-vision` (npm, Apache-2.0) runs it in browsers | IoU per class in card (not copied) | **Default for portraits.** Needs MediaPipe's own runtime or a conversion |
| MediaPipe Selfie Segmentation | Person vs background | Apache-2.0 | Apache-2.0 ([card PDF](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf), May 2021) | 249 KB | TFLite | MediaPipe web | — | Selfie-style framing only |
| **RF-DETR-Seg N/S** (Roboflow, 2025) | Instance masks for COCO classes incl. person | Apache-2.0 | "Apache 2.0" per model table ([README](https://github.com/roboflow/rf-detr)) | 33.6 / 33.7 M params; fp16 ≈ 67 MB | rfdetr package exports ONNX (unverified for Seg) | transformers.js maps `rf_detr` to **detection only** (`registry.js:455`) | COCO mask AP 40.3 (N) / 43.1 (S), vs YOLOv11-N-Seg 30.0 (same table) | **HQ for people.** Browser path needs testing |
| **YuNet** (Shiqi Yu, 2023) | Face boxes + 5 landmarks | MIT ([LICENSE](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE)) | MIT: "All files in this directory are licensed under MIT" ([README](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)) | 232,589 bytes ONNX | Yes (OpenCV Zoo) | none checked | WIDER Face val AP 0.834 / 0.824 / 0.708 (easy/medium/hard) | **Default faces.** Trained on WIDER Face (dataset terms unverified) |
| **BlazeFace short-range** (Google, 2021) | Face boxes, close faces | Apache-2.0 | **Apache License, Version 2.0** ([model card PDF](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf)) | 229,746 bytes TFLite | TFLite | MediaPipe web | Card has fairness evaluation | Good for portraits; misses small faces |

### Sky

| Model | What it's for | Code licence | Weights licence | Size | ONNX | Browser | Quality | Verdict |
|---|---|---|---|---|---|---|---|---|
| **Depth Anything 3 MONO-LARGE** / METRIC-LARGE (ByteDance, Nov 2025) | Depth + **sky segmentation** | Apache-2.0 ([LICENSE](https://github.com/ByteDance-Seed/Depth-Anything-3/blob/main/LICENSE)) | "Apache 2.0" in model table ([README](https://github.com/ByteDance-Seed/Depth-Anything-3#-model-cards)); HF card unverified | 0.35 B params; fp16 ≈ 700 MB | Not found (unverified) | Not in transformers.js 4.3.1 registry | none checked | **HQ sky + depth**, if it exports cleanly |
| Sky-Segmentation-and-Post-processing (xiongzhu666, 2021) | U²-Net sky model + C++ refinement | MIT ([LICENSE](https://github.com/xiongzhu666/Sky-Segmentation-and-Post-processing/blob/main/LICENSE)) | Repo MIT; training data unstated | 2 MB demo model; 167 MB ONNX on Baidu | Yes (Baidu only) | none | Author notes buildings sometimes read as sky ([README](https://github.com/xiongzhu666/Sky-Segmentation-and-Post-processing)) | Training data unknown → hold |
| EoMT / Mask2Former / OneFormer on ADE20K | Semantic classes incl. sky | MIT ([EoMT](https://github.com/tue-mps/eomt/blob/master/LICENSE), [Mask2Former](https://github.com/facebookresearch/Mask2Former#license), [OneFormer](https://github.com/SHI-Labs/OneFormer/blob/main/LICENSE)) | HF cards unverified | EoMT-L etc. (large) | Not checked | transformers.js has `maskformer` only (`registry.js:486`) | EoMT-L 59.5 mIoU ADE20K ([README](https://github.com/tue-mps/eomt)) | ADE20K terms page blocked (unverified). Hold |

A rule-based sky mask (far depth from DA2-Small, top-of-frame, bright/blue or cloud texture) refined by SAM 2.1 would avoid another download. This is an untested idea.

### Text / concept prompts

| Model | What it's for | Code licence | Weights licence | Size | ONNX | Browser | Quality | Verdict |
|---|---|---|---|---|---|---|---|---|
| **SAM 3 / SAM 3.1** (Meta, Nov 2025 / Mar 2026) | Text-prompted "segment every X" | **SAM License** | **SAM License** (gated) | 848 M params ([README](https://github.com/facebookresearch/sam3)) | community exports | transformers.js maps `sam3_tracker` (`registry.js:493`) | "75-80% of human performance" on SA-Co (README) | **Excluded** (see below) |
| **OWLv2 B/16** (Google, 2023) | Open-vocabulary boxes | Apache-2.0 | Apache-2.0: "Both the code and the model checkpoints are licensed under the Apache 2.0 license" ([README](https://github.com/google-research/scenic/blob/main/scenic/projects/owl_vit/README.md#license)) | 590 MiB (JAX) | HF Xenova (unverified) | transformers.js `owlv2` (`registry.js:463`) | LVIS AP 43.9 (ensemble) | **Optional text pack** + SAM |
| **Florence-2-base-ft** (Microsoft, 2024) | Captioning, grounding, OD | MIT per secondary sources (unverified) | MIT per secondary sources (unverified) | 0.23 B | onnx-community (unverified) | Official WebGPU demo uses `onnx-community/Florence-2-base-ft`, with phrase grounding enabled and segmentation tasks commented out ([worker.js:22](https://github.com/huggingface/transformers.js-examples/blob/main/florence2-webgpu/src/worker.js), [App.jsx:177-181](https://github.com/huggingface/transformers.js-examples/blob/main/florence2-webgpu/src/App.jsx)) | — | **Optional text pack**, once the licence is confirmed on HF |
| Grounding DINO Swin-T (IDEA, 2023) | Open-set boxes | Apache-2.0 ([LICENSE](https://github.com/IDEA-Research/GroundingDINO/blob/main/LICENSE)) | Apache-2.0 (GitHub release; repo licence) | 694 MB `.pth` (HEAD) | HF (unverified) | transformers.js `grounding-dino` (`registry.js:464`) | — | Heavier than OWLv2 |
| EVF-SAM (HUST) | Text-prompted SAM | Apache-2.0 ([LICENSE](https://github.com/hustvl/EVF-SAM/blob/main/LICENSE)) | unverified | not checked | not checked | none | — | Not checked further |

---

## 3. AI-driven Auto

### Inputs Auto can use

| Need | Model | Licence (code / weights) | Size | Browser evidence | Verdict |
|---|---|---|---|---|---|
| Depth (subject vs background, sky) | **Depth Anything V2 Small** (HKU/TikTok, Jun 2024) | Apache-2.0 / Apache-2.0: "Depth-Anything-V2-Small model is under the Apache-2.0 license. Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license" ([README](https://github.com/DepthAnything/Depth-Anything-V2#license)) | 24.8 M params; fp16 ≈ 50 MB | Official demo loads `onnx-community/depth-anything-v2-small` on `webgpu` with fp16 when available ([main.js:34-41](https://github.com/huggingface/transformers.js-examples/blob/main/depth-estimation-video/main.js)) | **Default** |
| Depth + sky (HQ) | **DA3 MONO-LARGE** | Apache-2.0 / Apache 2.0 (README table) | 0.35 B | none | **HQ** (export untested) |
| Depth (alt.) | Distill-Any-Depth Small (Westlake, 2025) | MIT code ([README](https://github.com/Westlake-AGI-Lab/Distill-Any-Depth#license)) / weights unverified | 24.8 M | none | Hold until weights licence is confirmed |
| Depth (old) | MiDaS v2.1 / v3.1 (Intel ISL) | MIT ([LICENSE](https://github.com/isl-org/MiDaS/blob/master/LICENSE)); weights on the repo's GitHub releases | 85.8 MB (`midas_v21_small_256.pt`) to 1.58 GB | transformers.js `dpt` architecture (not tested with MiDaS weights) | Fallback only |
| Depth (Apple) | Depth Pro | Apple sample-code licence (see By provider) | not measured | transformers.js maps `depth_pro` (`registry.js:540`) | Licence unclear → not recommended |
| Depth (Microsoft) | MoGe-2 ViT-S | MIT code / weights unverified | not measured | none | Hold |
| Portrait depth (Google) | TF.js ARPortraitDepth | Apache-2.0 repo ([tfjs-models](https://github.com/tensorflow/tfjs-models/tree/master/depth-estimation)) / weights unverified | not measured | Runs in TF.js | Portraits only; hold |
| Subject / saliency | BiRefNet-lite | MIT / MIT | 224 MB fp32 | see §2 | Default |
| Faces | YuNet, BlazeFace | MIT; Apache-2.0 | ≈ 0.23 MB each | see §2 | Default |
| Sky | rule on depth + colour, or DA3 | — | — | — | see §2 |

### Models that predict tone/exposure directly

These output an edited image or a curve/LUT, mostly not slider values. "Exposure" (Hu et al.) and NeurOP predict parameterised operations, which is closest to "set the sliders".

| Model | Output | Code licence | Weights released? | Training data | Data licence | Verdict |
|---|---|---|---|---|---|---|
| Image-Adaptive 3D LUT (PolyU, 2020) | 3 basis LUTs weighted by a tiny CNN; <600 K params, <2 ms at 4K on Titan RTX | Apache-2.0 ([LICENSE](https://github.com/HuiZeng/Image-Adaptive-3DLUT/blob/master/LICENSE)) | Yes, in repo (`pretrained_models/sRGB`, `/XYZ`) | FiveK ([README](https://github.com/HuiZeng/Image-Adaptive-3DLUT)) | Research-only | Excluded by data |
| AdaInt / SepLUT (2022) | Adaptive 3D LUTs | Apache-2.0 ([AdaInt](https://github.com/ImCharlesY/AdaInt/blob/main/LICENSE), [SepLUT](https://github.com/ImCharlesY/SepLUT/blob/main/LICENSE)) | Yes (`pretrained/AiLUT-FiveK-sRGB.pth`) | FiveK, PPR10K | Research-only / non-commercial | Excluded by data |
| HDRNet (Google/MIT, 2017) | Bilateral-grid affine transforms | Apache-2.0 ([LICENSE](https://github.com/google/hdrnet/blob/master/LICENSE)) | Via a download script (list not verified) | FiveK and HDR+ (README mentions an HDR+ model) | FiveK research-only; HDR+ "CC-BY-SA" per Google blog snippet (unverified) | Excluded / unclear |
| Exposure (Hu et al., 2018) | White-box ops (exposure, contrast, curves…) | MIT ([LICENSE](https://github.com/yuanming-hu/exposure/blob/master/LICENSE)) | Yes | FiveK ([README](https://github.com/yuanming-hu/exposure)) | Research-only | Excluded by data; good design reference |
| NeurOP (2022) | Neural operators | MIT ([LICENSE](https://github.com/amberwangyili/neurop/blob/main/LICENSE)) | not checked | FiveK, PPR10K ([README](https://github.com/amberwangyili/neurop)) | as above | Excluded by data |
| DeepLPF (Huawei, 2020) | Local parametric filters | MIT ([LICENSE](https://github.com/sjmoran/DeepLPF/blob/master/LICENSE)) | not checked | FiveK (unverified) | as above | Excluded by data |
| CSRNet (2020) | Conditional sequential retouching | **No LICENSE file** | Yes (`csrnet.pth`) | FiveK ([README](https://github.com/hejingwenhejingwen/CSRNet)) | as above | Excluded (no licence) |
| NILUT (2023) | Neural implicit LUT | MIT ([LICENSE](https://github.com/mv-lab/nilut/blob/main/LICENSE)) | not checked | not checked | — | Not checked further |
| Zero-DCE / Zero-DCE++ (2020-21) | Low-light curves | **CC BY-NC 4.0**: "for non-commercial use only" ([README](https://github.com/Li-Chongyi/Zero-DCE)) | Yes | SICE | — | Excluded |

**Dataset licences checked.**
- **MIT-Adobe FiveK.** Two licences, LicenseAdobe.txt and LicenseAdobeMIT.txt, each covering a list of files ([downloader README](https://github.com/yuukicammy/mit-adobe-fivek-dataset#license)). Both say: "You may only exercise these rights granted to you solely for your own research purposes, and you shall not exercise any of these rights in any manner that is intended for or directed toward commercial advantage or monetary compensation." Read from a [third-party copy](https://github.com/IEEE1858/Psychophysics/blob/main/imagerank/client/public/licenses/LicenseAdobeMIT.txt); the official [data.csail.mit.edu](https://data.csail.mit.edu/graphics/fivek/) was blocked.
- **PPR10K.** "All files in the PPR10K dataset are available for non-commercial research purposes only" ([README](https://github.com/csjliang/PPR10K)).

**Conclusion.** No open model was found whose code, weights *and* training data clearly allow use in a commercial-friendly GPL app. AI-assisted Auto should combine masks (subject, sky, faces, background) and depth with LightBench's own measured statistics and rules. Training a small model on the owner's own edits, or on permissively licensed raw files, is a possible later step (untested idea).

---

## 4. Auto for a selected area

This is an algorithm on top of masks: measure the masked pixels (scene-linear luminance percentiles, clipping, colour cast) and set the mask's local adjustments. No model is needed. Related research: PPR10K's "human-region priority" retouching and group consistency ([README](https://github.com/csjliang/PPR10K)) address the same idea for portraits, but its data is non-commercial. Nothing found was worth shipping.

---

## Excluded models

| Model | Reason | Source |
|---|---|---|
| SAM 3 / SAM 3.1 | Custom "SAM License": trade-control/ITAR/military/weapons end-use restrictions (§1.b.v), no reverse engineering (§1.b.iv), termination on breach (§6); gated download. Field-of-use limits conflict with the owner's rule and GPL-3.0 §7/§10 "no further restrictions" | [LICENSE](https://github.com/facebookresearch/sam3/blob/main/LICENSE); [README](https://github.com/facebookresearch/sam3) |
| DINOv3 (and models built on it) | "DINOv3 License" with the same ITAR/military and reverse-engineering clauses | [LICENSE.md](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md) |
| EdgeSAM | "S-Lab License 1.0": "Redistribution and use for non-commercial purpose" | [LICENSE](https://github.com/chongzhou96/EdgeSAM/blob/master/LICENSE) |
| Depth Anything V2 Base/Large/Giant | CC-BY-NC-4.0 | [README](https://github.com/DepthAnything/Depth-Anything-V2#license) |
| Depth Anything 3 GIANT/LARGE/NESTED | CC BY-NC 4.0 | [README](https://github.com/ByteDance-Seed/Depth-Anything-3#-model-cards) |
| Video Depth Anything Base/Large | CC-BY-NC-4.0 | [README](https://github.com/DepthAnything/Video-Depth-Anything#license) |
| Marigold | Weights under "OpenRAIL++-M" with use-based restrictions (Attachment A) | [LICENSE-MODEL.txt](https://github.com/prs-eth/Marigold/blob/main/LICENSE-MODEL.txt) |
| Apple Depth Pro | Apple custom licence: "personal, non-exclusive license", no patent rights granted; GPL compatibility unclear (unverified) | [LICENSE](https://github.com/apple/ml-depth-pro/blob/main/LICENSE) |
| SegFormer (NVIDIA) | NVIDIA Source Code License: "non-commercially" means "for research or evaluation purposes only" | [LICENSE](https://github.com/NVlabs/SegFormer/blob/master/LICENSE) |
| Sapiens (Meta) | CC BY-NC 4.0 | [LICENSE](https://github.com/facebookresearch/sapiens/blob/main/LICENSE) |
| VGGT (Meta) | Custom "VGGT License v1" with an Acceptable Use Policy | [LICENSE.txt](https://github.com/facebookresearch/vggt/blob/main/LICENSE.txt) |
| RADIO / E-RADIO (NVIDIA) | NVIDIA Source Code License: "non-commercially … research or evaluation purposes only". C-RADIO uses the custom NVIDIA Open Model License (text not reachable) | [README](https://github.com/NVlabs/RADIO#licensing) |
| Apple MobileCLIP models | "Apple Machine Learning Research Model … exclusively for Research Purposes" | [LICENSE_MODELS](https://github.com/apple/ml-mobileclip/blob/main/LICENSE_MODELS) |
| Adobe Research releases | "Adobe Research License … noncommercial research purposes only" | [example LICENSE.md](https://github.com/adobe-research/EntitySeg-Dataset/blob/main/LICENSE.md) |
| UniDepth | CC BY-NC 4.0 | [LICENSE](https://github.com/lpiccinelli-eth/UniDepth/blob/main/LICENSE) |
| XRay-DINO, Cell-DINO (Meta) | FAIR Noncommercial Research License | [DINOv2 README](https://github.com/facebookresearch/dinov2) |
| BRIA RMBG-2.0 | Weights "for only non-commercial use" (as reported in BiRefNet's README; BRIA's own card unverified) | [BiRefNet README](https://github.com/ZhengPeng7/BiRefNet) |
| InsightFace models (SCRFD, RetinaFace weights, etc.) | "models trained with these data … are available for non-commercial research purposes only" | [README](https://github.com/deepinsight/insightface#license) |
| CLIPSeg weights | "The MIT license does not apply to these weights"; no weights licence stated | [README](https://github.com/timojl/clipseg#weights) |
| Zero-DCE / Zero-DCE++ | CC BY-NC 4.0 | [README](https://github.com/Li-Chongyi/Zero-DCE) |
| CSRNet, SkyAR, StarEnhancer, Pytorch_Retinaface | No LICENSE file found in the repository | GitHub raw LICENSE lookups returned 404 |
| RF-DETR Atto/Femto/Pico/XL/2XL | "PML 1.0" | [README](https://github.com/roboflow/rf-detr) |
| Ultralytics YOLO (v8/11/26), YOLOE | AGPL-3.0. GPL-3.0 §13 allows combining with AGPL code, but the network-use clause would apply to the hosted web app. Not excluded outright, but not recommended | [Ultralytics LICENSE](https://github.com/ultralytics/ultralytics/blob/main/LICENSE); [YOLOE LICENSE](https://github.com/THU-MIG/yoloe/blob/main/LICENSE) |
| Tone models trained on FiveK / PPR10K | Training data research-only / non-commercial (see §3) | as above |

YOLO-World is GPL-3.0 ([LICENSE](https://github.com/AILab-CVC/YOLO-World/blob/master/LICENSE)), which is compatible, but it was not evaluated further.

---

## Open questions and hands-on tests

1. **Hover speed on the owner's GPU.** Measure SAM 2.1 Tiny and SlimSAM-77 in Chrome/Edge with WebGPU: encoder time per image, and decoder time per hover event on WebGPU *and* WASM. Target: decoder well under one frame budget so the outline follows the cursor.
2. **fp16 vs fp32.** Check that fp16 SAM 2.1 masks match fp32. darktable ships fp32 ([sam21-small card](https://github.com/darktable-org/darktable-ai/blob/main/models/mask-object-sam21-small/README.md): "Exported with FP32 precision").
3. **MagicTouch for hover.** It re-runs the whole 6–30 MB network for each cursor position (no cached encoder). Measure it against the SAM 2.1 decoder, and find the v2 model card to confirm its licence.
4. **SegNext for hover.** Its decoder takes a full 1024² previous mask and is ~103 MB. Test whether it is fast enough to decode on every cursor move.
5. **Reuse darktable-ai exports?** They are GPL-3.0-repo packages with known I/O and sha256 (`versions.json`). Check they load in onnxruntime-web (darktable's SAM 2 decoder needs a `num_labels` override; `dev-doc/AI.md:130-141`).
6. **Hugging Face licences.** Confirm on huggingface.co (blocked here): Xenova/slimsam-77-uniform, onnx-community SAM 2.1 exports, onnx-community/depth-anything-v2-small, Xenova/modnet, BiRefNet, BEN2, DA3 MONO-LARGE, Florence-2, OWLv2, EoMT/Mask2Former weights. Also measure their ONNX file sizes.
7. **Training-data risk.** Decide a policy on models with permissive weights but restricted training data (SA-1B for SAM 2.1, DIS5K for BiRefNet/SegNext-HQ). darktable accepts SA-1B; darktable-ai's own README says non-consented scraped data is not accepted.
8. **SA-1B licence text.** Not read (ai.meta.com blocked). Meta's dataset page describes it as research-only (search snippet); darktable-ai's card says "custom Meta research-only license" (unverified).
9. **Sky.** Test the depth + colour rule against DA3 MONO-LARGE's sky head on real photos (trees, buildings, haze, night).
10. **RF-DETR-Seg in the browser.** Not in transformers.js as a segmentation model; test an ONNX export with onnxruntime-web.
11. **MediaPipe models in ONNX Runtime.** Decide between MediaPipe's own web runtime (adds a second runtime) and converting TFLite → ONNX.
12. **Tauri later.** Native ONNX Runtime can use CUDA/DirectML/CoreML as darktable does (`dev-doc/AI.md:145-180`), so the HQ models become more practical there.
13. **FSF compatibility list.** Apache-2.0 and MIT are generally listed as GPL-3.0-compatible by the FSF ([licence list](https://www.gnu.org/licenses/license-list.html)); the page could not be re-opened during this research (unverified here).

## Owner's decisions (2026-10-21): AI masks

After the check in [cowork-2026-10-21-ai-masks/AI_MASKS.md](cowork-2026-10-21-ai-masks/AI_MASKS.md). The full record,
with the AI Remove decisions of the same day, is in [PHASE4_MODELS.md](PHASE4_MODELS.md#model-rule-relaxed-owner-2026-10-21).

- **Model rule relaxed (option B).** Weights must stay permissively licensed (non-commercial weights licences remain
  excluded). Training data must be **mostly named**: a small unpublished share, or an unpublished foundation model or
  backbone (e.g. DINOv2's LVD-142M, already accepted through Depth Anything V2 Small), is allowed when the model info
  says so in plain words. Well-known publishers that name no data can be approved as exceptions, one at a time: RawNIND,
  Moebius and MediaPipe Selfie Multiclass (approved 2026-10-21). Named datasets with non-commercial or research-only
  terms stay allowed with a plain-words note. The owner's policy, not a legal opinion.
- **Eligible now:** SAM 2.1 (Tiny / Base+; about 14.8 % Meta internal licensed video), DA3-Metric-Large (sky; 13 of 14
  datasets named; 669 MB fp16), RF-DETR-Seg N/S (people), MediaPipe Selfie Multiclass (hair, skin, clothes; the
  exception), plus BiRefNet_lite, SlimSAM-77, YuNet and EfficientViT-Seg B1 (sky; needs our own ONNX export), which
  passed before.
- **Order inside the AI masks build:** 1. click/hover select, 2. people/faces, 3. sky, 4. subject.
- **When:** after AI Remove and before AI Denoise; AI masks are in 1.0 (the order is in [ROADMAP.md](../ROADMAP.md)).
- **To settle in the build:** BiRefNet_lite's data list (its Hugging Face card and GitHub README differ); BiRefNet's
  WebGPU graph needs patching; MediaPipe's community ONNX is untested on ONNX Runtime Web; EfficientViT's ONNX export;
  DA3-Metric's size and browser support; transformers.js 4.3.1 uses ONNX Runtime 1.31-dev, while LightBench pins ONNX
  Runtime 1.30.0 directly.
