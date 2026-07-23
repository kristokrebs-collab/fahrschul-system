import type { Database } from "@fahrschul/database";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { EXCLUSION_VIOLATION, UNIQUE_VIOLATION, BookingConflictError } from "../services/booking.js";
import { getOwnSchuelerId } from "../services/own-scope.js";
import {
  acceptStornoOffer,
  computeCandidates,
  expireStornoOffer,
  raiseStornoEvent,
  sendStornoOffers,
  StornoNotFoundError,
  StornoStateError,
} from "../services/storno-retter.js";

const raiseSchema = z.object({ terminbuchungId: z.string().uuid(), klasse: z.string().min(1) });
const sendSchema = z.object({
  kandidatenSchuelerIds: z.array(z.string().uuid()).min(1),
  modus: z.enum(["sequenziell", "broadcast"]),
  fristMinuten: z.number().int().positive().optional(),
});
const acceptSchema = z.object({ idempotencyKey: z.string().min(1) });

/**
 * Storno-Retter (Spec: 11-Schritt-Flow, siehe
 * apps/api/src/services/storno-retter.ts für die ausführliche
 * Schritt-für-Schritt-Dokumentation).
 */
export function registerStornoRoutes(app: FastifyInstance, db: Database) {
  // Schritte 1+2: Storno empfangen, Slot sperren.
  app.post(
    "/storno",
    { preHandler: [requireAuth, requirePermission("storno:manage")] },
    async (request, reply) => {
      const parsed = raiseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      try {
        const result = await db.transaction((tx) =>
          raiseStornoEvent(tx, {
            terminbuchungId: parsed.data.terminbuchungId,
            klasse: parsed.data.klasse,
            akteurBenutzerId: request.user!.id,
            standortId: request.user!.standortId,
          }),
        );
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof StornoNotFoundError) {
          return reply.code(404).send({ error: "booking_not_found" });
        }
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // Schritt 3: Kandidaten berechnen.
  app.get(
    "/storno/:eventId/kandidaten",
    { preHandler: [requireAuth, requirePermission("storno:manage")] },
    async (request, reply) => {
      const params = request.params as { eventId: string };
      const query = request.query as { klasse?: string; beginnAt?: string; endeAt?: string; excludeSchuelerId?: string };
      if (!query.klasse || !query.beginnAt || !query.endeAt || !query.excludeSchuelerId) {
        return reply.code(400).send({ error: "invalid_query" });
      }
      const candidates = await computeCandidates(db, {
        standortId: request.user!.standortId,
        klasse: query.klasse,
        beginnAt: new Date(query.beginnAt),
        endeAt: new Date(query.endeAt),
        excludeSchuelerId: query.excludeSchuelerId,
      });
      return reply.send({ eventId: params.eventId, candidates, dataAsOf: new Date().toISOString() });
    },
  );

  // Schritte 4+5: Büro wählt Angebotsmodus, Angebote werden gesendet.
  app.post(
    "/storno/:eventId/angebote",
    { preHandler: [requireAuth, requirePermission("storno:manage")] },
    async (request, reply) => {
      const params = request.params as { eventId: string };
      const parsed = sendSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      try {
        const offers = await db.transaction((tx) =>
          sendStornoOffers(tx, {
            stornoEventId: params.eventId,
            kandidatenSchuelerIds: parsed.data.kandidatenSchuelerIds,
            modus: parsed.data.modus,
            fristMinuten: parsed.data.fristMinuten,
            akteurBenutzerId: request.user!.id,
            standortId: request.user!.standortId,
          }),
        );
        return reply.code(201).send({ offers });
      } catch (err) {
        if (err instanceof StornoNotFoundError) return reply.code(404).send({ error: "event_not_found" });
        if (err instanceof StornoStateError) return reply.code(409).send({ error: "invalid_state", reason: err.reason });
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // Schritt 6: Ablauf (manuell/für Tests; ein Scheduler würde denselben
  // Aufruf periodisch für abgelaufene Angebote machen).
  app.post(
    "/storno-angebote/:id/expire",
    { preHandler: [requireAuth, requirePermission("storno:manage")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      try {
        const offer = await db.transaction((tx) => expireStornoOffer(tx, params.id));
        return reply.send({ offer });
      } catch (err) {
        if (err instanceof StornoNotFoundError) return reply.code(404).send({ error: "offer_not_found" });
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  /**
   * Schritte 7-8-10-11: erste gültige Annahme gewinnt (race-sicher, siehe
   * services/storno-retter.ts). Der annehmende Akteur ist der Schüler
   * selbst (analog zu appointment-offers:accept) – Büro sieht das Ergebnis
   * über GET /storno/:eventId.
   */
  app.post(
    "/storno-angebote/:id/accept",
    { preHandler: [requireAuth, requirePermission("appointments:accept:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = acceptSchema.safeParse(request.body);
      const idempotencyKey = parsed.success ? parsed.data.idempotencyKey : randomUUID();

      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) {
        return reply.code(403).send({ error: "forbidden", reason: "no_student_profile" });
      }

      try {
        const result = await db.transaction((tx) =>
          acceptStornoOffer(tx, {
            stornoAngebotId: params.id,
            schuelerId,
            akteurBenutzerId: request.user!.id,
            standortId: request.user!.standortId,
            idempotencyKey,
          }),
        );
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof StornoNotFoundError) return reply.code(404).send({ error: "offer_not_found" });
        if (err instanceof StornoStateError) return reply.code(409).send({ error: "offer_not_available", reason: err.reason });
        const pgError = err as { code?: string; constraint?: string };
        if (pgError.code === EXCLUSION_VIOLATION || pgError.code === UNIQUE_VIOLATION) {
          return reply.code(409).send({ error: "booking_conflict", reason: "DB_CONSTRAINT", constraint: pgError.constraint });
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
