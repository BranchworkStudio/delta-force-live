"""Turn the pages fetch.sh downloaded into docs/data/loadouts.json. See ../../README.md,
"Loadouts", for the three rules this applies and why.

Two kinds of page feed this file. The aggregators (rnkd.gg, deltaforcetools.gg) are read here;
the pages the creators run themselves are read by own.py, and merged in below — those are the
ones the tab puts first, because a build on its maker's own page is the build they stand behind."""
import re, json, glob, html as H, datetime, collections, os
import own
HERE=os.path.dirname(os.path.abspath(__file__))
D=os.path.join(HERE,'raw','')                                   # what fetch.sh downloaded
OUT=os.path.join(HERE,'..','..','docs','data','loadouts.json')  # what the tab reads
GUNS=json.load(open(os.path.join(HERE,'guns.json')))
TAIL=re.compile(r'\s+(Assault Rifle|Compact Assault Rifle|Submachine Gun|Sniper Rifle|Marksman Rifle|Battle Rifle|General Machine Gun|Light Machine Gun|Machine Gun|Shotgun|Pistol|Revolver|Carbine|Crossbow|Bow)\s*$',re.I)
def norm(s): return re.sub(r'[^a-z0-9]','',(s or '').lower())
GKEY={norm(g):g for g in GUNS}
def match(*cands):
    for c in cands:
        if not c: continue
        c=re.sub(r'\(.*?\)','',c).strip()
        c=TAIL.sub('',c).strip()
        k=norm(c)
        if k in GKEY: return GKEY[k]
    return None
def demoji(t):
    """Some of the scraped pages were served as UTF-8 and read as latin-1 somewhere upstream, which
    turns a name like "Oláh" into "OlÃ¡h". Undo that where it round-trips cleanly, leave it alone
    where it does not — a creator's name is the one thing on this page that must be right."""
    try:
        f=t.encode('latin-1').decode('utf-8')
        return f if 'Ã' in t or 'Â' in t else t
    except (UnicodeEncodeError,UnicodeDecodeError):
        return t
def sq(s): return demoji(re.sub(r'\s+',' ',H.unescape(s or '')).strip())

EMOJI=re.compile('[\U0001F000-\U0001FAFF\u2190-\u2BFF\uFE0F\u200d]')
LANG=re.compile(r'\b(EN|FR|RU|ES|PT|DE|IT|PL|TR|BR|CN|JP|KR)\s*:',re.I)
def clean_note(t):
    """The site's description field is a free-text box: some of it is a real sentence about the
    build, and some of it is the same paste-instruction repeated in six languages, or a second
    import code in prose. Keep the first clause of prose and throw the rest away — a card that
    lies about what it is showing is worse than a card with no note."""
    t=sq(t or '')
    t=EMOJI.sub('',t)
    t=re.sub(r'^Description\s*[:\-]?\s*','',t,flags=re.I)
    m=LANG.search(t)
    if m: t=t[:m.start()]
    if re.search(r'(steam|garena)\s*:',t,re.I) or 'http' in t.lower(): return ''
    t=sq(t)
    if len(t)>170: t=t[:167].rsplit(' ',1)[0]+'…'
    return t if len(t)>6 else ''

# ---- rnkd detail pages ----
det=[]
for f in sorted(glob.glob(D+'detail/*.html')):
    h=open(f,encoding='utf8',errors='replace').read()
    bid=f.split('/')[-1][:-5]
    def one(p):
        m=re.search(p,h,re.S); return sq(m.group(1)) if m else None
    r=dict(id=bid,
      mode=one(r'Game Mode</dt>\s*<dd[^>]*>(.*?)</dd>'),
      platform=one(r'Platform</dt>\s*<dd[^>]*>(.*?)</dd>'),
      weapon=re.sub(r'<[^>]+>','',one(r'Weapon</dt>\s*<dd[^>]*>(.*?)</dd>') or '').strip() or None,
      level=one(r'Required Weapon Level</dt>\s*<dd[^>]*>(.*?)</dd>'),
      code=one(r'class="share-code[^"]*">(.*?)</span>'),
      copies=one(r'copyCount:\s*(\d+)'),
      creator=one(r'<a href="/profile/[^"]+"[^>]*>(.*?)</a>'),
      profile=one(r'<a href="(/profile/[^"]+)"'),
      created=one(r'Created ([A-Z][a-z]{2} \d{1,2}, \d{4})'),
      desc=one(r'<p class="text-rnkd-gray-lighter whitespace-pre-line">(.*?)</p>'))
    ab=re.search(r'Attachments</dt>(.*?)(?:<!-- Share Code|Share Code</dt>)',h,re.S)
    r['att']=[[sq(m.group(1)),sq(m.group(2))] for m in re.finditer(r'<span class="text-sm text-rnkd-gray-lighter">([^<]+)</span>.*?<span>([^<]+)</span>',ab.group(1),re.S)] if ab else []
    det.append(r)

# ---- creator profiles ----
prof={}
for f in glob.glob(D+'prof/*.html'):
    h=open(f,encoding='utf8',errors='replace').read()
    slug=f.split('/')[-1][:-5]
    links=set()
    for m in re.finditer(r'href="(https?://(?:www\.)?(twitch\.tv|youtube\.com|youtu\.be|x\.com|twitter\.com|discord\.gg|discord\.com|kick\.com|tiktok\.com|instagram\.com)/[^"]+)"',h):
        links.add(m.group(1))
    prof[slug]=sorted(links)
# A link that sits on every profile belongs to the site, not to the person whose page it is on.
_seen=collections.Counter(l for v in prof.values() for l in v)
prof={k:[l for l in v if _seen[l]<3] for k,v in prof.items()}

MODE={'Havoc Warfare':'warfare','Hazard Operations':'operations'}
def iso(s):
    try: return datetime.datetime.strptime(s,'%b %d, %Y').strftime('%Y-%m-%d')
    except: return None

builds=[]; creators={}; skipped=collections.Counter()
CODE=re.compile(r'-([A-Z0-9]{15,})\s*$')
for r in det:
    if r['platform']!='Windows': skipped['not PC']+=1; continue
    if not r['code'] or not CODE.search(r['code']): skipped['no import code']+=1; continue
    pre=r['code'].rsplit('-',2)[0]
    g=match(pre,r['weapon'])
    if not g: skipped['unknown weapon: '+str(r['weapon'])]+=1; continue
    house = (not r['creator']) or r['creator'] in ('RNKD.gg','Admin')
    slug = 'rnkd' if house else (r['profile'] or '').rsplit('/',1)[-1]
    if not slug: skipped['no creator at all']+=1; continue
    creators.setdefault(slug, dict(name='rnkd.gg' if house else r['creator'],
        url='https://rnkd.gg/deltaforce/builds/' if house else 'https://rnkd.gg/profile/'+slug,
        links=[] if house else prof.get(slug,[]), **({'kind':'site'} if house else {})))
    note=clean_note(r['desc'])
    builds.append(dict(weapon=g,mode=MODE.get(r['mode'],'both'),creator=slug,source='rnkd',
      code=r['code'],url='https://rnkd.gg/deltaforce/builds/'+r['id'],
      added=iso(r['created']),popularity=int(r['copies'] or 0),
      level=int(r['level']) if (r['level'] or '').isdigit() else None,
      att=r['att'],note=note,tags=[]))

# ---- deltaforcetools ----
sc=json.load(open(os.path.join(HERE,'lists.json')))
for r in sc:
    if r['src']!='deltaforcetools': continue
    if not r.get('code') or not CODE.search(r['code']): skipped['dft no code']+=1; continue
    g=match(r['code'].rsplit('-',2)[0],r.get('weapon'))
    if not g: skipped['dft unknown weapon: '+str(r.get('weapon'))]+=1; continue
    who=demoji(r.get('author') or '')
    slug='deltaforcetools' if who.startswith('deltaforcetools') else 'dft:'+norm(who)
    if slug not in creators:
        creators[slug]=dict(name='deltaforcetools.gg' if slug=='deltaforcetools' else who,
                            url='https://deltaforcetools.gg/weapon-builds', links=[],
                            kind='site' if slug=='deltaforcetools' else 'community')
    builds.append(dict(weapon=g,mode=MODE.get(r.get('mode'),'both'),creator=slug,source='dft',
      code=r['code'],url=r.get('url'),added=r.get('created'),popularity=int(r.get('copies') or 0),
      level=None,att=[],note='',tags=r.get('tags') or []))

# ---- the creators' own pages ----
own_sources,own_creators,own_builds,own_skipped=own.collect(GUNS)
creators.update(own_creators); skipped.update(own_skipped)

# one build per (weapon, mode, creator): keep the most copied. This is an aggregator problem —
# the same build reposted by the same person — and own.py does its own thinning, so the builds
# from a creator's own page skip it: a budget MP7 and a 350k MP7 are two different answers.
best={}
for b in builds:
    k=(b['weapon'],b['mode'],b['creator'])
    if k not in best or b['popularity']>best[k]['popularity']: best[k]=b
builds=sorted(list(best.values())+own_builds,key=lambda b:(b['weapon'],-b['popularity']))
creators={k:v for k,v in creators.items() if any(b['creator']==k for b in builds)}

doc=dict(updated=datetime.date.today().isoformat(),
  sources=dict({'rnkd':dict(name='rnkd.gg',url='https://rnkd.gg/deltaforce/builds/',kind='aggregator'),
                'dft':dict(name='deltaforcetools.gg',url='https://deltaforcetools.gg/weapon-builds',kind='aggregator')},
               **own_sources),
  creators=creators,builds=builds)
os.makedirs(os.path.dirname(OUT),exist_ok=True)
json.dump(doc,open(OUT,'w'),indent=1,ensure_ascii=False)
print('builds',len(builds),'creators',len(creators),'weapons',len({b['weapon'] for b in builds}),'/',len(GUNS))
print('by source',collections.Counter(b['source'] for b in builds))
print("from creators' own pages",sum(1 for b in builds if doc['sources'][b['source']].get('kind')=='creator'))
print('by mode',collections.Counter(b['mode'] for b in builds))
print('named-creator builds',sum(1 for b in builds if b['creator'] not in ('deltaforcetools',)))
print('with attachments',sum(1 for b in builds if b['att']))
print('skips',skipped.most_common(12))
print('size',os.path.getsize(OUT))
