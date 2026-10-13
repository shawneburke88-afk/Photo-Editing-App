> **Provenance:** an independent research run done in Claude Cowork on 2026-10-13, written without seeing the drafts in `docs/research/`. It has not been re-verified, except where the spot-check log in [INDEX.md](INDEX.md) says so. The text below is copied unchanged.

# LightBench research: Part 1, tone curve workflow

Research date: 2026-10-13. Scope: Part 1 of `BRIEF.md` only. The earlier drafts listed in the brief were **not** opened.

> **How to read this document**
> - **CONFIRMED** means a primary or near-primary source was fetched and the supporting sentence is quoted with its URL.
> - **[unconfirmed]** means remembered, secondhand, or not verifiable with the tools available. Do not build on these without checking.
> - **Analysis** marks my own reasoning from the sources. It is not a sourced fact.
> - Quotes come through a page-to-text tool that sometimes cut long sentences short. Where only part of a sentence could be quoted, the quote is marked as partial.

---

## Decisions this changes

| # | Owner's current decision | Verdict | One-line reasoning | Main sources |
|---|---|---|---|---|
| 1 | Tone curve applied **after** Contrast (after the sigmoid, on display-referred values) | **Supports** (with one caveat) | darktable's own *tone curve* sits after sigmoid in every current module order (v50: sigmoid 45.3 → tone curve 48.0). ART also runs its Tone Curves after Log Tone Mapping, and LightCraft applies its tone curves after its tone map, on sRGB-encoded values (1.7). Caveat: darktable's manual says most processing should happen before the display transform, and darktable's *rgb curve* sits before sigmoid. | [S1], [S3], [S4], [S12], [L6], [L7]; caveat [S4] |
| 2 | Parametric mode kept as **"Regions"** | **Supports** | Lightroom's parametric curve is four region sliders (Highlights/Lights/Darks/Shadows) plus split controls, stored as `Parametric*` XMP fields. RawTherapee and LightCraft (raised-cosine regions, splits default 25/50/75) use the same four-slider, three-split layout. A 2023/2025 study found expert FiveK curves are "well-approximated by simple tone curve adjustments". "Regions" is LightBench's own label; Adobe calls it the "Parametric Curve". | [S9], [S10], [S13], [S18], [S32], [S33], [L7], [L8] |
| 3 | Stronger colour with contrast, plus a **"Saturation"** slider | **Supports the behaviour; Mixed on the name** | Lightroom's point curve raises saturation by default, and **Refine Saturation** (default 100 = old behaviour, 0 = luminance only) was added in June 2023 (LrC 12.4 / ACR 15.4 / Lr 6.4, per secondary sources). Adobe's curve is described as hue-preserving ("film-like"). Naming risk: `crs:Saturation` is already Lightroom's Basic-panel Saturation, so a curve slider called "Saturation" invites confusion and XMP mix-ups. LightCraft names it "Refine Saturation" (0–100, default 100) and reads it from `crs:CurveRefineSaturation`, a field name only its own docs state. | [S9], [S10], [S11], [S12a], [S13], [S14], [S15], [S16], [L7], [L12] |
| 4 | **R/G/B curves** in | **Supports** | Lightroom has R/G/B point curves (`ToneCurvePV2012Red/Green/Blue`), and so do Capture One, DxO PhotoLab, Photoshop, Apple Photos, Resolve and LightCraft. Note: Refine Saturation is not offered for the R/G/B curves. | [S10], [S13], [S14], [S20], [S21], [S23], [S24], [S27], [L7] |

**No finding contradicts a current decision.** The biggest new input is the colour model behind decision 3. Lightroom's curve is reportedly Adobe's DNG "film-like" curve, which keeps RGB-HSV hue constant while letting saturation rise. That is a better default than either plain per-channel RGB (which shifts hue) or darktable's luminance-ratio mode (which mutes colour). See "Candidate improvements" row 2.

**LightCraft** (added on request) changes no verdict. It independently makes the same choices as decisions 1, 2 and 4, and has a Refine Saturation slider like decision 3. Its master curve is plain per-channel, so it is an example of the hue-shift behaviour that row 2 tries to avoid. Its "Lightroom parity" percentages are counts of its own checklist, not measured render fidelity (1.8).

---

## Summary

All the photo editors surveyed converge on the same small set of ideas. There is a region-based ("parametric") curve for quick work, a point curve with per-channel R/G/B, a way to grab tones from the image (Lightroom's Targeted Adjustment Tool, Photoshop's on-image tool, darktable's picker, Apple's "Add Points"), and some control over whether contrast also raises saturation:
- Lightroom: Refine Saturation;
- Capture One and DxO: a Luma/L channel;
- RawTherapee/ART: six or more colour modes, including a slow "Perceptual" one;
- darktable: "preserve colors" norms.

darktable's current pipe confirms the owner's chosen placement. The display-referred *tone curve* runs after sigmoid/filmic/AgX, and the scene-referred *rgb curve* runs before them. ART and LightCraft do the same: LightCraft applies its parametric and point curves after its filmic tone map, on sRGB-encoded values. Placing LightBench's curve after the sigmoid makes it possible to line the curve's axis up exactly with the histogram the user sees. It also bounds the curve's input (no values above display white) and matches the Lightroom feel. The costs are:
- per-channel curves can clip and shift hue on already-compressed values;
- the curve cannot reach HDR headroom without an extended-range design. Adobe has patent filings on HDR point-curve visualisation (status below).

Evidence says users mostly need simple curves. Bennett & Finlayson report that expert edits in MIT-Adobe FiveK are well approximated by monotone curves with at most one inflexion, with no preference difference. That supports a guided, low-node design with a monotone spline, plus on-image and keyboard input, rather than a feature-heavy curve editor.

The recommended first version is:
- Regions plus a point curve with R/G/B;
- a hue-preserving "film-like" default for the master curve, with a Refine-Saturation-style slider;
- a histogram drawn in the curve's own encoding;
- TAT with arrow keys, numeric entry, Alt-drag clipping preview, and an accessible keyboard model.

Most other features can follow later.

---

## Method notes and access problems (read before trusting the gaps)

- **`gh api` was blocked** for darktable and every other repository: "GitHub access to this repository is not enabled for this session." GitHub source was read through WebFetch of github.com pages instead.
- **WebFetch only works on URLs that first appeared in a search result.** Direct fetches of other URLs timed out waiting for a permission prompt. Several `docs.darktable.org` pages returned server errors, and the mirror `darktable-org.github.io/dtdocs` was used instead.
- **community.adobe.com** refused fetching (robots disallowed), so Adobe staff forum statements could not be read.
- **Adobe "What's new" pages** for June 2023 (`.../whats-new/2023-4.html`) now redirect to the current release notes. The June 2023 release text about Refine Saturation could therefore **not** be read on adobe.com. The version and date come from Lightroom Queen and computer-darkroom.com (secondary).
- **DNG SDK source:** `dng_reference.cpp` was found on android.googlesource.com, but the rendered page was cut off before `RefBaselineRGBTone`. **The function body could not be read.** Its behaviour is described from RawPedia and DCamProf (secondary).
- **LightCraft** (added later): raw.githubusercontent.com files on `master` loaded. The github.com tree and commits pages were robots-blocked, so no commit hash or date could be recorded. A few guessed file paths returned errors (e.g. `docs/pipeline.md`, `plan/architecture.md`, `docs/ai-denoise.md`), and the curve-editor UI module was not located.
- curl/wget/Python were not used to get around any block.

---

## 1. Priority facts (decisions first)

### 1.1 darktable module order (CONFIRMED)

Source: `src/common/iop_order.c`, master branch, fetched from GitHub [S1].

- In **`v50_order`**, these entries appear in this sequence (verbatim, numbers are iop-order values):
  `{ {41.5f }, "colorbalancergb", 0}`, `{ {42.0f }, "rgbcurve", 0}`, `{ {43.0f }, "rgblevels", 0}`, `{ {44.0f }, "basecurve", 0}`, `{ {45.0f }, "filmic", 0}`, `{ {45.3f }, "sigmoid", 0},`, `{ {45.5f }, "agx", 0},`, `{ {46.0f }, "filmicrgb", 0}`, `{ {36.0f }, "lut3d", 0}`, `{ {47.0f }, "colisa", 0}`, `{ {48.0f }, "tonecurve", 0}`, … `{ {70.0f }, "colorout", 0}`.
- **`v30_order`, `v30_jpg_order` and `v50_jpg_order`** show the same relative placement: rgbcurve 42.0 and tonecurve 48.0 on either side of sigmoid 45.3, agx 45.5 and filmicrgb 46.0.
- The default-order function picks "LEGACY for display-referred workflows, `DT_DEFAULT_IOP_ORDER_JPG` for LDR images, and `DT_DEFAULT_IOP_ORDER_RAW` otherwise". The value of `DT_DEFAULT_IOP_ORDER_RAW` was not visible. **[unconfirmed]** whether it is v30 or v50 today. Both have the same curve placement, so this does not matter for the decision.
- **Conclusion:** **rgb curve = before sigmoid/filmic/AgX (scene-referred); tone curve = after (display-referred).** This confirms the brief's statement.

Supporting manual text:
- Sigmoid: "Modules placed before sigmoid in the pipeline operate in scene-referred space." "Modules after sigmoid work in display-referred space." [S4]
- The same page advises: "You should try to accomplish the majority of your processing using modules in the scene-referred section of the pixelpipe." [S4] *(This is the caveat in the Decisions box.)*
- Tone curve module: input is "linear or non-linear, Lab, display-referred" (summarised by the fetch tool; output also display-referred, processing in Lab) [S3].

### 1.2 darktable rgb curve and tone curve details (CONFIRMED unless marked)

**Parameter defaults (from source code):**

| Item | Value | Source |
|---|---|---|
| rgb curve `preserve_colors` default | `$DEFAULT: DT_RGB_NORM_LUMINANCE $DESCRIPTION: "preserve colors"` | [S2] rgbcurve.c |
| rgb curve interpolation default | `$DEFAULT: MONOTONE_HERMITE (CATMULL_ROM, MONOTONE_HERMITE, CUBIC_SPLINE)` | [S2] |
| rgb curve mode default | `$DEFAULT: DT_S_SCALE_AUTOMATIC_RGB $DESCRIPTION: "mode"` (RGB, linked channels) | [S2] |
| rgb curve compensate middle grey default | `$DEFAULT: 0 $DESCRIPTION: "compensate middle gray"`; code comment "scale the curve and histogram so middle gray is at .5" | [S2] |
| preserve colors visibility | Shown only in linked mode: `gtk_widget_set_visible(g->cmb_preserve_colors, p->curve_autoscale == DT_S_SCALE_AUTOMATIC_RGB);` | [S2] |
| tone curve `preserve_colors` default | `$DEFAULT: DT_RGB_NORM_AVERAGE` | [S6] tonecurve.c |
| tone curve colour space default | `DT_S_SCALE_AUTOMATIC_RGB` ("RGB, linked channels"); other options are "Lab, linked channels", "Lab, independent channels", "XYZ, linked channels" | [S6] |
| tone curve interpolation default | `MONOTONE_HERMITE` | [S6] |

**How "preserve colors" works:**
- Manual: "If a non-linear tone curve is applied to each of the RGB channels individually, then the amount of tone adjustment applied to each color channel may be different, and this can cause hue shifts." "The amount of tone adjustment is calculated based on this luminance value, and then this same adjustment is applied to all three of the RGB channels." [S5]
- In tonecurve.c, when `preserve_colors` is not `DT_RGB_NORM_NONE`, the module computes a norm with `dt_rgb_norm()`, runs it through the curve, and scales R, G and B by `ratio = curve_lum / lum`. *(The fetch tool's summary of the code, not a verbatim quote.)* [S6]

**The norms (verbatim code, `src/common/rgb_norms.h` [S7a]):**
- enum: `none`, `luminance`, `max RGB`, `average RGB`, `sum RGB`, `norm RGB`, `basic power`;
- max: `return max3f(in);`
- average: `return (in[0] + in[1] + in[2]) / 3.0f;`
- sum: `return in[0] + in[1] + in[2];`
- norm: `return sqrtf(in[0] * in[0] + in[1] * in[1] + in[2] * in[2]);`
- power: `return (in[0] * R + in[1] * G + in[2] * B) / (R + G + B);` (R, G, B are the squared channels);
- luminance: the working-profile luminance via `dt_ioppr_get_rgb_matrix_luminance(...)`.

**Visual effect of each norm.** The rgb curve page does not describe the effects. It points to filmic's "preserve chrominance" section, which documents the same norms [S5], [S8a]:
- max RGB: "It tends to darken blues, especially skies, and may produce halos or fringes where channels are clipped."
- luminance Y: "It darkens reds and increases local contrast in them."
- RGB power norm: described as "usually a good compromise between max RGB and luminance Y" (fetch-tool paraphrase of the page).
- euclidean norm: "It desaturates the highlights more than the power norm."
- no: "applies the curve to each channel independently, which saturates shadows and desaturates highlights" (paraphrase).
- **[unconfirmed]** separate descriptions of *average*, *sum* and *basic power* as used in rgb curve. Analysis: a ratio method applied to the sum norm gives the same ratio as average, only with the curve input scaled ×3. So "sum" mainly changes where on the curve a pixel lands.

**Interpolation, nodes and graph scale (manual [S5]):**
- "cubic spline is, arguably, the most visually pleasing." "This method works best when there are only 4 to 5 nodes, evenly spaced."
- "centripetal spline is designed specifically to avoid cusps and oscillations but, as a drawback, it will follow the nodes more loosely."
- "monotonic spline is designed specifically to give a monotonic interpolation, meaning that there will be none of the oscillations the cubic spline may produce." "It is a good trade-off between the two aforementioned methods."
- "Up to 20 nodes can be defined per curve." "Ctrl+click to generate a new node at the x-location of the mouse pointer." "To remove a node, click on it and drag it out of the widget area." [S5]
- Log scale for the graph: "Note that the scaling option only affects the curve display, not the actual parameters stored by the module." [S5]

**rgb curve picker and middle grey (manual [S3a]):**
- "A second picker to the right can be used to automatically create new nodes based on the sampled area."
- "Ctrl+click+drag to alter the created nodes to have a positive curve for the selected area" and "Shift+click+drag to create a negative curve."
- Compensate middle gray: "This option does not alter the processing but may assist when editing the curve."

**Tone curve in RGB/XYZ modes:** middle grey is remapped from 50% to 18% internally, and the picker shows Lab input/output values (fetch-tool paraphrase of [S3]).

**Presets (from source):**
- rgb curve [S2]: "contrast | compression", "linear (gamma 1.0)", "contrast | medium (linear)", "contrast | high (linear)", "contrast | medium (gamma 2.2)", "contrast | high (gamma 2.2)", "non-contrast curve | gamma 2.0", "non-contrast curve | gamma 0.5", "non-contrast curve | logarithm (base 2)", "non-contrast curve | exponential (base 2)".
- tone curve [S6]: the same ten in older naming ("contrast compression", "gamma 1.0 (linear)", "contrast - med (linear)", …), plus seven camera curves (Nikon D750, D5100, D7000, D7200, D7500, D90, Olympus OM-D E-M10 II).

**Rejected alternative:** issue #8061 proposed a "desaturate → curve → resaturate" option. It was closed by aurelienpierre: "It's not better at hue preserving since there is no chromaticity check of any sort." [S8b]

### 1.3 darktable sigmoid colour handling (CONFIRMED) — relevant to decision 3

From the sigmoid manual page [S4]:
- "Per channel": "applies the sigmoid curve to each rgb channel separately, affecting luminance, chroma, and hue."
- "Rgb ratio": "It maps the rgb triplet uniformly using the sigmoid curve, which preserves the spectral color of the pixel." "Bright colorful pixels are desaturated along spectral lines as they would otherwise end up outside the display gamut."
- Preserve hue: "100% preserves the spectral hue of the image (identical to using the "rgb ratio" color processing mode)." "0% uses the per-channel mode with heavy hue skewing." "An acceptable approximation of preserved perceptual hue is usually somewhere between the two extremes."
- "Never use sigmoid together with another display transform module (i.e. filmic rgb or base curve)."

### 1.4 Lightroom / Camera Raw curve behaviour (CONFIRMED unless marked)

**Parametric curve (Adobe ACR help [S9]):**
- "The Parametric Curve helps adjust values in specific tonal ranges in the image."
- The affected areas "depend on where you set the split controls at the bottom of the graph."
- "The middle region properties (Darks and Lights) mostly affect the middle region of the curve." "The Highlight and Shadows properties mostly affect the ends of the tonal range."

**Point curve (Adobe ACR help [S9]):**
- "As you drag the point, the Input and Output values are displayed beneath the tone curve."
- "You can also adjust saturation using the Refine Saturation slider."

**Targeted Adjustment Tool (Adobe ACR help [S9]):**
- "Dragging the tool up or right increases values; dragging down or left decreases values."
- "The Parametric Curve Targeted Adjustment tool adjusts the Highlights, Lights, Darks, or Shadows curve region based on the values in the image..."
- "The keyboard shortcut T toggles the last Targeted Adjustment tool you used."

**Lightroom Classic panel (Julieanne Kost, Adobe evangelist, 2024 [S10]):**
- Point limit: "A maximum of 16 points can be added to the curve to make fine adjustments."
- Numeric entry: "For finer control, use the Input/Output text boxes to adjust the value of any selected control point."
- Deleting points: "To delete individual points on the Point Curve, click -drag the point off the curve."
- R/G/B channels: "click the red, green and blue circles to access and adjust the individual red, green, and blue channels." "When an individual channel is selected, color gradients appear in the curve making it easier to anticipate adjustments."
- Region splits: "To change the tonal range affected by any of these sliders, reposition the triangles (directly under the curve)."
- Reset: "To reset a single slider, double click its name."
- TAT and arrow keys: "Then (without clicking), use the up/down arrow keys to nudge the curve." "Add the Shift key to nudge the point in greater increments." "Escape puts the Targeted Adjustment Tool back (while keeping changes that have been made)."
- Refine Saturation: "The default setting of 100 will create the same results as in previous versions of Lightroom." "Setting the slider to 0 restricts the effects of the Point Curve to only the luminance values."

**Arrow-key nudging of selected curve points (not via TAT)** has been an open Adobe feature request since 2013: "It could be great to be able to create/select a point on the curve and move it with the arrow keys by tiny steps", status "Open for Voting" [S10a]. This is an opening for LightBench.

**Refine Saturation: when added and what it does.**
- Lightroom Queen [S11]: "Added in Lightroom Classic 12.4, released June 13, 2023" (fetch-tool summary of the page). Verbatim: "Now, when the RGB Point Curve is active, there's a new slider directly underneath, called Refine Saturation." "The default is set to 100, which is identical to the old behavior." "At less than 100, the saturation boost is reduced, and 0 applies the curve without changing saturation."
- computer-darkroom [S12a]: "The main feature enhancements to be found in Camera Raw 15.4, Lightroom Classic 12.4 and Lightroom Desktop 6.4 are:" (Refine Saturation is in that list). "The purpose being to reduce the increase in saturation that occurs when a curve is applied".
- Greg Benz [S14]: "it is only available for the point curve, not the parametric one with sliders", and it is not offered for "the R,G,B curves (which are intended for color adjustment)". "Dragging it down is therefore a lot like the luminosity blend mode in Photoshop". He warns it "may not hold the hue visually constant".
- **[unconfirmed]** Adobe's own June 2023 release note text. The adobe.com page now redirects (see Method notes).
- **[unconfirmed]** the XMP field name for Refine Saturation. It is not in exiv2's crs list or Adobe's crs namespace page. LightCraft's `docs/xmp-interop.md` [L12] maps a field `CurveRefineSaturation`, but that is a third party's documentation, not Adobe's.

**XMP fields (exiv2 crs tag list [S13]; Adobe's crs namespace page [S13a] lists only the older `ToneCurve`/`ToneCurveName`):**

| Field | Type / description (verbatim from exiv2) |
|---|---|
| `ToneCurvePV2012` | "Seq of points (Integer \| Integer)", "Internal" |
| `ToneCurvePV2012Red` / `Green` / `Blue` | "Seq of points (Integer \| Integer)", "Internal" |
| `ToneCurveName2012` | "Values: Linear, Medium Contrast, Strong Contrast, Custom. Not in XMP Specification. Found in sample files." |
| `ParametricShadows`, `ParametricDarks`, `ParametricLights`, `ParametricHighlights` | Integer, "Not in XMP Specification. Found in sample files." |
| `ParametricShadowSplit`, `ParametricMidtoneSplit`, `ParametricHighlightSplit` | Integer, "Not in XMP Specification. Found in sample files." |
| `Saturation` (Basic panel) | "\"Saturation\" setting. Range -100 to +100." |

- **[unconfirmed]** the point coordinate range (commonly 0–255).
- **[unconfirmed]** the split defaults (commonly 25/50/75). A Lightroom Queen thread shows 25, 50 and 76 in one user's file, not as defaults [S13b].
- **[unconfirmed]** the order in which the parametric and point curves combine.
- **[unconfirmed]** the claim that the Lightroom tone curve runs after the Basic panel. It is secondhand only: "The LR team has explained that the Tone Curve changes are applied after the Basic sliders." (forum user "Eyeball", 2012, fredmiranda.com [S13c]).

**Lightroom HDR curve (Adobe help [S13d]):** "The Curve controls work on HDR images the same way they work on SDR images". "The lower left quadrant of the curve represents the SDR portion of the image". "Curve values are remapped into the 0-100% range in HDR". The histogram "is split into two parts- an SDR section on the left and an HDR section on the right."

### 1.5 Adobe DNG SDK hue-preserving RGB tone curve

- **The SDK source could not be read** (see Method notes). The file header seen was "// Copyright 2006-2023 Adobe Systems Incorporated" [S15a].
- RawPedia: "This curve type was designed by Adobe as a part of DNG and is thus the one used by Adobe Camera Raw and Lightroom." The film-like curve gives "a result highly similar to the standard type" with "the RGB-HSV hue is kept constant" (partial sentences) [S15].
- DCamProf documentation (Anders Torger) [S16]: "It's an RGB curve where the tone curve is applied on the largest and smallest value" and "the middle value is adapted to keep a constant hue as defined by RGB-HSL/HSV." "In terms of look and saturation increase it's very similar to a pure RGB curve" "but some color shift problems are avoided."
- darktable issue #8466 [S17]: a contributor notes the same algorithm is in Blender's "filmlike" curve mode. A darktable developer added it as a "preserve hue" option in a sigmoid branch and said "we can't reuse the code you link as those are assuming a finite input range for the HSV calculation."
- Blender commit history shows `CURVE_TONE_FILMLIKE = 2` in its curve-mapping code [S17a].
- **[unconfirmed]** the exact formula. Typically described as: sort R,G,B; apply the curve to max and min; set mid so that (mid−min)/(max−min) is unchanged.
- **[unconfirmed]** the DNG SDK licence terms for reuse in GPL-3.0 code. Implement from the description, or reuse a GPL-compatible implementation (Blender or RawTherapee, licences **[unconfirmed]** but widely reported as GPL).
- **Analysis:** the "finite input range" remark matters. The algorithm assumes bounded input, which is another reason it fits a curve placed **after** the sigmoid.

### 1.6 RawTherapee / ART curve modes (CONFIRMED from RawPedia and ART docs)

**RawPedia Exposure page [S18]:**
- Two curves: "There are two tone curves available, which can be designed with various curve types, and applied in several different modes all explained below."
- Curve histogram: "The histogram displayed as the curve's background shows you the levels of the data as it flows into the curve", "it differs from the main histogram which shows you the levels of the final image".

**Curve types [S18]:**
- Standard: "This is a classic cubic spline curve, seen in many other programs as well."
- Flexible: "The "Flexible" centripetal Catmull–Rom spline curve allows you to make adjustments to any part of the curve" (partial).
- Parametric: "This curve presents four sliders and three control points." "The sliders are used to control highlights, lights, darks and shadows respectively" (partial).
- Control Cage: the curve does not pass through every control point (paraphrase).

**Curve modes [S18]:**
- Standard: per-channel "correspondence" method (paraphrase).
- Weighted Standard: "You can use this method to limit the color shift of the standard curve, even if it won't suppress it entirely."
- Film-Like: see 1.5.
- Saturation and Value Blending: "This mode is typically better suited for high-key shots, but can be used for creative effect in other photos as well."
- Luminance: "Each component of the pixel is boosted by the same factor so color and saturation is kept stable," and "contrast-increasing curves can still lead to a slightly desaturated look" (partials).
- Perceptual: "This mode will keep the original color appearance concerning hue and saturation" (partial). "As contrast and saturation is tightly coupled in human vision this scaling is necessary to make saturation appear constant." "Due to the many components in the algorithm it's considerably slower than the other curve modes so refresh rate may suffer."

**ART:**
- Its developer added a **"Neutral"** mode: "I added Neutral because I wasn't happy with any of the other options, and I kept the others only for backwards compatibility." "If I had to start from scratch today, I would only add Neutral." (Alberto Griggio, pixls.us [S19]).
- **[unconfirmed]** what Neutral computes. The ART Book section 4.1.3 was beyond the fetchable page.
- ART pipeline (ART Book §3.6 [S12]): "29. Log Tone Mapping - Linear RGB", "30. Saturation/Vibrance - Linear RGB", "31. Tone Curves - Linear RGB bounded", "33. RGB Curves - Linear RGB bounded". Also: "The order of execution of the tools does not depend on the order in which the individual tools were used during processing."

### 1.7 LightCraft (storytold/lightcraft): tone curve (CONFIRMED from repo files unless marked)

**What it is**
- "a clean-room, open-source, pure-Rust photo library + non-destructive raw developer targeting Adobe Lightroom parity" (AGENTS.md [L1]).
- Licence: "LightCraft is dual-licensed under MIT or Apache-2.0, at your option." (README [L2]).
  - LICENSE-MIT: "Copyright (c) 2026 ArtCraft Team and the LightCraft contributors" [L3].
  - NOTICE: "crates/segment is licensed under the Apache License 2.0 only (LICENSE-APACHE), not under the MIT option." [L4].
  - Workspace `version = "0.7.1"`, `license = "MIT OR Apache-2.0"` (Cargo.toml [L5]).
  - **Commit hash and date: not visible.** The GitHub commits page was robots-blocked; all files were read from `master` on 2026-10-13.
- Clean-room rules (AGENTS.md [L1]): "Never copy GPL/LGPL/AGPL code"; "Never copy Adobe icons, presets, profiles (DCP), lens profiles (LCP), camera matrices".

**Working space and pipeline position**
- README [L2]: "Linear Rec.2020 float internally". Colour adjustments are computed in OkLCh.
- `crates/pipeline/src/lib.rs` [L6] gives five stages:
  1. Geometry;
  2. Scene-linear (WB, exposure, dehaze, local tone, texture, clarity, masks);
  3. Tone map ("contrast, whites, and blacks as a filmic curve on luminance, plus highlight desaturation", fetch-tool paraphrase of the doc comment);
  4. Colour (OkLCh);
  5. Display ("gamut mapping to the output space, encoding, tone curves (parametric and point), vignette, and grain").
- `finish_with` in `crates/pipeline/src/finish.rs` [L7] runs: … tone map → colour ops → vignette (display linear) → gamut map → **encode to sRGB → tone curves → refine saturation** → grain → 3D LUT profile.
- **So LightCraft's curve sits after its Contrast tone map, on sRGB-encoded 0..1 values.** This is the same choice as LightBench's decision 1.
- In HDR, values above 1 continue with slope 1 from the curve's end point: `l[k].eval(1.0) + (e[k] - 1.0)` [L7].
- Its Highlights/Shadows/Whites/Blacks use "edge-aware local tone mapping (a guided filter on log-luminance)" (README [L2]), a design close to LightBench's tone equalizer.

**Modes and maths** (`finish.rs` [L7], `crates/develop/src/settings.rs` [L8], `crates/color/src/spline.rs` [L9]):
- Parametric: doc comment "/// Parametric region curve (encoded domain) composed with the master point curve."
  - Four regions split at `split_shadows`, `split_mid` and `split_highlights` (defaults 25/50/75, which settings.rs says match Lightroom's; that claim is secondary).
  - Each region is a raised-cosine window: `let win = 0.5 + 0.5 * (t * std::f32::consts::PI).cos();`.
  - The summed offset is applied as `(x + d * 4.0 * x * (1.0 - x)).clamp(0.0, 1.0)`, so black and white stay fixed.
  - A running max forces the 1024-entry LUT to be monotone.
- Point curves: master, red, green and blue, points in 0..1. `MonotoneCurve`: "Curves for tone mapping: monotone cubic Hermite splines (Fritsch–Carlson) and lookup tables." Master is composed on top of the parametric base; each R/G/B curve is composed on top of that.
- README [L2]: the curve is "monotone by construction, so you never get an accidental tone inversion."
- No point-count limit was found in the files read. `MAX_POINT_COLORS` = 8 is for Point Color, not curves.

**Colour handling**
- Applied **per channel on encoded values**: `[l[0].eval(e[0]), l[1].eval(e[1]), l[2].eval(e[2])]`. It is not luminance-based and not hue-preserving [L7].
- Refine Saturation (`refine_saturation`, 0–100, default 100) is LightCraft's own formula:
  - saturation = chroma/luma, with chroma = max − min and Rec.709 luma weights;
  - scale `k = (s0 / s1).powf(1.0 - refine).clamp(0.0, 4.0)`, applied as `y1 + (v - y1) * k`;
  - 100 keeps the curve's saturation; 0 restores the pre-curve saturation.
- This tames saturation but **does not undo per-channel hue shifts**. **Analysis:** LightBench's proposed film-like default would differ from LightCraft here.

**UI** (from test names and asserts in `crates/ui-egui/src/tests_curve.rs` [L10]):
- dragging moves a point in both axes with "one undo step per drag";
- Alt-drag gives fine control ("x moves a tenth of the pointer");
- "dragging a point past its neighbour is clamped";
- double-clicking a channel resets only that channel;
- a point-curve preset dropdown can apply and save presets;
- the TAT "announces itself" because "one left on by mistake looked like a frozen canvas", and "Esc turns the tool off".
- parity.md lists TAT for curves as ✅ (`cmd:develop.targeted` with `target: curve`) [L11].
- Not found in the files read: arrow-key point nudging, numeric Input/Output entry, a histogram behind the curve, clipping preview, screen-reader support. **[unconfirmed]** either way: the curve-drawing UI module was not located.

**XMP / Lightroom compatibility** (`docs/xmp-interop.md` [L12]):
- Read: `ToneCurvePV2012` and `ToneCurvePV2012Red/Green/Blue` map to `curve.master/red/green/blue`, with points "in 0..255, scaled to 0..1". The R/G/B curves load only when the master and all three channel curves are present.
- Read: `Parametric*` sliders and splits map directly.
- Read: "`CurveRefineSaturation` | `curve.refine_saturation` | 0..100 (100 = curve saturation unchanged)". This is the only source found naming that crs field. It is LightCraft's documentation, not Adobe's, so it stays **[unconfirmed]**.
- Write: "We read these fields; we never write them." LightCraft's own settings go in an opaque `lc:settings` JSON packet. Values from `lc:settings` are "(exact)"; values from `crs:` are "(approximate)", because "values carry over but the look is approximate".

**What LightBench should copy / avoid (Analysis)**

| Copy | Avoid / do differently |
|---|---|
| Curve after the tone map, on encoded values. This independently matches decision 1. | Per-channel curve on the master channel (hue shifts). Use a film-like master instead and keep per-channel for R/G/B only. |
| Monotone by construction: Fritsch–Carlson, neighbour clamping, monotone LUT. | Calling the result "parity" without render comparison. LightCraft's own ROADMAP says tone is "tuned by eye" (see 1.8). |
| Raised-cosine, endpoint-pinned region windows: a simple, documented Regions implementation. | Reading `crs:` but not stating clearly in the UI that the look is approximate. LightCraft's doc says so; its UI behaviour was not checked. |
| Alt-drag ×0.1 fine adjust, one undo step per drag, TAT that announces itself and leaves on Esc. | — |
| Refine Saturation 0–100 with default 100 (same semantics as Lightroom), and reading `CurveRefineSaturation` if Adobe uses that name. | — |
| Slope-1 continuation above 1.0 as a cheap HDR fallback. | — |
| Reuse: MIT/Apache-2.0 code is generally treated as usable inside GPL-3.0 projects with notices kept (**[unconfirmed]**, no legal opinion). | — |

### 1.8 LightCraft "parity" claim: claimed vs confirmed

| Claim (marketing / docs) | Source | What the code confirms (files read) |
|---|---|---|
| "By feature count we're at ~79%" of Lightroom (core features 98%); "As a day-to-day Lightroom replacement we're nearer 60–70%." | raw README [L2] | The github.com rendering of the README, fetched the same day, said "~81%" and "nearer 61%". **The figures differ between the two views** (possibly different revisions). The calculation method is not stated. |
| Self-caveat: "A ✅ row is not proof of parity" | AGENTS.md [L1] | — (an honest caveat from the project itself) |
| Tone curve: parametric + point + R/G/B + Refine Saturation + TAT all ✅ | parity.md [L11] | **Confirmed in code** (finish.rs, settings.rs, spline.rs, tests_curve.rs). Refine Saturation is LightCraft's own formula, not Adobe's. |
| Sharpening ✅ with `sharpenAmount`, `sharpenRadius`, `sharpenDetail`, `sharpenMasking` | parity.md [L11] | Amount and Masking are used in finish.rs (`s.detail.sharpen_amount / 150.0`, `sharpen_masking`). **Radius and Detail are not referenced** in finish.rs or local.rs. The texture band radius is fixed at `(0.0018 * ppl).max(0.6)` px. Whether Radius and Detail are used anywhere else is **[unconfirmed]**. |
| Luminance + colour NR ✅ (`nrLuminance`, `nrDetail`, `nrContrast`, `nrColor`, …) | parity.md [L11] | Confirmed: a guided filter on log-luminance plus a chroma blur in `local::denoise`. **`nr_contrast` does not appear** in that code. |
| AI Denoise | README: "🚧 (Bayer, user-installed weights)"; parity.md: ⬜ "settings field reserved, not rendered"; ROADMAP: "no AI denoise" | **The docs are inconsistent with each other.** Code: a `lightcraft-denoise` crate with pure-Rust CPU inference, and a RawNIND manifest behind the `rawnind-model` feature. No AI-denoise call was found in `crates/pipeline/src/lib.rs`. |
| Select Subject / Sky | parity.md 🟡 | "saliency heuristic, no segmentation model" / "heuristic" (their own notes). |
| Object masks | parity.md 🟡; ai-masks.md | SAM 3 via candle (Metal on macOS, CPU elsewhere). Weights not hosted: "download not yet hosted" (ROADMAP). |
| Content-aware remove | parity.md 🟡 | "heal with automatic source; no patch synthesis". ROADMAP: "PatchMatch remove ⬜". |
| Lens blur | parity.md ⬜ | `LensBlur` settings struct only ("settings field reserved, not rendered"). |
| Render fidelity | ROADMAP [L13] | Self-reported: "No measured fidelity against Lightroom (tone, highlights, texture/clarity, NR, sharpening are tuned by eye)." Also "No measured camera calibration database." |
| XMP read/write ✅ | parity.md / README | It writes its own `lc:settings`. It reads `crs:` approximately and never writes `crs:` [L12]. |
| GPU | README | "wgpu compute kernels on Metal, Vulkan and DX12", checked against the CPU "to within 1/255"; ~4 ms slider update "On a 24 MP raw (Apple M4 Pro)" (self-reported, not reproduced). The web build uses WebGL2 via eframe/glow, not WebGPU (docs/web.md [L14]). |

**Verdict (analysis):** the tone-curve parity claim holds up in code at the feature level. The headline percentages are row counts of the project's own checklist. By the project's own admission they say nothing about render fidelity, and some ✅ rows (Sharpening Radius/Detail, NR Contrast) map to sliders that the files read do not use.

---

## 2. What each surveyed tool does well

### 2.1 Photo editors

| Tool | What it does well (sourced) | Source |
|---|---|---|
| **Lightroom Classic / ACR** | Parametric regions with draggable splits. Point curve (16 points) with Input/Output boxes. R/G/B with colour-gradient hints. TAT for both curve types, with arrow keys, Shift and Esc. Refine Saturation 0–100. HDR curve with SDR quadrant and split histogram. | [S9], [S10], [S11], [S13d] |
| **Lightroom mobile** | "Select anywhere on the curve line to add an adjustment point." "Double-tap any point on the curve to remove it." Parametric by touch: "Hold and drag the curve up or down to adjust Highlights, Lights, Darks, and Shadows in your photo." | [S20a] |
| **Capture One** | "There are five curves in total in the Capture One Curve tool." The Luma curve "has the additional benefit of not increasing saturation". With RGB, "increasing contrast typically results in an increase in saturation" and "with more extreme adjustments, the Luma curve has a more realistic response." | [S20], [S20b] |
| **DxO PhotoLab (8+)** | RGB, R, G, B and an L channel: "the L channel, for luma or luminance, lets you adjust tones while preserving color." Gamma slider 0.05–6.00 for the midtone slope. Unlimited points. Tone picker. Presets. Selective Tone sliders (Highlights/Midtones/Shadows/Blacks). ClearView Plus for haze. A user notes "Changes made to the Tone Curve are not reflected in this background Histogram." (forum, 2024). | [S21], [S21a] |
| **Affinity Photo** | Curves in GREY/RGB/CMYK/LAB regardless of document mode. "Picker—allows you to drag on the image to modify the adjustment." Float Input minimum/maximum, useful for extended-range data. | [S22] |
| **Photoshop Curves** | On-image tool. Black/grey/white eyedroppers. Alt-drag clipping display: "show values in the image that are clipped to pure black and white on a per-channel basis". Auto Options (Enhance Monochromatic Contrast, Per Channel Contrast, Find Dark & Light Colors, Enhance Brightness and Contrast, Snap Neutral Midtones). Display options "Channel Overlays, the Histogram, Baseline, Intersection Line". Arrow keys move the selected point. "Shift + "+" (plus) and Shift + "-" (minus) selects the next/previous point on the curve." | [S23] |
| **Apple Photos (Mac)** | Black point / Midtones / White point eyedroppers. "Add Points": "Each click adds a point to the histogram's diagonal line." Auto per channel. | [S24] |
| **Aperture (legacy Apple)** | RGB vs Luminance curves. **Extended** view "to display pure black to two times pure white". "Auto Curves Combined" vs "Separate". | [S24a] |
| **Photomator / Pixelmator** | Luminance, RGB, Red, Green, Blue channels. On-image curves. | [S24b] |
| **ON1 Photo RAW 2023.5** | "The new dropper and improved grid make selecting and adjusting specific points on the curve easier". "removing or nudging points with the arrow keys adds to the precision and control". | [S24c] |
| **Luminar Neo** | **[unconfirmed]**: not researched (no primary doc found). | — |
| **Darkroom (iOS)** | Touch design: swipe within a tone range rather than drag tiny points. The team "spent a good long time designing various interactions" after finding small-screen curves "hard". | [S25] |
| **Halide Process Zero** | Not a curve tool. It skips Apple's processing and offers "a single dial element for adjusting your RAW photos" (Image Lab). Relevant only as a "one control" precedent. | [S25a] |
| **VSCO** | **[unconfirmed]**: no primary documentation found. | — |

### 2.2 Open source

| Tool | Strengths | Source |
|---|---|---|
| **LightCraft** (MIT OR Apache-2.0, Rust) | Lightroom-style parametric regions (raised-cosine windows, splits default 25/50/75) plus monotone Fritsch–Carlson point curves for master and R/G/B. Curve after the tone map on sRGB-encoded values. Own Refine Saturation formula. Alt-drag fine control. TAT that announces itself. Reads Lightroom `crs:` curves (approximate). Weakness: per-channel master curve with no hue preservation. | 1.7, [L7]–[L12] |
| **darktable rgb curve** | Scene-referred placement. Seven preserve-colour norms. Monotone spline default. Picker that auto-creates nodes from a sampled area (Ctrl/Shift-drag for positive/negative). Middle-grey compensation for the display. Log graph scale that is display-only. | [S2], [S3a], [S5] |
| **darktable tone curve** | Display-referred. Lab/XYZ/RGB linked modes. Same presets. Camera-matched curves. | [S3], [S6] |
| **RawTherapee** | Two chained curves. Six colour modes, including Film-like (Adobe) and Perceptual. Five curve types, including control cage. Histogram is curve input, not final output. | [S18] |
| **ART** | Simplified "Neutral" mode. Fixed, documented pipeline order with tone curves after log tone mapping. | [S12], [S19] |
| **GIMP** | Linear vs perceptual mode buttons. Smooth or Corner point types. Numeric spin buttons (2.10.12+). Left/Right arrows switch points, Up/Down move them, Shift for 15-unit steps. Shift-click image = point in current channel; Ctrl-click = point in all channels. Linear/log histogram. | [S26] |
| **Krita** | Curves for alpha and lightness. "Since 4.1 this filter can also handle Hue and Saturation curves". Cross-channel curves, where the horizontal axis "represents the driver channel". | [S26a] |

### 2.3 Video / grading

| Tool | Strengths | Source |
|---|---|---|
| **DaVinci Resolve** | Ganged YRGB curves (ungang for per-channel). Luma-only curve: "increasing luma contrast results in a perceptual decrease of image saturation". Curve intensity/mix sliders: "The Intensity sliders provide an easy way to “split the difference”". Soft clip: "Soft clipping lets you apply a "knee" to any clipping that occurs at the upper or lower extremes of the image." Hue vs Hue/Sat/Lum, Lum vs Sat and Sat vs Sat. Clicking in the viewer "automatically places three control points on the currently open curve". | [S27], [S27a] |
| **Resolve "Luma Mix"** | **[unconfirmed]**: no primary manual text found. The Blackmagic forum thread would not load. | — |
| **Baselight** | Base Grade works in stops around 18% grey: "All exposure values and pivot points are specified in aperture stops." It shows "a visualization of the current grade as a tone curve" with a luma waveform superimposed. | [S28] |
| **Nuke ColorLookup** | Master/R/G/B/alpha curves. Source/target sampling: "You can use these controls to match shadow, midtone, and highlights on two plates, for example." Precomputed LUT over a user range. | [S29] |

### 2.4 Research

| Topic | Finding | Source |
|---|---|---|
| **MIT-Adobe FiveK (Bychkovsky et al., CVPR 2011)** | "We collected 5,000 photos, manually annotated them, and hired 5 trained photographers to retouch each picture." Retouched in "Adobe Lightroom". "We express adjustments as a remapping curve from input luminance into output luminance" "using the CIE-Lab color space because it is reasonably perceptually uniform." "The curve is represented by a spline with 51 uniformly sampled control points." **Licence of the images: [unconfirmed]**. No licence was found on the project page or Papers with Code. | [S30], [S30a] |
| **Simple curves suffice (Bennett & Finlayson)** | CIC 2023: FiveK expert tone adjustments are "well-approximated by simple tone curve adjustments" (≤1 inflexion), and the authors "find no preference difference". AIC 2025 psychophysics: 8 observers, 24 images, no significant preference between expert and simple curves; log-domain curves "marginally favoured". | [S32], [S33] |
| **Learned curves** | CURL: curves "trained jointly in three different colour spaces (HSV, CIELab, RGB)". Zero-DCE: "image-specific curve estimation with a deep network", "does not require any paired or unpaired data during training." | [S34], [S35] |
| **Reference matching** | Reinhard et al. 2001: "We use a simple statistical analysis to impose one image's color characteristics on another." Pitié et al. 2007: N-D pdf transfer plus a grain-reduction step. Bae/Paris/Durand 2006: "we perform histogram matching and transfer the histogram of the model base BM onto the new base BI." | [S36], [S37], [S38] |
| **Auto curves** | Photoshop's Auto Options (2.1) and Apple's Auto per channel are the practical precedents. | [S23], [S24] |

### 2.5 Patents (facts only, no legal opinion)

| Item | Facts | Source |
|---|---|---|
| **Adobe, US 2025/0117977 A1** "High Dynamic Range Visualizations Indicating Ranges, Point Curves, and Previews" | Application 18/481,437, filed 2023-10-05, published 2025-04-10. Assignee Adobe Inc. Inventors Eric Chan, Thomas Frederick Knoll, Gregory Paul Zulkie. Justia's patent history lists grant number **12602841**; **grant date, status and expiry [unconfirmed]** (not found on Google Patents in this session). Claim 1 gist (published application): detect pixel luminance values, assign them to ranges, assign a visual indicator such as a colour to selected ranges, and display the image with the indicator on matching pixels. Claim 1 opens "A method comprising: detecting, by a processing device, luminance values corresponding to a plurality of pixels". | [S39] |
| **Adobe, US 2026/0289832 A1** (divisional of 18/481,437) | Filed 2026-04-09, published 2026-09-24. Status per patentlyze: "Waiting for an examiner (May 15, 2026)." Claim 1 excerpt (secondary): "generating, by the processing device, a point curve mapping between the detected luminance values from the digital image and output luminance values over a standard dynamic range and a high dynamic range". Formal title, status and expiry [unconfirmed] (only a secondary site was read). | [S40] |
| **Bae / Paris / Durand two-scale tone management (SIGGRAPH 2006)** | **No patent found** in Google Patents searches. The paper does not mention a patent [S38]. **[unconfirmed]** that none exists. | [S38] |
| Related: **MIT US 7,146,059 B1** (Durand & Dorsey, fast bilateral filtering for HDR display) | Assignee MIT. Filed 2003-03-05, granted 2006-12-05. Google status "Expired - Lifetime", "Adjusted expiration" 2025-02-08. Claim 1 opens "A method of performing piece-wise linear bilateral filtering comprising:". | [S41] |

---

## 3. Candidate improvements

"Changes existing edits?" means: would turning it on by default change how an already-saved edit renders? Any "Yes" belongs behind a new process version.

| # | What | Why it helps | Source / "new idea" | Effort | Risks | Changes existing edits? |
|---|---|---|---|---|---|---|
| 1 | **Curve axis matched to the histogram.** Draw the histogram of the curve's *input* (post-sigmoid, pre-curve) in the same encoding as the curve's x-axis, using the same transfer as the main histogram. Optional toggle: overlay the output histogram. | Users place points over the tones they see. RawPedia notes the curve histogram "shows you the levels of the data as it flows into the curve", which differs from the main histogram. A DxO user complains that curve changes are "not reflected in this background Histogram". | RawPedia [S18]; DxO forum [S21a]; darktable middle-grey compensation [S2]; overlay toggle is a new idea | S–M | If the main histogram and curve use different encodings, alignment breaks. Pick one encoding and lock it. | No (display only) |
| 2 | **Colour-preserving modes, with a hue-preserving default.** Master curve default = **Adobe-style "film-like"** (curve on max and min channel, middle channel set to keep RGB-HSV hue), plus a **Refine-Saturation-style** slider (100 = film-like, 0 = luminance-ratio, i.e. darktable-style `ratio = curve(L)/L`). Optional extra mode: darktable norms (power, max RGB) as "advanced". R/G/B curves always per-channel. | Matches decision 3. It keeps Lightroom's "contrast adds colour" feel without per-channel hue twists. RawPedia, DCamProf and darktable all document hue shifts from per-channel curves. The slider gives a one-control way back to "tone only". | RawPedia [S15], [S18]; DCamProf [S16]; Lightroom [S10], [S11]; darktable [S5], [S6], [S7a]; LightCraft's per-channel master + chroma-ratio Refine Saturation is the alternative not chosen [L7] | M | Film-like needs bounded input (darktable dev remark [S17]), which is fine after the sigmoid. Ratio mode can push channels above 1.0 for saturated colours, so it needs a gamut/clip policy. The exact Adobe blend at intermediate slider values is [unconfirmed], so do not claim Lightroom parity. | Yes if the existing default is plain per-channel RGB. Put it behind a process version. |
| 3 | **Luma vs RGB / luma mix.** Instead of a separate Luma channel tab, expose the slider in #2 (0 = luma-like, 100 = film-like). Consider a later "Perceptual" mode that scales chroma by local contrast. | Capture One, DxO, Apple Aperture, Photomator and Resolve all offer luma-only curves. Users ask for "contrast without saturation" (Capture One's own article). One slider avoids two parallel curves. | [S20b], [S21], [S24a], [S24b], [S27a]; RawPedia Perceptual [S18] | S (slider) / L (Perceptual) | Luma-only curves look *desaturated* with contrast: "increasing luma contrast results in a perceptual decrease of image saturation" [S27a]; RawPedia says the same for Luminance mode. Perceptual mode is "considerably slower" in RawTherapee (on GPU, probably fine; analysis). | No if added as a new slider whose default reproduces current output |
| 4 | **Hue-vs / Sat-vs curves: put them in the HSL (Color Mixer) tool, not the tone curve.** Offer a "curve view" inside HSL showing Hue vs Hue/Sat/Lum, with click-in-image sampling that drops three points. Add Lum vs Sat / Sat vs Sat later, as an advanced HSL view. | Keeps the tone curve purely tonal, which is the Lightroom mental model (Lightroom keeps hue/sat/lum by colour in a separate mixer). Resolve and Krita show the curve view is powerful, and Resolve's 3-point sampling is fast. | Resolve [S27]; Krita [S26a]; placement is analysis | M | Two UIs (sliders and curves) editing the same parameters need a clear single source of truth. | No |
| 5 | **Clipping preview while dragging.** Alt/Option-drag on the black/white endpoints (or any point that drives output to 0 or 1) shows per-channel clipped pixels on the image. Also show clip counts on the histogram ends. | Photoshop's established gesture. After the sigmoid, the curve is the main place where *new* hard clipping can be created. | Photoshop [S23]; Lightroom HDR highlight colours [S13d] | S–M | GPU readback cost while dragging. Use a shader overlay rather than CPU readback. | No |
| 6 | **Black / white / grey eyedroppers.** Set black point, white point and neutral grey from a click. Default to "tonal only" (master curve); the grey picker writes R/G/B curves. | Photoshop and Apple Photos both have them. Fast for scans and flat images. | [S23], [S24], [S24a] | S–M | Grey picker overlaps White Balance. Explain clearly, or route grey to WB instead (owner decision). | No |
| 7 | **TAT improvements.** (a) Lightroom parity: drag up/down, arrow keys with Shift for larger steps, Esc to leave. (b) Hover shows where the pixel falls on the curve (a dot on the curve plus its value). (c) darktable-style area pick that creates bracketing nodes (Ctrl-drag = more contrast in that range, Shift-drag = less). (d) In Regions mode, TAT moves the matching region slider. (e) The TAT announces itself while on, and Esc leaves it (LightCraft: "one left on by mistake looked like a frozen canvas"). | Lightroom users expect it. darktable's area-pick is a genuine step beyond Lightroom. Hover feedback fixes "which part of the curve is this?" | Lightroom [S9], [S10]; darktable [S3a]; LightCraft [L10]; hover dot is a new idea (similar to Photoshop showing a point when clicking in image, [unconfirmed] details) | M | Gesture conflicts with pan/zoom on touch (see #14). | No |
| 8 | **Before/after ghost of the curve.** Faint line showing the curve when the panel was opened, or the last saved state. Optional "baseline" diagonal and "intersection line" crosshair. | Photoshop offers "Baseline" and "Intersection Line" display options. A ghost makes undo targets and relative changes visible. | Photoshop [S23]; ghost-of-previous-state is a new idea | S | Visual clutter. Make it a toggle. | No |
| 9 | **Numeric entry and snapping.** Input/Output boxes for the selected point (Lightroom, GIMP). Arrow-key nudge of the selected point (an open Lightroom request since 2013). Shift for ×10 steps. Alt-drag for ×0.1 fine movement (LightCraft). Clamp a dragged point just before its neighbour (LightCraft). Next/previous point keys (Photoshop's Shift +/−). Snap x to the histogram's region boundaries and 0/25/50/75/100% gridlines while dragging with a modifier. | Precision and repeatability. Arrow-key nudging is a known Lightroom gap. | [S10], [S10a], [S23], [S26]; LightCraft [L10]; snapping to region splits is a new idea | S | Snapping can surprise. Make it modifier-activated. | No |
| 10 | **Presets and reference match.** (a) Built-in presets: Linear / Medium / Strong contrast (Lightroom's `ToneCurveName2012` values), plus darktable-like "non-contrast" gamma/log curves. (b) Later: "Match look": fit a monotone tone curve (and optionally R/G/B) so the image's luminance histogram matches a reference photo, via CDF matching then a fit to ≤6 monotone nodes. | Presets are universal (DxO, darktable, Lightroom). Histogram matching is the base of Bae/Paris/Durand and Nuke's source/target. Fitting to a few nodes keeps it editable, and "simple curves" are sufficient per Bennett & Finlayson. | [S13], [S2], [S6], [S21]; [S29], [S38], [S36], [S37], [S32] | S (presets) / M (match) | Raw histogram matching produces wiggly, non-monotone curves. Constrain to monotone and smooth. Reinhard-style colour transfer is out of scope for the curve tool. | No |
| 11 | **Auto curve.** A one-click monotone curve: black/white points at small percentile clips, plus a midtone/contrast fit. Variants "Tonal only" (master curve) and "Per channel" (R/G/B, removes casts), like Aperture's Combined vs Separate. | Photoshop and Apple both ship it. FiveK work shows expert curves are smooth and learnable. | [S23], [S24], [S24a]; [S30], [S32] | M | Overlaps Exposure/Whites/Blacks auto. Must not fight Auto Tone; define one owner. ML auto curves need training-data licence clarity (FiveK licence [unconfirmed]). | No |
| 12 | **Avoid conflict with tone equalizer and sigmoid.** (a) Keep the curve after the sigmoid and label it as a "finishing" curve. (b) Default curve is identity, so Contrast lives in the sigmoid and Highlights/Shadows in the tone EQ. (c) Show a small info hint when a curve's slope at middle grey differs a lot from 1 ("you may want Contrast instead"). (d) Never auto-convert sigmoid contrast into curve points. | darktable warns against stacking display transforms ("Never use sigmoid together with another display transform module"). Lightroom docs present the Basic sliders as the primary tool, with the curve after them (secondhand [unconfirmed]). Two tools doing the same job confuses users. | [S4], [S13c]; hint is a new idea | S | Hint can feel naggy. Show it once, then let the user dismiss it. | No |
| 13 | **Keyboard and screen-reader access.** Model each point as a slider-like control with `aria-valuetext` such as "Input 128, Output 140". Tab order fixed (left to right), not visual. Arrow/Shift-arrow move; Delete removes; Insert or Enter adds a point at the focused x. Region sliders are standard sliders. Announce clipping. | WAI-ARIA multi-thumb pattern: "Each thumb is in the page tab sequence and has the keyboard interactions described in the Slider Pattern." "The tab order remains constant regardless of thumb value and visual position within the slider." Use `aria-valuetext` "to a string that makes the slider value understandable." | W3C APG [S42]; GIMP and Photoshop key models [S23], [S26] | M | 2-D points do not map neatly onto 1-D sliders. Split into "input" and "output" sub-controls, or use Left/Right = input and Up/Down = output (like GIMP). | No |
| 14 | **Touch use.** Default to Regions on phone and tablet. Point curve with a magnified drag (offset finger, so the point stays visible). Tap to add, double-tap to remove (Lightroom mobile). "Swipe in a tone band" gesture (Darkroom). TAT that does not steal pan/zoom (two-finger = pan). | Lightroom mobile and Darkroom show the patterns. Darkroom found small-screen curves "hard to use". | [S20a], [S25]; offset-drag magnifier is a new idea | M | Gesture conflicts. Test on real devices. | No |
| 15 | **Monotone spline default, simple-curve guard.** Default interpolation monotone Hermite (darktable default; LightCraft uses Fritsch–Carlson and calls its curve "monotone by construction"). Warn or soft-limit when a point would make the curve non-monotone, unless an "allow inversion" toggle is on. | Prevents cubic overshoot ("cusps and oscillations"). Simple curves are what experts use. | [S2], [S5], [S32]; LightCraft [L2], [L9], [L10] | S | Some creative curves (solarise) need non-monotone shapes. Keep the toggle. | Possibly. If existing edits use a cubic spline, keep their interpolation stored per edit. |
| 16 | **Lightroom XMP import/export** of `ToneCurvePV2012[Red/Green/Blue]` and `Parametric*`. | Users migrating from Lightroom keep their curves. LightCraft's model to copy: own settings stored exactly in a private namespace, `crs:` read only as "approximate" and never written, R/G/B read only when all four curves are present. | [S13]; LightCraft [L12] | M | Lightroom's internal curve domain and colour model are [unconfirmed]. Imported curves will look similar, not identical. Say so in the UI. | No |
| 17 | **Extended range region (later, for HDR output).** Reserve a design for values above SDR white (Lightroom's "lower left quadrant = SDR" layout; Aperture's "two times pure white"). | Future HDR export. Interim fallback: continue the curve with slope 1 above 1.0 (LightCraft). | [S13d], [S24a]; LightCraft [L7] | L | Adobe has HDR point-curve visualisation filings, one possibly granted (see 2.5). Facts only; review before copying the UI closely. | No |
| 18 | **Regions implementation: endpoint-pinned raised-cosine windows.** Each region adds a raised-cosine bump between its split points, with overlap. The sum is applied as `x + d·4x(1−x)`, so black and white never move, and then made monotone with a running max. | A small, documented, permissively licensed design for decision 2. It never inverts tones and never moves the endpoints. | LightCraft `finish.rs` [L7] | S | It will not match Lightroom's region shapes exactly; Adobe's are [unconfirmed]. The running max can flatten extreme settings. | Yes, if it replaces an existing Regions formula. Put it behind a process version. |

---

## 4. Pipeline position analysis (**Analysis**, reasoned from the sources above)

LightBench pipe: exposure → tone EQ (Highlights/Shadows/Whites/Blacks) → **sigmoid (Contrast)** → [curve here?] → output.

| Question | Curve **before** the sigmoid (scene-referred, like darktable rgb curve) | Curve **after** the sigmoid (display-referred, like darktable tone curve, ART, reportedly Lightroom) |
|---|---|---|
| **Lines up with the histogram the user sees?** | **No.** The sigmoid sits between the curve and the screen, so a point at x does not correspond to a fixed place in the output histogram, and the mapping shifts every time Contrast changes. The axis must cover 0…∞ (log/stops axis, as in Baselight [S28]), not 0–100%. | **Yes**, if the curve's axis uses the same encoding as the displayed histogram (row 1 of section 3). This is the Lightroom feel. |
| **Highlight clipping** | Curve output above 1.0 is still compressed by the sigmoid, so there is no hard clip. Forgiving, but a curve lift in the highlights can be partly undone by the sigmoid's shoulder. | Input is bounded (target black/white [S4]). The curve can **create** hard clipping, for example by moving the white endpoint left or giving a steep top segment. A clipping preview (row 5) and soft-clip-style roll-off (Resolve [S27]) become important. |
| **Hue behaviour** | Per-channel curves on linear data shift hue strongly. The sigmoid's own colour handling ("per channel" with preserve hue, or "rgb ratio" [S4]) then applies on top, so the two interact. | Hue shifts come only from the curve's own mode. The film-like mode assumes bounded input, which fits here [S17]. A luminance-ratio mode can push saturated colours out of gamut, so a clip/gamut rule is needed. |
| **Interaction with Contrast (sigmoid) and tone EQ** | Overlaps the tone EQ's job (both are scene-referred tonal shaping) and confuses "where should I do this?" | Clear split: scene tools set the image; the curve is a finishing tool. Matches darktable/ART structure. darktable's manual still prefers most work scene-referred [S4], so the curve should be framed as "finishing". |
| **Lightroom XMP compatibility** | Hard: Lightroom curves have 0–255-style display coordinates ([unconfirmed] domain). | Easier: same kind of bounded domain. |
| **HDR export later** | Naturally covers values above SDR white. | Needs an extended-range design (row 17, Adobe-style quadrant). |
| **Cost** | A 1-D LUT either way; negligible on GPU. | Same. |
| **Effect on old edits** | — | Moving an existing curve between the two positions **changes appearance**. If LightBench ever had it before the sigmoid, the move must go behind a process version. |

**Verdict (analysis):** after the sigmoid is the better default for a Lightroom-style editor. Its two weaknesses are new clipping and HDR headroom, and both have known mitigations (preview and soft clip now, extended-range region later).

---

## 5. Recommended first version

1. **Placement:** after the sigmoid, on display-referred values, with the axis in the same encoding as the main histogram. The histogram behind the curve is the curve's input.
2. **Modes:** **Regions** (Highlights/Lights/Darks/Shadows + 3 draggable splits, Lightroom semantics; LightCraft's endpoint-pinned raised-cosine formula, row 18, is a permissively licensed reference) and **Point** (monotone Hermite default, cap at 16 points for Lightroom-compatible import; darktable allows 20). The tab or toggle names the stored mode.
3. **Channels:** Master + **R/G/B** (per-channel, no colour preservation on R/G/B, matching Lightroom).
4. **Colour model for Master:** Adobe-style hue-preserving "film-like" by default, plus a slider (**recommend naming it "Refine Saturation" or "Curve Saturation", not plain "Saturation"**), range 0–100, default 100. 0 = luminance-ratio (tone only). Version the algorithm.
5. **Interaction:** TAT (drag, arrow keys, Shift, Esc, T shortcut), with hover dot on the curve. Input/Output numeric boxes. Arrow-key nudge of the selected point. Next/previous point keys. Double-click a label to reset.
6. **Clipping:** Alt-drag clipping overlay on endpoints, and clip counts at the histogram ends.
7. **Presets:** Linear / Medium Contrast / Strong Contrast.
8. **Accessibility:** WAI-ARIA slider semantics per point, with `aria-valuetext`.
9. **Touch:** Regions first on small screens; tap to add, double-tap to remove.

### Later
- Black/white/grey eyedroppers.
- darktable-style area pick that creates bracketing nodes.
- Before/after ghost and intersection-line display options.
- Auto curve (tonal and per-channel).
- Match a reference photo (monotone fit).
- Perceptual mode (RawPedia-style chroma compensation).
- Advanced norms (power, max RGB).
- Hue-vs/Sat-vs curve view inside the HSL tool.
- Snapping to region splits.
- Soft-clip roll-off control.
- Extended-range (HDR) region.
- Lightroom XMP curve import/export.
- Offset-finger magnifier for touch.

---

## 6. Exclusions

- **Copying Adobe DNG SDK code.** The code could not be read, and its licence terms for GPL-3.0 reuse are **[unconfirmed]**. Implement the film-like curve from published descriptions, or from a GPL-compatible project after checking its licence.
- **ML-learned or "AI" auto curves in v1.** The MIT-Adobe FiveK image licence is **[unconfirmed]**, and the brief's licence rules apply to any model.
- **Two chained tone curves (RawTherapee style).** This adds complexity against the owner's usability rule. One curve plus the sigmoid already gives two stages.
- **Lab/CMYK channel curves** (Affinity). Out of scope for a scene-referred Rec.2020 RAW editor.
- **Reinhard/Pitié full colour transfer** inside the curve tool. Colour matching belongs elsewhere if anywhere. The curve tool would do only the tonal/RGB-curve fit.
- **Copying Adobe's HDR curve visualisation closely.** There are patent filings (section 2.5). Facts only; get a review before designing that area.

---

## 7. Open questions for the owner

1. **Curve "Saturation" name.** Lightroom's curve slider is called "Refine Saturation", and Lightroom's main panel already has a "Saturation" slider stored as `crs:Saturation`. Is it OK to call ours "Refine Saturation" or "Curve Saturation" to avoid confusion?
2. **Default colour behaviour.** Do you want the Lightroom-style "film-like" look as the default for new edits, with the slider at 100? If LightBench already ships plain per-channel curves, this needs a new process version.
3. **Histogram encoding.** Which encoding does LightBench's main histogram use (sRGB-style display values, or something else)? The curve's axis should use the same one, so they line up exactly.
4. **Grey eyedropper.** If we add one, should it change the R/G/B curves (Photoshop style) or the White Balance (simpler for most users)?
5. **Lightroom curve import.** Is "looks close but not identical" acceptable for curves imported from Lightroom XMP files?
6. **HDR.** Is HDR export on the roadmap? If yes, the curve's data format should reserve room for values above white now, even if the UI comes later.
7. **Point limit.** Cap at 16 points (same as Lightroom, which makes import simple) or allow 20 (darktable)?

---

## 8. Sources

Retrieved 2026-10-13. "(secondary)" = not the vendor or author of the software or paper.

- [S1] darktable `src/common/iop_order.c` (master): https://github.com/darktable-org/darktable/blob/master/src/common/iop_order.c
- [S2] darktable `src/iop/rgbcurve.c` (master): https://github.com/darktable-org/darktable/blob/master/src/iop/rgbcurve.c
- [S3] darktable 5.6 manual, tone curve: https://docs.darktable.org/usermanual/5.6/en/module-reference/processing-modules/tone-curve/
- [S3a] darktable manual (development), rgb curve: https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/rgb-curve/
- [S4] darktable manual (development), sigmoid: https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/sigmoid/
- [S5] darktable 4.6 manual, curves: https://darktable-org.github.io/dtdocs/en/darkroom/processing-modules/curves/ (also https://docs.darktable.org/usermanual/4.6/en/darkroom/processing-modules/curves)
- [S6] darktable `src/iop/tonecurve.c` (master): https://github.com/darktable-org/darktable/blob/master/src/iop/tonecurve.c
- [S7a] darktable `src/common/rgb_norms.h` (master): https://github.com/darktable-org/darktable/blob/master/src/common/rgb_norms.h
- [S8a] darktable manual (development), filmic rgb: https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/filmic-rgb/
- [S8b] darktable issue #8061: https://github.com/darktable-org/darktable/issues/8061
- [S9] Adobe, Make color and tonal adjustments in Camera Raw: https://helpx.adobe.com/camera-raw/desktop/using/make-color-tonal-adjustments-camera.html
- [S10] Julieanne Kost (Adobe), The Tone Curve Panel in Lightroom Classic (Aug 2024): https://jkost.com/blog/2024/08/the-tone-curve-panel-in-lightroom-classic-2.html
- [S10a] Adobe community idea, nudge curve points with arrow keys: https://community.adobe.com/t5/lightroom-classic-ideas/lightroom-ability-to-accurately-nudge-rgb-curves-with-arrow-keys/idi-p/12249121
- [S11] Lightroom Queen, What's New in Lightroom Classic 12.4 (secondary): https://www.lightroomqueen.com/whats-new-in-lightroom-classic-12-4/
- [S12] The ART Book: https://art.pixls.us/Book
- [S12a] computer-darkroom, Refine Saturation (secondary): https://www.computer-darkroom.com/blog/category/adobe/adobe-camera-raw/refine-saturation/
- [S13] exiv2 XMP crs tag list: https://exiv2.org/tags-xmp-crs.html
- [S13a] Adobe XMP Camera Raw namespace: https://developer.adobe.com/xmp/docs/XMPNamespaces/crs
- [S13b] Lightroom Queen forum, parametric split fields (secondary): https://www.lightroomqueen.com/community/threads/how-to-adjust-parametric-shadow-split-parametric-midtone-split-parametric-highligh.13664/
- [S13c] fredmiranda forum, 2012 (secondary, secondhand): https://www.fredmiranda.com/forum/topic/1095544/0
- [S13d] Adobe, HDR Optimization (Lightroom): https://helpx.adobe.com/lightroom/desktop/edit-photos/hdr-output.html
- [S14] Greg Benz, How to avoid color shifts with Lightroom curves (secondary): https://gregbenzphotography.com/lightroom-acr/how-to-avoid-color-shifts-with-lightroom-curves/
- [S15] RawPedia, Exposure: https://rawpedia.rawtherapee.com/Exposure
- [S15a] DNG SDK `dng_reference.cpp` (Android mirror; page truncated): https://android.googlesource.com/platform/external/dng_sdk/+/b76282adc88bc87cc28ce629f45c9051efd95e53/source/dng_reference.cpp
- [S16] DCamProf documentation (Anders Torger): https://torger.se/anders/dcamprof.html
- [S17] darktable issue #8466, Adobe DNG tone curve type: https://github.com/darktable-org/darktable/issues/8466
- [S17a] Blender commit "Compositor: Added Weighted Standard Curve evaluation": https://lists.blender.org/pipermail/bf-blender-cvs/2018-August/113491.html
- [S18] = [S15] RawPedia, Exposure (curve types and modes)
- [S19] pixls.us, Tone Curves Mode (ART developer comment): https://discuss.pixls.us/t/tone-curves-mode/51606
- [S20] Capture One, The Curve tool overview: https://support.captureone.com/hc/en-us/articles/360002612118-The-Curve-tool-overview
- [S20a] Adobe, Lightroom mobile, Adjust tonal range using Curve: https://helpx.adobe.com/lightroom/mobile/adjust-light-and-color/adjust-tonal-range-using-curve.html
- [S20b] Capture One, Improving contrast without altering saturation: https://support.captureone.com/hc/en-us/articles/360002604017-Improving-contrast-without-altering-saturation-in-the-Curve-tool
- [S21] DxO PhotoLab user guide, Customize tab: https://userguides.dxo.com/photolab/en/the-customize-tab/
- [S21a] DxO forum, PL8 new Tone Curve (secondary): https://forum.dxo.com/t/pl8-the-new-tone-curve-discoveries-and-learnings/39425
- [S22] Affinity Photo help, Curves: https://affinity.help/photo/en-US.lproj/pages/Adjustments/adjustment_curves.html
- [S23] Julieanne Kost (Adobe), Working with Curves in Photoshop (2019): https://jkost.com/blog/2019/10/working-with-the-curves-in-photoshop.html
- [S24] Apple, Photos for Mac, Curves: https://support.apple.com/guide/photos/pht7875d6b19/mac
- [S24a] Apple, Aperture 3.6, Adjust the tonal curve: https://help.apple.com/aperture/mac/3.6/en.lproj/apr54661a72.html
- [S24b] Photomator guide, Curves: https://pixelmator.com/support/guide/photomator/650
- [S24c] ON1, sneak peek at Curves enhancements (May 2023): https://on1.com/blog/on1-insider-a-sneak-peak-at-the-new-curves-filter-enhancements
- [S25] Darkroom blog, Using Curves (2015): https://darkroom.co/blog/2015-06-curves-part-1-of-2
- [S25a] MacStories, Halide Process Zero (secondary): https://www.macstories.net/news/manual-camera-app-halide-introduces-process-zero-a-new-unprocessed-image-capture-mode/
- [S26] GIMP manual, Curves: https://docs.gimp.org/nl/gimp-tool-curves.html
- [S26a] Krita manual, Adjust filters (source text): https://docs.krita.org/de/_sources/reference_manual/filters/adjust.rst.txt
- [S27] DaVinci Resolve 12 manual, ch. 26 Curves: https://ltbits.github.io/davinci-resolve-manuals/DR12/DR12-RM-26.pdf
- [S27a] DaVinci Resolve 18.6 manual (mirror): https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part2766.htm
- [S28] Andy Minuth, Base Grade and the evolution of grading tools (Lowepost): https://lowepost.com/insider/colorgrading/base-grade-and-the-evolution-of-grading-tools-r15/
- [S29] Foundry Nuke 17, Using ColorLookup Curves: https://learn.foundry.com/nuke/17.0/content/comp_environment/color_correction/using_color_curves.html
- [S30] Bychkovsky et al., project page: https://people.csail.mit.edu/vladb/photoadjust and paper PDF: https://people.csail.mit.edu/vladb/photoadjust/db_imageadjust.pdf
- [S30a] Papers with Code, MIT-Adobe FiveK: https://paperswithcode.com/dataset/mit-adobe-fivek (the dataset page https://data.csail.mit.edu/graphics/fivek failed to load)
- [S32] Bennett & Finlayson, Simplifying Tone Curves for Image Enhancement (CIC 2023): https://ueaeprints.uea.ac.uk/94629/1/CIC_2023_20_James_Bennett.pdf
- [S33] Bennett & Finlayson, Evaluating Preference for Images Enhanced with Simple Tone Curves (AIC 2025): https://ueaeprints.uea.ac.uk/id/eprint/100622
- [S34] Moran et al., CURL: https://arxiv.org/abs/1911.13175
- [S35] Guo et al., Zero-DCE: https://arxiv.org/abs/2001.06826v1
- [S36] Reinhard et al., Color Transfer between Images (2001): https://users.cs.northwestern.edu/~bgooch/PDFs/ColorTransfer.pdf
- [S37] Pitié, Kokaram, Dahyot, Automated colour grading using colour distribution transfer (CVIU 2007): https://mural.maynoothuniversity.ie/15125/
- [S38] Bae, Paris, Durand, Two-scale Tone Management for Photographic Look (SIGGRAPH 2006): https://people.csail.mit.edu/sparis/publi/2006/siggraph/Bae_06_Two-Scale_hq.pdf
- [S39] Justia, US 2025/0117977 A1: https://patents.justia.com/patent/20250117977
- [S40] patentlyze, US 2026/0289832 A1 (secondary): https://patentlyze.com/patent/adobe-hdr-tone-curve-editing-visualizations-explained/ (USPTO PDF linked there, not read: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/20260289832)
- [S41] Google Patents, US 7,146,059 B1: https://patents.google.com/patent/US7146059
- [S42] W3C WAI-ARIA APG, Multi-Thumb Slider: https://www.w3.org/WAI/ARIA/apg/patterns/slider-multithumb

**Pages that failed or were blocked:**
- `docs.darktable.org` (several pages): server errors.
- `community.adobe.com` discussion threads: robots-disallowed.
- Adobe June 2023 "What's new" pages: they now show the current release.
- `forum.blackmagicdesign.com` (Luma Mix): client error.
- `data.csail.mit.edu/graphics/fivek`: server error.
- Scribd RawTherapee doc: requires JavaScript.
- `gh api`: blocked for all repositories.

**LightCraft** (storytold/lightcraft, branch `master`, read 2026-10-13; workspace version 0.7.1; commit hash not visible)
- [L1] AGENTS.md: https://raw.githubusercontent.com/storytold/lightcraft/master/AGENTS.md
- [L2] README: https://raw.githubusercontent.com/storytold/lightcraft/master/README.md (repo page: https://github.com/storytold/lightcraft)
- [L3] LICENSE-MIT: https://raw.githubusercontent.com/storytold/lightcraft/master/LICENSE-MIT
- [L4] NOTICE: https://raw.githubusercontent.com/storytold/lightcraft/master/NOTICE
- [L5] Cargo.toml: https://raw.githubusercontent.com/storytold/lightcraft/master/Cargo.toml
- [L6] crates/pipeline/src/lib.rs: https://raw.githubusercontent.com/storytold/lightcraft/master/crates/pipeline/src/lib.rs
- [L7] crates/pipeline/src/finish.rs: https://raw.githubusercontent.com/storytold/lightcraft/master/crates/pipeline/src/finish.rs
- [L8] crates/develop/src/settings.rs: https://raw.githubusercontent.com/storytold/lightcraft/master/crates/develop/src/settings.rs
- [L9] crates/color/src/spline.rs: https://raw.githubusercontent.com/storytold/lightcraft/master/crates/color/src/spline.rs
- [L10] crates/ui-egui/src/tests_curve.rs: https://raw.githubusercontent.com/storytold/lightcraft/master/crates/ui-egui/src/tests_curve.rs
- [L11] docs/parity.md: https://raw.githubusercontent.com/storytold/lightcraft/master/docs/parity.md
- [L12] docs/xmp-interop.md: https://raw.githubusercontent.com/storytold/lightcraft/master/docs/xmp-interop.md
- [L13] ROADMAP.md: https://raw.githubusercontent.com/storytold/lightcraft/master/ROADMAP.md
- [L14] docs/web.md: https://raw.githubusercontent.com/storytold/lightcraft/master/docs/web.md
- Also read: crates/pipeline/src/tone.rs, crates/pipeline/src/local.rs, crates/meta/src/lib.rs, crates/meta/src/xmp.rs, crates/develop/src/lib.rs (same URL pattern).
