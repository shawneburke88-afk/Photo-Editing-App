# Effects build: design brief

Research for the **Effects build**: Post-crop vignette, Grain, Dehaze, Texture, Clarity and **Glow**. It starts after the masking build, because both change the rendering engine. Compiled 2026-10-17. No app code.

This brief builds on [COLOUR_MIXER_EFFECTS.md](COLOUR_MIXER_EFFECTS.md) Part B (B.1–B.5, "Process versions"), Cowork's check of it ([cowork-2026-10-13b/A_COLOUR_MIXER_EFFECTS.md](cowork-2026-10-13b/A_COLOUR_MIXER_EFFECTS.md), with [INDEX.md](cowork-2026-10-13b/INDEX.md) and [H_IMPROVEMENTS.md](cowork-2026-10-13b/H_IMPROVEMENTS.md) item C17), and on [PHASE3.md](../PHASE3.md) Parts 1, 10, 13, 15, 16 and 17. Part 23 (Masking) isn't on `main` yet. It was read on `origin/lightbench/masking` (`f975020`). Facts already checked there are cited, not checked again. Anything new, or anything that corrects them, is marked as such.

Nothing here is legal advice. The patent sections set out facts: claim wording, and whether a method performs each claimed step. They draw no conclusions.

## How this was researched (read first)

| Source | What | Read |
|---|---|---|
| darktable source, `github.com/darktable-org/darktable`, commit **`e5306a7`** (2026-10-17 11:16 +0200), shallow clone | `src/iop/hazeremoval.c`, `vignette.c`, `grain.c`, `bilat.c`, `bloom.c`, `soften.c`, `highpass.c`, `lowpass.c`, `colorbalancergb.c` (parameters only), `diffuse.c` (presets), `contrastntexture.c`; `src/common/locallaplacian.c`, `eigf.h` (`fast_eigf_surface_blur`), `guided_filter.c`, `box_filters.h`, `iop_order.c`; `src/develop/lightroom.c` | 2026-10-17 [read] |
| darktable manual source, `github.com/darktable-org/dtdocs`, commit **`2a1742f`** (2026-10-16) | `bloom.md`, `soften.md`, `contrast-texture.md` | 2026-10-17 [read] |
| Licences | Every file above carries the header "either version 3 of the License, or (at your option) any later version": GPL-3.0-or-later, the same as LightBench. Copyright lines: hazeremoval 2017-2026, vignette 2010-2026, grain 2010-2026, bilat 2012-2023, bloom 2010-2026, soften 2011-2026, highpass/lowpass 2011-2026, colorbalancergb 2020-2026, diffuse 2021-2026, contrastntexture 2026, locallaplacian 2016-2026, eigf.h 2019-2024, guided_filter 2017-2026. | [read] |
| US 9,508,129 B1 and US 9,646,364 B1, full PDFs from `patentimages.storage.googleapis.com` (the URLs Cowork recorded) | Front page, description, all claims. Text was extracted column by column with `pdftotext`, which repairs the two-column layout that Cowork's OCR quotes ran together. | 2026-10-17 [read] |
| LightBench | `web/src/engine/gpu/develop-display.wgsl` (main `27ad60e`); `mask.wgsl` (masking branch) | [read] |
| Web search summaries | Glow (Camera Raw 18.6), the Glow field names, the Local Laplacian patent search, US 9,508,126 | [search]: the search tool's paraphrases of pages that couldn't be opened. Check them before relying on details. |

**Blocked this session:** every web page outside the two GitHub clones and `patentimages.storage.googleapis.com`. The full list, with how each failed, is under [Blocked sources](#blocked-sources). The independent claims of **US 9,508,126, US 9,305,339 and US 10,367,976** could therefore not be read in full. Their claim maps below are marked "needs Cowork". A ready-to-paste Cowork prompt is at the end and in [COWORK_EFFECTS_PROMPT.md](COWORK_EFFECTS_PROMPT.md).

Markers: **[read]** read in the source this session; **[cowork]** verified by Cowork on 2026-10-13/14 (quotes in A_/B_ files); **[search]** a search summary; **[memory]** remembered, not confirmed; **[estimate]** a number worked out here, not measured; **[analysis]** a conclusion drawn from code that was read, to be confirmed by a test; **[LightBench idea]** not seen in any surveyed tool.

---

## Summary

| Tool | Recommended method | Where | GPU cost on the owner's RTX 4000 Ada Laptop [estimate] | Mask weight later | Patent facts |
|---|---|---|---|---|---|
| **Post-crop vignette** | darktable's `vignette.c` super-ellipse fall-off behind Lightroom's sliders. Highlight Priority as a scene-linear gain before the sigmoid; Colour Priority and Paint Overlay after it (as in B.1). | Display shader, per pixel | Not measurable at fit; < 0.5 ms for a 24 MP export | Not needed: Lightroom has no local vignette | None found. No search done (Cowork item). |
| **Grain** | darktable's `grain.c`: 3-octave 3D simplex noise, paper-response table, resolution-independent coordinates. A **stored seed** replaces the file-name hash, and Roughness is LightBench's own control. | Display shader, after the Tone Curve, on display lightness | ≈ 0.1–0.5 ms at fit (≈ 1–4 ms with darktable's 21-sample zoomed-out average); ≈ 1–3 ms for a 24 MP export | Per-pixel Amount × mask | Perlin's US 6,867,776 expired 2022-01-08; its claims are 3D-and-up [cowork] |
| **Dehaze** | darktable's `hazeremoval.c` (He et al. dark channel + colour guided filter). Statistics are computed **once from the full-size photo**, and the filtered map is stored, so drags are per pixel (t = 1 − s·M). Rule: **never add an output-side edge or artefact constraint.** | Before Exposure, in the space Part 10's tone mask uses | Once per photo / white balance / lens: ≈ 15–40 ms at 24 MP (≈ 5–15 ms with a fast, subsampled guided filter); per redraw ≈ 0 | Exact: s(x) = global + Σ mask·local, applied to the stored maps | US 8,340,461 expired. Adobe's 9,508,129 and 9,646,364: two claim-1 elements are **not performed** (mapped below). **9,508,126 may read on the transmission step**, but its full claim is unread (needs Cowork). 9,305,339 and the Navy's 10,367,976 are unread. |
| **Texture / Clarity** | darktable 5.8's **contrast & texture** (`contrastntexture.c`): a cascaded EIGF pyramid of log-luminance detail, applied as an exposure gain 2^Σ. **Clarity → coarse + medium gains, Texture → fine gain.** The correction is linear in the three gains, so three stored band planes suffice. | Before the sigmoid, after the tone equalizer and Presence (darktable 28.5) | Per detail rebuild: ≈ 0.5–2 ms at fit, ≈ 10–25 ms at 24 MP; slider drags per pixel | Exact: per-pixel gains × band planes | No patent found or searched for EIGF / contrast & texture. Local Laplacian (the alternative): searches inconclusive [cowork, search]. |
| **Glow** (Camera Raw 18.6's Diffusion / Bloom / Halation) | **LightBench's own scene-linear glow**: a soft threshold on scene luminance (Range), a multi-scale blur in a mip pyramid (Spread), a tint (Warmth), then **added** before the sigmoid. darktable's `bloom.c` / `soften.c` are the display-referred references (option B). | Before the sigmoid, after Colour Grading | ≈ 1–3 ms per redraw at fit, ≈ 2–5 ms for a 24 MP export | Per-pixel Amount × mask; style, Range, Spread and Warmth global (as Adobe) | None searched (Cowork item) |

**Process versions:** none. Every tool is new and off by default (Part 1's rule). Two cautions follow under [Process versions](#process-versions).

**Corrections to the earlier brief** (B.3–B.4), from this session's reading:
1. **contrast & texture needs only three stored planes**, not one per pyramid level. darktable's per-level gain is Σ_band gain_band · w_band(level) (`contrastntexture.c` `process`, `band_weight`), so the correction is Σ_band gain_band · D_band, with D_band = Σ_level w_band(level) · detail_level [analysis].
2. **The local Laplacian's Clarity term is linear in the slider.** `curve_scalar` adds `clarity · c · exp(−c² / (2σ²/3))` to a base curve that doesn't depend on `clarity` (`locallaplacian.c` lines 313–343). Pyramids, interpolation and collapse are all linear, so output = B + clarity · C [analysis]. The brief said the pyramid "must be rebuilt on every slider move". That holds only when something **upstream** changes, which, after the sigmoid, is almost every slider.
3. **contrast & texture is not exactly exposure-independent.** It adds a noise bias (default 0.001) to the luminance before taking log2 (`compute_luminance`), so its detail changes slightly with exposure [read].

---

## 0. What the build changes in the engine (shared by the tools)

Today's display pass is **per pixel**: `developPreSigmoid` → Colour Mixer → Colour Grading → `sigmoid` → Tone Curve (`develop-display.wgsl` lines 354–405 [read]). It reads neighbours only through prepared textures: Part 10's tone-mask grid, Part 15's mixer tile corrections and Part 23's mask planes. Four of the five tools need neighbours. They use the patterns LightBench already has:

| Pattern | Used by | Existing precedent | Cache key |
|---|---|---|---|
| **A. Photo-level statistics, once from the full-size photo** | Dehaze (A0, maximum depth, the two filtered maps M₊ and M₋) | Part 10's tone mask: full size, keyed by source, frame, geometry and colour matrix; sampled by every drawing | Photo, white-balance fix, lens / geometry (Dehaze runs before Exposure, so Exposure doesn't touch it) |
| **B. Per-drawing neighbourhood passes in 1024 px tiles, with a margin** | Texture/Clarity band planes; the Glow pyramid | Part 15's mixer input draw (`mixerInput`) + compute passes, Part 23's tiled mask stage | Everything upstream of the tool in the display chain (it is redrawn when any of it changes) |
| **C. Per pixel in the display shader** | Vignette, Grain, and the final apply step of all of the above | the whole display pass | — |

**Order inside the display chain** (darktable's v5.0 order from `iop_order.c` lines 306–420 [read]: hazeremoval 14.0, exposure 21.0, toneequal 24.0, contrastntexture 28.5, colorbalancergb 41.5, sigmoid 45.3, bloom 61.0, grain 65.0, soften 66.0, vignette 68.0):

| Step | Tool | Domain |
|---|---|---|
| white-balance fix | — | scene-linear |
| **Dehaze** (apply the stored maps) | new | scene-linear, before Exposure |
| Exposure → tone equalizer (global + local) → local Contrast → Vibrance/Saturation | existing / Part 23 | scene-linear |
| **Texture, Clarity** (apply 2^(Σ gains · band planes)) | new | scene-linear |
| Colour Mixer → Point Color → Colour Grading | existing | scene-linear |
| **Glow** (add the blurred, tinted highlights) | new | scene-linear [LightBench idea: darktable's glow modules are display-referred] |
| **Vignette, Highlight Priority** gain | new | scene-linear [LightBench idea, B.1] |
| sigmoid → Tone Curve | existing | display |
| **Vignette, Colour Priority / Paint Overlay** → **Grain** | new | display |
| output profile, export dither | existing / new | display |

**Masks** (Part 23): the mask stage writes **three vec4 per pixel** into `planes`. Ten sliders use p0, p1 and p2.xy, the overlay alpha uses p2.z, and **p2.w is the only free channel** (`mask.wgsl` lines 318–328 on the masking branch [read]). Local Texture, Clarity and Dehaze (and later a local Glow amount) need a **fourth vec4**: +16 bytes per pixel in a 1024 px tile, about 17 MB per tile at rgba32float [estimate]. Each tool below says how it takes a per-pixel weight. In every case the mask scales a slider value that the stored statistics are **linear** in, so local sliders cost no extra filtering.

**Robustness and benchmark:** every new texture and buffer follows Part 14 (freed per drawing, rebuilt after a lost device). Part 16's benchmark gets one row per tool (fit and full size), as Parts 15 and 17 added theirs.

---

## 1. Post-crop vignette

### Lightroom
- Sliders: Amount, Midpoint, Roundness, Feather, Highlights. Styles: Highlight Priority (default), Color Priority, Paint Overlay [search, B.1].
- "Positive values lighten the corners, negative values darken them." Highlights is "Available for a Highlight Priority or Color Priority effect when Amount is a negative value" (Adobe Camera Raw help) [cowork, item 7].
- Defaults: Feather 50 (Kelby, secondary). Midpoint 50, Roundness 0 and Highlights 0 are unconfirmed, and one secondary source says Roundness defaults to +50 [cowork, item 7: unresolved].
- **crs fields:** `PostCropVignetteAmount`, `…Midpoint`, `…Feather`, `…Roundness`, `…Style`, `…HighlightContrast` (Exiv2 and the Lightroom SDK list them) [cowork, item 4]. Style 1 = Highlight Priority is confirmed by darktable's importer. Style 2 = Colour Priority and 3 = Paint Overlay rest on one secondary, AI-assisted project [cowork, item 6]. darktable's importer reads all of these except `HighlightContrast` (`lightroom.c` lines 536–567 [read]).

### darktable (read at `e5306a7`)
`vignette.c` is unchanged from the brief's B.1 reading. Parameters (lines 60–72): fall-off start 80, fall-off radius 50, brightness −0.5, saturation −0.5, centre, autoratio, whratio 1, shape 1, dithering off. Distance `cplen = (|x|^exp1 + |y|^exp1)^exp2`, weight = (cplen − start) / fall-off, clamped; a cosine shaping and TPDF dither only when dithering is on (lines 789–807). Position 68.0, display-referred.

### Recommended (unchanged from B.1, with the owner's open questions as cards)
- darktable's distance and fall-off. LightBench maps Lightroom's sliders onto them, using darktable's importer tables (`lightroom.c` lines 285–297) as the starting point. The fall-off is always smoothed (smoothstep or cosine).
- **Highlight Priority:** a radial gain in scene-linear light before the sigmoid, so the sigmoid rolls highlights off, plus Highlights protection of bright pixels (≥ the Highlights threshold, in scene EV). **Colour Priority:** a multiply in display-linear light after the sigmoid. **Paint Overlay:** a blend to black or white in display-encoded values. These follow Adobe's descriptions, not Adobe's maths, which isn't public.
- Frame: the crop (the output of the single geometry map, Part 1), so the vignette follows the crop.
- Highlights is disabled when Amount ≥ 0 or Style = Paint Overlay [cowork, item 7].
- Banding: TPDF dither at 8-bit export (darktable's manual warns of banding; B.1). The default is an owner question (V2), because it touches old exports.

**GPU:** about 20 ALU operations per pixel in the display pass, whose GPU time at fit already reads "≈0" on the owner's GPU (Part 16, "Display pass … 2.8–5.8 ms wall, GPU ≈0"). **< 0.5 ms for a 24 MP export** [estimate].
**Masks:** none (Lightroom has no local vignette; B_MASKING's local slider list has none [cowork]).
**Patents:** none known. **No search was done** for Highlight Priority / Colour Priority vignetting (Cowork item 7).

---

## 2. Grain

### Lightroom
- Amount, Size, Roughness. "Size: Controls grain particle size. Specifying a value of 25% or higher can cause some image blurring." "Roughness: Controls the regularity of the grain." (Adobe Camera Raw help) [cowork, item 5]. Defaults Size 25 and Roughness 50, and Amount 0–100, are secondary [cowork, item 7]. Monochrome only [search].
- **crs fields:** `GrainAmount`, `GrainSize`, `GrainFrequency`. `GrainFrequency` is almost certainly **Roughness**, because Size has its own field (indirect evidence) [cowork, item 5]. darktable's importer instead maps `GrainFrequency` to coarseness and never reads `GrainSize` (`lightroom.c` lines 306–311, 577–580 [read]).
- Local grain exists in Lightroom masks ("use the Amount slider to add grains to the masked area") [cowork, B_MASKING item 1b]. ExifTool's XMP.pm 3.79 has no `LocalGrain` [cowork, B_MASKING 4a].

### darktable (read at `e5306a7`)
Unchanged from B.2. `_simplex_2d_noise` sums **3D** simplex noise with the octave index as z: frequencies 0.4910 / 0.9441 / 1.7280 and amplitudes 0.2340 / 0.7850 / 1.2150, "to match power spectrum of real grain scans" (lines 317–332). The paper-response table is 128 × 128 (`evaluate_grain_lut`). Coordinates are normalised to the shorter side of the input. Zoomed out, it averages 21 samples on a Fibonacci lattice (lines 482–497). The seed is a DJBX33X hash of the file name, taken modulo 0.3 × the output width (lines 431–455). It works on Lab L, at position 65.0, display-referred. There is no OpenCL path.

### Recommended (as B.2)
- darktable's octaves and paper response, translated to WGSL (a 3D simplex with a 256-entry permutation table in a small buffer), applied to display lightness after the Tone Curve.
- A **stored seed** in the edit (as the Remove brush stores one); a virtual copy gets a new one [LightBench idea].
- Size → darktable's coarseness, through LightBench's own scale.
- Roughness → LightBench's own control: weight moves from darktable's low octaves to the high ones, and a fourth, finer octave fades in [LightBench idea]. Lightroom's maths isn't public.
- Coordinates in the full-size, crop-relative frame, so fit, 100 % and export show the same grain. This fixes darktable's output-width modulo, which shifts the pattern between widths [read; untested in darktable].

**GPU [estimate]:** about 100 operations per octave, so about 300 per pixel. That is **≈ 1–3 ms for a 24 MP export** and ≈ 0.1–0.5 ms at fit. darktable's 21-sample average for zoomed-out views multiplies the fit cost by about 21 (**≈ 1–4 ms at fit**). The comparison is Part 16's geometry warp, 16 bicubic taps per pixel at 24 MP: 4.5 ms GPU.
**Masks:** strength(x) = Amount + Σ mask · local Amount, applied per pixel (the noise doesn't depend on Amount).
**Patents:** US 6,867,776 (Perlin, "Standard for perlin noise"): "Expired - Lifetime", expiry 2022-01-08; independent claims 1, 2 and 5 recite i,j,k / x,y,z or n ≥ 3 [cowork, item 14]. darktable's grain is 3D simplex noise, the kind those claims cover. No search was done for LightBench's Roughness design.

---

## 3. Dehaze

### Lightroom
- Dehaze −100…+100 (Adobe Lightroom API: `"Dehaze": "<-100 to +100>"`) [cowork, item 7]. In Lightroom since June 2015 (Camera Raw 9.1 / Lightroom CC 2015.1, secondary) [cowork, item 15].
- Described as based on a light-scattering model, acting mostly on low-frequency areas, stronger than Clarity [search, B.3].
- A local Dehaze slider exists in masks (B_MASKING item 1b's list: "… Texture, Clarity, Dehaze …") [cowork].
- **crs fields:** `Dehaze` (real) [cowork, item 4] and `LocalDehaze` (ExifTool XMP.pm 3.79) [cowork, B_MASKING 4a]. darktable's importer reads neither [read: no match in `lightroom.c`].

### darktable `hazeremoval.c` (read at `e5306a7`)
- Header: He, Sun and Tang, "Single Image Haze Removal Using Dark Channel Prior", IEEE TPAMI 33(12), 2341–2353, Dec. 2011; and "Guided Image Filtering", LNCS 2010 (lines 19–30). The conference version of the dark-channel paper is CVPR 2009 [memory].
- Parameters (params v3, lines 63–69): strength −1…1 (default 0.2), distance 0…1 (0.2), compatibility mode (off), adaptive (on).
- Steps (`process`, lines 559–697):
  1. **Window sizes:** w1 = 2 + ⌈4·scale⌉, w2 = 3 + ⌈6·scale⌉, where scale = roi scale / iscale when adaptive. At full size w1 = 6 (a 13 × 13 box) and w2 = 9.
  2. **`_ambient_light`:** the dark channel = per-pixel min(R, G, B) followed by `dt_box_min` over w1. Pixels with a dark channel ≥ the 95th percentile are taken, then the brightest 5 % of those by R + G + B, and their RGB is averaged in **double** precision ("in float that order changed the ambient light, and so the output, from run to run": a fix newer than the brief's commit). It returns the maximum depth −1.125 · ln(critical haze level).
  3. **`_transition_map`:** t = 1 − strength · min_c(I_c / A0_c), then `dt_box_max` over w1. Back in `process`: `dt_box_min` over w1, then `guided_filter(img, t, …, w2, eps = √0.025, guide weight 1, −FLT_MAX, FLT_MAX)`. The guided filter is the **colour-guided** He filter: a 3 × 3 covariance solve per pixel, 13 box-filtered channels (`guided_filter.c` lines 77–84, 174–211).
  4. t_min = clamp(exp(−distance · distance_max), 1/1024, 1). **Output = (I − A0) / max(t, t_min) + A0**, per channel.
- Preview vs export: in its full pipes without HQ mode, darktable takes A0 and the maximum depth from the preview pipe, and logs "inconsistent output" for exports without HQ (lines 607–655).
- **diffuse or sharpen** presets "dehaze | default" and "dehaze | extra contrast": 10 iterations, radius 512 px, anisotropic diffusion with no haze model (`diffuse.c` lines 315–365 [read]).
- RawTherapee and LightCraft use the same family of methods (B.3).

### Recommended: darktable's haze removal, ported (variant **D0**)
| Item | Recommendation |
|---|---|
| Slider | Dehaze −100…+100 (0), in Basic → Presence (USABILITY.md row 2). Strength = Dehaze / 100, tuned by eye. Advanced: darktable's distance. |
| Space and position | Before Exposure, after the white-balance fix, in the space Part 10's tone mask measures (white-balanced camera RGB for RAWs, linear Rec.2020 for JPEGs). This is darktable's position 14.0, after its denoise at 9.0. LightBench's Detail stage likewise runs before the display pass, so dehaze sees the denoised photo. |
| Statistics (pattern A) | Once, from the **full-size uncropped photo**: A0, the maximum depth, and two filtered maps. m = min_c(I_c / A0_c); **M₊ = GF(boxmax(boxmin(m)))** for strength > 0 and **M₋ = GF(boxmin(boxmax(m)))** for strength < 0. At draw time t = 1 − s·M± [analysis, from B.3's note]. Every step is linear, or swaps min and max under negation, and darktable passes no clipping to the guided filter (±FLT_MAX). The guided filter keeps constants exactly: a = cov/(var + ε) = 0 for a constant input. Stored as `rg16float`: **96 MB at 24 MP, 180 MB at 45 MP** [estimate]. |
| Per pixel | t = max(1 − s·M±(x), t_min), then (I − A0)/t + A0. These are two texture reads. With `s` per pixel from masks, local Dehaze is exact. |
| Quantiles | A GPU histogram of the dark channel (4096 bins over its range, two passes) instead of quick-select. This gives the same 95 %/95 % rule to within one bin [LightBench choice; error to measure against darktable's CPU result]. |
| Fit vs export | One set of statistics for every drawing, so the fit view, 100 % and the export agree. This removes darktable's "inconsistent output" case. |
| Hard rule [patent facts below] | **Add no step that constrains the output's edges or gradients to the input's, or that separates and suppresses an "artifact layer".** Noise control comes from the Detail stage (already earlier in the pipeline) and t_min only. |

**GPU [estimate]:**
- Dark channel and min/max boxes: separable 13-tap passes at full size, 4 single-channel passes per map. The comparison is Part 16's tone-mask pre-pass (moments over 4 × 4 + reduce + blur): **1.38 ms GPU at 24 MP**.
- The colour guided filter at w2 = 9: 13 channels × 2 × 19 taps ≈ 500 reads per pixel, similar to capture sharpening's ≈ 31 G reads, which measured **41.9 ms GPU** at 24 MP.
- Total **≈ 15–40 ms once per photo / white balance / lens setting**, or ≈ 5–15 ms if the guided filter runs subsampled (He and Sun's fast guided filter, already used by Part 23's Refine). The subsampled filter is a small change of output: a decision (D6).
- **Per redraw ≈ 0.**

**Masks:** exact, as above.
**Process version:** none (new, off by default). The statistics frame (whole uncropped photo) and the quantile method are fixed from the first release.

### Patent comparison (facts, not legal advice)

**Status (Google Patents, read by Cowork 2026-10-13 [cowork, items 10–11]; Google labels status "an assumption and is not a legal conclusion"):**

| Patent | Assignee | Filed | Status (Google Patents) | Claims read here |
|---|---|---|---|---|
| US 8,340,461 B2 "Single image haze removal using dark channel priors" (He, Sun, Tang) | Microsoft Technology Licensing | 2010-02-01 | "Expired - Fee Related"; no foreign family listed | Cowork's quotes of claims 1 and 6 [cowork] |
| US 9,508,129 B1 "Dehazing photos and videos using visual artifact suppression" (Jue Wang, Chen Chen) | Adobe | 2015-11-06 (Appl. 14/935,299) | Active, anticipated expiry 2035-11-06 | **All 20 claims, from the PDF, 2026-10-17** [read] |
| US 9,646,364 B1 (continuation of 14/935,299; terminal disclaimer on its front page) | Adobe | 2016-10-14 (Appl. 15/294,194) | Active, anticipated expiry 2035-11-06 | **All 20 claims, from the PDF, 2026-10-17** [read] |
| US 9,508,126 B2 "Image haze removal using fast constrained transmission estimation" (Jianchao Yang, Jue Wang) | Adobe | 2015-02-17 | "Active, expires 2035-03-14" | Fragments of claim 1 only [cowork]; full text **needs Cowork** |
| US 9,305,339 B2 "Multi-feature image haze removal" (Yang, Wang, Tang) | Adobe | 2014-07-01 | Active, anticipated expiry 2034-07-01 | **None: needs Cowork** |
| US 10,367,976 B2 "Single image haze removal" (Fleizach, Gibson) | United States Department of the Navy | 2017-09-21 | "Active, expires 2037-12-27" | **None: needs Cowork** |

Both Adobe '129 and '364 list He, Sun and Tang's "Single image haze removal using dark channel prior" (TPAMI 2011) and "Guided image filtering" (TPAMI 35(6)) among their references (front pages [read]).

#### US 9,508,129 B1, claim 1 (verbatim, PDF column 23, read 2026-10-17)

> "1. In a digital medium environment for enhancing or otherwise editing digital images, a method of reducing error enhancement while dehazing an image, comprising: identifying, by at least one processor, an input image; estimating, by the at least one processor, an amount of unscattered light reflected from objects in the input image; determining, by the at least one processor, a radiance gradient for the input image; and generating, by the at least one processor, an output image, wherein generating comprises: removing haze from the input image based on the estimated amount of unscattered light; and preventing error enhancement in the output image based on the determined radiance gradient."

The patent's definition (column 4) [read]: "the term 'radiance gradient' refers to a gradient representing changes in reflected light in an image. Specifically, the radiance gradient represents differences in radiance between pixels or image patches in an image." How the description prevents error enhancement (columns 9–11): "Algorithm 2: Robust Image Dehazing" solves for the output J and a sparse error layer E. Its energy has an extra term weighted by "an additional parameter" η. The PDF's text layer garbles the formula; from the surrounding text it reads as a norm of ∇J − ∇I. Its effect is that "new edges that do not exist in the input image … are penalized, while original edges … are not penalized, and are potentially even boosted". This runs as an iterative total-variation / FISTA solve, 200 iterations in the experiments. The transmission is refined by "Algorithm 1: Guided TGV refinement" (300 iterations).

| Claim 1 element | Does D0 (darktable's port) perform it? |
|---|---|
| identifying an input image | Yes (trivially). |
| estimating an amount of unscattered light reflected from objects | Yes. The transmission t is exactly this quantity, by the patent's own wording in claim 10 ("transmission map representing an amount of reflected, unscattered light"). |
| determining a radiance gradient for the input image | **No separate step.** D0 computes no differences between pixels or patches of the input for later use. The nearest operation is the guided filter's local covariance of the guide image, which is used only to smooth t. Whether that counts is not a factual question this brief answers. |
| removing haze based on the estimated unscattered light | Yes: J = (I − A0)/max(t, t_min) + A0. |
| preventing error enhancement in the output based on the radiance gradient | **No.** The output is a closed-form per-pixel formula. Nothing compares or constrains output edges against input edges. t_min bounds the gain (1/t_min) but uses no gradient. |

- **Claim 10** (method, "while enhancing an image contrast") requires: a transmission map; "a refined transmission map … including transmission information consistent with a depth of objects in the scene"; a radiance gradient; and output "by enhancing a contrast … based on the refined transmission map and preventing error enhancement … based on the determined radiance gradient". D0 has a refined map (box min/max + guided filter). It does **not** perform the radiance-gradient and preventing elements.
- **Claim 16** (system) recites the same elements as claim 10 plus "removing haze". The mapping is the same.
- Dependent claims add: constraining output edges to input edges (2), an artifact layer (3–4, 17), gradient thresholds that penalise or boost edges (6–7, 18), patch radiance differences (8–9), a coarse map from a dark channel prior (11), a "depth edge-aware algorithm" (12–13, 19), and smoothing by "removing texture information" (14–15, 20). D0 performs claim 11's dark-channel coarse map. Claims 12–15 describe refinement, which D0 does with a box min/max and a colour guided filter. Each dependent claim also needs every element of claim 1 or 10.

#### US 9,646,364 B1, claim 1 (verbatim, PDF column 23, read 2026-10-17)

> "1. In a digital medium environment for editing digital images, a computer-implemented method of reducing error enhancement while editing the digital images or videos, comprising: estimating a transmission map of an input image, the transmission map representing an amount of reflected, unscattered light from a scene of the input image; determining a radiance gradient for the input image; and generating an output image by modifying a contrast of the input image based on the transmission map while suppressing edges in the radiance gradient from appearing in the output image."

| Element | D0? |
|---|---|
| estimating a transmission map … | Yes. |
| determining a radiance gradient for the input image | No separate step (as for '129). |
| generating an output … based on the transmission map **while suppressing edges in the radiance gradient from appearing in the output** | Modifying contrast by t: yes. **Suppressing edges: no.** |

- **Claim 10:** a transmission map "that has a smooth transmission at a given depth using a depth edge-aware algorithm that takes into account surface boundaries while ignoring edges within surfaces due to textures and color differences"; a radiance gradient; and output that reduces haze "while reducing error enhancement … based on the determined radiance gradient". On the first element: D0's colour guided filter is edge-aware, and it carries the guide's edges into t, colour and texture edges included. That property is the opposite of "ignoring edges within surfaces", but He et al.'s box min/max partly removes texture. This is set out as a fact pattern, not an answer. The radiance-gradient and error-reduction elements are not performed.
- **Claim 16** (system): a transmission map consistent across depths; "determine a radiance gradient … by determining radiance differences between adjacent regions"; reduce haze; "constraining edges in the output image to be consistent with edges in the input image based on the determined radiance gradient". The last two are not performed.

**Where these claims would be met:** a "make it cleaner" change that adds a gradient-consistency or artefact-suppression step after dehazing. Examples: a TV or edge-aware cleanup of the dehazed output guided by the input's gradients; suppressing JPEG block edges that dehazing amplified; boosting edges above a gradient threshold. This is why the hard rule above exists. **Design-around if one is ever wanted:** reduce amplified noise before dehazing (the Detail stage) or limit the gain (t_min, or a noise-profile floor on t taken from Part 13's noise profile), instead of constraining the output. Quality cost: amplified compression artefacts in skies stay as amplified as D0 leaves them [estimate: visible mainly on JPEG inputs at high Dehaze].

#### US 9,508,126 B2: partly known, needs Cowork

Cowork's verbatim fragments of claim 1 (2026-10-13): "A computer-implemented digital image processing method comprising:" … "calculating, by the processor, the medium transmission for each of the pixels in the input digital image" … "the fractionally scaled variant being calculated using a scaling factor that is a function of the input digital image;" … "recovering, by the processor, the scene radiance vector based at least in part on the filtered medium transmission". Cowork's tool paraphrased a smoothing filter (mean, median or minimum) applied to the transmission. Claims 8 (system) and 14 (program product) mirror claim 1 [cowork]. A search summary (2026-10-17) adds that claim 14 computes transmission per pixel "from a scaled version of that pixel, using a scaling factor derived from the input image", then smooths the map and recovers the image [search].

| Element (as far as known) | D0? |
|---|---|
| per-pixel medium transmission from a "fractionally scaled variant" of the pixel | D0 computes per pixel 1 − s · min_c(I_c / A0_c). The pixel is scaled by 1/A0, and **A0 is computed from the image**; s is the user's strength, a constant. Whether this is the claimed "fractionally scaled variant" **cannot be mapped without the full claim and its definitions.** |
| scaling factor that is a function of the input image | A0 is image-dependent; s is not. Unknown which one the claim means. |
| a filter applied to the transmission (Cowork's paraphrase: mean, median or minimum) | D0 applies a box **minimum** (and maximum) and then a guided filter. **Possibly met.** |
| recovering scene radiance from the filtered transmission | Yes. |

**Fact for the owner:** this is the patent most likely to overlap with D0's transmission step, and its full claim 1 has not been read. He et al.'s method was published in CVPR 2009 [memory] and TPAMI 2011 [read: darktable header], before the 2015 filing. The claim therefore presumably adds something beyond it, but what it adds is unknown here. **Design-around candidates, to choose once the claim text is in:**

| Variant | What changes | Quality cost [estimate] | GPU cost [estimate] |
|---|---|---|---|
| **D0** darktable port | — | reference | as above |
| **D0′** if the element is "a scaling factor that is a function of the image" | A0 fixed per photo **by the user's eyedropper or a preset grey**, not from the image | Worse automatic results; one more control | same |
| **D2** no transmission map: darktable's **diffuse or sharpen "dehaze"** preset | anisotropic diffusion, 10 iterations at radius 512 px, no haze model | No airlight-colour removal (the haze tint stays); a contrast-only look; halos to check | Heavy: radius 512 at full size, ≈ 100–400 ms at 24 MP |
| **D3** no transmission map: a **coarse-band boost** (contrast & texture with a very large base radius) + a **global** black-point / airlight offset | local contrast + one global affine step | Not depth-adaptive; distant haze treated like near detail | ≈ the Texture/Clarity cost |

#### US 9,305,339 B2 and US 10,367,976 B2
Their claims have not been read; they need Cowork (prompt items 2–3). Titles and status above [cowork].

#### US 8,340,461 B2 (expired)
Claims 1 and 6 (dark channel per patch → transmission from the dark channel and the atmospheric light → recovering scene irradiance) [cowork] describe what D0 does. Google Patents lists the patent as "Expired - Fee Related", with no foreign family. The lapse date is not shown [cowork, item 10; spot-checked by the main session 2026-10-14].

---

## 4. Texture and Clarity

### Lightroom
- Both −100…+100 (Adobe Lightroom API) [cowork, item 7].
- **Texture** was introduced on 2019-05-14 (Adobe blog, Max Wendt: "Today we are introducing a new control called 'Texture'…"), with "the range from 1 to 100" / "from -1 to -100" [cowork, items 7 and 15].
- Clarity is mid-tone local contrast; strong settings also change saturation and luminance. Texture is subtler, aimed at mid-to-high-frequency detail [search, B.4].
- Local Laplacian filters are "the main image-editing tool (for contrast, shadows, highlights, etc.) in Adobe Lightroom and Camera Raw" (UCL REF impact case study, secondary) [cowork, A table].
- Both have local sliders in masks [cowork, B_MASKING 1b].
- **crs fields:** `Clarity2012` (darktable's importer maps it to local contrast detail ±0.65, `lightroom.c` lines 320–325, 794–800 [read]); `Texture` (ExifTool forum, Lightroom 8.3 / Camera Raw 11.3) [cowork, item 4]; `LocalTexture` (ExifTool) [cowork]; `LocalClarity2012` is assumed, not confirmed here (ExifTool's list was quoted with an ellipsis).

### darktable options (read at `e5306a7`)

**contrast & texture** (`contrastntexture.c`, copyright 2026, params v2). Manual: "the scene-referred counterpart to the display-referred local contrast module … uses the same exposure-independent guided filter (eigf) used by the tone equalizer" (`contrast-texture.md` [read]).
- Parameters (lines 116–125): gain coarse / medium / fine −1…5 (0); base detail level 1…15 (5); halo control −10…10 (0); noise bias 0…1 (0.001); shadows / highlights −5…5 (0).
- Luminance = ‖RGB‖₂ / √3 + noise bias (`compute_luminance`).
- Radii: level l has radius 0.5 · 2^(−detail_level − l) · the input's largest side at the pipe's scale (`commit_params`, `modify_roi_in`). Levels stop when the radius drops under 2 px. For a 6000 px photo at full size that is 94, 47, 23, 12, 5.9, 2.9 and 1.5 px: 7 levels [analysis].
- **Cascaded:** from the finest level to the coarsest, the running low-pass is surface-blurred again with `fast_eigf_surface_blur` (downscale by clamp(σ, 1, 4), variance analysis, bilinear upsample, blend; `eigf.h` lines 231–300). Feathering = 0.2 · 2^(−halo control).
- Detail per level = wiener · clamp(log2(prev) − log2(smoothed), ±5 EV), where wiener = max(S² − bias², 0)/S² (`extract_details`).
- Band weights: squared sine/cosine cross-fades over level / max_detail_level, with max_detail_level = log2(full image size) − detail_level − 1 (`band_weight`, `commit_params`).
- **Output = RGB · 2^(Σ gains·detail + shadows/highlights term)**.
- Position 28.5: after exposure (21) and the tone equalizer (24), before colorbalancergb (41.5) and the sigmoid (45.3). CPU only.

**local contrast** (`bilat.c`, display-referred Lab L, position 54.0): local Laplacian (default) or bilateral grid. Defaults detail 0.25, highlights/shadows 0.5, midtone 0.5. Preset "clarity": detail 0.33 with sigma_r = sigma_s = 0. The fast local Laplacian uses 6 brightness samples (`num_gamma`, `locallaplacian.c` lines 440–470).

### Recommended: darktable's contrast & texture (variant **T0**)
| Item | Recommendation |
|---|---|
| Sliders | **Texture**, **Clarity** −100…+100 (0) in Basic → Presence. LightBench's mapping (tuned by eye): Clarity → coarse and medium gains, Texture → fine gain, ±100 → about ±1 of darktable's gain (the range −1…5 allows more). Advanced: base detail level, halo control and noise bias at darktable's defaults. Shadows/highlights stay off (Basic's tone equalizer does that job). |
| Band planes | The correction is Σ_band g_band · D_band [analysis, correction 1]. So a drawing stores **D_coarse, D_medium, D_fine** (and the low-pass, if shadows/highlights are ever exposed) in one `rgba16float` texture. Slider drags are then **per pixel**: 2^(g_c·D_c + g_m·D_m + g_f·D_f). |
| Where measured | At darktable's position, after Exposure, the tone equalizer (global and local) and Presence, so the planes are rebuilt when anything upstream moves (pattern B). Recommended over measuring once on the scene (decision T2), because the rebuild is cheap at fit [estimate below] and matches darktable. |
| Tiles and margins | The coarsest radius is ≈ 94 px at full size for a 6000 px photo, which would make 1024 px tiles almost 3× larger with margins. **Coarse levels (σ ≥ 8 px) are computed once per drawing on a reduced whole-photo grid** (Part 10's cell grid); **fine levels per tile** with small margins [LightBench idea]. |
| Radius frame | Relative to the **whole photo** (Part 10's choice) rather than darktable's cropped input (decision T5). |
| Fit view | darktable drops levels under 2 px at the pipe's scale, so the fit view loses Texture's finest bands. LightBench follows Part 13's precedent instead: the planes are built at the Detail stage's level (twice the view's size) [LightBench choice]. |
| Exposure dependence | The noise bias (0.001) is added before log2, so detail depends very slightly on exposure [read]. Measuring after Exposure (as recommended) makes this exactly darktable's behaviour. |

**GPU [estimate]:** 7 cascaded EIGF levels. The coarse ones run at ≤ ¼ resolution; the finest at ≈ full resolution (σ ≈ 1.5 px, downscale 1.5). Each level is about 5 passes (downsample, two-channel blur, upsample, blend, detail accumulate). This is comparable to a few full-resolution single-channel blurs, against the denoise's 7 four-channel scales at **40.8 ms GPU** for 24 MP (Part 16). **≈ 10–25 ms at 24 MP, ≈ 0.5–2 ms per rebuild at fit.** Per drawing at fit that adds roughly the Colour Mixer guided filter's measured **1.84 ms**.
**Masks:** exact. g_band(x) = global gain + Σ mask · local gain, read from the fourth plane, then the same per-pixel formula.
**Process version:** none. The radius frame, level set, band weights and mapping are fixed from the first release.

### Alternatives
| Variant | Notes | GPU [estimate] |
|---|---|---|
| **T1** local contrast, local Laplacian (`bilat.c`; darktable's importer target for Clarity2012) | Halo-free and well known. Display-referred (Lab L after the sigmoid). Output = B + clarity·C [analysis, correction 2], so per-pixel masks work, but B and C depend on everything upstream, the sigmoid and Tone Curve included. Texture would need its own band. | 6 pyramids: ≈ 20–50 ms at 24 MP, ≈ 1–3 ms at fit |
| **T2** LightCraft's guided-filter Clarity and Gaussian Texture (MIT/Apache) | Simplest. Scene-linear (B.4). | ≈ 1–5 ms at 24 MP |
| **T3** diffuse or sharpen "local contrast" presets | Iterative, slow | ≫ T0 |

### Patents (facts)
- **Local Laplacian filters** (Paris, Hasinoff, Kautz, SIGGRAPH 2011; republished CACM 58(3) 2015 [search]): Cowork's three searches and this session's search found **no patent**. This is inconclusive, not negative: Google Patents and Justia weren't reachable [cowork, item 13; search 2026-10-17].
- **Guided filter** (He, Sun, Tang): no patent found; inconclusive [cowork, item 12].
- **EIGF, contrast & texture, Adobe Texture:** no search was done (Cowork items 4–5).
- Lightroom's Texture and Clarity algorithms are not public.

---

## 5. Glow

### Camera Raw (all [search], 2026-10-17: summaries of Adobe's help page "Glow, Vignette, Grain, and Dehaze effects in Camera Raw", DPReview, PetaPixel 2026-09-04, Fstoppers, matiash.com; none could be opened)
- New in **Camera Raw 18.6** (the August 2026 Photoshop update). DPReview reports it "is currently an ACR-only feature" and not in Lightroom. No Lightroom release announcing it was found. Cowork found Adobe's help page updated on 27 August 2026 [cowork, A table].
- **Style:** Diffusion ("a hazy, film-like softening across the frame"), Bloom ("a soft, even glow across highlights") and Halation ("a colored, retro halo around bright edges and light sources").
- **Sliders:** Glow (the amount), **Range** ("which tones receive the glow"), **Spread** ("how far the glow radiates from bright areas"; one tutorial reads it as blur strength) and **Warmth** (cool-to-warm for Diffusion and Bloom, yellow-to-red for Halation).
- **Masks:** "Style, Range, Spread, and Warmth are global and shared across all masks, while the Glow amount can be set independently for each mask." In a mask the Glow slider runs −100…+100.
- Fstoppers: works "mostly on highlights and the midtones near them, leaving shadows largely untouched".
- **crs fields: unknown.** Adobe's crs namespace page and ExifTool's tables didn't list Glow in the search results (needs a Camera Raw–written XMP, Cowork item 8).

### darktable (read at `e5306a7`)
- **bloom** (`bloom.c`; position 61.0; "non-linear, Lab, display-referred"):
  - Parameters size 0–100 (20), threshold 0–100 (90), strength 0–100 (25).
  - L is scaled by 2^((strength + 1)/100) and kept where above the threshold (Lab L units).
  - It is blurred with `dt_box_mean` over radius 256 · (size + 1)/100 **full-image pixels** (capped at 256, scaled by the pipe), 8 iterations (`BOX_ITERATIONS`, roughly a Gaussian).
  - Then a **screen** blend on L only: 100 − (100 − L)(100 − blur)/100 (lines 132–165).
  - Manual: "no longer recommended. Instead, use the tone equalizer … or the exposure module with a parametric mask" (`bloom.md`).
- **soften** (`soften.c`; position 66.0; "linear, RGB, display-referred"; the Orton effect):
  - Parameters size 50, saturation 100, brightness 0.33 EV, mix 50.
  - An HSL copy with saturation × s/100 and lightness × 2^brightness, box-blurred (8 iterations) over a radius up to **1 % of the image diagonal** (resolution-independent), then a linear blend with the original by mix (`process`).
- **diffuse or sharpen** "artistic effects | bloom" preset: 1 iteration, radius 32, isotropic diffusion, scene-referred (`diffuse.c` lines 467–490).
- highpass and lowpass (Lab, "special") are blend helpers, not glow tools; not proposed.

### Recommended: LightBench scene-linear glow (variant **GL0**) [LightBench idea, built from darktable's ingredients]
| Item | Recommendation |
|---|---|
| Sliders | Glow 0…100 (0); Style Diffusion / Bloom / Halation (Bloom default); Range, Spread, Warmth. Ranges and defaults are LightBench's, because Adobe's are unknown (Cowork item 8). |
| Source | The pre-sigmoid image (after Colour Grading), drawn at **½ resolution** of the drawing (¼ at export); glow is low-frequency. Luminance Y in scene-linear Rec.2020. |
| Range | A soft threshold in **EV above middle grey**: w = smoothstep(T − k, T + k, log2(Y / 0.1845)). Range moves T (Bloom and Halation: highlights; Diffusion: T low, so most tones contribute, as soften's whole-image Orton copy). Shadows are barely touched, as reported for Camera Raw. |
| Spread | A sum of Gaussians, σ ∈ {0.25, 0.5, 1, 2, 4} % of the photo's long edge, weighted to give a heavy-tailed scattering kernel, built from one mip **down/up pyramid** (the dual-filter blur). Spread shifts the weights toward wide σ. Radii are relative to the photo, so fit and export match (as soften's 1 % diagonal and Part 10). darktable bloom's absolute 256 px is not used. |
| Combine | **Bloom:** out = in + amount · tint · G (added light, physical scattering; the sigmoid then rolls it off). **Diffusion:** out = mix(in, G_all, amount·α), energy-preserving, like soften's linear mix. **Halation:** a red/orange-weighted G from the highlights with smaller σ, multiplied by (1 − w) so it rings around bright edges rather than covering the source. |
| Warmth | A tint of G (Bloom/Diffusion: cool ↔ warm along a constant-luminance blue–amber axis; Halation: yellow ↔ red), keeping G's luminance. |
| Position | Before the sigmoid, after Colour Grading, before Vignette's Highlight Priority gain. |
| Masks | Per-pixel Glow amount × mask (Adobe's rule); Style, Range, Spread and Warmth global. G doesn't depend on the amount, so this is exact. |

**GPU [estimate]:**
- One extra pre-sigmoid draw at ½ resolution. At fit that is a fraction of the measured mixer input draw; the whole mixer row is 1.84 ms GPU.
- A threshold pass and a 6–8 level pyramid: about 1.33 × the source's pixels × ~13 taps × 2.
- **≈ 1–3 ms per redraw at fit, ≈ 2–5 ms for a 24 MP export.**
- Alternative B (darktable bloom port): a display-referred L screen. It is cheaper in the same pyramid, but darktable's manual no longer recommends it.

**Patents:** no search was done for glow, bloom or halation effects (Cowork item 9). darktable's bloom and soften are GPL-3.0-or-later.

---

## Process versions

Part 1's rule: a change that alters a saved edit's pixels needs a new process version; a new tool that is off by default doesn't. **Every tool here is new and off by default, so none needs one.** Part 10's export-hash identity test (`identity.mjs`) proves it per tool, as Parts 15, 17 and 23 did.

Cautions:
1. **Export dither** (Vignette's banding fix): turning it on for **all** 8-bit exports would change old edits' exports. So it is either on only when Vignette or Grain is active, or it waits for the next process version (decision V2).
2. **Lightroom sidecars** (Part 7's rules): newly read fields (`Dehaze`, `Texture`, `Clarity2012`, `PostCropVignette*`, `Grain*`) must apply only at import, or when the user reads changes. A photo already in the catalog must never be re-rendered because LightBench learned to read a field.
3. **Fixed from the first release:** grain's noise function, octave table, seed and coordinate frame; Dehaze's statistics frame and quantile method; Texture/Clarity's radius frame, levels, band weights and slider mapping; Glow's kernel weights. Changing any of them later needs a new version (`ProcessParams.effects`, as `ProcessParams.masks` in Part 23).

---

## Owner decisions (card-ready; recommendation first)

**E1. Order of work inside the Effects build?**
A) Vignette + Grain → Texture/Clarity → Glow → Dehaze last, after Cowork's patent check (recommended) · B) All five together · C) Dehaze first

**E2. Local (mask) sliders for Texture, Clarity and Dehaze?**
A) In this build: add a fourth mask plane (recommended) · B) A later build

**E3. Effects' Lightroom sidecar fields?**
A) Read at import and write back under Part 7's rules (recommended) · B) Read only · C) Neither in v1

**V1. Highlight Priority vignette?**
A) A scene-linear gain before the sigmoid, plus Highlights protection (recommended) · B) All three styles display-referred (simpler, as darktable and LightCraft)

**V2. Export dither against vignette banding?**
A) Only when Vignette or Grain is on (recommended; no process version) · B) Always on (changes old exports: needs a process version) · C) An Export option, off

**V3. darktable's centre offset and shape?**
A) Under Advanced (recommended) · B) Not offered

**G1. Grain seed?**
A) Stored per edit, new for a virtual copy (recommended) · B) darktable's file-name hash

**G2. Roughness?**
A) LightBench's design: weight between darktable's octaves plus a fourth fine octave (recommended) · B) Leave Roughness out of v1

**G3. `crs:GrainFrequency`?**
A) Read as Roughness (recommended; Cowork's indirect evidence) · B) darktable's coarseness

**G4. Colour grain?**
A) Monochrome only, as Lightroom (recommended) · B) Also darktable's RGB mode under Advanced

**D1. Dehaze method, given the patents?**
A) darktable's port (D0) with the "no output-edge constraint" rule, merged only after Cowork maps US 9,508,126's full claims (recommended) · B) D0 now · C) A transmission-free variant (D3: coarse-band boost + a global airlight offset) · D) Leave Dehaze out

**D2. Dehaze position?**
A) Before Exposure, as darktable (recommended) · B) After Exposure

**D3. Default distance (how far the removal reaches)?**
A) darktable's 0.2, with distance under Advanced (recommended; revisit on test photos) · B) 1.0 (all depths, stronger, more noise in the far distance)

**D4. Negative Dehaze (adding haze)?**
A) darktable's negative strength (recommended) · B) Clamp at 0

**D5. Dehaze statistics frame?**
A) The whole uncropped photo, once (recommended; Part 10's pattern) · B) The crop

**D6. Dehaze guided filter?**
A) Full resolution, darktable's exact filter (recommended) · B) Subsampled fast guided filter (3–4× faster, slight change)

**T1. Texture/Clarity engine?**
A) darktable contrast & texture, EIGF, scene-referred (recommended) · B) Local contrast, local Laplacian (display-referred; darktable's importer target) · C) LightCraft's guided filter + Gaussian

**T2. Where the detail is measured?**
A) darktable's position, after Exposure and the tone equalizer; rebuilt per redraw (recommended; ≈ 0.5–2 ms at fit) · B) Once per photo on the scene before Exposure (faster, approximate)

**T3. Slider-to-band mapping?**
A) Clarity → coarse + medium, Texture → fine (recommended) · B) Clarity → coarse, Texture → medium + fine

**T4. Mid-tone weighting for Clarity?**
A) None, as darktable; the sigmoid already compresses shadows and highlights (recommended) · B) LightCraft's mid-tone weight

**T5. Radius frame?**
A) The whole photo, as Part 10 (recommended) · B) The crop, as darktable

**T6. Panel placement of Texture, Clarity, Dehaze?**
A) Basic → Presence (Lightroom Classic; USABILITY.md) (recommended) · B) Effects (Lightroom cloud)

**GL1. Glow engine?**
A) LightBench scene-linear glow: threshold + multi-scale blur + add, before the sigmoid (recommended) · B) darktable bloom port (Lab L screen, display-referred) · C) darktable soften (Orton) for Diffusion + bloom for Bloom

**GL2. Glow styles in v1?**
A) Bloom, Diffusion and Halation (recommended) · B) Bloom first, the others later

**GL3. Glow in masks?**
A) Adobe's rule: only the amount per mask (recommended) · B) Every Glow slider per mask

---

## Blocked sources

All tried 2026-10-17. "curl 000" = the agent proxy refused the CONNECT tunnel (HTTP 403 from the gateway). "WebFetch ENOTFOUND" = the fetch tool's DNS lookup failed.

| URL | How it failed |
|---|---|
| https://patents.google.com/patent/US9508129B1/en, …/US9646364B1/en, …/US9508126B2/en, …/US9305339B2/en, …/US10367976B2/en, …/US8340461B2/en | curl: CONNECT tunnel 403 (`connect_rejected`); WebFetch: `getaddrinfo ENOTFOUND patents.google.com` |
| https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9508126 | curl 000; WebFetch ENOTFOUND |
| https://ppubs.uspto.gov/pubwebapp/, https://patentcenter.uspto.gov/, https://data.uspto.gov/, https://bulkdata.uspto.gov/ | curl 000 |
| https://patents.justia.com/patent/9508126 | curl 000; WebFetch ENOTFOUND |
| https://www.freepatentsonline.com/9508126.html | curl 000; WebFetch ENOTFOUND |
| https://worldwide.espacenet.com/…, https://ops.epo.org/, https://patentscope.wipo.int/, https://www.lens.org/, https://uspto.report/, https://search.patentsview.org/api/v1/patent/, https://api.patentsview.org/ | curl 000 |
| https://helpx.adobe.com/ca/camera-raw/desktop/edit-and-enhance-images/tone-and-color/vignette-grain-effects-camera-raw.html (Glow) | WebFetch ENOTFOUND; curl 000 for helpx.adobe.com |
| https://www.dpreview.com/news/adobe-adds-glow-to-camera-raw/ | WebFetch ENOTFOUND |
| https://www.adobe.com/, https://blog.adobe.com/, https://community.adobe.com/, https://jkost.com/, https://en.wikipedia.org/, https://arxiv.org/, https://docs.darktable.org/, https://web.archive.org/, https://people.csail.mit.edu/ | curl 000 |
| Google Patents full text via the BigQuery public dataset | Not attempted: the permission system refused listing the `bq` CLI's configuration. |

**Reachable:** `github.com` (git clone of darktable and dtdocs) and `patentimages.storage.googleapis.com` (the two Adobe PDFs whose URLs Cowork had recorded). The other patents' PDF paths contain hashes that couldn't be found.

---

## Cowork research prompt

The prompt below covers only what could not be verified here. It is also committed as [COWORK_EFFECTS_PROMPT.md](COWORK_EFFECTS_PROMPT.md).

```text
COWORK_EFFECTS_2026-10-17: verification for LightBench's Effects build

Context
LightBench is a GPL-3.0 Lightroom-class photo editor built on darktable's processing. Its Effects build
(Post-crop vignette, Grain, Dehaze, Texture, Clarity, Glow) is designed in docs/research/EFFECTS_DESIGN.md
(branch lightbench/research-effects). The Dehaze recommendation is a port of darktable's haze removal
(src/iop/hazeremoval.c): per-pixel dark channel min(R,G,B) + box minimum; ambient light A0 from the
95th-percentile dark-channel pixels' brightest 5 %; transmission t = 1 − s·min_c(I_c/A0_c) with s the user's
strength (a constant); box max then box min; a colour-guided He guided filter; t_min = exp(−distance·depth);
output (I − A0)/max(t, t_min) + A0. The claims of US 9,508,129 and US 9,646,364 were already read and
mapped; don't redo them.

How to work
- Open each page yourself; quote verbatim with the URL and the date read. Mark secondary sources.
- Facts only: claim wording, status, dates, definitions in the description. No legal conclusions.
- If a page is blocked, record the URL and how it failed, and try the alternatives listed.
- Google Patents labels status as "an assumption and is not a legal conclusion": quote it as such.

Return
One Markdown file with a "Decisions this changes" table first, then item-by-item verdicts
(Confirmed / Contradicted / Partly / Not found), each with quotes, URL and read date, then a list of
blocked sources.

Items
1. US 9,508,126 B2 (Adobe; "Image haze removal using fast constrained transmission estimation"):
   all independent claims (1, 8, 14) verbatim and complete; how the description defines the "fractionally
   scaled variant" and its "scaling factor that is a function of the input digital image"; what filter the
   claims require (mean / median / minimum?); status and expiry. Then, element by element, say whether the
   darktable method above performs each element, as facts (which quantity in darktable corresponds, or none).
   Try https://patents.google.com/patent/US9508126B2/en, its PDF link on that page, and
   https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9508126.
2. US 9,305,339 B2 (Adobe; "Multi-feature image haze removal"): independent claims verbatim, status, expiry;
   the same element-by-element facts against the darktable method.
3. US 10,367,976 B2 (US Navy; "Single image haze removal"): the same as item 2.
4. Local Laplacian filters (Paris, Hasinoff, Kautz; Adobe / MIT / Google): any US patent by these inventors
   on Laplacian-pyramid edge-aware filtering; number, claim 1, status. Search Google Patents by inventor
   ("Sylvain Paris" Laplacian pyramid) and assignee Adobe. Also "Fast local Laplacian filters" (Aubry et al.).
5. Guided filter (He, Sun, Tang; Microsoft): any patent on guided image filtering; number, status, claim 1.
6. Adobe Texture (2019) and Clarity: any Adobe patent describing a band-limited detail control or
   "texture" slider (e.g. inventors Max Wendt, Eric Chan); numbers, status, claim 1.
7. Post-crop vignette "Highlight Priority" / "Color Priority": any Adobe patent; number, status, claim 1.
8. Camera Raw Glow (18.6, 2026): Adobe help page "Glow, Vignette, Grain, and Dehaze effects in Camera Raw"
   verbatim (styles, sliders, ranges, defaults, mask behaviour); the release version and date; whether
   Lightroom Classic or Lightroom has Glow as of October 2026; the crs: field names (from a public
   Camera Raw-written XMP, ExifTool's current XMP.pm, or Adobe's crs namespace page).
9. Glow, bloom or halation patents (Adobe 2024–2026 filings on simulated film halation or highlight bloom):
   numbers, status, claim 1.
10. US 8,340,461 B2: the lapse date and the fee event (USPTO Patent Center or the maintenance-fee record).
```

---

## Sources

**Read this session (2026-10-17)**
- darktable `e5306a7`: https://github.com/darktable-org/darktable/tree/e5306a78080fb10cf8f54508b83c3d9616d11f13. Files listed in the first table.
- dtdocs `2a1742f`: https://github.com/darktable-org/dtdocs/blob/2a1742f76f256b96a2e0ff9827240afd0b9a804a/content/module-reference/processing-modules/bloom.md, `soften.md`, `contrast-texture.md`.
- US 9,508,129 B1 PDF: https://patentimages.storage.googleapis.com/60/83/89/856fe599b294bd/US9508129.pdf (front page; columns 3, 9–12, 23–26).
- US 9,646,364 B1 PDF: https://patentimages.storage.googleapis.com/e4/f8/d1/baa8126cb46f9d/US9646364.pdf (front page; columns 23–26).
- LightBench `main` `27ad60e`: `web/src/engine/gpu/develop-display.wgsl`. `origin/lightbench/masking` `f975020`: `docs/PHASE3.md` Part 23, `web/src/engine/gpu/mask.wgsl`.

**Search summaries only, 2026-10-17 (pages not opened)**
- Glow: [Adobe help (my_en)](https://helpx.adobe.com/my_en/camera-raw/using/vignette-grain-effects-camera-raw.html), [Adobe help (be_en)](https://helpx.adobe.com/be_en/camera-raw/desktop/edit-and-enhance-images/tone-and-color/vignette-grain-effects-camera-raw.html), [DPReview](https://www.dpreview.com/news/adobe-adds-glow-to-camera-raw/), [PetaPixel 2026-09-04](https://petapixel.com/2026/09/04/im-really-digging-adobe-camera-raws-new-glow-effect/), [Fstoppers](https://fstoppers.com/landscapes/diffusion-bloom-or-halation-breaking-down-camera-raws-glow-slider-904389), [matiash.com](https://www.matiash.com/blog/acr-18-6-glow-tutorial), [Lenscraft](https://lenscraft.co.uk/photo-editing-tutorials/adobe-camera-raw-glow-effect/), [Adobe crs namespace](https://developer.adobe.com/xmp/docs/xmp-namespaces/crs/), [Exiv2 crs table](https://exiv2.org/tags-xmp-crs.html).
- US 9,508,126: [Google Patents](https://patents.google.com/patent/US9508126), [USPTO PDF](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9508126).
- Local Laplacian: [CACM 2015](https://dl.acm.org/doi/10.1145/2723694), [Aubry et al., Fast Local Laplacian Filters](https://imagine.enpc.fr/~aubrym/projects/llf/data/Aubry_fastLLF_siggraph14.pdf).

**Earlier, cited, not re-read:** [COLOUR_MIXER_EFFECTS.md](COLOUR_MIXER_EFFECTS.md) (darktable `6271f53`, LightCraft `701f78e`, RawTherapee `dev`); [cowork-2026-10-13b/A_COLOUR_MIXER_EFFECTS.md](cowork-2026-10-13b/A_COLOUR_MIXER_EFFECTS.md) and [B_MASKING.md](cowork-2026-10-13b/B_MASKING.md) (Adobe help, the Lightroom API, ExifTool, Exiv2, Google Patents, read 2026-10-13/14); [PHASE3.md](../PHASE3.md) Parts 1, 10, 13, 15, 16, 17.
