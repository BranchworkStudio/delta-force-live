# Delta Force Live

A live match tracker for **Delta Force (global client)**. The official HQ page
(https://www.playdeltaforce.com/events/hq/en/) is a day or two behind; this site
shows your own matches seconds after you leave the raid and refreshes every 30
seconds.

The board is **personal-first**: every module is scoped to one player, and the
roster strip doubles as the picker. Each tile wears that player's HQ profile
picture — or, for an account that has never set one, the operator they have
played most in the chosen range.
Operators get a picture in the two places one is worth drawing: the operators
band, where the tile is the operator and the art leads it, and the Operator
column of an expanded raid, where the names beside it are mostly strangers.
Never instead of the name — an operator nobody here plays still reads as a word. "All squad" is an opt-in tile that appears once
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
* Joining the tracker is by invitation from whoever runs it, and only from them.
  Boards themselves are everyone's: make one, name it, hand its code to a mate who
  is already here.
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
so that travels in the link instead of anyone's fingers. Send the invite link:

```
https://branchworkstudio.github.io/delta-force-live/connect.html?i=<code>
```

They click it, do the same three steps, and they are collected — their own player, their
own session, polled by the same job — and they land on whatever board the link named. The
code survives the hand-over for free: the bookmarklet returns to `location.href` minus the
fragment, so the `?i=` rides along. The connect page also remembers it (`df-invite`), so a
later reconnect works from a bare URL. An openid the tracker already knows never needs a
code; and an empty deployment is claimed by its first hand-over, which is how there comes to
be an admin at all.

**Two codes, two authorities** (migration 0022), because they answer different questions:

| | what it does | who hands it out |
|---|---|---|
| `?i=<18 hex>` | **enrols** — makes an account, starts the polling | the tracker's admin |
| `?g=<6 chars>` | **admits** — puts an existing account on a board | that board's owner |

That split is the whole model. Anybody here may make a board, own it, and hand its code
around; that costs nothing but a row in `group_members`. Nobody but the admin can put a new
*person* on the backend, because that is what costs money and attention. A board code
forwarded to a stranger is six useless characters — they are refused with
`reason: "code-not-invite"` and told which kind of link they actually need.

The admin is `players.is_admin`, set for the account that claimed the empty deployment; the
`connect` function checks it before writing any row to `invites`. Board ownership is
`group_members.role`, which existed from the start and was decoration until now.

A **board** is a group, and its code is six characters from an alphabet with no O/0 and no
I/1, because these get read down a phone. One account can be on several: the account control
lists them under **BOARDS**, switching is one click, and **Just me** is always there. New
boards are made from the same menu (*New board*), joined with *Join with a code*, and left
with *Leave this board*. The last member out takes the group with them — and an owner who
leaves a board others are still on hands it to whoever has been there longest, so a board is
never left with nobody who can keep it.

Codes are not fished for. `groups` is unreadable to the public key, and since 0022 only an
owner reads the row at all:

```sql
create policy groups_readable_by_owners on public.groups for select to authenticated
  using (public.owns_group(groups.id));
```

so the site can print the code next to the link without a round trip, a member of the board
cannot pass it on behind the owner's back, and a stranger querying the API directly gets
nothing. `public_groups` publishes names and member counts and never a code. A code is
matched with `=`, never `like` — a pattern would match every row at once.

Owning a board also means being able to correct it: *New code* (`rotate_group_code`) retires
the code and every link already carrying it, and *Remove* (`remove_group_member`) puts
somebody off. Removal is not a punishment so much as the other half of joining: they keep
their account and their own stats, and lose the right to read anybody else's matches.

`invites` rows are what both enrolling buttons mint — *Invite somebody new to <board>*
carries a `group_id`, *Invite somebody new, tracker only* does not: `solo` collects a mate's
matches without putting them on anybody's board. Until boards became a database boundary
that was a presentational promise only — the read API answered the publishable key, so a solo
player's rows stayed readable by anyone who queried it directly. That hole is closed: a
player on no board matches nobody but themselves, so *solo* now means what it looked like it
meant.

Only the browser holding an account's `control_key` can mint a link — the same key that may
stop collection — and then only if that account is the admin. Every row records who made it,
what it was for, and how often it has been used, so one link can be withdrawn without
touching the rest:

```sql
select code, kind, uses, max_uses, last_used_at from invites where revoked_at is null;
update invites set revoked_at = now() where code = '<code>';
```

**A link closes behind the person it was for** (migration 0025). `max_uses` is the number
that was missing: `uses` had been counted since the beginning and never read, so a link sent
to one stranger stayed open until somebody remembered to revoke it — and a link is a thing
people forward. New links are minted with `max_uses = 1`, because the button that makes one
says *invite somebody new*, singular. Null is no limit, which is what every link minted
before this still has; `{"max_uses": null}` on the invite call asks for one deliberately.

The use is spent at the one moment that costs anything — when a player row is actually
created — and nowhere else. That is a fix as much as a feature: `uses` used to go up when an
enrolled player reopened the link they joined on, and again when a hand-over failed at HQ a
second later, so counting it was counting the wrong event. A link that fails at HQ is still
good; a link that enrolled somebody is not. The increment is conditional on the count that
was read (`update … where code = ? and uses = <seen>`), so two people redeeming the last use
in the same second cannot both get in. Somebody arriving on a spent link is told so —
`reason: "invite-used-up"` — because a used link and a wrong one are different answers: there
is nothing to retype, only somebody to ask.

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
code* / *Leave this board*), *Open Delta Force HQ*, *Reconnect*, and — only in the browser
that handed the session over — a two-click *Stop collecting*. With nothing connected the
chip is replaced by a green **Connect** button.

What else is in that menu depends on what you may actually do, and it is drawn from the same
two facts the server checks rather than from a flag of its own:

* **own the board you are looking at** and it shows its code, *Copy link*, a two-click
  *New code*, and every other member with *Remove*. The code needs no request — it came
  down with the page, because only an owner is allowed to read it.
* **be the tracker's admin** and you also get *Invite somebody new to <board>* and *Invite
  somebody new, tracker only*. These are the only two buttons in the site that can create
  an account, and the only two that ask the server for a fresh row.

A mate who is neither sees boards, *New board*, *Join with a code* and *Leave* — enough to
squad up with anybody already here, and no way to enlarge the tracker itself.

The first hour also imports your recent history (about 300 matches per mode),
one page per minute, so the site has something to show right away.

## Repo layout

| Path | What |
|---|---|
| `supabase/migrations/` | Postgres schema, RLS, views |
| `supabase/functions/connect/` | Edge function behind the connect page: verifies a handed-over HQ session against HQ and stores it (`hq.ts` signs requests the way the HQ page itself does) |
| `supabase/functions/poll/` | The scheduled collector: reads HQ for every stored session and writes matches, details and red drops. Called by `pg_cron` every minute |
| `docs/connect.*` | The guided connect flow and the bookmarklet it generates |
| `docs/events/` | One file per limited-time event, each registering its own tab (see **Tabs and event modules**) |
| `docs/tabs/` | The tabs that are meant to stay — `loadouts.js`, `admin.js` — registered the same way |
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
The code that used to live in `app_settings.invite_code` became a `squad` row in `invites`
so no link already in circulation broke — and was revoked by 0022, having let four accounts
in by then, because a code with no author is exactly what that migration is about; see
**Boards, and inviting mates** above.

`groups` holds the boards and their codes and is unreadable to the public key; its owner
reads the row through `groups_readable_by_owners`. `group_members` is world-readable
— the board it describes is already public — but nothing writes to either table directly:
`create_group`, `join_group_by_code`, `leave_group`, `rotate_group_code` and
`remove_group_member` are `security definer`, granted to
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

## Tabs and event modules

The board is a set of tabs in the masthead, in the slot the mode picker used to hold. **Match
data** is the board itself — both Operations and Warfare, which the mode buttons above the
headline still pick between — and every other tab is
a file that registers itself in `window.DF_TABS` before `app.js` runs — in `docs/events/`
when it belongs to a season, `docs/tabs/` when it is meant to stay.
`app.js` builds the bar, makes each module a `<section class="pane">`, runs its queries
alongside the board's own and hands it a small host object; it knows nothing about what any
module contains. A module declares:

| Key | What |
|---|---|
| `id`, `label` | identity; the pane becomes `pane-<id>` |
| `filters` | true if the mode and range pickers apply — the range dims when they do not, the mode picker is hidden |
| `queries()` | REST paths; answers arrive in the same order, already narrowed to this board's players. Optional — a tab with nothing to ask the board leaves it out |
| `hero(rows, host)` | `{eyebrow, big, cells}` to replace the board's headline while the tab is open, or null to leave it |
| `aside(rows, host, active)` | HTML for the slot beside the big number — the open tab has first claim on it, and a module painting it from another tab should check `host.mode` before it does |
| `render(el, rows, host)` | paint the pane |
| `visible(host)` | optional — return false to leave the tab off the bar entirely (and its `queries()` unsent). Absent means always shown |
| `last` | optional — true to sit at the right-hand end of the bar whatever order the files loaded in |
| `scope` | optional — `"all"` to receive `queries()` rows exactly as the server sent them, instead of narrowed to this board's roster |

This exists because a season's collection is temporary. Ending one is: delete the module
file and its two script tags in `index.html`, and drop the event's entry from `EVENTS` in
`supabase/functions/poll/index.ts`. No migration, no schema change, nothing to unpick from
the board — which is also why the tables are keyed by an `event_key` column rather than
named after the event (`event_collection`, `event_collection_summary`).

The first module is the **Ahsarah cards** (`docs/events/asala-cards.js`), fed by
`GetCardCollection`. Its `event_key` (`asala_cards_s7`) is a key and nothing more — it is not
the game's season number and never reaches the page. Two things about that data are worth knowing:

- The answer lists **every** card that exists, not only the owned ones — a card never found
  comes back at `card_count: 0`. That zero is what makes "which am I missing" answerable at
  all; without it the page could only say what you hold.
- `card_count` is a **lifetime "ever unlocked" tally, not an inventory**. Selling a card in
  game does not decrement it, so HQ will keep claiming a card that is no longer in the
  stash — confirmed against an in-game count of 41 against HQ's 43. There is no inventory
  endpoint anywhere on playdeltaforce.com to reconcile it with, so the deck lets you mark a
  card sold yourself; the override is per player in that browser's `localStorage`
  (`df-sold-asala_cards_s7`) and is what the headline count is honest about.

Names, suits, ranks and the size of the deck all come from the official
`basic_info/asala_pokers_en.js` manifest, the same way map and red names do — 55 entries,
of which 54 are cards and one is the card box. If that manifest fails to load the module
does not register at all: a tab that cannot name what is missing is worse than no tab.

## Loadouts

`docs/tabs/loadouts.js` is the one tab that asks the board for nothing at all: it has no
`queries()`, reads `docs/data/loadouts.json` itself on first paint, and hangs it on the
68-weapon spine in the official `basic_info/guns_en.js` manifest (names, class, image and
the stat bars, the same way maps and cards are named). HQ knows what you own and what you
did with it; it does not know what anyone thinks you should put on a rifle, so nothing on
this page can come from the API.

What a build really is, is its **import code** — `Weapon Name-Mode-<21 characters>`, imported
in game from the weapon's preset menu. That string is the object on the page; the creator's
face, their name, their own channels and the age of the build are all there to help you
decide whether to paste it. Every card is the same four rows — who made it, what it is, the
code, where it came from — so a page that carries more detail than another does not turn the
grid into a staircase.

`docs/data/loadouts.json` is a curated static file, not a live feed:

| Field | What |
|---|---|
| `updated` | the day the builds last actually changed — shown in the hero. A morning that re-reads the same pages and finds the same thing does not move it |
| `sources` | the page each code was copied from, named the way the card says it — "Leissik's build doc" — and linked on every card |
| `creators` | `name`, `url` (their page), `links` (their own Twitch/YouTube/X/Discord/TikTok) and `avatar`, a path under `docs/img/creators/` |
| `builds` | `weapon` (must match the manifest), `mode`, `creator`, `source`, `code`, `url`, `added`, `note`, `tags`, `pos` (where the build stands on the creator's page) |

**Only the pages the creators run themselves.** The file was built from aggregators as well
at first — sites that collect other people's builds — and they were dropped: four times the
volume, a fraction of the value, most of it undated, reposted or uncredited, and a list you
cannot trust is worse than a shorter one you can. What is left is 682 builds across 66 of the
68 weapons, every one of them read off a page its maker publishes and keeps up to date.
`tools/loadouts/creators.json` is the list of those pages; adding a creator is adding an
entry there.

**Both modes, since RogueMonkeyJr.** The file was Operations and nothing else for its whole
life — all seven of the creators it started with publish for the extraction mode — so the tab's
mode filter and the mode chip on each card stayed hidden, being furniture over a file that had
only one answer. RogueMonkeyJr. keeps a sheet of 120 Warfare builds and a status column saying
which of them he still stands behind, and adding it turned both on by themselves.

**The face beside the name** is the creator's own channel picture, stored under
`docs/img/creators/` rather than hotlinked: a CDN URL rotates, and a visitor should not have
to call Twitch to see whose build they are reading.

Three rules the file is built on, and the reason for each:

- **A build without a creator and a link back is not published.** The whole page is other
  people's work; the credit is the point, and a code with no author is a code nobody can
  ask about. This also decides what to do with the builds a creator keeps on their page that
  are not theirs: Minda999 has a dozen credited in the only way a spreadsheet can, a name in
  brackets after the code — `…C0LGG (Larry)` — and those are dropped rather than published
  under his name or under a name with nothing behind it. A name in brackets is half the rule.
- **Codes are copied as published and are not verified here.** We have no way to paste one
  into the game and check, so the page says so rather than implying we did.
- **A weapon the manifest does not have is dropped.** It means the name was mistyped or the
  build is for another client (the same sites carry mobile and CN builds, whose codes do not
  import into the global PC game) — either way it cannot be trusted.
- **Everything a creator publishes is kept.** There was a cap of three builds per gun per
  creator here once. It read as a rule about near-identical variants, but rows arrive in page
  order, so what it actually cut was whatever sat lowest on the page: old seasons on Leissik's
  doc, which was fine, but also RogueMonkeyJr.'s CQB and Rounded M4A1 builds, which are
  different roles rather than variants of the one above them. The creator decided what was
  worth publishing; this file has no business second-guessing that by position.

**Which of a person's builds for one gun is the current one** is then a question the card has
to answer itself, and it has three signals, in this order: the **date**, where the page carries
one (79 builds); the **season**, which only Leissik labels but which is the right answer where
it is there, since a rebalance is what makes an old build stop being advice (117 builds); and
failing both, **`pos`** — where the build stands on the creator's own page, because people put
what they still run at the top. `pos` is written into the file by `own.py` because `build.py`
sorts the file by import code to keep a quiet morning byte-identical, and that throws page
order away.

**The price is normalised; nothing else is.** It is the one fact most of these pages carry, and
no two write it the same way — `580K`, `~1500k`, `$250k`, or nothing but the build's own name
("300k beam") — so it is pulled out to one place in one shape: under a million in K, above it in
M, the creator's own `~` kept. Where a name repeats a price the page already gives in a column of
its own, the name loses it: SammyMedows calls one build `$500k` on a row whose price column says
`~350k`, and a card printing both is worse than a card printing the field he maintains. What is
*not* touched is everything they actually wrote — `Hipfire`, `High End - LONG RANGE`, `Bot
blaster` are seven people's vocabularies, and flattening those into a house style would be us
writing the page instead of them. A build whose maker published nothing but a name and a code
(137 of them) shows nothing but a name and a code.

Two things the page cannot do, said out loud rather than worked around: **codes published
without the `Weapon Name-Mode-` prefix are shown exactly as their maker published them** (some
creators post only the tail), and **builds that live in a Discord server are not in here** —
reading them would mean joining the server with an account and scraping it, which is both
against Discord's terms and not something a public page should be doing on anyone's behalf.
Where a creator keeps builds in Discord, their card links to the server instead.

`tools/loadouts/` holds the fetcher and the builder that produced the file. Refreshing it is
`fetch.sh` then `build.py`; both are rate-limited, identify themselves in the user agent and
fetch only pages their owners published for exactly this purpose.

**It refreshes itself.** `.github/workflows/loadouts.yml` runs those two scripts every morning at
05:00 UTC and commits the result — which, since Pages serves `main:/docs`, is also the deploy.
Two things keep an unattended job from doing damage: `build.py` writes nothing when the pages
say the same thing they said yesterday (so a quiet morning is no commit, and the hero's date
stays honest), and it *refuses* to write a file that lost more than a third of its builds, on the
grounds that a page answering with a login wall parses to an empty sheet and a green run that
silently empties the tab is worse than a red one. The job is also the only way this file changes,
so `git log docs/data/loadouts.json` is the history of what the creators published.

## The admin tab

`docs/tabs/admin.js` is a fourth tab that only the owner of the tracker sees. It is the one
page that is about the tracker rather than about the game: who can get in, whether collection
is working, and whether the loadouts job ran.

**The tab is a convenience; the protection is in Postgres.** `visible(host)` keeps it off the
bar for everybody else, but that is a hint and nothing more — anyone can set
`localStorage["df-admin"] = "1"`. What actually holds is migration `0026_admin_views.sql`:
three views (`admin_invites`, `admin_players`, `admin_sessions`), each a definer view that
ends `where public.is_admin()`, revoked from `anon` and granted to `authenticated` only. With
the publishable key they answer **401**, so the tab a curious visitor unhides is a tab of
empty tables. Two RPCs, `admin_revoke_invite(code)` and `admin_cap_invite(code, max)`, raise
rather than act when the caller is not the admin.

Deliberately not exposed by any of the three views: `player_sessions.cookies` and
`players.control_key`. Those are the credentials the poller runs on, and a page never needs
to see them to answer the questions this tab asks.

The four sections:

- **Ways in** — every invite link ever minted, with uses against its limit, who made it, and
  whether it is open, used up or withdrawn. Each row can be copied as a full URL, capped, or
  withdrawn (two clicks, since a withdrawal is not undoable from here). Below the table, the
  mint row: pick one person / three / no limit, then **Tracker link** or **Board link**.
- **People** — every account, when it enrolled, which link let it in, and which boards it is
  on. The "let in by" cell is the invite code, so a person and the door they came through are
  one glance apart.
- **Collection** — per account: when it was last polled, how long the current HQ login has
  lasted, when it was handed over, and the last error the poller saw. This is the page that
  answers "why has this player stopped updating".
- **Loadouts pipeline** — reads `docs/data/loadouts-meta.json`, which `build.py` now writes on
  **every** run, including the runs that change nothing and the runs it refuses. `loadouts.json`
  is unchanged by this: its `updated` field still moves only when the builds themselves move,
  which is what the Loadouts hero prints. The meta file is how you tell "the job ran and found
  nothing new" apart from "the job did not run", and it carries the per-creator counts and the
  full list of what the build dropped and why.

## Notes on the data source

Requests mirror what the HQ page itself does: POST JSON to
`sg-act.playerinfinite.com/api/proxy/logicial/DfTools/*`, signed with the page's
own scheme. `report_type` 1 = Operations, 2 = Warfare. `result` 1 = extracted /
victory, 2 = failed / defeat, 3 = draw, `is_leave` = quit. Map and operator
names come from the public `basic_info/*_en.js` tables; red-drop item names from
`collections_en.js` (`collection_id` = `prop_id`).

A player's profile picture arrives the same way: `GetMyData` gives `player_info.avatar`
as a bare id (`42010030067`), and `basic_info/avatars.js` — note the name, no `_en` —
turns it into an image. That table is not listed in the `*_en.js` set and is easy to
miss, which is why the board went without profile pictures for a while. Operator art
comes in several sizes in `operators_en.js`: `image_url` is the 3072px splash at about
4.4 MB, `daily_report_avatar_url` the same operator as a 200px head at 82 KB, which is
the one anything tile-sized should use.

Per run the poller also fetches `GetMatchDetail` for new matches (plus a few older
ones, so history fills in slowly), `GetRedDropRecordList` page 1 (plus one deeper
page), `GetPrivateRoomKey` (daily room passwords, hourly), and one call per entry in
`EVENTS` for the running limited-time collections. `GetCardCollection` takes no
parameters at all — there is only ever one collection to ask about. `match_time` is the
match *start*; a member's `finish_time` is when that player extracted or died, and is
what the latency stat measures against. Operations details always report `death = 0`,
so the site counts a failed, non-quit raid as a death for K/D. A flawless stretch has
no denominator to divide by, so its K/D is simply the kill count — the subline says
"no deaths yet" so the number is not mistaken for an average.

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
