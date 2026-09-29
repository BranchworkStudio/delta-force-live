/* The Loadouts page's host. On the board a tab module is handed a host by app.js; this page has no
 * board — no session, no database, no squad — so this is the whole of what the module needs from
 * one: escaping, the tooltip, and a repaint that redraws the headline and the pane together.
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const tab = (window.DF_TABS || []).find(t => t.id === "loadouts");
  if (!tab) return;

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // The board's tooltip, the same element and the same rules (see attachTips in app.js).
  const tip = $("#tip");
  function showTip(x, y, html) {
    tip.innerHTML = html;
    tip.style.display = "block";
    tip.style.left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, x + 12)) + "px";
    tip.style.top = Math.max(8, Math.min(window.innerHeight - tip.offsetHeight - 8, y + 12)) + "px";
  }
  const hideTip = () => { tip.style.display = "none"; };
  function attachTips(root) {
    root.querySelectorAll("[data-tip]").forEach(n => {
      n.addEventListener("mousemove", (e) => showTip(e.clientX, e.clientY, n.getAttribute("data-tip")));
      n.addEventListener("mouseleave", hideTip);
      n.addEventListener("touchstart", (e) => { const t = e.touches[0]; if (t) showTip(t.clientX, t.clientY, n.getAttribute("data-tip")); }, { passive: true });
    });
  }
  document.addEventListener("touchstart", (e) => { if (tip.style.display === "block" && !e.target.closest("[data-tip]")) hideTip(); }, { passive: true });

  // The site's bar. Somebody on a board has more tabs than the two this page knows about (an event,
  // the admin's), and a page that dropped them would read as having signed you out. The board
  // leaves its bar in this browser (df-bar, see app.js); drawn here, each of its tabs is a link
  // back to that tab. With nothing left there — never signed in, or signed out since — the two
  // links in the page's own markup stand.
  (function bar() {
    let tabs = null;
    try { tabs = JSON.parse(localStorage.getItem("df-bar") || "null"); } catch (e) { /* private window */ }
    const nav = $("nav.tabs");
    if (!nav || !Array.isArray(tabs) || tabs.length < 2 || !tabs.some(t => t && t.id === "loadouts")) return;
    nav.innerHTML = tabs.map(t => t.id === "loadouts"
      ? `<a class="on" href="loadouts/" aria-current="page">${esc(t.label)}</a>`
      : `<a href="./?tab=${encodeURIComponent(t.id)}">${esc(t.label)}</a>`).join("");
  })();

  const host = { esc, attachTips, repaint: () => paint() };
  const pane = $("#pane-loadouts");

  function paint() {
    hideTip();
    tab.render(pane, [], host);
    const hero = tab.hero ? tab.hero([], host) : null;
    if (!hero) return;
    $("#eyebrow").textContent = hero.eyebrow;
    $("#big").innerHTML = hero.big;
    $("#bigsub").textContent = hero.sub || "";
    $("#cells").innerHTML = (hero.cells || []).map(([k, v, s, t]) =>
      `<div class="cell"${t ? ` data-tip="${esc(t)}"` : ""}><div class="v">${v}</div><div class="k">${esc(k)}</div>${s ? `<div class="s">${esc(s)}</div>` : ""}</div>`).join("");
    attachTips($("#cells"));
  }
  paint();
})();
