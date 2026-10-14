> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-14 (batch 3 revised: existing AI models). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# Part A: faces and people (BlazeFace, Face Landmarker, Selfie Segmentation, Selfie Multiclass, MediaPipe Tasks for Web)

All sources were read on **2026-10-14**. Quotes are verbatim and short, and "…" marks a cut. **[Secondary]** marks a source that is not Google/MediaPipe's own. The fetch tool would only return fragments of up to about 125 characters, so long sentences are quoted in parts.

**Blocked sources** (the permission prompt timed out, and the tool said not to retry):
- BlazeFace Short Range model card: `https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf`
- BlazeFace Full Range (dense) model card: `…/MediaPipe%20BlazeFace%20Model%20Card%20(Full%20Range).pdf`
- Face Mesh V2 model card: `…/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf`
- Blendshape V2 model card: `…/Model%20Card%20Blendshape%20V2.pdf`
- Selfie Segmentation model card: `…/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf`, and its ML Kit copy at `https://developers.google.cn/static/ml-kit/images/vision/selfie-segmentation/selfie-model-card.pdf`
- The legacy short link `https://mediapipe.page.link/blazeface-mc`
- The npm page `https://www.npmjs.com/package/@mediapipe/tasks-vision`, the unpkg file browser, and `vision.d.ts` on jsDelivr

**Read successfully:** the BlazeFace **Sparse** Full Range card, the **Multiclass Segmentation** card, the MediaPipe guides, the repo LICENSE, the MediaPipe source code, GitHub issues, release notes, and `package.json` from jsDelivr.

---

## Decisions this changes

| Claim | Verdict | What LightBench should do differently |
|---|---|---|
| MediaPipe Tasks for Web can run on WebGPU | **Contradicted**. The "GPU" delegate uses **WebGL2**, and "CPU" uses WASM. | Plan MediaPipe as WebGL2/WASM only. Budget for a WebGL2 context next to the darktable WebGPU pipeline, and keep a CPU fallback. Don't count on sharing GPU buffers between the WebGPU pipeline and MediaPipe. |
| Face Landmarker is suitable for culling ordinary photos | **Partly**. Its built-in detector is **BlazeFace short-range** (selfie-style images, faces within about 2 m). | For culling, first find faces with the **Face Detector full-range** model (intended range up to 5 m), then crop each face and run Face Landmarker on the crop to get the blink scores. |
| "All photos stay on the device" also covers MediaPipe | **Partly**. Images stay on the device, but Google's privacy notice says Tasks **send usage metrics to Google**. v1.1.0 adds "stats logging to Web Tasks", and there is no opt-out. | Pin the package version. Ship a strict CSP (`connect-src 'self'`) or block the telemetry host. Grep each new version for telemetry endpoints, and mention it in the privacy statement. Google says the SDK still works when requests are blocked. |
| The weights for all chosen models are Apache-2.0 with known provenance | **Partly**. Apache-2.0 is confirmed only for BlazeFace sparse full-range and Selfie Multiclass. The other cards were blocked. Multiclass discloses no data source or consent. | Get the 5 blocked cards before shipping. Selfie Multiclass **fails the "provenance known" rule** as written ("thousands of samples with diverse identities", with no source or consent stated), so keep it as a candidate only, or ask Google. |
| `@mediapipe/tasks-vision` is Apache-2.0 | **Confirmed** (`"license": "Apache-2.0"` in v1.1.0) | The npm package has no NOTICE/LICENSE file, according to the maintainer. LightBench must add the Apache-2.0 text and attribution to its own third-party notices. |
| `.task`/`.tflite` and WASM files can be self-hosted | **Confirmed** (guide, `package.json` exports, the official worker sample) | Copy `node_modules/@mediapipe/tasks-vision/wasm/*` into the PWA build, precache it with the service worker, and load models with `modelAssetBuffer` from the app's own cache. Don't use the `@latest` CDN URLs from the guides. |
| Runs in a Web Worker | **Confirmed**, with caveats | Use a **module** worker with `FilesetResolver.forVisionTasks(path, true)`, as Google's sample does. Pass `ImageBitmap` frames in, and don't post `WebGLTexture`-backed results back to the page. GPU in a worker needs OffscreenCanvas with WebGL2. |
| `eyeBlinkLeft`/`eyeBlinkRight` exist | **Confirmed** (indices 9 and 10 of 52) | Which side "Left" means is undocumented (issue #6368). Test it on known photos before writing the culling UI. |

---

## A1. BlazeFace (short-range, full-range) and Face Landmarker (including blink blendshapes)

### A1.1 Licence of the code: **Confirmed** (Apache-2.0)
- Repo LICENSE: "Apache License" / "Version 2.0, January 2004". https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE. The same file also includes a third-party notice, "Copyright (c) 2002 by Lucent Technologies", which LightBench's notices should carry.
- Blendshape graph source header: "Copyright 2023 The MediaPipe Authors." / "Licensed under the Apache License, Version 2.0 (the "License");". https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/face_landmarker/face_blendshapes_graph.cc

### A1.2 Licence of the weights: **Partly**

| Model | Verdict | Evidence |
|---|---|---|
| BlazeFace **Sparse** full-range | **Confirmed** Apache-2.0 | Card: "Apache License, Version 2.0". https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Sparse%20Model%20Card%20(Full%20Range).pdf |
| BlazeFace short-range | **Not found** (card blocked) | The guide links the card but states no licence. The guide's page footer licence (CC BY 4.0 for content, Apache 2.0 for code samples) covers the page, not the models. |
| BlazeFace full-range (dense) | **Not found** (card blocked) | Same as above. |
| Face Mesh V2 (inside `face_landmarker.task`) | **Not found** (card blocked) | None. |
| Blendshape V2 (inside `face_landmarker.task`) | **Not found** (card blocked) | None. |

Related evidence (Google maintainer, but about a **different** model): in issue #6306, schmidt-sebastian says the Pose Landmarker model file "is released under Apache 2." https://github.com/google-ai-edge/mediapipe/issues/6306 (comment date not shown in the fetched page).

### A1.3 Training-data statements: **Partly** (one of five cards read)

**BlazeFace Sparse full-range card, read:**
- "This model was trained and evaluated on consented images of people using a mobile AR application"
- "All dataset images were captured on a diverse set of front- and back-facing smartphone cameras."
- "The dataset consists of 100+K images."
- Evaluation: "Dataset I. Contains 1060 samples: 1020 images containing one or more faces, evenly distributed" … ; "Dataset III. Contains 500 images with exactly one face each, 100 images per skin tone category"; "All samples are picked from the same source as the training samples"
- Fairness results reported on the card: average recall across perceived genders of 98.7% with precision of 99.6%; recall across skin tones averaging 98.2%; recall across subregions of 95% to 100%, with precision of about 81.7% to 83.3%. These figures are as summarised by the fetch tool; check them against the PDF before citing.
- The card names no dataset. "using a mobile AR application" is the only provenance given.

**BlazeFace short-range, full-range dense, Face Mesh V2, Blendshape V2: Not found** (cards blocked).

**[Secondary, Google authors' paper, not the model card]** *Blendshapes GHUM* (Grishchenko et al., arXiv 2309.05782), https://arxiv.org/pdf/2309.05782:
- "We scanned 6, 000 different people", plus a landmark dataset of "33, 792 images"
- The blendshape model was trained on "2M pairs of facial landmarks and corresponding ground truth blendshape coefficients"
- The paper does not mention consent, and does not say that this model is the one shipped in Face Landmarker: "We will provide details about our open-sourced models upon publication."

**[Legacy MediaPipe docs]** The Face Mesh landmark model "predicts 3D landmark coordinates on synthetic rendered data and 2D semantic contours on annotated real-world data." https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/face_mesh.md. This is the pre-V2 page, marked as superseded.

**Issue #3645 [user report, no team reply]:** a user reports lower recall for darker skin tones with BlazeFace and FaceMesh. https://github.com/google-ai-edge/mediapipe/issues/3645

### A1.4 Intended-use limits: **Partly**

**BlazeFace Sparse full-range card:**
- Intended use: "Detecting prominently displayed faces within images or videos captured by a smartphone camera."
- Out of scope: "Detecting people too far away from the camera (e.g. further than 5 meters)"; "Counting the number of people in a crowd"; "Detecting faces looking away from the camera, significantly inclined from the vertical orientation," … "or individuals' back of the head"; "Any form of surveillance or identity recognition is explicitly out of scope and not enabled by this technology"
- Limitations: "Produces only up to a given limit (e.g. 10) of detections even if more people are present."; "… is sensitive to face position, scale and orientation in the input image."; "In presence of degrading environment light, noise, motion or face overlapping conditions" …
- Face criteria used in the fairness evaluation: "Face bounding box sides should be at least 5% of the corresponding image sides."; "Face roll and pitch (tilt) angles should be not more than 45 degrees away from the straight orientation."
- Card date: "March 31, 2021"

**Face Detector guide**, https://developers.google.com/edge/mediapipe/solutions/vision/face_detector (last updated 2026-10-01):
- Short-range: optimized for front-facing phone camera images "at short range". Full-range: for back-facing camera images. Sparse: "roughly 60% smaller in size". All three models take a 128 x 128 input.

**Legacy docs**, https://github.com/google/mediapipe/blob/master/docs/solutions/face_detection.md:
- "Use 0 to select a short-range model that works best for faces within 2 meters from the camera" … "1 for a full-range model best for faces within 5 meters."

**Face Landmarker guide**, https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker:
- "The face detection model is the BlazeFace short-range model". This is **Confirmed**, and it sets the Landmarker's detection range.
- "The model outputs an estimate of 478 3-dimensional face landmarks."
- The blendshape model "… predicts 52 blendshape scores". The `num_faces` option defaults to 1.

### A1.5 `eyeBlinkLeft` / `eyeBlinkRight`: **Confirmed**
- Source `kBlendshapeNames`: `"eyeBlinkLeft",` at index 9 and `"eyeBlinkRight",` at index 10, in a `std::array<absl::string_view, 52>`. https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/face_landmarker/face_blendshapes_graph.cc
- The Web guide lists only `browDownLeft` … "(52 blendshapes for each face)" and does not name the eye blendshapes. https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js
- **Which side "Left" means is undocumented.** Issue #6368 [user report, no team reply]: the docs "do not say which side of the face `*Left`/`*Right` blendshapes (`eyeBlinkLeft`, `mouthSmileLeft`, …) refer to." https://github.com/google-ai-edge/mediapipe/issues/6368

---

## A2. Selfie Segmentation and Selfie Multiclass

### A2.1 Licence: **Partly**
- **Selfie Multiclass: Confirmed** Apache-2.0. The card says "Apache License, Version 2.0". https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf
- **Selfie Segmentation: Not found** at the primary source (card blocked).
  - [Secondary] Qualcomm AI Hub: "Model:[APACHE-2.0](https://github.com/google/mediapipe/blob/master/LICENSE)". https://aihub.qualcomm.com/compute/models/mediapipe_selfie
  - [Secondary] Hugging Face qualcomm/MediaPipe-Selfie-Segmentation: "License: apache-2.0". https://huggingface.co/qualcomm/MediaPipe-Selfie-Segmentation

### A2.2 Training data: **Partly**
- **Multiclass card:** "Model is trained on thousands of samples with diverse identities." The card gives **no source, no consent statement and no annotation method**; the fetch tool confirmed that consent is "not present".
- Multiclass evaluation set: "Contains 918 images, totalling 1902 instances of human subjects." … "Some images contained groups of people." Subjects were "annotated with perceived gender (male and female) and skin tone (from 1 to 10) based on the monk scale."
- Card date "May 10, 2023". Architecture: "Vision Transformer, with customized bottleneck and decoder architecture for real-time performance."
- **Selfie Segmentation: Not found** (card blocked). The legacy docs and the ML Kit page give no training data. ML Kit only points to the card: "For more information on how the model was trained and our ML fairness practices, check out our Model Card." https://developers.google.cn/ml-kit/vision/selfie-segmentation

### A2.3 Intended use and limits: **Partly**

**Multiclass card:**
- Intended use: "Human segmentation from images/videos in interactive entertainment, and video conferencing applications."
- Group shots: "Supports single or multiple people in the frame, selfies and full body images."
- Edges: "may not provide pixel perfect masks". Out of scope: "This model is not intended for human life-critical decisions and applications that require pixel perfect masks"
- Conditions that degrade results: "backlit subjects, adding noise, or fast motions, or including large occluders"
- Distance: **not stated**. Input: "[256, 256, 3] for smaller model and [512, 512, 3] for larger model."
- Fairness, 512 model: mean IoU "worst case 71.86, difference is 9.24" for the Tone_9 + Tone_10 group (31 items), judged "within the standard deviation of 10.2". The card concludes: "We therefore consider the model performing well across groups."
- Fairness, 256 model (the one the guide ships): overall mean IoU 77.23; Tone_9 + Tone_10 68.25; Tone_8 73.46.
- Classes in the guide: "0 - background, 1 - hair, 2 - body-skin, 3 - face-skin, 4 - clothes, 5 - others (accessories)". https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter

**Selfie Segmentation:**
- Legacy docs: intended for selfie effects and video conferencing, "where the person is close (< 2m) to the camera." https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/selfie_segmentation.md
- ML Kit, which says it runs the same model ("is also powering ML Kit"): "Easily segment multiple people or just a single person without changing any settings."
- The card itself is **Not found** (blocked).

---

## A3. MediaPipe Tasks for Web

### A3.1 WebGPU: **Contradicted**. The GPU delegate is WebGL2, and CPU is WASM.
- Maintainer (schmidt-sebastian), issue #5826: "Our Vision tasks do use WebGL at the moment," … "our WebGPU support is currently focused on our LLM Inference API." https://github.com/google-ai-edge/mediapipe/issues/5826. The comment date was not visible in the fetched page.
- Source code, `graph_runner.ts`: `this.wasmModule.canvas = new OffscreenCanvas(1, 1);` … `const gl = (this.wasmModule.canvas.getContext('webgl2') ||` `this.wasmModule.canvas.getContext('webgl')) as`. The visible part of the file had no `webgpu` string. https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/web/graph_runner/graph_runner.ts
- Official sample worker: "Device supports WebGL 1.0, but MediaPipe GPU requires WebGL 2.0." https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/base-worker.ts
- Release notes for v1.0.0 and v1.1.0 mention WebGPU only for framework/LLM work. There is no WebGPU entry for vision tasks. https://github.com/google-ai-edge/mediapipe/releases/tag/v1.1.0
- The web setup guide lists `Delegate` with values `CPU` or `GPU`: "Enables hardware acceleration through a device delegate to run the MediaPipe pipeline." https://developers.google.com/edge/mediapipe/solutions/setup_web
- **Conflicting [Secondary]** claim: a Forasoft article (2026-05-24) annotates `delegate: "GPU"` as "WebGPU on Chrome/Edge/Firefox/Safari". This is not supported by the primary sources above. https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/mediapipe-selfie-segmentation-webgpu-background-blur
- Caveat for segmentation: issue #6296 (v0.10.35) reports that ImageSegmenter's mask post-processing needs WebGL float render targets ("GPU does not fully support 4-channel float32 or float16 formats"). The reporter adds that even the CPU delegate goes through the GL path. https://github.com/google-ai-edge/mediapipe/issues/6296

### A3.2 Web Worker: **Confirmed** (documented), with caveats
- Face Detector and Face Landmarker web guides: "Calls to the Face Landmarker `detect()` and `detectForVideo()` methods run synchronously and block the user interface thread." … "You can prevent this by implementing web workers to run the `detect()` and `detectForVideo()` methods on another thread." https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js (last updated 2026-10-09)
- Official Google sample of a **module worker** running Face Landmarker: `const fileset = await FilesetResolver.forVisionTasks(wasmPath, true);`, `modelAssetBuffer: new Uint8Array(modelBuffer),`, `delegate: this.currentOptions.delegate === 'GPU' ? 'GPU' : 'CPU',`, and frames passed in as `ImageBitmap`. https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/face-landmarker.worker.ts
- Issue #5527 (module worker, v0.10.14), schmidt-sebastian: "This works now. Please see" [the sample above]. A later user reports that classic workers fail with the `@latest` bundle: "Classic worker cannot load ES module." https://github.com/google-ai-edge/mediapipe/issues/5527
- Issue #5257, schmidt-sebastian: "You should be able to use 0.10.35 without any polyfills or hacks now." https://github.com/google-ai-edge/mediapipe/issues/5257
- Older caveats:
  - #4694: "WebGLTexture object could not be cloned" when posting results back to the page; the user workaround was `self.document = {}`. https://github.com/google-ai-edge/mediapipe/issues/4694
  - #5292 (iOS 17, v0.10.12): the library "tries to create a normal canvas via document.createElement("canvas")" inside workers; no team reply was shown. https://github.com/google/mediapipe/issues/5292
- The meaning of the second argument (`true`) is not named in any page that could be read. The API reference body would not render (see Unresolved).

### A3.3 Self-hosting `.task` models and WASM: **Confirmed**
- Models: the web guide says "Select and download a model, and then store it within your project directory:", with the path `<dev-project-root>/app/shared/models/`. `BaseOptions` accepts `modelAssetPath` or `modelAssetBuffer` (`Uint8Array`). https://developers.google.com/edge/mediapipe/solutions/setup_web
- WASM: the guides pass the WASM root as a parameter, with the comment `// path/to/wasm/root`, followed by `"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"`.
  - The npm package ships these files: `"./vision_wasm_internal.wasm": "./wasm/vision_wasm_internal.wasm"`, the `nosimd` variant and the `module` variant. https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/package.json
  - Google's own sample resolves the WASM from **its own origin**: `new URL(\`${formattedBasePath}wasm\`, self.location.origin)`. https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/base-worker.ts
- Documented model download URLs, for fetching once at build time:
  - `…/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite`
  - `…/blaze_face_full_range/float16/latest/blaze_face_full_range.tflite` and `…_sparse.tflite`
  - `…/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`
  - `…/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`
  - All are under `https://storage.googleapis.com/mediapipe-models/`. Pin the `/1/` version paths, as the README does, rather than `latest`.
- There is no dedicated "self-hosting" page. The method is documented only through the parameters above and the sample.

### A3.4 Licence of `@mediapipe/tasks-vision`: **Confirmed** (Apache-2.0)
- `package.json` v1.1.0 (the `latest` tag according to the unpkg page): `"license": "Apache-2.0"`, `"author": "mediapipe@google.com"`. Version 1.0.1 has the same licence.
- Maintainer, issue #6306: "The current version of the Web SDKs are released under Apache 2 as noted on" [npm]; "We will ensure that future versions of our NPM packages include NOTICE and LICENSE files." In other words, the package currently ships without them.

### A3.5 Additional finding (not asked, but it bears on "photos stay on device"): telemetry
- Privacy notice (last modified June 5, 2026): "When you use MediaPipe Tasks, processing of the input data (e.g. images, video, text) takes place on device," … "MediaPipe Tasks APIs send metrics about the performance and utilization of the APIs in your app to Google." … "You are responsible for obtaining informed consent from your app users about Google's processing" … https://developers.google.com/edge/mediapipe/solutions/tasks
- Maintainer, issue #6306: "The current version of the Web SDK does not include telemetry." … "We currently are not planning to have an opt-out mechanism." … "You can block outgoing requests, or block the destination host once we have telemetry enabled,"
- v1.1.0 release notes: "Add stats logging to Web Tasks." https://github.com/google-ai-edge/mediapipe/releases/tag/v1.1.0
- Issue #6291 (Python packages): "we will be rolling out telemetry for all of our platforms." … "We are not adding an official API to disable this data collection." The host seen was play.googleapis.com, with the log line "Failed to send to clearcut". https://github.com/google-ai-edge/mediapipe/issues/6291
- Whether **v1.1.0 web** actually sends metrics: **Not found** (see test 3 below).

---

## Unresolved items

1. **Five model cards could not be read** (BlazeFace short-range, BlazeFace full-range dense, Face Mesh V2, Blendshape V2, Selfie Segmentation). Their licence, training data ("consented"?) and limits are still open. To close this, open the PDFs in a browser (URLs are at the top of this file) and record the "Licensed under", "Training Dataset", "Out-of-scope" and "Fairness" sections.
2. **Selfie Multiclass provenance:** the card gives no data source or consent. Only Google can resolve this, for example through a GitHub issue asking for the training-data source and consent basis.
3. **API reference for `FilesetResolver.forVisionTasks(basePath, useModule)`:** the page body would not render in the fetch tool (https://developers.google.com/edge/api/mediapipe/js/tasks-vision.filesetresolver). The meaning of the second parameter is inferred from the sample, not from the docs.
4. **Dates of the maintainer comments** in #5826, #6306 and #6291 were not visible.
5. **Telemetry in web v1.1.0**, and the blink side convention.

### Test snippets for the owner

**1. Confirm WebGL2 vs WebGPU** (run in the page or the worker before creating the task):
```js
const seen = [];
for (const C of [globalThis.HTMLCanvasElement, globalThis.OffscreenCanvas].filter(Boolean)) {
  const orig = C.prototype.getContext;
  C.prototype.getContext = function (type, ...a) { seen.push(type); return orig.call(this, type, ...a); };
}
if (navigator.gpu) { const r = navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter = (...a) => { seen.push('webgpu-adapter'); return r(...a); }; }
// ...create FaceLandmarker with baseOptions.delegate = "GPU", run detect() once...
console.log(seen); // expect ["webgl2"], with no "webgpu" entries
```

**2. Self-hosted module worker**, with no third-party requests. First copy `node_modules/@mediapipe/tasks-vision/wasm/*` to `/wasm/` and the model to `/models/`.
```js
// worker.mjs  (new Worker('/worker.mjs', { type: 'module' }))
import { FilesetResolver, FaceLandmarker } from '/vendor/vision_bundle.mjs';
const fileset = await FilesetResolver.forVisionTasks(new URL('/wasm', self.location.origin).href, true);
const buf = new Uint8Array(await (await fetch('/models/face_landmarker.task')).arrayBuffer());
const lm = await FaceLandmarker.createFromOptions(fileset, {
  baseOptions: { modelAssetBuffer: buf, delegate: 'GPU' }, runningMode: 'IMAGE',
  outputFaceBlendshapes: true, numFaces: 10 });
self.onmessage = ({ data: bitmap }) => {
  const r = lm.detect(bitmap); bitmap.close();
  self.postMessage(r.faceBlendshapes.map(f => Object.fromEntries(
    f.categories.filter(c => c.categoryName.startsWith('eyeBlink')).map(c => [c.categoryName, c.score]))));
};
```
Serve the page with `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`. Then check that detection works and that DevTools shows CSP violations, if any, only for Google hosts.

**3. Telemetry check for v1.1.0** (run locally on the package files, offline):
```sh
npm pack @mediapipe/tasks-vision@1.1.0 && mkdir mp && tar -xzf mediapipe-tasks-vision-1.1.0.tgz -C mp
grep -l -E "play\.googleapis|clearcut|firebaselogging|log_event" mp/package/*.mjs mp/package/*.cjs mp/package/wasm/*.js
```

**4. Which side "Left" means:** run test 2 on one photo of a person with **only their own right eye** closed. If `eyeBlinkRight` is high, then "Right" means the subject's side, as issue #6368 suggests. Mirror the image and repeat to confirm that the labels swap.
