# darktable: export, XMP sidecars, non-raw input

A design note for LightBench Part 3. It is based on reading darktable's source code (commit 6271f53); paths are relative to the darktable tree. Anything that couldn't be determined from the code is marked "unknown".

## 1. Export

### Output size
- **Size modes:** pixels, cm, inch or scale (`src/libs/export.c:79-85`).
  - cm and inch are converted with `ceil(cm·dpi/2.54)` and `ceil(inch·dpi)`. The default dpi is 300, also written to JPEG/TIFF/EXIF.
  - Scale accepts a fraction such as `1/3`; 0 or empty means 1 (`src/imageio/imageio_module.c:409-438`).
- **Limits:** the max width/height is the minimum of the non-zero user, storage and format limits; 0 means unbounded (`src/control/jobs/control_jobs.c:2108-2141`). The JPEG format limit is 65535.
- **Scale and rounding:** `scale = min(W/w, H/h, maxScale)`. maxScale is 1 unless upscaling is allowed (default off). Output = `floor(scale·w)`, `floor(scale·h)` (`src/imageio/imageio.c:1281-1321`).
- **"High quality" resampling** (default off; always used when upscaling):
  - With it, the pipe runs at full resolution and `finalscale` resamples near the end. In the v5.0 order that is just before `colorout`.
  - Without it, the whole pipe runs at the reduced size: raw files are demosaiced at full size, then downscaled.
- **Filters:** lanczos3 for scaling and bicubic for warps (crop, perspective, lens), both configurable (`data/darktableconfig.xml.in:2818-2843`).

### Colour, bit depth, encoders
- **Output profile:** sRGB by default (colorout), with perceptual intent. The intent only matters on the lcms2 path; matrix profiles ignore it.
- **ICC profile embedding:** always.
  - JPEG: APP2 `ICC_PROFILE` segments.
  - PNG: iCCP, plus cICP when known.
  - TIFF: the ICC tag.
  - WebP: ICCP chunk.
  - EXIF `ColorSpace` = 1 for sRGB, otherwise 0xFFFF.
- **Quantisation:** `round(clamp(v·(2ⁿ−1)))`. No dithering by default; the `dither` module (Floyd–Steinberg) is opt-in.
- **JPEG** (libjpeg API):
  - Quality 5–100, default **95**, baseline (not progressive), optimised Huffman.
  - Chroma subsampling "auto": 4:4:4 at q ≥ 93, 4:2:2 at q 91–92, 4:2:0 at q ≤ 90. So the default q95 gives 4:4:4.
  - DCT method: float DCT above q95.
  - Smoothing: applied below q80.
- **PNG:** 8 or 16-bit, RGB without alpha, zlib level 5, no interlacing; EXIF stored in an `eXIf` chunk.
- **TIFF:**
  - 8-bit, 16-bit or 32-bit float.
  - Deflate with predictor (default), level 6.
  - No alpha; single page unless masks are stored.
- **WebP / AVIF / JXL:** WebP quality 95; AVIF quality 90 (auto subsampling); JXL quality 95, effort 7.

### Metadata
- **Defaults:** EXIF, metadata, geotags, tags and develop history are on. Hierarchical tags, private tags and synonyms are off.
- **EXIF on export:**
  - **Set:** Orientation = 1; pixel dimensions; dpi; Software; DateTime = now. DateTimeOriginal is kept.
  - **Stripped:** MakerNote, thumbnails, DNG and colour-profile tags.
  - **From the photo's metadata:** Artist, Copyright and Description come from the `dc:` fields; Rating = stars.
- **Embedded XMP:** rating, `dc:*` fields (only those not marked private), `dc:subject`, and optionally `lr:hierarchicalSubject` and the develop history.
- **"Calculated metadata":** per-field formulas built from filename variables; an empty formula deletes the tag.

### File names
- **Default template:** `$(FILE_FOLDER)/darktable_exported/$(FILE_NAME)`. With several photos and no variable in the template, `_$(SEQUENCE)` is appended.
- **Variables** include:
  - capture date/time (`EXIF.YEAR` … `EXIF.SECOND`, `EXIF.DATE`);
  - current date/time (`YEAR` …);
  - camera settings (`EXIF.ISO`, `EXIF.EXPOSURE`, `EXIF.APERTURE`, `EXIF.FOCAL.LENGTH`, `EXIF.MAKER`, `EXIF.MODEL`, `EXIF.LENS`);
  - source file (`FILE.FOLDER`, `FILE.NAME`, `FILE.EXTENSION`);
  - batch and image (`SEQUENCE[n,m]`, `VERSION`, `STARS`, `LABELS`, `TAGS`, `ROLL.NAME[n]`, `WIDTH.EXPORT`, …);
  - any metadata field.

  Bash-style operators such as `$(v-default)`, `$(v:off:len)` and `$(v^^)` are also supported (`src/common/variables.c`).
- **When the file exists:** unique name `_01`, `_02`… (default), overwrite, overwrite if changed, or skip.
- **Sharpening:** darktable applies no output sharpening on export.
- **Styles at export:** applied to a temporary copy, either replacing or appending to the history.

## 2. XMP sidecars

- **Naming:** `file.ext.xmp`; duplicates are `file_01.ext.xmp`. A Lightroom-style `file.xmp` is imported only when no darktable sidecar exists.
- **What darktable writes:**
  - `xmp:Rating` (−1 = rejected, 0–5 = stars), `xmpMM:DerivedFrom`, `exif:DateTimeOriginal`, GPS, `dc:*` metadata, `dc:subject`, `lr:hierarchicalSubject`.
  - Colour labels go in `darktable:colorlabels` (0 red … 4 purple). **darktable never writes `xmp:Label` but reads it, and it takes precedence when present** (`src/common/exif.cc:698-720`).
  - darktable namespace `http://darktable.sf.net/`, `xmp_version = 5`. History entries hold each module's raw C struct as hex, or `gzNN` + base64(zlib) above 100 bytes, plus masks, iop order and hashes.
- **When darktable writes:**
  - Default "on import", i.e. always.
  - On rating/label/tag changes, on history autosave (every 10 s) and on leaving the darkroom, through a de-duplicating background queue.
- **Preserving other apps' data:** an existing sidecar is parsed and only darktable's own keys are replaced. **Other applications' properties are preserved.** The file is rewritten only when its content changed (MD5 comparison).
- **Reading back:** the sidecar is read on import. After that the database is the master. Rescanning for externally changed sidecars on startup is off by default; when on, it compares sidecar modification times with the last write time and lets the user choose a direction.
- **Do not copy:** darktable writes timestamps in one unit but reads `xmp_version` 5 files in another.

## 3. Non-raw (JPEG/PNG/TIFF) input

- **Decoding:** 8-bit data is stored as `v/255` without linearising. Linearisation happens in the input colour profile module (`colorin`), using the input profile's TRC and matrix to reach linear Rec.2020.
- **Input profile selection:**
  - the embedded ICC profile (for PNG, cICP takes priority);
  - otherwise EXIF ColorSpace / InteropIndex `R03` → Adobe RGB;
  - otherwise sRGB.
- **Default modules for a JPEG:** none of the scene-referred defaults (exposure +0.7 EV, sigmoid, color calibration) are applied. A JPEG gets only the input profile, the output profile and the auto orientation step.
- **Skipped for non-raw files:** white balance (it would act on non-linear data), raw prepare, demosaic and highlight reconstruction. darktable expects white balance on a JPEG to be done after linearisation (color calibration).
- **Orientation:** the EXIF orientation is applied as a pipeline step (flip "auto"), not at decode. Export writes Orientation = 1.
