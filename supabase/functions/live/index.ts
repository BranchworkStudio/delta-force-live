// Delta Force Live: which loadout creators are streaming right now.
//   POST { secret } -> pg_cron, every 3 minutes: check every creator's Twitch and YouTube, store it
//   POST { secret, probe } -> check one channel link and store nothing
//   GET             -> the site: the last check, cached for a minute
// The creator list is the site's own loadouts.json, so a creator added there is checked here with
// nothing to change. No Twitch or YouTube keys: both put a live marker in the channel page itself
// (Twitch's JSON-LD says isLiveBroadcast, YouTube's Streams tab badges the stream that is LIVE), which is all this
// needs. The publishable key still reads nothing; the site gets this through GET, never the table.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CREATORS_URL = "https://thesitrep.gg/data/loadouts.json";
// A check older than this is not shown at all: a cron that stopped must not leave someone "live".
const STALE_MS = 15 * 60 * 1000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });

type Stream = { platform: "twitch" | "youtube"; url: string; title: string | null; since: string | null };

const clip = (s: string | null | undefined, n = 140) => (s ? s.slice(0, n) : null);

// The last page fetched, for the probe to report when a check finds nothing it understands.
let last: { url: string; status: number; length: number; head: string } | null = null;
async function page(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en", Cookie: "SOCS=CAI; CONSENT=YES+" }, redirect: "follow", signal: AbortSignal.timeout(10000) });
    const t = await r.text();
    last = { url: r.url, status: r.status, length: t.length, head: (t.match(/<title>[^<]*<\/title>/)?.[0] || t.slice(0, 200)) };
    return r.ok ? t : null;
  } catch (e) { last = { url, status: 0, length: 0, head: String(e) }; return null; }
}

async function twitch(link: string): Promise<Stream | null> {
  const name = link.match(/twitch\.tv\/([A-Za-z0-9_]+)/)?.[1];
  if (!name) return null;
  const url = `https://www.twitch.tv/${name.toLowerCase()}`;
  const t = await page(url);
  if (!t || !t.includes('"isLiveBroadcast":true')) return null;
  let title: string | null = null, since: string | null = null;
  for (const m of t.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)) {
    try {
      const g = JSON.parse(m[1]);
      for (const o of (g["@graph"] || [g])) {
        const p = Array.isArray(o.publication) ? o.publication[0] : o.publication;
        if (p && p.isLiveBroadcast) { title = o.description || null; since = p.startDate || o.uploadDate || null; }
      }
    } catch { /* not this block */ }
  }
  return { platform: "twitch", url, title: clip(title), since };
}

// A channel's /live page would say it outright, but YouTube shows a server (no cookies, a datacenter
// address) a player page with everything stripped. Its Streams tab is not gated, and a stream that
// is on air right now is the one there wearing the LIVE badge (scheduled and past ones wear the
// default one). The title comes from oEmbed, which is not gated either.
async function youtube(link: string): Promise<Stream | null> {
  const m = link.match(/youtube\.com\/((?:@|c\/|channel\/|user\/)[^/?#]+)/i);
  if (!m) return null;
  const t = await page(`https://www.youtube.com/${m[1]}/streams`);
  const i = t ? t.indexOf("THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE") : -1;
  if (!t || i < 0) return null;
  const id = t.slice(i, i + 8000).match(/"videoId":"([\w-]{11})"/)?.[1];
  const url = id ? `https://www.youtube.com/watch?v=${id}` : `https://www.youtube.com/${m[1]}/live`;
  let title: string | null = null;
  if (id) {
    try {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) title = (await r.json()).title || null;
    } catch { /* the badge is enough */ }
  }
  return { platform: "youtube", url, title: clip(title), since: null };
}

async function check() {
  const r = await fetch(CREATORS_URL, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error("loadouts.json " + r.status);
  const creators: Record<string, { links?: string[] }> = (await r.json()).creators || {};
  const live: Record<string, Stream[]> = {};
  await Promise.all(Object.entries(creators).map(async ([id, c]) => {
    const links = c.links || [];
    const found = (await Promise.all([
      ...links.filter(u => /twitch\.tv\//i.test(u)).slice(0, 1).map(twitch),
      ...links.filter(u => /youtube\.com\//i.test(u)).slice(0, 1).map(youtube),
    ])).filter((s): s is Stream => !!s);
    if (found.length) live[id] = found;
  }));
  return { live, checked: Object.keys(creators).length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (req.method === "GET") {
    const { data } = await supabase.from("creator_live").select("live, checked_at").eq("id", 1).maybeSingle();
    const fresh = data?.checked_at && Date.now() - new Date(data.checked_at).getTime() < STALE_MS;
    return json({ checked_at: data?.checked_at || null, live: fresh ? data!.live : {} }, 200, { "Cache-Control": "public, max-age=60" });
  }

  let body: any = null;
  try { body = await req.json(); } catch { /* empty */ }
  const { data: sec } = await supabase.from("app_settings").select("value").eq("key", "poll_secret").maybeSingle();
  if (!sec?.value || body?.secret !== sec.value) return json({ error: "forbidden" }, 403);

  // { secret, probe: "<channel link>" } checks one link without storing anything, for when a site
  // changes its page and this needs looking at.
  if (typeof body.probe === "string") {
    const u = body.probe;
    last = null;
    const result = /twitch\.tv\//i.test(u) ? await twitch(u) : /youtube\.com\//i.test(u) ? await youtube(u) : null;
    return json({ probe: u, result, fetched: last });
  }

  try {
    const { live, checked } = await check();
    const { error } = await supabase.from("creator_live").upsert({ id: 1, live, checked_at: new Date().toISOString() });
    if (error) throw error;
    return json({ checked, live: Object.keys(live) });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
