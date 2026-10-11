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
| Highlights / Shadows / Whites / Blacks → **tone equalizer** bands | TS + WGSL | Translated from darktable `src/iop/toneequal.c`. Global mode for now: no guided filter, "RGB average" luminance. |
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
