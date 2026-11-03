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


class RangeFile:
    """A read-only, seekable file over HTTP Range requests (to read single members of a huge zip on Hugging Face)."""

    def __init__(self, url):
        self.url = url
        self.pos = 0
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "lightbench-unblur-spike"})
        with urllib.request.urlopen(req, timeout=60) as r:
            self.size = int(r.headers["Content-Length"])
            self.final = r.url
        self.fetched = 0

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + n) - 1
        req = urllib.request.Request(self.final, headers={"Range": f"bytes={self.pos}-{end}", "User-Agent": "lightbench-unblur-spike"})
        for i in range(5):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    b = r.read()
                break
            except Exception:  # noqa: BLE001
                if i == 4:
                    raise
        self.pos += len(b)
        self.fetched += len(b)
        return b


def cmd_list_tar(a):
    url = f"{HF}/datasets/{a.repo}/resolve/{a.rev}/{a.archive}"
    req = urllib.request.Request(url, headers={"User-Agent": "lightbench-unblur-spike"})
    n = 0
    total = 0
    dirs = {}
    with urllib.request.urlopen(req, timeout=120) as r, tarfile.open(fileobj=r, mode="r|*") as tf:
        for m in tf:
            n += 1
            total += m.size
            if n <= a.head:
                print(f"{m.size:>12} {m.name}")
            top = "/".join(m.name.split("/")[:a.depth])
            dirs[top] = dirs.get(top, 0) + 1
    print(json.dumps({"members": n, "bytes": total, "dirs": dirs}, indent=1)[:20000])


def cmd_list_zip(a):
    import zipfile
    url = f"{HF}/datasets/{a.repo}/resolve/{a.rev}/{a.archive}"
    rf = RangeFile(url)
    z = zipfile.ZipFile(rf)
    infos = z.infolist()
    print(f"{a.archive}: {rf.size:,} bytes, {len(infos)} members; central directory read with {rf.fetched:,} bytes")
    for i in infos[: a.head]:
        print(f"{i.file_size:>12} {i.compress_type} {i.filename}")


def cmd_rsblur(a):
    """Read only the listed pairs out of RSBlur.zip (Hugging Face, pinned commit) with HTTP Range requests."""
    import zipfile
    want = []
    for line in open(a.list):
        p = line.split()
        if len(p) >= 2:
            want += p[:2]
    url = f"{HF}/datasets/{a.repo}/resolve/{a.rev}/{a.archive}"
    rf = RangeFile(url)
    z = zipfile.ZipFile(rf)
    names = {i.filename: i for i in z.infolist()}
    os.makedirs(a.out, exist_ok=True)
    kept = 0
    for w in want:
        hit = w if w in names else next((n for n in names if n.endswith(w)), None)
        if not hit:
            print(f"::warning::{w} not in {a.archive}")
            continue
        dest = os.path.join(a.out, w)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with z.open(hit) as src, open(dest, "wb") as dst:
            dst.write(src.read())
        kept += 1
    rec = {"url": url, "archiveBytes": rf.size, "kept": kept, "wanted": len(want), "bytesFetched": rf.fetched}
    print(json.dumps(rec))
    json.dump(rec, open(os.path.join(a.out, "rsblur.json"), "w"), indent=1)


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
    for name in ["list-tar", "list-zip"]:
        q = s.add_parser(name)
        q.add_argument("--repo", default="rimchang/RealBlur")
        q.add_argument("--rev", required=True)
        q.add_argument("--archive", required=True)
        q.add_argument("--head", type=int, default=60)
        q.add_argument("--depth", type=int, default=2)
    q = s.add_parser("rsblur")
    q.add_argument("--repo", default="rimchang/RSBlur")
    q.add_argument("--rev", required=True)
    q.add_argument("--archive", default="RSBlur.zip")
    q.add_argument("--list", required=True)
    q.add_argument("--out", required=True)
    a = p.parse_args()
    {"probe": cmd_probe, "weights": cmd_weights, "zoo": cmd_zoo, "realblur": cmd_realblur, "list-tar": cmd_list_tar,
     "list-zip": cmd_list_zip, "rsblur": cmd_rsblur}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
