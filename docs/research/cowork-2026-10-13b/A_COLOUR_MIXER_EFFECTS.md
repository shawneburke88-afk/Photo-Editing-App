> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-13/14 (batch 2, prompt `COWORK_VERIFY_2026-10-13b`). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# Part A: Colour Mixer (HSL), Point Color, Vignette, Grain, Dehaze, Texture and Clarity

Verification of `docs/research/COLOUR_MIXER_EFFECTS.md` (LightBench, branch `main`). All pages were read on **2026-10-13**.

**Method.** Pages were read with WebFetch. Its extraction model returns short verbatim fragments, so a long sentence may appear as several quoted pieces, with cuts marked "…". "Secondary" means not Adobe, the patent office or the vendor. "Indirect" means the source names a field in a different context, for example a Lightroom SDK parameter name rather than an XMP element. Nothing here is legal advice.

**Verdict counts (17 items):** 6 Confirmed, 8 Partly, 0 Contradicted, 3 Not found. Two items contain a sub-claim that is effectively contradicted: item 2 (Adobe's help-page wording disagrees with Adobe's own tutorial) and item 10 (Google Patents shows no foreign family).

---

## Decisions this changes

| # | Claim | Verdict | What LightBench should do differently |
|---|---|---|---|
| 2 | Variance means "colour contrast within the range", not "how far the adjustment spreads" | **Partly.** Adobe's help says "how broadly or narrowly…". Adobe's tutorial and Julieanne Kost both describe colour contrast. | Build Variance as **contrast inside the sampled range**: moving left pulls colours toward the sample, moving right pushes them apart. Do **not** build it as a second Range control. Keep Adobe's help wording as the tooltip if wanted, but follow the tutorial for behaviour. |
| 1 | Variance arrived in Lightroom Classic 15.0 (October 2025) | **Confirmed.** It also appeared earlier as **Early Access in Camera Raw (June 2025)**. | No design change. Correct the timeline in the brief. |
| 3 | Point Color allows 8 samples | **Partly** (secondary only) | Keep the cap of 8 samples, marked "secondary". The sliders are named **Hue Shift / Saturation Shift / Luminance Shift / Range / Variance + Visualize Range**, and Range opens Hue Range / Saturation Range / Luminance Range. |
| 4 | `crs:PointColors` format | **Partly.** The field structure is known from a Lightroom SDK dump. The XMP serialisation is still unknown. | Use the SDK structure as the internal data model, so a later importer is a pure mapping: `SrcHue` (looks like radians), `SrcSat`, `SrcLum`, `HueShift`, `SatScale`, `LumScale`, `RangeAmount` (0–1, default 0.5), and `HueRange` / `SatRange` / `LumRange` as trapezoids `{LowerNone, LowerFull, UpperFull, UpperNone}` in 0–1. Still don't import PointColors in v1. |
| 4 | `crs:Texture`, `Dehaze`, `GrainSize`, `PostCropVignetteHighlightContrast`, `GrayMixer<Band>` are the real field names | **Partly.** All are confirmed by secondary or indirect sources independent of LightCraft. | Use these names in the importer and exporter. |
| 5 | `GrainFrequency` = Roughness (LightCraft), not Size (darktable) | **Partly.** Indirect evidence favours LightCraft. | Map **GrainSize → Size** and **GrainFrequency → Roughness**. Don't copy darktable's importer, which sends GrainFrequency to grain *scale* and never reads GrainSize. |
| 6 | `PostCropVignetteStyle` 1/2/3 = Highlight Priority / Colour Priority / Paint Overlay | **Partly.** darktable's code confirms only that 1 = Highlight Priority. One secondary (AI-assisted) project fitted all three codes to Camera Raw 18.7 renders. | Keep 1/2/3 and treat 0 or a missing value as Highlight Priority. Mark 2 and 3 "unverified" until a Lightroom-written sidecar is checked. |
| 7 | Vignette Highlights only works with a negative Amount | **Confirmed** (Adobe help). It also requires the Highlight Priority or Colour Priority style. | Disable the Highlights slider when Amount ≥ 0 **or** Style = Paint Overlay. |
| 7 | Dehaze, Texture and Clarity ±100 | **Confirmed** (Adobe Lightroom API docs) | No change. |
| 7 | Grain Size 25 / Roughness 50; Feather 50 | **Partly** (secondary) | Keep these defaults, marked "secondary". |
| 7 | Vignette Midpoint 50, Roundness 0, Highlights 0 | **Not confirmed.** One secondary source says Roundness defaults to "+50". | Keep 50 / 0 / 0, but check them in Lightroom before freezing presets or the importer's defaults. |
| 8 | TAT keys Ctrl+Alt+Shift+H/S/L, N to exit; Alt-drag shows the affected colours | **Confirmed.** Adobe also lists **+G** (Grayscale Mix) and **+T** (Tone Curve). | Use the same chords where the browser allows them. Alt-drag on an HSL slider should show the targeted range in colour and everything else in greyscale. |
| 9 | HSL panel renamed Color Mixer | **Confirmed** (secondary): Lightroom Classic 13.0, 10 October 2023, with Point Color added as a tab | Point Color as a tab inside Colour Mixer matches Lightroom. |
| 10 | US 8,340,461 (dark channel) expired | **Partly.** "Expired – Fee Related" is confirmed. The lapse date and fee event are not shown. **No foreign family is listed.** | Facts for the owner: the patent shows as expired, and Google Patents lists no CN/EP or other family member. The exact lapse date is still unconfirmed (see Unresolved). |
| 11 | Adobe's dehaze patents | **Confirmed.** All three show "Active" until 2035. US 9,305,339 is Adobe's; **US 10,367,976 belongs to the US Navy**. | Flag for the owner: compare LightBench's Dehaze port with the claim wording below (TGV/radiance-gradient artefact suppression in 9,508,129 and 9,646,364; image-dependent scaled transmission plus a smoothing filter in 9,508,126). No opinion is given here. |
| 14 | Perlin simplex patent expired 8 January 2022 and covers 3D and higher only | **Confirmed** | No change: 3D simplex grain is not blocked by an active patent. The independent claims recite i,j,k / x,y,z or n ≥ 3. |
| — | (New) Camera Raw now has a **Glow** effect (Diffusion / Bloom / Halation; Range, Spread, Warmth) | New finding | Add it to the Effects backlog for parity. The Camera Raw help page was updated on 27 August 2026. Whether Lightroom Classic has it was not checked. |
| — | (Context) Local Laplacian filters are "the main image-editing tool" in Lightroom and Camera Raw (UCL impact case study) | New finding (secondary) | Supports keeping Local Laplacian as a Clarity option. The patent search (item 13) was inconclusive. |

---

## Item-by-item verdicts

### 1. Point Color dates — **Confirmed** (secondary)
- Lightroom Classic 13.0, 10 October 2023. Lightroom Queen (secondary): "Lightroom Classic 13.0, Lightroom Desktop 7.0, and Lightroom Mobile 9.0 have all been released today." Dated "October 10, 2023 (Updated January 18, 2024)". "In the Color Mixer panel (previously called the HSL/color panel in Classic), there is a new tool – Point Color." https://www.lightroomqueen.com/whats-new-in-lightroom-2023-10/
- Camera Raw 16.0. The Adobe Community announcement "Camera Raw 16.0 is now available" is dated "October 10, 2023": "Point Color allows flexible color selection and additional color input refinement across Hue, Saturation, and Luminance." The poster, nikunj.m, is marked "Legend" and not as Adobe staff. https://community.adobe.com/t5/camera-raw-discussions/camera-raw-16-0-is-now-available/m-p/14146152
- Variance in Lightroom Classic 15.0, 28 October 2025. Adobe Community announcement, "October 28, 2025": "Lightroom Classic 15.0: Assisted Culling, Dust removal, and more from MAX!" and "Now, access the variance slider in the Point Slider tool." https://community.adobe.com/announcements-673/from-max-2025-new-features-in-lightroom-classic-15-0-983824?lang=en. Lightroom Queen (secondary): "Lightroom Classic 15.0, Lightroom Desktop 9.0, and Lightroom Mobile 11.0", dated "October 28, 2025". https://www.lightroomqueen.com/whats-new-in-lightroom-2025-10/
- **Additional:** Variance first shipped as **Early Access in Camera Raw**. jkost.com post dated "06-17-2025", titled "Point Color and Color Variance (Early Access) in Adobe Camera Raw" (secondary, written by an Adobe evangelist). https://jkost.com/blog/2025/06/point-color-and-color-variance-early-access-in-adobe-camera-raw.html
- Blocked: Adobe's per-version pages (`helpx.adobe.com/lightroom-classic/help/whats-new/2024.html`, `camera-raw/using/whats-new/2024.html`) now redirect to the current "What's new" page (15.6 / 18.7), which lists Variance only under "Previous releases" with no version. The Wayback Machine is blocked here.

### 2. What Variance does — **Partly**: Adobe's help wording disagrees with Adobe's tutorial and its evangelist
- Adobe help (Color Mixer): "Determines how broadly or narrowly the adjustment affects similar colors." Range: "Sets the limits of colors included in the adjustment." Page "Last updated on" Oct 27, 2025. https://helpx.adobe.com/lightroom-classic/help/color-mixer.html (canonical page: …/lightroom-classic/desktop/process-and-develop-photos/color-mixer.html)
- Adobe tutorial (adobe.com/learn, primary): "The Variance slider will affect a range of colors that are similar to the color you sampled with the eyedropper tool." "Moving the slider to the left will cause the range of colors to become more alike." "…moving the slider to the right will increase the contrast between the colors and enhance their differences." https://www.adobe.com/learn/lightroom-cc/web/precise-color-adjustments
- jkost.com (secondary): "the new Variance slider, offering simple yet powerful control over color contrast". (URL as in item 1.)
- Lightroom Queen (secondary): "It lets you increase or decrease color contrast," and "this slider can be used without touching any of the others." (URL as in item 1, 2025-10 page.)
- **Conclusion:** the behaviour is contrast within the sampled range. The "spread" summary repeats the help page's one-line wording.

### 3. Point Color limits and sliders — **Partly**
- Slider names (Adobe help, primary): "Hue Shift", "Saturation Shift", "Luminance Shift", "Range", "Variance", and "Select the Visualize Range checkbox to highlight the affected areas…". Neither the sample limit nor numeric ranges are on the page. (URL as in item 2.)
- Sample limit of 8 (secondary): "You can use the Point Color feature to modify up to eight different colours in your image (see Figure 5)." https://andrewhaysom.myportfolio.com/point-color
- Range sub-sliders (secondary, same page): "click the arrow next to the Range slider value to reveal the Hue Range, Saturation Range and Luminance Range sliders".
- Range 0–100 (community user, not staff): "Range slider (with values from 0 to 100)". https://community.adobe.com/questions-675/point-color-what-effect-does-range-slider-have-972816
- Rob Sylvan (secondary) gives the UI labels as "Hue Shift", "Sat. Shift" and "Lum. Shift": "check the Visualize Range box, which changes the unaffected colors to grayscale…". https://lightroomkillertips.com/get-to-know-point-color-in-lightroom-classic/
- **Not found:** numeric ranges of the three Shift sliders and of Variance.

### 4. `crs:` field names and the `PointColors` format — **Partly**
- **Texture.** ExifTool forum, johnrellis (secondary), 4 July 2019: "Adobe Lightroom 8.3 / Camera Raw 11.3 (May 2019) added a new tag:" "XMP-crs:Texture (integer)". Phil Harvey replied: "This will appear in 11.55 when it is released." https://exiftool.org/forum/index.php?msg=53753. Adobe's Lightroom API also uses `"Texture": "<-100 to 100>"` (indirect: an API parameter, not XMP). https://developer.adobe.com/firefly-services/docs/lightroom/guides/apply-edits
- **Dehaze.** ExifTool XMP crs table (secondary): "Dehaze | real/ |". https://exiftool.org/TagNames/XMP.html (the page cuts off near "GradientBasedCorr…", so tags later in the alphabet, from G onward, could not be read there).
- **GrainSize, GrainFrequency, GrainAmount, PostCropVignetteStyle, PostCropVignetteHighlightContrast, GrayMixerRed, HueAdjustmentRed.** Exiv2 XMP crs table (secondary): each is listed, e.g. "Grain Size", "Post Crop Vignette Highlight Contrast", "Gray Mixer Red", all "Integer", with the note "Not in XMP Specification. Found in sample files." https://exiv2.org/tags-xmp-crs.html
- Lightroom Classic SDK `LrDevelopController` (a mirror of Adobe's SDK reference, indirect). `effectsPanel` lists "PostCropVignetteStyle", "PostCropVignetteHighlightContrast", "GrainAmount", "GrainSize", "GrainFrequency" and "Dehaze". `mixerPanel` lists "GrayMixerRed" … "GrayMixerMagenta". The page header says "Adobe® Photoshop® Lightroom® 5 SDK", but its functions list "First supported" versions up to 8.1. https://archive.stecman.co.nz/files/docs/lightroom-sdk/API-Reference/modules/LrDevelopController.html
- **PointColors structure** (secondary; a Lightroom SDK develop-settings dump, not the XMP text). johnrellis, 24 October 2023, in "P: Point Color doesn't clear when syncing": "PointColors = nil" when no colour is set. When one sample is set, the fields are HueRange {LowerFull 0.333333, LowerNone 0, UpperFull 0.666667, UpperNone 1}, HueShift 0, LumRange {…}, LumScale 0, RangeAmount 0.5, SatRange {…}, SatScale 0, SrcHue 4.12705, SrcLum 0.839618, SrcSat 0.920754. https://community.adobe.com/bug-reports-674/p-point-color-doesn-t-clear-when-syncing-664129/index1.html. Values are from the extraction tool. This predates Variance, so the field name for Variance is unknown.
- **Not found:** the XMP serialisation of `crs:PointColors` (for example whether it is an `rdf:Seq` of strings, and in what order). No public Lightroom-written sidecar with Point Color was found.
- Blocked: ExifTool's `XMP.pl` on raw.githubusercontent.com, on jsDelivr and on SourceForge (fetch errors or robots). metacpan and Justia needed a permission prompt that went unanswered.

### 5. `crs:GrainFrequency` — **Partly** (indirect evidence favours Roughness)
- Adobe help names the three grain controls Amount, Size and Roughness: "Size: Controls grain particle size. Specifying a value of 25% or higher can cause some image blurring." "Roughness: Controls the regularity of the grain." https://helpx.adobe.com/camera-raw/desktop/edit-and-enhance-images/tone-and-color/vignette-grain-effects-camera-raw.html
- The Lightroom SDK and Exiv2 list **both** `GrainSize` and `GrainFrequency` as separate parameters, next to `GrainAmount` (sources in item 4). Since Size has its own field, the third grain field, GrainFrequency, must be Roughness. This is an inference: no source states it in words.
- darktable source (primary for darktable's behaviour): `else if(!xmlStrcmp(name, (const xmlChar *)"GrainFrequency"))` … `if(v != 0) data->pg.scale = lr2dt_grain_frequency((float)v);`. The importer never parses `GrainSize`. https://raw.githubusercontent.com/darktable-org/darktable/master/src/develop/lightroom.c

### 6. `crs:PostCropVignetteStyle` values — **Partly**
- darktable source: `if(v == 1) // Highlight Priority` … `else // Color Priority & Paint Overlay`. This gives only 1 = Highlight Priority. (URL as in item 5.)
- rawmakase PR #106 (secondary; the commit is marked "Generated with Claude Code"; merged 3 October 2026): "/// 1 Highlight Priority, 2 Color Priority, 3 Paint Overlay. Camera Raw 18.7 renders 0" / "/// and an omitted style as Highlight Priority." The PR says the operators were "fitted to Camera Raw 18.7 renders of the synthetic chart". https://github.com/pch/rawmakase/pull/106/files
- Scott Kelby (secondary) gives the UI order "(1) Highlight Priority (the default), (2) Color Priority, and (3) Paint Overlay". That is menu order, not stored codes. https://www.peachpit.com/articles/article.aspx?p=3131592&seqNum=8
- **Not found:** a primary source or a Lightroom-written sidecar for codes 2 and 3.

### 7. Slider ranges and defaults — **Partly**
- **Dehaze, Texture, Clarity ±100.** Adobe Lightroom API (primary, API): "Clarity": "<-100 to 100>", "Dehaze": "<-100 to +100>", "Texture": "<-100 to 100>". Its parameter table also lists "Vignette Amount": "-100 to 100". This may be the lens-correction `VignetteAmount`, not `PostCropVignetteAmount`, so it is not used as proof. (URL as in item 4.) Max Wendt (Adobe blog) adds for Texture: "the range from 1 to 100" / "the range from -1 to -100". https://blog.adobe.com/en/publish/2019/05/14/from-the-acr-team-introducing-the-texture-control
- **Vignette Highlights.** Adobe help (primary): "Available for a Highlight Priority or Color Priority effect when Amount is a negative value." Highlights "Controls the degree of highlight 'punch' in bright areas of an image." (Camera Raw URL as in item 5.) This agrees with Bob Somrak (community "Legend"): "As designed, the Highlights slider is only enabled for negative values of Amount using Color Priority and Highlight Priority." https://community.adobe.com/bug-reports-562/p-post-crop-vignetting-highlights-slider-not-functioning-666892
- **Vignette Amount** (Adobe help): "Positive values lighten the corners, negative values darken them." No numbers are given.
- **Feather 50** (secondary, Kelby): "I leave it set at its default of 50". **Midpoint:** "Its default setting is actually really good", with no number. (Peachpit URL as in item 6.)
- **Roundness:** no source gives 0. One secondary source says "its default value of +50" (Simon Ringsmuth, DPS, 2019). https://digital-photography-school.com/?p=163176. This conflicts with the brief's 0 and is **unresolved**.
- **Grain** (secondary): "the size set back to the +25 default" (Adam Welch, DPS, 2017/2021). https://digital-photography-school.com/tips-creative-grain-lightroom/. "The default Roughness value is 50" and "The Amount slider can be set between values of 0 to 100." https://photographylife.com/mastering-lightroom-how-to-add-film-grain
- **HSL ±100** (community, not staff): "the Hue sliders in Lightroom run from -100 to +100". Todd Shaner adds: "In the case of Hue it appears the control range is about -60° at -100 and +60° at +100." https://community.adobe.com/questions-675/hsl-format-confusion-934950
- **Not found** in a primary source: Midpoint 50, Roundness 0, Highlights 0, grain defaults, HSL ±100.

### 8. TAT keys and Alt-drag — **Confirmed**
- Adobe shortcuts page (primary, "Last updated" Oct 29, 2025):
  - "Select Targeted Adjustment tool to apply a Hue adjustment | Ctrl + Alt + Shift + H | Command + Option + Shift + H"
  - Saturation: "… | Ctrl + Alt + Shift + S | …"
  - Luminance: "… | Ctrl + Alt + Shift + L | …"
  - Grayscale Mix: "… | Ctrl + Alt + Shift + G | …"
  - Tone Curve: "… | Ctrl + Alt + Shift + T | …"
  - "Deselect Targeted Adjustment tool | Ctrl + Alt + Shift + N | Command + Option + Shift + N"
  - No Point Color shortcut is listed.
  - https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html
- Alt-drag (jkost.com, secondary, 08-14-2024): "Option -drag (Mac) | Alt -drag (Win) the HSL sliders". This shows "the color range being adjusted in the image in color" with "all other color ranges in grayscale". https://jkost.com/blog/2022/08/the-hsl-color-bw-panels-in-lightroom-classic.html
- TAT arrow keys (Adobe Color Mixer help): "Drag the pointer, or press the Up and Down Arrow keys to make the adjustment."

### 9. HSL → Color Mixer rename — **Confirmed** (secondary)
- Lightroom Queen, 13.0 page: "The HSL/Color panel has been renamed to Color Mixer," and "the HSL/Color controls moved to the new Mixer tab to make space for the Point Color tool." This is Lightroom Classic **13.0, 10 October 2023**. (URL as in item 1.)

### 10. US 8,340,461 B2 — **Partly**
- Google Patents (https://patents.google.com/patent/US8340461B2/en):
  - Title: "Single image haze removal using dark channel priors". Inventors Jian Sun, Kaiming He, Xiao-ou Tang.
  - Current assignee "Microsoft Technology Licensing LLC"; original assignee "Microsoft Corp".
  - Status: "Expired - Fee Related, expires 2031-06-23". The second date is Google's *adjusted* term date, not the lapse date.
  - Filed and priority 2010-02-01; granted 2012-12-25. Assigned to Microsoft Technology Licensing on 2014-12-09.
- **Lapse date and fee event: not shown.** The events list has no maintenance-fee entry. Google's disclaimer: "The legal status is an assumption and is not a legal conclusion."
- **Family:** the only counterpart listed is US20110188775A1. No CN, EP or WO member is listed on either page (https://patents.google.com/patent/US20110188775A1/en). So the brief's presumption of foreign members still in force is not supported by Google Patents. Espacenet was not checked.
- **Claim 1** (independent): "A method of processing a hazy image including at least some haze effects, the method comprising:" "determining minimum intensity dark channels of each local patch of the hazy image" "establishing corresponding dark channel priors of each of the local patches;" "determining transmissions associated with each of the local patches using the corresponding dark channel priors," … "recovering scene irradiances of the local patches…" … "outputting the de-hazed image."
- **Claim 6** (independent): "determining a minimum intensity of a local patch of the hazy image;" "determining a transmission of the local patch using the minimum intensity and an atmospheric light associated with the image;" "recovering a scene irradiance of the local patch by removing the determined transmission from the local patch; and" "outputting the recovered scene irradiance…".
- **Claim 15:** a system claim with memory, display and processor performing claim 6's steps. The text is paraphrased by the tool.

### 11. Adobe dehaze patents, plus the assignees of 9,305,339 and 10,367,976 — **Confirmed** (details below)
- **US 9,508,129 B1**, "Dehazing photos and videos using visual artifact suppression". Inventors Jue Wang, Chen Chen. Adobe Inc (originally Adobe Systems Inc). "Active". Filed 2015-11-06, granted 2016-11-29, anticipated expiry 2035-11-06. https://patents.google.com/patent/US9508129B1/en
  - Claims are from the PDF: https://patentimages.storage.googleapis.com/60/83/89/856fe599b294bd/US9508129.pdf
  - Claim 1: "a method of reducing error enhancement while dehazing an image, comprising:" … "estimating … an amount of unscattered light reflected from objects in the input image;" "determining … a radiance gradient for the input image; and" "removing haze from the input image based on the estimated amount of unscattered light; and" "preventing error enhancement in the output image based on the determined radiance gradient."
  - Claim 10 ("…while enhancing an image contrast") and claim 16 (system) add "generating … a refined transmission map from the estimated transmission map,".
  - The description refines transmission with a TGV-based optimisation.
- **US 9,646,364 B1** is a continuation ("The present application is a continuation of U.S. patent application Ser. No. 14/935,299, filed on Nov. 6, 2015."). Adobe Inc, "Active". Filed 2016-10-14, granted 2017-05-09, anticipated expiry 2035-11-06. https://patents.google.com/patent/US9646364B1/en
  - From the PDF (OCR): claim 1: "estimating a transmission map of an input image, the transmission map representing an amount of reflected" … "determining a radiance gradient for the input image; and" "generating an output image by modifying a contrast of the input image based on the transmission map while" "Suppressing edges in the radiance gradient from appearing in the output image".
  - Claim 16 (system) includes "constraining edges in the output image to be consistent with edges in the input image".
  - https://patentimages.storage.googleapis.com/e4/f8/d1/baa8126cb46f9d/US9646364.pdf
- **US 9,508,126 B2**, "Image haze removal using fast constrained transmission estimation". Inventors Jianchao Yang, Jue Wang. Adobe Inc. "Active, expires 2035-03-14". Filed 2015-02-17, granted 2016-11-29. https://patents.google.com/patent/US9508126B2/en
  - Claim 1: "A computer-implemented digital image processing method comprising:" … "calculating, by the processor, the medium transmission for each of the pixels in the input digital image" … "the fractionally scaled variant being calculated using a scaling factor that is a function of the input digital image;" … "recovering, by the processor, the scene radiance vector based at least in part on the filtered medium transmission".
  - The tool's paraphrase: a smoothing filter (mean, median or minimum) is applied to the transmission. Claims 8 (system) and 14 (computer program product) mirror claim 1.
- **US 9,305,339 B2**, "Multi-feature image haze removal". **Assignee Adobe Inc** (originally Adobe Systems Inc). Inventors Jianchao Yang, Jue Wang, Ketan Tang. "Active". Filed 2014-07-01, granted 2016-04-05, anticipated expiry 2034-07-01. https://patents.google.com/patent/US9305339B2/en
- **US 10,367,976 B2**, "Single image haze removal". **Assignee "United States Department of the Navy"**. Inventors Gregory K. Fleizach, Kristofor B. Gibson. "Active, expires 2037-12-27". Filed 2017-09-21, granted 2019-07-30. https://patents.google.com/patent/US10367976B2/en

### 12. Guided-filter patent (Microsoft; He, Sun, Tang) — **Not found**
- Searches found no guided-filter patent assigned to Microsoft. The project page mentions no patent or licence: "Guided Filter is included in official MATLAB 2014 as a new function." "Guided Filter is included in official OpenCV 3.0 as a new function." https://people.csail.mit.edu/kaiming/eccv10/index.html
- Wikipedia's "Guided filter" article mentions no patent. https://en.wikipedia.org/wiki/Guided_filter
- Blocked: Justia's inventor page (patents.justia.com/inventor/kaiming-he) needed a permission prompt that went unanswered. Google Patents search pages render with JavaScript and can't be read with WebFetch. **Inconclusive.**

### 13. Local Laplacian filter patent — **Not found**
- The project page has no patent statement. Its only Adobe mentions are "Sylvain Paris, Adobe" and "gifts from Microsoft, Google and Adobe." https://people.csail.mit.edu/sparis/publi/2011/siggraph
- Context (secondary, UCL REF impact case study): "chosen by Adobe Systems Incorporated to be the default tool for image enhancements in Adobe Lightroom and Adobe Camera Raw." "now forms the main image-editing tool (for contrast, shadows, highlights, etc.) in Adobe Lightroom and Camera Raw." No patent is mentioned. https://impact.ref.ac.uk/casestudies/CaseStudy.aspx?Id=29898
- **Inconclusive.** Three searches found no patent.

### 14. US 6,867,776 B2 (Perlin) — **Confirmed**
- Google Patents (https://patents.google.com/patent/US6867776B2/en):
  - Title "Standard for perlin noise". Inventor Kenneth Perlin.
  - Original assignee "Individual"; current assignee WSOU Investments LLC, via Nokia (2006) and Nokia Technologies (2015).
  - **"Expired - Lifetime"**. Priority 2001-01-10, filed 2002-01-08, granted 2005-03-15.
  - Expiry **2022-01-08**, which is 20 years from filing.
- **Claims:** six in total; independent claims are 1, 2 and 5.
  - Claim 1: "using a bit-manipulation to generate a six bit quantity from an integer lattice point i,j,k".
  - Claim 2: "placing an input point x,y,z onto a simplicial grid; where x, y and z are integers".
  - Claim 5: "decomposing a hypercube into n! simplices…", with "where n is greater than or equal to 3 and is an integer".
  - No claim recites 2D noise. All independent claims are 3-coordinate or n ≥ 3.

### 15. Texture and Dehaze release dates — **Confirmed**
- **Texture: 14 May 2019** (Adobe blog, primary). "05-14-2019", Max Wendt: "Today we are introducing a new control called “Texture” in Lightroom (on Mac, Windows, iOS, Android, and ChromeOS), Lightroom Classic, and Camera Raw." (URL as in item 7.) The versions were Lightroom Classic 8.3 / Camera Raw 11.3, per johnrellis (secondary, item 4).
- **Dehaze: June 2015** (secondary).
  - PhotoRumors, "June 16, 2015", lists Camera Raw 9.1, says Lightroom CC 2015.1 "includes the latest dehaze feature" and that it "appeared first as a MAX sneak in October 2014." https://photorumors.com/2015/06/16/adobe-camera-raw-9-1-creative-cloudlightroom-updates-adobe-stock-introduced/
  - Michael Tsai, 23 June 2015: "Lightroom CC 2015.1 receives the new Dehaze feature for removing haze and fog from pictures". He adds that perpetual Lightroom 6.1 did not get it. https://mjtsai.com/blog/2015/06/23/lightroom-6-1-doesnt-get-new-features/
  - No Adobe primary page for June 2015 was found.

### 16. DxO ColorWheel's eight channel names — **Not found**
- DxO (primary) confirms eight channels but doesn't name them: "To select a color range, click on one of the eight color channels." On Uniformity: "Slide it to the right to increase the Uniformity and the selected colors will have their hues pushed closer together." https://www.dxo.com/en/technology/colorwheel/
- Chris Wright (secondary), which is probably where the brief's seven names came from: "eight colour channels, red, orange, yellow, green, blue, purple and magenta". That lists seven. https://chriswright.photography/hsl-tool-in-photolab-4/
- Digital Camera World (secondary) names a "Violet" channel in its steps, which conflicts with "purple". https://digitalcameraworld.com/tutorials/how-to-use-the-colorwheel-in-dxo-photolab-3-and-win-a-free-copy
- The DxO PhotoLab user guide page for HSL could not be found by search. The eighth name (probably a cyan or aqua channel) is **unverified**.

### 17. ART's colour, grain, haze and local-contrast tools — **Partly** (from ART's reference manual; source code not readable)
- ART reference manual (primary docs): https://artraweditor.github.io/Reference
- **Color Equalizer:** "Use the Color Equalizer to target and change specific hue, saturation and / or luminance values". It uses H/S/L curve tabs over hue: "Multiple targets can be defined and adjusted." Smoothing "blurs the edge of affected areas."
- **Color / Tone Correction** (Local editing tab): "As the name implies, this tool can adjust localized (mask-constrained) hue, saturation and luminosity".
- **Haze Removal** (Special effects tab): "The Haze Removal tool reduces distant haze as the curve is raised." It has a strength-versus-depth curve, "Luminance mode" and "RGB mode". The algorithm is not named in the docs.
- **Film Grain:** "The Film Grain tool adds granular noise to the image that approximates the appearance of film grain,". Its controls are "Coarseness (ISO)" and "Strength".
- **Local Contrast:** "Local contrast applies a wavelet decomposition in L*a*b* space and manipulates the contrast of the different levels". It is a single curve, and "Leftmost points correspond to finer detail scales."
- **Texture Boost:** "Texture boost is somewhat similar to doing sharpening or local contrast with unsharp masks,". It uses an edge-aware "guided filter", "two levels of details", in linear RGB.
- **Vignette Filter:** "The Vignette Filter is intended for adding artistic vignetting to your image."
- Blocked: `raw.githubusercontent.com/artpixls/ART/master/src/rtengine/ipdehaze.cc` and `.../rtengine/ipdehaze.cc` returned fetch errors, and GitHub tree pages are robots-blocked. The default branch is `master`, with top-level `src/`.

---

## Still unresolved, and why

1. **The `crs:PointColors` XMP serialisation** (element type, field order and encoding), and the name of the **Variance** field. No public Lightroom-written sidecar with Point Color was found. ExifTool's crs table cuts off before "P" on exiftool.org, and `XMP.pl` could not be fetched. *Needs: one Lightroom Classic 15.x sidecar with two Point Color samples and a non-zero Variance.*
2. **`PostCropVignetteStyle` codes 2 and 3.** Only a secondary, AI-assisted project supports them. *Needs: the same sidecar check.*
3. **Primary defaults** for vignette Midpoint, Roundness and Highlights, grain Size and Roughness, and the HSL range. Adobe help gives no numbers, and one secondary source claims Roundness +50. *Needs: reading the values in Lightroom, or the SDK `getRange` and default values.*
4. **The `GrainFrequency` label.** The inference is strong but nothing states it. *Needs: a sidecar written after moving only Roughness.*
5. **The lapse date and fee event for US 8,340,461.** Google Patents shows no maintenance-fee event. USPTO Patent Center needs JavaScript and Justia needed an unanswered permission prompt. Espacenet was not checked for family.
6. **Guided-filter and Local Laplacian patents.** Google Patents search and Justia inventor listings were not reachable, so these results are inconclusive, not negative.
7. **The eighth DxO channel name.** The DxO user guide page was not found.
8. **ART's source code** (to confirm whether Haze Removal uses the dark channel). raw.githubusercontent.com fetches of ART files failed.
9. **The point-colour Shift and Variance numeric ranges.** These are not in any source read.
10. **Glow** (new Camera Raw effect): its version, and whether Lightroom Classic has it, were not checked.

**Blocked or unavailable this session:** Adobe per-version "what's new" pages (they redirect), web.archive.org (site blocked), ExifTool `XMP.pl` (raw GitHub, jsDelivr, SourceForge), metacpan and patents.justia.com (permission prompt unanswered), GitHub tree pages (robots), the ExifTool forum message 60357 ("server can't handle the load"), MetaFilter (fetch error), and the second half of exiftool.org's XMP tag page (truncated).
