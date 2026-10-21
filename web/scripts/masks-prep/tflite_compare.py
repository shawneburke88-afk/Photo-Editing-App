"""Compares the community ONNX of MediaPipe Selfie Multiclass with Google's official TFLite on the same input.

  python -I tflite_compare.py --dir D

Reads the exact NHWC float32 input masks-prep.mjs fed the ONNX on the CPU (D/raw/selfie-input-<photo>.f32) and the
ONNX output it got (D/raw/selfie-output-<photo>.f32, NHWC 256 x 256 x 6), runs the TFLite named in D/pins.json with
ai-edge-litert, and writes D/tflite.json: max / mean absolute difference, per-pixel argmax agreement. The input is
normalised to [-1, 1], as the TFLite's own metadata says (NormalizationOptions mean 127.5, std 127.5).
"""

import argparse
import json
import os
import zipfile

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
a = ap.parse_args()
D = a.dir
out = {"photos": {}}
try:
    pins = json.load(open(os.path.join(D, "pins.json")))
    tfl = pins["models"]["selfie-multiclass"].get("tflite") or {}
    path = tfl.get("local")
    if not path or not os.path.exists(path):
        raise RuntimeError(f"TFLite not downloaded: {tfl.get('error')}")
    out["tflite"] = {k: tfl.get(k) for k in ("url", "bytes", "sha256", "headers")}
    try:
        out["labels"] = zipfile.ZipFile(path).read("labels.txt").decode().split()
    except Exception as e:  # noqa: BLE001
        out["labels"] = f"unread: {e!r}"
    from ai_edge_litert.interpreter import Interpreter

    it = Interpreter(model_path=path)
    it.allocate_tensors()
    ind = it.get_input_details()[0]
    outd = it.get_output_details()[0]
    out["tfliteIo"] = {"input": [ind["name"], ind["shape"].tolist(), str(ind["dtype"])], "output": [outd["name"], outd["shape"].tolist(), str(outd["dtype"])]}
    for photo in ("astronaut",):
        ip = os.path.join(D, "raw", f"selfie-input-{photo}.f32")
        op = os.path.join(D, "raw", f"selfie-output-{photo}.f32")
        if not (os.path.exists(ip) and os.path.exists(op)):
            out["photos"][photo] = {"error": "no ONNX CPU input/output saved (did the ONNX run fail?)"}
            continue
        x = np.fromfile(ip, dtype=np.float32).reshape(ind["shape"])
        y_onnx = np.fromfile(op, dtype=np.float32).reshape(outd["shape"])
        it.set_tensor(ind["index"], x)
        it.invoke()
        y_tfl = it.get_tensor(outd["index"])
        d = np.abs(y_tfl - y_onnx)
        agree = float(np.mean(np.argmax(y_tfl, -1) == np.argmax(y_onnx, -1)))
        out["photos"][photo] = {
            "maxAbsDiff": float(d.max()), "meanAbsDiff": float(d.mean()), "argmaxAgreement": agree,
            "tfliteRange": [float(y_tfl.min()), float(y_tfl.max())], "onnxRange": [float(y_onnx.min()), float(y_onnx.max())],
            "tfliteFinite": bool(np.isfinite(y_tfl).all()),
        }
    out["summary"] = {p: {k: r.get(k) for k in ("maxAbsDiff", "meanAbsDiff", "argmaxAgreement", "error") if k in r} for p, r in out["photos"].items()}
except Exception as e:  # noqa: BLE001
    out["error"] = repr(e)[:800]
    out["summary"] = {"error": out["error"]}
json.dump(out, open(os.path.join(D, "tflite.json"), "w"), indent=1)
print("TFLITE_COMPARE", json.dumps(out))
