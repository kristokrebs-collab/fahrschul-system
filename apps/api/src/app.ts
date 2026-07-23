import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { getDb } from "./db.js";
import { createSessionLoader } from "./middleware/auth.js";
import { registerAppointmentRoutes } from "./routes/appointments.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";

export interface BuildAppOptions {
  databaseUrl: string;
  cookieSecure?: boolean;
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const db = getDb(options.databaseUrl);

  app.register(cookie);

  app.addHook("preHandler", createSessionLoader(db));

  registerHealthRoutes(app);
  registerAuthRoutes(app, db, options.cookieSecure ?? false);
  registerAppointmentRoutes(app, db);

  return app;
}
