# Unblur feasibility spike: can an AI camera-shake deblurring model run in LightBench?

Research only (2026-11-03). Nothing in the app, `release-notes.json` or the version changed. The build, if any, waits until after 1.0 (owner's decision, `UNBLUR_DECISIONS_2026-11-03.md`). Every number below was measured in this spike unless it says "published" (quoted from the authors) or "estimate" (arithmetic on measured numbers). What could not be run is listed at the end.

Owner's choices this tests: camera shake including rotation; automatic with a strength slider (a blend with the original, so no model change is needed for it); MISC Filter first, NAFNet as the backup; public test sets only.

<!-- RESULTS -->

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
