import { auditEreignisse, terminbuchungen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { hasPermission } from "@fahrschul/permissions";
import { z } from "zod";
import { requireAnyPermission, requireAuth, requirePermission } from "../middleware/auth.js";
import {
  BookingConflictError,
  EXCLUSION_VIOLATION,
  performBooking,
  UNIQUE_VIOLATION,
  type Tx,
} from "../services/booking.js";
import {
  IdempotencyConflictError,
  IDEMPOTENT_OPERATIONS,
  readIdempotencyKey,
  runIdempotent,
  sendIdempotencyConflict,
} from "../lib/idempotency.js";
import {
  assertVersion,
  readExpectedVersion,
  requireExpectedVersion,
  sendVersionConflict,
  VersionConflictError,
  withVersionHeaders,
} from "../lib/optimistic.js";
import { sendBusinessConstraintError, setTransitionContext } from "../lib/state-machine.js";
import { getOwnSchuelerId } from "../services/own-scope.js";

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

const cancelSchema = z.object({
  grund: z.string().min(1).max(500),
  expectedVersion: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(1).optional(),
});

export function registerAppointmentRoutes(app: FastifyInstance, db: Database) {
  /**
   * Direkte Terminanlage durch Fahrlehrer/Büro (appointments:create).
   * Schüler dürfen diesen Endpunkt NICHT nutzen – sie nehmen stattdessen ein
   * bestehendes Angebot über POST /appointment-offers/:id/accept an (siehe
   * routes/appointment-offers.ts, permission appointments:accept:own).
   *
   * PROMPT -1 §2: Wird ein Idempotenzschlüssel mitgeschickt (Header
   * `Idempotency-Key` oder Feld `idempotencyKey`), läuft der Aufruf über den
   * GENERISCHEN Mechanismus in lib/idempotency.ts. Der Unique-Index auf
   * `terminbuchungen.idempotency_key` bleibt als zweite, DB-seitige Sperre
   * erhalten (Verteidigung in der Tiefe) – maßgeblich ist aber genau EINE
   * Mechanik, siehe docs/sync-architecture.md §2.
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

      const idempotencyKey = readIdempotencyKey(request);

      const execute = (tx: Tx) =>
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
          idempotencyKey: idempotencyKey ?? null,
          standortId: request.user!.standortId,
          akteurBenutzerId: request.user!.id,
          eventType: "lesson.booked",
          eventSource: "apps/api:appointments.create",
        });

      try {
        if (idempotencyKey) {
          const outcome = await runIdempotent({
            db,
            operation: IDEMPOTENT_OPERATIONS.appointmentCreate,
            key: idempotencyKey,
            benutzerId: request.user!.id,
            standortId: request.user!.standortId,
            payload: body,
            handler: async (tx) => {
              const result = await execute(tx);
              return {
                status: result.reused ? 200 : 201,
                body: { booking: result.booking, reused: result.reused },
                entitaet: "terminbuchung",
                entitaetId: result.booking.id,
              };
            },
          });
          // Wiedergabe: derselbe Datensatz, aber als Retry markiert (200 +
          // reused:true) – identische Semantik wie vor PROMPT -1.
          const bodyOut = outcome.body as { booking: unknown; reused: boolean };
          return reply
            .code(outcome.replayed ? 200 : outcome.status)
            .send(outcome.replayed ? { ...bodyOut, reused: true } : bodyOut);
        }

        const result = await db.transaction(execute);
        return reply.code(result.reused ? 200 : 201).send(result);
      } catch (err) {
        if (err instanceof IdempotencyConflictError) return sendIdempotencyConflict(err, reply);
        if (err instanceof BookingConflictError) {
          return reply.code(409).send({ error: "booking_conflict", reasons: err.reasons });
        }
        if (sendBusinessConstraintError(err, reply)) return reply;
        const pgError = err as { code?: string; constraint?: string };
        if (pgError.code === EXCLUSION_VIOLATION || pgError.code === UNIQUE_VIOLATION) {
          return reply.code(409).send({
            error: "booking_conflict",
            reason: "DB_CONSTRAINT",
            constraint: pgError.constraint,
          });
        }
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  /**
   * PROMPT -1 §2/§4 – Termin stornieren. NEU in dieser Phase: bis hierhin gab
   * es nur den Storno-Retter-Flow (routes/storno.ts) für Büro, aber keinen
   * generischen, idempotenten Stornoendpunkt.
   *
   * - Idempotenzschlüssel PFLICHT (neuer Endpunkt, keine Altaufrufer):
   *   ein Netzwerk-Retry darf nicht doppelt stornieren/benachrichtigen.
   * - Version PFLICHT: wer auf einem veralteten Stand storniert (der Termin
   *   wurde z. B. inzwischen verlegt), bekommt 409 mit dem aktuellen Zustand.
   */
  app.post(
    "/appointments/:id/cancel",
    {
      preHandler: [
        requireAuth,
        requireAnyPermission("appointments:cancel:own", "appointments:cancel:any"),
      ],
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = cancelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const idempotencyKey = readIdempotencyKey(request);
      if (!idempotencyKey) {
        return reply.code(400).send({
          error: "idempotency_key_required",
          hinweis: 'Header "Idempotency-Key" oder Feld "idempotencyKey" ist für Stornierungen verpflichtend.',
        });
      }
      const expected = requireExpectedVersion(readExpectedVersion(request), reply);
      if (expected === null) return reply;

      const ownSchuelerId = await getOwnSchuelerId(db, request.user!.id);
      // Wer `appointments:cancel:any` hat (Büro), darf fremde Termine
      // stornieren; alle anderen nur eigene (own-Scope gegen die DB geprüft).
      const darfFremde = hasPermission(request.user!.rolle, "appointments:cancel:any");

      try {
        const outcome = await runIdempotent({
          db,
          operation: IDEMPOTENT_OPERATIONS.appointmentCancel,
          key: idempotencyKey,
          benutzerId: request.user!.id,
          standortId: request.user!.standortId,
          target: params.id,
          payload: { grund: parsed.data.grund, expectedVersion: expected },
          handler: async (tx) => {
            const [current] = await tx
              .select()
              .from(terminbuchungen)
              .where(eq(terminbuchungen.id, params.id))
              .limit(1);
            if (!current) throw new NotFoundError();
            if (!darfFremde && current.schuelerId !== ownSchuelerId) throw new ForbiddenError();
            assertVersion(current, expected);
            if (current.status === "cancelled") throw new AlreadyCancelledError();

            await setTransitionContext(tx, {
              akteurBenutzerId: request.user!.id,
              grund: parsed.data.grund,
            });

            const [row] = await tx
              .update(terminbuchungen)
              .set({ status: "cancelled" })
              .where(and(eq(terminbuchungen.id, params.id), eq(terminbuchungen.version, expected)))
              .returning();
            if (!row) {
              const [fresh] = await tx
                .select()
                .from(terminbuchungen)
                .where(eq(terminbuchungen.id, params.id))
                .limit(1);
              throw new VersionConflictError(expected, fresh);
            }

            await tx.insert(auditEreignisse).values(
              buildEventRow({
                type: "lesson.cancelled",
                aktion: "appointments.cancel",
                entitaet: "terminbuchung",
                entitaetId: row.id,
                akteurBenutzerId: request.user!.id,
                standortId: request.user!.standortId,
                source: "apps/api:appointments.cancel",
                idempotencyKey,
                vorher: { status: current.status, version: current.version },
                nachher: { status: row.status, version: row.version },
                payload: { grund: parsed.data.grund },
              }),
            );

            return {
              status: 200,
              body: { appointment: row, cancelled: true },
              entitaet: "terminbuchung",
              entitaetId: row.id,
            };
          },
        });

        const out = outcome.body as { appointment: { id: string; version: number; updatedAt: Date | string | null } };
        withVersionHeaders(reply, out.appointment);
        return reply.code(outcome.status).send({ ...outcome.body, replayed: outcome.replayed });
      } catch (err) {
        if (err instanceof NotFoundError) return reply.code(404).send({ error: "not_found" });
        if (err instanceof ForbiddenError) {
          return reply.code(403).send({ error: "forbidden", reason: "not_own_appointment" });
        }
        if (err instanceof AlreadyCancelledError) {
          return reply.code(409).send({ error: "already_cancelled" });
        }
        if (err instanceof IdempotencyConflictError) return sendIdempotencyConflict(err, reply);
        if (err instanceof VersionConflictError) {
          return sendVersionConflict(err, reply, parsed.data as Record<string, unknown>);
        }
        if (sendBusinessConstraintError(err, reply)) return reply;
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
}

class NotFoundError extends Error {}
class ForbiddenError extends Error {}
class AlreadyCancelledError extends Error {}
