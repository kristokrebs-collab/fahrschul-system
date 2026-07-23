import { auditEreignisse, fahrlehrer, fahrzeuge, terminbuchungen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { checkBookingConflicts, type ExistingBooking } from "@fahrschul/scheduling";
import { and, eq, ne, gt, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const bookingSchema = z.object({
  schuelerId: z.string().uuid(),
  fahrlehrerId: z.string().uuid(),
  fahrzeugId: z.string().uuid().nullable().optional(),
  beginnAt: z.coerce.date(),
  endeAt: z.coerce.date(),
  art: z.string().min(1),
  klasse: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

/** SQLSTATE für PostgreSQL EXCLUDE-Constraint-Verletzung. */
const EXCLUSION_VIOLATION = "23P01";
const UNIQUE_VIOLATION = "23505";

export function registerAppointmentRoutes(app: FastifyInstance, db: Database) {
  app.post(
    "/appointments",
    { preHandler: [requireAuth, requirePermission("appointments:create")] },
    async (request, reply) => {
      const parsed = bookingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const body = parsed.data;

      if (!(body.beginnAt < body.endeAt)) {
        return reply.code(400).send({ error: "invalid_interval" });
      }

      try {
        const result = await db.transaction(async (tx) => {
          // Idempotenz: identischer Schlüssel => derselbe Datensatz wird
          // zurückgegeben, es entsteht KEINE zweite Buchung.
          if (body.idempotencyKey) {
            const existing = await tx
              .select()
              .from(terminbuchungen)
              .where(eq(terminbuchungen.idempotencyKey, body.idempotencyKey))
              .limit(1);
            if (existing[0]) {
              return { booking: existing[0], reused: true as const };
            }
          }

          // Fachliche Vorprüfung (bessere Fehlermeldung als der rohe
          // DB-Constraint-Fehler). Die eigentliche, race-sichere Instanz
          // ist der EXCLUDE-Constraint aus Migration 0002 weiter unten.
          const [qualification] = await tx
            .select({ fahrlehrerId: fahrlehrer.id, klassen: fahrlehrer.klassen })
            .from(fahrlehrer)
            .where(eq(fahrlehrer.id, body.fahrlehrerId))
            .limit(1);

          const vehicleRow = body.fahrzeugId
            ? (
                await tx
                  .select({ fahrzeugId: fahrzeuge.id, klasse: fahrzeuge.klasse })
                  .from(fahrzeuge)
                  .where(eq(fahrzeuge.id, body.fahrzeugId))
                  .limit(1)
              )[0] ?? null
            : null;

          const overlapping = await tx
            .select()
            .from(terminbuchungen)
            .where(
              and(
                ne(terminbuchungen.status, "cancelled"),
                eq(terminbuchungen.fahrlehrerId, body.fahrlehrerId),
                lt(terminbuchungen.beginnAt, body.endeAt),
                gt(terminbuchungen.endeAt, body.beginnAt),
              ),
            );

          const conflictCheck = checkBookingConflicts(
            {
              fahrlehrerId: body.fahrlehrerId,
              fahrzeugId: body.fahrzeugId ?? null,
              klasse: body.klasse as never,
              beginnAt: body.beginnAt,
              endeAt: body.endeAt,
            },
            {
              existingBookings: overlapping as unknown as ExistingBooking[],
              instructorQualification: qualification
                ? {
                    fahrlehrerId: qualification.fahrlehrerId,
                    klassen: qualification.klassen as never,
                  }
                : null,
              vehicleClass: vehicleRow
                ? { fahrzeugId: vehicleRow.fahrzeugId, klasse: vehicleRow.klasse as never }
                : null,
            },
          );

          if (!conflictCheck.ok) {
            const conflictError = new Error("booking_conflict") as Error & {
              code: string;
              reasons: string[];
            };
            conflictError.code = "APP_BOOKING_CONFLICT";
            conflictError.reasons = conflictCheck.reasons;
            throw conflictError;
          }

          const [inserted] = await tx
            .insert(terminbuchungen)
            .values({
              standortId: request.user!.standortId,
              schuelerId: body.schuelerId,
              fahrlehrerId: body.fahrlehrerId,
              fahrzeugId: body.fahrzeugId ?? null,
              beginnAt: body.beginnAt,
              endeAt: body.endeAt,
              art: body.art,
              idempotencyKey: body.idempotencyKey ?? null,
            })
            .returning();

          await tx.insert(auditEreignisse).values(
            buildEventRow({
              type: "lesson.booked",
              aktion: "appointments.create",
              entitaet: "terminbuchung",
              entitaetId: inserted.id,
              akteurBenutzerId: request.user!.id,
              standortId: request.user!.standortId,
              source: "apps/api:appointments.create",
              idempotencyKey: body.idempotencyKey ?? null,
              nachher: inserted,
            }),
          );

          return { booking: inserted, reused: false as const };
        });

        return reply.code(result.reused ? 200 : 201).send(result);
      } catch (err) {
        const pgError = err as { code?: string; constraint?: string };
        if (pgError.code === EXCLUSION_VIOLATION || pgError.code === UNIQUE_VIOLATION) {
          return reply.code(409).send({
            error: "booking_conflict",
            reason: "DB_CONSTRAINT",
            constraint: pgError.constraint,
          });
        }
        const appError = err as { code?: string; reasons?: string[] };
        if (appError.code === "APP_BOOKING_CONFLICT") {
          return reply.code(409).send({ error: "booking_conflict", reasons: appError.reasons });
        }
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
}
