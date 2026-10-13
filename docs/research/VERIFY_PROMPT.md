You are verifying research for LightBench, an open-source (GPL-3.0) Lightroom-style photo editor that runs in the browser. The research was written on a machine that could not open most websites. Claims it couldn't check are tagged **[search]** (from search-result summaries), **[memory]** (remembered, not confirmed) or **unverified**. Your job is to check them against primary sources, using your web browsing.

## The documents (public, read them first)
- https://raw.githubusercontent.com/shawneburke88-afk/Photo-Editing-App/lightbench/research-2026-10-13/docs/research/TONE_CURVE.md
- https://raw.githubusercontent.com/shawneburke88-afk/Photo-Editing-App/lightbench/research-2026-10-13/docs/research/DETAIL_DENOISE_SHARPEN.md
- https://raw.githubusercontent.com/shawneburke88-afk/Photo-Editing-App/lightbench/research-2026-10-13/docs/research/PHASE4_MODELS.md
- https://raw.githubusercontent.com/shawneburke88-afk/Photo-Editing-App/lightbench/research-2026-10-13/docs/research/DEPTH_OF_FIELD.md

## Rules
- Use primary sources: the official docs, the LICENSE file or model card, the patent record (Google Patents or USPTO), the source code, or the paper.
- Quote the exact sentence that settles each claim, and give its URL.
- Don't guess. If a page won't load, or the answer isn't there, say "still unverified" and why.
- You are not giving legal advice. For patents, report only the public facts: status, expiry date, assignee and the gist of claim 1.

## Check these first (they drive decisions), then every other tagged claim
**A. Licences.** The owner allows permissive licences only; GPL-3.0 weights are still undecided. Check the **weights** licence separately from the **code** licence.
1. **MI-GAN (Picsart):** the weights licence (`LICENSE-WEIGHTS`, MIT?), what the Co-Mod-GAN teacher contributed, the NVIDIA-copyright files in the repo, and the training data (Places2) terms.
2. **LaMa (big-lama, Samsung):** does anything license the weights beyond the repo's Apache-2.0?
3. **Depth Anything V2:** Small = Apache-2.0, Base/Large/Giant = CC-BY-NC-4.0? Also the licence of the metric-depth checkpoints.
4. **Other depth models:** the licences of Depth Pro (Apple), Metric3D, MoGe-2, UniDepth and Marigold.
5. **Masking models:**
   - BiRefNet: code and weights licence, and the DIS5K training-data terms.
   - BRIA RMBG-1.4 and 2.0.
   - SAM 2.1 (and SAM 2.1 Tiny).
   - MediaPipe Selfie Multiclass.
   - Depth Anything 3 MONO-LARGE.
6. **Moebius (HUST inpainting, 2026):** the code, weights and VAE licences, and the training data.
7. **Denoise models:**
   - RawNIND / NIND (darktable-ai), said to be GPL-3.0;
   - PMRID (Apache-2.0?), SCUNet, NAFNet (MIT?);
   - the SIDD dataset terms.
8. **Hugging Face:** its terms on hotlinking or embedding model downloads in a public web app; whether `huggingface.co` file URLs send CORS headers that allow browser fetches; and its rate limits for anonymous downloads.
9. **GitHub:** do Release asset downloads (`release-assets.githubusercontent.com`) allow cross-origin `fetch()` from another website? Check in a real browser if you can. Also GitHub Pages' size, bandwidth and file limits, and its "not for commercial SaaS" wording.

**B. Patents** (status, expiry, assignee, gist of claim 1).
1. **US 8,285,055 B1** (Adobe, PatchMatch "Determining correspondence between image regions"): is it active, and is the adjusted expiry 2031-04-09? Do its claims require random search plus propagation? Also the related patents US 8,571,328, 8,811,749, 8,861,869 and 8,625,927.
2. **Adobe content-aware fill patents:** US 8,818,135, 9,305,329, 8,861,868, 9,317,773, 9,396,530 and 10,719,913. Is Wexler et al. 2007 "Space-Time Completion of Video" patented?
3. **Apple US 10,410,327 B2,** "Shallow depth of field rendering": its status and the gist of claim 1.
4. **Adobe's "extended range curves" patent:** find it and give its number and status. Also MIT's two-scale tone-management patent (Bae, Paris, Durand).
5. **BM3D:** any patents, and its reference code's licence ("free for non-commercial use"?).
6. **Adobe's hue-preserving ("film-like") RGB curve:** is it patented? It's in the DNG SDK and in RawTherapee.

**C. Product behaviour** (from official docs).
1. **Lightroom Classic Tone Curve:**
   - the point-curve point limit (14 or 16?);
   - the Linear / Medium / Strong Contrast presets;
   - the R/G/B channel XMP field names (`ToneCurvePV2012Red/Green/Blue`?);
   - "Refine Saturation" (when it was added and what it does);
   - the TAT behaviour, including arrow keys while hovering.
2. **Lightroom Detail panel:** what Amount, Radius, Detail and Masking do, especially whether Detail blends unsharp mask with deconvolution, and what Masking 0 does. Also Lightroom's default sharpening for RAW (40?).
3. **Lightroom Denoise:** did version 14.4 (2025) stop writing a separate DNG? Describe the current workflow.
4. **Lightroom Lens Blur:** its controls (focal range, depth visualisation, refine brush, bokeh shapes).
5. **Lightroom shortcuts:**
   - `]` / `[` raise or lower the rating; is there a Shift+0?
   - Shift+1–5: rate and go to the next photo.
   - Remove tool: Q, `[` `]`, Shift+`[` `]`, H (hide pins).
6. **darktable's manual:**
   - does it say its sharpen module is "no longer recommended"?
   - does it say to denoise before sharpening?
   - the defaults and modes of denoise (profiled).
   - Does darktable 5.4 have "capture sharpening" in demosaic, and does 5.6 ship a RawNIND AI denoise?
7. **RawTherapee (RawPedia):** Capture Sharpening (Richardson–Lucy, automatic radius, contrast threshold, corner boost), and the "Perceptual" and "Film-like" curve types.
8. **Capture One:** Curve Luma vs RGB modes.
9. **DaVinci Resolve:** curves luma mix, and the Hue-vs / Sat-vs curves.
10. **web3dsurvey.com:** what share of devices report WebGPU `maxStorageBufferBindingSize` ≈ 2 GiB, and the typical values.

## Output: one Markdown document
1. **A table per section (A, B, C, then "Other tagged claims")** with these columns:
   - Claim (short);
   - Doc and section;
   - Verdict: **Confirmed / Corrected / Still unverified**;
   - Correct statement (if corrected);
   - Source URL;
   - Exact quote.
2. **"Changes that affect decisions":** a short list of anything that changes a recommendation. Examples: a model's licence isn't permissive after all; a patent has expired or doesn't cover what we thought; Lightroom works differently than assumed.
3. **"Couldn't check":** what failed, and why.

Keep quotes short and exact. Don't summarise a page you didn't actually open.
