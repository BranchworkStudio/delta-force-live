/* Delta Force Live: the connect flow.
   The site cannot read HQ's cookies (their API only answers their own origin), so the hand-over is
   a one-time bookmark the player clicks while on the HQ page. It reads the HQ page's own login
   cookies and navigates back here with them in the URL fragment, which never reaches a server log.
   This page then POSTs them to the `connect` function, which verifies them against HQ before storing. */
(function () {
  const C = window.DF_CONFIG;
  const $ = (s) => document.querySelector(s);
  const HQ = "https://www.playdeltaforce.com/events/hq/en/";
  const K = { code: "df-squad-code", bm: "df-bm", conn: "df-connected" };
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const span = (s) => s < 90 ? Math.round(s) + " s" : s < 5400 ? Math.round(s / 60) + " min" : s < 172800 ? (s / 3600).toFixed(1) + " h" : (s / 86400).toFixed(1) + " d";

  const S = {
    code: ls.get(K.code) || "",
    bm: ls.get(K.bm) === "1",
    phase: "steps",          // steps | sending | done | error
    busy: "",
    payload: null,           // cookies waiting for a squad code
    err: null,               // { title, body, kind, acts }
    res: null,               // connect response
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
      body: JSON.stringify({ code: S.code, ...body }),   // an explicit code in `body` wins: that is how a new one gets tested
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
    const steps = [];
    steps.push({
      id: "code", title: "Enter the squad code", done: !!S.code,
      body: S.code
        ? `<p>Saved in this browser.</p><div class="acts"><button class="link" id="codechange">Change code</button></div>`
        : `<p>The shared code that lets this browser write to the board. Same one the extension uses.</p>
           <div class="field"><input id="code" placeholder="squad code" spellcheck="false" autocomplete="off"><button class="go" id="codesave">Save</button></div>`,
    });
    steps.push({
      id: "bm", title: "Add the bookmark", done: S.bm,
      body: `<p>Drag this onto your bookmarks bar. It only reads the HQ page's own login and sends you back here — nothing else.</p>
        <div class="bar">
          <div class="chrome"><i></i><i></i><i></i><span>Bookmarks bar</span></div>
          <div class="shelf"><a class="chip" href="${bookmarkletHref()}" draggable="true" onclick="return false"><span class="tri"></span>Connect HQ</a><span class="arrow">← drag me up there</span></div>
        </div>
        <p class="hint">Bookmarks bar hidden? <b>⌘⇧B</b> on Mac, <b>Ctrl⇧B</b> on Windows.</p>
        <div class="acts"><button class="go" id="bmdone">I've added it</button></div>`,
    });
    steps.push({
      id: "hq", title: "Log in on HQ", done: false,
      body: `<p>Opens the official Delta Force HQ site in a new tab. Log in there if it asks — your password only ever goes to them.</p>
        <div class="acts"><button class="go" id="openhq">Open HQ ›</button></div>`,
    });
    steps.push({
      id: "click", title: "Click the bookmark on that tab", done: false,
      body: `<p>On the HQ tab, click <b>Connect HQ</b> in your bookmarks bar. That tab comes back here connected, and this page finishes on its own.</p>
        <div class="waiting"><i></i>Waiting for the hand-over</div>
        <div class="box">Your HQ session gets stored on the server so it can collect matches while your PC is off. You can disconnect any time, and it never includes your password.</div>`,
    });
    return steps;
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
    return `<div class="box ${S.err.kind || "bad"}"><b>${esc(S.err.title)}</b><br>${S.err.body}</div>`;
  }
  function foot() {
    return `<div class="foot"><a href="./">Back to the board</a>
      <a href="https://github.com/BranchworkStudio/delta-force-live#readme" target="_blank" rel="noopener">How this works</a></div>`;
  }

  function wireSteps() {
    const save = $("#codesave"), input = $("#code");
    if (save) {
      const go = async () => {
        const v = (input.value || "").trim();
        if (!v) return;
        save.disabled = true; save.textContent = "…";
        const r = await post({ action: "probe", code: v }).catch(() => null);
        // probe only needs the code, so a 200 here means the code is right.
        if (r && r.httpOk) { S.code = v; ls.set(K.code, v); S.err = null; if (S.payload) return handOver(S.payload); render(); }
        else { S.err = { title: "That code was not accepted", body: "Check it against the code the extension uses, or ask whoever set the board up." }; save.disabled = false; save.textContent = "Save"; render(); }
      };
      save.onclick = go;
      input.onkeydown = (e) => { if (e.key === "Enter") go(); };
      input.focus();
    }
    const chg = $("#codechange");
    if (chg) chg.onclick = () => { S.code = ""; ls.set(K.code, ""); render(); };
    const bmd = $("#bmdone");
    if (bmd) bmd.onclick = () => { S.bm = true; ls.set(K.bm, "1"); render(); };
    const hq = $("#openhq");
    if (hq) hq.onclick = () => window.open(HQ, "_blank", "noopener");
  }

  // ---------- result ----------
  function renderDone() {
    const r = S.res || {};
    $("#title").textContent = "HQ connected";
    $("#lede").textContent = "The server can now read your matches on its own.";
    $("#flow").innerHTML = `<div class="result">
      <div class="state" style="color:var(--green)"><i class="live"></i>Connected</div>
      <div class="who">${esc(r.nickname || "Your account")}</div>
      <div class="facts">
        ${r.level ? `<div>Level <b>${esc(r.level)}</b></div>` : ""}
        <div>Player id <b>${esc(r.openid)}</b></div>
        <div>${r.fresh ? "New HQ login, clock started now." : `Same login as before · running for <b>${span((Date.now() - new Date(r.connected_at)) / 1000)}</b>`}</div>
      </div>
      <div class="acts" style="margin-top:22px"><a class="go" href="./">Open the board ›</a>
      <button class="ghost" id="disc">Disconnect</button></div>
      <div class="box">Stored: the nine HQ login cookies, so the backend can call HQ as you. Not stored: anything to do with your Level Infinite password. Disconnect deletes them.</div>
    </div>` + foot();
    const d = $("#disc");
    if (d) d.onclick = async () => {
      d.disabled = true; d.textContent = "…";
      await post({ action: "disconnect", openid: r.openid }).catch(() => null);
      S.phase = "steps"; S.res = null; S.err = { title: "Disconnected", body: "The server no longer holds your HQ session.", kind: "" };
      $("#title").textContent = "Connect your HQ account";
      $("#lede").textContent = "One setup, then two clicks whenever your HQ login runs out. Nothing to install.";
      render();
    };
  }

  function renderSending() {
    $("#flow").innerHTML = `<div class="result"><div class="waiting"><i></i>${esc(S.busy || "Handing over to the server")}</div></div>`;
  }

  function render() {
    if (S.phase === "done") return renderDone();
    if (S.phase === "sending") return renderSending();
    renderSteps();
  }

  // ---------- hand-over ----------
  async function handOver(cookies) {
    S.phase = "sending"; S.busy = "Checking the session with HQ"; S.payload = cookies; render();
    const r = await post({ action: "connect", cookies }).catch((e) => ({ httpOk: false, status: 0, error: String(e) }));
    if (r.httpOk && r.ok) {
      S.res = r; S.phase = "done"; S.payload = null; S.err = null;
      ls.set(K.bm, "1"); S.bm = true;
      ls.set(K.conn, JSON.stringify({ openid: r.openid, nickname: r.nickname || null, at: Date.now() }));  // tells the other tab
      return render();
    }
    S.phase = "steps";
    if (r.status === 403) { S.code = ""; ls.set(K.code, ""); S.err = { title: "The squad code was refused", body: "Enter it again below and the hand-over will continue." }; return render(); }
    if (r.reason === "not-logged-in") S.err = { title: "HQ says that login is not valid", body: `Open HQ, log in properly, then click the bookmark again. <span class="hint">(${esc(r.error || "")})</span>` };
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
        S.res = { ok: true, openid: v.openid, nickname: v.nickname, fresh: true, connected_at: new Date(v.at).toISOString() };
        S.phase = "done"; render();
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
        S.res = { ok: true, openid: hit.openid, nickname: (players[0] || {}).nickname, level: (players[0] || {}).level, fresh: true, connected_at: hit.connected_at };
        S.phase = "done"; render();
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
      else if (!S.code) { S.payload = cookies; S.err = { title: "Almost there", body: "Enter the squad code below and the hand-over finishes by itself.", kind: "" }; render(); }
      else handOver(cookies);
    } else if (q.get("e") === "wrongsite") {
      S.bm = true; ls.set(K.bm, "1");
      S.err = { title: "That bookmark has to be clicked on the HQ site", body: `You clicked it on <code>${esc(q.get("h") || "another page")}</code>. Open HQ, then click it there.`, kind: "warn" };
      render();
    } else if (q.get("e") === "login") {
      S.bm = true; ls.set(K.bm, "1");
      const found = (q.get("f") || "").split(",").filter(Boolean);
      S.err = found.length
        ? { title: "Your HQ login is only half there", body: `The HQ page shows <code>${esc(found.join(", "))}</code> but not the token, so the bookmark route cannot carry it. Log out and back in on HQ and try once more — if it keeps happening, the extension is the only way in.`, kind: "warn" }
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
