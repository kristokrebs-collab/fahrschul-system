/* ════════════════════════════════════════════════════════════════════════
   Fahrschul-Cockpit · Engine
   Die deterministische "Single Source of Truth" für die Ausbildungs-Mathematik:
   Klassen-Matrix, Pflichtstunden-Berechnung, Erwerbs-Logik & Prüfungs-Ready.
   Reines ES-Modul ohne Abhängigkeiten – läuft im Browser & in Node-Tests.
   ════════════════════════════════════════════════════════════════════════ */

/* ── Die Master-Klassen-Matrix (Abschnitt 2 der Spezifikation) ──────────── */
export const LICENSE_MATRIX = {
  // Zweirad
  Mofa: { group: 'zweirad', label: 'Mofa', desc: 'Mofaprüfbescheinigung (25 km/h)', icon: '🛵',
          theoryBase: 6, theoryExtra: 2, ueberland: 0, autobahn: 0, nacht: 0, exam: true },
  AM:   { group: 'zweirad', label: 'AM', desc: 'Roller / Kleinkrafträder (45 km/h)', icon: '🛵',
          theoryBase: 12, theoryExtra: 2, ueberland: 0, autobahn: 0, nacht: 0, exam: true },
  A1:   { group: 'zweirad', label: 'A1', desc: 'Leichtkrafträder (125 ccm)', icon: '🏍️',
          theoryBase: 12, theoryExtra: 4, ueberland: 5, autobahn: 4, nacht: 3, exam: true, upgradeable: true },
  A2:   { group: 'zweirad', label: 'A2', desc: 'Mittelschwere Motorräder (bis 35 kW)', icon: '🏍️',
          theoryBase: 12, theoryExtra: 4, ueberland: 5, autobahn: 4, nacht: 3, exam: true, upgradeFrom: 'A1' },
  A:    { group: 'zweirad', label: 'A', desc: 'Schwere Motorräder (Direkteinstieg)', icon: '🏍️',
          theoryBase: 12, theoryExtra: 4, ueberland: 5, autobahn: 4, nacht: 3, exam: true, upgradeFrom: 'A2' },

  // PKW
  B:    { group: 'pkw', label: 'B', desc: 'Autoführerschein (auch BF17 / B197)', icon: '🚗',
          theoryBase: 12, theoryExtra: 2, ueberland: 5, autobahn: 4, nacht: 3, exam: true },
  B96:  { group: 'pkw', label: 'B96', desc: 'PKW mit schwererem Anhänger', icon: '🚙',
          theoryBase: 0, theoryExtra: 0, ueberland: 0, autobahn: 0, nacht: 0, exam: false,
          note: '7 Std. Fahrerschulung (keine Pflicht-Sonderfahrten)', training: 7 },
  BE:   { group: 'pkw', label: 'BE', desc: 'Schwerer PKW-Anhänger (bis 3,5t)', icon: '🚚',
          theoryBase: 0, theoryExtra: 0, ueberland: 3, autobahn: 1, nacht: 1, exam: true, combinedTheory: 'B' },

  // LKW
  C1:   { group: 'lkw', label: 'C1', desc: 'Leichte LKW (3,5t bis 7,5t)', icon: '🚛',
          theoryBase: 12, theoryExtra: 6, ueberland: 3, autobahn: 1, nacht: 1, exam: true },
  C1E:  { group: 'lkw', label: 'C1E', desc: 'Leichte LKW mit Anhänger', icon: '🚛',
          theoryBase: 0, theoryExtra: 0, ueberland: 3, autobahn: 1, nacht: 1, exam: true, combinedTheory: 'C1' },
  C:    { group: 'lkw', label: 'C', desc: 'Schwere LKW (Solo)', icon: '🚛',
          theoryBase: 12, theoryExtra: 10, ueberland: 5, autobahn: 4, nacht: 3, exam: true },
  CE:   { group: 'lkw', label: 'CE', desc: 'Große Lastzüge / Sattelkraftfahrzeuge', icon: '🚛',
          theoryBase: 6, theoryExtra: 4, ueberland: 5, autobahn: 4, nacht: 3, exam: true },

  // Bus
  D1:   { group: 'bus', label: 'D1', desc: 'Kleinbusse (bis 16 Personen)', icon: '🚐',
          theoryBase: 12, theoryExtra: 4, ueberland: null, autobahn: null, nacht: null, exam: true,
          variable: true, note: 'Pflichtstunden variieren je nach Vorbesitz (B oder C)' },
  D1E:  { group: 'bus', label: 'D1E', desc: 'Kleinbusse mit Anhänger', icon: '🚐',
          theoryBase: 0, theoryExtra: 0, ueberland: 3, autobahn: 1, nacht: 1, exam: true, combinedTheory: 'D1' },
  D:    { group: 'bus', label: 'D', desc: 'Große Omnibusse', icon: '🚌',
          theoryBase: 12, theoryExtra: 18, ueberland: null, autobahn: null, nacht: null, exam: true,
          variable: true, note: 'Pflichtstunden variieren je nach Vorbesitz (B oder C)' },
  DE:   { group: 'bus', label: 'DE', desc: 'Große Omnibusse mit Anhänger', icon: '🚌',
          theoryBase: 0, theoryExtra: 0, ueberland: 5, autobahn: 4, nacht: 3, exam: true, combinedTheory: 'D' },

  // Traktor & Sonderklassen
  L:    { group: 'sonder', label: 'L', desc: 'Landwirtschaftliche Traktoren (bis 40 km/h)', icon: '🚜',
          theoryBase: 12, theoryExtra: 2, ueberland: 0, autobahn: 0, nacht: 0, exam: true },
  T:    { group: 'sonder', label: 'T', desc: 'Große, schnelle Traktoren (bis 60 km/h)', icon: '🚜',
          theoryBase: 12, theoryExtra: 6, ueberland: 0, autobahn: 0, nacht: 0, exam: true },
};

export const GROUPS = {
  zweirad: { label: 'Zweirad', icon: '🏍️', sub: 'Motorrad & Mofa' },
  pkw:     { label: 'PKW', icon: '🚗', sub: 'Auto & Anhänger' },
  lkw:     { label: 'LKW', icon: '🚛', sub: 'Berufskraftverkehr' },
  bus:     { label: 'Bus', icon: '🚌', sub: 'Personenbeförderung' },
  sonder:  { label: 'Traktor & Sonder', icon: '🚜', sub: 'Sonderklassen' },
};

/* ── Verfügbarkeits-Raster: 90-Minuten-Slots (Abschnitt 4A) ─────────────── */
export const SLOTS = [
  { id: 1, label: 'Slot 1', time: '08:00 – 09:30', start: '08:00' },
  { id: 2, label: 'Slot 2', time: '09:45 – 11:15', start: '09:45' },
  { id: 3, label: 'Slot 3', time: '11:30 – 13:00', start: '11:30' },
  { id: 4, label: 'Slot 4', time: '13:30 – 15:00', start: '13:30' },
  { id: 5, label: 'Slot 5', time: '15:15 – 16:45', start: '15:15' },
  { id: 6, label: 'Slot 6', time: '17:00 – 18:30', start: '17:00' },
];
export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/* ── Theorie-Lehrplan (Themen X) ────────────────────────────────────────── */
export const THEORY_TOPICS = [
  { nr: 1,  title: 'Persönliche Voraussetzungen / Risikofaktor Mensch', kind: 'grund' },
  { nr: 2,  title: 'Risikofaktor Mensch & Verantwortung', kind: 'grund' },
  { nr: 3,  title: 'Vorfahrt & Verkehrsregelungen', kind: 'grund' },
  { nr: 4,  title: 'Verkehrszeichen & Verkehrseinrichtungen', kind: 'grund' },
  { nr: 5,  title: 'Straßenverkehrssystem & seine Nutzung', kind: 'grund' },
  { nr: 6,  title: 'Vorausschauendes & defensives Fahren', kind: 'grund' },
  { nr: 7,  title: 'Geschwindigkeit, Abstand & umweltschonendes Fahren', kind: 'grund' },
  { nr: 8,  title: 'Andere Teilnehmer / Personenbeförderung', kind: 'grund' },
  { nr: 9,  title: 'Verkehrsverhalten bei Fahrmanövern', kind: 'grund' },
  { nr: 10, title: 'Ruhender Verkehr & Umweltbewusstsein', kind: 'grund' },
  { nr: 11, title: 'Lebenslanges Lernen / Verhalten in besonderen Situationen', kind: 'grund' },
  { nr: 12, title: 'Technische Bedingungen / Personen- & Güterbeförderung', kind: 'grund' },
  // Zusatzstoff (klassenspezifisch)
  { nr: 'B1', title: 'Zusatzstoff B: Fahrtechnik & Beladung', kind: 'zusatz', forGroups: ['pkw'] },
  { nr: 'B2', title: 'Zusatzstoff B: Fahren mit Anhänger', kind: 'zusatz', forGroups: ['pkw'] },
  { nr: 'A1', title: 'Zusatzstoff Motorrad: Schutzkleidung & Fahrphysik', kind: 'zusatz', forGroups: ['zweirad'] },
  { nr: 'A2', title: 'Zusatzstoff Motorrad: Kurventechnik & Sichtbarkeit', kind: 'zusatz', forGroups: ['zweirad'] },
  { nr: 'C1', title: 'Zusatzstoff C: Abmessungen, Achslasten & Sicherung', kind: 'zusatz', forGroups: ['lkw'] },
  { nr: 'C2', title: 'Zusatzstoff C: Sozialvorschriften & Kontrollgerät', kind: 'zusatz', forGroups: ['lkw'] },
  { nr: 'D1', title: 'Zusatzstoff D: Fahrgastsicherheit & Beförderung', kind: 'zusatz', forGroups: ['bus'] },
  { nr: 'L1', title: 'Zusatzstoff L/T: Landwirtschaftliche Fahrzeuge', kind: 'zusatz', forGroups: ['sonder'] },
];

/* ── Kern-Berechnung: Pflichtstunden je Schüler (Regel 1 & Aufstiegslogik)  */
export function computeRequirements(student) {
  const cls = LICENSE_MATRIX[student.licenseClass];
  if (!cls) return null;
  const zweit = student.acquisitionType === 'zweit';

  // Zweirad-Aufstieg: Theorie & Sonderfahrten entfallen komplett
  const isUpgrade = !!student.motorradAufstieg && (cls.upgradeFrom);

  let theoryBase = cls.theoryBase;
  let theoryExtra = cls.theoryExtra;
  let ueberland = cls.ueberland;
  let autobahn = cls.autobahn;
  let nacht = cls.nacht;
  const notes = [];

  if (isUpgrade) {
    theoryBase = 0; theoryExtra = 0; ueberland = 0; autobahn = 0; nacht = 0;
    notes.push('Aufstieg: Theorie entfällt komplett – nur die praktische Prüfung ist nötig.');
  } else if (zweit && theoryBase === 12) {
    // Regel 1: Zweit-Erwerb reduziert Grundstoff 12 → 6
    theoryBase = 6;
    notes.push('Zweit-Erwerb: Theorie-Grundstoff automatisch von 12 auf 6 Einheiten reduziert.');
  }

  if (cls.note) notes.push(cls.note);
  if (cls.combinedTheory) notes.push(`Theorie wird mit Grundklasse ${cls.combinedTheory} kombiniert.`);

  return {
    licenseClass: student.licenseClass,
    theoryBase,
    theoryExtra,
    theoryTotal: theoryBase + theoryExtra,
    special: { ueberland: ueberland || 0, autobahn: autobahn || 0, nacht: nacht || 0 },
    specialTotal: (ueberland || 0) + (autobahn || 0) + (nacht || 0),
    hasTheory: theoryBase + theoryExtra > 0,
    hasSpecial: (ueberland || 0) + (autobahn || 0) + (nacht || 0) > 0,
    hasExam: cls.exam,
    variable: !!cls.variable,
    training: cls.training || 0,
    simulatorTarget: 6,
    notes,
  };
}

/* ── Fortschritts-Auswertung (Ebene A des Dashboards) ───────────────────── */
export function computeProgress(student) {
  const req = computeRequirements(student);
  if (!req) return null;
  const p = student.progress || {};
  const theoryDone = (p.theoryAttended || []).length;
  const special = p.special || { ueberland: 0, autobahn: 0, nacht: 0 };

  return {
    req,
    theory: { done: theoryDone, total: req.theoryTotal, pct: pct(theoryDone, req.theoryTotal) },
    ueberland: { done: special.ueberland || 0, total: req.special.ueberland, pct: pct(special.ueberland, req.special.ueberland) },
    autobahn: { done: special.autobahn || 0, total: req.special.autobahn, pct: pct(special.autobahn, req.special.autobahn) },
    nacht: { done: special.nacht || 0, total: req.special.nacht, pct: pct(special.nacht, req.special.nacht) },
    practice: p.practice || 0,
    simulator: { done: p.simulator || 0, total: req.simulatorTarget, pct: pct(p.simulator || 0, req.simulatorTarget) },
    grundausbildungDone: !!p.grundausbildungDone,
    specialUnlocked: !!p.grundausbildungDone, // Regel 2
  };
}

function pct(a, b) { if (!b) return 0; return Math.min(100, Math.round((a / b) * 100)); }

/* ── Prüfungs-Ready (Ebene C · 5 Bedingungen) ──────────────────────────── */
export function computeExamReady(student) {
  const prog = computeProgress(student);
  const docs = student.documents || {};
  const finance = student.finance || { balance: 0 };
  const checks = [
    { id: 'finance', label: 'Alle Zahlungen vollständig (Kontostand 0 €)',
      ok: (finance.balance || 0) <= 0 },
    { id: 'docs', label: 'Sehtest, Erste Hilfe & Passbild amtlich verifiziert',
      ok: docs.sehtest === 'verified' && docs.ersteHilfe === 'verified' && docs.passbild === 'verified' },
    { id: 'theory', label: 'Theorieprüfung erfolgreich bestanden',
      ok: !!student.exams?.theoryPassed },
    { id: 'special', label: 'Alle Sonderfahrten absolviert oder fest eingeplant',
      ok: specialFulfilledOrScheduled(student, prog) },
    { id: 'go', label: 'Fahrlehrer hat das digitale „GO" erteilt',
      ok: !!student.instructorGo },
  ];
  const ready = checks.every(c => c.ok);
  return { ready, checks };
}

function specialFulfilledOrScheduled(student, prog) {
  if (!prog) return false;
  const need = prog.req.special;
  const have = (student.progress?.special) || { ueberland: 0, autobahn: 0, nacht: 0 };
  // gezählte fest gebuchte zukünftige Sonderfahrten
  const scheduled = { ueberland: 0, autobahn: 0, nacht: 0 };
  (student.appointments || []).forEach(a => {
    if (a.status === 'booked' && a.special && scheduled[a.special] != null) scheduled[a.special]++;
  });
  return ['ueberland', 'autobahn', 'nacht'].every(k =>
    (have[k] || 0) + (scheduled[k] || 0) >= (need[k] || 0));
}

/* Darf der Schüler die Theorieprüfung anmelden? (Mindeststunden erfüllt) */
export function canRegisterTheoryExam(student) {
  const prog = computeProgress(student);
  if (!prog) return false;
  return prog.theory.done >= prog.req.theoryTotal && prog.req.hasExam;
}

/* ════════════════════════════════════════════════════════════════════════
   MATCHING-ENGINE (Abschnitt 4B & 4C)
   ════════════════════════════════════════════════════════════════════════ */

/* Schlüssel eines Zeitfensters: "weekdayIndex-slotId" */
export function gridKey(day, slot) { return `${day}-${slot}`; }

/* 4B · Terminvorschläge generieren:
   Schüler-Verfügbarkeit ∩ Fahrlehrer-frei ∩ Fahrzeug-frei              */
export function generateProposals(student, instructors, vehicles, existingProposals = []) {
  const avail = student.availability || {};
  const cls = LICENSE_MATRIX[student.licenseClass];
  const proposals = [];
  const taken = new Set(existingProposals.map(p => p.slotKey));

  for (const inst of instructors) {
    // Fahrlehrer muss die Klasse unterrichten dürfen
    if (!inst.classes.includes(cls.group) && !inst.classes.includes('all')) continue;
    for (const day of [0, 1, 2, 3, 4, 5]) {
      for (const slot of SLOTS) {
        const key = gridKey(day, slot.id);
        if (!avail[key]) continue;                 // Schüler nicht verfügbar
        if (!(inst.free || []).includes(key)) continue; // Fahrlehrer nicht frei
        const vehicle = vehicles.find(v => v.group === cls.group && (v.free || []).includes(key));
        if (!vehicle) continue;                    // kein passendes Fahrzeug
        const slotKey = `${inst.id}-${key}`;
        if (taken.has(slotKey)) continue;
        proposals.push({
          id: `prop-${slotKey}-${Date.now()}`,
          slotKey, day, slot: slot.id,
          slotTime: slot.time,
          weekday: WEEKDAYS_LONG[day],
          instructorId: inst.id,
          instructorName: inst.name,
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          licenseClass: student.licenseClass,
          createdAt: Date.now(),
          status: 'proposed',
        });
      }
    }
  }
  // beste zuerst (frühe Wochentage / Slots zuerst)
  proposals.sort((a, b) => a.day - b.day || a.slot - b.slot);
  return proposals.slice(0, 6);
}

/* 4C · Speed-Matching: freigewordenen Slot an passende Kandidaten verteilen.
   Kriterien: Slot im Verfügbarkeits-Raster aktiv  &  fehlender Fahrt-Typ.   */
export function findExpressCandidates(freedSlot, students) {
  const key = gridKey(freedSlot.day, freedSlot.slot);
  const out = [];
  for (const s of students) {
    if (s.id === freedSlot.excludeStudentId) continue;
    if (!(s.availability || {})[key]) continue;         // Slot nicht markiert
    const prog = computeProgress(s);
    if (!prog || !prog.specialUnlocked) {
      // ohne abgeschlossene Grundausbildung zählt nur als Übungsstunde
      if (freedSlot.special) continue;
    }
    // fehlt genau dieser Fahrt-Typ noch?
    let needsType = true;
    if (freedSlot.special && prog) {
      const t = prog[freedSlot.special];
      needsType = t && t.done < t.total;
    }
    if (!needsType) continue;
    // Klassen-Kompatibilität
    if (freedSlot.group && LICENSE_MATRIX[s.licenseClass]?.group !== freedSlot.group) continue;
    out.push({ studentId: s.id, name: s.name, missingType: freedSlot.special || 'übung' });
  }
  return out;
}

/* Hilfs-Export für Tests im Node-Kontext */
export const __engine = { pct, specialFulfilledOrScheduled };
