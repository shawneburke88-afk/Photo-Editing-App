> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-13/14 (batch 2, prompt `COWORK_VERIFY_2026-10-13b`). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# LightBench research verification: batch 2 (2026-10-13/14)

Verification of `COWORK_VERIFY_2026-10-13b.md`. Every file opens with a "Decisions this changes" table, followed by item-by-item verdicts (Confirmed / Contradicted / Partly / Not found), each with a verbatim quote, URL and read date. The repo source briefs were used for context only.

| File | Part | Verdicts (approx.) |
|---|---|---|
| `A_COLOUR_MIXER_EFFECTS.md` | A: Colour Mixer, Point Color, Vignette, Grain, Dehaze, Texture/Clarity | 6 Confirmed · 8 Partly · 0 Contradicted · 3 Not found |
| `B_MASKING.md` | B: Masking and local adjustments | 25 · 11 · 1 · 11 (48 sub-items) |
| `C_COLOUR_GRADING.md` | C: Colour Grading | 2 · 6 · 0 · 0 |
| `D_PROFILES.md` | D: Camera profiles and looks | 0 · 7 · 0 (+1 contradicted sub-part) · 2 |
| `E_SNAPSHOTS_PROOFING_SEARCH.md` | E: Snapshots, soft proofing, tool search | 0 · 7 · 1 · 0 |
| `F_MODEL_DELIVERY.md` | F: AI model delivery (includes an appendix of local browser tests) | 11 · 8 · 2 · 10 (31 sub-items) |
| `G_DENOISE_TRAINING_DATA.md` | G: Raw denoiser training data | 5 · 4 · 1 · 3 |
| `H_IMPROVEMENTS.md` | H: Improvements inventory (datasets, patents, GPU) | ~16 · 8 · 2 · 7 |

## The three most important findings

1. **Two masking patents are still active and bear directly on the masking design.**
   - **US 11,223,744 B2** "Local color range selection" (Adobe Inc.): filed 2017-10-17; Google Patents: "Active, expires 2037-12-02". Claim 1 weights an edit by a spatial mask combined with a colour/luminance range mask. This is close to "range mask intersected with a brush/gradient".
   - **US 8,837,849 B2** "Method for noise-robust color changes in digital images" (Google LLC, from Nik): priority 2007-06-26; "Active, expires 2031-10-04".
   - The other listed U Point patents are expired, as is Microsoft's dark-channel patent **US 8,340,461** ("Expired - Fee Related").

   Detail: B_MASKING.md items 5 and 1; H_IMPROVEMENTS.md item 11; A item 10. Facts only, not legal advice.

2. **Lightroom Classic 15.0+ writes masks to a separate `.acr` sidecar, not the XMP.** Adobe: "Lightroom identifies if there are any heavy edits, masks, or AI settings" and "writes the heavy edits to the ACR sidecar while keeping the XMP sidecar lightweight." An XMP-only importer will silently drop those masks. Detect `.acr`, warn the user, and import what the XMP holds. The `.acr` format has no public spec. (B_MASKING.md, 4i)

3. **fp16 models fail, rather than upcast, on adapters without `shader-f16`.** ORT's WebGPU EP source raises "requires f16 but the device does not support it". LightBench needs a feature check and fp32 fallback files for every model. ORT issue #26732 (fp16 overflow on WebGPU) was closed by a stale bot, with no runtime fix in 1.30. (F_MODEL_DELIVERY.md, items 8–9)

## Other findings that change plans

- **Ctrl+N (E3, Contradicted):** Chromium reserves it in normal tabs, but "In Apps mode, no keys are reserved", so an installed PWA window does receive it. Keep a cross-context default and optionally bind Ctrl+N in standalone mode.
- **Grain:** `crs:GrainFrequency` is a separate field from `GrainSize`, so it is almost certainly Roughness; darktable's importer maps it wrongly (secondary). **Variance:** Adobe's help says "how broadly or narrowly…", but Adobe's tutorial and Julieanne Kost describe colour contrast within the range.
- **Training data:** RAISE, DIV2K, LSDIR, Virtual KITTI 2 and SA-1B are non-commercial or research-only. SIDD (MIT), HDR+ (CC BY-SA) and Poly Haven (CC0) are usable. The RawNIND Dataverse licence is still unread (the site is blocked). Its `extraraw` clean set is rebuilt from raw.pixls.us without a licence filter, so it may include CC BY-NC-SA files.
- **Dates corrected:** darktable AgX first shipped in **5.4.0**, not 5.2. Adobe Adaptive Color: beta in Camera Raw 17 (Oct 2024), in Lightroom Classic Feb 2025. darktable parametric masks arrived in 1.1 (2012) and drawn masks in 1.4 (2013).
- **DNG patent licence:** it covers "computer files compliant with the DNG Specification", doesn't mention `.dcp`, and requires the notice "This product includes DNG technology under license by Adobe." (D)
- **Don't bundle** the RawTherapee Hald CLUT pack or the G'MIC colour presets: no licence is stated, and some CLUTs were "reverse-generated" from other packages. (D)

## Not resolvable from here

- **XMP field codes and structure** (A4, B4, C4, D1, E1): these need Lightroom-written sidecars. The owner chose public sources only, so these stay Not found or Partly.
- **Live browser behaviour** (Hugging Face CORS on the 302/Xet hop, Pages Content-Type/compression, ORT on Safari/Firefox, fetch from LightBench's origin): F_MODEL_DELIVERY.md has an appendix with test snippets.
- **Blocked sources:** dataverse.uclouvain.be, raw.pixls.us/data, the DNG 1.7.1 spec PDF, Adobe's soft-proofing page, Adobe per-version release pages, ART source, the CC BY 4.0 legal code, polyhaven.com/license, the FiveK licence, Optica, and some ExifTool tables. Each file lists its own.

## Spot-check log (main session, 2026-10-14)

Re-fetched from the primary source, all matching the agents' reports:

- Adobe "Create XMP and ACR files" help page: the .acr wording above, and that this applies from Lightroom Classic 15.0. **Confirmed.**
- US 11,223,744 B2: Adobe Inc., filed 2017-10-17, "Active, expires 2037-12-02". **Confirmed.**
- US 8,837,849 B2: Google LLC, priority 2007-06-26, "Active, expires 2031-10-04". **Confirmed.**
- US 8,340,461 B2: Microsoft (now Microsoft Technology Licensing LLC), granted 2012-12-25, "Expired - Fee Related". The page doesn't show the lapse date. **Confirmed**, with the lapse date still unknown.

Google Patents labels its status and expiry fields as assumptions, not legal conclusions.
