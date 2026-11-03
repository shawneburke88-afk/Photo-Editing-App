"""Unblur spike: one small ONNX graph per operator the deblurring candidates need, to see which ones ONNX Runtime Web
1.30.0's WebGPU execution provider runs itself and which it leaves to the CPU (ort-web.mjs reads the placement from
ONNX Runtime's verbose log and compares WebGPU's output with WebAssembly's).

  python -I op_graphs.py --out DIR      writes DIR/op-<name>.onnx and DIR/ops.json (name, op, opset, input shapes)
"""
import argparse
import json
import os

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def model(name, nodes, inputs, outputs, opset, inits=()):
    g = helper.make_graph(nodes, name, inputs, outputs, initializer=list(inits))
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", opset)], producer_name="lightbench-unblur-spike")
    m.ir_version = 8 if opset <= 18 else 10
    onnx.checker.check_model(m)
    return m


def vi(name, shape, t=TensorProto.FLOAT):
    return helper.make_tensor_value_info(name, t, shape)


def const(name, arr):
    return numpy_helper.from_array(np.asarray(arr), name)


def build():
    out = []
    C, H, W = 8, 64, 64

    # MISC Filter's flow_warp: F.grid_sample(bilinear, zeros, align_corners=True) -> GridSample (opset 16; 20 renames modes).
    for opset, mode in [(16, "bilinear"), (20, "linear")]:
        out.append((f"gridsample{opset}", model(
            f"gridsample{opset}",
            [helper.make_node("GridSample", ["x", "grid"], ["y"], mode=mode, padding_mode="zeros", align_corners=1)],
            [vi("x", [1, C, H, W]), vi("grid", [1, H, W, 2])], [vi("y", [1, C, H, W])], opset),
            {"x": [1, C, H, W], "grid": [1, H, W, 2]}))
    # The sampling port (gather version): GatherElements on a flattened image with int64 indices from Floor/Clip/Cast.
    out.append(("gatherelements", model(
        "gatherelements",
        [helper.make_node("Mul", ["u", "n"], ["f"]),
         helper.make_node("Floor", ["f"], ["fl"]),
         helper.make_node("Clip", ["fl", "lo", "hi"], ["cl"]),
         helper.make_node("Cast", ["cl"], ["idx"], to=TensorProto.INT64),
         helper.make_node("Expand", ["idx", "shp"], ["idx4"]),
         helper.make_node("GatherElements", ["x", "idx4"], ["y"], axis=2)],
        [vi("x", [1, 4, H * W]), vi("u", [1, 1, H * W])], [vi("y", [1, 4, H * W])], 17,
        [const("n", np.float32(H * W)), const("lo", np.float32(0)), const("hi", np.float32(H * W - 1)), const("shp", np.array([1, 4, H * W], np.int64))]),
        {"x": [1, 4, H * W], "u": [1, 1, H * W], "_u01": ["u"]}))
    # FFT blocks (DeepRFT-style ResBlock in MISC Filter): ONNX DFT, real input, one-sided, along the last axis.
    out.append(("dft17", model(
        "dft17",
        [helper.make_node("DFT", ["x", ""], ["y"], axis=3, onesided=1)],
        [vi("x", [1, C, H, W, 1])], [vi("y", [1, C, H, W // 2 + 1, 2])], 17), {"x": [1, C, H, W, 1]}))
    out.append(("dft20", model(
        "dft20",
        [helper.make_node("DFT", ["x", "", "ax"], ["y"], onesided=1)],
        [vi("x", [1, C, H, W, 1])], [vi("y", [1, C, H, W // 2 + 1, 2])], 20, [const("ax", np.array(3, np.int64))]), {"x": [1, C, H, W, 1]}))
    # The same transform as matrix products (the rewrite used if DFT is missing): (1,C,H,W) @ (W,K), then (H,H) @ (1,C,H,K).
    K = W // 2 + 1
    rng = np.random.default_rng(0)
    out.append(("matmul-dft", model(
        "matmul-dft",
        [helper.make_node("MatMul", ["x", "cw"], ["a"]), helper.make_node("MatMul", ["ch", "a"], ["y"])],
        [vi("x", [1, C, H, W])], [vi("y", [1, C, H, K])], 17,
        [const("cw", rng.standard_normal((W, K)).astype(np.float32)), const("ch", rng.standard_normal((H, H)).astype(np.float32))]),
        {"x": [1, C, H, W]}))
    # ReplicationPad2d -> Pad(edge).
    out.append(("pad-edge", model(
        "pad-edge", [helper.make_node("Pad", ["x", "p"], ["y"], mode="edge")],
        [vi("x", [1, 4, H, W])], [vi("y", [1, 4, H + 6, W + 6])], 17, [const("p", np.array([0, 0, 3, 3, 0, 0, 3, 3], np.int64))]),
        {"x": [1, 4, H, W]}))
    # F.interpolate(scale 0.5, nearest) and nn.Upsample(2, bilinear, align_corners=True) -> Resize.
    out.append(("resize-nearest", model(
        "resize-nearest", [helper.make_node("Resize", ["x", "", "s"], ["y"], mode="nearest", coordinate_transformation_mode="asymmetric", nearest_mode="floor")],
        [vi("x", [1, C, H, W])], [vi("y", [1, C, H // 2, W // 2])], 17, [const("s", np.array([1, 1, 0.5, 0.5], np.float32))]), {"x": [1, C, H, W]}))
    out.append(("resize-linear-ac", model(
        "resize-linear-ac", [helper.make_node("Resize", ["x", "", "s"], ["y"], mode="linear", coordinate_transformation_mode="align_corners")],
        [vi("x", [1, 2, H, W])], [vi("y", [1, 2, H * 2, W * 2])], 17, [const("s", np.array([1, 1, 2, 2], np.float32))]), {"x": [1, 2, H, W]}))
    out.append(("convtranspose", model(
        "convtranspose", [helper.make_node("ConvTranspose", ["x", "w"], ["y"], kernel_shape=[4, 4], strides=[2, 2], pads=[1, 1, 1, 1])],
        [vi("x", [1, 16, H, W])], [vi("y", [1, 8, H * 2, W * 2])], 17, [const("w", (rng.standard_normal((16, 8, 4, 4)) * 0.1).astype(np.float32))]),
        {"x": [1, 16, H, W]}))
    out.append(("softmax", model(
        "softmax", [helper.make_node("Softmax", ["x"], ["y"], axis=1)], [vi("x", [1, 49, H, W])], [vi("y", [1, 49, H, W])], 17), {"x": [1, 49, H, W]}))
    out.append(("where-abs-less", model(
        "where-abs-less", [helper.make_node("Abs", ["x"], ["a"]), helper.make_node("Less", ["a", "t"], ["m"]), helper.make_node("Where", ["m", "one", "x"], ["y"])],
        [vi("x", [1, 1, H, W])], [vi("y", [1, 1, H, W])], 17, [const("t", np.float32(0.5)), const("one", np.float32(1))]), {"x": [1, 1, H, W]}))
    # NAFNet (opencv_zoo's file): CumSum (TLC local pooling), DequantizeLinear (int8 weights), DepthToSpace (PixelShuffle).
    out.append(("cumsum", model(
        "cumsum", [helper.make_node("CumSum", ["x", "ax"], ["y"])], [vi("x", [1, C, H, W])], [vi("y", [1, C, H, W])], 17,
        [const("ax", np.array(3, np.int64))]), {"x": [1, C, H, W]}))
    out.append(("dequantizelinear", model(
        "dequantizelinear", [helper.make_node("DequantizeLinear", ["q", "s", "z"], ["w"], axis=0), helper.make_node("Conv", ["x", "w"], ["y"], pads=[1, 1, 1, 1])],
        [vi("x", [1, C, H, W])], [vi("y", [1, C, H, W])], 21,
        [numpy_helper.from_array(rng.integers(-127, 127, (C, C, 3, 3)).astype(np.int8), "q"), const("s", np.full(C, 0.01, np.float32)), numpy_helper.from_array(np.zeros(C, np.int8), "z")]),
        {"x": [1, C, H, W]}))
    out.append(("depthtospace", model(
        "depthtospace", [helper.make_node("DepthToSpace", ["x"], ["y"], blocksize=2, mode="CRD")], [vi("x", [1, 16, H, W])], [vi("y", [1, 4, H * 2, W * 2])], 17),
        {"x": [1, 16, H, W]}))
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    a = p.parse_args()
    os.makedirs(a.out, exist_ok=True)
    index = []
    for name, m, shapes in build():
        f = os.path.join(a.out, f"op-{name}.onnx")
        onnx.save(m, f)
        index.append({"name": name, "file": os.path.basename(f), "ops": sorted({n.op_type for n in m.graph.node}),
                      "opset": m.opset_import[0].version, "inputs": {k: v for k, v in shapes.items() if not k.startswith("_")},
                      "unit": shapes.get("_u01", [])})
    json.dump(index, open(os.path.join(a.out, "ops.json"), "w"), indent=1)
    print(f"{len(index)} graphs in {a.out}")


if __name__ == "__main__":
    main()
