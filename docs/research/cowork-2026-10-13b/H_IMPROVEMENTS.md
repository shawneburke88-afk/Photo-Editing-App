> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-13/14 (batch 2, prompt `COWORK_VERIFY_2026-10-13b`). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# Part H: Improvements inventory (datasets, models, patents), verification

Source brief: `docs/research/IMPROVEMENTS.md` (branch `main`), read as context only.
Shared items are researched once in **G_DENOISE_TRAINING_DATA.md** and cross-referenced here: RawNIND → G1; SIDD → G2; RTX 4000 Ada → G6. US 8,340,461 and US 11,223,744 also appear in Part A item 10 and Part B item 5; they are verified here (H11f, H11g).
All pages read 2026-10-13 (the session ran past midnight UTC). Quotes are verbatim excerpts. "…" marks a cut. Google Patents' legal status is, in its own words, "an assumption and is not a legal conclusion". Facts only, no legal advice.

## Decisions this changes

| Claim (IMPROVEMENTS.md) | Verdict | What LightBench should do differently |
|---|---|---|
| A1 RawNIND data "CC BY 4.0 / CC0 (per-image…)" | **Not found** (Dataverse blocked); see G1 | Keep it marked unconfirmed. The clean-clean `extraraw` set is not on Dataverse. It is rebuilt from raw.pixls.us with no licence filter (G1e), so filter to CC0 files. |
| A1 batch size "wasn't found" | **Confirmed now**: 20 crops per step | 4.35 M iterations ≈ 87 M crops of 256 px (G1f). |
| A3 SA-1B: research-only, destroy within 3 months | **Partly.** Research-only and non-commercial are confirmed. The 3-month destruction runs from the **end of your research and publications** (or termination), not from download. | Don't train shippable masks on SA-1B. Note that SAM *weights* are licensed separately from SA-1B (not checked here). |
| A2 Places365 terms | **Partly.** The download page now says a v2 is being built and the legacy data are available "urgently for research purposes" through a form | Treat Places365 as unavailable for a shippable model. |
| SIDD "MIT" | **Confirmed** (G2) | Usable. |
| A6/A7 DIV2K, LSDIR, HDR+ | DIV2K and LSDIR: "academic research purpose only". HDR+: CC-BY-SA. | Drop DIV2K and LSDIR from shippable training. HDR+ is usable, with ShareAlike obligations on adapted data. |
| A4 TartanAir data licence | **Not found** (site blocked; the paper has none) | Keep it marked unconfirmed. |
| A4 Virtual KITTI 2 "NC" | **Confirmed**: CC BY-NC-SA 3.0, "non-commercial purposes only" | Exclude it. |
| A4 Poly Haven CC0 | **Confirmed** through Poly Haven's own FAQ; it explicitly allows AI training | Usable for synthetic depth and HDRI work. |
| A3 Open Images "Sky" class | **Not found** (blocked) | Unresolved. |
| ImageNet terms for pretrained backbones | **Partly.** Terms of access say "non-commercial research and educational purposes" and say **nothing about trained models** | Prefer backbones whose own licence is clear (e.g. DINOv2, Apache-2.0). Record the ImageNet lineage as an open question. |
| DINOv2 weights Apache-2.0; LVD-142M not released | **Confirmed** (Apache-2.0); **Partly** (the paper describes LVD-142M but makes no release statement) | You can use the DINOv2 weights under Apache-2.0. Its data includes ImageNet-22k-guided retrieval from 1.2 B web images. |
| A7 MIT-Adobe FiveK research-only | **Not found** (the primary site returned errors) | Keep it marked as research-only, from a third-party copy. |
| Patents: US 9,025,822 / 8,542,908 / 11,449,974 / 12,373,915 | **All Active.** Claim 1 was read for three of the four. | PatchMatch-style fill: see the claim wording in H11. These cover specific NNF pipelines (spatial coherency, bidirectional similarity, cross-resolution NNF reuse). |
| Microsoft Criminisi and structure-propagation patents | **Found, all "Expired - Fee Related"** (US 6,987,520; 7,551,181; 7,502,521) | Exemplar inpainting à la Criminisi or Sun 2005 no longer faces these US patents (per Google status). |
| LSD and Richardson–Lucy acceleration patents | **Not found** (limited search) | Nothing new. |
| US 8,340,461 "Expired - Fee Related" | **Confirmed.** No foreign family listed. | The dark channel prior is not blocked by this US patent. |
| US 11,223,744 Active | **Confirmed.** Active, expires 2037-12-02; 4th-year fee paid. Claim 1 requires a drawn spatial mask × range mask weighting. | Keep local range masks clear of claim 1's combination, or review with counsel. |
| Biggs & Andrews 1997 | **Confirmed** (secondary): Appl. Opt. 36(8):1766–1775; vector extrapolation | Cite it correctly. Secondary sources warn that it can deviate from the RL path. |
| Roll/pitch in maker notes | **Partly**: Nikon, Olympus/OM, Pentax, Canon R5 (fw ≥ 1.5). Sony not found. | Auto-level can read RollAngle when present. Fall back to line detection. |
| GPU figures §2.0 | Desktop 26.7 TFLOPS **Confirmed**; A100 312 dense bf16 **Confirmed**; H100 "2–3×" **Partly** (peak ratio 2.7–3.2×) | Use the laptop figures (G6), not the desktop card's. |
| CC BY 4.0 §3(a) | **Not found** (blocked) | Re-read before writing attribution UI. |
| darktable AgX shipped in 5.2? | **Contradicted.** It is in the 5.4.0 release notes, not 5.2.0. | Cite darktable 5.4. |

---

## H1. RawNIND licence, extraraw, batch size → see G1
- Licence on Dataverse: **Not found** (robots-blocked). See G1a and G1d.
- Does it include the "extraraw" clean-clean set? **Partly / new finding.** The repo describes `extraraw` as a set the user builds (rsync of raw.pixls.us plus the author's own ISO ≤ 100 raws). It is not part of the Dataverse download, which could not be inspected. Its terms are therefore those of each source file (G1e, G3).
- Batch size: **Confirmed**. "batch_size_clean: 1", "batch_size_noisy: 4", "num_crops_per_image: 4" give 20 crops per step, and 4.35 M iterations give ≈ 87 M crops (G1f).

## H2. SA-1B licence: **Partly**
- `https://ai.meta.com/datasets/segment-anything/` (primary): "Research purposes only"; licence: "Limited; see full license language for use"; the dataset "is intended to be used for computer vision research for the purposes permitted under our Data License." The page gives no clause text and no deletion clause.
- `https://ai.meta.com/datasets/segment-anything-downloads/`: the licence text did not render (behind a script or form).
- Licence text from a **secondary** copy (`https://huggingface.co/datasets/xiuqhou/SA-Det-100k/blob/main/LICENSE`, headed "SA-1B DATASET RESEARCH LICENSE"):
  - §1: "“Research Purposes” means for the purposes of conducting research activities and research publications," "in each case on a non-commercial basis"
  - §4(b): "The rights granted to You in Section 3 are for Research Purposes only."
  - §4(a): "You may not sublicense the Licensed Content."
  - §7(b): "…You agree that You will destroy any copies of the Licensed Images in Your possession or control" "no later than three (3) months following the conclusion of Your research activities" "and research publications as permitted hereunder," ", or the date of termination of the License, whichever occurs earlier,"
- So darktable-ai's summary is right on research-only and non-commercial. Its "within 3 months" is measured from the end of research and publications (or termination).

## H3. Places365 / Places2 download terms: **Partly**
- `http://places2.csail.mit.edu/download.html`: "We are actively working on the version 2 of Places Database." and "If you need to use the legacy dataset (the original Places365 or Places205) urgently for research purposes, please" [sign a form]. No terms text appears on the page.
- `https://raw.githubusercontent.com/CSAILVision/places365/master/README.md`: "The copyright of all the images belongs to the image owners." Models: "The pretrained places-CNN models can be used under the Creative Common License (Attribution CC BY)."

## H4. SIDD terms → see G2: **Confirmed**
- "The dataset and the associated code repositories are under the MIT License." (`https://abdokamel.github.io/sidd/`)

## H5. DIV2K, LSDIR, HDR+ burst
- **DIV2K: licence found (research only).** `https://data.vision.ee.ethz.ch/cvl/DIV2K/`: "Please notice that this dataset is made available for academic research purpose only." and "All the images are collected from the Internet, and the copyright belongs to the original owners."
- **LSDIR: Contradicted ("no licence line").** The project page has one. `https://data.vision.ee.ethz.ch/yawli/index.html`: "Please notice that this dataset is made available for academic research purpose only." and "All the images are collected from the Internet, and the copyright belongs to the original owners." The images come "from Flickr".
- **HDR+ burst: licence found.** `https://hdrplusdata.org/dataset.html`: "The dataset is released under a Creative Commons license (CC-BY-SA)." The link points to CC BY-SA 4.0. The authors add "our main intention is that the dataset be used for scientific purposes." and ask users to "keep usage in good taste." The data are 3,640 bursts and 28,461 images (≈ 765 GiB), with DNG raw inputs from Nexus and Pixel phones.

## H6. TartanAir and Virtual KITTI 2
- **TartanAir data: Not found.** `theairlab.org/tartanair-dataset` could not be fetched (permission/provenance block). Paper (`https://arxiv.org/pdf/2003.14338`): only "Our dataset is available at http://theairlab.org/tartanair-dataset." Tools (`castacks/tartanair_tools` README): "This software is BSD licensed." The Azure Open Datasets page says "This project is released under the MIT License", linking AirSim's licence. It is ambiguous whether that covers the data.
- **Virtual KITTI 2: Confirmed NC-SA.** `https://europe.naverlabs.com/proxy-virtual-worlds-vkitti-2/`: "The Virtual KITTI 2 Dataset may be used for non-commercial purposes only" and "is subject to the Creative Commons Attribution-NonCommercial-ShareAlike 3.0." Also "Copyrights in the Virtual KITTI 2 dataset are owned by Naver Corporation."

## H7. Poly Haven: **Confirmed** (through the official FAQ; `polyhaven.com/license` itself was blocked)
- `https://docs.polyhaven.com/en/faq`: "All our assets are released under the CC0 license." The CC0 licence "allows you to do whatever you want with them, including training AI models." Also: "The only thing you can't do is claim to be the original author or re-license them."

## H8. Open Images V7 "Sky" among the 350 segmentation classes: **Not found**
- `storage.googleapis.com/openimages/web/download_v7.html` and `…/v5/classes-segmentation.txt` were blocked (provenance). No secondary source quoted the list.

## H9. ImageNet terms and DINOv2 data
- **ImageNet: Partly.** `https://image-net.org/accessagreement`: "Researcher shall use the Database only for non-commercial research and educational purposes." and "Researcher may provide research associates and colleagues with access to the Database" "provided that they first agree to be bound by these terms and conditions." The agreement **does not mention trained models**, so whether restrictions pass to pretrained weights is not answered by the text.
- **DINOv2: Confirmed (weights) / Partly (data).** README (`https://raw.githubusercontent.com/facebookresearch/dinov2/main/README.md`): "DINOv2 code and model weights are released under the Apache License 2.0." and "The models were pretrained on a dataset of 142 M images without using any labels or annotations." Paper (`https://arxiv.org/pdf/2304.07193`): LVD-142M was built by "retrieving, from a large pool of uncurated data, images that are close to those in several curated datasets". The curated sources include ImageNet-22k, the ImageNet-1k train split and Google Landmarks; the pool was "1.2B unique images". The paper makes no statement that LVD-142M is released and gives no licence for it.

## H10. MIT-Adobe FiveK: **Not found** at the primary source
- `https://data.csail.mit.edu/graphics/fivek/` returned SERVER_ERROR twice. `…/legal/LicenseAdobe.txt` and `…/legal/LicenseAdobeMIT.txt` were blocked (provenance).
- Secondary (`https://huggingface.co/datasets/yangkun2197/MIT-Adobe-FiveK`): "LicenseAdobe.txt covers files listed in filesAdobe.txt" and "LicenseAdobeMIT.txt covers files listed in filesAdobeMIT.txt". So there are **two** licences for different subsets. The text of neither was read.

## H11. Patents (Google Patents unless stated)

### H11a. US 9,025,822 B2, "Spatially coherent nearest neighbor fields" (Adobe): **Active**
- `https://patents.google.com/patent/US9025822B2/en`: inventors Hailin Jin, Zhuoyuan Chen, Zhe Lin, Scott D. Cohen. Current assignee "Adobe Inc". Filed 2013-03-11, granted 2015-05-05. "Active, expires 2033-08-12".
- Claim 1 (excerpt): "determining initial matching patches at image grid locations of a first digital image and a second digital image;" "determining a motion field for each matching patch based on motion data of neighboring matching patches" … "initiating a multi-resolution iterative process…" … "minimizing a local cost function that includes a data term and a spatial coherent term,". Independent claims are 1, 6 and 15.

### H11b. US 8,542,908 B2, "Bidirectional similarity of signals" (Yeda): **Active, expires 2030-05-09: Confirmed**
- Google Patents: inventors Denis Simakov, Michal Irani, Yaron Caspi, Eli Schechtman. Assignee Yeda Research and Development Co Ltd. Priority 2007-05-10, filed 2008-05-11, granted 2013-09-24. "Active, expires 2030-05-09".
- Claim 1 (from `https://patentimages.storage.googleapis.com/79/c0/90/6dddbb613a0a1d/US8542908.pdf`): "A method for measuring bi-directional similarity between a first signal of a first size" "…for data completeness, matching at least some patches of said first signal with patches of said second signal;" "for data coherence, matching at least some patches of said second signal with patches of said first signal;" "calculating said bi-directional similarity measure…". Independent claims are 1, 13 ("A method for generating a second signal from a first signal...") and 34 (apparatus).

### H11c. US 11,449,974 B2 (Adobe): **Active, expires 2040-04-03**
- Google Patents: "Generating modified digital images utilizing nearest neighbor fields from patch matching operations" "of alternate digital images". Inventors Sohrab Amirghodsi, Aliakbar Darabi, Elya Shechtman. Filed 2019-11-08, granted 2022-09-20.
- Claim 1 (from `https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11449974`): "identify a first image nearest neighbor field comprising a first plurality of pixel offsets" "associated with a first digital image corresponding to a first resolution;" "utilize the first image nearest neighbor field … to determine" "a second image nearest neighbor field … for a second digital image corresponding to a second resolution;" "determine a digital image patch for filling a region of the second digital image" … "and generate a modified digital image utilizing the digital image patch." (The claim is a computer-readable-medium claim.) Independent claims are 1, 9 (system) and 17 (method).

### H11d. US 12,373,915 B2 (Adobe): **Active, expires 2041-03-06; claim 1 Not found**
- Google Patents: same title and inventors as H11c. Filed 2022-08-18, granted 2025-07-29. "Active, expires 2041-03-06". The description says it is "a continuation of U.S. application Ser. No. 16/678,132, filed on Nov. 8, 2019." The claims were not reached: Google Patents offsets returned only description text, and the USPTO PDF was provenance-blocked.

### H11e. Microsoft exemplar inpainting (Criminisi) and structure propagation (Sun 2005): **Found; all expired (fee-related)**
- US 6,987,520 B2, "Image region filling by exemplar-based inpainting" (Criminisi, Perez, Toyama, Gangnet, Blake; Microsoft Technology Licensing LLC): priority 2003-02-24, granted 2006-01-17. "Expired - Fee Related, expires 2023-03-30".
- US 7,551,181 B2, same title and inventors: filed 2005-03-30, granted 2009-06-23. "Expired - Fee Related, expires 2023-07-12".
- US 7,502,521 B2, "Image completion with structure propagation" (Jian Sun, Heung-Yeung Shum; Microsoft Technology Licensing LLC): filed 2005-06-21, granted 2009-03-10. "Expired - Fee Related, expires 2027-01-03".
- The claims of these three were not read.

### H11f. LSD (Grompone von Gioi) and Richardson–Lucy acceleration (Biggs & Andrews) patents: **Not found**
- The LSD article (`https://ipol.im/pub/art/2012/gjmr-lsd/article.pdf`) contains no patent statement. The article is "© 2012 IPOL & the authors CC–BY–NC–SA" (this covers the article text). Two NEC "Line segment detector" patents surfaced (US 6,690,375, expired; US 7,945,095, active to 2030-03-18). They describe dot or differential detectors, a different technique from LSD's a-contrario region growing.
- No patent on Biggs–Andrews vector-extrapolation RL surfaced. The search was limited, and the search budget ran out.

### H11g. US 8,340,461 B2 (dark channel; shared with Part A item 10): **Confirmed "Expired - Fee Related"**
- `https://patents.google.com/patent/US8340461B2/en`: "Single image haze removal using dark channel priors". Inventors Jian Sun, Kaiming He, Xiao-ou Tang. Current assignee "Microsoft Technology Licensing LLC". Filed 2010-02-01, granted 2012-12-25. Status "Expired - Fee Related". The "Adjusted expiration" of 2031-06-23 is the full-term date it would have reached.
- The legal events show no lapse or maintenance-fee entry, so the **exact lapse date and reason were not found**. "Other versions" lists only US20110188775A1. **No CN or EP family members are listed** on the page.
- Claim 1 (excerpt): "determining minimum intensity dark channels of each local patch of the hazy image" "establishing corresponding dark channel priors of each of the local patches;" "determining transmissions associated with each of the local patches…" "recovering scene irradiances…" … "outputting the de-hazed image." Independent claims are 1, 6 and 15.

### H11h. US 11,223,744 B2, "Local color range selection" (shared with Part B item 5): **Confirmed Active**
- `https://patents.google.com/patent/US11223744B2/en`: inventors Joshua Michael Bury, Eric Chan. Assignee "Adobe Inc". Filed 2017-10-17, granted 2022-01-11. "Active"; anticipated (adjusted) expiration "2037-12-02". Legal event "2025-07-11 (MAFP): Maintenance fee payment, 4th year, large entity."
- Claim 1 (excerpt): "receiving user input comprising a user drawing around a coarsely-defined region of the first image" … "generating … a spatial mask indicating the coarsely-defined region" … "generating … a range mask defining a range of values of a user-specified parameter," … "weighting the adjustment of the" "value of the parameter of the plurality of pixels by a combination of the value of the spatial mask" "and the value of the range mask". Independent claims are 1 (method), 7 (computer program product) and 12 (electronic apparatus).

## H12. Biggs & Andrews 1997: **Confirmed** (secondary; the Optica page was provenance-blocked)
- Citation (from the reference list of `https://arxiv.org/pdf/1304.7211`): "D. S. C. Biggs and M. Andrews. Acceleration of iterative image restoration algorithms." "Applied Optics, 36(8):1766–1775, Mar 1997."
- Method, from Biggs' thesis abstract (`https://researchspace.auckland.ac.nz/handle/2292/1760`): "vector extrapolation approach which eliminates the need to compute the gradient" and "A simple modification to the extrapolation allows the acceleration of the Richardson-Lucy (RL) iteration".
- Caution (`https://arxiv.org/pdf/1210.2258`): the method "exploits a suitable extrapolation along the trajectory of the iterates". Those authors note there is no convergence proof and that it sometimes gives unreliable results. This supports the plan's "changes the look" caveat.

## H13. Roll/pitch in maker notes: **Partly**
- The ExifTool tag-table pages (Canon, Olympus, Sony, Nikon) are 400–500 k characters long. The fetch reached only the main tables, not the sub-tables, so the table rows **could not be quoted**. The evidence below is from the ExifTool forum (Phil Harvey, the author) and a sample EXIF dump.
- **Nikon:** Z9 values appear as "RollAngle", "PitchAngle" and "YawAngle" in the [Nikon] group (`https://exiftool.org/forum/index.php?msg=72239`). For the Z7 the values sit under ShotInfoZ7_2 (`…msg=69001`). The D850 is named in `…msg=62701` ("shown by exiftool for some cameras such as the Nikon D850").
- **Canon:** Phil Harvey: "We've decoded this for the R5, but the information is yet to be discovered if it exists for the R6." and "this information was added in firmware version 1.5 of the R5" (`…msg=88509`). It arrived in ExifTool 12.87 ("Decode a few new tags for the Canon EOS R5"). The exact Canon tag names (RollAngle/PitchAngle) were not confirmed from the tag table.
- **Olympus/OM System:** an OM-5 EXIF dump (secondary, `https://imaging-resource.com/PRODS/om-system-om-5/EXIF/Y-JG-OM-5-PB270006.HTM`) shows "RollAngle | | -0.3" and "PitchAngle | | -1.9".
- **Pentax** (not asked, found): "LevelInfo", first decoded for the K-5 (`…msg=74047`).
- **Sony:** **Not found.**

## H14. GPU specifications (see G6 for the laptop)
- Laptop RTX 4000 Ada: 7,424 cores, 12 GB, 432 GB/s, 60–175 W, 33.6 TFLOPS FP32, 538 AI TOPS (FP8 sparse). NVIDIA publishes no FP16/BF16 figure. **Confirmed** (G6).
- "RTX 4000 Ada Generation with 12 GB and a 130 W cap is the laptop part": **Confirmed by memory size**. The desktop card is "20GB GDDR6" with "Total board power: 130W" (datasheet), so 130 W alone does not discriminate.
- Desktop FP32 "about 26.7 TFLOPS": **Confirmed** ("26.7 TFLOPS", desktop datasheet).
- A100 bf16: **Confirmed**. `https://nvidia.com/content/dam/en-zz/Solutions/Data-Center/a100/pdf/nvidia-a100-datasheet-us-nvidia-1758950-r4-web.pdf`: "BFLOAT16 Tensor Core 312 TFLOPS | 624 TFLOPS*", "* With sparsity".
- H100 "about 2–3× an A100": **Partly**. `https://www.nvidia.com/en-us/data-center/h100/`: "BFLOAT16 Tensor Core*" H100 SXM "1,979 teraFLOPS", H100 NVL "1,671 teraFLOPS", "* With sparsity". Dense figures are half of these (989.5 and 835.5), giving peak-spec ratios of **3.17× (SXM)** and **2.68× (NVL)** over the A100's 312. Real training speed-ups were not checked.

## H15. CC BY 4.0 §3(a): **Not found**
- `https://creativecommons.org/licenses/by/4.0/legalcode` and `…/legalcode.en` were provenance-blocked, and the search budget was exhausted before an alternative could be found. IMPROVEMENTS.md §4's summary remains unverified.

## H16. darktable AgX: **Partly**. What it does is confirmed; "shipped in 5.2" is **Contradicted**
- `https://raw.githubusercontent.com/darktable-org/darktable/master/src/iop/agx.c`: "Copyright (C) 2025-2026 darktable developers.", GPL v3 or later. Name "AgX". Aliases "tone mapping|view transform|display transform". Description "applies a tone mapping curve." / "inspired by Blender's AgX tone mapper". Comments: "Assume input is linear RGB relative to 0.18 mid-gray"; "16.5 EV is the default AgX range"; "The idea is to "inset" the work RGB data toward achromatic"; "The primaries are also rotated to compensate for Abney etc."; "all versions before 7 were unreleased test versions,".
- Release: `release-5.2.0/RELEASE_NOTES.md` ("We're proud to announce the new feature release of darktable, 5.2.0!") contains **no AgX mention**. `release-5.4.0/RELEASE_NOTES.md` lists "- Added a new tone mapper implementation based on Blender's AgX". So AgX first shipped in **5.4.0**. The release date was not read.

---

## Dataset licence summary (Part H, with G cross-references)

"Commercial use OK?" reports what the stated terms say. It is not legal advice.

| Dataset / model | Licence / terms as found | Commercial use per stated terms | Source (read 2026-10-13) |
|---|---|---|---|
| RawNIND | Not found (see G1) | Unknown | Dataverse (blocked) |
| SIDD | MIT (data and code) | Yes | abdokamel.github.io/sidd |
| SA-1B | SA-1B Dataset Research License: research, non-commercial; destroy ≤ 3 months after research ends | No | ai.meta.com (primary summary); HF mirror of licence (secondary) |
| Places365 | Legacy data by form, "for research purposes"; image copyright with owners; models CC BY | No (data); models CC BY | places2.csail.mit.edu; places365 README |
| DIV2K | "academic research purpose only" | No | data.vision.ee.ethz.ch/cvl/DIV2K |
| LSDIR | "academic research purpose only" | No | data.vision.ee.ethz.ch/yawli |
| HDR+ burst | CC-BY-SA (4.0 link) | Yes, with BY and SA conditions | hdrplusdata.org/dataset.html |
| TartanAir | Not found (tools BSD-3) | Unknown | paper; tartanair_tools README |
| Virtual KITTI 2 | CC BY-NC-SA 3.0 | No | europe.naverlabs.com |
| Poly Haven | CC0 (AI training explicitly allowed) | Yes | docs.polyhaven.com/en/faq |
| Open Images V7 | Not checked (blocked) | n/a | — |
| ImageNet | "non-commercial research and educational purposes"; silent on trained models | No (database) | image-net.org/accessagreement |
| DINOv2 weights | Apache-2.0 | Yes | dinov2 README; paper |
| LVD-142M | No release or licence stated | n/a | DINOv2 paper |
| MIT-Adobe FiveK | Two licence files (Adobe; Adobe+MIT); text not read | Unknown (third-party copy says research only) | HF mirror (secondary) |
| RAISE (G4) | non-commercial research and education | No | loki.disi.unitn.it/RAISE/download.html |
| raw.pixls.us (G3) | CC0 or legacy CC-BY-NC-SA, per file | Per file | raw.pixls.us |

## Unresolved items
1. The RawNIND Dataverse licence (robots-blocked). It needs a browser.
2. The SA-1B licence read from Meta's own download page (the secondary copy was used).
3. TartanAir data licence; Open Images V7 segmentation class list ("Sky"); the FiveK licence texts; CC BY 4.0 §3(a); Poly Haven's `/license` page itself. All were blocked by provenance or server errors.
4. Claim 1 of US 12,373,915; claims of US 6,987,520, 7,551,181 and 7,502,521; the lapse date of US 8,340,461 (no fee event shown).
5. Dedicated patent searches for LSD and for Biggs–Andrews RL acceleration (the search budget was exhausted).
6. ExifTool tag-table rows for Canon LevelInfo, Olympus, Sony and Nikon (pages too large to reach the sub-tables). Sony roll/pitch support.
7. The darktable 5.4.0 release date.
