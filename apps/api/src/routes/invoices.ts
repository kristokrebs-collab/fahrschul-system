import { auditEreignisse, rechnungen, rechnungspositionen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import type { PaymentAdapter } from "@fahrschul/integrations";
import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { getOwnSchuelerId } from "../services/own-scope.js";

const inquirySchema = z.object({ nachricht: z.string().min(1).max(2000) });

/**
 * apps/student ist bei Rechnungen strikt READ-ONLY (siehe Aufgabenstellung
 * "student app is READ-ONLY here"). Es gibt hier bewusst KEINEN
 * PUT/PATCH/DELETE-Endpunkt auf `rechnungen`/`zahlungen` – jede Mutation
 * bleibt Rolle "finanzen" (invoices:manage/payments:manage) vorbehalten,
 * die in apps/finance (Prompt 4) verdrahtet wird.
 */
export function registerInvoiceRoutes(
  app: FastifyInstance,
  db: Database,
  deps: { payments: PaymentAdapter },
) {
  app.get(
    "/invoices/mine",
    { preHandler: [requireAuth, requirePermission("invoices:read:own")] },
    async (request, reply) => {
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) return reply.send({ invoices: [] });

      const invoices = await db
        .select()
        .from(rechnungen)
        .where(eq(rechnungen.schuelerId, schuelerId));

      const invoiceIds = invoices.map((i) => i.id);
      const positions =
        invoiceIds.length > 0
          ? await db
              .select()
              .from(rechnungspositionen)
              .where(inArray(rechnungspositionen.rechnungId, invoiceIds))
          : [];

      const withPositions = invoices.map((invoice) => ({
        ...invoice,
        positionen: positions.filter((p) => p.rechnungId === invoice.id),
      }));

      return reply.send({ invoices: withPositions });
    },
  );

  app.get(
    "/invoices/:id/payment-link",
    { preHandler: [requireAuth, requirePermission("invoices:read:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      const [invoice] = await db
        .select()
        .from(rechnungen)
        .where(eq(rechnungen.id, params.id))
        .limit(1);
      if (!invoice || invoice.schuelerId !== schuelerId) {
        return reply.code(404).send({ error: "invoice_not_found" });
      }
      const link = await deps.payments.createPaymentLink(invoice.id, invoice.betragCent);
      return reply.send({ paymentLink: link });
    },
  );

  app.post(
    "/invoices/:id/inquiry",
    { preHandler: [requireAuth, requirePermission("invoices:read:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = inquirySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      const [invoice] = await db
        .select()
        .from(rechnungen)
        .where(eq(rechnungen.id, params.id))
        .limit(1);
      if (!invoice || invoice.schuelerId !== schuelerId) {
        return reply.code(404).send({ error: "invoice_not_found" });
      }

      // GAP: keine echte Messaging-Integration in dieser Umgebung – die
      // Rückfrage wird als Audit-Ereignis abgelegt, damit Büro/Finanzen sie
      // im Audit-Log sehen; ein echtes Ticket-/Nachrichtensystem folgt in
      // einem späteren Prompt.
      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "invoice.inquiry.raised",
          aktion: "invoices.inquiry",
          entitaet: "rechnung",
          entitaetId: invoice.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:invoices.inquiry",
          payload: { nachricht: parsed.data.nachricht },
        }),
      );

      return reply.send({ ok: true });
    },
  );
}
