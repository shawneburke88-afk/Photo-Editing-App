"""AI Denoise feasibility spike (docs/AI_DENOISE_SPIKE.md): download the public inputs on GitHub's runner and record
where they came from (URL, size, SHA-256). Nothing downloaded here is committed.

  probe      what the sources offer, without big downloads: the authors' Google Drive folder of weights, the RawNIND
             record on the UCLouvain Dataverse (licence and terms, verbatim; the file list), raw.pixls.us listings
  weights    the RawNIND Bayer checkpoint from the authors' Google Drive folder
  dataverse  files of the RawNIND dataset, each given as NAME=REGEX (the first match by name)
  pixls      files from raw.pixls.us/data/<path>
  dtmodel    darktable-ai's rawdenoise-nind.dtmodel (release-5.6.0), SHA-256 checked, unzipped

Run with `python -I`; every downloaded file goes into its own directory (--out).
"""
import argparse
import hashlib
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request

DRIVE_FOLDER = "https://drive.google.com/drive/folders/12Uc5sT4OWx02sviUS_boDk1zDSDRVorw"
DOI = "doi:10.14428/DVN/DEQCIM"
DATAVERSE = "https://dataverse.uclouvain.be"
PIXLS = "https://raw.pixls.us"
DTMODEL_URL = "https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel"
DTMODEL_SHA = "d71b5f1e727c85a359e6f74dca9e2016c9d8fc3e2f7ac3e9b347d80ceca969af"
UA = {"User-Agent": "Mozilla/5.0 (research script)"}


def sha256(path):
    d = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            d.update(b)
    return d.hexdigest()


def get(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def download(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, open(path, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    print(f"{os.path.basename(path)}: {os.path.getsize(path)} B, sha256 {sha256(path)}, from {url}", flush=True)
    return path


def strip_tags(s):
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def dataverse_meta():
    return json.loads(get(f"{DATAVERSE}/api/datasets/:persistentId/?persistentId={DOI}"))["data"]


def cmd_probe(a):
    print("== Google Drive folder of pre-trained models (upstream README) ==", flush=True)
    try:
        import gdown

        files = gdown.download_folder(DRIVE_FOLDER, skip_download=True, quiet=True)
        for f in files:
            print(f"  {f.id}  {f.path}")
        print(f"  {len(files)} files listed (gdown lists at most 50 per folder)")
    except Exception as e:  # noqa: BLE001
        print("  drive listing failed:", repr(e))

    print("== UCLouvain Dataverse record ==", flush=True)
    try:
        d = dataverse_meta()
        lv = d["latestVersion"]
        for k in ("persistentUrl", "publicationDate", "storageIdentifier"):
            print(f"  {k}: {d.get(k)}")
        for k in ("versionNumber", "versionMinorNumber", "versionState", "releaseTime", "license", "termsOfUse", "termsOfAccess", "confidentialityDeclaration",
                  "specialPermissions", "restrictions", "citationRequirements", "depositorRequirements", "conditions", "disclaimer", "dataAccessPlace",
                  "originalArchive", "availabilityStatus", "contactForAccess", "fileAccessRequest"):
            if k in lv:
                print(f"  latestVersion.{k}: {json.dumps(lv[k], ensure_ascii=False)}")
        for blk, v in lv.get("metadataBlocks", {}).items():
            for f in v.get("fields", []):
                if f["typeName"] in ("title", "dsDescription", "author", "notesText", "otherId", "publication", "dateOfDeposit", "keyword", "subject", "depositor", "producer", "distributor", "relatedMaterial"):
                    print(f"  {blk}.{f['typeName']}: {json.dumps(f['value'], ensure_ascii=False)[:3000]}")
        files = lv["files"]
        total = sum(f["dataFile"].get("filesize", 0) for f in files)
        print(f"  files: {len(files)}, total {total / 1e9:.1f} GB")
        exts = {}
        dirs = {}
        for f in files:
            n = f["dataFile"]["filename"]
            exts[n.rsplit(".", 1)[-1].lower()] = exts.get(n.rsplit(".", 1)[-1].lower(), 0) + 1
            dl = f.get("directoryLabel", "")
            dirs[dl] = dirs.get(dl, 0) + 1
        print("  extensions:", exts)
        print("  directories:", len(dirs), list(dirs.items())[:40])
        pat = re.compile(a.grep) if a.grep else None
        n = 0
        for f in files:
            df = f["dataFile"]
            if pat is None or pat.search((f.get("directoryLabel", "") + "/" + df["filename"])):
                print(f"   {df['id']}\t{df.get('filesize')}\t{f.get('directoryLabel', '')}/{df['filename']}\t{(df.get('checksum') or {}).get('value')}")
                n += 1
                if n >= a.max_files:
                    break
        if a.out:
            json.dump([{"id": f["dataFile"]["id"], "name": f["dataFile"]["filename"], "dir": f.get("directoryLabel", ""), "size": f["dataFile"].get("filesize"),
                        "checksum": f["dataFile"].get("checksum")} for f in files], open(a.out, "w"))
    except Exception as e:  # noqa: BLE001
        print("  dataverse API failed:", repr(e))
    try:
        page = get(f"{DATAVERSE}/dataset.xhtml?persistentId={DOI}").decode("utf-8", "replace")
        text = strip_tags(page)
        for key in ("License/Data Use Agreement", "Terms of Use", "Waiver", "CC0", "CC BY", "Creative Commons", "Custom Dataset Terms", "Terms of Access"):
            for m in re.finditer(re.escape(key), text):
                print(f"  page text near '{key}': …{text[max(0, m.start() - 200):m.start() + 500]}…")
                break
    except Exception as e:  # noqa: BLE001
        print("  dataverse page failed:", repr(e))

    print("== raw.pixls.us ==", flush=True)
    for path in a.pixls:
        try:
            page = get(f"{PIXLS}/data/{urllib.parse.quote(path)}").decode("utf-8", "replace")
            names = re.findall(r'href="([^"?][^"]*)"', page)
            print(f"  /data/{path}: {[n for n in names if not n.startswith('/') and n != '../']}")
        except Exception as e:  # noqa: BLE001
            print(f"  /data/{path}: failed {e!r}")
    try:
        page = strip_tags(get(PIXLS + "/").decode("utf-8", "replace"))
        for key in ("CC0", "license", "licence", "public domain"):
            for m in re.finditer(key, page, flags=re.I):
                print(f"  front page near '{key}': …{page[max(0, m.start() - 300):m.start() + 400]}…")
                break
    except Exception as e:  # noqa: BLE001
        print("  front page failed:", repr(e))


def cmd_weights(a):
    import gdown

    os.makedirs(a.out, exist_ok=True)
    files = gdown.download_folder(DRIVE_FOLDER, skip_download=True, quiet=True)
    want = re.compile(a.match)
    picked = [f for f in files if want.search(f.path)]
    print(f"{len(files)} files in the folder listing; {len(picked)} match /{a.match}/")
    for f in picked:
        dst = os.path.join(a.out, f.path)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        gdown.download(id=f.id, output=dst, quiet=True)
        print(f"{f.path}: Drive file id {f.id}, {os.path.getsize(dst)} B, sha256 {sha256(dst)}", flush=True)
    if not picked:
        for f in files:
            print("  ", f.path)
        sys.exit("no file matched")


def cmd_dataverse(a):
    """Each argument is NAME=REGEX: the first file (sorted by name) whose name matches is saved as NAME + its extension."""
    d = dataverse_meta()
    files = sorted(d["latestVersion"]["files"], key=lambda f: f["dataFile"]["filename"])
    for spec in a.names:
        name, rx = spec.split("=", 1)
        hits = [f for f in files if re.search(rx, f["dataFile"]["filename"])]
        if not hits:
            sys.exit(f"{rx} matches nothing in the dataset")
        df = hits[0]["dataFile"]
        ext = df["filename"].rsplit(".", 1)[-1]
        dst = os.path.join(a.out, f"{name}.{ext}")
        if os.path.exists(dst):
            continue
        p = download(f"{DATAVERSE}/api/access/datafile/{df['id']}", dst)
        cs = df.get("checksum") or {}
        print(f"  = {df['filename']} (dataverse file id {df['id']}, {len(hits)} match(es), {cs.get('type')} {cs.get('value')}, md5 here {hashlib.md5(open(p, 'rb').read()).hexdigest()})", flush=True)


def cmd_pixls(a):
    for path in a.paths:
        download(f"{PIXLS}/data/{urllib.parse.quote(path)}", os.path.join(a.out, os.path.basename(path)))


def cmd_dtmodel(a):
    import zipfile

    p = download(DTMODEL_URL, os.path.join(a.out, "rawdenoise-nind.dtmodel"))
    if sha256(p) != DTMODEL_SHA:
        sys.exit("rawdenoise-nind.dtmodel: SHA-256 mismatch")
    with zipfile.ZipFile(p) as z:
        z.extractall(a.out)
    for root, _, fs in os.walk(a.out):
        for f in fs:
            if f.endswith(".onnx"):
                q = os.path.join(root, f)
                print(f"{f}: {os.path.getsize(q)} B, sha256 {sha256(q)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("probe")
    s.add_argument("--grep", default="")
    s.add_argument("--max-files", type=int, default=60)
    s.add_argument("--pixls", nargs="*", default=["", "Nikon/", "Nikon/D5200/"])
    s.add_argument("--out", default="")
    s = sub.add_parser("weights")
    s.add_argument("--out", required=True)
    s.add_argument("--match", default=r"bayer")
    s = sub.add_parser("dataverse")
    s.add_argument("--out", required=True)
    s.add_argument("names", nargs="+")
    s = sub.add_parser("pixls")
    s.add_argument("--out", required=True)
    s.add_argument("paths", nargs="+")
    s = sub.add_parser("dtmodel")
    s.add_argument("--out", required=True)
    a = ap.parse_args()
    {"probe": cmd_probe, "weights": cmd_weights, "dataverse": cmd_dataverse, "pixls": cmd_pixls, "dtmodel": cmd_dtmodel}[a.cmd](a)
