import { SESSION_COOKIE_NAME } from "@fahrschul/auth";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { checkCsrf, isCsrfExempt, sendCsrfFailure } from "../lib/csrf.js";
import { metricRouteLabel, sendRateLimited, type RateLimiter } from "../lib/rate-limit.js";
import { recordHttpRequest } from "../lib/metrics.js";
import {
  CORRELATION_HEADER,
  REQUEST_ID_HEADER,
  log,
  newCorrelationId,
  normalizeCorrelationId,
} from "../lib/observability.js";
import { NO_STORE_HEADERS, securityHeaders, type SecurityHeaderOptions } from "../lib/security-headers.js";
import { enterCorrelation } from "../lib/correlation-context.js";

/**
 * PROMPT -1 §16/§17 – die Hook-Kette, die JEDE Anfrage durchläuft.
 *
 * ## Reihenfolge, und warum genau diese
 *
 * ```
 * onRequest   1. Korrelations-ID + Anfrage-ID setzen   (alles Folgende loggt damit)
 *             2. Sicherheitskopfzeilen setzen           (auch auf Fehlerantworten!)
 *             3. Rate Limiting je IP                  (billigste Abwehr zuerst)
 * preHandler  4. Sitzung laden (bestehender Hook, in buildApp registriert)
 *             5. Rate Limiting je KONTO                 (braucht die Sitzung)
 *             6. CSRF prüfen                            (braucht die Sitzung)
 * onSend      7. no-store für alles außer /health und /metrics
 * onResponse  8. Strukturierte Zugriffszeile + Kennzahlen
 * ```
 *
 * Zwei Details, die leicht falsch gemacht werden:
 *
 *  - **Kopfzeilen im `onRequest`, nicht im `onSend`.** Eine 429- oder
 *    401-Antwort ist auch eine Antwort und braucht CSP und `nosniff`. Im
 *    `onSend` würde eine früh abgebrochene Anfrage sie verlieren.
 *  - **Rate Limiting in ZWEI Hooks, aber je Dimension nur EINMAL.**
 *    `checkIp` läuft im `onRequest`, damit ein Angriffsversuch nicht erst eine
 *    Datenbankabfrage für die Sitzung kostet. `checkAccount` kann erst im
 *    `preHandler` laufen, weil `request.user` vorher nicht existiert, und ist
 *    ohne Sitzung ein No-op. Kein Eimer wird doppelt belastet.
 */

export interface SecurityPluginOptions {
  rateLimiter: RateLimiter | null;
  csrfSecret: string;
  allowedOrigins: readonly string[];
  cspConnectSrc: readonly string[];
  https: boolean;
  cspReportOnly?: boolean;
  /** Zugriffsprotokoll ausschalten (Tests, die Ausgabe prüfen). */
  accessLog?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    /** §17: welcher CSRF-Beweis die Anfrage getragen hat. */
    csrfProof?: import("../lib/csrf.js").CsrfProof | null;
    /** §16: überlebt Client -> API -> Worker -> Outbox -> Realtime. */
    correlationId: string;
    /** §16: eindeutig je Anfrage. */
    requestId: string;
    /** Startzeit für die Latenzkennzahl. */
    startedAtMs: number;
  }
}

const HEALTH_PATHS = new Set(["/health", "/health/deep", "/metrics"]);

export function registerSecurity(app: FastifyInstance, options: SecurityPluginOptions): void {
  const headerOptions: SecurityHeaderOptions = {
    connectSrc: options.cspConnectSrc,
    https: options.https,
    reportOnly: options.cspReportOnly,
  };
  const headers = securityHeaders(headerOptions);

  app.decorateRequest("correlationId", "");
  app.decorateRequest("requestId", "");
  app.decorateRequest("startedAtMs", 0);

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    request.startedAtMs = Date.now();
    request.requestId = randomUUID();
    // §16 Tracing: eine mitgelieferte, GÜLTIGE Korrelations-ID wird
    // übernommen, damit ein clientseitig begonnener Vorgang durchgehend
    // verfolgbar ist. Ungültige Werte werden verworfen, nicht übernommen
    // (Log-Injection und ein DB-Typfehler wären die Folge).
    request.correlationId =
      normalizeCorrelationId(request.headers[CORRELATION_HEADER]) ?? newCorrelationId();

    // §16: ab hier gilt die ID AMBIENT – jedes `buildEventRow` innerhalb dieser
    // Anfrage übernimmt sie, ohne dass eine Route sie durchreichen muss
    // (siehe lib/correlation-context.ts).
    enterCorrelation({ correlationId: request.correlationId, requestId: request.requestId });

    reply.header(REQUEST_ID_HEADER, request.requestId);
    reply.header(CORRELATION_HEADER, request.correlationId);
    for (const [name, value] of Object.entries(headers)) reply.header(name, value);

    if (options.rateLimiter) {
      const decision = options.rateLimiter.checkIp(request);
      if (!decision.allowed) {
        log({
          severity: "warn",
          requestId: request.requestId,
          correlationId: request.correlationId,
          operation: `${request.method} ${metricRouteLabel(request.url)}`,
          errorCode: "RATE_LIMITED",
          message: "Anfrage wegen Ratenbegrenzung abgewiesen",
          details: { policy: decision.policy, scope: decision.scope },
        });
        return sendRateLimited(reply, decision);
      }
    }
  });

  // CSRF und Konto-Limit nach dem Sitzungs-Loader (der wird in buildApp VOR
  // diesem Hook registriert – Fastify führt preHandler in
  // Registrierungsreihenfolge aus).
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (options.rateLimiter) {
      const decision = options.rateLimiter.checkAccount(request);
      if (!decision.allowed) {
        log({
          severity: "warn",
          requestId: request.requestId,
          correlationId: request.correlationId,
          actorBenutzerId: request.user?.id ?? null,
          actorRole: request.user?.rolle,
          operation: `${request.method} ${metricRouteLabel(request.url)}`,
          errorCode: "RATE_LIMITED",
          message: "Anfrage wegen kontobezogener Ratenbegrenzung abgewiesen",
          details: { policy: decision.policy, scope: decision.scope },
        });
        return sendRateLimited(reply, decision);
      }
    }

    if (isCsrfExempt(request.method, request.url)) return;
    const result = checkCsrf(request, {
      secret: options.csrfSecret,
      allowedOrigins: options.allowedOrigins,
      sessionToken: request.cookies[SESSION_COOKIE_NAME] ?? null,
    });
    request.csrfProof = result.proof ?? null;
    if (!result.ok) {
      log({
        severity: "warn",
        requestId: request.requestId,
        correlationId: request.correlationId,
        actorBenutzerId: request.user?.id ?? null,
        actorRole: request.user?.rolle,
        operation: `${request.method} ${metricRouteLabel(request.url)}`,
        errorCode: "CSRF_FAILED",
        message: `CSRF-Prüfung fehlgeschlagen (${result.reason})`,
        details: { origin: result.origin },
      });
      return sendCsrfFailure(reply, result);
    }
  });

  app.addHook("onSend", async (request: FastifyRequest, reply: FastifyReply, payload) => {
    const path = request.url.split("?")[0];
    if (!HEALTH_PATHS.has(path)) {
      for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
        if (!reply.getHeader(name)) reply.header(name, value);
      }
    }
    return payload;
  });

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const durationMs = Date.now() - (request.startedAtMs || Date.now());
    const route = metricRouteLabel(request.url);
    recordHttpRequest({
      method: request.method,
      route,
      status: reply.statusCode,
      durationMs,
    });
    if (options.accessLog === false) return;
    log({
      severity: reply.statusCode >= 500 ? "error" : reply.statusCode >= 400 ? "warn" : "info",
      requestId: request.requestId,
      correlationId: request.correlationId,
      actorBenutzerId: request.user?.id ?? null,
      actorRole: request.user?.rolle,
      operation: `${request.method} ${route}`,
      httpStatus: reply.statusCode,
      durationMs,
      standortId: request.user?.standortId ?? null,
      // §17: welcher CSRF-Beweis die Anfrage getragen hat. "kein_browsersignal"
      // ist der dokumentierte Nicht-Browser-Pfad und im Protokoll sichtbar,
      // damit er nicht unbemerkt zur Regel wird.
      details: request.csrfProof ? { csrfProof: request.csrfProof } : undefined,
    });
  });
}
