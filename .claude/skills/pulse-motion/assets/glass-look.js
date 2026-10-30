/* glass-look.js - schaltet den Glas-Look (glass.css) fuer eine bestehende Komponente ein/aus.
   Einbinden:  <link rel="stylesheet" href="glass.css"> + <script src="glass-look.js"></script>
   Aktivieren: Knopf "Glas" unten links, oder ?look=glass in der URL, oder html.dataset.look = 'glass'.
   Erkennt Flaechen automatisch: deckende Hintergruende mit Radius >= 6 px (-> .gl) und vollflaechige Buehnen (-> .gl-stage). */
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
  }
  function later() { clearTimeout(timer); timer = setTimeout(scan, 250); }
  function set(on) {
    if (on) html.dataset.look = 'glass'; else delete html.dataset.look;
    var b = document.querySelector('.gl-switch'); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    store(on ? 'glass' : 'plain'); if (on) scan();
  }
  function init() {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'gl-switch'; b.textContent = 'Glas'; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { set(html.dataset.look !== 'glass'); }); document.body.appendChild(b);
    new MutationObserver(function () { if (html.dataset.look === 'glass') later(); }).observe(document.body, { childList: true, subtree: true });
    var q = /[?&]look=glass/.test(location.search), s = store();
    set(q || s === 'glass');
    setTimeout(scan, 700);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.pulseGlass = { set: set, scan: scan };
})();
