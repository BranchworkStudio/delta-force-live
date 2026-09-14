# Loadouts data

What produced `docs/data/loadouts.json`. `.github/workflows/loadouts.yml` runs both of these
every morning and commits the result, so the hand-run below is for adding a creator, changing a
parser, or checking what the job would do.

```bash
./fetch.sh        # downloads into ./raw and ../../docs/img/creators (rate-limited, under a minute)
python3 build.py  # writes ../../docs/data/loadouts.json
```

Everything fetched is a page a creator publishes themselves — one entry per page in
`creators.json`, read by `own.py`. The aggregators that used to be read as well (rnkd.gg,
deltaforcetools.gg) were dropped: see the root README under **Loadouts** for why.

`fetch.sh` also writes `guns.json` (the weapon names from the official manifest) and downloads
each creator's avatar into `docs/img/creators/<id>.png` — from the build page's own payload where
it has one, otherwise the `og:image` of the first channel they list, and failing that decapi.me's
Twitch lookup, since Twitch serves that `og:image` to a browser and not always to us. The answer
from that last one is used only if it is a `static-cdn.jtvnw.net` URL and nothing else: a third
party in this path may pick the size of a picture, never the host it comes from. All three are
asked for 150px. An avatar already on disk is never re-fetched; delete the file to refresh it.

`build.py` applies the three rules in the root README under **Loadouts**: a build needs a
creator and a link back, codes are copied as published and never verified here, and a weapon
the manifest does not have is dropped — which is also what keeps mobile and CN builds out,
since their codes do not import into the global PC game.

Because it runs unattended it can also refuse its own output. It writes nothing when the rebuilt
file is identical to the one on disk — `updated` then stays where it was, because re-reading the
same pages is not an update — and it exits non-zero rather than writing a file with no builds in
it, or one that lost more than a third of them. Both are what a page answering with a login wall
or a redesign looks like from here.

`raw/` (the saved pages) is not committed; regenerating it is the point of `fetch.sh`. The
avatars are committed, because they are part of what the page shows.

## The creators' own pages

`creators.json` is the list of pages a creator publishes themselves, and `own.py` reads them.
One entry per page:

| Field | What |
|---|---|
| `id` | the creator slug, used for the source and creator ids in the built file |
| `name` / `source` | the person, and the name of the page they publish — `source` is the card's link text, so keep it in the creator's own terms ("Leissik's build doc") |
| `parser` | `lines` for a text dump (a Google Doc exported as text), `dfbuild` for a `deltaforce.build/<name>` page, `sheet` for a Google Sheet read as CSV, `medow` for medowmafia.com's builds page |
| `fetch` / `page` | what `fetch.sh` downloads, and the human URL every card links to |
| `ext` | the extension the download is saved with, under `raw/own/` |
| `links` | their channels, when the page itself does not carry them (a `dfbuild` page does) |
| `mode` | only for a page that does not say: `poach` publishes bare codes with a Hazard Operations price on every row, so those are recorded as Operations |
| `cols` | `sheet` only, and only for a sheet that has a real header row: `{"code": "Share code", "note": "Build name"}` names the creator's own columns so they are read rather than guessed at |

`sheet` is the one to reach for when a creator keeps their builds in a Google Sheet. It reads two
shapes. Give it `cols` and it finds the header row and reads the columns named in it, which is
right whenever the sheet has one: RogueMonkeyJr's leads with a weapon-class column, and the
columnless read below would have called every build of his "AR". Leave `cols` out and it falls
back to the original read, which is worth knowing what it does *not* assume. No sheet agrees with another on columns — code beside
the name, or a price or a "Meta" marker in between; one long list, or four class columns side by
side — so it reads no columns at all. Any cell that is a code is a build; the cells immediately
left of it, up to the first blank or the previous build's code, are what its maker wrote about it,
the leftmost being their name for it and anything between a tag. A row whose only cell says
`Operations` or `Warfare` sets the mode below it, which is how a sheet of bare codes says which
game its builds are for. A qualifier every build on a page carries is dropped rather than shown:
"Meta" on all 52 of them tells nobody anything.

Either shape drops a code that hands the build to somebody else — `…C0LGG (Larry)`,
`…C0LGG(SomeKindaDog)` — and counts it in the skip list by the name it credits. A creator who
keeps a few of other people's builds on their page is crediting them in the only place a
spreadsheet has, and that credit is a name with nothing to link to, which is the one build this
file does not publish; re-attributing it would be worse, since we cannot ask the person whose
name is in the brackets. Twelve of Minda999's are dropped this way. The mode is parenthesised on
some sheets too, so the code is always matched first: `Operations (Extraction Mode)` is the
game's name for a mode, not a person.

A creator who publishes on a page nobody else uses needs a parser of their own, which is the only
part of adding one that is ever real work: `parse_medow` is thirty lines because that page keeps
its table in a JS literal with the CN client's codes in the same rows — and those are dropped,
since a CN code does not import into the global game.

One thing `collect()` does to every row, whatever parsed it: the price goes through `price()`,
so a card carries it once and in one shape (`~1500k` → `~1.5M`, `$250k` → `250K`). A creator who
keeps the price in the build's name rather than a column of its own has it moved to the tag, and
a name that repeats a price the row already gives loses it. Nothing else about a row's wording is
changed.

Adding a creator is adding an entry. A row whose weapon cannot be identified from the code or
the label is dropped and counted in the skip list rather than guessed at, and no more than
three builds per gun per mode are kept from any one page — a budget build and a full build are
two different answers, ten variants of the same rifle are not.
