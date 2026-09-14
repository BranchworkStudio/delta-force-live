"""The builds that come from the creators' own pages, rather than from an aggregator.

creators.json is the hand-kept list: one entry per page a creator publishes themselves, with the
parser that page needs. Adding a creator is adding an entry there — nothing else in here is
per-person. Two parsers cover what exists today:

  lines    a plain-text dump (a Google Doc exported as text) where a code sits on its own line,
           usually under the creator's own heading for it
  dfbuild  a deltaforce.build/<name> page, a Next.js app that ships the creator's sheet as JSON
           inside the server payload

Weapon and mode come from the code itself when the creator published the whole string, and from
the row's label when they published only the tail — see weapon_of(). A row whose weapon cannot
be identified is dropped rather than guessed at.
"""
import re, json, os, html as H, datetime, collections

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw', 'own', '')

CODE = re.compile(r'^(.*?)-(Operations \(Extraction Mode\)|Operations|Warfare)-([A-Z0-9]{15,})\s*$')
BARE = re.compile(r'^[A-Z0-9]{18,24}$')
# The same class words build.py strips, but also without the space in front: a creator typing the
# code by hand drops it often enough ("VSSMarksmanRifle-Operations-…") to be worth handling.
CLASS = (r'(Assault Rifle|Compact Assault Rifle|Submachine Gun|Sniper Rifle|Marksman Rifle|Battle Rifle|'
         r'General Machine Gun|Light Machine Gun|Machine Gun|Shotgun|Pistol|Revolver|Carbine|Crossbow|Bow)')
TAIL = re.compile(r'\s*' + CLASS + r'\s*$', re.I)
NTAIL = re.compile(re.sub(r'[ |]', lambda m: '' if m.group() == ' ' else '|', CLASS).lower() + '$')


def norm(s): return re.sub(r'[^a-z0-9]', '', (s or '').lower())


# A few names the community uses that the game does not. Everything else matches on the name
# itself, so this list only ever grows by one when a creator calls a gun something new.
ALIAS = {'tommy': 'Thompson SMG', 'thompson': 'Thompson SMG', 'marlin': 'Lever-action Rifle',
         'leveraction': 'Lever-action Rifle', 'barrett': 'M82', 'barret': 'M82', 'scar': 'SCAR-H',
         'mcx': 'MCX LT', 'qjb': 'QJB201', 'qcq': 'QCQ171', 'qbz': 'QBZ95-1', 'val': 'AS Val',
         'revolver': '.357', 'bow': 'Compound Bow', 'deagle': 'Desert Eagle'}


def weapon_of(guns, prefix, label):
    """The gun this row is about, or None. The code's own prefix is trusted first; a label is only
    read for the guns whose names actually appear in it, longest name first so "M700" is not read
    as "M7" and "MK47" is not read as "MK4"."""
    gkey = {norm(g): g for g in guns}
    for c in (prefix or '',):
        c = TAIL.sub('', re.sub(r'\(.*?\)', '', c)).strip()
        k = NTAIL.sub('', norm(c))
        if k in gkey: return gkey[k]
        if k in ALIAS: return ALIAS[k]
    k = norm(label)
    hit = [g for g in guns if norm(g) and norm(g) in k]
    if hit: return max(hit, key=lambda g: len(norm(g)))
    hit = [a for a in ALIAS if a in k]
    return ALIAS[max(hit, key=len)] if hit else None


def clean_label(t, gun):
    """The creator's own name for the build, with the gun's name taken out of it — the card already
    says which gun this is, and what is left is the part worth reading: "( High Tier )", "budget",
    "red dot/cqc". Empty when the label was only the gun."""
    t = re.sub(r'\s+', ' ', H.unescape(t or '')).strip()
    # The gun as the creator might have typed it: same letters and digits, any separators.
    for name in [gun] + [a for a, g in ALIAS.items() if g == gun]:
        pat = r'[^A-Za-z0-9]*'.join(re.escape(p) for p in re.findall(r'[A-Za-z0-9]+', name))
        if pat: t = re.sub(r'\b' + pat + r'\b', ' ', t, flags=re.I)
    t = re.sub(r'\(\s*\)|\[\s*\]', '', t)
    t = re.sub(r'\s+', ' ', t).strip(' -–—/,')
    if re.fullmatch(r'\(([^()]*)\)', t): t = t[1:-1].strip()     # the whole label was parenthesised
    if t.count('(') != t.count(')'): t = t.replace('(', '').replace(')', '').strip()
    if norm(t) in ('', 'build', 'newbuild', 'new'): return ''
    return t[:60]


def iso(s):
    for f in ('%m/%d/%Y', '%m/%d/%y'):
        try: return datetime.datetime.strptime(s.strip(), f).date().isoformat()
        except ValueError: pass
    return None


def parse_lines(txt, guns, cfg):
    """A text dump. A line that is a code is a build; the nearest line above it that is not a code
    and not a season heading is what the creator called it."""
    out, season, label = [], None, ''
    for raw in txt.splitlines():
        line = raw.replace('﻿', '').strip()
        m = CODE.match(line)
        if not m:
            s = re.match(r'^S(\d+)\b.*CODES\s*$', line, re.I)
            if s: season, label = 'Season ' + s.group(1), ''
            elif line and not line.startswith('http') and len(line) < 80: label = line
            continue
        g = weapon_of(guns, m.group(1), label)
        if not g:
            out.append(dict(skip=m.group(1))); label = ''; continue
        out.append(dict(weapon=g, mode='warfare' if m.group(2) == 'Warfare' else 'operations',
                        code=line, note=clean_label(label, g), added=None,
                        tags=[season] if season else []))
        label = ''
    return out


def parse_dfbuild(txt, guns, cfg):
    """deltaforce.build renders <name>'s sheet from JSON embedded in the page. Read that rather
    than the markup: it is the creator's own table, with their heading, price and last-changed
    date per row."""
    h = txt.replace('\\"', '"')
    i = h.find('"sheets":')
    if i < 0: return []
    k, depth = i + len('"sheets":'), 0
    for n in range(k, len(h)):
        if h[n] == '{': depth += 1
        elif h[n] == '}':
            depth -= 1
            if not depth: break
    sheets = json.loads(h[k:n + 1])
    out = []
    for rows in sheets.values():
        for r in rows:
            code = (r.get('buildCode') or '').strip()
            m = CODE.match(code)
            if not m and not BARE.match(code): continue
            g = weapon_of(guns, m.group(1) if m else '', r.get('type') or '')
            if not g:
                out.append(dict(skip=r.get('type'))); continue
            price = re.match(r'^\s*(\d+(?:\.\d+)?)\s*([kKmM])\s*$', r.get('price') or '')
            out.append(dict(weapon=g,
                            mode='warfare' if (m and m.group(2) == 'Warfare') else
                                 ('operations' if m else cfg.get('mode', 'operations')),
                            code=code, note=clean_label(r.get('type'), g),
                            added=iso(r.get('changesMade') or ''),
                            tags=[price.group(1) + price.group(2).upper()] if price else []))
    return out


def avatar_url(txt):
    """The creator's own profile picture, if the page carries one. deltaforce.build stores the
    Twitch avatar in its payload; everything else is looked up from the creator's channel by
    fetch.sh, which is the half of this that needs the network."""
    m = re.search(r'"avatar":"(https?://[^"]+)"', txt.replace('\\"', '"'))
    return m.group(1) if m else None


PARSER = {'lines': parse_lines, 'dfbuild': parse_dfbuild}
SOCIAL = ('twitch', 'youtube', 'twitter', 'tiktok', 'kick', 'discord')


def socials(txt):
    """The links a deltaforce.build page carries for its owner. They are in the payload as plain
    fields, which is better than scraping every <a> on the page and hoping none of them is an ad."""
    h = txt.replace('\\"', '"')
    out = []
    for k in SOCIAL:
        m = re.search(r'"' + k + r'":"(https?://[^"]+)"', h)
        if m: out.append(m.group(1))
    return out


# Several codes for the same gun from the same person is the point (a budget one and a full one),
# a page-load of near-identical variants is not.
PER_GUN = 3


def collect(guns):
    """-> (sources, creators, builds, skipped), in the shape docs/data/loadouts.json wants."""
    sources, creators, builds, skipped = {}, {}, [], collections.Counter()
    for cfg in json.load(open(os.path.join(HERE, 'creators.json'))):
        f = RAW + cfg['id'] + '.' + cfg['ext']
        if not os.path.exists(f):
            skipped['not fetched: ' + cfg['id']] += 1
            continue
        txt = open(f, encoding='utf8', errors='replace').read()
        rows = PARSER[cfg['parser']](txt, guns, cfg)
        links = list(cfg.get('links') or [])
        if cfg['parser'] == 'dfbuild': links += [u for u in socials(txt) if u not in links]
        seen, per = set(), collections.Counter()
        kept = 0
        for r in rows:
            if r.get('skip') is not None:
                skipped[cfg['id'] + ' unknown weapon: ' + str(r['skip'])] += 1
                continue
            if r['code'] in seen: skipped[cfg['id'] + ' duplicate code'] += 1; continue
            if per[(r['weapon'], r['mode'])] >= PER_GUN:
                skipped[cfg['id'] + ' more than %d per gun' % PER_GUN] += 1
                continue
            seen.add(r['code']); per[(r['weapon'], r['mode'])] += 1; kept += 1
            builds.append(dict(weapon=r['weapon'], mode=r['mode'], creator=cfg['id'],
                               source=cfg['id'], code=r['code'], url=cfg['page'], added=r['added'],
                               popularity=0, level=None, att=[], note=r['note'], tags=r['tags']))
        if not kept: continue
        sources[cfg['id']] = dict(name=cfg['source'], url=cfg['page'], kind='creator')
        creators[cfg['id']] = dict(name=cfg['name'], url=cfg['page'], links=links, kind='creator')
    return sources, creators, builds, skipped


if __name__ == '__main__':
    guns = json.load(open(os.path.join(HERE, 'guns.json')))
    s, c, b, sk = collect(guns)
    print('sources', list(s), 'builds', len(b))
    print(collections.Counter(x['creator'] for x in b))
    print(collections.Counter(x['mode'] for x in b))
    print('skips', sk.most_common(20))
