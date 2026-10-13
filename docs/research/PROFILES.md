# Camera profiles and looks: design brief

**Prepared for:** Shawn Burke (LightBench) · **Research date:** 2026-10-13 · **Status:** research only, nothing built.
**Reads with:** docs/PLAN.md (Phase 3 list: "camera profiles"; Part 5 follow-up: "the DNG profile look
(ProfileHueSatMap/LookTable/ToneCurve)"), docs/PHASE3.md (Part 1 process versions, Part 5 DNG colour model, Part 7
sidecar rules), docs/PHASE2.md (presets with Amount and hover preview), docs/research/lightcraft/CATALOG_INPUT_COLOUR.md,
COLOUR_GRADING.md and COLOUR_MIXER_EFFECTS.md (tools a look would use).

## How this was researched (read first)

- **Read in full [read]:** darktable `6271f53` (2026-10-11, 5.8.0): `src/iop/colorin.c`, `src/iop/lut3d.c`,
  `src/common/colorspaces.c` (names), `src/common/colormatrices.c` (header), `src/common/iop_order.c`,
  `src/develop/lightroom.c`, `data/styles/` (file list and module counts), `RELEASE_NOTES.md`. dtdocs `master`:
  `input-color-profile.md`, `output-color-profile.md`. ExifTool `XMP.pm` 3.79 (`crs` table). RawTherapee `dev`:
  `rtengine/dcp.cc`, `dcp.h`, `procparams.h`, `clutstore.cc`. ART `master`: `src/engine/procparams.h`. LightCraft
  `701f78e` (MIT/Apache-2.0): `crates/raw/src/profile.rs`, `crates/pipeline/src/lut.rs`, `profiles.rs`,
  `docs/xmp-interop.md`, `docs/parity-checklist.md`. LightBench `a0f8353`: `engine/raw/decoder.worker.ts`,
  `engine/develop/settings.ts`, `engine/develop/process.ts`, `develop/presets.ts`, `engine/develop/auto.ts`,
  `engine/color/icc.ts`.
- **Could not read:** helpx.adobe.com, adobe.com, blog.adobe.com, the DNG specification PDF, android.googlesource.com
  (the DNG SDK's PATENTS file), rawpedia, pixls.us, and other non-GitHub sites.
- Tags as in the other briefs: **[search]** (search-tool summary of a page not opened), **[unconfirmed]** (memory or a
  single secondary source), **[LightBench idea]**.
- Nothing here is legal advice.

---

## Summary

- **A "profile" is two things in Lightroom.** A *camera profile* (Adobe Color, Adobe Standard, Adobe Neutral,
  Landscape, Portrait, Vivid, Monochrome; Camera Matching) defines how the camera's colours become the base image
  before any slider. A *creative profile* (Artistic, B&W, Modern, Vintage) is a look on top, with an **Amount**
  0–200 [search]. **Adobe Color** became the default for new raw photos in April 2018 (Lightroom Classic 7.3); older
  photos keep their profile "as doing so would change the look of the image" [search]. That is exactly LightBench's
  process-version rule.
- **Adobe's camera profiles are DCP files** (DNG camera profile tags: ColorMatrix, ForwardMatrix, ProfileHueSatMap,
  ProfileLookTable, ProfileToneCurve). The **format** is public in the DNG specification. Adobe's **profile files**
  are Adobe's; LightBench must not ship them. Adobe's DNG **patent licence** is royalty-free for "a portion of a
  software or hardware product that reads or writes computer files compliant with the DNG Specification" [search].
  Whether reading a stand-alone `.dcp` counts was not confirmed.
- **RawTherapee and ART read DCP files** (GPL-3.0; `rtengine/dcp.cc`, 2,276 lines, "Ported from Adobes reference
  implementation" for the HueSatMap) [read]. **darktable does not read `.dcp` files.** Since 5.8 it applies a DNG's
  *embedded* ForwardMatrix and **ProfileHueSatMap** ("DNG forward matrix", "DNG embedded look"), but not the
  LookTable or ToneCurve [read].
- **darktable's looks:** `colorin` input matrices (standard Adobe-derived, an "enhanced" measured set, vendor and
  alternate), user ICC profiles, the **LUT 3D** module (`.cube`, `.3dl`, Hald CLUT `.png`, G'MIC `.gmz`), and 510
  bundled per-camera **"camera styles"** plus 24 example styles [read].
- **LightBench today** has one base look: LibRaw's Adobe-derived matrix (or Part 5's DNG model) → linear Rec.2020 →
  +0.7 EV → sigmoid with darktable's defaults. This **is** the default profile. Any change to it changes every old
  edit, so it must be named and frozen.
- **Recommended v1:** (1) name today's rendering **"LightBench Standard"** and store a `profile` in every new edit
  (absent = Standard v1, so old edits never change); (2) a small set of built-in **looks made from LightBench's own
  sliders** (LightCraft's model, in-house, no licence questions), with Amount 0–200 and a profile browser; (3) user
  **`.cube` LUT import** as creative profiles; (4) the **DNG embedded look** for DNGs, on for new edits only. DCP
  reading, camera matching and darktable's camera styles are later and need owner decisions.

---

## How Lightroom does it

### Profiles and their semantics

- **Adobe Raw profiles** [search] ([Adobe blog, April 2018](https://blog.adobe.com/en/publish/2018/04/03/april-lightroom-adobe-camera-raw-releases-new-profiles),
  [PetaPixel](https://petapixel.com/2018/04/03/a-closer-look-at-lightrooms-new-and-improved-profiles/)): Adobe Color,
  Adobe Monochrome, Adobe Landscape, Adobe Neutral, Adobe Portrait, Adobe Standard, Adobe Vivid. Adobe Color is the
  default for new colour raws and Adobe Monochrome for black and white since 7.3 (April 2018); before that Adobe
  Standard.
- **Camera Matching:** per camera model, "designed to match the preset 'styles' that can be set using the menus on a
  camera"; the list depends on the camera [search].
- **Legacy** profiles (older Adobe sets) [unconfirmed].
- **Creative profiles:** Artistic, B&W, Modern, Vintage. They "provide a new Amount slider" (0–200, default 100, per
  PetaPixel) [search]. Photofocus notes the Amount shows only for those creative sets [search]. They also apply to
  non-raw files (JPEG, TIFF) [unconfirmed; LightCraft's copy offers its looks to JPEGs, parity row LR-PROF-NONRAW].
- **Adaptive profiles** (Adobe Adaptive Color, an AI-based profile, 2023) [unconfirmed; LightCraft lists "Adaptive
  profiles" as not done].
- **UI:** a Profile menu at the top of the Basic panel (favourites, recent, Browse…) and a **Profile Browser** grid of
  live thumbnails, hover to preview, star favourites [unconfirmed; LightCraft reproduces this, parity rows
  LR-PROF-DROPDOWN and LR-PROF-BROWSER, read].
- **Old photos:** "Lightroom won't automatically update legacy files using the new profiles as doing so would change
  the look of the image" [search].

### DCP / DNG profiles (what a profile contains)

From RawTherapee's DCP reader (`dcp.cc` lines 850–865, tag numbers; `dcp.h`) [read] and LightCraft's DNG profile code
(`profile.rs` header) [read]:

| Tag (number) | What it does |
|---|---|
| ColorMatrix1/2 (50721/50722), CalibrationIlluminant1/2 (50778/50779) | XYZ → camera at two illuminants, interpolated by the white balance |
| ForwardMatrix1/2 (50964/50965) | white-balanced camera → XYZ D50 |
| ProfileHueSatMapDims/Data1/Data2 (50937–50939), Encoding (51107) | a hue/saturation/value table (hue shift °, saturation scale, value scale) on a grid, applied in HSV of linear ProPhoto; follows the matrices |
| ProfileLookTableDims/Data (50981/50982), Encoding (51108) | the same kind of table, the "look", applied after exposure, before the tone curve |
| ProfileToneCurve (50940) | a tone curve (input, output pairs, 0…1) |
| ProfileCopyright (50942) | the profile's copyright text |
| BaselineExposureOffset (51109) | an exposure offset for the profile |

- RawTherapee adds "the Adobe Default Curve" when an Adobe profile has no tone curve (`dcp.cc` lines 868 and
  1318–1328) [read]. That table is presumably Adobe's data; its origin was not checked.
- LightCraft notes Adobe tables are at most 90 × 30 × 16 entries (`profile.rs` line 33) [read].
- A `ProfileEmbedPolicy` tag (allow copying / embed if used / never / no restrictions) exists in the DNG spec
  [unconfirmed; not in the files read].

### XMP fields (ExifTool `XMP.pm` 3.79, `crs` table) [read]

| Field | What ExifTool says |
|---|---|
| `crs:CameraProfile` | a string (lines 1424) |
| `crs:CameraProfileDigest` | "new tags observed in Adobe Lightroom output" (line 1489) |
| `crs:Look` | a struct: `Name`, `Amount`, `Cluster`, `UUID`, `SupportsMonochrome`, `SupportsAmount`, `SupportsOutputReferred`, `Copyright`, `Group` (lang-alt), `Parameters` { `Version`, `ProcessVersion`, `Clarity2012`, `ConvertToGrayscale`, `CameraProfile`, `LookTable`, `ToneCurvePV2012` (+Red/Green/Blue), `Highlights2012`, `Shadows2012` } (lines 1742–1771) |
| `crs:LookName` | "new for DNG converter 13.0" (line 1799) |
| `crs:ConvertToGrayscale` | boolean (line 1491) |
| `crs:OverrideLookVignette` | boolean (line 1740) |

- Which strings appear in `CameraProfile` (e.g. "Adobe Standard") and whether **Adobe Color** is written as
  `CameraProfile="Adobe Standard"` plus a `Look` named "Adobe Color" is **[unconfirmed]**. LightCraft says
  "Lightroom's default profiles (`Adobe Standard`, `Adobe Color`), which every sidecar names" (`xmp-interop.md` line
  148) [read].
- Creative profiles carry their colour tables inside XMP profile files; LightCraft calls these "XMP camera/creative
  profiles with embedded tables" and reads none of them (`xmp-interop.md` line 236) [read]. Their table encoding was
  not found documented anywhere.

---

## How darktable does it

### colorin (input color profile, `src/iop/colorin.c`) [read]

- **Default:** `DT_COLORSPACE_ENHANCED_MATRIX` (line 81), falling back to the embedded ICC, then the embedded matrix,
  then the **standard matrix** (Adobe coefficients) when a camera has no enhanced matrix (`commit_params`, lines
  1513–1580).
- **Kinds:** standard matrix; **enhanced matrix** ("custom measured color matrices, profiled for darktable … so far
  all calculated by Pascal de Bruijn", `colormatrices.c`); vendor and alternate matrices; embedded ICC; embedded matrix;
  **DNG forward matrix** and **DNG embedded look** (5.8: "If one of these new input profiles is selected, the pipe
  gets its data corrected according to DNG specs matching the intended look", RELEASE_NOTES.md 241–250); user ICC
  profiles from `color/in`; working profile (linear Rec.2020 by default); optional gamut clipping.
- **DNG embedded look** applies only **ProfileHueSatMap** (`_lookup_hsm`, `_commit_hsm`, lines 204–330: trilinear on
  hue/saturation/value). No LookTable or ProfileToneCurve is used in colorin (grep: none).
- **No `.dcp` support** anywhere in `src` (grep: none).
- darktable's Lightroom importer sets colorin to the standard matrix for raws, "the default from Adobe (so closer to
  what Lightroom does)" (`lightroom.c` lines 1312–1319), and ignores `CameraProfile` and `Look`.
- Manual [read]: "enhanced matrices are designed to provide a look that is closer to that of the camera manufacturer".

### LUT 3D (`src/iop/lut3d.c`) [read]

- "perform color space corrections and apply look" (line 140). Files: **`.cube`** (3D; a `LUT_1D_SIZE` is read too),
  **`.3dl`**, Hald CLUT **`.png`** (8/16-bit), and G'MIC compressed **`.gmz`** when built with G'MIC
  (`lut3dgmic.cpp`). Maximum size 256 (lines 568–570, 823–825). `DOMAIN_MIN` other than 0 and `DOMAIN_MAX` other than
  1 are refused (lines 788–805).
- **Application colour space** (line 75): sRGB (default), Adobe RGB, gamma Rec.709, linear Rec.709, linear Rec.2020,
  linear ProPhoto. **Interpolation:** tetrahedral (default), trilinear, pyramid.
- **Pipe position 36.0** (v5.0 order, `iop_order.c` line 392): after colorin (28.0), *before* the color equalizer and
  the sigmoid, although its description says "display-referred". darktable's comment: "apply a creative style or film
  emulation, possibly non-linear". Supports blending (opacity), so blending is its "Amount".

### Styles

- `data/styles/` holds **510** `darktable_<camera>.dtstyle` files named "darktable|camera styles|<make>|…|<model>",
  and **24** `examples_*.dtstyle` (autumn, faded, pastels, sepia, day for night, fog, spot colours…) [read].
- The camera styles use mostly basecurve (505), bilat (507), colorbalancergb (513), exposure (511), filmicrgb (512) and
  sigmoid (510) entries [read, counted]. Who made them and how is not recorded in this shallow checkout
  [unconfirmed]. They are GPL like the rest of the repository.

---

## Others

- **RawTherapee** [read]: input profiles include DCP with switches `toneCurve`, `applyLookTable`,
  `applyBaselineExposureOffset`, `applyHueSatMap` and a DCP illuminant choice (`procparams.h` ColorManagementParams).
  **Film Simulation** applies a Hald CLUT with a strength (`FilmSimulationParams`, `clutstore.cc`). The free
  "RawTherapee Film Simulation Collection" exists; **its licence was not found** [search].
- **ART** [read]: the same DCP switches plus `dcp_look_early` (`procparams.h` 1139–1162); Film Simulation (Hald
  CLUT); a LUT mode inside Color Correction regions.
- **Capture One:** camera-specific ICC profiles and "curves" (Film Standard, etc.) [unconfirmed]; LUT support and its
  version not confirmed [search].
- **LightCraft (MIT/Apache-2.0)** [read]:
  - **Looks as recipes:** "a look applied *underneath* the user's sliders (the sliders stay at their displayed
    values); `profile.amount` (0–200 %) scales it. All looks are our own." Each look is deltas on settings (contrast,
    saturation, mixer, grading wheels as colour vectors, point-curve fades), so it "needs no kernel of its own"
    (`profiles.rs` 1–8). 21 looks: Neutral, Vivid, Landscape, Portrait, Mono, Film ×4, Cinematic ×4, Muted ×4, B&W ×4
    (lines 221–240). Its own default is "Color".
  - **`.cube` import** as creative profiles with Amount 0–200, "applied to the finished, display-encoded colour
    (trilinear; `DOMAIN_MIN` / `DOMAIN_MAX` honoured; 1D LUTs are not supported)"; "Adobe's own profile formats
    (`.dcp`, XMP camera/creative profiles with embedded tables) are deliberately not read" (`xmp-interop.md`
    230–237).
  - **DNG profile look:** HueSatMap, LookTable and ToneCurve from the user's own DNG, per DNG spec chapter 6;
    "nothing here ships profile data" (`profile.rs` 1–25). Also a per-file fit to the embedded JPEG for non-DNG raws.
  - `crs:CameraProfile` is reported but never applied; Adobe Standard and Adobe Color are treated as its own default.

---

## Design questions

### What "the base look" is in LightBench, and the process-version rule

Today's rendering of a raw is: LibRaw's `rgb_cam` (`decoder.worker.ts` line 195; Adobe-derived per the LightCraft
catalogue) or Part 5's DNG model → linear Rec.2020 → white balance → **+0.7 EV** base exposure → Basic's sliders →
**sigmoid** with darktable's defaults (`settings.ts` 97–116). JPEGs use their ICC profile, no base exposure and no hue
preservation (`settings.ts` line 138).

Part 1's rule: anything that turns the same settings into different pixels needs a new process version. A default
profile is exactly that. So:

1. Today's rendering must get a **name** ("LightBench Standard") and a **frozen definition**.
2. A saved edit without a `profile` key must render as Standard v1 **forever**.
3. A new built-in look, or a better default, gets a **new id**; an id's meaning never changes. Changing what new edits
   get by default is a decision for new edits only (like Adobe Color in 2018).
4. A change to how a look is *rendered* (e.g. the LUT interpolation) is a process-version change like any other.

### Where looks apply

| Kind | Where | Why |
|---|---|---|
| Built-in looks (recipes) | nowhere of their own: they set "effective settings" under the user's sliders | LightCraft's design; reuses darktable-based tools; no new shader |
| DNG HueSatMap | with the input matrix (colorin) | DNG spec; darktable 5.8 |
| DNG LookTable, ToneCurve | after exposure, before the tone mapper; the ToneCurve where the sigmoid is? | DNG spec order (per LightCraft); see Q6 |
| User `.cube` | after the sigmoid (display-encoded), or before it with a chosen application space (darktable) | Q5 |

### Making LightBench looks from permissively licensed sources

- **In-house recipes** (recommended): written by the project from LightBench's own sliders. No third-party data, so no
  licence question. LightCraft's 21 recipe values are MIT/Apache-2.0 and could be a starting point, but they target its
  OkLab tools, so they would need re-tuning on darktable's.
- **darktable's styles and presets** (GPL-3.0, compatible): the example styles, color balance rgb's "basic
  colorfulness" presets, the color equalizer's film-like presets (bleach bypass, Kodachrome 64 like, Portra 400 like,
  teal & orange, per COLOUR_MIXER_EFFECTS.md), AgX's look presets. Each needs the corresponding LightBench tool.
- **darktable's 510 camera styles** as a "camera matching" starting point: GPL, but built for basecurve/filmic/bilat
  stacks that LightBench doesn't have; their origin and quality are unknown.
- **LUT collections:** RawTherapee's Film Simulation Collection and G'MIC's colour presets: licences **not confirmed**
  [search]; not bundled until checked. Users may import their own.
- **Never:** Adobe's profiles, Adobe's default curve table, camera makers' picture styles.

---

## Recommended v1

| Item | Recommendation |
|---|---|
| Name the base | Today's rendering = **LightBench Standard** (`lb.standard`, v1). Shown at the top of Basic as "Profile: Standard". |
| Stored | `profile?: { id: string; amount: number }` in `DevelopSettings` (`lightbench:Develop`). **Absent = Standard v1**, so every existing edit is unchanged byte for byte. New edits store it explicitly [LightBench idea]. |
| Built-in looks | A first set of recipes once Colour Grading and the Colour Mixer exist: **Standard, Neutral, Vivid, Landscape, Portrait, Monochrome** (Lightroom's names, LightBench's own values), each as deltas applied under the user's sliders, scaled by **Amount 0–200** (default 100). Frozen per id. |
| Profile UI | A Profile menu at the top of Basic (Favourites, Recent, groups, Browse…), an Amount slider for non-Standard profiles, a **Profile browser** of live thumbnails with hover preview (PHASE2's preset hover preview already exists). One history step per choice. |
| `.cube` import | Creative profiles from the user's own `.cube` files (3D, size ≤ 64 to start; `DOMAIN_MIN/MAX` honoured), stored in the catalog by SHA-256 and referenced as `lut:<hash>` in the edit with the file's title. Applied on the GPU as a 3D texture (trilinear; tetrahedral as a later option). Amount blends with the unlooked result. A sidecar on a machine without the LUT shows a warning and renders without it. |
| DNG embedded look | For DNG files carrying HueSatMap / LookTable / ToneCurve: on for **new** edits as part of their base (a new profile id, e.g. `dng.embedded`), off for old edits. Port order: darktable 5.8's HueSatMap code first (GPL), LightCraft's `profile.rs` (MIT) for LookTable and ToneCurve. |
| Copy/Paste, presets | **Profile** item in the checklist (Lightroom's Copy Settings has "Treatment & Profile" [unconfirmed]). Presets may hold a profile. |
| Help | "Profile: the starting look, applied before your sliders. Standard is LightBench's neutral rendering." Pitfall: a creative look plus strong sliders double up. |
| Process version | None for adding profiles (new, off by default; absent = Standard). A new process version is needed only if Standard itself, or how any existing id renders, changes. |

---

## Alternatives

1. **DCP reading** (port RawTherapee's `dcp.cc`, GPL): lets users load DCPs they own (e.g. from their Adobe or DNG
   Converter install, or made with dcamprof). Most faithful Lightroom match, but legally the least clear (Q2), and the
   whole ProPhoto HSV table path must run per pixel on the GPU (a 3D texture lookup; cheap).
2. **ICC input profiles** (darktable's `color/in`): needs a full CMM for LUT profiles (lcms-wasm, see
   SNAPSHOTS_PROOFING_SEARCH.md). Few users make camera ICC profiles today.
3. **Camera matching from the embedded JPEG** (LightCraft's per-file fit, MIT): no third-party data, but its own
   scorecard puts its colour at "about 35 %" (CATALOG_INPUT_COLOUR.md) and it is unmeasured on LightBench.
4. **LUT-only looks:** simplest engine, but every look is opaque data, Amount is a crude blend, and they ignore
   scene-referred headroom.
5. **No profiles; presets only:** LightBench's Starter presets already do part of this (`presets.ts` 53–56: Black &
   white, Punchy, Soft, Bright & airy). A profile differs in sitting *under* the sliders and having Amount.

---

## Lightroom mapping (closest match)

| Lightroom | LightBench (read) | Write? |
|---|---|---|
| `CameraProfile` = Adobe Standard / Adobe Color (default) | Standard | not written (Q8) |
| Adobe Neutral / Vivid / Landscape / Portrait / Monochrome | the LightBench look of the same name, with a note "Lightroom's Adobe Vivid → LightBench Vivid (close, not identical)" (Part 7's "closest match, said so") | not written |
| Camera Matching, creative and third-party profiles, `Look` with tables | not applied; the name is kept and shown ("Lightroom profile 'Camera Vivid' isn't available") | not written |
| `Look/Amount` | Amount, when the look was mapped | — |
| `ConvertToGrayscale` = True | Monochrome treatment | Q8 |

Profile names are matched as strings; the exact strings Lightroom writes need Cowork's check.

---

## Licence and patent notes (facts only, not legal advice)

- **DNG specification patent licence** [search, from copies on Adobe's DNG SDK pages; the full text was not opened]:
  Adobe grants "a worldwide, royalty-free, nontransferable, nonexclusive right under all Essential Claims to make, have
  made, use, sell, import, and distribute Compliant Implementations". "Compliant Implementation" means "a portion of a
  software or hardware product that reads or writes computer files compliant with the DNG Specification". "DNG
  Specification" means "any version of the Adobe DNG Specification made publicly available by Adobe". An Essential
  Claim is one with "no technically possible noninfringing alternative". Adobe may **revoke** the rights from a
  licensee who "brings any patent action" against Adobe about reading or writing DNG files. Whether any attribution
  notice is required was not seen.
- **Open point:** whether a stand-alone `.dcp` file is a "file compliant with the DNG Specification" (the spec
  describes camera profile files [unconfirmed]) was not confirmed. LightBench already reads DNG files (Part 5), so it
  is already a "Compliant Implementation" for those.
- **Copyright on profiles:** Adobe's profiles carry a ProfileCopyright tag (RawTherapee keys on "Adobe Systems" in it,
  `dcp.cc` line 1318) [read]. Shipping them is not allowed without Adobe's permission [unconfirmed general principle];
  reading a profile the user already has is a different question (Q2).
- **Code:** RawTherapee's `dcp.cc` (Oliver Duis, 2012) and ART: GPL-3.0-or-later, compatible. darktable's colorin and
  lut3d: GPL-3.0-or-later, compatible. LightCraft's `profile.rs`, `lut.rs`, `profiles.rs`: MIT/Apache-2.0,
  compatible.
- **The `.cube` format** is a plain-text format (Adobe/IRIDAS origin [unconfirmed]); no licence issue for reading it
  was found. Each LUT file's own licence is the user's matter.
- **LUT collections:** RawTherapee Film Simulation Collection, G'MIC presets: licences unconfirmed [search].
- **Patents:** none searched for hue/saturation table profiles or 3D LUT application.

---

## Open questions for the owner

1. **Name and freeze the base look** as "LightBench Standard", stored in new edits, absent = Standard v1?
2. **DCP files:** support user-loaded `.dcp` (port RawTherapee's reader) now, later, or never? If yes, seek legal
   advice on the DNG patent licence's scope first?
3. **Built-in looks:** which set for v1 (Lightroom's six names, or LightBench names to avoid suggesting they match
   Adobe's)? And they need Colour Grading and the Colour Mixer first: wait for them, or start with Basic-only recipes?
4. **Naming clash:** Auto already has looks named Natural, Vivid, Landscape, Portrait, Low-key, High-key
   (`auto.ts` 114–119). Rename the Auto targets, merge the two ideas (a profile that also sets Auto's target), or
   keep both?
5. **`.cube` position:** after the sigmoid on display values (LightCraft; most creative LUTs expect display input) or
   before it with an application colour space (darktable's lut3d, default sRGB)?
6. **DNG embedded look:** on for new DNG edits (recommended), with the ToneCurve replacing or feeding the sigmoid?
   (A DNG ToneCurve is a display curve; LightBench's sigmoid is its display transform.)
7. **Camera matching:** investigate darktable's 510 camera styles, LightCraft's embedded-JPEG fit, or neither for now?
8. **Lightroom fields:** read `CameraProfile`/`Look` names and map the six Adobe Raw names to LightBench looks (said
   so in the UI)? Never write them (recommended), since LightBench's names mean different pixels?
9. **Changing the default later:** if a better default look is made, should new photos get it automatically (as
   Adobe Color in 2018), with a preference?
10. **LUT storage:** keep imported LUTs only in the catalog (by hash), or also copy them next to the photos so a
    folder stays complete when moved?

---

## For Cowork verification

1. The exact `crs:CameraProfile` string Lightroom writes for Adobe Color, Adobe Standard and a Camera Matching profile,
   and whether Adobe Color is written as a `crs:Look` (open a Lightroom-written XMP).
2. The DNG specification's chapter on camera profiles: does it define the `.dcp` file format, and does the patent
   licence text cover reading `.dcp` files? Full licence text and any attribution notice (DNG SDK `PATENTS`).
3. `ProfileEmbedPolicy` values and what Adobe's own DCPs set.
4. Creative profile Amount: range 0–200 and default 100; which profile groups show it.
5. Adobe Color as default since Lightroom Classic 7.3 (April 2018); Adobe Adaptive Color's date and behaviour.
6. Licences of the RawTherapee Film Simulation Collection (Hald CLUTs) and G'MIC's colour presets.
7. Origin and authorship of darktable's `data/styles/darktable_*.dtstyle` camera styles.
8. Capture One: camera profiles, "curve" options, and LUT import (version).
9. Whether Lightroom's Copy Settings has a "Treatment & Profile" checkbox.

---

## Sources

**Read in full**
- darktable `6271f53`: `src/iop/colorin.c`, `src/iop/lut3d.c`, `src/common/colorspaces.c`,
  `src/common/colormatrices.c`, `src/common/iop_order.c`, `src/develop/lightroom.c`, `data/styles/`,
  `RELEASE_NOTES.md`; dtdocs [input-color-profile.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/input-color-profile.md),
  [output-color-profile.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/output-color-profile.md).
- ExifTool [`XMP.pm`](https://github.com/exiftool/exiftool/blob/master/lib/Image/ExifTool/XMP.pm) 3.79.
- RawTherapee `dev`: `rtengine/dcp.cc`, `rtengine/dcp.h`, `rtengine/procparams.h`, `rtengine/clutstore.cc`.
  ART `master`: `src/engine/procparams.h`.
- LightCraft `701f78e`: `crates/raw/src/profile.rs`, `crates/pipeline/src/lut.rs`, `crates/pipeline/src/profiles.rs`,
  `crates/engine/src/crs.rs`, `docs/xmp-interop.md`, `docs/parity-checklist.md`.
- LightBench `a0f8353`: `web/src/engine/raw/decoder.worker.ts`, `web/src/engine/develop/settings.ts`,
  `web/src/engine/develop/process.ts`, `web/src/develop/presets.ts`, `web/src/engine/develop/auto.ts`,
  `web/src/engine/color/icc.ts`; docs/PLAN.md, PHASE3.md (Parts 1, 5, 7), research/lightcraft/CATALOG_INPUT_COLOUR.md.

**Search summaries only (pages not opened)**
- [Adobe blog, April 2018 profiles](https://blog.adobe.com/en/publish/2018/04/03/april-lightroom-adobe-camera-raw-releases-new-profiles),
  [PetaPixel 2018](https://petapixel.com/2018/04/03/a-closer-look-at-lightrooms-new-and-improved-profiles/),
  [Photofocus](https://photofocus.com/software/diving-into-lightrooms-new-profile-system/),
  [creativepro](https://creativepro.com/using-lightroom-profiles/),
  [Peachpit PDF](https://ptgmedia.pearsoncmg.com/imprint_downloads/peachpit/peachpit/promo/lrclassic/lrcc-04-2018.pdf),
  [Adobe help: image tone and color](https://helpx.adobe.com/dk/lightroom-classic/desktop/process-and-develop-photos/image-tone-color.html),
  [jkost: profiles](https://jkost.com/blog/?p=22697).
- DNG licence: [Adobe DNG SDK page](https://www.adobe.com/uk/support/downloads/dng/dng_sdk.html),
  [Adobe Digital Negative help](https://helpx.adobe.com/sg/camera-raw/desktop/dng-and-file-formats/digital-negative.html),
  [Android dng_sdk PATENTS](https://android.googlesource.com/platform/external/dng_sdk/+/e37223f/PATENTS),
  [Wind River licence list](https://open.windriver.com/info/uni-license-list/licenses/adobe-dng-spec-patent.html).
- LUTs: [RawPedia Film Simulation](https://rawpedia.rawtherapee.com/Film_Simulation),
  [pixls.us: how the collection was created](https://discuss.pixls.us/t/how-was-the-rawtherapee-film-simulation-collection-created-and-thanks/34265),
  [G'MIC colour presets](https://gmic.eu/color_presets/).
