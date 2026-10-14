> **Provenance:** independent verification run in Claude Cowork for the owner, 2026-10-13/14 (batch 2, prompt `COWORK_VERIFY_2026-10-13b`). Copied verbatim below this line; not re-verified here except where INDEX.md's spot-check log says so.

# Part D: Camera profiles and looks — verification

Read date for every source below: **2026-10-13**. Source brief (context only): `docs/research/PROFILES.md` on branch `lightbench/research-2026-10-13c`.

Verdict counts: **Confirmed 0 · Partly 7 · Contradicted 0 · Not found 2** (D5 contains one contradicted sub-claim: the Adaptive Color date).

## Decisions this changes

| Claim | Verdict | What LightBench should do differently |
|---|---|---|
| D1 `crs:CameraProfile` strings; Adobe Color as `crs:Look` | Not found (needs sample) | Keep "read, never write". A secondary forum post says the Adobe Color *profile file* references `crs:CameraProfile="Adobe Standard"`, so expect Adobe Color sidecars to carry Adobe Standard plus a Look. Build the mapper to read both `CameraProfile` and `Look/Name`. |
| D2 DNG spec defines `.dcp`; patent licence covers reading `.dcp` | Partly | Licence text quoted below. It covers "computer files compliant with the DNG Specification" under claims "unavoidably infringed by implementation of the DNG Specification", and requires the notice "This product includes DNG technology under license by Adobe." LightBench already reads DNG, so check that this notice is in its source and docs **now**. Whether a stand-alone `.dcp` is such a file is a question for counsel. No legal conclusion is given here. |
| D3 `ProfileEmbedPolicy` values | Partly | Values 0–3 confirmed (secondary mirror of the spec). What Adobe's own DCPs set: Not found. If LightBench ever reads DCPs, honour the policy (don't re-embed 1/2 profiles into exported DNGs). |
| D4 Creative profile Amount 0–200, default 100 | Partly | Keep 0–200, default 100 for built-in looks. The range is Adobe-stated only for Adaptive; for creative profiles it is a secondary source (2018). Show Amount for **look/creative** groups only and dim it for base profiles (as Adobe does). |
| D5 Adobe Color default since LrC 7.3 (Apr 2018); Adaptive Color 2023 | Partly (Adaptive date **Contradicted**) | Adaptive profiles shipped as a **beta in ACR 17 (Oct 2024)** and are documented in **LrC's February 2025** release. Correct the brief. The "new default only for new imports" rule matches LightBench's freeze plan. |
| D6 Licences of RawTherapee Hald CLUT pack and G'MIC presets | Not found | Neither page states a licence for the CLUT data. Pat David says some CLUTs were "reverse-generated from other color curve packages". **Do not bundle** either pack, and keep user import only. |
| D7 darktable camera styles' origin | Partly | Shipped in darktable **5.0 (Dec 2024)** for more than 500 cameras, and they affect only contrast, brightness and saturation. A forum post says one developer made them from raw.pixls.us samples, by eye. Treat them as rough starting points, not calibrated camera matching. |
| D8 Capture One profiles, curves, LUT import | Partly | Profiles and curves confirmed. Native `.cube` import was not found in support docs. Don't claim Capture One LUT parity. |
| D9 Copy Settings has "Treatment & Profile" | Partly | It existed from 2018 to 2023 (user reports plus an Adobe staff reply). LrC 14.5 (Aug 2025) reworked copy-paste subsets, and the current help page doesn't list checkboxes. Still add "Profile" to LightBench's checklist, under LightBench's own label. |

## Item-by-item

### D1. `crs:CameraProfile` strings and `crs:Look` — **Not found (needs local test/sample)**
- ExifTool 3.79 source (secondary) defines a `Look` struct in the `crs` namespace with `Name`, `Amount`, `Cluster`, `UUID`, `SupportsMonochrome`, `SupportsAmount`, `SupportsOutputReferred`, `Copyright`, `Group` and a nested `Parameters` block, plus top-level `CameraProfile   => { },` (https://raw.githubusercontent.com/exiftool/exiftool/master/lib/Image/ExifTool/XMP.pm).
- Adobe Community thread (2018-04-07, user deejjjaaaa, not Adobe staff; secondary), https://community.adobe.com/questions-563/where-the-dcp-files-related-to-adobe-color-182856: Adobe Color "is XMP "Enhanced" preset profile, it is not a genuine DCP camera profile" and it "references some external dcp camera profile by name", with the inline fragment `crs:CameraProfile="Adobe Standard"`. An Adobe employee (max.wendt, 2018-04-11) answered in the same thread: "Yes, the look table of an enhanced profile is applied immediately after the look table of the DCP profile base."
- This describes the profile *file*, not a photo sidecar. No public Lightroom-written photo XMP showing Adobe Color, Adobe Standard or a Camera Matching profile was found.

### D2. DNG spec and `.dcp`; patent licence text — **Partly**
- **Spec PDF blocked:** `helpx.adobe.com/.../DNG_Spec_1_7_1_0.pdf` (robots disallowed) and `www.adobe.com/content/dam/help/en/photoshop/pdf/DNG_Spec_1_7_1_0.pdf` (fetch error). The DNG Profile Editor PDF was also blocked.
- Secondary mirror of the spec's tag text (AWare Systems, ExtraCameraProfiles), https://awaresystems.be/imaging/tiff/tifftags/extracameraprofiles.html: "The format of a camera profile begins with a 16-bit byte order mark (MM or II)" … "followed by a 16-bit "magic" number equal to 0x4352 (CR), a 32-bit IFD offset, and then a standard TIFF format IFD." This defines the camera-profile structure inside a DNG. The page does not mention stand-alone files.
- discuss.pixls.us (kmilos, 2023-04-03; secondary), https://discuss.pixls.us/t/need-to-parse-dcp-camera-profile-created-with-dcamprof/36364: "The details are in the “ExtraCameraProfiles” section of the DNG spec." and a DCP is "a minimal TIFF-like container to store DCP related tags just like inside a DNG."
- DNG SDK header (`dng_camera_profile.h`, SDK 1.4 mirror; secondary): "Parse from an extended profile stream, which is similar to stand alone" (https://os.unplugged.com/werunplugged/unplugged-system/src/branch/main/external/dng_sdk/source/dng_camera_profile.h).
- **Patent licence** (Adobe, "DNG Specification patent license" section), https://helpx.adobe.com/camera-raw/digital-negative.html:
  - "Adobe hereby grants all individuals and organizations the worldwide, royalty-free, nontransferable, nonexclusive right" … "under all Essential Claims to make, have made, use, sell, import, and distribute Compliant Implementations."
  - "Subject to the terms below and" "solely to permit the reading and writing of image files that comply with the DNG Specification"
  - "“Compliant Implementation” means a portion of a software or hardware product that reads or writes computer files" … "compliant with the DNG Specification."
  - "“DNG Specification” means any version of the Adobe DNG Specification made publicly available by Adobe"
  - "“Essential Claim” means a claim of a patent, whenever and wherever issued," "that Adobe has the right to license without payment of royalty or other fee that is" "unavoidably infringed by implementation of the DNG Specification."
  - "Adobe may revoke the rights granted above to any individual or organizational licensee" (the trigger is a patent action against Adobe over DNG reading or writing; summary, not a quote).
  - Attribution: "Any Compliant Implementation distributed under this license must include the following notice" … "displayed in a prominent manner within its source code and documentation": "This product includes DNG technology under license by Adobe."
  - "The rights granted herein are provided on an as-is basis without warranty of any kind"
- **What it literally covers:** the reading or writing of "computer files compliant with the DNG Specification", limited to Essential Claims. The text never mentions `.dcp`, camera profiles or stand-alone profile files. Whether a stand-alone DCP is a "file compliant with the DNG Specification" is not answered by the text. This is not legal advice.
- **Not found:** a separate `PATENTS` file in the DNG SDK. The SDK is a ZIP behind `adobe.com/go/dng_sdk` (1.7.1, listed as Build 2611 on the downloads page and Build 2652 on the help page), and it was not downloaded. The Adobe downloads page does not mention a PATENTS file.

### D3. `ProfileEmbedPolicy` — **Partly**
- AWare Systems (secondary, mirrors spec), https://www.awaresystems.be/imaging/tiff/tifftags/profileembedpolicy.html: "Code50941 (hex 0xC6FD)" · "Used in IFD 0 or Camera Profile IFD of DNG files." · 0 "allow copying": "The camera profile can be used to process, or be embedded in, any DNG file." · 1 "embed if used": like 0 "except it does not allow copying the camera profile from a DNG file" "for use in processing any image other than the image in which it is embedded." · 2 "embed never": "These stored profiles can be used to process images but cannot be embedded in files." · 3 "no restrictions": "The camera profile creator has not placed any restrictions on the use of the camera profile."
- DNG SDK header (secondary): `fEmbedPolicy` "Rules for how this profile can be embedded and/or copied."
- **Not found:** the value in Adobe's own DCPs. The ExifTool forum was down ("The ExifTool forum is currently unavailable…"), and an Adobe Community thread was robots-blocked.

### D4. Creative profile Amount — **Partly**
- Adobe LrC help "Work with image tone and color" (updated 2025-02-13), https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/image-tone-color.html: "Lightroom Classic provides an additional Amount slider to control profile intensity." It applies "When you apply any of the Artistic, B&W, Modern, and Vintage profiles", and "For other profiles, the Amount slider is dimmed/inactive." For Adaptive: "Once applied, you can adjust the intensity with the slider in the range of 0 to 200."
- Adobe ACR help (updated 2025-02-13), https://helpx.adobe.com/camera-raw/desktop/edit-and-enhance-images/tone-and-color/adjust-color-rendering-camera-camera.html: "When you apply any of the Adaptive, Artistic, B&W, Modern, and Vintage profiles, an Amount slider lets you manually adjust the intensity of the profile."
- PetaPixel 2018 (secondary), https://petapixel.com/2018/04/03/a-closer-look-at-lightrooms-new-and-improved-profiles/: Amount "by default allows you to scale the effect down to 0, or up to 200. The default value is 100/as designed."
- So 0–200 is Adobe-stated only for Adaptive. Default 100 is secondary only.

### D5. Adobe Color default; Adobe Adaptive Color — **Partly** (Adaptive date **Contradicted**)
- Adobe blog, 2018-04-03 (Josh Haftel), https://blog.adobe.com/en/publish/2018/04/03/april-lightroom-adobe-camera-raw-releases-new-profiles: "Since Adobe Color is the new default (but only for newly imported photos)". Version: the post links "lr-classic-cc-7-3" and names ACR 10.3. Lightroom Queen (secondary, 2018-04-03): "Lightroom Classic CC 7.3 has been released today." (https://www.lightroomqueen.com/whats-new-in-lightroom-classic-73/)
- Current Adobe help: Adobe Color "is applied by default to the raw photos that you import in Lightroom Classic."
- Adaptive: Greg Benz (secondary, 2024-10-14), https://gregbenzphotography.com/lightroom-acr/acr-17-ai-adobe-adaptive-profiles-non-destructive-denoise-generative-expand, says it arrived in "Adobe Camera RAW (ACR) v17", was labelled "Adobe Adaptive (beta)", is "AI-based", and works by "analyzing the image to generate a custom profile". Adobe LrC February 2025 feature summary, https://helpx.adobe.com/lightroom-classic/help/whats-new/2025-2.html: "The Adaptive profiles help with image-adaptive adjustments in color, tone, and contrast of raw images." The brief's "2023" is not supported.

### D6. Hald CLUT and G'MIC preset licences — **Not found**
- RawPedia Film Simulation, https://rawpedia.rawtherapee.com/Film_Simulation: no licence is stated. It credits Pat David, Pavlov Dmitry and Michael Ezra, and has a trademark note: "They serve only to inform the user which film stock the given HaldCLUT image is designed to approximate."
- Pat David (2023-05-13; secondary), https://discuss.pixls.us/t/how-was-the-rawtherapee-film-simulation-collection-created-and-thanks/34265: "Some of those CLUTs were likely also reverse-generated from other color curve packages".
- G'MIC colour presets, https://gmic.eu/color_presets/: "1100+ color CLUTs available". The licence statement covers the software only: "distributed under the CeCILL free software licenses (LGPL-like and/or GPL-compatible)". Sample photos are "distributed a minima under CC-by-SA 2.0." The page credits many CLUT authors (RawTherapee Creative Pack, PictureFX/Marc Roovers, Pat David, Stuart Sowerby, Juan Melara …) and states no licence for the CLUT data.
- The Hald CLUT ZIP was not downloaded (no fetching of archives), so any licence file inside it is unread.

### D7. darktable camera styles — **Partly**
- darktable 5.0.0 release notes (tag `release-5.0.0`), https://raw.githubusercontent.com/darktable-org/darktable/release-5.0.0/RELEASE_NOTES.md: "Added camera-specific styles for more than 500 camera models to more closely approximate the out-of-camera JPEG rendition." · "These styles only affect contrast, brightness, and saturation and do not attempt to match sharpening, denoising, or hue shifts." The darktable.org announcement for 5.0.0 (December 2024) says the same: https://darktable.org/2024/12/darktable-5.0.0-released
- Manual, https://docs.darktable.org/usermanual/5.6/en/module-reference/utility-modules/lighttable/styles/: "A large selection of “camera” styles is provided with darktable." · "These styles are designed to approximate the out-of-camera JPEG look for supported camera models"
- Authorship (secondary, Mica/paperdigits, 2025-01-14), https://discuss.pixls.us/t/missing-darktable-5-0-camera-profiles/47625: "this new feature was the effort of one developer" who "took samples from raw.pixls.us". The poster believes the developer "just eyeballed all of them" (hedged in the original).
- `data/styles/CMakeLists.txt` installs `darktable*.dtstyle` and `examples*.dtstyle`. **Blocked:** the GitHub tree and history views (robots), so the commit author was not read.

### D8. Capture One — **Partly**
- "The Base Characteristics panel overview", https://support.captureone.com/hc/en-us/articles/360002588917: "Despite the name, the Generic profile is created by Capture One specifically for each supported camera" · "ProStandard profiles are also camera-specific and are designed to better preserve hues across color gradients"
- Curves, https://support.captureone.com/hc/en-us/articles/360002424317-What-is-the-Curve-section-of-the-Base-Characteristics-tool: the options are Auto, Film Standard, Film Extra Shadow, Film High Contrast, Linear Response and Linear Scientific. Film Standard "is designed to give a similar look to transparency film with deep blacks and bright mid-tones and highlights." Linear Scientific: "This is a completely linear curve response used for ICC profile creation."
- LUT import: **Not found** in support articles. A community request ("LUT support") was closed with a pointer to "a major request pending". Third-party tools convert `.cube` to Capture One ICC (e.g. fylm.ai), which suggests there is no native import, but that is not a primary source.

### D9. Copy Settings "Treatment & Profile" — **Partly**
- Adobe Community bug report (2018-05-02, LrC 7.3.1), https://community.adobe.com/bug-reports-674/p-automatically-checking-treatment-profile-box-when-i-check-some-of-color-adjustments-box-663575: "when i check some of color adjustments box, Lightroom 7.3.1 check the Treatment & Profile box." Adobe Community Manager reply (2018-08-22): "Lightroom Classic CC 7.5 was released today and should address this issue."
- User post (2023-09-13; secondary), https://community.adobe.com/t5/lightroom-classic-discussions/profile-not-working-mismatch-for-old-images/m-p/14099785/highlight/true: "I selected the "Treatment & Profile" checkbox when copying the settings."
- Current Adobe help (updated 2025-08-13), https://helpx.adobe.com/lightroom-classic/help/copy-paste-settings.html, does not mention "Treatment" or "Profile". It describes a Subset menu (All, None, Modified, Default, Save). The LrC release notes list "custom Copy-Paste subsets" in 14.5 (August 2025). The checkbox's presence in 14.5 and later is unverified.

## Unresolved items
1. Exact sidecar strings for Adobe Color, Adobe Standard and Camera Matching profiles, and whether Adobe Color writes `crs:Look`. Needs a Lightroom-written XMP.
2. DNG 1.7.1 spec text on camera profiles and stand-alone `.dcp`. The spec PDF is blocked from this machine and must be opened directly.
3. DNG SDK `PATENTS`/licence file text. The SDK ZIP was not read.
4. `ProfileEmbedPolicy` in Adobe's DCPs. Run `exiftool -ProfileEmbedPolicy` on an installed Adobe Standard DCP.
5. Hald CLUT and G'MIC CLUT data licences, and the commit author of darktable's camera styles.
6. Capture One native LUT support (version), if any.
