// Delta Force Live: the server-side poller. pg_cron calls this every minute; for every session
// handed over from the connect page it reads HQ as that player and writes new matches straight
// into Postgres, so nothing has to run on the player's machine.
//   { secret } -> poll every connected player
//   { secret, openid } -> poll one (used by the connect page right after a hand-over)
import { createClient } from "npm:@supabase/supabase-js@2";
import { getMatchDetail, getMatchList, getMyData, getPrivateRoomKey, getRedCollection, getRedDrops, getWeekCalendar, isAuthError, type Session } from "./hq.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const PAGE_SIZE = 20;
const BACKFILL_PAGES = 15;        // ~300 matches of history per mode, one page per run
const DETAILS_PER_RUN = 5;
const MODES = [1, 2];             // 1 = Operations, 2 = Warfare

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const nowIso = () => new Date().toISOString();
const toInt = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };
const clampStr = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
// Anything first seen more than 6 h after it happened is history, not a live match: keep it out of latency stats.
const firstSeen = (t: number | null) => (t && Date.now() / 1000 - t > 6 * 3600 ? new Date(t * 1000).toISOString() : nowIso());

type Row = { openid: string; cookies: Session; backfill: Record<string, unknown> };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* cron sends a body, a manual curl may not */ }

  const { data: sec } = await supabase.from("app_settings").select("value").eq("key", "poll_secret").maybeSingle();
  if (!sec?.value || body?.secret !== sec.value) return json({ error: "forbidden" }, 403);

  let q = supabase.from("player_sessions").select("openid, cookies, backfill");
  if (typeof body.openid === "string") q = q.eq("openid", body.openid);
  const { data: rows, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const players = [];
  for (const row of (rows ?? []) as Row[]) players.push(await pollOne(row));
  return json({ ok: true, at: nowIso(), players });
});

async function pollOne(row: Row) {
  const s = row.cookies, openid = row.openid;
  const report: Record<string, unknown> = { openid, matches: 0, details: 0, reds: 0 };
  try {
    const fresh: any[] = [];
    for (const rt of MODES) {
      const env = await getMatchList(s, rt, 1, PAGE_SIZE);
      if (Number(env.code) !== 0) {
        if (isAuthError(env)) return await loggedOut(openid, env.msg || "HQ refused the session");
        report.warn = env.msg || ("code " + env.code);
        continue;
      }
      for (const m of env.data?.list ?? []) fresh.push({ ...m, report_type: rt });
    }

    // One extra page of history per mode per run, until the pages run out or the cap is hit.
    const bf: Record<string, unknown> = { ...(row.backfill ?? {}) };
    for (const rt of MODES) {
      const cur = bf[rt];
      if (cur === "done") continue;
      const next = (typeof cur === "number" ? cur : 1) + 1;
      if (next > BACKFILL_PAGES) { bf[rt] = "done"; continue; }
      const env = await getMatchList(s, rt, next, PAGE_SIZE);
      if (Number(env.code) !== 0) continue;
      const list = env.data?.list ?? [];
      for (const m of list) fresh.push({ ...m, report_type: rt });
      bf[rt] = list.length < PAGE_SIZE ? "done" : next;
    }

    report.matches = await storeMatches(openid, fresh);
    report.details = await storeDetails(s, openid);
    report.reds = await storeReds(s, openid, bf);
    report.stats = await storeStats(s, openid);
    report.carried = await storeCarryOut(s, openid);
    report.wall = await storeCollection(s, openid);
    await maybePasswords(openid);

    await supabase.from("players").update({ token_ok: true, last_poll_at: nowIso() }).eq("openid", openid);
    await supabase.from("player_sessions").update({ last_ok_at: nowIso(), last_error: null, backfill: bf }).eq("openid", openid);
  } catch (e) {
    report.error = String(e);
    await supabase.from("player_sessions").update({ last_error: String(e) }).eq("openid", openid);
  }
  return report;
}

/** HQ says this session is dead. Keep the row so the board can say "reconnect" instead of going blank. */
async function loggedOut(openid: string, msg: string) {
  await supabase.from("players").update({ token_ok: false, last_poll_at: nowIso() }).eq("openid", openid);
  await supabase.from("player_sessions").update({ last_error: "HQ session expired: " + msg }).eq("openid", openid);
  return { openid, expired: true, error: msg };
}

async function storeMatches(openid: string, list: any[]) {
  const rows = list.map((m) => {
    const t = toInt(m.match_time);
    return {
      openid, report_type: toInt(m.report_type), room_id: clampStr(m.room_id, 64),
      match_time: t ? new Date(t * 1000).toISOString() : null,
      map_id: toInt(m.map_id), result: toInt(m.result), is_leave: toInt(m.is_leave),
      kill_count: toInt(m.kill_count), carry_out_value: toInt(m.carry_out_value), net_income: toInt(m.net_income),
      operator_id: clampStr(m.operator_id, 32), score: toInt(m.score),
      first_seen_at: firstSeen(t), raw: m,
    };
  }).filter((r) => r.room_id && r.report_type && r.match_time);
  if (!rows.length) return 0;
  // ignoreDuplicates keeps the original first_seen_at when a match is seen again.
  const { data, error } = await supabase.from("matches").upsert(rows, { onConflict: "openid,report_type,room_id", ignoreDuplicates: true }).select("room_id");
  if (error) throw new Error("matches: " + error.message);
  return data?.length ?? 0;
}

async function storeDetails(s: Session, openid: string) {
  const { data: pending } = await supabase
    .from("pending_details").select("report_type, room_id, match_time, detail_tries")
    .eq("openid", openid).order("match_time", { ascending: false }).limit(DETAILS_PER_RUN);
  let done = 0;
  for (const p of pending ?? []) {
    const secs = p.match_time ? Math.round(new Date(p.match_time).getTime() / 1000) : undefined;
    let env;
    try { env = await getMatchDetail(s, p.report_type, p.room_id, secs); } catch { env = null; }
    if (!env || Number(env.code) !== 0 || !Array.isArray(env.data?.members)) {
      await supabase.from("matches").update({ detail_tries: (p.detail_tries ?? 0) + 1 }).eq("openid", openid).eq("report_type", p.report_type).eq("room_id", p.room_id);
      continue;
    }
    await supabase.from("match_details").upsert({ openid, report_type: p.report_type, room_id: p.room_id, raw: env.data }, { onConflict: "openid,report_type,room_id" });
    // The player's own finish_time is the real "match ended" moment, which is what latency measures against.
    const me = env.data.members.find((x: any) => x && (x.is_self === true || x.is_self === 1 || x.is_self === "1"));
    const patch: Record<string, unknown> = {};
    const fin = toInt(me?.finish_time);
    const durMin = Number(env.data.match_duration);
    if (fin) patch.finished_at = new Date(fin * 1000).toISOString();
    if (Number.isFinite(durMin)) patch.match_duration_min = durMin;
    // Only the detail splits the kill total into players and AI, and only operator kills belong
    // in a K/D. The list row has the total alone, so carry the split over while we have it.
    const ko = toInt(me?.kill_operator), kai = toInt(me?.kill_other);
    if (ko !== null) patch.kill_operator = ko;
    if (kai !== null) patch.kill_other = kai;
    if (Object.keys(patch).length) await supabase.from("matches").update(patch).eq("openid", openid).eq("report_type", p.report_type).eq("room_id", p.room_id);
    done++;
  }
  return done;
}

async function storeReds(s: Session, openid: string, bf: Record<string, unknown>) {
  const pages = [1];
  const deep = bf.red;
  if (typeof deep === "number" && deep > 1) pages.push(deep);
  let stored = 0;
  for (const page of pages) {
    const env = await getRedDrops(s, page, PAGE_SIZE);
    if (Number(env.code) !== 0) break;
    const list = env.data?.list ?? [];
    const rows = list.map((r: any) => {
      const t = toInt(r.unlock_time);
      return {
        openid, collection_id: clampStr(r.collection_id, 32), map_id: toInt(r.map_id),
        unlock_time: t ? new Date(t * 1000).toISOString() : null,
        value: toInt(r.value), collection_count: toInt(r.collection_count),
        first_seen_at: firstSeen(t), raw: r,
      };
    }).filter((r: any) => r.collection_id && r.unlock_time);
    if (rows.length) {
      const { data } = await supabase.from("red_drops").upsert(rows, { onConflict: "openid,collection_id,unlock_time", ignoreDuplicates: true }).select("collection_id");
      stored += data?.length ?? 0;
    }
    if (page === 1) bf.red = bf.red === "done" ? "done" : list.length < PAGE_SIZE ? "done" : (typeof deep === "number" ? deep : 1) + 1;
    else bf.red = list.length < PAGE_SIZE ? "done" : page + 1;
  }
  return stored;
}

/** The career/season summary HQ shows above the match list, and the rank score inside it. */
async function storeStats(s: Session, openid: string) {
  let done = 0;
  for (const rt of MODES) {
    const env = await getMyData(s, rt).catch(() => null);
    if (!env || Number(env.code) !== 0 || !env.data) continue;
    await supabase.from("player_stats").upsert({ openid, report_type: rt, raw: env.data, fetched_at: nowIso() }, { onConflict: "openid,report_type" });
    // HQ only ever states the standing, never what a match was worth, so the history is made here:
    // one row each time the number moves. Sampling an unchanged score every minute would bury the
    // movements in duplicates, so the previous sample is the one thing worth reading first.
    const score = toInt(env.data?.rank_data?.current_rank_score);
    if (score !== null) {
      const { data: last } = await supabase
        .from("rank_samples").select("rank_score")
        .eq("openid", openid).eq("report_type", rt).order("taken_at", { ascending: false }).limit(1).maybeSingle();
      if (!last || last.rank_score !== score) {
        await supabase.from("rank_samples").insert({ openid, report_type: rt, rank_score: score, taken_at: nowIso() });
      }
    }
    done++;
  }
  return done;
}

/**
 * The gold items. HQ's drop record list returns grade 6 and nothing else — it calls that endpoint
 * with exactly our six params and filters no grades client-side, so grade 6 is the endpoint's
 * whole answer. Gold lives in the week calendar instead, as a tally of the current week: an item,
 * its unit value, and how many were carried out. There is no per-drop time or map to be had, and
 * no way to ask for an earlier week, so each run refreshes the current week in place.
 */
async function storeCarryOut(s: Session, openid: string) {
  const env = await getWeekCalendar(s).catch(() => null);
  if (!env || Number(env.code) !== 0 || !env.data) return 0;
  const items = env.data.carry_out_items ?? [];
  if (!Array.isArray(items) || !items.length) return 0;
  // Which week this is, in HQ's own reckoning rather than ours: the latest quarter week that has
  // already started. Falling back to Monday 00:00 UTC keeps a row landing if that list is absent.
  const now = Date.now() / 1000;
  const starts = (env.data.quarter_weeks ?? []).map((w: any) => toInt(w?.week_start_timestamp)).filter((t: number | null): t is number => !!t && t <= now);
  const weekStart = starts.length ? Math.max(...starts) : Math.floor((now - ((new Date().getUTCDay() + 6) % 7) * 86400) / 86400) * 86400;
  const rows = items.map((r: any) => ({
    openid, week_start: new Date(weekStart * 1000).toISOString(),
    item_id: clampStr(r.item_id, 32), item_value: toInt(r.item_value), carry_out_count: toInt(r.carry_out_count),
    fetched_at: nowIso(),
  })).filter((r: any) => r.item_id);
  if (!rows.length) return 0;
  const { error } = await supabase.from("carry_out_week").upsert(rows, { onConflict: "openid,week_start,item_id" });
  return error ? 0 : rows.length;
}

/**
 * The career red wall. The drop record list is capped at its latest 50 rows, so it cannot say what
 * an account has found over its whole life; this can — one entry per red type ever found, with how
 * many of each, and HQ's own career totals. Names, values and source maps are deliberately not
 * stored: they are in the official basic_info table the page already loads.
 */
async function storeCollection(s: Session, openid: string) {
  const env = await getRedCollection(s).catch(() => null);
  if (!env || Number(env.code) !== 0 || !env.data) return 0;
  const list = env.data.collection_list ?? [];
  if (!Array.isArray(list)) return 0;
  const rows = list.map((r: any) => ({
    openid, item_id: clampStr(r.item_id, 32), owned_count: toInt(r.count), is_new: !!r.is_new, fetched_at: nowIso(),
  })).filter((r: any) => r.item_id);
  if (rows.length) await supabase.from("red_collection").upsert(rows, { onConflict: "openid,item_id" });
  await supabase.from("red_collection_summary").upsert({
    openid,
    type_count: toInt(env.data.dahong_type_count), total_count: toInt(env.data.dahong_total_count),
    total_value: toInt(env.data.dahong_total_value), weekly_count: toInt(env.data.weekly_collect_count),
    fetched_at: nowIso(),
  }, { onConflict: "openid" });
  return rows.length;
}

/** Daily private-room passwords: unauthenticated, so whoever polls first refreshes them hourly. */
async function maybePasswords(openid: string) {
  const { data } = await supabase.from("site_data").select("updated_at").eq("key", "daily_passwords").maybeSingle();
  if (data?.updated_at && Date.now() - new Date(data.updated_at).getTime() < 3600e3) return;
  const env = await getPrivateRoomKey().catch(() => null);
  if (!env || Number(env.code) !== 0 || !env.data) return;
  await supabase.from("site_data").upsert({ key: "daily_passwords", value: env.data, updated_at: nowIso(), updated_by: openid }, { onConflict: "key" });
}
