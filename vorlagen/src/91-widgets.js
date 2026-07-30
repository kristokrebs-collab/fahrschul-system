/* ─────────────────────────────────────────────────────────────────────────
   Bausteine. Jeder wird über ein data-Attribut verdrahtet, damit die
   Vorlagen reines HTML bleiben. Herkunft der Mechanik steht am Baustein.
   ───────────────────────────────────────────────────────────────────────── */

/* Animierte Reiter (21st.dev · chetanverma16) */
function wireTabs(scope) {
  $$('[data-tabs]', scope).forEach(box => {
    const btns = $$('[data-tab]', box);
    const pill = $('.tab-pill', box);
    const move = btn => {
      if (!pill) return;
      pill.style.width = btn.offsetWidth + 'px';
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
    };
    const pick = btn => {
      btns.forEach(b => b.setAttribute('aria-selected', String(b === btn)));
      const key = btn.dataset.tab;
      $$('[data-panel]', box).forEach(p => {
        const on = p.dataset.panel === key;
        p.hidden = !on;
        if (on) { p.classList.remove('in'); requestAnimationFrame(() => p.classList.add('in')); }
      });
      move(btn);
    };
    btns.forEach(b => b.addEventListener('click', () => pick(b)));
    const first = btns.find(b => b.getAttribute('aria-selected') === 'true') || btns[0];
    if (first) { pick(first); requestAnimationFrame(() => move(first)); }
    addEventListener('resize', () => {
      const cur = btns.find(b => b.getAttribute('aria-selected') === 'true');
      if (cur) move(cur);
    }, { passive: true });
  });
}

/* Bild-Akkordeon (21st.dev · minhxthanh) */
function wireAccordion(scope) {
  $$('[data-accordion]', scope).forEach(box => {
    const panes = $$('[data-pane]', box);
    const set = i => panes.forEach((p, k) => {
      p.classList.toggle('open', k === i);
      p.setAttribute('aria-expanded', String(k === i));
    });
    panes.forEach((p, i) => {
      p.addEventListener('click', () => set(i));
      p.addEventListener('pointerenter', () => { if (matchMedia('(hover:hover)').matches) set(i); });
      p.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set(i); } });
    });
    set(0);
  });
}

/* Geschichteter Karussell-Stapel (21st.dev · cult-ui) */
function wireCarousel(scope) {
  $$('[data-carousel]', scope).forEach(box => {
    const cards = $$('[data-slide]', box);
    let cur = 0;
    const paint = () => {
      cards.forEach((c, i) => {
        const off = (i - cur + cards.length) % cards.length;
        c.style.setProperty('--off', off);
        c.style.zIndex = String(cards.length - off);
        c.setAttribute('aria-hidden', String(off !== 0));
        c.classList.toggle('front', off === 0);
      });
      $$('[data-dot]', box).forEach((d, i) => d.setAttribute('aria-current', String(i === cur)));
      const cap = $('[data-cap]', box);
      if (cap) cap.textContent = cards[cur].dataset.slide || '';
    };
    const go = d => { cur = (cur + d + cards.length) % cards.length; paint(); };
    cards.forEach((c, i) => c.addEventListener('click', () => { cur = i; paint(); }));
    $$('[data-dot]', box).forEach((d, i) => d.addEventListener('click', () => { cur = i; paint(); }));
    const nx = $('[data-next]', box), pv = $('[data-prev]', box);
    nx && nx.addEventListener('click', () => go(1));
    pv && pv.addEventListener('click', () => go(-1));
    paint();
  });
}

/* Lupe (21st.dev · bucharitesh) */
function wireMagnifier(scope) {
  $$('[data-magnifier]', scope).forEach(box => {
    const img = $('img', box);
    const lens = document.createElement('div');
    lens.className = 'lens';
    box.appendChild(lens);
    const zoom = +(box.dataset.magnifier || 2.1);
    lens.style.backgroundImage = `url(${img.src})`;
    const move = e => {
      const r = box.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width), y = clamp((e.clientY - r.top) / r.height);
      lens.style.left = x * r.width + 'px';
      lens.style.top = y * r.height + 'px';
      lens.style.backgroundSize = `${r.width * zoom}px ${r.height * zoom}px`;
      lens.style.backgroundPosition = `${-(x * r.width * zoom - 68)}px ${-(y * r.height * zoom - 68)}px`;
    };
    box.addEventListener('pointerenter', () => box.classList.add('lensing'));
    box.addEventListener('pointerleave', () => box.classList.remove('lensing'));
    box.addEventListener('pointermove', move);
  });
}

/* Zählwerke */
function wireCounters(scope, root) {
  const els = $$('[data-count]', scope);
  if (!els.length) return;
  const fmt = (v, el) => {
    const dec = (el.dataset.dec | 0);
    return el.hasAttribute('data-sep')
      ? v.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec })
      : v.toFixed(dec);
  };
  const run = el => {
    const to = parseFloat(el.dataset.count);
    if (REDUCED) { el.textContent = fmt(to, el); return; }
    const t0 = performance.now(), dur = 1250;
    const step = now => {
      const p = clamp((now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(p < 1 ? to * e : to, el);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
  }), { root: root === window ? null : root, threshold: .4 });
  els.forEach(e => io.observe(e));
}

/* Laufband (21st.dev · waleedkibhen) — Inhalt wird verdoppelt für den Nahtlauf */
function wireMarquee(scope) {
  $$('[data-marquee]', scope).forEach(box => {
    const track = $('.mq-track', box);
    if (!track || track.dataset.doubled) return;
    track.dataset.doubled = '1';
    track.append(...Array.from(track.children).map(n => {
      const c = n.cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      return c;
    }));
  });
}

/* Verlaufs-Wähler mit Meilensteinen (21st.dev · isaiahbjork) */
function wireSelector(scope) {
  $$('[data-selector]', scope).forEach(box => {
    const dots = $$('[data-step]', box);
    const out = $('[data-selout]', box);
    const fill = $('.sel-fill', box);
    const pick = i => {
      dots.forEach((d, k) => {
        d.classList.toggle('on', k <= i);
        d.classList.toggle('cur', k === i);
        d.setAttribute('aria-current', String(k === i));
      });
      if (fill) fill.style.width = (i / Math.max(1, dots.length - 1) * 100) + '%';
      if (out) {
        const d = dots[i];
        out.querySelector('[data-selname]').textContent = d.dataset.name || '';
        out.querySelector('[data-seltext]').textContent = d.dataset.text || '';
        const meta = out.querySelector('[data-selmeta]');
        if (meta) meta.textContent = d.dataset.meta || '';
      }
      box.style.setProperty('--sel-x', (i / Math.max(1, dots.length - 1) * 100) + '%');
    };
    dots.forEach((d, i) => {
      d.addEventListener('click', () => pick(i));
      d.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(i); } });
    });
    pick(dots.findIndex(d => d.hasAttribute('data-default')) >= 0
      ? dots.findIndex(d => d.hasAttribute('data-default')) : 0);
  });
}

/* Standortkarte mit Sprechblasen (21st.dev · mapcn) */
function wireMap(scope) {
  $$('[data-map]', scope).forEach(box => {
    const pins = $$('[data-pin]', box);
    const close = () => pins.forEach(p => p.classList.remove('open'));
    pins.forEach(p => {
      /* Sitzt der Punkt in der oberen Hälfte, klappt die Blase nach unten
         auf — sonst läuft sie oben aus dem Bild. */
      const y = parseFloat(p.style.getPropertyValue('--y')) || 50;
      p.classList.toggle('below', y < 52);
      const btn = $('.pin-dot', p);
      btn && btn.addEventListener('click', e => {
        e.stopPropagation();
        const was = p.classList.contains('open');
        close();
        if (!was) p.classList.add('open');
      });
    });
    box.addEventListener('click', close);
    if (pins[0]) pins[0].classList.add('open');
  });
}

/* Anmeldefenster (21st.dev · aghasisahakyan1) — echte Prüfung, echte Zustände */
function wireSignIn(scope) {
  $$('[data-signin]', scope).forEach(form => {
    const mail = $('[name=mail]', form), code = $('[name=code]', form);
    const note = $('[data-note]', form);
    const btn = $('button[type=submit]', form);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const okMail = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(mail.value.trim());
      const okCode = /^\d{6}$/.test(code.value.trim());
      form.classList.toggle('err-mail', !okMail);
      form.classList.toggle('err-code', !okCode);
      if (!okMail) { note.textContent = 'Diese E-Mail-Adresse ist unvollständig.'; note.dataset.tone = 'bad'; mail.focus(); return; }
      if (!okCode) { note.textContent = 'Der Zugangscode besteht aus sechs Ziffern.'; note.dataset.tone = 'bad'; code.focus(); return; }
      btn.disabled = true;
      note.dataset.tone = 'wait';
      note.textContent = 'Zugang wird geprüft …';
      setTimeout(() => {
        note.dataset.tone = 'good';
        note.textContent = 'Angemeldet. Das Cockpit öffnet in der echten App.';
        btn.disabled = false;
        form.classList.add('done');
      }, 900);
    });
    [mail, code].forEach(i => i && i.addEventListener('input', () => {
      note.textContent = ''; note.removeAttribute('data-tone');
      form.classList.remove('err-mail', 'err-code');
    }));
  });
}

/* Anfrage-Assistent: mehrstufig, geprüft, mit ehrlichem Ergebnis */
const RULES = {
  B:   { name: 'Klasse B — Auto',        age: 'ab 18 · BF17 ab 17',   theo: '12 Doppelstunden Grundstoff + 2 Zusatzstoff', sf: '5 Überland · 4 Autobahn · 3 Nacht' },
  A:   { name: 'Klasse A — Motorrad',    age: 'A 24 direkt · 20 im Aufstieg', theo: '12 Doppelstunden Grundstoff + 4 Zusatzstoff', sf: '5 Überland · 4 Autobahn · 3 Nacht' },
  BE:  { name: 'Klasse BE — Anhänger',   age: 'ab 18',                theo: 'kein Grundstoff bei Vorbesitz B', sf: '3 Überland · 1 Autobahn · 1 Nacht' },
  C:   { name: 'Klasse C/CE — Lkw',      age: 'ab 21 · ab 18 mit Grundqualifikation', theo: 'Zusatzstoff je Klasse', sf: '5 Überland · 2 Autobahn · 3 Nacht' },
  D:   { name: 'Klasse D — Bus',         age: 'ab 24, abgestuft mit BKF-Qualifikation', theo: 'Zusatzstoff je Klasse', sf: 'nach Anlage 5 FahrschAusbO — abhängig von Vorbesitz' },
};

function wireWizard(scope) {
  $$('[data-wizard]', scope).forEach(wz => {
    const steps = $$('[data-step-panel]', wz);
    const dots = $$('[data-wdot]', wz);
    const next = $('[data-wnext]', wz), prev = $('[data-wprev]', wz);
    const note = $('[data-wnote]', wz);
    let at = 0;
    const state = { klasse: null, ort: null, start: null, name: '', mail: '', tel: '' };

    const show = () => {
      steps.forEach((s, i) => { s.hidden = i !== at; });
      dots.forEach((d, i) => {
        d.classList.toggle('on', i <= at);
        d.classList.toggle('cur', i === at);
      });
      prev.disabled = at === 0;
      next.textContent = at === steps.length - 2 ? 'Anfrage senden' : 'Weiter';
      next.hidden = at === steps.length - 1;
      prev.hidden = at === steps.length - 1;
      note.textContent = '';
      const bar = $('.wz-fill', wz);
      if (bar) bar.style.width = (at / (steps.length - 1) * 100) + '%';
    };

    /* Auswahlkacheln */
    $$('[data-pick]', wz).forEach(btn => btn.addEventListener('click', () => {
      const group = btn.dataset.pick;
      $$(`[data-pick="${group}"]`, wz).forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      state[group] = btn.dataset.value;
      note.textContent = '';
      if (group === 'klasse') {
        const r = RULES[btn.dataset.value];
        const box = $('[data-rules]', wz);
        if (box && r) {
          box.hidden = false;
          box.innerHTML = `<h5>${r.name}</h5>
            <dl><dt>Mindestalter</dt><dd>${r.age}</dd>
            <dt>Theorie</dt><dd>${r.theo}</dd>
            <dt>Sonderfahrten</dt><dd>${r.sf}</dd></dl>
            <p class="fine">Gesetzliche Mindestwerte nach FeV und FahrschAusbO, Stand Juli 2026 — keine Preisangabe.</p>`;
        }
      }
    }));

    const fail = msg => { note.textContent = msg; note.dataset.tone = 'bad'; return false; };
    const valid = () => {
      if (at === 0 && !state.klasse) return fail('Bitte eine Klasse wählen.');
      if (at === 1 && !state.ort) return fail('Bitte einen Standort wählen.');
      if (at === 2) {
        state.name = $('[name=wname]', wz).value.trim();
        state.mail = $('[name=wmail]', wz).value.trim();
        state.tel = $('[name=wtel]', wz).value.trim();
        if (state.name.length < 2) return fail('Bitte den vollständigen Namen angeben.');
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(state.mail)) return fail('Diese E-Mail-Adresse ist unvollständig.');
        if (state.tel && !/^[\d\s+()/-]{6,}$/.test(state.tel)) return fail('Diese Telefonnummer enthält unerlaubte Zeichen.');
      }
      return true;
    };

    next.addEventListener('click', () => {
      if (!valid()) return;
      if (at === steps.length - 2) {
        const r = RULES[state.klasse];
        const sum = $('[data-wsum]', wz);
        if (sum) {
          sum.innerHTML = `
            <p class="lead">Danke, ${state.name.split(' ')[0]} — die Anfrage liegt vor.</p>
            <dl>
              <dt>Klasse</dt><dd>${r.name}</dd>
              <dt>Standort</dt><dd>${state.ort}</dd>
              <dt>Beginn</dt><dd>${state.start || 'nächstmöglich'}</dd>
              <dt>Antwort an</dt><dd>${state.mail}</dd>
            </dl>
            <p class="fine">Demo-Ansicht: es wird nichts versendet und nichts gespeichert.
            Im Betrieb geht die Anfrage an info@fahrschule-krebs.de.</p>`;
        }
      }
      at = Math.min(at + 1, steps.length - 1);
      show();
    });
    prev.addEventListener('click', () => { at = Math.max(at - 1, 0); show(); });
    $$('input', wz).forEach(i => i.addEventListener('input', () => { note.textContent = ''; note.removeAttribute('data-tone'); }));
    const startSel = $('[name=wstart]', wz);
    startSel && startSel.addEventListener('change', () => { state.start = startSel.value; });
    show();
  });
}

/* Bento-Kacheln: die Kachel spielt beim Überfahren ihren eigenen Film */
function wireBento(scope, films) {
  $$('[data-bento-tile]', scope).forEach(tile => {
    const cv = $('canvas.film', tile);
    if (!cv) return;
    const name = cv.dataset.film;
    let film = null;
    const enter = async () => {
      if (!film) {
        film = new Film(cv, name, { mode: 'loop', fps: +(cv.dataset.fps || 3), poster: +(cv.dataset.poster || 0) });
        films.push(film);
        await film.load();
      }
      film.mode = 'loop';
      film.play();
      tile.classList.add('playing');
    };
    const leave = () => { film && film.pause(); tile.classList.remove('playing'); };
    tile.addEventListener('pointerenter', enter);
    tile.addEventListener('pointerleave', leave);
    tile.addEventListener('focusin', enter);
    tile.addEventListener('focusout', leave);
  });
}

/* Kopiert Text und bestätigt sichtbar */
function wireCopy(scope) {
  $$('[data-copy]', scope).forEach(btn => btn.addEventListener('click', async () => {
    const val = btn.dataset.copy;
    try { await navigator.clipboard.writeText(val); } catch (e) { /* Zwischenablage gesperrt */ }
    const old = btn.dataset.label || btn.textContent;
    btn.dataset.label = old;
    btn.textContent = 'kopiert';
    setTimeout(() => { btn.textContent = old; }, 1400);
  }));
}
