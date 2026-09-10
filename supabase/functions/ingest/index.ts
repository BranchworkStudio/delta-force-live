// Delta Force Live: ingest endpoint used by the Chrome extension.
// - register: { action, openid, squad_code, nickname?, avatar?, level? } -> { ingest_key }
// - ingest:   { action, openid, ingest_key, matches: [...], details: [...], status: {...} } -> { inserted }
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const clampStr = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
const toInt = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const openid = clampStr(body?.openid, 128);
  if (!openid) return json({ error: "openid required" }, 400);

  if (body.action === "register") {
    const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "squad_code").maybeSingle();
    const SQUAD_CODE = setting?.value ?? "";
    if (!SQUAD_CODE || typeof body.squad_code !== "string" || body.squad_code.trim().toLowerCase() !== SQUAD_CODE.toLowerCase()) return json({ error: "wrong squad code" }, 403);
    const key = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    // New player: insert. Existing player (new browser / reinstall): rotate the key. Requires the squad code either way.
    const { data, error } = await supabase
      .from("players")
      .upsert({
        openid, ingest_key: key,
        nickname: clampStr(body.nickname, 64), avatar: clampStr(body.avatar, 64), level: toInt(body.level),
      }, { onConflict: "openid" })
      .select("ingest_key").single();
    if (error) return json({ error: error.message }, 500);
    return json({ ingest_key: data.ingest_key });
  }

  if (body.action === "ingest") {
    const ingestKey = clampStr(body.ingest_key, 128);
    const { data: player } = await supabase.from("players").select("openid").eq("openid", openid).eq("ingest_key", ingestKey).maybeSingle();
    if (!player) return json({ error: "unknown player or bad ingest key" }, 403);

    const matches = Array.isArray(body.matches) ? body.matches.slice(0, 200) : [];
    const rows = matches.map((m: any) => {
      const t = toInt(m.match_time);
      return {
        openid, report_type: toInt(m.report_type), room_id: clampStr(m.room_id, 64),
        match_time: t ? new Date(t * 1000).toISOString() : null,
        map_id: toInt(m.map_id), result: toInt(m.result), is_leave: toInt(m.is_leave),
        kill_count: toInt(m.kill_count), carry_out_value: toInt(m.carry_out_value), net_income: toInt(m.net_income),
        operator_id: clampStr(m.operator_id, 32), score: toInt(m.score),
        // Backfilled history (older than 6h at first sight) gets first_seen_at = match_time so it doesn't pollute latency stats.
        first_seen_at: t && Date.now() / 1000 - t > 6 * 3600 ? new Date(t * 1000).toISOString() : new Date().toISOString(),
        raw: m,
      };
    }).filter((r: any) => r.room_id && r.report_type && r.match_time);

    let inserted = 0;
    if (rows.length) {
      // ignoreDuplicates keeps the original first_seen_at when a row is re-sent.
      const { data, error } = await supabase.from("matches").upsert(rows, { onConflict: "openid,report_type,room_id", ignoreDuplicates: true }).select("room_id");
      if (error) return json({ error: error.message }, 500);
      inserted = data?.length ?? 0;
    }

    const details = Array.isArray(body.details) ? body.details.slice(0, 20) : [];
    if (details.length) {
      const drows = details
        .map((d: any) => ({ openid, report_type: toInt(d.report_type), room_id: clampStr(d.room_id, 64), raw: d.raw }))
        .filter((d: any) => d.room_id && d.report_type && d.raw && typeof d.raw === "object");
      if (drows.length) await supabase.from("match_details").upsert(drows, { onConflict: "openid,report_type,room_id" });
    }

    const st = body.status ?? {};
    await supabase.from("players").update({
      token_ok: typeof st.token_ok === "boolean" ? st.token_ok : null,
      token_expires: toInt(st.token_expires) ? new Date(toInt(st.token_expires)! * 1000).toISOString() : null,
      last_poll_at: new Date().toISOString(),
    }).eq("openid", openid);

    return json({ inserted });
  }

  return json({ error: "unknown action" }, 400);
});
