#!/bin/zsh
# Download the pages docs/data/loadouts.json is built from, into ./raw.
#
# Polite by construction and meant to stay that way: one request at a time, 0.7 s apart, a user
# agent that says who is asking, and only the listing and build pages each site's robots.txt
# allows. Nothing here is scheduled — it is run by hand when the file is refreshed.
set -e
cd "$(dirname "$0")"
UA="DeltaForceLive/1.0 (personal dashboard; +https://github.com/BranchworkStudio/delta-force-live)"
mkdir -p raw/detail raw/prof raw/own
get () { [ -s "$2" ] || curl -sS -m 25 -A "$UA" "$1" -o "$2"; python3 -c 'import time;time.sleep(.7)'; }

# The weapon spine, so build.py can drop a build whose weapon the game does not have.
get "https://www.playdeltaforce.com/basic_info/guns_en.js" raw/guns_en.js
python3 - <<'PY'
import json, re, os
s = open('raw/guns_en.js', encoding='utf8').read()
d = json.loads(s[s.index('{'):].rstrip().rstrip(';'))
tail = re.compile(r'\s+(Assault Rifle|Compact Assault Rifle|Submachine Gun|Sniper Rifle|Marksman Rifle|'
                  r'Battle Rifle|General Machine Gun|Light Machine Gun|Machine Gun|Shotgun|Pistol|'
                  r'Revolver|Carbine|Crossbow|Bow)\s*$', re.I)
names = sorted({tail.sub('', g['language']['en']).strip() for g in d['guns']})
json.dump(names, open('guns.json', 'w'), indent=1)
print('guns', len(names))
PY

# The creators' own pages, one per entry in creators.json. A Google Doc needs the redirect
# followed to its export host, which is the only reason this is not the same get() as below.
python3 -c 'import json;print("\n".join(c["id"]+" "+c["ext"]+" "+c["fetch"] for c in json.load(open("creators.json"))))' | while read id ext url; do [ -s "raw/own/$id.$ext" ] || curl -sSL -m 40 -A "$UA" "$url" -o "raw/own/$id.$ext"; python3 -c 'import time;time.sleep(.7)'; done

# Listings. Both sites paginate; stop when a page stops adding builds.
for i in $(seq 1 16); do get "https://deltaforcetools.gg/weapon-builds?page=$i" raw/dft_$i.html; done
for i in $(seq 1 24); do get "https://rnkd.gg/deltaforce/builds?page=$i"          raw/rnkd_$i.html; done

python3 lists.py

# The import code only exists on the build page, and the creator's own channels only on their
# profile, so both are a second pass over what the listings found.
python3 - <<'PY'
import json, os
rows = json.load(open('lists.json'))
open('ids.txt', 'w').write('\n'.join(r['id'] for r in rows if r['src'] == 'rnkd'))
PY
while read id; do get "https://rnkd.gg/deltaforce/builds/$id" raw/detail/$id.html; done < ids.txt
python3 - <<'PY'
import glob, re, json
slugs = set()
for f in glob.glob('raw/detail/*.html'):
    m = re.search(r'<a href="/profile/([^"]+)"', open(f, encoding='utf8', errors='replace').read())
    if m: slugs.add(m.group(1))
open('profiles.txt', 'w').write('\n'.join(sorted(slugs)))
PY
while read p; do get "https://rnkd.gg/profile/$p" raw/prof/$p.html; done < profiles.txt

echo "fetched: $(ls raw/detail | wc -l) builds, $(ls raw/prof | wc -l) profiles, $(ls raw/own | wc -l) creator pages — now run: python3 build.py"
