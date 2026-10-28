"""LightBench's patched BiRefNet_lite for the Subject mask (docs/PHASE3.md Part 30).

Run by the "AI models" workflow's birefnet-patch task on GitHub's runner (huggingface.co is reachable there):

  python -I birefnet_patch.py patch   --model IN.onnx --out OUT.onnx [--max-bufs 8] [--limit BYTES] [--deform-target BYTES]
  python -I birefnet_patch.py verify  --original O.onnx --patched P.onnx --photos A.png B.jpg [--reference R.onnx] --out V.json
  python -I birefnet_patch.py tensors --model P.onnx --out T.json
  python -I birefnet_patch.py source  --manifest web/models/manifest.json --dir RELEASE_DIR

Why a patch. ONNX Runtime 1.30.0 (the app's runtime) can't run onnx-community/BiRefNet_lite-ONNX as published in a browser:
- WebGPU: a kernel binds every input and output as a storage buffer; the graph's Split nodes have up to 32 outputs and its
  Concats up to 32 inputs, over the 8 to 16 a shader may bind ("Too many storage buffers"); and its Convs whose input or
  output is larger than the adapter's maxStorageBufferBindingSize fail (MASKS_PREP_2.md, ORT's segmented bindings).
- Memory: the deformable convolutions (emulated with GatherND, Mul, Sum, Transpose and a k x k stride-k Conv) make tensors
  of up to 784 MiB in fp32 at 1024 x 1024 (decoder_block1 aspp_deforms.2: [1, 64, 1792, 1792]), four at a time: the CPU
  peak is about 4.4 GiB of activations, over WebAssembly's 4 GiB heap ("std::bad_alloc" in ORT Web), and Sum has no
  WebGPU kernel, so on WebGPU those four tensors would be copied into that heap too.

The rewrites, all exact (the same arithmetic in another arrangement; checked by `verify` on the CPU):
 1. deform-chunk: each deformable block whose sampled tensor is over --deform-target runs per channel chunk: the
    sampled input is sliced by channels (widths multiples of 8), each chunk is gathered, weighted, summed, modulated and
    convolved with its slice of the Conv's weights, and the partial results are added in order. The big tensor never
    exists whole; ONNX Runtime runs one chunk's chain at a time (its execution order is a depth-first walk from the
    outputs, and each partial sum needs the previous one).
 2. Sum -> a chain of Adds (Add has a WebGPU kernel, Sum doesn't): ((a + b) + c) + d, as ORT's CPU Sum adds.
 3. (MASKS_PREP_2.md's fix_models.py birefnet-fix, ported) Split with more than --max-bufs - 1 outputs -> one Slice per
    output; Concat with more than --max-bufs - 1 inputs -> a tree of Concats; Conv whose input or output is over --limit
    (128 MiB) -> channel chunks (input-channel chunks summed, output-channel chunks concatenated), widths multiples of 8
    (ORT 1.30.0's WebGPU Conv is wrong with 6, 9 or 15 input channels: MASKS_PREP_2.md; onnxruntime issue #32928).
Shapes come from one ONNX Runtime CPU run with profiling (every node's input and output shapes), at 1 x 3 x 1024 x 1024.
"""

import argparse
import collections
import hashlib
import json
import math
import os
import tempfile
import time

import numpy as np
import onnx
from onnx import helper as h
from onnx import numpy_helper as nh

ES = {1: 4, 10: 2, 7: 8, 6: 4, 9: 1, 11: 8, 16: 2}
MIB = 1 << 20
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
SIZE = 1024


def nbytes(shape, et):
    return int(np.prod(shape)) * ES.get(et, 4)


def sha256(path):
    d = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            d.update(b)
    return d.hexdigest()


def dtype_of(name):
    return {"float": 1, "float16": 10, "int64": 7, "int32": 6, "bool": 9, "double": 11, "uint8": 2, "int8": 3}.get(name, 1)


def test_input(seed=0):
    rng = np.random.default_rng(seed)
    return (rng.standard_normal((1, 3, SIZE, SIZE)) * 1.0).astype(np.float32)


def profile(model, feeds=None, threads=4):
    """One ONNX Runtime CPU run with profiling: {tensor: (shape, elem type)} for every node output and graph input, the
    node events (name, op, sizes, memory in use) and the run's time."""
    import onnxruntime as ort

    m = onnx.ModelProto()
    m.CopyFrom(model)
    for i, n in enumerate(m.graph.node):
        if not n.name:
            n.name = f"lb_unnamed_{i}"
    outs = {n.name: [o for o in n.output] for n in m.graph.node}
    ins = {n.name: [x for x in n.input] for n in m.graph.node}
    d = tempfile.mkdtemp(prefix="lbprof")
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    so.enable_profiling = True
    so.profile_file_prefix = os.path.join(d, "p")
    so.intra_op_num_threads = threads
    s = ort.InferenceSession(m.SerializeToString(), so, providers=["CPUExecutionProvider"])
    feeds = feeds or {s.get_inputs()[0].name: test_input()}
    t = time.time()
    s.run(None, feeds)
    run_s = time.time() - t
    path = s.end_profiling()
    ev = json.load(open(path))
    os.remove(path)
    shapes = {}
    for i in m.graph.input:
        dims = [x.dim_value for x in i.type.tensor_type.shape.dim]
        if all(x > 0 for x in dims):
            shapes[i.name] = (dims, i.type.tensor_type.elem_type)
    nodes = []
    for e in ev:
        if e.get("cat") != "Node" or not e["name"].endswith("_kernel_time"):
            continue
        name = e["name"][: -len("_kernel_time")]
        a = e["args"]
        ots = a.get("output_type_shape") or []
        its = a.get("input_type_shape") or []
        on = [o for o in outs.get(name, []) if o]
        for o, ts in zip(on, ots):
            (k, v), = ts.items()
            shapes[o] = (v, dtype_of(k))
        inn = [x for x in ins.get(name, []) if x]
        for x, ts in zip(inn, its):
            if x not in shapes:
                (k, v), = ts.items()
                shapes[x] = (v, dtype_of(k))
        nodes.append({"name": name, "op": a.get("op_name"), "out": int(a.get("output_size", 0)), "inUse": int(a.get("mem_bytes_in_use", 0)), "shapes": [list(t.values())[0] for t in ots], "types": [list(t.keys())[0] for t in ots]})
    return shapes, nodes, run_s


class Namer:
    def __init__(self, m):
        self.used = {n for node in m.graph.node for n in list(node.input) + list(node.output) + [node.name]} | {i.name for i in m.graph.initializer}
        self.k = 0

    def __call__(self, base):
        while True:
            self.k += 1
            n = f"{base}__lb{self.k}"
            if n not in self.used:
                self.used.add(n)
                return n


def attrs_of(n):
    return {x.name: h.get_attribute_value(x) for x in n.attribute}


def save(m, path):
    used = {x for n in m.graph.node for x in n.input} | {o.name for o in m.graph.output}
    # Constants only the replaced nodes used (the old shapes) go too.
    live = [n for n in m.graph.node if n.op_type != "Constant" or any(o in used for o in n.output)]
    if len(live) != len(m.graph.node):
        del m.graph.node[:]
        m.graph.node.extend(live)
    keep = [i for i in m.graph.initializer if i.name in used]
    removed = len(m.graph.initializer) - len(keep)
    if removed:
        del m.graph.initializer[:]
        m.graph.initializer.extend(keep)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    onnx.save(m, path)  # one file (< 2 GB)
    return removed


# ---------------------------------------------------------------- 1. deformable blocks per channel chunk

ALLOWED = {"Transpose", "GatherND", "Reshape", "Mul", "Sum", "Add", "Cast", "Identity"}


def deform_chunk(m, shapes, target, rep):
    """Rewrites each deformable block whose sampled tensor (the k x k stride-k Conv's input) is over `target` bytes."""
    inits = {i.name: i for i in m.graph.initializer}
    consts = {}
    for n in m.graph.node:
        if n.op_type == "Constant":
            for x in n.attribute:
                if x.name == "value":
                    consts[n.output[0]] = nh.to_array(x.t)
    producer = {o: n for n in m.graph.node for o in n.output}
    consumers = collections.defaultdict(list)
    for n in m.graph.node:
        for x in n.input:
            consumers[x].append(n)
    namer = Namer(m)

    def const(name, arr):
        k = namer(name)
        m.graph.initializer.append(nh.from_array(np.asarray(arr), k))
        return k

    def ancestors(t):
        seen, stack = set(), [t]
        nodes = set()
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            p = producer.get(x)
            if p is not None and id(p) not in nodes:
                nodes.add(id(p))
                stack.extend(i for i in p.input if i)
        return nodes

    def descendants(t):
        seen, stack, nodes = set(), [t], set()
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            for c in consumers.get(x, []):
                if id(c) not in nodes:
                    nodes.add(id(c))
                    stack.extend(c.output)
        return nodes

    def layout_chain(t):
        """The tensors from t back through layout-only nodes (Transpose, Reshape, Cast, Identity), nearest first."""
        chain = [t]
        while True:
            p = producer.get(chain[-1])
            if p is None or p.op_type not in ("Transpose", "Reshape", "Cast", "Identity"):
                return chain
            chain.append(p.input[0])

    replace = {}  # id(conv) -> new nodes (emitted at the Conv's place)
    drop = set()
    for conv in [n for n in m.graph.node if n.op_type == "Conv"]:
        a = attrs_of(conv)
        k = a.get("kernel_shape")
        if not k or a.get("strides") != k or a.get("group", 1) != 1 or conv.input[1] not in inits:
            continue
        xin = conv.input[0]
        if xin not in shapes:
            continue
        xs, et = shapes[xin]
        size = nbytes(xs, et)
        if size <= target:
            continue
        anc = ancestors(xin)
        # The block's gathers: back from the Conv's input through the tensors of its size (the sampled values, gathered,
        # weighted, summed and laid out), not the earlier blocks further up.
        numel = int(np.prod(xs))
        gathers, seen, stack = [], set(), [xin]
        while stack:
            t = stack.pop()
            p = producer.get(t)
            if t in seen or p is None or t not in shapes or int(np.prod(shapes[t][0])) != numel:
                continue
            seen.add(t)
            if p.op_type == "GatherND":
                gathers.append(p)
                continue
            stack.extend(x for x in p.input if x)
        info = {"conv": conv.name, "input": xs, "bytes": size}
        if not gathers:
            continue
        chains = [layout_chain(g.input[0]) for g in gathers]
        common = [t for t in chains[0] if all(t in c for c in chains[1:])]
        if not common:
            rep["deformSkipped"].append({**info, "why": "no common source"})
            continue
        src = common[0]
        cin = xs[1]
        sshape = shapes.get(src, (None,))[0]
        if not sshape or [i for i, d in enumerate(sshape) if d == cin].__len__() != 1:
            rep["deformSkipped"].append({**info, "why": f"source shape {sshape}"})
            continue
        block = descendants(src) & anc
        S = [n for n in m.graph.node if id(n) in block]
        bad = sorted({n.op_type for n in S} - ALLOWED)
        if bad:
            rep["deformSkipped"].append({**info, "why": f"ops {bad}"})
            continue
        inside = {o for n in S for o in n.output} | {src}
        if any(id(c) not in block and id(c) != id(conv) for n in S for o in n.output for c in consumers.get(o, [])):
            rep["deformSkipped"].append({**info, "why": "an inner tensor is used outside the block"})
            continue
        # Each inner tensor's channel axis: its one dimension equal to cin (checked); a broadcast input from outside
        # must be 1 there (or lack the axis).
        chan = {}
        ok = True
        for t in inside:
            ts = shapes.get(t, (None,))[0]
            axes = [i for i, d in enumerate(ts or []) if d == cin]
            if len(axes) != 1:
                ok = False
                break
            chan[t] = axes[0]
        for n in S:
            if not ok:
                break
            if n.op_type in ("Mul", "Add", "Sum"):
                o = n.output[0]
                rank = len(shapes[o][0])
                for x in n.input:
                    if x in inside:
                        continue
                    xs2 = shapes.get(x, (None,))[0] if x not in inits else list(nh.to_array(inits[x]).shape)
                    if xs2 is None and x in consts:
                        xs2 = list(consts[x].shape)
                    off = rank - len(xs2 or [])
                    ax = chan[o] - off
                    if xs2 is None or (0 <= ax < len(xs2) and xs2[ax] != 1):
                        ok = False
            elif n.op_type == "GatherND":
                if n.input[1] in inside or chan.get(n.input[0]) != len(shapes[n.input[0]][0]) - 1:
                    ok = False
            elif n.op_type == "Reshape":
                sh = consts.get(n.input[1]) if n.input[1] in consts else (nh.to_array(inits[n.input[1]]) if n.input[1] in inits else None)
                if sh is None or list(sh).count(cin) != 1 or -1 in list(sh):
                    ok = False
        if not ok:
            rep["deformSkipped"].append({**info, "why": "channel axes"})
            continue
        per_channel = size // cin
        width = max(8, (target // per_channel) // 8 * 8)
        bounds = [(c0, min(cin, c0 + width)) for c0 in range(0, cin, width)]
        w_arr = nh.to_array(inits[conv.input[1]])
        b_arr = nh.to_array(inits[conv.input[2]]) if len(conv.input) > 2 and conv.input[2] in inits else None
        new = []
        acc = None
        sax = chan[src]
        for c0, c1 in bounds:
            ren = {src: namer("deform_src")}
            new.append(h.make_node("Slice", [src, const("st", [c0]), const("en", [c1]), const("ax", [sax])], [ren[src]], name=namer("lb_deform_slice")))
            for n in S:
                ins = [ren.get(x, x) for x in n.input]
                if n.op_type == "Reshape":
                    sh = consts.get(n.input[1]) if n.input[1] in consts else nh.to_array(inits[n.input[1]])
                    sh = np.array([c1 - c0 if d == cin else d for d in sh], dtype=np.int64)
                    ins[1] = const("shape", sh)
                outs = []
                for o in n.output:
                    ren[o] = namer("deform_t")
                    outs.append(ren[o])
                if n.op_type == "Sum":
                    a0 = ins[0]
                    for j, x in enumerate(ins[1:]):
                        o = outs[0] if j == len(ins) - 2 else namer("deform_sum")
                        new.append(h.make_node("Add", [a0, x], [o], name=namer("lb_deform_add")))
                        a0 = o
                    continue
                new.append(h.make_node(n.op_type, ins, outs, name=namer(f"lb_deform_{n.op_type.lower()}"), **attrs_of(n)))
            cins = [ren[xin], const("w", w_arr[:, c0:c1])]
            if b_arr is not None and acc is None:
                cins.append(const("b", b_arr))
            y = namer("deform_conv")
            new.append(h.make_node("Conv", cins, [y], name=namer("lb_deform_conv"), **attrs_of(conv)))
            if acc is None:
                acc = y
            else:
                s = conv.output[0] if (c0, c1) == bounds[-1] else namer("deform_acc")
                new.append(h.make_node("Add", [acc, y], [s], name=namer("lb_deform_acc")))
                acc = s
        if len(bounds) == 1:
            new.append(h.make_node("Identity", [acc], [conv.output[0]], name=namer("lb_deform_id")))
        replace[id(conv)] = new
        for n in S:
            drop.add(id(n))
        rep["deformRewritten"].append({**info, "chunks": len(bounds), "width": width, "chunkBytes": per_channel * width, "nodes": len(S)})
    if not replace:
        return
    out = []
    for n in m.graph.node:
        if id(n) in drop:
            continue
        if id(n) in replace:
            out.extend(replace[id(n)])
            continue
        out.append(n)
    del m.graph.node[:]
    m.graph.node.extend(out)


# ---------------------------------------------------------------- 2 and 3. Sum, Split, Concat and Conv


def rewrite_wide(m, shapes, limit, max_bufs, rep):
    inits = {i.name: i for i in m.graph.initializer}
    namer = Namer(m)
    maxio = max_bufs - 1
    out_nodes = []
    emit = out_nodes.append

    def const(name, arr):
        n = namer(name)
        m.graph.initializer.append(nh.from_array(np.asarray(arr), n))
        return n

    def conv_part(n, x_name, cin_range, w_arr, b_arr, cout_range, cin_full):
        c0, c1 = cin_range
        o0, o1 = cout_range
        xs = x_name
        if (c0, c1) != (0, cin_full):
            xs = namer("conv_x")
            emit(h.make_node("Slice", [x_name, const("st", [c0]), const("en", [c1]), const("ax", [1])], [xs], name=namer("lb_slice")))
        ins = [xs, const("w", w_arr[o0:o1, c0:c1].astype(w_arr.dtype))]
        if b_arr is not None and c0 == 0:
            ins.append(const("b", b_arr[o0:o1].astype(b_arr.dtype)))
        y = namer("conv_y")
        emit(h.make_node("Conv", ins, [y], name=namer("lb_conv"), **attrs_of(n)))
        return y

    for n in m.graph.node:
        if n.op_type == "Sum" and len(n.input) > 1:
            acc = n.input[0]
            for j, x in enumerate(n.input[1:]):
                o = n.output[0] if j == len(n.input) - 2 else namer("sum_part")
                emit(h.make_node("Add", [acc, x], [o], name=namer("lb_sum_add")))
                acc = o
            rep["sumRewritten"] += 1
            continue
        if n.op_type == "Split" and len(n.output) > maxio:
            axis = attrs_of(n).get("axis", 0)
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
                emit(h.make_node("CumSum", [sp, const("ax0", np.array(0, np.int64))], [cs], name=namer("lb_cumsum")))
                stv = namer("split_starts")
                emit(h.make_node("Sub", [cs, sp], [stv], name=namer("lb_sub")))
                st_list, en_list = [], []
                for i in range(k):
                    s_i, e_i = namer("st"), namer("en")
                    emit(h.make_node("Slice", [stv, const("i0", [i]), const("i1", [i + 1])], [s_i], name=namer("lb_slice")))
                    emit(h.make_node("Slice", [cs, const("i0", [i]), const("i1", [i + 1])], [e_i], name=namer("lb_slice")))
                    st_list.append(s_i)
                    en_list.append(e_i)
            else:  # equal parts
                shp = namer("shape")
                emit(h.make_node("Shape", [x], [shp], name=namer("lb_shape")))
                d = namer("dim")
                emit(h.make_node("Gather", [shp, const("ax", [axis])], [d], axis=0, name=namer("lb_gather")))
                c = namer("chunk")
                emit(h.make_node("Div", [d, const("n", [k])], [c], name=namer("lb_div")))
                st_list, en_list = [], []
                for i in range(k):
                    s_i, e_i = namer("st"), namer("en")
                    emit(h.make_node("Mul", [c, const("i", [i])], [s_i], name=namer("lb_mul")))
                    emit(h.make_node("Mul", [c, const("i", [i + 1])], [e_i], name=namer("lb_mul")))
                    st_list.append(s_i)
                    en_list.append(e_i)
            axn = const("axis", [axis])
            for i, o in enumerate(n.output):
                if o:
                    emit(h.make_node("Slice", [x, st_list[i], en_list[i], axn], [o], name=namer("lb_slice")))
            rep["splitRewritten"] += 1
            continue
        if n.op_type == "Concat" and len(n.input) > maxio:
            axis = attrs_of(n)["axis"]
            level = list(n.input)
            while len(level) > maxio:
                nxt = []
                for g in range(0, len(level), maxio):
                    grp = level[g : g + maxio]
                    if len(grp) == 1:
                        nxt.append(grp[0])
                        continue
                    o = namer("concat_part")
                    emit(h.make_node("Concat", grp, [o], axis=axis, name=namer("lb_concat")))
                    nxt.append(o)
                level = nxt
            emit(h.make_node("Concat", level, [n.output[0]], axis=axis, name=namer("lb_concat")))
            rep["concatRewritten"] += 1
            continue
        if n.op_type == "Conv":
            xin, yout = n.input[0], n.output[0]
            xs = shapes.get(xin, (None, 1))
            ys = shapes.get(yout, (None, 1))
            et = xs[1]
            xs, ys = xs[0], ys[0]
            group = attrs_of(n).get("group", 1)
            big_in = xs and nbytes(xs, et) > limit
            big_out = ys and nbytes(ys, et) > limit
            if big_in or big_out:
                info = {"node": n.name, "in": xs, "out": ys, "inBytes": xs and nbytes(xs, et), "outBytes": ys and nbytes(ys, et), "group": group, "kernel": attrs_of(n).get("kernel_shape")}
                if group != 1 or n.input[1] not in inits:
                    rep["convSkipped"].append(info)
                    emit(n)
                    continue
                w_arr = nh.to_array(inits[n.input[1]])
                b_arr = nh.to_array(inits[n.input[2]]) if len(n.input) > 2 and n.input[2] in inits else None
                cin_full = xs[1]
                hw_in = int(np.prod(xs[2:])) * ES.get(et, 4)
                hw_out = int(np.prod(ys[2:])) * ES.get(et, 4)

                def bounds(total, per_channel):
                    if total * per_channel <= limit:
                        return [(0, total)]
                    step = max(8, limit // per_channel // 8 * 8)
                    return [(b, min(total, b + step)) for b in range(0, total, step)]

                cin_chunks = bounds(cin_full, hw_in)
                cout_chunks = bounds(ys[1], hw_out)
                outs = []
                for oc in cout_chunks:
                    parts = [conv_part(n, xin, ic, w_arr, b_arr, oc, cin_full) for ic in cin_chunks]
                    acc = parts[0]
                    for p in parts[1:]:
                        s = namer("conv_sum")
                        emit(h.make_node("Add", [acc, p], [s], name=namer("lb_add")))
                        acc = s
                    outs.append(acc)
                if len(outs) == 1:
                    emit(h.make_node("Identity", [outs[0]], [yout], name=namer("lb_id")))
                else:
                    emit(h.make_node("Concat", outs, [yout], axis=1, name=namer("lb_concat")))
                info.update(inChunks=len(cin_chunks), outChunks=len(cout_chunks))
                rep["convRewritten"].append(info)
                continue
        emit(n)
    wide = collections.Counter()
    for n in out_nodes:
        if n.op_type != "Constant" and len([x for x in n.input if x and x not in inits]) + len(n.output) > max_bufs:
            wide[n.op_type] += 1
    rep["wideLeft"] = dict(wide)
    del m.graph.node[:]
    m.graph.node.extend(out_nodes)


def cmd_patch(a):
    t0 = time.time()
    m = onnx.load(a.model)
    rep = {"source": {"file": os.path.basename(a.model), "bytes": os.path.getsize(a.model), "sha256": sha256(a.model), "nodes": len(m.graph.node)},
           "options": {"maxBufs": a.max_bufs, "limit": a.limit, "deformTarget": a.deform_target},
           "deformRewritten": [], "deformSkipped": [], "sumRewritten": 0, "splitRewritten": 0, "concatRewritten": 0, "convRewritten": [], "convSkipped": []}
    shapes, _, run_s = profile(m)
    rep["profileRunS"] = round(run_s, 1)
    deform_chunk(m, shapes, a.deform_target, rep)
    rewrite_wide(m, shapes, a.limit, a.max_bufs, rep)
    onnx.checker.check_model(m, full_check=False)
    removed = save(m, a.out)
    rep["removedInitializers"] = removed
    rep["patched"] = {"file": os.path.basename(a.out), "bytes": os.path.getsize(a.out), "sha256": sha256(a.out), "nodes": len(m.graph.node)}
    rep["seconds"] = round(time.time() - t0, 1)
    json.dump(rep, open(a.out + ".json", "w"), indent=1)
    print("PATCH", json.dumps({k: v for k, v in rep.items() if k not in ("convRewritten",)}))
    for c in rep["convRewritten"]:
        print(f"  conv {c['node']}: in {c['in']} out {c['out']} -> {c['inChunks']} x {c['outChunks']} chunks")
    for c in rep["deformRewritten"]:
        print(f"  deformable block {c['conv']}: sampled {c['input']} ({c['bytes'] // MIB} MiB) -> {c['chunks']} chunks of {c['width']} channels ({c['chunkBytes'] // MIB} MiB), {c['nodes']} nodes each")


# ---------------------------------------------------------------- checks


def photo_input(path):
    """BiRefNet's own preprocessing (its inference code and transformers.js' processor config): the photo resized to
    1024 x 1024 (bilinear, the aspect not kept), RGB / 255, ImageNet mean and std, NCHW float32."""
    from PIL import Image

    im = Image.open(path).convert("RGB").resize((SIZE, SIZE), Image.BILINEAR)
    x = np.asarray(im, dtype=np.float32) / 255.0
    x = (x - MEAN) / STD
    return x.transpose(2, 0, 1)[None].astype(np.float32)


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x.astype(np.float64)))


def compare(a, b):
    pa, pb = sigmoid(a), sigmoid(b)
    ma, mb = pa >= 0.5, pb >= 0.5
    u = np.logical_or(ma, mb).sum()
    return {"maxAbsLogit": float(np.abs(a - b).max()), "meanAbsLogit": float(np.abs(a - b).mean()), "maxAbsProb": float(np.abs(pa - pb).max()),
            "meanAbsProb": float(np.abs(pa - pb).mean()), "iou": float(np.logical_and(ma, mb).sum() / u) if u else 1.0, "coverage": [float(pa.mean()), float(pb.mean())]}


def session(path, threads=4):
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    # Without the arena the memory goes back when a tensor dies (the original's peak is 6.6 GB of memory even so; with
    # the arena the process grew past 13 GB).
    so.enable_cpu_mem_arena = False
    return ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])


def run(s, x):
    t = time.time()
    y = s.run(None, {s.get_inputs()[0].name: x})[0]
    return y, time.time() - t


def cmd_verify(a):
    """The patched model against the original (and, with --reference, against another variant's original) on the CPU,
    on the photos and a random input: the logits' and probabilities' largest and mean differences, the mask's IoU at ½,
    finite outputs. Thresholds: same precision, IoU >= 0.999 and probabilities within 0.02 (fp16) / 0.001 (fp32); against
    the reference (fp16 against the fp32 original): IoU >= 0.99, mean probability difference <= 0.01."""
    import gc

    cases = [(os.path.basename(p), photo_input(p)) for p in a.photos] + [("random", test_input(1))]

    def all_outputs(path):
        # One model at a time: the original holds about 4.4 GiB of activations at its peak (6.6 GB of memory in all).
        s = session(path)
        io = {"inputs": [(i.name, i.type, i.shape) for i in s.get_inputs()], "outputs": [(o.name, o.type, o.shape) for o in s.get_outputs()]}
        ys = [run(s, x) for _, x in cases]
        del s
        gc.collect()
        return io, ys

    io, yps = all_outputs(a.patched)
    _, yos = all_outputs(a.original)
    yrs = all_outputs(a.reference)[1] if a.reference else None
    fp16 = "fp16" in os.path.basename(a.patched)
    lim_prob = 0.02 if fp16 else 0.001
    res = {"io": io, "cases": [], "problems": []}
    if [i[0] for i in io["inputs"]] != ["input_image"] or [o[0] for o in io["outputs"]] != ["output_image"]:
        res["problems"].append(f"inputs {io['inputs']} outputs {io['outputs']}: expected input_image and output_image")
    for k, (name, x) in enumerate(cases):
        yo, to = yos[k]
        yp, tp = yps[k]
        c = {"case": name, "originalS": round(to, 2), "patchedS": round(tp, 2), "dims": list(yp.shape), "finite": bool(np.isfinite(yp).all()), "patchedVsOriginal": compare(yp, yo)}
        if not c["finite"]:
            res["problems"].append(f"{name}: non-finite output")
        if list(yp.shape) != [1, 1, SIZE, SIZE]:
            res["problems"].append(f"{name}: output {list(yp.shape)}")
        pv = c["patchedVsOriginal"]
        if pv["iou"] < 0.999 or pv["maxAbsProb"] > lim_prob:
            res["problems"].append(f"{name}: patched vs original IoU {pv['iou']:.5f}, max prob diff {pv['maxAbsProb']:.4g}")
        if yrs is not None:
            yr, tr = yrs[k]
            c["referenceS"] = round(tr, 2)
            c["patchedVsReference"] = rv = compare(yp, yr)
            if name != "random" and (rv["iou"] < 0.99 or rv["meanAbsProb"] > 0.01):
                res["problems"].append(f"{name}: against the reference IoU {rv['iou']:.4f}, mean prob diff {rv['meanAbsProb']:.4g}")
        res["cases"].append(c)
        print(json.dumps(c))
    res["ok"] = not res["problems"]
    json.dump(res, open(a.out, "w"), indent=1)
    print("VERIFY", "ok" if res["ok"] else f"problems: {res['problems']}")


def cmd_tensors(a):
    """Every node output at 1024 x 1024 (one profiled CPU run): the largest activation, the largest weight, the tensors
    over 128 MiB by operator, and the peak memory the CPU run held (ONNX Runtime's own count)."""
    m = onnx.load(a.model)
    _, nodes, run_s = profile(m)
    weights = sorted(((int(np.prod(t.dims)) * ES.get(t.data_type, 4), t.name) for t in m.graph.initializer), reverse=True)
    top = sorted(nodes, key=lambda e: -e["out"])[:12]
    over = [e for e in nodes if e["out"] > 128 * MIB]
    peak = max(nodes, key=lambda e: e["inUse"])
    res = {
        "model": os.path.basename(a.model), "runS": round(run_s, 1), "nodes": len(nodes),
        "largestActivation": {"bytes": top[0]["out"], "node": top[0]["name"], "op": top[0]["op"], "shape": top[0]["shapes"], "type": top[0]["types"]},
        "top": [{"bytes": e["out"], "node": e["name"], "op": e["op"], "shape": e["shapes"], "type": e["types"]} for e in top],
        "over128MiB": dict(collections.Counter(e["op"] for e in over)),
        "largestWeight": {"bytes": weights[0][0], "name": weights[0][1]} if weights else None,
        "peakInUse": {"bytes": peak["inUse"], "node": peak["name"]},
        "ops": dict(collections.Counter(n.op_type for n in m.graph.node)),
    }
    json.dump(res, open(a.out, "w"), indent=1)
    print(f"{res['model']}: largest activation {res['largestActivation']['bytes']:,} bytes ({res['largestActivation']['op']} {res['largestActivation']['node']} {res['largestActivation']['shape']}); "
          f"largest weight {res['largestWeight']['bytes']:,} bytes; peak in use on the CPU {res['peakInUse']['bytes']:,} bytes; over 128 MiB: {res['over128MiB'] or 'none'}; run {res['runS']} s")
    for e in res["top"][1:6]:
        print(f"    {e['bytes']:,} bytes {e['op']} {e['node']} {e['shape']}")


def cmd_source(a):
    """SOURCE.md for the release: where the files came from, how they were made and checked, the licence and the
    training data (the manifest's own words)."""
    man = json.load(open(a.manifest))
    e = next(x for x in man["models"] if x["task"] == "subject")
    cf = e["convertedFrom"]
    d = a.dir
    files = sorted(f for f in os.listdir(d) if f.endswith(".onnx"))
    patch = {f: json.load(open(os.path.join(d, f + ".json"))) for f in files if os.path.exists(os.path.join(d, f + ".json"))}
    ver = {}
    for f in files:
        p = os.path.join(d, f.replace(".onnx", ".verify.json"))
        if os.path.exists(p):
            ver[f] = json.load(open(p))
    run = os.environ.get("GITHUB_RUN_ID")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    lines = [
        f"# {e['name']}, patched for ONNX Runtime Web (LightBench)",
        "",
        f"{e['summary']}",
        "",
        "## Where it comes from",
        "",
    ]
    for w in [cf["weights"]] + ([cf["reference"]] if cf.get("reference") else []):
        lines.append(f"- `{w['path']}` of [{w['repo']}](https://huggingface.co/{w['repo']}/tree/{w['revision']}) at commit `{w['revision']}`: {w['bytes']:,} bytes, SHA-256 `{w['sha256']}` (checked before patching).")
    lines += [
        f"- The model's authors: {e['credit']}",
        "",
        "## What LightBench changed",
        "",
        "The weights are unchanged; only the graph's arrangement is, so that ONNX Runtime Web 1.30.0 can run it in a browser "
        "(on WebGPU, and on the processor within WebAssembly's 4 GiB). Every change computes the same thing:",
        "",
        "- the deformable convolutions' sampled tensors (up to 784 MiB in fp32) are processed in channel chunks (widths multiples of 8);",
        "- `Sum` becomes a chain of `Add` (WebGPU has no `Sum` kernel);",
        "- `Split` nodes with more than 7 outputs become one `Slice` each, `Concat` nodes with more than 7 inputs a tree of `Concat`s;",
        "- `Conv` nodes whose input or output is over 128 MiB run in channel chunks (widths multiples of 8).",
        "",
        f"Made by `web/scripts/subject/birefnet_patch.py` (LightBench, GPL-3.0) in the \"AI models\" workflow{f' (run {run} of {repo})' if run else ''}.",
        "",
        "## Checked",
        "",
    ]
    for f in files:
        p = patch.get(f, {})
        v = ver.get(f, {})
        lines.append(f"- `{f}`: {os.path.getsize(os.path.join(d, f)):,} bytes, SHA-256 `{sha256(os.path.join(d, f))}`; "
                     f"{len(p.get('deformRewritten', []))} deformable blocks chunked, {p.get('sumRewritten', 0)} Sums, {p.get('splitRewritten', 0)} Splits, "
                     f"{p.get('concatRewritten', 0)} Concats and {len(p.get('convRewritten', []))} Convs rewritten.")
        for c in v.get("cases", []):
            pv = c["patchedVsOriginal"]
            s = f"  - {c['case']}: against the original on the CPU, mask IoU {pv['iou']:.6f}, largest probability difference {pv['maxAbsProb']:.3g}"
            if "patchedVsReference" in c:
                rv = c["patchedVsReference"]
                s += f"; against the fp32 original, IoU {rv['iou']:.4f}, mean probability difference {rv['meanAbsProb']:.3g}"
            lines.append(s + ".")
    lines += [
        "",
        "## Licence",
        "",
        f"{e['licence']['id']} ({e['licence']['url']}): `LICENSE.txt`. {e['licence']['statement']}",
        "",
        "## Training data, in plain words",
        "",
        e["trainingData"],
        "",
    ]
    open(os.path.join(d, "SOURCE.md"), "w").write("\n".join(lines))
    print("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("patch")
    p.add_argument("--model", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--max-bufs", type=int, default=8)
    p.add_argument("--limit", type=int, default=128 * MIB)
    p.add_argument("--deform-target", type=int, default=64 * MIB)
    v = sub.add_parser("verify")
    v.add_argument("--original", required=True)
    v.add_argument("--patched", required=True)
    v.add_argument("--reference")
    v.add_argument("--photos", nargs="*", default=[])
    v.add_argument("--out", required=True)
    t = sub.add_parser("tensors")
    t.add_argument("--model", required=True)
    t.add_argument("--out", required=True)
    s = sub.add_parser("source")
    s.add_argument("--manifest", required=True)
    s.add_argument("--dir", required=True)
    a = ap.parse_args()
    {"patch": cmd_patch, "verify": cmd_verify, "tensors": cmd_tensors, "source": cmd_source}[a.cmd](a)


if __name__ == "__main__":
    main()
