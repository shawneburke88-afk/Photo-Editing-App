# AI Denoise feasibility spike: can the RawNIND Bayer denoiser run in LightBench?

Research only (2026-11-11). Nothing in the app, `release-notes.json` or the version changed, and no pull request was opened. Every number below was measured in this spike unless it says "published" (quoted from a source) or "estimate" (arithmetic on measured numbers). What could not be run is listed at the end. No legal opinions.

Decided by the owner beforehand and not reopened here: the model (RawNIND UtNet2, Bayer variant), CC BY 4.0 for the weights, the unpublished personal collection in its training as an accepted exception, Bayer sensors only, a cached result, patents read later.

Where things ran:

- **This container** (4 cores of an Intel Xeon 2.1 GHz, no GPU): ONNX Runtime Web 1.30.0 in Node 22 and in headless Chromium 153 (WebGPU on SwiftShader, a software renderer: correctness only, **not a real GPU**), and the all-fp16 PyTorch runs. Google Drive, the UCLouvain Dataverse and raw.pixls.us are blocked here.
- **GitHub's runner** (the "AI models" workflow, task `denoise-spike`, read-only job on this branch; 4 cores, 16 GB): everything that needs the authors' checkpoint, RawNIND pairs or raw.pixls.us files. Runs: [42942724406](https://github.com/shawneburke88-afk/Photo-Editing-App/actions/runs/42942724406) (probe), [42946445544](https://github.com/shawneburke88-afk/Photo-Editing-App/actions/runs/42946445544) (export, tiling, cameras), PAIRS_RUN. Their text results are in `web/scripts/denoise/results/`; the crops are in each run's `denoise-spike` artifact (kept 30 days; not committed, they are parts of photographs).

Scripts: `web/scripts/denoise/` (`fetch.py`, `export.py`, `dn_lib.py`, `quality.py`, `ort-web.mjs`, `action.sh`).

## Summary

| Question | Measured answer |
|---|---|
| 1. Export | ONNX (opset 17) made directly from the authors' checkpoint. Against PyTorch: largest relative difference 1.8e-6 (PSNR 134 to 146 dB). Its weights are **bit-identical** to darktable-ai's `model_bayer.onnx` (46 of 46 tensors), and the two files give identical outputs. |
| 2. White balance | **None.** With no white balance the model scores higher than with daylight or as-shot white balance in every crop tested (WB_COUNT). Mean MS-SSIM WB_NONE against WB_D65 (daylight) and WB_SHOT (as shot); colour errors are about half. The darktable-ai manifest and the training code are right; the darktable source comment is not. |
| 3. ORT Web 1.30 | WebGPU (SwiftShader) equals WebAssembly on the whole graph: largest relative difference 8.6e-7 at 256, 384 and 512 tiles. All 34 nodes run on the WebGPU provider, ConvTranspose included. The first-convolution fault (issue 29651) **still exists in 1.30.0 for 6 and 9 input channels but not for 4**, so this model is not affected. fp16 **overflows** (values over 65504 from the last two decoder levels on); **fp32 only**. |
| 4. Largest tensor | 64 MiB at a 512 packed tile, 36 MiB at 384, 16 MiB at 256 (100 MiB at 640; 144 MiB at 768 is over the 128 MiB limit). Peak memory with WebAssembly: about 0.5 GB (Node 482 MB; a Chromium tab about 0.5 GB above its idle size). |
| 5. Tiling | darktable's tile geometry with **one gain for the whole photo** matches an untiled run of the 24 MP photo to 0.05 to 0.09 % of the mean level (73 to 80 dB); no measurable seams. **darktable's per-tile gain causes brightness steps between tiles**: up to 13 % between neighbours on one 24 MP photo (mean 3.9 %), and makes the photo 3 to 13 % brighter overall. Use one global gain, computed like for like. |
| 6. Routes A and B | Same quality within the measure's bias: A (re-mosaic + RCD) AB_A, B (model's RGB) AB_B mean MS-SSIM against the clean frame developed with RCD; against the clean frame put through the model instead, AB_REFB. A has less colour speckle. Both get **purple fringes at clipped highlights** unless clipped photosites are kept from the source, which only A can do simply. A's cache is one third of B's. |
| 7. Speed | 512 tile, WebAssembly, 4 threads: 0.91 s in a Chromium tab, 1.1 to 1.4 s in Node. A 24 MP photo (35 tiles): **40 s in the tab, 46 s in Node**. One thread: 4.2 s per tile. WebGPU on SwiftShader (not a GPU): 87 to 95 s per tile, correct. Real-GPU speed: not measured. |
| 8. Other cameras | Works on a camera type it has not seen in RawNIND (Nikon D5200, raw.pixls.us), no artefacts, colour within 1 to 2 %. **No real high-ISO D5200 file was reachable** (the two public ones are ISO 200 and 280); with simulated noise it improves strongly noisy data and slightly **worsens** mildly noisy data (it removes fine detail). Hot pixels are removed (and with them single-photosite points such as faint stars). Clipped highlights: see 6. |
| 9. Terms | Dataverse record: "License Creative Commons CC BY-SA" (CC-BY-SA-4.0), **not** "CC BY 4.0 / CC0" as darktable-ai's card says. Upstream README at `e80fb7b`: "The weights are dual licensed GPL3 + CC-BY-4.0". |

**Recommendation: go, with route A.** Details and what a build needs are in [Recommendation](#recommendation).

## 1. Export and correctness

**Sources (downloaded on GitHub's runner, run 42946445544).**

| File | Where | Bytes | SHA-256 |
|---|---|---|---|
| `iter_4350000.pt` (the Bayer model darktable-ai names) | authors' Google Drive folder `12Uc5sT4OWx02sviUS_boDk1zDSDRVorw`, `rawnind_denoise/DenoiserTrainingBayerToProfiledRGB_4ch_2024-02-21-bayer_ms-ssim_mgout_notrans_valeither_-4/saved_models/`, file id `1dFTLeljWi9wwojcZUsam8bE31JdYy3oM` | 31,059,270 | `c1f7de3de24cb12f4803ee65e11cfb467e9a5b80c3cb7126746ef026106c15e0` |
| `iter_1245000.pt` (a variant trained **without** the authors' own pictures, see below) | same folder, `…_2024-11-22-bayer_ms-ssim_mgout_notrans_valeither_noowwnpics_mgdef_-1/saved_models/`, file id `1tR0LKO-TsdeV_vcWdBNKqBWqBmNobJnF` | 31,059,270 | `82e9799a2f73289d828df29065a043f1ccc6e1abd195a7b2af4263d51c5bf24d` |
| `rawdenoise-nind.dtmodel` | darktable-ai release `release-5.6.0` | 57,700,134 | `d71b5f1e727c85a359e6f74dca9e2016c9d8fc3e2f7ac3e9b347d80ceca969af` |
| `model_bayer.onnx` inside it | | 31,056,425 | `da27509dab6a2915da67e988acd86cf71f9d5bbc8d1aa0ed32933578a887b901` |

The checkpoint is a plain state dict of 46 tensors (7,760,748 values, `funit` 32); it loads into the authors' `UtNet2` with nothing missing or unexpected. Its `args.yaml` (in the same Drive folder) says `match_gain: output`, `loss: msssim_loss`, `bayer_only: true`, and lists the clean datasets `extraraw/trougnouf` (the personal collection) and `extraraw/raw-pixls`.

**Export** (`export.py export`): PyTorch 2.9.1, TorchScript exporter, opset 17, input `input` [1, 4, T, T], output `output` [1, 3, 2T, 2T]. Operators: Conv 19, LeakyRelu 18, MaxPool 4, ConvTranspose 4, Concat 4, DepthToSpace 1. ONNX Runtime Web 1.30.0 accepts it (section 3).

| File | Bytes | SHA-256 | Largest difference from PyTorch (4 real tiles of a Canon M100 ISO 6400 raw + noise), ONNX Runtime 1.30.0 CPU |
|---|---|---|---|
| `rawnind_bayer_512.onnx` (fixed 512) | 31,053,428 | `833e25f866cb5478793eb0eb075fd2b5615698118887774c423e98b67f936092` | relative 7.7e-7 to 1.3e-6 (\|Δ\| up to 0.25 on outputs up to 305,000); PSNR 134 to 145 dB |
| `rawnind_bayer_256.onnx` (fixed 256) | 31,053,428 | `0c6dbf9bcc3e83092aa6892a3fd8b4ea6b124074439fed745d494bce5d0f1e85` | relative 1.1e-6 to 1.5e-6 |
| `rawnind_bayer_dyn.onnx` (any height and width that are multiples of 16) | 31,053,430 | `0ea083ff26cacf29b33a62a88995dadb01838d40e3a024532ef274e829e653e8` | relative up to 1.8e-6 at 256, 384 and 512 |

The differences are float32 rounding: the model's output values are about a million times its input values (see section 5), so an absolute difference of 0.25 is 1e-6 of the range.

**Against darktable-ai's ONNX** (`export.py compare`): **46 of 46 weight tensors bit-identical**, largest \|Δ\| 0; outputs on the five test inputs identical (largest \|Δ\| 0). darktable-ai's file is the same weights exported with PyTorch 2.6.0 at opset 20. So the measurements here hold for both files, and a LightBench file made from the checkpoint carries exactly the published weights. (The export made in this container from darktable-ai's weights has the same SHA-256 as the one made on the runner from the checkpoint.)

**The variant without the authors' own pictures.** Its `args.yaml` lists only `extraraw/raw-pixls` as clean data, and its folder name says "noowwnpics". It is a different model (0 of 46 tensors equal; its output scale is about 100 times the input, not a million) with fewer training steps (1,245,000 against 4,350,000). Quality: NOOWN_RESULT. The owner already accepted the main model; this is recorded because it exists.

## 2. White balance in front of the model

**Sources.** darktable-ai's manifest: `"wb_norm": "none"`. Training code (`rawnind_jddc` at `e80fb7b`): the Bayer input is made by `raw.raw_fpath_to_mono_img_and_metadata` (black/white level only) then `mono_to_rggb_img` (`tools/crop_datasets.py`); `apply_whitebalance` is called only by a test script and by `raw.py`'s own command-line demo. darktable `src/common/ai/restore_raw_bayer.c` (master `c96cf1d`, comment at line 132): "RawNIND's v1 weights were trained on daylight-WB'd data".

**Test** (`quality.py pairs`, run PAIRS_RUN_ID). RawNIND test pairs from the Dataverse: a noisy frame and its clean base-ISO frame, WB_PAIRS. The noisy mosaic goes through the model three times: no white balance, daylight white balance as darktable computes it (D65 through the camera matrix, green = 1), and the as-shot white balance; the multipliers are divided out of the output again, as darktable does. Each result is developed with a NumPy port of LightBench's raw stage (section 6) by route A and by route B and compared with the clean frame developed the same way, on three 1024 × 1024 crops per pair (the centre and the two most detailed of a grid), after matching the mean. MS-SSIM is on the sRGB-encoded crops (the paper measures after a darktable development; these numbers are not comparable with the paper's table to the last digit).

WB_TABLE

- No white balance wins in **WB_COUNT** crops, by WB_DELTA MS-SSIM on average, more at higher ISO (Sony A7C ISO 51200: 0.873 against 0.785).
- Colour: mean error of the red/green and blue/green ratios against the clean frame WB_COLOUR.
- With daylight or as-shot white balance the output keeps more colour speckle (chroma high-frequency energy WB_CHROMA of the clean frame's, against WB_CHROMA_NONE without).

**Answer: feed the model the mosaic with black and white level applied and nothing else.**

## 3. ONNX Runtime Web 1.30.0

`ort-web.mjs`, the app's pinned `onnxruntime-web` 1.30.0, real tiles (Nikon night photos from the ISS, rawpy's test files `iss030e122639.NEF` and `iss042e297200.NEF`; one tile with clipped lights). Chromium 153 headless, `--use-webgpu-adapter=swiftshader`: adapter "google swiftshader", no `shader-f16`, binding limit 1 GiB. **SwiftShader is a CPU renderer; none of this says anything about a real GPU's speed, memory, or driver bugs.**

| Graph, tile | Nodes on WebGPU / on CPU (ONNX Runtime's own log) | WebGPU output against WebAssembly | Time per run on SwiftShader |
|---|---|---|---|
| darktable-ai `model_bayer.onnx`, 512 | 34 / 0 | max relative 4.7e-7, no non-finite values | 87 to 93 s |
| `rawnind_bayer_512.onnx`, 512 (tile with clipped areas) | 34 / 0 | max relative 8.6e-7 | 95 s |
| `rawnind_bayer_256.onnx`, 256 | 34 / 0 | max relative 8.1e-7 | 22 s |
| `rawnind_bayer_dyn.onnx` at 256 and at 384 | 34 / 0 | max relative 8.1e-7 | 25 s, 81 s |

(34 is the node count after ONNX Runtime's own graph optimisation of the 50-node file.)

**The first-convolution fault (onnxruntime issue 29651).** Single-Conv graphs whose 3 × 3 convolution reads the graph input directly (`export.py ops`), 64 × 64, fp32, WebGPU against WebAssembly:

| Input channels | WebGPU against WebAssembly |
|---|---|
| 3 | equal (max relative 2.9e-7) |
| **4** | **equal (max relative 3.5e-7)** |
| 6 | **wrong** (max relative 0.76, mean 0.14) |
| 9 | **wrong** (max relative 0.91, mean 0.16) |

So the fault reproduces in 1.30.0 exactly as reported (6 and 9 channels) and does not touch a 4-channel input. No workaround is needed for this model. A build's model check should still compare WebGPU with WebAssembly on a real tile (cheap, and it would catch a regression).

**ConvTranspose.** Four 2 × 2, stride 2 transposed convolutions, largest output 512 × 512 at a 512 tile: on WebGPU, correct (included in the whole-graph comparison). The reported fp16 fault above about 2048 output size is not reached.

**fp16** (`export.py fp16`, `rescale`).

- Largest absolute activation per layer in fp32, 9 inputs (4 real tiles, the same scaled by 4 and by 16, noise). fp16's largest finite value is 65,504:

  | Layer | Largest \|activation\| |
  |---|---|
  | encoder and bottom (`convs1` to `bottom`) | up to 6,800 |
  | `tconvs1`, `tconvs2` | 9,800; 20,600 |
  | `tconvs3.0` | 45,400 |
  | **`tconvs3.2`** | **137,000** |
  | `up4` | 141,000 |
  | `tconvs4.0`, `tconvs4.2` | 483,000; 3,890,000 |
  | output | 4,900,000 |

- With every tensor stored in fp16 (PyTorch on this container's CPU, which has AVX512-FP16; same weights), the output has **non-finite values on every test tile**: 0.1 to 12 % of the output of real tiles, 100 % for the noise input; the first layer with a non-finite value is `tconvs4.0` or `tconvs4.2` (`tconvs3.2` for a bright input).
- ONNX Runtime's **CPU** provider does not show this (the fp16 file gives finite output, 79 to 100 dB from fp32) because its CPU kernels compute in fp32 between casts. On WebGPU without `shader-f16` the fp16 file does not load at all ("Program Transpose requires f16 but the device does not support it").
- **Answer: fp32 only (31.05 MB).** As published, an fp16 file would be wrong on any GPU that really computes in fp16.
- A possible later saving, **not verified on a GPU**: multiplying the first convolution's weights and every bias by 1/1024 scales every activation and the output by 1/1024 and changes nothing else (the network has no normalisation layers and LeakyReLU is scale-free; in fp32 the rescaled network equals the original exactly, relative difference 0). With that, the all-fp16 PyTorch run is finite on all 9 inputs (largest activation 4,843) and within 74 to 96 dB of fp32 (largest relative error 1.3e-3). The fp16 file would be 15.5 MB. It needs a test on a real GPU with `shader-f16` before it could ship.

## 4. Largest tensor and memory

By ONNX shape inference (`export.py tensors`), fp32:

| Packed tile (sensor pixels) | Largest tensor | Next | Sum of all activations | 128 MiB binding limit |
|---|---|---|---|---|
| 256 (512 × 512) | 16 MiB | 8 MiB | 178 MiB | fits |
| 384 (768 × 768) | 36 MiB | 18 MiB | 400 MiB | fits |
| **512 (1024 × 1024)** | **64 MiB** (the last skip concatenation, [1, 64, 512, 512]) | 32 MiB | 711 MiB | fits |
| 640 | 100 MiB | 50 MiB | 1,111 MiB | fits |
| 768 | 144 MiB | 72 MiB | 1,600 MiB | **exceeded** |
| 1024 | 256 MiB | 128 MiB | 2,844 MiB | exceeded |

Weights: 29.6 MiB. Peak resident memory, WebAssembly, 4 threads: Node 482 MB at 512 (305 MB at 256); Chromium process tree 1,028 MB at 512 against 531 MB with only the runtime and a tiny graph loaded, so about 0.5 GB for the model and one tile. GPU memory on WebGPU was not measured (no GPU); the sum of activations (711 MiB at 512) is an upper bound if nothing were reused.

The whole 24 MP photo in one run (no tiles) on the runner's CPU: 15 s, **7.8 GB** peak. Not an option in a browser.

## 5. Tiling

`dn_lib.tiled` follows darktable's `restore_raw_bayer.c` (master `c96cf1d`): the working area starts at the first red photosite; tiles of T packed pixels with O overlap on each side (step T − 2·O); the mosaic is mirror-padded so the colour pattern is kept; each tile contributes its core plus a linear ramp of 2·O packed pixels centred on the core's edge (the two ramps sum to 1). Three ways to bring the output back to the input's scale were compared, each against **an untiled run of the whole photo** (the dynamic-size file on the runner's CPU):

- **global**: one number for the photo, sum of the source mosaic ÷ sum of the model output sampled at the same photosites (like for like);
- **darktable per tile**: for each tile, mean of the four packed input planes ÷ mean of the three output planes (`_bayer_gain_match`);
- **site per tile**: the like-for-like ratio, but per tile.

24 MP photos, 512 tile, 32 overlap, 35 tiles, no white balance:

| | Canon M100 ISO 6400 | Sony A7C ISO 6400 | Sony A7C ISO 64000 |
|---|---|---|---|
| Model's own scale (global gain) | 9.915e-7 | 9.908e-7 | 9.791e-7 |
| **global** against untiled, mean \|Δ\| (% of mean level) | **0.064** (seam bands 0.18, elsewhere 0.03); 77 dB | **0.048** (0.10 / 0.03); 80 dB | no untiled run |
| global: 128-pixel block brightness against untiled, sd / largest | 0.15 % / 1.6 % | 0.04 % / 0.5 % | |
| **darktable per tile**: step between neighbouring tiles, mean / max | 0.58 % / 1.6 % | **3.9 % / 13.3 %** (32 of 58 borders over 2 %) | 0.97 % / 3.5 % |
| darktable per tile: whole photo against the source | +3.2 % | +12.5 % | +12.7 % |
| darktable per tile: block brightness against untiled, sd / largest | 0.73 % / 4.3 % | 5.0 % / 17 % | |
| site per tile: step between neighbouring tiles, mean / max | 0.19 % / 0.67 % | 0.27 % / 1.2 % | 0.36 % / 1.7 % |
| site per tile against untiled, mean \|Δ\| | 0.23 % | 0.18 % | |

- **The model's scale does not change from tile to tile.** One gain reproduces the untiled result to a few hundredths of a percent, and the gain itself is nearly a constant of the model: 0.979e-6 to 0.999e-6 over the ten photos from six cameras in section 2.
- **Per-tile gain adds error; darktable's formula adds a lot.** Its two means are over different things: the input mean counts green twice (R, G, G, B), the output mean once (R, G, B). On un-white-balanced raw data green is the largest channel, so the ratio depends on each tile's colour: tiles come out 0 to 17 % too bright, differently per tile. The run's `tiling-a7c/tiling_gain_frame.jpg` shows the blocks. With daylight white balance in front (darktable's code default) the formula's bias is smaller (M100: 0.94 to 0.98 of the true gain) but section 2 shows that input is wrong for the model. This is a measurement of this spike's NumPy port of the formula in darktable's source, not of a darktable build.
- Even the like-for-like per-tile gain is worse than the global one (steps up to 1.7 %): a ratio of means over one tile is disturbed by the tile's own noise and clipping.
- **Seams** with the global gain: in the 64-pixel seam bands the difference from the untiled run is 0.10 to 0.18 % of the mean level, 0.03 % elsewhere. Not visible.
- **Smaller tiles** (M100 photo, global gain): 256 with 32 overlap, 176 tiles: 0.118 % (75.6 dB); 256 with 16 overlap, 126 tiles: 0.166 % (73.5 dB, seam bands 0.37 %). 512 with 32 is the best of the three and the fewest runs.
- All outputs finite on every tile of every photo.

**Answer: 512 packed tile, 32 overlap, mirror padding, linear ramps, and one global like-for-like gain per photo.** Not darktable's per-tile gain.

## 6. Routes A and B

**How it was tested.** LibRaw 0.22 (through rawpy 0.28) decodes; black and white level as LightBench's `prepare` does; the model with the settings above. Then a NumPy port (`dn_lib.py`) of LightBench's raw stage, index for index from `web/src/engine/gpu/raw-pipeline.wgsl` and `raw-linear.wgsl`:

- **Route A**: the model's RGB re-mosaiced (at each photosite the channel of its colour filter) → `prepare` (white balance) → highlights ("inpaint opposed", LightBench's default) → RCD → camera matrix. This is what LightBench does to any Bayer photo.
- **Route B**: the model's camera RGB → LightBench's existing **linear-DNG stage** (`raw-linear.wgsl`: white balance, the linear "inpaint opposed", camera matrix; no demosaic).

The port was not checked against the GPU engine itself. Sanity checks: its bilinear demosaic equals LibRaw's bilinear to 60 dB, and its RCD is 43.6 dB from LibRaw's AHD on a crop of a noisy Nikon night photo (different algorithms). Both routes use the as-shot white balance and the same matrix (dcraw's row-normalised camera matrix to Rec.2020), so they differ only in the demosaic and highlight steps.

**Against RawNIND clean frames** (the pairs of section 2, no white balance in front of the model):

AB_TABLE

- **Reference bias.** The clean frame has to be demosaiced by something. Developed with RCD it favours A; put through the model (route B on the clean frame) it favours B. Both are given. AB_BIAS
- **Detail.** Both routes keep the same amount: luminance high-frequency energy AB_LUMA of the clean frame's. The model smooths; that is the price at these ISOs (3200 to 64000).
- **Colour speckle and false colour.** A's chroma high-frequency energy is AB_CHROMA_A of the clean frame's, B's AB_CHROMA_B. RCD's colour-difference interpolation smooths what colour noise the model leaves; the model's own RGB keeps more of it. No zipper pattern was seen in either on the crops looked at (LOOKED).
- **Colour.** Mean red/green and blue/green errors against the clean frame: AB_COLOUR. No difference between the routes.
- Re-mosaicing and RCD lose little of the model's picture: AB_REMOSAIC.

**Clipped highlights** (Nikon D5200 `_DSC7535.NEF`, 2.7 % of photosites clipped: sky behind branches).

- At the 659,299 clipped photosites the model returns on average 0.988 of white, but the 1st percentile is 0.755: **29.7 % fall below LightBench's clip level (0.987)**, and 4.5 % of the bright unclipped photosites (0.8 to the clip level) rise above it.
- LightBench's highlight step decides per photosite by "value ≥ clip level". After the model that test gives a ragged answer along every highlight edge, and both routes show **purple fringes** where sky meets branches (`cameras/_DSC7535_real_crop2_clipped.jpg`): in A through the Bayer "inpaint opposed", in B through the linear one, which sees the model's lowered values.
- **Fix that works in A:** keep the source value at every photosite the source has at or above the clip level (and nothing else). The panel "A, clipped sites kept" has no fringes. This is a one-line rule on the mosaic. B has no simple equivalent: its three values per pixel are all the model's, and two of them have no source value to fall back on.
- The model's output is not limited to the input's range: values below black (down to −0.045 of white in a tile with clipped lights) and above white occur and must be clamped to the 16-bit range when stored.

**What each route implies for the engine.**

| | A: re-mosaic | B: model's RGB |
|---|---|---|
| Where it plugs in | Before everything: the cached result is a Bayer mosaic with the photo's own size, pattern, black and white level. It replaces `SensorData.data`; nothing in the engine changes. | As a linear (three values per pixel) source into the existing linear-DNG stage. The engine must switch that photo from the Bayer stage to the linear stage. |
| Strength slider | Blend of two mosaics per photosite, `strength · denoised + (1 − strength) · source` (24 million multiply-adds on the CPU, or two lines in `prepare`), then the normal raw stage. No model run. | Blend of two RGB pictures: the model's and the source demosaiced by RCD. The engine would have to run both stages and mix them, a new path. |
| Measured effect of the slider (D5200, noise estimate) | 0 %: 0.0105, 50 %: 0.0075, 100 %: 0.0061 | not built |
| Highlights | Unchanged pipeline, with the clipped-photosite rule above | Purple fringes; needs its own solution |
| Demosaic setting, X-Trans code, hot pixels | Demosaic choice keeps working; hot pixels are already gone from the mosaic | Demosaic choice has no effect on denoised photos |
| Edges | The 0 to 2 rows and columns outside the red-first working area keep the source values (as darktable does) | The picture is that much smaller, or needs filling |
| Cache per 24 MP photo (D5200, 6036 × 4020) | **48.5 MB** as 16-bit values; 37.7 to 40.0 MB with deflate (level 6) | **145.6 MB** as 16-bit RGB; 109 to 117 MB with deflate |
| Fingerprint | file identity + model file SHA-256 + tile/gain version. Strength is not part of it (blend happens after). | the same |

For scale: the source mosaic of the same photos deflates to 35.8 to 37.9 MB. A 16 MP Nikon night photo (`iss042e297200.NEF`): A 32.5 MB (12.2 MB deflated), B 97.6 MB (31.1 MB).

## 7. Speed and memory

fp32, real tile, after a warm-up run. "24 MP" is 35 runs of a 512 tile in a row on one session (the tile count of a 6000 × 4000 photo); packing, blending and the gain are not included (they are simple loops over 24 million values).

| Where | 512 tile | 24 MP (35 tiles) | 256 tile | Peak memory |
|---|---|---|---|---|
| ORT Web 1.30.0 WebAssembly, 4 threads, **Chromium tab** | 0.91 s | **39.7 s** (1.13 s per tile over the run) | 0.26 s (35 tiles: 9.3 s) | process tree 1,028 MB (531 MB idle) |
| ORT Web 1.30.0 WebAssembly, 4 threads, **Node 22** | 1.1 to 1.4 s | **46.4 s** | 0.46 s (35 tiles: 13.6 s) | 482 MB |
| the same, 1 thread, Node | 4.2 s | 147 s (estimate, 35 × 4.2) | | 383 MB |
| ORT Web WebGPU on **SwiftShader** (software, correctness only) | 87 to 95 s | not run | 22 s | process tree 1,221 MB |
| Native ONNX Runtime 1.30.0 CPU, GitHub runner (for comparison) | 0.67 s | 23.5 s | 0.17 s | |

A 24 MP photo at 256 tiles with 32 overlap is 176 tiles: 47 s in the tab (estimate, 176 × 0.265), no faster than 512. Session creation: 0.3 to 0.8 s. Real-GPU speed is unmeasured; the paper's 55 GMAC per megapixel is published, not a timing.

## 8. Other cameras, high ISO, clipped highlights, hot pixels

**What was reachable.** raw.pixls.us has two Nikon D5200 files: `NIKON_D5200_14_bit_compressed.NEF` (ISO 200, 1/160 s; SHA-256 `6c49ca47d189f9d6766f94be7c9d7d779ce45c79c0c6e48a0eba7d92f320fe0e`) and `_DSC7535.NEF` (ISO 280, 1/60 s; `daf6c47d846ac9d96df26c75ae01eadad03c9056b27da08b035204b5de1756d6`). The site asks for well-lit low-ISO photos; the listings of 18 more camera folders had no file whose name suggests high ISO. **So there is no real high-ISO photograph from the owner's camera type in this test.** Real high ISO was tested on RawNIND's own cameras (section 2, up to ISO 64000), including the Canon M100. The D5200 is not among RawNIND's cameras; whether the unpublished personal collection contains D5200 photos is unknown.

**D5200, real files (ISO 200 and 280), 24.3 MP, RGGB, black 0, white 16383.**

- Runs without problems: 35 tiles, all finite, no visible artefacts in the crops looked at. Colour against the source: red/green and blue/green within +0.4 to +1.5 % in unclipped crops; brightness 0.997 to 1.005.
- On these nearly clean photos the model still smooths: noise estimate 0.0068 → 0.0047 (A), luminance high-frequency energy −13 %. It is not a free improvement at low ISO.
- Hot-pixel candidates (a photosite far above its 8 same-colour neighbours): 25 → 0 and 2,395 → 1.

**D5200, simulated noise** (`quality.py single --synth-stops`; labelled synthetic everywhere). The file is underexposed by 4 or 6 stops in electrons (1.4 e⁻ per raw unit assumed), given Poisson shot noise and 3 e⁻ read noise, and amplified back; 2,000 photosites are set to white as hot pixels. **This has no fixed-pattern noise, banding or black-level drift, and the "original" it is scored against is itself an ISO 200/280 photo whose own grain the noisy version shares.** That bias favours "do nothing".

| Simulated | Crop | MS-SSIM noisy → A / B | PSNR noisy → A / B |
|---|---|---|---|
| +4 stops, `NIKON_D5200_14_bit` | 0 | 0.952 → 0.971 / 0.966 | 29.9 → 30.8 / 29.7 |
| | 1 | 0.920 → 0.952 / 0.946 | 25.7 → 28.1 / 27.2 |
| +6 stops, same | 0 | 0.842 → 0.948 / 0.944 | 23.1 → 28.4 / 27.8 |
| | 1 | 0.627 → 0.863 / 0.860 | 17.4 → 25.8 / 25.7 |
| +4 stops, `_DSC7535` | 0 | **0.962 → 0.958 / 0.950** | **32.0 → 29.7 / 28.9** |
| | 1 | 0.909 → 0.937 / 0.935 | 27.3 → 25.0 / 24.6 |
| | 2 (24 % clipped sky) | **0.954 → 0.934 / 0.930** | 30.7 → 28.0 / 27.2 |
| +6 stops, same | 0 | 0.850 → 0.931 / 0.924 | 24.6 → 28.6 / 28.0 |
| | 1 | 0.692 → 0.882 / 0.878 | 17.3 → 24.4 / 24.2 |
| | 2 (21 % clipped sky) | **0.931 → 0.915 / 0.913** | 28.2 → 26.3 / 25.9 |

- Strong noise: large gains. Mild noise on fine foliage, and bright sky: the model's result scores **below the noisy input** (with the bias named above). In the panels the foliage is visibly smoother than the original. This is the case for a strength slider and for not applying the model by default.
- The 2,000 simulated hot pixels: all gone (hot-pixel candidates 2,044 → 0 and 4,041 → 1); the model returns 0.16 to 0.20 of white there.
- A point one photosite wide is treated as a hot pixel. On a Nikon night photo from the ISS (rawpy's test file `iss042e297200.NEF`) 3,091 candidates → 0, and clipped single photosites (stars, city lights) come back at 0.57 of white on average. **Faint stars are at risk** in astrophotography.
- Per-tile gains again: darktable's formula 1.08 to 1.18 of the global gain on these photos.

**Unseen sensor with real noise.** M100_RESULT

## 9. Terms, quoted

- **RawNIND dataset**, UCLouvain Dataverse, `doi:10.14428/DVN/DEQCIM`, version 1.0, released 2025-01-15 (API record and the page text, read 2026-11-11 from GitHub's runner). The licence field, verbatim: "License Creative Commons CC BY-SA. This license enables reusers to copy, distribute, remix, adapt, and build upon the material in any medium or format, so long as attribution is given to the creator. The license allows for commercial use. If a reuser remixes, adapts, or builds upon the material, he must license the modified material under identical terms." URI `https://creativecommons.org/licenses/by-sa/4.0/`, identifier `CC-BY-SA-4.0`. No separate terms of use or terms of access are set; all 2,845 files are public (120.2 GB: 1,784 ARW, 298 CR2, 60 NEF, 15 CRW, 6 DNG, 677 RAF, and five other files). Related publication as given there: "Benoit Brummer and Christophe De Vleeschouwer. Joint Denoising, Demosaicing, and Compression with the Raw Natural Image Noise Dataset. To be published."
  - This differs from darktable-ai's model card ("Training data license | CC BY 4.0 / CC0 (per-image, Wikimedia Commons)"). The Dataverse record says CC BY-SA 4.0 for the dataset as a whole. What that means for weights offered under "GPL3 + CC-BY-4.0" is not for this document to say.
- **Upstream weights**, `trougnouf/rawnind_jddc` at `e80fb7b14dc440bba38c01f312fd3cc02deb566c`, `README.md`, verbatim: "Pre-trained models are available through the following link: https://drive.google.com/drive/folders/12Uc5sT4OWx02sviUS_boDk1zDSDRVorw?usp=sharing" and, on its own line, "The weights are dual licensed GPL3 + CC-BY-4.0". `LICENSE` there is the GNU GPL version 3.
- **raw.pixls.us** front page, upload form, verbatim: "I declare that I own full rights to this file and I hereby release it under the co license into the public domain." (the page's "co" is its CC0 mark).
- The Google Drive folder was listed (495 files) and the two checkpoints above downloaded; nothing else in it was read.

## Recommendation

**Route A (re-mosaic, then LightBench's normal pipeline), in plain words:**

- The two routes give the same picture quality as far as this can be measured. A is slightly cleaner in colour; B has no measurable advantage in detail.
- A is the small change: the result is just a cleaner version of the sensor data, the same size and kind as the original. Everything LightBench already does to a raw photo keeps working unchanged, and the strength slider is a simple mix of two mosaics.
- A can keep blown highlights correct with one rule (don't touch photosites that were clipped). B shows purple edges there and would need new work.
- A's cache is a third of B's: about 49 MB per 24 MP photo (38 to 40 MB compressed) against 146 MB (109 to 117 MB).
- What A gives up: the model's own demosaicing. Measured, that costs nothing visible (the re-mosaiced picture through RCD is AB_REMOSAIC_SHORT from the model's own picture).

**Go / no-go: go.** The model exports cleanly, runs correctly on ONNX Runtime Web 1.30.0 on both providers, fits the GPU limit with room, and a 24 MP photo takes about 40 s on a 4-core processor with no GPU at all. It is a one-time, cached step, so that wait is once per photo.

**What a build would need.**

1. **File**: LightBench's own ONNX export from the checkpoint above (fp32, 31.05 MB, opset 17, fixed 512 tile), published and pinned like the Sky and Subject models, with the CC BY 4.0 credit and the plain statement about the personal collection. No fp16 file.
2. **Pre-processing**: red-first crop, black and white level, **no white balance**, no clipping of the input.
3. **Tiling**: 512 packed, 32 overlap, mirror padding that keeps the colour pattern, linear ramps. **One global gain per photo**, sum of source ÷ sum of output at the same photosites. Not darktable's per-tile gain.
4. **Output**: re-mosaic; keep the source value where the source is at or above the clip level; clamp to 0 to white; store 16-bit. Rows and columns outside the working area keep the source.
5. **Gates**: largest tensor 64 MiB against the adapter's `maxStorageBufferBindingSize` (the existing rule); a model check that compares WebGPU with WebAssembly on a committed real tile and fails on any non-finite value; WebAssembly fallback allowed (it is a one-time step, about 40 s for 24 MP on 4 threads; about 2.5 min on one thread, estimate), with progress and cancel.
6. **Strength**: a blend of the cached mosaic with the source at load; default below 100 % is worth considering (the model softens fine detail at low noise).
7. **Cache**: OPFS, about 49 MB per 24 MP photo uncompressed (38 to 40 MB with deflate, which saves little); fingerprint = photo identity + model SHA-256 + a version of the tiling and gain rules.
8. **Warnings to write for the user**: it removes single-photosite points (hot pixels, and faint stars); at low ISO it softens more than it cleans.

**What remains unverified.**

- **Any real GPU**: speed, memory, and correctness on real WebGPU drivers. Only SwiftShader was available. The 128 MiB gate is met on paper (64 MiB).
- **Real high-ISO photos from a Nikon D5200** (none public where this spike could reach). The D5200 tests are ISO 200/280 files and simulated noise.
- **LightBench's GPU engine itself**: routes A and B were compared through a NumPy port of its shaders, not through the running app.
- **The fp16 rescale** on a GPU with `shader-f16`.
- **Long exposures** (thermal noise, amplifier glow) and other colour-filter orders than RGGB beyond the two Canon/Panasonic GBRG cameras in the pairs (Canon 7D and Panasonic GH1 are GBRG and worked).
- Whether the Canon M100 scenes were held out of the main checkpoint's training: its `args.yaml` lists ten reserved test scenes and the M100 ones are not among them (the later variant's list has them).
- darktable's own behaviour: the per-tile gain finding is from this spike's port of the formula in its source.
- Patents: not looked at, by decision.
