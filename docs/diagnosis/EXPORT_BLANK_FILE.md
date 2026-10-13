# Export writes a black file after a GPU error: diagnosis (main @ 60b1170, 2026-10-13)

Written by the main session from the diagnosis agent's report, which the agent could not save itself. The proposed fix (a diff kept outside the repository) has not been applied.

## Result
- **Reproduced.** After a GPU validation or out-of-memory error, export writes an all-black file and the dialog counts it as saved.
- **Device loss behaves differently.** No file is written, but the error text is raw ("Failed to execute 'mapAsync'…"), and every later photo in the batch fails with "Reload the page to continue".

## Root cause (`web/src/`)
- `engine/gpu/develop-engine.ts:289`: `uncapturederror` only logs to the console. There is no `pushErrorScope`/`popErrorScope` anywhere.
- `develop-engine.ts:1062-1171` (`renderOutput`): an invalid intermediate (out of memory, or a buffer over `maxStorageBufferBindingSize`/`maxBufferSize`) invalidates the command buffer. `queue.submit` only raises an uncaptured error.
- `develop-engine.ts:1174-1180`: the read-back buffer itself is valid, so `mapAsync` succeeds and returns zeros, which are treated as a good image.
- `develop-engine.ts:1060, 368`: `checkAlive()` runs once, before the GPU work. It checks only the asynchronous `lost` flag, never validation or out-of-memory errors.
- `export/run.ts:164-221`: the zero image is encoded, written and counted as saved.
- `export/run.ts:141`: one engine is used for the whole export and never recreated after a loss. `develop/batch.ts:188` already recreates its engine.

## Reproduction (headless Chromium + SwiftShader, through the real `runExport`)
| Case | Main | With fix |
|---|---|---|
| Baseline JPEG | 2 saved, correct (mean 142.35) | Same |
| Invalid intermediate texture on one photo (stands in for out-of-memory) | Saved, 1600×1072, every pixel 0 | That photo fails with a clear message, no file; the other saves correctly |
| 16-bit PNG at 400 %, device capped at WebGPU default limits (128 MiB binding, 256 MiB buffer) | 2 saved, 6400×4288, all black | Both fail, no files |
| Device destroyed once after the submit | A fails (raw AbortError), B fails ("Reload the page") | Retried on a fresh device; both saved correctly |
| Device destroyed on every attempt | not run | Both fail with "The graphics device was lost (driver reset).", no files |

**Unconfirmed:**
- Which real GPUs or browsers report limits as low as the capped case. At 128 MiB, a 16-bit export above about 16.7 MP would be black.
- A real out-of-memory error and a real driver reset were not produced. By the WebGPU spec, out-of-memory takes the same invalid-object path that was reproduced.
- Whether other browsers reject `mapAsync` on a loss, as Chromium does.

## Proposed fix
1. In `develop-engine.ts`:
   - Add `GpuWorkError`, with `kind` set to lost, out-of-memory, validation or internal.
   - Add `guarded(work)`, which pushes the three error scopes, runs `work`, then pops them. It throws `GpuWorkError` on a lost device, an `AbortError` or any scope that caught an error.
2. In `run.ts`:
   - Wrap each photo's load, process and render in `guarded`.
   - Recreate the engine if it has been lost.
   - Retry once on lost, out-of-memory or internal errors; never retry a validation error.
   - Failures go to the existing catch, so no file is written and the dialog lists the photo as failed.

Checks in the scratch clone: `tsc -b` clean, oxlint clean on both files, vitest `src/export src/engine` 337/337.

**Risk:**
- Low for export. Error scopes apply to the whole device, so `guarded` is only safe on an engine that nothing else uses at the same time. The export engine is private to `runExport`, so that holds; it must never be used on the shared Develop engine.
- Caught errors move from the console to the dialog.
- A retry develops one photo twice.

**Follow-ups:**
- Check the output buffer size against the device limits up front, for a friendlier message.
- Guard the 100 % preview (`library/preview.ts:183`) and the other unchecked read-backs (`develop-engine.ts` 734, 1540, 1582, 1664, 1710).

## Test plan
1. Unit-test `guarded` with a fake device.
2. Unit-test `runExport` with a mocked engine:
   - a validation error gives failed with no retry;
   - a loss gives a retry;
   - a second loss gives failed.
3. End to end with `probe-app.mjs`, plus one run through the real Export dialog.
4. Regression: output hashes for JPEG, 16-bit PNG and TIFF, plus the full vitest suite.
5. On real hardware: a large 16-bit export on a GPU with low limits, and `chrome://gpucrash` during an export.
