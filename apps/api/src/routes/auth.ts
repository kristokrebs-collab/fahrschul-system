import {
  generateSessionToken,
  hashSessionToken,
  sessionExpiryFromNow,
  SESSION_COOKIE_NAME,
  STAFF_ROLES_REQUIRING_MFA,
  verifyPassword,
  verifyTotpToken,
} from "@fahrschul/auth";
import { benutzer, sessions } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { auditEreignisse } from "@fahrschul/database";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@fahrschul/database";
import { requireAuth } from "../middleware/auth.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpToken: z.string().optional(),
});

export function registerAuthRoutes(app: FastifyInstance, db: Database, cookieSecure: boolean) {
  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const { email, password, totpToken } = parsed.data;

    const rows = await db.select().from(benutzer).where(eq(benutzer.email, email)).limit(1);
    const user = rows[0];

    // Bewusst dieselbe generische Fehlermeldung für "kein Konto" und
    // "falsches Passwort", um kein User-Enumeration-Orakel zu bauen.
    const genericFailure = () => reply.code(401).send({ error: "invalid_credentials" });

    if (!user || user.status !== "aktiv") {
      return genericFailure();
    }

    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk) {
      return genericFailure();
    }

    const mfaRequired =
      user.mfaEnabled || (STAFF_ROLES_REQUIRING_MFA as readonly string[]).includes(user.rolle);

    let mfaVerified = false;
    if (mfaRequired) {
      if (!user.mfaEnabled || !user.mfaSecret) {
        // Mitarbeitendenrolle ohne abgeschlossenes MFA-Setup: Login wird
        // verweigert statt stillschweigend ohne MFA durchzulassen.
        return reply.code(403).send({ error: "mfa_setup_required" });
      }
      if (!totpToken || !verifyTotpToken(totpToken, user.mfaSecret)) {
        return reply.code(401).send({ error: "mfa_required_or_invalid" });
      }
      mfaVerified = true;
    }

    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = sessionExpiryFromNow();

    await db.transaction(async (tx) => {
      await tx.insert(sessions).values({
        benutzerId: user.id,
        tokenHash,
        mfaVerified,
        expiresAt,
      });
      await tx.insert(auditEreignisse).values(
        buildEventRow({
          type: "login",
          aktion: "login",
          entitaet: "benutzer",
          entitaetId: user.id,
          akteurBenutzerId: user.id,
          standortId: user.standortId,
          source: "apps/api:auth.login",
        }),
      );
    });

    reply.setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        rolle: user.rolle,
        vorname: user.vorname,
        nachname: user.nachname,
        standortId: user.standortId,
      },
    });
  });

  app.post("/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token) {
      const tokenHash = hashSessionToken(token);
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true });
  });

  app.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    return reply.send({ user: request.user });
  });
}
