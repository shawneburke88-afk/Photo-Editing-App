# Unblur feasibility spike: can an AI camera-shake deblurring model run in LightBench?

Research only (2026-11-03). Nothing in the app, `release-notes.json` or the version changed. The build, if any, waits until after 1.0 (owner's decision, `UNBLUR_DECISIONS_2026-11-03.md`). Every number below was measured in this spike unless it says "published" (quoted from the authors) or "estimate" (arithmetic on measured numbers). What could not be run is listed at the end.

Owner's choices this tests: camera shake including rotation; automatic with a strength slider (a blend with the original, so no model change is needed for it); MISC Filter first, NAFNet as the backup; public test sets only.

## Summary

| | MISC Filter | NAFNet-GoPro-width64 (own export) | opencv_zoo NAFNet (REDS, int8) |
|---|---|---|---|
| Licence (pinned) | MIT, `aca59a8` — **but** its FFT block, DO-Conv layer and conv wrappers are DeepRFT's code, whose licence is non-commercial (fact below) | MIT (+ Apache-2.0 BasicSR), `2b4af71` | MIT, opencv_zoo `48b10fa` |
| ONNX export | **Yes, with three changes** (CUDA filter → PyTorch port; DO-Conv folded; FFT → ONNX `DFT`); matches PyTorch to ≤ 1.2e-6 | Yes, as is; matches to 6e-7 | Exists; **fails below ~384 px** inputs |
| Operators on ORT Web WebGPU / WASM | All present in both (GridSample only at opset ≤ 19; DFT, GatherElements yes); whole-graph WebGPU result ⟨speed run⟩ | All present ⟨speed run⟩ | **Wrong output on WebGPU** (SwiftShader: mean \|Δ\| 142 vs WASM on a test card); 1,494 nodes left on the CPU |
| Files | fp32 59.3 MB; fp16 41.5 MB **not usable** (non-finite values) | fp32 272 MB, fp16 137 MB | 91.7 MB |
| Largest tensor | 58.7 MB at 256²; **224 MiB at 512²** (over 128 MiB) | 33.5 MB at 256² ⟨512²⟩ | — |
| RealBlur-J / -R (50 each) | **+6.3 / +5.2 dB** (34.25 / 40.83; published 33.88 / 41.23); 50/50 and 49/50 better | +0.0 / +0.4 dB; 3 of 100 images collapse (256² tiles) | +1.7 / −0.3 dB |
| RSBlur (other camera) | **+2.2 dB** (13 pairs, 13 better) | **−8.3 dB** (24 of 24 worse) | −3.5 dB mean, 10 of 24 collapse |
| Real shake at full resolution (scene097, 2 frames) | +4.0 / +1.7 dB at 24 MP density, +3.7 / +2.3 dB at 42 MP; downscale route about the same for ~10× fewer tiles | +0.2–0.3 dB direct; +0.9–1.6 dB via downscale | not run |
| Tiling | 32–64 px blended overlap removes measurable seams (hard cuts: ~5× step) | same; 256² tiles unstable | — |
| Rotation (synthetic, 24 px at the corners) | **Weak**: corners +0.3 to +0.9 dB vs +3.9 to +5.4 dB for uniform blur of the same length; centre −1.6 dB | corners +1.7 to +3.4 vs +1.9 to +4.0 uniform | not run |
| Speed, CPU | ≈ 8.8 s per 256² tile (native ORT, 4 threads) ⟨WASM⟩ | ≈ 0.5–1.2 s per 256² | ≈ 5 s per 773 × 680 image (native) |

**Recommendation: ⟨recommendation⟩**


## 1. ONNX export and operators

| | MISC Filter (RealBlur_J / RealBlur_R weights) | NAFNet-GoPro-width64 (own export) | opencv_zoo `deblurring_nafnet_2025may.onnx` (NAFNet-REDS-width64 per its README) |
|---|---|---|---|
| Exports to ONNX? | **Yes, after three changes** (below). As published it does not: its filter is a CuPy CUDA kernel (`models/MISCKernel_cuda.py`; it raises `NotImplementedError` off the GPU), its 72 FFT blocks use `torch.fft.rfft2/irfft2` (the TorchScript exporter has no symbolic for them), and it writes `out_norm[mask] = 1.0` in place. | **Yes**, with the authors' `NAFNetLocal` (TLC pooling, their GoPro test setting); only `LayerNorm2d`'s custom autograd Function is replaced by the same formula in plain operations. | Already ONNX: opset 21, dynamic H × W, **int8 weights** with 447 `DequantizeLinear` (weight-only quantisation), TLC pooling baked in (72 `CumSum`). |
| Opset, exporter | 17, TorchScript exporter (torch 2.9.1, `dynamo=False`), one file per tile size (256, 512, 768) | 17, same | 21 |
| Operators (256 file) | Conv 321, ConvTranspose 2, **DFT 288**, **GridSample 6**, **GatherElements 196**, Floor 98, Clip 294, Softmax 1, Pad (edge) 1, Resize 8, Where 197, Range 72, plus shape/elementwise ops (14,160 nodes with constants) | Conv 226, DepthToSpace 4, GlobalAveragePool 36 (at 256; `CumSum` at 512+), ReduceMean 144, Pow/Sqrt 72, elementwise | Conv 226, DequantizeLinear 447, CumSum 72, Pad 73, DepthToSpace 4, ReduceMean 144, plus ~3,600 Constant and shape ops |
| Same output as PyTorch? | **Yes.** ONNX Runtime 1.30.0 (CPU) against the authors' network (their forward, with the filter port): max \|Δ\| 1.2e-6 at 256² and 512², 8.3e-5 at 768² (PSNR 116–140 dB), 2 test photos (the repo's public-domain astronaut and rocket fixtures). The export module itself equals the authors' forward exactly (max \|Δ\| 0). The filter port against a line-by-line NumPy transcription of the CUDA source, random inputs with offsets up to ±12 px (so the edge clamping is hit): max \|Δ\| 1.7e-6 (values up to 6.3). | **Yes.** max \|Δ\| 6e-7 (PSNR 146–150 dB) at 256², same 2 photos. | Not checked against PyTorch (no source graph); it **fails at 256²** ("Cannot use 'edge' mode to pad dimension with a value of 0", the TLC slices are empty below its traced size) and runs at 384² and up. |
| fp16 | **Not usable as converted.** onnxconverter-common 1.16.0, two variants (everything but the sampling/filter/FFT nodes in fp16; only Conv/ConvTranspose/Relu in fp16): both produce non-finite values that reach the filter's gather indices ("GatherElements op: Out of range value in index tensor"). Not investigated further. | Works: against PyTorch fp32, PSNR 78.6 / 82.6 dB, max \|Δ\| 0.0013, no non-finite values. | n/a (int8 weights, fp32 compute) |

**The three changes for MISC Filter** (`web/scripts/unblur/unblur_models.py`): (1) the CUDA filter ported to PyTorch with the CUDA code's own clamping (position and the four neighbours clamped separately, so samples past the edge count twice, as on the GPU); 49 taps, each a `GatherElements` on the flattened image; (2) DO-Conv folded into plain convolutions (the weight its forward computes); (3) each FFT block's `rfft2`/`irfft2` exported as ONNX `DFT` nodes through a symbolic function (the inverse rebuilds the conjugate half and keeps the real part). Only the final, full-resolution output is exported (the two coarser outputs only feed the training loss).

### Operator support in ONNX Runtime Web 1.30.0 (measured, not from documentation)

Single-operator graphs (`op_graphs.py`), run in headless Chromium with WebGPU on SwiftShader, placement read from ONNX Runtime's own verbose log ("Node(s) placed on [CPUExecutionProvider]…"), output compared with the WebAssembly backend:

| Operator (as the candidates use it) | WebGPU EP | WebAssembly | WebGPU vs WASM |
|---|---|---|---|
| GridSample, opset 16 (bilinear, zeros, align_corners) | **yes** | yes | identical |
| GridSample, opset 20 (mode "linear") | **no, left on the CPU** | yes | identical |
| GatherElements (+ Floor, Clip, Cast to int64) | yes | yes | identical |
| Expand on an int64 tensor | **no, left on the CPU** (the export avoids it: expand the float index, then cast) | yes | — |
| DFT, opset 17 and 20 (real input, one-sided) | **yes** | yes | max \|Δ\| 1.2e-3 on values up to ~2,000 (rounding) |
| MatMul (the DFT-as-matrix fallback, not needed) | yes | yes | identical |
| Pad (edge), Resize (nearest; linear align_corners), ConvTranspose 4×4/2, Softmax, Abs/Less/Where | yes | yes | ≤ 7e-7 |
| CumSum (1-D and 2-D, up to 64 × 384 × 384), DequantizeLinear + Conv, DepthToSpace | yes | yes | identical (DequantizeLinear 3.8e-6) |

Whole graphs: ⟨speed run⟩

## 2. File sizes and the largest tensor per tile

| | fp32 file | fp16 file | Largest single tensor (one profiled ONNX Runtime CPU run, every node's output) | Peak memory in use, CPU run |
|---|---|---|---|---|
| MISC Filter, 256² | 59,286,571 B (14.84 M parameters after folding; checkpoint 17.14 M with DO-Conv's extra matrices) | 41,457,094 B (not working, above) | 58,720,256 B, `Concat` [1, 224, 256, 256] | 136 MB |
| MISC Filter, 512² | 60,078,637 B | — | **234,881,024 B (224 MiB), over 128 MiB** (`Concat` [1, 224, 512, 512]; 1 tensor over) | 558 MB |
| MISC Filter, 768² | 61,394,993 B | — | ⟨speed run⟩ | ⟨⟩ |
| NAFNet-GoPro-64, 256² | 272,217,947 B | 136,716,707 B | 33,554,432 B, `Conv` [1, 128, 256, 256] | 85 MB |
| NAFNet-GoPro-64, 512² / 768² | 272 MB | 137 MB | ⟨speed run⟩ | ⟨⟩ |
| opencv_zoo NAFNet | 91,736,251 B (int8 weights) | — | not profiled | — |

(The MISC files differ by tile size only in constants. The fp32 largest tensor grows with the tile area, so at 512² MISC needs a GPU binding of at least 224 MiB, or a graph rewrite like Part 30's, or 256² tiles; ORT 1.30's WebGPU EP gives wrong results above `maxStorageBufferBindingSize` for some kernels — Part 30 / MASKS_PREP_2.)

## 3. Quality on public real-blur test pairs

RealBlur's own metric (`evaluation_RealBlur_ecc.py`, which MISC's test copies; RSBlur's is the same with clipping): output saved as 8-bit, intensity-matched and ECC-homography-aligned to the sharp image, PSNR/SSIM over the valid region. The **blurred input is scored the same way** (the baseline). Subsets: **RealBlur-J and -R: 50 pairs each** (the first pair of each of the 50 test scenes in the list order of MISC's `RealBlur_*_test_list.txt`, i.e. `blur_7`); **RSBlur: 24 pairs** (every 140th line of `RSBlur_real_test.txt`; MISC finished 13 of them in its 100-minute budget). Published figures are over the full test sets (980 / 980 / 3,360 pairs), so they are a guide, not a like-for-like comparison. ONNX Runtime 1.30.0 CPU, fp32.

| Set (n) | Blurred input | MISC, paper protocol (256² windows, no overlap) | MISC, 256² tiles, 32 px blended overlap | NAFNet-GoPro, 256² tiles, 32 px overlap | opencv_zoo NAFNet, whole image | Published |
|---|---|---|---|---|---|---|
| RealBlur-J (50) | 27.94 / 0.832 | **34.25 / 0.942** (50 of 50 better) | **34.55 / 0.945** (50 of 50) | 27.98 / 0.855 (33 better, 7 worse; 2 collapse below 17 dB) | 29.67 / 0.890 (41 better, 7 worse) | MISC (R-trained): 33.88 / 0.938. NAFNet: none |
| RealBlur-R (50) | 35.63 / 0.949 | **40.83 / 0.976** (49 of 50) | **41.07 / 0.977** (49 of 50) | 35.99 / 0.951 (36 better, 8 worse; 1 collapse) | 35.30 / 0.933 (15 better, 26 worse) | MISC: 41.23 / 0.978 |
| RSBlur (24; MISC 13) | 29.24 / 0.735 (MISC's 13: 30.11 / 0.752) | **32.31 / 0.835** on its 13 (13 of 13 better), RealBlur_J weights (not trained on RSBlur) | not run | **20.94 / 0.572: worse on all 24** (−8.3 dB) | 25.73 / 0.587 (14 better, 10 worse; 10 collapse below 21 dB) | none for these weights |

MISC used `RealBlur_J.pth` on J and RSBlur and `RealBlur_R.pth` on R. NAFNet's weights saw only GoPro (synthetic) or REDS; the RealBlur paper already reports that GoPro-trained networks "do not generalize well to real-world blurred images", and these numbers agree. The NAFNet "collapses" are whole images that come out far worse than the input (e.g. RealBlur-J scene130 32.45 → 16.71 dB). **Cause, measured (`naf_diag.py`, 6 RealBlur and 6 RSBlur pairs): the 256² tiles.** In each collapse one or more tiles "go wild" (2.6–14 % of the tile's output values outside [−0.1, 1.1]); the authors' own PyTorch `NAFNetLocal` on the whole image (their test protocol) does not: scene130 32.15 dB whole vs 16.71 tiled, R-scene024 34.63 vs 18.08, RSBlur 000226 29.77 vs 19.82. But whole-image NAFNet-GoPro is still **worse than the blurred input on all 6 RSBlur pairs** (by 0.7 to 6.5 dB) and within ±0.9 dB of it on the RealBlur pairs, so the failure is not only tiling: these weights don't generalise to real handheld blur. A whole-image run of a 24 MP photo is not an option in the browser (memory), so NAFNet would need tiles that are large enough to keep its pooling stable — not tested further.

## 4. Full resolution and tiling

### Real camera shake at full resolution (the honest test the small test sets can't give)

RealBlur's test images are the camera frame's crop (2721 × 3094 of the Sony A7R III's 7952 × 5304) **downsampled by 4** (`make_srgb_dataset_main_resize.m`). `RealBlur_Ori_sample.tar.gz` holds the original camera JPEGs for three scenes; **scene097 is a test scene** (not in either training list). Two of its pairs (BLR/CLN 00008 and 00015, picked by position: a third and two thirds through the sorted list), same crop, sharp frame mirrored, then shown to the model at four pixel densities. 0.75 ≈ a 24 MP camera's density for the same framing (6000 / 7952 = 0.755). Scored over the central half of the frame (the model saw it plus a 64 px margin), RealBlur's metric at each scale. "Downscale route" = the model run at 0.25 and its output resized back up (bicubic). Tiles 512² with 64 px blended overlap. PSNR dB / SSIM:

| Pair, scale (frame px) | Input | MISC direct | MISC downscale route | NAFNet direct | NAFNet downscale route | Resize down/up only |
|---|---|---|---|---|---|---|
| 00008, 0.25 (774 × 680) | 28.44 / 0.854 | **34.27 / 0.959** | = direct | 30.35 / 0.918 | = direct | — |
| 00008, 0.5 (1547 × 1360) | 27.85 / 0.820 | 32.83 / 0.918 | 32.84 / 0.909 | 28.56 / 0.836 | 29.50 / 0.870 | 27.77 / 0.821 |
| 00008, **0.75 (2320 × 2041)** | 27.71 / 0.820 | 31.74 / 0.896 | **32.44** / 0.888 | 27.91 / 0.828 | 29.29 / 0.857 | 27.62 / 0.822 |
| 00008, 1.0 (3094 × 2721) | 27.34 / 0.778 | 31.07 / 0.843 | 31.53 / 0.833 | 27.62 / 0.784 | 28.78 / 0.809 | 27.25 / 0.784 |
| 00015, 0.25 | 28.58 / 0.906 | 29.96 / 0.959 | = direct | 29.51 / 0.939 | = direct | — |
| 00015, 0.5 | 27.95 / 0.855 | **30.13 / 0.925** | 29.32 / 0.908 | 28.28 / 0.872 | 28.83 / 0.891 | 27.95 / 0.857 |
| 00015, **0.75** | 27.77 / 0.843 | **29.49 / 0.899** | 29.14 / 0.887 | 28.07 / 0.856 | 28.65 / 0.874 | 27.78 / 0.848 |
| 00015, 1.0 | 27.37 / 0.796 | **29.62 / 0.850** | 28.69 / 0.835 | 27.37 / 0.801 | 28.21 / 0.826 | 27.40 / 0.805 |

What this shows: on real handheld shake, MISC still gains **+3.7 and +2.3 dB at the full 42 MP and +4.0 / +1.7 dB at 24 MP density** — less than at the training scale (+5.8 / +1.4), as expected when the blur spans more pixels than the network was trained on. Running at full density and running at quarter scale then upscaling are close (each wins on one pair); the downscale route needs 7.5–10.5× fewer tiles (4 for the whole frame at 0.25, against 30 at 0.75 and 42 at 1.0, 512² tiles). Detail measure (mean squared Laplacian of luminance over the region; includes noise): at 0.75 the MISC output has 1.8–2.2× the input's fine detail but only 27–38 % of the sharp frame's; at 1.0 it is *below* the input's (MISC removes noise as well). So it recovers **part** of the detail, not the sharp frame. NAFNet-GoPro gains little directly (+0.0 to +0.7 dB above 0.25) and more through the downscale route (+0.8 to +1.7 dB).

What it can't show: two frames of one indoor scene; ground truth from a second camera aligned by homography (so PSNR includes residual misalignment and the two cameras' differences); JPEG-in-camera only; no RAW.

### Seams

Scene097 pair 00008 at 0.75 density, a central 1536² crop (input 26.69 dB / 0.823 against the sharp frame). "Step ratio" = mean luminance step across the tile boundaries ÷ the same 4–12 px away (1.0 = no seam; the input itself gives 0.90–0.99). "Shifted grid" = the same image with the tile grid moved by half a tile; their PSNR shows how much the result depends on where tiles fall.

| Model, tile, overlap | Tiles | Step ratio (max) | Shifted-grid PSNR, max \|Δ\| | vs sharp |
|---|---|---|---|---|
| MISC 256², 0 (hard cut) | 36 | **5.12 (9.57)** — visible seams | 34.28 dB, 0.55 | 29.71 |
| MISC 256², 32 blended | 49 | 0.96 (1.50) | 35.23 dB, 0.55 | 29.84 |
| MISC 256², 64 blended | 64 | 1.05 (1.56) | 36.54 dB, 0.32 | 29.51 |
| MISC 512², 0 | 9 | **5.19 (6.23)** | 34.55 dB, 0.32 | 30.27 |
| MISC 512², 64 blended | 16 | 0.96 (1.22) | 36.27 dB, 0.32 | 30.48 |
| NAFNet 256², 0 / 32 / 64 | 36 / 49 / 64 | 1.94 / 1.04 / 0.98 | 17.9 / 17.3 / 16.9 dB, 1.0 (tiles failing) | 19.1 / 19.5 / 19.6 |
| NAFNet 512², 0 / 64 | 9 / 16 | 2.13 / 0.91 | 38.2 / 40.5 dB | 26.6 / 26.7 |

So a 32–64 px linear blend removes measurable seams for both models; without it MISC's tile edges step about five times the local gradient. MISC's output still depends on tile placement (shifted grid 34–37 dB; up to 0.3–0.55 on single pixels), because each tile sees different context.

### A real-shake kernel scaled up (synthetic) ⟨second run⟩

## 5. Speed and memory ⟨speed run⟩

Measured on GitHub's 4-vCPU runner, ONNX Runtime **CPU (native, Python), 4 threads**, per tile: MISC 256² ≈ **8.8 s** (79.6 s for 9 windows per RealBlur image; parity runs 10.6 s), 512² ≈ **31 s** (125 s for 4 tiles), 768² **333–351 s** (PyTorch: 4.2 s, 25 s, 67–71 s); NAFNet 256² 0.5–1.2 s, 512² ≈ 5 s.

## 6. Rotation

Synthetic in-plane rotation about the centre (averaged over 41 angles in linear light), angle set so the corners move 24 px (2.7°; the corner regions' centres get 17.5 px), on 4 sharp RealBlur-J test images (scenes 230, 050, 205, 097; 760 × 668). Control: each corner region blurred instead by a **uniform straight blur of the same length, in the same (tangential) direction**. PSNR gain (dB) in the centre region (¼ × ¼ of the frame) and the four corner regions, mean of 4 images:

| | Centre (≈ 0–4 px) | Top-left | Top-right | Bottom-left | Bottom-right |
|---|---|---|---|---|---|
| MISC (`RealBlur_J`, paper protocol) — rotation | **−1.64** | +0.92 | +0.91 | +0.33 | +0.65 |
| MISC — uniform blur, same length and direction | — | +3.88 | +5.39 | +5.28 | +5.41 |
| NAFNet-GoPro (256²/32) — rotation | +1.77 | +2.54 | +1.67 | +3.39 | +2.48 |
| NAFNet-GoPro — uniform | — | +3.31 | +1.86 | +3.95 | +3.46 |

**MISC does not handle rotation blur as well as the same blur when it is uniform**: in the corners it recovers 0.3–0.9 dB of a 4–5.4 dB uniform-blur gain, and it makes the nearly sharp centre worse (−1.6 dB). NAFNet's gains are smaller but closer between the two cases. Synthetic, one angle, 4 images, no noise; real rotational shake also has translation and depth.


## Where and how it ran

- **GitHub's runner** (the "AI models" workflow, task `unblur-spike` on branch `lightbench/unblur-spike`; read-only jobs, nothing published, nothing committed by the workflow). The runner can reach Google Drive and Hugging Face; this container cannot (`drive.google.com`, `huggingface.co`, `download.pytorch.org` answer 403 at the proxy), and run artifacts can't be downloaded here (blob storage is blocked), so results come from the job logs and summaries. The pictures (input / output / sharp crops) are in each run's `unblur-<part>` artifact for 14 days.
- Runner: 4 vCPU, 16 GB; Python 3.12, PyTorch 2.9.1 (CPU wheel), onnx 1.19.1, **onnxruntime 1.30.0** (the same version as the app's onnxruntime-web), OpenCV 4.12.0, scikit-image 0.25.2; Node 22 with the app's own `onnxruntime-web` 1.30.0 (`npm ci` of `web/`).
- **This container**: single-operator WebGPU checks and the opencv_zoo file in headless Chromium 141 (Playwright's build) with WebGPU on SwiftShader, and onnxruntime-web 1.30.0 in Node. SwiftShader is used for operator support and correctness only, never for speed.
- Scripts: `web/scripts/unblur/` (`fetch.py` downloads and records sources; `unblur_models.py` builds the models; `export.py` exports and checks; `quality.py`, `tiling.py`, `large.py` measure; `ort-web.mjs` runs onnxruntime-web in Node and Chromium; `op_graphs.py` makes the single-operator graphs; `rebuild_graph.py` rebuilds a logged graph with random convolution weights).

## Sources (pinned) and licences

| What | Where | Pinned | Size, SHA-256 |
|---|---|---|---|
| MISC Filter code | github.com/ChengxuLiu/MISCFilter | commit `aca59a8884cdf91f894dd0e7ca9f2527e4c9fd74` (2024-03-09) | `LICENSE` "MIT License, Copyright (c) 2024 Chengxu Liu", SHA-256 `4b8a06bc…a65a` |
| MISC Filter weights | Google Drive folder `1M-Sc_u97vTQskfO6VMzPghb8LnerP8Id` (README link) → one file `checkpoints.zip` (id `1XsySc2rDCzoqZ0-Ph1dFYQ49_APb5Eay`) | — | 178,752,276 B, `4972e758…83ff`; inside: `RealBlur_J.pth` 68,870,256 B `6a17b8d2…a51`, `RealBlur_R.pth` 68,870,256 B `855051fd…769`, `GoPro.pth` 68,870,254 B `a2b7a985…97e` |
| NAFNet code | github.com/megvii-research/NAFNet | commit `2b4af71ebe098a92a75910c233a3965a3e93ede4` (2024-03-29) | `LICENSE` MIT "Copyright (c) 2022 megvii-model" + Apache-2.0 (BasicSR), SHA-256 `a29ecef3…99ad` |
| NAFNet-GoPro-width64 | Google Drive file `1S0PVRbyTakYY9a82kujgZLbMihfNBLfC` (readme) | — | 271,778,961 B, `329d3ab4…196f` |
| NAFNet-REDS-width64 (opencv_zoo's source) | Google Drive file `14D4V4raNYIOhETfcuuLI3bGLB-OYIv6X` | — | 271,756,689 B, `175fe8b3…2df3` (downloaded, not exported) |
| opencv_zoo `deblurring_nafnet_2025may.onnx` | github.com/opencv/opencv_zoo, Git LFS, `models/deblurring_nafnet/` | commit `48b10fa505aeb51fbd127fc60a5c660040e823b7` | 91,736,251 B, `07263f41…9587`; folder `LICENSE` (MIT, megvii-model, + BasicSR Apache-2.0) `a29ecef3…99ad`, byte-identical to NAFNet's |
| RealBlur (test pairs, full-resolution sample) | huggingface.co/datasets/rimchang/RealBlur (CC BY 4.0) | commit `afdb28d4aeb7739bc326b181ded390d4e2ac21a3` | `RealBlur.tar.gz` 13,115,712,166 B (LFS `c568d29b…1e`); `RealBlur_Ori_sample.tar.gz` 4,394,669,362 B (LFS and measured SHA-256 `d4b9cf84…f98`) |
| RSBlur (test pairs) | huggingface.co/datasets/rimchang/RSBlur (CC BY 4.0 per github.com/rimchang/RSBlur README) | commit `27e3fe1620efc6e2613d753e88271dff47043bc1` | `RSBlur.zip` 114,728,791,519 B (LFS `5ab1522f…b5`); only the chosen members read, by HTTP Range |
| Dataset lists | MISCFilter's `dataset/RealBlur/*_test_list.txt`; RSBlur commit `e6818642f2b4d52764e47f294872fcae931f1531` `datalist/RSBlur/RSBlur_real_test.txt` | | |

Nothing downloaded is committed. Full hashes are in the job logs (`fetch.py` prints them).

**A licence fact for the owner (no opinion):** MISC Filter's README says its code "is built upon DeepRFT, MPRNet, MIMO-UNet, and AdaCoF". Compared here: MISC's `models/doconv_pytorch.py` is identical to DeepRFT's (comments and blank lines ignored), and the classes `BasicConv`, `BasicConv_do` and `ResBlock_do_fft_bench` (the FFT residual block, 72 of them in the network) are identical to DeepRFT's `layers.py` (github.com/INVOKERer/DeepRFT at `ab286ca19c33def072882298afaf5265dc99ca1c`). DeepRFT's `license.md` (SHA-256 `33073d5f…63b5`) is an "ACADEMIC PUBLIC LICENSE": "Non-Commercial use" allowed, "Commercial Use" not, and "If you distribute verbatim or modified copies of this software, they must be distributed under this license." DO-Conv's own repository (github.com/yangyanli/DO-Conv) is MIT. MISC Filter's repository itself is MIT. LightBench would ship an ONNX graph and weights, not this Python code; whether that matters is a question for the owner.
