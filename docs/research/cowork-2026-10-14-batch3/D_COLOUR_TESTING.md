> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-14 (batch 3 revised: existing AI models). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# Part D: colour testing (CIEDE2000 / ΔE2000 reference)

Verification for LightBench, batch 3 revised. All pages read 2026-10-14 unless marked otherwise. Quotes are verbatim; "…" marks a cut. Facts only, not legal advice.

## Decisions this changes

| Decision | Finding | Effect on LightBench |
|---|---|---|
| Which test data to validate ΔE2000 against | Sharma, Wu & Dalal (2005) Table I: 34 pairs, also published as `ciede2000testdata.txt` on Sharma's University of Rochester page | Use these 34 pairs as the main acceptance test. They are the de facto standard: colour-science, culori and color.js all test against them. |
| Whether Sharma's MATLAB/Excel code can be copied into a GPL project | The page says only: "Personal or research use of the MATLAB program/Excel Spreadsheet is permitted with proper citation and acknowledgement." There is no licence, and commercial use and redistribution aren't mentioned. | Don't vendor or port `deltaE2000.m` / `CIEDE2000.xls`. Use them only as an outside cross-check, and cite the paper. |
| Terms for the test-data file itself | The page states no terms for the data file specifically. The use permission names only the "MATLAB program/Excel Spreadsheet". | Open item for the owner. The 34 rows are also in Table I of the published paper and in the MIT and BSD test suites below. |
| Reference implementation | colour-science `colour.difference.delta_E_CIE2000` (BSD-3-Clause). In JS: culori `differenceCiede2000` (MIT) and color.js `deltaE2000` (MIT). All three test against the Sharma pairs. | Pick color.js or culori as the in-browser oracle (both are MIT, so compatible with GPL-3.0 per their licence type; owner to confirm). Use colour-science for offline cross-checks. |
| Test tolerance and edge cases | colour-science **excludes Sharma pair 14** because of a platform `arctan2` rounding difference at an exact 180° hue difference (ΔE 4.7461 vs 4.8045) | LightBench's test must include pair 14, with a note on how the ±180° boundary is handled. Use a 1e-4 tolerance against the 4-decimal published values, as color.js does. |

---

## Item 1: Sharma, Wu & Dalal (2005)

### 1a. Full citation with DOI. **Confirmed** (one minor caveat)

- Sharma's page gives: "The CIEDE2000 Color-Difference Formula: Implementation Notes, Supplementary Test Data, and Mathematical Observations," G. Sharma, W. Wu, E. N. Dalal, *Color Research and Application*, vol. 30, no. 1, pp. 21-30, February 2005.
  Source: https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/ (read 2026-10-14).
- The paper PDF on Sharma's site shows "Col Res Appl, 30, 21–30, 2005" and "© 2004 Wiley Periodicals, Inc." The DOI is printed split across a line break as "DOI 10.1002/col." / "20070".
  Source: https://hajim.rochester.edu/ece/sites/gsharma/papers/CIEDE2000CRNAFeb05.pdf (read 2026-10-14).
- *Secondary:* synapsesocial.com lists the DOI as "10.1002/col.20070", with the year as 2004 (the online-first year).
  Source: https://synapsesocial.com/papers/W2000512760 (read 2026-10-14).
- **Citation to use:** Sharma, G., Wu, W., & Dalal, E. N. (2005). The CIEDE2000 color-difference formula: Implementation notes, supplementary test data, and mathematical observations. *Color Research & Application*, 30(1), 21–30. https://doi.org/10.1002/col.20070
- Caveat: https://doi.org/10.1002/col.20070 didn't load (the permission request timed out), so I didn't see the DOI resolve on Wiley. It is confirmed from the article PDF itself.

### 1b. Where the 34-pair test data is published. **Confirmed** (the 34-row count of the .txt file is confirmed only through the paper and a secondary source)

- Page: https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/ (mirror: https://www.ece.rochester.edu/~gsharma/ciede2000/). Files sit under `…/ciede2000/dataNprograms/`:
  - Test data: `ciede2000testdata.txt` (link text "Test data"). The page says: "Each row of the file has a pair of CIELAB values and a color difference corresponding to the pair." Columns 1–3 are the reference L\*a\*b\*, 4–6 the sample L\*a\*b\*, and 7 is ΔE00 (as summarised by the fetch tool, not a verbatim quote).
  - MATLAB: `deltaE2000.m` ("Matlab function") and `deltaE2000test.m` ("test program").
  - Excel: `CIEDE2000.xls` ("Excel spreadsheet"), which includes the test data.
  - Paper: `ciede2000noteCRNA.pdf`.
- The page doesn't state the number of pairs. The paper's Table I has 34 numbered pairs (1–34). According to the paper (summarised by the fetch tool, not verbatim), pairs 25–34 come from the CIE technical report and from Luo, Cui & Rigg.
- I couldn't open the data file directly: https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt timed out on its permission request. *Secondary:* culori's test embeds a 34-row table with the comment "// Test data from: http://www2.ece.rochester.edu/~gsharma/ciede2000/" (see 2b).

### 1c. Terms of use on the page. **Confirmed** (narrow permission, no licence)

- "Personal or research use of the MATLAB program/Excel Spreadsheet is permitted with proper citation and acknowledgement."
- Disclaimer: "the data and the software are provided as is with no warranty what-so-ever."
- "This is not an official CIE implementation."
- Not stated on the page: any software licence, any copyright notice, anything on commercial use or redistribution, or any terms for the `.txt` test-data file specifically.
- The paper PDF carries "© 2004 Wiley Periodicals, Inc."
  Source: https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/ (read 2026-10-14).

### 1d. Implementation pitfalls the paper flags. **Confirmed**

From https://hajim.rochester.edu/ece/sites/gsharma/papers/CIEDE2000CRNAFeb05.pdf (read 2026-10-14). The PDF's text layer drops some Greek symbols such as Δ, so a few quotes read "E00" or "H" where the paper prints ΔE00 or ΔH′.

- **Why the CIE worked examples aren't enough:** "However, these worked examples are a small set and do not adequately test the implementation of the CIEDE2000 formula." The abstract says: "We indicate several potential implementation errors" and "A supplemental set of data is provided for comprehensive testing of implementations."
- **Existing implementations were wrong:** "In fact, several of the implementations distributed on the Internet, including some from reputable sources, were erroneous."
- **Hue angle needs a four-quadrant arctangent, mapped to 0–360°:** "The four-quadrant arctangent may be readily obtained using the two argument…" and "This must be converted to a hue angle in degrees between 0°…". The tool's summary (not verbatim): negative results get 2π added before converting to degrees.
- **Zero chroma:** "the modified hue is indeterminate and we have defined it as zero."
- **Hue difference sign (Eq. 10):** "Using the arithmetic difference directly can result in an incorrect sign for the metric hue difference H in Eq. (11)." (ΔH in the original.)
- **Signed differences:** "The use of an absolute value for both will produce a symmetric but incorrect formula."
- **Mean hue (Eq. 14), when the hue difference is over 180°:** the paper discusses the case "where the absolute difference between the modified hue angles is greater than 180°", and says "The latter computation is equivalent to adding/subtracting an angle of 180° to/from the mathematical average." At exactly 180°: "Our computation for this case results in a mean hue of 0° instead of the other reasonable choice of 360°."
- **Discontinuities:** "the function has three independent sources of mathematical discontinuities". The section headings are "Discontinuity Due to Mean Hue Computation", "Discontinuity in Hue-Difference Computation" and "Discontinuity Due to Hue Rollover at 360°". Also: "A discontinuity arises in the E00 difference due to the process used in Eq. (14)…"
- **Test coverage:** color.js labels its Sharma tests by the feature each one probes, e.g. "Sharma test 1: signed ΔH" and "Sharma test 7: arctan hue and mean hue". The fetch tool's own reading of Table I (not the paper's statement) put pairs 10 and 14 at exactly 180° hue difference.

---

## Item 2: permissively licensed reference implementations

### 2a. colour-science (Python `colour` package). **Confirmed**

- **Licence: BSD-3-Clause. Confirmed.**
  - Repo LICENSE: "Copyright 2013 Colour Developers" followed by "Redistribution and use in source and binary forms, with or without modification, are permitted…". The fetch tool identified the three conditions as the standard BSD 3-Clause terms.
    Source: https://github.com/colour-science/colour/blob/develop/LICENSE (read 2026-10-14).
  - Module header: `__license__` = "BSD-3-Clause - https://opensource.org/licenses/BSD-3-Clause".
    Source: https://colour.readthedocs.io/en/latest/_modules/colour/difference/delta_e.html (read 2026-10-14).
- **Function `colour.difference.delta_E_CIE2000`. Confirmed.**
  - Signature: "def delta_E_CIE2000(Lab_1: Domain100, Lab_2: Domain100," / "textiles: bool = False, additional_data: bool = False,".
  - References: ":cite:`Melgosa2013b`, :cite:`Sharma2005b`".
  - The `textiles=True` option uses ":math:`k_L=2,\\ k_C=k_H=1` weights…". By default, k_L = k_C = k_H = 1.
- **Does its test suite use the Sharma data? Partly: 33 of the 34 pairs.**
  - Test method: `test_delta_E_CIE2000_Sharma2004`, with the docstring "using Sharma (2004) dataset."
  - "# NOTE: The 14th test case is excluded as "Numpy" 1.24.0 introduced / # numerical differences between "Linux" and "macOS / Windows" with the / # "np.arctan2" definition :". The comment's table shows `delta_h_p` as -179.999999999999972 on Ubuntu vs 180.000000000000000 on macOS/Windows, and `d_E` as 4.746066453039259 vs 4.804524508211768.
  - Tolerance: "atol=TOLERANCE_ABSOLUTE_TESTS * 1000". I didn't see the numeric value of `TOLERANCE_ABSOLUTE_TESTS`: its docs page timed out on its permission request.
    Source: https://github.com/colour-science/colour/blob/develop/colour/difference/tests/test_delta_e.py (read 2026-10-14).

### 2b. culori (JS). **Confirmed**

- **Licence: MIT.** LICENSE: "MIT License" / "Copyright (c) 2018 Dan Burzo". package.json has `"license": "MIT"` and `"version": "4.0.2"`.
  Sources: https://github.com/Evercoder/culori/blob/main/LICENSE and https://github.com/Evercoder/culori/blob/main/package.json (read 2026-10-14). The npm page (npmjs.com/package/culori) timed out on its permission request.
- **Validates against the Sharma data: Confirmed.** Test `test('ciede2000 difference', …)` holds 34 rows, with the comment "// Test data from: http://www2.ece.rochester.edu/~gsharma/ciede2000/". It also checks symmetry ("// also test for symmetry"). The tolerance comes from rounding to 4 decimals: "let approx = round(4);".
  Source: https://github.com/Evercoder/culori/blob/main/test/difference.test.js (read 2026-10-14).

### 2c. color.js / colorjs.io (JS). **Confirmed**

- **Licence: MIT.** LICENSE: "MIT License" / "Copyright (c) 2021 Lea Verou, Chris Lilley". package.json has `"name"` "colorjs.io", `"version"` "0.7.1" and `"license"` "MIT".
  Sources: https://github.com/color-js/color.js/blob/main/LICENSE and https://github.com/color-js/color.js/blob/main/package.json (read 2026-10-14). The npm page timed out on its permission request.
- **Validates against the Sharma data: Confirmed, all 34 pairs and none skipped.** The tests are labelled "Sharma test 1" through "Sharma test 34". The file cites the paper ("The CIEDE2000 Color-Difference Formula: Implementation Notes,") and says it "Includes test data and five significant figures expected results from…". There are 7 extra cases (e.g. "Pythagorean 3,4,5 triangle" and the "Brilliant Yellow" cases). The tolerance is "check.proximity({ epsilon: 0.0001 })".
  Source: https://github.com/color-js/color.js/blob/main/test/delta.js (read 2026-10-14).

### 2d. chroma-js and the delta-e npm package. **Not found** (not verified)

The npm pages timed out on their permission requests, and I didn't open the repos. No verdict on their licence or on whether they test against the Sharma data. Two options above were enough for the brief.

---

## Recommendation: how LightBench should validate ΔE2000

1. **Primary data: the 34 pairs from Sharma et al. (2005), Table I.** Expected ΔE00 is given to 4 decimals, so assert `|actual − expected| ≤ 1e-4`, matching color.js. Cite the paper and DOI in the test file.
2. **Include all 34 pairs, including pair 14.** colour-science's note shows that the exact-180° hue-difference case flips between 4.7461 and 4.8045 depending on how `arctan2` rounds. A JS implementation using `Math.atan2` could hit the same problem. LightBench should apply the paper's ±180° rules exactly, and should probably compare `|Δh′|` against 180 with a tiny epsilon. That epsilon is a design choice, not something the paper specifies. Record the choice in the test.
3. **Add symmetry checks:** ΔE(a,b) = ΔE(b,a), as culori does. Add a few hue-rollover cases near 0°/360°.
4. **Reference oracle:** use **color.js `deltaE2000` (MIT)** as the in-browser cross-check. It tests all 34 Sharma pairs with no skips and labels each by the pitfall it covers. Use **culori (MIT)** as a second option. For offline or bulk random cross-checks (e.g. 10⁵ random Lab pairs), use **colour-science (BSD-3-Clause)**.
5. **Don't copy Sharma's MATLAB or Excel code.** It has no licence, only a "Personal or research use" permission. Use it at most as a local, non-distributed cross-check.
6. Default parametric factors k_L = k_C = k_H = 1. If a textiles mode is ever exposed, colour-science's `textiles=True` (k_L = 2) gives a reference value.

## Unresolved items

- **Terms for `ciede2000testdata.txt` itself:** the page states none. The only permission covers the "MATLAB program/Excel Spreadsheet", for personal or research use. The owner should decide whether to (a) re-key the values from the paper's Table I, (b) reuse them from the MIT or BSD test suites above, or (c) ask Gaurav Sharma (gsharma@ece.rochester.edu, listed on the page). This is not legal advice.
- **Data file not opened directly:** the permission request timed out. Its 34-row count is confirmed through the paper's Table I and, secondarily, through culori.
- **DOI not resolved on Wiley:** doi.org timed out on its permission request. The DOI comes from the article PDF and a secondary index.
- **Numeric value of colour-science's `TOLERANCE_ABSOLUTE_TESTS`:** not seen, because the docs page timed out on its permission request.
- **chroma-js and delta-e (npm):** not verified.
- **Exact wording of Eq. (10) and Eq. (14):** the PDF text layer garbles the equations. Read them from the typeset PDF before implementing.
