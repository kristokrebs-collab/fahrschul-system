import { auditEreignisse, terminangebote, terminbuchungen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { and, eq, gt, gte, inArray, isNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  BookingConflictError,
  EXCLUSION_VIOLATION,
  performBooking,
  UNIQUE_VIOLATION,
} from "../services/booking.js";
import { getOwnSchuelerId } from "../services/own-scope.js";
import {
  IdempotencyConflictError,
  IDEMPOTENT_OPERATIONS,
  readIdempotencyKey,
  runIdempotent,
  sendIdempotencyConflict,
} from "../lib/idempotency.js";
import { sendBusinessConstraintError, transitionState } from "../lib/state-machine.js";

const createOfferSchema = z.object({
  fahrlehrerId: z.string().uuid(),
  fahrzeugId: z.string().uuid().nullable().optional(),
  beginnAt: z.coerce.date(),
  endeAt: z.coerce.date(),
  klasse: z.string().min(1).nullable().optional(),
  art: z.string().min(1).default("Übungsstunde"),
  treffpunkt: z.string().nullable().optional(),
  automatik: z.boolean().default(false),
  ablaufAt: z.coerce.date().nullable().optional(),
});

const acceptSchema = z.object({
  idempotencyKey: z.string().min(1),
});

const KURZFRISTIG_SCHWELLE_MS = 1000 * 60 * 60 * 48; // 48h – siehe Aufgabenstellung "kurzfristig verfügbar"

export function registerAppointmentOfferRoutes(app: FastifyInstance, db: Database) {
  /**
   * Fahrlehrer/Büro veröffentlichen ein Terminangebot mit exaktem
   * Zeitfenster (statt der groben Tagesperioden aus app.html). Nutzt die
   * bestehende `appointments:create`-Berechtigung, da ein Angebot fachlich
   * eine Vorstufe der Terminbuchung ist.
   */
  app.post(
    "/appointment-offers",
    { preHandler: [requireAuth, requirePermission("appointments:create")] },
    async (request, reply) => {
      const parsed = createOfferSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const body = parsed.data;
      if (!(body.beginnAt < body.endeAt)) {
        return reply.code(400).send({ error: "invalid_interval" });
      }
      // PROMPT -1 §10: Das Angebot entsteht im Zustand `created` und wird in
      // derselben Transaktion nach `sent` überführt – "veröffentlicht" IST das
      // Senden, weil die Angebotsliste pollbar ist. Der Übergang nach
      // `delivered` folgt aus der Outbox-Zustellung (workers/consumers.ts),
      // ist also persistiert und nach einem Neustart wiederaufnehmbar.
      try {
        const offer = await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(terminangebote)
            .values({
              standortId: request.user!.standortId,
              fahrlehrerId: body.fahrlehrerId,
              fahrzeugId: body.fahrzeugId ?? null,
              beginnAt: body.beginnAt,
              endeAt: body.endeAt,
              klasse: body.klasse ?? null,
              art: body.art,
              treffpunkt: body.treffpunkt ?? null,
              automatik: body.automatik,
              ablaufAt: body.ablaufAt ?? null,
              angebotStatus: "created",
            })
            .returning();

          const sent = await transitionState(tx, {
            machine: "terminangebot",
            entitaetId: inserted.id,
            to: "sent",
            akteurBenutzerId: request.user!.id,
            standortId: request.user!.standortId,
            grund: "Angebot veröffentlicht",
            eventType: "lesson.offer.created",
            aktion: "appointment-offers.create",
            source: "apps/api:appointment-offers.create",
            payload: { beginnAt: inserted.beginnAt.toISOString(), art: inserted.art },
          });
          return (sent.row ?? inserted) as typeof inserted;
        });
        return reply.code(201).send({ offer });
      } catch (err) {
        if (sendBusinessConstraintError(err, reply)) return reply;
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  /**
   * Termine-Tab: echte offene Angebote mit exaktem Zeitfenster + Filtern.
   * "kurzfristig verfügbar" / Samstag werden aus beginnAt abgeleitet,
   * "anderer Fahrlehrer" / "anderer Treffpunkt" / "Automatik" sind
   * Query-Parameter.
   */
  app.get("/appointment-offers", { preHandler: requireAuth }, async (request, reply) => {
    const now = new Date();
    const query = request.query as Record<string, string | undefined>;

    const rows = await db
      .select()
      .from(terminangebote)
      .where(
        and(
          inArray(terminangebote.angebotStatus, ["created", "sent", "delivered"]),
          or(isNull(terminangebote.ablaufAt), gt(terminangebote.ablaufAt, now)),
          gte(terminangebote.beginnAt, now),
        ),
      );

    let offers = rows;
    if (query.excludeFahrlehrerId) {
      offers = offers.filter((o) => o.fahrlehrerId !== query.excludeFahrlehrerId);
    }
    if (query.treffpunkt) {
      offers = offers.filter((o) => o.treffpunkt === query.treffpunkt);
    }
    if (query.automatik === "true") {
      offers = offers.filter((o) => o.automatik === true);
    }
    if (query.samstag === "true") {
      offers = offers.filter((o) => new Date(o.beginnAt).getUTCDay() === 6);
    }
    if (query.kurzfristig === "true") {
      offers = offers.filter(
        (o) => new Date(o.beginnAt).getTime() - now.getTime() <= KURZFRISTIG_SCHWELLE_MS,
      );
    }

    return reply.send({ offers, dataAsOf: now.toISOString() });
  });

  /**
   * Annahme eines Angebots durch den Schüler. Ruft dieselbe race-sichere
   * `performBooking`-Transaktion wie POST /appointments auf (Non-Negotiable:
   * kein clientseitiges Direkt-Buchen) und ist über `idempotencyKey`
   * idempotent, siehe Prompt-0-Idempotenz-Tests. Zwei parallele Annahmen
   * desselben Angebots (durch zwei verschiedene Schüler) führen zu genau
   * einer Buchung – der Verlierer bekommt 409, nicht durch Anwendungslogik,
   * sondern durch den DB-Constraint/Unique-Index.
   */
  app.post(
    "/appointment-offers/:id/accept",
    { preHandler: [requireAuth, requirePermission("appointments:accept:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = acceptSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }

      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) {
        return reply.code(403).send({ error: "forbidden", reason: "no_student_profile" });
      }

      try {
        // PROMPT -1 §2: derselbe generische Idempotenz-Mechanismus wie bei
        // allen anderen kritischen Schreibvorgängen. Der Unique-Index auf
        // terminbuchungen.idempotency_key bleibt als DB-seitige Zweitsperre.
        const outcome = await runIdempotent({
          db,
          operation: IDEMPOTENT_OPERATIONS.offerAccept,
          key: parsed.data.idempotencyKey,
          benutzerId: request.user!.id,
          standortId: request.user!.standortId,
          target: params.id,
          payload: {},
          handler: async (tx) => {
            const existingByKey = await tx
              .select()
              .from(terminbuchungen)
              .where(eq(terminbuchungen.idempotencyKey, parsed.data.idempotencyKey))
              .limit(1);
            if (existingByKey[0]) {
              return {
                status: 200,
                body: { booking: existingByKey[0], reused: true as const },
                entitaet: "terminbuchung",
                entitaetId: existingByKey[0].id,
              };
            }

            const [offer] = await tx
              .select()
              .from(terminangebote)
              .where(eq(terminangebote.id, params.id))
              .limit(1);

            if (!offer) {
              throw new OfferNotFoundError();
            }
            // §10: annehmbar ist ein Angebot in `sent` oder `delivered`.
            // Jeder andere Zustand ist entweder schon vergeben, abgelaufen
            // oder zurückgezogen.
            if (offer.angebotStatus !== "sent" && offer.angebotStatus !== "delivered") {
              throw new OfferNotAvailableError(
                offer.angebotStatus === "expired" ? "expired" : "already_booked_or_closed",
              );
            }
            if (offer.ablaufAt && new Date(offer.ablaufAt).getTime() <= Date.now()) {
              throw new OfferNotAvailableError("expired");
            }

            // Zustandskette accepted -> booking_pending -> confirmed, alles in
            // EINER Transaktion: der Zwischenzustand ist persistiert, sodass
            // ein Absturz nach `accepted` im Konsistenzcheck (§19,
            // "bestaetigtes Angebot ohne Termin") sichtbar wird statt
            // unbemerkt zu bleiben.
            await transitionState(tx, {
              machine: "terminangebot",
              entitaetId: offer.id,
              to: "accepted",
              akteurBenutzerId: request.user!.id,
              standortId: request.user!.standortId,
              grund: "Schüler hat das Angebot angenommen",
            });
            await transitionState(tx, {
              machine: "terminangebot",
              entitaetId: offer.id,
              to: "booking_pending",
              akteurBenutzerId: request.user!.id,
              standortId: request.user!.standortId,
              grund: "Buchung wird angelegt",
            });

            const booked = await performBooking(tx, {
              terminangebotId: offer.id,
              schuelerId,
              fahrlehrerId: offer.fahrlehrerId,
              fahrzeugId: offer.fahrzeugId,
              beginnAt: offer.beginnAt,
              endeAt: offer.endeAt,
              art: offer.art,
              klasse: offer.klasse ?? "B",
              idempotencyKey: parsed.data.idempotencyKey,
              standortId: request.user!.standortId,
              akteurBenutzerId: request.user!.id,
              eventType: "lesson.offer.accepted",
              eventSource: "apps/api:appointment-offers.accept",
            });

            await transitionState(tx, {
              machine: "terminangebot",
              entitaetId: offer.id,
              to: "confirmed",
              akteurBenutzerId: request.user!.id,
              standortId: request.user!.standortId,
              grund: "Terminbuchung bestätigt",
            });

            return {
              status: booked.reused ? 200 : 201,
              body: { booking: booked.booking, reused: booked.reused },
              entitaet: "terminbuchung",
              entitaetId: booked.booking.id,
            };
          },
        });

        const body = outcome.body as { booking: unknown; reused: boolean };
        return reply
          .code(outcome.replayed ? 200 : outcome.status)
          .send(outcome.replayed ? { ...body, reused: true } : body);
      } catch (err) {
        if (err instanceof OfferNotFoundError) {
          return reply.code(404).send({ error: "offer_not_found" });
        }
        if (err instanceof OfferNotAvailableError) {
          return reply.code(409).send({ error: "offer_not_available", reason: err.reason });
        }
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
   * Ablehnen eines Angebots durch den Schüler: verändert das Angebot NICHT
   * (andere Schüler können es weiterhin annehmen), nur ein Audit-Ereignis
   * für Nachvollziehbarkeit.
   */
  app.post(
    "/appointment-offers/:id/decline",
    { preHandler: [requireAuth, requirePermission("appointments:accept:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) {
        return reply.code(403).send({ error: "forbidden", reason: "no_student_profile" });
      }
      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "lesson.offer.declined",
          aktion: "appointment-offers.decline",
          entitaet: "terminangebot",
          entitaetId: params.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:appointment-offers.decline",
          payload: { schuelerId },
        }),
      );
      return reply.send({ ok: true });
    },
  );

  app.get("/appointments/mine", { preHandler: requireAuth }, async (request, reply) => {
    const schuelerId = await getOwnSchuelerId(db, request.user!.id);
    if (!schuelerId) {
      return reply.send({ appointments: [] });
    }
    const rows = await db
      .select()
      .from(terminbuchungen)
      .where(eq(terminbuchungen.schuelerId, schuelerId));
    return reply.send({ appointments: rows });
  });
}

class OfferNotFoundError extends Error {}
class OfferNotAvailableError extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}
