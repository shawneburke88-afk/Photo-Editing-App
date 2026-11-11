"""AI Denoise feasibility spike (docs/AI_DENOISE_SPIKE.md): quality measurements on real raws. Research only.

  pairs    RawNIND noisy/clean pairs: white balance none / daylight / as shot in front of the model; routes A
           (re-mosaic -> LightBench's highlights + RCD) and B (the model's RGB -> LightBench's linear stage) against the
           clean frame developed the same way: MS-SSIM, PSNR, colour, chroma high-frequency energy; crops
  tiling   one raw: darktable's tiling, the per-tile gains, one global gain, seams, against an untiled run
  single   raws without a clean frame (other cameras): noise before/after, hot pixels, clipped highlights, crops;
           --synth-iso adds simulated high-ISO noise to a low-ISO raw and scores against the original (synthetic)

Everything is developed with dn_lib's NumPy port of LightBench's raw stage. Crops go to --out as JPEG panels.
"""
import argparse
import json
import math
import os
import sys
import time
import zlib

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dn_lib as L  # noqa: E402

LOG = []
B64_LEFT = int(os.environ.get("DN_B64", "0"))


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)


def exif(path):
    try:
        import exifread

        with open(path, "rb") as f:
            t = exifread.process_file(f, details=False)
        g = lambda k: str(t.get(k, "?"))  # noqa: E731
        return {"model": g("Image Model"), "iso": g("EXIF ISOSpeedRatings"), "exposure": g("EXIF ExposureTime"), "f": g("EXIF FNumber")}
    except Exception as e:  # noqa: BLE001
        return {"error": repr(e)}


def align(gt, noisy, max_shift=8):
    """Integer shift (even, so the CFA phase is kept) of `noisy` against `gt`, by the smallest mean absolute difference of
    gain-matched 8x-downsampled green. Returns both cropped to the common area and the shift."""
    def small(m):
        g = 0.5 * (m[0::2, 1::2] + m[1::2, 0::2])
        h, w = (g.shape[0] // 4) * 4, (g.shape[1] // 4) * 4
        return g[:h, :w].reshape(h // 4, 4, w // 4, 4).mean(axis=(1, 3))

    # coarse search on the downsampled green is too coarse for 2-pixel steps; use full-resolution green on a centre window
    H, W = gt.shape
    cy, cx = (H // 4) * 2, (W // 4) * 2
    win = 1024
    a = gt[cy:cy + win, cx:cx + win]
    best = (1e30, 0, 0)
    ga = 0.5 * (a[0::2, 1::2] + a[1::2, 0::2])
    for dy in range(-max_shift, max_shift + 1, 2):
        for dx in range(-max_shift, max_shift + 1, 2):
            b = noisy[cy + dy:cy + dy + win, cx + dx:cx + dx + win]
            gb = 0.5 * (b[0::2, 1::2] + b[1::2, 0::2])
            # compare 4x4 means to be robust to noise
            k = 4
            h, w = (ga.shape[0] // k) * k, (ga.shape[1] // k) * k
            A = ga[:h, :w].reshape(h // k, k, w // k, k).mean(axis=(1, 3))
            B = gb[:h, :w].reshape(h // k, k, w // k, k).mean(axis=(1, 3))
            g = A.mean() / max(1e-9, B.mean())
            e = float(np.abs(A - g * B).mean())
            if e < best[0]:
                best = (e, dy, dx)
    _, dy, dx = best
    y0, x0 = max(0, -dy), max(0, -dx)
    y1, x1 = min(H, H - dy), min(W, W - dx)
    y0, x0 = y0 + (y0 & 1), x0 + (x0 & 1)
    h, w = ((y1 - y0) // 2) * 2, ((x1 - x0) // 2) * 2
    return gt[y0:y0 + h, x0:x0 + w], noisy[y0 + dy:y0 + dy + h, x0 + dx:x0 + dx + w], (dy, dx)


def pick_crops(gt_norm, n=3, size=1024):
    """Crop origins (even) spread over the frame: the centre plus the most detailed of a 4x3 grid."""
    H, W = gt_norm.shape
    out = [(((H - size) // 4) * 2, ((W - size) // 4) * 2)]
    cands = []
    for iy in range(3):
        for ix in range(4):
            y = int((H - size) * (0.1 + 0.4 * iy)) // 2 * 2
            x = int((W - size) * (0.08 + 0.28 * ix)) // 2 * 2
            g = gt_norm[y:y + size:2, x + 1:x + size:2]
            d = float(np.abs(np.diff(g, axis=1)).mean() / max(1e-6, g.mean()))
            cands.append((d, y, x))
    cands.sort(reverse=True)
    for d, y, x in cands:
        if all(abs(y - yy) + abs(x - xx) > size // 2 for yy, xx in out):
            out.append((y, x))
        if len(out) >= n:
            break
    return out


def develop_bayer(norm, cfa, wb, M, y, x, size, margin=16, highlights="opposed"):
    H, W = norm.shape
    y0, x0 = max(0, y - margin), max(0, x - margin)
    y1, x1 = min(H, y + size + margin), min(W, x + size + margin)
    # keep the CFA phase: y0/x0 even offsets relative to the full mosaic
    y0 -= y0 & 1
    x0 -= x0 & 1
    out = L.lb_bayer_stage(norm[y0:y1, x0:x1], cfa, wb, M, highlights)
    return out[y - y0:y - y0 + size, x - x0:x - x0 + size]


def chroma_hf(disp):
    """RMS of the high-pass (minus 5x5 box) of the two opponent chroma channels of a display image in [0, 1]."""
    r, g, b = disp[..., 0], disp[..., 1], disp[..., 2]
    c1, c2 = r - g, b - g

    def hp(a):
        p = np.pad(a, 2, mode="reflect")
        s = np.zeros_like(a)
        for dy in range(5):
            for dx in range(5):
                s += p[dy:dy + a.shape[0], dx:dx + a.shape[1]]
        return a - s / 25.0

    return float(math.sqrt((hp(c1) ** 2).mean() + (hp(c2) ** 2).mean()))


def luma_hf(disp):
    y = disp @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    p = np.pad(y, 2, mode="reflect")
    s = np.zeros_like(y)
    for dy in range(5):
        for dx in range(5):
            s += p[dy:dy + y.shape[0], dx:dx + y.shape[1]]
    return float(math.sqrt(((y - s / 25.0) ** 2).mean()))


def score(rec, gt_rec, exposure):
    """Gain-match (mean), display-encode, MS-SSIM / PSNR / colour vs the developed clean frame."""
    g = float(gt_rec.mean() / max(1e-12, rec.mean()))
    a = L.to_display(rec * g, exposure).astype(np.float32) / 255.0
    b = L.to_display(gt_rec, exposure).astype(np.float32) / 255.0
    ma, mb = (rec * g).reshape(-1, 3).mean(0), gt_rec.reshape(-1, 3).mean(0)
    return {"msssim": L.ms_ssim(a, b), "psnr": L.psnr(a, b), "gain": g,
            "rg_err": float((ma[0] / ma[1]) / (mb[0] / mb[1]) - 1), "bg_err": float((ma[2] / ma[1]) / (mb[2] / mb[1]) - 1),
            "chroma_hf": chroma_hf(a), "luma_hf": luma_hf(a), "chroma_hf_gt": chroma_hf(b), "luma_hf_gt": luma_hf(b)}, a


def panel(imgs, labels, path, zoom_box=None):
    from PIL import Image, ImageDraw

    hs = [im.shape[0] for im in imgs]
    w = sum(im.shape[1] for im in imgs) + 4 * (len(imgs) - 1)
    canvas = Image.new("RGB", (w, max(hs) + 14), (20, 20, 20))
    x = 0
    d = ImageDraw.Draw(canvas)
    for im, lab in zip(imgs, labels):
        canvas.paste(Image.fromarray(im), (x, 14))
        d.text((x + 2, 1), lab, fill=(230, 230, 230))
        x += im.shape[1] + 4
    canvas.save(path, quality=93)
    # A few panels also go into the log as base64 JPEG (DN_B64 = how many), so they can be looked at without the artifact.
    global B64_LEFT
    if B64_LEFT > 0 and any(k in os.path.basename(path) for k in ("_crop0", "clipped", "tiling", "strength")):
        import base64
        import io

        B64_LEFT -= 1
        buf = io.BytesIO()
        canvas.save(buf, format="JPEG", quality=85)
        print(f"B64JPEG {os.path.basename(path)} {base64.b64encode(buf.getvalue()).decode()}", flush=True)


def u8(disp):
    return (np.clip(disp, 0, 1) * 255.0 + 0.5).astype(np.uint8)


def detail_window(gt_disp, size=256):
    """The size x size window of a display crop with the most edge energy (for the saved 100 % panels)."""
    y = gt_disp @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    e = np.abs(np.diff(y, axis=0))[:, :-1] + np.abs(np.diff(y, axis=1))[:-1, :]
    best = (-1, 0, 0)
    for yy in range(0, y.shape[0] - size, size // 2):
        for xx in range(0, y.shape[1] - size, size // 2):
            v = float(e[yy:yy + size, xx:xx + size].mean())
            if v > best[0]:
                best = (v, yy, xx)
    return best[1], best[2]


# ------------------------------------------------------------------------------------------------ pairs

def cmd_pairs(a):
    os.makedirs(a.out, exist_ok=True)
    sess = L.make_session(a.model)
    results = []
    for spec in a.pairs:
        name, noisy_path, gt_path = spec.split("=")[0], *spec.split("=")[1].split(",")
        t0 = time.time()
        rn, rg = L.load_raw(noisy_path), L.load_raw(gt_path)
        log(f"== {name}: noisy {os.path.basename(noisy_path)[:60]} {exif(noisy_path)}; clean {os.path.basename(gt_path)[:60]} {exif(gt_path)}")
        log(f"   {rn['mosaic'].shape[1]} x {rn['mosaic'].shape[0]} ({rn['mosaic'].size / 1e6:.1f} MP), cfa {rn['cfa']}, black {rn['black']}, white {rn['white']}, wb as shot {np.round(rn['wb_shot'], 3).tolist()}, wb D65 {np.round(rn['wb_d65'], 3).tolist()}")
        nn, ng = L.normalise(rn), L.normalise(rg)
        if nn.shape != ng.shape or rn["cfa"] != rg["cfa"]:
            log("   shapes differ; skipped")
            continue
        cfa = rn["cfa"]
        y0, x0 = L.rggb_origin(cfa)
        wb = rg["wb_shot"]
        M = L.cam_to_rec2020_wb(rg)
        raw_gain = float(ng.mean() / nn.mean())
        log(f"   raw gain clean/noisy {raw_gain:.3f}; noisy mean {nn.mean():.4f}, clipped (>= 0.987) {100 * (nn >= 0.987).mean():.3f} %")
        outs = {}
        for wbn in a.wb.split(","):
            wbv = {"none": (1.0, 1.0, 1.0), "d65": tuple(rn["wb_d65"]), "shot": tuple(rn["wb_shot"])}[wbn]
            t = L.tiled(sess, nn, cfa, wbv)
            gs = np.array([s["g_site"] for s in t["stats"]])
            gd = np.array([s["g_dt"] for s in t["stats"]])
            gg = L.global_gain(t["rgb"]["raw"], t["work"], "site")
            log(f"   wb {wbn}: {len(t['stats'])} tiles; global gain (site) {gg:.4g}; per-tile site gain / global: min {gs.min() / gg:.4f} max {gs.max() / gg:.4f}; darktable per-tile gain / global: min {gd.min() / gg:.4f} max {gd.max() / gg:.4f}")
            outs[wbn] = (t["rgb"]["raw"] * gg, t)
        # full-frame model RGB (working region) -> place into full mosaic coordinates
        Hh, Wh = outs[a.wb.split(",")[0]][1]["Hh"], outs[a.wb.split(",")[0]][1]["Wh"]
        work_gt = ng[y0:y0 + 2 * Hh, x0:x0 + 2 * Wh]
        work_n = nn[y0:y0 + 2 * Hh, x0:x0 + 2 * Wh]
        work_gt, work_n_al, shift = align(work_gt, work_n)
        log(f"   alignment shift of the noisy frame (dy, dx): {shift}")
        dy, dx = shift
        oy, ox = max(0, -dy) + (max(0, -dy) & 1), max(0, -dx) + (max(0, -dx) & 1)

        def al(arr):  # crop a working-region array of the noisy frame like align() did
            return arr[oy + dy:oy + dy + work_gt.shape[0], ox + dx:ox + dx + work_gt.shape[1]]

        crops = pick_crops(work_gt, a.crops, a.size)
        for ci, (cy, cx) in enumerate(crops):
            gt_rec = develop_bayer(work_gt, L.RGGB, wb, M, cy, cx, a.size)
            exposure = L.auto_exposure(gt_rec)
            row = {"pair": name, "crop": ci, "at": [cy, cx]}
            sc, d_gt = score(gt_rec, gt_rec, exposure)
            n_rec = develop_bayer(work_n_al, L.RGGB, wb, M, cy, cx, a.size)
            sc, d_noisy = score(n_rec, gt_rec, exposure)
            row["noisy"] = sc
            disp = {}
            for wbn, (rgb, t) in outs.items():
                rgb_al = al(rgb)
                # Route A: re-mosaic, LightBench's Bayer stage
                mos = L.remosaic(rgb_al)
                a_rec = develop_bayer(mos, L.RGGB, wb, M, cy, cx, a.size)
                sc, d_a = score(a_rec, gt_rec, exposure)
                row[f"A_{wbn}"] = sc
                # Route B: the model's RGB, LightBench's linear stage
                m = 16
                yy0, xx0 = max(0, cy - m), max(0, cx - m)
                b_rec = L.lb_linear_stage(rgb_al[yy0:cy + a.size + m, xx0:cx + a.size + m], wb, M)[cy - yy0:cy - yy0 + a.size, cx - xx0:cx - xx0 + a.size]
                sc, d_b = score(b_rec, gt_rec, exposure)
                row[f"B_{wbn}"] = sc
                disp[wbn] = (d_a, d_b)
            results.append(row)
            log(f"   crop {ci} at {cy},{cx}: MS-SSIM noisy {row['noisy']['msssim']:.4f} | " + " | ".join(
                f"{k} {row[k]['msssim']:.4f} (PSNR {row[k]['psnr']:.2f}, R/G {100 * row[k]['rg_err']:+.1f} %, B/G {100 * row[k]['bg_err']:+.1f} %, chromaHF {row[k]['chroma_hf'] / row[k]['chroma_hf_gt']:.2f}x, lumaHF {row[k]['luma_hf'] / row[k]['luma_hf_gt']:.2f}x)"
                for k in row if k[:2] in ("A_", "B_")) + f" | noisy PSNR {row['noisy']['psnr']:.2f} chromaHF {row['noisy']['chroma_hf'] / row['noisy']['chroma_hf_gt']:.2f}x lumaHF {row['noisy']['luma_hf'] / row['noisy']['luma_hf_gt']:.2f}x")
            # panels: a 256 px window at 100 %
            wy, wx = detail_window(d_gt, a.panel)
            s = (slice(wy, wy + a.panel), slice(wx, wx + a.panel))
            first = a.wb.split(",")[0]
            imgs = [u8(d_noisy[s]), u8(disp[first][0][s]), u8(disp[first][1][s]), u8(d_gt[s])]
            labs = ["noisy (RCD)", f"A: re-mosaic+RCD ({first})", f"B: model RGB ({first})", "clean frame (RCD)"]
            if "d65" in disp and first != "d65":
                imgs.insert(3, u8(disp["d65"][1][s]))
                labs.insert(3, "B with daylight WB in")
            panel(imgs, labs, os.path.join(a.out, f"{name}_crop{ci}.jpg"))
        log(f"   ({time.time() - t0:.0f} s)")
    json.dump(results, open(os.path.join(a.out, "pairs.json"), "w"), indent=1)
    # summary table: means over crops per pair, and overall
    keys = [k for k in results[0] if k not in ("pair", "crop", "at")] if results else []
    log("\nMS-SSIM (mean over crops), per pair:")
    log("pair | " + " | ".join(keys))
    by = {}
    for r in results:
        by.setdefault(r["pair"], []).append(r)
    for p, rows in by.items():
        log(p + " | " + " | ".join(f"{np.mean([r[k]['msssim'] for r in rows]):.4f}" for k in keys))
    for metric in ("msssim", "psnr"):
        log(f"ALL {metric} | " + " | ".join(f"{k} {np.mean([r[k][metric] for r in results]):.4f}" for k in keys))
    log("ALL |R/G error| % | " + " | ".join(f"{k} {100 * np.mean([abs(r[k]['rg_err']) for r in results]):.2f}" for k in keys))
    log("ALL |B/G error| % | " + " | ".join(f"{k} {100 * np.mean([abs(r[k]['bg_err']) for r in results]):.2f}" for k in keys))
    log("ALL chroma HF / clean | " + " | ".join(f"{k} {np.mean([r[k]['chroma_hf'] / r[k]['chroma_hf_gt'] for r in results]):.3f}" for k in keys))
    log("ALL luma HF / clean | " + " | ".join(f"{k} {np.mean([r[k]['luma_hf'] / r[k]['luma_hf_gt'] for r in results]):.3f}" for k in keys))
    open(os.path.join(a.out, "pairs.txt"), "w").write("\n".join(LOG))


# ------------------------------------------------------------------------------------------------ tiling

def cmd_tiling(a):
    os.makedirs(a.out, exist_ok=True)
    raw = L.load_raw(a.raw)
    nn = L.normalise(raw)
    cfa = raw["cfa"]
    log(f"== tiling: {os.path.basename(a.raw)[:70]} {exif(a.raw)}; {nn.shape[1]} x {nn.shape[0]} ({nn.size / 1e6:.1f} MP)")
    wbv = (1.0, 1.0, 1.0) if a.wb == "none" else tuple(raw["wb_d65"])
    ref = None
    if a.dyn_model:
        # untiled reference: the whole photo in one run (mirror-padded to a multiple of 16 packed pixels)
        try:
            y0, x0 = L.rggb_origin(cfa)
            Hh, Wh = (nn.shape[0] - y0) // 2, (nn.shape[1] - x0) // 2
            work = nn[y0:y0 + 2 * Hh, x0:x0 + 2 * Wh]
            ph, pw = (-Hh) % 16, (-Wh) % 16
            padded = np.pad(work, ((0, 2 * ph), (0, 2 * pw)), mode="reflect")
            t0 = time.time()
            s = L.make_session(a.dyn_model)
            wb4 = np.array([wbv[0], wbv[1], wbv[1], wbv[2]], dtype=np.float32).reshape(4, 1, 1)
            out = L.run_model(s, (L.pack(padded) * wb4)[None])[0]
            ref = out.transpose(1, 2, 0)[:2 * Hh, :2 * Wh] / np.array(wbv, dtype=np.float32)
            del out, s
            import resource

            log(f"   untiled run of the whole photo: {time.time() - t0:.0f} s, peak RSS {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e6:.1f} GB")
        except Exception as e:  # noqa: BLE001
            log(f"   untiled run failed: {e!r}")
    for T, O in [(int(x.split(":")[0]), int(x.split(":")[1])) for x in a.tiles.split(",")]:
        sess = L.make_session(a.model if T == 512 or not a.dyn_model else a.dyn_model)
        t0 = time.time()
        t = L.tiled(sess, nn, cfa, wbv, T=T, O=O)
        dt = time.time() - t0
        st = t["stats"]
        n = len(st)
        work = t["work"]
        gg_site = L.global_gain(t["rgb"]["raw"], work, "site")
        gg_dt = L.global_gain(t["rgb"]["raw"], work, "dt")
        gs = np.array([s["g_site"] for s in st]) / gg_site
        gd = np.array([s["g_dt"] for s in st]) / gg_site
        gl = np.array([s["g_ls"] for s in st]) / gg_site
        log(f"-- tile {T} packed, overlap {O}: {t['rows']} x {t['cols']} = {n} tiles, {dt:.1f} s ({dt / n:.2f} s per tile, onnxruntime CPU); all finite: {all(s['finite'] for s in st)}; largest |output| {max(s['out_absmax'] for s in st):.4g}")
        log(f"   model scale: global gain (site) {gg_site:.5g}; darktable's formula on the whole photo {gg_dt:.5g} (= {gg_dt / gg_site:.4f} x the site gain)")
        log(f"   per-tile gain relative to the one global (site) gain: site min {gs.min():.4f} max {gs.max():.4f} sd {gs.std():.4f}; least squares min {gl.min():.4f} max {gl.max():.4f}; darktable per tile min {gd.min():.4f} max {gd.max():.4f} sd {gd.std():.4f}")
        # brightness steps between neighbouring tiles implied by per-tile gains
        grid = {(s["ty"], s["tx"]): i for i, s in enumerate(st)}
        for label, g in (("darktable per-tile", gd), ("site per-tile", gs)):
            steps = []
            for (ty, tx), i in grid.items():
                for nb in ((ty, tx + 1), (ty + 1, tx)):
                    if nb in grid:
                        steps.append(abs(g[i] / g[grid[nb]] - 1))
            steps = np.array(steps)
            log(f"   {label} gain: brightness step between neighbouring tiles: mean {100 * steps.mean():.2f} %, max {100 * steps.max():.2f} % ({(steps > 0.01).sum()} of {len(steps)} tile borders over 1 %, {(steps > 0.02).sum()} over 2 %)")
        # dark tiles (mean under 1 % of white) are where a ratio of means is least stable
        dark = [i for i, s in enumerate(st) if s["in_mean"] < 0.01]
        if dark:
            log(f"   {len(dark)} tiles with input mean under 0.01: darktable gain / global min {gd[dark].min():.4f} max {gd[dark].max():.4f}; site min {gs[dark].min():.4f} max {gs[dark].max():.4f}")
        variants = {"global": t["rgb"]["raw"] * gg_site, "dt_tile": t["rgb"]["dt"], "site_tile": t["rgb"]["site"]}
        # level relative to the source: mean of re-mosaiced output / mean of the source mosaic
        for k, v in variants.items():
            log(f"   {k}: re-mosaiced mean / source mean {L.remosaic(v).mean(dtype=np.float64) / work.mean(dtype=np.float64):.4f}")
        if ref is not None:
            gr = L.global_gain(ref, work, "site")
            refg = ref * gr
            sig = float(np.abs(refg).mean())
            step = T - 2 * O
            H2, W2 = refg.shape[:2]
            seam = np.zeros((H2, W2), dtype=bool)
            for k in range(1, t["rows"]):
                seam[max(0, 2 * k * step - 2 * O):2 * k * step + 2 * O] = True
            for k in range(1, t["cols"]):
                seam[:, max(0, 2 * k * step - 2 * O):2 * k * step + 2 * O] = True
            for k, v in variants.items():
                d = np.abs(v - refg).mean(axis=2)
                log(f"   {k} vs untiled: mean |Δ| {100 * d.mean() / sig:.3f} % of the mean level (in the seam bands {100 * d[seam].mean() / sig:.3f} %, elsewhere {100 * d[~seam].mean() / sig:.3f} %); 99.9th percentile {100 * np.percentile(d[::4, ::4], 99.9) / sig:.2f} %; PSNR vs untiled (peak = white) {10 * math.log10(1.0 / float(((v - refg) ** 2).mean())):.1f} dB")
            # low-frequency brightness error per tile core (what a step looks like): mean ratio per 64-px block
            for k, v in variants.items():
                bs = 128
                hh, ww = (H2 // bs) * bs, (W2 // bs) * bs
                A = v[:hh, :ww, 1].reshape(hh // bs, bs, ww // bs, bs).mean(axis=(1, 3))
                B = refg[:hh, :ww, 1].reshape(hh // bs, bs, ww // bs, bs).mean(axis=(1, 3))
                ok = B > 0.002
                r = (A[ok] / B[ok]) - 1
                log(f"   {k}: 128-px block mean (green) vs untiled: sd {100 * r.std():.3f} %, largest {100 * np.abs(r).max():.2f} %")
        if a.panels and T == 512:
            # a picture of the tile-to-tile steps: the whole frame, small, developed from each variant (route B, clip)
            wb, M = raw["wb_shot"], L.cam_to_rec2020_wb(raw)
            y0, x0 = L.rggb_origin(cfa)
            ims = []
            for k in ("global", "dt_tile"):
                small = variants[k][::8, ::8]
                rec = L.lb_linear_stage(small, wb, M, "clip")
                ims.append(rec)
            ex = L.auto_exposure(ims[0])
            ratio = ims[1][..., 1:2] / np.maximum(ims[0][..., 1:2], 1e-6)
            ratio = ratio / np.median(ratio)
            panel([L.to_display(i, ex) for i in ims] + [u8(np.clip(0.5 + 5 * (ratio - 1), 0, 1).repeat(3, axis=2))],
                  ["one global gain", "darktable per-tile gain", "ratio / its median (grey = equal, +/-10 % = white/black)"], os.path.join(a.out, "tiling_gain_frame.jpg"))
    open(os.path.join(a.out, "tiling.txt"), "w").write("\n".join(LOG))


# ------------------------------------------------------------------------------------------------ single raws

def noise_estimate(disp):
    """Robust noise estimate of a display image: 1.4826 * MAD of a 3x3 Laplacian of luminance (flat-area dominated)."""
    y = disp @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lap = 4 * y[1:-1, 1:-1] - y[:-2, 1:-1] - y[2:, 1:-1] - y[1:-1, :-2] - y[1:-1, 2:]
    return float(1.4826 * np.median(np.abs(lap - np.median(lap))) / math.sqrt(20))


def hot_pixels(mos, k=6.0):
    """Photosites far above their 8 same-colour neighbours: value > max(neighbours) + k * local robust spread + 0.02."""
    out = 0
    for py in (0, 1):
        for px in (0, 1):
            p = mos[py::2, px::2]
            c = p[1:-1, 1:-1]
            nb = np.stack([p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:], p[1:-1, :-2], p[1:-1, 2:], p[2:, :-2], p[2:, 1:-1], p[2:, 2:]])
            mx = nb.max(axis=0)
            sd = nb.std(axis=0)
            out += int(((c > mx + k * sd + 0.02) & (mx < 0.9)).sum())
    return out


def synth_noise(raw, stops, rng, e_per_dn_base=1.4, read_e=3.0, hot=0):
    """Simulated underexposure by `stops` stops then amplification back (a higher ISO): Poisson shot noise and Gaussian
    read noise in electrons. SYNTHETIC: no fixed-pattern noise, banding or black-level drift. `hot` random photosites
    are set to white (hot pixels)."""
    m = raw["mosaic"].astype(np.float64)
    out = np.empty_like(m)
    k = 2.0 ** stops
    for i in range(4):
        y, x = i >> 1, i & 1
        b = raw["black"][i]
        e = np.maximum(m[y::2, x::2] - b, 0) * e_per_dn_base / k
        e = rng.poisson(e).astype(np.float64) + rng.normal(0, read_e, e.shape)
        out[y::2, x::2] = e * k / e_per_dn_base + b
    if hot:
        ys, xs = rng.integers(8, m.shape[0] - 8, hot), rng.integers(8, m.shape[1] - 8, hot)
        out[ys, xs] = raw["white"]
    r2 = dict(raw)
    r2["mosaic"] = np.clip(np.round(out), 0, raw["white"]).astype(np.uint16)
    return r2


def cmd_single(a):
    os.makedirs(a.out, exist_ok=True)
    sess = L.make_session(a.model)
    rng = np.random.default_rng(5)
    for spec in a.raws:
        name, path = spec.split("=")
        try:
            raw0 = L.load_raw(path)
        except Exception as e:  # noqa: BLE001
            log(f"== {name}: cannot load {os.path.basename(path)}: {e!r}")
            continue
        log(f"== {name}: {os.path.basename(path)} {exif(path)}; {raw0['mosaic'].shape[1]} x {raw0['mosaic'].shape[0]} ({raw0['mosaic'].size / 1e6:.1f} MP), cfa {raw0['cfa']}, black {raw0['black']}, white {raw0['white']}, wb as shot {np.round(raw0['wb_shot'], 3).tolist()}")
        jobs = [("real", raw0, None)]
        for st in [float(s) for s in a.synth_stops.split(",") if s]:
            jobs.append((f"synthetic +{st:g} stops", synth_noise(raw0, st, rng, hot=a.hot), raw0))
        for label, raw, clean in jobs:
            t0 = time.time()
            nn = L.normalise(raw)
            cfa = raw["cfa"]
            y0, x0 = L.rggb_origin(cfa)
            wb, M = raw["wb_shot"], L.cam_to_rec2020_wb(raw)
            t = L.tiled(sess, nn, cfa)
            st = t["stats"]
            work = t["work"]
            gg = L.global_gain(t["rgb"]["raw"], work, "site")
            rgb = t["rgb"]["raw"] * gg
            gd = np.array([s["g_dt"] for s in st]) / gg
            gs = np.array([s["g_site"] for s in st]) / gg
            log(f"-- {label}: {len(st)} tiles in {time.time() - t0:.0f} s; finite {all(s['finite'] for s in st)}; source mean {work.mean():.4f}, clipped sites (>= 0.987) {100 * (work >= 0.987).mean():.3f} %, below black {100 * (work < 0).mean():.2f} %; per-tile gains / global: site {gs.min():.3f}..{gs.max():.3f}, darktable {gd.min():.3f}..{gd.max():.3f}")
            mos = L.remosaic(rgb)
            # clipped highlights: what the model returns where the source is clipped
            clip = L.OPPOSED_CLIP_MAGIC
            cm = work >= clip
            if cm.sum() > 100:
                v = mos[cm]
                # fully clipped areas (all four sites of the 2x2 block clipped) for route B's RGB
                blk = cm[0::2, 0::2] & cm[0::2, 1::2] & cm[1::2, 0::2] & cm[1::2, 1::2]
                msg = f"   clipped source sites: {int(cm.sum())}; model value there: mean {v.mean():.3f}, 1st percentile {np.percentile(v, 1):.3f}, {100 * (v < clip).mean():.1f} % fall below the clip level {clip} (LightBench's highlight step would no longer see them as clipped)"
                if blk.sum() > 50:
                    b = rgb[0::2, 0::2][blk]
                    msg += f"; fully clipped 2x2 blocks {int(blk.sum())}: model RGB mean {np.round(b.mean(0), 3).tolist()}, min {np.round(b.min(0), 3).tolist()}"
                log(msg)
                # unclipped sites next to clipping pushed over the clip level?
                near = (~cm) & (work > 0.8)
                if near.sum() > 100:
                    log(f"   bright unclipped sites (0.8..clip): {int(near.sum())}; {100 * (mos[near] >= clip).mean():.2f} % become >= clip after the model")
            hp0, hp1 = hot_pixels(work), hot_pixels(mos)
            log(f"   hot-pixel candidates (photosite far above its 8 same-colour neighbours): source {hp0}, after the model (re-mosaiced) {hp1}")
            # develop crops: A, A protected (source kept where clipped), B, noisy
            prot = np.where(cm, np.maximum(work, mos), mos)
            crops = pick_crops(work, a.crops, a.size)
            if cm.sum() > 2000:
                # add the crop with the most clipping
                bs = a.size
                best = (0, 0, 0)
                for yy in range(0, work.shape[0] - bs, bs // 2):
                    for xx in range(0, work.shape[1] - bs, bs // 2):
                        f = float(cm[yy:yy + bs, xx:xx + bs].mean())
                        if 0.02 < f < 0.6 and f > best[0]:
                            best = (f, yy - (yy & 1), xx - (xx & 1))
                if best[0] > 0:
                    crops.append((best[1], best[2]))
            cwork = None
            if clean is not None:
                cwork = L.normalise(clean)[y0:y0 + work.shape[0], x0:x0 + work.shape[1]]
            for ci, (cy, cx) in enumerate(crops):
                n_rec = develop_bayer(work, L.RGGB, wb, M, cy, cx, a.size)
                a_rec = develop_bayer(mos, L.RGGB, wb, M, cy, cx, a.size)
                p_rec = develop_bayer(prot, L.RGGB, wb, M, cy, cx, a.size)
                m = 16
                yy0, xx0 = max(0, cy - m), max(0, cx - m)
                b_rec = L.lb_linear_stage(rgb[yy0:cy + a.size + m, xx0:cx + a.size + m], wb, M)[cy - yy0:cy - yy0 + a.size, cx - xx0:cx - xx0 + a.size]
                ref_rec = develop_bayer(cwork, L.RGGB, wb, M, cy, cx, a.size) if cwork is not None else a_rec
                ex = L.auto_exposure(ref_rec)
                d = {k: L.to_display(v, ex).astype(np.float32) / 255.0 for k, v in (("noisy", n_rec), ("A", a_rec), ("Aprot", p_rec), ("B", b_rec), ("ref", ref_rec))}
                line = f"   crop {ci} at {cy},{cx} (clipped {100 * cm[cy:cy + a.size, cx:cx + a.size].mean():.1f} %): noise estimate (display) noisy {noise_estimate(d['noisy']):.4f} -> A {noise_estimate(d['A']):.4f}, B {noise_estimate(d['B']):.4f}; chroma HF noisy {chroma_hf(d['noisy']):.4f} -> A {chroma_hf(d['A']):.4f}, B {chroma_hf(d['B']):.4f}; luma HF noisy {luma_hf(d['noisy']):.4f} -> A {luma_hf(d['A']):.4f}, B {luma_hf(d['B']):.4f}"
                line += f"; mean colour shift vs noisy (R/G, B/G): A {100 * ((a_rec[..., 0].mean() / a_rec[..., 1].mean()) / (n_rec[..., 0].mean() / n_rec[..., 1].mean()) - 1):+.1f} %, {100 * ((a_rec[..., 2].mean() / a_rec[..., 1].mean()) / (n_rec[..., 2].mean() / n_rec[..., 1].mean()) - 1):+.1f} %; B {100 * ((b_rec[..., 0].mean() / b_rec[..., 1].mean()) / (n_rec[..., 0].mean() / n_rec[..., 1].mean()) - 1):+.1f} %, {100 * ((b_rec[..., 2].mean() / b_rec[..., 1].mean()) / (n_rec[..., 2].mean() / n_rec[..., 1].mean()) - 1):+.1f} %; brightness A/noisy {a_rec.mean() / n_rec.mean():.3f}, B/noisy {b_rec.mean() / n_rec.mean():.3f}"
                if cwork is not None:
                    sa, _ = score(a_rec, ref_rec, ex)
                    sb, _ = score(b_rec, ref_rec, ex)
                    sn, _ = score(n_rec, ref_rec, ex)
                    line += f"; vs the original: MS-SSIM noisy {sn['msssim']:.4f}, A {sa['msssim']:.4f}, B {sb['msssim']:.4f}; PSNR noisy {sn['psnr']:.2f}, A {sa['psnr']:.2f}, B {sb['psnr']:.2f}"
                log(line)
                clipped_crop = cm[cy:cy + a.size, cx:cx + a.size].mean() > 0.02
                if clipped_crop:
                    # window with the most clipping edges
                    f = cm[cy:cy + a.size, cx:cx + a.size].astype(np.float32)
                    best = (-1, 0, 0)
                    for yy in range(0, a.size - a.panel + 1, 64):
                        for xx in range(0, a.size - a.panel + 1, 64):
                            q = f[yy:yy + a.panel, xx:xx + a.panel].mean()
                            sc_ = q * (1 - q)
                            if sc_ > best[0]:
                                best = (sc_, yy, xx)
                    wy, wx = best[1], best[2]
                else:
                    wy, wx = detail_window(d["ref"], a.panel)
                s = (slice(wy, wy + a.panel), slice(wx, wx + a.panel))
                tag = label.split()[0] + (label.split()[1] if "synthetic" in label else "")
                imgs = [u8(d["noisy"][s]), u8(d["A"][s]), u8(d["B"][s])]
                labs = ["source (RCD)", "A: re-mosaic+RCD", "B: model RGB"]
                if clipped_crop:
                    imgs.insert(2, u8(d["Aprot"][s]))
                    labs.insert(2, "A, clipped sites kept")
                if cwork is not None:
                    imgs.append(u8(d["ref"][s]))
                    labs.append("original (RCD)")
                panel(imgs, labs, os.path.join(a.out, f"{name}_{tag}_crop{ci}{'_clipped' if clipped_crop else ''}.jpg"))
            if label == "real" and a.strength:
                # strength 50 %: A blends mosaics, B blends RGB (with the RCD of the source)
                cy, cx = crops[0]
                n_rec = develop_bayer(work, L.RGGB, wb, M, cy, cx, a.size)
                a50 = develop_bayer(0.5 * mos + 0.5 * work, L.RGGB, wb, M, cy, cx, a.size)
                a100 = develop_bayer(mos, L.RGGB, wb, M, cy, cx, a.size)
                ex = L.auto_exposure(a100)
                dn, d50, d100 = (L.to_display(v, ex).astype(np.float32) / 255.0 for v in (n_rec, a50, a100))
                log(f"   strength (route A, mosaic blend), crop 0: noise estimate 0 % {noise_estimate(dn):.4f}, 50 % {noise_estimate(d50):.4f}, 100 % {noise_estimate(d100):.4f}; chroma HF {chroma_hf(dn):.4f}, {chroma_hf(d50):.4f}, {chroma_hf(d100):.4f}")
                wy, wx = detail_window(d100, a.panel)
                s = (slice(wy, wy + a.panel), slice(wx, wx + a.panel))
                panel([u8(dn[s]), u8(d50[s]), u8(d100[s])], ["strength 0", "A at 50 %", "A at 100 %"], os.path.join(a.out, f"{name}_strength.jpg"))
            if label == "real" and a.cache:
                # cache size: A = 16-bit mosaic, B = 16-bit RGB (camera RGB on the raw scale), raw and deflate-compressed
                white, blk = raw["white"], raw["black"]
                am = np.empty(work.shape, dtype=np.float32)
                for i in range(4):
                    yy, xx = i >> 1, i & 1
                    am[yy::2, xx::2] = mos[yy::2, xx::2] * (white - blk[i]) + blk[i]
                a16 = np.clip(np.round(am), 0, 65535).astype("<u2")
                b16 = np.clip(np.round(rgb * (white - np.mean(blk)) + np.mean(blk)), 0, 65535).astype("<u2")
                src16 = raw["mosaic"][y0:y0 + work.shape[0], x0:x0 + work.shape[1]].astype("<u2")
                za, zb, zs = len(zlib.compress(a16.tobytes(), 6)), len(zlib.compress(b16.tobytes(), 6)), len(zlib.compress(src16.tobytes(), 6))
                log(f"   cache size for this photo ({work.size / 1e6:.1f} MP): A 16-bit mosaic {a16.nbytes / 1e6:.1f} MB (deflate level 6: {za / 1e6:.1f} MB); B 16-bit RGB {b16.nbytes / 1e6:.1f} MB (deflate: {zb / 1e6:.1f} MB); the source mosaic deflates to {zs / 1e6:.1f} MB")
    open(os.path.join(a.out, "single.txt"), "w").write("\n".join(LOG))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("pairs")
    s.add_argument("--model", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--wb", default="none,d65")
    s.add_argument("--crops", type=int, default=3)
    s.add_argument("--size", type=int, default=1024)
    s.add_argument("--panel", type=int, default=256)
    s.add_argument("pairs", nargs="+", help="name=noisy,clean")
    s = sub.add_parser("tiling")
    s.add_argument("--model", required=True)
    s.add_argument("--dyn-model", default="")
    s.add_argument("--raw", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--wb", default="none")
    s.add_argument("--tiles", default="512:32,256:32,256:16")
    s.add_argument("--panels", action="store_true")
    s = sub.add_parser("single")
    s.add_argument("--model", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--crops", type=int, default=2)
    s.add_argument("--size", type=int, default=1024)
    s.add_argument("--panel", type=int, default=256)
    s.add_argument("--synth-stops", default="")
    s.add_argument("--hot", type=int, default=0)
    s.add_argument("--strength", action="store_true")
    s.add_argument("--cache", action="store_true")
    s.add_argument("raws", nargs="+", help="name=path")
    a = ap.parse_args()
    {"pairs": cmd_pairs, "tiling": cmd_tiling, "single": cmd_single}[a.cmd](a)
