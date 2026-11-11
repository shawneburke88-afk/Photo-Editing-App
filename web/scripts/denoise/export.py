"""AI Denoise feasibility spike (docs/AI_DENOISE_SPIKE.md): the RawNIND Bayer denoiser (UtNet2) from the authors'
PyTorch checkpoint to ONNX, and the checks on the file. Research only; not app code.

  export   checkpoint -> ONNX (opset 17, TorchScript exporter): one file per fixed tile size and one with dynamic
           height/width; each checked against PyTorch on real tiles (--tiles, .npy of [n, 4, T, T]) and noise
  compare  an exported file against darktable-ai's model_bayer.onnx: the weights (initializers) and the outputs
  fp16     convert to fp16 (onnxconverter-common), run it on the CPU, count non-finite values; and, in PyTorch fp32,
           the largest absolute activation after every layer (fp16's largest finite value is 65504)
  rescale  an exact rescale that keeps every activation inside fp16's range (first convolution and all biases times a
           power of two; the output's scale is arbitrary by training, see rawproc.match_gain), checked in PyTorch with
           every tensor in fp16
  tensors  the largest tensors of a graph by shape inference (the WebGPU binding limit gate)
  ops      single-Conv graphs with 3, 4, 6 and 9 input channels (onnxruntime issue 29651) for ort-web.mjs

UtNet2 below is the authors' network (trougnouf/rawnind_jddc, src/rawnind/models/raw_denoiser.py, GPL-3.0), reduced to
the Bayer variant's layers; parameter names are unchanged so the checkpoint loads as is.

SPDX-License-Identifier: GPL-3.0-or-later
"""
import argparse
import json
import os
import sys

import numpy as np


def build_utnet2(funit=32, in_channels=4):
    import torch
    from torch import nn

    class UtNet2(nn.Module):
        def __init__(self):
            super().__init__()
            act = lambda: nn.LeakyReLU(negative_slope=0.2)  # noqa: E731

            def block(i, o):
                return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), act(), nn.Conv2d(o, o, 3, padding=1), act())

            self.convs1 = block(in_channels, funit)
            self.maxpool = nn.MaxPool2d(2)
            self.convs2 = block(funit, 2 * funit)
            self.convs3 = block(2 * funit, 4 * funit)
            self.convs4 = block(4 * funit, 8 * funit)
            self.bottom = block(8 * funit, 16 * funit)
            self.up1 = nn.ConvTranspose2d(16 * funit, 8 * funit, 2, stride=2)
            self.tconvs1 = block(16 * funit, 8 * funit)
            self.up2 = nn.ConvTranspose2d(8 * funit, 4 * funit, 2, stride=2)
            self.tconvs2 = block(8 * funit, 4 * funit)
            self.up3 = nn.ConvTranspose2d(4 * funit, 2 * funit, 2, stride=2)
            self.tconvs3 = block(4 * funit, 2 * funit)
            self.up4 = nn.ConvTranspose2d(2 * funit, funit, 2, stride=2)
            self.tconvs4 = block(2 * funit, funit)
            if in_channels == 4:
                self.output_module = nn.Sequential(nn.Conv2d(funit, 4 * 3, 1), nn.PixelShuffle(2))
            else:
                self.output_module = nn.Sequential(nn.Conv2d(funit, 3, 1))

        def forward(self, l):  # noqa: E741
            l1 = self.convs1(l)
            l2 = self.convs2(self.maxpool(l1))
            l3 = self.convs3(self.maxpool(l2))
            l4 = self.convs4(self.maxpool(l3))
            l = torch.cat([self.up1(self.bottom(self.maxpool(l4))), l4], dim=1)  # noqa: E741
            l = torch.cat([self.up2(self.tconvs1(l)), l3], dim=1)  # noqa: E741
            l = torch.cat([self.up3(self.tconvs2(l)), l2], dim=1)  # noqa: E741
            l = torch.cat([self.up4(self.tconvs3(l)), l1], dim=1)  # noqa: E741
            l = self.tconvs4(l)  # noqa: E741
            return self.output_module(l)

    return UtNet2()


def load_state(path):
    """A state dict from the authors' .pt file, or (for local dry runs) from an ONNX file's initializers."""
    import torch

    if path.endswith(".onnx"):
        import onnx
        from onnx import numpy_helper

        m = onnx.load(path)
        return {i.name: torch.from_numpy(numpy_helper.to_array(i).copy()) for i in m.graph.initializer}
    sd = torch.load(path, map_location="cpu", weights_only=True)
    if isinstance(sd, dict) and "state_dict" in sd:
        sd = sd["state_dict"]
    return sd


def model_from(path):
    import torch

    sd = load_state(path)
    funit = sd["convs1.0.weight"].shape[0]
    net = build_utnet2(funit=funit, in_channels=sd["convs1.0.weight"].shape[1])
    missing, unexpected = net.load_state_dict(sd, strict=False)
    print(f"checkpoint {os.path.basename(path)}: {len(sd)} tensors, funit {funit}, {sum(v.numel() for v in sd.values())} values; missing {list(missing)}, unexpected {list(unexpected)}")
    if missing:
        sys.exit("the checkpoint does not fill the network")
    net.eval()
    torch.set_grad_enabled(False)
    return net


def session(path, threads=0):
    import onnxruntime as ort

    so = ort.SessionOptions()
    if threads:
        so.intra_op_num_threads = threads
    return ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])


def test_inputs(tiles_path, T, n_noise=1):
    xs = []
    if tiles_path and os.path.exists(tiles_path):
        t = np.load(tiles_path).astype(np.float32)
        for k in range(t.shape[0]):
            x = t[k]
            if x.shape[-1] >= T:
                xs.append(("real tile %d" % k, x[None, :, :T, :T]))
    rng = np.random.default_rng(1)
    for k in range(n_noise):
        xs.append(("noise %d" % k, (0.02 + 0.3 * rng.random((1, 4, T, T)) ** 2).astype(np.float32)))
    return xs


def diff(a, b):
    d = np.abs(a.astype(np.float64) - b.astype(np.float64))
    ref = float(np.abs(a).max())
    return {"max_abs": float(d.max()), "max_rel": float(d.max() / ref) if ref > 0 else 0.0, "mean_rel": float(d.mean() / ref) if ref > 0 else 0.0, "ref_abs_max": ref,
            "psnr_db": float(10 * np.log10(ref ** 2 / max(1e-300, float((d ** 2).mean()))))}


def cmd_export(a):
    import torch

    net = model_from(a.weights)
    os.makedirs(a.out, exist_ok=True)
    res = {}
    for size in [int(s) for s in a.sizes.split(",")] + (["dyn"] if a.dynamic else []):
        T = 512 if size == "dyn" else size
        name = f"{a.name}_{size}.onnx"
        path = os.path.join(a.out, name)
        x = torch.zeros(1, 4, T, T)
        kw = {"dynamic_axes": {"input": {2: "h", 3: "w"}, "output": {2: "h2", 3: "w2"}}} if size == "dyn" else {}
        torch.onnx.export(net, x, path, opset_version=a.opset, input_names=["input"], output_names=["output"], do_constant_folding=True, dynamo=False, **kw)
        import onnx

        m = onnx.load(path)
        onnx.checker.check_model(m)
        ops = {}
        for n in m.graph.node:
            ops[n.op_type] = ops.get(n.op_type, 0) + 1
        s = session(path)
        rows = []
        sizes = [T] if size != "dyn" else [512, 256, 384]
        for TT in sizes:
            for label, xin in test_inputs(a.tiles, TT):
                ref = net(torch.from_numpy(xin)).numpy()
                got = s.run(None, {"input": xin})[0]
                d = diff(ref, got)
                rows.append({"input": f"{label} @{TT}", **d})
                print(f"{name}: {label} @{TT}: vs PyTorch max |Δ| {d['max_abs']:.4g} (output max {d['ref_abs_max']:.4g}; relative {d['max_rel']:.3g}; PSNR {d['psnr_db']:.1f} dB)", flush=True)
        import hashlib

        res[name] = {"bytes": os.path.getsize(path), "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(), "opset": a.opset, "ops": ops, "vs_pytorch": rows}
        print(f"{name}: {res[name]['bytes']} B, sha256 {res[name]['sha256']}, opset {a.opset}, ops {ops}", flush=True)
    json.dump(res, open(os.path.join(a.out, f"{a.name}_export.json"), "w"), indent=1)


def cmd_compare(a):
    import onnx
    from onnx import numpy_helper

    ma, mb = onnx.load(a.model), onnx.load(a.other)
    ia = {i.name: numpy_helper.to_array(i) for i in ma.graph.initializer}
    ib = {i.name: numpy_helper.to_array(i) for i in mb.graph.initializer}
    print(f"{os.path.basename(a.model)}: opset {ma.opset_import[0].version}, producer {ma.producer_name} {ma.producer_version}, {len(ia)} initializers")
    print(f"{os.path.basename(a.other)}: opset {mb.opset_import[0].version}, producer {mb.producer_name} {mb.producer_version}, {len(ib)} initializers")
    # match by shape and order (names differ between exporter versions for folded constants)
    la = [v for v in ia.values() if v.ndim >= 1 and v.size > 4]
    lb = [v for v in ib.values() if v.ndim >= 1 and v.size > 4]
    same = len(la) == len(lb)
    worst = 0.0
    ident = 0
    if same:
        la.sort(key=lambda v: (v.shape, float(v.sum())))
        lb.sort(key=lambda v: (v.shape, float(v.sum())))
        for x, y in zip(la, lb):
            if x.shape != y.shape:
                same = False
                break
            dd = float(np.abs(x - y).max())
            worst = max(worst, dd)
            ident += int(np.array_equal(x, y))
    print(f"weights: {'same shapes' if same else 'DIFFERENT shapes'}; {ident} of {len(la)} tensors bit-identical; largest |Δ| {worst:.3g}; {sum(v.size for v in la)} values")
    sa, sb = session(a.model), session(a.other)
    T = sb.get_inputs()[0].shape[-1]
    for label, x in test_inputs(a.tiles, T):
        d = diff(sb.run(None, {sb.get_inputs()[0].name: x})[0], sa.run(None, {sa.get_inputs()[0].name: x})[0])
        print(f"outputs, {label} @{T}: max |Δ| {d['max_abs']:.4g} (output max {d['ref_abs_max']:.4g}; relative {d['max_rel']:.3g}; PSNR {d['psnr_db']:.1f} dB)")


def activation_maxima(net, xs):
    """Largest |activation| after every module (PyTorch fp32)."""
    import torch

    out = {}
    hooks = []
    for name, mod in net.named_modules():
        if len(list(mod.children())) == 0:
            def hook(m, i, o, name=name):
                out[name] = max(out.get(name, 0.0), float(o.abs().max()))
            hooks.append(mod.register_forward_hook(hook))
    for _, x in xs:
        net(torch.from_numpy(x))
    for h in hooks:
        h.remove()
    return out


def cmd_fp16(a):
    import onnx
    import torch
    from onnxconverter_common import float16

    net = model_from(a.weights)
    T = a.size
    xs = test_inputs(a.tiles, T)
    if a.scale_inputs:
        xs += [(f"{label} x{k:g}", x * k) for label, x in xs[:2] for k in (4.0, 16.0)]
    mx = activation_maxima(net, xs)
    print("largest |activation| per layer (PyTorch fp32), over", len(xs), "inputs; fp16's largest finite value is 65504:")
    for k, v in mx.items():
        print(f"  {k:22s} {v:12.5g} {'  > 65504' if v > 65504 else ''}")
    # Real half-precision arithmetic (PyTorch on the CPU, every tensor stored as fp16), layer by layer. Only with --half:
    # it takes seconds on a CPU with AVX512-FP16 and very long without (GitHub's runners).
    half = model_from(a.weights).half() if a.half else None
    if a.half:
        print("PyTorch with every tensor in fp16 (what a GPU with shader-f16 would store):")
    for label, x in (xs if a.half else []):
        bad = {}
        hooks = []
        for name, mod in half.named_modules():
            if len(list(mod.children())) == 0:
                hooks.append(mod.register_forward_hook(lambda m_, i_, o, name=name: bad.__setitem__(name, int((~torch.isfinite(o)).sum()))))
        y = half(torch.from_numpy(x).half()).float().numpy()
        for h in hooks:
            h.remove()
        first = next((k for k, v in bad.items() if v > 0), None)
        nb = int((~np.isfinite(y)).sum())
        if nb:
            print(f"  {label}: {nb} of {y.size} output values non-finite ({100 * nb / y.size:.2f} %); first layer with a non-finite value: {first}")
        else:
            ref = net(torch.from_numpy(x)).numpy()
            d = diff(ref, y)
            print(f"  {label}: finite; vs fp32 max relative {d['max_rel']:.3g}, PSNR {d['psnr_db']:.1f} dB")
    m = onnx.load(a.model)
    print("ONNX Runtime on the CPU with the fp16 file (its CPU kernels compute Conv in fp32 between casts, so this does not show a GPU's overflow):")
    for keep_io in (True,):
        m16 = float16.convert_float_to_float16(m, keep_io_types=keep_io)
        p16 = os.path.join(a.out, os.path.basename(a.model).replace(".onnx", "_fp16.onnx"))
        onnx.save(m16, p16)
        s32, s16 = session(a.model), session(p16)
        print(f"{os.path.basename(p16)}: {os.path.getsize(p16)} B")
        for label, x in xs:
            ref = s32.run(None, {"input": x})[0]
            got = s16.run(None, {"input": x})[0]
            bad = int((~np.isfinite(got)).sum())
            if bad:
                print(f"  {label}: fp16 output has {bad} non-finite values of {got.size} ({100 * bad / got.size:.2f} %); fp32 output max {np.abs(ref).max():.5g}")
            else:
                d = diff(ref, got)
                print(f"  {label}: fp16 finite; vs fp32 max relative {d['max_rel']:.3g}, PSNR {d['psnr_db']:.1f} dB")


def cmd_rescale(a):
    """An exact rescale for fp16: multiply the first convolution's weights and every bias by --factor (a power of two).
    Conv, ConvTranspose, LeakyReLU, MaxPool, Concat and DepthToSpace are positively homogeneous, so every activation and
    the output are multiplied by the same factor and nothing else changes (the output's scale is arbitrary anyway)."""
    import onnx
    import torch
    from onnx import numpy_helper
    from onnxconverter_common import float16

    net = model_from(a.weights)
    sd = {k: v.clone() for k, v in net.state_dict().items()}
    for k in sd:
        if k.endswith(".bias"):
            sd[k] *= a.factor
    sd["convs1.0.weight"] *= a.factor
    n32 = build_utnet2()
    n32.load_state_dict(sd)
    n32.eval()
    n16 = build_utnet2()
    n16.load_state_dict(sd)
    n16 = n16.half().eval()
    T = a.size
    xs = test_inputs(a.tiles, T)
    if a.scale_inputs:
        xs += [(f"{label} x{k:g}", x * k) for label, x in xs[:4] for k in (4.0,)]
    mx = activation_maxima(n32, xs)
    print(f"rescaled by {a.factor:g} (= 1/{1 / a.factor:g}): largest |activation| over {len(xs)} inputs: {max(mx.values()):.5g} at {max(mx, key=mx.get)} (fp16 limit 65504)")
    for label, x in xs:
        xt = torch.from_numpy(x)
        ref = net(xt).numpy() * a.factor
        e = diff(ref, n32(xt).numpy())
        y = n16(xt.half()).float().numpy()
        nb = int((~np.isfinite(y)).sum())
        if nb:
            print(f"  {label}: rescaled fp32 vs original relative {e['max_rel']:.2g}; all-fp16 PyTorch: {nb} non-finite values")
        else:
            d = diff(ref, y)
            print(f"  {label}: rescaled fp32 vs original relative {e['max_rel']:.2g}; all-fp16 PyTorch: finite, vs fp32 max relative {d['max_rel']:.3g}, mean relative {d['mean_rel']:.3g}, PSNR {d['psnr_db']:.1f} dB")
    if a.model:
        m = onnx.load(a.model)
        first = next(n for n in m.graph.node if n.op_type == "Conv")
        biases = {n.input[2] for n in m.graph.node if n.op_type in ("Conv", "ConvTranspose") and len(n.input) > 2}
        for i in m.graph.initializer:
            if i.name == first.input[1] or i.name in biases:
                i.CopyFrom(numpy_helper.from_array((numpy_helper.to_array(i) * np.float32(a.factor)).astype(np.float32), i.name))
        p = os.path.join(a.out, os.path.basename(a.model).replace(".onnx", "_scaled.onnx"))
        onnx.save(m, p)
        p16 = p.replace(".onnx", "_fp16.onnx")
        onnx.save(float16.convert_float_to_float16(m, keep_io_types=True), p16)
        s0, s1 = session(a.model), session(p)
        x = xs[0][1]
        d = diff(s0.run(None, {"input": x})[0] * a.factor, s1.run(None, {"input": x})[0])
        print(f"{os.path.basename(p)}: {os.path.getsize(p)} B, vs the original x factor (ONNX Runtime, CPU) relative {d['max_rel']:.2g}; {os.path.basename(p16)}: {os.path.getsize(p16)} B")


def cmd_tensors(a):
    import onnx
    from onnx import shape_inference

    for path in a.models:
        m = onnx.load(path)
        for T in [int(s) for s in a.sizes.split(",")]:
            mm = onnx.ModelProto()
            mm.CopyFrom(m)
            d = mm.graph.input[0].type.tensor_type.shape.dim
            d[2].ClearField("dim_param")
            d[3].ClearField("dim_param")
            d[2].dim_value = T
            d[3].dim_value = T
            for o in mm.graph.output:
                dd = o.type.tensor_type.shape.dim
                for k in (2, 3):
                    dd[k].ClearField("dim_param")
                    dd[k].ClearField("dim_value")
            del mm.graph.value_info[:]
            inf = shape_inference.infer_shapes(mm, strict_mode=True)
            rows = []
            total = 0
            for vi in list(inf.graph.value_info) + list(inf.graph.output) + list(inf.graph.input):
                shp = [x.dim_value for x in vi.type.tensor_type.shape.dim]
                if not shp or any(s <= 0 for s in shp):
                    continue
                n = int(np.prod(shp))
                rows.append((n * 4, vi.name, shp))
                total += n * 4
            rows.sort(reverse=True)
            w = sum(int(np.prod(i.dims)) * 4 for i in inf.graph.initializer)
            print(f"{os.path.basename(path)} @ {T} packed ({2 * T} x {2 * T} sensor pixels): largest tensors (fp32): " +
                  "; ".join(f"{b / 2**20:.1f} MiB {name} {shp}" for b, name, shp in rows[:4]) +
                  f". Sum of all activations {total / 2**20:.0f} MiB, weights {w / 2**20:.1f} MiB. 128 MiB limit: {'OK' if rows[0][0] <= 128 * 2**20 else 'EXCEEDED'}")


def cmd_ops(a):
    """Single-Conv graphs with C input channels read straight from the graph input (issue 29651's shape)."""
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    os.makedirs(a.out, exist_ok=True)
    rng = np.random.default_rng(3)
    for C in (3, 4, 6, 9):
        for dt, tn in ((TensorProto.FLOAT, "fp32"), (TensorProto.FLOAT16, "fp16")):
            npdt = np.float32 if dt == TensorProto.FLOAT else np.float16
            w = numpy_helper.from_array((rng.standard_normal((8, C, 3, 3)) * 0.2).astype(npdt), "w")
            b = numpy_helper.from_array((rng.standard_normal(8) * 0.1).astype(npdt), "b")
            g = helper.make_graph([helper.make_node("Conv", ["input", "w", "b"], ["output"], kernel_shape=[3, 3], pads=[1, 1, 1, 1])], f"conv{C}",
                                  [helper.make_tensor_value_info("input", dt, [1, C, 64, 64])], [helper.make_tensor_value_info("output", dt, [1, 8, 64, 64])], [w, b])
            m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 17)])
            m.ir_version = 8
            onnx.checker.check_model(m)
            onnx.save(m, os.path.join(a.out, f"conv_in{C}_{tn}.onnx"))
    print("wrote", sorted(os.listdir(a.out)))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("export")
    s.add_argument("--weights", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--name", default="rawnind_bayer")
    s.add_argument("--sizes", default="512,256")
    s.add_argument("--dynamic", action="store_true")
    s.add_argument("--opset", type=int, default=17)
    s.add_argument("--tiles", default="")
    s = sub.add_parser("compare")
    s.add_argument("--model", required=True)
    s.add_argument("--other", required=True)
    s.add_argument("--tiles", default="")
    s = sub.add_parser("fp16")
    s.add_argument("--weights", required=True)
    s.add_argument("--model", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--size", type=int, default=512)
    s.add_argument("--tiles", default="")
    s.add_argument("--scale-inputs", action="store_true")
    s.add_argument("--half", action="store_true")
    s = sub.add_parser("rescale")
    s.add_argument("--weights", required=True)
    s.add_argument("--model", default="")
    s.add_argument("--out", required=True)
    s.add_argument("--size", type=int, default=512)
    s.add_argument("--factor", type=float, default=1.0 / 1024)
    s.add_argument("--tiles", default="")
    s.add_argument("--scale-inputs", action="store_true")
    s = sub.add_parser("tensors")
    s.add_argument("models", nargs="+")
    s.add_argument("--sizes", default="512,384,256")
    s = sub.add_parser("ops")
    s.add_argument("--out", required=True)
    a = ap.parse_args()
    {"export": cmd_export, "compare": cmd_compare, "fp16": cmd_fp16, "rescale": cmd_rescale, "tensors": cmd_tensors, "ops": cmd_ops}[a.cmd](a)
