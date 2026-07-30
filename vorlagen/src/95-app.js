/* ─────────────────────────────────────────────────────────────────────────
   Die Anwendung: Register der Vorlagen, Galerie, Bühne, Verdrahtung
   ───────────────────────────────────────────────────────────────────────── */
const TEMPLATES = [
  {
    id: 'nachtfahrt', num: '01', name: 'Nachtfahrt',
    kicker: 'Scroll-Film · gepinnt',
    tagline: 'Die Flotte dreht sich, weil du scrollst.',
    desc: 'Ein gepinnter Hero, in dem eine 28-Bild-Sequenz Bild für Bild am Scrollbalken hängt. Für Marken, die mit einem einzigen Bild eröffnen wollen.',
    tags: ['Scroll-Film', 'Gepinnt', 'Kino', 'Hero-Scrub'],
    film: 'turntable', preview: 'turntable', pos: 13,
  },
  {
    id: 'fahrbahn', num: '02', name: 'Fahrbahn',
    kicker: 'Redaktionell · heller Grund',
    tagline: 'Kreide auf Asphalt, als Zeitschrift gesetzt.',
    desc: 'Der helle Gegenentwurf: gebrochenes Raster, breit laufende Archivo, Fahrbahnmarkierung als Trennlinie. Film läuft eingefasst statt vollflächig.',
    tags: ['Hell', 'Redaktionell', 'Gebrochenes Raster', 'Lupe'],
    film: 'roadday', preview: 'roadday', pos: 6,
  },
  {
    id: 'werk2', num: '03', name: 'Werk 2',
    kicker: 'Bento · industriell',
    tagline: 'Kacheln, die beim Überfahren zu laufen anfangen.',
    desc: 'Dichtes Bento-Raster für Betriebe mit vielen Angeboten. Jede Kachel trägt ihren eigenen Film und startet ihn erst, wenn sie gebraucht wird.',
    tags: ['Bento', 'Kinetische Schrift', 'Karussell', 'Akkordeon'],
    film: 'morph', preview: 'morph', pos: 11,
  },
  {
    id: 'simulator', num: '04', name: 'Simulator',
    kicker: 'WebGL · Glas',
    tagline: 'Echte Wellen hinter echtem Glas.',
    desc: 'Ein WebGL-Shader läuft live hinter Regen-Film und Glasflächen. Darüber kippt die App im Rahmen mit dem Scrollen nach vorn.',
    tags: ['WebGL', 'Glas', '3D-Kippung', 'Anmeldung'],
    film: 'rain', preview: 'rain', pos: 6,
  },
  {
    id: 'route', num: '05', name: 'Route',
    kicker: 'Scroll-Film · Kapitel',
    tagline: 'Der Hintergrund wechselt das Kapitel, nicht die Seite.',
    desc: 'Vollflächiger Filmhintergrund, der beim Scrollen zwischen Kapiteln überblendet. Mit funktionierendem Anfrage-Assistenten und Standortkarte.',
    tags: ['Scroll-Film', 'Kapitel', 'Assistent', 'Karte'],
    film: 'cabin', preview: 'cabin', pos: 4,
  },
];

const CREDITS = [
  ['Hero Scrub', 'jean.duthil13'], ['Liquid Metal Button', 'johuniq'],
  ['Interactive Image Accordion', 'minhxthanh'], ['Minimalist Hero', 'ravikatiyar162'],
  ['Animated Glowing Search Bar', 'minhxthanh'], ['Section With Mockup', 'aghasisahakyan1'],
  ['Gradient Selector Card', 'isaiahbjork'], ['Reveal Text', 'isaiahbjork'],
  ['Container Scroll Animation', 'manuarora700'], ['Shiny Button', 'designali-in'],
  ['Dock', 'ibelick'], ['Minimal Dock', 'jatin-yadav05'], ['MarkerPopup', 'mapcn'],
  ['View Magnifier', 'bucharitesh'], ['Image Auto Slider', 'waleedkibhen'],
  ['Feature Carousel', 'cult-ui'], ['Animated Tabs', 'chetanverma16'],
  ['Animated Profile Card', 'aghasisahakyan1'], ['Hero Section 2', 'meschacirung'],
  ['Sign In Flow', 'aghasisahakyan1'], ['Shader Animation', 'designali-in'],
  ['Hero (Paper Shader)', 'reuno-ui'], ['Hover Footer', 'mdafsarx'],
  ['Morphing Cursor', 'jatin-yadav05'],
];

/* ── Zustand der Bühne ───────────────────────────────────────────────────── */
const stage = $('#stage');
const rail = $('.rail');
let live = null;   // { id, works, films[], ios[], shader }

function teardown() {
  if (!live) return;
  live.films.forEach(f => f.destroy());
  live.ios.forEach(io => io && io.disconnect());
  live.works && live.works.destroy();
  live.shader && live.shader.stop();
  stage.innerHTML = '';
  live = null;
}

function mount(id) {
  teardown();
  const tpl = $('#tpl-' + id);
  if (!tpl) return;
  const meta = TEMPLATES.find(t => t.id === id);

  stage.appendChild(tpl.content.cloneNode(true));
  stage.scrollTop = 0;
  stage.dataset.tpl = id;

  const films = [], ios = [];
  const works = new ScrollWorks(stage);
  works.railFill = $('i', rail);

  /* Bilder aus dem eingebetteten Vorrat auflösen */
  $$('img[data-img]', stage).forEach(im => {
    const b = A.img[im.dataset.img];
    if (b) im.src = 'data:image/jpeg;base64,' + b;
    else im.remove();
  });

  /* Filme verdrahten */
  $$('canvas.film', stage).forEach(cv => {
    if (cv.closest('[data-bento-tile]')) return;         // die kümmern sich selbst
    const name = cv.dataset.film;
    const mode = cv.dataset.mode || 'scrub';
    const film = new Film(cv, name, {
      mode,
      fps: +(cv.dataset.fps || 2.6),
      wrap: cv.dataset.wrap !== 'off',
      poster: +(cv.dataset.poster || 0),
      ease: +(cv.dataset.ease || 0.16),
    });
    films.push(film);
    film.load().then(() => {
      if (mode === 'scrub') {
        const scene = cv.closest('[data-pin]') || cv.closest('[data-scene]') || cv.parentElement;
        const how = scene.hasAttribute('data-pin') ? 'pin' : 'through';
        works.add(w => film.setProgress(w.progressOf(scene, how)));
        works.request();
      }
    });
  });

  /* Parallaxe */
  const par = $$('[data-parallax]', stage);
  if (par.length && !REDUCED) {
    works.add(w => par.forEach(el => {
      const k = parseFloat(el.dataset.parallax) || .18;
      const p = w.progressOf(el.closest('[data-scene]') || el.parentElement, 'through') - .5;
      el.style.transform = `translate3d(0,${(-p * k * 100).toFixed(2)}px,0)`;
    }));
  }

  /* Kinetische Schrift: Breitenachse folgt dem Scrollen */
  const kin = $$('[data-kinetic]', stage);
  if (kin.length && !REDUCED) {
    works.add(w => kin.forEach(el => {
      const from = +(el.dataset.from || 62), to = +(el.dataset.to || 116);
      const p = w.progressOf(el.closest('[data-scene]') || el.parentElement, 'through');
      el.style.fontVariationSettings = `'wdth' ${(from + (to - from) * p).toFixed(1)}`;
    }));
  }

  /* Container-Kippung (Container Scroll Animation · manuarora700) */
  const tilts = $$('[data-tilt]', stage);
  if (tilts.length) {
    works.add(w => tilts.forEach(el => {
      const p = w.progressOf(el.closest('[data-scene]') || el.parentElement, 'through');
      const deg = REDUCED ? 0 : lerp(18, 0, clamp(p * 1.7));
      const sc = REDUCED ? 1 : lerp(.9, 1, clamp(p * 1.7));
      el.style.transform = `perspective(1400px) rotateX(${deg.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
    }));
  }

  /* Kapitelweise Überblendung des Hintergrunds (Route) */
  const chapters = $$('[data-chapter]', stage);
  if (chapters.length) {
    const layers = {};
    $$('[data-chapter-layer]', stage).forEach(l => { layers[l.dataset.chapterLayer] = l; });
    const io = new IntersectionObserver(es => {
      es.forEach(e => {
        if (!e.isIntersecting) return;
        const key = e.target.dataset.chapter;
        Object.entries(layers).forEach(([k, l]) => l.classList.toggle('on', k === key));
      });
    }, { root: stage, threshold: .35 });
    chapters.forEach(c => io.observe(c));
    ios.push(io);
  }

  /* Anzeige der Drehbühne: Winkel und Fahrzeug folgen dem Scrollen */
  $$('[data-hud]', stage).forEach(hud => {
    const labels = (hud.dataset.labels || '').split('|').filter(Boolean);
    const lab = $('[data-hud-label]', hud), deg = $('[data-hud-deg]', hud);
    const scene = hud.closest('[data-pin]') || hud.closest('[data-scene]');
    if (!scene) return;
    const how = scene.hasAttribute('data-pin') ? 'pin' : 'through';
    works.add(w => {
      const p = w.progressOf(scene, how);
      if (deg) deg.textContent = Math.round(p * 360) + '°';
      if (lab && labels.length) lab.textContent = labels[Math.min(labels.length - 1, Math.floor(p * labels.length))];
    });
  });

  /* Shader */
  const shCv = $('canvas[data-shader]', stage);
  const shader = shCv ? initShader(shCv) : null;

  /* Bausteine */
  ios.push(wireSplit(stage, stage));
  ios.push(wireReveal(stage, stage));
  wireTabs(stage); wireAccordion(stage); wireCarousel(stage);
  wireMagnifier(stage); wireCounters(stage, stage); wireMarquee(stage);
  wireSelector(stage); wireMap(stage); wireSignIn(stage); wireWizard(stage);
  wireBento(stage, films); wireCopy(stage);

  /* Kopfzeile ausblenden, solange nach unten gescrollt wird */
  const bar = $('.stage-bar');
  let lastY = 0;
  works.add(w => {
    const y = w.scrollTop;
    bar.classList.toggle('tucked', y > 220 && y > lastY);
    lastY = y;
  });

  $('.stage-bar .name').innerHTML = `<b>${meta.num}</b> &nbsp;${meta.name}`;
  live = { id, works, films, ios, shader };
  works.request();
}

function open(id) {
  mount(id);
  document.body.classList.add('staged');
  $('.shell').classList.add('hidden');
  stage.classList.add('live');
  rail.classList.add('on');
  $('.stage-bar').hidden = false;
  $$('.dock-item[data-go]').forEach(d => d.setAttribute('aria-current', String(d.dataset.go === id)));
  history.replaceState(null, '', '#' + id);
  stage.focus({ preventScroll: true });
}

function close() {
  stage.classList.remove('live');
  rail.classList.remove('on');
  $('.stage-bar').hidden = true;
  $('.shell').classList.remove('hidden');
  document.body.classList.remove('staged');
  $$('.dock-item[data-go]').forEach(d => d.setAttribute('aria-current', 'false'));
  history.replaceState(null, '', '#');
  setTimeout(() => { if (!stage.classList.contains('live')) teardown(); }, 520);
}

/* ── Galerie aufbauen ────────────────────────────────────────────────────── */
function buildGallery() {
  const rack = $('.rack');
  const cardFilms = [];
  TEMPLATES.forEach(t => {
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    card.dataset.go = t.id;
    card.dataset.cursor = 'öffnen';
    card.setAttribute('aria-label', `Vorlage ${t.num} ${t.name} öffnen`);
    card.innerHTML = `
      <div class="card-shot">
        <span class="badge"><b>${t.num}</b> ${t.kicker}</span>
        <canvas class="film" data-film="${t.preview}"></canvas>
      </div>
      <div class="card-body">
        <h3>${t.name}</h3>
        <p>${t.desc}</p>
        <div class="card-tags">${t.tags.map((x, i) =>
          `<span${i === 0 ? ' data-hot' : ''}>${x}</span>`).join('')}</div>
      </div>`;
    rack.appendChild(card);

    /* Vorschau läuft von selbst, sobald die Karte im Blick ist — die Galerie
       soll sich bewegen, nicht auf einen Zeiger warten. stride 3 lädt nur
       jedes dritte Bild, das hält den Speicher klein. */
    const cv = $('canvas', card);
    const film = new Film(cv, t.preview, { mode: 'loop', fps: 2.1, stride: 3, poster: t.pos });
    cardFilms.push({ card, film, loaded: false });
    card.addEventListener('pointerenter', () => { film.fps = 4.2; });
    card.addEventListener('pointerleave', () => { film.fps = 2.1; });
    card.addEventListener('click', () => open(t.id));
  });

  /* Nur sichtbare Vorschauen laufen — gescrollt heißt gestoppt */
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      const rec = cardFilms.find(r => r.card === en.target);
      if (!rec) return;
      if (en.isIntersecting) {
        if (!rec.loaded) { rec.loaded = true; rec.film.load(); }
        else rec.film.play();
      } else rec.film.pause();
    });
  }, { threshold: 0.18 });
  cardFilms.forEach(r => io.observe(r.card));

  /* Herkunftsnachweis */
  const cl = $('.credit-list');
  CREDITS.forEach(([name, who]) => {
    const a = document.createElement('span');
    a.className = 'credit';
    a.title = name + ' — 21st.dev/@' + who;
    a.textContent = name;
    cl.appendChild(a);
  });
  $$('[data-credit-count]').forEach(n => { n.textContent = CREDITS.length; });

  /* Telemetrie aus den echten Daten der Datei, nicht aus Behauptungen */
  const filmNames = Object.keys(A.films || {});
  const frameTotal = filmNames.reduce((s, k) => s + A.films[k].length, 0);
  const tele = [
    ['Vorlagen', TEMPLATES.length], ['Bausteine', CREDITS.length],
    ['Filmsequenzen', filmNames.length], ['Einzelbilder', frameTotal],
    ['Standbilder', Object.keys(A.img || {}).length], ['Fremdbibliotheken', 0],
  ];
  const tl = $('.telemetry');
  if (tl) tl.innerHTML = tele.map(([k, v]) =>
    `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  /* Laufband der Bausteinnamen */
  const bl = $('.bausteine .mq-track');
  if (bl) bl.innerHTML = CREDITS.map(([n, who]) =>
    `<span class="bs"><b>${n}</b><i>@${who}</i></span>`).join('');

  /* Suche filtert die Vorlagen */
  const inp = $('.finder input');
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    let hits = 0;
    TEMPLATES.forEach(t => {
      const card = $(`.card[data-go="${t.id}"]`);
      const hay = (t.name + ' ' + t.desc + ' ' + t.kicker + ' ' + t.tags.join(' ')).toLowerCase();
      const on = !q || hay.includes(q);
      card.hidden = !on;
      if (on) hits++;
    });
    $('[data-hits]').textContent = q ? `${hits} von ${TEMPLATES.length}` : `${TEMPLATES.length} Vorlagen`;
  });
}

function buildDock() {
  const dock = $('.dock');
  TEMPLATES.forEach(t => {
    const b = document.createElement('button');
    b.className = 'dock-item';
    b.type = 'button';
    b.dataset.go = t.id;
    b.setAttribute('aria-current', 'false');
    b.setAttribute('aria-label', t.name);
    b.innerHTML = `<span class="dock-tip">${t.num} · ${t.name}</span>`;
    const p = filmPoster(t.preview, t.id === 'nachtfahrt' ? 6 : 0);
    if (p) { p.alt = ''; b.appendChild(p); }
    b.addEventListener('click', () => open(t.id));
    dock.appendChild(b);
  });
  const sep = document.createElement('span');
  sep.className = 'dock-sep';
  dock.appendChild(sep);
  const home = document.createElement('button');
  home.className = 'dock-item home';
  home.type = 'button';
  home.setAttribute('aria-label', 'Zur Galerie');
  home.innerHTML = `<span class="dock-tip">Galerie</span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6h6v6H4zM14 6h6v4h-6zM14 14h6v4h-6zM4 16h6v2H4z"/></svg>`;
  home.addEventListener('click', close);
  dock.appendChild(home);
  wireDock(dock);
}

/* ── Start ───────────────────────────────────────────────────────────────── */
makeGrain();
initCursor();
buildGallery();
buildDock();

/* Filmebene hinter dem Galeriekopf — dieselbe Drehbühne wie Vorlage 01,
   grob abgetastet und langsam, damit sie nur atmet. */
const shellBg = $('#shell-bg');
if (shellBg) {
  const bg = new Film(shellBg, 'turntable', { mode: 'loop', fps: 1.3, stride: 2, poster: 13 });
  bg.load();
  document.addEventListener('visibilitychange', () => {
    document.hidden ? bg.pause() : bg.play();
  });
}

wireMarquee(document.querySelector('.shell'));
wireCopy(document.querySelector('.shell'));
wireSplit(document.querySelector('.shell'), window);
wireReveal(document.querySelector('.shell'), window);
$('.shell-bar [data-theme-toggle]').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = cur;
});
$('.stage-bar .back').addEventListener('click', close);

addEventListener('keydown', e => {
  if (e.key === 'Escape' && stage.classList.contains('live')) { close(); return; }
  if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) {
    e.preventDefault(); $('.finder input').focus(); return;
  }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= TEMPLATES.length && !/input|textarea/i.test(document.activeElement.tagName)) {
    open(TEMPLATES[n - 1].id);
  }
});

/* Uhr in der Kopfzeile — belegt, dass die Seite lebt */
const clock = $('[data-clock]');
if (clock) {
  const tick = () => {
    clock.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  };
  tick(); setInterval(tick, 20000);
}

/* Tiefer Einstieg über #id */
const want = location.hash.replace('#', '');
if (want && TEMPLATES.some(t => t.id === want)) open(want);
