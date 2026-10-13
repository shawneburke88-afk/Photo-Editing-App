# Snapshots, soft proofing and tool search: design brief

**Prepared for:** Shawn Burke (LightBench) · **Research date:** 2026-10-13 · **Status:** research only, nothing built.
**Reads with:** docs/PLAN.md (Phase 3: "snapshots, soft proofing"; "Tool search comes at the end of this phase"),
docs/USABILITY.md (round 2 lesson 12: "Snapshots, before/after and virtual copies are basics"; the tool-search
decision: "`/` or Ctrl+F finds a tool by its Lightroom name, LightBench name or darktable name"; lesson R2 6: "keep a
rename map for search"), docs/PHASE2.md (Part 6 virtual copies, Part 7 copy/paste, Part 8 presets, Part 12 keyboard
and command search), docs/PHASE3.md (Part 1 process versions, Part 4 Display P3, Part 8 output sharpening).

## How this was researched (read first)

- **Read in full [read]:** darktable `6271f53` (5.8.0): `src/libs/snapshots.c`, `src/common/history_snapshot.h`,
  `src/iop/colorout.c` (soft proof and gamut check), `src/libs/modulegroups.c` (module search), module `aliases()` in
  `src/iop/*.c`. dtdocs `master`: `snapshots.md`, `soft-proof.md`, `gamut.md`, `history-stack.md`,
  `darkroom-view-layout.md`. RawTherapee `dev`: `rtengine/improcfun.cc` (`updateColorProfiles`), `rtengine/settings.h`,
  `rtengine/iccstore.cc`, `rtgui/editorpanel.cc`. LightCraft `701f78e` (MIT/Apache-2.0): `crates/codecs/src/proof.rs`,
  `crates/codecs/src/display.rs`, `crates/pipeline/src/output.rs`, `docs/parity-checklist.md`. Little CMS `LICENSE`;
  `mattdesl/lcms-wasm` (`LICENSE.md`, `README.md`, `build.sh`, `package.json`); `awxkee/moxcms` (`Cargo.toml`,
  `LICENSE.md`); npm registry entries. Web specs from GitHub: WHATWG HTML (`PredefinedColorSpace`), WebGPU
  (`gpuweb/gpuweb` `spec/index.bs`), Media Queries 4 (`color-gamut`), CSS Color 4/5; MDN browser-compat-data `main`.
  LightBench `a0f8353`: `web/src/settings/CommandSearch.tsx`, `shortcuts.ts`, `actions.ts`, `develop/history.ts`,
  `develop/help.ts`, `develop/Slider.tsx`, `develop/ToolStack.tsx`, `develop/DevelopView.tsx`, `engine/color/icc.ts`,
  `engine/gpu/develop-engine.ts`, `catalog/catalog.worker.ts`, `sidecar/xmp.ts`.
- **Could not read:** helpx.adobe.com, jkost.com, lightroomkillertips.com, docs.darktable.org, MDN pages, w3.org,
  color.org and other non-GitHub sites.
- Tags: **[search]** (search-tool summary of a page not opened), **[unconfirmed]** (memory or one secondary source),
  **[LightBench idea]**. Nothing here is legal advice.

---

## Summary

- **Snapshots.** Lightroom's are named, saved edit states per photo, made with **Ctrl/Cmd+N** or **+**, with Rename,
  **Update with Current Settings**, hover preview in the Navigator and **Copy Snapshot Settings to Before** [search].
  They are written to the XMP (or into a DNG), unlike virtual copies [search]; the XMP field name is
  **[unconfirmed]** (ExifTool 3.79 lists none). darktable's are **session-only** (at most 10), store a rendered view
  plus a history position, and show as a split or side-by-side comparison; one can be restored to the history [read].
  **Recommended v1:** Lightroom-style named snapshots, saved in the catalog **and** the sidecar
  (`lightbench:Snapshots`, as `lightbench:Versions` is), each a full copy of the develop settings (process version
  included). Clicking applies one as a history step; hover previews; "Set as Before" makes Before/after compare
  against it. No process version needed.
- **Soft proofing.** Lightroom: a proof mode with a destination profile, Perceptual or Relative intent, **Simulate Paper
  & Ink**, monitor (blue) and destination (red) gamut warnings, and **Create Proof Copy** [search]. darktable: soft proof
  (Ctrl+S) and gamut check (Ctrl+G, cyan) through Little CMS's proofing transform, with black-point compensation always
  on and the GPU path turned off [read]. **In the browser**, LightBench cannot read the monitor's ICC profile; it only
  learns `color-gamut` (srgb / p3 / rec2020) and picks a canvas space (`srgb`, `display-p3` and their linear forms).
  Printer profiles are LUT-based, which LightBench's ICC reader can't handle. **lcms-wasm** (npm `lcms-wasm` 1.0.5,
  MIT, compiles only Little CMS's MIT core) can; there is **no npm package named `lcms2-wasm`** (404). **Recommended
  v1:** proof against sRGB / Display P3 / Adobe RGB and user-loaded printer ICC profiles by baking a 3D LUT with
  lcms-wasm in a worker and sampling it in the display shader; destination gamut warning; Simulate Paper & Ink;
  Create Proof Copy as a virtual copy.
- **Tool search.** LightBench already has **command search** (Ctrl+Shift+P): it finds keyboard *actions* only, by
  label, context name and key text, with every query word as a substring. It has no sliders, no Lightroom or darktable
  names, no synonyms, no ranking and no typo tolerance, and the owner's `/` / Ctrl+F keys aren't bound. darktable's
  module search matches the module name, its **aliases** and the instance name, case-folded substring [read]. **What to
  add:** a registry of every develop control (LightBench name, Lightroom name, `crs:` field, darktable module and
  aliases, synonyms, group/section), results that **reveal and focus** the control so arrow keys adjust it at once,
  ranking with a one-typo allowance, planned-but-unbuilt tools listed as "planned", and a rename map.

---

# Part A — Snapshots

## How Lightroom does it

- **Panel:** Snapshots in the Develop module's left panel, above History [search].
- **Create:** **Ctrl+N** (Cmd+N) in Develop, or **+** in the panel header, which asks for a name [search]
  ([jkost](https://jkost.com/blog/2019/09/working-with-snapshots-in-lightroom-classic.html),
  [Photofocus](https://photofocus.com/photography/understanding-the-snapshots-and-history-panels-in-lightroom/)).
  The default name is the date and time [unconfirmed]. Right-click a History step → "Create Snapshot" [unconfirmed].
- **Use:** click a snapshot to apply its settings (the history records it [unconfirmed]); hover a snapshot or a
  history step to preview it in the Navigator [search].
- **Context menu:** Rename; **Update with Current Settings**; Delete; **Copy Snapshot Settings to Before** (snapshots
  can't be dragged to Before as history steps can) [search].
- **Virtual copies:** "A snapshot you save shows up in all virtual copies of that photo" [search]; snapshots made on a
  virtual copy appear in the original's list [search].
- **Storage:** snapshots are saved in the XMP sidecar, or inside a DNG, when XMP writing is on [search]; virtual copies
  live only in the catalog [search]. The XMP structure was **not** found: ExifTool `XMP.pm` 3.79 has no snapshot field
  (grep, read). A search summary's "`crs:Snapshots`" came from the model's own memory and is **[unconfirmed]**.
- **Camera Raw** reads Lightroom's snapshots and vice versa (Adobe help, per search summary) [search].
- No batch delete of snapshots (a user complaint) [search].

## How darktable does it

- **Module:** `snapshots` utility module in the darkroom (`src/libs/snapshots.c`) [read].
- **Limit:** `MAX_SNAPSHOT 10` (line 37). Each holds the image id, the history end (`history_end`), the module name and
  a label, and a cached rendered buffer at the current zoom (`dt_lib_snapshot_t`, lines 43–63). History is copied into
  the in-memory database area (`SNAPSHOT_ID_OFFSET 0xFFFFFF00`, "an area not used by the undo/redo support",
  lines 39–41).
- **Manual** [read, `snapshots.md`]: "Snapshots are retained for the duration of your darktable session." Default
  name = the history step's module and position; Ctrl+click to label it. Click to show it as a **split view** (drag the
  line; a rotate icon switches vertical/horizontal), or **side-by-side**; an "S" marks the snapshot side. A **restore**
  button "will replace the history stack of the current image with the stack taken from that snapshot". A snapshot
  can be compared with *another* image.
- **Persistent alternatives:** duplicates (virtual copies, own sidecar per duplicate) and the history stack (compress,
  "create style from history") [read, `history-stack.md`].

## Others

- **LightCraft** [read, parity row LRC-DEV-SNAPSHOTS]: "Named snapshots … = versions": its snapshots *are* its
  versions (virtual copies). Its History row menu has "create version from step".
- **RawTherapee / ART:** "Snapshots" list in the History panel, saved in the `.pp3` sidecar [unconfirmed; not read].
- **Capture One:** no snapshot concept; uses variants [unconfirmed].

## What LightBench has today

- History: `develop/history.ts`: up to 200 steps, merged within 1.5 s, saved in the catalog (`edits.history`,
  `catalog.worker.ts` line 138). The sidecar holds only the current settings (`lightbench:Develop`) and the virtual
  copies (`lightbench:Versions`) (`sidecar/xmp.ts` lines 339–351).
- Before/after (`\`) shows the defaults for the photo's kind (`DevelopView.tsx` line 401), full frame only.
- Hover preview of a preset with a "Preview" badge already exists (PHASE2 Part 8).

## Recommended v1

| Item | Recommendation |
|---|---|
| Panel | **Snapshots** in Develop's left panel, between Presets and History (Lightroom's order). |
| Create | **+** button (asks for a name; default "date time" or the current history step's label) and a key. **Ctrl+N can't be used in a browser tab**: Chrome keeps it for a new window, as LightBench already notes for Ctrl+W and Ctrl+T (PHASE2 Part 12) [Ctrl+N unconfirmed]. Proposal: **Ctrl+Alt+N** in both sets, owner's choice (Q A1). History row context menu: "Create snapshot from this step". |
| Apply | Click: one history step "Snapshot: name". Undoable. |
| Hover | Preview on the main view with the "Preview" badge (reuse the preset hover path). |
| Context menu | Rename · Update with current settings · Delete · **Set as Before** · Make a virtual copy from it. |
| Before/after | `\` compares against the snapshot chosen by "Set as Before" (else the defaults, as now). A split view is a later step (darktable's split line, Lightroom's side-by-side) [LightBench idea]. |
| What is stored | The full `DevelopSettings` (including `process`, so an old snapshot renders exactly as when taken), name, created time. |
| Where | Catalog (a `snapshots` JSON column on `edits`, or a table) **and** the photo's sidecar as `lightbench:Snapshots` (JSON, like `lightbench:Versions`), so a library rebuilt from the folders gets them back (R2 2, "sidecar-first"). For a virtual copy, inside its entry in `lightbench:Versions`. |
| Per version or shared | Per version (each virtual copy its own list) [LightBench choice; Lightroom shares them, Q A2]. |
| Size | Settings are small, but Remove spots and future masks (AI rasters) can be large. Store spots/masks once per distinct value (by hash) or warn above a size [LightBench idea, Q A4]. |
| Copy/Paste, presets | Snapshots never travel with Copy, Sync or presets. |
| Change detection | `lightbench:Snapshots` changed by another LightBench raises the existing "changed by another app" notice; Read changes merges by name and time [LightBench idea]. |
| Lightroom | Not read or written in v1 (field unknown). |
| Process version | None: nothing renders differently. |

## Alternatives

1. **Snapshots = virtual copies** (LightCraft): no new concept; but copies show in the grid and carry their own rating,
   which is not what a snapshot is for.
2. **Session-only** (darktable): simplest; loses work on reload, which USABILITY's data-safety lesson argues against.
3. **Catalog only:** simpler sidecar; lost if the library is rebuilt from folders.

## Open questions for the owner (snapshots)

- **A1.** Shortcut for "New snapshot": Ctrl+Alt+N, another key, or none (button only)? Ctrl+N is browser-reserved.
- **A2.** Snapshots per virtual copy (LightBench default) or shared between a photo and its copies (Lightroom)?
- **A3.** In the sidecar as well as the catalog (recommended), or catalog only?
- **A4.** Limit the number or size of snapshots per photo?
- **A5.** Does applying an old snapshot also bring back its process version (recommended: yes, it is part of the
  settings; the "Update to current process" offer then reappears)?
- **A6.** Split-view comparison in v1, or later?

---

# Part B — Soft proofing

## How Lightroom does it

- **Mode:** a **Soft Proofing** checkbox in the Develop toolbar (key **S** [unconfirmed]); the background turns paper
  white and "Proof Preview" is shown [unconfirmed]; LightCraft copies both (parity row LRC-DEV-SOFTPROOF, read).
- **Settings** [search] ([tourboxtech](https://www.tourboxtech.com/en/news/what-is-soft-proofing-in-lightroom.html),
  [lenscraft](https://lenscraft.co.uk/photo-editing-tutorials/what-is-soft-proofing-in-lightroom/),
  [Red River](https://www.redrivercatalog.com/infocenter/soft-proofing-explained.html)): a destination **Profile**
  (sRGB, Adobe RGB, ProPhoto, Display P3 and installed printer profiles [unconfirmed list]); **Intent** Perceptual or
  Relative ("Relative preserves more of the original colors"); **Simulate Paper & Ink** ("the true white tone of the
  paper … black density drawn from the profile's black point tag").
- **Gamut warnings** [search]: **monitor** gamut warning (blue: colours the display can't show) and **destination**
  gamut warning (red; both = a combined colour), toggled from icons at the histogram's corners.
- **Create Proof Copy:** editing while proofing offers a virtual copy for that output [search].
- An old forum report: the gamut warning was wrong with GPU acceleration on (2018) [search].

## How darktable does it

- **UI** [read, `soft-proof.md`, `gamut.md`]: a soft proof toggle (**Ctrl+S**) and a gamut check toggle (**Ctrl+G**),
  mutually exclusive, with a right-click dialog: display profile and intent, preview display profile, **softproof
  profile** (from `color/out` folders the user creates), histogram profile. Gamut check marks out-of-gamut pixels **cyan**.
- **Engine** [read, `colorout.c`]:
  - `cmsCreateProofingTransform(Lab → output, softproof profile, out_intent, INTENT_RELATIVE_COLORIMETRIC, flags)`
    (lines 737–758); flags `cmsFLAGS_SOFTPROOFING | cmsFLAGS_NOCACHE | cmsFLAGS_BLACKPOINTCOMPENSATION`, plus
    `cmsFLAGS_GAMUTCHECK` in gamut-check mode (lines 704–707). A source comment: "the use of bpc should be
    userconfigurable".
  - Gamut check: after the transform, pixels with any negative channel become cyan (lines 494–518).
  - Built-in profiles with parametric curves are first made "temporary" (quantised) because a round trip through an
    ideal profile "has no effect" (lines 694–700).
  - Soft proofing disables the OpenCL path (`process_cl_ready = FALSE`, line 736).
- The clipping indicator's "full gamut" mode is a related check (LightBench already has it, `develop-display.wgsl`).

## Others

- **RawTherapee** [read, `improcfun.cc` 300–445, `settings.h` 40–42]: Soft-proof and Gamut-check buttons in the editor
  (`editorpanel.cc` 378–379). The printer profile, intent and black-point compensation are preferences
  (`printerProfile`, `printerIntent`, `printerBPC`). Little CMS proofing with `cmsFLAGS_SOFTPROOFING`; gamut alarm
  colour bright green (`iccstore.cc` line 481).
- **LightCraft** (MIT/Apache-2.0) [read, `proof.rs`, `output.rs`, parity row]:
  - A **33³ table** over working-space RGB (sRGB-curve encoded), each entry the simulated linear Rec.2020 colour plus a
    gamut distance; built with **moxcms** from the printer profile (RGB or CMYK, matrix or LUT).
  - Forward with the chosen intent (Perceptual or Relative), back with Relative. **Simulate Paper & Ink** = absolute
    colorimetric on the way back: the paper's media white replaces the screen white (a per-channel scale), and the
    ink black is the darkest the tables give, **no black-point compensation**.
  - Gamut: "colours whose round trip moved them more than ~0.02 are outside" (`PROOF_GAMUT_TOLERANCE`).
  - Destination (red) and display (blue) warnings, paper-white surround, "Proof Preview", **Create Proof Copy** (a named
    virtual copy). The display gamut is the monitor profile's, chosen by hand or, on macOS, read from the screen.

## Browser constraints

- **No monitor profile.** No web API exposes the display's ICC profile [unconfirmed: none found in the specs read].
  Media Queries 4's `color-gamut` reports only "the approximate range of colors": `srgb | p3 | rec2020` [read]. The
  browser colour-manages page and canvas content to the screen itself [unconfirmed]. So:
  - a **monitor gamut warning** can only test against the canvas space LightBench chose (sRGB or Display P3, Part 4),
    not the real monitor;
  - LightBench must **not** apply a monitor profile itself (the browser already does; it would correct twice).
- **Canvas colour spaces** [read, WHATWG HTML `PredefinedColorSpace`]: `srgb`, `srgb-linear`, `display-p3`,
  `display-p3-linear`. WebGPU accepts the same set for its canvas (`gpuweb` spec, "WebGPU allows all of the color
  spaces in the PredefinedColorSpace enum") and a `toneMapping` mode `standard | extended` [read]. MDN's compat data
  lists `toneMapping` for Chrome and not Firefox or Safari [read]. LightBench already uses `display-p3` on P3 screens
  (`develop-engine.ts` lines 305–316; Part 4).
- **CSS colour spaces** (for UI swatches, not proofing): `color()`, `lab()`, `oklab()` in Chrome 111, Firefox 113,
  Safari 15 (MDN compat data) [read]. CSS Color 5's `@color-profile` (ICC profiles in CSS) is marked "At Risk" in the
  draft, and MDN's compat data has no entry for it (404) [read].
- **ICC parsing today:** `engine/color/icc.ts` reads only matrix/TRC profiles ("LUT-based ICC profiles … are not
  supported yet and fall back to sRGB", lines 1–6) [read]. Printer profiles are LUT-based (and often CMYK), so a CMM is
  needed.

### ICC libraries for the browser

| Library | Licence | What it is | Notes |
|---|---|---|---|
| **lcms-wasm** (npm `lcms-wasm` 1.0.5, 2025-01-08; github.com/mattdesl/lcms-wasm) | **MIT** (wrapper); Little CMS itself **MIT** ("Copyright (c) 2023 Marti Maria Saguer") | Little CMS compiled with Emscripten; "the specific goal of parsing, loading, and transforming between color spaces defined by ICC color profiles"; works in web workers | `build.sh` compiles only `Little-CMS/src/*.c` (the core). Low-level API close to Little CMS (`cmsOpenProfileFromMem`, transforms). [read] |
| `lcms2-wasm` | — | **does not exist on npm** (registry 404) [read] | The name in the task brief; use `lcms-wasm`. |
| moxcms (crates.io; github.com/awxkee/moxcms 0.9.1) | **BSD-3-Clause OR Apache-2.0** [read] | A Rust CMS, used by LightCraft for proofing and display profiles | Needs LightBench's own WASM build. |
| jsColorEngine (npm `jscolorengine` 1.6.2) | **MPL-2.0** [read, npm] | "Fast ICC colour engine for JavaScript. WASM-SIMD LUT kernels" | MPL-2.0 is GPL-compatible unless marked otherwise [unconfirmed general rule]. A GPL-3.0 variant `jscolorengine2` also exists. |
| `icc` (npm 4.0.0, lovell/icc) | Apache-2.0 [read, npm] | "Parse International Color Consortium (ICC) profiles" | Parser only. |

## Recommended v1

| Item | Recommendation |
|---|---|
| Mode | **Soft proofing** toggle in Develop's toolbar and a key (Lightroom's S [unconfirmed]; S is free in Develop today, `actions.ts`). Paper-white surround and a "Proof preview: <profile>" badge. Before/after keeps working. |
| Profiles | sRGB, Display P3, Adobe RGB (already in `OUTPUT_SPACES`, exact matrix maths, no CMM needed), plus **user-loaded ICC profiles** (printer/paper), kept in the catalog by hash, the last few remembered. |
| Engine | A worker loads lcms-wasm (lazy, only when a loaded profile is used) and bakes a **3D LUT** (33³ like LightCraft, or 65³) mapping the pipeline's display-referred Rec.2020 output (encoded) to the proofed colour in the canvas space, plus a gamut flag (Little CMS gamut check or LightCraft's round-trip distance). Uploaded as a 3D texture and sampled in the display shader after the Tone Curve, before the display encoding. Rebuilt only when the profile, intent or paper/ink option changes. |
| Options | Intent: Perceptual / Relative colorimetric (default Relative [LightBench choice; Q B3]). **Simulate Paper & Ink** (absolute colorimetric back, no black-point compensation, as LightCraft). Black-point compensation for Relative on by default (darktable always uses it). |
| Warnings | **Destination gamut warning** (red, as Lightroom), via the clipping overlay path (J). **Screen gamut warning** (blue) against the canvas space (sRGB or Display P3), labelled as such, since the real monitor is unknown. |
| Histogram | Shows the proofed result while proofing (Lightroom does [unconfirmed]). |
| Proof copy | **Create proof copy** = a virtual copy (Phase 2) named "Proof: <profile>". Editing while proofing offers it once [search: Lightroom does]. |
| Export link | Export can use the proof's profile and intent; for LUT profiles that needs lcms-wasm on export too (Q B4). |
| Stored | Proof settings per browser (localStorage), not in edits or sidecars. Loaded ICC files in the catalog. |
| Process version | None: a view mode only. |

## Alternatives

1. **Matrix profiles only** (sRGB / P3 / Adobe RGB / ProPhoto / Rec.2020, as LightCraft's built-in list): no CMM, no
   printer profiles. A useful first step.
2. **moxcms built to WASM** (LightCraft's choice): permissive and modern, but a Rust build for LightBench to own.
3. **Per-pixel CMM transform** (darktable's way, on the CPU): too slow for interactive WebGPU previews; the LUT is the
   usual answer.

## Open questions for the owner (soft proofing)

- **B1.** Printer ICC profiles in v1 (lcms-wasm, about a few hundred KB of WASM [unconfirmed size]) or matrix profiles
  only first?
- **B2.** Use lcms-wasm (MIT, maintained by one person, last release January 2025) or build moxcms?
- **B3.** Default intent Relative or Perceptual? Black-point compensation on for Relative?
- **B4.** Export with a printer profile (convert on export) in the same step, or later?
- **B5.** Proof key: S (Lightroom), or something else?

---

# Part C — Tool search

## What LightBench has today

- **Command search** (`settings/CommandSearch.tsx`, `shortcuts.ts`) [read]:
  - Opens with **Ctrl+Shift+P** ("Find an action by name", `actions.ts`).
  - Lists `availableActions()`: the actions of the views listening now plus "Everywhere".
  - `matches()`: every query word must be a substring of `label + context names + key text`, lower-cased.
  - Results in registry order; ↑ ↓ to choose; Enter runs; Esc closes; each row shows its keys (it teaches shortcuts).
  - ARIA: combobox + listbox with `aria-activedescendant`.
- **What it can't find:** develop **controls** (sliders, menus, toggles) are not actions; they have no registry. Their
  only shared data is `HELP` in `develop/help.ts` (hint, what, left, right, pitfalls, **engine**: e.g. "darktable tone
  equalizer (upper bands)"). `Slider.tsx` ids are React `useId()`s, so nothing can address a slider by name.
- **Reveal machinery exists:** `ToolStack` takes `reveal: { id: GroupId, n }` and scrolls to and opens a group
  (`DevelopView.tsx` lines 610, 732, 900, 967).
- **Not bound:** `/` and Ctrl+F (the owner's decision in USABILITY.md). `/` is free; `?` and Ctrl+/ open the shortcut
  list.

## How others do it

- **darktable** [read, `modulegroups.c` lines 943–951]: a "search module" box above the module list (manual,
  `darkroom-view-layout.md`). A module matches when the case-folded query is a substring of its localised **name**, its
  localised **aliases**, or its **instance name**. Examples of aliases: sigmoid "tone mapping|view transform|display
  transform"; tone equalizer "tone curve|tone mapping|relight|background light|shadows highlights"; color balance rgb
  "offset power slope|cdl|color grading|contrast|chroma_highlights|hue|vibrance|saturation"; color equalizer "color
  zones|hsl"; haze removal "dehaze|defog|smoke|smog"; local contrast (bilat) "clarity"; lens "vignette|chromatic
  aberrations|distortion"; ashift "rotation|keystone|distortion|crop|reframe" [read, `aliases()` in each `src/iop` file].
  Deprecated modules are hidden unless enabled. It finds modules, not individual sliders.
- **Lightroom:** no search for Develop tools was found [search]. Photoshop's "Discover" panel searches tools and help
  [unconfirmed].
- **LightCraft:** a command registry with a menu tree and searchable shortcuts; no slider search was found in the files
  read [read, parity checklist].
- **Command palettes generally:** VS Code's Ctrl+Shift+P is the model LightBench already follows [general knowledge].

## Recommended v1 (what to add)

| Item | Recommendation |
|---|---|
| A control registry | `develop/controls.ts`: one entry per control with `id`, LightBench **label**, **group** and section (e.g. Basic › Tone), **Lightroom name(s)**, `crs:` field(s), **darktable module** (reuse `help.ts`'s `engine`) and darktable's **aliases**, **synonyms** ("WB", "kelvin", "noise", "NR", "sharpen", "matte", "fade", "split toning"), whether it sits under Advanced ▸, and a `reveal()` target. Sliders register by this `id` instead of a generated one. |
| One search, two entry points | **`/`** in Develop opens the search scoped to tools (owner's spec). **Ctrl+Shift+P** keeps showing everything (actions and tools). **Ctrl+F**: owner's choice (Q C1), since it hides the browser's find. |
| Results | "Exposure — Basic › Tone · Lightroom: Exposure · darktable: exposure", the hint line under it, and its key if it is also an action. Matched words highlighted. |
| Enter on a tool | Opens the group (existing `reveal`), opens Advanced ▸ if needed, scrolls, **focuses the slider** and flashes it briefly. Arrow keys then adjust at once (slider keys exist); Esc returns focus to the photo. |
| Ranking | exact name > prefix > word prefix > alias/synonym > substring > one typo (Damerau–Levenshtein ≤ 1 on words of five letters or more); recently used first among equals. ~100 lines own code, or a small MIT library (`@leeoniya/ufuzzy`, `match-sorter`; Fuse.js is Apache-2.0) [read, npm licences]. |
| Planned tools | Lightroom names LightBench doesn't have yet answer with "Not in LightBench yet (planned, Phase 3)" or "darktable's X does this; planned", instead of nothing. This serves Lightroom migrants (USABILITY lesson 14). |
| Rename map | When a control is renamed, its old name stays as an alias (USABILITY R2 6) with "(renamed)". |
| Also searchable later | Presets, snapshots, history steps, settings sections. |
| Accessibility | Keep the combobox/listbox; add a live region with the result count; result rows include the group path in their accessible name. |
| Tests | A unit test that every registered control has a label, a group, a Lightroom name or "none", and a working reveal; and that every Lightroom Develop slider name maps to a control or a planned entry. |
| Process version | Not applicable. |

## Open questions for the owner (tool search)

- **C1.** Bind Ctrl+F in Develop to tool search (overrides the browser's find in page), or only `/`?
- **C2.** One search for actions and tools (recommended) or two separate boxes?
- **C3.** Allow setting a value from the search box (e.g. "exposure +0.5"), or only jump to the control?
- **C4.** List planned-but-unbuilt tools in results?
- **C5.** Search in the Library view too (metadata fields, collections), or Develop only for now?

---

## Licence and patent notes (facts only, not legal advice)

- **Little CMS:** MIT ("Copyright (c) 2023 Marti Maria Saguer") [read]. **lcms-wasm:** MIT ("Copyright (c) 2024 Matt
  DesLauriers"); README: "The submodule (Little-CMS) is also MIT"; its build compiles only `Little-CMS/src` [read].
  Whether Little CMS's optional plugins carry other licences was not checked; they are not in this build.
- **moxcms:** BSD-3-Clause OR Apache-2.0 [read]. **jsColorEngine:** MPL-2.0; **jscolorengine2:** GPL-3.0; **icc:**
  Apache-2.0 [read, npm metadata].
- **darktable** (`snapshots.c`, `colorout.c`, `modulegroups.c`) and **RawTherapee**: GPL-3.0-or-later, compatible.
  **LightCraft** `proof.rs`, `output.rs`: MIT/Apache-2.0, compatible.
- **Fuzzy search libraries:** uFuzzy MIT, match-sorter MIT, cmdk MIT, Fuse.js Apache-2.0 [read, npm].
- **ICC specification:** ICC.1 is a published standard; LightCraft cites ICC.1:2022 for intents and media white
  [read]. Its terms of use were not checked.
- **Patents:** none searched for soft proofing, snapshot storage or command palettes.

---

## For Cowork verification

1. Lightroom snapshots: the exact XMP structure (open a Lightroom-written sidecar with snapshots); whether clicking a
   snapshot adds a history step; the default snapshot name.
2. Lightroom's soft proofing: the S key; the profile list; whether the histogram shows proofed values; what "Create
   Proof Copy" names the copy; whether proofing changes Export.
3. That Chrome and Edge never pass **Ctrl+N** to a page (in a tab and in an installed PWA window).
4. That no browser API exposes the monitor ICC profile, and that Chrome, Edge, Firefox and Safari colour-manage
   `display-p3` canvases to the monitor profile.
5. lcms-wasm: bundle size of `lcms.wasm`, speed of building a 33³ and a 65³ proof LUT in a worker, and support for
   CMYK printer profiles (`cmsCreateProofingTransform` exported?).
6. RawTherapee and ART: are snapshots stored in the `.pp3` sidecar?
7. Photoshop's Discover panel and any Lightroom tool search added after 2025.
8. MDN compat data for `GPUCanvasContext.configure` lists Chrome 144 as first version, which looks wrong for a WebGPU
   API shipped earlier: re-check before citing a version.

---

## Sources

**Read in full**
- darktable `6271f53`: `src/libs/snapshots.c`, `src/common/history_snapshot.h`, `src/iop/colorout.c`,
  `src/libs/modulegroups.c`, `src/iop/{sigmoid,toneequal,colorbalancergb,colorequal,hazeremoval,bilat,lens,ashift}.c`
  (`aliases()`).
- dtdocs `master`: [snapshots.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/utility-modules/darkroom/snapshots.md),
  [soft-proof.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/utility-modules/darkroom/soft-proof.md),
  [gamut.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/utility-modules/darkroom/gamut.md),
  [history-stack.md](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/utility-modules/darkroom/history-stack.md),
  [darkroom-view-layout.md](https://github.com/darktable-org/dtdocs/blob/master/content/darkroom/darkroom-view-layout.md).
- RawTherapee `dev`: `rtengine/improcfun.cc`, `rtengine/settings.h`, `rtengine/iccstore.cc`, `rtgui/editorpanel.cc`.
- LightCraft `701f78e`: `crates/codecs/src/proof.rs`, `crates/codecs/src/display.rs`, `crates/pipeline/src/output.rs`,
  `docs/parity-checklist.md`.
- [Little CMS LICENSE](https://github.com/mm2/Little-CMS/blob/master/LICENSE);
  [lcms-wasm](https://github.com/mattdesl/lcms-wasm) (`LICENSE.md`, `README.md`, `build.sh`, `package.json`);
  [moxcms](https://github.com/awxkee/moxcms) (`Cargo.toml`, `LICENSE.md`); npm registry metadata for `lcms-wasm`,
  `lcms2-wasm` (404), `jscolorengine`, `jscolorengine2`, `icc`, `fuse.js`, `@leeoniya/ufuzzy`, `match-sorter`, `cmdk`.
- Specs on GitHub: [WHATWG HTML](https://github.com/whatwg/html/blob/main/source) (`PredefinedColorSpace`),
  [WebGPU](https://github.com/gpuweb/gpuweb/blob/main/spec/index.bs) (canvas colour space, `GPUCanvasToneMapping`),
  [Media Queries 4](https://github.com/w3c/csswg-drafts/blob/main/mediaqueries-4/Overview.bs) (`color-gamut`),
  [CSS Color 5](https://github.com/w3c/csswg-drafts/blob/main/css-color-5/Overview.bs) (`@color-profile`, "At Risk");
  [MDN browser-compat-data](https://github.com/mdn/browser-compat-data) (`api/GPUCanvasContext.json`,
  `css/at-rules/media.json`, `css/types/color.json`).
- ExifTool `XMP.pm` 3.79 (no snapshot field).
- LightBench `a0f8353`: `web/src/settings/CommandSearch.tsx`, `shortcuts.ts`, `actions.ts`, `web/src/develop/history.ts`,
  `help.ts`, `Slider.tsx`, `ToolStack.tsx`, `DevelopView.tsx`, `web/src/engine/color/icc.ts`,
  `web/src/engine/gpu/develop-engine.ts`, `web/src/catalog/catalog.worker.ts`, `web/src/sidecar/xmp.ts`; docs/PLAN.md,
  USABILITY.md, PHASE2.md (Parts 6–8, 12), PHASE3.md (Parts 1, 4, 8).

**Search summaries only (pages not opened)**
- Snapshots: [jkost 2019](https://jkost.com/blog/2019/09/working-with-snapshots-in-lightroom-classic.html),
  [lightroomkillertips: history and snapshots](https://lightroomkillertips.com/understanding-history-snapshots-panels-part-1/),
  [lightroomkillertips: snapshots vs virtual copies](https://lightroomkillertips.com/lightroom-qa-snapshots-vs-virtual-copies/),
  [Photofocus](https://photofocus.com/photography/understanding-the-snapshots-and-history-panels-in-lightroom/),
  [Lightroom Queen forum](https://www.lightroomqueen.com/community/threads/1-raw-file-many-xmp-files-for-different-edits-versions.6265/),
  [Adobe Community: snapshot not written to XMP](https://community.adobe.com/t5/lightroom-classic-discussions/snapshot-is-not-autmatically-written-to-xmp/m-p/10248258/highlight/true),
  [Adobe: Camera Raw settings](https://helpx.adobe.com/camera-raw/desktop/get-started/overview-and-setup/camera-raw-settings.html).
- Soft proofing: [tourboxtech](https://www.tourboxtech.com/en/news/what-is-soft-proofing-in-lightroom.html),
  [lenscraft](https://lenscraft.co.uk/photo-editing-tutorials/what-is-soft-proofing-in-lightroom/),
  [Red River](https://www.redrivercatalog.com/infocenter/soft-proofing-explained.html),
  [softwarehow](https://softwarehow.com/?p=19884),
  [Adobe Community: destination gamut warning](https://community.adobe.com/t5/lightroom-classic/destination-gamut-warning-color-shift/m-p/10138732),
  [Adobe Community: Simulate Paper and Ink](https://community.adobe.com/t5/lightroom-classic-discussions/simulate-paper-and-ink-during-soft-proofing-in-lightroom-classic-have-no-effect-on-the-image/m-p/15210101/highlight/true),
  [digitalmastery](https://www.digitalmastery.com/lessons/soft-proofing-in-lightroom).
- Tool search: [Adobe Community: search preset by name](https://community.adobe.com/feature-requests-681/p-search-preset-by-name-661604).
