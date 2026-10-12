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
