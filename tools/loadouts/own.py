"""The builds that come from the creators' own pages, rather than from an aggregator.

creators.json is the hand-kept list: one entry per page a creator publishes themselves, with the
parser that page needs. Adding a creator is adding an entry there — nothing else in here is
per-person. Four parsers cover what exists today:

  lines    a plain-text dump (a Google Doc exported as text) where a code sits on its own line,
           usually under the creator's own heading for it
  dfbuild  a deltaforce.build/<name> page, a Next.js app that ships the creator's sheet as JSON
           inside the server payload
  sheet    a Google Sheet the creator published, read as CSV — by the names in its header row
           when the entry gives `cols`, and otherwise with no assumption about columns at all
  medow    medowmafia.com's builds page, whose table is a JS literal carrying the global and the
           CN client's code for the same build side by side

Weapon and mode come from the code itself when the creator published the whole string, and from
the row's label when they published only the tail — see weapon_of(). A row whose weapon cannot
be identified is dropped rather than guessed at, and so is a code a creator credits to somebody
else — see CREDITED.
"""
import re, csv, io, json, os, html as H, datetime, collections

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw', 'own', '')

CODE = re.compile(r'^(.*?)-(Operations \(Extraction Mode\)|Operations|Warfare)-([A-Z0-9]{15,})\s*$')
BARE = re.compile(r'^[A-Z0-9]{18,24}$')
# A code with somebody else's name after it: "…C0LGG (Larry)", "…C0LGG(SomeKindaDog)". A creator
# who keeps a few of other people's builds on their page is crediting them in the only place a
# spreadsheet has to do it in, and that credit is a name with nothing behind it — which is the one
# build this file does not publish. So these are dropped rather than re-attributed: the rule is a
# creator *and* a link back, and a name in brackets is half of one. The mode is parenthesised too
# on some sheets, which is why CODE is always tried first: "Operations (Extraction Mode)" is the
# game's own name for a mode, not a person.
CREDITED = re.compile(r'^(.*?)\s*\(([^()]{1,40})\)\s*$')


def credited_to(cell):
    """Who a cell hands the build to, when it is a code with a name after it. None otherwise."""
    m = CREDITED.match(cell)
    if not m: return None
    return m.group(2).strip() if (CODE.match(m.group(1)) or BARE.match(m.group(1))) else None


# The same class words build.py strips, but also without the space in front: a creator typing the
# code by hand drops it often enough ("VSSMarksmanRifle-Operations-…") to be worth handling.
CLASS = (r'(Assault Rifle|Compact Assault Rifle|Submachine Gun|Sniper Rifle|Marksman Rifle|Battle Rifle|'
         r'General Machine Gun|Light Machine Gun|Machine Gun|Shotgun|Pistol|Revolver|Carbine)')
# Not "Bow": the manifest's only bow is called "Compound Bow", so the word is the name, not a class.
TAIL = re.compile(r'\s*' + CLASS + r'\s*$', re.I)
NTAIL = re.compile(re.sub(r'[ |]', lambda m: '' if m.group() == ' ' else '|', CLASS).lower() + '$')


def norm(s): return re.sub(r'[^a-z0-9]', '', (s or '').lower())


# A few names the community uses that the game does not. Everything else matches on the name
# itself, so this list only ever grows by one when a creator calls a gun something new.
ALIAS = {'tommy': 'Thompson SMG', 'thompson': 'Thompson SMG', 'marlin': 'Lever-action Rifle',
         'leveraction': 'Lever-action Rifle', 'marlinleveractionrifle': 'Lever-action Rifle',
         'barrett': 'M82', 'barret': 'M82', 'scar': 'SCAR-H',
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


# What a gun is, rather than what this build of it is. Creators write these beside the name
# ("MDR Assault Rifle", "AS Val AR") and the tab already groups by gun, so as a note they are empty.
CLASSES = set("ar smg lmg br dmr smr pistol shotgun sniper bow crossbow assaultrifle "
              "compactassaultrifle submachinegun lightmachinegun generalmachinegun machinegun "
              "battlerifle marksmanrifle sniperrifle".split())


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
    if norm(t) in ('', 'build', 'newbuild', 'new') or norm(t) in CLASSES: return ''
    if norm(t) and norm(t) in norm(gun): return ''      # "Bow" under Compound Bow says nothing new
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


PRICE = re.compile(r'^\s*(~?)\s*(\d+(?:[.,]\d+)?)\s*([kKmM])\s*$')
# The price is the one fact most of these pages carry, and no two write it the same way: "580K",
# "~1500k", "$250k", "1.2M", or nothing but the build's name ("300k beam"). collect() puts every
# one of them through this, so a card carries the number once, in one shape: under a million in K,
# above it in M, and the creator's "~" kept, because the hedge is theirs.
MONEY = re.compile(r'(?i)(~)?\s*\$?\s*(\d+(?:[.,]\d+)?)\s*(k|m|mil|million)\b\.?')


def price(text):
    """'~1500k' -> '~1.5M', '$250k' -> '250K'. None when there is no price in it."""
    m = MONEY.search(text or '')
    if not m: return None
    k = float(m.group(2).replace(',', '.')) * (1000 if m.group(3).lower().startswith('m') else 1)
    return (m.group(1) or '') + (('%.1f' % (k / 1000)).rstrip('0').rstrip('.') + 'M' if k >= 1000
                                 else '%g' % k + 'K')


def parse_headed(rows, guns, cfg, cols):
    """A sheet that has a real header row, read by the names in it rather than by position.

    Worth doing whenever there is one. The columnless read below has to guess that the cell
    furthest left is what the creator called the build, and on a sheet that leads with a weapon
    class it guesses wrong — nobody named their build "AR". A header says which column is which,
    so it is read instead of guessed at. `cols` maps our field to the creator's own column name."""
    want = {k: v.strip().lower() for k, v in cols.items()}
    at, head = None, None
    for i, row in enumerate(rows):
        low = [c.strip().lower() for c in row]
        if all(v in low for v in want.values()):
            at, head = i, {k: low.index(v) for k, v in want.items()}
            break
    if head is None:
        return [dict(drop='header row not found (%s)' % ', '.join(sorted(want.values())))]
    out = []
    for row in rows[at + 1:]:
        cell = lambda k: row[head[k]].strip() if k in head and head[k] < len(row) else ''
        code = cell('code')
        if not code: continue
        m = CODE.match(code)
        if not m and not BARE.match(code):
            who = credited_to(code)
            out.append(dict(drop='credited to ' + who) if who else dict(skip=code[:40]))
            continue
        label = cell('note')
        g = weapon_of(guns, m.group(1) if m else '', label)
        if not g:
            out.append(dict(skip=label or code)); continue
        out.append(dict(weapon=g,
                        mode='warfare' if (m and m.group(2) == 'Warfare') else
                             ('operations' if m else cfg.get('mode', 'operations')),
                        code=code, note=clean_label(label, g), added=None, tags=[]))
    return out


def parse_sheet(txt, guns, cfg):
    """A Google Sheet the creator published, read as CSV. These have nothing in common with each
    other — code beside the name, or a price or a "Meta" marker in between; one long list, or four
    class columns side by side — so this assumes no columns at all. A cell that is a code is a
    build, and the cells immediately left of it, up to the first blank or the previous build's
    code, are what its maker wrote about it: the leftmost is their name for it, anything between
    is a tag. A row whose only cell is "Operations" or "Warfare" sets the mode for everything
    below it, which is how a sheet of bare codes says which game they are for."""
    rows = list(csv.reader(io.StringIO(txt)))
    if cfg.get('cols'): return parse_headed(rows, guns, cfg, cfg['cols'])
    mode = cfg.get('mode', 'operations')
    out = []
    for row in rows:
        cells = [c.strip() for c in row]
        filled = [c for c in cells if c]
        if len(filled) == 1 and filled[0].lower() in ('operations', 'warfare'):
            mode = filled[0].lower()
            continue
        for i, c in enumerate(cells):
            m = CODE.match(c)
            if not m and not BARE.match(c):
                who = credited_to(c)
                if who: out.append(dict(drop='credited to ' + who))
                continue
            run = []
            for j in range(i - 1, -1, -1):
                # A credited code still ends the previous build, even though it is not kept as one.
                # Without this the walk runs straight through it into the column before, and a build
                # ends up wearing the name of somebody else's.
                if not cells[j] or CODE.match(cells[j]) or BARE.match(cells[j]) or credited_to(cells[j]): break
                run.append(cells[j])
            label = run[-1] if run else ''
            tags = []
            for t in reversed(run[:-1]):
                p = PRICE.match(t)
                if p: tags.append(p.group(1) + p.group(2) + p.group(3).upper())
                elif len(t) <= 12: tags.append(t)
            g = weapon_of(guns, m.group(1) if m else '', label)
            if not g:
                out.append(dict(skip=label or c)); continue
            out.append(dict(weapon=g,
                            mode='warfare' if (m and m.group(2) == 'Warfare') else ('operations' if m else mode),
                            code=c, note=clean_label(label, g), added=None, tags=tags))
    kept = [b for b in out if 'skip' not in b and 'drop' not in b]
    for t in {t for b in kept for t in b['tags'] if not PRICE.match(t)}:
        if all(t in b['tags'] for b in kept):       # "Meta" on all 52 of them tells nobody anything
            for b in kept: b['tags'].remove(t)
    return out


def parse_medow(txt, guns, cfg):
    """medowmafia.com ships its whole table as one JS literal — [class, weapon, label, code, rough
    price, the same build's code for the CN client] — with a toolbar above it that switches
    clients. Only the global code is read: a CN code does not import into the game this board is
    about, and the two sit in the same row precisely because they are not interchangeable."""
    i = txt.find('const RAW = [')
    if i < 0: return []
    rows = json.loads(txt[i + len('const RAW = '):txt.index('\n', i)].rstrip().rstrip(';'))
    out = []
    for r in rows:
        code = (r[3] or '').strip()
        m = CODE.match(code)
        if not m: continue
        g = weapon_of(guns, m.group(1), r[1] or '')
        if not g:
            out.append(dict(skip=r[1])); continue
        price = re.match(r'^\s*(~?)\s*(\d+(?:\.\d+)?)\s*([kKmM])\s*$', r[4] or '')
        out.append(dict(weapon=g, mode='warfare' if m.group(2) == 'Warfare' else 'operations',
                        code=code, note=clean_label(r[2], g), added=None,
                        tags=[price.group(1) + price.group(2) + price.group(3).upper()] if price else []))
    return out


PARSER = {'lines': parse_lines, 'dfbuild': parse_dfbuild, 'sheet': parse_sheet, 'medow': parse_medow}
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
            if r.get('drop'):
                skipped[cfg['id'] + ' ' + r['drop']] += 1
                continue
            if r.get('skip') is not None:
                skipped[cfg['id'] + ' unknown weapon: ' + str(r['skip'])] += 1
                continue
            if r['code'] in seen: skipped[cfg['id'] + ' duplicate code'] += 1; continue
            if per[(r['weapon'], r['mode'])] >= PER_GUN:
                skipped[cfg['id'] + ' more than %d per gun' % PER_GUN] += 1
                continue
            seen.add(r['code']); per[(r['weapon'], r['mode'])] += 1; kept += 1
            # One price, in one shape, in one place. A page that keeps it in a column of its own
            # has it as a tag already; Leissik's is the whole name of the build ("300k beam") and
            # moves there, and where a name repeats a price the column also gives, the name loses
            # it — SammyMedows calls one build "$500k" in a row whose price column says ~350k, and
            # a card printing both is worse than a card printing the field he maintains.
            tags = [price(t) or t for t in r['tags']]
            note, p = r['note'] or '', price(r['note'])
            if p:
                if not any(price(t) for t in tags): tags = [p] + tags
                note = re.sub(r'\s+', ' ', MONEY.sub('', note).replace('$', '')).strip(' -–—/,·')
            builds.append(dict(weapon=r['weapon'], mode=r['mode'], creator=cfg['id'],
                               source=cfg['id'], code=r['code'], url=cfg['page'], added=r['added'],
                               note=note, tags=tags))
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
