> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-13/14 (batch 2, prompt `COWORK_VERIFY_2026-10-13b`). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# Part F: AI model delivery (Phase 4 groundwork) — verification

Read date for every source below: **2026-10-13**. Context brief: `docs/research/PHASE4_GROUNDWORK.md` (main). Prior research `/home/claude/research/PHASE4_MODELS.md` was used only to know what to check, never as evidence.

**Method note.** Pages were read with WebFetch, which returns text through an extraction step; quotes below are the verbatim strings it returned. Hugging Face file sizes come from the Git LFS pointer files (`/raw/main/<file>`), which give exact bytes. No live HTTP/CORS test was possible (no curl/wget/Python fetches allowed, and `api.github.com` stopped answering mid-session), so every header question is either sourced to documentation, labelled "reported by users", or marked **Not found (needs local browser test)** with a test in the appendix.

Blocked or unavailable: `github.com/advimman/lama/issues?q=…` (robots), GitHub folder views under `darktable-org/darktable-ai/tree/…` (robots), Google Drive folder listings (robots), `api.github.com` issue endpoints (stopped responding; one search call succeeded first).

---

## Decisions this changes

| # | Claim | Verdict | What LightBench should do differently |
|---|---|---|---|
| F1 | HF `resolve` URLs work from a browser `fetch` with CORS on the 302 and the CDN/Xet hop | **Not found** as documentation; users report simple GETs work | Treat HF as the primary host only after the T1 test passes. Download whole files with a plain GET (no `Range`), and pin `resolve/<commit>/` URLs. |
| F1 | `Content-Length` is readable | **Partly**: it is CORS-safelisted, so it is readable *if sent* | Progress bar: read `content-length`, but fall back to a size table in the model manifest (the exact bytes are listed below). |
| F1 | `Range` requests fail preflight on the Xet bridge | **Partly**: reported Jan 2026, HF/Xet staff said fixed, the reporter later said it still failed without a proxy | Don't build resumable or chunked downloads on `Range` until T1b passes. If used, send a single range (`bytes=N-`), which is CORS-safelisted under the spec. |
| F2 | HF ToS covers hot-linking; anonymous limit is 3,000 resolver requests / 5 min / IP | Hot-linking clause **Not found**; limit **Confirmed** (and "subject to change") | The limit counts per visitor IP, so it isn't a shared app-wide quota. Keep requests to one resolve per file and cache in the Cache API/OPFS. There's no ToS bar, but HF may change or suspend service, so keep a fallback mirror. |
| F3 | SAM 2.1 tiny ONNX is two files (encoder 67 MB, decoder 10.5 MB) | **Confirmed**, but each is a **graph + `.onnx_data` pair**, and the onnx-community repo has **no licence tag** | The downloader must fetch 4 files and pass ORT `externalData`. Credit Apache-2.0 from `facebook/sam2.1-hiera-tiny`, not from the ONNX repo. |
| F3 | Depth Anything V2 Small fp32 = 99,373,606 bytes | **Contradicted**: 99,060,839 bytes (fp16 49,642,442) | Fix the manifest sizes. |
| F3 | BiRefNet_lite fp16 ≈ 115 MB | **Confirmed**: 114,538,221 bytes ≈ 109.2 MiB, above GitHub's 100 MiB git file limit | It can't live in git and would need LFS or an external host. HF stays the natural host. |
| F3 | Moebius is Apache-2.0 | **Partly**: GitHub README says Apache-2.0 for code and weights, but the HF tags for Moebius and PixelHacker say **mit** | Both are GPL-3.0-compatible, but record the conflict. The VAE comes from `hustvl/PixelHacker/vae` and its upstream isn't stated (its config matches the SDXL-VAE family, which is unconfirmed). Ask the authors before shipping. |
| F4 | Pages serves a 115–210 MB file from an Actions artifact | **Not found**: no per-file limit is documented (site ≤ 1 GB, artifact tar < 10 GB) | Run T4 before relying on it. The 1 GB site cap allows only about 4–8 such models. |
| F5 | "Git LFS cannot be used with GitHub Pages sites" also blocks Actions-checked-out LFS files | **Partly**: the doc isn't qualified, and one user reports `lfs: true` works | It probably works, but **every workflow run's checkout spends LFS bandwidth** (Free: 10 GiB/month). With ~350 MB of models, that's roughly 28 deploys a month. Prefer downloading models from HF inside the workflow, or not hosting models on Pages. |
| F6–F7 | Big-LaMa weights licence | **Partly** (informal "quite sure… apache 2.0" from co-author Arsenii Ashukha, 2023); IOPaint page **Not found** | Record LaMa as "Apache-2.0 per informal author statement". The official LaMa README now points to `smartywu/big-lama` on HF (an individual's mirror). Keep it lower priority than MI-GAN, which has an explicit LICENSE-WEIGHTS. |
| F8 | ORT #26732 fp16 overflow fixed at runtime by 1.30 | Status **Confirmed** (closed by stale bot); runtime fix **Not found** (not in 1.30 notes; the related PR is opt-in, unmerged on the page, and its author says it doesn't fix #26732) | For fp16 models, add a NaN/Inf check on outputs and fall back to fp32. Prefer exports with Clip guards. |
| F9 | fp16 graphs upcast on adapters without `shader-f16` | **Contradicted**: they **fail** (source code and user reports) | Feature-detect `adapter.features.has('shader-f16')` and pick fp32 variants when it's missing (MI-GAN is fp32 anyway). If LightBench shares its own GPUDevice with ORT, request `shader-f16` when available. |
| F10 | Safari quotas and 7-day eviction | **Confirmed** (60%/15% origin, 80%/20% overall, Safari 17.0). The 7-day rule comes from WebKit blog 10218, **not** 14403; Home Screen apps have their own counter | Call `navigator.storage.persist()`. Show a "models may need re-download" note in Safari tabs, and recommend Add to Home Screen for heavy AI use. |
| F11 | ORT 1.30 table says WebGPU is unsupported on Safari/Firefox | Table **Confirmed**; actual behaviour **Partly** (users report it running on iOS 26.3 Safari; Mozilla engineers ran ORT's WebGPU path in Firefox) | Treat Safari/Firefox WebGPU as "best effort", gated by the T11 smoke test, with WASM fallback. |
| F12 | raw.githubusercontent works, release assets are blocked, under COEP `require-corp` | **Not found (needs local browser test)**. MDN: COEP doesn't block CORS-mode fetches; users report release assets lack CORS (through Nov 2025) | Don't serve models from release assets. raw.githubusercontent is limited to git-sized files (≤ 100 MiB) and has unauthenticated rate limits (May 2025 changelog). |
| F13 | NIND weights statement; which checkpoints darktable-ai converted | `nind-denoise`: **no weights licence statement**. `rawnind_jddc`: "dual licensed GPL3 + CC-BY-4.0" **Confirmed**. darktable-ai pulls `iter_4350000.pt` and `iter_3900000.pt` from individual Google Drive files (**Partly**: the folder they sit in couldn't be listed) | Use the RawNIND (`rawnind_jddc`) weights or darktable's converted package, not the older `nind-denoise` models. Carry CC-BY-4.0 attribution (Brummer & De Vleeschouwer) in credits. |

**Verdict count (31 sub-verdicts across the 13 items):** Confirmed 11 · Contradicted 2 · Partly 8 · Not found 10.
- Confirmed: F2b, MI-GAN, SAM sizes, BiRefNet, Depth fp16+licence, Carve bytes+licence, smartywu, F8 status, F10 quotas, F10 7-day, F13 rawnind_jddc.
- Contradicted: Depth fp32 bytes, F9.
- Partly: F1b, F1c, Moebius licence, PixelHacker licence, F5, F6, F11, F13 checkpoints.
- Not found: F1a, F2a, F4 per-file, F4 type/compression, Carve DFT, VAE origin, F7, F8 runtime fix, F10 1 GiB, F12. F13 nind-denoise weights statement is also Not found but is counted under F13.

---

## F1. Hugging Face CORS

### F1a. `Access-Control-Allow-Origin` on the 302 and the final CDN/Xet response
**Verdict: Not found (needs local browser test).** No HF documentation page on CORS for `/resolve/` was found. The indirect evidence below is labelled.

- HF documents Transformers.js as browser-only and loading from the Hub by default (documented design intent; it implies working CORS but doesn't state headers):
  - "Transformers.js is a JavaScript library for running 🤗 Transformers directly in your browser, with no need for a server!" — https://huggingface.co/docs/hub/transformers-js (2026-10-13)
  - `remoteHost`: "Host URL to load models from. Defaults to the Hugging Face Hub." — https://huggingface.co/docs/transformers.js/main/en/api/env (2026-10-13)
- Reported by users (forum, 2 Jan 2026, dataset Parquet files): "Simple GET requests work fine through the CDN redirect." — https://discuss.huggingface.co/t/cors-support-for-http-range-requests-on-dataset-files/172172 (2026-10-13)
- Test: appendix T1a.

### F1b. Is `Content-Length` exposed?
**Verdict: Partly.** `Content-Length` is a CORS-safelisted response header, so JS can read it on any successful CORS response without `Access-Control-Expose-Headers` (documented, MDN). Whether HF/Xet actually sends it on the final hop isn't documented.

- "By default, the safelist includes the following response headers: … `Content-Length` …" — https://developer.mozilla.org/en-US/docs/Glossary/CORS-safelisted_response_header (2026-10-13)
- Transformers.js reads it for progress (source, not a statement about HF headers): `const contentLength = response.headers.get('content-length');` and the comment `// This helps with progress tracking when content-length is missing` — https://app.unpkg.com/@huggingface/transformers@4.2.0/files/src/utils/hub.js (2026-10-13)
- Custom headers on the 302 (for example `X-Linked-Size`) would need `Access-Control-Expose-Headers`, and none was found documented. Don't rely on them.

### F1c. Does a `Range` request fail its preflight (Jan 2026 report)?
**Verdict: Partly (reported by users; fix claimed, then disputed).**

- Forum report, cornhundred, 2 Jan 2026: "Range requests fail with CORS preflight errors when redirected to cas-bridge.xethub.hf.co." Error: "Response to preflight request doesn't pass access control check: It does not have HTTP ok status." — https://discuss.huggingface.co/t/cors-support-for-http-range-requests-on-dataset-files/172172 (2026-10-13). No staff reply or fix appears on the forum thread. Only dataset files are mentioned.
- GitHub issue "Enable CORS + HTTP Range support for browser partial reads on cas-bridge.xethub.hf.co (Parquet row-group access)", comments dated around 9–12 Jan 2026 (https://github.com/huggingface/datasets/issues/7931, 2026-10-13):
  - rajatarya: "We deployed fixes on our backend and believe this issue should be fixed." He later reported that the first changes were insufficient because the OPTIONS preflight failed presigned-URL validation (summarised; not quoted).
  - severo: "It looks like the bug has been fixed indeed." / "The HEAD request returns 200 and the response is used by the JS client."
  - cornhundred: "Yes, I can confirm that it is working on my end." Her later Colab comment reports the error still occurring without a proxy (summarised). Open/closed state wasn't visible.
- Spec point (documented, MDN): "[`Range`] needs to have a value of a single byte range in the form of `bytes=[0-9]+-[0-9]*`." So a single-range request is CORS-safelisted and shouldn't trigger a preflight at all. Browser support for this rule wasn't verified. — https://developer.mozilla.org/en-US/docs/Glossary/CORS-safelisted_request_header (2026-10-13)
- Test: appendix T1b.

## F2. HF terms of service and rate limits

### F2a. Anything on hot-linking model files from a public web app
**Verdict: Not found.** The ToS (effective date "Effective Date: September 15, 2022") has no clause on rate limits, bandwidth, hot-linking, embedding or third-party apps. Relevant reserved rights: "we reserve the right to suspend or terminate your access to the Services anytime with or without cause" and "We may at any time modify, suspend, or discontinue, temporarily or permanently, the Services". — https://huggingface.co/terms-of-service (2026-10-13)

Content policy (effective April 10, 2025) lists under platform abuse: "Abuse or interference with Hugging Face services, including:" … "Hosting excessive or irrelevant data in repositories." … "Spam (e.g., advertising products/services, excessive bulk activity, or disrupting user experience)." It says nothing on hot-linking or CDN use. — https://huggingface.co/content-policy (2026-10-13)

### F2b. Anonymous resolver limit: 3,000 per 5 minutes per IP
**Verdict: Confirmed.** Table row: "Anonymous user (per IP address) | 500 \* | 3,000 \* | 100 \*" (API | Resolvers | Pages). "\* Anonymous and Free users are subject to change over time depending on platform health". "All quotas are calculated over 5-minute fixed windows." Resolvers are "all the URLs that contain a `/resolve/` segment in their path". The page also names "AI applications (LM Studio, Jan, ollama, …)" as typical callers. — https://huggingface.co/docs/hub/rate-limits (2026-10-13)

[analysis] Because the limit is per IP and a browser app's requests come from each visitor's own IP, LightBench's traffic isn't pooled into one quota (except behind shared NAT, such as offices or schools).

## F3. HF file sizes and licence tags

Sizes in bytes are from the LFS pointer `size` line; "MB" values are as displayed on the tree page (decimal).

| Repo / file | Claimed | Found | Licence tag | Verdict |
|---|---|---|---|---|
| `andraniksargsyan/migan` / `migan_pipeline_v2.onnx` | 28.1 MB, mit | "size 28079181" (28.1 MB displayed); also `migan.onnx` 29.5 MB | "License: mit" | **Confirmed** |
| `onnx-community/sam2.1-hiera-tiny-ONNX` encoder fp16 | 67 MB | `vision_encoder_fp16.onnx` 315 kB + `vision_encoder_fp16.onnx_data` "size 67005504" | none shown ("No model card") | **Confirmed** (size); licence tag absent |
| same, decoder fp16 | 10.5 MB | `prompt_encoder_mask_decoder_fp16.onnx` 230 kB + `…_fp16.onnx_data` "size 10454016" | — | **Confirmed** |
| base `facebook/sam2.1-hiera-tiny` | — | — | "License: apache-2.0" | (reference for credits) |
| `onnx-community/BiRefNet_lite-ONNX` / `model_fp16.onnx` | 115 MB, mit | "size 114538221" (115 MB); `model.onnx` "size 224005088" | "License: mit"; base model ZhengPeng7/BiRefNet_lite | **Confirmed** |
| `onnx-community/depth-anything-v2-small` | fp32 99,373,606; fp16 ~50 MB | `model.onnx` "size 99060839"; `model_fp16.onnx` "size 49642442" | "License: apache-2.0" | fp32 bytes **Contradicted**; fp16 and licence **Confirmed** |
| `Carve/LaMa-ONNX` / `lama_fp32.onnx` | 208,044,816, apache-2.0, DFT? | "size 208044816" | "License: apache-2.0" | bytes and tag **Confirmed**; DFT **Not found** |
| `smartywu/big-lama` | uploader? licence? | `big-lama.zip` 381 MB; "3 commits", "1 contributor" | "License: apache-2.0" | **Confirmed** (see below) |
| `hustvl/Moebius` | Apache-2.0 (per README) | `pretrained/diffusion_pytorch_model.bin` 905 MB; repo total 3.62 GB; no VAE in repo | "License: mit" | **Partly** (conflict) |
| `hustvl/PixelHacker` | ? | `vae/diffusion_pytorch_model.bin` 167 MB + `config.json`; repo 14 GB | "License: mit" | **Partly** (conflict, VAE origin unknown) |

URLs (all 2026-10-13): https://huggingface.co/andraniksargsyan/migan/tree/main · https://huggingface.co/andraniksargsyan/migan/raw/main/migan_pipeline_v2.onnx · https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/tree/main/onnx · https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/raw/main/onnx/vision_encoder_fp16.onnx_data · https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/raw/main/onnx/prompt_encoder_mask_decoder_fp16.onnx_data · https://huggingface.co/facebook/sam2.1-hiera-tiny · https://huggingface.co/onnx-community/BiRefNet_lite-ONNX · https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/raw/main/onnx/model_fp16.onnx · https://huggingface.co/onnx-community/depth-anything-v2-small/tree/main/onnx · https://huggingface.co/onnx-community/depth-anything-v2-small/raw/main/onnx/model.onnx · https://huggingface.co/Carve/LaMa-ONNX · https://huggingface.co/Carve/LaMa-ONNX/raw/main/lama_fp32.onnx · https://huggingface.co/smartywu/big-lama · https://huggingface.co/hustvl/Moebius/tree/main/pretrained · https://huggingface.co/hustvl/PixelHacker/tree/main/vae

**Carve/LaMa-ONNX ops.** The card doesn't list op types. It says `lama_fp32.onnx` uses a custom FourierUnitJIT because the original "cannot be directly ported to ONNX without overhead", that dynamic shapes would require resolving "dynamic padding in the `irfftn` and `rfftn` functions in `ffc.py`", and that "The input shape is fixed at 512x512 pixels." It also says "**Opset Version 17**: This model uses opset version 17." The older `lama.onnx` uses "a custom irfftn ONNX logic (patched `onnxscript`)". Whether a `DFT` node is present: **Not found**; inspect locally (T3). In HF discussion #1 the Carve maintainer says "it runs on GPU using ONNX Runtime on Linux without crashing using CUDAExecutionProvider, partially, but fast." WebGPU isn't discussed. — https://huggingface.co/Carve/LaMa-ONNX/discussions/1 (2026-10-13)

**smartywu/big-lama uploader.** Profile: display name James Wu, no organisations, "None yet" interests, one GitHub link (jw207427); one model, last updated May 9, 2023 — https://huggingface.co/smartywu (2026-10-13). Card: "We host the pretrained model here for easier download by the community:". **New finding:** the official LaMa README now uses this mirror as its download: "curl -LJO https://huggingface.co/smartywu/big-lama/resolve/main/big-lama.zip" — https://raw.githubusercontent.com/advimman/lama/main/README.md (2026-10-13).

**Moebius / PixelHacker licence and VAE.**
- Moebius README: "Both the code and the pretrained model weights of Moebius are released under the [Apache License 2.0](LICENSE)," and "Commercial use of the weights and the images produced with them is permitted." — https://raw.githubusercontent.com/hustvl/Moebius/main/README.md (2026-10-13). The HF tag says "License: mit" — https://huggingface.co/hustvl/Moebius (2026-10-13).
- PixelHacker: the GitHub sidebar shows "Apache-2.0 license" (https://github.com/hustvl/PixelHacker); the HF tag says "License: mit" (https://huggingface.co/hustvl/PixelHacker) (both 2026-10-13).
- VAE source: Moebius README: "Download the checkpoint of [VAE](https://huggingface.co/hustvl/PixelHacker/tree/main/vae) and put it into ./weight/vae." PixelHacker config: `model_name: 'sdvae_f8d4'` — https://raw.githubusercontent.com/hustvl/PixelHacker/main/config/PixelHacker_sdvae_f8d4.yaml (2026-10-13). Neither repo states where the VAE originally came from. **VAE origin: Not found.**
- [analysis, unconfirmed] `hustvl/PixelHacker/vae/config.json` describes an `AutoencoderKL` with `scaling_factor` 0.13025, `block_out_channels` [128, 256, 512, 512], 4 latent channels and `force_upcast` false, stored as fp16 (`torch.HalfStorage`), 167 MB. Those values match `madebyollin/sdxl-vae-fp16-fix/config.json` (0.13025, false, same channels; card: "Model size 83.7M params", and 83.7M × 2 bytes ≈ 167 MB). Both `madebyollin/sdxl-vae-fp16-fix` and `stabilityai/sdxl-vae` are tagged "License: mit". This suggests, but doesn't prove, an SDXL-VAE lineage. — https://huggingface.co/hustvl/PixelHacker/raw/main/vae/config.json · https://huggingface.co/madebyollin/sdxl-vae-fp16-fix · https://huggingface.co/stabilityai/sdxl-vae/raw/main/config.json (2026-10-13)

## F4. GitHub Pages per-file limit, Content-Type and compression (Actions artifact)

**Per-file limit: Not found.** Documented limits are: "Published GitHub Pages sites may be no larger than 1 GB." · "GitHub Pages deployments will timeout if they take longer than 10 minutes." · "GitHub Pages sites have a soft bandwidth limit of 100 GB per month." · rate-limited requests get "an appropriate response with an HTTP status code of `429`." — https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits (2026-10-13). The artifact action says the tar should "be under 10GB in size (we recommend under 1 GB!)", must "Be a single gzip archive containing a single tar file", and must "not contain any symbolic or hard links". — https://github.com/actions/upload-pages-artifact (2026-10-13). Neither page states a per-file limit.

**Content-Type / compression: Not found (needs local browser test).** An older GitHub doc says "The list of supported MIME types is generated from the mime-db project" — https://docs.github.com/enterprise/2.4/user/articles/mime-types-on-github-pages (2026-10-13; old Enterprise 2.4 page, may be stale). A partial read of mime-db `db.json` found no `onnx` entry (the read was truncated at `application/vnd.etsi…`, so this is inconclusive). Expect `application/octet-stream`, but confirm with T4. Nothing documents whether Pages compresses binary files.

## F5. "Git LFS cannot be used with GitHub Pages sites" with an Actions LFS checkout

**Verdict: Partly.**
- Doc: "Git LFS cannot be used with GitHub Pages sites." The sentence has no qualification about Actions. — https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage (2026-10-13)
- `actions/checkout`: `lfs`: "Whether to download Git-LFS files", "Default: false". — https://raw.githubusercontent.com/actions/checkout/main/README.md (2026-10-13)
- Reported by a user (Hugo forum, 11 Aug 2021, single reporter): "My site worked fine locally, however when I deploy to github pages all my LFS content is missing." Then: "Yep that worked, so my workflow gh-pages includes this line:" (`lfs: true`). — https://discourse.gohugo.io/t/github-pages-git-lfs/34217 (2026-10-13)
- Cost (documented): "If you download a 500 MB file that's tracked with Git LFS, you'll use 500 MB of the repository owner's bandwidth." The page applies this to Actions downloads. Free quota: "GitHub Free | 10 GiB | 10 GiB" (bandwidth | storage). — https://docs.github.com/en/billing/concepts/product-billing/git-lfs (2026-10-13)
- [analysis] An artifact holds real files, not pointers, so the doc's restriction (Pages reading LFS pointers from the repo) likely doesn't bite. The bandwidth cost per deploy is the real constraint.

## F6. advimman/lama issues on the checkpoint licence

**Verdict: Partly (informal answer from a co-author).** The GitHub search (via `api.github.com/search/issues`, 2026-10-13) for "license" returned #230, #132, #364 and PR #4. For "commercial" it returned only #364 (unrelated).
- #230 "LaMa Pre-trained Model License (from authors of Inpaint Anything)", created 2023-04-25, closed. The question asks "if the license of the weights is the same as this repo (Apache 2.0)?" Reply from senya-ashukha: "amazing work added to readme!" and "I'm quite sure that repo says apache 2.0 ;-)" — https://github.com/advimman/lama/issues/230 (2026-10-13)
- senya-ashukha is "Arsenii Ashukha" (https://github.com/senya-ashukha), and "Arsenii Ashukha" is in the LaMa author list in the README.
- #132 (2022-07-12, closed): the poster asks whether they can use it in a POC. senya-ashukha's reply is only an image, which couldn't be read, so its content isn't known. — https://github.com/advimman/lama/issues/132
- The LaMa README itself has no licence statement (per the README read above).

## F7. IOPaint `iopaint.com/models/erase/lama`

**Verdict: Not found.** The page has no licence text and no weights URL. It links to github.com/saic-mdal/lama and arXiv 2109.07161. — https://www.iopaint.com/models/erase/lama (2026-10-13)

## F8. ORT issue #26732 (fp16 overflow on WebGPU)

**Status: Confirmed closed (stale bot). Runtime fix by 1.30: Not found.**
- Title: "fp16 and q4f16 Gemma 3 models produce invalid outputs on WebGPU due to overflow in ONNX runtime" (ORT 1.23.2, WebGPU).
- RobertoReale: "This issue was auto-closed by the stale bot." · "Root cause: the fp16 residual stream overflows, not the matmul kernels." · "#29599 (f32 matmul accumulators) does not fix this issue." · "The model-side fix already shipped, so users pulling the current Hub revision are fine." · "the lever is keeping the residual/skip path in f32 on the WebGPU EP for fp16 models." xenova: "I recently updated the float16 versions". No Microsoft maintainer reply appears. Comment dates weren't visible. — https://github.com/microsoft/onnxruntime/issues/26732 (2026-10-13)
- PR #29599 "feat(webgpu): add enableMatmulFp32Accumulation provider option for MatMulNBits": "Default behaviour on `main` is unchanged by this PR." It wasn't shown as merged. — https://github.com/microsoft/onnxruntime/pull/29599 (2026-10-13)
- ORT v1.30.0 notes ("released this 10 Sep") contain no line on this overflow. Related fp16 lines: "enabled LayerNorm fusion to fix FP16 inference correctness"; "added FP16 support to the JavaScript WebGPU `Conv3DNaive` shader". — https://github.com/microsoft/onnxruntime/releases/tag/v1.30.0 (2026-10-13)

## F9. ORT without `shader-f16`: upcast or fail?

**Verdict: Contradicted (if the hypothesis was "upcast"): it fails.** Documented in source; also reported by users.
- Native WebGPU EP (`onnxruntime/core/providers/webgpu/shader_helper.cc`, main): `ORT_RETURN_IF_NOT(webgpu_context_.DeviceHasFeature(wgpu::FeatureName::ShaderF16), "Program ", program_.Name(),` … `" requires f16 but the device does not support it.");` — https://raw.githubusercontent.com/microsoft/onnxruntime/main/onnxruntime/core/providers/webgpu/shader_helper.cc (2026-10-13)
- JSEP: `requireFeatureIfAvailable('shader-f16');` (backend-webgpu.ts), and the `enable f16` directive is added only when the feature exists: `{ feature: 'shader-f16', extension: 'f16' },` (program-manager.ts). No upcast path was found in either file. — https://raw.githubusercontent.com/microsoft/onnxruntime/main/js/web/lib/wasm/jsep/backend-webgpu.ts · https://raw.githubusercontent.com/microsoft/onnxruntime/main/js/web/lib/wasm/jsep/webgpu/program-manager.ts (2026-10-13)
- Reported by a user (opened October 10, 2026; Chrome 155, SwiftShader adapter, fp16 SAM 2.1 tiny): "Can't create a session … Program Transpose requires f16 but the device does not support it" — https://github.com/VolksRat71/sam-ui/issues/77 (2026-10-13)
- Reported (Xenova, 17 May 2024, Transformers.js): "Linux hasn't had great support for fp16 unfortunately..." — https://www.huggingface.co/spaces/Xenova/experimental-moondream-webgpu/discussions/1 (2026-10-13)
- ORT 1.30 README footnote: "Float16 support requires Chrome v121 or later, and Edge v122 or later." — https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/README.md (2026-10-13)

## F10. WebKit storage policy (webkit.org/blog/14403)

**Quotas: Confirmed.** "Aug 10, 2023", by Sihui Liu: "For a browser app, the origin quota is up to 60% of the total disk space." · "For other apps, the origin quota is up to 15% of the total disk space." · "For a browser app, overall quota is up to 80% of the total disk space." · "For other apps, overall quota is up to 20% of the total disk space." · "The ordering of origins to be deleted is decided using a least-recently-used policy." · "With this change, Safari 17.0 no longer prompts users about a website wanting to use more space." · Persistence: "WebKit currently grants a request based on heuristics like whether the website is opened as a Home Screen Web App." · Eviction triggers: "It can happen under a few conditions: when exceeding the overall quota, when the system is under storage pressure," followed by inactivity under Intelligent Tracking Prevention. — https://webkit.org/blog/14403/updates-to-storage-policy/ (2026-10-13)

**Old 1 GiB cap: Not found** in 14403. The post only says the prompt was removed.

**7-day proactive eviction: Confirmed, but the source is webkit.org/blog/10218 (24 Mar 2020), not 14403.** "deleting all of a website's script-writable storage after seven days of Safari use without user interaction on the site." Covered types include "Indexed DB", "LocalStorage", "Service Worker registrations and cache". Home Screen: "Web applications added to the home screen are not part of Safari and thus have their own counter of days of use." · "We do not expect the first-party in such a web application to have its website data deleted." — https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ (2026-10-13)

## F11. Safari 26 / Firefox WebGPU with ORT-web 1.30

**Verdict: Partly.** The README table is confirmed, but reports show the WebGPU path running on both browsers.
- ORT-web 1.30 README table, WebGPU row: Chrome/Edge Windows ✔️, Android ✔️, macOS ✔️, iOS ❌, Safari (MacOS) ❌, Safari (iOS) ❌, Firefox (Windows) ❌. — https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/README.md (2026-10-13)
- Browser shipping (documented, web.dev, November 25, 2025): "WebGPU is available in macOS Tahoe 26, iOS 26, iPadOS 26, and visionOS 26." · "WebGPU is available on Windows as of Firefox 141." · "WebGPU is available in macOS Tahoe 26 on ARM64 machines, as of Firefox 145." — https://web.dev/blog/webgpu-supported-major-browsers (2026-10-13)
- Reported by a user: ORT "1.24.3", EP "'webgpu' (WebGPU)", "Crash after around 500 webgpu inference with yolo26n on iOS 26.3 safari". This implies the EP ran until the crash. — https://github.com/microsoft/onnxruntime/issues/27584 (2026-10-13)
- Reported (Mozilla Bugzilla 1939943, comment 8 by Tarek Ziadé, Jan 2025 logs, Firefox's built-in inference using vendored ORT JSEP): "WebGPU can be used only for fp32, because is extremely slow in int8 and won't work with fp16" — https://bugzilla.mozilla.org/show_bug.cgi?id=1939943 (2026-10-13)
- Native vs JSEP (secondary mirror of v1.29.0 notes): "onnxruntime-web has announced the deprecation of WebGL and JSEP." · "The native WebGPU EP is the recommended path going forward." — https://newreleases.io/project/github/microsoft/onnxruntime/release/v1.29.0 (2026-10-13; secondary). Which path ORT-web 1.30 uses by default on Safari/Firefox: **Not found** (needs T11).

## F12. Browser test of the curl results under COEP `require-corp`

**Verdict: Not found (needs local browser test).** Relevant documentation and reports:
- COEP (documented, MDN): "Note that requests made in `cors` mode won't be blocked by COEP or trigger COEP violations, but must still be permitted by CORS." — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy (2026-10-13). So under `require-corp` a `fetch()` (CORS mode by default) depends only on the target's CORS headers.
- Release assets (reported by users; no GitHub staff reply; "Unanswered", labelled "Bug"): opened Jan 26, 2023: "the release assets download bucket do not support CORS". On Nov 19, 2025 a user's release download was "just be blocked by cors". — https://github.com/orgs/community/discussions/45446 (2026-10-13)
- raw.githubusercontent.com (documented): the 2025-05-08 changelog covers "downloading files from raw.githubusercontent.com" among unauthenticated requests getting updated rate limits (no numbers given). — https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/ (2026-10-13)
- Test: T12.

## F13. RawNIND / NIND weights and darktable-ai checkpoints

- **`trougnouf/nind-denoise` weights statement: Not found.** The sidebar shows "GPL-3.0 license". The README's only model line is "Models: <https://drive.google.com/drive/folders/1XmY9yO3yhhhdwQ_btYCIpkUBFQ88H-pr?usp=sharing>", with no licence wording. — https://raw.githubusercontent.com/trougnouf/nind-denoise/master/README.md (2026-10-13)
- **`trougnouf/rawnind_jddc`: Confirmed.** "The weights are dual licensed GPL3 + CC-BY-4.0" · "Pre-trained models are available through the following link:" https://drive.google.com/drive/folders/12Uc5sT4OWx02sviUS_boDk1zDSDRVorw — https://raw.githubusercontent.com/trougnouf/rawnind_jddc/main/README.md (2026-10-13)
- **darktable-ai card** (the card is on GitHub, not HF): "License: GPL-3.0", "Repository: https://github.com/trougnouf/rawnind_jddc"; Bayer "DenoiserTrainingBayerToProfiledRGB_4ch_2024-02-21-bayer_ms-ssim_mgout_notrans_valeither_-4" iter 4350000; linear "DenoiserTrainingProfiledRGBToProfiledRGB_3ch_2024-10-09-prgb_ms-ssim_mgout_notrans_valeither_-1" iter 3900000. — https://raw.githubusercontent.com/darktable-org/darktable-ai/master/models/rawdenoise-nind/README.md (2026-10-13)
- **Which checkpoints: Partly.** `model.yaml` downloads `url: "https://drive.google.com/file/d/1dFTLeljWi9wwojcZUsam8bE31JdYy3oM/view?usp=drive_link"` and `url: "https://drive.google.com/file/d/1kH8tK4RN_edak3r_VIAhCzPa6CNsuTYC/view?usp=drive_link"`, with `source: "https://github.com/trougnouf/rawnind_jddc"` — https://raw.githubusercontent.com/darktable-org/darktable-ai/master/models/rawdenoise-nind/model.yaml (2026-10-13). The Drive pages are titled "iter_4350000.pt - Google Drive" and "iter_3900000.pt - Google Drive". So they are RawNIND (`rawnind_jddc`) checkpoints matching the card's iterations, not `nind-denoise` models. Whether those two files sit inside the `rawnind_jddc` folder `12Uc5…` couldn't be confirmed (Drive folder listings blocked by robots).

---

## Appendix: local tests to run

Run these in Chrome DevTools on the deployed LightBench page (`https://shawneburke88-afk.github.io/Photo-Editing-App/`) with COEP/COOP active. Check `crossOriginIsolated === true` first. Keep the Network panel open with "Preserve log" on.

**T1a — HF CORS on the redirect chain (F1a, F1b)**
```js
const url = 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx'; // later: resolve/<commit>/
const ac = new AbortController();
const r = await fetch(url, { signal: ac.signal });
console.log(r.status, r.type, r.redirected, r.url);
console.log('len', r.headers.get('content-length'), 'type', r.headers.get('content-type'));
ac.abort(); // don't pull the whole file
```
Look for: `200`, `type: "cors"`, `redirected: true`, a final `r.url` on a CDN/Xet host, and `len` = `28079181`. In the Network panel, click the 302 and the final request and confirm both carry `access-control-allow-origin`. A `TypeError: Failed to fetch` plus a console CORS error means it failed. Repeat with `onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx` (expect 114538221).

**T1b — Range and preflight (F1c)**
```js
const r1 = await fetch(url, { headers: { Range: 'bytes=0-1023' } });          // single range: should be safelisted
console.log(r1.status, r1.headers.get('content-range'), (await r1.arrayBuffer()).byteLength);
const r2 = await fetch(url, { headers: { Range: 'bytes=0-9,100-109' } }).catch(e => e.message); // forces a preflight
console.log(r2.status ?? r2);
```
Look for: r1 `206` with 1024 bytes, and **no OPTIONS row** in Network. If an OPTIONS row appears and fails, the browser doesn't apply the single-range safelist and HF's preflight is still broken. r2 shows whether a real preflight passes.

**T3 — LaMa-ONNX op types (F3, DFT)**
Open `lama_fp32.onnx` in netron.app (it runs locally in the browser) and search for `DFT`, or in Python: `import onnx; m = onnx.load('lama_fp32.onnx'); print(sorted({n.op_type for n in m.graph.node}))`. Then check each op against ORT's WebGPU operator list.

**T4 — Pages large-file serving (F4)**
Deploy a ~110 MB dummy `models/test.onnx` through the Actions artifact, then:
```js
const r = await fetch('/Photo-Editing-App/models/test.onnx', { method: 'HEAD', cache: 'no-store' });
console.log(r.status, r.headers.get('content-type'), r.headers.get('content-length'));
```
Look for: `200` with the right length. In Network → Response Headers, note `content-type` (expect `application/octet-stream`) and whether `content-encoding: gzip` appears (it shouldn't for binary).

**T9 — fp16 on an adapter without `shader-f16` (F9)**
```js
const a = await navigator.gpu.requestAdapter(); console.log('shader-f16', a.features.has('shader-f16'));
const s = await ort.InferenceSession.create(FP16_MODEL_URL, { executionProviders: ['webgpu'] }).catch(e => e.message);
console.log(s);
```
On a machine or browser that reports `false` (for example Chrome with a SwiftShader adapter, as in sam-ui #77), expect an error containing "requires f16 but the device does not support it" or a WGSL compile error, not a silent upcast.

**T10 — Safari storage (F10)**
In a Safari tab and again as a Home Screen app: `console.log(await navigator.storage.estimate(), await navigator.storage.persist(), await navigator.storage.persisted())`. Expect `persist()` → `true` more readily in the Home Screen app.

**T11 — ORT WebGPU on Safari 26 / Firefox (F11)**
```js
const s = await ort.InferenceSession.create(MIGAN_URL, { executionProviders: ['webgpu'] }); // webgpu only, no wasm fallback
const out = await s.run(feeds); // compare a checksum against the same run with ['wasm']
```
Look for: session creation succeeds with `['webgpu']` alone, and outputs match WASM within tolerance. Record the browser version and `navigator.gpu` adapter info.

**T12 — raw.githubusercontent vs release asset under COEP (F12)**
```js
console.log(crossOriginIsolated);
console.log(await fetch('https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE-WEIGHTS').then(r => [r.status, r.type]).catch(e => e.message));
console.log(await fetch('https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel', { method: 'HEAD' }).then(r => r.status).catch(e => e.message));
```
Expect: the first gives `[200, "cors"]`. The second gives `Failed to fetch`, with a console error naming a missing `Access-Control-Allow-Origin` on the github.com 302 (or on the asset host).
