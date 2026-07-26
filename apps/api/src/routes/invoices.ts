import { auditEreignisse, rechnungen, rechnungspositionen, terminbuchungen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import type { PaymentAdapter } from "@fahrschul/integrations";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { getOwnSchuelerId } from "../services/own-scope.js";
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
  requireExpectedVersion,
  sendVersionConflict,
  VersionConflictError,
  withVersionHeaders,
} from "../lib/optimistic.js";
import { sendBusinessConstraintError } from "../lib/state-machine.js";
import { UNIQUE_VIOLATION } from "../services/booking.js";

const inquirySchema = z.object({ nachricht: z.string().min(1).max(2000) });

/**
 * PROMPT -1 §2/§3 – "Rechnung erzeugen". Bis hierhin gab es KEINEN
 * Erzeugungsendpunkt (Prompt 1-4 legten Rechnungen nur per Fixture/Bankimport
 * an), damit war die Anforderung "keine doppelte Rechnung für dieselbe
 * Leistung" nicht nachweisbar. Jede Position trägt jetzt einen Leistungsbezug
 * (`leistungTerminbuchungId` ODER `leistungRef`), der DB-seitig eindeutig ist.
 */
const positionSchema = z
  .object({
    bezeichnung: z.string().min(1),
    einzelpreisCent: z.number().int().positive(),
    mengeCent: z.number().int().positive().optional(),
    gesamtpreisCent: z.number().int().positive(),
    leistungTerminbuchungId: z.string().uuid().optional(),
    leistungRef: z.string().min(1).optional(),
  })
  .refine((p) => Boolean(p.leistungTerminbuchungId) !== Boolean(p.leistungRef), {
    message: "Genau eines von leistungTerminbuchungId oder leistungRef ist erforderlich.",
  });

const createInvoiceSchema = z.object({
  schuelerId: z.string().uuid(),
  faelligAm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  steuersatz: z.number().min(0).max(1).default(0.19),
  rechnungsnummer: z.string().min(1).optional(),
  positionen: z.array(positionSchema).min(1).max(200),
  idempotencyKey: z.string().min(1).optional(),
});

const patchInvoiceSchema = z.object({
  status: z.enum(["offen", "bezahlt", "ueberfaellig", "storniert"]).optional(),
  faelligAm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rechnungsnummer: z.string().min(1).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

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

  /**
   * Rechnung erzeugen – Rolle "finanzen" (invoices:manage).
   * Idempotenzschlüssel PFLICHT: ein Retry darf keine zweite Rechnung
   * erzeugen. Zusätzlich ist der Leistungsbezug DB-seitig eindeutig
   * (partieller Unique-Index), sodass selbst ein Bug oder ein Roh-SQL-Pfad
   * keine Doppelfakturierung erzeugen kann.
   */
  app.post(
    "/invoices",
    { preHandler: [requireAuth, requirePermission("invoices:manage")] },
    async (request, reply) => {
      const parsed = createInvoiceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const idempotencyKey = readIdempotencyKey(request);
      if (!idempotencyKey) {
        return reply.code(400).send({
          error: "idempotency_key_required",
          hinweis: 'Header "Idempotency-Key" oder Feld "idempotencyKey" ist beim Erzeugen einer Rechnung verpflichtend.',
        });
      }
      const body = parsed.data;
      const betragCent = body.positionen.reduce((sum, p) => sum + p.gesamtpreisCent, 0);

      try {
        const outcome = await runIdempotent({
          db,
          operation: IDEMPOTENT_OPERATIONS.invoiceCreate,
          key: idempotencyKey,
          benutzerId: request.user!.id,
          standortId: request.user!.standortId,
          target: body.schuelerId,
          payload: body,
          handler: async (tx) => {
            // Leistungsbezug auf Termine validieren: eine Rechnung über eine
            // fremde/nicht existierende Fahrstunde wäre stiller Datenmüll.
            for (const pos of body.positionen) {
              if (!pos.leistungTerminbuchungId) continue;
              const [booking] = await tx
                .select({ id: terminbuchungen.id, schuelerId: terminbuchungen.schuelerId })
                .from(terminbuchungen)
                .where(eq(terminbuchungen.id, pos.leistungTerminbuchungId))
                .limit(1);
              if (!booking) throw new LeistungNotFoundError(pos.leistungTerminbuchungId);
              if (booking.schuelerId !== body.schuelerId) {
                throw new LeistungMismatchError(pos.leistungTerminbuchungId);
              }
            }

            const [invoice] = await tx
              .insert(rechnungen)
              .values({
                standortId: request.user!.standortId,
                schuelerId: body.schuelerId,
                betragCent,
                faelligAm: body.faelligAm ?? null,
                steuersatz: String(body.steuersatz),
                nettoCent: Math.round(betragCent / (1 + body.steuersatz)),
                rechnungsnummer: body.rechnungsnummer ?? null,
                status: "offen",
              })
              .returning();

            const positionen = await tx
              .insert(rechnungspositionen)
              .values(
                body.positionen.map((pos) => ({
                  rechnungId: invoice.id,
                  bezeichnung: pos.bezeichnung,
                  mengeCent: pos.mengeCent ?? null,
                  einzelpreisCent: pos.einzelpreisCent,
                  gesamtpreisCent: pos.gesamtpreisCent,
                  leistungTerminbuchungId: pos.leistungTerminbuchungId ?? null,
                  leistungRef: pos.leistungRef ?? null,
                })),
              )
              .returning();

            await tx.insert(auditEreignisse).values(
              buildEventRow({
                type: "invoice.issued",
                aktion: "invoices.create",
                entitaet: "rechnung",
                entitaetId: invoice.id,
                akteurBenutzerId: request.user!.id,
                standortId: request.user!.standortId,
                source: "apps/api:invoices.create",
                idempotencyKey,
                nachher: { id: invoice.id, betragCent: invoice.betragCent, positionen: positionen.length },
              }),
            );

            return {
              status: 201,
              body: { invoice, positionen },
              entitaet: "rechnung",
              entitaetId: invoice.id,
            };
          },
        });

        const out = outcome.body as { invoice: { id: string; version: number; updatedAt: Date | string | null } };
        withVersionHeaders(reply, out.invoice);
        return reply
          .code(outcome.replayed ? 200 : outcome.status)
          .send({ ...(outcome.body as object), replayed: outcome.replayed });
      } catch (err) {
        if (err instanceof IdempotencyConflictError) return sendIdempotencyConflict(err, reply);
        if (err instanceof LeistungNotFoundError) {
          return reply.code(404).send({ error: "leistung_not_found", leistungId: err.message });
        }
        if (err instanceof LeistungMismatchError) {
          return reply
            .code(422)
            .send({ error: "leistung_gehoert_anderem_schueler", leistungId: err.message });
        }
        const pg = err as { code?: string; constraint?: string };
        if (pg.code === UNIQUE_VIOLATION) {
          // Der partielle Unique-Index rechnungspositionen_leistung_once_idx
          // hat zugeschlagen: für diese Leistung existiert bereits eine
          // nicht-stornierte Rechnung.
          return reply.code(409).send({
            error: "duplicate_invoice_for_leistung",
            constraint: pg.constraint,
            message: "Für diese Leistung existiert bereits eine nicht stornierte Rechnung.",
          });
        }
        if (sendBusinessConstraintError(err, reply)) return reply;
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  /** §4: Rechnungsänderung nur mit gelesener Version (kein stilles Überschreiben). */
  app.patch(
    "/invoices/:id",
    { preHandler: [requireAuth, requirePermission("invoices:manage")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = patchInvoiceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const expected = requireExpectedVersion(readExpectedVersion(request), reply);
      if (expected === null) return reply;

      try {
        const updated = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(rechnungen).where(eq(rechnungen.id, params.id)).limit(1);
          if (!current) return null;
          assertVersion(current, expected);
          const [row] = await tx
            .update(rechnungen)
            .set({
              status: parsed.data.status ?? current.status,
              faelligAm: parsed.data.faelligAm ?? current.faelligAm,
              rechnungsnummer: parsed.data.rechnungsnummer ?? current.rechnungsnummer,
            })
            .where(and(eq(rechnungen.id, params.id), eq(rechnungen.version, expected)))
            .returning();
          if (!row) {
            const [fresh] = await tx.select().from(rechnungen).where(eq(rechnungen.id, params.id)).limit(1);
            throw new VersionConflictError(expected, fresh);
          }
          await tx.insert(auditEreignisse).values(
            buildEventRow({
              type: "invoice.issued",
              aktion: "invoices.patch",
              entitaet: "rechnung",
              entitaetId: row.id,
              akteurBenutzerId: request.user!.id,
              standortId: request.user!.standortId,
              source: "apps/api:invoices.patch",
              vorher: { status: current.status, version: current.version },
              nachher: { status: row.status, version: row.version },
            }),
          );
          return row;
        });
        if (!updated) return reply.code(404).send({ error: "invoice_not_found" });
        withVersionHeaders(reply, updated);
        return reply.send({ invoice: updated });
      } catch (err) {
        if (err instanceof VersionConflictError) {
          return sendVersionConflict(err, reply, parsed.data as Record<string, unknown>);
        }
        if (sendBusinessConstraintError(err, reply)) return reply;
        throw err;
      }
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

class LeistungNotFoundError extends Error {}
class LeistungMismatchError extends Error {}
