"""Exports EfficientViT-Seg B1 (ADE20K) to ONNX with the upstream repo's own export code (masks-prep task).

  python -I export_efficientvit.py --dir D --repo EFFICIENTVIT_CLONE [--opset 17] [--size 512]

The repo's assets/onnx_export.py builds the model with `pretrained=False` (random weights) and exports with
efficientvit.apps.utils.export_onnx (torch.onnx.export + onnx-simplifier). This does the same, with the pinned
checkpoint loaded: create_efficientvit_seg_model("efficientvit-seg-b1-ade20k", weight_url=<pinned .pt>), then
export_onnx(model, path, torch.rand(1, 3, size, size), simplify=True, opset=opset). It then checks the export by
running the same random input through PyTorch and through onnxruntime (Python, CPU) and reports the difference.
Writes D/evit.json (paths, sizes, sha256, versions, error if any).
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import traceback

ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
ap.add_argument("--repo", required=True)
ap.add_argument("--opset", type=int, default=17)
ap.add_argument("--size", type=int, default=512)
a = ap.parse_args()
D = a.dir
res = {"opset": a.opset, "size": a.size, "model": "efficientvit-seg-b1-ade20k"}
try:
    res["repoCommit"] = subprocess.run(["git", "-C", a.repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    pins = json.load(open(os.path.join(D, "pins.json")))
    pt = pins["models"]["efficientvit-seg-b1"]["files"]["pt"]
    if not pt.get("local") or pt.get("match") is False:
        raise RuntimeError(f"checkpoint not pinned/downloaded: {pt}")
    res["checkpoint"] = {k: pt.get(k) for k in ("path", "bytes", "lfsSha256", "sha256", "match")}
    sys.path.insert(0, a.repo)
    import numpy as np
    import onnx
    import torch

    res["torch"] = torch.__version__
    res["onnxVersion"] = onnx.__version__
    from efficientvit.apps.utils import export_onnx
    from efficientvit.seg_model_zoo import create_efficientvit_seg_model

    model = create_efficientvit_seg_model(name="efficientvit-seg-b1-ade20k", pretrained=True, weight_url=pt["local"])
    model.eval()
    res["params"] = sum(p.numel() for p in model.parameters())
    out_path = os.path.join(D, "files", "efficientvit-seg-b1", f"efficientvit_seg_b1_ade20k_{a.size}.onnx")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    torch.manual_seed(0)
    dummy = torch.rand((1, 3, a.size, a.size))
    export_onnx(model, out_path, dummy, simplify=True, opset=a.opset)
    blob = open(out_path, "rb").read()
    res.update(onnx=out_path, onnxBytes=len(blob), onnxSha256=hashlib.sha256(blob).hexdigest())
    try:
        import onnxruntime as ortp

        res["onnxruntimePython"] = ortp.__version__
        with torch.no_grad():
            ref = model(dummy).numpy()
        sess = ortp.InferenceSession(out_path, providers=["CPUExecutionProvider"])
        got = sess.run(None, {sess.get_inputs()[0].name: dummy.numpy()})[0]
        res["torchVsOrt"] = {"shape": list(got.shape), "maxAbsDiff": float(np.abs(ref - got).max()), "argmaxAgreement": float(np.mean(ref.argmax(1) == got.argmax(1)))}
    except Exception as e:  # noqa: BLE001
        res["torchVsOrt"] = {"error": repr(e)[:400]}
except Exception as e:  # noqa: BLE001
    res["error"] = repr(e)[:800]
    res["trace"] = traceback.format_exc()[-2500:]
json.dump(res, open(os.path.join(D, "evit.json"), "w"), indent=1)
print("EVIT_EXPORT", json.dumps({k: v for k, v in res.items() if k != "trace"}))
if res.get("trace"):
    print(res["trace"])
