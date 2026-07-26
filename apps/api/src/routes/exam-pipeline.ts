import { auditEreignisse, pruefungen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { assertTransitionAllowed, possibleNextStates, PruefungTransitionError, pruefungStatusSchema } from "@fahrschul/domain";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  IdempotencyConflictError,
  IDEMPOTENT_OPERATIONS,
  readIdempotencyKey,
  runIdempotent,
  sendIdempotencyConflict,
} from "../lib/idempotency.js";
import {
  assertVersion,
  readExpectedVersion,
  sendVersionConflict,
  VersionConflictError,
  withVersionHeaders,
} from "../lib/optimistic.js";
import { sendBusinessConstraintError, setTransitionContext } from "../lib/state-machine.js";

const createSchema = z.object({
  ausbildungId: z.string().uuid(),
  schuelerId: z.string().uuid(),
  klasse: z.string().min(1),
});

const transitionSchema = z.object({
  to: pruefungStatusSchema,
  grund: z.string().min(1).max(500).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(1).optional(),
});

/**
 * Zustände, die eine PRÜFUNGSANMELDUNG bedeuten. Für sie verlangt die
 * Datenbank (Trigger fs_pruefung_freigabekette, SQLSTATE FS004) eine
 * vollständige Freigabekette: Fahrlehrer-Go UND Büroprüfung. Der Trigger
 * verweigert nur – er erteilt NIE eine Freigabe (Non-Negotiable).
 */
const ANMELDE_ZUSTAENDE = new Set([
  "termin_angefragt",
  "termin_bestaetigt",
  "durchgefuehrt",
  "ergebnis_dokumentiert",
]);

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

      const expected = readExpectedVersion(request);
      const idempotencyKey = readIdempotencyKey(request);
      const istAnmeldung = ANMELDE_ZUSTAENDE.has(parsed.data.to);

      const advance = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
        const [current] = await tx.select().from(pruefungen).where(eq(pruefungen.id, params.id)).limit(1);
        if (!current) throw new PruefungNotFoundError();
        assertVersion(current, expected);

        /**
         * Rollen- und Reihenfolgeprüfung. Sie steht INNERHALB des
         * idempotenten Handlers, damit ein Retry mit demselben Schlüssel die
         * gespeicherte Antwort erhält, statt an der Selbstübergangsprüfung
         * ("fahrlehrer_go -> fahrlehrer_go" ist kein zulässiger Übergang) zu
         * scheitern. Ohne Idempotenzschlüssel ist die Semantik unverändert:
         * FORBIDDEN_ROLE -> 403, INVALID_TRANSITION -> 409.
         */
        assertTransitionAllowed(current.status as never, parsed.data.to, request.user!.rolle);

        await setTransitionContext(tx, {
          akteurBenutzerId: request.user!.id,
          grund: parsed.data.grund ?? null,
        });

        const [updated] = await tx
          .update(pruefungen)
          .set({ status: parsed.data.to })
          .where(eq(pruefungen.id, current.id))
          .returning();

        await tx.insert(auditEreignisse).values(
          buildEventRow({
            type: istAnmeldung ? "exam.registered" : "exam.clearance.granted",
            aktion: "pruefungen.transition",
            entitaet: "pruefung",
            entitaetId: updated.id,
            akteurBenutzerId: request.user!.id,
            standortId: request.user!.standortId,
            source: "apps/api:exam-pipeline.transition",
            idempotencyKey: idempotencyKey ?? null,
            vorher: { status: current.status, version: current.version },
            nachher: { status: updated.status, version: updated.version },
            payload: { grund: parsed.data.grund ?? null, rolle: request.user!.rolle },
          }),
        );
        return updated;
      };

      try {
        if (idempotencyKey) {
          const outcome = await runIdempotent({
            db,
            operation: IDEMPOTENT_OPERATIONS.examTransition,
            key: idempotencyKey,
            benutzerId: request.user!.id,
            standortId: request.user!.standortId,
            target: params.id,
            payload: { to: parsed.data.to, grund: parsed.data.grund ?? null },
            handler: async (tx) => {
              const updated = await advance(tx);
              return {
                status: 200,
                body: { pruefung: updated },
                entitaet: "pruefung",
                entitaetId: updated.id,
              };
            },
          });
          const out = outcome.body as { pruefung: { id: string; version: number; updatedAt: Date | string | null } };
          withVersionHeaders(reply, out.pruefung);
          return reply.send(
            outcome.replayed ? { ...(outcome.body as object), replayed: true } : (outcome.body as object),
          );
        }

        const updated = await db.transaction(advance);
        withVersionHeaders(reply, updated);
        return reply.send({ pruefung: updated });
      } catch (err) {
        if (err instanceof PruefungNotFoundError) {
          return reply.code(404).send({ error: "pruefung_not_found" });
        }
        if (err instanceof PruefungTransitionError) {
          const code = err.code === "FORBIDDEN_ROLE" ? 403 : 409;
          return reply.code(code).send({ error: err.code, message: err.message });
        }
        if (err instanceof IdempotencyConflictError) return sendIdempotencyConflict(err, reply);
        if (err instanceof VersionConflictError) {
          return sendVersionConflict(err, reply, parsed.data as Record<string, unknown>);
        }
        // FS004 = Freigabekette unvollständig -> 409 mit sprechendem Code.
        if (sendBusinessConstraintError(err, reply)) return reply;
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
}

class PruefungNotFoundError extends Error {}
