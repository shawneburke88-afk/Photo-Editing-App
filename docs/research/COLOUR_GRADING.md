# Colour Grading: design brief

**Prepared for:** Shawn Burke (LightBench) · **Research date:** 2026-10-13 · **Status:** research only, nothing built.
**Reads with:** docs/PLAN.md (Phase 3 list: "color grading"), docs/USABILITY.md (Colour group: Colour mixer, Colour grading,
Point colour), docs/PHASE3.md (Part 1 process versions, Part 7 Lightroom sidecar rules, Part 12 Tone Curve position),
docs/research/COLOUR_MIXER_EFFECTS.md (the Colour group's other tools and the proposed pipeline order).

## How this was researched (read first)

- **Read in full [read]:** darktable source at `6271f53` (2026-10-11; its RELEASE_NOTES.md is for 5.8.0):
  `src/iop/colorbalancergb.c`, `src/iop/splittoning.c`, `src/common/iop_order.c`, `src/develop/lightroom.c`.
  darktable's manual source (dtdocs on GitHub, `master`): `color-balance-rgb.md`, `split-toning.md`.
  ExifTool `lib/Image/ExifTool/XMP.pm` version 3.79 (GitHub `master`, fetched 2026-10-13), its `crs` table.
  LightCraft (storytold/lightcraft, `701f78e`, MIT/Apache-2.0): `crates/pipeline/src/colorops.rs`,
  `crates/develop/src/settings.rs`, `crates/engine/src/crs.rs`, `crates/pipeline/src/profiles.rs`, `docs/xmp-interop.md`,
  `docs/parity-checklist.md`. RawTherapee (`dev`): `rtengine/procparams.h`. ART (Bitbucket `agriggio/art`, `master`,
  fetched 2026-10-13): `src/engine/procparams.h`. LightBench `main` (`a0f8353`): `engine/gpu/develop-display.wgsl`,
  `engine/develop/settings.ts`, `engine/develop/process.ts`, `develop/help.ts`.
- **Could not read:** helpx.adobe.com, blog.adobe.com, jkost.com, lightroomkillertips.com, docs.darktable.org, and every
  other non-GitHub site tried (DNS failure or proxy refusal).
- **[search]** marks facts taken from the search tool's summaries of pages I could not open. They paraphrase.
- **[unconfirmed]** marks things from memory or a single secondary source. Check before relying on them.
- **[calc]** marks numbers I computed from darktable's formulas (script not committed).
- **[LightBench idea]** marks proposals not seen in any surveyed tool.

---

## Summary

- **Lightroom's Color Grading** (October 2020, replacing Split Toning [search]) has four colour wheels: Shadows, Midtones,
  Highlights and Global. Each wheel sets a hue and a saturation, and has a Luminance slider. **Blending** sets how much
  the three ranges overlap; **Balance** moves the split between shadows and highlights.
- **Its XMP is a hybrid** [read, ExifTool]. Shadows and Highlights keep the old `crs:SplitToningShadowHue/Saturation`,
  `crs:SplitToningHighlightHue/Saturation` and `crs:SplitToningBalance` fields ("also used for newer ColorGrade
  settings"). The new fields are `crs:ColorGradeMidtoneHue/Sat/Lum`, `crs:ColorGradeShadowLum`,
  `crs:ColorGradeHighlightLum`, `crs:ColorGradeGlobalHue/Sat/Lum` and `crs:ColorGradeBlending`. There is **no**
  `ColorGradeShadowHue` field. LightCraft's reader agrees [read].
- **darktable's engine for this is color balance rgb** (`colorbalancergb.c`). It is scene-referred, sits **before the
  sigmoid** (41.5 in the v5.0 order; sigmoid is 45.3), and grades with three luminance masks. Its "4 ways" tab is an ASC
  CDL with masks: **global offset**, **shadows lift**, **highlights gain** and a **power** for the mid-tones, each with
  hue, chroma and luminance. It adds perceptual **saturation** and **brilliance** per range, a **vibrance**, a
  **contrast**, a hue shift and gamut mapping to the working space. It has sliders, not wheels.
- **darktable's older split-toning** (`splittoning.c`) is an HSL blend towards two colours with Balance and Compress.
  Its manual says it works best on monochrome input. darktable's Lightroom importer still maps Lightroom's split
  toning onto it [read].
- **Recommended v1:** Lightroom's wheels and sliders on **darktable's color balance rgb**, translated to WGSL, placed
  after the Colour Mixer and before the sigmoid. Lightroom's Shadows wheel drives *shadows lift*, Highlights drives
  *highlights gain*, Midtones drives *power*. Blending and Balance drive the masks' fall-off and middle-grey fulcrum.
  The Global wheel has no clean darktable equivalent and needs an owner decision (Q3). The whole of color balance rgb
  stays reachable under **Advanced ▸**.
- **Process version:** none needed if the tool is off by default and skipped entirely when untouched. This matters:
  darktable's gamut mapping is always on, so merely enabling the module changes colours (its manual says so).
- **Biggest owner decisions:** what Global means (Q3); the slider scales (Q4); whether Basic's Vibrance and Saturation
  move onto color balance rgb (that one *would* need a new process version, Q6); reading and writing Lightroom's fields
  (Q8).

---

## How Lightroom does it

### Semantics

- **Introduced** in October 2020 in Lightroom Classic, Lightroom and Camera Raw 13, as a replacement and improvement
  of the Split Toning panel; it adds a Midtones control [search] ([Adobe blog, 2020-10-20](https://blog.adobe.com/en/publish/2020/10/20/introducing-color-grading),
  [Greg Benz](https://gregbenzphotography.com/photography-tips/split-toning-and-color-grading-in-lr-acr-13)).
- **Migration:** old Split Toning edits carry over exactly. Presets with Split Toning settings put them on Highlights
  and Shadows, zero the Midtones, and set **Blending to 100** "to match the old look" [search].
- **Wheels:** Shadows, Midtones, Highlights and Global. Each wheel has a hue and saturation point and a Luminance slider
  [search]. Views: 3-Way, and one large wheel per range plus Global [unconfirmed; LightCraft's copy of the UI has
  "3-Way / Shadows / Midtones / Highlights tabs" and says its own Global tab is missing, parity-checklist row
  LR-EDIT-COLOR-GRADING, read].
- **Ranges** [unconfirmed]: hue 0–360, saturation 0–100, luminance −100…+100, Blending 0–100 (default 50), Balance
  −100…+100 (default 0). LightCraft's settings use exactly these ranges and defaults (`settings.rs` 497–530, read).
  A search summary confirmed Balance's default 0 and gave luminance as 0–100, which looks wrong [search].
- **Blending:** left keeps the three ranges separate, right blends them [search].
- **Balance:** positive favours the highlights' tint, negative the shadows' [search].
- **Wheel interaction** [search, from a jkost.com summary]:
  - drag the solid dot on the rim, or **Ctrl/Cmd-drag** the centre dot: hue only;
  - **Shift-drag:** saturation only (a soft constraint that breaks if you drag far enough);
  - **Alt/Option-drag:** fine adjustment.
  - A reset gesture (double-click, Alt-click) was not confirmed.
- **Where it acts in Adobe's pipeline** and how the three ranges are measured: not public.

### XMP fields (ExifTool `XMP.pm` 3.79, `crs` table, lines 1531–1535 and 1800–1809) [read]

| Range | Hue | Saturation | Luminance |
|---|---|---|---|
| Shadows | `crs:SplitToningShadowHue` | `crs:SplitToningShadowSaturation` | `crs:ColorGradeShadowLum` |
| Midtones | `crs:ColorGradeMidtoneHue` | `crs:ColorGradeMidtoneSat` | `crs:ColorGradeMidtoneLum` |
| Highlights | `crs:SplitToningHighlightHue` | `crs:SplitToningHighlightSaturation` | `crs:ColorGradeHighlightLum` |
| Global | `crs:ColorGradeGlobalHue` | `crs:ColorGradeGlobalSat` | `crs:ColorGradeGlobalLum` |
| Blending / Balance | `crs:ColorGradeBlending` | `crs:SplitToningBalance` | |

- All are typed `integer` by ExifTool. The ColorGrade fields are listed under "new for Lightroom CC 2021 (ref forum11745)".
- What a file **without** `crs:ColorGradeBlending` (an edit made before 2020) means for Blending is not documented. The
  migration note above suggests 100 [search]. To check (Cowork item 3).

---

## How darktable does it

### color balance rgb (`src/iop/colorbalancergb.c`; added in darktable 3.6 [unconfirmed]; the recommended engine)

- **What it is** [read]: "color grading tools using alpha masks to separate shadows, mid-tones and highlights"; input
  "linear, RGB, scene-referred", output "non-linear, RGB, scene-referred" (lines 177–185). Aliases include
  "offset power slope|cdl|color grading|…|vibrance|saturation" (line 174).
- **Pipe position** [read]: 41.5 in the v5.0 order, after the color equalizer (41.2) and before the rgb curve (42.0)
  and **sigmoid (45.3)** (`iop_order.c` lines 380–388).
- **Parameters and defaults** [read] (lines 60–106):
  - Per range (shadows, mid-tones, highlights, global): `*_Y` luminance −1…1, `*_C` chroma 0…1, `*_H` hue 0…360°,
    all default 0.
  - `chroma_global/shadows/midtones/highlights`, `saturation_*`, `brilliance_*`: −1…1, default 0.
  - `vibrance` −1…1, `contrast` −1…1, `hue_angle` −180…180°, all 0.
  - Masks: `shadows_weight` and `highlights_weight` ("fall-off") 0…3, default 1; `mask_grey_fulcrum` default
    0.1845; `grey_fulcrum` (contrast) default 0.1845; `white_fulcrum` −16…16 EV, default 0.
  - `saturation_formula`: JzAzBz (2021) or darktable UCS (2022), default darktable UCS.
- **Hue convention** [read]: the module works in Kirk/Filmlight Yrg, which puts red at 330°. The GUI adds −30° so red
  reads near 0° as on usual wheels (lines 45–50).
- **Order inside the module** [read] (`process`, lines 668–948; the manual's "internal processing" list agrees):
  1. pipeline RGB → CIE 2006 LMS → Yrg → Ych;
  2. hue shift;
  3. masks from luminance: `opacity_masks(Y^0.41, …)`, which centres middle grey at 50 % (lines 705–707);
  4. linear chroma and vibrance (chroma × (1 + global + Σ mask·range + vibrance term)), then a gamut check in Yrg;
  5. to "grading RGB" (Filmlight): **offset** added (`RGB += global`), then **lift and gain** as slopes under the
     masks: `RGB *= (1−β)·((1−α) + α·shadows) + β·highlights` (line 743);
  6. **power**: `RGB = sign · (|RGB|/white)^midtones · white` (lines 746–757), *not masked*, normalised by the white
     fulcrum;
  7. Y power (mid-tone luminance) and fulcrum contrast in Yrg;
  8. perceptual **saturation** and **brilliance** per range in darktable UCS (or JzAzBz), with soft gamut clipping
     against the working space (lines 773–903);
  9. back to pipeline RGB.
- **How a wheel becomes numbers** [read] (`commit_params`, lines 1141–1180): each range's (hue, chroma) is turned into a
  grading-RGB colour with `make_Ych(1, C, H)`; its difference from neutral white is the tint. Shadows and highlights
  become per-channel slopes `1 + tint + Y`; mid-tones become per-channel exponents `1 / (1 + tint)`; global becomes an
  additive offset `tint + white·Y`.
- **The masks** [read] (`opacity_masks`, lines 550–577): logistic curves of `(x − fulcrum)/fulcrum` on `x = Y^0.41`,
  steepness `2 + 2·fall-off`; the mid-tone mask is a bell built from both. At the defaults [calc]:

  | Scene luminance vs middle grey | shadows | mid-tones | highlights |
  |---|---|---|---|
  | −4 EV | 0.94 | 0.02 | 0.06 |
  | −1 EV | 0.73 | 0.30 | 0.27 |
  | 0 EV (18.45 %) | 0.50 | 0.50 | 0.50 |
  | +1 EV | 0.21 | 0.21 | 0.79 |
  | +2 EV | 0.05 | 0.01 | 0.96 |

  The three do not add up to 1 (1.5 at middle grey) [calc]. Fall-off 0 widens the overlap (shadows still 0.12 at
  +2.5 EV); fall-off 2 narrows it [calc]. In `process`, the **mid-tone mask weights only chroma, saturation and
  brilliance**: the 4-ways power is unmasked [read].
- **Gamut:** the output is soft-clipped at constant hue against the working space's gamut, from a 92³-sample hue LUT
  built in `commit_params` (lines 1196–1253). The manual: "This module has its gamut-mapping … permanently enabled. …
  simply enabling color balance RGB with no particular setting will slightly alter its colors" [read].
- **UI** [read] (`gui_init`, lines 1810–2130; manual): three tabs. **master** (hue shift, vibrance, contrast; linear
  chroma, perceptual saturation and perceptual brilliance, each global/shadows/mid-tones/highlights). **4 ways** (global
  offset, shadows lift, highlights gain, power, each luminance/hue/chroma, with a picker that picks the *opposite*
  colour of an area to neutralise a cast; Ctrl+click picks the colour itself). **masks** (a graph of the three masks,
  fall-offs, fulcrums, saturation formula, and a checkerboard preview of each mask). No colour wheels.
- **Presets** [read] (lines 506–546): "basic colorfulness | legacy / natural skin / vibrant colors / standard".
- **darktable's own advice** [read, manual]: "not suitable for beginners … who might want to stick to the global
  chroma and global vibrance settings"; brilliance outside ±20 % "likely to create artifacts".
- **Cost:** per pixel only (matrix products, a few `pow`, one LUT lookup). No spatial filters. darktable has an
  OpenCL path (`process_cl`, line 954).

### split-toning (`src/iop/splittoning.c`, the older tool)

- [read] Parameters: shadow and highlight hue and saturation (0…1), balance (0…1, default 0.5), compress (0…100 %,
  default 33). Pipe position 67.0, display side, after the sigmoid (`iop_order.c` line 414).
- Per pixel: HSL of the input; below `balance − compress` blends towards the shadow colour at the pixel's own
  lightness, above `balance + compress` towards the highlight colour; the mid-tones are untouched (lines 152–203).
  Presets: authentic sepia, cyanotype, platinotype, chocolate brown.
- Manual [read]: "has limited benefits on color images … the input to this module should therefore be monochrome".

### darktable's Lightroom importer (`src/develop/lightroom.c`) [read]

- Reads `SplitToningShadowHue/Saturation`, `SplitToningHighlightHue/Saturation` and `SplitToningBalance` into
  **split-toning**, not color balance rgb (lines 765–793, 1549–1556). Compress is set to 50.
- It divides the hues by **255** (`(float)v / 255.0`). If Lightroom's hues run 0–360 [unconfirmed], this mapping is
  off. Balance goes through a table {−100 → 100, 0 → 0, 100 → 0} (lines 313–318), which looks odd too. Neither should
  be copied without checking.
- No `ColorGrade*` field is read.

### darktable's other options

- **color balance** (`colorbalance.c`): the older lift/gamma/gain module (display-referred design). Not considered.
- Masks and blending (any module): drawn and parametric masks could restrict color balance rgb locally, as for any
  module. That is the Masking brief's subject.

---

## Others

- **LightCraft (MIT/Apache-2.0)** [read]:
  - Settings: four `Wheel { hue 0..360, sat 0..100, lum −100..100 }`, `blending` 0..100 (default 50), `balance`
    −100..100 (`settings.rs` 497–536). Neutral when every sat and lum is 0.
  - Engine (`colorops.rs` 250–270): in **OkLab on display-linear Rec.2020, after its tone map**. A wheel is an OkLab
    (a, b) offset (sat 100 → 0.09) plus a lightness shift (lum 100 → 0.12 L). The hue is converted from an sRGB-hue
    to the OkLCh hue (`oklch_hue_of_srgb_hue`). Ranges: smoothstep weights on OkLab L, centre `0.5 − balance·0.25`,
    width `0.15 + blending·0.5`; mid-tones get `1 − shadows − highlights`; Global weight 1.
  - UI (parity-checklist row LR-EDIT-COLOR-GRADING): 3-Way and per-range tabs, a large wheel with Hue/Saturation/
    Luminance sliders, Blending and Balance in every tab, the hovered wheel's values shown, neutral centre marked,
    **Shift-drag locks the hue**, 25/50/75 % saturation rings, a per-wheel eye (view only). No Global tab yet.
  - Its creative looks add wheel tints as colour vectors to the user's wheels (`profiles.rs` 13–31).
  - XMP: reads exactly the fields in the table above (`crs.rs` 340–354).
- **RawTherapee** [read, `procparams.h` 177–251]: **Color Toning** with methods Split (several variants), Lab, Lch,
  RGB sliders, RGB curves, "LabGrid" (a/b offsets for low and high), and **Lab regions**: per region an a/b tint,
  saturation, slope/offset/power, and hue/chroma/lightness masks.
- **ART** [read, `src/engine/procparams.h` 1294–1331]: **Color Correction** with regions, each with a mode (YUV, RGB,
  HSL, JzAzBz, LUT), a/b, slope/offset/power/pivot per channel, hue/sat per channel, and full masks (`MaskableParams`).
  Its GUI was not read.
- **Capture One** [search] ([support](https://support.captureone.com/hc/en-us/articles/360002594937)): **Color
  Balance** with a Master wheel plus Shadow, Midtone and Highlight wheels, and a 3-Way view. Each wheel has saturation
  and lightness sliders. Adjusting in the 3-Way view updates the large single wheels.

---

## Design questions

### Where it sits relative to the sigmoid

| Option | For | Against |
|---|---|---|
| **A. Before the sigmoid** (darktable's 41.5: after Colour Mixer, before Contrast) | darktable's design and default. Lift/gain are gains, so the sigmoid rolls off pushed highlights instead of clipping. One engine for every colour tool. Masks are on scene luminance, so Exposure moves the ranges with the photo. | The ranges are measured on scene light, not on the tones the user sees. Contrast changes what "highlights" look like on screen. |
| B. After the sigmoid (LightCraft; darktable's split-toning at 67) | What you see is what the ranges select. Same side as the Tone Curve. | Display-referred: luminance pushes can clip; not darktable's current tool. |

**Recommendation: A**, as darktable does, consistent with COLOUR_MIXER_EFFECTS.md §A.4. The masks use darktable's
middle-grey fulcrum, which LightBench's +0.7 EV base exposure and Exposure slider already place near 18 %. Owner's
decision (Q1).

### The wheel UI

- **Views:** one row, **3-Way · Shadows · Midtones · Highlights · Global** (Lightroom's set) [LightBench layout].
  3-Way shows three small wheels; the others one large wheel.
- **Each wheel:** a hue ring painted with real colours at fixed chroma, a dot for (hue, saturation), the neutral centre
  marked, 25/50/75 % rings on the large wheel (LightCraft). A **Luminance** slider under each wheel. **Hue** and
  **Saturation** number fields under the large wheel.
- **Gestures:** drag the dot; **Shift-drag** saturation only; **Ctrl/Cmd-drag** hue only; **Alt-drag** fine
  (Lightroom, [search]). Double-click the dot or its label resets (LightBench's rule for sliders).
- **Keyboard and screen readers** [LightBench idea, following Part 12's points]: each wheel is two focusable
  `role="slider"` controls, Hue (← →, wraps) and Saturation (↑ ↓), Shift for ×10, Home resets. Changes are announced.
- **Blending** and **Balance** under the wheels in every view.
- **History:** one step per drag (as the Tone Curve); sliders merge as Basic's do.
- **Eye:** the group's eye (Part 1), plus a per-wheel eye for a view-only check (LightCraft's idea).
- **Hover readout:** hovering the photo marks, on each wheel, how much of that pixel each range takes (from darktable's
  masks) [LightBench idea]. Optional; it needs a sample read-back like the Tone Curve's marker.
- **Advanced ▸:** darktable's full module: master tab (hue shift, vibrance, contrast, chroma/saturation/brilliance per
  range), the 4-ways' native values, masks tab (fall-offs, fulcrums, white fulcrum, saturation formula) and the
  checkerboard mask previews. darktable's "pick opposite colour" picker as a small eyedropper per wheel.
- **Painting colours:** the ring should show the hue as it will look. darktable paints its hue sliders through the
  output profile (`paint_hue_sliders`, line 1404). In the browser, SVG/CSS `color(display-p3 …)` or `oklch()` can paint
  wide-gamut swatches (supported since Chrome 111, Firefox 113, Safari 15 per MDN's browser-compat-data, read).

---

## Recommended v1

| Item | Recommendation |
|---|---|
| Placement | **Colour** group, after Colour Mixer and Point Color (USABILITY.md's order). |
| Controls | Four wheels (hue 0–360, saturation 0–100, luminance −100…+100), Blending 0–100 (default 50), Balance −100…+100 (default 0): Lightroom's set. |
| Engine | darktable's color balance rgb in WGSL, per pixel, in the display shader before `sigmoid` (`developBeforeCurve`), after Presence and the Colour Mixer. The gamut LUT (darktable UCS) is built on the CPU when the working space is set (once, Rec.2020) and uploaded as a small texture. The darktable UCS conversions are shared with the Colour Mixer (COLOUR_MIXER_EFFECTS.md recommends the same space). |
| Wheel → module (closest match) | Shadows → shadows lift (H, C, Y). Highlights → highlights gain (H, C, Y). Midtones → power (H, C, Y). Global → **owner's decision (Q3)**. Blending → both fall-offs (Blending 50 = darktable's 1.0; 100 = softest, 0 = hardest) [LightBench idea]. Balance → the mask middle-grey fulcrum moved in EV (e.g. ±2 EV at ±100) [LightBench idea]. |
| Hues | Stored as darktable's GUI hue (red near 0°). Lightroom hues are converted, on read and write, through the colour that hue has on an sRGB HSL wheel, as LightCraft does for OkLCh [LightBench idea]. |
| Scales | Tuned by eye, since Lightroom's are not public. darktable's chroma 1.0 is very strong, so saturation 100 might map to roughly 0.3–0.5 chroma; luminance ±100 to ±0.5 of darktable's Y. Owner's decision (Q4). |
| Skip when neutral | When every wheel's saturation and luminance are 0 (and Advanced untouched), the stage is not run at all. darktable's always-on gamut mapping would otherwise change colours. |
| Stored | `colourGrading` in `DevelopSettings` (`lightbench:Develop`), **absent at defaults**, so old edits' JSON stays as it was (as Part 12 did). Holds the four wheels, Blending, Balance, and an `advanced` block with darktable's native parameters. |
| Copy/Paste, presets | One **Colour Grading** item in the checklist; preset Amount blends wheels as colour vectors (LightCraft's `profiles.rs` way), Blending and Balance linearly. |
| Help | Hints and tooltips in `help.ts`: "Tint the shadows, mid-tones or highlights"; pitfalls (strong tints look dated; use Colour Mixer for one colour); engine "darktable color balance rgb (4 ways)". |
| Process version | None: a new tool, off by default, skipped when neutral. Prove with Part 10's export-hash test. Any later change to its maths, mapping or scales needs a new version. |

---

## Alternatives

1. **LightCraft's method** (OkLab offsets after the tone map, smoothstep ranges that sum to 1): simple, permissive,
   "what you see". Not darktable's engine, display-referred, and it would be a second colour space beside the mixer's.
2. **darktable's split-toning** as the engine for Shadows/Highlights only: matches darktable's importer, but its own
   manual limits it to monochrome input, and it has no mid-tones or global.
3. **Wheels on darktable's masks, but LightBench's own maths** (a gain per range, weights normalised to sum to 1)
   [LightBench idea]: avoids the unmasked power and the global-offset mismatch; departs from darktable.
4. **Expose darktable's sliders only** (no wheels): least work; fails USABILITY's "Lightroom-style controls".

---

## Lightroom mapping (closest match)

| Lightroom field | LightBench | Note |
|---|---|---|
| `SplitToningShadowHue` / `Saturation` | Shadows wheel hue / saturation | hue converted (above) |
| `ColorGradeShadowLum` | Shadows luminance | number for number |
| `ColorGradeMidtoneHue` / `Sat` / `Lum` | Midtones wheel | |
| `SplitToningHighlightHue` / `Saturation`, `ColorGradeHighlightLum` | Highlights wheel | |
| `ColorGradeGlobalHue` / `Sat` / `Lum` | Global wheel | meaning depends on Q3 |
| `ColorGradeBlending` | Blending | missing in an old file: owner's decision (Q8; Lightroom's migration suggests 100) |
| `SplitToningBalance` | Balance | number for number |

Numbers carry over; the look is close, not identical, because the engines differ. Reading and writing follow Part 7's
rules (write only into sidecars that already hold `crs:ProcessVersion`, only groups LightBench changed, a
`lightbench:LightroomColorGrade` marker for Ignore). darktable's importer's /255 hue and its balance table are not
copied.

---

## Licence and patents (facts only, not legal advice)

- darktable's `colorbalancergb.c`, `darktable_ucs_22_helpers.h`, `gamut_mapping.h` and colour conversions:
  GPL-3.0-or-later, compatible with LightBench. Keep the copyright notices, as for other translated modules.
- The darktable UCS 22 space is Aurélien Pierre's (2022); the Yrg space is from Richard A. Kirk's 2019 paper cited in
  the manual. Using published formulas needs no licence; no patent on either was searched.
- LightCraft's code: MIT/Apache-2.0, compatible; keep its notice if any is ported.
- Adobe, Capture One: behaviour only, no code.
- **Patents:** none searched for colour-wheel grading or luminance-masked CDL. The ASC CDL is a published industry
  specification; its terms of use were not checked.

---

## Open questions for the owner

1. **Position:** before the sigmoid (darktable, recommended) or after it (LightCraft, "what you see")?
2. **Engine:** port darktable's color balance rgb (recommended), or a simpler LightBench/LightCraft-style grade?
3. **Global wheel:** darktable's 4 ways has an additive **offset** (it moves blacks most), not a whole-image tint.
   Options: (a) Global → darktable's offset (pure darktable; differs from Lightroom's feel); (b) Global → an unmasked
   slope (ASC CDL "slope", a LightBench addition to the module); (c) Global → lift and gain together. Which?
4. **Scales:** accept closest-match scales tuned by eye (saturation, luminance, Blending → fall-off, Balance → fulcrum)?
5. **Mid-tones:** darktable's power is unmasked and normalised by the white fulcrum (default 0 EV). Keep it (darktable),
   or mask it with the mid-tone mask so Blending and Balance affect it too (LightBench change)?
6. **Basic's Vibrance and Saturation** are a "simple chroma boost for now" (`help.ts`), with "darktable colour balance
   rgb (vibrance/saturation) is planned". Moving them onto color balance rgb would change old edits, so it needs a new
   process version. Do it with this tool, later, or never?
7. **Advanced:** expose all of color balance rgb (chroma, saturation, brilliance per range, contrast, hue shift, masks
   tab) under Advanced ▸, as the no-silent-cuts rule suggests?
8. **Lightroom sidecars:** read and write the fields (Part 7's rules)? And for an old sidecar with Split Toning but no
   `ColorGradeBlending`, use 100 (Lightroom's migration) or 50 (the new default)?
9. **Hover readout** of the range weights on the wheels: in v1 or later?
10. **Split-toning preset:** offer a "Split toning" preset (Blending 100, mid-tones 0) for users who look for it by
    that name, or rely on tool search's synonyms?

---

## For Cowork verification

1. Lightroom's ranges and defaults: hue 0–360, saturation 0–100, luminance −100…+100, Blending default 50, Balance
   −100…+100 default 0 (Adobe's Color Grading help page).
2. Wheel gestures: Shift (saturation only), Ctrl/Cmd (hue only), Alt/Option (fine), and any reset gesture.
3. What Lightroom does with a sidecar that has `SplitToning*` but no `ColorGradeBlending`: is Blending 100?
4. A Lightroom-written XMP with a colour grade: confirm the field names in the table, that shadows/highlights hue and
   saturation are in the `SplitToning*` fields, and the hue range of `SplitToningShadowHue` (0–360?).
5. Whether Global is a whole-image tint (like a white-balance-style shift) or an offset; how Luminance on a wheel
   behaves (gain or offset).
6. The release: Lightroom Classic 10.0 / Camera Raw 13, October 2020.
7. Capture One's Color Balance: slider ranges, whether the Master wheel is multiplicative.
8. ART's Color Correction GUI (wheels or a/b grid) and its masks' defaults.

---

## Sources

**Read in full**
- darktable `6271f53`: `src/iop/colorbalancergb.c`, `src/iop/splittoning.c`, `src/common/iop_order.c`,
  `src/develop/lightroom.c`, `RELEASE_NOTES.md`.
- dtdocs `master`: [color-balance-rgb.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/color-balance-rgb.md),
  [split-toning.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/split-toning.md).
- ExifTool [`lib/Image/ExifTool/XMP.pm`](https://github.com/exiftool/exiftool/blob/master/lib/Image/ExifTool/XMP.pm) 3.79.
- LightCraft `701f78e`: `crates/pipeline/src/colorops.rs`, `crates/pipeline/src/profiles.rs`,
  `crates/develop/src/settings.rs`, `crates/engine/src/crs.rs`, `docs/xmp-interop.md`, `docs/parity-checklist.md`.
- RawTherapee `dev`: `rtengine/procparams.h`. ART `master`: `src/engine/procparams.h`.
- MDN browser-compat-data `main`: `css/types/color.json`.
- LightBench `a0f8353`: `web/src/engine/gpu/develop-display.wgsl`, `web/src/engine/develop/settings.ts`,
  `web/src/engine/develop/process.ts`, `web/src/develop/help.ts`; docs/PLAN.md, USABILITY.md, PHASE3.md (Parts 1, 7,
  10, 12, 13), research/COLOUR_MIXER_EFFECTS.md, research/MASKING.md.

**Search summaries only (pages not opened)**
- [Adobe blog: Introducing Color Grading](https://blog.adobe.com/en/publish/2020/10/20/introducing-color-grading),
  [Greg Benz: Split Toning to Color Grading](https://gregbenzphotography.com/photography-tips/split-toning-and-color-grading-in-lr-acr-13),
  [ExifTool forum: new XMP-CRS fields](https://exiftool.org/forum/index.php?msg=63210),
  [lightroomkillertips: Introducing Color Grading](https://lightroomkillertips.com/introducing-color-grading/),
  [lightroomkillertips: Color Grading Continued](https://lightroomkillertips.com/color-grading-continued/),
  [jkost: Color Grading in Lightroom Classic](https://jkost.com/blog/?p=18167),
  [chriswright.photography](https://chriswright.photography/?p=6932),
  [thelenslounge](https://thelenslounge.com/2020-lightroom-update-color-grading/),
  [diyphotography](https://www.diyphotography.net/we-have-tested-lightrooms-new-color-grading-tool/).
- Capture One: [Adjusting color balance globally](https://support.captureone.com/hc/en-us/articles/360002594937),
  [support article 360002594857](https://support.captureone.com/hc/en-us/articles/360002594857).
