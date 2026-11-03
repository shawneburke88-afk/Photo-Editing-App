"""Unblur spike (docs/UNBLUR_SPIKE.md): export a candidate to ONNX and check it.

  python -I export.py misc   --repo MISCFilter --weights RealBlur_J.pth --out DIR --sizes 256,512,768 --images a.png,b.png
  python -I export.py nafnet --repo NAFNet --weights NAFNet-GoPro-width64.pth --out DIR --sizes 256,512,768 --images ...

For each tile size: the ONNX file (fp32, opset 17), its operators, ONNX Runtime CPU against PyTorch on the images'
centre crops (PSNR and largest absolute difference, outputs clipped to [0, 1] as the authors' test does), an fp16 copy
(onnxconverter-common, inputs and outputs kept fp32; the sampling, filter and FFT nodes kept fp32) against fp32, and
one profiled CPU run (ONNX Runtime's profiler: every node's output size) for the largest tensor and the peak memory.
MISC Filter also gets its filter port checked against a literal transcription of the CUDA source.
Results: DIR/<model>.json.
"""
import argparse
import collections
import hashlib
import json
import os
import sys
import tempfile
import time

import numpy as np
import onnx
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import unblur_models as um  # noqa: E402

MIB = 1 << 20
ES = {1: 4, 10: 2, 7: 8, 6: 4, 9: 1, 11: 8, 2: 1, 3: 1}


def sha256(p):
    d = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            d.update(b)
    return d.hexdigest()


def load_img(p):
    from PIL import Image
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) / 255.0


def crop(img, s):
    h, w = img.shape[:2]
    if h < s or w < s:
        img = np.pad(img, ((0, max(0, s - h)), (0, max(0, s - w)), (0, 0)), mode="reflect")
        h, w = img.shape[:2]
    y, x = (h - s) // 2, (w - s) // 2
    return img[y:y + s, x:x + s]


def to_t(img):
    return torch.from_numpy(np.ascontiguousarray(img.transpose(2, 0, 1)[None]))


def psnr(a, b):
    m = float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))
    return float("inf") if m == 0 else 10 * np.log10(1.0 / m)


def ort_session(path, threads=4, opt=True):
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    if not opt:
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    return ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])


def ops_of(path):
    m = onnx.load(path, load_external_data=False)
    return dict(sorted(collections.Counter(n.op_type for n in m.graph.node).items())), [(o.domain, o.version) for o in m.opset_import]


def profile(path, size, threads=4):
    """One profiled CPU run (no graph optimisation, so nodes are the file's own): node outputs and memory."""
    import onnxruntime as ort
    m = onnx.load(path)
    for i, n in enumerate(m.graph.node):
        if not n.name:
            n.name = f"lb_unnamed_{i}"
    d = tempfile.mkdtemp(prefix="lbprof")
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    so.enable_profiling = True
    so.profile_file_prefix = os.path.join(d, "p")
    so.intra_op_num_threads = threads
    s = ort.InferenceSession(m.SerializeToString(), so, providers=["CPUExecutionProvider"])
    x = np.random.default_rng(0).random((1, 3, size, size), dtype=np.float32)
    t = time.time()
    s.run(None, {s.get_inputs()[0].name: x})
    run_s = time.time() - t
    ev = json.load(open(s.end_profiling()))
    nodes = []
    for e in ev:
        if e.get("cat") != "Node" or not e["name"].endswith("_kernel_time"):
            continue
        a = e["args"]
        ots = a.get("output_type_shape") or []
        nodes.append({"name": e["name"][:-12], "op": a.get("op_name"), "dur": int(e.get("dur", 0)), "out": int(a.get("output_size", 0)), "inUse": int(a.get("mem_bytes_in_use", 0)),
                      "shapes": [list(t.values())[0] for t in ots], "types": [list(t.keys())[0] for t in ots]})
    weights = sorted(((int(np.prod(t.dims)) * ES.get(t.data_type, 4), t.name) for t in m.graph.initializer), reverse=True)
    top = sorted(nodes, key=lambda e: -e["out"])[:8]
    over = [e for e in nodes if e["out"] > 128 * MIB]
    peak = max(nodes, key=lambda e: e["inUse"])
    by_op = collections.Counter()
    for e in nodes:
        by_op[e["op"]] += e["dur"]
    total = sum(by_op.values()) or 1
    op_ms = {k: {"ms": round(v / 1000, 1), "share": round(v / total, 3)} for k, v in by_op.most_common(8)}
    return {"size": size, "runS": round(run_s, 2), "nodes": len(nodes), "opTime": op_ms,
            "largest": [{"bytes": e["out"], "op": e["op"], "node": e["name"], "shape": e["shapes"], "type": e["types"]} for e in top],
            "over128MiB": dict(collections.Counter(e["op"] for e in over)), "over64MiB": dict(collections.Counter(e["op"] for e in nodes if e["out"] > 64 * MIB)),
            "largestWeight": weights[0][0] if weights else 0, "peakInUse": peak["inUse"]}


def to_fp16(src, dst, block_substrings, convs_only=False):
    """fp16 copy: every node in fp16 except those named by block_substrings and the sampling/FFT operators; with
    convs_only, only Conv, ConvTranspose and Relu in fp16 (everything else kept fp32)."""
    from onnxconverter_common import float16
    m = onnx.load(src)
    if convs_only:
        keep16 = {"Conv", "ConvTranspose", "Relu"}
        block = [n.name for n in m.graph.node if n.op_type not in keep16]
    else:
        block = [n.name for n in m.graph.node if any(s in n.name for s in block_substrings) or n.op_type in ("DFT", "GridSample", "GatherElements", "Range")]
    m16 = float16.convert_float_to_float16(m, keep_io_types=True, node_block_list=block, disable_shape_infer=False)
    onnx.save(m16, dst)
    return len(block)


def export(module, size, path):
    x = torch.rand(1, 3, size, size)
    with torch.no_grad():
        torch.onnx.export(module, (x,), path, opset_version=17, input_names=["blurred"], output_names=["restored"], do_constant_folding=True, dynamo=False)
    onnx.checker.check_model(path)


def check_misc_kernel():
    """The PyTorch port against the literal CUDA transcription: random inputs, offsets up to ±12 px (clamping hit)."""
    rng = np.random.default_rng(1)
    B, C, H, W, K = 1, 2, 9, 11, 7
    inp = rng.standard_normal((B, C, H + 6, W + 6)).astype(np.float32)
    v = rng.random((B, K, H, W)).astype(np.float32)
    h = rng.random((B, K, H, W)).astype(np.float32)
    ox = (rng.standard_normal((B, K * K, H, W)) * 6).astype(np.float32)
    oy = (rng.standard_normal((B, K * K, H, W)) * 6).astype(np.float32)
    w = rng.random((B, K * K, H, W)).astype(np.float32)
    lit = um.misc_kernel_literal(inp, v, h, ox, oy, w)
    port = um.misc_kernel(*(torch.from_numpy(a) for a in (inp, v, h, ox, oy, w))).numpy()
    return {"shape": list(lit.shape), "maxAbs": float(np.max(np.abs(lit - port))), "maxRef": float(np.max(np.abs(lit)))}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("model", choices=["misc", "nafnet"])
    p.add_argument("--repo", required=True)
    p.add_argument("--weights", required=True)
    p.add_argument("--name", default=None)
    p.add_argument("--out", required=True)
    p.add_argument("--sizes", default="256,512,768")
    p.add_argument("--images", default="")
    p.add_argument("--profile-sizes", default="256,512,768")
    p.add_argument("--no-fp16", action="store_true")
    p.add_argument("--threads", type=int, default=4)
    a = p.parse_args()
    torch.set_num_threads(a.threads)
    os.makedirs(a.out, exist_ok=True)
    name = a.name or a.model
    res = {"model": name, "weights": {"path": os.path.basename(a.weights), "bytes": os.path.getsize(a.weights), "sha256": sha256(a.weights)},
           "torch": torch.__version__, "onnx": onnx.__version__}
    import onnxruntime as ort
    res["onnxruntime"] = ort.__version__
    t0 = time.time()
    if a.model == "misc":
        res["kernelPort"] = check_misc_kernel()
        print("filter port vs literal CUDA transcription:", res["kernelPort"], flush=True)
        ref, exp, info = um.build_misc(a.repo, a.weights)
        reference = lambda x: um.misc_reference_forward(ref, x)  # noqa: E731
        block = ["/warp", "/kernel", "/fft", "DFT", "Range"]
    else:
        net, info = um.build_nafnet(a.repo, a.weights, local=True)
        exp = net
        reference = lambda x: net(x)  # noqa: E731
        block = []
    res["build"] = info
    print("built:", info, f"({time.time() - t0:.1f} s)", flush=True)
    images = [x for x in a.images.split(",") if x]
    res["sizes"] = {}
    for size in [int(s) for s in a.sizes.split(",")]:
        r = {}
        f32 = os.path.join(a.out, f"{name}_{size}_fp32.onnx")
        t = time.time()
        try:
            export(exp, size, f32)
        except Exception as e:  # noqa: BLE001
            r["exportError"] = repr(e)[:3000]
            print(f"{size}: export failed: {r['exportError']}", flush=True)
            res["sizes"][size] = r
            continue
        r["exportS"] = round(time.time() - t, 1)
        r["fp32"] = {"bytes": os.path.getsize(f32), "sha256": sha256(f32)}
        r["ops"], r["opset"] = ops_of(f32)
        print(f"{size}: exported {r['fp32']['bytes']:,} bytes in {r['exportS']} s; ops {r['ops']}", flush=True)
        f16 = os.path.join(a.out, f"{name}_{size}_fp16.onnx")
        f16c = os.path.join(a.out, f"{name}_{size}_fp16convs.onnx")
        variants16 = {}
        if not a.no_fp16:
            for label, path, convs in [("fp16", f16, False), ("fp16convs", f16c, True)]:
                if convs and a.model != "misc":
                    continue
                try:
                    r[f"{label}Blocked"] = to_fp16(f32, path, block, convs_only=convs)
                    r[label] = {"bytes": os.path.getsize(path), "sha256": sha256(path)}
                    variants16[label] = ort_session(path, a.threads)
                except Exception as e:  # noqa: BLE001
                    r[f"{label}Error"] = repr(e)[:2000]
                    print(f"{size} {label}: {r[label + 'Error'][:300]}", flush=True)
        s32 = ort_session(f32, a.threads)
        r["parity"] = []
        for img_path in images:
            img = crop(load_img(img_path), size)
            x = to_t(img)
            t = time.time()
            with torch.no_grad():
                yt = reference(x).numpy()
                ye = exp(x).numpy() if a.model == "misc" else yt
            torch_s = time.time() - t
            t = time.time()
            yo = s32.run(None, {"blurred": x.numpy()})[0]
            ort_s = time.time() - t
            c = lambda v: np.clip(v, 0, 1)  # noqa: E731
            row = {"image": os.path.basename(img_path), "torchS": round(torch_s, 2), "ortS": round(ort_s, 2),
                   "exportModuleVsReference": {"maxAbs": float(np.max(np.abs(ye - yt)))},
                   "ortVsTorch": {"maxAbs": float(np.max(np.abs(yo - yt))), "psnr": psnr(c(yo), c(yt))},
                   "inputVsTorch": {"psnr": psnr(img.transpose(2, 0, 1)[None], c(yt))}}
            print(f"{size} {row['image']} fp32: {json.dumps(row)}", flush=True)
            for label, s16 in variants16.items():
                try:
                    t = time.time()
                    y16 = s16.run(None, {"blurred": x.numpy()})[0]
                    row[f"{label}S"] = round(time.time() - t, 2)
                    fin = np.isfinite(y16)
                    row[f"{label}VsTorch"] = {"maxAbs": float(np.max(np.abs(np.where(fin, y16, 0) - yt))), "psnr": psnr(c(np.nan_to_num(y16)), c(yt)), "nonFinite": int(np.sum(~fin))}
                except Exception as e:  # noqa: BLE001
                    row[f"{label}VsTorch"] = {"error": repr(e)[:400]}
                print(f"{size} {row['image']} {label}: {json.dumps(row.get(label + 'VsTorch'))}", flush=True)
            r["parity"].append(row)
        del s32, variants16
        if str(size) in a.profile_sizes.split(","):
            for kind, f in [("fp32", f32), ("fp16", f16), ("fp16convs", f16c)]:
                if os.path.exists(f):
                    try:
                        r[f"tensors_{kind}"] = profile(f, size, a.threads)
                        tt = r[f"tensors_{kind}"]
                        print(f"{size} {kind}: largest {tt['largest'][0]['bytes']:,} B {tt['largest'][0]['op']} {tt['largest'][0]['shape']}; over 128 MiB {tt['over128MiB']}; peak in use {tt['peakInUse']:,} B; run {tt['runS']} s; time by op {tt['opTime']}", flush=True)
                    except Exception as e:  # noqa: BLE001
                        r[f"tensors_{kind}"] = {"error": repr(e)[:1000]}
        res["sizes"][size] = r
        json.dump(res, open(os.path.join(a.out, f"{name}.json"), "w"), indent=1)
    json.dump(res, open(os.path.join(a.out, f"{name}.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "sizes"}), flush=True)


if __name__ == "__main__":
    main()
