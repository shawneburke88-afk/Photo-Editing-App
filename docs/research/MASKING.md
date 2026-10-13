# Masking and local adjustments: design brief

**Prepared for:** Shawn Burke (LightBench) · **Research date:** 2026-10-13 · **Status:** research only, nothing built.
**Reads with:** docs/PLAN.md (Phase 3 list, Phase 4 AI masks),
PHASE3.md (Part 1 coordinates, Part 10 tone-equalizer mask, Part 11 Remove brush and process versions),
research/PHASE4_MODELS.md and research/AI_MODELS.md (AI mask models), USABILITY.md (lesson 8, "Masks: one click
first, refinement second, all in one panel").

**Conventions.**
- **[unconfirmed]** marks a claim from memory, a search-result snippet or another secondary source. The primary page
  could not be opened from this machine (helpx.adobe.com, Google Patents, Justia, USPTO, docs.darktable.org,
  rawpedia, Capture One support and most blogs failed DNS or returned 403 here).
- "(estimate)" marks a number that was worked out, not measured.
- **Read at source:** darktable `6271f53` (2026-10-11);
  LightCraft `701f78e` (2026-10-12, MIT/Apache); ExifTool `lib/Image/ExifTool/XMP.pm` version 3.79 (GitHub `master`,
  fetched 2026-10-13); RawTherapee `rtengine/params/locallab.h` (GitHub `dev`, fetched 2026-10-13); ART `b035ca5`
  (Bitbucket `master`, 2026-10-13); the WebGPU spec (`gpuweb/gpuweb` `main`, `25a5dc4`); LightBench `main` (`60b1170`).
- Nothing here is legal advice. The patent section lists facts found and what could not be read.

---

## Summary

- **Lightroom's model** (Classic 11, October 2021, and later): a photo has a list of **masks**. Each mask is made of
  **components** (Brush, Linear Gradient, Radial Gradient, Color Range, Luminance Range, Depth Range; AI Subject, Sky,
  Background, Objects, People, Landscape) combined with **Add, Subtract and Intersect**. Each mask carries its own set
  of local sliders, an **Amount**, and can be **inverted**. Masks are shown with an overlay in several modes. In XMP
  each mask is one `crs:MaskGroupBasedCorrections` item with a list of `crs:CorrectionMasks` components. The field
  names are confirmed from ExifTool; their meaning comes from LightCraft's reader and is **[unconfirmed]**.
- **darktable's model** is per module: each module (and each instance of it) can have a drawn mask (a group of
  circle, ellipse, path, brush and gradient shapes with union, intersection, difference, sum and exclusion), a
  parametric mask (thresholds on channels in a chosen colour space), or a raster mask taken from another module. The
  mask is then feathered with a guided filter, blurred, given contrast and brightness, and scaled by opacity.
  darktable **rasterises drawn masks on the CPU** and uploads them to OpenCL; only the post-processing runs on the GPU.
  Its maths (falloffs, combine operators, parametric trapezoid, mask tone curve) is short and translates directly.
- **LightCraft** (MIT/Apache) already implements a Lightroom-style mask list in Rust, with a Lightroom XMP reader
  (`crs_masks.rs`) and a compact way to store AI segmentations inside the edit (`segmask.rs`). Its AI masks use SAM 3,
  which LightBench excludes; its data model and storage ideas do not depend on that.
- **Recommendation for LightBench:** a mask-first panel, Lightroom-style, on top of LightBench's single develop
  shader. Masks hold vector geometry and are rasterised on the GPU into one small texture per mask, at view
  resolution for the preview and again from the vectors for export. Local sliders are **added** to the global ones,
  weighted by the mask, in scene-linear light **before the sigmoid**, in the same per-pixel pass as the global
  sliders. AI masks plug in later as one more component kind that stores a raster.
- **v1 scope proposed:** Brush, Linear, Radial, Luminance Range and Color Range; Add / Subtract / Intersect; invert;
  Amount; a whole-mask Feather/Refine; local Temp, Tint, Exposure, Contrast, Highlights, Shadows, Whites, Blacks,
  Saturation (and Vibrance). Spatial local sliders (Texture, Clarity, Dehaze, Sharpness, Noise, Moiré, Defringe) wait
  until their global tools exist.
- **No new process version is needed** to add masks, as with the Remove brush: an edit without masks has no `masks`
  key and must render byte-identically. Once shipped, the mask maths becomes part of the process version.
- **Biggest decisions for the owner:** the coordinate frame masks are stored in (sensor, like the Remove spots, or
  the straightened frame, like the crop), what range masks measure, Copy/Paste defaults, whether to read and write
  Lightroom's `crs:` masks, how AI rasters are stored, and whether to take advice on Adobe's active patent
  US 11,223,744 ("Local color range selection") before shipping range masks combined with shapes.

---

## Recommended v1 scope, and what comes later

### v1 (Phase 3)

| Area | In v1 | Why |
|---|---|---|
| Components | **Brush** (with Erase), **Linear gradient**, **Radial gradient**, **Luminance range**, **Color range** | Lightroom's manual components minus Depth Range. All five are cheap on the GPU. USABILITY.md says manual masks come in Phase 3 and AI in Phase 4. |
| Combining | **Add, Subtract, Intersect** per component; **Invert** per component and per mask | Lightroom's three modes. Lightroom's Intersect is also reachable as "Subtract + Invert" (search snippet, **[unconfirmed]**). darktable also has sum and exclusion; they are not needed for Lightroom parity. |
| Per mask | Name, eye (show/hide), **Amount** (scales all its sliders), **Feather** and **Refine edges** for the whole mask | Lightroom 15.5 (August 2026) added Feather and Edge controls; reports disagree whether they apply to all masks or only AI masks (REVIEWS_ROUND2.md; **[unconfirmed]**). Users asked for feathering on range masks too. darktable's guided-filter feathering does this for any mask. |
| Local sliders | **Temp, Tint, Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Saturation**, plus **Vibrance** (LightBench has it globally) | All are per-pixel maths in LightBench's develop shader today, so they cost almost nothing to make local (Architecture below). |
| Display | Overlay on/off (O in the mask context), colour and opacity, "Image on black/white" and "mask as grey" modes | Lightroom has several overlay modes (below). |
| Undo, Copy/Paste, presets | One history step per action; a **Masks** item in the paste checklist, unticked by default; presets may hold masks | As the Remove spots (PHASE3 Part 11). |

### Later

| Item | When | Notes |
|---|---|---|
| **AI components:** Subject, Sky, Background, Object (click/hover), People (and parts) | Phase 4 | SAM 2.1 Tiny (click/hover), BiRefNet-lite (subject), MediaPipe Selfie Multiclass (people), sky by rule + Depth Anything V2 Small (PHASE4_MODELS.md §3). Stored as rasters (Data model). |
| **ProRAW semantic mattes** (sky, skin, hair, teeth, glasses, person) | With AI masks, or earlier | No model needed. LightCraft reads them (`crates/raw/src/semantic.rs`, PHASE4_MODELS.md §3). |
| **Depth Range** | Phase 4 | Needs a depth map (Depth Anything V2 Small, already chosen for depth of field). Lightroom offers it "only for photos containing depth information" (search snippet, **[unconfirmed]**). |
| **Spatial local sliders:** Texture, Clarity, Dehaze, Sharpness, Noise, Moiré, Defringe | After each global tool exists | Each needs an extra image plane (a blur, a base layer, a denoised copy). Making them local means modulating that plane's strength per pixel (Architecture). |
| **Local Curve, Color (toning), Hue, Grain, Point Color** | After the global tone curve, colour grading, grain and point colour land | Lightroom Classic 12.4 (June 2023) added Grain sliders to masking, and its curve with Refine Saturation is available in masks (Adobe's feature summary via search snippet, **[unconfirmed]**). When Point Color reached masks was not found. |
| **Brush Auto Mask** (edge-aware brush) | After v1 | LightCraft has one (`auto_similarity` in `crates/pipeline/src/masks.rs`: luminance and chromaticity tolerance to the colour under each dab). |
| **Path (polygon/Bézier) and ellipse shapes** beyond Lightroom's | Optional | darktable's `path.c` (5,619 lines, mostly GUI) and `ellipse.c`. ART also has polygons. Not needed for Lightroom parity. |
| **Local adjustments in darktable XMP** (R2 18) | Later | Would need each mask expressed as darktable module instances with drawn and parametric masks; see "darktable's model". |

---

## How others do it

### Lightroom (Classic 11, October 2021, and later)

Adobe's help pages could not be opened here. Everything in this section comes from search-result snippets, community
posts quoted in LightBench's review documents, ExifTool's tag table and LightCraft's reader. All of it is
**[unconfirmed]** unless marked otherwise.

**Components.** Adobe's masking page (as summarised by search): masks are added "automatically with Subject, Sky,
Background, Landscape, Objects, or People" or "manually with Brush, Linear Gradient, Radial Gradient, or Range Masks";
the range masks are Color Range, Luminance Range and Depth Range, the last "enabled only for photos containing depth
information".

**Combining.**
- Each mask has its components listed under it. Shift adds a component and Alt/Option subtracts (jkost.com via search).
- Holding Alt/Option turns the Add and Subtract buttons into **Intersect**. The "…" menu of a mask also offers
  "Intersect with Mask" (several tutorials via search).
- Each component can be inverted. Inverting a whole mask group was requested in 2021 and marked Released on
  2022-06-14 (REVIEWS_ROUND2.md, Adobe Ideas).
- In XMP the component's `crs:MaskBlendMode` is 0, 1 or 2, which LightCraft reads as add, subtract and intersect
  (`crs_masks.rs`, from "black-box observation").

**Per-mask sliders.** ExifTool's `Correction` structure (read at source) lists these local fields:
`LocalExposure`, `LocalSaturation`, `LocalContrast`, `LocalClarity`, `LocalSharpness`, `LocalBrightness`,
`LocalToningHue`, `LocalToningSaturation`, `LocalExposure2012`, `LocalContrast2012`, `LocalHighlights2012`,
`LocalShadows2012`, `LocalClarity2012`, `LocalLuminanceNoise`, `LocalMoire`, `LocalDefringe`, `LocalTemperature`,
`LocalTint`, `LocalHue`, `LocalWhites2012`, `LocalBlacks2012`, `LocalDehaze`, `LocalTexture`, plus `CorrectionAmount`,
`CorrectionActive`, `CorrectionName`, `CorrectionSyncID`.
- So the Lightroom panel has, in today's names: Temp, Tint, Exposure, Contrast, Highlights, Shadows, Whites, Blacks,
  Texture, Clarity, Dehaze, Hue, Saturation, Sharpness, Noise, Moiré, Defringe and Color (toning hue and saturation).
- Later additions not in ExifTool's `Correction` table: a local **Curve** with Refine Saturation and **Grain**
  (Lightroom Classic 12.4, June 2023, per Adobe's feature summary via search), and Point Color in masks (a blog via
  search; date unknown). ExifTool's table may simply lag behind; LightBench should expect fields it doesn't know.
- LightCraft reads the `Local*` values as fractions −1…1 (×100 for the slider) and `LocalExposure2012` as a fraction
  of 4 EV (`crs_masks.rs`, `LOCAL` table). **[unconfirmed]**: from observation, not a specification.

**Amount.** "After making changes to the adjustment sliders, drag the Amount slider left/right to decrease/increase
the relative effect of all adjusted sliders" (search snippet). Its range was not found; LightCraft clamps it to
0–200 % when importing.

**Overlay.** From lightroomkillertips.com and jkost.com via search:
- Modes: **Color Overlay**, **Color Overlay on B&W**, **Image on B&W**, **Image on Black**, **Image on White**,
  **White on Black**.
- **O** toggles the overlay. **Shift+O** cycles the overlay colour in Color Overlay mode. The colour can be any colour,
  with an opacity slider. "Overlay Shows" chooses whether the affected or the unaffected area is tinted.

**Shortcuts** (search snippets): **Shift+W** opens and closes the Masks panel (Classic 11.2); **K** Brush; **M**
Linear Gradient; **Shift+M** Radial Gradient; **'** (apostrophe) inverts the current mask; **N** makes a new mask
with the last tool; **[ ]** brush size. Keys for Color Range and Luminance Range could not be confirmed.

**Feather and Edge (15.5, August 2026).** Adobe's release notes (via search): "Adjust the new Feather and Edge
controls when masking photos for more control and creative effects." One blog says they apply only to AI masks; Adobe
marked the "Feather Masks" idea Released (REVIEWS_ROUND2.md).

**Known complaints** (REVIEWS_LIGHTROOM.md, REVIEWS_ROUND2.md): the floating Masks panel auto-hides; Add/Subtract
were hard to find; the redesigned luminance range "only feathers out"; AI masks did not recompute after Copy/Paste
until a fix; AI masks live in a separate `.lrcat-data` file that must be backed up too; requests for mask
grouping, sub-mask opacity, re-ordering masks, default names by type, reusing masks as components.

**XMP storage.** See "Lightroom mapping" below for the full field list.

### darktable (source read at `6271f53`)

**Two mask systems per module, plus raster masks.** `src/develop/blend.h`:
- `mask_mode` is a bit set: `DEVELOP_MASK_ENABLED` (uniform), `DEVELOP_MASK_MASK` (drawn), `DEVELOP_MASK_CONDITIONAL`
  (parametric), `DEVELOP_MASK_RASTER` (raster), and drawn & parametric together.
- Every module instance has its own blend parameters, so "local adjustments" in darktable means another instance of
  exposure, color balance rgb, tone equalizer and so on, each with its own mask. Instances are ordered by
  `multi_priority`. This is the opposite of Lightroom's "one mask, many sliders"; USABILITY.md (R2 10) already chose
  Lightroom's way for LightBench.

**Drawn shapes** (`src/develop/masks.h`, `DEVELOP_MASKS_VERSION 6`): circle, ellipse, path (Bézier polygon), brush
(Bézier stroke with per-point border, hardness and density), gradient (anchor, rotation, compression, steepness,
curvature; linear or sigmoidal), group, and, with AI built in, **object** (`DT_MASKS_OBJECT`, `object.c`).
- **Coordinates:** shapes are stored normalised to the pipe's input image. When a module renders its mask, a grid of
  output points (every 1–4 px, depending on scale) is mapped **back** through every distorting module before it
  (`dt_dev_distort_backtransform_plus`), the shape is evaluated there, and the grid is interpolated
  (`circle.c` 1270-1340, `gradient.c` 1236-1360). So shapes stay on the content whatever the geometry does.
- **Falloffs:** circle: f = clamp((total² − d²) / (total² − radius²), 0, 1), mask = **f²** (quadratic, `circle.c`
  1160-1163, 1323-1331). Gradient: 0.5 + 0.5·(distance / compression) for linear, or 0.5 + 0.5·**erf**(distance /
  compression) for sigmoidal, along the distance to a parabola y = curvature·x² (`gradient.c` 1294-1345). Brush:
  a solid part set by hardness, then a falloff segment (`brush.c` `_brush_falloff`).
- **Combining** (`group.c` 490-632), each with the component's opacity and optional inversion:
  union = max(a, c); intersection = min(a, c); difference = a·(1 − c) where both are positive; sum = min(1, a + c);
  exclusion = max((1 − a)·c, a·(1 − c)).
- **GUI hints:** brush size by scroll, hardness by Shift+scroll; circle feather by Shift+scroll; gradient curvature by
  scroll, compression by Shift+scroll (`brush.c` 3399, `circle.c` 1396, `gradient.c` 1420).

**Parametric masks** (`src/develop/blends/`): a trapezoid per channel with four thresholds (0 below the first, a
ramp, 1 on the plateau, a ramp, 0 above the fourth), each channel optionally inverted, and the channels multiplied
(`blendif_rgb_jzczhz.c` 48-79, 161). Channel sets depend on the blend colour space: Lab (L, a, b, C, h), display RGB
(gray, R, G, B, HSL), **scene RGB (gray, R, G, B, Jz, Cz, hz)** and raw. Each can be taken on the module's input or
output.

**Post-processing** (`blend.c` 305-361 and 548-821), in this order:
1. Drawn mask (or uniform fill), inverted if asked.
2. **Details threshold** (`detail.c`; a Scharr edge mask that keeps the mask to detailed or flat areas).
3. Parametric mask, multiplied in.
4. **Feathering** with a guided filter (He, Sun and Tang; `src/common/guided_filter.c`): radius 0–250 px, guide =
   the module's input or output, before or after the blur (default: input, after blur, `blend.c` 41-63). The radius
   follows the pipe scale (`_required_w`: 2·radius·√scale).
5. **Blur** (Gaussian, 0–100 px).
6. **Mask tone curve:** contrast (e = exp(3·contrast)) and brightness, then × opacity (`blend.c` 429-464).

Then the module's output is blended with its input through the mask, with a blend mode (normal, multiply, etc.).

**Raster masks:** a module can publish its final mask; a later module can use it (`raster_mask_source`,
`raster_mask_instance`, `raster_mask_invert`), distorted through the modules in between (`blend.c` 650-680).

**AI object masks (darktable 5.6):** `object.c` runs SAM (encoder once, decoder per click, render size 1536 px by
default), optionally refines with DenseCRF, then **vectorises the result into path shapes with potrace**
(`common/ras2vect.c`). The mask is therefore stored as ordinary paths in the XMP, not as a raster. It records a hash of
the distortion modules at encode time to notice crop/rotate changes.

**XMP:** shapes are stored in `darktable:masks_history` with `mask_id`, `mask_type`, `mask_name`, `mask_num`,
`mask_points` (binary), `mask_nb`, `mask_src` (`src/common/exif.cc` 457-461).

**How darktable rasterises on the GPU: it doesn't.** The CL path calls the same CPU group renderer
(`_render_drawn_mask_cached`, "the group renderer runs on the host here too"), caches it, and uploads it with
`dt_opencl_write_host_to_image` (`blend.c` 1180-1236). Feathering (`guided_filter_cl`), blur (`dt_gaussian_blur_cl`),
the parametric mask and the mask tone curve run in OpenCL. LightBench has to write its own WGSL rasteriser.

**What can be translated** (GPL-3.0, keep the notices; darktable's copyright headers date `blend.c` from 2011 and
the mask shapes from 2013):

| darktable code | Use in LightBench | Effort |
|---|---|---|
| `group.c` combine functions | The five operators, one line each in WGSL | Trivial |
| `circle.c`, `ellipse.c`, `gradient.c` falloffs | Radial and linear gradient alphas, if darktable's falloffs are chosen over Lightroom-like ones | Small |
| `brush.c` falloff, hardness, density; Ramer-Douglas-Peucker | The brush (Part 11 already ported RDP and the radius convention) | Small to medium |
| `blendif_rgb_jzczhz.c` trapezoid and JzCzhz conversion | Luminance and colour range components | Small |
| `blend.c` `_develop_blend_process_mask_tone_curve` | A mask contrast/"Edge" control | Trivial |
| `guided_filter.c` | Feather / Refine edges. LightBench already has guided-filter statistics on the GPU for the tone equalizer (`tone-mask.wgsl`, PHASE3 Part 10) | Medium |
| `detail.c` | Optional "details" refinement | Medium |
| `path.c`, `object.c` | Not for v1 | Large |

### LightCraft (MIT/Apache, `701f78e`)

- **Data model** (`crates/develop/src/settings.rs` 825-1027): `Mask { id, name, visible, invert, components, adjust,
  refine }`; `MaskComponent { name?, op: add|subtract|intersect, invert, shape }`; shapes `Brush { strokes }`,
  `Linear { start, end }`, `Radial { center, rx, ry, angle, feather, invert }`, `ColorRange { samples (OkLab), refine }`,
  `LuminanceRange { lo, hi, lo_feather, hi_feather }`, `DepthRange`, `Subject`, `Sky`, `Background`,
  `Object { hint, exclude, seg, detail, edge }`, `Prompt { text, seg }` (SAM 3), `People { person, parts }`,
  `Landscape { class }`. `LocalAdjustments` has temp, tint, exposure, contrast, highlights, shadows, whites, blacks,
  texture, clarity, dehaze, hue, saturation, sharpness, noise, moire, defringe, color_hue, color_sat, amount.
  Coordinates are "normalized to the uncropped oriented image"; sizes in long-edge units.
- **Combining** (`crates/pipeline/src/masks.rs` 118-160): Add = max, Subtract = a·(1 − c), **Intersect = a·c**
  (product, unlike darktable's min). Then **Refine** (a cross guided filter on log luminance, window up to 4 % of the
  long edge), mask invert, × Amount.
- **Where they apply** (`crates/pipeline/src/finish.rs` 391-520): one per-pixel stage in scene-linear Rec.2020.
  Each mask's slider values are turned into "terms"; per pixel the terms are summed weighted by each mask's alpha and
  **added to the global values** (e.g. `dz = dehaze + l_dehaze`, `hh = hl + l_hl`). Local exposure is a gain, local
  temp/tint a luminance-preserving channel scaling, tone and detail sliders act in log luminance. This is before its
  tone map.
- **GPU:** `crates/gpu/src/wgsl/mask.wgsl` evaluates one component per pass (linear, radial, luminance range, colour
  range, brush) into a plane, then combines.
- **Brush:** dabs every r/4 along the path, a hard core then a smooth falloff, flow accumulating up to density
  (`masks.rs` 430-528).
- **AI rasters in the edit** (`crates/develop/src/segmask.rs`): a `SegMask` is up to 1024 × 1024 logits over the
  uncropped image stretched to a square, quantised to i8 in steps of 1/8, deflated and base64-encoded, with an
  optional rectangle for zoomed-in detail passes (at most 4). Coverage is the sigmoid of the bilinearly sampled logit,
  "so edges stay smooth at any output size". Rendering never needs the model.
- **Lightroom reader** (`crates/engine/src/crs_masks.rs`, `docs/xmp-interop.md`): reads `MaskGroupBasedCorrections`
  and the older `GradientBasedCorrections`, `CircularGradientBasedCorrections`, `PaintBasedCorrections`; reports what
  it can't carry over. "Implemented from the public XMP data model and black-box observation; best effort."

### Capture One (no primary page could be opened; all **[unconfirmed]**)

- Adjustments live on **layers**; each layer has a mask and an opacity (search snippets of Capture One's support
  pages and tutorials).
- Mask tools: Draw Mask (brush), **Magic Brush** (selects by colour with a Tolerance), Linear Gradient, Radial
  Gradient, Healing and Cloning masks, Eraser, Magic Eraser; **Refine Mask** (right-click on a layer); **Luma Range**
  applied to an existing mask.
- Gradients can be **rasterised** and then painted on, which suggests Capture One masks are bitmaps underneath.
- "From Capture One 16.7.0, you can combine different masks on the same layer using Add, Subtract, and Intersect",
  and gradients and Luma Range stay editable after combining.
- AI masking arrived in 16.3 (REVIEWS_ROUND2.md lesson 10).
- Reviewers name layers as Capture One's main advantage over Lightroom (REVIEWS_LIGHTROOM.md), and "Add Layers to
  Lightroom" is Adobe's oldest open idea (2011).

### RawTherapee Local Adjustments (`rtengine/params/locallab.h`, read at source)

- A list of **control spots**. Each spot has a shape (`ELI` ellipse or `RECT` rectangle) with four independent extents
  (`loc`: locX, locXL, locY, locYT), a centre, a transition (`transit`, `feather`, `transitweak`, `transitgrad`), and
  a method: **normal or excluding** (`spotMethod`: norm, exc).
- The selection inside a spot is also limited by **colour difference** to the spot's reference ("scope", `sensi`,
  deltaE settings `colorde`, `colorscope`, `balan`), so a spot is a shape AND a colour range by design.
- Each spot holds tools: Color & Light, Exposure, Shadows/Highlights, Vibrance, Soft Light, Blur & Noise, Tone
  Mapping, Retinex, Sharpening, Local Contrast, Contrast by detail levels, Log encoding, and a per-tool mask section
  (curves on L, C, H; structure mask).
- Powerful but known to be hard to learn (REVIEWS_OPEN_SOURCE.md's overlapping-tools lesson applies). CPU only.

### ART (Alberto Griggio's RawTherapee fork; `src/engine/procparams.h`, `masks.cc`, read at source)

- Masks attach to four "maskable" tools: Color correction, Smoothing, Texture boost, Local contrast
  (`ProcParams::get_maskable`, `procparams.cc` 6398-6402). Each tool has a list of masks (one per region).
- One `Mask` combines: a **parametric mask** (curves on hue, chromaticity, lightness, plus detail and a contrast
  threshold), an **area mask** (rectangles with roundness, polygons, gradients; each shape **Add, Subtract or
  Intersect**, with feather, blur and a contrast curve), a **deltaE mask** (L, C, H reference, range, decay, weights),
  a **drawn mask** (strokes of x, y, radius, opacity, erase; modes intersect, add, add-bounded; feather, smoothness,
  contrast curve), an **external mask** (a raster file on disk, with feather), and a **linked mask** (reuse another
  tool's mask). Then curve, posterization, smoothing and opacity.
- Two ideas worth noting: the **external mask file** (a raster stored next to the edit, which is what LightBench's AI
  masks will need) and the **linked mask** (Lightroom users ask to reuse masks as components).

---

## Architecture options for LightBench on WebGPU

### Where local adjustments run

LightBench's whole develop transform is one fragment shader (`web/src/engine/gpu/develop-display.wgsl`,
`developRec2020`): white-balance fix → exposure → tone equalizer (Highlights/Shadows/Whites/Blacks, with the EIGF mask
in process version 2) → vibrance/saturation → **sigmoid**. Export, thumbnails, the histogram and Auto all use it.

**Recommendation: apply masks inside that pass, in scene-linear Rec.2020, before the sigmoid.** This matches darktable
(exposure, tone equalizer and color balance rgb all sit before sigmoid/filmic in the scene-referred order) and
LightCraft (local adjustments before its tone map). Local sliders then behave like the global ones and keep highlights
recoverable.

**How local values combine:** per pixel, each local slider's value is the global value plus the sum of
(mask alpha × the mask's local value) over the masks, as LightCraft does and as Lightroom's overlapping masks appear
to behave **[unconfirmed]**. Amount scales a mask's alpha.

| Local slider | How it can work in LightBench's shader | Cost | v1? |
|---|---|---|---|
| **Exposure** | Multiply by 2^(Σ αᵢ·EVᵢ) after the global exposure | 1 exp2 | Yes |
| **Temp / Tint** | Relative chromatic adaptation in Rec.2020, luminance-preserving: blend each mask's 3×3 adaptation matrix towards identity by α (M = I + Σ αᵢ(Mᵢ − I)). Lightroom's local Temp/Tint are relative −100…100, not kelvin **[unconfirmed]**; the mapping to a CCT shift is LightBench's to design | 9 MACs per mask | Yes |
| **Highlights, Shadows, Whites, Blacks** | Per pixel, band gains (EV) = global bands + Σ αᵢ·localBandsᵢ, using the photo's process-version weights (`toneBands`). darktable's fit of 9 bands onto 8 Gaussians is least squares on the **linear** gains 2^band (`tone-equalizer.ts`, `toneEqualizerFactors`), so it is one fixed 8 × 9 matrix: per pixel 9 exp2 and 72 multiply-adds, then the existing `toneCorrection`. The EIGF luminance mask is shared. The 0.25…4 clamp still applies, so global plus local can saturate at ±2 EV | ~100 ops | Yes |
| **Contrast** | Global Contrast is the sigmoid's contrast. Two options: (a) a per-pixel sigmoid contrast (global + Σ α·local), since the sigmoid is evaluated per pixel anyway; (b) darktable color balance rgb's scene-referred contrast before the sigmoid, Y' = fulcrum·(Y / fulcrum)^contrast with the grey fulcrum 0.1845 (`src/iop/colorbalancergb.c` 99-100, 767). (b) is more darktable-like and doesn't change the display transform per pixel | small | Yes (pick one) |
| **Saturation, Vibrance** | The existing chroma scaling with global + Σ α·local | small | Yes |
| **Hue, Color (toning)** | Per pixel, but there is no global equivalent yet | small | Later |
| **Texture, Clarity, Dehaze** | Need a blurred/base plane (LightCraft: a Gaussian on log luminance for texture, a fast guided filter for clarity, a dark-channel blur for dehaze). The plane is computed once per photo; local strength modulates its use per pixel | One plane each | After the global tools |
| **Sharpness, Noise, Moiré, Defringe** | Sharpening: blend Y towards the sharpened Y by a local amount (the RL capture sharpener planned in DETAIL_DENOISE_SHARPEN.md is a blend `mask·Y_rl + (1 − mask)·Y` already). Noise: blending towards a denoised copy needs that copy at the strongest local setting: a full-size plane | Large planes | After the global tools |
| **Curve, Grain, Point Color** | After their global tools; a local curve is a second curve lookup per pixel | — | Later |

**Old edits stay byte-identical** if the shader keeps today's path when a photo has no masks (a separate pipeline
variant or a uniform branch on "mask count = 0"). The per-pixel tone-band path above gives slightly different
rounding from today's precomputed factors, so it should only run when masks exist.

### Rasterising components

A mask is evaluated in the frame the shader draws: output pixel → straightened frame → (geometry map) → sensor.
Per component:

| Component | How | Notes |
|---|---|---|
| Linear, Radial | **Analytic**, in a compute pass (or even directly in the display shader): distance along the gradient axis, or normalised elliptical radius, through a falloff curve | Resolution-independent. The falloff is a choice: darktable's (linear or erf for gradients, f² for circles) or a smoothstep (LightCraft). Matching Lightroom's look needs its falloff measured **[unconfirmed]** |
| Brush | **Rasterise the dabs** into an `r16float` texture with a render pass of instanced quads. Standard alpha blending (out = src + dst·(1 − srcA) with src = density·k, srcA = k) gives "flow accumulates towards density"; erasing is dst·(1 − k) | `r16float` and `r8unorm` are renderable and blendable in core WebGPU; they are storage textures only with the `texture-formats-tier1` feature (spec format table). Re-rasterised from the vectors at export resolution |
| Luminance range, Color range | **Per pixel from the image**, in the same compute pass, reading the scene texture at the mask's resolution | No storage. Needs a decision on which image they measure (below) |
| AI (later) | **Sample a stored raster** (bilinear, then sigmoid if logits) | Like LightCraft's `SegMask` |

**One texture per mask.** A compute pass evaluates a mask's components and combines them into one `r16float` alpha
texture, then applies Feather/Refine and Amount. The display shader reads all masks from a `texture_2d_array` (one
layer per mask) plus a storage buffer of each mask's local values. WebGPU's guaranteed limits allow 256 array layers
and 16 sampled textures per stage (spec, defaults), so the number of masks is not limited by bindings. The display
shader already uses `img`, the tone-mask statistics and the raw buffer.

**Resolution.**
- **Preview:** mask textures at the size the view renders (fit or the visible 100 % region). Masks are recomputed
  only when a mask changes, the view size changes, or (for range masks) the image they measure changes. Slider drags on
  a mask's adjustments reuse the textures.
- **Export:** re-evaluate from the vectors at full size. Memory (estimate): a 24 MP (6000 × 4000) `r16float` layer is
  48 MB, a 45 MP one 91 MB; 20 masks at 24 MP would be 960 MB, too much next to the 192 MB scene texture. Options:
  (a) render each mask's contribution in turn into a few accumulation planes, (b) export in tiles, or (c) evaluate
  smooth components at a capped mask resolution (e.g. 4096 px long side: 22 MB per layer) and keep only brush edges
  and AI edges at full resolution with a guided upsample. The engine choice can wait for the build; the brief only
  notes that the full-size path needs a plan. (WebGPU's guaranteed `maxTextureDimension2D` is 8192; LightBench
  presumably already requests more for large sensors.)
- At preview size a 2048 × 1365 `r16float` layer is 5.6 MB (estimate), so dozens of masks fit easily.

**Feather and Refine edges** for a whole mask: a Gaussian blur (darktable's blur radius) and a guided filter with the
photo's log luminance as the guide (darktable's feathering guide; LightCraft's Refine). LightBench already computes
guided-filter statistics on a coarse grid for the tone equalizer (`tone-mask.wgsl`), which a cross guided filter can
reuse in form if not in data.

**Combine operators.** Add = max is common to darktable and LightCraft. For soft masks Intersect differs: darktable
uses min(a, c), LightCraft a·c. Subtract: darktable and LightCraft both use a·(1 − c). Lightroom's exact maths is
unknown **[unconfirmed]**. Open question 3.

### The coordinate frame: a decision

PHASE3 Part 1 stores the crop normalised in the **straightened frame** (after lens, perspective and straightening, in
the final orientation, before the crop), and `geometry.ts` says "Crop coordinates (and later mask coordinates)
therefore stay on the same content when lens or Upright settings change." For masks this needs care:

- In the straightened frame, a mask stays on the content when the **crop** changes, and turns and flips move it with
  the photo (as they move the crop). But when the **angle, Upright or lens correction** change after a mask was drawn,
  the content moves inside the straightened frame and a mask stored there does not follow it. A brush stroke along a
  horizon would drift off the horizon after Upright. (The crop behaves the same way; it is shrunk or kept, not moved
  with the content.)
- The Remove spots (Part 11) chose **sensor coordinates**, as darktable stores all its shapes, and they stay under
  their pin through rotation, crop and lens changes (tested).

Options:
1. **Sensor coordinates for all control points, shapes evaluated in the frame (recommended).** Store anchors, dab
   centres and radii in sensor-normalised coordinates, like the spots. Each render maps the anchor points forward
   through the geometry (`sensorToDisplay` exists in `develop-engine.ts`), then evaluates the shape in the
   straightened frame: a linear gradient stays a straight line on screen, a radial stays an ellipse, but both stay on
   their content. AI rasters are stored in the sensor frame and warped by the same single geometry map as the image.
   Painting maps the pointer back with `displayToSensor` (already used by the Remove brush).
2. **Straightened-frame coordinates,** as written in Part 1. Simpler maths, matches the crop, but masks drift when
   geometry changes later.
3. **Sensor coordinates evaluated in sensor space,** as darktable does (shapes are curved by lens distortion on
   screen). Exact, but a "linear" gradient would not look straight on a distorted lens.

What Lightroom's `crs:` mask coordinates are relative to (before or after Transform, before or after the crop) was
not found **[unconfirmed]**; LightCraft treats them as fractions of the image's width and height. Interop needs this
answer whatever LightBench chooses.

### Range masks: what they measure

- **Luminance range:** darktable's parametric masks measure the module's input or output; Lightroom's luminance range
  is shown on a "luminance map" and its XMP stores perceptual lightness (`LumRange`, four numbers 0…1, per
  LightCraft) **[unconfirmed]**.
- Options: measure (a) the scene before any global edit (the selection never moves when sliders move), (b) after
  global white balance and exposure but before the tone sliders and all local adjustments, or (c) the displayed
  result. A mask must never depend on its own adjustments (no feedback). **Recommended: (b)**, on a perceptual
  lightness scale (e.g. L* or darktable's Jz) so 0–100 matches what the user sees, with exposure handled exactly
  (exposure is a gain, so (a) and (b) differ by a shift). Open question 4.
- **Color range:** sample points with a picker (Shift-click to add), plus a Refine/Amount. A perceptual space keeps
  distances meaningful: darktable's scene-RGB parametric mask uses **JzCzhz** (`blendif_rgb_jzczhz.c`), LightCraft
  uses **OkLab** with a tuned tolerance (`color_range_tolerance`, `masks.rs` 415-428). "darktable first" suggests JzCzhz.
  Adobe's patent US 11,223,744 is about exactly this kind of selection (Patents).

### Performance limits (estimates; nothing measured)

- **Per-pixel cost in the display shader:** one texture-array sample per mask plus about 30 operations (exposure,
  saturation, contrast) and ~100 for the tone bands. With 20 masks on 24 MP that is ~0.5 G samples per export render:
  well within a discrete GPU, a few hundred ms on an integrated one (estimate). The preview cost scales with the view,
  not the photo.
- **Mask evaluation:** analytic components are nearly free; a brush of 1,000 dabs is 1,000 quads; range masks read
  the scene once.
- **Sensible caps** to protect against hostile files and slow GPUs: e.g. 64 masks, 32 components each, 10,000 dabs per
  brush component (LightBench's choice; Lightroom's limits were not found). LightCraft caps AI detail patches at 4 and
  SegMask sides at 1024.
- **Auto for a masked area** (owner's Phase 4 request) needs the statistics pass (`renderStats`) to weight pixels by a
  mask texture; designing the texture array now makes that easy.

### Undo and history

- One history step per action: new mask, add/subtract/intersect a component, move/resize a component (on release),
  each slider change (one step per drag, as today), invert, rename, delete, reorder, Amount. Selecting a mask or
  toggling the overlay is not history (as Lightroom's view state).
- Brush strokes: one step per stroke (button down to up), as the Remove brush.
- History labels name the mask: "Mask 2: Exposure +0.50", "Mask 2: add Linear gradient".

### Copy/Paste, Sync and presets

- **Paste checklist:** a **Masks** group, unticked by default (masks belong to one photo, as Remove spots do). When
  ticked, list each mask by name ("Sky darken (Linear, Luminance range)") so they can be picked one by one. Pasted
  masks **replace** the target's masks (as spots) or are **added** (as LightCraft does for presets): open question 7.
- **Geometry on another photo:** brush and gradients paste at the same normalised positions (sensor coordinates on the
  same camera = the same place); range masks re-measure the target, which is usually what users want.
- **AI masks recompute on paste** (Lightroom users asked for this and Adobe marked it Released; REVIEWS_ROUND2.md).
- **Auto Sync:** never sends masks unless the owner decides otherwise (as spots).
- **Presets:** presets may hold masks. Range-only and AI masks make sense in presets (Lightroom's "adaptive presets"
  use AI masks, REVIEWS_LIGHTROOM.md); brush masks rarely do. The preset Amount slider (0–200 %) should scale each
  mask's local values, not the mask alphas.

### How AI masks plug in later

- One more component kind: `{ kind: 'ai', what: 'subject' | 'sky' | 'background' | 'object' | 'people', model,
  modelVersion, prompt, raster }`. The prompt is the clicks or box for SAM 2.1, the part list for people.
- **Store the raster, not just the prompt.** GPU inference is not guaranteed bit-identical across GPUs and drivers, and
  models get updated. Storing the result keeps every render and export identical, the same rule as the Remove brush's
  stored source. The prompt and model id allow a "Recompute" button and recompute-on-paste.
- **Where the raster lives** (open question 10):
  - (a) **Inside the edit**, compressed (LightCraft: ≤ 1024² i8 logits, deflate, base64; a typical mask might be tens
    of kilobytes (estimate), more for busy edges). Travels with the XMP sidecar, so it survives a cleared browser.
  - (b) **A file next to the photo** (e.g. `DSC_0001.lbmask/…png`), referenced by digest from the edit, like ART's
    external mask. Keeps XMPs small but adds files to the user's folders.
  - (c) **Catalog only** (OPFS), with a digest in the edit and recompute when missing: Lightroom's approach
    (`.lrcat-data`, `MaskDigest`), which its users find fragile (REVIEWS_LIGHTROOM.md).
  - (d) **Vectorise** to paths, as darktable 5.6 does with potrace. Fully in the XMP, editable as shapes, but loses
    soft hair edges.
- **Frame:** run the model on the rendered straightened frame (what the user sees), then store the raster in the
  sensor frame (one inverse warp at creation) or with the geometry hash it was made under (darktable's
  `_compute_distort_hash`, LightCraft's `rect`). With option 1 above, sensor storage keeps it on the content.
- **Edge quality:** logits plus a sigmoid upsample smoothly (LightCraft); a guided-filter refine on the full-size photo
  sharpens hair and leaves. Lightroom 15.5's Feather/Edge are the user-facing controls for this.

---

## UX

**Panel.** USABILITY.md lesson 8 and REVIEWS_LIGHTROOM.md lesson 14: one click first, refinement second, all in one
panel; more powerful than Lightroom (grouping, opacity, feather).
- A **Masks** group in the tool stack (jump bar entry) rather than a floating panel: Lightroom's floating, auto-hiding
  Masks panel is a known complaint. The on-photo tools (pins, handles) appear when the group is active.
- Top: "New mask" buttons with icons: Brush, Linear, Radial, Color range, Luminance range (and later Subject, Sky,
  Background, Object, People in a separate, labelled AI row; AI stays opt-in, R2 11).
- The mask list: each mask with a small thumbnail of its alpha, its name, an eye, and its components underneath with an
  operator badge (+, −, ∩), an invert toggle and a delete. Drag to reorder. Right-click: Duplicate, Duplicate and
  invert, Rename, Intersect with…, Add to…, Subtract from….
- Under the list, the selected mask's **Amount**, **Feather**, **Refine edges**, then its local sliders in the same
  groups and order as Basic (White balance, Tone, Presence), with the same hints. A "Reset mask sliders" link.
- Every mask has a default name by type ("Linear 1", "Sky 1"), which Lightroom users asked for.

**Overlay.**
- **O** toggles the overlay of the selected mask. Modes: colour overlay (default **red at ~50 %**, Lightroom's
  convention **[unconfirmed]**), colour overlay on greyscale, image on black, image on white, white on black (the mask
  itself). darktable's equivalent is yellow over a greyscale image (`src/iop/gamma.c` `_mask_display`).
- The colour and opacity can be picked; red/green colour-blind users need a non-red choice (e.g. magenta or cyan).
- While dragging a handle or a range slider, show the mask automatically and hide it on release (Lightroom's
  Alt-drag shows a greyscale preview for range sliders, per search **[unconfirmed]**).
- The overlay shows the **final** mask of the selected mask; Alt-hover over a component shows that component alone.

**Keyboard** (a new context "Develop: masking", like "Develop: cropping", so it doesn't clash):

| Action | Proposed key | Lightroom (search snippets, **[unconfirmed]**) | LightBench today |
|---|---|---|---|
| Open/close the Masks group | Shift+W | Shift+W | free |
| New Brush mask | K | K | free |
| New Linear gradient | M | M | free |
| New Radial gradient | Shift+M | Shift+M | free |
| Color range / Luminance range | no key (command search) until Lightroom's are checked | not confirmed | — |
| Toggle overlay | O (masking context only) | O | O = Show clipping in Develop (darktable's key) |
| Cycle overlay colour / mode | Shift+O (masking context only) | Shift+O | Shift+O = sensor clipping in Develop |
| Invert the selected mask | ' (apostrophe) | ' | free |
| New mask with the last tool | N (masking context) | N | N is Survey in the Library and culling; free in Develop |
| Brush size / feather | [ ] / { } | [ ] | [ ] { } are the Remove brush's keys in its own context |
| Add / subtract / intersect while creating | Shift / Alt / Alt+Shift held (or the panel buttons) | Shift adds, Alt subtracts, Alt turns Add/Subtract into Intersect | — |
| Erase while brushing | Alt held | Alt **[unconfirmed]** | — |
| Show/hide pins | H | H (Remove brush) | H in Remove |
| Delete component | Delete / Backspace | — | as Remove |
| Done / cancel creation | Enter / Esc | — | as crop |

All keys go through the shortcut registry, so they can be remapped, and both shortcut sets get the masking context.

**Touch and pen** (mobile is "later", but the PLAN asks for touch-capable controls now):
- Pointer Events give `pressure` for pens; darktable maps pressure to hardness, opacity or brush size
  (`dt_masks_pressure_sensitivity_t`). Offer pressure → size or flow, off by default.
- No modifier keys on touch: the Add/Subtract/Intersect and Erase choices must be visible buttons.
- Two-finger pan and pinch zoom while a brush is active; one finger paints.
- Handles and pins large enough for a finger (e.g. ≥ 44 CSS px hit areas; Apple's guidance is 44 pt, from memory
  **[unconfirmed]**).

---

## Data model and storage

**Proposed shape** (illustrative, TypeScript; names are LightBench's to choose):

```ts
interface DevelopSettings {
  // …existing fields…
  /** Local adjustments. Optional: edits without masks have no such key and render byte-identically. */
  masks?: LocalMask[]
}

interface LocalMask {
  id: string               // stable id (history labels, paste picking, Lightroom MaskSyncID-style mapping)
  name: string
  visible: boolean         // the eye
  invert: boolean
  amount: number           // 0…200 %, scales the local values
  feather?: number         // whole-mask blur, fraction of the long edge
  refine?: number          // 0…100, guided filter on log luminance
  components: MaskComponent[]
  adjust: Partial<LocalAdjust>   // only non-zero values are stored
}

interface MaskComponent {
  id: string
  op: 'add' | 'subtract' | 'intersect'
  invert: boolean
  opacity?: number         // darktable has per-shape opacity; Lightroom users ask for sub-mask opacity
  shape:
    | { kind: 'linear'; full: Pt; zero: Pt }                 // effect 100 % at `full`, 0 % at `zero` (Lightroom's FullX/ZeroX idea)
    | { kind: 'radial'; center: Pt; rx: number; ry: number; angle: number; feather: number }
    | { kind: 'brush'; strokes: BrushStroke[] }               // points, size, feather, flow, density, erase
    | { kind: 'luminanceRange'; lo: number; hi: number; loFeather: number; hiFeather: number }
    | { kind: 'colorRange'; samples: [number, number, number][]; refine: number }
    | { kind: 'depthRange'; lo: number; hi: number; feather: number }     // Phase 4
    | { kind: 'ai'; what: string; model: string; modelVersion: string; prompt: unknown; raster: RasterRef } // Phase 4
}

interface LocalAdjust {
  temperature: number; tint: number; exposure: number; contrast: number
  highlights: number; shadows: number; whites: number; blacks: number
  saturation: number; vibrance: number
  // later: texture, clarity, dehaze, hue, sharpness, noise, moire, defringe, colorHue, colorSaturation, curve, grain
}
```

- `Pt` is in the frame chosen in open question 1 (recommended: sensor-normalised, as `Spot.points`).
- Sizes: brush radius as a fraction of the sensor's shorter side, as the spots (darktable's `border`).
- **Sidecar:** inside `lightbench:Develop` like everything else; XMP stays readable by other apps, which ignore it.
- **Normalising:** `normalizeSettings` drops an empty `masks` list (as `normalizeSpots` does), clamps values, caps
  counts, and ignores unknown component kinds from newer versions (keeps them but doesn't render them, and says so,
  like an edit from a newer LightBench).

---

## Lightroom mapping

**Field names confirmed** from ExifTool `XMP.pm` 3.79 (`%sCorrection`, `%sCorrectionMask`, `%sCorrRangeMask`,
`%sAreaModels`, and the `crs` table 1570-1600, 1650-1662, 1818-1890):

| Container (top level `crs:`) | Since (ExifTool comment) | Items |
|---|---|---|
| `GradientBasedCorrections` | "new LR2 crs structures" | `Correction` list |
| `PaintBasedCorrections` | LR2 | `Correction` list |
| `CircularGradientBasedCorrections` | "new tags written by LR5" | `Correction` list |
| **`MaskGroupBasedCorrections`** | "new for LightRoom 11.0" | `Correction` list |
| `RangeMaskMapInfo` | LR 11 | `RangeMaskMapInfo` → `RGBMin`, `RGBMax`, `LabMin`, `LabMax`, `LumEq` |
| `DepthBasedCorrections` | ACR 16 era (with Lens Blur) | `CorrectionActive`, `CorrectionAmount`, `CorrectionMasks`, `CorrectionSyncID`, `LocalCorrectedDepth`, `LocalCurveRefineSaturation`, `What` |

- **`Correction`** (= one Lightroom mask): `What`, `CorrectionAmount`, `CorrectionActive`, the `Local*` fields listed
  above, `CorrectionRangeMask`, `CorrectionMasks` (a Seq of `CorrectionMask`), `CorrectionName`, `CorrectionSyncID`.
- **`CorrectionMask`** (= one component): `What`, `MaskValue`, `Radius`, `Flow`, `CenterWeight`, `Dabs`, `ZeroX`,
  `ZeroY`, `FullX`, `FullY`, `Top`, `Left`, `Bottom`, `Right`, `Angle`, `Midpoint`, `Roundness`, `Feather`, `Flipped`,
  `Version`, `SizeX`, `SizeY`, `X`, `Y`, `Alpha`, `CenterValue`, `PerimeterValue`, and from LR 11: `MaskActive`,
  `MaskName`, `MaskBlendMode`, `MaskInverted`, `MaskSyncID`, `MaskVersion`, `MaskSubType`, `ReferencePoint`,
  `InputDigest`, `MaskDigest`, `WholeImageArea`, `Origin`, `Masks` (nested `CorrectionMask`, self-referential), and
  `CorrectionRangeMask`.
- **`CorrectionRangeMask`**: `Version`, `Type`, `ColorAmount`, `LumMin`, `LumMax`, `LumFeather`, `DepthMin`,
  `DepthMax`, `DepthFeather`, and from LR 11 `Invert`, `SampleType`, `AreaModels` (Seq of
  `ColorRangeMaskAreaSampleInfo`, `AreaComponents`), `LumRange`, `LuminanceDepthSampleInfo`.

**Meanings** (LightCraft's reader and its interop notes; observation-based, **[unconfirmed]**):

| Lightroom | LightBench (proposed) | Note |
|---|---|---|
| `Correction` with `CorrectionName`, `CorrectionAmount`, `CorrectionActive` | `LocalMask` name, amount, visible | Inactive corrections are skipped by LightCraft |
| `Local*2012`, `LocalTexture`, `LocalDehaze`, `LocalTemperature`, `LocalTint`, `LocalSaturation`, `LocalHue`, … | `adjust.*` | Stored −1…1 (×100); `LocalExposure2012` × 4 EV. Lightroom's slider responses differ from LightBench's, so values map approximately, as PLAN.md already says for global sliders |
| `What = "Mask/Gradient"`: `FullX/Y`, `ZeroX/Y` | `linear` | Full effect at the Full point |
| `What = "Mask/CircularGradient"`: `Top/Left/Bottom/Right`, `Angle`, `Feather`, `Flipped` | `radial` | Box in image fractions; `Flipped` = inverted |
| `What = "Mask/Paint"`: `Dabs` (strings "d x y"), `Radius`, `Flow`, `CenterWeight`, `MaskValue` | `brush` | `MaskValue` ≤ 0 erases; `CenterWeight` ≈ feather |
| `What = "Mask/Image"`, `MaskSubType` 1 / 2 | AI subject / sky | Other subtypes not identified. Mask/Image entries carry a `MaskDigest`; a missing digest means "needs recompute" (an Adobe forum script via search) |
| `What = "Mask/RangeMask"`, `CorrectionRangeMask.Type` 2 / 3 with `LumRange` / `DepthRange` ("a b c d") | luminance / depth range | Colour range (another Type) not decoded by LightCraft; `AreaModels` probably holds the samples |
| `MaskBlendMode` 0 / 1 / 2, `MaskInverted` | op add / subtract / intersect, invert | |
| `CorrectionName = "Mask 1"`, `MaskName = "Subject 1"` | names | An Adobe community thread, via search |

**Options:** (1) read Lightroom's masks from sidecars that hold them, best effort, as Part 7 did for the crop;
(2) also write them, so Lightroom shows LightBench's masks; (3) neither, for now (Lightroom import was postponed for
lack of a test catalog). Writing is risky: partial `Mask/Image` entries without digests would make Lightroom
recompute, and coordinates need the frame answer above. Open question 8.

---

## Process version needs

- **Adding masks needs no new process version.** It is a new tool, off unless used, like the Remove spots. An edit
  without `masks` has no key, its sidecar is byte-identical, and the shader takes today's path. Tests: the same
  full-size export hashes before and after, as Parts 1, 10 and 11 did.
- **Local sliders reuse each process version's mappings** (`processParams(version)`: tone range, band weights,
  contrast spread). A version-1 edit with masks uses version 1's weights for its local Shadows too.
- **Once released, the mask maths is frozen per process version:** falloff curves, combine operators, feather and
  refine filters, range-mask scales, brush dab spacing and flow, local temp/tint and contrast formulas. A later change
  that alters pixels of a saved mask needs a new process version (or a per-mask `version`, as Lightroom's
  `MaskVersion` and darktable's `DEVELOP_MASKS_VERSION` suggest). Put these in `ProcessParams.masks`.
- **AI rasters** are stored results, so a model update doesn't change old edits; "Recompute" is an explicit,
  undoable step.

---

## Patents (facts only, not legal advice)

Patent pages (Google Patents, Justia, USPTO, EPO) could not be opened here. The facts below come from search-result
snippets and are **[unconfirmed]**. Claims were not read.

**Nik / Google "U Point" (control points)**
- **US 6,728,421** "User definable image reference points": the parent. Filed 2002-10-24, claiming a provisional
  (60/336,498) of 2001-10-24 (as quoted in a later family member).
- **US 6,865,300** (a division, application 10/824,664 filed 2004-04-13); **US 7,031,547** "User definable image
  reference points" (a continuation, application 11/072,609 filed 2005-03-03); **US 7,602,968** "Distortion of digital
  images using spatial offsets from image reference points" (continuation, filed 2006-04-17).
- Related: **US 7,602,991** "User definable image reference regions" (Nils Kokemohr; Nik Software, assigned to Google);
  **US 7,970,233** and **US 8,625,925** "Distortion of digital images using spatial offsets from image reference
  points"; **US 8,064,725** "Distortion of digital images using spatial offsets"; **US 8,837,849** "Method for
  noise-robust color changes in digital images" (assignee not confirmed). European counterpart **EP 1 449 152**
  (WO 2003/036558), Nik Multimedia.
- **Status:** not read for any of them. Arithmetic only: a US patent filed after June 1995 normally ends 20 years from
  its earliest non-provisional US filing it claims, so members claiming the 2002-10-24 application would have ended
  around **2022-10-24**, unless extended by patent term adjustment or ended earlier by unpaid fees. Members with their
  own, later chains (possibly 7,602,991 and the 8,xxx patents) could run later. Needs checking.
- **Relevance:** U Point selects by position and colour similarity around a control point. LightBench's v1 doesn't
  plan that. A future "colour-aware brush" (Auto Mask) or "point that selects similar colours nearby" would be close.
- Nik Software was bought by Google in 2012 and the Nik Collection by DxO in 2017 (Wikipedia via search).

**Adobe**
- **US 11,223,744 B2 "Local color range selection"** (Adobe Inc.; inventors Joshua Michael Bury and Eric Chan;
  application 15/786,549; published as US 2019/0116293 A1). Google Patents lists it as **Active** (search snippet);
  filing and expiry dates not seen. Its description combines a **spatial mask** (the region) with a **range mask**
  (colours or luminance, independent of the region), weighting each pixel's adjustment by both, e.g. a luminance range
  that gives pixels inside the range 1 and outside 0. This is Lightroom's range mask on a local adjustment (2017
  onwards). **Highly relevant** to "Intersect a luminance/colour range with a brush or gradient". The claims decide
  the scope; they were not read.
  - **Prior art facts** (not an opinion): darktable has combined drawn and parametric masks in one module
    (`DEVELOP_MASK_MASK_CONDITIONAL`, "drawn & parametric") with copyright headers on `blend.c` from 2011 and on the
    mask shapes from 2013; RawTherapee's control spots combine a shape with a colour-difference scope; ART's masks
    combine area and parametric masks. Their exact first release dates were not checked against the patent's priority
    date.
- **US 6,954,549** "Local digital image property control with masks" appeared in a search (title only; assignee,
  dates and status unknown). Its number suggests an early-2000s filing, which would likely have ended, but that is
  unverified.
- **Adobe AI mask patents** (Select Subject, Select Sky): one search found none; not searched in depth. The Phase 4
  models' licences (SAM 2.1 Apache-2.0 with its patent grant; BiRefNet MIT) are covered in PHASE4_MODELS.md.
- **Guided filter:** DETAIL_DENOISE_SHARPEN.md notes a rumoured Microsoft patent, unverified; darktable uses the
  filter for feathering and LightBench already ports darktable's uses.

**Other:** Adobe's PatchMatch patents concern the Remove brush (PHASE3 Part 11), not masking.

---

## Open questions for the owner

**Owner's decision (2026-10-13), question 1:** masks are anchored to the photo: option 1 above. Control points are stored in sensor coordinates, as the Remove spots are, so masks follow the content when the angle, Upright or lens settings change. Shapes are drawn in the straightened frame.

1. **Coordinate frame.** Store mask control points in **sensor coordinates** (like the Remove spots and darktable;
   masks follow the content when the angle, Upright or lens settings change) and draw shapes in the straightened frame
   (recommended), or in the **straightened frame** as the crop and Part 1's note say (masks drift if geometry changes
   after masking)?
2. **v1 scope.** Brush, Linear, Radial, Luminance range, Color range; local Temp, Tint, Exposure, Contrast,
   Highlights, Shadows, Whites, Blacks, Saturation, Vibrance; Feather and Refine for every mask. Anything to add (e.g.
   Depth range from an AI depth map now) or drop?
3. **Combine maths for soft edges.** Intersect as min (darktable) or as a product (LightCraft)? Falloff shapes:
   darktable's (linear/erf gradients, quadratic radial), or tuned to look like Lightroom's?
4. **What range masks measure:** before all global edits, after global white balance and exposure (recommended), or
   the displayed result? And JzCzhz (darktable) or OkLab (LightCraft) for colour range?
5. **Local Contrast:** a per-pixel sigmoid contrast, or darktable color balance rgb's scene-referred contrast before
   the sigmoid (recommended)?
6. **Panel and overlay:** a docked Masks group in the tool stack (recommended) or a floating panel? Default overlay
   colour (red, as Lightroom) and a colour-blind-safe alternative?
7. **Copy/Paste and presets:** Masks unticked by default (recommended)? Pasted masks replace or are added to the
   target's? Never in Auto Sync? May presets hold masks, and which kinds?
8. **Lightroom interop:** read `crs:` masks from sidecars (best effort, like the crop in Part 7)? Write them too?
9. **Limits:** caps on masks, components and dabs (proposed 64 / 32 / 10,000)?
10. **AI rasters (Phase 4):** inside the edit and XMP (LightCraft's way), as files next to the photo, in the catalog
    only (Lightroom's way), or vectorised to paths (darktable's way)?
11. **Spatial local sliders** (Texture, Clarity, Dehaze, Sharpness, Noise, Moiré, Defringe): add each one when its
    global tool lands, or hold masking until they all exist?
12. **Patents:** take advice on US 11,223,744 (range mask × spatial mask) before releasing range masks that intersect
    shapes? Check the U Point family's status before any colour-aware brush?
13. **Pen pressure:** offer pressure → size/flow (off by default)?
14. **darktable XMP:** someday export masks as darktable module instances with drawn and parametric masks (R2 18), or
    leave masks LightBench-only?

---

## For Cowork verification

Pages that could not be opened here and should be checked on a machine with normal web access:

1. **Adobe help, Lightroom Classic "Masking tool"**
   (`helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/masking.html`): the component list, the
   complete local slider list (including Curve, Grain, Point Color, Refine Saturation), the Amount range, overlay
   modes, Intersect, and all masking shortcuts (especially Color Range and Luminance Range keys, Erase, N, ').
2. **Adobe release notes 15.5 (August 2026):** do Feather and Edge apply to all masks or only AI masks?
3. **Lightroom's mask maths:** Add/Subtract/Intersect on soft masks; gradient and radial falloff shapes; how
   overlapping masks add; local Temp/Tint semantics (relative scale).
4. **Lightroom XMP:** a real sidecar with each component kind: confirm `What` values, `MaskBlendMode` codes,
   `MaskSubType` codes (subject, sky, background, objects, people, landscape), the `Dabs` string format, `LumRange` and
   colour-range fields (`AreaModels`, `SampleType`), `Local*` scales, and **which frame the coordinates are in**
   (before/after Transform and crop).
5. **Google Patents / USPTO:** legal status, filing date, expiry and claim 1 of **US 11,223,744 B2**; status and
   expiry of **US 6,728,421, 6,865,300, 7,031,547, 7,602,968, 7,602,991, 7,970,233, 8,064,725, 8,625,925, 8,837,849**;
   what **US 6,954,549** is; a search for Adobe patents on Select Subject / Select Sky / depth range masks.
6. **Capture One support pages:** layer opacity, mask types, Refine Mask, Luma Range, the 16.7 combine feature, how
   masks are stored (raster or vector).
7. **darktable manual** (`docs.darktable.org`): the drawn/parametric/raster mask pages, to cross-check the source
   reading above and the release in which "drawn & parametric" first shipped (for the prior-art question).
8. **RawPedia "Local Adjustments":** user-facing description of spots, scope and excluding spots.
9. **Apple HIG:** minimum touch target size.

---

## Sources

**Read at source (this machine):**
- darktable `6271f53`: `src/develop/masks.h`; `src/develop/masks/group.c`, `circle.c`, `gradient.c`, `brush.c`,
  `object.c`; `src/develop/blend.h`, `blend.c`; `src/develop/blends/blendif_rgb_jzczhz.c`; `src/common/guided_filter.c`;
  `src/common/exif.cc`; `src/iop/gamma.c`; `src/iop/colorbalancergb.c`.
- LightCraft `701f78e` (MIT/Apache): `crates/develop/src/settings.rs`, `segmask.rs`; `crates/pipeline/src/masks.rs`,
  `local.rs`, `finish.rs`, `lib.rs`; `crates/gpu/src/wgsl/mask.wgsl`; `crates/engine/src/crs_masks.rs`;
  `docs/xmp-interop.md`.
- ExifTool `lib/Image/ExifTool/XMP.pm` 3.79: https://raw.githubusercontent.com/exiftool/exiftool/master/lib/Image/ExifTool/XMP.pm
- RawTherapee `rtengine/params/locallab.h`: https://raw.githubusercontent.com/RawTherapee/RawTherapee/dev/rtengine/params/locallab.h
- ART `b035ca5`: `src/engine/procparams.h`, `procparams.cc`, `masks.cc` via https://api.bitbucket.org/2.0/repositories/agriggio/art/src/
- WebGPU spec `25a5dc4`: https://raw.githubusercontent.com/gpuweb/gpuweb/main/spec/index.bs (limits table; texture
  format capabilities).
- LightBench `main` `60b1170`: `web/src/engine/develop/settings.ts`, `geometry.ts`, `spots.ts`;
  `web/src/engine/color/tone-equalizer.ts`; `web/src/engine/gpu/develop-display.wgsl`; `web/src/develop/paste.ts`;
  `web/src/settings/actions.ts`; docs PLAN.md, PHASE3.md, USABILITY.md, research/PHASE4_MODELS.md,
  research/REVIEWS_LIGHTROOM.md, research/REVIEWS_ROUND2.md, research/DETAIL_DENOISE_SHARPEN.md.

**Search-result snippets only (pages not opened; [unconfirmed]):**
- Adobe, Masking tool (Lightroom Classic): https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/masking.html
- Adobe, Lightroom Classic release notes: https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/release-notes.html
- Adobe, Feature summary June 2023 (12.4): https://helpx.adobe.com/lightroom-classic/help/whats-new/2023-4.html
- Adobe, Feature summary October 2021: https://helpx.adobe.com/lightroom-classic/desktop/help/whats-new/2022.html
- Adobe, Apply masking (Lightroom): https://helpx.adobe.com/lightroom/desktop/edit-photos/masking.html
- Julieanne Kost, masking in Lightroom Classic: https://jkost.com/blog/2022/10/everything-you-need-to-know-about-masking-in-lightroom-classic.html
- Lightroom Killer Tips, overlay options: https://lightroomkillertips.com/exploring-masking-overlay-options/
- Lightroom Killer Tips, masking shortcuts: https://lightroomkillertips.com/seven-really-useful-lightroom-masking-shortcuts/
- Adobe Community, Masks panel shortcut: https://community.adobe.com/t5/lightroom-classic-discussions/opening-and-closing-the-masks-panel/m-p/12736649/highlight/true
- DIY Photography, Intersect: https://www.diyphotography.net/the-intersect-tool-in-lightroom-the-secret-masking-tool-you-definitely-need-to-start-using/
- Nicole S. Young, Intersect mask: https://nicolesy.com/2022/11/17/lr-intersect-mask/
- Capture One support: https://support.captureone.com/hc/en-us/articles/360002601658 , https://support.captureone.com/hc/en-us/articles/360002622857 , https://support.captureone.com/hc/en-us/articles/4403193308049
- Digital Camera World, Capture One Luma Ranges: https://digitalcameraworld.com/tutorials/capture-one-luma-ranges-how-to-use-them-for-complex-adjustments-and-masks
- Google Patents, US 11,223,744 B2: https://patents.google.com/patent/US11223744 ; Justia: https://patents.justia.com/patent/11223744 and https://patents.justia.com/patent/20190116293
- USPTO full text, US 7,031,547: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7031547 ; US 7,602,991: https://patents.google.com/patent/US7602991 ; US 7,970,233: https://patents.google.com/patent/US7970233 ; US 8,064,725: https://patents.justia.com/patent/8064725 ; US 8,625,925 and US 8,837,849 and US 6,954,549: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8625925 , …/8837849 , …/6954549
- EPO, EP 1 449 152 (Nik Multimedia): https://data.epo.org/publication-server/rest/v1.2/patents/EP1449152NWA1/document.html
- Nik Software (Wikipedia): https://en.wikipedia.org/wiki/Nik_Software
- Adobe Community / JarvisArt paper on `MaskGroupBasedCorrections` structure: https://arxiv.org/pdf/2506.17612 (via search only) and https://community.adobe.com/t5/lightroom-classic-ideas/p-masking-re-order-masks-list/idi-p/13797511
