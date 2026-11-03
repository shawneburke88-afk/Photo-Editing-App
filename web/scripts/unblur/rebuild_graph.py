"""Unblur spike: rebuild an ONNX graph logged by the "AI models" workflow's speed part (its structure and every
constant, without the convolution weights and biases) with random convolution weights of the same shapes, so the
operator-placement and WebGPU-vs-WebAssembly checks can run where the real weights can't be downloaded.

  python -I rebuild_graph.py --log job.log --name misc_j_256_fp32.onnx --out rebuilt.onnx [--seed 0]

The weights are He-scaled normal values (std sqrt(2 / fan_in) / 2) and zero biases: activations stay in a sane range,
but the output is not a deblurred image. Placement does not depend on the values; the WebGPU-vs-WebAssembly comparison
on these weights checks the kernels, not the model's quality.
"""
import argparse
import ast
import base64
import gzip
import re

import numpy as np
import onnx
from onnx import numpy_helper, helper


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--log", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--seed", type=int, default=0)
    a = p.parse_args()
    chunks, on = [], False
    for line in open(a.log, errors="replace"):
        line = re.sub(r"^\S+Z ", "", line.rstrip("\n"))
        if line.startswith("BEGIN-GRAPH " + a.name):
            on = True
            continue
        if on and line.startswith("END-GRAPH"):
            break
        if on and line.startswith("G "):
            chunks.append(line[2:].strip())
    raw = gzip.decompress(base64.b64decode("".join(chunks)))
    i = raw.rindex(b"\nLBSHAPES")
    m = onnx.ModelProto()
    m.ParseFromString(raw[:i])
    shapes = ast.literal_eval(raw[i + len(b"\nLBSHAPES"):].decode())
    rng = np.random.default_rng(a.seed)
    for name, dims, dt in shapes:
        if len(dims) == 1:
            arr = np.zeros(dims, np.float32)
        else:
            fan_in = int(np.prod(dims[1:]))
            arr = (rng.standard_normal(dims) * np.sqrt(2.0 / fan_in) / 2).astype(np.float32)
        m.graph.initializer.append(numpy_helper.from_array(arr.astype(helper.tensor_dtype_to_np_dtype(dt)), name))
    onnx.checker.check_model(m)
    onnx.save(m, a.out)
    print(f"{a.out}: {len(m.graph.node)} nodes, {len(shapes)} weights rebuilt")


if __name__ == "__main__":
    main()
