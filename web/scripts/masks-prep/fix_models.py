"""ONNX rewrites and instrumentation for the masks-prep2 task (throwaway branch lightbench/ai-masks-prep).

  python -I fix_models.py list       --model M --out nodes.json
  python -I fix_models.py instrument --model M --tensors t.json --out M2
  python -I fix_models.py sam-fix    --model M --out M2 [--target BYTES]
  python -I fix_models.py birefnet-fix --model M --out M2 [--max-bufs 8] [--limit BYTES]

Background (ONNX Runtime 1.30.0, WebGPU EP): a tensor larger than the device's maxStorageBufferBindingSize is bound
as several "segments" (onnxruntime PR #25962). Kernels that index storage directly instead of through the segment
helpers then read/write the wrong elements (open PR #32897). Softmax does: its shader uses `x[index]` and
`result[index]`. And a kernel may bind at most maxStorageBuffersPerShaderStage buffers (WebGPU default 8).

sam-fix:      every Softmax whose input is larger than --target (default 64 MiB) is replaced by Split along the
              row axis (-2) -> one Softmax per chunk -> Concat. Exact: softmax over the last axis is row-independent.
birefnet-fix: Split with more outputs than --max-bufs - 1 -> one Slice per output (start/end from the split sizes);
              Concat with more inputs than --max-bufs - 1 -> a tree of Concats; Conv (group 1) whose input or output
              is larger than --limit -> channel chunks (input channels: partial Convs summed; output channels:
              Concat), each below the limit.
Shapes come from onnxruntime (CPU) runs with the tensors exposed as outputs, on a 1x3x1024x1024 input.
"""

import argparse
import collections
import json
import math
import os
import sys

import numpy as np
import onnx
from onnx import helper as h
from onnx import numpy_helper as nh

ES = {1: 4, 10: 2, 7: 8, 6: 4, 9: 1, 11: 8, 16: 2}
ap = argparse.ArgumentParser()
ap.add_argument("cmd")
ap.add_argument("--model", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--tensors")
ap.add_argument("--tensor")
ap.add_argument("--target", type=int, default=64 * 1024 * 1024)
ap.add_argument("--limit", type=int, default=128 * 1024 * 1024)
ap.add_argument("--max-bufs", type=int, default=8)
ap.add_argument("--probe-batch", type=int, default=12)
ap.add_argument("--shapes", help="JSON {tensor: shape} to use instead of probing")
a = ap.parse_args()


def load(path):
    return onnx.load(path, load_external_data=True)


def types_of(m):
    """{tensor: elem_type} from shape inference plus graph inputs/initializers."""
    t = {}
    try:
        inf = onnx.shape_inference.infer_shapes(m)
        for v in list(inf.graph.value_info) + list(inf.graph.output) + list(inf.graph.input):
            if v.type.tensor_type.elem_type:
                t[v.name] = v.type.tensor_type.elem_type
    except Exception as e:  # noqa: BLE001
        print("shape inference failed:", repr(e)[:200])
    for i in m.graph.initializer:
        t[i.name] = i.data_type
    return t


def feeds_for(m):
    import onnxruntime as ort  # noqa: F401

    f = {}
    inits = {i.name for i in m.graph.initializer}
    for i in m.graph.input:
        if i.name in inits:
            continue
        dims = [d.dim_value if d.HasField("dim_value") and d.dim_value > 0 else 1 for d in i.type.tensor_type.shape.dim]
        rng = np.random.default_rng(0)
        f[i.name] = rng.standard_normal(dims).astype(np.float32)
    return f


def probe(m, names, types, batch=None):
    batch = batch or a.probe_batch
    """{tensor: shape} by running onnxruntime CPU with `names` exposed, `batch` at a time."""
    import onnxruntime as ort

    shapes = {}
    names = [n for n in dict.fromkeys(names) if n]
    feeds = feeds_for(m)
    graph_outs = {o.name for o in m.graph.output}
    for k in range(0, len(names), batch):
        part = [n for n in names[k : k + batch]]
        mm = onnx.ModelProto()
        mm.CopyFrom(m)
        for n in part:
            if n not in graph_outs:
                mm.graph.output.append(h.make_tensor_value_info(n, types.get(n, 1), None))
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        s = ort.InferenceSession(mm.SerializeToString(), so, providers=["CPUExecutionProvider"])
        outs = s.run(part, feeds)
        for n, v in zip(part, outs):
            shapes[n] = list(v.shape)
        del s, outs
    return shapes


def nbytes(shape, et):
    return int(np.prod(shape)) * ES.get(et, 4)


def check(m):
    try:
        onnx.checker.check_model(m, full_check=False)
    except Exception as e:  # noqa: BLE001
        print("checker:", repr(e)[:200])


def save(m, path):
    used = {x for n in m.graph.node for x in n.input} | {o.name for o in m.graph.output}
    keep = [i for i in m.graph.initializer if i.name in used]
    if len(keep) != len(m.graph.initializer):
        print(f"removed {len(m.graph.initializer) - len(keep)} unused initializers")
        del m.graph.initializer[:]
        m.graph.initializer.extend(keep)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    onnx.save(m, path)  # single file (< 2 GB)


class Namer:
    def __init__(self, m):
        self.used = {n for node in m.graph.node for n in list(node.input) + list(node.output)} | {i.name for i in m.graph.initializer}
        self.k = 0

    def __call__(self, base):
        while True:
            self.k += 1
            n = f"{base}__mp{self.k}"
            if n not in self.used:
                self.used.add(n)
                return n


def opset(m):
    return next((o.version for o in m.opset_import if o.domain in ("", "ai.onnx")), 0)


def cmd_list():
    m = onnx.load(a.model, load_external_data=False)
    types = types_of(m)
    out = []
    for i, n in enumerate(m.graph.node):
        attrs = {x.name: str(h.get_attribute_value(x))[:120] for x in n.attribute}
        out.append({"i": i, "name": n.name, "op": n.op_type, "domain": n.domain, "inputs": list(n.input), "outputs": list(n.output),
                    "outTypes": [types.get(o, 0) for o in n.output], "attrs": attrs})
    json.dump(out, open(a.out, "w"))
    print(f"{len(out)} nodes")


def cmd_instrument():
    m = load(a.model)
    types = types_of(m)
    names = json.load(open(a.tensors))
    have = {o.name for o in m.graph.output}
    for n in names:
        if n not in have:
            m.graph.output.append(h.make_tensor_value_info(n, types.get(n, 1), None))
    save(m, a.out)
    print(f"exposed {len(names)} tensors -> {a.out}")


def concat_tree(parts, axis, out_name, namer, emit, maxio=6):
    level = list(parts)
    while len(level) > maxio:
        nxt = []
        for g in range(0, len(level), maxio):
            grp = level[g : g + maxio]
            if len(grp) == 1:
                nxt.append(grp[0])
                continue
            o = namer("concat_part")
            emit(h.make_node("Concat", grp, [o], axis=axis, name=namer("mp_concat")))
            nxt.append(o)
        level = nxt
    emit(h.make_node("Concat", level, [out_name], axis=axis, name=namer("mp_concat")))


def cmd_sam_fix():
    """Every Softmax whose input is larger than --target: row chunks (axis -2). When the Softmax output feeds only a
    MatMul as its first input (attention: softmax(QK^T) @ V), possibly through a Cast, each chunk runs
    Slice -> Softmax -> (Cast) -> MatMul with V and the small results are joined by a Concat tree, so the large
    probabilities tensor is never bound whole and no kernel binds many segments. Exact: row-independent."""
    m = load(a.model)
    types = types_of(m)
    sm = [n for n in m.graph.node if n.op_type == "Softmax"]
    shapes = probe(m, [n.input[0] for n in sm], types)
    namer = Namer(m)
    cons = collections.defaultdict(list)
    for n in m.graph.node:
        for i in n.input:
            cons[i].append(n)
    plan = {}
    skip = set()
    report = []
    for n in sm:
        shp = shapes.get(n.input[0])
        et = types.get(n.input[0], 1)
        axis = next((h.get_attribute_value(x) for x in n.attribute if x.name == "axis"), -1)
        rank = len(shp) if shp else 0
        size = nbytes(shp, et) if shp else 0
        if not shp or size <= a.target or rank < 2 or axis not in (-1, rank - 1):
            continue
        rows = shp[-2]
        k = min(rows, math.ceil(size / a.target))
        b = [(i * rows // k, (i + 1) * rows // k) for i in range(k)]
        c1 = cons.get(n.output[0], [])
        cast = c1[0] if len(c1) == 1 and c1[0].op_type == "Cast" else None
        c2 = cons.get(cast.output[0], []) if cast else c1
        mm = c2[0] if len(c2) == 1 and c2[0].op_type == "MatMul" and c2[0].input[0] == (cast.output[0] if cast else n.output[0]) else None
        plan[id(mm) if mm else id(n)] = (n, cast, mm, b, rank)
        if mm:
            skip.add(id(n))
            if cast:
                skip.add(id(cast))
        report.append({"node": n.name, "shape": shp, "bytes": size, "chunks": k, "chunkBytes": nbytes([*shp[:-2], max(e - s0 for s0, e in b), shp[-1]], et), "withMatMul": bool(mm), "cast": bool(cast)})
    out = []
    emit = out.append
    for node in m.graph.node:
        if id(node) in skip:
            continue
        if id(node) not in plan:
            emit(node)
            continue
        n, cast, mm, b, rank = plan[id(node)]
        parts = []
        for r0, r1 in b:
            x = namer("sm_in")
            emit(h.make_node("Slice", [n.input[0], const_init(m, namer, "st", [r0]), const_init(m, namer, "en", [r1]), const_init(m, namer, "ax", [rank - 2])], [x], name=namer("mp_slice")))
            p = namer("sm_out")
            emit(h.make_node("Softmax", [x], [p], axis=-1, name=namer("mp_softmax")))
            if mm:
                if cast:
                    q = namer("sm_cast")
                    emit(h.make_node("Cast", [p], [q], name=namer("mp_cast"), **{x.name: h.get_attribute_value(x) for x in cast.attribute}))
                    p = q
                y = namer("att_out")
                emit(h.make_node("MatMul", [p, mm.input[1]], [y], name=namer("mp_matmul")))
                p = y
            parts.append(p)
        concat_tree(parts, -2, (mm or n).output[0], namer, emit)
    del m.graph.node[:]
    m.graph.node.extend(out)
    check(m)
    save(m, a.out)
    rep = {"softmaxNodes": len(sm), "softmaxInputShapes": {k: v for k, v in shapes.items()}, "rewritten": report}
    json.dump(rep, open(a.out + ".json", "w"), indent=1)
    print("SAM_FIX", json.dumps(rep))


def const_init(m, namer, name, arr):
    n = namer(name)
    m.graph.initializer.append(nh.from_array(np.asarray(arr, dtype=np.int64), n))
    return n


def cmd_birefnet_fix():
    m = load(a.model)
    types = types_of(m)
    inits = {i.name: i for i in m.graph.initializer}
    namer = Namer(m)
    maxio = a.max_bufs - 1
    ver = opset(m)
    rep = {"splitRewritten": 0, "concatRewritten": 0, "convRewritten": [], "convSkipped": [], "wideLeft": collections.Counter()}

    def const(name, arr):
        n = namer(name)
        m.graph.initializer.append(nh.from_array(np.asarray(arr), n))
        return n

    # Conv shapes (input, output) for the channel chunking.
    convs = [n for n in m.graph.node if n.op_type == "Conv"]
    try:
        cshapes = json.load(open(a.shapes)) if a.shapes else probe(m, [x for n in convs for x in (n.input[0], n.output[0])], types)
    except Exception as e:  # noqa: BLE001
        cshapes = {}
        rep["convProbeError"] = repr(e)[:400]
    rep["convShapesProbed"] = len(cshapes)
    big = sorted(((nbytes(v, types.get(k, 1)), k, v) for k, v in cshapes.items()), reverse=True)[:5]
    rep["largestConvTensors"] = [{"tensor": k, "shape": v, "bytes": b} for b, k, v in big]

    out_nodes = []

    def emit(node):
        out_nodes.append(node)

    def conv_part(n, x_name, cin_range, w_arr, b_arr, cout_range, cin_full):
        """Conv over input channels cin_range and output channels cout_range; returns the output name."""
        c0, c1 = cin_range
        o0, o1 = cout_range
        xs = x_name
        if (c0, c1) != (0, cin_full):
            xs = namer("conv_x")
            emit(h.make_node("Slice", [x_name, const("st", [c0]), const("en", [c1]), const("ax", [1])], [xs], name=namer("mp_slice")))
        w = const("w", w_arr[o0:o1, c0:c1].astype(w_arr.dtype))
        ins = [xs, w]
        if b_arr is not None and c0 == 0:
            ins.append(const("b", b_arr[o0:o1].astype(b_arr.dtype)))
        y = namer("conv_y")
        emit(h.make_node("Conv", ins, [y], name=namer("mp_conv"), **{x.name: h.get_attribute_value(x) for x in n.attribute}))
        return y

    for n in m.graph.node:
        if n.op_type == "Split" and len(n.output) > maxio:
            axis = next((h.get_attribute_value(x) for x in n.attribute if x.name == "axis"), 0)
            x = n.input[0]
            sp = n.input[1] if len(n.input) > 1 and n.input[1] else ""
            k = len(n.output)
            if sp and sp in inits:
                sizes = nh.to_array(inits[sp]).astype(np.int64)
                ends = np.cumsum(sizes)
                st_list = [const("st", [int(e - s)]) for s, e in zip(sizes, ends)]
                en_list = [const("en", [int(e)]) for e in ends]
            elif sp:
                cs = namer("split_cs")
                emit(h.make_node("CumSum", [sp, const("ax0", np.array(0, np.int64))], [cs], name=namer("mp_cumsum")))
                stv = namer("split_starts")
                emit(h.make_node("Sub", [cs, sp], [stv], name=namer("mp_sub")))
                st_list, en_list = [], []
                for i in range(k):
                    s_i, e_i = namer("st"), namer("en")
                    emit(h.make_node("Slice", [stv, const("i0", [i]), const("i1", [i + 1])], [s_i], name=namer("mp_slice")))
                    emit(h.make_node("Slice", [cs, const("i0", [i]), const("i1", [i + 1])], [e_i], name=namer("mp_slice")))
                    st_list.append(s_i)
                    en_list.append(e_i)
            else:  # equal parts
                shp = namer("shape")
                emit(h.make_node("Shape", [x], [shp], name=namer("mp_shape")))
                d = namer("dim")
                emit(h.make_node("Gather", [shp, const("ax", [axis])], [d], axis=0, name=namer("mp_gather")))
                c = namer("chunk")
                emit(h.make_node("Div", [d, const("n", [k])], [c], name=namer("mp_div")))
                st_list, en_list = [], []
                for i in range(k):
                    s_i, e_i = namer("st"), namer("en")
                    emit(h.make_node("Mul", [c, const("i", [i])], [s_i], name=namer("mp_mul")))
                    emit(h.make_node("Mul", [c, const("i", [i + 1])], [e_i], name=namer("mp_mul")))
                    st_list.append(s_i)
                    en_list.append(e_i)
            axn = const("axis", [axis])
            for i, o in enumerate(n.output):
                if o:
                    emit(h.make_node("Slice", [x, st_list[i], en_list[i], axn], [o], name=namer("mp_slice")))
            rep["splitRewritten"] += 1
            continue
        if n.op_type == "Concat" and len(n.input) > maxio:
            axis = next(h.get_attribute_value(x) for x in n.attribute if x.name == "axis")
            level = list(n.input)
            while len(level) > maxio:
                nxt = []
                for g in range(0, len(level), maxio):
                    grp = level[g : g + maxio]
                    if len(grp) == 1:
                        nxt.append(grp[0])
                        continue
                    o = namer("concat_part")
                    emit(h.make_node("Concat", grp, [o], axis=axis, name=namer("mp_concat")))
                    nxt.append(o)
                level = nxt
            emit(h.make_node("Concat", level, [n.output[0]], axis=axis, name=namer("mp_concat")))
            rep["concatRewritten"] += 1
            continue
        if n.op_type == "Conv":
            xin, yout = n.input[0], n.output[0]
            xs, ys = cshapes.get(xin), cshapes.get(yout)
            et = types.get(xin, 1)
            group = next((h.get_attribute_value(x) for x in n.attribute if x.name == "group"), 1)
            big_in = xs and nbytes(xs, et) > a.limit
            big_out = ys and nbytes(ys, et) > a.limit
            if big_in or big_out:
                info = {"node": n.name, "in": xs, "out": ys, "inBytes": xs and nbytes(xs, et), "outBytes": ys and nbytes(ys, et), "group": group,
                        "kernel": next((h.get_attribute_value(x) for x in n.attribute if x.name == "kernel_shape"), None)}
                if group != 1 or n.input[1] not in inits:
                    rep["convSkipped"].append(info)
                    emit(n)
                    continue
                w_arr = nh.to_array(inits[n.input[1]])
                b_arr = nh.to_array(inits[n.input[2]]) if len(n.input) > 2 and n.input[2] in inits else None
                cin_full = xs[1]
                hw_in = int(np.prod(xs[2:])) * ES.get(et, 4)
                hw_out = int(np.prod(ys[2:])) * ES.get(et, 4)
                kin = max(1, math.ceil(cin_full * hw_in / a.limit))
                kout = max(1, math.ceil(ys[1] * hw_out / a.limit))
                # Chunk boundaries at multiples of 8 channels: ORT 1.30.0's WebGPU Conv gives wrong results with 6, 9 or
                # 15 input channels (tested on lavapipe; cf. onnxruntime issue #32928, "nine input channels").
                def bounds(total, per_channel):
                    if total * per_channel <= a.limit:
                        return [(0, total)]
                    step = max(8, a.limit // per_channel // 8 * 8)
                    return [(b, min(total, b + step)) for b in range(0, total, step)]
                cin_chunks = bounds(cin_full, hw_in)
                cout_chunks = bounds(ys[1], hw_out)
                kin, kout = len(cin_chunks), len(cout_chunks)
                outs = []
                for oc in cout_chunks:
                    parts = [conv_part(n, xin, ic, w_arr, b_arr, oc, cin_full) for ic in cin_chunks]
                    acc = parts[0]
                    for p in parts[1:]:
                        s = namer("conv_sum")
                        emit(h.make_node("Add", [acc, p], [s], name=namer("mp_add")))
                        acc = s
                    outs.append(acc)
                if len(outs) == 1:
                    emit(h.make_node("Identity", [outs[0]], [yout], name=namer("mp_id")))
                else:
                    emit(h.make_node("Concat", outs, [yout], axis=1, name=namer("mp_concat")))
                info.update(inChunks=kin, outChunks=kout)
                rep["convRewritten"].append(info)
                continue
        emit(n)
    for n in out_nodes:
        if n.op_type not in ("Constant",) and len([x for x in n.input if x and x not in inits]) + len(n.output) > a.max_bufs:
            rep["wideLeft"][n.op_type] += 1
    del m.graph.node[:]
    m.graph.node.extend(out_nodes)
    check(m)
    save(m, a.out)
    rep["wideLeft"] = dict(rep["wideLeft"])
    rep["opset"] = ver
    print("BIREFNET_FIX", json.dumps(rep))
    json.dump(rep, open(a.out + ".json", "w"), indent=1)


def cmd_chunk_big():
    """Chunk every Softmax / LayerNormalization / Pad / Where whose input or output exceeds --limit along a safe axis
    (Slice the inputs, run the op per chunk, Concat): these kernels mishandle segmented tensors in ORT 1.30.0.
    Shapes from --shapes (JSON {tensor: shape}, e.g. from onnxruntime's symbolic shape inference)."""
    m = load(a.model)
    types = types_of(m)
    shapes = json.load(open(a.shapes))
    inits = {i.name: i for i in m.graph.initializer}
    namer = Namer(m)
    target = a.target
    out_nodes, rep = [], []

    def const(name, arr):
        n = namer(name)
        m.graph.initializer.append(nh.from_array(np.asarray(arr), n))
        return n

    for n in m.graph.node:
        if n.op_type not in ("Softmax", "LayerNormalization", "Pad", "Where") or n.output[0] not in shapes:
            out_nodes.append(n)
            continue
        oshape = shapes[n.output[0]]
        et = types.get(n.output[0], 1)
        if any(i and i not in inits and i not in shapes for i in n.input):
            rep.append({"node": n.name, "op": n.op_type, "skipped": "input shape unknown"})
            out_nodes.append(n)
            continue
        sizes = [nbytes(oshape, et)] + [nbytes(shapes[i], types.get(i, 1)) for i in n.input if i and i in shapes and i not in inits]
        if max(sizes) <= a.limit:
            out_nodes.append(n)
            continue
        rank = len(oshape)
        attrs = {x.name: h.get_attribute_value(x) for x in n.attribute}
        if n.op_type == "Softmax":
            bad = {attrs.get("axis", -1) % rank}
        elif n.op_type == "LayerNormalization":
            bad = set(range(attrs.get("axis", -1) % rank, rank))
        elif n.op_type == "Pad":
            pads = nh.to_array(inits[n.input[1]]) if len(n.input) > 1 and n.input[1] in inits else None
            if pads is None:
                rep.append({"node": n.name, "skipped": "pads not constant"})
                out_nodes.append(n)
                continue
            bad = {d for d in range(rank) if pads[d] != 0 or pads[d + rank] != 0}
        else:
            bad = set()
        axes = [d for d in range(rank) if d not in bad and oshape[d] > 1]
        if not axes:
            rep.append({"node": n.name, "skipped": "no safe axis"})
            out_nodes.append(n)
            continue
        ax = max(axes, key=lambda d: oshape[d])
        k = min(oshape[ax], math.ceil(max(sizes) / target))
        bounds = [(i * oshape[ax] // k, (i + 1) * oshape[ax] // k) for i in range(k)]
        parts = []
        for b0, b1 in bounds:
            ins = []
            for j, x in enumerate(n.input):
                xs = shapes.get(x) if x and x not in inits else None
                slice_it = x and x not in inits and xs is not None and (n.op_type != "Pad" or j == 0) and (n.op_type != "LayerNormalization" or j == 0)
                if slice_it:
                    off = rank - len(xs)  # numpy broadcasting: align right
                    d = ax - off
                    if d < 0 or xs[d] != oshape[ax]:
                        slice_it = False
                if slice_it:
                    y = namer("chunk_in")
                    out_nodes.append(h.make_node("Slice", [x, const("st", [b0]), const("en", [b1]), const("ax", [d])], [y], name=namer("mp_slice")))
                    ins.append(y)
                else:
                    ins.append(x)
            o = namer("chunk_out")
            out_nodes.append(h.make_node(n.op_type, ins, [o] + [""] * (len(n.output) - 1), name=namer("mp_" + n.op_type.lower()), **attrs))
            parts.append(o)
        out_nodes.append(h.make_node("Concat", parts, [n.output[0]], axis=ax, name=namer("mp_concat")))
        rep.append({"node": n.name, "op": n.op_type, "shape": oshape, "bytes": max(sizes), "axis": ax, "chunks": k})
    del m.graph.node[:]
    m.graph.node.extend(out_nodes)
    check(m)
    save(m, a.out)
    json.dump(rep, open(a.out + ".chunk.json", "w"), indent=1)
    print("CHUNK_BIG", json.dumps(rep))


def cmd_shapes():
    """All static shapes: ONNX shape inference with data propagation, plus an onnxruntime probe of the inputs and
    outputs of Softmax / LayerNormalization / Pad / Where nodes it could not resolve."""
    m = load(a.model)
    types = types_of(m)
    inf = onnx.shape_inference.infer_shapes(m, data_prop=True)
    S = {}
    for v in list(inf.graph.value_info) + list(inf.graph.output) + list(inf.graph.input):
        dims = [x.dim_value if x.HasField("dim_value") else None for x in v.type.tensor_type.shape.dim]
        if v.type.tensor_type.HasField("shape") and all(x is not None and x > 0 for x in dims):
            S[v.name] = dims
    inits = {i.name for i in m.graph.initializer}
    want = [t for n in m.graph.node if n.op_type in ("Softmax", "LayerNormalization", "Pad", "Where") for t in list(n.input) + [n.output[0]] if t and t not in inits and t not in S]
    rep = {"inferred": len(S), "probe": len(set(want))}
    try:
        S.update(probe(m, list(dict.fromkeys(want)), types))
    except Exception as e:  # noqa: BLE001
        rep["probeError"] = repr(e)[:300]
    json.dump(S, open(a.out, "w"))
    print("SHAPES", json.dumps(rep))


def cmd_prefix():
    """The graph from its input up to --tensor, with that tensor as the only output."""
    m = load(a.model)
    types = types_of(m)
    inits = {i.name for i in m.graph.initializer}
    inp = [i.name for i in m.graph.input if i.name not in inits]
    m.graph.value_info.append(h.make_tensor_value_info(a.tensor, types.get(a.tensor, 1), None))
    sub = onnx.utils.Extractor(m).extract_model(inp, [a.tensor])
    save(sub, a.out)


{"list": cmd_list, "chunk-big": cmd_chunk_big, "shapes": cmd_shapes, "prefix": cmd_prefix, "instrument": cmd_instrument, "sam-fix": cmd_sam_fix, "birefnet-fix": cmd_birefnet_fix}[a.cmd]()
