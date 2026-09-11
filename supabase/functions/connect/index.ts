// Delta Force Live: takes an HQ session handed over from the site's connect flow.
// The bookmarklet reads the HQ page's own cookies and navigates to /connect.html#..., which POSTs here.
//   { cookies: { openid, token, ... } } -> { ok, openid, nickname, avatar, level, fresh, connected_at, control_key }
//   { action: "invite", openid, control_key, kind, group_id } -> { ok, kind, code, group }
//   { action: "session", openid, control_key } -> { ok, session }
//   { action: "disconnect", openid, control_key } -> { ok }
//   { action: "probe" } -> signature self-test
//
// Nobody types anything on this path. A hand-over is proved against HQ itself before anything is
// stored, which is stronger than any secret the page could hold: only the account owner can produce
// working cookies for their openid. The one thing that still needs a gate is enrolment, and that
// travels in the link instead of the player's fingers — `connect.html?i=<code>`. An openid the
// board already knows needs no invite; an empty board is claimed by its first hand-over.
//
// Two shapes of code open the door, and both are looked up by equality against the column that
// holds them. A group's own six-character code (`?g=7559SW`) puts the mate on that group's board —
// one code per group, short enough to read down the phone, rotatable if it ever gets out. A long
// hex row in `invites` (`?i=...`) is the tracker on its own: no group, their stats, their board.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cleanSession, fingerprint, getMyData, getPrivateRoomKey, isAuthError, md5, REPORT_TYPE } from "./hq.ts";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
// Sent as the `apikey` when redeeming a magic link: that header only routes the request, while the
// token in the body is what carries the identity.
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_Q75-W62B_ozzlnFPV61cqA_V9k7MOMX";
const supabase = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const randomKey = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
// Same shape as the original code this replaces: 9 random bytes as hex, short enough to live in a
// URL a mate is sent, long enough that guessing one is not a way in.
const randomCode = () => [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  // Signature self-test: an unauthenticated but signed HQ endpoint. code 0 means our MD5 signing is right.
  if (body.action === "probe") {
    const env = await getPrivateRoomKey().catch((e) => ({ code: -1, msg: String(e) }));
    return json({ ok: Number(env.code) === 0, code: env.code, msg: env.msg ?? null, md5: await md5("delta-force-live") });
  }

  // A session for a browser that is already trusted. `control_key` is the same authority that may
  // stop collection and mint invite links, so it may also ask for the session that replaces it —
  // which means the two players already on the board get one without handing over again.
  if (body.action === "session") {
    const openid = typeof body.openid === "string" ? body.openid.slice(0, 128) : "";
    const key = typeof body.control_key === "string" ? body.control_key.slice(0, 128) : "";
    if (!openid || !key) return json({ error: "openid and control_key required" }, 400);
    const { data: row } = await supabase.from("player_sessions").select("openid").eq("openid", openid).eq("control_key", key).maybeSingle();
    if (!row) return json({ error: "not the browser that connected this session" }, 403);
    const { data: who } = await supabase.from("players").select("nickname").eq("openid", openid).maybeSingle();
    const session = await mintSession(openid, who?.nickname ?? null);
    return session ? json({ ok: true, openid, session }) : json({ error: "could not mint a session" }, 500);
  }

  // Making an invite link, from the account panel instead of by hand in SQL. Only the browser that
  // connected an account can mint one — the same control key that is allowed to stop collection —
  // and a solo player can only pass on what they were given: another solo link, never a seat on
  // the board they are not on themselves.
  if (body.action === "invite") {
    const openid = typeof body.openid === "string" ? body.openid.slice(0, 128) : "";
    const key = typeof body.control_key === "string" ? body.control_key.slice(0, 128) : "";
    const kind = body.kind === "solo" ? "solo" : "squad";
    if (!openid || !key) return json({ error: "openid and control_key required" }, 400);
    const { data: row } = await supabase.from("player_sessions").select("openid").eq("openid", openid).eq("control_key", key).maybeSingle();
    if (!row) return json({ error: "not the browser that connected this session" }, 403);
    const { data: who } = await supabase.from("players").select("nickname, on_squad").eq("openid", openid).maybeSingle();

    // A link into a group is that group's code: there is one, everybody in the group hands out the
    // same one, and it can be read aloud. Only somebody already in the group can pass it on.
    if (kind === "squad") {
      const gid = typeof body.group_id === "string" ? body.group_id.slice(0, 64) : "";
      const q = supabase.from("group_members").select("group_id").eq("openid", openid);
      const { data: mem } = gid
        ? await q.eq("group_id", gid).maybeSingle()
        : await q.order("joined_at", { ascending: true }).limit(1).maybeSingle();
      if (!mem) return json({ error: "you are not in that group" }, 403);
      const { data: g } = await supabase.from("groups").select("id, name, code").eq("id", mem.group_id).maybeSingle();
      if (!g) return json({ error: "no such group" }, 404);
      // `code` as well as `group`, so a page still running yesterday's script builds a link that
      // works: the gate below takes either shape of code from either parameter.
      return json({ ok: true, kind, code: g.code, group: { id: g.id, name: g.name, code: g.code } });
    }

    const code = randomCode();
    const { error } = await supabase.from("invites").insert({
      code, kind, created_by: openid, label: `${kind} link from ${who?.nickname ?? openid.slice(0, 6)}`,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, code, kind });
  }

  if (body.action === "disconnect") {
    const openid = typeof body.openid === "string" ? body.openid.slice(0, 128) : "";
    const key = typeof body.control_key === "string" ? body.control_key.slice(0, 128) : "";
    if (!openid || !key) return json({ error: "openid and control_key required" }, 400);
    const { data: row } = await supabase.from("player_sessions").select("openid").eq("openid", openid).eq("control_key", key).maybeSingle();
    if (!row) return json({ error: "not the browser that connected this session" }, 403);
    await supabase.from("player_sessions").delete().eq("openid", openid);
    await supabase.from("players").update({ token_ok: false }).eq("openid", openid);
    return json({ ok: true });
  }

  const session = cleanSession(body?.cookies);
  if (!session) return json({ error: "no HQ login found in that browser", reason: "no-cookies" }, 400);
  const openid = session.openid;

  // Enrolment gate, checked before we spend an HQ call on an unknown player.
  const { data: existing } = await supabase.from("players").select("openid, on_squad").eq("openid", openid).maybeSingle();
  const join = await resolveCode(typeof body.group === "string" ? body.group : typeof body.invite === "string" ? body.invite : "");
  let via: string | null = null;
  let onSquad = existing ? existing.on_squad !== false : true;
  if (!existing) {
    const { count } = await supabase.from("players").select("openid", { count: "exact", head: true });
    if ((count ?? 0) === 0) {
      via = "first";                                                   // empty board: the first hand-over claims it
    } else if (join) {
      via = join.via;                                                  // what the join traces back to
      onSquad = !join.solo;
    } else {
      const had = typeof body.group === "string" ? body.group : typeof body.invite === "string" ? body.invite : "";
      return json({ error: "this board needs an invite link", reason: had ? "bad-invite" : "not-enrolled" }, 403);
    }
  }

  // Prove the handover works before storing it: one authenticated call, exactly as the poller makes.
  let env;
  try { env = await getMyData(session, REPORT_TYPE.OPERATIONS); } catch (e) { return json({ error: String(e), reason: "hq-unreachable" }, 502); }
  if (Number(env.code) !== 0) {
    const reason = isAuthError(env) ? "not-logged-in" : "hq-error";
    return json({ error: env.msg || "HQ refused the session", code: env.code, reason }, reason === "not-logged-in" ? 401 : 502);
  }

  const p = env.data?.player_info ?? {};
  const nickname = typeof p.nickname === "string" ? p.nickname.slice(0, 64) : null;
  const avatar = typeof p.avatar === "string" ? p.avatar.slice(0, 64) : null;
  const level = Number.isFinite(Number(p.level)) ? Math.trunc(Number(p.level)) : null;

  if (existing) {
    await supabase.from("players").update({ nickname, avatar, level, token_ok: true }).eq("openid", openid);
  } else {
    // A new mate joins.
    const { error } = await supabase.from("players").insert({
      openid, nickname, avatar, level, token_ok: true, on_squad: onSquad,
      enrolled_via: via, enrolled_at: new Date().toISOString(),
    });
    if (error) return json({ error: error.message }, 500);
  }

  // The link decides which board they land on, and this runs for players already here too: opening a
  // second group's link is how somebody ends up on more than one board.
  if (join?.group) {
    await supabase.from("group_members")
      .upsert({ group_id: join.group, openid }, { onConflict: "group_id,openid", ignoreDuplicates: true });
  }

  const fp = await fingerprint(session.token);
  const { data: prev } = await supabase.from("player_sessions").select("token_fp, connected_at").eq("openid", openid).maybeSingle();
  const fresh = !prev || prev.token_fp !== fp;                       // a different token means a new HQ login
  const connectedAt = fresh ? new Date().toISOString() : prev!.connected_at;
  const now = new Date().toISOString();
  const controlKey = randomKey();

  const { error: serr } = await supabase.from("player_sessions").upsert({
    openid, cookies: session, token_fp: fp, source: "bookmarklet", control_key: controlKey,
    connected_at: connectedAt, updated_at: now, last_ok_at: now, last_error: null,
  }, { onConflict: "openid" });
  if (serr) return json({ error: serr.message }, 500);

  // How long one HQ login actually survives, measured rather than assumed.
  if (fresh) await supabase.from("players").update({ token_seen_since: now }).eq("openid", openid);

  // Don't wait a minute for cron: start collecting straight away, in the background.
  const kick = pokePoller(openid);
  // @ts-ignore EdgeRuntime is Supabase-specific
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(kick); else await kick.catch(() => {});

  // The hand-over is the login, so it ends by handing back a real session.
  const authSession = await mintSession(openid, nickname);

  // No shared code goes back with the response any more: a player who wants to invite someone asks
  // the account panel for a link of the kind they mean, and gets a row of their own.
  return json({
    ok: true, openid, nickname, avatar, level, fresh, connected_at: connectedAt,
    control_key: controlKey, joined: !existing, on_squad: onSquad, session: authSession,
  });
});

/**
 * What a code in the link entitles the bearer to, or null if it entitles them to nothing.
 *
 * Both shapes are matched by equality against the column that stores them — never a pattern match,
 * because `like` on a string a caller sends would let `%` match every row in the table. Group codes
 * are upper-case and invite codes are lower-case hex, so either can be typed in any case.
 */
async function resolveCode(raw: string) {
  const code = (raw || "").trim().slice(0, 128);
  if (!code) return null;

  const { data: g } = await supabase.from("groups").select("id, code").eq("code", code.toUpperCase()).maybeSingle();
  if (g) return { group: g.id as string, via: "group:" + g.code, solo: false };

  const { data: l } = await supabase.from("invites").select("code, kind, group_id, revoked_at, uses").eq("code", code.toLowerCase()).maybeSingle();
  if (!l || l.revoked_at) return null;
  await supabase.from("invites")
    .update({ uses: (l.uses ?? 0) + 1, last_used_at: new Date().toISOString() })
    .eq("code", l.code);
  return { group: (l.group_id as string | null) ?? null, via: l.code as string, solo: l.kind === "solo" };
}

/**
 * A real Supabase session for the openid HQ has just vouched for.
 *
 * No password is created and no email is sent: the magic link is generated with the service role
 * and redeemed here, so the browser only ever sees the finished session. The openid goes into
 * `app_metadata`, which lands in the JWT, so RLS can name the player without a lookup.
 */
async function mintSession(openid: string, nickname: string | null) {
  const email = `${openid}@openid.deltaforce.local`;
  const { data: player } = await supabase.from("players").select("auth_user_id").eq("openid", openid).maybeSingle();
  let userId: string | null = player?.auth_user_id ?? null;

  if (!userId) {
    const { data: made } = await supabase.auth.admin.createUser({
      email, email_confirm: true, app_metadata: { openid }, user_metadata: { nickname },
    });
    userId = made?.user?.id ?? null;                       // may fail because the address already exists
  }

  const { data: link, error: lerr } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = (link as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token;
  if (lerr || !hashed) return null;

  // An address that existed without us knowing its id — an earlier mint whose bookkeeping failed —
  // is adopted here rather than left to fail forever, and given the claim it was missing.
  const linked = (link as { user?: { id?: string } } | null)?.user?.id ?? null;
  if (!userId && linked) {
    userId = linked;
    await supabase.auth.admin.updateUserById(userId, { app_metadata: { openid } });
  }
  if (userId && userId !== player?.auth_user_id) {
    await supabase.from("players").update({ auth_user_id: userId }).eq("openid", openid);
  }

  const res = await fetch(SUPA_URL + "/auth/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ type: "email", token_hash: hashed }),
  });
  const j = await res.json().catch(() => null);
  if (!j?.access_token) return null;
  return { access_token: j.access_token, refresh_token: j.refresh_token ?? null, expires_in: Number(j.expires_in) || 3600 };
}

async function pokePoller(openid: string) {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "poll_secret").maybeSingle();
  if (!data?.value) return;
  await fetch(SUPA_URL + "/functions/v1/poll", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: data.value, openid }),
  });
}
