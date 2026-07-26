import { hashSessionToken, isSessionExpired, SESSION_COOKIE_NAME } from "@fahrschul/auth";
import type { Role } from "@fahrschul/domain";
import { hasPermission, type Permission } from "@fahrschul/permissions";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { benutzer, sessions } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";

export interface AuthenticatedUser {
  id: string;
  email: string;
  rolle: Role;
  standortId: string | null;
  mfaVerified: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * Lädt die Session aus dem httpOnly-Cookie und hängt den Benutzer an
 * request.user. Wirft KEINEN Fehler bei fehlender Session – das erledigen
 * requireAuth/requireRole, damit z. B. /health ohne Session erreichbar
 * bleibt.
 */
export function createSessionLoader(db: Database) {
  return async function loadSession(request: FastifyRequest, _reply: FastifyReply) {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) return;

    const tokenHash = hashSessionToken(token);
    const rows = await db
      .select({
        sessionId: sessions.id,
        expiresAt: sessions.expiresAt,
        mfaVerified: sessions.mfaVerified,
        benutzerId: benutzer.id,
        email: benutzer.email,
        rolle: benutzer.rolle,
        standortId: benutzer.standortId,
        status: benutzer.status,
      })
      .from(sessions)
      .innerJoin(benutzer, eq(sessions.benutzerId, benutzer.id))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    if (!row) return;
    if (isSessionExpired(row.expiresAt)) return;
    if (row.status !== "aktiv") return;

    request.user = {
      id: row.benutzerId,
      email: row.email,
      rolle: row.rolle as Role,
      standortId: row.standortId,
      mfaVerified: row.mfaVerified,
    };
  };
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.code(401).send({ error: "unauthenticated" });
  }
}

export function requireRole(...roles: Role[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    if (!roles.includes(request.user.rolle)) {
      return reply.code(403).send({ error: "forbidden", requiredRoles: roles });
    }
  };
}

export function requirePermission(permission: Permission) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    if (!hasPermission(request.user.rolle, permission)) {
      return reply.code(403).send({ error: "forbidden", requiredPermission: permission });
    }
  };
}

/**
 * Erlaubt den Zugriff, wenn der Akteur MINDESTENS EINE der genannten
 * Berechtigungen besitzt. Nötig für Operationen, die es in einer own- und
 * einer any-Variante gibt (z. B. Terminstorno: Schüler storniert eigene
 * Termine über `appointments:cancel:own`, Büro fremde über
 * `appointments:cancel:any`) – die Scope-Prüfung selbst erfolgt weiterhin in
 * der Route gegen die Datenbank, nicht hier.
 */
export function requireAnyPermission(...permissions: Permission[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    const erlaubt = permissions.some((p) => hasPermission(request.user!.rolle, p));
    if (!erlaubt) {
      return reply.code(403).send({ error: "forbidden", requiredPermission: permissions.join("|") });
    }
  };
}
