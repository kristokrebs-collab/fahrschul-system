/* ════════════════════════════════════════════════════════════════════════
   Fahrschul-Cockpit · Shared Realtime Store
   Ein gemeinsamer Zustands-Layer für Schüler-PWA UND Admin-Konsole.
   Persistenz über localStorage, Echtzeit-Sync über BroadcastChannel
   (+ storage-Event als Fallback). Beide Oberflächen sehen dieselben Daten
   live – das erfüllt "Admin greift in Echtzeit zu" ohne Server.
   ════════════════════════════════════════════════════════════════════════ */

import { SLOTS, gridKey } from './engine.js';

const KEY = 'fahrschul_state_v3';
const CH = 'fahrschul-cockpit';

/* ── Seed: realistischer Anfangsdatenbestand ────────────────────────────── */
function freeGrid(density = 0.5) {
  const g = [];
  for (let d = 0; d < 6; d++)
    for (const s of SLOTS)
      if (Math.random() < density) g.push(gridKey(d, s.id));
  return g;
}

function seed() {
  return {
    version: 3,
    instructors: [
      { id: 'fl1', name: 'Markus Brandt', classes: ['pkw', 'zweirad'], color: '#6366F1',
        free: ['0-2', '0-3', '1-4', '1-5', '2-2', '2-3', '3-5', '3-6', '4-2', '4-4', '5-3'] },
      { id: 'fl2', name: 'Sandra Vogt', classes: ['pkw'], color: '#10B981',
        free: ['0-4', '0-5', '1-2', '1-3', '2-5', '2-6', '3-2', '3-3', '4-5', '4-6', '5-2'] },
      { id: 'fl3', name: 'Tobias Reuter', classes: ['lkw', 'bus'], color: '#F59E0B',
        free: ['1-1', '1-2', '2-1', '3-1', '4-1', '5-1'] },
    ],
    vehicles: [
      { id: 'v1', name: 'VW Golf 8 · B-PR 1234', group: 'pkw', free: ['0-2','0-3','0-4','0-5','1-2','1-3','1-4','1-5','2-2','2-3','2-5','2-6','3-2','3-3','3-5','3-6','4-2','4-4','4-5','4-6','5-2','5-3'] },
      { id: 'v2', name: 'BMW G310R · B-PR 0042', group: 'zweirad', free: ['0-2','0-3','2-2','2-3','4-2','4-4'] },
      { id: 'v3', name: 'MAN TGX · B-PR 7700', group: 'lkw', free: ['1-1','2-1','3-1','4-1','5-1'] },
    ],
    // Theorie-Termine im Schulungsraum (Thema X Buchung)
    theorySessions: buildTheorySessions(),
    proposals: [],         // automatisch generierte Terminvorschläge (Admin sieht live)
    notifications: [],     // Push-Benachrichtigungen an Schüler
    expressSlots: [],      // offene Express-Lückenfüller
    activity: [],          // Admin-Aktivitäts-Log (Echtzeit-Einsicht, Regel 3)
    students: [ defaultStudent() ],
    sessionStudentId: 'stu-self',
  };
}

function buildTheorySessions() {
  const base = Date.now();
  const day = 86400000;
  const topics = [
    { nr: 3, title: 'Vorfahrt & Verkehrsregelungen', kind: 'grund', group: 'all' },
    { nr: 4, title: 'Verkehrszeichen & Verkehrseinrichtungen', kind: 'grund', group: 'all' },
    { nr: 6, title: 'Vorausschauendes & defensives Fahren', kind: 'grund', group: 'all' },
    { nr: 'C1', title: 'Zusatzstoff C: Abmessungen & Achslasten', kind: 'zusatz', group: 'lkw' },
    { nr: 'B1', title: 'Zusatzstoff B: Fahrtechnik & Beladung', kind: 'zusatz', group: 'pkw' },
    { nr: 7, title: 'Geschwindigkeit, Abstand & Umwelt', kind: 'grund', group: 'all' },
    { nr: 9, title: 'Verkehrsverhalten bei Fahrmanövern', kind: 'grund', group: 'all' },
    { nr: 'A1', title: 'Zusatzstoff Motorrad: Schutzkleidung & Fahrphysik', kind: 'zusatz', group: 'zweirad' },
  ];
  return topics.map((t, i) => ({
    id: `th-${i}`,
    topicNr: t.nr,
    title: t.title,
    kind: t.kind,
    group: t.group,
    date: base + (i + 2) * day,
    time: i % 2 === 0 ? '19:00' : '18:30',
    room: 'Schulungsraum A',
    capacity: 14,
    booked: Math.floor(Math.random() * 9) + 2,
    bookedBy: [],
  }));
}

function defaultStudent() {
  return {
    id: 'stu-self',
    name: 'Michael Krebs',
    email: 'mail@michael-krebs.com',
    licenseClass: null,        // wird im Onboarding gesetzt
    acquisitionType: null,     // 'erst' | 'zweit'
    motorradAufstieg: false,
    onboarded: false,
    availability: {},          // { "day-slot": true }
    appointments: [],          // gebuchte Fahrstunden
    progress: {
      theoryAttended: [],      // Liste von topicNr
      special: { ueberland: 0, autobahn: 0, nacht: 0 },
      practice: 0,
      simulator: 0,
      grundausbildungDone: false,
    },
    documents: { sehtest: 'pending', ersteHilfe: 'pending', passbild: 'pending' },
    finance: { balance: 0, history: [] },
    exams: { theoryPassed: false, theoryRegistered: false, practicalDate: null },
    forklift: { theoryPassed: false, practicalPassed: false },
    instructorGo: false,
    nextAppointment: null,
  };
}

/* ── Store-Kern ─────────────────────────────────────────────────────────── */
let state = load();
const subs = new Set();
let channel = null;
try { channel = new BroadcastChannel(CH); } catch (e) { channel = null; }

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { const s = seed(); localStorage.setItem(KEY, JSON.stringify(s)); return s; }
    const parsed = JSON.parse(raw);
    if (parsed.version !== 3) { const s = seed(); localStorage.setItem(KEY, JSON.stringify(s)); return s; }
    return parsed;
  } catch (e) { return seed(); }
}

function persist(broadcast = true) {
  localStorage.setItem(KEY, JSON.stringify(state));
  if (broadcast && channel) channel.postMessage({ type: 'state', ts: Date.now() });
  subs.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });
}

if (channel) channel.onmessage = (ev) => {
  if (ev.data?.type === 'state') { state = load(); subs.forEach(fn => fn(state)); }
};
window.addEventListener('storage', (e) => {
  if (e.key === KEY) { state = load(); subs.forEach(fn => fn(state)); }
});

export const store = {
  get: () => state,
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

  /* generischer Producer: mutiert state via Callback und persistiert+broadcastet */
  update(mutator) { mutator(state); persist(); },

  reset() { localStorage.removeItem(KEY); state = load(); persist(); },

  /* ── Schüler-Helfer ─────────────────────────────────────────────────── */
  self() { return state.students.find(s => s.id === state.sessionStudentId) || state.students[0]; },
  student(id) { return state.students.find(s => s.id === id); },

  /* Aktivitäts-Log für Admin-Echtzeit-Einsicht (Regel 3) */
  log(text, icon = '•') {
    state.activity.unshift({ id: 'a' + Date.now() + Math.random(), text, icon, ts: Date.now() });
    state.activity = state.activity.slice(0, 60);
  },
};
