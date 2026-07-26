import { auditEreignisse, verfuegbarkeiten } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  assertVersion,
  readExpectedVersion,
  requireExpectedVersion,
  sendVersionConflict,
  VersionConflictError,
  withVersionHeaders,
} from "../lib/optimistic.js";
import { getOwnFahrlehrerId } from "../services/own-scope.js";

/**
 * PROMPT -1 §4 – Fahrlehrer-Verfügbarkeit mit optimistischer Sperre.
 *
 * Diese Endpunkte sind NEU: Prompt 0-4 hatten eine `verfuegbarkeiten`-Tabelle,
 * aber keinen Schreibpfad dafür (nur die Schüler-Wunschzeiten in
 * routes/student.ts). §4 nennt "Verfügbarkeit" ausdrücklich als Entität mit
 * Versionskonflikt-Pflicht – ohne Endpunkt wäre die Anforderung nicht
 * nachweisbar erfüllbar, deshalb wird der Schreibpfad hier ergänzt.
 *
 * Zwei Fahrlehrer (oder Fahrlehrer + Büro), die dasselbe Zeitfenster
 * gleichzeitig bearbeiten, führen NICHT zum stillen Überschreiben: der zweite
 * bekommt 409 mit dem aktuellen Serverzustand.
 */

const createSchema = z.object({
  fahrlehrerId: z.string().uuid().optional(),
  wochentag: z.number().int().min(0).max(6),
  startzeit: z.string().regex(/^\d{2}:\d{2}$/),
  endzeit: z.string().regex(/^\d{2}:\d{2}$/),
});

const patchSchema = z.object({
  wochentag: z.number().int().min(0).max(6).optional(),
  startzeit: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endzeit: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  status: z.enum(["aktiv", "inaktiv"]).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export function registerAvailabilityRoutes(app: FastifyInstance, db: Database) {
  app.get("/availability", { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { fahrlehrerId?: string };
    const rows = query.fahrlehrerId
      ? await db.select().from(verfuegbarkeiten).where(eq(verfuegbarkeiten.fahrlehrerId, query.fahrlehrerId))
      : await db.select().from(verfuegbarkeiten);
    return reply.send({ availability: rows, dataAsOf: new Date().toISOString() });
  });

  app.post(
    "/availability",
    { preHandler: [requireAuth, requirePermission("availability:write:own")] },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      if (!(parsed.data.startzeit < parsed.data.endzeit)) {
        return reply.code(400).send({ error: "invalid_interval" });
      }

      // own-Scope: ein Fahrlehrer darf nur die EIGENE Verfügbarkeit anlegen.
      // Büro (availability:write:any) darf eine fremde fahrlehrerId angeben.
      const ownFahrlehrerId = await getOwnFahrlehrerId(db, request.user!.id);
      const isOffice = request.user!.rolle === "buero";
      const fahrlehrerId = isOffice ? parsed.data.fahrlehrerId ?? ownFahrlehrerId : ownFahrlehrerId;
      if (!fahrlehrerId) {
        return reply.code(403).send({ error: "forbidden", reason: "no_instructor_profile" });
      }
      if (!isOffice && parsed.data.fahrlehrerId && parsed.data.fahrlehrerId !== ownFahrlehrerId) {
        return reply.code(403).send({ error: "forbidden", reason: "not_own_availability" });
      }

      const [inserted] = await db
        .insert(verfuegbarkeiten)
        .values({
          standortId: request.user!.standortId,
          fahrlehrerId,
          wochentag: parsed.data.wochentag,
          startzeit: parsed.data.startzeit,
          endzeit: parsed.data.endzeit,
        })
        .returning();

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "availability.updated",
          aktion: "availability.create",
          entitaet: "verfuegbarkeit",
          entitaetId: inserted.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:availability.create",
          nachher: inserted,
        }),
      );

      withVersionHeaders(reply, inserted);
      return reply.code(201).send({ availability: inserted });
    },
  );

  /**
   * Änderung MIT Pflicht-Version (If-Match oder expectedVersion). Ein
   * veralteter Schreibvorgang wird mit 409 + aktuellem Serverzustand
   * abgelehnt, niemals still angewendet.
   */
  app.patch(
    "/availability/:id",
    { preHandler: [requireAuth, requirePermission("availability:write:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = patchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const expected = requireExpectedVersion(readExpectedVersion(request), reply);
      if (expected === null) return reply;

      const ownFahrlehrerId = await getOwnFahrlehrerId(db, request.user!.id);
      const isOffice = request.user!.rolle === "buero";

      try {
        const updated = await db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(verfuegbarkeiten)
            .where(eq(verfuegbarkeiten.id, params.id))
            .limit(1);
          if (!current) return null;
          if (!isOffice && current.fahrlehrerId !== ownFahrlehrerId) {
            throw new ForbiddenScopeError();
          }
          assertVersion(current, expected);

          const [row] = await tx
            .update(verfuegbarkeiten)
            .set({
              wochentag: parsed.data.wochentag ?? current.wochentag,
              startzeit: parsed.data.startzeit ?? current.startzeit,
              endzeit: parsed.data.endzeit ?? current.endzeit,
              status: parsed.data.status ?? current.status,
            })
            // version + updated_at schreibt der DB-Trigger fs_bump_version fort;
            // die WHERE-Klausel auf der Version ist die eigentliche Sperre.
            .where(and(eq(verfuegbarkeiten.id, params.id), eq(verfuegbarkeiten.version, expected)))
            .returning();

          if (!row) {
            // Zwischen SELECT und UPDATE hat jemand anderes geschrieben.
            const [fresh] = await tx
              .select()
              .from(verfuegbarkeiten)
              .where(eq(verfuegbarkeiten.id, params.id))
              .limit(1);
            throw new VersionConflictError(expected, fresh);
          }

          await tx.insert(auditEreignisse).values(
            buildEventRow({
              type: "availability.updated",
              aktion: "availability.patch",
              entitaet: "verfuegbarkeit",
              entitaetId: row.id,
              akteurBenutzerId: request.user!.id,
              standortId: request.user!.standortId,
              source: "apps/api:availability.patch",
              vorher: current,
              nachher: row,
            }),
          );
          return row;
        });

        if (!updated) return reply.code(404).send({ error: "not_found" });
        withVersionHeaders(reply, updated);
        return reply.send({ availability: updated });
      } catch (err) {
        if (err instanceof ForbiddenScopeError) {
          return reply.code(403).send({ error: "forbidden", reason: "not_own_availability" });
        }
        if (err instanceof VersionConflictError) {
          return sendVersionConflict(err, reply, parsed.data as Record<string, unknown>);
        }
        throw err;
      }
    },
  );
}

class ForbiddenScopeError extends Error {}
