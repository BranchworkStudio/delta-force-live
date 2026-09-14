"""Turn the creator pages fetch.sh downloaded into docs/data/loadouts.json.

Every build in this file comes from a page its maker runs themselves — a doc, a build site of
their own. The aggregators that collect other people's builds were read here once and are not any
more: they carried four times the volume and a fraction of the value, most of it undated, uncredited
or reposted, and a list you cannot trust is worse than a shorter one you can. own.py does the
reading, creators.json is the list of pages, and this file is only the assembly.
"""
import json, os, datetime, collections
import own

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'docs', 'data', 'loadouts.json')
IMG = os.path.join(HERE, '..', '..', 'docs', 'img', 'creators')
GUNS = json.load(open(os.path.join(HERE, 'guns.json')))

sources, creators, builds, skipped = own.collect(GUNS)

# The avatars fetch.sh downloaded. A face beside the name is the whole point of crediting someone,
# but a missing file must not break the card, so the field is only set when the file is there.
for cid, c in creators.items():
    for ext in ('png', 'jpg', 'webp'):
        if os.path.exists(os.path.join(IMG, cid + '.' + ext)):
            c['avatar'] = 'img/creators/%s.%s' % (cid, ext)
            break

builds.sort(key=lambda b: (b['weapon'], b['creator'], b['code']))
body = dict(sources=sources, creators=creators, builds=builds)

# This runs unattended every morning, so it has to be able to refuse its own output. A creator's
# page that answers with a login wall, an error page or an empty sheet parses to nothing at all,
# and a green run that quietly empties the tab is the one failure mode worth spending code on.
old = json.load(open(OUT)) if os.path.exists(OUT) else None
if not builds:
    raise SystemExit('refusing to write: no builds parsed at all — a page is down or has changed shape')
if old and len(builds) < 0.6 * len(old['builds']):
    raise SystemExit('refusing to write: %d builds, down from %d. Check the pages by hand.'
                     % (len(builds), len(old['builds'])))

# `updated` is the day the builds last actually changed, not the day this last ran. Re-reading the
# same pages and finding the same thing is not an update, and a date that moves every morning
# would say the opposite on a page that had not changed in a month.
if old and all(old.get(k) == v for k, v in body.items()):
    print('no change —', len(builds), 'builds, still as of', old.get('updated'))
    raise SystemExit(0)
doc = dict(updated=datetime.date.today().isoformat(), **body)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(doc, open(OUT, 'w'), indent=1, ensure_ascii=False)
print('builds', len(builds), 'creators', len(creators), 'weapons', len({b['weapon'] for b in builds}), '/', len(GUNS))
print('by creator', collections.Counter(b['creator'] for b in builds))
print('by mode', collections.Counter(b['mode'] for b in builds))
print('with a date', sum(1 for b in builds if b['added']), 'with a note', sum(1 for b in builds if b['note']))
print('avatars', sum(1 for c in creators.values() if c.get('avatar')), '/', len(creators))
print('skips', skipped.most_common(12))
print('size', os.path.getsize(OUT))
