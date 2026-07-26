import { auditEreignisse, flexAngebote, flexOptIns, terminangebote } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  BookingConflictError,
  EXCLUSION_VIOLATION,
  performBooking,
  UNIQUE_VIOLATION,
} from "../services/booking.js";
import { getFlagState } from "../services/flags.js";
import { getOwnSchuelerId } from "../services/own-scope.js";
import { sendBusinessConstraintError, transitionState } from "../lib/state-machine.js";

const createFlexOfferSchema = z.object({
  fahrlehrerId: z.string().uuid(),
  fahrzeugId: z.string().uuid().nullable().optional(),
  beginnAt: z.coerce.date(),
  endeAt: z.coerce.date(),
  klasse: z.string().min(1).nullable().optional(),
  ablaufAt: z.coerce.date(),
});

const acceptSchema = z.object({ idempotencyKey: z.string().min(1) });

/**
 * Krebs Flex – kurzfristige Ausgleichsangebote. Feature-Flag-gesteuert
 * (hidden/pilot/live, Default hidden). "Faire Verteilung" ist laut
 * docs/fachliche-bestaetigungen.md Punkt 8 fachlich NICHT bestätigt; diese
 * Implementierung nutzt bewusst die einfachste Regel (Opt-in + Race-sicheres
 * "wer zuerst annimmt") als unbestätigten Platzhalter.
 */
export function registerFlexRoutes(app: FastifyInstance, db: Database) {
  async function requirePilotOrLive(request: { user?: { standortId: string | null } }) {
    const state = await getFlagState(db, "krebs_flex", request.user?.standortId ?? null);
    return state;
  }

  app.post(
    "/flex/opt-in",
    { preHandler: [requireAuth, requirePermission("flex:participate:own")] },
    async (request, reply) => {
      const state = await requirePilotOrLive(request);
      if (state === "hidden") {
        return reply.code(403).send({ error: "feature_disabled", flag: "krebs_flex" });
      }
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) return reply.code(403).send({ error: "forbidden" });

      await db.insert(flexOptIns).values({ schuelerId }).onConflictDoNothing();
      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "flex.opt_in",
          aktion: "flex.opt-in",
          entitaet: "flex_opt_in",
          entitaetId: schuelerId,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:flex.opt-in",
        }),
      );
      return reply.send({ ok: true });
    },
  );

  app.delete(
    "/flex/opt-in",
    { preHandler: [requireAuth, requirePermission("flex:participate:own")] },
    async (request, reply) => {
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) return reply.code(403).send({ error: "forbidden" });
      await db.delete(flexOptIns).where(eq(flexOptIns.schuelerId, schuelerId));
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/flex/offers",
    { preHandler: [requireAuth, requirePermission("appointments:create")] },
    async (request, reply) => {
      const parsed = createFlexOfferSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const body = parsed.data;
      try {
      const result = await db.transaction(async (tx) => {
        const [offer] = await tx
          .insert(terminangebote)
          .values({
            standortId: request.user!.standortId,
            fahrlehrerId: body.fahrlehrerId,
            fahrzeugId: body.fahrzeugId ?? null,
            beginnAt: body.beginnAt,
            endeAt: body.endeAt,
            klasse: body.klasse ?? null,
            art: "Krebs Flex",
            ablaufAt: body.ablaufAt,
            angebotStatus: "created",
          })
          .returning();
        // PROMPT -1 §10: auch Flex-Angebote laufen durch die
        // Terminangebot-State-Machine (created -> sent). Flex bleibt dabei ein
        // eigener Aufsatz (flex_angebote), aber der Angebotszustand ist
        // EINER – keine zweite, konkurrierende Zustandsmenge.
        await transitionState(tx, {
          machine: "terminangebot",
          entitaetId: offer.id,
          to: "sent",
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          grund: "Krebs-Flex-Angebot veröffentlicht",
          eventType: "lesson.offer.created",
          aktion: "flex.offers.create",
          source: "apps/api:flex.offers.create",
        });
        const [flex] = await tx
          .insert(flexAngebote)
          .values({
            standortId: request.user!.standortId,
            terminangebotId: offer.id,
            ablaufAt: body.ablaufAt,
          })
          .returning();
        return { offer, flex };
      });
      return reply.code(201).send(result);
      } catch (err) {
        if (sendBusinessConstraintError(err, reply)) return reply;
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.get(
    "/flex/offers",
    { preHandler: [requireAuth, requirePermission("flex:participate:own")] },
    async (request, reply) => {
      const state = await requirePilotOrLive(request);
      if (state === "hidden") {
        return reply.code(403).send({ error: "feature_disabled", flag: "krebs_flex" });
      }
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) return reply.send({ offers: [], optedIn: false });

      const [optIn] = await db.select().from(flexOptIns).where(eq(flexOptIns.schuelerId, schuelerId)).limit(1);
      if (!optIn) {
        return reply.send({ offers: [], optedIn: false });
      }

      const now = new Date();
      const flexRows = await db
        .select()
        .from(flexAngebote)
        .where(and(eq(flexAngebote.status, "offen"), gt(flexAngebote.ablaufAt, now)));

      const offerIds = flexRows.map((f) => f.terminangebotId);
      const offers =
        offerIds.length > 0
          ? await db.select().from(terminangebote).where(inArray(terminangebote.id, offerIds))
          : [];

      const combined = flexRows.map((flex) => ({
        flex,
        offer: offers.find((o) => o.id === flex.terminangebotId) ?? null,
      }));

      return reply.send({ offers: combined, optedIn: true, dataAsOf: now.toISOString() });
    },
  );

  app.post(
    "/flex/offers/:id/accept",
    { preHandler: [requireAuth, requirePermission("flex:participate:own")] },
    async (request, reply) => {
      const state = await requirePilotOrLive(request);
      if (state === "hidden") {
        return reply.code(403).send({ error: "feature_disabled", flag: "krebs_flex" });
      }
      const params = request.params as { id: string };
      const parsed = acceptSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) return reply.code(403).send({ error: "forbidden" });

      const [optIn] = await db.select().from(flexOptIns).where(eq(flexOptIns.schuelerId, schuelerId)).limit(1);
      if (!optIn) {
        return reply.code(403).send({ error: "forbidden", reason: "not_opted_in" });
      }

      try {
        const result = await db.transaction(async (tx) => {
          const [flex] = await tx.select().from(flexAngebote).where(eq(flexAngebote.id, params.id)).limit(1);
          if (!flex) throw new FlexNotFoundError();
          if (flex.status !== "offen") throw new FlexNotAvailableError("already_booked_or_closed");
          if (new Date(flex.ablaufAt).getTime() <= Date.now()) throw new FlexNotAvailableError("expired");

          const [offer] = await tx
            .select()
            .from(terminangebote)
            .where(eq(terminangebote.id, flex.terminangebotId))
            .limit(1);
          if (!offer) throw new FlexNotFoundError();
          if (offer.angebotStatus !== "sent" && offer.angebotStatus !== "delivered") {
            throw new FlexNotAvailableError(
              offer.angebotStatus === "expired" ? "expired" : "already_booked_or_closed",
            );
          }

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
            eventType: "flex.offer.accepted",
            eventSource: "apps/api:flex.accept",
          });

          if (!booked.reused) {
            await tx
              .update(flexAngebote)
              .set({
                status: "angenommen",
                angenommenVonSchuelerId: schuelerId,
                angenommenAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(flexAngebote.id, flex.id));
            // §10: derselbe Zustandspfad wie bei einem regulären Angebot.
            for (const to of ["accepted", "booking_pending", "confirmed"] as const) {
              await transitionState(tx, {
                machine: "terminangebot",
                entitaetId: offer.id,
                to,
                akteurBenutzerId: request.user!.id,
                standortId: request.user!.standortId,
                grund: "Krebs-Flex-Annahme",
              });
            }
          }

          return booked;
        });

        return reply.code(result.reused ? 200 : 201).send(result);
      } catch (err) {
        if (err instanceof FlexNotFoundError) return reply.code(404).send({ error: "flex_not_found" });
        if (err instanceof FlexNotAvailableError) {
          return reply.code(409).send({ error: "flex_not_available", reason: err.reason });
        }
        if (sendBusinessConstraintError(err, reply)) return reply;
        const pgError = err as { code?: string; constraint?: string };
        if (pgError.code === EXCLUSION_VIOLATION || pgError.code === UNIQUE_VIOLATION) {
          return reply.code(409).send({ error: "booking_conflict", reason: "DB_CONSTRAINT" });
        }
        if (err instanceof BookingConflictError) {
          return reply.code(409).send({ error: "booking_conflict", reasons: err.reasons });
        }
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  /**
   * Einfache Metrik "Stunden gespart": Summe der Dauer aller angenommenen
   * Flex-Angebote (Annahme: jede angenommene Flex-Stunde ersetzt sonst eine
   * ungenutzte Lücke im Fahrlehrer-Plan – unbestätigte, aber transparente
   * Vereinfachung, siehe docs/fachliche-bestaetigungen.md Punkt 8).
   */
  app.get(
    "/flex/metrics",
    { preHandler: [requireAuth, requirePermission("flex:participate:own")] },
    async (_request, reply) => {
      const accepted = await db
        .select()
        .from(flexAngebote)
        .where(eq(flexAngebote.status, "angenommen"));
      const offerIds = accepted.map((a) => a.terminangebotId);
      const offers =
        offerIds.length > 0
          ? await db.select().from(terminangebote).where(inArray(terminangebote.id, offerIds))
          : [];
      const totalMs = offers.reduce(
        (sum, o) => sum + (new Date(o.endeAt).getTime() - new Date(o.beginnAt).getTime()),
        0,
      );
      return reply.send({
        acceptedOffers: accepted.length,
        hoursSaved: Math.round((totalMs / 1000 / 60 / 60) * 10) / 10,
        note: "Vereinfachte, unbestätigte Metrik (siehe docs/fachliche-bestaetigungen.md Punkt 8).",
      });
    },
  );
}

class FlexNotFoundError extends Error {}
class FlexNotAvailableError extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}
