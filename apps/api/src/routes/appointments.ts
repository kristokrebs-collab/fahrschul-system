import type { Database } from "@fahrschul/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  BookingConflictError,
  EXCLUSION_VIOLATION,
  performBooking,
  UNIQUE_VIOLATION,
} from "../services/booking.js";

const bookingSchema = z.object({
  schuelerId: z.string().uuid(),
  fahrlehrerId: z.string().uuid(),
  fahrzeugId: z.string().uuid().nullable().optional(),
  raumId: z.string().uuid().nullable().optional(),
  simulatorgeraetId: z.string().uuid().nullable().optional(),
  getriebeart: z.enum(["schaltung", "automatik"]).optional(),
  beginnAt: z.coerce.date(),
  endeAt: z.coerce.date(),
  art: z.string().min(1),
  klasse: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

export function registerAppointmentRoutes(app: FastifyInstance, db: Database) {
  /**
   * Direkte Terminanlage durch Fahrlehrer/Büro (appointments:create).
   * Schüler dürfen diesen Endpunkt NICHT nutzen – sie nehmen stattdessen ein
   * bestehendes Angebot über POST /appointment-offers/:id/accept an (siehe
   * routes/appointment-offers.ts, permission appointments:accept:own).
   */
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
        const result = await db.transaction((tx) =>
          performBooking(tx, {
            schuelerId: body.schuelerId,
            fahrlehrerId: body.fahrlehrerId,
            fahrzeugId: body.fahrzeugId ?? null,
            raumId: body.raumId ?? null,
            simulatorgeraetId: body.simulatorgeraetId ?? null,
            getriebeart: body.getriebeart,
            beginnAt: body.beginnAt,
            endeAt: body.endeAt,
            art: body.art,
            klasse: body.klasse,
            idempotencyKey: body.idempotencyKey ?? null,
            standortId: request.user!.standortId,
            akteurBenutzerId: request.user!.id,
            eventType: "lesson.booked",
            eventSource: "apps/api:appointments.create",
          }),
        );

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
        if (err instanceof BookingConflictError) {
          return reply.code(409).send({ error: "booking_conflict", reasons: err.reasons });
        }
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
}
