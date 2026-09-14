/* The header's backdrop: a contour map of ground that is not there, drifting, with its heights
   written on it the way a map writes them — in a gap in the line, lying along it.

   It replaces a repeating-radial-gradient of rings, which was one CSS declaration and cost nothing.
   This costs a canvas and a frame loop, so it is kept honest: the terrain is three octaves of value
   noise sampled on a 14px grid and traced with marching squares, at 24 frames a second, and it stops
   dead when the tab is hidden, when the header scrolls out of view, or when the visitor has asked
   for less motion — in which case it draws one still frame and never runs again. Nothing here is
   read by anything: if the canvas or the context cannot be had, the CSS rings stay exactly where
   they were and the header looks like it always did. */
(function () {
  const host = document.querySelector(".hero");
  if (!host || !window.requestAnimationFrame) return;

  const cv = document.createElement("canvas");
  cv.className = "topo";
  cv.setAttribute("aria-hidden", "true");
  const ctx = cv.getContext && cv.getContext("2d");
  if (!ctx) return;
  host.insertBefore(cv, host.firstChild);
  host.classList.add("topo-on");                 // the CSS rings step aside only once this works

  const CELL = 14;            // the grid the contours are traced on, in css px
  const STEP = 20;            // height between one contour and the next
  const INDEX = 5;            // every fifth is an index contour: brighter, and the one that is labelled
  const RELIEF = 620;         // how far the ground rises between its lowest and highest point
  const WIDE = 1 / 190;       // how wide the land is — smaller spreads it out
  const PAN_X = 5.5, PAN_Y = -1.6;   // px/s the map slides
  const RISE = 3.4;           // and the height the whole map gains per second, so the numbers climb
  const WRAP = 1000;          // …resetting here. A multiple of STEP and of STEP * INDEX, so every
                              // line survives the reset untouched and only the digits step down.
  const AX = 430, AY = 210;   // one number per patch of map this big, held in the map's own frame
  const REACH = 72;           // …and dropped when no contour passes close enough to that patch
  const FPS = 24;
  const MINOR = "rgba(255,255,255,.045)", MAJOR = "rgba(255,255,255,.085)", LABEL = "rgba(29,224,140,.22)";

  // Edges of a cell, and which pair each of the 16 corner patterns joins. 0 top, 1 right, 2 bottom,
  // 3 left; corners are TL, TR, BR, BL, one bit each. The two saddles (5 and 10) draw both lines.
  const CASES = [[], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
                 [2, 3], [0, 2], [0, 1, 2, 3], [1, 2], [3, 1], [0, 1], [3, 0], []];

  function hash(i, j) {
    let n = (i * 374761393 + j * 668265263) | 0;
    n = ((n ^ (n >> 13)) * 1274126177) | 0;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  }
  const ease = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const i = Math.floor(x), j = Math.floor(y), fx = ease(x - i), fy = ease(y - j);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  // The shape of the land, the folds in it, and the grain on those — in that order of loudness.
  function height(x, y) {
    return (noise(x * WIDE, y * WIDE) * .62
          + noise(x * WIDE * 2.3 + 31.7, y * WIDE * 2.3 + 11.3) * .27
          + noise(x * WIDE * 4.9 + 7.1, y * WIDE * 4.9 + 53.9) * .11) * RELIEF;
  }

  let W = 0, H = 0, cols = 0, rows = 0, grid = new Float32Array(0);
  function measure() {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === W && h === H) return false;
    W = w; H = h;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / CELL) + 1; rows = Math.ceil(H / CELL) + 1;
    grid = new Float32Array(cols * rows);
    return true;
  }

  // Where a contour at L crosses one edge of the cell whose top-left corner is (x, y).
  const p = [0, 0];
  function cross(e, x, y, v0, v1, v2, v3, L) {
    if (e === 0) { p[0] = x + CELL * (L - v0) / (v1 - v0); p[1] = y; }
    else if (e === 1) { p[0] = x + CELL; p[1] = y + CELL * (L - v1) / (v2 - v1); }
    else if (e === 2) { p[0] = x + CELL * (L - v3) / (v2 - v3); p[1] = y + CELL; }
    else { p[0] = x; p[1] = y + CELL * (L - v0) / (v3 - v0); }
  }

  function draw(sec) {
    const ox = sec * PAN_X, oy = sec * PAN_Y, up = (sec * RISE) % WRAP;
    for (let j = 0; j < rows; j++) {
      const wy = j * CELL + oy;
      for (let i = 0; i < cols; i++) grid[j * cols + i] = height(i * CELL + ox, wy) + up;
    }

    ctx.clearRect(0, 0, W, H);
    const minor = new Path2D(), major = new Path2D(), marks = new Map();

    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const v0 = grid[j * cols + i], v1 = grid[j * cols + i + 1];
        const v2 = grid[(j + 1) * cols + i + 1], v3 = grid[(j + 1) * cols + i];
        let lo = v0, hi = v0;
        if (v1 < lo) lo = v1; else if (v1 > hi) hi = v1;
        if (v2 < lo) lo = v2; else if (v2 > hi) hi = v2;
        if (v3 < lo) lo = v3; else if (v3 > hi) hi = v3;
        const x = i * CELL, y = j * CELL;
        for (let n = Math.ceil(lo / STEP); n * STEP < hi; n++) {
          const L = n * STEP, big = n % INDEX === 0;
          const c = CASES[(v0 >= L ? 1 : 0) | (v1 >= L ? 2 : 0) | (v2 >= L ? 4 : 0) | (v3 >= L ? 8 : 0)];
          const path = big ? major : minor;
          for (let k = 0; k < c.length; k += 2) {
            cross(c[k], x, y, v0, v1, v2, v3, L); const ax = p[0], ay = p[1];
            cross(c[k + 1], x, y, v0, v1, v2, v3, L); const bx = p[0], by = p[1];
            path.moveTo(ax, ay); path.lineTo(bx, by);
            if (!big) continue;
            // The number belongs to the map, not to the screen: the patch it marks is fixed in the
            // terrain and slides along with it, so a label stays on its own line instead of
            // flickering between whichever segment happens to be nearest this frame.
            const mx = (ax + bx) / 2, my = (ay + by) / 2, wx = mx + ox, wy = my + oy;
            const gx = Math.round(wx / AX), gy = Math.round(wy / AY);
            const dx = wx - gx * AX, dy = wy - gy * AY, d = dx * dx + dy * dy;
            const key = gx + ":" + gy, had = marks.get(key);
            if (!had || d < had.d) marks.set(key, { d, x: mx, y: my, a: Math.atan2(by - ay, bx - ax), h: L });
          }
        }
      }
    }

    ctx.lineCap = "round";
    ctx.lineWidth = 1; ctx.strokeStyle = MINOR; ctx.stroke(minor);
    ctx.lineWidth = 1.4; ctx.strokeStyle = MAJOR; ctx.stroke(major);

    ctx.font = '400 9px "Share Tech Mono", ui-monospace, monospace';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const reach = REACH * REACH;
    marks.forEach((m) => {
      if (m.d > reach) return;
      let a = m.a;                                   // never upside down
      if (a > Math.PI / 2) a -= Math.PI; else if (a <= -Math.PI / 2) a += Math.PI;
      const txt = String(Math.round(m.h));
      ctx.save();
      ctx.translate(m.x, m.y); ctx.rotate(a);
      const w = ctx.measureText(txt).width;
      ctx.globalCompositeOperation = "destination-out";   // the gap the line leaves for its number
      ctx.fillRect(-w / 2 - 4, -6, w + 8, 12);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = LABEL; ctx.fillText(txt, 0, 0);
      ctx.restore();
    });
  }

  const calm = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const still = () => !!(calm && calm.matches);
  let raf = 0, last = -1e9, t0 = 0, onScreen = true;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / FPS) return;
    last = now;
    measure();
    draw((now - t0) / 1000);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function run() {
    if (raf || document.hidden || !onScreen) return;
    if (still()) { measure(); draw(0); return; }      // one frame of terrain, and then nothing
    t0 = performance.now() - 1000 / FPS;
    raf = requestAnimationFrame(frame);
  }

  measure(); run();
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : run()));
  if (calm && calm.addEventListener) calm.addEventListener("change", () => { stop(); run(); });
  // The header is the top of the page, so this is mostly "the visitor scrolled down to the feed".
  if (window.IntersectionObserver) {
    new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; onScreen ? run() : stop(); }).observe(host);
  }
  // The header grows and shrinks as the board fills in, and again on every rotate or resize.
  if (window.ResizeObserver) new ResizeObserver(() => { if (measure() && !raf) draw(0); }).observe(host);
  else window.addEventListener("resize", () => { if (measure() && !raf) draw(0); });
})();
