/* Loadouts — community weapon builds, per weapon, credited to whoever made them.
 *
 * Nothing here comes from HQ. HQ knows what you own and what you did with it; it does not know
 * what the people who play this game for a living put on their rifles. That lives on their own
 * pages — a Google Doc, a build site of their own — so this tab is a curated file
 * (data/loadouts.json) rather than an API call, and every build in it carries the face and the
 * name of the person who made it, next to a link to the page they published it on.
 *
 * The one thing a build is really for is its import code: in game, Gun Customization > Preset >
 * Import > paste. So the code is the object here — big, monospaced, one click to copy — and
 * everything else on the card exists to tell you whether you want to paste it.
 *
 * It has the shape of a tab module (see README, "Tabs and event modules") but it lives on a page of
 * its own, loadouts/index.html, because it is the one part of the site anybody may open: no
 * account, no board, nothing read from the database. That page is its whole host (loadouts/page.js);
 * the board only has a link to it on its tab bar. It loads its own file the first time it is painted.
 *
 * The filters live in the address, so a link says exactly what it shows:
 *   loadouts/?creator=leissik            everything Leissik publishes
 *   loadouts/?creator=leissik&weapon=m7  Leissik's M7 builds
 *   loadouts/?class=smg&mode=warfare     Warfare SMG builds
 *   loadouts/?q=budget                   the search box
 * A link with any of those shows exactly that and nothing remembered; a bare loadouts/ picks up
 * where this browser left off, and the address follows every change either way.
 *
 * Every creator also has an address of their own, thesitrep.gg/leissik — the same page with the
 * creator pinned (window.DF_LOADOUTS_CREATOR, written by tools/loadouts/pages.py). That is the link
 * a creator's name on a card goes to. Pinned, the creator is not a filter any more: it is not in
 * the address, the creator picker gives way to a link back to everyone, and nothing this browser
 * remembers from loadouts/ carries over, so /leissik/ always opens on all of Leissik's builds. The
 * other filters still go in the address: /leissik/?weapon=m7.
 */
(function () {
  const DATA_URL = "data/loadouts.json?v=1";
  const KEY = "df-loadouts";          // the rail's own state, per browser

  const PIN = window.DF_LOADOUTS_CREATOR || null;
  const FRESH = () => ({ sel: null, mode: "all", cls: "all", creator: PIN || "all", q: "" });
  let DB = null, state = FRESH(), phase = "idle";

  // Who is streaming right now, asked once when the page loads. The `live` function
  // (supabase/functions/live) checks every creator's Twitch and YouTube when asked; nothing runs on
  // a timer and nothing here is remembered, so a reload is how the badges catch up.
  const LIVE_URL = ((window.DF_CONFIG && window.DF_CONFIG.SUPABASE_URL) || "https://faaskhwycywnwpdjcvgp.supabase.co") + "/functions/v1/live";
  const PLATFORM = { twitch: "Twitch", youtube: "YouTube" };
  let LIVE = {}, liveAsked = false;
  function watchLive(h) {
    if (liveAsked) return;
    liveAsked = true;
    fetch(LIVE_URL).then(r => r.ok ? r.json() : null).then(d => {
      LIVE = (d && d.live) || {};
      if (DB && Object.keys(LIVE).length) h.repaint();
    }).catch(() => { /* no badge is the honest fallback */ });
  }
  const liveOf = (k) => (LIVE[k] && LIVE[k][0]) || null;
  // "for 2h 14m", from when the stream started; YouTube's Streams tab does not say, so nothing.
  const onFor = (since) => {
    const m = since ? Math.floor((Date.now() - Date.parse(since)) / 60000) : NaN;
    return !(m >= 0) ? "" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  };
  // A creator's channel link. The one they are live on right now opens the stream instead of the
  // channel and carries a small red dot; that and the ring on their face are the whole signal.
  const chanHtml = (u, on, name, cls, e) => {
    const live = on && on.platform === (/twitch\.tv\//i.test(u) ? "twitch" : /youtube\.com\//i.test(u) ? "youtube" : "");
    return `<a class="${cls}${live ? " lchon" : ""}" href="${e(live ? on.url : u)}" target="_blank" rel="noopener noreferrer"${live
      ? ` title="${e(name)} is live${onFor(on.since) ? " · " + e(onFor(on.since)) : ""}${on.title ? " — " + e(on.title) : ""}"` : ""}>${e(netName(u))}</a>`;
  };

  // The address's name for each filter. Values are plain lower-case words — a creator's key, a
  // weapon's short name squeezed to letters and digits, a class — so a link is readable before it
  // is clicked and can be typed by hand.
  const PARAM = { creator: "creator", sel: "weapon", cls: "class", mode: "mode", q: "q" };
  const DEFAULT = FRESH();
  const fromUrl = (() => {
    const p = new URLSearchParams(location.search), got = {};
    for (const [k, name] of Object.entries(PARAM)) if (p.get(name)) got[k] = p.get(name).trim();
    return Object.keys(got).length ? got : null;
  })();
  if (fromUrl) Object.assign(state, fromUrl, PIN ? { creator: PIN } : {});
  else if (!PIN) try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { /* private window */ }

  const toQuery = () => {
    const p = new URLSearchParams();
    for (const [k, name] of Object.entries(PARAM)) {
      if (state[k] == null || state[k] === DEFAULT[k] || state[k] === "" || (PIN && k === "creator")) continue;
      p.set(name, k === "cls" ? String(state[k]).toLowerCase() : state[k]);
    }
    return p.toString();
  };
  // Every change is written to this browser and to the address. replaceState rather than
  // pushState: a filter is not somewhere you went, and Back should leave the page, not undo a click.
  const save = () => {
    if (!PIN) try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    const q = toQuery();
    try { history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash); } catch (e) {}
    document.title = titleOf();
  };

  // ---------- the official weapon table ----------
  // Names, classes, images and the stat bars come from playdeltaforce.com's own manifest, exactly
  // as the map names and the card names do. A build file that named a weapon the game does not
  // have would otherwise be invisible; matching against the manifest is what catches that.
  // The manifest's own category names are the in-game abbreviations ("SR", "MR"); spelled out here
  // because these are filter buttons, not a stat sheet.
  const CLASS = { "1": "Rifle", "2": "SMG", "3": "Sniper", "4": "LMG", "5": "Marksman", "6": "Pistol", "7": "Shotgun", "8": "Special" };
  const TAIL = /\s+(Assault Rifle|Compact Assault Rifle|Submachine Gun|Sniper Rifle|Marksman Rifle|Battle Rifle|General Machine Gun|Light Machine Gun|Machine Gun|Shotgun|Pistol|Revolver|Carbine)\s*$/i;  // not Bow — "Compound Bow" is the whole name
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const GUNS = (() => {
    const raw = window.basic_info_guns;
    if (!raw || !Array.isArray(raw.guns)) return [];
    return raw.guns.map(g => {
      const full = (g.language && g.language.en) || "";
      const short = full.replace(TAIL, "").trim() || full;
      return {
        id: g.gun_id, full, short, key: norm(short),
        cls: CLASS[g.category] || (raw.guncategory_map && raw.guncategory_map[g.category]) || "Other",
        img: g.image_w480_url || g.image_url, caliber: g.caliber, capacity: g.capacity,
        stats: [
          ["Damage", +g.gun_base_damage], ["Range", +g.gun_range], ["Stability", +g.gun_stability],
          ["Recoil ctrl", +g.gun_recoil_control], ["Handling", +g.gun_handling_speed], ["Hip fire", +g.gun_hip_fire],
        ].filter(s => s[1] > 0),
      };
    });
  })();
  const GUN_BY = (() => {
    const m = {};
    for (const g of GUNS) { m[g.key] = g; m[norm(g.full)] = g; }
    return m;
  })();
  const gunOf = (name) => GUN_BY[norm(name)] || null;

  // ---------- reading the file ----------
  function ensure(h) {
    watchLive(h);
    if (phase !== "idle") return;
    phase = "loading";
    fetch(DATA_URL, { cache: "no-cache" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
      .then(d => {
        DB = d;
        DB.builds = (d.builds || []).map(b => Object.assign({}, b, { gun: gunOf(b.weapon) }));
        settle();
        phase = "ready";
        save();
        h.repaint();
      })
      .catch(() => { phase = "failed"; h.repaint(); });
  }

  // A link is typed, pasted and truncated by people, so what it says is matched loosely — "Leissik",
  // "leissik" and a creator's display name all find the same person, "smg" and "SMG" the same class
  // — and written back in the one spelling this page uses. Whatever still matches nothing is
  // dropped rather than kept: a filter that cannot match leaves an empty page and no way to see why.
  function settle() {
    if (state.creator !== "all" && !(DB.creators || {})[state.creator]) {
      const n = norm(state.creator);
      const k = Object.keys(DB.creators || {}).find(k => norm(k) === n || norm(DB.creators[k].name) === n);
      state.creator = k || "all";
    }
    if (state.cls !== "all") {
      const hit = [...new Set(DB.builds.map(b => (b.gun ? b.gun.cls : "Other")))].find(c => norm(c) === norm(state.cls));
      state.cls = hit || "all";
    }
    if (!["all", "operations", "warfare"].includes(state.mode)) state.mode = "all";
    if (state.sel) {
      const n = norm(state.sel), b = DB.builds.find(b => (b.gun ? b.gun.key : norm(b.weapon)) === n || norm(b.weapon) === n);
      state.sel = b ? (b.gun ? b.gun.key : norm(b.weapon)) : null;
    }
  }
  function titleOf() {
    const bits = [];
    if (DB && state.sel) { const b = DB.builds.find(b => (b.gun ? b.gun.key : norm(b.weapon)) === state.sel); if (b) bits.push(b.gun ? b.gun.short : b.weapon); }
    if (DB && state.creator !== "all") bits.push(creatorOf({ creator: state.creator }).name);
    return (bits.length ? bits.join(" · ") + " · " : "") + "Loadouts · Sitrep";
  }

  const creatorOf = (b) => (DB.creators && DB.creators[b.creator]) || { name: b.creator || "Unknown" };
  // Where a creator's name goes: their own page on this site (thesitrep.gg/leissik), or, for one
  // whose name could not have an address, the same view as a filter.
  const homeOf = (k) => { const c = (DB.creators || {})[k]; return c && c.page ? c.page : "loadouts/?creator=" + encodeURIComponent(k); };
  const sourceOf = (b) => (DB.sources && DB.sources[b.source]) || { name: b.source || "" };
  const MODES = { operations: "Operations", warfare: "Warfare", both: "Both modes" };
  // Everything in the file is Operations today. A mode chip on every card, and a row of mode
  // buttons that cannot change anything, would both be furniture — so they appear only once the
  // file actually holds more than one mode.
  const modes = () => [...new Set(DB.builds.map(b => b.mode))];

  // Which of a creator's builds for one gun is the current one? Three answers, in that order: the
  // date, where the page carries one; the season, which only Leissik labels but which is the right
  // answer where it is there, since a rebalance is what makes an old build stop being advice; and
  // failing both, `pos` — where it stands on their page, because people put what they still run at
  // the top. None of this used to matter: a cap of three per gun meant you rarely saw a stale one.
  // Now that everything a creator publishes is kept, the order is what does that job.
  const SEASON = /^season\s*(\d+)$/i;
  const season = (b) => {
    for (const t of b.tags || []) { const m = SEASON.exec(String(t).trim()); if (m) return +m[1]; }
    return 0;
  };

  // Everything the rail and the pane read goes through one filter, so the counts on the weapon
  // list are the counts of what clicking it would actually show.
  function visible() {
    const q = norm(state.q);
    return DB.builds.filter(b =>
      (state.mode === "all" || b.mode === state.mode || b.mode === "both") &&
      (state.creator === "all" || b.creator === state.creator) &&
      (!q || norm(b.weapon).includes(q) || norm(creatorOf(b).name).includes(q) || norm((b.tags || []).join(" ")).includes(q)));
  }
  function weapons(list) {
    const by = new Map();
    for (const b of list) {
      const g = b.gun, key = g ? g.key : norm(b.weapon);
      if (!by.has(key)) by.set(key, { key, name: g ? g.short : b.weapon, cls: g ? g.cls : "Other", gun: g, builds: [] });
      by.get(key).builds.push(b);
    }
    return [...by.values()]
      .filter(w => state.cls === "all" || w.cls === state.cls)
      .sort((a, b) => b.builds.length - a.builds.length || a.name.localeCompare(b.name));
  }

  const pill = (on, val, label, group) =>
    `<button type="button" class="lpill ${on ? "on" : ""}" data-f="${group}" data-v="${val}">${label}</button>`;

  // ---------- registration ----------
  window.DF_TABS = window.DF_TABS || [];
  window.DF_TABS.push({
    id: "loadouts",
    label: "Loadouts",
    // The card counter belongs to a page about a card collection. Nothing on this page is a
    // match or a card, so the slot beside the headline stays empty here.
    aside: false,
    // Nothing on this page is a match, so neither the mode nor the range picker applies: the mode
    // here is the mode a build is *for*, which is a filter of its own inside the pane.
    filters: false,

    // Three figures, because only three of them change what you do next: whether your gun is in
    // here at all, whose builds these are, and how old the file is. A count of Operations builds
    // next to a button that filters to Operations builds is not a statistic.
    hero(data, h) {
      if (phase !== "ready" || !DB) return null;
      // The class is applied per weapon (weapons()), so the count is taken from there too.
      const all = DB.builds, list = [].concat(...weapons(visible()).map(w => w.builds)), e = h.esc;
      const cover = new Set(all.filter(b => b.gun).map(b => b.gun.key));
      const shown = list.length !== all.length;
      // On a creator's own page the person is the headline, not a number: their face, their name,
      // what they publish and where, and which classes they build for. That last one is the thing
      // a stranger wants to know first — is this somebody who builds rifles or somebody who builds
      // everything — and nothing else on the page says it at a glance. It describes them, not the
      // filter, so it does not move when the rail does.
      if (PIN && DB.creators && DB.creators[PIN]) return { profile: profileHtml(DB.creators[PIN], all.filter(b => b.creator === PIN), e) };
      return {
        eyebrow: "Loadouts · community builds",
        big: String(shown ? list.length : all.length),
        sub: shown ? "builds matching the filter" : (all.length === 1 ? "build tracked" : "builds tracked"),
        cells: [
          ["Weapons covered", `${cover.size}<span style="color:var(--muted)">/${GUNS.length || "?"}</span>`,
            GUNS.length ? "of every gun in the game" : null],
          ["Creators", String(Object.keys(DB.creators || {}).length), "every build is theirs, not ours",
            "Everything on this page was read off a page one of these people publishes themselves. Nothing is copied from a site that collects other people's builds."],
          ["Last updated", DB.updated ? e(shortDate(DB.updated)) : "–", "the day these builds last changed",
            "Their pages are re-read every morning. This is the day something in them last actually changed — a morning that finds the same builds does not move it. The link on each card is always the live original."],
        ],
      };
    },

    render(el, data, h) {
      const e = h.esc;
      ensure(h);
      if (phase === "loading" || phase === "idle") {
        el.innerHTML = `<section class="band"><div class="mod-label">Loadouts</div><div class="note">Reading the build list…</div></section>`;
        return;
      }
      if (phase === "failed" || !DB || !DB.builds.length) {
        el.innerHTML = `<section class="band"><div class="mod-label">Loadouts</div>
          <div class="note">The build list could not be read. It is a static file on this site (<code>data/loadouts.json</code>), so this is a deploy problem rather than anything to do with your account.</div></section>`;
        return;
      }

      const list = visible(), ws = weapons(list);
      // One creator and no weapon picked is a page about that person: every build they publish,
      // grouped by gun, rather than their first gun standing in for the rest. That is what a link
      // like ?creator=leissik is for. Picking a gun narrows it to that gun's panel, as before.
      const whole = state.creator !== "all" && !state.sel && ws.length > 0;
      const sel = whole ? null : ws.find(w => w.key === state.sel) || ws[0] || null;
      // A weapon the other filters have since ruled out is not what this page shows, so it leaves
      // the address too — otherwise the link would name a gun its reader never sees.
      if (state.sel && (!sel || sel.key !== state.sel)) { state.sel = null; save(); if (state.creator !== "all") return h.repaint(); }
      const classes = [...new Set(DB.builds.map(b => (b.gun ? b.gun.cls : "Other")))]
        .sort((a, b) => a.localeCompare(b));
      const creators = Object.keys(DB.creators || {})
        .map(k => ({ k, c: DB.creators[k], n: DB.builds.filter(b => b.creator === k).length }))
        .filter(x => x.n).sort((a, b) => b.n - a.n || a.c.name.localeCompare(b.c.name));

      el.innerHTML = `<div class="lo">
        <div class="lo-rail">
          <div class="lsearch"><input id="loQ" type="search" placeholder="Search weapon, creator or tag" value="${e(state.q)}" autocomplete="off"></div>
          ${modes().length > 1 ? `<div class="lfilters">
            ${pill(state.mode === "all", "all", "All modes", "mode")}
            ${pill(state.mode === "operations", "operations", "Operations", "mode")}
            ${pill(state.mode === "warfare", "warfare", "Warfare", "mode")}
          </div>` : ""}
          <div class="lfilters">
            ${pill(state.cls === "all", "all", "All", "cls")}
            ${classes.map(c => pill(state.cls === c, c, e(c), "cls")).join("")}
          </div>
          ${PIN ? `<a class="lall" href="loadouts/${allQuery()}">&larr; Every creator (${creators.length})</a>`
            : `<div class="lsearch lpick"><select id="loCreator" aria-label="Creator">
            <option value="all">Every creator (${creators.length})</option>
            ${creators.map(x => `<option value="${e(x.k)}"${state.creator === x.k ? " selected" : ""}>${e(x.c.name)} (${x.n})${liveOf(x.k) ? " · LIVE" : ""}</option>`).join("")}
          </select></div>`}
          <div class="lwlist">
            ${state.creator !== "all" && ws.length ? `<button type="button" class="lw lwall ${whole ? "on" : ""}" data-w="">
                <span class="ln">All ${ws.length === 1 ? "their weapon" : ws.length + " weapons"}</span><span class="lc">${e(creatorOf({ creator: state.creator }).name)}</span><span class="lb">${list.length}</span>
              </button>` : ""}
            ${ws.length ? ws.map(w => `<button type="button" class="lw ${sel && w.key === sel.key ? "on" : ""}" data-w="${e(w.key)}">
                <span class="ln">${e(w.name)}</span><span class="lc">${e(w.cls)}</span><span class="lb">${w.builds.length}</span>
              </button>`).join("")
              : `<div class="note">Nothing matches that. <button type="button" class="link" style="color:var(--green)" data-f="reset" data-v="1">Clear the filters</button></div>`}
          </div>
        </div>
        <div class="lo-main">${whole ? creatorHtml(ws, list, h) : sel ? weaponHtml(sel, h) : ""}</div>
      </div>`;

      const q = el.querySelector("#loQ");
      if (q) {
        q.oninput = () => { state.q = q.value; save(); h.repaint(); };
        if (state.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      }
      const who = el.querySelector("#loCreator");
      if (who) who.onchange = () => { state.creator = who.value; save(); h.repaint(); };
      el.querySelectorAll("[data-w]").forEach(n => n.onclick = () => {
        state.sel = n.dataset.w || null; save(); h.repaint();
        // From the grouped page the weapon's own panel opens at the top, not wherever the
        // heading that was clicked happened to be scrolled to.
        if (n.classList.contains("lgh")) { const m = el.querySelector(".lo-main"); if (m && m.getBoundingClientRect().top < 0) m.scrollIntoView({ block: "start" }); }
      });
      el.querySelectorAll("[data-f]").forEach(n => n.onclick = () => {
        const f = n.dataset.f;
        if (f === "reset") { state = FRESH(); }
        else if (f === "creator") { state.creator = state.creator === n.dataset.v ? "all" : n.dataset.v; }
        else { state[f] = n.dataset.v; }
        save(); h.repaint();
      });
      el.querySelectorAll("[data-code]").forEach(n => n.onclick = () => copy(n));
      h.attachTips(el);
    },
  });

  // Leaving a creator's page for everyone keeps the rest of what was picked (the class, the mode,
  // the search) but not the weapon, which was one of theirs.
  const allQuery = () => {
    const p = new URLSearchParams(toQuery()); p.delete(PARAM.sel);
    const q = p.toString(); return q ? "?" + q : "";
  };

  const ordered = (bs) => bs.slice().sort((a, b) =>
    String(b.added || "").localeCompare(String(a.added || "")) ||
    creatorOf(a).name.localeCompare(creatorOf(b).name) ||
    season(b) - season(a) || (a.pos || 0) - (b.pos || 0));

  // ---------- a creator's own page: the profile at the top ----------
  // Its shape is in board.css (.lp), because tools/loadouts/pages.py writes the face and the name
  // into the page itself and they have to look right before this file has run.
  function profileHtml(c, theirs, e) {
    const guns = new Set(theirs.map(b => (b.gun ? b.gun.key : norm(b.weapon))));
    const by = {};
    for (const b of theirs) { const k = b.gun ? b.gun.cls : "Other"; by[k] = (by[k] || 0) + 1; }
    const classes = Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const max = classes.length ? classes[0][1] : 1;
    const src = (DB.sources && DB.sources[PIN] && DB.sources[PIN].name) || "Their builds page";
    const on = liveOf(PIN);
    const face = c.avatar ? `<img class="lp-av" src="${e(c.avatar)}" alt="" width="148" height="148">`
      : `<span class="lp-av none" aria-hidden="true">${e((c.name || "?").trim().charAt(0).toUpperCase())}</span>`;
    return `${on ? `<a class="lp-face onair" href="${e(on.url)}" target="_blank" rel="noopener noreferrer" aria-label="Watch ${e(c.name)} live">${face}<span class="llive">Live</span></a>` : face}
      <div class="lp-id">
        <div class="eyebrow"><i></i><span>Creator · Delta Force builds</span></div>
        <h1 class="lp-name" style="--len:${String(c.name).length}">${e(c.name)}</h1>
        <div class="lp-facts"><span><b>${theirs.length}</b> ${theirs.length === 1 ? "build" : "builds"}</span><s>/</s><span><b>${guns.size}</b> of ${GUNS.length || "?"} weapons</span><s>/</s><span>updated <b>${DB.updated ? e(shortDate(DB.updated)) : "–"}</b></span></div>
        <div class="lp-acts">
          ${c.url ? `<a class="pri" href="${e(c.url)}" target="_blank" rel="noopener noreferrer">${e(src)} &rarr;</a>` : ""}
          ${(c.links || []).map(u => chanHtml(u, on, c.name, "", e)).join("")}
        </div>
      </div>
      ${classes.length > 1 ? `<div class="lp-spread">
        <h3>Loadout spread · builds per class</h3>
        ${classes.map(([k, n]) => `<div class="lp-row"><span>${e(k)}</span><i><u style="width:${(n / max * 100).toFixed(1)}%"></u></i><b>${n}</b></div>`).join("")}
      </div>` : ""}`;
  }

  // ---------- one creator, every gun ----------
  // The person heads the page — face, name, their channels, how much they publish — and under them
  // every weapon they have builds for, in the rail's order, each with its cards. A weapon's heading
  // opens that weapon's own panel, which is where the stock stats are; repeated forty times down
  // one page they would be noise.
  function creatorHtml(ws, list, h) {
    const e = h.esc, c = creatorOf({ creator: state.creator });
    const links = c.links || [];
    // On their own page the profile above has already said all of this.
    if (PIN) return groupsHtml(ws, h);
    // Filtered to one creator on loadouts/, this header is the way to their own page: the face,
    // the name and a button all go there. Their builds page, off this site, keeps its own link.
    const face = c.avatar ? `<img class="lcav" src="${e(c.avatar)}" alt="" width="84" height="84">`
      : `<span class="lcav none" aria-hidden="true">${e((c.name || "?").trim().charAt(0).toUpperCase())}</span>`;
    const on = liveOf(state.creator);
    return `<div class="lhead lchead${on ? " onair" : ""}">
        ${c.page ? `<a class="lcava" href="${e(c.page)}" aria-hidden="true" tabindex="-1">${face}</a>` : face}
        <div class="lwmeta">
          <div class="lname">${c.page ? `<a href="${e(c.page)}">${e(c.name)}</a>` : e(c.name)}</div>
          <div class="lsub">${list.length} ${list.length === 1 ? "build" : "builds"} · ${ws.length} ${ws.length === 1 ? "weapon" : "weapons"}</div>
          ${c.page || c.url || links.length ? `<div class="lclinks">
            ${c.page ? `<a class="lpage" href="${e(c.page)}">Creator page &rarr;</a>` : ""}
            ${c.url ? `<a class="lsrc" href="${e(c.url)}" target="_blank" rel="noopener noreferrer">Their builds page &nearr;</a>` : ""}
            ${links.map(u => chanHtml(u, on, c.name, "lnet", e)).join("")}
          </div>` : ""}
        </div>
      </div>
      ${groupsHtml(ws, h)}`;
  }

  function groupsHtml(ws, h) {
    const e = h.esc;
    return ws.map(w => `<section class="lgroup">
        <button type="button" class="lgh" data-w="${e(w.key)}">
          ${w.gun && w.gun.img ? `<img src="${e(w.gun.img)}" alt="" loading="lazy">` : `<span class="lghimg"></span>`}
          <span class="lghn">${e(w.name)}</span><span class="lc">${e(w.cls)}</span>
          <span class="lghc">${w.builds.length} ${w.builds.length === 1 ? "build" : "builds"} &rarr;</span>
        </button>
        <div class="lbuilds">${ordered(w.builds).map(b => buildHtml(b, h)).join("")}</div>
      </section>`).join("");
  }

  // ---------- the weapon panel ----------
  function weaponHtml(w, h) {
    const e = h.esc, g = w.gun;
    // Newest first, and a dated build ahead of an undated one, because a date is the one thing
    // here that says a build is still current. Only some creators publish one, so the rest fall
    // back to their name and their own label for the build — an order, rather than an opinion.
    // (There was a "most imported" sort next to this once. That count came off the aggregator
    // sites, and those are gone, so it was sorting 477 builds by zero.)
    const builds = ordered(w.builds);
    // The stat block is the gun as the game ships it, with nothing bolted on. A bar on its own is
    // unreadable — 0 to 100 of what? — so the number is the figure and the bar is the shape of it,
    // and the caption says out loud that these are stock values, not this build's.
    return `<div class="lhead">
        ${g && g.img ? `<img class="lgun" src="${e(g.img)}" alt="" loading="lazy">` : ""}
        <div class="lwmeta">
          <div class="lname">${e(w.name)}</div>
          <div class="lsub">${e(w.cls)}${g && g.caliber ? " · " + e(g.caliber) : ""}${g && g.capacity ? " · " + e(g.capacity) + " rounds" : ""} · ${builds.length} ${builds.length === 1 ? "build" : "builds"}</div>
        </div>
        ${g && g.stats.length ? `<div class="lstatbox">
          <div class="lstaph" data-tip="The gun's own figures from the game's weapon table, out of 100. Attachments are not counted: no build on this page changes these bars.">Stock weapon · before attachments</div>
          <div class="lstats">${g.stats.map(([k, v]) => `<div class="ls">
            <div class="lsl"><span>${e(k)}</span><b>${Math.round(v)}</b></div>
            <i class="lbar"><u style="width:${Math.max(0, Math.min(100, v))}%"></u></i></div>`).join("")}</div>
        </div>` : ""}
      </div>
      <div class="lbuilds">${builds.map(b => buildHtml(b, h)).join("")}</div>`;
  }

  const NET = [
    [/twitch\.tv/, "Twitch"], [/youtube\.com|youtu\.be/, "YouTube"], [/x\.com|twitter\.com/, "X"],
    [/discord\./, "Discord"], [/kick\.com/, "Kick"], [/tiktok\.com/, "TikTok"], [/instagram\.com/, "Instagram"],
  ];
  const netName = (u) => { for (const [re, n] of NET) if (re.test(u)) return n; return "Link"; };

  // How old a build is matters more here than anywhere else on the board: attachments get rebalanced
  // between seasons, so a code from two seasons ago may not be the build its maker would post today.
  const MONTH = 30.44 * 864e5;
  // Spelled out here rather than left to toLocaleDateString, which renders the same date as
  // "14 Sept", "Sep 14" or "14/09" depending on where the browser thinks it is.
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const shortDate = (iso) => {
    const d = new Date(iso + "T00:00:00Z");
    return isNaN(d) ? iso : d.getUTCDate() + " " + MON[d.getUTCMonth()];
  };
  function age(iso) {
    if (!iso) return null;
    const m = (Date.now() - new Date(iso + "T00:00:00Z")) / MONTH;
    if (!isFinite(m)) return null;
    const t = m < 1 ? "this month" : m < 2 ? "last month" : m < 12 ? Math.round(m) + " months old"
      : m < 24 ? "over a year old" : Math.floor(m / 12) + " years old";
    return { text: t, stale: m >= 9 };
  }

  // Every card is the same four rows in the same order — who made it, what it is, the code, where
  // it came from — whatever the source happened to carry. The pages publish wildly different
  // amounts of detail, and letting each card show whatever it had turned the grid into a jumble.
  // What one page has and another does not is left out rather than shown on a third of the cards.
  //
  // The face beside the name is the creator's own channel picture, stored on this site. It is the
  // credit doing its job: at a glance you know whose build this is, which is the difference
  // between a list of codes and a list of people's work.
  function buildHtml(b, h) {
    const e = h.esc, c = creatorOf(b), s = sourceOf(b), multimode = modes().length > 1;
    const links = (c.links || []).slice(0, 2);
    const a = age(b.added);
    const note = b.note && b.note.length > 72 ? b.note.slice(0, 69).replace(/\s+\S*$/, "") + "…" : b.note;
    const meta = [
      note ? `<b>${e(note)}</b>` : "",
      ...(b.tags || []).map(t => e(t)),
      a ? `<i class="lage ${a.stale ? "old" : ""}" data-tip="Published ${e(b.added)}">${e(a.text)}</i>` : "",
    ].filter(Boolean);
    return `<article class="lbuild">
      <div class="lbh">
        ${c.avatar ? `<img class="lav" src="${e(c.avatar)}" alt="" loading="lazy" width="30" height="30">`
          : `<span class="lav none" aria-hidden="true">${e((c.name || "?").trim().charAt(0).toUpperCase())}</span>`}
        <div class="lby">${PIN === b.creator ? e(c.name) : `<a href="${e(homeOf(b.creator))}">${e(c.name)}</a>`}</div>
        ${multimode ? `<span class="lmode ${e(b.mode)}">${e(MODES[b.mode] || b.mode)}</span>` : ""}
      </div>
      <div class="lmeta">${meta.join('<span class="ldot">·</span>')}</div>
      <div class="lcode">
        <code data-tip="${e(b.code)}">${e(b.code)}</code>
        <button type="button" class="lcopy" data-code="${e(b.code)}">Copy</button>
      </div>
      <div class="lfoot">
        <span class="lnets">${links.length
          ? links.map(u => `<a class="lnet" href="${e(u)}" target="_blank" rel="noopener noreferrer">${e(netName(u))}</a>`).join("")
          : `<span class="lnone">no channels listed</span>`}</span>
        <a class="lsrclink" href="${e(b.url || s.url)}" target="_blank" rel="noopener noreferrer">${e(s.name)} &rarr;</a>
      </div>
    </article>`;
  }

  // Clipboard, and a fallback for the browsers and contexts that refuse it: the whole point of the
  // card is that the code ends up in the game, so a copy button that silently fails is the one
  // failure this page cannot have.
  const copy = (btn) => copyText(btn, btn.dataset.code);
  function copyText(btn, code) {
    const done = () => flash(btn, "Copied", "ok");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, () => legacy(btn, code, done));
    } else legacy(btn, code, done);
  }
  function legacy(btn, code, done) {
    const t = document.createElement("textarea");
    t.value = code; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:-1000px";
    document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (e) { /* denied */ }
    document.body.removeChild(t);
    if (ok) return done();
    // Both routes refused — some browsers only allow the clipboard on a trusted gesture, and an
    // embedded view may refuse it outright. Select the code instead, so the keyboard still works.
    const el = btn.parentNode.querySelector("code");
    // The page link has no code element beside it; the address bar is the same text.
    if (!el) { flash(btn, "Copy the address"); return; }
    if (window.getSelection) {
      const r = document.createRange(); r.selectNodeContents(el);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
    flash(btn, /Mac|iPhone|iPad/.test(navigator.platform) ? "\u2318C to copy" : "Ctrl+C to copy");
  }
  function flash(btn, text, cls) {
    const was = btn.textContent;
    btn.textContent = text; if (cls) btn.classList.add(cls);
    setTimeout(() => { btn.textContent = was === text ? "Copy" : was; if (cls) btn.classList.remove(cls); }, 2200);
  }

  // ---------- styles ----------
  const style = document.createElement("style");
  style.textContent = `
  .lo { display: grid; grid-template-columns: 288px 1fr; align-items: start; }
  .lo-rail { padding: 22px 20px 26px; border-right: 1px solid var(--hair); position: sticky; top: 0; min-width: 0; }
  .lsearch input, .lpick select { width: 100%; background: var(--hair-2); border: 1px solid var(--hair); color: var(--text);
                   font: 400 13px var(--body); padding: 9px 10px; border-radius: 0; }
  .lsearch input:focus, .lpick select:focus { outline: 0; border-color: var(--tick); }
  .lpick { position: relative; margin-top: 12px; }
  .lpick select { appearance: none; -webkit-appearance: none; padding-right: 26px; cursor: pointer;
                  text-overflow: ellipsis; }
  .lpick::after { content: "▾"; position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
                  color: var(--muted); pointer-events: none; font-size: 12px; }
  .lfilters { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 12px; }
  .lpill { border: 0; background: var(--hair-2); color: var(--text-2); cursor: pointer;
           font: 600 11px var(--hud); letter-spacing: 1px; text-transform: uppercase; padding: 6px 10px; }
  .lpill:hover { color: var(--text); }
  .lpill.on { background: var(--green); color: var(--on-green); }

  .lwlist { margin-top: 16px; max-height: 620px; overflow-y: auto; overflow-x: hidden; }
  /* The board's own scrollbar, not the browser's: square, always visible, so the list reads as a
     list that continues rather than one that has ended. Same rule as the red-drop rail. */
  .lwlist::-webkit-scrollbar { width: 10px; }
  .lwlist::-webkit-scrollbar-track { background: var(--track); border-left: 1px solid var(--hair); }
  .lwlist::-webkit-scrollbar-thumb { background: var(--tick); }
  .lwlist::-webkit-scrollbar-thumb:hover { background: var(--fail); }
  @supports not selector(::-webkit-scrollbar) {
    .lwlist { scrollbar-width: thin; scrollbar-color: var(--tick) var(--track); }
  }
  .lw { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px; width: 100%;
        border: 0; border-bottom: 1px solid var(--hair-2); background: none; cursor: pointer; padding: 9px 4px; text-align: left; }
  .lw:hover { background: var(--hair-2); }
  .lw.on { background: var(--hair-2); box-shadow: inset 2px 0 0 var(--green); }
  .lw .ln { font: 600 14px var(--body); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lw .lc { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
  .lw .lb { font: 700 12px var(--hud); color: var(--green); min-width: 18px; text-align: right; }
  .lw.on .ln { color: var(--green); }

  .lo-main { padding: 22px 32px 28px; min-width: 0; }
  .lw.lwall { border-bottom-color: var(--hair); }
  .lw.lwall .ln { font-weight: 700; }
  .lchead { grid-template-columns: auto minmax(0, 1fr); }
  .lcav { width: 84px; height: 84px; border-radius: 50%; object-fit: cover; background: var(--hair-2); border: 1px solid var(--hair); display: block; }
  .lcav.none { display: grid; place-items: center; font: 700 34px var(--hud); color: var(--text-2); }
  .lclinks { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin-top: 10px; }
  .lclinks .lsrc { font: 600 11px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--green); }
  .lclinks .lpage { font: 700 11px var(--hud); letter-spacing: 1.2px; text-transform: uppercase; padding: 6px 11px;
                    background: var(--green); color: var(--on-green); }
  .lclinks .lpage:hover { color: var(--on-green); filter: brightness(1.1); }
  .lcava { display: block; border-radius: 50%; }
  .lcava:hover .lcav { box-shadow: 0 0 0 2px var(--green); }
  .lclinks .lnet { margin-right: 0; }
  .lgroup { margin-top: 26px; }
  .lo-main > .lgroup:first-child { margin-top: 0; }
  .lgh { display: grid; grid-template-columns: 92px auto auto 1fr; align-items: center; gap: 14px; width: 100%; background: none; border: 0;
         border-bottom: 1px solid var(--hair); padding: 0 0 8px; cursor: pointer; text-align: left; color: var(--text); }
  .lgh img, .lgh .lghimg { width: 92px; height: 34px; object-fit: contain; }
  .lghn { font: 700 22px/1 var(--hud); letter-spacing: 1px; text-transform: uppercase; }
  .lgh .lc { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
  .lghc { justify-self: end; font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--text-2); white-space: nowrap; }
  .lgh:hover .lghn, .lgh:hover .lghc { color: var(--green); }
  .lgroup .lbuilds { margin-top: 12px; }
  .lhead { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 22px; align-items: center;
           border-bottom: 1px solid var(--hair); padding-bottom: 18px; }
  .lgun { width: 190px; max-width: 34vw; height: auto; }
  .lwmeta { min-width: 0; }
  /* The weapon is what the whole panel is about — it reads as the headline of everything
     under it, not as a caption on the picture. */
  .lname { font: 700 44px/1 var(--hud); letter-spacing: 1.5px; text-transform: uppercase; overflow-wrap: anywhere; }
  .lsub { font: 600 12px var(--hud); letter-spacing: 1.4px; text-transform: uppercase; color: var(--muted); margin-top: 9px; }
  .lstaph { font: 600 10px var(--hud); letter-spacing: 1.2px; text-transform: uppercase; color: var(--muted);
            margin-bottom: 8px; border-bottom: 1px solid var(--hair); padding-bottom: 6px; }
  .lstats { display: grid; grid-template-columns: repeat(2, 128px); gap: 10px 18px; }
  .lsl { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
  .lsl span { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--muted);
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lsl b { font: 700 13px var(--hud); color: var(--text); }
  .lbar { display: block; height: 5px; background: var(--hair-2); }
  .lbar u { display: block; height: 100%; background: var(--green); }

  /* One shape, repeated. Four rows: who, what, the code, where it came from. */
  .lbuilds { display: grid; grid-template-columns: repeat(auto-fill, minmax(312px, 1fr)); gap: 12px; margin-top: 18px; }
  .lbuild { border: 1px solid var(--hair); border-left: 2px solid var(--tick); padding: 13px 15px; background: var(--panel);
            min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; }
  .lbuild:hover { border-left-color: var(--green); }
  .lbh { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 9px; }
  .lav { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; background: var(--hair-2);
         border: 1px solid var(--hair); display: block; }
  .lav.none { display: grid; place-items: center; font: 700 13px var(--hud); color: var(--text-2); }
  .lby { font: 600 14px var(--body); color: var(--text); min-width: 0; overflow-wrap: anywhere; }
  .lby a { color: var(--text); border-bottom: 1px solid var(--tick); }
  .lby a:hover { color: var(--green); border-bottom-color: var(--green); }
  .lname a { color: var(--text); text-decoration: none; }
  .lname a:hover { color: var(--green); }
  /* live: a red ring on the face and a dot on the channel that is on air */
  .llive { display: inline-flex; align-items: center; gap: 5px; font: 700 10px var(--hud); letter-spacing: 1.2px; text-transform: uppercase;
           color: #fff; background: var(--red, #e0463f); padding: 2px 6px 2px 5px; white-space: nowrap; }
  .llive::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #fff; }
  a.lchon::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--red, #e0463f);
                    margin-right: 6px; vertical-align: 1px; }
  .lchead .lclinks a.lchon { color: var(--text); }
  .onair .lcav { box-shadow: 0 0 0 2px var(--red, #e0463f); }
  .lchead .lname a::after { content: " →"; font-size: .55em; color: var(--muted); vertical-align: middle; }
  .lchead .lname a:hover::after { color: var(--green); }
  .lall { display: block; margin-top: 12px; background: var(--hair-2); border: 1px solid var(--hair); color: var(--text-2);
         font: 600 13px var(--body); text-decoration: none; padding: 8px 10px; }
  .lall:hover { color: var(--green); border-color: var(--tick); }
  .lmode { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; padding: 3px 7px;
           white-space: nowrap; background: rgba(29, 224, 140, .14); color: var(--green); }
  .lmode.warfare { background: rgba(230, 179, 74, .14); color: var(--amber); }
  .lmode.both { background: var(--hair-2); color: var(--text-2); }
  /* Everything the card knows beyond the code, on one line, clamped to two so a long description
     on one source cannot push the code button out of line with the card beside it. */
  .lmeta { font-size: 12px; line-height: 1.6; color: var(--muted); margin-top: 7px; min-height: 38px;
           display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  .lmeta b { color: var(--text-2); font-weight: 600; }
  .ldot { margin: 0 5px; color: var(--tick); }
  .lage { font-style: normal; }
  .lage.old { color: var(--amber); }
  .lcode { display: flex; align-items: stretch; gap: 8px; margin-top: 10px; min-width: 0; }
  /* One line, always. The code is long enough to wrap on any card width, and a code that wraps
     turns the row of cards into a staircase — so it is clipped here and copied whole by the
     button beside it. Hovering shows all of it. */
  .lcode code { flex: 1; min-width: 0; background: var(--hair-2); border: 1px solid var(--hair); padding: 8px 10px;
                font: 600 12px var(--hud); letter-spacing: .4px; line-height: 20px; color: var(--text);
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: help; }
  .lcopy { border: 0; background: var(--green); color: var(--on-green); cursor: pointer; padding: 0 15px;
           font: 700 11px var(--hud); letter-spacing: 1.4px; text-transform: uppercase; white-space: nowrap; align-self: stretch; }
  .lcopy:hover { background: #6ff0b8; }
  .lcopy.ok { background: var(--tick); color: var(--text); }
  .lfoot { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 10px; margin-top: 9px; }
  .lnets { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lnet { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--muted);
          margin-right: 9px; border-bottom: 1px solid var(--tick); white-space: nowrap; }
  .lnet:last-child { margin-right: 0; }
  .lnet:hover { color: var(--green); border-bottom-color: var(--green); }
  .lnone { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--tick); }
  .lsrclink { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--text-2);
              white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
  .lsrclink:hover { color: var(--green); }

  @media (max-width: 1100px) {
    .lo { grid-template-columns: 1fr; }
    .lo-rail { position: static; border-right: 0; border-bottom: 1px solid var(--hair); padding: 18px 20px; }
    .lwlist { max-height: 260px; }
    .lo-main { padding: 20px; }
    .lhead { grid-template-columns: 1fr; gap: 14px; }
    .lchead { grid-template-columns: auto minmax(0, 1fr); }
    .lcav { width: 64px; height: 64px; }
    .lgh { grid-template-columns: 64px minmax(0, 1fr) auto; gap: 10px; }
    .lgh img, .lgh .lghimg { width: 64px; height: 26px; }
    .lgh .lc { display: none; }
    .lghn { font-size: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lgun { width: 150px; max-width: 60vw; }
    .lname { font-size: 34px; }
    .lstats { grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); }
    .lbuilds { grid-template-columns: 1fr; }
  }
`;
  document.head.appendChild(style);
})();
