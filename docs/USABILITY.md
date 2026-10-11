# LightBench usability plan

_Drafted 2026-10-11. This combines three inputs:_
- _the owner's direction;_
- _two review studies: [REVIEWS_LIGHTROOM.md](research/REVIEWS_LIGHTROOM.md) and [REVIEWS_OPEN_SOURCE.md](research/REVIEWS_OPEN_SOURCE.md);_
- _the darktable code catalogue: [DARKTABLE_MODULES.md](DARKTABLE_MODULES.md)._

> **Evidence caveat.** Both review studies could not open web pages in full; fetching and Reddit were blocked. Their findings rest on search-result excerpts and full GitHub issues. Each finding there is tagged with how widespread it seems and cites its source. Treat those tags as judgement, not measurement.

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

## What darktable's own code offers here (from the catalogue)

- **The quick access panel is darktable's "Basic" panel.** It does no processing of its own; it shows sliders borrowed from the real modules in one list (`src/libs/modulegroups.c`). LightBench's Basic panel works the same way: Lightroom-named sliders that drive darktable modules.
- **"Basic adjustments" (`basicadj`) is deprecated** in favour of the quick access panel, because one module mixed operations that belong at different points of the pipeline. Its RawTherapee-derived auto exposure is still a reference for Auto.
- **darktable already imports Lightroom XMP** (`src/develop/lightroom.c`): exposure, crop, HSL, tone curve, split toning, clarity, grain, vignette and spots. This is a ready reference for Phase 2 migration.
- **Built-in module-group layouts**, including "workflow: beginner", and presets that apply automatically by camera, lens or ISO. These are darktable's answer to "defaults that look finished".

## Design rules for LightBench

### Develop panel layout

The right panel is ordered by how often people use each tool. The first section is always open; the rest are collapsible groups.

| Order | Group | Contents | Engine (darktable) | Status |
|---|---|---|---|---|
| 1 | **Basic** (always open) | Auto + look; White balance (preset, **Pick**, Temp, Tint); Tone (Exposure, Contrast, Highlights, Shadows, Whites, Blacks); Presence (Texture, Clarity, Dehaze, Vibrance, Saturation) | temperature, exposure, sigmoid, tone equalizer, colour balance rgb, local contrast, haze removal | Built, except Texture/Clarity/Dehaze and colour balance rgb |
| 2 | **Tone curve** | Parametric + point, RGB | rgb curve | Phase 3 |
| 3 | **Colour** | Colour mixer (HSL), Colour grading, Point colour | colour equalizer, colour balance rgb | Phase 3 |
| 4 | **Detail** | Sharpening, Noise reduction | diffuse or sharpen / sharpen, denoise (profiled) | Phase 3 |
| 5 | **Optics** | Lens profile, Chromatic aberration, Vignetting | lens correction (lensfun), CA correction | Phase 3 |
| 6 | **Geometry** | Crop, Straighten, Transform/Upright | crop, rotate and perspective (ashift) | Crop: Phase 1; rest: Phase 3 |
| 7 | **Effects** | Vignette, Grain | vignette, grain | Phase 3 |
| — | **Masks** (own panel) | AI subject/sky, brush, linear, radial, then colour/luminance range refinement | drawn + parametric masks, blending | Phase 3–4 |

Every group follows the same rules:
- **One control per job.** Alternative algorithms (e.g. sigmoid / filmic / AgX for tone mapping) go in a **Method** dropdown inside the group, not in separate modules.
- **"Advanced ▸"** inside each group shows the darktable module's own parameters, so no capability is lost.
- **Solo mode** (proposed): opening one group closes the others, so the panel never becomes a long scroll. It can be switched off.
- **Tool search** (proposed): `/` or Ctrl+F finds a tool by its Lightroom name, LightBench name or darktable name, e.g. "Clarity" → Presence → Clarity (local contrast).

### Guidance in the interface (owner's request)

- **Sublabel** under each control: a short plain-language line, e.g. "Bright areas (skies, clouds)". Switchable with the **Hints** checkbox.
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

## Decisions for the owner

1. **Hints default:** on for everyone (they can be switched off), or off with tooltips only?
2. **Solo mode** for the Develop groups: on or off by default?
3. **Browse before import:** add an "Open folder" view that lets you cull without importing? This is research lesson 11; LightBench's "Add photos in place" import already avoids copying.
4. **Tool search** (`/`): build it in Phase 2 or Phase 3?
