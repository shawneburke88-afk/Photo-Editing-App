# The largest tensors of the People models (docs/PHASE3.md Part 28), for the GPU limit gate: ONNX Runtime 1.30.0's
# WebGPU provider computes a tensor larger than the adapter's maxStorageBufferBindingSize wrong (Part 27, "ONNX
# Runtime's binding-limit bug"), so each model's largest weight and activation decides where it may run.
#
#   python people-tensors.py FILES_DIR OUT.json
#
# Every node output is made a graph output and the model run once with ONNX Runtime on the CPU at the input size the
# app uses (RF-DETR 312 x 312; YuNet 640 x 640 and 640 x 384; MediaPipe 256 x 256), so the sizes are the real ones, not
# inferred. Prints the five largest activations and the largest weight of each model.
import json
import os
import sys

import numpy as np
import onnx
import onnxruntime as ort

files, out = sys.argv[1], sys.argv[2]
CASES = [
    ('rf-detr-seg-nano', 'rf-detr-seg-nano--rf-detr-seg-nano.onnx', [('input', (1, 3, 312, 312))]),
    ('yunet', 'yunet--face_detection_yunet_2026may.onnx', [('input', (1, 3, 640, 640))]),
    ('yunet 640x384', 'yunet--face_detection_yunet_2026may.onnx', [('input', (1, 3, 384, 640))]),
    ('mediapipe-selfie-multiclass', 'mediapipe-selfie-multiclass--selfie_multiclass_256x256.onnx', [('input_29', (1, 256, 256, 3))]),
]
res = {}
for name, fn, inputs in CASES:
    path = os.path.join(files, fn)
    m = onnx.load(path)
    weights = sorted(((int(np.prod(t.dims)) * {1: 4, 7: 8, 10: 2, 9: 1, 6: 4}.get(t.data_type, 4), t.name) for t in m.graph.initializer), reverse=True)
    have = {o.name for o in m.graph.output}
    for n in m.graph.node:
        for o in n.output:
            if o and o not in have:
                m.graph.output.append(onnx.ValueInfoProto(name=o))
                have.add(o)
    op_of = {o: n.op_type for n in m.graph.node for o in n.output}
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    s = ort.InferenceSession(m.SerializeToString(), so, providers=['CPUExecutionProvider'])
    rng = np.random.default_rng(0)
    feeds = {k: rng.standard_normal(shape).astype(np.float32) for k, shape in inputs}
    names = [o.name for o in s.get_outputs()]
    vals = s.run(names, feeds)
    sizes = sorted(((v.nbytes, n, list(v.shape), op_of.get(n, 'output')) for n, v in zip(names, vals) if hasattr(v, 'nbytes')), reverse=True)
    res[name] = {
        'largestActivation': {'bytes': sizes[0][0], 'name': sizes[0][1], 'shape': sizes[0][2], 'op': sizes[0][3]},
        'top': [{'bytes': b, 'name': n, 'shape': sh, 'op': op} for b, n, sh, op in sizes[:5]],
        'largestWeight': {'bytes': weights[0][0], 'name': weights[0][1]} if weights else None,
        'tensors': len(sizes),
    }
    print(f"{name}: largest activation {sizes[0][0]:,} bytes ({sizes[0][3]} {sizes[0][1]} {sizes[0][2]}); largest weight {weights[0][0] if weights else 0:,} bytes; {len(sizes)} tensors")
    for b, n, sh, op in sizes[1:5]:
        print(f"    {b:,} bytes {op} {n} {sh}")
json.dump(res, open(out, 'w'), indent=2)
