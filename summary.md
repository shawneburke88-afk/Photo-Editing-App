## AI Remove: Moebius check

`simonw/Moebius-ONNX` @ `5bf1ef5d2861ec01a727183a3f95dc64f352120e`, node v22.23.3, backend onnxruntime-node (CPU).

### Files

| file | bytes | SHA-256 | download |
|---|---|---|---|
| vae_encoder.onnx | 136,757,093 | ok | 1.5 s |
| unet.onnx | 906,698,976 | ok | 4.3 s |
| vae_decoder.onnx | 198,078,671 | ok | 1.2 s |

### Graphs

| graph | inputs → outputs | session |
|---|---|---|
| vae_encoder | image float32 [B, 3, 512, 512] → moments float32 [B, 8, Convmoments_dim_2, Convmoments_dim_3] | 234 ms |
| unet | latent float32 [B, 9, 64, 64], timesteps int64 [B], input_ids int64 [B, 10] → noise float32 [B, 4, 64, 64] | 2,086 ms |
| vae_decoder | latent float32 [B, 4, 64, 64] → image float32 [B, 3, 512, 512] | 97 ms |

### Removals (the app’s own code, CPU)

Photo: `philadelphia-768.png` (768 × 512). A 768 × 512 crop of the embedded preview of philadelphia.nef (Nikon D700) from immich-app/test-assets (commit ec56cc6, formats/raw/Nikon/D700), scaled to 33 %. That repository's README says: “All assets are public domain”.

Seed 1234, 20 steps, guidance 2.5.

| case | strength | crop → model | encode | step (mean) | decode | total | finite | spot changed (mean / max, 8-bit) | outside changed | patch (chars) | spot vs ring colour (8-bit) | resemblance to the removed object |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bin | 1 | 512×512 → 512×512 | 2,795 ms | 3,385 ms × 20 | 5,995 ms | 76.5 s | yes | 52.0 / 235 | none | 17,908 (70×119) | 13.7 | 0.543 |
| bin | 0.99 | 512×512 → 512×512 | 5,292 ms | 3,380 ms × 19 | 6,126 ms | 75.6 s | yes | 52.3 / 238 | none | 17,976 (70×119) | 13.1 | 0.540 |
| bollard | 1 | 512×512 → 512×512 | 4,872 ms | 3,452 ms × 20 | 5,959 ms | 79.9 s | yes | 62.9 / 144 | none | 30,468 (73×183) | 14.9 | 0.244 |
| bollard | 0.99 | 512×512 → 512×512 | 5,367 ms | 3,475 ms × 19 | 5,877 ms | 77.3 s | yes | 63.2 / 146 | none | 30,676 (73×183) | 15.7 | 0.240 |
| bollard-wide | 1 | 512×512 → 512×512 | 2,643 ms | 3,469 ms × 20 | 5,875 ms | 77.9 s | yes | 47.0 / 245 | none | 42,068 (91×188) | 26.8 | 0.370 |
| bollard-wide | 0.99 | 512×512 → 512×512 | 5,282 ms | 3,431 ms × 19 | 5,835 ms | 76.3 s | yes | 46.9 / 239 | none | 42,088 (91×188) | 26.7 | 0.383 |
| large | 1 | 533×512 → 512×492 | 2,787 ms | 3,440 ms × 20 | 5,826 ms | 77.4 s | yes | 39.4 / 143 | none | 40,176 (105×208) | 22.9 | 0.507 |
| large | 0.99 | 533×512 → 512×492 | 5,251 ms | 3,446 ms × 19 | 5,805 ms | 76.5 s | yes | 39.2 / 145 | none | 40,460 (105×208) | 22.3 | 0.511 |

Images (input with the spot outlined, the model’s 512 × 512 output, the result and its crop; `sheet-<case>.png`: original, then strength 1, then 0.99) are in the run’s **moebius-check** artifact. “Resemblance” is the correlation of the spot’s luminance with the original’s (1: the object is still there).

### CPU fallback speed (onnxruntime-web WebAssembly, 4 threads, in Node)

| graph | session | one run |
|---|---|---|
| vae_encoder | 440 ms | 13,870 ms |
| unet | 2,504 ms | 11,996 ms |
| vae_decoder | 180 ms | 30,977 ms |

One AI Remove spot runs the encoder once, the denoiser 20 times and the decoder once.

**RESULT: all checks passed.**

