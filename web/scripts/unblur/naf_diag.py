"""Unblur spike: is NAFNet-GoPro's failure on some photos the model's or the tiling's? The authors' PyTorch NAFNetLocal
on the whole image (their test protocol: TLC local pooling, padded to a multiple of 16) against the 256 x 256 tiled
ONNX export, on the same pairs, scored with RealBlur's metric; and the share of output values far outside [0, 1].

  python -I naf_diag.py --repo NAFNet --weights NAFNet-GoPro-width64.pth --onnx nafnet_gopro64_256_fp32.onnx
                        --pairs list.txt --root DIR --out r.json
"""
import argparse
import json
import os
import sys
import time

import numpy as np
import torch
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tiling  # noqa: E402
import unblur_models as um  # noqa: E402


def load(p):
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) / 255.0


def wild(y):
    return float(np.mean((y < -0.1) | (y > 1.1) | ~np.isfinite(y)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--weights", required=True)
    p.add_argument("--onnx", required=True)
    p.add_argument("--pairs", required=True)
    p.add_argument("--root", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--clip-after", action="store_true")
    a = p.parse_args()
    torch.set_num_threads(4)
    net, _ = um.build_nafnet(a.repo, a.weights, local=True)
    run = tiling.Runner(a.onnx, 4)
    rows = []
    for line in open(a.pairs):
        parts = line.split()
        if len(parts) < 2:
            continue
        gt, bl = load(os.path.join(a.root, parts[0])), load(os.path.join(a.root, parts[1]))
        t = time.time()
        with torch.no_grad():
            whole = net(torch.from_numpy(bl.transpose(2, 0, 1)[None].copy()))[0].numpy().transpose(1, 2, 0)
        tw = time.time() - t
        run.reset()
        tiled = tiling.tiled(bl, run, 256, 32)
        row = {"pair": parts[1], "input": tiling.realblur_metric(bl, gt, clip_after=a.clip_after)["psnr"],
               "wholeTorch": tiling.realblur_metric(whole, gt, clip_after=a.clip_after)["psnr"], "wholeWild": wild(whole), "wholeS": round(tw, 1),
               "tiled256": tiling.realblur_metric(tiled, gt, clip_after=a.clip_after)["psnr"], "tiledWild": wild(tiled), "wildTiles": run.wild, "tiles": run.calls,
               "inputMean": float(bl.mean())}
        rows.append(row)
        print(json.dumps(row), flush=True)
    json.dump(rows, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
