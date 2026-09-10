import { CONFIG } from "./config.js";
import { readSession, getMatchList, getMatchDetail, getMyData, getRedDrops, getPrivateRoomKey, isAuthError, REPORT_TYPE } from "./dfapi.js";

const ALARM = "df-live-poll";
const INGEST_URL = CONFIG.SUPABASE_URL + "/functions/v1/ingest";

// ---------- state helpers ----------
async function getState() {
  const s = await chrome.storage.local.get(["state", "known", "knownRed", "settings"]);
  return {
    state: s.state || { tokenOk: null, lastPoll: null, lastError: null, newest: null, registered: false, nickname: null, backfill: {} },
    known: s.known || {},          // { openid: { "1:room_id": 1 | 2, ... } }  1 = listed, 2 = detail pushed
    knownRed: s.knownRed || {},    // { openid: { "collection_id:unlock_time": 1 } }
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
  if (msg && msg.type === "poll-now") { poll().then(async () => reply({ ok: true, ...(await publicStatus()) })).catch(e => reply({ ok: false, error: String(e) })); return true; }
  if (msg && msg.type === "reset-known") { chrome.storage.local.set({ known: {} }).then(() => reply({ ok: true })); return true; }
  if (msg && msg.type === "status") { publicStatus().then(s => reply({ ok: true, ...s })).catch(e => reply({ ok: false, error: String(e) })); return true; }
  if (msg && msg.type === "set-code") { setSquadCode(msg.payload && msg.payload.code).then(reply).catch(e => reply({ ok: false, error: String(e) })); return true; }
});

/* What the popup and the live site are allowed to see: never the HQ session, the token or the ingest key. */
async function publicStatus() {
  const { state, settings } = await getState();
  return {
    version: chrome.runtime.getManifest().version,
    tokenOk: state.tokenOk, sessionSince: state.tokenSeenSince || null,
    lastPoll: state.lastPoll || null, newest: state.newest ? state.newest.match_time : null,
    pushed: state.pushed || 0, detailsPending: state.detailsPending || 0,
    nickname: state.nickname || null, hasCode: !!settings.squadCode, registered: !!settings.ingestKey,
    error: state.lastError || null
  };
}

async function setSquadCode(code) {
  const c = String(code || "").trim();
  if (!c) return { ok: false, error: "Empty squad code" };
  const { settings } = await getState();
  const changed = c !== settings.squadCode;
  await chrome.storage.local.set({ settings: { ...settings, squadCode: c, ingestKey: changed ? "" : settings.ingestKey } });
  await poll();
  return { ok: true, ...(await publicStatus()) };
}

/* The HQ token cookie carries no expiry, so the only way to learn a session's real
   lifetime is to watch one: fingerprint it (never store or send the token itself)
   and remember when that fingerprint first appeared. */
async function tokenFingerprint(token) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}

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
    const { state: st0 } = await getState();
    const fp = await tokenFingerprint(session.token);
    const tokenSeenSince = st0.tokenFp === fp && st0.tokenSeenSince ? st0.tokenSeenSince : Date.now();
    if (st0.tokenFp !== fp || !st0.tokenSeenSince) await saveState({ tokenFp: fp, tokenSeenSince });

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
        if (!mine[key]) { newRows.push({ ...m, report_type: rt }); mine[key] = String(m.match_time || 1); }
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
        if (!mine[key]) { newRows.push({ ...m, report_type: rt, _backfill: true }); mine[key] = String(m.match_time || 1); }
      }
      backfill[rt] = list.length < CONFIG.PAGE_SIZE ? "done" : nextPage;
    }

    // Details: all fresh matches now, plus a slow backfill of 2 older matches per poll (mine[key] 1 -> 2 once pushed).
    const details = [];
    const wantDetail = newRows.filter(r => !r._backfill).map(r => ({ rt: r.report_type, room_id: r.room_id, match_time: r.match_time }));
    const pending = Object.entries(mine).filter(([, v]) => v !== 2).filter(([k]) => !wantDetail.some(w => `${w.rt}:${w.room_id}` === k));
    for (const [k, v] of pending.slice(0, 2)) { const [rt, room_id] = k.split(":"); wantDetail.push({ rt: Number(rt), room_id, match_time: typeof v === "string" && v !== "1" ? v : null, _backfill: true }); }
    for (const w of wantDetail.slice(0, 7)) {
      try {
        const env = await getMatchDetail(session, w.rt, w.room_id, w.match_time);
        if (env.code === 0 && env.data && Array.isArray(env.data.members)) details.push({ room_id: w.room_id, report_type: w.rt, raw: env.data });
        mine[`${w.rt}:${w.room_id}`] = 2;   // fetched (or permanently unavailable): don't retry forever
      } catch (e) { console.warn("detail failed", e); }
    }

    // Red drops: page 1 every poll (diff), plus one deeper page per poll until history is imported.
    const { knownRed } = await getState();
    const myRed = knownRed[session.openid] || {};
    const redDrops = [];
    const redPage = state.redPage === "done" ? null : (state.redPage || 1);
    for (const page of redPage === 1 || redPage === null ? [1] : [1, redPage]) {
      try {
        const env = await getRedDrops(session, page, 20);
        if (env.code !== 0) break;
        const list = (env.data && env.data.list) || [];
        for (const r of list) { const k = `${r.collection_id}:${r.unlock_time}`; if (!myRed[k]) { redDrops.push(r); myRed[k] = 1; } }
        if (page !== 1) state.redPage = list.length < 20 ? "done" : page + 1;
        else if (redPage === 1) state.redPage = list.length < 20 ? "done" : 2;
      } catch (e) { console.warn("red drops failed", e); }
    }

    // Daily passwords: once an hour, whoever polls first.
    let dailyPasswords = null;
    if (!state.lastPasswordFetch || Date.now() - state.lastPasswordFetch > 3600e3) {
      try { const env = await getPrivateRoomKey(); if (env.code === 0 && env.data) dailyPasswords = env.data; state.lastPasswordFetch = Date.now(); }
      catch (e) { console.warn("passwords failed", e); }
    }

    const body = {
      action: "ingest", openid: session.openid, ingest_key: ingestKey,
      matches: newRows.map(({ _backfill, ...m }) => m), details, red_drops: redDrops, daily_passwords: dailyPasswords,
      status: { token_ok: true, token_expires: session.token_expires || null, token_seen_since: Math.round(tokenSeenSince / 1000) }
    };
    const res = await postIngest(body);
    if (!res.ok) { await saveState({ lastPoll: Date.now(), lastError: "Ingest failed: " + res.error }); await setBadge("!", "#d03b3b"); return; }

    known[session.openid] = mine; knownRed[session.openid] = myRed;
    const newest = newestOf(newRows) ?? state.newest;
    await chrome.storage.local.set({ known, knownRed });
    await saveState({ tokenOk: true, lastPoll: Date.now(), lastError: null, newest, backfill, redPage: state.redPage, lastPasswordFetch: state.lastPasswordFetch,
      pushed: (state.pushed || 0) + newRows.length, detailsPending: Object.values(mine).filter(v => v !== 2).length });
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
