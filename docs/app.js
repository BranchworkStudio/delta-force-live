/* Delta Force Live: squad dashboard. Plain JS, reads Supabase REST with the public anon key. */
(function () {
  const C = window.DF_CONFIG;
  const $ = (s) => document.querySelector(s);
  const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6"].map(v => getComputedStyle(document.documentElement).getPropertyValue(v).trim());
  const state = { range: "today", mode: 1, players: [], matches: [], latency: [] };

  // ---------- lookups (official basic_info tables, with a fallback) ----------
  const MAP_FALLBACK = { 22: "Zero Dam", 19: "Layali Grove", 39: "Space City", 81: "Brakkesh", 88: "Tide Prison", 10: "Trench Lines", 24: "Cracked", 11: "Trainwreck", 54: "Ascension", 12: "Knife Edge", 15: "Fault", 30: "Cyclone", 14: "Aftershock", 55: "Island Warfare", 31: "Akh Canal", 21: "Shafted", 75: "Threshold", 89: "AZ3", 17: "Coliseum", 26: "The Mog" };
  const mapIndex = {}, opIndex = {};
  try {
    const bi = window.basic_info_maps;
    if (bi && Array.isArray(bi.maps)) for (const m of bi.maps) {
      const name = (m.language && m.language.en) || (typeof m.map_name === "number" && bi.mapname_map ? bi.mapname_map[m.map_name] : m.map_name);
      if (name) mapIndex[String(m.map_id)] = String(name);
    }
  } catch (e) { /* fallback below */ }
  try {
    const ops = window.basic_info_operators;
    if (Array.isArray(ops)) for (const o of ops) opIndex[String(o.operator_id)] = { name: (o.language && o.language.en) || o.operator_id, icon: o.image_url };
  } catch (e) { /* ignore */ }
  const mapName = (id) => mapIndex[String(id)] || MAP_FALLBACK[String(id).slice(0, 2)] || ("Map " + id);
  const opName = (id) => (opIndex[String(id)] && opIndex[String(id)].name) || (id ? "Op " + id : "–");

  // ---------- data ----------
  async function rest(path) {
    const res = await fetch(C.SUPABASE_URL + "/rest/v1/" + path, { headers: { apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + C.SUPABASE_ANON_KEY } });
    if (!res.ok) throw new Error("REST " + res.status + " on " + path);
    return res.json();
  }
  function rangeStart() {
    const now = new Date();
    if (state.range === "today") { const d = new Date(now); d.setHours(4, 0, 0, 0); if (d > now) d.setDate(d.getDate() - 1); return d; } // gaming "day" starts 04:00
    if (state.range === "24h") return new Date(now - 864e5);
    if (state.range === "7d") return new Date(now - 7 * 864e5);
    return new Date(0);
  }
  async function load() {
    const since = rangeStart().toISOString();
    const [players, matches, latency] = await Promise.all([
      rest("public_players?select=*&order=nickname"),
      rest(`matches?select=openid,report_type,room_id,match_time,finished_at,match_duration_min,map_id,result,is_leave,kill_count,carry_out_value,net_income,operator_id,score,first_seen_at&report_type=eq.${state.mode}&match_time=gte.${encodeURIComponent(since)}&order=match_time.desc&limit=1000`),
      rest("match_latency?select=latency_seconds,first_seen_at&order=first_seen_at.desc&limit=50")
    ]);
    state.players = players; state.matches = matches; state.latency = latency;
    render();
    $("#status").textContent = "updated " + new Date().toLocaleTimeString();
  }

  // ---------- helpers ----------
  const fmt = (n) => n == null ? "–" : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + "M" : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
  const signed = (n) => (n > 0 ? "+" : "") + fmt(n);
  const pct = (a, b) => b ? Math.round(100 * a / b) + "%" : "–";
  const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? (s / 3600).toFixed(1) + " h ago" : Math.round(s / 86400) + " d ago"; };
  const dur = (s) => s < 120 ? Math.round(s) + " s" : s < 5400 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const playerName = (openid) => { const p = state.players.find(p => p.openid === openid); return (p && p.nickname) || openid.slice(0, 6); };
  const isWin = (m) => m.result === 1, isLoss = (m) => m.result === 2;
  const outcome = (m) => m.is_leave ? ["left", "Quit"] : isWin(m) ? ["win", state.mode === 1 ? "Extracted" : "Victory"] : isLoss(m) ? ["loss", state.mode === 1 ? "Failed" : "Defeat"] : ["draw", "Draw"];
  const colorFor = (() => { const idx = {}; return (openid) => { if (!(openid in idx)) idx[openid] = Object.keys(idx).length; return SERIES[idx[openid] % SERIES.length]; }; })();

  // ---------- render ----------
  function render() {
    const ms = state.matches, sol = state.mode === 1;
    const wins = ms.filter(isWin).length, kills = ms.reduce((a, m) => a + (m.kill_count || 0), 0);
    const income = ms.reduce((a, m) => a + (m.net_income || 0), 0);
    const online = state.players.filter(p => p.last_poll_at && Date.now() - new Date(p.last_poll_at) < 5 * 60e3).length;
    const lat = state.latency.map(l => l.latency_seconds).filter(x => x > 0);
    const medLat = lat.length ? lat.sort((a, b) => a - b)[Math.floor(lat.length / 2)] : null;

    $("#tiles").innerHTML = [
      ["Matches", ms.length, sol ? "operations" : "warfare"],
      [sol ? "Extraction rate" : "Win rate", pct(wins, ms.length), `${wins} of ${ms.length}`],
      ["Kills", kills, ms.length ? (kills / ms.length).toFixed(1) + " per match" : ""],
      sol ? ["Net income", signed(income), "carried out minus lost"] : ["Score", fmt(ms.reduce((a, m) => a + (m.score || 0), 0)), "total"],
      ["Trackers online", `${online}/${state.players.length}`, "polled in last 5 min"],
      ["API latency", medLat != null ? dur(medLat) : "–", medLat != null ? `median of ${lat.length} live match${lat.length === 1 ? "" : "es"}, after extraction` : "no live matches yet"]
    ].map(([k, v, sub]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="sub">${sub}</div></div>`).join("");

    $("#players").innerHTML = state.players.length ? state.players.map(p => {
      const pm = ms.filter(m => m.openid === p.openid), w = pm.filter(isWin).length;
      const fresh = p.last_poll_at && Date.now() - new Date(p.last_poll_at) < 5 * 60e3;
      const stateTxt = !p.token_ok ? ["#d03b3b", "logged out"] : fresh ? ["#0ca30c", "live"] : ["#fab219", p.last_poll_at ? "last seen " + ago(p.last_poll_at) : "never polled"];
      const last = pm[0];
      return `<div class="player" style="border-left-color:${colorFor(p.openid)}">
        <div class="name"><span>${esc(p.nickname || p.openid.slice(0, 8))}</span><span class="state"><i style="background:${stateTxt[0]}"></i>${stateTxt[1]}</span></div>
        <div class="stats">
          <span>Matches<b>${pm.length}</b></span>
          <span>${sol ? "Extracted" : "Wins"}<b>${pct(w, pm.length)}</b></span>
          <span>Kills<b>${pm.reduce((a, m) => a + (m.kill_count || 0), 0)}</b></span>
          ${sol ? `<span>Net<b class="${sumInc(pm) < 0 ? "neg" : "pos"}">${signed(sumInc(pm))}</b></span>` : `<span>Score<b>${fmt(pm.reduce((a, m) => a + (m.score || 0), 0))}</b></span>`}
          <span>Last match<b style="font-size:12px">${last ? ago(last.match_time) : "–"}</b></span>
        </div></div>`;
    }).join("") : `<div class="empty">No players yet. Install the extension and enter the squad code.</div>`;

    renderIncomeChart(ms);
    renderRateChart(ms);
    renderFeed(ms);
  }
  const sumInc = (pm) => pm.reduce((a, m) => a + (m.net_income || 0), 0);

  // Bar chart: one bar per match, chronological, positive blue / negative red. Only meaningful for Operations.
  function renderIncomeChart(ms) {
    const el = $("#incomeChart"); const sol = state.mode === 1;
    $("#incomeTitle").textContent = sol ? "Net income per match" : "Score per match";
    const rows = ms.slice().reverse().slice(-60);
    if (!rows.length) { el.innerHTML = `<div class="empty">No matches in this range.</div>`; return; }
    const val = (m) => sol ? (m.net_income || 0) : (m.score || 0);
    const W = 640, H = 220, padL = 46, padR = 8, padT = 10, padB = 24;
    const max = Math.max(1, ...rows.map(m => Math.abs(val(m))));
    const lo = sol ? -max : 0, hi = max;
    const y = (v) => padT + (hi - v) / (hi - lo) * (H - padT - padB);
    const bw = (W - padL - padR) / rows.length, gap = Math.min(2, bw * 0.2);
    let bars = "", ticks = "";
    for (const t of sol ? [-max, -max / 2, 0, max / 2, max] : [0, max / 2, max]) {
      ticks += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" stroke="#2e2e2b" stroke-width="${t === 0 ? 1.5 : 1}"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10" fill="#7d7c76">${fmt(Math.round(t))}</text>`;
    }
    rows.forEach((m, i) => {
      const v = val(m), x = padL + i * bw + gap / 2, w = Math.max(1, bw - gap);
      const top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
      const color = v < 0 ? "#e66767" : "#3987e5";
      const tip = `${playerName(m.openid)} · ${mapName(m.map_id)}<br>${outcome(m)[1]} · ${m.kill_count || 0} kills<br>${sol ? "Net " + signed(v) : "Score " + fmt(v)} · ${new Date(m.match_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      bars += `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${Math.min(3, w / 2)}" fill="${color}" data-tip="${esc(tip)}"/>`;
    });
    el.innerHTML = `<div class="legend"><span><i style="background:#3987e5"></i>${sol ? "Profit" : "Score"}</span>${sol ? `<span><i style="background:#e66767"></i>Loss</span>` : ""}<span style="margin-left:auto">${rows.length} most recent, oldest → newest</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${sol ? "Net income" : "Score"} per match">${ticks}${bars}</svg>`;
    attachTips(el);
  }

  // Horizontal bars: extraction/win rate per player with n label. One series, so no legend.
  function renderRateChart(ms) {
    const el = $("#rateChart");
    const per = state.players.map(p => { const pm = ms.filter(m => m.openid === p.openid); return { p, n: pm.length, w: pm.filter(isWin).length }; }).filter(r => r.n);
    if (!per.length) { el.innerHTML = `<div class="empty">No matches in this range.</div>`; return; }
    per.sort((a, b) => b.w / b.n - a.w / a.n);
    const W = 640, rowH = 30, padL = 110, padR = 60, H = per.length * rowH + 24;
    let g = "";
    for (const t of [0, 25, 50, 75, 100]) { const x = padL + t / 100 * (W - padL - padR); g += `<line x1="${x}" x2="${x}" y1="0" y2="${H - 20}" stroke="#2e2e2b"/><text x="${x}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#7d7c76">${t}%</text>`; }
    per.forEach((r, i) => {
      const yy = i * rowH + 6, w = (r.w / r.n) * (W - padL - padR);
      g += `<text x="${padL - 8}" y="${yy + 14}" text-anchor="end" font-size="12" fill="#f0efec">${esc(playerName(r.p.openid).slice(0, 14))}</text>
            <rect x="${padL}" y="${yy}" width="${Math.max(2, w)}" height="18" rx="3" fill="${colorFor(r.p.openid)}" data-tip="${esc(playerName(r.p.openid) + ": " + r.w + " of " + r.n + " (" + pct(r.w, r.n) + ")")}"/>
            <text x="${padL + w + 6}" y="${yy + 13}" font-size="11" fill="#b4b3ac">${pct(r.w, r.n)} · n=${r.n}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Extraction rate per player">${g}</svg>`;
    attachTips(el);
  }

  function renderFeed(ms) {
    const sol = state.mode === 1;
    $("#feed thead").innerHTML = `<tr><th>When</th><th>Player</th><th>Map</th><th>Result</th><th>Operator</th><th class="num">Kills</th>${sol ? `<th class="num">Carried out</th><th class="num">Net</th>` : `<th class="num">Score</th>`}<th class="num">Seen after</th></tr>`;
    $("#feed tbody").innerHTML = ms.length ? ms.slice(0, 200).map(m => {
      const [cls, txt] = outcome(m);
      const isLive = new Date(m.first_seen_at) - new Date(m.match_time) > 1000;
      const lat = isLive ? (new Date(m.first_seen_at) - new Date(m.finished_at || m.match_time)) / 1000 : 0;
      const when = m.finished_at || m.match_time;
      return `<tr><td title="Started ${new Date(m.match_time).toLocaleString()}${m.match_duration_min != null ? " · " + m.match_duration_min + " min" : ""}">${ago(when)}</td><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colorFor(m.openid)};margin-right:6px"></span>${esc(playerName(m.openid))}</td><td>${esc(mapName(m.map_id))}</td><td><span class="tag ${cls}">${txt}</span></td><td>${esc(opName(m.operator_id))}</td><td class="num">${m.kill_count ?? "–"}</td>${sol ? `<td class="num">${fmt(m.carry_out_value)}</td><td class="num ${m.net_income < 0 ? "neg" : "pos"}">${signed(m.net_income || 0)}</td>` : `<td class="num">${fmt(m.score)}</td>`}<td class="num" style="color:#7d7c76" title="${isLive ? (m.finished_at ? "after your extraction/death" : "after match start (no detail record)") : "imported history"}">${isLive ? dur(Math.max(0, lat)) + (m.finished_at ? "" : "*") : "backfill"}</td></tr>`;
    }).join("") : `<tr><td colspan="9" class="empty">No matches in this range.</td></tr>`;
  }

  // ---------- tooltips ----------
  const tip = $("#tip");
  function attachTips(root) {
    root.querySelectorAll("[data-tip]").forEach(n => {
      n.addEventListener("mousemove", (e) => { tip.innerHTML = n.getAttribute("data-tip"); tip.style.display = "block"; tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12) + "px"; tip.style.top = (e.clientY + 12) + "px"; });
      n.addEventListener("mouseleave", () => tip.style.display = "none");
    });
  }

  // ---------- filters ----------
  document.querySelectorAll("[data-range]").forEach(b => b.onclick = () => { document.querySelectorAll("[data-range]").forEach(x => x.classList.toggle("on", x === b)); state.range = b.dataset.range; load(); });
  document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { document.querySelectorAll("[data-mode]").forEach(x => x.classList.toggle("on", x === b)); state.mode = Number(b.dataset.mode); load(); });

  // ---------- boot ----------
  if (!C || !C.SUPABASE_URL || C.SUPABASE_URL.startsWith("__")) { $("#banner").hidden = false; $("#banner").textContent = "config.js is not filled in."; return; }
  if (window.__mapsFailed) console.warn("maps_en.js failed to load; using fallback names");
  load().catch(e => { $("#banner").hidden = false; $("#banner").textContent = "Could not load data: " + e.message; $("#status").textContent = "error"; });
  setInterval(() => load().catch(() => { $("#status").textContent = "refresh failed, retrying"; }), (C.REFRESH_SECONDS || 30) * 1000);
})();
