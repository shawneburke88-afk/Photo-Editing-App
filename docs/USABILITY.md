# LightBench usability plan

_Drafted 2026-10-11. This combines four inputs:_
- _the owner's direction;_
- _two first-round review studies: [REVIEWS_LIGHTROOM.md](research/REVIEWS_LIGHTROOM.md) and [REVIEWS_OPEN_SOURCE.md](research/REVIEWS_OPEN_SOURCE.md);_
- _a second, independent round of research run by the owner: [REVIEWS_ROUND2.md](research/REVIEWS_ROUND2.md) (11 apps, about 600 pages read in full, sources counted, a verification pass);_
- _the darktable code catalogue: [DARKTABLE_MODULES.md](DARKTABLE_MODULES.md)._

> **Evidence caveat.** The first-round studies could not open web pages in full; fetching and Reddit were blocked. Their findings rest on search-result excerpts and full GitHub issues, with judgement tags for how widespread each seems. The second round read pages in full and counts sources, but Reddit was still blocked, and some sources are affiliate or vendor sites (flagged ⚠ in that report). Where this plan leans on a finding, it names the round and lesson so the evidence can be checked.

## The owner's direction

- **darktable's engine, not just a darktable port.** Look at how darktable does a thing first, then improve the experience. The #1 complaint about darktable is its learning curve.
- **Clean and easy to use.** The most-used adjustments are the most prominent, and tools are grouped the way people think about them.
- **Guidance in the interface.** Sublabels and tooltips say what each control does, what moving it up or down does, and the pitfalls.
- **No silent capability cuts.** Advanced power stays reachable. Removing anything needs the owner's sign-off (see the PLAN tradeoff register).

## What the research says, in one page

Both studies agree on these points. The numbers in brackets are lesson numbers in the source files: **LR** for the Lightroom study, **OS** for the open-source study.

1. **One obvious way per task.** darktable's biggest usability problem is overlapping modules: four tone mappers, and two white-balance tools that warn users off each other. Ship one default tool per job and put alternative algorithms in a dropdown *inside* that tool. [OS 1, OS 6]
2. **A Lightroom-style Basic panel first.** It is the on-ramp people expect; darktable users ask for one (darktable issues #19084 and #16677), and RapidRAW's good reception rests on it. [LR 1, OS 2]
3. **Progressive disclosure, not a "beginner mode".** darktable's beginner preset is "not significantly less overwhelming". Lightroom's 2015 import "simplification" caused a public apology and a rollback. Keep things simple by default with depth one click away, inside each tool. [OS 3, LR 8]
4. **Plain words and photographic units, with help that says when and why.** Use kelvin, EV and stops. darktable's terms are called "academic", and its docs explain *what* but not *when*. [OS 4]
5. **Defaults that look finished.** darktable "defaults to the minimum processing needed to show a RAW file". [OS 5]
6. **Speed is a feature, and the preview must be truthful at every zoom.** Lag is the most common review complaint about Lightroom, and RawTherapee shows noise reduction only at 100 %. [LR 12, OS 7]
7. **Auto is a starting point, not a finish.** Lightroom's Auto is liked as a start and distrusted as a finish (too bright for some, too dark for others). It must set visible, editable sliders and give the same result every time. [LR 5]
8. **Masks: one click first, refinement second, all in one panel.** [OS 8, LR 14]
9. **History you can understand.** Keep a plain undo history, visible copy/paste of settings, and never paste over ratings. Toggling individual adjustments is wanted. [OS 9, LR 14]
10. **"Where are my photos?" must never be a question.** Catalogue-versus-files confusion is Lightroom's most common user problem. digiKam deletes folders when an album is deleted. Show file locations and online state plainly, and never delete files implicitly. [LR 6, OS 10]
11. **Browse before import.** ON1, Capture One sessions and DxO are praised for letting you open a folder and start culling. [LR 7]
12. **Data safety first.** Autosave, crash recovery, automatic library backups, predictable sidecars. [LR 10, OS 12, OS 15]
13. **Build onboarding into the app and keep the UI stable.** Outside tutorials go stale when tools are renamed. [OS 14, LR 8]
14. **Lightroom migration as a feature,** including finding tools by their Lightroom names. [OS 13]
15. **Simplicity alone doesn't keep serious users.** RapidRAW is criticised for image quality. LightBench's advantage is darktable's engine, so reveal its depth gradually; don't dilute it. [OS caution]

## Second round: what it confirms, what is new, where it conflicts

The second round ([REVIEWS_ROUND2.md](research/REVIEWS_ROUND2.md), lessons cited as **R2 1–20**, comparison tables as **R2 A/B/C**) was run separately, with a different method, and without seeing round 1. Findings both rounds reached on their own are the strongest evidence this plan has.

### Found independently by both rounds

| Round 1 | Round 2 | What round 2 adds |
|---|---|---|
| 1. One obvious way per task | R2 5 (hide the engine) | A September 2026 pixls.us thread shows stacked tone mappers and the white-balance warning still trip new users after darktable 5.4/5.6. Proposes a single White balance control with Temp/Tint and as-shot/auto/picker modes; LightBench already has this. |
| 2. Basic panel first | R2 4, R2 A1 | Lightroom (cloud) is the layout most often called approachable. |
| 3. Progressive disclosure, not a beginner mode | R2 4, R2 A2 | "Hide, don't remove": Ansel removed darktable tools and is called "a crippled darktable". Supports the no-silent-cuts rule. |
| 4. Plain words, photographic units | R2 6 | Keep names stable between releases, keep a rename map for search, and add a glossary linking labels to darktable modules. |
| 5. Defaults that look finished | R2 C (darktable row), R2 8 | The angle changes: automatic changes must also be *visible* (see "New" below). |
| 6. Speed; truthful preview | **R2 1** (ranked first) | Speed is the most common reason people quit, at every price. Lightroom on the web takes "a second or two" per slider move. Proposes published latency budgets and minimum GPU/browser requirements. |
| 7. Auto is a starting point | R2 9, R2 C | No source rates any Auto as a finished edit. Users value a strength control, per-setting undo, and Auto that re-runs per image in a batch. |
| 8. Masks: one click first | R2 10 | AI subject/sky masks are now "table stakes": their absence pushed Capture One, DxO and darktable users to Adobe. Masks must combine (add/subtract/intersect) and feather; Lightroom's top idea is "Feather Masks" (598 votes). |
| 9. Understandable history; visible paste | R2 12, R2 13 | One paste dialog with checkboxes, saved paste presets and a preview; paste modes, not numbers (e.g. "As Shot" white balance). Snapshots, before/after and virtual copies are basics. |
| 10. "Where are my photos?" | R2 14, R2 20 | State where originals and edits live in one sentence on the first screen. |
| 11. Browse before import | R2 14 | …and keep **one** library model, not a browse mode plus a catalogue mode (see conflicts). |
| 12. Data safety | R2 2 | Sidecar-first with a rebuildable database, which is LightBench's design since Part 3; add versioned backups and a start-up self-check. |
| 13. Onboarding; stable UI | R2 A5, A8, R2 19 | Layout churn angers everyone; ship "what moved" notes in the app. |
| 14. Lightroom migration | R2 18 | Also read and write **darktable** XMP develop edits, so darktable users can arrive and leave with their edits. |
| 15. Simplicity alone doesn't keep users | R2 16 | Image quality and camera coverage are why power users stay; never refuse a file, fall back to a generic profile. |

### New in round 2

- **Trust promise (R2 3).** Business-model changes drive more departures than missing features. Proposal: a short published promise (GPL licence, no upsell nags, no training on users' photos, export everything at any time).
- **Panel order is not pipeline order (R2 7).** darktable's visible order *is* its processing order, which confused reviewers. LightBench already separates them: the panel order is cosmetic and the pipeline is fixed. This fits the owner's tool-tabs plan.
- **Show every automatic change (R2 8).** darktable's hidden +0.7 EV is cited as reading like a bug. LightBench applies the same +0.7 EV base exposure to RAW files (darktable's default, for its tone mapper); it is visible today only under Basic → Advanced. Proposal: label it where the user sees it (e.g. a note under Exposure, or the first history step "Base exposure +0.7 EV (darktable default)"), with a preference to change it. LightBench does not undo in-camera exposure compensation, which is the other half of the darktable complaint.
- **Tunable Auto (R2 9).** A strength slider; a choice of which sliders Auto may touch; Auto re-run per image when applied to many photos.
- **Mask-first local panel (R2 10).** One mask (or mask group) carries exposure, colour and detail changes, instead of masks living inside each module. darktable's per-module blend masks would be generated behind it. Recompute AI masks per image when pasted.
- **AI optional, local and labelled (R2 11).** AI off until the user turns it on, run in the browser (WebGPU) where feasible, every AI step labelled in the history, never upload without per-action consent. Matches the Phase 4 plan ("Local AI").
- **Library basics and culling (R2 15).** Ratings, labels, flags, hierarchical keywords (all to XMP), smart collections, duplicate detection, stacks including RAW+JPEG, and a full-screen culling view where keys act on what is shown. Mostly already in Phase 2.
- **Adjustable shortcuts, UI size and contrast (R2 17).** Remappable shortcuts with a Lightroom preset, UI scaling, a high-contrast theme, a choice of background grey, everything reachable by keyboard.
- **Release discipline (R2 19).** Keep the previous version one click away (also on the website), forward/backward-compatible edit formats, in-app "what moved" notes, performance regression tests.
- **Web-specific (R2 20).** Installable PWA that works offline; published supported browsers and GPU minimums; test against browser betas; any edit made in one place renders everywhere (website and desktop share one engine).

### Conflicts with decisions already made

The owner settled these on 2026-10-11; the outcome is under each item and in the Decisions table.

1. **Tabs vs one stack.** The owner chose tool tabs (2026-10-11). Round 2 finds the single right-hand stack (Lightroom) rated most approachable, and quotes reviewers criticising Capture One for making you "switch to different tabs to edit your pictures" (R2 A1). Caveats: those two quotes come from affiliate sites (⚠ in the report), and the same reviewers praise Capture One's custom tabs for experts. A middle path exists: one scrolling stack with a row of group buttons at the top that jump to (and highlight) each group, instead of hiding the others.
   **Owner: one stack with a jump bar** (replaces the tabs decision).
2. **Order of groups.** The owner chose Crop & Lens before Basic. Round 2: every app called easy uses roughly "profile/basic light → colour → effects/detail → optics/geometry → local tools" (R2 B, R2 4). Nuance not in the report: Lightroom Classic shows Crop in a tool strip *above* the Basic panel and puts Lens Corrections below Detail; Lightroom (cloud) has Crop as a separate tool button. So "Crop first, lens later" matches Lightroom. A reason to keep crop first: Auto and the histogram should judge the cropped frame.
   **Owner: keep Crop & Lens first.**
3. **"Open folder" as a separate browse mode.** PLAN.md Phase 2 says: open a folder and cull without importing, then add the keepers to the library. Round 2 warns against two storage models with different features (ON1 Browse vs Catalog, Lightroom cloud vs local; R2 14). Alternative: opening a folder *is* adding it in place (no copying, as the importer's "add" mode already does), indexed in the background, with culling available at once and every library feature working; removing a folder from LightBench never deletes files.
   **Owner: one model.**
4. **Auto looks.** Built-in looks currently fix Contrast and Vibrance per look (Part 2b). Round 2 suggests adding a strength slider and a choice of sliders Auto may touch (R2 9). This is an addition, not a change of the earlier decision.
   **Owner: add both** the strength slider and the choice of sliders.

## What darktable's own code offers here (from the catalogue)

- **The quick access panel is darktable's "Basic" panel.** It does no processing of its own; it shows sliders borrowed from the real modules in one list (`src/libs/modulegroups.c`). LightBench's Basic panel works the same way: Lightroom-named sliders that drive darktable modules.
- **"Basic adjustments" (`basicadj`) is deprecated** in favour of the quick access panel, because one module mixed operations that belong at different points of the pipeline. Its RawTherapee-derived auto exposure is still a reference for Auto.
- **darktable already imports Lightroom XMP** (`src/develop/lightroom.c`): exposure, crop, HSL, tone curve, split toning, clarity, grain, vignette and spots. This is a ready reference for Phase 2 migration.
- **Built-in module-group layouts**, including "workflow: beginner", and presets that apply automatically by camera, lens or ISO. These are darktable's answer to "defaults that look finished".

## Design rules for LightBench

### Develop panel layout

The right panel is one scrolling stack in workflow order, with Crop & Lens first (owner's decision). Groups are collapsible, and the jump bar at the top reaches any group in one click.

| Order | Group | Contents | Engine (darktable) | Status |
|---|---|---|---|---|
| 1 | **Crop & Lens** | Crop, Straighten, Transform/Upright; Lens profile, Chromatic aberration, Vignetting correction | crop, rotate and perspective (ashift), lens correction (lensfun), CA correction | Crop, straighten, rotate 90° and flip: **built** (Phase 3, Part 1; [PHASE3.md](PHASE3.md)), shown as the **Crop** group; Transform/Upright and lens corrections: later in Phase 3 (the group becomes Crop & Lens) |
| 2 | **Basic** (open by default) | Auto + look; White balance (preset, **Pick**, Temp, Tint); Tone (Exposure, Contrast, Highlights, Shadows, Whites, Blacks); Presence (Texture, Clarity, Dehaze, Vibrance, Saturation) | temperature, exposure, sigmoid, tone equalizer, colour balance rgb, local contrast, haze removal | Built, except Texture/Clarity/Dehaze and colour balance rgb |
| 3 | **Tone curve** | Regions (parametric) + point, RGB, Red, Green, Blue | after the sigmoid, as darktable's tone curve sits and its Lightroom importer puts Lightroom's curve; darktable's monotone spline and preserve-colors norms | **Built** (Phase 3, Part 12; [PHASE3.md](PHASE3.md#part-12-the-tone-curve)) |
| 4 | **Colour** | Colour mixer (HSL), Colour grading, Point colour | colour equalizer, colour balance rgb | Colour mixer and Point colour (a tab of the mixer, as in Lightroom): **built** (Phase 3, Part 15; [PHASE3.md](PHASE3.md#part-15-colour-mixer-and-point-color)); Colour grading: **built** (Phase 3, Part 17; [PHASE3.md](PHASE3.md#part-17-colour-grading)), its own group after the mixer (jump bar "Grading"), on colour balance rgb |
| 5 | **Detail** | Sharpening, Noise reduction | diffuse or sharpen / sharpen, denoise (profiled) | Phase 3 |
| 6 | **Effects** | Vignette, Grain | vignette, grain | Phase 3 |
| — | **Masks** (own panel) | AI subject/sky, brush, linear, radial, then colour/luminance range refinement | drawn + parametric masks, blending | Phase 3–4 |

Every group follows the same rules:
- **One control per job.** Alternative algorithms (e.g. sigmoid / filmic / AgX for tone mapping) go in a **Method** dropdown inside the group, not in separate modules.
- **"Advanced ▸"** inside each group shows the darktable module's own parameters, so no capability is lost.
- **One stack with a jump bar** (owner, 2026-10-11, after round 2; replaces the earlier tool-tabs choice): all groups stay in one scrolling list in workflow order. A row of group buttons at the top of the panel jumps to a group and highlights the group in view; nothing is hidden. Panel order is cosmetic; the processing order is fixed (R2 7). _Built in Phase 3, Part 1 with the Crop and Basic groups; groups also close, and each has an on/off eye to see the photo without it ([PHASE3.md](PHASE3.md))._
- **Tool search** (owner, 2026-10-11): `/` or Ctrl+F finds a tool by its Lightroom name, LightBench name or darktable name, e.g. "Clarity" → Presence → Clarity (local contrast). It comes late, once most tools exist.

### Guidance in the interface (owner's request)

- **Hint** on the same line as each control's name: a short plain-language phrase, e.g. "Bright areas (skies, clouds)". It never adds a row; it shows only when it fits the panel's width completely (owner's decision, 2026-10-11). On by default; the **Hints** checkbox turns hints off.
- **Tooltip** on hover or keyboard focus. It says:
  - what the control does;
  - what moving it left or right does;
  - the **pitfalls**, in amber;
  - the darktable module behind it.
- Every text must match what the engine really does. The texts live in `web/src/develop/help.ts` and are reviewed whenever the engine changes.
- Warnings appear in context. For example, the clipping triangles and the **J** overlay show where detail is lost; tooltips point to J.

### Interaction rules

- Double-click a slider's name or value to reset it. Every Auto or picker action is one history step.
- Shortcuts follow Lightroom where one exists (J, W, D, G, P/X/U, 0–5, \\), with darktable's as aliases (O, Shift+O).
- Units: K, EV, %. Signed sliders centre on 0.
- The preview is truthful at every zoom. If a preview is approximate, the interface says so.

## Already done (Part 2b, in progress)

- Histogram drawn like darktable's, with clipping triangles.
- **J** shows *lost detail*: sensor clipping plus pure white or black on screen. All of darktable's clipping modes are available in the histogram menu. Shift+O shows sensor clipping alone.
- **White-balance picker** (W): darktable's spot-picker maths, with a magnifying loupe that follows the cursor.
- **Auto** moves visible sliders and leaves white balance alone, as Lightroom's does.
- **Hints and tooltips** on every Basic slider.

## Decisions

| Question | Owner's answer (2026-10-11) |
|---|---|
| Hints on by default? | Yes, but on the label's line only, shown only when they fit the panel width. Built. |
| Solo mode? | Use tool tabs in workflow order instead. **Superseded** by the stack + jump bar decision below. |
| Browse before import ("Open folder")? | Yes. Planned for Phase 2. |
| Tool search? | Late, once most tools are chosen (end of Phase 3). |
| Crop & Lens position? | Before Basic. Re-confirmed after round 2 (conflict 2 above). |
| Tabs or one stack? (round 2) | One scrolling stack with a jump bar of group buttons; nothing hidden. |
| Open folder model? (round 2) | One library model: opening a folder adds it in place, indexes it in the background, every feature works; removing it never deletes files. |
| Auto additions? (round 2) | A strength slider and a choice of which sliders Auto may touch. Auto re-runs per photo when applied to many. |

### Second batch after round 2 (owner, 2026-10-11)

| Question | Owner's answer |
|---|---|
| AI subject/sky masks earlier than Phase 4? | No: keep them in Phase 4. Manual masks come first, in Phase 3. |
| Read/write darktable XMP develop edits (R2 18)? | Later (Phase 3 or after), once more darktable tools exist in LightBench so more of each edit maps across. |
| Publish a trust promise (R2 3)? | Not yet; revisit closer to a public release. |
| Keyboard and display (R2 17) | Remappable shortcuts (with a Lightroom-compatible preset), UI scaling, and every core action reachable by keyboard. A high-contrast theme was not chosen. |
| Installable, offline website (PWA)? | Yes, in Phase 2. |
| Speed targets (R2 1) | Yes: agreed slider-to-preview time budgets with an automated speed test before each release, and published minimum browsers/GPUs. Budgets are confirmed on the owner's GPU before they are fixed. |
| Release discipline (R2 19) | Update notes (new features, bug fixes) in the app; "what moved" notes when a control moves or is renamed; the previous website version kept one click away; saved edits readable by both older and newer versions. |
| Showing the +0.7 EV base exposure (R2 8) | A note under the Exposure slider for RAW files, e.g. "includes +0.7 EV base (darktable default)", with a tooltip saying why and where to change it. This is the one place a note may add a row. |
| Changing the +0.7 EV default | Yes: a preference. It applies to photos not yet edited; existing edits keep their value. |
| Jump bar buttons | Icons with one-word labels (Crop, Basic, Curve, Colour, Detail, Effects). Labels hide when the panel is narrow; the name shows on hover. |

### Open folder details (owner, 2026-10-11)

| Question | Owner's answer |
|---|---|
| Where does Open folder live? | A prominent **Open folder…** button. It replaces the Import window's "add in place" mode; Import now only copies (cards, backups). |
| Subfolders in the grid? | Included, with a **Subfolders** toggle; on by default. |
| Thumbnails and previews? | The camera's embedded JPEG first (darktable's default for unedited images); the RAW is rendered in Develop. The Loupe marks these with a **Camera preview** badge. |
| Full-screen culling view? | Next PR, after Open folder and background indexing. |
| Culling layout? | One photo, plus a 2-up toggle (C). |
| Auto-advance after a flag/star/label key? | Yes, on by default in the culling view, with a toggle. |
| What does 100 % show? | Always the photo rendered from the original file (true pixels), even though it takes a few seconds. |
| What surrounds the photo? | Filmstrip, info line (I toggles) and key hints. |

### Snapshots (owner, 2026-10-14)

After [research/SNAPSHOTS_PROOFING_SEARCH.md](research/SNAPSHOTS_PROOFING_SEARCH.md) Part A (built: [PHASE3.md, Part 19](PHASE3.md#part-19-snapshots)). They answer round 2's "snapshots, before/after and virtual copies are basics" (lesson 9 above).

| Question | Owner's answer |
|---|---|
| What is a snapshot? | A named copy of the photo's full develop settings, process version included, plus when it was made. The default name is a date/time stamp (Lightroom's is one too, per a secondary source); it can be renamed. |
| Where? | A Snapshots panel in Develop's left side, near History (built between Presets and History, Lightroom's order). |
| What do they do? | Click applies one as one undoable history step ("Snapshot: name"); hover previews it; Update with current settings, Rename, Delete (undoable); **Set as Before** makes Before / after (`\`) compare against it until cleared or another photo is shown. A History step's menu has "Create snapshot from this step". |
| Keys | **Ctrl+Alt+N** everywhere; **Ctrl+N** as well in the installed app window (`display-mode: standalone`), where Chromium doesn't keep it. Both in the shortcut registry, so they can be changed. |
| Storage | The catalog (a new table, schema 15) **and** the photo's sidecar (`lightbench:Snapshots`), read back on Open folder, Import and Read changes. Lightroom's own snapshot field is undocumented, so it is neither read nor written. |
| Virtual copies, Copy/Paste, presets | Each virtual copy has its own snapshots (Lightroom shares them). Copy/Paste and Sync don't carry snapshots; presets don't include them. |
| Old edits | Rendering never changes. An older snapshot applied keeps its process version: the photo as it was. |

### AI features requested by the owner (2026-10-11)

| Request | Plan |
|---|---|
| AI "Auto" that weighs subject vs background | Phase 4, on top of AI masks: region-aware goals for the existing Auto solver; results are ordinary sliders (round 2, lesson 9). |
| Auto for a selected or masked area | Phase 4, with the mask-first local panel. |
| Hover over the photo to preview selectable objects | Phase 4, SAM-style promptable segmentation. |
| Model download size | User's choice: small default, optional high-quality download. |
| Model research | Now, alongside Phase 2 (`docs/research/AI_MODELS.md`). |
