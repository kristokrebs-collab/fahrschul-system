import { randomBytes, createHash } from "node:crypto";

/**
 * Server-seitige Sessions (keine JWTs im Client, kein PIN). Ein Session-
 * Token wird zufällig erzeugt, dessen SHA-256-Hash in der Datenbank
 * gespeichert (das Klartext-Token verlässt den Server nur als httpOnly-
 * Cookie), sodass ein DB-Leak allein keine gültigen Sessions preisgibt.
 */

export const SESSION_COOKIE_NAME = "fahrschul_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiryFromNow(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

export function isSessionExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}
