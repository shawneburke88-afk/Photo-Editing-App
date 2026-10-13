# Colour Mixer and Effects: design brief

Research for two Phase 3 tool groups ([USABILITY.md](../USABILITY.md) groups 4 and 6): the **Colour Mixer** (Lightroom's HSL / Color Mixer, with Point Color) and the **Effects** (post-crop vignette, grain), plus **Dehaze, Texture and Clarity**, which USABILITY.md places in Basic → Presence. Compiled 2026-10-13. No app code. Format follows [TONE_CURVE.md](TONE_CURVE.md).

## How this was researched (read first)

- **Read in full [read]:** darktable's source at commit `6271f53` (2026-10-11; its RELEASE_NOTES.md is for 5.8.0); darktable's manual source (dtdocs on GitHub, `master`); RawTherapee's source (`dev` branch, three files via raw.githubusercontent.com); LightCraft's source and docs (storytold/lightcraft, commit `701f78e`, 2026-10-12, MIT/Apache-2.0, the copy already in the scratchpad); LightBench's own code on `lightbench/tone-curve`.
- **Could not read:** helpx.adobe.com, docs.darktable.org, patents.google.com, patents.justia.com, ppubs.uspto.gov, Wikipedia, arxiv.org (DNS failure or proxy refusal from both curl and WebFetch). ART's GitHub repository holds only a README at the paths tried. The GitHub API returned 403.
- **[search]** marks facts taken from the search tool's summaries of pages I could not open. They paraphrase; check before relying on details.
- **[memory]** marks things I remember but could not confirm this session. Treat as **unconfirmed**.
- **[calc]** marks numbers I computed (the script was not committed).
- **[LightBench idea]** marks proposals not seen in any surveyed tool.
- Line numbers refer to the darktable commit above.

## Summary

- **Colour Mixer, v1:** Lightroom's 8 bands × Hue/Saturation/Luminance on **darktable's color equalizer** (colorequal.c): darktable UCS 22 hue, smooth hue curves between nodes, a saturation weight so greys are left alone, a guided filter against noise and halos, and gamut mapping to the working space. It sits **before the sigmoid**, where darktable puts it. A targeted adjustment tool (TAT) and a hover marker reuse the Tone Curve's design.
  - Two changes to darktable's maths need the owner's decision: node positions (darktable's are evenly spaced; Lightroom's band centres are not public) and the band falloff (darktable's exact RBF interpolation overshoots: one band at +100 pulls hues about 60° away by −14 % [calc]).
- **Point Color** came in Lightroom Classic 13 (October 2023), not 2024 [search]. Its **Variance** slider came in Lightroom Classic 15.0 (October 2025) [search]. darktable has no equivalent. LightCraft (MIT/Apache) has a full design. Recommended as a second step, after the mixer.
- **Vignette, v1:** darktable's vignetting maths (super-ellipse fall-off) behind Lightroom's five sliders and three styles, drawn on the crop frame in the display shader. Cheap on the GPU.
- **Grain, v1:** darktable's grain (3-octave simplex noise fitted to grain scans, a paper-response curve, resolution-independent) on the GPU, with a **stored seed** instead of darktable's file-name hash. Lightroom's Roughness has no darktable equivalent and needs LightBench's own control.
- **Dehaze, v1:** darktable's haze removal (He et al.'s dark-channel prior with a guided filter), before Exposure. Statistics are computed once from the full-size photo, as Part 10 does for the tone mask. **Patent:** He, Sun and Tang's US 8,340,461 (Microsoft) is listed as "Expired - Fee Related" on Google Patents [search]; dates and family members were not checked. Adobe holds other dehaze patents (claims not read).
- **Texture and Clarity, v1:** darktable 5.8's new **contrast & texture** module. It is scene-referred, uses the same exposure-independent guided filter (EIGF) LightBench already runs on the GPU for the tone equalizer, and has coarse/medium/fine detail gains that map onto Clarity and Texture. Its filter statistics depend only on the photo, so slider moves stay per-pixel. darktable's older **local contrast** (local Laplacian, display-referred) is the alternative and is what darktable's Lightroom importer uses for Clarity.
- **Process versions:** every tool here is new and off by default, so none needs a new process version. Any later change to one tool's maths does (Part 1's rule).

---

## Part A — Colour Mixer (HSL) and Point Color

### A.1 Lightroom (the baseline)

- **Eight bands:** Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta. Each has Hue, Saturation and Luminance sliders, −100 … +100. The band names are confirmed by darktable's Lightroom importer, which reads `HueAdjustment<Band>`, `SaturationAdjustment<Band>` and `LuminanceAdjustment<Band>` for exactly these eight [read] (`src/develop/lightroom.c` 621-764). The slider ranges are [memory]; one Adobe Community thread says the Hue sliders run −100 … +100, not in degrees [search].
- **Band centre hues and widths are not published.** No reverse-engineered table was found [search]. LightCraft uses HSV hues 0, 30, 60, 120, 180, 225, 270 and 315° for the band centres, its own guess (`crates/develop/src/settings.rs` 391-394) [read].
- **Views:** in Lightroom Classic the panel has Hue / Saturation / Luminance / All tabs (8 sliders per tab) and a Color view (one band's three sliders) [memory]. The panel is now called **Color Mixer**, with **Point Color** as a tab [search]; when it was renamed is [memory].
- **Targeted adjustment (TAT):** choose Hue, Saturation or Luminance, then drag up or down on the photo; Lightroom "moves the appropriate sliders as needed", i.e. several bands at once [search] ([Adobe, HSL target adjustment](https://pages.adobe.com/creativecloud/en/photography-plan/lightroom-classic/hsl-target-adjustment), [lightroomqueen.com](https://www.lightroomqueen.com/use-the-tat-tool/)). Ctrl+Alt+Shift+N turns the tool off [search] (Peachpit summary). The keys that turn it on (Ctrl+Alt+Shift+H/S/L) are [memory].
- **Alt-drag** on an HSL slider or with the TAT shows the affected colours in colour and the rest in grey [search] (Peachpit summary).
- **Point Color:**
  - Introduced with Lightroom Classic 13 / Camera Raw 16, October 2023 [search] ([tourboxtech](https://www.tourboxtech.com/en/news/lightroom-point-color.html), [jkost.com](https://jkost.com/blog/?p=22189)). The brief's "2024" looks wrong.
  - An eyedropper samples a colour; sliders **Hue Shift, Saturation Shift, Luminance Shift**, **Range** (with separate hue, saturation and luminance ranges [memory]), **Visualize Range** [search] ([Adobe help, regional copies](https://helpx.adobe.com/uk/lightroom-classic/desktop/process-and-develop-photos/color-mixer.html)).
  - **Variance** was added in Lightroom Classic 15.0 (October 2025): it increases or decreases colour contrast within the range, e.g. evens out patchy grass or skin [search] ([Greg Benz](https://gregbenzphotography.com/lightroom-acr/new-in-lightroom-15-photoshop-2026-for-landscape-photography), [jkost tag page](https://jkost.com/blog/tag/variance-slider)). One reviewer saw it also shift the sampled hue [search]. An experienced writer said he did not understand how it works ([REVIEWS_ROUND2.md](REVIEWS_ROUND2.md) line 89). Adobe's help summary calls it "how far the adjustment spreads to similar colours" [search], which disagrees with the reviewers; to check.
  - Samples apply in order; later samples act on colours earlier ones changed [search]. Available in masks too [search].
  - Maximum number of samples: LightCraft states 8 as "Lightroom's limit" (`settings.rs` 418-419) [read], unconfirmed against Adobe.
- **Where Lightroom applies HSL in its pipeline** is not public.

### A.2 darktable

#### color equalizer (`src/iop/colorequal.c`, darktable 4.6+; the recommended engine)

- **What it is** [read]: "change saturation, hue and brightness depending on local hue"; input and output "linear, RGB, scene-referred" (lines 207-218). Aliases "color zones|hsl".
- **Pipe position** [read]: 41.2 in the v5.0 order, after exposure (21.0), tone equalizer (24.0), crop (24.5) and colour calibration (28.5); before colour balance rgb (41.5) and **sigmoid (45.3)** (`src/common/iop_order.c` 336-388).
- **Nodes** [read]: 8 nodes named red, orange, yellow, green, cyan, blue, lavender, magenta, **evenly spaced 45° apart** in darktable UCS 22 hue, with red at UCS 20° ("sRGB primary red records at 20° of hue in darktable UCS 22", lines 457-463, `_get_hue_node` 1725-1729). A global **node placement** slider (±23°) shifts all nodes together (line 145). Two names differ from Lightroom's: cyan ↔ Aqua, lavender ↔ Purple.
- **Parameters and defaults** [read] (lines 99-146): per node `sat_*` and `bright_*` 0 … 2 (default 1), `hue_*` −180 … +180° (default 0); saturation threshold 0.1, hue curve 1.0, contrast 0, white level +1 EV, hue analysis radius 1.5 px, effect radius 1 px, use guided filter on.
- **Colour space** [read]: pipeline RGB → XYZ D65 (CAT16) → xyY → darktable UCS 22 (L*, UV) → JCH → HSB (hue, saturation, brightness) (`process` STEP 1 and 3, lines 1058-1129). darktable UCS 22 is Aurélien Pierre's 2022 space (`src/common/colorspaces_inline_conversions.h` 1353-1354, link to his article).
- **Smooth curves between nodes** [read]: each channel's 8 values become a 360-entry lookup table by **periodic radial-basis-function interpolation** (Gaussians on a cosine series, solved exactly through the nodes; `_periodic_RBF_interpolate` 1737-1791; theory at eng.aurelienpierre.com, "interpolating hue angles"). The hue curve's width is set by the "hue curve" slider; saturation and brightness use a fixed width (π) and are clipped at 0 (`commit_params` 1864-1931).
  - **It overshoots** [calc]: with one node raised by 1 and the others at 0, the curve is exactly 1 at the node, above 0.5 over 51°, but dips to **−0.14** about 62° away (between the first and second neighbour), and is non-zero (|v| > 0.05) over 151°. So Red saturation +100 alone would slightly *desaturate* yellow-greens and purples. A narrower hue curve (0.5) reduces the dip to −0.06.
- **Saturation weighting** [read]: a logistic weight of the pixel's own saturation (`(max−min)/max`, Gaussian-blurred) fades every correction out towards neutral greys. Threshold and contrast shape it (`_init_satweights` 470-481; `_prepare_process` 929-973).
- **How luminance (brightness) changes avoid artefacts** [read]:
  1. The brightness correction is scaled by the pixel's saturation: `b = sat × (LUT_brightness(hue) − 1)`, then brightness × (1 + 8·b) (lines 1119-1124, 1166-1170). Greys never change brightness.
  2. With "use guided filter" on, the chromaticity UV is first smoothed by a 2-channel guided filter (`_prefilter_chromaticity` 611-714), so noisy pixels don't get noisy hues.
  3. The corrections (saturation and brightness) are then **guided-filtered with UV as the guide** (`_guide_with_chromaticity` 716-927; He et al.'s fast guided filter "reduced to 2" channels, line 728 comment). Corrections become spatially smooth within areas of one colour, so a darkened blue sky darkens as a surface instead of pixel by pixel.
  4. A **Scharr gradient of saturation** reduces brightness corrections at sharp saturation edges (halo suppression, lines 1103-1110, 921-924).
  5. Radii scale with the pipe's scale (`_prepare_process`: hue σ = 0.5 × 1.5 px, effect σ = 0.5 × 1 px at full size), so the filter is very local at the defaults.
- **Gamut** [read]: after the corrections, `gamut_map_HSB` clips saturation to the working space's boundary at that hue and brightness, from a per-hue lookup table built for the current working profile (lines 1172-1175; `dt_UCS_22_build_gamut_LUT` in `src/common/darktable_ucs_22_helpers.h`). In LightBench the working space is linear Rec.2020.
- **UI** [read] ([color-equalizer.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/color-equalizer.md)): Hue / Saturation / Brightness tabs, each a graph over hue with the 8 nodes; optional sliders (a new collapsible slider section in 5.8, RELEASE_NOTES.md 152-153); a picker that shows the picked hue on the graph; **an on-image cursor**: hovering shows the hue under the pointer, highlights it on the graph, and the **mouse wheel changes that hue's value**; mask views of the saturation weight and of the change per tab (red = up, blue = down). Presets: bleach bypass, Kodachrome 64 like, Kodak Portra 400 like, teal & orange (lines 2141-2320).
- **GPU:** darktable has an OpenCL path (`process_cl` 1564). Per pixel it is a few lookups and colour conversions. The guided filters add about a dozen full-resolution blurred channels per change at full size (σ ≈ 0.5-0.75 px), recomputed on every slider move because the corrections depend on the sliders. Feasible in WebGPU; cost unmeasured.

#### color zones (`src/iop/colorzones.c`, the older display-referred tool)

- CIE LCh curves, select by hue / lightness / chroma; display-referred, at 60.0 (after sigmoid, `iop_order.c` 407) [read].
- darktable's manual warns "transitions between colors may not be graceful" [read] ([color-zones.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/color-zones.md)); the color equalizer page says color zones "is prone to increase chroma/luma noise, and introduce artifacts or harsh transitions" [read].
- **darktable's Lightroom importer maps HSL here**, not to the color equalizer [read] (`lightroom.c` 1536-1546): the 8 Lightroom bands go on 8 evenly spaced curve points, x = k/7; saturation y = 0.5 + v/200; luminance y = 0.5 + (4/9)·v/200; hue y = 0.5 + (3/9)·v/200 (factors at 487-488, "use 3 out of 9 boxes" for hue and 4 for lightness).

#### saturation curve (`satcurvergb.c`, new in darktable 5.8)

- Saturation and brilliance curves against the pixel's own saturation in darktable UCS or JzAzBz, normalised to the gamut boundary [read] (RELEASE_NOTES.md 90-94). Pipe position 41.7, before sigmoid. Not an HSL tool, but TONE_CURVE.md §Summary proposed it for Sat-vs-Sat curves in the Colour group.

### A.3 Other tools

- **RawTherapee:** HSV Equalizer: three curves (H, S, V) against hue (`HSVEqualizerParams`: `hcurve`, `scurve`, `vcurve`, `rtengine/procparams.h` 1321-1331) [read]. The GUI file name tried was wrong (404), so its UI was not read.
- **RapidRAW** (a lesson, not a source): pixls.us users say its algorithms "tend to produce low quality results (highlights/shadows, HSL mixer)" (quoted in [REVIEWS_OPEN_SOURCE.md](REVIEWS_OPEN_SOURCE.md) §3.3). A per-pixel HSL mixer is where users notice quality.
- **ART:** could not be read (repository files 404). ART's colour tools are [memory] only, so not described here.
- **Capture One, Color Editor** [search] ([Capture One support](https://support.captureone.com/hc/en-us/articles/360002601358), [imagealchemist.net](https://imagealchemist.net/capture-one-color-editor/)):
  - Basic mode: colour groups with Hue, Saturation, Lightness; sliders −10 … +10 (Advanced lightness −100 … +100).
  - Advanced mode: up to 24 colour selections, each a wedge on a colour wheel with a **Smoothness** that sets how far the selection fades out.
  - Skin Tone mode: one sampled colour with three **Uniformity** sliders (hue, saturation, lightness) that pull colours in the range towards the sample. "View selected color range" greys out the rest.
  - A picker in all three modes.
- **DxO PhotoLab, HSL ColorWheel** [search] ([DxO](https://www.dxo.com/dxo-photolab/colorwheel), [chriswright.photography](https://chriswright.photography/hsl-tool-in-photolab-4/), [PetaPixel 2019](https://petapixel.com/2019/10/24/dxo-unveils-photolab-3-with-hsl-tools-that-leave-lightroom-in-the-dust)): eight channels with preset windows of **different widths** (green wider than yellow); inner handles set the range, outer handles the feathering; a channel can be **replaced by any hue**, not only shifted; a **Uniformity** slider pulls hues together or apart. (The summary listed seven channel names; the eighth was not named.)
- **LightCraft** (MIT/Apache-2.0) [read] (`crates/pipeline/src/colorops.rs`):
  - Works in **OkLCh on display-linear Rec.2020, after its tone map** (file header line 1; called after `tone.apply` in `finish.rs` 528-549).
  - **Band weights:** a raised-cosine partition of unity between neighbouring band centres; every hue belongs to at most two bands and the weights sum to 1 (`band_weights` 30-48; test `weights_partition_unity`). No overshoot.
  - Scales: Hue ±100 → ±0.5 rad (±28.6°); Saturation ±100 → chroma × 0…2; Luminance ±100 → ±0.18 OkLab L, scaled by `min(c/0.12, 1)` and `sqrt(L)` so greys and dark tones move less (lines 160-163, 205-216).
  - **Point Color** (`PointK`, lines 63-126): the sample's OkLCh with a soft box (smoothstep edges) in hue, chroma and lightness; hue is ignored for near-neutral samples; Variance pulls hue, chroma and lightness towards the sample (−100) or away (+100). Up to 8 samples, applied after the mixer. A "Visualize range" view.
  - No guided filter or other spatial smoothing: purely per pixel.

### A.4 Design questions

#### Colour space for band weighting

| Space | Used by | Notes |
|---|---|---|
| darktable UCS 22 (JCH / HSB) | darktable color equalizer, saturation curve | Built for this job (hue linearity, gamut LUT ready). The color equalizer's maths, gamut mapping and filters all assume it. |
| JzAzBz | darktable blending masks ("RGB scene": JzCzhz, `blend.h`), saturation curve's other option | HDR-capable; no ready HSL module on it in darktable. |
| OkLab / OkLCh | LightCraft | Simple; good hue linearity in SDR; not designed for values far above white. |
| CIE LCh (Lab) | darktable color zones | Known blue-to-purple hue bend [memory]; display-referred. |
| HSV/HSL of RGB | RawTherapee HSV Equalizer, Lightroom's HSV-like hues [memory] | Hue depends on the RGB primaries; poor perceptual spacing. |

Recommendation: **darktable UCS 22**, because the recommended engine is the color equalizer and porting it keeps one consistent maths. LightBench has no perceptual space in its shaders yet (grep for OkLab/UCS/JzAzBz in `web/src`: none), so this adds one.

#### Smooth band falloff

- **darktable:** exact RBF interpolation through 8 evenly spaced nodes. Smooth, but overshoots (−14 % at ~62° [calc]) and its band width is fixed by node spacing.
- **LightCraft:** raised cosine between neighbours. Never overshoots; each band reaches exactly to its neighbours' centres.
- **Lightroom:** unknown; users expect a band slider to move that colour and blend into its neighbours.
- **Recommendation [LightBench idea]:** keep darktable's lookup-table architecture (360 entries per channel, built on the CPU when a slider moves) but build the table with a **non-overshooting interpolation** through the 8 node values: either LightCraft's raised cosine or a periodic monotone-preserving spline (the Tone Curve already has Fritsch–Carlson's no-overshoot step). The rest of darktable's pipeline (saturation weight, guided filter, gamut map) stays. Owner's decision (A.9 Q2).

#### Avoiding artefacts from luminance changes

The risk: darkening one hue band turns noisy pixels at the edge of that hue range into speckle, and leaves halos where a coloured object meets grey. darktable's answers (A.2): weight by saturation, guide the corrections with chromaticity, suppress at saturation edges. LightCraft's per-pixel method only scales by chroma and √L. Recommendation: port darktable's guided filter, **on by default** (darktable's default), with darktable's "visualize" views under Advanced.

#### Gamut

Saturation +100 can push colours outside Rec.2020. darktable clips saturation to the working-gamut boundary per hue (`gamut_map_HSB`). Recommendation: port it for Rec.2020. Out-of-sRGB/P3 colours are then handled by the sigmoid and the output profile as today (how LightBench's output step treats out-of-gamut colours was not checked here).

#### Where in the pipeline

| Option | For | Against |
|---|---|---|
| **A. Before the sigmoid** (darktable's colorequal position: after exposure, tone equalizer and Basic's Vibrance/Saturation) | darktable's design and default order. Brightness changes act like a per-hue exposure, so the sigmoid rolls them off instead of clipping. Exposure doesn't change what a band does (corrections are gains). | The hue a user sees on screen is the hue after the sigmoid; the sigmoid with hue preservation keeps hue close, but not exactly. |
| B. After the sigmoid, on display values (LightCraft; darktable's color zones) | What you see is what the bands select. Same side as the Tone Curve. | Display-referred; brightness pushes can clip; darktable's manual warns about color zones' transitions. |

Recommendation: **A**, as darktable does. The TAT and the hover marker measure the pixel's hue at the mixer's input (as the Tone Curve's TAT measures at the curve's input). Owner's decision (A.9 Q3).

#### UX

- **Views** [recommendation]: Lightroom's two ways, in one row: **Hue · Saturation · Luminance · All** (8 sliders per tab; All shows 24) and **Colour** (one band's three sliders, picked from 8 swatches). Slider tracks painted with the real hue or saturation gradient (darktable draws these: `_draw_sliders_*_gradient`, lines 1968-2028). darktable's **graph over hue** with draggable nodes under Advanced, or as a third view.
- **TAT:** the Tone Curve's design (Part 12): a target button, a hover marker on the graph or on the swatches showing the hue under the pointer **and the bands it belongs to with their weights** [LightBench idea], drag up/down changes all bands in proportion to their weights (Lightroom's "moves the appropriate sliders"), arrow keys while hovering, its own keyboard context. darktable's mouse-wheel-over-photo is a further option.
- **Visualize:** Alt-drag on a band slider shows that band's colours and greys the rest (Lightroom [search]). darktable's weight and change views under Advanced.
- **Point Color:** a tab in the same group: eyedropper, up to 8 sample swatches, Hue/Saturation/Luminance Shift, Range with hue/saturation/luminance ranges, Variance, Visualize Range.
- **B&W mix:** Lightroom's `GrayMixer<Band>` belongs to a B&W treatment, which LightBench doesn't have yet. Out of scope here.

### A.5 Recommended v1

| Item | Recommendation |
|---|---|
| Sliders | 8 bands (Lightroom's names: Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta) × Hue, Saturation, Luminance, −100 … +100, default 0. Under Advanced: darktable's node placement, hue curve, saturation threshold, contrast, guided filter on/off and its two radii, white level, and the visualize views. |
| Engine | darktable's color equalizer translated to WGSL: UCS 22 conversion, per-hue lookup tables, saturation weight, the two guided filters and the Scharr halo guard, gamut map. With the owner's choices on node positions and falloff (A.9 Q1, Q2). |
| Scales (closest match, tuned by eye) | Hue ±100 → about ±30° of UCS hue (roughly to the neighbouring band; LightCraft uses ±28.6° in OkLCh). Saturation −100 → full desaturation of that band, +100 → about ×2 chroma. Luminance ±100 → a brightness gain to be tuned by eye on test photos. These are LightBench's choices; Lightroom's are not public. |
| Pipeline | Before the sigmoid, after Basic's Vibrance/Saturation (option A). A spatial pre-pass (like `tone-mask.wgsl`) for the guided filter, run on slider changes. |
| Interaction | Views, TAT with hover marker and band weights, Alt-drag visualize, keyboard as in the Tone Curve. |
| Stored | `colourMixer` in the develop settings, absent at defaults (so old edits are unchanged byte for byte, as Part 12 did). |
| Process version | None needed (new tool, off by default). Prove with Part 10's export-hash test. Any later change to the maths, node positions or scales needs a new version. |
| Point Color | Second step (A.9 Q5). |

### A.6 Alternatives

1. **LightCraft's method** (per-pixel OkLCh, raised-cosine bands, no spatial filter): simplest and cheapest, permissive licence, but no protection against noise and halos, which darktable's manual names as the main problem with hue-based tools.
2. **color zones** (darktable's importer target): display-referred curves; the manual itself discourages it.
3. **Curves only** (Hue-vs-Hue/Sat/Lum, as darktable's graph or RawTherapee's HSV Equalizer): powerful but less approachable than 24 sliders; best as the color equalizer's graph view.
4. **DxO-style ColorWheel** (per-band adjustable width, colour replacement) or **Capture One Advanced** (up to 24 selections): later, possibly as the Point Color tool's range editor.

### A.7 Lightroom mapping (closest match)

| Lightroom field | LightBench | Source |
|---|---|---|
| `crs:HueAdjustment{Red,Orange,Yellow,Green,Aqua,Blue,Purple,Magenta}` | band hue, number for number | names [read] in darktable `lightroom.c` 717-764 |
| `crs:SaturationAdjustment{…}` | band saturation, number for number | [read] `lightroom.c` 621-668 |
| `crs:LuminanceAdjustment{…}` | band luminance, number for number | [read] `lightroom.c` 669-716 |
| `crs:PointColors` | not mapped in v1 | Field name from LightCraft's code and tests only [read] (`crates/engine/src/crs.rs` 493, 850-855: an "empty" slot is written `-1.000000, -1.000000, -1.000000, -1.000000`; LightCraft doesn't import it). Its format is not documented anywhere I could read. |
| `crs:GrayMixer{…}` | not mapped (no B&W treatment yet) | LightCraft docs [read] |

Numbers carry over; the look will be close, not identical, because band centres, widths and scales differ. Writing back follows Part 7's rules.

### A.8 Licence and patents

- darktable's colorequal.c and UCS helpers: GPL-3.0-or-later, compatible; keep the copyright notices, as for other translated modules.
- LightCraft's Point Color and band weights: MIT/Apache-2.0, compatible; keep its notice if code is ported.
- Capture One, DxO and Adobe: behaviour only, no code.
- **Patents:** none searched specifically for hue-band mixers or point colour selection. The guided filter (He, Sun, Tang) is used here too; no guided-filter patent was found in one search [search, inconclusive]. Facts only; not legal advice.

### A.9 Open questions for the owner

1. **Node positions.** darktable's 8 nodes are evenly spaced (45°) in UCS hue and two are named cyan and lavender. Keep them and map Lightroom's Aqua→cyan and Purple→lavender (darktable's importer also spaces bands evenly), or place nodes at hues chosen to resemble Lightroom's bands (LightCraft's guess: HSV 0, 30, 60, 120, 180, 225, 270, 315°)? Uneven nodes are possible in the RBF maths but depart from darktable.
2. **Falloff.** Keep darktable's RBF interpolation (smooth, but one band at +100 moves hues ~60° away by −14 % [calc]) or use a non-overshooting interpolation (LightCraft's raised cosine, or a periodic monotone spline)?
3. **Position.** Before the sigmoid (darktable, recommended) or after it (LightCraft, Lightroom-like "what you see")?
4. **Slider scales.** Accept the proposed closest-match scales tuned by eye (A.5), since Lightroom's are not public?
5. **Point Color.** In the first version, or as a follow-up? If included: LightCraft's OkLCh box with Variance (permissive code exists), or the same in darktable UCS for consistency with the mixer?
6. **Guided filter default.** On by default (darktable), knowing it costs a pre-pass on every slider move?
7. **Group order.** USABILITY.md lists the Colour group as Colour mixer, Colour grading, Point colour. Point Color is a tab of the mixer in Lightroom; keep it as a separate item or make it a tab?

---

## Part B — Effects, Dehaze, Texture and Clarity

Where they live: USABILITY.md row 2 puts **Texture, Clarity, Dehaze** in **Basic → Presence** (Lightroom Classic's layout), and row 6 puts **Vignette, Grain** in **Effects**. Lightroom (the cloud app) puts Texture, Clarity, Dehaze, Vignette and Grain together in Effects ([REVIEWS_ROUND2.md](REVIEWS_ROUND2.md) line 574; Grain under Detail there). This brief keeps USABILITY.md's placement.

### B.1 Post-crop vignette

#### darktable: vignetting (`src/iop/vignette.c`)

- **Position** [read]: 68.0 in the v5.0 order, after crop (24.5), sigmoid and grain (65.0), before output (`iop_order.c` 415). So it is "post-crop" by position. Description: "non-linear, RGB, display-referred" (lines 112-120).
- **Parameters and defaults** [read] (lines 60-72): fall-off start 80 (% of the largest side), fall-off radius 50, brightness −0.5, saturation −0.5, centre, automatic ratio off, width/height ratio 1, shape 1, dithering off, unbound on.
- **Maths** [read] (`process` 693-845): distance `cplen = (|x|^(2/shape) + |y|^(2/shape))^(shape/2)` (a super-ellipse; shape 1 is a circle or ellipse, smaller is squarer, larger is cross-like); weight = (cplen − start) / fall-off, clamped to 0…1 (smoothed with a cosine only when dithering is on, line 805); darkening multiplies RGB by (1 + weight × brightness), brightening adds weight × brightness; then saturation moves RGB away from or towards the channel mean by weight × saturation. A minimum fall-off of 100 / shorter side avoids aliasing.
- **Manual** [read] ([vignetting.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/vignetting.md)): warns of **banding**; suggests the dither module, or an exposure module with an elliptical mask instead.
- GPU: OpenCL exists (`process_cl`). Per pixel and trivial in WGSL.

#### Lightroom

- **Sliders:** Amount, Midpoint, Roundness, Feather, Highlights; **Style:** Highlight Priority (default), Color Priority, Paint Overlay [search] ([photofocus](https://photofocus.com/software/finessing-a-post-crop-vignette-in-lightroom/), [jkost 2024](https://jkost.com/blog/2024/08/adding-vignette-and-grain-effects-in-lightroom-classic.html), [digital-photography-school](https://digital-photography-school.com/?p=163176)).
  - Highlight Priority "enables highlight recovery but can lead to color shifts in darkened areas"; Color Priority keeps hues but has no highlight recovery; Paint Overlay just darkens (mixes towards black or white) and disables Highlights [search].
  - Highlights brings back brightness of bright areas inside the vignette with Highlight or Color Priority [search]; that it works only with a negative Amount is [memory].
  - Defaults: Midpoint 50 [search]; Roundness 0, Feather 50, Highlights 0 and the ranges (Amount and Roundness −100…+100; Midpoint, Feather, Highlights 0…100) are [memory].
- **XMP fields:** `crs:PostCropVignetteAmount`, `…Midpoint`, `…Style`, `…Feather`, `…Roundness` [read] (darktable `lightroom.c` 536-567; Style 1 = Highlight Priority, otherwise Color Priority or Paint Overlay). `crs:PostCropVignetteHighlightContrast` (Highlights) from LightCraft's docs [read], not in darktable. LightCraft's style numbering: 1 highlight priority, 2 colour priority, 3 paint overlay [read], unconfirmed against a Lightroom-written file.
- **darktable's importer mapping** [read] (`lightroom.c` 285-297, 536-567, 1412-1446): Amount −100, −50, 0, 50, 100 → brightness −1, −0.7, 0, 0.5, 1; Midpoint 0, 4, 25, 50, 100 → fall-off start 74, 75, 85, 100, 100; Feather → fall-off radius number for number; Style → saturation −0.3 (highlight priority) or −0.2 (others); Roundness narrows the width/height ratio towards 1 and moves the start; centre 0, shape 1, 8-bit dithering on.

#### LightCraft (MIT/Apache) [read] (`crates/pipeline/src/finish.rs` 61-85, 554-588)

Display-linear, after its colour tools, over the whole output frame: start = 0.15 + 0.95 × midpoint, width = 0.05 + 1.1 × feather; Roundness blends aspect and raises a super-ellipse power for negative values; smoothstep fall-off. Darkening multiplies RGB; Highlight Priority adds back `highlights × smoothstep(0.4, 1, luminance)`; Paint Overlay multiplies towards black; brightening blends towards white (×0.85). Colour Priority is the plain multiply.

#### Recommended v1

| Item | Recommendation |
|---|---|
| Sliders | Lightroom's: Style (Highlight Priority default), Amount −100…+100 (0), Midpoint 0…100 (50), Roundness −100…+100 (0), Feather 0…100 (50), Highlights 0…100 (0). Advanced: centre offset (darktable has it), dithering. |
| Shape | darktable's super-ellipse distance and fall-off, with LightBench's mapping of Midpoint, Roundness and Feather (darktable's importer tables as the starting point), and a smoothstep or cosine fall-off always (darktable uses it only with dithering). |
| Styles [LightBench idea] | **Highlight Priority:** apply the darkening as a gain **before the sigmoid** (scene-linear, like a radial exposure), so bright areas roll off through the sigmoid and keep detail, plus Highlights protection of bright pixels. **Colour Priority:** multiply display-linear RGB after the sigmoid (hue and saturation ratios kept). **Paint Overlay:** blend towards black or white in display-encoded values. This matches Adobe's descriptions but not Adobe's maths (not public). |
| Frame | The crop frame (the output of the single geometry pass), so the vignette follows the crop. |
| Banding | Add triangular dither at export (8-bit), on by default [LightBench idea]; darktable warns of banding. |
| Pipeline | Highlight Priority's gain in the scene-linear part of the display shader; the other styles after the Tone Curve, before grain and output. |
| GPU | Per pixel in `develop-display.wgsl`; no pre-pass. |
| Process version | None (new, off by default). |

#### Alternatives

darktable's own semantics (fall-off start, fall-off radius, brightness, saturation, shape) as an "Advanced" mode; or darktable's recommendation, an exposure adjustment with an elliptical mask, once masks exist (Phase 4 masks).

#### Licence and patents

darktable vignette.c: GPL-3.0-or-later. LightCraft: MIT/Apache. No patent search was done for vignette effects.

#### Open questions

1. Accept the Highlight Priority = scene-referred gain design, or keep all three styles display-referred (simpler, like LightCraft and darktable)?
2. Dither exports by default?
3. Expose darktable's centre offset and shape under Advanced?

### B.2 Grain

#### darktable: grain (`src/iop/grain.c`)

- **Position** [read]: 65.0, display-referred, after sigmoid (`iop_order.c` 412). Works on **Lab L only** (lines 404-412, 506-510). CPU only (no `process_cl`).
- **Parameters** [read] (lines 47-55): channel (lightness), coarseness (`scale`, 20…6400 ÷ 213.2, default 1600 ÷ 213.2, "scaled to simulate an ISO number" per the manual), strength 0…100 (25), mid-tones bias 0…100 (100).
- **The film-grain model** [read]:
  - Noise: **3D simplex noise, 3 octaves** with frequencies 0.4910, 0.9441, 1.7280 and amplitudes 0.2340, 0.7850, 1.2150, commented "parametrization of octaves to match power spectrum of real grain scans" (`_simplex_2d_noise` 317-332).
  - Tone shaping: a **paper response curve** (a sigmoid density curve, `paper_resp` and its inverse, 334-350) turned into a 128 × 128 table: the grain's effect at each lightness. Mid-tones bias makes grain fade in shadows and highlights (`evaluate_grain_lut` 352-364).
  - **Resolution-independent:** coordinates are normalised to the shorter side of the full image, so grain has the same size relative to the photo at any zoom or export size (lines 459-481). Zoomed out, it averages 21 samples on a rank-1 (Fibonacci) lattice to imitate the downscaled grain (lines 482-497).
  - **Seed:** a hash of the **file name**, so grain is stable per image and differs between frames of a sequence (lines 431-445, 455). The hash is taken modulo 0.3 × the *output region's width* (line 455), so as far as I can read, a preview and an export of different widths offset the noise differently [read; not tested].
- RawTherapee ported this module (`rtengine/ipgrain.cc`, "Ported from darktable (src/iop/grain.c)") [read].
- darktable 5.8's **spektrafilm** tone mapper has a separate, physical grain (particles per dye layer: strength, blur, granularity, uniformity, dye cloud size; `spektrafilm.c` 245-304) [read]. Much heavier; not proposed for v1.

#### Lightroom

- Amount 0…100 (default 0), **Size** (default 25), **Roughness** (default 50) [search] ([Peachpit](https://peachpit.com/articles/article.aspx?p=1664591), [PetaPixel 2025](https://petapixel.com/2025/09/19/how-to-emulate-film-grain-in-your-digital-photos/)). Roughness: low = even, high = irregular [search]. Monochrome grain only, as of September 2025 [search].
- **XMP fields:** `crs:GrainAmount`, `crs:GrainFrequency` [read] (darktable `lightroom.c` 568-581); `crs:GrainSize` from LightCraft's docs [read]. LightCraft reads Frequency as Roughness; darktable maps Frequency to its **coarseness** (0, 50, 75, 100 → 100, 100, 400, 800, ÷ 53.3) and Amount 0, 25, 50, 100 → strength 0, 20, 40, 80 (`lightroom.c` 299-311). The two disagree on what Frequency means; Lightroom's UI names (Size, Roughness) against field names (Size, Frequency) suggest LightCraft's reading [inference; unconfirmed].

#### LightCraft [read] (`finish.rs` 87-108, 640-648)

Value noise (hashed lattice, smoothstep), two scales blended by Roughness (second at 2.3×), cell size 0.0006…0.003 of the long edge from Size, applied to display-encoded RGB with a mid-tone weight `0.35 + 2.6·L·(1−L)`, a stored `seed`.

#### Recommended v1

| Item | Recommendation |
|---|---|
| Sliders | Amount 0…100 (0), Size 0…100 (25), Roughness 0…100 (50). Advanced: darktable's mid-tones bias. |
| Engine | darktable's simplex octaves and paper-response table, on the GPU (simplex noise is cheap in WGSL; the 21-sample lattice average for zoomed-out views costs 63 noise evaluations per pixel). Size → darktable's coarseness. Roughness → LightBench's own: shift weight between darktable's octaves, or add a finer octave [LightBench idea]. |
| Where it acts | After the Tone Curve, on display-encoded lightness (darktable works on Lab L); monochrome, as Lightroom. |
| Seed | A **stored seed** in the edit (as the Remove brush stores one), not the file name, so renaming a file never changes the grain, and preview and export use the same pattern [LightBench idea]. A virtual copy gets a new seed. |
| Consistency | Grain coordinates in the full-size, crop-relative frame (resolution independent, as darktable). Check fit view against a downsized export, as Part 10 did. |
| Process version | None (new, off by default). The noise function and octave table become fixed once released. |

#### Licence and patents

darktable grain.c: GPL-3.0-or-later. **Simplex noise:** Ken Perlin's US 6,867,776 ("Standard for perlin noise") is listed as **expired on 8 January 2022** [search] (Wikipedia and Google Patents summaries: "Expired - Lifetime"). darktable's version uses 3D simplex noise (octave index as the third coordinate), which is what that patent's claims concerned per a forum reading [search]. Facts only, not legal advice; the date should be confirmed.

#### Open questions

1. Store a seed per edit (recommended) or follow darktable's file-name hash?
2. Roughness: accept a LightBench-designed control (Lightroom's maths is not public)?
3. Read `crs:GrainFrequency` as Roughness (LightCraft) or as coarseness (darktable)?

### B.3 Dehaze

#### darktable: haze removal (`src/iop/hazeremoval.c`)

- **Algorithm** [read] (header 19-30): He, Sun and Tang, "Single Image Haze Removal Using Dark Channel Prior", IEEE TPAMI 33(12), 2011; with He, Sun and Tang's "Guided Image Filtering" (ECCV 2010) refining the transmission map.
- **Steps** [read] (`process` 559-697):
  1. Dark channel: per-pixel min(R, G, B), then a box **minimum** over (2·w1+1)² with w1 = 2 + ⌈4 × scale⌉ (`_dark_channel` 315-331, lines 582-583).
  2. **Ambient light A0:** take the pixels whose dark channel is in the top 5 % (95th percentile), then the brightest 5 % of those, and average their RGB (`_ambient_light` 449-557). It also returns a maximum depth, −1.125 × ln(haze level).
  3. Transmission: t = 1 − strength × min_c(I_c / A0_c), box max then box min over w1, then a **guided filter** with the image as guide, radius w2 = 3 + ⌈6 × scale⌉, ε = √0.025 (lines 664-673).
  4. t_min = clamp(exp(−distance × max depth), 1/1024, 1) (line 675). Output **(I − A0) / max(t, t_min) + A0** (line 689).
- **Parameters** [read] (lines 63-69): strength −1…+1 (default 0.2; negative adds haze), distance 0…1 (0.2), adaptive (window sizes follow the pipe's scale; on), compatibility mode (old quick-select; off).
- **Position** [read]: 14.0 in the v5.0 order: after demosaic and lens, **before exposure** (21.0) and before crop (`iop_order.c` 327); scene-linear camera RGB for RAWs.
- **Preview against export:** A0 and the maximum depth are whole-image statistics. In darktable's zoomed views the full pipe sees only part of the image, so it reuses the preview pipe's values, and logs "inconsistent output" when it can't (lines 607-655) [read].
- **Manual** [read] ([haze-removal.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/haze-removal.md)): strength 1 and distance 1 maximise removal "but is also likely to produce some artifacts"; the module "is not intended for" contrast on non-hazy images.
- darktable's **diffuse or sharpen** has "dehaze | default" and "dehaze | extra contrast" presets (`diffuse.c` 315, 341) [read]: a different, iterative method.
- **RawTherapee** (Alberto Griggio, 2018): also He et al.'s dark channel prior with a guided filter (`rtengine/ipdehaze.cc` header) [read]; parameters strength, saturation, depth, show depth map (`procparams.h` 1358-1369) [read].
- **LightCraft** [read] (`crates/pipeline/src/local.rs` 427-433, 512-529; `finish.rs` 448-460): per-pixel min(R, G, B) **Gaussian-blurred** at 2 % of the long edge (not a box minimum), a single scalar airlight = the 99.5th percentile of that, t = max(1 − 0.95 × amount × d, 0.12); negative amounts blend towards the airlight. Scene-linear, before its exposure gain; the frame's airlight from a small render so windowed renders match.

#### Lightroom

- Dehaze −100…+100 [memory]; added in 2015 [memory]. Described as based on a physical model of light scattering, mostly acting on low-frequency areas, stronger than Clarity [search] ([PetaPixel 2021](https://petapixel.com/2021/01/05/understanding-the-differences-between-clarity-texture-and-dehaze/), [jkost 2022](https://jkost.com/blog/2022/03/texture-clarity-and-dehaze-in-lightroom-classic.html)).
- **XMP:** `crs:Dehaze` per LightCraft's docs [read]. darktable's importer does not read it [read: no match in `lightroom.c`].

#### Recommended v1

| Item | Recommendation |
|---|---|
| Slider | **Dehaze** −100…+100 (0) in Basic → Presence. Advanced: darktable's **distance** (default: Q2). |
| Engine | darktable's haze removal translated to WGSL: dark channel with box min, A0 by the two quantiles, transmission with box max/min, guided filter, t_min from distance. Strength = Dehaze / 100 (LightBench's mapping; Lightroom's isn't public; tune by eye). |
| Position | Before Exposure, on white-balanced scene-linear data, as darktable. Then Exposure, Auto and the tone equalizer see the dehazed photo. |
| Statistics | **Once, from the full-size photo** (Part 10's pattern): A0, the maximum depth and the filtered haze map stored in a texture, keyed by photo, white balance and lens setting, and independent of the crop (darktable's module runs before its crop). This removes darktable's preview/export inconsistency. With the rearrangement in the note below, Dehaze drags are per-pixel. |
| GPU | Box min/max are separable; windows are small (w1 ≤ 6 at full size). A0 needs two quantiles: a GPU histogram or a reduced read-back. darktable has OpenCL kernels for every step except the quantiles. Feasible; cost unmeasured. |
| Process version | None (new, off by default). |

Note on speed [my analysis of the read code; to verify with a test]: in darktable the transmission map depends on the strength s (t = 1 − s·m with m = min_c(I_c / A0_c), then box max, box min and the guided filter), so every strength change refilters. For s > 0 the same result comes from filtering m once: box max of (1 − s·m) = 1 − s × box min of m, likewise for the box min; and the guided filter is linear in its input and keeps constants, with no clipping here (darktable passes ±FLT_MAX, line 670). So t = 1 − s × GF(boxmax(boxmin(m))), with the filtered map stored once. Negative strengths swap min and max and need a second stored map (or the plain recomputation).

#### Patents (facts only, not legal advice)

- **He, Sun, Tang: US 8,340,461** "Single image haze removal using dark channel priors", assignee Microsoft, application US 12/697,575. Google Patents lists it as **"Expired - Fee Related"** [search] (search summary of the Google Patents page; the page itself could not be opened). The grant date, expiry date and any foreign family members were **not** checked.
- **Adobe** holds dehaze patents [search, claims not read]: US 9,508,129 and its continuation US 9,646,364 "Dehazing photos and videos using visual artifact suppression"; US 9,508,126 "Image haze removal using fast constrained transmission estimation" (inventors Jue Wang, Jianchao Yang). Their relation to Lightroom's slider is not known.
- Others found, assignees not shown [search]: US 9,305,339 "Multi-feature image haze removal"; US 10,367,976 "Single image haze removal"; US 9,842,382, US 9,361,670 (dark-channel variants), US 10,477,128, US 12,482,079.
- **Guided filter:** no patent found in one search [search, inconclusive].
- darktable and RawTherapee ship this method under the GPL.

#### Open questions

1. Accept darktable's method and position (before Exposure)?
2. Default distance: darktable's 0.2, or 1 (remove haze at all depths) for a Lightroom-like single slider?
3. Patents: is the "Expired - Fee Related" status enough for the owner, or should the dates and foreign family be checked first (see Cowork list)?
4. Negative Dehaze (adding haze): darktable's negative strength, as is?

### B.4 Texture and Clarity

#### darktable options

| Module | Position (v5.0) | Method | Notes |
|---|---|---|---|
| **contrast & texture** (`contrastntexture.c`, new in **5.8**) [read] | 28.5, **before sigmoid**, scene-referred, after crop (`iop_order.c` 348) | A pyramid of **EIGF surface blurs** of the Euclidean-norm luminance (the tone equalizer's filter); detail per level = log2(pixel / smoothed), with a Wiener-style noise-bias weight, limited to ±5 EV (`extract_details` 245-257); three gains (coarse, medium, fine) cross-faded over levels with squared sine/cosine weights (`band_weight` 259-276); result applied as an exposure-like gain 2^(Σ) to RGB (lines 373-493). Also shadows/highlights from the lowest band. | Defaults: all gains 0, base detail level 5, halo control 0, noise bias 0.001 (lines 116-125). Radius per level = 0.5 × 2^(−detail level − level) × the **input's** largest side (`modify_roi_in` 497-523, `commit_params` 525-568), i.e. relative to the cropped photo. CPU only. Manual: [contrast-texture.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/contrast-texture.md); aliases "local contrast|texture|clarity…". |
| **local contrast** (`bilat.c`) [read] | 54.0, **after sigmoid**, display-referred Lab L (`iop_order.c` 400) | Local Laplacian pyramid (default) or bilateral grid. Fast local Laplacian with 6 brightness samples (`num_gamma`, `src/common/locallaplacian.c` 440-470). | Defaults detail 0.25 (125 %), highlights/shadows 0.5, mid-tone range 0.5 (lines 51-55). Preset "clarity": detail 0.33 (lines 175-187). OpenCL exists. **darktable's Lightroom importer maps `Clarity2012` here** (±100 → detail ±0.65, `lightroom.c` 320-325, 794-801, 1556-1563). |
| diffuse or sharpen (`diffuse.c`) [read] | 28.5 | Anisotropic diffusion on wavelet scales | Presets "local contrast \| normal / fine / fast" (lines 597, 622, 751). Iterative and costly. |

#### Lightroom

- **Clarity:** mid-tone local contrast; strong settings also change saturation and luminance [search]. **Texture:** subtler, mid-to-high-frequency detail; sources disagree on the band; little colour change [search] ([PetaPixel 2021](https://petapixel.com/2021/01/05/understanding-the-differences-between-clarity-texture-and-dehaze/), [diyphotography](https://www.diyphotography.net/clarity-vs-texture-vs-dehaze/)). Texture was added in 2019 [memory]. Both −100…+100 [memory].
- A commentary on the local Laplacian paper says its parameters "have been simplified and recombined" in Lightroom as Shadows, Highlights and Clarity [search] (ACM CACM 2015 summary). Not confirmed by Adobe.
- **XMP:** `crs:Clarity2012` [read] (darktable `lightroom.c` 794); `crs:Texture` per LightCraft's docs [read].

#### LightCraft [read] (`local.rs` 470-480, `finish.rs` 495-521)

Clarity: fast guided filter of log luminance at 1.2 % of the long edge (ε 0.8 EV²); detail clamped to ±2.5 EV, weighted towards mid-tones, × 0.85. Texture: Gaussian at 0.18 % of the long edge, detail × 1.1 with large details tamed. Both scene-linear, before the tone map.

#### RawTherapee [read] (`rtengine/iplocalcontrast.cc`)

Local contrast is an unsharp mask on Lab L: Gaussian of radius r, detail × amount, separate gains for darkening and lightening (darkness, lightness).

#### Recommended v1

| Item | Recommendation |
|---|---|
| Sliders | **Texture** and **Clarity**, −100…+100 (0), in Basic → Presence. |
| Engine | darktable's **contrast & texture**: Clarity drives the coarse and medium gains, Texture the fine gain (LightBench's mapping and scale, tuned by eye). Base detail level, halo control and noise bias at darktable's defaults, under Advanced. Its shadows/highlights part stays off (Basic's Highlights/Shadows already use the tone equalizer). |
| Why | Scene-referred, before the sigmoid, as darktable now recommends; exposure-independent; and the **EIGF is already on LightBench's GPU** (`tone-mask.wgsl`, Part 10). Its statistics depend only on the photo, not on the sliders, so they are computed once per photo, crop, white balance and lens setting (Part 10's cache), and Texture/Clarity drags are per-pixel. |
| GPU | One EIGF statistics grid per pyramid level (levels halve the radius until it is under 2 px; Part 10's cell-grid method fits the coarse levels; the finest levels are near full resolution). Cost unmeasured; the finest level is a full-resolution pass. |
| Radius frame | darktable's radius is relative to the cropped photo (module after crop). Part 10 chose the uncropped photo for the tone mask. One rule for both is simpler (Q2). |
| Process version | None (new sliders at 0). |

#### Alternatives

1. **local contrast (local Laplacian)**: darktable's importer target for Clarity; well-known halo-free behaviour; but display-referred (after the sigmoid), Lab, and its pyramid must be rebuilt on every slider move (the remapping depends on detail). 6 brightness samples × a full pyramid each.
2. **LightCraft's guided-filter Clarity and Gaussian Texture**: simplest; MIT/Apache.
3. **diffuse or sharpen** local contrast presets: best quality claims, but iterative and slow.

#### Licence and patents

darktable: GPL-3.0-or-later. Local Laplacian filters (Paris, Hasinoff, Kautz, SIGGRAPH 2011; Adobe Research lists it): two searches found **no patent** [search, inconclusive]. Lightroom's Texture algorithm is not public. No patent search was done for EIGF or multi-scale detail boosting.

#### Open questions

1. Texture and Clarity on darktable's new contrast & texture (recommended), or on local contrast (local Laplacian, darktable's importer target)?
2. Detail radius relative to the cropped photo (darktable's contrast & texture) or to the whole photo (Part 10's tone mask)?
3. Should Dehaze, Texture and Clarity stay in Basic → Presence (USABILITY.md, Lightroom Classic) or move to Effects (Lightroom cloud)?

### B.5 Pipeline order (all tools in this brief)

darktable's v5.0 order [read] (`iop_order.c` 306-420): lens 13.0 → **haze removal 14.0** → exposure 21.0 → tone equalizer 24.0 → crop 24.5 → colorin 28.0 → **contrast & texture 28.5** → **color equalizer 41.2** → colour balance rgb 41.5 → saturation curve 41.7 → rgb curve 42.0 → **sigmoid 45.3** → tone curve 48.0 → local contrast 54.0 → color zones 60.0 → **grain 65.0** → **vignette 68.0** → output 70.0.

Proposed LightBench order:

| Stage | Tools | Domain |
|---|---|---|
| Before Exposure | **Dehaze** | scene-linear, white-balanced |
| Basic | Exposure → tone equalizer (Highlights, Shadows, Whites, Blacks) | scene-linear |
| Presence | **Texture, Clarity** → Vibrance, Saturation | scene-linear |
| Colour | **Colour Mixer** → **Point Color** → (Colour grading, later) | scene-linear |
| Effects (part) | **Vignette, Highlight Priority** gain | scene-linear |
| Contrast | sigmoid | display transform |
| Curve | Tone Curve | display |
| Effects | **Vignette** (Colour Priority, Paint Overlay) → **Grain** | display |
| Output | output profile, dither | display |

This follows darktable's order except for two LightBench ideas: Highlight Priority's vignette gain in the scene-linear part, and Point Color (darktable has none).

---

## Process versions (all tools)

Part 1's rule: a change that alters a saved edit's pixels needs a new version; a new tool that is off by default does not. Every tool here is new and off by default, so none needs one. Two cautions:
- **Grain** must render the same pattern forever for a given seed and settings; the noise function, octave table and coordinate frame belong in `processParams` from the start.
- **Texture/Clarity and Dehaze** depend on filter radii and statistics frames; changing the frame later (Q B.4-2) would need a new version.
Each tool's addition should be proven byte-identical with Part 10's export-hash test.

---

## For Cowork verification

Claims that need checking on blocked sites:

1. **Point Color dates:** introduced in Lightroom Classic 13 / Camera Raw 16, October 2023; **Variance** added in Lightroom Classic 15.0, October 2025 (helpx.adobe.com release notes, jkost.com).
2. **What Variance does:** "colour contrast within the range" (reviewers) versus "how far the adjustment spreads" (search summary of Adobe's help). Adobe's Color Mixer help page.
3. **Point Color limits:** maximum number of samples (LightCraft says 8), the exact sliders (Hue/Sat/Lum Shift, Range with Hue/Saturation/Luminance Range sub-sliders, Variance) and their ranges.
4. **`crs:PointColors` format** in a Lightroom-written XMP, and whether `crs:Texture`, `crs:Dehaze`, `crs:GrainSize`, `crs:PostCropVignetteHighlightContrast` and `crs:GrayMixer<Band>` are the exact field names (only LightCraft's docs name them).
5. **`crs:GrainFrequency`**: is it Lightroom's Roughness (LightCraft) or tied to Size/coarseness (darktable's importer)?
6. **`crs:PostCropVignetteStyle` values:** 1 Highlight Priority, 2 Color Priority, 3 Paint Overlay.
7. **Lightroom slider ranges and defaults:** HSL ±100; vignette Amount ±100, Midpoint 50, Roundness 0, Feather 50, Highlights 0, and whether Highlights works only with a negative Amount; Grain Size 25 / Roughness 50; Dehaze, Texture, Clarity ±100.
8. **Lightroom TAT keys** for Hue/Saturation/Luminance (believed Ctrl+Alt+Shift+H/S/L) and Ctrl+Alt+Shift+N to exit; the Alt-drag "show affected colours" behaviour.
9. **The HSL → Color Mixer rename**: which Lightroom Classic version.
10. **US 8,340,461** (He, Sun, Tang; Microsoft): legal status, grant date, the date and reason of expiry (Google Patents shows "Expired - Fee Related" per a search summary), and foreign family members still in force (e.g. CN, EP). Read claim 1.
11. **Adobe dehaze patents** US 9,508,129, US 9,646,364, US 9,508,126: status and claims; and assignees of US 9,305,339 and US 10,367,976.
12. **Guided filter patent:** whether Microsoft (He, Sun, Tang) holds one, and its status.
13. **Local Laplacian filter patent:** whether Adobe (Paris, Hasinoff, Kautz) or MIT holds one, and its status.
14. **US 6,867,776** (Perlin, simplex noise): expiry on 8 January 2022, and whether claims covered 2D or only 3D+ noise.
15. **Texture's release date** (believed 2019) and Dehaze's (believed 2015).
16. **DxO ColorWheel's eight channel names** (the search listed seven).
17. **ART's colour, grain, haze and local-contrast tools** (its source could not be read).

---

## Sources

**Read in full**
- darktable source, commit `6271f53` (2026-10-11): `src/iop/colorequal.c`, `colorzones.c`, `satcurvergb.c` (header only), `hazeremoval.c`, `vignette.c`, `grain.c`, `bilat.c`, `contrastntexture.c`, `diffuse.c` (preset list), `spektrafilm.c` (grain parameters); `src/common/iop_order.c`, `darktable_ucs_22_helpers.h`, `colorspaces_inline_conversions.h`, `locallaplacian.c`; `src/develop/lightroom.c`; `RELEASE_NOTES.md` (5.8.0).
- darktable manual source (github.com/darktable-org/dtdocs, `master`): [color-equalizer.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/color-equalizer.md), [color-zones.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/color-zones.md), [haze-removal.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/haze-removal.md), [vignetting.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/vignetting.md), [grain.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/grain.md), [local-contrast.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/local-contrast.md), [contrast-texture.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/contrast-texture.md).
- RawTherapee source (`dev`): `rtengine/ipdehaze.cc`, `rtengine/ipgrain.cc`, `rtengine/iplocalcontrast.cc`, `rtengine/procparams.h`.
- LightCraft (storytold/lightcraft, `701f78e`, MIT/Apache-2.0): `crates/pipeline/src/colorops.rs`, `finish.rs`, `local.rs`; `crates/develop/src/settings.rs`; `crates/engine/src/crs.rs`; `docs/xmp-interop.md`.
- LightBench: `docs/PLAN.md`, `docs/PHASE3.md` (Parts 1, 10, 12), `docs/USABILITY.md`, `docs/DARKTABLE_MODULES.md`, `docs/research/TONE_CURVE.md`, `docs/research/REVIEWS_ROUND2.md`; `web/src/engine/gpu/develop-display.wgsl`, `web/src/engine/develop/settings.ts` (branch `lightbench/tone-curve`).

**Search summaries only (pages not opened)**
- Point Color: [tourboxtech](https://www.tourboxtech.com/en/news/lightroom-point-color.html), [jkost.com](https://jkost.com/blog/?p=22189), [Adobe help (UK copy)](https://helpx.adobe.com/uk/lightroom-classic/desktop/process-and-develop-photos/color-mixer.html), [lightroomkillertips](https://lightroomkillertips.com/adobe-max-updates/), [Greg Benz](https://gregbenzphotography.com/lightroom-acr/new-in-lightroom-15-photoshop-2026-for-landscape-photography), [jkost Variance tag](https://jkost.com/blog/tag/variance-slider), [mjtsai](https://mjtsai.com/blog/2025/11/03/lightroom-classic-15-0/).
- HSL / TAT: [Adobe Community, hsl format](https://community.adobe.com/t5/lightroom-classic-discussions/hsl-format-confusion/m-p/9972815), [Adobe, HSL target adjustment](https://pages.adobe.com/creativecloud/en/photography-plan/lightroom-classic/hsl-target-adjustment), [lightroomqueen](https://www.lightroomqueen.com/use-the-tat-tool/), [Peachpit](https://peachpit.com/articles/article.aspx?p=1190638), [jkost 2022](https://jkost.com/blog/2022/08/the-hsl-color-bw-panels-in-lightroom-classic.html).
- Capture One: [support](https://support.captureone.com/hc/en-us/articles/360002601358), [imagealchemist.net](https://imagealchemist.net/capture-one-color-editor/), [digitalcameraworld](https://digitalcameraworld.com/tutorials/capture-ones-skin-tone-tool-how-to-use-it-for-more-uniform-skies).
- DxO: [ColorWheel](https://www.dxo.com/dxo-photolab/colorwheel), [chriswright.photography](https://chriswright.photography/hsl-tool-in-photolab-4/), [PetaPixel 2019](https://petapixel.com/2019/10/24/dxo-unveils-photolab-3-with-hsl-tools-that-leave-lightroom-in-the-dust).
- Vignette and grain: [photofocus](https://photofocus.com/software/finessing-a-post-crop-vignette-in-lightroom/), [jkost 2024](https://jkost.com/blog/2024/08/adding-vignette-and-grain-effects-in-lightroom-classic.html), [digital-photography-school](https://digital-photography-school.com/?p=163176), [Peachpit grain](https://peachpit.com/articles/article.aspx?p=1664591), [PetaPixel 2025](https://petapixel.com/2025/09/19/how-to-emulate-film-grain-in-your-digital-photos/), [alikgriffin](https://alikgriffin.com/how-to-create-a-better-film-like-grain-in-lightroom/).
- Texture, Clarity, Dehaze: [PetaPixel 2021](https://petapixel.com/2021/01/05/understanding-the-differences-between-clarity-texture-and-dehaze/), [jkost 2022](https://jkost.com/blog/2022/03/texture-clarity-and-dehaze-in-lightroom-classic.html), [diyphotography](https://www.diyphotography.net/clarity-vs-texture-vs-dehaze/).
- Patents and papers: [US 8,340,461 on Google Patents](https://patents.google.com/patent/US8340461), [USPTO PDF 8340461](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8340461), [He et al. TPAMI 2011](https://mmlab.ie.cuhk.edu.hk/archive/2011/Haze.pdf), [US 9,508,129](https://patents.google.com/patent/US9508129), [US 9,508,126](https://patents.google.com/patent/US9508126), [US 9,305,339](https://patents.google.com/patent/US9305339), [US 10,367,976](https://patents.google.com/patent/US10367976), [USPTO PDF 9646364](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9646364), [Guided Image Filtering](https://people.csail.mit.edu/kaiming/eccv10/index.html), [Local Laplacian Filters](https://people.csail.mit.edu/sparis/publi/2011/siggraph), [Adobe Research listing](https://research.adobe.com/publication/local-laplacian-filters-edge-aware-image-processing-with-a-laplacian-pyramid/), [CACM 2015](https://m-cacm.acm.org/magazines/2015/3/183587-local-laplacian-filters/fulltext), [Simplex noise (Wikipedia)](https://en.wikipedia.org/wiki/Simplex_noise), [US 6,867,776](https://patents.google.com/patent/US6867776).
