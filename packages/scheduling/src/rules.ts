import type { FahrerlaubnisklasseCode } from "@fahrschul/domain";

/**
 * Harte Matching-Regeln (Spec: "Keine Terminbuchung ohne serverseitige
 * Konfliktprüfung"). Diese Funktionen sind reine, DB-unabhängige Bausteine,
 * die von apps/api innerhalb der Transaktion aufgerufen werden UND separat
 * unit-getestet werden können, ohne eine Datenbank zu benötigen. Die
 * eigentliche Autorität gegen Wettlaufsituationen (zwei gleichzeitige
 * Buchungsversuche) liegt zusätzlich in der SQL-Transaktion selbst
 * (SELECT ... FOR UPDATE + Übersschneidungs-WHERE, siehe
 * apps/api/src/routes/appointments.ts) – diese Funktionen sind kein Ersatz
 * dafür, sondern die geteilte fachliche Logik.
 *
 * Prompt 2 erweitert diese Datei um die restlichen "harten Matching-Regeln"
 * aus der Aufgabenstellung, die in Prompt 0/1 noch fehlten: Schüler frei,
 * Raum/Simulator frei, Getriebeart (Automatik/Schaltung/B197),
 * Handicap-Ausstattung, Fahrzeug einsatzbereit, Pause/Arbeitszeit
 * (Mindestpause zwischen zwei Fahrten desselben Fahrlehrers),
 * Ausbildungsreihenfolge (Sonderfahrt erst nach einer Mindestzahl
 * Übungsstunden – Zahl ist laut docs/fachliche-bestaetigungen.md Punkt 9
 * fachlich UNBESTÄTIGT und daher als benannte Konstante markiert).
 */

export interface TimeInterval {
  beginnAt: Date;
  endeAt: Date;
}

export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.beginnAt < b.endeAt && b.beginnAt < a.endeAt;
}

/** Millisekunden Abstand zwischen zwei Intervallen (0, wenn sie sich überlappen). */
function gapMillis(a: TimeInterval, b: TimeInterval): number {
  if (intervalsOverlap(a, b)) return 0;
  if (a.endeAt <= b.beginnAt) return b.beginnAt.getTime() - a.endeAt.getTime();
  return a.beginnAt.getTime() - b.endeAt.getTime();
}

export interface ExistingBooking extends TimeInterval {
  id: string;
  fahrlehrerId: string;
  fahrzeugId: string | null;
  schuelerId?: string;
  raumId?: string | null;
  simulatorgeraetId?: string | null;
  status: string;
}

export interface BookingRequest extends TimeInterval {
  fahrlehrerId: string;
  fahrzeugId: string | null;
  schuelerId?: string;
  raumId?: string | null;
  simulatorgeraetId?: string | null;
  klasse: FahrerlaubnisklasseCode;
  getriebeart?: "schaltung" | "automatik";
  art?: string;
}

export interface FahrlehrerQualifikation {
  fahrlehrerId: string;
  klassen: FahrerlaubnisklasseCode[];
}

export interface FahrzeugKlasse {
  fahrzeugId: string;
  klasse: FahrerlaubnisklasseCode;
  status?: string;
  automatik?: boolean;
  handicapAusstattung?: string[];
}

export type ConflictReason =
  | "INSTRUCTOR_NOT_QUALIFIED"
  | "INSTRUCTOR_DOUBLE_BOOKED"
  | "VEHICLE_WRONG_CLASS"
  | "VEHICLE_DOUBLE_BOOKED"
  | "INVALID_INTERVAL"
  | "STUDENT_DOUBLE_BOOKED"
  | "ROOM_DOUBLE_BOOKED"
  | "SIMULATOR_DOUBLE_BOOKED"
  | "VEHICLE_NOT_READY"
  | "GEARBOX_MISMATCH"
  | "HANDICAP_EQUIPMENT_MISSING"
  | "MIN_BREAK_VIOLATED"
  | "TRAINING_ORDER_VIOLATED";

export interface ConflictCheckResult {
  ok: boolean;
  reasons: ConflictReason[];
}

const CANCELLED_STATUSES = new Set(["cancelled", "storniert"]);
const UNAVAILABLE_VEHICLE_STATUSES = new Set(["wartung", "defekt", "gesperrt"]);

/**
 * Fachlich UNBESTÄTIGTE Mindestzahl an Übungsstunden vor der ersten
 * Sonderfahrt (docs/fachliche-bestaetigungen.md Punkt 9 ist offen). Bewusst
 * konservativ als benannte Konstante statt stillschweigend im Code verteilt,
 * damit sie beim fachlichen GO-Live leicht ersetzbar ist.
 */
export const UNBESTAETIGT_MIN_UEBUNGSSTUNDEN_VOR_SONDERFAHRT = 5;

/**
 * Fachlich UNBESTÄTIGTE Mindestpause zwischen zwei Fahrten desselben
 * Fahrlehrers (docs/fachliche-bestaetigungen.md Punkt 7 ist offen, keine
 * Wegezeit-/Pausenregel je Standort bestätigt).
 */
export const UNBESTAETIGT_MIN_PAUSE_MINUTEN = 15;

export interface MatchingContext {
  existingBookings: ExistingBooking[];
  instructorQualification: FahrlehrerQualifikation | null;
  vehicleClass: FahrzeugKlasse | null;
  /** Anzahl bereits absolvierter, nicht stornierter Übungsstunden dieser Ausbildung. */
  completedUebungsstunden?: number;
  /** Bedarf des Schülers an Handicap-Ausstattung (Codes, müssen Teilmenge der Fahrzeugausstattung sein). */
  handicapBedarf?: string[];
  minPauseMinuten?: number;
}

/**
 * Prüft eine Buchungsanfrage gegen bereits existierende (nicht stornierte)
 * Buchungen sowie Qualifikations-/Fahrzeugklassen-Stammdaten. Wird sowohl aus
 * apps/api (mit aus der DB geladenen Daten, innerhalb einer Transaktion) als
 * auch direkt in Tests aufgerufen.
 */
export function checkBookingConflicts(
  request: BookingRequest,
  context: MatchingContext,
): ConflictCheckResult {
  const reasons: ConflictReason[] = [];

  if (!(request.beginnAt < request.endeAt)) {
    reasons.push("INVALID_INTERVAL");
    return { ok: false, reasons };
  }

  if (
    !context.instructorQualification ||
    !context.instructorQualification.klassen.includes(request.klasse)
  ) {
    reasons.push("INSTRUCTOR_NOT_QUALIFIED");
  }

  const relevantBookings = context.existingBookings.filter(
    (b) => !CANCELLED_STATUSES.has(b.status),
  );

  const instructorBookings = relevantBookings.filter((b) => b.fahrlehrerId === request.fahrlehrerId);

  const instructorConflict = instructorBookings.some((b) => intervalsOverlap(b, request));
  if (instructorConflict) {
    reasons.push("INSTRUCTOR_DOUBLE_BOOKED");
  } else {
    // Pause/Arbeitszeit (harte Regel): auch ohne direkte Überlappung muss ein
    // Mindestabstand zur vorherigen/nächsten Fahrt desselben Fahrlehrers liegen.
    const minPauseMs = (context.minPauseMinuten ?? UNBESTAETIGT_MIN_PAUSE_MINUTEN) * 60_000;
    const breakViolated = instructorBookings.some((b) => gapMillis(b, request) < minPauseMs);
    if (breakViolated) {
      reasons.push("MIN_BREAK_VIOLATED");
    }
  }

  if (request.schuelerId) {
    const studentConflict = relevantBookings.some(
      (b) => b.schuelerId === request.schuelerId && intervalsOverlap(b, request),
    );
    if (studentConflict) {
      reasons.push("STUDENT_DOUBLE_BOOKED");
    }
  }

  if (request.raumId) {
    const roomConflict = relevantBookings.some(
      (b) => b.raumId === request.raumId && intervalsOverlap(b, request),
    );
    if (roomConflict) {
      reasons.push("ROOM_DOUBLE_BOOKED");
    }
  }

  if (request.simulatorgeraetId) {
    const simConflict = relevantBookings.some(
      (b) => b.simulatorgeraetId === request.simulatorgeraetId && intervalsOverlap(b, request),
    );
    if (simConflict) {
      reasons.push("SIMULATOR_DOUBLE_BOOKED");
    }
  }

  if (request.fahrzeugId) {
    if (!context.vehicleClass || context.vehicleClass.klasse !== request.klasse) {
      reasons.push("VEHICLE_WRONG_CLASS");
    }

    if (context.vehicleClass?.status && UNAVAILABLE_VEHICLE_STATUSES.has(context.vehicleClass.status)) {
      reasons.push("VEHICLE_NOT_READY");
    }

    if (request.getriebeart === "automatik" && context.vehicleClass && !context.vehicleClass.automatik) {
      reasons.push("GEARBOX_MISMATCH");
    }

    const bedarf = context.handicapBedarf ?? [];
    if (bedarf.length > 0) {
      const ausstattung = new Set(context.vehicleClass?.handicapAusstattung ?? []);
      const missing = bedarf.some((code) => !ausstattung.has(code));
      if (missing) {
        reasons.push("HANDICAP_EQUIPMENT_MISSING");
      }
    }

    const vehicleConflict = relevantBookings.some(
      (b) => b.fahrzeugId === request.fahrzeugId && intervalsOverlap(b, request),
    );
    if (vehicleConflict) {
      reasons.push("VEHICLE_DOUBLE_BOOKED");
    }
  }

  if (request.art === "Sonderfahrt") {
    const completed = context.completedUebungsstunden ?? 0;
    if (completed < UNBESTAETIGT_MIN_UEBUNGSSTUNDEN_VOR_SONDERFAHRT) {
      reasons.push("TRAINING_ORDER_VIOLATED");
    }
  }

  return { ok: reasons.length === 0, reasons };
}
