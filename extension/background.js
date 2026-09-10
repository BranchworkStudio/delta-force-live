import { CONFIG } from "./config.js";
import { readSession, getMatchList, getMatchDetail, getMyData, isAuthError, REPORT_TYPE } from "./dfapi.js";

const ALARM = "df-live-poll";
const INGEST_URL = CONFIG.SUPABASE_URL + "/functions/v1/ingest";

// ---------- state helpers ----------
async function getState() {
  const s = await chrome.storage.local.get(["state", "known", "settings"]);
  return {
    state: s.state || { tokenOk: null, lastPoll: null, lastError: null, newest: null, registered: false, nickname: null, backfill: {} },
    known: s.known || {},          // { openid: { "1:room_id": 1, ... } }
    settings: s.settings || { squadCode: "", ingestKey: "", openid: "" }
  };
}
async function saveState(patch) {
  const { state } = await getState();
  const next = { ...state, ...patch };
  await chrome.storage.local.set({ state: next });
  return next;
}
async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  if (color) await chrome.action.setBadgeBackgroundColor({ color });
}

// ---------- lifecycle ----------
chrome.runtime.onInstalled.addListener(() => schedule());
chrome.runtime.onStartup.addListener(() => schedule());
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) poll().catch(e => console.error(e)); });
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "poll-now") { poll().then(() => reply({ ok: true })).catch(e => reply({ ok: false, error: String(e) })); return true; }
  if (msg && msg.type === "reset-known") { chrome.storage.local.set({ known: {} }).then(() => reply({ ok: true })); return true; }
});

async function schedule() {
  await chrome.alarms.clear(ALARM);
  await chrome.alarms.create(ALARM, { periodInMinutes: CONFIG.POLL_MINUTES, delayInMinutes: 0.1 });
}

// ---------- the poll ----------
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const { settings } = await getState();
    const session = await readSession();
    if (!session) {
      await saveState({ tokenOk: false, lastPoll: Date.now(), lastError: "Not logged in on playdeltaforce.com" });
      await setBadge("!", "#d03b3b");
      return;
    }
    if (!settings.squadCode) {
      await saveState({ tokenOk: true, lastPoll: Date.now(), lastError: "Enter your squad code in the popup" });
      await setBadge("?", "#fab219");
      return;
    }

    // Register (or re-register after a browser change) to obtain the ingest key for this openid.
    let ingestKey = settings.ingestKey;
    if (!ingestKey || settings.openid !== session.openid) {
      const profile = await fetchProfile(session);
      if (profile.authError) return await markLoggedOut(profile.msg);
      const reg = await postIngest({ action: "register", openid: session.openid, squad_code: settings.squadCode, ...profile.player });
      if (!reg.ok) { await saveState({ lastPoll: Date.now(), lastError: "Register failed: " + reg.error }); await setBadge("!", "#d03b3b"); return; }
      ingestKey = reg.ingest_key;
      await chrome.storage.local.set({ settings: { ...settings, ingestKey, openid: session.openid } });
      await saveState({ registered: true, nickname: profile.player.nickname });
    }

    const { known } = await getState();
    const mine = known[session.openid] || {};
    const newRows = [];
    let authError = null;

    for (const rt of [REPORT_TYPE.OPERATIONS, REPORT_TYPE.WARFARE]) {
      const env = await getMatchList(session, rt, 1, CONFIG.PAGE_SIZE);
      if (env.code !== 0) { if (isAuthError(env)) authError = env.msg; continue; }
      for (const m of env.data.list || []) {
        const key = `${rt}:${m.room_id}`;
        if (!mine[key]) { newRows.push({ ...m, report_type: rt }); mine[key] = 1; }
      }
    }
    if (authError) return await markLoggedOut(authError);

    // Slow backfill: one extra page per poll per mode until BACKFILL_PAGES is reached.
    const { state } = await getState();
    const backfill = { ...(state.backfill || {}) };
    for (const rt of [REPORT_TYPE.OPERATIONS, REPORT_TYPE.WARFARE]) {
      const nextPage = (backfill[rt] || 1) + 1;
      if (nextPage > CONFIG.BACKFILL_PAGES || backfill[rt] === "done") continue;
      const env = await getMatchList(session, rt, nextPage, CONFIG.PAGE_SIZE);
      if (env.code !== 0) continue;
      const list = env.data.list || [];
      for (const m of list) {
        const key = `${rt}:${m.room_id}`;
        if (!mine[key]) { newRows.push({ ...m, report_type: rt, _backfill: true }); mine[key] = 1; }
      }
      backfill[rt] = list.length < CONFIG.PAGE_SIZE ? "done" : nextPage;
    }

    // Details only for fresh (non-backfill) matches, to keep request volume low.
    const details = [];
    for (const m of newRows.filter(r => !r._backfill).slice(0, 5)) {
      try {
        const env = await getMatchDetail(session, m.report_type, m.room_id, m.match_time);
        if (env.code === 0 && env.data) details.push({ room_id: m.room_id, report_type: m.report_type, raw: env.data });
      } catch (e) { console.warn("detail failed", e); }
    }

    const body = {
      action: "ingest", openid: session.openid, ingest_key: ingestKey,
      matches: newRows.map(({ _backfill, ...m }) => m), details,
      status: { token_ok: true, token_expires: session.token_expires || null }
    };
    const res = await postIngest(body);
    if (!res.ok) { await saveState({ lastPoll: Date.now(), lastError: "Ingest failed: " + res.error }); await setBadge("!", "#d03b3b"); return; }

    known[session.openid] = mine;
    const newest = newestOf(newRows) ?? state.newest;
    await chrome.storage.local.set({ known });
    await saveState({ tokenOk: true, lastPoll: Date.now(), lastError: null, newest, backfill, pushed: (state.pushed || 0) + newRows.length });
    await setBadge(newRows.length && !newRows.every(r => r._backfill) ? String(newRows.filter(r => !r._backfill).length) : "", "#0ca30c");
  } catch (e) {
    await saveState({ lastPoll: Date.now(), lastError: String(e) });
    await setBadge("!", "#d03b3b");
  } finally {
    polling = false;
  }
}

function newestOf(rows) {
  let best = null;
  for (const r of rows) { const t = Number(r.match_time); if (!best || t > best.match_time) best = { match_time: t, room_id: r.room_id, report_type: r.report_type, first_seen: Date.now() }; }
  return best;
}

async function markLoggedOut(msg) {
  await saveState({ tokenOk: false, lastPoll: Date.now(), lastError: "Session expired: log in again on playdeltaforce.com (" + (msg || "") + ")" });
  await setBadge("!", "#d03b3b");
}

async function fetchProfile(session) {
  const env = await getMyData(session, REPORT_TYPE.OPERATIONS);
  if (env.code !== 0) return isAuthError(env) ? { authError: true, msg: env.msg } : { player: { nickname: null, avatar: null, level: null } };
  const p = (env.data && env.data.player_info) || {};
  return { player: { nickname: p.nickname || null, avatar: p.avatar || null, level: p.level || null } };
}

async function postIngest(body) {
  try {
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": CONFIG.SUPABASE_ANON_KEY, "Authorization": "Bearer " + CONFIG.SUPABASE_ANON_KEY },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || `HTTP ${res.status}` };
    return { ok: true, ...json };
  } catch (e) { return { ok: false, error: String(e) }; }
}
