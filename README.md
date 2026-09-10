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
```

* **Nothing has to run on your machine.** Once the session is handed over, the
  server collects every minute with your PC off — no browser, no add-on, no
  tab left open.
* Your Level Infinite password is never involved. What moves is the HQ session
  cookie — the same thing the HQ page itself uses.
* Anyone with the site link can read the squad's matches. Nothing else is exposed.
* Every row records `first_seen_at`, so the site can show how far behind the
  official API actually is ("API latency" tile).

## Connect from the site

Three steps, no install, and **nothing to type**:

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
https://branchworkstudio.github.io/delta-force-live/connect.html?i=<code>
```

They click it, do the same three steps, and they are collected — their own player, their
own session, polled by the same job. The invite survives the hand-over for free: the
bookmarklet returns to `location.href` minus the fragment, so the `?i=` rides along. The
connect page also remembers it (`df-invite`), so a later reconnect works from a bare URL.
An openid the board already knows never needs an invite; a stranger without one is
refused (`reason: "not-enrolled"`, or `"bad-invite"` if the code is unknown or withdrawn);
and an empty board is claimed by its first hand-over.

Links are made on the site, not in SQL: the account control in the top-right corner offers
**Invite to the squad** and **Invite to the tracker only**, and either one mints a fresh
row in `invites` and copies the URL. The two kinds differ in one thing:

| Kind | What the mate gets |
|---|---|
| `squad` | joins the board and appears in the roster with everyone else |
| `solo` | polled the same way, but the board shows them themselves alone, and they show up on nobody else's |

The solo boundary is presentational, and deliberately so: the read API this site runs on
is public by design, so a solo player's rows stay readable by anyone querying it directly.
It keeps them off the shared board; it does not hide them, and a solo invite says as much
before it is sent.

Only the browser holding an account's `control_key` can mint a link — the same key that
may stop collection — and a solo player can only pass on another solo link. Every row
records who made it, what it was for, and how often it has been used, so one link can be
withdrawn without touching the rest:

```sql
select code, kind, uses, last_used_at from invites where revoked_at is null;
update invites set revoked_at = now() where code = '<code>';
```

`players.enrolled_via` holds the code that let each account in (`first` for the account
that claimed the empty board), and `players.on_squad` says which board they belong on.

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

### The account control

The board's account control — the chip in the top-right corner, where a website would
put "logged in" — is where all of this surfaces, in plain language rather than in
plumbing: your nickname, a status dot, and "Your matches are collected for you
automatically — nothing needs to be running, not even this tab." Its menu holds *Invite
a mate*, *Open Delta Force HQ*, *Reconnect*, and — only in the browser that handed the
session over — a two-click *Stop collecting*. With nothing connected the chip is
replaced by a green **Connect** button.

The first hour also imports your recent history (about 300 matches per mode),
one page per minute, so the site has something to show right away.

## Repo layout

| Path | What |
|---|---|
| `supabase/migrations/` | Postgres schema, RLS, views |
| `supabase/functions/connect/` | Edge function behind the connect page: verifies a handed-over HQ session against HQ and stores it (`hq.ts` signs requests the way the HQ page itself does) |
| `supabase/functions/poll/` | The scheduled collector: reads HQ for every stored session and writes matches, details and red drops. Called by `pg_cron` every minute |
| `docs/connect.*` | The guided connect flow and the bookmarklet it generates |
| `docs/` | The static site served by GitHub Pages ("Ops Board" design: dark blue-grey ground, green accent, Chakra Petch numerals; new panels follow the module rules in the design handoff). Scope lives in `state.focus` (an openid or `"all"`), persisted as `df-focus` in localStorage; anything player-specific goes through `scoped()` |

## Backend

Supabase project **Delta Force Live** (Branchwork Studio org, eu-central-1).
`app_settings` is service-role only and holds `poll_secret`, the shared secret between
`pg_cron` and the `poll` function. To rotate it:

```sql
update app_settings set value = encode(extensions.gen_random_bytes(24),'hex') where key = 'poll_secret';
```

`invites` is service-role only for the same reason — a code is a secret, so there is no
grant to `anon` and only the `connect` function ever reads it. An invite is a capability
and not a password: it lets someone add *their own* proven HQ session and nothing else.
The code that used to live in `app_settings.invite_code` is now a `squad` row in `invites`
so no link already in circulation broke; see **Inviting mates** above.

## Notes on the data source

Requests mirror what the HQ page itself does: POST JSON to
`sg-act.playerinfinite.com/api/proxy/logicial/DfTools/*`, signed with the page's
own scheme. `report_type` 1 = Operations, 2 = Warfare. `result` 1 = extracted /
victory, 2 = failed / defeat, 3 = draw, `is_leave` = quit. Map and operator
names come from the public `basic_info/*_en.js` tables; red-drop item names from
`collections_en.js` (`collection_id` = `prop_id`).

Per run the poller also fetches `GetMatchDetail` for new matches (plus a few older
ones, so history fills in slowly), `GetRedDropRecordList` page 1 (plus one deeper
page), and `GetPrivateRoomKey` (daily room passwords, hourly). `match_time` is the
match *start*; a member's `finish_time` is when that player extracted or died, and is
what the latency stat measures against. Operations details always report `death = 0`,
so the site counts a failed, non-quit raid as a death for K/D.

### How long an HQ login lasts

Measured, not guessed: the `Wand_DF_token` cookie is a **session cookie**. It
carries no expiry date, so `players.token_expires` stays null. There is no clock to
read and no refresh anyone can perform. In practice the login survives until the
server decides to invalidate the token.

Because that server-side lifetime is not published anywhere, the board measures it:
the token is hashed (SHA-256, first 8 bytes; the token itself is never stored in that
field or logged), and when the fingerprint changes a new `token_seen_since` is
recorded, so the real lifetime becomes an observation instead of an assumption.

That the API takes the token as a *request parameter* rather than a cookie is what
makes the server poller possible at all: the backend can replay it indefinitely, and
its missing CORS headers only block a browser on our own origin — not a Deno function.
The one thing the server cannot do is renew a dead session, so when HQ starts
answering "not login param" the flow is the same two clicks again: open HQ, click the
bookmark. Whether that is once a month or once a week is exactly what
`token_seen_since` is measuring.
