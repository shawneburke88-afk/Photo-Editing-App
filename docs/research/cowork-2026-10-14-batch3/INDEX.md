> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-14 (batch 3 revised: existing AI models). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# LightBench verification: batch 3, existing AI models (2026-10-14)

Verification of `COWORK_VERIFY_2026-10-14_batch3_revised.md`. Each file opens with a "Decisions this changes" table, followed by item-by-item verdicts (Confirmed / Contradicted / Partly / Not found), each with a verbatim quote, URL and read date. Appendix items were skipped, as the brief instructs.

| File | Part | Summary |
|---|---|---|
| `A_FACES_PEOPLE.md` | A: BlazeFace, Face Landmarker, Selfie Segmentation/Multiclass, MediaPipe Tasks for Web | 5 Confirmed · 6 Partly · 1 Contradicted · 9 Not found (8 because model-card PDFs wouldn't load) |
| `B_SKY_DEPTH.md` | B: Depth Anything 3 sky output, DA-V2 Small, small sky models | No permissive small sky model qualifies |
| `C_EMBEDDINGS.md` | C: OpenCLIP (YFCC15M, LAION), DINOv2, DINOv3 | None passes the strict two-part rule |
| `D_COLOUR_TESTING.md` | D: CIEDE2000 reference data and implementations | Validation recipe recommended |

## The three most important findings

1. **The training-data half of the rule is now the bottleneck, and it needs a decision from you.** Several models have permissive weights but training data that is non-commercial, research-only or undisclosed:
   - **Depth Anything V2 Small** (the current depth pick): weights are Apache-2.0, but its pseudo-labelled real images include **SA-1B**, licensed "solely for Research Purposes". The data is *known* but not *permissive*. (B)
   - **DINOv2**: Apache-2.0 weights, but LVD-142M was never released. **DINOv3**: custom "DINOv3 License" with use restrictions and gated weights, so it fails outright. (C)
   - **Selfie Multiclass**: Apache-2.0, but the card gives no data source or consent statement. (A)
   - **OpenCLIP YFCC15M**: the image IDs are published, but in the parent YFCC100M about 68% of images are CC non-commercial. The subset's own licence mix is unpublished. LAION-trained weights are out of scope for deployment. (C)
   - **Passes so far:** BlazeFace sparse full-range: Apache-2.0, "trained and evaluated on consented images". The other MediaPipe cards wouldn't load.

   **Decision needed:** does "training-data provenance must be known" mean *disclosed*, which DA-V2 Small passes, or *disclosed and permissively licensed*, which almost nothing passes, including DA-V2 Small?

2. **MediaPipe Tasks for Web runs on WebGL2/WASM, not WebGPU, and is adding telemetry.**
   - The "GPU" delegate is WebGL2 (source: `graph_runner.ts`). Plan a WebGL2 context alongside the WebGPU pipeline, and don't expect to share GPU buffers between them.
   - Release v1.1.0: "Add stats logging to Web Tasks." The maintainer says "We currently are not planning to have an opt-out mechanism" and "You can block outgoing requests, or block the destination host". Pin the version, ship a CSP with `connect-src 'self'`, and say so in the privacy statement. This bears on "photos stay on the device"; the maintainer states input data is not sent.
   - Self-hosting the `.task` and WASM files and running in a module Web Worker are both supported.
   - Face Landmarker has the **short-range** (about 2 m) detector built in. For culling, run full-range BlazeFace (up to 5 m) first, then crop faces for Landmarker. (A)

3. **No small, permissive sky-segmentation model exists that meets the rule.**
   - The small MIT U²-Net sky models don't state their training data, NVIDIA SegFormer is non-commercial, and ADE20K-trained models inherit ADE20K's non-commercial terms.
   - Depth Anything 3 has "Sky Seg" only on DA3MONO-LARGE and DA3METRIC-LARGE (Apache-2.0, 1.34 GB each, so too big for a browser default) and on the two nested-Giant models (CC BY-NC). Its sky-label source isn't stated, and METRIC-LARGE was trained partly on Waymo and other non-commercial driving data.
   - For now, a sky mask needs a classical approach or waits for the deferred own-training route. (B)

## Also worth noting

- **CIEDE2000 (D):** Sharma, Wu & Dalal 2005, *Color Res. Appl.* 30(1):21–30, DOI 10.1002/col.20070. The 34-pair test data (`ciede2000testdata.txt`) has **no stated terms**; the page grants "Personal or research use" only for the MATLAB/Excel code. Recommendation: test all 34 pairs at a 1e-4 tolerance against color.js or culori (both MIT) as the oracle, and don't copy Sharma's code. colour-science (BSD-3) skips pair 14, an exact 180° hue case.
- **Correction to Part B's summary:** besides Mono-Large and Metric-Large, the DA3 README also ticks Sky Seg for DA3NESTED-GIANT-LARGE(-1.1), which are CC BY-NC 4.0. This doesn't change the conclusion.

## Spot-check log (main session, 2026-10-14)

All re-fetched from primary sources and matching the part files:

- MediaPipe issue #6306: the no-opt-out and block-requests quotes, plus "The current version of the Web SDK does not include telemetry" (written before v1.1.0). **Confirmed.**
- MediaPipe v1.1.0 release notes: "Add stats logging to Web Tasks." **Confirmed.**
- DINOv3 repo: "DINOv3 code and model weights are released under the DINOv3 License." **Confirmed.**
- Depth Anything 3 README model table: Sky Seg ticked for MONO-LARGE and METRIC-LARGE (Apache 2.0) and for both NESTED-GIANT-LARGE variants (CC BY-NC 4.0). **Confirmed**, with the correction noted above.

## Unresolved

- **MediaPipe model cards that didn't load:** BlazeFace short-range, BlazeFace full-range (dense), Face Mesh V2, Blendshape V2, Selfie Segmentation. Their licence and training-data wording is still open. A has test snippets for WebGL2 and for telemetry.
- **Source of DA3's sky labels.**
- **The YFCC15M subset's exact licence mix.** Computing it needs the metadata download.
