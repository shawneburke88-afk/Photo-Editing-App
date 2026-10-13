"""Data preparation for the LightBench raw denoiser. Nothing here downloads image data.

  python prepare_data.py list    --out data/manifest            # query Dataverse, write the download list
  python prepare_data.py verify  --manifest data/manifest/manifest.csv --dir data/rawnind/flat
  python prepare_data.py build   --raw data/rawnind/flat --out data/packed [--extra-clean D:/clean_raws]
  python prepare_data.py profiles --out data/packed             # pool of our own (a, b) fits for synthesis
  python prepare_data.py calib   --out data/packed --darktable path/to/noiseprofiles.json

`list` reads only the dataset's metadata (a few hundred KB of JSON) and writes:
  manifest.csv   filename, id, bytes, checksum, url
  download.txt   one URL per line with its output name, for `curl`/`aria2c` (see README.md)
  summary.json   file count, total bytes, Bayer / X-Trans / clean / noisy counts, ISO range, licence fields
It never invents a size or licence: whatever the API returns is printed, and missing fields are reported missing.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

DATAVERSE = "https://dataverse.uclouvain.be"
DOI = "doi:10.14428/DVN/DEQCIM"  # RawNIND (trougnouf/rawnind_jddc README)

# Held-out scenes, from rawnind_jddc src/rawnind/config/test_reserve.yaml and tools/summarize_dataset.py
# (commit e80fb7b). Keeping the authors' test scenes lets our numbers sit next to theirs.
TEST_SCENES_BAYER = ["7D-2", "Vaxt-i-trad", "Pen-pile", "MuseeL-vases-A7C", "D60-1", "MuseeL-Saint-Pierre-C500D",
                     "TitusToys", "boardgames_top", "Laura_Lemons_platformer", "MuseeL-bluebirds-A7C"]
TEST_SCENES_XTRANS = ["ursulines-red", "stefantiek", "ursulines-building", "MuseeL-Bobo",
                      "CourtineDeVillersDebris", "MuseeL-Bobo-C500D", "Pen-pile"]

# Bayer_7D-1_GT_ISO100_sha1=....cr2 / Bayer_7D-1_ISO3200_sha1=....cr2 (organize_files.sh in rawnind_jddc)
NAME_RE = re.compile(r"^(?P<kind>Bayer|X-Trans)_(?P<scene>.+?)(?P<gt>_GT)?_ISO(?P<iso>[^_]+)_sha1=(?P<sha1>[0-9a-f]{40})"
                     r"\.(?P<ext>\w+)$", re.IGNORECASE)


def parse_name(name: str) -> dict | None:
    m = NAME_RE.match(name)
    if not m:
        return None
    d = m.groupdict()
    d["scene"] = re.sub(r"^TEST_", "", d["scene"])
    d["gt"] = bool(d["gt"])
    return d


# -------------------------------------------------------------------------------------------------- list


def cmd_list(args):
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if args.api_json:  # offline: a JSON saved from a browser
        meta = json.loads(Path(args.api_json).read_text(encoding="utf-8"))
    else:
        url = f"{DATAVERSE}/api/datasets/:persistentId/?persistentId={DOI}"
        with urllib.request.urlopen(url, timeout=60) as r:
            meta = json.load(r)
        (out / "dataverse.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    ver = meta["data"]["latestVersion"]
    rows, kinds, isos = [], Counter(), Counter()
    scenes = defaultdict(lambda: {"gt": 0, "noisy": 0})
    for f in ver["files"]:
        df = f["dataFile"]
        cs = df.get("checksum") or ({"type": "MD5", "value": df["md5"]} if "md5" in df else None)
        rows.append({"filename": df["filename"], "id": df["id"], "bytes": df.get("filesize"),
                     "checksum_type": cs["type"] if cs else "", "checksum": cs["value"] if cs else "",
                     "url": f"{DATAVERSE}/api/access/datafile/{df['id']}"})
        p = parse_name(df["filename"])
        if p:
            kinds[p["kind"]] += 1
            isos[p["iso"]] += 1
            scenes[(p["kind"], p["scene"])]["gt" if p["gt"] else "noisy"] += 1
        else:
            kinds["unparsed"] += 1
    with open(out / "manifest.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    with open(out / "download.txt", "w", encoding="utf-8") as fh:
        for r in rows:  # aria2c input format: URL, then "  out=<name>"
            fh.write(f"{r['url']}\n  out={r['filename']}\n")
    sizes = [r["bytes"] for r in rows if isinstance(r["bytes"], int)]
    summary = {
        "doi": DOI,
        "version": f"{ver.get('versionNumber')}.{ver.get('versionMinorNumber')}",
        "release_time": ver.get("releaseTime"),
        "licence_field": ver.get("license", "MISSING"),
        "terms_of_use": ver.get("termsOfUse", "MISSING"),
        "files": len(rows),
        "files_with_size": len(sizes),
        "total_bytes": sum(sizes),
        "total_gib": round(sum(sizes) / 2 ** 30, 2),
        "by_kind": dict(kinds),
        "scenes": len(scenes),
        "scenes_without_gt": [f"{k}/{s}" for (k, s), v in scenes.items() if v["gt"] == 0],
        "iso_counts": dict(sorted(isos.items(), key=lambda kv: (len(kv[0]), kv[0]))),
        "test_scenes_found": sorted(s for (k, s) in scenes if s in TEST_SCENES_BAYER + TEST_SCENES_XTRANS),
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps(summary, indent=1))
    print(f"\nWrote {out / 'manifest.csv'} and {out / 'download.txt'}. Read the licence fields above before "
          f"downloading; record them in MODEL_CARD.md.")


# ------------------------------------------------------------------------------------------------ verify


def file_digest(path: Path, kind: str) -> str:
    h = hashlib.new(kind.lower().replace("-", ""))
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cmd_verify(args):
    bad, missing, ok = [], [], 0
    with open(args.manifest, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            p = Path(args.dir) / r["filename"]
            if not p.exists():
                missing.append(r["filename"])
                continue
            if r["bytes"] and p.stat().st_size != int(r["bytes"]):
                bad.append((r["filename"], "size"))
                continue
            if r["checksum"] and file_digest(p, r["checksum_type"] or "md5") != r["checksum"].lower():
                bad.append((r["filename"], r["checksum_type"]))
                continue
            info = parse_name(r["filename"])  # RawNIND names carry the file's SHA-1 too
            if info and file_digest(p, "sha1") != info["sha1"]:
                bad.append((r["filename"], "sha1-in-name"))
                continue
            ok += 1
    print(f"ok {ok}, missing {len(missing)}, bad {len(bad)}")
    for b in bad:
        print("BAD", *b)
    sys.exit(1 if bad else 0)


# ------------------------------------------------------------------------------------------------- build


def box_mean(img: np.ndarray, r: int) -> np.ndarray:
    """Mean over a (2r+1)^2 box with edge clamping, via cumulative sums."""
    p = np.pad(img, r + 1, mode="edge").astype(np.float64)
    c = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return (s / (k * k))[: img.shape[0], : img.shape[1]].astype(np.float32)


def exif_info(path: Path) -> dict:
    try:
        import exifread  # BSD-3-Clause; optional
        with open(path, "rb") as fh:
            t = exifread.process_file(fh, details=False)
        return {"maker": str(t.get("Image Make", "")).strip(), "model": str(t.get("Image Model", "")).strip(),
                "iso": str(t.get("EXIF ISOSpeedRatings", "")).strip()}
    except Exception:  # noqa: BLE001 - metadata is optional
        return {"maker": "", "model": "", "iso": ""}


def split_for(scene: str, val_every: int = 20) -> str:
    if scene in TEST_SCENES_BAYER:
        return "test"
    return "val" if int(hashlib.sha1(scene.encode()).hexdigest(), 16) % val_every == 0 else "train"


def cmd_build(args):
    from dataset import fit_noise, find_shift, load_packed_raw, match_gain

    raw_dir, out = Path(args.raw), Path(args.out)
    (out / "frames").mkdir(parents=True, exist_ok=True)
    (out / "masks").mkdir(exist_ok=True)
    groups = defaultdict(lambda: {"gt": [], "noisy": []})
    for p in sorted(raw_dir.rglob("*")):
        info = parse_name(p.name) if p.is_file() else None
        if info and info["kind"] == "Bayer":  # X-Trans goes to the linear variant (PLAN.md 2.4)
            groups[info["scene"]]["gt" if info["gt"] else "noisy"].append((p, info))
    index = {"pairs": [], "clean_frames": [], "source": str(raw_dir)}
    cache = {}

    def frame(p: Path):
        if p not in cache:
            arr, meta = load_packed_raw(p)
            meta.update(exif_info(p))
            name = f"frames/{p.stem}.npy"
            np.save(out / name, arr.astype(np.float16))
            cache.clear()  # keep memory bounded: at most one frame cached
            cache[p] = (arr, meta, name)
        return cache[p]

    for scene, g in groups.items():
        if not g["gt"]:
            print(f"skip {scene}: no clean frame")
            continue
        split = split_for(scene)
        gt_path, gt_info = min(g["gt"], key=lambda t: float(re.sub(r"\D", "", t[1]["iso"]) or 1e9))
        clean, cmeta, cname = frame(gt_path)
        clean = clean.copy()
        index["clean_frames"].append({"path": cname, "scene": scene, "split": split,
                                      "camera": f"{cmeta['maker']} {cmeta['model']}"})
        for npath, ninfo in g["noisy"]:
            noisy, nmeta, nname = frame(npath)
            dy, dx = find_shift(noisy, clean)
            c = np.roll(clean, (-dy, -dx), axis=(1, 2))  # c[y] = clean[y + dy]; wrapped borders masked below
            mask = np.ones(noisy.shape[1:], bool)
            b = max(abs(dy), abs(dx)) + 1
            mask[:b], mask[-b:], mask[:, :b], mask[:, -b:] = False, False, False, False
            mask &= (noisy.max(0) < 0.98) & (c.max(0) < 0.98)  # clipped photosites carry no truth
            gain = match_gain(noisy, c, mask)
            cg = c * gain
            a, bb = fit_noise(noisy, cg, mask)
            # Content mismatch (wind, people, light changes): the local mean residual over 17x17 sites should be
            # ~0 within 4 standard errors of the fitted noise; else mask it out.
            for ch in range(4):
                std = np.sqrt(np.clip(a[ch] * cg[ch] + bb[ch], 1e-12, None))
                mask &= np.abs(box_mean(noisy[ch] - cg[ch], 8)) < 4 * std / 17
            if mask.mean() < args.min_valid:
                print(f"drop {npath.name}: only {mask.mean():.0%} usable")
                continue
            a, bb = fit_noise(noisy, cg, mask)
            mname = f"masks/{npath.stem}.mask.npy"
            np.save(out / mname, mask.astype(np.uint8))
            cshift = f"frames/{gt_path.stem}__to__{npath.stem}.npy" if (dy, dx) != (0, 0) else cname
            if cshift != cname:
                np.save(out / cshift, c.astype(np.float16))
            index["pairs"].append({"noisy": nname, "clean": cshift, "mask": mname, "gain": gain.ravel().tolist(),
                                   "shift": [dy, dx], "a": a, "b": bb, "scene": scene, "iso": ninfo["iso"],
                                   "camera": f"{nmeta['maker']} {nmeta['model']}", "split": split,
                                   "valid": float(mask.mean())})
            print(f"{split:5s} {scene} ISO{ninfo['iso']}: shift {dy},{dx} valid {mask.mean():.0%} "
                  f"a_G {a[1]:.2e} b_G {bb[1]:.2e}")
    if args.extra_clean:  # e.g. CC0 files from raw.pixls.us or the owner's own low-ISO raws
        for p in sorted(Path(args.extra_clean).rglob("*")):
            if p.is_file() and p.suffix.lower() in {".nef", ".arw", ".cr2", ".cr3", ".dng", ".orf", ".rw2", ".pef"}:
                try:
                    _, meta, name = frame(p)
                except ValueError as e:
                    print("skip", e)
                    continue
                index["clean_frames"].append({"path": name, "scene": p.stem, "split": "train",
                                              "camera": f"{meta['maker']} {meta['model']}",
                                              "source": str(p.parent)})
    (out / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    print(f"{len(index['pairs'])} pairs, {len(index['clean_frames'])} clean frames -> {out / 'index.json'}")


# ---------------------------------------------------------------------------------------- profiles, calib


def cmd_profiles(args):
    index = json.loads((Path(args.out) / "index.json").read_text())
    prof = [{"a": p["a"], "b": p["b"], "camera": p["camera"], "iso": p["iso"]}
            for p in index["pairs"] if p["split"] == "train"]
    (Path(args.out) / "profiles.json").write_text(json.dumps(prof, indent=1))
    print(f"{len(prof)} fitted profiles -> profiles.json")


def cmd_calib(args):
    """Compare our per-photosite fits with darktable's profiles (measured on demosaiced camera RGB with white
    balance 1, tools/noise/profiling-shot.xmp) for the same camera and ISO. Prints the ratio per channel; the
    median ratio is what LightBench multiplies darktable's (a, b) by before feeding the model."""
    index = json.loads((Path(args.out) / "index.json").read_text())
    dt = json.loads(Path(args.darktable).read_text())["noiseprofiles"]
    table = {}
    for mk in dt:
        for m in mk["models"]:
            for p in m["profiles"]:
                if not p.get("skip"):
                    table[(mk["maker"].lower(), m["model"], int(p["iso"]))] = p
    ratios = []
    for p in index["pairs"]:
        maker, _, model = p["camera"].partition(" ")
        key = next((k for k in table if k[0] in maker.lower() and k[1] in model and str(k[2]) == p["iso"]), None)
        if key is None:
            continue
        d = table[key]
        # darktable channel order R, G, B -> our packed R, G1, G2, B
        da = [d["a"][0], d["a"][1], d["a"][1], d["a"][2]]
        ratios.append([p["a"][c] / da[c] for c in range(4)])
        print(p["camera"], p["iso"], ["%.2f" % r for r in ratios[-1]])
    if ratios:
        print("median a-ratio (ours / darktable) per channel:", np.median(np.array(ratios), 0).round(3).tolist())
    else:
        print("no camera/ISO overlap found (check EXIF maker/model strings)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("list")
    s.add_argument("--out", default="data/manifest")
    s.add_argument("--api-json", help="use a saved copy of the Dataverse API response instead of the network")
    s.set_defaults(fn=cmd_list)
    s = sub.add_parser("verify")
    s.add_argument("--manifest", required=True)
    s.add_argument("--dir", required=True)
    s.set_defaults(fn=cmd_verify)
    s = sub.add_parser("build")
    s.add_argument("--raw", required=True)
    s.add_argument("--out", default="data/packed")
    s.add_argument("--extra-clean", help="folder of clean low-ISO raws whose licence you have checked")
    s.add_argument("--min-valid", type=float, default=0.5)
    s.set_defaults(fn=cmd_build)
    s = sub.add_parser("profiles")
    s.add_argument("--out", default="data/packed")
    s.set_defaults(fn=cmd_profiles)
    s = sub.add_parser("calib")
    s.add_argument("--out", default="data/packed")
    s.add_argument("--darktable", required=True, help="darktable data/noiseprofiles.json")
    s.set_defaults(fn=cmd_calib)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
