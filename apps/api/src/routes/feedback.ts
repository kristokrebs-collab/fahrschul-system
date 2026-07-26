import { auditEreignisse, fahrstundenFeedback, terminbuchungen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { getOwnFahrlehrerId, getOwnSchuelerId } from "../services/own-scope.js";
import {
  assertVersion,
  readExpectedVersion,
  requireExpectedVersion,
  sendVersionConflict,
  VersionConflictError,
  withVersionHeaders,
} from "../lib/optimistic.js";

const feedbackFieldSchema = z.enum(["wentWell", "workOn", "nextGoal", "resourceId"]);

const createFeedbackSchema = z.object({
  wentWell: z.string().nullable().optional(),
  workOn: z.string().nullable().optional(),
  nextGoal: z.string().nullable().optional(),
  resourceId: z.string().uuid().nullable().optional(),
  internalNotes: z.string().nullable().optional(),
  releasedFields: z.array(feedbackFieldSchema).default([]),
});

const selfAssessmentSchema = z.object({
  text: z.string().min(1).max(2000),
  expectedVersion: z.number().int().nonnegative().optional(),
});

/** §4: Fahrlehrer aktualisiert eigenes Feedback – nur mit gelesener Version. */
const patchFeedbackSchema = z.object({
  wentWell: z.string().nullable().optional(),
  workOn: z.string().nullable().optional(),
  nextGoal: z.string().nullable().optional(),
  internalNotes: z.string().nullable().optional(),
  releasedFields: z.array(feedbackFieldSchema).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

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
        .select({
          id: fahrstundenFeedback.id,
          schuelerId: fahrstundenFeedback.schuelerId,
          version: fahrstundenFeedback.version,
          updatedAt: fahrstundenFeedback.updatedAt,
        })
        .from(fahrstundenFeedback)
        .where(eq(fahrstundenFeedback.id, params.id))
        .limit(1);
      if (!row || row.schuelerId !== schuelerId) {
        return reply.code(404).send({ error: "feedback_not_found" });
      }

      // §4: Version optional-aber-geprüft (der Schüler-Client schickt sie,
      // sobald Phase 2 den Client-Sync verdrahtet).
      const expected = readExpectedVersion(request);
      try {
        assertVersion(row, expected);
      } catch (err) {
        if (err instanceof VersionConflictError) {
          return sendVersionConflict(err, reply, parsed.data as Record<string, unknown>);
        }
        throw err;
      }

      const [updated] = await db
        .update(fahrstundenFeedback)
        .set({ studentSelfAssessment: parsed.data.text })
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

  /**
   * §4 – Fahrlehrer aktualisiert eigenes Fahrstundenfeedback.
   * Version PFLICHT: zwei Fahrlehrer/Geräte, die dasselbe Feedback
   * bearbeiten, überschreiben sich NICHT still – der zweite bekommt 409 samt
   * aktuellem Serverzustand für eine Diff-Ansicht.
   *
   * Der Redaktionsvertrag bleibt unangetastet: `internalNotes` wird hier
   * geschrieben, aber NIE in einer schülerseitigen Antwort ausgeliefert
   * (GET /feedback/mine selektiert die Spalte gar nicht).
   */
  app.patch(
    "/feedback/:id",
    { preHandler: [requireAuth, requirePermission("feedback:manage:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = patchFeedbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const expected = requireExpectedVersion(readExpectedVersion(request), reply);
      if (expected === null) return reply;

      const fahrlehrerId = await getOwnFahrlehrerId(db, request.user!.id);
      if (!fahrlehrerId) {
        return reply.code(403).send({ error: "forbidden", reason: "no_instructor_profile" });
      }

      try {
        const updated = await db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(fahrstundenFeedback)
            .where(eq(fahrstundenFeedback.id, params.id))
            .limit(1);
          if (!current) return null;
          if (current.fahrlehrerId !== fahrlehrerId) throw new NotOwnFeedbackError();
          assertVersion(current, expected);

          const [row] = await tx
            .update(fahrstundenFeedback)
            .set({
              wentWell: parsed.data.wentWell ?? current.wentWell,
              workOn: parsed.data.workOn ?? current.workOn,
              nextGoal: parsed.data.nextGoal ?? current.nextGoal,
              internalNotes: parsed.data.internalNotes ?? current.internalNotes,
              releasedFields: parsed.data.releasedFields ?? current.releasedFields,
            })
            .where(and(eq(fahrstundenFeedback.id, params.id), eq(fahrstundenFeedback.version, expected)))
            .returning();
          if (!row) {
            const [fresh] = await tx
              .select()
              .from(fahrstundenFeedback)
              .where(eq(fahrstundenFeedback.id, params.id))
              .limit(1);
            throw new VersionConflictError(expected, fresh);
          }

          await tx.insert(auditEreignisse).values(
            buildEventRow({
              type: "feedback.given",
              aktion: "feedback.patch",
              entitaet: "fahrstunden_feedback",
              entitaetId: row.id,
              akteurBenutzerId: request.user!.id,
              standortId: request.user!.standortId,
              source: "apps/api:feedback.patch",
              payload: { hasInternalNotes: Boolean(row.internalNotes), version: row.version },
            }),
          );
          return row;
        });

        if (!updated) return reply.code(404).send({ error: "feedback_not_found" });
        withVersionHeaders(reply, updated);
        return reply.send({ feedback: updated });
      } catch (err) {
        if (err instanceof NotOwnFeedbackError) {
          return reply.code(403).send({ error: "forbidden", reason: "not_own_feedback" });
        }
        if (err instanceof VersionConflictError) {
          return sendVersionConflict(err, reply, parsed.data as Record<string, unknown>);
        }
        throw err;
      }
    },
  );
}

class NotOwnFeedbackError extends Error {}
