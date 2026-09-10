# Delta Force Live

A live match tracker for **Delta Force (global client)**. The official HQ page
(https://www.playdeltaforce.com/events/hq/en/) is a day or two behind; this site
shows your own matches seconds after you leave the raid and refreshes every 30
seconds.

The board is **personal-first**: every module is scoped to one player, and the
roster strip doubles as the picker. The squad code is only how a player registers
their browser and how mates get read access, not a request to merge everyone's
numbers. "All squad" is an opt-in tile that appears once more than one player is
tracked, and the choice is remembered per browser.

Live site: **https://branchworkstudio.github.io/delta-force-live/**

## How it works

```
Your HQ login on playdeltaforce.com
   ├─ Chrome extension polls the HQ backend every 30 s with YOUR session
   │    └─ new finished matches are POSTed to Supabase (edge function `ingest`)
   └─ or the connect page hands the session to the backend (edge function `connect`)
        └─ either way the GitHub Pages site reads them with a public read-only key
```

* Your Level Infinite login never leaves your browser. The extension only sends
  finished match rows (map, result, kills, income, operator, timestamps).
* Each player registers once with the squad code and gets a private ingest key.
* Anyone with the site link can read the squad's matches. Nothing else is exposed.
* Every row records `first_seen_at`, so the site can show how far behind the
  official API actually is ("API latency" tile).

## Connect from the site, without installing anything

There are two ways to get matches into the board. The extension pushes them from a
browser that is running; the **connect page** hands your HQ session to the backend so
it can read them on its own, with your PC off.

```
docs/connect.html            the guided flow: squad code → bookmark → HQ login → click
   └─ one bookmarklet, clicked on playdeltaforce.com
        └─ reads that page's own Wand_DF_* cookies, navigates back to connect.html#s=…
              └─ edge function `connect` verifies them against HQ, then stores them
```

Why a bookmark and not a redirect: HQ has no way to log you in *for* us. Their API
answers only their own origin (a preflight from ours gets `405` with no CORS headers),
and their login lands in cookies on their domain, which no other origin may read. A
bookmarklet runs *as their page*, so it is the only route that does not need an install.
It carries no secret — the squad code stays in the site's `localStorage`.

The fragment (`#s=…`) is deliberate: fragments are never sent to a server, so the token
does not appear in any access log, and the page strips it from the address bar on arrival.

**What gets stored:** the nine `Wand_DF_*` login cookies, in `player_sessions`, which is
service-role only (RLS on, no policies). The board reads `public_sessions`, a view that
exposes when a session arrived and whether it still works — never the cookies. Nothing
about your Level Infinite password is involved at any point. **Disconnect** on the connect
page deletes the row.

The connect function verifies a hand-over with one real HQ call (`GetMyData`) before
storing anything, so "Connected" always means the backend can actually read your matches.
Failure modes are named in the flow, not in this file: not logged in on HQ, bookmark
clicked on the wrong site, a token the HQ page keeps to itself, a refused squad code.

## Install the extension (Chrome / Edge / Brave)

1. Download this repo (green **Code** button → **Download ZIP**) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension/` folder.
4. Log in on https://www.playdeltaforce.com/events/hq/en/ (normal LI Pass login).
5. Enter the **squad code** (ask Pelle) either on the live site's *Session* block
   or in the extension popup, and press save.

After that you never have to touch the extension again: it polls on its own every
30 seconds, and the live site is the control panel (see below).

The extension icon shows a red `!` when your HQ session has expired: open the HQ
page and log in again, that is all.

### Run it from the site

`extension/bridge.js` is a content script injected only into the live site (and
`localhost:3010` for development). It lets the page ask the extension for status,
force a poll and set the squad code, over `window.postMessage` with the `df-live`
namespace. The page never sees the HQ token, the session cookies or the ingest key.

The site's *Session* block therefore shows whether tracking is running in *this*
browser, with a **Poll now** button and a link to the HQ login. Open the site in a
browser without the extension (a phone, a mate's laptop) and the same block falls
back to what the database knows: session state and when that player last pushed.

The first hour also imports your recent history (about 300 matches per mode),
one page per minute, so the site has something to show right away.

## Repo layout

| Path | What |
|---|---|
| `extension/` | Chrome MV3 extension (poller in `background.js`, API client in `dfapi.js`, site bridge in `bridge.js`, popup as a fallback control panel) |
| `supabase/migrations/` | Postgres schema, RLS, views |
| `supabase/functions/ingest/` | Edge function that the extension posts to |
| `supabase/functions/connect/` | Edge function behind the connect page: verifies a handed-over HQ session against HQ and stores it (`hq.ts` is the server-side twin of `dfapi.js`) |
| `docs/connect.*` | The guided connect flow and the bookmarklet it generates |
| `docs/` | The static site served by GitHub Pages ("Ops Board" design: dark blue-grey ground, green accent, Chakra Petch numerals; new panels follow the module rules in the design handoff). Scope lives in `state.focus` (an openid or `"all"`), persisted as `df-focus` in localStorage; anything player-specific goes through `scoped()` |

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
names come from the public `basic_info/*_en.js` tables; red-drop item names from
`collections_en.js` (`collection_id` = `prop_id`).

Per poll the extension also fetches `GetMatchDetail` for new matches (plus two older
ones, so history fills in slowly), `GetRedDropRecordList` page 1 (plus one deeper
page), and `GetPrivateRoomKey` (daily room passwords, hourly). `match_time` is the
match *start*; a member's `finish_time` is when that player extracted or died, and is
what the latency stat measures against. Operations details always report `death = 0`,
so the site counts a failed, non-quit raid as a death for K/D.

### How long an HQ login lasts

Measured, not guessed: the `Wand_DF_token` cookie is a **session cookie**. It
carries no expiry date, so `chrome.cookies` reports no `expirationDate` and
`players.token_expires` stays null. There is no clock to read and no refresh the
extension can perform. In practice the login survives as long as the browser
profile keeps its session cookies (Chrome's "continue where you left off" restores
them across restarts) and until the server decides to invalidate the token.

Because that server-side lifetime is not published anywhere, the extension now
measures it: every poll hashes the token (SHA-256, first 8 bytes, the token itself
is never stored or sent), and when that fingerprint changes it records a new
`token_seen_since`. The site shows it as "Signed in for …", so the real lifetime
becomes an observation instead of an assumption.

This is also why the poller has to live in a browser extension. The HQ API takes
the token as a request parameter rather than a cookie, but it sends no CORS
headers, so a plain web page on our own domain cannot read a response from it; and
a server-side poller would need the token copied out of the browser by hand, with
no way to refresh it once the session dies.
