import type { Database } from "@fahrschul/database";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { getFlagState } from "../services/flags.js";

const KNOWN_FLAGS = ["krebs_flex"] as const;

export function registerFlagRoutes(app: FastifyInstance, db: Database) {
  app.get("/flags", { preHandler: requireAuth }, async (request, reply) => {
    const entries = await Promise.all(
      KNOWN_FLAGS.map(async (key) => [key, await getFlagState(db, key, request.user!.standortId)] as const),
    );
    return reply.send({ flags: Object.fromEntries(entries) });
  });
}
