import { auditEreignisse, nachrichten, nachrichtenVorlagen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import type { NotificationsAdapter } from "@fahrschul/integrations";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  IdempotencyConflictError,
  IDEMPOTENT_OPERATIONS,
  readIdempotencyKey,
  requireIdempotencyKeyFor,
  runIdempotent,
  sendIdempotencyConflict,
} from "../lib/idempotency.js";

const templateSchema = z.object({
  name: z.string().min(1),
  kanal: z.enum(["email", "sms", "push"]),
  betreff: z.string().optional(),
  inhalt: z.string().min(1),
});

const sendSchema = z.object({
  vorlageId: z.string().uuid().optional(),
  schuelerId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  kanal: z.enum(["email", "sms", "push"]),
  to: z.string().min(1),
  betreff: z.string().optional(),
  inhalt: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

/**
 * Kommunikation: Vorlagen + Sende-Log mit echtem Status-Modell
 * (warteschlange/gesendet/fehlgeschlagen). Nutzt den Mock-
 * Notifications-Adapter aus Prompt 0 (packages/integrations) – "email"/
 * "sms" werden auf den Adapter-Kanal "email"/"push" abgebildet, da der
 * Mock-Adapter keinen echten SMS-Versand kennt (siehe
 * docs/integration-gaps.md, kein SMS-Provider in dieser Umgebung).
 */
export function registerCommunicationRoutes(
  app: FastifyInstance,
  db: Database,
  deps: { notifications: NotificationsAdapter },
) {
  app.get(
    "/communication/templates",
    { preHandler: [requireAuth, requirePermission("messages:manage")] },
    async (_request, reply) => {
      const rows = await db.select().from(nachrichtenVorlagen);
      return reply.send({ templates: rows });
    },
  );

  app.post(
    "/communication/templates",
    { preHandler: [requireAuth, requirePermission("messages:manage")] },
    async (request, reply) => {
      const parsed = templateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      const [inserted] = await db
        .insert(nachrichtenVorlagen)
        .values({ standortId: request.user!.standortId, ...parsed.data })
        .returning();
      return reply.code(201).send({ template: inserted });
    },
  );

  app.get(
    "/communication/log",
    { preHandler: [requireAuth, requirePermission("messages:manage")] },
    async (_request, reply) => {
      const rows = await db.select().from(nachrichten);
      return reply.send({ nachrichten: rows });
    },
  );

  app.post(
    "/communication/send",
    { preHandler: [requireAuth, requirePermission("messages:manage")] },
    async (request, reply) => {
      // PROMPT -1 §2 (Phase 2): Schlüssel ist jetzt PFLICHT – siehe
      // IDEMPOTENCY_MANDATORY in lib/idempotency.ts. Alle vier Frontends
      // senden ihn seit Phase 2 bei jeder Mutation.
      const idempotencyKey = requireIdempotencyKeyFor(
        IDEMPOTENT_OPERATIONS.messageSend,
        request,
        reply,
      );
      if (!idempotencyKey) return reply;
      const parsed = sendSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      const body = parsed.data;

      /**
       * PROMPT -1 §2/§5 – "Nachricht versenden".
       *
       * Das VERBOTENE Muster "DB geändert und danach hoffentlich Nachricht
       * gesendet" ist hier entfernt: die Nachricht wird in derselben
       * Transaktion wie ihr Audit-/Outbox-Ereignis in die Warteschlange
       * gelegt (Status 'warteschlange'), der eigentliche Versand ist ein
       * eigener, wiederholbarer Job (`notifications.dispatch`, §13). Fällt der
       * Prozess zwischen Einstellen und Versand aus, holt der Job es nach –
       * vorher hing der Versand am HTTP-Request und war unwiederbringlich
       * verloren.
       */

      const queueMessage = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
        const [queued] = await tx
          .insert(nachrichten)
          .values({
            standortId: request.user!.standortId,
            vorlageId: body.vorlageId ?? null,
            schuelerId: body.schuelerId ?? null,
            leadId: body.leadId ?? null,
            kanal: body.kanal,
            betreff: body.betreff ?? null,
            inhalt: body.inhalt,
            status: "warteschlange",
          })
          .returning();

        await tx.insert(auditEreignisse).values(
          buildEventRow({
            type: "communication.message_sent",
            aktion: "communication.send",
            entitaet: "nachricht",
            entitaetId: queued.id,
            akteurBenutzerId: request.user!.id,
            standortId: request.user!.standortId,
            source: "apps/api:communication.send",
            idempotencyKey: idempotencyKey ?? null,
            nachher: queued,
          }),
        );
        return queued;
      };

      /**
       * Sofortversuch NACH dem Commit. Schlägt er fehl, bleibt die Nachricht
       * in 'warteschlange' und der Job holt sie ab – es geht nichts verloren.
       * Die Statusfortschreibung ist idempotent (nur 'warteschlange' wird
       * angefasst).
       */
      const trySendNow = async (messageId: string) => {
        try {
          const result = await deps.notifications.send({
            to: body.to,
            channel: body.kanal === "sms" ? "push" : (body.kanal as "email" | "push"),
            subject: body.betreff ?? body.kanal,
            body: body.inhalt,
          });
          const [updated] = await db
            .update(nachrichten)
            .set({ status: result.delivered ? "gesendet" : "fehlgeschlagen", gesendetAt: new Date() })
            .where(and(eq(nachrichten.id, messageId), eq(nachrichten.status, "warteschlange")))
            .returning();
          return updated;
        } catch (err) {
          const [updated] = await db
            .update(nachrichten)
            .set({ fehlergrund: (err as Error).message })
            .where(and(eq(nachrichten.id, messageId), eq(nachrichten.status, "warteschlange")))
            .returning();
          return updated;
        }
      };

      try {
        const outcome = await runIdempotent({
          db,
          operation: IDEMPOTENT_OPERATIONS.messageSend,
          key: idempotencyKey,
          benutzerId: request.user!.id,
          standortId: request.user!.standortId,
          target: body.to,
          payload: body,
          handler: async (tx) => {
            const queued = await queueMessage(tx);
            return { status: 201, body: { nachricht: queued }, entitaet: "nachricht", entitaetId: queued.id };
          },
        });
        const out = outcome.body as { nachricht: { id: string } };
        if (!outcome.replayed) {
          const sent = await trySendNow(out.nachricht.id);
          return reply.code(201).send({ nachricht: sent ?? out.nachricht });
        }
        return reply.code(200).send({ ...(outcome.body as object), replayed: true });
      } catch (err) {
        if (err instanceof IdempotencyConflictError) return sendIdempotencyConflict(err, reply);
        throw err;
      }
    },
  );
}
