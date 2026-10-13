"""Datasets for the LightBench raw denoiser.

Everything works on *packed* Bayer data: a sensor mosaic with R at (0,0) is packed to [4, H/2, W/2] as
[R, G1 (0,1), G2 (1,0), B], black-subtracted and divided by (white - black), not white balanced.

prepare_data.py writes, per frame, `<id>.npy` (float16, [4, h, w]) and, per noisy/clean pair, a loss mask
`<pair>.mask.npy` (uint8, [h, w]) plus `index.json`. These classes read them with np.load(mmap_mode="r"), so a
random crop touches only the bytes it needs (DataLoader workers on Windows are separate processes, see README).

Two sources:
  PairCrops      real noisy/clean pairs (RawNIND), with a per-pair noise fit (a, b) for conditioning;
  SyntheticCrops clean frames + Poisson-Gaussian noise drawn from a pool of (a, b) fits.
"""
from __future__ import annotations

import json
import math
import random
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset

# ----------------------------------------------------------------------------------------------- raw reading


def load_packed_raw(path: str | Path) -> tuple[np.ndarray, dict]:
    """Read a Bayer raw file with rawpy (LibRaw) and return packed RGGB float32 [4, h, w] in [0, ~1] plus metadata.

    Only used by prepare_data.py and evaluate.py; training reads the .npy files.
    """
    import rawpy  # imported here so model/train don't need it

    with rawpy.imread(str(path)) as raw:
        if raw.raw_pattern is None or raw.raw_pattern.shape != (2, 2):
            raise ValueError(f"{path}: not a 2x2 Bayer sensor (X-Trans or linear DNG); use the linear variant")
        mosaic = raw.raw_image_visible.astype(np.float32)
        colors = raw.raw_colors_visible  # colour index per photosite (0=R, 1=G, 2=B, 3=G2 for most cameras)
        desc = raw.color_desc.decode()   # e.g. "RGBG"
        black = np.array(raw.black_level_per_channel, dtype=np.float32)
        white = float(raw.white_level)
        # Per-photosite black level (index by the colour index of each site).
        mosaic = (mosaic - black[colors]) / (white - black[colors])
        meta = {  # maker/model/ISO come from EXIF in prepare_data.py (rawpy doesn't expose them)
            "black": black.tolist(),
            "white": white,
            "wb": list(map(float, raw.camera_whitebalance)),
            "rgb_xyz_matrix": raw.rgb_xyz_matrix[:3].tolist(),
        }
        # Find the 2x2 offset where the pattern reads R, G, G, B.
        names = np.array(list(desc))[colors[:2, :2]]
        for dy in (0, 1):
            for dx in (0, 1):
                blk = np.array(list(desc))[colors[dy:dy + 2, dx:dx + 2]]
                if blk[0, 0] == "R" and blk[1, 1] == "B":
                    mosaic = mosaic[dy:, dx:]
                    meta["crop_offset"] = [dy, dx]
                    break
            else:
                continue
            break
        else:
            raise ValueError(f"{path}: unexpected CFA {names}")
    h, w = (mosaic.shape[0] // 2) * 2, (mosaic.shape[1] // 2) * 2
    return pack(mosaic[:h, :w]), meta


def pack(mosaic: np.ndarray) -> np.ndarray:
    return np.stack([mosaic[0::2, 0::2], mosaic[0::2, 1::2], mosaic[1::2, 0::2], mosaic[1::2, 1::2]])


def unpack(packed: np.ndarray) -> np.ndarray:
    c, h, w = packed.shape
    m = np.empty((2 * h, 2 * w), dtype=packed.dtype)
    m[0::2, 0::2], m[0::2, 1::2], m[1::2, 0::2], m[1::2, 1::2] = packed
    return m


# ------------------------------------------------------------------------------------------ pair utilities


def match_gain(noisy: np.ndarray, clean: np.ndarray, mask: np.ndarray | None = None) -> np.ndarray:
    """Per-channel scalar so that clean * g has the noisy frame's mean (ISO series differ slightly in exposure)."""
    g = np.ones((4, 1, 1), dtype=np.float32)
    for c in range(4):
        m = mask if mask is not None else np.ones(noisy.shape[1:], bool)
        g[c] = noisy[c][m].mean() / max(clean[c][m].mean(), 1e-8)
    return g


def find_shift(noisy: np.ndarray, clean: np.ndarray, search: int = 8) -> tuple[int, int]:
    """Integer shift (in packed pixels = 2 photosites, so the CFA phase is kept) minimising the mean absolute
    difference of the green average on the central region. RawNIND is shot on a tripod, so shifts are small."""
    gn = 0.5 * (noisy[1] + noisy[2])
    gc = 0.5 * (clean[1] + clean[2])
    h, w = gn.shape
    y0, y1, x0, x1 = h // 4, 3 * h // 4, w // 4, 3 * w // 4
    best, best_err = (0, 0), math.inf
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            err = np.abs(gn[y0:y1, x0:x1] - gc[y0 + dy:y1 + dy, x0 + dx:x1 + dx]).mean()
            if err < best_err:
                best, best_err = (dy, dx), err
    return best


def fit_noise(noisy: np.ndarray, clean: np.ndarray, mask: np.ndarray, bins: int = 32) -> tuple[list, list]:
    """Fit var(noisy - clean) = a * clean + b per packed channel, by binning on the clean value.

    The clean frame has its own (base-ISO) noise, so the fit slightly overestimates; it is our own measurement
    from CC BY / CC0 data, which keeps darktable's GPL profile file out of training (PLAN.md section 1.4).
    """
    a_out, b_out = [], []
    for c in range(4):
        x = clean[c][mask].ravel()
        r = (noisy[c] - clean[c])[mask].ravel()
        edges = np.quantile(x, np.linspace(0.02, 0.98, bins + 1))
        xs, vs, ws = [], [], []
        for lo, hi in zip(edges[:-1], edges[1:]):
            sel = (x >= lo) & (x < hi)
            if sel.sum() > 500:
                xs.append(x[sel].mean())
                vs.append(r[sel].var())
                ws.append(sel.sum())
        A = np.stack([np.array(xs), np.ones(len(xs))], 1) * np.sqrt(ws)[:, None]
        a, b = np.linalg.lstsq(A, np.array(vs) * np.sqrt(ws), rcond=None)[0]
        a_out.append(float(max(a, 1e-9)))
        b_out.append(float(b))
    return a_out, b_out


# -------------------------------------------------------------------------------------------- augmentation


def random_crop_aug(arrays: list[np.ndarray], h: int, w: int, rng: random.Random) -> list[np.ndarray]:
    """Same random crop + flip/transpose for every array. Flips are done on the mosaic and re-cropped by one
    photosite so the result is still RGGB (a plain flip of packed data would turn RGGB into GRBG)."""
    big_h, big_w = arrays[0].shape[-2:]
    y = rng.randrange(0, big_h - h)  # one extra packed row/column for the flip re-crop
    x = rng.randrange(0, big_w - w)
    fy, fx, tr = rng.random() < 0.5, rng.random() < 0.5, rng.random() < 0.5
    out = []
    for arr in arrays:
        crop = np.asarray(arr[..., y:y + h + 1, x:x + w + 1], dtype=np.float32)
        if crop.ndim == 3 and crop.shape[0] == 4:
            m = unpack(crop)
            if fy:
                m = m[::-1]
            if fx:
                m = m[:, ::-1]
            m = m[int(fy):int(fy) + 2 * h, int(fx):int(fx) + 2 * w]
            if tr:
                m = m.T
            out.append(pack(np.ascontiguousarray(m)))
        else:  # mask at packed resolution: same geometry (approximate to one photosite)
            m = crop
            if fy:
                m = m[..., ::-1, :]
            if fx:
                m = m[..., :, ::-1]
            m = m[..., :h, :w]
            if tr:
                m = np.swapaxes(m, -1, -2)
            out.append(np.ascontiguousarray(m))
    return out


# ------------------------------------------------------------------------------------------------ datasets


class PairCrops(Dataset):
    """Real noisy/clean pairs. index.json entries: {"noisy", "clean", "mask", "gain": [4], "shift": [dy, dx],
    "a": [4], "b": [4], "scene", "camera", "iso", "split"}. `shift` is already applied by prepare_data.py."""

    def __init__(self, root: str | Path, split: str = "train", crop: int = 256, samples_per_epoch: int = 50_000,
                 cond_jitter: float = 0.2, seed: int = 0):
        self.root = Path(root)
        index = json.loads((self.root / "index.json").read_text())
        self.pairs = [p for p in index["pairs"] if p["split"] == split]
        if not self.pairs:
            raise RuntimeError(f"no {split} pairs in {self.root / 'index.json'}")
        self.crop, self.n, self.jitter, self.seed = crop, samples_per_epoch, cond_jitter, seed

    def __len__(self):
        return self.n

    def __getitem__(self, i):
        rng = random.Random(hash((self.seed, i, torch.initial_seed())))
        p = self.pairs[rng.randrange(len(self.pairs))]
        noisy = np.load(self.root / p["noisy"], mmap_mode="r")
        clean = np.load(self.root / p["clean"], mmap_mode="r")
        mask = np.load(self.root / p["mask"], mmap_mode="r")[None]
        n, c, m = random_crop_aug([noisy, clean, mask], self.crop, self.crop, rng)
        c = c * np.asarray(p["gain"], np.float32)[:, None, None]
        j = np.float32(1.0 + rng.uniform(-self.jitter, self.jitter))  # robustness to profile error
        a = np.asarray(p["a"], np.float32)[:, None, None] * j
        b = np.asarray(p["b"], np.float32)[:, None, None] * j
        return {"noisy": torch.from_numpy(n), "clean": torch.from_numpy(c), "mask": torch.from_numpy(m),
                "a": torch.from_numpy(a), "b": torch.from_numpy(b)}


class SyntheticCrops(Dataset):
    """Clean frames + heteroscedastic Gaussian noise var = a*x + b (Poisson-Gaussian approximation).

    `profiles` is a list of {"a": [4], "b": [4]} (our own fits from RawNIND pairs, PLAN.md 1.4). Each sample
    picks one and scales it by a random ISO factor so the network sees a continuous range of noise levels.
    """

    def __init__(self, root: str | Path, profiles: list[dict], split: str = "train", crop: int = 256,
                 samples_per_epoch: int = 50_000, iso_scale: tuple[float, float] = (0.25, 4.0),
                 cond_jitter: float = 0.2, seed: int = 1):
        self.root = Path(root)
        index = json.loads((self.root / "index.json").read_text())
        self.frames = [f for f in index["clean_frames"] if f["split"] == split]
        self.profiles, self.crop, self.n = profiles, crop, samples_per_epoch
        self.iso_scale, self.jitter, self.seed = iso_scale, cond_jitter, seed

    def __len__(self):
        return self.n

    def __getitem__(self, i):
        rng = random.Random(hash((self.seed, i, torch.initial_seed())))
        f = self.frames[rng.randrange(len(self.frames))]
        clean = np.load(self.root / f["path"], mmap_mode="r")
        (c,) = random_crop_aug([clean], self.crop, self.crop, rng)
        prof = self.profiles[rng.randrange(len(self.profiles))]
        k = math.exp(rng.uniform(math.log(self.iso_scale[0]), math.log(self.iso_scale[1])))
        a = np.asarray(prof["a"], np.float32)[:, None, None] * k
        b = np.asarray(prof["b"], np.float32)[:, None, None] * k * k  # read noise grows faster with gain
        std = np.sqrt(np.clip(a * np.clip(c, 0, None) + b, 1e-12, None))
        nprng = np.random.default_rng(rng.randrange(2 ** 31))
        noisy = (c + std * nprng.standard_normal(c.shape).astype(np.float32)).astype(np.float32)
        j = np.float32(1.0 + rng.uniform(-self.jitter, self.jitter))
        return {"noisy": torch.from_numpy(noisy), "clean": torch.from_numpy(c),
                "mask": torch.ones(1, self.crop, self.crop), "a": torch.from_numpy(a * j),
                "b": torch.from_numpy(b * j)}


class ValTiles(Dataset):
    """Deterministic validation: fixed central tiles of the held-out pairs (no augmentation)."""

    def __init__(self, root: str | Path, split: str = "val", tile: int = 512):
        self.root = Path(root)
        index = json.loads((self.root / "index.json").read_text())
        self.pairs = [p for p in index["pairs"] if p["split"] == split]
        self.tile = tile

    def __len__(self):
        return len(self.pairs)

    def __getitem__(self, i):
        p = self.pairs[i]
        noisy = np.load(self.root / p["noisy"], mmap_mode="r")
        h, w = noisy.shape[1:]
        t = min(self.tile, h // 16 * 16, w // 16 * 16)
        y, x = (h - t) // 2, (w - t) // 2
        sl = (slice(None), slice(y, y + t), slice(x, x + t))
        clean = np.asarray(np.load(self.root / p["clean"], mmap_mode="r")[sl], np.float32)
        clean *= np.asarray(p["gain"], np.float32)[:, None, None]
        mask = np.asarray(np.load(self.root / p["mask"], mmap_mode="r")[y:y + t, x:x + t], np.float32)[None]
        return {"noisy": torch.from_numpy(np.asarray(noisy[sl], np.float32)), "clean": torch.from_numpy(clean),
                "mask": torch.from_numpy(mask), "a": torch.tensor(p["a"]).view(4, 1, 1),
                "b": torch.tensor(p["b"]).view(4, 1, 1), "name": f"{p['scene']} ISO{p['iso']}"}


class Mixed(Dataset):
    """Draw from the real pairs with probability p_real, else from the synthetic set."""

    def __init__(self, real: Dataset, synth: Dataset | None, p_real: float = 0.7):
        self.real, self.synth, self.p = real, synth, p_real

    def __len__(self):
        return len(self.real)

    def __getitem__(self, i):
        if self.synth is None or random.random() < self.p:
            return self.real[i]
        return self.synth[i % len(self.synth)]
