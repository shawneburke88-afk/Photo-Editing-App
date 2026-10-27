"""Finds one public-domain photo of trees against the sky on Wikimedia Commons, for the Sky check (docs/PHASE3.md Part 29).

  python -I commons_photo.py --out DIR

Run by the "AI models" workflow on GitHub's runner (this build machine can't reach Wikimedia). It asks the Commons API
for photos matching a few fixed searches, keeps the first JPEG (in search order) whose licence Commons gives as public
domain or CC0 and that is at least 1000 pixels wide, downloads Commons' 1280-pixel copy of it, and writes DIR/trees.png
and DIR/trees.json: the file's title and page, the licence and author as Commons states them, the URLs and the SHA-256 of
what was downloaded, so the photo, its source and its licence are recorded with the run. Nothing is committed. Exit 0
even when none is found (the check then runs on the committed photos only).
"""

import argparse
import hashlib
import html
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

API = "https://commons.wikimedia.org/w/api.php"
UA = "LightBench-sky-check/1.0 (https://github.com/shawneburke88-afk/Photo-Editing-App; GitHub Actions)"
SEARCHES = [
    "bare tree branches against blue sky",
    "tree silhouette sky",
    "trees against the sky",
]
PD = re.compile(r"^(public domain|pd\b|pd-|cc0|cc-zero)", re.I)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def plain(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


found = None
tried = []
for q in SEARCHES:
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": f"{q} filetype:bitmap",
        "gsrnamespace": "6",
        "gsrlimit": "40",
        "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata|sha1",
        "iiurlwidth": "1280",
    }
    try:
        data = json.loads(get(f"{API}?{urllib.parse.urlencode(params)}"))
    except Exception as e:  # noqa: BLE001
        tried.append({"search": q, "error": repr(e)[:200]})
        continue
    pages = sorted((data.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 1e9))
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata") or {}
        lic = plain((meta.get("LicenseShortName") or {}).get("value"))
        code = plain((meta.get("License") or {}).get("value"))
        ok = ii.get("mime") == "image/jpeg" and ii.get("width", 0) >= 1000 and (PD.match(lic) or PD.match(code))
        tried.append({"search": q, "title": p.get("title"), "licence": lic, "mime": ii.get("mime"), "width": ii.get("width"), "used": bool(ok)})
        if ok:
            found = (p, ii, meta, lic, code, q)
            break
    if found:
        break

if not found:
    json.dump({"found": False, "tried": tried}, open(os.path.join(a.out, "trees.json"), "w"), indent=1)
    print("COMMONS no public-domain photo found")
    sys.exit(0)

p, ii, meta, lic, code, q = found
thumb = ii.get("thumburl") or ii["url"]
raw = get(thumb)
from PIL import Image  # noqa: E402

img = Image.open(io.BytesIO(raw)).convert("RGB")
png = os.path.join(a.out, "trees.png")
img.save(png)
rec = {
    "found": True,
    "search": q,
    "title": p.get("title"),
    "page": ii.get("descriptionurl"),
    "original": ii.get("url"),
    "originalSize": [ii.get("width"), ii.get("height")],
    "originalSha1": ii.get("sha1"),
    "downloaded": thumb,
    "downloadedBytes": len(raw),
    "downloadedSha256": hashlib.sha256(raw).hexdigest(),
    "png": "trees.png",
    "pngSize": list(img.size),
    "pngSha256": hashlib.sha256(open(png, "rb").read()).hexdigest(),
    "licence": lic,
    "licenceCode": code,
    "usageTerms": plain((meta.get("UsageTerms") or {}).get("value")),
    "artist": plain((meta.get("Artist") or {}).get("value"))[:300],
    "credit": plain((meta.get("Credit") or {}).get("value"))[:300],
    "description": plain((meta.get("ImageDescription") or {}).get("value"))[:300],
    "tried": tried,
}
json.dump(rec, open(os.path.join(a.out, "trees.json"), "w"), indent=1)
print("COMMONS", json.dumps({k: v for k, v in rec.items() if k != "tried"}))
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary:
    with open(summary, "a") as f:
        f.write(f"\n### The trees-against-the-sky photo\n\n[{rec['title']}]({rec['page']}) on Wikimedia Commons: licence as Commons gives it: **{lic}** ({code}); author: {rec['artist'] or '?'}. Downloaded {thumb} ({len(raw)} bytes, SHA-256 `{rec['downloadedSha256']}`), {img.size[0]} × {img.size[1]}.\n\n")
