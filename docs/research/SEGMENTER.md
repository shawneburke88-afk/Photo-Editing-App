# A small one-click segmenter of our own: sky, person, subject, background

**Prepared for:** Shawn Burke (LightBench) · **Research date:** 2026-10-13 · **Status:** research and plan only. No
code, no training, no repository change.
**Reads with:** IMPROVEMENTS.md §2 (row A3),
AI_MODELS.md §2, PHASE4_MODELS.md §3, cowork-2026-10-13/PHASE4_MODELS.md §2, PHASE4_GROUNDWORK.md §1.6 and §4,
MASKING.md ("How AI masks plug in later"). All in `docs/research/` of LightBench `main` (`a0f8353`).

**Conventions** (as in the other research docs):
- **[read]**: quoted or checked at the primary source today. **[measured]**: counted or measured here today.
- **[doc]**: taken from an earlier LightBench research doc, not re-checked.
- **[unconfirmed]**: from memory, a secondary source, or a page that couldn't be opened (huggingface.co, arxiv.org,
  cocodataset.org, cityscapes-dataset.com, ade20k.csail.mit.edu, mapillary.com, image-net.org, polyhaven.com,
  kaggle.com, zenodo.org and the SkyFinder hosts were all blocked from this machine).
- **[estimate]**: worked out, with the basis stated. **[idea]**: a proposal, untested.
- Not legal advice. Where a licence question is open, the facts are listed and the decision is the owner's.

---

## Summary

1. **Open Images V7 has no sky masks.** Its 350 segmentation classes don't include Sky [measured: the class list
   checked against the class names]. Sky isn't one of the 600 box classes either. Sky does have **point labels**:
   284,093 "yes" points out of 575,362 in all splits [read, `oidv7-class-descriptions-points.csv`]. The validation
   split alone has 11,234 yes / 6,988 no / 2,699 unsure Sky points on 2,283 images [measured]. Sky also has
   human-verified image-level labels, including verified negatives. Person masks are plentiful: **769,423** training masks
   for Person/Man/Woman/Boy/Girl/Human body [measured; the facts page says "769k"]. Licences: annotations are
   CC BY 4.0, and the images are "listed as having a CC BY 2.0 license", with no warranty per image [read].
2. **Sky masks with a usable licence exist in COCO-Stuff** (`sky-other`, `clouds`, `fog`; annotations CC BY 4.0
   [read]). But they were painted on about 1,000 SLICO superpixels per image [read], so their edges are coarse, and the
   COCO images carry per-image Flickr licences, three of them non-commercial [read: the COCO `licenses` table]. Filtering
   by licence id is possible. How many images survive the filter is **[unconfirmed]**.
3. **No existing model covers sky within the owner's rules and browser size.** The only permissive sky model found is
   DA3 MONO-LARGE (Apache 2.0, 0.35 B params, about 700 MB fp16 [doc]), and its training data is described only as
   "public academic datasets" [read]. **Sky is where training our own pays off.**
4. **Person: an existing model may be enough.** MediaPipe Selfie Multiclass (Apache 2.0; the 256² model is
   16,371,837 bytes fp32 [measured]) was trained on "thousands of samples with diverse identities" [read, model card].
   That is undisclosed but not stated to be non-commercial. It is low-resolution and selfie- or full-body-oriented.
   Training a person head **alongside** the sky head costs little extra, so the plan includes one.
5. **Subject: the best existing model fails the data rule.** BiRefNet_lite is MIT, but its training sets include DIS5K,
   whose terms say "commercial use of this dataset is prohibited even after copying, editing, processing" [read, DIS5K
   terms PDF]. A clean subject head is possible from Open Images masks, but expect it to be clearly worse than
   BiRefNet_lite on fine structures [estimate]. **Background** = 1 − subject (no separate model).
6. **Proposed model** [idea]: one fully convolutional MobileNet-style encoder with a light FPN decoder and three heads
   (sky, person, subject), plus image-level "sky present / person present" heads. About **4.6 M params (≈ 9 MB fp16)**
   and 7 GMAC at 512×768 [estimate, computed]. It is trained **from scratch** on licence-clean data, with no
   ImageNet/SA-1B/DIS5K backbone or teacher. Edges are refined with a cross guided filter in WGSL. The raster is stored
   per MASKING.md.
7. **Training on the RTX 4000 Ada (laptop, inferred)**: batch about 16 at 512² fits in about 10 GB [estimate]. A full
   10 M-sample run takes **≈ 0.7–2 days**; pilots take hours. The cloud fallback is **≈ 2–6 A100-hours per run**. Bases
   are in §4.
8. **Recommendation:** train our own **sky** (the gap) together with **person** and **subject** heads in one small
   network. Then decide per target from measured results: ship ours where it matches or beats MediaPipe for people,
   and offer BiRefNet_lite only as an optional download if the owner accepts weights-licence-only provenance for
   "subject".

---

## Contents

1. [Datasets and licences](#1-datasets-and-licences)
2. [Existing permissive models](#2-existing-permissive-models-to-compare-against-or-start-from)
3. [Model design for the browser](#3-model-design-for-the-browser)
4. [Training on the owner's GPU](#4-training-on-the-owners-gpu)
5. [Evaluation](#5-evaluation)
6. [Licence of the resulting weights and attribution](#6-licence-of-the-resulting-weights-and-attribution)
7. [Recommendation per target and open questions](#7-recommendation-per-target)
8. [Verification log and sources](#8-verification-log-and-sources)

---

## 1. Datasets and licences

### 1.1 Open Images V7 (the backbone of the plan)

**Licence** [read, facts page `storage.googleapis.com/openimages/web/factsfigures_v7.html`]:
> "The annotations are licensed by Google LLC under CC BY 4.0 license. The images are listed as having a CC BY 2.0
> license. Note: while we tried to identify images that are licensed under a Creative Commons Attribution license, we
> make no representations or warranties regarding the license status of each image and you should verify the license
> for each image yourself."

Per-image attribution data exists: `2018_04/image_ids_and_rotation.csv` (3,348,497,077 bytes) has the columns
`ImageID, Subset, OriginalURL, OriginalLandingURL, License, AuthorProfileURL, Author, Title, …` [read, first rows by
Range request]. A per-image credit list can be generated from it for exactly the images used.

**Does segmentation include sky? No** [measured]. `v5/classes-segmentation.txt` (350 MIDs; identical to
`v7/oidv7-classes-segmentation.txt` [measured with `diff`]) was joined with the class names. Sky (`/m/01bqvp`) is not in
it, and it isn't in the 600 boxable classes either. Neighbouring "stuff" classes are also absent from segmentation:
Cloud, Tree, Building (only *Skyscraper* and *Lighthouse* are segmented), Mountain, Water, Grass. They exist as
image-level and point-level labels.

**What does exist for sky** [read, facts page; measured where stated]:
- **Point-level labels** (new in V7): "66.4M point-level labels over 1.4M images, covering 5,827 classes … including
  both things and stuff … suitable for zero/few-shot semantic segmentation". Each point is yes/no/unsure from human
  votes. For **Sky**: 284,093 yes points out of 575,362 points [read, `oidv7-class-descriptions-points.csv`, which
  appears to total all splits]. In the validation split: **11,234 yes, 6,988 no, 2,699 unsure** Sky points on
  **2,283 images** [measured, streaming the 94 MB `oidv7-val-annotations-point-labels.csv`]. Related classes: Cloud
  109,976 yes; Tree 268,236; Building 138,799; Water 110,365; Human hair 42,960 [read, same file].
- **Image-level labels**, human-verified positive and **negative**. "The verified negative labels are reliable"
  [read]. In validation, Sky has 2,017 verified positives and 21 verified negatives [measured]. Training-split counts
  weren't computed (2.7 GB file).
- **Masks of other classes** are free negatives for sky, and they include building and tree-like edges against sky
  (Skyscraper, Lighthouse, Christmas tree, Flag, Kite, Balloon, Aircraft…).

**Masks per relevant class** [measured: streamed `v5/train-annotations-object-segmentation.csv`, 806,943,628 bytes,
not stored; totals 2,686,666 masks on 944,037 images, matching the facts page]:

| Class or group | Train masks | Val masks | Test masks |
|---|---:|---:|---:|
| Person / Man / Woman / Boy / Girl / Human body (sum) | **769,423** | 1,688 | 5,102 |
| of which Person | 149,166 | 269 | 822 |
| Clothing | 414,489 | 276 | 829 |
| Animal subtree (78 segmentation classes) | 169,880 | 5,244 | 15,488 |
| Dog / Cat / Horse / Bird | 21,934 / 11,402 / 9,031 / 23,686 | 293 / 296 / 287 / 289 | 889 / 891 / 860 / 865 |
| Vehicle subtree (18 classes) | 237,040 | 1,926 | 5,811 |
| Building subtree (Skyscraper, Lighthouse) | 62,453 | 96 | 362 |
| Plant subtree (Flower, Rose, Common sunflower, Christmas tree) | 103,254 | 623 | 1,702 |
| Sculpture / Bronze sculpture / Bust | 26,570 / 2,626 / 989 | 212 / 49 / 19 | 547 / 133 / 42 |
| **Sky, Cloud, Tree, Mountain, Water** | **0** (not segmentation classes) | 0 | 0 |

**Mask quality and coverage** [read, facts page]:
- **Train masks** came from "a state-of-the-art interactive segmentation process [4], where professional human
  annotators iteratively correct the output of a segmentation neural network … (mIoU 84%)". That is good for semantics
  but soft on hair-level edges.
- **Validation/test masks** were drawn "with a purely manual free-painting tool and with a strong focus on quality.
  They are near-perfect (self-consistency 90% mIoU)". That makes them the evaluation gold standard here.
- **Not exhaustive.** Only instances over 40×80 px, with clear boundaries, and not group/depiction/inside were masked.
  "person" was capped at 149k, "woman" at 117k and "man" at 114k. "Instances without a mask remain covered by their
  corresponding bounding boxes". **Consequence for training:** pixels inside unmasked boxes of the same class must be
  *ignored*, not treated as background (§4.3).
- **Provenance note:** the interactive tool's network (Benenson et al., CVPR 2019) was trained on some earlier
  dataset. Which one wasn't checked **[unconfirmed]**. The released masks are human-corrected annotations under
  CC BY 4.0, so this is tool provenance, not a training-data import. Mentioned for completeness.

**Sizes** [measured unless marked]:
- Training masks: 16 zips totalling **4.47 GB**; validation masks 0.06 GB.
- Images from the CVDF S3 bucket (`open-images-dataset.s3.amazonaws.com`, reachable): the validation tar is
  12,844,530,798 bytes for 41,620 images, i.e. **≈ 309 KB per image**. A sample of 20 validation images averaged
  ≈ 306 KB. Eight sampled images were all ≤ 1024 px on the long side.
- So the 944k segmentation images are **≈ 290 GB** [estimate]. A 300k subset is ≈ 90 GB, and ≈ 20–30 GB once
  resized to a 640 px long side at JPEG q90 [estimate].
- The 16 training tars total 549.5 GB [measured]. Which images they hold (the 1.74 M boxable set?) is
  **[unconfirmed]**. Download the subset by image ID instead (the official `downloader.py` takes ID lists
  [unconfirmed: not re-read]).

### 1.2 Other sources

| Source | What it gives | Licence (status) | Use here |
|---|---|---|---|
| **COCO-Stuff** (164K COCO images) | Dense labels: 80 thing + 91 stuff classes, including **`sky-other`** ("Any other type of sky (incl. blue sky)"), **`clouds`**, `fog`, `tree`, `mountain`, `building-other` [read, `labels.md`] | "COCO images: Flickr Terms of use; COCO annotations: CC BY 4.0; COCO-Stuff annotations & code: CC BY 4.0" [read, README] | **Yes, licence-filtered** (below). Edges are coarse: the stuff tool "uses a paintbrush tool to annotate SLICO superpixels" with "approx. 1000 regions (superpixels)" per image [read, cocostuff10k README]. Good for sky semantics, poor for tree edges |
| **COCO** images | Per-image licence id. The table: 1 BY-NC-SA 2.0, 2 BY-NC 2.0, 3 BY-NC-ND 2.0, **4 BY 2.0**, 5 BY-SA 2.0, 6 BY-ND 2.0, **7 "No known copyright restrictions"**, **8 "United States Government Work"** [read, the `licenses` array in `cocodataset/panopticapi` sample JSON; the real `instances_*.json` should carry the same table **[unconfirmed]**] | per image | Keep ids 4, 7, 8. Ids 5 (ShareAlike) and 6 (NoDerivs) are owner decisions; ids 1–3 are excluded. **The share of ids 4/7/8 is [unconfirmed]**: images.cocodataset.org didn't resolve here, so the 241 MB annotation zip couldn't be counted. COCO's per-image entries give `flickr_url` but no author name **[unconfirmed]**, so credit lists are harder than for Open Images |
| **COCO** person masks | Polygon instance masks | annotations CC BY 4.0 [read via COCO-Stuff README] | Same licence filter. Optional extra people data |
| **SA-V** (Meta) | 50,583 training videos; 642,036 masklets (451,720 auto + 190,316 manual) [read]. **Class-agnostic** (no "sky" or "person" label) | "The dataset is released under the CC by 4.0 license" [read, `sam2/sav_dataset/README.md`] | **Low value for v1.** No classes. The auto masklets are SAM 2 outputs, and the manual ones were made with SAM 2 assistance **[unconfirmed: SAM 2 paper not readable here]**, so they carry SA-1B-trained model influence. Possible later use: a generic "objectness" signal for the subject head |
| **ADE20K** | 150+ classes incl. sky | Terms page blocked; README only links "Terms of Use" [read]. Earlier quote: "only for non-commercial research and educational purposes" [doc, Cowork] | **Exclude** |
| **Cityscapes** | Street scenes incl. sky | "The dataset itself is released under custom terms and conditions" [read, cityscapesScripts README]; the terms page was blocked, and their being non-commercial is **[unconfirmed]** | **Exclude** until the terms are read. Street-only domain anyway |
| **Mapillary Vistas** | Street scenes incl. sky | The GitHub README states no dataset licence [read]. Thought to be CC BY-NC-SA 4.0 for the research edition **[unconfirmed]** | **Exclude** unless confirmed otherwise |
| **SkyFinder** (Mihail et al., 2016; AMOS webcams) | ~90k webcam frames with sky masks **[unconfirmed]** | **[unconfirmed]**: all hosts blocked; no licence found | **Exclude** (unknown terms; few fixed viewpoints, webcam quality) |
| **DIS5K** | High-quality dichotomous masks | "available for non-commercial use in research or educational purpose … commercial use of this dataset is prohibited even after copying, editing, processing or any operations of this database" [read, `DIS5K-Dataset-Terms-of-Use.pdf`] | **Exclude** |
| **DUTS** (saliency) | 10k+ saliency masks | site unreachable; licence **[unconfirmed]** | Exclude until known |
| **P3M-10k**, **AM-2k**, **BG-20k** (Jizhizi Li) | Portrait mattes (face-blurred), animal mattes, 20k background-only photos | README links "Agreement (MIT License)" PDFs; P3M images were collected "from the Internet with free use license" [read, READMEs]. The agreement PDFs themselves were blocked **[unconfirmed]** | **Candidate for hair edges and compositing backgrounds**, once the owner reads the agreements |
| **Supervisely Person** | Person masks | **[unconfirmed]** | Not needed |
| **Owner's own photos** | Domain-matched (LightBench renders of NEF/ARW) | the owner's | **High value**: 200–300 for evaluation, 300–1,000 for fine-tuning |

### 1.3 Synthetic options [idea]

- **Sky replacement compositing.** Take images whose sky mask is confident (from COCO-Stuff, or later from our own
  model and verified), and replace the sky with other sky photos. Then match the foreground's white balance and exposure
  to the new sky. This breaks the "sky = blue gradient" shortcut and teaches sunsets, overcast and night skies. The
  replacement skies must be clean too: the owner's own sky photos, or CC0 assets.
- **Poly Haven** states: "Our assets are all licensed as CC0 … You can use our assets for any purpose, including
  commercial work. You do not need to give credit" [read: `public/locales/en/license.json` in the site's own repo
  `Poly-Haven/polyhaven.com`; polyhaven.com itself was blocked]. **Caveat:** an HDRI's lower hemisphere and horizon
  contain trees and buildings. Its upper part is usable as replacement sky only above a horizon line drawn by hand.
- **Rendered scenes with exact sky alpha.** Use Blender (GPL; renders aren't covered by it) with the procedural
  *Sky Texture* plus CC0 trees, buildings and people models, and **transparent film**. Alpha is exactly "background
  visible" through leaves and branches, which is the hardest real-world case. Cost: Cycles at 1 MP is 10–60 s per
  frame [doc estimate, IMPROVEMENTS A4], so prefer EEVEE. A few thousand frames is enough as a *fine-edge* supplement,
  not as the main dataset [estimate].
- **Synthetic hair over sky.** Composite P3M/AM-2k mattes (if their agreements allow) over sky photos. This gives
  hair-against-sky alpha with known ground truth.
- **Self-training (clean, because the teacher is ours).** Train v1, then predict sky on Open Images images that have
  a verified Sky label. Keep predictions that agree with the human yes/no points, and retrain. No foreign teacher
  enters the provenance.

### 1.4 Datasets that would import restricted provenance (for the record)

Pseudo-labelling with SAM 2.1, BiRefNet, DA2/DA3 or any ImageNet-pretrained model brings their training data's terms
into the weights' provenance. That is the same policy question as using those models directly (IMPROVEMENTS §2.2).
**The plan below uses none of them for training labels.** They appear only in evaluation (§5).

---

## 2. Existing permissive models to compare against or start from

| Model | Weights licence | Training data (status) | Size / input | Covers | Meets the need? |
|---|---|---|---|---|---|
| **MediaPipe Selfie Multiclass** (May 2023) | "Apache License, Version 2.0" [read, model card PDF] | "trained on thousands of samples with diverse identities" [read]: undisclosed, not stated NC | 16,371,837 B fp32 TFLite at 256² [measured]. The card also describes a 512² model; `selfie_multiclass_512x512` returns 404 in the public bucket [measured] | background, hair, body-skin, face-skin, clothes, others | **Partly (people in portraits).** The card: "may not provide pixel perfect masks", "not intended for … applications that require pixel perfect masks" [read]. Mean IoU 77.23 (256²) / 81.10 (512²) on Google's 1,902-instance set [read]. TFLite only, so it needs MediaPipe's runtime or a conversion |
| **MediaPipe Selfie Segmentation** (May 2021) | Apache 2.0 [read] | "consented images of people using a mobile AR application", smartphone cameras [read] | 249,537 B (general) / 250,177 B (landscape) [measured]; 256×256 / 144×256 [read] | person vs background | **Selfie framing only.** Out of scope per its card: "Multiple people across different scales", "People too far away from the camera (e.g. further than 14 feet / 4 meters)" [read]. Clean provenance as stated |
| MediaPipe Hair Segmentation | Apache 2.0 [read, card] | in-the-wild smartphone images [read] | 781,618 B [measured] | hair | Selfies only; not evaluated further |
| MediaPipe DeepLab-v3 | not checked | PASCAL VOC classes **[unconfirmed]** | 2,780,176 B [measured] | 21 VOC classes **[unconfirmed]** (no sky) | No |
| **BiRefNet_lite** (Swin-T) | MIT [doc, read in earlier docs] | lite "general use": "DIS5K-TR, DIS-TEs, DUTS-TR_TE, HRSOD-TR_TE, UHRSD-TR_TE, HRS10K-TR_TE, TR-P3M-10k, TE-P3M-500-NP, TE-P3M-500-P, TR-humans" [read, README model zoo]. **DIS5K: non-commercial** [read]. Swin-T backbone ImageNet-pretrained **[unconfirmed]** | 44.4 M params, fp16 115 MB, 1024² [doc]; ~700 ms/frame warm on an RTX 4090 in a third-party WebGPU port after graph surgery [doc, Cowork] | salient subject, hair-level edges | **Quality yes; data rule no; size 5–10× the target.** If the owner accepts weights-licence-only provenance, it already meets "subject", and our subject head will be worse |
| **U²-Net / U²-Netp** | Apache-2.0 repo licence; no separate weights statement [doc] | DUTS-TR (licence **[unconfirmed]**). README: "please keep the input size as 320x320" [read] | u2netp 4.7 MB [read] | saliency | A **size-matched baseline** for evaluation only |
| **MODNet** | "The code, models, and demos in this repository … are released under the Apache License 2.0" [read] | "trained on the datasets mentioned in our paper" [read]; the paper wasn't readable **[unconfirmed]** | not measured | portrait matting | Portraits only; provenance unknown. Comparison only |
| **PP-HumanSeg** (OpenCV Zoo port) | Apache-2.0 LICENSE file [read] | **[unconfirmed]** | not measured | person | Comparison only |
| **SegFormer** (any) | NVIDIA Source Code License, "research or evaluation purposes only" [doc] | ADE20K/Cityscapes | — | sky etc. | **Excluded** |
| torchvision DeepLab/LR-ASPP | torchvision: "The pre-trained models provided in this library may have their own licenses or terms and conditions derived from the dataset used for training" [read, README] | COCO subset with VOC classes **[unconfirmed]** | — | no sky | No |
| **DA3 MONO-LARGE** (sky head) | "Apache 2.0" [read, model table] | "trained exclusively on public academic datasets" [read]; which ones, and their terms, **[unconfirmed]** | 0.35 B params | depth + sky | Too large as a default. **Use as an offline evaluation reference** (Python, on the owner's GPU) |
| **DINOv2** backbones | "DINOv2 code and model weights are released under the Apache License 2.0" [read] | LVD-142M, not released; composition **[unconfirmed]** | ViT-S/14 ≈ 21 M params **[unconfirmed]**, so ≈ 42 MB fp16; too heavy at 512² in a browser | features | **Policy question**: usable as a *distillation teacher* for our small backbone (licence fine, data undisclosed). Not proposed for v1 |
| **DINOv3** | custom "DINOv3 License" with ITAR/military and reverse-engineering clauses [doc, AI_MODELS] | — | — | — | **Excluded** |
| **SAM 2.1 Tiny** | Apache-2.0 [doc] | SA-1B (~15 %) + SA-V + internal [doc] | 67 MB fp16 encoder + 10.5 MB decoder [doc] | promptable, class-agnostic | Not one-click by itself. **Comparison only** (with automatic prompts) |
| xiongzhu666 U²-Net sky | MIT repo [doc] | "Not specified" [doc] | 2–167 MB | sky | **Hold** (unknown data) |

**Honest assessment: does an existing model already meet the need?**
- **Sky: no.** Nothing found is permissive, documented and browser-sized. This is the gap.
- **Person: possibly, for portraits.** MediaPipe Selfie Multiclass is Apache-2.0 with no known NC data. If refining its
  256² mask with a guided filter looks good on the owner's portraits, it suffices there. It is weak for small or
  distant people and group scenes (its own out-of-scope list), which landscape and street photographers hit often.
- **Subject: yes in quality (BiRefNet_lite), no under the data rule.** Under a strict rule, own training is the
  only route, and it will be worse at hair and thin structures [estimate].
- **Background:** the inverse of whichever subject model is used.

---

## 3. Model design for the browser

### 3.1 Architecture [idea; sizes computed]

**One network, three dense heads, two image-level heads.**
- **Encoder:** inverted-residual (MobileNetV2/V3-style) stages. Depthwise convs, ReLU/hard-swish and BatchNorm all
  export to plain ONNX ops on ORT-web's WebGPU EP (Conv, Add, Mul, Clip, Resize) [doc: operator lists in
  PHASE4_GROUNDWORK §4.2; not tested for this net]. An optional single self-attention block at stride 32 gives global
  context, e.g. "white wall vs overcast sky" (+ ≈ 0.5–1 M params) [idea].
- **Decoder:** FPN-lite. 1×1 laterals at strides 32/16/8/4 to 64–96 channels, top-down upsample-and-add, one
  depthwise-separable 3×3 per level, and a head at stride 4.
- **Dense outputs:** 3 logits (sky, person, subject) at ¼ of the input resolution.
- **Image-level outputs** (from pooled stride-32 features): `sky_present` and `person_present`. They are trained from
  Open Images' **verified negatives**, and at inference they gate the dense heads: an indoor shot returns an empty sky
  mask instead of blotches.
- **Why not reuse MediaPipe's or BiRefNet's design:** neither is licence-clean to *start from* (weights trained on their
  data). Fine-tuning would keep their provenance.

**Two sizes**, computed with an analytic counter (convs only, BN folded at export, no SE)
[`research-ml/tools/count.py`]:

| Variant | Params | fp16 file | GMAC at 512×512 | GMAC at 512×768 | Use |
|---|---:|---:|---:|---:|---|
| **S** (stem 24; stages 24/32/48/96/128/192; decoder 64) | 2.09 M | ≈ 4.2 MB | 2.41 | 3.61 | integrated-GPU default, pilot runs |
| **M** (stem 32; stages 32/48/64/128/160/256; decoder 96) | 4.59 M | ≈ 9.2 MB | 4.65 | 6.97 | **proposed default** |
| L (M × 1.5 width + attention block) | ≈ 10–11 M [estimate] | ≈ 20–22 MB | ≈ 10–14 [estimate] | — | only if M falls short; still under the 25 MB ceiling |

**Browser speed** [estimate, low confidence; nothing measured]: 7 GMAC at 512×768 is 14 GFLOP. Depthwise-heavy nets reach
a small fraction of peak on WebGPU, so assume 0.5–2 TFLOPS effective on a discrete GPU and 0.1–0.3 on an integrated one.
That is ≈ 10–40 ms and ≈ 50–150 ms per photo. One-click masks run once per photo, so this is comfortable either way.
Measure on the owner's GPU and an iGPU first (PHASE4_MODELS "Speed" item).

### 3.2 Backbone pretraining that stays licence-clean

| Option | Licence status | Cost [estimate] | Verdict |
|---|---|---|---|
| **A. From scratch, multi-task** on the Open Images segmentation images, with an auxiliary image-level classification head on the same images' human-verified labels (≈ 600 boxable or the top ~1,000 trainable classes) | Clean (CC BY 4.0 annotations, CC BY 2.0 images) | No extra download; the aux head is nearly free | **Proposed for v1.** From-scratch training on about 1 M dense-labelled images is a reasonable regime. That it nearly matches ImageNet pretraining given longer schedules is a literature result (He et al. 2019, "Rethinking ImageNet Pre-training") **[unconfirmed: from memory]** |
| B. Separate supervised pretraining on 1–2 M Open Images images at 224² | Clean | +300–600 GB download; ≈ 1.5–2.5 days laptop or 4–8 A100-h (M backbone at 224² ≈ 0.74 GMAC → ≈ 4.4 GFLOP per training sample × 30 M samples, data-loading bound) | Only if A plateaus |
| C. Feature distillation from DINOv2 ViT-S (Apache-2.0 weights) | Weights fine. Data LVD-142M undisclosed **[unconfirmed]** | Teacher features precomputed: hours | **Owner policy question.** Likely the largest quality gain per hour [estimate] |
| D. ImageNet-pretrained MobileNet (torchvision/timm) | Weights BSD/Apache. ImageNet's access terms are thought to be research/non-commercial **[unconfirmed: image-net.org blocked]**; torchvision itself warns that weights "may have their own licenses … derived from the dataset" [read] | none | **Excluded under the strict rule** |
| E. Formula-driven pretraining (FractalDB-style synthetic images) | Generated data; the specific repo licences weren't checked **[unconfirmed]** | ≈ 1 day | A curiosity; gains for segmentation uncertain **[unconfirmed]** |

### 3.3 Input, domain and output

- **Input** [idea]: the **rendered, display-referred straightened frame** (what the user sees), downscaled to
  **512 px on the short side** (512×768 for 3:2, 512×683 → padded to a multiple of 32 for 4:3), sRGB 8-bit-like values in
  [0, 1]. Feeding tone-mapped data also avoids the fp16-overflow reports for HDR inputs [doc, PHASE4_GROUNDWORK §4.3].
- **Use a neutral render for inference, not the user's current look** [idea]: default develop + Auto exposure. A mask
  then doesn't change when the user later pushes contrast, and "recompute on paste" gives the same mask on similar
  photos. The training images are camera JPEGs, which are close to a neutral render.
- **Fixed shapes:** export a few static shapes (512×768, 768×512, 512×512, 512×704, 704×512). ORT's graph capture needs
  static shapes [doc, Cowork §7.2]. Pad to the nearest one.
- **Output:** 3 logits at 128×192 (for 512×768). Upsample bilinearly inside WGSL, not in the ONNX graph, so the
  refinement owns the full-resolution step.

### 3.4 Edge refinement with a guided filter

**What LightBench has** [read, `web/src/engine/gpu/tone-mask.wgsl`, `web/src/engine/color/tone-mask.ts`]:
- The tone equalizer's **exposure-independent guided filter (EIGF)**, after darktable's `eigf.h`.
- It computes local E[I] and E[I²] of a luminance norm over blocks, then a Gaussian over 2.5 % of the photo
  (`moments`, `reduce`, `blurX`, `blurY` passes).
- It is a **self-guided** filter on luminance. MASKING.md already says a mask refine can "reuse [it] in form if not in
  data".

**What a mask refine needs** [idea]:
- A **cross** guided filter (He, Sun, Tang): guide I = the photo, input p = the upsampled mask probability.
  - Per window: a = cov(I, p) / (var(I) + ε), b = E[p] − a·E[I]; output q = mean(a)·I + mean(b).
  - The moments pass gains two channels, E[p] and E[I·p]. The blur passes are the same pattern with a **small radius**
    (≈ 2–8 px at preview size, scaled with the export size; not 2.5 % of the photo).
- **Colour guide (3-channel)** for hair against sky and leaves against sky, where luminance alone can be equal and
  hue differs. It needs E[I Iᵀ] (6 values) and E[I p] (3 values) per pixel, then a 3×3 solve. That is cheap in WGSL.
  Use a perceptual space (OkLab or log-RGB of the display render), not linear scene RGB, so ε means the same in shadows
  and sky [idea].
- **Fast guided filter** (He & Sun 2015): compute a and b at ¼ resolution, upsample them bilinearly, apply at full
  resolution. Export cost becomes O(N) with tiny constants **[unconfirmed: from memory, paper not
  re-read]**.
- **Band-limited:** apply only where 0.02 < p < 0.98 after a small dilation, and keep confident interiors as they are.
- **Sky-specific extra** [idea]: in the uncertain band, mix in a per-image colour model (sky colours sampled from the
  confident sky, non-sky from the confident non-sky). This handles the "sky through leaves" holes that a ¼-resolution
  net can't see. Classical, licence-free, and similar in spirit to xiongzhu666's C++ post-processing [doc].
- **Trainable alternative:** a "deep guided filter" layer trained end-to-end (Wu et al., CVPR 2018)
  **[unconfirmed: not re-read]**. Only if the plain filter isn't enough. It would still run as LightBench WGSL.
- **User controls:** MASKING.md's Feather/Refine edges map directly to blur and ε/radius.

### 3.5 Output stored as a raster (per MASKING.md)

MASKING.md's component: `{ kind: 'ai', what: 'sky'|'subject'|'background'|'people', model, modelVersion, prompt,
raster }`, stored in the **sensor frame**, "store the raster, not just the prompt". Two ways to fill `raster` [idea]:

1. **Store the refined mask** (8-bit, ≤ 1024 px or ≤ 2048 px long side, deflated). This is LightCraft's approach
   (≤ 1024² i8 logits) [doc]. Simple and exact across GPUs. The full-size export upsamples it with the same guided
   filter.
2. **Store the model's raw ¼-resolution logits** (e.g. 128×192 × 1 channel × int8 ≈ 24 KB before deflate) and
   **re-run LightBench's own refine** at every render resolution. That gives sharper exports, and the refine is
   LightBench's process-versioned WGSL, so its output is as stable as the rest of the pipeline. The model itself never
   re-runs, which keeps the "identical on every GPU" property for the network part.

Option 2 fits the "logits + sigmoid upsample smoothly" note in MASKING.md and keeps edits small. It needs the refine to
be part of the process version. The owner decides (Q6).

---

## 4. Training on the owner's GPU

### 4.1 Compute basis [estimate]

Same hardware facts as IMPROVEMENTS §2.0 [doc]:
- RTX 4000 Ada Generation, 12,282 MiB, 130 W cap, Windows/WDDM, about 1.3 GB used by the desktop. The laptop variant
  is an inference.
- **≈ 10–10.5 GB usable.**

Additions specific to this net:

| Quantity | Value | Basis |
|---|---|---|
| Forward FLOPs per sample, M at 512² | 9.3 GFLOP | 2 × 4.65 GMAC (computed) |
| Training FLOPs per sample | ≈ 28 GFLOP (512²), ≈ 16 GFLOP (384²) | × 3 for forward + backward |
| **Effective throughput, depthwise-heavy net, laptop Ada, AMP** | **2–6 TFLOPS** | Lower than IMPROVEMENTS' 8–15 TFLOPS for dense convs, because depthwise convs are memory-bound [estimate] |
| Data loading | **150–300 images/s** | JPEG decode + random resized crop + colour augmentation of ≤ 1024-px images on 8–12 laptop CPU workers [estimate]. Pre-resizing to 640 px raises it |
| Activation memory, M at 512² | ≈ 0.35 GB per sample | 50.6 M activation elements in the encoder (computed) × 3 stored tensors (conv, BN, activation) × 2 bytes, + ≈ 20 % for the decoder |
| **Batch that fits** | **16 at 512²** (≈ 5.6 GB activations + ≈ 1 GB workspace + small weights/optimizer); 24 is tight; **≈ 12 at 512×768**; ≈ 32 at 384² | from the line above. Use `channels_last` + bf16 autocast. If it doesn't fit, use gradient checkpointing per stage, or gradient accumulation |

### 4.2 Time per run [estimate]

| Run | Samples | Laptop GPU (compute) | Laptop (data-loading bound) | **Laptop, with ×1.5 overhead** | A100 |
|---|---:|---|---|---|---|
| Pilot: S at 384², 3 heads | 2 M | 2 M × 8 GFLOP ÷ (2–6 TFLOPS) = 0.7–2.2 h | 2 M ÷ (150–300/s) = 1.9–3.7 h | **≈ 3–6 h** | < 1 h |
| Main: M, 70 % of samples at 384², 30 % at 512×768 | 10 M | 10 M × ≈ 21 GFLOP average ÷ (2–6) = 10–29 h | 9–19 h | **≈ 0.7–1.8 days** | **≈ 2–5 A100-h** (assumes 20–50 TFLOPS effective and ≥ 1,000 images/s loading on a cloud VM) |
| Self-training round (fine-tune) | 3 M | 3–9 h | 3–6 h | ≈ 0.3–0.6 day | ≈ 1–2 h |
| Owner-photo fine-tune | 0.2 M | < 1 h | < 1 h | ≈ 1 h | — |
| (Option B pretraining, §3.2) | 30 M at 224² | 6–18 h | 28–56 h | ≈ 1.5–2.5 days | ≈ 4–8 h |

This is consistent with IMPROVEMENTS' "≈ 1–3.5 days laptop; 2–5 A100-h" for 10–20 M samples.

**Programme** [estimate]: 2–3 pilots + 2 main runs + 1 self-training round + fine-tune is ≈ 4–6 laptop-days of GPU
time over two to four weeks of calendar time, or ≈ 10–20 A100-hours.

**Laptop practicalities** [IMPROVEMENTS §2.0, plus these]:
- Checkpoint every 20–30 min and resume from the latest (multi-day loads may throttle; Windows Update and sleep kill
  runs).
- **Prefer WSL2 (Ubuntu) over native Windows** [unconfirmed: from experience, not measured here]. PyTorch DataLoader
  workers on Windows use spawn and start slowly, `torch.compile`/Triton support on native Windows is limited, and
  NVIDIA DALI (GPU JPEG decode) is Linux-only. CUDA under WSL2 is supported by NVIDIA for recent drivers
  **[unconfirmed]**.
- Keep the dataset on an internal NVMe drive, pre-resized (§1.1): ≈ 20–30 GB for a 300k subset.

### 4.3 Labels, losses and sampling [idea]

Each training sample carries, per head, a **target** and a **validity mask** (pixels where the label is known):

| Source | Sky head | Person head | Subject head |
|---|---|---|---|
| OI image with person-family masks | 0 inside any masked object (objects aren't sky); points where available; else ignore | 1 inside person masks; **ignore inside unmasked person-family boxes and "group-of" boxes**; 0 elsewhere **only if** the image has person boxes (boxes are exhaustive for positive labels [read]) or a verified-negative Person label; otherwise ignore | derived [below] |
| OI image with a Sky label | Sky yes points → 1, no points → 0 (point loss); image-level positive → `sky_present` = 1 | as above | — |
| OI image with a verified-negative Sky label | **whole image 0**, `sky_present` = 0 | as above | — |
| COCO-Stuff (licence-filtered) | `sky-other` ∪ `clouds` → 1; other labelled → 0; **downweight a ~5 px band at boundaries** (superpixel edges) | COCO person masks | — |
| Synthetic renders / composites | exact alpha → soft target | if people models present | — |
| Owner's photos | hand labels | hand labels | hand labels |

- **Subject labels from Open Images** [idea, the weakest part]: per image, take the masked instances that are large
  (e.g. ≥ 5 % of the frame), not truncated by more than half, and near the centre of mass of all boxes. Their union is
  "subject". Ignore all other boxed-but-unmasked objects. Skip images where the candidate is ambiguous (two similar
  large objects far apart). That yields "dominant things", not true visual saliency, and it will disagree with
  BiRefNet-style saliency on product shots and abstract scenes.
- **Losses:**
  - per head, BCE + soft Dice (or Lovász) on valid pixels;
  - boundary-weighted BCE (×2–4 within a few pixels of label edges, only for near-perfect sources: OI val-quality
    masks, renders, owner labels);
  - point BCE for sky points;
  - BCE for the presence heads and the auxiliary classification head (§3.2 A).
- **Augmentation:**
  - random resized crops at 2:3, 3:4, 1:1 and their rotations;
  - horizontal flip only (no vertical flip: sky's "up" prior is real), rotation ±10°;
  - exposure ±2 EV, white-balance shifts, contrast/tone-curve changes, saturation, JPEG q 40–95, noise, slight blur,
    and haze synthesis (blend towards a grey-blue airlight) for hazy skies.
- **Balance:** sample so that about 40 % of batches contain sky labels, about 40 % person, and about 20 % neither
  (negatives matter for "no sky indoors").

### 4.4 Cloud fallback

- **When:** if a main run would exceed about 2 days on the laptop, or if thermals or desktop use make long runs
  impractical (IMPROVEMENTS open question 7).
- **What:** one A100 (or L40S/H100) VM, ≥ 16 vCPUs for data loading. Per main run ≈ 2–5 A100-h [estimate].
- **Where:** in the same region as Open Images' bucket. The CVDF S3 bucket is AWS **[unconfirmed region]**, so an
  AWS instance avoids slow downloads.
- **Cost:** A100-hours × the provider's hourly rate. Rates weren't checked **[unconfirmed]**.
- The data pipeline must run unchanged on the laptop and in the cloud (same container or `requirements.txt`, the same
  pre-resized shards).

---

## 5. Evaluation

### 5.1 Data

| Set | What | Why |
|---|---|---|
| **OI validation + test masks** (near-perfect, free-painted) | Person family: 1,688 + 5,102 masks [measured]; also animals and vehicles for "subject" | Gold-standard person IoU and boundary F |
| **OI validation Sky points** | 11,234 yes / 6,988 no on 2,283 images [measured] (+ test split; not counted) | Sky **point accuracy** on a large, diverse, licence-clean set |
| **OI verified-negative images** | Images with verified "no Sky" / "no Person" | **False-positive rate** (fraction of pixels predicted ≥ 0.5 where the class is absent) |
| **COCO-Stuff val** (licence-filtered) | Dense sky | Region IoU for sky (coarse edges, so not for boundary F) |
| **Owner set A: 200–300 photos**, hand-labelled sky / person / subject at full resolution | LightBench renders of the owner's raws | **The deciding set.** Labelled with a brush + guided refine in LightBench or GIMP. Avoid SAM-assisted labelling, so the yardstick isn't biased towards SAM |
| **Owner set B: hard cases** (≈ 20 per category) | hair against sky; tree canopy and bare branches against sky; haze and fog; sunsets with the sun in frame; night sky and stars; water reflecting sky; windows and glass reflecting sky; snowy mountains vs overcast; white walls vs white sky; aerial shots with no sky; indoor; multiple and distant people; pets; products | Lightroom-style "Select Sky/Subject" failure cases (IMPROVEMENTS A3 evaluation plan) |
| **Alpha subset** (≈ 30 images) | Hand-made soft alpha for hair and leaves | SAD and gradient error, as in matting benchmarks |

### 5.2 Metrics

- **IoU** per head at the evaluation resolution (1024 px long side), mean over images, not over pixels, so big
  skies don't dominate.
- **Boundary F-score**: precision/recall of predicted vs true boundary pixels within a tolerance. Use **2 px and 5 px
  at 1024 long side**, and report both. (The DAVIS convention of a fraction of the diagonal is an alternative
  **[unconfirmed]**.)
- **Trimap/band IoU**: IoU restricted to a 5/10/20 px band around the true edge, which isolates edge quality.
- **Hair/tree**: SAD and gradient error on the alpha subset, after the guided-filter refine. Report before and after
  the refine, to show what the refine adds.
- **Sky point accuracy** (OI points) and **false-positive rate** on verified negatives.
- **Speed and memory**: ms per photo in Chrome/Edge with WebGPU (ORT-web pinned version, fp16 and fp32) on the owner's
  GPU and on an integrated GPU, plus the refine time at preview and at 24 MP export.
- **Stability**: IoU between masks of the same scene at ±1 EV and two white balances. The mask must not jump.

### 5.3 Comparison set

| Target | Ours vs |
|---|---|
| Sky | classical rule (top-connected + bright + low texture + colour) ± DA2-Small depth; **DA3 MONO-LARGE sky head** (offline Python reference); SAM 2.1 Tiny with automatic prompts (points sampled from the classical prior) |
| Person | **MediaPipe Selfie Multiclass** (person = 1 − background); MediaPipe Selfie Segmentation; SAM 2.1 Tiny prompted with the box from our person head; (BiRefNet_lite on people) |
| Subject | **BiRefNet_lite**; U²-Netp (size-matched); SAM 2.1 Tiny with a centre click / our subject box |

**Acceptance gates** [idea; to be set after the baselines are measured]:
- Ship our sky if it beats the classical rule clearly and is within a few points of DA3's sky IoU on owner set A, with
  a lower false-positive rate indoors.
- Ship our person head as the default if it is ≥ MediaPipe on owner set A and clearly better on distant/group shots.
- For subject, show the gap to BiRefNet_lite honestly and let the owner choose (§7).

---

## 6. Licence of the resulting weights and attribution

**What the owner can choose.** Weights trained by the owner on the data above are the owner's work to license
(GPL-3.0-or-later like LightBench, or permissive: Apache-2.0, MIT, CC BY 4.0). Two facts constrain the choice:
- **CC BY 4.0 / CC BY 2.0 inputs** (Open Images annotations and images, COCO(-Stuff) annotations, BY-licensed COCO
  images). Whether trained weights are "Adapted Material" is legally unsettled [doc, IMPROVEMENTS §4]. **Attribute
  anyway**; it is cheap and removes the question.
- **ShareAlike inputs** (COCO licence id 5, BY-SA 2.0). If the weights were an adaptation, SA would bind their licence.
  **Leaving id 5 out** keeps every licensing option open [idea]. NoDerivs (id 6): leave out for the same reason.

**What to ship with the weights** (extends IMPROVEMENTS §4's model card):
- Model card: name, version, SHA-256, weights licence, training-code commit, architecture, **every dataset with its
  licence**, "no teacher model" (or the teacher, if the owner picks §3.2 C), known limits, and evaluation results (§5).
- **Open Images attribution:**
  - "Annotations © Google LLC, CC BY 4.0, https://creativecommons.org/licenses/by/4.0/; Open Images V7 (Kuznetsova et
    al., IJCV 2020; Benenson et al., CVPR 2019 for masks; Benenson & Ferrari 2022 for point labels)". These citations
    are requested on the facts page [read].
  - Plus **a per-image credit file** for the images actually used: `ImageID, Author, AuthorProfileURL,
    OriginalLandingURL, License` from `image_ids_and_rotation.csv` [read columns], compressed CSV, shipped next to the
    weights and linked from Settings → About.
  - State the modifications: "images resized and cropped; masks converted to training targets".
- **COCO / COCO-Stuff** (if used): "COCO annotations © COCO Consortium, CC BY 4.0; COCO-Stuff annotations (Caesar,
  Uijlings, Ferrari, CVPR 2018), CC BY 4.0", plus per-image Flickr URL and licence. Author names need a Flickr lookup
  **[unconfirmed]**.
- **CC0 assets** (Poly Haven): no credit required [read], but list them for provenance.
- **Owner photos:** the owner's own. Note "includes photographs by the LightBench author" for transparency.
- **No NOTICE obligations** from upstream code, as long as the training code is written fresh or taken from MIT/Apache
  sources. Keep their notices if any code is reused.

**Recommendation** [idea]:
- License the weights **Apache-2.0** (permissive, explicit patent grant, GPL-3.0-compatible per the FSF list [doc,
  unverified there]). darktable-ai and others can then reuse them.
- Or license them **GPL-3.0-or-later** if the owner wants copyleft on derived models.
- Either way, publish the training code under GPL-3.0 with the dataset manifests. Anyone can then audit the provenance,
  which is the point of training our own.

---

## 7. Recommendation per target

| Target | Recommendation | Reason |
|---|---|---|
| **Sky** | **Train our own** (M variant, sky head) | No permissive, documented, browser-sized sky model exists. Clean data exists: OI points and negatives, COCO-Stuff filtered, synthetic, owner photos. Highest value per effort of the three heads. Until it ships: ProRAW mattes when present, else the classical rule (PHASE4_MODELS §3) |
| **Person** | **Train our person head alongside sky** (nearly free: same network and pipeline, 769k clean masks). **Ship MediaPipe Selfie Multiclass now** as the people-parts tool if the owner wants hair/skin/clothes parts sooner | Ours should handle distant and group people, which MediaPipe's card excludes [read]. MediaPipe keeps the *parts* (hair, skin, clothes) that our head won't have. Final choice after §5 measurements |
| **Subject** | **Policy-dependent.** Strict data rule: our subject head (expect clearly worse than BiRefNet_lite on hair, thin structures and product shots [estimate]). Weights-licence-only rule: BiRefNet_lite as an optional HQ download (115 MB fp16, WebGPU graph surgery needed [doc]), with ours as the small default | DIS5K's NC terms are now confirmed [read]. Honest quality gap |
| **Background** | **1 − subject** (Lightroom's "Select Background" is the inverse of "Select Subject" in practice **[unconfirmed]**), refined with the same guided filter | No model needed |

**Order of work** [idea]:
1. Measure the existing baselines in the browser on owner sets A and B (MediaPipe, BiRefNet_lite, SAM 2.1 Tiny,
   classical sky). This sizes the gap.
2. Label owner set A (≈ 2–4 evenings for 200–300 images [estimate]).
3. Build the data pipeline: OI subset download by ID, mask/point/box → target + validity, COCO-Stuff filter.
4. Pilot (S, 384², ≈ 3–6 h). Check the loss plumbing and that sky points help.
5. Main run (M), ≈ 0.7–1.8 days or ≈ 2–5 A100-h.
6. Write the guided-filter refine in WGSL. Run the evaluation (§5), then self-training and the owner fine-tune.
7. ONNX export (fp32 + fp16), ORT-web test, model card, and per-image credits.
8. Integrate as MASKING.md's `ai` component.

### Open questions for the owner

1. **Training-data rule, precisely.** Is "no SA-1B / NC data **in our own weights**" the rule (this plan), while
   *other* models with permissive weights and mixed data (BiRefNet_lite, SAM 2.1 Tiny) stay allowed as optional
   downloads? Or should those be avoided too?
2. **Undisclosed-but-not-NC data** (MediaPipe's Google-internal "thousands of samples"; DINOv2's LVD-142M): acceptable
   as a shipped model (MediaPipe) or as a distillation teacher (DINOv2, §3.2 C)?
3. **COCO licence ids:** use BY (4), "no known restrictions" (7) and US Government (8) only, or also BY-SA (5) /
   BY-ND (6)?
4. **P3M-10k / AM-2k / BG-20k:** read their "Agreement (MIT License)" PDFs (blocked here) and decide whether to use them
   for hair edges and composite backgrounds.
5. **Label effort:** willing to hand-label 200–300 of your photos for evaluation (and optionally 300–1,000 for
   fine-tuning)? Which bodies and subjects matter most (landscape, street, portrait, wildlife)?
6. **Raster storage:** store the refined 8-bit mask (≤ 1024/2048 px), or the model's ¼-resolution logits and re-run
   LightBench's refine per render (§3.5, option 2; makes the refine part of the process version)?
7. **Definition of sky:** clouds and sun included (Lightroom-like); water reflections and windows excluded; fog?
8. **Compute:** laptop runs of ≈ 1–2 days acceptable, or cloud for main runs (≈ 2–5 A100-h each)?
9. **Weights licence:** Apache-2.0 (reusable by darktable-ai and others) or GPL-3.0-or-later?
10. **Subject quality bar:** if our subject head lands clearly below BiRefNet_lite, ship it anyway as the clean default,
    or keep "Select Subject" behind the optional BiRefNet download?

---

## 8. Verification log and sources

**Read today (2026-10-13):**
- Open Images: `storage.googleapis.com/openimages/web/factsfigures_v7.html` (licences, mask process, point labels,
  caps); `web/download_v7.html` (file list); `v5/classes-segmentation.txt`; `v7/oidv7-classes-segmentation.txt`;
  `v7/oidv7-class-descriptions-boxable.csv`; `v7/oidv7-class-descriptions.csv`;
  `v7/oidv7-class-descriptions-points.csv`; `2018_04/bbox_labels_600_hierarchy.json`; the header and first rows of
  `2018_04/image_ids_and_rotation.csv`.
- MediaPipe model cards (PDFs in `storage.googleapis.com/mediapipe-assets/`): "Model Card Multiclass Segmentation",
  "Model Card MediaPipe Selfie Segmentation", "Model Card - Hair Segmentation"; the bucket listings of
  `mediapipe-assets` and `mediapipe-models/image_segmenter/`.
- GitHub (raw, `main`/`master` on 2026-10-13):
  - `facebookresearch/sam2` `sav_dataset/README.md`;
  - `ZhengPeng7/BiRefNet` README;
  - `xuebinqin/DIS` README and `DIS5K-Dataset-Terms-of-Use.pdf`;
  - `xuebinqin/U-2-Net` README;
  - `ZHKKKe/MODNet` README;
  - `nightrome/cocostuff` README and `labels.md`; `nightrome/cocostuff10k` README;
  - `cocodataset/cocoapi` README; `cocodataset/panopticapi` `sample_data/panoptic_examples.json` (licence table);
  - `mcordts/cityscapesScripts` README; `mapillary/mapillary_vistas` README; `CSAILVision/ADE20K` README;
  - `facebookresearch/dinov2` README; `ByteDance-Seed/Depth-Anything-3` README; `pytorch/vision` README;
  - `JizhiziLi/P3M` and `JizhiziLi/GFM` READMEs;
  - `opencv/opencv_zoo` `models/human_segmentation_pphumanseg` README and LICENSE;
  - `Poly-Haven/polyhaven.com` `pages/license.tsx` and `public/locales/en/license.json`.
- LightBench `a0f8353`: `docs/research/{IMPROVEMENTS, AI_MODELS, PHASE4_MODELS, PHASE4_GROUNDWORK, MASKING}.md`,
  `docs/research/cowork-2026-10-13/PHASE4_MODELS.md`, `web/src/engine/gpu/tone-mask.wgsl` (header and `moments`),
  `web/src/engine/color/tone-mask.ts` (grep).

**Measured today:**
- Open Images per-class mask counts, by streaming the 807 MB training CSV through `cut | awk` (not stored), and from
  the validation and test CSVs.
- Sky point and image-label counts in the validation split.
- Sizes of the mask zips, the image tars and 20 validation images (HEAD requests). Resolutions of 8 validation images
  (downloaded, then deleted).
- MediaPipe model file sizes.
- Parameter, MAC and activation counts of the proposed S/M networks with
  a small analytic counter script (convs only; not committed).

**Blocked / not read** (claims resting on them are marked [unconfirmed]):
- huggingface.co, arxiv.org, cocodataset.org and images.cocodataset.org;
- cityscapes-dataset.com, ade20k.csail.mit.edu, mapillary.com, image-net.org;
- polyhaven.com (read via its GitHub source instead);
- the SkyFinder hosts, saliencydetection.net (DUTS), jizhizili.github.io (the P3M/AM-2k/BG-20k agreements), kaggle.com,
  zenodo.org.
- GitHub code search is not available from this session.

**For Cowork verification:**
1. COCO 2017: the count of train/val images per licence id (needs `annotations_trainval2017.zip`).
2. The Mapillary Vistas and Cityscapes licence texts.
3. The SkyFinder licence.
4. The DUTS licence.
5. The P3M-10k, AM-2k and BG-20k agreement PDFs.
6. ImageNet terms of access.
7. Which datasets DA3 MONO-LARGE's sky head was trained on, and their terms.
8. Whether SA-V's manual masklets were SAM 2-assisted (SAM 2 paper, §5).
9. The network used for Open Images' interactive mask annotation (Benenson et al. 2019) and what it was trained on.
10. The RTX 4000 Ada Laptop's FP32/tensor throughput, to tighten §4's estimates.
