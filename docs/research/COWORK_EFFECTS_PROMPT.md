# Cowork research prompt: Effects build (2026-10-17)

Ready to paste into Claude Cowork. It covers only what [EFFECTS_DESIGN.md](EFFECTS_DESIGN.md) could not verify this session: patent pages, Adobe pages and the other sources listed there under "Blocked sources". Copied from that file's "Cowork research prompt" section.

```text
COWORK_EFFECTS_2026-10-17: verification for LightBench's Effects build

Context
LightBench is a GPL-3.0 Lightroom-class photo editor built on darktable's processing. Its Effects build
(Post-crop vignette, Grain, Dehaze, Texture, Clarity, Glow) is designed in docs/research/EFFECTS_DESIGN.md
(branch lightbench/research-effects). The Dehaze recommendation is a port of darktable's haze removal
(src/iop/hazeremoval.c): per-pixel dark channel min(R,G,B) + box minimum; ambient light A0 from the
95th-percentile dark-channel pixels' brightest 5 %; transmission t = 1 − s·min_c(I_c/A0_c) with s the user's
strength (a constant); box max then box min; a colour-guided He guided filter; t_min = exp(−distance·depth);
output (I − A0)/max(t, t_min) + A0. The claims of US 9,508,129 and US 9,646,364 were already read and
mapped; don't redo them.

How to work
- Open each page yourself; quote verbatim with the URL and the date read. Mark secondary sources.
- Facts only: claim wording, status, dates, definitions in the description. No legal conclusions.
- If a page is blocked, record the URL and how it failed, and try the alternatives listed.
- Google Patents labels status as "an assumption and is not a legal conclusion": quote it as such.

Return
One Markdown file with a "Decisions this changes" table first, then item-by-item verdicts
(Confirmed / Contradicted / Partly / Not found), each with quotes, URL and read date, then a list of
blocked sources.

Items
1. US 9,508,126 B2 (Adobe; "Image haze removal using fast constrained transmission estimation"):
   all independent claims (1, 8, 14) verbatim and complete; how the description defines the "fractionally
   scaled variant" and its "scaling factor that is a function of the input digital image"; what filter the
   claims require (mean / median / minimum?); status and expiry. Then, element by element, say whether the
   darktable method above performs each element, as facts (which quantity in darktable corresponds, or none).
   Try https://patents.google.com/patent/US9508126B2/en, its PDF link on that page, and
   https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9508126.
2. US 9,305,339 B2 (Adobe; "Multi-feature image haze removal"): independent claims verbatim, status, expiry;
   the same element-by-element facts against the darktable method.
3. US 10,367,976 B2 (US Navy; "Single image haze removal"): the same as item 2.
4. Local Laplacian filters (Paris, Hasinoff, Kautz; Adobe / MIT / Google): any US patent by these inventors
   on Laplacian-pyramid edge-aware filtering; number, claim 1, status. Search Google Patents by inventor
   ("Sylvain Paris" Laplacian pyramid) and assignee Adobe. Also "Fast local Laplacian filters" (Aubry et al.).
5. Guided filter (He, Sun, Tang; Microsoft): any patent on guided image filtering; number, status, claim 1.
6. Adobe Texture (2019) and Clarity: any Adobe patent describing a band-limited detail control or
   "texture" slider (e.g. inventors Max Wendt, Eric Chan); numbers, status, claim 1.
7. Post-crop vignette "Highlight Priority" / "Color Priority": any Adobe patent; number, status, claim 1.
8. Camera Raw Glow (18.6, 2026): Adobe help page "Glow, Vignette, Grain, and Dehaze effects in Camera Raw"
   verbatim (styles, sliders, ranges, defaults, mask behaviour); the release version and date; whether
   Lightroom Classic or Lightroom has Glow as of October 2026; the crs: field names (from a public
   Camera Raw-written XMP, ExifTool's current XMP.pm, or Adobe's crs namespace page).
9. Glow, bloom or halation patents (Adobe 2024–2026 filings on simulated film halation or highlight bloom):
   numbers, status, claim 1.
10. US 8,340,461 B2: the lapse date and the fee event (USPTO Patent Center or the maintenance-fee record).
```
