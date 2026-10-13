# Detail: capture sharpening and noise reduction (classical and AI)

_Research for the Detail group (Phase 3) and AI denoise (Phase 4). Written 2026-10-13 for the owner's question of the same
day: what is the state of the art in capture sharpening and noise reduction, and what should LightBench use now and
later? No app code was written for this; one scratch experiment was run (section 3.7)._

**How this was researched, and what could not be opened.** darktable's source (commit `6271f53`, 2026-10-11, the
5.8 development branch, at `/home/user/darktable-org/darktable-full`) and its user manual sources
([darktable-org/dtdocs](https://github.com/darktable-org/dtdocs)) were read directly. RawTherapee's source was read
from its `dev` branch on GitHub. Model licences and READMEs were read from each repository's raw files on GitHub and
from PyPI. **Most other web pages could not be opened from this machine**: rawpedia.rawtherapee.com,
rawpedia.pixls.us, docs.darktable.org, arxiv.org, huggingface.co, helpx.adobe.com, dxo.com, discuss.pixls.us and
ipol.im were all blocked or unresolvable. Facts from those sites come from **search-result summaries** and are
marked "(search summary)". Paper references that were not opened are marked "(not opened)". Speed figures are
**published measurements** only where a source is given; everything else is marked **estimate** with its working.

---

## 0. The answers in brief

| Question | Answer |
|---|---|
| **Sharpening method for the Detail panel, now** | **Capture sharpening by Richardson–Lucy deconvolution**: darktable 5.4's *capture sharpen* (in its demosaic module, `src/iop/demosaicing/capture.c`), which is a port of RawTherapee's Capture Sharpening (`rtengine/capturesharpening.cc`, Ingo Weyrich). Both are GPL-3.0. It is run on linear luminance with an automatic radius measured from the raw data, a noise-safe contrast mask, and an optional corner boost. Lightroom's four sliders map onto it cleanly (section 4). Unsharp mask stays only for output sharpening on Export (PHASE3 Part 8). *diffuse or sharpen* is not suitable as the default, because of its cost and its 21 parameters. |
| **Does denoise (profiled) stand?** | **Yes.** Keep darktable's denoise (profiled), wavelets mode with Y0U0V0 colour, using the camera's noise profile. This is what the Detail panel is already building. Nothing classical that LightBench could legally ship beats it on quality per unit of GPU cost. One change is recommended: run the denoise **before** capture sharpening (section 4.2). |
| **Phase 4 AI denoise** | A **"AI Denoise" switch inside the Detail panel** that is computed once per photo in the background and cached, with a live **Amount** slider and before/after. This is how Lightroom Classic has worked since 14.4 (June 2025), when it stopped writing a separate DNG. A linear DNG stays available as an optional export. **Model:** if the owner accepts GPL weights, **RawNIND UtNet2** (the model darktable 5.6 ships). It is RAW-domain and comes in Bayer and linear Rec.2020 variants; the package is about 58 MB in FP32, and it is **estimated** to take about 1 s per 24 MP on a recent discrete GPU. If not, use permissive candidates only (section 6). **No AI sharpening or deblurring** in Phase 4, because the hallucination risk is highest there. |

---

## 1. Summary tables

### 1a. Classical noise reduction

| Method | Domain | Quality (as reported) | Speed / GPU fit | Licence for LightBench | Verdict |
|---|---|---|---|---|---|
| **darktable denoise (profiled), wavelets Y0U0V0** (default) | Linear camera RGB after demosaic, before the colour matrix | Good. Noise is evened out across brightness by a per-camera, per-ISO Poisson–Gaussian profile; luma and chroma are controlled separately | Fast: an edge-aware à-trous wavelet pyramid with an OpenCL path in darktable. GPU-friendly (being ported now) | GPL-3.0 (darktable) | **Keep (default)** |
| darktable denoise (profiled), non-local means | Same | Good on fine detail; "quite resource-intensive" (darktable manual) | Moderate: cost grows with the square of the search radius; OpenCL path exists | GPL-3.0 | Keep as an Advanced mode |
| darktable raw denoise (`rawdenoise`) | CFA, before demosaic | Wavelet threshold per CFA channel, ported from dcraw | CPU only in darktable; would need a new WGSL port | GPL-3.0 | Later, optional (very high ISO) |
| darktable astrophoto denoise (`nlmeans`), surface blur (`bilateral`) | Lab / RGB | darktable's manual steers users to denoise (profiled) instead | Slow (manual) | GPL-3.0 | No |
| RawTherapee Noise Reduction | Gamma-encoded Lab or RGB | Wavelets plus DCT block filtering and median options; noise level estimated per image, not profiled | CPU/FFTW; not GPU-oriented | GPL-3.0 | Ideas only |
| BM3D / CBM3D / BM3D-CFA | RGB / CFA | Classic quality reference among non-learned methods (well known; not re-measured here) | Heavy: block matching plus 3D transforms; GPU ports exist but are complex | **Reference code is "Free for non-commercial use"** (PyPI). Patent status unverified | **Exclude** |
| Non-local Bayes (NL-Bayes) | RGB | Reported close to BM3D (Lebrun et al., not opened) | Heavy: a covariance estimate and inversion per patch group | Paper method; an IPOL implementation exists (licence not checked) | No |
| Guided-filter denoise | Any | Edge-preserving smoothing; weaker than wavelets or NLM for real noise | Very fast (box filters) | Method published; patent status unverified | No (darktable already uses it inside other tools) |

### 1b. Classical capture sharpening

| Method | What it is | Haloes / noise | GPU cost, 24 MP (**estimates**, section 3.8) | Fit with Lightroom's 4 controls | Verdict |
|---|---|---|---|---|---|
| **RL capture sharpening** (darktable 5.4 `capture.c` ← RawTherapee 5.8) | Richardson–Lucy deconvolution of linear luminance with a Gaussian PSF, per-pixel radius (auto + corner boost), contrast mask | Low haloes at the auto radius; amplifies noise (the mask and the denoise run first contain it) | ~15–40 ms on a mid-range discrete GPU (8 iterations) | **Good**: Amount → strength, Radius → PSF radius (auto), Detail → halo limit, Masking → contrast mask | **Use** |
| darktable `sharpen` (USM on Lab L) | Unsharp mask | Haloes at strong settings; boosts low-mid frequencies (section 3.7); darktable's manual says it is "no longer recommended" | ~1–3 ms | Amount, Radius, Masking (threshold); no Detail | Export only (already built) |
| darktable *diffuse or sharpen* ("sharpen demosaicing", "lens deblur") | Multi-scale anisotropic diffusion PDE (heat equation run backwards) | Good when tuned; darktable warns it is "highly resource-intensive" and can degenerate | **~10–100× RL** (16–24 iterations on several wavelet scales of 4 channels) | Poor: 21 parameters, preset-driven | Not as default; maybe a later "Lens deblur" option |
| RawTherapee Sharpening tool (USM or RL on Lab L) | Output/creative sharpening; RL here runs on gamma-encoded L | RL on non-linear data is a known compromise | Like RL above | Amount, Radius, iterations, contrast mask | No (capture sharpening supersedes it) |
| Lightroom Detail (for reference) | Detail 0 = USM with halo suppression, 100 = deconvolution, a blend between (Adobe-adjacent sources, **unverified**) | Proprietary | — | (its own) | Model for the UI only |

### 1c. Commercial AI tools (context)

| Product | What it outputs | Workflow |
|---|---|---|
| Adobe Lightroom Classic Denoise / Raw Details / Super Resolution | Before 14.4: a new **linear (demosaiced) DNG** (`…-Enhanced-NR.dng`). Since **14.4 (June 2025)**: no separate file; a **toggle in the Detail panel**, cached, with an adjustable **Amount** that doesn't recompute (search summary) | Computed once, then a live slider |
| DxO DeepPRIME / XD2s (PhotoLab 8), DeepPRIME 3 / XD3 (PureRAW 5) | PhotoLab: applied at export; the loupe shows a preview. PureRAW: writes a **linear DNG** (support page, search summary) | Separate step (PureRAW) or a setting previewed in a loupe (PhotoLab) |
| Topaz Photo AI | Denoise/sharpen models with strength sliders; RAW and DNG handling **unverified** (search found only old forum posts) | Separate app or plug-in |
| Capture One 16.8 "Enhanced Denoise" | AI denoise, auto-applied to high-ISO files (2026, search summary; whether it has a strength slider is **unverified**) | Built in |
| darktable 5.6 neural restore | Writes **new TIFF files** (denoise, raw denoise, upscale) | Separate step |

### 1d. Open AI models (details in section 5.2)

| Model | Weights licence | Domain | Size (FP32) | Browser fit |
|---|---|---|---|---|
| **RawNIND UtNet2** (Bayer + linear Rec.2020) | **GPL-3.0** | **RAW** / linear | 57.7 MB package (both variants) | Good: plain conv U-Net, ONNX exists (darktable-ai) |
| NAFNet-SIDD width 32 | MIT (repo licence) | sRGB (phone) | 108.4 MB (darktable-ai ONNX) | Good: convs only |
| SCUNet (real, PSNR) | Apache-2.0 (repo); file hosted in KAIR releases (MIT) | sRGB, blind | 72.0 MB | Moderate: Swin attention |
| DRUNet | MIT | sRGB, Gaussian with a noise-level map | 130.6 MB | Good: convs only, heavy |
| Restormer | MIT | sRGB | ~26 M params (not downloaded) | Heavy |
| Uformer | MIT | sRGB | not downloaded | Heavy |
| SwinIR (denoise) | Apache-2.0 | sRGB, Gaussian | not downloaded | Heavy |
| HAT | Apache-2.0 | Super-resolution only | — | Not a denoiser |
| **PMRID** | **Apache-2.0** (weights in the repo) | **RAW** (Bayer, k-sigma) | **4.2 MB** | Excellent: separable convs |
| Raspberry Pi AI_denoise (NAFNet/UNet, Bayer and RGB) | **BSD-2-Clause** (weights in repo) | RAW / RGB | 2–72 MB | Good (TFLite; needs converting) |
| ELD, SID | MIT (code) | RAW (Sony / Fuji low light) | — | Narrow training data |
| LED | **CC BY-NC 4.0** | RAW | — | Excluded |
| CycleISP, MPRNet | **"Academic Public License"** | — | — | Excluded |

---

## 2. Classical noise reduction

### 2.1 The noise model, and why RAW-domain denoising helps

- **Poisson–Gaussian model.** Raw sensor values follow photon (shot) noise, whose variance grows with the signal, plus signal-independent read noise. To first order, the variance is `var(x) = a·x + b`. Foi et al. fit exactly this model per image ("Practical Poissonian-Gaussian noise modeling and fitting for single-image raw-data", IEEE TIP 17(10), 2008, not opened). darktable's noise profiles are this `(a, b)` pair per camera and ISO, for each colour channel (`data/noiseprofiles.json`). For example, the Nikon D5200 at ISO 100 has green `a = 2.88e-6` and `b = −9.45e-8`.
- **Variance stabilisation.** The **generalized Anscombe transform** `f(x) = (2/a)·√(a·x + 3a²/8 + b)` turns Poisson–Gaussian noise into approximately unit-variance Gaussian noise. A Gaussian denoiser can then be used, followed by an *exact unbiased inverse*, so that dark areas don't drift in brightness (Mäkitalo & Foi, "Optimal inversion of the generalized Anscombe transformation for Poisson-Gaussian noise", IEEE TIP 22(1), 2013, not opened). darktable generalises this to `V(X) = a·(E[X] + b)^p` and uses `f(x) = 2(x+b)^(1−p/2) / (√a·(2−p))` (`precondition_v2`, `denoiseprofile.c` around line 985). Its back-transform is a second-order "low bias" correction rather than the plain inverse (the comments at lines 1040 onwards). With `wb_adaptive_anscombe` it divides by the white-balance coefficients first, because white balance scales each channel's noise differently.
- **Why denoising before demosaic helps.** Before demosaic, the noise in each pixel is independent and has a known variance. Demosaic interpolation then spreads each noisy sample into neighbouring pixels and channels. The result is spatially correlated, colour-correlated "blotchy" noise that no longer fits the simple model. Demosaicers also read noise as edges and produce maze or zipper patterns. Google's "Unprocessing images for learned raw denoising" (Brooks et al., CVPR 2019, arXiv 1811.11127, not opened) and the SIDD benchmark (Abdelhamed et al., CVPR 2018, not opened) both report that denoisers working on RAW data beat the same denoisers on processed sRGB. Joint demosaic + denoise is the strongest form; Adobe Denoise and RawNIND's Bayer model work this way.
- **What darktable actually does.** darktable's default denoise (profiled) runs **after** demosaic (pipeline position 11; demosaic is 9), but **before** the input colour matrix and any non-linear step. There the image is still linear camera RGB and the profile is still valid (the darktable manual says the module "is placed before the input color profile module in the pipeline (so that the profile parameters are accurate)"). Its CFA-domain alternative, `rawdenoise` (position 8), is CPU-only and less refined. This compromise works well up to high ISO. Beyond that, demosaic artefacts on noise are the remaining argument for a RAW-domain AI model (section 6).

### 2.2 darktable denoise (profiled)

Read in `src/iop/denoiseprofile.c` (3,813 lines) and the manual page `denoise-profiled.md`:

- **Modes:** `MODE_NLMEANS` (non-local means), `MODE_WAVELETS`, the "auto" version of each, and `MODE_VARIANCE` (a diagnostic). **Default: wavelets** (`$DEFAULT: MODE_WAVELETS`, set again in `reload_defaults`, line 2689) with **Y0U0V0 colour mode** (`MODE_Y0U0V0`, line 2693), separate luminance and chroma curves over the wavelet bands. Other defaults: `strength 1`, `wb_adaptive_anscombe TRUE`, `use_new_vst TRUE`, `central_pixel_weight 0.1`. `radius`, `scattering`, `shadows` and `bias` are derived from the profile's green `a` (`infer_*_from_profile`, lines 2626–2644). For example, `shadows = clamp(0.1 − 0.1·ln a, 0.7, 1.8)`.
- **Profiles:** `data/noiseprofiles.json` has **437 cameras and 8,182 profiles** (not counting duplicate entries marked `skip`). The owner's test cameras are covered: Nikon D5200 (23 ISOs, 100–25,600), D700 (22), Sony ILCE-7M3 (37, 50–204,800). In-between ISOs are interpolated. Unknown cameras fall back to a "generic poissonian" profile (`src/common/noiseprofiles.c:26`). The manual says to contribute profiles to darktable.
- **Cost:** the manual says non-local means "is quite resource-intensive" and that the wavelets mode "is less resource-intensive". In NLM the "search radius" has a cost that "increases with the square of this parameter", while "scattering" widens the search without adding cost.
- **Its status in LightBench:** the parallel Detail work already ports the wavelets/Y0U0V0 OpenCL path to WGSL. It maps Lightroom's Luminance, Detail, Contrast, Color, Detail and Smoothness onto the Y0 and U0V0 band curves (`web/src/engine/detail/settings.ts`, `denoise.ts` in the `lightbench/detail` worktree). This research supports that choice; see 2.7.

### 2.3 darktable's other denoise modules (brief)

| Module | Manual's description | Notes |
|---|---|---|
| raw denoise (`rawdenoise`) | "Perform denoising on raw image data before it is demosaiced. This module has been ported from dcraw." | Wavelet thresholds per CFA channel with coarse-to-fine curves; CPU only (`DARKTABLE_MODULES.md` §1.1). |
| astrophoto denoise (`nlmeans`) | Lab NLM; "slows down pixelpipe processing significantly" | Display-referred Lab. |
| surface blur (`bilateral`) | "bilateral filters are susceptible to overshoots and darktable offers much better alternatives" | — |
| diffuse or sharpen, "denoise" presets | Fine/medium/coarse, 32 iterations each (`diffuse.c` presets at lines 367–440) | Expensive; the manual suggests it as a post-filter after denoise (profiled). |
| neural restore (5.6) | AI denoise / raw denoise / upscale; writes new TIFFs | Section 5. |

### 2.4 RawTherapee noise reduction

`rtengine/FTblockDN.cc` ("CFA denoise by wavelet transform, FT filtering", Emil Martinec, 2008–2012, GPL-3.0). It does wavelet shrinkage plus DCT block filtering (FFTW `REDFT10`) on **gamma-encoded** data (default gamma 1.7; the `gam` handling at lines 633–665), in Lab or RGB, with optional median passes (3×3 to 9×9) and "auto" chroma estimation from the image. It has no per-camera profile. Quality is well regarded for chroma noise, but it is CPU/FFT-oriented and not profiled, so it offers LightBench nothing that denoise (profiled) lacks. Its RawPedia page couldn't be opened.

### 2.5 BM3D and BM3D-CFA: licence and patents

- **Licence (verified):** the reference implementation from Tampere is distributed as `bm3d` on PyPI (version 4.0.3). Its classifier is `License :: Free for non-commercial use`, and its description says **"The package is available for non-commercial use only."** ([pypi.org/project/bm3d](https://pypi.org/project/bm3d/), read via PyPI's JSON API). Tampere's README for BM4D says it is for "nonprofit purposes only" (search summary of [webpages.tuni.fi/foi/GCF-BM3D](https://webpages.tuni.fi/foi/GCF-BM3D/)).
- **Patents (unverified):** a search found no patent assigned to Tampere or Noiseless Imaging naming Dabov or Foi. Third-party patents *cite* BM3D (e.g. US9262808B2). **Patent status is unknown.** A clean-room reimplementation (for example Lebrun's IPOL 2012 implementation, whose licence was not checked) would avoid the code licence, but not any patent.
- **BM3D-CFA** (Danielyan, Vehviläinen, Foi, Katkovnik, Egiazarian, "Cross-color BM3D filtering of noisy raw data", LNLA 2009, not opened) applies BM3D to the mosaic directly. It has the same licence problem and is heavier still.
- **GPU fit:** block matching and per-group 3D transforms are memory- and branch-heavy. Published GPU ports exist (not checked) but are complex. **Excluded:** the reference code can't be used, the patent status is unclear, and the cost is high for a gain over profiled wavelets/NLM that is not demonstrated on real camera noise.

### 2.6 Non-local Bayes and guided filters

- **NL-Bayes** (Lebrun, Buades & Morel, SIAM J. Imaging Sciences 2013; IPOL implementation 2013, neither opened): it estimates a Gaussian model per group of similar patches and applies a Wiener-like estimate. It is reported close to BM3D on synthetic Gaussian noise. Its cost is a covariance estimate and inversion per group (for example 75×75 matrices for 5×5×3 patches), which is awkward on WebGPU. It needs the same VST to handle real noise. **Not worth it over profiled wavelets/NLM.**
- **Guided filter** (He, Sun & Tang, ECCV 2010 / TPAMI 2013; [project page](https://people.csail.mit.edu/kaiming/eccv10/index.html), not opened): an edge-preserving local linear filter made of box filters, so it is very fast on GPU. As a denoiser it is weaker than wavelet shrinkage or NLM for real sensor noise. darktable uses it inside other tools (mask feathering, colour equalizer, tone equalizer's EIGF). A Microsoft patent on the guided filter is sometimes mentioned; a search could not confirm it (**unverified**). This doesn't change anything, because LightBench already ports darktable's uses.

### 2.7 Verdict on denoise (profiled)

**It stands.** It is the only classical option that combines:
1. a camera- and ISO-specific noise model with a variance-stabilising transform (unlike RawTherapee or Lightroom-style unprofiled sliders);
2. separate luma and chroma control in one instance, which fits Lightroom's Luminance and Color controls;
3. a fast, GPU-friendly wavelet default, with NLM available as an Advanced mode;
4. a GPL-3.0 licence and source LightBench already works from.

Two notes for the Detail work:
- **Order.** Run denoise **before** capture sharpening (section 4.2).
- **The high-ISO ceiling** is demosaic artefacts on noise, not the denoiser itself. That ceiling is what Phase 4's RAW-domain AI model is for. `rawdenoise` (CFA wavelets) is a possible later classical option, but it would need a WGSL port written from its CPU code.

---

## 3. Classical capture sharpening

### 3.1 Unsharp mask (darktable `sharpen`)

`src/iop/sharpen.c` (437 lines): separable Gaussian blur of Lab L, `L' = L + amount·(L − blur)`, with a soft threshold. Defaults: radius 2, amount 0.5, threshold 0.5. LightBench already uses it, with a halo limit added, for **output** sharpening on Export (PHASE3 Part 8). darktable's own manual now says: *"The USM algorithm used in this module performs blurs in Lab color space, which can produce undesirable effects, and is no longer recommended."* (`dtdocs/.../sharpen.md`). USM increases *acutance* with a fixed-shape filter; it doesn't invert the actual blur (section 3.7).

### 3.2 darktable *diffuse or sharpen*

`src/iop/diffuse.c` runs an anisotropic, multi-scale heat-equation solver on wavelet scales, with 21 parameters. All defaults are zero; its behaviour comes from presets (`init_presets`, lines 235 onwards):

| Preset | Iterations | Radius | Speeds (1st–4th order) | Regularisation | Variance threshold |
|---|---|---|---|---|---|
| sharpen demosaicing, no AA filter (line 492) | 1 | 4 | −0.25 ×4 | 1 | 0 |
| sharpen demosaicing, AA filter (line 518) | 1 | 8 | −0.25 ×4 | 1 | 0 |
| lens deblur, soft / medium / hard (lines 239–313) | 8 / 16 / 24 | 8 / 10 / 12 | anisotropy +1/0/+1/0 | 3 | +1 |
| sharpness, fast / normal / strong (lines 674–750) | 1 / 3 / 6 | 128 / 3 / 3 | — | 0.25 / 2.94 / 2.15 | 0.25 / 0 / 0.22 |

The manual says: *"This module is highly resource-intensive, as it is actually an anisotropic, multiscale, partial differential equation solver … OpenCL is therefore strongly recommended."* For deblurring it advises correcting chromatic aberration and noise first, because *"the deblurring may magnify these artifacts"*. It also says that *"denoising should always happen before any attempt at sharpening or increasing acutance"*. The "sharpen demosaicing" presets are cheap (1 iteration). They act on RGB diffusion rather than a measured PSF, and they must be moved before the input colour profile. **Quality when tuned is high; cost and complexity rule it out as the default Detail method.**

### 3.3 RawTherapee Capture Sharpening, and darktable 5.4's port

**History.** Capture Sharpening was the headline feature of **RawTherapee 5.8 (4 Feb 2020)**. Its release notes say it runs right after demosaicing in linear space, so it is "less prone to haloing", and is meant to pair with post-resize sharpening ([rawtherapee.com/downloads/5.8](https://www.rawtherapee.com/downloads/5.8), search summary). **darktable 5.4** (Dec 2025) added it to the demosaic module ([darktable.org 5.4 announcement](https://www.darktable.org/2025/12/darktable-5.4.0-released/), search summary). darktable's file credits RawTherapee: *"Credits go to: Ingo Weyrich (heckflosse67@gmx.de), he implemented the original algorithm for rawtherapee."* (`src/iop/demosaicing/capture.c:19-20`, copyright 2025–2026 darktable developers, GPL-3.0-or-later).

**The algorithm** (both programs, read in code):
1. **Luminance.** Y is computed from the demosaiced, white-balanced camera RGB (BT.709 weights in darktable's `_prepare_blend`; sRGB→XYZ weights in RawTherapee).
2. **Clip mask.** Pixels near CFA clipping, and a 5×5 neighbourhood around them, are excluded (`CAPTURE_CFACLIP 0.9`; RawTherapee's `buildClipMaskBayer` uses 0.95 of white).
3. **Contrast mask.** A local-variance and luminance analysis against the *contrast threshold* (darktable `_modify_blend`, `capture.c:721`; RawTherapee `buildBlendMask` in `rt_algo.cc:380`) decides where sharpening is safe. It is blurred (σ 2) and combined with the unblurred value so that small edges keep their strength (`capture.c:837`).
4. **Richardson–Lucy iterations** on Y with a Gaussian PSF: `est ← est · G*(Y / G*est)` (darktable `_blur_div` then `_blur_mul`, `capture.c:872`; RawTherapee `CaptureDeconvSharpening`, line 299). The kernels are at most 9×9. darktable picks **a sigma per pixel** from a precomputed table in 0.01 px steps (`_cs_precalc_gauss_idx`). This is how **corner boost** and **sharp centre** enlarge the radius towards the corners and taper it at the image borders.
5. **Blend and colour.** `Y_new = mask·Y_rl + (1 − mask)·Y`. RGB is then multiplied by `Y_new / Y`, so the chroma ratios are unchanged (`capture.c:883`).

**Automatic parameters:**
- **Radius:** estimated from the raw CFA data (`_calcRadiusBayer` / `_calcRadiusXtrans` via `_calc_auto_radius`, `capture.c:408`, from the centre 60 % of the frame and skipping clipped greens), capped at 2.0 in RawTherapee (`maxSigma`).
- **Contrast threshold:** RawTherapee measures it from the image (`autoContrast`). darktable estimates it from ISO and bit depth (`_get_variance_threshold`, lines 49–75): start at 0.4, subtract 0.07 for raws with more than 12 bits, a further 0.01 for 14-bit, and `0.012·(600 − clamp(ISO,100,1000))/100`. Its comment says the default "is safe for ISO < 600".

**Defaults:**
- **RawTherapee** (`rtengine/params/raw.cc:34-45`): off; auto contrast on; auto radius on; contrast 10; radius 0.75; corner offset 0; **20 iterations with "auto-limit iterations" on** (`deconvitercheck`: stops per 32-pixel tile once it converges).
- **darktable** (`demosaic.c:157-169`): off; radius 0.5 (0–1.5); contrast sensitivity 0.4 (0–1); corner boost 0 (0–1.5); **8 iterations** (1–25); sharp centre 0. Turning it on auto-calculates the radius and threshold for unedited images.

**darktable's manual on it** (`dtdocs/.../demosaic.md`):
- *"Capture sharpening recovers details lost due to in-camera or lens blurring, which can be caused by diffraction, the anti-aliasing filter or other sources of gaussian-type blur."*
- *"on modern sensors, using a good lens and a high quality demosaicer, a typical radius will be between 0.5 and 0.8."*
- *"It is generally safe to auto-apply capture sharpening to images with ISO values below 1000."*
- *"leave the iterations setting at its default setting of 8, as this leads to good sharpening with very low risk for artifacts when used with an auto-calculated radius."*
- Its prerequisites are a decent white balance, low chromatic aberration ("there will still likely be more and stronger halo artifacts" otherwise) and acceptable noise ("noise will generally be amplified by capture sharpening").

**When it runs in darktable:** in the full and export pipes, not in the small preview pipe (`run_fast`, `demosaic.c:695, 763`). The full pipe computes it at sensor resolution before any downscale.

**Newer RawTherapee additions (dev branch, 2024–2025, Jacques Desmis):** an optional **pre-denoise before capture sharpening**, using a median or wavelets (`noisecap`, `capturesharpening.cc:620-700`). The comment reads: *"small median to denoise before capture sharpening : allow CS to work correctly and reduce a little the noise"*. This is evidence that its developers found noise *before* RL to be the method's weak point. It supports denoising first (section 4.2).

### 3.4 RawTherapee's other "Sharpening" tool

`rtengine/ipsharpen.cc` (Detail tab). It has a USM (default `method "usm"`, radius 0.5, amount 200, threshold curve, optional halo control and edges-only modes) or **RL deconvolution** (`deconvradius 0.75`, `deconviter 30`, amount 100, damping 0), all on **Lab L**, gated by a contrast mask (`contrast 20`) (`procparams.cc:1262-1281`). Because L is gamma-encoded, its RL is not a true deconvolution of optical blur. A forum answer says the same (search summary, [discuss.pixls.us thread](https://discuss.pixls.us/t/quick-question-on-rt-richardson-lucy-implementation/13614)). Capture Sharpening was added in 5.8 to do the linear version.

### 3.5 Lightroom's Detail sliders: what is known

- **Defaults and ranges:** Amount 40, Radius 1.0, Detail 25, Masking 0 (ranges 0–150, 0.5–3.0, 0–100, 0–100). Source: a third-party tutorial (Digital Camera World) via search summary, not an Adobe page. These match the defaults already used by the Detail work (also from general knowledge).
- **Adobe's own descriptions** ("Retouch photos", Lightroom Classic help, search summary): Radius sets "the size of the details" that sharpening targets. Detail controls "how much high-frequency information gets sharpened … Lower values mainly sharpen edges, while higher values bring out textures". Masking at 0 sharpens everything equally and at 100 limits sharpening "mostly … to the strongest edges".
- **Detail as a USM ↔ deconvolution blend:** **unverified**, and not stated by Adobe in anything found. Forum and educator sources describe it this way: *"At 0 the amount of halo suppression is maximal and no deconvolution sharpening is applied. At 100 the amount of deconvolution sharpening is maximal and no halo suppression is applied"* (Tony Jay, [Lightroom Queen forum](https://www.lightroomqueen.com/community/threads/detail-slider-revisited.30168/), search summary). Fstoppers describes it as a weighted average between unsharp mask (0) and Richardson–Lucy (100) ([fstoppers.com](https://fstoppers.com/education/sharpening-lightroom-make-most-out-detail-panel-202260), search summary). Jeff Schewe (PixelGenius, whose sharpening Adobe bought) is credited with describing it as a continuum from halo suppression to deconvolution, but the quote is not direct. Greg Benz suggests a low Radius with Detail near 100 for deconvolution ([gregbenzphotography.com](https://gregbenzphotography.com/photography-tips/what-is-deconvolution-sharpening-and-how-to-get-increased-detail/), search summary).
- **Takeaway for LightBench:** whatever Adobe does internally, its UI semantics are clear enough to map: Detail low = protect against haloes, Detail high = full deconvolution.

### 3.6 Can lens or camera data give the PSF?

- **Lensfun** stores distortion, transverse CA and vignetting models plus crop factors. It has **no MTF or PSF data**. The camera makers' embedded correction data that LightBench reads (Sony, Fujifilm, Olympus, Panasonic, DNG opcodes) is also geometry, CA and vignetting only. DxO's lab-measured "lens sharpness" profiles are proprietary. **There is no open per-lens blur data to use.**
- **What can be computed** from data LightBench already has:
  - **Diffraction** from the EXIF f-number and the pixel pitch (sensor width from Lensfun's crop factor, divided by the image width). A Gaussian fit to the Airy core has σ ≈ 0.42·λ·N (a standard approximation, from general knowledge). At λ = 0.55 µm this gives:

    | f-number | σ (µm) | Nikon D5200 (3.92 µm) | 24 MP full frame (5.95 µm) | 61 MP full frame (3.76 µm) |
    |---|---|---|---|---|
    | f/5.6 | 1.29 | 0.33 px | 0.22 px | 0.34 px |
    | f/8 | 1.85 | 0.47 px | 0.31 px | 0.49 px |
    | f/11 | 2.54 | 0.65 px | 0.43 px | 0.68 px |
    | f/16 | 3.70 | 0.94 px | 0.62 px | 0.98 px |

  - **Pixel aperture:** a box one pixel wide adds σ ≈ 1/√12 ≈ 0.29 px. Added in quadrature, f/8 on a D5200 gives about 0.55 px before lens aberrations, the AA filter and demosaic. That agrees with darktable's "typical radius … between 0.5 and 0.8". *(LightBench's own arithmetic, not a published calibration.)*
- **Use:** not as the radius itself. The measured **auto radius** (from the raw data) already includes lens, AA filter and demosaic, and it is what RawTherapee and darktable rely on. The diffraction estimate is useful as (a) a **fallback** when auto radius fails (the manual: it "might fail on images with lots of chroma noise"), and (b) a **sanity check**: a small "includes diffraction at f/16" note when the aperture dominates. The AA-filter presence isn't in EXIF; darktable leaves it to the user (its two "sharpen demosaicing" presets).

### 3.7 Scratch experiment: RL vs USM at matched edge sharpness

A Python/NumPy script in this session's scratchpad (`rl_vs_usm.py`; not app code and not committed). A step from 0.05 to 0.40 in scene-linear light, blurred by a Gaussian of σ 0.7 px (a typical capture radius). The same Gaussian blurs small sinusoids to measure how much detail each method restores. White Poisson–Gaussian noise is used to measure noise gain.

**RL** uses darktable's update with the true σ 0.7, on linear Y. **USM** uses darktable's maths on L* with σ 1.0 (Lightroom's default radius), with its amount solved so that the edge's 10–90 % rise distance matches RL's.

| Method | Edge 10–90 % | Overshoot / undershoot (% of step) | Noise gain (std out/in, flat) |
|---|---|---|---|
| Blurred input | 2.05 px | 0 / 0 | 1.00 |
| RL, 4 iterations | 1.53 px | 6.9 / 2.5 | 1.51 |
| USM, amount 0.67 | 1.53 px | 6.4 / 2.1 | 1.57 |
| **RL, 8 iterations (darktable default)** | 1.46 px | 9.0 / 2.2 | 1.86 |
| USM, amount 0.81 | 1.46 px | 8.7 / 2.6 | 1.69 |
| RL, 20 iterations | 1.40 px | 9.5 / 0.9 | 2.56 |
| USM, amount 0.93 | 1.40 px | 10.8 / 3.0 | 1.80 |

Detail restored, as output amplitude ÷ the amplitude **before** the blur (1.00 = fully restored, above 1 = exaggerated):

| cycles/px | 0.05 | 0.10 | 0.15 | 0.20 | 0.25 | 0.30 | 0.40 |
|---|---|---|---|---|---|---|---|
| Blurred | 0.97 | 0.91 | 0.81 | 0.68 | 0.55 | 0.43 | 0.24 |
| **RL 8 it** | 0.99 | 1.00 | 1.00 | 1.00 | **0.98** | 0.89 | 0.54 |
| RL 20 it | 0.99 | 1.00 | 1.00 | 1.00 | 1.00 | 0.99 | 0.78 |
| USM ×0.81 (same edge width as RL 8) | 1.01 | **1.04** | **1.04** | 0.98 | 0.87 | 0.71 | 0.43 |
| USM ×0.93 | 1.01 | 1.06 | 1.07 | 1.03 | 0.91 | 0.76 | 0.46 |

(The 0.5 cycles/px column was dropped: the sampled Gaussian's response at Nyquist is unreliable in this set-up.)

**What it shows:**
- **On an isolated edge, haloes are similar** at equal sharpness. RL has smaller dark undershoot at high iterations.
- **RL restores texture at the frequencies the blur removed** (0.2–0.3 cycles/px) almost exactly and **never exaggerates** coarse detail. USM, at the same edge width, **over-boosts coarse and medium detail** (+4–7 %, the "crunchy" or haloed look) while restoring less fine detail.
- **RL amplifies white noise more** (×1.86 at 8 iterations vs ×1.69), increasingly with iterations. This is why the contrast mask, darktable's 8-iteration default or RawTherapee's auto-stop, and **denoising first** all matter.
- Limits: synthetic, a Gaussian PSF exactly matching RL's (real PSFs are not Gaussian, and a mismatched radius causes ringing, as the darktable tooltip warns), no contrast mask, no demosaic. Treat it as illustrating the mechanism, not as a benchmark.

### 3.8 Interactive GPU cost (estimates)

- **RL capture sharpening:**
  - **Per pixel:** each iteration is two convolutions of up to 9×9. That is 21 taps when σ < 0.66 and 69 taps inside the radius-4.5 circle above that (`_calc_9x9_gauss_coeffs`). At 8 iterations this is about 1,100 multiply-adds per pixel on **one** channel.
  - **24 MP:** about 26 GMAC and 16 full-image passes. **Estimate: 15–40 ms on a mid-range discrete GPU, 3–6× that on an integrated GPU.**
  - **Fixed costs:** the mask and the auto radius are computed once per photo. The 9×9 kernel table is computed once.
  - **Previews:** darktable computes it at sensor resolution for the full pipe, then scales down. LightBench can do the same for the fitted view, or limit it to the visible region while a slider is dragged.
- **USM:** a separable Gaussian of `2·ceil(2.5σ)+1` taps, two passes. **Estimate: 1–3 ms.**
- **diffuse or sharpen, "lens deblur | medium":** 16 iterations, each decomposing 4 channels into several wavelet scales and computing gradient and Laplacian terms per scale. **Estimate: roughly 10–100× the RL cost**, by counting passes. darktable "strongly recommends" OpenCL for it.

---

## 4. Recommendation: the Detail panel's sharpening method (firm)

**Use RL capture sharpening, ported from darktable 5.4's `src/iop/demosaicing/capture.c` (RawTherapee's algorithm), behind Lightroom's four sliders.**

### 4.1 Why

1. **Quality.** It is a deconvolution of the actual capture blur in linear light, which is what "capture sharpening" means. In the experiment above it restores lost texture without exaggerating coarse detail, where USM over-boosts it. Both RawTherapee (since 2020) and darktable (since 5.4) chose it as their dedicated capture sharpener. darktable calls its own USM "no longer recommended".
2. **Haloes and noise.** Halo risk is low at the auto radius and default iterations (darktable: "very low risk for artifacts"). Noise amplification is real but controlled by the contrast mask (a "visualize sharpened areas" overlay already exists in darktable). Running the denoise first (4.2) controls it further.
3. **GPU cost.** It is single-channel and needs about 16 small stencil passes: tens of milliseconds for 24 MP (**estimate**), interactive. That is far cheaper than *diffuse or sharpen*.
4. **Fit with LightBench's engine.** Scene-referred, linear, before the colour matrix and tone mapping: it belongs exactly where LightBench's pipeline already has linear camera RGB. It is GPL-3.0 and from darktable, so it follows the "darktable first" rule. It can be translated from darktable's OpenCL path (`_capture_sharpen_cl`, `capture.c:944`; kernels in `data/kernels/capture.cl`, not read), as LightBench does for other modules.
5. **Lightroom's four controls map naturally** (4.3), including Lightroom's own Detail semantics (halo suppression ↔ deconvolution).

### 4.2 Where it runs

`rawprepare → highlights → demosaic (RCD / Markesteijn) → **denoise (profiled)** → **capture sharpening (RL)** → input colour matrix → … tone equalizer → sigmoid`.

- **A deviation from darktable, and why.** darktable runs capture sharpening *inside* demosaic, so before denoise (profiled). LightBench should run it **after** the denoise. The reasons:
  - darktable's manual says that "denoising should always happen before any attempt at sharpening";
  - RawTherapee added a pre-denoise before capture sharpening (3.3);
  - RL amplifies noise (3.7).

  The CFA-based parts (the clip mask and the auto radius) still need raw data. Compute them at the demosaic stage and pass them along; darktable does the same inside the module. When denoise is off (the default today), the result is the same as darktable's order.
- **Before the geometry pass** (lens, Upright, crop), as in darktable (demosaic at position 9, lens at 15). Sharpening slider changes then re-run the cached warp. That is acceptable at the costs above.
- **Previews:** full resolution for 100 % and for export. For the fitted view, compute at full resolution and downscale (darktable's behaviour) to keep the preview truthful (USABILITY lesson 6).

### 4.3 Mapping Lightroom's four controls (LightBench's own mapping; to be checked by eye)

| Lightroom control | Maps to | Proposal |
|---|---|---|
| **Amount** (0–150, default 40) | RL strength | **Iterations = Amount / 5**: 40 → **8** (darktable's default) and 150 → 30. Interpolate between ⌊n⌋ and ⌈n⌉ iterations, so the slider is smooth. 0 = off. Optional later: RawTherapee's per-tile auto-stop (`checkForStop`). |
| **Radius** (Lightroom 0.5–3.0) | PSF σ | **Default "Auto"**: measured per photo from the raw data (darktable `_calc_auto_radius`), with the diffraction estimate (3.6) as a fallback. The manual range is **0.25–1.5 px** (darktable's 9×9-kernel limit; a blur wider than ~1.5 px is lens deblur, not capture sharpening). Show "Auto (0.62 px)" with an Auto button, like darktable's. |
| **Detail** (0–100, default 25) | Halo suppression ↔ full deconvolution | Lightroom's described meaning. **Detail 100** = the RL result unchanged. Lower values limit the result to the pixel's 3×3 neighbourhood range, widened by a margin that grows with Detail: the same limiter as Export's output sharpening (PHASE3 Part 8, 10 % widening), so **Detail 0 = no overshoot at all**. |
| **Masking** (0–100, default 0; Alt-drag shows the mask) | darktable's contrast sensitivity | Threshold = `auto + (Masking/100)·(1 − auto)`, where *auto* is darktable's ISO/bit-depth estimate (`_get_variance_threshold`). Alt-drag (or a mask button) shows darktable's "sharpened areas" mask. **Note:** at 0, flat noisy areas are **still protected** by the automatic noise threshold, unlike Lightroom, where 0 sharpens everything. That is a deliberate safety difference; see open question 3. |
| **Advanced ▸** | darktable's extra controls | Corner boost (0–1.5 px) and sharp centre (0–100 %) with their mask view; an iterations override; "Auto" buttons for radius and threshold. No capability is lost against darktable. |

The interim method the Detail work built (darktable USM on luminance plus capture.c's contrast mask, behind `SharpenMethod`) keeps the same four settings fields, so swapping the method doesn't change the stored edit format.

### 4.4 Defaults for new photos

darktable has capture sharpening **off** by default and says it is "generally safe to auto-apply … below ISO 1000". Lightroom applies Amount 40 to every RAW. The Detail work currently starts with everything off. **Suggestion:** default **on for RAWs at Amount 40 with Auto radius and Auto threshold**, and off for JPEGs. This is the owner's decision (open question 3). It needs no process version as long as edits saved before keep `detail` absent and render as before.

### 4.5 What not to do

- Don't use darktable's `sharpen` USM as the Develop sharpening method; keep it for Export only.
- Don't make *diffuse or sharpen* the method behind the four sliders. Consider a separate **"Lens deblur"** option later (darktable's presets), clearly labelled as slow.
- Don't extrapolate RL beyond its iterations (no "amount × (RL − original)" with an amount above 1). That increases ringing without restoring more detail.

### 4.6 Does denoise (profiled) stand?

**Yes**: see 2.7. Keep wavelets / Y0U0V0 as the default with NLM in Advanced, and order it before capture sharpening.

---

## 5. AI denoise and sharpen (Phase 4)

### 5.1 Commercial state of the art (context)

- **Adobe:**
  - **2023:** Denoise worked only on Bayer and X-Trans mosaic raws and wrote a new demosaiced DNG. Raw Details and Super Resolution came out of the same "Enhance" step. Adobe's Eric Chan wrote of wanting to combine Denoise with Super Resolution and to avoid making a new DNG (forum quotes of Adobe's "Denoise demystified" blog post, search summary; the post was not opened).
  - **Lightroom Classic 14.4 (June 2025):** *"Raw Details, Super Resolution and Denoise no longer require a separate DNG file … in the Details panel as options you can toggle on or off."* The amount can be adjusted "without having to recalculate each time". Users report that the data is stored in the catalogue's `.lrcat-data` folder ([Thomas Fitzgerald](https://blog.thomasfitzgeraldphotography.com/blog/2025/6/lightroom-144-released-big-changes-to-raw-details-denoise-and-super-resolution), [Paolo Sartori](https://www.paolosartoriphotography.com/blog/2025/6/game-changer-lightroom-ai-denoise-no-longer-creates-dng-files-heres-why-that-matters), [dpreview forum](https://www.dpreview.com/forums/threads/hey-adobe-no-longer-requires-a-separate-dng-for-denoise.4789492/), all search summaries).
  - Still RAW-only.
- **DxO:**
  - DeepPRIME XD2s in PhotoLab 8 is applied at export, with a loupe preview. Its X-Trans support was behind at the time ([Amateur Photographer](https://amateurphotographer.com/review/dxo-photolab-8-review-the-best-raw-editor-money-can-buy/), search summary).
  - PureRAW writes **linear DNGs** ("already demosaiced", with optical corrections baked in; [DxO support](https://support.dxo.com/hc/en-us/articles/4435982962321-Can-I-open-my-DNG-file-created-with-DxO-PureRAW-in-DxO-PhotoLab), search summary). Its user guide lists DeepPRIME 3 and XD3 ([userguides.dxo.com](https://userguides.dxo.com/pureraw/en/processing-tools-and-settings/), search summary). The version naming is inconsistent across sources.
- **Topaz Photo AI:** denoise and sharpen models with strength sliders; reviewers report invented detail and random soft rectangles (5.3). Current RAW/DNG support is **unverified**.
- **Capture One 16.8 "Enhanced Denoise"** (2026): AI denoise auto-applied to high-ISO images ([PhotoWorkout](https://www.photoworkout.com/capture-one-vs-lightroom-topaz-denoise/), search summary). Whether there is a strength slider is **unverified**.
- **The trend:** from a *separate file* (Adobe 2023, DxO PureRAW, darktable's neural restore TIFFs) to a **cached, toggleable step with a live amount** (Adobe 2025). The separate-file route survives for using other apps.

### 5.2 Open models

Licence evidence was read from each repository's `LICENSE` file on GitHub unless stated. "Weights" means the published checkpoints. Unless a repository says otherwise, they are covered only by the repository licence. That is the usual reading, but **no repository except darktable-ai's model cards states a separate weights licence**.

| Model | Code licence (quoted) | Weights | Training data | Domain | Size | Browser fit / speed |
|---|---|---|---|---|---|---|
| **NAFNet** ([megvii-research/NAFNet](https://github.com/megvii-research/NAFNet)) | "MIT License … Copyright (c) 2022 megvii-model" (plus BasicSR's Apache-2.0 notice) | Google Drive / Baidu links in the README. darktable-ai's card: "Model license: MIT" | SIDD (smartphone sRGB pairs). darktable-ai says "MIT"; the SIDD code repository is MIT ("Copyright (c) 2019 Abdelrahman Abdelhamed"); **the dataset's own terms were not opened** | sRGB | SIDD width32: **108.4 MB** FP32 ONNX (darktable-ai package); width64 ≈ 4× compute | Convs only, so it ports well. Reported cost: **505.5 GFLOPs and 0.186 s per 512×512 on an A6000** (UniRestorer, arXiv 2412.20157, search summary; this matches width64). Width32 ≈ ¼ of that (**estimate**). One third-party benchmark ranks NAFNet-SIDD-w64 last among blind denoisers on real ISO series ([mlx-scunet-swift](https://github.com/xocialize/mlx-scunet-swift), search summary). |
| **Restormer** ([swz30/Restormer](https://github.com/swz30/Restormer)) | "MIT License … Copyright (c) 2022 Syed Waqas Zamir and contributors" | Google Drive | SIDD (real denoise) | sRGB | ~26 M params (not downloaded) | **1,128.9 GFLOPs, 0.368 s per 512×512 on an A6000** (search summary). About 100 TFLOP for 24 MP: minutes in a browser (**estimate**). |
| **SCUNet** ([cszn/SCUNet](https://github.com/cszn/SCUNet)) | Apache-2.0 | `scunet_color_real_psnr.pth` **72.0 MB**, hosted in **KAIR's releases** (KAIR: "MIT License … Copyright (c) 2019 Kai Zhang") | Synthetic degradation pipeline on clean images | sRGB, blind | 72.0 MB FP32 | Swin window attention. A WASM demo needs "several seconds" for 320 px ([webai.show](https://webai.show/models/scunet-image-denoising/), search summary). WebGPU timing unpublished. A GAN variant exists (`real_gan`); avoid it (5.3). |
| **Uformer** ([ZhendongWang6/Uformer](https://github.com/ZhendongWang6/Uformer)) | "MIT License … Copyright (c) 2022 Zhendong Wang" | OneDrive | SIDD | sRGB | not downloaded | Heavy transformer. |
| **SwinIR** ([JingyunLiang/SwinIR](https://github.com/JingyunLiang/SwinIR)) | Apache-2.0 ("This project is released under the Apache 2.0 license") | GitHub releases | DIV2K, Flickr2K, etc. (darktable-ai flags Flickr2K as "without an explicit open-source license") | sRGB; denoise models are Gaussian (σ 15/25/50) | not downloaded | Heavy attention. |
| **HAT** ([XPixelGroup/HAT](https://github.com/XPixelGroup/HAT)) | Apache-2.0 | Google Drive / Baidu; the best checkpoints are **ImageNet-pretrained** (ImageNet's terms are research-only; not checked here) | — | **Super-resolution only** | — | Not a denoiser. |
| **DRUNet / DPIR** ([cszn/DPIR](https://github.com/cszn/DPIR)) | "MIT License … Copyright (c) 2020 Kai Zhang" | `drunet_color.pth` **130.6 MB** in KAIR's releases (MIT) | Mixed (Flickr2K caveat as above) | sRGB; Gaussian with a **noise-level map** input | 130.6 MB | Convs only. The noise-level map could be fed from darktable's profiles after the VST (**idea, untested**). |
| **RawNIND UtNet2** ([trougnouf/rawnind_jddc](https://github.com/trougnouf/rawnind_jddc); packaged by [darktable-ai](https://github.com/darktable-org/darktable-ai)) | **GPL-3.0** | darktable-ai card: **"Model license: GPL-3.0"** | RawNIND, real raw noisy/clean pairs, **"CC BY 4.0 / CC0 (per-image, Wikimedia Commons)"** | **Bayer** (4-channel packed → camera RGB at 2×, **joint demosaic + denoise**) and **linear Rec.2020** (3→3) | **57.7 MB** package (both, FP32, 512×512 tiles) | Plain conv U-Net (`funit 32`, 4 levels). **Estimate: about 1.1 TMAC per 24 MP Bayer frame**, from the published layer widths, so roughly 1–3 s on a recent discrete GPU in the browser. darktable pins the Bayer model to the CPU on Apple's CoreML because "its intermediate activations overflow FP16", so FP16 in WebGPU needs testing. |
| NIND UNet ([trougnouf/nind-denoise](https://github.com/trougnouf/nind-denoise)) | GPL-3.0 | darktable-ai card: "GPL-3.0" | NIND, CC BY 4.0 / CC0 | sRGB | 55.0 MB | darktable's default `denoise` model. |
| **PMRID** ([MegEngine/PMRID](https://github.com/MegEngine/PMRID)) | **Apache-2.0** | **In the repository** (`models/torch_pretrained.ckp`, **4.18 MB**), so clearly under Apache-2.0 | OPPO Reno 10x raws with synthetic noise (k-sigma) | **RAW** Bayer | 4.2 MB | Separable convs, designed for phones. Its **k-sigma transform** takes exactly the Poisson–Gaussian `(a, b)` that darktable's noise profiles provide. That is a natural fit with LightBench (**LightBench's idea, untested**). Trained on one sensor, so quality on Nikon/Sony is **unknown**. |
| **Raspberry Pi AI_denoise** ([raspberrypi/AI_denoise](https://github.com/raspberrypi/AI_denoise)) | **BSD-2-Clause** ("Copyright (c) 2025, Raspberry Pi Ltd.") | In the repo (TFLite). Bayer small (NAFNet) 1.1 M params / 4.7 MB; Bayer large 17.7 M / 71.9 MB; Bayer fast (UNet) 0.5 M / 2.1 MB | Raspberry Pi camera images only ("In all other cases, results may vary") | RAW Bayer and RGB | 2–72 MB | Needs TFLite → ONNX conversion. Speed 1.3–4.7 s/MP **on a Pi 5 CPU** (README). Notes that results are "a little soft and will benefit from some sympathetic sharpening". |
| ELD ([Vandermode/ELD](https://github.com/Vandermode/ELD)) | MIT ("Copyright (c) 2020 Kaixuan Wei") | Google Drive / Baidu | SID/ELD (Sony A7S2 and others, extreme low light). The README says "Due to the business license, we are unable to provide the noise model" | RAW | — | Narrow (extreme low light). |
| SID ([cchen156/Learning-to-See-in-the-Dark](https://github.com/cchen156/Learning-to-See-in-the-Dark)) | README: "MIT License." | Google Drive | Sony and Fuji dark scenes; "probably not work for data from another camera sensor" (README) | RAW → sRGB | — | Narrow. |
| demosaicnet, Gharbi et al. ([mgharbi/demosaicnet](https://github.com/mgharbi/demosaicnet)) | MIT | (not checked) | — | Joint demosaic + denoise (2016) | — | Older; a reference only. |
| LED ([Srameo/LED](https://github.com/Srameo/LED)) | **"Attribution-NonCommercial 4.0 International"** | — | — | RAW | — | **Excluded.** |
| CycleISP / MPRNet (swz30) | **"ACADEMIC PUBLIC LICENSE"** | — | — | — | — | **Excluded.** |
| MambaIR ([csguoh/MambaIR](https://github.com/csguoh/MambaIR)) | Apache-2.0 | not checked | — | sRGB | — | State-space ops are poorly supported in browser runtimes (**unverified**). |
| Sony Research "Noise Modeling in One Hour" ([SonyResearch/raw_image_denoising](https://github.com/SonyResearch/raw_image_denoising)) | MIT ("Copyright (c) 2025 Sony Research") | Google Drive checkpoints | Self-supervised, low light | RAW | — | Recent (CVPR 2025); not evaluated. |
| Intel Open Image Denoise (via [pmndrs/denoiser](https://github.com/pmndrs/denoiser)) | Library MIT; "OIDN weights are Apache-2.0 (© Intel)" | Apache-2.0 | **Path-tracing render noise**, not camera noise | RGB(+aux) | small | Excellent in the browser (below), but the wrong training domain. |

**GPL weights, the facts the owner asked for (RawNIND, NIND):**
- The licence is GPL-3.0, the same as LightBench. GPL-3.0 has **no field-of-use or non-commercial restriction**: commercial use is allowed. It is **copyleft**: anyone who redistributes must pass on the same freedoms and provide the "corresponding source".
- For RawNIND, the training code is GPL-3.0 and the data is CC BY 4.0 / CC0, so the full source of the weights is available (darktable-ai rates it "Open Source AI", MOF Class I).
- darktable itself accepts GPL-3.0 and permissive weights and rejects "Proprietary or non-commercial-only models" (darktable-ai `README.md`).
- The owner's stated reason for permissive-only, that users are bound by each model's licence and the GPL allows no extra restrictions, is **not contradicted** by GPL weights, because GPL weights add no restriction beyond the GPL LightBench already uses. But GPL is not "permissive" in the usual sense. **This is the owner's decision.**

### 5.3 Hallucination risk

- **Theory:**
  - The **perception–distortion trade-off**: no restoration method can be both as faithful as possible (lowest error) and as natural-looking as possible. Pushing for realistic texture (GAN or diffusion training) necessarily invents content (Blau & Michaeli, CVPR 2018, arXiv 1711.06077, not opened).
  - Models trained for **pixel fidelity** (L1, L2, MS-SSIM, as RawNIND, NAFNet-SIDD, PMRID and SCUNet-PSNR are) fail by **smoothing** ("plastic" textures). GAN- and diffusion-trained models fail by **inventing** detail.
  - **Deblurring and super-resolution are worse than denoising**, because blur destroys high frequencies outright, so there is more that has to be guessed. Medical-imaging work documents hallucinated structures from learned reconstruction (e.g. Bhadra et al., "On hallucinations in tomographic image reconstruction", IEEE TMI 2021, not opened).
- **Reviewers' reports (search summaries):**
  - Topaz "tries to guess what was there, sometimes adding detail where none belongs". In low-light mode it "can create fur on animal eyes". Users also report random soft-edged rectangles and red speckles in blue skies ([dpreview forum](https://www.dpreview.com/forums/thread/4715363), [PhotoFocus](https://photofocus.com/photography/the-battle-of-ai-denoising-topaz-labs-vs-lightroom-classic/)).
  - Lightroom Denoise is reported to leave haloes on high-contrast edges and "swirly artefacts" between stars in astrophotography ([Adobe community](https://community.adobe.com/t5/lightroom-classic-discussions/ai-denoise-creates-swirl-artifacts-astrophotography/m-p/14787212)).
  - Raspberry Pi notes its denoised output is "a little soft".
- **How apps expose it:** an **Amount/strength slider** that blends with the original (Adobe since 14.4, DxO's luminance and "force details", Topaz), **before/after** and loupe previews (DxO's magnifier), and a model or mode choice (Topaz).
- **For LightBench:**
  - Use **fidelity-trained models only** (no GAN or diffusion).
  - **No AI sharpening or deblurring** in Phase 4; RL capture sharpening covers capture blur.
  - Always provide an **Amount** blend and before/after.
  - Label the step as AI in the history (USABILITY R2 11).
  - Treat AI super-resolution, if ever wanted, as its own labelled tool, like the Phase 4 "fill clipped areas" plan, which already labels generated content.

### 5.4 Browser runtime evidence

- **Published browser measurements found** ([pmndrs/denoiser runtime guide](https://github.com/pmndrs/denoiser/blob/main/docs/site/guides/choosing-a-runtime.mdx), read from GitHub): Intel OIDN U-Nets at 1080p on an **Apple M5 Pro, Chrome 154**:

  | Runtime | small | base | large |
  |---|---|---|---|
  | Native Metal | 14.3 ms | 24.8 ms | 54.2 ms |
  | **Hand-written WGSL FP16** | **33.6 ms** | **67.0 ms** | 167 ms |
  | **onnxruntime-web FP16** | 101 ms | 210 ms | — |
  | WebNN FP16 (needs a flag) | 31.5 ms | 40.1 ms | 65.4 ms |

  The same page warns that *"ORT-WebGPU's first Conv miscomputes inputs with more than three channels"* and that it *"miscomputes the large topology"*. The authors say everything was "validated on Apple GPUs only".
- **Takeaways:**
  - ONNX Runtime Web with WebGPU (PLAN's choice) is the quickest route, but its output **must be checked against a PyTorch reference**. RawNIND's Bayer input has 4 channels, exactly the case that page reports as miscomputed.
  - A **hand-written WGSL port** of a plain conv U-Net is about 3× faster than ORT there. LightBench already writes WGSL, and RawNIND's UtNet2, PMRID and NAFNet are all plain convolutions, with no attention.
- **Speed estimates for 24 MP** (from the OIDN base model's per-pixel work, which LightBench estimates at about 0.12 MMAC/px from its published layer widths, and the measured 67 ms per 2 MP in WGSL, giving roughly 3–4 TMAC/s on that GPU):
  - **RawNIND UtNet2:** ~1.1 TMAC, so **~0.3–1 s WGSL, ~1–3 s ORT** on that class of GPU;
  - **NAFNet-SIDD-w32:** ~6 TMAC, so **~2–5 s ORT**;
  - **Restormer:** ~50 TMAC, so about a minute.

  Integrated Windows GPUs: multiply by **3–10×** (all **estimates**, to be measured on the owner's PC). Memory: tile at 512–768 px (darktable-ai's fixed tile sizes) with overlap blending (LightCraft's `denoise-core` tile blending is MIT/Apache and an "idea only" port per `CATALOG_PROCESSING.md`).

---

## 6. Recommendation for Phase 4 AI denoise

**Workflow (firm):** **"AI Denoise" as a switch in the Detail panel's Noise Reduction section**, the Lightroom 14.4 model, not a separate file by default.
- **Computing it:** turning it on runs the model once in a background worker with a progress indicator. The result (linear camera RGB or Rec.2020, half-float) is **cached** in browser storage (OPFS), keyed by the file, the model and its version, and the raw-stage settings it depends on.
- **Live controls:** **Amount** (0–100) blends the AI result with the classical path live. Before/after and the 100 % loupe work as usual. Every later edit stays live.
- **History:** one history step, labelled "AI Denoise (model name)".
- **Option:** "Export → linear DNG (denoised)" for use in other apps, the DxO PureRAW pattern.
- **Why not a separate DNG by default:** Adobe abandoned that in 2025; it doubles storage; and it breaks edits upstream of the step. A RAW-domain model sits before white balance (RawNIND uses `wb_norm: none`), so its cache stays valid through every Develop edit except the raw stage.
- **Where it runs:** it replaces **demosaic + denoise (profiled)** for that photo (a joint demosaic-denoise model), or replaces only denoise (the linear variant, for X-Trans and linear DNG). Capture sharpening stays after it. Raspberry Pi's "soft" note and Adobe's practice both suggest light sharpening after AI denoise.

**Model:**
1. **If the owner accepts GPL-3.0 weights: RawNIND UtNet2.** Bayer model for Bayer sensors, linear Rec.2020 model for X-Trans and linear DNG. It is the only open model found that is trained on **real multi-camera raw pairs**, and its linear variant uses LightBench's own working space. darktable 5.6 ships it as its default raw denoiser, and ONNX exports already exist. **Size: 57.7 MB** FP32 for both variants (~29 MB at FP16, **estimate**; FP16 overflow must be tested). **Speed: about 1–3 s per 24 MP on a recent discrete GPU** (**estimate**), several times longer on integrated GPUs.
2. **If GPL weights are not accepted:** there is **no off-the-shelf permissive model trained on real multi-camera raw data**. The order of preference:
   - **a. PMRID + darktable noise profiles** (Apache-2.0, 4.2 MB, RAW). The cheapest to try and the best architectural fit, but trained on one phone sensor; its quality on DSLR raws must be tested first.
   - **b. SCUNet real-PSNR** (Apache-2.0 / MIT, 72 MB, sRGB, blind), run on a display-encoded copy of the linear image. It is robust but slower, and as an sRGB model it can't fix demosaic artefacts.
   - **c. Train LightBench's own model** (e.g. NAFNet or UtNet-class from **MIT** NAFNet code) on the **RawNIND photos (CC BY 4.0 / CC0)**. This gives permissively licensable weights with the dataset credited. It is the only permissive route to RawNIND-class quality, but it is a project in itself (GPU training time, at least days, **estimate**). Whether CC BY obligations carry over to trained weights is legally unsettled (**unverified**).
   - **Before choosing**, a one-day **bake-off** on the owner's NEF/ARW files at ISO 3,200–12,800: classical denoise (profiled) vs each candidate, at 100 % with before/after.
3. **No AI sharpening, deblur or super-resolution in Phase 4**, for the hallucination reasons in 5.3.
4. **Runtime:** ONNX Runtime Web with WebGPU first, validated against PyTorch outputs. Port to WGSL if it is wrong or too slow.

---

## 7. Excluded options and why

| Option | Why excluded |
|---|---|
| BM3D / CBM3D / BM3D-CFA (Tampere code) | "Free for non-commercial use" (PyPI); patent status unverified; heavy on GPU. |
| NL-Bayes | Cost (per-group covariance inversion) for no demonstrated gain over profiled wavelets/NLM on real noise. |
| darktable `sharpen` (USM) as the Develop sharpener | darktable: "no longer recommended"; over-boosts coarse detail (3.7). Kept for Export. |
| *diffuse or sharpen* as the Detail sharpener | "Highly resource-intensive" (~10–100× RL, estimate); 21 parameters, no mapping to 4 sliders. Possible later as a labelled "Lens deblur" option. |
| RawTherapee's Sharpening RL on Lab L | Deconvolves gamma-encoded data; superseded by Capture Sharpening. |
| RawTherapee noise reduction | Not profiled; gamma-domain; CPU/FFT design. Profiled wavelets already cover it. |
| LED | CC BY-NC 4.0. |
| CycleISP, MPRNet | "Academic Public License". |
| HAT (ImageNet-pretrained checkpoints) | Super-resolution, not denoise; ImageNet pre-training terms (not checked). |
| GAN- or diffusion-trained restorers (SCUNet-GAN, Real-ESRGAN/BSRGAN as denoisers, diffusion restorers) | Hallucination (5.3). |
| Restormer, Uformer, SwinIR | MIT/Apache, but heavy for 24 MP in a browser (~1 min, estimate). sRGB-only Gaussian or SIDD training. NAFNet/SCUNet cover the same ground more cheaply. |
| Intel OIDN | Apache-2.0 and fast in browsers, but trained on render noise, not camera noise. |
| SID, ELD | Trained for extreme low light on one or two cameras; ELD's noise model is withheld ("business license"). |
| Cloud services (Adobe, DxO, Topaz, Capture One) | Proprietary; context only. LightBench is local-only. |

---

## Owner's decisions (2026-10-13)

- **Sharpening method:** capture sharpening (Richardson–Lucy deconvolution, darktable 5.4's port of RawTherapee's Capture Sharpening), run after the denoise, with Lightroom's four controls mapped as in section 4.
- **Default:** on for new RAW photos (Amount 40, automatic radius), off for JPEGs. Saved edits are never changed.
- **Noise reduction:** darktable's denoise (profiled) stands.
- **GPL-3.0 model weights (RawNIND) for AI Denoise:** to be decided when Phase 4 starts.


## 8. Open questions for the owner

1. **GPL model weights:** may LightBench offer a model whose weights are GPL-3.0 (RawNIND, the one darktable uses)? GPL allows commercial use and matches LightBench's own licence, but it is copyleft, not "permissive". **Yes** gives the best AI denoise available now. **No** means a weaker permissive model, or training our own.
2. **Train our own?** If GPL is not accepted, should LightBench train its own denoise model on the RawNIND photos (which are free to use with credit)? It would take GPU time (days, estimate) and upkeep.
3. **Sharpening on by default for RAWs?** Lightroom sharpens every RAW (Amount 40); darktable doesn't. Suggestion: on for RAWs with Auto radius, off for JPEGs.
4. **Masking at 0:** is it OK that Masking 0 still protects flat, noisy areas (sky, skin) a little? This is safer than Lightroom, where 0 sharpens everything.
5. **AI Denoise style:** a switch in the Detail panel that computes once and then has a live Amount slider (like Lightroom since 2025), plus an optional "save as denoised DNG" export: is that the right workflow? The alternative is a separate step that always writes a new DNG (like Lightroom before 2025 and DxO PureRAW).
6. **Lens deblur later?** darktable's slow but strong "lens deblur" as a separate, clearly labelled option in Advanced: wanted?

---

## Sources

**Read directly (code and docs):**
- darktable (GPL-3.0), commit `6271f53`:
  - `src/iop/demosaicing/capture.c`;
  - `src/iop/demosaic.c` (lines 157–169, 695–815, 1925–1967);
  - `src/iop/denoiseprofile.c` (lines 64–136, 985–1060, 2600–2747);
  - `src/iop/diffuse.c` (presets, lines 235–775);
  - `src/iop/sharpen.c`;
  - `src/common/noiseprofiles.c`, `data/noiseprofiles.json`;
  - `RELEASE_NOTES.md`.
- darktable manual sources: [dtdocs](https://github.com/darktable-org/dtdocs) `content/module-reference/processing-modules/{demosaic,denoise-profiled,diffuse,sharpen,raw-denoise,astrophoto-denoise,surface-blur}.md`.
- RawTherapee (GPL-3.0), `dev` branch: [`rtengine/capturesharpening.cc`](https://github.com/RawTherapee/RawTherapee/blob/dev/rtengine/capturesharpening.cc), `rtengine/rt_algo.cc`, `rtengine/ipsharpen.cc`, `rtengine/FTblockDN.cc`, `rtengine/procparams.cc`, `rtengine/params/raw.cc`.
- Model repositories (LICENSE and README files): NAFNet, Restormer, SCUNet, Uformer, SwinIR, HAT, DPIR, KAIR, PMRID, ELD, Learning-to-See-in-the-Dark, nind-denoise, rawnind_jddc, darktable-ai (README and model cards `denoise-nafnet`, `denoise-nind`, `rawdenoise-nind`), raspberrypi/AI_denoise, SonyResearch/raw_image_denoising, Srameo/LED, swz30/CycleISP, swz30/MPRNet, csguoh/MambaIR, mgharbi/demosaicnet, RenderKit/oidn, pmndrs/denoiser (README and runtime guide), abdokamel/sidd-ground-truth-image-estimation.
- Weight file sizes from HTTP HEAD requests: KAIR releases (`scunet_color_real_psnr.pth`, `drunet_color.pth`), PMRID `models/`, Raspberry Pi `networks/`.
- [pypi.org/project/bm3d](https://pypi.org/project/bm3d/) (JSON API).
- LightBench: `docs/PLAN.md`, `docs/USABILITY.md`, `docs/PHASE3.md` Part 8, `docs/DARKTABLE_MODULES.md`, `docs/research/AI_MODELS.md`, `docs/research/lightcraft/*`, and the `lightbench/detail` worktree's `web/src/engine/detail/{settings,denoise}.ts` (read only). `docs/research/PHASE4_MODELS.md` did not exist yet in any worktree when this was written.

**Search summaries only (pages not opened):**
- RawTherapee 5.8 download page and release coverage; darktable 5.4 announcement.
- Lightroom 14.4 Denoise coverage (Thomas Fitzgerald, Paolo Sartori, dpreview, Lightroom Queen); Adobe "Retouch photos" help; Digital Camera World on default values; Lightroom Queen, Fstoppers and Greg Benz on the Detail slider; Adobe community posts quoting "Denoise demystified".
- DxO support, user guide, PhotographyLife and Amateur Photographer; Capture One 16.8 coverage; Topaz and Lightroom artefact reports (dpreview, PhotoFocus, Adobe community).
- UniRestorer FLOP table (arXiv 2412.20157); mlx-scunet-swift benchmark; webai.show demos; BM3D patent and IPOL searches; guided-filter patent search.

**Cited from knowledge, not opened:**
- Foi et al. 2008; Mäkitalo & Foi 2013; Brooks et al. 2019 (arXiv 1811.11127); Abdelhamed et al. 2018 (SIDD); Danielyan et al. 2009 (BM3D-CFA); Lebrun, Buades & Morel 2013 (NL-Bayes); He, Sun & Tang 2010/2013 (guided filter); Blau & Michaeli 2018 (arXiv 1711.06077); Bhadra et al. 2021.
- The Airy Gaussian approximation σ ≈ 0.42 λN.
