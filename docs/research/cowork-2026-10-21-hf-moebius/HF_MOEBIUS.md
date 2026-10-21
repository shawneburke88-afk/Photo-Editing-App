# HF_MOEBIUS.md — Research verification for LightBench AI Remove

**Prompt:** COWORK_HF_MOEBIUS_2026-10-21.md
**Sources read:** 2026-10-20, using Claude chat web fetch plus `git` against github.com. This was not a normal browser session, so item 2 could not be tested (see "Blocked sources").
**Conventions:** Verdicts are **Confirmed**, **Contradicted**, **Partly** or **Not found**. Quotes are short and verbatim, with at most one quote per source; everything else is paraphrased and cited by URL. Hashes, byte sizes and commit IDs are copied exactly from the source. Secondary sources are labelled **[SECONDARY]**. These are facts only, not legal advice.

---

## Decisions this changes

| # | Decision area | What the sources show | Suggested change / action for the owner |
|---|---|---|---|
| D1 | **Which commit to pin** | `unet.onnx` was replaced in commit `5db03f2…` (Conv3d swapped for Conv2d for Safari/Metal WebGPU). The current `main` is `5bf1ef5d2861ec01a727183a3f95dc64f352120e`, a README-only change made after that. | Pin `5bf1ef5d2861ec01a727183a3f95dc64f352120e`. **Do not** pin `9f6cfb3…` or earlier, because that `unet.onnx` is the Conv3d version. |
| D2 | **Integrity check** | Exact SHA-256 and byte sizes for all three files are available from the LFS pointers (item 3). | Verify each file's SHA-256 and byte length after download, before the first run. |
| D3 | **Download size shown at consent** | The three files total **1,241,534,740 bytes**. The model card and blog say 1.24 GB. The moebius-web README says ~1.27 GB. | Show "about 1.24 GB" (decimal GB) in the consent dialog. ~1.27 GB is not supported by the file sizes. |
| D4 | **Rate limits** | Anonymous resolver limit is **3,000 requests per 5-minute fixed window, per IP**. HTTP 429 is returned with `RateLimit` / `RateLimit-Policy` headers. HF notes anonymous limits may change. No bandwidth limit was found. | Three files per user is far below the limit. Handle 429 by reading the `RateLimit` header (`t=` seconds) and retrying after it. Do **not** embed an HF token in a public client. HF's docs recommend a token, but that advice is aimed at libraries and CLIs. |
| D5 | **HF terms for in-app downloads** | No clause found that explicitly permits or prohibits a third-party web app having users' browsers fetch public files via `/resolve/`. The rate-limit docs describe `/resolve/` URLs as the ones built by libraries and "AI applications" to download files. | Owner judgement. If certainty is needed, HF lists legal@huggingface.co as its contact. |
| D6 | **Licence discrepancy upstream** | The `hustvl/Moebius` **HF repo tag says MIT**. The `hustvl/Moebius` **GitHub LICENSE is Apache-2.0**, and an Aug 12, 2026 README commit states that both code and weights are Apache-2.0. `simonw/Moebius-ONNX` is tagged apache-2.0 and ships an Apache-2.0 LICENSE. | Record which source LightBench relies on. Owner to review attribution/licence-notice handling (not legal advice). |
| D7 | **Source checkpoint** | The model card does not say. The export scripts in `simonw/moebius-web` (including the script that produced the current `unet.onnx`) load **`ft_places2`**. | Record `ft_places2` as the checkpoint, with the source noted as "export script, not model card". |
| D8 | **Sampling strength for "Remove"** | **[SECONDARY]** Another ONNX export (Jannchie/moebius-inpaint-onnx) reports that the upstream default strength 0.99 can let the removed object leak back, and uses strength 1. simonw's notes use 20 steps with strength 0.99. | Worth testing strength 1.0 vs 0.99 on removal cases before fixing the default. |
| D9 | **Update-check baselines** | HF weights were uploaded Jun 18 (2026, see note). The last HF commit is README-only (Jun 22). The GitHub `main` last changed Aug 12, 2026 (README licence text only). No tags, releases or newer version were found. | Use the baselines in item 5. A README-only commit changes the HF `sha`, so compare file hashes or `lastModified` per file rather than only the repo `sha`, to avoid false "update available" prompts. |
| D10 | **Cache key** | **[SECONDARY]** The moebius-web source says HF redirects to a signed CDN URL with rotating `Expires`/`Signature` parameters, so the browser HTTP cache never hits. The demo stores files in Cache Storage keyed by the stable `/resolve/` URL. | Key LightBench's cache by pinned commit + filename (or SHA-256), never by the redirect URL. |

---

## Item 1 — Hugging Face terms for apps that download model files directly

**Verdict: Partly.** Rate limits are documented in detail. No explicit permission or prohibition for third-party apps was found.

**Rate limits** — https://huggingface.co/docs/hub/rate-limits (read 2026-10-20)
- Quote: "All quotas are calculated over 5-minute fixed windows."
- The page defines three buckets. **Resolvers** are all URLs containing `/resolve/` and have the highest limits. The page says these are used by open-source libraries and AI applications to download model files. The other buckets are **Hub APIs** and **Pages**.
- Tier table (as of September 2025, per the page). Anonymous user, per IP address: API **500**, Resolvers **3,000**, Pages **100**. Free user: 1,000 / 5,000 / 200. The page marks the anonymous and free values as subject to change with platform health.
- Exceeding a limit returns **HTTP 429**. HF implements the IETF draft `RateLimit` and `RateLimit-Policy` headers. The documented example format is `"api|pages|resolvers";r=[remaining];t=[seconds remaining until reset]`.
- The "if rate-limited" advice is: always pass `HF_TOKEN`, spread requests out, prefer Resolver calls over Hub API calls, or upgrade.
- **Bandwidth limits:** none stated on this page. **Per-day limits:** none stated; all limits are per 5-minute window.
- **Attribution, User-Agent or token requirements:** none stated as requirements for anonymous downloads on this page.

**Terms of Service** — https://huggingface.co/terms-of-service (effective Sept 15, 2022; read 2026-10-20)
- Quote: "Any Content you download, access or use from us or another User, is at your own risk"
- The ToS also says that a user who makes a repository public grants each User a perpetual, royalty-free licence to use, reproduce and distribute the Content through HF's Services. Content carrying an open-source licence remains under that licence, and references to it may not be removed.
- HF says it may modify, suspend or discontinue Services at any time, with or without notice.
- **Not found:** any clause that addresses third-party web apps triggering downloads from end users' browsers.

**Content Policy** — https://huggingface.co/content-policy (effective April 10, 2025; read 2026-10-20)
- Quote: "Abuse or interference with Hugging Face services, including:"
- The listed examples are unauthorized bot APIs or remote management tools, excessive data hosting, using tunnels/proxies/TOR to bypass restrictions, metric manipulation, cryptomining, and spam.
- **Not found:** anything addressing in-app downloads of public model files.

**Not checked:** HF Supplemental Terms (a PDF linked from the ToS) and the Privacy Policy.

---

## Item 2 — Browser downloads from Hugging Face (redirect, CORS, Range)

**Verdict: Not found (not tested).** No browser was available, so the console tests were not run.

**[SECONDARY]** evidence only:
- `web/src/modelcache.ts` in simonw/moebius-web (commit `080be6e`) has a code comment saying HF's `/resolve/main/<file>` URLs redirect to a signed CDN URL with rotating `Expires`/`Signature` query parameters. It also says a redirected fetch Response cannot be passed to `cache.put()` directly. The redirect target **hostname** is not stated.
- `.github/workflows/deploy.yml` in the same repo builds the GitHub Pages app with `VITE_MODEL_BASE: https://huggingface.co/simonw/Moebius-ONNX/resolve/main`. Its comment says weights are fetched cross-origin from HF.
- Simon Willison's blog (https://simonwillison.net/2026/Jun/22/porting-moebius/, read 2026-10-20) reports the deployed demo working in Chrome, Firefox and Safari. Taken together, this suggests a plain cross-origin GET of these files succeeds from github.io. It does **not** show the actual `Access-Control-Allow-Origin` value or redirect host.
- **Range requests / CORS preflight:** no evidence found either way.

**Action:** Run the two console tests from the prompt in a real browser. Also record the final response URL host (`r.url`) and the `access-control-allow-origin` and `accept-ranges` headers.

---

## Item 3 — `simonw/Moebius-ONNX`

**Verdict: Confirmed** for commit, files, sizes, hashes, licence, opset, precision, I/O and parity. **Partly** for the checkpoint, which comes from the export scripts, not the card.

**Sources (all read 2026-10-20):**
- Card: https://huggingface.co/simonw/Moebius-ONNX
- Files: https://huggingface.co/simonw/Moebius-ONNX/tree/main
- Commits: https://huggingface.co/simonw/Moebius-ONNX/commits/main
- LFS pointers: `…/raw/main/unet.onnx`, `…/raw/main/vae_encoder.onnx`, `…/raw/main/vae_decoder.onnx`
- Lab notes: https://huggingface.co/simonw/Moebius-ONNX/blob/main/notes.md

**Commit history (`main`):**

| Commit | Time shown (Jun 22) | Message |
|---|---|---|
| `5bf1ef5d2861ec01a727183a3f95dc64f352120e` | 22:25 | Upload README.md with huggingface_hub ← **current main** |
| `5db03f2b707343428068eb987fe55c477b533574` | 21:06 | Replace Conv3d pos_conv with equivalent Conv2d (Safari/Metal WebGPU compat) |
| `9f6cfb3e457fbd3898bca875ecff8783f6be38e3` | 20:40 | Add Moebius ONNX exports (unet + VAE enc/dec) + model card + lab notes |
| `82c258bdfd06e7615083535cf095d146f9df61be` | 20:33 | initial commit |

**Files** (sizes and SHA-256 from the LFS pointers at `main` = `5bf1ef5…`):

| File | Exact size (bytes) | SHA-256 | Last changed in |
|---|---|---|---|
| `unet.onnx` | 906,698,976 | `e3f90f52f72378339b990459fadb29a68d3c7b5c6851545ba42774f489160b08` | `5db03f2` |
| `vae_encoder.onnx` | 136,757,093 | `b8b81d41e757222a0707665ba9d826703987855e5bed056036b90b988968042f` | `9f6cfb3` |
| `vae_decoder.onnx` | 198,078,671 | `d90ef0b7f6c8c8b7234459c8b449d70be0033bf1576c842e8b9991baf3934280` | `9f6cfb3` |
| **Total** | **1,241,534,740** | | |

Other files: `.gitattributes` (1.52 kB), `LICENSE` (11.2 kB), `README.md` (3.75 kB) and `notes.md` (8.19 kB). These sizes are as displayed; exact bytes were not retrieved.

**Licence:**
- Repo tag: **apache-2.0**.
- LICENSE file first lines: "Apache License / Version 2.0, January 2004 / http://www.apache.org/licenses/".
- The appendix boilerplate at the end of the file names "Copyright 2024 Moebius Authors".
- The card's licence section says the files are Apache 2.0, inherited from `hustvl/Moebius`, and are a format conversion (PyTorch → ONNX) of the original weights.

**Source checkpoint:** **Partly.**
- The card does not name a checkpoint.
- `notes.md` says all four checkpoints were downloaded (`pretrained`, `ft_celebahq`, `ft_ffhq`, `ft_places2`) but does not say which was exported.
- The scripts in `simonw/moebius-web` at commit `080be6e` default to or hardcode **`ft_places2/diffusion_pytorch_model.bin`**. This applies to `python/export_onnx.py` (`--weight` default), `python/onnx_pipeline.py` and `python/reexport_unet_no_conv3d.py` (hardcoded `WEIGHTS`). The last of these produced the current `unet.onnx`.

**Opset:** **18**.
- Quote from `notes.md`: "torch.onnx.export (legacy tracer, opset 18) traced all 3 graphs cleanly."
- Also `--opset` default 18 in `export_onnx.py`, and `opset_version=18` in the re-export script.

**Precision:** fp32. The card says these are fp32 exports for numeric parity. It says fp16 halves download size but may reduce quality in the lambda layers and is numerically unstable for this VAE.

**Inputs/outputs** (names from the export scripts; shapes from the card; static 512×512 / 64×64 latent, batch dynamic):

| Graph | Inputs | Output |
|---|---|---|
| `unet.onnx` | `latent` (B,9,64,64) float32; `timesteps` (B,) int64; `input_ids` (B,10) int64 | `noise` (B,4,64,64) |
| `vae_encoder.onnx` | `image` (B,3,512,512) | `moments` (B,8,64,64) |
| `vae_decoder.onnx` | `latent` (B,4,64,64) | `image` (B,3,512,512) |

Pipeline constants from the card:
- VAE scaling factor 0.13025.
- 9-channel UNet input is noisy latent (4) + mask (1) + masked-image latent (4).
- DDIM, beta 0.00085→0.012 scaled_linear, 1000 train steps; 20 steps at strength ≈0.99 gives 19 actual steps.
- CFG `input_ids` rows 0–9 are conditional and 10–19 unconditional.
- VAE encoder source is `hustvl/PixelHacker` `vae/`.

**Parity numbers (card, CPU execution provider):**
- Decoder max|Δ| ≈ 5.7e-5.
- UNet ≈ 3.6e-6.
- Full pipeline vs PyTorch with identical noise: decoded-image mean|Δ| ≈ 0.0022.
- `notes.md` adds encoder mean-channel ~2e-2 and decoded-image max 0.090.
- **Caveat:** These figures were committed in `9f6cfb3`, before the Conv2d re-export in `5db03f2`. The re-export script asserts torch self-parity below 1e-4 and prints ONNX-vs-torch error. **No published parity figure was found for the current `unet.onnx`.**

---

## Item 4 — `simonw/moebius-web` (GitHub)

**Verdict: Contradicted** for "is there now a LICENSE file?": there is none. **Confirmed** for the README licence sentence. **Not found** for WebGPU speed on a named GPU.

**Sources:** `git ls-remote` / blobless clone of https://github.com/simonw/moebius-web.git at `main` = `080be6e737ec976130e260d34707d7d9b7f63d5b` (2026-06-22, "Added a Claude explanation of this repo"); read 2026-10-20.

- **LICENSE file:** none at `main`. The root entries are `.github`, `.gitignore`, `README.md`, `models`, `notes.md`, `plan.md`, `python`, `research.md`, `understanding.md` and `web`. `raw.githubusercontent.com/simonw/moebius-web/main/LICENSE`, `LICENSE.md` and `LICENSE.txt` each returned HTTP 404.
- **README licence sentence** (quote): "Apache 2.0, inherited from the upstream [hustvl/Moebius]". The README also says the model is by Duan, Xu, et al. and that the repo is a browser port and ONNX conversion.
- **WebGPU speed:** no timing on a named GPU found in the README, `notes.md`, `understanding.md` or Simon Willison's blog post. The only figure found is a CPU baseline in `notes.md`: ~8.9 s/step on CPU (macOS, Apple Silicon), about 2:48 total.
- **Other:**
  - The README states a WebGPU-capable browser (recent Chrome or Safari) is required.
  - Non-square inputs are letterboxed.
  - First run downloads "~1.27 GB", which conflicts with the 1,241,534,740-byte total (D3).
  - No GitHub releases ([SECONDARY] search snippet of the Releases page).

---

## Item 5 — `hustvl/Moebius` on Hugging Face and GitHub (update-check baseline)

**Verdict: Confirmed** for commits and dates. **Not found** for any newer Moebius release or version.

**Hugging Face** — https://huggingface.co/hustvl/Moebius/commits/main (read 2026-10-20)

| Commit | Date shown | Message |
|---|---|---|
| `cd01f47fb648219d3fa605806c5ce00b713faa5e` | Jun 22, 14:34 | Update README.md ← **current main** |
| `d814af3a3fd240da38893543b80dc864f6782d61` | Jun 22, 14:32 | Update README.md |
| `dd8a859121322f0f7e89a340fc26895db1c8d678` | Jun 22, 14:32 | Update README.md |
| `0fc199d0b8f75f7ac6752fe947b0c72d90c3285f` | Jun 18, 16:05 | Upload folder using huggingface_hub ← **last change to weights** (only upload commit shown) |
| `4852433752be5eb4cfc8d9d87e1ba894ec14658f` | Jun 18, 14:46 | initial commit |

- The commit page does not print the year. 2026 is inferred from the GitHub README News entry dated June 18, 2026, which announces the weight release.
- Weight folders: `ft_celebahq`, `ft_ffhq`, `ft_places2`, `pretrained`. Total repo size shown: 3.62 GB.
- Licence tag on the HF repo: **mit** (see D6).

**GitHub** — https://github.com/hustvl/Moebius (via `git ls-remote` and blobless clone; read 2026-10-20)
- `main` = `b88d462bacb9af6e7128a3b4cc4a07418bedfd61`, 2026-08-12T11:16:32+08:00, "Add explicit license statement covering code and pretrained weights". This commit added 3 lines to README.md only.
- Other branch: `gh-pages` = `8b97cb42565d5c7105364dbd20a3e36904439b2b` (project page).
- Tags: none.
- README licence section (quote): "Commercial use of the weights and the images produced with them is permitted." The same paragraph states that code and pretrained weights are under Apache License 2.0.
- LICENSE file: Apache License, Version 2.0.
- **Newer release/version:** none found. The README News section's latest entry is June 25, 2026 (HF weekly ranking). There are no tags, and no HF commits after Jun 22.

---

## Item 6 — Hugging Face API for update checks

**Verdict: Partly.** The endpoint is documented. The token requirement and CORS for browser use were not verified.

- https://huggingface.co/docs/hub/api (read 2026-10-20):
  - The page now says the endpoint reference has moved to the OpenAPI Playground (https://huggingface.co/spaces/huggingface/openapi). The spec is at `https://huggingface.co/.well-known/openapi.json`.
  - Quote: "All API calls are subject to the HF-wide Rate limits."
  - Anonymous API limit: **500 per 5 min per IP** (item 1).
- **[SECONDARY]** A search-index snapshot of the same docs page (older version) lists `GET /api/models/{repo_id} or /api/models/{repo_id}/revision/{revision}` as the equivalent of `huggingface_hub.model_info(repo_id, revision)`.
- **[SECONDARY]** The `hf-fetch-model` Rust crate source (docs.rs) reads the commit `sha` from `GET https://huggingface.co/api/models/{repo_id}`. With `?blobs=true` it also gets per-file sizes and SHA-256.
- `lastModified` in the response: not confirmed from a primary source in this session. It appears as a sort key in older `huggingface_hub` docs **[SECONDARY]**.
- **Token required?** Not confirmed. The OpenAPI spec and a live call were not retrieved.
- **CORS for browser use?** Not confirmed (no browser).

**Action:** In a browser console, run `fetch('https://huggingface.co/api/models/simonw/Moebius-ONNX/revision/main?blobs=true').then(r=>r.json())` from an https page. Confirm `sha`, `lastModified` and `siblings[].lfs.sha256`, and that no CORS error occurs.

---

## Blocked sources / not done

| Source | Why | Effect |
|---|---|---|
| Browser console tests (item 2) | No browser in this environment | Redirect host, `Access-Control-Allow-Origin`, Range/preflight all untested |
| `https://huggingface.co/api/models/…` live responses (item 6) | Web fetch only opens URLs that appear in prior results; bash network cannot reach huggingface.co | Endpoint fields, token need and CORS not confirmed |
| `https://huggingface.co/.well-known/openapi.json` / `openapi.md` | Same fetch restriction | Current primary API reference not read |
| GitHub REST API (`api.github.com`) | Anonymous rate limit exceeded (HTTP 403) | Used `git ls-remote` and blobless clones instead; no loss for items 4–5 |
| HF Supplemental Terms PDF, Privacy Policy | Not fetched | Item 1 terms review is limited to ToS, Content Policy and rate-limit docs |
| Exact byte sizes of small files (LICENSE, README.md, notes.md) | Only displayed rounded sizes retrieved | Not needed unless those files are also pinned |
