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
