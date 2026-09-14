# Loadouts data

What produced `docs/data/loadouts.json`. Run it when the tab's builds need refreshing —
by hand, not on a schedule.

```bash
./fetch.sh      # downloads into ./raw (rate-limited, ~10 minutes)
python3 build.py  # writes ../../docs/data/loadouts.json
```

`fetch.sh` also writes `guns.json` (the weapon names from the official manifest) and
`lists.json` (one row per build as the listing shows it); `build.py` reads both plus the
saved build and profile pages, and applies the three rules in the root README under
**Loadouts**: a build needs a creator and a link back, codes are copied as published and
never verified here, and a weapon the manifest does not have is dropped — which is also
what keeps mobile and CN builds out, since their codes do not import into the global PC game.

`raw/` (the saved pages, including `raw/own/`) is not committed. It is a few hundred saved pages and regenerating it is the point
of `fetch.sh`.

## The creators' own pages

`creators.json` is the list of pages a creator publishes themselves, and `own.py` reads them.
One entry per page:

| Field | What |
|---|---|
| `id` | the creator slug, used for the source and creator ids in the built file |
| `name` / `source` | the person, and the name of the page they publish |
| `parser` | `lines` for a text dump (a Google Doc exported as text), `dfbuild` for a `deltaforce.build/<name>` page |
| `fetch` / `page` | what `fetch.sh` downloads, and the human URL every card links to |
| `ext` | the extension the download is saved with, under `raw/own/` |
| `links` | their channels, when the page itself does not carry them (a `dfbuild` page does) |
| `mode` | only for a page that does not say: `poach` publishes bare codes with a Hazard Operations price on every row, so those are recorded as Operations |

Adding a creator is adding an entry. A row whose weapon cannot be identified from the code or
the label is dropped and counted in the skip list rather than guessed at, and no more than
three builds per gun per mode are kept from any one page — a budget build and a full build are
two different answers, ten variants of the same rifle are not.
