# Unblur feasibility spike: can an AI camera-shake deblurring model run in LightBench?

Research only (2026-11-03). Nothing in the app, `release-notes.json` or the version changed. The build, if any, waits until after 1.0 (owner's decision, `UNBLUR_DECISIONS_2026-11-03.md`). Every number below was measured in this spike unless it says "published" (quoted from the authors) or "estimate" (arithmetic on measured numbers). What could not be run is listed at the end.

Owner's choices this tests: camera shake including rotation; automatic with a strength slider (a blend with the original, so no model change is needed for it); MISC Filter first, NAFNet as the backup; public test sets only.

## Summary

| | MISC Filter | NAFNet-GoPro-width64 (own export) | opencv_zoo NAFNet (REDS, int8) |
|---|---|---|---|
| Licence (pinned) | MIT, `aca59a8` — **but** its FFT block, DO-Conv layer and conv wrappers are DeepRFT's code, whose licence is non-commercial (fact below) | MIT (+ Apache-2.0 BasicSR), `2b4af71` | MIT, opencv_zoo `48b10fa` |
| ONNX export | **Yes, with three changes** (CUDA filter → PyTorch port; DO-Conv folded; FFT → ONNX `DFT`); matches PyTorch to ≤ 1.2e-6 | Yes, as is; matches to 6e-7 | Exists; **fails below ~384 px** inputs |
| Operators on ORT Web WebGPU / WASM | **All 5,776 nodes on WebGPU**; output = WASM's to 2.6e-4 (SwiftShader). Needs GridSample at opset ≤ 19 | All on WebGPU at 256² and 512²; = WASM to 9e-7 | **Wrong output on WebGPU** (SwiftShader: mean \|Δ\| 142 vs WASM on a test card); 1,494 nodes left on the CPU |
| Files | fp32 59.3 MB; fp16 41.5 MB **not usable** (non-finite values) | fp32 272 MB; fp16 137 MB (fine at 256², all non-finite at 512²) | 91.7 MB |
| Largest tensor | 58.7 MB at 256²; **224 MiB at 512²**; 504 MiB at 768² | 32 MiB at 256²; exactly 128 MiB at 512²; 288 MiB at 768² | — |
| RealBlur-J / -R (50 each) | **+6.3 / +5.2 dB** (34.25 / 40.83; published 33.88 / 41.23); 50/50 and 49/50 better | +0.0 / +0.4 dB; 3 of 100 images collapse (256² tiles) | +1.7 / −0.3 dB |
| RSBlur (other camera) | **+2.2 dB** (13 pairs, 13 better) | **−8.3 dB** (24 of 24 worse) | −3.5 dB mean, 10 of 24 collapse |
| Real shake at full resolution (scene097, 2 frames) | +4.0 / +1.7 dB at 24 MP density, +3.7 / +2.3 dB at 42 MP; downscale route about the same for 7.5–10.5× fewer tiles | +0.2–0.3 dB direct; +0.9–1.6 dB via downscale | not run |
| Large real-shake kernel ×3 / ×6 (synthetic) | direct +0.9 / +0.2 dB; **downscale route +5.7 / +6.0 dB** (detail of the downscaled image only) | ≈ 0 either way | not run |
| Tiling | 32–64 px blended overlap removes measurable seams (hard cuts: ~5× step) | same; 256² tiles unstable | — |
| Rotation (synthetic, 24 px at the corners) | **Weak**: corners +0.3 to +0.9 dB vs +3.9 to +5.4 dB for uniform blur of the same length; centre −1.6 dB | corners +1.7 to +3.4 vs +1.9 to +4.0 uniform | not run |
| Speed, WASM 4 threads (Chromium tab) | **21 s per 256² tile, 73 s per 512²**; 24 MP ≈ 2.5–2.9 h full-res, ≈ 12–19 min at ¼–⅓ scale (estimates); real GPU unmeasured | 3.2 s / 15 s per tile | 14 s at 512² |

**Recommendation.**

- **NAFNet (own GoPro export) and the opencv_zoo file: no-go** as LightBench's unblur model. They run in ONNX Runtime Web (the own export is correct on WebGPU), but neither improves real handheld blur. Here that means RealBlur −0.3 to +1.7 dB and RSBlur −3.5 to −8.3 dB. NAFNet-GoPro's 256² tiles sometimes blow up (3 of 100 RealBlur images, most RSBlur images). The opencv_zoo file is wrong on WebGPU and fails below about 384 px.
- **MISC Filter: technically feasible, conditional go for translation-type shake, not yet a build decision.**
  - It exports to ONNX with three exact rewrites. Every node runs on ORT Web's WebGPU EP and matches WebAssembly. Its quality on real handheld blur is strong: published numbers reproduced on 100 RealBlur pairs, +2.2 dB on another camera (RSBlur), and +1.7 to +4.0 dB on real 24 MP-density frames. Blended tiles remove seams.
  - What would be needed before a build:
    1. The owner's reading of the DeepRFT licence fact (below).
    2. Real-GPU measurements: speed, memory, and correctness on adapters with a 128 MiB binding limit. None exist yet. The processor fallback is far over any reasonable wait: about 21 s per 256² tile, so 2.5–2.9 h for a full 24 MP photo and about 12–19 min even at ¼–⅓ scale (estimates).
    3. 256² tiles, or a graph rewrite of the 224 MiB Concat at 512² (Part 30's method).
    4. A scale rule: run the model at a reduced size when the shake is large, because at full density large blur is outside its range (+0.2–0.9 dB on a scaled-up real kernel, against +5.7–6.0 dB when downscaled). The output then has only the downscaled image's detail, so how to combine the two (for example with the strength slider) still has to be designed and tested.
    5. fp32 only (59 MB); fp16 doesn't work.
    6. The owner's patent stance (`UNBLUR_DECISIONS_2026-11-03.md`; no opinion here).
- **Rotation: not delivered by either model as tested.** On synthetic in-plane rotation, MISC's corners gain 0.3–0.9 dB where the same blur made uniform gains 3.9–5.4 dB, and the nearly sharp centre loses 1.6 dB. If rotation is a must, this spike does not find a model that meets it; a model trained on spatially varying (rotational) shake would be needed, and none with a permissive licence was found in the research.


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

Whole graphs, same method, on the runner's Google Chrome 156 (SwiftShader adapter: no `shader-f16`, `maxStorageBufferBindingSize` 1 GiB), an image-like test card as input:

| Graph | Nodes left on the CPU by the WebGPU session | WebGPU vs WebAssembly output |
|---|---|---|
| **MISC Filter 256², fp32** | **none** ("All nodes placed on [WebGpuExecutionProvider]. Number of nodes: 5776") | **max \|Δ\| 2.6e-4, mean 2.8e-5** (values 0–0.98): correct |
| NAFNet-GoPro 256², fp32 | none (1,248 nodes) | max 8.0e-7: correct |
| NAFNet-GoPro 512², fp32 (TLC pooling with CumSum) | none (1,788 nodes) | max 8.6e-7: correct |
| opencv_zoo NAFNet at 384² | **1,494 of 4,532** (Gather 470, Unsqueeze 220, Div 216, Concat 146, Add 144, Reshape 74, Sub 74, Mul 72, Slice 37, Transpose 37, Mod 4) | **wrong**: output −580…683 against WASM's −2.75…3.73 (mean \|Δ\| 142); the same in this container's Chromium 141. CumSum alone is exact at that size; the faulty node was not isolated |

SwiftShader shows operator support and correctness on its own limits (1 GiB bindings); it says nothing about a real GPU's speed, or about adapters with a 128 MiB binding limit.

## 2. File sizes and the largest tensor per tile

| | fp32 file | fp16 file | Largest single tensor (one profiled ONNX Runtime CPU run, every node's output) | Peak memory in use, CPU run |
|---|---|---|---|---|
| MISC Filter, 256² | 59,286,571 B (14.84 M parameters after folding; checkpoint 17.14 M with DO-Conv's extra matrices) | 41,457,094 B (not working, above) | 58,720,256 B, `Concat` [1, 224, 256, 256] | 136 MB |
| MISC Filter, 512² | 60,078,637 B | — | **234,881,024 B (224 MiB), over 128 MiB** (`Concat` [1, 224, 512, 512]; 1 tensor over) | 558 MB |
| MISC Filter, 768² | 61,394,993 B | — | **528,482,304 B** (`Concat` [1, 224, 768, 768]); 53 tensors over 128 MiB (Concat 27, DFT 24, Resize 2) | 1.32 GB |
| NAFNet-GoPro-64, 256² | 272,217,947 B | 136,716,707 B | 33,554,432 B, `Conv` [1, 128, 256, 256] | 85 MB |
| NAFNet-GoPro-64, 512² | 273,054,527 B | 137 MB, **output all non-finite** (the TLC CumSum overflows fp16; fine at 256²) | 134,217,728 B (exactly 128 MiB), `Conv` [1, 128, 512, 512]; none over | 340 MB |
| NAFNet-GoPro-64, 768² | 273,054,527 B | — | 301,989,888 B; 72 tensors over 128 MiB | 1.08 GB |
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
| NAFNet 256², 0 / 32 / 64 | 36 / 49 / 64 | 1.94 / 1.04 / 0.98 | 17.9 / 17.3 / 16.9 dB, 1.0 (2 tiles go wild in every variant) | 19.1 / 19.5 / 19.6 |
| NAFNet 512², 0 / 64 | 9 / 16 | 2.13 / 0.91 | 38.2 / 40.5 dB | 26.6 / 26.7 |

So a 32–64 px linear blend removes measurable seams for both models; without it MISC's tile edges step about five times the local gradient. MISC's output still depends on tile placement (shifted grid 34–37 dB; up to 0.3–0.55 on single pixels), because each tile sees different context.

### A real-shake kernel scaled up (synthetic)

The brief's test: a large sharp image blurred with a real-shake kernel scaled up, tiled, and also run downscaled. Sharp image: scene097's sharp camera frame (CLN00008, mirrored, the dataset crop), at 0.75 density for ×3 and at full size for ×6, central 2041–2048² crop. Kernel: **estimated** from RealBlur-J test pair scene112 `blur_7` (the subset's lowest-SSIM pair) by regularised least squares in the gradient domain, linear light (`large.py estimate_kernel`; support 29 × 20 px at the test set's scale, threshold 1 % of the peak), then resized ×3 (support 89 × 62 px) and ×6 (178 × 125 px), applied in linear light, no noise added. Tiles 512² / 64 px overlap. PSNR / SSIM against the sharp crop (borders excluded; synthetic, so no alignment):

| Kernel | Input | MISC direct (full density) | MISC downscale route (÷3 or ÷6, run, bicubic back) | NAFNet direct | NAFNet downscale route | Resize down/up only |
|---|---|---|---|---|---|---|
| ×3 (89 × 62 px) | 20.90 | 21.78 (+0.9) | **26.60 (+5.7)** | 20.85 | 20.69 | 20.90 |
| ×6 (178 × 125 px) | 19.02 | 19.21 (+0.2) | **25.03 (+6.0)** | 19.01 | 18.97 | 19.02 |

Fine detail (mean squared Laplacian): sharp 1.5e-3; MISC downscale route 2.3e-5 (×3) and 1.4e-6 (×6); input 1.3e-6 / 1.1e-7.

What this shows: **at full density, blur this large is outside what MISC handles (+0.2–0.9 dB); shrinking the photo until the blur is back in its range lets it remove most of the smear (+5.7–6.0 dB), but the result has only the downscaled image's detail** (about 1.5 % of the sharp frame's fine-detail energy at ×3). It cannot show: real noise, saturation, depth, rotation, or whether a kernel estimated from one RealBlur pair is typical (the estimate itself is approximate: on a known 11 px line it gave a 9 × 13 px support here).

## 5. Speed and memory

Per tile, fp32, GitHub's runner (4 vCPU, AMD EPYC), the app's onnxruntime-web 1.30.0 WebAssembly build with 4 threads, an image-like test card, 3 runs (first run in brackets). "Peak memory" = the Node process's resident memory, or the whole Chromium process tree's (sampled every 100 ms; models loaded one after another in one tab, so the tab's figures include the earlier models).

| Model, tile | Node, WASM 4 threads | Chromium tab, WASM 4 threads | ORT native CPU (Python), 4 threads | Peak memory (Node / tab) |
|---|---|---|---|---|
| MISC 256² | **18.5–18.9 s** (19.0) | **21.2–21.4 s** (25.7) | 8.8–11 s | 0.85 GB / 1.73 GB |
| MISC 512² | **66.4–66.6 s** (68.1) | **72.6–72.8 s** (73.7) | 31–38 s | 1.61 GB / 2.43 GB |
| MISC 768² | not run | not run | 334 s | — |
| NAFNet-GoPro 256² | 2.9 s | 3.2 s | 0.5–1.5 s | 1.24 GB / 2.89 GB |
| NAFNet-GoPro 512² | 14.5 s | 15.0 s | 5–6.5 s | 2.16 GB / 3.37 GB |
| opencv_zoo, 384² / 512² | 8.0 s / 14.4 s | — / 13.8 s | — | 0.78 / 0.99 GB |

**Where MISC's CPU time goes** (ONNX Runtime's profiler, native CPU): **DFT 73 %** at 256², 70 % at 512², **92 % at 768²** (768 = 3 × 256, not a power of two; the run took 334 s against PyTorch's 67–71 s); convolutions 13–15 %; the 49-tap filter's gathers about 5 %. So the FFT blocks, not the filter, make MISC slow on the CPU; a faster DFT formulation is untested.

**A 24 MP photo (6000 × 4000), estimates** (tile counts from the tiler; times = count × the Chromium-tab WASM time per tile above, 4 threads; a real GPU is unmeasured):

| Route | Tiles | MISC, WASM | NAFNet, WASM |
|---|---|---|---|
| Full resolution, 256² / 32 px overlap | 486 | ≈ 2 h 53 min | ≈ 26 min |
| Full resolution, 512² / 64 px | 126 | ≈ 2 h 32 min | ≈ 32 min |
| Downscaled to ½ (3000 × 2000), 256² / 32 | 126 | ≈ 45 min | ≈ 7 min |
| Downscaled to ⅓ (2000 × 1333), 256² / 32 | 54 | ≈ 19 min | ≈ 3 min |
| Downscaled to ¼ (1500 × 1000), 256² / 32 | 35 | ≈ 12 min | ≈ 2 min |

WebGPU on SwiftShader took 2,198 s for one MISC 256² tile and 329 s / 1,588 s for NAFNet 256² / 512²: a CPU emulating a GPU, not a speed figure. **No real-GPU timing exists** for either model.

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
- Runner: 4 vCPU (AMD EPYC 7763 or 9V74, whichever the job got), 16 GB; Python 3.12, PyTorch 2.9.1 (CPU wheel), onnx 1.19.1, **onnxruntime 1.30.0** (the same version as the app's onnxruntime-web), OpenCV 4.12.0, scikit-image 0.25.2; Node 22 with the app's own `onnxruntime-web` 1.30.0 (`npm ci` of `web/`).
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

## What was not verified, and why

- **Any real GPU.** No GPU here or on GitHub's runners: WebGPU ran only on SwiftShader (1 GiB binding limit, no `shader-f16`). So there is no GPU speed, no GPU memory figure, and no run on an adapter with the 128 MiB binding limit. MISC at 512² has a 224 MiB tensor and would be exposed to the ORT 1.30 large-binding bugs found in Part 30 / MASKS_PREP_2. The kernels involved (Concat, DFT, Resize) were not checked above 128 MiB here.
- **Full test sets.** These are subsets: RealBlur-J 50, RealBlur-R 50 (one pair per test scene), RSBlur 24 (MISC only 13, time budget). The published numbers are over 980 / 980 / 3,360 pairs.
- **Metric versions.** The official RealBlur scripts require scikit-image 0.17.2 and OpenCV 4.2.0. Here: 0.25.2 (`channel_axis` instead of `multichannel`) and 4.12.0. The method is the same, but small differences are possible.
- **Full resolution.** Two frames of one scene (scene097). The sharp frame comes from a second camera aligned by homography, and the frames are in-camera JPEGs (RAW not tried). The synthetic test uses an estimated kernel, no noise and no saturation.
- **Rotation.** Synthetic only, one angle (corners 24 px), 4 images, no noise; no real rotational-shake test set was used.
- **Pictures.** Input/output/sharp crops are in each run's `unblur-*` artifact (14 days). They could not be downloaded or looked at from this container (artifact storage blocked), so no visual judgement is made here. All quality statements are metrics.
- **Not investigated:** why MISC's fp16 conversions produce non-finite values; which node makes the opencv_zoo file wrong on WebGPU; whether a non-DFT formulation of MISC's FFT blocks would be faster on the CPU; MISC's `GoPro.pth`; NAFNet's REDS checkpoint as our own export (only through opencv_zoo's int8 file); NAFNet with tiles larger than 512².
- **Timing noise.** Two different runner CPUs; this container is shared and was not used for timings (except the opencv_zoo check, marked).

## Runs

"AI models" workflow, task `unblur-spike`, branch `lightbench/unblur-spike`:

| Run | Stage | What |
|---|---|---|
| [41566759124](https://github.com/shawneburke88-afk/Photo-Editing-App/actions/runs/41566759124) | probe | Hugging Face trees and commits; weight sizes and SHA-256 |
| [41567139225](https://github.com/shawneburke88-afk/Photo-Editing-App/actions/runs/41567139225) | probe2 | checkpoint contents; RSBlur zip directory; RealBlur archive listings |
| [41568101650](https://github.com/shawneburke88-afk/Photo-Editing-App/actions/runs/41568101650) | dev | first exports and parity |
| [41570323963](https://github.com/shawneburke88-afk/Photo-Editing-App/actions/runs/41570323963) | run (all parts) | quality, full resolution, seams, rotation, synthetic (small kernel, superseded); `speed` cancelled after its export step (its MISC parity and tensor numbers are used above) |
| [41588258564](https://github.com/shawneburke88-afk/Photo-Editing-App/actions/runs/41588258564) | run:speed,synth-misc,synth-naf,naf-diag | speed, WebGPU placement, synthetic with the scene112 kernel, NAFNet diagnosis (its red mark: the summary step choked on a JSON list after the results were written) |

To rerun: Actions → AI models → Run workflow → branch `lightbench/unblur-spike` → task `unblur-spike`, "unblur" `run` (all parts, about 4–5 hours on the runner) or `run:PART,PART`.

## Credits

- RealBlur: J. Rim, H. Lee, J. Won, S. Cho, "Real-World Blur Dataset for Learning and Benchmarking Deblurring Algorithms", ECCV 2020. CC BY 4.0.
- RSBlur: J. Rim, G. Kim, J. Kim, J. Lee, S. Lee, S. Cho, "Realistic Blur Synthesis for Learning Image Deblurring", ECCV 2022. CC BY 4.0.
- MISC Filter: C. Liu et al., "Motion-adaptive Separable Collaborative Filters for Blind Motion Deblurring", CVPR 2024 (MIT).
- NAFNet: L. Chen et al., "Simple Baselines for Image Restoration", ECCV 2022 (MIT); opencv_zoo's conversion (MIT).
