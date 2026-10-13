# Phase 4 groundwork: model hosting, LaMa weights, RawNIND licence, runtime

**Prepared for:** Shawn Burke (LightBench) · **Date:** 2026-10-13 · **Builds on:**
`docs/PLAN.md` (Phase 4), `docs/research/PHASE4_MODELS.md` (draft, Independent check, owner's decisions),
`docs/research/cowork-2026-10-13/PHASE4_MODELS.md` and `LIGHTCRAFT_AI_NOTES.md`, `docs/research/DEPTH_OF_FIELD.md`.

**Rules this follows** (PLAN.md): permissive licences only for AI code and weights (no NC, research-only or RAIL;
SAM 3 excluded); GPL-3.0 weights to be decided when Phase 4 starts; everything runs on the user's device.

**How to read it**
- **[measured]**: checked from this machine on 2026-10-13 (curl headers, byte ranges, npm tarballs, source files).
- **[read]**: read at the primary source (GitHub raw files, the `github/docs`, `mdn/content` and `huggingface/hub-docs`
  source repos, the npm packages).
- **[Cowork]** / **[draft]**: taken from the Cowork report or the PHASE4_MODELS draft; not re-checked here.
- **[unconfirmed]**: could not be read from here. Blocked: huggingface.co, webkit.org, iopaint.com, *.github.io, the
  GitHub API and github.com pages of most repos. **[estimate]**: arithmetic, not a measurement.
- Licence and patent text is reported as fact. None of this is legal advice.

---

## Summary

1. **Hosting.** No single free host suits everything.
   - **GitHub Pages** (same origin, so no CORS question) suits the small default models. Limits: 1 GB site, a *soft*
     100 GB/month of bandwidth, and 100 MiB per file in git. Git LFS "cannot be used with GitHub Pages sites".
   - **GitHub Release assets** send no CORS header on the 302 or on the asset host, so the website can't fetch them.
     They still work as the build's pinned source: the deploy job can copy them into the Pages artifact.
   - **raw.githubusercontent.com** and **media.githubusercontent.com** do send `Access-Control-Allow-Origin: *`, but
     only for simple GETs. A Range preflight fails on both. LFS downloads count against the owner's LFS bandwidth
     (10 GiB/month free).
   - **Hugging Face** (pinned commit + SHA-256) suits the large optional models. Its CORS behaviour and terms are
     **[unconfirmed]**.
2. **Storage.** A few hundred MB fits easily in Chromium (60 % of disk per origin), Firefox (10 % of disk or 10 GiB
   best-effort) and Safari 17+ (about 60 % of disk). Eviction removes *all* of an origin's data at once, so the models
   share the library's fate. LightBench already calls `navigator.storage.persist()`.
3. **Delivery code.** Reuse the Lensfun and noise-profile pattern (pinned file, left out of the precache, own Cache
   Storage name, retry). Add a manifest, a consent dialog, a size check and SHA-256 verification.
   - The cache name must **not** start with `lightbench-`: the service worker deletes those caches on every update.
   - WebCrypto can't hash a stream, so hashing needs either the whole file in memory or an incremental hasher.
4. **LaMa weights.** The repo is Apache-2.0 (`Copyright [2021] Samsung Research`). The README never uses the word
   "license" and gives no terms for the checkpoints, which come from a third-party HF account and a Google Drive folder.
   IOPaint (Apache-2.0) ships them from its own GitHub release without a weights statement. Options and a draft
   question for the authors are in §2.
5. **RawNIND.** The upstream README says "The weights are dual licensed GPL3 + CC-BY-4.0" [read]. A draft message to
   the author is in §3. Its size was measured: the darktable-ai package is 57,700,134 bytes.
6. **Runtime.**
   - **onnxruntime-web 1.30.0** (MIT) costs about 26.8 MB of wasm (6.6 MB gzip) plus 66 KB of JS for the WebGPU build.
     It can share LightBench's own `GPUDevice`.
   - **transformers.js 4.3.1** (Apache-2.0) wraps a *dev* build of ORT. By default it loads the ORT wasm from jsDelivr
     and the models from huggingface.co, so it must be reconfigured to stay local-only. It has no inpainting or raw
     denoise models.
   - **Hand-written WGSL** is realistic for the two small conv nets (MI-GAN, RawNIND), not for the transformers.
   - **fp16 needs an fp32 path:** there are overflow reports, darktable keeps RawNIND Bayer off FP16 on CoreML, and
     `shader-f16` coverage is not universal.

---

## 1. Model hosting and delivery plan

### 1.1 Host facts checked from here

**GitHub Pages** (LightBench deploys `web/dist` with `actions/upload-pages-artifact@v3` + `deploy-pages@v4`,
`.github/workflows/deploy.yml`). Quoted from `github/docs` source, `content/pages/getting-started-with-github-pages/github-pages-limits.md` [read]:
- "Published GitHub Pages sites may be no larger than 1 GB."
- "GitHub Pages source repositories have a recommended limit of 1 GB."
- "GitHub Pages deployments will timeout if they take longer than 10 minutes."
- "GitHub Pages sites have a _soft_ bandwidth limit of 100 GB per month."
- "rate limits may apply … HTTP status code of `429`".
- If over quota, GitHub may suggest "putting a third-party content distribution network (CDN) in front of your site,
  making use of other GitHub features such as releases, or moving to a different hosting service".
- "not intended for or allowed to be used as a free web-hosting service to run your online business, e-commerce site,
  or … commercial software as a service (SaaS)".

**Per-file limits** [read]:
- **Files in git:** `data/variables/large_files.yml` gives a warning at 50 MiB, a block at 100 MiB, and 25 MiB for
  browser uploads. "GitHub blocks files larger than 100 MiB" (`about-large-files-on-github.md`).
- **Files in a Pages artifact** (built by Actions, not committed to git): the `actions/upload-pages-artifact` README says
  the tar must "be under 10GB in size (we recommend under 1 GB!)", that "the GitHub Pages officially supported maximum
  size limit is 1GB", and that there is an "_unofficial_ absolute maximum size limit of 10GB". It must "not contain any
  symbolic or hard links".
- **No per-file limit for artifacts is documented.** Whether a 115–208 MB file is served normally is **[unconfirmed]**.

**Git LFS and Pages** [read]:
- `about-git-large-file-storage.md`: "Git LFS cannot be used with GitHub Pages sites."
- LFS per-file maximum: 2 GB (Free/Pro).
- `large_files.yml` sets the included LFS quota for Free/Pro at **10 GiB bandwidth and 10 GiB storage per month**.
- `content/billing/concepts/product-billing/git-lfs.md`: "When you download a LFS file, the bandwidth you use is included
  in the repository owner's bandwidth usage". With a $0 budget, LFS "usage is blocked for the rest of the calendar month".
- An Actions workflow could check out LFS files (`lfs: true`) and put the real bytes into the Pages artifact. Whether
  GitHub's note covers that case is **[unconfirmed]**, and every CI checkout would use the 10 GiB LFS bandwidth.
  **LFS is not a good fit.**

**Current site size:** a local `web/dist` from 2026-10-12 is 5.6 MB [measured]. Nearly all of the 1 GB is free.

**CORS checks** (curl with `Origin: https://shawneburke88-afk.github.io`, 2026-10-13) [measured]. The agent proxy passes
response headers through; a browser test is still advisable.

| URL tested | Plain GET / HEAD | `Range` GET | Preflight (`OPTIONS` asking for the `range` header) | Meaning for the website |
|---|---|---|---|---|
| `raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE-WEIGHTS` | 200, `access-control-allow-origin: *`, `cross-origin-resource-policy: cross-origin`, `cache-control: max-age=300` | 206 with ACAO `*` (curl sends no preflight) | **403** (ACAO `*` but status not OK, so a browser preflight fails) | Simple `fetch()` works. Never add a `Range` or custom header. Files limited to 100 MiB (git) |
| `media.githubusercontent.com/media/onnx/models/main/…/mnist-12.onnx` (an LFS file) | 200, `Access-Control-Allow-Origin: *`, CORP `cross-origin` | 206 with ACAO `*` | 200, but `Access-Control-Allow-Headers: X-CSRF-Token,Authorization,Accept,GitHub-Remote-Auth`, so `range` is not allowed | Simple GET works, **but it uses the owner's LFS bandwidth (10 GiB/month free)** |
| `github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel` | **302, no ACAO** | redirect target `release-assets.githubusercontent.com/…` answered 206 (`bytes 0-99/57700134`), **no ACAO** | — | Blocked for browser `fetch()` (confirms the draft and Cowork). Fine for CI and the Tauri app |
| `huggingface.co/…/resolve/main/…` | 403 from this environment's proxy | — | — | **[unconfirmed]** |
| `shawneburke88-afk.github.io/Photo-Editing-App/` | 403 from the proxy | — | — | Same origin as the app, so CORS doesn't apply |

**Why CORS matters more for LightBench.** LightBench is cross-origin isolated. Its service worker adds
`Cross-Origin-Embedder-Policy: require-corp` to every response it serves (`web/src/pwa/sw.ts`, `isolate`).
- A cross-origin model download must be a CORS-mode `fetch` that gets ACAO back. The browser rules are well known,
  but this wasn't tested in a browser here.
- Opaque `no-cors` responses can't be read as bytes.
- The worker passes cross-origin GETs straight to `fetch(request)` and then re-wraps the response (`respond` →
  `isolate`). That works for CORS responses (status ≠ 0).

**Hugging Face** (from the `huggingface/hub-docs` source, cloned from GitHub) [read]:
- `docs/hub/rate-limits.md`: anonymous users get **3,000 "Resolvers" requests per 5-minute window per IP**. "Anonymous
  and Free users are subject to change over time depending on platform health". Resolvers are URLs with `/resolve/`.
- `docs/hub/storage-limits.md`: public storage for a free user or org is "Best-effort", with "Beyond the first few
  gigabytes, please use this resource responsibly by uploading content that offers genuine value to other users".
- No mention of CORS was found in hub-docs.

**HF browser use, from other sources** (none re-checked here):
- In practice, browsers can fetch from HF: inpaint-web's `src/adapters/inpainting.ts` [read] fetches
  `https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx`. It also has a backup URL on a
  Cloudflare Worker proxy (`worker-share-proxy-01f5.lxfater.workers.dev`).
- transformers.js defaults to `remoteHost: "https://huggingface.co/"` [read, 4.3.1 `dist/transformers.web.js`].
- **[unconfirmed]** HF's own CORS policy, its terms on hot-linking from a public app, and the Range-preflight failure
  on the Xet bridge (forum report, [Cowork]).
- **[unconfirmed]** the `resolve` → signed-URL 302 that defeats the HTTP cache (moebius-web notes, [draft]).

**Other possible hosts** (not researched): jsDelivr's GitHub mirror (blocked here), a Cloudflare R2 bucket or Worker
(inpaint-web uses a Worker as backup), a second static host. **[unconfirmed]** for limits and terms.

### 1.2 Hosting options for the owner

| Option | How | Fits | Costs / risks |
|---|---|---|---|
| **A. Pages, files committed to git** | `web/models/*.onnx` in the repo, emitted like `lensfun/` | Only files < 100 MiB (MI-GAN, SAM 2.1 Tiny fp16, DA2-S fp16, RawNIND) | Model bytes live in git history forever (1 GB recommended repo size); 50 MiB push warnings; 100 GB/month soft bandwidth |
| **B. Pages, files fetched at build time** | Keep the pinned models as assets of a LightBench GitHub Release (any size up to 2 GiB per file, "We don't limit the total size of the binary files in the release or the bandwidth used to deliver them", `about-large-files-on-github.md` [read]). `deploy.yml` downloads them, checks SHA-256 and puts them in `web/dist/models/` | Any model up to the site budget (1 GB total) | No git bloat. Each deploy uploads the models again (10-minute deploy timeout). Per-file limit for artifacts **[unconfirmed]**. The same 100 GB/month soft bandwidth. Releases also give the Tauri app a direct source |
| **C. Hugging Face, LightBench-owned repo, commit-pinned** | `https://huggingface.co/<lightbench>/<repo>/resolve/<commit>/<file>`, SHA-256 checked in the app, plain GET only | Large optional models (LaMa, Moebius, BiRefNet full) | Third-party CDN; rate limits per IP "subject to change"; terms **[unconfirmed]**; CORS **[unconfirmed]** (works in other apps) |
| **D. Upstream URLs as-is** (e.g. `andraniksargsyan/migan`) | Pin a commit + SHA-256 | Quick prototype | Upstream can delete or move files; LightBench doesn't control them |

**Bandwidth arithmetic [estimate].**
- Defaults: MI-GAN 28.1 MB + SAM 2.1 Tiny fp16 77.5 MB + DA2-S fp16 ≈ 50 MB + BiRefNet_lite fp16 115 MB + ORT wasm
  26.8 MB ≈ **297 MB** for a user who downloads all of them.
- 100 GB / 0.297 GB ≈ **340 such users a month** before the soft limit (uncompressed sizes; repeat visits come from
  the cache).
- With only MI-GAN, SAM 2.1 Tiny, DA2-S and ORT (≈ 182 MB), it is ≈ 550 users a month.
- This is the main argument for option C for anything large.

### 1.3 Browser storage for 50–300 MB of models

From `mdn/content`, `storage_quotas_and_eviction_criteria/index.md` [read]:

| Browser | Per-origin quota (quoted) | Eviction | `persist()` |
|---|---|---|---|
| Chrome / Edge | "an origin can store up to 60% of the total disk size in both persistent and best-effort modes"; Chrome "uses at most 80% of the total disk size" overall | LRU under storage pressure; persistent origins skipped | "automatically approve or deny … do not show any prompts" |
| Firefox | Best-effort: the smaller of "10% of the total disk size" or "10 GiB" (group limit). Persistent: "up to 50% of the total disk size, capped at 8 TiB" | LRU; persistent skipped | "the user is notified with a UI popup" |
| Safari (macOS 14 / iOS 17+) | Browser apps "up to around 60% of total disk"; other WebKit apps ≈ 15 % (a Home Screen/Dock web app gets the 60 %); overall 80 % / 20 %. Earlier Safari: 1 GiB, then asks the user | Also **proactive**: with tracking prevention on, an origin with "no user interaction … in the last seven days of browser use" loses its script-created data | Automatic, by heuristics |

**What this means for LightBench:**
- **Size is not the problem.** 50–300 MB is well inside every quota on a normal disk. Check
  `navigator.storage.estimate()` before a download and handle `QuotaExceededError`.
- **The quota is shared.** It covers Cache Storage, IndexedDB and OPFS together (MDN). The models share it with
  LightBench's catalog and thumbnails (OPFS).
- **Eviction is all or nothing.** "all of its data, not parts of it, is deleted at the same time" (MDN). A model can't
  be evicted on its own. LightBench already asks for persistence and shows a notice when it is refused
  (`web/src/catalog/storage.ts`). The same request covers the models.
- **Private windows:** "stored data is usually deleted when the private browsing mode ends" (MDN). The Lensfun loader
  already falls back to downloading each session when Cache Storage throws. For a 100 MB model, warn instead of
  silently re-downloading.
- **Large files:** Chrome's maximum ArrayBuffer is about 2 GB, and ORT Web can't run models over 4 GB ([draft], ORT
  large-models doc). Every model here is well under both.

**Cache Storage or OPFS?** Both work.
- **Cache Storage** matches the Lensfun and noise-profile code and can be filled by streaming `cache.put()`.
- **OPFS** offers `createWritable()` streams and, in workers, `createSyncAccessHandle()` (MDN). It suits a staged
  download that is renamed after verification.
- ORT needs the bytes as a `Uint8Array` (or fetches a URL itself), so either way the model is read into memory once per
  session.

### 1.4 What LightBench already does (reuse this)

Read from `web/src/engine/lens/lens-db.ts` and `web/lensfun-plugin.ts` (main), `web/src/engine/detail/noise-db.ts` and
`web/noiseprofiles-plugin.ts` (branch `lightbench/detail`), and `web/sw-plugin.ts` / `web/src/pwa/sw.ts` [read]:

- **Pinned source in the repo.**
  - `web/lensfun/` with `source.json` holding repo, commit, date and licence. The noise profiles also record a
    `sha256` of the upstream file.
  - A Vite plugin emits one file named after the upstream commit (`lensfun/lensfun-43f9e00.json`,
    `noiseprofiles/noiseprofiles-<commit>.json`).
  - The plugin exposes the info to the app through `define` (`__LENSFUN_DB__`, `__NOISE_PROFILES__`) and serves the
    file from the dev server.
- **Left out of the precache.** `sw-plugin.ts` filters `lensfun/` and `noiseprofiles/` out of the list, so installing
  LightBench doesn't download them.
- **Loader module.**
  - Module-level state: `data | pending | failedAt`, with `xxxState()` returning data, `'loading'`, `'failed'` or null.
  - `subscribeXxx()` listeners, so the UI re-renders.
  - `loadXxx(retry)` with a 30 s back-off (`RETRY_MS`).
  - Cache Storage under its own name (`lensfun-data`, `noiseprofile-data`). On a new file name, older entries are
    deleted.
  - Private mode falls back to a download each session.
- **The service worker deletes every cache whose name starts with `lightbench-`** when a new build activates
  (`CACHE_PREFIX`). Model caches need another prefix, as `lensfun-data` has.
- **Integrity.** The precache already checks each file against a SHA-256 prefix at install (`revision()`). The Lensfun
  and noise loaders don't hash at runtime: same origin, and the file name carries the commit.

**What models add:**
- consent before download;
- a per-file SHA-256 (cross-origin hosts can't be trusted the way the app's own origin is);
- progress for 100 MB files;
- a size check;
- a Settings page to list and delete models;
- fp16/fp32 variants.

### 1.5 Consent-gated download with SHA-256 pinning (proposed design)

**LightCraft's precedent** ([Cowork], `LIGHTCRAFT_AI_NOTES.md`):
- weights are never bundled;
- "a SHA-256-pinned download manifest";
- a licence step: the RawNIND model is fetched only "after the user accepts its terms";
- "a staging filename … while it waits for the user to accept its terms";
- for the feature itself, "Enabling that offer in releases remains a maintainer decision".

LightCraft is a native app; it gives no browser precedent.

**Proposed flow** (untested design):

1. **Manifest at build time** (`web/models/manifest.json` → `define(__AI_MODELS__)`, as the Lensfun plugin does). Per
   model:
   - id, version and the tools that use it;
   - each file's `{ url(s), bytes, sha256 }`;
   - variant (`fp16` | `fp32`);
   - SPDX licence id plus the path of the licence text shipped with the app;
   - attribution line and source repo + commit;
   - training-data note, and whether the output is "generated".
2. **First use of a tool → dialog** (nothing downloads before the click):
   - model name, size in MB, licence (with the full text a click away), source;
   - "Runs on this device. Your photos are never uploaded.";
   - the training-data caveat where the owner wants one;
   - where it is stored and how to delete it;
   - buttons: Download / Not now.
   - If `navigator.storage.estimate()` shows too little room, say so before starting.
   - Request `persist()` here if it isn't granted yet.
3. **Download:**
   - plain `fetch(url)` with no extra headers, so no preflight;
   - stream with progress from `Content-Length`, which browsers expose cross-origin as a CORS-safelisted response
     header (**[unconfirmed]** that HF's redirect keeps it);
   - `tee()` the body: one branch to the cache or a staging OPFS file, the other to the hasher.
4. **Verify, then commit:**
   - check the bytes and SHA-256 against the manifest, then move the file to its final name (OPFS) or keep the cache
     entry; on a mismatch, delete it and report.
   - **WebCrypto can't do this incrementally.** MDN: "this API does not support streaming input: you must read the
     entire input into memory before passing it into the digest function."
   - So either hash after the download from one in-memory copy (simple, but a 200 MB spike), or use a small incremental
     SHA-256 in JS/wasm (its licence would need checking).
5. **Store:**
   - Cache Storage `ai-models` (never a `lightbench-` prefix), keyed by a URL that contains the SHA-256, or OPFS
     `/models/<id>/<sha256>.onnx`;
   - record consent (model id + sha256 + licence id + date) in the catalog or `localStorage`.
6. **Use:** load once per session into ORT. Verify at download, not on every load.
7. **Edits** record the model id and SHA-256 (as PHASE4_MODELS §1 proposes), so an old edit names the model it used.
8. **Settings → AI models:** list installed models with size, licence and attribution; Delete; Re-download; "Download
   on first use" vs "Ask every time".
9. **Precache:** exclude `models/` and the ORT wasm from `sw-plugin.ts`'s precache (as `lensfun/` is), or every install
   downloads about 27 MB of ORT plus the models.

### 1.6 Per-model table

Sizes are bytes or MB as found. 100 MiB = 104,857,600 bytes.

| Model | File(s) and size | Size source | Proposed host | Weights licence (evidence) | Cache location | Attribution / NOTICE needed |
|---|---|---|---|---|---|---|
| **MI-GAN 512 Places2** (fill, Remove) | `migan_pipeline_v2.onnx` **28.1 MB** fp32 [Cowork, HF]. Same model as TorchScript `migan_traced.pt` **27,048,675 bytes** [measured, IOPaint's mirror `Sanster/models` release `migan`] | as stated | **Pages** (A or B) | **MIT**, `LICENSE-WEIGHTS`: "MIT License / Copyright (c) 2024 Picsart AI Research (PAIR)" [read]. The README links the HF ONNX and says "see LICENSE-WEIGHTS for the license" [read] | `ai-models` cache (or OPFS) | MIT text with the Picsart copyright line in THIRD_PARTY_NOTICES and in the dialog. Note the ONNX source (HF `andraniksargsyan/migan`, linked from the MI-GAN README) |
| **SAM 2.1 Hiera Tiny**: image encoder | fp16 **67 MB**, int8 52.6 MB, fp32 134 MB [Cowork, `onnx-community/sam2.1-hiera-tiny-ONNX`]. darktable's fp32 package (encoder + decoder) **143,293,697 bytes** [measured] | as stated | **Pages** (fp16 < 100 MiB; > 50 MiB warning in git) | **Apache-2.0**: "The SAM 2 model checkpoints … are licensed under Apache 2.0" [draft, Cowork spot-checked] | same | Apache-2.0 text. No `NOTICE` file in `facebookresearch/sam2` (checked: none at the repo root) [measured]. Apache §4(b): say that the files were converted (ONNX/fp16). Credit "SAM 2 (Meta)" |
| **SAM 2.1 Hiera Tiny**: mask decoder | fp16 **10.5 MB**, int8 8.66 MB [Cowork] | [Cowork] | **Pages** | as above | same | as above |
| **BiRefNet_lite** (Swin-T) | fp32 ONNX **224,005,088 bytes** [measured, rembg release `v0.0.0`, `BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx`]. fp16 **115 MB** [Cowork, `onnx-community/BiRefNet_lite-ONNX`]. Needs graph surgery for WebGPU [Cowork] | as stated | fp16 is **over 100 MiB**, so **not committable to git** for Pages: option **B** (artifact) or **C** (HF) | **MIT**, "Copyright (c) 2024 ZhengPeng" [read]. HF card "mit" [Cowork] | same | MIT text. Training-data caveat (DIS5K non-commercial) in the dialog if the owner wants |
| **Depth Anything V2 Small** | fp32 ONNX **99,373,606 bytes** [measured, third-party export `fabio-sim/Depth-Anything-ONNX` release `v2.0.0`, `depth_anything_v2_vits.onnx`]. fp16 **≈ 50 MB** [estimate]; the official demo uses `onnx-community/depth-anything-v2-small` [draft]; its file sizes are **[unconfirmed]** | as stated | **Pages** (fp16) | **Apache-2.0** for Small only: "Depth-Anything-V2-Small model is under the Apache-2.0 license. Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license." [draft]. No `NOTICE` file in the repo [measured] | same | Apache-2.0 text; credit the DA2 authors; note the conversion |
| **LaMa (big-lama)**, optional | ONNX fp32 **208,044,816 bytes** (`Carve/LaMa-ONNX`, search result [draft, unconfirmed]), fixed 512×512 [Cowork]. TorchScript `big-lama.pt` **205,669,692 bytes** [measured, IOPaint's mirror `Sanster/models` release `add_big_lama`] | as stated | Only if the owner accepts it (§2): **C** (HF) | Repo **Apache-2.0**, "Copyright [2021] Samsung Research" [read]. **No weights statement upstream** (§2) | same | Apache-2.0 text with the Samsung Research line, the LaMa citation, and a note on the conversion |
| **Moebius**, optional later | UNet ~907 MB + VAE encoder ~137 MB + decoder ~198 MB, fp32 (moebius-web) [draft]; 226 M params | [draft] | **C** only (total > 1 GB Pages site; each file > 100 MiB) | **Apache-2.0** README: "Both the code and the pretrained model weights … Apache License 2.0 … Commercial use … permitted" [draft]. HF tag "mit" [Cowork]. VAE (from PixelHacker) licence **[unconfirmed]** | OPFS (three large files) | Apache-2.0 text; credit HUST/vivo; VAE terms to settle first |
| **RawNIND UtNet2** (Bayer + linear), if allowed | darktable-ai `rawdenoise-nind.dtmodel` **57,700,134 bytes** [measured, `Content-Range` from `darktable-ai` release `release-5.6.0`], with `model_bayer.onnx` and `model_linear.onnx`, fp32, opset 20, fixed 512×512 [read, darktable-ai card] | measured | **Pages** (B: copy from darktable-ai's release at build time, or re-host) | Upstream: "The weights are dual licensed GPL3 + CC-BY-4.0" [read]. darktable-ai card: "License: GPL-3.0" [read]. LightCraft: GPL-3.0 [Cowork] | same | Depends on §3's answer. For CC-BY-4.0, attribution would at least name the authors (Benoit Brummer, Christophe De Vleeschouwer), the paper, the licence and the changes (packaging by darktable-ai) |
| *Runtime: onnxruntime-web 1.30.0* | `ort-wasm-simd-threaded.asyncify.wasm` **26,781,914 bytes** (6,578,721 gzip -9) + `ort.webgpu.min.mjs` 66,349 bytes (20,610 gzip) [measured] | npm tarball | **Pages**, lazy (not precached) | **MIT** (npm `license`; repo `LICENSE` "Copyright (c) Microsoft Corporation") [read] | own cache, named by version | **The npm tarball contains no LICENSE file** [measured]. Add the MIT text and review the repo's `ThirdPartyNotices.txt` (exists, contents not reviewed) |

---

## 2. The LaMa weights question

### 2.1 Facts found

**The upstream repo** (`advimman/lama`, `main`, read 2026-10-13):
- `LICENSE` is the Apache License 2.0. The appendix line is filled in as "Copyright [2021] Samsung Research" (line 189)
  [read].
- The README contains **no occurrence of the word "license"** (`grep -ci license` → 0) [measured]. It never says which
  licence the checkpoints are under.
- Where the weights come from (README) [read]:
  - "The best model (Places2, Places Challenge): `curl -LJO https://huggingface.co/smartywu/big-lama/resolve/main/big-lama.zip`".
    The README doesn't say how `smartywu` relates to the authors.
  - "All models (Places & CelebA-HQ): download [Google Drive folder]".
  - "All yandex dist links went bad, you can download the model from the google drive". The original host is gone.
- **Training** (README) [read]:
  - Big-LaMa used Places365-Challenge ("Places365-Challenge: Train(476GB) … (to train Big-Lama)", [Cowork]).
  - The training recipe also downloads "models for _perceptual loss_": an ADE20K ResNet50 segmentation model
    (`sceneparsing.csail.mit.edu/model/pytorch/ade20k-resnet50dilated-ppm_deepsup/encoder_epoch_20.pth`), credited to
    CSAILVision.
  - ADE20K's terms say "only for non-commercial research and educational purposes" ([Cowork], quoting ade20k.csail.mit.edu).
  - That network is used only during training, not shipped. This is a training-provenance fact of the same kind as
    MI-GAN's Co-Mod-GAN teacher.
- **Authors:** Roman Suvorov, Elizaveta Logacheva, Anton Mashikhin, Anastasia Remizova, Arsenii Ashukha, Aleksei
  Silvestrov, Naejin Kong, Harshith Goka, Kiwoong Park, Victor Lempitsky (README) [read].
- The README's "Non-official 3rd party apps" list includes lama-cleaner (now IOPaint), simple-lama-inpainting,
  CoreMLaMa, ModelScope and others [read].
- Issues in `advimman/lama` asking about the weights licence could not be searched (the GitHub API and issue pages are
  blocked here) **[unconfirmed]**.

**ONNX ports and mirrors:**
- `Carve/LaMa-ONNX`: tagged "License: apache-2.0", 208 MB fp32, "The input shape is fixed at 512x512 pixels." [Cowork, HF;
  unconfirmed here].
- `smartywu/big-lama`: tagged "License: apache-2.0" [Cowork, HF; unconfirmed here].
- An HF licence tag is set by whoever uploads. It shows what the uploader believes, not a grant from Samsung.

**Other open-source apps that ship LaMa:**
- **IOPaint / lama-cleaner** (`Sanster/IOPaint`) [read]:
  - `LICENSE`: Apache License 2.0.
  - It downloads `big-lama.pt` from its author's own GitHub release
    (`https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt`, MD5
    `e3aa4aaa15225a33ec84f9f4bc47e500`; 205,669,692 bytes [measured]) in `iopaint/model/lama.py`.
  - Its README has **no licence statement for the weights** (grep: none). Its model page (iopaint.com) was blocked
    **[unconfirmed]**.
  - It also ships MI-GAN the same way (`migan/migan_traced.pt`).
- **simple-lama-inpainting**: `LICENSE` Apache-2.0; its README has no weights statement [read].
- **inpaint-web** (GPL-3.0) ships **MI-GAN**, not LaMa (`src/adapters/inpainting.ts`) [read].
- So the open-source apps checked all ship LaMa **under the code's Apache-2.0 and say nothing more**. None was found
  that cites a separate grant from the authors.

### 2.2 Options

| Option | What it means | Upside | Downside |
|---|---|---|---|
| **1. Exclude LaMa** | MI-GAN only for fill and Remove; patch-based Remove stays the zero-download default | Cleanest; no open question | Weaker large-hole and structure fills (README claims LaMa is strong on "periodic structures") |
| **2. MI-GAN now, Moebius later** as the "best quality" option | Moebius's README explicitly licenses the weights (Apache-2.0) and their outputs for commercial use | Clearest licence text of all the inpainting models | ~1.24 GB, WebGPU only, diffusion steps; VAE licence and training data **[unconfirmed]**; generative (can invent objects) |
| **3. Treat the repo's Apache-2.0 as covering the weights** | What IOPaint and the HF mirrors do in practice | Practical; widely done | Rests on an inference; no statement from Samsung; the HF tags are third-party |
| **4. Ask the authors first** (then 3 or 1) | Short public issue on `advimman/lama` or an email to the corresponding author | A written answer settles it either way | May get no reply (the repo's own download links have rotted); Samsung may need to answer, not the researchers |

### 2.3 What to ask the LaMa authors (draft for the owner to adapt)

> **Title:** Licence of the released LaMa / Big-LaMa checkpoints
>
> Hello, and thank you for LaMa. I maintain LightBench, a GPL-3.0 photo editor that runs entirely in the browser (photos
> never leave the user's device). We would like to offer Big-LaMa as an optional download for inpainting.
>
> The repository's LICENSE is Apache-2.0 (Copyright 2021 Samsung Research), but the README doesn't say which licence
> the pretrained checkpoints are under. Could you confirm:
> 1. Are the released checkpoints (`big-lama` and the other Places / CelebA-HQ models in the Google Drive folder)
>    covered by the same Apache-2.0 licence as the code?
> 2. Is `huggingface.co/smartywu/big-lama` an official copy?
> 3. May we redistribute a converted copy (ONNX, possibly fp16) with SHA-256 pinning, and what attribution would you
>    like (paper citation, "Samsung Research" copyright line, both)?
>
> If a clarifying line could go into the README, other projects would benefit too. Thank you!

Opening an issue gives a public answer others can cite. For legal weight, the owner may prefer an answer from Samsung
Research as the named licensor. Whom to contact there is **[unconfirmed]**.

---

## 3. The RawNIND author question

**Facts** [read]:
- `trougnouf/rawnind_jddc`: `LICENSE` is GPL-3.0. Under "Pre-trained models", the README links a Google Drive folder
  and says "The weights are dual licensed GPL3 + CC-BY-4.0".
- Paper: Benoit Brummer and Christophe De Vleeschouwer, "Learning Joint Denoising, Demosaicing, and Compression from
  the Raw Natural Image Noise Dataset", arXiv 2501.08924.
- darktable-ai's card (`models/rawdenoise-nind/README.md`): "License: GPL-3.0"; training data "CC BY 4.0 / CC0
  (per-image, Wikimedia Commons)".
- darktable-ai's README requires weights under "a license compatible with GPL-3.0 (e.g. Apache-2.0, MIT, BSD,
  GPL-3.0)".

**Where to send:** an issue on `github.com/trougnouf/rawnind_jddc` gives a public, citable answer. Email (from the
paper) is the alternative.

**Draft message (the owner sends it):**

> **Title:** Question about the RawNIND weights licence (GPL3 + CC-BY-4.0)
>
> Hello Benoit,
>
> Thank you for RawNIND and the UtNet2 models. I'm the maintainer of LightBench, a free, GPL-3.0 photo editor that runs
> in the browser; all processing stays on the user's device. We'd like to offer your raw denoiser as an optional
> download, using the ONNX models darktable-ai packages (`rawdenoise-nind`, Bayer and linear Rec.2020).
>
> The README says "The weights are dual licensed GPL3 + CC-BY-4.0". Could you clarify two things?
>
> 1. Does that mean a user may choose **either** licence, so the weights can be used under CC-BY-4.0 alone? And does it
>    apply to both the Bayer and the linear checkpoints that darktable-ai converted to ONNX?
> 2. What attribution would you like when the model is used (names, paper link, dataset DOI, wording)?
>
> If it's easy, a line in the README spelling this out would help other projects as well.
>
> Thank you for your work and for releasing the dataset openly.
>
> Shawn Burke, LightBench

Optional third question, if the owner wants NIND (`denoise-nind`) as well: "Do the NIND (nind-denoise) weights carry
the same terms?" The `nind-denoise` repo is GPL-3.0; its weights statement was not checked.

---

## 4. Runtime choice

### 4.1 Package facts (npm, 2026-10-13) [measured]

| | onnxruntime-web | @huggingface/transformers (transformers.js) | Hand-written WGSL |
|---|---|---|---|
| Version | **1.30.0** (latest; `dev` 1.31.0-dev.20260918) | **4.3.1** | — |
| Licence | **MIT** (npm field; repo LICENSE "Copyright (c) Microsoft Corporation"); **no LICENSE file in the tarball**; repo has `ThirdPartyNotices.txt` | **Apache-2.0** (LICENSE in tarball) | LightBench's own (GPL-3.0-or-later) |
| What the browser downloads | WebGPU entry `ort.webgpu.min.mjs` 66,349 B (20,610 gz) + **`ort-wasm-simd-threaded.asyncify.wasm` 26,781,914 B (6,578,721 gz)**. The default entry `ort.bundle.min.mjs` uses the JSEP wasm, 28,312,028 B (6,623,433 gz). CPU-only wasm: 14,239,897 B (3,659,955 gz) | `transformers.web.min.js` 454,425 B (127,557 gz) **plus** ORT (it imports `onnxruntime-web/webgpu`) | 0 extra (shaders in the app bundle) |
| ORT version used | as chosen | **depends on `onnxruntime-web` "1.31.0-dev.20260914-8d85527a0"**, a dev build | — |
| Defaults that break "local only" | none (wasm path configurable) | `remoteHost: "https://huggingface.co/"`, `allowRemoteModels: true`; if `wasmPaths` is unset, loads ORT wasm from `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/` (`.asyncify` variant). All overridable (`env.backends.onnx.wasm.wasmPaths`, `allowRemoteModels`, `localModelPath`, `useCustomCache`/`customCache`, custom `fetch`) | — |
| Model support relevant here | any ONNX graph | model classes and pre/post-processing for `sam2` (`Sam2Model`, `Sam2Processor`), `depth_anything`, `birefnet` [read, 4.3.1 source]; **no inpainting models** and no raw denoiser [draft] | whatever is written |
| GPU device | can **use LightBench's own `GPUDevice`**: `env.webgpu.device` "Set a value before the first WebGPU inference session is created" (`js/common/lib/env.ts`, v1.30.0) [read]; GPU-resident tensors via `Tensor.fromGpuBuffer` / `fromTexture` and `preferredOutputLocation` [read] | through ORT | the engine's own device |

**Threads:** both ORT wasm builds are `simd-threaded`. LightBench is already cross-origin isolated (service worker
COOP/COEP), which wasm threads need.

**Two WebGPU paths in ORT 1.30** [measured]:
- `onnxruntime-web/webgpu` (`ort.webgpu.mjs`) loads `ort-wasm-simd-threaded.asyncify.wasm`. That is the native C++
  WebGPU execution provider (`onnxruntime/core/providers/webgpu/`).
- The default entry `ort.mjs` / `ort.all.mjs` loads the JSEP wasm (the JavaScript WebGPU kernels).
- transformers.js 4.3.1 uses the `asyncify` path.

### 4.2 Operator coverage for these models

- **Two operator lists, and they differ.**
  - The npm package's `docs/webgpu-operators.md` lists the JSEP kernels [read].
  - The native EP's kernels are registered in `webgpu_execution_provider.cc` (v1.30.0) [read].
  - Notable: the native EP registers `DFT` (17–19, 20+), `TopK`, and binary `Max`/`Min`/`PRelu` ("All binary
    elementwise ops (Add, Sub, Mul, Div, Max, Min, Equal, Greater, Less, GreaterOrEqual, LessOrEqual, Pow, PRelu, And)"),
    plus `GridSample`, `Einsum`, `LayerNormalization`, `Resize`, `DepthToSpace`, `LeakyRelu`, `Erf` and `Gelu`.
  - The JSEP list has `DFT` (17–19, 20+), `GridSample` (16–19), `Einsum`, `Resize` (with "align_corners is not
    supported with downsampling"), `DepthToSpace` and `LeakyRelu`. It lacks `Max`, `Min`, `PRelu` and `TopK` as
    elementwise kernels.
  - **Neither list has variadic `Sum`.**
- **Unsupported ops fall back to the CPU (wasm) kernels** [Cowork]. ORT's own guidance on this was not re-read.

| Model | Facts | Risk |
|---|---|---|
| MI-GAN pipeline | inpaint-web runs `migan_pipeline_v2.onnx` with `executionProviders: ['webgpu' or 'wasm']` [draft]. The pipeline includes crop/resize pre- and post-processing with dynamic H×W [read, MI-GAN README] | Pre/post ops may run on CPU; graph capture needs static shapes [Cowork]. Could export the fixed-512 core only |
| LaMa | Fourier convolutions → `DFT`, present in both lists. Whether the Carve export uses `DFT` or another FFT form: **[unconfirmed]** | Medium |
| SAM 2.1 Tiny | transformers.js has `Sam2Model`; next-sam (MIT) runs SAM 2 Tiny on ORT WebGPU [draft, AI_MODELS.md] | Low |
| DA2-Small | official transformers.js WebGPU demo [draft] | Low |
| BiRefNet_lite | "MaxStorageBuffersPerShaderStage (16) exceeded. Created 33 bindings", and CPU fallback of variadic `Sum` causing `std::bad_alloc`, both fixed by graph surgery [Cowork]. LightBench's own device caps `maxStorageBuffersPerShaderStage` at 10 (`develop-engine.ts`) [read], which matters if ORT shares it | High without the rewritten graph |
| RawNIND UtNet2 | Plain conv U-Net, `LeakyReLU`, PixelShuffle head (→ `DepthToSpace`), opset 20, static 512×512 [read, darktable-ai card] | Low |

### 4.3 fp16 on WebGPU

- **Coverage of `shader-f16`:** 93.95 % overall, Linux 73.53 % (web3dsurvey) [Cowork; unconfirmed here]. ORT requests
  `shader-f16` "if available" [draft]. ORT README: "Float16 support requires Chrome v121 or later, and Edge v122 or
  later" [read].
- **Overflow:**
  - ORT issue #26732, "fp16 and q4f16 Gemma 3 models produce invalid outputs on WebGPU due to overflow … Once it
    saturates, NaN propagates", fixed model-side with Clip nodes [Cowork; issue not readable here].
  - darktable pins the RawNIND Bayer model to the CPU on CoreML because "its intermediate activations overflow FP16"
    (`docs/research/DETAIL_DENOISE_SHARPEN.md`).
- **What follows** [analysis]:
  - Feed the models tone-mapped [0, 1] data, as both reports suggest.
  - Keep an **fp32 variant** of every model, both for adapters without `shader-f16` and for overflow cases. That doubles
    the hosted bytes but not the user's download.
  - Whether ORT can run an fp16 graph on an adapter without `shader-f16` is **[unconfirmed]**.
  - For RawNIND (scene-linear input), test fp32 first.
  - LightBench's own device doesn't request `shader-f16` today (`develop-engine.ts`, `requestDevice`). To share the
    device with ORT, request it, and the adapter's buffer limits, when available.
- **Browser support table:** ORT's README table marks WebGPU ❌ for Safari (macOS, iOS) and Firefox [read]. That table
  may predate Safari 26's WebGPU **[unconfirmed]**. Test Safari before promising it.

### 4.4 The three options side by side

| | ORT-web directly | transformers.js | Hand-written WGSL |
|---|---|---|---|
| Extra download | ≈ 6.6 MB gzip (26.8 MB raw), once, cached | ORT (a dev build) + 0.13 MB gzip | none |
| Covers | all models here | SAM 2.1, DA2, BiRefNet (with processors); not MI-GAN, LaMa, RawNIND | realistic for MI-GAN (5.9 M params, convs) and RawNIND (plain U-Net); a big job for SAM 2 (Hiera), DA2 (ViT-S), BiRefNet (Swin-T) |
| Local-only by default | yes | no: must override the HF host and the jsDelivr wasm | yes |
| Reproducibility across updates | pin the ORT version; kernel changes can shift results | as ORT, and also tied to a dev ORT | fully under LightBench's control (fits the process-version rule) |
| Integration with the GPU engine | can share the `GPUDevice` and pass GPU buffers | via ORT | native: textures in, textures out |
| Licence | MIT, plus ORT's third-party notices | Apache-2.0 (+ ORT) | GPL-3.0-or-later (own) |
| Main risk | CPU fallbacks; fp16 overflow; wasm size | two runtimes or version skew; remote defaults | effort and correctness testing |

**A possible split, for the owner to decide** [analysis]:
- ORT-web (pinned, wasm self-hosted on Pages, lazily cached) for SAM 2.1, DA2 and BiRefNet_lite, plus LaMa if allowed;
- transformers.js only as a reference for pre/post-processing during development;
- MI-GAN and RawNIND in WGSL later, if ORT's size or speed is a problem for the tools that need only them.

---

## 5. Open questions for the owner

1. **Hosting split.** Pages for the defaults (option A or B) and Hugging Face for optional large models (C)? Or
   everything on HF, to keep the 100 GB/month Pages budget for the app itself?
2. **A LightBench Hugging Face account/repo** for pinned copies, or point at upstream repos (pinned commit + SHA-256)?
3. **Git or build-time fetch** for Pages models: commit files < 100 MiB to git (A), or keep them as Release assets that
   the deploy job copies in (B)?
4. **Consent wording:** one dialog per model (LightCraft's pattern), or one "AI models" consent per tool? Show the
   training-data caveats (SA-1B, DIS5K, Places) in the dialog, or only in Settings?
5. **Storage:** Cache Storage (as Lensfun) or OPFS for models? Allow downloads in private windows (lost when the window
   closes)?
6. **LaMa:** exclude, use MI-GAN only (+ Moebius later), accept the repo's Apache-2.0 as covering the weights, or ask
   the authors first (§2.3)?
7. **RawNIND:** send the §3 message? If the answer is "either licence", use it under CC-BY-4.0. If not, the
   GPL-3.0-weights decision is still pending.
8. **Runtime:** ORT-web directly, transformers.js, or WGSL for the small models (§4.4)? Pin which ORT version?
9. **fp16 policy:** fp16 by default with an fp32 fallback (twice the hosted files), or fp32 only for the first release?
10. **Safari/Firefox:** require WebGPU for AI tools, or offer a slow wasm fallback?

---

## For Cowork verification

Items this machine couldn't reach or only inferred. Please check at the source and quote:

1. **Hugging Face CORS:**
   - does `https://huggingface.co/<repo>/resolve/<commit>/<file>` answer a browser `fetch` with
     `Access-Control-Allow-Origin` on both the 302 and the final CDN/Xet response?
   - is `Content-Length` exposed?
   - does a `Range` request fail its preflight (the Jan 2026 forum report)?
2. **HF terms of service:** anything on hot-linking model files from a public web app, and on rate limits for
   anonymous resolver requests (the hub-docs figure: 3,000 per 5 minutes per IP).
3. **HF file sizes and licence tags:**
   - `andraniksargsyan/migan` (`migan_pipeline_v2.onnx` 28.1 MB?, "mit");
   - `onnx-community/sam2.1-hiera-tiny-ONNX` (encoder fp16 67 MB, decoder fp16 10.5 MB?);
   - `onnx-community/BiRefNet_lite-ONNX` (fp16 115 MB?, "mit");
   - `onnx-community/depth-anything-v2-small` (fp16 and fp32 sizes, licence tag);
   - `Carve/LaMa-ONNX` (208,044,816 bytes, apache-2.0, ops used: `DFT`?);
   - `smartywu/big-lama` (who is the uploader? licence tag);
   - `hustvl/Moebius` and `hustvl/PixelHacker` (licence tags; VAE origin).
4. **GitHub Pages per-file limit** for files in an Actions-built artifact (e.g. a 115–210 MB `.onnx`). Does Pages serve
   it, and with which `Content-Type` and compression?
5. **The GitHub LFS note** "cannot be used with GitHub Pages sites": does it also apply when an Actions workflow checks
   out LFS files into the Pages artifact?
6. **The LaMa repo issues:** any maintainer answer on the checkpoint licence (search `advimman/lama` issues for
   "license", "weights", "commercial").
7. **The IOPaint docs page** `iopaint.com/models/erase/lama`: any licence statement for Big-LaMa?
8. **ORT issue #26732** (fp16 overflow on WebGPU): status, and whether a runtime fix landed by 1.30.
9. **ORT behaviour without `shader-f16`:** does an fp16 ONNX graph run (upcast) or fail on such adapters?
10. **WebKit storage policy** (webkit.org/blog/14403): confirm the Safari quotas and the 7-day proactive eviction for
    Home Screen web apps vs Safari tabs.
11. **Safari 26 / Firefox WebGPU with ORT-web 1.30:** does either run the native WebGPU EP? The README table says no.
12. **A browser test of the curl results:** a `fetch()` from LightBench's origin to `raw.githubusercontent.com`
    (simple GET, works?) and to a GitHub release asset (blocked?), with COEP `require-corp` active.
13. **RawNIND:** the NIND (`trougnouf/nind-denoise`) weights statement, and whether the Google Drive checkpoints are the
    ones darktable-ai converted (the card names
    `DenoiserTrainingBayerToProfiledRGB_4ch_2024-02-21-…` iter 4350000 and the linear one, iter 3900000).
