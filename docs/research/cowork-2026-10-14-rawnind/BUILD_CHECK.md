> **Provenance:** the build environment's own check (2026-10-14), public sources only; the author was not contacted. It led to the Cowork prompt reproduced at the end, whose answer is [RAWNIND_TRAINING_DATA.md](RAWNIND_TRAINING_DATA.md).

# RawNIND training-data provenance check (2026-10-14)

Public sources only; the author was not contacted. Git clones were inspected as data only; nothing was run.

## Bottom line
- **What kinds of data** trained the released weights is public: the RawNIND pairs, plus a clean "extraraw" set from the **author's personal photo collection** and **raw.pixls.us** (the paper says 561 Bayer images from raw.pixls.us).
- **Which files** is not public beyond the RawNIND pairs: no list of the personal photos or the raw.pixls.us subset was found.
- **NC data in training is possible but unverifiable**: the gathering script (`src/rawnind/tools/gather_raw_gt_images.py`, lines 23, 67–81) filters only ISO ≤ 100 and skips "nind"/"lossy" paths, no licence filter; raw.pixls.us has CC-BY-NC-SA legacy files (batch 2; not re-read today).
- **RawNIND dataset licence**: still unread (Dataverse blocked). darktable-ai's `training_data_license: "CC BY 4.0 / CC0 (per-image, Wikimedia Commons)"` is copied from its NIND card (`rawdenoise-nind/model.yaml:52` = `denoise-nind/model.yaml:31`), so it doesn't describe RawNIND.

## Evidence (shipped checkpoints include extraraw)
- darktable-ai ships `DenoiserTrainingBayerToProfiledRGB_4ch_2024-02-21-bayer_ms-ssim_mgout_notrans_valeither_-4` (iter 4350000) and `DenoiserTrainingProfiledRGBToProfiledRGB_3ch_2024-10-09-prgb_ms-ssim_mgout_notrans_valeither_-1` (iter 3900000), "the canonical base variants … no other options set". Upstream hard-codes the same paths (`src/rawnind/models/denoise_then_compress.py` lines 20–21).
- `tests/grapher.py`: `setdefault("incl_cc", True)` (l.221), `setdefault("noownpics", False)` (l.225); separate variants "Bayer (no unpaired data): incl_cc: false" and "Bayer (noownpics)" exist, so the canonical ones include the clean set and own pictures.
- `config/train_denoise.yaml` (unchanged since first commit `ae094da`, 2025-01-17) lists `extraraw/trougnouf/crops_metadata.yaml` and `extraraw/raw-pixls/crops_metadata.yaml`. "trougnouf" = the author's library (`ORIG_DPATH = … "orb", "Pictures", "ITookAPicture"`).
- Issue #5 (author, 2025-10-11): "I used my personal collection of base-ISO clean images and those available on pixls.us." He also said the clean set "helps a little bit but not very significantly".
- Commit `0f5c633` (2025-10-14) allows `--batch_size_clean 0`; no checkpoint trained that way was found.
- Per-run `args.yaml` (would settle it) is in the Google Drive folder, blocked.
- Weights licence line "dual licensed GPL3 + CC-BY-4.0" added in `e80fb7b` (2026-07-04).
- darktable-ai README: "Models trained on undisclosed or scraped personal data without consent are not accepted." Its PR #20 says "training data CC BY 4.0 / CC0" and doesn't mention extraraw.
- arXiv 2501.08924 (Brummer & De Vleeschouwer, 2025), via search snippet: "This augmentation included 561 Bayer images from numerous cameras available on the raw.pixls.us platform."

## Blocked
arxiv.org, dataverse.uclouvain.be, doi.org, api.datacite.org, raw.pixls.us / pixls.us, darktable.org, Google Drive, researchgate, huggingface.co, semanticscholar. The Cowork prompt follows.

---

## The Cowork prompt

    # Research verification for LightBench: RawNIND training data (Cowork prompt, 2026-10-14)
    
    You are verifying facts for **LightBench**, a free GPL-3.0 photo editor that runs in the browser and is built on darktable's processing. LightBench plans to offer darktable-ai's `rawdenoise-nind` weights (RawNIND UtNet2 by Benoit Brummer and Christophe De Vleeschouwer; `model_bayer.onnx`, `model_linear.onnx`) as an opt-in AI Denoise.
    
    The owner's rule: a model's training data must be **publicly disclosed**. **Do not contact the author or anyone else. Use public sources only.**
    
    Already established from the code (no need to re-check):
    - The shipped checkpoints are `DenoiserTrainingBayerToProfiledRGB_4ch_2024-02-21-bayer_ms-ssim_mgout_notrans_valeither_-4` (iter 4350000) and `DenoiserTrainingProfiledRGBToProfiledRGB_3ch_2024-10-09-prgb_ms-ssim_mgout_notrans_valeither_-1` (iter 3900000).
    - The default training config adds a clean "extraraw" set (the author's own photos plus raw.pixls.us files, ISO ≤ 100, no licence filter).
    - In github.com/trougnouf/rawnind_jddc/issues/5 the author wrote: "I used my personal collection of base-ISO clean images and those available on pixls.us."
    
    The build environment could not open arXiv, the UCLouvain Dataverse, raw.pixls.us or Google Drive. Check each item at its primary source.
    
    ## How to work
    - Open each primary source in a normal browser.
    - Give a verdict for each item: **Confirmed**, **Contradicted** (say what is true instead), **Partly** or **Not found**.
    - Quote the exact text, short and verbatim, with its URL and the date you read it.
    - Label secondary sources as secondary. Don't guess. Facts only, no legal advice.
    
    ## What to return
    One Markdown file, `RAWNIND_TRAINING_DATA.md`. Start it with a **"Decisions this changes"** table, then give the verdicts item by item.
    
    ## Items
    1. **RawNIND Dataverse record** (https://doi.org/10.14428/DVN/DEQCIM, or https://dataverse.uclouvain.be/dataset.xhtml?persistentId=doi:10.14428/DVN/DEQCIM). From the "Terms" tab or the API JSON (`/api/datasets/:persistentId/?persistentId=doi:10.14428/DVN/DEQCIM`), record:
       - the licence name and URI, any Terms of Use and Terms of Access;
       - the version and release date;
       - the file count and total size.
       Is the full file list public? Does the description credit any photographers other than the two authors (for example the "LucieB" or "Laura" scenes)?
    2. **Google Drive pretrained folder** (https://drive.google.com/drive/folders/12Uc5sT4OWx02sviUS_boDk1zDSDRVorw). For the two checkpoint folders above:
       - Is there an `args.yaml`, `train_cmd.sh` or a training log?
       - If so, quote `clean_dataset_yamlfpaths`, `noise_dataset_yamlfpaths`, `batch_size_clean`, `bayer_only` and `test_reserve`.
       - Is any list of training images (for example `crops_metadata.yaml`) published there?
    3. **Paper, arXiv 2501.08924** (https://arxiv.org/abs/2501.08924, HTML or PDF), dataset and training sections:
       - Quote what it says about the clean (unpaired) images: all sources, and the "561 Bayer images" from raw.pixls.us.
       - Does it mention the author's own photos?
       - Any licence statement for RawNIND or for the clean images.
       - The arXiv version history, and whether a journal version exists.
    4. **raw.pixls.us licences** (https://raw.pixls.us/):
       - the current licence values in the "License" column;
       - how many files are non-CC0 (use the "non-cc0" filter), and which licences they carry.
       - Is there a machine-readable export (CSV/JSON/API) of per-file licences?
       - Does the rsync tree (`rsync://raw.pixls.us/data/` or https://raw.pixls.us/data/) carry licence metadata?
       - Are non-CC0 files at ISO ≤ 100 present in that tree?
    5. **pixls.us sources:**
       - Quote the licence sentences from https://pixls.us/blog/2017/01/new-year-new-raw-samples-website and https://pixls.us/blog/2017/09/keep-the-raws-coming.
       - Is the raw.pixls.us rsync service still working today (it was reported broken "since some time 2024")?
    6. **Later releases:**
       - Any public RawNIND/UtNet2 checkpoint trained **without** the extraraw set (for example `--batch_size_clean 0`, "nocc" or "noownpics" variants).
       - Or the "simpler, cleaner public repository focusing on denoising-only" that the rawnind_jddc README says is planned.
