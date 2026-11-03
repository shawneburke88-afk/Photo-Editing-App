"""Unblur feasibility spike (docs/UNBLUR_SPIKE.md): download the public inputs on GitHub's runner and record where they
came from (URL, commit, size, SHA-256). Nothing downloaded here is committed.

  probe     list what the sources offer (Hugging Face dataset trees, the Google Drive folders) without big downloads
  weights   the MISC Filter checkpoints (Google Drive folder) and NAFNet-GoPro-width64 (Google Drive file); SHA-256
  realblur  stream RealBlur's test archives from Hugging Face and keep only the chosen test pairs
  zoo       opencv_zoo's deblurring_nafnet_2025may.onnx from GitHub's Git LFS at a pinned commit

Run with `python -I`; every downloaded file goes into its own directory (--out).
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tarfile
import urllib.request

MISC_FOLDER = "https://drive.google.com/drive/folders/1M-Sc_u97vTQskfO6VMzPghb8LnerP8Id"
NAFNET_GOPRO64 = "1S0PVRbyTakYY9a82kujgZLbMihfNBLfC"  # NAFNet readme: NAFNet-GoPro-width64
NAFNET_REDS64 = "14D4V4raNYIOhETfcuuLI3bGLB-OYIv6X"  # NAFNet readme: NAFNet-REDS-width64 (opencv_zoo's source)
ZOO_COMMIT = "48b10fa505aeb51fbd127fc60a5c660040e823b7"
ZOO_PATH = "models/deblurring_nafnet/deblurring_nafnet_2025may.onnx"
ZOO_SHA = "07263f416febecce10193dd648e950b22e397cf521eedab1a114ef77b2bc9587"
HF = "https://huggingface.co"


def sha256(path):
    d = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            d.update(b)
    return d.hexdigest()


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "lightbench-unblur-spike"}), timeout=60) as r:
        return json.load(r)


def hf_tree(repo, kind="datasets", rev="main", path=""):
    url = f"{HF}/api/{kind}/{repo}/tree/{rev}" + (f"/{path}" if path else "") + "?recursive=false"
    return get_json(url)


def hf_info(repo, kind="datasets"):
    return get_json(f"{HF}/api/{kind}/{repo}")


def cmd_probe(a):
    out = {}
    for repo in ["rimchang/RealBlur", "rimchang/RSBlur"]:
        try:
            info = hf_info(repo)
            tree = hf_tree(repo, rev=info["sha"])
            out[repo] = {"sha": info["sha"], "license": (info.get("cardData") or {}).get("license"),
                         "files": [{"path": t["path"], "type": t["type"], "size": t.get("size"), "lfs": (t.get("lfs") or {}).get("oid")} for t in tree]}
        except Exception as e:  # noqa: BLE001
            out[repo] = {"error": repr(e)}
    try:
        out["hf-author-rimchang"] = [d["id"] for d in get_json(f"{HF}/api/datasets?author=rimchang&limit=50")]
    except Exception as e:  # noqa: BLE001
        out["hf-author-rimchang"] = repr(e)
    try:
        out["hf-opencv-nafnet"] = [m["id"] for m in get_json(f"{HF}/api/models?search=nafnet&author=opencv&limit=20")]
    except Exception as e:  # noqa: BLE001
        out["hf-opencv-nafnet"] = repr(e)
    # Google Drive folder listing (gdown lists without downloading with --skip-download on recent versions).
    try:
        import gdown
        files = gdown.download_folder(MISC_FOLDER, skip_download=True, quiet=True)
        out["misc-drive"] = [{"id": f.id, "path": f.path} for f in files]
    except Exception as e:  # noqa: BLE001
        out["misc-drive"] = repr(e)
    print(json.dumps(out, indent=1))
    if a.out:
        json.dump(out, open(a.out, "w"), indent=1)


def gdown_file(fid, dest):
    import gdown
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    gdown.download(id=fid, output=dest, quiet=True)
    if not os.path.exists(dest):
        raise SystemExit(f"download of Google Drive file {fid} failed")
    return {"url": f"https://drive.google.com/file/d/{fid}", "bytes": os.path.getsize(dest), "sha256": sha256(dest)}


def cmd_weights(a):
    import gdown
    os.makedirs(a.out, exist_ok=True)
    rec = {}
    want = set(a.which.split(","))
    if want & {"misc"}:
        files = gdown.download_folder(MISC_FOLDER, skip_download=True, quiet=True)
        for f in files:
            name = os.path.basename(f.path)
            dest = os.path.join(a.out, "misc", name)
            r = gdown_file(f.id, dest)
            r["folder"] = MISC_FOLDER
            rec[f"misc/{name}"] = r
    if want & {"nafnet"}:
        rec["nafnet/NAFNet-GoPro-width64.pth"] = gdown_file(NAFNET_GOPRO64, os.path.join(a.out, "nafnet", "NAFNet-GoPro-width64.pth"))
    if want & {"nafnet-reds"}:
        rec["nafnet/NAFNet-REDS-width64.pth"] = gdown_file(NAFNET_REDS64, os.path.join(a.out, "nafnet", "NAFNet-REDS-width64.pth"))
    print(json.dumps(rec, indent=1))
    json.dump(rec, open(os.path.join(a.out, "weights.json"), "w"), indent=1)


def cmd_zoo(a):
    os.makedirs(a.out, exist_ok=True)
    dest = os.path.join(a.out, os.path.basename(ZOO_PATH))
    url = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{ZOO_COMMIT}/{ZOO_PATH}"
    subprocess.run(["curl", "-fsSL", "--retry", "4", "-o", dest, url], check=True)
    h = sha256(dest)
    if h != ZOO_SHA:
        raise SystemExit(f"{dest}: SHA-256 {h}, expected {ZOO_SHA}")
    rec = {"url": url, "commit": ZOO_COMMIT, "bytes": os.path.getsize(dest), "sha256": h}
    print(json.dumps(rec))
    json.dump(rec, open(os.path.join(a.out, "zoo.json"), "w"), indent=1)


def cmd_realblur(a):
    """Stream one RealBlur archive from Hugging Face (pinned dataset commit) and keep only the pairs in --list."""
    want = set()
    for line in open(a.list):
        p = line.split()
        if len(p) >= 2:
            want.update(p[:2])
    os.makedirs(a.out, exist_ok=True)
    url = f"{HF}/datasets/{a.repo}/resolve/{a.rev}/{a.archive}"
    print(f"streaming {url}; keeping {len(want)} files", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "lightbench-unblur-spike"})
    kept = 0
    d = hashlib.sha256()
    total = 0

    class Tee:
        def __init__(self, r):
            self.r = r

        def read(self, n=-1):
            nonlocal total
            b = self.r.read(n)
            d.update(b)
            total += len(b)
            return b

    with urllib.request.urlopen(req, timeout=120) as r:
        tee = Tee(r)
        with tarfile.open(fileobj=tee, mode="r|*") as tf:
            for m in tf:
                name = m.name
                # Archive members may carry a leading folder; match on the list's relative path suffix.
                hit = next((w for w in want if name.endswith(w)), None)
                if hit and m.isfile():
                    dest = os.path.join(a.out, hit)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with tf.extractfile(m) as src, open(dest, "wb") as dst:
                        dst.write(src.read())
                    kept += 1
                    if kept == len(want) and a.stop_early:
                        break
        # Read the rest so the archive's SHA-256 covers the whole file (unless stopped early).
        if not a.stop_early:
            while tee.read(1 << 20):
                pass
    rec = {"url": url, "archive": a.archive, "kept": kept, "wanted": len(want), "bytesRead": total,
           "sha256": d.hexdigest() if not a.stop_early else None}
    print(json.dumps(rec))
    json.dump(rec, open(os.path.join(a.out, f"{os.path.basename(a.archive)}.json"), "w"), indent=1)
    if kept < len(want):
        missing = sorted(w for w in want if not os.path.exists(os.path.join(a.out, w)))[:10]
        print(f"::warning::kept {kept} of {len(want)}; first missing {missing}")


def main():
    p = argparse.ArgumentParser()
    s = p.add_subparsers(dest="cmd", required=True)
    q = s.add_parser("probe")
    q.add_argument("--out")
    q = s.add_parser("weights")
    q.add_argument("--out", required=True)
    q.add_argument("--which", default="misc,nafnet")
    q = s.add_parser("zoo")
    q.add_argument("--out", required=True)
    q = s.add_parser("realblur")
    q.add_argument("--repo", default="rimchang/RealBlur")
    q.add_argument("--rev", required=True)
    q.add_argument("--archive", required=True)
    q.add_argument("--list", required=True)
    q.add_argument("--out", required=True)
    q.add_argument("--stop-early", action="store_true")
    a = p.parse_args()
    {"probe": cmd_probe, "weights": cmd_weights, "zoo": cmd_zoo, "realblur": cmd_realblur}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
