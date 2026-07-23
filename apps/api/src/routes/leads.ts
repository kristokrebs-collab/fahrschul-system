import { auditEreignisse, leads, schueler } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const createLeadSchema = z.object({
  vorname: z.string().min(1),
  nachname: z.string().min(1),
  email: z.string().email().optional(),
  telefon: z.string().optional(),
  quelle: z.string().min(1).default("webseite"),
  interesseKlasse: z.string().optional(),
  kommentar: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(["neu", "kontaktiert", "termin_vereinbart", "verloren"]),
});

/**
 * Leads/CRM (Prompt 2). Lead->Schüler-Konvertierung legt einen echten
 * `schueler`-Datensatz an und verkettet den Lead darauf
 * (`konvertiertZuSchuelerId`) statt den Lead-Datensatz zu löschen – so
 * bleibt die Herkunft nachvollziehbar (Audit).
 */
export function registerLeadRoutes(app: FastifyInstance, db: Database) {
  app.get("/leads", { preHandler: [requireAuth, requirePermission("leads:manage")] }, async (_request, reply) => {
    const rows = await db.select().from(leads);
    return reply.send({ leads: rows });
  });

  app.post("/leads", { preHandler: [requireAuth, requirePermission("leads:manage")] }, async (request, reply) => {
    const parsed = createLeadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

    const [inserted] = await db
      .insert(leads)
      .values({
        standortId: request.user!.standortId,
        vorname: parsed.data.vorname,
        nachname: parsed.data.nachname,
        email: parsed.data.email ?? null,
        telefon: parsed.data.telefon ?? null,
        quelle: parsed.data.quelle,
        interesseKlasse: parsed.data.interesseKlasse ?? null,
        kommentar: parsed.data.kommentar ?? null,
      })
      .returning();

    await db.insert(auditEreignisse).values(
      buildEventRow({
        type: "lead.created",
        aktion: "leads.create",
        entitaet: "lead",
        entitaetId: inserted.id,
        akteurBenutzerId: request.user!.id,
        standortId: request.user!.standortId,
        source: "apps/api:leads.create",
        nachher: inserted,
      }),
    );
    return reply.code(201).send({ lead: inserted });
  });

  app.post(
    "/leads/:id/status",
    { preHandler: [requireAuth, requirePermission("leads:manage")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = updateStatusSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      const [updated] = await db
        .update(leads)
        .set({ status: parsed.data.status, updatedAt: new Date() })
        .where(eq(leads.id, params.id))
        .returning();
      if (!updated) return reply.code(404).send({ error: "lead_not_found" });
      return reply.send({ lead: updated });
    },
  );

  /**
   * Lead -> Schüler-Konvertierung. Legt einen neuen `schueler`-Datensatz an
   * (KEIN Login-Konto – das bleibt einem separaten Onboarding-Schritt
   * vorbehalten, siehe docs/fachliche-bestaetigungen.md Punkt 6 aus Prompt 1
   * "kein Self-Signup") und markiert den Lead als "konvertiert".
   */
  app.post(
    "/leads/:id/convert",
    { preHandler: [requireAuth, requirePermission("leads:manage")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const [lead] = await db.select().from(leads).where(eq(leads.id, params.id)).limit(1);
      if (!lead) return reply.code(404).send({ error: "lead_not_found" });
      if (lead.status === "konvertiert") {
        return reply.code(409).send({ error: "already_converted", schuelerId: lead.konvertiertZuSchuelerId });
      }

      const result = await db.transaction(async (tx) => {
        const [neuerSchueler] = await tx
          .insert(schueler)
          .values({
            standortId: request.user!.standortId,
            vorname: lead.vorname,
            nachname: lead.nachname,
            email: lead.email,
            telefon: lead.telefon,
          })
          .returning();
        const [updatedLead] = await tx
          .update(leads)
          .set({ status: "konvertiert", konvertiertZuSchuelerId: neuerSchueler.id, updatedAt: new Date() })
          .where(eq(leads.id, lead.id))
          .returning();
        return { lead: updatedLead, schueler: neuerSchueler };
      });

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "student.enrolled",
          aktion: "leads.convert",
          entitaet: "schueler",
          entitaetId: result.schueler.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:leads.convert",
          vorher: { leadId: lead.id },
          nachher: result.schueler,
        }),
      );

      return reply.code(201).send(result);
    },
  );
}
