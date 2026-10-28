# Third-party software

LightBench is licensed under GPL-3.0-or-later (see [LICENSE](LICENSE)). It includes or uses the
following third-party components, each under its own license.

| Component | Used for | License |
|---|---|---|
| [darktable](https://github.com/darktable-org/darktable) (code translated to WGSL/TypeScript, from commit `6271f53`, Oct 2026) | RCD demosaic, inpaint-opposed highlight reconstruction, sigmoid tone mapping, tone equalizer, white balance (temperature/tint), CIE colour tables; Transform/Upright: the perspective model, line selection, outlier removal, fit and automatic crop of "rotate and perspective" (`src/iop/ashift.c` → `web/src/engine/develop/ashift.ts`) | GPL-3.0-or-later. Copyright © darktable developers. RCD by Luis Sanz Rodríguez. darktable credits ShiftN by Marcus Hebel as the inspiration of ashift. |
| [LSD — Line Segment Detector](http://dx.doi.org/10.5201/ipol.2012.gjmr-lsd) version 1.6, as included in darktable (`src/iop/ashift_lsd.c`, translated to TypeScript in `web/src/engine/develop/lsd.ts`) | Finding straight lines for Upright and Auto straighten | AGPL-3.0-or-later. Copyright © 2007-2011 Rafael Grompone von Gioi. GPL-3.0 section 13 allows combining it with GPL-3.0 code (as darktable does); the AGPL's own terms stay with this file, including its section 13 (users who interact with a modified version over a network must be offered its source). LightBench's source is public on GitHub (https://github.com/shawneburke88-afk/Photo-Editing-App), and the app links to it from Settings and System Check (owner's decision, 2026-10-12). |
| Nelder-Mead simplex by Michael F. Hutt, as included in darktable (`src/iop/ashift_nmsimplex.c`, translated to TypeScript in `web/src/engine/develop/nmsimplex.ts`) | Fitting Upright's perspective model and its automatic crop | MIT (text in the file's header). Copyright © 1997-2011 Michael F. Hutt; darktable's changes GPL-3.0-or-later. |
| [rawspeed](https://github.com/darktable-org/rawspeed) camera database (`data/cameras.xml`, converted to `web/src/engine/raw/camera-db.json` by `web/scripts/build-camera-db.mjs`) | Sensor white levels per camera, mode and ISO; the selection logic follows rawspeed's `Camera::getSensorInfo` | Data: CC-BY-SA 3.0 (the converted JSON stays under CC-BY-SA 3.0). Copyright © rawspeed and darktable contributors. |
| [darktable](https://github.com/darktable-org/darktable) lens module (code translated to TypeScript/WGSL from commit `ca5a020`, Oct 2026: `src/iop/lens.cc` embedded-metadata method, `src/common/exif.cc` and `src/common/dng_opcode.c` correction-data reading) | The camera's own lens corrections (Sony, Fujifilm, Olympus/OM System, DNG, Panasonic), in `web/src/engine/lens/embedded.ts` and `meta.ts`; darktable's choice of camera and lens from Lensfun | GPL-3.0-or-later. Copyright © darktable developers; the embedded-metadata algorithm is by Freddie Witherden (darktable pull request 7092). |
| [darktable](https://github.com/darktable-org/darktable) denoise (profiled), capture sharpening and noise profiles (code translated to WGSL/TypeScript from commit `ca5a020`, Oct 2026: `src/iop/denoiseprofile.c`, `src/common/noiseprofiles.c`, `src/common/eaw.c`, `data/kernels/denoiseprofile.cl`, `src/iop/demosaicing/capture.c`, `data/kernels/capture.cl`; data: `data/noiseprofiles.json`, kept unchanged in `web/noiseprofiles/` and converted to compact JSON by `web/noiseprofiles-plugin.ts`) | The Detail group: Noise Reduction (`web/src/engine/detail/denoise.ts`, `noiseprofiles.ts`, `web/src/engine/gpu/detail.wgsl`) and Sharpening (`web/src/engine/detail/capture.ts`) | GPL-3.0-or-later. Copyright © darktable developers; the noise profiles are contributed by darktable's users (names in the file). darktable's capture sharpening is a port of RawTherapee's Capture Sharpening (RawTherapee 5.8, GPL-3.0-or-later): "Credits go to: Ingo Weyrich (heckflosse67@gmx.de), he implemented the original algorithm for rawtherapee" (`capture.c`, lines 19-20). |
| [darktable](https://github.com/darktable-org/darktable) effects (code translated to WGSL/TypeScript from commit `e5306a7`, 2026-10-17: `src/iop/hazeremoval.c` with `src/common/guided_filter.c` and `box_filters.cc`; `src/iop/contrastntexture.c` with `src/common/eigf.h`; `src/iop/vignette.c`; `src/iop/grain.c`, its permutation table and octave constants; the Lightroom importer tables in `src/develop/lightroom.c`) | Dehaze, Texture and Clarity, the post-crop vignette's shape and Grain (docs/PHASE3.md Part 25), in `web/src/engine/develop/effects.ts`, `web/src/engine/gpu/effects.wgsl`, `effects-display.wgsl` and `effects-stage.ts` | GPL-3.0-or-later (the same as LightBench). Copyright © darktable developers (hazeremoval 2017-2026, guided filter 2017-2026, contrast & texture 2026, eigf.h 2019-2024, vignette 2010-2026, grain 2010-2026). |
| [Lensfun](https://github.com/lensfun/lensfun) library (code translated to TypeScript/WGSL from commit `43f9e00`, 2026-10-08: `libs/lensfun/database.cpp`, `lens.cpp`, `auxfun.cpp`, `modifier.cpp`, `mod-coord.cpp`, `mod-subpix.cpp`, `mod-color.cpp`) | Matching cameras and lenses, interpolating calibrations, and the distortion, TCA and vignetting models, in `web/src/engine/lens/lensfun.ts`, `lensfun-xml.ts` and `web/src/engine/gpu/warp.wgsl` | LGPL-3.0 (Lensfun's `README.md` and `COPYING.LESSER`); the translation is distributed under GPL-3.0-or-later, as LGPL-3.0 allows. Copyright © 2007 Andrew Zabolotny and the Lensfun contributors. |
| [Lensfun database](https://github.com/lensfun/lensfun/tree/master/data/db) (`data/db/*.xml` at commit `43f9e001ab66c4fcdd4f400463f13b72f94b2288`, 2026-10-08, unchanged, in `web/lensfun/db/`; converted at build time to `lensfun/lensfun-43f9e00.json`, served next to the app and downloaded on first use) | Lens profiles (distortion, chromatic aberration, vignetting) and camera crop factors | Data: CC BY-SA 3.0 (Lensfun's `README.md`: “The lens database is licensed under the Creative Commons Attribution-Share Alike 3.0 license”; text in `web/lensfun/COPYING.CC_BY-SA_3.0`). The converted JSON is an adaptation (reformatted, unused rows dropped; see `web/src/engine/lens/lensfun-xml.ts`) and stays under CC BY-SA 3.0. Copyright © the Lensfun contributors. Attribution also shown in the app (Develop → Crop & Lens → Lens). |
| [jpegli](https://github.com/google/jpegli) (commit `031a007`), compiled to WebAssembly by `web/scripts/build-jpegli.sh` | JPEG export encoder | BSD-3-Clause plus Google's patent grant (`web/src/vendor/jpegli/LICENSE`, `PATENTS`). Copyright © the JPEG XL Project Authors. |
| [Highway](https://github.com/google/highway) (linked into the jpegli WebAssembly) | SIMD support for jpegli | Apache-2.0 or BSD-3-Clause, at the user's choice (`web/src/vendor/jpegli/LICENSE.highway`). |
| [LightCraft](https://github.com/storytold/lightcraft) (commit `701f78e`: `crates/geom/src/crop.rs` and `crop_drag.rs`, translated to TypeScript and modified in `web/src/engine/develop/crop.ts`; `crates/pipeline/src/upright.rs`, parts translated and modified in `web/src/engine/develop/upright.ts`; `crates/raw/src/preview.rs` `embedded_preview_color_space`, in `web/src/engine/meta/preview-space.ts`; `crates/meta/src/iptc.rs` `parse_iptc` and `container.rs` `photoshop_iptc`, in `web/src/engine/meta/iptc.ts`; the RAW+JPEG sidecar naming rule of `crates/engine/src/sidecar.rs`, in `web/src/sidecar/naming.ts`) | The crop model and the rules for dragging crop handles; Upright's guards against false corrections (reliability gates, level consensus, Auto's limits); the colour space of RAWs' embedded previews; reading IPTC-IIM from JPEGs; which twin owns `NAME.xmp` | MIT OR Apache-2.0, used here under the MIT License (text below). Copyright (c) 2026 ArtCraft Team and the LightCraft contributors. |
| [LightCraft](https://github.com/storytold/lightcraft) (commit `701f78e`, `crates/raw/src/color.rs`, `crates/color/src/cct.rs` and `bradford` in `crates/color/src/lib.rs`, translated to TypeScript and modified in `web/src/engine/color/dng.ts`; tests from `color.rs` in `dng.test.ts`) | The DNG colour model: dual-illuminant ColorMatrix/ForwardMatrix interpolation by white balance, camera neutral ⇄ white point, colour temperature of a white point | MIT OR Apache-2.0, used here under the MIT License (text below). Copyright (c) 2026 ArtCraft Team and the LightCraft contributors. |
| [LightCraft](https://github.com/storytold/lightcraft) (commit `701f78e`: the mid-tone weight of its Clarity, `crates/pipeline/src/finish.rs` lines 496–502, `mid = exp(−(base / 3.2)²)` and `0.35 + 0.65 · mid`, with its base as log2 luminance over grey 0.18, `crates/pipeline/src/local.rs` lines 370–372 and `tone.rs` line 11; in `web/src/engine/develop/effects.ts` `midtoneWeight` and `effects-display.wgsl` `tcApply`) | Clarity's mid-tone weighting (docs/PHASE3.md Part 25; owner's decision T4) | MIT OR Apache-2.0, used here under the MIT License (text below). Copyright (c) 2026 ArtCraft Team and the LightCraft contributors. |
| [LibRaw](https://www.libraw.org/) 0.22.1 | Reading camera RAW files | LGPL-2.1 or CDDL-1.0 (shipped as a separate, replaceable `.wasm` file) |
| [@colorhythm/libraw-wasm](https://github.com/colorhythm/libraw-wasm) | WebAssembly build + bindings for LibRaw | MIT |
| [lcms-wasm](https://github.com/mattdesl/lcms-wasm) 1.0.5 (npm `lcms-wasm`; `dist/lcms.js` and `dist/lcms.wasm`, shipped unchanged in soft proofing's worker chunk, loaded only when soft proofing is used) | Soft proofing (docs/PHASE3.md Part 20): reading ICC profiles, including printers' LUT-based and CMYK ones, and building the proof table | MIT. Copyright (c) 2024 Matt DesLauriers (text below). Based on yoya's lcms.js. Its npm package lists `tape` (a test runner, MIT) as a dependency: npm installs it, but nothing of it is imported or shipped. |
| [Little CMS](https://github.com/mm2/Little-CMS) (compiled into lcms-wasm's `lcms.wasm`; lcms-wasm's `lib/constants.js` gives `LCMS_VERSION = 2160`, i.e. 2.16; the exact commit of its `Little-CMS` submodule was not checked) | The colour management engine behind soft proofing | MIT. Copyright (c) 2023 Marti Maria Saguer (licence text of the `lcms2.16` tag, below). lcms-wasm's `build.sh` compiles only `Little-CMS/src/*.c` (the core library; no plugins). |
| [SQLite](https://sqlite.org/) / [@sqlite.org/sqlite-wasm](https://github.com/sqlite/sqlite-wasm) | Library catalog database | Public domain / Apache-2.0 |
| [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) 0.1.7 | No longer shipped. LightBench's own service worker (`web/src/pwa/sw.ts`) reproduces its COOP/COEP header logic for cross-origin isolation on GitHub Pages | MIT. Copyright © Guido Zuidhof and contributors. |
| [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2) **Small** (weights; the ONNX export [`onnx-community/depth-anything-v2-small`](https://huggingface.co/onnx-community/depth-anything-v2-small), fp16 and fp32 files, pinned by commit and SHA-256 in `web/models/manifest.json`). **Not in this repository and not part of the app's install**: the deploy workflow fetches the pinned files into the site, and the app downloads one only when the user agrees (docs/PHASE3.md Part 24) | The AI Depth range mask (relative depth of each part of a photo), run on the user's device with ONNX Runtime Web | **Apache-2.0** (the Depth Anything V2 README: “Depth-Anything-V2-Small model is under the Apache-2.0 license. Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license.”; only Small is used). Licence text: `web/models/notices/depth-anything-v2.LICENSE.txt` (the repository's `LICENSE` at commit `a561b84`; the repository has no NOTICE file), also served next to the model as `models/depth-anything-v2-small/LICENSE.txt`. By Lihe Yang, Bingyi Kang, Zilong Huang, Zhen Zhao, Xiaogang Xu, Jiashi Feng and Hengshuang Zhao (“Depth Anything V2”, NeurIPS 2024, arXiv:2406.09414). **Training data** (paper, Table 7): synthetic BlendedMVS, Hypersim, IRS, TartanAir, Virtual KITTI 2; pseudo-labelled real BDD100K, Google Landmarks, ImageNet-21K, LSUN, Objects365, Open Images V7, Places365, SA-1B. These sets are named publicly; some have non-commercial or research-only terms (e.g. SA-1B, Virtual KITTI 2). The app's download dialog and Settings → AI models say so. |
| [Moebius](https://github.com/hustvl/Moebius) (the `ft_places2` weights, as Simon Willison's ONNX conversion [`simonw/Moebius-ONNX`](https://huggingface.co/simonw/Moebius-ONNX) at commit `5bf1ef5`: `vae_encoder.onnx`, `unet.onnx`, `vae_decoder.onnx`, fp32, pinned by commit, size and SHA-256 in `web/models/manifest.json`). **Not in this repository, not on LightBench's site and not part of the app's install**: the app downloads the files straight from Hugging Face only when the user agrees (docs/PHASE3.md Part 26) | AI Remove (the Remove brush's AI mode), run on the user's device with ONNX Runtime Web | **Apache-2.0**, as the authors' GitHub repository states: “Both the code and the pretrained model weights of Moebius are released under the Apache License 2.0” and “Commercial use of the weights and the images produced with them is permitted.” (README, commit `b88d462`, 2026-08-12; LICENSE “Copyright 2024 Moebius Authors”, kept in `web/models/notices/moebius.LICENSE.txt`). The Hugging Face page of the original weights (`hustvl/Moebius`) is tagged MIT and has no licence file; LightBench relies on the GitHub statement. The conversion is tagged apache-2.0 and ships an Apache-2.0 LICENSE. The VAE (image encoder and decoder) comes from the authors' PixelHacker (`hustvl/PixelHacker`, SDXL's VAE), whose Hugging Face copy is tagged MIT with no licence file or copyright line; the owner accepted that copy (2026-10-17). By Kangsheng Duan, Ziyang Xu, Wenyu Liu, Xiaohu Ruan, Xiaoxin Chen and Xinggang Wang (“Moebius: 0.2B Lightweight Image Inpainting Framework with 10B-Level Performance”, ECCV 2026, arXiv:2606.19195). **Training data:** distilled from PixelHacker (pre-trained on 14 M image–mask pairs from COCONut-Large, Objects365 V2, Google Landmarks V2 and an unnamed 7.49 M-image natural-scene set gathered by its authors; fine-tuned on Places2, CelebA-HQ and FFHQ), then fine-tuned on Places2; the distillation data isn't stated. Not all of it is named publicly: an exception the owner accepted (2026-10-17). Some named sets carry non-commercial or research-only terms (e.g. FFHQ). The app's download dialog and Settings → AI models say so. |
| [SAM 2.1](https://github.com/facebookresearch/sam2) **Hiera Tiny** (weights; the ONNX export [`onnx-community/sam2.1-hiera-tiny-ONNX`](https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX) at commit `814a066`: the image encoder and prompt decoder graphs and their weights files, fp16 and fp32, pinned by commit, size and SHA-256 in `web/models/manifest.json`). **Not in this repository and not part of the app's install**: the deploy workflow fetches the pinned files into the site, and the app downloads one variant only when the user agrees (docs/PHASE3.md Part 27) | Object select (AI masks), run on the user's device with ONNX Runtime Web | **Apache-2.0** (the SAM 2 README: “The SAM 2 model checkpoints, SAM 2 demo code (front-end and back-end), and SAM 2 training code are licensed under Apache 2.0”, commit `2b90b9f`). The ONNX export has no licence tag or file of its own; LightBench relies on Meta's statement. Licence text: `web/models/notices/sam2.LICENSE.txt` (the repository's `LICENSE` at `2b90b9f`; the repository has no NOTICE file), also served next to the model as `models/sam2-1-hiera-tiny/LICENSE.txt`. By Nikhila Ravi, Valentin Gabeur, Yuan-Ting Hu, Ronghang Hu, Chaitanya Ryali, Tengyu Ma, Haitham Khedr, Roman Rädle, Chloe Rolland, Laura Gustafson, Eric Mintun, Junting Pan, Kalyan Vasudev Alwala, Nicolas Carion, Chao-Yuan Wu, Ross Girshick, Piotr Dollár and Christoph Feichtenhofer (Meta FAIR; “SAM 2: Segment Anything in Images and Videos”, arXiv:2408.00714). **Training data** (paper, App. D.2.2): about 15 % SA-1B (published for research use only), 70 % SA-V (CC BY 4.0) and 15 % Meta's own licensed videos, which are not published: accepted by the owner under the relaxed model rule (2026-10-21), with this said in plain words in the app's download dialog and Settings → AI models. |
| [RF-DETR](https://github.com/roboflow/rf-detr) **Seg Nano** (weights; the community ONNX conversion [`PierreMarieCurie/rf-detr-onnx`](https://huggingface.co/PierreMarieCurie/rf-detr-onnx) `rf-detr-seg-nano.onnx` at commit `94f9197`, pinned by commit, size and SHA-256 in `web/models/manifest.json`). **Not in this repository, not on LightBench's site and not part of the app's install**: the app downloads it from Hugging Face only when the user agrees (docs/PHASE3.md Part 28) | People (AI masks): finding and outlining people, run on the user's device with ONNX Runtime Web | **Apache-2.0** (RF-DETR README, develop branch, read 2026-10-26: “The open-source `rfdetr` package and Apache-designated model weights are licensed under Apache License 2.0”, RF-DETR-Seg-N listed as “Apache 2.0”; the conversion is tagged apache-2.0). Licence text: `web/models/notices/rf-detr.LICENSE.txt` (the repository's `LICENSE`, “Copyright 2025 Roboflow, Inc.”). By Isaac Robinson, Peter Robicheaux, Matvei Popov, Deva Ramanan and Neehar Peri (“RF-DETR: Real-Time Detection Transformer”, ICLR 2026, arXiv:2511.09554). **Training data**: COCO (annotations CC BY 4.0, photos under Flickr's terms), pre-training on Objects365 (academic use only) with outlines made by SAM 2; its DINOv2 backbone was trained on LVD-142M, which is not published: accepted by the owner under the relaxed model rule (unpublished foundation data, stated plainly in the app). |
| [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) (`face_detection_yunet_2026may.onnx` from OpenCV Zoo at commit `48b10fa`, a Git LFS file, pinned by commit, size and SHA-256). **Not in this repository and not part of the app's install**: the deploy workflow fetches it into the site, and the app downloads it only when the user agrees (Part 28) | People: finding faces | **MIT** (OpenCV Zoo: “All files in this directory are licensed under MIT License”). Licence text: `web/models/notices/yunet.LICENSE.txt` (“Copyright (c) 2020 Shiqi Yu”), also served as `models/yunet/LICENSE.txt`. By Wei Wu, Hanyang Peng and Shiqi Yu (“YuNet: A Tiny Millisecond-level Face Detector”, Machine Intelligence Research 2023). **Training data**: WIDER FACE (published under “cc by-nc-nd”: non-commercial, no derivatives), said in the app. |
| [MediaPipe Selfie Multiclass](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter) (Google's model, as the community ONNX conversion [`FreeHugsForRobots/ps-skin-seg`](https://huggingface.co/FreeHugsForRobots/ps-skin-seg) `selfie_multiclass_256x256.onnx` at commit `f3a7202`, pinned by commit, size and SHA-256). **Not in this repository and not part of the app's install**: the deploy workflow fetches it into the site, and the app downloads it only when the user agrees (Part 28) | People: hair, face skin, body skin and clothes | **Apache-2.0** (Google's model card: “Licensed under: Apache License, Version 2.0”; the conversion is tagged apache-2.0). Licence text: `web/models/notices/mediapipe.LICENSE.txt`, also served as `models/mediapipe-selfie-multiclass/LICENSE.txt`. **Training data**: not named by Google (the model card: “thousands of samples with diverse identities”): an exception approved by the owner (2026-10-21), said plainly in the app. |
| [EfficientViT](https://github.com/mit-han-lab/efficientvit) **Seg B1 (ADE20K)** (weights `efficientvit_seg_b1_ade20k.pt` from [`han-cai/efficientvit-seg`](https://huggingface.co/han-cai/efficientvit-seg) at commit `cf3ccaf`, converted to ONNX by LightBench's "AI models" workflow with the authors' code at `de7d773`, and published as the GitHub Release [`models-efficientvit-seg-b1-ade20k-1`](https://github.com/shawneburke88-afk/Photo-Editing-App/releases/tag/models-efficientvit-seg-b1-ade20k-1) of this repository: `efficientvit_seg_b1_ade20k.onnx`, 19,277,968 bytes, pinned by commit, size and SHA-256 in `web/models/manifest.json`). **Not in this repository's files and not part of the app's install**: the deploy workflow fetches the pinned asset into the site, and the app downloads it only when the user agrees (docs/PHASE3.md Part 29) | The Sky mask (AI masks), run on the user's device with ONNX Runtime Web | **Apache-2.0** (the weights' Hugging Face page is tagged apache-2.0; the code repository's `LICENSE`, "Copyright [2023] [Han Cai]", at `de7d773`, kept in `web/models/notices/efficientvit.LICENSE.txt`, served next to the model and attached to the release with a SOURCE note). LightBench changed only the format. By Han Cai, Junyan Li, Muyan Hu, Chuang Gan and Song Han (MIT Han Lab; "EfficientViT: Lightweight Multi-Scale Attention for High-Resolution Dense Prediction", ICCV 2023, arXiv:2205.14756). **Training data:** ADE20K (MIT; about 20,000 scene photos outlined into 150 classes), whose terms allow non-commercial research and education use only; the backbone was first trained on ImageNet-1K, whose terms likewise allow non-commercial research and education only. Both named publicly; the app's download dialog and Settings → AI models say so. |
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) **BiRefNet_lite** (the ONNX conversion `onnx/model_fp16.onnx` of [`onnx-community/BiRefNet_lite-ONNX`](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX) at commit `de15b22`, its graph rearranged by LightBench's "AI models" workflow so that ONNX Runtime Web can run it, the weights unchanged, and published as the GitHub Release [`models-birefnet-lite-1`](https://github.com/shawneburke88-afk/Photo-Editing-App/releases/tag/models-birefnet-lite-1) of this repository: `birefnet_lite_fp16.onnx`, 115,109,386 bytes, pinned by commit, size and SHA-256 in `web/models/manifest.json`). **Not in this repository's files and not part of the app's install**: the deploy workflow fetches the pinned asset into the site, and the app downloads it only when the user agrees (docs/PHASE3.md Part 30) | The Subject mask (AI masks), run on the user's device with ONNX Runtime Web | **MIT** (the code repository's `LICENSE`, "Copyright (c) 2024 ZhengPeng", at `f707963`, kept in `web/models/notices/birefnet.LICENSE.txt`, served next to the model and attached to the release with a SOURCE note; the weights' and the conversion's Hugging Face pages are tagged mit). By Peng Zheng, Dehong Gao, Deng-Ping Fan, Li Liu, Jorma Laaksonen, Wanli Ouyang and Nicu Sebe ("Bilateral Reference for High-Resolution Dichotomous Image Segmentation", arXiv:2401.03407); ONNX conversion by onnx-community. **Training data:** the authors' two sources disagree: the GitHub model table lists DIS5K, DUTS, HRSOD, UHRSD, HRS10K, P3M-10k and TR-humans, the Hugging Face card DIS5K's training set only; DIS5K's terms allow non-commercial research and education only (the others' terms are summarised in the app's download dialog and Settings → AI models); the Swin Transformer backbone started from Microsoft's ImageNet-22K/1K weights (ImageNet: non-commercial research and education). |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.30.0 (npm `onnxruntime-web`, exact version; its JavaScript in the AI runtime worker's chunk, its WebAssembly file `ort-wasm-simd-threaded.asyncify.wasm` served at `ort/1.30.0/` and downloaded only with a model) | Running the AI models (WebGPU, or WebAssembly) | MIT. Copyright (c) Microsoft Corporation (text below; `web/models/notices/onnxruntime.LICENSE.txt`, from the `v1.30.0` tag). The components compiled into its WebAssembly are listed in ONNX Runtime's `ThirdPartyNotices.txt` (same tag), kept in `web/models/notices/onnxruntime-1.30.0.ThirdPartyNotices.txt` and served next to the runtime. Its npm dependencies (`onnxruntime-common` MIT, `flatbuffers` Apache-2.0, `guid-typescript` ISC, `long` Apache-2.0, `platform` MIT, `protobufjs` BSD-3-Clause) are installed by npm; the `onnxruntime-web/webgpu` bundle LightBench imports is self-contained (it imports none of them). |
| [React](https://react.dev/) | User interface | MIT |
| [Vite](https://vite.dev/), [TypeScript](https://www.typescriptlang.org/), [oxlint](https://oxc.rs/) | Build tools (not shipped) | MIT / Apache-2.0 / MIT |

Test photos used during development come from
[immich-app/test-assets](https://github.com/immich-app/test-assets) (public domain) and are not included
in this repository, except `web/scripts/fixtures/ai-remove/philadelphia-768.png` (AI Remove's check in the "AI models"
workflow): a crop of the embedded preview of that repository's `philadelphia.nef`, whose README says “All assets are
public domain”. `web/scripts/fixtures/ai-masks/rocket.jpg` (the Sky check) is SpaceX's DSCOVR launch photo, committed
unchanged from scikit-image v0.24.0, which says it was "released in the public domain" (see its `SOURCE.md`).

## Adobe DNG

This product includes DNG technology under license by Adobe.

LightBench reads DNG files (through LibRaw and its own DNG colour, opcode and metadata code). Adobe's royalty-free
DNG Specification Patent License asks products that read or write DNG files to carry the notice above
(https://helpx.adobe.com/camera-raw/digital-negative.html; the licence text was quoted by an independent check on
2026-10-13, `docs/research/cowork-2026-10-13b/D_PROFILES.md`). Whether the licence also covers stand-alone `.dcp`
camera profiles is not settled; LightBench doesn't read them.

## LightCraft licence (MIT)

`web/src/engine/develop/crop.ts` (and its tests in `crop.test.ts`) is a translation of LightCraft's crop model,
modified by the LightBench contributors (2026); the file's header lists the changes. Parts of
`web/src/engine/develop/upright.ts` (the vanishing-point helpers, `reliable`, `level_angle` and the Auto policy of
LightCraft's `crates/pipeline/src/upright.rs`) are translated and modified the same way; that file's header says how.
`web/src/engine/meta/preview-space.ts` (preview colour space) and `web/src/engine/meta/iptc.ts` (IPTC-IIM, extended to
more datasets), with parts of their tests, are translations of LightCraft code modified by the LightBench contributors
(2026), and `web/src/sidecar/naming.ts` follows LightCraft's naming rule for RAW+JPEG sidecars. `web/src/engine/color/dng.ts` (and most tests in `dng.test.ts`) is a translation of LightCraft's DNG colour model
(`crates/raw/src/color.rs`, with parts of `crates/color/src/cct.rs` and `lib.rs`), modified the same way. Clarity's mid-tone weight in
`web/src/engine/develop/effects.ts` and `web/src/engine/gpu/effects-display.wgsl` is LightCraft's (`crates/pipeline/src/finish.rs`
lines 496–502), applied there to darktable contrast & texture's bands. LightCraft offers its
code under the MIT License or the Apache License 2.0; LightBench uses it under the MIT License:

```
MIT License

Copyright (c) 2026 ArtCraft Team and the LightCraft contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## lcms-wasm licence (MIT)

`web/node_modules/lcms-wasm/LICENSE.md` (lcms-wasm 1.0.5), as shipped with its `lcms.js` and `lcms.wasm`:

```
The MIT License (MIT)
Copyright (c) 2024 Matt DesLauriers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
OR OTHER DEALINGS IN THE SOFTWARE.
```

## Little CMS licence (MIT)

`LICENSE` of Little CMS at the `lcms2.16` tag (https://github.com/mm2/Little-CMS), the version lcms-wasm reports. The
npm package doesn't include this file, so it is reproduced here for the Little CMS code inside `lcms.wasm`:

```
MIT License

Copyright (c) 2023 Marti Maria Saguer

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the 
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to 
permit persons to whom the Software is furnished to do so, subject
to the following conditions:

The above copyright notice and this permission notice shall be 
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF 
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE 
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## ONNX Runtime licence (MIT)

`web/models/notices/onnxruntime.LICENSE.txt` (ONNX Runtime's `LICENSE` at the `v1.30.0` tag), for the ONNX Runtime Web
code and WebAssembly LightBench serves:

```
MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Depth Anything V2 Small licence (Apache-2.0)

The full Apache License 2.0 text, as in the Depth Anything V2 repository's `LICENSE` (commit `a561b84`), is in
`web/models/notices/depth-anything-v2.LICENSE.txt` and is served next to the model files
(`models/depth-anything-v2-small/LICENSE.txt`). LightBench redistributes the ONNX export of the Small weights unchanged
(byte for byte, checked by SHA-256). The repository has no NOTICE file.

## Moebius licence (Apache-2.0)

The full Apache License 2.0 text, as in the Moebius repository's `LICENSE` (commit `b88d462`, “Copyright 2024 Moebius
Authors”), is in `web/models/notices/moebius.LICENSE.txt`. LightBench does not redistribute the weights: the app
downloads Simon Willison's unchanged ONNX conversion (`simonw/Moebius-ONNX`, Apache-2.0) from Hugging Face, checked by
SHA-256. The repository has no NOTICE file.

## RF-DETR, YuNet and MediaPipe Selfie Multiclass licences (Apache-2.0, MIT, Apache-2.0)

The licence texts are in `web/models/notices/rf-detr.LICENSE.txt` (Apache-2.0, the RF-DETR repository's `LICENSE`),
`yunet.LICENSE.txt` (MIT, OpenCV Zoo's `models/face_detection_yunet/LICENSE` at `48b10fa`) and
`mediapipe.LICENSE.txt` (the Apache License 2.0 text). YuNet's and MediaPipe Selfie Multiclass's files are served by
LightBench's site unchanged (byte for byte, checked by SHA-256), each with its licence beside it; RF-DETR-Seg Nano is
downloaded by the app from Hugging Face, unchanged.

## BiRefNet licence (MIT)

The MIT licence text, as in the BiRefNet repository's `LICENSE` (commit `f707963`, "Copyright (c) 2024 ZhengPeng"), is in
`web/models/notices/birefnet.LICENSE.txt`, is served next to the model file (`models/birefnet-lite/LICENSE.txt`) and is
the `LICENSE.txt` asset of the release that holds LightBench's patched copy of onnx-community's ONNX conversion, with a
`SOURCE.md` saying where the file came from and how it was changed and checked (only the graph's arrangement changed; the
weights are the conversion's own).

## EfficientViT licence (Apache-2.0)

The full Apache License 2.0 text, as in the EfficientViT repository's `LICENSE` (commit `de7d773`, "Copyright [2023]
[Han Cai]"), is in `web/models/notices/efficientvit.LICENSE.txt`, is served next to the model file
(`models/efficientvit-seg-b1-ade20k/LICENSE.txt`) and is the `LICENSE.txt` asset of the release that holds LightBench's
ONNX conversion of the weights, with a `SOURCE.md` saying where the weights came from and how they were converted and
checked (a modified-files notice in the sense of Apache-2.0 §4(b): only the file format changed). The repository has no
NOTICE file.

## SAM 2.1 licence (Apache-2.0)

The full Apache License 2.0 text, as in the SAM 2 repository's `LICENSE` (commit `2b90b9f`), is in
`web/models/notices/sam2.LICENSE.txt` and is served next to the model files (`models/sam2-1-hiera-tiny/LICENSE.txt`).
LightBench redistributes the onnx-community export of the SAM 2.1 Hiera Tiny weights unchanged (byte for byte, checked by
SHA-256). The repository has no NOTICE file.
