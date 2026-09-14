/* Loadouts — community weapon builds, per weapon, credited to whoever made them.
 *
 * Nothing here comes from HQ. HQ knows what you own and what you did with it; it does not know
 * what the people who play this game for a living put on their rifles. That lives on their own
 * pages — a Google Doc, a build site of their own — and, second-hand, on the aggregators that
 * collect them. So this tab is a curated file (data/loadouts.json) rather than an API call, every
 * build in it carries the name of the person who made it and a link back to where it was
 * published, and a build read off its maker's own page says so and sorts first.
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

  let DB = null, state = { sel: null, mode: "all", cls: "all", creator: "all", src: "all", sort: "pop", q: "" }, phase = "idle";

  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { /* private window */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  // ---------- the official weapon table ----------
  // Names, classes, images and the stat bars come from playdeltaforce.com's own manifest, exactly
  // as the map names and the card names do. A build file that named a weapon the game does not
  // have would otherwise be invisible; matching against the manifest is what catches that.
  // The manifest's own category names are the in-game abbreviations ("SR", "MR"); spelled out here
  // because these are filter buttons, not a stat sheet.
  const CLASS = { "1": "Rifle", "2": "SMG", "3": "Sniper", "4": "LMG", "5": "Marksman", "6": "Pistol", "7": "Shotgun", "8": "Special" };
  const TAIL = /\s+(Assault Rifle|Compact Assault Rifle|Submachine Gun|Sniper Rifle|Marksman Rifle|Battle Rifle|General Machine Gun|Light Machine Gun|Machine Gun|Shotgun|Pistol|Revolver|Carbine|Crossbow|Bow)\s*$/i;
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
  // Where a build was found matters as much as who made it. A build sitting on the page its maker
  // runs is a build they still stand behind; a build on an aggregator is a copy someone took.
  const own = (b) => sourceOf(b).kind === "creator";

  // Everything the rail and the pane read goes through one filter, so the counts on the weapon
  // list are the counts of what clicking it would actually show.
  function visible() {
    const q = norm(state.q);
    return DB.builds.filter(b =>
      (state.mode === "all" || b.mode === state.mode || b.mode === "both") &&
      (state.creator === "all" || b.creator === state.creator) &&
      (state.src === "all" || (state.src === "own") === own(b)) &&
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
    // Nothing on this page is a match, so neither the mode nor the range picker applies: the mode
    // here is the mode a build is *for*, which is a filter of its own inside the pane.
    filters: false,

    hero(data, h) {
      if (phase !== "ready" || !DB) return null;
      const all = DB.builds, list = visible(), e = h.esc;
      const creators = new Set(all.map(b => b.creator));
      const cover = new Set(all.filter(b => b.gun).map(b => b.gun.key));
      const ops = all.filter(b => b.mode === "operations" || b.mode === "both").length;
      const war = all.filter(b => b.mode === "warfare" || b.mode === "both").length;
      const shown = list.length !== all.length;
      return {
        eyebrow: "Loadouts · community builds",
        big: String(shown ? list.length : all.length),
        sub: shown ? "builds matching the filter" : (all.length === 1 ? "build tracked" : "builds tracked"),
        cells: [
          ["Weapons covered", `${cover.size}<span style="color:var(--muted)">/${GUNS.length || "?"}</span>`,
            GUNS.length ? "of every gun in the game" : null],
          ["Creators", String(creators.size), "credited on every build"],
          ["From own pages", String(all.filter(own).length), "the rest are from aggregators",
            "A build taken from the page its maker publishes — their doc, their site — rather than from a site that collects other people's builds. Both are credited, but the creator's own page is the one they keep up to date."],
          ["Operations", String(ops), null],
          ["Warfare", String(war), null],
          ["Under 9 months old", String(all.filter(b => { const a = age(b.added); return a && !a.stale; }).length),
            "the rest are marked on the card"],
          ["Gathered", DB.updated ? e(shortDate(DB.updated)) : "–", "builds go stale — check the source",
            "These builds were copied from public pages on this date. Nothing here is checked against the game: a code can be from an older season, a different server region, or simply not to your taste. The link on each card is the original."],
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
          <div class="lfilters">
            ${pill(state.mode === "all", "all", "All modes", "mode")}
            ${pill(state.mode === "operations", "operations", "Operations", "mode")}
            ${pill(state.mode === "warfare", "warfare", "Warfare", "mode")}
          </div>
          <div class="lfilters">
            ${pill(state.src === "all", "all", "Everywhere", "src")}
            ${pill(state.src === "own", "own", "Own pages", "src")}
            ${pill(state.src === "agg", "agg", "Aggregators", "src")}
          </div>
          <div class="lfilters">
            ${pill(state.cls === "all", "all", "All", "cls")}
            ${classes.map(c => pill(state.cls === c, c, e(c), "cls")).join("")}
          </div>
          <div class="lfilters lsort">
            <span>Sort</span>
            ${pill(state.sort === "pop", "pop", "Most imported", "sort")}
            ${pill(state.sort === "new", "new", "Newest", "sort")}
          </div>
          <div class="lwlist">
            ${ws.length ? ws.map(w => `<button type="button" class="lw ${sel && w.key === sel.key ? "on" : ""}" data-w="${e(w.key)}">
                <span class="ln">${e(w.name)}</span><span class="lc">${e(w.cls)}</span><span class="lb">${w.builds.length}</span>
              </button>`).join("")
              : `<div class="note">Nothing matches that. <button type="button" class="link" style="color:var(--green)" data-f="reset" data-v="1">Clear the filters</button></div>`}
          </div>
        </div>
        <div class="lo-main">${sel ? weaponHtml(sel, h) : ""}
          <div class="lcredits">
            <div class="mod-label">Credit <span class="note">every build here is someone else's work</span></div>
            <div class="lcrow">${creators.map(x => `<button type="button" class="lcc ${state.creator === x.k ? "on" : ""}" data-f="creator" data-v="${e(x.k)}">
                <span class="cn">${e(x.c.name)}</span><span class="cb">${x.n}</span></button>`).join("")}
              ${state.creator !== "all" ? `<button type="button" class="lcc clear" data-f="creator" data-v="all">Show everyone</button>` : ""}</div>
            <div class="lsrc">${(() => {
              const link = (k) => `<a href="${e(DB.sources[k].url)}" target="_blank" rel="noopener noreferrer">${e(DB.sources[k].name)}</a>`;
              const keys = Object.keys(DB.sources || {});
              const mine = keys.filter(k => DB.sources[k].kind === "creator"), rest = keys.filter(k => DB.sources[k].kind !== "creator");
              return (mine.length ? `Gathered from the pages the creators run themselves — ${mine.map(link).join(" · ")}${rest.length ? ` — and from ${rest.map(link).join(" · ")}` : ""}`
                : `Gathered from ${rest.map(link).join(" · ")}`) + (DB.updated ? " · " + e(DB.updated) : "");
            })()}. Codes are copied as published and are not verified here — open the source if a build looks wrong, and credit the maker if it wins you a raid.</div>
          </div>
        </div>
      </div>`;

      const q = el.querySelector("#loQ");
      if (q) {
        q.oninput = () => { state.q = q.value; save(); h.repaint(); };
        if (state.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      }
      el.querySelectorAll("[data-w]").forEach(n => n.onclick = () => { state.sel = n.dataset.w; save(); h.repaint(); });
      el.querySelectorAll("[data-f]").forEach(n => n.onclick = () => {
        const f = n.dataset.f;
        if (f === "reset") { state = { sel: null, mode: "all", cls: "all", creator: "all", src: "all", sort: "pop", q: "" }; }
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
    // A build from the maker's own page first, then a person's build on an aggregator, then the
    // aggregator's own; inside each, the one most people have actually imported, then the newest —
    // a code that is a year old is not wrong, but it was tuned for a different game.
    const mine = (b) => own(b) ? 0 : (DB.creators[b.creator] || {}).kind === "site" ? 2 : 1;
    const date = (a, b) => String(b.added || "").localeCompare(String(a.added || ""));
    const pop = (a, b) => (b.popularity || 0) - (a.popularity || 0);
    const builds = w.builds.slice().sort((a, b) => state.sort === "new"
      ? (date(a, b) || mine(a) - mine(b) || pop(a, b))
      : (mine(a) - mine(b) || pop(a, b) || date(a, b)));
    return `<div class="lhead">
        ${g && g.img ? `<img class="lgun" src="${e(g.img)}" alt="" loading="lazy">` : ""}
        <div class="lmeta">
          <div class="lname">${e(w.name)}</div>
          <div class="lsub">${e(w.cls)}${g && g.caliber ? " · " + e(g.caliber) : ""}${g && g.capacity ? " · " + e(g.capacity) + " rounds" : ""} · ${builds.length} ${builds.length === 1 ? "build" : "builds"}</div>
        </div>
        ${g && g.stats.length ? `<div class="lstats">${g.stats.map(([k, v]) =>
          `<div class="ls"><i class="lbar"><u style="width:${Math.max(0, Math.min(100, v))}%"></u></i><span>${e(k)}</span></div>`).join("")}</div>` : ""}
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

  function buildHtml(b, h) {
    const e = h.esc, c = creatorOf(b), s = sourceOf(b);
    const links = (c.links || []).slice(0, 4);
    // The code is the payload; everything else on the card is there to tell you whether to paste it.
    return `<article class="lbuild">
      <div class="lbh">
        <div class="lby">${c.url ? `<a href="${e(c.url)}" target="_blank" rel="noopener noreferrer">${e(c.name)}</a>` : e(c.name)}
          ${own(b) ? `<span class="lkind own" data-tip="Taken from ${e(s.name)} — the page ${e(c.name)} publishes, not a site that collects other people's builds">their own page</span>`
            : c.kind === "site" ? `<span class="lkind">house build</span>` : ""}
          ${links.map(u => `<a class="lnet" href="${e(u)}" target="_blank" rel="noopener noreferrer">${e(netName(u))}</a>`).join("")}</div>
        <div class="ltags"><span class="lmode ${e(b.mode)}">${e(MODES[b.mode] || b.mode)}</span>
          ${(b.tags || []).map(t => `<span class="ltag">${e(t)}</span>`).join("")}</div>
      </div>
      ${b.note ? `<div class="lnote">${e(b.note)}</div>` : ""}
      <div class="lcode">
        <code>${e(b.code)}</code>
        <button type="button" class="lcopy" data-code="${e(b.code)}">Copy</button>
      </div>
      <div class="lhow">Gun Customization Station &rarr; Preset &rarr; Import${b.level ? ` · needs weapon level ${e(b.level)}` : ""}</div>
      ${(b.att || []).length ? `<div class="latt">${b.att.map(([slot, name]) =>
        `<div class="la"><span class="las">${e(slot)}</span><span class="lan">${e(name)}</span></div>`).join("")}</div>` : ""}
      <div class="lfoot">
        <span>${(() => { const a = age(b.added); return a ? `<i class="lage ${a.stale ? "old" : ""}" data-tip="Published ${e(b.added)}">${e(a.text)}</i>` : ""; })()}${b.popularity ? (b.added ? " · " : "") + Number(b.popularity).toLocaleString("en-US") + " imports" : ""}</span>
        <a href="${e(b.url || s.url)}" target="_blank" rel="noopener noreferrer">${e(s.name)} &rarr;</a>
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
  .lo-rail { padding: 22px 20px 26px; border-right: 1px solid var(--hair); position: sticky; top: 0; }
  .lsearch input { width: 100%; background: var(--hair-2); border: 1px solid var(--hair); color: var(--text);
                   font: 400 13px var(--body); padding: 9px 10px; border-radius: 0; }
  .lsearch input:focus { outline: 0; border-color: var(--tick); }
  .lfilters { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 12px; }
  .lpill { border: 0; background: var(--hair-2); color: var(--text-2); cursor: pointer;
           font: 600 11px var(--hud); letter-spacing: 1px; text-transform: uppercase; padding: 6px 10px; }
  .lpill:hover { color: var(--text); }
  .lpill.on { background: var(--green); color: var(--on-green); }
  .lwlist { margin-top: 16px; max-height: 620px; overflow: auto; }
  .lw { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px; width: 100%;
        border: 0; border-bottom: 1px solid var(--hair-2); background: none; cursor: pointer; padding: 9px 4px; text-align: left; }
  .lw:hover { background: var(--hair-2); }
  .lw.on { background: var(--hair-2); box-shadow: inset 2px 0 0 var(--green); }
  .lw .ln { font: 600 14px var(--body); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lw .lc { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
  .lw .lb { font: 700 12px var(--hud); color: var(--green); min-width: 18px; text-align: right; }
  .lw.on .ln { color: var(--green); }

  .lo-main { padding: 22px 32px 28px; min-width: 0; }
  .lhead { display: grid; grid-template-columns: auto 1fr auto; gap: 22px; align-items: center;
           border-bottom: 1px solid var(--hair); padding-bottom: 18px; }
  .lgun { width: 190px; max-width: 34vw; height: auto; }
  .lname { font: 700 28px var(--hud); letter-spacing: 1px; text-transform: uppercase; }
  .lsub { font: 600 12px var(--hud); letter-spacing: 1.4px; text-transform: uppercase; color: var(--muted); margin-top: 6px; }
  .lstats { display: grid; grid-template-columns: repeat(2, 132px); gap: 8px 18px; }
  .lbar { display: block; height: 6px; background: var(--fail); }
  .lbar u { display: block; height: 100%; background: var(--green); }
  .lstats .ls span { display: block; font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--muted); margin-top: 4px; }

  .lbuilds { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; margin-top: 18px; }
  .lbuild { border: 1px solid var(--hair); border-left: 2px solid var(--tick); padding: 14px 16px; background: var(--panel); }
  .lbh { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .lby { font: 600 14px var(--body); color: var(--text); }
  .lby a { color: var(--text); border-bottom: 1px solid var(--tick); }
  .lby a:hover { color: var(--green); border-bottom-color: var(--green); }
  .lkind { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--muted); margin-left: 8px; }
  .lkind.own { color: var(--green); }
  .ltags { display: flex; gap: 5px; flex-wrap: wrap; }
  .lmode, .ltag { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; padding: 3px 7px; }
  .lmode { background: rgba(29, 224, 140, .14); color: var(--green); }
  .lmode.warfare { background: rgba(230, 179, 74, .14); color: var(--amber); }
  .lmode.both { background: var(--hair-2); color: var(--text-2); }
  .ltag { background: var(--hair-2); color: var(--text-2); }
  .lnote { color: var(--text-2); font-size: 13px; margin-top: 9px; }
  .lnet { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--muted);
          margin-left: 8px; border-bottom: 1px solid var(--tick); }
  .lnet:hover { color: var(--green); border-bottom-color: var(--green); }
  .lhow { font: 600 10px var(--hud); letter-spacing: 1.2px; text-transform: uppercase; color: var(--muted); margin-top: 7px; }
  .latt { margin-top: 11px; border-top: 1px solid var(--hair); padding-top: 9px; display: grid; gap: 4px; }
  .la { display: flex; gap: 10px; justify-content: space-between; font-size: 12px; }
  .las { color: var(--muted); font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; padding-top: 2px; white-space: nowrap; }
  .lan { color: var(--text-2); text-align: right; }
  .lcode { display: flex; align-items: stretch; gap: 8px; margin-top: 12px; }
  .lcode code { flex: 1; min-width: 0; background: var(--hair-2); border: 1px solid var(--hair); padding: 9px 10px;
                font: 600 13px var(--hud); letter-spacing: 1px; color: var(--text); overflow-wrap: anywhere; }
  .lcopy { border: 0; background: var(--green); color: var(--on-green); cursor: pointer; padding: 0 16px;
           font: 700 11px var(--hud); letter-spacing: 1.4px; text-transform: uppercase; white-space: nowrap; }
  .lcopy:hover { background: #6ff0b8; }
  .lcopy.ok { background: var(--tick); color: var(--text); }
  .lfoot { display: flex; justify-content: space-between; gap: 12px; margin-top: 10px;
           font: 600 11px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
  .lfoot a { color: var(--text-2); } .lfoot a:hover { color: var(--green); }
  .lage { font-style: normal; }
  .lage.old { color: var(--amber); }
  .lsort { align-items: center; }
  .lsort > span { font: 600 10px var(--hud); letter-spacing: 1.2px; text-transform: uppercase; color: var(--muted); margin-right: 2px; }

  .lcredits { margin-top: 26px; border-top: 1px solid var(--hair); padding-top: 18px; }
  .lcrow { display: flex; flex-wrap: wrap; gap: 6px; }
  .lcc { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--hair); background: none;
         color: var(--text-2); cursor: pointer; padding: 6px 10px; font: 600 12px var(--body); }
  .lcc:hover { color: var(--text); border-color: var(--tick); }
  .lcc.on { border-color: var(--green); color: var(--green); }
  .lcc .cb { font: 700 11px var(--hud); color: var(--muted); }
  .lcc.on .cb { color: var(--green); }
  .lcc.clear { color: var(--muted); }
  .lsrc { color: var(--muted); font-size: 12px; line-height: 1.5; margin-top: 12px; max-width: 900px; }

  @media (max-width: 1100px) {
    .lo { grid-template-columns: 1fr; }
    .lo-rail { position: static; border-right: 0; border-bottom: 1px solid var(--hair); padding: 18px 20px; }
    .lwlist { max-height: 260px; }
    .lo-main { padding: 20px; }
    .lhead { grid-template-columns: 1fr; gap: 14px; }
    .lgun { width: 150px; max-width: 60vw; }
    .lstats { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
    .lbuilds { grid-template-columns: 1fr; }
  }`;
  document.head.appendChild(style);
})();
