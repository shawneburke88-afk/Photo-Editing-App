> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-14 (batch 3 revised: existing AI models). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# Part C: image embeddings (duplicate grouping and search)

Verification batch 3, Part C only. All sources were read on **2026-10-14**. Quotes are verbatim. "…" marks a cut. Some quotes are split into fragments because the fetch tool returns at most about 120 characters per quote; each fragment is verbatim. Secondary sources are labelled **(secondary)**. This file states facts only and is not legal advice.

**Owner's rule, applied in two parts:** (1) the weights licence must be permissive (no non-commercial, research-only or RAIL terms); (2) the training data must be known and permissive.

---

## Decisions this changes

| Topic | Finding | Effect on the plan |
|---|---|---|
| OpenCLIP RN50/RN101 trained on YFCC15M | Weights are tagged **MIT** on the timm/ HF cards. The training images are all Creative Commons, but in the full YFCC100M **about 68 % of photos are CC BY-NC (-SA/-ND)** and only "31.8%" are "marked for commercial use". OpenAI does not publish the licence mix of the 15M subset. | **Passes on weights and provenance** (the image IDs are published, so the data is enumerable). **Fails if "permissive data" excludes NC images**, which is almost certainly the case for most of the subset. Accuracy is also low (32.7 % / 34.8 % ImageNet zero-shot). Owner's decision. |
| LAION-trained OpenCLIP weights (e.g. ViT-B/32 LAION-2B) | Tagged MIT, but the card says "Any deployed use case of the model - whether commercial or not - is currently out of scope." LAION-5B was taken down in Dec 2023. Re-LAION-5B (Aug 2024) is Apache-2.0 metadata that LAION says is "released for research purposes" and advises "AGAINST using the datasets in industrial settings." The images are uncurated web images with no licence. | **Fails** the data half of the rule (web-scraped images of unknown licence). The model card's own scope statement also excludes deployment. Drop them. |
| DINOv2 ViT-S/14 | Code and weights: **Apache-2.0** (README, LICENSE file, HF tag, paper). LVD-142M is **not released**: it was curated from ImageNet-22k/1k, Google Landmarks and others plus a 1.2B-image web crawl. | **Passes on weights. Fails the "data known and permissive" test**: the dataset is described but not disclosed, and it was seeded from ImageNet, whose access terms are non-commercial research only. Agrees with batch 2 (H9). |
| DINOv3 ViT-S/16 | Custom **"DINOv3 License"** (not Apache/MIT). It includes field-of-use bans (ITAR, military, nuclear, espionage, weapons) and redistribution "only … under the terms of this Agreement". Weights are **gated** on HF. Data: LVD-1689M, drawn from "17 billions web images collected from public posts on Instagram", not released. | **Fails both halves**: the licence has use restrictions, and the data is undisclosed with unknown licences. Drop it. |
| Sizes | DINOv2-small 88.2 MB fp32 (ONNX q4f16 13.9 MB, int8 24.4 MB). DINOv3-S/16 86.4 MB (ONNX q4 14.7 MB). RN50-yfcc15m image tower 154 MB fp32; the full open_clip model with text tower is 408 MB. | All are browser-feasible after quantisation. The YFCC CLIP image tower is the largest. |
| Net result | **No model checked passes the strict two-part rule.** The closest is OpenCLIP-YFCC15M: its weights are MIT and its data is enumerable, but it contains NC images. | Consider non-ML duplicate grouping (perceptual hashes), or filtering YFCC15M to commercial-use CC licences and training our own model (training is deferred). |

---

## C1. OpenCLIP models trained on YFCC15M

### C1.0 OpenCLIP repository licence: **Confirmed MIT** (code)
- `https://raw.githubusercontent.com/mlfoundations/open_clip/main/LICENSE`: "Copyright (c) 2012-2021 Gabriel Ilharco, Mitchell Wortsman, …" and "Permission is hereby granted, free of charge, to any person obtaining a copy of this software …" (MIT text).
- The README contains no statement about the licence of the model weights (`https://raw.githubusercontent.com/mlfoundations/open_clip/main/README.md`, checked for "licen…" and "weights"). → The weights licence is **Not found in the repo**. It appears only as HF tags (C1a).

### C1.1 Models that exist: **Confirmed** (RN50 and RN101 only)
- `https://raw.githubusercontent.com/mlfoundations/open_clip/main/docs/PRETRAINED.md`: "#### YFCC-15M" / "Below are checkpoints of models trained on YFCC-15M, along with their zero-shot top-1 accuracies on ImageNet and ImageNetV2."
- Checkpoints: "…/v0.2-weights/rn50-quickgelu-yfcc15m-455df137.pt" (32.7 % / 27.9 %) and "…/v0.2-weights/rn101-quickgelu-yfcc15m-3e04b30e.pt" (34.8 % / 30.0 %).
- "These models were trained using 8 GPUs and the same hyperparameters described in the "Sample running code" section," with the exception of `lr=5e-4` and `epochs=32`.
- The main README's pretrained table has **no** YFCC row. The YFCC text is in the Data section: "You can download the YFCC dataset from [Multimedia Commons](http://mmcommons.org/)." / "Similar to OpenAI, we used a subset of YFCC to reach the aforementioned accuracy numbers." / "The indices of images in this subset are in OpenAI's CLIP repository".
- Also on PRETRAINED.md (context for other families): "MetaCLIP: … Models are licensed under CC-BY-NC." and "NLLB-CLIP: … Models are licensed under CC-BY-NC." Neither applies to YFCC.

### C1a. Weights licence on HF model cards: **Confirmed MIT** (as a tag only)
Actual repo names: **`timm/resnet50_clip.yfcc15m`** and **`timm/resnet101_clip.yfcc15m`** (found via a secondary index, `https://mixpeek.com/model/timm/resnet50_clip.yfcc15m`, which links to the HF repo).
- `https://huggingface.co/timm/resnet50_clip.yfcc15m`: "License: mit"; "This model is a dual use `open_clip` and `timm` model."; "Model name in OpenCLIP is `RN50-quickgelu`, and timm name is `resnet50_clip.yfcc15m`."; "dataset: YFCC-15M"; "38.4M params" (image tower, F32).
- `https://huggingface.co/timm/resnet101_clip.yfcc15m/raw/main/README.md` front matter: "license: mit", "library_name: open_clip". The card body says "dataset: YFCC-15M".
- Neither card has an intended-use, out-of-scope or dataset-licence section ("None" found on the RN50 card).
- No laion/ repo for YFCC15M was found. Third-party copy: `https://huggingface.co/thaottn/OpenCLIP-resnet50-YFCC15M` has tag "mit" and no data statement (unofficial; not recommended).
- Files (RN50, `…/resnet50_clip.yfcc15m/tree/main`): "model.safetensors | 154 MB" (timm image tower), "open_clip_model.safetensors | 408 MB" (image + text). The RN101 file listing **failed to load twice** (CLIENT_ERROR).
- No ONNX / transformers.js port of the YFCC15M checkpoints was found. (A search returned only `timm/resnet50_clip.openai`, which is OpenAI-WIT data, not YFCC.)

### C1b. Licence mix of the training data: **Confirmed: mixed CC, including NC.** Exact subset mix: **Not found**
- OpenAI subset definition, `https://raw.githubusercontent.com/openai/CLIP/main/data/yfcc100m.md`: images with "natural language titles and/or descriptions in English"; 14,829,396 images, ≈ 15 % of YFCC100M; and "Use of the underlying media files is subject to the Creative Commons licenses chosen by their creators/uploaders." The file publishes line number, photo ID and hash, not licences.
- YFCC100M paper, `https://arxiv.org/pdf/1503.01817` (Thomee et al.): "approximately 31.8% of the dataset marked appropriate for commercial use"; "The dataset is currently distributed via Amazon AWS as a 12.5GB compressed archive containing only metadata."
- Flickr engineering blog (Yahoo/Flickr, primary), `https://code.flickr.net/?p=2751`: "Each of the 100 million photos and videos is associated with a Creative Commons license"; "Approximately 31.8% is marked for commercial use"; "17.3% has the most liberal license, which only requires attribution to the photographer". Table (photos): CC BY 17,210,144; BY-SA 9,408,154; BY-ND 4,910,766; **BY-NC 12,674,885; BY-NC-SA 28,776,835; BY-NC-ND 26,225,780**; total 99,206,564.
  - Derived from that table: NC photos = 67,677,500 / 99,206,564 = **68.2 %**. Commercial-use photos = 31,529,064 = 31.8 %, which matches the stated figure.
- The licence mix **of the 15M subset itself is not published** by OpenAI or OpenCLIP. It could be computed by joining the subset IDs with the YFCC100M metadata, which carries a licence per item (not done here, as it needs downloads).
- `http://mmcommons.org/` (Multimedia Commons): **blocked** (PROVENANCE_REQUIRED, not answered in time). Its official description was not quoted.

### C1c. Re-LAION status and LAION-trained OpenCLIP weights
- **Re-LAION-5B: Confirmed released 30 Aug 2024, Apache-2.0, research use, gated.** `https://laion.ai/blog/relaion-5b/` (dated "30 Aug, 2024"):
  - "The Stanford report prompted an immediate takedown of LAION-5B and we initiated a comprehensive safety revision."
  - "In all, 2236 links were removed after matching with the lists of link and image hashes provided by our partners."
  - "We release both Re-LAION-5B-research and Re-LAION-5B-research-safe under Apache 2.0 License."
  - "are released via gated access on HF, requiring submission of affiliation information and consent."
  - "The datasets are released for research purposes, especially for conducting basic research." / "We strongly advise AGAINST using the datasets in industrial settings."
  - "LAION has never distributed image content itself." The Apache-2.0 licence covers the link/metadata release, not the images.
- **Status since then: Partly.** The laion.ai/blog index lists no later post on Re-LAION, LAION-5B or LAION-400M (latest post: "LAION-BVD …" 26 Aug 2026). The HF collection `https://huggingface.co/collections/laion/re-laion-5b-research` lists `relaion2B-en-research`, `relaion2B-multi-research` and `relaion1B-nolang-research`, each "Updated Jun 5, 2024". The original `https://huggingface.co/datasets/laion/laion2b-en` is gated ("You need to agree to share your contact information to access this dataset."), not removed. Court cases were not researched.
- **LAION-trained OpenCLIP weights: Confirmed still available, tagged MIT, with a card that excludes deployment.** `https://huggingface.co/laion/CLIP-ViT-B-32-laion2B-s34B-b79K`: "License: mit"; "this model is intended as a research output for research communities."; "Any deployed use case of the model - whether commercial or not - is currently out of scope."; "This model was trained with the 2 Billion sample English subset of LAION-5B"; "Be aware that this large-scale dataset is uncurated."; "we do not recommend using it for creating ready-to-go industrial products". PRETRAINED.md still links LAION-400M weights ("Trained weights can be found in release" v0.2) and has no note on removal or Re-LAION.

---

## C2. DINOv2 / DINOv3

### C2a. Weights licence
- **DINOv2: Confirmed Apache-2.0.**
  - `https://raw.githubusercontent.com/facebookresearch/dinov2/main/README.md`: "DINOv2 code and model weights are released under the Apache License 2.0."
  - `https://raw.githubusercontent.com/facebookresearch/dinov2/main/LICENSE`: "Apache License" / "Version 2.0, January 2004".
  - `https://huggingface.co/facebook/dinov2-small`: "License: apache-2.0".
  - Paper `https://arxiv.org/pdf/2304.07193` (current version): "The code and pretrained models are made available under Apache 2.0 license".
  - Caution in the same README: the separate Cell-DINO models are "released under the FAIR Noncommercial Research License". Do not mix them up with DINOv2.
  - "Apache-2.0 since 2023?": **Partly.** The README's dated news entries have no licence-change entry. **(secondary)** `https://the-decoder.com/dinov2-metas-foundational-model-for-computer-vision-is-now-open-source/`: "Update, August 31, 2023:" "Meta releases DINOv2 as open source under the Apache 2.0 license." The prior licence (CC BY-NC per common report) was **not confirmed at source**; the mirror commit page (git.soton.ac.uk) failed to load.
- **DINOv3: Confirmed custom "DINOv3 License" (not Apache/MIT); weights gated.**
  - `https://github.com/facebookresearch/dinov3`: "DINOv3 code and model weights are released under the DINOv3 License."
  - `https://raw.githubusercontent.com/facebookresearch/dinov3/main/LICENSE.md`: "DINOv3 License", "Last Updated: August 19, 2025". Key clauses:
    - Grant: "You are granted a non-exclusive, worldwide, non-transferable and royalty-free limited" "license … to use," "reproduce, distribute, copy, create derivative works of, and make modifications to the DINO Materials." (No explicit commercial ban was found.)
    - Redistribution: "you may only do so under the terms of this Agreement and you shall provide a copy of this Agreement" "with any such DINO Materials."
    - Use restrictions: "You agree not to use, or permit others to use, DINO Materials for any activities subject to the International" "Traffic in Arms Regulations (ITAR) or end uses prohibited by Trade Controls, including those related to military" "or warfare purposes, nuclear industries or applications, espionage," "or the development or use of guns or illegal weapons."
    - "Your use of the DINO Materials will not involve or encourage others to reverse engineer, decompile" "or discover the underlying components of the DINO Materials."
    - Termination: "Upon termination of this Agreement, you shall delete and cease use of the DINO Materials." Governing law: California.
  - Gating: `https://huggingface.co/facebook/dinov3-vits16-pretrain-lvd1689m`: "License: dinov3-license"; "You need to agree to share your contact information to access this model"; "The information you provide will be collected, stored, processed and shared in accordance with the Meta Privacy Policy." The GitHub README: "once accepted, an e-mail will be sent with the complete list of URLs pointing to all the available model weights".
  - Against the owner's rule: this is a bespoke licence with field-of-use restrictions and a "same terms" redistribution condition. It is not a standard permissive licence. Whether it counts as "permissive" is the owner's or counsel's call; on its face it does not match "permissive only".

### C2b. Training data description and disclosure
- **DINOv2 LVD-142M: Confirmed described, not released.** README: "The models were pretrained on a dataset of 142 M images without using any labels or annotations." Paper: curated sources "contains ImageNet-22k, the train split of ImageNet-1k, Google Landmarks and several fine-grained datasets" (full list in its Table 15); "we collect a raw unfiltered dataset of images from a publicly available repository of crawled web data"; post-processing "PCA hash deduplication, NSFW filtering, and blurring identifiable faces"; "1.2B unique images". The paper does not release LVD-142M or give it a licence. The HF card says only "pretrained on a large collection of images in a self-supervised fashion." **Agrees with batch 2 H9.** For context, H9 found ImageNet's access terms: "only for non-commercial research and educational purposes".
- **DINOv3 LVD-1689M: Confirmed described, not released.** HF card: "Web dataset (LVD-1689M): a curated dataset of 1,689 millions of images extracted from a large data" "pool of 17 billions web images collected from public posts on Instagram". Paper `https://arxiv.org/pdf/2508.10104`: "we leverage a large data pool of web images collected from public posts on Instagram"; "a curated subset of 1,689 million images (named LVD-1689M)"; "We employ DINOv2 as image embeddings, and use 5 levels of clustering"; retrieval seeded from ImageNet-1k, ImageNet-22k and Mapillary Street-level Sequences; images "already went through platformlevel content moderation". No release of the dataset or licence statement for it. A satellite variant uses "SAT-493M" (not relevant here).

### C2c. File sizes of the small variants: **Confirmed**
| Variant | Params | Official weights | ONNX port (transformers.js) |
|---|---|---|---|
| DINOv2 ViT-S/14 (`facebook/dinov2-small`) | "22.1M params" (README table: 21 M) | model.safetensors **88.2 MB** | `onnx-community/dinov2-small`: model.onnx 88.5 MB, fp16 44.4 MB, int8/quantized 24.4 MB, q4 16.9 MB, q4f16 **13.9 MB**, bnb4 15.6 MB. **No licence line** in its README front matter (only "base_model: facebook/dinov2-small", "library_name: transformers.js"), so the base model's Apache-2.0 applies. `onnx-community/dinov2-with-registers-small` also exists (not inspected). |
| DINOv3 ViT-S/16 (`facebook/dinov3-vits16-pretrain-lvd1689m`) | "21.6M" (README: 21M) | model.safetensors **86.4 MB** (gated: "You can list files but not access them") | `onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX`: "License: dinov3-license"; no gating notice shown; model.onnx_data 86.3 MB, quantized 21.8 MB, q4 **14.7 MB**. Its "base model" metadata wrongly points to `facebook/dinov3-vit7b16-pretrain-lvd1689m`. An ungated copy does not change the licence. |
| OpenCLIP RN50 YFCC15M (`timm/resnet50_clip.yfcc15m`) | 38.4M (image tower) | 154 MB (image tower); 408 MB with text tower | None found |
| OpenCLIP RN101 YFCC15M | not read | file listing failed to load | None found |

---

## Model summary against the owner's rule

| Model | Weights licence | Training data | Data licence mix | Size (small/quantised) | Passes owner's rule? |
|---|---|---|---|---|---|
| OpenCLIP RN50 / RN101, YFCC15M | MIT (HF tag only; no licence text on card) | YFCC15M: 14.8 M Flickr images, IDs published by OpenAI | All CC. Full YFCC100M is 31.8 % commercial-use, ≈ 68 % NC. Subset mix unpublished. | RN50 image tower 154 MB fp32; no ONNX | **Weights: yes. Data known: yes. Data permissive: no (NC images almost certainly included).** Fails a strict reading. |
| OpenCLIP LAION-2B / 400M (e.g. ViT-B/32) | MIT tag, but card: "Any deployed use case … is currently out of scope" | LAION web scrape, "uncurated"; original taken down Dec 2023; Re-LAION research-only | Unknown (web images, no licences) | ViT-B/32 not measured | **No** |
| DINOv2 ViT-S/14 | Apache-2.0 | LVD-142M, not released; ImageNet-22k/1k, Landmarks + 1.2B web crawl | Unknown; ImageNet seed is non-commercial research | 88.2 MB fp32; 13.9–24.4 MB ONNX quantised | **Weights: yes. Data: no** (undisclosed). |
| DINOv3 ViT-S/16 | DINOv3 License (custom; use restrictions; gated) | LVD-1689M from 17 B Instagram public posts, not released | Unknown | 86.4 MB fp32; 14.7–21.8 MB ONNX quantised | **No** (both halves) |

---

## Unresolved items
1. **The exact licence mix of YFCC15M**: needs a join of OpenAI's subset TSV with YFCC100M metadata (licence column). Not done (no downloads). This is the one number that would settle C1b.
2. **The Multimedia Commons official description** (`http://mmcommons.org/`): blocked. The Flickr blog and the paper were used instead.
3. **RN101-YFCC15M file sizes and parameter count**: the HF tree page failed twice.
4. **DINOv2's licence before Aug 2023**: only a secondary article dates the Apache-2.0 switch. The original licence and the commit were not read at source.
5. **The HF "mit" tag on the timm YFCC repos** is metadata only. Neither the cards nor the OpenCLIP repo carry a weights-licence statement, so the basis for MIT on the weights is not documented.
6. **Re-LAION after Aug 2024**: there is no LAION blog update. Legal proceedings involving LAION were not researched.
7. **Prior work (batch 2, H9)**: re-verified. DINOv2 README quote, LVD-142M description and "not released" all **agree**. New in this batch: the LICENSE file header, the HF tag, the paper's Apache-2.0 sentence and the dated switch (secondary). No differences.
