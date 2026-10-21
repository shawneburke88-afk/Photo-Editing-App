# Phase 2 — Library depth

See [PLAN.md](PLAN.md#phase-2--library-depth) for the whole phase and [USABILITY.md](USABILITY.md) for the decisions behind it.

## Part 1: Open folder

**What it does.** **Open folder…** (Ctrl+O) adds a folder to the library where it is: nothing is copied. The folder is selected straight away and its photos appear in the grid as they are read, so rating and flagging can start at once. There is one library model (owner's decision after the round-2 research): an opened folder is an ordinary library folder, and every library feature works on it. Removing photos from the library never deletes files.

| Behaviour | Detail | Source |
|---|---|---|
| Background indexing | Files are found first, then read in parallel (metadata + embedded preview) by the same worker pool as Import. Results are written to the catalog in batches of up to 48, or every 0.4 s, so the grid fills in steadily. A panel in the left column shows progress and a **Stop** button. | LightBench |
| Thumbnails | From the camera's embedded JPEG. The Loupe shows the full-size embedded preview with a **Camera preview** badge; the RAW itself is rendered in Develop. | darktable's default `plugins/lighttable/thumbnail_raw_min_level = never` ("for unaltered images, use raw file instead of embedded JPEG from size") |
| Subfolders | Included in the grid by default; a **Subfolders** toggle in the filter bar shows only the selected folder. The choice is remembered in this browser. | Owner's choice. darktable's own import default is non-recursive (`ui_last/import_recursive = false`). |
| RAW + JPEG pairs | Added too, and stacked under the RAW (Part 5). The RAW owns the shared sidecar. | darktable groups such pairs with the RAW as group representative (`src/common/image.c`, `_image_import_internal`) |
| Sidecars | An existing `name.xmp` (Lightroom/LightBench) or `name.ext.xmp` (darktable) brings its rating, label, flag and LightBench edits. | As Import, Part 3 |
| Look for new photos | The **⟳** button on the selected folder adds files that appeared since. Opening the same folder again does the same. Files already in the library are skipped by path. | Lightroom's "Synchronize Folder"; darktable re-imports a film roll |
| Opening a parent folder | If the new folder contains folders already in the library, they become part of it (their photos, ratings and edits move with them), so no photo is listed twice. | LightBench |
| Permissions | Open folder asks only to read. Writing sidecars asks for write permission once per folder, through the existing banner. | Part 3 |

**Import** now only copies (from cards, with an optional backup). Its old "add in place" mode is replaced by Open folder. Every copy and backup copy is read back and checked against the card (see [Fixes from the LightCraft review](#fixes-from-the-lightcraft-review)).

**Not yet:**
- Photos deleted or moved outside LightBench stay in the library until removed (Lightroom marks them "missing"; planned).
- Reading only the embedded-preview bytes from each RAW, instead of the whole file, would make indexing faster on slow drives (also listed for Import).

**Verified** (headless Chromium, `e2e-open`):
- A folder with `day1/A.NEF`, `day2/B.NEF` + `B.JPG` and `day2/C.jpg` + `C.xmp` (3 stars, Blue) gives 3 photos, without the companion JPEG. C.jpg arrives with 3 stars and the Blue label.
- First thumbnail about 1.4 s after choosing the folder (D700 NEF, software GPU).
- Opening `day1` first and then its parent `Photos` leaves one library folder `Photos` with `day1` and `day2` and no duplicates.
- Subfolders off on `Photos` shows 0 photos (none directly in it); on shows 3.
- A file added to `day1` appears after **⟳**; a second **⟳** reports "No new photos".
- The Loupe on a RAW shows the **Camera preview** badge. The Import window has no "add" mode.

## Part 2: Full-screen culling

**What it does.** **F** (or the **Cull** button) opens the photos shown in the grid full-screen, starting at the focused one. Flags, stars and labels go to the photo on screen, never to an old selection or the photo under the mouse. darktable's default does the opposite (`plugins/lighttable/act_on`: "prioritize the hovered image over the selected images"), which the round-2 research found causing mistakes (darktable issue #6025).

| Behaviour | Detail | Source |
|---|---|---|
| Keys | P pick · X reject · U unflag · 0–5 stars · 6–9 labels · ←/→ (or Space) move · Home/End · Z or click: 100 % · C 1-up/Compare · Tab switch photo in Compare · A auto-advance · I info · D develop · Esc/G/E/F close | Lightroom keys, as in the grid |
| Auto-advance | On by default (owner's choice), with an on-screen toggle that is remembered; Caps Lock also advances, as in Lightroom. | Lightroom's Caps Lock auto-advance |
| Compare (C) | Was a plain 2-up (the photo and the next one); now Compare, see [Part 10](#part-10-compare-and-survey): a Select that stays on the left and a Candidate that the arrow keys change. The active one still has a gold outline and receives the keys; Tab or a click switches. | Lightroom Compare (owner's choice, Part 10). darktable's culling layout shows 2 images by default (`plugins/lighttable/culling_num_images = 2`) |
| Previews | The camera's embedded JPEG (badge "Camera preview"), with the grid thumbnail shown until it loads. The next two photos and the previous one are loaded in advance. | darktable's default for unedited images |
| 100 % | Always the photo itself, rendered at full resolution with its Develop settings by the same path as Export (owner's choice), so focus is judged on real pixels. Badge "100 % · full rendering". Click to zoom on a point, drag to pan, click again to fit. In Compare both photos zoom to the same spot. While the render runs (a few seconds) the fitted preview stays with a note. Renders for photos already passed are skipped. | darktable culling zoom-to-100 % (`src/dtgtk/culling.c`) |
| Filmstrip, info line, key hints | Bottom filmstrip (±20 photos) with flags, stars and labels; top line with file name, stars, flag, label, exposure, lens and capture time (I hides it); a key reminder line. | Owner's choice |
| Stable list | The photos are fixed when culling starts, so rejecting a photo while "Hide rejected" is on doesn't make it vanish mid-cull. | LightBench |

**Verified** (headless Chromium, `e2e-cull`, two NEFs and a JPEG):
- P on the first photo picked it and moved to the second; 3 rated the second and moved on; with auto-advance off, X rejected the third and stayed.
- In 2-up, Tab then 7 put the Yellow label on the right-hand photo only (re-run in Compare for Part 10: same result).
- Z rendered the D700 NEF at 100 % in 16–18 s on the software GPU used for testing; a hardware GPU is much faster (owner's GPU still to be measured). Panning works.
- After Esc the grid shows the same flags, stars and labels.

## Part 3: Keywords

**What it does.** Hierarchical keywords, stored and exchanged exactly as darktable and Lightroom do.

| Behaviour | Detail | Source |
|---|---|---|
| Storage | Paths like `Places|Canada|Ottawa`, case-insensitive (the first spelling is kept). | darktable's tag names (`src/common/tags.c`) |
| Adding | Right panel **Keywords** box, **Ctrl+K** (Lightroom's shortcut). Commas separate keywords; “>” (or “|”) makes a hierarchy: `Places > Canada > Ottawa`. Suggestions match any level of existing keywords, most-used first; ↑/↓ and Enter pick. | Lightroom keywording |
| Several photos | Applies to the selection. Keywords on only some photos show as dashed chips with a count (“Glarus 1/2”); click to add to all. × removes from all selected. | Lightroom |
| Keyword list | Left panel, under Folders: a tree with photo counts. Click shows every photo with that keyword or one below it; the filter bar shows it with × to clear. Hover × deletes a keyword (and those below it) from the library and from the photos' sidecars, after a confirmation. | Lightroom keyword list; darktable tagging dictionary |
| Search | The search box also matches keywords. | LightBench |
| Sidecars | Written as `dc:subject` (every level, once each) and `lr:hierarchicalSubject` (full paths). Read from both: every `lr:hierarchicalSubject` path, plus each `dc:subject` keyword that isn't a level of any of those paths, as a top-level keyword (so a keyword another app wrote only to `dc:subject` isn't lost). darktable's internal `darktable|…` tags are ignored, and their levels (“darktable”, “format”…) aren't added from `dc:subject`. Until the LightCraft-review fixes, `dc:subject` was read only when there was no hierarchy. | darktable `src/common/exif.cc` (`_exif_xmp_read_data` writes, `_exif_import_tags` reads), `omit_tag_hierarchy` default off |
| JPEGs | Keywords (and ratings, labels) embedded in a JPEG's own XMP are read when there is no sidecar. | Lightroom/Bridge write XMP into JPEGs |
| Older libraries | Photos added before keywords existed keep their sidecar keywords: they are read in before LightBench first rewrites the sidecar, and **⟳** (Look for new photos) reads them for a whole folder. | LightBench (schema v5 `keywords_read`) |
| Export | Keywords included by default as a flat list; **Include the keyword hierarchy** adds `lr:hierarchicalSubject`. | darktable export defaults: `DT_META_TAG` on, `DT_META_HIERARCHICAL_TAG` off (`src/common/metadata_export.c`) |

**Not yet:** renaming or moving a keyword, synonyms, "don't export" (darktable's category/private flags), keyword sets, and IPTC-IIM keywords inside JPEGs. If another app writes keyword synonyms into `dc:subject` (Lightroom can, as far as known; not checked with a Lightroom-written file), LightBench reads them as top-level keywords.

**Verified** (headless Chromium, `e2e-keywords`): a Lightroom sidecar's `Places|USA|Philadelphia` and a JPEG's embedded “Embedded” keyword were read; `Places > Switzerland > Glarus, Lake` plus a suggestion picked from “phila” were added; the sidecar got `dc:subject` [Lake, Places, Switzerland, Glarus, USA, Philadelphia] and `lr:hierarchicalSubject` [Lake, Places|Switzerland|Glarus, Places|USA|Philadelphia]; multi-select showed “Glarus 1/2”; the “Places” filter showed 2 photos; search found the JPEG by keyword; deleting “Lake” removed it from the sidecar.

## Part 4: Collections

**What it does.** Manual collections, smart collections and a Quick Collection, shown in the left panel between All Photographs and Folders. Owner's choices (2026-10-12): collection names are also saved in sidecars; Quick Collection on **B**; smart-collection rules for rating, flag, label, keyword, folder, dates, edit state and file type.

| Behaviour | Detail | Source |
|---|---|---|
| Manual collections | **+ › New collection…** (optionally with the selected photos). Add photos by dragging them onto a collection, or with the **Collections** section in the right panel (chips with ×, partial membership shown as “2/3” like keywords). Inside a collection, **Delete** takes photos out of the collection, not the library. Rename (✎) and delete (×) on hover; deleting never touches the photos. | Lightroom collections |
| Saved in sidecars | Each photo's manual collection names are written to its sidecar as `lightbench:Collections` (LightBench's own namespace; other apps ignore it). Opening the folder again in an empty library rebuilds the collections. Renaming or deleting a collection updates the members' sidecars. | Owner's choice; Lightroom keeps collections only in its catalog |
| Quick Collection | **B** adds or removes the selected photos (in the grid and the culling view); a dot marks them. Not written to sidecars: it is a temporary pile. × on hover empties it. | Lightroom's Quick Collection |
| Smart collections | **+ › New smart collection…**: “Match all / any of these rules”. Rules: rating (at least / at most / exactly), flag, colour label (is / isn't), keyword (is / isn't, including keywords below it), folder (in / not in, including subfolders), capture date and date added (in the last N days / on / after / before), edited (yes / no), file type (RAW / JPEG). A live count shows how many photos match while editing. Smart collections update themselves. | Lightroom smart collections; darktable's collect module has the same kinds of property filters (`src/common/collection.h`) combined per line with AND / OR / AND NOT |
| Safety | Rules compile to SQL with every value as a bound parameter (`catalog/smart.ts`, unit-tested). | LightBench |

Catalog schema v6: `collections` (unique names, kind manual / smart / quick, rules as JSON) and `collection_photos`.

**Not yet:** collection sets (folders of collections), a "target collection" other than Quick for B, and camera / lens / ISO rules (not chosen for this version).

**Verified** (headless Chromium, `e2e-collections`): a new collection from two selected photos wrote `Portfolio` to both sidecars; dragging the third photo added it; B put a photo in the Quick Collection and took it out again; Delete inside the collection removed a photo from it (and from its sidecar) but not from the library; a smart collection “rating at least 3” previewed and showed 1 photo; renaming to “Best” updated the sidecars; after removing every photo and the collection from the library, opening the folder again rebuilt “Best” with its 2 photos and the smart collection matched again.

## Part 5: Stacks

**What it does.** Several photos shown as one in the grid, with one on top: darktable's groups (`src/common/grouping.c`) and Lightroom's stacks. Owner's choices (2026-10-12): RAW+JPEG pairs stacked darktable-style with the RAW on top; bursts stacked on request; stacks saved in sidecars; collapsed by default.

| Behaviour | Detail | Source |
|---|---|---|
| RAW + JPEG | A JPEG with the same name as a RAW in the same folder is added and stacked under it, in Open folder (also on ⟳ for folders opened earlier) and in Import (now on by default, paired by the names on the card so renaming doesn't split them). Since the owner's first real use (2026-10-19) twins also pair across folders and imports by their names on the card and capture time; see [RAW+JPEG stacking on import](#raw--jpeg-stacking-on-import-owner-2026-10-19). | darktable import grouping (`_image_import_internal`). Lightroom's default instead hides the JPEG as an attachment; its option imports both unstacked. |
| Display | Collapsed stacks show one photo (the top one, or the first that passes the filters) with a “⧉ n” badge. Click the badge or press **S** to expand; expanded stacks show “▾ n” on the top and “◦” on the others, on a tinted background. **Stacks ▾ › Expand / Collapse all stacks**. | Lightroom stacks |
| Stack / unstack | **Ctrl+G** stacks the selection (a collapsed stack in the selection is merged whole); **Ctrl+Shift+G** dissolves the stack; **Shift+S** puts the focused photo on top. | Lightroom shortcuts |
| Auto-stack | **Stacks ▾ › Auto-stack by capture time…**: photos shown that were taken at most N seconds apart (default 2) and aren't in a stack yet. | Lightroom's Auto-Stack by Capture Time |
| Sidecars | `lightbench:Stack` (a stable id shared by the stack) and `lightbench:StackTop`. Opening the folder again in an empty library rebuilds stacks; RAW+JPEG pairs are re-paired by name. | LightBench (Lightroom and darktable keep stacks only in their databases) |
| Actions | Ratings, flags, labels, keywords and collections apply to the photos selected: on a collapsed stack, that is the top photo. | Lightroom |

Catalog schema v7: `stacks` (uid, top, expanded) and `photos.stack_id`. Removing photos tidies stacks (a stack left with one photo is dissolved; a removed top is replaced).

**Limitation:** a JPEG paired with a RAW shares the RAW's Lightroom-style sidecar name (`A.xmp`), which the RAW owns (Part 3 rule), so the JPEG's own rating or keywords are not saved in a sidecar.

**Verified** (headless Chromium, `e2e-stacks`, A.NEF+A.JPG, B.NEF, P1/P2.NEF taken at the same second): opening the folder showed 4 photos with A as a stack of 2; the badge and S expanded and collapsed it; auto-stack made 1 stack of P1/P2 (A left alone); Ctrl+G on B plus the collapsed P stack made one stack of 3; Shift+S put P2 on top and the sidecars followed; after removing everything and opening the folder again, both stacks came back (P2 on top); Ctrl+Shift+G dissolved the 3-stack.

## Part 6: Virtual copies

**What it does.** Several versions of one photo, each with its own edits, rating, labels, keywords and collections, without copying the file: Lightroom's virtual copies, darktable's duplicates. Owner's choices (2026-10-12): copies are saved inside the photo's own sidecar; each copy has a renamable name (“Copy 1”) that exports add to the file name; a copy starts from the current edit.

| Behaviour | Detail | Source |
|---|---|---|
| Make a copy | **Ctrl+'** (Lightroom's shortcut) or **Make virtual copy** in the right panel. It starts from the current edit, rating, labels and keywords, gets the next name (“Copy 1”, “Copy 2”…) and is stacked, expanded, with the original. | Lightroom Create Virtual Copy (stacked with the master) |
| Name | The right panel shows a name field for copies; names are unique per photo. Grid cells show the name. | darktable's version name (`Xmp.darktable.version_name`) |
| Saved | Inside the original's sidecar as `lightbench:Versions` (JSON: name, rating, flag, label, edit, keywords, collections), so folders stay tidy and other apps see only the original. Opening the folder again in an empty library re-creates the copies. | Owner's choice; darktable writes one sidecar per duplicate (`name_01.ext.xmp`), Lightroom keeps copies only in its catalog |
| Remove | Delete on a copy removes only that copy (and updates the original's sidecar). Removing an original also removes its copies, as Lightroom does. | Lightroom |
| Export | A copy's export gets its name appended (`DSC_0001-B&W.jpg`) unless the template already uses a version variable. Templates gain darktable's `$(VERSION)` (0 = original), `$(VERSION.NAME)` and `$(VERSION.IF_MULTI)`. | darktable `src/common/variables.c` |

Catalog schema v8: `photos.version` (0 = original) and `photos.version_name`; uniqueness is now (folder, file, version). The photos table is rebuilt with SQLite's documented procedure (foreign keys off, copy, rename, `foreign_key_check`), keeping every row and column.

**Verified** (headless Chromium, `e2e-copies`): Ctrl+' made “Copy 1” stacked with A; renaming to “B&W” and rating it 4 stars wrote `[B&W:4★]` to A.xmp; a second copy was added and deleting it removed it from A.xmp; after removing everything and opening the folder again, “B&W” came back with 4 stars in A's stack; removing A removed its copy too. Export naming is covered by unit tests (`template.test.ts`), not run end to end.

## Part 7: Copy, paste and sync settings, and a tunable Auto

**What it does.** Applies one photo's develop settings to others, choosing which settings travel, and lets Auto be tuned. Owner's choices (2026-10-12): Ctrl+C always opens the checklist; when the copied tone came from Auto, Auto is re-run on each photo by default instead of copying its numbers; a paste preview, a Sync button and Auto Sync are all included. Earlier (after round 2): Auto gets a strength slider and a choice of sliders.

| Behaviour | Detail | Source |
|---|---|---|
| Copy | **Ctrl+C** (and Lightroom's **Ctrl+Shift+C**) or **Copy…** opens a checklist grouped as White balance, Tone, Presence and Advanced (darktable modules), with each setting's value. The choice is remembered in this browser; the advanced modules are unticked by default. | Lightroom Copy Settings; darktable "selective copy" (`src/libs/copy_history.c`) |
| Paste | **Ctrl+V** (or Ctrl+Shift+V) or **Paste…** first shows a preview of what will change, with **Choose settings…** to adjust it. In the Library it pastes onto every selected photo; in Develop onto the photo shown (Sync covers the others). Pasting replaces only the chosen settings and adds one “Paste settings” step to each photo's history, so it can be undone there. | Lightroom Paste Settings. darktable's default paste appends to the history instead (`plugins/lighttable/copy_history/pastemode` = 0) |
| Auto re-run | If the copied tone came from Auto, **Re-run Auto on each photo** (on by default) runs the same look, strength and sliders on each photo's own pixels, so each gets its own values. Unticking it copies the numbers. | Owner's choice |
| White balance | “As Shot” travels as a mode, so each photo keeps its own camera white balance; a custom temperature/tint is copied as numbers. | Lightroom; round 2, lesson 12 |
| File types | The advanced darktable modules (base exposure, sigmoid, highlight reconstruction, demosaic) only go to photos of the same type (RAW to RAW, JPEG to JPEG); the dialog says when they will be skipped. | darktable's RAW and JPEG defaults differ (+0.7 EV base exposure for RAW only) |
| Sync | **Sync…** (Library right panel, Develop toolbar) or **Ctrl+Shift+S** applies settings from the photo with the focus to the other selected photos, with the same checklist. In Develop, Ctrl+click photos in the filmstrip to add them to the selection (Shift+click for a range); the selection starts as the Library's. | Lightroom Sync Settings |
| Auto Sync | A checkbox next to Sync in Develop: each change to the photo shown also goes to the other selected photos, about 0.7 s after the last change; Auto changes re-run Auto on each photo. Off each time Develop opens. A badge shows it is on. | Lightroom Auto Sync |
| Background work | Paste and Sync develop each photo in the background (decode, Auto if asked, history step, thumbnail, sidecar) with a progress box and **Stop**, then a summary with any problems. Develop stays usable meanwhile. | — |
| Auto options | Under **Auto options**: **Strength** 0–150 % (how far Auto moves its sliders; double-click resets to 100 %) and which sliders Auto may change (Exposure, Contrast, Highlights, Whites, Blacks, Vibrance). Changing them re-runs Auto on a photo whose tone came from Auto. With some sliders unticked, Auto leaves those and Shadows as they are. | Owner's choice (round 2) |
| Auto record | A photo remembers the Auto that set its tone (look, strength, sliders), shown under the Auto button, saved in the edit and its sidecar. Moving one of those sliders by hand ends the record, so a later copy pastes numbers. | — |

**Verified** (headless Chromium with software WebGPU, `e2e-paste`):
- Auto on A, then Ctrl+C: the dialog listed the settings with A's values and offered “Re-run Auto on each photo — Natural, 100 %”.
- In the Library, B.NEF and C.JPG were selected and Ctrl+V pressed. The preview listed the Auto re-run, white balance As Shot, Shadows and Saturation.
- Paste finished in 21 s for the two photos (software GPU). Each got its own Auto result: A Exposure +0.75 / Blacks −85; B −0.20 / −4; C −0.20 / −5. C kept the JPEG base exposure 0. All three show the edited badge, and their sidecars hold the Auto record.
- Develop on A with B selected: Sync of Saturation −40 reached B.xmp. Auto Sync of Saturation +25 reached B.xmp.
- Strength set to 50 % re-ran Auto on A (Blacks −85 → −42). Moving Exposure by hand then cleared the Auto record.
- Unit tests: `paste.test.ts` (choice, As Shot mode, file-type skipping, Auto keys, changed keys) and `auto.test.ts` (slider choice, strength, Shadows rule).

**Limitations:**
- Paste in the Library goes to the selected grid cells. A collapsed stack contributes only its top photo, so expand it to paste onto all of its photos.
- If a background paste changes the photo open in Develop while it has unsaved changes, Develop's own save comes last and wins.
- The copied settings last for this visit only; they are not kept after reloading the page.
- The checklist covers today's Basic panel and advanced modules. Phase 3 tools (crop, curves, masks…) will join it as they are built.
- Re-running Auto takes several seconds per photo on the software GPU used for testing. It still needs measuring on the owner's GPU.

## Part 8: Presets

**What it does.** Saves chosen develop settings under a name and applies them to one photo or many. Owner's choices (2026-10-12):
- A preset holds the settings ticked when it was saved (the same checklist as Copy).
- It is applied with an **Amount** from 0 to 200 %, previews on **hover**, and a few **starters** are included.
- One preset can be chosen to **develop new photos** when a folder is opened or imported.
- darktable-style rules by camera, lens or ISO were not chosen for now.

| Behaviour | Detail | Source |
|---|---|---|
| Presets panel | Develop's left panel, above History, as in Lightroom. Groups: **My presets**, then **Starters**. | Lightroom Develop Presets panel |
| Hover preview | Hovering a preset (or tabbing to it) shows the photo and histogram with it applied and a “Preview: …” badge; the sliders don't move until it is clicked. A preset that runs Auto previews only its other settings. Switches that need the RAW reprocessed (highlight reconstruction, demosaic) aren't previewed. | Lightroom (preview in the Navigator); owner's choice |
| Apply | Click: adds one “Preset: name” history step. Only the settings the preset holds change; RAW-only advanced settings skip JPEGs, as with Paste. | Lightroom; Part 7 |
| Amount | After applying, an **Amount** slider (0–200 %, double-click for 100 %) moves each setting between the photo before the preset (0 %) and the preset (100 %), or beyond it (200 %), within each slider's range. It changes the same history step rather than adding steps. It goes away once the photo is changed another way. White balance blends in mireds (temperature) and log steps (tint). Sliders set by an Auto in the preset scale from 0, so the Auto record stays true (50 % = Auto at half strength). | Lightroom's preset Amount; owner's choice |
| New preset | **New preset…** opens the Copy checklist with a name field. The settings that differ from the defaults are ticked. If the tone came from Auto, **Run Auto on each photo** is offered, so the preset runs Auto (look, strength, sliders) on each photo instead of storing numbers. | Lightroom New Develop Preset |
| Delete | ✕ on hover, for your own presets (starters can't be deleted). Photos it was applied to keep their settings. | — |
| Starters | Auto tone (Natural), Black & white (Saturation −100), Punchy, Soft, Bright & airy. They are starting points chosen by eye, not standards. More will come with the Phase 3 tools. | Owner's choice |
| Library | **Apply preset…** in the right panel's Develop settings applies one to the selected photos in the background (Part 7's progress box). | Lightroom Quick Develop “Saved Preset” |
| New photos | **Develop new photos with** (Library left panel, and the Import dialog's Develop settings) picks a preset for photos added by Open folder or Import. Photos that already have edits (e.g. from their sidecars) are left alone and counted in the summary. Remembered in this browser. | Lightroom Import “Develop Settings” |
| Storage | Your presets are in the catalog (schema v9, `presets` table, as JSON). The starters are in the code. | — |

**Verified** (headless Chromium with software WebGPU, `e2e-presets`):
- **New photos:** with “Punchy” chosen, Open folder of A.NEF, B.NEF and C.JPG developed all three in the background (“Preset: Punchy: 3 photos updated”). A.xmp and C.xmp hold Contrast +25, Whites +10, Blacks −10, Vibrance +30.
- **Hover and Amount:** hovering “Black & white” showed the photo in black and white with a “Preview” badge while the Saturation slider stayed at 0; leaving removed the badge. Clicking “Soft” set Contrast −20, Shadows +20, Saturation −10. Amount 50 % gave Contrast +3 (between Punchy's +25 and Soft's −20), Highlights −10, Shadows +10, Saturation −5, with one “Preset: Soft” history step. Moving a slider by hand removed the Amount slider.
- **New preset and Library apply:** New preset… ticked the seven changed settings; “Muted” was saved and listed under My presets. Applied from the Library to B and C, both sidecars got its values.
- **Auto tone starter:** set Exposure +0.75 / Blacks −85 with the Auto note at 100 %. Amount 50 % gave +0.38 / −42 and “at 50 %”.
- **Delete:** deleting “Muted” left only Starters.
- **Unit tests:** `presets.test.ts` (holds only its settings, Amount and ranges, Auto scaling, white balance blend, JPEG skipping, saved rows) and `history.test.ts` (replacing the current step).

**Limitations:**
- Presets live in this browser's catalog. There is no export or import as files yet, and clearing the browser's storage removes them.
- Renaming a preset and updating it with the current settings aren't in the UI yet. To change one, delete it and save it again.
- Developing new photos decodes each RAW to refresh its thumbnail, so a large folder takes a while (in the background, with Stop).
- The hover preview doesn't run Auto or reprocess the RAW stage (highlight reconstruction, demosaic).

## Part 9: Installable, offline app (PWA)

**What it does.** LightBench can be installed as an app (the install button in Chrome or Edge's address bar) and works without a connection after the first visit. Owner's choices (2026-10-12): the icons come from the existing brand mark; every file of the app is stored for offline use, including the WebAssembly decoders and the workers (photos and the catalog were already on the user's computer); an update downloads in the background and waits behind an **Update ready** notice with the new version's notes and a **Reload** button, so nothing changes until it is clicked; and the installed app opens RAW and JPEG files from the computer's file manager. The library works on folders, so a launched photo brings up a dialog with **Open its folder…**, which opens the photo's folder like Open folder and then shows the photo.

| Behaviour | Detail | Source |
|---|---|---|
| Install | `public/manifest.webmanifest`: name, standalone window, dark theme colour, icons at 192 px, 512 px, maskable 512 px and the SVG favicon, plus an Apple touch icon. The PNGs are generated from `public/favicon.svg` by `scripts/build-icons.mjs` (the same drawing, no new artwork). All paths are relative, so the app works under `/Photo-Editing-App/`. | W3C Web App Manifest |
| One service worker, two jobs | Only one service worker can control the site, so `src/pwa/sw.ts` replaces coi-serviceworker. It adds `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Resource-Policy: cross-origin` to every response it serves (from its cache or the network), as coi-serviceworker did, and serves the app from its cache. It is hand-written rather than built with vite-plugin-pwa/Workbox: the headers have to be added to every response, cached ones included, and the precaching needed is about 60 lines. | coi-serviceworker 0.1.7 (MIT); its header logic is reproduced |
| What uses isolation today | Nothing requires it yet. LibRaw and jpegli are single-threaded builds, and the catalog uses SQLite's `opfs-sahpool` storage, which works without SharedArrayBuffer. Isolation provides SharedArrayBuffer (for WebAssembly threads later, e.g. multi-threaded jpegli) and finer `performance.now()` timing for System Check. With it, SQLite also starts its unused `opfs` storage and the `sqlite3-opfs-async-proxy` worker, which is stored for offline use too. Isolation is kept exactly as before. | PHASE0.md; JPEG encoder benchmark |
| First visit | The worker stores all 21 files of the build (about 3.3 MB), takes control, and the page reloads once to become isolated, as with coi-serviceworker. The difference is that the reload comes after the download instead of straight away. Until then the page works, without isolation. | coi-serviceworker |
| Offline | One cache per build (`lightbench-<hash>`). At build time `sw-plugin.ts` lists every file in `dist/` with a SHA-256 of its contents. At install each file is downloaded past the browser's HTTP cache and must match, so a deploy still in progress can't mix two versions (the install fails and is retried later). Opening the app always gets the stored page. | LightBench |
| Updates | The browser checks `sw.js` on each visit, and the app checks again every hour. Any change to any file changes `sw.js`. A new build installs in the background and waits. The notice shows its version and the release notes the running version doesn't have. **Later** hides it until the next start; **Reload** activates the new version and reloads. Another open window is told “LightBench was updated in another window”. Old caches are deleted when the new version takes over. | LightBench |
| Release notes | `src/pwa/release-notes.json`, newest first. Each release has **New features** and **Bug fixes** (owner's release rules, PLAN.md “Every release”). The first entry must match `package.json`'s version (unit test). This release is the first entry, 0.1.0 (`package.json` moved from 0.0.1). The build copies the list into `sw.js`, so the notice can show notes the running version has never seen. A deploy without a new entry says “No release notes for this update.” | Owner's release rules |
| Moving from coi-serviceworker | The new worker has the same scope and a new script URL, so the browser replaces the old worker in the existing registration. Because the worker it replaces is coi-serviceworker (which has no cache), the new one takes over at once, without a notice. The page was already isolated, so it doesn't reload either. `coi-serviceworker.min.js` and its npm package are removed. | Service Workers spec (registering a new script URL for a scope) |
| Open with LightBench | Manifest `file_handlers`: `.jpg`/`.jpeg` as `image/jpeg`, and every RAW extension the decoder reads (`RAW_EXTENSIONS`, checked by a unit test) as `image/x-dcraw`, the freedesktop.org type for camera RAW. `launch_handler` asks Chrome to reuse an open window. The app's `launchQueue` consumer (`src/pwa/launch.ts`) keeps the RAW/JPEG files, and the Library shows **Open “name”** with **Open its folder…**. The folder picker starts at the launched file (`startIn`) and asks only to read. The chosen folder must contain the photo (otherwise: “… is not in …. Choose the folder that contains it.”). It is opened by the same indexer as Open folder, the photo's own folder is selected, and the photo is focused and selected once indexed. A JPEG stacked under its RAW has its stack expanded. | Chrome File Handling API |
| Dev server | `npx vite` registers no service worker: the dev server sends COOP/COEP itself. | As before |

**Verified** (headless Chromium 141 via Playwright, scratch script `e2e-pwa`, 56 of 56 checks passed). The production build was served by `http-server` under `/Photo-Editing-App/` with no COOP/COEP headers and `max-age=600`, like GitHub Pages:
- First visit: the service worker installed and took control, and the page reloaded exactly once and was `crossOriginIsolated`. The Library showed “Your library is empty”.
- Chrome's own manifest check (`Page.getAppManifest`) found no errors, and Chrome reported no installability errors (`Page.getInstallabilityErrors`). All four icons were served.
- The registration scope was `/Photo-Editing-App/`, with one cache holding all 21 built files: the LibRaw, SQLite and jpegli `.wasm` files, all workers, `index.html`, the manifest and icons.
- Offline (`context.setOffline(true)`, and the files also removed from the server): reloading still showed the Library (the SQLite catalog opened) and the page was still isolated. All three `.wasm` files compiled, and the LibRaw decoder worker read a Nikon D700 NEF (camera and 1.4 MB preview returned).
- Open with LightBench, offline: headless Chromium can't be launched from the OS, so a stand-in `launchQueue` captured the app's consumer and the test called it with a file handle; a stand-in folder picker returned folders in the browser's private storage. The dialog named the file. A folder without the photo was refused with the message. The picker was asked to start at the launched file, read-only. With the right folder, the NEF was indexed (thumbnail from LibRaw) and focused. Launching the JPEG of the same name expanded its RAW+JPEG stack and focused it. No indexing failures.
- Update (a second build with version 0.1.1 and test notes): “Update ready” appeared with “Version 0.1.1+…” and the test notes under New features and Bug fixes, without the 0.1.0 notes. Later hid it. A normal reload kept the old version, and the notice came back. Reload switched to the new version (one navigation), still isolated; only the new cache remained, and the library was still there.
- Moving from coi-serviceworker: a profile running the current `main` build (coi-serviceworker in control, isolated) loaded the new build. `sw.js` took over without a reload or a notice and the page stayed isolated, with one registration and nothing waiting. It then worked offline.
- `npx vite` (dev): isolated by the server's headers, no service worker registered, no console errors. `vite preview` with the base path: service worker active at `/Photo-Editing-App/sw.js`, isolated.
- Unit tests (`pwa.test.ts`): the release notes match `package.json` and have both groups; only unseen releases are shown; the manifest's paths are relative and its icons exist; `file_handlers` lists exactly the decoder's RAW extensions plus JPEG; the launch consumer keeps only RAW/JPEG files.

**Limitations:**
- Not tested in a real installed app: installing, Windows' “Open with”, and the OS launching the app with files can't be done headless. The owner should check them on Windows with Chrome or Edge (Chrome may ask once whether LightBench may open these file types).
- Not tested on the live GitHub Pages site, or in Safari or Firefox. coi-serviceworker switched to COEP `credentialless` in browsers that are neither Chromium nor Firefox (in practice Safari), using a setting sent by the page that was lost whenever the worker restarted. The new worker always uses `require-corp`, coi-serviceworker's default. LightBench loads nothing from other sites, so this only affects whether Safari becomes isolated; unverified.
- The browser also applies a waiting update by itself once every LightBench window has been closed (its own rule). The new version then starts without the notice having been shown.
- Every deploy to `main` is an update (the version includes the commit), so the notice also appears for deploys without new notes.
- A window still on the old version after another window updated may fail to load parts it hadn't used yet if it is offline (the old cache is gone). Its notice asks it to reload.
- GitHub Pages lets browsers reuse a page for up to 10 minutes, so a user moving from coi-serviceworker may get the old page during those minutes; the move then happens on a later visit.
- “Rollback: the previous website version stays one click away” (PLAN.md) is not part of this.

## Part 10: Compare and Survey

**What it does.** Two more ways to choose between photos, both inside the culling view. Owner's choices (2026-10-12):
- **Compare** replaces culling's 2-up (one place, not two). The left photo is the **Select** (the current best) and stays put; the right is the **Candidate**, and the arrow keys step it through the other photos. **Swap** exchanges them; **Make Select** (the Candidate wins) makes the Candidate the new Select and moves the Candidate on.
- **C** in the grid opens culling straight in Compare, with the focused photo as the Select and the next photo as the Candidate (the next *selected* photo when several are selected). Inside culling, C still switches between one photo and Compare.
- **Survey (N)** shows only the **selected photos**, tiled at the largest size that fits. Each tile has its flag, stars and label and an **✕** that drops it from the survey (never from the library or a collection). Clicking a tile (or Enter) shows it 1-up; Esc goes back to the survey; Esc or G from the survey goes back to the grid with the photos still in the survey selected.
- Culling's guarantees stay: keys go to the photo on screen, the active pane or the active tile (never the photo under the mouse), and the list of photos is fixed when the view opens.

| Behaviour | Detail | Source |
|---|---|---|
| Compare keys | ←/→ (or Space) next / previous Candidate, Home/End first / last; **↑ Make Select**, **↓ Swap**; Tab switches the active pane; Z or click 100 %; C one photo (the active pane's photo); Esc closes. Buttons **⇄ Swap** and **Make Select** in the top bar. The panes are labelled Select and Candidate. | Lightroom Classic's Compare keys as given by third-party shortcut lists and Julieanne Kost's blog (↑ “make next photos select and candidate”, ↓ “swap select and candidate”). Adobe's own pages could not be opened from the build environment, so this is **not checked against Adobe directly**. |
| Stepping | The Candidate steps over the Select and stops at either end of the list (no wrap-round). Make Select takes the photo after the new Select as the Candidate (the one before it at the end of the list), which can be the old Select. | LightBench (`compare.ts`, unit-tested) |
| Which photos | Compare steps through the photos the culling view opened with (the photos shown in the grid, as F does). With several selected, only the first Candidate comes from the selection. | Owner's choice for the first Candidate; stepping through all photos is LightBench's choice |
| Keys go to the active pane | Flags, stars, labels and B go to the photo in the gold-outlined pane (the Select at first). Auto-advance: a key on the Candidate moves the Candidate on; a key on the Select moves nothing (the Select stays put). Caps Lock as before. | LightBench's choice (Lightroom's behaviour here not checked) |
| Filmstrip in Compare | Both photos are marked; clicking another photo makes it the Candidate. | LightBench's choice |
| 100 % in Compare | Unchanged from Part 2: both panes zoom to the same spot and pan together, each rendered at full resolution (`FullRenderer`). | Part 2 |
| Survey (N) | The selected photos, in grid order, with the focused one active. A **Survey** button in the filter bar too (and **Compare** next to **Cull**). With fewer than 2 selected, nothing opens and a message says “Survey shows the selected photos: select two or more (Ctrl+click or Shift+click), then press N.” C with fewer than 2 photos shown says “Compare needs at least two photos.” | Owner's choice (Lightroom Survey). darktable's “culling dynamic mode” (Ctrl+X) also shows exactly the selected images and logs “no image selected!” without a selection (`src/dtgtk/culling.c`, `dt_culling_init`; shortcut in `src/libs/tools/lighttable.c`) |
| Tiling | Equal tiles; every column count is tried and the one that shows the most image area wins (each photo fitted in its tile, using its preview's shape, or 3:2 / 2:3 from its orientation until loaded). A shorter last row is centred. | LightBench (`survey.ts`, unit-tested). darktable packs tiles by aspect ratio instead, stacking short images beside tall ones (`_thumbs_compute_positions` in `src/dtgtk/culling.c`) |
| Survey keys | Arrows, Tab and Shift+Tab move the active tile (↑/↓ by a row); P/X/U, 0–5, 6–9 and B apply to it (no auto-advance in Survey); Enter or click: 1-up; **Delete** or **✕** drops the active tile from the survey (the last tile can't be dropped); C: Compare with the active tile as the Select; D develop; I info; Esc, G or N (also E, F): back to the grid. | Flag/star/label keys as in the grid. Delete for “drop” is LightBench's choice. |
| Dropping | ✕ only takes the photo out of the survey, so it is not selected when going back to the grid. | Owner's choice. darktable's dynamic mode likewise follows the selection (`_dt_selection_changed_callback` in `src/dtgtk/culling.c`) |
| From the survey | 1-up and Compare work on the photos still in the survey; Esc (or N) goes back to the survey; G, E, F and ✕ Close go straight to the grid with the survey's photos selected. Develop (D) keeps that selection too. | LightBench |
| Previews | Tiles use the same preview path as culling (the camera JPEG or the JPEG itself, with the grid thumbnail until it loads), scaled down to 2048 px on the long side for up to 6 photos, 1280 px up to 16, 768 px up to 40 and 512 px beyond, to keep memory down. | LightBench |

**Verified** (headless Chromium with software WebGPU, scratch script `e2e-compare-survey`, with A.NEF (D700), B.NEF and D.NEF (D80), C.jpg and E.jpg sorted by name; 37 of 37 checks passed):
- **C from the grid** with A focused and C also selected opened Compare with Select A and Candidate C, labelled. → gave D; ←← gave B; another ← stayed on B (A is the Select).
- **↓** swapped to B / A and the **⇄ Swap** button swapped back. **↑** (Make Select) gave B / C and the **Make Select** button gave C / D (“Select 3 · Candidate 4 of 5”).
- **Active pane:** Tab, then P picked D and auto-advance moved the Candidate to E; Tab back, then 2 rated C and the Candidate stayed on E. After Esc the grid showed D picked, C with 2 stars, and A, B and E untouched.
- **Synced 100 %:** with C.jpg as the Select and D.NEF as the Candidate, clicking a point on the Select rendered both panes at 100 % (“100 % · full rendering” on both) in 16 s on the software GPU; dragging on the right pane panned both.
- C with only B selected opened B / C; C inside switched to 1-up on B and back to Compare.
- **N with 1 selected** opened nothing and showed the message.
- **Survey** of A, B, D and E (E focused) showed 4 tiles, 2 × 2 at 708 × 401 px in a 1440 × 900 window, with E active. **✕** on B left A, D and E, E still active; ← then 4 gave D 4 stars, on its tile only. Clicking A showed it 1-up (“1 of 3”); Esc returned to the 3-tile survey with A active; Enter showed A 1-up again and N went back; Esc gave the grid with A, D and E selected (not B), D with 4 stars and still picked.
- The **Survey** button reopened it; Home then Delete dropped A; G gave the grid with D and E selected and all 5 photos still in the library.
- Screenshots of Compare, Compare at 100 % and Survey were checked by eye.
- Part 2's culling script, re-run: auto-advance, X without advance, Tab + 7 in Compare on the right-hand photo, the 100 % render (17 s) and the grid afterwards all as before.
- Unit tests: `compare.test.ts` (start, stepping over the Select and at the ends, Swap, Make Select, the first Candidate from the grid's selection) and `survey.test.ts` (column choice for wide and tall screens, portrait photos and gaps; orientation guess; active tile after a drop).

**Limitations:**
- The Lightroom key mapping (↑ Make Select, ↓ Swap) comes from secondary sources, not Adobe's own page (see the table).
- Compare always shows two photos.
- Survey previews are sized for the number of photos when it opens; after dropping many tiles the remaining ones can look slightly soft until the survey is opened again.
- Survey was tested with 4 photos. With dozens, the tiles are small and a preview is loaded for each.
- Not tested on the owner's GPU or with a touch screen.

## Part 11: Metadata, metadata presets and import presets

**What it does.** Title, caption, creator, copyright and location can be edited in the Library, saved in the sidecars, read back from them and included in exports. Metadata presets fill in several fields at once, also on new photos, and import presets save the Import window's options under a name. Owner's choices (2026-10-12):
- The "core set" of fields: Title, Caption, Creator, Copyright, Copyright URL, Headline, City, State / Province, Country, in the standard XMP properties Lightroom, darktable and Bridge read.
- Edited in a **Metadata** section of the Library's right panel. With several photos selected, fields that differ show as mixed (Lightroom's `< mixed >`), and only fields that are edited are written to all of them.
- Metadata presets hold chosen fields, are applied to the selected photos, and one can be picked to **fill in new photos** (next to "Develop new photos with"). Fields a new photo already has (e.g. from its sidecar) are not overwritten. Presets can be deleted.
- `{year}` in a preset becomes the photo's capture year.
- Import presets hold the destination, renaming, backup, RAW + JPEG option and the develop and metadata presets for new photos.

| Behaviour | Detail | Source |
|---|---|---|
| XMP properties | Title `dc:title`, Caption `dc:description` and Copyright `dc:rights` are language alternatives (`rdf:Alt`, written as the default language `x-default`); Creator `dc:creator` is an ordered list (`rdf:Seq`); Copyright URL `xmpRights:WebStatement`, Headline `photoshop:Headline`, City `photoshop:City`, State / Province `photoshop:State` and Country `photoshop:Country` are plain text. | Owner's list. darktable's own metadata fields are `Xmp.dc.creator`, `.publisher`, `.title`, `.description` and `.rights` (`src/common/database.c`, `_upgrade_data_schema_step`); it writes them through exiv2 (`_set_xmp_dt_metadata`, `src/common/exif.cc`) and skips exiv2's `lang=` prefix when reading them (`_exif_decode_xmp_data`), i.e. language alternatives. The `photoshop:`/`xmpRights:` properties, their namespaces and the `rdf:Seq`/`rdf:Alt` types are the IPTC Core mapping as LightBench understands it: **not re-checked** against the IPTC standard, which couldn't be fetched from the build environment. |
| Editing | Library right panel, **Metadata**, under Collections. Enter or leaving a field saves it (Shift+Enter makes a new line in Caption); Esc undoes the typing. Each field's tooltip says what it is for. | Lightroom's Metadata panel |
| Several photos | A field that differs shows `< mixed >`. Typing in it and pressing Enter sets that field on every selected photo; the other fields are left alone. Delete (or Backspace) on a mixed field, then Enter, clears it on all of them. | Lightroom |
| Several creators | Names separated by “;” are separate entries in `dc:creator`; entries written by other apps show joined by “; ”. | LightBench |
| Sidecars | Written by the existing sidecar sync, and only when a value changed. Changing a title, caption or copyright replaces its default language and keeps the others; clearing a field removes the property. Text values are written as elements, so line breaks survive. Other apps' properties are kept, as before. | LightBench; keeping other apps' fields as darktable does |
| Reading | From the sidecar, or a JPEG's own XMP when it has no sidecar, when photos are added by Open folder, Import or ⟳, and when the folder is opened again after removing the photos. The default language is preferred, else the first one. | As keywords (Part 3) |
| Older libraries | Photos added before this version read their sidecar's metadata before LightBench first rewrites the sidecar, and ⟳ reads it for a whole folder. A value already set in LightBench wins. | As keywords (Part 3): schema v10 `metadata_read` |
| Camera EXIF | When a photo is added, the camera's Artist, ImageDescription and Copyright fill Creator, Caption and Copyright where the sidecar leaves them empty. RAW files: Artist and ImageDescription through LibRaw (its `imgother` has no copyright field). JPEGs: all three, from LightBench's EXIF reader (UTF-8 when valid). Values that are only spaces are ignored. These values count as already set, so a preset for new photos doesn't replace them. | darktable `_exif_decode_exif_data` (`src/common/exif.cc`): Artist → `Xmp.dc.creator`, ImageDescription → `Xmp.dc.description`, Copyright → `Xmp.dc.rights`. darktable also takes UserComment before ImageDescription and Canon OwnerName when there is no Artist; LightBench doesn't. |
| Virtual copies | A copy starts with its original's metadata and then has its own, saved with the copy in the original's sidecar (`lightbench:Versions`). | Lightroom virtual copies have their own metadata |
| Search | The search box (“Search name, keyword, title…”) also matches title, caption and creator. | LightBench |
| Export | **Title, caption, creator, copyright and location** under Include, on by default (export settings saved earlier count as on), written as XMP like keywords. | darktable's default export flags include `DT_META_METADATA` (`src/common/metadata_export.c`, `dt_lib_export_metadata_default_flags`) |
| Metadata presets | **Presets ▾** in the Metadata section: click a preset to apply it to the selected photos (its fields are replaced), × deletes it after a confirmation, **New preset…** asks for a name and which fields it sets, starting from the selected photos' common values. Saving under an existing name replaces that preset. | Lightroom metadata presets |
| `{year}` | Becomes the year the photo was taken. Without a capture date, the file's date is used, as Import does for its dated folders; with neither, `{year}` is left as typed. Upper or lower case. | LightBench |
| New photos | **Fill in new photos with** (Library left panel, and the Import window's **Apply during import**, renamed from "Develop settings") picks a preset for photos added by Open folder or Import. It is applied after the sidecar and camera EXIF are read, to empty fields only, and their sidecars are written. Remembered in this browser. | Lightroom Import "Metadata" |
| Import presets | **Import preset** at the top of the Import window's options: choose one, **Save…** (a name; an existing name is replaced), **Delete**. A preset holds the destination, file names (kind, text, first number), backup on/off and its folder, the RAW + JPEG option, and the develop and metadata presets for new photos. Folders can't be stored in the catalog, so they are kept in the browser's folder store under the preset; choosing the preset asks for permission to them again. Changing an option by hand shows "Choose a preset…" again. The develop and metadata choices are the same settings as in the Library's left panel. | Lightroom Import Presets |
| Storage | Catalog schema v10, added without rebuilding any table: `photo_metadata` (one row per photo with metadata, removed with the photo), `photos.metadata_read`, `metadata_presets` and `import_presets` (unique names, JSON). | — |

**Verified:**
- **Unit tests** (`npx vitest run`, 164 passing): `xmp.test.ts` writes and reads every field (language alternative, ordered list, plain text), escapes `<`, `&` and quotes, keeps a line break, reads attribute and element forms and the default language, keeps a German title and another app's `photoshop:SupplementalCategories` and `crs:` values when the title changes, removes cleared fields, leaves metadata alone when not given, rewrites nothing when unchanged, and keeps a copy's metadata in `lightbench:Versions`. `library/metadata.test.ts`: mixed values, creator lists, `{year}` (capture year, file-date fallback, left as typed, grouping photos by year), presets from catalog rows. `export/metadata.test.ts`: fields included by default, off when unticked, on for older settings, a packet for metadata alone. `exif.test.ts`: Artist, Copyright and ImageDescription from a JPEG, blank values ignored, UTF-8.
- **Upgrade from v9** (headless Chromium, `e2e-upgrade`, one browser profile): `origin/main` (schema v9) opened A.NEF, B.NEF + B.xmp (another app's `dc:title` “Lake Glarus”, `dc:creator`, `photoshop:City`, a `crs:` value) and C.JPG + C.xmp (`dc:description`); A got 3 stars and keyword “Old”, B 4 stars (its sidecar was rewritten by v9, keeping the title). This branch then opened the same catalog: 3 photos, A with 3 stars and “Old”, B with 4 stars, no catalog error. B's title was empty until its sidecar was next written: after rating it 5, the panel showed “Lake Glarus”, “Sidecar Creator”, “Glarus”, and B.xmp still held them and the `crs:` value. C's caption appeared after ⟳.
- **Editing** (`e2e-metadata`, A.NEF, B.NEF + B.xmp as above with a German title, C.JPG): on A, all nine fields were typed (caption on two lines, `<` and `&` in the values, creator “Ann Smith; Bo Lee”); A.xmp held them as language alternatives, a two-item `rdf:Seq` and elements, escaped. With A and B selected, all nine showed `< mixed >`. Typing in Title then Esc left it mixed. Country “Earth” went to both sidecars and nothing else changed; Delete + Enter on the mixed Headline removed it from A.xmp. B.xmp kept its German title, `photoshop:SupplementalCategories` and `crs:` value throughout.
- **Preset with `{year}`**: “Copyright” (Creator “Ann Smith”, Copyright “© {year} Ann Smith”, a Copyright URL; the dialog started with Country ticked, the only common value) applied to B and C: “applied to 2 photos”; B.xmp got “© 2010 Ann Smith” (taken 2010) and Creator replaced; C.JPG, with no capture date, got “© 2026 Ann Smith” from its file date (2026).
- **Search**: “Fountain” (A's title) 1 photo, “Ann Smith” 3, “Line two” (A's caption) 1, “Lake Glarus” 1.
- **Export**: the option was shown and ticked; the exported A.jpg's XMP held the title, two-line caption, both creators, copyright, URL, city, state and country.
- **Virtual copy**: Ctrl+' on A started the copy with A's values; titling it “Copy title” wrote it into A.xmp's `lightbench:Versions` while A's own title stayed “Fountain”.
- **Remove all + reopen with a preset for new photos**: with “Fill in new photos with: Copyright” and a new D.NEF (no sidecar), every photo was removed and the folder opened again. A came back with all its values, including its own Creator, Copyright and URL (not replaced by the preset); B and C with theirs; the copy with “Copy title”; D got the preset (“© 2010 Ann Smith”) and D.xmp was written.
- **Import presets**: in Import from card, destination “Pictures”, “Custom name + number” “Trip” from 5, backup to “Backup”, develop “Punchy” and metadata “Copyright” were saved as “Card to Pictures”. After changing all of them by hand the menu read “Choose a preset…”; choosing the preset restored every option. After closing and reopening the window it was still listed and restored them again. Importing DSC_0100.NEF (with develop set back to none) gave `Pictures/2016/2016-09-22/Trip_0005.NEF`, the original in the dated backup folder, and `Trip_0005.xmp` with “© 2016 Ann Smith”. Delete removed the preset; deleting the metadata preset left “No metadata presets yet”.
- Screenshots of the Metadata panel (one and several photos), the preset dialog and menu, and the Import window's preset row were checked by eye; a wide preset row overflowing the options column was fixed.
- `npx tsc -b`, `npx oxlint` (only the two existing warnings), `npm run build`.

**Limitations:**
- The XMP mapping wasn't checked against the IPTC standard or against Lightroom itself (neither available here); only darktable's source was. The test sidecars imitate other apps' files; no file written by Lightroom or Bridge was used.
- Only the default language of a title, caption or copyright is edited; other languages are kept as they are.
- The camera EXIF fill wasn't seen with real values end to end: the two test NEFs have no Artist or ImageDescription text. The JPEG path is unit-tested; the RAW path relies on LibRaw's fields.
- Exports carry the fields as XMP only. darktable also writes Artist, ImageDescription and Copyright into the exported file's EXIF (`dt_exif_read_blob`); LightBench's EXIF writer is ASCII-only, so “©” would be lost there, and this was left out.
- Metadata changes have no undo (the history is for develop settings). Metadata presets don't hold keywords, contact details or other IPTC fields.
- Import presets don't remember the source (it changes with each card). In the tests the folders were in the browser's private storage, which never asks for permission, so the permission prompt on choosing a preset wasn't seen; it needs checking on Windows.
- Presets live in this browser's catalog: no export or import as files yet.

## Part 12: Keyboard and display settings

**What it does.** A **Settings** window with **Keyboard** and **Display** sections, where every shortcut can be changed and the interface size and the background behind photos can be chosen. Owner's choices (2026-10-12):
- One Settings window, opened with the **gear** at the right of the top bar or **Ctrl+,**. It is built as a list of sections so later preferences can be added. Settings are remembered in this browser (not in the library or the photo folders), and the window says so.
- Every shortcut can be changed. Two shortcut sets: **LightBench** (today's keys) and **Lightroom Classic** (Lightroom's key wherever LightBench differs). Any change is saved as **Custom**, based on the set it started from.
- Keys follow the letter printed on the key, also on non-US keyboards. No shortcut runs while typing in a text box or while a dialog is open.
- Full keyboard access through three things (not panel jumping): a **shortcut list on ?**, **command search on Ctrl+Shift+P**, and **slider keys**.
- **Interface size** 90 / 100 / 110 / 125 / 150 %, also with **Ctrl+Alt+=** and **Ctrl+Alt+−**, with the photo kept sharp. **Background behind photos**: Black, Dark grey (as before) or Mid grey. No high-contrast theme (not chosen).

Lightroom sources: Adobe's help site (helpx.adobe.com) could not be opened from the build environment (its name did not resolve). The Lightroom keys below were checked through web-search excerpts of Adobe's own pages, mainly “Keyboard shortcuts for Lightroom Classic”; this is marked **Adobe (excerpt)**. Keys taken from third-party lists are marked **secondary**, and keys not checked at all are marked **not checked**.

| Behaviour | Detail | Source |
|---|---|---|
| Settings window | Gear button or **Ctrl+,**. Sections on the left (Keyboard, Display); Esc or ✕ closes. Saved as `lightbench.settings` in the browser's local storage, read and written inside try/catch: if storage is blocked, the settings still apply for the visit. Interface size and background are applied before the first paint. | Owner's choice. Lightroom Classic opens Preferences with Ctrl+, (Adobe (excerpt)) |
| One list of actions | `settings/actions.ts`: every action has an id, a plain name, where it works (Everywhere, Library, culling/Compare/Survey, one photo, Compare, Survey, Develop) and its keys in each set. The views only say what each action does (`useShortcuts`), and one keydown listener matches the key and runs the action in the view on screen. The Library, culling and Develop handlers and Develop's G (in `App.tsx`) were moved onto it with the same keys. | LightBench |
| Shortcut sets | **LightBench**: the keys of 0.1.0, plus the new Settings, ?, Ctrl+/, Ctrl+Shift+P and Ctrl+Alt+=/− keys. **Lightroom Classic** differs in three places: Show clipping is J only (LightBench also has darktable's O), Copy and Paste settings are Ctrl+Shift+C and Ctrl+Shift+V only (Ctrl+C and Ctrl+V are left to the browser), and Import from card… has Ctrl+Shift+I (no key in the LightBench set). | Owner's choice; darktable registers O (overexposed) and Shift+O (raw overexposed) in `src/views/darkroom.c` |
| Custom | Changing a key saves only that action's keys; the window shows “Custom (based on Lightroom Classic): 2 changed”. Setting an action back to the set's keys counts as unchanged. Choosing the other set asks first when there are changes, then drops them. | Owner's choice |
| Changing a key | Click a key to replace it, then press the new key (Esc cancels). **+ Add** gives a second key, **×** removes one, **Reset** puts one action back, **Reset all** the whole set. The search box finds actions by name, place or key. Hints, tooltips and the Library and culling key lines show the keys in use. | Owner's choice |
| Conflicts | Two actions can't share a key where both can run: the Library grid, culling with one photo, Compare, Survey and Develop are checked separately, and an Everywhere key counts in all of them (Z can be zoom in both culling and Develop). A taken key shows “X: already used by Reject. Replace?”; **Replace** moves the key (Reject is left without it), **Cancel** keeps everything. Both sets are free of conflicts (unit test). Stored settings that somehow contain a conflict show a warning listing it (not tested end to end). | Owner's choice. darktable asks the same when a new shortcut clashes: “clashing shortcuts exist” / “remove these existing shortcuts?” (`_insert_shortcut`, `src/gui/accelerators.c`) |
| Which key was pressed | Letters by `KeyboardEvent.key`, upper or lower case (so Caps Lock doesn't matter and the key marked P on an AZERTY keyboard is P). Symbols and digits include Shift already (`?` is Shift+ß on a German keyboard, digits need Shift on a French one), so Shift is ignored for them. AltGr (which Windows reports as Ctrl+Alt) is ignored, so `\` typed with AltGr works. A key with Shift that has no Shift shortcut acts as without Shift, as before (Shift+P picks, Shift+→ moves). On layouts that type no Latin letters (Russian, Greek), or when macOS Option changes the character, the key's US position is tried next. Ctrl also means ⌘. | Owner's choice (printed letter); the rest LightBench |
| When keys don't run | In text boxes and lists (as before), on a focused slider's own keys, while an input method is composing, while any dialog is open, and Enter on a focused button (the button gets it). Before, Develop's keys still ran behind the Export window, and the Library's behind the metadata preset window (from reading the 0.1.0 code; not reproduced). | LightBench |
| Shortcut list (**?**, also **Ctrl+/**) | The keys of the view on screen first, then Everywhere, with the keys in use (Custom included) and a search box. **Change shortcuts…** opens Settings › Keyboard. | Owner's choice. darktable shows its shortcuts while H is held (“show accels window”, `src/control/control.c`); Lightroom Classic shows the current module's shortcuts with Ctrl+/ (Adobe (excerpt), regional copy of the page) |
| Command search (**Ctrl+Shift+P**) | Type part of a name (also a place or a key), ↑/↓ choose, Enter or click runs it. Lists the actions of the view on screen and the Everywhere ones, each with its keys, including actions without a key (e.g. Import from card… in the LightBench set). | Owner's choice. darktable's shortcut window has “search actions list” and “search shortcuts list” boxes (`src/gui/accelerators.c`), but they find shortcuts to edit, not actions to run. |
| Slider keys | With a develop slider focused: ←/→ (or ↓/↑) move it by 1/200 of its range, at least one step (Exposure 0.05 EV, Contrast 1); Shift+arrows ten times as far; **Home** goes back to the slider's default instead of its minimum. Double-click still resets. End and Page Up/Down keep the browser's behaviour. The tooltips say “Double-click or Home to reset”. | Owner's choice; the step sizes are LightBench's |
| Interface size | 90 / 100 / 110 / 125 / 150 % in Settings › Display; **Ctrl+Alt+=** (or Ctrl+Alt++) and **Ctrl+Alt+−** step through them from anywhere and stop at the ends. Text, buttons, panels, dialogs and the grid all scale. | Owner's choice |
| How size is scaled, and why photos stay sharp | CSS `zoom` on the whole app (its height and the few `100vw`/`100vh` sizes are divided by the size so it still fills the window). The four areas that show photos (Develop's photo, the culling and Compare panes, Survey and the Library loupe) undo the zoom, so their canvases measure exactly what they are drawn at and keep one backing pixel per device pixel; the labels drawn over photos are zoomed back. The histogram takes the zoom into account (`currentCSSZoom`). Measured in Chromium 141: inside a box zoomed to 125 %, a canvas's `clientWidth` reads 300 px while it covers 375 px on screen, so sizing it from `clientWidth × devicePixelRatio` (as all LightBench's canvases do) would stretch a 300-pixel image over 375 pixels. Scaling the root font size instead wasn't possible: the stylesheet and many inline sizes are in pixels. | LightBench (CSS `zoom`, measured in Chromium 141) |
| Background behind photos | **Black** `#000000`, **Dark grey** `#111215` (the colour Develop and the Library loupe already used) and **Mid grey** `#777777` (about L* 50, half-way between black and white in lightness; LightBench's choice). Used behind the photo in Develop, culling, Compare, Survey and the Library loupe. Culling's slightly darker `#0c0d0f` and Survey's black tile edges now follow the setting too. | Owner's choice. Lightroom Classic sets a “fill color” for the main and secondary window under Preferences › Interface › Background (Adobe (excerpt); the names of its shades were not confirmed) |
| Release notes | `package.json` 0.2.0 with a 0.2.0 entry: Compare and Survey, metadata editing and metadata/import presets (these two lines moved out of 0.1.0, which had been deployed without them), and this Part. No bug fixes listed. | Owner's release rules (Part 9) |

### Shortcuts in both sets

“Same” means the Lightroom Classic set uses the LightBench key.

| Action | Where | LightBench | Lightroom Classic set | Lightroom key checked |
|---|---|---|---|---|
| Settings | Everywhere | Ctrl+, | same | Adobe (excerpt): Preferences |
| Find an action by name | Everywhere | Ctrl+Shift+P | same | LightBench (no Lightroom equivalent) |
| Show keyboard shortcuts | Everywhere | ?, Ctrl+/ | same | Ctrl+/: Adobe (excerpt). ?: LightBench |
| Larger / smaller interface | Everywhere | Ctrl+Alt+= (Ctrl+Alt++), Ctrl+Alt+− | same | LightBench |
| Pick / Reject / Remove flag | Library, culling | P / X / U | same | Adobe (excerpt); for U the excerpts disagreed (one listed “Unflag photo: U”, one didn't show it) |
| No stars, 1–5 stars | Library, culling | 0, 1–5 | same | Adobe (excerpt) |
| Red, Yellow, Green, Blue label | Library, culling | 6, 7, 8, 9 | same | Adobe (excerpt) |
| Quick Collection | Library, culling | B | same | Adobe (excerpt) |
| Open in Develop | Library, culling | D | same | Adobe (excerpt) |
| Copy develop settings… | Library, Develop | Ctrl+C, Ctrl+Shift+C | **Ctrl+Shift+C** | Adobe (excerpt) |
| Paste develop settings… | Library, Develop | Ctrl+V, Ctrl+Shift+V | **Ctrl+Shift+V** | Adobe (excerpt) |
| Sync settings… | Library, Develop | Ctrl+Shift+S | same | Adobe (excerpt) |
| Export… | Library, Develop | Ctrl+Shift+E | same | Adobe (excerpt) |
| Next / previous / below / above photo, first / last | Library | → ← ↓ ↑, Home / End | same | not checked |
| Select all | Library | Ctrl+A | same | not checked |
| Grid | Library | G, Esc | same | G: Adobe (excerpt); Esc not checked |
| Loupe | Library | E, Enter | same | E: Adobe (excerpt); Enter not checked |
| Cull (full screen) | Library | F | same | LightBench's view. Lightroom's F is a full-screen mode (excerpts differ by version) |
| Compare / Survey | Library | C / N | same | Adobe (excerpt) |
| Remove from the library (in a collection: from it) | Library | Delete, Backspace | same | Adobe (excerpt) lists them for “Delete selected photo(s)”; LightBench never deletes files |
| Expand or collapse a stack / Move to top of stack | Library | S / Shift+S | same | Adobe (excerpt): “Toggle stack”, “Move to top of stack” |
| Stack / Unstack | Library | Ctrl+G / Ctrl+Shift+G | same | Adobe (excerpt) |
| Make a virtual copy | Library | Ctrl+' | same | Adobe (excerpt) |
| Add keywords | Library | Ctrl+K | same | not checked |
| Open folder… | Library | Ctrl+O | same | LightBench (what Lightroom uses Ctrl+O for wasn't checked) |
| Import from card… | Library | — | **Ctrl+Shift+I** | Adobe (excerpt): “Import photos from disk” |
| Show or hide the info line | Culling, Compare, Survey | I | same | not checked |
| One photo ⇄ Compare | One photo, Compare, Survey | C | same | LightBench (C opens Compare in Lightroom) |
| Zoom to 100 % and back | One photo, Compare | Z | same | Adobe (excerpt): “Toggle Zoom view” |
| Auto-advance on or off | One photo, Compare | A | same | LightBench (Caps Lock also advances, Part 2) |
| Back (to the survey, or the grid) / Close / Back to the survey | One photo, Compare | Esc / G, E, F / N | same | LightBench |
| Next / previous photo, first / last | One photo | →, ↓, Space / ←, ↑; Home / End | same | not checked |
| Next / previous / first / last Candidate | Compare | →, Space / ← / Home / End | same | not checked |
| Make Select / Swap | Compare | ↑ / ↓ | same | secondary (Part 10) |
| Switch the active photo | Compare | Tab | same | LightBench |
| Move between tiles | Survey | → Space Tab / ← Shift+Tab / ↓ / ↑ / Home / End | same | LightBench |
| Active tile alone / Drop from survey / Back to the grid | Survey | Enter / Delete, Backspace / Esc, G, N, E, F | same | LightBench (Part 10) |
| Undo / Redo | Develop | Ctrl+Z / Ctrl+Y, Ctrl+Shift+Z | same | Adobe (excerpt) |
| Before / after | Develop | \ | same | Adobe (excerpt): “View Before only” |
| Show clipping | Develop | J, O | **J** | J: Adobe (excerpt). O is darktable's (`src/views/darkroom.c`); Lightroom uses O for the mask overlay (Adobe (excerpt)) |
| Show sensor clipping | Develop | Shift+O | same | darktable (`src/views/darkroom.c`). No Lightroom equivalent; Lightroom's Shift+O cycles mask overlay colours (Adobe (excerpt)), and LightBench has no masks yet |
| Zoom to 100 % and back | Develop | Z | same | Adobe (excerpt), for the Library; Develop not checked |
| Next / previous photo | Develop | → / ← | same | not checked |
| White balance picker | Develop | W | same | Adobe (excerpt) |
| Cancel the picker and fit the photo | Develop | Esc | same | LightBench |
| Back to the Library grid | Develop | G | same | Adobe (excerpt) |

**Verified** (headless Chromium 141 with software WebGPU, scratch script `e2e-keyboard`, A.NEF (D700), B.NEF (D80) and C.jpg; 89 of 89 checks passed):
- **Default keys, grid:** P picked A; → then 3 and 6 gave B 3 stars and the red label; X rejected B and U unflagged it; Ctrl+A selected all 3; E showed the loupe and G the grid; Shift+P still picked.
- **Non-US keyboards** (key events sent with a `key` and a different `code`): `x` on the physical B key rejected C (no Quick Collection); `p` on the physical R key picked; on a Russian layout, `з` (P position) and then `г` (U position) picked and unflagged through the US-position fallback; on a French layout, Shift + the 3 key typing “3” gave 3 stars. Typing “c” in the search box typed it and opened no Compare.
- **? list:** groups “Library” and “Everywhere”, Pick shown as P, no Develop actions; searching “stack” left 4 rows; Esc closed it.
- **Command search:** Ctrl+Shift+P, “loupe” found “Loupe (one large photo) · Library” with E and Enter; Enter showed the loupe; “grid” + Enter went back.
- **Rebinding:** Settings opened on Keyboard, LightBench, unchanged. Pick changed to K: “Custom (based on LightBench): 1 changed”; P no longer picked B, K did; the Library hint line read “K pick”; in culling K picked too and the hint line started “K pick”. Reset (Pick only) gave P back.
- **Conflict:** adding X to Pick showed “X: already used by Reject. Replace?”; Replace gave Pick P and X and left Reject without a key, and X then picked. Adding B to Remove flag and pressing Cancel left B on the Quick Collection. Searching “quick” left one row. Reset all went back to the LightBench set and X rejected again.
- **Develop:** J and O showed clipping (“Clipping shown (J)”), Shift+O sensor clipping, \ the Before badge, Z zoomed, W started the white balance picker and Esc cancelled it, Ctrl+C opened the copy checklist, → went to B.NEF, G back to the Library.
- **Slider keys** (Exposure, range −5…5): → 0 → 0.05, Shift+→ 0.55, ← 0.50, Home 0 (the default, not −5); double-click still reset.
- **Lightroom Classic set:** Show clipping listed J only; O did nothing and J showed clipping; Ctrl+C opened nothing and Ctrl+Shift+C opened the copy checklist.
- **Interface size** (1440 × 900 window): the top bar went from 55.5 px to 69.1 (125 %), 50.0 (90 %) and 82.8 (150 %), and Develop's right panel from 300 px to 375, 270 and 450; no horizontal scrolling and the app still exactly filled the 900 px window. Ctrl+Alt+− and Ctrl+Alt+= stepped 150 → 125 → 150 % and stopped at 150 and 90 %.
- **Sharpness:** at 100, 125, 90 and 150 % the Develop canvas's backing size equalled its on-screen size × devicePixelRatio (within 1 px of rounding), e.g. 753 × 674 for 752.5 × 674.0 at 125 %. Also the Library loupe (100 % and 125 %) and the culling pane (125 %). With `deviceScaleFactor: 2`: Develop 1780 × 1436 for 890 × 718.4 (100 %), 1506 × 1348 (125 %), 1890 × 1472 (90 %); the histogram 446 × 264, 558 × 330 and 401 × 238; a Survey tile 1408 × 1628 for 704 × 814 and a Compare pane 1414 × 1496 for 707 × 748.5 (90 %). Negative control: with the counter-zoom removed at 125 %, the same check failed (backing 1204 × 1078 for 752.5 × 674 on screen at 2×), so the check does detect a soft photo.
- **Background:** dark grey `rgb(17, 18, 21)` by default in Develop, as before; Black and Mid grey applied in Develop, and Mid grey in the Library loupe and the culling view.
- **Reload:** after choosing the Lightroom set, Pick on K, 125 % and Mid grey, a reload kept all four (“Custom (based on Lightroom Classic): 1 changed”).
- **Earlier scripts re-run, unchanged results:** Part 2's culling script (auto-advance, X without advance, Tab + 7 on the right-hand photo, the 100 % render in 14 s, the grid afterwards); Part 10's Compare and Survey script, all 34 checks passed (“ALL PASSED”); Part 7's paste script (A +0.75 EV / Blacks −85, B −0.20 / −4, C −0.20 / −5, Sync and Auto Sync reaching B.xmp, strength 50 % giving Blacks −42).
- Screenshots of Settings (Keyboard, a conflict, Display), the ? list, command search, Develop at 125 %, culling at 125 % with Mid grey and Compare at 2× and 90 % were checked by eye.
- **Unit tests** (`npx vitest run`, 205 passing): `settings/keymap.test.ts` (chord normal form; Shift ignored for symbols and kept for letters, with the fallback; AZERTY, Russian and macOS Option keys; AltGr; recording; display text; both sets free of conflicts; every 0.1.0 key in the LightBench set; the Lightroom differences; custom keys over a set; conflicts only where both actions run; Replace; add, remove and reset; reading broken stored settings) and `settings/store.test.ts` (saving and reading back, defaults for broken or blocked storage, the size steps, the CSS variables, slider step sizes, key hints). `npx tsc -b`, `npx oxlint` (only the two existing warnings) and `npm run build` passed.

**Limitations:**
- The Lightroom keys were checked only through search-engine excerpts of Adobe's pages, not by reading the pages or by using Lightroom; some keys are not checked at all (see the table). Lightroom's Shift+U (unflag, then go to the next photo; Adobe (excerpt)) is not in either set. Shift+0–5 (rate, then the next photo) and ] / [ were added later, see [PHASE3.md, Part 6](PHASE3.md#part-6-rating-keys-and-a-one-time-refresh-of-older-photos).
- Esc can't be recorded as a new key (it cancels recording); the default Esc keys stay and come back with Reset. Keys the browser keeps for itself (such as Ctrl+W or Ctrl+T) never reach the page and can't be used.
- The Lightroom set changes keys only; it doesn't add Lightroom features LightBench lacks.
- Settings live in this browser only: another browser or computer starts with the defaults, and clearing the site's data resets them. There is no export or import of shortcut sets.
- Interface size uses CSS `zoom`, so it relies on the browser's `zoom` behaving as Chromium 141's did; only Chromium was tested (not Firefox or Safari). The photo areas measure their own size, so other layouts that read sizes in a zoomed area (none known now) would need the same care.
- Real non-US keyboards weren't used: the layouts were imitated with synthetic key events (`key` and `code` as Chrome reports them on those layouts). AltGr handling and macOS ⌘/Option were covered by unit tests only.
- Screen readers weren't tested with the Settings window, the list or command search.

## Fixes from the LightCraft review

A review comparing LightBench with LightCraft (an MIT/Apache Rust editor) found six problems in parts already built. Each was confirmed in LightBench's code, and the owner approved the fixes (2026-10-12).

| Fix | What changed | Files (`web/src/`) |
|---|---|---|
| 1. Rating precedence | When a sidecar is read, `xmp:Rating` now wins over `lightbench:Rating`, so stars changed in Lightroom or Bridge are no longer overridden. `lightbench:Rating` is used only when `xmp:Rating` is missing or −1 (rejected, which hides the stars). `lightbench:Flag` still keeps picks. A photo LightBench rejected that another app has since given stars (`xmp:Rating` 0 or more) is read as not rejected. Writing is unchanged. | `sidecar/xmp.ts` |
| 2. Keywords | Both `lr:hierarchicalSubject` and `dc:subject` are read (see the Part 3 table). | `sidecar/xmp.ts` (`readKeywords`) |
| 3. Newer catalogs | A catalog whose `user_version` is above this version's schema (10) is refused before anything is written. The Library shows “This library was saved by a newer version of LightBench. Reload to get the latest version. Nothing in the library was changed.” with a **Reload** button. Reload uses a waiting update if there is one (Part 9), and LightBench checks for one straight away. Before, it opened such a catalog as if it were its own. | `catalog/catalog.worker.ts`, `catalog/errors.ts`, `catalog/OpenError.tsx`, `pwa/register.ts`, `library/LibraryView.tsx` (one line) |
| 4. Verified card copies | Import copies each file in 8 MiB pieces, hashing each piece (SHA-256 with `crypto.subtle`) as it is read from the card. It then reads the copy back and compares. The backup copy is checked against the same digest. A file's digest is the SHA-256 of its pieces' digests, so memory stays at about one piece. On a mismatch, the bad copy is deleted, the photo is listed under “Show problems” (“The copy in … didn't match the original, so it was deleted. The original wasn't changed…”), and it isn't added to the library. The card is only ever read. A file with the same name at the destination counts as “already copied” only if its content matches; otherwise the copy gets the existing numbered name (`-1`). | `import/copy.ts` (new), `import/run.ts` |
| 5. Storage notices | LightBench asks for persistent storage when a folder is opened or imported. If the browser doesn't grant it, a notice says the library may be cleared when disk space runs low, and suggests installing the app or allowing storage. **OK** hides the notice in this browser for 30 days. When a catalog request fails because storage failed, a notice says “LightBench couldn't save a change to its library…”. This covers SQLite's read-only, I/O error, corrupt, disk full, can't-open and not-a-database errors, and the browser's quota. Sidecar failures were already shown, but a folder the browser had forgotten was skipped silently: that is now reported. Messages name the file and folder, and repeated failures update one notice (“and 2 more”). After **OK**, failures within the next minute don't bring a notice back. | `catalog/storage.ts` (new), `catalog/client.ts`, `catalog/catalog.worker.ts`, `lib/rpc.ts` (keeps the error's name), `sidecar/sync.ts`, `sidecar/SidecarBanner.tsx` (shows the new notices too, so `App.tsx` is unchanged) |
| 6. Tint direction | Test only. It goes through the conversion used for rendering (`develop/source.ts` `multipliers` → `temperatureToMultipliers`). Moving Tint towards magenta lowers green relative to red and blue, and moving it towards green raises it, for a D700 RAW and an sRGB JPEG. The direction was already right. | `engine/develop/settings.test.ts` |

**Verified:**
- **Checks:** `npx vitest run` (202 tests pass), `npx tsc -b`, `npx oxlint` (only the two existing warnings) and `npm run build`.
- **New unit tests:**
  - `xmp.test.ts`:
    - every rating and flag LightBench writes round-trips;
    - stars changed elsewhere win, and a pick survives a star change made elsewhere;
    - a LightBench rejection keeps its stars, and a rejection made elsewhere keeps the LightBench stars;
    - stars given elsewhere un-reject the photo;
    - fallback without `xmp:Rating`, and clamping;
    - a sidecar that was read is written back without a rewrite;
    - Lightroom, darktable, mixed and one-list keyword sidecars.
  - `copy.test.ts`:
    - the digest doesn't depend on the piece size;
    - a copy corrupted on write is deleted and reported;
    - a backup that differs from the first reading is reported;
    - an identical file with the same name counts as copied;
    - a different file of the same size keeps its name, and the copy is numbered.
  - `storage.test.ts`: which errors count as storage failures, and the notices' show, hide and quiet rules.
  - `settings.test.ts`: the Tint direction.
- **In the browser** (headless Chromium with software WebGPU; scratch scripts `e2e-fixes`, 27 of 27 checks passed, and `e2e-quota`):
  - **Ratings:**
    - A.NEF, rated 2 in LightBench, wrote `xmp:Rating="2" lightbench:Rating="2"`.
    - B.NEF, given 3 stars and rejected, wrote `xmp:Rating="-1" lightbench:Rating="3" lightbench:Flag="-1"`.
    - A.xmp's `xmp:Rating` was then changed to 5 (as Lightroom would). After removing the photos and opening the folder again, A had 5 stars and B had 3 stars and was rejected.
  - **Keywords:**
    - A Lightroom-style C.xmp had the hierarchy `Places|USA|Philadelphia`, and a flat list with its levels plus `Sunset` and `Dog`. It gave Philadelphia (under Places › USA), Sunset and Dog.
    - A darktable-style `B.NEF.xmp` had `darktable|format|nef`, `darktable|changed`, `Trips|Glarus` and `Lake`, with those levels also in the flat list. It gave Glarus (under Trips) and Lake, with no “darktable”, “format” or “nef”.
    - A flat-only D.xmp gave both its keywords.
  - **Newer catalog:**
    - `user_version` was set to 99 through SQLite, from a page of the same origin.
    - Reloading showed the message and the Reload button.
    - Afterwards `user_version` was still 99, the rows were the same, and every file in the catalog's storage folder was byte-identical.
    - With `user_version` set back to 10, the library opened again.
  - **Card import** (DSC_0001.NEF from a D700, DSC_0002.NEF from a D80 and DSC_0003.JPG, with a backup folder):
    - Writes of DSC_0003.JPG into the destination were corrupted (one bit flipped). The summary showed “2 imported · 1 failed”, with the message.
    - The bad copy was gone, DSC_0003 wasn't in the library, and the card's files were byte-identical.
    - A different file with DSC_0002's name and size was already in `2010/2010-07-20`. It was left alone, and the photo was copied as `DSC_0002-1.NEF` (identical to the card's file).
    - Importing again without corruption gave “1 imported · 2 were already in the library”, with no extra numbered copies.
  - **Time cost of checking** (medians of 3 runs, in the browser's private storage on this machine's disk):

    | Photo | Plain copy | Checked copy | Extra |
    |---|---|---|---|
    | D700 NEF, 15.1 MB | 57–124 ms | 221–308 ms | +164–184 ms |
    | D80 NEF, 8.6 MB | 39–66 ms | 122–185 ms | +83–119 ms |

    Hashing alone runs at about 120–200 MB/s here, so checking adds roughly 1–1.4 s per 100 MB to the copy. Copying from a real card is usually slower than this, so checking is a smaller share of the total. Not measured on the owner's PC.
  - **Storage notices:**
    - With `navigator.storage.persist()` stubbed to resolve false, the notice appeared after Open folder (not before), appeared only once, and stayed hidden after OK. With it resolving true, the notice never appeared.
    - With `.xmp` writes made to fail, rating D.JPG showed “Sidecar not saved: D.xmp: …”. A second failure (C.JPG) updated the same notice to “(and 1 more)”, and after OK another failure within the minute didn't bring it back.
    - In `e2e-quota`, shrinking the site's quota through the DevTools protocol made a real sidecar write fail with the browser's quota message. It was shown the same way.
- **Screenshots** of the storage notice, the sidecar notice, the newer-catalog screen and the import summary were checked by eye.

**Limitations:**
- A catalog write failing because storage failed was **not seen end to end**. Shrinking the quota made sidecar writes fail, but not the catalog's, because SQLite's files in the browser's storage didn't need to grow. Only the unit tests (error classification, notice) and the type-checked worker → page plumbing cover it.
- When a sidecar changes outside LightBench, photos already in the library still don't re-read it, because ⟳ only adds new photos. In the test, A kept 2 stars after ⟳ until it was removed and added again. Catalog v4's `sidecar_written_at` is there for this but isn't used yet. (Since fixed: see [Sidecars changed by other apps](#sidecars-changed-by-other-apps).)
- The check reads the copy back through the browser, which may be served from the operating system's cache rather than the disk itself. So it catches a bad write path (browser, cable or card reader errors that change bytes), but not necessarily a disk that loses data later. Each file is read from the card once, so a reader that returns the same wrong bytes every time can't be detected.
- The Import window's “Already imported” badge still compares only name and size, because reading every file to mark it would be slow. Importing then checks the content.
- Not checked here: whether installing the app makes Chrome or Edge grant persistent storage (Chrome decides by its own rules). The notice only says it may.
- Found while writing the Tint test and **not changed**: on an sRGB JPEG at its as-shot 6500 K, Tint +150 asks for a white outside sRGB, and the red multiplier comes out negative (about −7.9; +100 gives about 9.5). For RAW files (D700) the multipliers stay positive across the whole range. (Since fixed: [PHASE3.md Part 4](PHASE3.md#jpeg-tint-150). Over the whole Temp range, RAW multipliers could also turn negative at warm Temp with Tint far to the green side; that is limited too.)

## Library backup and restore

**What it does.** Saves the whole library (not the photos) to one file and puts it back, in this browser or another. The idea is LightCraft's web build's (one checked ZIP, restored into a new place before switching; `docs/research/lightcraft/CATALOG_LIBRARY_AI_APPS.md`); the code is LightBench's own. Owner's choices (2026-10-12):
- One action, **Back up library…**, at the bottom of the Library's left panel next to **Restore…** (not in the Settings window). An empty library also offers **Restore library…**.
- The backup holds the catalog, the thumbnails, LightBench's settings and a manifest; **not** the photos or their sidecars, which stay in the user's folders. The dialogs say so.
- The file is saved with the browser's save dialog where there is one (Chrome, Edge), otherwise downloaded. It is read back and checked after writing, and the result is reported plainly.
- Restoring checks the backup first, shows what it holds, says clearly that it **replaces** the library in this browser, offers to back up the current library first, and switches only after everything has been written and checked. All local: nothing is sent anywhere.

| Behaviour | Detail | Source |
|---|---|---|
| What is in the file | `catalog.sqlite3` (deflated), `settings.json`, `thumbnails/<photo id>.jpg` (stored: JPEGs don't shrink), `README.txt` (what the file is and isn't) and `manifest.json`: format `lightbench-library-backup` version 1, app version, catalog schema version, date (UTC), counts (photos, thumbnails, folders, collections, keywords, edited photos, presets, settings) and every file's size and SHA-256. Only thumbnails of photos in the catalog are included. File name `LightBench backup YYYY-MM-DD HHMM.zip`. | LightBench's format; LightCraft's idea |
| Catalog copy | `sqlite3.capi.sqlite3_js_db_export` (a wrapper of `sqlite3_serialize`, https://sqlite.org/wasm/doc/trunk/api-c-style.md#sqlite3_js_db_export), checked in `@sqlite.org/sqlite-wasm` 3.53.4-build2's `index.d.mts` and `index.mjs`. It runs in the catalog worker, which handles one request at a time and commits every change within its request, so the copy is consistent. | sqlite-wasm |
| Settings | localStorage keys starting `lightbench.`, `library:` or `cull:` (the prefixes LightBench's keys use; this includes the Settings window's `lightbench.settings`). Browser-only notices (`storage:`) are left out. Restoring replaces these keys and removes ones the backup doesn't have. | LightBench's choice |
| ZIP writing | `backup/zip.ts`: stored and deflated entries (deflate by the browser's `CompressionStream('deflate-raw')`), UTF-8 names, CRC-32, and Zip64 records whenever a size, an offset or the number of entries needs them. Written in 4 MB pieces straight to the file; only the central directory (about 80 bytes per entry) is kept in memory. No library was added: fflate 0.8.3 (MIT) was checked and its writer has no Zip64 (only the classic end record, `wzf` in `esm/browser.js`), so it stops at 65,535 entries and 4 GB, which a library of 100,000 photos passes. | PKWARE APPNOTE.TXT 6.3.10 (4.3.14, 4.3.15, 4.4.7, 4.5.3) |
| Where it is saved | Chrome/Edge: `showSaveFilePicker` (suggested name, starts in Documents) and a writable stream; a failure aborts the write. Elsewhere: written to a temporary file in the browser's private storage, checked, then downloaded; the temporary copy is removed after two minutes or the next time the library opens. If private storage can't be written, the file is built in memory. | File System Access API |
| Check after saving | The saved file is read back from disk: the ZIP's central directory, `manifest.json` (CRC-32), the exact file list and sizes, every file's SHA-256, the catalog's SQLite header and version, and the catalog opened in memory (`sqlite3_deserialize`, read-only) with SQLite's `PRAGMA integrity_check` and its photo count. Then “Backup saved and checked: name, size, photos, thumbnails, time” or “Backup failed: …”. | LightCraft's idea; SQLite |
| Checking a backup to restore | The same checks, before anything changes. Refused with a plain message: not a ZIP or cut short (“not a LightBench library backup”), any file that doesn't match its checksum, missing or extra files (“This backup is damaged (…). Nothing in the library was changed.”), and a backup from a newer format or catalog schema (“This backup was made by a newer version of LightBench. Reload to get the latest version, then try again. Nothing in the library was changed.”, the same rule as the newer-catalog guard in “Fixes from the LightCraft review”, item 3). Older schemas are accepted and upgraded when the catalog opens. | LightBench |
| Confirmation | Date, LightBench version, photos, folders, thumbnails, edited photos, collections, keywords, presets and settings; “The backup was checked”; a warning that restoring **replaces the library in this browser** and loses changes made since the backup, that photos and sidecars aren't changed, and that folders need Reconnect afterwards. Buttons: Cancel, Choose another…, **Back up current library first…**, **Replace library**. Back up and Restore wait while folders are being read. | Owner's choice |
| Restoring safely | Two library “slots” in the browser's storage (`catalog/slot.ts`): slot a is today's catalog and `thumbnails` folder, slot b `/lightbench-catalog-b.sqlite3` and `thumbnails-b`; `lightbench-library-slot.json` names the one in use (none = a, so existing libraries need no change). The backup goes into the unused slot: the catalog with the SQLite pool's `importDb`, then opened there for the integrity check; the thumbnails written, and every one read back and hashed. Only then is the slot file replaced (the browser replaces it when the write closes). Any failure before that removes what was written and leaves the library as it was. The page then reloads; the old slot is removed once the restored catalog has opened. | LightCraft's idea (new folder, switch last) |
| Folders after a restore | Folder access lives in the browser, not the catalog, under the catalog's folder ids. A folder record is kept only when the backup has a folder with the same id and name (restoring in the same browser); others are forgotten, as are import presets' folders. **Reconnect** now asks the user to choose the folder when the browser has no record of it (a folder with a different name asks for a confirmation first). | LightBench |
| Keys | Library shortcuts pause while the dialog is open. | Part 12 |

**Verified** (headless Chromium via Playwright with software WebGPU, `npx vite` dev server, scratch scripts `e2e-backup`, `e2e-scale` and `check_backup.py`; the folder picker and the save dialog were replaced by stand-ins returning folders and files in the browser's private storage):
- **Round trip, 29 of 29 checks passed** (run again after rebasing on `main` with the fixes: same results). A library of A.NEF (D700), B.NEF (D80) and C.JPG with A 3 stars, B 5 stars, keyword “Places > Switzerland > Glarus” on B, collection “Portfolio” (A, B), an edit on A (Saturation −30), a preset “Muted” and two settings. Backup with the save dialog: “Backup saved and checked: “B1.zip”, 0.1 MB, 3 photos and 3 thumbnails, in 0.1 s” (89,978 bytes: catalog 245,760 → 3,307 bytes deflated, thumbnails 84,234 bytes). The downloaded backup (no save dialog) was the same size and said “It is in your downloads.” Outside the browser, `unzip -t` found no errors, and Python's `zipfile` and `sqlite3` read both files: every SHA-256 matched, `integrity_check` ok, user_version 10, tables and settings as in the library.
- **Refusals, library untouched:** after rating C 2 stars, a backup with one flipped byte was refused (“This backup is damaged (thumbnails/1.jpg doesn't match its checksum). Nothing in the library was changed.”, no Replace button), as were the backup with its manifest's schema version set to 11 (“…made by a newer version of LightBench…”) and a file that isn't a ZIP. C still had 2 stars.
- **Failure while restoring:** a simulated “disk full” on the second thumbnail written into the new slot gave “Restore failed: Simulated: disk full Nothing in the library was changed.”; no `thumbnails-b` and no slot file were left, and after a reload the library was unchanged (C still 2 stars, Portfolio still 2).
- **Restore in the same browser:** Replace library reloaded the page within about 1 s with the backup's ratings (C back to none); the folder stayed connected (no Reconnect needed); the slot file named slot b, `thumbnails-b` held 3 files, and the old `thumbnails` folder and the temporary download copy were gone.
- **Restore into a wiped browser** (catalog, thumbnails, localStorage and the folder store deleted): the empty library offered **Restore library…**; the downloaded backup was checked in 0.16 s and showed “3 photos in 1 folder, 3 thumbnails … 1 edited photo, 1 collection, 1 keyword, 1 preset, 2 settings”; restoring and reloading took 0.9 s. Afterwards: 3 photos, the same ratings, keyword tree, collections (Quick Collection 0, Portfolio 2) and the two settings; all 3 thumbnails shown without folder access; **Reconnect “Photos”** shown, and clicking it (choosing the folder) connected it. A.NEF opened in Develop with Saturation −30, and “Muted” was under My presets. A new backup of the restored library matched the first: identical catalog rows (Python `iterdump`), thumbnail checksums, settings and counts.
- **Scale** (run before that rebase; 20,000 synthetic photos with 34,586-byte JPEG thumbnails; memory is the whole test browser's resident size, sampled every 0.2 s): the backup, 698 MB (697,935,594 bytes, 20,004 entries; catalog 4.4 MB → 1.1 MB), was written and checked in 38.6 s, with browser memory going from 747 MB to at most 1,026 MB. `unzip -t` and Python found no errors. Restore into a wiped browser: check 7.7 s (596 → 696 MB at most); write, read back, switch and reload 103 s (639 → 718 MB at most); 20,000 photos and their thumbnails shown afterwards.
- **ZIP format:** files from the writer (normal, with Zip64 records forced, and 70,000 entries, which needs the Zip64 end record) passed `unzip -t`, `zipinfo` and Python's `zipfile.testzip`. A ZIP written by Python (the newer-schema test file) was read by LightBench.
- **Unit tests** (`npx vitest run`, 253 passing, 23 of them new): `backup/zip.test.ts` (CRC-32 check value; round trips of stored, deflated, empty and UTF-8-named entries with and without Zip64 records; 300 entries read through a 1,000-byte window in file order; 70,000 entries with the Zip64 end record; duplicate names; refusing a non-ZIP, a cut-short file, a damaged local header and damaged deflate data) and `backup/manifest.test.ts` (SHA-256 test vector; manifest accepted, older schema accepted, newer schema or format refused, damaged file lists refused; missing, extra and wrong-size files; one flipped bit; the SQLite header; a whole backup archive round trip with a flipped byte caught; settings picked and replaced).
- `npx tsc -b`, `npx oxlint` (only the two existing warnings), `npm run build`. Screenshots of both dialogs, the confirmation, a refusal and the restored library were checked by eye; the first showed “Back up library…” wrapping in the left panel, which was fixed.

**Limitations:**
- Not tested with the real save dialog or in a real installed app: headless Chromium was used with stand-ins (the download path used the browser's real download). Not tested in Firefox or Safari.
- Not tested with a backup larger than 4 GB or an entry over 4 GB (the Zip64 records were forced and checked on small files; the 70,000-entry file needed them for real).
- The catalog is copied and checked in memory (in the worker, briefly about twice its size), so a catalog of several hundred MB needs that much free memory. Thumbnails are streamed.
- Restoring writes every thumbnail as its own file and reads it back: about 100 s for 20,000 here.
- Restoring an older catalog schema relies on the normal upgrade when the catalog opens; no backup made by an older LightBench was restored in the tests (there is only one backup format so far).
- A restored catalog doesn't read the sidecars: if photos were rated or edited after the backup was made, their sidecars hold the newer values, and LightBench overwrites them the next time it writes that photo's sidecar.
- Folder access can't be backed up: after restoring in another browser every folder needs Reconnect, and import presets' folders must be chosen again.
- Back up and Restore aren't in command search or the shortcut list (Part 12). The release notes are unchanged (no version bump).

## Sidecars changed by other apps

**What it does.** When Lightroom, Bridge, darktable or another copy of LightBench changes the `.xmp` sidecar of a photo that is already in the library, LightBench notices and asks what to do. It no longer overwrites such changes without asking. Before, ⟳ and Open folder only added new photos, and the next sidecar write could replace another app's stars or keywords. The owner approved this on 2026-10-12, with these choices:
- **Detect** when a folder is opened or looked at again (⟳), and when a photo is shown in the Loupe or Develop.
- **Check before every write.**
- **Offer, don't surprise.** A plain notice: “1 photo was changed by another app … **Read changes** / **Ignore** / **Show photos**”. There is no setting; LightBench always asks.
- LightBench edits and history are never lost, and unsaved Develop changes are kept.

| Behaviour | Detail | Source |
|---|---|---|
| What is remembered | After each read or write of a sidecar, the catalog stores the file's date (`lastModified`, ms), its size, and the fields LightBench compares, as they were in the file then. These fields are stars, pick/reject, label, keywords, the nine metadata fields and LightBench's develop settings. | LightBench. darktable compares only dates: its optional “look for updated XMP files on startup” (`run_crawler_on_start`, off by default) compares each XMP file's modification time with the time it last wrote it (`src/control/crawler.c`, `write_timestamp`). It then offers to sync XMP → database or database → XMP. |
| Cheap check | A sidecar whose date and size are unchanged isn't read. Only a changed one is read and compared field by field. Changes to fields LightBench doesn't use don't count, for example Lightroom's `crs:` develop settings or `xmp:MetadataDate`. Those fields are kept anyway when LightBench rewrites the file. | LightBench |
| When it is “another app's change” | The file's fields differ from what LightBench last read or wrote, and also from LightBench's current values. If the other app made the same change LightBench has, nothing is asked. | LightBench |
| When it checks | **⟳ / Open folder:** the scan that finds new photos also lists the `.xmp` files. LightBench then asks the browser for each one's date and size. **Loupe and Develop:** the photo shown (one file). **Before writing:** every sidecar write. Nothing runs at launch. | Owner's list |
| Pending writes | If another app changed the file since LightBench's last write, the write is held back and the notice appears. The other app's change stays in the file. LightBench's own change stays in the library and is written after the user answers. | Owner |
| **Read changes** | Takes only the fields the other app changed since LightBench last read or wrote the file. LightBench keeps its own changes to other fields, such as stars set in LightBench but not yet written. Keywords are merged as sets: added ones are added, removed ones removed, and keywords LightBench added meanwhile stay. A field changed in both takes the other app's value, because the user chose to read its changes. The file is then rewritten if LightBench has changes of its own to add. | LightBench (a three-way merge) |
| Develop settings | Only another LightBench writes `lightbench:Develop`. A changed value is added to the photo's history as a new step, “Read from sidecar”, through the same background job as Paste, which also refreshes the thumbnail. The earlier edit can be undone back to. If Develop has unsaved changes on that photo, Develop keeps its own (the existing Paste rule). An app that drops LightBench's namespace never removes LightBench's edits or picks. | LightBench |
| Rejected / picked | A rejection is always written as `xmp:Rating` −1. So a file without −1 and without `lightbench:Flag` isn't rejected, and a pick stays as it was. This is the same rule `readXmp` uses. | As fix 1 of the LightCraft review |
| **Ignore** | Keeps LightBench's values and remembers the file as it is now, so the notice doesn't come back for it. The notice says that LightBench's values replace the other app's in the file the next time LightBench saves the photo. A write held back by the change is made straight away. | Owner |
| **Show photos** | The grid shows just those photos (“Showing the photo whose .xmp file another app changed.”). **Back** returns to the folder or collection. | LightBench |
| After a reload | Photos waiting for an answer are marked in the catalog, so the notice comes back after a reload. | LightBench |
| Older libraries | Photos added before this version have no record. Their sidecar counts as changed by another app only if its date is more than 2 s after LightBench's last write of it (`sidecar_written_at`), or after the photo was added. Otherwise it is read once and remembered. | The 2 s allowance is darktable's `MAX_TIME_SKEW` (`src/control/crawler.c`) |
| Storage | Catalog schema **v11**, added without rebuilding any table: `photos.sidecar_modified`, `sidecar_size`, `sidecar_fields` (JSON) and `sidecar_external` (0/1). A version-10 LightBench refuses a v11 catalog, as the newer-catalog fix intends. | — |
| Lightroom's equivalent | Lightroom Classic shows a “metadata was changed externally” badge, and its dialog offers **Import Settings from Disk** or **Overwrite Settings**. LightBench's version is the notice above. **Not verified:** this wording comes from web-search summaries of Adobe's help page (“Advanced metadata actions”) and Adobe community threads. The pages themselves couldn't be opened from the build environment. | Adobe (unverified) |

**Files (`web/src/`):**
- New: `sidecar/changes.ts` (comparisons and merge, unit-tested), `sidecar/external.ts` (finding and judging a sidecar, and the list waiting for an answer), `sidecar/watch.ts` (folder and photo checks, Read changes, Ignore).
- `sidecar/sync.ts`: checks before writing, and records each write.
- `sidecar/SidecarBanner.tsx`: the notice, so `App.tsx` is unchanged.
- `catalog/catalog.worker.ts`: schema v11, and the `sidecarStates`, `sidecarCompare`, `recordSidecar`, `setSidecarExternal` and `externalSidecars` requests.
- `catalog/types.ts`: the `ids` query.
- `import/scan.ts`: lists `.xmp` files while scanning. `import/run.ts`: `findSidecar` also returns the date and size.
- `library/indexer.ts`: records new photos' sidecars and checks the folder.
- One-line checks in `library/Loupe.tsx` and `develop/DevelopView.tsx`.
- `library/LibraryView.tsx`: Show photos and refreshing.
- `sidecar/xmp.ts`: `isValidXmp`.

**Verified:**
- **Checks:** `npx vitest run` (226 tests pass, 24 of them new), `npx tsc -b`, `npx oxlint` (only the two existing warnings) and `npm run build`.
- **New unit tests:**
  - `sidecar/changes.test.ts` (19):
    - a file is read only when its date or size changed;
    - LightBench's own sidecar reads back as its own values;
    - a Lightroom-style change (5 stars, a keyword, a title, a `crs:` value) is another app's change, naming the fields;
    - `crs:` and `MetadataDate` changes alone are not;
    - the same change made in both places is not;
    - fields changed in both places are named as conflicts;
    - older photos are judged by `sidecar_written_at` or the add time, with a 2 s margin;
    - a file without LightBench's namespace doesn't remove picks or edits;
    - stars given elsewhere un-reject;
    - merge: takes the other app's fields, keeps LightBench's other changes, merges keywords as sets (with case), clears a cleared field, and takes develop settings from another LightBench;
    - stored fields round-trip, and a damaged record is ignored.
  - `catalog/catalog.worker.test.ts` (5), on SQLite in Node:
    - a new catalog is created at v11;
    - a v10 catalog with a photo is upgraded, keeping it, with no record and `sidecar_external` 0;
    - a v12 catalog is refused and left at 12;
    - opening an up-to-date catalog changes nothing;
    - `sidecarStates` leaves out a JPEG whose RAW twin is there, and virtual copies;
    - records, marks and the `ids` query work.
- **In the browser** (headless Chromium with software WebGPU; scratch script `e2e-watch`, 26 of 26 checks passed). The folder `Photos` held A.NEF (D700), B.NEF (D80) and C.JPG:
  - **Writing:** A was given 2 stars and the keyword `Places|USA|Philadelphia`, B 3 stars and C 1 star; all three sidecars were written.
  - **⟳ with nothing changed:** no notice, and 3 sidecar dates looked at, 0 files read.
  - **Changes in “Lightroom”:** A.xmp was rewritten with `xmp:Rating` 5, the keyword “Sunset” in both keyword lists, the title “Fountain” and `crs:Exposure2012`. B.xmp only had a `crs:` value changed.
    - ⟳ read the 2 changed files and showed “1 photo was changed by another app…”, for A only.
    - A still had 2 stars.
    - **Show photos** showed only A; **Back** returned to the folder.
  - **Read changes:** A had 5 stars, Philadelphia and Sunset, and the title Fountain. A.xmp kept the `crs:` value. A second ⟳ found nothing.
  - **Ignore:** A.xmp was changed again (1 star, the keyword “Ignored”, the title “Other title”) and ⟳ showed the notice. After Ignore:
    - A kept 5 stars, and the file still said 1 star;
    - ⟳ didn't report it again;
    - pressing 4 rewrote the file with 4 stars and the title Fountain, without “Ignored”, and kept the `crs:` value.
  - **Pending write:** B was given 5 stars, and before LightBench's write (~0.8 s later) B.xmp was changed to add the keyword “Pending” and the title “Pending title”. 3 s later:
    - the file still had the other app's change and 3 stars;
    - the notice had appeared without ⟳.
    - After Read changes, B had LightBench's 5 stars and the keyword and title, and B.xmp had all of them.
  - **Loupe:** C.xmp was changed to 3 stars. Opening C in the Loupe showed the notice, and Read changes gave C 3 stars.
  - **Develop with unsaved changes:** A was open in Develop and Exposure was moved to +0.25. Before Develop's save, A.xmp was changed (2 stars, the keyword “FromDevelop”).
    - Develop's save didn't overwrite the file, and the notice appeared.
    - After Read changes, A.xmp had 2 stars, FromDevelop and `lightbench:Develop` with exposure 0.25.
    - Develop still showed +0.25, with the history “Exposure | Import”.
  - **Develop settings from another LightBench:** A.xmp's `lightbench:Develop` was set to exposure −1.25. Opening A in Develop showed the notice. Read changes moved Exposure to −1.25 with the history “Read from sidecar | Exposure | Import”.
  - **Reload:** a notice not yet answered came back in a new tab of the same profile.
  - **Timing:** in the browser's private storage on this machine's disk; not measured on the owner's PC or on a real folder.

    | Run | Time |
    |---|---|
    | ⟳ on `Photos` (3 photos, 5 runs) | 150–222 ms in all. The sidecar check was 1.4–7.1 ms of that. |
    | 1,000 photos with sidecars, unchanged (2 runs) | 22–45 ms listing the folder, 72–84 ms checking. No file read. |
    | The same, 50 of them changed | 630–745 ms; all 50 read and reported. |
    | The same, first check with no records (as after the upgrade) | 2.6–3.2 s, reading all 1,000 once. |

    So a ⟳ costs roughly 0.1 s per 1,000 unchanged photos here, plus about 13 ms per changed sidecar. The first ⟳ after upgrading reads every sidecar of the folder once, about 3 s per 1,000 here.
- Screenshots of the notice, Show photos, the Develop notice and the Develop history after reading were checked by eye.

**Limitations:**
- No file written by Lightroom, Bridge or darktable was used. The test edits imitate them: `xmp:Rating`, both keyword lists, `dc:title` and a `crs:` value.
- Real folders (File System Access on Windows, network drives) weren't measured. There, asking for a file's date may be slower than in the browser's private storage.
- Only the sidecar LightBench reads is watched: `name.xmp`, or darktable's `name.ext.xmp` while there is no `name.xmp`. darktable keeps writing its own `name.ext.xmp`, so its later changes aren't seen once LightBench has written `name.xmp`.
- A JPEG whose RAW twin is in the library isn't checked: the RAW owns the shared sidecar, and changes are read into the RAW only.
- Collections, stacks and virtual copies stored in `lightbench:` aren't compared or read back. LightBench's own values are written.
- A sidecar deleted by another app isn't reported. LightBench writes a new one next time.
- Browsers can't lock files. A change made in the moment between LightBench's check and its write could still be overwritten.
- For photos from before this version, the 2 s date rule assumes the computer's clock and the drive's file dates agree. That may not hold on network drives.
- When both LightBench and the other app changed the same field, Read changes takes the other app's value. The notice doesn't say which fields those were.
- Reading develop settings while Develop has unsaved changes on that photo relies on the existing Paste rule. This wasn't seen end to end: in the test, Develop's save had already happened when Read changes was clicked.
- Ignore remembers which photos had a write held back only until the page is reloaded. After a reload, their LightBench values are written at the next change.

## Owner's feedback from first real use (2026-10-19), batch 1

The owner imported about 1,500 photos from a Nikon D5200 card (RAW+JPEG pairs). Library and Import changes from that session. Develop's changes are in [PHASE3.md](PHASE3.md#develop-groups-start-collapsed-owner-2026-10-19), and the "no notes in the UI" rule is in [USABILITY.md](USABILITY.md#no-notes-in-the-ui-owner-2026-10-19).

### RAW + JPEG stacking on import (owner, 2026-10-19)

The Import window said each JPEG would be stacked under its RAW, but after the import the pairs were not stacked. The owner's catalog wasn't available, so the session itself couldn't be replayed. A headless import of the same card layout (DCIM/100D5200, `DSC_0001.NEF` + `DSC_0001.JPG`, names in mixed case) did stack. Reading the import path found three defects, any of which leaves pairs unstacked:

| Cause | What happened | Fix |
|---|---|---|
| RAW capture times | LibRaw turns the RAW's EXIF time into seconds with `mktime`, so it reads the camera's clock as the computer's local time. JPEGs keep the camera's clock (written as UTC). So a RAW was the computer's UTC offset away from its own JPEG: 3 h on the owner's Atlantic time. RAWs sorted away from their JPEGs and showed under another date in the Import window. Evening shots (after 21:00) were copied into the next day's folder, away from their JPEG. Exports of RAWs also wrote that shifted time into DateTimeOriginal. | `import/capture-time.ts` turns LibRaw's time back into the camera's clock (`probe.worker.ts`). Catalog **schema 16** corrects the RAWs already in a library once, with the browser's time zone (the one LibRaw used when they were added). JPEGs and everything else are unchanged. |
| Stacked only at the very end | `runImport` collected the pairs and stacked them after the last photo, so nothing was stacked if the import stopped first (tab closed or reloaded, a crash). | Each pair is stacked as soon as both files are in the library. A failure to stack is logged and doesn't fail the photo. |
| Only within one import | Pairs were matched only among the files of one run. Twins imported in different runs were never stacked: dates ticked one at a time, an import resumed after a stop where "Already imported" files are unticked, or a RAW-only import followed by its JPEGs. | After each import, `stackRawJpegPairs` pairs the new photos with twins already in the library: the same name in the same folder, or **the same name on the card and capture times at most 2 s apart** in any folder (renamed files keep their card name in `original_name`). Rules in `catalog/stacks.ts` `pairTwins`. A JPEG already in a stack, and a RAW already stacked with its JPEG, are left alone. In one folder, two files with the same name must also have the same capture time when both have one, so renamed photos of different imports that share a number (`2026-10-19_0005.NEF` and `.JPG`) aren't paired. |

The Import window's **RAW + JPEG** box now has **Stack each JPEG under its RAW** (on by default; kept in import presets, and presets saved before it count as on). It can only be set while the JPEGs are imported too. (Since 2026-10-20 the other box reads **RAW only (skip JPEGs that have a RAW twin)**, the RAWs are copied before their JPEGs, and several files are copied at once: [PHASE3.md, "Import speed"](PHASE3.md#import-speed-owner-2026-10-20).) For a library imported unstacked, **Stacks ▾ › Stack RAW + JPEG pairs** pairs the selected photos (two or more), or every photo shown, by the same rules, and says how many pairs it stacked.

Also pairs: cards that write RAW and JPEG to different folders, with the same name and time. The camera's file numbers starting again (DSC_0001 every 10,000 shots, so the same name on another day) don't pair.

### Import window: several dates, and selected / total

- The date list is a row of dates, newest first. **Click** a date to show only its photos (click it again to show all dates). **Ctrl-click** (⌘ on a Mac) adds or removes a date. **Shift-click** shows the range of dates from the last date clicked. **All dates** shows everything. The thumbnails show the photos of every date chosen. The tooltip explains the clicks.
- Each date shows **(selected / total)**, e.g. `2026-10-19 (12 / 48)`, and **All dates** shows the totals. The numbers follow the ticks as photos are ticked or unticked. Choosing dates only filters what is shown: the photos ticked on other dates are still imported, and the footer says how many.
- Helpers: `import/dates.ts` (`dateCounts`, `clickDate`).

### Library grid: dates

- **Date headings**: when the photos are sorted by capture time (Newest or Oldest first), each day starts on a new line under a heading with the day and its number of photos ("Sunday, 19 October 2026 · 48 photos", in the browser's language). The current day's heading stays pinned at the top while scrolling. Photos without a capture time come last under "No capture date". A collapsed stack is one cell, so it shows once, under the date of the photo shown. On by default. Not shown for the other sorts.
- **Date on each photo**: the capture date at the bottom right of each card (e.g. "19 Oct 2026"). Off by default.
- Both are in the new **View ▾** menu of the filter bar and are remembered in this browser (`lightbench.library.dates`). Dates are the camera's clock, as everywhere in LightBench.
- With headings, lines can be shorter than the grid is wide. **Up/Down** move to the same column of the line of photos above or below, skipping headings (the last photo of a shorter line). Helpers: `library/grid-layout.ts`.

### Verified

- Unit tests: `catalog/stacks.test.ts` (`pairTwins`: a Nikon card's twins whatever the case, by name before times are known, twins in other folders only at the same moment, a file counter that started again, renamed photos by their card names, renamed photos of different imports that share a number, the closest time wins and each file is used once). `catalog/twins-catalog.test.ts`: schema 16 corrects a RAW read on Atlantic time and leaves its JPEG and a RAW without a time; `stackRawJpegPairs` stacks a same-folder pair with the RAW on top; it pairs a JPEG with the RAW of an earlier, renamed import in another folder, but not a JPEG of another shot that got the same new name; it leaves stacked JPEGs and joins a RAW's existing stack. `import/capture-time.test.ts`: on America/Halifax, RAW and JPEG of one shot get the same time in summer and in winter, also for an evening shot that LibRaw put on the next day. `import/dates.test.ts`: counts per date as ticks change; click, Ctrl, Shift and Ctrl+Shift. `library/grid-layout.test.ts`: lines with and without headings, counts, unknown dates, and Up/Down across headings and short lines.
- Headless Chromium on Atlantic time (`America/Halifax`), with a fake card holding `DSC_0001.NEF` + `DSC_0001.JPG`, `DSC_0002.nef` + `dsc_0002.JPG` (two real Nikon NEFs and JPEGs made with the same EXIF time) and a lone `DSC_0003.JPG` on another day. The date list read `All dates (5 / 5)`, `2016-09-22 (2 / 2)`, `2010-07-20 (2 / 2)`, `2010-07-19 (1 / 1)`: each RAW was on its JPEG's date. Click, Ctrl-click, plain click and Shift-click showed 2, 3, 1 and 5 photos. Unticking a photo gave `(1 / 2)` and `All dates (4 / 5)`. After the import the grid showed `# 2016-09-22, DSC_0001.NEF [⧉ 2], # 2010-07-20, DSC_0002.nef [⧉ 2], # 2010-07-19, DSC_0003.JPG`. The RAWs' capture times equalled their JPEGs' (17:10:29 and 17:27:12). View › Date on each photo showed the dates on the three cards. Turning headings off, and sorting by name, removed the headings. Down from the first photo went to the next day's photo. Both settings survived a reload. After Unstack on all photos (5 cells), Stacks › Stack RAW + JPEG pairs brought back 3 cells with the notice "Stacked 2 RAW + JPEG pairs". Before the fix the same import on Pacific/Honolulu put each NEF 10 h later, in the next day's folder.
