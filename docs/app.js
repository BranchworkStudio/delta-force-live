/* Delta Force Live: squad "Ops Board". Plain JS, reads Supabase REST with the public anon key.
   The page is a vertical stack of modules; each render* function writes one slot. */
(function () {
  const C = window.DF_CONFIG;
  const $ = (s) => document.querySelector(s);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6"].map(css);
  const GREEN = "#1de08c", RED = "#e0463f", AMBER = "#e6b34a";
  const state = { range: "today", mode: 1, focus: null, players: [], matches: [], members: [], reds: [], passwords: null, latency: [], sessions: [], recent: [], open: new Set(), showAll: false };

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
  // HQ gives every map *and difficulty* its own id, named "Zero Dam - Easy" or "Space City_Normal"
  // with the separator chosen at random. Easy and Normal are genuinely different raids, so the
  // difficulty is kept — just held apart from the name so the board can show both.
  const mapParts = (id) => {
    const s = mapName(id), i = s.search(/ - |_/);
    if (i < 0) return { base: s.trim(), diff: null };
    return { base: s.slice(0, i).trim(), diff: s.slice(i).replace(/^( - |_)/, "").trim() || null };
  };
  const mapBase = (id) => mapParts(id).base;
  const mapFull = (id) => { const m = mapParts(id); return m.diff ? m.base + " · " + m.diff : m.base; };
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
    const [players, matches, members, reds, pw, latency, sessions, recent, rank, rankSamples] = await Promise.all([
      rest("public_players?select=*&order=nickname"),
      rest(`matches?select=openid,report_type,room_id,match_time,finished_at,match_duration_min,map_id,result,is_leave,kill_count,kill_operator,kill_other,carry_out_value,net_income,operator_id,score,first_seen_at&report_type=eq.${state.mode}&match_time=gte.${since}&order=match_time.desc&limit=1000`),
      rest(`match_members?select=*&report_type=eq.${state.mode}&match_time=gte.${since}&limit=5000`),
      rest("red_drops?select=openid,collection_id,map_id,unlock_time,value,collection_count,first_seen_at&order=unlock_time.desc&limit=60"),
      rest("site_data?select=value,updated_at&key=eq.daily_passwords"),
      rest("match_latency?select=latency_seconds,first_seen_at&order=first_seen_at.desc&limit=50"),
      rest("public_sessions?select=*"),
      // Unfiltered by range: how long ago the last raid was, for when the chosen range is empty.
      rest(`matches?select=openid,match_time&report_type=eq.${state.mode}&order=match_time.desc&limit=200`),
      rest(`player_rank?select=openid,report_type,rank_score,highest_rank,fetched_at&report_type=eq.${state.mode}`),
      // Every sample, not just the range: the movement inside a range is measured against the
      // standing that came before it, which is a sample from outside it.
      rest(`rank_samples?select=openid,taken_at,rank_score&report_type=eq.${state.mode}&order=taken_at.asc&limit=5000`)
    ]);
    Object.assign(state, { players, matches, members, reds, passwords: pw[0] || null, latency, sessions, recent, rank, rankSamples });
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
  const span = (s) => s < 90 ? Math.round(s) + " s" : s < 5400 ? Math.round(s / 60) + " min" : s < 172800 ? (s / 3600).toFixed(1) + " h" : (s / 86400).toFixed(1) + " d";
  const mins = (m) => m == null ? "–" : m < 1 ? Math.round(m * 60) + " s" : m.toFixed(1) + " min";
  const hhmm = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const dayLabel = (d) => { const x = new Date(d), now = new Date(); return x.toDateString() === now.toDateString() ? null : x.toLocaleDateString([], { day: "numeric", month: "short" }); };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const playerName = (openid) => { const p = state.players.find(p => p.openid === openid); return (p && p.nickname) || openid.slice(0, 6); };
  // The board is personal-first: every module is scoped to one player. "all" aggregates the whole squad.
  const FOCUS_KEY = "df-focus";

  // An invite can arrive on the board's own URL too, so sharing either link works. It is kept for
  // the connect page, which is where it is actually used.
  const inviteQS = (() => {
    let inv = new URLSearchParams(location.search).get("i") || "";
    try {
      if (inv) localStorage.setItem("df-invite", inv);
      else inv = localStorage.getItem("df-invite") || "";
    } catch (e) { /* private window */ }
    return inv ? "?i=" + encodeURIComponent(inv) : "";
  })();
  const connectHref = () => "connect.html" + inviteQS;
  const CTL_KEY = "df-control";
  const ls = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  // The footer link is static HTML, so give it the invite too.
  if (inviteQS) { const a = document.getElementById("connectLink"); if (a) a.href = connectHref(); }
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
  // HQ counts kills twice over: kill_operator is other players, kill_other is AI, and the two add
  // up to kill_count. Only operator kills belong in a K/D — an AI body count is just that.
  const opKills = (ms) => sum(ms, m => m.kill_operator);
  const aiKills = (ms) => sum(ms, m => m.kill_other);
  const splitKnown = (ms) => ms.some(m => m.kill_operator != null);
  // Operations details always report death = 0, so the only record of dying is a raid that failed
  // without being quit. Warfare counts deaths properly, so use them there.
  const diedIn = (m) => state.mode === 1 ? (m.result === 2 && !m.is_leave ? 1 : 0) : ((selfRow(m) || {}).death || 0);
  const deathsOf = (ms) => sum(ms, diedIn);
  const kdOf = (k, d) => d ? (k / d).toFixed(1) : k ? "∞" : "0.0";
  // HQ never says what a match was worth in rank score: the per-match rank_score is 0 on every
  // row, and the only figure it reports is the standing as it is right now. So a gained/lost
  // number has to be read off the standing itself, which the poller samples every minute and
  // records whenever it moves. Nothing from before the first sample can be recovered, so a range
  // reaching back further than the samples do says how far back it actually knows.
  function rankMove() {
    // A ladder is personal. Adding up the squad's standings would be adding up unrelated numbers.
    if (state.focus === "all") return null;
    const row = (state.rank || []).find(r => r.openid === state.focus);
    const ss = (state.rankSamples || []).filter(s => s.openid === state.focus);
    const now = ss.length ? ss[ss.length - 1].rank_score : row ? row.rank_score : null;
    if (now == null) return null;
    const from = rangeStart().getTime();
    const before = ss.filter(s => new Date(s.taken_at).getTime() <= from);
    // The standing in force when the range opened is the one to measure against; without a sample
    // that old, the earliest one there is becomes the baseline and the label says so.
    const base = before.length ? before[before.length - 1] : ss[0] || null;
    return { now, delta: base ? now - base.rank_score : null, since: base ? base.taken_at : null, partial: !before.length };
  }
  const rankSince = (iso) => { const d = new Date(iso); return Date.now() - d < 20 * 3600e3 ? hhmm(d) : d.toLocaleDateString([], { day: "numeric", month: "short" }); };
  const liveState = (p) => {
    const fresh = p.last_poll_at && Date.now() - new Date(p.last_poll_at) < 5 * 60e3;
    return !p.token_ok ? [RED, "logged out"] : fresh ? [GREEN, "live"] : [AMBER, p.last_poll_at ? "last seen " + ago(p.last_poll_at) : "never polled"];
  };
  const mostUsedOp = (ms) => { const c = {}; for (const m of ms) if (m.operator_id) c[m.operator_id] = (c[m.operator_id] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
  const rateWord = () => state.mode === 1 ? "extracted" : "won";
  const lostWord = () => state.mode === 1 ? "failed" : "lost";
  const raid = (n) => state.mode === 1 ? (n === 1 ? "raid" : "raids") : (n === 1 ? "match" : "matches");
  // The board has one bar shape: the whole track is the sample and the fill is the share of it
  // that ended in an extraction. Scaling the track to the busiest row instead implied a ceiling
  // on how much you can play, which there is not — the count underneath carries the weight.
  const barCell = (w, n, color) =>
    `<div class="tr"><i class="f" style="width:${(n ? 100 * w / n : 0).toFixed(1)}%;background:${color}"></i></div>`;
  const sq = (color) => `<span style="display:inline-block;width:8px;height:8px;background:${color};margin-right:6px;vertical-align:0"></span>`;

  // ---------- render ----------
  function render() {
    const ms = scoped(state.matches), sol = state.mode === 1;
    state.players.forEach(p => colorFor(p.openid));   // colours follow the player, assigned on first sight
    renderHero(ms, sol);
    renderAccount();
    renderRoster(state.matches, sol);
    renderMapsBand(ms, sol);
    renderOpsBand(ms, sol);
    renderFeed(ms, sol);
    renderIncomeChart(ms, sol);
    renderRaidsChart(ms, sol);
    renderNudge(ms);
    renderReds();
    renderPasswords();
  }

  function renderHero(ms, sol) {
    const wins = ms.filter(isWin).length;
    const known = splitKnown(ms), kOp = opKills(ms), kAi = aiKills(ms), deaths = deathsOf(ms);
    const selves = ms.map(selfRow).filter(Boolean), alive = selves.filter(s => s.survival_min != null);
    const best = ms.length ? Math.max(...ms.map(m => Number(sol ? m.net_income : m.score) || 0)) : null;
    $("#eyebrow").textContent = focusName() + (sol ? " · net income · " : " · score · ") + rangeWord();
    $("#big").textContent = ms.length ? (sol ? full(sum(ms, m => m.net_income)) : plain(sum(ms, m => m.score))) : "0";
    const cells = [
      // The split only exists once the match detail has landed, which is within the minute. Until
      // then say the total rather than a confidently wrong zero.
      known ? ["Operator kills", kOp, kAi + (kAi === 1 ? " AI kill" : " AI kills")] : ["Kills", sum(ms, m => m.kill_count), ms.length ? "operators vs AI in a moment" : null],
      ["K/D", ms.length && known ? kdOf(kOp, deaths) : "–", !ms.length ? null : deaths ? deaths + (sol ? " " + lostWord() : " deaths") : "no deaths yet"],
      [sol ? "Extraction" : "Win rate", pct(wins, ms.length), ms.length ? `${wins} of ${ms.length} ${raid(ms.length)}` : null],
      ["Best " + raid(1), best == null ? "–" : sol ? signed(best) : plain(best), null],
      ["Avg alive · min", alive.length ? (sum(alive, s => s.survival_min) / alive.length).toFixed(1) : "–", null]
    ];
    // The movement is the point, so it takes the value slot when there is one to state, with the
    // standing underneath it. Until the samples cover the range, the standing leads instead —
    // a "±0" would read as a quiet session rather than as history we do not have.
    const r = rankMove();
    if (r) {
      const moved = r.delta != null && !(r.partial && r.delta === 0);
      cells.push(moved
        ? ["Rank score", `<span style="color:${r.delta < 0 ? RED : r.delta > 0 ? GREEN : "var(--text-2)"}">${full(r.delta)}</span>`,
           r.now.toLocaleString("en-US") + " now" + (r.partial ? " · since " + rankSince(r.since) : "")]
        : ["Rank score", r.now.toLocaleString("en-US"), "tracking since " + rankSince(r.since || new Date().toISOString())]);
    }
    const el = $("#cells"); el.style.setProperty("--n", cells.length);
    el.innerHTML = cells.map(([k, v, s]) => `<div class="cell"><div class="v">${v}</div><div class="k">${k}</div>${s ? `<div class="s">${esc(s)}</div>` : ""}</div>`).join("");
  }

  // The roster doubles as the scope picker: click a player to make the whole board theirs.
  function renderRoster(ms, sol) {
    const el = $("#roster");
    if (!state.players.length) { el.style.setProperty("--n", 1); el.innerHTML = `<div class="pl on"><div class="body"><div class="empty">No players yet. Connect an account to start collecting.</div></div></div>`; return; }
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
            <span><b>${splitKnown(pm) ? opKills(pm) : sum(pm, m => m.kill_count)}</b> ${splitKnown(pm) ? "op kills" : "kills"}</span>
            ${sol ? `<span><b style="color:${net < 0 ? RED : GREEN}">${pm.length ? signed(net) : "–"}</b></span>` : `<span><b>${fmt(score)}</b> score</span>`}
          </div>
        </div></div>`;
    });
    if (state.players.length > 1) cards.push(`<div class="pl squad${state.focus === "all" ? " on" : ""}" data-focus="all" title="Add every tracked player together">
        <div class="bar" style="background:var(--div)"></div>
        <div class="ava sig"></div>
        <div class="body">
          <div class="nm"><span>All squad</span></div>
          <div class="ln"><span><b>${state.players.length}</b> players</span><span><b>${ms.length}</b> ${raid(ms.length)}</span><span><b>${opKills(ms)}</b> op kills</span></div>
        </div></div>`);
    el.style.setProperty("--n", cards.length);
    el.innerHTML = cards.join("");
    el.querySelectorAll("[data-focus]").forEach(n => n.onclick = () => setFocus(n.dataset.focus));
  }

  // Full-width bands: one item per map / operator, separated by hero-style dividers. The rate is
  // the headline and the bar under it is that same rate as a length, so rows compare directly
  // however much each was played. The count underneath is what says how much weight to give it.
  function band(el, label, items) {
    if (!items.length) { el.innerHTML = `<div class="mod-label">${label}</div><div class="empty">No ${raid(2)} in this range.</div>`; return; }
    const legend = `<div class="legend"><span><i style="background:${GREEN}"></i>${rateWord()}</span><span><i style="background:var(--fail)"></i>${lostWord()}</span></div>`;
    el.innerHTML = `<div class="mod-label">${label}</div>${legend}<div class="items">${items.map(it => `<div class="it" data-tip="${esc(it.tip)}">
        <div class="v">${it.v}</div><div class="k">${it.k}</div>${it.bar}<div class="sub">${it.sub}</div></div>`).join("")}</div>`;
    attachTips(el);
  }
  function bandItems(by, sol, extra) {
    const rows = Object.values(by).sort((a, b) => b.n - a.n).slice(0, 8);
    return rows.map(v => ({
      v: pct(v.w, v.n),
      k: `<b>${esc(v.name)}</b>${v.diff ? ` <span class="diff">${esc(v.diff)}</span>` : ""}`,
      bar: barCell(v.w, v.n, GREEN),
      sub: `${v.n} ${raid(v.n)}` + extra(v),
      tip: `<b>${esc(v.name + (v.diff ? " · " + v.diff : ""))}</b>: ${v.w} of ${v.n} ${rateWord()}<br>
        ${v.ops} operator + ${v.ai} AI kills · ${v.d} ${sol ? lostWord() : "deaths"} · K/D ${kdOf(v.ops, v.d)}${sol ? `<br>Net ${full(v.net)} total` : ""}`,
    }));
  }
  // Buckets carry both kill kinds and the deaths, so any band can show a real K/D.
  function tally(ms, keyOf) {
    const by = {};
    for (const m of ms) {
      const { key, name, diff } = keyOf(m);
      const v = by[key] = by[key] || { n: 0, w: 0, net: 0, ops: 0, ai: 0, d: 0, name, diff };
      v.n++; v.w += isWin(m) ? 1 : 0; v.net += Number(m.net_income) || 0;
      v.ops += m.kill_operator || 0; v.ai += m.kill_other || 0; v.d += diedIn(m);
    }
    return by;
  }
  function renderMapsBand(ms, sol) {
    // Keyed by map *and* difficulty: Zero Dam Easy and Zero Dam Normal are separate rows.
    const by = tally(ms, (m) => { const p = mapParts(m.map_id); return { key: p.base + "|" + (p.diff || ""), name: p.base, diff: p.diff }; });
    band($("#mapsBand"), "Maps · " + (sol ? "extraction rate" : "win rate"),
      bandItems(by, sol, (v) => sol ? ` · <span style="color:${v.net < 0 ? RED : GREEN}">${signed(Math.round(v.net / v.n))}</span> avg` : ` · K/D ${kdOf(v.ops, v.d)}`));
  }
  function renderOpsBand(ms, sol) {
    const by = tally(ms, (m) => ({ key: opName(m.operator_id), name: opName(m.operator_id), diff: null }));
    band($("#opsBand"), "Operators · " + (sol ? "extraction rate" : "win rate"),
      bandItems(by, sol, (v) => ` · K/D <b style="color:var(--text-2)">${kdOf(v.ops, v.d)}</b>`));
  }

  // ---------- feed ----------
  function renderFeed(ms, sol) {
    const lat = state.latency.map(l => l.latency_seconds).filter(x => x > 0);
    const medLat = lat.length ? lat.slice().sort((a, b) => a - b)[Math.floor(lat.length / 2)] : null;
    $("#latNote").innerHTML = medLat != null
      ? `New ${raid(2)} usually appear here <b>${dur(medLat)}</b> after you leave the ${raid(1)}`
      : `Nothing caught live yet — new ${raid(2)} land here within a minute`;
    // Group tracked players who were in the same raid.
    const groups = [], seen = {};
    for (const m of ms) { const k = m.room_id; if (seen[k]) { seen[k].push(m); continue; } seen[k] = [m]; groups.push(seen[k]); }
    const el = $("#feed"), more = $("#more");
    if (!groups.length) { el.innerHTML = `<div class="empty">No ${raid(2)} in this range.</div>`; more.innerHTML = ""; return; }
    const shown = state.showAll ? groups.slice(0, 200) : groups.slice(0, 8);
    el.innerHTML = shown.map(g => {
      const m = g[0], key = m.room_id, outs = g.map(outcome);
      const isLive = new Date(m.first_seen_at) - new Date(m.match_time) > 1000;
      const latS = isLive ? Math.max(0, (new Date(m.first_seen_at) - new Date(m.finished_at || m.match_time)) / 1000) : null;
      const when = m.finished_at || m.match_time;
      // The date used to sit at the front of the meta line, where it pushed the map name around.
      // It belongs with the time it qualifies, so it goes under the clock instead.
      const day = dayLabel(when);
      const meta = [mapFull(m.map_id), g.map(x => opName(x.operator_id)).join(" / "), m.match_duration_min != null ? m.match_duration_min + " min" : null, latS != null ? "seen " + dur(latS) + (m.finished_at ? "" : "*") : "history"].filter(Boolean).join(" · ");
      const net = sum(g, x => x.net_income), score = sum(g, x => x.score);
      const names = g.map((x, i) => `<b>${esc(playerName(x.openid))}</b><span class="tag ${outs[i][0]}">${outs[i][1]}</span>`).join(" ");
      return `<div class="row" data-key="${esc(key)}" title="Started ${new Date(m.match_time).toLocaleString()}">
        <span class="t">${hhmm(when)}${day ? `<span class="d">${esc(day)}</span>` : ""}</span>
        <span class="rail">${g.map(x => `<i style="background:${colorFor(x.openid)}"></i>`).join("")}</span>
        <div><div class="l1">${names}</div><div class="l2">${esc(meta)}</div></div>
        <span class="kl">${splitKnown(g)
          ? `<span>${opKills(g)} <em>op</em></span><span class="ai">${aiKills(g)} <em>ai</em></span>`
          : `<span>${sum(g, x => x.kill_count)} <em>kills</em></span>`}</span>
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
    if (!rows.length) return `<div class="det"><span class="empty">No roster yet for this match. Older raids are still being filled in, a few per minute.</span></div>`;
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

  // ---------- account (top right) ----------
  // Reads like being logged in to a website, because that is what it is from the player's side:
  // who you are, whether your matches are being collected, and the few things you can do about it.
  // No openids, no cookies, no poll intervals — those live in the README.
  let menuOpen = false;

  function renderAccount() {
    const el = $("#acct");
    if (!el) return;
    const me = state.focus === "all" ? null : state.players.find(p => p.openid === state.focus);
    const srv = me ? state.sessions.find(x => x.openid === me.openid) : state.sessions.length === 1 ? state.sessions[0] : null;
    const mine = ls(CTL_KEY);                                   // the account this browser connected itself
    const own = srv ? srv.openid === mine : false;
    const player = srv ? state.players.find(p => p.openid === srv.openid) : me;
    const name = player ? playerName(player.openid) : null;

    // Nothing is being collected for this player: offer the front door.
    if (!srv) {
      el.innerHTML = `<a class="signin" href="${connectHref()}">${state.players.length ? "Connect" : "Connect account"}</a>`;
      return;
    }

    const secs = srv.last_ok_at ? (Date.now() - new Date(srv.last_ok_at)) / 1000 : null;
    let dot = "ok", msg, meta = null;
    if (srv.has_error) {
      dot = "bad";
      msg = "Your Delta Force login has run out, so nothing new is coming in. Reconnecting takes two clicks.";
    } else if (secs !== null && secs > 30 * 60) {
      dot = "warn";
      msg = "Collection has gone quiet. It usually catches up on its own; reconnect if it stays like this.";
      meta = `Last checked ${ago(srv.last_ok_at)}`;
    } else {
      msg = "Your matches are collected for you automatically — nothing needs to be running, not even this tab.";
      meta = srv.last_ok_at ? `Last checked ${ago(srv.last_ok_at)}` : "First check due any moment";
    }

    const acts = [];
    if (srv.has_error) acts.push(`<a class="go" href="${connectHref()}">Reconnect</a>`);
    if (inviteQS) acts.push(`<button id="invite">Invite a mate</button>`);
    acts.push(`<a href="https://www.playdeltaforce.com/events/hq/en/" target="_blank" rel="noopener">Open Delta Force HQ ›</a>`);
    if (!srv.has_error) acts.push(`<a href="${connectHref()}">Reconnect</a>`);
    if (own) acts.push(`<button class="bad" id="disc">Stop collecting</button>`);

    el.innerHTML = `<button class="chip" id="acctBtn" aria-expanded="${menuOpen}">
        <span class="ava">${esc((name || "?").trim().charAt(0))}</span>
        <span class="nm">${esc(name || "Connected")}</span><i class="dot ${dot}"></i>
      </button>
      <div class="menu" id="acctMenu"${menuOpen ? "" : " hidden"}>
        <div class="hd"><span class="ava">${esc((name || "?").trim().charAt(0))}</span>
          <div><b>${esc(name || "Your account")}</b>${player && player.level ? `<span>Level ${esc(player.level)}</span>` : ""}</div></div>
        <p class="msg">${msg}</p>
        ${meta ? `<div class="meta">${meta}</div>` : ""}
        <div class="mi">${acts.join("")}</div>
      </div>`;

    $("#acctBtn").onclick = (e) => { e.stopPropagation(); menuOpen = !menuOpen; $("#acctMenu").hidden = !menuOpen; };

    const inv = $("#invite");
    if (inv) inv.onclick = async () => {
      const url = location.origin + location.pathname.replace(/[^/]*$/, "") + "connect.html" + inviteQS;
      try { await navigator.clipboard.writeText(url); inv.textContent = "Link copied"; }
      catch (e) { inv.textContent = "Copy failed"; prompt("Send them this link:", url); }
      setTimeout(() => { if ($("#invite")) $("#invite").textContent = "Invite a mate"; }, 1800);
    };

    // Two clicks, because it throws away the login the server is collecting with.
    const disc = $("#disc");
    if (disc) disc.onclick = async () => {
      if (disc.dataset.armed !== "1") { disc.dataset.armed = "1"; disc.textContent = "Sure? Click again"; return; }
      disc.disabled = true; disc.textContent = "…";
      const r = await fetch(C.SUPABASE_URL + "/functions/v1/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + C.SUPABASE_ANON_KEY },
        body: JSON.stringify({ action: "disconnect", openid: mine, control_key: ls(CTL_KEY + "-key") || "" }),
      }).then(x => x.json()).catch(() => null);
      if (r && r.ok) { try { localStorage.removeItem(CTL_KEY); localStorage.removeItem(CTL_KEY + "-key"); } catch (e) { /* ignore */ } }
      menuOpen = false;
      await load().catch(() => { });
    };
  }

  // Click anywhere else, or press Escape, and the menu closes — standard behaviour for this corner.
  document.addEventListener("click", () => {
    if (!menuOpen) return;
    menuOpen = false;
    const m = $("#acctMenu");
    if (m) m.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !menuOpen) return;
    menuOpen = false;
    const m = $("#acctMenu");
    if (m) m.hidden = true;
  });

  // ---------- right column ----------
  // Per-match bars answered "how did that one go", which the feed already says in words. The
  // question they could not answer is the one that matters over a range: am I up or down, and
  // which raid moved it. So this is a running total, oldest to newest, with a zero line.
  function renderIncomeChart(ms, sol) {
    const el = $("#incomeChart"), foot = $("#incomeFoot");
    const rows = ms.slice().reverse();                                  // a running total only reads forwards
    $("#incomeTitle").textContent = (sol ? "Net income" : "Score") + " · running total · " + rangeWord();
    if (!rows.length) { el.innerHTML = `<div class="empty">No ${raid(2)} in this range.</div>`; foot.innerHTML = ""; const lg0 = $("#incomeLegend"); if (lg0) lg0.innerHTML = ""; return; }
    const val = (m) => Number(sol ? m.net_income : m.score) || 0;
    let acc = 0;
    const pts = rows.map(m => ({ m, v: val(m), c: (acc += val(m)) }));
    // The running total's own median: half the range was spent above this level, half below. It is
    // the reference the line is coloured against, so green and red mean "better or worse than
    // your typical standing" rather than repeating the sign of the number.
    const sorted = pts.map(p => p.c).sort((a, b) => a - b);
    const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    // padR leaves room for the running total to sit at the end of the line without falling off.
    const W = 640, H = 190, padT = 14, padB = 22, padR = 92;
    const PW = W - padR;
    const hi = Math.max(0, ...pts.map(p => p.c)), lo = Math.min(0, ...pts.map(p => p.c)), spanV = (hi - lo) || 1;
    const x = (i) => pts.length === 1 ? PW / 2 : i / (pts.length - 1) * PW;
    const y = (v) => padT + (hi - v) / spanV * (H - padT - padB);
    const end = pts[pts.length - 1].c, zero = y(0), medY = y(med);
    const peak = pts.reduce((a, p) => p.c > a.c ? p : a, pts[0]);
    // Two stops at the same offset make a hard edge exactly on the median line, so the stroke and
    // the fill change colour where they cross it. No path-splitting, no rounding seams.
    const stop = (medY / H).toFixed(4);
    // A range with a single raid still deserves a readable level: draw it flat across the plot.
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join("")
      + (pts.length === 1 ? `L${PW},${y(pts[0].c).toFixed(1)}` : "");
    const endTxt = sol ? full(end) : plain(end);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${sol ? "Net income" : "Score"} running total across ${pts.length} ${raid(pts.length)}, oldest first; ends at ${endTxt}, median ${sol ? full(med) : plain(med)}">
        <defs>
          <linearGradient id="il" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">
            <stop offset="${stop}" stop-color="${GREEN}"/><stop offset="${stop}" stop-color="${RED}"/></linearGradient>
          <linearGradient id="ig" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">
            <stop offset="0" stop-color="${GREEN}" stop-opacity=".28"/>
            <stop offset="${stop}" stop-color="${GREEN}" stop-opacity=".05"/>
            <stop offset="${stop}" stop-color="${RED}" stop-opacity=".05"/>
            <stop offset="1" stop-color="${RED}" stop-opacity=".28"/></linearGradient>
        </defs>
        ${pts.length > 1 ? `<path d="${line}L${x(pts.length - 1).toFixed(1)},${medY.toFixed(1)}L${x(0).toFixed(1)},${medY.toFixed(1)}Z" fill="url(#ig)"/>` : ""}
        ${Math.abs(zero - medY) > 6 ? `<line class="zero" x1="0" x2="${PW}" y1="${zero.toFixed(1)}" y2="${zero.toFixed(1)}"/>` : ""}
        <line class="med" x1="0" x2="${PW}" y1="${medY.toFixed(1)}" y2="${medY.toFixed(1)}"/>
        <path d="${line}" fill="none" stroke="url(#il)" stroke-width="2" stroke-linejoin="round"/>
        <circle class="tipend" cx="${x(pts.length - 1).toFixed(1)}" cy="${y(end).toFixed(1)}" r="3.5" fill="${end >= med ? GREEN : RED}"/>
        <line class="cross" x1="0" x2="0" y1="${padT}" y2="${H - padB}" style="display:none"/>
        <circle class="tipdot" r="4.5" fill="${GREEN}" stroke="var(--ground)" stroke-width="2" style="display:none"/>
      </svg>
      <div class="endv" style="left:${(100 * x(pts.length - 1) / W).toFixed(2)}%;top:${(100 * y(end) / H).toFixed(2)}%">${endTxt}</div>`;
    foot.innerHTML = `<span>${pts.length} ${raid(pts.length)} · from ${new Date(rows[0].match_time).toLocaleDateString([], { day: "numeric", month: "short" })}</span>
      ${peak.c > end ? `<span>peak ${sol ? full(peak.c) : plain(peak.c)}</span>` : ""}
      <span>median ${sol ? full(med) : plain(med)}</span>`;
    const lg = $("#incomeLegend");
    if (lg) lg.innerHTML = `<span><i style="background:${GREEN}"></i>above median</span><span><i style="background:${RED}"></i>below</span>`;

    // The label is sized in real pixels over a plot that is not, so at a narrow column it can
    // reach past the right edge. Measure once and pin it to the edge instead of letting it clip.
    const ev = el.querySelector(".endv");
    if (ev && ev.getBoundingClientRect().right > el.getBoundingClientRect().right) {
      ev.style.left = "auto"; ev.style.right = "0"; ev.style.marginLeft = "0";
    }

    // Crosshair: the whole plot is the hit target, so no raid is too thin to point at.
    const svg = el.querySelector("svg"), cross = svg.querySelector(".cross"), dot = svg.querySelector(".tipdot");
    const nearest = (clientX) => {
      const r = svg.getBoundingClientRect(), fx = (clientX - r.left) / r.width * W;
      let best = 0;
      pts.forEach((p, i) => { if (Math.abs(x(i) - fx) < Math.abs(x(best) - fx)) best = i; });
      return best;
    };
    const move = (clientX, clientY) => {
      const i = nearest(clientX), p = pts[i], px = x(i).toFixed(1);
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.style.display = "";
      dot.setAttribute("cx", px); dot.setAttribute("cy", y(p.c).toFixed(1));
      dot.setAttribute("fill", p.c >= med ? GREEN : RED); dot.style.display = "";
      const k = p.m.kill_operator != null ? `${p.m.kill_operator} operator + ${p.m.kill_other} AI` : `${p.m.kill_count || 0} kills`;
      showTip(clientX, clientY, `<b>${esc(playerName(p.m.openid))}</b> · ${esc(mapFull(p.m.map_id))}<br>
        ${outcome(p.m)[1]} · ${k} · ${dayLabel(p.m.finished_at || p.m.match_time) || "today"} ${hhmm(p.m.finished_at || p.m.match_time)}<br>
        This ${raid(1)} ${sol ? full(p.v) : plain(p.v)} · running total ${sol ? full(p.c) : plain(p.c)}`);
    };
    svg.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
    svg.addEventListener("touchstart", (e) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }, { passive: true });
    svg.addEventListener("mouseleave", () => { cross.style.display = "none"; dot.style.display = "none"; hideTip(); });
  }

  // Same bar as the bands: length is how much you played, the filled part is how it went. A day
  // with one lucky raid stays a sliver instead of reading as a hundred per cent day.
  function renderRaidsChart(ms, sol) {
    const one = state.focus !== "all";
    $("#rateTitle").textContent = one ? "By day · " + raid(2) : "By player · " + raid(2);
    let rows;
    if (one) {
      const by = new Map();
      for (const m of ms) {
        const d = new Date(m.match_time); d.setHours(d.getHours() - 4);  // the gaming day starts at 04:00
        const k = d.toISOString().slice(0, 10), e = by.get(k) || { n: 0, w: 0, d };
        e.n++; e.w += isWin(m) ? 1 : 0; by.set(k, e);
      }
      rows = [...by.entries()].sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 12)
        .map(([, v]) => ({ label: v.d.toLocaleDateString([], { day: "numeric", month: "short" }), n: v.n, w: v.w, color: GREEN }));
    } else {
      rows = state.players.map(p => { const pm = ms.filter(m => m.openid === p.openid); return { label: playerName(p.openid), n: pm.length, w: pm.filter(isWin).length, color: colorFor(p.openid) }; })
        .filter(r => r.n).sort((a, b) => b.n - a.n);
    }
    const el = $("#rateChart");
    if (!rows.length) { el.innerHTML = `<div class="empty">No ${raid(2)} in this range.</div>`; return; }
    const legend = one
      ? `<div class="legend"><span><i style="background:${GREEN}"></i>${rateWord()}</span><span><i style="background:var(--fail)"></i>${lostWord()}</span></div>`
      : `<div class="legend"><span><i style="background:var(--fail)"></i>${lostWord()}</span><span>filled = ${rateWord()}, in each player's colour</span></div>`;
    el.innerHTML = legend + `<div class="gauge">${rows.map(r => `<div class="g" data-tip="<b>${esc(r.label)}</b>: ${r.w} of ${r.n} ${raid(r.n)} ${rateWord()}">
        <span class="nm">${esc(r.label)}</span>${barCell(r.w, r.n, r.color)}<span class="v">${pct(r.w, r.n)}</span></div>`).join("")}</div>`;
    attachTips(el);
  }

  // He plays in bursts, so "today" is often genuinely empty. One clear line beats five modules
  // each saying nothing, and it offers the range that does have something in it.
  function renderNudge(ms) {
    const el = $("#nudge");
    if (!el) return;
    const last = scoped(state.recent).map(r => r.match_time).sort().pop();
    if (ms.length || !last) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = `<span>No ${raid(2)} ${state.range === "today" ? "yet today" : "in this range"}. The last one was <b>${ago(last)}</b>.</span>
      ${state.range === "7d" ? "" : `<button data-jump="7d">Show 7 days</button>`}<button data-jump="all">Show everything</button>`;
    el.querySelectorAll("[data-jump]").forEach(b => b.onclick = () => setRange(b.dataset.jump));
  }

  // The valuable things, newest first, across the page instead of stacked in the sidebar — there
  // is room for the whole history that way, and the feed is capped regardless.
  function renderReds() {
    const el = $("#reds"), reds = scoped(state.reds), foot = $("#redsFoot");
    if (!reds.length) { el.innerHTML = `<div class="empty">Nothing picked up yet.</div>`; if (foot) foot.textContent = ""; return; }
    const many = state.players.length > 1;
    if (foot) foot.textContent = `${reds.length} since ${new Date(reds[reds.length - 1].unlock_time).toLocaleDateString([], { day: "numeric", month: "short" })}`;
    el.innerHTML = `<div class="reds">${reds.map(r => {
      const it = item(r.collection_id);
      return `<div class="red" data-tip="<b>${esc(it.name)}</b><br>${esc(playerName(r.openid))} · ${esc(mapFull(r.map_id))}<br>${esc(new Date(r.unlock_time).toLocaleString())}${r.value ? `<br>Worth ${plain(r.value)}` : ""}">
        ${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" onerror="this.removeAttribute('src')">` : `<div class="ph"></div>`}
        <div class="n">${esc(it.name)}</div>
        <div class="v">${r.value ? fmt(r.value) : "–"}</div>
        <div class="m">${many ? sq(colorFor(r.openid)) : ""}${esc(mapBase(r.map_id))} · ${ago(r.unlock_time)}</div></div>`;
    }).join("")}</div>`;
    attachTips(el);
  }

  // HQ keys the passwords by internal map slugs — "bakshe", "spaceport", "longbow_valley" — which
  // are not what any of these maps is called in the game. These are the six Operations maps in the
  // official English wording; anything new falls back to a tidied-up slug.
  const PW_MAPS = {
    zero_dam: "Zero Dam", longbow_valley: "Layali Grove", layali_grove: "Layali Grove",
    spaceport: "Space City", space_city: "Space City", bakshe: "Brakkesh", brakkesh: "Brakkesh",
    tide_prison: "Tide Prison", az3: "AZ3",
  };
  const pwMap = (k) => PW_MAPS[String(k).toLowerCase()] || label(k).replace(/\b\w/g, c => c.toUpperCase());
  function renderPasswords() {
    const el = $("#passwords"), pw = state.passwords, foot = $("#pwFoot");
    if (foot) foot.textContent = pw ? "fetched " + ago(pw.updated_at) : "";
    if (!pw || !pw.value || typeof pw.value !== "object") { el.innerHTML = `<div class="empty">Not fetched yet.</div>`; return; }
    const rows = Object.entries(pw.value).filter(([, v]) => v != null && v !== "");
    if (!rows.length) { el.innerHTML = `<div class="empty">None published today.</div>`; return; }
    // A flat map -> code object is the shape it has always had. If that ever changes, fall back to
    // the generic renderer rather than showing "[object Object]" as a password.
    if (!rows.every(([, v]) => typeof v === "string" || typeof v === "number")) { el.innerHTML = renderAny(pw.value); return; }
    el.innerHTML = rows.map(([k, v]) => `<div class="pwi"><div class="m">${esc(pwMap(k))}</div><div class="c">${esc(String(v))}</div></div>`).join("");
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
  function showTip(clientX, clientY, html) {
    tip.innerHTML = html;
    tip.style.display = "block";
    tip.style.left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, clientX + 12)) + "px";
    tip.style.top = Math.max(8, Math.min(window.innerHeight - tip.offsetHeight - 8, clientY + 12)) + "px";
  }
  const hideTip = () => { tip.style.display = "none"; };
  function attachTips(root) {
    root.querySelectorAll("[data-tip]").forEach(n => {
      n.addEventListener("mousemove", (e) => showTip(e.clientX, e.clientY, n.getAttribute("data-tip")));
      n.addEventListener("mouseleave", hideTip);
      // A phone has no hover, so a tap on the mark shows the same numbers.
      n.addEventListener("touchstart", (e) => { const t = e.touches[0]; if (t) showTip(t.clientX, t.clientY, n.getAttribute("data-tip")); }, { passive: true });
    });
  }
  document.addEventListener("touchstart", (e) => { if (tip.style.display === "block" && !e.target.closest("[data-tip], .chart")) hideTip(); }, { passive: true });

  // ---------- filters ----------
  function setRange(v) {
    document.querySelectorAll("[data-range]").forEach(x => x.classList.toggle("on", x.dataset.range === v));
    state.range = v; state.showAll = false;
    load().catch(() => { });
  }
  document.querySelectorAll("[data-range]").forEach(b => b.onclick = () => setRange(b.dataset.range));
  document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { document.querySelectorAll("[data-mode]").forEach(x => x.classList.toggle("on", x === b)); state.mode = Number(b.dataset.mode); state.showAll = false; load(); });

  // ---------- boot ----------
  // HTML and JS are deployed together but cached separately (Pages CDN, max-age 600). If they mismatch, reload once.
  if (!$("#cells") || !$("#feed") || !$("#pwBand") || !$("#redsBand")) {
    try { if (!sessionStorage.getItem("df-reloaded")) { sessionStorage.setItem("df-reloaded", "1"); location.reload(); return; } } catch (e) { /* ignore */ }
    return;
  }
  try { sessionStorage.removeItem("df-reloaded"); } catch (e) { /* ignore */ }
  if (!C || !C.SUPABASE_URL || C.SUPABASE_URL.startsWith("__")) { $("#banner").hidden = false; $("#banner").textContent = "config.js is not filled in."; return; }
  if (window.__mapsFailed) console.warn("maps_en.js failed to load; using fallback names");
  load().catch(e => { $("#banner").hidden = false; $("#banner").textContent = "Could not load data: " + e.message; $("#status").textContent = "error"; });
  setInterval(() => load().catch(() => { $("#status").textContent = "refresh failed"; }), (C.REFRESH_SECONDS || 30) * 1000);
})();
