# LightBench: roadmap to 1.0

_First written on 2026-10-21 from `origin/main` at 0.6.9 and the open branches (a Cowork review); updated the same day with the owner's answers (section 6) and with what has merged since, up to 0.6.13, and the hardening build. Inferences are marked **[inferred]**. The plan behind it is [PLAN.md](PLAN.md); what each part does is in [PHASE3.md](PHASE3.md)._

## 1. Shipped (0.1.0 to 0.6.13)

- **Library:** Open folder in place, flags, stars and labels, keywords, collections, stacks (RAW+JPEG), virtual copies, Compare and Survey, culling view, IPTC metadata, culling helpers without AI (sharpness, shake, look-alikes, suggested rejects), day headings.
- **Import:** verified copies into dated folders, with renaming, a backup copy, a date filter, presets and RAW+JPEG stacking. Since 0.6.10: finished as soon as every file is copied and checked (sidecar details fill in afterwards, also after a restart), RAWs first, 2–3 copies at once, **RAW only**, and every step timed in the Diagnostics log ([PHASE3.md, "Import speed"](PHASE3.md#import-speed-owner-2026-10-20)).
- **Develop tools:**
  - Basic with a tunable Auto, the WB picker and clipping warnings.
  - Crop, Upright and lens corrections; X-Trans and phone DNGs.
  - Tone Curve, Colour Mixer and Point Color, Colour Grading, Detail.
  - Remove/Heal/Clone (no AI).
  - Presets, Sync, snapshots, soft proofing, section eyes, process versions.
  - Zoom levels (0.6.12): Fit, 25 % to 800 %, with keys and Ctrl/⌘ + wheel ([PHASE3.md, "Zoom levels"](PHASE3.md#zoom-levels-owner-2026-10-19)).
- **Masking:** Brush, Linear, Radial, Colour and Luminance ranges, combined, with local sliders; the **AI Depth range** (0.6.13), LightBench's first downloaded model, Depth Anything V2 Small, with the model delivery the later AI tools use ([PHASE3.md, Part 24](PHASE3.md#part-24-ai-depth-range-mask-and-model-delivery)).
- **Effects:** Texture, Clarity, Dehaze, vignette, Grain, Glow.
- **Export:** JPEG, PNG and TIFF in sRGB, P3 or Adobe RGB, with resizing, output sharpening, dither and pipelined multi-core encoding.
- **Sync/sidecars:** .xmp files written automatically. Lightroom's settings are read and written (its masks are read only). LightBench notices when another app changes a sidecar. Library backup and restore.
- **PWA/offline:** installable, works offline, update notice with release notes, opens files from the file manager.
- **Performance:** a shared CPU budget, multi-core Remove, background work that waits for Develop, a GPU benchmark.
- **Diagnostics:** System Check, GPU-loss recovery, a diagnostics recorder, an integrated-GPU tip.

**Since the first version of this roadmap:** `depth-mask` (0.6.13), `import-speed` (0.6.10) and `zoom-levels` (0.6.12) merged (PRs #61–#63). The Depth Anything model was pinned by the "AI models" Action on 2026-10-20; the real model has still not been run on the owner's GPU, and the import speed-up still needs a real card ([PLAN.md, "Owner tests pending"](PLAN.md#owner-tests-pending)).

**In flight (2026-10-21):**
- **Hardening and cleanup** (`lightbench/hardening`, no visible features): Develop's GPU error guard, the speed check, release tags and one-click rollback, and this docs refresh ([PHASE3.md, "Hardening and cleanup"](PHASE3.md#hardening-and-cleanup-owner-2026-10-21)).
- **AI Remove** (`lightbench/ai-remove`, Moebius), started after #62 merged, in parallel.

## 2. Planned but not built

| Item | Status | Open decisions |
|---|---|---|
| **AI Remove (Moebius)** | Decided; being built | Whether fp16 or fp32 (about 1.24 GB). Which guidance value (upstream gives 2.0, 2.5 and 4.5); strength 1.0 or 0.99 by test. A small model (MI-GAN) is "decide later". **Delivery decided 2026-10-21:** an in-app download from Hugging Face at a pinned commit ([research/PHASE4_MODELS.md](research/PHASE4_MODELS.md#ai-remove-delivery-and-licence-owner-2026-10-21)); the old "GitHub Release assets picked by hand" text is replaced. |
| **AI masks: click/hover, people/faces, sky, subject** | Decided 2026-10-21; in 1.0, after AI Remove | Under the relaxed model rule (option B), SAM 2.1, DA3-Metric-Large (sky), RF-DETR-Seg (people), MediaPipe Selfie Multiclass (an approved exception) and the models that passed before are eligible. Settle in the build: BiRefNet_lite's conflicting data lists, its WebGPU graph, MediaPipe's community ONNX on ONNX Runtime Web, an EfficientViT ONNX export, DA3-Metric's size and browser support ([research/AI_MODELS.md](research/AI_MODELS.md#owners-decisions-2026-10-21-ai-masks)). |
| **AI Denoise (RawNIND)** | Decided (GPL-3.0 exception) | Measure it against today's denoise on the owner's photos. Write the training-data notice. |
| **AI depth of field** | Researched; the depth model is now in | Apple's patent claims are unread. Which bokeh shapes to offer. |
| **Clipped highlight/shadow fill** | Needs decisions | MI-GAN's provenance and LaMa's licence; whether to start with highlights only. |
| **AI Auto, Auto for a mask** | Waits for the AI masks | — |
| **Faces and blinks** | Needs a decision | ONNX BlazeFace, or MediaPipe (which has telemetry). No embedding model passes the rule. YuNet passes for face boxes (AI_MASKS.md). |
| **Tool search** | Researched | Questions C1–C5. **Still open:** how results treat other apps' names (question 3 below). **[inferred]** The brief's "Lightroom: …" results clash with the no-notes rule. |
| **Camera profiles and looks** | Needs decisions | **Still open:** what v1 contains (question 4 below). Freeze "Standard"; `.cube` LUTs; DCP files; names that clash with Auto's looks. |
| **Library gaps** | Planned | Missing-file marking, keyword renaming and synonyms, collection sets, preset export, metadata undo, EXIF editing. Lightroom catalog import is postponed. |
| **Export extras** | Planned | AVIF, PNG optimisation, "Export with this profile". |
| **Release discipline** | Built in the hardening build, except the published minimum browsers and GPUs | A speed check on every push to main and every pull request (warnings only; no time budgets yet, as they must be confirmed on the owner's GPU first), release tags `v<version>`, one-click rollback ([ROLLBACK.md](ROLLBACK.md)). Not on GitHub's servers yet when written: the workflows were checked with actionlint, not run. |
| **Phase 5–6, Mobile** | Not started | What mobile is for is undecided. |

## 3. Known gaps and risks

1. **Only one real GPU, by decision.** Everything has been measured on the owner's laptop GPU, and the owner chose to test 1.0 on that laptop only (section 6). There are no AMD, Intel-only or Apple numbers, and most speed figures come from SwiftShader. Develop's own engine now has a GPU error guard (hardening build), tested only with a software GPU and a destroyed device, not with a real driver reset or out-of-memory error.
2. **Lightroom interop is unverified, and ships so.** No Lightroom-written sidecar has been tested for any field; the owner chose to ship without that check and to say so plainly (section 6).
3. **Firefox and Safari** were never tested.
4. **The owner's hardware tests are pending:** a real SD card, Edge picking `E:\`, a backup drive, the installed app's "Open with", pen and touch.
5. **Untuned:** culling thresholds, AF points beyond Sony and Fuji, print sharpening, and soft proofing with real printer profiles.
6. **Patents:** the Remove and Refine claims were only partly reviewed, and Apple's depth-of-field patents are unread. PHASE4 asks whether to "take advice before release".
7. **Depth mask:** sidecar size per range is unknown (between under 20 and about 78 KB in tests).
8. **Fragile user data:** copied settings are lost on reload, and presets live only in browser storage.
9. **Tech debt [inferred]:**
   - ~~PLAN.md and USABILITY.md are partly stale~~ (brought up to date in the hardening build); PHASE3.md has over 3,000 lines (kept in one file, with a table of contents).
   - There are about 55 remote branches, most of them merged (the owner prunes them).
   - ~~The Moebius delivery doc doesn't match the decision~~ (the decision is recorded; the AI Remove build documents the delivery itself).
   - Sliders have no stable ids, which tool search needs (a control registry; not in the hardening build).
10. **Rollback limits** (hardening build): rolling back past a release that raised the library's format makes the library unopenable in the earlier version until the newer one is deployed again (nothing is changed or lost); the workflow warns. See [ROLLBACK.md](ROLLBACK.md).

## 4. Order to 1.0 (owner, 2026-10-21)

At most two builds at a time.

1. **Hardening and cleanup**: Develop's GPU error guard, the speed check, rollback and the docs refresh. Branch pruning is the owner's; the control registry moves to tool search.
2. **AI Remove** (Moebius). The largest download, and its speed is unmeasured, so measure first. Started after #62 merged, next to step 1.
3. **AI masks**, in this order inside the build: click/hover select, people/faces, sky, subject. In 1.0.
4. **AI Denoise** (RawNIND). It reuses the AI runtime, and as an opt-in tool it leaves old edits unchanged.
5. **Tool search**, with the control registry it needs (naming still open).
6. **Camera profiles and looks** (v1 contents still open). Old edits don't change, because an absent value means Standard v1.
7. **Library and data gaps**: missing files, keyword renaming, preset export, keeping copied settings.
8. **1.0 release**: published minimum browsers and GPUs, the trust promise, notices, and a decision on patent advice.

The first version of this roadmap had an owner feedback batch, AI Denoise before AI Remove and a verification pass (another GPU class, Firefox and Safari, Lightroom-written sidecars, the card tests) before 1.0. The owner's order above has none of them: hardware is the owner's laptop only and Lightroom interop ships unverified. Where Firefox and Safari testing and the card tests go was not decided. AI depth of field and faces/blinks were "after 1.0 unless the owner says otherwise", and nothing has changed that.

## 5. Questions for the owner

1. **Should AI subject/sky masks be in 1.0?** (a) No, they come in 1.1 *(recommended)* · (b) Yes, which delays 1.0. — **Answered: yes, in 1.0**, after AI Remove and before AI Denoise (section 6).
2. **After the in-flight work, what comes first?** (a) Hardening and cleanup *(recommended)* · (b) AI Denoise. — **Answered: hardening and cleanup.**
3. **How should tool search treat other apps' names?** (a) Find tools by Lightroom and darktable names but show only LightBench's *(recommended)* · (b) Show "Lightroom: …" in results · (c) After 1.0. — **Still open.**
4. **Camera profiles v1?** (a) "Standard", LightBench's own looks and `.cube` import, no DCP *(recommended)* · (b) Also DCP files, after a legal check · (c) After 1.0. — **Still open.**
5. **Hardware before 1.0?** (a) Test one integrated-GPU laptop and one AMD or Apple machine *(recommended)* · (b) Use the owner's laptop only. — **Answered: the owner's laptop only.**
6. **How do we prove Lightroom interop?** (a) Verify against Lightroom-written .xmp files (from a trial or a friend) *(recommended)* · (b) Ship unverified. — **Answered: ship unverified, said plainly.**

## 6. Owner's answers (2026-10-21)

- Next build after PRs #61–#63 merge: **hardening + cleanup**. AI Remove starts after #62 merges.
- Hardware before 1.0: **the owner's laptop only**.
- Lightroom interop: **ship unverified** (say so plainly).
- AI subject/sky masks in 1.0: the owner asked whether research was done; it was (docs/research/AI_MODELS.md, 2026-10-11), and a check of the training data followed ([research/cowork-2026-10-21-ai-masks/AI_MASKS.md](research/cowork-2026-10-21-ai-masks/AI_MASKS.md)).
- **AI masks (2026-10-21, after AI_MASKS.md):** the model rule is relaxed to option B; MediaPipe Selfie Multiclass is approved as an exception; the AI masks build goes after AI Remove and before AI Denoise, and is in 1.0. Recorded in [research/PHASE4_MODELS.md](research/PHASE4_MODELS.md#model-rule-relaxed-owner-2026-10-21) and [research/AI_MODELS.md](research/AI_MODELS.md#owners-decisions-2026-10-21-ai-masks).
- **AI Remove (2026-10-21, after the Hugging Face check):** an in-app download from Hugging Face at a pinned commit, recorded in [research/PHASE4_MODELS.md](research/PHASE4_MODELS.md#ai-remove-delivery-and-licence-owner-2026-10-21).
- **The order:** hardening → AI Remove → AI masks (click/hover, people/faces, sky, subject) → AI Denoise → tool search → camera profiles → library gaps → 1.0.
- Still to ask: tool search naming (question 3) and camera profiles v1 (question 4).
