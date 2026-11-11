# AI Denoise feasibility spike (docs/AI_DENOISE_SPIKE.md): shared code. Research only; not app code.
#
# - Raw loading (rawpy / LibRaw), the RawNIND Bayer model's pre-processing as darktable does it
#   (src/common/ai/restore_raw_bayer.c: force RGGB by cropping, black/white level, optional white balance, 512 packed
#   tiles with 32 packed overlap, mirror padding, linear seam ramps, gain match), in NumPy.
# - A NumPy port of LightBench's Bayer raw stage (web/src/engine/gpu/raw-pipeline.wgsl: prepare + white balance,
#   highlights "clip" and "inpaint opposed", RCD demosaic, camera -> Rec.2020), and of its linear (camera RGB) stage
#   (web/src/engine/gpu/raw-linear.wgsl), so routes A and B can be compared offline through the same steps.
#   Those kernels are translations of darktable's (GPL-3.0-or-later, darktable developers; RCD by Luis Sanz Rodríguez).
#
# SPDX-License-Identifier: GPL-3.0-or-later

from __future__ import annotations

import math

import numpy as np

D65_XYZ = np.array([0.95047, 1.0, 1.08883])
XYZ_TO_REC2020 = np.array([[1.71666343, -0.35567332, -0.25336809], [-0.66667384, 1.61645574, 0.0157683], [0.01764248, -0.04277698, 0.94224328]])
REC2020_TO_XYZ = np.linalg.inv(XYZ_TO_REC2020)
XYZ_TO_SRGB = np.array([[3.24100326, -1.53739899, -0.49861587], [-0.96922426, 1.87592999, 0.04155422], [0.05563942, -0.2040112, 1.05714897]])
REC2020_TO_SRGB = XYZ_TO_SRGB @ REC2020_TO_XYZ
OPPOSED_CLIP_MAGIC = 0.987  # develop-engine.ts


# ------------------------------------------------------------------------------------------------ raw loading

def load_raw(path: str) -> dict:
    """The visible mosaic and what the pipelines need. `cfa` is the colour (0 R, 1 G, 2 B) at (0,0),(0,1),(1,0),(1,1)."""
    import rawpy

    with rawpy.imread(path) as r:
        mosaic = r.raw_image_visible.astype(np.uint16).copy()
        desc = r.color_desc.decode()
        pat = np.array(r.raw_pattern)
        if pat.shape != (2, 2):
            raise ValueError(f"not a Bayer sensor (pattern {pat.shape})")
        cfa = ["RGB".index(desc[int(i)]) for i in pat.flatten()]
        blc = list(r.black_level_per_channel)
        black = [float(blc[int(i)]) for i in pat.flatten()]
        white = float(r.white_level)
        cw = np.array(r.camera_whitebalance[:3], dtype=np.float64)
        wb_shot = cw / cw[1] if cw[1] > 0 else np.ones(3)
        xyz_to_cam = np.array(r.rgb_xyz_matrix[:3], dtype=np.float64)
        dw = np.array(r.daylight_whitebalance[:3], dtype=np.float64)
        cwl = None
        try:
            cwl = list(r.camera_white_level_per_channel) if r.camera_white_level_per_channel is not None else None
        except Exception:
            pass
    resp = xyz_to_cam @ D65_XYZ
    wb_d65 = resp[1] / resp  # darktable's _bayer_wb_daylight
    return {
        "mosaic": mosaic, "cfa": cfa, "black": black, "white": white, "wb_shot": wb_shot, "wb_d65": wb_d65,
        "wb_libraw_daylight": dw / dw[1] if dw[1] > 0 else None, "xyz_to_cam": xyz_to_cam, "white_per_channel": cwl,
    }


def normalise(raw: dict) -> np.ndarray:
    """(value - black) / (white - black) per CFA position, float32, not clipped (the training code doesn't clip)."""
    m = raw["mosaic"].astype(np.float32)
    out = np.empty_like(m)
    for k in range(4):
        y, x = k >> 1, k & 1
        b = raw["black"][k]
        out[y::2, x::2] = (m[y::2, x::2] - b) / (raw["white"] - b)
    return out


def rggb_origin(cfa: list) -> tuple:
    k = cfa.index(0)
    return k >> 1, k & 1


def colour_planes(h: int, w: int, cfa: list) -> np.ndarray:
    """Colour index of each photosite."""
    c = np.empty((h, w), dtype=np.uint8)
    for k in range(4):
        c[(k >> 1)::2, (k & 1)::2] = cfa[k]
    return c


def cam_to_rec2020_wb(raw: dict) -> np.ndarray:
    """White-balanced camera RGB -> linear Rec.2020, the dcraw way (rows of XYZ->camera·Rec.2020->XYZ normalised)."""
    m = raw["xyz_to_cam"] @ REC2020_TO_XYZ
    m = m / m.sum(axis=1, keepdims=True)
    return np.linalg.inv(m)


def cam_to_rec2020_paper(raw: dict) -> np.ndarray:
    """Camera RGB without white balance -> linear Rec.2020, as the RawNIND code does (inverse of XYZ->camera)."""
    return XYZ_TO_REC2020 @ np.linalg.inv(raw["xyz_to_cam"])


# ------------------------------------------------------------------------------------------------ the model

def make_session(path: str, threads: int = 0):
    import onnxruntime as ort

    so = ort.SessionOptions()
    if threads:
        so.intra_op_num_threads = threads
    return ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])


def run_model(sess, x: np.ndarray) -> np.ndarray:
    name = sess.get_inputs()[0].name
    return sess.run(None, {name: x.astype(np.float32)})[0]


def pack(mono: np.ndarray) -> np.ndarray:
    """RGGB mosaic (h, w) -> packed [R, G1, G2, B] (4, h/2, w/2)."""
    return np.stack([mono[0::2, 0::2], mono[0::2, 1::2], mono[1::2, 0::2], mono[1::2, 1::2]])


def tiled(sess, norm: np.ndarray, cfa: list, wb_norm=(1.0, 1.0, 1.0), T: int = 512, O: int = 32, log=None, run=None) -> dict:
    """
    darktable's tiling. `norm` is the normalised mosaic (any Bayer order); the working region starts at the first red
    photosite. Returns, for the working region (2Hh x 2Wh sensor pixels), the model's RGB stitched three ways, each
    already divided by wb_norm again (so the values are camera RGB on the input's scale):
      raw      : no gain (the model's own scale)
      dt       : darktable's per-tile gain, mean of the 4 packed input planes / mean of the 3 output planes
      site     : per-tile gain that compares like with like: sum of the input mosaic / sum of the output re-mosaiced
    and per-tile statistics for the global variants.
    """
    y0, x0 = rggb_origin(cfa)
    H, W = norm.shape
    Hh, Wh = (H - y0) // 2, (W - x0) // 2
    work = norm[y0:y0 + 2 * Hh, x0:x0 + 2 * Wh]
    wbv = np.array([wb_norm[0], wb_norm[1], wb_norm[1], wb_norm[2]], dtype=np.float32).reshape(4, 1, 1)
    step = T - 2 * O
    rows, cols = math.ceil(Hh / step), math.ceil(Wh / step)
    sO = 2 * O
    pad_b = 2 * (rows * step + O) - 2 * Hh
    pad_r = 2 * (cols * step + O) - 2 * Wh
    padded = np.pad(work, ((sO, pad_b), (sO, pad_r)), mode="reflect")
    names = ("raw", "dt", "site")
    acc = {n: np.zeros((2 * Hh, 2 * Wh, 3), dtype=np.float32) for n in names}
    stats = []
    run = run or (lambda x: run_model(sess, x))
    cidx = np.zeros((2 * T, 2 * T), dtype=np.int64)  # colour of each site of a tile's output (RGGB)
    cidx[0::2, 1::2] = 1
    cidx[1::2, 0::2] = 1
    cidx[1::2, 1::2] = 2
    for ty in range(rows):
        for tx in range(cols):
            py, px = ty * step, tx * step
            # tile input starts O packed pixels before the core
            sy, sx = 2 * py, 2 * px  # in `padded` (already shifted by sO)
            tile_m = padded[sy:sy + 2 * T, sx:sx + 2 * T]
            tin = pack(tile_m) * wbv
            out = run(tin[None])[0]  # (3, 2T, 2T)
            in_mean = float(tin.mean(dtype=np.float64))
            out_mean = float(out.mean(dtype=np.float64))
            g_dt = in_mean / out_mean if abs(out_mean) > 1e-6 * abs(in_mean) else 1.0
            out_m = np.take_along_axis(out, cidx[None], axis=0)[0]  # re-mosaiced output
            tin_m = tile_m * np.take(np.array(wb_norm, dtype=np.float32), cidx)
            s_in, s_out = float(tin_m.sum(dtype=np.float64)), float(out_m.sum(dtype=np.float64))
            g_site = s_in / s_out if abs(s_out) > 1e-12 else 1.0
            g_ls = float((tin_m.astype(np.float64) * out_m).sum() / max(1e-30, (out_m.astype(np.float64) ** 2).sum()))
            stats.append({"ty": ty, "tx": tx, "in_mean": in_mean, "out_mean": out_mean, "g_dt": g_dt, "g_site": g_site, "g_ls": g_ls,
                          "s_in": s_in, "s_out": s_out, "finite": bool(np.isfinite(out).all()), "out_absmax": float(np.abs(out).max())})
            if log:
                log(f"tile {ty},{tx}: in_mean {in_mean:.5f} out_mean {out_mean:.5g} g_dt {g_dt:.5g} g_site {g_site:.5g}")
            # contribution extent (sensor coords in the working region) and ramps
            cy0, cy1 = 2 * py, min(2 * (py + step), 2 * Hh)
            cx0, cx1 = 2 * px, min(2 * (px + step), 2 * Wh)
            top, bot, left, right = ty > 0, ty < rows - 1, tx > 0, tx < cols - 1
            ey0, ey1 = (cy0 - sO if top else cy0), min(2 * Hh, cy1 + sO if bot else cy1)
            ex0, ex1 = (cx0 - sO if left else cx0), min(2 * Wh, cx1 + sO if right else cx1)

            def ramp(e0, e1, c0, c1, lo, hi):
                s = np.arange(e0, e1)
                a = np.ones(e1 - e0, dtype=np.float32)
                if lo:
                    m = s < c0 + sO
                    a[m] = (s[m] - (c0 - sO) + 0.5) / (2 * sO)
                if hi:
                    m = s >= c1 - sO
                    a[m] = 1.0 - (s[m] - (c1 - sO) + 0.5) / (2 * sO)
                return a

            ay = ramp(ey0, ey1, cy0, cy1, top, bot)
            ax = ramp(ex0, ex1, cx0, cx1, left, right)
            wgt = (ay[:, None] * ax[None, :])[:, :, None]
            # tile output coordinates: sensor (cy0) is at output row 2*O
            oy, ox = sO + (ey0 - cy0), sO + (ex0 - cx0)
            part = out[:, oy:oy + (ey1 - ey0), ox:ox + (ex1 - ex0)].transpose(1, 2, 0)
            for n, g in (("raw", 1.0), ("dt", g_dt), ("site", g_site)):
                acc[n][ey0:ey1, ex0:ex1] += wgt * (part * g)
    inv = (1.0 / np.array(wb_norm, dtype=np.float32)).reshape(1, 1, 3)
    for n in names:
        acc[n] *= inv
    return {"rgb": acc, "stats": stats, "origin": (y0, x0), "Hh": Hh, "Wh": Wh, "rows": rows, "cols": cols, "work": work}


def global_gain(rgb_raw: np.ndarray, work: np.ndarray, mode: str = "site") -> float:
    """One gain for the whole photo. 'dt': mean of the mosaic / mean of all three output planes (darktable's formula,
    whole image). 'site': sum of the mosaic / sum of the re-mosaiced output."""
    if mode == "dt":
        return float(work.mean(dtype=np.float64) / rgb_raw.mean(dtype=np.float64))
    return float(work.sum(dtype=np.float64) / remosaic(rgb_raw).sum(dtype=np.float64))


def remosaic(rgb: np.ndarray) -> np.ndarray:
    """Keep, at each photosite of an RGGB mosaic, the channel of its colour filter."""
    h, w, _ = rgb.shape
    m = np.empty((h, w), dtype=rgb.dtype)
    m[0::2, 0::2] = rgb[0::2, 0::2, 0]
    m[0::2, 1::2] = rgb[0::2, 1::2, 1]
    m[1::2, 0::2] = rgb[1::2, 0::2, 1]
    m[1::2, 1::2] = rgb[1::2, 1::2, 2]
    return m


# ------------------------------------------------------------------------------------------------ LightBench raw stage

RGGB = [0, 1, 1, 2]


def lb_prepare(norm: np.ndarray, cfa: list, wb) -> np.ndarray:
    """prepare: max(0, normalised) * white balance."""
    out = np.maximum(norm, 0.0).astype(np.float32)
    for k in range(4):
        out[(k >> 1)::2, (k & 1)::2] *= np.float32(wb[cfa[k]])
    return out


def _ref_avg(cfa_img: np.ndarray, cmap: np.ndarray) -> np.ndarray:
    """_calc_refavg at every photosite (3x3 neighbourhood, clipped at the image edge as the shader's loop is)."""
    h, w = cfa_img.shape
    val = np.maximum(cfa_img, 0.0).astype(np.float64)
    means = []
    # The shader's loops run dy in [max(0,row-1), min(h-1,row+2)) and dx likewise: the last row/column is never read.
    valid = np.zeros((h, w), dtype=bool)
    valid[: h - 1, : w - 1] = True
    for c in range(3):
        m = ((cmap == c) & valid).astype(np.float64)
        s = _box3(val * m)
        n = _box3(m)
        with np.errstate(invalid="ignore", divide="ignore"):
            means.append(np.where(n > 0, np.cbrt(s / np.maximum(n, 1)), 0.0))
    croot = [0.5 * (means[1] + means[2]), 0.5 * (means[0] + means[2]), 0.5 * (means[0] + means[1])]
    r = np.choose(cmap, croot)
    return (r ** 3).astype(np.float32)


def _box3(a: np.ndarray) -> np.ndarray:
    p = np.pad(a, 1)
    h, w = a.shape
    out = np.zeros_like(a)
    for dy in range(3):
        for dx in range(3):
            out += p[dy:dy + h, dx:dx + w]
    return out


def lb_highlights(cfa_img: np.ndarray, cfa: list, wb, mode: str = "opposed", highlight_clip: float = 1.0, info: dict | None = None) -> np.ndarray:
    clip = OPPOSED_CLIP_MAGIC * highlight_clip
    clips = np.array([clip * wb[0], clip * wb[1], clip * wb[2]], dtype=np.float32)
    if mode == "clip":
        return np.minimum(cfa_img, clips.min())
    h, w = cfa_img.shape
    cmap = colour_planes(h, w, cfa)
    cl = clips[cmap]
    clipped = cfa_img >= cl
    mh, mw = math.ceil(h / 3), math.ceil(w / 3)
    mask = np.zeros((3, mh, mw), dtype=bool)
    for c in range(3):
        m = clipped & (cmap == c)
        mp = np.zeros((mh * 3, mw * 3), dtype=bool)
        mp[:h, :w] = m
        mask[c] = mp.reshape(mh, 3, mw, 3).any(axis=(1, 3))
    dil = mask.copy()
    if mh > 6 and mw > 6:
        for c in range(3):
            src = mask[c]
            d = np.zeros_like(src)
            for dy in range(-3, 4):
                for dx in range(-3, 4):
                    if abs(dy) == 3 and abs(dx) == 3:
                        continue
                    d[3:mh - 3, 3:mw - 3] |= src[3 + dy:mh - 3 + dy, 3 + dx:mw - 3 + dx]
            d[:3], d[-3:], d[:, :3], d[:, -3:] = src[:3], src[-3:], src[:, :3], src[:, -3:]
            dil[c] = d
    ref = _ref_avg(cfa_img, cmap)
    full = np.zeros((h, w), dtype=bool)
    chroma = np.zeros(3, dtype=np.float32)
    counts = []
    for c in range(3):
        up = np.repeat(np.repeat(dil[c], 3, axis=0), 3, axis=1)[:h, :w]
        sel = up & (cmap == c) & (cfa_img > 0.2 * cl) & (cfa_img < cl)
        n = int(sel.sum())
        counts.append(n)
        if n > 100:
            chroma[c] = float((cfa_img[sel].astype(np.float64) - ref[sel]).sum() / n)
        full |= up
    out = cfa_img.copy()
    out[clipped] = np.maximum(cfa_img[clipped], ref[clipped] + chroma[cmap[clipped]])
    if info is not None:
        info.update({"clipped_sites": int(clipped.sum()), "chroma": chroma.tolist(), "chroma_counts": counts})
    return out


def lb_rcd(hl: np.ndarray, cfa: list, wb) -> np.ndarray:
    """raw-pipeline.wgsl's RCD, index for index. `hl` is the white-balanced mosaic after highlights. Returns camera RGB
    (h, w, 3), white balanced. The 9-pixel border is bilinear, as in the shader."""
    h, w = hl.shape
    scale = np.float32(1.0 / max(wb))
    EPS, EPSSQ = np.float32(1e-5), np.float32(1e-10)
    cf = (scale * np.maximum(hl, 0.0)).astype(np.float32).ravel()
    cmap = colour_planes(h, w, cfa)
    cm = cmap.ravel()
    rgb = [np.where(cm == c, cf, np.float32(0)).astype(np.float32) for c in range(3)]
    hw = (w + 1) // 2

    def fc(row, col):
        return np.array(cfa)[(row & 1) * 2 + (col & 1)]

    def sites(row0, col0_fn, row_max, col_max):
        rows = np.arange(row0, row_max + 1)
        out_r, out_c = [], []
        for parity in (0, 1):
            rr = rows[(rows & 1) == parity]
            if rr.size == 0:
                continue
            c0 = col0_fn(parity)
            cc = np.arange(c0, col_max + 1, 2)
            if cc.size == 0:
                continue
            R, C = np.meshgrid(rr, cc, indexing="ij")
            out_r.append(R.ravel())
            out_c.append(C.ravel())
        return np.concatenate(out_r), np.concatenate(out_c)

    def half(row, col):
        return row * hw + col // 2

    def sq(x):
        return x * x

    # step 1 (all pixels 4..h-5, 4..w-5)
    img = cf.reshape(h, w)

    def vdiff_map(axis):
        def sh(k):
            return np.roll(img, -k, axis=axis)
        return sq(sh(-3) - sh(-1) - sh(1) + sh(3) - 3.0 * (sh(-2) + sh(2)) + 6.0 * img)

    V = vdiff_map(0)
    Hm = vdiff_map(1)
    vstat = np.maximum(EPSSQ, np.roll(V, 1, 0) + V + np.roll(V, -1, 0))
    hstat = np.maximum(EPSSQ, np.roll(Hm, 1, 1) + Hm + np.roll(Hm, -1, 1))
    vh = (vstat / (vstat + hstat)).astype(np.float32).ravel()
    del V, Hm, vstat, hstat

    pq = np.zeros(h * hw + 2, dtype=np.float32)
    # step 2: low pass at red/blue sites
    r, c = sites(2, lambda p: 2 + (int(fc(p, 0)) & 1), h - 2, w - 2)
    i = r * w + c
    pq[half(r, c)] = cf[i] + 0.5 * (cf[i - w] + cf[i + w] + cf[i - 1] + cf[i + 1]) + 0.25 * (cf[i - w - 1] + cf[i - w + 1] + cf[i + w - 1] + cf[i + w + 1])

    # step 3: green at red/blue sites
    r, c = sites(4, lambda p: 4 + (int(fc(p, 0)) & 1), h - 5, w - 5)
    i = r * w + c
    li = half(r, c)
    hw2 = 2 * hw
    vhC = vh[i]
    vhN = 0.25 * (vh[i - w - 1] + vh[i - w + 1] + vh[i + w - 1] + vh[i + w + 1])
    disc = np.where(np.abs(0.5 - vhC) < np.abs(0.5 - vhN), vhN, vhC)
    c0 = cf[i]
    nG = EPS + np.abs(cf[i - w] - cf[i + w]) + np.abs(c0 - cf[i - 2 * w]) + np.abs(cf[i - w] - cf[i - 3 * w]) + np.abs(cf[i - 2 * w] - cf[i - 4 * w])
    sG = EPS + np.abs(cf[i + w] - cf[i - w]) + np.abs(c0 - cf[i + 2 * w]) + np.abs(cf[i + w] - cf[i + 3 * w]) + np.abs(cf[i + 2 * w] - cf[i + 4 * w])
    wG = EPS + np.abs(cf[i - 1] - cf[i + 1]) + np.abs(c0 - cf[i - 2]) + np.abs(cf[i - 1] - cf[i - 3]) + np.abs(cf[i - 2] - cf[i - 4])
    eG = EPS + np.abs(cf[i + 1] - cf[i - 1]) + np.abs(c0 - cf[i + 2]) + np.abs(cf[i + 1] - cf[i + 3]) + np.abs(cf[i + 2] - cf[i + 4])
    lp = pq[li]
    nE = cf[i - w] * (lp + lp) / (EPS + lp + pq[li - hw2])
    sE = cf[i + w] * (lp + lp) / (EPS + lp + pq[li + hw2])
    wE = cf[i - 1] * (lp + lp) / (EPS + lp + pq[li - 1])
    eE = cf[i + 1] * (lp + lp) / (EPS + lp + pq[li + 1])
    vE = (sG * nE + nG * sE) / (nG + sG)
    hE = (wG * eE + eG * wE) / (eG + wG)
    t = np.clip(disc, 0.0, 1.0)
    rgb[1][i] = vE * (1 - t) + hE * t

    # step 4.0: P/Q diagonal high pass (the shader's sites: every row from 3, odd columns from 3)
    pd = np.zeros(h * hw + 2, dtype=np.float32)
    qd = np.zeros(h * hw + 2, dtype=np.float32)
    r, c = sites(3, lambda p: 3, h - 4, w - 4)
    i = r * w + c
    i2 = half(r, c)
    pd[i2] = sq((cf[i - 3 * w - 3] - cf[i - w - 1] - cf[i + w + 1] + cf[i + 3 * w + 3]) - 3.0 * (cf[i - 2 * w - 2] + cf[i + 2 * w + 2]) + 6.0 * cf[i])
    qd[i2] = sq((cf[i - 3 * w + 3] - cf[i - w + 1] - cf[i + w - 1] + cf[i + 3 * w - 3]) - 3.0 * (cf[i - 2 * w + 2] + cf[i + 2 * w - 2]) + 6.0 * cf[i])

    # step 4.1: P/Q discrimination (overwrites pq)
    r, c = sites(2, lambda p: 2 + (int(fc(p, 0)) & 1), h - 3, w - 3)
    i2 = half(r, c)
    i3 = half(r - 1, c - 1)
    i4 = half(r + 1, c - 1)
    ps = np.maximum(EPSSQ, pd[i3] + pd[i2] + pd[i4 + 1])
    qs = np.maximum(EPSSQ, qd[i3 + 1] + qd[i2] + qd[i4])
    pq[i2] = ps / (ps + qs)
    del pd, qd

    # step 4.2: red/blue at blue/red sites
    for parity in (0, 1):
        col0 = 4 + (int(fc(parity, 0)) & 1)
        rr = np.arange(4, h - 4 + 1)
        rr = rr[(rr & 1) == parity]
        cc = np.arange(col0, w - 4 + 1, 2)
        if rr.size == 0 or cc.size == 0:
            continue
        R, C = np.meshgrid(rr, cc, indexing="ij")
        r, c = R.ravel(), C.ravel()
        ch = 2 - int(fc(parity, col0))
        if ch == 1:
            continue
        A = rgb[ch]
        G = rgb[1]
        i = r * w + c
        p1 = half(r, c)
        p2 = half(r - 1, c - 1)
        p3 = half(r + 1, c - 1)
        pqC = pq[p1]
        pqN = 0.25 * (pq[p2] + pq[p2 + 1] + pq[p3] + pq[p3 + 1])
        disc = np.where(np.abs(0.5 - pqC) < np.abs(0.5 - pqN), pqN, pqC)
        nw = EPS + np.abs(A[i - w - 1] - A[i + w + 1]) + np.abs(A[i - w - 1] - A[i - 3 * w - 3]) + np.abs(G[i] - G[i - 2 * w - 2])
        ne = EPS + np.abs(A[i - w + 1] - A[i + w - 1]) + np.abs(A[i - w + 1] - A[i - 3 * w + 3]) + np.abs(G[i] - G[i - 2 * w + 2])
        sw = EPS + np.abs(A[i - w + 1] - A[i + w - 1]) + np.abs(A[i + w - 1] - A[i + 3 * w - 3]) + np.abs(G[i] - G[i + 2 * w - 2])
        se = EPS + np.abs(A[i - w - 1] - A[i + w + 1]) + np.abs(A[i + w + 1] - A[i + 3 * w + 3]) + np.abs(G[i] - G[i + 2 * w + 2])
        nwE = A[i - w - 1] - G[i - w - 1]
        neE = A[i - w + 1] - G[i - w + 1]
        swE = A[i + w - 1] - G[i + w - 1]
        seE = A[i + w + 1] - G[i + w + 1]
        pE = (nw * seE + se * nwE) / (nw + se)
        qE = (ne * swE + sw * neE) / (ne + sw)
        t = np.clip(disc, 0.0, 1.0)
        A[i] = G[i] + pE * (1 - t) + qE * t

    # step 4.3: red and blue at green sites
    r, c = sites(4, lambda p: 4 + (int(fc(p, 1)) & 1), h - 4, w - 4)
    i = r * w + c
    G = rgb[1]
    vhC = vh[i]
    vhN = 0.25 * (vh[i - w - 1] + vh[i - w + 1] + vh[i + w - 1] + vh[i + w + 1])
    disc = np.clip(np.where(np.abs(0.5 - vhC) < np.abs(0.5 - vhN), vhN, vhC), 0.0, 1.0)
    g0 = G[i]
    n1 = EPS + np.abs(g0 - G[i - 2 * w])
    s1 = EPS + np.abs(g0 - G[i + 2 * w])
    w1 = EPS + np.abs(g0 - G[i - 2])
    e1 = EPS + np.abs(g0 - G[i + 2])
    res = {}
    for ch in (0, 2):
        A = rgb[ch]
        sn = np.abs(A[i - w] - A[i + w])
        ew = np.abs(A[i - 1] - A[i + 1])
        nG = n1 + sn + np.abs(A[i - w] - A[i - 3 * w])
        sG = s1 + sn + np.abs(A[i + w] - A[i + 3 * w])
        wG = w1 + ew + np.abs(A[i - 1] - A[i - 3])
        eG = e1 + ew + np.abs(A[i + 1] - A[i + 3])
        nE = A[i - w] - G[i - w]
        sE = A[i + w] - G[i + w]
        wE = A[i - 1] - G[i - 1]
        eE = A[i + 1] - G[i + 1]
        vE = (nG * sE + sG * nE) / (nG + sG)
        hE = (eG * wE + wG * eE) / (eG + wG)
        res[ch] = g0 + vE * (1 - disc) + hE * disc
    for ch in (0, 2):
        rgb[ch][i] = res[ch]

    out = np.stack([np.maximum(0.0, a.reshape(h, w) / scale) for a in rgb], axis=-1).astype(np.float32)
    bil = lb_bilinear(hl, cfa)
    b = 9
    out[:b], out[-b:], out[:, :b], out[:, -b:] = bil[:b], bil[-b:], bil[:, :b], bil[:, -b:]
    return out


def lb_bilinear(hl: np.ndarray, cfa: list) -> np.ndarray:
    h, w = hl.shape
    cmap = colour_planes(h, w, cfa)
    v = np.maximum(hl, 0.0).astype(np.float32)
    pv = np.pad(v, 1, mode="reflect")
    pc = np.pad(cmap, 1, mode="reflect")
    out = np.zeros((h, w, 3), dtype=np.float32)
    for c in range(3):
        s = np.zeros((h, w), dtype=np.float32)
        n = np.zeros((h, w), dtype=np.float32)
        for dy in range(3):
            for dx in range(3):
                m = pc[dy:dy + h, dx:dx + w] == c
                if dy == 1 and dx == 1:
                    pass
                else:
                    m = m & (cmap != c)  # the centre's own colour comes from the centre only
                s += np.where(m, pv[dy:dy + h, dx:dx + w], 0)
                n += m
        out[:, :, c] = s / np.maximum(n, 1)
    return out


def lb_bayer_stage(norm: np.ndarray, cfa: list, wb, cam_to_work: np.ndarray, highlights: str = "opposed", info: dict | None = None) -> np.ndarray:
    """Normalised mosaic -> scene-linear Rec.2020 (h, w, 3), as LightBench's Bayer raw stage does."""
    cf = lb_prepare(norm, cfa, wb)
    hl = lb_highlights(cf, cfa, wb, highlights, info=info)
    cam = lb_rcd(hl, cfa, wb)
    return (cam.reshape(-1, 3) @ cam_to_work.T.astype(np.float32)).reshape(cam.shape)


def lb_linear_stage(cam_rgb: np.ndarray, wb, cam_to_work: np.ndarray, highlights: str = "opposed", highlight_clip: float = 1.0, info: dict | None = None) -> np.ndarray:
    """Camera RGB on the normalised scale (h, w, 3) -> scene-linear Rec.2020, as LightBench's linear (camera RGB) stage."""
    wbv = np.array(wb, dtype=np.float32)
    px = np.maximum(cam_rgb, 0.0) * wbv
    clip = OPPOSED_CLIP_MAGIC * highlight_clip
    clips = clip * wbv
    if highlights == "clip":
        out = np.minimum(px, clips.min())
    else:
        h, w, _ = px.shape
        mh, mw = math.ceil(h / 3), math.ceil(w / 3)
        r = np.cbrt(np.maximum(px, 0.0))
        opp = np.stack([0.5 * (r[..., 1] + r[..., 2]), 0.5 * (r[..., 0] + r[..., 2]), 0.5 * (r[..., 0] + r[..., 1])], axis=-1) ** 3
        clipped = px >= clips
        chroma = np.zeros(3, dtype=np.float32)
        counts = []
        for c in range(3):
            mp = np.zeros((mh * 3, mw * 3), dtype=bool)
            mp[:h, :w] = clipped[..., c]
            m = mp.reshape(mh, 3, mw, 3).any(axis=(1, 3))
            d = m.copy()
            if mh > 6 and mw > 6:
                dd = np.zeros_like(m)
                for dy in range(-3, 4):
                    for dx in range(-3, 4):
                        if abs(dy) == 3 and abs(dx) == 3:
                            continue
                        dd[3:mh - 3, 3:mw - 3] |= m[3 + dy:mh - 3 + dy, 3 + dx:mw - 3 + dx]
                dd[:3], dd[-3:], dd[:, :3], dd[:, -3:] = m[:3], m[-3:], m[:, :3], m[:, -3:]
                d = dd
            up = np.repeat(np.repeat(d, 3, axis=0), 3, axis=1)[:h, :w]
            inner = np.zeros((h, w), dtype=bool)
            inner[3:h - 3, 3:w - 3] = True
            v = px[..., c]
            sel = up & inner & (v > 0.2 * clips[c]) & (v < clips[c])
            n = int(sel.sum())
            counts.append(n)
            if n > 30:
                chroma[c] = float((v[sel].astype(np.float64) - opp[..., c][sel]).sum() / n)
        out = np.where(clipped, np.maximum(px, opp + chroma), px)
        if info is not None:
            info.update({"clipped_values": int(clipped.sum()), "chroma": chroma.tolist(), "chroma_counts": counts})
    out = np.maximum(out, 0.0)
    return (out.reshape(-1, 3) @ cam_to_work.T.astype(np.float32)).reshape(out.shape)


# ------------------------------------------------------------------------------------------------ display + metrics

def srgb_gamma(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def to_display(rec2020: np.ndarray, exposure: float = 1.0) -> np.ndarray:
    """Scene-linear Rec.2020 -> 8-bit sRGB (plain matrix + sRGB curve; no tone mapping)."""
    lin = (rec2020.reshape(-1, 3) * exposure) @ REC2020_TO_SRGB.T.astype(np.float32)
    return (srgb_gamma(lin).reshape(rec2020.shape) * 255.0 + 0.5).astype(np.uint8)


def auto_exposure(rec2020: np.ndarray, target: float = 0.18) -> float:
    lum = rec2020[..., 1]
    m = float(np.mean(np.clip(lum, 0, None)))
    return target / m if m > 1e-9 else 1.0


def ms_ssim(a: np.ndarray, b: np.ndarray) -> float:
    """MS-SSIM of two float images in [0, 1], (h, w, 3)."""
    import torch
    from pytorch_msssim import ms_ssim as f

    ta = torch.from_numpy(np.ascontiguousarray(a.transpose(2, 0, 1))[None]).float()
    tb = torch.from_numpy(np.ascontiguousarray(b.transpose(2, 0, 1))[None]).float()
    return float(f(ta, tb, data_range=1.0, size_average=True))


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))
    return 99.0 if mse <= 0 else 10 * math.log10(1.0 / mse)


def save_png(path: str, img8: np.ndarray):
    from PIL import Image

    Image.fromarray(img8).save(path)


def save_jpg(path: str, img8: np.ndarray, q: int = 92):
    from PIL import Image

    Image.fromarray(img8).save(path, quality=q)
