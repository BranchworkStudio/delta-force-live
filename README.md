# Delta Force Live

A live squad tracker for **Delta Force (global client)**. The official HQ page
(https://www.playdeltaforce.com/events/hq/en/) shows your matches, but this site
shows the whole squad's matches on one page and refreshes every 30 seconds.

Live site: **https://branchworkstudio.github.io/delta-force-live/**

## How it works

```
Your browser (logged in on playdeltaforce.com)
   └─ Chrome extension polls the HQ backend every minute with YOUR session
        └─ new finished matches are POSTed to Supabase (edge function `ingest`)
              └─ the GitHub Pages site reads them with a public read-only key
```

* Your Level Infinite login never leaves your browser. The extension only sends
  finished match rows (map, result, kills, income, operator, timestamps).
* Each player registers once with the squad code and gets a private ingest key.
* Anyone with the site link can read the squad's matches. Nothing else is exposed.
* Every row records `first_seen_at`, so the site can show how far behind the
  official API actually is ("API latency" tile).

## Install the extension (Chrome / Edge / Brave)

1. Download this repo (green **Code** button → **Download ZIP**) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension/` folder.
4. Log in on https://www.playdeltaforce.com/events/hq/en/ (normal LI Pass login).
5. Click the extension icon, enter the **squad code** (ask Pelle), press **Save & poll now**.

The icon shows a red `!` when your HQ session has expired: open the HQ page and
log in again, that is all. Sessions last roughly a week.

The first hour also imports your recent history (about 300 matches per mode),
one page per minute, so the site has something to show right away.

## Repo layout

| Path | What |
|---|---|
| `extension/` | Chrome MV3 extension (poller in `background.js`, API client in `dfapi.js`) |
| `supabase/migrations/` | Postgres schema, RLS, views |
| `supabase/functions/ingest/` | Edge function that the extension posts to |
| `docs/` | The static site served by GitHub Pages |

## Backend

Supabase project **Delta Force Live** (Branchwork Studio org, eu-central-1).
Squad code lives in `app_settings` (service role only). To rotate it:

```sql
update app_settings set value = 'new-code' where key = 'squad_code';
```

## Notes on the data source

Requests mirror what the HQ page itself does: POST JSON to
`sg-act.playerinfinite.com/api/proxy/logicial/DfTools/*`, signed with the page's
own scheme. `report_type` 1 = Operations, 2 = Warfare. `result` 1 = extracted /
victory, 2 = failed / defeat, 3 = draw, `is_leave` = quit. Map and operator
names come from the public `basic_info/*_en.js` tables.
