> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-13/14 (batch 2, prompt `COWORK_VERIFY_2026-10-13b`). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# Part B: Masking and local adjustments — verification

Read date for every source below: **2026-10-13**. Context only (not evidence): `docs/research/MASKING.md` (main), which loaded.

Method note: pages were read with WebFetch, which hands page text to an extraction model. Quotes below are the verbatim strings that tool returned. Quotes taken from PDFs keep OCR artefacts as returned (e.g. "Steps", "agraphical"). "Secondary" marks anything that is not the vendor's own documentation or the patent record.

Verdict counts (48 sub-items): **Confirmed 25 · Partly 11 · Contradicted 1 · Not found 11**.

## Decisions this changes

| Claim (from MASKING.md / brief) | Verdict | What LightBench should do differently |
|---|---|---|
| All Nik/Google U Point patents on the list have expired | **Contradicted** for US 8,837,849. Google Patents shows it "Active, expires 2031-10-04". It is a separate 2007-priority Nik filing (noise-robust colour changes), not part of the 2001 family. The other 8 listed patents, plus 5 more 2001-family members found in the timeline, are expired. | Keep the expired 2001 U Point family in the "expired" column. Give 8,837,849 its own row and send it to counsel, because claim 1 covers colour-distance-driven local enhancement after an edge-preserving pre-filter. Don't describe the family as "all expired". |
| US 11,223,744 (Adobe, local colour range selection) | **Confirmed** Active. Filed 2017-10-17; "Adjusted expiration" 2037-12-02. Claim 1 weights an adjustment by a "combination of the value of the spatial mask and the value of the range mask". | Keep it flagged as highly relevant to intersecting a drawn region with a range mask. This is a fact for counsel, not a conclusion. |
| Lightroom masks can be read from the XMP sidecar | **New finding, Confirmed:** Adobe says Lightroom writes "heavy edits, masks, or AI settings" to a separate **.ACR** sidecar. | The importer must not assume masks are in the XMP. Detect a `.acr` file, tell the user AI/heavy masks may be missing, and import only what is in the XMP. |
| `What` / `MaskBlendMode` / `MaskSubType` / `Dabs` / `LumRange` / coordinate frame decoding | **Not found** (needs a Lightroom-written sample). The field names are confirmed by ExifTool 3.79 (secondary). | Keep the XMP mask importer behind "experimental" until a real sidecar is decoded. Don't hard-code 0/1/2 = add/subtract/intersect. |
| Local `Grain`, `Curve`, `Point Color` exist in Lightroom masks | **Partly.** Adobe's masking page lists Grain and Curve (with Refine Sat.). Point Color appears in masks only via an Adobe community bug report (secondary). ExifTool's `Correction` struct has no `LocalGrain`, `LocalPointColors` or `LocalToneCurve`. | Field names for these three are unknown. Don't guess names on import or export. |
| 15.5 Feather and Edge apply to all masks | **Partly.** Adobe's release notes and help pages are silent. Three secondary sources say AI masks only, and the sliders disappear once a brush or gradient component is added. | Following Lightroom here means offering Feather/Edge on AI components only. LightBench can deliberately offer them on all masks (as Capture One does with brushed masks); record that as a design choice. |
| Lightroom masking shortcuts N, ' (invert), Shift+Z (depth) | **Partly.** Not in Adobe's shortcut table. Only Julieanne Kost's blog has them (Adobe evangelist, secondary). Adobe's table confirms K, M, Shift+M, Shift+J, Shift+Q, O, Shift+O, Alt+O, H, Shift+W. | You can ship Shift+J / Shift+Q / O / Shift+O / Alt+O with confidence. Treat N, ', Shift+Z as "matches Lightroom per secondary source". |
| Overlay modes | **Confirmed:** six modes, and there is no plain "B&W" mode. | Match the six names. |
| Mask Amount range 0–200% | **Not found** in Adobe documentation. | Keep LightCraft's 0–200 clamp as an assumption and label it as one. |
| Soft-mask Add/Subtract/Intersect maths, falloff shapes, overlap stacking | **Not found** (Adobe doesn't document them). | Keep darktable's documented/source maths (max/min/a·(1−c)) as LightBench's own definition. Don't call it "Lightroom-compatible". |
| darktable "drawn & parametric" prior art | **Partly:** they did not ship together. Parametric ("conditional blending") came in **1.1** (Nov 2012); drawn masks in **1.4** (Dec 2013). | Cite the two releases separately in any prior-art note. |
| Capture One masks are raster underneath | **Partly:** Capture One says rasterising a gradient "changes the mask to be pixel-based". Gradients and Luma Range stay "dynamic" until rasterised. | Use a hybrid model: parametric shapes until a raster edit, then a bitmap. This matches the darktable/LightBench plan. |
| Touch target "≥ 44" | **Partly:** Apple lists 44×44 pt as the iOS/iPadOS **default** and 28×28 pt as the **minimum**. | Keep ≥ 44 CSS px as LightBench's target, and cite it as Apple's default size, not its minimum. |

---

## Item 1 — Adobe help, Lightroom Classic "Masking"

Primary: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/masking.html. The page shows "Last updated on Sep 29, 2026".
Primary: https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html ("Last updated: Oct 29, 2025").

**1a Component list: Confirmed.** Automatic: Subject, Sky, Background, Landscape, Objects, People. Manual: Brush, Linear Gradient, Radial Gradient, Color Range, Luminance Range, Depth Range. Depth Range: "This tool is enabled only for photos containing depth information."

**1b Local slider list: Partly.** After "Use the following sliders to make the desired adjustments to your selection:", the page lists, in order: Feather, Edge, Temp, Tint, Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Texture, Clarity, Dehaze, Hue, Saturation, Sharpness, Noise, Moiré, Defringe, Color, Grain, Curve.
- Curve and Refine Saturation: "Refine Sat. slider under Curve allows control over color saturation while using the Curve tool."
- Grain: "Under the Effects panel, use the Amount slider to add grains to the masked area of an image"
- Feather: "Softens the edges of the selected mask in a photo." Edge: "Expands or contracts the edges of the selected mask in a photo."
- **Point Color is not on the masking page.** Secondary evidence that a local Point Color tool exists: an Adobe community bug titled "Mask local-adjustment Preset menu doesn't recognize changes to Point Color", which says "…use the local Point Color tool". Adobe staff marked it Fixed on 2024-05-21. https://community.adobe.com/t5/lightroom-classic-bugs/p-mask-local-adjustment-preset-menu-doesn-t-recognize-changes-to-point-color/idc-p/14448666 (secondary)

**1c Mask Amount range: Not found.** Adobe's masking page uses "Amount" only for Grain. The Camera Raw masking page (https://helpx.adobe.com/camera-raw/using/masking.html, updated Jun 18, 2026) mentions only "modify the intensity using the Amount slider" for local presets, with no range. Julieanne Kost (secondary): "drag the Amount slider left/right to decrease/increase the relative effect of all adjusted sliders". No range given. https://jkost.com/blog/2022/10/everything-you-need-to-know-about-masking-in-lightroom-classic.html

**1d Overlay modes: Confirmed.** "Select the three-dot menu to select the overlay mode", followed by: Color Overlay; Color Overlay on B&W; Image on B&W; Image on Black; Image on White; White on Black. There is no plain "B&W" mode. Shortcut rows: "Show/hide local adjustment mask overlay | O | O"; "Cycle local adjustment mask overlay colors | Shift + O | Shift + O"; "Cycle Overlay mode in Crop / Masking | Alt + O | Option + O".

**1e Intersect: Confirmed.** "You can also access this option from the Masks Panel by pressing Alt (Windows)/Option (macOS)". Discrepancy: Adobe's **Camera Raw** page says to "hold down the Shift key and click the Intersect button that replaces Add and Subtract", and offers "Intersect Mask With" in the three-dot menu. Kost (secondary): "Hold Option (Mac ) | Alt (Win) to toggle the Add and Subtract buttons in the masks panel to Intersect".

**1f Masking shortcuts: Partly.** Rows on Adobe's shortcut page (Windows | macOS):
- "Open / close Masking | Shift + W | Shift + W"
- "Select the Adjustment Brush tool (from any module) | K | K"
- "Select the Graduated Filter tool | M | M"
- "Create a Radial filter | Shift + M | Shift + M"
- "Create a color range | Shift + J | Shift + J"
- "Create a Luminance filter | Shift + Q | Shift + Q"
- "Temporarily switch from brush A or B to Eraser | Alt-drag | Option-drag"
- "Increase/decrease brush size | ] / [ | ] / ["
- "Increase/decrease brush feathering | Shift + ] / Shift + [ | Shift + ] / Shift + ["
- "Show/hide local adjustment pin | H | H"
- "Toggle Mask between Edit and Brush modes when the Graduated Filter or Radial Filter is selected | Shift + T | Shift + T"

The masking page itself adds: "You can add up to five color samples by holding Shift while clicking on the image."

**Not in Adobe's table:** Depth Range, N, ', or Invert. In Adobe's table, N is Survey view and ' is "Create virtual copy" (with Ctrl/Cmd). Kost's blog (secondary) gives:
- "After creating an initial mask, tap "N" to create a new mask of the same type as the currently selected component."
- "Tap the ‘ (apostrophe) key to invert the brush mask component."
- "When using Depth Range Masking (Shift + Z):"

## Item 2 — Release notes 15.5 (August 2026): Feather/Edge scope

**Verdict: Partly.** Adobe doesn't say which masks the controls apply to. Secondary sources agree: AI masks only.
- Release notes: "Adjust the new Feather and Edge controls when masking photos for more control and creative effects." https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/release-notes.html
- What's new: "Try the new Feather and Edge sliders for more control, better creative effects, and smoother transitions when masking." https://helpx.adobe.com/lightroom-classic/help/whats-new.html
- Adobe community announcement: "new Feather and Edge controls, giving you finer control over photo masks". No staff reply addresses mask types. https://community.adobe.com/announcements-673/lightroom-classic-v15-5-is-here-better-masking-controls-render-to-dng-and-more-1635193
- Secondary, Fstoppers: "The moment you introduce a brush, linear gradient, or radial gradient into the mask, the edge and feather sliders disappear." https://fstoppers.com/artificial-intelligence/lightroom-classic-155-finally-lets-fix-ai-masks-after-creating-them-904005
- Secondary, Fstoppers: "Brush, linear gradient, and radial gradient are the exceptions." https://fstoppers.com/education/two-new-sliders-make-every-lightroom-mask-look-more-natural-903883
- Secondary, Thomas Fitzgerald: "you can only apply it to AI-generated masks." https://blog.thomasfitzgeraldphotography.com/blog/2026/8/lightroom-15-5-released-new-features
- Range masks: Fstoppers says colour range masks "give you a refine slider but not the edge movement" (secondary).

Other 15.x masking notes (primary, release notes): 15.0, Oct 2025: "With the new Snow element in the Landscape mask…". 15.4, Jun 2026: "…improved subject detection and selection when masking." 15.6, Sep 2026: "Use the Check All option to easily select all landscape and people mask options in the Masking panel."

## Item 3 — Lightroom mask maths

**3a Add/Subtract/Intersect on soft masks: Not found.** Adobe's Lightroom Classic and Camera Raw masking pages describe these operations but give no formula.

**3b Gradient and radial falloff shapes: Not found.** Camera Raw help says only that the linear gradient makes a "gradually fading pattern that creates soft transitions", and for the radial gradient: "Use the Feather slider to determine how soft you want the adjustments." https://helpx.adobe.com/camera-raw/using/masking.html

**3c How overlapping masks combine: Not found.** Neither Adobe page addresses it.

**3d Local Temp/Tint are relative: Partly (secondary).** Adobe's mobile help says only that Temp "Adjusts color temperature, making the masked area warmer (orange) or cooler (blue)", with no scale given. https://helpx.adobe.com/lightroom/mobile/masks-and-selective-adjustments/local-adjustment-controls.html. An Adobe Community Expert says brush and gradient Temp/Tint "operate as a purely relative adjustment". https://community.adobe.com/t5/lightroom-classic-discussions/kevlin-scale-to-100-100-scale-conversion/m-p/9249240 (secondary)

## Item 4 — Lightroom XMP

No Lightroom-written sidecar with masks was available. All field-name evidence is secondary.

**4a Field names: Confirmed (secondary).** ExifTool source `lib/Image/ExifTool/XMP.pm`, `$VERSION = '3.79'`. https://raw.githubusercontent.com/exiftool/exiftool/master/lib/Image/ExifTool/XMP.pm
- `CorrectionMask` struct: What, MaskValue, Radius, Flow, CenterWeight, Dabs, ZeroX/Y, FullX/Y, Top, Left, Bottom, Right, Angle, Midpoint, Roundness, Feather, Flipped, Version, SizeX/Y, X, Y, Alpha, CenterValue, PerimeterValue, MaskActive, MaskName, MaskBlendMode, MaskInverted, MaskSyncID, MaskVersion, MaskSubType, ReferencePoint, InputDigest, MaskDigest, WholeImageArea, Origin, Masks, CorrectionRangeMask. Source comment above MaskActive: "new in LR 11.0 MaskGroupBasedCorrections".
- `CorrRangeMask`: Version, Type, ColorAmount, LumMin, LumMax, LumFeather, DepthMin, DepthMax, DepthFeather, Invert, SampleType, AreaModels, LumRange, LuminanceDepthSampleInfo. Note: "Called CorrectionRangeMask by the spec."
- `AreaModels`: ColorRangeMaskAreaSampleInfo, AreaComponents.
- `Correction`: What, CorrectionAmount, CorrectionActive, LocalExposure2012 … LocalTemperature, LocalTint, LocalHue, LocalDehaze, LocalTexture, CorrectionRangeMask, CorrectionMasks, CorrectionName, CorrectionSyncID. `MaskGroupBasedCorrections` is commented "new for LightRoom 11.0".
- **Gap:** ExifTool has no `LocalGrain`, `LocalPointColors` or `LocalToneCurve`. `LocalCurveRefineSaturation` appears only under DepthBasedCorrections. So ExifTool does not cover the newer local sliders.

**4b `What` values: Not found** (needs a Lightroom-written sample). ExifTool only types the field as string.
**4c `MaskBlendMode` codes: Not found** (needs a Lightroom-written sample). ExifTool types it as integer with no decoding.
**4d `MaskSubType` codes (subject, sky, background, objects, people, landscape): Not found** (needs a Lightroom-written sample).
**4e `Dabs` string format: Not found** (needs a Lightroom-written sample).
**4f `LumRange` / `AreaModels` / `SampleType` contents: Not found** (needs a Lightroom-written sample). Only the names and types are confirmed (LumRange string; SampleType integer).
**4g `Local*` scales: Not found** (needs a Lightroom-written sample).
**4h Coordinate frame (before/after Transform and crop): Not found** (needs a Lightroom-written sample). darktable's `src/develop/lightroom.c` (secondary, master) imports no Lightroom local-adjustment masks, only `RetouchInfo` spots and crop. Its crop path comment is "// Convert image in image-centered coordinate system, [-image_size / 2; + image_size / 2]", which says nothing about the mask frame. https://raw.githubusercontent.com/darktable-org/darktable/master/src/develop/lightroom.c

**4i New finding, the .ACR sidecar: Confirmed (primary).** https://helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/create-xmp-acr-files.html (updated Oct 27, 2025):
- "If heavy edits are applied to an image, Lightroom will create an XMP and an ACR file to store the metadata."
- "Lightroom identifies if there are any heavy edits, masks, or AI settings like Super Resolution…"
- "It writes the heavy edits to the ACR sidecar while keeping the XMP sidecar lightweight."

## Item 5 — Patents

Source for each row: `https://patents.google.com/patent/<number>/en`. Claim 1 text comes from the Google-hosted PDF where the HTML page was cut off before the claims. Google labels its legal status "an assumption and is not a legal conclusion". Facts only.

| Patent | Title | Assignee (current / original) | Priority / filed | Status (Google, verbatim) | Anticipated expiry | Claim 1 gist (verbatim fragments) | Verdict |
|---|---|---|---|---|---|---|---|
| **US 11,223,744 B2** | Local color range selection | Adobe Inc / Adobe (Systems) Inc; inventors Bury, Chan; appl. 15/786,549 | 2017-10-17 / 2017-10-17; published 2022-01-11 | "Active" | 2037-12-02 ("Adjusted expiration") | "A method for fine-level tuning of an image…"; "receiving user input comprising a user drawing around a coarsely-defined region…"; "generating … a spatial mask…"; "generating … a range mask defining a range of values of a user-specified parameter…"; "weighting the adjustment … by a combination of the value of the spatial mask and the value of the range mask". Independent claims: 1, 7, 12. | Confirmed |
| US 6,728,421 B2 | User definable image reference points | Google LLC / Nik Multimedia Inc; inv. Kokemohr | 2001-10-24 / 2002-10-24 | "Expired - Lifetime" | 2022-10-24 | "determining one or more Sets of pixel characteristics"; "determining for each pixel characteristic Set, an image editing function"; "providing a mixing function algorithm…"; applying it "based on the one or more pixel characteristic Sets…" (PDF) | Confirmed (expired) |
| US 6,865,300 B2 | User definable image reference points | Google LLC / Nik Multimedia Inc | 2001-10-24 / 2004-04-13 | "Expired - Lifetime" | 2022-10-24 | "providing one or more than one image processing filter"; "Setting the coordinates of one or more than one image reference point within the digital image"; mixing function "based on … the coordinates of the … image reference point" (PDF) | Confirmed (expired) |
| US 7,031,547 B2 | User definable image reference points | Google LLC / Nik Software Inc | 2001-10-24 / 2005-03-03 | "Expired - Lifetime" | 2022-10-24 | "image processing of a plurality of digital images"; IRPs "associated with location dependent or location independent characteristics"; applying the mixing function "…which are associated with location independent characteristics." | Confirmed (expired) |
| US 7,602,968 B2 | Overlaid graphical user interface and method for image processing | Google LLC / Nik Software Inc | 2001-10-24 / 2006-04-17 | "Expired - Lifetime, expires 2023-08-16" | 2023-08-16 | "a graphical icon overlaid on the digital image at the coordinates of one or more pixels"; "a menu overlaid on the digital image and graphically linked to the graphical icon" (PDF) | Confirmed (expired; adjusted date is later than 2022-10-24) |
| US 7,602,991 B2 | User definable image reference regions | Google LLC / Nik Software Inc | 2001-10-24 / 2007-08-01 | "Expired - Lifetime" | 2022-10-24 | "a. defining a region of interest in the digital image"; "b. determining one or more sets of pixel characteristics for the region of interest"; mixing function (PDF) | Confirmed (expired) |
| US 7,970,233 B2 | Distortion of digital images using spatial offsets from image reference points | Google LLC / Nik Software Inc | 2001-10-24 / 2010-08-12 | "Expired - Fee Related" | 2022-10-24 | Claim 1 differs from the title: "c) overlaying agraphical mark over the displayed image for each … image reference point"; effect strength "as a function of the pixel location and pixel color…" "using a soft classification method" (PDF) | Confirmed (expired) |
| US 8,064,725 B2 | Distortion of digital images using spatial offsets | Google LLC / Nik Software Inc | 2001-10-24 / 2009-10-10 | "Expired - Fee Related" | 2022-10-24 | "A method for distorting a digital image…"; "receiving one or more than one spatial offset…"; "calculating an offset matrix…" (PDF) | Confirmed (expired) |
| US 8,625,925 B2 | Distortion of digital images using spatial offsets from image reference points | Google LLC / Google LLC (assigned from Nik Software 2013-10-07) | 2001-10-24 / 2009-10-12 | "Expired - Fee Related, expires 2023-09-25" | 2023-09-25 | "receiving one or more than one spatial offset assigned by the user…"; "distorting the digital image by application of the offset matrix." (PDF) | Confirmed (expired) |
| **US 8,837,849 B2** | Method for noise-robust color changes in digital images | Google LLC; inv. Kokemohr; assigned Nik Software → Google Inc. 2013-10-07 | **2007-06-26** / 2008-06-26 | **"Active, expires 2031-10-04"** | **2031-10-04** | "filtering the digital image with an edge-preserving detail-reducing filter"; "determining a matrix from the filtered digital image"; a structure-adaptive function "based in part on a color distance between a reference color and a color of at least one pixel"; matrix values determine "a magnitude of an enhancement filter to apply at a corresponding pixel" (PDF) | **Contradicted** (not expired; not 2001 family) |
| US 6,954,549 B2 | Local digital image property control with masks | Imaging Solutions AG / Gretag Imaging Trading AG; inv. Walter Kraft | 2001-02-09 / 2002-02-08 | "Expired - Lifetime, expires 2023-11-15" | 2023-11-15 | Claim 1 not read: both the HTML and the PDF text were cut off before the claims. Abstract: "Disclosed is a process for the location dependent correction of photographic image data" | Partly |

Further 2001-priority members found in the US 6,728,421 timeline but missing from the brief's list (status only):

| Patent | Status | Expiry |
|---|---|---|
| US 8,582,877 B2 | "Expired - Fee Related, expires 2022-11-15" | 2022-11-15 |
| US 9,008,420 B2 | "Expired - Lifetime" | 2022-10-24 |
| US 9,471,998 B2 | "Expired - Fee Related" | 2022-10-24 |
| US 9,786,031 B2 | "Expired - Fee Related" | 2022-10-24 |
| US 10,140,682 B2 | "Expired - Lifetime" | 2022-10-24 |

**Adobe patents on Select Subject / Select Sky / depth range masks: Partly.** Found by web search. Status only: no claims were read, and nothing links these patents to specific Lightroom features.

| Patent | Title | Assignee | Priority | Status | Expiry |
|---|---|---|---|---|---|
| US 10,460,214 B2 | Deep salient content neural networks for efficient digital object segmentation | Adobe Inc | 2017-10-31 | "Active, expires 2038-01-12" | 2038-01-12 |
| US 10,311,574 B2 | Object segmentation, including sky segmentation | Adobe Inc | 2016-02-11 | "Active" | 2036-02-11 |
| US 10,762,608 B2 | Sky editing based on image composition | Adobe Inc | 2016-04-08 | "Active" | 2036-04-08 |
| Depth range mask | none found (web search; Justia lists only 11,223,744 for inventor J. M. Bury) | — | — | — | — |

Search results also listed US 9,858,675, US 10,074,161, US 11,776,184 (sky replacement), US 11,314,982 / US 11,568,627 (interactive deep-learning selection), US 9,129,191, US 9,978,003 and US 9,972,092. None of these were opened.

## Item 6 — Capture One support

- **Layer opacity: Partly.** "All the masks applied to the Layer will be adjusted by the same value." "Next to the slider, there is a box where you can enter a value (%) directly." No range or default is stated. https://support.captureone.com/hc/en-us/articles/360002615497. For brush opacity: "The default settings for Opacity is 100 (%)." https://support.captureone.com/hc/en-us/articles/360002617917
- **Mask types: Confirmed.** The Combine Masks article lists Subject, Background, People, Brush, Magic Brush, Linear Gradient, Radial Gradient, AI Select and Luma Range. https://support.captureone.com/hc/en-us/articles/31021514753053
- **Refine Mask: Confirmed.** It "enhances the precision of the mask along the border". Radius range "0-300 and a default of 10px". "you will be prompted to rasterize the mask once you click Apply." https://support.captureone.com/hc/en-us/articles/360002623297
- **Luma Range: Confirmed.** "Luma Range in Capture One lets you refine a mask based on brightness values, such as highlights, midtones, or shadows." "…you can add, intersect, or subtract a Luma Range from an existing mask…" https://support.captureone.com/hc/en-us/articles/360002622857
- **16.7 combine: Confirmed.** "From Capture One 16.7.0, you can combine different masks on the same layer to create more refined and flexible selections." "Each combined group counts as a single layer, even if it includes multiple masks." https://support.captureone.com/hc/en-us/articles/360002601658. Combine Masks article: Add "Merges selected masks so the final mask covers all included areas"; Intersect "Keeps only the overlapping area between masks". Linear Gradient, Radial Gradient and Luma Range stay dynamic after combining.
- **Raster or vector storage: Partly.** Radial gradient: "This operation basically changes the mask to be pixel-based, meaning that you cannot readjust the gradient afterwards." "The resulting mask will then be the same type as if you were using the Draw Mask feature from the start." https://support.captureone.com/hc/en-us/articles/360002627458-Editing-the-Radial-Gradient-Mask. Feathering: "you cannot readjust the Radial Gradient Mask or the Linear Gradient Mask itself once you have added the feathering." https://support.captureone.com/hc/en-us/articles/360002632858. Drawn/brushed masks are pixel-based and gradients are parametric until rasterised; the on-disk format is not documented.

## Item 7 — darktable manual

docs.darktable.org `development` pages: the drawn and raster pages loaded. The parametric and mask-manager pages returned server errors (also tried 5.6/parametric, which failed). Parametric was read from the darktable.org manual mirror, https://www.darktable.org/usermanual/en/… (same project; version not shown).

- **Drawn shapes: Confirmed.** "brush, circle, ellipse, path, gradient, and AI object". https://docs.darktable.org/usermanual/development/en/darkroom/masking-and-blending/masks/drawn/
- **Set operators: Partly.** The manual says the mask manager can "group and combine drawn masks using set operators (union, intersection, difference, exclusion)". It does not mention "sum" (which is in the source per MASKING.md) and gives no formulas, so the max/min maths stays source-only.
- **Shapes follow distortions: Confirmed.** Shapes "are transformed along with the rest of the image by any active distorting modules".
- **Parametric: Confirmed.** "Two filled triangles above the slider mark the range of values where opacity is 1." "Intermediate points between full and zero are given a proportional opacity." "Modules acting in scene-referred RGB color space have data channels for g (gray), R, G, B," and "Jz (luminance component of JzCzhz), Cz (chroma, or saturation, of JzCzhz), and hz (hue of JzCzhz)." "All blending factors are finally multiplied together (pixel-by-pixel),". https://www.darktable.org/usermanual/en/darkroom/masking-and-blending/masks/parametric/
- **Raster: Confirmed.** A raster mask is "a grayscale raster image representing the extent to which the module's effect should be applied to each pixel". "Raster masks cannot be generated by disabled modules since they do not participate in pixelpipe processing." They can be used only "by modules that come later in the pipe than the generating module." https://docs.darktable.org/usermanual/development/en/darkroom/masking-and-blending/masks/raster/
- **First release: Partly (they did not ship together).**
  - Drawn masks, darktable 1.4: "darktable now includes several kinds of drawn masks: brush, circle, ellipse, path and gradients". https://www.darktable.org/2013/12/released-darktable-1-4. The post has no date; comments put it at about 23 Dec 2013. Secondary, LWN 2014-01-01: "The new showcase feature in 1.4 is support for masking off part of the image." https://lwn.net/Articles/578490
  - Parametric masks, darktable 1.1: the release notes list "conditional blending, and a lot of goodies around it!" https://darktable.org/2012/11/released-darktable-1-1. Undated; the earliest comment is 25 Nov 2012. The pre-release post describes the feature: "This one does not use geometrical but color coordinates to control blending effects." https://www.darktable.org/2012/03/upcoming-features-conditional-blending

## Item 8 — RawPedia "Local Adjustments"

https://rawpedia.rawtherapee.com/Local_Adjustments (the page shows 22/01/2025)
- **Spots: Confirmed.** "An RT-spot consists of either an ellipse or a rectangle with a variable-diameter circle at the center." "The shapes have four control points, which can be adjusted independently or symmetrically."
- **Scope: Confirmed.** "The RT-spot algorithm uses shape detection based on ΔE (the change in the visual perception of two given colors)", "based on the average of the hue, chroma and luminance values inside the variable-diameter circle". "Remember that the scope slider acts on deltaE."
- **Excluding spots: Confirmed.** "RT-spots can also be used in Excluding mode to prevent the algorithm from influencing certain parts of the image."
- Also: Transition value is the "percentage of the area that will receive the full effect of any adjustments before dropping off to zero". Full image: "You can also use the Local Adjustments tool to process the full image."

## Item 9 — Apple HIG minimum touch target

**Partly.** The HTML page (https://developer.apple.com/design/human-interface-guidelines/accessibility) needs JavaScript. The same content was read from Apple's own data file for that page: https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json
- "Strive to meet the recommended minimum control size for each platform…"
- Table: iOS, iPadOS "44x44 pt" default, "28x28 pt" minimum. macOS 28x28 / 20x20. visionOS 60x60 / 28x28. watchOS 44x44 / 28x28. tvOS 66x66 / 56x56.
- "…about 12 points of padding around elements that include a bezel." "…about 24 points of padding works well around the element’s visible edges."

So 44 pt is Apple's **default**, and its stated **minimum** is 28 pt.

---

## Unresolved items and why

1. **Lightroom XMP decoding (4b–4h):** needs a Lightroom-written sidecar with each component kind: subject, sky, background, objects, people, landscape, brush, linear, radial, colour range, luminance range, depth range, plus one with Transform and crop applied. Masks may also be in the binary **.acr** file, which no public spec documents.
2. **Field names for local Grain, Curve and Point Color:** ExifTool 3.79 doesn't list them. Same need as item 1.
3. **Lightroom soft-mask maths, falloff profiles and overlap stacking (3a–3c):** Adobe doesn't document them. They can only be measured by black-box tests on exported renders.
4. **Mask Amount range (1c):** not in Adobe documentation.
5. **Feather/Edge scope (2):** Adobe is silent. The AI-only answer rests on three secondary reviews.
6. **N / ' / Shift+Z shortcuts:** only on Julieanne Kost's blog. Adobe's shortcut table (updated Oct 2025) lacks them.
7. **US 6,954,549 claim 1:** the Google Patents HTML and PDF text were both cut off before the claims. freepatentsonline didn't load.
8. **Adobe AI/depth mask patents:** found by web search only; claims not read; no depth-range patent found. Google Patents search pages need JavaScript.
9. **darktable manual:** the parametric and mask-manager pages on docs.darktable.org returned server errors (mirror used for parametric). The mask-manager operator definitions were not read anywhere. The darktable 1.1 and 1.4 release dates are inferred from comment timestamps.
10. **Capture One:** layer opacity range and on-disk mask format are not documented. support.captureone.com search timed out on permission; articles were reached via web search.
