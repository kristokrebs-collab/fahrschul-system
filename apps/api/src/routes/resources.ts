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
import { and, eq } from "drizzle-orm";
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
  requireExpectedVersion,
  sendVersionConflict,
  VersionConflictError,
  withVersionHeaders,
} from "../lib/optimistic.js";
import { sendBusinessConstraintError, transitionState } from "../lib/state-machine.js";

const raumSchema = z.object({ name: z.string().min(1), ausstattung: z.array(z.string()).default([]) });
const simulatorSchema = z.object({ name: z.string().min(1) });
const mangelSchema = z.object({ fahrzeugId: z.string().uuid(), grund: z.string().min(1) });

/**
 * PROMPT -1 §2/§3/§10 – "Fahrzeug blockieren" als eigener, idempotenter und
 * versionsgeprüfter Endpunkt. Vorher wurde das Fahrzeug nur als Nebenwirkung
 * einer Mangelmeldung auf "wartung" gesetzt, ohne Idempotenz und ohne
 * Versionsprüfung – zwei parallele Meldungen konnten den Fahrzeugstatus
 * gegenseitig überschreiben.
 */
const blockSchema = z.object({
  grund: z.string().min(1).max(500),
  schweregrad: z.enum(["gering", "mittel", "kritisch"]).default("mittel"),
  expectedVersion: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(1).optional(),
});
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
          .values({
            standortId: request.user!.standortId,
            fahrzeugId: parsed.data.fahrzeugId,
            grund: parsed.data.grund,
            mangelStatus: "reported",
          })
          .returning();
        // §10: reported -> triaged -> vehicle_blocked, persistiert und
        // auditiert; das Fahrzeug wird im gleichen Zug gesperrt.
        await transitionState(tx, {
          machine: "fahrzeugmangel",
          entitaetId: mangel.id,
          to: "triaged",
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          grund: "Meldung aufgenommen",
        });
        const blocked = await transitionState(tx, {
          machine: "fahrzeugmangel",
          entitaetId: mangel.id,
          to: "vehicle_blocked",
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          grund: parsed.data.grund,
        });
        await tx.update(fahrzeuge).set({ status: "wartung" }).where(eq(fahrzeuge.id, parsed.data.fahrzeugId));
        return (blocked.row ?? mangel) as typeof mangel;
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

  /**
   * Fahrzeug blockieren. Idempotenzschlüssel PFLICHT (neuer Endpunkt),
   * Version PFLICHT. Ein bereits gesperrtes Fahrzeug erneut zu sperren ist
   * ein Konflikt, kein stiller Erfolg.
   */
  app.post(
    "/resources/fahrzeuge/:id/block",
    { preHandler: [requireAuth, requirePermission("resources:manage")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = blockSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      const idempotencyKey = readIdempotencyKey(request);
      if (!idempotencyKey) {
        return reply.code(400).send({
          error: "idempotency_key_required",
          hinweis: 'Header "Idempotency-Key" oder Feld "idempotencyKey" ist beim Sperren eines Fahrzeugs verpflichtend.',
        });
      }
      const expected = requireExpectedVersion(readExpectedVersion(request), reply);
      if (expected === null) return reply;

      try {
        const outcome = await runIdempotent({
          db,
          operation: IDEMPOTENT_OPERATIONS.vehicleBlock,
          key: idempotencyKey,
          benutzerId: request.user!.id,
          standortId: request.user!.standortId,
          target: params.id,
          payload: { grund: parsed.data.grund, schweregrad: parsed.data.schweregrad },
          handler: async (tx) => {
            const [vehicle] = await tx.select().from(fahrzeuge).where(eq(fahrzeuge.id, params.id)).limit(1);
            if (!vehicle) throw new VehicleNotFoundError();
            assertVersion(vehicle, expected);
            if (vehicle.status !== "verfuegbar") throw new AlreadyBlockedError(vehicle.status);

            const [mangel] = await tx
              .insert(fahrzeugmaengel)
              .values({
                standortId: request.user!.standortId,
                fahrzeugId: vehicle.id,
                grund: parsed.data.grund,
                schweregrad: parsed.data.schweregrad,
                einsatzbereit: false,
                gemeldetVonBenutzerId: request.user!.id,
                mangelStatus: "reported",
              })
              .returning();

            await transitionState(tx, {
              machine: "fahrzeugmangel",
              entitaetId: mangel.id,
              to: "triaged",
              akteurBenutzerId: request.user!.id,
              standortId: request.user!.standortId,
              grund: "Sperrung angefordert",
            });
            await transitionState(tx, {
              machine: "fahrzeugmangel",
              entitaetId: mangel.id,
              to: "vehicle_blocked",
              akteurBenutzerId: request.user!.id,
              standortId: request.user!.standortId,
              grund: parsed.data.grund,
              eventType: "vehicle.blocked",
              aktion: "resources.fahrzeug.block",
              source: "apps/api:resources.fahrzeug.block",
              payload: { fahrzeugId: vehicle.id, schweregrad: parsed.data.schweregrad },
            });

            const [updated] = await tx
              .update(fahrzeuge)
              .set({ status: "wartung" })
              .where(and(eq(fahrzeuge.id, vehicle.id), eq(fahrzeuge.version, expected)))
              .returning();
            if (!updated) {
              const [fresh] = await tx.select().from(fahrzeuge).where(eq(fahrzeuge.id, vehicle.id)).limit(1);
              throw new VersionConflictError(expected, fresh);
            }

            return {
              status: 200,
              body: { fahrzeug: updated, fahrzeugmangelId: mangel.id },
              entitaet: "fahrzeug",
              entitaetId: updated.id,
            };
          },
        });

        const out = outcome.body as { fahrzeug: { id: string; version: number; updatedAt: Date | string | null } };
        withVersionHeaders(reply, out.fahrzeug);
        return reply.send({ ...(outcome.body as object), replayed: outcome.replayed });
      } catch (err) {
        if (err instanceof VehicleNotFoundError) return reply.code(404).send({ error: "not_found" });
        if (err instanceof AlreadyBlockedError) {
          return reply.code(409).send({ error: "vehicle_already_blocked", status: err.message });
        }
        if (err instanceof IdempotencyConflictError) return sendIdempotencyConflict(err, reply);
        if (err instanceof VersionConflictError) {
          return sendVersionConflict(err, reply, parsed.data as Record<string, unknown>);
        }
        if (sendBusinessConstraintError(err, reply)) return reply;
        request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  /** §4: Fahrzeugstatus allgemein ändern – nur mit gelesener Version. */
  app.patch(
    "/resources/fahrzeuge/:id",
    { preHandler: [requireAuth, requirePermission("resources:manage")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = z
        .object({
          status: z.enum(["verfuegbar", "wartung", "defekt", "ausgemustert"]).optional(),
          kilometerstand: z.number().int().nonnegative().optional(),
          expectedVersion: z.number().int().nonnegative().optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      const expected = requireExpectedVersion(readExpectedVersion(request), reply);
      if (expected === null) return reply;

      try {
        const updated = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(fahrzeuge).where(eq(fahrzeuge.id, params.id)).limit(1);
          if (!current) return null;
          assertVersion(current, expected);
          const [row] = await tx
            .update(fahrzeuge)
            .set({
              status: parsed.data.status ?? current.status,
              kilometerstand: parsed.data.kilometerstand ?? current.kilometerstand,
            })
            .where(and(eq(fahrzeuge.id, params.id), eq(fahrzeuge.version, expected)))
            .returning();
          if (!row) {
            const [fresh] = await tx.select().from(fahrzeuge).where(eq(fahrzeuge.id, params.id)).limit(1);
            throw new VersionConflictError(expected, fresh);
          }
          await tx.insert(auditEreignisse).values(
            buildEventRow({
              type: "vehicle.blocked",
              aktion: "resources.fahrzeug.patch",
              entitaet: "fahrzeug",
              entitaetId: row.id,
              akteurBenutzerId: request.user!.id,
              standortId: request.user!.standortId,
              source: "apps/api:resources.fahrzeug.patch",
              vorher: { status: current.status, version: current.version },
              nachher: { status: row.status, version: row.version },
            }),
          );
          return row;
        });
        if (!updated) return reply.code(404).send({ error: "not_found" });
        withVersionHeaders(reply, updated);
        return reply.send({ fahrzeug: updated });
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
    "/resources/fahrzeugmaengel/:id/beheben",
    { preHandler: [requireAuth, requirePermission("resources:manage")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const [mangel] = await db.select().from(fahrzeugmaengel).where(eq(fahrzeugmaengel.id, params.id)).limit(1);
      if (!mangel) return reply.code(404).send({ error: "not_found" });

      const result = await db.transaction(async (tx) => {
        const done = await transitionState(tx, {
          machine: "fahrzeugmangel",
          entitaetId: params.id,
          to: "resolved",
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          grund: "Mangel behoben",
          patch: { behobenAt: new Date() },
        });
        await tx.update(fahrzeuge).set({ status: "verfuegbar" }).where(eq(fahrzeuge.id, mangel.fahrzeugId));
        return done.row;
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

class VehicleNotFoundError extends Error {}
class AlreadyBlockedError extends Error {}
