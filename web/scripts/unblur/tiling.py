"""Unblur spike: running a fixed-size ONNX deblurring graph over an image of any size, and the RealBlur metric.

- `paper_windows`: MISC Filter's own test protocol (`window_partitionx` / `window_reversex` in its models/layers.py):
  non-overlapping 256 x 256 windows, plus windows flush with the right and bottom edges for the remainder.
- `tiled`: overlapping tiles blended with linear ramps across each overlap (weights sum to 1 everywhere); tiles are
  `tile` px, stepping `tile - overlap`; the last row/column sits flush with the edge; an image smaller than a tile is
  reflect-padded.
- `realblur_metric`: RealBlur's evaluation (evaluation_RealBlur_ecc.py, the same code MISC Filter's test uses; RSBlur's
  evaluate_RSBlur.py is the same): intensity-matched, ECC-homography-aligned to the sharp image, PSNR and SSIM over the
  valid region. skimage >= 0.19 takes `channel_axis=2` where the original passes `multichannel=True`.
"""
import numpy as np


class Runner:
    """A fixed-size ONNX graph on ONNX Runtime's CPU (1 x 3 x size x size in, same out)."""

    def __init__(self, path, threads=4, size=None):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        self.s = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
        self.inp = self.s.get_inputs()[0].name
        shp = self.s.get_inputs()[0].shape
        self.size = size or (shp[2] if isinstance(shp[2], int) else None)
        self.calls = 0
        self.wild = 0  # tiles whose output leaves [0, 1] badly (over 1 % of values beyond -0.1 or 1.1)
        self.worst = 0.0  # the largest share of such values in one tile

    def reset(self):
        self.calls, self.wild, self.worst = 0, 0, 0.0

    def __call__(self, tile):  # tile: H x W x 3 float32 in [0, 1]
        x = np.ascontiguousarray(tile.transpose(2, 0, 1)[None], dtype=np.float32)
        y = self.s.run(None, {self.inp: x})[0][0].transpose(1, 2, 0)
        self.calls += 1
        out = float(np.mean((y < -0.1) | (y > 1.1) | ~np.isfinite(y)))
        self.worst = max(self.worst, out)
        if out > 0.01:
            self.wild += 1
        return y


def paper_windows(img, run, win=256):
    H, W = img.shape[:2]
    h, w = win * (H // win), win * (W // win)
    out = np.zeros_like(img)
    for y in range(0, h, win):
        for x in range(0, w, win):
            out[y:y + win, x:x + win] = run(img[y:y + win, x:x + win])
    if w != W:
        for y in range(0, h, win):
            r = run(img[y:y + win, W - win:W])
            out[y:y + win, w:] = r[:, win - (W - w):]
    if h != H:
        for x in range(0, w, win):
            r = run(img[H - win:H, x:x + win])
            out[h:, x:x + win] = r[win - (H - h):, :]
    if h != H and w != W:
        r = run(img[H - win:H, W - win:W])
        out[h:, w:] = r[win - (H - h):, win - (W - w):]
    return out


def _starts(n, tile, step):
    if n <= tile:
        return [0]
    s = list(range(0, n - tile, step))
    s.append(n - tile)
    return sorted(set(s))


def _ramp(n, left, right, ov):
    w = np.ones(n, np.float64)
    if ov > 0:
        r = (np.arange(ov) + 0.5) / ov
        if left:
            w[:ov] = r
        if right:
            w[n - ov:] = r[::-1]
    return w


def tiled(img, run, tile, overlap, return_count=False):
    H0, W0 = img.shape[:2]
    pad_h, pad_w = max(0, tile - H0), max(0, tile - W0)
    if pad_h or pad_w:
        img = np.pad(img, ((0, pad_h), (0, pad_w), (0, 0)), mode="reflect")
    H, W = img.shape[:2]
    step = tile - overlap
    ys, xs = _starts(H, tile, step), _starts(W, tile, step)
    acc = np.zeros((H, W, 3), np.float64)
    wsum = np.zeros((H, W, 1), np.float64)
    n = 0
    for iy, y in enumerate(ys):
        for ix, x in enumerate(xs):
            # The ramp's length is the actual overlap with the neighbour (the last tile may overlap more).
            ovy_top = (ys[iy - 1] + tile - y) if iy > 0 else 0
            ovy_bot = (y + tile - ys[iy + 1]) if iy + 1 < len(ys) else 0
            ovx_l = (xs[ix - 1] + tile - x) if ix > 0 else 0
            ovx_r = (x + tile - xs[ix + 1]) if ix + 1 < len(xs) else 0
            wy = np.ones(tile)
            if ovy_top:
                wy[:ovy_top] = _ramp(ovy_top, True, False, ovy_top)
            if ovy_bot:
                wy[tile - ovy_bot:] *= _ramp(ovy_bot, False, True, ovy_bot)
            wx = np.ones(tile)
            if ovx_l:
                wx[:ovx_l] = _ramp(ovx_l, True, False, ovx_l)
            if ovx_r:
                wx[tile - ovx_r:] *= _ramp(ovx_r, False, True, ovx_r)
            wgt = (wy[:, None] * wx[None, :])[..., None]
            if overlap == 0:
                wgt = np.ones((tile, tile, 1))
            r = run(img[y:y + tile, x:x + tile])
            if overlap == 0:
                # no blending: later tiles simply overwrite (a hard seam)
                acc[y:y + tile, x:x + tile] = r
                wsum[y:y + tile, x:x + tile] = 1
            else:
                acc[y:y + tile, x:x + tile] += wgt * r
                wsum[y:y + tile, x:x + tile] += wgt
            n += 1
    out = (acc / np.maximum(wsum, 1e-12)).astype(np.float32)[:H0, :W0]
    return (out, n, ys, xs) if return_count else out


# ------------------------------------------------------------------------------------------------- RealBlur metric

def image_align(deblurred, gt):
    import cv2
    z = deblurred
    x = gt
    zs = (np.sum(x * z) / np.sum(z * z)) * z
    warp_matrix = np.eye(3, 3, dtype=np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 0)
    (cc, warp_matrix) = cv2.findTransformECC(cv2.cvtColor(x, cv2.COLOR_RGB2GRAY), cv2.cvtColor(zs, cv2.COLOR_RGB2GRAY), warp_matrix,
                                             cv2.MOTION_HOMOGRAPHY, criteria, inputMask=None, gaussFiltSize=5)
    shape = x.shape
    zr = cv2.warpPerspective(zs, warp_matrix, (shape[1], shape[0]), flags=cv2.INTER_CUBIC + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
    cr = cv2.warpPerspective(np.ones_like(zs, dtype="float32"), warp_matrix, (shape[1], shape[0]), flags=cv2.INTER_NEAREST + cv2.WARP_INVERSE_MAP,
                             borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return zr * cr, x * cr, cr, warp_matrix


def compute_psnr(image_true, image_test, image_mask, data_range=1.0):
    err = np.sum((image_true - image_test) ** 2, dtype=np.float64) / np.sum(image_mask)
    return float(10 * np.log10((data_range ** 2) / err))


def compute_ssim(tar, prd, cr1):
    from skimage.metrics import structural_similarity
    _, ssim_map = structural_similarity(tar, prd, channel_axis=2, gaussian_weights=True, use_sample_covariance=False, data_range=1.0, full=True)
    ssim_map = ssim_map * cr1
    r = int(3.5 * 1.5 + 0.5)
    pad = r
    ssim = ssim_map[pad:-pad, pad:-pad, :]
    crop = cr1[pad:-pad, pad:-pad, :]
    return float(np.mean(ssim.sum(axis=0).sum(axis=0) / crop.sum(axis=0).sum(axis=0)))


def realblur_metric(out, gt, quantize=True, clip_after=False):
    """out, gt: H x W x 3 float32 in [0, 1]. As the official scripts: the output saved as 8-bit first."""
    if quantize:
        out = np.round(np.clip(out, 0, 1) * 255).astype(np.float32) / 255
    try:
        a, g, cr, _ = image_align(out.astype(np.float32), gt.astype(np.float32))
    except Exception:  # noqa: BLE001 - ECC can fail to converge; fall back to no alignment, recorded
        return {"psnr": compute_psnr(gt, out, np.ones_like(gt)), "ssim": compute_ssim(gt, out, np.ones_like(gt)), "aligned": False}
    if clip_after:
        a, g = np.clip(a, 0, 1), np.clip(g, 0, 1)
    return {"psnr": compute_psnr(g, a, cr), "ssim": compute_ssim(g, a, cr), "aligned": True}
