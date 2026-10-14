> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-13/14 (batch 2, prompt `COWORK_VERIFY_2026-10-13b`). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# Part E: Snapshots, soft proofing, tool search — verification

Read date for every source below: **2026-10-13**. Source brief (context only): `docs/research/SNAPSHOTS_PROOFING_SEARCH.md` on branch `lightbench/research-2026-10-13c`.

Verdict counts: **Confirmed 0 · Partly 7 · Contradicted 1 · Not found 0** (several sub-points are Not found; see the last section).

## Decisions this changes

| Claim | Verdict | What LightBench should do differently |
|---|---|---|
| E1 Snapshot XMP structure, history step, default name | Partly | The default name is a **date/time stamp** (secondary). Lightroom snapshots travel with the file when metadata is saved and are shared by virtual copies. The XMP field name is still unknown, so keep the `lightbench:` namespace. Lightroom's own **Ctrl/Cmd+N = "Create a new snapshot"** (Adobe shortcut table). |
| E2 Soft proofing details | Partly | **S** toggles soft proofing and **Shift+S** toggles the destination gamut warning (Adobe). The histogram follows the proof profile (secondary). Proof copy: the profile name goes into the virtual copy's **Copy Name** field (secondary). LrC proofs to RGB profiles; CMYK proofing was removed in LrC 6.3 (secondary). Export behaviour is not confirmed. |
| E3 Chrome/Edge never pass Ctrl+N to a page | **Contradicted** (for installed PWA windows and fullscreen) | Chromium source: "In Apps mode, no keys are reserved." In a normal **tab**, `IDC_NEW_WINDOW` is reserved. In an installed PWA window, and in fullscreen, the page gets the key. Ctrl+N can therefore work in the installed app but not in a tab. Keep Ctrl+Alt+N as the cross-context default, and optionally also bind Ctrl+N when `display-mode: standalone`. |
| E4 No monitor ICC API; all four browsers colour-manage `display-p3` canvases | Partly | No API exposing the ICC profile was found. Only the coarse `color-gamut` media query exists. **Firefox has no 2D `colorSpace` support** (BCD `false`), and Firefox's default colour management is limited (open bug). Treat P3 output as Chrome/Edge/Safari only, and fall back to sRGB on Firefox. |
| E5 lcms-wasm size, speed, proofing transform | Partly | `lcms.wasm` = **316 kB** (1.0.5, MIT). `cmsCreateProofingTransform` **is exported**, and the README demos CMYK→sRGB. `cmsSetAlarmCodes` is **not** exported, so draw the gamut-warning colour in LightBench's own shader. LUT build speed still needs a local benchmark. |
| E6 RawTherapee/ART snapshots in sidecar | Partly (RT **Contradicted**, ART confirmed) | RawTherapee does **not** store snapshots in `.pp3`. ART stores them in `.arp` (author's forum statement). No change to the LightBench plan. Cite ART, not RawTherapee, as precedent. |
| E7 Photoshop Discover; Lightroom tool search after 2025 | Partly | Photoshop: Cmd/Ctrl+F opens a search over "tools, panels, windows, and menu items" (secondary). LrC release notes from June 2025 to Sept 2026 (14.4–15.6) list **no** tool search. Ctrl+F in LrC is Library "Find photo", so it is not a conflict for Develop. |
| E8 MDN/BCD: `GPUCanvasContext.configure` Chrome 144 | Partly | BCD lists **Chrome 113** (partial, ChromeOS/macOS/Windows) and **144** (adds Linux on Intel Gen12+). Cite "Chrome 113 (Linux from 144)", Firefox 141 partial, Safari 26. |

## Item-by-item

### E1. Lightroom snapshots — **Partly**
- Julieanne Kost blog (Adobe evangelist; secondary; post date shown 08-29-2024), https://jkost.com/blog/2019/09/working-with-snapshots-in-lightroom-classic.html: "Snapshots auto name with a time/date stamp, but you can rename the Snapshot when creating it" · "Snapshots can be saved within an image so, when I need to hand off an image to another person" · "...I save the metadata to the file (Metadata > Save Metadata to File..." · "When you save a Snapshot, that Snapshot is automatically made available in all Virtual Copies of the image."
- Adobe LrC keyboard shortcuts (updated 2025-10-29), https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html: "Create a new snapshot | Ctrl + N | Command + N".
- Adobe ACR help (updated 2026-09-29), https://helpx.adobe.com/camera-raw/desktop/get-started/overview-and-setup/camera-raw-settings.html: "Snapshots are stored renditions of an image that contain the complete set of edits". Settings live in "the Camera Raw database file or a sidecar XMP file". The page doesn't say where snapshots are stored.
- ExifTool 3.79: no snapshot tag in the `crs` table. The only "Snapshots" tag is in the ACDSee table, which is unrelated.
- **Not found:** the XMP structure, and whether clicking a snapshot adds a history step.

### E2. Lightroom soft proofing — **Partly**
- Adobe shortcuts (URL above): "Expand / collapse soft proofing | S | S" · "Hide / unhide Gamut destination warning in Soft Proofing | Shift + S | Shift + S".
- Histogram (Community Expert, 2023-12-20; secondary), https://community.adobe.com/t5/lightroom-classic-discussions/no-difference-in-softproof-image-but-major-differences-in-historgram/m-p/14310302: "The histogram that will be shown in the histogram display when proofing is based on the icc profile".
- Proof copy naming (secondary, 2018-07-18, marked correct), https://community.adobe.com/questions-675/soft-proofing-master-copy-935209: "The soft-proof name appears in the Copy Name field under the File Name." · "The proof profile is placed in the metadata field "Copy Name"."
- CMYK (secondary), https://community.adobe.com/t5/lightroom-classic-ideas/p-cmyk-soft-proofing-needed/idc-p/14322285: the idea is still open with "No status". A participant states that CMYK soft proofing existed in 6.0 and was removed in 6.3 (summary).
- **Blocked:** Adobe's soft-proofing help page (`helpx.adobe.com/lightroom-classic/help/soft-proofing-photos.html` and `…/soft-proofing.html` gave fetch errors).
- **Not found:** the official profile list, and whether proofing changes Export.

### E3. Ctrl+N in Chrome/Edge — **Contradicted** (tabs: reserved; PWA app windows and fullscreen: not reserved)
- Chromium `chrome/browser/ui/browser_command_controller.cc` (main), https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/ui/browser_command_controller.cc, in `IsReservedCommandOrKey`:
  - `// In Apps mode, no keys are reserved.` with `if (browser_->GetType() == BrowserWindowInterface::Type::TYPE_APP ||` / `browser_->GetType() == BrowserWindowInterface::Type::TYPE_APP_POPUP) {`
  - `// In fullscreen, all commands except for IDC_FULLSCREEN and IDC_EXIT should`
  - Default reserved set: `return command_id == IDC_CLOSE_TAB || command_id == IDC_CLOSE_WINDOW ||` … `command_id == IDC_NEW_WINDOW || command_id == IDC_RESTORE_TAB ||` … `command_id == IDC_CYCLE_TO_PREV_TAB || command_id == IDC_EXIT;`
- Caveats: the Ctrl+N → `IDC_NEW_WINDOW` mapping (accelerator table) could not be fetched (error), although that mapping is the usual one. Edge was not checked separately. It is Chromium-based, but Microsoft could patch this. Needs a local test in an installed PWA window.

### E4. Monitor ICC; colour-managed `display-p3` canvas — **Partly**
- Media Queries 4, https://drafts.csswg.org/mediaqueries-4/: "The color-gamut media feature describes the approximate range of colors that are supported by the UA and output device." · "In most cases the author does not need to know the exact capabilities of the display, just whether it is better than sRGB, or significantly better than sRGB." No spec or API exposing the ICC profile was found. A negative cannot be proven by citation.
- WebGPU (W3C TR), https://www.w3.org/TR/webgpu/: "WebGPU does not provide color management." · "WebGPU does interface with color-managed outputs (via GPUCanvasConfiguration) and inputs"
- BCD, https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/HTMLCanvasElement.json, `getContext.2d_context.options_colorSpace_parameter`: Chrome `"version_added": "92"`, Edge mirror, **Firefox `"version_added": false`**, Safari `"15.2"`.
- Firefox colour management (Bugzilla 1488619, status NEW, updated 2026-07-04), https://bugzilla.mozilla.org/show_bug.cgi?id=1488619: "the default of gfx.color_management.mode remains "2" instead of "1"." A later comment says "Firefox is currently not doing any color management".
- **Blocked or unread:** the WHATWG canvas colour-space section (the page text was truncated before that section; one permission prompt timed out).

### E5. lcms-wasm — **Partly**
- unpkg listing, https://app.unpkg.com/lcms-wasm@1.0.5/files/dist: `lcms.wasm` **316 kB**, `lcms.js` 67.6 kB, `lcms.min.js` 41.4 kB. Version 1.0.5 is tagged "latest".
- `dist/lcms.js`, https://unpkg.com/lcms-wasm@1.0.5/dist/lcms.js: `var _cmsCreateProofingTransform=Module["_cmsCreateProofingTransform"]=createExportWrapper("cmsCreateProofingTransform");` and `Module.cmsCreateProofingTransform=cmsCreateProofingTransform;`. `cmsCreateTransform` and `cmsDoTransform` are present. `cmsSetAlarmCodes` and `cmsCreateExtendedTransform` are absent.
- README (https://unpkg.com/lcms-wasm@1.0.5/README.md): the licence is MIT, the API is low-level, and `test/` has a CMYK→sRGB demo with user-supplied ICC files (summary; the README was not quoted in full).
- **Not found (needs local test):** time to build 33³ and 65³ proof LUTs in a worker.

### E6. RawTherapee and ART snapshots — **Partly** (RawTherapee **Contradicted**)
- RawPedia, https://rawpedia.rawtherapee.com/Sidecar_Files_-_Processing_Profiles: "(ranking information, the history panel contents and snapshots are not stored in these files yet, see issue #473)."
- RawPedia text quoted on discuss.pixls.us (2022-12-18), https://discuss.pixls.us/t/snapshots-file-location/34174: "For now, the history and snapshots are lost when you load a new photo in the Image Editor or close RawTherapee."
- ART (Alberto Griggio, ART's author, 2021-08-05; secondary forum), https://discuss.pixls.us/t/art-feature-requests-and-discussion/16277/939: "This is by design. The save button saves the *current* parameters." He suggests user commands to save or load "complete .arp sidecars", which copy the sidecar "including all the snapshots". So ART snapshots live in the `.arp` sidecar. The version that introduced this was not found.

### E7. Photoshop Discover; Lightroom tool search — **Partly**
- Adobe Community "Quick Tip" (Pattie-F, community "Legend", 2021-08-04; secondary), https://community.adobe.com/t5/photoshop-ecosystem-discussions/quick-tip-discover-one-click-workflows-and-more/m-p/12229461: shortcut "Cmd/Ctrl + F". The search covers "tools, panels, windows, and menu items as well as in-app tutorials, articles, and Quick Actions." The deep link carries `source.version=22.0`.
- Adobe help "Access Discover panel in Photoshop" (modified 2026-02-23), https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/access-discover-panel.html: the body did not render. Only the description was readable: "Learn how to open and use the Discover panel in Adobe Photoshop for contextual help, tutorials, and quick actions."
- LrC release notes (updated 2026-09-29), https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/release-notes.html: the 14.4 (June 2025) to 15.6 (Sept 2026) entries list no tool, command or slider search. The 15.0 notes mention faster hover previews "over presets, history, and snapshots". LrC shortcuts: "Find photo in the Library module | Ctrl + F | Command + F".
- Lightroom (cloud) desktop and mobile were not checked.

### E8. BCD `GPUCanvasContext.configure` — **Partly**
- https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/GPUCanvasContext.json, `configure`:
  - Chrome: `"version_added": "144"` with note "Supported on ChromeOS, macOS, Windows, and Linux (Intel Gen12+ GPUs only).", **and** `"version_added": "113"`, `"version_removed": "144"`, `"partial_implementation": true`, note "Supported on ChromeOS, macOS, and Windows."
  - Chrome Android `"121"`. Edge mirror. Firefox `"141"` with `partial_implementation`, and notes that it does not support Linux or Intel Macs. Safari `"26"`.
  - `configure.toneMapping`: Chrome 129 partial / 144. Firefox and Safari `false`.
- The "144" is not wrong. It is when BCD stops calling Chrome's support partial (Linux added). The first shipping version is 113.

## Unresolved items
1. Lightroom snapshot XMP structure, and whether applying a snapshot adds a history step. Needs a Lightroom-written sidecar with snapshots.
2. Official LrC soft-proof profile list and Export interaction. Adobe's soft-proofing help page was blocked here.
3. Ctrl+N behaviour in an installed Edge/Chrome PWA window (the source says it is delivered). Needs a local test, including whether `preventDefault()` stops a new window opening.
4. Speed of building 33³ and 65³ proof LUTs with lcms-wasm in a worker. Needs a local benchmark.
5. WHATWG canvas colour-space wording. The page was truncated in fetch.
6. Which ART version began saving snapshots in `.arp`.
