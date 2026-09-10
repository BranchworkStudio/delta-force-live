// Thin client for the official Delta Force HQ backend, mirroring what the HQ page itself does.
import { md5 } from "./md5.js";

const API_HOST = "https://sg-act.playerinfinite.com";
const APP_ID = "10005";
const APP_KEY = "intel#!2022$act";
const GAME_ID = "29158";
const COOKIE_DOMAIN_URL = "https://www.playdeltaforce.com/";
const COOKIE_NAMES = ["openid", "token", "game_id", "channel", "encodeparam", "role_id", "zone_id", "area_id", "plat_id"];

export const REPORT_TYPE = { OPERATIONS: 1, WARFARE: 2 };

/** Read the HQ page's own login cookies. Returns null when not logged in. */
export async function readSession() {
  const out = {};
  for (const name of COOKIE_NAMES) {
    const c = await chrome.cookies.get({ url: COOKIE_DOMAIN_URL, name: "Wand_DF_" + name });
    if (c && c.value) out[name] = decodeURIComponent(c.value);
    if (name === "token" && c && c.expirationDate) out.token_expires = c.expirationDate;
  }
  if (!out.openid || !out.token) return null;
  return out;
}

function signedUrl(path, query) {
  const ts = Math.round(Date.now() / 1000).toString();
  const u = crypto.randomUUID();
  let rel = path + "?" + new URLSearchParams(query).toString() + `&u=${u}&a=${APP_ID}&ts=${ts}`;
  const sig = md5(decodeURI(rel) + "&appkey=" + APP_KEY);
  return API_HOST + rel + "&s=" + sig;
}

/** POST to an authenticated DfTools endpoint. Resolves to the parsed JSON envelope {code,msg,data}. */
export async function call(session, endpoint, body) {
  const auth = {
    openid: session.openid, token: session.token,
    game_id: session.game_id || GAME_ID, account_type: "1", lang_type: "en"
  };
  for (const k of ["channel", "encodeparam", "role_id", "zone_id", "area_id", "plat_id"]) if (session[k]) auth[k] = session[k];
  const url = signedUrl("/api/proxy/logicial/DfTools/" + endpoint, auth);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...auth, needLogin: true, ...body })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
  return res.json();
}

export function getMatchList(session, reportType, page = 1, pageSize = 20) {
  return call(session, "GetMatchList", { map_id: [], show_net_income: true, page, page_size: pageSize, report_type: reportType });
}

export function getMatchDetail(session, reportType, roomId, matchTime) {
  return call(session, "GetMatchDetail", { room_id: roomId, report_type: reportType, match_time: matchTime });
}

export function getMyData(session, reportType) {
  return call(session, "GetMyData", { seasonno: [], report_type: reportType });
}

/** Codes the HQ page treats as "you are logged out". Anything else is a transient error. */
export function isAuthError(envelope) {
  if (!envelope) return false;
  const c = Number(envelope.code);
  // 22000 "not permission" observed for invalid identity; 1xxx/2xxx auth family used by the intl proxy.
  return c === 22000 || c === 1001 || c === 1002 || c === 1003 || c === 2001 || /login|token|permission|auth/i.test(envelope.msg || "");
}
