import { auditEreignisse, fahrstundenFeedback, terminbuchungen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { getOwnFahrlehrerId, getOwnSchuelerId } from "../services/own-scope.js";

const feedbackFieldSchema = z.enum(["wentWell", "workOn", "nextGoal", "resourceId"]);

const createFeedbackSchema = z.object({
  wentWell: z.string().nullable().optional(),
  workOn: z.string().nullable().optional(),
  nextGoal: z.string().nullable().optional(),
  resourceId: z.string().uuid().nullable().optional(),
  internalNotes: z.string().nullable().optional(),
  releasedFields: z.array(feedbackFieldSchema).default([]),
});

const selfAssessmentSchema = z.object({ text: z.string().min(1).max(2000) });

/** Felder, die eine schülerseitige Antwort MAXIMAL enthalten darf. */
const STUDENT_VISIBLE_COLUMNS = {
  id: fahrstundenFeedback.id,
  terminbuchungId: fahrstundenFeedback.terminbuchungId,
  releasedFields: fahrstundenFeedback.releasedFields,
  wentWell: fahrstundenFeedback.wentWell,
  workOn: fahrstundenFeedback.workOn,
  nextGoal: fahrstundenFeedback.nextGoal,
  resourceId: fahrstundenFeedback.resourceId,
  studentSelfAssessment: fahrstundenFeedback.studentSelfAssessment,
  createdAt: fahrstundenFeedback.createdAt,
} as const;

export function registerFeedbackRoutes(app: FastifyInstance, db: Database) {
  /**
   * Fahrlehrer erfasst Feedback zu einer eigenen, bereits bestätigten Fahrt.
   * `internalNotes` wird gespeichert, aber NIE über eine schülerseitige
   * Antwort ausgeliefert (siehe GET /feedback/mine unten – die
   * Spaltenauswahl auf DB-Ebene enthält `internalNotes` gar nicht erst).
   */
  app.post(
    "/appointments/:id/feedback",
    { preHandler: [requireAuth, requirePermission("feedback:manage:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = createFeedbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const fahrlehrerId = await getOwnFahrlehrerId(db, request.user!.id);
      if (!fahrlehrerId) {
        return reply.code(403).send({ error: "forbidden", reason: "no_instructor_profile" });
      }
      const [booking] = await db
        .select()
        .from(terminbuchungen)
        .where(eq(terminbuchungen.id, params.id))
        .limit(1);
      if (!booking) return reply.code(404).send({ error: "booking_not_found" });
      if (booking.fahrlehrerId !== fahrlehrerId) {
        return reply.code(403).send({ error: "forbidden", reason: "not_own_booking" });
      }

      const body = parsed.data;
      const [inserted] = await db
        .insert(fahrstundenFeedback)
        .values({
          standortId: request.user!.standortId,
          terminbuchungId: booking.id,
          schuelerId: booking.schuelerId,
          fahrlehrerId,
          wentWell: body.wentWell ?? null,
          workOn: body.workOn ?? null,
          nextGoal: body.nextGoal ?? null,
          resourceId: body.resourceId ?? null,
          internalNotes: body.internalNotes ?? null,
          releasedFields: body.releasedFields,
        })
        .returning();

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "feedback.given",
          aktion: "feedback.create",
          entitaet: "fahrstunden_feedback",
          entitaetId: inserted.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:feedback.create",
          payload: { hasInternalNotes: Boolean(body.internalNotes) },
        }),
      );

      return reply.code(201).send({ feedback: inserted });
    },
  );

  /**
   * Schülerseitige Anzeige. Selektiert bewusst NUR die freigebbaren Spalten
   * (siehe STUDENT_VISIBLE_COLUMNS) – `internalNotes` wird von der
   * Datenbank gar nicht erst geladen, nicht nur im UI ausgeblendet. Felder,
   * die laut `releasedFields` nicht freigegeben wurden, werden zusätzlich
   * auf null gesetzt.
   */
  app.get(
    "/feedback/mine",
    { preHandler: [requireAuth, requirePermission("feedback:read:own")] },
    async (request, reply) => {
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) return reply.send({ feedback: [] });

      const rows = await db
        .select(STUDENT_VISIBLE_COLUMNS)
        .from(fahrstundenFeedback)
        .where(eq(fahrstundenFeedback.schuelerId, schuelerId));

      const redacted = rows.map((row) => {
        const released = row.releasedFields as string[];
        return {
          ...row,
          wentWell: released.includes("wentWell") ? row.wentWell : null,
          workOn: released.includes("workOn") ? row.workOn : null,
          nextGoal: released.includes("nextGoal") ? row.nextGoal : null,
          resourceId: released.includes("resourceId") ? row.resourceId : null,
        };
      });

      return reply.send({ feedback: redacted });
    },
  );

  app.patch(
    "/feedback/:id/self-assessment",
    { preHandler: [requireAuth, requirePermission("feedback:read:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = selfAssessmentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) return reply.code(403).send({ error: "forbidden" });

      const [row] = await db
        .select({ id: fahrstundenFeedback.id, schuelerId: fahrstundenFeedback.schuelerId })
        .from(fahrstundenFeedback)
        .where(eq(fahrstundenFeedback.id, params.id))
        .limit(1);
      if (!row || row.schuelerId !== schuelerId) {
        return reply.code(404).send({ error: "feedback_not_found" });
      }

      const [updated] = await db
        .update(fahrstundenFeedback)
        .set({ studentSelfAssessment: parsed.data.text, updatedAt: new Date() })
        .where(eq(fahrstundenFeedback.id, params.id))
        .returning(STUDENT_VISIBLE_COLUMNS);

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "feedback.self_assessment.set",
          aktion: "feedback.self-assessment",
          entitaet: "fahrstunden_feedback",
          entitaetId: params.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:feedback.self-assessment",
        }),
      );

      return reply.send({ feedback: updated });
    },
  );
}
