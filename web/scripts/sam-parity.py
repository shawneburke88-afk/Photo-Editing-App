# Object select's parity with the original SAM 2.1 (docs/PHASE3.md Part 27): the "AI models" workflow's sam-check task
# runs this after scripts/sam-check.mjs. It runs Meta's own PyTorch SAM 2.1 Hiera Tiny (facebookresearch/sam2's
# SAM2ImagePredictor, the sam2.1_hiera_tiny.pt checkpoint) on the same photo with the same prompts, picks the best of
# its three masks by predicted IoU as the app does, and compares each with the app's matte (≥ 128 counts as selected):
# the IoU of the two masks, per case and variant. This checks the whole of the app's pre- and post-processing and the
# ONNX export against the original model.
#
#   python sam-parity.py CHECKPOINT PHOTO CHECK_OUT_DIR
import hashlib
import json
import os
import sys

import numpy as np
import torch
from PIL import Image
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

ckpt, photo, out = sys.argv[1], sys.argv[2], sys.argv[3]
print('checkpoint', ckpt, os.path.getsize(ckpt), 'bytes, sha256', hashlib.sha256(open(ckpt, 'rb').read()).hexdigest())
print('torch', torch.__version__)
model = build_sam2('configs/sam2.1/sam2.1_hiera_t.yaml', ckpt, device='cpu')
pred = SAM2ImagePredictor(model)
img = np.array(Image.open(photo).convert('RGB'))
with torch.inference_mode():
    pred.set_image(img)
spec = json.load(open(os.path.join(out, 'cases.json')))
rows = []
fails = 0
for c in spec['cases']:
    pts = np.array([[p[0], p[1]] for p in c['points']], np.float32) if c['points'] else None
    labs = np.array([p[2] for p in c['points']], np.int32) if c['points'] else None
    box = np.array(c['box'], np.float32) if c['box'] else None
    with torch.inference_mode():
        masks, scores, _ = pred.predict(point_coords=pts, point_labels=labs, box=box, multimask_output=True)
    best = int(np.argmax(scores))
    ref = masks[best] > 0
    app = np.fromfile(os.path.join(out, c['matte']), np.uint8).reshape(c['height'], c['width']) >= 128
    inter = np.logical_and(ref, app).sum()
    union = np.logical_or(ref, app).sum()
    iou = inter / union if union else 1.0
    rows.append((c['variant'], c['name'], c.get('boxAs'), float(scores[best]), float(ref.mean()), float(app.mean()), iou))
    print(f"{c['variant']} {c['name']} ({c.get('boxAs')}): PyTorch best score {scores[best]:.4f} (all {np.round(scores, 4).tolist()}), coverage {ref.mean():.4f}; app coverage {app.mean():.4f}; IoU {iou:.4f}")
    Image.fromarray((ref * 255).astype(np.uint8)).save(os.path.join(out, f"{c['name']}-{c['variant']}-pytorch.png"))
    if c['name'] == 'suit' and iou < 0.9:
        fails += 1
summary = os.environ.get('GITHUB_STEP_SUMMARY')
lines = ['### Parity with Meta\'s PyTorch SAM 2.1 Hiera Tiny', '', '| variant | case | box as | PyTorch score | PyTorch coverage | app coverage | IoU |', '|---|---|---|---|---|---|---|']
lines += [f'| {v} | {n} | {b if n.startswith("box") else ""} | {s:.4f} | {rc:.4f} | {ac:.4f} | {i:.4f} |' for v, n, b, s, rc, ac, i in rows]
lines.append('')
if summary:
    with open(summary, 'a') as f:
        f.write('\n'.join(lines) + '\n')
print('RESULT:', 'parity ok' if not fails else f'{fails} case(s) below IoU 0.9')
sys.exit(1 if fails else 0)
