import { ausbildungen, auditEreignisse, pruefungsfreigaben } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { buildExamReadinessView } from "../services/exam-readiness.js";
import { getOwnSchuelerId } from "../services/own-scope.js";

const clearanceSchema = z.object({
  ausbildungId: z.string().uuid(),
  entscheidung: z.enum(["freigegeben", "abgelehnt"]),
  kommentar: z.string().optional(),
});

export function registerExamRoutes(app: FastifyInstance, db: Database) {
  /**
   * PrüfungsReady-Ansicht: read-only für den Schüler (exam:read:own). Setzen
   * einer Freigabe ist über diesen Endpunkt NICHT möglich – dafür existiert
   * ausschließlich POST /exam-clearance mit exam:clearance:set, das
   * Schüler laut Rollenmatrix nie besitzen (serverseitig erzwungen, nicht
   * nur im UI versteckt).
   */
  app.get(
    "/me/exam-readiness",
    { preHandler: [requireAuth, requirePermission("exam:read:own")] },
    async (request, reply) => {
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) {
        return reply.code(404).send({ error: "no_student_profile" });
      }
      const [ausbildung] = await db
        .select()
        .from(ausbildungen)
        .where(eq(ausbildungen.schuelerId, schuelerId))
        .limit(1);
      if (!ausbildung) {
        return reply.code(404).send({ error: "no_ausbildung" });
      }
      const view = await buildExamReadinessView(db, {
        schuelerId,
        ausbildungId: ausbildung.id,
        klasse: ausbildung.klasse,
      });
      return reply.send(view);
    },
  );

  /**
   * NUR Fahrlehrer/Büro. Setzt entweder die Fahrlehrer- oder die
   * Büro-Freigabe (abhängig von der Rolle des Aufrufers), niemals beides
   * gleichzeitig über denselben Aufruf – das entspricht dem in
   * docs/fachliche-bestaetigungen.md Punkt 11 offen gelassenen
   * Vier-Augen-Prinzip, ohne es als bestätigte Fachregel zu erzwingen.
   */
  app.post(
    "/exam-clearance",
    { preHandler: [requireAuth, requirePermission("exam:clearance:set")] },
    async (request, reply) => {
      const parsed = clearanceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const body = parsed.data;

      const [ausbildung] = await db
        .select()
        .from(ausbildungen)
        .where(eq(ausbildungen.id, body.ausbildungId))
        .limit(1);
      if (!ausbildung) {
        return reply.code(404).send({ error: "ausbildung_not_found" });
      }

      const [existing] = await db
        .select()
        .from(pruefungsfreigaben)
        .where(eq(pruefungsfreigaben.ausbildungId, body.ausbildungId))
        .limit(1);

      const isBuero = request.user!.rolle === "buero";
      const now = new Date();

      const patch = isBuero
        ? {
            buerofreigabeStatus: body.entscheidung,
            buerofreigabeDurchBenutzerId: request.user!.id,
            kommentar: body.kommentar ?? existing?.kommentar ?? null,
            updatedAt: now,
          }
        : {
            status: body.entscheidung,
            freigegebenDurchBenutzerId: request.user!.id,
            freigegebenAt: now,
            kommentar: body.kommentar ?? existing?.kommentar ?? null,
            updatedAt: now,
          };

      let row;
      if (existing) {
        [row] = await db
          .update(pruefungsfreigaben)
          .set(patch)
          .where(eq(pruefungsfreigaben.id, existing.id))
          .returning();
      } else {
        [row] = await db
          .insert(pruefungsfreigaben)
          .values({
            standortId: ausbildung.standortId,
            ausbildungId: ausbildung.id,
            schuelerId: ausbildung.schuelerId,
            ...patch,
          })
          .returning();
      }

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "exam.clearance.granted",
          aktion: "exam-clearance.set",
          entitaet: "pruefungsfreigabe",
          entitaetId: row.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:exam.clearance",
          payload: { rolle: request.user!.rolle, entscheidung: body.entscheidung },
          nachher: row,
        }),
      );

      return reply.send({ clearance: row });
    },
  );
}
