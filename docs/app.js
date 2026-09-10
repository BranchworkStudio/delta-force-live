/* Delta Force Live: squad "Ops Board". Plain JS, reads Supabase REST with the public anon key.
   The page is a vertical stack of modules; each render* function writes one slot. */
(function () {
  const C = window.DF_CONFIG;
  const $ = (s) => document.querySelector(s);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6"].map(css);
  const GREEN = "#1de08c", RED = "#e0463f", AMBER = "#e6b34a";
  const state = { range: "today", mode: 1, focus: null, players: [], matches: [], members: [], reds: [], passwords: null, latency: [], open: new Set(), showAll: false };

  // ---------- lookups (official basic_info tables, with a fallback) ----------
  const MAP_FALLBACK = { 22: "Zero Dam", 19: "Layali Grove", 39: "Space City", 81: "Brakkesh", 88: "Tide Prison", 10: "Trench Lines", 24: "Cracked", 11: "Trainwreck", 54: "Ascension", 12: "Knife Edge", 15: "Fault", 30: "Cyclone", 14: "Aftershock", 55: "Island Warfare", 31: "Akh Canal", 21: "Shafted", 75: "Threshold", 89: "AZ3", 17: "Coliseum", 26: "The Mog" };
  const mapIndex = {}, opIndex = {}, itemIndex = {};
  const absUrl = (u) => !u ? null : /^https?:/.test(u) ? u : "https://www.playdeltaforce.com" + (u.startsWith("/") ? "" : "/") + u;
  try {
    const bi = window.basic_info_maps;
    if (bi && Array.isArray(bi.maps)) for (const m of bi.maps) {
      const name = (m.language && m.language.en) || (typeof m.map_name === "number" && bi.mapname_map ? bi.mapname_map[m.map_name] : m.map_name);
      if (name) mapIndex[String(m.map_id)] = String(name);
    }
  } catch (e) { /* fallback below */ }
  try { for (const o of window.basic_info_operators || []) opIndex[String(o.operator_id)] = { name: (o.language && o.language.en) || o.operator_id, icon: absUrl(o.image_url) }; } catch (e) { /* ignore */ }
  try { for (const c of window.basic_info_collection || []) itemIndex[String(c.prop_id)] = { name: (c.language && c.language.en) || c.prop_id, img: absUrl(c.image_url), grade: Number(c.grade) || 0 }; } catch (e) { /* ignore */ }
  const mapName = (id) => mapIndex[String(id)] || MAP_FALLBACK[String(id).slice(0, 2)] || ("Map " + id);
  const mapBase = (id) => mapName(id).split(/ - |_/)[0].trim();
  const opName = (id) => (opIndex[String(id)] && opIndex[String(id)].name) || (id ? "Op " + id : "–");
  const opIcon = (id) => (opIndex[String(id)] && opIndex[String(id)].icon) || null;
  const item = (id) => itemIndex[String(id)] || { name: "Item " + id, img: null, grade: 0 };

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
  const rangeWord = () => ({ today: "today", "24h": "24 h", "7d": "7 days", all: "all time" })[state.range];
  async function load() {
    const since = encodeURIComponent(rangeStart().toISOString());
    const [players, matches, members, reds, pw, latency] = await Promise.all([
      rest("public_players?select=*&order=nickname"),
      rest(`matches?select=openid,report_type,room_id,match_time,finished_at,match_duration_min,map_id,result,is_leave,kill_count,carry_out_value,net_income,operator_id,score,first_seen_at&report_type=eq.${state.mode}&match_time=gte.${since}&order=match_time.desc&limit=1000`),
      rest(`match_members?select=*&report_type=eq.${state.mode}&match_time=gte.${since}&limit=5000`),
      rest("red_drops?select=openid,collection_id,map_id,unlock_time,value,collection_count,first_seen_at&order=unlock_time.desc&limit=12"),
      rest("site_data?select=value,updated_at&key=eq.daily_passwords"),
      rest("match_latency?select=latency_seconds,first_seen_at&order=first_seen_at.desc&limit=50")
    ]);
    Object.assign(state, { players, matches, members, reds, passwords: pw[0] || null, latency });
    resolveFocus();
    render();
    $("#status").textContent = "updated " + hhmm(new Date());
  }

  // ---------- helpers ----------
  const fmt = (n) => n == null ? "–" : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + "M" : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
  const signed = (n) => (n > 0 ? "+" : "") + fmt(n);
  const full = (n) => n == null ? "–" : (n < 0 ? "-" : n > 0 ? "+" : "") + Math.abs(Math.round(n)).toLocaleString("en-US");
  const plain = (n) => full(n).replace(/^\+/, "");
  const pct = (a, b) => b ? Math.round(100 * a / b) + "%" : "–";
  const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? (s / 3600).toFixed(1) + " h ago" : Math.round(s / 86400) + " d ago"; };
  const dur = (s) => s < 120 ? Math.round(s) + " s" : s < 5400 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h";
  const mins = (m) => m == null ? "–" : m < 1 ? Math.round(m * 60) + " s" : m.toFixed(1) + " min";
  const hhmm = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const dayLabel = (d) => { const x = new Date(d), now = new Date(); return x.toDateString() === now.toDateString() ? null : x.toLocaleDateString([], { day: "numeric", month: "short" }); };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const playerName = (openid) => { const p = state.players.find(p => p.openid === openid); return (p && p.nickname) || openid.slice(0, 6); };
  // The board is personal-first: every module is scoped to one player. "all" aggregates the whole squad.
  const FOCUS_KEY = "df-focus";
  function resolveFocus() {
    const ids = state.players.map(p => p.openid);
    if (state.focus === null) { try { state.focus = localStorage.getItem(FOCUS_KEY); } catch (e) { /* ignore */ } }
    if (state.focus === "all" || ids.includes(state.focus)) return;
    // Personal-first default: the busiest player, then remembered so a new squad mate never steals the board.
    const n = {};
    for (const m of state.matches) n[m.openid] = (n[m.openid] || 0) + 1;
    state.focus = ids.slice().sort((a, b) => (n[b] || 0) - (n[a] || 0))[0] || "all";
    try { localStorage.setItem(FOCUS_KEY, state.focus); } catch (e) { /* ignore */ }
  }
  function setFocus(v) {
    state.focus = v; state.open.clear(); state.showAll = false;
    try { localStorage.setItem(FOCUS_KEY, v); } catch (e) { /* ignore */ }
    render();
  }
  const scoped = (arr) => state.focus === "all" ? arr : arr.filter(x => x.openid === state.focus);
  const focusName = () => state.focus === "all" ? "Squad" : playerName(state.focus);
  const isWin = (m) => m.result === 1, isLoss = (m) => m.result === 2;
  const outcome = (m) => m.is_leave ? ["warn", "Quit"] : isWin(m) ? ["good", state.mode === 1 ? "Extracted" : "Victory"] : isLoss(m) ? ["bad", state.mode === 1 ? "Failed" : "Defeat"] : ["warn", "Draw"];
  const colorFor = (() => { const idx = {}; return (openid) => { if (!(openid in idx)) idx[openid] = Object.keys(idx).length; return SERIES[idx[openid] % SERIES.length]; }; })();
  const selfRow = (m) => state.members.find(x => x.openid === m.openid && x.room_id === m.room_id && x.is_self);
  const roster = (m) => state.members.filter(x => x.openid === m.openid && x.room_id === m.room_id);
  // Operations detail records report death=0 even for failed raids, so a death there = a failed (non-quit) raid. Warfare has a real death counter.
  const deathsOf = (ms, selves) => state.mode === 1 ? ms.filter(m => isLoss(m) && !m.is_leave).length : sum(selves, s => s.death);
  const kd = (kills, deaths, n) => !n ? "–" : deaths ? (kills / deaths).toFixed(1) : "∞";
  const liveState = (p) => {
    const fresh = p.last_poll_at && Date.now() - new Date(p.last_poll_at) < 5 * 60e3;
    return !p.token_ok ? [RED, "logged out"] : fresh ? [GREEN, "live"] : [AMBER, p.last_poll_at ? "last seen " + ago(p.last_poll_at) : "never polled"];
  };
  const mostUsedOp = (ms) => { const c = {}; for (const m of ms) if (m.operator_id) c[m.operator_id] = (c[m.operator_id] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
  const rateWord = () => state.mode === 1 ? "extracted" : "won";
  const sq = (color) => `<span style="display:inline-block;width:8px;height:8px;background:${color};margin-right:6px;vertical-align:0"></span>`;

  // ---------- render ----------
  function render() {
    const ms = scoped(state.matches), sol = state.mode === 1;
    state.players.forEach(p => colorFor(p.openid));   // colours follow the player, assigned on first sight
    renderHero(ms, sol);
    renderRoster(state.matches, sol);
    renderMapsBand(ms, sol);
    renderOpsBand(ms, sol);
    renderFeed(ms, sol);
    renderIncomeChart(ms, sol);
    renderRateChart(ms, sol);
    renderReds();
    renderPasswords();
  }

  function renderHero(ms, sol) {
    const wins = ms.filter(isWin).length, kills = sum(ms, m => m.kill_count);
    const selves = ms.map(selfRow).filter(Boolean), alive = selves.filter(s => s.survival_min != null);
    const deaths = deathsOf(ms, selves);
    $("#eyebrow").textContent = focusName() + (sol ? " · net income · " : " · score · ") + rangeWord();
    $("#big").textContent = ms.length ? (sol ? full(sum(ms, m => m.net_income)) : plain(sum(ms, m => m.score))) : "0";
    const cells = [
      ["Kills", kills],
      [sol ? "Extraction" : "Win rate", pct(wins, ms.length)],
      ["Matches", ms.length],
      sol ? ["K/D", kd(kills, deaths, ms.length)] : ["Score", fmt(sum(ms, m => m.score))],
      ["Avg alive · min", alive.length ? (sum(alive, s => s.survival_min) / alive.length).toFixed(1) : "–"]
    ];
    const el = $("#cells"); el.style.setProperty("--n", cells.length);
    el.innerHTML = cells.map(([k, v]) => `<div class="cell"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");
  }

  // The roster doubles as the scope picker: click a player to make the whole board theirs.
  function renderRoster(ms, sol) {
    const el = $("#roster");
    if (!state.players.length) { el.style.setProperty("--n", 1); el.innerHTML = `<div class="pl on"><div class="body"><div class="empty">No players yet. Install the extension and enter the squad code.</div></div></div>`; return; }
    const cards = state.players.map(p => {
      const pm = ms.filter(m => m.openid === p.openid), w = pm.filter(isWin).length, net = sum(pm, m => m.net_income), score = sum(pm, m => m.score);
      const [stc, stt] = liveState(p);
      const icon = opIcon(mostUsedOp(pm.length ? pm : state.matches.filter(m => m.openid === p.openid)));
      return `<div class="pl${state.focus === p.openid ? " on" : ""}" data-focus="${esc(p.openid)}" title="Show only ${esc(p.nickname || "this player")}">
        <div class="bar" style="background:${colorFor(p.openid)}"></div>
        ${icon ? `<img class="ava" src="${esc(icon)}" alt="" loading="lazy" onerror="this.removeAttribute('src')">` : `<div class="ava"></div>`}
        <div class="body">
          <div class="nm"><span>${esc(p.nickname || p.openid.slice(0, 8))}</span><span class="st" style="color:${stc}">${stt}</span></div>
          <div class="ln">
            <span><b>${pct(w, pm.length)}</b> ${rateWord()}</span>
            <span><b>${sum(pm, m => m.kill_count)}</b> kills</span>
            ${sol ? `<span><b style="color:${net < 0 ? RED : GREEN}">${pm.length ? signed(net) : "–"}</b></span>` : `<span><b>${fmt(score)}</b> score</span>`}
          </div>
        </div></div>`;
    });
    if (state.players.length > 1) cards.push(`<div class="pl squad${state.focus === "all" ? " on" : ""}" data-focus="all" title="Add every tracked player together">
        <div class="bar" style="background:var(--div)"></div>
        <div class="ava sig"></div>
        <div class="body">
          <div class="nm"><span>All squad</span></div>
          <div class="ln"><span><b>${state.players.length}</b> players</span><span><b>${ms.length}</b> matches</span><span><b>${sum(ms, m => m.kill_count)}</b> kills</span></div>
        </div></div>`);
    el.style.setProperty("--n", cards.length);
    el.innerHTML = cards.join("");
    el.querySelectorAll("[data-focus]").forEach(n => n.onclick = () => setFocus(n.dataset.focus));
  }

  // Full-width bands: one item per map / operator, separated by hero-style dividers.
  function band(el, label, items) {
    if (!items.length) { el.innerHTML = `<div class="mod-label">${label}</div><div class="empty">No matches in this range.</div>`; return; }
    el.innerHTML = `<div class="mod-label">${label}</div><div class="items">${items.map(it => `<div class="it" data-tip="${esc(it.tip)}"><div class="v">${it.v}</div><div class="k">${it.k}</div></div>`).join("")}</div>`;
    attachTips(el);
  }
  function renderMapsBand(ms, sol) {
    const by = {};
    for (const m of ms) { const k = mapBase(m.map_id); (by[k] = by[k] || { n: 0, w: 0, net: 0, kills: 0 }); by[k].n++; by[k].w += isWin(m) ? 1 : 0; by[k].net += Number(m.net_income) || 0; by[k].kills += m.kill_count || 0; }
    const items = Object.entries(by).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([k, v]) => ({
      v: pct(v.w, v.n),
      k: `<b>${esc(k)}</b> · ${v.n} ${v.n === 1 ? "match" : "matches"}${sol ? ` · <span style="color:${v.net < 0 ? RED : GREEN}">${signed(Math.round(v.net / v.n))}</span> avg` : ""}`,
      tip: `<b>${esc(k)}</b>: ${v.w} of ${v.n} ${rateWord()}<br>${(v.kills / v.n).toFixed(1)} kills per match${sol ? `<br>Net ${full(v.net)} total` : ""}`
    }));
    band($("#mapsBand"), "Maps · " + (sol ? "extraction rate" : "win rate"), items);
  }
  function renderOpsBand(ms, sol) {
    const by = {};
    for (const m of ms) { const k = opName(m.operator_id); (by[k] = by[k] || { n: 0, w: 0, kills: 0 }); by[k].n++; by[k].w += isWin(m) ? 1 : 0; by[k].kills += m.kill_count || 0; }
    const items = Object.entries(by).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([k, v]) => ({
      v: v.n,
      k: `<b>${esc(k)}</b> · <span style="color:${GREEN}">${pct(v.w, v.n)}</span> ${rateWord()}`,
      tip: `<b>${esc(k)}</b>: ${v.n} matches, ${v.w} ${rateWord()}<br>${(v.kills / v.n).toFixed(1)} kills per match`
    }));
    band($("#opsBand"), "Operators · matches", items);
  }

  // ---------- feed ----------
  function renderFeed(ms, sol) {
    const lat = state.latency.map(l => l.latency_seconds).filter(x => x > 0);
    const medLat = lat.length ? lat.slice().sort((a, b) => a - b)[Math.floor(lat.length / 2)] : null;
    $("#latNote").innerHTML = medLat != null ? `API latency median <b>${dur(medLat)}</b> after extraction · ${lat.length} live` : `No live matches seen yet`;
    // Group tracked players who were in the same raid.
    const groups = [], seen = {};
    for (const m of ms) { const k = m.room_id; if (seen[k]) { seen[k].push(m); continue; } seen[k] = [m]; groups.push(seen[k]); }
    const el = $("#feed"), more = $("#more");
    if (!groups.length) { el.innerHTML = `<div class="empty">No matches in this range.</div>`; more.innerHTML = ""; return; }
    const shown = state.showAll ? groups.slice(0, 200) : groups.slice(0, 8);
    el.innerHTML = shown.map(g => {
      const m = g[0], key = m.room_id, outs = g.map(outcome);
      const isLive = new Date(m.first_seen_at) - new Date(m.match_time) > 1000;
      const latS = isLive ? Math.max(0, (new Date(m.first_seen_at) - new Date(m.finished_at || m.match_time)) / 1000) : null;
      const when = m.finished_at || m.match_time;
      const meta = [dayLabel(when), mapName(m.map_id), g.map(x => opName(x.operator_id)).join(" / "), m.match_duration_min != null ? m.match_duration_min + " min" : null, latS != null ? "seen " + dur(latS) + (m.finished_at ? "" : "*") : "history"].filter(Boolean).join(" · ");
      const net = sum(g, x => x.net_income), score = sum(g, x => x.score);
      const names = g.map((x, i) => `<b>${esc(playerName(x.openid))}</b><span class="tag ${outs[i][0]}">${outs[i][1]}</span>`).join(" ");
      return `<div class="row" data-key="${esc(key)}" title="Started ${new Date(m.match_time).toLocaleString()}">
        <span class="t">${hhmm(when)}</span>
        <span class="rail">${g.map(x => `<i style="background:${colorFor(x.openid)}"></i>`).join("")}</span>
        <div><div class="l1">${names}</div><div class="l2">${esc(meta)}</div></div>
        <span class="kl">${sum(g, x => x.kill_count)} K</span>
        <span class="nt ${sol ? (net < 0 ? "bad" : "good") : ""}">${sol ? full(net) : plain(score)}</span>
      </div>${state.open.has(key) ? detailRow(g, sol) : ""}`;
    }).join("");
    el.querySelectorAll(".row").forEach(r => r.onclick = () => { const k = r.dataset.key; state.open.has(k) ? state.open.delete(k) : state.open.add(k); renderFeed(scoped(state.matches), sol); });
    more.innerHTML = groups.length > 8 ? `<button class="link" id="toggleAll">${state.showAll ? "Show latest 8 ›" : `Show all ${Math.min(groups.length, 200)} ›`}</button>` : "";
    const t = $("#toggleAll"); if (t) t.onclick = () => { state.showAll = !state.showAll; renderFeed(scoped(state.matches), sol); };
  }

  function detailRow(g, sol) {
    const tracked = new Set(g.map(x => x.openid));
    let rows = [];
    for (const m of g) { const r = roster(m); if (r.length > rows.length) rows = r; }
    if (!rows.length) return `<div class="det"><span class="empty">No roster yet for this match. History details are still being imported by the extension.</span></div>`;
    const byNick = {}; for (const p of state.players) if (tracked.has(p.openid) && p.nickname) byNick[p.nickname] = p.openid;
    rows = rows.slice().sort((a, b) => (b.is_self - a.is_self) || ((b.nickname in byNick) - (a.nickname in byNick)) || (b.kill_count || 0) - (a.kill_count || 0));
    const th = ["Player", "Operator", "Result", "Kills", "Players", "AI", "Assists", "Rescues", "Revives", "Alive", sol ? "Carried out" : "Score"];
    return `<div class="det"><table><thead><tr>${th.map((h, i) => `<th class="${i >= 3 ? "n" : ""}">${h}</th>`).join("")}</tr></thead><tbody>
      ${rows.map(r => { const o = outcome({ result: r.result, is_leave: r.is_leave }); const mine = r.nickname in byNick;
        return `<tr><td>${mine ? sq(colorFor(byNick[r.nickname])) : ""}${esc(r.nickname || "?")}${mine ? "" : ` <span class="mate">teammate</span>`}</td>
          <td>${esc(opName(r.operator_id))}</td><td><span class="tag ${o[0]}" style="margin:0">${o[1]}</span></td>
          <td class="n">${r.kill_count ?? "–"}</td><td class="n">${r.kill_operator ?? "–"}</td><td class="n">${r.kill_other ?? "–"}</td>
          <td class="n">${r.assist ?? "–"}</td><td class="n">${r.rescue ?? "–"}</td><td class="n">${r.revive ?? "–"}</td>
          <td class="n">${mins(r.survival_min)}</td><td class="n">${sol ? fmt(r.carry_out_value) : fmt(r.score)}</td></tr>`; }).join("")}
      </tbody></table></div>`;
  }

  // ---------- right column ----------
  function renderIncomeChart(ms, sol) {
    const el = $("#incomeChart");
    const rows = ms.slice(0, 12).reverse();
    $("#incomeTitle").textContent = (sol ? "Net income" : "Score") + " · last " + (rows.length || 12);
    if (!rows.length) { el.innerHTML = `<div class="empty">No matches in this range.</div>`; return; }
    const val = (m) => sol ? (Number(m.net_income) || 0) : (Number(m.score) || 0);
    const W = 640, H = 200, pad = 10, max = Math.max(1, ...rows.map(m => Math.abs(val(m))));
    const y = sol ? (v) => pad + (max - v) / (2 * max) * (H - 2 * pad) : (v) => pad + (max - v) / max * (H - 2 * pad);
    const zero = y(0), bw = W / rows.length;
    const ticks = Array.from({ length: 13 }, (_, i) => `<line x1="${i * W / 12}" x2="${i * W / 12}" y1="${zero - 4}" y2="${zero + 4}" stroke="#3a4f56"/>`).join("");
    const bars = rows.map((m, i) => {
      const v = val(m), top = Math.min(y(v), zero), h = Math.max(1, Math.abs(y(v) - zero));
      const tip = `<b>${esc(playerName(m.openid))}</b> · ${esc(mapName(m.map_id))}<br>${outcome(m)[1]} · ${m.kill_count || 0} kills<br>${sol ? "Net " + full(v) : "Score " + plain(v)} · ${hhmm(m.finished_at || m.match_time)}`;
      return `<rect x="${i * bw + 2}" y="${top}" width="${Math.max(1, bw - 4)}" height="${h}" fill="${v < 0 ? RED : GREEN}" data-tip="${esc(tip)}"/>`;
    }).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${sol ? "Net income" : "Score"} per match, oldest to newest"><line x1="0" x2="${W}" y1="${zero}" y2="${zero}" stroke="#2b3d43" stroke-width="1.5"/>${ticks}${bars}</svg>`;
    attachTips(el);
  }

  // One player in focus reads as a trend over days; the whole squad reads as a comparison.
  function renderRateChart(ms, sol) {
    const one = state.focus !== "all";
    $("#rateTitle").textContent = (sol ? "Extraction rate" : "Win rate") + (one ? " · by day" : " · by player");
    let rows;
    if (one) {
      const by = new Map();
      for (const m of ms) {
        const d = new Date(m.match_time); d.setHours(d.getHours() - 4);   // the gaming day starts at 04:00
        const k = d.toISOString().slice(0, 10), e = by.get(k) || { n: 0, w: 0, d };
        e.n++; e.w += isWin(m) ? 1 : 0; by.set(k, e);
      }
      rows = [...by.entries()].sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 10)
        .map(([, v]) => ({ label: v.d.toLocaleDateString([], { day: "numeric", month: "short" }), n: v.n, w: v.w, color: colorFor(state.focus) }));
    } else {
      rows = state.players.map(p => { const pm = ms.filter(m => m.openid === p.openid); return { label: playerName(p.openid), n: pm.length, w: pm.filter(isWin).length, color: colorFor(p.openid) }; })
        .filter(r => r.n).sort((a, b) => b.w / b.n - a.w / a.n);
    }
    $("#rateChart").innerHTML = rows.length
      ? `<div style="display:grid;gap:10px">${rows.map(r => `<div class="rate" data-tip="<b>${esc(r.label)}</b>: ${r.w} of ${r.n} ${rateWord()}"><span class="nm">${esc(r.label)}</span><div class="tr"><i style="width:${Math.round(100 * r.w / r.n)}%;background:${r.color}"></i></div><span class="v">${pct(r.w, r.n)}</span></div>`).join("")}</div>`
      : `<div class="empty">No matches in this range.</div>`;
    attachTips($("#rateChart"));
  }

  function renderReds() {
    const el = $("#reds"), reds = scoped(state.reds);
    if (!reds.length) { el.innerHTML = `<div class="empty">No red drops recorded yet.</div>`; return; }
    el.innerHTML = `<div class="reds">${reds.map(r => {
      const it = item(r.collection_id);
      return `<div class="red" title="${esc(new Date(r.unlock_time).toLocaleString())}">
        ${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy">` : `<div class="ph"></div>`}
        <div><div class="n">${esc(it.name)}</div><div class="m">${sq(colorFor(r.openid))}${esc(playerName(r.openid))} · ${esc(mapBase(r.map_id))} · ${ago(r.unlock_time)}</div></div>
        <div class="v">${r.value ? fmt(r.value) : ""}</div></div>`;
    }).join("")}</div>`;
  }

  // Daily passwords: response shape is discovered at runtime, so render generically.
  function renderPasswords() {
    const el = $("#passwords"), pw = state.passwords;
    if (!pw) { el.innerHTML = `<div class="empty">Not fetched yet.</div>`; return; }
    el.innerHTML = renderAny(pw.value) + `<div class="empty" style="margin-top:10px;font-size:12px">Fetched ${ago(pw.updated_at)}</div>`;
  }
  const label = (k) => String(k).replace(/_/g, " ").replace(/\bid\b/i, "").trim();
  function renderAny(v) {
    if (v == null || v === "") return `<span class="empty">–</span>`;
    if (Array.isArray(v)) {
      if (!v.length) return `<span class="empty">none</span>`;
      if (v.every(x => x && typeof x === "object" && !Array.isArray(x))) {
        const cols = [...new Set(v.flatMap(Object.keys))].slice(0, 5);
        return `<div style="overflow-x:auto"><table class="kvt"><thead><tr>${cols.map(c => `<th>${esc(label(c))}</th>`).join("")}</tr></thead><tbody>${v.map(row => `<tr>${cols.map(c => `<td>${renderAny(row[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      }
      return v.map(renderAny).join(", ");
    }
    if (typeof v === "object") return `<div class="kv">${Object.entries(v).map(([k, x]) => `<span>${esc(label(k))}</span><span>${renderAny(x)}</span>`).join("")}</div>`;
    const s = String(v);
    if (/^\d{9,11}$/.test(s) && Number(s) > 1.5e9 && Number(s) < 2.5e9) return esc(new Date(Number(s) * 1000).toLocaleString());
    if (/^\d{4,8}$/.test(s)) return `<span class="pw">${esc(s)}</span>`;
    if (/^\d{2,4}$/.test(s) && mapIndex[s]) return esc(mapName(s));
    return esc(s);
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
  document.querySelectorAll("[data-range]").forEach(b => b.onclick = () => { document.querySelectorAll("[data-range]").forEach(x => x.classList.toggle("on", x === b)); state.range = b.dataset.range; state.showAll = false; load(); });
  document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { document.querySelectorAll("[data-mode]").forEach(x => x.classList.toggle("on", x === b)); state.mode = Number(b.dataset.mode); state.showAll = false; load(); });

  // ---------- boot ----------
  // HTML and JS are deployed together but cached separately (Pages CDN, max-age 600). If they mismatch, reload once.
  if (!$("#cells") || !$("#feed")) {
    try { if (!sessionStorage.getItem("df-reloaded")) { sessionStorage.setItem("df-reloaded", "1"); location.reload(); return; } } catch (e) { /* ignore */ }
    return;
  }
  try { sessionStorage.removeItem("df-reloaded"); } catch (e) { /* ignore */ }
  if (!C || !C.SUPABASE_URL || C.SUPABASE_URL.startsWith("__")) { $("#banner").hidden = false; $("#banner").textContent = "config.js is not filled in."; return; }
  if (window.__mapsFailed) console.warn("maps_en.js failed to load; using fallback names");
  load().catch(e => { $("#banner").hidden = false; $("#banner").textContent = "Could not load data: " + e.message; $("#status").textContent = "error"; });
  setInterval(() => load().catch(() => { $("#status").textContent = "refresh failed"; }), (C.REFRESH_SECONDS || 30) * 1000);
})();
