"""Evaluate on the held-out RawNIND scenes, and make 100 % crops of the owner's photos for visual checks.

  python evaluate.py pairs --data data/packed --ckpt runs/w24/latest.pt \
      [--onnx export/lb-rawdenoise-w24-t512.fp16.onnx] [--rawnind-onnx model_bayer.onnx] \
      [--profiled-dir renders/profiled] --out eval/w24
  python evaluate.py photos --raws D:/Photos/high-iso --ckpt runs/w24/latest.pt [--rawnind-onnx ...] --out eval/crops

Methods: none (the noisy frame), ours (checkpoint and/or exported ONNX), rawnind (darktable-ai's GPL-3.0
`model_bayer.onnx`, run locally for comparison only), profiled (renders made by LightBench or darktable-cli,
supplied as <noisy stem>.npy float32 [3, H, W] linear camera RGB, not white balanced, same crop/orientation).

Common metric domain: half-resolution camera RGB (R, mean of the two greens, B). Every method can be brought
there without choosing a demosaic: packed outputs directly, full-resolution RGB outputs by 2x2 averaging. All
metrics are on linear data inside the pair's loss mask, plus PSNR after a sqrt (shadow-weighted).
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
import torch

from model import RawDenoiseUNet


# --------------------------------------------------------------------------------------------- inference


def tiled(fn, x: np.ndarray, tile: int, overlap: int) -> np.ndarray:
    """Run fn on [C, tile, tile] tiles with overlap, blending with a separable linear ramp. fn may change the
    channel count and scale the spatial size by an integer (RawNIND's Bayer model returns 2x)."""
    c, h, w = x.shape
    step = tile - overlap
    ys = list(range(0, max(h - tile, 0) + 1, step)) + ([h - tile] if h > tile and (h - tile) % step else [])
    xs = list(range(0, max(w - tile, 0) + 1, step)) + ([w - tile] if w > tile and (w - tile) % step else [])
    out = wsum = None
    for y in ys:
        for x0 in xs:
            t = x[:, y:y + tile, x0:x0 + tile]
            ph, pw = tile - t.shape[1], tile - t.shape[2]
            if ph or pw:
                t = np.pad(t, ((0, 0), (0, ph), (0, pw)), mode="reflect")
            r = fn(t)
            s = r.shape[1] // tile
            r = r[:, : (tile - ph) * s, : (tile - pw) * s]
            if out is None:
                out = np.zeros((r.shape[0], h * s, w * s), np.float32)
                wsum = np.zeros((1, h * s, w * s), np.float32)
            ramp = lambda n: np.clip((np.arange(n) + 0.5) / max(overlap * s, 1), 0, 1)  # noqa: E731
            wy = np.minimum(ramp(r.shape[1]), ramp(r.shape[1])[::-1]) if len(ys) > 1 else np.ones(r.shape[1])
            wx = np.minimum(ramp(r.shape[2]), ramp(r.shape[2])[::-1]) if len(xs) > 1 else np.ones(r.shape[2])
            wgt = (wy[:, None] * wx[None, :])[None].astype(np.float32) + 1e-6
            out[:, y * s:y * s + r.shape[1], x0 * s:x0 * s + r.shape[2]] += r * wgt
            wsum[:, y * s:y * s + r.shape[1], x0 * s:x0 * s + r.shape[2]] += wgt
    return out / wsum


def ours_torch(ckpt: str, dev: torch.device):
    st = torch.load(ckpt, map_location=dev, weights_only=False)
    net = RawDenoiseUNet(width=st["args"]["width"], cond=not st["args"].get("no_cond", False)).to(dev).eval()
    net.load_state_dict(st["ema"])

    def run(packed, a, b):
        def fn(t):
            with torch.no_grad():
                y = net(torch.from_numpy(t)[None].to(dev), torch.tensor(a).view(1, 4, 1, 1).to(dev),
                        torch.tensor(b).view(1, 4, 1, 1).to(dev))
            return y[0].clamp(min=0).cpu().numpy()
        return tiled(fn, packed, 512, 64)
    return run


def ours_onnx(path: str):
    import onnxruntime as ort
    s = ort.InferenceSession(path, providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    tile = s.get_inputs()[0].shape[-1]

    def run(packed, a, b):
        av, bv = np.float32(a).reshape(1, 4, 1, 1), np.float32(b).reshape(1, 4, 1, 1)
        return tiled(lambda t: s.run(None, {"x": t[None].astype(np.float32), "a": av, "b": bv})[0][0],
                     packed, tile, 64)
    return run


def rawnind_onnx(path: str):
    """darktable-ai rawdenoise-nind model_bayer.onnx: [1,4,512,512] RGGB in [0,1] -> [1,3,1024,1024] camRGB at an
    arbitrary gain, matched to the input mean afterwards (darktable-ai model card, 'Demo pipeline')."""
    import onnxruntime as ort
    s = ort.InferenceSession(path, providers=["CUDAExecutionProvider", "CPUExecutionProvider"])

    def run(packed, a=None, b=None):
        x = np.clip(packed, 0, 1)
        y = tiled(lambda t: s.run(None, {s.get_inputs()[0].name: t[None].astype(np.float32)})[0][0], x, 512, 64)
        half = to_half_rgb(y)
        ref = to_half_rgb(x)
        for c in range(3):
            half[c] *= ref[c].mean() / max(half[c].mean(), 1e-8)
        return half
    return run


# ---------------------------------------------------------------------------------------------- metrics


def to_half_rgb(arr: np.ndarray) -> np.ndarray:
    if arr.shape[0] == 4:  # packed RGGB
        return np.stack([arr[0], 0.5 * (arr[1] + arr[2]), arr[3]]).astype(np.float32)
    c, h, w = arr.shape  # full-resolution RGB -> 2x2 mean
    return arr[:, : h // 2 * 2, : w // 2 * 2].reshape(c, h // 2, 2, w // 2, 2).mean((2, 4)).astype(np.float32)


def box(img, r):
    from prepare_data import box_mean
    return box_mean(img, r)


def laplacian(img):
    p = np.pad(img, 1, mode="edge")
    return 4 * p[1:-1, 1:-1] - p[:-2, 1:-1] - p[2:, 1:-1] - p[1:-1, :-2] - p[1:-1, 2:]


def metrics(out: np.ndarray, gt: np.ndarray, noisy: np.ndarray, mask: np.ndarray) -> dict:
    m = mask.astype(bool)
    d = {}
    mse = ((out - gt) ** 2)[:, m].mean()
    d["psnr_lin"] = 10 * np.log10(1.0 / max(mse, 1e-12))
    so, sg = np.sqrt(np.clip(out, 0, None)), np.sqrt(np.clip(gt, 0, None))
    d["psnr_sqrt"] = 10 * np.log10(1.0 / max(((so - sg) ** 2)[:, m].mean(), 1e-12))
    try:
        from pytorch_msssim import ssim  # MIT
        d["ssim_sqrt"] = float(ssim(torch.from_numpy(so)[None], torch.from_numpy(sg)[None], data_range=1.0))
    except ImportError:
        d["ssim_sqrt"] = float("nan")
    # Detail on the green-ish luminance: textured = top 20 % of the clean frame's local Laplacian energy,
    # flat = bottom 20 %. Retention ~1 is ideal (<1 smoothed, >1 noise or invented detail); correlation shows
    # whether the kept detail is the *right* detail.
    yo, yg, yn = out.mean(0), gt.mean(0), noisy.mean(0)
    lo, lg, ln = laplacian(yo), laplacian(yg), laplacian(yn)
    eg = box(lg ** 2, 4)
    tex = m & (eg >= np.quantile(eg[m], 0.8))
    flat = m & (eg <= np.quantile(eg[m], 0.2))
    d["detail_retention"] = float(box(lo ** 2, 4)[tex].mean() / max(eg[tex].mean(), 1e-12))
    d["detail_corr"] = float(np.corrcoef(lo[tex], lg[tex])[0, 1])
    d["flat_noise_left"] = float((yo - yg)[flat].std() / max((yn - yg)[flat].std(), 1e-12))
    return d


# ------------------------------------------------------------------------------------------------ crops


def save_crop(path: Path, rgb: np.ndarray, wb, y: int, x: int, size: int = 384):
    """A quick preview, not LightBench's rendering: white balance, Rec.709-ish gamma, 8-bit PNG."""
    from PIL import Image  # HPND licence
    c = rgb[:, y:y + size, x:x + size] * np.asarray([wb[0] / wb[1], 1.0, wb[2] / wb[1]], np.float32)[:, None, None]
    c = np.clip(c / max(np.quantile(c, 0.995), 1e-6), 0, 1) ** (1 / 2.2)
    Image.fromarray((c.transpose(1, 2, 0) * 255 + 0.5).astype(np.uint8)).save(path)


# ------------------------------------------------------------------------------------------------- main


def cmd_pairs(args, methods):
    root, out = Path(args.data), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    index = json.loads((root / "index.json").read_text())
    rows = []
    for p in [p for p in index["pairs"] if p["split"] == args.split]:
        noisy = np.load(root / p["noisy"]).astype(np.float32)
        gt = np.load(root / p["clean"]).astype(np.float32) * np.asarray(p["gain"], np.float32)[:, None, None]
        mask = np.load(root / p["mask"])
        gt_h, noisy_h = to_half_rgb(gt), to_half_rgb(noisy)
        results = {"none": noisy_h}
        for name, fn in methods.items():
            results[name] = to_half_rgb(fn(noisy, p["a"], p["b"])) if name != "rawnind" else fn(noisy)
        if args.profiled_dir:
            f = Path(args.profiled_dir) / (Path(p["noisy"]).stem + ".npy")
            if f.exists():
                results["profiled"] = to_half_rgb(np.load(f).astype(np.float32))[:, : gt_h.shape[1], : gt_h.shape[2]]
        for name, r in results.items():
            row = {"scene": p["scene"], "iso": p["iso"], "camera": p["camera"], "method": name,
                   **metrics(r, gt_h, noisy_h, mask)}
            rows.append(row)
            print({k: (round(v, 4) if isinstance(v, float) else v) for k, v in row.items()})
        h, w = gt_h.shape[1:]
        for name, r in {**results, "gt": gt_h}.items():
            save_crop(out / f"{Path(p['noisy']).stem}__{name}.png", r, [2.0, 1.0, 1.5], h // 2 - 192, w // 2 - 192)
    with open(out / "metrics.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print("\nmean per method:")
    for name in sorted({r["method"] for r in rows}):
        sel = [r for r in rows if r["method"] == name]
        print(name, {k: round(float(np.nanmean([r[k] for r in sel])), 4) for k in
                     ("psnr_lin", "psnr_sqrt", "ssim_sqrt", "detail_retention", "detail_corr", "flat_noise_left")})


def cmd_photos(args, methods):
    """No ground truth: 100 % crops for a blind A/B. Pass the noise level with --a/--b (darktable's profile for
    the camera and ISO times the calibration ratio from `prepare_data.py calib`); nothing is estimated here."""
    from dataset import load_packed_raw
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for f in sorted(Path(args.raws).iterdir()):
        try:
            packed, meta = load_packed_raw(f)
        except Exception as e:  # noqa: BLE001
            print("skip", f.name, e)
            continue
        a, b = [args.a] * 4, [args.b] * 4
        h, w = packed.shape[1:]
        res = {"none": to_half_rgb(packed)}
        for name, fn in methods.items():
            res[name] = fn(packed) if name == "rawnind" else to_half_rgb(fn(packed, a, b))
        for (cy, cx) in ((h // 2, w // 2), (h // 4, w // 4), (3 * h // 4, 3 * w // 4)):
            for name, r in res.items():
                save_crop(out / f"{f.stem}_{cy}_{cx}__{name}.png", r, meta["wb"], cy - 192, cx - 192)
        print("crops for", f.name)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["pairs", "photos"])
    ap.add_argument("--data", default="data/packed")
    ap.add_argument("--split", default="test")
    ap.add_argument("--raws")
    ap.add_argument("--ckpt")
    ap.add_argument("--onnx")
    ap.add_argument("--rawnind-onnx")
    ap.add_argument("--profiled-dir")
    ap.add_argument("--a", type=float, default=2e-4, help="photos mode: noise a (from darktable x calibration)")
    ap.add_argument("--b", type=float, default=1e-6, help="photos mode: noise b")
    ap.add_argument("--out", default="eval")
    args = ap.parse_args()
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    methods = {}
    if args.ckpt:
        methods["ours"] = ours_torch(args.ckpt, dev)
    if args.onnx:
        methods["ours_onnx"] = ours_onnx(args.onnx)
    if args.rawnind_onnx:
        methods["rawnind"] = rawnind_onnx(args.rawnind_onnx)
    if args.mode == "pairs":
        cmd_pairs(args, methods)
    else:
        cmd_photos(args, methods)


if __name__ == "__main__":
    main()
