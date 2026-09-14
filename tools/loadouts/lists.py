"""Parse the saved listing pages into lists.json: one row per build with whatever the listing
itself shows. The import codes live on the detail pages, which build.py reads."""
import os, re, codecs, json, glob, html
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')

def blobof(p):
    s = open(p, encoding='utf8', errors='ignore').read()
    return "".join(codecs.decode(c.encode(), 'unicode_escape', errors='ignore')
                   for c in re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', s, re.S))

rows = {}
for p in sorted(glob.glob(os.path.join(RAW, 'dft_*.html'))):
    b = blobof(p)
    for m in re.finditer(r'"gun":\{"id":"?\$n(\d+)"?,(.{0,1200}?)"build_code":"(.*?)"(.{0,600}?)(?:\}|"spidertime")', b, re.S):
        bid, body, code, tail = m.groups()
        f = lambda k, src=body: (re.search(r'"%s":"(.*?)"' % k, src) or [None, None])[1]
        cp = re.search(r'"copy_count":"?\$n(\d+)', tail) or re.search(r'"copy_count":(\d+)', tail)
        cr = re.search(r'"created_at":"\$D([0-9\-]+)', tail)
        # the visible tag chips sit just before the object in the payload
        pre = b[max(0, m.start()-2200):m.start()]
        tags = [t for t in re.findall(r'"children":"([A-Z][A-Za-z \-]{2,24})"\}', pre)
                if t in ("Meta Build", "Recommended Build", "Long-Range", "Close-Range", "Mid-Range",
                         "High Burst", "High Stability", "All-Rounder", "Best Value", "Sustained Fire",
                         "High Handling", "Assault", "Engineer", "Support", "Recon")]
        rows[("dft", bid)] = {"src": "deltaforcetools", "id": bid, "name": f("build_name"), "mode": f("game_mode"),
            "type": f("weapon_type"), "weapon": f("weapon"), "author": f("author"), "code": code,
            "copies": int(cp.group(1)) if cp else 0, "created": cr.group(1) if cr else None,
            "tags": sorted(set(tags)), "url": "https://deltaforcetools.gg/weapon-builds/" + bid}

for p in sorted(glob.glob(os.path.join(RAW, 'rnkd_*.html'))):
    s = open(p, encoding='utf8', errors='ignore').read()
    idx = [(m.start(), m.group(1)) for m in re.finditer(r'href="/deltaforce/builds/(\d+)"', s)]
    for k, (pos, bid) in enumerate(idx):
        blk = s[(idx[k-1][0] if k else max(0, pos-3500)):pos]
        t = [html.unescape(x.strip()) for x in re.sub(r'<[^>]+>', '\n', re.sub(r'<script.*?</script>', '', blk, flags=re.S)).split('\n') if x.strip()]
        mode = next((x for x in t if x in ("Havoc Warfare", "Hazard Operations")), None)
        by = next((x[3:].strip() for x in t if x.startswith("by ")), None)
        if not (mode and by): continue
        j = t.index(mode)
        head = [x for x in t[:j] if x not in ("Windows", "Android", "iOS")]
        marks = next((int(x) for x in reversed(head) if x.isdigit()), 0)
        head = [x for x in head if not x.isdigit()]
        if not head: continue
        rows[("rnkd", bid)] = {"src": "rnkd", "id": bid, "weapon": head[-2] if len(head) > 1 else head[-1],
            "tags": [head[-1]] if len(head) > 1 else [], "mode": mode, "author": by, "marks": marks,
            "level": next((x for x in t if x.startswith("Level ")), None),
            "url": "https://rnkd.gg/deltaforce/builds/" + bid}

out = list(rows.values())
json.dump(out, open(os.path.join(HERE, "lists.json"), "w"), indent=1)
print("total", len(out))
for src in ("deltaforcetools", "rnkd"):
    sub = [r for r in out if r["src"] == src]
    print(src, len(sub), "| authors", Counter(r["author"] for r in sub).most_common(10))
