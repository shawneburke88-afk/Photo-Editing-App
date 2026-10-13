# AI depth of field (lens blur) for LightBench: depth grading

**Prepared for:** Shawn Burke (LightBench) · **Research date:** 2026-10-13 · **Part of:** [PHASE4_MODELS.md](PHASE4_MODELS.md)
(section 2) · **Rules:** permissive licences only; local, in-browser; anything not checked at its source is marked
**(unverified)**; estimates are marked **(estimate)**.

**The owner's goal (2026-10-12/13):** *depth grading*. Blur grows with distance from the chosen focus plane, **in front of
it and behind it**, rather than "sharp subject, blurred everything else". The controls asked for are:
- **strength**;
- **click to set the focus point**, plus a **focus range**;
- **auto focus on the detected subject**;
- a **refine-depth brush** (hair, glass, fences);
- **bokeh shapes** (round, cat's-eye, aperture-blade polygon).

**Contents:** [Summary](#summary) · [1. Depth and the focus scale](#1-the-depth-model-and-a-usable-focus-distance-scale) ·
[2. Rendering](#2-rendering-depth-graded-bokeh) · [3. Foreground problems](#3-foreground-problems-and-how-published-methods-handle-them) ·
[4. UI precedents](#4-ui-precedents) · [5. Recommendation](#5-recommended-approach-for-lightbench) ·
[Sources and access](#sources-and-what-could-not-be-read)

---

## Summary

1. **Relative depth is enough, provably, for depth grading.** For a thin lens, the blur-circle diameter is *linear in
   inverse depth* (disparity): `c = C · |d − d_f|`, where `d = 1/z` (derivation in §1.2). BokehMe and MPIB use exactly
   `r = K · |d − d_f|`. Depth Anything V2 Small predicts relative inverse depth, which is assumed to be the true
   disparity up to an unknown scale and shift. **The shift cancels in `d − d_f`, and the scale folds into the strength
   slider.** No metric-depth model is needed.
   - The formula grows blur in front of the focus plane **and** behind it.
   - Background blur levels off towards infinity, while foreground blur keeps growing as objects get closer. Real lenses
     behave the same way.
2. **Model:** keep **Depth Anything V2 Small**.
   - Licence: "Depth-Anything-V2-Small model is under the Apache-2.0 license" ([README](https://github.com/DepthAnything/Depth-Anything-V2#license)).
   - Size: 24.8 M parameters (fp16 ≈ 50 MB, estimate).
   - Browser: official transformers.js WebGPU demo.
   - Metric checkpoints aren't needed. Every metric option either has unclear weights terms or non-commercial training
     data, or is far too big for a browser (§1.3).
3. **Rendering:** layered (depth-sliced) compositing in **scene-linear** light.
   - Each slice is blurred with a fixed-size aperture kernel, then the slices are composited from back to front with
     **normalised** alpha. This is MPIB's formulation (Apache-2.0 code).
   - The layering handles both haloes and partial occlusion, which a per-pixel gather (e.g. Blender's Defocus node) gets
     wrong at depth edges.
   - Because a slice has one blur radius, its blur is a fixed-kernel convolution. That allows separable, pyramid or FFT
     tricks on the GPU.
4. **Foreground:**
   - **Normalised convolution** of each layer keeps colours from bleeding into the subject's edges, with no model.
   - The **subject mask** (from the section 3 masking model) gives the subject a soft alpha for hair.
   - **Inpainting** (MI-GAN, already proposed for Remove) fills background hidden behind a strongly blurred foreground
     object, as MPIB does with LaMa. It is optional.
   - The depth map is **refined with an edge-aware filter**: LightBench already has darktable's EIGF guided filter in WGSL
     for the tone equalizer.
5. **Controls:** Lightroom's Lens Blur is the closest precedent. Its controls, from Adobe's help as quoted in search
   results (unverified), are:
   - Blur Amount;
   - Focus Range, either Subject Focus or Point/Area;
   - bokeh Circle / Bubble / 5-Blade / Ring / Cat Eye;
   - Boost;
   - Visualize Depth;
   - a Refine Depth brush with Focus and Blur modes.

   All of the owner's controls fit this pattern (§5).
6. **Patents (facts only, no conclusion):** Apple holds US patents titled "Shallow depth of field rendering"
   (US 10,410,327 B2), "Highlight recovery techniques for shallow depth of field rendering" (US 10,992,845 B1) and
   others in this area, per Google Patents search results. Their claims were **not read**. See §2.6.

---

## 1. The depth model and a usable focus-distance scale

### 1.1 What Depth Anything V2 Small outputs

- The README describes the four models as being "for robust relative depth estimation" ([README](https://github.com/DepthAnything/Depth-Anything-V2), line 35).
  The official transformers.js demos display the output as a map where nearer is brighter.
- That the output is **affine-invariant inverse depth** (disparity up to an unknown scale and shift) is how the Depth
  Anything papers describe their relative models, following MiDaS. **(Unverified here:** arXiv was blocked, so the papers
  weren't re-read.) BokehMe's authors feed MiDaS/DPT disparity straight into `r = K|d − d_f|`
  ([BokehMe README](https://github.com/JuewenPeng/BokehMe)), which is the same assumption.
- **Licence by checkpoint**, quoted from the README: "Depth-Anything-V2-Small model is under the Apache-2.0 license.
  Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license." Small is the only usable one.

### 1.2 From disparity to a blur circle (thin lens)

This is a standard derivation (Potmesil & Chakravarty 1981, as cited and implemented in Blender's Defocus node; see
`node_composite_defocus.cc`, equations (7) and (8), lines 356–370 at commit `37d63d7`).

Terms: a lens of focal length `f` and f-number `N` (aperture diameter `A = f/N`) is focused at distance `z_f`. A point at
distance `z` images to a blur circle of diameter

```
c = A · f · |z − z_f| / ( z · (z_f − f) )
```

Since `|z − z_f| / z = z_f · |1/z_f − 1/z|`, writing `d = 1/z` gives

```
c = [ f² · z_f / ( N · (z_f − f) ) ] · | d − d_f |  =  C · | d − d_f |
```

So **the blur radius is linear in disparity** (LightBench's derivation; it matches BokehMe's Eq. 1,
`r = K |d − d_f|`, and its "signed defocus map" `S = K(D − d_f)` ([paper PDF](https://github.com/JuewenPeng/BokehMe/blob/main/pdf/BokehMe.pdf))).

**What follows for LightBench:**
- **Sign gives the side.** `d > d_f` means nearer than the focus plane (foreground); `d < d_f` means behind it. Both get
  blur, growing with distance from the plane.
- **Background blur is bounded.** As `z → ∞`, `d → 0`, so `r → K·d_f`. **Foreground blur is not:** it grows without limit
  as objects approach the lens. This matches real photographs (foreground bokeh can be huge).
- **Relative depth is enough.** If the model outputs `d' = s·d + t` (s > 0), then `d − d_f = (d' − d'_f)/s`, so
  `r = (K/s) · |d' − d'_f|`. The unknown shift `t` cancels, and the unknown scale `s` is absorbed by the strength slider
  `K`. The user never needs metres.
- **What metric depth would add:** a physically labelled control, i.e. a real f-number for the photo's actual focal length
  and sensor (EXIF) and the true focus distance. It does not make the grading itself more correct, *if* the relative
  model is truly affine.
- **Where it breaks:**
  - Monocular models are not exactly affine-consistent across a scene. Large planar scenes and indoor/outdoor mixes
    distort.
  - Sky gets an arbitrary small disparity.
  - Thin structures and glass are often wrong.
  - These are depth *errors*, handled by the refine brush and edge refinement (§3), not by the formula.
- **Normalise per photo.** BokehMe and MPIB normalise disparity to [0, 1] ("disparity maps of all datasets are normalized
  to [0, 1] range", BokehMe paper §4.1). Normalising with robust percentiles (for example 1st–99th) makes the strength
  slider behave similarly across photos (LightBench design suggestion, untested).

### 1.3 Metric-depth options (if a physical f-number label is ever wanted)

| Model | Code licence | Weights licence | Training-data caveat | Size | Browser | Verdict |
|---|---|---|---|---|---|---|
| **Depth Anything V2 Metric (Hypersim / VKITTI) Small** | Apache-2.0 (repo [LICENSE](https://github.com/DepthAnything/Depth-Anything-V2/blob/main/LICENSE)) | **Unclear.** The main README's licence line names "Depth-Anything-V2-Small"; it doesn't mention the metric checkpoints ([metric README](https://github.com/DepthAnything/Depth-Anything-V2/tree/main/metric_depth)). HF cards unverified | Fine-tuned on Hypersim ("licensed under the Creative Commons Attribution-ShareAlike 3.0", [ml-hypersim README](https://github.com/apple/ml-hypersim)) and Virtual KITTI 2. VKITTI 2 is CC BY-NC-SA 3.0 per its site (unverified; site not opened) | 24.8 M | Same graph as relative DA2 (likely; untested) | **Hold.** The licence is unclear and the outdoor model's data is likely NC. Also, separate indoor and outdoor models don't suit general photos |
| DA2 Metric Base / Large | Apache-2.0 | CC-BY-NC-4.0 (the README's line for Base/Large) | as above | 97.5 M / 335.3 M | — | **Excluded** |
| **Depth Anything 3 METRIC-LARGE** | Apache-2.0 | "Apache 2.0" in the README model table ([README](https://github.com/ByteDance-Seed/Depth-Anything-3)) | not checked | 0.35 B (fp16 ≈ 700 MB, estimate) | none found | Too big for a default; possible optional download later |
| **Apple Depth Pro** | Apple sample-code licence: "Apple grants you a personal, non-exclusive license … to use, reproduce, modify and redistribute the Apple Software" ([LICENSE](https://github.com/apple/ml-depth-pro/blob/main/LICENSE)) | same file | not checked | Not measured (size unverified) | transformers.js maps `depth_pro` (`registry.js:540`, v4.3.1) | **Excluded.** The licence is custom ("personal", with no patent grant), and its compatibility with GPL-3.0 redistribution is unclear |
| **Metric3D v2 (ViT-S)** | BSD 2-Clause ([LICENSE](https://github.com/YvanYin/Metric3D/blob/main/LICENSE)) | Not stated. The README adds "For further commercial inquiries, please contact Dr. Wei Yin … and Mr. Mu Hu" ([README](https://github.com/YvanYin/Metric3D)) | Large multi-dataset mix (not checked) | ViT-S + RAFT-4iter; size unverified | `onnx-community/metric3d-vit-small` ONNX exists (README) | **Hold.** The weights licence is unclear and the README invites commercial enquiries |
| **MoGe-2 ViT-S** (Microsoft) | MIT: "MoGe code is released under the MIT license" ([README](https://github.com/microsoft/MoGe)) | HF card unverified | not checked | 35 M (README table) | none found | **Hold** until the weights licence is confirmed |
| **ZoeDepth** (Intel ISL) | MIT ([LICENSE](https://github.com/isl-org/ZoeDepth/blob/main/LICENSE)) | repo MIT (weights on GitHub releases) | NYU v2 / KITTI fine-tunes (dataset terms not checked) | not measured | not in the transformers.js 4.3.1 registry (`registry.js` has no `zoedepth` entry) | Older and weaker than DA2 (not benchmarked here). Fallback only |
| UniDepth | — | CC BY-NC 4.0 ([LICENSE](https://github.com/lpiccinelli-eth/UniDepth/blob/main/LICENSE)) | — | — | — | **Excluded** |
| Marigold | Apache-2.0 code | OpenRAIL++-M weights with use restrictions ([LICENSE-MODEL](https://github.com/prs-eth/Marigold/blob/main/LICENSE-MODEL.txt)) | — | about 1 B (built on Stable Diffusion; estimate) | — | **Excluded** (RAIL, and diffusion-sized) |

**Answer to "does relative depth suffice?":** yes. The user sets the focus point (or auto focus picks the subject) and a
strength or "aperture" control, and §1.2 shows that this reproduces thin-lens grading exactly up to the model's own
errors. An **"f-number" label** is still possible as a *nominal* scale: `K = K₀ / N`, with K₀ chosen so that f/2.8 looks
like a typical portrait lens at the photo's framing. That is how a phone's after-capture f/1.4–f/16 slider *behaves*
(Apple's internal mapping is not public; unverified).

### 1.4 No-model depth that some files already carry

- **iPhone Portrait HEICs** carry an auxiliary depth image. LightCraft's HEIF tests list
  `urn:mpeg:hevc:2015:auxid:2` beside Apple's gain map as an auxiliary they ignore
  (`crates/heif/src/tests_synthetic.rs:117`, LightCraft commit `701f78e`). That this is depth/disparity, and how to read
  it, is **unverified**.
- **iPhone ProRAW DNGs** carry semantic mattes (sky, skin, hair, teeth, glasses, "portraiteffectsmatte" = person) in
  DNG 1.6 semantic-mask IFDs (`crates/raw/src/semantic.rs`; name table in `crates/engine/src/files.rs:580-590`). These
  are mattes, not depth, but the person matte is a ready-made subject alpha for §3.
- **Google "Portrait" JPEGs** embed depth through XMP (Dynamic Depth / GDepth). **(Unverified;** not checked.)

---

## 2. Rendering depth-graded bokeh

### 2.1 Thin-lens CoC per pixel

- Compute `r(x) = K · max(0, |d(x) − d_f| − w/2)`, with focus range `w` as a dead zone around the focus plane (Lightroom
  calls this "Focal range"), and clamp `r ≤ r_max`.
- Keep the **sign** (`d − d_f`) so the renderer knows what is in front of the plane.
- Blender's node also clamps with a "max blur" setting (`maxblur`, default 16, `node_composite_defocus.cc`).

### 2.2 Gather vs scatter

| Approach | How it works | Strengths | Failure mode | Source / licence |
|---|---|---|---|---|
| **Gather** (per output pixel, average neighbours inside a kernel) | Blender's Defocus: a neighbour contributes only if the window offset is within **min(centre radius, neighbour radius)**, weighted by the bokeh kernel, then normalised (`node_composite_defocus.cc` lines ~175–215) | Simple, GPU-friendly, no atomics. The min rule stops a sharp subject from smearing into the background | The min rule also stops a **blurred foreground from spreading over a sharp subject** (no partial occlusion). Cost is O(r²) per pixel | Blender, GPL-2.0-or-later (the code isn't needed; the idea is generic) |
| **Scatter** (each input pixel splats its disc into the output) | BokehMe's classical renderer: "scattering each pixel to its neighbor areas where the distance between them is less than the blur radius of the pixel" (paper §3.1) | Physically closer for depth-continuous areas; bokeh balls come out naturally | "serious color-bleeding artifacts at depth discontinuities" (same section). Needs float atomics or sorting on a GPU; WebGPU has atomics only on `i32`/`u32` (WGSL spec), so fixed-point accumulation is needed | [BokehMe](https://github.com/JuewenPeng/BokehMe), Apache-2.0 |
| **Scatter as gather / sprites** | Game-engine techniques (e.g. Jimenez, *Next-Generation Post-Processing in Call of Duty: Advanced Warfare*, SIGGRAPH 2014; Abadie, *A Life of a Bokeh*, SIGGRAPH 2018) | Real-time | Approximations tuned for games | Talks **not read** (sites blocked); cited for orientation only |
| **Constant-time "rectangle spreading"** | Scatter by adding +value at the start and −value at the end of each row span of a disc, then a prefix sum. O(r) per pixel for any radius (Kosloff, Tao & Barsky 2009, *Depth of field postprocessing for layered scenes using constant-time rectangle spreading*) | Exact discs in O(r) | Prefix sums over a large image; same atomics issue | Paper **not read**; title from memory, **unverified** |

### 2.3 Layered (depth-sliced) compositing

**MPIB** (ECCV 2022, [code](https://github.com/JuewenPeng/MPIB), Apache-2.0) slices the scene into fronto-parallel RGBA
planes `{(cᵢ, αᵢ)}`, blurs each plane with its own kernel `Kᵢ`, and composites back to front with normalisation (paper
Eq. 3, [PDF](https://github.com/JuewenPeng/MPIB/blob/main/pdf/MPIB.pdf)):

```
        Σᵢ (cᵢαᵢ * Kᵢ) · Πⱼ>ᵢ (1 − αⱼ * Kⱼ)
B  =  ───────────────────────────────────────
        Σᵢ (αᵢ * Kᵢ)   · Πⱼ>ᵢ (1 − αⱼ * Kⱼ)
```

**Why this suits LightBench:**
- **Partial occlusion comes for free.** A foreground plane's blurred alpha `αⱼ*Kⱼ` falls below 1 at its edges, so the
  plane becomes see-through there and the subject shows through. Real lenses do this.
- **No bleeding.** Each plane is blurred only with its own pixels; the denominator renormalises. Background colour doesn't
  smear into the subject, and the subject doesn't smear into the background.
- **One radius per plane**, so each blur is a *fixed* convolution: separable approximations, pyramids or FFT apply
  (§2.4).
- **What it needs:** pixels for the parts of a back plane hidden behind a front plane. MPIB "propose[s] an MPI
  representation module combined with a background inpainting module" and uses LaMa ("we use LaMa as our inpainting
  model", [README](https://github.com/JuewenPeng/MPIB)). Without inpainting, the normalisation simply leaves the hidden
  part out. That is fine behind sharp or slightly blurred objects, and it shows as a gap only where a strongly blurred
  foreground should reveal the background behind it.
- **Older layered methods:** SteReFo (Busam et al., ICCVW 2019) and Lee, Eisemann & Seidel, *Real-time lens blur effects
  and focus control* (SIGGRAPH 2010) layer the scene too. MPIB notes such methods "do not consider potential depth
  inaccuracy and object occlusion" (paper §2). These papers weren't read here.
- **Number of slices:** the radius changes within a slice, so slices must be close in `r`. Spacing slices uniformly in
  *blur radius* (i.e. in disparity), with a slice that holds everything inside the focus range, keeps the error below
  about a pixel. LightBench design suggestion **(estimate:** about 8–24 slices for r_max ≤ 64 px at preview size).

### 2.4 Fast aperture kernels on the GPU

| Technique | What it gives | Licence of the reference | Browser fit |
|---|---|---|---|
| **Circular separable convolution** (Garcia, EA, SIGGRAPH 2017 Talks) | A disc blur from **horizontal + vertical passes** using complex phasors: "convolves a circular pattern blur in the frequency domain using a horizontal and a vertical pass, representing the frame buffer using complex numbers". Shipped in Madden NFL 15–17 and FIFA 17 (paper abstract, in the repo) | Filter generator and paper: MIT, "Copyright 2016 Kleber A Garcia" ([CircularDofFilterGenerator](https://github.com/kecho/CircularDofFilterGenerator)) | Excellent: O(r) per pixel per component (1–2 components). Disc only, not polygons |
| **Mip/pyramid blur** | Large radii run at ½, ¼, … resolution (Kraus & Strengert 2007, *Depth-of-Field Rendering by Pyramidal Image Processing*, not read) | — | Good for large radii; bokeh balls soften |
| **FFT per slice** | Exact arbitrary kernels, including polygons and rings | — | ONNX Runtime Web lists a `DFT` operator for the WebGPU EP ([webgpu-operators.md](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md)); a WGSL FFT would be LightBench's own. Cost is O(n log n) per slice regardless of r |
| **Direct gather with a kernel texture** | Any shape: Blender samples a precomputed bokeh kernel image (`bokeh_kernels.get(… sides, rotation, roundness …)`) | GPL (idea only) | O(r²); fine for small radii or a final cat's-eye pass |

### 2.5 Shapes and highlights

- **Bright spots must stay bright.**
  - Bokeh balls appear when a small, very bright source is spread over a disc. Blurring **scene-linear** light is the
    physically right domain. BokehMe applies "an additional gamma correction … before and after the rendering" only
    because its inputs are display-encoded (paper §3.1; the demo's `--highlight` option "enhance[s] RGB values of
    highlights before rendering for stunning bokeh balls").
  - **LightBench's scene is linear Rec.2020** (PHASE3 Part 11, "Where it runs in the pipeline"), so it can blur before
    the display transform and get correct highlight energy without that trick.
- **Clipped highlights are too dim.** A clipped light source was brighter than the clip level, so after blurring its ball
  looks grey. Lightroom's **Boost** "adjusts the brightness of out-of-focus light sources" (Adobe help, quoted in search
  results; unverified). In LightBench, a Boost could multiply only pixels flagged as clipped (the sensor-clipping mask
  already exists for the overlay, PHASE3 Part 9) before blurring. Suggestion, untested.
- **Shapes:**
  - **Polygon:** N blades, rotation and roundness, as in Blender's node (`bktype` = sides, 0 = circle; `rotation`).
  - **Ring / Bubble:** a brighter rim. Lightroom describes Bubble as "a circular shape with over-corrected spherical
    aberration" (search snippet, unverified).
  - **Cat's-eye:** optical vignetting. Off-axis, the aperture disc is clipped by a second, shifted disc, so the shape
    depends on image position. That breaks the "one kernel per slice" trick. Do it in a final gather pass or per-tile
    kernels, or leave it for later. Lightroom: "Cat Eye simulates the bokeh caused by optical vignetting in certain
    lenses" (search snippet, unverified). Camera Raw's page describes Cat Eye as a slider "toward the edges and corners"
    and also lists **Anamorphic** (search snippet, unverified).

### 2.6 Patent facts found (no legal conclusion)

These come from Google Patents search results only. **Claims were not read**, and assignees are as Google Patents lists
them ("may be inaccurate", per Google):

| Patent | Title | Assignee (per Google Patents) | Status (per snippet) |
|---|---|---|---|
| [US 10,410,327 B2](https://patents.google.com/patent/US10410327) | Shallow depth of field rendering | Apple Inc. | active |
| [US 10,992,845 B1](https://patents.google.com/patent/US10992845) | Highlight recovery techniques for shallow depth of field rendering | Apple (inferred from the family; unverified) | not checked |
| [US 11,250,571 B2](https://patents.google.com/patent/US11250571) | Robust use of semantic segmentation in shallow depth of field rendering | unverified | not checked |
| [US 11,120,528 B1](https://patents.google.com/patent/US11120528) | Artificial aperture adjustment for synthetic depth of field rendering | unverified | not checked |
| [US 10,284,835 B2](https://patents.google.com/patent/US10284835) | Photo-realistic shallow depth-of-field rendering from focal stacks | Apple (per search summary) | not checked |
| [US 8,989,517](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8989517) | Bokeh amplification | unverified (family claims an Australian 2012 priority) | not checked |

**Other notes:**
- The classical methods above are published academic techniques from 1981–2017.
- Whether any of the patents covers the specific combination LightBench would build is a question for the owner's
  adviser.
- Guided filtering (He, Sun & Tang, ECCV 2010, Microsoft Research Asia) was searched for a patent; **none was found**.
  That search was not conclusive.

---

## 3. Foreground problems and how published methods handle them

| Problem | What goes wrong with a per-pixel blur | Published handling | Browser-feasible for LightBench? |
|---|---|---|---|
| **Partial occlusion** (blurred foreground over a sharp subject) | A gather with Blender's min-radius rule keeps the foreground's edge hard over the subject. A naive gather lets the subject's sharp pixels pull the foreground's blur in | **Layered rendering** with back-to-front compositing, and **inpainting the occluded background** of each plane (MPIB: LaMa; Apache-2.0 code). BokehMe instead fixes depth-edge regions with a neural renderer trained on synthetic Blender data (Apache-2.0 code; its weights and data were not checked) | **Yes:** layering is plain WGSL. **Inpainting optional:** MI-GAN (≈ 5.9 M params, MIT weights; see PHASE4_MODELS §1) on the occluded strip only. BokehMe's neural part is a second model; not recommended for v1 |
| **Haloes** (background colour bleeding onto subject edges, or the subject smearing outwards) | Gather/scatter mixes pixels across a depth edge | **Normalised per-layer blur** (MPIB Eq. 3 denominator; "normalized convolution"). BokehMe's "error map" marks a band around depth edges whose width depends on the blur radii on both sides (paper Eq. 2) | **Yes**, no model |
| **Hair and fine edges** | Depth models give soft or wrong depth at hair; a hard depth cut makes a cut-out look | Use a **matte** for the subject: the subject's alpha decides which layer a pixel belongs to and how much (mixed pixels split across layers). Google's Portrait Mode combines "a person segmentation network" with depth ([Wadhwa et al. 2018](https://research.google/pubs/synthetic-depth-of-field-with-a-single-camera-mobile-phone/) abstract, via search; paper not read) | **Yes:** the subject mask from section 3 (BiRefNet-lite or SAM 2.1). A dedicated matting model (ViTMatte: MIT code ([LICENSE](https://github.com/hustvl/ViTMatte/blob/main/LICENSE)), weights unverified) would be an optional extra |
| **Depth-map edge errors** (depth bleeds a few pixels past the object; holes in fences and glass) | The wrong side gets blurred | **Edge-aware refinement** guided by the photo: guided filter / joint bilateral upsampling. darktable upsamples AI masks this way (`segmentation.c:193-280`, see AI_MODELS.md), and **LightBench already runs darktable's EIGF guided filter in WGSL** (`tone-mask.wgsl`, PHASE3 Part 10). Patch-based depth refinement exists (PatchFusion: MIT code, [LICENSE](https://github.com/zhyever/PatchFusion/blob/main/LICENSE)); *Boosting Monocular Depth* is "for academic use only" ([LICENSE](https://github.com/compphoto/BoostingMonocularDepth/blob/main/LICENSE)) and excluded | **Yes:** a guided filter on the depth, plus the **refine-depth brush** (paint "focus" or "blur", as in Lightroom) |
| **Sky** | The model gives the sky an arbitrary disparity | Treat the sky as the farthest layer: sky mask from DA3 (optional), a ProRAW matte, or a rule | Yes |

---

## 4. UI precedents

| Product | Controls (as found) | Source quality |
|---|---|---|
| **Apple Photos** (Portrait photos) | After capture, an **f-number slider f/1.4–f/16** ("f1.4 will apply the most amount of blur, and f16 will apply the least"). **Changing the focal point** needs iOS 16+ and an iPhone 13 or later. Works only on photos captured with depth | [Macworld](https://www.macworld.com/article/2310091/how-to-manage-depth-control-in-iphone-photos.html), [iPhone in Canada](https://www.iphoneincanada.ca/how-to/how-to-edit-depth-control-iphone): third-party; Apple's own page not reached (**unverified**) |
| **Google Photos** (Portrait blur) | A **blur** slider and **tap to move the focus**. One guide says it also works on non-portrait photos of objects, animals and food | Third-party guides via search ([Macworld 2018](https://www.macworld.com/article/232130/google-photos-adds-depth-control-color-pop-to-iphone-app.html), [androidayuda](https://en.androidayuda.com/edit-blur-in-google-photos/)); **unverified** against Google's help |
| **Lightroom (web/desktop) Lens Blur** | **Blur Amount** (default 50); **Focus Range**: *Subject Focus* ("Automatically sets the focal range using AI-powered subject detection") or *Point or Area Focus* ("click or drag on the photo"); **Bokeh**: Circle, Bubble, 5-Blade, Ring, Cat Eye; **Boost** (brightness of out-of-focus lights); **Visualize Depth** ("displays the depth map and focal range"); **Refine Depth** with **Focus** / **Blur** brushes and Size, Feather, Flow | [Adobe help: Apply Lens Blur (Lightroom web)](https://helpx.adobe.com/lightroom/web/edit-photos/apply-effects/apply-lens-blur.html), quoted from search results; page not opened (**unverified**). Camera Raw's page differs (Anamorphic, a Cat Eye slider): [Lens Blur in Camera Raw](https://helpx.adobe.com/camera-raw/desktop/edit-and-enhance-images/sharpening-and-noise/lens-blur.html) (same caveat) |
| **Photoshop Depth Blur** (Neural Filter) | **Focal Point** (click) or **Focus Subject**; **Focal Distance**; **Focal Range**; **Blur Strength**; Haze, Warmth, Brightness, Saturation; **Output depth map only** | Tutorials and news via search ([PetaPixel 2021](https://petapixel.com/2021/05/21/adobe-updates-neural-filters-brings-portrait-mode-to-photoshop), [Digital Camera World](https://www.digitalcameraworld.com/tutorials/use-photoshops-depth-blur-filter-to-automatically-blur-distracting-backdrops)); **unverified** against Adobe's help |
| **Blender** Defocus compositor node (open source, GPL-2.0-or-later) | **Bokeh type** (circle or N sides), **angle**, **f-stop**, **max blur**, **use Z-buffer** / **Z scale**; CoC from the thin-lens equations | Read from source: [`node_composite_defocus.cc`](https://github.com/blender/blender/blob/main/source/blender/nodes/composite/nodes/node_composite_defocus.cc) (commit `37d63d7`) |

The owner's list maps onto these one to one: strength ↔ Blur Amount / f-number; click-to-focus + focus range ↔ Point
Focus + Focal Range; auto focus ↔ Subject Focus; refine-depth brush ↔ Refine Depth (Focus/Blur); bokeh shapes ↔ Bokeh.
**Visualize Depth** and **Boost** are the two Lightroom extras worth copying.

---

## 5. Recommended approach for LightBench

### Model and depth map
- **Depth Anything V2 Small**, run once per photo through ONNX Runtime Web (WebGPU EP) or transformers.js.
  - Input: about 518 px on the long side, the size DA2 uses; higher is optional for detail.
  - Output: a **relative disparity** map.
- **Where it lives:** compute on the **sensor-frame scene** (as the Remove spots do, PHASE3 Part 11), so crop, rotate,
  lens and Upright don't invalidate it, and warp it with the same geometry map.
- **Storage:** store it with the edit as a small 16-bit image (LightCraft's idea of storing mask results with the edit,
  see CATALOG_LIBRARY_AI_APPS `crates/segment`). Renders and exports then never need the model again, and the depth
  survives on another machine.
- **Refinement:** a guided filter with the photo as the guide (reuse the EIGF WGSL), then the user's **refine strokes**
  (stored like spots: points, size, feather, and "set to focus" / "push to blur").

### Depth → blur
- **Normalisation:** `d' = (d − p1) / (p99 − p1)`, using robust percentiles per photo.
- **Focus:** `d_f` is the **median disparity** under the clicked point, using a small window or the clicked object's SAM
  mask. BokehMe's demo does the same: "obtain the refocused disparity by taking the median value of the disparity map
  within the bounding box" (paper §4).
- **Auto focus:** `d_f` is the median disparity inside the **subject mask** (BiRefNet-lite or SAM 2.1; PHASE4_MODELS §3).
- **Radius:** `r = K · max(0, |d' − d_f| − w/2)`, keeping the sign for front/back.
  - `K` is the strength slider, optionally labelled as a nominal f-number (`K = K₀/N`).
  - `w` is the focus range.
  - `r_max` is a cap, about 2–3 % of the image width (**estimate**).
- **Optional:** separate front and back strength sliders (not physical, but users ask for "background only" looks).
  LightBench's suggestion, not a precedent found.

### Rendering (WGSL compute, scene-linear Rec.2020, before the display transform)
1. Slice by signed radius into N layers (**estimate:** 8–24 at preview size). The focus-range band is one sharp layer.
   Pixels split between neighbouring layers by fractional position, and by the subject matte at the subject's edge.
2. Blur each layer's premultiplied colour **and** alpha with its fixed aperture kernel:
   - circle: Garcia's separable complex filter (MIT reference);
   - polygons and rings: FFT or a kernel-texture gather;
   - large radii: at reduced resolution.
3. Composite back to front and normalise (MPIB Eq. 3). That gives haloes-free edges and partial occlusion.
4. **Optional, strong foreground blur only:** inpaint the background hidden under foreground layers (MI-GAN, the Remove
   model) before step 2.
5. **Boost:** scale clipped-highlight pixels before step 2 (Lightroom-style, optional).
6. **Cat's-eye:** a final per-pixel gather with a position-dependent kernel, or later.

### Controls
- **Strength.**
- **Focus:** click, and drag for an area; plus **Focus range**.
- **Auto (subject)**, on by default when the panel opens.
- **Bokeh:** Circle / Blades (count, rotation, roundness) / Ring / Cat's-eye.
- **Boost.**
- **Show depth / focus:** an overlay of the depth map, with the in-focus band tinted.
- **Refine depth brush:** Focus / Blur / Nearer / Farther, with Size, Feather and Flow.
- The **AI depth model**, with its licence, shown in the download dialog.

### Browser cost (all **estimates**, nothing measured)
| Step | When | Estimate |
|---|---|---|
| DA2-Small at 518 px, WebGPU fp16 | Once per photo (then stored) | Tens to a few hundred ms. The only published figures found are native: Core ML on Apple's Neural Engine at 15–18 ms (search snippet of an HF card, unverified), and 40.1 ms on an NVIDIA L4 (Roboflow docs, search snippet) |
| Guided-filter refinement | On depth or brush change | A few ms (LightBench's EIGF is already interactive in the tone equalizer) |
| Layered blur, fit-to-screen preview (~2 MP, 16 layers, separable circle) | Each slider move | Tens of ms on a discrete GPU, up to a few hundred ms on integrated GPUs |
| Same at export (24–45 MP) | Export | Seconds |
| MI-GAN on occluded strips | Only when the foreground is strongly blurred | ~0.1–1 s per 512² crop (MI-GAN's supplement reports ~539 ms on an iPhone 14 Pro Max for the 512 model, via search snippet) |

### Unverified, to test first
- DA2-Small's quality on the owner's photos: hair, glass, fences, skies.
- WebGPU timings on the owner's GPU and on an integrated GPU.
- Whether 8–24 slices hide slice boundaries on smooth depth ramps (ground planes).
- fp16 numerical safety of DA2 in ORT Web.
- Reading the iPhone Portrait HEIC depth auxiliary and Google's embedded depth (a no-model path for those files).
- Lightroom and Photoshop control details against Adobe's own pages.

---

## Sources and what could not be read

**Read at the source (GitHub raw or clone, 2026-10-13):**
- Depth Anything V2: README, LICENSE, `metric_depth/README.md`.
- Depth Anything 3: README.
- MoGe: README.
- Metric3D: README, LICENSE.
- Apple ml-depth-pro: LICENSE.
- Apple ml-hypersim: README.
- BokehMe: README, LICENSE, paper PDF.
- MPIB: README, LICENSE, paper PDF.
- CircularDofFilterGenerator: LICENSE, paper PDF.
- Blender: `node_composite_defocus.cc` (commit `37d63d7`).
- ViTMatte, PatchFusion, BoostingMonocularDepth: LICENSE files.
- ONNX Runtime: `js/web/docs/webgpu-operators.md`.
- `@huggingface/transformers` 4.3.1: `src/models/registry.js`, from npm.
- LightCraft `701f78e`: `crates/raw/src/semantic.rs`, `crates/engine/src/files.rs`, `crates/heif/src/tests_synthetic.rs`.

**Search results only (pages blocked by the network proxy):**
- Adobe help: Lightroom Lens Blur, Camera Raw Lens Blur, Photoshop Depth Blur.
- Apple and Google feature descriptions (third-party sites).
- Google Patents records.
- Wadhwa et al. 2018 (abstract only).
- Hugging Face model cards.
- Depth Anything speed figures.

**Blocked, not read at all:** arxiv.org, huggingface.co, helpx.adobe.com, support.apple.com, support.google.com,
developer.nvidia.com (GPU Gems), research.google, advances.realtimerendering.com, patents.google.com,
docs.blender.org, web3dsurvey.com. Every claim resting on them is marked above.
