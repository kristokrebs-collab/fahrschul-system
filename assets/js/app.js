/* ════════════════════════════════════════════════════════════════════════
   Fahrschul-Cockpit · Schüler-PWA
   Router, Views & clientseitige Automatisierungen (Matching, Push, Express,
   Prüfungs-Ready). Reagiert live auf den gemeinsamen Store (Admin-Sync).
   ════════════════════════════════════════════════════════════════════════ */
import { store } from './store.js';
import {
  LICENSE_MATRIX, GROUPS, SLOTS, WEEKDAYS, WEEKDAYS_LONG, THEORY_TOPICS,
  computeRequirements, computeProgress, computeExamReady, canRegisterTheoryExam,
  generateProposals, gridKey,
} from './engine.js';
import { haptic, toast, confetti, fmtDate, fmtEuro, icon, esc } from './ui.js';

const app = document.getElementById('app');

/* ── App-Routing-State ──────────────────────────────────────────────────── */
let route = 'dashboard';
let onb = { step: 0, group: null, licenseClass: null, acquisitionType: null, motorradAufstieg: false, avail: {} };
let lastNotifTs = Date.now();
let countdownTimer = null;

/* ── Render-Dispatch ────────────────────────────────────────────────────── */
function render() {
  const me = store.self();
  if (!me.onboarded) { renderOnboarding(me); return; }
  app.innerHTML = `<div class="view" id="view"></div>` + tabbarHTML();
  const v = document.getElementById('view');
  ({
    dashboard: renderDashboard,
    planner:   renderPlanner,
    theory:    renderTheory,
    services:  renderServices,
    profile:   renderProfile,
  }[route] || renderDashboard)(v, me);
  bindTabbar();
  requestAnimationFrame(animateBars);
}

function navigate(r) {
  if (r === route) return;
  haptic.light();
  route = r;
  render();
}

/* ════════════════════════════════════════════════════════════════════════
   ONBOARDING  (Abschnitt 1)
   ════════════════════════════════════════════════════════════════════════ */
function renderOnboarding(me) {
  if (onb.step === 0) return renderLogin(me);
  if (onb.step === 1) return renderOnbGroup();
  if (onb.step === 2) return renderOnbClass();
  if (onb.step === 3) return renderOnbType();
  if (onb.step === 4) return renderOnbAvail();
}

function renderLogin(me) {
  app.innerHTML = `
    <div class="view stagger" style="display:flex;flex-direction:column;justify-content:center;min-height:100vh;gap:22px;">
      <div class="center" style="margin-bottom:6px;">
        <div class="brand-mark" style="width:74px;height:74px;border-radius:22px;font-size:36px;margin:0 auto 20px;">🪪</div>
        <div class="eyebrow">Fahrschul-Cockpit</div>
        <h1 class="h1" style="margin-top:8px;">Willkommen zurück.</h1>
        <p class="muted" style="margin-top:8px;line-height:1.5;">Melde dich an, um dein persönliches<br>Ausbildungs-Cockpit zu öffnen.</p>
      </div>
      <div class="card">
        <label class="dim" style="font-size:12px;font-weight:700;">E-Mail</label>
        <input id="li-mail" inputmode="email" value="${esc(me.email)}" style="width:100%;margin-top:6px;padding:14px;border-radius:12px;background:rgba(5,7,16,.6);border:1px solid var(--border-strong);color:var(--text);font-size:15px;font-family:inherit;outline:none;">
        <label class="dim" style="font-size:12px;font-weight:700;margin-top:14px;display:block;">Passwort</label>
        <input id="li-pw" type="password" value="••••••••" style="width:100%;margin-top:6px;padding:14px;border-radius:12px;background:rgba(5,7,16,.6);border:1px solid var(--border-strong);color:var(--text);font-size:15px;font-family:inherit;outline:none;">
      </div>
      <button class="btn btn-primary" id="li-go">Anmelden</button>
      <button class="btn btn-ghost" id="li-bio">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 11v2m-7-2a7 7 0 0 1 14 0M3 13a9 9 0 0 0 4 7.5M21 13a9 9 0 0 1-4 7.5M8 14a4 4 0 0 1 8 0v1a6 6 0 0 0 1.5 4"/></svg>
        Mit Face ID / Touch ID
      </button>
      <p class="dim center" style="font-size:11px;">Ende-zu-Ende-verschlüsselt · DSGVO-konform</p>
    </div>`;
  const go = () => { haptic.confirm(); onb.step = 1; renderOnboarding(store.self()); };
  document.getElementById('li-go').onclick = go;
  document.getElementById('li-bio').onclick = () => { haptic.success(); setTimeout(go, 280); };
}

function renderOnbGroup() {
  app.innerHTML = onbScaffold(1, 'Was möchtest du fahren?', 'Wähle deine Fahrzeug-Gruppe. Daraus berechnen wir deinen kompletten Lehrplan.', `
    <div class="stack stagger" style="gap:11px;">
      ${Object.entries(GROUPS).map(([k, g]) => `
        <div class="choice" data-group="${k}">
          <div class="ic">${g.icon}</div>
          <div class="ct"><div class="t">${g.label}</div><div class="s">${g.sub}</div></div>
          <div class="chk"></div>
        </div>`).join('')}
    </div>`, false);
  app.querySelectorAll('[data-group]').forEach(c => c.onclick = () => {
    haptic.light(); onb.group = c.dataset.group; onb.step = 2; renderOnboarding();
  });
  bindOnbBack(() => { onb.step = 0; renderOnboarding(store.self()); });
}

function renderOnbClass() {
  const classes = Object.entries(LICENSE_MATRIX).filter(([, c]) => c.group === onb.group);
  app.innerHTML = onbScaffold(2, 'Welche Klasse genau?', `${GROUPS[onb.group].label} · Tippe deine Zielklasse an.`, `
    <div class="stack stagger" style="gap:10px;">
      ${classes.map(([k, c]) => `
        <div class="choice" data-cls="${k}">
          <div class="ic">${c.icon}</div>
          <div class="ct"><div class="t">Klasse ${c.label}</div><div class="s">${esc(c.desc)}</div></div>
          <div class="chk"></div>
        </div>`).join('')}
    </div>`, true);
  app.querySelectorAll('[data-cls]').forEach(c => c.onclick = () => {
    haptic.light(); onb.licenseClass = c.dataset.cls; onb.step = 3; renderOnboarding();
  });
  bindOnbBack(() => { onb.step = 1; renderOnboarding(); });
}

function renderOnbType() {
  const cls = LICENSE_MATRIX[onb.licenseClass];
  const canUpgrade = !!cls.upgradeFrom;
  app.innerHTML = onbScaffold(3, 'Dein Ausbildungsweg', 'Besitzt du bereits eine Fahrerlaubnis? Das entscheidet über die Theorie-Pflicht.', `
    <div class="stack stagger" style="gap:11px;">
      <div class="choice" data-type="erst">
        <div class="ic">🌱</div>
        <div class="ct"><div class="t">Erst-Erwerb</div><div class="s">Mein erster Führerschein</div></div>
        <div class="chk"></div>
      </div>
      <div class="choice" data-type="zweit">
        <div class="ic">⬆️</div>
        <div class="ct"><div class="t">Zweit-Erwerb / Erweiterung</div><div class="s">Ich besitze bereits eine Klasse → reduzierter Grundstoff (6 statt 12)</div></div>
        <div class="chk"></div>
      </div>
      ${canUpgrade ? `
      <div class="choice" id="upg-toggle" style="margin-top:4px;">
        <div class="ic">🏍️</div>
        <div class="ct"><div class="t">Zweirad-Aufstieg von ${cls.upgradeFrom}</div><div class="s">Vorbesitz ≥ 2 Jahre → Theorie & Sonderfahrten entfallen, nur Praxisprüfung</div></div>
        <div class="chk"></div>
      </div>` : ''}
    </div>`, true);
  app.querySelectorAll('[data-type]').forEach(c => c.onclick = () => {
    haptic.confirm(); onb.acquisitionType = c.dataset.type;
    if (c.dataset.type === 'erst') onb.motorradAufstieg = false;
    finishOnboardingType();
  });
  const upg = document.getElementById('upg-toggle');
  if (upg) upg.onclick = () => {
    haptic.confirm(); onb.acquisitionType = 'zweit'; onb.motorradAufstieg = true;
    finishOnboardingType();
  };
  bindOnbBack(() => { onb.step = 2; renderOnboarding(); });
}

function finishOnboardingType() { onb.step = 4; renderOnboarding(); }

function renderOnbAvail() {
  app.innerHTML = onbScaffold(4, 'Wann hast du Zeit?', 'Tippe deine freien 90-Minuten-Slots an. Wir matchen sie automatisch mit freien Fahrlehrern & Fahrzeugen.', `
    <div class="card">
      ${plannerGridHTML(onb.avail)}
    </div>
    <p class="dim center" style="font-size:12px;margin-top:14px;">Je mehr du markierst, desto schneller findet die Engine Termine.</p>
    <button class="btn btn-primary" id="onb-finish" style="margin-top:18px;">Cockpit starten ✨</button>`, true);
  bindPlannerGrid(onb.avail, () => {});
  document.getElementById('onb-finish').onclick = () => {
    const count = Object.values(onb.avail).filter(Boolean).length;
    if (count < 2) { haptic.block(); toast({ title: 'Mind. 2 Slots wählen', msg: 'Damit die Engine matchen kann, markiere bitte ein paar Zeitfenster.', icon: '🗓️', tone: 'amber' }); return; }
    commitOnboarding();
  };
  bindOnbBack(() => { onb.step = 3; renderOnboarding(); });
}

function commitOnboarding() {
  haptic.success();
  store.update(s => {
    const me = s.students.find(x => x.id === s.sessionStudentId);
    me.licenseClass = onb.licenseClass;
    me.acquisitionType = onb.acquisitionType;
    me.motorradAufstieg = onb.motorradAufstieg;
    me.availability = { ...onb.avail };
    me.onboarded = true;
    // Realistischer Startzustand: erste Übungsstunde fest gebucht, kleiner offener Betrag
    const req = computeRequirements(me);
    me.finance.balance = 140;
    me.finance.history = [{ label: 'Grundbetrag & Lernmaterial', amount: -140, ts: Date.now() }];
    const cls = LICENSE_MATRIX[me.licenseClass];
    me.appointments.push(seedFirstLesson(s, me, cls));
    me.nextAppointment = me.appointments[0];
    store.log(`${me.name} hat sich für Klasse ${me.licenseClass} angemeldet`, '🪪');
    store.log(`${me.name} hat ${Object.values(onb.avail).filter(Boolean).length} Verfügbarkeits-Slots eingetragen`, '🗓️');
  });
  runMatching();
  route = 'dashboard';
  setTimeout(() => { confetti(70); }, 350);
  render();
}

function seedFirstLesson(s, me, cls) {
  const inst = s.instructors.find(i => i.classes.includes(cls.group)) || s.instructors[0];
  const veh = s.vehicles.find(v => v.group === cls.group) || s.vehicles[0];
  const when = Date.now() + 2 * 86400000 + 9 * 3600000; // in 2 Tagen, 09:45
  return {
    id: 'apt-seed', day: 1, slot: 2, slotTime: '09:45 – 11:15', weekday: 'Mittwoch',
    instructorId: inst.id, instructorName: inst.name, vehicleName: veh.name,
    licenseClass: me.licenseClass, ts: when, status: 'booked', special: null, type: 'Übungsstunde',
  };
}

/* ── Onboarding-Gerüst ──────────────────────────────────────────────────── */
function onbScaffold(step, title, sub, inner, back) {
  const total = 4;
  return `<div class="view">
    <div class="topbar">
      ${back ? `<button class="avatar" id="onb-back" style="border-radius:12px;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg></button>` : '<div style="width:42px"></div>'}
      <div class="row" style="gap:6px;">
        ${Array.from({ length: total }, (_, i) => `<span style="width:${i + 1 === step ? 22 : 7}px;height:7px;border-radius:99px;background:${i < step ? 'var(--accent-2)' : 'rgba(255,255,255,.12)'};transition:all .4s var(--spring);"></span>`).join('')}
      </div>
      <div style="width:42px"></div>
    </div>
    <div class="eyebrow">Schritt ${step} von ${total}</div>
    <h1 class="h1" style="margin:10px 0 8px;">${title}</h1>
    <p class="muted" style="margin-bottom:22px;line-height:1.5;">${sub}</p>
    ${inner}
  </div>`;
}
function bindOnbBack(fn) { const b = document.getElementById('onb-back'); if (b) b.onclick = () => { haptic.light(); fn(); }; }

/* ════════════════════════════════════════════════════════════════════════
   DASHBOARD  (Abschnitt 6 · Ebenen A/B/C)
   ════════════════════════════════════════════════════════════════════════ */
function renderDashboard(v, me) {
  const prog = computeProgress(me);
  const ready = computeExamReady(me);
  const req = prog.req;
  const next = nextBookedAppointment(me);
  const expressForMe = openExpressForMe(me);

  v.innerHTML = `
    ${headerHTML(me)}
    <div class="stagger">

      ${expressForMe ? expressCardHTML(expressForMe) : ''}

      <!-- Prüfungs-Ready Krone (Ebene C) -->
      ${examReadyHTML(ready)}

      <!-- Countdown (Ebene B) -->
      ${next ? `
      <div class="card" style="margin-top:14px;">
        <div class="card-row" style="margin-bottom:12px;">
          <div><div class="eyebrow">Nächste Fahrstunde</div>
            <div class="h3" style="margin-top:5px;">${esc(next.type || 'Fahrstunde')} · ${esc(next.instructorName)}</div>
            <div class="muted" style="font-size:12.5px;margin-top:2px;">${fmtDate(next.ts)} · ${esc(next.slotTime)}</div></div>
          <div style="font-size:26px;">⏱️</div>
        </div>
        <div class="countdown" id="countdown"></div>
      </div>` : `
      <div class="card" style="margin-top:14px;text-align:center;padding:26px 18px;">
        <div style="font-size:30px;">🗓️</div>
        <div class="h3" style="margin-top:8px;">Noch kein Termin gebucht</div>
        <p class="muted" style="font-size:13px;margin-top:4px;">Trage deine Zeiten ein – die Engine matcht automatisch.</p>
        <button class="btn btn-ghost btn-sm" id="go-planner" style="width:auto;margin:14px auto 0;">Zeiten eintragen</button>
      </div>`}

      <!-- Ebene A: Fortschritts-Tracker -->
      <div class="section-title"><div class="h2">Dein Fortschritt</div><span class="pill pill-blue">Klasse ${esc(me.licenseClass)}</span></div>

      <div class="card">
        <div class="row" style="gap:16px;">
          ${ringHTML(prog.theory.pct, 'var(--accent-grad)')}
          <div class="grow">
            <div class="h3">Theorieunterricht</div>
            <div class="muted" style="font-size:12.5px;margin-top:2px;">${prog.theory.done} von ${prog.theory.total} Einheiten besucht</div>
            <div style="margin-top:10px;">${barHTML(prog.theory.pct, 'var(--accent-grad)')}</div>
            ${req.theoryBase !== LICENSE_MATRIX[me.licenseClass].theoryBase ? `<div class="pill pill-green" style="margin-top:10px;">⬇︎ Grundstoff auf ${req.theoryBase} reduziert (Zweit-Erwerb)</div>` : ''}
          </div>
        </div>
      </div>

      ${specialTrackerHTML(prog)}

      <!-- Übungs- & Simulator-Zähler -->
      <div class="row" style="gap:12px;margin-top:14px;">
        <div class="card grow tap" style="margin:0;">
          <div style="font-size:22px;">🚗</div>
          <div class="h1" style="font-size:30px;margin-top:6px;">${prog.practice}</div>
          <div class="muted" style="font-size:12px;">Übungsstunden</div>
        </div>
        <div class="card grow tap" id="sim-card" style="margin:0;">
          <div class="card-row">
            <div style="font-size:22px;">🎮</div>
            <span class="pill pill-purple" style="background:rgba(168,85,247,.14);color:#D8B4FE;border:1px solid rgba(168,85,247,.3);">${prog.simulator.done}/${prog.simulator.total}</span>
          </div>
          <div class="h3" style="margin-top:8px;">Simulator</div>
          <div style="margin-top:8px;">${barHTML(prog.simulator.pct, 'linear-gradient(135deg,#C084FC,#7C3AED)')}</div>
          <div class="dim" style="font-size:11px;margin-top:8px;">Tippen zum Buchen →</div>
        </div>
      </div>

      <!-- Ebene B: Dokumente & Finanzen -->
      <div class="section-title"><div class="h2">Status & Finanzen</div></div>
      ${docsRadarHTML(me)}
      ${financeHTML(me)}

    </div>`;

  // Bindings
  bindHeader(me);
  document.getElementById('go-planner')?.addEventListener('click', () => navigate('planner'));
  document.getElementById('sim-card')?.addEventListener('click', () => openSimulatorSheet(me));
  v.querySelector('#finance-pay')?.addEventListener('click', () => payBalance(me));
  v.querySelector('#exam-ready-btn')?.addEventListener('click', () => onExamReadyTap(me, computeExamReady(me)));
  v.querySelector('#theory-exam-btn')?.addEventListener('click', () => registerTheoryExam(me));
  bindExpressCard(me, expressForMe);
  startCountdown(next);
}

function headerHTML(me) {
  return `<div class="topbar">
    <div class="brand">
      <div class="brand-mark">🪪</div>
      <div><div class="brand-title">Cockpit</div><div class="brand-sub">Hallo, ${esc(me.name.split(' ')[0])} 👋</div></div>
    </div>
    <div class="avatar" id="hdr-avatar">${esc(me.name.split(' ').map(n => n[0]).join('').slice(0, 2))}<span class="dot"></span></div>
  </div>`;
}
function bindHeader(me) { document.getElementById('hdr-avatar')?.addEventListener('click', () => navigate('profile')); }

function ringHTML(pct, grad) {
  const r = 30, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  return `<svg width="76" height="76" class="ring" style="flex-shrink:0;">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#818CF8"/><stop offset="100%" stop-color="#4F46E5"/></linearGradient></defs>
    <circle class="ring-bg" cx="38" cy="38" r="${r}" stroke-width="7"/>
    <circle class="ring-fg" cx="38" cy="38" r="${r}" stroke-width="7" stroke="url(#${gid})" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${off}"/>
    <text x="38" y="38" transform="rotate(90 38 38)" text-anchor="middle" dy="5" fill="#fff" font-size="16" font-weight="800">${pct}%</text>
  </svg>`;
}
function barHTML(pct, grad, klass = '') {
  return `<div class="bar ${klass}"><span data-w="${pct}" style="background:${grad};"></span></div>`;
}

function specialTrackerHTML(prog) {
  if (!prog.req.hasSpecial) {
    return `<div class="card" style="margin-top:14px;text-align:center;padding:22px;">
      <div style="font-size:24px;">✅</div>
      <div class="h3" style="margin-top:6px;">Keine Pflicht-Sonderfahrten</div>
      <p class="muted" style="font-size:12.5px;margin-top:4px;">${esc(prog.req.notes[0] || 'Für deine Klasse sind keine gesetzlichen Sonderfahrten vorgeschrieben.')}</p>
    </div>`;
  }
  const locked = !prog.specialUnlocked;
  const item = (emoji, label, t) => `
    <div class="spread" style="margin-bottom:14px;">
      <div class="row" style="gap:10px;"><span style="font-size:18px;">${emoji}</span><span class="h3">${label}</span></div>
      <span class="mono soft" style="font-weight:800;">${t.done} / ${t.total}</span>
    </div>
    ${barHTML(t.pct, t.done >= t.total ? 'var(--emerald-grad)' : 'var(--accent-grad)')}
    <div style="height:14px;"></div>`;
  return `<div class="card locked" style="margin-top:14px;">
    <div class="card-row" style="margin-bottom:16px;"><div class="h3">🛣️ Sonderfahrten-Live-Tracker</div>
      ${locked ? '<span class="pill pill-lock">🔒 Grundausbildung läuft</span>' : '<span class="pill pill-green">Freigeschaltet</span>'}</div>
    ${prog.req.special.ueberland ? item('🏔️', 'Überland', prog.ueberland) : ''}
    ${prog.req.special.autobahn ? item('🛣️', 'Autobahn', prog.autobahn) : ''}
    ${prog.req.special.nacht ? item('🌌', 'Nacht', prog.nacht) : ''}
    ${locked ? `<div class="locked-veil"><div style="font-size:24px;">🔒</div><div>Sonderfahrten werden erst angezeigt,<br>sobald die Grundausbildung abgeschlossen ist.</div></div>` : ''}
  </div>`;
}

function docsRadarHTML(me) {
  const d = me.documents;
  const row = (label, st) => {
    const map = { verified: ['✅ Verifiziert', 'pill-green'], submitted: ['📤 Eingereicht', 'pill-blue'], pending: ['⚠️ Ausstehend', 'pill-amber'] };
    const [txt, cls] = map[st] || map.pending;
    return `<div class="spread" style="padding:11px 0;"><span class="soft" style="font-weight:600;">${label}</span><span class="pill ${cls}">${txt}</span></div>`;
  };
  return `<div class="card">
    <div class="h3" style="margin-bottom:4px;">📋 Sehtest- & Dokumenten-Radar</div>
    ${row('Sehtest', d.sehtest)}<div class="divider" style="margin:0;"></div>
    ${row('Erste-Hilfe-Kurs', d.ersteHilfe)}<div class="divider" style="margin:0;"></div>
    ${row('Biometrisches Passbild', d.passbild)}
  </div>`;
}

function financeHTML(me) {
  const bal = me.finance.balance || 0;
  const ok = bal <= 0;
  return `<div class="card" style="${ok ? '' : 'border-color:rgba(245,158,11,.3);'}">
    <div class="card-row">
      <div><div class="eyebrow" style="color:${ok ? 'var(--emerald)' : 'var(--amber)'};">${ok ? 'Konto ausgeglichen' : 'Offener Betrag'}</div>
        <div class="h1" style="font-size:28px;margin-top:4px;">${fmtEuro(Math.abs(bal))}</div></div>
      <div style="font-size:26px;">${ok ? '💚' : '💳'}</div>
    </div>
    ${!ok ? `<button class="btn btn-primary" id="finance-pay" style="margin-top:14px;">Jetzt begleichen</button>
      <p class="dim center" style="font-size:11px;margin-top:10px;">⚠️ Bei offenem Betrag greift die automatische Buchungssperre.</p>` :
      `<p class="muted" style="font-size:12.5px;margin-top:8px;">Alle Zahlungen vollständig – keine Buchungssperre aktiv.</p>`}
  </div>`;
}

function examReadyHTML(ready) {
  const done = ready.checks.filter(c => c.ok).length;
  if (ready.ready) {
    return `<button class="card" id="exam-ready-btn" style="width:100%;text-align:left;cursor:pointer;border:1px solid rgba(16,185,129,.4);background:linear-gradient(150deg,rgba(6,46,33,.7),rgba(19,25,49,.6));box-shadow:0 18px 50px rgba(16,185,129,.3);">
      <div class="card-row"><div><div class="eyebrow" style="color:var(--emerald);">👑 Prüfungs-Ready</div>
        <div class="h2" style="margin-top:6px;color:var(--emerald);">Du bist startklar!</div>
        <p class="muted" style="font-size:12.5px;margin-top:4px;">Alle 5 Bedingungen erfüllt. Antippen für Details.</p></div>
        <div style="font-size:34px;">✨</div></div></button>`;
  }
  return `<button class="card" id="exam-ready-btn" style="width:100%;text-align:left;cursor:pointer;margin-top:0;">
    <div class="card-row" style="margin-bottom:12px;"><div><div class="eyebrow">👑 Prüfungs-Ready Status</div>
      <div class="h3" style="margin-top:5px;">${done} von 5 Bedingungen erfüllt</div></div>
      <div style="font-size:26px;opacity:.5;">🔒</div></div>
    <div class="row" style="gap:6px;">${ready.checks.map(c => `<span style="flex:1;height:6px;border-radius:99px;background:${c.ok ? 'var(--emerald)' : 'rgba(255,255,255,.1)'};box-shadow:${c.ok ? '0 0 8px var(--emerald)' : 'none'};transition:all .5s;"></span>`).join('')}</div>
    <p class="dim" style="font-size:11.5px;margin-top:10px;">Antippen, um die offenen Schritte zu sehen.</p></button>`;
}

/* ── Countdown-Widget ───────────────────────────────────────────────────── */
function startCountdown(next) {
  if (countdownTimer) clearInterval(countdownTimer);
  const elc = document.getElementById('countdown');
  if (!next || !elc) return;
  const tick = () => {
    const el2 = document.getElementById('countdown');
    if (!el2) { clearInterval(countdownTimer); return; }
    let diff = Math.max(0, next.ts - Date.now());
    const d = Math.floor(diff / 86400000); diff -= d * 86400000;
    const h = Math.floor(diff / 3600000); diff -= h * 3600000;
    const m = Math.floor(diff / 60000); diff -= m * 60000;
    const s = Math.floor(diff / 1000);
    const unit = (n, l) => `<div class="cd-unit"><div class="cd-num">${String(n).padStart(2, '0')}</div><div class="cd-lab">${l}</div></div>`;
    el2.innerHTML = unit(d, 'Tage') + unit(h, 'Std') + unit(m, 'Min') + unit(s, 'Sek');
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

/* ════════════════════════════════════════════════════════════════════════
   VERFÜGBARKEITS-PLANER  (Abschnitt 4A)
   ════════════════════════════════════════════════════════════════════════ */
function renderPlanner(v, me) {
  const draft = { ...me.availability };
  v.innerHTML = `
    <div class="topbar"><div><div class="eyebrow">Zeit-Matching</div><h1 class="h1" style="margin-top:6px;">Verfügbarkeit</h1></div>
      <div class="avatar" style="border-radius:12px;">🗓️</div></div>
    <p class="muted" style="margin-bottom:18px;line-height:1.5;">Tippe deine freien 90-Minuten-Slots an. Die Engine matcht sie laufend mit Fahrlehrer- & Fahrzeug-Kalendern.</p>
    <div class="card">${plannerGridHTML(draft)}</div>
    <div class="card" style="margin-top:14px;" id="match-preview"></div>
    <button class="btn btn-primary" id="planner-save" style="margin-top:16px;">Verfügbarkeit speichern</button>
    <p class="dim center" style="font-size:11.5px;margin-top:12px;">Änderungen sind im Admin-Dashboard sofort sichtbar (Echtzeit-Einsicht).</p>`;
  bindPlannerGrid(draft, () => updateMatchPreview(me, draft));
  updateMatchPreview(me, draft);
  document.getElementById('planner-save').onclick = () => {
    haptic.confirm();
    store.update(s => {
      const m = s.students.find(x => x.id === s.sessionStudentId);
      m.availability = { ...draft };
      store.log(`${m.name} hat die Verfügbarkeit aktualisiert (${Object.values(draft).filter(Boolean).length} Slots)`, '🗓️');
    });
    const n = runMatching();
    toast({ title: 'Verfügbarkeit gespeichert', msg: n > 0 ? `${n} Terminvorschläge automatisch generiert & ans Büro gesendet.` : 'Engine sucht nach passenden Fahrlehrer-Slots.', icon: '✅', tone: 'green' });
  };
}

function plannerGridHTML(grid) {
  let html = `<div class="grid-planner"><div></div>${WEEKDAYS.map(d => `<div class="grid-head">${d}</div>`).join('')}`;
  for (const slot of SLOTS) {
    html += `<div class="grid-rowlabel" title="${slot.time}">${slot.start}</div>`;
    for (let d = 0; d < 6; d++) {
      const k = gridKey(d, slot.id);
      html += `<div class="slot-cell ${grid[k] ? 'on' : ''}" data-key="${k}"></div>`;
    }
  }
  html += `</div>
    <div class="row" style="gap:14px;margin-top:14px;justify-content:center;flex-wrap:wrap;">
      ${SLOTS.map(s => `<span class="dim" style="font-size:10px;">${s.start}·${s.label}</span>`).join('')}
    </div>`;
  return html;
}
function bindPlannerGrid(grid, onChange) {
  app.querySelectorAll('.slot-cell').forEach(cell => {
    cell.onclick = () => {
      const k = cell.dataset.key;
      grid[k] = !grid[k];
      cell.classList.toggle('on');
      grid[k] ? haptic.light() : haptic.light();
      onChange();
    };
  });
}
function updateMatchPreview(me, draft) {
  const box = document.getElementById('match-preview');
  if (!box) return;
  const s = store.get();
  const tmp = { ...me, availability: draft };
  const props = generateProposals(tmp, s.instructors, s.vehicles);
  const cnt = Object.values(draft).filter(Boolean).length;
  box.innerHTML = `
    <div class="card-row" style="margin-bottom:10px;"><div class="h3">⚡ Live-Match-Vorschau</div><span class="pill ${props.length ? 'pill-green' : 'pill-gray'}">${props.length} mögliche Termine</span></div>
    ${props.length ? props.slice(0, 3).map(p => `
      <div class="spread" style="padding:9px 0;border-top:1px solid var(--border);">
        <div class="row" style="gap:10px;"><span style="font-size:16px;">🚗</span>
          <div><div class="soft" style="font-weight:600;font-size:13px;">${p.weekday} · ${esc(p.slotTime)}</div>
            <div class="dim" style="font-size:11px;">${esc(p.instructorName)} · ${esc(p.vehicleName)}</div></div></div>
        <span class="pill pill-blue">Match</span></div>`).join('') :
      `<p class="muted" style="font-size:12.5px;">${cnt < 1 ? 'Markiere Slots, um Matches zu sehen.' : 'Aktuell keine Überschneidung mit freien Fahrlehrern – probiere andere Slots.'}</p>`}`;
}

/* ════════════════════════════════════════════════════════════════════════
   THEORIE-BUCHUNG  (Abschnitt 5 · Thema X + Morphing)
   ════════════════════════════════════════════════════════════════════════ */
function renderTheory(v, me) {
  const s = store.get();
  const group = LICENSE_MATRIX[me.licenseClass].group;
  const prog = computeProgress(me);
  const attended = new Set((me.progress.theoryAttended || []).map(String));
  const grundDone = (me.progress.theoryAttended || []).filter(nr => String(nr).match(/^\d+$/)).length;
  const grundSoll = prog.req.theoryBase;

  const sessions = s.theorySessions.slice().sort((a, b) => a.date - b.date);

  v.innerHTML = `
    <div class="topbar"><div><div class="eyebrow">Thema X Buchung</div><h1 class="h1" style="margin-top:6px;">Theorie</h1></div>
      <div class="avatar" style="border-radius:12px;">📚</div></div>

    <div class="card" style="margin-bottom:18px;">
      <div class="spread" style="margin-bottom:10px;"><span class="h3">Grundstoff-Soll</span><span class="mono soft" style="font-weight:800;">${grundDone} / ${grundSoll}</span></div>
      ${barHTML(Math.min(100, Math.round(grundDone / grundSoll * 100)), 'var(--accent-grad)')}
      ${grundDone >= grundSoll ? `<div class="pill pill-green" style="margin-top:12px;">✅ Soll erfüllt – weitere Buchungen nur als freiwillige Wiederholung</div>` : ''}
    </div>

    <div class="eyebrow" style="margin:4px 2px 12px;">Kommende Unterrichtstermine</div>
    <div class="stack stagger" style="gap:11px;" id="theory-list">
      ${sessions.map(se => theoryTileHTML(se, me, group, attended, grundDone >= grundSoll)).join('')}
    </div>`;

  v.querySelectorAll('[data-session]').forEach(tile => {
    tile.onclick = () => onTheoryTileTap(tile, tile.dataset.session, me);
  });
}

function theoryTileHTML(se, me, group, attended, sollMet) {
  const classLocked = se.group !== 'all' && se.group !== group;
  const alreadyDone = attended.has(String(se.topicNr));
  const full = se.booked >= se.capacity;
  const alreadyBooked = (se.bookedBy || []).includes(me.id);
  let badge = '';
  if (classLocked) badge = '<span class="pill pill-lock">🔒 Andere Klasse</span>';
  else if (alreadyDone) badge = '<span class="pill pill-green">✓ Bereits erledigt</span>';
  else if (alreadyBooked) badge = '<span class="pill pill-blue">Gebucht</span>';
  else if (full) badge = '<span class="pill pill-red">Ausgebucht</span>';
  else if (se.kind === 'grund' && sollMet) badge = '<span class="pill pill-amber">Freiwillig</span>';
  else badge = `<span class="pill pill-gray">${se.capacity - se.booked} Plätze frei</span>`;

  const cls = 'theory-tile' + (alreadyDone ? ' done' : '') + (classLocked ? ' locked-topic' : '');
  return `<div class="${cls}" data-session="${se.id}" data-locked="${classLocked}" data-done="${alreadyDone}">
    <div class="card-row" style="margin-bottom:8px;">
      <div class="row" style="gap:8px;"><span class="pill ${se.kind === 'zusatz' ? 'pill-purple' : 'pill-blue'}" style="${se.kind === 'zusatz' ? 'background:rgba(168,85,247,.14);color:#D8B4FE;border:1px solid rgba(168,85,247,.3);' : ''}">Thema ${esc(String(se.topicNr))}</span>${badge}</div>
    </div>
    <div class="h3">${esc(se.title)}</div>
    <div class="muted" style="font-size:12.5px;margin-top:6px;">📅 ${fmtDate(se.date)} · ${esc(se.time)} Uhr · ${esc(se.room)}</div>
  </div>`;
}

/* ── Morphing-Transition: Kachel → Vollbild-Buchung (Abschnitt 5B) ──────── */
let morphState = null;
function onTheoryTileTap(tile, sessionId, me) {
  const s = store.get();
  const se = s.theorySessions.find(x => x.id === sessionId);
  const group = LICENSE_MATRIX[me.licenseClass].group;
  const classLocked = se.group !== 'all' && se.group !== group;
  const alreadyDone = (me.progress.theoryAttended || []).map(String).includes(String(se.topicNr));

  if (classLocked) { haptic.block(); shake(tile); toast({ title: 'Thema gesperrt', msg: 'Dieses Thema ist für deine Führerscheinklasse nicht relevant.', icon: '🔒', tone: 'red' }); return; }
  if (alreadyDone) { haptic.block(); shake(tile); toast({ title: 'Bereits absolviert', msg: 'Dieses Thema steht schon als „besucht" in deiner Akte.', icon: '✓', tone: 'amber' }); return; }
  if ((se.bookedBy || []).includes(me.id)) { haptic.light(); toast({ title: 'Schon gebucht', msg: 'Dein Platz für dieses Thema ist reserviert.', icon: '🎟️', tone: 'blue' }); return; }

  haptic.light();
  morphOpen(tile, se, me);
}

function morphOpen(tile, se, me) {
  const rect = tile.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.className = 'morph-overlay';
  const clone = document.createElement('div');
  clone.className = 'morph-clone';
  clone.style.top = rect.top + 'px'; clone.style.left = rect.left + 'px';
  clone.style.width = rect.width + 'px'; clone.style.height = rect.height + 'px';
  clone.innerHTML = bookingContentHTML(se, me);
  document.body.appendChild(overlay);
  document.body.appendChild(clone);
  requestAnimationFrame(() => {
    overlay.classList.add('show');
    clone.style.top = '0px'; clone.style.left = '0px';
    clone.style.width = '100vw'; clone.style.height = '100vh';
    clone.style.borderRadius = '0px';
  });
  morphState = { overlay, clone, rect, se };
  setTimeout(() => bindBookingContent(clone, se, me), 60);
}

function bookingContentHTML(se, me) {
  const remaining = se.capacity - se.booked;
  return `<div class="view" style="min-height:100vh;">
    <div class="topbar"><button class="avatar" id="morph-close" style="border-radius:12px;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      <span class="pill ${se.kind === 'zusatz' ? 'pill-purple' : 'pill-blue'}" style="${se.kind === 'zusatz' ? 'background:rgba(168,85,247,.14);color:#D8B4FE;border:1px solid rgba(168,85,247,.3);' : ''}">Thema ${esc(String(se.topicNr))}</span>
      <div style="width:42px"></div></div>
    <div class="eyebrow" style="margin-top:14px;">Theorie-Doppelstunde · 90 Min</div>
    <h1 class="h1" style="margin:10px 0 18px;line-height:1.15;">${esc(se.title)}</h1>
    <div class="card stagger">
      <div class="spread" style="padding:8px 0;"><span class="muted">Datum</span><span class="soft" style="font-weight:700;">${fmtDate(se.date)}</span></div><div class="divider" style="margin:6px 0;"></div>
      <div class="spread" style="padding:8px 0;"><span class="muted">Uhrzeit</span><span class="soft" style="font-weight:700;">${esc(se.time)} Uhr</span></div><div class="divider" style="margin:6px 0;"></div>
      <div class="spread" style="padding:8px 0;"><span class="muted">Raum</span><span class="soft" style="font-weight:700;">${esc(se.room)}</span></div><div class="divider" style="margin:6px 0;"></div>
      <div class="spread" style="padding:8px 0;"><span class="muted">Freie Plätze</span><span class="pill ${remaining > 3 ? 'pill-green' : 'pill-amber'}">${remaining} / ${se.capacity}</span></div>
    </div>
    <div class="card" style="margin-top:14px;background:rgba(99,102,241,.08);border-color:rgba(99,102,241,.25);">
      <div class="row" style="gap:10px;"><span style="font-size:20px;">🛡️</span><p class="soft" style="font-size:12.5px;line-height:1.5;">Validiert gegen Raumbelegung, deine Klasse <b>${esc(me.licenseClass)}</b> und deinen Lehrplan-Stand.</p></div>
    </div>
    <button class="btn btn-primary" id="morph-book" style="margin-top:20px;">Platz verbindlich reservieren</button>
    <p class="dim center" style="font-size:11px;margin-top:10px;">Kostenfrei stornierbar bis 24 Std. vorher.</p>
  </div>`;
}

function bindBookingContent(clone, se, me) {
  clone.querySelector('#morph-close').onclick = morphClose;
  clone.querySelector('#morph-book').onclick = () => {
    haptic.confirm();
    store.update(s => {
      const sess = s.theorySessions.find(x => x.id === se.id);
      if (!(sess.bookedBy || []).includes(me.id)) { sess.booked++; sess.bookedBy = sess.bookedBy || []; sess.bookedBy.push(me.id); }
      const m = s.students.find(x => x.id === s.sessionStudentId);
      // gilt als besucht zur Pflichtwertung
      if (!m.progress.theoryAttended.map(String).includes(String(se.topicNr))) m.progress.theoryAttended.push(se.topicNr);
      store.log(`${m.name} hat Theorie „Thema ${se.topicNr}" gebucht`, '📚');
    });
    const btn = clone.querySelector('#morph-book');
    btn.classList.replace('btn-primary', 'btn-emerald');
    btn.innerHTML = '✓ Platz gesichert';
    confetti(40);
    setTimeout(() => { morphClose(); toast({ title: 'Theorie gebucht', msg: `Thema ${se.topicNr} ist reserviert und zählt zu deinem Soll.`, icon: '📚', tone: 'green' }); }, 850);
  };
}

function morphClose() {
  if (!morphState) return;
  const { overlay, clone, rect } = morphState;
  haptic.light();
  clone.style.top = rect.top + 'px'; clone.style.left = rect.left + 'px';
  clone.style.width = rect.width + 'px'; clone.style.height = rect.height + 'px';
  clone.style.borderRadius = '16px';
  overlay.classList.remove('show');
  setTimeout(() => { overlay.remove(); clone.remove(); morphState = null; render(); }, 480);
}

function shake(elm) {
  elm.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 320, easing: 'ease-in-out' });
}

/* ════════════════════════════════════════════════════════════════════════
   SIMULATOR-BUCHUNG (Sheet)
   ════════════════════════════════════════════════════════════════════════ */
function openSimulatorSheet(me) {
  const prog = computeProgress(me);
  const slotsHTML = SLOTS.map((sl, i) => `<button class="choice" data-sim="${sl.id}" style="padding:13px;"><div class="ic" style="width:40px;height:40px;font-size:18px;">🎮</div><div class="ct"><div class="t" style="font-size:14px;">${sl.label}</div><div class="s">${sl.time}</div></div><div class="chk"></div></button>`).join('');
  openSheet(`
    <div class="eyebrow">Simulator-Ausbildung</div>
    <h2 class="h2" style="margin:8px 0 4px;">Eigenbuchung im 90-Min-Raster</h2>
    <p class="muted" style="font-size:13px;margin-bottom:8px;">Fortschritt: ${prog.simulator.done} von ${prog.simulator.total} empfohlenen Einheiten.</p>
    <div style="margin:10px 0;">${barHTML(prog.simulator.pct, 'linear-gradient(135deg,#C084FC,#7C3AED)')}</div>
    <div class="stack" style="gap:9px;margin-top:14px;">${slotsHTML}</div>`);
  document.querySelectorAll('[data-sim]').forEach(b => b.onclick = () => {
    haptic.confirm();
    store.update(s => { const m = s.students.find(x => x.id === s.sessionStudentId); m.progress.simulator = Math.min(prog.simulator.total, (m.progress.simulator || 0) + 1); store.log(`${m.name} hat eine Simulator-Einheit gebucht`, '🎮'); });
    closeSheet(); confetti(30);
    toast({ title: 'Simulator gebucht', msg: 'Deine Einheit wurde dem Tracker gutgeschrieben.', icon: '🎮', tone: 'purple' });
  });
}

/* ════════════════════════════════════════════════════════════════════════
   LEISTUNGS-PORTFOLIO  (Abschnitt 3 & F)
   ════════════════════════════════════════════════════════════════════════ */
function renderServices(v, me) {
  const items = [
    ['🚗', 'Führerscheinklassen', 'Zweirad, PKW, LKW & Bus – die komplette Palette.', 'classes'],
    ['♿', 'Handicap-Ausbildung', 'Angepasste Fahrzeuge für eingeschränkte Fahrschüler.', null],
    ['🚛', 'Berufskraftfahrer (BKrFQG)', 'Grundqualifikation & Weiterbildungsmodule.', null],
    ['🚜', 'Staplerschein (DGUV)', 'Flurförderzeug-Schulung nach DGUV 308-001.', 'forklift'],
    ['🛑', 'ASF-Seminar', 'Aufbauseminar für Fahranfänger in der Probezeit.', null],
    ['🍷', 'FES-Seminar', 'Fahreignungsseminar zum Punkteabbau (Flensburg).', null],
    ['☣️', 'Gefahrgut ADR', 'Spezialschulungen für Gefahrgut-Transporte.', null],
    ['🎮', 'Simulator-Ausbildung', 'Gefahrlose erste Schritte im High-End-Simulator.', 'sim'],
  ];
  v.innerHTML = `
    <div class="topbar"><div><div class="eyebrow">Portfolio</div><h1 class="h1" style="margin-top:6px;">Leistungen</h1></div>
      <div class="avatar" style="border-radius:12px;">✦</div></div>
    <p class="muted" style="margin-bottom:18px;line-height:1.5;">Unser vollständiges Ausbildungsangebot – tippe für Details.</p>
    <div class="stack stagger" style="gap:11px;">
      ${items.map(([ic, t, s, key]) => `
        <div class="card tap" data-svc="${key || ''}" style="margin:0;">
          <div class="row" style="gap:14px;"><div class="ic" style="width:48px;height:48px;border-radius:14px;background:rgba(255,255,255,.05);display:grid;place-items:center;font-size:24px;flex-shrink:0;">${ic}</div>
            <div class="grow"><div class="h3">${t}</div><div class="muted" style="font-size:12.5px;margin-top:2px;">${s}</div></div>
            <span style="opacity:.4;width:18px;">${icon.chevron}</span></div>
        </div>`).join('')}
    </div>`;
  v.querySelector('[data-svc="forklift"]')?.addEventListener('click', () => openForkliftSheet(me));
  v.querySelector('[data-svc="sim"]')?.addEventListener('click', () => openSimulatorSheet(me));
  v.querySelector('[data-svc="classes"]')?.addEventListener('click', () => openClassMatrixSheet());
}

function openForkliftSheet(me) {
  const f = me.forklift || {};
  const cert = f.theoryPassed && f.practicalPassed;
  openSheet(`
    <div class="eyebrow">Zusatzausbildung</div>
    <h2 class="h2" style="margin:8px 0 4px;">🚜 Gabelstapler-Schein</h2>
    <p class="muted" style="font-size:13px;margin-bottom:14px;">Nach DGUV Grundsatz 308-001 · 10–15 UE Theorie + Praxis-Parcours.</p>
    <div class="card" style="margin:0 0 12px;">
      <div class="spread" style="padding:6px 0;"><span class="soft">Theorieprüfung (In-App)</span><span class="pill ${f.theoryPassed ? 'pill-green' : 'pill-amber'}">${f.theoryPassed ? '✓ Bestanden' : 'Offen'}</span></div>
      <div class="divider" style="margin:8px 0;"></div>
      <div class="spread" style="padding:6px 0;"><span class="soft">Praxisprüfung (vor Ort)</span><span class="pill ${f.practicalPassed ? 'pill-green' : 'pill-amber'}">${f.practicalPassed ? '✓ Bestanden' : 'Offen'}</span></div>
    </div>
    ${cert ? `
      <div class="card" style="margin:0;border:1px solid rgba(16,185,129,.4);background:linear-gradient(150deg,rgba(6,46,33,.7),rgba(19,25,49,.6));text-align:center;">
        <div style="font-size:40px;">🎖️</div>
        <div class="h2" style="color:var(--emerald);margin-top:8px;">Digital-Zertifikat</div>
        <p class="muted" style="font-size:12px;margin-top:4px;">Fälschungssicher · ausgestellt am ${new Date().toLocaleDateString('de-DE')}</p>
        <div class="pill pill-green" style="margin-top:12px;">✓ Verifiziert · ID FS-${me.id.toUpperCase()}-308</div>
      </div>` :
      `<p class="dim center" style="font-size:12px;margin-top:6px;">Sobald beide Prüfungen im Admin als bestanden markiert sind, erscheint hier automatisch dein grünes Digital-Zertifikat.</p>`}`);
}

function openClassMatrixSheet() {
  const groups = {};
  Object.entries(LICENSE_MATRIX).forEach(([k, c]) => { (groups[c.group] ??= []).push([k, c]); });
  openSheet(`<div class="eyebrow">Führerschein-Matrix</div><h2 class="h2" style="margin:8px 0 14px;">Alle Klassen & Pflichtstunden</h2>
    ${Object.entries(groups).map(([g, list]) => `
      <div style="margin-bottom:16px;"><div class="h3" style="color:var(--accent-2);margin-bottom:8px;">${GROUPS[g].icon} ${GROUPS[g].label}</div>
      ${list.map(([k, c]) => `<div class="spread" style="padding:9px 0;border-top:1px solid var(--border);">
        <div><div class="soft" style="font-weight:700;">${c.label}</div><div class="dim" style="font-size:11px;">${esc(c.desc)}</div></div>
        <div style="text-align:right;font-size:11px;" class="muted">${c.theoryBase ? `${c.theoryBase}+${c.theoryExtra} Theorie` : (c.note ? 'Sonderregel' : '— Theorie')}<br>${c.ueberland || c.autobahn || c.nacht ? `${c.ueberland}/${c.autobahn}/${c.nacht} Sonderf.` : 'keine Sonderf.'}</div>
      </div>`).join('')}</div>`).join('')}
    <p class="dim center" style="font-size:11px;">Sonderfahrten: 🏔️Überland / 🛣️Autobahn / 🌌Nacht</p>`);
}

/* ════════════════════════════════════════════════════════════════════════
   PROFIL
   ════════════════════════════════════════════════════════════════════════ */
function renderProfile(v, me) {
  const cls = LICENSE_MATRIX[me.licenseClass];
  v.innerHTML = `
    <div class="topbar"><div><div class="eyebrow">Konto</div><h1 class="h1" style="margin-top:6px;">Profil</h1></div></div>
    <div class="card center" style="padding:26px;">
      <div class="avatar" style="width:72px;height:72px;font-size:24px;margin:0 auto;">${esc(me.name.split(' ').map(n => n[0]).join('').slice(0, 2))}</div>
      <div class="h2" style="margin-top:14px;">${esc(me.name)}</div>
      <div class="muted" style="font-size:13px;margin-top:2px;">${esc(me.email)}</div>
      <div class="row" style="gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap;">
        <span class="pill pill-blue">${cls.icon} Klasse ${esc(me.licenseClass)}</span>
        <span class="pill pill-gray">${me.acquisitionType === 'zweit' ? 'Zweit-Erwerb' : 'Erst-Erwerb'}</span>
        ${me.motorradAufstieg ? '<span class="pill pill-purple" style="background:rgba(168,85,247,.14);color:#D8B4FE;border:1px solid rgba(168,85,247,.3);">Aufstieg</span>' : ''}
      </div>
    </div>

    <div class="section-title"><div class="h2">Echtzeit & Admin</div></div>
    <div class="card tap" id="open-admin">
      <div class="row" style="gap:13px;"><div class="ic" style="width:44px;height:44px;border-radius:13px;background:var(--accent-grad);display:grid;place-items:center;font-size:20px;">🛰️</div>
        <div class="grow"><div class="h3">Büro-Zentrale öffnen</div><div class="muted" style="font-size:12px;">Sieh die Echtzeit-Synchronisation: Termine bestätigen, Doks freigeben, Express-Slots.</div></div>
        <span style="opacity:.4;width:18px;">${icon.chevron}</span></div>
    </div>

    <div class="section-title"><div class="h2">Termine</div></div>
    <div class="card" id="apt-list">${appointmentsHTML(me)}</div>

    <div class="section-title"><div class="h2">Einstellungen</div></div>
    <button class="btn btn-ghost" id="add-cal" style="margin-bottom:10px;">📆 Termine mit Smartphone-Kalender synchronisieren (iCal)</button>
    <button class="btn btn-ghost" id="reset-app">↺ Demo zurücksetzen & neu onboarden</button>
    <p class="dim center" style="font-size:11px;margin-top:18px;">Fahrschul-Cockpit · v3 · Ende-zu-Ende-verschlüsselt</p>`;

  v.querySelector('#open-admin').onclick = () => { haptic.light(); window.open('admin.html', '_blank'); };
  v.querySelector('#add-cal').onclick = () => downloadICS(me);
  v.querySelector('#reset-app').onclick = () => {
    haptic.block();
    if (confirm('Wirklich zurücksetzen? Alle Demo-Daten werden neu erzeugt.')) { store.reset(); onb = { step: 0, group: null, licenseClass: null, acquisitionType: null, motorradAufstieg: false, avail: {} }; render(); }
  };
}

function appointmentsHTML(me) {
  const apts = (me.appointments || []).filter(a => a.status === 'booked').sort((a, b) => a.ts - b.ts);
  if (!apts.length) return '<p class="muted center" style="font-size:13px;padding:8px;">Noch keine gebuchten Fahrstunden.</p>';
  return apts.map(a => `<div class="spread" style="padding:11px 0;border-top:1px solid var(--border);">
    <div class="row" style="gap:11px;"><span style="font-size:18px;">${a.special ? '🛣️' : '🚗'}</span>
      <div><div class="soft" style="font-weight:700;font-size:13.5px;">${esc(a.type || 'Fahrstunde')}</div>
        <div class="dim" style="font-size:11.5px;">${fmtDate(a.ts)} · ${esc(a.slotTime)} · ${esc(a.instructorName)}</div></div></div>
    ${a.id === 'apt-seed' || a.cancellable !== false ? `<button class="btn-sm pill pill-red" data-cancel="${a.id}" style="cursor:pointer;border:none;">Stornieren</button>` : ''}
  </div>`).join('');
}

/* ════════════════════════════════════════════════════════════════════════
   AKTIONEN / AUTOMATISIERUNGEN
   ════════════════════════════════════════════════════════════════════════ */
function payBalance(me) {
  haptic.confirm();
  store.update(s => { const m = s.students.find(x => x.id === s.sessionStudentId);
    m.finance.history.push({ label: 'Zahlung erhalten', amount: m.finance.balance, ts: Date.now() }); m.finance.balance = 0;
    store.log(`${m.name} hat den offenen Betrag beglichen`, '💳'); });
  confetti(40);
  toast({ title: 'Zahlung erfolgreich', msg: 'Konto ausgeglichen – Buchungssperre aufgehoben.', icon: '💚', tone: 'green' });
  render();
}

function registerTheoryExam(me) {
  if (!canRegisterTheoryExam(me)) { haptic.block(); toast({ title: 'Noch nicht freigeschaltet', msg: 'Erfülle erst die Theorie-Mindeststunden laut Matrix.', icon: '🔒', tone: 'amber' }); return; }
  haptic.confirm();
  store.update(s => { const m = s.students.find(x => x.id === s.sessionStudentId); m.exams.theoryRegistered = true; store.log(`${m.name} hat sich zur Theorieprüfung angemeldet`, '📝'); });
  toast({ title: 'Theorieprüfung angemeldet', msg: 'Das Büro erhält deine Anmeldung in Echtzeit.', icon: '📝', tone: 'blue' });
  render();
}

function onExamReadyTap(me, ready) {
  haptic.light();
  openSheet(`<div class="eyebrow" style="color:${ready.ready ? 'var(--emerald)' : 'var(--accent-2)'};">👑 Prüfungs-Ready</div>
    <h2 class="h2" style="margin:8px 0 14px;">${ready.ready ? 'Du bist startklar! ✨' : 'Diese Schritte fehlen noch'}</h2>
    <div class="stack" style="gap:10px;">
      ${ready.checks.map(c => `<div class="card" style="margin:0;padding:14px;${c.ok ? 'border-color:rgba(16,185,129,.3);' : ''}">
        <div class="row" style="gap:12px;"><div style="width:30px;height:30px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;background:${c.ok ? 'var(--emerald-grad)' : 'rgba(255,255,255,.06)'};">${c.ok ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#042f1f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>' : '<span style="color:var(--text-dim);font-size:14px;">○</span>'}</div>
          <span class="soft" style="font-weight:600;font-size:13.5px;">${c.label}</span></div></div>`).join('')}
    </div>
    ${ready.ready ? `<button class="btn btn-emerald" id="confirm-exam" style="margin-top:18px;">Praktische Prüfung anfragen 🚀</button>` : `<p class="dim center" style="font-size:12px;margin-top:16px;">Der grüne Knopf schaltet automatisch frei, sobald alle 5 Bedingungen erfüllt sind.</p>`}`);
  if (ready.ready) { confetti(50); document.getElementById('confirm-exam').onclick = () => { haptic.success(); closeSheet(); toast({ title: 'Prüfung angefragt', msg: 'Das Büro koordiniert deinen Wunschtermin.', icon: '🚀', tone: 'green' }); }; }
}

/* 4B · Matching: erzeugt Terminvorschläge und legt sie im Store ab (Admin sieht sie live) */
function runMatching() {
  const s = store.get();
  const me = store.self();
  const props = generateProposals(me, s.instructors, s.vehicles);
  store.update(st => {
    st.proposals = st.proposals.filter(p => p.studentId !== me.id);
    props.forEach(p => st.proposals.push({ ...p, studentId: me.id, studentName: me.name }));
    if (props.length) store.log(`Engine: ${props.length} Terminvorschläge für ${me.name} generiert → wartet auf Admin-Bestätigung`, '⚡');
  });
  return props.length;
}

/* ── Express-Lückenfüller im Dashboard (Abschnitt 4C) ───────────────────── */
function openExpressForMe(me) {
  const s = store.get();
  return (s.expressSlots || []).find(e => !e.claimedBy && (e.candidates || []).includes(me.id));
}
function expressCardHTML(e) {
  return `<div class="express-card fade-up" id="express-card" style="margin-bottom:14px;">
    <div class="row" style="gap:10px;margin-bottom:8px;"><span class="pill pill-amber" style="background:rgba(251,191,36,.18);">⚡ Express-Slot</span></div>
    <div class="h2" style="position:relative;">Ein exklusiver Slot ist frei!</div>
    <p class="soft" style="font-size:13px;margin-top:6px;position:relative;line-height:1.5;">${esc(e.label)} um <b>${esc(e.slotTime)}</b> mit ${esc(e.instructorName)}.${e.special ? ` Zählt als <b>${specialLabel(e.special)}</b>.` : ''}</p>
    <button class="btn btn-gold" id="claim-express" style="margin-top:14px;position:relative;">Jetzt mit einem Tap sichern ✦</button>
  </div>`;
}
function bindExpressCard(me, e) {
  const btn = document.getElementById('claim-express');
  if (!btn || !e) return;
  btn.onclick = () => {
    const fresh = openExpressForMe(me);
    if (!fresh) { haptic.block(); toast({ title: 'Zu spät', msg: 'Dieser Express-Slot wurde gerade vergeben.', icon: '⌛', tone: 'amber' }); render(); return; }
    haptic.confirm();
    store.update(s => {
      const ex = s.expressSlots.find(x => x.id === e.id);
      if (!ex || ex.claimedBy) return;
      ex.claimedBy = me.id;
      const m = s.students.find(x => x.id === s.sessionStudentId);
      m.appointments.push({ id: 'apt-' + Date.now(), day: e.day, slot: e.slot, slotTime: e.slotTime, weekday: e.label,
        instructorName: e.instructorName, vehicleName: e.vehicleName || '—', licenseClass: m.licenseClass,
        ts: e.ts || (Date.now() + 86400000), status: 'booked', special: e.special, type: e.special ? specialLabel(e.special) : 'Express-Fahrstunde', cancellable: true });
      m.nextAppointment = m.appointments[m.appointments.length - 1];
      store.log(`${m.name} hat den Express-Slot gesichert (zuerst getippt!)`, '⚡');
    });
    confetti(60); render();
    toast({ title: 'Express-Slot gesichert! ✦', msg: 'Die Stunde ist autonom umgebucht und im Kalender.', icon: '⚡', tone: 'amber', express: true });
  };
}
function specialLabel(t) { return { ueberland: 'Überlandfahrt', autobahn: 'Autobahnfahrt', nacht: 'Nachtfahrt' }[t] || 'Sonderfahrt'; }

/* Storno einer Fahrstunde → triggert Speed-Matching (über Store, Admin/PWA reagieren) */
function cancelAppointment(id, me) {
  const s = store.get();
  const apt = me.appointments.find(a => a.id === id);
  if (!apt) return;
  haptic.block();
  store.update(st => {
    const m = st.students.find(x => x.id === st.sessionStudentId);
    const a = m.appointments.find(x => x.id === id);
    if (a) a.status = 'cancelled';
    if (m.nextAppointment?.id === id) m.nextAppointment = null;
    store.log(`${m.name} hat eine Fahrstunde storniert → Speed-Matching ausgelöst`, '⌛');
  });
  // Speed-Matching anstoßen: Slot wird zum Express-Angebot für andere Kandidaten
  triggerSpeedMatching(apt, me);
  toast({ title: 'Fahrstunde storniert', msg: 'Der Slot wird automatisch anderen passenden Schülern angeboten.', icon: '⌛', tone: 'amber' });
  render();
}

function triggerSpeedMatching(apt, me) {
  import('./engine.js').then(({ findExpressCandidates }) => {
    const s = store.get();
    const freed = { day: apt.day, slot: apt.slot, special: apt.special, group: LICENSE_MATRIX[me.licenseClass].group, excludeStudentId: me.id };
    const cands = findExpressCandidates(freed, s.students);
    store.update(st => {
      st.expressSlots.push({ id: 'ex-' + Date.now(), day: apt.day, slot: apt.slot, slotTime: apt.slotTime,
        label: WEEKDAYS_LONG[apt.day], instructorName: apt.instructorName, vehicleName: apt.vehicleName,
        special: apt.special, ts: apt.ts, candidates: cands.map(c => c.studentId), claimedBy: null, createdAt: Date.now() });
      store.log(`Speed-Matching: Slot an ${cands.length} Kandidaten angeboten`, '⚡');
    });
  });
}

/* ── Kalender-Export (iCal) ─────────────────────────────────────────────── */
function downloadICS(me) {
  haptic.light();
  const apts = (me.appointments || []).filter(a => a.status === 'booked');
  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Fahrschul-Cockpit//DE\r\n';
  apts.forEach(a => {
    const start = new Date(a.ts), end = new Date(a.ts + 90 * 60000);
    const f = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    ics += `BEGIN:VEVENT\r\nUID:${a.id}@cockpit\r\nDTSTART:${f(start)}\r\nDTEND:${f(end)}\r\nSUMMARY:${a.type || 'Fahrstunde'} mit ${a.instructorName}\r\nLOCATION:Fahrschule\r\nEND:VEVENT\r\n`;
  });
  ics += 'END:VCALENDAR';
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = 'fahrschul-termine.ics'; link.click(); URL.revokeObjectURL(url);
  toast({ title: 'Kalender exportiert', msg: 'Öffne die Datei, um Termine zu synchronisieren.', icon: '📆', tone: 'blue' });
}

/* ════════════════════════════════════════════════════════════════════════
   TABBAR
   ════════════════════════════════════════════════════════════════════════ */
function tabbarHTML() {
  const tabs = [['dashboard', 'Cockpit', icon.home], ['planner', 'Zeiten', icon.calendar], ['theory', 'Theorie', icon.book], ['services', 'Angebot', icon.grid], ['profile', 'Profil', icon.user]];
  return `<nav class="tabbar">${tabs.map(([id, label, ic]) => `<button class="tab ${route === id ? 'active' : ''}" data-tab="${id}">${ic}<span>${label}</span></button>`).join('')}</nav>`;
}
function bindTabbar() { document.querySelectorAll('[data-tab]').forEach(t => t.onclick = () => navigate(t.dataset.tab)); }

/* ── Sheet-Steuerung ────────────────────────────────────────────────────── */
let sheetEls = null;
function openSheet(html) {
  closeSheet();
  const backdrop = document.createElement('div'); backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-grip"></div>${html}`;
  document.body.appendChild(backdrop); document.body.appendChild(sheet);
  requestAnimationFrame(() => { backdrop.classList.add('show'); sheet.classList.add('show'); });
  backdrop.onclick = closeSheet;
  sheetEls = { backdrop, sheet };
}
function closeSheet() {
  if (!sheetEls) return;
  const { backdrop, sheet } = sheetEls; sheetEls = null;
  backdrop.classList.remove('show'); sheet.classList.remove('show');
  setTimeout(() => { backdrop.remove(); sheet.remove(); }, 480);
}

/* ── Animations-Helfer (Balken & Ringe füllen sich) ─────────────────────── */
function animateBars() {
  document.querySelectorAll('.bar > span[data-w]').forEach(el => { requestAnimationFrame(() => { el.style.width = el.dataset.w + '%'; }); });
  document.querySelectorAll('.ring-fg[data-off]').forEach(el => { requestAnimationFrame(() => { el.style.strokeDashoffset = el.dataset.off; }); });
}

function nextBookedAppointment(me) {
  return (me.appointments || []).filter(a => a.status === 'booked' && a.ts > Date.now()).sort((a, b) => a.ts - b.ts)[0] || null;
}

/* ════════════════════════════════════════════════════════════════════════
   STORE-SUBSCRIPTION: Echtzeit-Reaktionen (Push vom Admin etc.)
   ════════════════════════════════════════════════════════════════════════ */
let renderScheduled = false;
store.subscribe(() => {
  // neue Push-Benachrichtigungen für mich?
  const s = store.get();
  const me = store.self();
  (s.notifications || []).filter(n => n.studentId === me.id && n.ts > lastNotifTs).forEach(n => {
    lastNotifTs = Math.max(lastNotifTs, n.ts);
    haptic.confirm();
    toast({ title: n.title, msg: n.msg, icon: n.icon || '🔔', tone: n.tone || 'green', express: n.express });
  });
  // neue Express-Slots für mich?
  const ex = openExpressForMe(me);
  if (ex && ex.createdAt > lastNotifTs - 99999 && !ex._notified) {
    ex._notified = true;
  }
  if (!renderScheduled) {
    renderScheduled = true;
    requestAnimationFrame(() => { renderScheduled = false; if (me.onboarded && !morphState && !sheetEls) render(); });
  }
});

/* Event-Delegation für dynamisch erzeugte Storno-Buttons */
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-cancel]');
  if (c) cancelAppointment(c.dataset.cancel, store.self());
});

/* ── Boot ───────────────────────────────────────────────────────────────── */
render();
