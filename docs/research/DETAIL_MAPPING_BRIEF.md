# Detail sharpening: slider mapping and speed — performance brief

_Written 2026-10-13 on `lightbench/detail` for the owner's request "test the research suggestions and give me a performance brief before PR". It compares the shipped (built) mapping of the four Sharpening sliders with the research proposal, and measures one speed option (a separable blur). Nothing here changes the shipped app: both experiments ran behind a test-only switch (`mappingForTests`) in a commit that was reverted afterwards (see "Reproducing")._

**How to read the numbers.** "Measured" means measured on this branch with the scripts listed at the end. Speeds come from SwiftShader, a software GPU running on the CPU: **its times are only good for comparing configurations with each other, not as real-GPU times**. Anything not measured is labelled **judgement** or **estimate**.

## The two mappings

Both use the same engine: darktable's capture sharpening (Richardson–Lucy deconvolution with a Gaussian PSF, `src/iop/demosaicing/capture.c`), with the same contrast mask and the automatic radius. They differ only in what the four sliders do. Both are LightBench's own; neither is Lightroom's or darktable's.

| Slider | Built (shipped) | Research proposal (tested) |
|---|---|---|
| Amount 0–150 (RAW default 40; 25 above ISO 1000) | Iterations = Amount / 5 (40 → 8, darktable's default; 150 → 30), fractional counts blended | A gain on the deconvolution's change: Amount / 40 (40 = darktable's 8-iteration result at full strength; 150 = 3.75×) |
| Radius | The PSF's σ, 0.25–1.5 px, with an **Auto** switch (measured from the raw data) | A multiplier of the automatic radius, 0.5–3.0 (1.0 = Auto) |
| Detail 0–100 (default 25) | Halo limit: the overshoot beyond the pixel's 3 × 3 range is kept × Detail / 100 | Iterations = 4 + round(Detail × 0.16) (0 → 4, 25 → 8, 50 → 12, 100 → 20); no halo limit |
| Masking 0–100 | darktable's automatic threshold + Masking / 100 of the rest | the same |

The proposal was given to me as a summary of a newer Cowork version of `docs/research/DETAIL_DENOISE_SHARPEN.md` §4. The version of that file on `origin/lightbench/detail-research` describes the built mapping, so the proposal was implemented from the summary.

At the defaults the two mappings agree except for the halo limit. Research Amount 40 / Detail 25 runs 8 iterations at gain 1 with no halo limit, which is exactly built Amount 40 / Detail 100. The measurements confirm it: identical numbers on the chart, and identical pixels on the real photos for the 20-iteration pair (research Detail 100 = built Amount 100 / Detail 100).

## 1. Edge chart (measured)

A 768 × 512 synthetic chart with real sensor noise: the Canon EOS-1D Mark III ISO 6400 noise profile (darktable's) as Poisson–Gaussian noise, flat grey patches at 0.02 / 0.08 / 0.25, and slanted edges blurred by σ 0.8 px (low contrast 0.10 → 0.20, high contrast 0.04 → 0.40). The table lists the 10–90 % edge rise in px (lower = sharper; the unsharpened edge is 2.14 px), MTF50 in cycles/px, and the high edge's overshoot / undershoot in % of the step. Built Radius is σ 0.8 px; research Radius is ×1.6, which is also σ 0.8 because the chart's automatic radius is darktable's default 0.5 px (the chart has no raw data to measure). Flat-patch noise was ×1.00 of the unsharpened chart in **every** row of both mappings: the contrast mask keeps sharpening out of flat areas at this ISO.

| Setting | Built: low edge rise, MTF50 | Built: high edge rise, MTF50, over/under % | Research: low edge rise, MTF50 | Research: high edge rise, MTF50, over/under % |
|---|---|---|---|---|
| off | 2.14, 0.230 | 2.14, 0.230, 0.2/0.1 | (same) | (same) |
| Amount 20 | 1.67, 0.290 | 1.59, 0.300, 1.2/0.5 | 1.80, 0.275 | 1.75, 0.285, 1.1/0.5 |
| Amount 40 | 1.57, 0.310 | 1.47, 0.330, 1.1/0.5 | 1.54, 0.320 | 1.44, 0.335, 5.1/1.8 |
| Amount 80 | 1.50, 0.335 | 1.38, 0.355, 1.0/0.4 | 1.19, 0.375 | 1.04, 0.405, **15.6/6.2** |
| Amount 150 | 1.45, 0.350 | 1.33, 0.380, 0.8/0.2 | 0.85, 0.415 | 0.73, 0.530, **34.4/8.0** |
| Detail 0 (Amount 40) | 1.59, 0.310 | 1.48, 0.330, 0.2/0.2 | 1.64, 0.295 | 1.57, 0.305, 4.3/1.7 |
| Detail 25 | 1.57, 0.310 | 1.47, 0.330, 1.1/0.5 | 1.54, 0.320 | 1.44, 0.335, 5.1/1.8 |
| Detail 50 | 1.56, 0.315 | 1.46, 0.330, 2.5/0.9 | 1.48, 0.335 | 1.38, 0.350, 5.6/1.8 |
| Detail 100 | 1.54, 0.320 | 1.44, 0.335, 5.1/1.8 | 1.41, 0.355 | 1.32, 0.370, 6.1/1.8 |
| Radius small (built σ 0.5 / research ×1.0) | 1.92, 0.255 | 1.88, 0.260, 0.2/0.1 | 1.91, 0.255 | 1.88, 0.260, 0.2/0.1 |
| Radius = the blur (σ 0.8 / ×1.6) | 1.57, 0.310 | 1.47, 0.330, 1.1/0.5 | 1.54, 0.320 | 1.44, 0.335, 5.1/1.8 |
| Radius large (σ 1.2 / ×2.4) | 1.46, 0.310 | 1.39, 0.330, 4.3/1.2 | 1.40, 0.310 | 1.35, 0.330, 16.6/4.3 |
| Masking 50 (Amount 40) | 2.14, 0.230 (left alone) | 1.55, 0.315, 0.2/0.4 | 2.14, 0.230 (left alone) | 1.52, 0.320, 3.1/1.6 |

**Is each slider monotone, and does it do one clear thing?** (measured, from the table)
- **Built Amount**: monotone. Sharper edges with diminishing returns (rise 1.59 → 1.33 px from 20 to 150), overshoot stays ≈ 1 % because Detail 25 holds haloes back. One clear thing: *how far the deconvolution goes*. Its top end is gentle; 150 is only a little sharper than 80.
- **Built Detail**: monotone. Almost only overshoot changes (0.2 % → 5.1 %), the rise barely moves (1.48 → 1.44 px). One clear thing: *halo amount*, which matches Lightroom's description of Detail (halo suppression ↔ full deconvolution).
- **Research Amount**: monotone and much stronger. Rise 1.75 → 0.73 px, overshoot 1 % → 34 %. A rise of 0.73 px is steeper than the edge was before its 0.8 px blur, so the top half of the slider over-sharpens: it extrapolates past the deconvolution and adds ringing. It does one thing, *strength*, but half of its range produces haloes.
- **Research Detail**: monotone. More iterations make edges sharper (1.57 → 1.32 px) and raise overshoot a little (4.3 % → 6.1 %). It is a second strength control, and it is the one that costs time (below). There is no control left for haloes.
- **Radius**: both monotone. Too large a radius makes haloes in both (4.3 % built at σ 1.2; 16.6 % research at ×2.4, where no halo limit applies).

## 2. Real photos at 100 % (measured)

These are 480 × 360 crops of full-size sRGB exports (`mcrops/`): the Canon EOS-1D Mark III at ISO 6400 (a figurine against a plain wall) and the Nikon D700 (fountain and tree tops against the sky). "Detail" is the crop's mean |Laplacian| of luma (fine contrast). "Flat" is the standard deviation of a plain patch: the wall for the 1D Mark III, the sky for the D700. Both use the automatic radius.

| Setting | 1D Mark III ISO 6400: detail / wall noise | D700: detail / sky noise | SwiftShader export (1D Mark III; D700), relative only |
|---|---|---|---|
| off | 10.84 / 7.97 | 5.90 / 0.61 | 24 s; 39 s |
| built Amount 25 (high-ISO default) | 13.32 / 8.74 | 7.73 / 0.62 | 66 s; 128 s |
| built Amount 40 (default) | 13.90 / 8.85 | 8.02 / 0.61 | 81 s; 113 s |
| built Amount 100, Detail 100 | 18.77 / 10.67 | 9.40 / 0.63 | 158 s; 224 s |
| built Amount 150, Detail 100 | 19.47 / 10.86 | 9.66 / 0.63 | 301 s; 284 s |
| research Amount 25 | 14.38 / 9.23 | 7.57 / 0.62 | 110 s; 78 s |
| research Amount 40 (default) | 16.57 / 10.06 | 8.68 / 0.62 | 117 s; 60 s |
| research Amount 100 | 25.53 / 13.67 | 13.85 / 0.64 | 144 s; 75 s |
| research Amount 40, Detail 100 | 18.77 / 10.67 (= built 100/100) | 9.40 / 0.63 | 267 s; 160 s |
| research Amount 150, Detail 100 | 40.99 / 18.61 | 21.95 / 0.68 | 292 s; 104 s |

The export times vary by ±30 % between runs on this machine (the same 8-iteration work took 45–81 s). They show only the pattern described in section 3.

**By eye** (2× enlargements of the crops; judgement): at the defaults, research Amount 40 is visibly crisper than built Amount 40 and shows more grain on the ISO 6400 wall (+26 % wall noise against +11 %). At high settings the research mapping breaks down: at Amount 150 the 1D Mark III's wall becomes coarse, sharpened grain (2.3× the noise), and the D700's leaves get black outlines and the spray dark rims. This is where the gain pushed luminance below zero and the clamp at 0 took over. The built mapping at its maximum (Amount 150, Detail 100) stays plausible: sharper, with some grain, and no outlines.

## 3. GPU time per setting (SwiftShader, relative only)

Capture sharpening's cost is the masks (once) plus two 9 × 9 blurs per iteration. The Detail stage alone was timed at full size on the 12 MP D700 (`e2e-mapping-timing.mjs`, two runs each; reading back the result costs 1.8–1.9 s and is included):

| Setting | Iterations | Seconds (two runs) |
|---|---|---|
| built Amount 40 | 8 | 80.3, 76.6 |
| built Amount 80 | 16 | 136.9, 125.0 |
| built Amount 150 | 30 | 190.6, 179.4 |
| built Amount 40, Detail 100 | 8 | 60.4, 45.1 |
| research Amount 40, Detail 25 | 8 | 44.4, 60.5 |
| research Amount 150, Detail 25 | 8 | 46.3, 46.3 |
| research Detail 50 | 12 | 61.8, 64.4 |
| research Detail 100 | 20 | 119.2, 105.8 |

- **Time follows the number of iterations, nothing else** (measured): about 4–6 s per iteration here, plus about 15–20 s for the masks and the result. Equal iteration counts take equal time in either mapping, within this machine's ±30 % noise.
- **Built**: Amount drives the cost (8 → 30 iterations, about 3.7× the work at 150 vs 40). Detail is free.
- **Research**: Amount is free (a multiply); Detail drives the cost (4 → 20 iterations, 2.5× at 100 vs 25). Its maximum, 20 iterations, is cheaper than the built maximum of 30.
- **Real GPU (estimate, not measured):** PHASE3.md Part 13 estimates 10–40 ms for 8 iterations at 24 MP on a mid-range discrete GPU, so roughly 1–4 ms per iteration. That makes the built maximum (30 iterations) about 35–150 ms and the research maximum (20) about 25–100 ms, 3–6× more on integrated graphics. Most photos stay at the defaults (8 or 5 iterations) in both mappings.

## 4. Separable blur (speed option; measured)

darktable's capture-sharpening kernel is a 9 × 9 Gaussian cut to a disc (5 × 5 below σ 0.66), read 81 times per pixel per blur, two blurs per iteration. The test replaced each blur with two 9-tap passes: a horizontal pass into a temporary buffer, then a vertical one. The 1-D weights are the kernel's centre row, normalised, so the separable kernel is the full square rather than the disc. The per-pixel σ (the taper over the outer 8 pixels) is kept. That is 18 reads per pixel instead of 81, plus one extra write and read of a float per pixel per blur.

| Case | Separable vs 9 × 9: max difference | mean difference | relative to the sharpening's own change |
|---|---|---|---|
| Chart, Amount 40, σ 0.8 (linear values 0–1) | 0.0057 | 8.8·10⁻⁸ | 0.05 % |
| Chart, Amount 150, Detail 100, σ 0.8 | 0.0143 | 4.1·10⁻⁷ | 0.08 % |
| Chart, Amount 40, σ 1.2 | 0.0073 | 3.2·10⁻⁷ | 0.13 % |
| Chart, Amount 40, σ 0.5 (5 × 5 kernels) | 0.00085 | 1.4·10⁻⁸ | 0.02 % |
| 1D Mark III crop, Amount 40 (8-bit sRGB levels) | 1 | 0.0001 | — |
| 1D Mark III crop, Amount 150, Detail 100 | 1 | 0.0003 | — |
| D700 crop, Amount 40 | 1 | 0.0003 | — |
| D700 crop, Amount 150, Detail 100 | 1 | 0.0004 | — |

The few larger linear differences on the chart are single pixels; in the exported crops nothing differs by more than one level, and the detail and noise measures of section 2 are unchanged to two decimals. **Visually identical** (measured).

**Time on SwiftShader** (the D700, full size, Detail stage alone, alternating runs): Amount 40 took 54.3 / 58.1 s with 9 × 9 against 59.4 / 54.2 s separable. Amount 150 took 166.1 / 226.1 s against 154.7 / 101.4 s. So **no reliable difference was measurable here**. SwiftShader runs the shader on the CPU, where the 81 reads hit the CPU's caches and the extra passes cost as much as they save, and the run-to-run noise (±30 %) is larger than any effect.

**Real GPU (estimate, not measured):** on a GPU the 9 × 9 gather reads from a storage buffer, so the read count matters more. Fewer reads (18 vs 81) against one extra round trip through memory per blur might make each blur roughly 2–3× faster, i.e. capture sharpening maybe 1.5–2.5× faster overall (the masks don't change). This needs measuring on real hardware before it is worth the code.

If it is adopted before the Detail branch merges, **no process version is needed**: the tool is unreleased, and the change is far below one 8-bit level. It would also be visible only at 16-bit export.

## 5. Lightroom sidecar consequences (judgement, from the mappings; not checked in Lightroom)

| Field | Built | Research |
|---|---|---|
| `crs:Sharpness` (Amount) | Number for number; the meaning differs (iterations, not Lightroom's strength). Lightroom 40 reads as LightBench's default. | Number for number; 40 = darktable's reference result. Lightroom users who sharpen at 60–90 would get 15–30 % overshoot on edges (chart: 15.6 % at 80). |
| `crs:SharpenRadius` (0.5–3.0, default 1.0) | Read as σ = value / 2 (0.25–1.5 px). 1.0 reads as **Auto** and Auto is written as 1.0, so a Lightroom file with exactly 1.0 and a by-hand 0.5 px in LightBench look the same in the file. | **Maps naturally**: the value is the multiplier, and 1.0 = Auto exactly as Lightroom's default. No Auto switch is needed and nothing is ambiguous. Above about ×2.2–2.7 the σ (auto 0.55–0.69 px on the test cameras) passes 1.5 px, darktable's maximum radius; wider Gaussians are cut off by the 9 × 9 kernel. The chart's ×2.4 already showed 16.6 % overshoot. |
| `crs:SharpenDetail` | Halo suppression, Lightroom's described meaning: low = fewer haloes. | Iteration count. Lightroom's Detail 0 (maximum halo suppression) would mean *fewer iterations, still no halo limit*, the opposite of what a Lightroom user meant; 100 would mean 20 iterations. |
| `crs:SharpenEdgeMasking` | Same in both: above darktable's automatic threshold. | Same. |

## 6. Pros and cons

**Built mapping**
- Pro (measured): every slider is monotone and does one thing. Amount = how far the deconvolution goes (gently, saturating), Detail = haloes only.
- Pro (measured): safe across the whole range; at the maximum, overshoot stays ≤ 1 % at Detail 25 and 5–6 % at Detail 100, with no outlines on real photos.
- Pro (judgement): Detail means what Lightroom says it means, so Lightroom sidecars carry over in spirit.
- Con (measured): Amount's top half adds little (rise 1.38 → 1.33 px from 80 to 150) at up to 2× the time, so the slider feels weak above 80.
- Con: Radius needs an Auto switch and the 1.0 ↔ Auto convention in sidecars.

**Research proposal**
- Pro (measured): Amount is free in time (a gain), and its range reaches much further.
- Pro (judgement): Radius as a multiplier of Auto maps to Lightroom's SharpenRadius naturally, with no Auto switch.
- Pro (measured): the maximum cost is lower (20 iterations vs 30).
- Con (measured): Amount above about 60 overshoots heavily (15.6 % at 80, 34 % at 150 on the chart), and at high Amount real photos get black outlines and sharpened grain (ISO 6400 wall noise 2.3× at Amount 150 / Detail 100).
- Con (measured): the default is already harsher than the built default at high ISO (+26 % wall noise vs +11 %), because Detail 25 no longer limits haloes.
- Con (judgement): no halo control remains, and Lightroom's Detail meaning is lost (Detail 0 from a Lightroom file would mean "fewer iterations").

## 7. Recommendation (judgement, based on the measurements above)

1. **Keep the built mapping.** It is the safer one across the whole range, and its Detail keeps Lightroom's meaning. The research proposal's main gains are a stronger Amount and a cheaper maximum, but they come with haloes the built mapping doesn't produce.
2. **Optionally adopt the one idea that maps well: Radius as a multiplier of Auto** (0.5–3.0, 1.0 = Auto). That would make `crs:SharpenRadius` carry over exactly and remove the Auto switch. It needs a cap, e.g. σ at most 1.5 px (darktable's kernel limit). It hasn't been built or measured as a combination with the built Amount and Detail.
3. If a stronger top end is wanted: a mild gain above Amount 80 *together with* the built halo limit (Detail) would keep haloes in check. Not measured.
4. **Separable blur:** safe to adopt (visually identical, measured), but its speed gain is unproven: SwiftShader can't show it, and the real-GPU gain is an estimate. Worth doing only after timing it on one real GPU (e.g. with WebGPU timestamp queries). Either way, no process version is needed before the merge.

## Reproducing

- Code: commit `d5a5a0e` added `mappingForTests.research` and `d81618b` the separable blur (`mappingForTests.separable`); `e2af7f3` reverts both, so the shipped code is exactly as before (checked: no difference in `web/src` from the commit before the experiments).
- Scripts (`scratchpad/followups-h/`, run against a Vite dev server): `e2e-mapping.mjs` (chart), `e2e-mapping-crops.mjs` + `py/mcrops.py` (crops), `e2e-mapping-timing.mjs` (full-size timing), `e2e-sep.mjs` and `e2e-sep-crops.mjs` (separable blur). The crops near a Vite-cache incident (14:34) were rendered again and were byte-identical.
- Caveat found while testing: after a hot reload, a test page can hold a second, stale copy of a module, so a flag set from the test doesn't reach the engine. Restart the dev server after editing code that a test switch lives in.
