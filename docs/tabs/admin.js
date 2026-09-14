/* Admin — the tracker itself, for the one account that runs it.
 *
 * Every other tab is about playing the game. This one is about the thing the game is being
 * recorded on: who has been let in, which ways in are still open, whether anybody's collection
 * has quietly stopped, and whether the job that reads the creators' pages ran this morning.
 *
 * All four of those questions were answerable before — with psql and the snippets in the README —
 * which in practice meant they were asked only after something had already gone wrong. A page
 * that refreshes with the board asks them every thirty seconds instead.
 *
 * The tab is drawn only for an admin (`visible`), and that is presentation and nothing else. The
 * three views it reads carry `where public.is_admin()` in the database (migration 0026), so a
 * browser that flips the localStorage hint by hand gets this page with three empty tables. Hiding
 * a button is not a boundary; the boundary is in Postgres, where it can be relied on.
 *
 * `scope: "all"` is the one unusual thing in the registration. Every module's rows are normally
 * narrowed to the players on the board you are looking at, which is right for a page about
 * matches and exactly wrong for a page about everybody — a solo player you share no board with is
 * precisely the row an admin needs to see.
 */
(function () {
  const META_URL = "data/loadouts-meta.json";
  const LOADOUTS_URL = "data/loadouts.json";

  // The pipeline's own two files, read once per page load. They are static files on this site
  // rather than anything in the database, so they are fetched here instead of asked for in
  // queries(); a missing one costs this section and nothing else on the page.
  let pipe = null, pipePhase = "idle";
  function ensurePipe(h) {
    if (pipePhase !== "idle") return;
    pipePhase = "loading";
    Promise.all([
      fetch(META_URL, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(LOADOUTS_URL, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([meta, file]) => {
      pipe = {
        meta, updated: file && file.updated, builds: file && (file.builds || []).length,
        names: Object.fromEntries(Object.entries((file && file.creators) || {}).map(([k, c]) => [k, c.name || k])),
      };
      pipePhase = "ready";
      h.repaint();
    });
  }

  // What the mint row is set to. Not remembered between visits on purpose: a cap is a decision
  // about the person you are about to send a link to, and the safe answer is the one you have to
  // change deliberately.
  let cap = 1, made = null, busy = null, armed = null;

  const shortCode = (c) => String(c || "").slice(0, 8) + "…";
  const dateOf = (iso) => iso ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" }) : "–";

  function copy(text) {
    if (navigator.clipboard) return navigator.clipboard.writeText(text).catch(() => fallback(text));
    return fallback(text);
  }
  function fallback(text) {
    const t = document.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:-1000px";
    document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); } catch (e) { /* nothing else to try */ }
    t.remove();
  }

  // ---------- the four sections ----------

  /* Ways in. The table is every invite ever made, newest first, because a revoked one is part of
     the answer to "how did these people get here" — and the whole point of a row per link is
     being able to close one without closing the rest. */
  function waysIn(invites, h) {
    const e = h.esc;
    const row = (i) => {
      const state = i.revoked ? ["revoked", "off"] : i.spent ? ["used up", "off"] : ["open", "on"];
      const used = i.max_uses == null ? `${i.uses} <span class="admu">/ ∞</span>` : `${i.uses} <span class="admu">/ ${i.max_uses}</span>`;
      const what = i.group_id ? `board · ${e(i.group_name || "?")}` : "tracker only";
      const dead = i.revoked || i.spent;
      return `<tr class="${dead ? "addead" : ""}">
        <td><button type="button" class="adcode" data-copy="${e(i.code)}" title="Copy the link">${e(shortCode(i.code))}</button></td>
        <td>${what}</td>
        <td class="num">${used}</td>
        <td><i class="addot ${state[1]}"></i>${state[0]}</td>
        <td>${i.last_used_at ? e(h.ago(i.last_used_at)) : "never used"}</td>
        <td>${e(dateOf(i.created_at))}${i.created_by_name ? ` <span class="admu">· ${e(i.created_by_name)}</span>` : ""}</td>
        <td class="adact">${dead ? "" : `
          <button type="button" data-cap="${e(i.code)}" data-to="${i.max_uses == null ? 1 : ""}">${i.max_uses == null ? "Cap at 1" : "Lift cap"}</button>
          <button type="button" class="adbad" data-revoke="${e(i.code)}">${armed === i.code ? "Sure?" : "Revoke"}</button>`}</td>
      </tr>`;
    };
    const open = invites.filter(i => !i.revoked && !i.spent).length;
    return `<section class="band">
      <div class="mod-label">Ways in <span class="note">${open} still open of ${invites.length}</span></div>
      ${invites.length ? `<div class="adscroll"><table class="adt">
        <thead><tr><th>Link</th><th>Opens</th><th>Used</th><th></th><th>Last used</th><th>Made</th><th></th></tr></thead>
        <tbody>${invites.map(row).join("")}</tbody></table></div>`
        : `<div class="note">No links have been made yet.</div>`}
      <div class="admint">
        <span class="adml">Good for</span>
        ${[[1, "one person"], [3, "three"], [null, "no limit"]].map(([v, l]) =>
          `<button type="button" class="adpill ${cap === v ? "on" : ""}" data-cap-set="${v === null ? "null" : v}">${l}</button>`).join("")}
        <span class="adspacer"></span>
        <button type="button" class="adgo" data-mint="solo">${busy === "solo" ? "Making a link…" : "Tracker link"}</button>
        ${h.group && h.group !== "solo" ? `<button type="button" class="adgo" data-mint="new">${busy === "new" ? "Making a link…" : "Board link"}</button>` : ""}
      </div>
      ${made ? `<div class="admade"><b>${made.error ? "That did not work" : made.kind === "new" ? "Board link — they join and land on it" : "Tracker link — their own stats, no board"}</b>
        ${made.error ? `<div class="note">${e(made.error)}</div>`
          : `<input readonly value="${e(made.url)}"><span class="note">${made.max_uses == null ? "No limit — everybody it reaches can open an account." : made.max_uses === 1 ? "Good for one account. It stops working the moment somebody joins on it." : `Good for ${made.max_uses} accounts.`}</span>`}</div>` : ""}
    </section>`;
  }

  /* People. Not a roster — the board above is the roster. This is the guest list: when each
     account arrived and what let it in, which is the only record of how somebody came to be on a
     backend one person pays for. */
  function people(players, h) {
    const e = h.esc;
    const via = (p) => p.enrolled_via === "first" ? "claimed this tracker"
      : p.enrolled_via ? `<button type="button" class="adcode" data-copy="${e(p.enrolled_via)}" title="Copy the code">${e(shortCode(p.enrolled_via))}</button>`
      : `<span class="admu">before there were invites</span>`;
    return `<section class="band">
      <div class="mod-label">People <span class="note">${players.length} ${players.length === 1 ? "account" : "accounts"}</span></div>
      <div class="adscroll"><table class="adt">
        <thead><tr><th>Player</th><th>Joined</th><th>Let in by</th><th>Boards</th></tr></thead>
        <tbody>${players.map(p => `<tr>
          <td><b>${e(p.nickname || p.openid.slice(0, 6))}</b>${p.level ? ` <span class="admu">lvl ${e(p.level)}</span>` : ""}${p.is_admin ? ` <span class="adtag">admin</span>` : ""}</td>
          <td>${e(dateOf(p.enrolled_at || p.created_at))}</td>
          <td>${via(p)}</td>
          <td>${p.boards ? e(p.boards) : `<span class="admu">none — solo</span>`}</td>
        </tr>`).join("")}</tbody></table></div>
    </section>`;
  }

  /* Is it collecting. The board's account chip has always shown one dot for your own account;
     this is the same question asked about everybody, with the error text that the dot leaves out.
     An HQ login dies on its own schedule and nobody is told — the person it belongs to finds out
     when their matches stop appearing, which can be days. */
  function collection(players, sessions, h) {
    const e = h.esc;
    const by = {};
    sessions.forEach(s => { by[s.openid] = s; });
    const rows = players.map(p => {
      const s = by[p.openid];
      const last = s && (s.last_ok_at || s.updated_at);
      const stale = last ? (Date.now() - new Date(last)) / 36e5 > 2 : true;
      const bad = !s ? "gone" : s.last_error ? "error" : stale ? "stale" : "ok";
      return { p, s, last, bad };
    });
    const ok = rows.filter(r => r.bad === "ok").length;
    return `<section class="band">
      <div class="mod-label">Collection <span class="note">${ok} of ${rows.length} polling cleanly</span></div>
      <div class="adscroll"><table class="adt">
        <thead><tr><th>Player</th><th>Last collected</th><th>This login has lasted</th><th>Handed over</th><th>What it says</th></tr></thead>
        <tbody>${rows.map(({ p, s, last, bad }) => `<tr>
          <td><i class="addot ${bad === "ok" ? "on" : bad === "stale" ? "warn" : "bad"}"></i><b>${e(p.nickname || p.openid.slice(0, 6))}</b></td>
          <td>${last ? e(h.ago(last)) : "never"}</td>
          <td>${p.token_seen_since ? e(h.ago(p.token_seen_since).replace(" ago", "")) : "–"}</td>
          <td>${s && s.connected_at ? e(dateOf(s.connected_at)) : "–"}</td>
          <td class="aderr">${!s ? "no session — this account has been disconnected"
            : s.last_error ? e(s.last_error) : `<span class="admu">nothing to report</span>`}</td>
        </tr>`).join("")}</tbody></table></div>
    </section>`;
  }

  /* The loadouts pipeline. A job that has silently stopped looks exactly like a job with nothing
     to do — both leave the file untouched — so what is worth showing is the run, not the file:
     when it last ran, whether it wrote, refused or found nothing to change, and what it threw
     away as unreadable on the way. */
  function pipeline(h) {
    const e = h.esc;
    if (pipePhase !== "ready") return `<section class="band"><div class="mod-label">Loadouts pipeline</div><div class="note">Reading the last run…</div></section>`;
    const m = pipe.meta;
    if (!m) {
      return `<section class="band"><div class="mod-label">Loadouts pipeline</div>
        <div class="note">No run has been recorded yet (<code>data/loadouts-meta.json</code> is not there).
        The build file itself says ${pipe.updated ? `it last changed on ${e(pipe.updated)}` : "nothing about when it changed"}${pipe.builds ? `, with ${pipe.builds} builds in it` : ""}.</div></section>`;
    }
    const word = { written: "wrote a new file", unchanged: "found nothing changed", refused: "refused to write" }[m.status] || m.status;
    const late = (Date.now() - new Date(m.built)) / 36e5 > 30;    // it runs every morning; a day and a bit is late
    const skips = Object.entries(m.skipped || {});
    return `<section class="band">
      <div class="mod-label">Loadouts pipeline <span class="note">${e(h.ago(m.built))}, and it ${e(word)}</span></div>
      ${m.status === "refused" ? `<div class="adalert">${e(m.note || "The run refused to write.")}</div>` : ""}
      ${late && m.status !== "refused" ? `<div class="adalert">The last run was ${e(h.ago(m.built))}. This job runs every morning, so it has missed at least one.</div>` : ""}
      <div class="items">
        <div class="it"><div class="v num">${e(m.builds)}</div><div class="k">builds</div></div>
        <div class="it"><div class="v num">${e(m.creators)}</div><div class="k">creators</div></div>
        <div class="it"><div class="v num">${e(m.weapons)}<span class="admu">/${e(m.guns)}</span></div><div class="k">weapons covered</div></div>
        <div class="it"><div class="v num">${e(pipe.updated || "–")}</div><div class="k">builds last changed</div></div>
      </div>
      <div class="adsplit">
        <div><div class="adh">By creator</div>
          ${Object.entries(m.by_creator || {}).map(([k, n]) => `<div class="adkv"><span>${e((pipe.names || {})[k] || k)}</span><b class="num">${e(n)}</b></div>`).join("")}</div>
        <div><div class="adh">Dropped on the last run <span class="admu">${skips.reduce((a, s) => a + s[1], 0)} rows</span></div>
          ${skips.length ? skips.map(([k, n]) => `<div class="adkv"><span>${e(k)}</span><b class="num">${e(n)}</b></div>`).join("")
            : `<div class="note">Nothing was dropped.</div>`}</div>
      </div>
    </section>`;
  }

  // ---------- registration ----------
  window.DF_TABS = window.DF_TABS || [];
  window.DF_TABS.push({
    id: "admin",
    label: "Admin",
    visible: (h) => h.isAdmin,
    scope: "all",                 // everybody, not the board you happen to be looking at
    aside: false,
    filters: false,               // nothing here is a match, so neither picker means anything

    queries: () => [
      "admin_invites?select=*&order=created_at.desc",
      "admin_players?select=*&order=enrolled_at.asc.nullsfirst",
      "admin_sessions?select=*",
    ],

    hero(data, h) {
      const invites = data[0] || [], players = data[1] || [], sessions = data[2] || [];
      const open = invites.filter(i => !i.revoked && !i.spent).length;
      const bad = players.filter(p => {
        const s = sessions.find(x => x.openid === p.openid);
        const last = s && (s.last_ok_at || s.updated_at);
        return !s || s.last_error || !last || (Date.now() - new Date(last)) / 36e5 > 2;
      }).length;
      const m = pipePhase === "ready" && pipe.meta;
      return {
        eyebrow: "Admin · the tracker itself",
        big: String(players.length),
        sub: players.length === 1 ? "account on this tracker" : "accounts on this tracker",
        cells: [
          ["Ways in still open", String(open), open ? "links that would let somebody in now" : "nobody can join without a new link",
            "A link is open until it is used up or withdrawn. This counts the ones that would work if somebody opened them this minute."],
          ["Collecting", `${players.length - bad}<span style="color:var(--muted)">/${players.length}</span>`,
            bad ? (bad === 1 ? "one account needs a look" : bad + " accounts need a look") : "everybody is up to date"],
          ["Loadouts last built", m ? h.ago(m.built) : "–", m ? "and it " + ({ written: "wrote a new file", unchanged: "found no change", refused: "refused" }[m.status] || m.status) : null],
        ],
      };
    },

    render(el, data, h) {
      ensurePipe(h);
      const invites = data[0] || [], players = data[1] || [], sessions = data[2] || [];
      el.innerHTML = waysIn(invites, h) + people(players, h) + collection(players, sessions, h) + pipeline(h);

      el.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => {
        // The code is only half of what you send somebody; the link is the whole of it.
        const code = b.dataset.copy;
        copy(/^[0-9a-f]{12,}$/.test(code) ? h.inviteUrl(code) : code);
        const was = b.textContent; b.textContent = "copied";
        setTimeout(() => { if (b.isConnected) b.textContent = was; }, 1200);
      });

      // Withdrawing is two clicks. Nothing here is undoable and the button sits in a table of
      // rows that look alike, which is the shape of mistake worth one more click.
      el.querySelectorAll("[data-revoke]").forEach(b => b.onclick = async () => {
        const code = b.dataset.revoke;
        if (armed !== code) { armed = code; h.repaint(); return; }
        armed = null; b.disabled = true; b.textContent = "…";
        const r = await h.rpc("admin_revoke_invite", { p_code: code });
        if (r.error) { made = { error: r.error }; h.repaint(); return; }
        h.reload();
      });

      el.querySelectorAll("[data-cap]").forEach(b => b.onclick = async () => {
        b.disabled = true; b.textContent = "…";
        const r = await h.rpc("admin_cap_invite", { p_code: b.dataset.cap, p_max: b.dataset.to === "1" ? 1 : null });
        if (r.error) { made = { error: r.error }; h.repaint(); return; }
        h.reload();
      });

      el.querySelectorAll("[data-cap-set]").forEach(b => b.onclick = () => {
        cap = b.dataset.capSet === "null" ? null : Number(b.dataset.capSet);
        h.repaint();
      });

      el.querySelectorAll("[data-mint]").forEach(b => b.onclick = async () => {
        const kind = b.dataset.mint;
        busy = kind; made = null; h.repaint();
        const r = await h.askForInvite(kind, cap, h.group);
        busy = null;
        made = r.error ? { error: r.error } : r;
        h.repaint();
        const f = el.querySelector(".admade input");
        if (f) { f.select(); copy(f.value); }
      });

      el.querySelectorAll(".admade input").forEach(f => f.onclick = () => f.select());
    },
  });

  // ---------- styles ----------
  // Tables, because every section here is a list of rows with the same columns and that is what a
  // table is for. The board's own bands are figures; this page is a ledger.
  const style = document.createElement("style");
  style.textContent = `
  #pane-admin .band:last-child { border-bottom: 0; }
  .adscroll { overflow-x: auto; }
  .adt { width: 100%; border-collapse: collapse; font: 400 12.5px 'Barlow', sans-serif; }
  .adt th { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--muted);
            text-align: left; padding: 0 14px 7px 0; border-bottom: 1px solid var(--hair); white-space: nowrap; }
  .adt td { padding: 9px 14px 9px 0; border-bottom: 1px solid var(--hair-2); vertical-align: top; color: var(--text-2); }
  .adt tr:last-child td { border-bottom: 0; }
  .adt td b { color: var(--text); font-weight: 600; }
  .adt .num { font-family: var(--hud); font-variant-numeric: tabular-nums; }
  .addead td { opacity: .45; }
  .admu { color: var(--muted); }
  .adtag { font: 600 9px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--green);
           border: 1px solid var(--hair); padding: 1px 5px; margin-left: 5px; }
  .addot { display: inline-block; width: 7px; height: 7px; margin-right: 7px; background: var(--muted); }
  .addot.on { background: var(--green); }
  .addot.warn { background: var(--amber); }
  .addot.bad { background: var(--red); }
  .aderr { color: var(--muted); max-width: 30ch; }
  .adcode { background: none; border: 0; padding: 0; cursor: pointer; color: var(--green);
            font: 600 12px var(--hud); letter-spacing: 1px; }
  .adcode:hover { text-decoration: underline; }
  .adact { white-space: nowrap; text-align: right; }
  .adact button { background: none; border: 1px solid var(--hair); color: var(--text-2);
                  font: 400 11px 'Barlow', sans-serif; padding: 4px 9px; margin-left: 6px; cursor: pointer; }
  .adact button:hover { border-color: var(--div); color: var(--text); }
  .adact .adbad:hover { border-color: var(--red); color: var(--red); }

  /* Making one. The cap sits to the left of the button that uses it, so the sentence reads in the
     order it is decided: good for one person — tracker link. */
  .admint { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 16px;
            padding-top: 14px; border-top: 1px solid var(--hair); }
  .adml { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
  .adpill { background: none; border: 1px solid var(--hair); color: var(--text-2);
            font: 400 11px 'Barlow', sans-serif; padding: 5px 11px; cursor: pointer; }
  .adpill.on { border-color: var(--green); color: var(--green); }
  .adspacer { flex: 1; min-width: 4px; }
  .adgo { background: var(--green); border: 0; color: var(--on-green); font: 600 11px var(--hud);
          letter-spacing: .5px; padding: 7px 14px; cursor: pointer; }
  .adgo:hover { filter: brightness(1.08); }
  .admade { margin-top: 13px; padding: 12px 14px; background: var(--hair-2); border-left: 2px solid var(--green); }
  .admade b { display: block; font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase;
              color: var(--green); margin-bottom: 8px; }
  .admade input { width: 100%; background: var(--ground); border: 1px solid var(--hair); color: var(--text);
                  font: 400 12px 'Barlow', sans-serif; padding: 7px 9px; }
  .admade .note { display: block; margin-top: 7px; }
  .adalert { margin-bottom: 14px; padding: 10px 13px; border-left: 2px solid var(--amber);
             background: var(--hair-2); color: var(--text-2); font: 400 12.5px 'Barlow', sans-serif; }
  .adsplit { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 22px; margin-top: 18px; }
  .adh { font: 600 10px var(--hud); letter-spacing: 1px; text-transform: uppercase; color: var(--muted);
         border-bottom: 1px solid var(--hair); padding-bottom: 6px; margin-bottom: 8px; }
  .adkv { display: flex; justify-content: space-between; gap: 14px; padding: 3px 0;
          font: 400 12.5px 'Barlow', sans-serif; color: var(--text-2); }
  .adkv b { color: var(--text); font-weight: 600; }
  @media (max-width: 820px) {
    .adt { font-size: 12px; }
    .adt th, .adt td { padding-right: 10px; }
    .aderr { max-width: 22ch; }
  }
  `;
  document.head.appendChild(style);
})();
