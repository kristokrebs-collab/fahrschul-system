/* ════════════════════════════════════════════════════════════════════════
   Fahrschul-Cockpit · Büro-Zentrale (Admin)
   Echtzeit-Sicht auf denselben Store wie die Schüler-PWA. Bestätigt
   Terminvorschläge, gibt Dokumente/GO frei und löst Speed-Matching aus.
   Alle Aktionen werden sofort in die PWA gepusht (BroadcastChannel).
   ════════════════════════════════════════════════════════════════════════ */
import { store } from './store.js';
import { LICENSE_MATRIX, computeProgress, computeExamReady, findExpressCandidates, WEEKDAYS_LONG } from './engine.js';
import { fmtDate, fmtEuro, relTime, haptic, esc } from './ui.js';

const root = document.getElementById('admin');

function render() {
  const s = store.get();
  const students = s.students;
  const props = s.proposals || [];
  const pendingExpress = (s.expressSlots || []).filter(e => !e.claimedBy);

  root.innerHTML = `
    <div class="spread" style="margin-bottom:22px;flex-wrap:wrap;gap:12px;">
      <div class="brand"><div class="brand-mark">🛰️</div>
        <div><div class="brand-title" style="font-size:18px;">Büro-Zentrale</div><div class="brand-sub">Echtzeit-Synchronisation mit allen Schüler-PWAs</div></div></div>
      <div class="row" style="gap:8px;"><span class="live-dot"></span><span class="muted" style="font-size:12px;font-weight:700;">LIVE · synchronisiert</span></div>
    </div>

    <div class="stat-grid" style="margin-bottom:18px;">
      ${stat('👥', students.length, 'Schüler')}
      ${stat('⚡', props.length, 'Offene Vorschläge')}
      ${stat('✦', pendingExpress.length, 'Express-Slots')}
      ${stat('📝', students.filter(x => x.exams?.theoryRegistered).length, 'Prüfungs-Anmeldungen')}
    </div>

    <div class="admin-grid">
      <div>
        <div class="section-title" style="margin-top:0;"><div class="h2">Schüler-Übersicht</div></div>
        <div class="stack" style="gap:14px;">${students.map(studentCard).join('')}</div>

        ${props.length ? `
        <div class="section-title"><div class="h2">⚡ Automatische Terminvorschläge</div><span class="pill pill-amber">${props.length} wartet auf Bestätigung</span></div>
        <div class="stack" style="gap:11px;">${props.map(proposalCard).join('')}</div>` : ''}
      </div>

      <div>
        <div class="card">
          <div class="card-row" style="margin-bottom:6px;"><div class="h3">🔴 Echtzeit-Aktivität</div><span class="live-dot"></span></div>
          <div id="feed">${(s.activity || []).slice(0, 18).map(a => `
            <div class="feed-item"><span style="font-size:16px;">${a.icon}</span>
              <div class="grow"><div class="soft" style="font-size:12.5px;line-height:1.4;">${esc(a.text)}</div>
                <div class="dim" style="font-size:10.5px;margin-top:2px;">${relTime(a.ts)}</div></div></div>`).join('') || '<p class="muted" style="font-size:12px;padding:8px;">Noch keine Aktivität.</p>'}</div>
        </div>

        ${pendingExpress.length ? `
        <div class="section-title"><div class="h2">✦ Express-Lückenfüller</div></div>
        <div class="stack" style="gap:11px;">${pendingExpress.map(expressCard).join('')}</div>` : ''}

        <div class="card" style="margin-top:14px;">
          <div class="h3" style="margin-bottom:8px;">↺ Demo-Steuerung</div>
          <button class="btn btn-ghost btn-sm" id="reset" style="width:100%;">Store zurücksetzen</button>
          <p class="dim" style="font-size:11px;margin-top:8px;">Öffne <b>index.html</b> in einem zweiten Tab, um die Echtzeit-Synchronisation live zu erleben.</p>
        </div>
      </div>
    </div>`;

  bind(s);
}

function stat(ic, n, label) {
  return `<div class="card" style="margin:0;padding:16px;"><div style="font-size:20px;">${ic}</div>
    <div class="h1" style="font-size:28px;margin-top:6px;">${n}</div><div class="muted" style="font-size:12px;">${label}</div></div>`;
}

function studentCard(st) {
  if (!st.onboarded) return `<div class="card" style="margin:0;"><div class="h3">${esc(st.name)}</div><p class="muted" style="font-size:12px;margin-top:4px;">Onboarding noch nicht abgeschlossen.</p></div>`;
  const prog = computeProgress(st);
  const ready = computeExamReady(st);
  const cls = LICENSE_MATRIX[st.licenseClass];
  const d = st.documents;
  const availCount = Object.values(st.availability || {}).filter(Boolean).length;
  const docPill = (k, label) => { const st2 = d[k]; const map = { verified: 'pill-green', submitted: 'pill-blue', pending: 'pill-amber' }; return `<span class="pill ${map[st2]}" style="cursor:pointer;" data-doc="${st.id}:${k}">${label}: ${st2 === 'verified' ? '✓' : st2 === 'submitted' ? '📤' : '⚠️'}</span>`; };

  return `<div class="card" style="margin:0;">
    <div class="spread" style="margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <div class="row" style="gap:11px;"><div class="avatar" style="width:40px;height:40px;font-size:13px;">${esc(st.name.split(' ').map(n => n[0]).join('').slice(0, 2))}</div>
        <div><div class="h3">${esc(st.name)}</div><div class="dim" style="font-size:11px;">${cls.icon} Klasse ${st.licenseClass} · ${st.acquisitionType === 'zweit' ? 'Zweit-Erwerb' : 'Erst-Erwerb'}</div></div></div>
      ${ready.ready ? '<span class="pill pill-green">👑 Prüfungs-Ready</span>' : `<span class="pill pill-gray">${ready.checks.filter(c => c.ok).length}/5 ready</span>`}
    </div>
    <div class="row" style="gap:14px;margin-bottom:12px;flex-wrap:wrap;">
      <div><div class="dim" style="font-size:10px;">THEORIE</div><div class="soft" style="font-weight:800;">${prog.theory.done}/${prog.theory.total}</div></div>
      <div><div class="dim" style="font-size:10px;">SONDERF.</div><div class="soft" style="font-weight:800;">${(st.progress.special.ueberland||0)+(st.progress.special.autobahn||0)+(st.progress.special.nacht||0)}/${prog.req.specialTotal}</div></div>
      <div><div class="dim" style="font-size:10px;">ÜBUNG</div><div class="soft" style="font-weight:800;">${prog.practice}</div></div>
      <div><div class="dim" style="font-size:10px;">ZEITEN</div><div class="soft" style="font-weight:800;">${availCount} Slots</div></div>
      <div><div class="dim" style="font-size:10px;">KONTO</div><div class="soft" style="font-weight:800;color:${(st.finance.balance||0) > 0 ? 'var(--amber)' : 'var(--emerald)'};">${fmtEuro(st.finance.balance)}</div></div>
    </div>
    <div class="row" style="gap:7px;flex-wrap:wrap;margin-bottom:12px;">
      ${docPill('sehtest', 'Sehtest')} ${docPill('ersteHilfe', 'Erste Hilfe')} ${docPill('passbild', 'Passbild')}
    </div>
    <div class="divider" style="margin:10px 0;"></div>
    <div class="stack" style="gap:9px;">
      ${toggleRow('Grundausbildung abgeschlossen', st.progress.grundausbildungDone, `grund:${st.id}`)}
      ${toggleRow('Theorieprüfung bestanden', st.exams.theoryPassed, `theory:${st.id}`)}
      ${toggleRow('Fahrlehrer-GO erteilt', st.instructorGo, `go:${st.id}`)}
      ${toggleRow('Staplerschein Theorie+Praxis', st.forklift?.theoryPassed && st.forklift?.practicalPassed, `forklift:${st.id}`)}
    </div>
    <div class="row" style="gap:8px;margin-top:14px;flex-wrap:wrap;">
      <button class="btn-sm pill pill-blue" data-special="${st.id}:ueberland" style="border:none;cursor:pointer;">+ Überland</button>
      <button class="btn-sm pill pill-blue" data-special="${st.id}:autobahn" style="border:none;cursor:pointer;">+ Autobahn</button>
      <button class="btn-sm pill pill-blue" data-special="${st.id}:nacht" style="border:none;cursor:pointer;">+ Nacht</button>
      <button class="btn-sm pill pill-gray" data-practice="${st.id}" style="border:none;cursor:pointer;">+ Übungsstunde</button>
    </div>
  </div>`;
}

function toggleRow(label, on, key) {
  return `<div class="spread"><span class="soft" style="font-size:13px;font-weight:600;">${label}</span>
    <button class="toggle ${on ? 'on' : ''}" data-toggle="${key}"></button></div>`;
}

function proposalCard(p) {
  return `<div class="card" style="margin:0;">
    <div class="spread" style="margin-bottom:10px;"><div class="row" style="gap:8px;"><span style="font-size:18px;">🚗</span>
      <div><div class="soft" style="font-weight:700;font-size:13px;">${esc(p.studentName)} · ${esc(p.weekday)} ${esc(p.slotTime)}</div>
        <div class="dim" style="font-size:11px;">${esc(p.instructorName)} · ${esc(p.vehicleName)} · Klasse ${esc(p.licenseClass)}</div></div></div></div>
    <div class="row" style="gap:8px;">
      <button class="btn btn-emerald btn-sm" data-confirm="${p.id}" style="flex:1;">✓ Bestätigen & pushen</button>
      <button class="btn btn-ghost btn-sm" data-decline="${p.id}">Verwerfen</button>
    </div>
  </div>`;
}

function expressCard(e) {
  return `<div class="express-card" style="padding:14px;">
    <div class="row" style="gap:8px;margin-bottom:6px;position:relative;"><span class="pill pill-amber" style="background:rgba(251,191,36,.18);">✦ Offen</span>
      <span class="dim" style="font-size:11px;">${(e.candidates || []).length} Kandidaten benachrichtigt</span></div>
    <div class="soft" style="font-size:13px;position:relative;">${esc(e.label)} · ${esc(e.slotTime)} · ${esc(e.instructorName)}</div>
    <div class="dim" style="font-size:11px;margin-top:2px;position:relative;">Wartet darauf, dass ein Schüler zuerst tippt …</div>
  </div>`;
}

/* ── Bindings ───────────────────────────────────────────────────────────── */
function bind(s) {
  document.getElementById('reset').onclick = () => { if (confirm('Store zurücksetzen?')) { store.reset(); } };

  // Toggles
  root.querySelectorAll('[data-toggle]').forEach(t => t.onclick = () => {
    const [kind, id] = t.dataset.toggle.split(':');
    store.update(st => {
      const m = st.students.find(x => x.id === id);
      if (kind === 'grund') { m.progress.grundausbildungDone = !m.progress.grundausbildungDone;
        notify(st, m, m.progress.grundausbildungDone ? { title: 'Grundausbildung abgeschlossen', msg: 'Deine Sonderfahrten sind jetzt freigeschaltet! 🛣️', icon: '🔓', tone: 'green' } : null);
        store.log(`Admin: Grundausbildung für ${m.name} ${m.progress.grundausbildungDone ? 'freigegeben' : 'zurückgesetzt'}`, '🔓'); }
      if (kind === 'theory') { m.exams.theoryPassed = !m.exams.theoryPassed;
        notify(st, m, m.exams.theoryPassed ? { title: 'Theorieprüfung bestanden! 🎉', msg: 'Glückwunsch – eine Bedingung mehr für Prüfungs-Ready.', icon: '✅', tone: 'green' } : null);
        store.log(`Admin: Theorieprüfung für ${m.name} ${m.exams.theoryPassed ? 'bestätigt' : 'zurückgesetzt'}`, '✅'); }
      if (kind === 'go') { m.instructorGo = !m.instructorGo;
        notify(st, m, m.instructorGo ? { title: 'Fahrlehrer-GO erteilt 👑', msg: 'Dein Fahrlehrer gibt grünes Licht für die Prüfung!', icon: '👑', tone: 'green' } : null);
        store.log(`Admin: Fahrlehrer-GO für ${m.name} ${m.instructorGo ? 'erteilt' : 'entzogen'}`, '👑'); }
      if (kind === 'forklift') { const on = !(m.forklift.theoryPassed && m.forklift.practicalPassed); m.forklift.theoryPassed = on; m.forklift.practicalPassed = on;
        notify(st, m, on ? { title: 'Staplerschein bestanden! 🎖️', msg: 'Dein fälschungssicheres Digital-Zertifikat ist jetzt verfügbar.', icon: '🚜', tone: 'green' } : null);
        store.log(`Admin: Staplerschein für ${m.name} ${on ? 'als bestanden markiert' : 'zurückgesetzt'}`, '🚜'); }
    });
  });

  // Doc-Zyklus pending → submitted → verified
  root.querySelectorAll('[data-doc]').forEach(t => t.onclick = () => {
    const [id, k] = t.dataset.doc.split(':');
    store.update(st => { const m = st.students.find(x => x.id === id);
      const next = { pending: 'submitted', submitted: 'verified', verified: 'pending' };
      m.documents[k] = next[m.documents[k]];
      if (m.documents[k] === 'verified') notify(st, m, { title: 'Dokument verifiziert ✅', msg: `${k} wurde amtlich bestätigt.`, icon: '📋', tone: 'green' });
      store.log(`Admin: Dokument „${k}" für ${m.name} → ${m.documents[k]}`, '📋'); });
  });

  // Sonderfahrten / Übung gutschreiben
  root.querySelectorAll('[data-special]').forEach(t => t.onclick = () => {
    const [id, type] = t.dataset.special.split(':');
    store.update(st => { const m = st.students.find(x => x.id === id);
      if (!m.progress.grundausbildungDone) return; // Regel 2: ohne Grundausbildung keine Sonderfahrt
      m.progress.special[type] = (m.progress.special[type] || 0) + 1;
      notify(st, m, { title: 'Sonderfahrt eingetragen', msg: `${{ueberland:'Überlandfahrt',autobahn:'Autobahnfahrt',nacht:'Nachtfahrt'}[type]} gutgeschrieben.`, icon: '🛣️', tone: 'blue' });
      store.log(`Admin: ${type}-Sonderfahrt für ${m.name} gewertet`, '🛣️'); });
    if (!s.students.find(x => x.id === id).progress.grundausbildungDone) { haptic.block(); alert('Regel 2: Sonderfahrten erst nach abgeschlossener Grundausbildung wertbar.'); }
  });
  root.querySelectorAll('[data-practice]').forEach(t => t.onclick = () => {
    store.update(st => { const m = st.students.find(x => x.id === t.dataset.practice); m.progress.practice = (m.progress.practice || 0) + 1; store.log(`Admin: Übungsstunde für ${m.name} gewertet`, '🚗'); });
  });

  // Vorschlag bestätigen → Termin buchen & pushen
  root.querySelectorAll('[data-confirm]').forEach(b => b.onclick = () => {
    store.update(st => {
      const p = st.proposals.find(x => x.id === b.dataset.confirm);
      if (!p) return;
      const m = st.students.find(x => x.id === p.studentId);
      const ts = Date.now() + (p.day + 2) * 86400000;
      m.appointments.push({ id: 'apt-' + Date.now(), day: p.day, slot: p.slot, slotTime: p.slotTime, weekday: p.weekday,
        instructorName: p.instructorName, vehicleName: p.vehicleName, licenseClass: p.licenseClass, ts,
        status: 'booked', special: null, type: 'Fahrstunde', cancellable: true });
      m.nextAppointment = m.appointments[m.appointments.length - 1];
      st.proposals = st.proposals.filter(x => x.id !== p.id);
      notify(st, m, { title: 'Termin bestätigt! 🚗', msg: `${p.weekday} ${p.slotTime} mit ${p.instructorName} ist fest gebucht.`, icon: '✅', tone: 'green' });
      store.log(`Admin: Termin für ${m.name} bestätigt → an PWA & Fahrlehrer-Tablet gepusht`, '✅');
    });
  });
  root.querySelectorAll('[data-decline]').forEach(b => b.onclick = () => {
    store.update(st => { st.proposals = st.proposals.filter(x => x.id !== b.dataset.decline); store.log('Admin: Terminvorschlag verworfen', '✕'); });
  });
}

/* Push an Schüler-PWA (wird dort via Store-Subscription als Toast angezeigt) */
function notify(st, m, payload) {
  if (!payload) return;
  st.notifications = st.notifications || [];
  st.notifications.push({ id: 'n' + Date.now() + Math.random(), studentId: m.id, ts: Date.now() + 1, ...payload });
  st.notifications = st.notifications.slice(-40);
}

store.subscribe(render);
render();
