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
 */

export interface TimeInterval {
  beginnAt: Date;
  endeAt: Date;
}

export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.beginnAt < b.endeAt && b.beginnAt < a.endeAt;
}

export interface ExistingBooking extends TimeInterval {
  id: string;
  fahrlehrerId: string;
  fahrzeugId: string | null;
  status: string;
}

export interface BookingRequest extends TimeInterval {
  fahrlehrerId: string;
  fahrzeugId: string | null;
  klasse: FahrerlaubnisklasseCode;
}

export interface FahrlehrerQualifikation {
  fahrlehrerId: string;
  klassen: FahrerlaubnisklasseCode[];
}

export interface FahrzeugKlasse {
  fahrzeugId: string;
  klasse: FahrerlaubnisklasseCode;
}

export type ConflictReason =
  | "INSTRUCTOR_NOT_QUALIFIED"
  | "INSTRUCTOR_DOUBLE_BOOKED"
  | "VEHICLE_WRONG_CLASS"
  | "VEHICLE_DOUBLE_BOOKED"
  | "INVALID_INTERVAL";

export interface ConflictCheckResult {
  ok: boolean;
  reasons: ConflictReason[];
}

const CANCELLED_STATUSES = new Set(["cancelled", "storniert"]);

/**
 * Prüft eine Buchungsanfrage gegen bereits existierende (nicht stornierte)
 * Buchungen sowie Qualifikations-/Fahrzeugklassen-Stammdaten. Wird sowohl aus
 * apps/api (mit aus der DB geladenen Daten, innerhalb einer Transaktion) als
 * auch direkt in Tests aufgerufen.
 */
export function checkBookingConflicts(
  request: BookingRequest,
  context: {
    existingBookings: ExistingBooking[];
    instructorQualification: FahrlehrerQualifikation | null;
    vehicleClass: FahrzeugKlasse | null;
  },
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

  const instructorConflict = relevantBookings.some(
    (b) => b.fahrlehrerId === request.fahrlehrerId && intervalsOverlap(b, request),
  );
  if (instructorConflict) {
    reasons.push("INSTRUCTOR_DOUBLE_BOOKED");
  }

  if (request.fahrzeugId) {
    if (!context.vehicleClass || context.vehicleClass.klasse !== request.klasse) {
      reasons.push("VEHICLE_WRONG_CLASS");
    }

    const vehicleConflict = relevantBookings.some(
      (b) => b.fahrzeugId === request.fahrzeugId && intervalsOverlap(b, request),
    );
    if (vehicleConflict) {
      reasons.push("VEHICLE_DOUBLE_BOOKED");
    }
  }

  return { ok: reasons.length === 0, reasons };
}
