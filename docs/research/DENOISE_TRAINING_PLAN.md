# LightBench's own AI raw denoiser: data, model, training, evaluation, integration

**Prepared for:** Shawn Burke (LightBench) · **Date:** 2026-10-13 · **Status:** plan and draft scripts only. Nothing
was trained, no dataset was downloaded, and no file in the repository was changed.

> **Owner's decision (2026-10-13): RawNIND first, then decide.** Integrate RawNIND (darktable-ai's UtNet2, GPL-3.0)
> as the opt-in AI Denoise in Phase 4. Measure its quality against LightBench's profiled denoise, and its speed and size
> in the browser, on the owner's photos. Train our own model only if RawNIND falls short on browser speed or size, or
> on the owner's cameras, and then start by fine-tuning on the owner's photos rather than training from scratch.
> Reasoning: our model would train on the same RawNIND data with a smaller network, so it is unlikely to beat
> RawNIND's quality. Its likely gains are size and speed (about 9 MB and about 1.8× fewer operations per photo,
> calculated, not measured), fit to LightBench's pipeline, and the owner's own cameras. The licence gain is small,
> because LightBench is GPL-3.0. This plan and `training/denoise/` stay on the shelf until then.

**Builds on:** `docs/research/IMPROVEMENTS.md` §2 (row A1 and the compute basis in §2.0),
`docs/research/PHASE4_MODELS.md` §5 (and the owner's decision accepting RawNIND under GPL-3.0),
`docs/research/PHASE4_GROUNDWORK.md` (hosting, consent download, runtime), `docs/research/DETAIL_DENOISE_SHARPEN.md`
§5–6, its Cowork counterpart, and `docs/PHASE3.md` Part 13 (the Detail panel as merged in 0.5.4).

**Tags used**
- **[read]**: read at the primary source today (GitHub raw files and clones; commits named in §10).
- **[code-read]**: what the code does, read from source; not run.
- **[doc]**: taken from the LightBench research docs above; not re-checked.
- **[search summary]**: a web-search summary; the page itself was blocked.
- **[unconfirmed]**: could not be checked from here. dataverse.uclouvain.be, arxiv.org, huggingface.co,
  download.pytorch.org, commons.wikimedia.org, raw.pixls.us and the SIDD site were all unreachable (DNS or proxy).
- **[estimate]**: arithmetic with its basis stated. Not a measurement.
- **[tested-synthetic]**: the draft code ran on synthetic numpy arrays, not on real data.
- Nothing here is legal advice.

---

## 0. Summary

1. **Data.**
   - **RawNIND** (UCLouvain Dataverse, `doi:10.14428/DVN/DEQCIM`) is the core: real noisy/clean raw pairs, Bayer and
     X-Trans [read].
   - Its licence on Dataverse, its total size and its exact file count **could not be read** (the site was
     unreachable). darktable-ai's card says "CC BY 4.0 / CC0 (per-image, Wikimedia Commons)" [read, secondary].
     `prepare_data.py list` prints the real licence fields and byte total from the Dataverse API before anything is
     downloaded.
   - The noise model for synthetic data and conditioning is **fitted from RawNIND itself**. darktable's GPL profile
     file stays out of training and is used only at inference, inside LightBench.
2. **Model.** A plain 4-level U-Net on **packed Bayer** (RGGB, 4 channels), **conditioned on a Poisson–Gaussian
   noise map** (var = a·x + b), predicting a residual.
   - It runs **before white balance, highlight reconstruction and demosaic**, so LightBench's darktable pipeline is
     unchanged after it.
   - Width 24: **4.37 M params, 8.7 MB fp16, 29.7 GMAC per sensor MP** (counted analytically).
   - It uses only ops that onnxruntime-web's WebGPU EP lists (checked in ORT v1.30.0 source [read]).
   - Hand-written WGSL is the speed path later.
3. **Training on the owner's GPU.**
   - bf16 AMP; 512×512-photosite crops; batch 16 to start (memory ≈ 1–1.5 GB [estimate]; `--find-batch` measures it).
   - **≈ 5–20 h per 4 M-crop run at width 24** [estimate, basis in §3.3]; about 2× that at width 32.
   - Checkpoints every 20 min with automatic resume.
   - Cloud fallback: **≈ 1–3 A100-hours per run** [estimate].
4. **Evaluation** on the RawNIND authors' 10 held-out Bayer scenes. Metrics: linear PSNR, sqrt-domain PSNR and
   SSIM, plus detail retention/correlation and flat-area noise. Methods: none, darktable profiled (LightBench's),
   RawNIND UtNet2, ours. Also blind 100 % crops of the owner's high-ISO photos.
5. **Integration.**
   - An **"AI Denoise" switch + Amount** in the Detail panel's Noise Reduction section, computed once per photo and
     cached.
   - The model is a consent-gated, SHA-256-pinned download (≈ 9 MB fp16 + 17 MB fp32 fallback).
   - No process version while it is an opt-in option. One is needed only if it ever becomes a default.
6. **Licence.**
   - If the Dataverse licence is CC BY 4.0 / CC0 as reported, the weights can carry a licence of the owner's choice
     (MIT or Apache-2.0 suggested), with RawNIND credited.
   - Hard rule: **no initialisation from, or distillation of, RawNIND's GPL weights.**

---

## 1. Data

### 1.1 RawNIND (the core)

| Item | Finding | Status |
|---|---|---|
| Host | UCLouvain Dataverse, `https://dataverse.uclouvain.be/dataset.xhtml?persistentId=doi:10.14428/DVN/DEQCIM`. The authors' bulk download is the Dataverse API: `…/api/datasets/:persistentId/?persistentId=doi:10.14428/DVN/DEQCIM`, then `…/api/access/datafile/<id>` per file | [read] `rawnind_jddc` README and `datasets/RawNIND/dl_ds.sh` (commit `e80fb7b`) |
| Paper | Brummer & De Vleeschouwer, "Learning Joint Denoising, Demosaicing, and Compression from the Raw Natural Image Noise Dataset", arXiv 2501.08924 | [read] README citation |
| Dataset licence | darktable-ai's `rawdenoise-nind` card: "Training data license: CC BY 4.0 / CC0 (per-image, Wikimedia Commons)". **Caution:** that wording ("Wikimedia Commons") matches the older NIND (sRGB) dataset, which *is* on Commons. RawNIND itself is on Dataverse, and its licence field there was **not read**. Dataverse installations often default to CC0, but the depositor can choose [search summary, general] | **[unconfirmed]**: `prepare_data.py list` prints `licence_field` and `terms_of_use` from the API |
| Weights licence (theirs, for context) | "The weights are dual licensed GPL3 + CC-BY-4.0" | [read] README |
| File naming | `Bayer_<scene>_GT_ISO100_sha1=<40 hex>.cr2` (clean) and `Bayer_<scene>_ISO3200_sha1=….cr2` (noisy). The SHA-1 is in the name, which `verify` checks | [read] `organize_files.sh`, `datasets/RawNIND/xmp/*` |
| Bayer vs X-Trans | Both: `src/<Bayer or X-Trans>/<SET>/[gt/]`. X-Trans files are demosaiced with darktable-cli into linear Rec.2020 EXR for the authors' "linear" model | [read] `src/rawnind/README.md`, `tools/xtrans_to_openexr_dataset.py` |
| Cameras | Test-reserve comments name Canon EOS 7D, 6D, D60, "C500D" (500D), Panasonic DMC-GH1 and Sony A7C (several scenes); a separate "Bostitch" set is Canon EOS M100, "not included in general trainings". A search summary of the paper's table adds Nikon Z 6 and D40 and Fujifilm X-T1 and X-T2 (X-Trans), with the Sony ILCE-7C providing most of the data | [read] `config/test_reserve.yaml`; the rest [search summary] |
| darktable noise profiles for those cameras | In LightBench's pinned `noiseprofiles.json` (darktable `ca5a020`): EOS 7D (20 ISOs), 6D (28), D60 (5), 500D (6), M100 (25), ILCE-7C (34), Z 6 (34), D40 (5), X-T1 (16), X-T2 (21). **No profile for the Panasonic DMC-GH1** | [read] counted here |
| Size | **Not known.** A search summary of the paper's table shows column totals of 310 / 562 / 2279 / 2831 with unknown column meanings; one listing says 163 pairs in the test set | **[unconfirmed]**: `summary.json` gives `total_bytes` and file counts |
| Held-out test scenes | Bayer: 7D-2, Vaxt-i-trad, Pen-pile, MuseeL-vases-A7C, D60-1, MuseeL-Saint-Pierre-C500D, TitusToys, boardgames_top, Laura_Lemons_platformer, MuseeL-bluebirds-A7C. X-Trans: ursulines-red, stefantiek, ursulines-building, MuseeL-Bobo, CourtineDeVillersDebris, MuseeL-Bobo-C500D, Pen-pile | [read] `test_reserve.yaml`, `tools/summarize_dataset.py` |
| The authors' clean-clean extra data | `extraraw`: an rsync of raw.pixls.us (they stopped at "approximately 41 GB") plus the author's own photos. The RawNIND recipe takes those raw.pixls.us files without any licence filtering | [read] `src/rawnind/README.md` |
| Their training recipe (reference) | `train_denoise.yaml`: `init_lr 0.0003`, `tot_steps 6000000`, `loss msssim_loss`, `crop_size 256`, `batch_size_noisy 4`, `batch_size_clean 1`, `num_crops_per_image 4`. The released checkpoints are at 4,350,000 (Bayer) and 3,900,000 (linear) iterations | [read] config; checkpoints [read] darktable-ai card |

**Attribution our weights would need** (if Dataverse says CC BY 4.0; CC0 files need none, but list them anyway):
- the creators (Benoit Brummer, Christophe De Vleeschouwer; UCLouvain);
- the dataset title and DOI `10.14428/DVN/DEQCIM` with a link;
- the licence name and link;
- a notice that the data were modified (packed, aligned, cropped, masked);
- the paper citation (courtesy).

Whether CC BY obligations attach to trained weights at all is legally unsettled [doc]. Attributing anyway costs
nothing. If the Dataverse record lists per-file licences, ship a machine-readable list (file, licence, author) next
to the weights. That is the pattern IMPROVEMENTS.md §4 proposes.

### 1.2 NIND (the older sRGB set)

- Wikimedia Commons, `NIND_<scene>_ISO<n>.<jpg|png>`. Sets: X-T1 8-bit JPG and 16-bit PNG, C500D 8-bit, Z6 16-bit,
  "Peter", Contrib. The download script pins `last_update = '2021-05-21'` and checks each file's SHA-1 from the
  Commons API [read: `nind-denoise/src/nind_denoise/tools/dl_ds_1.py`].
- Size: "approximately 30.1 GB" downloaded, "approximately 46.4 GB" after cropping [read: nind-denoise README].
- Licence: per image on Commons, reported as CC BY 4.0 / CC0 [doc, darktable-ai card]; **[unconfirmed]** here.
- **Use for this project:** none for training. The images are processed sRGB, not raw. Note: the brief's "held-out
  NIND scenes" are read here as RawNIND's held-out scenes.

### 1.3 Other raw noise data, by licence

| Dataset | Content | Licence evidence | Verdict |
|---|---|---|---|
| **raw.pixls.us** | Raw samples for most cameras (one or a few frames each, clean-ish, varied ISO) | "Most of the files should be CC0"; legacy files from rawsamples.ch include CC BY-NC-SA, and the maintainers keep a list of them [search summary: pixls.us blog 2017 and discuss.pixls.us]. Site blocked here | **Use only files whose page says CC0**, as extra *clean* frames for synthetic noise. How to read the per-file licence in bulk is **[unconfirmed]** (look for metadata in the rsync tree) |
| **SID** (See-in-the-Dark) | Sony α7S II (Bayer) 25 GB, Fujifilm X-T2 (X-Trans) 52 GB; short- vs long-exposure pairs in extreme low light | README "### License / MIT License." [read]. It does not say whether that covers the images | **Hold.** Ask the authors whether the data are MIT. Narrow domain, but the only sizeable X-Trans pair set found |
| **SIDD** | Smartphone raw + sRGB pairs | Cowork quoted the SIDD site: "The dataset and the associated code repositories are under the MIT License" [doc]. The related code repo LICENSE is "MIT License, Copyright (c) 2019 Abdelrahman Abdelhamed" [read]. Site blocked here | **Optional, low value**: phone sensors, small pixels, different noise. Use for synthetic-noise fitting checks only, if at all |
| ELD | Raw, low light | "for evaluation purposes only"; noise model withheld for "business license" [doc, Cowork] | **Excluded** |
| MIT-Adobe FiveK | DNGs | Research-only terms [doc, AI_MODELS.md] | **Excluded** |
| RAISE, Zurich RAW-to-RGB, others | Raw photos | Not checked | **[unconfirmed]**; don't use until read |
| **The owner's own photos** | Nikon D5200/D700/D80, Sony α7 II / A6300 and others | The owner's copyright | **Best domain fit.** Clean low-ISO frames for synthesis now. A small RawNIND-style ISO series per body later (§8, Q4) |

### 1.4 Synthetic noise and the noise model

- **What darktable's profiles are.**
  - The profiles in `data/noiseprofiles.json` give `a[3]` and `b[3]` per camera and ISO, so that var = a·x + b per
    R, G, B.
  - The profiling tool converts each shot with `darktable-cli` and a style (`tools/noise/profiling-shot.xmp`) that
    enables `temperature` with coefficients **1, 1, 1** (params `0000803f0000803f0000803f…` decode to 1.0, 1.0,
    1.0), plus colorin and colorout. `basecurve`, `sharpen` and `highlights` are present but disabled. The tool then
    fits var vs mean with gnuplot (`darktable-gen-noiseprofile` lines 149–185) [code-read, darktable `6271f53`].
  - So the profiles describe **demosaiced, un-white-balanced camera RGB on the [0, 1] black–white scale**.
  - The pinned file is GPL-3.0-or-later as part of darktable (`web/noiseprofiles/source.json`) [read].
- **What the model needs** is per-*photosite* variance on the same scale. Demosaic interpolation lowers the variance
  of interpolated values, so darktable's (a, b) and a photosite fit differ by a factor per channel. `prepare_data.py
  calib` measures that factor on RawNIND cameras that have darktable profiles (all except the GH1, §1.1).
- **Training never reads darktable's file.**
  - `prepare_data.py build` fits (a, b) per noisy/clean pair from the data itself (`fit_noise`: binned variance of
    noisy − gain-matched clean vs the clean value; [tested-synthetic]: recovers a = 3.0e-4 within 1 %).
  - Those fits (a) condition the network and (b) drive synthetic noise on clean frames.
  - This keeps a GPL data file out of the weights' provenance. Whether measured numbers in a GPL file would even
    carry copyleft is unsettled; this design sidesteps the question.
- **Synthesis** (`SyntheticCrops`):
  - noisy = x + √(a·x + b)·N(0, 1), with (a, b) drawn from the fitted pool and scaled by a random ISO factor (0.25–4×;
    b scales with its square);
  - the conditioning (a, b) is jittered ±20 % so the model tolerates profile error;
  - real pairs are 70 % of each batch by default (`--p-real`).
- **What Poisson–Gaussian misses**, which only real pairs teach:
  - row/column banding, fixed-pattern noise and hot pixels;
  - black-level drift;
  - in-camera raw noise reduction on some bodies, which spatially correlates the noise.

### 1.5 Pair preparation (`prepare_data.py build`)

1. **Read and pack.**
   - Read the raw with rawpy (LibRaw), subtract the per-site black level and divide by (white − black).
   - **No clamp at 0**: negative values carry the read-noise statistics. LightBench's `prepare` kernel clamps with
     `max(0, …)` [read: `raw-pipeline.wgsl` line 87], so the AI path must take the value before that clamp.
   - Crop to an RGGB phase and pack to [4, H/2, W/2].
2. **Clean frame and alignment.**
   - The clean frame is the scene's lowest-ISO GT.
   - Alignment is an integer shift in *packed* pixels (2 photosites), so the CFA phase is kept. RawNIND is shot on a
     tripod; the authors note they "cannot shift 1px in bayer" [read: `prep_image_dataset.py`].
3. **Gain and mask.**
   - Per-channel gain match.
   - The loss mask drops clipped sites (≥ 0.98) and areas where the 17×17 local mean residual exceeds 4 standard
     errors of the fitted noise (moved content).
   - Pairs under 50 % valid are dropped.
4. **Fit (a, b)** on the masked pixels.
5. **Splits.** The test set is the authors' test scenes. Validation is about 5 % of the other scenes, chosen by a hash
   of the scene name. The rest is training.
6. **Storage.**
   - float16 `.npy` per frame, memory-mapped by the DataLoader: ≈ 2 bytes × photosites, so **≈ 48 MB per 24 MP frame**.
   - Total ≈ 48 MB × the number of frames [estimate]. The frame count is in `summary.json`. At, say, 2,000 frames
     that is about 96 GB, so a fast SSD is needed.

### 1.6 What to verify before downloading

- `python prepare_data.py list`, then read `summary.json`: `licence_field`, `terms_of_use`, `total_gib`, `by_kind`,
  `test_scenes_found`.
- If the licence is anything other than CC BY 4.0 / CC0 (e.g. any NC or SA term), stop and bring it to the owner.

---

## 2. Where the model sits in LightBench's pipeline

### 2.1 What LightBench does today (0.5.4)

| Step | Where | Source |
|---|---|---|
| Raw prepare (black/white) **and white balance** in one kernel → normalised, white-balanced CFA | Stage A, `raw-pipeline.wgsl` `prepare` (`cfa[i] = v * P.wb[c]`) | [read] |
| Highlight reconstruction (inpaint opposed) on the CFA | Stage A | [read] PHASE1.md |
| Demosaic: RCD (Bayer), Markesteijn (X-Trans) | Stage A | [doc] PHASE1, PHASE3 Part 5 |
| Camera → linear Rec.2020 scene | Stage A | [doc] |
| **denoise (profiled)**, then capture sharpening, on the scene converted back to white-balanced camera RGB | **Detail stage** after Stage A | [read] PHASE3 Part 13 "Where in the pipe", `detail-stage.ts` |

So LightBench's profiled denoise runs **after demosaic**, not before it. The brief's "after rawprepare, before
demosaic" describes where *this* model should go, not where the profiled denoise is.

### 2.2 Decision: v1 is a packed-Bayer → packed-Bayer denoiser, before white balance

**Why this position:**
- **The noise model is exact there.** Photosite noise is independent with variance a·x + b. Demosaic hasn't spread
  it yet (DETAIL_DENOISE_SHARPEN §2.1 [doc]).
- **Everything after it is unchanged.** White balance, inpaint-opposed highlights, RCD and the Detail stage run as
  today, so darktable parity downstream is kept and no other tool changes.
- **The cache survives every Develop edit.** The result depends only on the raw file, the black/white levels and
  the model, not on white balance. That is better than RawNIND's Bayer model in this respect, since it bakes demosaic
  in.
- **It is cheap.** It runs at a quarter of the resolution (§3.2).

**Clipped photosites:** the model's output is replaced by the input wherever the input is at or above the clip
level. Inpaint opposed then sees the same clipping as without AI. Training masks clipped sites out of the loss.

**Rejected for v1, and why** (each one is a v2 ablation):
- **Joint demosaic + denoise (4 → 3 at 2×, RawNIND's Bayer head).** Probably better IQ at extreme ISO, but it
  replaces RCD and conflicts with highlight reconstruction, which LightBench runs on the CFA before demosaic.
- **Linear Rec.2020 3 → 3 at full resolution (RawNIND's linear model).** It costs **≈ 209 GMAC per MP** at width 32
  (counted; the paper reports 220 per a search summary [doc, Cowork]), 4× the Bayer cost.

### 2.3 X-Trans and linear DNG (v2)

- A "linear" variant for X-Trans and phone DNGs sits at the Detail stage input, where profiled denoise is today,
  on white-balanced camera RGB or linear Rec.2020.
- **To keep the cost down:** pack 2×2 → 12 channels at half resolution outside the graph (ORT's JSEP list has no
  `SpaceToDepth` [read]), run the same U-Net, and return with `DepthToSpace` (supported [read]). That brings it back
  to roughly the Bayer cost [estimate].
- **Training inputs** should be demosaiced the way LightBench does it (Markesteijn). The options are a headless
  LightBench dump (Part 13's `lbdump.mjs` pattern) or darktable-cli as the RawNIND authors did. That is a separate data
  job.
- Until then the AI switch is disabled for X-Trans, linear DNG and JPEG, with a one-line reason.

---

## 3. Model

### 3.1 Architecture (`model.py`)

- **Input:**
  - x [N, 4, H, W]: packed RGGB on the black–white scale, not white balanced;
  - a, b [N, 4, 1, 1].
  - Inside the graph: σ = √max(a·x + b, 1e−10) × 16. It is concatenated to x, so the first conv sees 8 channels.
- **Body:** a 4-level U-Net. Each level has two 3×3 conv + LeakyReLU(0.2); max-pool down, 2×2 transposed conv up,
  concatenated skips.
  - This is the RawNIND/UtNet family's shape, written fresh. No GPL code was copied. A U-Net is a generic,
    long-published design.
- **Output:** x + 1×1 conv. The head is zero-initialised, so training starts at the identity. That suits fp16,
  because the network learns a small correction. ExportWrapper clamps the output at ≥ 0.
- **Why not NAFNet blocks:**
  - NAFNet's depthwise convs, LayerNorm and channel attention all exist in ORT's WebGPU list [read], but depthwise
    convs are memory-bound and the "need perf optimization" note applies to Conv generally.
  - The plain-conv U-Net is also the easiest to hand-write in WGSL: five kernels (conv3×3, maxpool, convT 2×2,
    concat as two bindings, leaky ReLU fused).
  - A NAFNet-style variant stays a v2 ablation.

### 3.2 Sizes (counted analytically for this code and checked against UtNet2)

| Width | Params | fp16 / fp32 file | GMAC per sensor MP | TMAC per 24 MP | TMAC per 60 MP |
|---|---|---|---|---|---|
| 16 | 1.94 M | 3.9 / 7.8 MB | 13.3 | 0.32 | 0.80 |
| **24 (default)** | **4.37 M** | **8.7 / 17.5 MB** | **29.7** | **0.71** | **1.78** |
| 32 | 7.76 M | 15.5 / 31.0 MB | 52.6 | 1.26 | 3.15 |
| *RawNIND UtNet2 Bayer (f32, for reference)* | 7.76 M | ~31 MB fp32 | 52.4 | 1.26 | — |

- **Cross-check:** the same counting gives UtNet2 Bayer 52.4 GMAC/MP and 7.76 M params. That agrees with the paper's
  55 GMAC/MP [doc, Cowork reading arXiv Table II] and with darktable-ai's 57.7 MB package for two fp32 models.
- **Size target (< 30 MB fp16):** met by every width.

**Speed target (< 1 s per 24 MP on a mid-range GPU)** [estimate]:
- **Basis:** DETAIL_DENOISE_SHARPEN §5.4 derives ~3–4 TMAC/s for hand-written WGSL fp16 on an Apple M5 Pro, from
  pmndrs/denoiser's published timings. On the same page ORT-web was ~3× slower, so ~1–1.3 TMAC/s.
- **Tiling:** 512×512-packed tiles with 64 overlap add ×1.31 work.
- **Width 24, 24 MP:** 0.93 TMAC → ≈ **0.25–0.3 s WGSL, 0.7–0.9 s ORT** on that class of GPU.
- **Width 32:** ≈ 0.4–0.6 s WGSL, 1.3–1.7 s ORT, which misses 1 s with ORT.
- **Integrated GPUs:** 3–10× slower [doc estimate].
- **60 MP:** × 2.5.
- **What follows:** width 24 is the default. Width 32 earns its place only if it measurably wins on IQ. Width 16
  is the integrated-GPU fallback.
- **Nothing here was measured in a browser.** The first integration task is to time it on the owner's GPU (§5.6).

**GPU memory per tile** [estimate]:
- The largest tensor at width 24 is the level-1 concat: 48 ch × 512² × 2 B = 25 MB in fp16, 50 MB in fp32.
- That is under the 128 MiB `maxStorageBufferBindingSize` the WebGPU spec guarantees [doc].

### 3.3 Runtime choice: onnxruntime-web first, hand-written WGSL second

- **Every op the exported graph uses is supported.** That was checked in ORT **v1.30.0** source [read]:
  - `js/web/docs/webgpu-operators.md` (JSEP) lists Conv, ConvTranspose, MaxPool, LeakyRelu, Concat, Add, Mul, Sub,
    Div, Sqrt, Clip, DepthToSpace;
  - the native EP's `webgpu_execution_provider.cc` registers Conv, ConvTranspose, MaxPool, DepthToSpace, LeakyRelu
    (6–15, 16+), Concat, Sigmoid, Clip, and "All binary elementwise ops (Add, Sub, Mul, Div, Max, Min, …)".
  - `export_onnx.py` fails loudly if any other op appears. `Reshape` is "no GPU kernel" in JSEP and is avoided.
- **Known risk:** pmndrs/denoiser reports "ORT-WebGPU's first Conv miscomputes inputs with more than three channels"
  [doc]. Ours has 8. So **every browser result is checked against the PyTorch reference** on fixed tiles before
  release (a test in LightBench's suite, like Part 13's GPU = CPU checks).
- **Plan:**
  1. **ORT-web**, pinned, wasm self-hosted (≈ 6.6 MB gzip [doc, GROUNDWORK §4.1]), sharing LightBench's `GPUDevice`.
  2. If it is wrong, too slow, or the wasm weight is unwelcome for one small model: a **WGSL runtime** for this
     U-Net. pmndrs/denoiser (MIT) is a reference implementation of exactly this kind of runtime [doc].
- **Long-term fit:** WGSL also fits the process-version policy better, because kernels then change only when
  LightBench changes them [doc, GROUNDWORK §4.4].

### 3.4 fp16 safety

- darktable keeps RawNIND's Bayer ONNX off FP16 on CoreML because "its intermediate activations overflow FP16"
  [read: darktable-ai card].
- **Mitigations here:**
  - inputs on the [0, 1] scale with no gain;
  - a residual output starting at the identity;
  - bf16 training, which has fp32's range and hides overflow, so `export_onnx.py` **audits the largest activation
    per layer on real tiles** and checks that the fp16 graph's output is finite;
  - an **fp32 variant is always shipped** for adapters without `shader-f16` and as the fallback.
- **If the audit exceeds ~1e4:** add a `Clip` before the deepest convs, or fine-tune a few thousand steps with
  `--amp fp16`.

---

## 4. Training on the owner's GPU

### 4.1 Hardware facts

- From the owner's nvidia-smi [doc, IMPROVEMENTS §2.0]: RTX 4000 Ada Generation, 12,282 MiB, driver 597.06, CUDA 13.2,
  **130 W power cap**, Windows WDDM, ~1.3 GB used by the desktop.
- **Is it the laptop part?** Search summaries put the **laptop** part at 7,424 CUDA cores, 12 GB GDDR6 (192-bit,
  432 GB/s) and a vendor-set TGP of 60–175 W. The **desktop** RTX 4000 Ada is 20 GB / 130 W [search summary:
  Notebookcheck, laptopmedia]. 12 GB therefore means the laptop part, and the 130 W cap is that vendor's TGP. Still an
  **inference**.
- **PyTorch 2.14.**
  - It ships CUDA 12.6, 13.0 and 13.2 builds; architectures listed: 8.0, 8.6, 9.0, … [read: pytorch RELEASE.md].
  - Ada is sm_89. It runs the sm_86 binaries under CUDA's same-major forward compatibility (general knowledge;
    **[unconfirmed]** here). The README has a one-line check.
  - The PyPI Windows wheel is CPU-only: 124 MB `torch-2.14.1-cp312-cp312-win_amd64.whl` [read: PyPI JSON]. Install from
    PyTorch's CUDA index instead (README).

### 4.2 Batch and patch size (≈ 10 GB budget)

- **Crop:** 256×256 packed = 512×512 photosites.
  - MS-SSIM needs ≥ 161 px per side [read: nind-denoise README note]; 256 allows it.
  - The receptive field covers the 16× downsampled bottleneck: 16 packed = 32 photosites per bottleneck pixel.
- **Activation memory** [estimate]: about 8 stored tensors per level × channels × pixels × 2 B (bf16), summed over
  levels ≈ 31·width·P bytes.
  - Width 24, P = 65,536: ≈ 50 MB per sample. Width 32: ≈ 65 MB. Plus loss tensors and the cuDNN workspace: ≈ 60–80 MB
    per sample.
  - **Batch 16 ≈ 1–1.5 GB**, and batch 64 should still fit in 10 GB.
- **Start at batch 16** (RawNIND used 4 noisy + 1 clean [read]). Run `train.py --find-batch` to measure. Bigger
  batches mainly help throughput; also try a larger crop (384 packed) instead of a larger batch.
- **Allocator:** PyTorch's `expandable_segments` allocator option is Linux-oriented **[unconfirmed]** for Windows, so
  it isn't used.

### 4.3 Schedule and time

**Budget per run:** 4 M crops = 80 "epochs" of 50,000 random crops.
- Epochs are a bookkeeping unit: crops are random, with replacement.
- 4 M crops cover about 1.0·10¹² photosites. RawNIND's 4.35 M iterations × ~5 crops of 256² photosites ≈ 1.4·10¹²
  (interpretation of their config [code-read; unconfirmed that "crop_size 256" counts output RGB pixels]).
- At, say, 2,000 noisy Bayer frames of 24 MP, one pass of non-overlapping crops is ≈ 180,000 crops, so 4 M crops ≈ 22
  passes [estimate; the frame count is unknown].

**LR schedule:** AdamW 3e-4 (RawNIND's `init_lr` [read]), 2,000 warm-up steps, cosine to 1e-6, EMA 0.999 for
validation and export.

**Loss:** masked L1 on √x (roughly variance-stabilising, so shadows count). Optional `--msssim` term (RawNIND
trains on MS-SSIM [read]).

**Time estimate [estimate].** Basis:
- forward FLOPs per crop = 2 × MAC (§3.2: 118,752 MAC per packed pixel at width 24 × 65,536 pixels); × 3 for
  forward + backward;
- width 24: **46.7 GFLOP per crop**; width 32: **82.7 GFLOP per crop**;
- effective throughput on the laptop Ada with bf16: **4–15 TFLOPS**. This is wider than IMPROVEMENTS' 8–15 because
  24–48-channel convs use tensor cores poorly;
- × 1.5 for data loading, validation, checkpoints and thermal throttling.

| Run | Width 24 | Width 32 |
|---|---|---|
| Pilot, 0.2 M crops | 0.3–1 h | 0.5–1.7 h |
| **Standard, 4 M crops** | **≈ 5–20 h** | **≈ 9–35 h** |
| Long final, 8 M crops | ≈ 10–40 h | ≈ 18–70 h |

- **Day one:** the pilot's `train.csv` (`sec_per_step`) replaces this table with a measurement.
- **Data loading** is the other likely bottleneck on Windows. That is why frames are pre-packed `.npy` memory maps
  and no raw decoding happens in the loop.

**Programme** [estimate]:

| # | Run | Purpose |
|---|---|---|
| 1 | Pilot w24 | Pipeline check |
| 2 | w24 baseline, real + synthetic | |
| 3 | w24, no conditioning | Ablation |
| 4 | w24, real pairs only | Ablation |
| 5 | w16 | Integrated-GPU fallback |
| 6 | w32 | Quality option |
| 7 | Final w24 or w32, 8 M crops | |

That is ≈ 50–150 h of laptop time in total, or 2–6 weeks of evenings and nights.

### 4.4 Checkpoints, resume, logging (`train.py`)

- **Checkpoints:**
  - every `--ckpt-minutes` (default 20), at the end and on Ctrl-C;
  - written to `latest.pt.tmp` and then `os.replace`d, so a crash or power loss never leaves a broken `latest.pt`;
  - the last 3 kept as `ckpt_<step>.pt`.
  - Each holds the model, EMA, optimiser, scaler, step, args and RNG states.
- **Resume:** rerun the identical command and it continues from `latest.pt`. The data seed is offset by the step,
  so a resumed run sees new crops.
- **Logs:**
  - `train.csv` every 200 steps: loss, LR, s/step, GPU temperature, SM clock, power, peak memory;
  - `val.csv`: linear PSNR of the noisy input and of the output per validation tile.

### 4.5 Laptop and Windows notes

- **Thermals.** `GpuMonitor` reads NVML (nvidia-ml-py) or `nvidia-smi`.
  - At ≥ 87 °C (`--max-temp`) it pauses until the GPU is 8 °C cooler.
  - A falling `sm_mhz` at constant temperature in `train.csv` is the throttling signature. Compare the first and
    last hour.
  - Mains power, "Best performance" mode, vendor fan profile, raised rear and clear vents (README §2).
  - Lowering the power limit with `nvidia-smi -pl` is often not permitted on laptops **[unconfirmed]**.
- **Sleep and updates.**
  - `train.py` calls `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` on Windows.
  - The README adds `powercfg` lines and pausing Windows Update. A forced reboot loses at most 20 minutes.
- **DataLoader on Windows.**
  - Workers are spawned, so each re-imports the script. The `if __name__ == "__main__":` guard is present.
  - Datasets hold only paths and open memory-maps lazily; `persistent_workers=True` avoids re-spawning each epoch.
  - Start with 6 workers. `--workers 0` shows real errors.
- **Desktop on the same GPU.** WDDM display duty takes ~1.3 GB plus some time slices. Close WebGPU and video apps.
  Each kernel is short at these sizes, so Windows' GPU-timeout (TDR) shouldn't trigger (general knowledge).
- **No `torch.compile`.** It needs Triton, which PyTorch doesn't ship for Windows **[unconfirmed]** for 2.14.
  `cudnn.benchmark` and channels-last are used instead.

### 4.6 Cloud fallback

- **Effective throughput** for this small conv net on an A100 with bf16: **50–100 TFLOPS** [estimate]. That is
  below IMPROVEMENTS' 100–150, because of the small channel counts.
- **Time per 4 M-crop run:** width 24 ≈ **0.8–1.6 A100-h**; width 32 ≈ 1.4–2.8 A100-h (× 1.5 overhead included).
  The whole programme ≈ **10–25 A100-h**, in line with IMPROVEMENTS [estimate].
- An H100 is "about 2–3×" an A100 [doc, unconfirmed]. For a net this small, data loading will probably limit it
  first.
- **Price:** on-demand A100 80 GB ≈ $1.2–4/h, H100 ≈ $2–7/h across common GPU clouds [**unconfirmed**, from memory,
  not checked today].
  - ≈ **$2–10 per run**, ≈ **$15–100 for the programme**;
  - plus storage and upload of the packed data, ≈ 48 MB per frame (§1.5);
  - check current prices and egress costs before renting.
- **When to rent:** for runs over ~2 days, or when the laptop is needed. The same scripts run on Linux unchanged
  (the Windows-only calls are guarded).

---

## 5. Evaluation (`evaluate.py`)

### 5.1 Test set and protocol

- **Test set:** the RawNIND authors' 10 held-out Bayer scenes (§1.1). They are held out from the authors' training
  as well, so the comparison with their UtNet2 is fair.
- **Validation:** the ~5 % hashed scenes, used for model selection. Test numbers are looked at once per candidate.
- **Common domain:** half-resolution camera RGB (R, mean G, B), not white balanced. It needs no demosaic choice:
  packed outputs map to it directly, full-resolution RGB outputs by 2×2 averaging.

### 5.2 Methods compared

| Method | How |
|---|---|
| none | The noisy frame |
| **profiled (LightBench)** | LightBench's own denoise, rendered headless to linear camera RGB `.npy` (Part 13's `lbdump.mjs`/`dtcompare.sh` tooling did the same against darktable-cli). Two settings: darktable's defaults (L50 C50), and the per-image best of a small grid ("oracle-tuned"), so the classical baseline isn't handicapped |
| **RawNIND UtNet2** | darktable-ai's `model_bayer.onnx`. Tiled at 512 with overlap 64, gain-matched to the input mean as its card prescribes [read], then 2×2-averaged. GPL-3.0 weights, run locally for comparison only |
| **ours** | PyTorch checkpoint, and the exported fp16 ONNX (the same code path, to catch export drift) |

### 5.3 Metrics (all on linear data, inside the pair's loss mask)

- **PSNR (linear).** Highlight-dominated, as the owner asked.
- **PSNR and SSIM after √x.** Shadow-weighted; closer to what is seen after the tone curve.
- **Detail preservation:**
  - **detail retention:** the textured areas' Laplacian energy, output vs clean, in the top 20 % of the clean
    frame's local Laplacian energy. 1 is ideal; below 1 is over-smoothed; above 1 is noise left in or invented
    detail.
  - **detail correlation:** the correlation of the output's and the clean frame's Laplacians there. It separates
    *right* detail from invented or noisy detail.
  - **flat-area noise left:** the residual standard deviation in the flattest 20 %, relative to the noisy frame.
- **Grouping:** reported per scene, ISO and camera, and as means. The interesting range is ISO ≥ 3,200.
- [tested-synthetic]: the tiling and blending code reproduces its input exactly (max error 2e-7), including the 2×
  RawNIND output case.

### 5.4 Visual checks on the owner's photos

- `evaluate.py photos` writes 100 % crops (centre and two quarter points) per method, with (a, b) given on the
  command line (darktable's profile × the `calib` ratio).
- **Material:** the owner's high-ISO series plus the high-ISO test files Part 13 used (1D Mark III ISO 6400, ILCE-6000
  ISO 12800).
- **Blind A/B:** shuffle the crop file names before looking.
- **Checklist:** text and fine print, fabric weave, foliage, hair, star fields (no "swirls" [doc]), smooth skies (no
  blotches), shadow colour noise, RCD maze artefacts after denoise, hot pixels, and tile seams (run twice with a
  shifted tile grid; the difference must be noise-free).

### 5.5 Acceptance criteria (proposal, for the owner to adjust)

1. At ISO ≥ 3,200 on the test scenes: √x-PSNR ≥ oracle-tuned profiled + 1 dB, and detail correlation ≥ profiled.
2. Width 24 within 0.5 dB of RawNIND UtNet2, or better. Being much smaller and conditioned, it may well lose a
   little; the owner decides whether "own licence" outweighs that.
3. fp16 output finite on every test tile, and |fp16 − fp32| below one 12-bit raw step (2.4·10⁻⁴) on average.
4. No visible seams; no invented texture in the blind A/B.
5. Browser (Chrome, WebGPU) output equals PyTorch within the same tolerance, measured on the owner's GPU and on an
   integrated GPU. Time ≤ 1 s per 24 MP on the owner's GPU.

### 5.6 First browser measurement

Before the full integration:
1. A test page loads the fp16 and fp32 ONNX in ORT-web.
2. It runs 35 tiles (24 MP at 512 with 64 overlap) on the owner's laptop GPU and on an integrated GPU.
3. It reports ms per tile and the maximum difference against a PyTorch tile dump.

This replaces §3.2's estimates.

---

## 6. Export and integration

### 6.1 Export (`export_onnx.py`)

- **Graph:** TorchScript exporter (`dynamo=False`), opset 17, fixed tile 512 (packed).
- **Inputs and output:** `x` [1,4,512,512], `a`, `b` [1,4,1,1] → `y` [1,4,512,512]. A static shape lets ORT
  compile once (darktable-ai bakes 512 for the same reason [read]).
- **fp16:** `onnxconverter-common` `convert_float_to_float16(keep_io_types=True)`. The browser passes fp32 tensors,
  and the graph computes in fp16 where `shader-f16` exists.
- **Outputs and checks:**
  - `manifest-entry.json`: bytes and SHA-256 per variant, the input contract, training args and step, the op check
    and the activation peak;
  - op whitelist; ORT-CPU vs PyTorch; fp16 vs fp32; activation audit.

### 6.2 Tiling for 24–60 MP

- **Tile counts:** packed 24 MP ≈ 3000×2000 → 7 × 5 = 35 tiles at stride 448. 60 MP (9504×6336 photosites) → 11 × 7
  = 77 tiles. Overhead ×1.31 [arithmetic].
- **Blending:** separable linear ramps across the 64-px overlap (as in `evaluate.tiled`). darktable-ai's manifest
  says `edge_pad: mirror_cropped` for RawNIND [read]; LightCraft uses tile 512 / overlap 64 for the same model
  [doc, Cowork].
- **Memory:** process tiles in rows into the packed output buffer (24 MP fp16 packed = 48 MB). There is no need to
  hold all tiles at once.

### 6.3 Where it plugs in

- **UI (Detail → Noise Reduction):**
  - an **"AI Denoise"** switch above Luminance/Color, with **Amount 0–100** (default 100) and the model's name;
  - the profiled sliders stay available after it, for residual chroma. Suggested default with AI on: Luminance 0,
    Color 0 (owner's call, §8).
  - This is the Lightroom 14.4 workflow DETAIL_DENOISE_SHARPEN §6 recommends [doc].
- **Engine:**
  1. Split `prepare` so the AI path reads normalised **un-white-balanced, unclamped** photosites.
  2. Pack in WGSL.
  3. Run the model per tile (ORT-web with LightBench's `GPUDevice`, or WGSL).
  4. Unpack, restore clipped sites, blend with Amount: `cfa = mix(orig, ai, amount)`.
  5. Continue with WB × multipliers → inpaint opposed → RCD → Stage A as today.
  - Changing Amount re-runs Stage A, as a white-balance change does, but not the model.
- **Conditioning in the browser:**
  - (a, b) = darktable's profile for the camera and ISO (already matched by `engine/detail/noiseprofiles.ts`) × the
    per-channel calibration ratio from `prepare_data.py calib`, shipped in the model manifest;
  - darktable's R/G/B map to our R/G1/G2/B.
  - Unprofiled cameras get darktable's generic profile (a = 1e-4, b = 0 [read: PHASE3 Part 13]), which may be
    poor → §8 Q6.
- **Cache:**
  - the packed result (fp16, ≈ 48 MB per 24 MP) keyed by the file hash, the model SHA-256 and the black/white levels;
  - in memory for the session, plus an OPFS LRU with a size cap (e.g. 2 GB) → §8 Q7.
  - Fitted previews use the full-resolution result's mips, so AI runs once per photo, in a worker, with a progress
    indicator; the non-AI preview shows meanwhile.
- **Edit record:** `detail.ai = { on, amount, model: "lightbench-rawdenoise@0.1.0", sha256 }`. The history step
  is "AI Denoise (LightBench raw-denoise 0.1)" [doc, IMPROVEMENTS §4].
- **Not available for** X-Trans, linear DNG or JPEG in v1; the switch is disabled with the reason.

### 6.4 Consent-gated download (per GROUNDWORK §1.5)

- A manifest entry (`__AI_MODELS__`) per variant: url, bytes, SHA-256, SPDX licence id, attribution line, training
  data note.
- **First use** opens a dialog with:
  - model name, size (≈ 9 MB fp16; 17 MB fp32 fallback), licence, credit to RawNIND;
  - "Runs on this device. Your photos are never uploaded.";
  - storage location and Delete;
  - buttons: Download / Not now.
- **Download and store:**
  - a plain `fetch` with no Range header;
  - SHA-256 verified before commit (one in-memory copy is fine at 9–17 MB);
  - Cache Storage `ai-models`, never a `lightbench-` prefix, which the service worker deletes;
  - excluded from the precache.
- **Hosting:** both files are far under 100 MiB, so GitHub Pages works: option A (in git) or B (Release asset
  copied in at build time) [doc]. ORT's wasm (≈ 6.6 MB gzip) is lazy-loaded the same way.
- **Settings → AI models** lists it, with its model card and licence.

### 6.5 Process version

- **Adding AI Denoise as an opt-in switch needs no new process version.** The edit's own settings say whether it
  is on, which is Part 13's and the lens corrections' precedent [doc]. Edits without `detail.ai` render byte for
  byte as before; that is a test, as in Part 13.
- **New weights get a new model id.** An edit pins `model` + `sha256`. When a newer model ships, old edits keep
  the old one, which stays downloadable, unless the owner prefers a visible "Update to model 0.2" action (§8).
- **Turning AI on by default** (e.g. above ISO 3,200) or changing the pipeline position **needs a new process
  version**.

---

## 7. Licence of the resulting weights

| Input to training | Licence | Effect on the weights |
|---|---|---|
| RawNIND images | **Read the Dataverse field first** (§1.6). Reported as CC BY 4.0 / CC0 [doc, secondary] | If so: attribution (§1.1). Whether CC BY binds weights is unsettled; attribute anyway. An NC or SA term would change everything → stop and ask |
| raw.pixls.us clean frames (optional) | CC0 files only (per-file check) [search summary] | None; list for provenance |
| The owner's own photos (optional) | The owner's | None |
| Noise model | Our own fits from RawNIND, not darktable's GPL file (§1.4) | None |
| Training code | Written fresh for LightBench (these drafts). Nothing copied from `rawnind_jddc` (GPL-3.0); the U-Net shape is generic | The owner licenses the scripts (MIT, Apache-2.0 or GPL-3.0). Publishing them keeps the model "open" in darktable-ai's / OSAID's sense [read: darktable-ai criteria] |
| RawNIND's GPL weights | Used **only** as an evaluation baseline | **Must not** be used for initialisation, fine-tuning or distillation: that could make our weights a derivative of GPL weights |
| Tools: PyTorch, pytorch-msssim (MIT), onnxruntime (MIT [read: PyPI]), onnxconverter-common (MIT [read]), rawpy / LibRaw, exifread, nvidia-ml-py | Their own licences (rawpy, exifread and nvidia-ml-py not re-checked) | Tools only, not shipped; no effect on the weights |
| Pretrained backbones / perceptual losses | **None.** Trained from scratch; no ImageNet or LPIPS networks | Keeps provenance clean (IMPROVEMENTS' A2 "licence trap" avoided) |

**Suggested weights licence:** Apache-2.0 or MIT, the owner's choice.
- Apache-2.0 adds an express patent grant from the contributor (LightBench itself) [doc, PHASE4_MODELS licence notes].
- Either is compatible with shipping inside GPL-3.0 LightBench (general knowledge; not legal advice).
- CC BY 4.0 for the weights is a third option that mirrors the data.

**Credit to ship** (model card, Settings → About → AI models, `THIRD_PARTY_NOTICES.md`):

> LightBench raw denoiser 0.1 (weights © 2026 LightBench, <licence>). Trained by LightBench on the Raw Natural Image
> Noise Dataset (RawNIND) by Benoit Brummer and Christophe De Vleeschouwer, UCLouvain, doi:10.14428/DVN/DEQCIM,
> used under <licence as stated on Dataverse>; images were packed, aligned and cropped for training. Paper:
> arXiv:2501.08924. [Plus: CC0 raw samples from raw.pixls.us, listed in raw-pixls-files.csv.]

- **Model card fields** (darktable-ai's template [read]): model licence, training data licence and provenance,
  training code (repo + commit), known limitations (Bayer only; trained cameras; Poisson–Gaussian synthesis),
  evaluation table, SHA-256 per file.

---

## 8. Open questions for the owner

1. **Dataset licence gate.** If Dataverse shows anything other than CC BY 4.0 / CC0 for RawNIND, stop or ask the
   authors? (`prepare_data.py list` answers this in a minute on your machine.)
2. **Weights licence:** MIT, Apache-2.0 or CC BY 4.0? Training code under the same licence, or GPL-3.0 like the
   app?
3. **Extra data:** use raw.pixls.us CC0 files as clean frames? Ask the SID authors whether their data are MIT (it
   would give X-Trans pairs)?
4. **Your own pairs:** shoot a small RawNIND-style set (tripod, static scene, 2–3 base-ISO frames plus an ISO series
   to the maximum) on the D5200, D700 and α7 II? About 20 scenes per body would add your sensors to training and
   give an in-domain test.
5. **Compute:** run on the laptop (≈ 5–20 h per run at width 24 [estimate]), or rent A100 time for the final long
   run (≈ $2–10 per run [estimate])?
6. **Unprofiled cameras:** offer AI only when darktable has a profile, or also with the generic profile (likely
   worse), or add a blind noise estimate (more work)?
7. **Cache size:** ≈ 48 MB per 24 MP photo for the AI result. In memory only, or an OPFS cache with a cap (which)?
8. **Defaults with AI on:** set Luminance/Color to 0? Keep capture sharpening at its default after AI? (Raspberry Pi
   notes AI output is "a little soft" [doc].)
9. **Model updates:** pin old edits to their model forever (keep old weights hosted), or offer an explicit "update
   to the new model" step?
10. **Runtime:** accept ORT-web's ≈ 6.6 MB gzip wasm for v1, or go straight to a WGSL runtime for this one model?
11. **Width 32:** ship it as a "quality" option if it beats width 24 by a margin, or keep one model?
12. **X-Trans:** worth a v2 linear/X-Trans variant (your X100F/X-T2/X-T4 test files), given RawNIND's X-Trans set is
    smaller [search summary]?

---

## 9. Step-by-step checklist

1. **Setup:** README §1. Check `torch.cuda.is_available()`, capability (8, 9) and bf16.
2. **Data:** `list` → read the licence → owner OK → download → `verify` → `build` → `profiles` → `calib`.
3. **Pilot:** `--find-batch`, then 0.2 M crops. Check `val.csv`: PSNR must rise. Also check s/step and temperature.
4. **Training:** the w24 baseline, then ablations (no-cond, real-only), then w16 and w32.
5. **Evaluation and export:** `evaluate.py pairs` vs none / profiled / UtNet2, then `export_onnx.py` (op check, fp16
   audit).
6. **Browser:** the first measurement (§5.6), then integration behind a dev flag. Then the consent dialog, manifest
   and Settings page. Then a PHASE doc part with Verified / Speed / Limitations, as Part 13 did.

---

## 10. Sources read for this plan

- **LightBench** (this repository, HEAD `a0f8353`):
  - docs/research/IMPROVEMENTS.md, PHASE4_MODELS.md, PHASE4_GROUNDWORK.md, DETAIL_DENOISE_SHARPEN.md,
    cowork-2026-10-13/DETAIL_DENOISE_SHARPEN.md and INDEX.md;
  - docs/PHASE1.md (pipeline), docs/PHASE3.md Part 13;
  - `web/src/engine/gpu/raw-pipeline.wgsl` (prepare), `web/src/engine/gpu/detail-stage.ts`,
    `web/src/engine/detail/run.ts`;
  - `web/noiseprofiles/source.json` and `noiseprofiles.json` (profiles counted for the RawNIND cameras).
- **trougnouf/rawnind_jddc** `e80fb7b` (2026-07-04):
  - README, src/rawnind/README.md;
  - config/test_reserve.yaml, train_denoise*.yaml;
  - models/raw_denoiser.py (UtNet2, for the size cross-check only);
  - tools/prep_image_dataset.py, libs/rawproc.py (alignment and masks);
  - datasets/RawNIND/dl_ds.sh, organize_files.sh;
  - tools/summarize_dataset.py.
- **trougnouf/nind-denoise** `272428e`: README, tools/dl_ds_1.py.
- **darktable-org/darktable-ai** `f1a46e2`: models/rawdenoise-nind/README.md, models/denoise-nind/README.md,
  darktable_ai/package.py.
- **darktable** `6271f53` (local): `src/iop/denoiseprofile.c` (precondition), `tools/noise/darktable-gen-noiseprofile`,
  `tools/noise/profiling-shot.xmp`.
- **onnxruntime v1.30.0:** `js/web/docs/webgpu-operators.md`, `onnxruntime/core/providers/webgpu/webgpu_execution_provider.cc`.
- **pytorch/pytorch main:** RELEASE.md (CUDA matrix and release dates). **PyPI JSON:** torch 2.14.1 files,
  onnxruntime 1.31.0, onnxconverter-common 1.16.0, pytorch-msssim 1.0.0.
- **cchen156/Learning-to-See-in-the-Dark:** README. **abdokamel/sidd-ground-truth-image-estimation:** LICENSE.
- **Search summaries only:** RawNIND paper contents (cameras, table totals); raw.pixls.us licensing (pixls.us blog
  2017, discuss.pixls.us); RTX 4000 Ada laptop specs (Notebookcheck, laptopmedia).
- **Unreachable:** dataverse.uclouvain.be, arxiv.org, huggingface.co, download.pytorch.org, commons.wikimedia.org,
  raw.pixls.us, the SIDD site, and most paper and review sites.
