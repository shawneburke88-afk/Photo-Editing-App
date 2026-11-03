"""Unblur spike: full-resolution behaviour, tiling seams, a real-shake kernel scaled up, and in-plane rotation.

  python -I large.py fullres  --blur BLR.JPG --sharp CLN.JPG --onnx m_512.onnx --tile 512 --overlap 64 --scales 0.25,0.5,0.75,1 --out r.json
  python -I large.py seams    --blur BLR.JPG --sharp CLN.JPG --onnx m.onnx --tile 256 --overlaps 0,32,64 --scale 0.75 --crop 1536 --out r.json
  python -I large.py synthetic --sharp CLN.JPG --kernel-pair gt.png,blur.png --onnx m.onnx --tile 512 --overlap 64 --factors 3,6 --crop 2048 --out r.json
  python -I large.py rotation --images gt1.png,gt2.png --onnx m_256.onnx --tile 256 --overlap 32 --length 24 --out r.json

Inputs are RealBlur's (CC BY 4.0): the full-resolution camera JPEGs of RealBlur_Original_sample (scene097, a test scene:
BLR*.JPG from the right camera, 1/2 s, blurred; CLN*.JPG from the left camera, 1/80 s, sharp, mirrored by the beam
splitter) and the test set's sharp images. The RealBlur sRGB set is the crop rows 1-3094, columns 954-3674 of these
frames, flipped (left camera) and resized to 1/4 (make_srgb_dataset_main_resize.m); `fullres` takes the same crop
and shows it to the model at several scales: 0.25 is the test set's own scale, 0.75 is about a 24 MP camera's pixel
density for the same framing (6000 / 7952 = 0.755), 1 is the 42 MP original. At every scale the output and the
blurred input are scored against the sharp frame at that scale with RealBlur's metric (ECC alignment); the
"downscale route" runs the model at 0.25 and resizes its output back up.
"""
import argparse
import json
import math
import os
import time

import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tiling  # noqa: E402

CROP = (0, 3094, 953, 3674)  # rows, cols (0-based, end exclusive) = MATLAB top 1, bottom 3094, left 954, right 3674


def load(p, flip=False, crop=None):
    im = Image.open(p).convert("RGB")
    a = np.asarray(im, dtype=np.float32) / 255.0
    if flip:
        a = a[:, ::-1]
    if crop:
        a = a[crop[0]:crop[1], crop[2]:crop[3]]
    return np.ascontiguousarray(a)


def resize(a, s=None, size=None, kind="area"):
    import cv2
    h, w = a.shape[:2]
    if size is None:
        size = (max(1, round(w * s)), max(1, round(h * s)))
    if size == (w, h):
        return a
    interp = cv2.INTER_AREA if (size[0] < w and kind == "area") else cv2.INTER_CUBIC
    return cv2.resize(a, size, interpolation=interp)


def srgb_to_lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)


def psnr(a, b, border=0):
    if border:
        a, b = a[border:-border, border:-border], b[border:-border, border:-border]
    m = float(np.mean((np.clip(a, 0, 1).astype(np.float64) - b) ** 2))
    return 10 * math.log10(1 / m)


def ssim(a, b, border=0):
    from skimage.metrics import structural_similarity
    if border:
        a, b = a[border:-border, border:-border], b[border:-border, border:-border]
    return float(structural_similarity(np.clip(a, 0, 1), b, channel_axis=2, gaussian_weights=True, use_sample_covariance=False, data_range=1.0))


def hf_energy(a):
    """Mean squared Laplacian of the luminance: a rough 'how much fine detail' number (higher = sharper or noisier)."""
    import cv2
    y = cv2.cvtColor(np.clip(a, 0, 1).astype(np.float32), cv2.COLOR_RGB2GRAY)
    return float(np.mean(cv2.Laplacian(y, cv2.CV_32F) ** 2))


def save_strip(path, parts, size=512):
    """Side-by-side crops (the same region of each) for the run's artifact."""
    h, w = parts[0].shape[:2]
    y, x = max(0, (h - size) // 2), max(0, (w - size) // 2)
    row = np.concatenate([np.clip(p[y:y + size, x:x + size], 0, 1) for p in parts], axis=1)
    Image.fromarray(np.round(row * 255).astype(np.uint8)).save(path, quality=90)


def centre_half(a, margin=0):
    h, w = a.shape[:2]
    return a[max(0, h // 4 - margin):min(h, 3 * h // 4 + margin), max(0, w // 4 - margin):min(w, 3 * w // 4 + margin)]


def full_frame_tiles(h, w, tile, overlap):
    st = lambda n: 1 if n <= tile else len(tiling._starts(n, tile, tile - overlap))  # noqa: E731
    return st(h) * st(w)


def cmd_fullres(a):
    """The model sees the central half of the frame (plus a 64 px margin, cropped off before scoring) at each scale;
    scores are over that central half. The tile count for the whole frame is given for reference."""
    run = tiling.Runner(a.onnx, a.threads)
    blur = load(a.blur, crop=CROP)
    sharp = load(a.sharp, flip=True, crop=CROP)
    m = 64
    res = {"blur": os.path.basename(a.blur), "sharp": os.path.basename(a.sharp), "crop": list(blur.shape[:2]), "onnx": os.path.basename(a.onnx),
           "tile": a.tile, "overlap": a.overlap, "region": "central half of the frame", "scales": {}}
    base = 0.25
    b_base = resize(blur, base)
    run.reset()
    t = time.time()
    out_base = tiling.tiled(b_base, run, a.tile, a.overlap)
    base_s, base_calls = time.time() - t, run.calls
    for s in [float(x) for x in a.scales.split(",")]:
        b, g = resize(blur, s), resize(sharp, s)
        H, W = b.shape[:2]
        bc, gc = centre_half(b), centre_half(g)
        row = {"frame": [H, W], "region": list(bc.shape[:2]), "fullFrameTiles": full_frame_tiles(H, W, a.tile, a.overlap)}
        row["input"] = tiling.realblur_metric(bc, gc)
        if s == base:
            out, secs, calls = centre_half(out_base), base_s, base_calls
        else:
            run.reset()
            t = time.time()
            bm = centre_half(b, m)
            om = tiling.tiled(bm, run, a.tile, a.overlap)
            oy = (bm.shape[0] - bc.shape[0]) // 2
            ox = (bm.shape[1] - bc.shape[1]) // 2
            out = om[oy:oy + bc.shape[0], ox:ox + bc.shape[1]]
            secs, calls = time.time() - t, run.calls
        row["direct"] = {**tiling.realblur_metric(out, gc), "seconds": round(secs, 1), "tiles": calls, "wildTiles": run.wild if s != base else None}
        if s != base:
            up = centre_half(resize(out_base, size=(W, H), kind="cubic"))
            row["downscaleRoute"] = tiling.realblur_metric(up, gc)
            row["downUpInput"] = tiling.realblur_metric(centre_half(resize(b_base, size=(W, H), kind="cubic")), gc)
        row["hf"] = {"input": hf_energy(bc), "direct": hf_energy(out), "sharp": hf_energy(gc)}
        res["scales"][str(s)] = row
        print(f"scale {s} frame {H}x{W} (whole frame {row['fullFrameTiles']} tiles): input {row['input']['psnr']:.2f}/{row['input']['ssim']:.4f}  direct {row['direct']['psnr']:.2f}/{row['direct']['ssim']:.4f} ({secs:.0f} s, {calls} tiles)"
              + (f"  downscale route {row['downscaleRoute']['psnr']:.2f}/{row['downscaleRoute']['ssim']:.4f}  down-up input {row['downUpInput']['psnr']:.2f}/{row['downUpInput']['ssim']:.4f}" if 'downscaleRoute' in row else ""), flush=True)
        if a.save_dir:
            os.makedirs(a.save_dir, exist_ok=True)
            parts = [bc, out] + ([up] if s != base else []) + [gc]
            save_strip(os.path.join(a.save_dir, f"{a.name}_{os.path.splitext(res['blur'])[0]}_fullres_{s}.jpg"), parts)
    json.dump(res, open(a.out, "w"), indent=1)
    print("RESULT " + json.dumps(res), flush=True)


def seam_stats(out, ys, xs, tile, overlap):
    """Mean |step| between neighbouring columns (rows) on the tile boundaries, divided by the same 4-12 px away.
    Boundary: where a later tile starts (no overlap) or the middle of the overlap band (blended)."""
    g = np.mean(np.clip(out, 0, 1), axis=2).astype(np.float64)
    dx = np.abs(np.diff(g, axis=1))  # dx[:, c-1] = |g[:, c] - g[:, c-1]|
    dy = np.abs(np.diff(g, axis=0))
    ratios = []
    for i in range(1, len(xs)):
        c = xs[i] + (overlap // 2 if overlap else 0) if overlap else xs[i]
        if overlap:
            c = (xs[i] + (xs[i - 1] + tile)) // 2
        if 13 <= c < g.shape[1] - 13:
            near = np.mean([dx[:, c - 1 + k].mean() for k in list(range(-12, -3)) + list(range(4, 13))])
            ratios.append(dx[:, c - 1].mean() / near)
    for i in range(1, len(ys)):
        r = ys[i] if not overlap else (ys[i] + (ys[i - 1] + tile)) // 2
        if 13 <= r < g.shape[0] - 13:
            near = np.mean([dy[r - 1 + k, :].mean() for k in list(range(-12, -3)) + list(range(4, 13))])
            ratios.append(dy[r - 1, :].mean() / near)
    return {"boundaries": len(ratios), "meanRatio": float(np.mean(ratios)) if ratios else None, "maxRatio": float(np.max(ratios)) if ratios else None}


def cmd_seams(a):
    run = tiling.Runner(a.onnx, a.threads)
    blur = resize(load(a.blur, crop=CROP), a.scale)
    sharp = resize(load(a.sharp, flip=True, crop=CROP), a.scale)
    h, w = blur.shape[:2]
    c = min(a.crop, h, w)
    y0, x0 = (h - c) // 2, (w - c) // 2
    blur, sharp = blur[y0:y0 + c, x0:x0 + c], sharp[y0:y0 + c, x0:x0 + c]
    res = {"onnx": os.path.basename(a.onnx), "scale": a.scale, "crop": c, "tile": a.tile, "variants": {}}
    outs = {}
    for ov in [int(x) for x in a.overlaps.split(",")]:
        run.reset()
        t = time.time()
        out, n, ys, xs = tiling.tiled(blur, run, a.tile, ov, return_count=True)
        secs = time.time() - t
        wild = run.wild
        outs[ov] = out
        # The same with the tile grid shifted by half a tile (the image padded by reflection, then cropped back).
        sh = a.tile // 2
        padded = np.pad(blur, ((sh, 0), (sh, 0), (0, 0)), mode="reflect")
        out2 = tiling.tiled(padded, run, a.tile, ov)[sh:, sh:]
        m = 8  # ignore the outermost pixels (reflection)
        diff = np.abs(np.clip(out, 0, 1) - np.clip(out2, 0, 1))[m:-m, m:-m]
        row = {"tiles": n, "wildTiles": wild, "seconds": round(secs, 1), "seams": seam_stats(out, ys, xs, a.tile, ov),
               "inputSeams": seam_stats(blur, ys, xs, a.tile, ov),
               "shiftedGrid": {"psnr": psnr(out[m:-m, m:-m], np.clip(out2, 0, 1)[m:-m, m:-m]), "maxAbs": float(diff.max()), "p999": float(np.quantile(diff, 0.999))},
               "vsSharp": tiling.realblur_metric(out, sharp)}
        res["variants"][str(ov)] = row
        print(f"tile {a.tile} overlap {ov}: {n} tiles ({wild} wild) {secs:.0f} s; seam step ratio {row['seams']['meanRatio']:.3f} (max {row['seams']['maxRatio']:.3f}; input {row['inputSeams']['meanRatio']:.3f}); "
              f"shifted grid PSNR {row['shiftedGrid']['psnr']:.2f} dB, max diff {row['shiftedGrid']['maxAbs']:.3f}; vs sharp {row['vsSharp']['psnr']:.2f}", flush=True)
        if a.save_dir:
            os.makedirs(a.save_dir, exist_ok=True)
            # a crop centred on a tile corner, where seams would show
            cy, cx = (ys[1] if len(ys) > 1 else 0), (xs[1] if len(xs) > 1 else 0)
            y, x = max(0, cy - 128), max(0, cx - 128)
            strip = np.concatenate([np.clip(p[y:y + 256, x:x + 256], 0, 1) for p in (blur, out, out2)], axis=1)
            Image.fromarray(np.round(strip * 255).astype(np.uint8)).save(os.path.join(a.save_dir, f"{a.name}_seams_{a.tile}_{ov}.jpg"), quality=92)
    res["input"] = tiling.realblur_metric(blur, sharp)
    json.dump(res, open(a.out, "w"), indent=1)
    print("RESULT " + json.dumps(res), flush=True)


def estimate_kernel(sharp, blur, size=41, lam=1e-2):
    """A blur kernel from an aligned sharp/blurred pair (linear light, grey), least squares in the gradient domain:
    K = sum(conj(dS) dB) / (sum |dS|^2 + lam), cropped around its centroid, negatives clipped, normalised."""
    gs, gb = srgb_to_lin(sharp).mean(axis=2), srgb_to_lin(blur).mean(axis=2)
    num = 0
    den = 0
    for d in ([[1, -1]], [[1], [-1]]):
        from scipy.signal import convolve2d
        ds = convolve2d(gs, np.array(d), mode="same", boundary="symm")
        db = convolve2d(gb, np.array(d), mode="same", boundary="symm")
        S, B = np.fft.fft2(ds), np.fft.fft2(db)
        num = num + np.conj(S) * B
        den = den + np.abs(S) ** 2
    k = np.real(np.fft.ifft2(num / (den + lam * den.mean())))
    k = np.fft.fftshift(k)
    cy, cx = np.array(k.shape) // 2
    r = size // 2
    k = k[cy - r:cy + r + 1, cx - r:cx + r + 1]
    k = np.clip(k, 0, None)
    k[k < 0.05 * k.max()] = 0
    k /= k.sum()
    ys, xs = np.nonzero(k > 0.01 * k.max())
    return k, {"supportPx": [int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1)]}


def blur_with(img, k):
    import cv2
    lin = srgb_to_lin(img)
    out = np.stack([cv2.filter2D(lin[..., c], -1, k[::-1, ::-1].astype(np.float32), borderType=cv2.BORDER_REFLECT) for c in range(3)], axis=2)
    return lin_to_srgb(out).astype(np.float32)


def scale_kernel(k, f):
    import cv2
    n = int(math.ceil(k.shape[0] * f)) | 1
    kk = cv2.resize(k.astype(np.float32), (n, n), interpolation=cv2.INTER_CUBIC)
    kk = np.clip(kk, 0, None)
    return kk / kk.sum()


def cmd_synthetic(a):
    run = tiling.Runner(a.onnx, a.threads)
    gt_p, bl_p = a.kernel_pair.split(",")
    k, kinfo = estimate_kernel(np.asarray(Image.open(gt_p).convert("RGB"), np.float32) / 255, np.asarray(Image.open(bl_p).convert("RGB"), np.float32) / 255)
    sharp_full = load(a.sharp, flip=True, crop=CROP)
    res = {"kernelFrom": [os.path.basename(gt_p), bl_p], "kernel": kinfo, "onnx": os.path.basename(a.onnx), "tile": a.tile, "overlap": a.overlap, "factors": {}}
    print(f"kernel estimated from {bl_p}: support {kinfo['supportPx']} px at the test set's scale", flush=True)
    for f in [float(x) for x in a.factors.split(",")]:
        # The sharp frame at a pixel density where this shake spans f times the test set's pixels: the test set is the
        # crop at 1/4, so the frame at f/4 (capped at the original, 1.0; beyond that the kernel itself is enlarged).
        # The kernel (estimated at the test set's scale) enlarged f times; the frame at f/4 (at most the original).
        s = min(1.0, f / 4)
        kf = scale_kernel(k, f) if f != 1 else k
        sharp = resize(sharp_full, s)
        h, w = sharp.shape[:2]
        c = min(a.crop, h, w)
        y0, x0 = (h - c) // 2, (w - c) // 2
        sharp = sharp[y0:y0 + c, x0:x0 + c]
        blurred = blur_with(sharp, kf)
        bd = kf.shape[0] // 2 + 8
        run.reset()
        t = time.time()
        out = tiling.tiled(blurred, run, a.tile, a.overlap)
        secs = time.time() - t
        wild_direct = run.wild
        small = resize(blurred, 1 / f)
        run.reset()
        out_small = tiling.tiled(small, run, a.tile, a.overlap)
        wild_small = run.wild
        up = resize(out_small, size=(c, c), kind="cubic")
        up_in = resize(small, size=(c, c), kind="cubic")
        ys_, xs_ = np.nonzero(kf > 0.01 * kf.max())
        row = {"frameScale": s, "kernelArrayPx": int(kf.shape[0]), "kernelSupportPx": [int(ys_.max() - ys_.min() + 1), int(xs_.max() - xs_.min() + 1)],
               "crop": c, "seconds": round(secs, 1), "wildTiles": {"direct": wild_direct, "downscaled": wild_small},
               "input": {"psnr": psnr(blurred, sharp, bd), "ssim": ssim(blurred, sharp, bd)},
               "direct": {"psnr": psnr(out, sharp, bd), "ssim": ssim(out, sharp, bd)},
               "downscaleRoute": {"psnr": psnr(up, sharp, bd), "ssim": ssim(up, sharp, bd)},
               "downUpInput": {"psnr": psnr(up_in, sharp, bd), "ssim": ssim(up_in, sharp, bd)},
               "hf": {"sharp": hf_energy(sharp), "input": hf_energy(blurred), "direct": hf_energy(out), "downscaleRoute": hf_energy(up)}}
        res["factors"][str(f)] = row
        print(f"x{f}: kernel support {row['kernelSupportPx']} px on a {c} px crop; wild tiles {row['wildTiles']}; input {row['input']['psnr']:.2f}; direct {row['direct']['psnr']:.2f} ({secs:.0f} s); "
              f"downscale route {row['downscaleRoute']['psnr']:.2f} (down-up input {row['downUpInput']['psnr']:.2f}); HF {row['hf']}", flush=True)
        if a.save_dir:
            os.makedirs(a.save_dir, exist_ok=True)
            save_strip(os.path.join(a.save_dir, f"{a.name}_synthetic_x{f}.jpg"), [blurred, out, up, sharp])
    json.dump(res, open(a.out, "w"), indent=1)
    print("RESULT " + json.dumps(res), flush=True)


def rotate_blur(img, theta, n=41):
    """In-plane rotation about the centre, averaged over n angles in [-theta/2, theta/2] (linear light)."""
    import cv2
    h, w = img.shape[:2]
    lin = srgb_to_lin(img)
    acc = np.zeros_like(lin)
    for t in np.linspace(-theta / 2, theta / 2, n):
        M = cv2.getRotationMatrix2D(((w - 1) / 2, (h - 1) / 2), math.degrees(t), 1.0)
        acc += cv2.warpAffine(lin, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return lin_to_srgb(acc / n).astype(np.float32)


def line_blur(img, length, angle_deg, n=41):
    import cv2
    h, w = img.shape[:2]
    lin = srgb_to_lin(img)
    acc = np.zeros_like(lin)
    for t in np.linspace(-0.5, 0.5, n):
        dx, dy = t * length * math.cos(math.radians(angle_deg)), t * length * math.sin(math.radians(angle_deg))
        M = np.float32([[1, 0, dx], [0, 1, dy]])
        acc += cv2.warpAffine(lin, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return lin_to_srgb(acc / n).astype(np.float32)


def regions(h, w):
    q = lambda v: int(v)  # noqa: E731
    rh, rw = q(h / 4), q(w / 4)
    cy, cx = h // 2, w // 2
    return {"centre": (cy - rh // 2, cy + rh // 2, cx - rw // 2, cx + rw // 2),
            "topLeft": (8, 8 + rh, 8, 8 + rw), "topRight": (8, 8 + rh, w - 8 - rw, w - 8),
            "bottomLeft": (h - 8 - rh, h - 8, 8, 8 + rw), "bottomRight": (h - 8 - rh, h - 8, w - 8 - rw, w - 8)}


def cmd_rotation(a):
    run = tiling.Runner(a.onnx, a.threads)
    res = {"onnx": os.path.basename(a.onnx), "tile": a.tile, "overlap": a.overlap, "lengthPx": a.length, "images": []}
    agg = {}
    for p in [x for x in a.images.split(",") if x]:
        sharp = np.asarray(Image.open(p).convert("RGB"), np.float32) / 255
        h, w = sharp.shape[:2]
        rad = math.hypot(h / 2, w / 2)
        theta = a.length / rad  # the corners' arc length = length px
        rot = rotate_blur(sharp, theta)
        reg = regions(h, w)
        row = {"image": os.path.basename(p), "size": [h, w], "thetaDeg": math.degrees(theta), "rotation": {}, "uniform": {}}
        run_fn = (lambda im: tiling.paper_windows(im, run, a.tile)) if a.protocol == "paper" else (lambda im: tiling.tiled(im, run, a.tile, a.overlap))
        run.reset()
        out_rot = run_fn(rot)
        row["wildTilesRotation"] = run.wild
        for name, (y0, y1, x0, x1) in reg.items():
            # the blur length the region's centre gets from the rotation
            ry, rx = (y0 + y1) / 2 - h / 2, (x0 + x1) / 2 - w / 2
            row["rotation"][name] = {"blurPx": round(math.hypot(ry, rx) * theta, 1),
                                     "input": psnr(rot[y0:y1, x0:x1], sharp[y0:y1, x0:x1]), "output": psnr(out_rot[y0:y1, x0:x1], sharp[y0:y1, x0:x1])}
        # Control: a uniform straight blur of the same length, in each corner's own direction of motion (tangential).
        for name, (y0, y1, x0, x1) in reg.items():
            if name == "centre":
                continue
            ry, rx = (y0 + y1) / 2 - h / 2, (x0 + x1) / 2 - w / 2
            ang = math.degrees(math.atan2(rx, -ry))  # tangent to the circle through the region's centre
            L = math.hypot(ry, rx) * theta
            u = line_blur(sharp, L, ang)
            out_u = run_fn(u)
            row["uniform"][name] = {"blurPx": round(L, 1), "input": psnr(u[y0:y1, x0:x1], sharp[y0:y1, x0:x1]), "output": psnr(out_u[y0:y1, x0:x1], sharp[y0:y1, x0:x1])}
        res["images"].append(row)
        for kind in ("rotation", "uniform"):
            for name, v in row[kind].items():
                agg.setdefault(kind, {}).setdefault(name, []).append(v["output"] - v["input"])
        print(f"{row['image']} theta {row['thetaDeg']:.2f} deg: " + "; ".join(f"{k} rot {v['input']:.2f}->{v['output']:.2f} ({v['blurPx']} px)" for k, v in row["rotation"].items())
              + " | uniform: " + "; ".join(f"{k} {v['input']:.2f}->{v['output']:.2f}" for k, v in row["uniform"].items()), flush=True)
        if a.save_dir:
            os.makedirs(a.save_dir, exist_ok=True)
            y0, y1, x0, x1 = reg["topLeft"]
            strip = np.concatenate([np.clip(v[y0:y1, x0:x1], 0, 1) for v in (rot, out_rot, sharp)], axis=1)
            Image.fromarray(np.round(strip * 255).astype(np.uint8)).save(os.path.join(a.save_dir, f"{a.name}_rotation_{row['image']}.jpg"), quality=92)
    res["meanGainDb"] = {k: {n: float(np.mean(v)) for n, v in d.items()} for k, d in agg.items()}
    json.dump(res, open(a.out, "w"), indent=1)
    print("RESULT " + json.dumps({k: v for k, v in res.items() if k != "images"}), flush=True)


def main():
    p = argparse.ArgumentParser()
    s = p.add_subparsers(dest="cmd", required=True)
    for name in ["fullres", "seams", "synthetic", "rotation"]:
        q = s.add_parser(name)
        q.add_argument("--onnx", required=True)
        q.add_argument("--tile", type=int, default=256)
        q.add_argument("--overlap", type=int, default=32)
        q.add_argument("--threads", type=int, default=4)
        q.add_argument("--out", required=True)
        q.add_argument("--name", default="model")
        q.add_argument("--save-dir")
        if name in ("fullres", "seams"):
            q.add_argument("--blur", required=True)
            q.add_argument("--sharp", required=True)
        if name == "fullres":
            q.add_argument("--scales", default="0.25,0.5,0.75,1")
        if name == "seams":
            q.add_argument("--overlaps", default="0,32,64")
            q.add_argument("--scale", type=float, default=0.75)
            q.add_argument("--crop", type=int, default=1536)
        if name == "synthetic":
            q.add_argument("--sharp", required=True)
            q.add_argument("--kernel-pair", required=True)
            q.add_argument("--factors", default="3,6")
            q.add_argument("--crop", type=int, default=2048)
        if name == "rotation":
            q.add_argument("--images", required=True)
            q.add_argument("--length", type=float, default=24)
            q.add_argument("--protocol", default="tile", choices=["tile", "paper"])
    a = p.parse_args()
    {"fullres": cmd_fullres, "seams": cmd_seams, "synthetic": cmd_synthetic, "rotation": cmd_rotation}[a.cmd](a)


if __name__ == "__main__":
    main()
