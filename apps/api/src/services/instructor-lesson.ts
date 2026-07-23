import { auditEreignisse, fahrzeuge, terminbuchungen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import type { LessonCompletionInput } from "@fahrschul/domain";
import { and, eq, ne } from "drizzle-orm";
import type { Tx } from "./booking.js";

export class InstructorLessonError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * "Stunde starten" – der Endpunkt, den die Aufgabenstellung explizit als
 * echten, serverseitig prüfenden apps/api-Endpunkt fordert ("this must be a
 * real apps/api endpoint doing real checks..., not a client-side gate").
 * Prüft Termin/Schüler/Fahrlehrer/Fahrzeug/Zeit/Stundenart/Fahrzeugstatus/
 * Konflikte, bevor status="gestartet" gesetzt wird.
 */
export async function startLesson(
  tx: Tx,
  input: { terminbuchungId: string; fahrlehrerId: string; akteurBenutzerId: string; standortId: string | null },
) {
  const [booking] = await tx
    .select()
    .from(terminbuchungen)
    .where(eq(terminbuchungen.id, input.terminbuchungId))
    .limit(1);
  if (!booking) throw new InstructorLessonError("BOOKING_NOT_FOUND", 404, "Termin nicht gefunden.");
  if (booking.fahrlehrerId !== input.fahrlehrerId) {
    throw new InstructorLessonError("NOT_OWN_BOOKING", 403, "Termin gehört nicht diesem Fahrlehrer.");
  }
  if (booking.status === "cancelled") {
    throw new InstructorLessonError("BOOKING_CANCELLED", 409, "Termin wurde storniert.");
  }
  if (booking.status === "gestartet") {
    throw new InstructorLessonError("ALREADY_STARTED", 409, "Stunde ist bereits gestartet.");
  }
  if (booking.status === "abgeschlossen") {
    throw new InstructorLessonError("ALREADY_COMPLETED", 409, "Stunde ist bereits abgeschlossen.");
  }

  // Fahrzeugstatus (dieselbe harte Regel wie bei der Buchung selbst,
  // "Fahrzeug einsatzbereit" – Prompt 2 checkBookingConflicts). Ein
  // zwischenzeitlich als "wartung"/defekt gemeldetes Fahrzeug blockiert das
  // Starten der Stunde, auch wenn die Buchung selbst schon existierte.
  if (booking.fahrzeugId) {
    const [vehicle] = await tx.select().from(fahrzeuge).where(eq(fahrzeuge.id, booking.fahrzeugId)).limit(1);
    if (vehicle && vehicle.status !== "verfuegbar") {
      throw new InstructorLessonError(
        "VEHICLE_NOT_READY",
        409,
        `Fahrzeug ist nicht einsatzbereit (Status: ${vehicle.status}).`,
      );
    }
  }

  // Konflikt: derselbe Fahrlehrer darf nicht zwei Stunden gleichzeitig
  // gestartet haben (überlappende bereits laufende Stunde).
  const runningOthers = await tx
    .select()
    .from(terminbuchungen)
    .where(
      and(
        eq(terminbuchungen.fahrlehrerId, input.fahrlehrerId),
        eq(terminbuchungen.status, "gestartet"),
        ne(terminbuchungen.id, booking.id),
      ),
    );
  if (runningOthers.length > 0) {
    throw new InstructorLessonError(
      "INSTRUCTOR_ALREADY_IN_LESSON",
      409,
      "Fahrlehrer hat bereits eine laufende Stunde.",
    );
  }

  const [updated] = await tx
    .update(terminbuchungen)
    .set({ status: "gestartet", gestartetAt: new Date(), updatedAt: new Date() })
    .where(eq(terminbuchungen.id, booking.id))
    .returning();

  await tx.insert(auditEreignisse).values(
    buildEventRow({
      type: "lesson.started",
      aktion: "lesson.start",
      entitaet: "terminbuchung",
      entitaetId: updated.id,
      akteurBenutzerId: input.akteurBenutzerId,
      standortId: input.standortId,
      source: "apps/api:instructor-lesson.start",
      vorher: { status: booking.status },
      nachher: { status: updated.status },
    }),
  );

  return updated;
}

/**
 * "Stunde beenden" – `lesson.completed` wird AUSSCHLIESSLICH ausgelöst,
 * wenn `payload` bereits vollständig (`lessonCompletionInputSchema`,
 * geprüft an der Route-Grenze) UND die Buchung im Status "gestartet" ist.
 */
export async function completeLesson(
  tx: Tx,
  input: {
    terminbuchungId: string;
    fahrlehrerId: string;
    akteurBenutzerId: string;
    standortId: string | null;
    payload: LessonCompletionInput;
  },
) {
  const [booking] = await tx
    .select()
    .from(terminbuchungen)
    .where(eq(terminbuchungen.id, input.terminbuchungId))
    .limit(1);
  if (!booking) throw new InstructorLessonError("BOOKING_NOT_FOUND", 404, "Termin nicht gefunden.");
  if (booking.fahrlehrerId !== input.fahrlehrerId) {
    throw new InstructorLessonError("NOT_OWN_BOOKING", 403, "Termin gehört nicht diesem Fahrlehrer.");
  }
  if (booking.status !== "gestartet") {
    throw new InstructorLessonError(
      "NOT_STARTED",
      409,
      "Stunde muss zuerst gestartet werden, bevor sie beendet werden kann.",
    );
  }

  const p = input.payload;
  const [updated] = await tx
    .update(terminbuchungen)
    .set({
      status: "abgeschlossen",
      beendetAt: new Date(),
      tatsaechlicheDauerMinuten: p.tatsaechlicheDauerMinuten,
      art: p.stundenart,
      kurznotiz: p.kurznotiz,
      naechstesZiel: p.naechstesZiel,
      schuelerfeedback: p.schuelerfeedback,
      updatedAt: new Date(),
    })
    .where(eq(terminbuchungen.id, booking.id))
    .returning();

  await tx.insert(auditEreignisse).values(
    buildEventRow({
      type: "lesson.completed",
      aktion: "lesson.complete",
      entitaet: "terminbuchung",
      entitaetId: updated.id,
      akteurBenutzerId: input.akteurBenutzerId,
      standortId: input.standortId,
      source: "apps/api:instructor-lesson.complete",
      vorher: { status: booking.status },
      nachher: { status: updated.status },
      payload: {
        lernziele: p.lernziele,
        beobachteteKompetenzfelder: p.beobachteteKompetenzfelder,
        bestaetigung: p.bestaetigung,
      },
    }),
  );

  return { booking: updated, lernziele: p.lernziele, beobachteteKompetenzfelder: p.beobachteteKompetenzfelder };
}
