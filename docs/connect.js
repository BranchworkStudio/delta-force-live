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
  const F = window.DF_CONNECT;
  const K = { bm: "df-bm", conn: "df-connected", ctl: "df-control", inv: "df-invite", focus: "df-focus", sess: "df-session" };
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const span = (s) => s < 90 ? Math.round(s) + " s" : s < 5400 ? Math.round(s / 60) + " min" : s < 172800 ? (s / 3600).toFixed(1) + " h" : (s / 86400).toFixed(1) + " d";

  // The code comes from the link a mate was sent; remembered so a later reconnect works from a bare
  // URL. Two shapes arrive here — `?g=` is a group's own code, `?i=` a one-off tracker link — and
  // the server takes either from either parameter, so this page does not have to tell them apart.
  const qs = new URLSearchParams(location.search);
  const invite = qs.get("g") || qs.get("i") || ls.get(K.inv) || "";
  if (invite) ls.set(K.inv, invite);

  const S = {
    bm: ls.get(K.bm) === "1",
    phase: "steps",          // steps | sending | done
    busy: "",
    err: null,               // { title, body, kind }
    res: null,               // connect response, while the confirmation is on screen
    since: Date.now(),
  };

  // ---------- backend ----------
  async function post(body) {
    const res = await fetch(C.SUPABASE_URL + "/functions/v1/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + C.SUPABASE_ANON_KEY },
      body: JSON.stringify({ invite, group: invite, ...body }),
    });
    let j = {}; try { j = await res.json(); } catch (e) { /* empty body */ }
    return { httpOk: res.ok, status: res.status, ...j };
  }
  function renderSteps() {
    $("#flow").innerHTML = F.stepsHtml({ bm: S.bm, back: location.href.split("#")[0], closes: false })
      + (S.err ? errBox() : "") + foot();
    F.wire($("#flow"), { bm: () => { S.bm = true; render(); } });
  }

  function errBox() {
    return `<div class="box ${S.err.kind === undefined ? "bad" : S.err.kind}"><b>${esc(S.err.title)}</b><br>${S.err.body}</div>`;
  }
  function foot() {
    return `<div class="foot"><a href="./">Back to the board</a>
      <a href="https://github.com/BranchworkStudio/delta-force-live#readme" target="_blank" rel="noopener">How this works</a></div>`;
  }

  // ---------- success ----------
  // Connected is a beat, not a destination: it confirms who was connected and then hands over on its
  // own. Everything you might want to *do* afterwards (invite, disconnect) lives on the board.
  //
  // Where it hands over to depends on how this page was reached. `?w=1` means a board tab opened the
  // HQ window and is still sitting there waiting: it has already heard the hand-over land on the
  // storage event, so the useful thing for this window to do is get out of the way. Only a window a
  // script opened may close itself, so a browser that refuses — or a `?w=1` somebody typed by hand —
  // falls through to the redirect, which is what this page did before there was anything to close.
  const HOLD = 3200;
  const CLOSING = qs.get("w") === "1";

  function handOverEnds() {
    if (!CLOSING) return location.replace("./");
    window.close();
    setTimeout(() => { if (!window.closed) location.replace("./"); }, 700);
  }

  function finish(r) {
    ls.set(K.bm, "1"); S.bm = true;
    if (r.control_key) { ls.set(K.ctl, r.openid); ls.set(K.ctl + "-key", r.control_key); }   // only this browser may disconnect
    // The hand-over is the login, so it ends with a real session for the board to read with. Stored
    // with the moment it runs out, because the token itself only says how long it lasts.
    if (r.session && r.session.access_token) {
      ls.set(K.sess, JSON.stringify({
        openid: r.openid, access_token: r.session.access_token, refresh_token: r.session.refresh_token || null,
        expires_at: Date.now() + (Number(r.session.expires_in) || 3600) * 1000,
      }));
    }
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
      <a class="hand" href="./">${CLOSING ? "Closing this tab" : "Opening the board"}<span class="dots"><i></i><i></i><i></i></span></a>
      <div class="bead"><span></span></div>
    </div>`;
    setTimeout(() => { if (S.phase === "done") handOverEnds(); }, HOLD);
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
    if (r.reason === "not-enrolled") S.err = { title: "You need an invite link", body: "This tracker is invite-only: a new account joins through a link the person running it made for you. Ask whoever sent you here for the <code>?i=…</code> version of it." };
    // A board code and an invite are no longer the same thing, so the refusal says which you have.
    else if (r.reason === "code-not-invite") S.err = { title: "That is a board code, not an invite", body: "A board's six characters put somebody who is <em>already</em> on the tracker onto that board. Opening a new account is the tracker owner's to give — ask them for the <code>?i=…</code> link instead." };
    else if (r.reason === "bad-invite") S.err = { title: "That invite link does not work", body: "Either the link was mistyped, or it has been withdrawn since it was shared. Ask whoever sent it for a fresh one." };
    else if (r.reason === "not-logged-in") S.err = { title: "HQ says that login is not valid", body: `Open HQ, log in properly, then click the bookmark again. <span class="hint">(${esc(r.error || "")})</span>` };
    else if (r.reason === "no-cookies") S.err = { title: "No HQ login in that browser", body: "Log in on HQ first, then click the bookmark on the HQ tab." };
    else S.err = { title: "The server could not reach HQ", body: `Try the bookmark again in a minute. <span class="hint">(${esc(r.error || r.status)})</span>`, kind: "warn" };
    render();
  }

  // ---------- the other tab finished ----------
  function watchForHandover() {
    F.watch((v) => finish({ openid: v.openid, nickname: v.nickname, fresh: true, connected_at: new Date(v.at).toISOString() }));
    // There used to be a fallback here that polled `public_sessions` for any session that had
    // appeared since this page opened, for browsers that hand the bookmark to a different tab
    // group. Boards are private now: the publishable key reads nothing, and a visitor who has not
    // connected yet has no session to read with — so that poll could only ever 401. The two paths
    // that matter both still work: the tab the bookmark returns to finishes the hand-over itself,
    // and any other tab of the same browser hears it on the `storage` event above.
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
