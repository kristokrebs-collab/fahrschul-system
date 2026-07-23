import {
  arbeitszeitregeln,
  auditEreignisse,
  fahrzeuge,
  fahrzeugmaengel,
  raeume,
  simulatorgeraete,
} from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const raumSchema = z.object({ name: z.string().min(1), ausstattung: z.array(z.string()).default([]) });
const simulatorSchema = z.object({ name: z.string().min(1) });
const mangelSchema = z.object({ fahrzeugId: z.string().uuid(), grund: z.string().min(1) });
const arbeitszeitregelSchema = z.object({
  fahrlehrerId: z.string().uuid(),
  maxStundenProTag: z.number().positive().default(8),
  maxStundenProWoche: z.number().positive().default(40),
  minPauseMinuten: z.number().int().nonnegative().default(15),
});

/**
 * Ressourcen-Tab: Räume/Simulatorgeräte/Fahrzeugmängel/Arbeitszeitregeln.
 * Arbeitszeitregeln sind bewusst NUR Anzeige-/Warn-Konfiguration (Spec
 * "Arbeitszeit ... NO automatic personnel action") – es gibt hier keinen
 * Endpunkt, der automatisch sperrt oder benachrichtigt.
 */
export function registerResourceRoutes(app: FastifyInstance, db: Database) {
  app.get("/resources/raeume", { preHandler: [requireAuth, requirePermission("resources:manage")] }, async (request, reply) => {
    const rows = await db.select().from(raeume);
    return reply.send({ raeume: rows });
  });

  app.post(
    "/resources/raeume",
    { preHandler: [requireAuth, requirePermission("resources:manage")] },
    async (request, reply) => {
      const parsed = raumSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      const [inserted] = await db
        .insert(raeume)
        .values({ standortId: request.user!.standortId, name: parsed.data.name, ausstattung: parsed.data.ausstattung })
        .returning();
      return reply.code(201).send({ raum: inserted });
    },
  );

  app.get(
    "/resources/simulatorgeraete",
    { preHandler: [requireAuth, requirePermission("resources:manage")] },
    async (_request, reply) => {
      const rows = await db.select().from(simulatorgeraete);
      return reply.send({ simulatorgeraete: rows });
    },
  );

  app.post(
    "/resources/simulatorgeraete",
    { preHandler: [requireAuth, requirePermission("resources:manage")] },
    async (request, reply) => {
      const parsed = simulatorSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      const [inserted] = await db
        .insert(simulatorgeraete)
        .values({ standortId: request.user!.standortId, name: parsed.data.name })
        .returning();
      return reply.code(201).send({ simulatorgeraet: inserted });
    },
  );

  /**
   * Fahrzeugausfall melden (Heute-Queue "Sofort: Fahrzeugausfall"). Setzt
   * den Fahrzeugstatus explizit auf "wartung" (harte Regel
   * VEHICLE_NOT_READY greift dann sofort bei jeder neuen Buchung), damit
   * "Fahrzeug einsatzbereit" serverseitig durchgesetzt bleibt.
   */
  app.post(
    "/resources/fahrzeugmaengel",
    { preHandler: [requireAuth, requirePermission("resources:manage")] },
    async (request, reply) => {
      const parsed = mangelSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

      const result = await db.transaction(async (tx) => {
        const [mangel] = await tx
          .insert(fahrzeugmaengel)
          .values({ standortId: request.user!.standortId, fahrzeugId: parsed.data.fahrzeugId, grund: parsed.data.grund })
          .returning();
        await tx.update(fahrzeuge).set({ status: "wartung", updatedAt: new Date() }).where(eq(fahrzeuge.id, parsed.data.fahrzeugId));
        return mangel;
      });

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "lesson.cancelled",
          aktion: "fahrzeugmaengel.report",
          entitaet: "fahrzeugmangel",
          entitaetId: result.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:resources.fahrzeugmangel",
          nachher: result,
        }),
      );
      return reply.code(201).send({ fahrzeugmangel: result });
    },
  );

  app.post(
    "/resources/fahrzeugmaengel/:id/beheben",
    { preHandler: [requireAuth, requirePermission("resources:manage")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const [mangel] = await db.select().from(fahrzeugmaengel).where(eq(fahrzeugmaengel.id, params.id)).limit(1);
      if (!mangel) return reply.code(404).send({ error: "not_found" });

      const result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(fahrzeugmaengel)
          .set({ status: "behoben", behobenAt: new Date(), updatedAt: new Date() })
          .where(eq(fahrzeugmaengel.id, params.id))
          .returning();
        await tx.update(fahrzeuge).set({ status: "verfuegbar", updatedAt: new Date() }).where(eq(fahrzeuge.id, mangel.fahrzeugId));
        return updated;
      });
      return reply.send({ fahrzeugmangel: result });
    },
  );

  app.get(
    "/resources/fahrzeugmaengel",
    { preHandler: [requireAuth, requirePermission("resources:manage")] },
    async (_request, reply) => {
      const rows = await db.select().from(fahrzeugmaengel);
      return reply.send({ fahrzeugmaengel: rows });
    },
  );

  /**
   * Arbeitszeitregeln (nur Anzeige/Warnkonfiguration, siehe Modul-Kommentar).
   */
  app.get(
    "/resources/arbeitszeitregeln",
    { preHandler: [requireAuth, requirePermission("resources:manage")] },
    async (_request, reply) => {
      const rows = await db.select().from(arbeitszeitregeln);
      return reply.send({ arbeitszeitregeln: rows });
    },
  );

  app.put(
    "/resources/arbeitszeitregeln",
    { preHandler: [requireAuth, requirePermission("resources:manage")] },
    async (request, reply) => {
      const parsed = arbeitszeitregelSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

      const existing = await db
        .select()
        .from(arbeitszeitregeln)
        .where(eq(arbeitszeitregeln.fahrlehrerId, parsed.data.fahrlehrerId))
        .limit(1);

      const values = {
        standortId: request.user!.standortId,
        fahrlehrerId: parsed.data.fahrlehrerId,
        maxStundenProTag: String(parsed.data.maxStundenProTag),
        maxStundenProWoche: String(parsed.data.maxStundenProWoche),
        minPauseMinuten: parsed.data.minPauseMinuten,
        updatedAt: new Date(),
      };

      const row = existing[0]
        ? (await db.update(arbeitszeitregeln).set(values).where(eq(arbeitszeitregeln.id, existing[0].id)).returning())[0]
        : (await db.insert(arbeitszeitregeln).values(values).returning())[0];

      return reply.send({ arbeitszeitregel: row });
    },
  );
}
