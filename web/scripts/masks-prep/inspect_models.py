"""Inspects the AI masks candidates' ONNX graphs (masks-prep task of the "AI models" workflow; throwaway branch).

  python -I inspect_models.py --dir D --photos PHOTO_DIR

Reads D/pins.json (masks-prep.mjs pin) and D/evit.json (export_efficientvit.py), and for each ONNX file writes to
D/inspect.json: opset imports, IR version, producer, inputs/outputs (name, ORT type name, dims), the operator types
and counts (subgraphs included), initializer element types, and the operators ONNX Runtime 1.30.0's WebGPU support
does not cover:
  unsupportedNative  no kernel registered in the native WebGPU EP (webgpu_execution_provider.cc and
                     webgpu_contrib_kernels.cc at v1.30.0) for the op's schema version at the model's opset. This is
                     the EP that onnxruntime-web/webgpu uses in 1.30.0 (built with DISABLE_JSEP=true).
  unsupportedJsep    not covered by js/web/docs/webgpu-operators.md at v1.30.0 (the JSEP list).
Only op type, domain and version are matched; type constraints (e.g. int64 inputs) are not checked. ORT places nodes
without a WebGPU kernel on the CPU EP (they don't fail the session).
Also decodes the test photos to D/img/<name>.rgb (RGB8) + <name>.json.
"""

import argparse
import collections
import json
import os
import re
import sys

import numpy as np
import onnx
from onnx import defs
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
ap.add_argument("--photos", required=True)
a = ap.parse_args()
D = a.dir

TYPES = {1: "float32", 2: "uint8", 3: "int8", 6: "int32", 7: "int64", 9: "bool", 10: "float16", 11: "float64", 16: "bfloat16"}
DOMAINS = {"kOnnxDomain": "", "kMSDomain": "com.microsoft", "kMSInternalNHWCDomain": "com.ms.internal.nhwc"}


def native_kernels():
    """{(domain, op): [(start, end)]} from the native WebGPU EP's registration tables."""
    reg = collections.defaultdict(list)
    for name in ["webgpu_execution_provider.cc", "webgpu_contrib_kernels.cc", "binary_elementwise_ops.cc"]:
        p = os.path.join(D, "ort", name)
        if not os.path.exists(p):
            continue
        for line in open(p, encoding="utf-8"):
            s = line.strip()
            if s.startswith("//") or s.startswith("#define"):
                continue
            for m in re.finditer(r"ONNX_OPERATOR_VERSIONED_KERNEL_CLASS_NAME\(kWebGpuExecutionProvider,\s*(\w+),\s*(\d+),\s*(\d+),\s*(\w+)\)", s):
                reg[(DOMAINS.get(m[1], m[1]), m[4])].append((int(m[2]), int(m[3])))
            for m in re.finditer(r"ONNX_OPERATOR_KERNEL_CLASS_NAME\(kWebGpuExecutionProvider,\s*(\w+),\s*(\d+),\s*(\w+)\)", s):
                reg[(DOMAINS.get(m[1], m[1]), m[3])].append((int(m[2]), 10**6))
            for m in re.finditer(r"ONNX_OPERATOR_VERSIONED_TYPED_KERNEL_CLASS_NAME\(kWebGpuExecutionProvider,\s*(\w+),\s*(\d+),\s*(\d+),\s*\w+,\s*(\w+)\)", s):
                reg[(DOMAINS.get(m[1], m[1]), m[4])].append((int(m[2]), int(m[3])))
            for m in re.finditer(r"ONNX_OPERATOR_TYPED_KERNEL_CLASS_NAME\(kWebGpuExecutionProvider,\s*(\w+),\s*(\d+),\s*\w+,\s*(\w+)\)", s):
                reg[(DOMAINS.get(m[1], m[1]), m[3])].append((int(m[2]), 10**6))
            for m in re.finditer(r"\bKERNEL_CREATE_INFO_VERSIONED\((\d+),\s*(\d+),\s*(\w+)\)", s):
                reg[("", m[3])].append((int(m[1]), int(m[2])))
            for m in re.finditer(r"\bKERNEL_CREATE_INFO\((\d+),\s*(\w+)\)", s):
                reg[("", m[2])].append((int(m[1]), 10**6))
            for m in re.finditer(r"\bKERNEL_CREATE_INFO_TYPED\((\d+),\s*\w+,\s*(\w+)\)", s):
                reg[("", m[2])].append((int(m[1]), 10**6))
            # RegisterKernels(): Create<Op>VersionedKernelInfo(a, b, int64) / Create<Op>KernelInfo(a, int64).
            for m in re.finditer(r"\bCreate(\w+?)VersionedKernelInfo\((\d+),\s*(\d+)", s):
                reg[("", m[1])].append((int(m[2]), int(m[3])))
            for m in re.finditer(r"\bCreate(\w+?)KernelInfo\((\d+)\s*[,)]", s):
                if not m[1].endswith("Versioned"):
                    reg[("", m[1])].append((int(m[2]), 10**6))
            if "RegisterRangeKernels(*kernel_registry" in s:
                reg[("", "Range")].append((11, 10**6))  # generator/range.cc: float and int32 always
            # binary_elementwise_ops.cc: RegisterBinaryOp(kernel_registry, "Add", ..., {{7, 12}, {13, 13}, {14, std::nullopt}});
            m = re.search(r'RegisterBinaryOp\(kernel_registry,\s*"(\w+)".*\{(\{.*\})\}', s)
            if m:
                for r in re.finditer(r"\{(\d+),\s*(\d+|std::nullopt)\}", m[2]):
                    reg[("", m[1])].append((int(r[1]), 10**6 if r[2] == "std::nullopt" else int(r[2])))
    return reg


def jsep_list():
    """{(domain, op): [(start, end)]} from webgpu-operators.md."""
    reg = collections.defaultdict(list)
    p = os.path.join(D, "ort", "webgpu-operators.md")
    if not os.path.exists(p):
        return reg
    for line in open(p, encoding="utf-8"):
        cells = [c.strip() for c in line.split("|")]
        if len(cells) < 4 or not re.match(r"^[A-Z]\w*$", cells[1]):
            continue
        for dm in re.finditer(r"([\w.]+)\(([^)]*)\)", cells[2]):
            dom = {"ai.onnx": "", "com.microsoft": "com.microsoft"}.get(dm[1])
            if dom is None:
                continue
            for r in dm[2].split(","):
                r = r.strip()
                if r.endswith("+"):
                    reg[(dom, cells[1])].append((int(r[:-1]), 10**6))
                elif "-" in r:
                    x, y = r.split("-")
                    reg[(dom, cells[1])].append((int(x), int(y)))
                elif r:
                    reg[(dom, cells[1])].append((int(r), int(r)))
    return reg


NATIVE = native_kernels()
JSEP = jsep_list()


def covered(reg, dom, op, since):
    return any(s <= since <= e for s, e in reg.get((dom, op), []))


def dims(vi):
    t = vi.type.tensor_type
    return [d.dim_value if d.HasField("dim_value") else (d.dim_param or "?") for d in t.shape.dim]


def walk(graph):
    for n in graph.node:
        yield n
        for at in n.attribute:
            if at.type == onnx.AttributeProto.GRAPH:
                yield from walk(at.g)
            elif at.type == onnx.AttributeProto.GRAPHS:
                for g in at.graphs:
                    yield from walk(g)


def inspect(path):
    m = onnx.load(path, load_external_data=False)
    opset = {(o.domain or "ai.onnx"): o.version for o in m.opset_import}
    g = m.graph
    init_names = {i.name for i in g.initializer}
    ops = collections.Counter()
    since_of = {}
    for n in walk(g):
        dom = n.domain if n.domain not in ("ai.onnx",) else ""
        key = n.op_type if not dom else f"{dom}::{n.op_type}"
        ops[key] += 1
        if key not in since_of:
            ver = opset.get(dom or "ai.onnx", 0)
            try:
                since_of[key] = (dom, n.op_type, defs.get_schema(n.op_type, ver, dom).since_version)
            except Exception:
                since_of[key] = (dom, n.op_type, ver)
    un_native = sorted(f"{k} (v{s})" for k, (d, o, s) in since_of.items() if not covered(NATIVE, d, o, s))
    un_jsep = sorted(f"{k} (v{s})" for k, (d, o, s) in since_of.items() if not covered(JSEP, d, o, s))
    itypes = collections.Counter(TYPES.get(i.data_type, str(i.data_type)) for i in g.initializer)
    notes = {}
    splits = [n for n in walk(g) if n.op_type == "Split"]
    if splits:
        desc = collections.Counter()
        for n in splits:
            at = {x.name: onnx.helper.get_attribute_value(x) for x in n.attribute}
            has_split_input = len(n.input) > 1 and n.input[1] != ""
            desc[f"outputs={len(n.output)} axis={at.get('axis', 0)} split_input={'initializer' if has_split_input and n.input[1] in init_names else ('tensor' if has_split_input else 'none')} num_outputs_attr={at.get('num_outputs')}"] += 1
        notes["Split"] = dict(desc)
    for op in ("GridSample", "DeformConv", "Einsum", "ScatterND", "NonZero", "TopK", "Loop", "If"):
        if ops.get(op):
            notes[op] = ops[op]
    ext = sorted({e.value for i in g.initializer for e in i.external_data if e.key == "location"})
    return {
        "ir": m.ir_version, "producer": f"{m.producer_name} {m.producer_version}".strip(), "opset": opset,
        "inputs": [{"name": i.name, "type": TYPES.get(i.type.tensor_type.elem_type, str(i.type.tensor_type.elem_type)), "dims": dims(i)} for i in g.input if i.name not in init_names],
        "outputs": [{"name": o.name, "type": TYPES.get(o.type.tensor_type.elem_type, str(o.type.tensor_type.elem_type)), "dims": dims(o)} for o in g.output],
        "nodes": sum(ops.values()), "ops": dict(sorted(ops.items())), "unsupportedNative": un_native, "unsupportedJsep": un_jsep,
        "initializerTypes": dict(itypes), "externalData": ext, "notes": notes,
    }


pins = json.load(open(os.path.join(D, "pins.json")))
targets = []
for mid, p in pins.get("models", {}).items():
    for v, f in (p.get("files") or {}).items():
        if f.get("local", "").endswith(".onnx") and os.path.exists(f["local"]):
            targets.append((mid, v, f["local"]))
evp = os.path.join(D, "evit.json")
if os.path.exists(evp):
    ev = json.load(open(evp))
    if ev.get("onnx") and os.path.exists(ev["onnx"]):
        targets.append(("efficientvit-seg-b1", "fp32", ev["onnx"]))

out = {"nativeKernelOps": len(NATIVE), "jsepOps": len(JSEP), "files": {}}
for mid, v, path in targets:
    try:
        r = inspect(path)
    except Exception as e:  # noqa: BLE001
        r = {"error": repr(e)[:500]}
    r["model"], r["variant"] = mid, v
    out["files"][path] = r
    print(f"{mid} {v}: opset {r.get('opset')} nodes {r.get('nodes')} unsupportedNative {r.get('unsupportedNative')} unsupportedJsep {r.get('unsupportedJsep')} notes {r.get('notes')} {r.get('error', '')}")
    print(f"  inputs {r.get('inputs')}\n  outputs {r.get('outputs')}\n  ops {r.get('ops')}")
json.dump(out, open(os.path.join(D, "inspect.json"), "w"), indent=1)
print(f"native WebGPU EP: {len(NATIVE)} (domain, op) entries; JSEP doc: {len(JSEP)}")

os.makedirs(os.path.join(D, "img"), exist_ok=True)
for name, fn in [("astronaut", "astronaut.png"), ("rocket", "rocket.jpg")]:
    im = Image.open(os.path.join(a.photos, fn)).convert("RGB")
    arr = np.asarray(im, dtype=np.uint8)
    arr.tofile(os.path.join(D, "img", f"{name}.rgb"))
    json.dump({"w": im.width, "h": im.height}, open(os.path.join(D, "img", f"{name}.json"), "w"))
    print(f"photo {name}: {im.width}x{im.height}")
sys.exit(0)
