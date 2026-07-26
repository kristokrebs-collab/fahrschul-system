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
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Database } from "@fahrschul/database";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  checkBruteForce,
  clearLoginFailures,
  delay,
  listLockedThrottles,
  registerLoginFailure,
  unlockThrottle,
  type BruteForceConfig,
} from "../lib/brute-force.js";
import { issueCsrfToken, setCsrfCookie } from "../lib/csrf.js";
import { recordLoginFailure, type LoginFailureReason } from "../lib/metrics.js";
import { log } from "../lib/observability.js";
import { clientIp } from "../lib/rate-limit.js";
import {
  STEP_UP_ACTIONS,
  STEP_UP_ACTION_VALUES,
  grantStepUp,
  readStepUp,
  requireStepUp,
  stepUpTtlMs,
  type StepUpAction,
} from "../lib/step-up.js";
import { emitAlarm } from "../workers/alarm.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpToken: z.string().optional(),
});

const stepUpSchema = z.object({
  password: z.string().min(1),
  totpToken: z.string().optional(),
  /** Für welche Aktion die Wiederanmeldung gilt; "all" erlaubt alle. */
  scope: z.union([z.enum(STEP_UP_ACTION_VALUES as [string, ...string[]]), z.literal("all")]).default("all"),
});

const unlockSchema = z.object({
  scope: z.enum(["account", "ip"]),
  key: z.string().min(1).max(320),
});

export interface AuthRouteOptions {
  cookieSecure: boolean;
  csrfSecret: string;
  bruteForce: BruteForceConfig;
}

export function registerAuthRoutes(app: FastifyInstance, db: Database, options: AuthRouteOptions) {
  const { cookieSecure, csrfSecret, bruteForce } = options;

  /**
   * PROMPT -1 §17 – CSRF-Token abholen.
   *
   * Ein GET, weil er nichts verändert. Der Token ist an die AKTUELLE Sitzung
   * gebunden (HMAC über den Sitzungstoken) und wird zusätzlich als
   * nicht-httpOnly-Cookie gesetzt, damit der Double-Submit funktioniert.
   * Ohne Sitzung gibt es keinen Token – dann trägt die Origin-Prüfung.
   */
  app.get("/auth/csrf", async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionToken) {
      return reply.code(200).send({
        csrfToken: null,
        hinweis:
          "Ohne Sitzung wird kein CSRF-Token ausgegeben. Schreibvorgänge sind dann ohnehin nicht autorisiert; für den Login gilt die Origin-Prüfung.",
      });
    }
    const token = issueCsrfToken(sessionToken, csrfSecret);
    setCsrfCookie(reply, token, cookieSecure);
    return reply.send({ csrfToken: token, headerName: "x-csrf-token" });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const { email, password, totpToken } = parsed.data;
    const ip = clientIp(request);

    /**
     * §17 Brute-Force-Schutz. Die Prüfung steht VOR der Passwortverifikation:
     * argon2/bcrypt sind absichtlich teuer, und ein Angreifer soll diese
     * Kosten nicht beliebig oft auslösen können.
     */
    const throttle = await checkBruteForce(db, { email, ip, config: bruteForce });
    if (throttle.locked) {
      recordLoginFailure("locked");
      reply.header("Retry-After", String(throttle.retryAfterSeconds));
      log({
        severity: "warn",
        requestId: request.requestId,
        correlationId: request.correlationId,
        operation: "POST /auth/login",
        errorCode: "ACCOUNT_TEMPORARILY_LOCKED",
        message: `Anmeldung gesperrt (${throttle.lockedScope})`,
        details: { scope: throttle.lockedScope, retryAfterSeconds: throttle.retryAfterSeconds },
      });
      // Identische Antwort für existierende und nicht existierende Konten
      // (kein Enumerationsorakel, siehe lib/brute-force.ts).
      return reply.code(429).send({
        error: "account_temporarily_locked",
        retryAfterSeconds: throttle.retryAfterSeconds,
        hinweis:
          "Zu viele fehlgeschlagene Anmeldeversuche. Die Sperre endet automatisch (siehe Retry-After). Die Rolle systemdienst kann über POST /auth/unlock vorzeitig entsperren.",
      });
    }
    // Progressive Verzögerung: senkt den Durchsatz eines Angreifers um
    // Größenordnungen und kostet einen echten Nutzer maximal vier Sekunden.
    if (throttle.delayMs > 0) await delay(throttle.delayMs);

    const rows = await db.select().from(benutzer).where(eq(benutzer.email, email)).limit(1);
    const user = rows[0];

    const fail = async (reason: LoginFailureReason, status: number, body: Record<string, unknown>) => {
      recordLoginFailure(reason);
      const outcome = await registerLoginFailure(db, { email, ip, reason, config: bruteForce });
      if (outcome.newlyLocked) {
        await emitAlarm({
          kind: "brute_force_lockout",
          source: "auth",
          subject: `Anmeldesperre gesetzt (${outcome.newlyLocked})`,
          correlationId: request.correlationId,
          details: {
            scope: outcome.newlyLocked,
            accountFailures: outcome.accountFailures,
            ipFailures: outcome.ipFailures,
          },
        });
      }
      log({
        severity: "warn",
        requestId: request.requestId,
        correlationId: request.correlationId,
        operation: "POST /auth/login",
        errorCode: reason,
        message: "Anmeldung fehlgeschlagen",
        details: { accountFailures: outcome.accountFailures, ipFailures: outcome.ipFailures },
      });
      return reply.code(status).send(body);
    };

    // Bewusst dieselbe generische Fehlermeldung für "kein Konto" und
    // "falsches Passwort", um kein User-Enumeration-Orakel zu bauen.
    if (!user) return fail("unknown_account", 401, { error: "invalid_credentials" });
    if (user.status !== "aktiv") return fail("inactive", 401, { error: "invalid_credentials" });

    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk) return fail("wrong_password", 401, { error: "invalid_credentials" });

    const mfaRequired =
      user.mfaEnabled || (STAFF_ROLES_REQUIRING_MFA as readonly string[]).includes(user.rolle);

    let mfaVerified = false;
    if (mfaRequired) {
      if (!user.mfaEnabled || !user.mfaSecret) {
        // Mitarbeitendenrolle ohne abgeschlossenes MFA-Setup: Login wird
        // verweigert statt stillschweigend ohne MFA durchzulassen.
        return fail("mfa_setup_required", 403, { error: "mfa_setup_required" });
      }
      if (!totpToken || !verifyTotpToken(totpToken, user.mfaSecret)) {
        return fail("mfa_missing_or_invalid", 401, { error: "mfa_required_or_invalid" });
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
          correlationId: request.correlationId,
        }),
      );
    });

    // Erfolg löscht den KONTO-Zähler (nicht den IP-Zähler, siehe
    // lib/brute-force.ts).
    await clearLoginFailures(db, { email });

    reply.setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
    // §17: der CSRF-Token wird direkt mit ausgegeben, damit ein Client ihn
    // nicht extra holen muss.
    const csrfToken = issueCsrfToken(token, csrfSecret);
    setCsrfCookie(reply, csrfToken, cookieSecure);

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        rolle: user.rolle,
        vorname: user.vorname,
        nachname: user.nachname,
        standortId: user.standortId,
      },
      csrfToken,
    });
  });

  /**
   * PROMPT -1 §17 – Step-up-Authentisierung.
   *
   * Frische Wiederanmeldung innerhalb einer bestehenden Sitzung. Für
   * Mitarbeitende ist der TOTP-Code PFLICHT (sie haben MFA, und genau dessen
   * Frische ist der Punkt); für Schüler genügt das Passwort, weil sie kein
   * MFA haben – und keine der Step-up-Aktionen ist für Schüler erreichbar.
   *
   * Fehlversuche laufen in denselben Brute-Force-Zähler wie der Login: ein
   * Step-up-Endpunkt ohne Sperre wäre ein Passwort-Orakel mit gültiger
   * Sitzung.
   */
  app.post("/auth/step-up", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = stepUpSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const sessionToken = request.cookies[SESSION_COOKIE_NAME]!;
    const ip = clientIp(request);
    const email = request.user!.email;

    const throttle = await checkBruteForce(db, { email, ip, config: bruteForce });
    if (throttle.locked) {
      reply.header("Retry-After", String(throttle.retryAfterSeconds));
      return reply.code(429).send({
        error: "account_temporarily_locked",
        retryAfterSeconds: throttle.retryAfterSeconds,
      });
    }
    if (throttle.delayMs > 0) await delay(throttle.delayMs);

    const [user] = await db.select().from(benutzer).where(eq(benutzer.id, request.user!.id)).limit(1);
    if (!user || user.status !== "aktiv") {
      return reply.code(401).send({ error: "unauthenticated" });
    }

    const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);
    const mfaNeeded =
      user.mfaEnabled || (STAFF_ROLES_REQUIRING_MFA as readonly string[]).includes(user.rolle);
    const totpOk = mfaNeeded
      ? Boolean(user.mfaSecret && parsed.data.totpToken && verifyTotpToken(parsed.data.totpToken, user.mfaSecret))
      : true;

    if (!passwordOk || !totpOk) {
      recordLoginFailure(passwordOk ? "mfa_missing_or_invalid" : "wrong_password");
      await registerLoginFailure(db, {
        email,
        ip,
        reason: "step_up_failed",
        config: bruteForce,
      });
      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "auth.step_up.rejected",
          aktion: "auth.step-up",
          entitaet: "benutzer",
          entitaetId: user.id,
          akteurBenutzerId: user.id,
          standortId: user.standortId,
          source: "apps/api:auth.step-up",
          correlationId: request.correlationId,
          payload: { scope: parsed.data.scope, grund: passwordOk ? "totp" : "passwort" },
        }),
      );
      return reply.code(401).send({
        error: "step_up_failed",
        hinweis: mfaNeeded
          ? "Passwort und gültiger TOTP-Code sind erforderlich."
          : "Passwort ist erforderlich.",
      });
    }

    const verifiedAt = await grantStepUp(db, {
      sessionToken,
      scope: parsed.data.scope as StepUpAction | "all",
    });
    await db.insert(auditEreignisse).values(
      buildEventRow({
        type: "auth.step_up.granted",
        aktion: "auth.step-up",
        entitaet: "benutzer",
        entitaetId: user.id,
        akteurBenutzerId: user.id,
        standortId: user.standortId,
        source: "apps/api:auth.step-up",
        correlationId: request.correlationId,
        payload: { scope: parsed.data.scope, gueltigBisMs: stepUpTtlMs() },
      }),
    );

    return reply.send({
      stepUp: {
        verifiedAt: verifiedAt.toISOString(),
        scope: parsed.data.scope,
        expiresAt: new Date(verifiedAt.getTime() + stepUpTtlMs()).toISOString(),
        ttlSeconds: Math.round(stepUpTtlMs() / 1000),
      },
    });
  });

  /** Zeigt, ob für die aktuelle Sitzung eine frische Wiederanmeldung vorliegt. */
  app.get("/auth/step-up", { preHandler: requireAuth }, async (request, reply) => {
    const state = await readStepUp(db, request);
    return reply.send({
      verifiedAt: state.verifiedAt?.toISOString() ?? null,
      scope: state.scope,
      ttlSeconds: Math.round(stepUpTtlMs() / 1000),
      aktionen: STEP_UP_ACTION_VALUES,
    });
  });

  /**
   * PROMPT -1 §17 – der Entsperrpfad des Brute-Force-Schutzes.
   *
   * Nur `users:manage` (Rolle systemdienst) UND mit Step-up: das Entsperren
   * ist selbst eine sicherheitsrelevante Aktion. Der Entsperrvorgang wird
   * auditiert.
   */
  app.post(
    "/auth/unlock",
    {
      preHandler: [
        requireAuth,
        requirePermission("users:manage"),
        requireStepUp(db, STEP_UP_ACTIONS.authUnlock),
      ],
    },
    async (request, reply) => {
      const parsed = unlockSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const result = await unlockThrottle(db, {
        scope: parsed.data.scope,
        key: parsed.data.key,
        akteurBenutzerId: request.user!.id,
        standortId: request.user!.standortId,
        correlationId: request.correlationId,
      });
      return reply.send(result);
    },
  );

  /** Betriebsansicht: aktuell gesperrte Konten/IPs (ohne Klartextschlüssel). */
  app.get(
    "/auth/locks",
    { preHandler: [requireAuth, requirePermission("users:manage")] },
    async (_request, reply) => {
      const rows = await listLockedThrottles(db);
      return reply.send({ sperren: rows });
    },
  );

  app.post("/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token) {
      const tokenHash = hashSessionToken(token);
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    clearCsrfCookie(reply);
    return reply.send({ ok: true });
  });

  /**
   * Remote-Logout ("Logout überall"): löscht ALLE Sessions des eingeloggten
   * Benutzers, nicht nur die aktuelle (siehe /auth/logout oben). Nötig für
   * "remote logout (session invalidation)" aus der Prompt-3-Testliste –
   * Prompt 0 hatte nur den Einzel-Session-Logout. Löscht auch die eigene,
   * gerade genutzte Session mit, das Cookie wird deshalb ebenfalls geleert.
   *
   * §17: damit endet auch jede Step-up-Freigabe sofort (sie hängt an der
   * Sitzungszeile) und jeder ausgegebene CSRF-Token wird ungültig (er ist an
   * den Sitzungstoken gebunden).
   */
  app.post("/auth/logout-all", { preHandler: requireAuth }, async (request, reply) => {
    const deleted = await db
      .delete(sessions)
      .where(eq(sessions.benutzerId, request.user!.id))
      .returning({ id: sessions.id });

    await db.insert(auditEreignisse).values(
      buildEventRow({
        type: "login",
        aktion: "logout_all",
        entitaet: "benutzer",
        entitaetId: request.user!.id,
        akteurBenutzerId: request.user!.id,
        standortId: request.user!.standortId,
        source: "apps/api:auth.logout-all",
        correlationId: request.correlationId,
        payload: { revokedSessions: deleted.length },
      }),
    );

    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    clearCsrfCookie(reply);
    return reply.send({ ok: true, revokedSessions: deleted.length });
  });

  app.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    return reply.send({ user: request.user });
  });
}

function clearCsrfCookie(reply: FastifyReply): void {
  reply.clearCookie("fahrschul_csrf", { path: "/" });
}
