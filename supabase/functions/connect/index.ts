// Delta Force Live: takes an HQ session handed over from the site's connect flow.
// The bookmarklet reads the HQ page's own cookies and navigates to /connect.html#..., which POSTs here.
//   { cookies: { openid, token, ... } } -> { ok, openid, nickname, avatar, level, fresh, connected_at, control_key }
//   { action: "invite", openid, control_key, kind } -> { ok, code, kind }
//   { action: "disconnect", openid, control_key } -> { ok }
//   { action: "probe" } -> signature self-test
//
// Nobody types anything on this path. A hand-over is proved against HQ itself before anything is
// stored, which is stronger than any secret the page could hold: only the account owner can produce
// working cookies for their openid. The one thing that still needs a gate is enrolment, and that
// travels in the link instead of the player's fingers — `connect.html?i=<code>`. An openid the
// board already knows needs no invite; an empty board is claimed by its first hand-over.
//
// An invite is a row in `invites` rather than one shared secret, so it carries what it was for:
// a squad link puts the mate on the board, a solo link gives them the tracker for their own stats
// and leaves them off it.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cleanSession, fingerprint, getMyData, getPrivateRoomKey, isAuthError, md5, REPORT_TYPE } from "./hq.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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
    if (kind === "squad" && who?.on_squad === false) return json({ error: "a solo tracker cannot invite anyone to the squad" }, 403);
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
  let via: string | null = null;
  let onSquad = existing ? existing.on_squad !== false : true;
  if (!existing) {
    const { count } = await supabase.from("players").select("openid", { count: "exact", head: true });
    if ((count ?? 0) === 0) {
      via = "first";                                                   // empty board: the first hand-over claims it
    } else {
      // Codes are lowercase hex both when we make them and when Postgres made the original, so the
      // link can be matched case-insensitively with a plain equality on the lowercased input. Never
      // a pattern match: `ilike` on anything a caller sends would let `%` match every row.
      const invite = typeof body.invite === "string" ? body.invite.trim().slice(0, 128).toLowerCase() : "";
      const link = invite
        ? (await supabase.from("invites").select("code, kind, revoked_at, uses").eq("code", invite).maybeSingle()).data
        : null;
      if (!link || link.revoked_at) {
        return json({ error: "this board needs an invite link", reason: invite ? "bad-invite" : "not-enrolled" }, 403);
      }
      via = link.code;                                                 // the code itself, so a join traces back to its link
      onSquad = link.kind !== "solo";
      await supabase.from("invites")
        .update({ uses: (link.uses ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq("code", link.code);
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

  // No shared code goes back with the response any more: a player who wants to invite someone asks
  // the account panel for a link of the kind they mean, and gets a row of their own.
  return json({
    ok: true, openid, nickname, avatar, level, fresh, connected_at: connectedAt,
    control_key: controlKey, joined: !existing, on_squad: onSquad,
  });
});

async function pokePoller(openid: string) {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "poll_secret").maybeSingle();
  if (!data?.value) return;
  await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/poll", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: data.value, openid }),
  });
}
