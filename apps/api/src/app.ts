import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import {
  createAiSuggestionAdapter,
  createBankFeedAdapter,
  createDocumentStorageAdapter,
  createMalwareScanAdapter,
  createNotificationsAdapter,
  createPaymentAdapter,
  createTranscriptionAdapter,
} from "@fahrschul/integrations";
import Fastify, { type FastifyInstance } from "fastify";
import { getDb } from "./db.js";
import { createSessionLoader } from "./middleware/auth.js";
import { registerSecurity } from "./middleware/security.js";
import { startWorkerLoop } from "./workers/runner.js";
import { configureAlarmSinksFromEnv } from "./workers/alarm.js";
import { bruteForceConfigFromEnv, type BruteForceConfig } from "./lib/brute-force.js";
import {
  createRateLimiter,
  rateLimitConfigFromEnv,
  type RateLimitConfig,
} from "./lib/rate-limit.js";
import { setActorPseudonymSalt } from "./lib/observability.js";
import { installCorrelationProvider } from "./lib/correlation-context.js";
import type { IntegrationServiceOptions } from "./services/integrations.js";
import { registerAppointmentRoutes } from "./routes/appointments.js";
import { registerAppointmentOfferRoutes } from "./routes/appointment-offers.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAvailabilityRoutes } from "./routes/availability.js";
import { registerCommunicationRoutes } from "./routes/communication.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerExamRoutes } from "./routes/exam.js";
import { registerExamPipelineRoutes } from "./routes/exam-pipeline.js";
import { registerFinanceRoutes } from "./routes/finance.js";
import { registerFeedbackRoutes } from "./routes/feedback.js";
import { registerFlagRoutes } from "./routes/flags.js";
import { registerFlexRoutes } from "./routes/flex.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerInstructorRoutes } from "./routes/instructor.js";
import { registerInvoiceRoutes } from "./routes/invoices.js";
import { registerLeadRoutes } from "./routes/leads.js";
import { registerLearningRoutes } from "./routes/learning.js";
import { registerObservabilityRoutes } from "./routes/observability.js";
import { registerOfficeDashboardRoutes } from "./routes/office-dashboard.js";
import { registerOpsRoutes } from "./routes/ops.js";
import { registerResourceRoutes } from "./routes/resources.js";
import { registerStornoRoutes } from "./routes/storno.js";
import { registerStudentRoutes } from "./routes/student.js";
import { registerSyncRoutes, type RealtimeOptions } from "./routes/sync.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerUploadRoutes } from "./routes/uploads.js";

export interface BuildAppOptions {
  databaseUrl: string;
  /**
   * PROMPT -1 §13: Startet die Worker-Schleife im HTTP-Prozess. Standardmäßig
   * AUS – in Tests und bei Betrieb mit separatem Worker-Prozess unerwünscht.
   * Die Verdrahtung eines Schedulers ist §15 (Phase 4).
   */
  startWorkers?: boolean;
  workerIntervalMs?: number;
  cookieSecure?: boolean;
  logger?: boolean;
  /** Erlaubte Browser-Origins für die App-Frontends (Vite-Dev-Server/Prod-Hosts). */
  corsOrigins?: string[];
  /**
   * PROMPT -1 §6 (Phase 2): Intervalle des SSE-Kanals. Bewusst NICHT vom
   * Client steuerbar (das wäre ein Lasthebel) – nur vom Betreiber und von
   * Tests, die deterministisch schnell laufen müssen.
   */
  realtime?: RealtimeOptions;
  /**
   * PROMPT -1 §17 (Phase 3): Ratenbegrenzung.
   *
   * `false` schaltet sie vollständig ab, ein Teilobjekt überschreibt einzelne
   * Politiken. Warum konfigurierbar statt hartkodiert? Weil zwei ausdrücklich
   * legitime Lastspitzen existieren, die überleben MÜSSEN: Chaos-Szenario 2
   * ("dieselbe Anfrage zehnmal", der Idempotenzbeweis) und Szenario 3 ("zwei
   * Schüler nehmen gleichzeitig denselben Slot"). Ein hartkodiertes Limit
   * würde diese Tests zu einem Ratenlimit-Test verfälschen.
   */
  rateLimit?: false | Partial<RateLimitConfig>;
  /** §17: Abweichende Brute-Force-Parameter (Tests brauchen kleine Schwellen). */
  bruteForce?: Partial<BruteForceConfig>;
  /**
   * §17: Signaturschlüssel für CSRF-Token und kurzlebige Dokument-URLs.
   * Standard ist `SESSION_SECRET`.
   */
  signingSecret?: string;
  /** §17: CSP nur berichten statt blocken (Einführungsphase). */
  cspReportOnly?: boolean;
  /** §17: Läuft hinter HTTPS? Aktiviert HSTS + upgrade-insecure-requests. */
  https?: boolean;
  /** §16: Zugriffsprotokoll abschalten (Tests, die stdout prüfen). */
  accessLog?: boolean;
  /** §16: Token für `GET /metrics`. */
  metricsToken?: string | null;
  /** §11: Breaker-/Zeitlimitparameter (Tests brauchen kleine Werte). */
  integrations?: Pick<IntegrationServiceOptions, "breaker" | "timeouts" | "now" | "sleep">;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const db = getDb(options.databaseUrl);

  const corsOrigins = options.corsOrigins ?? [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "http://localhost:5176",
    "http://127.0.0.1:5176",
  ];
  const signingSecret =
    options.signingSecret ?? process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me";
  setActorPseudonymSalt(signingSecret);
  // §16: `buildEventRow` übernimmt ab jetzt die Korrelations-ID des laufenden
  // Vorgangs, statt eine eigene zu erzeugen.
  installCorrelationProvider();

  app.register(cookie);
  // credentials:true ist nötig, weil apps/student httpOnly-Session-Cookies
  // nutzt (kein Bearer-Token im JS-Zugriff) – der Origin muss deshalb
  // explizit gelistet sein statt "*" (sonst verbieten Browser Cookies).
  // §17: dieselbe Liste ist auch die Allowlist der CSRF-Origin-Prüfung und die
  // `connect-src`-Quelle der CSP – es gibt genau EINE Wahrheit dafür.
  app.register(cors, {
    origin: corsOrigins,
    credentials: true,
    // §17: der CSRF-Header muss im Preflight erlaubt sein, sonst kann ein
    // Browser ihn nicht senden.
    allowedHeaders: [
      "content-type",
      "idempotency-key",
      "if-match",
      "last-event-id",
      "x-csrf-token",
      "x-correlation-id",
    ],
    exposedHeaders: [
      "etag",
      "last-modified",
      "retry-after",
      "x-request-id",
      "x-correlation-id",
      "x-ratelimit-policy",
      "x-ratelimit-remaining",
      "x-ratelimit-scope",
    ],
  });
  app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  // §12: Rohbytes für die Teilstücke der wiederaufnehmbaren Uploads. Ohne
  // diesen Parser würde Fastify `application/octet-stream` mit 415 abweisen.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );

  // -----------------------------------------------------------------------
  // PROMPT -1 §16/§17 (Phase 3) – die Hook-Kette. MUSS vor den Routen
  // registriert werden, damit sie für alle gilt (auch für Fehlerantworten).
  // -----------------------------------------------------------------------
  const rateLimitBase = rateLimitConfigFromEnv();
  const rateLimitConfig: RateLimitConfig =
    options.rateLimit === false
      ? { ...rateLimitBase, enabled: false }
      : {
          ...rateLimitBase,
          ...(options.rateLimit ?? {}),
          policies: { ...rateLimitBase.policies, ...(options.rateLimit?.policies ?? {}) },
        };
  const rateLimiter = rateLimitConfig.enabled ? createRateLimiter(rateLimitConfig) : null;

  const bruteForce: BruteForceConfig = { ...bruteForceConfigFromEnv(), ...(options.bruteForce ?? {}) };

  // §16: der echte Alarmkanal wird registriert, WENN er konfiguriert ist.
  configureAlarmSinksFromEnv();

  // Die Sitzung muss VOR CSRF und Konto-Ratenlimit geladen sein.
  app.addHook("preHandler", createSessionLoader(db));

  registerSecurity(app, {
    rateLimiter,
    csrfSecret: signingSecret,
    allowedOrigins: corsOrigins,
    cspConnectSrc: corsOrigins,
    https: options.https ?? options.cookieSecure ?? false,
    cspReportOnly: options.cspReportOnly,
    accessLog: options.accessLog,
  });

  // Alle externen Integrationen laufen in dieser Umgebung ausschließlich im
  // mock-Modus (siehe docs/integration-gaps.md) – assertMockOnly wirft für
  // sandbox/live bewusst einen Fehler statt eine nicht getestete
  // "Live-Schnittstelle" zu behaupten. §11 legt Zeitlimit, Circuit Breaker,
  // Retry, Idempotenzschlüssel und Fehlerwarteschlange darum.
  const storage = createDocumentStorageAdapter("mock");
  const malwareScan = createMalwareScanAdapter("mock");
  const payments = createPaymentAdapter("mock");
  const notifications = createNotificationsAdapter("mock");
  const transcription = createTranscriptionAdapter("mock");
  const aiSuggestions = createAiSuggestionAdapter("mock");
  const bankFeed = createBankFeedAdapter("mock");

  const resilience: IntegrationServiceOptions = { db, ...(options.integrations ?? {}) };

  registerHealthRoutes(app);
  registerObservabilityRoutes(app, db, { metricsToken: options.metricsToken });
  registerAuthRoutes(app, db, {
    cookieSecure: options.cookieSecure ?? false,
    csrfSecret: signingSecret,
    bruteForce,
  });
  registerAppointmentRoutes(app, db);
  registerAvailabilityRoutes(app, db);
  registerAppointmentOfferRoutes(app, db);
  registerStudentRoutes(app, db);
  // PROMPT -1 §17 (Phase 3): Rollen-/Kontostatusverwaltung mit Step-up.
  registerUserRoutes(app, db);
  registerExamRoutes(app, db);
  registerDocumentRoutes(app, db, { storage, malwareScan, signingSecret, resilience });
  registerUploadRoutes(app, db, { storage, malwareScan });
  registerFeedbackRoutes(app, db);
  registerInvoiceRoutes(app, db, { payments });
  registerLearningRoutes(app, db);
  registerFlagRoutes(app, db);
  registerFlexRoutes(app, db);
  // Prompt 2 (apps/office) – Büro-Zentrale-Routen.
  registerOfficeDashboardRoutes(app, db);
  registerResourceRoutes(app, db);
  registerLeadRoutes(app, db);
  registerCommunicationRoutes(app, db, { notifications, resilience });
  registerExamPipelineRoutes(app, db);
  registerStornoRoutes(app, db);
  registerFinanceRoutes(app, db, { bankFeed, resilience });
  // Prompt 3 (apps/instructor) – Fahrlehrer-App-Routen.
  registerInstructorRoutes(app, db, { transcription, aiSuggestions });
  // PROMPT -1 (Phase 1) – Zuverlässigkeitskern: Outbox, Job-Store,
  // Dead-Letter-Queue, Konsistenzprüfung. Phase 3 ergänzt hier
  // Integrationszustand, Fehlerwarteschlange und Audit-Kettenprüfung.
  registerOpsRoutes(app, db, { notifications, storage, malwareScan, bankFeed, resilience });
  // PROMPT -1 (Phase 2) – Echtzeit-Synchronisation: SSE-Kanal,
  // Polling-Fallback, Cursor und Auflösung offener Vorgänge nach Neustart.
  registerSyncRoutes(app, db, options.realtime);

  if (options.startWorkers) {
    const loop = startWorkerLoop(
      { db, notifications, storage, malwareScan, bankFeed },
      options.workerIntervalMs ?? 5000,
    );
    app.addHook("onClose", async () => loop.stop());
  }

  return app;
}
