"""Export a trained checkpoint to ONNX (fp32 and fp16) for LightBench, and check it.

  python export_onnx.py --ckpt runs/w24/latest.pt --out export/ --tile 512 [--calib data/packed]

Writes export/lb-rawdenoise-<width>-<tile>.fp32.onnx and .fp16.onnx (inputs x [1,4,T,T], a [1,4,1,1],
b [1,4,1,1]; output [1,4,T,T]), and export/manifest-entry.json with byte sizes and SHA-256 (the fields
PHASE4_GROUNDWORK.md section 1.5 proposes for web/models/manifest.json).

Checks, all printed:
  1. every op in the graph is in the WebGPU-supported set below (onnxruntime-web 1.30 webgpu-operators.md
     plus the native EP's registrations; anything else would fall back to the CPU);
  2. onnxruntime (CPU) output vs PyTorch fp32 on random and, with --calib, real tiles;
  3. fp16 graph vs fp32 graph;
  4. the largest |activation| per layer on real tiles (fp16 overflows at 65504; darktable keeps RawNIND's Bayer
     model off FP16 on CoreML for exactly this, per darktable-ai's model card).
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from model import ExportWrapper, RawDenoiseUNet

WEBGPU_OK = {"Conv", "ConvTranspose", "MaxPool", "LeakyRelu", "Relu", "Concat", "Add", "Sub", "Mul", "Div",
             "Max", "Min", "Sqrt", "Clip", "Constant", "Identity", "Cast", "Shape", "Gather", "Unsqueeze"}


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def export(model: torch.nn.Module, path: Path, tile: int, opset: int):
    x = torch.rand(1, 4, tile, tile)
    a = torch.full((1, 4, 1, 1), 1e-4)
    b = torch.full((1, 4, 1, 1), 1e-7)
    kw = dict(input_names=["x", "a", "b"], output_names=["y"], opset_version=opset, do_constant_folding=True)
    try:  # the TorchScript exporter gives the plainest graph; newer torch defaults to the dynamo exporter
        torch.onnx.export(model, (x, a, b), str(path), dynamo=False, **kw)
    except TypeError:  # very old torch without the `dynamo` argument
        torch.onnx.export(model, (x, a, b), str(path), **kw)


def check_ops(path: Path):
    import onnx
    m = onnx.load(str(path))
    ops = sorted({n.op_type for n in m.graph.node})
    bad = [o for o in ops if o not in WEBGPU_OK]
    print(f"ops: {', '.join(ops)}")
    print("WebGPU op check:", "OK" if not bad else f"NOT in the supported set: {bad}")
    return not bad


def run_ort(path: Path, feeds: dict) -> np.ndarray:
    import onnxruntime as ort
    s = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    return s.run(None, feeds)[0]


def activation_audit(net: torch.nn.Module, tiles: list[dict]):
    peaks = {}

    def hook(name):
        def f(_m, _i, o):
            peaks[name] = max(peaks.get(name, 0.0), float(o.detach().abs().max()))
        return f

    hs = [m.register_forward_hook(hook(n)) for n, m in net.named_modules() if isinstance(m, torch.nn.Conv2d)
          or isinstance(m, torch.nn.ConvTranspose2d)]
    with torch.no_grad():
        for t in tiles:
            net(t["x"], t["a"], t["b"])
    for h in hs:
        h.remove()
    worst = max(peaks.items(), key=lambda kv: kv[1])
    print(f"largest |activation|: {worst[1]:.1f} in {worst[0]} (fp16 max 65504; want < ~1e4 for margin)")
    return worst[1]


def calib_tiles(root: Path, tile: int, n: int = 8) -> list[dict]:
    index = json.loads((root / "index.json").read_text())
    out = []
    for p in [p for p in index["pairs"] if p["split"] in ("val", "test")][:n]:
        arr = np.load(root / p["noisy"], mmap_mode="r")
        h, w = arr.shape[1:]
        if h < tile or w < tile:
            continue
        y, x = (h - tile) // 2, (w - tile) // 2
        out.append({"x": torch.from_numpy(np.asarray(arr[:, y:y + tile, x:x + tile], np.float32))[None],
                    "a": torch.tensor(p["a"]).view(1, 4, 1, 1), "b": torch.tensor(p["b"]).view(1, 4, 1, 1)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", default="export")
    ap.add_argument("--tile", type=int, default=512, help="packed pixels; multiple of 16")
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument("--calib", help="data/packed folder for real-tile checks")
    ap.add_argument("--raw-weights", action="store_true", help="use the raw weights instead of the EMA")
    args = ap.parse_args()
    assert args.tile % 16 == 0

    st = torch.load(args.ckpt, map_location="cpu", weights_only=False)
    targs = st["args"]
    net = RawDenoiseUNet(width=targs["width"], cond=not targs.get("no_cond", False))
    net.load_state_dict(st["model" if args.raw_weights else "ema"])
    net.eval()
    wrapped = ExportWrapper(net).eval()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stem = f"lb-rawdenoise-w{targs['width']}-t{args.tile}"
    f32, f16 = out / f"{stem}.fp32.onnx", out / f"{stem}.fp16.onnx"

    export(wrapped, f32, args.tile, args.opset)
    ok_ops = check_ops(f32)

    from onnxconverter_common import float16  # MIT
    import onnx
    m16 = float16.convert_float_to_float16(onnx.load(str(f32)), keep_io_types=True)
    onnx.save(m16, str(f16))
    check_ops(f16)

    tiles = calib_tiles(Path(args.calib), args.tile) if args.calib else []
    if not tiles:
        tiles = [{"x": torch.rand(1, 4, args.tile, args.tile) * 0.5, "a": torch.full((1, 4, 1, 1), 2e-4),
                  "b": torch.full((1, 4, 1, 1), 1e-6)}]
    for i, t in enumerate(tiles):
        with torch.no_grad():
            ref = wrapped(t["x"], t["a"], t["b"]).numpy()
        feeds = {k: t[k].numpy() for k in ("x", "a", "b")}
        y32, y16 = run_ort(f32, feeds), run_ort(f16, feeds)
        print(f"tile {i}: |ort32 - torch| max {np.abs(y32 - ref).max():.2e}; "
              f"|ort16 - ort32| max {np.abs(y16 - y32).max():.2e} mean {np.abs(y16 - y32).mean():.2e}; "
              f"fp16 finite: {bool(np.isfinite(y16).all())}")
    peak = activation_audit(net, tiles)

    entry = {
        "id": "lightbench-rawdenoise", "version": "0.1.0", "tools": ["detail.ai-denoise"],
        "input": {"kind": "bayer_packed_rggb", "tile": args.tile, "domain": "black-subtracted / (white - black), "
                  "not white balanced", "noise": "a, b per packed channel: var = a*x + b"},
        "files": [{"variant": v, "path": p.name, "bytes": p.stat().st_size, "sha256": sha256(p)}
                  for v, p in (("fp32", f32), ("fp16", f16))],
        "license": "TO DECIDE (see docs/research/DENOISE_TRAINING_PLAN.md section 7)", "attribution": "see MODEL_CARD.md",
        "training": {"checkpoint": Path(args.ckpt).name, "step": st["step"], "args": targs},
        "checks": {"webgpu_ops_ok": ok_ops, "max_activation": peak},
    }
    (out / "manifest-entry.json").write_text(json.dumps(entry, indent=1))
    print(json.dumps(entry["files"], indent=1))


if __name__ == "__main__":
    main()
