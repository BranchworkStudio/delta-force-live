/* Ahsarah playing cards — a season 7 limited-time event, and the first tab module.
 *
 * Everything the event needs is in this one file: its styles, its reading of the official card
 * manifest, its pane, and the chip strip it shows beside the big number while you are on another
 * tab. It registers itself in window.DF_TABS before app.js runs and the board knows nothing else
 * about it. When the season ends, delete this file, its two script tags in index.html, and the
 * "asala_cards_s7" entry in supabase/functions/poll/index.ts. Nothing else has to change.
 *
 * The one thing worth knowing about the data: HQ's count is a lifetime "ever unlocked" tally, not
 * an inventory. Selling a card in game does not decrement it, so a player can be told they own a
 * card that is no longer in their stash. That is why a card you own can be marked sold here — the
 * override is this browser's own note, and it is what makes the headline count honest.
 */
(function () {
  const EVENT = "asala_cards_s7";
  const SOLD_KEY = "df-sold-" + EVENT;
  const CAP = 14;                       // chips the header strip will print before it says "+N"

  // ---------- the official card table ----------
  // Names, suits and ranks are read from playdeltaforce.com's own manifest rather than written out
  // here, exactly as the red wall reads collections_en.js: the deck's size, its order and its
  // spelling are then the game's, not ours.
  const GLYPH = { Spades: "♠", Hearts: "♥", Clubs: "♣", Diamond: "♦", Diamonds: "♦" };
  const SHORT = { "Black Joker": "BJ", "Red Joker": "RJ", "Card Box": "BOX" };
  const raw = Array.isArray(window.basic_info_asala_pokers) ? window.basic_info_asala_pokers : [];
  // No manifest, no deck: without it there is no way to say which card an id is, and a tab that
  // cannot name what is missing is worse than no tab. The rest of the board is untouched.
  if (!raw.length) { console.warn("asala_pokers_en.js did not load; the cards tab is not registered"); return; }

  const CARDS = raw.map((p, i) => {
    const name = String((p.name && p.name.en) || "").replace(/^[^-]*-\s*/, "");
    const suit = (p.suit && p.suit.en) || null;         // the jokers and the box carry no suit
    return {
      i, id: String(p.prop_id), name,
      suit, glyph: suit ? (GLYPH[suit] || "★") : "★",
      rank: suit ? String((p.point && p.point.en) || "") : (SHORT[name] || name),
      box: /card box/i.test(name),
    };
  });
  const byId = {};
  for (const c of CARDS) byId[c.id] = c;
  const DECK = CARDS.filter(c => !c.box);               // the box is not a card you are collecting
  const BOX = CARDS.find(c => c.box) || null;
  const TOTAL = DECK.length;
  const uniq = (a) => a.filter((v, i) => a.indexOf(v) === i);
  const SUITS = uniq(DECK.filter(c => c.suit).map(c => c.suit));
  const RANKS = uniq(DECK.filter(c => c.suit).map(c => c.rank));
  const SPECIALS = DECK.filter(c => !c.suit);           // the two jokers

  // ---------- the "I sold it" override, per player, in this browser ----------
  const readSold = () => { try { return JSON.parse(localStorage.getItem(SOLD_KEY) || "{}") || {}; } catch (e) { return {}; } };
  const soldFor = (openid) => new Set((readSold()[openid] || []).map(String));
  function toggleSold(openid, id) {
    const all = readSold(), have = new Set((all[openid] || []).map(String));
    have.has(id) ? have.delete(id) : have.add(id);
    all[openid] = [...have];
    try { localStorage.setItem(SOLD_KEY, JSON.stringify(all)); } catch (e) { /* private window */ }
  }

  // ---------- reading one player's collection out of the rows ----------
  // A row exists for every card that exists, owned or not, so "missing" is answerable here and not
  // only "owned" — which is the whole reason this event is worth a page.
  function readPlayer(rows, openid) {
    const count = {};
    for (const r of rows) if (String(r.openid) === String(openid)) count[String(r.item_id)] = Number(r.owned_count) || 0;
    const sold = soldFor(openid);
    const st = {};
    for (const c of DECK) st[c.id] = !(count[c.id] > 0) ? "need" : sold.has(c.id) ? "sold" : "have";
    const list = DECK.filter(c => st[c.id] !== "have");
    const inHand = TOTAL - list.length;
    return {
      openid, any: Object.keys(count).length > 0, state: st, missing: list,
      inHand, toFind: list.length,
      hq: DECK.filter(c => count[c.id] > 0).length,
      box: BOX ? count[BOX.id] > 0 : false,
      pct: TOTAL ? Math.round(100 * inHand / TOTAL) : 0,
    };
  }
  // Whose deck this is: the player the board is focused on, else your own account, else whoever on
  // the board has rows at all. "All" is a fine focus for match data and no answer at all for a deck.
  function subject(rows, h) {
    const has = (id) => id && rows.some(r => String(r.openid) === String(id));
    if (h.focus && h.focus !== "all" && has(h.focus)) return h.focus;
    if (has(h.me)) return h.me;
    const p = h.players.find(p => has(p.openid));
    return p ? p.openid : (h.focus !== "all" ? h.focus : (h.me || null));
  }

  const bar = (pc) => `<i class="tk"><u style="width:${Math.max(0, Math.min(100, pc))}%"></u></i>`;
  const chip = (c, st, e) => `<span class="cschip ${st}"><b>${e(c.rank)}</b><span class="s">${c.glyph}</span></span>`;

  // ---------- registration ----------
  window.DF_TABS = window.DF_TABS || [];
  window.DF_TABS.push({
    id: "asala-cards",
    label: "Ahsarah cards",
    // A lifetime tally has no time window and is the same in Operations and Warfare, so the range
    // and mode pickers do not apply: they dim rather than disappear.
    filters: false,
    queries: () => ["event_collection?select=openid,item_id,owned_count&event_key=eq." + EVENT + "&limit=2000"],
    // The tab's own reads arrive as one array per query, in the order they were asked for.
    count(data, h) {
      const rows = data[0] || [], who = subject(rows, h);
      if (!who) return null;
      const me = readPlayer(rows, who);
      return me.any ? (me.toFind ? me.toFind + " to find" : "complete") : null;
    },

    // The slot beside the big number: a strip of the cards still missing while you are reading
    // match data, and the collection's own progress once you are on its page.
    aside(data, h, active) {
      const rows = data[0] || [], who = subject(rows, h);
      if (!who) return null;
      const me = readPlayer(rows, who), e = h.esc;
      if (!me.any) return null;
      if (active) {
        return `<div class="cardprog">
          <div class="cshead">Collection · <span class="go">season 7 — Ahsarah</span></div>
          <div class="cpbig">${me.inHand}<span>/${TOTAL}</span></div>
          <i class="tk big"><u style="width:${me.pct}%"></u></i>
          <div class="cpsub">${me.toFind ? me.toFind + " to find" : "complete"}${me.hq !== me.inHand ? " · HQ claims " + me.hq : ""}</div>
        </div>`;
      }
      // Past the cap the strip states the overflow instead of printing a wall of chips: early in a
      // collection almost everything is missing, and a header is not a place to list forty cards.
      const shown = me.missing.slice(0, CAP), over = me.missing.length - shown.length;
      return `<button class="cardstrip" data-goto="asala-cards">
        <div class="cshead">Ahsarah cards · <b>${me.inHand}/${TOTAL}</b> in hand · <span class="go">${me.toFind ? me.toFind + " to find" : "complete"} &rarr;</span></div>
        <div class="cschips">${shown.map(c => chip(c, me.state[c.id], e)).join("")}${over > 0 ? `<span class="cschip more">+${over}</span>` : ""}</div>
      </button>`;
    },

    render(el, data, h) {
      const rows = data[0] || [], who = subject(rows, h), e = h.esc;
      if (!who || !rows.length) {
        el.innerHTML = `<section class="band"><div class="mod-label">Ahsarah cards</div>
          <div class="note">No card collection has been read yet. It arrives with the next poll of a connected account.</div></section>`;
        return;
      }
      const me = readPlayer(rows, who), mine = String(who) === String(h.me);
      const cell = (c) => {
        const st = me.state[c.id];
        const tip = c.name + " — " + (st === "have" ? "collected" : st === "sold" ? "HQ counts it, you sold it" : "never collected");
        const inner = `<span class="rk">${e(c.rank)}</span><span class="pp">${c.glyph}</span>`;
        return mine
          ? `<button type="button" class="c ${st}" data-tip="${e(tip)}" data-card="${c.id}">${inner}</button>`
          : `<div class="c ${st}" data-tip="${e(tip)}">${inner}</div>`;
      };
      const rowFor = (cards, label, glyph) => {
        const held = cards.filter(c => me.state[c.id] === "have").length;
        return `<div class="row">${`<div class="sl">${glyph}</div>`}${cards.map(cell).join("")}` +
          (label ? `<div class="jlab">${e(label)}</div>` : "") +
          `<div class="prog"><b>${held}</b><span>/${cards.length}</span>${bar(Math.round(100 * held / cards.length))}</div></div>`;
      };
      const bySuit = (s) => RANKS.map(r => DECK.find(c => c.suit === s && c.rank === r)).filter(Boolean);

      // The squad, and the one place the deck can be pointed at someone else.
      const squad = h.players.map(p => ({ p, s: readPlayer(rows, p.openid) })).filter(x => x.s.any)
        .sort((a, b) => b.s.inHand - a.s.inHand);

      el.innerHTML = `<div class="cardpage">
        <div class="cp-l">
          <div class="mod-label">${mine ? "Your deck" : e(h.playerName(who)) + "&rsquo;s deck"}
            <span class="rest">${mine ? "click a card you own to mark it sold" : "read-only — only its owner can mark a card sold"}</span></div>
          <div class="deck">
            <div class="hdr"><div></div>${RANKS.map(r => `<div class="hc">${e(r)}</div>`).join("")}<div class="prog"></div></div>
            ${SUITS.map(s => rowFor(bySuit(s), null, GLYPH[s] || "★")).join("")}
            ${SPECIALS.length ? rowFor(SPECIALS, "Jokers", "★") : ""}
          </div>
          <div class="legend">
            <span><i style="background:rgba(29,224,140,.09);border:1px solid var(--green)"></i>Never collected</span>
            <span><i style="background:rgba(230,179,74,.10);border:1px dashed var(--amber)"></i>Sold — HQ still counts it</span>
            <span><i style="background:var(--hair-2);border:1px solid var(--hair)"></i>Collected</span>
          </div>
          ${BOX ? `<div class="boxnote">${me.box ? "Card box found — the full set can be carried." : "No card box yet. The set needs one to be carried into a match."}</div>` : ""}
        </div>
        <div class="cp-r">
          <div class="mod-label">To find <span class="tot">${me.toFind}</span>
            <span class="rest">${me.hq === me.inHand ? "HQ agrees" : "HQ claims " + me.hq + "/" + TOTAL}</span></div>
          ${me.missing.length
            ? me.missing.map(c => `<div class="fi ${me.state[c.id]}"><span class="fg">${c.glyph}</span><span class="fn">${e(c.name)}</span>${me.state[c.id] === "sold" ? "<em>sold</em>" : ""}</div>`).join("")
            : `<div class="fi"><span class="fn">Nothing. The deck is complete.</span></div>`}
          ${squad.length > 1 ? `<div class="sep"></div>
            <div class="mod-label">Squad <span class="rest">pick a deck</span></div>
            ${squad.map(x => `<button class="sq ${String(x.p.openid) === String(who) ? "on" : ""}" data-who="${e(x.p.openid)}">
              <span class="sn">${e(x.p.nickname || h.playerName(x.p.openid))}</span>${bar(x.s.pct)}
              <span class="sv">${x.s.inHand}<span>/${TOTAL}</span></span>
              <span class="sm">${x.s.toFind ? x.s.toFind + " to find" : "complete"}</span></button>`).join("")}` : ""}
        </div>
      </div>`;

      el.querySelectorAll("[data-card]").forEach(n => n.onclick = () => { toggleSold(who, n.dataset.card); h.repaint(); });
      el.querySelectorAll("[data-who]").forEach(n => n.onclick = () => h.setFocus(n.dataset.who));
      h.attachTips(el);
    },
  });

  // ---------- the event's own styles ----------
  // In this file rather than in index.html's stylesheet for the same reason as everything else here:
  // one file goes when the season does.
  const style = document.createElement("style");
  style.textContent = `
  .cardpage { display: grid; grid-template-columns: auto 1fr; }
  .cp-l { padding: 26px 32px; min-width: 0; }
  .cp-r { padding: 26px 32px; border-left: 1px solid var(--hair); min-width: 0; }
  .cp-l .mod-label .rest, .cp-r .mod-label .rest { float: right; font-weight: 600; letter-spacing: 1px; color: var(--muted); }
  .cp-r .mod-label .tot { color: var(--green); }

  /* the deck: one row per suit, one column per rank, and the whole point is that a missing card is
     the only thing on it that is lit */
  .deck { display: inline-block; }
  .deck .hdr, .deck .row { display: grid; grid-template-columns: 34px repeat(13, 62px) 108px; gap: 3px; align-items: center; }
  .deck .hc { text-align: center; font: 600 11px var(--hud); letter-spacing: 1px; color: var(--muted); padding-bottom: 6px; }
  .deck .sl { font-size: 19px; color: var(--text-2); text-align: center; }
  .deck .row { margin-bottom: 3px; }
  .deck .c { height: 62px; border: 1px solid transparent; display: grid; place-items: center; padding: 0; background: none; font: inherit; color: inherit; }
  .deck .c[data-card] { cursor: pointer; }
  .deck .c .rk { font: 700 20px var(--hud); line-height: 1; }
  .deck .c .pp { font-size: 13px; line-height: 1; margin-top: 3px; }
  .deck .c.have { background: var(--hair-2); color: #43555c; }
  .deck .c.need { background: rgba(29, 224, 140, .09); border-color: var(--green); color: var(--green); }
  .deck .c.sold { background: rgba(230, 179, 74, .10); border-color: var(--amber); border-style: dashed; color: var(--amber); }
  .deck .jlab { grid-column: 4 / 15; font: 600 11px var(--hud); letter-spacing: 1.4px; text-transform: uppercase; color: var(--muted); }
  .deck .prog { display: flex; align-items: center; gap: 6px; font: 700 15px var(--hud); padding-left: 16px; color: var(--text); }
  .deck .prog span { color: var(--muted); font-weight: 600; font-size: 12px; }
  .tk { display: block; height: 6px; background: var(--fail); flex: 1; min-width: 26px; }
  .tk u { display: block; height: 100%; background: var(--green); }
  .tk.big { height: 8px; }
  .boxnote { margin-top: 16px; font-size: 12.5px; color: var(--muted); }

  .fi { display: flex; align-items: center; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--hair-2); font-size: 14px; }
  .fi .fg { width: 20px; text-align: center; font-size: 17px; color: var(--green); }
  .fi .fn { flex: 1; color: var(--text); }
  .fi.sold .fg { color: var(--amber); }
  .fi em { font: 600 10px var(--hud); letter-spacing: 1.2px; text-transform: uppercase; color: var(--amber); border: 1px dashed var(--amber); padding: 2px 6px; font-style: normal; }
  .cp-r .sep { border-top: 1px solid var(--hair); margin: 26px 0 22px; }

  .sq { display: grid; grid-template-columns: 112px 1fr 60px 74px; gap: 12px; align-items: center; width: 100%;
        padding: 9px 0; font: 13.5px var(--body); border: 0; background: none; color: inherit; cursor: pointer; text-align: left; }
  .sq .sn { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sq:hover .sn { color: var(--text); }
  .sq.on .sn { color: var(--text); font-weight: 600; }
  .sq .sv { font: 700 14px var(--hud); text-align: right; }
  .sq .sv span { color: var(--muted); font-size: 11px; font-weight: 600; }
  .sq .sm { font: 600 11px var(--hud); letter-spacing: .6px; color: var(--muted); text-align: right; }

  /* the header strip, opposite the big number */
  .cardstrip { border: 0; background: none; padding: 0; cursor: pointer; text-align: right; font: inherit; color: inherit; max-width: 560px; display: block; }
  .cshead { font: 600 12px var(--hud); letter-spacing: 1.6px; text-transform: uppercase; color: var(--text-2); margin-bottom: 11px; white-space: nowrap; }
  .cshead b { color: var(--text); }
  .cshead .go { color: var(--green); }
  .cardstrip:hover .cshead .go { text-decoration: underline; }
  .cschips { display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end; }
  .cschip { border: 1px solid var(--green); background: rgba(29, 224, 140, .10); color: var(--green);
            padding: 5px 8px; font: 700 15px var(--hud); display: flex; gap: 2px; align-items: baseline; line-height: 1; }
  .cschip .s { font-size: 13px; }
  .cschip.more { border-color: var(--div); background: none; color: var(--muted); }
  .cschip.sold { border-color: var(--amber); border-style: dashed; background: rgba(230, 179, 74, .10); color: var(--amber); }
  .cardstrip:hover .cschip { background: rgba(29, 224, 140, .2); }
  .cardstrip:hover .cschip.sold { background: rgba(230, 179, 74, .2); }
  .cardprog { text-align: right; min-width: 300px; }
  .cpbig { font: 700 52px/1 var(--hud); font-variant-numeric: tabular-nums; margin: 6px 0 12px; }
  .cpbig span { color: var(--muted); font-size: 26px; }
  .cpsub { font: 600 12px var(--hud); letter-spacing: 1.4px; text-transform: uppercase; color: var(--muted); margin-top: 10px; }

  /* The deck is 990px of fixed grid. Below that it scrolls sideways inside its own column rather
     than pushing the page wider, and the list beside it goes underneath. */
  @media (max-width: 1360px) { .cardpage { grid-template-columns: 1fr; } .cp-r { border-left: 0; border-top: 1px solid var(--hair); } .cp-l { overflow-x: auto; } }
  @media (max-width: 900px) {
    .cp-l, .cp-r { padding: 20px; }
    /* Floated right, the hint landed on its own line anyway and read as a stray sentence. */
    .cp-l .mod-label .rest, .cp-r .mod-label .rest { float: none; display: block; margin-top: 5px; }
    .cardprog { text-align: left; min-width: 0; }
    .cschips { justify-content: flex-start; } .cardstrip { text-align: left; }
  }
  `;
  document.head.appendChild(style);
})();
