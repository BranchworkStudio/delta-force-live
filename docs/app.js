/* Delta Force Live: squad dashboard. Plain JS, reads Supabase REST with the public anon key. */
(function () {
  const C = window.DF_CONFIG;
  const $ = (s) => document.querySelector(s);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6"].map(css);
  const GRADE = { 1: css("--g1"), 2: css("--g2"), 3: css("--g3"), 4: css("--g4"), 5: css("--g5"), 6: css("--g6") };
  const state = { range: "today", mode: 1, players: [], matches: [], members: [], reds: [], passwords: null, latency: [], open: new Set() };

  // ---------- lookups (official basic_info tables, with a fallback) ----------
  const MAP_FALLBACK = { 22: "Zero Dam", 19: "Layali Grove", 39: "Space City", 81: "Brakkesh", 88: "Tide Prison", 10: "Trench Lines", 24: "Cracked", 11: "Trainwreck", 54: "Ascension", 12: "Knife Edge", 15: "Fault", 30: "Cyclone", 14: "Aftershock", 55: "Island Warfare", 31: "Akh Canal", 21: "Shafted", 75: "Threshold", 89: "AZ3", 17: "Coliseum", 26: "The Mog" };
  const mapIndex = {}, opIndex = {}, itemIndex = {};
  try {
    const bi = window.basic_info_maps;
    if (bi && Array.isArray(bi.maps)) for (const m of bi.maps) {
      const name = (m.language && m.language.en) || (typeof m.map_name === "number" && bi.mapname_map ? bi.mapname_map[m.map_name] : m.map_name);
      if (name) mapIndex[String(m.map_id)] = String(name);
    }
  } catch (e) { /* fallback below */ }
  try { for (const o of window.basic_info_operators || []) opIndex[String(o.operator_id)] = { name: (o.language && o.language.en) || o.operator_id, icon: o.image_url }; } catch (e) { /* ignore */ }
  try { for (const c of window.basic_info_collection || []) itemIndex[String(c.prop_id)] = { name: (c.language && c.language.en) || c.prop_id, img: c.image_url, grade: Number(c.grade) || 0 }; } catch (e) { /* ignore */ }
  const mapName = (id) => mapIndex[String(id)] || MAP_FALLBACK[String(id).slice(0, 2)] || ("Map " + id);
  const mapBase = (id) => mapName(id).split(/ - |_/)[0].trim();   // "Zero Dam - Easy" / "Space City_Normal" -> base name
  const opName = (id) => (opIndex[String(id)] && opIndex[String(id)].name) || (id ? "Op " + id : "–");
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
  async function load() {
    const since = encodeURIComponent(rangeStart().toISOString());
    const [players, matches, members, reds, pw, latency] = await Promise.all([
      rest("public_players?select=*&order=nickname"),
      rest(`matches?select=openid,report_type,room_id,match_time,finished_at,match_duration_min,map_id,result,is_leave,kill_count,carry_out_value,net_income,operator_id,score,first_seen_at&report_type=eq.${state.mode}&match_time=gte.${since}&order=match_time.desc&limit=1000`),
      rest(`match_members?select=*&report_type=eq.${state.mode}&match_time=gte.${since}&limit=5000`),
      rest("red_drops?select=openid,collection_id,map_id,unlock_time,value,collection_count,first_seen_at&order=unlock_time.desc&limit=40"),
      rest("site_data?select=value,updated_at&key=eq.daily_passwords"),
      rest("match_latency?select=latency_seconds,first_seen_at&order=first_seen_at.desc&limit=50")
    ]);
    Object.assign(state, { players, matches, members, reds, passwords: pw[0] || null, latency });
    render();
    $("#status").textContent = "updated " + new Date().toLocaleTimeString();
  }

  // ---------- helpers ----------
  const fmt = (n) => n == null ? "–" : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + "M" : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
  const signed = (n) => (n > 0 ? "+" : "") + fmt(n);
  const pct = (a, b) => b ? Math.round(100 * a / b) + "%" : "–";
  const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? (s / 3600).toFixed(1) + " h ago" : Math.round(s / 86400) + " d ago"; };
  const dur = (s) => s < 120 ? Math.round(s) + " s" : s < 5400 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h";
  const mins = (m) => m == null ? "–" : m < 1 ? Math.round(m * 60) + " s" : m.toFixed(1) + " min";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const playerName = (openid) => { const p = state.players.find(p => p.openid === openid); return (p && p.nickname) || openid.slice(0, 6); };
  const isWin = (m) => m.result === 1, isLoss = (m) => m.result === 2;
  const outcome = (m) => m.is_leave ? ["left", "Quit"] : isWin(m) ? ["win", state.mode === 1 ? "Extracted" : "Victory"] : isLoss(m) ? ["loss", state.mode === 1 ? "Failed" : "Defeat"] : ["draw", "Draw"];
  const colorFor = (() => { const idx = {}; return (openid) => { if (!(openid in idx)) idx[openid] = Object.keys(idx).length; return SERIES[idx[openid] % SERIES.length]; }; })();
  const selfRow = (m) => state.members.find(x => x.openid === m.openid && x.room_id === m.room_id && x.is_self);
  const roster = (m) => state.members.filter(x => x.openid === m.openid && x.room_id === m.room_id);
  // Operations detail records report death=0 even for failed raids, so a death there = a failed (non-quit) raid. Warfare has a real death counter.
  const deathsOf = (ms, selves) => state.mode === 1 ? ms.filter(m => isLoss(m) && !m.is_leave).length : sum(selves, s => s.death);

  // ---------- render ----------
  function render() {
    const ms = state.matches, sol = state.mode === 1;
    const wins = ms.filter(isWin).length, kills = sum(ms, m => m.kill_count);
    const income = sum(ms, m => m.net_income);
    const selves = ms.map(selfRow).filter(Boolean);
    const deaths = deathsOf(ms, selves), alive = selves.filter(s => s.survival_min != null);
    const online = state.players.filter(p => p.last_poll_at && Date.now() - new Date(p.last_poll_at) < 5 * 60e3).length;
    const lat = state.latency.map(l => l.latency_seconds).filter(x => x > 0);
    const medLat = lat.length ? lat.slice().sort((a, b) => a - b)[Math.floor(lat.length / 2)] : null;

    $("#tiles").innerHTML = [
      ["Matches", ms.length, sol ? "operations" : "warfare"],
      [sol ? "Extraction rate" : "Win rate", pct(wins, ms.length), `${wins} of ${ms.length}`],
      ["Kills", kills, ms.length ? (kills / ms.length).toFixed(1) + " per match" : ""],
      ["K/D", ms.length ? (deaths ? (kills / deaths).toFixed(1) : "∞") : "–", sol ? `${deaths} deaths (failed raids)` : `${deaths} deaths`],
      ["Time alive", alive.length ? mins(sum(alive, s => s.survival_min) / alive.length) : "–", alive.length ? "average per match" : "needs detail records"],
      sol ? ["Net income", signed(income), "carried out minus lost"] : ["Score", fmt(sum(ms, m => m.score)), "total"],
      ["Trackers online", `${online}/${state.players.length}`, "polled in last 5 min"],
      ["API latency", medLat != null ? dur(medLat) : "–", medLat != null ? `median of ${lat.length} live match${lat.length === 1 ? "" : "es"}, after extraction` : "no live matches yet"]
    ].map(([k, v, sub]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="sub">${sub}</div></div>`).join("");

    $("#players").innerHTML = state.players.length ? state.players.map(p => {
      const pm = ms.filter(m => m.openid === p.openid), w = pm.filter(isWin).length;
      const ps = pm.map(selfRow).filter(Boolean), pd = deathsOf(pm, ps), pk = sum(pm, m => m.kill_count);
      const fresh = p.last_poll_at && Date.now() - new Date(p.last_poll_at) < 5 * 60e3;
      const st = !p.token_ok ? ["#d03b3b", "logged out"] : fresh ? ["#0ca30c", "live"] : ["#fab219", p.last_poll_at ? "last seen " + ago(p.last_poll_at) : "never polled"];
      const last = pm[0];
      return `<div class="player" style="border-left-color:${colorFor(p.openid)}">
        <div class="name"><span>${esc(p.nickname || p.openid.slice(0, 8))}</span><span class="state"><i style="background:${st[0]}"></i>${st[1]}</span></div>
        <div class="stats">
          <span>Matches<b>${pm.length}</b></span>
          <span>${sol ? "Extracted" : "Wins"}<b>${pct(w, pm.length)}</b></span>
          <span>Kills<b>${sum(pm, m => m.kill_count)}</b></span>
          <span>K/D<b>${pm.length ? (pd ? (pk / pd).toFixed(1) : "∞") : "–"}</b></span>
          ${sol ? `<span>Net<b class="${sum(pm, m => m.net_income) < 0 ? "neg" : "pos"}">${signed(sum(pm, m => m.net_income))}</b></span>` : `<span>Score<b>${fmt(sum(pm, m => m.score))}</b></span>`}
          <span>Last match<b style="font-size:12px">${last ? ago(last.finished_at || last.match_time) : "–"}</b></span>
        </div></div>`;
    }).join("") : `<div class="empty">No players yet. Install the extension and enter the squad code.</div>`;

    renderReds();
    renderPasswords();
    renderIncomeChart(ms);
    renderRateChart(ms);
    renderMapChart(ms);
    renderOpChart(ms);
    renderFeed(ms);
  }

  // ---------- red drops ----------
  function renderReds() {
    const el = $("#reds");
    $("#redsSub").textContent = state.reds.length ? "latest " + state.reds.length + " across the squad" : "";
    if (!state.reds.length) { el.innerHTML = `<div class="empty">No red drops recorded yet. They appear here as soon as a tracked player extracts one.</div>`; return; }
    el.innerHTML = state.reds.map(r => {
      const it = item(r.collection_id);
      const fresh = new Date(r.first_seen_at) - new Date(r.unlock_time) > 1000;
      return `<div class="red" style="border-left-color:${GRADE[it.grade] || GRADE[6]}" title="${esc(new Date(r.unlock_time).toLocaleString())}">
        ${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy">` : `<div style="width:48px;height:48px;border-radius:6px;background:#111;flex:none"></div>`}
        <div><div class="n">${esc(it.name)}</div>
        <div class="m"><span class="dot" style="background:${colorFor(r.openid)}"></span>${esc(playerName(r.openid))} · ${esc(mapBase(r.map_id))}</div>
        <div class="m">${ago(r.unlock_time)}${r.value ? " · " + fmt(r.value) : ""}${r.collection_count > 1 ? " · #" + r.collection_count : ""}${fresh ? "" : " · history"}</div></div></div>`;
    }).join("");
  }

  // ---------- daily passwords (shape discovered at runtime; render generically) ----------
  function renderPasswords() {
    const el = $("#passwords"), pw = state.passwords;
    if (!pw) { $("#pwSub").textContent = ""; el.innerHTML = `<div class="empty">Not fetched yet. An extension fetches these hourly.</div>`; return; }
    $("#pwSub").textContent = "fetched " + ago(pw.updated_at);
    el.innerHTML = renderAny(pw.value, 0);
  }
  function renderAny(v, depth) {
    if (v == null || v === "") return `<span style="color:var(--muted)">–</span>`;
    if (Array.isArray(v)) {
      if (!v.length) return `<span style="color:var(--muted)">none</span>`;
      if (v.every(x => x && typeof x === "object" && !Array.isArray(x))) {
        const cols = [...new Set(v.flatMap(Object.keys))].slice(0, 6);
        return `<div class="tblwrap"><table><thead><tr>${cols.map(c => `<th>${esc(label(c))}</th>`).join("")}</tr></thead><tbody>${v.map(row => `<tr>${cols.map(c => `<td>${renderAny(row[c], depth + 1)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      }
      return v.map(x => renderAny(x, depth + 1)).join(", ");
    }
    if (typeof v === "object") return `<div class="kv">${Object.entries(v).map(([k, x]) => `<span>${esc(label(k))}</span><span>${renderAny(x, depth + 1)}</span>`).join("")}</div>`;
    const s = String(v);
    if (/^\d{9,11}$/.test(s) && Number(s) > 1.5e9 && Number(s) < 2.5e9) return esc(new Date(Number(s) * 1000).toLocaleString());
    if (/^\d{4,8}$/.test(s)) return `<span class="pw">${esc(s)}</span>`;
    if (/^map_?id$/i.test("") ) return esc(s);
    return esc(s);
  }
  const label = (k) => k.replace(/_/g, " ").replace(/\bid\b/i, "").trim();

  // ---------- charts ----------
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

  // Horizontal bars: rate per row with n label. Shared by player / map / operator breakdowns.
  function hbars(el, rows, opts) {
    if (!rows.length) { el.innerHTML = `<div class="empty">No matches in this range.</div>`; return; }
    const W = 640, rowH = 28, padL = opts.padL || 120, padR = 130, H = rows.length * rowH + 24;
    let g = "";
    for (const t of [0, 25, 50, 75, 100]) { const x = padL + t / 100 * (W - padL - padR); g += `<line x1="${x}" x2="${x}" y1="0" y2="${H - 20}" stroke="#2e2e2b"/><text x="${x}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#7d7c76">${t}%</text>`; }
    rows.forEach((r, i) => {
      const yy = i * rowH + 5, w = r.rate * (W - padL - padR);
      g += `<text x="${padL - 8}" y="${yy + 14}" text-anchor="end" font-size="12" fill="#f0efec">${esc(r.label.slice(0, 16))}</text>
            <rect x="${padL}" y="${yy}" width="${Math.max(2, w)}" height="18" rx="3" fill="${r.color || "#3987e5"}" data-tip="${esc(r.tip)}"/>
            <text x="${padL + w + 6}" y="${yy + 13}" font-size="11" fill="#b4b3ac">${esc(r.after)}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria)}">${g}</svg>`;
    attachTips(el);
  }
  const rateWord = () => state.mode === 1 ? "extracted" : "won";

  function renderRateChart(ms) {
    const rows = state.players.map(p => { const pm = ms.filter(m => m.openid === p.openid); return { p, n: pm.length, w: pm.filter(isWin).length }; }).filter(r => r.n)
      .sort((a, b) => b.w / b.n - a.w / a.n)
      .map(r => ({ label: playerName(r.p.openid), rate: r.w / r.n, color: colorFor(r.p.openid), after: `${pct(r.w, r.n)} · n=${r.n}`, tip: `${playerName(r.p.openid)}: ${r.w} of ${r.n} ${rateWord()}` }));
    hbars($("#rateChart"), rows, { aria: "Extraction rate per player" });
  }

  function renderMapChart(ms) {
    const by = {};
    for (const m of ms) { const k = mapBase(m.map_id); (by[k] = by[k] || { n: 0, w: 0, net: 0, kills: 0 }); by[k].n++; by[k].w += isWin(m) ? 1 : 0; by[k].net += Number(m.net_income) || 0; by[k].kills += m.kill_count || 0; }
    const rows = Object.entries(by).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({
      label: k, rate: v.w / v.n, after: `${pct(v.w, v.n)} · ${state.mode === 1 ? signed(Math.round(v.net / v.n)) + " avg · " : ""}n=${v.n}`,
      tip: `${k}: ${v.w} of ${v.n} ${rateWord()}<br>${state.mode === 1 ? "Net " + signed(v.net) + " total, " + signed(Math.round(v.net / v.n)) + " per match<br>" : ""}${(v.kills / v.n).toFixed(1)} kills per match`
    }));
    hbars($("#mapChart"), rows, { aria: "Extraction rate per map" });
  }

  function renderOpChart(ms) {
    const by = {};
    for (const m of ms) { const k = opName(m.operator_id); (by[k] = by[k] || { n: 0, w: 0, kills: 0 }); by[k].n++; by[k].w += isWin(m) ? 1 : 0; by[k].kills += m.kill_count || 0; }
    const max = Math.max(1, ...Object.values(by).map(v => v.n));
    const rows = Object.entries(by).sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([k, v]) => ({
      label: k, rate: v.n / max, after: `${v.n} · ${pct(v.w, v.n)} ${rateWord()}`,
      tip: `${k}: ${v.n} matches, ${v.w} ${rateWord()} (${pct(v.w, v.n)})<br>${(v.kills / v.n).toFixed(1)} kills per match`
    }));
    const el = $("#opChart");
    if (!rows.length) { el.innerHTML = `<div class="empty">No matches in this range.</div>`; return; }
    // bar length = share of matches (magnitude), so axis labels are counts not %
    const W = 640, rowH = 28, padL = 120, padR = 150, H = rows.length * rowH + 24;
    let g = "";
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * max));
    for (const t of [...new Set(ticks)]) { const x = padL + t / max * (W - padL - padR); g += `<line x1="${x}" x2="${x}" y1="0" y2="${H - 20}" stroke="#2e2e2b"/><text x="${x}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#7d7c76">${t}</text>`; }
    rows.forEach((r, i) => {
      const yy = i * rowH + 5, w = r.rate * (W - padL - padR);
      g += `<text x="${padL - 8}" y="${yy + 14}" text-anchor="end" font-size="12" fill="#f0efec">${esc(r.label.slice(0, 16))}</text>
            <rect x="${padL}" y="${yy}" width="${Math.max(2, w)}" height="18" rx="3" fill="#3987e5" data-tip="${esc(r.tip)}"/>
            <text x="${padL + w + 6}" y="${yy + 13}" font-size="11" fill="#b4b3ac">${esc(r.after)}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Matches per operator">${g}</svg>`;
    attachTips(el);
  }

  // ---------- feed ----------
  function renderFeed(ms) {
    const sol = state.mode === 1;
    $("#feed thead").innerHTML = `<tr><th>When</th><th>Player</th><th>Map</th><th>Result</th><th>Operator</th><th class="num">Kills</th><th class="num">Alive</th>${sol ? `<th class="num">Carried out</th><th class="num">Net</th>` : `<th class="num">Score</th>`}<th class="num">Seen after</th></tr>`;
    // Group tracked players who were in the same raid.
    const groups = [], seen = {};
    for (const m of ms) { const k = m.room_id; if (seen[k]) { seen[k].push(m); continue; } seen[k] = [m]; groups.push(seen[k]); }
    if (!groups.length) { $("#feed tbody").innerHTML = `<tr><td colspan="11" class="empty">No matches in this range.</td></tr>`; return; }
    $("#feed tbody").innerHTML = groups.slice(0, 200).map(g => {
      const m = g[0], squad = g.length > 1, key = m.room_id;
      const outs = g.map(outcome), same = outs.every(o => o[0] === outs[0][0]);
      const [cls, txt] = same ? outs[0] : ["mixed", outs.map((o, i) => playerName(g[i].openid).slice(0, 6) + " " + o[1].toLowerCase()).join(", ")];
      const isLive = new Date(m.first_seen_at) - new Date(m.match_time) > 1000;
      const lat = isLive ? (new Date(m.first_seen_at) - new Date(m.finished_at || m.match_time)) / 1000 : 0;
      const when = m.finished_at || m.match_time;
      const selves = g.map(selfRow).filter(Boolean);
      const aliveTxt = selves.length ? selves.map(s => mins(s.survival_min)).join(" / ") : "–";
      const open = state.open.has(key);
      const row = `<tr class="match" data-key="${esc(key)}"><td title="Started ${new Date(m.match_time).toLocaleString()}${m.match_duration_min != null ? " · raid " + m.match_duration_min + " min" : ""}">${ago(when)}</td>
        <td>${g.map(x => `<span class="dot" style="background:${colorFor(x.openid)}"></span>${esc(playerName(x.openid))}`).join(" ")}${squad ? `<span class="tag squad">squad</span>` : ""}</td>
        <td>${esc(mapName(m.map_id))}</td><td><span class="tag ${cls}">${esc(txt)}</span></td>
        <td>${g.map(x => esc(opName(x.operator_id))).join(" / ")}</td>
        <td class="num">${sum(g, x => x.kill_count)}</td><td class="num">${aliveTxt}</td>
        ${sol ? `<td class="num">${fmt(sum(g, x => x.carry_out_value))}</td><td class="num ${sum(g, x => x.net_income) < 0 ? "neg" : "pos"}">${signed(sum(g, x => x.net_income))}</td>` : `<td class="num">${fmt(sum(g, x => x.score))}</td>`}
        <td class="num" style="color:#7d7c76" title="${isLive ? (m.finished_at ? "after your extraction/death" : "after match start (no detail record)") : "imported history"}">${isLive ? dur(Math.max(0, lat)) + (m.finished_at ? "" : "*") : "backfill"}</td></tr>`;
      return row + (open ? detailRow(g) : "");
    }).join("");
    $("#feed tbody").querySelectorAll("tr.match").forEach(tr => tr.onclick = () => { const k = tr.dataset.key; state.open.has(k) ? state.open.delete(k) : state.open.add(k); renderFeed(state.matches); });
  }

  function detailRow(g) {
    const sol = state.mode === 1;
    // Roster from whichever tracked player has a detail record; merge is_self flags for all tracked players.
    const tracked = new Set(g.map(x => x.openid));
    let rows = [];
    for (const m of g) { const r = roster(m); if (r.length > rows.length) rows = r; }
    if (!rows.length) return `<tr class="detail"><td colspan="11"><span style="color:var(--muted)">No roster yet for this match. History details are still being imported by the extension.</span></td></tr>`;
    const trackedNames = new Set(state.players.filter(p => tracked.has(p.openid)).map(p => p.nickname));
    rows = rows.slice().sort((a, b) => (b.is_self - a.is_self) || (trackedNames.has(b.nickname) - trackedNames.has(a.nickname)) || (b.kill_count || 0) - (a.kill_count || 0));
    return `<tr class="detail"><td colspan="11"><table><thead><tr><th>Player</th><th>Operator</th><th>Result</th><th class="num">Kills</th><th class="num">Players</th><th class="num">AI</th><th class="num">Assists</th><th class="num">Rescues</th><th class="num">Revives</th><th class="num">Alive</th>${sol ? `<th class="num">Carried out</th>` : `<th class="num">Score</th>`}</tr></thead><tbody>
      ${rows.map(r => { const o = outcome({ result: r.result, is_leave: r.is_leave }); const mine = trackedNames.has(r.nickname);
        return `<tr><td>${mine ? `<span class="dot" style="background:${colorFor((state.players.find(p => p.nickname === r.nickname) || {}).openid || "")}"></span>` : ""}${esc(r.nickname || "?")}${mine ? "" : ` <span style="color:var(--muted)">(teammate)</span>`}</td>
          <td>${esc(opName(r.operator_id))}</td><td><span class="tag ${o[0]}">${o[1]}</span></td>
          <td class="num">${r.kill_count ?? "–"}</td><td class="num">${r.kill_operator ?? "–"}</td><td class="num">${r.kill_other ?? "–"}</td>
          <td class="num">${r.assist ?? "–"}</td><td class="num">${r.rescue_count ?? r.rescue ?? "–"}</td><td class="num">${r.revive ?? "–"}</td>
          <td class="num">${mins(r.survival_min)}</td>${sol ? `<td class="num">${fmt(r.carry_out_value)}</td>` : `<td class="num">${fmt(r.score)}</td>`}</tr>`; }).join("")}
      </tbody></table></td></tr>`;
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
