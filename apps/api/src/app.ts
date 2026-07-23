import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import {
  createDocumentStorageAdapter,
  createMalwareScanAdapter,
  createPaymentAdapter,
} from "@fahrschul/integrations";
import Fastify, { type FastifyInstance } from "fastify";
import { getDb } from "./db.js";
import { createSessionLoader } from "./middleware/auth.js";
import { registerAppointmentRoutes } from "./routes/appointments.js";
import { registerAppointmentOfferRoutes } from "./routes/appointment-offers.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerExamRoutes } from "./routes/exam.js";
import { registerFeedbackRoutes } from "./routes/feedback.js";
import { registerFlagRoutes } from "./routes/flags.js";
import { registerFlexRoutes } from "./routes/flex.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerInvoiceRoutes } from "./routes/invoices.js";
import { registerLearningRoutes } from "./routes/learning.js";
import { registerStudentRoutes } from "./routes/student.js";

export interface BuildAppOptions {
  databaseUrl: string;
  cookieSecure?: boolean;
  logger?: boolean;
  /** Erlaubte Browser-Origins für die App-Frontends (Vite-Dev-Server/Prod-Hosts). */
  corsOrigins?: string[];
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

  registerHealthRoutes(app);
  registerAuthRoutes(app, db, options.cookieSecure ?? false);
  registerAppointmentRoutes(app, db);
  registerAppointmentOfferRoutes(app, db);
  registerStudentRoutes(app, db);
  registerExamRoutes(app, db);
  registerDocumentRoutes(app, db, { storage, malwareScan });
  registerFeedbackRoutes(app, db);
  registerInvoiceRoutes(app, db, { payments });
  registerLearningRoutes(app, db);
  registerFlagRoutes(app, db);
  registerFlexRoutes(app, db);

  return app;
}
