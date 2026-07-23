import { ausbildungen, lernfortschritte, lernressourcen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { getOwnSchuelerId } from "../services/own-scope.js";

/**
 * Lerninhalte werden als Domain-Ressourcen (`lernressourcen`, siehe
 * packages/domain/src/curriculum.ts) modelliert, nicht hartcodiert –
 * Gefahrentraining Fulda/Bad Hersfeld sind Datensätze mit `ort`, keine
 * String-Konstanten im Frontend. Es gibt hier bewusst KEINE "geheime
 * Prüfungsstrecke"-Inhalte (Non-Negotiable).
 */
export function registerLearningRoutes(app: FastifyInstance, db: Database) {
  app.get(
    "/learning/resources",
    { preHandler: [requireAuth, requirePermission("learning:read:own")] },
    async (request, reply) => {
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      let klasse: string | null = null;
      if (schuelerId) {
        const [ausbildung] = await db
          .select({ klasse: ausbildungen.klasse })
          .from(ausbildungen)
          .where(eq(ausbildungen.schuelerId, schuelerId))
          .limit(1);
        klasse = ausbildung?.klasse ?? null;
      }

      const resources = await db
        .select()
        .from(lernressourcen)
        .where(eq(lernressourcen.status, "aktiv"));

      const filtered = klasse
        ? resources.filter((r) => (r.klassen as string[]).length === 0 || (r.klassen as string[]).includes(klasse!))
        : resources;

      let progress: { ressourceId: string; status: string; besuchtAm: Date | null }[] = [];
      if (schuelerId) {
        progress = await db
          .select({
            ressourceId: lernfortschritte.ressourceId,
            status: lernfortschritte.status,
            besuchtAm: lernfortschritte.besuchtAm,
          })
          .from(lernfortschritte)
          .where(eq(lernfortschritte.schuelerId, schuelerId));
      }

      const withProgress = filtered.map((resource) => ({
        ...resource,
        fortschritt: progress.find((p) => p.ressourceId === resource.id)?.status ?? "offen",
      }));

      return reply.send({ resources: withProgress });
    },
  );

  app.post(
    "/learning/resources/:id/visit",
    { preHandler: [requireAuth, requirePermission("learning:read:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) {
        return reply.code(403).send({ error: "forbidden", reason: "no_student_profile" });
      }
      const [resource] = await db
        .select()
        .from(lernressourcen)
        .where(eq(lernressourcen.id, params.id))
        .limit(1);
      if (!resource) return reply.code(404).send({ error: "resource_not_found" });

      const [existing] = await db
        .select()
        .from(lernfortschritte)
        .where(
          and(eq(lernfortschritte.schuelerId, schuelerId), eq(lernfortschritte.ressourceId, resource.id)),
        )
        .limit(1);

      let row;
      if (existing) {
        [row] = await db
          .update(lernfortschritte)
          .set({ status: "besucht", besuchtAm: new Date(), updatedAt: new Date() })
          .where(eq(lernfortschritte.id, existing.id))
          .returning();
      } else {
        [row] = await db
          .insert(lernfortschritte)
          .values({
            standortId: request.user!.standortId,
            schuelerId,
            ressourceId: resource.id,
            status: "besucht",
            besuchtAm: new Date(),
          })
          .returning();
      }

      return reply.send({ fortschritt: row });
    },
  );
}
