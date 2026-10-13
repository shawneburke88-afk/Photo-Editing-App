# Tone curve: how to beat Lightroom's

Research for the Phase 3 **Tone curve** group ([USABILITY.md](../USABILITY.md), group 3: "Parametric + point, RGB", engine darktable's rgb curve). Compiled 2026-10-13. No app code.

**The owner's question.** The tone curve is one of the most-used tools. Lightroom's is the baseline: a parametric curve (Highlights/Lights/Darks/Shadows with 3 split points), a point curve with Linear/Medium/Strong presets, R/G/B channel curves, a targeted adjustment tool (TAT, drag on the photo) and the histogram behind the graph. What would make LightBench's curve easier, faster or better-looking than that?

## Summary

- **One decision shapes everything else: where the curve sits in the pipeline.** Before Contrast (the sigmoid), as darktable's rgb curve does, or after it, where darktable's tone curve sits and where darktable's own Lightroom importer puts Lightroom's curve. This doc recommends that the user always draws the curve on the **same axis as the histogram** (the tones on screen), and gives three ways to build that. It is open question 1.
- **First version (focused):** point curve and R/G/B on the histogram's axis; the histogram behind the curve; hue-preserving colour by default with a single **Saturation** slider (Lightroom's Refine Saturation idea, Capture One's Luma-vs-RGB in one control); a TAT that shows the tone under the cursor on the curve before you click; clipping shown while dragging; numeric entry, keyboard and screen-reader control of points; a ghost of the curve before the drag; presets; and help text that says when to use Basic's sliders instead.
- **Later:** black/white/grey eyedroppers, "match a reference photo" and "match the camera's JPEG", an auto curve, a combined "what Basic is doing" ghost, curves in masks, and touch-specific behaviour for the mobile version (designed now, built later).
- **Elsewhere:** Hue-vs-Hue/Sat/Lum and Sat-vs-Sat curves belong in the **Colour** group, on darktable's colour equalizer and its new saturation curve, not in the tone curve.
- **No process-version change** is needed to add the tool: with no curve set, the stage is skipped and old edits render byte for byte as before (to be proven with an export-hash test like Part 10's). Any later change to the curve's maths needs a new process version.

## How this was researched (read first)

- **What could be read in full.** Only GitHub-hosted material: darktable's user manual source ([dtdocs](https://github.com/darktable-org/dtdocs)), darktable's source at commit `ca5a020` (2026-10-12, the copy already in the scratchpad), RawTherapee's source (`dev` branch), GIMP's help source, and a mirror of Blackmagic's DaVinci Resolve 12 manual, chapter 26 "Curves" ([ltbits/davinci-resolve-manuals](https://github.com/ltbits/davinci-resolve-manuals)). These are tagged **[read]**.
- **What could not.** WebFetch failed with DNS errors on every other site tried (docs.darktable.org, helpx.adobe.com, jkost.com, rawpedia.rawtherapee.com, arxiv.org, photoshopessentials.com, informit.com), and the proxy refused curl to them. ART's GitHub repository could not be read (its file paths returned 404).
- **Search-only evidence** is tagged **[search]**. It comes from the summaries the search tool wrote of the cited pages. Those summaries paraphrase; I quote only text I read in full. Check a [search] page before relying on its detail.
- **[memory]** marks things I remember but could not confirm in any source this session.
- **[LightBench idea]** marks proposals not seen in any surveyed tool.
- **[calc]** marks numbers I computed (script: `scratchpad/tc/s.py`, not committed).
- Thanks to the coordinator for the darktable source notes (pipe order, spline, presets, Lightroom import). Each one used here was re-checked in the source.

---

## 1. What each surveyed tool does well

### Lightroom Classic and Lightroom (the baseline)

- **Two curve kinds in one panel.** A Parametric curve with four region sliders (Highlights, Lights, Darks, Shadows) and movable split points under the graph, and a Point curve; R/G/B curves need Point mode. [search] ([jkost.com 2024](https://jkost.com/blog/2024/08/the-tone-curve-panel-in-lightroom-classic-2.html), [lifeafterphotoshop.com](https://lifeafterphotoshop.com/lightroom-tone-curves-explained-tone-curve-vs-point-curve-vs-target-curve/), [digital-photography-school.com](https://digital-photography-school.com/understand-lightroom-tone-curve/))
  - Point presets Linear / Medium Contrast / Strong Contrast: as stated in the owner's brief; no source loaded this session. [memory]
  - Lightroom's XMP fields exist as darktable reads them: `ParametricShadows/Darks/Lights/Highlights`, `ParametricShadowSplit/MidtoneSplit/HighlightSplit`, `ToneCurveName2012`, `ToneCurvePV2012` [read] (darktable `src/develop/lightroom.c` 582-610, 963). The R/G/B curves' fields exist too. [memory]
  - Point limit: sources disagree, 14 or 16 points. [search]
- **Targeted adjustment tool (TAT).** Click the round icon, then drag up or down on the photo. In Parametric mode this moves the region under the cursor; in Point mode it adds a point at that tone. [search] ([lightroomqueen.com](https://www.lightroomqueen.com/use-the-tat-tool/), [lifeafterphotoshop.com](https://www.lifeafterphotoshop.com/adjust-point-curve-in-lightroom))
  - **Arrow keys nudge without clicking:** hover over a tone in the photo and press ↑/↓; Shift takes bigger steps. [search] ([amateurphotographer.com](https://amateurphotographer.com/technique/lightroom-tips-tonal-curve/)) This is a small, very good idea.
  - Hovering a region slider shows which part of the curve it moves. [search] ([digital-photography-school.com](https://digital-photography-school.com/understand-lightroom-tone-curve/))
- **Refine Saturation (June 2023).** A slider under the Point curve, default 100 (the old behaviour). Lower values take back the saturation a contrast curve adds; 0 keeps the original colours. [search] ([Adobe, June 2023 feature summary](https://helpx.adobe.com/lightroom-classic/help/whats-new/2023-4.html), [Adobe Community](https://community.adobe.com/t5/lightroom-classic-discussions/confused-about-tone-curve-parametric-vs-point-curve/m-p/15238146/highlight/true)) Whether it also applies to the Parametric curve was not confirmed.
- **HDR mode.** With HDR editing on, the curve's scale runs 0-500 instead of 0-255, so the curve can shape tones above SDR white. [search] ([Adobe, HDR output](https://helpx.adobe.com/lightroom-classic/help/hdr-output.html)) Adobe holds a patent titled "Image adjustment using extended range curves" ([US8908966B2](https://patents.google.com/patent/US8908966)); its claims were not read.
- **How Lightroom treats colour.** Adobe's DNG reference code applies a curve to the largest and smallest of R, G, B and interpolates the middle one, which keeps HSV hue while saturation rises with contrast. RawTherapee ships this as its **Film-like** mode, with the comment "Tone curve according to Adobe's reference implementation" [read] (`rtengine/curves.h`, `AdobeToneCurve::RGBTone`, about line 2004), and RawPedia says Adobe designed it as part of DNG [search] ([RawPedia Exposure](https://rawpedia.rawtherapee.com/Exposure)). That Lightroom's own point curve uses exactly this is likely but not confirmed. [memory]
- **Mobile.** Drag the parametric curve up or down by region; double-tap a point to remove it; Adobe suggests watching the histogram while dragging. [search] ([Adobe, Lightroom mobile Curve](https://helpx.adobe.com/lightroom/mobile/adjust-light-and-color/adjust-tonal-range-using-curve.html)) No loupe for precise point dragging was found.

### Photoshop Curves

- **On-image adjustment tool:** click in the photo to add a point, drag up/down to move it. With the tool active, +/− (= key) select the next/previous point and the arrow keys nudge it (Shift for bigger steps); Input/Output fields take numbers and arrow keys. The tool has no default shortcut. [search] ([jkost.com 2019](https://jkost.com/blog/2019/10/working-with-the-curves-in-photoshop.html), [Adobe Community](https://community.adobe.com/t5/photoshop-ecosystem-discussions/command-click-on-image-does-not-add-sample-point-onto-adjustment-layer-curves-graph/m-p/14124324))
- **Show Clipping** marks pixels pushed to pure black or white while you drag the black/white point; Alt/Option-drag does the same; clipped areas are coloured by the channel that clips. [search] ([InformIT](https://informit.com/articles/article.aspx?p=697555), [photoshopessentials.com](https://www.photoshopessentials.com/?p=986))
- **Curve Display Options:** light (0-255) or pigment (%) units, grid density, and toggles for **Channel Overlays** (all channel curves drawn over the composite), **Histogram**, **Baseline** (the original diagonal stays visible) and **Intersection Line** (guides while dragging). [search] ([jkost.com 2019](https://jkost.com/blog/2019/10/working-with-the-curves-in-photoshop.html), [InformIT](https://informit.com/articles/article.aspx?p=697555))
- **Auto options:** Enhance Monochromatic Contrast (clip all channels alike), Enhance Per Channel Contrast, Find Dark & Light Colors, Enhance Brightness and Contrast (content-aware), plus Snap Neutral Midtones; target colours default to 0/128/255 and the clip amounts are adjustable. [search] ([astropix.com](https://astropix.com/books/PFA/BOOK/F_PS/F02/F020507/F020507.HTM), [andrewhaysom.myportfolio.com](https://andrewhaysom.myportfolio.com/curves-levels-auto-adjustments))
- **Black / grey / white eyedroppers** set points from the photo [memory]; the grey one adjusts R/G/B to neutralise the sample (as Pixelmator Pro's does, below).

### Capture One

- **Curve modes RGB, Luma, Red, Green, Blue.** The RGB curve changes saturation along with tone; the **Luma** curve changes tone without that saturation link, so practitioners use Luma for contrast and RGB as a "saturation by tonal range" control. [search] ([Fujifilm X stories](https://www.fujifilm-x.com/en-us/stories/fujifilm-capture-one-pro-adjustments/), [CreativeLive, David Grover](https://site.creativelive.com/class/quick-start-to-capture-one-david-grover/lessons/essential-tools-overview-exposure-and-curves))
- **Pick Curve Point** cursor tools (one for RGB, one for Luma): hovering the photo draws an orange vertical line on the curve at the tone under the cursor; clicking adds a point. Users ask for multi-point picking and for moving several points together ("Sorry but no"). [search] ([imagealchemist.net](https://imagealchemist.net/capture-one-curve-part-2/), [Capture One community](https://support.captureone.com/hc/fr/community/posts/360012445758-Pick-Curve-Point))
- **Levels:** input black/white handles plus separate *target* (output) handles; Pick Shadow/Highlight Level cursor tools; Auto Levels clips 0.1 % by default, adjustable in Preferences. [search] ([imagealchemist.net](https://imagealchemist.net/capture-one-levels-part-1/), [alexonraw.com](https://alexonraw.com/optimizing-the-contrast-with-levels/))

### DxO PhotoLab

- **Selective Tone** (Highlights, Midtones, Shadows, Blacks) works locally; the Tone Curve and Contrast don't. Users say Highlights and Shadows reach far into the midtones. [search] ([DxO forum](https://forum.dxo.com/t/understanding-selective-tone-control/9916/18), [tutkit.com](https://www.tutkit.com/en/text-tutorials/22542-effective-use-of-selective-tonal-values-in-dxo-photolab))
- **ClearView Plus** removes haze and adds local contrast. [search] ([DxO forum](https://forum.dxo.com/t/when-to-use-clearview-plus-vs-fine-contrast-and-its-sub-settings/38673))
- **The tone curve has a Gamma field** and no picker: a "Picker for curves" request has been open for years; DxO pointed to HSL and Selective Tone instead. [search] ([DxO forum](https://forum.dxo.com/t/picker-for-curves/14663))
- **"Tone curve should reflect what the selective tone sliders are doing"**: a user request to draw the sliders' effect on the curve as a teaching aid. Replies were mixed: one said a curve can't honestly show local tools. [search] ([DxO forum](https://forum.dxo.com/t/tone-curve-should-reflect-what-the-selective-tone-sliders-are-doing/35457)) This is exactly LightBench's "three tools fighting" question (§2.14).

### Affinity Photo

- **Picker:** drag up/down on the photo; the first click places a node at the clicked pixel's tone. Colour model menu GRAY / RGB / CMYK / LAB, a channel menu (Master by default, including alpha), and **X/Y fields** for exact node placement, which the help recommends for 32-bit linear work. [search] ([affinity.help, Curves](https://affinity.help/photo/en-US.lproj/pages/Adjustments/adjustment_curves.html))

### ON1 Photo RAW, Luminar, Apple Photos

- **ON1:** the Curves filter gained a dropper and a better grid in 2023.5; a Luminosity blend mode applies a curve to luminance only. [search] ([ON1 blog](https://on1.com/blog/on1-insider-a-sneak-peak-at-the-new-curves-filter-enhancements), [ON1 video](https://www.on1.com/videos/creative-uses-of-the-new-curves-filter-in-photo-raw/))
- **Luminar Neo:** the search found no AI-driven curve. Its AI tone tools are single sliders (Accent AI inside Enhance AI, 0-100, "up to 12 correction items"). Whether Neo has a plain Curves tool was not confirmed. [search] ([Skylum, Accent AI](https://skylum.com/jp/luminar/accent-ai))
- **Apple Photos (Mac):** Curves with black point / midtones / white point eyedroppers; drag the end handles for the range; adding points targets tones; moving a point left or right changes contrast. [search] ([Apple, Apply curves adjustments](https://support.apple.com/guide/photos/pht7875d6b19/mac)) **Pixelmator Pro** (Apple) has black / grey / white eyedroppers; the grey one uses the sample as a neutral reference and adjusts the R/G/B curves. [search] ([Apple, Pixelmator Pro curves](https://support.apple.com/guide/pixelmator-pro/pix0accab39b/macos))

### Mobile

- **Darkroom (iOS):** no points at all: the curve is split into five regions (Blacks, Shadows, Midtones, Highlights, Whites) and you drag up/down, or tap above/below the line, in a region. Reviewers call it very easy (2015-era reviews). Its RGB curve behaves "more like a luminance curve". [search] ([PetaPixel 2015](https://petapixel.com/2015/02/12/darkroom-ios-photo-editing-app-diy-filters-curves-infinite-history), [photojoseph.com](https://photojoseph.com/tips/2015/2/25/darkroom-ios-fun-editing-app-curves-and-saveable-presets), [darkroom.co blog](https://darkroom.co/blog/2015-06-curves-part-1-of-2))
- **VSCO:** its feature pages list HSL and a Tone tool (Highlights/Shadows sliders); no curve tool was found. Not confirmed absent. [search] ([VSCO Tone](https://www.vsco.co/features/tone), [VSCO HSL](https://vsco.co/features/hsl))
- **Halide Process Zero:** no-AI capture to RAW; a later version added a one-slider mode to "push" or "pull" highlights and shadows. No curve. [search] ([Lux, Process Zero](https://lux.camera/introducing-process-zero-for-iphone), [TechCrunch 2024](https://techcrunch.com/2024/08/14/camera-app-halides-latest-update-adds-an-option-for-zero-ai-image-processing))

### darktable

- **Two curve modules at two pipeline positions** [read] (`src/common/iop_order.c`, v5.0 order, lines 383, 388, 394): **rgb curve** at 42.0, *before* sigmoid (45.3); **tone curve** at 48.0, *after* it. (The display-referred "legacy" order puts rgb curve after sigmoid.) darktable's Lightroom importer maps Lightroom's curve to **tone curve**, i.e. the display side (`lightroom.c` 1468-1533). It reads only the master `ToneCurvePV2012`, and approximates a parametric curve with 6 nodes; if a point curve is present, the parametric sliders are ignored [read].
- **darktable's own warning** [read] ([color-pipeline.md](https://github.com/darktable-org/dtdocs/blob/master/content/special-topics/color-pipeline.md)): "Some modules (*levels*, *rgb levels*, *tone curve*, *rgb curve*) are inherently incompatible with a scene-referred workflow, because their graphical interface implicitly suggests RGB values that are bounded within the 0-100% range. While the pixel operations they perform can be used in either scene-referred or display-referred workflows because they are unbounded internally, their controlling interface does not allow pixels to be selected outside of the 0-100% range." The rgb curve page's technical box lists its input as "linear, RGB, display-referred" [read] ([rgb-curve.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/rgb-curve.md)).
- **rgb curve** [read] (`src/iop/rgbcurve.c`; [rgb-curve.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/rgb-curve.md)):
  - "RGB, linked channels" or "RGB, independent channels". Never master-plus-channels as Lightroom does.
  - Up to 20 nodes (`MAX_ANCHORS`); a 65,536-entry table with exponential extrapolation above the last node.
  - Two pickers. One shows the picked values on the graph (area mode with Ctrl+click). The other **creates nodes from a sampled area**: "Ctrl+click+drag to alter the created nodes to have a positive curve for the selected area; Shift+click+drag to create a negative curve."
  - "compensate middle gray" puts the graph on an L* scale (`iop_profile.h` 512-532). The manual says it changes only the display, not the processing.
  - Presets include "contrast | compression", "linear (gamma 1.0)", "contrast | medium (linear)" and "contrast | high (linear)" (`rgbcurve.c` 150-217).
  - Default `preserve_colors` = luminance.
- **tone curve** [read] ([tone-curve.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/tone-curve.md)): Lab linked/separated, XYZ linked, or RGB linked (ProPhoto). The graph always uses Lab, so "the middle-gray coordinate is always 50% in the graph"; a/b curves add tints or change saturation. Default `preserve_colors` = average RGB (`tonecurve.c` 111).
- **Shared curve controls** [read] ([curves.md](https://github.com/darktable-org/dtdocs/blob/master/content/darkroom/processing-modules/curves.md)):
  - Ctrl+click adds a node on the curve "without the risk of accidentally modifying the curve". Drag a node out of the widget to delete it.
  - Three interpolations. Cubic spline is "the most visually pleasing" but "can produce cusps and oscillations when the nodes are too close"; centripetal "will follow the nodes more loosely"; monotonic is "a good trade-off".
  - **scale for graph** (tone curve and base curve only): a logarithmic display so "nodes in lowlights get more space on the graph and can be controlled more precisely". It does not change the stored curve.
  - **preserve colors**: none / luminance / max RGB / average RGB / sum RGB / norm RGB / basic power (§2.2).
- **darktable's monotone spline can overshoot** [read]: `monotone_hermite_set` (`src/common/curve_tools.c` 393-450) limits the tangents (Fritsch-Carlson's τ > 9 step) but lacks the step that sets a tangent to 0 where the slope changes sign. So a non-monotone curve (a dip or a bump) can overshoot between nodes. Monotone curves are fine.
- **rgb levels** [read] ([rgb-levels.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/rgb-levels.md)): black / grey / white bars over a histogram, linked or per channel, three pickers, and **auto** from the whole image or a picked region; preserve colors applies when linked.
- **Tone equalizer's curve UI** [read] ([tone-equalizer.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/tone-equalizer.md)):
  - The x axis is the mask's brightness in **EV**, with the *mask's* histogram behind the graph.
  - A **curve smoothing** slider: past about 0.6 the curve can oscillate.
  - **On-image cursor**: hovering the photo shows the mask's EV under the cursor, an arc for how much that tone was changed, and inner/outer circles for before/after brightness. **The mouse wheel brightens or darkens that tone** directly.
  - LightBench's Highlights/Shadows/Whites/Blacks drive this module (PHASE3 Part 10).
- **Saturation curve, new in 2026** [read] (`src/iop/satcurvergb.c`, "remap saturation and brilliance with curves", search aliases "sat vs sat"): Resolve's Sat-vs-Sat in darktable UCS or JzAzBz, with a saturation picker and optional guided-filter modulation. It goes with the Colour group, not the tone curve.

### RawTherapee and ART

- **Curve types** [read] (RawTherapee UI strings, `rtdata/languages/default`): Linear, **Standard** (spline points), **Flexible** (Catmull-Rom), **Parametric**, **Control cage** (NURBS), plus "Equalizer" for some tools. Node in/out values can be typed ("Enable edition of node in/out values"). Curves can be saved, loaded, copied and pasted.
  - On Hacker News, one commenter calls curve handling in the open-source editors "absolutely catastrophically bad"; another answers that control cage curves allow node values to 1/1000 (REVIEWS_ROUND2.md).
- **Six curve modes, two curves in series** [read] (`rtengine/curves.h`, `improcfun.cc`):
  - **Standard**: per channel (hue shifts).
  - **Weighted Standard**: the curve applied through each channel in turn, results blended 50/25/25 to soften the shifts.
  - **Film-like**: Adobe's hue-preserving method (above).
  - **Saturation and Value Blending**: "apply the curve on the saturation and value channels". Users find it the least vivid. [search] ([discuss.pixls.us](https://discuss.pixls.us/t/the-long-question-about-tone-curves-in-rawtherapee/38714), [scribble-jpc blog 2012](http://scribble-jpc.blogspot.com/2012/09/in-search-of-perfect-color-new-tone.html))
  - **Luminance**: Rec.709 Y scaled by curve(Y)/Y.
  - **Perceptual**: the source comment states its aim [read]: "Tone curve whose purpose is to keep the color appearance constant, that is the curve changes contrast but colors appears to have the same hue and saturation as before. As contrast and saturation is tightly coupled in human vision saturation is modulated based on the curve's contrast, and that way the appearance can be kept perceptually constant (within limits)." It uses CIECAM02 [search] ([RawPedia Toolchain](https://rawpedia.rawtherapee.com/Toolchain_Pipeline)); one user finds it too saturated [search].
- **Auto-Matched Tone Curve**: builds a curve from the camera's embedded JPEG. It is praised ("a brilliant addition"), with weak spots on heavily cropped or distorted JPEGs and some Fuji files (REVIEWS_OPEN_SOURCE.md §2.1; REVIEWS_ROUND2.md).
- **ART**: tone curves act on R, G, B together; the histogram behind the curve shows the data **as it enters that point in the pipeline**, unlike the main histogram. [search] ([ART Reference](https://art.pixls.us/Reference)) Its developer added a **Neutral** mode because he wasn't happy with the others, keeping them for compatibility; users find Neutral much less saturated, better for portraits. [search] ([discuss.pixls.us, Tone Curves Mode](https://discuss.pixls.us/t/tone-curves-mode/51606)) What Neutral computes was not confirmed.

### GIMP and Krita

- **GIMP Curves** [read] ([gimp-help `curves.xml`](https://github.com/GNOME/gimp-help/blob/master/src/menus/colors/curves.xml)):
  - **X axis as Linear, Non-Linear or Perceptual**, chosen by three buttons ("whether the tone reproduction (TRC) will be displayed using a linear, non-linear, or perceptual X axis"), plus a linear or logarithmic histogram.
  - Ctrl-click outside the curve adds a point whose "Y-coordinate snaps to the original curve". Left/Right arrows switch points; Up/Down move the active point (Shift: 15-pixel steps). Ctrl+drag slides a point along the curve.
  - Clicking the canvas draws a vertical line on the graph at that pixel's value; Shift-click adds a point in the selected channel and Ctrl-click in all channels.
  - Input/Output spin buttons; **Smooth or Corner** points per point; a **Free Hand** curve type you can then smooth.
- **Krita**: Color Adjustment Curves (Ctrl+M) on all channels, one channel, lightness or alpha. A separate **Cross-channel** curves filter adjusts one property against another. [search] ([krita-artists.org](https://krita-artists.org/t/find-menus-for-brightness-contrast-hue-saturation-lightness/80441), [krita-artists.org](https://krita-artists.org/t/color-adjustment-curve-python-api/169093)) The Krita manual page did not load.

### DaVinci Resolve, Baselight, Nuke

- **Resolve Custom curves** [read] (Resolve 12 manual, ch. 26):
  - Y, R, G, B in one editor, shown as overlaid curves; "ganged" by default.
  - Holding Option: "Snapping a curve’s control point back to its neutral position by holding down the Option key" (figure caption). Right-click removes a point.
  - Per-curve **Intensity** sliders (0-100) blend each curve with the original image: "an easy way to 'split the difference'".
  - Optional Bezier handles. A warning that sharp curves or close points cause "contouring … flattening or solarization".
  - Unganged, "the Luma curve allows you to adjust the Y channel by itself … increasing luma contrast results in a perceptual decrease of image saturation."
  - **Soft Clip**: high/low soft-clip knees, ganged or per channel.
  - Six rotary knobs on the control panel map to fixed points at 0/20/40/60/80/100 % luminance.
- **Resolve Lum Mix** (later versions): balances YRGB contrast changes against Y-only changes; at 100 (default) both count equally, at 0 Y-only changes are off. [search] ([Blackmagic forum quoting the manual](https://forum.blackmagicdesign.com/viewtopic.php?f=36&t=129458))
- **Resolve Hue/Sat curves** [read]: Hue vs Hue, Hue vs Sat, Hue vs Lum, Lum vs Sat (Sat vs Sat in later versions [search]). **Click or drag on the Viewer** to sample a range; three control points are placed automatically around it. They have Bezier mode and number fields for the selected point. Later versions show a histogram of the two channels each curve acts on. [search] ([Resolve 18 manual excerpt](https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part2760.htm)) Custom curves lacked numeric fields in 2018 (forum wish); whether they have them now was not confirmed. [search] ([Blackmagic forum](https://forum.blackmagicdesign.com/viewtopic.php?p=402934))
- **"Edit points by node"**: I found nothing under this name. Resolve's grade is built from nodes, and curves live per node, which may be what the brief means. [memory]
- **Baselight Base Grade**: grading in **stops** with four zones (dark/dim/light/bright, or "very low … very high"), each with a pivot and falloff, and a Flare control for the black floor. It is meant to replace Lift/Gamma/Gain, which break scene linearity. [search] ([digitalproduction.com](https://digitalproduction.com/2017/04/01/basegrade-and-the-evolution-of-colour-grading/), [AFC report](https://www.afcinema.com/Detailled-Report-of-our-Visit-to-FilmLight.html?lang=fr), [FilmLight press release](https://www.filmlight.ltd.uk/store/press_releases/filmlight-releases-baselight-5-0-ahead-of-ibc2017/)) That is the same idea as LightBench's tone-equalizer sliders.
- **Nuke ColorLookup** (and Natron's port): per-channel curves with a **Source / Target** colour pair; "Set RGB" adds points so that the source maps to the target. That is curve-from-reference for one colour. Its Range should be widened for values above 1. [search] ([Natron docs](https://natron.readthedocs.io/en/v2.4.2/plugins/net.sf.openfx.ColorLookupPlugin.html), [Foundry](https://learn.foundry.com/nuke/17.0/content/comp_environment/color_correction/making_tonal_adjustments.html))

### Research

- **MIT-Adobe FiveK** (Bychkovsky, Paris, Chan, Durand, CVPR 2011): 5,000 raw photos, each retouched by 5 photographers; tonal adjustment learned per user; "difference learning" predicts how one user differs from another. [search] ([project page](https://people.csail.mit.edu/vladb/photoadjust), [Adobe Research](https://research.adobe.com/publication/learning-photographic-global-tonal-adjustment-with-a-database-of-input-output-image-pairs))
- **Personalisation**: Kang, Kapoor, Lischinski, CVPR 2010: user studies show people differ in enhancement preferences, and a model learnt from a user's choices on a training set does better than a generic one. Follow-up: Caicedo, Kapoor, Kang, CVPR 2011 (collaborative). [search] ([PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/PersonalizedEnhancement-CVPR2010.pdf))
- **Simple tone curves** (Bennett and Finlayson, UEA, 2023-2026) [search] ([Visual Computer 2026](https://link.springer.com/article/10.1007/s00371-026-04505-y), [UEA](https://research-portal.uea.ac.uk/en/publications/simple-tone-curves-theory-and-applications/), [Even Simpler Tone Curves, LIM 2024](https://ueaeprints.uea.ac.uk/95894/1/LIM_2024_Even_Simpler_Tone_Curves_camready.pdf)):
  - Curves with **at most one inflection point** approximate all 25,000 FiveK expert edits well and give equally good results by objective measures.
  - In preference tests they were slightly preferred to the complex originals. A small 2025 study (8 observers) found no significant difference, with log-domain simple curves "marginally favoured".
  - A smoothness limit avoids banding.
  - This is the strongest evidence for making smooth S-and-fade shapes easy and wiggly curves hard.
- **Colour after contrast changes**: Mantiuk, Mantiuk, Tomaszewska, Heidrich, "Color correction for tone mapping", Eurographics 2009 [search] ([PDF](https://www.cl.cam.ac.uk/~rkm38/pdfs/mantiuk09cctm.pdf)):
  - Appearance-matching experiments show that a contrast change needs a **non-linear** saturation correction, smaller for small changes.
  - Changing luminance only over-saturates; changing all RGB channels under-saturates.
  - This is the science behind Refine Saturation, Capture One's Luma/RGB and RawTherapee's Perceptual mode.
- **Local vs global**: Bae, Paris, Durand, "Two-scale tone management for photographic look", SIGGRAPH 2006. It splits a photo into a base layer (large-scale tone) and a detail layer (texture), and can transfer a **model photo's** look to another photo. MIT lists a granted patent, US 8,081,838; its claims were not read. [search] ([project](https://people.csail.mit.edu/soonmin/photolook), [MIT TLO](https://tlo.mit.edu/industry-entrepreneurs/available-technologies/two-scale-tone-management-photographic-look))
- **Auto curves**: Ward Larson, Rushmeier, Piatko, "A visibility matching tone reproduction operator", IEEE TVCG 1997: histogram adjustment, i.e. a curve from the histogram, with limits from human contrast sensitivity. [search] ([PDF](https://graphics.cs.yale.edu/sites/default/files/1997tvcg_hdr_tonemapping.pdf)) The commonly cited "ceiling" that stops histogram equalisation from exaggerating contrast was not confirmed in the excerpt. [memory]
- **Learned curves**: CURL (Moran, McDonagh, Slabaugh, ICPR 2020) predicts Photoshop-like curves in HSV, Lab and RGB. [search] ([arXiv 1911.13175](https://arxiv.org/abs/1911.13175)) Learned models are Phase 4 material and subject to the permissive-licence rule ([AI_MODELS.md](AI_MODELS.md)).
- **Slider-based optimisation**: Koyama et al., "Sequential line search", SIGGRAPH 2017: one-slider tasks find good photo enhancements. [search] ([project](https://koyama.xyz/project/sequential_line_search/)) This relates to Halide's one-slider idea and to Auto's strength slider.
- **No user study comparing curve and slider interfaces for novices was found.** A US patent describes the free curve as the most complex control, "suitable for experts" ([US 6614456](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6614456)) [search]. That is a design assumption, not data.

---

## 2. Candidate improvements for LightBench

Each entry gives what it is and why, where it comes from, **effort** (S = days, M = 1-2 weeks, L = more), **risks**, and **edits** (process version / effect on existing edits).

### 2.0 The pipeline position (decide first)

LightBench's display shader runs (`develop-display.wgsl`):

> scene-linear Rec.2020 → exposure → tone equalizer (Highlights/Shadows/Whites/Blacks) → vibrance/saturation → sigmoid (Contrast) → output profile

The histogram bins **display-encoded sRGB values after all of this** (`develop-engine.ts`, `ImageStats`). A curve can go in one of three ways:

| | A. Scene-referred, before Contrast | B. Display-referred, after Contrast | C. Drawn on the display axis, applied before Contrast |
|---|---|---|---|
| Example | darktable rgb curve (42.0, before sigmoid 45.3) | darktable tone curve (48.0); where darktable's importer puts Lightroom's curve | LightBench idea, not seen elsewhere |
| What the x axis means | A scene value. It can't be the histogram's axis (that is after Contrast); a second, scene histogram is needed. Values above 1.0 (common: the +0.7 EV base, bright skies) are off the right edge and only extrapolated. | The tone on screen: exactly the main histogram's axis. 0 and 1 are display black and white. | Same as B. |
| Moving Contrast or Exposure | Changes what the curve does on screen, because the curve's output is reshaped by the sigmoid afterwards. | The curve keeps its on-screen meaning. | The curve keeps its on-screen meaning. |
| Clipping | The curve can't clip: the sigmoid rolls off whatever it outputs. | The curve can push tones to pure black/white, as in Lightroom. Needs clipping feedback (§2.5). | Only where the user drags the curve to an end. |
| Colour | The sigmoid's hue preservation and gamut handling act after the curve. | The curve's colour mode must do this itself (§2.2). | The curve scales a colour-preserving brightness measure; the sigmoid still handles hue and gamut. |
| Lightroom presets and sidecars | Don't transfer. | Transfer closely (darktable does this). | Transfer closely on neutral tones; saturated colours need measuring. |
| Future HDR output | Works unchanged. | Tied to SDR white; needs its own answer (Lightroom extends its curve to 0-500 in HDR mode). | Partly: defined relative to the SDR rendering. |
| Effort | M | M | M-L: the maths is short, but checking it against B is the work. |

**How C works.** Take n, the pixel's colour-preserving brightness (§2.2), and S, the sigmoid's tone curve at the current Contrast. The gain is g = S⁻¹(C(S(n))) / n, applied to all three channels before the sigmoid. On neutral greys the result on screen equals B exactly. The curve's output must stay inside the sigmoid's target black and white. Because the shipped sigmoid mixes channels to preserve hue (`preserveHue` in the shader; darktable's `_preserve_hue_and_energy`), saturated colours will differ somewhat from B. Per-channel R/G/B curves would need the same treatment per channel, which is only approximately right with that mixing. Not built or measured anywhere.

**Recommendation.** The user should always draw on the histogram's axis (B or C). A breaks the one thing a curve must do, which is to move the tone you see where you drag it. Between B and C: B is simple, is what Lightroom users expect, and darktable itself puts imported Lightroom curves there. C keeps darktable's "nothing clips before the display transform" property. Suggested path: build **B** first, behind the same parameters C would use, and try C as an engine experiment measured against B. darktable's warning quoted in §1 is about the *interface* suggesting 0-100 % bounds on scene data. B and C both give the curve's graph a real 0-100 % meaning, the display range, so they answer that warning rather than ignore it. **Owner decision (question 1).**

### 2.1 Curve axis matched to the histogram (perceptual scale)

- **What:** the graph's x and y axes use the same encoding as the main histogram (display-encoded sRGB, so 18 % grey sits at about 46 %), with a tick at middle grey and a readout of the tone under the pointer in % (and optionally L*).
  - The histogram behind the graph is the curve's **input** (as ART does); the main histogram still shows the output.
  - Why: dragging at the histogram's peak moves exactly those pixels. Lightroom users get the feel they know. darktable's tone curve shows a Lab graph whatever the processing space ("middle-gray … always 50%"), and its rgb curve offers an L* option; GIMP offers linear / non-linear / perceptual axes.
- **Alternatives:** an EV axis (like the tone equalizer and Base Grade) gives the shadows more room. darktable's "scale for graph" does this as a display-only log. The simple-curve study found log-domain curves marginally preferred. Not for v1: one axis, the histogram's, avoids a choice nobody can make well. A log view could come later as a graph option that changes the display only.
- **Source:** GIMP, darktable, ART, Lightroom. **Effort:** S once §2.0 is decided (the input histogram is one extra stats pass with the curve bypassed, or computed in the same pass). **Risks:** sRGB encoding vs P3 display: the axis must stay sRGB-encoded so the stored curve doesn't depend on the monitor. **Edits:** none.

### 2.2 Colour-preserving modes (darktable's norms) and the default

**The practical difference.** A contrast curve applied to R, G and B separately ("none") moves the brightest channel and the darkest channel by different amounts. Hues drift and saturation jumps. Applying it to one brightness number and scaling all three channels by the same factor (the "preserve colors" norms) keeps the hue exactly. The norms differ in *which* brightness they measure, which decides where a colour lands on the curve.

Worked example [calc]. A moderate S-curve, y = x^1.6 / (x^1.6 + (1 − x)^1.6), applied to sRGB-encoded values (the ratio modes measure the norm in linear sRGB, put it through the curve in encoded form and scale linear RGB). Results in OkLCh (L lightness, C chroma, h hue angle). It illustrates the modes; LightBench's numbers will differ with its working space and curve.

| Colour | Original | Per channel ("none") | Adobe / Film-like | Luminance | Max RGB | Basic power |
|---|---|---|---|---|---|---|
| Skin / orange | C 0.107, h 47° | C **0.135**, h **52°** (toward yellow) | C 0.140, h 46° | C 0.116, h 47° | C 0.116, h 47° | C 0.117, h 47° |
| Sky blue | C 0.128, h 258° | C 0.158, h **254°** | C 0.169, h 259° | C 0.133, h 258° | C 0.138, h 258° | C 0.140 |
| Dark red | L 0.374 | L 0.339 | L 0.341 | L **0.264** (crushed) | L 0.356 | L 0.356 |
| Bright yellow | max channel 0.89 | 0.98 | 0.98 | **1.12** (out of range) | 0.98 | 1.04 |

What the table shows:
- **Per channel:** hue shifts of up to 7° (orange toward yellow, sky toward cyan) and 8-26 % more chroma.
- **Adobe's method:** keeps hue within about 2° and adds about as much chroma, or more (+31 % on the orange). That is Lightroom's "punch", and what Refine Saturation then takes back.
- **The ratio modes:** keep hue exactly; chroma rises only a little (4-9 %) where the colour gets brighter.
  - **Luminance** reads reds and blues as dark (low Y), so they fall into the curve's shadow part and get crushed. darktable's filmic manual says the same: it "darkens reds … and behaves poorly with saturated or out-of-gamut blues" [read].
  - **Luminance, average and norm** can push the largest channel past 1 (clipping) after Contrast. Before Contrast (option A/C) the sigmoid absorbs this.
  - **Max RGB** never overflows. It "tends to darken blues, especially skies" [read].
  - **Power** is "usually a good compromise" [read].
- **A darktable pitfall:** its "sum" and "norm" estimators read a neutral grey 3× and √3× (+1.58 and +0.79 EV) brighter than it is [read] (`rgb_norms.h`), so grey tones don't sit where the histogram shows them. **LightBench should normalise every estimator so that a neutral grey reads its own value** [LightBench idea].

**Proposal.**
- **Default:** hue-preserving with Lightroom-like saturation (Adobe/Film-like in B; max-RGB/power-norm ratio in C), plus one **Saturation** slider under the curve (§2.3).
- **Advanced ▸:** offers "Per channel (classic RGB)" and darktable's estimators by plain names ("brightness measured as: luminance / largest channel / average / power (balanced)"), normalised.
- Why not darktable's default (luminance)? It crushes saturated reds and blues as shown, and new users will read that as a bug.
- **Source:** darktable, RawTherapee, Lightroom. **Effort:** S per mode (shader: one norm, one table lookup, one multiply).
- **Risks:** seven estimators is jargon; keep them under Advanced with one-line help each. The Adobe method's patent status was not checked (it is published in Adobe's DNG SDK and shipped in GPL RawTherapee).
- **Edits:** the default is a new tool's default, so no process version. Changing it after release would need one.

### 2.3 Luma vs RGB (Capture One), luma mix (Resolve), Refine Saturation (Lightroom): one slider

- **What:** a single **Saturation** slider under the curve, 0-100 %. At 0 the curve changes brightness only: colours keep their saturation (Capture One's Luma, Resolve's Y-only, Lightroom's Refine Saturation 0). At 100 % saturation follows contrast as in Lightroom and Capture One's RGB mode. In between it blends. Default 100 %, so Lightroom presets and habits look right.
  - Hue is preserved at every setting (§2.2), which none of the three originals guarantees.
  - Why: one control replaces a mode switch (Capture One), a mix knob (Resolve) and a slider (Lightroom). Each of those apps' users recognises it.
  - A later refinement: Mantiuk et al. show the saturation needed to keep the appearance constant is non-linear, so "100 %" could follow their correction instead of plain RGB. RawTherapee's Perceptual mode aims at this. That needs a process version if changed after release.
- **Source:** Capture One, Resolve, Lightroom, Mantiuk 2009. **Effort:** S. **Risks:** the name. "Saturation" collides with Basic's Saturation slider; alternatives are "Colour with contrast" or Lightroom's "Refine Saturation". The owner should choose (question 4). **Edits:** none.

### 2.4 Hue-vs and Sat-vs curves: in the Colour group, not here

- Resolve's Hue vs Hue / Sat / Lum, Lum vs Sat and Sat vs Sat curves are colour tools. darktable already has their engines:
  - the **colour equalizer**: 8 hue nodes for hue, saturation and brightness ([DARKTABLE_MODULES.md](../DARKTABLE_MODULES.md); LightBench's planned HSL/Colour Mixer);
  - **colour zones**: LCh curves selected by hue, chroma or lightness;
  - **colour balance rgb**: saturation by luminance;
  - the new **saturation curve**: Sat vs Sat.
- **Proposal:** the Colour group's HSL tool gets a **curve view** of the same parameters (Hue vs Hue/Sat/Lum, as Resolve draws them) with Resolve's "click or drag on the photo places three points around that colour". Lum vs Sat and Sat vs Sat go in the Colour group's Advanced. The tone curve stays about tone.
- **Why:** one obvious place per task (USABILITY lesson 1). Lightroom has no hue curves and Capture One keeps them in its colour editor; Resolve is the exception and is a grading tool.
- **Effort:** M (with the Colour group). **Risks:** none for the tone curve. **Edits:** none here.

### 2.5 Clipping preview while dragging

- **What:** while an end point (or any point within a few % of the top or bottom) is dragged, show LightBench's **J** overlay on the photo for the duration of the drag only, and shade the flat parts of the curve that map to pure black or white in red/blue on the graph. Alt-drag forces it on for any point.
  - Why: a display-side curve (B) can clip, and the user sees where at once. Photoshop's Show Clipping and Lightroom's Alt-drag on Whites/Blacks are the precedent; LightBench already has J and its clipping modes.
- **Source:** Photoshop, Lightroom. **Effort:** S (the overlay exists). **Risks:** flashing overlays are distracting; make it a setting (on by default) and use the histogram menu's chosen clipping mode. **Edits:** none.

### 2.6 Black, white and grey point eyedroppers

- **What:**
  - **Black / white:** click a pixel to make it the curve's darkest/brightest *input* (as in Apple Photos, Photoshop, Capture One Levels and darktable rgb levels), with a target slightly inside the range rather than exactly 0/1 (Photoshop's target colours; darktable's sigmoid target black is 0.0152 %), so they don't hard-clip.
  - **Grey:** in a scene-referred pipeline, colour casts belong to white balance. The grey eyedropper should **hand over to LightBench's white-balance picker (W)** with a note, rather than bend the R/G/B curves as Photoshop and Pixelmator do. A "neutralise shadows only / highlights only" variant for mixed light could be an R/G/B-curve option later.
- **Why later:** in LightBench, Whites/Blacks (tone equalizer) and Auto already set the range, so v1 would have two ways to do one job (lesson 1).
- **Source:** Apple Photos, Photoshop, Pixelmator Pro, Capture One, darktable. **Effort:** S-M. **Risks:** overlaps Whites/Blacks; the grey picker's behaviour differs from Photoshop's (state it in the tooltip). **Edits:** none.

### 2.7 TAT improvements

- **Hover before you click** (Capture One's orange line, GIMP's vertical line, the tone equalizer's cursor):
  - With the TAT on, hovering the photo draws a marker on the curve at that pixel's tone (measured with the same estimator the curve uses), plus the value.
  - With the curve panel open but the TAT off, show a faint marker too. This costs one pixel read-back per pointer move, as the white-balance loupe already does.
- **Arrow keys while hovering** (Lightroom): ↑/↓ move the tone under the cursor without clicking; Shift for ×10, as LightBench's sliders do (`sliderKeys.ts`).
- **Mouse wheel** over the photo nudges the tone under the cursor (the tone equalizer's cursor control). darktable makes this work alongside panning with a held key ('a'); LightBench must not steal the wheel from zoom, so only with the TAT on.
- **Drag sensitivity:** a fixed scale in screen pixels (e.g. 200 px of drag = 50 % output), independent of photo zoom; Shift for fine. **[LightBench idea]: soft limits.** The TAT never moves a point past its neighbours' outputs, so a TAT drag can't fold the curve over (keeps curves "simple", §1 research).
- **Region-aware TAT in point mode** [LightBench idea]: the first TAT click adds the point *plus* two quiet anchors at ±1/8 of the range if no point is near. The drag then moves that tone band without disturbing the rest. This is Resolve's "lock off" advice done automatically, and the main reason people want point locking (§2.10).
- **Multi-pick** (Capture One wish; darktable's "nodes from a sampled area"): Shift-drag a rectangle on the photo to add points at its darkest and brightest tones.
- **Source:** Lightroom, Capture One, GIMP, darktable, Photoshop. **Effort:** S-M. **Risks:** the hover marker must not slow down Develop's redraw (read back asynchronously, throttle to animation frames). **Edits:** none.

### 2.8 Before/after ghost, baseline and channel overlays

- **What:**
  - Always draw the diagonal **baseline** (Photoshop).
  - While dragging, draw a **ghost of the curve as it was when the drag began**; with a modifier, as it was when the panel opened or at the last history step [LightBench idea, extending Photoshop's baseline].
  - In the master view, draw the R/G/B curves faintly in their colours (Photoshop's Channel Overlays; Resolve draws YRGB overlaid).
  - The main before/after (\\) also covers the curve's effect.
- **Source:** Photoshop, Resolve. **Effort:** S. **Risks:** visual clutter; keep the ghost thin and grey. **Edits:** none.

### 2.9 Numeric entry and snapping

- **Numeric:** Input/Output fields for the selected point, in the axis's % with one decimal (GIMP, Photoshop, Affinity, RawTherapee to 1/1000). Arrow keys in the fields nudge.
- **Snapping:**
  - Ctrl-click adds a point on the curve without moving it (darktable, GIMP).
  - Holding Alt while dragging snaps a point back to the diagonal (Resolve's Option).
  - Gentle magnetic snap to the diagonal and to the 25/50/75 % grid lines within a few pixels; a modifier turns it off.
  - **[LightBench idea]:** snap x to the histogram's peaks or to the TAT-picked tones.
- **Source:** GIMP, Photoshop, Affinity, RawTherapee, darktable, Resolve. **Effort:** S. **Risks:** snapping that fights the user; keep it weak and visible (the point shows when it is snapped). **Edits:** none.

### 2.10 Per-point locking and curve smoothness / tension

- **Locking:** no surveyed tool has a lock toggle that I could confirm. Resolve tells users to add extra points to "lock off" parts of the curve. With a well-behaved interpolation a point never moves by itself. What users fear is the curve *between* points bulging. So the fix is the interpolation plus the automatic anchors of §2.7, not a lock toggle. **Later or never.**
- **Interpolation:** one, monotone cubic, *with* Fritsch-Carlson's zero-tangent step at local extremes, so even curves with a dip or bump never overshoot (darktable's version lacks the step, §1). darktable's "cubic" (overshoots) and "centripetal" (loose) need not be offered.
- **Tension slider:** not in v1. darktable's tone equalizer needs one only because its graph is a fit through Gaussians that can oscillate. GIMP's per-point **Corner** type (a sharp knee) is the one variant worth adding later, for fades and hard clips.
- **Source:** darktable, GIMP, Resolve, Bennett and Finlayson (smoothness avoids banding). **Effort:** S. **Risks:** a curve imported from a darktable XMP with "cubic spline" would look slightly different; map it, and say so in the import note. **Edits:** none for new curves.

### 2.11 Presets library

- **What:**
  - Built-ins: Linear, Medium contrast, Strong contrast (Lightroom), plus **Matte / fade** (lifted blacks), **Low contrast** (darktable's "contrast | compression") and **Cross-process**-style R/G/B looks.
  - User presets through LightBench's existing preset system and paste dialog; copy/paste of a single curve or channel (RawTherapee's copy/paste/save/load; Resolve's "Copy to Red/Green/Blue").
  - **[LightBench idea]: hover previews** on the photo and a tiny curve icon on each preset.
- **Effort:** S. **Risks:** Lightroom's preset values are Adobe's; LightBench's own shapes must be original (darktable's are GPL and may be used with credit). **Edits:** none.

### 2.12 Match a reference photo, and match the camera's JPEG

- **What:**
  1. **Match camera look:** build a curve so the RAW's tones match its embedded JPEG (RawTherapee/ART Auto-Matched Tone Curve, praised in both review rounds). LightBench already decodes embedded JPEGs for thumbnails.
  2. **Match a reference photo:** histogram matching of the brightness measure between this photo (after Basic) and a chosen photo, fitted to a *simple* curve (≤ 1 inflection; Bennett and Finlayson) so it stays editable.
  - Both produce ordinary points the user can edit (lesson 7: Auto is a start).
  - LightBench's Auto already has "match a reference photo" for Basic sliders (PLAN Part 2b). The curve version would be offered *after* Auto, for what Auto's sliders can't reach.
- **Source:** RawTherapee/ART; Nuke's Source/Target for one colour; Bae et al. for the local version. **Effort:** M each.
- **Risks:**
  - Camera JPEGs are cropped or lens-corrected differently (RawTherapee's known weak spots), so registration is needed.
  - Matching tonality globally can't match local contrast (Bae et al.); the two-scale method has a granted patent whose claims were not read.
  - The match depends on Basic's settings at the time; changing Contrast afterwards breaks it. Show "matched at Contrast +20" in the history step.
- **Edits:** none (new points).

### 2.13 Auto curve from the histogram

- **What:** a curve proposed from the histogram: Photoshop's Monochromatic Contrast or Find Dark & Light, or a contrast-limited histogram equalisation in the spirit of Ward Larson et al. Shown as editable points.
- **Why not v1:** LightBench's Auto already moves Exposure, Contrast and Whites/Blacks to a target look. An auto curve on top would fight it (§2.14). If built, it should be **constrained to simple shapes** (the research), have a **strength slider** (the owner's Auto decision) and run per photo in batches.
- **Effort:** M. **Risks:** a third "Auto" (Basic, curve, levels) is confusing; it could live as an Auto option ("Auto may also set a curve") instead of a button in the curve. **Edits:** none.

### 2.14 Keeping Contrast, Highlights/Shadows and the curve from fighting

This is the main usability risk of adding a curve to LightBench: Basic already has a curve-like tool (Contrast = the sigmoid's slope at middle grey) and a local tone tool (the tone equalizer).

**Guidance in the interface** (the owner's hint and tooltip rules):
- **Contrast** (Basic): "Use for overall punch. It never clips and keeps middle grey where it is."
- **Highlights / Shadows / Whites / Blacks** (Basic): "Use to recover or open up areas. They work by area and keep texture (local contrast)."
- **Tone curve** hint: "Shape the look: fades, matte blacks, colour by tone". Tooltip pitfall in amber: "Lifting shadows with the curve flattens texture. Use Shadows first. Steep curves can clip; watch for red/blue on the graph." Engine: "darktable rgb curve" (or "tone curve", per §2.0).

**Show what Basic did, honestly** [LightBench idea, from the DxO request]:
- Under the curve, a dotted line can show the **global part** of Basic: Exposure and Contrast exactly, the tone equalizer drawn as a *band* (its effect varies by area).
- On by default only while the panel's help is shown. The DxO thread's objection (local tools can't be drawn as a curve) is met by drawing a band and labelling it "approximate".

**Order of operations in help:** Basic first, curve last, as in Lightroom tutorials ([amateurphotographer.com](https://amateurphotographer.com/technique/lightroom-tips-tonal-curve/) [search]: set Whites and Blacks before the curve).

**Avoid double controls:**
- Whether to keep the **parametric** curve's four regions (they overlap Basic's four tone sliders by name) is question 2.
- If kept, rename its sliders so they can't be mistaken for Basic's: e.g. "Curve: Highlights" in a "Regions" view, with a tooltip saying "global, no texture protection".

**Effort:** S (texts), M (the Basic ghost). **Risks:** the ghost could mislead if not labelled. **Edits:** none.

### 2.15 Parametric ("Regions") curve

- **What:** Lightroom's four regions with three movable splits, drawn on the same graph, combined with the point curve. Dragging *on the graph* in this mode moves the region under the pointer (Lightroom, Darkroom).
- **Why keep it:** it is the curve for people who don't want points: sliders are keyboard- and touch-friendly, it can't make wiggles, and Lightroom sidecars use it. **Why it hurts:** a second set of Highlights/Shadows-like sliders (§2.14).
- **Source:** Lightroom, Darkroom (5 regions, no points), Resolve's six fixed luminance knobs. **Effort:** M. Lightroom's region formula isn't public, so LightBench designs its own (smooth bumps between splits, in the axis's encoding). Lightroom import would then be approximate, like darktable's 6-node conversion.
- **Risks:** confusion with Basic. **Edits:** none. **Owner decision (question 2).**

### 2.16 Accessibility and keyboard control of points

- **What:**
  - Each point is focusable (`role="slider"`-like, with `aria-valuetext` "input 25 %, output 31 %").
  - Tab / Shift+Tab or +/− select the next/previous point (Photoshop, GIMP's ←/→). Arrow keys move it by 1/200 of the range, Shift ×10, Alt ×1/10 (LightBench's slider convention plus a fine step).
  - Delete removes it; Insert or Enter adds a point at the focused x; Home resets the curve (as Home resets a slider).
  - Every action is reachable without a mouse: the owner's "every core action reachable by keyboard" decision (USABILITY, R2 17).
  - Live region announcements on change.
  - Colour is never the only cue: channels are also labelled and use dashed styles for R/G/B.
- **Effort:** S-M. **Risks:** keyboard focus fighting the photo's shortcuts; reuse `isTextEntry`-style guards. **Edits:** none.

### 2.17 Mobile and touch (design now, build later)

- **What:**
  - Points have 44 px touch targets.
  - **Offset dragging:** the point moves relative to the finger, so the finger never covers it.
  - A magnifier while dragging.
  - Double-tap a point to remove it (Lightroom mobile).
  - On narrow screens the default mode is **Regions** (Darkroom's no-point drag, §2.15) with Point as an option.
  - The TAT is natural on touch (drag up/down on the photo), but needs a "hold to pick" so ordinary pans still work.
  - A one-slider **Fade/Punch** (Halide's push/pull idea) could be the phone's first line.
- **Why now:** parameter and interaction choices made for v1 (e.g. Regions as a first-class mode, point limits, numeric fields) decide whether the phone UI is possible later.
- **Effort:** M (later). **Risks:** two interaction models; keep the stored curve identical. **Edits:** none.

### 2.18 Further ideas

- **Curves in masks** (Capture One layers; Lightroom's masks have no curve [memory]): a curve per mask in the mask-first local panel (USABILITY R2 10), Phase 3-4. **Effort:** M after masks. **Edits:** none.
- **Soft-clip knee for the curve's ends** (Resolve Soft Clip): a "roll off" setting when a point is dragged past white, instead of a hard flat line. This matters only for option B. **Effort:** S. **Edits:** none.
- **Banding guard** [LightBench idea]: warn (a small amber mark on the graph) where the curve's slope exceeds about 4× or falls below 0.1 over a range with many pixels. Resolve warns about "contouring"; the simple-curve work adds smoothness limits for banding. **Effort:** S.
- **Darktable XMP and Lightroom sidecar import of curves**: with the planned darktable XMP work (USABILITY decision) and Lightroom crop/transform reading (PHASE3 Part 7). Lightroom's parametric and R/G/B fields, darktable's rgb curve nodes and its norm map as noted above. **Effort:** M. **Edits:** photos read from sidecars *after* this lands would gain their curve; already-imported photos keep what they have unless re-read. Say so in the release notes.
- **Per-curve intensity** (Resolve's Intensity sliders): a 0-100 % "Amount" for the whole curve, handy for presets. **Effort:** S.

---

## 3. Recommended first version vs later

The owner values usability over feature count. Lightroom users should find everything they know, and nothing should duplicate Basic without saying why.

### First version

| Item | Why |
|---|---|
| Pipeline position decided (§2.0, question 1), on the histogram's axis (§2.1) | Everything else depends on it; dragging must move the tones you see |
| Point curve + R/G/B, ≤ 16 points, overshoot-free monotone interpolation (§2.10) | The core tool; simple smooth curves are what experts' edits reduce to |
| Input histogram behind the graph, middle-grey tick, value readout (§2.1) | Lightroom parity, made truthful (input, not output) |
| Hue-preserving default + one **Saturation** slider; darktable's estimators under Advanced (§2.2, §2.3) | Prettier than per-channel RGB by default, Lightroom-like punch, and Luma/RGB/Refine Saturation in one control |
| TAT with hover marker, arrow-key nudge, drag-anywhere (§2.7) | Fastest way to edit; hover feedback is what Lightroom lacks |
| Clipping shown while dragging (§2.5) | A display-side curve can clip; the J overlay already exists |
| Baseline, drag ghost, channel overlays (§2.8) | Cheap, and makes every change readable |
| Numeric fields, Ctrl-click add, Alt to snap back (§2.9) | Precision without fiddling |
| Keyboard and screen-reader control of points (§2.16) | Owner's keyboard decision; few editors do it |
| Built-in presets and copy/paste (§2.11) | Lightroom's three presets, plus a fade |
| Guidance texts that send users to Basic first (§2.14) | Prevents three tools fighting |
| Parametric "Regions" mode (§2.15), **if the owner keeps it** (question 2) | The easiest, most touch-friendly curve; Lightroom sidecars use it |

### Later

| Item | Why later |
|---|---|
| Black / white eyedroppers; grey → white balance (§2.6) | Overlap Whites/Blacks; build once usage shows the need |
| Match camera JPEG / reference photo (§2.12) | High value (RawTherapee's praise) but M effort and registration risk |
| Auto curve (§2.13) | Would fight Auto; better as an Auto option |
| "What Basic did" ghost (§2.14) | Needs careful labelling; v1's help texts cover most of the risk |
| Option C engine experiment (§2.0) | After B is measured |
| Hue/Sat curves in the Colour group (§2.4) | With the Colour group |
| Log view option, Corner points, intensity slider, soft-clip knee, banding guard (§2.1, §2.10, §2.18) | Refinements; add when asked |
| Curves in masks, curve import from sidecars (§2.18) | Depend on masks and the import work |
| Touch UI (§2.17) | With mobile; the v1 data model is designed for it |
| Point locking, tension slider | Probably never (§2.10) |

### Effect on existing edits

- Adding the curve: none. The curve is absent from old edits, the stage is skipped, and the render stays byte-identical. Prove this with the export-hash check used in PHASE3 Part 10.
- Changing the curve's maths later (norm, interpolation, axis, the Saturation slider's meaning, B → C): a new process version, as for the tone equalizer.

---

## Owner's decisions (2026-10-13)

- **Position:** after Contrast (the sigmoid), on the tones you see, like Lightroom (option B). The hybrid (option C: drawn on the same axis, applied before the sigmoid) is tested later and kept only if it measures better.
- **Parametric curve:** kept, renamed **"Regions"** so its sliders don't sound like Basic's.
- **Colour with contrast:** stronger by default (100 %), like Lightroom, with one slider named **"Saturation"**; hue is preserved either way.
- **R/G/B curves:** in the first version.
- Not yet decided: the grey eyedropper (a later item) and whether tone curves are read from sidecars at the Lightroom/darktable import step (question 7).
- Sources marked [search] or [memory] could not be opened from the build machine (the environment's network policy blocks those sites); they stay marked until checked.


## 4. Open questions for the owner

1. **Where should the curve act?** (a) after Contrast, on the tones you see, like Lightroom, where a steep curve can clip to pure white; or (b) before Contrast, like darktable's rgb curve, where it can't clip but what you drag isn't what you see. Recommended: **(a)** first, with (c), drawing on screen tones but applying before Contrast, tested as an experiment.
2. **Keep Lightroom's parametric curve** (four region sliders with movable splits)? It is the easiest and most phone-friendly curve and Lightroom files use it, but its sliders sound like Basic's Highlights/Shadows. Recommended: keep it, as a "Regions" mode with distinct names.
3. **Should a contrast curve make colours stronger by default** (Lightroom's look), or keep colours as they are (Capture One's Luma)? Recommended: stronger by default (100 %), with the slider to take it back.
4. **What to call that slider:** "Saturation" (clashes with Basic), "Refine Saturation" (Lightroom's name), or "Colour with contrast"?
5. **R/G/B curves in the first version, or later?** Recommended: first version (Lightroom parity, small effort).
6. **The grey eyedropper:** send it to white balance (darktable's way, recommended), or bend the R/G/B curves like Photoshop?
7. **Read tone curves from Lightroom and darktable sidecars** when that import work happens? Photos read afterwards would gain their curve; already-imported photos would not change.
