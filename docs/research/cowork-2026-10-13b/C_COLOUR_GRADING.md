> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-13/14 (batch 2, prompt `COWORK_VERIFY_2026-10-13b`). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# Part C: Colour Grading — verification

Read date for every source below: **2026-10-13**. Source brief (context only): `docs/research/COLOUR_GRADING.md` on branch `lightbench/research-2026-10-13c`.

Verdict counts: **Confirmed 2 · Partly 6 · Contradicted 0 · Not found 0** (several sub-points inside the Partly items are Not found; see the last section).

## Decisions this changes

| Claim | Verdict | What LightBench should do differently |
|---|---|---|
| C1 Ranges/defaults (sat 0–100, lum ±100, Blending default 50; hue 0–360, Balance ±100) | Partly | Keep Blending default **50**, saturation 0–100, luminance −100…+100: Adobe states these. Hue 0–360 and Balance ±100 are not stated as ranges anywhere Adobe publishes. Keep them as working assumptions and flag them in code comments. |
| C2 Wheel gestures | Confirmed | Implement Shift = saturation only, Ctrl/Cmd = hue only, Alt/Option = fine adjust, **double-click a handle = reset that control**, Alt-drag on Blending = temporary saturation boost to 100 (preview aid). Adobe also uses a soft "spoke" constraint that Fine Adjust skips. |
| C3 Legacy sidecar (SplitToning*, no ColorGradeBlending) → Blending 100 | Partly | Adobe confirms that legacy Split Toning **is** Blending = 100 and that old images look the same. The sidecar mechanism (field absent ⇒ 100) is inferred, not documented. Use 100 on import when `SplitToning*` is present and `ColorGradeBlending` is absent, and confirm with a real sidecar. |
| C4 Field names; shadows/highlights in `SplitToning*` | Partly | Field table confirmed against ExifTool 3.79 source, including the note that `SplitToning*` is "also used for newer ColorGrade settings". Hue scale is still unverified (see darktable note). Don't hard-code hue/255. |
| C5 Global: tint vs offset; wheel Luminance gain vs offset | Partly | Adobe calls Global "a color tint plus luminance adjustment to the entire image" and says Blending/Balance don't affect it. The maths is not public. Owner decision Q3 stands, and "unmasked tint over the whole image" matches Adobe's wording best. |
| C6 Release LrC 10.0 / ACR 13.0, October 2020 | Confirmed | Cite as is (blog dated 2020-10-20). |
| C7 Capture One Color Balance | Partly | Master wheel "replicates Capture One's original tool", and on Master the lightness slider "is deliberately disabled". No numeric ranges and no statement that it is multiplicative. Do not cite C1 as precedent for a multiplicative Global. |
| C8 ART Color Correction GUI and mask defaults | Partly | ART's manual describes colour wheels (one in Standard/Perceptual; three in "HSL factors" mode). Mask defaults are undocumented and ART's source could not be fetched. No change. |

## Item-by-item

### C1. Ranges and defaults — **Partly**
- Blending default 50, Luminance ±100, Saturation 0–100: **confirmed** by Adobe's launch post (Max Wendt, Adobe, 2020-10-20), https://blog.adobe.com/en/publish/2020/10/20/introducing-color-grading
  - "The default value is 50, which gives a nice amount of smoothing and independence to the ranges."
  - "There is a slider beneath each color wheel, with ranges from -100 to 100."
  - "When the handle is at the edge of the wheel, saturation = 100."
- Hue 0–360: **not stated**. The same post uses hue values in examples ("Shadow Hue to 240", "Set Midtone Hue to 120") but gives no range or unit.
- Balance: the range is not stated. Adobe's Camera Raw page shows it is signed around 0: "Values greater than 0 will increase the effect of highlights" / "values less than 0 will increase the effect of the shadows." (https://helpx.adobe.com/camera-raw/using/whats-new/2021.html)
- Blending range 0–100: Adobe gives the endpoints ("With blending set to 0" and "With the slider set to 100%"; jkost.com, secondary, Adobe evangelist blog, https://jkost.com/blog/?p=18167).

### C2. Wheel gestures — **Confirmed**
- Adobe help, LrC October 2020 feature summary (https://helpx.adobe.com/lightroom-classic/help/whats-new/2021.html):
  - "Holding the Shift key will restrict wheel movement for Saturation adjustments only."
  - "Holding the Ctrl key on Windows or Command key on macOS will restrict wheel movement" … "Hue adjustments only." (The page does not mention Alt.)
- Adobe blog (Max Wendt), same URL as C1:
  - "Hold down the shift key to keep your current hue and change only saturation."
  - "Hold down the command/control key to keep your current saturation and change only hue."
  - "Hold down the option/alt key to engage the Fine Adjust mode."
  - Reset: "Double-clicking/tapping on the handles will reset the value of that control to its default value."
- jkost.com (secondary): "Double click within a Color Wheel to reset the Hue and Saturation." · "Double click on the Luminosity slider to reset it." · "Double click “Adjust” to reset all sliders." · "Option -drag (Mac) | Alt -drag (Win) the Blending slider to temporarily boost the saturation to 100" · "Note: Fine Adjustment mode does not use the soft-constraint."

### C3. Sidecar with `SplitToning*` but no `ColorGradeBlending` — **Partly**
- Adobe blog (Max Wendt): "Split Toning didn't have any control over the Blending and always used what we now call Blending = 100." and "Your existing images with Split Toning settings will look exactly the same as they did before."
- Adobe help (LrC 10.0): "Set the blending slider to 100 to achieve the same effect as the pre-existing Split Toning feature."
- jkost.com (secondary): "When opening legacy files (or applying legacy presets that contain Split Tone settings), the color tints will be applied" … "in the Color Grading panel (using the Shadows and Highlight color wheels and the Blending slider if necessary)" … "to achieve a perfect match."
- **Not found:** an explicit statement that an *absent* `crs:ColorGradeBlending` is read as 100, and how process version affects this. That needs a real legacy sidecar opened in a current Lightroom (Not found, needs local test/sample).

### C4. Field names; where shadows/highlights live — **Partly**
- ExifTool 3.79 source (`$VERSION = '3.79'`), secondary, https://raw.githubusercontent.com/exiftool/exiftool/master/lib/Image/ExifTool/XMP.pm:
  - `SplitToningShadowHue        => { Writable => 'integer', Notes => 'also used for newer ColorGrade settings' },` (same note on `SplitToningShadowSaturation`, `SplitToningHighlightHue`, `SplitToningHighlightSaturation`, `SplitToningBalance`)
  - `ColorGradeBlending      => { Writable => 'integer' },` · `ColorGradeShadowLum     => { Writable => 'integer' },`
- The ExifTool tag table (https://exiftool.org/TagNames/XMP.html) lists `ColorGradeBlending`, `ColorGradeGlobalHue`, `ColorGradeGlobalLum`, `ColorGradeGlobalSat`, `ColorGradeHighlightLum`, `ColorGradeMidtoneHue`, `ColorGradeMidtoneLum`, `ColorGradeMidtoneSat`, `ColorGradeShadowLum`, all "integer/". No `ColorGradeShadowHue` or `ColorGradeHighlightHue` appears, which agrees with the brief's table.
- Hue range of `SplitToningShadowHue`: **Not found**. Caution: darktable's own Lightroom importer scales hue by 255, not 360. That is darktable's assumption, not Adobe's (https://raw.githubusercontent.com/darktable-org/darktable/master/src/develop/lightroom.c): `data->pst.shadow_hue = (float)v / 255.0;`. Do not copy this until a real sidecar settles it.
- No Lightroom-written XMP with a colour grade was found in public sources (needs local sample).

### C5. Global; wheel Luminance — **Partly**
- Adobe blog (Max Wendt): "The Global wheel applies a color tint plus luminance adjustment to the entire image, across all the ranges." · "Blending and Balance have no effect on the toning applied by the Global wheel." · "Luminance changes can be applied even without applying a color tint."
- ACR 13 help: the Global slider "lets you change the overall color of the photo" … "without affecting your previous color adjustments for shadows, midtones, or highlights."
- jkost.com (secondary): "The Luminance controls are intended to make color grading specific changes" … "and are optimized to adjust the color tinting ranges as changes are made to the Blending and Balance sliders."
- **Not found:** whether Global is implemented as an offset, slope or WB-style multiply, and whether wheel Luminance is gain or offset. Adobe does not publish the maths.

### C6. Release — **Confirmed**
- LrC help: the page title is "Feature summary | Lightroom Classic (October 2020 release)", and its description says "the October 2020 release of Lightroom Classic (version 10.0)" (https://helpx.adobe.com/lightroom-classic/help/whats-new/2021.html).
- ACR help: "(version 13.0)", "the October 2020 release of Adobe Camera Raw" (https://helpx.adobe.com/camera-raw/using/whats-new/2021.html).
- Adobe blog post dated 10-20-2020 (URL in C1).

### C7. Capture One Color Balance — **Partly**
- "The Color Balance tool overview" (updated 2024-06-28), https://support.captureone.com/hc/en-us/articles/360002594857: "The tool includes a Master color wheel that replicates Capture One's original tool in functionality" · "adjustment sliders for saturation and lightness" · "Although the saturation slider duplicates one of the functions of the color wheel" · "while lightening the highlights maintains fine gradations with a gentle roll-off."
- "Adjusting color balance" (updated 2025-03-16), https://support.captureone.com/hc/en-us/articles/360002594937: "As a result, the lightness slider is deliberately disabled." (Master/global mode) · "you may also adjust the Master color wheel slightly to fine-tune the overall color balance if needed." · "Click and drag the tab on the Lightness slider to adjust the density to taste."
- **Not found:** numeric slider ranges, and any statement that Master is multiplicative.

### C8. ART Color Correction — **Partly**
- ART reference manual, https://artraweditor.github.io/Reference: in "HSL factors" mode, "This mode provides an interface to manipulate tone and color using three separate color wheels for shadows, midtones and highlights." In Standard/Perceptual, the colour wheel "Adds the given colour (expressed in terms of hue and saturation) to the input pixels." The tone sliders "allow to define a tone curve that is then applied to the luminance component of the input pixels." The listed modes are Standard, Perceptual, Separate RGB channels, HSL factors and LUT. The manual does not name an a/b grid or a JzAzBz mode, which differs from the brief's list.
- ART local editing page, https://artraweditor.github.io/Localediting: "All tools in the Local editing group (Color Correction, Smoothing, Local Contrast and Texture Boost)" and "Adjustment layers apply an effect to the whole image unless the effect is constrained by one or more masks."
- **Not found:** mask defaults. **Blocked:** ART source on raw.githubusercontent.com (`artraweditor/ART` and `artpixls/ART`, fetch error) and the GitHub tree view (robots).

## Unresolved items
1. Hue scale of `SplitToning*Hue` / `ColorGrade*Hue` (0–360 vs 0–359 vs other). darktable divides by 255. Needs a real Lightroom sidecar.
2. Balance numeric range (±100 assumed). No Adobe text gives the numbers.
3. Absent `ColorGradeBlending` ⇒ 100? The behaviour is documented, but the mechanism is not. Needs a sidecar test.
4. Global and wheel-Luminance maths (offset, gain or tint). Not public.
5. Capture One ranges and Master's maths.
6. ART mask defaults; ART source unreadable from this machine.
