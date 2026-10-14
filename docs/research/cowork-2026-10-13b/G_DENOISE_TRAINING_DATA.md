> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-13/14 (batch 2, prompt `COWORK_VERIFY_2026-10-13b`). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# Part G: Raw denoiser training data, verification

Source brief: `docs/research/DENOISE_TRAINING_PLAN.md` (branch `lightbench/research-2026-10-13c`), read as context only.
Cross-reference: items shared with Part H (RawNIND, SIDD, RTX 4000 Ada) are researched here once; H_IMPROVEMENTS.md points back to this file.
All pages read 2026-10-13 (the session ran past midnight UTC; a few reads may carry a 2026-10-14 UTC timestamp). Quotes are verbatim excerpts. "…" marks a cut. Facts only, no legal advice.

## Decisions this changes

| Claim | Verdict | What LightBench should do differently |
|---|---|---|
| RawNIND licence is "CC BY 4.0 / CC0 (per-image, Wikimedia Commons)" | **Not found**. The Dataverse record is blocked (robots.txt). The paper and the repo give no data licence. The card's wording fits NIND (on Wikimedia Commons, sRGB) rather than RawNIND (on Dataverse, raw). | Keep RawNIND as "licence unconfirmed". Before training a model you will ship, read the Dataverse licence field from a normal browser, or ask the author (trougnouf). |
| RawNIND's clean-clean "extraraw" data | **New finding.** It is not part of the Dataverse download. It is built locally by rsyncing all of raw.pixls.us (keeping ISO ≤ 100, with no licence filter) plus the author's own photos. The paper says it used "561 Bayer images" from raw.pixls.us. | If you copy the RawNIND recipe, filter raw.pixls.us to CC0 files before gathering. Also note that the released RawNIND weights may include non-CC0 (CC BY-NC-SA) raw.pixls.us files. This is unverified, so flag it when deciding whether to bundle those weights. |
| RawNIND batch size | **Confirmed.** Noisy batch 4, clean batch 1, 4 crops per image, 256 px crops, so 20 crops per step. | 4.35 M steps ≈ 87 M crops, or 21.75 M image draws, assuming the 2024 checkpoint used today's config. Use this to size your own budget. |
| SIDD is MIT | **Confirmed** on the official site, for both the dataset and the code. | SIDD can move from "optional" to usable for synthetic and smartphone noise checks. It is smartphone raw stored as .MAT, not DSLR raw. |
| raw.pixls.us is "mostly CC0" | **Partly.** New uploads are CC0. Many legacy rawsamples.ch files are CC-BY-NC-SA. The site has a per-file License column and a "View only the non-cc0 samples" link. | Build the gather step from the site's licence column, not from the rsync mirror. The mirror has no licence metadata that this session could check. |
| RAISE licence | **Contradicted ("unknown")**: "non-commercial research and educational purposes" | Exclude it from shipped-model training. |
| Zurich RAW-to-RGB licence | **Not found** for the data. The PyNET code is CC BY-NC-SA 4.0, "for academic research use only". | Exclude it until the authors grant terms in writing. |
| SID (Learning to See in the Dark) | **Confirmed** as in the plan: the README's "MIT License" covers the code. No data licence is stated. | Keep it on hold, as the plan says. |
| PyTorch CUDA 13.x on Windows | **Partly.** cu126, cu130 and cu132 indexes exist (2.13.0, 2.14 RC). There are **no native sm_89 (Ada) kernels**: the builds list Ampere 8.0/8.6 and Hopper 9.0. | Install with `--index-url https://download.pytorch.org/whl/cu130` (or cu126). The Ada laptop runs the sm_86 code path. Benchmark before assuming speed parity. |
| RTX 4000 Ada laptop: 12 GB, 60–175 W | **Confirmed** on nvidia.com: 12 GB, 432 GB/s, 60–175 W, 33.6 TFLOPS FP32, 538 AI TOPS (FP8 sparse). NVIDIA publishes **no FP16 or BF16 tensor figure**. | The owner's 12,282 MiB card is the laptop part (the desktop card has 20 GB). Plan from a measured bf16 throughput, not from a spec-sheet number. |

---

## G1. RawNIND dataset

### G1a. Licence field on the Dataverse record: **Not found (blocked)**
- `https://doi.org/10.14428/DVN/DEQCIM`, `https://dataverse.uclouvain.be/dataset.xhtml?persistentId=doi:10.14428/DVN/DEQCIM`, the Dataverse API URL and `https://dataverse.uclouvain.be/dataverse/rawnind` all returned **ROBOTS_DISALLOWED**. DataCite's API returned an error.
- The paper (arXiv 2501.08924, PDF, read 2026-10-13) contains no licence, CC BY, CC0 or Wikimedia wording. It says "RawNIND and its associated tools are publicly available."
- Repo README (`https://raw.githubusercontent.com/trougnouf/rawnind_jddc/main/README.md`): only the weights licence, "The weights are dual licensed GPL3 + CC-BY-4.0". The detailed README (`src/rawnind/README.md`) has no occurrence of "license", "licence" or "CC".

### G1b. Size, files, pairs: **Partly**
- Paper, Table I total row (`https://arxiv.org/pdf/2501.08924`): "Total | 310 | 562 | 2279 | 2831" (scenes | clean | noisy | images). This confirms the meaning of the plan's unexplained "310 / 562 / 2279 / 2831".
- Total GB and file count on Dataverse: **not found** (blocked).
- A pair count is not stated as such. Each noisy image is paired with a clean image of the same scene, giving 2,279 noisy images against 562 clean ones. That figure is derived, not quoted.
- The plan's "163 pairs in the test set": not checked (no source reachable).

### G1c. Camera list (Bayer and X-Trans): **Confirmed** (paper)
- The paper says "RawNIND includes data from a variety of Bayer pattern cameras". Only the Fujifilm rows are labelled X-Trans.
- Table I rows, extracted (scenes | clean | noisy | images): "Sony ILCE-7C | 148 | 361 | 1423 | 1784"; "Canon EOS 500D | 13 | 13 | 71 | 84"; "Canon EOS 6D | 8 | 8 | 80 | 88"; "Canon EOS 7D | 7 | 7 | 49 | 56"; "Canon EOS D60 | 3 | 3 | 12 | 15"; "Nikon Z 6 | 3 | 3 | 41 | 44"; "Nikon D40 | 2 | 8 | 8 | 16"; "Lumix DMC-GH1 | 1 | 1 | 5 | 6"; "Fujifilm X-T2 (X-Trans) | 10 | 10 | 54 | 54". The Canon EOS M100 and Fujifilm X-T1 (X-Trans) rows were garbled in the PDF text and could not be read. The X-T2 row as extracted is internally inconsistent (10 + 54 ≠ 54).
- In total: 11 models, two of them X-Trans (X-T1, X-T2). The Sony ILCE-7C supplies 148 of 310 scenes and 1,784 of 2,831 images. This matches the plan's search summary.

### G1d. Does darktable-ai's "CC BY 4.0 / CC0 (per-image, Wikimedia Commons)" apply to RawNIND? **Partly**: the card says it, but the evidence points to NIND
- The card (`https://raw.githubusercontent.com/darktable-org/darktable-ai/master/models/rawdenoise-nind/README.md`) does say: Training data license "CC BY 4.0 / CC0 (per-image, Wikimedia Commons)". It also links the Dataverse: `https://dataverse.uclouvain.be/dataverse/rawnind`.
- NIND (the older set) is on Wikimedia Commons as developed images. NIND paper (`https://arxiv.org/html/1906.00270v1`): "The dataset is published in sRGB format on Wikimedia Commons". nind-denoise README: "Dataset: <https://commons.wikimedia.org/wiki/Natural_Image_Noise_Dataset>". The Commons page itself returned not-found or blocked.
- RawNIND is published on Dataverse, not Commons (paper; `src/rawnind/README.md`: "RawNIND is available on https://dataverse.uclouvain.be/dataset.xhtml?persistentId=doi:10.14428/DVN/DEQCIM").
- Conclusion (fact-based): the "Wikimedia Commons, per-image" wording describes how NIND is hosted. Whether the RawNIND Dataverse record uses CC BY 4.0, CC0 or something else is **unresolved**.

### G1e. The clean-clean `extraraw` data (shared with H1): **New finding**
- `src/rawnind/README.md` has the heading "Prepare the `extraraw` dataset (Clean-clean / unpaired images) for training". The instruction reads: "Run `rsync -avL rsync://raw.pixls.us/data/ raw-pixls-us-data/` from within `<TEMPORARY_DIRECTORY>`, multiple times as needed…". The second source is "**trougnouf-ISO_LE_100 (ie your own raw images)**". The size: "until the resulting files take up approximately 41 GB."
- `tools/gather_raw_gt_images.py`: no licence logic ("licence/license/CC0/NC/rawsamples" appear nowhere). It selects files by "Gather images with ISO<=MAX_ISO in orig_dpath." with `MAX_ISO = 100`.
- `config/train_denoise.yaml` lists the clean sets: "- ../../datasets/extraraw/trougnouf/crops_metadata.yaml" and "- ../../datasets/extraraw/raw-pixls/crops_metadata.yaml".
- Paper: "This augmentation included 561 Bayer images from numerous cameras available on the raw.pixls.us platform".
- Consequence (fact): the clean-clean set is assembled by the user and is not on Dataverse. As scripted, it takes every ISO ≤ 100 raw file on raw.pixls.us whatever its per-file licence (see G3).

### G1f. Batch size and iterations (shared with H1): **Confirmed**
- `https://raw.githubusercontent.com/trougnouf/rawnind_jddc/main/src/rawnind/config/train_denoise_bayer2prgb.yaml`: "crop_size: 256", "num_crops_per_image: 4", "batch_size_clean: 1", "batch_size_noisy: 4".
- `config/train_denoise.yaml`: "tot_steps: 6000000", "init_lr: 0.0003".
- `libs/abstract_trainer.py`: "for batch in itertools.islice(zip(dataloader_cc, dataloader_cn), 0, num_steps):". Crops are flattened with "view(-1, …)" and joined with "torch.cat(". Each step therefore feeds (1 + 4) × 4 = **20 crops**.
- Paper: "Random $256 \times 256$ ( $128 \times 128$ for Bayer) crops are then extracted from the aligned patches."
- Derived: 4,350,000 steps × 20 = **87.0 M crops**, or 21.75 M image draws (5 per step). For the linear model, 3,900,000 × 20 = 78.0 M crops. Caveat: this assumes the 2024-02-21 checkpoint used the config now on `main`, which was not verified.

## G2. SIDD licence (data and code; shared with H4): **Confirmed MIT**
- `https://abdokamel.github.io/sidd/`: "The dataset and the associated code repositories are under the MIT License."
- `https://www.eecs.yorku.ca/~kamel/sidd/` has "License" in its navigation, but the fetched text had no licence section.
- Content (same site): "We provide a small version of the dataset that consists of **160 image pairs (noisy and ground-truth)**"; "SIDD Medium consists of 320 image pairs"; "We provide 80% (**~24,000 images**) of the dataset for training/learning purposes." Raw-RGB is supplied as .MAT, with DNG archives linked separately. The cameras are 5 smartphones. No GB sizes are given.

## G3. raw.pixls.us licence: **Partly**
- `https://raw.pixls.us/` upload declaration: "I declare that I own full rights to this file and I hereby release it under the" [link to the CC0 deed] "…into the public domain."
- The repository table header is "Make | Model | Mode | Pixls | Remark | License | Date | Raw | Exif". There is a per-file **License column**. The table rows did not render in the fetch (they are built by script).
- A filter link: "View" … "only the non-cc0 samples". (The fetch showed "non-co", a mangled "cc0".)
- 2017 announcement (`https://pixls.us/blog/2017/01/new-year-new-raw-samples-website`): "Many of the files from the rawsamples.ch archive are licensed CC-BY-NC-SA"; "The existing files, and the preference for any new contributions, are licensed as Creative Commons Zero - Public Domain".
- Forum, secondary (`https://discuss.pixls.us/t/can-i-use-some-raw-files-from-raw-pixls-us-to-make-a-web-app-demo-video/44619`), Donatzsky: "Most of the files should be CC0, which means there are no restrictions on their use." and "There are still many that have a different license, though, so do check first."
- Filtering per file: possible on the website (the column and the filter link). `https://raw.pixls.us/data/` is **ROBOTS_DISALLOWED**, so whether the mirror has machine-readable per-file licences was **not verified**.

## G4. RAISE, Zurich RAW-to-RGB, SID (data licences)

### RAISE: **licence found; non-commercial**
- `https://loki.disi.unitn.it/RAISE/download.html`: "The RAISE dataset is to be used for non-commercial research and educational purposes." and "If using the dataset in any published work, please cite its related publication."
- `https://loki.disi.unitn.it/RAISE/`: 8,156 raw images from 3 cameras (one named there is a Nikon D7000).

### Zurich RAW-to-RGB (ETH / PyNET): **Not found** for the data
- `https://aiff22.github.io/pynet.html` (the target of the ETH redirect from `vision.ee.ethz.ch/~ihnatova/pynet.html`) has no dataset licence. The data are Huawei P20 raw ("12.3 MP Sony Exmor IMX380 Bayer camera sensor") paired with a "professional high-end Canon 5D Mark IV camera", "48043 RAW-RGB image pairs", link label "Zurich RAW to RGB Dataset (22 GB)".
- Code repo (`https://raw.githubusercontent.com/aiff22/PyNET/master/README.md`): "Copyright (C) 2020 Andrey Ignatov. All rights reserved.", CC BY-NC-SA 4.0, and "The code is released for academic research use only." (This covers the code; the data have no stated terms.)

### SID (Learning to See in the Dark): **Confirmed** as the plan says (MIT for code; nothing for data)
- `https://raw.githubusercontent.com/cchen156/Learning-to-See-in-the-Dark/master/README.md`: "MIT License." It also says "If you use our code and dataset for research, please cite our paper:". There is no separate data licence. Sizes: Sony 25 GB, Fuji 52 GB, as the plan says.

## G5. PyTorch on Windows with CUDA 13.x: **Partly**
- `https://pytorch.org/get-started/locally/`: the static HTML is stale ("Stable (2.7.0)"; options "CUDA 11.8", "CUDA 12.6", "CUDA 12.8"). The selector is script-driven and its live output could not be read. The page says to "choose OS: Windows, Package: Pip and the CUDA version suited to your machine". On Windows, "Currently, PyTorch on Windows only supports Python 3.10-3.14".
- `https://pytorch.org/get-started/previous-versions/` (newest section v2.13.0):
  `pip install torch==2.13.0 torchvision==0.28.0 --index-url https://download.pytorch.org/whl/cu130`, with the same command for `cu126` and `cu132`.
- `https://raw.githubusercontent.com/pytorch/pytorch/main/RELEASE.md`: for 2.13, stable CUDA is "CUDA 12.6 (CUDNN 9.10.2.21) (NCCL 2.29.3), CUDA 13.0 (CUDNN 9.20.0.48) (NCCL 2.29.7)" and experimental is "CUDA 13.2 …". The cadence table has "| 2.14 | 10 Aug 2026 | 2 Sept 2026 | (Oct 2026) | Not planned |".
- 2.14 final RC (`https://dev-discuss.pytorch.org/t/pytorch-2-14-final-rc-available/3429`), secondary: "pip3 install torch==2.14.0  torchvision --index-url https://download.pytorch.org/whl/test/cu130" (test channel). After release, the same index without `/test/` is expected; that was not verified.
- **sm_89 (Ada): no native kernels.** RELEASE.md, table "architectures supported for Linux x86 and Windows builds": "| 13.0.2 | Turing(7.5), Ampere(8.0, 8.6), Hopper(9.0), Blackwell(10.0, 12.0+PTX) | +PTX available on linux builds only |" and "| 12.6.3 | Maxwell(5.0), Pascal(6.0), Volta(7.0), Turing(7.5), Ampere(8.0, 8.6), Hopper(9.0) | |". Neither 8.9 nor "Ada" appears in the file. Ada GPUs run the 8.6 binaries under NVIDIA's same-major-version binary compatibility. That rule was not re-read this session (the search budget ran out).
- The plan's "PyPI Windows wheel is CPU-only (torch-2.14.1…)": not re-checked (PyPI is not a listed primary source).

## G6. NVIDIA RTX 4000 Ada Generation Laptop GPU (shared with H14): **Confirmed, except tensor FP16/BF16 (Not found)**
- `https://www.nvidia.com/en-us/products/workstations/professional-laptops/compare/` (RTX 4000 Ada Generation laptop column): "NVIDIA CUDA® Processing Cores | 7,424"; "GPU Memory | 12GB ECC"; "Peak Memory Bandwidth | 432GB/s"; "Memory Interface | 192-bit"; "TGP Max Power Consumption | 60-175W"; "Single Precision Floating-Point Performance (TFLOPS,Peak) | 33.6"; "AI TOPS | 538". Footnotes (as fetched): the TGP range includes Dynamic Boost and the OEM should be checked; AI TOPS for Ada is FP8 with sparsity.
- **FP16/BF16 tensor TFLOPS: not published** on the page. (Arithmetic only, not a spec: 538 FP8-sparse ÷ 2 for density ÷ 2 for FP16 ≈ 134 TFLOPS dense FP16. Do not cite this as NVIDIA's figure.)
- Desktop for contrast (`https://www.nvidia.com/content/dam/en-zz/Solutions/products/workstations/nvidia-rtx-4000-datasheet.pdf`): "20GB GDDR6", "360GB/s", "6,144", "26.7 TFLOPS", "Total board power: 130W".
- So the owner's nvidia-smi ("12,282 MiB … 130 W power cap") matches the **laptop** part on memory. The 130 W figure fits both the laptop range and the desktop board power, so memory size is what decides.
- Notebookcheck (secondary) is internally inconsistent: "60 - 150 Watt TGP" in its table, "60 W to 175 W" in its text. NVIDIA's 60–175 W is the primary figure.

---

## Dataset licence summary (Part G datasets)

"Commercial use OK?" reports what the stated terms say. It is not legal advice.

| Dataset | Licence / terms as found | Commercial use per stated terms | Source (read 2026-10-13) |
|---|---|---|---|
| RawNIND (paired) | Not found (Dataverse blocked) | Unknown | doi.org/10.14428/DVN/DEQCIM (blocked) |
| RawNIND weights | "dual licensed GPL3 + CC-BY-4.0" | Yes, with GPL/CC BY conditions | rawnind_jddc README |
| RawNIND `extraraw` (clean) | Not a published set; rebuilt from raw.pixls.us (mixed) plus the author's photos | Mixed | rawnind_jddc src/rawnind/README.md |
| NIND (sRGB) | Card: "CC BY 4.0 / CC0 (per-image, Wikimedia Commons)" | Yes (CC BY needs attribution); Commons page not read | darktable-ai card (secondary) |
| SIDD | "under the MIT License" (data and code) | Yes (MIT notice) | abdokamel.github.io/sidd |
| raw.pixls.us | CC0 for new files; many legacy rawsamples.ch files CC-BY-NC-SA; per-file column | CC0 files yes; NC files no | raw.pixls.us; pixls.us blog 2017 |
| RAISE | "non-commercial research and educational purposes" | No | loki.disi.unitn.it/RAISE/download.html |
| Zurich RAW-to-RGB | None stated for data (code CC BY-NC-SA 4.0, academic only) | Unknown | aiff22.github.io/pynet.html; PyNET README |
| SID | "MIT License." (code); data not stated | Unknown for data | SID README |

## Unresolved items
1. The RawNIND Dataverse licence, total GB and file count: Dataverse blocks automated fetches (robots.txt). Open `https://doi.org/10.14428/DVN/DEQCIM` in a browser and read the "Terms" tab.
2. The garbled paper rows (Canon EOS M100, Fujifilm X-T1) and the X-T2 count inconsistency: needs the HTML paper or the PDF table read by eye.
3. Whether the released RawNIND checkpoints were trained with non-CC0 raw.pixls.us files (needs the author's crop lists or a statement from the author).
4. Whether raw.pixls.us exposes a machine-readable per-file licence (the mirror is robots-blocked; the table is script-rendered).
5. The Zurich RAW-to-RGB and SID data licences (ask the authors).
6. Live output of the pytorch.org selector, the 2.14.x stable index URL, and NVIDIA's binary-compatibility statement for 8.6 → 8.9 (not re-read; the search budget ran out).
7. NVIDIA's official FP16/BF16 tensor throughput for the laptop RTX 4000 Ada (not published on the compare page).
