"""Exports EfficientViT-Seg B1 (ADE20K) to ONNX for LightBench's Sky mask and checks it (docs/PHASE3.md Part 29).

  python -I export_efficientvit.py --repo EFFICIENTVIT_CLONE --weights PT --weights-sha256 HEX --out DIR \
      [--photos A.png B.png ...] [--opset 17]

Run by the "AI models" workflow's efficientvit-export task on GitHub's runner. The authors publish PyTorch weights only;
their own `assets/onnx_export.py` builds the model with `pretrained=False` (random weights), so this loads the pinned
checkpoint instead:

  1. Checks the checkpoint's SHA-256, builds the model with the authors' code (`create_efficientvit_seg_model(
     "efficientvit-seg-b1-ade20k", weight_url=<the checkpoint>)`, which loads every weight strictly).
  2. Exports it with torch.onnx.export (opset 17, the TorchScript exporter), batch 1 and the height and width FREE
     (dynamic axes), so one file takes each photo at its own aspect, as the authors' ADE20K evaluation feeds it (short side
     512, long side a multiple of 32). Input `pixel_values` [1, 3, H, W], output `logits` [1, 150, H/8, W/8]. Then
     onnx-simplifier, as the authors' `export_onnx` does (kept unsimplified if it fails; recorded).
  3. Checks the export against PyTorch on the same inputs, with ONNX Runtime's CPU provider: random inputs at 512 × 512,
     768 × 512 and 512 × 768, and each photo at the app's size (short side 512, long side up to a multiple of 32) and
     stretched to 512 × 512 (as the candidate check MASKS_PREP.md ran it). It fails unless every case's largest
     difference is under 1e-3 and the per-cell class (argmax) agrees on at least 99.9 % of cells.
  4. Measures the largest tensor the graph makes (every node's output, run at 768 × 512), in bytes per input pixel, for
     the app's GPU limit gate, and lists the operators.
  5. Writes DIR/efficientvit_seg_b1_ade20k.onnx, DIR/export.json (everything above) and DIR/SOURCE.md (where the file
     came from, how it was made and checked, its licence and training data), for the release.

Exit 1 when anything fails (nothing is then published).
"""

import argparse
import hashlib
import json
import math
import os
import platform
import subprocess
import sys
import traceback

ap = argparse.ArgumentParser()
ap.add_argument("--repo", required=True)
ap.add_argument("--weights", required=True)
ap.add_argument("--weights-sha256", required=True)
ap.add_argument("--weights-url", default="")
ap.add_argument("--weights-commit", default="")
ap.add_argument("--out", required=True)
ap.add_argument("--photos", nargs="*", default=[])
ap.add_argument("--opset", type=int, default=17)
a = ap.parse_args()

NAME = "efficientvit_seg_b1_ade20k.onnx"
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]
SKY = 2
MAX_ABS = 1e-3
MIN_AGREE = 0.999
os.makedirs(a.out, exist_ok=True)
res = {"model": "efficientvit-seg-b1-ade20k", "opset": a.opset, "ok": False, "cases": [], "problems": []}


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def app_size(w, h, short=512, k=32):
    """The app's (and the authors' ADE20K evaluation's) input size: the short side to 512, the long side up to a multiple of 32."""
    if w >= h:
        return (min(2048, math.ceil(w / h * short / k) * k), short)
    return (short, min(2048, math.ceil(h / w * short / k) * k))


try:
    import numpy as np
    import onnx
    import torch
    from PIL import Image

    res["versions"] = {"python": platform.python_version(), "torch": torch.__version__, "onnx": onnx.__version__, "numpy": np.__version__}
    res["repoCommit"] = subprocess.run(["git", "-C", a.repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    got = sha256_file(a.weights)
    res["checkpoint"] = {"path": os.path.basename(a.weights), "bytes": os.path.getsize(a.weights), "sha256": got, "url": a.weights_url, "commit": a.weights_commit}
    if got != a.weights_sha256:
        raise RuntimeError(f"checkpoint SHA-256 {got}, expected {a.weights_sha256}")

    sys.path.insert(0, a.repo)
    from efficientvit.seg_model_zoo import create_efficientvit_seg_model

    torch.manual_seed(0)
    model = create_efficientvit_seg_model(name="efficientvit-seg-b1-ade20k", pretrained=True, weight_url=a.weights)
    model.eval()
    res["params"] = int(sum(p.numel() for p in model.parameters()))

    # 2. The export: height and width free.
    path = os.path.join(a.out, NAME)
    raw_path = os.path.join(a.out, "raw.onnx")
    dummy = torch.rand((1, 3, 512, 768))
    with torch.no_grad():
        torch.onnx.export(
            model,
            dummy,
            raw_path,
            opset_version=a.opset,
            input_names=["pixel_values"],
            output_names=["logits"],
            dynamic_axes={"pixel_values": {2: "height", 3: "width"}, "logits": {2: "cells_y", 3: "cells_x"}},
            do_constant_folding=True,
        )
    m = onnx.load(raw_path)
    try:
        import onnxsim

        res["versions"]["onnxsim"] = getattr(onnxsim, "__version__", "?")
        sm, ok = onnxsim.simplify(m)
        if not ok:
            raise RuntimeError("onnx-simplifier could not validate the simplified model")
        m = sm
        res["simplified"] = True
    except Exception as e:  # noqa: BLE001
        res["simplified"] = False
        res["simplifyError"] = repr(e)[:400]
    onnx.checker.check_model(m)
    onnx.save(m, path)
    os.remove(raw_path)
    res["onnx"] = {"file": NAME, "bytes": os.path.getsize(path), "sha256": sha256_file(path)}
    g = m.graph
    res["io"] = {
        "inputs": [{"name": i.name, "dims": [d.dim_param or d.dim_value for d in i.type.tensor_type.shape.dim]} for i in g.input],
        "outputs": [{"name": o.name, "dims": [d.dim_param or d.dim_value for d in o.type.tensor_type.shape.dim]} for o in g.output],
    }
    ops = {}
    for n in g.node:
        ops[n.op_type] = ops.get(n.op_type, 0) + 1
    res["ops"] = dict(sorted(ops.items()))
    res["nodes"] = len(g.node)
    res["opsetImports"] = {o.domain or "ai.onnx": o.version for o in m.opset_import}

    # 3. Against PyTorch.
    import onnxruntime as ort

    res["versions"]["onnxruntime"] = ort.__version__
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])

    def compare(name, x):
        with torch.no_grad():
            ref = model(torch.from_numpy(x)).numpy()
        out = sess.run(["logits"], {"pixel_values": x})[0]
        case = {
            "case": name,
            "input": list(x.shape),
            "output": list(out.shape),
            "maxAbsDiff": float(np.abs(ref - out).max()) if ref.shape == out.shape else None,
            "argmaxAgreement": float(np.mean(ref.argmax(1) == out.argmax(1))) if ref.shape == out.shape else 0.0,
            "skyShareTorch": float(np.mean(ref.argmax(1) == SKY)),
            "skyShareOnnx": float(np.mean(out.argmax(1) == SKY)),
            "finite": bool(np.isfinite(out).all()),
        }
        ok = ref.shape == out.shape and case["finite"] and case["maxAbsDiff"] < MAX_ABS and case["argmaxAgreement"] >= MIN_AGREE
        case["ok"] = bool(ok)
        res["cases"].append(case)
        print("CASE", json.dumps(case))
        if not ok:
            res["problems"].append(f"{name}: {case}")

    rng = np.random.default_rng(0)
    for w, h in [(512, 512), (768, 512), (512, 768)]:
        compare(f"random {w}x{h}", rng.random((1, 3, h, w), dtype=np.float32))

    def tensor(img, w, h):
        x = np.asarray(img.convert("RGB").resize((w, h), Image.BICUBIC), dtype=np.float32) / 255.0
        x = (x - np.array(MEAN, dtype=np.float32)) / np.array(STD, dtype=np.float32)
        return np.ascontiguousarray(x.transpose(2, 0, 1)[None])

    for p in a.photos:
        img = Image.open(p)
        w, h = app_size(*img.size)
        compare(f"{os.path.basename(p)} at the app's size {w}x{h}", tensor(img, w, h))
        compare(f"{os.path.basename(p)} stretched to 512x512", tensor(img, 512, 512))

    # 4. The largest tensor: every node's output, at 768 x 512 on the CPU.
    try:
        mm = onnx.load(path)
        have = {o.name for o in mm.graph.output}
        for n in mm.graph.node:
            for o in n.output:
                if o and o not in have:
                    mm.graph.output.append(onnx.helper.make_empty_tensor_value_info(o))
                    have.add(o)
        s2 = ort.InferenceSession(mm.SerializeToString(), providers=["CPUExecutionProvider"])
        x = rng.random((1, 3, 512, 768), dtype=np.float32)
        outs = s2.run(None, {"pixel_values": x})
        names = [o.name for o in s2.get_outputs()]
        sizes = sorted(((int(v.nbytes), n, list(v.shape)) for n, v in zip(names, outs) if hasattr(v, "nbytes")), reverse=True)
        biggest = max(sizes[0][0], int(x.nbytes))
        res["largestTensor"] = {
            "input": [768, 512],
            "bytes": biggest,
            "bytesPerPixel": biggest / (768 * 512),
            "top": [{"bytes": b, "name": n, "shape": s} for b, n, s in sizes[:5]],
        }
        print("LARGEST", json.dumps(res["largestTensor"]))
    except Exception as e:  # noqa: BLE001
        res["largestTensor"] = {"error": repr(e)[:400]}
        res["problems"].append(f"largest tensor not measured: {e!r}"[:300])

    res["ok"] = not res["problems"]
except Exception as e:  # noqa: BLE001
    res["problems"].append(repr(e)[:800])
    res["trace"] = traceback.format_exc()[-3000:]
    print(res["trace"])

json.dump(res, open(os.path.join(a.out, "export.json"), "w"), indent=1)

# 5. The SOURCE note for the release.
run = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ.get('GITHUB_REPOSITORY', '')}/actions/runs/{os.environ.get('GITHUB_RUN_ID', '')}"
lines = [
    "# EfficientViT-Seg B1 (ADE20K) as ONNX: LightBench's conversion",
    "",
    f"`{NAME}` is LightBench's own ONNX export of the EfficientViT-Seg B1 weights trained on ADE20K, made for LightBench's Sky mask (docs/PHASE3.md Part 29).",
    "",
    "## Where it came from",
    "",
    f"- Weights: `{res.get('checkpoint', {}).get('path', '?')}` from Hugging Face `han-cai/efficientvit-seg` at commit `{a.weights_commit}` ({res.get('checkpoint', {}).get('bytes', '?')} bytes, SHA-256 `{res.get('checkpoint', {}).get('sha256', '?')}`), {a.weights_url}",
    f"- Code: `mit-han-lab/efficientvit` at commit `{res.get('repoCommit', '?')}` (its `create_efficientvit_seg_model`, which loads every weight strictly).",
    "- Authors: Han Cai, Junyan Li, Muyan Hu, Chuang Gan and Song Han (MIT Han Lab), \"EfficientViT: Lightweight Multi-Scale Attention for High-Resolution Dense Prediction\" (ICCV 2023, arXiv:2205.14756).",
    "",
    "## How it was made",
    "",
    f"- torch.onnx.export (TorchScript exporter), opset {a.opset}, batch 1, height and width free: input `pixel_values` float32 [1, 3, H, W] (RGB / 255 minus ImageNet's mean, over its std; H and W multiples of 32), output `logits` float32 [1, 150, H/8, W/8] (ADE20K's 150 classes; sky is class 2).",
    f"- onnx-simplifier: {'applied' if res.get('simplified') else 'not applied (' + str(res.get('simplifyError', '?')) + ')'}.",
    f"- Versions: {json.dumps(res.get('versions', {}))}.",
    f"- Made by LightBench's \"AI models\" workflow (task efficientvit-export), run {run}, commit `{os.environ.get('GITHUB_SHA', '?')}`; script `web/scripts/sky/export_efficientvit.py`.",
    "- The stock `assets/onnx_export.py` of the authors' repository builds the model with `pretrained=False` (random weights); this export loads the checkpoint above instead.",
    "",
    "## How it was checked",
    "",
    f"Against the authors' PyTorch model on the same inputs (ONNX Runtime {res.get('versions', {}).get('onnxruntime', '?')}, CPU). Required: largest difference under {MAX_ABS}, the same class in at least {MIN_AGREE * 100:.1f} % of cells.",
    "",
    "| case | input | largest difference | same class | sky (PyTorch) | sky (ONNX) |",
    "|---|---|---|---|---|---|",
]
for c in res["cases"]:
    lines.append(f"| {c['case']} | {' x '.join(map(str, c['input'][2:]))} | {c['maxAbsDiff']:.2e} | {c['argmaxAgreement'] * 100:.3f} % | {c['skyShareTorch']:.4f} | {c['skyShareOnnx']:.4f} |" if c.get("maxAbsDiff") is not None else f"| {c['case']} | | failed | | | |")
lt = res.get("largestTensor", {})
lines += [
    "",
    f"Largest tensor at 768 x 512: {lt.get('bytes', '?')} bytes ({lt.get('bytesPerPixel', '?')} bytes per input pixel).",
    "",
    f"File: {res.get('onnx', {}).get('bytes', '?')} bytes, SHA-256 `{res.get('onnx', {}).get('sha256', '?')}`.",
    "",
    "## Licence",
    "",
    "Apache License 2.0: the weights' Hugging Face page is tagged apache-2.0, and the authors' code repository is under the Apache License 2.0 (\"Copyright [2023] [Han Cai]\"). Its text is the release's `LICENSE.txt` (the repository's LICENSE at the commit above). The conversion is a derivative of the weights, distributed under the same licence; LightBench changed nothing but the format.",
    "",
    "## Training data, in plain words",
    "",
    "The model learnt to sort the parts of a photo into 150 kinds of thing on ADE20K (about 20,000 photos of everyday scenes outlined by hand, published by MIT), whose terms allow non-commercial research and education use only. The part of the model that first reads the photo was trained before that on ImageNet-1K (about 1.28 million photos in 1,000 categories), whose terms likewise allow non-commercial research and education only.",
    "",
]
open(os.path.join(a.out, "SOURCE.md"), "w").write("\n".join(lines))
print("EXPORT", json.dumps({k: v for k, v in res.items() if k != "trace"}))
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary:
    with open(summary, "a") as f:
        f.write("\n".join(lines[lines.index("## How it was checked"):]) + "\n")
        f.write(f"\n**Export: {'all checks passed' if res['ok'] else 'FAILED: ' + '; '.join(res['problems'])}**\n\n")
sys.exit(0 if res["ok"] else 1)
