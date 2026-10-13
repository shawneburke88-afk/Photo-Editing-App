> **Provenance:** an independent research run done in Claude Cowork on 2026-10-13, written without seeing the drafts in `docs/research/`. It has not been re-verified, except where the spot-check log in [INDEX.md](INDEX.md) says so. The text below is copied unchanged.

# Part 4: AI depth of field with depth grading

*LightBench research brief, Part 4. Researched 2026-10-13. All quotes were taken from the linked pages on that date. Anything not confirmed from a primary source is marked **[unconfirmed]**. Speed figures marked **estimate** are my own reasoning, not published measurements.*

---

> ## Decisions this changes
>
> | Earlier decision | Verdict | Reasoning | Source |
> |---|---|---|---|
> | **Depth Anything V2 Small** as the Phase 4 depth model | **Supports**, with two caveats | The weights licence is Apache-2.0 in every place I checked: the GitHub README, the original Hugging Face (HF) repo, the `-hf` (Transformers) repo, and the `onnx-community` ONNX repo that transformers.js loads. Base and Large are CC-BY-NC-4.0, and Giant is not released, so **only Small passes the owner's rule**. The model outputs "affine-invariant inverse depth", which is exactly what thin-lens blur needs (see the maths section), so metric depth is not required. **Caveat 1:** some of the training data has non-commercial or research-only terms (Virtual KITTI 2 is NC-SA; SA-1B is "Limited"). That affects the data, not the weights licence, but the owner should know. **Caveat 2:** do **not** use the DA-V2 *metric* checkpoints. Their licence information conflicts between sources, and they are fine-tuned on Virtual KITTI 2 (non-commercial) and Hypersim (CC BY-SA). | GitHub README: "Depth-Anything-V2-Small model is under the Apache-2.0 license." ([github.com/DepthAnything/Depth-Anything-V2](https://github.com/DepthAnything/Depth-Anything-V2)); HF: "License: apache-2.0" ([Small-hf](https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf)) |
> | (new) Better permissive alternatives? | **Mixed. Nothing replaces Small yet, but two models are worth evaluating** | **Depth Anything 3** (Nov 2025) has Apache-2.0 sizes: DA3-SMALL, DA3-BASE, DA3MONO-LARGE and DA3METRIC-LARGE. **DA3MONO-LARGE** (0.35B) is the first *Large-class* monocular depth model under a permissive licence from this family, so it could be an optional "high-quality depth" download. **MoGe-2 ViT-S** (35M, MIT, metric) is a second permissive option. Neither has published browser speed figures, and DA3's training data is only described as "Public academic datasets only". | [github.com/ByteDance-Seed/Depth-Anything-3](https://github.com/ByteDance-Seed/Depth-Anything-3); [huggingface.co/depth-anything/DA3MONO-LARGE](https://huggingface.co/depth-anything/DA3MONO-LARGE); [github.com/microsoft/MoGe](https://github.com/microsoft/MoGe) |
> | (new) Apple Depth Pro | **Contradicts any plan to use it** | GitHub says the weights are under Apple's sample-code-style LICENSE. The HF weights repo instead ships the **Apple Machine Learning Research Model License**, which is research-only. Because the sources conflict, it is excluded. | [huggingface.co/apple/DepthPro/blob/main/LICENSE](https://huggingface.co/apple/DepthPro/blob/main/LICENSE) |
> | Phase 4 inpainting pick (MI-GAN / LaMa) | **Supports (cross-reference)** | MPIB, the main open layered-bokeh framework, uses LaMa to inpaint the background hidden behind blurred foreground. The project's existing inpainting pick can do the same job here. | [github.com/JuewenPeng/MPIB](https://github.com/JuewenPeng/MPIB) |
> | BiRefNet (masking pick) | **Supports (cross-reference)** | A subject matte is the most practical fix for hair and fine edges, and it can drive "auto-focus on subject". | Reasoning; see the foreground section |

---

## Summary

Depth Anything V2 Small is still the right depth model for LightBench. Its weights and code are Apache-2.0, it has 24.8M parameters, and it already runs in transformers.js from an `onnx-community` repo with fp16 (49.6 MB) and q4f16 (19.1 MB) builds. Its paper says it predicts **affine-invariant inverse depth** (disparity up to an unknown scale *a* and shift *b*). Under the thin-lens model, the circle of confusion (CoC) is **linear in inverse depth**: c = K·|1/z − 1/z_f|. Substituting d = a/z + b gives **c = (K/a)·|d − d_f|**. The shift *b* cancels, and the unknown scale *a* folds into the user's "Amount/Aperture" slider. Blur therefore grows correctly on both sides of the focus plane **without metric depth**. A focus range defined in disparity also reproduces the real-lens behaviour where more depth is sharp behind the subject than in front of it. MPIB uses the same formula: "r = A|1/z − 1/z_f| = A|d − d_f|". For rendering, I recommend a **layered (depth-sliced) renderer in scene-linear Rec.2020**, compositing pre-multiplied layers back to front as MPIB does. This handles partial occlusion and stops colour bleeding. It should use per-layer kernels for bokeh shapes, including cat's-eye clipping near the frame edges, with optional MI-GAN fill of the hidden background. The depth map should be **stored with the edit**, because GPU inference is not guaranteed to be bit-identical across devices and old edits must not change. Apple's US 10,410,327 ("Shallow depth of field rendering") is listed as Active, with an anticipated expiry of 2038-05-25. Its claim 1 recites computing each blurred pixel from a weighted combination of surrounding candidate pixels, where one weighting characteristic is based on the candidate's own blur value. These are facts only, with no opinion.

---

## 1. Depth models

### 1.1 Table: depth models

| Model / size | Weights licence (quoted) | Code licence (quoted) | Training data (caveats) | Size | Browser runtime | Published speed | Output |
|---|---|---|---|---|---|---|---|
| **DA-V2 Small** | GitHub: "Depth-Anything-V2-Small model is under the Apache-2.0 license." HF original + `-hf`: "License: apache-2.0" | Repo sidebar: "Apache-2.0 license" | 595K synthetic (BlendedMVS, Hypersim, IRS, TartanAir, Virtual KITTI 2) + 62M pseudo-labelled real (BDD100K, Google Landmarks, ImageNet-21K, LSUN, Objects365, Open Images V7, Places365, SA-1B). VKITTI2 is NC-SA; SA-1B is "Limited" | "24.8M" params. ONNX: fp32 99.1 MB, fp16 49.6 MB, int8 27.3 MB, q4f16 19.1 MB | transformers.js `pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small')`; listed in the official README as "Transformers.js (real-time depth in web)" | No published WebGPU figure with hardware found. Core ML (not browser), fp16: 24.58 ms on M3 Max, 32.80 ms on M1 Max, 31.10 ms on iPhone 12 Pro Max (Neural Engine) | **Relative**: "affine-invariant inverse depth" |
| DA-V2 Base | GitHub: "Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license." HF original + `-hf`: "License: cc-by-nc-4.0" | Apache-2.0 | as above | "97.5M" | ONNX exists | n/a | Relative. **Excluded (NC)** |
| DA-V2 Large | Same CC-BY-NC-4.0 sentence; HF original + `-hf`: "License: cc-by-nc-4.0" | Apache-2.0 | as above | "335.3M" | ONNX exists | n/a | Relative. **Excluded (NC)** |
| DA-V2 Giant | Same CC-BY-NC-4.0 sentence | Apache-2.0 | as above | "1.3B", checkpoint "Coming soon" | Not released (HF page did not load / no repo found) | n/a | **Excluded (NC, unreleased)** |
| DA-V2 Metric (Hypersim indoor / VKITTI outdoor; S/B/L) | **Conflicting.** HF original repos (Small, Base, Large) all tagged "License: apache-2.0". The HF `Metric-Indoor-Small-hf` repo shows no licence tag. The GitHub README gives no metric-specific licence, while saying the Base/Large relative models are CC-BY-NC | Apache-2.0 | Fine-tuned on Hypersim ("Creative Commons Attribution-ShareAlike 3.0 Unported") and Virtual KITTI 2 ("may be used for non-commercial purposes only") | S 24.8M / B 97.5M / L 335.3M | Small-hf exists in Transformers format | n/a | Metric; "max_depth = 20 # 20 for indoor model, 80 for outdoor model". **Not recommended** |
| **Depth Anything 3**: DA3-SMALL | HF: "License: apache-2.0". GitHub model table: Apache 2.0 | Repo sidebar: "Apache-2.0 license" | "Public academic datasets only" **[datasets not individually checked]** | "0.08B" in the model table, but "34.3M params" in file info (inconsistent on the page) | `onnx-community/depth-anything-v3-small` (Apache-2.0, empty README) | Third-party 8-bit ONNX, 322 px: 90–113 ms (fp32 127–218 ms), **hardware not stated** | Relative depth + pose ("Any-view Model") |
| DA3-BASE | HF: "license: apache-2.0" | Apache-2.0 | as above | "0.12B" | ONNX ports exist (third party) | n/a | Relative + pose |
| **DA3MONO-LARGE** | HF: "apache-2.0" | Apache-2.0 | as above | "0.35B" | None official found | n/a | Relative **depth** (the card says it "directly predicts depth", not disparity) |
| DA3METRIC-LARGE | HF: "apache-2.0" | Apache-2.0 | as above | "0.35B" | Third-party ONNX | n/a | "Canonical metric depth"; "multiplying by focal length gives metric depth" |
| DA3-LARGE, DA3-GIANT, DA3NESTED-GIANT-LARGE | GitHub table: CC BY-NC 4.0 | Apache-2.0 | | | | | **Excluded (NC)** |
| **Apple Depth Pro** | **Conflicting.** GitHub README: "The model weights are released under the LICENSE terms" (sample-code-style licence). HF `apple/DepthPro`: "License: apple-amlr"; LICENSE file: "exclusively for Research Purposes" | GitHub LICENSE: "personal, non-exclusive license" to "use, reproduce, modify and redistribute"; "no other rights or licenses, express or implied, are granted by Apple herein", and no patent rights | Datasets listed only as an image on the HF card **[unconfirmed]** | "1.0B params"; `depth_pro.pt` 1.9 GB | `onnx-community/DepthPro-ONNX` (tag "apple-ascl"); transformers.js supported | "2.25-megapixel depth map in 0.3 seconds on a standard GPU" (not browser) | Metric. **Excluded** (conflict; research-only weights on HF; too large) |
| MiDaS v2.1 / v3.1 (incl. DPT) | HF `Intel/dpt-swinv2-tiny-256`: "license: mit"; README: "MIT License" | MIT | "trained on up to 12 datasets", including "a new, massive data source: 3D films" (copyrighted film content) | v2.1 Small: 21M | ONNX widely available **[transformers.js DPT support assumed from the `dpt` architecture; not separately verified]** | v2.1 Small: 90 FPS on RTX 3090 (native, training res); OpenVINO: 22 FPS at 640×480 on i7-1185G7 | Relative ("computes the relative depth map") |
| ZoeDepth | HF `Intel/zoedepth-nyu`: "license: mit" | MIT **[GitHub not fetched]** | "fine-tuned on the NYU dataset" (NYU terms not checked) | not stated **[unconfirmed]** | Transformers port exists | n/a | Metric (indoor/outdoor heads) |
| Metric3D v2 (S/L/g) | **Not stated separately.** README: "The *Metric 3D* code is under a 2-clause BSD License." and "For further commercial inquiries, please contact Dr. Wei Yin" | BSD-2-Clause | "142M + 16M" images (ViT-L row); datasets not named on the page | ViT-S/L/g; params not given | "the onnx supports are availble for all three models" | n/a | Metric + normals. **Unclear (weights licence not stated): hold** |
| UniDepth v1 / v2 | README: "This software is released under Creatives Common BY-NC 4.0 license." (does not separate weights) | CC BY-NC 4.0 | | V2: ViT-S/B/L | "ONNX support" (V2) | n/a | Metric. **Excluded (NC)** |
| **MoGe-2** (ViT-S/B/L) | HF `Ruicheng/moge-2-vits-normal`: "License: mit" | "MoGe code is released under the MIT license, except for DINOv2 code ... released by Meta AI under the Apache 2.0 license." README says nothing about weights | Not checked **[unconfirmed]** | vits-normal 35M; vitb-normal 104M; vitl 326M; vitl-normal 331M | Third-party WebGPU port of vitl-normal: "weights.bin (~660MB)", "MIT, matching upstream MoGe-2" | none | Metric point map ("final metric point map in OpenCV camera coordinates") |
| Marigold | **Conflicting.** GitHub: "The models are licensed under RAIL++-M License." HF v1-1: "openrail++". HF v1-0: "License: apache-2.0" | "licensed under the Apache License, Version 2.0" | Fine-tuned from "stable-diffusion-2" (OpenRAIL++ base) | "0.9B params" | Diffusion: impractical in browser | n/a | Affine-invariant depth. **Excluded (RAIL)** |

**GPL-licensed depth weights:** none found among the surveyed models, so there is nothing to list separately for this part.

### 1.2 Key quotes and URLs (licences)

- DA-V2 GitHub README, License section: "Depth-Anything-V2-Small model is under the Apache-2.0 license." and "Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license." The same README gives the parameter table: Small "24.8M", Base "97.5M", Large "335.3M", Giant "1.3B", "Coming soon". https://github.com/DepthAnything/Depth-Anything-V2 (same text in the jsDelivr mirror of the README: https://cdn.jsdelivr.net/gh/depthanything/depth-anything-v2@main/README.md)
- HF `depth-anything/Depth-Anything-V2-Small`: "License: apache-2.0". https://huggingface.co/depth-anything/Depth-Anything-V2-Small
- HF `depth-anything/Depth-Anything-V2-Small-hf`: "License: apache-2.0", "24.8M params". https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf
- HF `Depth-Anything-V2-Base`: "License: cc-by-nc-4.0". https://huggingface.co/depth-anything/Depth-Anything-V2-Base · `-Base-hf`: "License: cc-by-nc-4.0", "97.5M params". https://huggingface.co/depth-anything/Depth-Anything-V2-Base-hf
- HF `Depth-Anything-V2-Large`: "License: cc-by-nc-4.0". https://huggingface.co/depth-anything/Depth-Anything-V2-Large · `-Large-hf`: "License: cc-by-nc-4.0", "0.3B params". https://huggingface.co/depth-anything/Depth-Anything-V2-Large-hf
- HF `Depth-Anything-V2-Giant`: the page did not load (fetch error). This is consistent with the README's "Coming soon". https://huggingface.co/depth-anything/Depth-Anything-V2-Giant
- Metric checkpoints: `Metric-Hypersim-Small`, `Metric-VKITTI-Small`, `Metric-Hypersim-Large` and `Metric-VKITTI-Base` all show "License: apache-2.0". `Metric-Indoor-Small-hf` shows no licence tag. URLs: https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small, https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small, https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Large, https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Base, https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf. The metric README says: "We provide **six metric depth models** of three scales for indoor and outdoor scenes, respectively." (copy of the upstream `metric_depth/README.md`: https://huggingface.co/spaces/svjack/GenStereo/blob/33fb6984a5ef245eb4cfcc65db77c12676c1d84c/extern/DAM2/metric_depth/README.md. The GitHub tree page was blocked by robots.)
- `onnx-community/depth-anything-v2-small`: "License: apache-2.0". File list: model.onnx 99.1 MB, model_fp16.onnx 49.6 MB, model_int8.onnx 27.3 MB, model_q4.onnx 27.4 MB, model_q4f16.onnx 19.1 MB, model_bnb4.onnx 26.1 MB. https://huggingface.co/onnx-community/depth-anything-v2-small and https://huggingface.co/onnx-community/depth-anything-v2-small/tree/main/onnx
- DA-V2 paper: "our models produce affine-invariant inverse depth" (§5.2); "Since our model predicts affine-invariant inverse depth" (§7.2); "five precise synthetic datasets (595K images)"; "eight large-scale pseudo-labeled real datasets (62M images)". Figure 6 notes that "the sky should be ultra far". https://arxiv.org/html/2406.09414v2
- Depth Anything 3 GitHub: sidebar "Apache-2.0 license". The model table lists CC BY-NC 4.0 for DA3NESTED-GIANT-LARGE, DA3-GIANT and DA3-LARGE, and Apache 2.0 for DA3-BASE, DA3-SMALL, DA3METRIC-LARGE and DA3MONO-LARGE. News: "14-11-2025: Paper, project page, code and models are all released." https://github.com/ByteDance-Seed/Depth-Anything-3
- DA3 HF cards: https://huggingface.co/depth-anything/DA3-SMALL ("License: apache-2.0"; "Public academic datasets only"), https://huggingface.co/depth-anything/DA3MONO-LARGE ("relative monocular depth estimation"; "directly predicts depth"), https://huggingface.co/depth-anything/DA3METRIC-LARGE ("Canonical metric depth"; "multiplying by focal length gives metric depth"), https://huggingface.co/depth-anything/DA3-BASE/blob/main/README.md ("license: apache-2.0").
- Apple Depth Pro GitHub README: "This sample code is released under the LICENSE terms." / "The model weights are released under the LICENSE terms." https://github.com/apple/ml-depth-pro. The LICENSE file's grant reads "personal, non-exclusive license", and its closing clause says "no other rights or licenses, express or implied, are granted by Apple herein" (no patent licence). https://github.com/apple/ml-depth-pro/blob/main/LICENSE
- Apple Depth Pro HF weights: "License: apple-amlr". The LICENSE file in the weights repo begins "Disclaimer: IMPORTANT: This Apple Machine Learning Research Model is" and contains "exclusively for Research Purposes." and "“Research Purposes” does not include any commercial exploitation, product development" / "or use in any commercial product or service." https://huggingface.co/apple/DepthPro and https://huggingface.co/apple/DepthPro/blob/main/LICENSE. The `-hf` card lists both "apple-amlr" and "Apple-ASCL". https://huggingface.co/apple/DepthPro-hf
- Marigold GitHub: "This code of this work is licensed under the Apache License, Version 2.0" and "The models are licensed under RAIL++-M License". https://github.com/prs-eth/Marigold · HF v1-1 "openrail++", "CreativeML Open RAIL++-M License": https://huggingface.co/prs-eth/marigold-depth-v1-1 · HF v1-0 "License: apache-2.0": https://huggingface.co/prs-eth/marigold-depth-v1-0
- MiDaS: "MIT License"; "MiDaS was trained on up to 12 datasets". https://cdn.jsdelivr.net/gh/isl-org/midas@master/README.md (jsDelivr mirror of the GitHub README; the GitHub page itself needed a permission that was denied). Paper: "a new, massive data source: 3D films". https://arxiv.org/abs/1907.01341v2
- ZoeDepth HF: "license: mit". https://huggingface.co/Intel/zoedepth-nyu/raw/52ae69caf7896c927909b3ceab4249c235e16dc1/README.md
- Metric3D: "The *Metric 3D* code is under a 2-clause BSD License." https://github.com/YvanYin/Metric3D
- UniDepth: "This software is released under Creatives Common BY-NC 4.0 license." https://github.com/lpiccinelli-eth/UniDepth
- MoGe: "MoGe code is released under the MIT license, except for DINOv2 code in `moge/model/modules/dinov2`". https://github.com/microsoft/MoGe · HF "License: mit": https://huggingface.co/Ruicheng/moge-2-vits-normal

### 1.3 Training-data caveats (DA-V2 Small)

The weights licence (Apache-2.0) is clear. The training data includes sets with restrictive terms:
- Virtual KITTI 2: "The Virtual KITTI 2 Dataset may be used for non-commercial purposes only and is subject to the" CC BY-NC-SA 3.0 licence. https://europe.naverlabs.com/proxy-virtual-worlds-vkitti-2/
- Hypersim: "The Hypersim Dataset is licensed under the Creative Commons Attribution-ShareAlike 3.0 Unported License". This was read from a fork mirror of `apple/ml-hypersim`: https://github.com/stjordanis/ml-hypersim **[upstream page not fetched]**.
- SA-1B: "It is intended to be used for computer vision research for the purposes permitted under our Data License."; licence metadata "Limited; see full license language for use". https://ai.meta.com/datasets/segment-anything/
- ImageNet-21K, LSUN, Places365 and the others: terms not checked **[unconfirmed]**.

This is a data-provenance question for the owner, not a weights-licence question (see the open questions).

### 1.4 Browser availability and speed (DA-V2 Small)

- The official README links "Transformers.js (real-time depth in web): https://huggingface.co/spaces/Xenova/webgpu-realtime-depth-estimation". That demo uses `onnx-community/depth-anything-v2-small` with a default input width of 504 px (slider 140–840, step 14). It publishes no FPS figure. https://huggingface.co/spaces/Xenova/webgpu-realtime-depth-estimation/blob/main/index.html
- A third-party write-up uses `dtype: "q4f16"` and `device: "webgpu"`, and says "There is no honest device-independent number." https://dev.to/martindelophy/building-cinematic-depth-in-the-browser-with-depth-anything-v2-small-and-webgpu-1k07
- **No published WebGPU latency with named hardware was found.** The closest published native figures are Core ML fp16 at 24.58–33.90 ms on Apple Neural Engine devices. https://huggingface.co/f-labor/coreml-depth-anything-v2-small
- **Estimate:** ViT-S at 518 px gives 37×37 = 1,369 tokens. The encoder is about 2 × 21M × 1.4k ≈ 60 GFLOP, and the DPT head adds a similar order, so roughly **60–120 GFLOP per inference**. At the 0.5–2 effective TFLOPS that ORT-Web WebGPU typically reaches, that is about **50–250 ms on integrated GPUs and 15–60 ms on discrete GPUs**, once per image (cached). This is my estimate, not a measurement. At 1,036 px input (for better edges), tokens rise 4× and attention cost rises faster, so expect roughly **5× slower**.

### 1.5 Apple patent US 10,410,327 (facts only)

| Field | Fact (Google Patents) |
|---|---|
| Title | "Shallow depth of field rendering" |
| Assignee | Apple Inc |
| Inventors | Richard D. Seely, Michael W. Tao, Alexander Lindskog, Geoffrey T. Anneheim |
| Application | US 15/990,154, filed 2018-05-25; priority 2017-06-02; published as US20180350043A1 |
| Granted | 2019-09-10 |
| Status | "Active" (Google's assumption, not a legal conclusion). Maintenance-fee history not shown **[unconfirmed]** |
| Anticipated expiry | 2038-05-25 |
| Independent claims | 1 (storage device), 10 (imaging device), 19 (method) |
| Claim 1 (gist, with verbatim fragments) | "obtain a first image"; "obtain a first blur map, wherein the first blur map comprises a plurality of blur values," "each blur value corresponding to a pixel"; for each pixel, "select a second plurality of candidate pixels surrounding the respective pixel" and "compute a blurred value ... based, at least in part, on a weighted combination of one or more characteristics of each of the second plurality of candidate pixels," "wherein one of the one or more characteristics ... is based on the respective candidate pixel's corresponding blur value in the first blur map"; "generate a blurred version of the first image". Random sampling ("generate a random distribution of pixel locations") appears in dependent claim 3, not claim 1. Claim 1 mentions neither gamma nor highlights. |

Source: https://patents.google.com/patent/US10410327B2/en. No legal opinion is given. The owner may want counsel to compare the chosen renderer (section 3) against claim 1.

---

## 2. The depth-to-blur maths

### 2.1 Thin-lens circle of confusion

Notation: focal length *f*, f-number *N*, aperture diameter *A = f/N*, focus distance *z_f*, object distance *z*, all in metres.

The thin-lens equation 1/f = 1/z + 1/v gives the image distance v = f·z/(z − f). A point at *z* focuses at *v*, but the sensor sits at *v_f*. By similar triangles, the blur disc on the sensor has diameter

  c = A · |v − v_f| / v.

Substituting and simplifying gives the standard result:

  c = A · f · |z − z_f| / ( z · (z_f − f) ).

Now note that |z − z_f| / z = z_f · |1/z_f − 1/z|. So

  **c = [ A · f · z_f / (z_f − f) ] · | 1/z − 1/z_f |  ≡  K · | δ − δ_f |**, where δ = 1/z (disparity, or inverse depth).

For z_f ≫ f, K ≈ f²/N. In pixels, divide by the pixel pitch. Two consequences:
1. **CoC is linear in inverse depth.** It is zero at the focus plane and grows on both sides. A point in front (δ > δ_f) and a point behind (δ < δ_f) get the same blur when they are equally far from the focus plane *in disparity*.
2. **Blur at infinity is finite:** as z → ∞, δ → 0 and c → K·δ_f = A·f/(z_f − f). Real backgrounds stop getting blurrier beyond a certain distance, and disparity reproduces this automatically. Foreground blur, by contrast, grows without limit as z → 0.

Published sources using the same form:
- MPIB (ECCV 2022): the blur radius is "r = A|1/z − 1/z_f| = A|d − d_f|" (Eq. 1); "We replace the depth z with the disparity (inverse depth) d to simplify the formula."; "A reflects the overall blur amount of the image". https://ar5iv.labs.arxiv.org/html/2207.08403
- BokehMe (CVPR 2022): "As discussed in [31, 38], given the disparity d of a pixel, its blur radius can be calculated by" r = K|d − d_f| (Eq. 1); "K reflects the blur amount of the whole image." The authors run it on estimated disparity: "imperfect disparity maps predicted by DPT", and "The disparity maps of all datasets are normalized to [0, 1] range." https://openaccess.thecvf.com/content/CVPR2022/papers/Peng_BokehMe_When_Neural_Rendering_Meets_Classical_Rendering_CVPR_2022_paper.pdf
- BokehMe code parameters: `disp_focus` "refocused disparity (range from 0 to 1)", `K` "blur parameter". https://github.com/JuewenPeng/BokehMe
- GPU Gems 3, ch. 28, uses the thin-lens CoC for games: "The thin lens equation relates an object's distance from the lens". https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-28-practical-post-process-depth-field
- Blender's Defocus node: "This option controls the amount of focal blur in the same way as a real camera." and "Half the value will double the amount of blur." (that is, c ∝ 1/N). https://docs.blender.org/manual/es/3.3/compositing/types/filter/defocus.html

### 2.2 From affine-invariant inverse depth to CoC (why the shift cancels)

DA-V2 outputs **d = a·δ + b** with unknown *a > 0* and *b* per image ("affine-invariant inverse depth", see 1.2). Then δ = (d − b)/a, so

  |δ − δ_f| = |(d − b) − (d_f − b)| / a = |d − d_f| / a

and

  **c = (K / a) · | d − d_f |  =  S · | d − d_f |.**

- **The shift b cancels exactly.** Choosing the focus plane by picking d_f = d(click) needs no metric information.
- **The scale a is unknown,** so physical K cannot be recovered. It merges into one user-facing **strength S** (the "Amount/Aperture" slider). This is what BokehMe's *K* and MPIB's *A* are.
- **Signed CoC:** s = S·(d − d_f) is positive for foreground and negative for background. The renderer needs this sign to decide occlusion order (section 3).
- **Focus range (depth of field):** a real lens treats as sharp everything with c ≤ c₀ (acceptable CoC). That gives |δ − δ_f| ≤ c₀/K, a band **symmetric in disparity**. In metric depth the same band reaches further behind the subject than in front, which matches real lens behaviour. So a "focus range" control should be a band in disparity: c = S·max(0, |d − d_f| − w). Lightroom's "Focus range slider" and the dev.to implementation (`Math.max(0, distance - focusRange) * lensBlur`) both use a dead-zone of this kind. Note that a hard dead-zone has a kink at the band edge. A smooth ramp, for example a soft-threshold over a few percent of the band, looks more lens-like **[design suggestion]**.

### 2.3 Caveats

1. **The outputs are not exactly affine in disparity.** "Affine-invariant" describes the training loss. Monocular networks compress far-range structure and make mistakes on low-texture regions, glass, mirrors and reflections, so |d − d_f| is only approximately proportional to true |δ − δ_f| **[general property; no DA-V2-specific error figure found]**. A *refine-depth brush* is the escape hatch.
2. **Sky and infinity.** The DA-V2 paper says "the sky should be ultra far" and shows earlier failures on sky. With the disparity mapping, sky at d ≈ d_min receives the *finite, maximum background blur*, which is physically correct. Clamp d below at a low percentile so that noisy near-zero values do not create blur variation inside the sky.
3. **Per-image scale.** Because *a* changes per image, the same S gives different blur on different photos. Normalise first: d̂ = (d − d_lo)/(d_hi − d_lo), using robust percentiles (for example 1st and 99th) **[design suggestion]**. Then define S as "maximum CoC as a percentage of the image's long edge at the far end". This also keeps edits resolution-independent: compute CoC as a fraction of image width and convert to pixels at render time, which matters for previews against exports.
4. **The sign convention must be checked.** Inverse depth means larger = nearer. Confirm the transformers.js `predicted_depth` output follows this and is not re-normalised before use **[unconfirmed]**.
5. **Resolution.** DA-V2 runs at about 518 px on the short side, so the depth map must be upsampled with edge awareness (section 4).
6. **f-number labels.** A true f-number needs *a* (metric depth) plus the focal length and sensor size (from EXIF). With relative depth, an "f/" label would be cosmetic.

### 2.4 Is metric depth needed?

**No, not for correct depth-graded blur.** Thin-lens blur depends only on the *difference in inverse depth* from the focus plane, times one global constant. An affine inverse-depth map keeps that difference up to that constant, which the user sets anyway. Metric depth would only add:
- (a) an honest *f-number* label on the slider, if the focal length and sensor size are also known from EXIF;
- (b) more consistent blur between photos.

Benefit (b) can be approximated by percentile normalisation. The permissive metric options are DA3METRIC-LARGE (0.35B, Apache-2.0, needs the focal length) and MoGe-2 (MIT). They are much heavier than DA-V2 Small (except MoGe-2 ViT-S, 35M) and lack browser benchmarks. The DA-V2 metric checkpoints are not recommended (see 1.1). Recommendation: **relative depth (DA-V2 Small) now; treat metric as optional later.**

---

## 3. Rendering methods

### 3.1 Table: rendering methods

| Method | How it works | Partial occlusion | Bokeh shapes | Browser cost | Open implementations / licence | Notes |
|---|---|---|---|---|---|---|
| **Scatter** (splat each pixel's CoC disc) | Each pixel writes its disc into an accumulation buffer, normalised by weight | Natural (front discs draw over) | Any sprite shape | Very high at large CoC (overdraw ∝ r²); WebGPU has no float atomics for colour, so needs sprite rasterisation | BokehMe's classical renderer: "The core idea of this method is scattering each pixel to its neighbor areas"; Apache-2.0 (https://github.com/JuewenPeng/BokehMe) | GPU Gems: "This selectively sized smearing is a scattering operation, which doesn't map well to modern GPUs." |
| **Gather** (per-pixel variable kernel) | Each output pixel reads neighbours within its own CoC | Poor: "it retained objectionable discontinuities between nearby unfocused pixels and more-distant focused pixels" (GPU Gems) | Any sampled shape | O(samples) per pixel; good for preview | GPU Gems 3 ch. 28 | Sharp foreground haloes; "focused objects will bleed onto unfocused background objects" |
| **Scatter-as-gather** (gather, but weight each neighbour by whether *its* CoC reaches this pixel) | Tile max-CoC plus per-sample weights | Good with near/far separation | Sampled shapes | Medium | Jimenez 2014 (CoD:AW): "scatter-as-you-gather approaches can be leveraged for trying to approximate ground truth algorithms" (https://www.iryoku.com/?p=1707) | **Closest to the element recited in US 10,410,327 claim 1** (weights based on the candidate pixel's blur value). Fact only |
| **Layered / depth-sliced** (MPI) | Slice into N disparity layers with pre-multiplied alpha; blur each layer with a fixed kernel; composite back to front with "over" | Good: front layers blur *over* sharp layers behind | Per-layer kernel, so any shape (including FFT) | N × (one fixed blur). Cost scales with N, not per-pixel CoC | **MPIB**: "The number of MPI planes is set to 32."; composited "with a back-to-front order"; Apache-2.0 (https://github.com/JuewenPeng/MPIB); weights' licence not stated | Layer seams if N is small; needs hidden-background fill |
| **Neural refinement** (BokehMe ARNet/IUNet; MPIB networks) | Classical render plus a learned fix at depth edges | Learned | Fixed | Extra network inference | BokehMe Apache-2.0 (LICENSE: "Apache License", "Version 2.0, January 2004"); **weights' licence not separately stated, and training data not checked [unconfirmed]** | Optional later |
| **Separable disc (Garcia)** | Complex-valued 1D kernels whose sum ≈ disc: "convolves a circular pattern blur in the frequency domain using a horizontal and a vertical pass" | n/a (a kernel, used inside layers) | **Disc only** | ~4 × (2r+1) taps per pixel for 2 components | Garcia, SIGGRAPH 2017 Talk (https://history.siggraph.org/wp-content/uploads/2022/09/2017-Talks-Garcia_Circular-Separable-Convolution-Depth-of-Field.pdf); explainer: https://bartwronski.com/2017/08/06/separable-bokeh/ (no code licence stated) | "Version with a single component produces quite strong ringing" (Wroński); "Precision bit issues could occur due to large and negative values" (Garcia). Fixed radius per pass, so it suits a layered renderer |
| **FFT convolution per layer** | Multiply the layer spectrum by the kernel spectrum | n/a | **Any shape**, including measured or cat's-eye shapes | O(P log P) per layer, independent of radius | General technique (WebGPU FFT implementations exist **[none verified here]**) | Good for full-resolution export with large radii |

### 3.2 Scene-linear highlight bokeh

- BokehMe and Blender work on display-referred images and add gamma hacks. BokehMe: "γ, used in gamma correction, controls the brightness and salience of bokeh balls."; "given a 8-bit digital image where bright lights exist in the scene, the gamma correction is insufficient"; its code adds a `highlight` option to "enhance RGB values of highlights before rendering for stunning bokeh balls". Blender: "Applies a gamma correction on the image before and after blurring it."
- **LightBench already has what those tools lack:** a scene-referred linear Rec.2020 buffer with highlight reconstruction. Blurring *in linear light before the sigmoid display transform* turns specular highlights (values > 1) into bright bokeh discs with no gamma tricks. That is the physically correct behaviour BokehMe defers to "future work" (LDR→HDR).
- **Placement in the pipeline [recommendation]:** after exposure and highlight reconstruction and before the tone equalizer and sigmoid. The depth *inference* itself should run on a display-rendered sRGB proxy (the 8-bit-like input the model was trained on), while the *blur* runs on linear data.
- A "Bokeh boost" like Lightroom's ("It lets you adjust the brightness of out-of-focus light sources in the image.") can then be a gentle gain on linear values above a threshold, applied only to out-of-focus layers.

### 3.3 Bokeh shapes and cat's-eye vignetting

- Shapes: a disc, an N-blade polygon with rotation (Blender: "The number of iris blades of the virtual camera's diaphragm."; Angle "can be used to add a rotation offset to the Bokeh shape."), a ring, a bubble, and an oval (Lightroom's list in section 5).
- Cat's eye: "Sometimes what would be a circular out of focus highlight in the center of the image has a lemon shape outside of center"; "Resulting shape is often a intersection of two non-concentric circles"; "This is caused by mechanical vignetting because the optical path in the lens is too narrow." https://jtra.cz/stuff/essays/bokeh/index.html. Lightroom: "Cat eye: Create a bokeh effect shaped by optical vignetting near the frame edges."
- **Implementation:** the kernel at image position **p** is the aperture shape intersected with a second disc offset along the radial direction by α·|p − centre|. It is position-dependent, so it does not suit FFT or separable passes, but it works directly in a *sampled gather inside each layer*: reject samples outside the intersection. Feasible in WGSL. A cheaper approximation is to split each layer into a few radial zones with pre-built kernels **[design suggestion]**.
- Polygonal shapes through separable skewed box passes (McIntosh et al. 2012) are possible **[not verified in this research]**.

---

## 4. Foreground problems and fixes

| Problem | Cause | Fix | Feasible in browser? |
|---|---|---|---|
| **Partial occlusion** (blurred foreground must spread over the sharp subject behind it) | A single-layer gather cannot see "behind" the foreground. GPU Gems: "the shader could not properly draw the scene behind any foreground objects that are blurred to transparency" | Layered rendering: put the foreground in its own pre-multiplied layer, blur it (its alpha spreads), and composite *over* the sharp layer. MPIB's abstract: "Partial occlusion effects are a phenomenon that blurry objects near a camera are semi-transparent" | **Yes.** N fixed-kernel blurs plus compositing in WGSL |
| **Hidden background** (what shows through the semi-transparent foreground edge) | Pixels behind the foreground were never captured | (a) Cheap: pull-push / mip-pyramid fill of each layer's empty region before blurring. (b) Better: inpaint the background layer under the foreground mask. MPIB: "The background inpainting module aims to synthesize convincing contents in the occluded areas", "we use LaMa as our inpainting model" | (a) **Yes**, a few ms. (b) **Yes, optional.** Reuse the Phase 4 MI-GAN / LaMa pick at 512 px, once per focus change (**estimate:** 50–300 ms) |
| **Haloes / colour bleeding** (sharp subject smears into blurred background, or background into subject) | Gather mixes pixels across depth; GPU Gems: "focused objects will bleed onto unfocused background objects" | Pre-multiplied per-layer blur, so each layer only spreads its own colour, plus normalisation by blurred alpha. Blender's Threshold exists for the same reason: "Some artifacts, like edge bleed, may occur, if the blur difference between pixels is large." | **Yes** |
| **Depth-edge errors** (depth boundary misaligned with the image edge; BokehMe: "the predicted disparity map may be blurry and not align with the RGB image at boundary") | Low-resolution network, smooth upsampling | Edge-aware upsampling of depth to full resolution, guided by the image: a joint bilateral or **guided filter** (LightBench already ports darktable's guided filter for the tone equalizer). Then *dilate the nearer depth* (max-filter on disparity) by a few px so subject edge pixels belong to the foreground or subject, not the background **[common practice; no specific source verified]** | **Yes**, cheap |
| **Hair and fine edges** | Depth nets cannot resolve strands | Use a soft subject **matte** (BiRefNet, the Phase 4 masking pick) as alpha when slicing the subject layer, so strands carry partial alpha into the in-focus layer and the background blurs behind them | **Yes**, if the matte is already computed for masking. Otherwise one extra inference |
| **Wrong depth on glass, reflections, sky holes** | Monocular ambiguity | **Refine-depth brush**: paint "nearer/farther" or "set to focus plane". Lightroom's equivalent paints *focus/blur*: "Focus lets you brush over the blurry areas of an image and bring them into focus." | **Yes.** Store strokes as vector edits |

---

## 5. UI precedents

| Product | Strength control | Focus control | Depth visualisation | Refinement | Bokeh options | Source (quoted) |
|---|---|---|---|---|---|---|
| **Apple Photos (Portrait)** | Depth Control slider: "Drag the slider left or right to adjust the background blur effect." The f-stop range "from f/1.4 to f/16" is from a **secondary source** (Format magazine); Apple's guide pages I loaded do not mention f-numbers | Changing the focus point after capture is not described on the pages I loaded **[unconfirmed]** | None | None | None | https://support.apple.com/guide/iphone/edit-portrait-mode-photos-iph310a9a220/14.0; https://support.apple.com/guide/iphone/take-portrait-mode-photos-iphd7d3a91a2/14.0 ("you can use the Depth Control slider in Photos to further adjust the background blur effect."); https://www.format.com/magazine/new-apple-iphone-xs-camera-depth-of-field-adjustment |
| **Google Photos (Portrait blur)** | Blur slider: "The blur is set to off by default, but you will see the effect applied in real-time as you move the slider." (9to5Google) | 2018 iOS version: "adjust the background blur and change the focus of your portrait mode photo" (PetaPixel, quoting Google) | None found | None found | None found | Google Help mentions only "select features like portrait blur" and "Some features are only available on Pixel." (https://support.google.com/photos/answer/6128850); https://9to5google.com/2019/12/11/google-photos-portrait-blur/; https://petapixel.com/2018/11/20/google-photos-for-ios-can-now-adjust-bokeh-in-portrait-mode-photos |
| **Lightroom / ACR Lens Blur** | "Adjust the Blur amount slider to define the intensity of the effect." | Subject: "Automatically sets the focal range using AI-powered subject detection." Point/Area: "Manually set the focal range by clicking or dragging on the photo." "Use the Focus Range to adjust the range of depth values that are in focus." | "Select Visualize Depth to view the depth map and focal range." Warm/yellow = near, cool/blue = far, white = in focus | "Select Refinement to manually refine the depth map" with "Focus" and "Blur" brushes ("Amount, Brush Size, Feather, and Flow") | Circle, Bubble, 5-blade, Ring, Oval, Cat eye; "Bokeh Boost: It lets you adjust the brightness of out-of-focus light sources in the image." Supports "Device Depth for images like .HEIC that already has a depth map." | https://helpx.adobe.com/lightroom-cc/using/lens-blur.html; https://helpx.adobe.com/sa_ar/camera-raw/desktop/edit-and-enhance-images/sharpening-and-noise/lens-blur.html |
| **Photoshop Depth Blur (Neural Filter)** | `slideAperture` "Blur strength", "Higher values create more blur" (0–100) | `slideFocalDist` "Where the focus point is"; `slideFocalRange` "Size of the focused area"; `selectSubjectUsage` subject mode | Not in the API docs | Not in the API docs | Haze, warmth, tint, saturation, brightness, grain | https://developer.adobe.com/firefly-services/docs/photoshop/guides/photoshop-v2/v1-to-v2/convenience-apis/depth-blur (API docs, not the desktop help page) |
| **Blender Defocus node** | F-Stop: "controls the amount of focal blur in the same way as a real camera"; Max Blur "limits the amount of blur" | Camera focal distance (scene) | Preview | n/a | Bokeh Type (blade count), Angle, Gamma Correction. "Keep in mind that this is not real DoF, only a post-processing simulation." | https://docs.blender.org/manual/es/3.3/compositing/types/filter/defocus.html (the current 5.2 page loaded without body text) |

**Takeaways for LightBench:** Lightroom's set (Amount, Subject/Point focus, Focus range, Visualize Depth, Refine brushes, shape list with Boost) matches the owner's list almost exactly, so it is the model to follow. Two places LightBench can do better: (1) refine *depth* (nearer/farther), not just *blur/focus*, so that the gradation stays consistent; (2) scene-linear highlights, so Boost is rarely needed.

---

## 6. Recommendations

1. **Model:** DA-V2 Small (`onnx-community/depth-anything-v2-small`), fp16 where `shader-f16` is available, with q4f16 or int8 as a fallback. Run it at 518 px for previews, with an optional "high-detail depth" at about 1,036 px. Evaluate **DA3MONO-LARGE** (Apache-2.0) as an optional HQ download later. Note that it outputs depth, so invert it to disparity.
2. **Depth-to-blur mapping:**
   - d̂ = percentile-normalised disparity;
   - signed CoC s = S·(d̂ − d̂_f), with a soft dead-zone of width *w* (the focus range);
   - CoC is stored as a fraction of the image's long edge, so preview and export match;
   - a max-blur clamp, as in Blender.
3. **Rendering (process version 1):** a layered renderer in scene-linear Rec.2020.
   - **Layers:** 8–16 disparity slices with soft (triangular) slice weights, to avoid seams.
   - **Per-layer blur:** pre-multiplied, at reduced resolution for large radii (mip level chosen per layer).
   - **Kernel:** a sampled-shape gather inside each layer for preview, which also allows cat's-eye; optional FFT per layer at export for large radii.
   - **Compositing:** back to front with "over".
   - This approach weights by *layer*, not per-candidate-pixel blur value. The owner may want counsel to compare it against US 10,410,327 claim 1 (facts in 1.5).
4. **Foreground handling:**
   - guided-filter upsampling plus near-depth dilation;
   - pull-push fill behind the foreground (on by default);
   - optional MI-GAN fill ("High quality occlusion");
   - BiRefNet matte for the subject layer when available.
5. **Controls:**
   - **Amount** (strength);
   - **Focus**: Subject (median disparity inside the BiRefNet mask or largest face) or Point (median disparity in a small window around the click; click-drag selects an area);
   - **Focus range**;
   - **Visualize depth** (near warm / far cool / in-focus white, as Lightroom does);
   - **Refine depth** brush (nearer / farther / set to focus, with size, feather and flow);
   - **Bokeh**: shape (Disc, 5/6/8-blade with rotation, Ring, Cat's eye amount) and Boost.
   - Show "f/" labels only if metric depth and EXIF are available; otherwise call the control "Amount".
6. **Edit stability:** store the depth map (for example 16-bit PNG/AVIF at the inference resolution) plus the model id and version *with the edit or catalog*. ORT-Web WebGPU results may differ slightly between GPUs and drivers **[unconfirmed for this model; true of GPU float maths in general]**, and the owner's rule is that old edits never change. Store brush strokes as vectors. Version the renderer under process versions.
7. **Device depth:** like Lightroom's "Device Depth", read embedded HEIC/ProRAW depth or disparity when present and offer it as the depth source **[format details not researched here; see Part 3 masking for ProRAW mattes]**.

### Estimated browser cost (all **estimates**, my reasoning, not measurements)

| Step | When | Integrated GPU | Discrete GPU | Reasoning |
|---|---|---|---|---|
| Model download | Once | 19–50 MB | same | ONNX file sizes above |
| Depth inference, 518 px | Once per image (cached) | ~50–250 ms | ~15–60 ms | ~60–120 GFLOP at 0.5–2 TFLOPS effective |
| Depth inference, 1,036 px | Optional | ~0.3–1.5 s | ~80–300 ms | ~5× tokens/attention |
| Guided upsampling + dilation | Per image / per refine stroke | ~5–20 ms | ~2–5 ms | Box-filter passes on full-res preview |
| Layered blur, 2 MP preview, 12 layers, ≤40 px CoC | Per slider move | ~30–120 ms | ~8–30 ms | Large radii are done at ½ or ¼ resolution, so cost is roughly 12 × (64–128 samples) at reduced resolution |
| Layered blur, 24 MP export, ≤150 px CoC | On export | ~1–5 s | ~0.2–1 s | Same method at full resolution with mip levels, or FFT per layer |
| MI-GAN background fill, 512 px | Optional, per focus change | ~100–300 ms | ~30–100 ms | Similar-size GAN; see Part 3 |

---

## 7. Exclusions (with quotes)

| Excluded | Why | Quote and URL |
|---|---|---|
| DA-V2 Base, Large, Giant | Non-commercial | "Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license." https://github.com/DepthAnything/Depth-Anything-V2 |
| DA-V2 metric checkpoints | Conflicting licence information; trained on NC data | HF tags "License: apache-2.0" on all metric sizes, including Large, while the GitHub README calls Large "CC-BY-NC-4.0" and gives no metric-specific licence. VKITTI2: "may be used for non-commercial purposes only" (https://europe.naverlabs.com/proxy-virtual-worlds-vkitti-2/) |
| DA3-LARGE, DA3-GIANT, DA3NESTED | Non-commercial | GitHub model table: CC BY-NC 4.0. https://github.com/ByteDance-Seed/Depth-Anything-3 |
| Apple Depth Pro | Research-only weights on HF; conflicting with GitHub | "exclusively for Research Purposes."; "“Research Purposes” does not include any commercial exploitation, product development". https://huggingface.co/apple/DepthPro/blob/main/LICENSE |
| UniDepth v1/v2 | Non-commercial | "This software is released under Creatives Common BY-NC 4.0 license." https://github.com/lpiccinelli-eth/UniDepth |
| Marigold | RAIL (use-restricted) and diffusion-sized | "The models are licensed under RAIL++-M License". https://github.com/prs-eth/Marigold |
| Metric3D v2 (on hold, not excluded) | Weights licence not stated; commercial use referred to the author | "For further commercial inquiries, please contact Dr. Wei Yin". https://github.com/YvanYin/Metric3D |

---

## 8. Open questions for the owner

1. **Training data:** DA-V2 Small's weights are Apache-2.0, but it was partly trained on datasets marked non-commercial or research-only (Virtual KITTI 2, SA-1B). Is a permissive *weights* licence enough for you, or do you also want permissive *training data*? If the second, almost no modern depth model qualifies.
2. **f-number labels:** with relative depth, the slider can't honestly say "f/2.8". Is a plain "Amount" slider acceptable, or do you want real f-numbers? Those would need a heavier metric-depth model plus EXIF.
3. **Optional HQ model:** would you offer a bigger optional download (DA3MONO-LARGE, about 0.35B parameters, Apache-2.0, likely 350–700 MB) for better depth on fast GPUs?
4. **Saving depth with edits:** may LightBench save the depth map (about 0.2–1 MB) inside the edit or catalog? That guarantees old edits look the same on any GPU.
5. **Background fill:** should the "fill behind blurred foreground" step use AI (MI-GAN, labelled as generated), or a simple non-AI fill by default?
6. **Patent:** Apple's US 10,410,327 is listed as active until about 2038. Do you want legal review of the chosen renderer before release?
7. **Phone depth:** should LightBench use the depth maps that iPhones and other phones embed in their photos, when present, instead of running AI?

---

## 9. Items I could not verify

- A published **browser (WebGPU) latency for DA-V2 Small with named hardware**: none found. Only native Core ML numbers were found.
- **DA-V2 Giant** HF page: did not load (unreleased per the README).
- **DA-V2 metric licences**: sources conflict (see 1.1).
- **Depth Pro**: the GitHub and HF licences conflict. I report both.
- **Apple Photos f-number range and post-capture focus change**: Apple pages I loaded mention only the Depth Control slider. The f/1.4–f/16 range comes from a secondary source.
- The **Google Photos** current help page does not describe the blur or focus controls. Details come from secondary sources.
- **Blender 5.2 manual** loaded without body text, so I quoted the 3.3 manual.
- BokehMe and MPIB **weights licences** are not stated separately from the Apache-2.0 repos. Their training data was not checked.
- The **GitHub tree page** for DA-V2 `metric_depth` was blocked by robots. A Space copy of the README was used.
- The MiDaS GitHub page needed a permission that was denied, so the jsDelivr mirror of its README was used.
- `gh api` access to GitHub was not enabled in this session, so LICENSE files were read through web pages.

---

## Sources

- Depth Anything V2 GitHub: https://github.com/DepthAnything/Depth-Anything-V2 · README mirror: https://cdn.jsdelivr.net/gh/depthanything/depth-anything-v2@main/README.md
- DA-V2 metric README copy: https://huggingface.co/spaces/svjack/GenStereo/blob/33fb6984a5ef245eb4cfcc65db77c12676c1d84c/extern/DAM2/metric_depth/README.md
- HF DA-V2: https://huggingface.co/depth-anything/Depth-Anything-V2-Small · https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf · https://huggingface.co/depth-anything/Depth-Anything-V2-Base · https://huggingface.co/depth-anything/Depth-Anything-V2-Base-hf · https://huggingface.co/depth-anything/Depth-Anything-V2-Large · https://huggingface.co/depth-anything/Depth-Anything-V2-Large-hf
- HF DA-V2 metric: https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small · https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small · https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Large · https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Base · https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf
- ONNX: https://huggingface.co/onnx-community/depth-anything-v2-small · https://huggingface.co/onnx-community/depth-anything-v2-small/tree/main/onnx
- DA-V2 paper: https://arxiv.org/html/2406.09414v2
- Demos and speed: https://huggingface.co/spaces/Xenova/webgpu-realtime-depth-estimation/blob/main/index.html · https://dev.to/martindelophy/building-cinematic-depth-in-the-browser-with-depth-anything-v2-small-and-webgpu-1k07 · https://huggingface.co/f-labor/coreml-depth-anything-v2-small · https://www.huggingface.co/blog/transformersjs-v3
- Depth Anything 3: https://github.com/ByteDance-Seed/Depth-Anything-3 · https://huggingface.co/depth-anything/DA3-SMALL · https://huggingface.co/depth-anything/DA3-BASE/blob/main/README.md · https://huggingface.co/depth-anything/DA3MONO-LARGE · https://huggingface.co/depth-anything/DA3METRIC-LARGE · https://huggingface.co/onnx-community/depth-anything-v3-small · https://huggingface.co/en970/depth-anything-v3-small-onnx
- Apple Depth Pro: https://github.com/apple/ml-depth-pro · https://github.com/apple/ml-depth-pro/blob/main/LICENSE · https://huggingface.co/apple/DepthPro · https://huggingface.co/apple/DepthPro/blob/main/LICENSE · https://huggingface.co/apple/DepthPro/tree/main · https://huggingface.co/apple/DepthPro-hf · https://huggingface.co/onnx-community/DepthPro-ONNX · AMLR definition also at https://huggingface.co/apple/TiC-CLIP-basic-oracle/commit/a12989029b106f93ed5652cbeaca0b3c4dd34e74
- MiDaS: https://cdn.jsdelivr.net/gh/isl-org/midas@master/README.md · https://huggingface.co/Intel/dpt-swinv2-tiny-256/blob/main/README.md · https://arxiv.org/abs/1907.01341v2
- ZoeDepth: https://huggingface.co/Intel/zoedepth-nyu/raw/52ae69caf7896c927909b3ceab4249c235e16dc1/README.md
- Metric3D: https://github.com/YvanYin/Metric3D
- UniDepth: https://github.com/lpiccinelli-eth/UniDepth
- MoGe: https://github.com/microsoft/MoGe · https://huggingface.co/Ruicheng/moge-2-vits-normal · https://huggingface.co/lyonsno/moge-webgpu
- Marigold: https://github.com/prs-eth/Marigold · https://huggingface.co/prs-eth/marigold-depth-v1-1 · https://huggingface.co/prs-eth/marigold-depth-v1-0
- Datasets: https://europe.naverlabs.com/proxy-virtual-worlds-vkitti-2/ · https://github.com/stjordanis/ml-hypersim (fork mirror) · https://ai.meta.com/datasets/segment-anything/
- Patent: https://patents.google.com/patent/US10410327B2/en
- BokehMe: https://github.com/JuewenPeng/BokehMe · https://github.com/JuewenPeng/BokehMe/blob/main/LICENSE · https://openaccess.thecvf.com/content/CVPR2022/papers/Peng_BokehMe_When_Neural_Rendering_Meets_Classical_Rendering_CVPR_2022_paper.pdf
- MPIB: https://ar5iv.labs.arxiv.org/html/2207.08403 · https://github.com/JuewenPeng/MPIB
- Garcia separable bokeh: https://history.siggraph.org/wp-content/uploads/2022/09/2017-Talks-Garcia_Circular-Separable-Convolution-Depth-of-Field.pdf · https://bartwronski.com/2017/08/06/separable-bokeh/
- GPU Gems 3 ch. 28: https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-28-practical-post-process-depth-field
- Jimenez 2014: https://www.iryoku.com/?p=1707
- Cat's eye: https://jtra.cz/stuff/essays/bokeh/index.html
- Apple: https://support.apple.com/guide/iphone/edit-portrait-mode-photos-iph310a9a220/14.0 · https://support.apple.com/guide/iphone/take-portrait-mode-photos-iphd7d3a91a2/14.0 · https://www.format.com/magazine/new-apple-iphone-xs-camera-depth-of-field-adjustment
- Google: https://support.google.com/photos/answer/6128850 · https://9to5google.com/2019/12/11/google-photos-portrait-blur/ · https://petapixel.com/2018/11/20/google-photos-for-ios-can-now-adjust-bokeh-in-portrait-mode-photos
- Adobe: https://helpx.adobe.com/lightroom-cc/using/lens-blur.html · https://helpx.adobe.com/sa_ar/camera-raw/desktop/edit-and-enhance-images/sharpening-and-noise/lens-blur.html · https://developer.adobe.com/firefly-services/docs/photoshop/guides/photoshop-v2/v1-to-v2/convenience-apis/depth-blur
- Blender: https://docs.blender.org/manual/es/3.3/compositing/types/filter/defocus.html

---

## LightCraft notes (added 2026-10-13, Part 1 researcher)

LightCraft (storytold/lightcraft) is a Rust raw editor that claims Lightroom parity. Licence: MIT OR Apache-2.0. Read from `master`, workspace v0.7.1; commit hash not visible.

**Lens blur is not implemented:**
- parity.md, `LR-EDIT-LENSBLUR` "Lens blur": P2, ⬜, note "settings field reserved, not rendered".
- parity.md, `LR-MASK-DEPTHRANGE` "Depth range": ⬜, note "shape exists, needs depth data".
- Code: `crates/develop/src/settings.rs` has a `LensBlur` struct with `enabled`, `amount`, `focal_distance` and `focal_range` (defaults false/0). It has no doc comments. No lens-blur rendering was found in `crates/pipeline/src/finish.rs`.
- **No depth model** is named anywhere in the files read (README, parity.md, ROADMAP, docs/ai-masks.md, NOTICE).
- ROADMAP lists "AI denoise, super resolution, lens blur, generative remove" as one future AI package, estimated at 80–150 agent-hours with high risk.
- **Takeaway:** LightCraft offers no precedent or code for Part 4. Its settings fields (amount, focal distance, focal range) are a minimal Lightroom-like shape that LightBench already exceeds in scope (foreground/background grading, bokeh shapes, refine brush).

Sources:
- https://raw.githubusercontent.com/storytold/lightcraft/master/docs/parity.md
- https://raw.githubusercontent.com/storytold/lightcraft/master/crates/develop/src/settings.rs
- https://raw.githubusercontent.com/storytold/lightcraft/master/crates/pipeline/src/finish.rs
- https://raw.githubusercontent.com/storytold/lightcraft/master/ROADMAP.md
