# LightBench usability plan

_Drafted 2026-10-11; updated 2026-10-21 to match what is built (Phase 3 up to Part 25, Diagnostics, Import speed, Zoom levels, the AI Depth mask) and the owner's decisions of 2026-10-21 (the order to 1.0 is in [ROADMAP.md](ROADMAP.md)). This combines four inputs:_
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

The right panel is one scrolling stack in workflow order, with Crop & Lens first (owner's decision). Groups are collapsible, and the jump bar at the top reaches any group in one click. Since the owner's first real use (2026-10-19) every group, and the secondary sections inside them (Advanced, Lens, Transform), start closed and stay as the user leaves them ([PHASE3.md](PHASE3.md#develop-groups-start-collapsed-owner-2026-10-19)).

| Order | Group | Contents | Engine (darktable) | Status |
|---|---|---|---|---|
| 1 | **Crop & Lens** | Crop, Straighten, Transform/Upright; Lens profile, Chromatic aberration, Vignetting correction | crop, rotate and perspective (ashift), lens correction (lensfun), CA correction | **Built**: crop, straighten, rotate 90° and flip (Phase 3, Part 1), lens corrections (Part 2: the camera's own data or Lensfun's) and Transform/Upright (Part 3), with Lens and Transform as sections that start closed ([PHASE3.md](PHASE3.md)) |
| — | **Remove** (own group after Crop & Lens) | Remove, Heal and Clone spots | darktable's retouch (heal, clone); the fill is LightBench's patch-based completion | **Built** (Phase 3, Part 11; [PHASE3.md](PHASE3.md#part-11-the-remove-brush--remove-heal-and-clone-without-ai)); an AI Remove mode comes with the AI Remove build ([ROADMAP.md](ROADMAP.md)) |
| 2 | **Basic** | Auto + look; White balance (preset, **Pick**, Temp, Tint); Tone (Exposure, Contrast, Highlights, Shadows, Whites, Blacks); Presence (Texture, Clarity, Dehaze, Vibrance, Saturation) | temperature, exposure, sigmoid, tone equalizer, colour balance rgb, local contrast, haze removal, contrast & texture | Built, except colour balance rgb; Texture, Clarity (darktable's contrast & texture) and Dehaze (darktable's haze removal) **built** in Phase 3, Part 25 ([PHASE3.md](PHASE3.md#part-25-effects)), their darktable settings under Advanced |
| 3 | **Tone curve** | Regions (parametric) + point, RGB, Red, Green, Blue; Auto (contrast, colour, suggestions) | after the sigmoid, as darktable's tone curve sits and its Lightroom importer puts Lightroom's curve; darktable's monotone spline and preserve-colors norms | **Built** (Phase 3, Part 12; [PHASE3.md](PHASE3.md#part-12-the-tone-curve)); Auto row (LightBench's own methods) in Part 21 ([PHASE3.md](PHASE3.md#part-21-section-eyes-and-tone-curve-auto)) |
| 4 | **Colour** | Colour mixer (HSL), Colour grading, Point colour | colour equalizer, colour balance rgb | Colour mixer and Point colour (a tab of the mixer, as in Lightroom): **built** (Phase 3, Part 15; [PHASE3.md](PHASE3.md#part-15-colour-mixer-and-point-color)); Colour grading: **built** (Phase 3, Part 17; [PHASE3.md](PHASE3.md#part-17-colour-grading)), its own group after the mixer (jump bar "Grading"), on colour balance rgb |
| 5 | **Detail** | Sharpening, Noise reduction | capture sharpening (Richardson–Lucy), denoise (profiled) | **Built** (Phase 3, Part 13; [PHASE3.md](PHASE3.md#part-13-detail--sharpening-and-noise-reduction)); an opt-in AI Denoise comes later ([ROADMAP.md](ROADMAP.md)) |
| 6 | **Effects** | Post-crop vignette, Grain, Glow | vignette, grain; Glow is LightBench's own (darktable's bloom and soften as references) | **Built** (Phase 3, Part 25; [PHASE3.md](PHASE3.md#part-25-effects)): Lightroom's sliders and styles, darktable's centre and shape, colour grain and mid-tones bias under Advanced; jump bar "Effects" |
| — | **Masks** (own group, docked in the stack after Remove) | Brush, linear, radial, colour and luminance ranges (Phase 3); AI depth range (Phase 3, Part 24: opt-in model download); AI masks — click/hover select, people/faces, sky, subject — in the AI masks build, in 1.0 (owner, 2026-10-21) | darktable's drawn and parametric mask maths, rasterised on the GPU | Manual masks **built** (Phase 3, Part 23; [PHASE3.md](PHASE3.md#part-23-masking)); the **AI Depth range** built (Part 24; [PHASE3.md](PHASE3.md#part-24-ai-depth-range-mask-and-model-delivery)): one click asks once to download the model, then makes the mask; a range-family part, its depth map kept in the edit and .xmp; a docked group rather than Lightroom's floating panel (owner, 2026-10-14), range masks apply to the whole photo; local Texture, Clarity, Dehaze and a local Glow amount since Part 25 |

Every group follows the same rules:
- **One control per job.** Alternative algorithms (e.g. sigmoid / filmic / AgX for tone mapping) go in a **Method** dropdown inside the group, not in separate modules.
- **"Advanced ▸"** inside each group shows the darktable module's own parameters, so no capability is lost.
- **One stack with a jump bar** (owner, 2026-10-11, after round 2; replaces the earlier tool-tabs choice): all groups stay in one scrolling list in workflow order. A row of group buttons at the top of the panel jumps to a group and highlights the group in view; nothing is hidden. Panel order is cosmetic; the processing order is fixed (R2 7). _Built in Phase 3, Part 1 with the Crop and Basic groups; groups also close, and each has an on/off eye to see the photo without it ([PHASE3.md](PHASE3.md)). Since Part 21 the sections inside the groups have eyes too (white balance, tone, presence, each curve, mixer and Point Color, each grading wheel, sharpening, noise reduction, crop, transform, lens): a section's eye shows the photo with that section as its Reset would set it; the group's eye still hides the whole group and wins over its sections' eyes ([PHASE3.md, Part 21](PHASE3.md#part-21-section-eyes-and-tone-curve-auto)). Part 25's Effects group has an eye per section (Vignette, Grain, Glow), and the Presence eye covers Texture, Clarity and Dehaze._
- **Tool search** (owner, 2026-10-11): `/` or Ctrl+F finds a tool by its Lightroom name, LightBench name or darktable name, e.g. "local contrast" → Presence → Clarity. It comes after AI Denoise in the order to 1.0 ([ROADMAP.md](ROADMAP.md)). **Naming (owner, 2026-10-21):** typing another app's name (e.g. "Clarity", "Shadows") finds the matching LightBench tool, but results show only LightBench's own names; no other app is named in the UI, as the no-notes rule (below) requires.

### Guidance in the interface (owner's request)

- **Hint** on the same line as each control's name: a short plain-language phrase, e.g. "Bright areas (skies, clouds)". It never adds a row; it shows only when it fits the panel's width completely (owner's decision, 2026-10-11). On by default; the **Hints** checkbox turns hints off.
- **Tooltip** on hover or keyboard focus. It says:
  - what the control does;
  - what moving it left or right does;
  - the **pitfalls**, in amber.
  The darktable module behind each control stays in `help.ts` (`engine`) for the code's readers and isn't shown (see the next section).
- Every text must match what the engine really does. The texts live in `web/src/develop/help.ts` and are reviewed whenever the engine changes.
- Warnings appear in context. For example, the clipping triangles and the **J** overlay show where detail is lost; tooltips point to J.

### No notes in the UI (owner, 2026-10-19)

The owner's rule: **remove all such notes.** Visible text (panels, dialogs, wizards, tooltips, hints, messages, menu and shortcut labels) says what a control does in plain words. It doesn't say which other app it imitates or how it is built: no "as darktable does", "(darktable's …)", "Lightroom-style", "like Lightroom", Adobe, Camera Raw, Capture One or LightCraft comparisons, module or algorithm names used as explanations, or "this number isn't published" notes.

What stays:
- Required legal notices: licences, THIRD_PARTY_NOTICES, the Adobe DNG notice in System Check and Settings, and the Lensfun attribution with its licence under the Lens section.
- Names of options and of the user's own data from another app: the **Lightroom Classic** shortcut set, messages about what was read from or written to Lightroom's `.xmp` (crop, Transform, tone curve, masks, the `.acr` file), history steps named after them, and colour space names such as Adobe RGB (1998).
- Diagnostics meant for bug reports (System Check's RAW details, the Benchmark page, error messages from the RAW decoder).
- Code comments and docs, which aren't UI. Release notes are written separately.

New text follows the rule; review it when adding panels. The strings changed for it are listed in the commit "No notes in the UI" (feedback-1).

### Interaction rules

- Double-click a slider's name or value to reset it. Every Auto or picker action is one history step. An Auto result with an Amount (a preset, the Tone Curve's Auto) changes its own step while the Amount moves; it adds no steps.
- Eyes (group and section) only change what is shown: never saved, never in the history, never in Export, and all back on for the next photo.
- Shortcuts follow Lightroom where one exists (J, W, D, G, P/X/U, 0–5, \\), with darktable's as aliases (O, Shift+O).
- Units: K, EV, %. Signed sliders centre on 0.
- The preview is truthful at every zoom. If a preview is approximate, the interface says so.
- When the graphics card fails (hardening build, owner 2026-10-21), the message says what happened and what the user can do, in plain words, without technical terms: "The graphics card stopped responding. LightBench restarted the preview. Your edit is safe." Develop restarts its preview by itself, a few times at most; if it keeps failing, it stops and says what to try, with **Try again** ([PHASE3.md](PHASE3.md#hardening-and-cleanup-owner-2026-10-21)).
- Zoom in Develop (owner, 2026-10-19): Fit, 25 %, 50 %, 100 %, 200 %, 400 % and 800 % from the toolbar's Zoom menu, **Z** (Fit and back to the last level), **=** / **−** one level in or out, and Ctrl/⌘ + wheel over the photo, always toward the pointer. Above 100 % the photo's own pixels are shown enlarged without smoothing, so sharpness and noise can be judged; below it the preview is averaged like Fit. Zoom is a view only ([PHASE3.md](PHASE3.md#zoom-levels-owner-2026-10-19)).

## Built in Part 2b

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
| Tool search? | Late, once most tools are chosen (end of Phase 3). Now placed after AI Denoise (owner, 2026-10-21). Naming decided the same day: other apps' names find LightBench's tools, and only LightBench's names are shown. |
| Crop & Lens position? | Before Basic. Re-confirmed after round 2 (conflict 2 above). |
| Tabs or one stack? (round 2) | One scrolling stack with a jump bar of group buttons; nothing hidden. |
| Open folder model? (round 2) | One library model: opening a folder adds it in place, indexes it in the background, every feature works; removing it never deletes files. |
| Auto additions? (round 2) | A strength slider and a choice of which sliders Auto may touch. Auto re-runs per photo when applied to many. |

### Second batch after round 2 (owner, 2026-10-11)

| Question | Owner's answer |
|---|---|
| AI subject/sky masks earlier than Phase 4? | No: keep them in Phase 4. Manual masks come first, in Phase 3. (Manual masks and the AI Depth range are built; on 2026-10-21 the owner put the AI masks in 1.0, after AI Remove, below.) |
| Read/write darktable XMP develop edits (R2 18)? | Later (Phase 3 or after), once more darktable tools exist in LightBench so more of each edit maps across. |
| Publish a trust promise (R2 3)? | Not yet; revisit closer to a public release. |
| Keyboard and display (R2 17) | Remappable shortcuts (with a Lightroom-compatible preset), UI scaling, and every core action reachable by keyboard. A high-contrast theme was not chosen. |
| Installable, offline website (PWA)? | Yes, in Phase 2. |
| Speed targets (R2 1) | Yes: agreed slider-to-preview time budgets with an automated speed test before each release, and published minimum browsers/GPUs. Budgets are confirmed on the owner's GPU before they are fixed. _The automated test is built (the Speed check, warnings only, 2026-10-21); the budgets and the minimum browsers/GPUs are not._ |
| Release discipline (R2 19) | Update notes (new features, bug fixes) in the app; "what moved" notes when a control moves or is renamed; the previous website version kept one click away; saved edits readable by both older and newer versions. _One-click rollback built 2026-10-21 ([ROLLBACK.md](ROLLBACK.md))._ |
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
| Model research | Now, alongside Phase 2 (`docs/research/AI_MODELS.md`). Training data re-checked 2026-10-21 (`docs/research/cowork-2026-10-21-ai-masks/AI_MASKS.md`); the owner then relaxed the model rule (below). |

### Soft proofing (owner, 2026-10-14)

Built in Phase 3, Part 20 ([PHASE3.md](PHASE3.md#part-20-soft-proofing)), after [research/SNAPSHOTS_PROOFING_SEARCH.md](research/SNAPSHOTS_PROOFING_SEARCH.md) Part B and its Cowork check.

| Question | Owner's answer |
|---|---|
| How does it look and work? | Like Lightroom Classic's: **S** turns soft proofing on and off, **Shift+S** shows the destination gamut warning (Adobe's shortcut table). A bar under the toolbar: profile, rendering intent, black point compensation, Simulate Paper & Ink, a screen gamut warning, a destination gamut warning, and **Create Proof Copy** (a virtual copy named after the profile). The histogram follows the proof. |
| Which screen does the screen warning test? | The colour space LightBench draws in, **sRGB or Display P3**, and it says so on the button: browsers don't give web pages the monitor's ICC profile. |
| Which profiles? | Built-in sRGB, Adobe RGB (1998)-compatible and Display P3 (written by LightBench from published primaries), plus printer and paper ICC files loaded from disk, kept in this browser (never uploaded) and removable. RGB destinations as Lightroom; CMYK works too (Little CMS reads it). |
| Rendering intent? | Relative Colorimetric with black point compensation by default; Perceptual, Saturation and Absolute Colorimetric selectable (Absolute without black point compensation). |
| Colour management? | Little CMS (lcms-wasm, MIT) in a worker, baking a 65³ lookup table the display shader samples only while proofing; cached per profile and options. |
| Firefox? | Its 2D canvases have no colour space option (MDN's compatibility data, checked by Cowork; not tried in Firefox here), so LightBench asks the browser whether a canvas can hold Display P3 and shows sRGB where it can't, with a note on the screen warning's button. Chrome, Edge and Safari keep Display P3. |
| Export? | Proofing never changes exports. "Export with this profile" for loaded printer profiles is left for later; Export already writes sRGB, Display P3 and Adobe RGB. |
| Where are the settings kept? | In this browser, as a way of viewing: not in the edit, the history or sidecars. |

### Import speed (owner, 2026-10-20)

After the first real import (about 1,500 Nikon D5200 RAW+JPEG pairs from a card took several minutes). Built in [PHASE3.md, "Import speed"](PHASE3.md#import-speed-owner-2026-10-20).

| Question | Owner's answer |
|---|---|
| Where does the time go? | Measure it: every step of every photo is timed and written to the Diagnostics log (Settings → Diagnostics), with bytes and MB/s. The finished Import window adds one quiet line, e.g. "1,500 photos, 38 GB in 6 min 12 s · copying 71 % · thumbnails 18 %". |
| When is an import finished? | When every file is copied, read back and checked, and in the Library with its camera preview. Ratings, keywords and edits from sidecars, stacks with twins imported earlier and the presets for new photos fill in afterwards in the background, with a note in the left panel; closing LightBench is safe, the rest is done when it opens again. |
| RAW+JPEG cards? | With stacking on, the RAWs are copied first, so they show at once; the JPEGs follow, each joining its RAW's stack. The Import window can be closed meanwhile (**Continue in the background**); the left panel shows the import with **Show** and **Stop**. |
| Copy checking? | Stays on: it is what makes formatting the card safe. 2–3 files are copied at once instead of one. |
| Skipping the JPEGs? | **RAW only (skip JPEGs that have a RAW twin)**, off by default, kept in import presets. The summary says how many JPEGs stayed on the card. |
| What must not change? | The files, names, numbering (`-1`), folders, sidecars and stacks are those of the one-at-a-time import; a failed photo still fails alone with the same message; Stop and "Already imported" work as before; a file already at the destination but missing from the library (an import cut off by closing the tab) is marked **Copied, not in library** and stays ticked. A rating, flag, label or edit given to a photo while its details are still being filled in is kept. |

### Diagnostics (after the freeze report of 2026-10-19)

After the report of the whole computer freezing in Develop on a laptop's integrated Intel graphics. Built in [PHASE3.md, "Diagnostics"](PHASE3.md#diagnostics-flight-recorder).

| Question | Owner's answer |
|---|---|
| How do we find out what happened on the owner's computer? | A **Record diagnostics** switch in Settings → Diagnostics, off by default. While on, what happens in Develop and in the GPU engines is logged in the browser's storage as it happens, so the log survives a crash or a forced restart; **Export diagnostics…** saves it to share, **Clear** empties it. |
| What may the log contain? | The computer's description (browser, graphics adapter and its limits, cores, memory), actions with the settings changed, engine events with durations and GPU memory, errors. Photos are numbers for the session with the camera model and size, **never** file names, folders or pixels. |
| Integrated graphics? | When LightBench runs on what looks like integrated Intel graphics, Develop shows a one-time, dismissible tip about choosing "High performance" in Windows' graphics settings. It doesn't claim the computer has another card: the browser can't tell. |

### Zoom levels (owner, 2026-10-19)

From the owner's first real use. Built in [PHASE3.md, "Zoom levels"](PHASE3.md#zoom-levels-owner-2026-10-19); the interaction rule is above.

| Question | Owner's answer |
|---|---|
| Which levels? | Fit, 25 %, 50 %, 100 %, 200 %, 400 % and 800 %. No Fill. |
| How are they chosen? | A **Zoom** menu in Develop's toolbar; **Z** (Fit and back to the last level), **=** / **−**, Ctrl/⌘ + wheel over the photo toward the pointer; a click on the photo zooms to the last level or back to Fit. |
| What does 200 % and more show? | The photo's real pixels as sharp squares (no smoothing), to judge sharpness and noise. |
| Does zoom change the edit? | No. It is a view: history, sidecars, exports and thumbnails are unchanged. |

### Decisions of 2026-10-21

From the owner's answers to the roadmap ([ROADMAP.md](ROADMAP.md), section 6) and to the AI masks and AI Remove research ([research/PHASE4_MODELS.md](research/PHASE4_MODELS.md#model-rule-relaxed-owner-2026-10-21)).

| Question | Owner's answer |
|---|---|
| What comes next? | **Hardening and cleanup**, no visible features: Develop's GPU error guard (plain messages), the speed check, one-click rollback, and these docs brought up to date. |
| The order to 1.0 | Hardening → AI Remove → AI masks (click/hover, people/faces, sky, subject) → Lens Blur → AI Denoise → tool search → camera profiles → library gaps → 1.0. |
| AI subject/sky masks in 1.0? | **Yes**, after AI Remove and before AI Denoise. |
| Lens Blur (AI depth of field) | Queued right after the AI masks, which it needs (subject and person mattes). A Cowork patent check runs before release (Apple and Adobe hold patents in this area); then the owner decides on legal advice. Facts only, not legal advice. |
| Model rule | Relaxed (option B): weights still permissive; training data mostly named, with plain-words notes for an unpublished share or foundation model; exceptions approved one at a time (MediaPipe Selfie Multiclass approved). |
| AI Remove's download | In the app, from Hugging Face at a pinned commit (about 1.24 GB), not from GitHub Release files picked by hand. |
| Hardware before 1.0 | The owner's laptop only. |
| Lightroom interop | Ships unverified, and says so plainly. |
| Tool search naming | Typing another app's name (e.g. "Clarity", "Shadows") finds the matching LightBench tool, but results show only LightBench's own names; no other app is named in the UI. |
| Camera profiles v1 | Version 1 has all three: LightBench's own looks, with today's look kept as "Standard"; importing `.cube` looks; and reading DCP camera profiles, after a licence check. Old edits stay unchanged: an edit with no profile set means Standard. |
