> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-14 (batch 3 revised: existing AI models). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# Part B: sky masks and depth without training (batch 3)

All sources were read on **2026-10-14**. Quotes are verbatim. "…" marks a cut. Many quotes came through a page-to-text tool that limits quote length, so some sentences are quoted in consecutive fragments. **[secondary]** marks a third-party source. **[my arithmetic]** marks a figure I calculated rather than quoted. This file states facts only and gives no legal advice.

The owner's rule is: permissive weights only (no NC, research-only or RAIL weights), **and** the provenance of the training data must be known.

---

## Decisions this changes

| Decision / assumption | What the sources say | Effect under the owner's rule |
|---|---|---|
| DA3MONO-LARGE as an optional "HQ depth" download (batch 1 suggested it) | The weights are Apache-2.0. The DA3 paper says the Mono student follows DA2 "on unlabeled images", but **names no image set**. Its teacher's 20 synthetic training sets include **vKITTI2**, whose terms say "non-commercial purposes only". The file is **1.34 GB** (fp32 safetensors), not the 350–700 MB batch 1 estimated. | **Fails the provenance test** because the student images are undisclosed, and the teacher was trained partly on NC data. It is also far over a browser download budget. Drop it, or hold it pending an answer from the authors. |
| DA3METRIC-LARGE as a permissive metric option | The weights are Apache-2.0. The paper lists its training sets: they include **Waymo** (the terms forbid deploying "any models trained on or refined using the Dataset" in "Production Systems" or "for any other primarily commercial purposes"), **Argoverse** ("non-commercial use only"), **DDAD** (CC BY-NC-SA 4.0) and **Cityscapes** ("non-commercial purposes"). | **Exclude it.** The training data carries explicit NC terms, and Waymo's terms name trained models. |
| DA3 as a free **sky mask** source | The README marks "Sky Seg" for DA3MONO-LARGE and DA3METRIC-LARGE (and Nested) only. The paper describes a sky-mask head trained with MSE, but does **not** say which data supervises the sky mask. The official API docs expose no sky attribute. Only a third-party ONNX of Metric exposes a `sky` output. | Not usable under the rule: the models with a sky head are the two Large models above. **DA3-SMALL/BASE have no sky output.** |
| DA-V2 Small as the Phase 4 depth model | Confirmed again: Small is Apache-2.0, and Base, Large and Giant are CC-BY-NC-4.0. The data is named in full (Table 7). It includes **SA-1B** (11.1M images; licence: "solely for Research Purposes", defined as "on a non-commercial basis"), **vKITTI2** (NC-SA) and **Places365**. | The weights pass. The provenance is **known** (every set is named), but several sets have NC or research-only terms. This is the same open question as in batches 1 and 2, and the **owner must decide** whether NC *data* terms disqualify permissive *weights*. |
| "Find a small permissive sky segmenter" (Masking) | **None qualifies.** Every small candidate either has an NC weights licence (NVIDIA SegFormer), undisclosed training data (the U²-Net sky models that are MIT-tagged), or was trained on **ADE20K**, whose terms say "only for non-commercial research and educational purposes". | Plan the sky mask without a downloaded segmenter: a classical/heuristic mask with a user brush, a depth-threshold assist from DA-V2 Small, or wait for the deferred train-our-own decision. |

---

## Item 1: Depth Anything 3

### 1a. Does DA3MONO-LARGE output a sky mask? **Partly**
The capability is confirmed by the README, the HF card and the paper. **No official API documents how to read the mask out.**

- GitHub README model table (https://github.com/ByteDance-Seed/Depth-Anything-3): the column header is "Sky Seg", ticked for DA3NESTED-GIANT-LARGE(-1.1), DA3METRIC-LARGE and DA3MONO-LARGE. It is not ticked for DA3-SMALL, DA3-BASE, DA3-LARGE or DA3-GIANT. Mono series: "A dedicated model for high-quality relative monocular depth estimation."
- HF DA3MONO-LARGE (https://huggingface.co/depth-anything/DA3MONO-LARGE): it lists "Sky Segmentation" as a capability. Its code sample documents only "Depth maps: [N, H, W] float32" and "Confidence maps: [N, H, W] float32" (plus poses and intrinsics).
- Official API docs (https://github.com/ByteDance-Seed/Depth-Anything-3/blob/main/docs/API.md): the outputs are `depth`, `conf`, `extrinsics`, `intrinsics`, `processed_images` and `aux`. **No sky attribute.** The only sky mentions are "Automatic sky depth handling" (GLB export) and, for `da3metric-large`, "metric depth with sky segmentation". Mono is not described this way.
- Paper (arXiv 2511.10647v1, PDF https://arxiv.org/pdf/2511.10647v1):
  - §4.1, teacher: "Ground truth is undefined in sky regions and in background areas of object-only datasets." / "we jointly predict a sky mask and an object mask aligned with the depth output, supervised with MSE loss." The teacher loss includes "L_sky".
  - §4.3, Mono student: "We further supervise the student with the same loss used for the teacher, applied to the pseudo-depth labels." This implies the student also has the sky term, but §4.3 itself never uses the word "sky".
  - §4.4, Metric: "a weighted sum of depth loss L_depth, L_grad and sky-mask loss L_sky."
- **[secondary]** A third-party Mono ONNX export (https://huggingface.co/Jens-Duttke/Depth-Anything-3-MONO-ONNX) "composites the model's own sky-segmentation head into the graph". It outputs a single disparity tensor with sky set to 0, not a separate mask. It "is not affiliated with or endorsed by the upstream Depth Anything 3 authors."
- **[secondary]** A third-party Metric ONNX (https://huggingface.co/Heliosoph/da3metric-large-onnx) exposes a second output, `sky` [batch, 1, 504, 504]. Its example thresholds it with `sky_mask = sky >= 0.5`, which the card calls the "upstream sky-mask threshold".

### 1b. What were the sky output and the depth model trained on? **Partly**
The datasets are named for the teacher, the main model and the Metric model. **The Mono student's images and the sky-mask labels are not stated.**

- Abstract and README: "All models are trained exclusively on public academic datasets." (https://arxiv.org/abs/2511.10647v1; v1 dated 2025-11-13 is the only version).
- §4.1 teacher: "We train the teacher model exclusively on synthetic data to achieve finer geometric detail." The 20 sets are Hypersim, TartanAir, IRS, vKITTI2, BlendedMVS, SPRING, MVSSynth, UnrealStereo4K, GTA-SfM, TauAgent, KenBurns, MatrixCity, EDEN, ReplicaGSO, UrbanSyn, PointOdyssey, Structured3D, Objaverse, Trellis and OmniObject.
- §3.4 / Table 1 ("Datasets used in Depth Anything 3 , including number of scenes, data type."), main any-view models: AriaDigitalTwin, AriaSyntheticENV, ArkitScenes, BlendedMVS, Co3dv2, DL3DV, HyperSim, MapFree, MegaDepth, MegaSynth, MvsSynth, Objaverse, Omniobject, OmniWorld, PointOdyssey, ReplicaVMAP, ScanNet++, ScenenetRGBD, TartanAir, Trellis, vKitti2 and WildRGBD.
- §4.3 Mono: "We follow the DA2 framework, training the monocular student on unlabeled images with teacher-generated pseudo-labels." **No image set is named.** The page-to-text tool found no mention of SA-1B or of the DA-V2 image list in §4.3.
- §4.4 Metric: "We trained our metric depth model on 14 datasets, including Taskonomy [120], DIML (Outdoor) [15]," / " DDAD [30], Argoverse [101], Lyft [], PandaSet [105], Waymo [84]," / " ScanNet++ [117], ARKitScenes [5], Map-free [3], DSEC [24], Driving Stereo [109] and Cityscapes [16] datasets." This names 13 of the 14. Also: "For stereo datasets, we leverage the prediction of FoundationStereo [100] as training labels."
- **Sky-mask supervision source: Not found.** The paper only says sky ground truth is "undefined". It does not say where the sky labels come from.
- The arXiv HTML version (https://arxiv.org/html/2511.10647v1) could only be read up to §3.3: the text tool returned 81,854 characters and stopped mid-sentence. The PDF was used for §3.4 to §4.4.

### 1c. The terms of those datasets (only the ones checked)

| Dataset | Used in | Terms (verbatim) | URL |
|---|---|---|---|
| Virtual KITTI 2 | Teacher (Mono/Metric lineage) and Table 1 | "The Virtual KITTI 2 Dataset may be used for non-commercial purposes only" / "is subject to the Creative Commons Attribution-NonCommercial-ShareAlike 3.0" | https://europe.naverlabs.com/proxy-virtual-worlds-vkitti-2/ |
| Hypersim | Teacher and Table 1 | "The Hypersim Dataset is licensed under the Creative Commons Attribution-ShareAlike 3.0 Unported License." (upstream repo, which batch 1 had only read from a fork) | https://github.com/apple/ml-hypersim |
| Waymo Open Dataset | Metric | Grant: "for Non-commercial Purposes only and expressly subject to the following conditions:". §4(a): "You must not use or deploy the Dataset, any models trained on or refined using the Dataset, " / "or the weights or biases from such trained models, in whole or in part, " / "(i) in operation of a vehicle or to assist in the operation of a vehicle, " / "(ii) in any Production Systems, or (iii) for any other primarily commercial purposes; and" | https://waymo.com/open/terms/ |
| Argoverse | Metric | "We license Argoverse data and documents to you for non-commercial use only." | https://www.argoverse.org/about.html |
| DDAD | Metric | "This work is licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License." | https://github.com/TRI-ML/DDAD |
| Cityscapes | Metric | "made freely available to academic and non-academic entities for non-commercial purposes". The licence page itself (https://www.cityscapes-dataset.com/license/) **was blocked** (the permission request was not answered). | https://cityscapes-dataset.com/ |
| Others (Taskonomy, DIML, Lyft, PandaSet, DSEC, Driving Stereo, ScanNet++, ARKitScenes, Map-free, and the remaining teacher and Table 1 sets) | — | **Not checked** in this batch | — |

### 1d. Model sizes. **Confirmed** (with corrections)

| Model | README table | HF card "Model size" | `model.safetensors` (Files tab) | Licence |
|---|---|---|---|---|
| DA3-SMALL | 0.08B | "34.3M params" | **137 MB** | Apache 2.0 |
| DA3-BASE | 0.12B | "0.1B params" | **542 MB** | Apache 2.0 |
| DA3MONO-LARGE | 0.35B | "0.3B params" | **1.34 GB** | Apache 2.0 |
| DA3METRIC-LARGE | 0.35B | "0.3B params" | **1.34 GB** | Apache 2.0 |

URLs: https://huggingface.co/depth-anything/DA3-SMALL/tree/main · https://huggingface.co/depth-anything/DA3-BASE/tree/main · https://huggingface.co/depth-anything/DA3MONO-LARGE/tree/main · https://huggingface.co/depth-anything/DA3METRIC-LARGE/tree/main

- DA3-SMALL: batch 1 flagged "0.08B" against "34.3M" as inconsistent. The 137 MB file matches about 34M parameters at 4 bytes each **[my arithmetic, assumes fp32]**, so the README's 0.08B looks like the outlier. The card's own table says "0.08B" as well.
- **[secondary]** Third-party Mono ONNX: fp16 656 MB, q4f16 336 MB. Third-party Metric ONNX: fp32 "~1.34 GB", fp16 "~670 MB".
- The models marked CC BY-NC 4.0 in the README table are DA3-LARGE(-1.1), DA3-GIANT(-1.1) and DA3NESTED-GIANT-LARGE(-1.1). All are excluded.

---

## Item 2: Depth Anything V2 Small

### 2a. Weights licence Apache-2.0; Base and Large CC BY-NC. **Confirmed**
- README: "Depth-Anything-V2-Small model is under the Apache-2.0 license." / "Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license." Parameters: Small 24.8M, Base 97.5M, Large 335.3M, Giant 1.3B ("Coming soon"). https://github.com/DepthAnything/Depth-Anything-V2
- HF card: "apache-2.0"; "595K synthetic labeled images and 62M+ real unlabeled images". The file is `depth_anything_v2_vits.pth`, 99.2 MB. https://huggingface.co/depth-anything/Depth-Anything-V2-Small and `/tree/main`

### 2b. The training-data mix. **Confirmed**: the real set includes SA-1B
The paper (https://arxiv.org/pdf/2406.09414), Table 7 ("Table 7: Our training data sources."), lists:
- **Synthetic (595K):** BlendedMVS 115K, Hypersim 60K, IRS 103K, TartanAir 306K, VKITTI 2 20K. These per-set counts sum to 604K, not 595K **[my arithmetic]**.
- **Pseudo-labelled real (62M):** BDD100K 8.2M, Google Landmarks 4.1M, ImageNet-21K 13.1M, LSUN 9.8M, Objects365 1.7M, Open Images V7 7.8M, Places365 6.5M, **SA-1B 11.1M**.
- §5.2: "we use five precise synthetic datasets (595K images) and eight large-scale pseudo-labeled real datasets (62M images) for training."
- On sky: "Left: the sky should be ultra far." / "Such failures can be expected as our synthetic training sets do not include diverse sky patterns or humans." The paper has **no** sky segmentation model or sky output.
- arxiv.org/abs/2406.09414 returned a fetch error. The PDF loaded.

### 2c. SA-1B terms. **Confirmed** (research-only, non-commercial)
- Primary (https://ai.meta.com/datasets/segment-anything/): "It is intended to be used for computer vision research for the purposes permitted under our Data License." / "Research purposes only" / licence: "Limited; see full license language for use" / "The images are licensed from a large photo company."
- The primary download page (https://ai.meta.com/datasets/segment-anything-downloads/) **still shows no licence text** to the fetch tool, as in batch 2.
- **[secondary]** A copy of the licence text (https://huggingface.co/datasets/xiuqhou/SA-Det-100k/blob/main/LICENSE), headed "SA-1B DATASET RESEARCH LICENSE":
  - "To access and Reproduce the Licensed Images solely for Research Purposes."
  - Research Purposes are defined as "research activities and research publications, in each case on a non-commercial basis."
  - The images must be destroyed "no later than three (3) months" after research ends or the licence terminates.
  - **The licence text does not mention training models or the status of trained weights.**

---

## Item 3: an existing permissive sky segmenter under about 30 MB. **Not found: none qualifies**

### Candidate table

| Candidate | Weights licence (quoted) | Training data | Size | Verdict on owner's rule |
|---|---|---|---|---|
| xiongzhu666 Sky-Segmentation-and-Post-processing (U²-Net / u2netp) | Repo sidebar: "MIT license" | **Not stated.** The README only says "I trained the sky-segmentation model by U-2-Net." | "a small sky-seg model of 2Mb" (u2netp); "onnx model(167M)" | **Fails (provenance unknown)** |
| JianyuanWang/skyseg (`skyseg.onnx`, the xiongzhu666 model rehosted; used by Parskatt/skyseg) | HF tag "MIT" | Not stated. Parskatt: "See the original model repository for license information." | 176 MB | **Fails (provenance; size)** |
| twistlabs/fotometis-sky, chili-raw, GamutPhoto **[secondary repackagers]** | "mit"; Gamut: "MIT — `LICENSE-skyseg.txt`" | All three trace back to xiongzhu666. fotometis: "Nothing here retrained it." | fotometis Core ML "2.5 MB" | **Fails (provenance)** |
| Realcat/skywater_seg (SegFormer MiT-B2) | "License: mit" | "ADE20K filtered split (11,086 train / 1,111 val)". config.yaml: "encoder_name: mit_b2", "encoder_weights: imagenet" (the source of the encoder weights is not stated) | fp16 ONNX 49.9 MB; fp32 99.3 MB | **Fails** (ADE20K terms; encoder lineage not stated; over 30 MB) |
| nvidia/segformer-b0-finetuned-ade-512-512 | "License: other". Its LICENSE §3.3: "The Work and any derivative works thereof only may be used or intended for use non-commercially." README: "SegFormer may be used non-commercially, meaning for research or evaluation purposes only." | ADE20K | 3.75M params; `model.safetensors` 15 MB | **Fails (NC licence)**. The brief's assumption is confirmed. |
| LibreYOLO/LibreSegformerb0-sem | "nvidia-source-code-license-segformer"; "Converted from nvidia/segformer-b0-finetuned-ade-512-512" | ADE20K | 3.8M params | **Fails (NC)** |
| TensorFlow DeepLab `mobilenetv2_ade20k_train` | Repo: "Apache License 2.0". The model-zoo page states **no** weights licence. | "pretrained on ImageNet", then ADE20K | 24.8MB | **Fails** (ADE20K and ImageNet terms; weights licence not stated) |
| CSAIL semantic-segmentation-pytorch (MobileNetV2dilated + C1_deepsup) | Repo: "BSD-3-Clause license". No weights licence stated. | ADE20K | Not checked | **Fails (ADE20K terms)** |
| DINOv2 ViT-S/14 + ADE20K linear head | "DINOv2 code and model weights are released under the Apache License 2.0." | LVD-142M (curated, not released; see batch 2) plus an ADE20K head | 21 M params (about 84 MB fp32 **[my arithmetic]**) | **Fails** (ADE20K terms; LVD-142M undisclosed) |
| shi-labs/oneformer_ade20k_swin_tiny | "License: mit" | ADE20K | `pytorch_model.bin` 203 MB | **Fails** (ADE20K; size) |
| facebook/mask2former-swin-tiny-ade-semantic | "License: other" | "trained on ADE20k semantic segmentation" | Not stated | **Fails** (licence unclear; ADE20K) |
| Cityscapes-trained segmenters (any) | Varies | Cityscapes: "for non-commercial purposes" | — | **Fails** at the data level (individual models not checked) |
| Nice & Wijnands sky model (Zenodo 2562396, Inception V3) | "Creative Commons Attribution 4.0 International" | "two sets of outdoor imagery (from Skyfinder and Google Street View)" | CNTK-InceptionV3.zip 91.1 MB | **Fails** (SkyFinder has no stated licence; Street View terms not checked; size) |
| DA3MONO-LARGE / DA3METRIC-LARGE sky head | Apache 2.0 | See item 1 (sky labels not stated; NC sets in the lineage) | 1.34 GB | **Fails** (provenance and NC data; size) |

### Training-set terms behind the candidates

| Dataset | Terms (verbatim) | URL | Verdict |
|---|---|---|---|
| ADE20K | "Researcher shall use the Database only for non-commercial research and educational purposes." / "MIT, CSAIL does not own the copyright of the images." / "This website, image annotations and the software provided belongs to MIT CSAIL" "and is licensed under a Creative Commons BSD-3 License Agreement." | https://ade20k.csail.mit.edu/terms | **Partly.** The annotations are BSD-3, but database use is limited to non-commercial research, and the images are third-party. The HF mirror `zhoubolei/scene_parse_150` is tagged "bsd-3-clause" (https://huggingface.co/datasets/zhoubolei/scene_parse_150), which **conflicts** with the terms page on use limits. |
| Cityscapes | "made freely available to academic and non-academic entities for non-commercial purposes" | https://cityscapes-dataset.com/ (licence page blocked) | NC |
| SkyFinder | **No licence stated.** "roughly 90,000 labeled outdoor images"; "The images are taken from AMOS (Archive of Many Outdoor Scenes)". The WUSTL mirror also has no licence, only "please cite". | https://cs.valdosta.edu/~rpmihail/skyfinder/ · https://mvrl.cse.wustl.edu/datasets/skyfinder | **Not found (no terms)** |

**Plain statement:** I found **no** existing sky-segmentation model that is permissively licensed, has known and permissive training-data provenance, and is under about 30 MB. The only small, permissively *tagged* models (the U²-Net sky models, MIT, 2–2.5 MB) have **undisclosed training data**.

---

## Where this agrees with or differs from prior batches

| Topic | Batch 1/2 | This batch |
|---|---|---|
| DA-V2 Small Apache-2.0; B/L/G CC-BY-NC | Confirmed | **Agrees** |
| DA-V2 data list incl. SA-1B, VKITTI2 | Listed | **Agrees.** Per-set counts added; synthetic counts sum to 604K, not 595K. |
| SA-1B research-only | Batch 2: Partly (secondary licence copy) | **Agrees.** The primary download page still shows no licence text; the secondary copy has no clause on trained models. |
| DA3 data "Public academic datasets only [not individually checked]" | Unchecked | **Differs.** Now named from the paper. It includes vKITTI2 (NC-SA) and, for Metric, Waymo, Argoverse, DDAD and Cityscapes (NC). The Mono student's images are unnamed. |
| DA3MONO-LARGE as an optional HQ download, "likely 350–700 MB" | Suggested | **Differs.** 1.34 GB fp32; provenance fails. |
| DA3METRIC-LARGE as a permissive metric option | Listed as permissive | **Differs.** Exclude it under the data rule. |
| DA3-SMALL "0.08B vs 34.3M inconsistent" | Flagged | 137 MB file matches about 34M parameters **[my arithmetic]**. |
| Hypersim CC BY-SA 3.0 (batch 1 read it from a fork) | Fork | **Agrees**, now read from the upstream apple/ml-hypersim. |

---

## Unresolved

1. **What data supervises DA3's sky mask?** The paper doesn't say. Ask the authors (GitHub issue) if DA3 stays in scope.
2. **Which unlabeled images train DA3MONO-LARGE?** §4.3 says only "unlabeled images", "following the DA2 framework". It may be the DA-V2 set (which includes SA-1B), but this is **not stated**.
3. **The official way to read Mono's sky output.** The README and card tick "Sky Seg", but API.md documents no sky attribute.
4. **Cityscapes licence page** (https://www.cityscapes-dataset.com/license/): blocked. Only the homepage summary was quoted.
5. **ADE20K conflict:** the official terms limit use to non-commercial research, but the HF mirror is tagged BSD-3. Owner or counsel should decide which governs; this file gives no opinion.
6. **Realcat/skywater_seg encoder weights** (`mit_b2`, `imagenet`): the source checkpoint isn't stated. MiT weights originate with NVIDIA's NC-licensed SegFormer, but **[unconfirmed]** that this repo used them.
7. **Owner decision (carried over):** do NC or research-only *data* terms disqualify Apache-2.0 *weights* such as DA-V2 Small? The SA-1B licence text is silent on trained models. Waymo's terms are not, but Waymo is only in DA3METRIC's lineage.
8. Terms not checked: Taskonomy, DIML, Lyft, PandaSet, DSEC, Driving Stereo, the remaining DA3 teacher and Table 1 sets, BDD100K, Objects365, LSUN, Google Landmarks, and the Street View imagery in the Zenodo set.
9. The arXiv HTML for DA3 truncated at §3.3 in the fetch tool, and arxiv.org/abs/2406.09414 returned a fetch error. The PDFs were used instead.
