"""AI Remove's model, checked beyond what ONNX Runtime in Node shows (docs/PHASE3.md Part 26). Run by the "AI models"
workflow's moebius-check task on GitHub's servers; never by the app. Prints plain lines and appends Markdown to the
run's summary ($GITHUB_STEP_SUMMARY).

  python3 scripts/moebius-parity.py inspect DIR
      For each graph in DIR (vae_encoder.onnx, unet.onnx, vae_decoder.onnx): its opset, the operators it uses, its
      largest weight and, after ONNX shape inference at the app's batch sizes (encoder 1, denoiser 2, decoder 1), its
      largest tensor. WebGPU puts each tensor in one buffer, so the largest one is what a GPU's maxBufferSize and
      maxStorageBufferBindingSize must hold (the manifest's "gpu" limits).

  python3 scripts/moebius-parity.py parity --repo MOEBIUS_DIR --weights BIN --unet unet.onnx
      LightBench's own parity check of the current unet.onnx (simonw/Moebius-ONNX @ 5bf1ef5, the Conv2d re-export, for
      which no parity figure is published): the authors' PyTorch model (hustvl/Moebius code, ft_places2 weights)
      against the ONNX file on the same inputs, at a few timesteps.
"""
import json
import os
import sys
import time

SUMMARY = os.environ.get('GITHUB_STEP_SUMMARY')


def md(lines):
    text = '\n'.join(lines) + '\n'
    print(text)
    if SUMMARY:
        with open(SUMMARY, 'a') as f:
            f.write(text + '\n')


def inspect(folder):
    import onnx
    from onnx import shape_inference, TensorProto
    size_of = {TensorProto.FLOAT: 4, TensorProto.FLOAT16: 2, TensorProto.INT64: 8, TensorProto.INT32: 4, TensorProto.BOOL: 1, TensorProto.DOUBLE: 8, TensorProto.UINT8: 1, TensorProto.INT8: 1}
    rows = ['### Graphs, inspected (ONNX shape inference)', '', '| graph | opset | operators | largest weight | largest tensor (batch) |', '|---|---|---|---|---|']
    out = {}
    for name, batch in (('vae_encoder', 1), ('unet', 2), ('vae_decoder', 1)):
        path = os.path.join(folder, name + '.onnx')
        t0 = time.time()
        m = onnx.load(path)
        opset = max((o.version for o in m.opset_import if o.domain in ('', 'ai.onnx')), default=0)
        ops = {}
        for n in m.graph.node:
            ops[n.op_type] = ops.get(n.op_type, 0) + 1
        inits = {i.name for i in m.graph.initializer}
        big_w = max(((len(i.raw_data) or 0, i.name) for i in m.graph.initializer), default=(0, ''))
        for inp in m.graph.input:
            if inp.name in inits:
                continue
            dims = inp.type.tensor_type.shape.dim
            if dims and not dims[0].dim_value:
                dims[0].dim_value = batch
        try:
            inferred = shape_inference.infer_shapes(m)
            big_t = (0, '', [])
            unknown = 0
            for vi in list(inferred.graph.value_info) + list(inferred.graph.output) + list(inferred.graph.input):
                tt = vi.type.tensor_type
                dims = [d.dim_value if d.HasField('dim_value') else None for d in tt.shape.dim]
                if not dims or any(d is None for d in dims):
                    unknown += 1
                    continue
                n = size_of.get(tt.elem_type, 4)
                for d in dims:
                    n *= d
                if n > big_t[0]:
                    big_t = (n, vi.name, dims)
        except Exception as e:  # noqa: BLE001
            big_t, unknown = (0, f'shape inference failed: {e}', []), -1
        out[name] = {'opset': opset, 'ops': ops, 'largestWeight': big_w[0], 'largestWeightName': big_w[1], 'largestTensor': big_t[0], 'largestTensorName': big_t[1], 'largestTensorShape': big_t[2], 'unknownShapes': unknown, 'seconds': round(time.time() - t0, 1)}
        print(name, json.dumps(out[name]))
        top = ', '.join(f'{k} {v}' for k, v in sorted(ops.items(), key=lambda kv: -kv[1]))
        rows.append(f"| {name} | {opset} | {top} | {big_w[0] / 2**20:.1f} MiB | {big_t[0] / 2**20:.1f} MiB `{big_t[1]}` {big_t[2]}{f' ({unknown} shapes not inferred)' if unknown else ''} |")
    need = max(max(v['largestTensor'], v['largestWeight']) for v in out.values())
    rows += ['', f'Largest single tensor over the three graphs: **{need:,} bytes ({need / 2**20:.1f} MiB)**: a GPU whose maxStorageBufferBindingSize or maxBufferSize is below it can’t run AI Remove (WebGPU guarantees 128 MiB and 256 MiB).', '']
    md(rows)
    with open(os.path.join(folder, 'inspect.json'), 'w') as f:
        json.dump(out, f, indent=1)


def stub_fla():
    """hustvl/Moebius's model_lib also imports its teacher (PixelHacker's GLA, flash-linear-attention, CUDA): unused
    here, so it gets empty stand-in modules."""
    import types
    for name in ('fla', 'fla.ops', 'fla.ops.gla', 'fla.models', 'fla.models.gla', 'fla.models.gla.modeling_gla', 'fla.modules'):
        mod = types.ModuleType(name)
        mod.__getattr__ = lambda attr: type(attr, (object,), {})  # PEP 562
        sys.modules[name] = mod


def parity(repo, weights, unet):
    import numpy as np
    import onnxruntime as ort
    import torch
    stub_fla()
    sys.path.insert(0, repo)
    os.chdir(repo)
    from removal.v1_2.removal_model import build_removal_model, load_cfg, load_removal_model
    cfg = load_cfg(os.path.join(repo, 'config/model_cfg/moebius.yaml'))
    t0 = time.time()
    model = build_removal_model(cfg, 20).eval()
    print('load', load_removal_model(model, weights, 'cpu'))
    print(f'PyTorch model built and loaded in {time.time() - t0:.1f} s')
    sess = ort.InferenceSession(unet, providers=['CPUExecutionProvider'])
    torch.manual_seed(0)
    latent = torch.randn(2, 9, 64, 64)
    ids = torch.tensor([list(range(10, 20)), list(range(10))], dtype=torch.int64)
    rows = ['### Parity: unet.onnx against the authors’ PyTorch model', '', f'hustvl/Moebius code at `{os.environ.get("MOEBIUS_COMMIT", "?")}`, ft_places2 weights, torch {torch.__version__}, onnxruntime {ort.__version__} (CPU). Same random input (seed 0), batch of two (unconditional and conditional class ids).', '', '| timestep | max abs difference | mean abs difference | largest value | PyTorch | ONNX |', '|---|---|---|---|---|---|']
    worst = 0.0
    for t in (950, 500, 50):
        ts = torch.tensor([t, t], dtype=torch.int64)
        a = time.time()
        with torch.no_grad():
            ref = model(latent, ts, ids).sample.numpy()
        tt = time.time() - a
        a = time.time()
        got = sess.run(None, {'latent': latent.numpy(), 'timesteps': ts.numpy(), 'input_ids': ids.numpy()})[0]
        to = time.time() - a
        d = np.abs(ref - got)
        worst = max(worst, float(d.max()))
        print(f't={t}: max|d| {d.max():.3e} mean|d| {d.mean():.3e} max|ref| {np.abs(ref).max():.3f} (torch {tt:.1f} s, onnx {to:.1f} s)')
        rows.append(f'| {t} | {d.max():.3e} | {d.mean():.3e} | {np.abs(ref).max():.3f} | {tt:.1f} s | {to:.1f} s |')
    rows += ['', f'Largest difference: **{worst:.3e}** ({"matches" if worst < 1e-3 else "DIFFERS"}: below 1e-3 on outputs of order 1).', '']
    md(rows)
    if worst >= 1e-3:
        sys.exit(1)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'inspect':
        inspect(sys.argv[2])
    elif cmd == 'parity':
        a = sys.argv[2:]
        get = lambda k: a[a.index(k) + 1]  # noqa: E731
        parity(get('--repo'), get('--weights'), get('--unet'))
    else:
        print(__doc__)
        sys.exit(2)
