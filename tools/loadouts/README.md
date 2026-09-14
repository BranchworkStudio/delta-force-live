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
each creator's avatar into `docs/img/creators/<id>.png` — from the build page's own payload
where it has one, otherwise the `og:image` of the first channel they list, asked for at 150px.
An avatar already on disk is never re-fetched; delete the file to refresh it.

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
| `parser` | `lines` for a text dump (a Google Doc exported as text), `dfbuild` for a `deltaforce.build/<name>` page |
| `fetch` / `page` | what `fetch.sh` downloads, and the human URL every card links to |
| `ext` | the extension the download is saved with, under `raw/own/` |
| `links` | their channels, when the page itself does not carry them (a `dfbuild` page does) |
| `mode` | only for a page that does not say: `poach` publishes bare codes with a Hazard Operations price on every row, so those are recorded as Operations |

Adding a creator is adding an entry. A row whose weapon cannot be identified from the code or
the label is dropped and counted in the skip list rather than guessed at, and no more than
three builds per gun per mode are kept from any one page — a budget build and a full build are
two different answers, ten variants of the same rifle are not.
