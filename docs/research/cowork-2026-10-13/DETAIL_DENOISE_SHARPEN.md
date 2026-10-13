> **Provenance:** an independent research run done in Claude Cowork on 2026-10-13, written without seeing the drafts in `docs/research/`. It has not been re-verified, except where the spot-check log in [INDEX.md](INDEX.md) says so. The text below is copied unchanged.

# Part 2: Sharpening and noise reduction (classical now, AI later)

*LightBench research brief, Part 2. Researched 2026-10-13 from primary sources (darktable source and docs, RawTherapee docs and issues, Adobe help pages, model repos, Google Patents, arXiv). This research did not use the earlier drafts.*

> **How to read quotes.** Quotes are copied from the cited pages. The fetch tool cuts quotes at about 125 characters, so some are sentence fragments; the cut is marked "…". Anything not confirmed from a primary source is labelled **[unconfirmed]**. Anything that is my own reasoning or estimate is labelled **[analysis]** or **[estimate]**.

---

## Decisions this changes

| # | Current decision | Verdict | Reasoning (one line) | Key source |
|---|---|---|---|---|
| (a) | **Richardson–Lucy (RL) capture sharpening** in the Detail panel | **Supports** | RawTherapee's Capture Sharpening started as an "RL deconvolution immediately after demosaic" mockup. darktable 5.4 ported it, and its code runs RL's blur→divide→blur→multiply loop on luminance. | RT issue #5412; darktable `src/iop/demosaicing/capture.c` |
| (b) | **…after darktable's profiled denoise** | **Mixed** | darktable and RawTherapee both run capture sharpening *before* their main denoiser, inside or right after demosaic, and use a noise mask to protect flat areas. darktable's own manual says "denoising should always happen before any attempt at sharpening". Keep the order, but say clearly that this departs from both reference implementations. | darktable module order; `demosaic.md`; `diffuse.md`; RawPedia |
| (c) | **On by default for new RAWs, Amount 40** | **Mixed** | Lightroom applies Amount 40 to raws by default, so the label is familiar. darktable leaves capture sharpening **off** by default and only calls auto-apply "generally safe" **below ISO 1000**. RL has no native "Amount", so 40 means nothing until LightBench defines it (mapping proposed below). | darktable `demosaic.md`; Lightroom Queen (7.3 notes) |
| (d) | **RawNIND undecided (GPL)** | **Mixed (new fact)** | Upstream says "The weights are dual licensed GPL3 + CC-BY-4.0". darktable-ai's model card lists only GPL-3.0. darktable 5.6 offers RawNIND as its **default** raw-denoise model, downloaded on request, with AI off by default. If "+" means "either", the CC-BY-4.0 route would meet the permissive rule. Only the author can say. | `trougnouf/rawnind_jddc` README; darktable 5.6.0 release notes |

---

## Summary

LightBench's chosen sharpening method is the right family. darktable's **capture sharpening** first shipped in **darktable 5.4.0** (released 21 Dec 2025). It lives in the demosaic module and is credited as based on Ingo Weyrich's RawTherapee algorithm. Its code is a Richardson–Lucy loop with Gaussian kernels on luminance, auto radius, a contrast-sensitivity (noise) mask and a corner boost. The one real disagreement with the sources is the **order**. darktable and RawTherapee both deconvolve right after demosaic, *before* their main denoiser, and protect noisy areas with a mask. darktable's general guidance and its noise-model reasoning still support LightBench's plan: run profiled denoise, which needs unaltered raw noise statistics, first, then RL, both before the input colour profile. LightBench should keep the order, keep darktable's contrast-sensitivity mask, and estimate the auto radius on pre-denoise data.

For noise reduction, darktable's **denoise (profiled)** in **wavelets + Y0U0V0** mode (darktable's code default) maps cleanly onto Lightroom's six NR sliders and suits the GPU well.

For AI denoise, the strongest permissive candidates are **NAFNet** (MIT code; SIDD is MIT), **Restormer** (MIT) and **SCUNet** (Apache-2.0). All three are RGB models trained on display-referred data. The best fit for LightBench's linear pipeline is **RawNIND UtNet2**: Bayer and linear Rec.2020 variants, darktable 5.6's default. Its weight licence wording needs an answer from the author. The **BM3D reference code is non-commercial** (excluded). An IPOL BM3D implementation and IPOL NL-Bayes are both **GPL-3.0-or-later**. I found **no BM3D patent held by Tampere or Noiseless Imaging**. Adobe's AI Denoise, Raw Details and Super Resolution moved into the Detail panel in Lightroom Classic 14.4 (June 2025) and no longer need a separate DNG.

---

## 1. Settled facts behind the decisions (with quotes)

### 1.1 darktable capture sharpening (5.4+)

| Fact | Quote | Source |
|---|---|---|
| Added in 5.4, inside demosaic | "A new section Capture Sharpening is added into the demosaic module." | https://www.darktable.org/2025/12/darktable-5.4.0-released/ |
| 5.4 release date | "December 21, 2025" | https://linuxiac.com/darktable-5-4-raw-photo-editing-tool-released/ |
| Purpose | "The capture sharpening tries to recover details lost due to in-camera blurring, which can be caused by diffraction," … "the anti-aliasing filter or other sources of Gaussian-type blur." | 5.4.0 release post (above) |
| Why it sits in demosaic | "Capture sharpening is performed inside the demosaic module because some parts of the algorithm require raw CFA data." | https://docs.darktable.org/usermanual/5.6/en/module-reference/processing-modules/demosaic/ |
| Based on RawTherapee | Code header: "Credits go to: Ingo Weyrich (heckflosse67@gmx.de), he implemented the original algorithm for rawtherapee." PR author: the implementation "is based on his work, especially the convolution kernels." | `src/iop/demosaicing/capture.c` (raw.githubusercontent.com/darktable-org/darktable/master/src/iop/demosaicing/capture.c); PR quoted at https://discuss.pixls.us/t/blender-agx-in-darktable-proof-of-concept/48697/1647 |
| Called a port | kofa: "A sharpening mechanism ported from RawTherapee / ART, which is part of the demosaicking." | https://discuss.pixls.us/t/capture-sharpening-simply-thank-you/51574 |
| It is RL (by structure) | Iteration loop `for(int iter = 0; iter < d->cs_iter; iter++)` calls `_blur_div` (`out[i] = luminance[i] / MAX(val, CAPTURE_YMIN);`) then `_blur_mul` (`out[i] *= val;`). This is the Richardson–Lucy update: estimate × blur(observed ÷ blur(estimate)). The header itself does not use the words "Richardson-Lucy". | capture.c (above) |
| Gaussian PSF, per-pixel sigma | "The gaussian convolution filters take the coeffs from precalculated data in gd->gauss_coeffs," "The chosen kernel is selected per pixel via an index map, this is derived from cs_radius, cs_boost" | capture.c |
| Parameters and defaults (demosaic params v6) | `cs_radius` 0–1.5, default 0.0 (= auto); `cs_thrs` "contrast sensitivity" default 0.40; `cs_boost` "corner boost" 0–1.5, default 0.0; `cs_iter` 1–25, default 8; `cs_center` "sharp center" default 0.0; `cs_enabled` default FALSE | `src/iop/demosaic.c` (`DT_MODULE_INTROSPECTION(6, …)`) |
| Off by default | "Capture sharpening is not enabled by default but you could achieve this by defining an auto-applied preset" | demosaic manual (above) |
| Iterations | "For most images a setting of 8 will be sufficient." | demosaic manual |
| ISO guidance | "It is generally safe to auto-apply capture sharpening to images with ISO values below 1000." "If you have a good sensor, with low noise even on high ISO values, you might be able to use it for ISOs as high as 3200." | dtdocs `demosaic.md` (raw.githubusercontent.com/darktable-org/dtdocs/master/content/module-reference/processing-modules/demosaic.md) |
| Noise | "As sensor noise will typically be amplified by capture sharpening" … | dtdocs `demosaic.md` |
| Not general sharpening | "Capture sharpening is not intended to be used as a general sharpening / local contrast enhancing tool." | dtdocs `demosaic.md` |
| Radius warning | "Do not manually increase the radius much further than the auto-calculated value." | demosaic manual |
| Auto-radius fallback and clamp | `return 0.5f;` (small image) and `return CLAMP(radius, 0.0f, 1.5f);`; base noise threshold `float threshold = 0.4f;` "is good for 12bit raws having a fair amout of sensor noise" | capture.c |
| Changed in 5.6 | "The radius calculated for capture sharpening is now using only the central 60% of the image" … "For xtrans sensors the radius has been slightly increased" | https://www.darktable.org/2026/06/darktable-5.6.0-released/ |

**Implication for LightBench [analysis].** darktable's auto-radius changed between 5.4 and 5.6. If LightBench ports either version, it should pin the algorithm to a LightBench **process version**, so a later port of 5.6+ changes never alter old edits.

### 1.2 RawTherapee Capture Sharpening

| Fact | Quote | Source |
|---|---|---|
| Released in RT 5.8 (4 Feb 2020) | "Automatically recover detail lost to lens blur (diffraction) using the new Capture Sharpening tool, located in the "Raw" tab." | https://www.rawtherapee.com/downloads/5.8 |
| Position | "It takes place right after demosaicing, and as it works in linear space it is not prone to haloing." | same |
| Origin is RL | heckflosse's branch: "made a first mockup for RL deconvolution immediately after demosaic." | https://github.com/RawTherapee/RawTherapee/issues/5412 |
| Gaussian sigma and corner boost | Ingo Weyrich: radius is "the sigma for gaussian kernel"; corner boost "adds an offset to the sigma of the kernel used for the outer regions." | https://discuss.pixls.us/t/new-tool-capture-sharpening/14197 |
| Auto contrast threshold | "By default the tool analyzes the image and calculates a threshold to prevent sharpening noise." | https://rawpedia.pixls.us/capture_sharpening/ |
| Linear data | "It is applied to the raw file immediately after demosaicing and modifies the data in linear gamma to limit halo generation." | RawPedia (above) |
| Iterative | "It is an iterative process, which will produce artifacts if carried too far." | RawPedia |
| Corner boost | "Often images are softer or more blurred in the corners than in the center." | RawPedia |
| Denoise around CS | Pre-sharpening denoise: "In order for Capture Sharpening to work on noisy or very noisy images, applies either:" (median or wavelet). Post-sharpening: "For raw images, allows you initial denoising after Capture Sharpening taking into account the mask information." | RawPedia |
| Main NR comes later | RT's Toolchain Pipeline puts "Demosaic" at step 2 and "Noise reduction" at step 9 (after colour-space conversion). | https://rawpedia.pixls.us/toolchain_pipeline/ |
| Advantages over normal RL | heckflosse: "CS is applied very early in the processing on linear data directly after demosaic to minimize halos"; "CS features automatic contrast threshold calculation" | https://github.com/Beep6581/RawTherapee/issues/5453 |

RawPedia gives **no** default for iterations or corner boost **[unconfirmed]**.

### 1.3 darktable denoise (profiled)

| Fact | Quote | Source |
|---|---|---|
| Pipe position | Scene-referred default order: "7. raw denoise, 8. demosaic, 9. denoise (profiled)", then lens correction (13), exposure (22), tone equalizer (24), input color profile (29), diffuse or sharpen (31), sharpen (40). | https://www.darktable.org/usermanual/en/special-topics/module-order/ |
| Why before input profile | "is placed before the _input color profile_ module in the pixelpipe" | dtdocs `denoise-profiled.md` |
| Modes | "implements two algorithms, each of which is available in either an easy-to-use "auto" mode" (non-local means, wavelets) | https://docs.darktable.org/usermanual/4.6/en/module-reference/processing-modules/denoise-profiled/ |
| Code defaults | `mode $DEFAULT: MODE_WAVELETS`; `wavelet_color_mode $DEFAULT: MODE_Y0U0V0`; `radius` "patch size" 1.0; `nbhood` "search radius" 7.0; `strength` 1.0; `shadows` "preserve shadows" 1.0; `bias` "bias correction" 0.0; `scattering` 0.0; `central_pixel_weight` 0.1; `overshooting` "adjust autoset parameters" 1.0; `use_new_vst` TRUE; `wb_adaptive_anscombe` TRUE | raw.githubusercontent.com/darktable-org/darktable/master/src/iop/denoiseprofile.c |
| Mode enum | `MODE_NLMEANS = 0`, `MODE_WAVELETS = 1`, `MODE_VARIANCE = 2`, `MODE_NLMEANS_AUTO = 3`, `MODE_WAVELETS_AUTO = 4` | denoiseprofile.c |
| Not enabled by default | `flags()` returns only `IOP_FLAGS_SUPPORTS_BLENDING \| IOP_FLAGS_ALLOW_TILING`; no default-enabled field was seen (the fetch was truncated, so not conclusive). The only built-in preset is "wavelets: chroma only". | denoiseprofile.c |
| Y0U0V0 | "The preferred way to use wavelets is with the _Y0U0V0_ color mode." | dtdocs `denoise-profiled.md` |
| Cost | NLM: "Note that this algorithm is quite resource-intensive." Wavelets: "The wavelet algorithm is less resource-intensive than _non-local means_." | dtdocs `denoise-profiled.md` |
| VST | Code comment: "In the generalized anscombe transform, the profiles gives a and b such as:"; "the "v2" variance stabilizing transform is an extension of the generalized" … | denoiseprofile.c |
| Coverage | "Currently, darktable has sensor noise profiles for over 300 popular camera models from all the major manufacturers." | dtdocs `denoise-profiled.md` |

**Not done: counting cameras in `noiseprofiles.json`.** `gh api` is not enabled for this session. WebFetch of the raw file returned only the first ~15 Canon entries before truncation. The count is therefore **[unconfirmed]** beyond the manual's "over 300".

### 1.4 Lightroom Detail-panel semantics

| Fact | Quote | Source |
|---|---|---|
| Amount is a USM variant | Amount is "a variation of the Unsharp Mask technique," … "with zero turning it off completely." | https://helpx.adobe.com/camera-raw/using/sharpening-noise-reduction-camera-raw.html |
| Radius | "Adjusts the size of the details to which sharpening is applied." | same |
| Detail | "Lower settings primarily sharpen edges to remove blurring." Higher values "help make the textures in the image more pronounced." | same |
| Masking 0 / 100 | "Everything in the image receives the same sharpening if it's set to zero." At 100, sharpening is "restricted to areas near the most robust edges." | same |
| Detail → deconvolution | MadManChan2000 (badge: Adobe employee): "Yes, moving Detail towards 100 will use a deconvolution-based method to sharpen the image." | https://community.adobe.com/t5/photoshop-ecosystem-discussions/lightroom-quot-deconvolution-quot-sharpening-vs-photoshop-smart-sharpen-lens-blur-removal/m-p/12835949 |
| Detail "blends" (book, not Adobe docs) | Jeff Schewe: "The default setting of 25 has very little deconvolution sharpening and a lot of halo suppression." "At the default Detail setting of 25, there is still a touch of deconvolution sharpening being blended in" | https://www.peachpit.com/articles/article.aspx?p=2436665 |
| Raw default Amount 40 (since LrC 7.3) | "The default sharpening setting for raw files has changed from 25 to 40." | https://www.lightroomqueen.com/whats-new-in-lightroom-classic-73/ (independent expert site, not Adobe) |
| Radius 1.0 default | Schewe: "I moved from the default 1.0 Radius setting to a setting of 2.0." | Peachpit (above) |
| NR sliders | Luminance Detail: "Controls the luminance noise threshold." Luminance Contrast: "Controls the luminance contrast." Color Detail: "Controls the color noise threshold." | Camera Raw help (above) |
| Smoothness | "Smooth out color variations; higher values create softer color transitions, while lower values retain more texture." | https://helpx.adobe.com/ee/lightroom/mobile/adjust-light-and-color/adjust-details.html |

- **[unconfirmed]**: that Detail *blends* USM and deconvolution across its whole range. Adobe's docs never say this. An Adobe employee's forum post confirms only that values "towards 100" use deconvolution.
- **[unconfirmed]**: the default Detail 25 and Masking 0. Schewe's book and secondary tutorials agree (e.g. digitalcameraworld lists "Amount: 40", "Radius: 1.0", "Detail: 25", "Masking: 0" for one camera), but no Adobe page gives them.
- **[unconfirmed]**: the NR defaults (Color 25, Color Detail 50, Smoothness 50, Luminance Detail 50). No Adobe page lists them.

### 1.5 Is darktable's `sharpen` "no longer recommended"?

Yes. The current dtdocs source says: "The USM algorithm used in this module performs blurs in Lab color space, which can produce undesirable effects," "and is no longer recommended." "Instead use the presets offered by the contrast equalizer module for deblurring" "or the local contrast module for general sharpness." (raw.githubusercontent.com/darktable-org/dtdocs/master/content/module-reference/processing-modules/sharpen.md; same text in the 4.6 manual.)

The **code** does not deprecate it, though: `flags()` has no deprecated flag and there is no `deprecated_msg()`. Defaults are radius 2.0, amount 0.5, threshold 0.5 (`src/iop/sharpen.c`). The 5.6 HTML manual page returned server errors, so I used the dtdocs Markdown source instead.

### 1.6 Order: denoise before sharpening?

- **For "denoise first":** darktable's diffuse-or-sharpen manual says "denoising should always happen before any attempt at sharpening or increasing acutance," and to "ensure the issues are corrected from coarse scale to fine scale, and that denoising always happens first." (dtdocs `diffuse.md`.)
- **Against (reference practice):** darktable's capture sharpening is in demosaic (position 8), before denoise (profiled) (position 9). RawTherapee's runs "right after demosaicing", well before its "Noise reduction" step. Both protect noise with a mask instead of denoising first.
- **[analysis]** LightBench's order (profiled denoise → RL) is defensible:
  - darktable's profile maths (generalized Anscombe with per-camera *a*, *b*) assumes **unaltered raw noise statistics**. RL run before it changes those statistics near edges.
  - RL on denoised data amplifies less noise.
  - Both steps still sit before the input colour profile, which is what the diffuse manual asks of deblurring ("move the module before the _input color profile_ module").
  - **Risks:**
    - RL can amplify wavelet-denoise artefacts. Keep the contrast-sensitivity mask.
    - Auto-radius estimated on *denoised* data may come out larger. Estimate it on the pre-denoise demosaiced luminance, as darktable does.
  - This order is **not** bit-compatible with darktable's output, which matters only if matching darktable renders is a goal.

### 1.7 Is "Amount 40" meaningful?

Only as a UI convention. Lightroom's 40 is the strength of a USM-variant (Adobe help, above). RL has iterations, radius and a threshold, but no amount. A mapping where **Amount 40 = darktable's reference result** (auto radius, 8 iterations, full strength) gives the number a concrete meaning. See section 4.

---

## 2. Summary tables

### 2.1 Classical noise reduction

| Method | Domain / position | Licence of usable code | Quality notes | Speed / GPU-friendliness |
|---|---|---|---|---|
| **darktable denoise (profiled), wavelets, Y0U0V0** (darktable code default) | Linear camera RGB after demosaic, before input profile; per-camera VST | GPL-3.0 (darktable) | Separate luma and chroma; per-band curves; profile-driven | "less resource-intensive than non-local means"; à-trous wavelets map well to compute shaders **[analysis]** |
| **darktable denoise (profiled), NLM** | Same | GPL-3.0 | Strong on fine texture; patch size 1, search radius 7 by default | "quite resource-intensive"; per-pixel search is GPU-able but heavy at 24 MP+ **[analysis]** |
| darktable raw denoise | CFA before demosaic (position 7) | GPL-3.0 | Wavelet threshold on CFA **[unconfirmed details]** | Cheap |
| darktable astrophoto denoise / surface blur | Later in pipe (34 / 10) | GPL-3.0 | NLM and bilateral variants; not profile-driven **[unconfirmed details]** | Moderate |
| RawTherapee Noise Reduction | Lab or RGB, step 9 | GPL-3.0 | "uses wavelets, a Fourier transform and a median filter"; auto chroma; chroma preview analysis "only operational when zoomed to 100% or more" | Heavier; median windows "The larger the size, the longer it takes." (https://rawpedia.pixls.us/noise_reduction/) |
| **BM3D (TUT reference)** | Any | **Non-commercial: excluded** (see §6) | Strong benchmark baseline; in the RawNIND paper, BM3D scores MS-SSIM 0.906 (linear RGB) vs 0.956 for the Bayer U-Net | Block matching plus 3D transforms; hard to make interactive at full resolution **[analysis]** |
| **BM3D (IPOL, Lebrun 2012)** | Any | `GPL-3.0-or-later` (https://www.ipol.im/pub/art/2012/l-bm3d) | Same algorithm, open implementation | Same as above |
| **NL-Bayes (IPOL 2013)** | Any | `GPL-3.0-or-later` (https://www.ipol.im/pub/art/2013/16) | "achieves the best state of the art on color images in terms of PSNR"; on grey "similar to the more complex BM3D-SAPCA" | Patch grouping plus per-group covariance; GPU-able but complex **[analysis]** |
| Guided filter (He et al.) | Any | Simple to implement from the paper | Edge-preserving smoothing, weaker than NLM or wavelets as a denoiser **[analysis]**; already in LightBench via the tone equalizer | Very cheap (box filters) |

**BM3D patents (facts only).** No patent assigned to Tampere University or Noiseless Imaging covering BM3D turned up in my searches. Absence is **[unconfirmed]**. Related patents by others:

| Patent | Assignee | Status | Gist of claim 1 | Source |
|---|---|---|---|---|
| **US 9,123,103 B2**, "Method and apparatus for image denoising with three-dimensional block-matching" | Xueshan Technologies (orig. MediaTek) | Priority 2013-12-26; **Active**; anticipated expiry 2034-03-25 (Google's estimate) | Claim 1 opens "An image noise reduction method, the method comprising:" (receive a noisy image, select a reference patch, determine an "assessed noise variance" for a patch set) | https://patents.google.com/patent/US9123103 |
| US 9,230,161 B2, multiple-layer block matching | Xerox | **Expired – fee related** | Groups similar blocks, filters them collaboratively, splits multi-layer clusters | https://patents.google.com/patent/US9230161 |
| US 9,990,699 B1, block-match denoising for real-time imaging | Rockwell Collins | **Expired – fee related** (lapse logged 2026-07-13) | Streaming scan-line denoising | https://patents.google.com/patent/US9990699 |
| US 9,159,121 B2 (pub. US20150235350A1), "Method for Image Denoising" | Signal Processing, Inc. | **Expired – fee related** (2019-11-18) | Compared against BM3D; not BM3D's owner | https://patents.google.com/patent/US20150235350A1/en |

### 2.2 Classical capture sharpening

| Method | Where | Halos | Noise amplification | Interactive GPU cost | Status |
|---|---|---|---|---|---|
| USM (darktable `sharpen`) | Lab L, position 40 | Prone at high radius ("Very high values will lead to ugly over-sharpening") | Threshold only | Trivial | "no longer recommended" (manual) |
| **diffuse or sharpen** | Position 31 (move before input profile for deblur) | Warned: "Increase if you notice edge artifacts like fringes and halos." | "can cause noise to blow-up really fast" | "runtime increases with the number of iterations and OpenCL is therefore strongly recommended" | Presets: "lens deblur \| soft/medium/hard" (8/16/24 iterations), "sharpen demosaicing \| no AA filter / AA filter" (1), "sharpness \| fast/normal/strong" (1/3/6) (`src/iop/diffuse.c`) |
| **RL capture sharpening** (darktable 5.4+, RT 5.8+) | Linear RGB luminance, right after demosaic | Low in linear space; grows if radius exceeds auto | Contrast-sensitivity mask suppresses it | 8 iterations × 2 small Gaussian blurs on full-resolution luminance. PR author calls it computationally heavy on CPU. On WebGPU, **[estimate]** ~10–50 ms per 24 MP frame on a discrete GPU, ~50–200 ms on integrated | Current best practice in both open-source references |
| Lightroom sharpening | Not published | Detail low = "halo suppression" (Schewe) | Masking | Not published | USM variant; deconvolution "towards 100" Detail (Adobe employee) |

### 2.3 AI denoise models

The code licence and weights licence were checked separately. "Not stated" means the repo gives no separate terms for its weights (then only the repo licence applies, and that is an **assumption**). Parameter counts marked **[unconfirmed]** come from memory and were not verified in this session.

| Model | Code licence | Weights licence | Training data | Input | Size / cost | Browser port / published speed |
|---|---|---|---|---|---|---|
| **RawNIND UtNet2** (darktable `rawdenoise-nind`) | GPL-3.0 (`trougnouf/rawnind_jddc`) | Upstream: "The weights are dual licensed GPL3 + CC-BY-4.0". darktable-ai card: "Model license \| GPL-3.0" | RawNIND, "CC BY 4.0 / CC0 (per-image, Wikimedia Commons)" | Bayer: "4ch packed Bayer [R,G1,G2,B]" → "3ch camRGB at 2× spatial". Linear: "3ch linear Rec.2020" | Bayer U-Net 55 GMAC/MP; RGB U-Net 220 GMAC/MP (arXiv 2501.08924 Table II) | ONNX exists (darktable-ai), fixed 512×512 tiles. No browser port found. darktable: "On a GPU it's a few seconds; on CPU expect tens of seconds for the full frame." |
| **NIND UNet** (darktable `denoise-nind`) | GPL-3.0 (`trougnouf/nind-denoise`) | darktable-ai card: GPL-3.0; upstream page: not stated | NIND, CC BY 4.0 / CC0 per image | RGB [0,1], 768×768 tiles | Not stated | ONNX exists; no browser port found |
| **NAFNet** | MIT ("Copyright (c) 2022 megvii-model"); bundles BasicSR under Apache-2.0 | Not stated upstream (Google Drive / Baidu); darktable-ai card: MIT | SIDD: "The dataset and the associated code repositories are under the MIT License." | sRGB | SIDD-width64 40.30 dB; ~116 M params (width64), ~29 M (width32) **[unconfirmed]** | darktable-ai ONNX (768×768). No published browser speed |
| **Restormer** | MIT ("Copyright (c) 2022 Syed Waqas Zamir and contributors") | Not stated (Google Drive) | SIDD for real denoise | sRGB | ~26 M params **[unconfirmed]**; heavy attention | None found |
| **SCUNet** | Apache-2.0 | Not stated (`model_zoo`) | Synthetic: "purely synthetic training data!" | sRGB | ~18 M params **[unconfirmed]** | None found |
| **Uformer** | MIT | Not stated (university SharePoint; links have expired before) | SIDD | sRGB | Uformer-B ~51 M **[unconfirmed]** | None found |
| **SwinIR** | Apache-2.0 ("Please also follow their licenses" for Swin/KAIR) | Not stated (GitHub Releases) | DIV2K, Flickr2K, BSD500, WED (synthetic Gaussian noise) | sRGB, Gaussian σ 15/25/50 | SR model 11.9 M | None found for denoise |
| **HAT** | Apache-2.0 | Not stated | n/a | **Super-resolution only** (denoise listed as "(To do)") | 20.8 M (HAT-S 9.6 M) | n/a for denoise |
| **DRUNet / DPIR** (KAIR) | MIT | Not stated | Synthetic Gaussian, noise-level map | sRGB | ~32.6 M params **[unconfirmed]** | None found |
| **PMRID** | Apache-2.0 | Not stated (in repo `models/`) | Authors' phone-sensor data | Raw Bayer uint16 | Small mobile net **[unconfirmed size]** | None found |
| **SID** (Learning to See in the Dark) | MIT | Not stated | SID Sony/Fuji; "cite our paper" | Raw; "does not work for images after camera ISP" | U-Net | None |
| **ELD** | MIT | Not stated | ELD dataset "for evaluation purposes only"; calibration method withheld for "business license" reasons | Raw | U-Net | None |

**Browser runtime status.** I found **no** published WebGPU or ONNX Runtime Web speed for any of these denoisers.

**[estimate]** Browser cost, worked through for one case:
- RawNIND Bayer at 55 GMAC/MP on a 24 MP raw is about 1.3 TMAC.
- At a sustained 1–4 TFLOP/s in WebGPU fp16/fp32, that is roughly **1–5 s** on a discrete GPU and **5–30 s** on an integrated one.
- That is a button with a progress bar, not a live slider.

### 2.4 Commercial context

| Product | Workflow | Quote | Source |
|---|---|---|---|
| **Lightroom Classic 14.4+** (June 2025) | Denoise, Raw Details and Super Resolution live in the Detail panel; pixel data is generated and stored | Adobe: "You can now access Denoise, Raw Details, and Super Resolution in the Detail panel, as these features are now available as standard edit panel features." Lightroom Queen: "without needing to generate a separate DNG file"; "the new pixel data is stored in the .lrcat-data file alongside the catalog." | https://helpx.adobe.com/il_en/lightroom-classic/desktop/process-and-develop-photos/enhance-details.html (updated 1 May 2026); https://www.lightroomqueen.com/whats-new-in-lightroom-2025-06/ |
| (stale Adobe page) | One Adobe help variant still says "Select Enhance to process the image as a new DNG file." It was last updated 13 Aug 2025 and conflicts with the above. | | https://helpx.adobe.com/lightroom-classic/desktop/help/enhance-details-alt.html |
| Latest LrC | "September 2026 release (version 15.6)" | | https://helpx.adobe.com/lightroom-classic/help/whats-new/release-notes.html |
| **DxO PhotoLab 8** | DeepPRIME XD2s; live loupe preview, full render on export | XD2s is "the second generation of what DxO says is 'the most advanced noise reduction and detail extraction technology on the market.'" DxO's site now lists "DeepPRIME 3" and XD3, "for Bayer and X-Trans sensors." | https://www.provideocoalition.com/dxo-photolab-8-deepprime-xd2s-hue-masks-and-a-loupe/; https://www.dxo.com/en/technology/deepprime/ |
| **Topaz Photo AI** | Separate app; Lightroom raw plugin returns a DNG | Output is a DNG for raw (TIFF if lighting or colour tools are used) | https://docs.topazlabs.com/photo-ai/plugins/lightroom-classic |
| **Capture One 16.8 (beta)** | "Enhanced Denoise", built into the NR tool, no separate file | "The 16.8 beta released in late April introduced Enhanced Denoise" | https://www.photoworkout.com/?p=221017 (secondary; GA status **[unconfirmed]**) |
| **darktable 5.6** | "Neural restore" outside the pixelpipe; writes a new image | "this isn't part of the pixel pipeline"; "The result lands as a new image in the same film roll alongside the original."; raw denoise "outputs a Bayer CFA DNG" | https://www.darktable.org/2026/06/meet-darktable-5.6-ai-tools/ |

---

## 3. Theory notes (Poisson–Gaussian, Anscombe, PSF)

- **Noise model.** darktable's profiling article: the noise "follows a poissonian-gaussian distribution", fitted as σ(y) = √max(0, a·y + b). The VST aims to "map variance to unity uniformly all over the image" (https://www.darktable.org/2012/12/profiling-sensor-and-photon-noise/).
- **Generalized Anscombe.** Mäkitalo & Foi: the transform produces "a signal in which the noise can be treated as additive Gaussian noise with unitary variance." Reference: IEEE TIP 22(1):91–103, 2013, DOI 10.1109/TIP.2012.2202675 (https://webpages.tuni.fi/foi/invansc/). Their **reference code** is under the TUT limited licence ("industrial or profit-oriented activities is expressively prohibited"). LightBench should use darktable's GPL implementation (`precondition_v2`, `use_new_vst`), not the TUT code.
- **RAW-domain vs RGB-domain** **[analysis]**:
  - Denoising before the colour matrix keeps the noise close to Poisson–Gaussian and per-channel independent, which is what profiles describe.
  - After the matrix, noise becomes correlated across channels.
  - RawNIND's Bayer models need "only a quarter of the computations needed for fully debayered linear RGB images" (arXiv 2501.08924).
- **Diffraction PSF.** Edmund Optics: "…or minimum spot size, can be estimated using the f/# and wavelength (λ):" Ø ≈ 2.44 × λ × (f/#). Wikipedia says a Gaussian approximation's waist "is about two-third the Airy disk radius". The coefficient σ ≈ 0.42 λN is **[unconfirmed]** (the equation did not render).
  - **[estimate]** Worked example at λ = 0.55 µm and 4 µm pixel pitch:

    | f-number | Airy disk diameter | Gaussian σ |
    |---|---|---|
    | f/8 | ≈ 10.7 µm (2.7 px) | ≈ 0.46 px |
    | f/16 | ≈ 21.5 µm (5.4 px) | ≈ 0.92 px |

    darktable gives typical capture-sharpening radii of 0.5–0.8 on modern sensors.
  - **Use [analysis]:** EXIF FNumber plus sensor pitch from a camera table gives a cheap **diffraction floor and sanity cap** for auto-radius. It cannot replace content-based estimation, because AA filter, demosaic and defocus blur add to the PSF.

---

## 4. Recommendation: the Detail panel (classical)

### 4.1 Pipeline (firm)

```
rawprepare → highlight reconstruction → demosaic (RCD / Markesteijn)
  → [NR]  darktable denoise (profiled), wavelets, Y0U0V0, per-camera profile   (darktable position 9)
  → [SH]  RL capture sharpening (darktable 5.4 algorithm, luminance, contrast-sensitivity mask,
          auto radius computed on PRE-denoise demosaiced luminance, corner boost)
  → colour (camera matrix / WB) → exposure → tone EQ → sigmoid
```

Both steps run in linear camera RGB before the input colour profile, as darktable's docs require for each. Put the whole Detail panel behind a **process version**. Pin the RL auto-radius to one darktable revision, either 5.4 or 5.6's "central 60%".

### 4.2 Sharpening: RL capture sharpening (keep the decision)

| LightBench slider (Lightroom name) | Range / default | Maps to | Notes |
|---|---|---|---|
| **Amount** | 0–150, **default 40 for new RAWs** | Blend gain *g* = Amount/40 on the RL difference: out = in + g·(RL₈ − in). 0 skips the pass. | Amount 40 = darktable's reference result. Values >40 extrapolate (more haloing). Cap *g* at ~2.5 and tune visually **[analysis, new design]**. |
| **Radius** | 0.5–3.0, **default 1.0** | Gaussian σ = auto-σ × Radius, clamped to darktable's 0–1.5 range | 1.0 means "auto". darktable: "Do not manually increase the radius much further than the auto-calculated value." |
| **Detail** | 0–100, **default 25** | Iterations = 4 + round(Detail × 0.16), so 25 → 8 (darktable default) and 100 → 20 (darktable max is 25) | Low Detail = fewer iterations = gentler, fewer halos. This echoes Schewe's "halo suppression" at low Detail. Cost scales with Detail. |
| **Masking** | 0–100, **default 0** | 0 = darktable's automatic contrast-sensitivity mask only (`cs_thrs` auto from ISO and bit depth; flat noisy areas are protected). 1–100 = adds a Lightroom-style edge mask on top. Alt/Option-drag shows the mask. | This differs slightly from Lightroom's "everything receives the same sharpening" at 0. A hidden noise guard is kept on purpose. |
| *(advanced)* Corner boost | 0–1.5, default 0 | `cs_boost`, `cs_center` | darktable defaults: 0 |

**On by default, firm with a guard.**
- On at Amount 40 for new RAWs **with ISO < 1000**, following darktable's "generally safe" threshold.
- At ISO ≥ 1000, either still default to 40, relying on prior denoise plus the mask, or fall back to a lower default. This is an **owner decision** (see Open questions).

### 4.3 Noise reduction: darktable denoise (profiled), wavelets + Y0U0V0

| LightBench slider | Default | Maps to (darktable wavelet Y0U0V0) |
|---|---|---|
| **Luminance** | 0 (off) | Y0 global strength multiplier (darktable `strength`, profile-scaled) |
| **Detail** (lum) | 50 | Y0 finest-band protection: higher = less denoising in the finest 1–2 wavelet bands |
| **Contrast** (lum) | 0 | Y0 coarse-band protection: higher = keeps low-frequency contrast, risks mottling |
| **Color** | 25 **[Lightroom default unconfirmed]** | U0V0 global strength. 25 ≈ darktable's built-in "wavelets: chroma only" preset level **[tune]** |
| **Detail** (color) | 50 | U0V0 finest-band protection |
| **Smoothness** (color) | 50 | U0V0 coarse-band strength (removes low-frequency colour blotches) |

- **Hidden** at darktable defaults: preserve shadows 1.0, bias correction 0.0, `use_new_vst` and `wb_adaptive_anscombe` TRUE.
- **Advanced toggle:** NLM mode (patch 1, search 7) as an optional "high quality" mode. darktable calls NLM "quite resource-intensive".
- **Cameras without a profile:** the darktable manual describes no generic fallback **[unconfirmed]**. LightBench needs a fallback, for example estimating *a*, *b* from flat patches, or a generic profile **[analysis]**.

---

## 5. Recommendation: Phase 4 AI denoise

**General shape (both cases).**
- An explicit **"AI Denoise" toggle with an Amount slider** in the Detail panel, generated once and cached. This follows Lightroom 14.4: "Because it generates pixel data, it differs from a normal slider or checkbox".
- Insert it **in place of** profiled NR when on, at the same pipe position.
- Store the result in OPFS, keyed by file hash plus model and version, so old edits re-render identically.
- Never upload anything.

### (i) Permissive-only

1. **Primary: NAFNet (SIDD) re-exported by LightBench to ONNX from upstream weights.** Code MIT; SIDD data MIT; the darktable-ai card lists the model as MIT.
   - Caveat: upstream gives no separate weight licence.
   - Do **not** copy darktable-ai's conversion scripts; that repo is GPL-3.0.
   - **Domain caveat:** the SIDD-trained NAFNet takes **sRGB [0,1]**. LightBench must apply it to a display-encoded intermediate and invert, or fine-tune on linear data. Expect a quality loss on scene-referred input **[analysis]**.
2. **Alternative: SCUNet (Apache-2.0).** Blind, synthetic training ("purely synthetic training data!"); same sRGB caveat.
3. **Raw-domain permissive option: PMRID (Apache-2.0, raw Bayer).** Small, but trained on specific phone sensors. Generalisation to DSLR or mirrorless sensors is **[unconfirmed]**.

### (ii) GPL accepted

**RawNIND UtNet2** (darktable 5.6's default raw-denoise model):
- Bayer and **linear Rec.2020** variants match LightBench's scene-referred pipeline directly.
- Trained on images released as CC BY 4.0 or CC0.
- 55 GMAC/MP in Bayer form.
- In the RawNIND paper it beats BM3D on MS-SSIM (0.956 vs 0.906).
- It is GPL-3.0, the same as LightBench's own licence. The owner's open question is policy, not compatibility.
- **First, ask the author** whether "dual licensed GPL3 + CC-BY-4.0" means *either* licence. If yes, the CC-BY-4.0 route would meet the permissive-only rule (with attribution), and RawNIND becomes the recommendation in case (i) too.

---

## 6. Exclusions (with quotes)

| Item | Why excluded | Quote | Source |
|---|---|---|---|
| BM3D reference code (pip `bm3d` 4.0.3, MATLAB) | Non-commercial | "The package is available for non-commercial use only." / "Free for non-commercial use" | https://pypi.org/project/bm3d/ ; https://webpages.tuni.fi/foi/GCF-BM3D/README_BM3D_4p0.txt |
| All TUT GCF-BM3D software (BM4D, CBM3D, etc.) | Non-profit only | "The following software is available exclusively for non-profit education and scientific research." "Any unauthorized use of the software for industrial or profit-oriented activities is expressively prohibited." | https://webpages.tuni.fi/foi/GCF-BM3D |
| TUT generalized Anscombe inverse code | TUT limited licence | "industrial or profit-oriented activities is expressively prohibited" | https://webpages.tuni.fi/foi/invansc/ |
| ELD dataset (for training or fine-tuning) | Evaluation only (dataset, not code) | dataset is for "evaluation purposes only" | https://github.com/Vandermode/ELD |
| darktable `sharpen` (USM) as LightBench's method | Upstream advises against it | "and is no longer recommended." | dtdocs `sharpen.md` |
| HAT for denoise | Not a denoiser yet | Restoration tasks listed as "(To do)" | https://github.com/XPixelGroup/HAT |

Not excluded, but note: the IPOL BM3D and NL-Bayes implementations are `GPL-3.0-or-later`, which is compatible with LightBench.

---

## 7. Invented-detail risk

- **RL capture sharpening** inverts an assumed Gaussian blur. It does not invent texture, but it can create **halos and ringing**, mainly if the radius exceeds the true PSF (darktable warns about this). It amplifies noise ("sensor noise will typically be amplified"). Defences: auto radius, the contrast-sensitivity mask, and an iteration cap.
- **AI denoise / sharpen / super-resolution can hallucinate.** Blau & Michaeli prove "distortion and perceptual quality are at odds with each other" (https://arxiv.org/abs/1711.06077). Models tuned for perceived sharpness trade away fidelity, and synthetic-noise models (SCUNet, DRUNet, SwinIR) can invent texture on real sensor noise **[analysis]**.
- **Mitigations [analysis]:**
  - An Amount blend with the classical result.
  - A 1:1 before/after loupe, as in DxO.
  - Keep the original pixels: a cached layer, never destructive.
  - Label AI output in the history.
  - Prefer fidelity-trained (L1/PSNR) models over GAN or diffusion restorers for denoise.

---

## 8. Open questions for the owner

1. **Default on at high ISO?** darktable only calls auto-applying capture sharpening safe below ISO 1000. Should LightBench turn it on at 40 for every new RAW, or only below ISO 1000 (lower or off above)?
2. **Masking 0 behaviour:** is it OK that Masking 0 still keeps a hidden "don't sharpen noise" guard, unlike Lightroom's "everything gets the same sharpening"?
3. **Matching darktable exactly:** do you need LightBench's Detail panel to match darktable's output pixel for pixel? If yes, the order must be sharpen-then-denoise, as darktable does it.
4. **RawNIND licence:** may I (or you) ask the author whether "GPL3 + CC-BY-4.0" means you can choose CC-BY-4.0? If yes, RawNIND would fit the permissive-only rule.
5. **GPL weights in general:** LightBench itself is GPL-3.0, so GPL weights cause no licence clash. Is "undecided" about policy (keeping the option to relicense later) or about compatibility?
6. **Unprofiled cameras:** for cameras without a darktable noise profile, should LightBench estimate the noise itself or fall back to a generic profile?
7. **AI denoise UX:** should it be a cached "generate once" toggle like Lightroom 14.4, accepting a few seconds per photo, or a separate export-time step like darktable 5.6's "neural restore"?

---

## 9. Items I could not verify

- The count of camera models in `noiseprofiles.json`. `gh api` was refused and WebFetch truncated the file. The manual says "over 300".
- Lightroom's default Detail 25, Masking 0 and the NR defaults: no Adobe page states them. Amount 40 comes from Lightroom Queen, not Adobe.
- That Lightroom's Detail *blends* USM and deconvolution across its range. Only "towards 100 … deconvolution" is confirmed, by an Adobe employee on a forum.
- RawTherapee CS default iterations and corner boost.
- Parameter counts for NAFNet, Restormer, SCUNet, Uformer, DRUNet and PMRID, and any published browser speed for any denoiser.
- Whether any patent covers BM3D itself. None was found for Tampere or Noiseless Imaging.
- Capture One Enhanced Denoise GA status.
- darktable 5.6 HTML manual pages for sharpen, diffuse and denoise-profiled returned server errors. I used the dtdocs Markdown sources and the 4.6 manual instead.

---

## Sources

**darktable**
- 5.4.0 release: https://www.darktable.org/2025/12/darktable-5.4.0-released/ ; date: https://linuxiac.com/darktable-5-4-raw-photo-editing-tool-released/
- 5.6.0 release: https://www.darktable.org/2026/06/darktable-5.6.0-released/ ; date: https://ubuntuhandbook.org/index.php/2026/06/darktable-released-5-6-0-with-optional-ai-support-heif-export/
- 5.6 AI tools: https://www.darktable.org/2026/06/meet-darktable-5.6-ai-tools/ ; https://docs.darktable.org/usermanual/5.6/en/special-topics/ai/overview/
- Demosaic manual (5.6): https://docs.darktable.org/usermanual/5.6/en/module-reference/processing-modules/demosaic/
- dtdocs sources: `demosaic.md`, `denoise-profiled.md`, `sharpen.md`, `diffuse.md` at raw.githubusercontent.com/darktable-org/dtdocs/master/content/module-reference/processing-modules/
- Module order: https://www.darktable.org/usermanual/en/special-topics/module-order/
- Denoise (profiled) 4.6 manual: https://docs.darktable.org/usermanual/4.6/en/module-reference/processing-modules/denoise-profiled/
- Sharpen 4.6 manual: https://docs.darktable.org/usermanual/4.6/en/module-reference/processing-modules/sharpen/
- Source: `src/iop/denoiseprofile.c`, `src/iop/demosaic.c`, `src/iop/demosaicing/capture.c`, `src/iop/diffuse.c`, `src/iop/sharpen.c` (raw.githubusercontent.com/darktable-org/darktable/master/…)
- Noise profiling article: https://www.darktable.org/2012/12/profiling-sensor-and-photon-noise/
- Capture sharpening threads: https://discuss.pixls.us/t/capture-sharpening-simply-thank-you/51574 ; https://discuss.pixls.us/t/blender-agx-in-darktable-proof-of-concept/48697/1647
- NR changes 3.0: https://discuss.pixls.us/t/changes-in-noise-reduction-for-darktable-2-7-3-0/14672
- darktable-ai: https://github.com/darktable-org/darktable-ai ; model cards `models/rawdenoise-nind`, `models/denoise-nind`, `models/denoise-nafnet` ; https://discuss.pixls.us/t/ai-models-for-dt/60655

**RawTherapee**
- 5.8 release notes: https://www.rawtherapee.com/downloads/5.8
- Capture Sharpening: https://rawpedia.pixls.us/capture_sharpening/
- Toolchain pipeline: https://rawpedia.pixls.us/toolchain_pipeline/
- Noise reduction: https://rawpedia.pixls.us/noise_reduction/
- Sharpening: https://rawpedia.rawtherapee.com/Sharpening
- Issues: https://github.com/RawTherapee/RawTherapee/issues/5412 ; https://github.com/Beep6581/RawTherapee/issues/5453
- Capture sharpening thread: https://discuss.pixls.us/t/new-tool-capture-sharpening/14197

**Adobe and other commercial**
- Camera Raw help: https://helpx.adobe.com/camera-raw/using/sharpening-noise-reduction-camera-raw.html
- Lightroom Classic retouch: https://helpx.adobe.com/ca/lightroom-classic/desktop/process-and-develop-photos/retouch-photos.html
- Lightroom mobile details: https://helpx.adobe.com/ee/lightroom/mobile/adjust-light-and-color/adjust-details.html
- Enhance: https://helpx.adobe.com/il_en/lightroom-classic/desktop/process-and-develop-photos/enhance-details.html ; https://helpx.adobe.com/lightroom-classic/desktop/help/enhance-details-alt.html
- Release notes: https://helpx.adobe.com/lightroom-classic/help/whats-new/release-notes.html
- Forum and expert sources:
  - https://community.adobe.com/t5/photoshop-ecosystem-discussions/lightroom-quot-deconvolution-quot-sharpening-vs-photoshop-smart-sharpen-lens-blur-removal/m-p/12835949
  - https://community.adobe.com/t5/lightroom-classic-discussions/lightroom-v7-3-sharpening-amount-default-setting/m-p/9770952
  - https://www.lightroomqueen.com/whats-new-in-lightroom-classic-73/
  - https://www.lightroomqueen.com/whats-new-in-lightroom-2025-06/
  - https://www.peachpit.com/articles/article.aspx?p=2436665
  - https://www.digitalcameraworld.com/tutorials/how-to-change-lightroom-classics-default-sharpening-and-noise-settings
  - https://blog.thomasfitzgeraldphotography.com/blog/2025/6/lightroom-144-released-big-changes-to-raw-details-denoise-and-super-resolution
- DxO: https://www.dxo.com/en/technology/deepprime/ ; https://www.provideocoalition.com/dxo-photolab-8-deepprime-xd2s-hue-masks-and-a-loupe/
- Topaz: https://docs.topazlabs.com/photo-ai/plugins/lightroom-classic
- Capture One (secondary): https://www.photoworkout.com/?p=221017

**Models and datasets**
- RawNIND: https://github.com/trougnouf/rawnind_jddc ; https://arxiv.org/html/2501.08924v2
- NIND: https://github.com/trougnouf/nind-denoise
- NAFNet: https://github.com/megvii-research/NAFNet (+ LICENSE) ; https://arxiv.org/abs/2204.04676
- Restormer: https://github.com/swz30/Restormer (+ LICENSE.md) ; https://arxiv.org/abs/2111.09881
- SCUNet: https://github.com/cszn/SCUNet
- Uformer: https://github.com/ZhendongWang6/Uformer
- SwinIR: https://github.com/JingyunLiang/SwinIR
- HAT: https://github.com/XPixelGroup/HAT
- DPIR: https://github.com/cszn/DPIR
- KAIR: https://github.com/cszn/KAIR
- PMRID: https://github.com/MegEngine/PMRID
- SID: https://github.com/cchen156/Learning-to-See-in-the-Dark
- ELD: https://github.com/Vandermode/ELD
- SIDD: https://abdokamel.github.io/sidd/ ; https://www.eecs.yorku.ca/%7Ekamel/sidd/

**BM3D, NL-Bayes, Anscombe, patents**
- https://pypi.org/project/bm3d/ ; https://webpages.tuni.fi/foi/GCF-BM3D ; https://webpages.tuni.fi/foi/GCF-BM3D/README_BM3D_4p0.txt
- https://www.ipol.im/pub/art/2012/l-bm3d ; https://www.ipol.im/pub/art/2013/16
- https://webpages.tuni.fi/foi/invansc/
- https://patents.google.com/patent/US9123103 ; https://patents.google.com/patent/US9230161 ; https://patents.google.com/patent/US9990699 ; https://patents.google.com/patent/US20150235350A1/en
- https://www.ipta-conference.com/ipta16/index.php/keynote-speakers (Noiseless Imaging as a TUT spin-off)

**Optics and theory**
- https://www.edmundoptics.com/knowledge-center/application-notes/imaging/limitations-on-resolution-and-contrast-the-airy-disk/
- https://en.wikipedia.org/wiki/Airy_disk
- https://arxiv.org/abs/1711.06077

---

## LightCraft notes (added 2026-10-13, Part 1 researcher)

LightCraft (storytold/lightcraft) is a Rust raw editor. Licence: "dual-licensed under MIT or Apache-2.0, at your option" (README). Read from `master`, workspace v0.7.1; commit hash not visible.

**Pipeline and slider mapping, from code:**
- Pipeline order: noise reduction runs in the scene-linear stage at output resolution (`local::denoise`). Sharpening runs in the display "finish" stage (`finish.rs`).
- NR doc comment: "Noise reduction at output resolution: luminance via an edge-aware self-guided filter on log-luminance," "colour by blurring chromaticity (rgb / Y) and re-applying the original luminance." "Radii scale with how much the source was downsampled (preview noise is already averaged out)."
- NR sliders: `nr_detail` sets the guided-filter epsilon. `nr_color_smoothness` scales the chroma blur. `nr_color_detail` keeps part of the original chroma. **`nr_contrast` does not appear in the denoise code**, although parity.md lists it.
- Sharpening is an unsharp mask on a luminance detail band: `det = l_pre - texture_blur`, then `delta += sp * 1.3 * det.clamp(-0.8, 0.8) * m`, with `sharpen = sharpen_amount / 150`. Masking is a smoothstep on `|det|`.
- The band's Gaussian radius is fixed by image size: `(0.0018 * ppl).max(0.6)`, where `ppl` = pixels on the long edge.
- **`sharpen_radius` and `sharpen_detail` are not referenced** in `finish.rs` or `local.rs`. Use elsewhere is [unconfirmed]. parity.md nevertheless lists all four sliders as ✅.
- Raw defaults (`crates/develop/src/lib.rs`): `s.detail.sharpen_amount = 40.0` and `s.detail.nr_color = 25.0`. The doc comment says Lightroom applies "capture sharpening and colour noise reduction by default to raw files". This matches LightBench's Amount 40 decision, but it is not an Adobe source.
- No deconvolution / Richardson–Lucy and no capture-sharpening stage were found. LightCraft therefore does not contradict the RL decision; it simply does not attempt it.
- Self-assessment (ROADMAP): "No measured fidelity against Lightroom (tone, highlights, texture/clarity, NR, sharpening are tuned by eye)."

**AI denoise:**
- Crate `lightcraft-denoise`: "denoise-model manifests, Bayer packing, tiling and blending, the cache file" and "pure-Rust CPU inference" (own ONNX executor; no `ort`).
- Only known model, behind the opt-in `rawnind-model` feature: "RawNIND UtNet2 (Bayer)", licence "GPL-3.0". Downloaded from `https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel` (57,700,134 bytes), tile 512, overlap 64. Doc: "Its weights are GPL-3.0; the training pictures are CC BY 4.0 and CC0." (`crates/denoise-core/src/known.rs`)
- The docs disagree on status. README: "AI Denoise 🚧 (Bayer, user-installed weights)". parity.md: ⬜ "settings field reserved, not rendered". ROADMAP: "no AI denoise". It also says "No permissively licensed sky-segmentation or raw-denoise model was found."

Sources:
- https://raw.githubusercontent.com/storytold/lightcraft/master/crates/pipeline/src/local.rs
- https://raw.githubusercontent.com/storytold/lightcraft/master/crates/pipeline/src/finish.rs
- https://raw.githubusercontent.com/storytold/lightcraft/master/crates/develop/src/lib.rs
- https://raw.githubusercontent.com/storytold/lightcraft/master/crates/denoise/Cargo.toml
- https://raw.githubusercontent.com/storytold/lightcraft/master/crates/denoise-core/src/known.rs
- https://raw.githubusercontent.com/storytold/lightcraft/master/docs/parity.md
- https://raw.githubusercontent.com/storytold/lightcraft/master/ROADMAP.md
- https://raw.githubusercontent.com/storytold/lightcraft/master/README.md
