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
