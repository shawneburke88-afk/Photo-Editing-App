# Device loss when Develop and the background developer run together (main @ 60b1170, 2026-10-13)

Written by the main session from the diagnosis agent's report, which the agent could not save itself. Its probe scripts and logs were not committed.

## Cause
- `DevelopEngine.create('auto')` runs a present probe, `presentWorks()` (`web/src/engine/gpu/develop-engine.ts:338-361`, present at :351). It runs on every Develop mount (`develop/DevelopView.tsx:244`, twice under StrictMode in dev) and in System check (`engine/gpu/develop.ts:109-135`).
- In headless SwiftShader, Chromium cannot create a swap-chain SharedImage (BGRA_8888). It then drops the page's GPU channel:
  - **every GPUDevice in the page and its workers is lost** (reason "unknown", "A valid external Instance reference no longer exists.");
  - GPU-backed 2D canvases go blank (contextlost, then contextrestored).
- It is not memory, out-of-memory or the watchdog: 770 s of three 24 MP engines at once in read-back mode lost nothing (they were 2.5-8× slower).
- **Reproduced deterministically**:
  - in-page probe;
  - Chromium stderr (same GPU process pid, so a channel loss, not a crash);
  - in the app: a batch running when you enter Develop ends with "1 with problems … A valid external Instance reference no longer exists."
  - With `?gpu=readback` the same run is clean.
- **Real GPUs (inference):** normal hardware Chrome presents fine. Setups where WebGPU canvases can't present (software or blocklisted GPUs, some Linux/Vulkan drivers, VMs; see `develop.ts:43-44`) would lose all background work on every entry into Develop.
- **Separate memory risk** (integrated or mobile GPUs): Develop peaks at about 1.6 GB at 24 MP, the batch at about 1.1 GB per photo, all three engines together at about 3.5-4 GB (GPU-process RSS measured up to 5.0 GB). An out-of-memory error is only logged.

## Devices
- Each engine makes its own adapter and device (`develop-engine.ts:323-335`):
  - Develop (auto, so a probe device plus a second device, remade on every mount);
  - batch (read-back);
  - FullRenderer (read-back);
  - Export (read-back, one per run);
  - System check (auto).
- They share one GPU channel, so they share fate: separate devices give no isolation.

## Recovery today
| Component | After a loss |
|---|---|
| Develop | Shows the error; never recreated within a mount |
| Batch | Recreates the engine before the next photo (`batch.ts:188-190`); the photo in flight goes into "problems", no retry |
| FullRenderer | Never resets (`preview.ts:175`) |
| Export | One engine per run (`run.ts:141`), so every remaining photo fails |

## Fixes, ranked (not applied)
1. **One present probe per page, cached, skipped when `adapter.info.isFallbackAdapter`.** Low cost and low risk; removes the cause. Run it at app start-up, and use it in `DevelopRenderer` too. **e2e mitigation now:** load the app with `?gpu=readback`.
2. **Recovery everywhere** (needed anyway for driver resets and out-of-memory):
   - an `onLost` hook, and redraw on `contextrestored`;
   - Develop recreates its engine (an `engineGen` state);
   - FullRenderer resets its engine as the batch does;
   - Export uses a fresh engine per photo (see [EXPORT_BLANK_FILE.md](EXPORT_BLANK_FILE.md));
   - the batch retries once.
3. **Pause background GPU work while Develop is busy** (a foreground gate, about 40 lines).
4. **Release big textures sooner** (`unload()` after each batch/FullRenderer photo, saving 0.3-0.8 GB; reuse RCD temporaries).
5. **Bayer Stage A in strips**, like X-Trans (caps temporaries at about 200 MB). High cost.
6. **One shared device with a scheduler.** High cost; no robustness gain on its own.

## Separate e2e flake
The Develop canvas can report "ready" (width > 1) long before its first frame: 90.7 s vs about 159 s in one run. Pixel checks must wait for a drawn frame.
