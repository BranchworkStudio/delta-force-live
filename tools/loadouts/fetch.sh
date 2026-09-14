#!/bin/zsh
# Download the pages docs/data/loadouts.json is built from, into ./raw.
#
# Polite by construction and meant to stay that way: one request at a time, 0.7 s apart, and a user
# agent that says who is asking. Nothing here is scheduled — it is run by hand when the file is
# refreshed. Everything fetched here is a page a creator publishes themselves; the aggregators that
# used to be read as well are gone, see build.py.
set -e
cd "$(dirname "$0")"
UA="DeltaForceLive/1.0 (personal dashboard; +https://github.com/BranchworkStudio/delta-force-live)"
mkdir -p raw/own ../../docs/img/creators
# --fail matters more than it looks: unattended, a 404 body saved as if it were the page is how a
# build list quietly turns into nothing.
get () { [ -s "$2" ] || curl -sS --fail --retry 2 -m 25 -A "$UA" "$1" -o "$2"; python3 -c 'import time;time.sleep(.7)'; }

# The weapon spine, so build.py can drop a build whose weapon the game does not have.
get "https://www.playdeltaforce.com/basic_info/guns_en.js" raw/guns_en.js
python3 - <<'PY'
import json, re, os
s = open('raw/guns_en.js', encoding='utf8').read()
d = json.loads(s[s.index('{'):].rstrip().rstrip(';'))
tail = re.compile(r'\s+(Assault Rifle|Compact Assault Rifle|Submachine Gun|Sniper Rifle|Marksman Rifle|'
                  r'Battle Rifle|General Machine Gun|Light Machine Gun|Machine Gun|Shotgun|Pistol|'
                  r'Revolver|Carbine)\s*$', re.I)   # not Bow: \"Compound Bow\" is a whole name
names = sorted({tail.sub('', g['language']['en']).strip() for g in d['guns']})
json.dump(names, open('guns.json', 'w'), indent=1)
print('guns', len(names))
PY

# The creators' own pages, one per entry in creators.json. A Google Doc needs the redirect
# followed to its export host, which is the only reason this is not the same get() as above.
python3 -c 'import json;print("\n".join(c["id"]+" "+c["ext"]+" "+c["fetch"] for c in json.load(open("creators.json"))))' | while read id ext url; do [ -s "raw/own/$id.$ext" ] || curl -sSL --fail --retry 2 -m 40 -A "$UA" "$url" -o "raw/own/$id.$ext"; python3 -c 'import time;time.sleep(.7)'; done

# Their faces. The build page itself carries one when the creator signed in with Twitch; otherwise
# it is the og:image of the first channel they list, which is the same picture. Stored on our own
# site rather than hotlinked: a CDN URL rotates, and a visitor should not have to call Twitch to
# see who wrote a build.
python3 - <<'PY'
import json, os, re, time, urllib.request
import own
UA = 'DeltaForceLive/1.0 (personal dashboard; +https://github.com/BranchworkStudio/delta-force-live)'
BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
OUT = os.path.join('..', '..', 'docs', 'img', 'creators')

def read(url, ua):
    r = urllib.request.Request(url, headers={'User-Agent': ua})
    with urllib.request.urlopen(r, timeout=25) as f: return f.read()

for cfg in json.load(open('creators.json')):
    if any(os.path.exists(os.path.join(OUT, cfg['id'] + '.' + e)) for e in ('png', 'jpg', 'webp')): continue
    f = os.path.join('raw', 'own', cfg['id'] + '.' + cfg['ext'])
    url = own.avatar_url(open(f, encoding='utf8', errors='replace').read()) if os.path.exists(f) else None
    for link in (cfg.get('links') or []):                      # a channel page, for the rest
        if url: break
        if not re.search(r'twitch\.tv|youtube\.com', link): continue
        try: html = read(link, BROWSER).decode('utf8', 'replace')
        except Exception as e: print('  ', cfg['id'], link, e); continue
        m = re.search(r'<meta property="og:image" content="([^"]+)"', html)
        if m: url = m.group(1)
        time.sleep(.7)
    # Twitch serves that og:image to a browser and not to us, often enough that EqualPlays had no
    # face for a day. decapi.me answers a channel name with the CDN URL of the same picture, so it
    # is asked last, and only believed when what comes back is a Twitch CDN URL and nothing else —
    # a third party in this path may pick the size of an image, never the host it comes from.
    for link in ([] if url else (cfg.get('links') or [])):
        m = re.match(r'https?://(?:www\.)?twitch\.tv/([A-Za-z0-9_]{2,25})/?$', link)
        if not m: continue
        try: ans = read('https://decapi.me/twitch/avatar/' + m.group(1), UA).decode('utf8', 'replace').strip()
        except Exception as e: print('  ', cfg['id'], 'decapi', e); continue
        if re.fullmatch(r'https://static-cdn\.jtvnw\.net/jtv_user_pictures/[\w./-]+', ans): url = ans
        time.sleep(.7)
        break
    if not url: print('  no avatar for', cfg['id']); continue
    # Both CDNs size on request, and the card shows the face at 30px: ask for 150, not 600.
    url = re.sub(r'-profile_image-\d+x\d+', '-profile_image-150x150', url)
    url = re.sub(r'=s\d+-', '=s150-', url)
    ext = 'jpg' if re.search(r'\.jpe?g(\?|$)', url) else 'webp' if '.webp' in url else 'png'
    try: data = read(url, UA)
    except Exception as e: print('  ', cfg['id'], 'avatar', e); continue
    if data[:4] == b'\xff\xd8\xff\xe0' or data[:3] == b'\xff\xd8\xff': ext = 'jpg'
    elif data[:8] == b'\x89PNG\r\n\x1a\n': ext = 'png'
    elif data[8:12] == b'WEBP': ext = 'webp'
    open(os.path.join(OUT, cfg['id'] + '.' + ext), 'wb').write(data)
    print('  avatar', cfg['id'], len(data), 'bytes', ext)
    time.sleep(.7)
PY

echo "fetched: $(ls raw/own | wc -l) creator pages, $(ls ../../docs/img/creators | wc -l) avatars — now run: python3 build.py"
