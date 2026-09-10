// Signs and calls the official HQ backend the way the HQ page itself does, with a
// session handed over from the browser. Same signature scheme the HQ page itself uses.
// MD5 comes from the Deno standard library rather than a hand-rolled copy: a wrong digest
// here would fail every call in a way that looks like a login problem.
import { crypto as stdCrypto } from "jsr:@std/crypto@1/crypto";
import { encodeHex } from "jsr:@std/encoding@1/hex";

const API_HOST = "https://sg-act.playerinfinite.com";
const APP_ID = "10005";
const APP_KEY = "intel#!2022$act";
const GAME_ID = "29158";

export const COOKIE_NAMES = ["openid", "token", "game_id", "channel", "encodeparam", "role_id", "zone_id", "area_id", "plat_id"];
export const REPORT_TYPE = { OPERATIONS: 1, WARFARE: 2 };
export type Session = Record<string, string>;
export type Envelope = { code: number; msg?: string; data?: any };

export async function md5(s: string) {
  return encodeHex(await stdCrypto.subtle.digest("MD5", new TextEncoder().encode(s)));
}

async function signedUrl(path: string, query: Record<string, string>) {
  const ts = Math.round(Date.now() / 1000).toString();
  const u = crypto.randomUUID();
  const rel = path + "?" + new URLSearchParams(query).toString() + `&u=${u}&a=${APP_ID}&ts=${ts}`;
  return API_HOST + rel + "&s=" + await md5(decodeURI(rel) + "&appkey=" + APP_KEY);
}

function authOf(session: Session) {
  const auth: Record<string, string> = {
    openid: session.openid, token: session.token,
    game_id: session.game_id || GAME_ID, account_type: "1", lang_type: "en",
  };
  for (const k of ["channel", "encodeparam", "role_id", "zone_id", "area_id", "plat_id"]) if (session[k]) auth[k] = session[k];
  return auth;
}

/** POST to an authenticated DfTools endpoint. */
export async function call(session: Session, endpoint: string, body: Record<string, unknown>): Promise<Envelope> {
  const auth = authOf(session);
  const res = await fetch(await signedUrl("/api/proxy/logicial/DfTools/" + endpoint, auth), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Referer": "https://www.playdeltaforce.com/" },
    body: JSON.stringify({ ...auth, needLogin: true, ...body }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
  return res.json();
}

export const getMyData = (s: Session, reportType: number) => call(s, "GetMyData", { seasonno: [], report_type: reportType });
export const getMatchList = (s: Session, reportType: number, page = 1, pageSize = 20) =>
  call(s, "GetMatchList", { map_id: [], show_net_income: true, page, page_size: pageSize, report_type: reportType });
export const getMatchDetail = (s: Session, reportType: number, roomId: string, matchTime?: number | string) =>
  call(s, "GetMatchDetail", matchTime ? { room_id: roomId, report_type: reportType, match_time: String(matchTime) } : { room_id: roomId, report_type: reportType });
export const getRedDrops = (s: Session, page = 1, pageSize = 20) =>
  call(s, "GetRedDropRecordList", { page, page_size: pageSize, collection_id: "", map_id: "", value_order: 0, unlock_time_order: 0 });
// The week's carry-out tally, and the only place gold items appear: the drop record list above
// answers with grade 6 alone. Takes no arguments — HQ can only ever ask for the current week.
export const getWeekCalendar = (s: Session) => call(s, "GetAssetWeekCalendar", {});

/** Daily private-room passwords: signed but unauthenticated, so also a signature self-test. */
export async function getPrivateRoomKey(): Promise<Envelope> {
  const url = await signedUrl("/api/proxy_direct/logicial/DfTools/GetPrivateRoomKey", { lang_type: "en" });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ needLogin: false, lang_type: "en" }) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from GetPrivateRoomKey`);
  return res.json();
}

/** Codes HQ uses for "you are logged out". Anything else is a transient error. */
export function isAuthError(env: Envelope | null) {
  if (!env) return false;
  const c = Number(env.code);
  // 300001 "not login param" is what the API says when the identity fields are missing or stale.
  return c === 22000 || c === 300001 || c === 1001 || c === 1002 || c === 1003 || c === 2001 || /login|token|permission|auth/i.test(env.msg || "");
}

/** Keep only the cookies we know, and only when a usable pair is present. */
export function cleanSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Session = {};
  for (const k of COOKIE_NAMES) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "string" && v && v.length <= 4096) out[k] = v;
  }
  return out.openid && out.token ? out : null;
}

/** Short digest of the token: tells a re-hand-over of the same login from a fresh one. */
export async function fingerprint(token: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
