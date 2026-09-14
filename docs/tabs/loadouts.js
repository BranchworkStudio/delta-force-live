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
 * A tab module like any other (see README, "Tabs and event modules"): it registers itself in
 * window.DF_TABS and the board knows nothing about it. It asks the board for no data at all —
 * its queries() is absent — and loads its own file the first time it is painted.
 */
(function () {
  const DATA_URL = "data/loadouts.json?v=1";
  const KEY = "df-loadouts";          // the rail's own state, per browser

  let DB = null, state = { sel: null, mode: "all", cls: "all", creator: "all", q: "" }, phase = "idle";

  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { /* private window */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

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
    if (phase !== "idle") return;
    phase = "loading";
    fetch(DATA_URL, { cache: "no-cache" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
      .then(d => {
        DB = d;
        DB.builds = (d.builds || []).map(b => Object.assign({}, b, { gun: gunOf(b.weapon) }));
        phase = "ready";
        h.repaint();
      })
      .catch(() => { phase = "failed"; h.repaint(); });
  }

  const creatorOf = (b) => (DB.creators && DB.creators[b.creator]) || { name: b.creator || "Unknown" };
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
      const all = DB.builds, list = visible(), e = h.esc;
      const cover = new Set(all.filter(b => b.gun).map(b => b.gun.key));
      const shown = list.length !== all.length;
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
      const sel = ws.find(w => w.key === state.sel) || ws[0] || null;
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
          <div class="lsearch lpick"><select id="loCreator" aria-label="Creator">
            <option value="all">Every creator (${creators.length})</option>
            ${creators.map(x => `<option value="${e(x.k)}"${state.creator === x.k ? " selected" : ""}>${e(x.c.name)} (${x.n})</option>`).join("")}
          </select></div>
          <div class="lwlist">
            ${ws.length ? ws.map(w => `<button type="button" class="lw ${sel && w.key === sel.key ? "on" : ""}" data-w="${e(w.key)}">
                <span class="ln">${e(w.name)}</span><span class="lc">${e(w.cls)}</span><span class="lb">${w.builds.length}</span>
              </button>`).join("")
              : `<div class="note">Nothing matches that. <button type="button" class="link" style="color:var(--green)" data-f="reset" data-v="1">Clear the filters</button></div>`}
          </div>
        </div>
        <div class="lo-main">${sel ? weaponHtml(sel, h) : ""}</div>
      </div>`;

      const q = el.querySelector("#loQ");
      if (q) {
        q.oninput = () => { state.q = q.value; save(); h.repaint(); };
        if (state.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      }
      const who = el.querySelector("#loCreator");
      if (who) who.onchange = () => { state.creator = who.value; save(); h.repaint(); };
      el.querySelectorAll("[data-w]").forEach(n => n.onclick = () => { state.sel = n.dataset.w; save(); h.repaint(); });
      el.querySelectorAll("[data-f]").forEach(n => n.onclick = () => {
        const f = n.dataset.f;
        if (f === "reset") { state = { sel: null, mode: "all", cls: "all", creator: "all", q: "" }; }
        else if (f === "creator") { state.creator = state.creator === n.dataset.v ? "all" : n.dataset.v; }
        else { state[f] = n.dataset.v; }
        save(); h.repaint();
      });
      el.querySelectorAll("[data-code]").forEach(n => n.onclick = () => copy(n));
      h.attachTips(el);
    },
  });

  // ---------- the weapon panel ----------
  function weaponHtml(w, h) {
    const e = h.esc, g = w.gun;
    // Newest first, and a dated build ahead of an undated one, because a date is the one thing
    // here that says a build is still current. Only some creators publish one, so the rest fall
    // back to their name and their own label for the build — an order, rather than an opinion.
    // (There was a "most imported" sort next to this once. That count came off the aggregator
    // sites, and those are gone, so it was sorting 477 builds by zero.)
    const builds = w.builds.slice().sort((a, b) =>
      String(b.added || "").localeCompare(String(a.added || "")) ||
      creatorOf(a).name.localeCompare(creatorOf(b).name) ||
      season(b) - season(a) || (a.pos || 0) - (b.pos || 0));
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
        <div class="lby">${c.url ? `<a href="${e(c.url)}" target="_blank" rel="noopener noreferrer">${e(c.name)}</a>` : e(c.name)}</div>
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
  function copy(btn) {
    const code = btn.dataset.code;
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
    if (el && window.getSelection) {
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
    .lgun { width: 150px; max-width: 60vw; }
    .lname { font-size: 34px; }
    .lstats { grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); }
    .lbuilds { grid-template-columns: 1fr; }
  }
`;
  document.head.appendChild(style);
})();
