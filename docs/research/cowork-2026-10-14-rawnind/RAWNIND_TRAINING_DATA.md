> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-14 (the prompt is at the end of [BUILD_CHECK.md](BUILD_CHECK.md)). Copied verbatim below this line; not re-verified here.

# RawNIND training data: verification (2026-10-14)

Verification of `COWORK_RAWNIND.md` for darktable-ai's `rawdenoise-nind` weights (RawNIND UtNet2; Brummer & De Vleeschouwer). Public sources only; no one was contacted. All sources were read on 2026-10-14. Verdicts: **Confirmed / Contradicted / Partly / Not found**.

**Access limits:** the UCLouvain Dataverse (page and API) refused automated access ("ROBOTS_DISALLOWED"). The Google Drive folder showed no file listing. The raw.pixls.us table renders in the browser, so only its headers came through. The owner chose not to use a local browser this round, so those sub-items are **Not found (blocked)**. The exact pages to check by hand are listed at the end.

---

## Decisions this changes

| Claim / question | Verdict | What LightBench should do |
|---|---|---|
| The training data of the shipped `rawdenoise-nind` checkpoints is publicly disclosed | **Contradicted**, if the shipped checkpoints used the default config with the clean "extraraw" set. The paper says training added "11,815 Bayer images captured with several cameras from our personal collection". Those images are not in RawNIND's composition table and are not published anywhere the paper mentions. | Under the "publicly disclosed" rule, **don't ship these checkpoints as they stand.** Options: (a) wait for a public checkpoint trained without the clean set (none found yet); (b) train one yourself with `--batch_size_clean 0`, which the author says works, when own training is no longer deferred; (c) relax the rule to "described in the paper". Caveat: the shipped checkpoints are dated 2024-02-21 and 2024-10-09, and nothing public links them to the paper's exact training run. The link rests on the default config the owner established from code. |
| The clean set also contains raw.pixls.us files with no licence filter | **Partly.** The paper confirms "561 Bayer images from numerous cameras available on the raw.pixls.us platform". raw.pixls.us mixes CC0 files with legacy CC BY-NC-SA ones (2017 blog posts). Per-file licences and the exact 561 files couldn't be read (blocked). | The provenance is *described* but not *licence-clean*. Even option (c) leaves possible NC-licensed images in training. Record this in the model notice. |
| Clean images are ISO ≤ 100 (from the config) | **Discrepancy.** The paper says "a maximum ISO limit of 200" for the raw.pixls.us images, and "also restricted to ISO 200 or lower" for the personal collection. | Treat the code config as the shipped run's setting and the paper as describing its own run. This adds to the uncertainty about which run produced the checkpoints. |
| Weights licence | **Confirmed (unchanged):** "The weights are dual licensed GPL3 + CC-BY-4.0" (rawnind_jddc README). | No change. The data-disclosure issue is separate from the weights licence. |
| A cleaner, denoising-only release is coming | **Partly.** The README says it "is planned for the relatively near future". No release or no-extraraw checkpoint was found. | Monitor the repo; nothing to adopt yet. |

---

## Item 1: RawNIND Dataverse record. **Not found (blocked)**, with partial facts from the paper

- `https://doi.org/10.14428/DVN/DEQCIM` and `https://dataverse.uclouvain.be/api/datasets/:persistentId/?persistentId=doi:10.14428/DVN/DEQCIM` both returned "ROBOTS_DISALLOWED". The **licence, Terms of Use/Access, version, release date, file count and size are Not found.**
- **From the paper (arXiv 2501.08924v2):**
  - Table I's total row lists 310 scenes and 2,831 images (562 clean, 2,279 noisy). This is a paraphrase of a table, not a quote.
  - Licence: the paper has no licence statement. The closest is the Conclusion: "RawNIND and its associated tools are publicly available."
  - Credits, Acknowledgements: "31 of the 310 RawNIND scenes were captured by the following contributors:" … "Iain Fergusson, Matti Blume, Peter Wemmert, and "sillyxone"."
  - **"LucieB" and "Laura"** appear only as test-scene names in Section IV-B (e.g. "LucieB_board", "Laura_Lemons_platformer"), not as photographer credits. Whether the Dataverse description credits them is **Not found (blocked)**.
- **Is the full file list public?** Not found (blocked).

## Item 2: Google Drive pretrained folder. **Not found (blocked)**

- `https://drive.google.com/drive/folders/12Uc5sT4OWx02sviUS_boDk1zDSDRVorw`: only the page title "models - Google Drive" came back. No file listing, so `args.yaml`, `train_cmd.sh`, logs and `crops_metadata.yaml` are **Not found**, and none of the requested config values could be quoted.
- The README confirms that the location exists: "Pre-trained models are available through the following link:" (a Google Drive link). https://github.com/trougnouf/rawnind_jddc

## Item 3: Paper, arXiv 2501.08924. **Confirmed**, with a major new fact

Source: https://arxiv.org/pdf/2501.08924 (served as v2).

- **Clean (unpaired) images, Section IV-A.2 "Clean data for generalization":**
  - "This augmentation included 561 Bayer images from numerous cameras available on the raw.pixls.us platform,"
  - "with a maximum ISO limit of 200 to ensure high image quality."
  - "Additionally, we incorporated 11,815 Bayer images captured with several cameras from our personal collection,"
  - "also restricted to ISO 200 or lower."
  - "These unpaired clean images aim to expose the model to a broader range of sensor characteristics,"
- **Author's own photos:** **Confirmed**: 11,815 images, called "our personal collection". The paper doesn't say they are published, and they are not in Table I.
- **Licence statement:** **Not found.** The paper mentions no CC BY, CC0, Wikimedia or public domain terms for RawNIND or the clean images.
- **Batch size:** not stated in the paper. Section IV-A.3 gives crop sizes only: "Random $256 \times 256$ ( $128 \times 128$ for Bayer) crops are then extracted from the aligned patches." Batch 2 found 20 crops per step from the repo config.
- **Version history:** **Partly.** The abs page shows "Submitted: 2025-01-15" and "This version: v2 2025-06-20". The full history and the Comments field didn't load (the v1 page needed a permission step that timed out). **Journal version:** none shown on arXiv, and a web search found only arXiv and its mirrors. **Not found** (no journal version located; this does not prove there is none).

## Item 4: raw.pixls.us licences. **Partly**

Source: https://raw.pixls.us/

- **Licence column values and the count of non-CC0 files:** **Not found (blocked).** The table is rendered client-side, so only the header row came through ("Make, Model, Mode, Pixls, Remark, License, Date, Raw, Exif").
- **Non-CC0 filter:** **Confirmed it exists.** The page links "View only the non-cc0 samples" to `?noncc0#repo`. The count needs a browser.
- **Machine-readable export (CSV/JSON/API):** **Not found.** None is mentioned on the homepage.
- **Mirror and rsync:** the homepage now says "Full mirror available via:" with an https link to `raw.pixls.us/data/`, Git LFS (`git clone https://raw.pixls.us/data.lfs.git`) and git-annex (`git clone https://raw.pixls.us/data.annex.git`). **rsync is not mentioned.**
- **Licence metadata in the data tree, and non-CC0 files at ISO ≤ 100:** **Not found (blocked).** In batch 2, `raw.pixls.us/data` was also blocked.

## Item 5: pixls.us sources. **Confirmed** (licence sentences); rsync **Partly**

- https://pixls.us/blog/2017/01/new-year-new-raw-samples-website/:
  - "The biggest difference between the files from rawsamples.ch and raw.pixls.us is the licensing."
  - "Many of the files from the rawsamples.ch archive are licensed CC-BY-NC-SA"
  - "but we’d rather have the files licensed Creative Commons Zero - Public Domain."
  - Submission requirement: "Licensed under the Creative Commons Zero"
- https://pixls.us/blog/2017/09/keep-the-raws-coming/:
  - "We want to replace any non-CC0 (public domain) samples with CC0 licensed samples."
  - "We have many raw samples that were not licensed as freely as we would like."
- **Is rsync still working?** **Partly / not tested.** The current homepage lists https, Git LFS and git-annex mirrors and doesn't mention rsync. The "since some time 2024" report is from a user (hanatos) in rawnind_jddc issue #5, which is secondary: pixls.us "hasn't been working since some time 2024." The rsync endpoint itself was not tested.

## Item 6: Later releases. **Not found** (none released); the plan is **Confirmed**

- README: "A simpler, cleaner public repository focusing on denoising-only is planned for the relatively near future." No such repository was found.
- No public checkpoint trained without the clean set (no "nocc", "noownpics" or `batch_size_clean 0` variant) was found in the README, issue #5 or a web search.
- Author, issue #5 (https://github.com/trougnouf/rawnind_jddc/issues/5):
  - "They are definitely not essential."
  - "it helps a little bit but not very significantly, you can train a model without worrying about this."
  - "you should be able to run `python train_denoiser_bayer2prgb.py` with `--batch_size_clean 0` without a valid `--clean_dataset_yamlfpaths` argument."

---

## Pages to check by hand (blocked from here)

1. https://dataverse.uclouvain.be/dataset.xhtml?persistentId=doi:10.14428/DVN/DEQCIM: the "Terms" tab (licence and terms), Versions, file count/size, and description credits.
2. https://drive.google.com/drive/folders/12Uc5sT4OWx02sviUS_boDk1zDSDRVorw: open the two checkpoint folders (`…2024-02-21-bayer…-4` and `…2024-10-09-prgb…-1`) and look for `args.yaml`, `train_cmd.sh` and logs. Record `clean_dataset_yamlfpaths`, `batch_size_clean`, `bayer_only`, `test_reserve` and `noise_dataset_yamlfpaths`. This settles whether the shipped checkpoints used the personal collection.
3. https://raw.pixls.us/?noncc0#repo: count the non-CC0 rows and note their licences.
4. https://arxiv.org/abs/2501.08924v1: the full submission history and Comments field.

## Sources

- https://arxiv.org/pdf/2501.08924 and https://arxiv.org/abs/2501.08924v2
- https://github.com/trougnouf/rawnind_jddc (README) and https://github.com/trougnouf/rawnind_jddc/issues/5
- https://raw.pixls.us/
- https://pixls.us/blog/2017/01/new-year-new-raw-samples-website/
- https://pixls.us/blog/2017/09/keep-the-raws-coming/
- Attempted but blocked: https://doi.org/10.14428/DVN/DEQCIM, the Dataverse API, and the Google Drive folder above.
