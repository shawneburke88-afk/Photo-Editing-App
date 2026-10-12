# LightCraft catalogue: input, decoding and colour

Scope: LightCraft v0.7.1, commit 701f78ea2e586d4748705f10fdf5c4181dc1fd49 (2026-10-12). Crates `raw`, `codecs`, `heif`, `tiff`, `meta`, `color`, `preview`, `raster`, and their docs. Compared with LightBench at `/home/user/Photo-Editing-App` (web/src/engine and docs/PLAN.md, PHASE0–2.md, USABILITY.md).

Method: I read the source and docs only. Nothing from LightCraft was built, installed or run. Paths starting `crates/`, `docs/`, `apps/` or `assets/` are inside the LightCraft clone. Paths starting `web/` or `docs/PHASE…` are in LightBench. Claims about LibRaw coverage come from LightBench's docs and from text strings inside the bundled `libraw.wasm` (`web/node_modules/@colorhythm/libraw-wasm/dist/libraw.wasm`). I did not decode any test files with it, so those claims are marked *unverified*.

Effort scale (rough, agent time): **S** = up to about a day, **M** = a few days, **L** = a week or more.

---

## Summary table

| Crate | Purpose | Maturity | Licence | WASM-ready | Verdict | Effort |
|---|---|---|---|---|---|---|
| `raw` (lightcraft-raw) | Pure-Rust camera RAW decoder (DNG, CR2/CR3, NEF, ARW incl. ARW6, RAF incl. compressed and X-Trans, RW2, PEF, ORF uncompressed, SRW uncompressed), DNG colour model, demosaic, highlight recovery, embedded previews, DNG writer | High for its scope: ~400 tests, clean-room, no-panic lints. Its own measure says 235 camera models verified on real files, ~85% of photographers' cameras "should" work (use-weighted estimate). Gaps: compressed ORF, compressed SRW, CR3 variants, Nikon HE, Hasselblad/IIQ/X3F. Colour for non-DNG raws is weak (no camera matrices) | MIT OR Apache-2.0. Bundles a 52-camera matrix table derived from rawtoaces-data (Apache-2.0) and CIE data (CC-BY-4.0) | Yes. Compiled into LightCraft's own web app and checked for wasm32 in CI. Single-threaded in the browser | **Port selected parts** (DNG colour model, preview colour-space hints, RAF preview window). **Compile to WASM** only as a fallback for the formats LibRaw 0.22.1 appears to lack (Sony ARW6, JPEG XL DNG) if the owner needs them | Port: S–M. WASM fallback: M |
| `codecs` | Format sniffing; decode JPEG/PNG/TIFF/WebP/PSD/JXL/GIF/BMP to linear light with ICC (moxcms); encoders; display-profile and soft-proof transforms; HDR gain-map JPEG | Good: ~100 tests incl. fuzz/proptests. No AVIF decode. HEIC only with the `heif` feature | MIT OR Apache-2.0. Dependencies are permissive (one, jpeg-encoder, also carries the IJG licence) | Yes, except AVIF and JXL *encode*, which are compiled out on wasm32 | **Idea only** for now. Compile to WASM later if LightBench adds 16-bit PNG/TIFF/PSD/JXL input or LUT ICC profiles | M (if done) |
| `heif` | Optional HEIC/HEIF decoder: a wrapper around `heic-rs` 0.1.1 with libheif-matching YCbCr→RGB | Moderate: 24 tests, synthetic fixtures. Refuses 4:2:2/4:4:4 (Canon/Sony HIF). Depends on a young single-maintainer crate | MIT OR Apache-2.0 (heic-rs is MIT OR Apache-2.0). HEVC patents are flagged as the distributor's call | Compiles, but LightCraft's own web build leaves it out. On wasm a panic in heic-rs aborts the page (its `catch_unwind` guard does nothing there) | **Avoid** for now | L (risk mostly legal and robustness) |
| `tiff` | TIFF/BigTIFF IFD reader and writer, plus maker-note offset rules for 7 vendors | Good: 20 tests, proptests, allocation caps | MIT OR Apache-2.0, no deps besides serde/thiserror | Yes | **Idea only** (maybe port the maker-note header rules) | S |
| `meta` | EXIF, XMP read/write/merge, IPTC-IIM, CR3 metadata boxes, GPX track logs, an "all tags" listing | Good: 62 tests incl. proptests and truncation tests | MIT OR Apache-2.0 (quick-xml MIT) | Yes | **Port selected parts**: IPTC-IIM reader; EXIF from TIFF-based raws (GPS, copyright, UTC offset); later GPX geotagging | S each |
| `color` | Matrices, RGB spaces, Bradford, CCT/tint, transfer curves (sRGB, PQ, HLG), OkLab/HSL/HSV, monotone splines | Small and solid: 22 tests | MIT OR Apache-2.0 | Yes | **Idea only**: LightBench already has equivalents, taken from darktable | — |
| `preview` | Thumbnail cache: content hash, memory LRU, disk cache with byte budget, prioritised job pool | 13 tests. Disk cache uses `std::fs` (desktop). The web app has its own OPFS version | MIT OR Apache-2.0 | Partly (job pool runs inline on wasm; disk part is desktop-only) | **Idea only** (cache keys and byte budget) | S |
| `raster` | CPU image buffers, Lanczos/Mitchell resampling, box-blur Gaussian, display histograms incl. HDR bins | 13 tests | MIT OR Apache-2.0 | Yes (rayon is optional) | **Avoid / idea only**: LightBench does this on the GPU | — |

**Licence compatibility.** MIT and Apache-2.0 code can be included in a GPL-3.0-or-later program as long as copyright and licence notices are kept. Apache-2.0 also has NOTICE and "state your changes" duties. This is my reading, not legal advice. Every file in these eight crates is MIT OR Apache-2.0 (workspace `Cargo.toml`: `license = "MIT OR Apache-2.0"`). The only bundled data with extra terms is `crates/raw/src/spectral_table.rs`: Apache-2.0 via rawtoaces-data, plus CIE colour-matching functions under CC-BY-4.0. See `NOTICE` and `assets/ATTRIBUTION.md`.

---

## How LightCraft uses these crates in its own web app

- `apps/lightcraft-web/Cargo.toml` depends on `lightcraft-engine`, `lightcraft-codecs`, `lightcraft-raster` and `lightcraft-preview`. The engine (`crates/engine/Cargo.toml`) pulls in `raw`, `meta`, `color` and, through `raw`, `tiff`. So every crate in this scope except `heif` ships in their browser build. `heif` is behind a non-default `heif` feature, and `xtask/src/web.rs` builds the web app without it.
- `docs/web.md`: the full wasm module is 13.5 MB, about 3.1 MB with brotli. It includes "every codec and raw decoder". Rendering runs in Web Workers, each with its own copy of the module. There are no wasm threads, so rayon runs single-threaded.
- `docs/hardware-parity.md`: on the web, LightCraft is **CPU-only and single-threaded** ("no WebGPU yet"). That is the opposite of LightBench's WebGPU pipeline.
- `xtask/src/main.rs` (`wasm_set`, `cmd_wasm`) runs `cargo check --target wasm32-unknown-unknown` on every layer L0–L5 crate in CI. All eight crates here are in that set. This shows they *compile* for wasm32. It does not show how fast they run there, and I did not measure that.
- Two small inconsistencies in their docs: `docs/web.md` says AVIF export "may not be wasm-safe", but `crates/codecs/src/encode.rs` compiles AVIF encoding out on wasm32. `docs/file-format-parity.md` says HEIC is "in every release build", while the comment in `crates/codecs/Cargo.toml` says "releases don't ship it yet". The packaging scripts (`packaging/{linux,macos,freebsd}/package.sh`) do enable `heif` for desktop builds.

---

## 1. `raw` (lightcraft-raw)

**Purpose.** A pure-Rust raw decoder. It turns a camera file into sensor samples plus everything needed to render them: CFA, black/white levels, active area, default crop, orientation, DNG colour tags, opcode lists and metadata. It also contains demosaicing, highlight reconstruction, the DNG colour model, embedded-preview extraction and a DNG writer.

**Files and public API read.**
- `crates/raw/src/lib.rs`: `probe`, `decode`, `probe_info` (header-only; NEF reads only 128 rows), `RawFormat`, `RawImage`, `RawInfo`, `Cfa`, `BlackLevel` (DNG repeat pattern plus row/column deltas), `ColorData`, `RawImage::normalized`/`develop`/`develop_crop`. `#![forbid(unsafe_code)]`, and clippy denies `unwrap`/`panic`/`todo`/`unimplemented`.
- Vendor decoders in `crates/raw/src/vendor/`: `nef.rs` + `nefc.rs`, `cr2.rs` + `cr2/sraw.rs`, `cr3.rs` + `crx.rs` + `crx_wavelet.rs`, `arw.rs`, `arw6.rs` + `llvc.rs` (Sony ARW6, SMPTE RDD 34), `raf.rs` + `rafc.rs`, `rw2.rs`, `pef.rs`, `orf.rs`, `srw.rs`, `sr2.rs`, `kodak.rs`. Shared: `ljpeg.rs` (LJ92 decode and encode, incl. Hasselblad predictor 8), `dng.rs`, `jxl.rs` (DNG 1.7 JPEG XL via jxl-oxide), `opcodes.rs`.
- Every vendor module states its sources: specifications, Laurent Clévy's prose notes, patents, ExifTool tag-name tables, black-box checks against CC0 files. Each says no other decoder's source was read (e.g. the headers of `vendor/rw2.rs`, `vendor/crx.rs`, `vendor/rafc.rs`, `vendor/arw6.rs`). That is why the code can be MIT/Apache.
- Colour: `color.rs` implements the DNG colour model: `xyz_to_camera`, `camera_to_xyz_d50`, `camera_transform`, `wb_multipliers`, `neutral_to_xy`, dual-illuminant interpolation by inverse CCT, ForwardMatrix, CameraCalibration, AnalogBalance. `profile.rs` covers ProfileHueSatMap, ProfileLookTable and ProfileToneCurve. `gaintable.rs` covers ProfileGainTableMap (Apple ProRAW; read but off by default). `spectral.rs` + `spectral_table.rs` hold 52 cameras' ColorMatrix/ForwardMatrix for illuminants A and D65, fitted from rawtoaces-data spectral sensitivities.
- `preview.rs`: `embedded_preview` (largest JPEG or DNG 1.7 JXL preview from any IFD, the maker-note preview IFD, Olympus, the CR3 track, the RAF header). `bounded_preview` + `PREVIEW_PREFIX` (4 KiB) + `embedded_preview_from_range` read just the preview, **for RAF only**. `embedded_preview_color_space` reads the Nikon maker note `0x001e`, or EXIF ColorSpace plus InteropIndex `R03`, so an Adobe RGB camera JPEG with no ICC profile is still read correctly. `embedded_preview_dynamic_range_optimized` reads Sony DRO, maker note `0xb025`.
- `demosaic/`: bilinear, PPG, AHD (default), and an in-house X-Trans "directional" method. `highlight.rs`: neutral clipping plus chromaticity diffusion. `dngwrite.rs`: uncompressed or LJ92 tiled DNG.

**Maturity.**
- Tests: about 333 `#[test]` functions in `src/`, plus 68 in `tests/` (`corpus.rs`, `cr3_corpus.rs`, `dng.rs`, `robust.rs`, `vendor_robust.rs`, `sparse_corpus.rs`), plus proptests. The real-camera corpus tests print "skip" and pass when the CC0 corpus has not been downloaded (`tests/corpus.rs`, `corpus_raw_decodes`), so a plain test run does not prove real-file decoding.
- No TODO/FIXME markers. Gaps show up as explicit `RawError::Unsupported` returns, about 160 across the crate. Examples: CRX vertical tiles, partial subbands and some marker families (`vendor/crx.rs` ~177–467); ARW6 12-bit mode (`vendor/arw.rs:638`); Nikon HE (`vendor/nef.rs:241`); compressed ORF and SRW. `KNOWN_UNSUPPORTED` in `tests/corpus.rs` lists CR3 variants, compressed Olympus ORF, `-he.nef`, and sRAW in CR3.
- LightCraft's own scorecard (`docs/raw-parity.md`): of 1,446 Adobe-listed models, 235 are verified on real files, 942 should work but are unverified, 233 are preview-only and 36 are unsupported. About 85% of photographers' cameras would decode (an estimate weighted by camera use). Canon CR3 is the weakest major format, with 4 bodies verified. "RAW readiness" is put at about 56%. Colour is scored at about 35%: non-DNG raws carry **no Adobe matrix**, so they start from either a per-file look fitted to the embedded JPEG (`docs/camera-preview-colour.md`), 4 pooled profiles, the 52 spectral matrices, or a neutral fallback. That fallback is a median ΔE of about 18 from the camera JPEG. Demosaic and highlight quality are described as "unmeasured" and "tuned by eye".

**Dependencies.** `lightcraft-tiff`, `-meta`, `-raster`, `-color`, `-geom`, serde, thiserror, **rayon** (always on), miniz_oxide, zune-jpeg, optional jxl-oxide (on by default). All are pure Rust, with no C. Threads come only through rayon, which runs single-threaded on wasm32. There is no SIMD intrinsics code of its own; zune-jpeg is built with its `x86`/`neon` features in the workspace. No GPU.

**WebAssembly suitability.** Good, on the evidence above: LightCraft ships it in its web app, and CI checks it for wasm32. It works on byte slices (`decode(&[u8])`), which suits a worker that already has an `ArrayBuffer`. Unknowns: the size of a raw-only module (LightCraft only reports the whole 13.5 MB app) and its single-thread speed in the browser. Their native numbers: compressed RAF 0.16–0.6 s (`docs/raf-compression.md`). No browser numbers are given.

**Relation to LightBench.** LightBench already decodes with **LibRaw 0.22.1 in WASM** (`web/src/engine/raw/decoder.worker.ts`; `docs/PHASE0.md`: 1,274 cameras, an 853 KB module). How the two compare:

| Format / feature | LibRaw 0.22.1 as bundled in LightBench | lightcraft-raw |
|---|---|---|
| Compressed ORF (every Olympus/OM body since ~2008) | Present: `olympus_load_raw` and OM-1 / OM-1 Mark II strings in the wasm *(unverified by running)* | **Refused** (preview only) |
| Compressed SRW (Samsung NX) | Present: `samsung2/3_load_raw` *(unverified)* | Refused |
| CR3, all CRX variants | `crxLoadRaw`, EOS R5 Mark II string present *(variant coverage unverified)* | Partial: 0x100 lossless, horizontal-tile C-RAW, single-tile 0x200; 4 bodies verified |
| Hasselblad 3FR/FFF compressed, Phase One IIQ, X3F | Present (`hasselblad_*`, `phase_one_load_raw`; X3F added in libraw-wasm 1.1.0) *(unverified)* | Preview only |
| Nikon HE / HE★ (Z 8, Z 9, Z 6III, Z f) | **No.** The wasm holds the string "HE/HE* formats are not supported yet" | **No** (needs a JPEG XS decoder) |
| Sony ARW6 "Compressed RAW 2" (ILCE-7RM6, per LightCraft) | **Probably no.** ILCE-7RM6 is not in the camera list strings and there is no matching load function *(unverified)* | **Yes** (8 CC0 files; 12-bit mode refused) |
| DNG 1.7 JPEG XL tiles | **Probably no**: the build contains `jxl_dng_load_raw_placeholder()` *(unverified)* | Yes (jxl-oxide) |
| Linear / demosaiced DNG (Apple ProRAW, many phone DNGs) | LibRaw decodes it, but **LightBench refuses it in its own code** (`extractSensor`: "Non-Bayer (linear/demosaiced) RAW files are not supported yet") | Yes, plus ProfileHueSatMap/LookTable/ToneCurve and semantic masks |
| X-Trans | LibRaw decodes it, but **LightBench refuses it** ("not supported yet"); its demosaic is planned for Phase 3 | Yes (own "directional" demosaic, quality unmeasured) |
| Camera colour matrices for non-DNG raws | **Yes**: LibRaw's built-in Adobe-derived matrices (`getRgbCam`, `getCamXyz`) for its whole camera list | **No**: 52 spectral matrices, 4 pooled profiles, otherwise a per-file JPEG fit or neutral |
| DNG dual-illuminant colour, ForwardMatrix, profile look tables, opcodes | Not used by LightBench. LightBench takes LibRaw's single `rgb_cam`. Whether LibRaw interpolates the two illuminants or applies the opcodes is *unverified* | Yes, implemented to the DNG 1.7 spec (`color.rs`, `profile.rs`, `opcodes.rs`) |
| Header-only preview read without loading the whole file | No. LightBench calls `lr.open(await file.arrayBuffer())` (`web/src/import/probe.worker.ts:73`) | RAF only (`bounded_preview`). Other formats read the whole file |

Net: for the owner's first cameras (Nikon NEF, Sony ARW), LibRaw is the safer decoder. It has wider coverage and real camera matrices. LightCraft's crate is ahead on three things: the newest Sony compression (ARW6), JPEG XL DNG, and a spec-complete DNG colour model.

**Reuse verdict: port selected parts. Optional WASM fallback.**
- *Port (S–M):* `color.rs` (dual-illuminant interpolation, ForwardMatrix, AsShotNeutral→xy) and `profile.rs` (HueSatMap/LookTable/ToneCurve) into TS + WGSL, for DNG files. That makes ProRAW/phone DNGs and Adobe-converted DNGs render as their profile intends. It needs the DNG tags. The LibRaw binding declares LibRaw's `dng_color` struct type, but I found no public getter for it (`index.d.ts`), so a small TS DNG tag reader may be needed (port from `crates/tiff`, S).
- *Port (S):* `embedded_preview_color_space` (Nikon `0x001e`, EXIF `R03`) and the RAF `bounded_preview` logic, for thumbnails (see the revisit section).
- *Compile to WASM and call (M), only if needed:* a thin wasm-bindgen wrapper around `lightcraft_raw::decode`, used **only** when LibRaw fails, e.g. for an A7R VI ARW6 or a JXL DNG. Costs: a Rust toolchain in LightBench's build (PLAN.md deliberately avoided a second language for now); an unknown module size; and no camera matrix for cameras LibRaw does not know (it would need LightCraft's spectral table or a JPEG fit for colour).
- *Avoid* replacing LibRaw wholesale. Coverage and colour would both get worse for NEF/ORF/CR3/SRW users.

---

## 2. `codecs` (lightcraft-codecs)

**Purpose.** Standard image formats. It sniffs the format by content and decodes to **linear light** in the source primaries, with an exact matrix/TRC ICC path, a moxcms CMS for LUT/CMYK profiles, and container hints (PNG cICP/cHRM, JXL enum, EXIF `R03`). It also does fast thumbnails, encoders with ICC/EXIF/XMP embedding, display (monitor) profile transforms, soft proofing, and ISO 21496-1 gain-map JPEG.

**Files and API read.** `crates/codecs/README.md`; `src/lib.rs` (`decode`, `DecodeOptions::fit`, `Decoded`, `read_header`, `decode_jpeg_with_fallback`, `to_working` → linear Rec.2020 D65, `decode_thumbnail[_with]`); module headers of `display.rs` (`DisplayProfile::correct`, `from_srgb`), `space.rs` (`SourceSpace`, `SpaceOrigin`), `icc.rs` (parse with moxcms, `write_matrix_trc`, `write_named`), `proof.rs`, `gainmap.rs` (`compute`, `apply`, `encode_jpeg`, `read_jpeg`), `convert.rs`. Other files: `jpeg.rs`, `jpeg_par.rs`, `png_codec.rs`, `tiff_codec.rs`, `psd.rs`, `jxl.rs`, `jxl_encode.rs`, `webp.rs`, `heif.rs`, `sniff.rs`, `encode.rs`.

**Maturity.** About 103 tests (`tests/roundtrip.rs`, `header.rs`, `corpus.rs`, `fuzz.rs`, `heif.rs`, plus unit tests), and "no decoder panics on malformed input (property-tested)". Gaps listed in the README and `docs/file-format-parity.md`: no AVIF decode (they found no permissive pure-Rust AV1 decoder); no arithmetic-coded JPEG; no extended-XMP write; TIFF first image only, with no EXIF on encode; PSD composite only; HEIC 4:2:2/4:4:4 refused. Their own score for non-raw formats is about 70%.

**Licence.** MIT OR Apache-2.0. Dependency licences are listed in the README: zune-jpeg, jpeg-decoder, png, tiff, image-webp, image, jxl-oxide (MIT/Apache); moxcms and jixel (BSD-3 OR Apache); ravif/rav1e (BSD); jpeg-encoder ((MIT OR Apache) AND IJG). They state that nothing AGPL or GPL is used.

**Dependencies, threads, WASM.** All pure Rust. rayon is optional (`parallel` feature, on by default). AVIF and JXL encoders are behind `cfg(not(target_arch = "wasm32"))`, because jixel spawns its own threads. It is used by LightCraft's web app. On wasm, panics abort, so the `catch_unwind` guards around third-party decoders don't apply (README "Gaps").

**Relation to LightBench.** LightBench imports only RAW and JPEG (`web/src/import/plan.ts`: `JPEG_EXTENSIONS = ['jpg','jpeg']`). JPEG pixels come from the browser (`createImageBitmap(..., { colorSpaceConversion: 'none' })` in `web/src/engine/raw/decoder.worker.ts`). Colour comes from LightBench's own matrix/TRC ICC reader (`web/src/engine/color/icc.ts`), which falls back to sRGB with a note for LUT profiles. Export already covers JPEG (jpegli WASM), PNG and TIFF with embedded ICC. LightCraft adds 16-bit PNG/TIFF/PSD/JXL/WebP input, LUT/CMYK ICC, gain-map HDR JPEG (LightBench Phase 5), soft proofing (Phase 3) and display profiles.

**Reuse verdict: idea only for now.** If LightBench later wants 16-bit PNG/TIFF, PSD or JXL input, or LUT-based ICC, compiling `lightcraft-codecs` (with `default-features = false`, no `parallel`, no `avif`) to WASM and calling `decode` → linear float is a reasonable route (**M**). Porting it would not be: the value is in the dependency stack. For Phase 5 HDR export, `gainmap.rs` is a clear, permissively licensed reference for the ISO 21496-1 / MPF / `hdrgm` layout (idea, or port about 800 lines, **M**).

---

## 3. `heif` (lightcraft-heif)

**Purpose.** An optional HEIC/HEIF still-image decoder (iPhone/Mac photos). `heic-rs` 0.1.1 parses the container and decodes HEVC. This crate does the YCbCr→RGB conversion itself so colours match libheif (VUI range/matrix, chroma upsampling, `imir`, grid ICC).

**Files and API read.** `crates/heif/README.md`; `src/lib.rs` (`probe`, `decode`, `decode_thumbnail`, `Info`, `Options`, `Decoded`, `Error`); `src/ycc.rs` (`to_rgb16`), `src/vui.rs` (`signal`), `src/orient.rs`; `src/testdata.rs` (synthetic lossless HEIF builder).

**Maturity.** 24 tests, using synthetic PCM-coded 32×32 HEVC fixtures. Grids, 8–10-bit (lib doc says up to 16-bit), monochrome and alpha are supported. 4:2:2/4:4:4 is refused (heic-rs "loses sync"). Gain maps and depth are ignored. The README says heic-rs is a young, single-maintainer crate, pinned exactly, and that PhotoCraft's fuzzing found two panics in it.

**Licence.** MIT OR Apache-2.0; heic-rs is MIT OR Apache-2.0. **HEVC patents**: LightCraft leaves the decision to the distributor (`crates/codecs/Cargo.toml` comment, `crates/heif/README.md`).

**WASM.** It compiles, but LightCraft's web build does not include it. On wasm32, a heic-rs panic would abort the whole module (`apps/lightcraft-web/Cargo.toml` comment), and the page with it.

**Relation to LightBench.** Not planned in LightBench's docs. Chrome/Edge (LightBench's primary target) do not decode HEIC natively, as far as I know (not checked here).

**Reuse verdict: avoid for now.** Reasons: patent exposure is a decision for the owner; the decoder is young; a malformed file could crash the tab on wasm; Canon/Sony HIF files are not supported. Revisit only if the owner asks for iPhone HEIC import. Then it would be a WASM build of this crate plus a separate worker, so a crash only kills the worker (**L**, mostly risk review).

---

## 4. `tiff` (lightcraft-tiff)

**Purpose.** A TIFF/BigTIFF reader and writer, both byte orders, all field types. It resolves SubIFD, Exif, GPS and Interop pointers into a tree and knows each vendor's maker-note header and offset-base rules. It is the base for `raw` and `meta`.

**Files and API read.** `crates/tiff/README.md`; `src/lib.rs` (`Tiff::parse`/`parse_with`, `Tiff::sniff`, `all_ifds`, `exif`, `gps`, `find`, `Ifd` getters, `Value`, `ByteOrder`), `src/makernote.rs` (`parse_makernote` for Canon, Nikon types 1/3, Sony, Fujifilm, Olympus old/new, Panasonic, Pentax), `src/image.rs` (strip/tile chunk lists), `src/writer.rs` (`TiffWriter`), `src/tags.rs`.

**Maturity.** 20 tests including proptests. Robustness limits are documented: IFD loop detection, depth, entries and count limits, and decoded bytes capped at 8 × input + 1 MiB. Sources are public specifications only.

**Licence / deps / WASM.** MIT OR Apache-2.0; only serde and thiserror; no threads; suitable for WASM (in LightCraft's web build via `raw`).

**Relation to LightBench.** LightBench has a small JPEG-only EXIF reader (`web/src/engine/meta/exif.ts`) and a TIFF *writer* for export (`web/src/export/tiff.ts`, `web/src/export/exif-writer.ts`). Raw-file metadata comes through LibRaw.

**Reuse verdict: idea only.** If LightBench adds a TS TIFF/EXIF reader for raws (see `meta`), the maker-note conventions in `makernote.rs` (header length, byte order, offset base per vendor) are the useful part to port (**S**).

---

## 5. `meta` (lightcraft-meta)

**Purpose.** Photo metadata: EXIF (from whole TIFF/DNG/raw files, JPEG APP1, PNG `eXIf`, WebP `EXIF`), XMP read/write and *merge into an existing packet*, IPTC-IIM, Canon CR3 metadata boxes, GPX track logs for geotagging, and a full "all tags" listing.

**Files and API read.** `crates/meta/README.md` (`read_exif`, `from_tiff`, `embedded`, `parse_xmp`, `write_xmp`, `parse_iptc`, `extract`); module docs of `container.rs` (JPEG APP1/APP2/APP13, extended XMP reassembly, PNG, WebP, TIFF, CR3), `cr3.rs` (CMT1–CMT4, XMP uuid box), `datetime.rs` (DateTimeOriginal + OffsetTimeOriginal), `exif.rs`, `iptc.rs` (record 2, charset detection), `gpx.rs` (interpolates only within a track segment), `xmp.rs` (prefixes canonicalised by namespace URI), `xmp_merge.rs` (rewrites only owned properties and keeps everything else byte for byte), `tags.rs`.

**Maturity.** 62 tests, including proptests over every container walker and truncation at every byte (README "Robustness"). No TODO markers.

**Licence / deps / WASM.** MIT OR Apache-2.0; `quick-xml` (MIT), `lightcraft-tiff`, `lightcraft-geom`. No threads. In LightCraft's web build.

**Relation to LightBench.** LightBench already has XMP sidecars that keep other apps' fields (`web/src/sidecar/xmp.ts`, DOMParser, namespace-aware), keywords, IPTC Core fields in XMP (PHASE2 Part 11), and JPEG EXIF. Gaps that LightBench's own docs list and that this crate covers:
- "IPTC-IIM keywords inside JPEGs" not read (`docs/PHASE2.md:70`) → `iptc.rs` (124 lines).
- RAW copyright isn't read because LibRaw's `imgother` has no copyright field (`docs/PHASE2.md:292`) → reading IFD0 of TIFF-based raws, as `exif.rs` + `container.rs` do (CR3 needs `cr3.rs`).
- "GPS isn't stored yet" (`docs/PHASE1.md:128`). LibRaw already exposes `getImgOther().parsed_gps` in the binding LightBench uses (`index.d.ts`), so this may need no port. GPX geotagging (`gpx.rs`) is a later feature.
- Capture time is read as camera-local time treated as UTC (`web/src/engine/meta/exif.ts`, `parseExifDate`). `datetime.rs` shows how to use OffsetTimeOriginal.

**Reuse verdict: port selected parts (S each).** Port `iptc.rs` to TS for JPEG keywords and captions. Port the IFD0/Exif reading for TIFF-based raws (Artist, Copyright, OffsetTime), with `tiff`'s parser essentials. Keep LightBench's own XMP writer. `xmp_merge.rs`'s byte-preserving approach is an idea worth keeping in mind only if users report sidecar diffs.

---

## 6. `color` (lightcraft-color)

**Purpose.** Colour-science basics: `Mat3`, `RgbSpace` (sRGB, Display P3, Rec.2020, ProPhoto, Adobe RGB), Bradford adaptation, CCT/tint (`cct.rs`: Kim et al. 2002 Planckian locus, tint as Duv × 3000, with **positive = magenta**), transfer curves (`transfer.rs`: sRGB, gamma, PQ, HLG, fast 8-bit encoding), OkLab/OkLCh/HSL/HSV (`perceptual.rs`), monotone Fritsch–Carlson splines and 1D LUTs (`spline.rs`). Working space: linear Rec.2020 D65, the same as LightBench.

**Maturity.** 22 tests. `docs/tint-direction.md` records that LightCraft once had the global tint sign reversed (issue #188), fixed it, and added a regression test.

**Licence / deps / WASM.** MIT OR Apache-2.0; serde + geom only; trivially WASM-safe.

**Relation to LightBench.** Already covered: `web/src/engine/color/matrix.ts`, `temperature.ts` (translated from darktable's `temperature.c`, darktable's tint convention), `icc.ts`, `sigmoid.ts`, `cie-tables.ts`. LightBench's rule is to follow darktable first, so swapping its CCT/tint model for LightCraft's would go against the plan and gain nothing. PQ/HLG (Phase 5 HDR) and monotone splines (Phase 3 tone curve) are textbook formulas. darktable has its own curve code to consult first.

**Reuse verdict: idea only.** One takeaway: add a **tint-direction regression test** like LightCraft's (see the revisit section).

---

## 7. `preview` (lightcraft-preview)

**Purpose.** Infrastructure for showing a big library fast: a 128-bit SipHash content hash, a cost-bounded memory LRU, a disk thumbnail cache keyed by (content hash, settings hash, size, renderer version) with a byte budget pruned to 80% LRU, and a prioritised, de-duplicating job pool (inline on wasm).

**Files and API read.** `crates/preview/src/lib.rs` (`PreviewCache`), `hash.rs` (`Hash128`, `hash_bytes`), `lru.rs`, `disk.rs` (`DiskCache` get/put/prune; temp+rename writes; only touches files of its own name shape), `pool.rs` (`JobPool`).

**Maturity.** 13 tests (`src/tests.rs`). The disk cache is `std::fs` (desktop). The web app has its own OPFS/IndexedDB copy in `apps/lightcraft-web/src/files.rs` (per `docs/web.md`; I did not read that file).

**Licence / deps / WASM.** MIT OR Apache-2.0; siphasher, jpeg-encoder, zune-jpeg, log. The `DiskCache` part is not useful in a browser.

**Relation to LightBench.** LightBench's thumbnail store is `web/src/catalog/thumbs.ts`: OPFS `thumbnails/<photoId>.jpg`, an in-memory LRU of 600 object URLs, and no byte budget or renderer-version key. Whether it re-renders thumbnails after engine changes was not checked.

**Reuse verdict: idea only (S).** Consider keying rendered thumbnails by settings hash plus an engine/renderer version, so engine changes invalidate stale thumbnails. Also consider a storage budget.

---

## 8. `raster` (lightcraft-raster)

**Purpose.** CPU image containers (`Image<T>`, `Rgb32f`, `Rgba8`, `Plane`), separable Lanczos-3/Mitchell/box resampling, a three-box Gaussian blur, and histograms of display-encoded images, including an HDR variant (SDR range plus equal stops above white).

**Files and API read.** `crates/raster/src/lib.rs`, `resample.rs` (`weights`, `resize`, `Filter`), `blur.rs` (`box_radii`, `gaussian`), `histogram.rs` (`Histogram::of_srgb8`, `of_hdr`, `clipping`, `percentile`).

**Maturity.** 13 tests. Small, straightforward code.

**Licence / deps / WASM.** MIT OR Apache-2.0; rayon is optional. WASM-safe.

**Relation to LightBench.** LightBench does resampling, histograms and statistics on the GPU (`web/src/engine/gpu/mip.wgsl`, `stats.wgsl`) and draws its histogram as darktable does.

**Reuse verdict: avoid / idea only.** The HDR histogram binning is a small idea for Phase 5 HDR editing.

---

## Revisit completed LightBench features

For each feature LightBench has already built in this area, compared with LightCraft's equivalent.

| LightBench feature (where) | LightCraft equivalent | Decision | Why / what / effort |
|---|---|---|---|
| **RAW decoding via LibRaw 0.22.1 WASM** (`web/src/engine/raw/decoder.worker.ts`, `decoder.ts`) | `crates/raw` (pure Rust) | **Keep** | LibRaw covers compressed ORF, compressed SRW, all CR3 variants, Hasselblad and IIQ, which LightCraft refuses. It also brings real camera matrices. LightCraft's crate is ahead only on Sony ARW6 and JPEG XL DNG (both *unverified* gaps in LightBench's LibRaw build; see the `raw` section). **Optional improve (M):** a WASM fallback to `lightcraft_raw::decode` when LibRaw fails, *only* once the owner meets such a file. Test first with an A7R VI ARW6 or a JXL DNG to confirm LibRaw really fails. |
| Refusal of **linear DNG and X-Trans** (`extractSensor` in `decoder.worker.ts`) | `raw` decodes both (`dng.rs` LinearRaw; `demosaic/xtrans.rs`) | **Improve** | Linear DNG (Apple ProRAW, many phone DNGs): LibRaw already returns the 3-channel data (`getColor3Image` in the binding). LightBench needs an RGB-input path to the GPU, which it has for JPEG (`rgb-input.wgsl`), plus DNG colour (next row). **M.** X-Trans: keep the plan to translate darktable's Markesteijn demosaic in Phase 3. LightCraft's own method is "quality unmeasured" (`docs/raw-parity.md`), so it is not a better source. |
| **Camera colour matrices** (LibRaw `getRgbCam`/`getCamXyz`; `SensorData.camToRgb`, `xyzToCam`) | `raw/src/color.rs` (DNG model), `spectral.rs` (52 cameras), per-file JPEG fit | **Keep for non-DNG raws; improve for DNG** | For non-DNG raws, LibRaw's Adobe-derived matrices are better than anything LightCraft has: its own doc scores colour at ~35% and says non-DNG files carry no matrix. For **DNG files**, port `color.rs`'s dual-illuminant interpolation plus ForwardMatrix, and later `profile.rs`'s HueSatMap/LookTable/ToneCurve, so DNGs render as their embedded profile intends. **S–M**, plus a small DNG-tag reader if the LibRaw binding does not expose `dng_color` (not found on its public class; *unverified*). Whether LibRaw already interpolates illuminants is *unverified*. Optional data reuse: LightCraft's 52 spectral A/D65 matrix pairs (`spectral_table.rs`, Apache-2.0 + CC-BY-4.0) could enable illuminant interpolation under tungsten for those bodies. The benefit over Adobe's matrices is **unmeasured**, so it is low priority. |
| **White levels** (`web/src/engine/raw/camera-db.ts` + `camera-db.json` from rawspeed `cameras.xml`; `white-level.ts`) | Read per vendor from each file (`raw/src/vendor/*.rs`, `lift_clipped_samples`) | **Keep** | LightBench follows darktable/rawspeed as its plan requires. LightCraft's per-body bug list (`docs/raw-parity.md`: A450–A700 black level, 12-bit NEF black level in 14-bit units, phone-DNG white pile-up) is a useful **checklist for test files**, not a reason to change. One data point to check (S): LightCraft found 12-bit NEFs store maker note `0x003d` BlackLevel in 14-bit units (`docs/camera-preview-colour.md`, NEF section). LightBench takes black levels from LibRaw, which may already handle this. Verify on a 12-bit D5200/D7500 NEF. |
| **Embedded-preview thumbnails and loupe** (`web/src/import/probe.worker.ts`, `extractPreview` in `decoder.worker.ts`, `web/src/library/preview.ts`) | `raw/src/preview.rs` | **Improve (S)** | (1) **Preview colour space:** LightBench decodes the camera JPEG with `createImageBitmap` defaults, which honour an embedded ICC profile but not the raw's own "this preview is Adobe RGB" signals. Port `embedded_preview_color_space`: Nikon maker note `0x001e`; EXIF ColorSpace `0xFFFF` + InteropIndex `R03`; never for DNG. Then tag or convert such previews. That matters for photographers who shoot in Adobe RGB; how often Nikon previews lack an ICC profile is *unverified*. (2) **Read only the preview bytes** (an open to-do in LightBench's PLAN.md and PHASE2.md): LightCraft only does this for Fuji RAF (header fields at bytes 84/88, 4 KiB prefix, `bounded_preview`). Its doc says TIFF-based raws can't do it reliably from a fixed prefix. The RAF part ports in under an hour. For NEF/ARW, LightBench would need a TS IFD walker that reads more of the file only when needed (**M**), and Fuji is not a first-target camera. |
| **JPEG input and input colour profile** (`decodeJpeg` in `decoder.worker.ts`; `web/src/engine/color/icc.ts`) | `codecs` (`jpeg.rs`, `icc.rs` via moxcms, `space.rs`) | **Keep** | The same priority order (embedded ICC → EXIF `R03` → sRGB), the same matrix/TRC maths, already tested (`icc.test.ts`). LightCraft adds LUT and CMYK profiles through moxcms. That is rare in photos and would mean a Rust WASM build (**M**), so it is not worth it now. |
| **White balance temperature/tint maths** (`web/src/engine/color/temperature.ts`, darktable translation; slider mapping `tintFromSlider`/`sliderFromTint` in `web/src/engine/develop/settings.ts`) | `color/src/cct.rs` (Kim et al. locus, Duv tint) | **Keep, add one test (S)** | Switching would break LightBench's darktable-first rule and its saved edits. Reading LightBench's mapping (slider + → smaller darktable tint → less green → magenta), the direction looks right. But no rendered-direction test exists (`settings.test.ts` only round-trips). LightCraft shipped this exact bug (`docs/tint-direction.md`). Add a test that renders a grey patch with Tint −50 and +50 and checks green and magenta respectively. |
| **EXIF reading** (`web/src/engine/meta/exif.ts` for JPEG; LibRaw fields for raws) | `meta` (`exif.rs`, `container.rs`, `cr3.rs`, `datetime.rs`, `iptc.rs`) | **Improve (S each)** | (a) GPS from raws: LibRaw's `getImgOther().parsed_gps` is already exposed by the binding. Wire it up, no port needed. (b) RAW Copyright: parse IFD0 of TIFF-based raws in TS (port the essentials of `tiff` + `meta/exif.rs`). CR3 needs `meta/cr3.rs` (S–M). (c) IPTC-IIM in JPEGs: port `iptc.rs`. (d) OffsetTimeOriginal for true capture time: port `datetime.rs` logic. |
| **XMP sidecars** (`web/src/sidecar/xmp.ts`) | `meta/xmp.rs`, `xmp_merge.rs` | **Keep** | It is already namespace-aware, preserves other apps' fields, and refuses to overwrite invalid XMP. LightCraft's byte-preserving merge is tidier for diffs but brings no new capability. |
| **Export colour spaces and ICC** (`OUTPUT_SPACES` in `web/src/engine/color/icc.ts`; `web/src/engine/gpu/export.wgsl`) | `codecs/src/icc.rs` (`write_named`, `write_matrix_trc`); export gamut mapping in `crates/pipeline/src/finish.rs` `gamut_map` (outside this scope) | **Keep; optional improve (S)** | LightBench offers sRGB, Display P3 and Adobe RGB with embedded profiles and clips each channel (`clamp` in `export.wgsl`). LightCraft adds ProPhoto and Rec.2020 and a luminance-preserving desaturation into gamut. If the owner wants ProPhoto/Rec.2020 export, adding them is **S**. Before changing clipping, check what darktable's `colorout` and sigmoid's hue preservation already do (project rule). No change for its own sake. |
| **Demosaic and highlight reconstruction** (darktable RCD and highlight reconstruction in WGSL, `raw-pipeline.wgsl`, `demosaic.wgsl`) | `raw/src/demosaic/` (AHD/PPG), `raw/src/highlight.rs` | **Keep** | LightBench's are translated from darktable. LightCraft describes its own as "quality unmeasured" and "tuned by eye" (`docs/raw-parity.md`). Its notes in the `highlight.rs` header on how colour leaks into rebuilt highlights are worth reading if users report magenta or teal skies. Idea only. |
| **Thumbnail cache** (`web/src/catalog/thumbs.ts`) | `preview` (`DiskCache`, `PreviewCache`) | **Keep; optional improve (S)** | Consider a renderer-version and settings key and a storage budget. Whether LightBench already invalidates thumbnails after engine updates was not checked. |
| **Develop display output** (sRGB only: `develop-display.wgsl` "→ display sRGB"; canvas `configure` without `colorSpace` in `develop-engine.ts`) | `codecs/src/display.rs`, `docs/display-profiles.md` | **Improve (S–M)** | LightCraft found that sRGB-only previews look wrong on wide-gamut screens (issue #787) and renders into the monitor's gamut. In a browser, the equivalent is to configure the WebGPU canvas with `colorSpace: 'display-p3'` and output P3 when `matchMedia('(color-gamut: p3)')` is true; the browser handles the monitor profile. LightCraft's code isn't needed. That browser support works this way is from general knowledge, *not verified here*. |

---

## Top recommendations for LightBench in this area (ranked)

1. **Keep LibRaw as the decoder.** Its coverage (compressed ORF/SRW, all CR3, IIQ, 3FR) and its Adobe-derived matrices beat lightcraft-raw for the owner's Nikon/Sony cameras and most others. LightCraft's own doc rates its colour for non-DNG raws at ~35%.
2. **Fix preview colour for Adobe RGB cameras (S).** Port `embedded_preview_color_space` (Nikon `0x001e`, EXIF `R03`) from `crates/raw/src/preview.rs`, so thumbnails and the loupe aren't washed out for Adobe RGB shooters.
3. **Add a tint-direction render test (S).** LightCraft shipped a reversed tint once (`docs/tint-direction.md`); LightBench has no rendered test for it.
4. **Accept linear DNGs and give DNGs their full colour model (M).** Use LibRaw's 3-channel output, then port the DNG dual-illuminant/ForwardMatrix maths from `crates/raw/src/color.rs`, and later `profile.rs`. This unlocks iPhone ProRAW and phone DNGs.
5. **Metadata gaps already on LightBench's list (S each).** Wire up LibRaw's parsed GPS. Port `meta/src/iptc.rs` (JPEG IPTC keywords and captions). Read Copyright and OffsetTime from raw IFD0 (port `tiff` + `meta/exif.rs` essentials).
6. **Check the newest-camera gaps before they bite (S to test, M to fix).** LightBench's LibRaw build seems to lack Sony ARW6 (A7R VI) and JPEG XL DNG (*unverified*, based on strings in the wasm). If a real file fails, a WASM build of `lightcraft-raw` as a fallback decoder is the cleanest permissive fix (MIT/Apache, clean-room, no panics, already shipped in LightCraft's own web app).
7. **Wide-gamut preview (S–M).** Configure the WebGPU canvas for Display P3 on P3 screens. This is the idea from `docs/display-profiles.md`, done the browser way.
8. **Read only the RAF preview bytes (S)** if Fuji users appear. For NEF/ARW the same trick needs an IFD walker (M); defer until the owner's card-reader speed test shows it matters.
9. **Defer `codecs`, avoid `heif`.** Compile `lightcraft-codecs` to WASM only if 16-bit PNG/TIFF/PSD/JXL input becomes a goal. Leave HEIC alone unless the owner decides on the HEVC patent question; even LightCraft keeps it out of its web build.

## What I could not determine

- Whether LibRaw 0.22.1 as bundled actually fails on ARW6 and JXL DNG files. This is inferred from strings in the binary, not from decoding samples.
- Whether LibRaw interpolates DNG dual-illuminant matrices or applies DNG opcodes for LightBench. Also whether the libraw-wasm binding exposes `dng_color` (a type declaration exists in `libraw-types.d.ts`; I found no getter on the public class).
- The size and browser speed of a WASM build of `lightcraft-raw` alone. LightCraft only reports its whole 13.5 MB app.
- How often camera embedded JPEGs shot in Adobe RGB lack an ICC profile (this decides how much recommendation 2 matters).
- Whether `apps/lightcraft-web/src/files.rs` (the web storage layer) has anything reusable. I did not read it; it is outside this scope.
