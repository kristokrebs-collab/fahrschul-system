/* glass-look.js - schaltet den Glas-Look (glass.css) fuer eine bestehende Komponente ein/aus.
   Einbinden:  <link rel="stylesheet" href="glass.css"> + <script src="glass-look.js"></script>
   Aktivieren: Knopf "Glas" unten links, oder ?look=glass in der URL, oder html.dataset.look = 'glass'.
   Erkennt Flaechen automatisch: deckende Hintergruende mit Radius >= 6 px (-> .gl) und vollflaechige Buehnen (-> .gl-stage).
   Licht (Signatur v2): ein gemeinsames Licht folgt dem Zeiger (exponentiell geglaettet = ease-out); pro Scheibe werden
   --gl-ux/--gl-uy/--gl-mx/--gl-my/--gl-near gesetzt. Reduced Motion: Licht bleibt oben links. Schleife ruht, sobald das Licht ankommt. */
(function () {
  var html = document.documentElement, KEY = 'pulse-look', done = new WeakSet(), timer = 0;
  function store(v) { try { if (v === undefined) return localStorage.getItem(KEY); localStorage.setItem(KEY, v); } catch (e) {} return null; }
  function alpha(c) { var m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 0; var p = m[1].split(/[ ,\/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; }
  function scan() {
    var vw = innerWidth, vh = innerHeight, n = 0, list = [], els = document.body.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (done.has(el) || /^(SCRIPT|STYLE|SVG|PATH|CANVAS|IMG|VIDEO|I|B|BR|HTML)$/i.test(el.tagName) || el.closest('.gl-switch,[data-gl-skip]')) continue;
      done.add(el);
      var cs = getComputedStyle(el);
      var a = alpha(cs.backgroundColor), grad = /gradient/.test(cs.backgroundImage);
      if ((a < 0.12 && !grad) || cs.display === 'none') continue;
      var r = el.getBoundingClientRect(), rad = parseFloat(cs.borderTopLeftRadius) || 0;
      if (r.width * r.height >= vw * vh * 0.45 && rad < 24) { el.classList.add('gl-stage'); continue; }
      if (r.width < 36 || r.height < 24) continue;
      if (rad < 6) continue;
      list.push(el);
    }
    list.forEach(function (el) { el.classList.add('gl'); n++; });
    if (n > 24) html.style.setProperty('--gl-blur', '12px');            // viele Flaechen: Blur sparen
    refresh();
  }

  // ---- Licht: ein Licht fuer alle Scheiben ----
  var RM = matchMedia('(prefers-reduced-motion:reduce)').matches, tracked = [], raf = 0, lastT = 0;
  var L = { x: innerWidth * 0.18, y: innerHeight * 0.08 }, T = { x: L.x, y: L.y };
  function refresh() { tracked = [].slice.call(document.querySelectorAll('.gl')).slice(0, 48); kick(); }
  function frame(t) {
    var dt = Math.min(64, t - lastT || 16); lastT = t;
    var k = 1 - Math.exp(-dt / 110); L.x += (T.x - L.x) * k; L.y += (T.y - L.y) * k;
    var rects = tracked.map(function (e) { return e.getBoundingClientRect(); });             // erst alles lesen ...
    for (var i = 0; i < tracked.length; i++) {                                              // ... dann alles schreiben
      var r = rects[i]; if (r.bottom < -200 || r.top > innerHeight + 200) continue;
      var dx = L.x - (r.left + r.width / 2), dy = L.y - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
      var gx = Math.min(Math.max(L.x, r.left), r.right), gy = Math.min(Math.max(L.y, r.top), r.bottom);
      var near = Math.max(0, 1 - Math.hypot(L.x - gx, L.y - gy) / 420), s = tracked[i].style;
      s.setProperty('--gl-ux', (dx / d).toFixed(3)); s.setProperty('--gl-uy', (dy / d).toFixed(3));
      s.setProperty('--gl-mx', (L.x - r.left).toFixed(1) + 'px'); s.setProperty('--gl-my', (L.y - r.top).toFixed(1) + 'px');
      s.setProperty('--gl-near', near.toFixed(3));
    }
    raf = (Math.abs(T.x - L.x) > 0.4 || Math.abs(T.y - L.y) > 0.4) ? requestAnimationFrame(frame) : 0;
  }
  function kick() { if (!raf && html.dataset.look === 'glass') { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
  function aim(e) { if (!RM) { T.x = e.clientX; T.y = e.clientY; kick(); } }
  addEventListener('pointermove', aim, { passive: true }); addEventListener('pointerdown', aim, { passive: true });
  addEventListener('scroll', kick, { passive: true }); addEventListener('resize', kick);
  function later() { clearTimeout(timer); timer = setTimeout(scan, 250); }
  function set(on) {
    if (on) html.dataset.look = 'glass'; else delete html.dataset.look;
    var b = document.querySelector('.gl-switch'); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    store(on ? 'glass' : 'plain'); if (on) { scan(); kick(); }
  }
  function init() {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'gl-switch'; b.textContent = 'Glas'; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { set(html.dataset.look !== 'glass'); }); document.body.appendChild(b);
    new MutationObserver(function () { if (html.dataset.look === 'glass') later(); }).observe(document.body, { childList: true, subtree: true });
    var q = /[?&]look=glass/.test(location.search), s = store();
    set(q || s === 'glass' || (s === null && html.dataset.look === 'glass'));
    setTimeout(scan, 700);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.pulseGlass = { set: set, scan: scan };
})();
