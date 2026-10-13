# Culling helpers: focus, blinks, near-duplicates, exposure (research, 2026-10-13)

Research only. Nothing in the repository was changed. The repository was read at `a0f8353` (release 0.5.4).

**Labels used:**
- **[measured]**: downloaded or HEAD-requested here, and the bytes counted.
- **[read]**: read in a source file, licence, README or model card here (the link is given).
- **[repo]**: read in LightBench's own code or docs.
- **[estimate]**: my estimate, not measured.
- **[unconfirmed]**: could not be checked here. Hugging Face, arxiv, Google developer docs, laion.ai,
  dl.fbaipublicfiles.com and the WIDER FACE site were all blocked or returned nothing.
- **[not re-read]**: a paper cited from memory, whose details were not checked here.

---

## 0. Summary

1. **Most of this needs no ML.** Without a model, LightBench can get:
   - focus and motion blur, from tiled Laplacian and gradient measures on the camera preview, ranked within a burst;
   - exposure problems, from a histogram, using code already in `engine/develop/auto.ts`;
   - near-duplicates, from a 64-bit dHash/pHash of the existing 512 px thumbnails;
   - bursts, from capture time plus the camera's own sequence numbers. LibRaw's binding already exposes these, but
     LightBench doesn't read them yet.

   **"Is the subject sharp?"** without ML needs a subject region. Without faces, it comes from the AF point (maker
   notes or EXIF SubjectArea, depending on the camera) or the sharpest tiles.
2. **Blinks need faces, so this is the one place ML is clearly worth it.** MediaPipe Face Landmarker gives
   `eyeBlinkLeft/Right` blendshape scores and the eye landmarks for an eye-aspect-ratio check. No training is needed.
   - Licence: Apache-2.0 on every card read. The cards say the training data is consented images.
   - Size: about 3.8 MB of models [measured], plus the tasks-vision wasm at 3.8 MB gzip [measured].
3. **New provenance flag on YuNet.** `docs/research/AI_MODELS.md` proposed YuNet (MIT) as the default face
   detector. Its training labels were made with InsightFace's RetinaFace, and the current training repo says they
   "come from SCRFD". InsightFace says models trained with its annotations are "non-commercial research purposes only"
   [read]. Under the owner's rule, **BlazeFace is the cleaner choice** (Google, Apache-2.0, consented images).
4. **Aesthetic / "best shot" models: none qualifies cleanly.**
   - Licence: the pyiqa family is PolyForm Noncommercial, and Q-Align, CLIP-IQA and DOVER use the NC S-Lab licence.
   - Data: NIMA and MUSIQ are Apache-2.0 code trained on AVA/KonIQ, whose terms are [unconfirmed].
   - LAION's predictor sits on OpenAI CLIP ViT-L/14. Its model card puts "any deployed use case" out of scope.
   - **"Best of group" should rank by technical measures (sharpness, eyes, exposure).** It could later learn from the
     user's own picks.
5. **Embeddings aren't needed for v1.** Bursts are near-identical frames, which hashes handle.
   - Later, for "same scene, reframed", use OpenCLIP RN101-YFCC15M: MIT, trained on Flickr Creative Commons photos,
     and the model darktable-ai packages. It would be shared with Phase 4 content search.
   - DINOv2 is Apache-2.0, but its training data (LVD-142M) is an undisclosed crawl.
6. **Recommended v1** (no model download):
   - an analysis pass at index time, plus a background backfill, cached in a new `photo_analysis` table (schema 14);
   - "Stack similar shots";
   - best-of-stack suggestions and "Select best of each stack";
   - badges, sort and filter;
   - zoom to the focus point in culling.

   **v1.1** adds faces and eyes through MediaPipe, downloaded on first use with consent. Effort: v1 **M**, v1.1 **M**.

---

## 1. What LightBench already has [repo]

| Piece | Where | Relevance |
|---|---|---|
| Full-screen culling, Compare, Survey; keys act on the shown/active photo | `web/src/library/CullView.tsx`, `compare.ts`, `survey.ts`; docs/PHASE2.md Parts 2, 10 | Where badges, explanations and "next suggested" go |
| 100 % in culling renders the RAW through the Export path ("so focus is judged on real pixels") | `CullView.tsx` header; PHASE2.md Part 2 | A "zoom to the measured focus point" can reuse it |
| Camera previews: thumbnails (512 px JPEG, `THUMB_SIZE = 512`) and full previews come from the embedded JPEG | `import/probe.worker.ts:33`, `library/preview.ts` | The probe worker **already decodes the full embedded preview to an `ImageBitmap`** before shrinking it. That is the cheapest place to measure (no second file read) |
| Background indexing: probe workers, batched writes (48 photos / 0.4 s) | `library/indexer.ts` | Analysis can ride along |
| One-time background refresh pattern: a flag column (`extras_read`), 2 workers, resumable, skips folders without permission, pause | `library/refresh.ts`, catalog schema 13 | Template for the analysis backfill of existing libraries |
| Background developer (Paste/Sync), its own GPU engine, one photo at a time | `develop/batch.ts` | Not needed for v1 analysis (the preview is enough). Useful later for RAW-based checks |
| Stacks; "Auto-stack by capture time" (gap in seconds) | `catalog/stacks.ts` `burstGroups`, `library/AutoStackDialog.tsx` | Burst grouping exists; it needs visual similarity and sub-second order |
| Capture time is **whole seconds** (`capturedAt`): JPEG DateTimeOriginal 0x9003; RAW LibRaw `timestamp` | `engine/meta/exif.ts:137`, `probe.worker.ts` | Frames of a 10–30 fps burst share one second. Order needs SubSec / sequence numbers |
| Histogram metrics on the CPU: `statsFromPixels()` → `metricsFromStats()` (p0.5, p10, median, p99.5, highlight/shadow clip, chroma) | `engine/develop/auto.ts:50-83` | Exposure flags reuse this as is |
| GPU histogram/clipping for developed renders | `engine/gpu/stats.wgsl` | For edited renders. Culling judges the capture, so the CPU path on the preview fits better |
| Capture sharpening's automatic radius from raw data (largest neighbouring-green ratio in the centre 60 % → sigma) | `engine/detail/capture.ts` | A raw-domain blur estimate. It needs a full raw unpack, so it is too slow for batch; possible for "verify at 100 %" |
| TIFF/EXIF reader that also works on RAW files | `engine/meta/exif.ts` `TiffReader`, used by `engine/lens/meta.ts` | Can add SubjectArea 0x9214, SubSecTimeOriginal 0x9291, ImageUniqueID 0xA420. The header notes LibRaw's Nikon lens fields "read as garbage in this build", so test LibRaw maker-note fields per camera |
| No file deletion anywhere: `removePhotos` "Removes photos from the catalog only; files on disk are untouched" | `catalog/catalog.worker.ts:1238-1243` | "Never automatic deletion" already holds. Keep it |
| No ML runtime in `web/package.json` yet | `web/package.json` | Phase 4 research proposes onnxruntime-web 1.30.0 (docs/research/PHASE4_GROUNDWORK.md §4) |

**LibRaw fields available but unused** [read, `node_modules/@colorhythm/libraw-wasm/dist/index.d.ts`, v1.1.1]:
- `getImgOther().shot_order`;
- `getShootingInfo()`: `DriveMode`, `FocusMode`, `AFPoint`;
- `getMakernotes()`:
  - Canon: `ContinuousDrive`, plus an `afdata` block (`AFInfoData`);
  - Nikon: `BurstTable_0x0056_*`;
  - Fuji: `SequenceNumber`, `SeriesLength`, `DriveMode`, `FocusPixel`;
  - Sony: `Sony0x9400_SequenceImageNumber`, `SequenceLength1/2`, `FocusLocation`, `AFPointsUsed`, `ShotNumberSincePowerUp`;
  - Olympus: `AFPointSelected`, `AFAreas`, `DriveMode`;
  - Pentax: `AFPointsInFocus`, `DriveMode`.

Whether each field is populated correctly for each camera is **[unconfirmed]**. Test it on the sample files.

---

## 2. Non-ML methods first

### 2.1 Sharpness / focus

**Measures** (all cheap and well known):
- **Variance of the Laplacian** (3×3 Laplacian, variance over a region). Pech-Pacheco et al. 2000 [not re-read].
- **Tenengrad**: Sobel gradient energy.
- **Re-blur ratio**: blur the image again and see how much detail is lost. A sharp image loses a lot; a blurred one
  loses little. This partly cancels out how much texture the scene has. Crete et al. 2007 [not re-read].
- **Edge-width metrics**: Marziliano 2002; CPBD [not re-read].

**Survey of focus measures:** Pertuz et al. 2013, *Pattern Recognition* [not re-read].

**MTF:** a true MTF (slanted-edge, ISO 12233) needs a test-chart edge, so it doesn't apply to arbitrary photos.
Edge-width or re-blur measures are the practical no-reference proxies.

**Prior art in a GPL app**: digiKam's Image Quality Sorter (`core/libs/imgqsort`, **GPL-2.0-or-later**, so it can be
ported into GPL-3.0) [read, mirror `AOSC-Tracking/digikam` `master`]:
- `blur_detector.cpp`: Laplacian → log|L| → box + median smoothing → threshold → a *defocus map*.
- Motion blur: a *motion map* per 40 px block, from probabilistic Hough lines (≥ 3 lines with a small spread of angles
  means "motion").
- Flat ("mono colour", std-dev < 10) blocks are excluded, since they can't be judged.
- The judged region is **the camera's selected AF points** (`FocusPointsExtractor`), expanded 2×. Without AF data it
  falls back to non-background blocks.
- The score is the percentage of blurred pixels in the weighted region.
- The AF extractors read Canon, Nikon, Sony and Panasonic maker notes, XMP, and EXIF `SubjectArea`. Their README
  credits the Lightroom plugin "Focus-Points" (Apache-2.0 [read]), which supports Canon, Nikon, Sony, Fuji, Olympus,
  Panasonic, Pentax, Ricoh and Apple.

**Proposed LightBench measure (v1)** [design; the parameters are starting points to tune]:
1. **Input.** Take the decoded camera preview in the probe worker, downscale it to a fixed long edge (e.g. 1536 px
   [estimate]), and use luma as is (gamma-encoded is fine for ranking).
2. **Tiles.** Split it into tiles (e.g. 64 px). Per tile, compute:
   - Laplacian energy at two scales (full and ½), which gives the re-blur ratio;
   - the gradient structure-tensor *coherence* and dominant angle (motion direction);
   - the standard deviation (flat-tile test).
3. **Noise floor.** Take the median Laplacian energy of the flattest tiles. High-ISO noise and in-camera JPEG
   sharpening otherwise inflate Laplacian scores.
4. **Subject region,** by priority:
   1. faces (v1.1): the eye region of the largest or most central faces;
   2. **AF point** from maker notes (via LibRaw fields, or LightBench's own TIFF reader) or EXIF `SubjectArea` (0x9214,
      written by many phones [unconfirmed which]);
   3. otherwise the **top-k sharpest tiles** ("is anything sharp?").
5. **Outputs:**
   - `sharpPeak`: high-percentile tile energy above the noise floor;
   - `sharpSubject`;
   - `motion`: coherence on the sharpest or subject tiles;
   - `shake`: the whole frame is soft and coherent in one direction;
   - `focusMiss`: the subject is soft while other tiles are sharp. This gives an explanation like "focus landed
     behind the subject".

**What is good enough without ML:**
- **Ranking within a burst or stack: good.** Same camera, settings, sharpening and scene, so relative Laplacian energy
  is reliable.
- **"Camera shake / whole frame soft": good.** The whole frame is low and anisotropic.
- **Absolute "this photo is blurry" across a whole library: only fair.** It depends on content, ISO, preview size and
  in-camera sharpening. Make it **library-relative**: a percentile within the same camera and ISO band, plus the noise
  floor. Show it as "possibly soft" and never as a verdict.
- **Intentional shallow depth of field or motion pans: hard without a subject region.** The AF point (where present)
  and faces resolve most cases.

**Caveats:**
- Embedded preview size varies by camera, and some embed small previews. Record the measured preview size with the
  result.
- Analysis on edited renders isn't wanted: culling judges the capture.

### 2.2 Exposure problems

Reuse `statsFromPixels` / `metricsFromStats` (`auto.ts`) on the preview:
- highlight clip fraction (any channel at 255);
- shadow clip fraction;
- median and p99.5.

Add the EXIF exposure bias 0x9204 and flash 0x9209 for explanations.

digiKam's `exposure_detector.cpp` [read] uses weighted fractions:
- over: ≥ 245 with weight 15, 235–245 with weight 1;
- under: < 15 with weight 15, 15–30 with weight 6.

That is a reasonable starting point.

**Caveat for RAW:** the camera JPEG clips before the raw data does. Word it as "highlights clipped in the camera
preview; the RAW may hold more". A raw-based check (white level per channel) is possible later via the decoder, at the
cost of a raw unpack.

This needs no ML, and it is good enough.

### 2.3 Near-duplicates and bursts

**Hashes.** dHash (9×8 grey, adjacent-pixel comparisons) and pHash (32×32 DCT, 8×8 low-frequency block vs median),
64 bits each. They are trivial to write, so no dependency is needed. References: `imagehash` (BSD-2-Clause [read, PyPI
4.3.2]) and `blockhash-js` (MIT [read]).
- Compute them from the **512 px thumbnail**. They then work for every photo, even in folders whose permission isn't
  granted (thumbnails live in OPFS).
- Compute them from the *unedited* preview in the probe worker. `refresh.ts` notes that an edited photo's thumbnail is
  a render of the edit, which would change its hash.

**Order within a second.** `capturedAt` is in seconds. Add:
- SubSecTimeOriginal (0x9291) for JPEG and RAW, via the TIFF reader;
- LibRaw `shot_order`;
- the maker sequence numbers listed in §1;
- the file-name counter as the last fallback.

**Grouping** (O(n log n), trivial for 1,000+ photos):
1. Sort by time, then order.
2. Compare each photo only with its neighbours inside a window (gap ≤ N s, or the same maker burst ID).
3. Link pairs whose Hamming distance is ≤ T.
4. Union-find the links into groups.

A **strictness** slider sets T and N. Users asked Lightroom for exactly this (docs/research/REVIEWS_ROUND2.md §Copy,
"adjustable strictness sliders"). Thresholds must be tuned on real bursts [estimate; no numbers offered here].

**Limits:** hashes miss "same scene, reframed or zoomed" and rotated shots. Embeddings (§3.3) cover those later.

**Prior art:** Immich (AGPL) finds duplicates with CLIP embeddings. Its auto-preselect keeps the largest file and the
one with the most EXIF [read, `docs/docs/features/duplicates-utility.md`]. That is a weak rule for culling: photographers
want the sharpest.

This needs no ML, and it is good enough for bursts and brackets.

### 2.4 What GPU stats add

`stats.wgsl` measures developed renders. For culling, a CPU pass in a worker at about 1.5 MP is enough and doesn't
compete with Develop for the GPU.

A WGSL tile-Laplacian kernel is easy later if profiling shows the CPU pass is the bottleneck. It probably won't be:
file reading and JPEG decoding dominate [estimate].

---

## 3. Permissive models

### 3.1 Faces

| Model | Code licence | Weights licence | Training data / provenance | Size | Notes |
|---|---|---|---|---|---|
| **BlazeFace short-range** (MediaPipe Face Detector) | Apache-2.0 (tasks-vision npm 1.1.0 [read]) | **Apache-2.0** (model card [read]) | "consented images of people using a mobile AR application captured with smartphone cameras" (card [read]) | **229,746 B** float16 [measured] | 128×128 input. Card out-of-scope: faces "further than 2 meters", crowd counting, "any form of surveillance or identity recognition". Too short-range for group shots |
| **BlazeFace full-range** | Apache-2.0 | **Apache-2.0** (card [read]) | Same wording; "The dataset consists of 100+K images" (card [read]) | **1,083,786 B** float16, modified 2026-03-11 [measured] | Card: out of scope beyond 5 m; ~90 FPS Pixel 3 GPU (card). The MediaPipe face-detector graph configures anchors for both 128 and 192 inputs (`face_detector_graph.cc` [read]), so it should load in the Face Detector task. **Not tested in a browser [unconfirmed]** |
| BlazeFace sparse full-range | Apache-2.0 | Apache-2.0 (card [read]) | as above | `float16/1` URL returned a 267-byte error [measured]. A `_with_metadata` file of 677,138 B exists in `mediapipe-assets` [measured] | Optional |
| **YuNet** (OpenCV Zoo) | MIT [read] | MIT ("All files in this directory…", per AI_MODELS.md) | WIDER Face (terms **[unconfirmed]**; site blocked). **Labels:** at the model's source commit `a61a428`, "We relabled the WIDER Face train set using RetinaFace [insightface]" [read]. The current training repo says "The `labelv2` annotations come from SCRFD" [read]. InsightFace: "The training data containing the annotation (and the models trained with these data) are available for non-commercial research purposes only" [read, insightface README] | 232,589 B ONNX (AI_MODELS.md) | Works for faces of "around 10x10 to 300x300" pixels (README [read]). digiKam also downloads it (FreeBSD port lists `yunet` data). **Provenance conflict: owner decision** |
| RetinaFace, serengil/retinaface | MIT [read] | "pre-trained weights are same" as insightface/RetinaFace-tf2 (README [read]) | InsightFace | — | **Excluded** (inherits InsightFace NC) |
| RetinaFace, yakhyo/retinaface-pytorch | MIT [read] | MIT by repo | WIDER Face + `retinaface_gt_v1.1` annotations, i.e. InsightFace's (README [read]) | — | Same provenance issue as YuNet |
| RetinaFace, biubug6/Pytorch_Retinaface | no LICENSE (AI_MODELS.md) | — | — | — | **Excluded** |
| SCRFD, InsightFace models | MIT code | NC research only [read] | — | — | **Excluded** |
| UltraFace (Linzaer) / CenterFace | MIT [read] | by repo | WIDER Face (labels not checked) | — | Not needed |

**Recommendation:** BlazeFace (full-range for detection) for the cleanest provenance. Keep YuNet as an owner-approved
alternative if small faces matter more.

### 3.2 Eyes closed

**Option A: MediaPipe Face Landmarker** (`face_landmarker.task`, **3,758,596 B**, float16/1, dated 2023-05-03
[measured]). It is a zip of [measured]:
- `face_detector.tflite` (229,746 B, **byte-identical to BlazeFace short-range**);
- `face_landmarks_detector.tflite` (2,553,590 B);
- `face_blendshapes.tflite` (955,312 B);
- geometry metadata.

What the cards say:
- **Face Mesh V2** card [read]: **Apache-2.0**. It outputs 478 3D landmarks from a face crop "with 25% margin on each
  side, and resized to 256x256". Its data was "captured on a diverse set of smartphone cameras… real-world environment".
  It is not suitable for faces turned more than 80°, less than 50 % visible, or "too far away".
- **Blendshape V2** card [read]: **Apache-2.0**. It outputs 52 blendshapes in [0, 1], including **`eyeBlinkLeft`,
  `eyeBlinkRight`, `eyeSquintLeft/Right`** and `eyeWideLeft/Right`. It was trained on lab-captured multi-view subjects
  plus "millions of samples generated" from GHUM meshes. Intended use: AR entertainment. Out of scope: "human
  life-critical decisions". Neither is a licence restriction.

**Option B: eye aspect ratio (EAR)**, from six landmarks per eye: EAR = (|p2−p6| + |p3−p5|) / (2·|p1−p4|)
(Soukupová & Čech 2016 [not re-read]). It needs no extra model beyond the landmarks. Use it as a cross-check, and when
squinting confuses `eyeBlink`.

**Option C: a trained open/closed eye-crop classifier.** Not needed for v1. Public eye-state sets (CEW, MRL Eye) have
**[unconfirmed]** terms.

**The bundled detector is short-range (2 m)** [measured + card]. For real photographs, use this pipeline:
1. Run full-range BlazeFace (or YuNet) on a downscaled preview.
2. Crop each face with a margin from the full-resolution preview.
3. Run the Face Landmarker on each crop, where the face is now large.

Below a minimum face size, eye state is unreliable. Show "eyes: unknown" rather than guessing. As a starting point,
treat inter-ocular distance under about 20–30 px in the preview as unknown [estimate, to test].

**Combine signals:**
- Closed = high `eyeBlink` **and** low EAR.
- Squint = high `eyeSquint` with moderate EAR, which is not "closed".
- Per photo: "n of m faces have eyes closed".

### 3.3 Image embeddings (for duplicates)

| Model | Code | Weights | Training data | Size | Verdict |
|---|---|---|---|---|---|
| **OpenCLIP RN101 / `yfcc15m`** | MIT [read] | MIT (darktable-ai card [read]) | YFCC15M, Flickr photos under Creative Commons. The card notes the mix is "BY, BY-SA, **BY-NC**, BY-ND, BY-NC-SA, BY-NC-ND, public-domain" [read] | "~60 MB (FP16)" ONNX, image encoder only (darktable-ai card [read]) | **Best fit if embeddings are wanted.** darktable chose it as "the only widely-available CLIP training dataset where every image was opt-in licensed". It can be shared with Phase 4 content search. Note the NC-licensed images in the data mix |
| OpenCLIP on LAION-2B / DataComp | MIT [read] | MIT per HF cards **[unconfirmed]** (HF blocked); the OpenCLIP README states no weights licence [read] | LAION-2B / DataComp: web scrapes. LAION-5B was withdrawn in Dec 2023 after a CSAM report and later re-released as Re-LAION **[unconfirmed here]** | ViT-B/32 ≈ 88 M image-tower params [estimate] | Avoid: data provenance |
| DINOv2 ViT-S/14 | Apache-2.0 [read] | **Apache-2.0** ("code and model weights", README [read]; MODEL_CARD "License: Apache License 2.0" [read]). XRay-DINO and Cell-DINO weights in the same repo are NC [read] | LVD-142M ("see paper", curated web images, not released) [read] | 21 M params [read] → ≈ 42 MB fp16 [estimate] | Permissive, but the data is undisclosed. Strong for near-duplicates |
| MediaPipe Image Embedder MobileNetV3-small / -large | Apache-2.0 | No model card found in `mediapipe-assets` **[unconfirmed]** | ImageNet presumably **[unconfirmed]**; ImageNet's terms are research-oriented | **4,117,670 B** / **10,889,458 B** float32 [measured] | Small, runs in tasks-vision (`ImageEmbedder`, with cosine similarity in the API [read]). Weights licence unverified |
| Apple MobileCLIP | MIT code | "exclusively for Research Purposes" (AI_MODELS.md) | — | — | **Excluded** |
| OpenAI CLIP | MIT | MIT | Undisclosed crawl. The model card says "**Any** deployed use case of the model — whether commercial or not — is currently out of scope" [read, `openai/CLIP/model-card.md`] | — | Avoid |

**Verdict: no embeddings in v1.** Add OpenCLIP RN101-YFCC15M when content search (Phase 4) lands, and reuse its
vectors for "similar shots" across reframing.

### 3.4 Aesthetic / "best shot" models

| Model | Licence | Data | Verdict |
|---|---|---|---|
| LAION-Aesthetics Predictor V1 (`LAION-AI/aesthetic-predictor`) | MIT [read] | A linear head on **OpenAI CLIP ViT-L/14** (see the CLIP model-card note above). Rated data from SAC/LAION [unconfirmed terms] | Avoid: CLIP card scope, a heavy backbone (ViT-L) and unclear data |
| improved-aesthetic-predictor (Schuhmann) | Apache-2.0 [read] | "sac+logos+ava1" on CLIP ViT-L/14. Trained on **AVA** [read] | Avoid: AVA terms [unconfirmed] (DPChallenge photos); CLIP backbone |
| aesthetic-predictor-v2.5 | **AGPL-3.0** [read] | SigLIP-based [unconfirmed] | Copyleft; combining it with GPL-3.0 is allowed by the GPL's §13, but it is heavy. Not recommended |
| NIMA (idealo) | Apache-2.0 [read] | MobileNet, trained on **AVA** (aesthetic) and **TID2013** (technical) [read] | Data terms [unconfirmed]. Flag; not v1 |
| NIMA ports (titu1994, yunxiaoshi) | MIT [read] | AVA | Same |
| MUSIQ (google-research) | Apache-2.0 [read] | Checkpoints for AVA, KonIQ, PaQ-2-PiQ, SPAQ [read] | Data terms [unconfirmed]; a transformer, heavy |
| pyiqa / IQA-PyTorch (TOPIQ, many IQA models) | **PolyForm Noncommercial 1.0.0** [read] | — | **Excluded (NC)** |
| Q-Align (Q-Future), CLIP-IQA, DOVER | **S-Lab License 1.0: "non-commercial purpose"** [read] | — | **Excluded (NC)** |
| digiKam aesthetic detector (`weights_inceptionv3_299.pb`, downloaded from files.kde.org) | GPL code [read] | Weights licence and data **[unconfirmed]** (from GSoC 2021) | Not usable until its provenance is known |

**Verdict:** no aesthetic model. "Best of group" = technical ranking plus, later, a tiny per-user ranker learned
locally from the user's own picks (§4).

### 3.5 Browser runtimes

**MediaPipe Tasks for Web** (`@mediapipe/tasks-vision` 1.1.0, 2026-10-06, Apache-2.0) [measured]:
- `vision_wasm_internal.wasm` is 12,997,248 B (**3,833,241 B gzip -9**), plus a 335 KB JS glue file (81 KB gzip), plus
  `vision_bundle.mjs` (156 KB). A no-SIMD wasm is 12.2 MB.
- The public option is `delegate: "CPU" | "GPU"` [read, `vision.d.ts`]. The bundle creates **WebGL2** contexts
  [read]. The wasm glue contains WebGPU bindings (`webgpu_get_device`), but whether the GPU delegate uses WebGPU is
  **[unconfirmed]**.
- Tasks: `FaceDetector`, `FaceLandmarker` (with `outputFaceBlendshapes`), `ImageEmbedder`.
- **Its README examples load the wasm from cdn.jsdelivr.net and the models from storage.googleapis.com. Self-host
  both** (local only), as Phase 4 plans for ORT.
- Running it in a Web Worker with the GPU delegate (OffscreenCanvas WebGL2) is **[unconfirmed]**. The CPU delegate in a
  worker is the safe default for background batches.

**onnxruntime-web 1.30.0** (MIT): WebGPU wasm 26,781,914 B (6,578,721 B gzip), per PHASE4_GROUNDWORK.md §4
[measured there].
- It runs YuNet (ONNX) directly.
- MediaPipe's models are TFLite; converting them to ONNX is extra work and a correctness risk, especially for the
  MLP-Mixer blendshape model [unconfirmed].

**Choice:**
- **Faces before Phase 4:** MediaPipe tasks-vision is the shortest path. The cost is about 3.8 MB gzip of wasm plus
  about 5 MB of models.
- **If Phase 4's ORT runtime is already there:** weigh a second runtime against converting three TFLite models.
- **Hand-written WGSL** for BlazeFace (small CNN) is realistic, but not worth it for v1.

---

## 4. Where our own training helps

| Task | Existing model / method | Own training? | Notes |
|---|---|---|---|
| Blink | Blendshapes + EAR | **No training needed** | Calibrate thresholds on a labelled set of the owner's photos (a few hundred faces [estimate]) |
| Focus / motion blur | Heuristics (§2.1) | **Later, optional (L)** | A tiny tile CNN predicting defocus sigma and motion length/angle, trained on **synthetic blur** (disc and line PSFs, noise and JPEG matched) over sharp, permissively licensed photos (the owner's own, CC0/CC-BY sources; each source checked). It helps with texture-poor subjects, bokeh vs miss, and noise. Public deblur sets have terms **[unconfirmed]** (not checked) |
| Best of burst | Rank by sharpness, eyes, exposure | **Optional, local (M)** | Logistic regression over stored features, trained in the browser on the user's own Pick/Reject history. "Learns your taste", no data leaves the device, nothing to licence. Needs enough picks per library [estimate] |
| Aesthetics | None clean (§3.4) | Not recommended | No permissive rated dataset found |
| Duplicates | Hashes; later OpenCLIP-YFCC | No | — |

---

## 5. UX

**Grid badges** (small and toggleable in view options, so the grid doesn't get cluttered):
- possibly soft: a soft-focus icon, with a separate motion icon;
- eyes closed: "n/m";
- highlights or shadows clipped;
- **suggested best in stack**: an outline star on the stack badge (`Grid.tsx` already draws `⧉ n`).

Every badge's tooltip carries its reason, e.g. "Subject 38 % less sharp than the sharpest shot in this stack" or
"Focus landed behind the face". Badges appear only once analysis exists; a dot means "analysing".

**Culling view:**
- **I (info)** lists the measurements in words.
- **Z** zooms to the **measured focus region** (face eyes → AF point → sharpest tile) instead of the click or the
  centre. The 100 % render path already exists.
- A toggle draws the AF point / face boxes (as the Focus-Points plugin does).
- In Compare, a "next suggested" key jumps the Candidate to the stack's suggested best.

**Commands:**
- **Stack similar shots**: extends the Auto-stack dialog with "and look alike" plus a strictness slider. It groups by
  time + hash + maker burst ID. Stacks are already non-destructive and undoable (Unstack).
- **Select best of each stack**: selects (doesn't flag) the suggestion in each stack, so P picks them in one keystroke.
- **Suggest rejects**: shows suggested rejects (soft, eyes closed, or not best in a stack by a clear margin) as a
  **separate suggestion state**, never as the reject flag. "Apply suggestions" turns them into ordinary flags in one
  undoable batch. Show a count first ("Reject 37 of 412? Files are never deleted").
- **Sort** by sharpness: within stacks, and "least sharp first" for a reject pass.
- **Filters** "Possibly soft", "Eyes closed", "Clipped", and **smart-collection rules** for them (a new `SmartRule`
  kind in `catalog/smart.ts`).

**Lessons from Lightroom** (docs/research/REVIEWS_ROUND2.md):
- Assisted Culling "needs checking", is people-focused, and is resource-heavy. Re-analysis of about 71,000 photos
  crashed for one user.
- The 15.4 Duplicates view shipped a **delete-everything bug** and was pulled.

So:
- show suggestions, never automatic actions;
- never delete;
- allow pausing;
- keep the analysis versioned and incremental.

---

## 6. Performance on 1,000+ photo folders

**Where the work happens:**
- **New photos:** analyse inside the probe worker (`probe.worker.ts`). The file is already read and the preview
  already decoded there. Add the hash, tile metrics and exposure to `ProbeResult` and write them in the same batch.
  - Extra cost at about 1.5 MP on the CPU: tens of milliseconds per photo [estimate, to measure].
  - Today's indexing cost is dominated by reading the file (RAW: the whole file) and decoding the preview.
- **Existing libraries:** a backfill modelled on `refresh.ts`:
  - photos with no analysis row, or an older `algo` version;
  - 2 workers, resumable, pausable;
  - skips folders without permission;
  - a progress panel like `RefreshProgress`.

  Hashes for photos in unreachable folders can still come from the thumbnail in OPFS (except edited photos).
- **Faces (v1.1):** a second, optional pass after models are downloaded with consent. BlazeFace runs on every photo,
  which is cheap on a downscaled image. The landmarker runs only on detected faces.
  - Per face: tens of milliseconds on the CPU delegate [estimate, unmeasured].
- **Rough total for 1,000 RAWs** (v1 analysis on top of indexing, 2 workers): minutes, not hours [estimate; measure on
  the owner's machine and drive]. The PHASE2.md follow-up "read only the embedded-preview bytes" would speed up both.

**Catalog** (schema 14; one new table, so no rebuild of `photos`):

```sql
CREATE TABLE photo_analysis (
  photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE, -- the original (version 0); copies use it
  algo INTEGER NOT NULL,            -- analysis version; bump to recompute
  analyzed_at INTEGER NOT NULL,
  src_w INTEGER, src_h INTEGER,     -- size of the preview measured
  sharp_peak REAL, sharp_subject REAL, motion REAL, motion_angle REAL, shake REAL, noise_floor REAL,
  subject_src TEXT,                 -- 'face' | 'af' | 'subjectarea' | 'peak'
  subject_box TEXT,                 -- JSON, normalised
  clip_hi REAL, clip_lo REAL, median REAL,
  dhash INTEGER, phash INTEGER,     -- 64-bit
  sub_sec INTEGER, shot_order INTEGER, burst_key TEXT,
  faces INTEGER, eyes_closed INTEGER, faces_json TEXT, faces_algo INTEGER  -- NULL until the face pass runs
);
```

- The data is derived and can be recomputed, so it is not written to sidecars or exports.
- Backups include it automatically.
- A catalog restored from an older backup simply has no rows, so the backfill runs again.
- "Clear analysis data" lives in Settings.

**Grouping and ranking** run in the catalog worker or on the page at query time, over at most a few thousand rows:
negligible.

---

## 7. Privacy

- All computation is local: workers, OPFS and SQLite.
- Models are self-hosted and downloaded once with consent (PHASE4_GROUNDWORK.md's plan). There are no CDN defaults,
  which matters because tasks-vision's README points at jsDelivr and googleapis.
- Faces are stored only as boxes and eye scores. **No face embeddings and no identity.** BlazeFace's card puts
  "identity recognition" out of scope. Phase 4's "face grouping" needs a separate recognition model and its own
  licence research.
- Nothing about analysis goes into sidecars or exports.

---

## 8. Recommended plan and effort

| Step | What | Effort |
|---|---|---|
| **v1a** | Analysis in the probe worker plus backfill: tile sharpness, motion, noise floor, exposure (reusing `auto.ts`), dHash/pHash, SubSec/shot order/maker burst IDs, AF point/SubjectArea. Schema 14. Tests on the sample RAWs | **M** |
| **v1b** | "Stack similar shots" (time + hash + burst ID, strictness slider) in the Auto-stack dialog | **S** |
| **v1c** | Best-of-stack ranking and explanations; badges; sort/filter; smart-collection rules; "Select best of each stack"; suggested rejects with one-step Apply/Undo | **M** |
| **v1d** | Culling: Z zooms to the focus region; AF/face overlay; "next suggested" in Compare | **S** |
| **v1.1** | Faces and eyes: MediaPipe tasks-vision (CPU delegate in a worker), BlazeFace full-range → crop → Face Landmarker with blendshapes + EAR; self-hosted, consent download (~3.8 MB gzip wasm + ~1.1 MB + ~3.8 MB models [measured]). Eyes feed the ranking and badges | **M** |
| Later | OpenCLIP RN101-YFCC15M embeddings shared with content search (**L**, Phase 4); local "learn from my picks" ranker (**M**); synthetic-blur focus CNN (**L**); raw-domain clipping check (**S–M**) | — |

**Before building:** collect a small labelled set from the owner's photos to tune thresholds and to report
precision/recall honestly in PHASE docs:
- sharp vs soft vs motion;
- eyes open/closed;
- bursts with the owner's pick.

---

## 9. Open questions for the owner

1. **YuNet vs BlazeFace.** YuNet is MIT, but it was trained on InsightFace-derived labels, which carry NC terms.
   Accept it, or require BlazeFace (consented data, Apache-2.0)? This also affects AI_MODELS.md's proposed default.
2. **A second runtime?** MediaPipe tasks-vision for faces now (~3.8 MB gzip), or wait for ORT in Phase 4 and convert
   the TFLite models?
3. **Suggested rejects.** Show them as a separate state that needs "Apply", or allow an opt-in "apply automatically
   as reject flags" (still never deleting)?
4. **Analysis at index time.** On by default, or opt-in? It slows indexing slightly [estimate].
5. **Embeddings.** Is OpenCLIP-YFCC15M acceptable, given its data mix includes CC BY-NC images (darktable accepted
   it)? Or no embeddings at all?
6. **Badges.** Which should be on by default in the grid, and should they show in Survey/Compare too?
7. **Calibration set.** Can the owner supply about 200–500 labelled photos (incl. bursts) for tuning [estimate]?
8. **Focus point overlay.** Worth decoding more maker-note AF formats (Canon/Nikon tables) beyond what LibRaw exposes,
   if LibRaw's fields prove unreliable?

---

## 10. Sources read and gaps

**Read here:**
- LightBench `web/src` (files cited above), `docs/PLAN.md`, `docs/PHASE2.md`, `docs/research/AI_MODELS.md`,
  `PHASE4_GROUNDWORK.md`, `REVIEWS_ROUND2.md`, `REVIEWS_LIGHTROOM.md`.
- npm `@mediapipe/tasks-vision` 1.1.0 tarball (sizes, `vision.d.ts`, README) and `onnxruntime-web` dist-tags.
- `storage.googleapis.com/mediapipe-assets` listing and model-card PDFs: BlazeFace Short/Full/Sparse, Face Mesh V2,
  Blendshape V2.
- `storage.googleapis.com/mediapipe-models` HEADs; the `face_landmarker.task` contents.
- MediaPipe `face_detector_graph.cc`.
- OpenCV Zoo YuNet README/LICENSE; `libfacedetection.train` README (current and `a61a428`).
- InsightFace README. Licences of serengil/retinaface, yakhyo/retinaface-pytorch (+ README), UltraFace, CenterFace.
- open_clip README/LICENSE; darktable-ai README and the OpenCLIP-YFCC15M card.
- DINOv2 README and MODEL_CARD; OpenAI CLIP model card.
- LICENSE/README of the LAION aesthetic predictors, NIMA (idealo and ports), MUSIQ, pyiqa, Q-Align, CLIP-IQA, DOVER
  and aesthetic-predictor-v2.5.
- digiKam imgqsort (blur, exposure, aesthetic) and focus-point extractors (`AOSC-Tracking/digikam` mirror); FreeBSD
  digikam port Makefile.
- Focus-Points plugin LICENSE/README; imagehash (PyPI), blockhash-js; Immich duplicates doc.

**Not reachable [unconfirmed]:**
- Hugging Face (all model cards: LAION OpenCLIP weights licence, ONNX sizes);
- arxiv (all papers marked [not re-read]);
- developers.google.com (MediaPipe guides, WebGPU use, worker support);
- laion.ai (Re-LAION status);
- the WIDER FACE site (dataset terms);
- dl.fbaipublicfiles.com (DINOv2 file sizes);
- the AVA, KonIQ, TID2013, CEW and MRL dataset terms.

---

## Owner's decisions (2026-10-13)

- **Face detector:** BlazeFace only (MediaPipe, Apache-2.0). YuNet is not used, because its training labels derive from InsightFace models with non-commercial terms.
- **Timing:** v1 culling helpers are non-AI (sharpness, exposure, near-duplicate and burst grouping, best-of-stack ranking). Face and blink detection waits for the Phase 4 ML runtime (onnxruntime-web), so the app carries one ML runtime.
- **Suggested rejects:** always need the owner's **Apply**. Nothing is flagged automatically. Applying only adds reject flags (catalog plus `lightbench:Flag` in the sidecar) and is reversible in one step. Files are never modified or deleted.
