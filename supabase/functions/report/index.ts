// Delta Force Report: a visitor on loadouts/ saying a build's code does not work.
//   POST { code, reason: "import" | "outdated" | "other", note?, visitor } -> { ok }
// The page is public and the publishable key writes nothing (0021), so this is the only way in, and
// it trusts as little of the request as it can: the code has to be on the site's own build list,
// and creator, weapon and mode come from that list, not from the caller. One report per browser
// (or address) per build a day; past 30 an hour from one address it stops answering yes.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BUILDS_URL = "https://thesitrep.gg/data/loadouts.json";
const REASONS = new Set(["import", "outdated", "other"]);
const DAY = 24 * 3600 * 1000, HOUR = 3600 * 1000;

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// The list changes once a morning at most, so a warm instance keeps it for ten minutes.
type Build = { code: string; creator?: string; weapon?: string; mode?: string };
let list: { at: number; byCode: Map<string, Build> } | null = null;
async function builds() {
  if (list && Date.now() - list.at < 10 * 60 * 1000) return list.byCode;
  const r = await fetch(BUILDS_URL, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error("loadouts.json " + r.status);
  const byCode = new Map<string, Build>(((await r.json()).builds || []).map((b: Build) => [b.code, b]));
  list = { at: Date.now(), byCode };
  return byCode;
}

let salt: string | null = null;
async function hashIp(ip: string) {
  if (salt === null) {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "poll_secret").maybeSingle();
    salt = data?.value || "";
  }
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + "|" + ip));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST a report" }, 405);

  let body: any = null;
  try { body = await req.json(); } catch { /* empty */ }
  const code = typeof body?.code === "string" ? body.code.trim().slice(0, 200) : "";
  const reason = typeof body?.reason === "string" ? body.reason : "";
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 300) || null : null;
  const visitor = typeof body?.visitor === "string" && /^[\w-]{8,64}$/.test(body.visitor) ? body.visitor : null;
  if (!code || !REASONS.has(reason)) return json({ error: "a code and a reason, please" }, 400);

  let b: Build | undefined;
  try { b = (await builds()).get(code); } catch { return json({ error: "could not read the build list" }, 503); }
  if (!b) return json({ error: "that code is not on the list" }, 404);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "";
  const ip_hash = ip ? await hashIp(ip) : null;

  // Already said: the same browser or address on the same build today counts once.
  const since = new Date(Date.now() - DAY).toISOString();
  const who = [visitor && `visitor.eq.${visitor}`, ip_hash && `ip_hash.eq.${ip_hash}`].filter(Boolean).join(",");
  if (who) {
    const { count } = await supabase.from("build_reports").select("id", { count: "exact", head: true })
      .eq("code", code).gte("created_at", since).or(who);
    if (count) return json({ ok: true, already: true });
  }
  if (ip_hash) {
    const { count } = await supabase.from("build_reports").select("id", { count: "exact", head: true })
      .eq("ip_hash", ip_hash).gte("created_at", new Date(Date.now() - HOUR).toISOString());
    if ((count || 0) >= 30) return json({ error: "that is a lot of reports — try again later" }, 429);
  }

  const { error } = await supabase.from("build_reports").insert({
    code, reason, note, visitor, ip_hash, creator: b.creator || null, weapon: b.weapon || null, mode: b.mode || null,
  });
  if (error) return json({ error: "could not save it" }, 500);
  return json({ ok: true });
});
