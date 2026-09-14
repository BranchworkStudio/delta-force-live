/* The connect flow, in the one place both pages read it from.

   It is the same three steps wherever it appears, and it exists as its own file because it now
   appears twice: on connect.html, and inside the gate on the board — a visitor whose account is not
   linked yet should meet "connect your HQ account" as the page itself, not as a link to a page that
   then asks. The bookmarklet source in particular must never exist twice; it is the part that reads
   the player's HQ login, and two copies of that drifting apart is the worst bug this site could have.

   What the flow cannot do, since it comes up every time someone looks at this: no page here can read
   the HQ window. It is another origin, so its cookies, its DOM and its storage are all closed to us,
   and HQ sends nothing out on its own. Something has to run inside that page as the player, and the
   bookmark is that something. The window it runs in lands back on connect.html, which IS this origin,
   and that is why the hand-over works at all. */
(function () {
  const HQ = "https://www.playdeltaforce.com/events/hq/en/";

  // The bookmark. `returnUrl` is where it navigates the HQ tab afterwards — connect.html, with
  // whatever query it was given (an invite, and `w=1` when a board tab is waiting for it).
  function bookmarkletHref(returnUrl) {
    const url = String(returnUrl).split("#")[0];
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

  // The chip's triangle is the character ▲ and not the site's clip-path one, because the name is the
  // only thing that survives the drag: a browser gives a `javascript:` bookmark its own generic icon
  // and there is no way to replace it, so the mark has to live in the text next to it.
  //
  // o.bm      the bookmark is already on their bar (remembered across visits)
  // o.back    where the bookmark sends the HQ tab
  // o.closes  true on the board, where that tab hands over and shuts itself rather than becoming
  //           the page in front of you — the last step says whichever of those will happen.
  function stepsHtml(o) {
    const steps = [{
      id: "bm", title: "Add the bookmark", done: !!o.bm,
      body: `<p>Drag this onto your bookmarks bar. It only reads the HQ page's own login and sends you back here — nothing else.</p>
        <div class="bar">
          <div class="chrome"><i></i><i></i><i></i><span>Bookmarks bar</span></div>
          <div class="shelf"><a class="chip" href="${bookmarkletHref(o.back)}" draggable="true" onclick="return false"><span class="mk">▲</span> Connect HQ</a><span class="arrow">← drag me up there</span></div>
        </div>
        <p class="hint">Bookmarks bar hidden? <b>⌘⇧B</b> on Mac, <b>Ctrl⇧B</b> on Windows.</p>
        <div class="acts"><button class="go" id="bmdone">I've added it</button></div>`,
    }, {
      id: "hq", title: "Log in on HQ", done: false,
      body: `<p>Opens the official Delta Force HQ site in a new tab. Log in there if it asks — your password only ever goes to them.</p>
        <div class="acts"><button class="go" id="openhq">Open HQ ›</button></div>`,
    }, {
      id: "click", title: "Click the bookmark on that tab", done: false,
      body: `<p>On the HQ tab, click <b>Connect HQ</b> in your bookmarks bar. ${o.closes
          ? "That tab hands your login over and closes itself, and this board fills in the moment it lands."
          : "That tab comes back here connected, and this page finishes on its own."}</p>
        <div class="waiting"><i></i>Waiting for the hand-over</div>
        <div class="box">Your HQ session gets stored on the server, which then reads your matches every minute — with your PC off and nothing installed. You can disconnect any time, and it never includes your password.</div>`,
    }];
    const cur = steps.findIndex((s) => !s.done);
    return steps.map((s, i) => {
      const cls = s.done ? "done" : i === cur ? "on" : "off";
      return `<div class="step ${cls}" data-id="${s.id}">
        <div class="no">${s.done ? "✓" : i + 1}</div>
        <div><h2>${s.title}</h2>${i === cur || s.done ? s.body : ""}</div>
      </div>`;
    }).join("");
  }

  // `noopener` on purpose: the HQ page never gets a handle on the window that opened it. Nothing is
  // lost by that — the hand-over travels through localStorage between two tabs of our own origin,
  // not through window.opener.
  function openHq() { window.open(HQ, "_blank", "noopener"); }

  function wire(root, on) {
    const bmd = root.querySelector("#bmdone");
    if (bmd) bmd.onclick = () => { try { localStorage.setItem("df-bm", "1"); } catch (e) { } if (on && on.bm) on.bm(); };
    const hq = root.querySelector("#openhq");
    if (hq) hq.onclick = () => { openHq(); if (on && on.hq) on.hq(); };
  }

  // Any tab of this browser hears the hand-over land, because the tab that did it writes it down.
  function watch(cb) {
    window.addEventListener("storage", (e) => {
      if (e.key !== "df-connected" || !e.newValue) return;
      try {
        const v = JSON.parse(e.newValue);
        if (Date.now() - v.at > 120000) return;
        cb(v);
      } catch (x) { /* ignore */ }
    });
  }

  window.DF_CONNECT = { HQ, bookmarkletHref, stepsHtml, wire, watch, openHq };
})();
