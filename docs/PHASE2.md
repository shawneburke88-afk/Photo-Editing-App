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

**Import** now only copies (from cards, with an optional backup). Its old "add in place" mode is replaced by Open folder.

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
| Keys | P pick · X reject · U unflag · 0–5 stars · 6–9 labels · ←/→ (or Space) move · Home/End · Z or click: 100 % · C 1-up/2-up · Tab switch photo in 2-up · A auto-advance · I info · D develop · Esc/G/E/F close | Lightroom keys, as in the grid |
| Auto-advance | On by default (owner's choice), with an on-screen toggle that is remembered; Caps Lock also advances, as in Lightroom. | Lightroom's Caps Lock auto-advance |
| 2-up (C) | The photo and the next one side by side (owner's choice). The active one has a gold outline and receives the keys; Tab or a click switches. | darktable's culling layout shows 2 images by default (`plugins/lighttable/culling_num_images = 2`) |
| Previews | The camera's embedded JPEG (badge "Camera preview"), with the grid thumbnail shown until it loads. The next two photos and the previous one are loaded in advance. | darktable's default for unedited images |
| 100 % | Always the photo itself, rendered at full resolution with its Develop settings by the same path as Export (owner's choice), so focus is judged on real pixels. Badge "100 % · full rendering". Click to zoom on a point, drag to pan, click again to fit. In 2-up both photos zoom to the same spot. While the render runs (a few seconds) the fitted preview stays with a note. Renders for photos already passed are skipped. | darktable culling zoom-to-100 % (`src/dtgtk/culling.c`) |
| Filmstrip, info line, key hints | Bottom filmstrip (±20 photos) with flags, stars and labels; top line with file name, stars, flag, label, exposure, lens and capture time (I hides it); a key reminder line. | Owner's choice |
| Stable list | The photos are fixed when culling starts, so rejecting a photo while "Hide rejected" is on doesn't make it vanish mid-cull. | LightBench |

**Verified** (headless Chromium, `e2e-cull`, two NEFs and a JPEG):
- P on the first photo picked it and moved to the second; 3 rated the second and moved on; with auto-advance off, X rejected the third and stayed.
- In 2-up, Tab then 7 put the Yellow label on the right-hand photo only.
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
| Sidecars | Written as `dc:subject` (every level, once each) and `lr:hierarchicalSubject` (full paths). Read from `lr:hierarchicalSubject`, else `dc:subject`; darktable's internal `darktable|…` tags are ignored. | darktable `src/common/exif.cc` (`_exif_xmp_read_data` writes, `_exif_import_tags` reads), `omit_tag_hierarchy` default off |
| JPEGs | Keywords (and ratings, labels) embedded in a JPEG's own XMP are read when there is no sidecar. | Lightroom/Bridge write XMP into JPEGs |
| Older libraries | Photos added before keywords existed keep their sidecar keywords: they are read in before LightBench first rewrites the sidecar, and **⟳** (Look for new photos) reads them for a whole folder. | LightBench (schema v5 `keywords_read`) |
| Export | Keywords included by default as a flat list; **Include the keyword hierarchy** adds `lr:hierarchicalSubject`. | darktable export defaults: `DT_META_TAG` on, `DT_META_HIERARCHICAL_TAG` off (`src/common/metadata_export.c`) |

**Not yet:** renaming or moving a keyword, synonyms, "don't export" (darktable's category/private flags), keyword sets, and IPTC-IIM keywords inside JPEGs.

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
| RAW + JPEG | A JPEG with the same name as a RAW in the same folder is added and stacked under it, in Open folder (also on ⟳ for folders opened earlier) and in Import (now on by default, paired by the names on the card so renaming doesn't split them). | darktable import grouping (`_image_import_internal`). Lightroom's default instead hides the JPEG as an attachment; its option imports both unstacked. |
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
