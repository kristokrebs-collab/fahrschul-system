import { auditEreignisse, nachrichten, nachrichtenVorlagen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import type { NotificationsAdapter } from "@fahrschul/integrations";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";

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
      const parsed = sendSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      const body = parsed.data;

      const [queued] = await db
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

      let finalRow = queued;
      try {
        const result = await deps.notifications.send({
          to: body.to,
          channel: body.kanal === "sms" ? "push" : (body.kanal as "email" | "push"),
          subject: body.betreff ?? body.kanal,
          body: body.inhalt,
        });
        const [updated] = await db
          .update(nachrichten)
          .set({ status: result.delivered ? "gesendet" : "fehlgeschlagen", gesendetAt: new Date(), updatedAt: new Date() })
          .where(eq(nachrichten.id, queued.id))
          .returning();
        finalRow = updated;
      } catch (err) {
        const [updated] = await db
          .update(nachrichten)
          .set({ status: "fehlgeschlagen", fehlergrund: (err as Error).message, updatedAt: new Date() })
          .where(eq(nachrichten.id, queued.id))
          .returning();
        finalRow = updated;
      }

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "communication.message_sent",
          aktion: "communication.send",
          entitaet: "nachricht",
          entitaetId: finalRow.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:communication.send",
          nachher: finalRow,
        }),
      );

      return reply.code(201).send({ nachricht: finalRow });
    },
  );
}
