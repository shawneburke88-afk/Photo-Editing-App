# LightBench raw denoiser: training kit (draft)

Draft scripts for training LightBench's own raw denoiser on the owner's Windows PC (RTX 4000 Ada, 12 GB).
The plan, the reasoning and every unverified point are in [DENOISE_TRAINING_PLAN.md](../../docs/research/DENOISE_TRAINING_PLAN.md). **None of these scripts has been run
on data yet.** They were only syntax-checked, and the numpy helpers were tested on synthetic arrays.

| File | What it does |
|---|---|
| `prepare_data.py` | `list`: reads RawNIND's file list and licence fields from Dataverse and writes a download list (it downloads no images). `verify`: checks the downloaded files' sizes and checksums. `build`: packs Bayer raws to RGGB `.npy`, aligns each noisy/clean pair, gain-matches it, masks it and fits its noise. `profiles` and `calib` handle the noise models. |
| `dataset.py` | Real pairs, synthetic noise on clean frames, validation tiles. Augmentation keeps the RGGB phase. |
| `model.py` | A small U-Net on packed Bayer data, conditioned on the Poisson–Gaussian noise level (a, b). |
| `train.py` | bf16 AMP, AdamW with cosine LR, EMA weights, a checkpoint every 20 min, automatic resume, GPU temperature logging and a pause when hot, Windows keep-awake. |
| `export_onnx.py` | fp32 and fp16 ONNX at a fixed tile. Checks that every op is WebGPU-supported, compares onnxruntime with PyTorch and audits fp16 overflow. Writes SHA-256 and sizes. |
| `evaluate.py` | PSNR/SSIM on linear data plus detail metrics on the held-out scenes, comparing none, ours, RawNIND UtNet2 and profiled. Also writes 100 % crops of your own photos. |

## 1. One-time setup (Windows 11, PowerShell)

```powershell
# Python 3.12 (PyTorch 2.14 supports 3.10-3.14 per its RELEASE.md)
winget install -e --id Python.Python.3.12
# Optional: git, and aria2 for resumable bulk downloads (winget IDs from memory; `winget search aria2` if one fails)
winget install -e --id Git.Git
winget install -e --id aria2.aria2

mkdir D:\lb-denoise; cd D:\lb-denoise          # a fast SSD with room for the data (see DENOISE_TRAINING_PLAN.md 1.6)
# copy the scripts here, then:
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1                    # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
python -m pip install --upgrade pip

# PyTorch with CUDA. The plain `pip install torch` wheel for Windows on PyPI is CPU-only (about 124 MB),
# so use PyTorch's own index. 2.14 ships CUDA 12.6, 13.0 and 13.2 builds (RELEASE.md). Your driver 597.06
# reports CUDA 13.2, so cu132 should work; cu130 is the fallback. (The index URLs follow PyTorch's naming
# pattern; download.pytorch.org could not be opened from the machine that wrote this.)
pip install torch --index-url https://download.pytorch.org/whl/cu132

pip install numpy rawpy exifread pytorch-msssim onnx onnxruntime onnxconverter-common nvidia-ml-py pillow
```

Check the GPU:

```powershell
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0), torch.cuda.is_bf16_supported())"
# expected: ... True  NVIDIA RTX 4000 Ada Generation Laptop GPU  (8, 9)  True
python model.py      # prints parameters and GMAC per sensor megapixel for widths 16 / 24 / 32
```

Ada is compute capability 8.9. PyTorch's matrix lists 8.0/8.6/9.0 builds. 8.9 runs the 8.6 binaries, because CUDA
binaries run on later minor versions of the same major version (general CUDA rule, not re-checked here). If
`is_available()` is False, install the cu130 build.

## 2. Before a long run (laptop)

```powershell
powercfg /change standby-timeout-ac 0          # no sleep on mains power
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 10         # the screen may turn off; the GPU keeps working
```

- Pause Windows Update for the run (Settings → Windows Update → Pause updates), or set active hours. A forced
  reboot only costs up to 20 minutes of training, because the run resumes from the last checkpoint.
- Plug in the power adapter, choose "Best performance" in Windows power mode, pick the vendor's performance or
  fan profile, raise the back of the laptop and keep the vents clear.
- Close games, browsers with WebGPU tabs, and video apps. The desktop already uses about 1.3 GB of the 12 GB.
- Exclude `D:\lb-denoise\data` from Windows Defender real-time scanning. Optional; it speeds up reading thousands of
  files (Windows Security → Virus & threat protection → Exclusions).
- Watch the GPU in a second window: `nvidia-smi --query-gpu=temperature.gpu,clocks.sm,power.draw,memory.used --format=csv -l 60`

## 3. Data

```powershell
python prepare_data.py list --out data\manifest      # writes manifest.csv, download.txt, summary.json
type data\manifest\summary.json                       # READ the licence fields and total size first
aria2c -i data\manifest\download.txt -d data\rawnind\flat -c -x 4 -j 4
python prepare_data.py verify --manifest data\manifest\manifest.csv --dir data\rawnind\flat
python prepare_data.py build --raw data\rawnind\flat --out data\packed
python prepare_data.py profiles --out data\packed
# optional: clean low-ISO raws whose licence you have checked (your own, or CC0 files from raw.pixls.us)
#   python prepare_data.py build --raw data\rawnind\flat --out data\packed --extra-clean D:\clean_raws
# optional: compare our noise fits with darktable's profiles (for the browser's conditioning)
python prepare_data.py calib --out data\packed --darktable path\to\noiseprofiles.json
```

If `list` can't reach dataverse.uclouvain.be, open
`https://dataverse.uclouvain.be/api/datasets/:persistentId/?persistentId=doi:10.14428/DVN/DEQCIM` in a
browser, save the JSON, and run `python prepare_data.py list --api-json saved.json`.

## 4. Train

```powershell
# 1) how big a batch fits (prints peak memory per batch size); use about 75 % of the largest that ran
python train.py --data data\packed --out runs\w24 --width 24 --find-batch
# 2) a 30-60 minute pilot to check the pipeline end to end
python train.py --data data\packed --out runs\pilot --width 24 --batch 16 --samples 200000 --val-every 1000
# 3) the real run (resumes automatically if you run the same command again)
python train.py --data data\packed --out runs\w24 --width 24 --batch 16 --samples 4000000
```

DataLoader on Windows: workers are separate *spawned* processes, so every script keeps the
`if __name__ == "__main__":` guard and the datasets read memory-mapped `.npy` files (cheap to share). Start with
`--workers 6`. If the GPU sits below ~90 % utilisation in `nvidia-smi`, try 8. If RAM runs short, try 4. If anything
hangs at start-up, run with `--workers 0` to see the real error.

Not used on purpose: `torch.compile` (on Windows it needs Triton, which PyTorch doesn't ship for Windows, as far as is known),
and multi-GPU.

## 5. Export and evaluate

```powershell
python export_onnx.py --ckpt runs\w24\latest.pt --out export --tile 512 --calib data\packed
python evaluate.py pairs --data data\packed --ckpt runs\w24\latest.pt --onnx export\lb-rawdenoise-w24-t512.fp16.onnx `
    --rawnind-onnx path\to\darktable-ai\rawdenoise-nind\model_bayer.onnx --out eval\w24
python evaluate.py photos --raws D:\Photos\iso6400 --ckpt runs\w24\latest.pt --a 2e-4 --b 1e-6 --out eval\crops
```

`model_bayer.onnx` is inside darktable-ai's `rawdenoise-nind.dtmodel`, which is a zip archive (`darktable_ai/package.py`), from its
`release-5.6.0` GitHub release (57,700,134 bytes). The weights are GPL-3.0. It is used here only
locally, for comparison, and never shipped with or mixed into LightBench's weights.
