# darktable module catalogue for LightBench

A lookup table of darktable's processing modules, masking, library modules, core infrastructure and views. Use it before porting a feature: find the module, then open the file and the functions named here.

**Source read:** darktable at commit `6271f53` (`/home/user/darktable-org/darktable-full`), rawspeed's `cameras.xml` (`/home/user/darktable-org/rawspeed/data`) and rawspeed's source (`/home/user/darktable-org/rawspeed-src`). Paths below are relative to the darktable root unless they start with `rawspeed`. `file:N` means line N of that file. In the module tables, `:N` means line N of the module's own file.

**How the facts were gathered:** a script read every module registered in `src/iop/CMakeLists.txt`: the string returned by `name()`, `aliases()`, `description()`, `default_group()`, `flags()`, `deprecated_msg()`, the colour-space callbacks, the params struct with its `$DEFAULT:` introspection comments, `process_cl()`, the OpenCL programs it loads (mapped through `data/kernels/programs.conf`), and `wc -l`. Algorithm summaries, Lightroom equivalents and phases were written by hand after reading the code named in each row. Lightroom equivalents and phases are **suggestions** for LightBench, not facts about darktable. Where something could not be determined it says "unknown".

**darktable's own docs:** this checkout has developer documentation in `dev-doc/` (IOP module API, pixelpipe, introspection, module groups, quick access panel, AI subsystem, HDR alignment). Read the relevant page with this catalogue. Where `dev-doc` and the code disagree, this catalogue follows the code (for example, `dev-doc/Module_Groups.md` names `IOP_GROUP_TONES` and `IOP_GROUP_NO_GROUP`, which do not exist in `src/develop/imageop.h:51-67`).

## Contents

1. [Processing modules (src/iop)](#1-processing-modules-srciop)
   1.1 Counts and legend · 1.2 Default pipeline and pipe order · 1.3-1.8 Tables by tab · 1.9 Notes on the important modules
2. [Masking and blending](#2-masking-and-blending)
3. [Lighttable and library modules (src/libs)](#3-lighttable-and-library-modules-srclibs)
4. [Core infrastructure](#4-core-infrastructure)
5. [Views (src/views)](#5-views-srcviews)
6. [Findings relevant to LightBench usability](#6-findings-relevant-to-lightbench-usability)

---

## 1. Processing modules (src/iop)

### 1.1 Counts and legend

| Count | What |
|---|---|
| 100 | `.c`/`.cc` files in `src/iop/` (plus `lut3dgmic.cpp`) |
| **97** | processing modules registered with `add_iop()` in `src/iop/CMakeLists.txt:65-174`. `useless.c` is the example module and is commented out (`CMakeLists.txt:64`); `ashift_lsd.c` and `ashift_nmsimplex.c` are `#include`d into `ashift.c` (:102, :106). `watermark` is built only when librsvg is found (`CMakeLists.txt:170-172`). |
| 16 + 1 | deprecated: 16 have `IOP_FLAGS_DEPRECATED` and a `deprecated_msg()`. `defringe` has a `deprecated_msg()` but puts `IOP_FLAGS_DEPRECATED` in `default_group()` instead of `flags()` (`defringe.c:88`), so the module-group code (which tests `flags()`, e.g. `modulegroups.c:807`) does not treat it as deprecated. |
| 7 | hidden (`IOP_FLAGS_HIDDEN`): demosaicscale, finalscale, gamma, mask_manager, overexposed, rawoverexposed, rotatepixels |
| 78 | have `process_cl()` (OpenCL). 19 are CPU only: bilateral, cacorrect, cacorrectrgb, clahe, colortransfer, contrastntexture, defringe, dither, enlargecanvas, equalizer, gamma, grain, hotpixels, rawdenoise, rotatepixels, scalepixels, spots, tonemap, watermark |
| 14 | have no `description()`: clahe, colortransfer, demosaicscale, equalizer, filmic, finalscale, gamma, globaltonemap, mask_manager, overexposed, rawoverexposed, relight, tonemap, zonesystem |
| 135,612 | lines in the 97 module files (excluding the `#include`d helper files noted in the tables) |

**Legend for the tables**

- **op (file)**: internal operation name (the first argument of `add_iop`, used in history, XMP and presets) and the line of `name()`.
- **UI name**: the string returned by `name()`.
- **`default_group()`**: the group bits the module returns. darktable 3.4+ bits first (`technical`, `grading`, `effects`), then the pre-3.4 bits in brackets (`basic`, `tone`, `color`, `correct`, `effect`); enum at `src/develop/imageop.h:51-67`. The **section headings** (1.3-1.8) are the tabs of darktable's built-in "modules: all" module-group preset (`src/libs/modulegroups.c:1705-1797`), which is the closest thing to a fixed section.
- **v5.0 RAW pos**: 1-based position in `v50_order[]` (`src/common/iop_order.c:306-428`) and its float value. This is the current default for raw files: `DT_DEFAULT_IOP_ORDER_RAW` is `DT_IOP_ORDER_V50` (`src/common/iop_order.h:139`). When an image's order is loaded from one of these tables, `_ioppr_reset_iop_order` numbers the entries 100, 200, ... by list position (`iop_order.c:1231-1245`, `:1266-1279`), so the position is what orders the pipe; the float shares a union with the int and is kept for database migration (`iop_order.h:144-147`, comment at `iop_order.c:72-77`). See 1.2 for the JPEG list.
- **colour space**: from `default_colorspace()`, overridden by `input_colorspace()`/`output_colorspace()` where present (only colorin, colorout and demosaic). One value means in = out. raw = mosaiced sensor data, rgb = pipe working RGB, lab = CIE Lab. The pipe converts between them automatically before each module (`src/develop/pixelpipe_hb.c:1687-1722`).
- **OpenCL**: whether `process_cl()` exists, and which `data/kernels/*.cl` programs the module loads.
- **lines**: `wc -l` of the module file; `#include`d helpers are added in brackets.
- **phase**: suggested LightBench phase (1 basics/export, 2 library, 3 editing depth, 4 local AI, 5 HDR/pano/print/output; 6 = the Tauri desktop app in `docs/PLAN.md`, used only for tethering). "--" means no plan to port.

### 1.2 Default pipeline and pipe order

**Which order list applies** (`_ioppr_get_default_iop_order_version`, `iop_order.c:772-799`): the display-referred workflow uses `legacy_order`; otherwise images get `v50_order` ("v5.0 RAW"), and `v50_jpg_order` ("v5.0 JPEG") is chosen when the image flags have `DT_IMAGE_HDR` set. Note that the code stores `flags & DT_IMAGE_HDR` in a variable named `is_ldr` (`iop_order.c:787`); the name and the test disagree, so check this before relying on it. The two v5.0 lists differ only in that the JPEG list moves `colorin` up to position 11, before `denoiseprofile`...`equalizer`, because those modules expect linear RGB (comment at `iop_order.c:568`).

**v5.0 RAW order (all 97):** 1 rawprepare · 2 invert · 3 temperature · 4 rasterfile · 5 highlights · 6 cacorrect · 7 hotpixels · 8 rawdenoise · 9 demosaic · 10 demosaicscale · 11 denoiseprofile · 12 bilateral · 13 rotatepixels · 14 scalepixels · 15 lens · 16 cacorrectrgb · 17 hazeremoval · 18 ashift · 19 flip · 20 enlargecanvas · 21 overlay · 22 clipping · 23 liquify · 24 spots · 25 retouch · 26 exposure · 27 mask_manager · 28 tonemap · 29 toneequal · 30 crop · 31 graduatednd · 32 profile_gamma · 33 equalizer · 34 colorin · 35 channelmixerrgb · 36 contrastntexture · 37 diffuse · 38 censorize · 39 negadoctor · 40 blurs · 41 primaries · 42 nlmeans · 43 colorchecker · 44 defringe · 45 atrous · 46 lowpass · 47 highpass · 48 sharpen · 49 colortransfer · 50 colormapping · 51 channelmixer · 52 basicadj · 53 colorharmonizer · 54 colorbalance · 55 colorequal · 56 colorbalancergb · 57 satcurvergb · 58 rgbcurve · 59 rgblevels · 60 basecurve · 61 filmic · 62 sigmoid · 63 agx · 64 filmicrgb · 65 spektrafilm · 66 lut3d · 67 colisa · 68 tonecurve · 69 levels · 70 shadhi · 71 zonesystem · 72 globaltonemap · 73 relight · 74 bilat · 75 colorcorrection · 76 colorcontrast · 77 velvia · 78 vibrance · 79 colorzones · 80 bloom · 81 colorize · 82 lowlight · 83 monochrome · 84 grain · 85 soften · 86 splittoning · 87 vignette · 88 colorreconstruct · 89 finalscale · 90 colorout · 91 clahe · 92 overexposed · 93 rawoverexposed · 94 dither · 95 borders · 96 watermark · 97 gamma

Things to notice: `lut3d` has float 36.0 but sits at position 66, after `spektrafilm`; several modules share 28.5. The list position is what counts (see the legend). `crop` (#30) is deliberately after every module that needs an enlarged input region (comment at `iop_order.c:341-342`), and `toneequal` (#29) is "last module that need enlarged roi_in".

**What a new raw gets by default.** The default workflow is `scene-referred (sigmoid)` (`data/darktableconfig.xml.in:4096-4107`; other options: filmic, AgX, spektrafilm, display-referred (legacy), none). Modules switch themselves on in two ways:

- `default_enabled = TRUE` in `reload_defaults()`/`init()`: rawprepare (if supported), temperature (raw), highlights (raw, not monochrome), demosaic (raw), colorin, colorout, gamma, flip, finalscale, demosaicscale, crop (only when the camera recorded an in-camera aspect ratio, `crop.c:895-952`), and the hidden overexposed/rawoverexposed indicators (shown only when toggled in the darkroom).
- **Auto-applied built-in presets** named "scene-referred default": exposure (+0.7 EV, `exposure.c:327-344`), channelmixerrgb (`channelmixerrgb.c:393-406`), and the tone mapper chosen by the workflow: sigmoid (`sigmoid.c:233-246`), filmicrgb, agx or spektrafilm. basecurve is auto-applied only for display-referred (`basecurve.c:560`); flip has an "auto" preset (`flip.c:450`). In scene-referred mode temperature uses the "camera reference" D65 coefficients and the real white balance is done by channelmixerrgb (`temperature.c:1161`, `late_correction` at :528).

The SQL that picks auto-apply presets (matching camera, lens, ISO, exposure, aperture, focal length and format) is in `_dev_auto_apply_presets`, `src/develop/develop.c:2020`. This is darktable's equivalent of Lightroom's camera-specific raw defaults.

### 1.3 Tab "base" (18 modules, in pipe order)

#### base - facts

| op (file) | UI name | `default_group()` | deprecated | v5.0 RAW pos (float) | colour space in -> out | OpenCL | lines | closest LrC | phase |
|---|---|---|---|---|---|---|---|---|---|
| `rawprepare` (rawprepare.c:94) | "raw black/white point" | technical (basic) | no | #1 (1.0) | raw (rgb if not raw) :119 | yes: basic | 945 | none (internal) | 1 |
| `temperature` (temperature.c:238) | "white balance" | grading (basic) | no | #3 (3.0) | raw (rgb if input not raw) :271 | yes: basic | 2232 | White Balance (Temp/Tint, presets, eyedropper) | 1 |
| `highlights` (highlights.c:167) | "highlight reconstruction" | technical (basic) | no | #5 (4.0) | raw (rgb if not raw) :197 | yes: basic, bspline | 1441 (+3551 hlreconstruct/*.c) | none (implicit highlight recovery) | 1 |
| `demosaic` (demosaic.c:318) | "demosaic" | technical (basic) | no | #9 (8.0) | raw -> rgb (in: rgb for mono sraw) :514/:521 | yes: capture, demosaic_markesteijn, demosaic_other, demosaic_ppg, demosaic_rcd, demosaic_vng | 1989 (+5893 demosaicing/*.c, +1354 amaze.cc) | none (implicit); capture sharpening ~ Sharpening/"Raw Details" | 1 (RCD), 3 (AMaZE, X-Trans, capture sharpen) |
| `demosaicscale` (demosaicscale.c:36) | "crop and scale input" (hidden) | technical (basic) | no | #10 (8.5) | rgb | yes (`dt_iop_clip_and_zoom_cl`) | 192 | none (internal) | 1 (internal) |
| `ashift` (ashift.c:112) | "rotate and perspective" | technical (correct) | no | #18 (15.0) | rgb | yes: basic | 6264 (+2703 lsd/nmsimplex) | Straighten + Transform panel (Upright, Vertical/Horizontal, Rotate, Aspect) | 1 (rotate/straighten), 3 (Upright) |
| `flip` (flip.c:71) | "orientation" | technical (basic) | no | #19 (16.0) | rgb | yes: basic | 631 | Rotate Left/Right, Flip Horizontal/Vertical | 1 |
| `exposure` (exposure.c:120) | "exposure" | technical (basic) | no | #26 (21.0) | rgb | yes: basic | 1398 | Exposure (+ Blacks offset) | 1 |
| `toneequal` (toneequal.c:334) | "tone equalizer" | grading (basic) | no | #29 (24.0) | rgb | yes: toneequal | 3992 | Shadows/Highlights/Whites/Blacks (closest) | 1 (candidate for those sliders), 3 (full UI) |
| `crop` (crop.c:119) | "crop" | technical (basic) | no | #30 (24.5) | rgb | yes (buffer copy only) | 2025 | Crop Overlay (crop + aspect) | 1 |
| `negadoctor` (negadoctor.c:129) | "negadoctor" | technical (basic) | no | #39 (28.5) | rgb | yes: negadoctor | 1078 | none (negative conversion is a plug-in job in LrC) | -- (not in plan) |
| `basecurve` (basecurve.c:361) | "base curve" | technical (basic) | no | #60 (44.0) | rgb | yes: basecurve | 2162 | Camera-matching profile tone curve | 3 (only for a display-referred "camera look") |
| `colisa` (colisa.c:78) | "contrast brightness saturation" | grading (basic) | **yes** | #67 (47.0) | lab | yes: basic | 284 | Contrast / Saturation (old style) | -- (deprecated) |
| `shadhi` (shadhi.c:115) | "shadows and highlights" | grading (basic) | no | #70 (50.0) | lab | yes: gaussian | 705 | Shadows / Highlights | 1 (candidate, display-referred), 3 |
| `colorreconstruct` (colorreconstruction.c:108) | "color reconstruction" | technical (basic) | no | #88 (69.0) | lab | yes: colorreconstruction | 1265 | none (partly Highlights recovery) | 3 (optional) |
| `finalscale` (finalscale.c:35) | "scale into final size" (hidden) | technical (basic) | no | #89 (69.4) | rgb | yes (`dt_iop_clip_and_zoom_cl`) | 229 | none (export resize, internal) | 1 (internal) |
| `overexposed` (overexposed.c:66) | "overexposed" (hidden) | technical (basic) | no | #92 (73.0) | rgb | yes: basic | 423 | Clipping indicators / J key | 1 (Part 2b) |
| `rawoverexposed` (rawoverexposed.c:63) | "raw overexposed" (hidden) | technical (basic) | no | #93 (74.0) | rgb | yes: basic | 444 | none (LrC only shows processed clipping) | 1 (Part 2b, optional) |

#### base - what it does

| op | purpose (`description()` line 1, quoted) | key params (defaults) | algorithm / functions to read (lines in the module file) |
|---|---|---|---|
| `rawprepare` | "sets technical specificities of the raw sensor touch with great care!" | left/top/right/bottom crop; raw_black_level_separate[4]; raw_white_point; flat_field=OFF (gain maps) | Black subtraction and white scaling per CFA channel + sensor crop (`process` :322); DNG gain maps (`_check_gain_maps` :626). Defaults from the decoder (rawspeed `cameras.xml`). |
| `temperature` | "scale raw RGB channels to balance white and help demosaicing" | red, green, blue, various (G2) coefficients; preset (AS_SHOT, or D65_LATE when scene-referred, :1161) | Multiplies each CFA channel by its coefficient (`process` :531, X-Trans path :548). Temp/tint <-> coefficients via black-body/daylight spectra and the camera matrix (`_temp2mul` :452, `_mul2temp` :495). Presets from data/wb_presets.json. D65_LATE hands the real correction to color calibration (`dev->chroma.late_correction` :528). |
| `highlights` | "avoid magenta highlights and try to recover highlights colors" | mode=OPPOSED ("inpaint opposed"); clip=1.0; strength=0; noise_level=0; iterations=30; scales=WAVELETS_7_SCALE; candidating=0.4; combine=2.0; recovery=OFF; solid_color=0 | `process` :846 switches on mode (:940-:1008) into hlreconstruct/*.c (`#include`d :347-352): opposed.c (default), segbased.c + segmentation.c, laplacian.c (guided laplacians), lch.c, inpaint.c (colour), plain clip (`process_clip` :739). Provides a raster mask (`_provide_raster_mask` :491). |
| `demosaic` | "reconstruct full RGB pixels from a sensor color filter array reading" | demosaicing_method=RCD (X-Trans: MARKESTEIJN, monochrome: passthrough; `reload_defaults` :1584); green_eq=NO; median_thrs=0; color_smoothing=OFF; lmmse_refine=REFINE_1; dual_thrs=0.2; capture sharpening cs_enabled=FALSE, cs_radius=0.5, cs_thrs=0.4, cs_iter=8 | Dispatcher `process` :683 into demosaicing/*.c (all `#include`d at :308-316): ppg.c, rcd.c, lmmse.c, vng.c, xtrans.c (Markesteijn 1/3-pass, FDC), amaze.cc (linked separately), dual.c (blend two methods by details mask), capture.c (capture sharpening), passthrough.c. Writes the Scharr details mask (`WRITE_DETAILS`). |
| `demosaicscale` | Internal (no `description()`): crop and scale the demosaiced input (UI name "crop and scale input"). | none (`int dummy`) | `process` :127 -> `dt_iop_clip_and_zoom`; `modify_roi_out` :60 / `modify_roi_in` :70. Flags HIDDEN, FENCE. |
| `ashift` | "rotate or distort perspective" | rotation=0; lensshift_v=0, lensshift_h=0; shear=0; f_length and crop_factor (from EXIF in `reload_defaults` :5721, else DEFAULT_F_LENGTH and 1); orthocorr=100; aspect=1; mode=GENERIC; cropmode=LARGEST; cl/cr/ct/cb crop box | Homography from rotation/shift/shear (`_homography` :798) applied with interpolation in `process` :3481. Auto "upright": line detection with LSD (`line_detect` :1519, ashift_lsd.c), RANSAC (`ransac` :1849), Nelder-Mead fit (`nmsfit` :2297, ashift_nmsimplex.c), auto-crop (`do_crop` :2687). |
| `flip` | "flip or rotate image by step of 90 degrees" | orientation (from EXIF, `reload_defaults` :479) | 90-degree rotations and mirrors (`process` :354, `distort_transform` :214, `backtransform` :183). |
| `exposure` | "redo the exposure of the shot as if you were still in-camera using a color-safe brightening similar to increasing ISO setting" | mode=MANUAL; exposure=0 (0.7 EV for raw in scene-referred, `reload_defaults` :347); black=0 (-0.000244 raw scene-referred); deflicker_percentile=50; deflicker_target_level=-4; compensate_exposure_bias; compensate_hilite_pres=TRUE | `out = (in - black) * scale`, `scale = 1/(white - black)`, `white = exposure2white(EV)` (`_process_common_setup` :478, `process` :544). Deflicker from raw histogram (`_compute_deflicker_correction` :442). |
| `toneequal` | "relight the scene as if the lighting was done directly on the scene" | 9 band gains (EV) noise, ultra_deep_blacks, deep_blacks, blacks, shadows, midtones, highlights, whites, speculars = 0; blending=5; smoothing=1.414; feathering=1; quantization=0; contrast_boost=0; exposure_boost=0; details=EIGF; method=NORM_2; iterations=1 | Luminance mask from an RGB norm, refined by guided filter / EIGF (`compute_luminance_mask` :940); band gains interpolated with Gaussian RBFs solved as a linear system (`compute_channels_factors` :1935, `build_interpolation_matrix` :2030); apply (`toneeq_process` :1067). Design notes at top of file (:20-:75). |
| `crop` | "change the framing" | cx, cy, cw, ch (normalised left/top/right/bottom); ratio_n=-1, ratio_d=-1 | Pure ROI change: `modify_roi_out` :516, `modify_roi_in` :575, `distort_transform` :462; `process` :593 only copies. Aspect presets `_aspect_ratio_get` :723. |
| `negadoctor` | "invert film negative scans and simulate printing on paper" | film_stock=COLOR; Dmin[4]=1.0; wb_high/wb_low=1.0; D_max=2.046; offset=-0.05; black=0.0755; plus gamma/soft-clip/exposure fields | Per-pixel density model `_process_pixel` :268, `process` :324; pickers `apply_auto_Dmin` :635, `apply_auto_Dmax` :655, `apply_auto_WB_low/high` :702/:729. |
| `basecurve` | "apply a view transform based on personal or camera maker look, for corrective purposes, to prepare images for display" | basecurve[3][MAXNODES] nodes; basecurve_type=MONOTONE_HERMITE; exposure_fusion=0; exposure_stops=1.0; exposure_bias=1.0; preserve_colors=LUMINANCE | Spline LUT on RGB (`process_lut` :1356, `apply_curve` :1015); optional exposure fusion with Gaussian/Laplacian pyramids (`process_fusion` :1184, `compute_features` :1049); per-maker curve presets (`set_presets` :395, `_check_camera` :458). Not auto-applied unless the workflow is display-referred (`src/develop/develop.c:2142-2144`). |
| `colisa` | "adjust the look of the image" | contrast=0; brightness=0; saturation=0 | Lab LUT curves in `process` :152. |
| `shadhi` | "modify the tonal range of the shadows and highlights of an image by enhancing local contrast" | shadows=50; highlights=-50; whitepoint=0; radius=100; compress=50; shadows_ccorrect=100; highlights_ccorrect=50; shadhi_algo=BILATERAL; order=GAUSSIAN_ZERO | Blurred L (Gaussian or bilateral) as a mask, then overlay-style lift/compress in Lab (`process` :336, `_Lab_scale` :315). |
| `colorreconstruct` | "recover clipped highlights by propagating surrounding colors" | threshold=100; spatial=400; range=10; hue=0.66; precedence=0 | Bilateral grid in Lab: splat clipped pixels, blur, slice (`dt_iop_colorreconstruct_bilateral_splat` :375, `_blur` :505, `_slice` :517; `process` :598). |
| `finalscale` | Internal (no `description()`): scale the image to the requested output size. | none (`int dummy`) | `process` :172 calls `dt_iop_clip_and_zoom` / `dt_iop_clip_and_zoom_roi` (export); `modify_roi_in` :65. |
| `overexposed` | Display-only clipping indicator (no `description()`); settings live in `dev->overexposed` (mode, lower EV, upper %, colour scheme). | none (`dt_iop_overexposed_t {int dummy}`) | Converts to the histogram profile (:139), then marks pixels by mode: any-RGB, luminance, saturation or gamut (`process` :105, modes from :152). |
| `rawoverexposed` | Display-only raw clipping indicator (no `description()`): marks photosites above a threshold of the raw white level. | none (`int dummy`); threshold/mode in `dev->rawoverexposed` | Per-CFA threshold `threshold * (white - black)` (`_process_common_setup` :85), mark modes solid/CFA/false colour (`process` :110). |

### 1.4 Tab "tone" (10 modules, in pipe order)

#### tone - facts

| op (file) | UI name | `default_group()` | deprecated | v5.0 RAW pos (float) | colour space in -> out | OpenCL | lines | closest LrC | phase |
|---|---|---|---|---|---|---|---|---|---|
| `contrastntexture` (contrastntexture.c:131) | "contrast & texture" | effects | no | #36 (28.5) | rgb | no | 734 | Texture / Clarity | 1 (candidate for texture/clarity), 3 |
| `rgbcurve` (rgbcurve.c:117) | "rgb curve" | grading (tone) | no | #58 (42.0) | rgb | yes: rgbcurve | 1955 | Tone Curve (point curve, R/G/B channels) | 3 |
| `rgblevels` (rgblevels.c:98) | "rgb levels" | grading (tone) | no | #59 (43.0) | rgb | yes: rgblevels | 1529 | none direct (Whites/Blacks, curve endpoints) | 3 |
| `sigmoid` (sigmoid.c:190) | "sigmoid" | technical (tone) | no | #62 (45.3) | rgb | yes: sigmoid | 982 | none (base tone mapping of LrC; Contrast) | 1 |
| `agx` (agx.c:43) | "AgX" | technical (tone) | no | #63 (45.5) | rgb | yes: agx | 2866 | none (tone mapping is built into LrC process version/profile) | 3 |
| `filmicrgb` (filmicrgb.c:330) | "filmic rgb" | technical (tone) | no | #64 (46.0) | rgb | yes: bspline, filmic | 4761 | none (tone mapping built into LrC) | 3 |
| `spektrafilm` (spektrafilm.c:759) | "spektrafilm" | technical (tone) | no | #65 (46.7) | rgb | yes: spektrafilm | 6484 | none (closest: creative profiles) | -- (optional creative) |
| `tonecurve` (tonecurve.c:160) | "tone curve" | grading (tone) | no | #68 (48.0) | lab | yes: basic | 1987 | Tone Curve (parametric + point) | 3 |
| `levels` (levels.c:115) | "levels" | grading (tone) | **yes** | #69 (49.0) | lab | yes: basic | 988 | none (old Levels) | -- (deprecated) |
| `bilat` (bilat.c:72) | "local contrast" | effects (tone) | no | #74 (54.0) | lab | yes (common/locallaplaciancl.c, bilateralcl.c) | 502 | Clarity | 1 (basic clarity), 3 |

#### tone - what it does

| op | purpose (`description()` line 1, quoted) | key params (defaults) | algorithm / functions to read (lines in the module file) |
|---|---|---|---|
| `contrastntexture` | "enhance local contrast by boosting details while preserving edges" | gain_coarse=0; gain_medium=0; gain_fine=0; detail_level=5; halo_control=0; noise_bias=0.001; gain_shadows=0; gain_highlights=0 | Multi-band detail extraction (`extract_details` :245, `band_weight` :259), shadows/highlights masks (`apply_shadows_highlights` :278); `process` :373. CPU only. |
| `rgbcurve` | "alter an image’s tones using curves in RGB color space" | curve_nodes per channel; curve_num_nodes=2; curve_type=MONOTONE_HERMITE; curve_autoscale=AUTOMATIC_RGB ("mode"); compensate_middle_grey=0; preserve_colors=LUMINANCE | Per-channel LUT from the spline (`_generate_curve_lut` :1670), applied with an RGB-norm "preserve colors" option (`process` :1869). |
| `rgblevels` | "adjust black, white and mid-gray points in RGB color space" | autoscale=LINKED_CHANNELS; preserve_colors=LUMINANCE; levels[ch][3] black/grey/white | LUT (`_compute_lut` :181), auto levels from a region (`_auto_levels` :1162), `process` :1239. |
| `sigmoid` | "apply a view transform to make an image displayable on a screen or print using a robust and smooth tone curve with optional color preservation methods" | contrast=1.5; skew=0; target white=100; target black=0.0152; color_processing=PER_CHANNEL; hue_preservation=100; red/green/blue inset and rotation=0; purity=0; base_primaries=WORK_PROFILE | Generalised log-logistic curve (`_generalized_loglogistic_sigmoid` :300), parameters solved in `commit_params` :318; per-channel with hue preservation (`process_loglogistic_per_channel` :703, `_preserve_hue_and_energy` :658) or RGB-ratio (`process_loglogistic_rgb_ratio` :566); primaries inset/rotation (`_calculate_adjusted_primaries` :394). |
| `agx` | "applies a tone mapping curve. inspired by Blender's AgX tone mapper" | range_black_relative_ev=-10; range_white_relative_ev=6.5; dynamic_range_scaling=0.1; curve_pivot_x=0.606; pivot_y=0.18; contrast=3.0; toe_power=1.5; shoulder_power=3.3; curve_gamma=2.2; look lift=0, slope=1, brightness=1, saturation=1, hue mix=0.6; primaries inset/rotation (in scene-referred mode `reload_defaults` :2727 applies Blender-like primaries, `_set_blenderlike_primaries` :317) | Inset primaries matrix (`_create_matrices` :1222), log2 encoding (`_apply_log_encoding` :679), sigmoid with toe/shoulder (`_apply_curve` :594), look (`_agx_look` :652), outset; core `_agx_tone_mapping` :1057; `process` :1326. |
| `filmicrgb` | "apply a view transform to prepare the scene-referred pipeline for display on SDR screens and paper prints while preventing clipping in non-destructive ways" | grey_point_source=18.45; black_point_source=-8 EV; white_point_source=4 EV (both shifted per image by the exposure default in `reload_defaults` :3182); contrast=1.0; latitude=0.01; output_power=4; saturation=0; balance=0; preserve_color=POWER_NORM; version=V5; shadows/highlights=POLY_4; spline_version=V3; enable_highlight_reconstruction=FALSE | Log tone mapping (`log_tonemapping_v2` :906) + spline (`filmic_spline` :937, `dt_iop_filmic_rgb_compute_spline` :2759); colour science v5 (`filmic_v5` :1947, `gamut_mapping` :1697); wavelet highlight reconstruction (`reconstruct_highlights` :1278); `process` :2084. |
| `spektrafilm` | "simulates the physical process of developing and printing analog film, using spectral emulsion and paper data from the spektrafilm project" | film/paper/lut hashes; exposure_ev=0; print_exposure_ev=0; print_auto_exposure=FALSE; print_contrast=1.0; filter_m=0, filter_y=0; couplers_amount=1; many more (params at :189) | Spectral film/paper simulation; core in common/spektra_core.c and spektra_sim.c; `process` :2156. Largest module file (6484 lines). |
| `tonecurve` | "alter an image’s tones using curves" | tonecurve[3][nodes] (L, a, b); tonecurve_type=MONOTONE_HERMITE; tonecurve_autoscale_ab=AUTOMATIC_RGB; preserve_colors=AVERAGE; tonecurve_unbound_ab=1 | Lab or RGB-norm curve LUT (`process` :384). darktable maps LrC `ToneCurvePV2012` and `Parametric*` to it (develop/lightroom.c:582, :1531). |
| `levels` | "adjust black, white and mid-gray points" | mode=MANUAL; black=0; gray=50; white=100; levels[3] | Lab L LUT (`compute_lut` :254, `process` :389). |
| `bilat` | "manipulate local and global contrast separately" | mode=local laplacian (1); detail=0.25; sigma_r=0.5; sigma_s=0.5; midtone=0.5 | `process` :329: local Laplacian pyramid (common/locallaplacian.c) or bilateral grid (common/bilateral.c, `dt_bilateral_splat/blur/slice`). darktable maps LrC `Clarity2012` to this module (develop/lightroom.c:794, :1563). |

### 1.5 Tab "color" (16 modules, in pipe order)

#### color - facts

| op (file) | UI name | `default_group()` | deprecated | v5.0 RAW pos (float) | colour space in -> out | OpenCL | lines | closest LrC | phase |
|---|---|---|---|---|---|---|---|---|---|
| `colorin` (colorin.c:132) | "input color profile" | technical (color) | no | #34 (28.0) | rgb (lab if profile is Lab) -> **lab** :164-182 | yes: basic | 2366 | Camera profile (Profile browser) | 1 |
| `channelmixerrgb` (channelmixerrgb.c:224) | "color calibration" | - (color) | no | #35 (28.5) | rgb | yes: channelmixer | 4769 | White Balance (scene-referred CAT), Calibration panel, B&W Mix | 1 (WB in scene-referred), 3 (calibration, B&W) |
| `primaries` (primaries.c:65) | "rgb primaries" | grading (color) | no | #41 (28.5) | rgb | yes: extended | 432 | Calibration panel (primary hue/saturation) | 3 |
| `colorchecker` (colorchecker.c:117) | "color look up table" | technical (color) | no | #43 (30.0) | lab | yes: extended | 1645 | none (closest: camera profile made from a chart) | 3 (optional) |
| `colorharmonizer` (colorharmonizer.c:124) | "color harmonizer" | - (color) | no | #53 (40.5) | rgb | yes: colorharmonizer | 1766 | none | -- |
| `colorequal` (colorequal.c:198) | "color equalizer" | - (color) | no | #55 (41.2) | rgb | yes: colorequal | 3989 | HSL / Color Mixer (8 hues) | 3 |
| `colorbalancergb` (colorbalancergb.c:167) | "color balance rgb" | grading (color) | no | #56 (41.5) | rgb | yes: extended | 2130 | Color Grading wheels + Vibrance/Saturation | 1 (vibrance/saturation), 3 (grading) |
| `satcurvergb` (satcurvergb.c:178) | "saturation curve" | grading (color) | no | #57 (41.7) | rgb | yes: satcurve | 2265 | none direct (Saturation, Vibrance) | 3 (optional) |
| `lut3d` (lut3d.c:133) | "LUT 3D" | technical (color) | no | #66 (36.0) | rgb | yes: lut3d | 1866 (+230 lut3dgmic.cpp) | Creative profiles (LUT-based) | 3 |
| `colorcorrection` (colorcorrection.c:66) | "color correction" | grading (color) | no | #75 (55.0) | lab | yes: basic | 517 | none (Split Toning-like) | -- |
| `colorcontrast` (colorcontrast.c:70) | "color contrast" | grading (color) | no | #76 (56.0) | lab | yes: extended | 325 | none (Saturation-like) | -- |
| `velvia` (velvia.c:65) | "velvia" | grading (color) | no | #77 (57.0) | rgb | yes: extended | 291 | Vibrance (rough) | -- |
| `colorzones` (colorzones.c:142) | "color zones" | grading (color) | no | #79 (60.0) | lab | yes: basic | 3001 | HSL / Color Mixer (display-referred) | 3 (alternative) |
| `monochrome` (monochrome.c:76) | "monochrome" | effects (color) | no | #83 (64.0) | lab | yes: basic | 598 | B&W treatment | 3 (alternative to color calibration grey tab) |
| `colorout` (colorout.c:78) | "output color profile" | technical (color) | no | #90 (70.0) | lab -> rgb (lab if profile is Lab) :112-127 | yes: basic | 911 | Export colour space; Soft Proofing | 1 (+3 soft proofing) |
| `gamma` (gamma.c:39) | "display encoding" (hidden) | technical (color) | no | #97 (78.0) | rgb | no | 356 | none (internal) | 1 (internal) |

#### color - what it does

| op | purpose (`description()` line 1, quoted) | key params (defaults) | algorithm / functions to read (lines in the module file) |
|---|---|---|---|
| `colorin` | "convert any RGB input to pipeline reference RGB using color profiles to remap RGB values" | type: struct default ENHANCED_MATRIX, but `reload_defaults` picks per image (:2127-2150): embedded ICC, else embedded matrix (DNG), else DNG forward matrix, else STANDARD_MATRIX for raws, sRGB/Adobe RGB/Rec.709 for other files; filename; intent=PERCEPTUAL; normalize=OFF ("gamut clipping"); blue_mapping; type_work=LIN_REC2020; filename_work | Camera RGB -> XYZ -> Lab via matrix (`process_cmatrix` :1243, fast paths :1074/:1200) or LittleCMS2 (`process_lcms2_*` :1270/:1310); profile choice in `commit_params` :1424 (embedded / standard / enhanced / vendor / alternate matrix, DNG forward matrix, DNG look table `_process_dng_look` :250). Output is Lab; the pipe converts to working RGB for the next RGB module (see 4.1). |
| `channelmixerrgb` | "perform color space corrections such as white balance, channels mixing and conversions to monochrome emulating film" | red/green/blue/saturation/lightness/grey rows [4]; normalize flags; illuminant: struct default D (daylight), but `reload_defaults` :3848 sets CAMERA (as-shot, from the raw WB coefficients) and snaps it to daylight/black body when close, or PIPE + RGB adaptation if another instance already does the CAT; illum_fluo=F3; illum_led=B5; adaptation=CAT16; x=y=0.333; temperature=5003; gamut=1.0; clip=TRUE; version=V_3 | Chromatic adaptation (CAT16, Bradford, XYZ or RGB; kernels `channelmixerrgb_CAT16/_bradford_*`) then a 3x3 mixer (`_loop_switch` :772, `process` :2100); auto illuminant detection (`_auto_detect_WB` :1002); colour-checker calibration (`_extract_color_checker` :1647, `_compute_patches_delta_E` :1293). |
| `primaries` | "adjustment of the RGB color primaries for color grading" | achromatic_tint_hue=0; achromatic_tint_purity=0; red/green/blue hue=0; red/green/blue purity=1 | Builds a matrix from adjusted primaries and applies it (`process` :121). |
| `colorchecker` | "perform color space corrections and apply looks" | source_L/a/b[MAX_PATCHES]; target_L/a/b[MAX_PATCHES]; num_patches | Thin-plate-spline RBF fit in Lab (`kernel` :570, phi(r)=2r^2 ln r; `process` :583); presets include IT8 skin tones and Fuji film emulations (`init_presets`). |
| `colorharmonizer` | "harmonize colors toward a selected palette in perceptual space" | rule=COMPLEMENTARY; anchor_hue=0.1; pull_strength=0; neutral_protection=0.5; pull_width=1; custom_hue[4]; num_custom_nodes=4; node_saturation[4]=1; smoothing=0 | Pulls hues toward harmony nodes in darktable UCS JCH (`get_weighted_hue_shift` :171, `process` :311); RYB hue LUTs (`_build_hue_luts` :547); auto-detect harmony (`_auto_detect_harmony` :1294). Docs: dev-doc/iop/colorharmonizer/. |
| `colorequal` | "change saturation, hue and brightness depending on local hue" | threshold=0.1; smoothing_hue=1; contrast=0; white_level=1; chroma_size=1.5; param_size=1; use_filter=TRUE; per hue node (red, orange, yellow, green, cyan, blue, lavender, magenta): sat_*=1, hue_*=0, bright_*=1 | darktable UCS 22 (common/darktable_ucs_22_helpers.h); periodic RBF / Gaussian interpolation of the 8 nodes (`_periodic_RBF_interpolate` :1737); guided-filter smoothing of hue/saturation (`_prefilter_chromaticity` :611); `process` :992. |
| `colorbalancergb` | "color grading tools using alpha masks to separate shadows, mid-tones and highlights" | shadows/midtones/highlights/global _Y/_C/_H=0; shadows_weight=1; white_fulcrum=0; highlights_weight=1; chroma_*=0; saturation_*=0; brilliance_*; vibrance; contrast; saturation_formula=darktable UCS (1) | Luminance opacity masks (`opacity_masks` :551) for 4-way grading; chroma/hue in Ych from XYZ D65 (`pipe_RGB_to_Ych` :1273); saturation in JzAzBz or darktable UCS; `process` :579. |
| `satcurvergb` | "remap saturation and brilliance with curves" | channel curves; formula=1; use_guided_filter=FALSE; gf_radius=10; gf_feathering=1; gf_protect_from/to=0; noise_protection=0 | Saturation and brilliance curves in darktable UCS or JzAzBz (`apply_sat_and_brilliance_ucs` :500, `_jzazbz` :552), optional guided-filter mask; `process` :765. |
| `lut3d` | "perform color space corrections and apply look" | filepath; colorspace=SRGB; interpolation=TETRAHEDRAL; nb_keypoints=0; c_clut (compressed); lutname | Loads .cube (`_calculate_clut_cube` :762), .3dl (:896), Hald CLUT PNG (:519), compressed G'MIC .gmz (lut3dgmic.cpp); tetrahedral / trilinear / pyramid interpolation (`_correct_pixel_tetrahedral` :302); `process` :1130. |
| `colorcorrection` | "correct white balance selectively for blacks and whites" | hia, hib, loa, lob; saturation=1 | Lab a/b shift interpolated by L (`process` :126). |
| `colorcontrast` | "increase saturation and separation between opposite colors" | a_steepness=1 ("green-magenta contrast"); b_steepness=1 ("blue-yellow contrast"); offsets; unbound=1 | Scales Lab a/b (`process` :164). |
| `velvia` | "resaturate giving more weight to blacks, whites and low-saturation pixels" | strength=25; bias=1 ("mid-tones bias") | Saturation boost weighted toward low-saturation pixels (`process` :138). |
| `colorzones` | "selectively shift hues, chroma and lightness of pixels" | channel=h ("select by" hue); curve[3][nodes] for L, C, h; strength=0 ("mix"); mode=SMOOTH | LCh lookup curves (`process_v3` :536, `process_v1` :488). darktable maps LrC HSL (`HueAdjustment*`, `SaturationAdjustment*`, `LuminanceAdjustment*`) to this module (develop/lightroom.c:717, :1544). |
| `monochrome` | "quickly convert an image to black & white using a variable color filter" | a=0, b=0 (filter colour); size=2; highlights=0 | Gaussian colour-filter weight in Lab a/b (`_color_filter` :170), `process` :199. |
| `colorout` | "convert pipeline reference RGB to any display RGB using color profiles to remap RGB values" | type=SRGB; filename; intent=PERCEPTUAL | Lab -> output RGB with matrix + TRC fast path (`_transform_cmatrix` :473) or LittleCMS2 (`_transform_lcms` :491); export/soft-proof profile selection in `commit_params` :557. |
| `gamma` | Internal terminal module (no `description()`), UI name "display encoding". | gamma, linear (unused fields) | Packs float RGB into 8-bit BGRA (`_copy_output` :265); mask and channel display (`_mask_display` :247, `_channel_display_*` :106/:123). It does not apply a gamma curve: colorout has already encoded the output. Float pipes pass through unchanged (:300). |

### 1.6 Tab "correct" (17 modules, in pipe order)

#### correct - facts

| op (file) | UI name | `default_group()` | deprecated | v5.0 RAW pos (float) | colour space in -> out | OpenCL | lines | closest LrC | phase |
|---|---|---|---|---|---|---|---|---|---|
| `rasterfile` (rasterfile.c:98) | "external raster masks" | technical (basic) | no | #4 (3.1) | raw (rgb if not raw) :132 | yes (copy / clip_and_zoom) | 936 | none (masks from external tools) | 4 (mask interchange) |
| `cacorrect` (cacorrect.c:72) | "raw chromatic aberrations" | technical (correct) | no | #6 (5.0) | raw | no | 1325 | Remove Chromatic Aberration | 3 |
| `hotpixels` (hotpixels.c:64) | "hot pixels" | technical (correct) | no | #7 (6.0) | raw | no | 484 | none (automatic in Adobe Camera Raw) | 3 (optional) |
| `rawdenoise` (rawdenoise.c:133) | "raw denoise" | technical (correct) | no | #8 (7.0) | raw | no | 914 | none (Raw Details) | 3 (optional) |
| `denoiseprofile` (denoiseprofile.c:815) | "denoise (profiled)" | technical (correct) | no | #11 (9.0) | rgb | yes: denoiseprofile | 3813 | Noise Reduction (Luminance/Color) | 3 |
| `bilateral` (bilateral.cc:70) | "surface blur" | technical (correct) | no | #12 (10.0) | rgb | no | 393 (+825 Permutohedral.h) | none (noise reduction, smoothing) | -- |
| `rotatepixels` (rotatepixels.c:65) | "rotate pixels" (hidden) | technical (correct) | no | #13 (11.0) | rgb | no | 358 | none (internal) | -- (only if such sensors are supported) |
| `scalepixels` (scalepixels.c:51) | "scale pixels" | technical (correct) | no | #14 (12.0) | rgb | no | 287 | none | -- |
| `lens` (lens.cc:249) | "lens correction" | technical (correct) | no | #15 (13.0) | rgb | yes: basic | 4920 | Lens Corrections (profile, distortion, vignetting, CA) | 3 |
| `cacorrectrgb` (cacorrectrgb.c:158) | "chromatic aberrations" | technical (correct) | no | #16 (13.5) | rgb | no | 755 | Remove Chromatic Aberration / Defringe | 3 |
| `hazeremoval` (hazeremoval.c:96) | "haze removal" | technical (correct) | no | #17 (14.0) | rgb | yes: hazeremoval | 983 | Dehaze | 3 |
| `liquify` (liquify.c:287) | "liquify" | effects (correct) | no | #23 (18.0) | rgb | yes: liquify | 3812 | none (Photoshop Liquify) | -- |
| `retouch` (retouch.c:193) | "retouch" | effects (correct) | no | #25 (20.0) | rgb | yes: retouch | 4882 | Spot Removal (Heal/Clone) | 3 |
| `nlmeans` (nlmeans.c:74) | "astrophoto denoise" | technical (correct) | no | #42 (29.0) | lab | yes: nlmeans | 452 | Noise Reduction (closest) | -- (denoiseprofile preferred) |
| `atrous` (atrous.c:120) | "contrast equalizer" | effects (correct) | no | #45 (32.0) | lab | yes: atrous | 1828 | Texture / Clarity / Sharpening (closest) | 3 (optional) |
| `sharpen` (sharpen.c:69) | "sharpen" | effects (correct) | no | #48 (35.0) | lab | yes: sharpen | 437 | Sharpening (Amount, Radius; no Detail/Masking) | 3 |
| `dither` (dither.c:102) | "dither or posterize" | technical (correct) | no | #94 (75.0) | rgb | no | 749 | none (export-side) | 5 (output quality, optional) |

#### correct - what it does

| op | purpose (`description()` line 1, quoted) | key params (defaults) | algorithm / functions to read (lines in the module file) |
|---|---|---|---|
| `rasterfile` | "read PFM/PNG files recorded for use as raster masks" | mode=ALL; path; file; dtdata entry fields (kind, origin, size, producer) | Reads PFM/PNG files and publishes them as raster masks (`_read_rasterfile` :262, `_get_rasterfile_mask` :558; flag WRITE_RASTER); image passes through (`process` :660). Sidecar format: dev-doc/dtdata_sidecar.md. |
| `cacorrect` | "correct chromatic aberrations for Bayer sensors" | avoidshift=0; iterations=2 | Emil Martinec / Ingo Weyrich CA correction for Bayer data (credits at :141-142), `process` :248, `_LinEqSolve` :161. CPU only. |
| `hotpixels` | "remove abnormally bright pixels by dampening them with neighbors" | strength=0.25; threshold=0.05; markfixed=FALSE; permissive=FALSE | Compare each photosite with same-colour neighbours (`_process_bayer` :105, `_process_xtrans` :219). CPU only. |
| `rawdenoise` | "denoise the raw image early in the pipeline" | threshold=0.01; x/y curves per CFA channel | Wavelet denoise on CFA data with a variance-stabilising transform (`wavelet_denoise` :201, `wavelet_denoise_xtrans` :305). CPU only. |
| `denoiseprofile` | "denoise using noise statistics profiled on sensors" | mode=WAVELETS (`reload_defaults` :2690); wavelet_color_mode=Y0U0V0; radius (patch)=1; nbhood (search)=7; strength=1; shadows=1; bias=0; scattering=0; central_pixel_weight=0.1; wb_adaptive_anscombe=TRUE; use_new_vst=TRUE; profile a/b from data/noiseprofiles.json | Variance-stabilising transform from the sensor noise profile (`precondition` :913, `precondition_v2` :994, `precondition_Y0U0V0` :1128), then non-local means (`process_nlmeans` :1775, common/nlmeans_core.c) or wavelets (`process_wavelets` :1426), then back-transform; `process` :2606. |
| `bilateral` | "apply edge-aware surface blur to denoise or smoothen textures" | radius=15; red=green=blue=0.005 | Permutohedral-lattice bilateral filter (Permutohedral.h, `process` :121). CPU only. |
| `rotatepixels` | "internal module to setup technical specificities of raw sensor you should not touch values here!" | rx, ry, angle (set from `image->fuji_rotation_pos`, angle -45, :349) | Rotates sensors stored at 45 degrees (Fuji layouts); `transform` :103, `process` :277. |
| `scalepixels` | "module for setting pixel aspect ratio useful for certain sensor types and anamorphic desqueeze" | pixel_aspect_ratio=1.0 | Non-square pixels / anamorphic desqueeze via ROI scaling (`_transform` :91, `process` :223). |
| `lens` | "correct lenses optical flaws" | method=LENSFUN, switched to EMBEDDED_METADATA when the file carries it (`reload_defaults`, lens.cc:3636-3640); modify_flags=ALL; inverse=CORRECT; scale=1; target_geom=RECTILINEAR; camera, lens strings; tca_override=FALSE; fine-tune factors=1; manual vignette v_strength=0, v_radius=0.5 | Lensfun modifier (`_get_modifier` :974, `_process_lf` :1066); embedded maker corrections for Sony, Fuji, DNG, Olympus, Panasonic (`_init_coeffs_md_v2` :2208, `_process_md` :2803); manual vignette (`_preprocess_vignette` :1987); geometry via `distort_transform` :3241; `process` :3072. |
| `cacorrectrgb` | "correct chromatic aberrations" | guide_channel=G; radius=5; strength=0.5; mode=STANDARD; refine_manifolds=FALSE | Guided-filter "manifolds" of the guide channel (`get_manifolds` :251, `apply_correction` :497, `reduce_chromatic_aberrations` :624). CPU only. |
| `hazeremoval` | "remove fog and atmospheric hazing from images" | strength=0.2; distance=0.2; compatibility_mode=FALSE; adaptive=TRUE | Dark channel prior with guided filter, after He et al. (refs :21-:28): `_dark_channel` :315, `_ambient_light` :449, `_transition_map` :334, `process` :559. |
| `liquify` | "distort parts of the image" | nodes[MAX_NODES=100] path data: warps of type linear, radial grow, radial shrink (:172-174) | Builds a global distortion map from warps/paths (`create_global_distortion_map` :1098, `apply_round_stamp` :918) and resamples (`_apply_global_distortion_map` :1015, `process` :1390). |
| `retouch` | "remove and clone spots, perform split-frequency skin editing" | rt_forms[300] (shape id, algorithm, scale, fill); algorithm=HEAL; num_scales=0; curr_scale=0; merge_from_scale=0; blur_type=GAUSSIAN; blur_radius=10; fill_mode=ERASE; max_heal_iter=2000 | Per-shape clone / heal / blur / fill (`rt_process_forms` :3694; `_retouch_heal` :3657 -> `dt_heal` in common/heal.c; `_retouch_clone` :3539); split-frequency editing via wavelet scales (common/dwt.c); source/target geometry via mask forms (`rt_masks_get_transform_to_destination` :901). |
| `nlmeans` | "apply a poisson noise removal best suited for astrophotography" | radius (patch)=2; strength=50; luma=0.5; chroma=1 | Non-local means in Lab (common/nlmeans_core.c), `process` :340. |
| `atrous` | "add or remove local contrast, sharpness, acutance" | octaves=3; x/y curves per channel and band (y=0.5 neutral); mix=1 | Edge-avoiding a-trous wavelets (common/eaw.c): decompose, scale bands by curves, synthesise (`process_wavelets` :275, `process` :351). |
| `sharpen` | "sharpen the details in the image using a standard UnSharp Mask (USM)" | radius=2; amount=0.5; threshold=0.5 | Unsharp mask on Lab L with a separable Gaussian (`init_gaussian_kernel` :112, `process` :251). |
| `dither` | "reduce banding and posterization effects in output JPEGs by adding random noise, or reduce bit depth" | dither_type=FSAUTO; random.damping=-100 | Floyd-Steinberg (`_process_floyd_steinberg` :400), random noise (`_process_random` :574), posterize (`_process_posterize` :618). CPU only. |

### 1.7 Tab "effect" (18 modules, in pipe order)

#### effect - facts

| op (file) | UI name | `default_group()` | deprecated | v5.0 RAW pos (float) | colour space in -> out | OpenCL | lines | closest LrC | phase |
|---|---|---|---|---|---|---|---|---|---|
| `enlargecanvas` (enlargecanvas.c:70) | "enlarge canvas" | technical (basic) | no | #20 (16.5) | rgb | no | 456 | none | -- |
| `overlay` (overlay.c:168) | "composite" | effects (effect) | no | #21 (16.7) | rgb | yes: overlay | 1575 | none | -- |
| `graduatednd` (graduatednd.c:135) | "graduated density" | grading (effect) | no | #31 (25.0) | rgb | yes: extended | 1086 | Linear Gradient mask with Exposure | 3 |
| `diffuse` (diffuse.c:122) | "diffuse or sharpen" | effects | no | #37 (28.5) | rgb | yes: bspline, diffuse | 1916 | Sharpening / Texture / Dehaze / blur (depending on preset) | 3 |
| `censorize` (censorize.c:75) | "censorize" | effects (effect) | no | #38 (28.5) | rgb | yes: gaussian | 434 | none | -- |
| `blurs` (blurs.c:80) | "blurs" | effects (effect) | no | #40 (28.5) | rgb | yes: blurs | 1032 | Lens Blur (closest; LrC uses AI depth) | 4 (would need depth) |
| `lowpass` (lowpass.c:95) | "lowpass" | effects (effect) | no | #46 (33.0) | lab | yes: gaussian | 589 | none | -- |
| `highpass` (highpass.c:68) | "highpass" | effects (effect) | no | #47 (34.0) | lab | yes: highpass | 366 | none | -- |
| `colormapping` (colormapping.c:143) | "color mapping" | effects (effect) | no | #50 (38.0) | lab | yes: extended | 1059 | none (study for "match a reference photo") | 1 (Part 2b, study only) |
| `bloom` (bloom.c:72) | "bloom" | effects (effect) | no | #80 (61.0) | lab | yes: bloom | 398 | none | -- |
| `colorize` (colorize.c:69) | "colorize" | grading (effect) | no | #81 (62.0) | lab | yes: extended | 376 | none (Color Grading global) | -- |
| `lowlight` (lowlight.c:82) | "lowlight vision" | effects (effect) | no | #82 (63.0) | lab | yes: basic | 828 | none | -- |
| `grain` (grain.c:393) | "grain" | effects (effect) | no | #84 (65.0) | lab | no | 580 | Effects > Grain | 3 |
| `soften` (soften.c:73) | "soften" | effects (effect) | no | #85 (66.0) | rgb | yes: soften | 392 | none (negative Clarity is the closest) | -- |
| `splittoning` (splittoning.c:77) | "split-toning" | grading (effect) | no | #86 (67.0) | rgb | yes: extended | 537 | Split Toning (now Color Grading) | 3 (legacy alternative) |
| `vignette` (vignette.c:108) | "vignetting" | effects (effect) | no | #87 (68.0) | rgb | yes: extended | 1104 | Effects > Post-Crop Vignetting | 3 |
| `borders` (borders.c:305) | "framing" | effects (effect) | no | #95 (76.0) | rgb | yes: basic | 1081 | none in Develop (Print module borders) | 5 |
| `watermark` (watermark.c:458) | "watermark" | effects (effect) | no | #96 (77.0) | rgb | no | 1590 | Export > Watermark | 5 |

#### effect - what it does

| op | purpose (`description()` line 1, quoted) | key params (defaults) | algorithm / functions to read (lines in the module file) |
|---|---|---|---|
| `enlargecanvas` | "add empty space to the left, top, right or bottom" | percent_left/right/top/bottom=0; color | ROI expansion and fill (`modify_roi_out` :122, `process` :340). CPU only. |
| `overlay` | "combine the image with elements from another processed image" | opacity=100; scale=100; xoffset=yoffset=0; alignment=4 (centre); rotate=0; imgid (other image); filename; compositing=HQ | Renders another image through its own pipe (`_setup_overlay` :290) and composites it (`process` :885). |
| `graduatednd` | "simulate an optical graduated neutral density filter" | density=1; hardness=0; rotation=0; offset=50; hue=0; saturation=0 | Per-pixel linear gradient density (`_compute_density` :746, `process` :751). |
| `diffuse` | "simulate directional diffusion of light with heat transfer model to apply an iterative edge-oriented blur, inpaint damaged parts of the image, or to remove blur with blind deconvolution" | iterations=1; sharpness=0; radius=8; regularization=0; variance_threshold=0; anisotropy_first..fourth=0; threshold=0; first..fourth speed=0; radius_center=0 (all-zero = no-op; presets in `init_presets` :235) | Multi-scale wavelets (`wavelets_process` :1150) with an anisotropic heat-equation PDE per scale (`heat_PDE_diffusion` :949, `compute_kernel` :915); `process` :1340. |
| `censorize` | "censorize license plates and body parts for privacy" | radius_1=0; pixelate=0; radius_2=0; noise=0 | Blur, pixelate, blur, add noise (`process` :138). |
| `blurs` | "simulate physically-accurate lens and motion blurs" | type=LENS; radius=8; blades=5; concavity=1; linearity=1; rotation=0; angle=0; curvature=0; offset=0 | Builds a lens / motion / Gaussian kernel (`_create_lens_kernel` :188, `_create_gauss_kernel` :288) and convolves (`process` :560; FFT path `process_fft` :425). |
| `lowpass` | "isolate low frequencies in the image" | radius=10; contrast=1; brightness=0; saturation=1; lowpass_algo=GAUSSIAN; unbound=1 | Gaussian or bilateral blur plus Lab adjustments (`process` :368). |
| `highpass` | "isolate high frequencies in the image" | sharpness=50; contrast=50 ("contrast boost") | Invert, blur, mix (`process` :256). |
| `colormapping` | "transfer a color palette and tonal repartition from one image to another" | flag; n=3 clusters; dominance=100; equalization=50; source/target histograms and cluster means/variances | k-means clusters in Lab (`kmeans` :284) plus histogram matching from a source image (`process` :432, `process_clusters` :902). |
| `bloom` | "apply Orton effect for a dreamy ethereal look" | size=20; threshold=90; strength=25 | Threshold bright L, box blur (`dt_box_mean`), screen blend with L (`process` :104). |
| `colorize` | "overlay a solid color on the image" | hue=0; saturation=0.5; source_lightness_mix=50; lightness=50 | Lab fill with a lightness mix (`process` :143). |
| `lowlight` | "simulate human night vision" | blueness=0 ("blue shift"); transition curve x/y | Scotopic-vision simulation through XYZ (`process` :121). |
| `grain` | "simulate silver grains from film" | channel=LIGHTNESS; scale=1600/GRAIN_SCALE_FACTOR ("coarseness"); strength=25; midtones_bias=100 | Simplex noise (`_simplex_2d_noise` :317) shaped by a paper-response LUT (`evaluate_grain_lut` :352); `process` :440. CPU only. darktable maps LrC `GrainAmount` here (develop/lightroom.c:568, :1408). |
| `soften` | "create a softened image using the Orton effect" | size=50; saturation=100; brightness=0.33; amount=50 ("mix") | Orton effect: brighten and saturate, blur, mix (`process` :104). |
| `splittoning` | "use two specific colors for shadows and highlights and create a linear toning effect between them up to a pivot" | shadow_hue=0; shadow_saturation=0.5; highlight_hue=0.2; highlight_saturation=0.5; balance=0.5; compress=33 | HSL toning by luminance (`process` :152). darktable maps LrC `SplitToning*` here (develop/lightroom.c:789, :1553). |
| `vignette` | "simulate a lens fall-off close to edges" | scale=80 ("fall-off start"); falloff_scale=50; brightness=-0.5; saturation=-0.5; center; autoratio=FALSE; whratio=1; shape=1; dithering=OFF; unbound=TRUE | Radial (super-ellipse) fall-off weight applied to brightness and saturation (`process` :693). darktable maps LrC `PostCropVignette*` here (develop/lightroom.c:536, :1444). |
| `borders` | "add solid borders or margins around the image" | color=(1,1,1); aspect=constant border; size=0.1; pos_h=0.5; pos_v=0.5; frame line size/offset/colour | Enlarges the ROI and fills it (`modify_roi_out` :430, `modify_roi_in` :535, `process` :571). |
| `watermark` | "overlay an SVG watermark like a signature on the image" | opacity=100; scale=100; offsets; alignment=4; rotate; scale_base; filename (SVG); text; color; font | SVG rendered with librsvg after variable substitution (`_watermark_get_svgdoc` :556, `process` :628). CPU only. Built only with librsvg (iop/CMakeLists.txt:170-172). |

### 1.8 Not in any "modules: all" tab (18 modules, in pipe order)

These are reachable only through search or a custom module-group preset: the deprecated modules, the hidden `mask_manager`, plus `colorbalance` and `profile_gamma` (not deprecated). `profile_gamma` is missing because the preset lists `"profile"` (modulegroups.c:1752), which matches no operation name; matching is exact (`_iop_compare`, modulegroups.c:266).

#### not in a tab - facts

| op (file) | UI name | `default_group()` | deprecated | v5.0 RAW pos (float) | colour space in -> out | OpenCL | lines | closest LrC | phase |
|---|---|---|---|---|---|---|---|---|---|
| `invert` (invert.c:118) | "invert" | technical (basic) | **yes** | #2 (2.0) | raw | yes: basic | 507 | none | -- (deprecated; negadoctor) |
| `clipping` (clipping.c:342) | "crop and rotate" | technical (basic) | **yes** | #22 (17.0) | rgb | yes: basic | 3343 | Crop & Straighten | -- (deprecated; study only) |
| `spots` (spots.c:54) | "spot removal" | effects (correct) | **yes** | #24 (19.0) | rgb | no | 905 | Spot Removal | -- (deprecated; retouch) |
| `mask_manager` (mask_manager.c:40) | "mask manager" (hidden) | none (no `default_group()`) | no | #27 (22.0) | rgb | yes (copy) | 130 | none | 3 (with masks; history bookkeeping) |
| `tonemap` (tonemap.cc:66) | "tone mapping" | grading (tone) | **yes** | #28 (23.0) | rgb | no | 237 (+825 Permutohedral.h) | none | -- (deprecated) |
| `profile_gamma` (profile_gamma.c:91) | "unbreak input profile" | technical (color) | no | #32 (26.0) | rgb | yes: basic | 659 | none | -- |
| `equalizer` (equalizer.c:85) | "legacy equalizer" | effects (correct) | **yes** | #33 (27.0) | lab | no | 245 | none | -- (deprecated) |
| `defringe` (defringe.c:67) | "defringe" | technical (correct) | **msg only** (see 1.1) | #44 (31.0) | lab | no | 429 | Defringe (purple/green) | -- (use cacorrectrgb) |
| `colortransfer` (colortransfer.c:98) | "color transfer" | effects (color) | **yes** | #49 (37.0) | lab | no | 415 | none | -- (deprecated) |
| `channelmixer` (channelmixer.c:120) | "channel mixer" | grading (color) | **yes** | #51 (39.0) | rgb | yes: extended | 760 | B&W Mix / Calibration | -- (deprecated) |
| `basicadj` (basicadj.c:160) | "basic adjustments" | grading (basic) | **yes** | #52 (40.0) | rgb | yes: basicadj | 1550 | Basic panel (incl. Auto) | 1 (study only: Auto algorithm) |
| `colorbalance` (colorbalance.c:147) | "color balance" | grading (color) | no | #54 (41.0) | lab | yes: extended | 2029 | Color Grading (3-way) | -- (superseded by colorbalancergb) |
| `filmic` (filmic.c:156) | "filmic" | technical (tone) | **yes** | #61 (45.0) | lab | yes: filmic | 1671 | none | -- (deprecated) |
| `zonesystem` (zonesystem.c:93) | "zone system" | grading (tone) | **yes** | #71 (51.0) | lab | yes: basic | 816 | none | -- (deprecated) |
| `globaltonemap` (globaltonemap.c:95) | "global tonemap" | grading (tone) | **yes** | #72 (52.0) | lab | yes: extended | 658 | none | -- (deprecated) |
| `relight` (relight.c:80) | "fill light" | grading (tone) | **yes** | #73 (53.0) | lab | yes: extended | 271 | none | -- (deprecated) |
| `vibrance` (vibrance.c:62) | "vibrance" | grading (color) | **yes** | #78 (58.0) | lab | yes: extended | 206 | Vibrance | -- (deprecated; colorbalancergb vibrance) |
| `clahe` (clahe.c:58) | "old local contrast" | effects (effect) | **yes** | #91 (71.0) | rgb | no | 340 | none | -- (deprecated) |

#### not in a tab - what it does

| op | purpose (`description()` line 1, quoted) | key params (defaults) | algorithm / functions to read (lines in the module file) |
|---|---|---|---|
| `invert` | "invert film negatives" | color[4]=1.0 (film base colour) | `out = clamp(film_base_colour - in)` per CFA channel (`process` :226). |
| `clipping` | "change the framing and correct the perspective" | angle; cx, cy, cw, ch; keystone k_h, k_v, kxa..kyd; k_type, k_sym, k_apply; crop_auto=TRUE; ratio_n=-1, ratio_d=-1 | Rotation + keystone matrix (`keystone_get_matrix` :390, `transform` :467), `process` :996. Replaced by crop + ashift + flip. |
| `spots` | "remove sensor dust spots" | clone_id[64]; clone_algo[64] | Clone from mask shapes (`_process` :570). darktable maps LrC `RetouchInfo` here (develop/lightroom.c:925, :1463). |
| `mask_manager` | Hidden dummy module so mask-manager history entries have a module (comment at top of mask_manager.c). | none (`int dummy`) | `process` :88 copies input. |
| `tonemap` | Deprecated (no `description()`): Durand 2002 local tone mapping (header comment). | contrast=2.5; Fsize=30 | Bilateral filter on log luminance with a permutohedral lattice (Permutohedral.h; `process` :94). CPU only. |
| `profile_gamma` | "correct input color profiles meant to be applied on non-linear RGB" | mode=LOG; linear=0.1; gamma=0.45; dynamic_range=10; grey_point=18; shadows_range=-5; security_factor=0 | Log or gamma curve (`process` :253), auto-tune pickers (`apply_autotune` :385). |
| `equalizer` | Deprecated "legacy equalizer" (no `description()`). | equalizer_x/y[3][BANDS] | Wavelet band equalizer (equalizer_eaw.h; `process` :114). CPU only. |
| `defringe` | "attenuate chromatic aberration by desaturating edges" | radius=4; thresh=20; op_mode=GLOBAL_AVERAGE | Gaussian-blur based edge detection, then desaturation of fringes (`process` :167). CPU only. |
| `colortransfer` | Deprecated (no `description()`): transfer colours from another image (Reinhard et al. 2001, header comment). | flag=NEUTRAL; hist[HISTN]; mean/var[MAXN]; n=3 | k-means + histogram mapping (`kmeans` :219, `process` :292). CPU only. |
| `channelmixer` | "perform color space corrections such as white balance, channels mixing and conversions to monochrome emulating film" | red/green/blue[CHANNEL_SIZE]; algorithm_version | HSL / RGB / grey mixing (`process_hsl_v2` :273, `process_rgb` :323, `process_gray` :343). |
| `basicadj` | "apply usual image adjustments" | black_point=0; exposure=0; hlcompr=0; hlcomprthresh; contrast=0; preserve_colors=LUMINANCE; middle_grey=18.42; brightness=0; saturation=0; vibrance=0; clip=0 | One-pass LUT for contrast/brightness (`get_lut_contrast` :521, `get_lut_gamma` :510), highlight compression (`hlcurve` :849), auto exposure from a histogram (`_get_auto_exp` :879, `_auto_exposure` :1197); `process` :1406. |
| `colorbalance` | "shift colors selectively by luminance range" | mode=SLOPE_OFFSET_POWER; lift/gamma/gain[CHANNEL_SIZE] (1.0); saturation=1; contrast=1; grey=18 ("contrast fulcrum"); saturation_out=1 | ASC-CDL slope/offset/power (`_process_sop` :549) or lift/gamma/gain (`_process_lgg` :421); `process` :678. |
| `filmic` | Deprecated first filmic (no `description()`); ports Sobotka filmic curves and ACES log (header comment). | grey/black/white source and target points; output_power; latitude_stops; contrast; saturation; global_saturation; balance; interpolator; preserve_color | `_process_pixel` :398, curve LUT `compute_curve_lut` :968. |
| `zonesystem` | Deprecated (no `description()`): Ansel Adams zone-system tone mapping. | size=10; zone[MAX_ZONE_SYSTEM_SIZE+1]=-1 | Zone map on L (`_iop_zonesystem_calculate_zonemap` :136, `process` :259). |
| `globaltonemap` | Deprecated (no `description()`): global tone-mapping operators. | operator=DRAGO; drago.bias=0.85; drago.max_light=100; detail=0 | Reinhard / Drago / filmic operators (`process_reinhard` :168, `process_drago` :189, `process_filmic` :266). |
| `relight` | Deprecated "fill light" (no `description()`). | ev=0.33; center=0; width=4 | Gaussian-weighted exposure on L (`process` :110). |
| `vibrance` | "saturate and reduce the lightness of the most saturated pixels to make the colors more vivid." | amount=25 | Saturate and darken the most saturated pixels (`process` :100). |
| `clahe` | Deprecated "old local contrast" (no `description()`). | radius, slope (doubles, struct `dt_iop_rlce_params_t` :40) | Luminance map then CLAHE (clipped local histograms; `process` :85). CPU only. |

### 1.9 Notes on the important modules

Line numbers are in the module's own file unless a path is given. Each note says what to port and the trap to watch for.

**Raw front end (Phase 1)**

- **rawprepare** (`rawprepare.c`): first module. Subtracts per-CFA black levels, scales to the white point, applies the sensor crop (`process` :322) and DNG gain maps (`_check_gain_maps` :626). Its defaults come from the decoder (`dt_image_t.raw_black_level_separate`, `raw_white_point`, filled by `imageio_rawspeed.cc:219-262`), so LibRaw values must be mapped the same way. Disabled for already-normalised floats (`_image_is_normalized` :569, `reload_defaults` :773).
- **temperature** (`temperature.c`, UI "white balance"): multiplies each CFA channel by a coefficient (`process` :531; X-Trans branch from :548). The temperature/tint sliders are converted to coefficients through black-body and daylight spectra and the camera matrix (`_spd_blackbody` :286, `_spd_daylight` :320, `_temp2mul` :452, `_mul2temp` :495). Presets come from `data/wb_presets.json` (`dt_wb_presets_init`, `common/darktable.c:2071`). In scene-referred mode the default preset is `D65_LATE` (:1161): the module applies the camera-reference D65 coefficients and publishes `late_correction` in `dev->chroma` (:514-529) so that **channelmixerrgb does the real white balance as a chromatic adaptation**. A Lightroom-style Temp/Tint slider therefore maps either to this module (display-referred) or to channelmixerrgb's illuminant (scene-referred). `ONE_INSTANCE`, no blending.
- **highlights** (`highlights.c`, UI "highlight reconstruction"): default mode `OPPOSED` ("inpaint opposed", `hlreconstruct/opposed.c`). Other modes: segmentation (`segbased.c` + `segmentation.c`), guided laplacians (`laplacian.c`, uses `bspline.cl`), LCh (`lch.c`), colour inpaint (`inpaint.c`), clip (`process_clip` :739). Dispatch in `process` :846. Also publishes a raster mask of clipped areas (`_provide_raster_mask` :491) that later modules can blend with. Opposed caches per image using `dt_dev_pixelpipe_piece_hash()` with a NULL ROI (see `dev-doc/pixelpipe_architecture.md`).
- **demosaic** (`demosaic.c` + `demosaicing/*.c`): default RCD for Bayer, Markesteijn 1-pass for X-Trans, passthrough for monochrome (`reload_defaults` :1584). All algorithm files are `#include`d (:308-316) except AMaZE (`amaze.cc`, linked as a second source in `CMakeLists.txt:117`). "Dual" methods blend two demosaicers using the details mask (`dual.c`). The module also hosts **capture sharpening** (`capture.c`, params `cs_*`, off by default), the closest darktable analogue to Lightroom's raw sharpening. It writes the Scharr details mask (`WRITE_DETAILS`) used by blending (section 2). For downscaled previews it can demosaic at half size (`clip_and_zoom_demosaic_half_size` kernel); see `_demosaic_full` :286 and `_get_thumb_quality` :275.
- **exposure** (`exposure.c`): one line of maths, `out = (in - black) * 1/(2^-EV - black)` (`exposure2white(x) = exp2f(-x)`, :44) (`_process_common_setup` :478, `process` :544). The +0.7 EV scene-referred default (`reload_defaults` :347) exists because sigmoid/filmic do not brighten like a base curve (comment at :329). `compensate_exposure_bias` adds the camera's exposure-bias EXIF; `compensate_hilite_pres` adds the ISO highlight-preservation shift. Deflicker mode computes EV from a raw-histogram percentile (`_compute_deflicker_correction` :442) and is a useful reference for LightBench's **Auto** button.
- **colorin / colorout** (`colorin.c`, `colorout.c`): the params struct defaults to `ENHANCED_MATRIX`, but `reload_defaults` chooses per image (:2127-2150): an embedded ICC profile, else a DNG embedded or forward matrix, else `STANDARD_MATRIX` for raws (the Adobe XYZ->camera matrix that the decoder took from `cameras.xml`), else sRGB / Adobe RGB / linear Rec.709. `ENHANCED_MATRIX` (darktable's own matrices in `src/common/colormatrices.c`) switches to the embedded-ICC path when the camera is not listed (:1513-1517). Working profile: linear Rec.2020. It outputs **Lab** (`output_colorspace` :177-182); the pipe converts Lab to working RGB before the next RGB module (`pixelpipe_hb.c:1687-1722`). The matrix path is plain C (`process_cmatrix` :1243); LittleCMS2 is used for LUT profiles. colorout converts Lab to the display/export profile (`_transform_cmatrix` :473 matrix + TRC, else lcms2 `_transform_lcms` :491) and owns soft-proofing and gamut-check selection (`commit_params` :557). For a WebGPU port, the matrix + TRC paths are the ones to translate; keep lcms2 for exotic ICC profiles only.
- **gamma** (`gamma.c`, UI "display encoding", hidden): despite its name it applies no gamma. It packs float RGB into 8-bit **BGRA** (`_copy_output` :265, note the channel swap at :275) and draws mask/channel overlays. Float pipes skip it (:300). Export of 16/32-bit formats bypasses it with `dt_dev_pixelpipe_process_no_gamma` (`pixelpipe_hb.c:3344`).
- **flip** (`flip.c`, UI "orientation"): 90-degree steps and mirrors from EXIF (`reload_defaults` :479, auto preset :450); `process` :354, coordinate transforms `distort_transform` :214 / `distort_backtransform` :249. Sits at #19, before crop.
- **crop** (`crop.c`): no pixel processing; it only changes the ROI (`modify_roi_out` :516, `modify_roi_in` :575). Its `IOP_FLAGS_CROP_EXPOSER` registers it as `dev->cropping.exposer` (`pixelpipe_hb.c:589-591`); when a module that sits before it and is filtered by `IOP_TAG_CROPPING` (e.g. rotate and perspective) has focus, the darkroom also draws the crop module's overlay (`views/darkroom.c:1139-1155`). Enabled by default only when the camera recorded an in-camera aspect ratio (:895-952). Rotation and keystone are in **ashift**, 90-degree turns in **flip**.
- **clipping** (`clipping.c`, UI "crop and rotate"): **deprecated** ("please use the crop, orientation and/or rotate and perspective modules instead", `deprecated_msg` :337). Still worth reading for its combined rotate + keystone matrix (`keystone_get_matrix` :390) and because darktable's Lightroom importer still writes `clipping` history entries (`develop/lightroom.c:1383`).
- **ashift** (`ashift.c`, UI "rotate and perspective"): rotation, lens shift and shear as a homography (`_homography` :798). Automatic "upright": structure detection with LSD (`line_detect` :1519, `ashift_lsd.c`), line classification, RANSAC (`ransac` :1849), Nelder-Mead fit (`nmsfit` :2297, `ashift_nmsimplex.c`), auto-crop to the largest rectangle (`do_crop` :2687). Right-drag straightening is computed in `_calculate_straightening` :4107. Quick-access-panel exposes `ashift/rotation`.
- **finalscale** (`finalscale.c`, hidden): downscales to the output size near the end of the pipe (#89, just before colorout). Export uses it only with "high quality processing" or upscaling; otherwise finalscale is disabled and downscaling happens right after demosaic (`src/imageio/imageio.c:1338-1381`). This is the speed/quality switch LightBench needs for previews vs export.
- **overexposed / rawoverexposed** (hidden, `NO_HISTORY_STACK`): the darkroom clipping indicators. overexposed converts to the histogram profile, then marks pixels by mode: any RGB channel, luminance only, saturation only, or full gamut (`overexposed.c:139-:296`); thresholds `lower` (EV) and `upper` (%) and the colour scheme live in `dev->overexposed`. rawoverexposed marks photosites above `threshold * (white - black)` per CFA channel (`rawoverexposed.c:85-108`) in solid colour, CFA colour or false colour. Direct references for LightBench Phase 1 Part 2b clipping warnings.

**Tone mapping and tone (Phase 1 and 3)**

- **sigmoid** (`sigmoid.c`, 982 lines): the default view transform. A generalised log-logistic curve (`_generalized_loglogistic_sigmoid` :300) whose constants are solved in `commit_params` :318 so that scene 0 -> target black, 18 % -> 18 %, infinity -> target white, with slope at grey set only by `contrast`. Two colour modes: per-channel with hue preservation (`process_loglogistic_per_channel` :703, `_preserve_hue_and_energy` :658, default) and RGB ratio (:566). Optional primaries inset/rotation (`_calculate_adjusted_primaries` :394) and base primaries choice. Small, self-contained and the best first port. Quick access panel exposes `sigmoid/contrast` and `sigmoid/skew`.
- **filmic rgb** (`filmicrgb.c`, 4761 lines): log encoding between black and white relative exposure, a 4th-order polynomial/spline (`dt_iop_filmic_rgb_compute_spline` :2759), several colour-science versions (v1-v5; v5 `filmic_v5` :1947 with `gamut_mapping` :1697), and wavelet-based highlight reconstruction (`reconstruct_highlights` :1278, off by default). Auto-tune pickers (`apply_autotune` :2682). Port after sigmoid if users ask for filmic's controls. The older **filmic** (`filmic.c`) is deprecated.
- **agx** (`agx.c`, 2866 lines): Blender-AgX-style: inset primaries, log2 encoding, sigmoid with explicit toe/shoulder powers, "look" (slope, lift, saturation, hue preservation), then outset (`_agx_tone_mapping` :1057, `process` :1326). Has auto-tune of black/white exposure (`_apply_auto_tune_exposure` :1135). Third workflow option.
- **tone equalizer** (`toneequal.c`, 3992 lines): read the design notes at :20-75. Builds a luminance mask from an RGB norm, smooths it with a guided filter or EIGF so local contrast is kept, then applies per-octave gains: the 9 user bands sit at -8...0 EV (`centers_params` :158) and are converted to 8 Gaussian RBF weights by solving a linear system (`centers_ops` :148, `compute_channels_factors` :1935). It is the physically-based way to do Lightroom's Highlights/Shadows/Whites/Blacks; mapping four LR sliders onto its 9 bands is a LightBench design decision. Quick access panel exposes the graph and the mask compensations.
- **local contrast** (`bilat.c`, 502 lines): default mode is the local Laplacian pyramid (`common/locallaplacian.c`, OpenCL `locallaplaciancl.c`); alternative bilateral grid (`common/bilateral.c`). `detail` is the main slider. darktable's own Lightroom importer maps `Clarity2012` to this module (`develop/lightroom.c:794`). For Texture, compare `contrastntexture.c` (multi-band, CPU only) and `diffuse.c` presets.
- **rgb curve** (`rgbcurve.c`): spline nodes per channel -> LUT (`_generate_curve_lut` :1670); "preserve colors" applies the curve to an RGB norm and scales channels by the ratio (`process` :1869); `compensate_middle_grey` keeps 18 % fixed. This is the Lightroom point curve (with R, G, B). The parametric LR curve has no direct module: darktable's importer converts it into **tonecurve** (Lab) nodes (`lightroom.c:582`).
- **rgb levels** (`rgblevels.c`): black/grey/white per channel or linked -> LUT (`_compute_lut` :181), auto levels from a drawn region (`_auto_levels` :1162).
- **base curve** (`basecurve.c`): the display-referred camera "look" curves per maker (`set_presets` :395, matched by `_check_camera` :458) plus exposure fusion (`process_fusion` :1184). Only auto-applied in the display-referred workflow (skipped otherwise, `src/develop/develop.c:2142-2144`). Useful if LightBench offers a "camera-matching" look.

**Colour (Phase 1 and 3)**

- **color calibration** (`channelmixerrgb.c`, 4769 lines): chromatic adaptation (CAT16 default; Bradford, XYZ, RGB) to an illuminant chosen by type (`dt_illuminant_t`, `src/common/illuminants.h:28-39`: same as pipeline, A, D daylight, E, F fluorescent, LED, Planckian black body, custom, as shot in camera) or detected automatically from surfaces or edges (`_auto_detect_WB` :1002), then a 3x3 channel mixer with saturation/lightness/grey rows (B&W). Colour-checker calibration extracts patches and minimises delta E (`_extract_color_checker` :1647, `_compute_patches_delta_E` :1293). Shares `dev->chroma` with temperature (see `dev-doc/pixelpipe_architecture.md`, "Pipeline Ordering Asymmetry"). Quick access panel exposes temperature, hue, chroma and illuminant.
- **color balance rgb** (`colorbalancergb.c`, 2130 lines): Lightroom's Color Grading plus Vibrance/Saturation. Shadows/mid-tones/highlights weights are smooth logistic masks around a grey fulcrum (`opacity_masks` :551); hue/chroma work in Ych derived from XYZ D65 (`pipe_RGB_to_Ych` :1273); saturation and brilliance use JzAzBz or darktable UCS (`saturation_formula`, default darktable UCS). Quick access panel exposes global chroma, vibrance, saturation and brilliance.
- **color equalizer** (`colorequal.c`, 3989 lines): the HSL / Color Mixer equivalent, with 8 hue nodes (red, orange, yellow, green, cyan, blue, lavender, magenta) for saturation, hue shift and brightness, in darktable UCS. Curves between nodes use periodic RBF / Gaussian interpolation (`_periodic_RBF_interpolate` :1737); a guided filter smooths the hue/saturation analysis to avoid noise and halos (`_prefilter_chromaticity` :611). Lightroom's 8 HSL bands differ (aqua, purple instead of cyan, lavender), so node hues need a mapping. The older Lab-based **color zones** is what darktable's Lightroom importer targets for HSL (`lightroom.c:717`).

**Detail, correction and retouch (Phase 3)**

- **denoise (profiled)** (`denoiseprofile.c`, 3813 lines): needs a per-camera, per-ISO noise profile `(a, b)` from `data/noiseprofiles.json` (`dt_noiseprofile_get_matching`, used in `reload_defaults` :2677). A generalised Anscombe/variance-stabilising transform (`precondition_v2` :994, or `precondition_Y0U0V0` :1128 for the default Y0U0V0 colour mode) makes noise uniform, then wavelets (default mode, `process_wavelets` :1426) or non-local means (`process_nlmeans` :1775) denoise, then the inverse transform. Quick access panel exposes `strength`. Porting needs the JSON noise database as well as the code.
- **diffuse or sharpen** (`diffuse.c`): an anisotropic heat-equation PDE run on wavelet scales (`wavelets_process` :1150, `heat_PDE_diffusion` :949). All-zero defaults do nothing; behaviour comes from 21 presets (`init_presets` :235): sharpness, lens deblur, sharpen demosaicing (AA filter / no AA filter), local contrast, denoise, dehaze, inpaint highlights, surface blur and artistic effects (bloom, line drawing, watercolor). Cost grows with iterations x wavelet scales.
- **sharpen** (`sharpen.c`, 437 lines): classic USM on Lab L only, separable Gaussian (`init_gaussian_kernel` :112, `process` :251); detail below `threshold` is ignored and the rest is reduced by it (:107). Lightroom's "Masking" slider has no parameter here; the closest darktable mechanism is the **details threshold** in the blending mask refinement (section 2).
- **lens correction** (`lens.cc`, 4920 lines): three methods (`dt_iop_lens_method_t` :67): Lensfun database (`_process_lf` :1066), embedded maker metadata for Sony, Fuji, DNG, Olympus and Panasonic (`_init_coeffs_md_v2` :2208, `_process_md` :2803; default when present, :3636-3640), and manual vignette only. Distortion and TCA use Lensfun's `ApplySubpixelGeometryDistortion` (per-channel source coordinates, :1129) and vignetting `ApplyColorModification` (:1197); geometry callbacks (`distort_transform` :3241) let masks follow. Lensfun's database would have to ship with LightBench.
- **haze removal** (`hazeremoval.c`): He et al. dark channel prior with a guided filter (`_dark_channel` :315, `_ambient_light` :449, `_transition_map` :334, `process` :559). Two sliders (strength, distance). Direct Dehaze equivalent.
- **retouch** (`retouch.c`, 4882 lines): shapes from the mask system (circle, ellipse, path, brush) each with an algorithm: clone, heal, blur, fill (`rt_process_forms` :3694). Heal calls `dt_heal` (`src/common/heal.c`), based on GIMP's healing tool: it solves Laplace's equation on the difference between source and target (comment at `heal.c:22-35`), iterating up to `max_heal_iter` (default 2000). Optional wavelet decomposition lets each shape act on one frequency scale (split-frequency skin retouch). The source-to-target transform of a clone follows all distortions in between (`rt_masks_get_transform_to_destination` :901). Lightroom's Spot Removal maps to clone/heal; darktable's Lightroom importer still targets the deprecated **spots** module (`lightroom.c:925`).
- **liquify** (`liquify.c`, 3812 lines): up to 100 nodes of point, line and curve warps (linear, radial grow, radial shrink) turned into a distortion map (`create_global_distortion_map` :1098) and resampled (`process` :1390). No Lightroom equivalent.

**Effects (Phase 3)**

- **grain** (`grain.c`, CPU only): 2D simplex noise (`_simplex_2d_noise` :317) mapped through a paper-response LUT (`evaluate_grain_lut` :352). The noise seed is a hash of the file name (:454-455), so grain is stable per image. darktable's Lightroom importer maps `GrainAmount`/`GrainFrequency` here (`lightroom.c:568`).
- **vignetting** (`vignette.c`): fall-off between `scale` and `scale+falloff_scale` with a super-ellipse `shape` exponent (:749-751), applied to brightness and saturation; optional dithering. Lightroom's Post-Crop Vignetting maps here in darktable's importer (`lightroom.c:536`). Note it sits at #87, after crop, so it is "post-crop" by position.

---

## 2. Masking and blending

Every module with `IOP_FLAGS_SUPPORTS_BLENDING` (70 of 97) gets the same blending stage after its `process()`: the pipe calls `dt_develop_blend_process()` (`src/develop/blend.c:548`; OpenCL `dt_develop_blend_process_cl` :957). The mask is built in this order (from `blend.c:548-860`):

1. **Drawn mask** (`DEVELOP_MASK_MASK`): the module's mask group is rasterised for the ROI (`_render_drawn_mask_cached` :488 -> `dt_masks_group_render_roi`, `masks/group.c:741`). Skipped for modules with `IOP_FLAGS_NO_MASKS` (retouch, spots).
2. **Parametric mask** (`DEVELOP_MASK_CONDITIONAL`, "blendif"): range sliders on input and output channels, computed in the blend colour space (dispatch at `blend.c:724-746`).
3. **Raster mask** (`DEVELOP_MASK_RASTER`): reuse the final mask of another module instance (`dt_dev_get_raster_mask`, `pixelpipe_hb.c:3891`, chosen by `_raster_source` :394). `highlights` and `rasterfile` publish masks without blending (`IOP_FLAGS_WRITE_RASTER`).
4. **Details refinement**: threshold on the Scharr "details mask" (`_refine_with_detail_mask` :258; see `masks/detail.c`).
5. **Post-processing of the mask** in an order set by `_get_post_operations` :305: feathering with a guided filter guided by the module input or output, before or after the blur depending on `feathering_guide` (`_develop_blend_process_feather` :407, calling `guided_filter`); blur; then contrast/brightness with opacity (`_develop_blend_process_mask_tone_curve` :429).
6. **Blend** of module input and output with the chosen blend mode (dispatch at `blend.c:817-840`).

Drawn and parametric masks are combined by `mask_combine` (`DEVELOP_COMBINE_*`, `blend.h:103-114`): exclusive/inclusive and inverted. Shapes inside a drawn group combine by `DT_MASKS_STATE_UNION / INTERSECTION / DIFFERENCE / EXCLUSION / SUM` (`develop/masks.h:52-68`).

**Blend parameters** (`dt_develop_blend_params_t`, `blend.h:180-222`; `DEVELOP_BLEND_VERSION` 14 at `blend.h:31`): `mask_mode`, `blend_cst`, `blend_mode`, `blend_parameter`, `opacity`, `mask_combine`, `mask_id`, `blendif` bits, `feathering_radius`, `feathering_guide`, `blur_radius`, `contrast`, `brightness`, `details`, `blendif_parameters[4*16]`, `blendif_boost_factors[16]`, `raster_mask_source`, `raster_mask_instance`, `raster_mask_id`, `raster_mask_invert`. Stored per history item as `blendop_params` (database and XMP).

**Blend colour spaces** (`dt_develop_blend_colorspace_t`, `blend.h:35-42`): RAW, Lab, RGB display (parametric channels: gray, R, G, B, HSL H/S/l) and RGB scene (gray, R, G, B, JzCzhz). The channel enum is `dt_develop_blendif_channels_t` (`blend.h:124-176`).

**Blend modes** (`dt_develop_blend_mode_t`, `blend.h:44-91`): normal, bounded, lighten, darken, multiply, average, add, subtract, subtract-inverse, divide, divide-inverse, difference, screen, overlay, softlight, hardlight, vividlight, linearlight, pinlight, lightness, chromaticity, hue, color, coloradjust, Lab lightness/color/L/a/b, HSV value/color, RGB R/G/B channel, geometric mean, harmonic mean; plus a `REVERSE` bit that swaps input and output. Several older values are kept as `*_OBSOLETE` for old edits. Not every mode exists in every colour space; see the per-space `_blend` functions below.

### 2.1 Files

| File | Lines | What it does |
|---|---|---|
| `src/develop/blend.h` | -- | Enums (mask modes `dt_develop_mask_mode_t` :93-101) and `dt_develop_blend_params_t` (above). |
| `src/develop/blend.c` | 2296 | Blend pipeline (`dt_develop_blend_process` :548, `_cl` :957), default blend colour space per module (`_blend_default_module_blend_colorspace` :65), parametric-mask setup (`dt_develop_blendif_process_parameters` :161), feathering, details refinement, raster source, legacy-params upgrade (`dt_develop_blend_legacy_params` :1682). |
| `src/develop/blend_gui.c` | 3745 | The "blending" UI under each module: mode tabs (uniform, drawn, parametric, drawn & parametric, raster), parametric sliders with colour stops, mask refinement sliders, show-mask toggles. |
| `src/develop/blends/blendif_lab.c` | 1529 | Parametric mask (`dt_develop_blendif_lab_make_mask` :191) and blend ops (`dt_develop_blendif_lab_blend` :1409) in Lab/LCh. |
| `src/develop/blends/blendif_rgb_hsl.c` | 1368 | Same for display-referred RGB with HSL channels (`_make_mask` :232, `_blend` :1281). |
| `src/develop/blends/blendif_rgb_jzczhz.c` | 1087 | Same for scene-referred RGB with JzCzhz channels (`_make_mask` :256, `_blend` :998). This is the one to port for a scene-referred pipe. |
| `src/develop/blends/blendif_raw.c` | 456 | Same for raw data (`_make_mask` :40, `_blend` :394). |
| `src/develop/masks.h` | -- | Shape types (`DT_MASKS_CIRCLE, PATH, GROUP, CLONE, GRADIENT, ELLIPSE, BRUSH, NON_CLONE`, and `OBJECT` under `HAVE_AI`; :35-49), combine states, `dt_masks_form_t`, and the per-shape vtable `dt_masks_functions_t` (`get_distance`, `get_points`, `get_points_border`, `get_mask`, `get_mask_roi`, `get_area`, `get_source_area`, mouse handlers, `post_expose`). |
| `src/develop/masks/masks.c` | 3260 | Shape registry, creation, duplication, reading/writing `masks_history` (`dt_masks_read_masks_history`, `dt_masks_write_masks_history_item`), GUI event routing, the mask combo in module headers, cleanup of unused shapes. |
| `src/develop/masks/group.c` | 828 | Groups of shapes with union/intersection/difference/exclusion/sum; renders a group to a float mask for a ROI (`dt_masks_group_render_roi` :741, `_group_get_mask_roi` :634). |
| `src/develop/masks/circle.c` | 1508 | Circle with feathered border (vtable at :1480). |
| `src/develop/masks/ellipse.c` | 2221 | Ellipse, rotation, proportional or fixed feather (vtable :2194). |
| `src/develop/masks/gradient.c` | 1537 | Linear gradient with curvature and compression (vtable :1513). Lightroom's Linear Gradient. |
| `src/develop/masks/path.c` | 5619 | Closed Bezier path; each node stores corner, two control points and its own border/feather (`dt_masks_point_path_t`, `masks.h:173-180`); vtable :5591. |
| `src/develop/masks/brush.c` | 3632 | Open brush strokes with hardness, density and pen-pressure handling (vtable :3605). Lightroom's Brush. |
| `src/develop/masks/object.c` | 2000 | AI object mask (only with `HAVE_AI`): runs SAM 2.1 / SegNext through ONNX Runtime (`common/ai/segmentation.c`), refines with a guided filter, vectorises the result into path shapes (`common/ras2vect.c`) and can save it as a raster PNG for `rasterfile` (comment at :835). Closest to Lightroom's Object mask. |
| `src/develop/masks/detail.c` | 212 | Details mask: Scharr gradient of Y0 written by demosaic (or rawprepare for monochrome), turned into a 0..1 mask by a sigmoid around the threshold and blurred (design notes at :18-105; `dt_masks_calc_detail_mask` :181). |
| `src/develop/pixelpipe_hb.c` | -- | Mask plumbing in the pipe: Scharr mask write (`dt_dev_write_scharr_mask` :4159), distortion of the details mask through later geometry modules (`dt_dev_distort_detail_mask` :4259), raster mask lookup and distortion (`dt_dev_get_raster_mask` :3891), mask cache (`dt_dev_pixelpipe_prepare_mask_cache` :3779). |
| `src/libs/masks.c` | 2514 | "mask manager" side panel: tree of all shapes and groups, rename, combine operators, reuse a shape in several modules. |
| `src/iop/mask_manager.c` | 130 | Hidden dummy module so mask-manager edits have a history entry. |
| `src/common/guided_filter.c`, `src/common/heal.c`, `src/common/dwt.c` | -- | Shared filters used by feathering, retouch heal and retouch wavelet scales. |

### 2.2 Mapping to Lightroom masking (suggested)

| Lightroom | darktable |
|---|---|
| Brush | brush shape (`masks/brush.c`) |
| Linear Gradient | gradient shape (`masks/gradient.c`), or the `graduatednd` module |
| Radial Gradient | ellipse shape with feather (`masks/ellipse.c`) |
| Color Range / Luminance Range | parametric mask (blendif) in RGB-scene (JzCzhz) or Lab |
| Object (and, loosely, Subject / Sky) | AI object mask driven by click prompts (`masks/object.c`, `HAVE_AI`), or an external mask through `rasterfile`. No automatic subject or sky detection was found in `object.c`, `common/ai/segmentation.c` or `libs/masks.c`. |
| Intersect / Subtract / Add | group combine states (`masks/group.c`) and `mask_combine` |
| "Masking" slider in Detail | details threshold in mask refinement (`masks/detail.c`) |

Note a structural difference: in Lightroom a mask carries its own set of adjustments; in darktable a mask belongs to one **module instance**, and local adjustments are made by adding a second instance of the module with a mask. Multiple instances are ordered by `multi_priority` in history.

---

## 3. Lighttable and library modules (src/libs)

"lib" modules are the side-panel and toolbar plugins. Each declares `name()`, the views it appears in (`views()`, `DT_VIEW_*` flags) and a panel position (`container()`); API in `src/libs/lib_api.h`, loader in `src/libs/lib.c`. Purposes in quotes are the module's own `description()` tooltip; others are summarised from the code. Most libs delegate the real work to `src/common/` or `src/control/jobs/`; those files are listed too.

### 3.1 Panel modules

| Lib (file, lines) | UI name | Views | Purpose | Backing code | Closest LrC | Phase |
|---|---|---|---|---|---|---|
| `import.c` (2713) | import | lighttable | "add to library" or "copy & import" (with rename and destination-folder patterns); places/folders browser with thumbnails, ignore non-raws, recursive, apply metadata and tags on import (`gui/import_metadata.c`), import from camera. | `control/jobs/control_jobs.c`, `common/import_session.c`, `common/film.c`, `gui/import_metadata.c` | Import dialog | 1 (done), 2 (presets) |
| `collect.c` (4597) | collections | lighttable, map, print | "define search criteria for images to be displayed or edited": rules on about 40 properties (`DT_COLLECTION_PROP_*` in `common/collection.h`): film roll, folders, tag, metadata, camera, lens, ISO, aperture, dates, rating, colour label, history, module, grouping, geotagging, text search, and more. | `common/collection.c` (3314) | Folders, Collections, Smart Collections | 2 |
| `recentcollect.c` (367) | recently used collections | several (`DT_VIEW_MULTI`) | "select among the most recent search criteria set in the collections module" | `common/collection.c` | Recent sources | 2 |
| `filtering.c` (2431) + `filters/*.c` (17 files) | collection filters | lighttable, map, print | "refine the set of images to display or edit"; filters can be pinned to the top bar. Filters: aperture, colors, date, duplicates, exposure, exposure bias, filename, focal, history, ISO, local copy, misc, module order, rating, rating range, ratio, search. | `common/collection.c` | Library Filter bar | 1 (basic), 2 |
| `select.c` (385) | selection | lighttable | "modify which of the displayed images are selected": all, none, invert, same film roll, untouched. | `common/selection.c` | Edit > Select ... | 1 |
| `image.c` (896) | actions on selection | lighttable | Delete, move, copy, copy locally, duplicate, duplicate virgin, group/ungroup, reset rotation, refresh EXIF, set monochrome/colour, **create HDR**, copy/paste/clear metadata (ratings, colours, tags, geo tags). | `control/jobs/control_jobs.c` (`dt_control_merge_hdr`, :410+), `common/grouping.c` | Library > Photo menu, Stacking, Merge to HDR | 2, 5 (HDR) |
| `copy_history.c` (358) | history stack | lighttable | "perform actions on the history stacks of the currently selected images": copy, selective copy, paste, selective paste (append or overwrite mode), compress, discard, load sidecar file, write sidecar files. | `common/history.c` (`dt_history_copy_and_paste_on_image` :916, merge :591, overwrite :755) | Copy/Paste/Sync Settings | 2 |
| `styles.c` (1063) | styles | lighttable (+ darkroom quick button) | "apply styles to the currently selected images or manage your styles": create from history, apply in append or overwrite mode, optionally to a new duplicate, import/export `.dtstyle` files (`common/styles.c:1291`). | `common/styles.c` (1857), `gui/styles_dialog.c`; tables `data.styles`, `data.style_items` | Develop Presets | 2 |
| `tagging.c` (4146) | tagging | darkroom, lighttable, map, tethering | "add or remove keywords for the currently selected images"; hierarchical tags, tag dictionary with suggestions, import/export of tag lists. | `common/tags.c` (2038); tables `data.tags`, `main.tagged_images` | Keywording + Keyword List | 2 |
| `metadata.c` (1635) | metadata editor | lighttable, tethering | "modify text metadata fields of the currently selected images": title, description, creator, publisher, rights, notes, version name, image id, preserved filename (XMP keys at `common/database.c:3230-3250`); Creative Commons licence presets. | `common/metadata.c`; table `main.meta_data` | Metadata panel (editable IPTC) | 2 |
| `metadata_view.c` (1891) | image information | all views | Read-only EXIF/file/database info for the hovered image. | `common/image.c`, `common/exif.cc` | Metadata panel (EXIF), Info overlay | 1 |
| `duplicate.c` (511) | duplicate manager | darkroom | "create/rename/remove multiple edits of the current image". Versions share the raw; version N > 0 gets a `_NN` suffix in its sidecar name (`common/image.c:562-570`). | `common/image.c` (duplicate), `common/history.c` (`dt_history_duplicate` :1531) | Virtual Copies | 2 |
| `history.c` (1354) | history | darkroom | Edit history list ("click on an entry to temporarily return to that earlier state"), compress history stack, create a style from history. | `src/develop/develop.c` (history add/pop), `common/history.c` | History panel | 1 |
| `snapshots.c` (1373) | snapshots | darkroom | "remember a specific edit state and allow comparing it against another or returning to that version"; split or side-by-side compare, restore into history. | `common/history_snapshot.c` (`dt_history_snapshot_create` :30, `_restore` :249) | Snapshots + Before/After | 3 |
| `export.c` (2571) | export | lighttable (darkroom if enabled) | "create new files for the currently selected images which apply your edits": storage, format, size (pixels, cm or inch with dpi, or scale), allow upscaling, high quality resampling, profile, intent, style, metadata options. | `imageio/imageio.c` (`dt_imageio_export_with_flags` :1042), `imageio/format/*`, `imageio/storage/*`, `control/jobs/control_jobs.c` | Export dialog | 1 |
| `export_metadata.c` (356) | -- (dialog) | -- | Dialog choosing what goes into exported files: EXIF, darktable metadata, geo tags, tags (`Xmp.dc.Subject`), hierarchical tags (`Xmp.lr.Hierarchical Subject`), private tags, synonyms, develop history, and formula-based extra tags. | `common/metadata_export.c` | Export > Metadata | 1 |
| `geotagging.c` (2070) | geotagging | lighttable, map | "set geolocation information for the currently selected images": apply GPX tracks, time offset and time zone. | `common/gpx.c`, `common/image.c` | Map > Tracklog | 5 |
| `location.c` (817) | find location | map | Search places through OpenStreetMap Nominatim (`location.c:380`). | -- | Map search box | 5 |
| `map_locations.c` (1029) | locations | map | Named locations with ellipse, rectangle or polygon shapes (`common/map_locations.h:30-32`), stored as tags. | `common/map_locations.c` | Map > Saved Locations | 5 |
| `map_settings.c` (160) | map settings | map | Map source and display options. | `views/map.c` | Map view options | 5 |
| `print_settings.c` (4088) | print settings | print | Printer, paper size, printer profile, intent, black point compensation, page layout. | `common/printing.c`, `common/cups_print.c`, `common/printprof.c` | Print module panels | 5 |
| `camera.c` (679) | camera settings | tethering | Camera properties for tethered capture (gphoto2). | `common/camera_control.c` | Tethered Capture | 6 (desktop) |
| `live_view.c` (800) | live view | tethering | Live view with overlay, split line, rotation/flip, focus moves and autofocus. | `common/camera_control.c` | -- | 6 |
| `session.c` (126) | session | tethering | Job code for the tethering session. | `common/import_session.c` | Tethered Capture session | 6 |
| `masks.c` (2514) | mask manager | darkroom | "manipulate the drawn shapes used for masks on the processing modules" (section 2). | `develop/masks/*` | Masking panel | 3 |
| `modulegroups.c` (4568) | modulegroups | darkroom | Module tabs, presets for module layouts, search box, and the **quick access panel** (section 6). | -- | Develop panel layout | 1 (QAP-like basics), 3 |
| `ioporder.c` (276) | module order | darkroom | Shows and resets the pipe order (v3.0/v5.0/legacy/custom). | `common/iop_order.c` | none | -- |
| `colorpicker.c` (922) | color picker | darkroom | Global colour picker with statistic (mean, min, max) and colour mode selection, live samples. | `common/color_picker.c`, `gui/color_picker_proxy.c` | none (WB eyedropper only) | 3 |
| `histogram.c` (1032) + `scopes/*.c` | scopes | darkroom, tethering | Histogram (linear/log), waveform and RGB parade (`waveform.c`), vectorscope with colour-harmony guides (`vectorscope.c`), split view of two scopes (`split.c`); drag in the histogram to change exposure or black point. | `common/histogram.c`; scopes: `histogram.c` 289, `waveform.c` 562, `split.c` 364, `vectorscope.c` 1569 | Histogram (drag to adjust) | 1 (Part 2b) |
| `navigation.c` (714) | navigation | darkroom | Thumbnail navigator with zoom levels. | -- | Navigator | 1 |
| `neural_restore.c` (4859) | neural restore | darkroom, lighttable | "AI-based image restoration: denoise and upscale" (ONNX models); writes new TIFF files with chosen bit depth, compression and embedded profile. | `common/ai/restore*.c`, `src/ai/` | Enhance (Denoise, Super Resolution) | 4 |
| `backgroundjobs.c` (330) | background jobs | all | Progress of long jobs. | `control/jobs.c`, `control/progress.c` | Activity center | 1 |

### 3.2 Toolbar and utility modules (`src/libs/tools/`)

| File (lines) | UI name | Purpose (from file/strings) | Closest LrC |
|---|---|---|---|
| `filmstrip.c` (172) | filmstrip | Bottom filmstrip | Filmstrip |
| `timeline.c` (1445) | timeline | Date histogram strip for the collection | none |
| `lighttable.c` (702) | lighttable | Layout (file manager, zoomable, culling, culling dynamic, preview; `views/view.h:77-83`) and thumbnails-per-row | Grid/Loupe/Compare/Survey switch |
| `filter.c` (150) | filter | Top-bar pinned filters and sort | Filter bar |
| `ratings.c` (112), `colorlabels.c` (321) | ratings, colorlabels | Star and colour-label buttons | Toolbar ratings/labels |
| `global_toolbox.c` (927) | preferences | Preferences, shortcuts, help buttons | Preferences |
| `viewswitcher.c` (304) | viewswitcher | Switch between views | Module picker |
| `darktable.c` (293) | darktable | Logo/about | -- |
| `module_toolbox.c` (62), `view_toolbox.c` (65) | -- | Containers for buttons from other modules | -- |
| `image_infos.c` (179) | image infos | Info line overlay | Info overlay |
| `hinter.c` (111), `log_history.c` (246) | hinter, log history | Hint text; log message history | -- |
| `midi.c` (703), `gamepad.c` (338) | midi, gamepad | Input devices bound to shortcuts | none |

### 3.3 Export formats (`src/imageio/format/`) and storages (`src/imageio/storage/`)

| Format file (lines) | UI name | Storage file (lines) | UI name |
|---|---|---|---|
| `jpeg.c` (620) | JPEG (8-bit) | `disk.c` (669) | file on disk |
| `png.c` (801) | PNG | `clipboard.c` (448) | copy to clipboard |
| `tiff.c` (960) | TIFF | `email.c` (485) | send as email |
| `webp.c` (473) | WebP | `gallery.c` (698) | website gallery |
| `avif.c` (1153) | AVIF | `latex.c` (485) | LaTeX book template |
| `heif.c` (846) | HEIF | `piwigo.c` (1660) | Piwigo |
| `jxl.c` (700) | JPEG XL | | |
| `j2k.c` (746) | JPEG 2000 (12-bit) | | |
| `exr.cc` (676) | OpenEXR | | |
| `pfm.c` (143), `ppm.c` (129) | PFM, PPM (16-bit) | | |
| `pdf.c` (836) | PDF | | |
| `xcf.c` (380) | XCF | | |
| `copy.c` (138) | copy (original file) | | |

Format API: `src/imageio/format/imageio_format_api.h`. Decoders for import are in `src/imageio/imageio_*.c`; the magic-bytes loader table `_magic_signatures[]` is at `src/imageio/imageio.c:213-503`. Raw files go to rawspeed (`dt_imageio_open_rawspeed`), except CR3 and X3F which go to LibRaw (`imageio.c:279`, `:316`).

---

## 4. Core infrastructure

### 4.1 Pixelpipe and caching

Read `dev-doc/pixelpipe_architecture.md`, `dev-doc/IOP_Module_API.md` and `dev-doc/Module_Lifecycle.md` first; they match this checkout. Key files:

| File | Lines | Role |
|---|---|---|
| `src/develop/pixelpipe_hb.c` | 4433 | The pipe. Init per pipe type (`dt_dev_pixelpipe_init_export` :217, `_thumbnail` :231, `_preview` :251, `_preview2` :259, full `dt_dev_pixelpipe_init` :267); node build (`dt_dev_pixelpipe_create_nodes` :518); history sync (`dt_dev_pixelpipe_synch_all` :780, `_dev_pixelpipe_synch` :566); main entry `dt_dev_pixelpipe_process` :3448 -> recursive `_dev_pixelpipe_process_rec` :2093 (asks for the output of module N, which asks N-1, and so on; cache hits stop the recursion); per-module CPU path `_pixelpipe_process_on_CPU` :1645 (colour-space conversion :1687-1722, then `process()` or `process_tiling()`, then blending); output size `dt_dev_pixelpipe_get_dimensions` :3652; `dt_dev_pixelpipe_process_no_gamma` :3344; details/raster mask plumbing (:3730-4421); `dt_dev_pixelpipe_piece_hash` :4421. |
| `src/develop/pixelpipe_cache.c` | 546 | Cache lines keyed by a 64-bit hash (`dt_dev_pixelpipe_cache_hash` :160 over `_dev_pixelpipe_cache_basichash` :99), get/allocate (`dt_dev_pixelpipe_cache_get` :291), invalidation from an iop_order onward (`dt_dev_pixelpipe_cache_invalidate_later` :370), LRU by age, "important" lines kept (`dt_dev_pixelpipe_important_cacheline` :400). Number of lines per pipe: full 64, preview 12, preview2 5 when the pipe cache is enabled (`pixelpipe_hb.c:254-270`). |
| `src/develop/pixelpipe.h`, `pixelpipe_hb.h` | -- | Pipe types: export, full, preview, thumbnail, preview2, plus flags fast, image, image-float (`pixelpipe.h:43-60`); `dt_dev_pixelpipe_t`, `dt_dev_pixelpipe_iop_t` ("piece"). |
| `src/develop/develop.c` | 4448 | `dt_develop_t`: module list, history stack and cursor, viewports. History add (`dt_dev_add_history_item` :1552), write (`dt_dev_write_history_ext` :1933), read (`dt_dev_read_history_ext` :2475), auto-apply presets (`_dev_auto_apply_presets` :2020), merge (`_dev_merge_history` :2347). |
| `src/develop/imageop.c` | 4544 | Module loading, default callbacks, `dt_iop_commit_params` (builds `piece->hash` after the module's `commit_params`), module UI header. API declared in `src/iop/iop_api.h` (56 callbacks: `REQUIRED`/`DEFAULT`/`OPTIONAL`). |
| `src/develop/tiling.c` | 1934 | Tiled processing when an image does not fit in memory (CPU and OpenCL), driven by each module's `tiling_callback`. |
| `src/develop/imageop_math.c` | 971 | Shared resampling (`dt_iop_clip_and_zoom*`, used by finalscale/demosaicscale) and helpers. |
| `src/common/introspection.h`, `tools/introspection/` | -- | Perl generator run at build time over each module (`src/iop/CMakeLists.txt:24-28`): turns the `params_t` struct and its `$MIN/$MAX/$DEFAULT/$DESCRIPTION` comments into field metadata, so the core can create sliders, copy, hash and version params without knowing the struct. See `dev-doc/introspection.md`. |
| `src/common/opencl.c` | 4443 | OpenCL device setup, kernel compilation from `data/kernels/*.cl` (numbered in `programs.conf`), benchmarks and fallbacks. |

Porting notes for LightBench:

- **Colour-space contract.** Each module declares raw/rgb/lab per pipe; the pipe converts the input buffer before calling `process()` and records the output space (`pixelpipe_hb.c:1687-1722`, `:1840`). A WebGPU pipe needs the same small converter set (`dt_ioppr_transform_image_colorspace`, `src/common/iop_profile.c:1062`).
- **ROI contract.** Before processing, the pipe walks backwards calling `modify_roi_in()` so each module knows what input region it needs (geometry modules map coordinates, neighbourhood filters pad). `distort_transform`/`distort_backtransform`/`distort_mask` keep masks and picked points aligned through geometry modules.
- **Two param structs.** `params_t` is what history and XMP store (binary, versioned by `DT_MODULE_INTROSPECTION(version, ...)`, upgraded by `legacy_params()`); `data_t` is what `commit_params()` precomputes for `process()` (LUTs, matrices, solved curve constants).
- **Preview strategy.** The darkroom runs a small preview pipe (mipmap `DT_MIPMAP_F`, 1440x900, or 1920x1200 with `highres_preview_mip`, `mipmap_cache.c:744`) and a full pipe for the visible region only; export downscales after demosaic unless "high quality" is chosen (`imageio.c:1338-1381`).

### 4.2 History, XMP sidecars and the database

- **Database** (`src/common/database.c`, 5935 lines; library schema v57, data schema v13, :54-55). Edit history lives in `main.history (imgid, num, module, operation, op_params BLOB, enabled, blendop_params BLOB, blendop_version, multi_priority, multi_name, multi_name_hand_edited)` (:3497-3500), the cursor in `images.history_end`, shapes in `main.masks_history` (:3506), pipe order in `main.module_order (imgid, version, iop_list)` (:3535), change detection in `main.history_hash (basic_hash, auto_hash, current_hash, mipmap_hash)` (:3538-3542). Presets and styles are in the data database (`data.presets`, `data.styles`, `data.style_items`).
- **`src/common/history.c`** (2046): copy/paste between images with merge or overwrite (`dt_history_copy_and_paste_on_image` :916, `_merge` :591, `_overwrite` :755), merge one module into a history (`dt_history_merge_module_into_history` :313), compress (`dt_history_compress_on_image` :1206), truncate (:1361), delete (:63), history hash used to know when thumbnails are stale (`_history_hash_compute_from_db` :1583, `dt_history_hash_is_mipmap_synced` :1859).
- **XMP writing** (`src/common/exif.cc`, 6791 lines, Exiv2): `dt_exif_xmp_write` :6552 writes the sidecar; `_exif_xmp_read_data` :5618 collects the fields; `_set_xmp_dt_history` :5195 writes `Xmp.darktable.masks_history[]` and `Xmp.darktable.history[]` items with `num, operation, enabled, modversion, params, multi_name, multi_name_hand_edited, multi_priority, blendop_version, blendop_params`, plus `Xmp.darktable.history_end`. Params blobs are encoded by `dt_exif_xmp_encode_internal` :3627: hex, or zlib + base64 with a `gz` prefix and a two-digit compression factor when the `compress_xmp_tags` preference asks for it. Other keys written: `Xmp.xmp.Rating`, `Xmp.xmp.Label`, `Xmp.darktable.colorlabels`, `Xmp.dc.subject`, `Xmp.lr.hierarchicalSubject`, GPS (`Xmp.exif.GPS*`), `Xmp.darktable.iop_order_version`/`iop_order_list`, `auto_presets_applied`, `history_*_hash`, `raw_params`, `xmp_version`, `xmpMM.DerivedFrom`, timestamps. Reading is `dt_exif_xmp_read` :4543 (history v1/v2 readers :3940/:4052, masks :4217/:4298). Export embedding: `dt_exif_xmp_attach_export` :6248.
- **When sidecars are written**: preference `write_sidecar_files` (`common/image.c:364`); `dt_image_write_sidecar_file` :3084, `dt_image_synch_xmps` :3146.
- **Lightroom import** (`src/develop/lightroom.c`, 1630 lines): reads a Lightroom/ACR XMP next to the raw and converts a subset into darktable history: crop and angle (-> `clipping`), orientation (-> `flip`), `Exposure2012`/`Blacks2012` (-> `exposure`), grain, post-crop vignette, `RetouchInfo` spots (-> `spots`), tone curve and parametric curve (-> `tonecurve`), HSL (-> `colorzones`), split toning, `Clarity2012` (-> `bilat`), plus rating, label, keywords and GPS (`_lrop` :484, `dt_add_hist` :327, writes at :1317-1563). It embeds copies of the target modules' params structs at fixed versions so it does not break when modules evolve (comment at :40-46). Directly relevant to LightBench Phase 2 "Lightroom catalog/XMP import" and to the reverse mapping.
- **Undo** (`src/common/undo.c`) and **history snapshots** (`src/common/history_snapshot.c`) back darkroom undo/redo and the snapshots module.

### 4.3 Image cache and mipmaps

- **`src/common/image_cache.c`** (544): an in-memory cache of `dt_image_t` records (`dt_image_cache_get` :249; `dt_image_cache_write_release_info` :306 also syncs the XMP sidecar, :436).
- **`src/common/mipmap_cache.c`** (1748): pixel buffers per image at fixed sizes (`dt_mipmap_size_t`, `mipmap_cache.h:28-47`): `DT_MIPMAP_0`..`9` are 8-bit thumbnails from 180x110 up to 7680x4320, `DT_MIPMAP_10` is 8-bit full size, `DT_MIPMAP_F` is the float input of the preview pipe, `DT_MIPMAP_FULL` the float full image (sizes at `mipmap_cache.c:725-737`). Memory budget clamped to 100 MB..8 GB (:722). Optional disk cache of thumbnails as JPEG in `<cachedir>/mipmaps-<SHA1 of the library path>.d/<level>/<imgid>.jpg` (:360-372, :530-536; preferences `cache_disk_backend`, `cache_disk_backend_full`). Thumbnails come from the embedded JPEG when the image is unaltered and the requested size is at or below `plugins/lighttable/thumbnail_raw_min_level` (`_init_8` :1528, embedded path :1556-1620); otherwise a thumbnail export runs the full pipe (`dt_imageio_export_with_flags`, :1667). `dt_mipmap_cache_get_with_caller` :887 is the entry point (blocking, best-effort or prefetch).

### 4.4 Colour management

| File | Lines | Role |
|---|---|---|
| `src/common/colorspaces.c` / `.h` | 2697 | Profile registry and creation with LittleCMS2: built-ins sRGB, Adobe RGB, linear Rec.709/Rec.2020, ProPhoto, Display P3, PQ/HLG Rec.2020 and P3, XYZ, Lab, infrared, BRG; camera profiles: embedded ICC, embedded matrix, standard matrix (Adobe coefficients), enhanced matrix (`dt_colorspaces_create_darktable_profile` :589 from `src/common/colormatrices.c`), vendor (:538) and alternate (:487) matrices, DNG forward matrix, DNG look (enum `dt_colorspaces_color_profile_type_t`, `colorspaces.h:79-112`). Matrix profiles from XYZ (`dt_colorspaces_create_xyzimatrix_profile` :995). Display/softproof/histogram profiles and transforms (:1268-1273, `dt_colorspaces_set_display_profile` :1972). CICP mapping for HEIF/AVIF (:2207). CYGM sensors (:2502-2553). |
| `src/common/colorspaces_inline_conversions.h` | 1559 | Inline maths: XYZ/Lab/LCh, Rec.2020, ProPhoto, JzAzBz, darktable UCS, Ych, HSL/HSV, Bradford/CAT16 helpers. Most module colour maths calls into this file. |
| `src/common/iop_profile.c` / `.h` | 1722 | Per-pipe input/work/output/histogram profile info (`dt_ioppr_get_pipe_work_profile_info` :863 etc.), matrix + TRC LUT preparation (`_ioppr_generate_profile_info` :520, `_init_unbounded_coeffs` :361), whole-image conversion between profiles (`dt_ioppr_transform_image_colorspace` :1062, OpenCL :1399). This is what the pipe uses between modules. |
| `src/common/chromatic_adaptation.h`, `illuminants.h`, `darktable_ucs_22_helpers.h`, `matrices.c` | -- | CAT, illuminant and UCS maths (`chromatic_adaptation.h` is included by channelmixerrgb, colorbalancergb, colorequal, colorharmonizer, filmicrgb, satcurvergb). |
| `src/common/custom_primaries.c`, `gamut_mapping.h` | -- | Primaries inset/rotation used by sigmoid, agx and primaries; gamut mapping used by colorbalancergb and filmicrgb. |
| `src/common/printprof.c` | -- | Printer-profile transforms for the print view. |

### 4.5 Camera database integration

- **Decoding.** Raw files are opened by rawspeed (`src/imageio/imageio_rawspeed.cc`, 627 lines) except CR3 and X3F, which use LibRaw (`src/imageio/imageio_libraw.c`, 585 lines; table at `src/imageio/imageio.c:279`, `:316`). rawspeed itself is a git submodule at `src/external/rawspeed`, empty in this checkout; the separate source tree is `/home/user/darktable-org/rawspeed-src`.
- **`cameras.xml`** (`rawspeed/data/cameras.xml`, 20,089 lines, 1391 `<Camera>` entries; identical to `rawspeed-src/data/cameras.xml`). darktable loads it once from `<datadir>/rawspeed/cameras.xml` (`imageio_rawspeed.cc:61-79`). Per camera/mode it gives: `<ID>` canonical make/model (used to normalise EXIF names via `dt_rawspeed_lookup_makermodel` :81, called by `dt_imageio_lookup_makermodel`, `imageio.c:1682`, from `common/image.c` and `common/exif.cc`), `<CFA>`/`<CFA2>` pattern, `<Crop>`, `<Sensor black= white=>` (57 lines in the file carry `iso_min` or `iso_list` for ISO-specific levels), `<ColorMatrix>` rows (integers divided by 10,000, `rawspeed-src/src/librawspeed/metadata/Camera.cpp:383`), `<Aliases>`, `<Hints>`. Support status: 49 `supported="no"` (30 of them Canon, mostly CR3-era bodies such as the EOS R series and 90D, which darktable opens with LibRaw), 99 `no-samples`, 80 `unknown-no-samples`; the rest have no attribute. darktable flags images from `SupportedNoSamples` cameras (`imageio_rawspeed.cc:419-424`).
- **What darktable copies from rawspeed** (`imageio_rawspeed.cc:219-380`): `raw_black_level`, `raw_black_level_separate[4]`, `raw_white_point`, as-shot `wb_coeffs`, the Adobe XYZ->camera matrix into `img->adobe_XYZ_to_CAM` (:265-275), the CFA as dcraw `filters` (cropped with `dt_rawspeed_crop_dcraw_filters` :119) or a 6x6 X-Trans table (:378), and float/integer data type.
- **Other per-camera data in darktable:** `src/common/colormatrices.c` (enhanced/vendor/alternate matrices), `data/wb_presets.json` (white-balance presets per camera, generated with `tools/extract_wb.py`), `data/noiseprofiles.json` (denoiseprofile), basecurve maker presets (`iop/basecurve.c:395`), and Lensfun's database for `lens`. `tools/check_camera_support` and `tools/listcams.sh` report coverage.
- For LightBench (LibRaw-wasm): the black/white/matrix values LibRaw returns must be mapped onto the same `dt_image_t` fields that rawprepare, temperature and colorin read; `cameras.xml` can be used as a cross-check or to canonicalise maker/model names for preset matching.

### 4.6 darktable's Lua API (brief)

`src/lua/` (11,157 lines; API version 9.8, `src/lua/configuration.h:49-51`). The `darktable` table exposes: `database` and `films`/`film` (images and film rolls), `image` objects (`image.c`), `styles`, `tags`, `metadata`, `preferences` and `configuration`, `gui`, `register_lib` and `widget/*` (Lua-defined side-panel modules), `register_storage` (`luastorage.c`, Lua export targets), `register_event` (`events.c`; events registered with `dt_lua_event_add` include post-import-image, post-import-film, view-changed, shortcut, darkroom-image-loaded, darkroom-image-history-changed, intermediate-export-image, pixelpipe-processing-complete, collection-changed, mouse-over-image-changed, image-group-information-changed, inter-script-communication; `events.c` also names pre-import and selection-changed), `format` and `storage` types, `cairo` drawing on guides/overlays (`guides.c`, `cairo.c`), `print`, `password` (keyring), `gettext`, `control` (`call.c`), and `ai` (`ai.c`, 1840 lines: model access and raw helpers such as Bayer pack/unpack). Lua scripts are not in this checkout (`src/external/lua-scripts` is empty). For LightBench's plugin system (Phase 5), the event list in `events.c` and the storage/lib registration pattern are the parts worth studying.

---

## 5. Views (src/views)

View API: `src/views/view_api.h`; view manager and shared helpers (layout enum, culling, view switching): `src/views/view.c` (2206 lines).

| View (file, lines) | `name()` | What it is | Backing code | Closest LrC | Phase |
|---|---|---|---|---|---|
| `darkroom.c` (5875) | darkroom | Single-image editor: centre view with zoom/pan, module panels, second preview window, "color assessment" mode with a white border, guide lines, clipping preview mode and thresholds (overexposed/raw overexposed toggles), soft proof and gamut check, display/softproof/histogram profile pickers, quick access to styles and presets, drag-and-drop of XMP sidecars to apply edits. | `src/develop/*`, `src/libs/modulegroups.c`, `src/gui/guides.c` | Develop module | 1 (core), 3 (soft proof, second window) |
| `lighttable.c` (1671) | lighttable | Library: layouts file manager, zoomable, culling, culling dynamic and full preview (`views/view.h:77-83`), thumbnail table (`src/dtgtk/thumbtable.c`), keyboard selection, preview zoom. | `src/libs/collect.c`, `filtering.c`, `select.c`, `image.c` | Library module (Grid, Loupe, Compare, Survey) | 1, 2 (compare/survey) |
| `map.c` (3616) | map | OpenStreetMap map (`osm-gps-map`, :42) showing geotagged images; drag images to set location; locations and track display. | `src/libs/geotagging.c`, `location.c`, `map_locations.c`, `map_settings.c`, `src/common/map_locations.c`, `gpx.c` | Map module | 5 |
| `print.c` (390) | print | Print layout of image boxes on a page, printing through CUPS. | `src/libs/print_settings.c`, `src/common/printing.c`, `cups_print.c`, `printprof.c` | Print module | 5 |
| `slideshow.c` (766) | slideshow | Full-screen slideshow of the collection: start/stop, step, speed up/down. | renders each image with `dt_dev_image()` in a background job (`slideshow.c:193-206`) | Slideshow module | 5 |
| `tethering.c` (714) | tethering | Tethered capture with gphoto2: live view, camera settings, session job code. | `src/libs/camera.c`, `live_view.c`, `session.c`, `src/common/camera_control.c` | Tethered Capture | 6 (desktop only) |

There is no book or web view; the website gallery is an export storage (`src/imageio/storage/gallery.c`).

---

## 6. Findings relevant to LightBench usability

### 6.1 The quick access panel: darktable's "Basic" panel

- darktable has no "basic" processing module any more. Its Lightroom-Basic-like panel is the **quick access panel** (QAP), a special tab of the `modulegroups` lib (`DT_MODULEGROUP_BASICS`). It does not process anything: it borrows ("reparents") individual widgets from real modules and shows them in one list (`_basics_add_widget`, `src/libs/modulegroups.c:467`; mechanism in `dev-doc/Quick_Access_Panel.md`). Entries are named `module/widget` from the introspection names, e.g. `exposure/exposure`.
- Default contents (`SQA` macro, `modulegroups.c:1612-1668`), scene-referred: the tone mapper's main sliders (filmic: white/black relative exposure and contrast; sigmoid: contrast and skew; AgX: auto tune levels, contrast, shoulder and toe power, saturation, preserve hue), color calibration (temperature, chroma, hue, illuminant, F source, LED source), color equalizer (page, graph, node placement), `exposure/exposure`, color balance rgb (global chroma, vibrance, saturation, brilliance), `ashift/rotation`, `denoiseprofile/strength`, tone equalizer (graph and the two mask compensations), `lens` (on/off), `bilat/detail`. Display-referred swaps color calibration for `temperature/temperature` and `temperature/tint` and adds `colorbalancergb/contrast`.
- Limits documented in `dev-doc/Quick_Access_Panel.md`: an entry binds to one instance of a module, and a module's on/off entry is disabled once it has several instances.

### 6.2 Why "basic adjustments" (basicadj) is deprecated

- The code's own reasons: `deprecated_msg()` says "this module is deprecated. please use the quick access panel instead." (`src/iop/basicadj.c:155-158`), and every pipe-order list carries the comment "module mixing view/model/control at once, usage should be discouraged" (`src/common/iop_order.c:254`, `:377`, `:500`, `:626`).
- What the code shows about the module: one instance at position #52 (after colorin, before the tone mappers) applies black point, exposure, highlight compression, contrast, brightness, saturation and vibrance in one pass, plus its own histogram-based auto exposure (`_get_auto_exp` :879, `_auto_exposure` :1197); description: input "linear, RGB, scene-referred", output "non-linear, RGB" (`basicadj.c:165-171`).
- Our reading (not stated in the code): the problem is a single module doing operations that belong at different points of a scene-referred pipe (exposure early and linear, tone mapping later, saturation in a perceptual space). The QAP keeps one panel for the user and leaves each operation in its proper module. This matches LightBench's plan, where the Lightroom-style sliders drive several darktable modules.
- Still useful to read: basicadj's auto exposure is a compact reference for LightBench's Auto button (Phase 1 Part 2b), together with exposure's deflicker mode (`exposure.c:442`) and the auto-tune pickers in filmicrgb, agx and rgblevels.

### 6.3 Module groups, presets and styles

- **Module-group presets** (`modulegroups.c:1797-1987`): "modules: all", "workflow: beginner", "workflow: display-referred", "workflow: scene-referred" (also the fallback, `FALLBACK_PRESET_NAME`, :50), "search only", plus "previous config" migrations. A "modules: deprecated" group exists in code but is disabled with `#if 0` (:1962-1973). Users can create their own groups and search modules by name or alias (`aliases()`; 35 modules define aliases, e.g. colorequal "color zones|hsl", colorbalancergb "offset power slope|cdl|color grading|...").
- **"workflow: beginner"** (:1802-1835) is a short curated list close to Lightroom's basics: base = ashift, sigmoid (or basecurve if display-referred), crop, denoiseprofile, exposure, flip, lens, temperature; grading = channelmixerrgb, colorequal, graduatednd, rgbcurve, rgblevels, splittoning; effects = borders, monochrome, retouch, sharpen, vignette, watermark.
- **Per-module presets** (`src/common/presets.c`, table `data.presets`) can auto-apply by camera maker/model, lens, ISO, exposure, aperture, focal length and raw/LDR/HDR/mono format (`_dev_auto_apply_presets`, `src/develop/develop.c:2020`). This is darktable's form of Lightroom's raw defaults and camera-specific defaults.
- **Styles** (`src/common/styles.c`) are named sets of history items across modules (Lightroom develop presets), applied in append or overwrite mode, exported as `.dtstyle`.
- **Local adjustments** are done with extra module instances plus masks (section 2), not with Lightroom-style mask pins carrying their own sliders. LightBench's masking UI will need its own model on top.

### 6.4 Other things worth knowing

- **Lightroom XMP import already exists** in darktable (`src/develop/lightroom.c`, section 4.2), with tag-by-tag mappings to darktable modules. Use it as a reference for Phase 2 import and for choosing which darktable module each Lightroom slider drives.
- **Clipping indicators and histogram interaction** for Phase 1 Part 2b: `overexposed` (any RGB, luminance, saturation, gamut modes; thresholds in EV and %) and `rawoverexposed`; the scopes lib lets the user drag the histogram to change exposure or black point (`src/libs/histogram.c`).
- **AI features are optional** (`USE_AI` off by default, `dev-doc/AI.md`): AI object masks (SAM 2.1 small default, SegNext alternative), "neural restore" denoise (NIND), raw denoise (RawNIND) and upscale (RealPLKSR) are listed in `data/ai_models.json`; ONNX Runtime backend in `src/ai/`. Model licences are not stated in these files (unknown); LightBench's plan requires checking each one.
- **HDR merge** exists as a lighttable action ("create HDR", `dt_control_merge_hdr`, `src/control/jobs/control_jobs.c:410+`): merges raw mosaics into a float DNG, with an auto-alignment design in `dev-doc/HDR_Alignment_Design.md` and `src/common/hdr_alignment.cc`. **No panorama stitching** code was found (a search for "panorama", "hugin", "stitch" in `src/` matched only unrelated uses in tiling.c, clipping.c, crop.c and highlights.c).
- **Headless MCP server** (`src/mcp/`, `darktable-mcp`): exposes the pixelpipe, module introspection, styles and history to AI agents over JSON-RPC (`src/mcp/README.md`). Not needed for LightBench, but a reference for scripting the engine.
- **CPU-only modules** (19, listed in 1.1) have no OpenCL kernel to translate; their WebGPU shaders must be written from the C code. This includes grain, contrastntexture, cacorrectrgb, hotpixels and rawdenoise.
- **Small inconsistencies found in the code** (report upstream or keep in mind when porting): defringe's misplaced deprecation flag (`defringe.c:88`); the "modules: all" preset lists `"profile"` instead of `"profile_gamma"` (`modulegroups.c:1752`); `colorbalance` (legacy, not deprecated) is in no tab; the `is_ldr`/`DT_IMAGE_HDR` naming in `iop_order.c:787`; `dev-doc/Module_Groups.md` names enum values that do not exist.
