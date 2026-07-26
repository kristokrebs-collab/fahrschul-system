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
import { startWorkerLoop } from "./workers/runner.js";
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
import { registerOfficeDashboardRoutes } from "./routes/office-dashboard.js";
import { registerOpsRoutes } from "./routes/ops.js";
import { registerResourceRoutes } from "./routes/resources.js";
import { registerStornoRoutes } from "./routes/storno.js";
import { registerStudentRoutes } from "./routes/student.js";
import { registerSyncRoutes, type RealtimeOptions } from "./routes/sync.js";

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
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const db = getDb(options.databaseUrl);

  app.register(cookie);
  // credentials:true ist nötig, weil apps/student httpOnly-Session-Cookies
  // nutzt (kein Bearer-Token im JS-Zugriff) – der Origin muss deshalb
  // explizit gelistet sein statt "*" (sonst verbieten Browser Cookies).
  app.register(cors, {
    origin: options.corsOrigins ?? [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ],
    credentials: true,
  });
  app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  app.addHook("preHandler", createSessionLoader(db));

  // Alle externen Integrationen laufen in dieser Umgebung ausschließlich im
  // mock-Modus (siehe docs/integration-gaps.md) – assertMockOnly wirft für
  // sandbox/live bewusst einen Fehler statt eine nicht getestete
  // "Live-Schnittstelle" zu behaupten.
  const storage = createDocumentStorageAdapter("mock");
  const malwareScan = createMalwareScanAdapter("mock");
  const payments = createPaymentAdapter("mock");
  const notifications = createNotificationsAdapter("mock");
  const transcription = createTranscriptionAdapter("mock");
  const aiSuggestions = createAiSuggestionAdapter("mock");
  const bankFeed = createBankFeedAdapter("mock");

  registerHealthRoutes(app);
  registerAuthRoutes(app, db, options.cookieSecure ?? false);
  registerAppointmentRoutes(app, db);
  registerAvailabilityRoutes(app, db);
  registerAppointmentOfferRoutes(app, db);
  registerStudentRoutes(app, db);
  registerExamRoutes(app, db);
  registerDocumentRoutes(app, db, { storage, malwareScan });
  registerFeedbackRoutes(app, db);
  registerInvoiceRoutes(app, db, { payments });
  registerLearningRoutes(app, db);
  registerFlagRoutes(app, db);
  registerFlexRoutes(app, db);
  // Prompt 2 (apps/office) – Büro-Zentrale-Routen.
  registerOfficeDashboardRoutes(app, db);
  registerResourceRoutes(app, db);
  registerLeadRoutes(app, db);
  registerCommunicationRoutes(app, db, { notifications });
  registerExamPipelineRoutes(app, db);
  registerStornoRoutes(app, db);
  registerFinanceRoutes(app, db, { bankFeed });
  // Prompt 3 (apps/instructor) – Fahrlehrer-App-Routen.
  registerInstructorRoutes(app, db, { transcription, aiSuggestions });
  // PROMPT -1 (Phase 1) – Zuverlässigkeitskern: Outbox, Job-Store,
  // Dead-Letter-Queue, Konsistenzprüfung.
  registerOpsRoutes(app, db, { notifications });
  // PROMPT -1 (Phase 2) – Echtzeit-Synchronisation: SSE-Kanal,
  // Polling-Fallback, Cursor und Auflösung offener Vorgänge nach Neustart.
  registerSyncRoutes(app, db, options.realtime);

  if (options.startWorkers) {
    const loop = startWorkerLoop({ db, notifications }, options.workerIntervalMs ?? 5000);
    app.addHook("onClose", async () => loop.stop());
  }

  return app;
}
