import { auditEreignisse, fahrlehrer, fahrzeuge, terminbuchungen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { checkBookingConflicts, type ExistingBooking } from "@fahrschul/scheduling";
import { and, eq, ne, gt, lt } from "drizzle-orm";
import type { AuditEventType } from "@fahrschul/events";

/** SQLSTATE für PostgreSQL EXCLUDE-Constraint-Verletzung bzw. unique_violation. */
export const EXCLUSION_VIOLATION = "23P01";
export const UNIQUE_VIOLATION = "23505";

export class BookingConflictError extends Error {
  code = "APP_BOOKING_CONFLICT" as const;
  reasons: string[];
  constructor(reasons: string[]) {
    super("booking_conflict");
    this.reasons = reasons;
  }
}

export interface BookingInput {
  terminangebotId?: string | null;
  schuelerId: string;
  fahrlehrerId: string;
  fahrzeugId?: string | null;
  beginnAt: Date;
  endeAt: Date;
  art: string;
  klasse: string;
  idempotencyKey?: string | null;
  standortId: string | null;
  akteurBenutzerId: string;
  eventType: AuditEventType;
  eventSource: string;
}

/**
 * Gemeinsame, race-sichere Buchungs-Transaktionslogik. Wird sowohl von
 * `POST /appointments` (Fahrlehrer/Büro legen direkt einen Termin an) als
 * auch von `POST /appointment-offers/:id/accept` (Schüler nimmt ein
 * bestehendes Angebot an) verwendet – siehe Aufgabenstellung: "reuse/extend
 * the existing apps/api booking endpoint and its transactional conflict
 * check". Die eigentliche Instanz gegen Race Conditions ist weiterhin der
 * DB-EXCLUDE-Constraint aus Migration 0002 (+ der Unique-Index aus 0003 für
 * "ein Angebot wird nur einmal gebucht"), diese Funktion liefert nur die
 * fachlich verständliche Vorprüfung und das Insert innerhalb derselben
 * Transaktion wie der Aufrufer.
 */
type TxCallback = Parameters<Database["transaction"]>[0];
export type Tx = TxCallback extends (tx: infer T, ...args: never[]) => unknown ? T : never;

export async function performBooking(tx: Tx, input: BookingInput) {
  if (input.idempotencyKey) {
    const existing = await tx
      .select()
      .from(terminbuchungen)
      .where(eq(terminbuchungen.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing[0]) {
      return { booking: existing[0], reused: true as const };
    }
  }

  const [qualification] = await tx
    .select({ fahrlehrerId: fahrlehrer.id, klassen: fahrlehrer.klassen })
    .from(fahrlehrer)
    .where(eq(fahrlehrer.id, input.fahrlehrerId))
    .limit(1);

  const vehicleRow = input.fahrzeugId
    ? (
        await tx
          .select({ fahrzeugId: fahrzeuge.id, klasse: fahrzeuge.klasse })
          .from(fahrzeuge)
          .where(eq(fahrzeuge.id, input.fahrzeugId))
          .limit(1)
      )[0] ?? null
    : null;

  const overlapping = await tx
    .select()
    .from(terminbuchungen)
    .where(
      and(
        ne(terminbuchungen.status, "cancelled"),
        eq(terminbuchungen.fahrlehrerId, input.fahrlehrerId),
        lt(terminbuchungen.beginnAt, input.endeAt),
        gt(terminbuchungen.endeAt, input.beginnAt),
      ),
    );

  const conflictCheck = checkBookingConflicts(
    {
      fahrlehrerId: input.fahrlehrerId,
      fahrzeugId: input.fahrzeugId ?? null,
      klasse: input.klasse as never,
      beginnAt: input.beginnAt,
      endeAt: input.endeAt,
    },
    {
      existingBookings: overlapping as unknown as ExistingBooking[],
      instructorQualification: qualification
        ? { fahrlehrerId: qualification.fahrlehrerId, klassen: qualification.klassen as never }
        : null,
      vehicleClass: vehicleRow
        ? { fahrzeugId: vehicleRow.fahrzeugId, klasse: vehicleRow.klasse as never }
        : null,
    },
  );

  if (!conflictCheck.ok) {
    throw new BookingConflictError(conflictCheck.reasons);
  }

  const [inserted] = await tx
    .insert(terminbuchungen)
    .values({
      standortId: input.standortId,
      terminangebotId: input.terminangebotId ?? null,
      schuelerId: input.schuelerId,
      fahrlehrerId: input.fahrlehrerId,
      fahrzeugId: input.fahrzeugId ?? null,
      beginnAt: input.beginnAt,
      endeAt: input.endeAt,
      art: input.art,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .returning();

  await tx.insert(auditEreignisse).values(
    buildEventRow({
      type: input.eventType,
      aktion: "appointments.create",
      entitaet: "terminbuchung",
      entitaetId: inserted.id,
      akteurBenutzerId: input.akteurBenutzerId,
      standortId: input.standortId,
      source: input.eventSource,
      idempotencyKey: input.idempotencyKey ?? null,
      nachher: inserted,
    }),
  );

  return { booking: inserted, reused: false as const };
}
