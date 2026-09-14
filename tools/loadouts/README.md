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

`raw/` is not committed. It is a few hundred saved pages and regenerating it is the point
of `fetch.sh`.
