"""Unblur spike: quality on public real-blur test pairs (RealBlur-J/-R, RSBlur; CC BY 4.0), ONNX Runtime CPU.

  python -I quality.py --pairs list.txt --root DIR --onnx model_256_fp32.onnx --protocol paper|tile|whole
                       [--tile 256 --overlap 32] --name LABEL --out results.json [--save-dir DIR --save N]

`list.txt` holds "gt blur" relative paths (the datasets' own list format). For each pair: the blurred input and the
model's output scored with RealBlur's evaluation (tiling.realblur_metric: 8-bit output, intensity-matched,
ECC-aligned to the sharp image, PSNR/SSIM over the valid region); the time per image and the number of model runs.
"""
import argparse
import json
import os
import time

import numpy as np
from PIL import Image

import tiling


def load(p):
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) / 255.0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--pairs", required=True)
    p.add_argument("--root", required=True)
    p.add_argument("--onnx", required=True)
    p.add_argument("--protocol", default="paper", choices=["paper", "tile", "whole"])
    p.add_argument("--tile", type=int, default=256)
    p.add_argument("--overlap", type=int, default=32)
    p.add_argument("--name", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--clip-after", action="store_true", help="RSBlur's script clips after alignment")
    p.add_argument("--save-dir")
    p.add_argument("--save", type=int, default=0)
    p.add_argument("--max-minutes", type=float, default=1e9)
    a = p.parse_args()
    run = tiling.Runner(a.onnx, a.threads)
    pairs = [l.split()[:2] for l in open(a.pairs) if len(l.split()) >= 2]
    rows = []
    t_start = time.time()
    for i, (gt_rel, blur_rel) in enumerate(pairs):
        if (time.time() - t_start) / 60 > a.max_minutes:
            print(f"time budget reached after {i} images", flush=True)
            break
        gt_p, bl_p = os.path.join(a.root, gt_rel), os.path.join(a.root, blur_rel)
        if not (os.path.exists(gt_p) and os.path.exists(bl_p)):
            continue
        gt, bl = load(gt_p), load(bl_p)
        run.calls = 0
        t = time.time()
        if a.protocol == "paper":
            out = tiling.paper_windows(bl, run, a.tile)
        elif a.protocol == "tile":
            out = tiling.tiled(bl, run, a.tile, a.overlap)
        else:
            out = run(bl)
        secs = time.time() - t
        m_out = tiling.realblur_metric(out, gt, clip_after=a.clip_after)
        m_in = tiling.realblur_metric(bl, gt, clip_after=a.clip_after)
        row = {"pair": blur_rel, "size": list(bl.shape[:2]), "runs": run.calls, "seconds": round(secs, 2), "input": m_in, "output": m_out,
               "nonFinite": int(np.sum(~np.isfinite(out)))}
        rows.append(row)
        print(f"{a.name} {i + 1}/{len(pairs)} {blur_rel}: input {m_in['psnr']:.2f}/{m_in['ssim']:.4f} -> {m_out['psnr']:.2f}/{m_out['ssim']:.4f} ({secs:.1f} s, {run.calls} runs)", flush=True)
        if a.save_dir and len(rows) <= a.save:
            os.makedirs(a.save_dir, exist_ok=True)
            trio = np.concatenate([bl, np.clip(out, 0, 1), gt], axis=1)
            Image.fromarray(np.round(trio * 255).astype(np.uint8)).save(os.path.join(a.save_dir, f"{a.name}_{len(rows):02d}.jpg"), quality=92)
    mean = lambda k, f: float(np.mean([r[k][f] for r in rows])) if rows else None  # noqa: E731
    res = {"name": a.name, "onnx": os.path.basename(a.onnx), "protocol": a.protocol, "tile": a.tile, "overlap": a.overlap if a.protocol == "tile" else None,
           "n": len(rows), "listed": len(pairs), "mean": {"inputPsnr": mean("input", "psnr"), "inputSsim": mean("input", "ssim"),
                                                          "outputPsnr": mean("output", "psnr"), "outputSsim": mean("output", "ssim")},
           "secondsPerImage": float(np.mean([r["seconds"] for r in rows])) if rows else None,
           "unaligned": sum(1 for r in rows if not r["output"]["aligned"] or not r["input"]["aligned"]), "rows": rows}
    json.dump(res, open(a.out, "w"), indent=1)
    print("RESULT " + json.dumps({k: v for k, v in res.items() if k != "rows"}), flush=True)


if __name__ == "__main__":
    main()
