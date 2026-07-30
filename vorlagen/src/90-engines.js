/* ─────────────────────────────────────────────────────────────────────────
   Motoren: Film, Scrollwerk, Auftritt, Zeiger, Dock, Shader
   Alles ohne Fremdbibliothek. Reduzierte Bewegung wird überall beachtet.
   ───────────────────────────────────────────────────────────────────────── */
const A = window.__A;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ── Filmspeicher ────────────────────────────────────────────────────────── */
const filmCache = new Map();

/* stride > 1 lädt nur jedes n-te Bild. Für Vorschauen: gleiche Bewegung,
   ein Bruchteil des entschlüsselten Speichers. Die Überblendung glättet
   die gröbere Abtastung ohnehin. */
function filmFrames(name, stride = 1) {
  const key = stride > 1 ? name + '|' + stride : name;
  if (filmCache.has(key)) return filmCache.get(key);
  let raw = (A.films && A.films[name]) || [];
  if (stride > 1) raw = raw.filter((_, i) => i % stride === 0);
  const frames = raw.map(b64 => {
    const im = new Image();
    im.decoding = 'sync';
    im.src = 'data:image/jpeg;base64,' + b64;
    return im;
  });
  const rec = {
    frames,
    ready: Promise.all(frames.map(im =>
      im.decode ? im.decode().catch(() => {}) : new Promise(r => { im.onload = im.onerror = r; })
    )),
  };
  filmCache.set(key, rec);
  return rec;
}

/* Ein einzelnes Bild einer Sequenz — für Vorschauen, ohne alles zu laden */
function filmPoster(name, i = 0) {
  const raw = (A.films && A.films[name]) || [];
  if (!raw[i]) return null;
  const im = new Image();
  im.src = 'data:image/jpeg;base64,' + raw[i];
  return im;
}

/* ── Film: JPEG-Sequenz auf Canvas, mit Überblendung zwischen den Bildern ──
   Modi: scrub (scrollgesteuert) · loop · pingpong · still                   */
class Film {
  constructor(canvas, name, opts = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.name = name;
    this.mode = opts.mode || 'scrub';
    this.fps = opts.fps || 2.6;
    this.wrap = opts.wrap !== false;      // Sequenz ist ein geschlossener Kreis
    this.f = 0;
    this.target = 0;
    this.ease = opts.ease ?? 0.16;
    this.stride = opts.stride || 1;
    this.dead = false;
    this.loaded = false;
    this.dpr = Math.min(devicePixelRatio || 1, 2);

    /* Standbild: nicht zwingend Bild 0 — manche Sequenzen starten fast schwarz */
    this.posterAt = opts.poster || 0;
    const poster = filmPoster(name, opts.poster || 0);
    if (poster) {
      poster.decode?.().then(() => { if (!this.loaded && !this.dead) { this.frames = [poster]; this.resize(); this.paint(0); } }).catch(() => {});
    }

    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize, { passive: true });
  }

  async load() {
    const rec = filmFrames(this.name, this.stride);
    await rec.ready;
    if (this.dead) return;
    this.frames = rec.frames;
    this.n = rec.frames.length;
    this.loaded = true;
    if (this.mode !== 'scrub' && !this.f) this.f = this.posterAt / this.stride;
    this.resize();
    this.paint(this.f);
    if (this.mode === 'loop' || this.mode === 'pingpong') this.play();
    return this;
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * this.dpr));
    const h = Math.max(1, Math.round(r.height * this.dpr));
    if (this.c.width !== w || this.c.height !== h) {
      this.c.width = w; this.c.height = h;
      this.paint(this.f);
    }
  }

  cover(img, alpha) {
    if (!img || !img.naturalWidth) return;
    const { ctx, c } = this;
    const s = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
  }

  /* Bruchteil-Index: zwei Bilder überblenden statt zu springen */
  paint(f) {
    const fr = this.frames;
    if (!fr || !fr.length) return;
    const n = fr.length;
    if (n === 1) { this.cover(fr[0], 1); this.ctx.globalAlpha = 1; return; }
    const base = Math.floor(f);
    const t = f - base;
    const i0 = ((base % n) + n) % n;
    const i1 = this.wrap ? (i0 + 1) % n : Math.min(i0 + 1, n - 1);
    this.cover(fr[i0], 1);
    if (t > 0.012 && i1 !== i0) this.cover(fr[i1], t);
    this.ctx.globalAlpha = 1;
  }

  /* 0..1 vom Scrollwerk */
  setProgress(p) {
    if (!this.loaded) { this.f = 0; return; }
    const span = this.wrap ? this.n : this.n - 1;
    this.target = clamp(p) * span;
    if (REDUCED) { this.f = this.target; this.paint(this.f); return; }
    if (!this.smoothing) {
      this.smoothing = true;
      const step = () => {
        if (this.dead) return;
        this.f = lerp(this.f, this.target, this.ease);
        this.paint(this.f);
        if (Math.abs(this.target - this.f) > 0.004) requestAnimationFrame(step);
        else { this.f = this.target; this.paint(this.f); this.smoothing = false; }
      };
      requestAnimationFrame(step);
    }
  }

  play() {
    if (REDUCED || this.playing || this.dead) return;
    this.playing = true;
    let last = performance.now(), dir = 1;
    const tick = now => {
      if (!this.playing || this.dead) return;
      const dt = Math.min((now - last) / 1000, 0.25); last = now;
      this.f += dir * dt * this.fps;
      if (this.mode === 'pingpong') {
        if (this.f >= this.n - 1) { this.f = this.n - 1; dir = -1; }
        else if (this.f <= 0) { this.f = 0; dir = 1; }
      } else if (this.f >= this.n) this.f -= this.n;
      this.paint(this.f);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() { this.playing = false; cancelAnimationFrame(this.raf); }

  destroy() {
    this.dead = true; this.pause();
    removeEventListener('resize', this._onResize);
  }
}

/* ── Scrollwerk ──────────────────────────────────────────────────────────
   Ein einziger rAF-Takt liest den Scrollbehälter und bedient alle Effekte:
   Scrub-Filme, Parallaxe, kinetische Schrift, gepinnte Abschnitte, Schiene. */
class ScrollWorks {
  constructor(root) {
    this.root = root;                       // Element oder window
    this.isWin = root === window;
    this.items = [];
    this.railFill = null;
    this.running = false;
    this._onScroll = () => this.request();
    this.target = this.isWin ? window : root;
    this.target.addEventListener('scroll', this._onScroll, { passive: true });
    addEventListener('resize', this._onScroll, { passive: true });
  }

  get scrollTop() { return this.isWin ? scrollY : this.root.scrollTop; }
  get viewH() { return this.isWin ? innerHeight : this.root.clientHeight; }
  get scrollMax() {
    return this.isWin
      ? Math.max(1, document.documentElement.scrollHeight - innerHeight)
      : Math.max(1, this.root.scrollHeight - this.root.clientHeight);
  }

  add(fn) { this.items.push(fn); this.request(); }

  /* Fortschritt eines Elements: 0 sobald es von unten hereinkommt,
     1 wenn es oben hinausgelaufen ist. Für gepinnte Szenen: über die Höhe. */
  progressOf(el, mode = 'through') {
    const rEl = el.getBoundingClientRect();
    const top = this.isWin ? rEl.top : rEl.top - this.root.getBoundingClientRect().top;
    const vh = this.viewH;
    if (mode === 'pin') return clamp(-top / Math.max(1, el.offsetHeight - vh));
    if (mode === 'enter') return clamp((vh - top) / vh);
    return clamp((vh - top) / (vh + rEl.height));
  }

  request() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(() => {
      this.running = false;
      for (const fn of this.items) { try { fn(this); } catch (e) { /* keep the loop alive */ } }
      if (this.railFill) this.railFill.style.width = (this.scrollTop / this.scrollMax * 100).toFixed(2) + '%';
    });
  }

  destroy() {
    this.target.removeEventListener('scroll', this._onScroll);
    removeEventListener('resize', this._onScroll);
    this.items.length = 0;
  }
}

/* ── Auftritt beim Scrollen ──────────────────────────────────────────────── */
function wireReveal(scope, root) {
  const els = $$('[data-reveal]', scope);
  if (!els.length) return null;
  if (REDUCED) { els.forEach(e => e.classList.add('in')); return null; }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }
  }, { root: root === window ? null : root, rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
  els.forEach(e => io.observe(e));
  return io;
}

/* Zeichenweiser Auftritt (Reveal Text · isaiahbjork) */
function wireSplit(scope, root) {
  const made = [];
  $$('[data-split]', scope).forEach(el => {
    if (el.dataset.splitDone) return;
    el.dataset.splitDone = '1';
    const text = el.textContent;
    el.textContent = '';
    const holder = document.createElement('span');
    holder.className = 'split';
    let i = 0;
    for (const ch of text) {
      const s = document.createElement('span');
      s.className = 'ch' + (ch === ' ' ? ' sp' : '');
      s.style.setProperty('--i', i++);
      s.textContent = ch === ' ' ? ' ' : ch;
      holder.appendChild(s);
    }
    el.appendChild(holder);
    made.push(holder);
  });
  if (!made.length) return null;
  if (REDUCED) { made.forEach(h => h.classList.add('in')); return null; }
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }
  }, { root: !root || root === window ? null : root, threshold: 0.1 });
  made.forEach(h => io.observe(h));
  return io;
}

/* ── Morphender Zeiger (Morphing Cursor · jatin-yadav05) ─────────────────── */
function initCursor() {
  if (matchMedia('(hover: none)').matches || innerWidth < 900 || REDUCED) return;
  const el = document.createElement('div');
  el.id = 'cursor';
  el.innerHTML = '<span class="label"></span>';
  document.body.appendChild(el);
  const label = el.firstElementChild;
  let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, shown = false;

  addEventListener('pointermove', e => {
    tx = e.clientX; ty = e.clientY;
    if (!shown) { shown = true; x = tx; y = ty; el.classList.add('on'); }
    const hot = e.target.closest('a,button,[data-cursor],input,summary,.card,.dock-item');
    el.classList.toggle('hot', !!hot);
    label.textContent = hot ? (hot.dataset.cursor || '') : '';
  }, { passive: true });

  addEventListener('pointerdown', () => el.classList.add('pressed'));
  addEventListener('pointerup', () => el.classList.remove('pressed'));
  addEventListener('pointerleave', () => { el.classList.remove('on'); shown = false; });

  (function follow() {
    x = lerp(x, tx, 0.22); y = lerp(y, ty, 0.22);
    el.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
    requestAnimationFrame(follow);
  })();
}

/* ── Dock: Nachbarn wachsen mit (macOS-Manier) ───────────────────────────── */
function wireDock(dock) {
  const items = $$('.dock-item', dock);
  const BASE = 42, MAX = 60;
  if (matchMedia('(hover: none)').matches) return;
  dock.addEventListener('pointermove', e => {
    const r = dock.getBoundingClientRect();
    items.forEach(it => {
      const ir = it.getBoundingClientRect();
      const d = Math.abs((ir.left + ir.width / 2) - e.clientX);
      const infl = clamp(1 - d / 150);
      it.style.setProperty('--w', (BASE + (MAX - BASE) * infl * infl).toFixed(1) + 'px');
    });
  });
  dock.addEventListener('pointerleave', () => items.forEach(it => it.style.removeProperty('--w')));
}

/* ── WebGL-Wellen (Shader Animation · designali-in) ──────────────────────── */
const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const FRAG = `precision highp float;
uniform vec2 res; uniform float t; uniform float amp;
void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*res)/min(res.x,res.y);
  float d=length(uv);
  float rings=0.;
  for(int i=0;i<3;i++){
    float fi=float(i);
    rings+=sin(d*(13.+fi*7.)-t*(1.1+fi*.35))/(2.+fi*1.6);
  }
  float glow=smoothstep(.95,.0,d);
  float band=smoothstep(.22,.0,abs(rings)*.5-.02);
  vec3 ink=vec3(.024,.027,.031);
  vec3 sig=vec3(.882,.039,.09);
  vec3 steel=vec3(.30,.35,.42);
  /* Das Rot ist Instrumentenglühen, kein Farbteppich: knapp dosiert,
     die Wellen selbst tragen ein kühles Stahlgrau. */
  vec3 col=ink+steel*(band*.16+pow(glow,3.0)*.10)*amp;
  col+=sig*(band*.07+pow(glow,4.5)*.13)*amp;
  gl_FragColor=vec4(col,1.);
}`;

function initShader(canvas) {
  const gl = canvas.getContext('webgl', {
              antialias: false, alpha: false, powerPreference: 'low-power',
              preserveDrawingBuffer: true,   // hält das Bild lesbar (Prüfung, Screenshots)
            }) || canvas.getContext('experimental-webgl');
  if (!gl) { canvas.style.background = 'radial-gradient(circle at 50% 45%, #1a0508, #060708 70%)'; return null; }

  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { canvas.style.background = 'radial-gradient(circle at 50% 45%, #1a0508, #060708 70%)'; return null; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'res');
  const uT = gl.getUniformLocation(prog, 't');
  const uAmp = gl.getUniformLocation(prog, 'amp');

  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const size = () => {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, r.width * dpr | 0);
    canvas.height = Math.max(1, r.height * dpr | 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
  };
  size();
  addEventListener('resize', size, { passive: true });

  const ctl = { amp: 1, dead: false, t0: performance.now() };
  const draw = () => {
    if (ctl.dead) return;
    gl.uniform1f(uT, (performance.now() - ctl.t0) / 1000);
    gl.uniform1f(uAmp, ctl.amp);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!REDUCED) ctl.raf = requestAnimationFrame(draw);
  };
  draw();
  ctl.stop = () => { ctl.dead = true; cancelAnimationFrame(ctl.raf); removeEventListener('resize', size); };
  return ctl;
}

/* ── Filmkorn als Datenquelle, einmal erzeugt ───────────────────────────── */
function makeGrain() {
  const n = 190, c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  const d = ctx.createImageData(n, n);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = 118 + (Math.random() * 74 | 0);
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 20 + (Math.random() * 26 | 0);
  }
  ctx.putImageData(d, 0, 0);
  document.documentElement.style.setProperty('--grain-src', `url(${c.toDataURL()})`);
}
