> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-17 (prompt `docs/research/COWORK_EFFECTS_PROMPT.md`). Copied verbatim below this line; not re-verified here except where its own spot-check log says so. Facts only, not legal advice.

# Effects build: verification (COWORK_EFFECTS_2026-10-17)

Verification for LightBench's Effects build (post-crop vignette, Grain, Dehaze, Texture, Clarity, Glow). All sources were read on 2026-10-17. Verdicts are **Confirmed / Contradicted / Partly / Not found**. **Facts only: no legal conclusions.** The element tables state which darktable quantity corresponds to each claim element, or that no step corresponds. They do not say whether a claim covers LightBench. Google Patents' status and expiry fields are, in its own words, "an assumption and is not a legal conclusion". For decisions that depend on these patents, consider advice from a patent professional.

Structure: Decisions table → spot-check log → Part 1 (items 1, 2, 3, 10) → Part 2 (items 4–9) → blocked sources (at the end of each part).

---

## Decisions this changes

| Item | Fact found | What LightBench should do differently (design input, not legal advice) |
|---|---|---|
| 1. US 9,508,126 (Adobe) | "Active, expires 2035-03-14". Claim 1 computes transmission from a "fractionally scaled variant" using "a scaling factor that is a function of the input digital image", then filters with "a smoothing function". Claim 7: "one of a mean filter, a median filter and a minimum filter". The description's example factor is image-dependent (s(x) = 0.02/I(x) if I > 0.1, else 0.2). **darktable:** `strength` is a user-set constant (default 0.2), not computed from the image. It filters with box max, box min, then a guided filter. | Keep the strength as a **user constant**, and don't make it image-adaptive (no auto-strength derived from pixel values) without review. Record this as a design constraint in EFFECTS_DESIGN.md. |
| 2. US 9,305,339 (Adobe) | "Active", anticipated expiry 2034-07-01. Every independent claim requires a "trained model". darktable has no learned model. | Note that any future *learned* dehaze would meet this patent's subject matter. No change to the classical port. |
| 3. US 10,367,976 (US Navy) | "Active, expires 2037-12-27". All independent claims require a [0,1] conversion, a brightness correction and an airlight averaged across **video frames**. Claims 7 and 12 also require a mean filter. darktable has no multi-frame airlight step. | No change for still images. Note it if video or batch-temporal dehaze is ever considered. |
| **New: US 9,754,356 B2** (A\*STAR; found under item 5) | "Active", anticipated expiry 2034-04-11 (Google's assumption caveat). Claim 1 (from the patent PDF) recites a guided-filter linear transformation in which pixels are "weighted … according to the determined weight value", with weights "based on the determined variance" of each pixel's window, and then "determining the input image as an initial transmission map of a haze image by using a luminance channel of the haze image", "estimating an atmospheric light value in a dark intensity channel" and "haze removal processing". Independent claims: 1, 10 and 16. **darktable `hazeremoval.c`:** calls the standard `guided_filter(img_in, trans_map, …, w2, eps, …)` with a fixed `eps = sqrtf(0.025f)` and no per-pixel weight array. Its transmission uses `MIN(MIN(pixel[0]*A0_inv[0], …), pixel[2]*A0_inv[2])` over the RGB channels, not a luminance channel. The implementation (`common/guided_filter.c`) uses a constant `eps = sqrt_eps * sqrt_eps` added to the covariance diagonal (`Sigma_0_0 = varpx[VAR_RR] - (guide_r * guide_r) + eps`, and the same for G and B), with no per-pixel weight. `guide_weight` is one scalar that scales the guide's amplitude. | **Don't swap in a "weighted guided filter" (WGIF) or a luminance-channel transmission map** in the Dehaze port. Keep darktable's standard colour guided filter with a constant eps. Add this patent to the Dehaze design notes. |
| 10. US 8,340,461 (Microsoft dark channel) | "Expired - Fee Related", adjusted expiry 2031-06-23. **The lapse date and the missed fee are still Not found:** the legal-events section and the USPTO sites didn't render. | No change. The dark-channel method's patent is listed as expired; keep "lapse date unconfirmed" in the notes. |
| 4. Local Laplacian | No patent by Paris, Hasinoff or Kautz found. The only Laplacian-pyramid contrast patents found (other inventors) are "Expired - Fee Related" or "Abandoned". | None found (not proof of absence). Local Laplacian remains a candidate for Clarity/Texture; document the search terms used. |
| 5. Guided filter (He/Microsoft) | None found for He or Microsoft. The third-party US 9,754,356 is above. | See the US 9,754,356 row. |
| 6. Texture/Clarity | No Adobe patent names a Texture or Clarity control. Adobe **US 8,666,194** "System and method for editing frequency content of images" shows "Active, expires 2031-09-06". From Part 2's summary of its claims: they involve displaying a sub-image of one frequency band (a time-frequency view) and modifying a selected portion of it. Its description, not its claims, mentions per-band sliders. Claim 1's full text was only partly read. Adobe's HDR base/detail patents (US 9,230,312, US 8,831,340) are also "Active". | Read US 8,666,194's claim 1 in full before adding any UI that shows and edits individual frequency bands. Global Texture/Clarity sliders (no band view, no region selection in a band view) are a different design. US 9,230,312 / 8,831,340 cover HDR base/detail tone mapping with a bilateral filter; note them in the Clarity design notes. |
| 7. Vignette priority modes | No patent found. The closest is Adobe US 9,830,717 (face-aware vignettes), whose claims recite no highlight protection. | None found; no change. |
| 8. Glow | Help page confirmed: styles Diffusion, Bloom and Halation; Range, Spread and Warmth are global, and only the amount is set per mask. Camera Raw 18.6, August 2026. **Not** in Lightroom Classic 15.6 or Lightroom 9.6 (Adobe pages of 29 Sep). Adobe publishes no numeric ranges. crs names come from a third-party source only: `GlowRange`, `GlowSpread`, `GlowStyle`, `GlowWarmth`. The amount field's name is unknown, and ExifTool has no Glow tags. | Mark the design doc's −100…+100 range as unconfirmed. Treat the crs Glow fields as provisional; for XMP import, read but don't write them until confirmed from an Adobe-written sidecar. Make the per-mask amount the only local Glow control, matching Adobe. |
| 9. Glow/bloom/halation patents | None found for Adobe in 2024–2026 filings. | None found (not proof of absence). |

## Spot-check log (main session, 2026-10-17)

Re-fetched from primary sources:

- **US 9,508,126 B2** (Google Patents): Adobe Inc., "Active, expires 2035-03-14". Claim 1, quoted in full in segments, matches Part 1, including "a scaling factor that is a function of the input digital image" and "using a smoothing function". Claim 7: "one of a mean filter, a median filter and a minimum filter." **Confirmed.**
- **US 9,305,339 B2:** Adobe Inc., "Active", anticipated expiry 2034-07-01. **Confirmed.**
- **US 9,754,356 B2:** Agency for Science, Technology and Research; inventors Zhengguo Li et al.; priority 2013-04-12; "Active"; anticipated expiry 2034-04-11. Claim 1 was read from the patent PDF (https://patentimages.storage.googleapis.com/0d/45/7d/306a5936e67fab/US9754356.pdf); independent claims 1, 10 and 16. **Confirmed.** This fills Part 2's gap on the full claim 1.
- **darktable `hazeremoval.c`** (master, via raw.githubusercontent.com): RGB-minimum dark channel and transmission; `guided_filter(...)` with `eps = sqrtf(0.025f)` and no weight array; ambient light averaged over the brightest hazy pixels. **Confirmed.**
- **darktable `common/guided_filter.c`** (master): the coefficients come from a 3×3 colour covariance system with a constant `eps` on the diagonal; no per-pixel variance-based weight; `guide_weight` is a single scalar used "to balance the amplitudes in the guiding image and the input image." **Confirmed.**

### US 9,754,356 B2: claim 1 (verbatim, from the patent PDF)

> A method for processing an input image, the input image comprising a plurality of pixels, the method comprising: generating a base layer portion and a detail layer portion from the input image by carrying out a linear transformation of pixels of a guidance image; determining, for each of the pixels of the guidance image, a variance of the pixel in a surrounding window of pixels; and determining, for each of the pixels of the guidance image, a weight value of the pixel based on the determined variance; wherein the pixels are weighted in the linear transformation according to the determined weight value, and wherein the method further comprises: determining the input image as an initial transmission map of a haze image by using a luminance channel of the haze image, comprising: estimating an atmospheric light value in a dark intensity channel of the haze image; and determining the initial transmission map based on the atmospheric light value; and carrying out a haze removal processing of the haze image based on the initial transmission map.

(Assembled from consecutive segments; OCR spacing and hyphenation normalised. Claims 10 and 16 were not read.)

---

# Part 1: Haze-removal patents: facts for items 1, 2, 3 and 10

Read date for every source below: **2026-10-17**. Facts only: claim wording, status, dates and description definitions. This file contains no legal conclusions. The element tables say which darktable quantity corresponds to each claim element, or "no corresponding step". They do not say whether any claim covers darktable.

**How the text was obtained.** Every page was read with the WebFetch tool. That tool passes the page through a summarising model, so long quotes come back in segments.

- Claims marked "verbatim" were rebuilt from segments that the tool returned as exact quotes, joined in order. A gap would be marked "[…gap…]". None was needed.
- Where a second source was readable, the claim was cross-checked against it (the patent PDF's OCR text or the image-ppubs text). Each cross-check is recorded.
- Equations come from Google Patents' MathML and image-ppubs' flattened text, as the tool rendered them. Treat their typography as approximate.

**darktable source.** `src/iop/hazeremoval.c`, fetched from `https://raw.githubusercontent.com/darktable-org/darktable/master/src/iop/hazeremoval.c` on 2026-10-17. The commit hash was not recorded because the GitHub commits page is robots-disallowed. EFFECTS_DESIGN.md (context only) cites commit `e5306a7`. The header reads "Copyright (C) 2017-2025 darktable developers." It carries the GPL notice "either version 3 of the License, or" (later). The header comment says the module "implements automatic single-image haze removal as described by K. He et al." It cites He, Sun and Tang, "Single Image Haze Removal Using Dark Channel Prior" (TPAMI 2011) and the same authors' guided image filtering paper.

## Verdict summary

| Item | Sub-item | Verdict |
|---|---|---|
| 1 US 9,508,126 B2 | Independent claims 1, 8, 14 verbatim | **Confirmed** (claim 1 cross-checked against the PDF OCR) |
| 1 | Definition of "fractionally scaled variant" | **Confirmed** (eq. 6, J ≥ sI, s ∈ [0,1)) |
| 1 | "Scaling factor that is a function of the input digital image" | **Confirmed** (eq. 8; "can be manually defined or learned") |
| 1 | Filter the claims require | **Confirmed**: independent claims say "a smoothing function". Dependent claims 7/13/20 say "one of a mean filter, a median filter and a minimum filter" |
| 1 | Status / expiry | **Confirmed**: "Active, expires 2035-03-14" (Google, caveated); 4th- and 8th-year fees paid |
| 1 | Element table vs hazeremoval.c | **Confirmed** (done from source) |
| 2 US 9,305,339 B2 | Independent claims 1, 13, 18 verbatim | **Confirmed** from image-ppubs text, cross-checked against the PDF OCR. Google's claims section was not reachable |
| 2 | Status / expiry | **Partly**: "Active", anticipated expiration 2034-07-01 (Google, caveated); PTA 0 days (PDF). Legal Events and fee history **not reached** |
| 2 | Element table | **Confirmed** (done) |
| 3 US 10,367,976 B2 | Independent claims 1, 7, 12 verbatim | **Partly**: complete from Google Patents. Cross-check against image-ppubs refused (summary only). Equations are as rendered |
| 3 | Status / expiry | **Confirmed**: "Active, expires 2037-12-27" (Google, caveated); 4th-year fee paid 2023-01-04 |
| 3 | Element table | **Confirmed** (done) |
| 10 US 8,340,461 B2 | Status | **Confirmed**: "Expired - Fee Related" (Google, caveated); adjusted expiration 2031-06-23; PTA 507 days |
| 10 | Lapse date | **Not found** |
| 10 | Fee event (which maintenance fee was missed) | **Not found** |

---

## Item 1: US 9,508,126 B2

Sources:
- Google Patents: https://patents.google.com/patent/US9508126B2/en (page text 109,063 chars; read at offsets 0 and 100000)
- PDF: https://patentimages.storage.googleapis.com/7f/a0/2c/1d389d2e56db8d/US9508126.pdf (OCR text layer)
- USPTO text: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9508126 (text only, no front page)

### Bibliographic facts

| Field | Value (quoted) | Source |
|---|---|---|
| Title | "Image haze removal using fast constrained transmission estimation" | Google Patents |
| Inventors | Jianchao Yang; Jue Wang | Google Patents; PDF front page |
| Assignee | Current: "Adobe Inc". Original: "Adobe Systems Inc". PDF: "Adobe Systems Incorporated, San Jose, CA (US)" | Google; PDF |
| Application | US14/624,116, filed 2015-02-17 (PDF: "Filed: Feb. 17, 2015") | Google; PDF |
| Priority date | 2015-02-17 | Google |
| Pre-grant publication | US20160239945A1, 2016-08-18 | Google; PDF |
| Grant | "Date of Patent: Nov. 29, 2016" | PDF |
| Term adjustment | "Subject to any disclaimer, the term of this patent is extended or adjusted under 35 U.S.C. 154(b) by 25 days." | PDF front page |
| Status | "Active, expires 2035-03-14", listed as "Adjusted expiration". Caveat: "The legal status is an assumption and is not a legal conclusion." "Google has not performed a legal analysis and makes no representation as to the accuracy of the status listed." | Google |

Legal Events (Google Patents, offset 100000, verbatim):

| Date | Code | Title | Text |
|---|---|---|---|
| 2015-02-17 | AS | Assignment | Owner name: ADOBE SYSTEMS INCORPORATED, CALIFORNIA; "ASSIGNMENT OF ASSIGNORS INTEREST;ASSIGNORS:YANG, JIANCHAO;WANG, JUE;REEL/FRAME:034974/0176"; Effective date: 20150217 |
| 2016-11-09 | STCF | Information on status: patent grant | "PATENTED CASE" |
| 2019-04-08 | AS | Assignment | Owner name: ADOBE INC., CALIFORNIA; "CHANGE OF NAME;ASSIGNOR:ADOBE SYSTEMS INCORPORATED;REEL/FRAME:048867/0882"; Effective date: 20181008 |
| 2020-05-29 | MAFP | Maintenance fee payment | "PAYMENT OF MAINTENANCE FEE, 4TH YEAR, LARGE ENTITY (ORIGINAL EVENT CODE: M1551); ENTITY STATUS OF PATENT OWNER: LARGE ENTITY"; Year of fee payment: 4 |
| 2024-05-29 | MAFP | Maintenance fee payment | "PAYMENT OF MAINTENANCE FEE, 8TH YEAR, LARGE ENTITY (ORIGINAL EVENT CODE: M1552); ENTITY STATUS OF PATENT OWNER: LARGE ENTITY"; Year of fee payment: 8 |

### Independent claims (verbatim)

The claims run 1 to 20. The independent claims are 1, 8 and 14. Dependent claims 2–7 depend on 1, 9–13 on 8, and 15–20 on 14.

**Claim 1**. Google Patents, cross-checked against the PDF OCR. The only differences are OCR artifacts: ":" for ";" and "Smoothing"/"Smooth".
> 1. A computer-implemented digital image processing method comprising: receiving, by a processor, input data representing an input digital image having a plurality of pixels; modeling a scene radiance vector of the input digital image as a function of the input digital image, an atmospheric light factor, and a medium transmission for each of the pixels in the input digital image; calculating, by the processor, the medium transmission for each of the pixels in the input digital image based on a fractionally scaled variant of the corresponding pixel in the input digital image, the fractionally scaled variant being calculated using a scaling factor that is a function of the input digital image; filtering, by the processor, the medium transmission for each of the pixels in the input digital image using a smoothing function, such that a given neighborhood of pixels corresponding to the medium transmission for each of the pixels in the input digital image is locally smooth; and recovering, by the processor, the scene radiance vector based at least in part on the filtered medium transmission for each pixel in the input digital image, the recovered scene radiance vector representing a de-hazed digital image in which at least some haze effects in the input digital image are removed.

**Claim 8**. Google Patents. The first request was refused; the claim was then returned clause by clause.
> 8. A system comprising: a storage; and a processor operatively coupled to the storage the processor configured to execute instructions stored in the storage that when executed cause the processor to carry out a process comprising: receiving input data representing an input digital image having a plurality of pixels; modeling a scene radiance vector of the input digital image as a function of the input digital image an atmospheric light factor, and a medium transmission for each of the pixels in the input digital image; calculating the medium transmission for each of the pixels in the input digital image based on a fractionally scaled variant of the corresponding pixel in the input digital image, the fractionally scaled variant being calculated using a scaling factor that is a function of the input digital image; filtering the medium transmission for each of the pixels in the input digital image using a smoothing function, such that a given neighborhood of pixels corresponding to the medium transmission for each of the pixels in the input digital image is locally smooth; and recovering the scene radiance vector based at least in part on the filtered medium transmission for each pixel in the input digital image, the recovered scene radiance vector representing a de-hazed digital image in which at least some haze effects in the input digital image are removed.

Note on claim 8: the tool returned "…the storage the processor…" and "…input digital image an atmospheric light factor…" with no comma. Punctuation there is as returned and was not cross-checked.

**Claim 14**. Google Patents, returned clause by clause.
> 14. A computer program product having instructions encoded in a non-transitory computer readable medium that when executed by one or more processors cause a process to be carried out, the process comprising: receiving input data representing an input digital image having a plurality of pixels; modeling a scene radiance vector of the input digital image as a function of the input digital image an atmospheric light factor, and a medium transmission for each of the pixels in the input digital image; calculating the medium transmission for each of the pixels in the input digital image based on a fractionally scaled variant of the corresponding pixel in the input digital image, the fractionally scaled variant being calculated using a scaling factor that is a function of the input digital image; filtering the medium transmission for each of the pixels in the input digital image using a smoothing function such that a given neighborhood of pixels corresponding to the medium transmission for each of the pixels in the input digital image is locally smooth; and recovering the scene radiance vector based at least in part on the filtered medium transmission for each pixel in the input digital image, the recovered scene radiance vector representing a de-hazed digital image in which at least some haze effects in the input digital image are removed.

### Dependent claims relevant to the definitions (Google Patents)

- **Claim 4**: "The method of claim 1, wherein the calculated medium transmission is defined as:" followed by an equation, rendered as **t ≥ (1 − A/I) / (1 − sA/I)**. Then: "wherein t represents the calculated medium transmission, I represents the input digital image, A represents the atmospheric light factor, and s represents a scaling factor."
  - image-ppubs text: "t ≥ 1 - A / I 1 - sA / I ( 7 )"
  - PDF OCR: "t = (1 - A f) / (1 - S A f)" (garbled)
- **Claim 5**: "The method of claim 4, wherein the scaling factor is defined as:" followed by an equation, rendered as **s(x) = 0.02/I(x) if I(x) > 0.1; 0.2 if I(x) ≤ 0.1**.
  - image-ppubs flattened text: "s ⁡ ( x ) = { 0.02 I ⁡ ( x ) , I ⁡ ( x ) > 0.1 0.2 , I ⁡ ( x ) ≤ 0.1".
  - The PDF OCR read the first case as "0.02" alone, which looks like a lost fraction bar.
- **Claim 6**: "wherein t is less than or equal to 1."
- **Claim 7**: "The method of claim 1, wherein the smoothing function includes one of a mean filter, a median filter and a minimum filter."
- **Claims 11, 12, 13** repeat claims 4, 5 and 7 for the system of claim 8, as returned by the tool.
- **Claims 17, 18, 19, 20** open with "The computer program product of claim 14, wherein the calculated…", "…of claim 17, wherein the scaling…", "…of claim 17, wherein t…" and "…of claim 14, wherein the smoothing…".
  - Their full text was not separately read.

### Description definitions (Google Patents, verbatim segments)

**"Fractionally scaled variant"**
- "The first constraint regarding content visibility relates the de-hazed scene J to a fractionally" / "scaled variant of the input image I:"
- Equation (6), rendered: **J = (I − A)/t + A ≥ sI**
- "where s is a small fraction in the range [0,1)."
- Equation (7), rendered: **t ≥ (1 − A/I)/(1 − sA/I)**. The page gives no derivation text between (6) and (7).

**"Scaling factor that is a function of the input digital image"**
- "Generally, the scaling factor s can be a function of the input image I."
- "For example, when I(x) is very small, s(x) may be large so that J(x) is not overly dark."
- "In some cases, the scaling factor s can be manually defined or learned based on training data."
- "For example, s can be defined as a function of I as follows:" followed by equation (8), rendered: **s(x) = 0.02/I(x) if I(x) > 0.1; 0.2 if I(x) ≤ 0.1**

**Lower bound (context)**
- Equation (5), rendered: max{1 − min_C(I^C/A^C), 1 − min_C(Ĩ^C/Ã^C)} ≤ t ≤ 1.
- "where Ĩc=1−Ic is the inverse image of Ic, and Ãc=1−Ac."
- "It will be noted that in equation (5), there is a large ambiguity in identifying the lower bound" / "for the medium transmission t."

**Filter (smoothing function)**
- "The second constraint regarding local smoothness can be obtained by filtering the medium transmission t:"
- Equation (9), rendered: t2(x) = F({t1(y)}, y∈N(x))
- "For example, N(x) may include a squared p×p patch centered at x of a superpixel (e.g., group of pixels)" / "that includes x, and F is a smoothing function, such as mean filtering, median filtering or minimum filtering."
- "In one embodiment, a superpixel with minimum filtering can be used to produce acceptable results."
- "After obtaining medium transmission t2, a joint filtering method can be used to align the medium" / "transmission with the image content (e.g., the edges)." The page also says "a joint bilateral filter or guided filter can be used."

**What the claims require as filter (from the claim text above)**
- Independent claims 1, 8 and 14 say "a smoothing function, such that a given neighborhood of pixels corresponding to the medium transmission … is locally smooth". They name no specific filter.
- Dependent claims 7, 13 and (by its opening words) 20 say the smoothing function "includes one of a mean filter, a median filter and a minimum filter".
- No claim read names a guided or bilateral filter. Those appear only in the description, as the later "joint filtering" step.

**Atmospheric light**
- "A is the global atmospheric light or airlight, which is ambient light scattered by particulates in the atmosphere".
- The description as read gives no method for estimating A. It only says "even in cases where atmospheric light A is well-estimated" and refers to "incorrect atmospheric light estimation".
- "Dark channel" and He et al. appear only in the citation lists, not in the description body.

### Element-by-element facts: claim 1 vs darktable `hazeremoval.c`

| # | Claim 1 element (quoted) | Corresponding darktable quantity (code) |
|---|---|---|
| 1a | "receiving, by a processor, input data representing an input digital image having a plurality of pixels" | `img_in`, the module's float input buffer in `process` (4 channels per pixel; `guided_filter(..., width, height, 4, ...)`). |
| 1b | "modeling a scene radiance vector of the input digital image as a function of the input digital image, an atmospheric light factor, and a medium transmission for each of the pixels" | No separate modeling step in the file. The recovery line uses input pixel, `A0` and per-pixel `t`: `res[c] =  (in[4*i + c] - c_A0[c]) / t + c_A0[c];`. The header comment cites He et al.'s dark-channel paper. |
| 1c | "calculating, by the processor, the medium transmission for each of the pixels … based on a fractionally scaled variant of the corresponding pixel in the input digital image" | `_transition_map`: `const float m = MIN(MIN(pixel[0] * A0_inv[0], pixel[1] * A0_inv[1]),` … then `out_data[i] = 1.f - m * strength;`, followed by `dt_box_max(img2.data, img2.height, img2.width, 1, w);`. The quantity multiplied by a factor is `m` = min over channels of pixel/A0. For comparison, the patent's description (eq. 6–7) uses J ≥ sI and t ≥ (1 − A/I)/(1 − sA/I). darktable's expression is t = 1 − strength·min_c(I_c/A0_c). |
| 1d | "the fractionally scaled variant being calculated using a scaling factor that is a function of the input digital image" | The factor in darktable's transmission line is `strength`, a user parameter: `float strength; // $MIN: -1.0 $MAX: 1.0 $DEFAULT: 0.2`. No line in `hazeremoval.c` computes `strength` from the image. Quantities that are computed from the image: `A0` (from `_ambient_light`) and `distance_max` (`-1.125f * logf(crit_haze_level)`), which sets `t_min` and not the transmission estimate. |
| 1e | "filtering, by the processor, the medium transmission for each of the pixels … using a smoothing function, such that a given neighborhood of pixels corresponding to the medium transmission … is locally smooth" | Three operations on the transmission map, in this order: (1) `dt_box_max(..., w)` in `_transition_map`; (2) `dt_box_min(trans_map.data, trans_map.height, trans_map.width, 1, w1);` (comment `// refine the transition map`); (3) `guided_filter(img_in.data, trans_map.data, trans_map_filtered.data,` `width, height, 4, w2, eps, 1.f, -FLT_MAX, FLT_MAX);`, guided by the colour input, with `w2 = 3 + (int)ceilf(6.0f * wscale)` and `eps = sqrtf(0.025f)`. Window `w1 = 2 + (int)ceilf(4.0f * wscale)`. For comparison, dependent claim 7's list is "a mean filter, a median filter and a minimum filter". darktable's `dt_box_min` is a box minimum, `dt_box_max` a box maximum, and `guided_filter` a He guided filter. darktable's `guided_filter` implementation (src/common) was not examined. |
| 1f | "recovering, by the processor, the scene radiance vector based at least in part on the filtered medium transmission for each pixel …, the recovered scene radiance vector representing a de-hazed digital image" | Final loop in `process`: `const float t = MAX(c_trans_map_filtered.data[i], t_min);` then `res[c] =  (in[4*i + c] - c_A0[c]) / t + c_A0[c];`, with `const float t_min = CLAMP(expf(-distance * distance_max), 1.0f / 1024.0f, 1.0f);`. |

Claims 8 and 14 contain the same five method elements as claim 1. Claim 8 adds "a storage" and "a processor operatively coupled to the storage". Claim 14 adds "instructions encoded in a non-transitory computer readable medium". The darktable quantities above apply to the same elements. Neither of those additions is in the source file; they concern the executing hardware and medium.

---

## Item 2: US 9,305,339 B2

Sources:
- Google Patents: https://patents.google.com/patent/US9305339B2/en (page text 124,146 chars; claims and Legal Events **not reached**, see Blocked sources)
- PDF: https://patentimages.storage.googleapis.com/af/4f/e5/27975367a3ebd1/US9305339.pdf (OCR)
- USPTO text: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9305339

### Bibliographic facts

| Field | Value (quoted) | Source |
|---|---|---|
| Title | "Multi-feature image haze removal" (PDF OCR reads "MULT-FEATURE") | Google; PDF |
| Inventors | Jianchao Yang; Jue Wang; Ketan Tang | Google; PDF |
| Assignee | Current "Adobe Inc"; original "Adobe Systems Inc"; PDF "Adobe Systems Incorporated, San Jose, CA (US)" | Google; PDF |
| Application | US14/320,987, filed 2014-07-01 ("Filed: Jul. 1, 2014") | Google; PDF |
| Priority date | 2014-07-01, with the caveat "The priority date is an assumption and is not a legal conclusion." | Google |
| Pre-grant publication | US 2016/0005152 A1, Jan. 7, 2016 | PDF |
| Grant | "Date of Patent: Apr. 5, 2016"; Google "2016-04-05 Publication of US9305339B2" | PDF; Google |
| Term adjustment | "Subject to any disclaimer, the term of this patent is extended or adjusted under 35 U.S.C. 154(b) by 0 days." | PDF |
| Status | "Status Active legal-status Critical Current"; "2034-07-01 Anticipated expiration legal-status Critical". Caveat: "The legal status is an assumption and is not a legal conclusion. Google has not performed a legal analysis and makes no representation as to the accuracy of the status listed." | Google |
| Maintenance fees / Legal Events | **Not found**. The table was beyond the fetch tool's text limit on both US9305339B2 and US20160005152A1. | — |

### Independent claims (verbatim)

The independent claims are 1, 13 and 18. Claims 2–12 depend on 1, 14–17 on 13, and 19–20 on 18. Text is from image-ppubs, cross-checked against the PDF OCR. The OCR differs only in artifacts: "dehaZe", "Suitable", "Saturation", "infor mation" and ":" for ";".

**Claim 1**
> 1. A method implemented by a computing device, the method comprising: extracting feature maps from a hazy image of a scene, each of the feature maps conveying information about visual characteristics of the scene captured in the hazy image; computing portions of light that are not scattered by atmosphere and are captured from the scene to produce the hazy image, including using a trained model that derives the portions of light based on the visual characteristics conveyed by the feature maps; ascertaining, based on at least one of the feature maps, airlight of the hazy image that represents constant light of the scene; and generating a dehazed image from the hazy image using the computed portions of light and the calculated airlight.

**Claim 13**
> 13. A method implemented by a computing device, the method comprising: obtaining input to dehaze an image of a scene; and generating a dehazed image of the scene, in part, by using a trained model to compute portions of light that are not scattered by atmosphere and are captured to produce the image and reflect an assessment of at least two of: dark-channel information extracted from the image at multiple different resolutions, the dark channel information that is extracted at each of the resolutions being suitable to generate a dark channel feature map that corresponds to the resolution; contrast information extracted from the image; hue-disparity information extracted from the image by determining a hue-disparity between pixels of the image and pixels of a semi-inverse of the image; or saturation information extracted from the image.

**Claim 18**
> 18. A system comprising: one or more processors; and a memory configured to store computer-readable instructions that are executable by the one or more processors to perform operations comprising: displaying a scene via a user interface; and responsive to receiving an input via the user interface to remove haze from the displayed scene: adjusting pixels of the displayed scene to remove the haze, the pixels being adjusted based on an assessment, performed using a trained model, of multiple different visual characteristics of the scene; and after the adjusting, applying a filter that modifies the adjusted pixels so that one or more visual characteristics of the adjusted pixels resemble the one or more visual characteristics of the pixels before the haze was removed.

### Description definitions (Google Patents, verbatim segments)

- **Trained model.** The module "is configured to train a model (e.g., a Random Forest model) to provide the transmission". It "may train the model using machine-learning techniques".
- **Feature maps.**
  - "dark-channel of the hazy image 204 at multiple different resolutions"
  - "max contrast within a local region of the hazy image 204 at multiple different resolutions"
  - "hue-disparity between a semi-inverse image of the hazy image 204 and the hazy image 204 itself"
  - "max pixel-wise saturation within a local region of the hazy image 204"
- **Airlight.** It is found from "a subset of pixels (e.g., one-percent of pixels) that have the largest dark-channel values". The airlight of the pixel in that subset with the median dark-channel value is used (paraphrase by the fetch tool).
- **Post-adjustment filter.** A guided filter is applied to "filter the dehazed image initially recovered so that the resulting dehazed image is visually pleasing". There are two variants: a guided adaptive airlight filter and a guided brightness scaling filter ("employ a filter that scales the brightness of the resulting images").

### Element-by-element facts vs darktable `hazeremoval.c`

| # | Claim element (quoted) | Corresponding darktable quantity (code) |
|---|---|---|
| 1a | "extracting feature maps from a hazy image of a scene, each of the feature maps conveying information about visual characteristics of the scene" | One dark channel map, in `_dark_channel`: `float m = MIN(MIN(pixel[0], pixel[1]),pixel[2]);` then `dt_box_min(img2.data, img2.height, img2.width, 1, w);`. It is computed at a single window `w1` and used inside `_ambient_light`. No other feature map is computed. |
| 1b | "computing portions of light that are not scattered by atmosphere … including using a trained model that derives the portions of light based on the visual characteristics conveyed by the feature maps" | Transmission `out_data[i] = 1.f - m * strength;` in `_transition_map`. **No corresponding step** for "a trained model": the file contains no trained or learned model. |
| 1c | "ascertaining, based on at least one of the feature maps, airlight of the hazy image that represents constant light of the scene" | `A0` from `_ambient_light`. Pixels are selected by dark-channel quantile (`const float dark_channel_quantil = 0.95f;`) and then by brightness (`const float bright_quantil = 0.95f;`). A0 is averaged with `A0[c] += pixel_in[c];` and `A0[c] /= N_bright_hazy;`. |
| 1d | "generating a dehazed image from the hazy image using the computed portions of light and the calculated airlight" | `res[c] =  (in[4*i + c] - c_A0[c]) / t + c_A0[c];` |
| 13a | "obtaining input to dehaze an image of a scene" | Module parameters `strength` and `distance` (the module's inputs). |
| 13b | "using a trained model to compute portions of light …" | **No corresponding step** (no trained model). |
| 13c | "dark-channel information extracted from the image at multiple different resolutions … a dark channel feature map that corresponds to the resolution" | The dark channel is computed at one window size `w1` (`w1 = 2 + (int)ceilf(4.0f * wscale)`). **No corresponding step** for multiple resolutions. |
| 13d | "contrast information extracted from the image" | **No corresponding step.** |
| 13e | "hue-disparity information … between pixels of the image and pixels of a semi-inverse of the image" | **No corresponding step.** |
| 13f | "saturation information extracted from the image" | **No corresponding step.** |
| 18a | "one or more processors; and a memory configured to store computer-readable instructions …" | Not in the source file; this is the executing hardware. |
| 18b | "displaying a scene via a user interface; and responsive to receiving an input via the user interface to remove haze from the displayed scene" | Not examined. darktable's GUI and darkroom display are outside the processing code read. The parameters `strength` and `distance` are the module's user inputs. |
| 18c | "adjusting pixels of the displayed scene to remove the haze, the pixels being adjusted based on an assessment, performed using a trained model, of multiple different visual characteristics of the scene" | Pixel adjustment is the final recovery loop. **No corresponding step** for "a trained model". |
| 18d | "after the adjusting, applying a filter that modifies the adjusted pixels so that one or more visual characteristics of the adjusted pixels resemble the one or more visual characteristics of the pixels before the haze was removed" | The order in `process` is `_ambient_light`, `_transition_map`, `dt_box_min`, `guided_filter`, then the final per-pixel loop. The `guided_filter` call filters `trans_map` before the recovery loop. **No corresponding step**: `process` calls no filter after the recovery loop. |

---

## Item 3: US 10,367,976 B2

Sources:
- Google Patents: https://patents.google.com/patent/US10367976B2/en (whole page read; no truncation reported)
- PDF: https://patentimages.storage.googleapis.com/c2/25/81/b22e2633dd164f/US10367976.pdf (URL recorded, not read)
- USPTO text: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10367976 (fetch tool refused verbatim claims; summary only)

### Bibliographic facts (Google Patents)

| Field | Value (quoted) |
|---|---|
| Title | "Single image haze removal" |
| Inventors | Gregory K. Fleizach; Kristofor B. Gibson |
| Assignee | Current and original: "United States Department of the Navy" |
| Application | US15/711,838, filed 2017-09-21 |
| Priority date | 2017-09-21 ("The priority date is an assumption and is not a legal conclusion.") |
| Pre-grant publication | US20190089869A1, 2019-03-21 |
| Grant | 2019-07-30 |
| Status | "Active, expires 2037-12-27" ("Adjusted expiration"). Caveat: "The legal status is an assumption and is not a legal conclusion." Google makes no representation as to accuracy. |

Legal Events (Google Patents). Codes, titles and dates are verbatim. Free-format text is verbatim where shown in quotes; the other rows were paraphrased by the tool.

| Date | Code | Title | Text |
|---|---|---|---|
| 2017-09-21 | AS | Assignment | Fleizach and Gibson to the U.S. Navy (paraphrased) |
| 2017-09-21 | FEPP | Fee payment procedure | "ENTITY STATUS SET TO UNDISCOUNTED (ORIGINAL EVENT CODE: BIG.); ENTITY STATUS OF PATENT OWNER: LARGE ENTITY" |
| 2019-02-26 | STPP | Information on status: patent application and granting procedure in general | Non-final action mailed (paraphrased) |
| 2019-04-19 | STPP | (same) | Response to non-final action entered (paraphrased) |
| 2019-06-05 | STPP | (same) | Notice of allowance mailed (paraphrased) |
| 2019-06-14 | STPP | (same) | Issue fee payment verified (paraphrased) |
| 2019-07-10 | STCF | Information on status: patent grant | Patented case (paraphrased) |
| 2023-01-04 | MAFP | Maintenance fee payment | "PAYMENT OF MAINTENANCE FEE, 4TH YEAR, LARGE ENTITY (ORIGINAL EVENT CODE: M1551);" "ENTITY STATUS OF PATENT OWNER: LARGE ENTITY"; "Year of fee payment: 4" |

### Independent claims (verbatim, Google Patents)

The independent claims are 1, 7 and 12. Equations are given as the fetch tool rendered them from MathML and were not cross-checked against the PDF. The returned segments of claim 1 began without the claim number, so "[1.]" is supplied.

**Claim 1**
> [1.] A method for single image haze removal, comprising the steps of: receiving, at a memory device, an input image having pixels, wherein the input image is a color image having three color channels; converting, by a processor, each pixel in each channel of the input image to a floating-point value in a range of zero to one; performing, by the processor, a brightness correction on the converted input image; estimating, by the processor, an airlight value for the brightness-corrected input image, wherein the estimating step includes the step of computing a weighted average of the estimated airlight for each color channel for frames of a video according to equation: **A=((A+19·Aprev))/20** wherein A is the estimated airlight for a current frame, and Aprev is a weighted airlight value that is updated each frame to value A, and wherein the input image is a frame of the video, wherein the estimating step includes the step of reducing each of said pixels to a minimum value of the one or more color channels, thus resulting in a two-dimensional image, and wherein the estimating step further includes the steps of moving a window of a predetermined number of pixels across the 2D image pixel-by-pixel; and replacing each pixel with the minimum value found in said window of a predetermined number of pixels; calculating, by the processor, a transmission map for one or more color channels of the brightness-corrected input image; refining the transmission map for each said one or more color channels; and providing, by the processor, a haze-reduced image to the memory device.

**Claim 7**
> 7. A system for single image haze reduction, comprising: a memory configured to receive an input image having pixels; a processor operable to: convert each of said pixels in each channel of the input image to a floating-point value in a range of zero to one; perform a brightness correction on the converted input image; estimate the airlight for the brightness-corrected input image, wherein the processor is further operable to compute a weighted average of the estimated airlight value for one or more frames of a video according to the following equation: **A=((A+19·Aprev))/20** wherein A is the estimated airlight for a current frame, and A prev is a weighted airlight value that is updated each frame to value A, and wherein the input image is a frame of the video, and wherein the processor is further operable to estimate the airlight for the brightness-corrected input image by: reducing each of said pixels to a minimum value of the one or more color channels, thus resulting in a two-dimensional image; moving a window of a predetermined number of pixels across the two-dimensional image pixel-by-pixel; and replacing each pixel with the minimum value of the one or more color channels found in said window of a number of pixels; calculate a transmission map for one or more color channels of the brightness-corrected input image; refine the transmission map for each said one or more color channels, wherein the processor is further operable to refine the transmission map for each said one or more color channels using a mean filter; provide a haze-reduced image at the memory device, wherein the memory device is further configured to receive the haze-reduced image.

**Claim 12**
> 12. A method for single image haze removal, comprising the steps of: receiving, at a memory device, an underwater or air-based input image having pixels, wherein the input image is monochromatic or color; converting, by a processor, each pixel in each channel of the input image to a floating-point value in a range of zero to one; performing, by the processor, a brightness correction on the converted input image; estimating, by the processor, the airlight for the brightness-corrected input image, wherein the estimating step includes the step of computing a weighted average of the estimated airlight for frames of a video according to equation: **A = ((A + 19·A_prev))/20** wherein A is the estimated airlight for a current frame, and Aprev is a weighted airlight value that is updated each frame to value A, and wherein the input image is a frame of the video, and wherein the estimating step includes the step of reducing each of said pixels to a minimum value of the one or more color channels, thus resulting in a two-dimensional image; wherein the estimating step further includes the steps of moving a window of a predetermined number of pixels across the 2D image pixel-by-pixel; and replacing each pixel with the minimum value found in said window of a predetermined number of pixels; calculating, by the processor, a transmission map for one or more color channels of the brightness-corrected input image, wherein the step of calculating the transmission map is performed according to equation: **t̃^c = 1 − (w·I^c)/A^c** wherein w is a transmission map adjustment parameter that controls an amount of haze reduction, I is the input image, A is the airlight, and the superscript c denotes the transmission map calculations are conducted channel-by-channel; refining, by the processor, the transmission map for each said one or more color channels, wherein the step of refining the transmission map for each said one or more color channels is performed using a mean filter; and providing, by the processor, a haze-reduced image to the memory device, wherein the step of providing, by the processor, a haze-reduced image, is performed according to equation: **J^c = (I^c − A^c)/max(t^c, t0) + A^c** wherein J is the haze-reduced image, I is the brightness-corrected input image, A is the estimated airlight, t is a refined transmission map, t0 is a transmission map minimum and superscript c denotes the transmission map calculations are conducted channel-by-channel.

The claim 12 transmission equation is as rendered by the tool, with no min operator. It was not cross-checked against the PDF image.

### Description facts (Google Patents, verbatim segments)

- **Brightness correction:** "One way of performing such a gamma correction may be to compute the square root of the image's pixel values"
- **Minimum filter:** "a 15×15 minimum filter".
- **Airlight:** "The airlight, A, is calculated as the average of the pixels in the original image at those indices". Per the tool's paraphrase, these are the brightest 0.1 % of dark-channel pixels.
- **Refinement:** "the transmission map was refined with a simple mean filter size of 7×7 on each channel"
- **t0:** "A value of 0.075 was chosen since it de-hazes most of the depth of the scene"

### Element-by-element facts vs darktable `hazeremoval.c`

The table follows claim 12, the most detailed claim. Claims 1 and 7 share elements a–g. Claim 7 adds the mean filter, and claim 12 adds the equations.

| # | Claim element (quoted) | Corresponding darktable quantity (code) |
|---|---|---|
| a | "receiving, at a memory device, an underwater or air-based input image having pixels, wherein the input image is monochromatic or color" (claim 1: "a color image having three color channels") | `img_in`, a 4-channel float buffer (`guided_filter(..., 4, ...)`; `for_each_channel`). |
| b | "converting, by a processor, each pixel in each channel of the input image to a floating-point value in a range of zero to one" | **No corresponding step** in `hazeremoval.c`. The module receives a float buffer from the pipeline; the file contains no conversion or normalisation to [0,1]. |
| c | "performing, by the processor, a brightness correction on the converted input image" | **No corresponding step.** The file contains no gamma, square-root or brightness correction. Its only `sqrt` is `const float eps = sqrtf(0.025f);`. |
| d | "estimating, by the processor, the airlight … computing a weighted average of the estimated airlight for frames of a video according to equation: A = ((A + 19·A_prev))/20 … wherein the input image is a frame of the video" | Airlight `A0` from `_ambient_light`, a per-image average (`A0[c] /= N_bright_hazy;`). **No corresponding step** for the frame-to-frame weighted average or for video frames: the file has no temporal averaging. |
| e | "reducing each of said pixels to a minimum value of the one or more color channels, thus resulting in a two-dimensional image" | `_dark_channel`: `float m = MIN(MIN(pixel[0], pixel[1]),pixel[2]);` |
| f | "moving a window of a predetermined number of pixels across the 2D image pixel-by-pixel; and replacing each pixel with the minimum value found in said window" | `_dark_channel`: `dt_box_min(img2.data, img2.height, img2.width, 1, w);` with `w = w1 = 2 + (int)ceilf(4.0f * wscale)`. |
| g | "calculating, by the processor, a transmission map for one or more color channels … according to equation: t̃^c = 1 − (w·I^c)/A^c … calculations are conducted channel-by-channel" | `_transition_map`: one single-channel map, `out_data[i] = 1.f - m * strength;`, where `m` = min over the three channels of `pixel[c] * A0_inv[c]`. The user parameter `strength` is in the position of the claim's `w`. The map is computed once from the per-pixel channel minimum, not separately per channel. A `dt_box_max(..., w)` follows. |
| h | "refining, by the processor, the transmission map for each said one or more color channels, wherein the step of refining … is performed using a mean filter" (claim 1: "refining the transmission map"; claim 7: "using a mean filter") | Refinement in darktable: `dt_box_max` (in `_transition_map`), `dt_box_min(trans_map.data, …, w1)` (`// refine the transition map`), then `guided_filter(img_in.data, trans_map.data, trans_map_filtered.data, width, height, 4, w2, eps, 1.f, -FLT_MAX, FLT_MAX)`. Neither `dt_box_min` nor `dt_box_max` is a mean filter. The internals of darktable's `guided_filter` (src/common) were not examined. |
| i | "providing, by the processor, a haze-reduced image … according to equation: J^c = (I^c − A^c)/max(t^c, t0) + A^c" | `const float t = MAX(c_trans_map_filtered.data[i], t_min);` then `res[c] =  (in[4*i + c] - c_A0[c]) / t + c_A0[c];`. Here `t_min = CLAMP(expf(-distance * distance_max), 1.0f / 1024.0f, 1.0f)` is image- and parameter-dependent; the patent description gives t0 = 0.075. darktable's `t` is a single map shared by all channels. |

---

## Item 10: US 8,340,461 B2: lapse date and fee event

Sources:
- Google Patents: https://patents.google.com/patent/US8340461B2/en and https://patents.google.com/patent/US20110188775A1/en
- PDF: https://patentimages.storage.googleapis.com/53/4d/e1/13f576a06c32cf/US8340461.pdf
- Justia (secondary source): https://patents.justia.com/patent/8340461

| Fact | Value (quoted) | Source | Verdict |
|---|---|---|---|
| Title | "Single image haze removal using dark channel priors" | Google | Confirmed |
| Inventors | Jian Sun, Kaiming He, Xiao-ou Tang | Google | Confirmed |
| Assignee | Original "Microsoft Corp"; current "Microsoft Technology Licensing LLC" (assigned 2014-12-09) | Google | Confirmed |
| Application | "Appl. No.: 12/697,575", "Filed: Feb. 1, 2010" | PDF; Justia (secondary) | Confirmed |
| Grant | "Date of Patent: Dec. 25, 2012" | PDF | Confirmed |
| Term adjustment | "Subject to any disclaimer, the term of this patent is extended or adjusted under 35 U.S.C. 154(b) by 507 days." | PDF front page | Confirmed |
| Status | "Expired - Fee Related, expires 2031-06-23"; "Status Expired - Fee Related legal-status Critical Current"; "2031-06-23 Adjusted expiration legal-status Critical". Caveat: "The legal status is an assumption and is not a legal conclusion." "Google has not performed a legal analysis and makes no representation as to the accuracy of the status listed." | Google (both pages) | Confirmed |
| Lapse date | Not shown in any reachable source. The Google "Info" timeline has no lapse or expiry event line; it lists only filing, assignments, publications, grant and "Adjusted expiration". | — | **Not found** |
| Fee event (which maintenance fee was not paid; EXP/REM codes) | The Legal Events table was beyond the fetch tool's text limit on both Google pages. Patent Center, the USPTO fee site and the Open Data Portal returned only JavaScript shells. | — | **Not found** |

**Orientation only.** This is statutory arithmetic, not a record of what happened. For a patent granted 2012-12-25, the 3.5-, 7.5- and 11.5-year maintenance-fee due dates fall on 2016-06-25, 2020-06-25 and 2024-06-25. The six-month surcharge periods end on 2016-12-25, 2020-12-25 and 2024-12-25. Which of these the "Fee Related" expiry follows is not established by any source read.

---

## Blocked or limited sources

| URL | What happened |
|---|---|
| https://patents.google.com/patent/US9305339B2/en | Page text reported as 124,146 chars. Reads at offsets 0, 30000, 60000, 100000, 112000, 120000 and 123000 all returned description text only; the text ends mid-"Guided Brightness Scaling". The claims section and Legal Events were never reached, so the claims were taken from image-ppubs and the PDF. |
| https://patents.google.com/patent/US20160005152A1/en | Legal Events not in the 0–100000 portion (page 125,130 chars). Not pursued further. |
| https://patents.google.com/patent/US8340461B2/en (and the variant without `/en`) | Page text reported as 122,607 chars. The text ends inside claim 16 ("16. The system of claim 15 wherein"). Legal Events not reachable. |
| https://patents.google.com/patent/US20110188775A1/en | Page text 120,889 chars. The text ends in the Conclusion ("…is not necessarily limited to"). No Legal Events. |
| https://patents.google.com/xhr/result?id=patent/US8340461B2/en | `ROBOTS_DISALLOWED`. |
| https://patentcenter.uspto.gov/applications/12697575 | JavaScript shell only (title "Patent Center", meta "PatentCenter UI"); no status data. |
| https://data.uspto.gov/patent-file-wrapper/search/details/12697575/application-data | JavaScript shell only (ODP description metadata). |
| https://fees.uspto.gov/MaintenanceFees/ | JavaScript shell only (title "USPTO Fee Processing"); no lookup form rendered. |
| https://www.uspto.gov/web/offices/com/sol/notices/expire.html | Reachable, but its list of expired patents ends December 26, 1995. |
| https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9508126 | Reachable. Text only, no front-page bibliographic data. Used for eq. 7/8 and claim 5. |
| https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8340461 | Reachable. No front-page bibliographic data, so the PTA was taken from the Google PDF instead. |
| https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10367976 | Reachable, but the fetch tool refused verbatim claims and gave a summary. Claims 1/7/12 could not be cross-checked. |
| https://patents.google.com/patent/US9508126B2/en (claims 8, 14) | The first verbatim requests were refused with a paraphrase. The clause-by-clause request succeeded. |
| https://github.com/darktable-org/darktable/commits/master/src/iop/hazeremoval.c | `ROBOTS_DISALLOWED`, so the commit hash of the master file read was not recorded. |
| PDF https://patentimages.storage.googleapis.com/c2/25/81/b22e2633dd164f/US10367976.pdf | URL recorded; not read. |


---

# Effects verification, part 2: prior-art searches and Camera Raw Glow (items 4 to 9)

Read date for every source: **2026-10-17**. Brief: `/home/claude/effects/BRIEF.md` (items 4, 5, 6, 7, 8, 9 only).

**Method.** Pages were read with WebFetch and searches run with WebSearch. No curl, wget or Python fetching was used. WebFetch's extraction model returns short verbatim fragments (under about 125 characters each), so long claims appear as an opening excerpt plus a summary marked as such. "Secondary" means the source is not Adobe, a patent office or the patent owner. Google Patents status is quoted together with its caveat, "The legal status is an assumption and is not a legal conclusion." **This file records facts only. It gives no legal conclusions.** An empty search is reported as "None found (search terms: ...)". It does not mean that no such patent exists.

**Comparison with batch 2** (`/home/claude/verify2/A_COLOUR_MIXER_EFFECTS.md`, items 12 and 13 and the Glow note):
- The batch 2 results ("Not found, inconclusive") still stand for the local Laplacian and guided-filter patents. Justia inventor listings, blocked in batch 2, could be read this time. They list no Laplacian-filter patent by Sylvain Paris and no guided-filter patent by Kaiming He.
- Batch 2 dated the Camera Raw Glow help page "updated on 27 August 2026". The my_en copy now reads "Last updated: 31 Aug 2026".
- Batch 2 did not check whether Lightroom Classic has Glow. It is resolved below: Glow is absent from Lightroom Classic and Lightroom as of the Adobe pages updated 29 September 2026.

## Verdict summary

| Item | Topic | Verdict | One-line fact |
|---|---|---|---|
| 4 | Local Laplacian filter patents (Paris, Hasinoff, Kautz; Aubry et al.) | **Not found** | Sylvain Paris's full Justia listing (4 pages) has no Laplacian or local-Laplacian patent. The only Laplacian-pyramid contrast patents found are by other inventors (Thomson, expired; New Medical, abandoned). |
| 5 | Guided-filter patent (He, Sun, Tang; Microsoft) | **Not found** for He/Microsoft. **Third-party variants found.** | Kaiming He's full Justia listing (2 pages, 29 entries) has no guided-filter patent. Variant patents exist from others: A\*STAR **US 9,754,356** ("Active", weighted guided filter **plus haze removal** in claim 1), NEC/Tokyo Tech US 10,943,339 ("Active") and Thomson CN104463819B ("Expired - Fee Related"). |
| 6 | Adobe Texture / Clarity patents | **Partly** | No Adobe patent naming a Texture or Clarity control was found. Adobe **US 8,666,194** (per-band frequency editing with sliders) shows "Active, expires 2031-09-06". The Adobe HDR base/detail-layer patents US 9,230,312 and US 8,831,340 are both "Active". The Adobe blog defines Texture as "mid-frequency". |
| 7 | Post-crop vignette Highlight / Color Priority patent | **Not found** | The closest is Adobe US 9,830,717 (face-aware vignettes, "Active, expires 2035-12-11"). Its claims recite no highlight protection or hue preservation. |
| 8a | Glow help page (styles, sliders, masks) | **Confirmed** | Diffusion / Bloom / Halation. Range, Spread and Warmth are global; only the Glow amount is set per mask. |
| 8b | Glow numeric ranges and defaults | **Not found** (Adobe); **Partly** (secondary) | No numbers appear on Adobe's page. Secondary: the Glow default is zero. A user test set "Glow 100, Range 100 ... Warmth +100". |
| 8c | Glow release version and date | **Confirmed** | Camera Raw 18.6, "August 2026". An Adobe employee announced it on 25 Aug 2026; the Community announcement is dated 27 Aug 2026. |
| 8d | Glow in Lightroom Classic or Lightroom (Oct 2026) | **Confirmed absent** | LrC 15.6 and Lr 9.6 (Sept 2026) pages: "Glow" does not appear. Adobe: "Our goal is to eventually port these features into the Lightroom clients." |
| 8e | crs: field names | **Partly** (secondary only) | GlowRange, GlowSpread, GlowStyle, GlowWarmth (rawmakase PR #171, 5 Oct 2026). The amount field's name was not found. ExifTool (latest history entry 27 May 2026) has no Glow tags. |
| 9 | Glow / bloom / halation patents (Adobe 2024 to 2026) | **Not found** | No Adobe filing was found. Context: Microsoft US 7,202,867 "Generation of glow effect" shows "Expired - Lifetime, expires 2024-03-14". |

---

## Item 4. Local Laplacian filters (Paris, Hasinoff, Kautz; Aubry et al.): **Not found**

**Searches (all empty of a local-Laplacian patent):**
- WebSearch `site:patents.google.com "Sylvain Paris" "Laplacian pyramid"`. Results were papers plus two unrelated pyramid patents (US 9,317,898; EP 2,556,490).
- `site:patents.google.com Adobe "local Laplacian" Paris Hasinoff`. Papers only.
- `patent "Paris; Sylvain" Adobe "Laplacian pyramid" edge-aware`. Papers only.
- `site:patents.google.com "Laplacian pyramid" "remapping function" edge-aware Adobe`. Papers only.
- `site:patents.google.com inventor "Sylvain Paris" Adobe image pyramid detail manipulation`. Result: US 9,036,909 (see below).
- `site:patents.google.com "Aubry" "fast local Laplacian" OR "local Laplacian filter"`. Papers only.
- `site:patents.google.com "Hasinoff" "Laplacian" pyramid Google tone mapping OR detail`. Results: US 8,639,056 and US 2010/0142790 A1 (other inventors).

**Justia inventor listing, Sylvain Paris** (https://patents.justia.com/inventor/sylvain-paris, pages 1 to 4, 67 entries; the fetch summarised titles and abstracts):
- Page 1: "No titles contain any of these terms" (Laplacian, pyramid, edge-aware, detail, contrast, texture, tone).
- Page 2: the only pyramid title is "Pyramid collapse color interpolation" (9036909). "Methods and apparatus for performing tone mapping on high dynamic range images" (9230312) is flagged for "detail layer".
- Page 3: "Laplacian, edge-aware, contrast, clarity, haze: no matches."
- Page 4: MIT patents 8081838 ("two-scale tone management") and 7945107. "no mentions of Laplacian, pyramid, edge-aware".

**Project pages:**
- https://people.csail.mit.edu/sparis/publi/2011/siggraph has no patent or licence statement. Its acknowledgement reads: "gifts from Microsoft, Google and Adobe."
- https://imagine.enpc.fr/~aubrym/projects/llf/index.html (Fast LLF, Aubry, Paris, Hasinoff, Kautz, Durand, TOG 2014) has no patent statement. Its only rights wording is "Copyright and all rights therein are maintained by the authors or by other copyright holders".

| Number | Title | Assignee | Inventors | Priority | Status (Google Patents, quoted) | Claim 1 gist |
|---|---|---|---|---|---|---|
| US 9,036,909 B2 | "Pyramid collapse color interpolation" | "Adobe Inc" (orig. "Adobe Systems Inc") | Sylvain Paris, James McCann | 2013-01-28 | "Active, expires 2033-07-12" ("The legal status is an assumption and is not a legal conclusion.") | Hole filling, not tone or detail. The abstract covers "receiving an image with a set of undefined pixels and a set of defined pixels" and "recursively modifying the image to generate a seamless composition". The fetch found no mention of Laplacian or edge-aware filtering. Claim 1 was not read. |
| US 8,639,056 B2 | "Contrast enhancement" | "Thomson Licensing DTV SAS" (orig. "Thomson Licensing SAS") | Jiefu Zhai, Joan Llach | 2009-06-29 | "Expired - Fee Related", "2030-06-28 Anticipated expiration" (same caveat) | Claim 1 (ppubs PDF): "A method for enhancing contrast of an image comprising: accessing at least one original image;" "generating a multi-scale signal representation ...". Summary: Laplacian (bandpass) pyramid, power-function boost pyramid, top level unchanged, α in [0,1], β in [0,2]. Independent claims 1, 4, 7. The page does not visibly cite Paris et al. |
| US 2010/0142790 A1 | "Image processing method capable of enhancing contrast and reducing noise of digital image ..." | "NEW MEDICAL Co Ltd" | Jimmy Chang | 2008-12-04 | "Abandoned" (same caveat) | Abstract: "(a) decomposing an original image into a plurality of detail images at successive resolution levels;" Description: "the present invention chooses Laplacian Pyramid transformation as multi-scale kernel." |

Context, not a patent: EP 2,556,490 A2, "Generation of multi-resolution image pyramids" (Microsoft; Hoppe, Han, Uyttendaele; priority 2010-04-05). Status "Not-in-force" (same caveat). It concerns building a pyramid for coarse-to-fine imagery and does not mention local Laplacian filtering.

**Gaps:** The Justia Hasinoff page failed (CLIENT_ERROR). Jan Kautz's patents (NVIDIA) were not listed. Google Patents' assignee-filtered search cannot be read by WebFetch.

---

## Item 5. Guided filter (He, Sun, Tang; Microsoft): **Not found** for He or Microsoft; third-party variants found

**Searches:**
- `site:patents.google.com "Kaiming He" "guided filter"`. Result: CN104463819B (Thomson) plus papers.
- `site:patents.google.com "guided image filter" Microsoft "Jian Sun" "Kaiming He"`. Result: US 10,943,339 (NEC) plus papers.
- `patents.justia.com inventor jian-sun Microsoft haze OR "guided filter" OR "dark channel"`. Result: US 9,754,356 (A\*STAR) and US 8,340,461.
- `site:patents.google.com Microsoft "guidance image" "local linear" filter edge-preserving "Jian Sun" OR "Xiaoou Tang"`. Papers only.

**Justia inventor listing, Kaiming He** (https://patents.justia.com/inventor/kaiming-he, pages 1 and 2, 29 entries). It contains no guided-filter title. The Microsoft-era image entries are "Single image haze removal using dark channel priors" (8340461), "Interactive image matting" (8386964), "Variable kernel size image matting" (8625888) and "Opacity measurement using a global pixel set" (8855411), plus later Microsoft and Meta deep-learning patents. Page 1: "No literal matches for any of the six terms" (guided filter, filtering, haze, dark channel, matting, edge-preserving).

**Project page** (https://people.csail.mit.edu/kaiming/eccv10/index.html): no patent or licence statement. It says "Guided Filter is included in official MATLAB 2014 as a new function." and "Guided Filter is included in official OpenCV 3.0 as a new function." He's affiliation is given as "Microsoft Research."

| Number | Title | Assignee | Inventors | Priority | Status (quoted) | Claim 1 gist |
|---|---|---|---|---|---|---|
| **US 9,754,356 B2** | "Method and system for processing an input image based on a guidance image and weights determined thereform" [sic] | "Agency for Science, Technology and Research" | Zhengguo Li, Jinghong Zheng, Zijian Zhu, Shiqian Wu, Wei Yao, Susanto Rahardja | 2013-04-12 (SG 201302802-2) | "Active", "2034-04-11 Anticipated expiration" ("The legal status is an assumption and is not a legal conclusion.") | ppubs PDF opening: "A method for processing an input image, the input image comprising a plurality of pixels, the method comprising:". Summary (not verbatim): base and detail layers from a linear transform guided by a guidance image; a per-pixel local variance in a window sets a weight; **the input is treated as an initial transmission map for haze removal using the luminance channel; atmospheric light is estimated from a dark intensity channel; haze removal follows from the map.** Independent claims 1 (method), 10 (system), 16 (CRM). Google Patents does not cite He et al. by name ("guided filter" without attribution). |
| US 10,943,339 B2 | "Image compositing system, image compositing method, and image compositing program recording medium" | "NEC Corp", "Tokyo Institute of Technology" | Takashi Shibata, Masatoshi Okutomi, Masayuki Tanaka | 2016-11-07 | "Active, expires 2037-11-29" (same caveat) | Abstract: "The present invention enables a high-quality filtered image to be generated even from multimodal and multispectral images". Summary: several deformed versions of the guide image, reliability-weighted blending. Cites "Guided Image Filtering". Claim 1 was not read. |
| CN104463819B | "Image filtering method and device" | "InterDigital CE Patent Holdings SAS" (orig. "Thomson Licensing SAS") | Jobst Hörentrup, Markus Schlosser | 2013-09-20 | "Expired - Fee Related" (same caveat) | Abstract: "a method and apparatus (20) for filtering an image using a guided image filter." "A confidence weighted average is performed using the confidence values." Cites "Kaiming He等". Claim 1 was not read. |

Fact for the owner, with no opinion: claim 1 of US 9,754,356 combines a weighted guided filter with haze-removal steps (transmission map, atmospheric light from a dark channel). LightBench's Dehaze port also uses a guided filter with a dark channel and ambient light. Whether the elements correspond was **not** mapped here, because the full claim text was not captured verbatim (see Gaps).

**Gaps:** The full verbatim text of claim 1 of US 9,754,356 was not obtained. Google Patents' page text did not show the claims section at offsets 0, 20000, 100000 or 118000, and the PDF fetch returned only the opening plus a summary. The grant date was not captured. Jian Sun's and Xiaoou Tang's own Justia listings were not read.

---

## Item 6. Adobe Texture (2019) and Clarity: **Partly**

**Adobe's definition** (primary; Max Wendt, "From the ACR Team: Introducing the Texture Control", "05-14-2019"; https://blog.adobe.com/en/publish/2019/05/14/from-the-acr-team-introducing-the-texture-control):
- Texture is "best for making subtle adjustments to those mid-frequency features."
- Clarity is "best for making stronger adjustments to a broader frequency range, including some lower frequencies."
- The slider runs "the range from 1 to 100" for positive values and "the range from -1 to -100" for negative ones.
- The post mentions no patent or algorithm.

**Searches:**
- `site:patents.google.com Adobe "Max Wendt" image`. Results: US 8,731,319 and US 8,392,842 (layer stack and image search; the ppubs text shows neither inventors nor any texture or frequency adjustment).
- `site:patents.google.com Adobe "Eric Chan" texture OR clarity OR "local contrast" band-pass`. Results: non-Adobe local-contrast patents, plus Google's US 9,639,956.
- `site:patents.google.com Adobe "clarity" "local contrast" image editing slider`. No Adobe clarity patent.
- `site:patents.google.com Adobe "texture" "frequency band" image adjustment slider "Camera Raw" OR "Lightroom"`. Result: US 8,666,194.
- `site:patents.google.com "Mark Hamburg" Adobe contrast OR clarity OR "edge-preserving"`. Non-Adobe results.

**Inventor listings:**
- Justia "max-wendt" lists only Xylo Technologies floor panels, apparently a different person.
- Justia "eric-chan" page 1 (of 5 or more; mixed persons): Adobe entries are HDR visualisation and gain-map patents, and "None" match texture, clarity or contrast.
- Justia "mark-hamburg" pages 1 to 3 (55 entries): no contrast, clarity, local-contrast or detail matches. "texture" appears only in healing and blending abstracts.

| Number | Title | Assignee | Inventors | Priority | Status (quoted) | Claim 1 gist |
|---|---|---|---|---|---|---|
| **US 8,666,194 B2** | "System and method for editing frequency content of images" | "Adobe Inc" (orig. "Adobe Systems Inc") | Chintan Intwala | 2009-08-28 | "Active, expires 2031-09-06" ("The legal status is an assumption and is not a legal conclusion.") | ppubs: "A system, comprising: one or more processors; and a memory coupled to the one or more processors". Summary: transform the image into frequency content, display a sub-image of one frequency band (time-frequency representation), receive input to modify the content in a portion of that sub-image, modify only that portion. Independent claims 1, 8, 13. The description (summarised) covers low, mid and high bands with per-band amplify and attenuate sliders and a custom band-pass. It names no "texture" or "clarity" control. |
| US 9,230,312 B2 | "Methods and apparatus for performing tone mapping on high dynamic range images" | "Adobe Inc" | Sylvain Paris, Jen-Chan Chien, Eric Chan | 2010-01-27 | "Active, expires 2032-07-04" (same caveat) | ppubs: "A method, comprising: performing, by a computing device: decomposing a high dynamic range (HDR) image into a base layer" "including large-scale variations in contrast, a detail layer including small-scale variations in contrast". Summary: plus a colour layer; nonlinear base compression; layers shown as a selectable stack in the UI. Detail-layer adjustment appears only in dependent claims 4, 11 and 17. Independent claims 1, 8, 14. The description uses a bilateral filter, not a Laplacian pyramid. |
| US 8,831,340 B2 | "Methods and apparatus for tone mapping high dynamic range images" | "Apple Inc", "Adobe Inc" (orig. "Adobe Systems Inc") | Sylvain Paris, Jen-Chan Chien, Eric Chan | 2010-01-27 | "Active, expires 2033-06-20" (same caveat) | Abstract: "Luminance is processed to obtain a base layer and a detail layer." "and the detail layer is adjusted." "User interface elements may be provided via which a user may control one or more parameters". Claim 1 was not read. |
| US 9,639,956 B2 (not Adobe) | "Image adjustment using texture mask" | "Google LLC" | Krishnaswamy, Kulewski, Babacan, DiVerdi | 2013-12-19 | "Active, expires 2034-12-31" (same caveat) | Justia claim 1 excerpts: "determining one or more texture regions having detected texture in a first image;" "generating a mask image from the first image based on the detected texture regions," "to the first image in amounts based on the values of the mask image." It has no user "texture" slider. |

**Gaps:** No patent naming Adobe's Texture or Clarity controls was found. Google Patents' assignee and date filters cannot be read by WebFetch.

---

## Item 7. Post-crop vignette "Highlight Priority" / "Color Priority": **Not found**

**Adobe's definitions** (help page, https://helpx.adobe.com/my_en/camera-raw/using/vignette-grain-effects-camera-raw.html, "Last updated: 31 Aug 2026"):
- Highlight Priority: "Applies the postcrop vignette while protecting highlight contrast but can lead to color shifts in darkened areas"
- Color Priority: "Applies the postcrop vignette while preserving color hues but can lead to loss of detail in bright highlights."
- Paint Overlay: "Applies the postcrop vignette by blending original image colors with black or white."
- Highlights: "Available for a Highlight Priority or Color Priority effect when Amount is a negative value" and "Controls the degree of highlight "punch" in bright areas of an image,"
- Amount: "Positive values lighten the corners, negative values darken them." Midpoint, Roundness and Feather are as quoted in the page, with no numeric ranges given.

**Searches:**
- `site:patents.google.com Adobe vignette "highlight priority" OR "color priority" OR "paint overlay"`. Result: US 9,830,717 plus non-patent pages.
- `site:patents.google.com "Adobe" "vignette" effect cropped image corners darken "highlight" preserve`. Result: US 9,830,717.
- `Adobe patent artistic vignetting "post-crop" OR "postcrop" vignette highlight contrast`. Help pages only.
- `site:patents.google.com vignette "luminance" "highlights" protect ... midpoint roundness feather`. No patents.

| Number | Title | Assignee | Inventors | Priority | Status (quoted) | Claim 1 gist |
|---|---|---|---|---|---|---|
| US 9,830,717 B2 | "Non-destructive automatic face-aware vignettes" | "Adobe Inc" (orig. "Adobe Systems Inc") | Anant Gilra, Lance R. Lewis | 2015-11-05 | "Active, expires 2035-12-11" ("The legal status is an assumption and is not a legal conclusion.") | ppubs: "A computer-implemented method for generating non-destructive automatic face-aware vignettes, the method comprising:" "receiving a request to generate a vignette for an image that includes one or more salient objects displayed in the image;" "determining an aspect ratio of the image". Summary: boundary around faces or salient objects; eccentricity and "excess eccentricity" drive the parameters. Independent claims 1, 12, 17. Per the fetch, "No claim recites highlight protection or color/hue preservation". The description mentions recalculating on crop and a feather gradient, but not Highlight or Color Priority, Lightroom or Camera Raw. No continuations are listed. |

---

## Item 8. Camera Raw Glow (18.6, 2026)

### 8a. Help page "Glow, Vignette, Grain, and Dehaze effects in Camera Raw": **Confirmed**
Source: https://helpx.adobe.com/my_en/camera-raw/using/vignette-grain-effects-camera-raw.html ("Last updated: 31 Aug 2026"). The be_en copy was robots-blocked.
- "Use Glow to add a soft, luminous quality to your photos by diffusing highlights, blooming light sources," "and creating dreamy, atmospheric, or nostalgic looks directly in the Effects panel."
- Steps: "Open your photo in Camera Raw." "Select Edit > Effects." "Drag the Glow slider to the right to increase the effect." "As you raise the value, light blooms outward from the highlights in your photo."
- "Select a look from the Style dropdown menu:"
  - "Diffusion: A hazy, film-like softening that spreads across the frame. Great for dreamy landscapes and sunsets."
  - "Bloom: A soft, even glow across highlights. Ideal for soft, ethereal images such as waterfalls and misty scenes."
  - "Halation: A colored, retro halo around bright edges and light sources." "Suited to neon signs, night scenes, and vintage looks."
- "Range: Sets the tone where Glow is applied, from the brightest highlights to broader tonal ranges."
- "Spread: Controls how far the glow radiates from bright areas. Higher values create a wider, softer effect."
- "Warmth: Shifts the glow's color toward warmer or cooler tones, letting you match the effect to your scene's lighting."
- "For the Diffusion and Bloom styles, Warmth applies a cool-to-warm range," "whereas for Halation, it applies a yellow-to-red range."
- Masks: "You can also add Glow to specific parts of your photo using the Masking tool." "The Style, Range, Spread, and Warmth settings are global and shared across all masks," "while the Glow amount can be set independently for each mask."

Supporting secondary source (DPReview, Dale Baskin, "Published September 1, 2026", https://www.dpreview.com/news/adobe-adds-glow-to-camera-raw/): "masks control how much something glows, not the kind of glow."

### 8b. Ranges and defaults: **Not found** on Adobe pages; **Partly** from secondary sources
- Adobe's help page gives no numeric range or default for Glow, Range, Spread or Warmth (checked explicitly). The design document's "−100 to +100" for the per-mask amount was **not** confirmed by any source read.
- Secondary (Lenscraft, Robin Whalley, "Aug 27, 2026", https://lenscraft.co.uk/photo-editing-tutorials/adobe-camera-raw-glow-effect/): move the slider "from its default value of zero to the right." Holding Alt/Option on Range shows a mask: "The areas shown in white in the mask are where the Bloom effect is applied."
- Secondary user report (Adobe Community, HP Wild, August 30, 2026, https://community.adobe.com/questions-563/camera-raw-18-6-glow-schein-effect-not-updating-in-preview-until-camera-raw-cache-is-cleared-1639504): "Glow 100, Range 100, Spill 100 and Warmth +100". This was apparently a German UI ("Schein"). The signed "+100" on Warmth suggests it is bipolar. This is a user report, not a specification.
- Secondary (Fstoppers, Alex Cooke, "August 30th, 2026"): no numeric ranges; for Halation "the cool end is removed" (paraphrase by the fetch).

### 8c. Release version and date: **Confirmed**
- Camera Raw "What's new" (https://helpx.adobe.com/nz/camera-raw/desktop/whats-new/whats-new.html, last updated 28 September 2026): Glow sits under "August 2026 (version 18.6)" with the heading "Add a luminous glow to your photos" and "Create a soft, dreamy glow that spreads light from the brightest areas of your image using the new Glow feature." The current version is "September 2026 (version 18.7)".
- Camera Raw release notes (https://helpx.adobe.com/id_en/camera-raw/desktop/whats-new/release-notes.html, "Aug 31, 2026"), under "August 2026 release (version 18.6)": "Add a soft, luminous quality to your photos with the new Glow feature in the Effects panel." "You can also apply Glow selectively using masks for precise, local control."
- Adobe Community feature request "P: Glow, Bloom and Halation" (Lightroom Classic > Feature Requests; https://community.adobe.com/feature-requests-676/p-glow-bloom-and-halation-664800). Rikk Flohr, marked "Retired Adobe Employee", wrote on **August 25, 2026**: "Check out the new Glow Slider in today's Camera Raw with options for:" "Diffusion" / "Bloom" / "Halation"; "The August release (18.6) has an update regarding this feature request." The status changed "Open for Voting→In Development".
- Adobe Community announcement (Anshul_Saini, "Community Manager"), "**August 27, 2026**": "Camera Raw v18.6: Light Up Your Images with Glow, Create Transparent Cutouts with Trim ..." and "The headline addition is Glow, a new effect that creates a soft, luminous atmosphere". https://community.adobe.com/announcements-561/camera-raw-v18-6-light-up-your-images-with-glow-create-transparent-cutouts-with-trim-and-view-photo-details-with-the-new-metadata-info-panel-1638849
- **Date difference:** 25 Aug (Adobe employee's "today's Camera Raw") versus 27 Aug (Community announcement and the Lenscraft byline). Adobe's own pages say only "August 2026".

### 8d. Lightroom Classic and Lightroom as of October 2026: **Confirmed absent**
- Lightroom Classic "What's new" (https://helpx.adobe.com/ca/lightroom-classic/desktop/introduction-to-lightroom-classic/whats-new.html, "Last updated on Sep. 29, 2026"): latest "September 2026 (version 15.6)". **"Glow" does not appear.**
- Lightroom Classic release notes (https://helpx.adobe.com/at/lightroom-classic/desktop/introduction-to-lightroom-classic/release-notes.html, "Zuletzt aktualisiert am 29. September 2026"): latest "Version vom September 2026 (Version 15.6)". "Glow" does not appear.
- Lightroom (desktop) "What's new" (https://helpx.adobe.com/uk/lightroom/desktop/introduction/whats-new.html, "Last updated on 29 Sep 2026"): latest "September 2026 (version 9.6)". "Glow" does not appear.
- Adobe employee (Rikk Flohr, 25 Aug 2026, URL above): "New Edit features must be built inside Camera Raw before the Lightroom clients can adopt them." "Our goal is to eventually port these features into the Lightroom clients."
- Secondary: DPReview: "Glow is currently an ACR-only feature and isn't available in Lightroom." L'Art de la Photo (https://lartdelaphoto.fr/camera-raw-18-6-effet-glow/, "MIS À JOUR 10.10.2026"): « Au 10 octobre, Glow reste propre à Camera Raw » and « Lightroom Classic 15.6 et Lightroom 9.6, sortis le 29 septembre avec Camera Raw 18.7, ne l'ont pas reçu. » PetaPixel: "So far, this new Glow tool is only available inside Adobe Camera Raw in Photoshop".
- The newest Adobe page read is dated 29 September 2026. Nothing dated between 10 and 17 October 2026 was found.

### 8e. crs: field names: **Partly** (secondary source only)
- **Secondary (third-party code):** rawmakase PR #171, "Stop reporting Lightroom 15 controls that are at rest", opened and merged Oct 5, 2026 (https://github.com/pch/rawmakase/pull/171). It reads "listing GlowRange, GlowSpread, GlowStyle, GlowWarmth, HDRMaxValue, the seven SDR values and EnableDistractionRemoval." The commit message says "Lightroom 15 writes Glow's range, spread, style and warmth," and "Glow's controls do nothing while Glow is 0,". The page does not name the namespace (crs) or the amount field. "Glow at 0" implies an amount field whose name is not shown. Fact: these names were seen in records written by Lightroom 15, even though Lightroom 15 has no Glow UI.
- **ExifTool:** `XMP.pm` on master contains the `%Image::ExifTool::XMP::crs` table (it includes `PostCropVignetteAmount`, `PostCropVignetteStyle`, `GrainAmount`, `Texture`). It has **no line containing "Glow", "Halation" or "Bloom"**. https://raw.githubusercontent.com/exiftool/exiftool/master/lib/Image/ExifTool/XMP.pm
- exiftool.org/TagNames/XMP.html, read at offsets 60000, 100000, 125000 and 150000, showed no Glow tag. The extraction did not show the PostCropVignette rows either, so it was not a reliable full read.
- exiftool.org/history.html top entry: "May 27, 2026 - Version 13.59". The fetch reports "None" of the entries mention Glow. ExifTool's documentation predates Camera Raw 18.6.
- No public Camera Raw-written XMP containing Glow was found (search `"crs:GlowAmount" OR "crs:GlowStyle" OR "crs:GlowRange" OR "crs:GlowSpread"`, extended mode; `"GlowWarmth" OR "GlowSpread" crs XMP`). Adobe publishes no crs namespace page that was found.

---

## Item 9. Glow, bloom or halation patents (Adobe 2024 to 2026): **Not found**

**Searches:**
- `site:patents.google.com Adobe halation film simulation image`
- `site:patents.google.com Adobe "bloom" OR "glow" highlights image editing effect 2025`
- `site:patents.google.com Adobe "diffusion filter" OR "mist filter" simulate optical glow highlights spread image`
- `site:patents.justia.com Adobe glow bloom halation highlights effect 2025 2026`
- `"Adobe Inc." patent application halation OR "light bloom" OR "highlight glow" digital image 2025` (extended mode)
- `site:patents.google.com "halation" "film" simulate digital image red halo highlights rendering effect`
- Justia full-text search: "halation simulation" returned "did not match any patents". "simulated halation effect image" returned no match. "adobe glow effect highlights" returned no match. "halation" page 1 (20 results) listed no Adobe entry and none about adding simulated halation; the entries cover detecting or removing halation (Canon, Bosch, Olympus, Fujifilm) or anti-halation film layers (Kodak). Pages 2 to 5 were not read.

| Number | Title | Assignee | Inventors | Priority | Status (quoted) | Claim 1 gist |
|---|---|---|---|---|---|---|
| US 7,202,867 B1 (context, not Adobe) | "Generation of glow effect" | "Microsoft Technology Licensing LLC" (orig. "Microsoft Corp") | Owens Rodriguez, Sean E. Dunn | 2003-01-31 | "Expired - Lifetime, expires 2024-03-14" ("The legal status is an assumption and is not a legal conclusion.") | Abstract: "The technique selects an area within a scene that is to glow to produce a selected area image," "generates glow using the selected area image to produce a glowing area image, and then adds the glowing area image to the scene". Claim 1 was not read. |
| US 12,501,146 (context, not Adobe) | Image processing / image capturing apparatus (title and assignee not shown in the PDF text) | Not shown | Not shown | JP 2022-193344, "filed Dec. 2 2022" | Not read on Google Patents | "An image processing apparatus comprising: at least one processor and/or circuit configured to function as following units:". This is additive multi-frame composition with a simulated live view. "Halation" here means blown-out regions: claim 9 recites "emphasis-displays a halation region of the simulation image". It is not a glow effect. |

Note (general fact, not verified at source this session): US applications usually publish about 18 months after their earliest priority date. Adobe filings from 2025 to 2026 may therefore not yet be public.

---

## Blocked or failed sources

| URL | How it failed | Alternative used |
|---|---|---|
| https://helpx.adobe.com/be_en/camera-raw/desktop/edit-and-enhance-images/tone-and-color/vignette-grain-effects-camera-raw.html | WebFetch `ROBOTS_DISALLOWED` | my_en copy (camera-raw/using/...) |
| https://helpx.adobe.com/my_en/lightroom/desktop/introduction/whats-new.html | `ROBOTS_DISALLOWED` | uk copy |
| https://raw.githubusercontent.com/pch/rawmakase/main/src/xmp/apply.rs | `CLIENT_ERROR` | PR #171 page |
| https://patents.justia.com/inventor/samuel-w-hasinoff | `CLIENT_ERROR` | none |
| https://exiftool.org/forum/index.php?topic=11745.0 | Maintenance notice: "The ExifTool forum is currently unavailable because the" ... | ExifTool history page and XMP.pm |
| https://exiftool.org/TagNames/XMP.html | Not blocked, but the extraction was unreliable across offsets (PostCropVignette rows were not reported). | XMP.pm source |
| https://patents.google.com/patent/US9754356 | Claims section not present in the extracted text at any offset tried | ppubs PDF (opening plus summary only) |
| https://patents.google.com/patent/US8666194 (offset 100000) | No claims section in the fragment | ppubs PDF |
| https://www.peachpit.com/articles/article.aspx?p=1416689 | Returned a promotional page, not the article | help page |
| Google Patents search result pages | JavaScript-rendered; not used, per the brief | WebSearch `site:patents.google.com`, Justia inventor and search pages |
| Justia search pages 2 to 5 ("halation") | Not read | none |
