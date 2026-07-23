import { auditEreignisse, pruefungen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { assertTransitionAllowed, possibleNextStates, PruefungTransitionError, pruefungStatusSchema } from "@fahrschul/domain";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const createSchema = z.object({
  ausbildungId: z.string().uuid(),
  schuelerId: z.string().uuid(),
  klasse: z.string().min(1),
});

const transitionSchema = z.object({
  to: pruefungStatusSchema,
  grund: z.string().min(1).max(500).optional(),
});

/**
 * Prüfungs-Pipeline als explizite State Machine (siehe
 * packages/domain/src/pruefungspipeline.ts). Jeder Übergang ist
 * autorisierungsgeprüft (`assertTransitionAllowed`, insbesondere
 * "fahrlehrer_go" NUR durch Rolle fahrlehrer), mit Grund versehbar und wird
 * in derselben Anfrage auditiert.
 */
export function registerExamPipelineRoutes(app: FastifyInstance, db: Database) {
  app.get(
    "/pruefungen",
    { preHandler: [requireAuth, requirePermission("exam:pipeline:advance")] },
    async (_request, reply) => {
      const rows = await db.select().from(pruefungen);
      return reply.send({ pruefungen: rows, dataAsOf: new Date().toISOString() });
    },
  );

  app.post(
    "/pruefungen",
    { preHandler: [requireAuth, requirePermission("exam:pipeline:advance")] },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const [inserted] = await db
        .insert(pruefungen)
        .values({
          standortId: request.user!.standortId,
          ausbildungId: parsed.data.ausbildungId,
          schuelerId: parsed.data.schuelerId,
          klasse: parsed.data.klasse,
        })
        .returning();

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "student.enrolled",
          aktion: "pruefungen.create",
          entitaet: "pruefung",
          entitaetId: inserted.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:exam-pipeline.create",
          nachher: inserted,
        }),
      );
      return reply.code(201).send({ pruefung: inserted });
    },
  );

  app.get(
    "/pruefungen/:id/next-states",
    { preHandler: [requireAuth, requirePermission("exam:pipeline:advance")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const [row] = await db.select().from(pruefungen).where(eq(pruefungen.id, params.id)).limit(1);
      if (!row) return reply.code(404).send({ error: "pruefung_not_found" });
      return reply.send({ current: row.status, nextStates: possibleNextStates(row.status as never) });
    },
  );

  /**
   * Übergang der Prüfungs-Pipeline. Autorisierung erfolgt ZWEISTUFIG:
   * (1) Permission-Matrix (`exam:pipeline:advance`, Büro + Fahrlehrer),
   * (2) transition-spezifische Rollenprüfung in
   * `assertTransitionAllowed` – ein Büro-Akteur mit der Permission bekommt
   * für den Übergang nach "fahrlehrer_go" trotzdem 403, weil die
   * State-Machine selbst nur "fahrlehrer" erlaubt (Non-Negotiable:
   * "'Fahrlehrer-Go' must come from an instructor-role actor").
   */
  app.post(
    "/pruefungen/:id/transition",
    { preHandler: [requireAuth, requirePermission("exam:pipeline:advance")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = transitionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const [row] = await db.select().from(pruefungen).where(eq(pruefungen.id, params.id)).limit(1);
      if (!row) return reply.code(404).send({ error: "pruefung_not_found" });

      try {
        assertTransitionAllowed(row.status as never, parsed.data.to, request.user!.rolle);
      } catch (err) {
        if (err instanceof PruefungTransitionError) {
          const code = err.code === "FORBIDDEN_ROLE" ? 403 : 409;
          return reply.code(code).send({ error: err.code, message: err.message });
        }
        throw err;
      }

      const [updated] = await db
        .update(pruefungen)
        .set({ status: parsed.data.to, updatedAt: new Date() })
        .where(eq(pruefungen.id, row.id))
        .returning();

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "exam.clearance.granted",
          aktion: "pruefungen.transition",
          entitaet: "pruefung",
          entitaetId: updated.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:exam-pipeline.transition",
          vorher: { status: row.status },
          nachher: { status: updated.status },
          payload: { grund: parsed.data.grund ?? null },
        }),
      );

      return reply.send({ pruefung: updated });
    },
  );
}
