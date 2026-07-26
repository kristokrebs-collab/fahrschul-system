import { auditEreignisse, benutzer, sessions } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { ROLES } from "@fahrschul/domain";
import { buildEventRow } from "@fahrschul/events";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  assertVersion,
  readExpectedVersion,
  requireExpectedVersion,
  sendVersionConflict,
  VersionConflictError,
  withVersionHeaders,
} from "../lib/optimistic.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { requireStepUp, STEP_UP_ACTIONS } from "../lib/step-up.js";

/**
 * PROMPT -1 §17 – Rollen- und Kontostatusänderung.
 *
 * ## Warum diese Route neu ist
 *
 * Die Berechtigung `users:manage` existierte seit Prompt 0 in der
 * Rollenmatrix, hatte aber KEINEN Endpunkt. Damit war eine der sieben
 * Step-up-Aktionen ("Rollenänderung") nicht nachweisbar geschützt, weil sie
 * gar nicht existierte – die Rolle musste per Roh-SQL geändert werden, also
 * völlig ohne Audit. Das ist die Lücke, die hier geschlossen wird.
 *
 * ## Die vier Schranken
 *
 *  1. `users:manage` – ausschließlich Rolle `systemdienst`.
 *  2. **Step-up**: frische Wiederanmeldung mit Passwort UND TOTP.
 *  3. **§4 Version PFLICHT** – zwei gleichzeitige Rollenänderungen
 *     überschreiben sich nicht still.
 *  4. **Kein Selbst-Upgrade.** Der eigene Datensatz kann über diese Route
 *     nicht geändert werden. Sonst wäre `systemdienst` -> `geschaeftsfuehrung`
 *     ein Ein-Klick-Weg zu Fachdaten, und die Zusage "systemdienst hat nur
 *     technische Rechte" (docs/role-permission-matrix.md) wäre wertlos.
 *
 * ## Nebenwirkung, die Absicht ist
 *
 * Eine Rollenänderung LÖSCHT ALLE SITZUNGEN des betroffenen Benutzers. Ohne
 * das würde eine entzogene Rolle bis zum Sitzungsende weiterwirken (der
 * Sitzungslader liest die Rolle aus `benutzer`, aber eine bereits laufende
 * Anfrage und jeder Client-Cache tun es nicht). Ein Rechteentzug, der erst in
 * zwölf Stunden greift, ist kein Rechteentzug.
 */

const roleChangeSchema = z.object({
  rolle: z.enum(ROLES as unknown as [string, ...string[]]).optional(),
  status: z.enum(["aktiv", "gesperrt", "inaktiv"]).optional(),
  grund: z.string().min(3).max(500),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export function registerUserRoutes(app: FastifyInstance, db: Database) {
  app.get(
    "/users",
    { preHandler: [requireAuth, requirePermission("users:manage")] },
    async (request, reply) => {
      // Serverseitige Standortfilterung: auch die technische Rolle sieht nur
      // Konten des eigenen Standorts, sofern sie einem zugeordnet ist.
      const rows = request.user!.standortId
        ? await db
            .select({
              id: benutzer.id,
              email: benutzer.email,
              rolle: benutzer.rolle,
              status: benutzer.status,
              mfaEnabled: benutzer.mfaEnabled,
              standortId: benutzer.standortId,
              version: benutzer.version,
              updatedAt: benutzer.updatedAt,
            })
            .from(benutzer)
            .where(eq(benutzer.standortId, request.user!.standortId))
        : await db
            .select({
              id: benutzer.id,
              email: benutzer.email,
              rolle: benutzer.rolle,
              status: benutzer.status,
              mfaEnabled: benutzer.mfaEnabled,
              standortId: benutzer.standortId,
              version: benutzer.version,
              updatedAt: benutzer.updatedAt,
            })
            .from(benutzer);
      return reply.send({
        users: rows.map((r) => ({ ...r, etag: `W/"${r.version}"` })),
      });
    },
  );

  app.patch(
    "/users/:id/role",
    {
      preHandler: [
        requireAuth,
        requirePermission("users:manage"),
        requireStepUp(db, STEP_UP_ACTIONS.roleChange),
      ],
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = roleChangeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      if (!parsed.data.rolle && !parsed.data.status) {
        return reply.code(400).send({ error: "invalid_body", reason: "rolle oder status erforderlich" });
      }
      if (params.id === request.user!.id) {
        return reply.code(403).send({
          error: "self_modification_forbidden",
          hinweis:
            "Die eigene Rolle bzw. der eigene Kontostatus kann über diese Route nicht geändert werden (Vier-Augen-Prinzip).",
        });
      }
      const expected = requireExpectedVersion(readExpectedVersion(request), reply);
      if (expected === null) return reply;

      try {
        const result = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(benutzer).where(eq(benutzer.id, params.id)).limit(1);
          if (!current) return null;
          if (
            current.standortId !== null &&
            request.user!.standortId !== null &&
            current.standortId !== request.user!.standortId
          ) {
            throw new ForeignStandortError();
          }
          assertVersion(current, expected);

          const [updated] = await tx
            .update(benutzer)
            .set({
              rolle: parsed.data.rolle ?? current.rolle,
              status: parsed.data.status ?? current.status,
            })
            .where(eq(benutzer.id, params.id))
            .returning();

          const revoked = await tx
            .delete(sessions)
            .where(eq(sessions.benutzerId, params.id))
            .returning({ id: sessions.id });

          await tx.insert(auditEreignisse).values(
            buildEventRow({
              type: "role.changed",
              aktion: "users.role.change",
              entitaet: "benutzer",
              entitaetId: updated.id,
              akteurBenutzerId: request.user!.id,
              standortId: request.user!.standortId,
              source: "apps/api:users.role.change",
              correlationId: request.correlationId,
              vorher: { rolle: current.rolle, status: current.status, version: current.version },
              nachher: { rolle: updated.rolle, status: updated.status, version: updated.version },
              payload: { grund: parsed.data.grund, widerrufeneSitzungen: revoked.length },
            }),
          );
          return { updated, revoked: revoked.length };
        });

        if (!result) return reply.code(404).send({ error: "user_not_found" });
        withVersionHeaders(reply, result.updated);
        return reply.send({
          user: {
            id: result.updated.id,
            email: result.updated.email,
            rolle: result.updated.rolle,
            status: result.updated.status,
            version: result.updated.version,
          },
          widerrufeneSitzungen: result.revoked,
          hinweis:
            "Alle Sitzungen des Kontos wurden widerrufen, damit die Änderung sofort und nicht erst nach Sitzungsende wirkt.",
        });
      } catch (err) {
        if (err instanceof ForeignStandortError) {
          return reply.code(404).send({ error: "user_not_found" });
        }
        if (err instanceof VersionConflictError) {
          return sendVersionConflict(err, reply, parsed.data as Record<string, unknown>);
        }
        throw err;
      }
    },
  );
}

class ForeignStandortError extends Error {}
