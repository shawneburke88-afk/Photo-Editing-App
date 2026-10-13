# Phase 1 — First usable version

## Part 1: Import + Library (merged)

Import window, catalog and Library module. See pull request #2 and [PLAN.md](PLAN.md#phase-1--thin-end-to-end-slice-first-usable-version).

## Part 2: Develop with darktable processing

### Pipeline

| Step | Implementation | Source |
|---|---|---|
| Raw prepare: black/white normalisation | WGSL | LightBench. The white level comes from darktable's camera database (rawspeed `cameras.xml`) and is chosen as rawspeed does: by mode (bit depth) and ISO. Sony files use their own stored white level, and DNGs use the file's WhiteLevel, as rawspeed does. For cameras not in the database, LightBench falls back to its own detection: the camera's linear maximum, lowered to any channel's clipping pile-up. |
| White balance (temperature/tint ⇄ multipliers) | TypeScript | Translated from darktable `src/iop/temperature.c` |
| Highlight reconstruction: **inpaint opposed** (default) or clip | WGSL | Translated from darktable `data/kernels/basic.cl` (`highlights_initmask`, `_dilatemask`, `_chroma`, `_opposed`) |
| Demosaic: **RCD** (default) or bilinear | WGSL | Translated from darktable `data/kernels/demosaic_rcd.cl`. The 9 px border uses bilinear instead of PPG. |
| Camera → linear Rec.2020 (working space) | WGSL | LibRaw camera matrix × sRGB→Rec.2020 |
| Exposure, default **+0.7 EV** | WGSL | darktable scene-referred default |
| Highlights / Shadows / Whites / Blacks → **tone equalizer** bands | TS + WGSL | Translated from darktable `src/iop/toneequal.c`. Global mode for now: no guided filter, "RGB average" luminance. (Process version 2 uses darktable's defaults, the Euclidean norm with its guided filter: [PHASE3.md Part 10](PHASE3.md#part-10-the-tone-equalizer-as-darktables-defaults-process-version-2).) |
| Vibrance / Saturation | WGSL | LightBench simple chroma scaling. darktable's colour balance rgb is planned for Phase 3. |
| **Sigmoid** display transform (per-channel, hue preservation) | TS + WGSL | Translated from darktable `src/iop/sigmoid.c` and `data/kernels/sigmoid.cl` |
| Output: Rec.2020 → sRGB | WGSL | Standard matrices |

When a photo is shown smaller than 100 %, a mip chain (2×2 averaging) is used to prevent moiré.

### Develop module

- **Basic panel:** White balance (As shot / Custom, Temp, Tint), Exposure, Contrast, Highlights, Shadows,
  Whites, Blacks, Vibrance, Saturation. Double-click a slider to reset it.
- **Advanced (darktable modules):**
  - base exposure;
  - sigmoid skew, target white/black and hue preservation;
  - highlight method and clipping threshold;
  - demosaic method.
- **Editing tools:**
  - History panel with undo/redo (Ctrl+Z / Ctrl+Shift+Z);
  - **Before/after** (`\`) and Reset all;
  - click to zoom to 100 %, drag to pan (Z toggles zoom);
  - a filmstrip, and ←/→ for the previous/next photo.
- **Saving:**
  - Edits are saved automatically to the catalog, including the history.
  - The library thumbnail is re-rendered and an ✎ badge is shown in the grid.
  - Edits made just before leaving Develop are still saved.
- **Navigation:** **D** in the Library opens Develop; **G** goes back to the grid.

### Checked so far

- Unit tests (31) for colour maths, slider mapping and history. White balance round-trips within 1 %. The
  sigmoid hits darktable's targets.
- Headless Chromium on public-domain Nikon D700 / Sony A7 II / A6300 files:
  - Mean brightness is within about 8 % of the camera JPEGs. Before this part it was about 1 EV darker.
  - Import → Develop → edit → undo → before/after → reload works, and the edits persist.

### Fixed after the owner's testing

- **Pink clouds and highlights** (Nikon D80, also the faint lilac edges on the D700). Green clips earlier than
  red and blue on these sensors (D80: green at ~3990, red/blue at 4095). With the white level at 4095, clipped
  green was not recognised, so highlight reconstruction skipped it and highlights turned magenta. The white
  level now comes from darktable's camera database, which lists the level at which every channel is clipped
  (D80: 3880; D700 and D5200 14-bit: 15892). See `src/engine/raw/camera-db.ts`. Cameras missing from the
  database fall back to per-channel clipping detection (`src/engine/raw/white-level.ts`).

### Not yet

- **JPEG editing.** JPEGs show a message in Develop; planned for Part 3 together with export.
- Texture / Clarity / Dehaze (local contrast) and lens corrections. Lens corrections should remove the
  colour fringes seen on the D700 fountain sample. Planned for Phase 3.
- The tone equalizer's detail-preserving (guided filter) mode.
- Speed on the owner's GPU still needs checking. In this cloud environment a 24 MP RAW takes ~8 s to process
  on the software renderer; on the owner's Iris Xe, Phase 0 measured the GPU stage at 0.4 s for the simpler
  pipeline.

## Part 2b: Histogram, clipping, white balance picker, Auto, guidance

| Feature | Based on | Notes |
|---|---|---|
| Histogram | darktable `src/libs/scopes/histogram.c`, `src/common/histogram.c` | 256 bins of display-encoded sRGB, channels added at 50 % opacity, log scale by default (linear in the menu), max excludes bin 0. The clipping triangles are a Lightroom-style addition. |
| Clipping overlay **J** / **O** | darktable `src/iop/overexposed.c` + `rawoverexposed.c` | Default **lost detail**: red where the sensor clipped (any photosite of the pixel's 2×2 CFA tile) or a channel is at the display limit; blue where it is pure black. darktable's modes (any RGB, luminance, saturation, full gamut), thresholds (99.99 %, −12.69 EV) and colour schemes are in the histogram menu. darktable's sigmoid rolls highlights off, so its display test alone rarely fires. |
| Sensor clipping **Shift+O** | darktable `src/iop/rawoverexposed.c` | Marks clipped photosites in their sensor colour, a solid colour, or false colour; threshold 0–2 × white level. |
| White balance picker **W** | darktable `src/iop/temperature.c` (spot picker) | Averages 5×5 full-resolution pixels and sets multipliers so they become neutral: coeff = (1/cam[c]) / (1/cam[G]), clamped to 0…8. The loupe (15×15 pixels at 10×, with R/G/B readout) is a LightBench addition. |
| Auto | LightBench | Looks apply fixed Contrast/Vibrance amounts. Exposure, Whites, Blacks (and Highlights if clipping) move only when the photo is outside the look's acceptable range. Each slider minimises (miss/tolerance)² + (slider/scale)², so it moves only as far as it helps. White balance is left alone, like Lightroom. Reference photos and saved targets also match contrast spread and colourfulness. |
| Hints and tooltips | LightBench | `src/develop/help.ts`: what each Basic control does, left/right effects, pitfalls, and the darktable module behind it. Hints can be switched off; tooltips appear on hover or keyboard focus. |

Checked in headless Chromium on the D80 sample:
- J marks the clipped sky (18 % of the frame).
- The picker set 5223 K → 5592 K from the hazy lake, as one history step.
- Auto Natural gives −0.20 EV and Blacks −4; Vivid gives Contrast +25 and Vibrance +35.

## Part 3: Export, XMP sidecars, JPEG editing

darktable's code was reviewed first; the findings are in
[research/DARKTABLE_EXPORT_XMP_JPEG.md](research/DARKTABLE_EXPORT_XMP_JPEG.md).

### JPEG editing
| Step | Based on | Notes |
|---|---|---|
| Input colour profile | darktable `colorin` | Embedded ICC (matrix/TRC profiles), else EXIF interop `R03` → Adobe RGB, else sRGB. LUT-based ICC profiles fall back to sRGB with a note. `src/engine/color/icc.ts`. |
| Decoding | — | The browser decodes without colour conversion; EXIF orientation is applied while decoding (darktable applies it later in the pipe; same result). |
| Into the scene-referred pipe | LightBench | Linearise → linear Rec.2020 → **inverse of the default sigmoid curve**, so an unedited JPEG renders exactly as shot and every slider works as on a RAW. darktable instead applies no tone mapper to JPEGs, which leaves Contrast and similar sliders with nothing to act on. Checked: sRGB JPEG 0 levels difference; Adobe RGB JPEG within 1 level of Chrome's colour-managed decode. |
| JPEG defaults | darktable | No +0.7 EV base exposure. Hue preservation 0 (makes the inverse exact). |
| White balance | darktable (after `colorin`) | Works on the file's linear RGB; "As shot" = no change (≈ 6500 K for sRGB). |
| Clipping | LightBench | Channels at 255 in the file count as lost detail (J). |

### XMP sidecars
- `DSC_0001.xmp` (Lightroom style): `xmp:Rating` (rejected = −1, as darktable/Bridge), `xmp:Label`
  (Red/Yellow/Green/Blue/Purple), `xmp:MetadataDate`, and `lightbench:Rating`, `lightbench:Flag`,
  `lightbench:Develop` (the settings JSON). Namespace `https://shawneburke88-afk.github.io/Photo-Editing-App/xmp/1.0/`.
- Other apps' properties are kept; only these fields change. A file is rewritten only if a value changed, and
  an invalid file is never overwritten. A custom label from another app is kept when LightBench has none.
- A background queue writes ~1 s after a change. Write permission is asked once per library folder (a banner),
  because browsers only allow asking after a click. A JPEG whose RAW twin is in the library leaves the shared
  sidecar to the RAW.
- Import reads `name.xmp` (or darktable's `name.ext.xmp`): ratings, flags, labels and LightBench edits. Copy
  imports bring the sidecar along. Catalog v4 stores when each sidecar was last written.
- Reading ratings (changed after the LightCraft review, see PHASE2.md): `xmp:Rating` wins, so stars changed in
  Lightroom or Bridge are kept. `lightbench:Rating` is used only when `xmp:Rating` is missing, or is −1 (rejected),
  which hides the stars. `lightbench:Flag` keeps picks; a photo LightBench rejected that another app has since
  given stars (`xmp:Rating` 0 or more) is no longer rejected.
- Checked in the browser: a Lightroom sidecar's 4 stars + Green came through on import; pressing 5 and 6 wrote
  5 stars + Red, kept `crs:Exposure2012`, and a Develop edit appeared as `lightbench:Develop`.

### Export
| Step | Based on | Notes |
|---|---|---|
| Rendering | darktable high-quality export | Full-resolution develop, then **Lanczos3** resampling in linear light before the output profile (`finalscale` before `colorout`). Size = floor(scale × size); "Don't enlarge" on by default. |
| Size choices | Lightroom + darktable | Original, long edge, short edge, width × height (darktable's max size), percentage. |
| Output colour | darktable `colorout` | sRGB (default), Display P3, Adobe RGB; matrix + tone curve; profile always embedded; EXIF ColorSpace = 1 only for sRGB. |
| Quantisation | darktable + benchmark | round(clamp(v) × (2ⁿ−1)). Triangular dither (±1 step) **on by default for 8-bit PNG/TIFF**: in the benchmark it removed banding completely (CAMBI 13.7 → 0.00). Measured cost on real photos: +4–6 % PNG size. |
| JPEG | Benchmark ([JPEG_ENCODER_BENCHMARK.md](research/JPEG_ENCODER_BENCHMARK.md)) | **jpegli** (Google) compiled to WebAssembly, in a worker: 16–24 % smaller than the browser's encoder at the same SSIMULACRA2 score in the benchmark. Quality 90 by default (presets Web 78 / High 90 / Archive 95); full colour detail (4:4:4) at quality ≥ 80, 4:2:0 below, or chosen manually; progressive. Optional **file-size limit** (interpolation search; measured: 300 KB limit → 248–285 KB in about 0.6 s at 3 MP). EXIF, XMP and ICC are inserted as APP1/APP1/APP2 segments. No dither (the benchmark found it has no effect in JPEGs). Rebuild: `web/scripts/build-jpegli.sh`. |
| PNG | darktable | 8/16-bit RGB, iCCP + cICP, eXIf, iTXt XMP, pHYs (300 dpi). Adaptive row filters; compression via the browser's deflate. |
| TIFF | darktable | 8/16-bit RGB, deflate + horizontal predictor (default) or none, ICC, XMP, EXIF IFD. |
| Metadata | darktable defaults | Camera/exposure/capture date (EXIF), rating + label (XMP), LightBench settings (XMP), each optional. `xmpMM:DerivedFrom` = original file name. GPS isn't stored yet, so it is never exported. |
| File names | darktable variables | `$(FILE.NAME)`, `$(SEQUENCE[4,1])`, `$(EXIF.YEAR)` … plus legacy names and operators; `/` makes subfolders. Presets in the dialog. On conflict: add `_01` (default), overwrite, or skip. |
| Where | — | A chosen folder (remembered), or next to each original, with an optional subfolder. |

Checked (jpegli): at 2048 px, quality 90 with full colour detail gave 502 KB and 546 KB, against 542 KB and 609 KB from the
browser's encoder at quality 90 with quarter colour detail; about 0.2 s per photo in the browser.

Checked: a full-size export matches the Develop render within 1 level; JPEG, 16-bit PNG and TIFF exports
decode in Pillow with the right size, embedded sRGB profile, camera EXIF and XMP; PNG and TIFF pixels are
identical.

**Precision note:** the pipeline keeps images as 16-bit floats on the GPU, so 16-bit exports carry about
11–12 bits of real precision. That is far beyond 8-bit (no banding when editing further), but not full 16-bit.
