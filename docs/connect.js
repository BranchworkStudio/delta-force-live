/* Delta Force Live: the connect flow.
   The site cannot read HQ's cookies (their API only answers their own origin), so the hand-over is
   a one-time bookmark the player clicks while on the HQ page. It reads the HQ page's own login
   cookies and navigates back here with them in the URL fragment, which never reaches a server log.
   This page then POSTs them to the `connect` function, which verifies them against HQ before storing.
   There is nothing to type: only the account owner can produce cookies that HQ accepts, so the
   hand-over authenticates itself. Joining a board that already has players needs an invite, and that
   rides along in the query string (`connect.html?i=...`) — the bookmarklet keeps it, because it
   navigates back to this URL minus only the fragment. */
(function () {
  const C = window.DF_CONFIG;
  const $ = (s) => document.querySelector(s);
  const HQ = "https://www.playdeltaforce.com/events/hq/en/";
  const K = { bm: "df-bm", conn: "df-connected", ctl: "df-control", inv: "df-invite", focus: "df-focus" };
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const span = (s) => s < 90 ? Math.round(s) + " s" : s < 5400 ? Math.round(s / 60) + " min" : s < 172800 ? (s / 3600).toFixed(1) + " h" : (s / 86400).toFixed(1) + " d";

  // The invite comes from the shared link; remembered so a later reconnect works from a bare URL.
  const invite = new URLSearchParams(location.search).get("i") || ls.get(K.inv) || "";
  if (invite) ls.set(K.inv, invite);

  const S = {
    bm: ls.get(K.bm) === "1",
    phase: "steps",          // steps | sending | done
    busy: "",
    err: null,               // { title, body, kind }
    res: null,               // connect response, while the confirmation is on screen
    since: Date.now(),
  };

  // ---------- the bookmarklet ----------
  function bookmarkletHref() {
    const url = location.href.split("#")[0];
    const src = "(function(){" +
      "var h=location.hostname,u=" + JSON.stringify(url) + ";" +
      'if(h.indexOf("playdeltaforce.com")<0){location.href=u+"#e=wrongsite&h="+encodeURIComponent(h);return}' +
      'var n="openid token game_id channel encodeparam role_id zone_id area_id plat_id".split(" "),c={},p=(document.cookie||"").split(";"),i,q,e,k;' +
      'for(i=0;i<p.length;i++){q=p[i].trim();e=q.indexOf("=");if(e<1)continue;k=q.slice(0,e);if(k.slice(0,8)!="Wand_DF_")continue;k=k.slice(8);' +
      "if(n.indexOf(k)<0)continue;try{c[k]=decodeURIComponent(q.slice(e+1))}catch(x){c[k]=q.slice(e+1)}}" +
      'if(!c.openid||!c.token){location.href=u+"#e=login&f="+encodeURIComponent(Object.keys(c).join(","));return}' +
      'location.href=u+"#s="+encodeURIComponent(JSON.stringify(c))})()';
    return "javascript:" + encodeURIComponent(src);
  }

  // ---------- backend ----------
  async function post(body) {
    const res = await fetch(C.SUPABASE_URL + "/functions/v1/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + C.SUPABASE_ANON_KEY },
      body: JSON.stringify({ invite, ...body }),
    });
    let j = {}; try { j = await res.json(); } catch (e) { /* empty body */ }
    return { httpOk: res.ok, status: res.status, ...j };
  }
  async function rest(path) {
    const res = await fetch(C.SUPABASE_URL + "/rest/v1/" + path, { headers: { apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + C.SUPABASE_ANON_KEY } });
    if (!res.ok) throw new Error("REST " + res.status);
    return res.json();
  }

  // ---------- steps ----------
  function stepList() {
    return [{
      id: "bm", title: "Add the bookmark", done: S.bm,
      body: `<p>Drag this onto your bookmarks bar. It only reads the HQ page's own login and sends you back here — nothing else.</p>
        <div class="bar">
          <div class="chrome"><i></i><i></i><i></i><span>Bookmarks bar</span></div>
          <div class="shelf"><a class="chip" href="${bookmarkletHref()}" draggable="true" onclick="return false"><span class="tri"></span>Connect HQ</a><span class="arrow">← drag me up there</span></div>
        </div>
        <p class="hint">Bookmarks bar hidden? <b>⌘⇧B</b> on Mac, <b>Ctrl⇧B</b> on Windows.</p>
        <div class="acts"><button class="go" id="bmdone">I've added it</button></div>`,
    }, {
      id: "hq", title: "Log in on HQ", done: false,
      body: `<p>Opens the official Delta Force HQ site in a new tab. Log in there if it asks — your password only ever goes to them.</p>
        <div class="acts"><button class="go" id="openhq">Open HQ ›</button></div>`,
    }, {
      id: "click", title: "Click the bookmark on that tab", done: false,
      body: `<p>On the HQ tab, click <b>Connect HQ</b> in your bookmarks bar. That tab comes back here connected, and this page finishes on its own.</p>
        <div class="waiting"><i></i>Waiting for the hand-over</div>
        <div class="box">Your HQ session gets stored on the server, which then reads your matches every minute — with your PC off and nothing installed. You can disconnect any time, and it never includes your password.</div>`,
    }];
  }

  function renderSteps() {
    const steps = stepList();
    const cur = steps.findIndex((s) => !s.done);
    $("#flow").innerHTML = steps.map((s, i) => {
      const cls = s.done ? "done" : i === cur ? "on" : "off";
      return `<div class="step ${cls}" data-id="${s.id}">
        <div class="no">${s.done ? "✓" : i + 1}</div>
        <div><h2>${s.title}</h2>${i === cur || s.done ? s.body : ""}</div>
      </div>`;
    }).join("") + (S.err ? errBox() : "") + foot();
    wireSteps();
  }

  function errBox() {
    return `<div class="box ${S.err.kind === undefined ? "bad" : S.err.kind}"><b>${esc(S.err.title)}</b><br>${S.err.body}</div>`;
  }
  function foot() {
    return `<div class="foot"><a href="./">Back to the board</a>
      <a href="https://github.com/BranchworkStudio/delta-force-live#readme" target="_blank" rel="noopener">How this works</a></div>`;
  }

  function wireSteps() {
    const bmd = $("#bmdone");
    if (bmd) bmd.onclick = () => { S.bm = true; ls.set(K.bm, "1"); render(); };
    const hq = $("#openhq");
    if (hq) hq.onclick = () => window.open(HQ, "_blank", "noopener");
  }

  // ---------- success ----------
  // Connected is a beat, not a destination: it confirms who was connected and then hands over to the
  // board on its own. Everything you might want to *do* afterwards (invite, disconnect) lives there.
  const HOLD = 3200;

  function finish(r) {
    ls.set(K.bm, "1"); S.bm = true;
    if (r.control_key) { ls.set(K.ctl, r.openid); ls.set(K.ctl + "-key", r.control_key); }   // only this browser may disconnect
    if (r.invite) ls.set(K.inv, r.invite);                     // so this player can invite the next one
    if (r.openid) ls.set(K.focus, r.openid);                   // the board opens on the player who just connected
    ls.set(K.conn, JSON.stringify({ openid: r.openid, nickname: r.nickname || null, at: Date.now() }));  // tells the other tab
    S.phase = "done"; S.res = r; S.err = null;
    render();
  }

  function renderConnected() {
    const r = S.res || {};
    $("#title").textContent = r.joined ? "You're on the board" : "HQ connected";
    $("#lede").textContent = "The server reads your matches on its own now — once a minute, PC off.";
    $("#flow").innerHTML = `<div class="result">
      <div class="state" style="color:var(--green)"><i class="live"></i>Connected</div>
      <div class="who">${esc(r.nickname || "Your account")}</div>
      <div class="facts">
        ${r.level ? `<div>Level <b>${esc(r.level)}</b></div>` : ""}
        <div>${r.fresh ? "New HQ login, clock started now." : `Same login as before · running for <b>${span((Date.now() - new Date(r.connected_at)) / 1000)}</b>`}</div>
        <div>First matches land within a minute.</div>
      </div>
      <a class="hand" href="./">Opening the board<span class="dots"><i></i><i></i><i></i></span></a>
      <div class="bead"><span></span></div>
    </div>`;
    setTimeout(() => { if (S.phase === "done") location.replace("./"); }, HOLD);
  }

  function renderSending() {
    $("#flow").innerHTML = `<div class="result"><div class="waiting"><i></i>${esc(S.busy || "Handing over to the server")}</div></div>`;
  }

  function render() {
    if (S.phase === "done") return renderConnected();
    if (S.phase === "sending") return renderSending();
    renderSteps();
  }

  // ---------- hand-over ----------
  async function handOver(cookies) {
    S.phase = "sending"; S.busy = "Checking the session with HQ"; render();
    const r = await post({ action: "connect", cookies }).catch((e) => ({ httpOk: false, status: 0, error: String(e) }));
    if (r.httpOk && r.ok) return finish(r);
    S.phase = "steps";
    if (r.reason === "not-enrolled") S.err = { title: "You need the squad's invite link", body: "This board is already tracking players, so a new account joins through an invite link. Ask whoever sent you here to send the <code>?i=…</code> version of it." };
    else if (r.reason === "bad-invite") S.err = { title: "That invite link is out of date", body: "The squad's invite has been rotated since the link was shared. Ask for a fresh one." };
    else if (r.reason === "not-logged-in") S.err = { title: "HQ says that login is not valid", body: `Open HQ, log in properly, then click the bookmark again. <span class="hint">(${esc(r.error || "")})</span>` };
    else if (r.reason === "no-cookies") S.err = { title: "No HQ login in that browser", body: "Log in on HQ first, then click the bookmark on the HQ tab." };
    else S.err = { title: "The server could not reach HQ", body: `Try the bookmark again in a minute. <span class="hint">(${esc(r.error || r.status)})</span>`, kind: "warn" };
    render();
  }

  // ---------- the other tab finished ----------
  let watching = false;
  function watchForHandover() {
    if (watching) return;
    watching = true;
    window.addEventListener("storage", (e) => {
      if (e.key !== K.conn || !e.newValue) return;
      try {
        const v = JSON.parse(e.newValue);
        if (Date.now() - v.at > 120000) return;
        finish({ openid: v.openid, nickname: v.nickname, fresh: true, connected_at: new Date(v.at).toISOString() });
      } catch (x) { /* ignore */ }
    });
    // Fallback for browsers that hand the bookmark to a different tab group: watch the public view.
    setInterval(async () => {
      if (S.phase !== "steps" || !S.bm) return;
      try {
        const rows = await rest("public_sessions?select=openid,connected_at,updated_at");
        const hit = rows.find((r) => new Date(r.updated_at).getTime() > S.since);
        if (!hit) return;
        const players = await rest("public_players?select=openid,nickname,level&openid=eq." + encodeURIComponent(hit.openid)).catch(() => []);
        finish({ openid: hit.openid, nickname: (players[0] || {}).nickname, level: (players[0] || {}).level, fresh: true, connected_at: hit.connected_at });
      } catch (x) { /* offline, keep waiting */ }
    }, 6000);
  }

  // ---------- boot ----------
  // Also runs on hashchange: clicking the bookmark while already on this page is a same-document
  // navigation, so without this the second click would look like nothing happened.
  function boot() {
    const hash = location.hash.replace(/^#/, "");
    if (hash) history.replaceState(null, "", location.pathname + location.search);   // never leave the token in the address bar
    const q = new URLSearchParams(hash);
    S.err = null;

    if (!C || !C.SUPABASE_URL) {
      $("#flow").innerHTML = `<div class="box bad">config.js is not filled in.</div>`;
    } else if (q.get("s")) {
      S.bm = true; ls.set(K.bm, "1");
      let cookies = null;
      try { cookies = JSON.parse(q.get("s")); } catch (e) { /* mangled */ }
      if (!cookies) { S.err = { title: "That hand-over was unreadable", body: "Click the bookmark on the HQ tab again." }; render(); }
      else handOver(cookies);
    } else if (q.get("e") === "wrongsite") {
      S.bm = true; ls.set(K.bm, "1");
      S.err = { title: "That bookmark has to be clicked on the HQ site", body: `You clicked it on <code>${esc(q.get("h") || "another page")}</code>. Open HQ, then click it there.`, kind: "warn" };
      render();
    } else if (q.get("e") === "login") {
      S.bm = true; ls.set(K.bm, "1");
      const found = (q.get("f") || "").split(",").filter(Boolean);
      S.err = found.length
        ? { title: "Your HQ login is only half there", body: `The HQ page shows <code>${esc(found.join(", "))}</code> but not the token, so the bookmark route cannot carry it. Log out and back in on HQ, then try once more.`, kind: "warn" }
        : { title: "You are not logged in on HQ yet", body: "Log in on the HQ tab, then click the bookmark there." };
      render();
    } else {
      render();
    }
  }

  window.addEventListener("hashchange", boot);
  watchForHandover();     // installed once, so an error card still flips to Connected when the retry lands
  boot();
})();
