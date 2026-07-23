import { ausbildungen, auditEreignisse, schueler, schuelerVerfuegbarkeiten } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { getOwnSchuelerId } from "../services/own-scope.js";

const wunschzeitSchema = z.object({
  wochentag: z.number().int().min(0).max(6),
  startzeit: z.string().regex(/^\d{2}:\d{2}$/),
  endzeit: z.string().regex(/^\d{2}:\d{2}$/),
});

const wunschzeitenBatchSchema = z.object({ eintraege: z.array(wunschzeitSchema).max(50) });

export function registerStudentRoutes(app: FastifyInstance, db: Database) {
  /**
   * Eigenes Profil + Ausbildung(en) inkl. Vorbesitz/Erweiterung/B197/
   * Getriebeart/Standort – ausschließlich der eigene Datensatz (own-Scope),
   * niemals andere Schüler (siehe Rollen-Middleware requirePermission
   * "students:read:own").
   */
  app.get(
    "/me/schueler",
    { preHandler: [requireAuth, requirePermission("students:read:own")] },
    async (request, reply) => {
      const [row] = await db
        .select()
        .from(schueler)
        .where(eq(schueler.benutzerId, request.user!.id))
        .limit(1);
      if (!row) {
        return reply.code(404).send({ error: "no_student_profile" });
      }
      const ausbildungRows = await db
        .select()
        .from(ausbildungen)
        .where(eq(ausbildungen.schuelerId, row.id));
      return reply.send({ schueler: row, ausbildungen: ausbildungRows });
    },
  );

  app.get(
    "/me/wunschzeiten",
    { preHandler: [requireAuth, requirePermission("wunschzeiten:write:own")] },
    async (request, reply) => {
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) return reply.send({ wunschzeiten: [] });
      const rows = await db
        .select()
        .from(schuelerVerfuegbarkeiten)
        .where(eq(schuelerVerfuegbarkeiten.schuelerId, schuelerId));
      return reply.send({ wunschzeiten: rows });
    },
  );

  /**
   * Ersetzt die komplette Wunschzeiten-Liste des Schülers (einfacher als
   * ein Diff-Endpunkt, für die Onboarding-/Termine-UI ausreichend). Nur der
   * eigene Datensatz wird verändert.
   */
  app.put(
    "/me/wunschzeiten",
    { preHandler: [requireAuth, requirePermission("wunschzeiten:write:own")] },
    async (request, reply) => {
      const parsed = wunschzeitenBatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) {
        return reply.code(404).send({ error: "no_student_profile" });
      }

      const rows = await db.transaction(async (tx) => {
        await tx
          .delete(schuelerVerfuegbarkeiten)
          .where(eq(schuelerVerfuegbarkeiten.schuelerId, schuelerId));
        if (parsed.data.eintraege.length === 0) return [];
        return tx
          .insert(schuelerVerfuegbarkeiten)
          .values(
            parsed.data.eintraege.map((e) => ({
              standortId: request.user!.standortId,
              schuelerId,
              wochentag: e.wochentag,
              startzeit: e.startzeit,
              endzeit: e.endzeit,
            })),
          )
          .returning();
      });

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "availability.updated",
          aktion: "wunschzeiten.replace",
          entitaet: "schueler_verfuegbarkeit",
          entitaetId: schuelerId,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:student.wunschzeiten",
          payload: { anzahl: rows.length },
        }),
      );

      return reply.send({ wunschzeiten: rows });
    },
  );
}
