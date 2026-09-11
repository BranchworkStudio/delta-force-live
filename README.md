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
* A board is private: you see your own matches, and the matches of the people you
  share a board with. The site link alone shows a locked page.
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

**Boards, and inviting mates.** The only thing a secret was really needed for is enrolment,
so that travels in the link instead of anyone's fingers. Share the board's URL:

```
https://branchworkstudio.github.io/delta-force-live/connect.html?g=<code>
```

They click it, do the same three steps, and they are collected — their own player, their
own session, polled by the same job — and they land in the board the code belongs to. The
code survives the hand-over for free: the bookmarklet returns to `location.href` minus the
fragment, so the `?g=` rides along. The connect page also remembers it (`df-invite`), so a
later reconnect works from a bare URL. An openid the board already knows never needs a
code; a stranger without one is refused (`reason: "not-enrolled"`, or `"bad-invite"` if the
code is unknown or withdrawn); and an empty board is claimed by its first hand-over.

A **board** is a group, and the group's code *is* the invitation — six characters from an
alphabet with no O/0 and no I/1, because these get read down a phone. One account can be on
several: the account control lists them under **BOARDS**, switching is one click, and
**Just me** is always there. New boards are made from the same menu (*New board*), joined
with *Join with a code*, and left with *Leave this board*; the last member out takes the
group with them. Nothing here goes through SQL.

Codes are not fished for. `groups` is unreadable to the public key, and a member reads only
their own row:

```sql
create policy groups_readable_by_members on public.groups for select to authenticated
  using (exists (select 1 from public.group_members m
                 where m.group_id = groups.id and m.openid = public.my_openid()));
```

so the site can print the code next to the link without a round trip, and a stranger
querying the API directly gets nothing. `public_groups` publishes names and member counts
and never a code. A code is matched with `=`, never `like` — a pattern would match every
row at once.

The old per-link `invites` rows still work and are still what *Invite to the tracker only*
mints: `solo` is a link that collects a mate's matches without putting them on anybody's
board. Until boards became a database boundary that was a presentational promise only — the
read API answered the publishable key, so a solo player's rows stayed readable by anyone who
queried it directly. That hole is closed: a player on no board matches nobody but themselves,
so *solo* now means what it looked like it meant.

Only the browser holding an account's `control_key` can mint a link — the same key that may
stop collection — and a solo player can only pass on another solo link. Every row records
who made it, what it was for, and how often it has been used, so one link can be withdrawn
without touching the rest:

```sql
select code, kind, uses, last_used_at from invites where revoked_at is null;
update invites set revoked_at = now() where code = '<code>';
```

`players.enrolled_via` holds the code that let each account in (`first` for the account
that claimed the empty board), and `group_members` says which boards they are on.
`players.on_squad` is what the board fell back to before groups existed, and still does for
an account that is in no group at all.

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

### The session the hand-over mints

A verified hand-over is also a login — the only one this site has. Once `connect` has
proved the cookies against HQ, it mints a real Supabase session for that openid and hands
it back with the rest of the answer: `admin.createUser` for a first-timer (address
`<openid>@openid.deltaforce.local`, no password anywhere, `app_metadata.openid` set),
`admin.generateLink` for a magic link that is never mailed, and one `POST /auth/v1/verify`
to turn it into `{access_token, refresh_token}`. The browser keeps it as `df-session` and
the board sends it as the bearer. The session is now the only thing that reads anything: a
browser without one falls back to the publishable key, which the database answers with a
locked door, and the site draws **This board is private** with the way in. A session the
server refuses is dropped and the read retried the same way, so a stale token ends in that
page rather than in an error.

An account that connected before all this does not have to hand over again: `connect`
answers `{action: "session", openid, control_key}` with a freshly minted session, because
`control_key` already carries the same authority — it can stop collection and mint links.

The claim that matters is `app_metadata.openid`, read back in SQL as

```sql
create function public.my_openid() returns text language sql stable as
  $$ select nullif(auth.jwt() -> 'app_metadata' ->> 'openid', '') $$;
```

— no table lookup, so it can be used inside a policy on any table without recursion. This
is *not* a Level Infinite login on our domain: no LI password is ever seen, typed or
stored, and none ever will be. It is our own session, issued on the strength of a hand-over
HQ itself validated.

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
automatically — nothing needs to be running, not even this tab." Its menu holds the
**BOARDS** list (every group you are on, plus *Just me*, plus *New board* / *Join with a
code* / *Leave this board*), *Invite a mate*, *Open Delta Force HQ*, *Reconnect*, and —
only in the browser that handed the session over — a two-click *Stop collecting*. With
nothing connected the chip is replaced by a green **Connect** button.

An invite made while a board is selected is that board's own link and code, printed
together so either can be passed on; it needs no request, because the code came down with
the page.

The first hour also imports your recent history (about 300 matches per mode),
one page per minute, so the site has something to show right away.

## Repo layout

| Path | What |
|---|---|
| `supabase/migrations/` | Postgres schema, RLS, views |
| `supabase/functions/connect/` | Edge function behind the connect page: verifies a handed-over HQ session against HQ and stores it (`hq.ts` signs requests the way the HQ page itself does) |
| `supabase/functions/poll/` | The scheduled collector: reads HQ for every stored session and writes matches, details and red drops. Called by `pg_cron` every minute |
| `docs/connect.*` | The guided connect flow and the bookmarklet it generates |
| `docs/` | The static site served by GitHub Pages ("Ops Board" design: dark blue-grey ground, green accent, Chakra Petch numerals; new panels follow the module rules in the design handoff). Scope lives in `state.focus` (an openid or `"all"`), persisted as `df-focus` in localStorage; anything player-specific goes through `scoped()`. Which board is shown lives in `state.group`, persisted as `df-group` |

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
so no link already in circulation broke; see **Boards, and inviting mates** above.

`groups` holds the boards and their codes and is unreadable to the public key; a member
reads their own row through `groups_readable_by_members`. `group_members` is world-readable
— the board it describes is already public — but nothing writes to either table directly:
`create_group`, `join_group_by_code` and `leave_group` are `security definer`, granted to
`authenticated` only, and each of them decides who you are from `my_openid()` rather than
from anything the caller passes. `public_groups` is the anonymous view: names and member
counts, no codes.

**The read boundary is the board itself** (migrations 0019-0021). Every player-keyed table
answers one question:

```sql
create function public.shares_group(p_openid text) returns boolean ... as $$
  select public.my_openid() is not null and (
    p_openid = public.my_openid()
    or exists (select 1 from public.group_members a
               join public.group_members b on b.group_id = a.group_id
               where a.openid = public.my_openid() and b.openid = p_openid))
$$;
```

— yourself always, and anyone on a board with you. It is `security definer` so a policy on
`group_members` can ask it without querying the table it guards and recursing.

The publishable key now reads **nothing at all**: its `select` grants are gone, along with
every policy that named `anon`. That is deliberate belt-and-braces — the policies alone would
already return no rows, but with no grant a future table cannot be published by one careless
`using (true)`. The site treats a 401 on that key as "locked" and shows the private-board
page rather than a half-drawn board.

The trap to remember: the public views are `security_invoker = false`, which **bypasses** the
RLS on the tables underneath, so each one repeats the predicate itself. A view added later
without it hands out everything, quietly. `public_groups` uses the sibling `in_group(id)`.

None of this is one-way; the head of `0021_anon_reads_nothing.sql` carries the grants that
undo it.

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
