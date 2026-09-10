# Delta Force Live

A live match tracker for **Delta Force (global client)**. The official HQ page
(https://www.playdeltaforce.com/events/hq/en/) is a day or two behind; this site
shows your own matches seconds after you leave the raid and refreshes every 30
seconds.

The board is **personal-first**: every module is scoped to one player, and the
roster strip doubles as the picker. "All squad" is an opt-in tile that appears once
more than one player is tracked, and the choice is remembered per browser.

Live site: **https://branchworkstudio.github.io/delta-force-live/**

## How it works

```
Your HQ login on playdeltaforce.com
   └─ the connect page hands that session to the backend (edge function `connect`)
        └─ pg_cron calls `poll` every minute, which reads HQ as you and writes matches
             └─ the GitHub Pages site reads them with a public read-only key

fallback: the Chrome extension polls from a running browser and POSTs to `ingest`
```

* **Nothing has to run on your machine.** Once the session is handed over, the
  server collects every minute with your PC off. The extension is a fallback for
  when the bookmark route cannot carry a token.
* Your Level Infinite password is never involved, in either route. What moves is
  the HQ session cookie — the same thing the HQ page itself uses.
* Anyone with the site link can read the squad's matches. Nothing else is exposed.
* Every row records `first_seen_at`, so the site can show how far behind the
  official API actually is ("API latency" tile).

## Connect from the site, without installing anything

The primary route. Three steps, no install, and **nothing to type**:

```
docs/connect.html            the guided flow: bookmark → HQ login → click the bookmark
   └─ one bookmarklet, clicked on playdeltaforce.com
        └─ reads that page's own Wand_DF_* cookies, navigates back to connect.html#s=…
              └─ edge function `connect` verifies them against HQ, then stores them
                   └─ and kicks `poll` immediately, so the first matches land in seconds
```

There is no code to type on this path, on purpose: a hand-over is proved against HQ
itself before anything is stored, and only the account owner can produce cookies HQ
accepts. That is stronger than a secret the page would have to hold.

**Inviting mates.** The only thing a secret was really needed for is enrolment, so that
travels in the link instead of anyone's fingers. Share the invite URL:

```
https://branchworkstudio.github.io/delta-force-live/connect.html?i=<invite_code>
```

They click it, do the same three steps, and they are on the board — their own player,
their own session, polled by the same job. The invite survives the hand-over for free:
the bookmarklet returns to `location.href` minus the fragment, so the `?i=` rides along.
The connect page also remembers it (`df-invite`), so a later reconnect works from a bare
URL. An openid the board already knows never needs an invite; a stranger without one is
refused (`reason: "not-enrolled"`, or `"bad-invite"` if it has been rotated); and an empty
board is claimed by its first hand-over.

Anyone already on the board can pass the link on: the account control in the top-right
corner of the board has an **Invite a mate** item that copies the link to the clipboard.
Rotate the code whenever you want:

```sql
update app_settings set value = encode(extensions.gen_random_bytes(9),'hex') where key = 'invite_code';
```

`players.enrolled_via` / `enrolled_at` record how and when each account got in.

Why a bookmark and not a redirect: HQ has no way to log you in *for* us. Their API
answers only their own origin (a preflight from ours gets `405` with no CORS headers),
and their login lands in cookies on their domain, which no other origin may read. A
bookmarklet runs *as their page*, so it is the only route that does not need an install.
It carries no secret at all — only the cookies it finds on the page it runs on.

The fragment (`#s=…`) is deliberate: fragments are never sent to a server, so the token
does not appear in any access log, and the page strips it from the address bar on arrival.

**What gets stored:** the nine `Wand_DF_*` login cookies, in `player_sessions`, which is
service-role only (RLS on, no policies). The board reads `public_sessions`, a view that
exposes when a session arrived and whether it still works — never the cookies. Nothing
about your Level Infinite password is involved at any point. **Disconnect** on the connect
page deletes the row, and works only in the browser that did the hand-over: `connect`
returns a one-off `control_key` that browser keeps and must present back.

The connect function verifies a hand-over with one real HQ call (`GetMyData`) before
storing anything, so "Connected" always means the backend can actually read your matches.
Failure modes are named in the flow, not in this file: not logged in on HQ, bookmark
clicked on the wrong site, a token the HQ page keeps to itself, an openid this board
does not track.

### The server-side poller

`pg_cron` fires every minute and POSTs to the `poll` edge function, which for each
stored session reads page 1 of both report types, walks one extra page of history per
run until ~300 matches per mode are in, fills in up to five missing match details
newest-first (giving up after three tries, tracked in `matches.detail_tries`), picks up
red drops, and refreshes the daily private-room passwords hourly. When HQ answers "not
login param" the row is *kept* and marked `last_error`, so the board can say
**reconnect** instead of going blank.

The job body reads the shared secret out of `app_settings` at run time rather than
embedding it, and `poll` refuses any request that does not present it (`403`). To
poll one player right now:

```sql
select net.http_post(
  url := 'https://faaskhwycywnwpdjcvgp.supabase.co/functions/v1/poll',
  body := (select jsonb_build_object('secret', value, 'openid', '<openid>')
           from app_settings where key = 'poll_secret'));
```

## Install the extension (fallback, Chrome / Edge / Brave)

Only needed if the bookmark route cannot get a token out of the HQ page in your
browser. Everything below is the older push path; it still works and still coexists
with the server poller (both write the same rows, duplicates are ignored).

1. Download this repo (green **Code** button → **Download ZIP**) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension/` folder.
4. Log in on https://www.playdeltaforce.com/events/hq/en/ (normal LI Pass login).
5. Enter the **squad code** (ask Pelle) in the extension popup and press save. This
   is the only place a code is still asked for — it registers the browser and gets it
   a private `ingest_key`. The connect page needs none.

After that you never have to touch the extension again: it polls on its own every
30 seconds, and the live site is the control panel (see below).

The extension icon shows a red `!` when your HQ session has expired: open the HQ
page and log in again, that is all.

### Run it from the site

`extension/bridge.js` is a content script injected only into the live site (and
`localhost:3010` for development). It lets the page ask the extension for status and
force a poll, over `window.postMessage` with the `df-live` namespace. The page never
sees the HQ token, the session cookies or the ingest key.

The board's account control — the chip in the top-right corner, where a website would
put "logged in" — is where all of this surfaces, in plain language rather than in
plumbing: your nickname, a status dot, and "Your matches are collected for you
automatically — nothing needs to be running, not even this tab." Its menu holds *Invite
a mate*, *Open Delta Force HQ*, *Reconnect*, a **Check for new matches** item that only
appears when the extension is present in this browser, and — only in the browser that
handed the session over — a two-click *Stop collecting*. With nothing connected the chip
is replaced by a green **Connect** button.

The first hour also imports your recent history (about 300 matches per mode),
one page per minute, so the site has something to show right away.

## Repo layout

| Path | What |
|---|---|
| `extension/` | Chrome MV3 extension (poller in `background.js`, API client in `dfapi.js`, site bridge in `bridge.js`, popup as a fallback control panel) |
| `supabase/migrations/` | Postgres schema, RLS, views |
| `supabase/functions/ingest/` | Edge function that the extension posts to |
| `supabase/functions/connect/` | Edge function behind the connect page: verifies a handed-over HQ session against HQ and stores it (`hq.ts` is the server-side twin of `dfapi.js`) |
| `supabase/functions/poll/` | The scheduled collector: reads HQ for every stored session and writes matches, details and red drops. Called by `pg_cron` every minute |
| `docs/connect.*` | The guided connect flow and the bookmarklet it generates |
| `docs/` | The static site served by GitHub Pages ("Ops Board" design: dark blue-grey ground, green accent, Chakra Petch numerals; new panels follow the module rules in the design handoff). Scope lives in `state.focus` (an openid or `"all"`), persisted as `df-focus` in localStorage; anything player-specific goes through `scoped()` |

## Backend

Supabase project **Delta Force Live** (Branchwork Studio org, eu-central-1).
`app_settings` is service-role only and holds three secrets: `poll_secret` (between
`pg_cron` and the `poll` function), `invite_code` (the link mates join with) and the
legacy `squad_code`, which now only gates extension registration. To rotate any:

```sql
update app_settings set value = encode(extensions.gen_random_bytes(24),'hex') where key = 'poll_secret';
update app_settings set value = encode(extensions.gen_random_bytes(9),'hex')  where key = 'invite_code';
update app_settings set value = 'new-code' where key = 'squad_code';
```

Enrolment on the connect path uses `invite_code` in the same table — see **Inviting
mates** above. It is a capability, not a password: it lets someone add *their own*
proven HQ session to the board and nothing else.

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

Because that server-side lifetime is not published anywhere, both routes measure it:
the token is hashed (SHA-256, first 8 bytes; the token itself is never stored in that
field or logged), and when the fingerprint changes a new `token_seen_since` is
recorded. The site shows it as "HQ login held for …", so the real lifetime becomes an
observation instead of an assumption.

That the API takes the token as a *request parameter* rather than a cookie is what
makes the server poller possible at all: the backend can replay it indefinitely, and
its missing CORS headers only block a browser on our own origin — not a Deno function.
The one thing the server cannot do is renew a dead session, so when HQ starts
answering "not login param" the flow is the same two clicks again: open HQ, click the
bookmark. Whether that is once a month or once a week is exactly what
`token_seen_since` is measuring.
