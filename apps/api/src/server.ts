import { buildApp } from "./app.js";
import { env } from "./env.js";
import { deploymentIdentity } from "./lib/deployment.js";
import { log, newCorrelationId } from "./lib/observability.js";
import { workersEnabledFromEnv } from "./workers/scheduler.js";

/**
 * PROMPT -1 §15 (Phase 4) – der HTTP-Einstiegspunkt.
 *
 * Zwei Ergänzungen gegenüber Phase 1–3:
 *
 *  1. **Die Deployment-Identität wird beim Start protokolliert.** Ohne diese
 *     eine Zeile ist nach einem Rollout nicht belegbar, welche Fassung
 *     tatsächlich hochgekommen ist – die ID an den Anfragezeilen hilft nur,
 *     wenn schon Verkehr floss.
 *  2. **Der Scheduler wird nicht mehr stillschweigend übergangen.** Vorher
 *     setzte diese Datei `startWorkers` gar nicht, wodurch in einem echten
 *     Serverprozess KEIN wiederkehrender Job lief (siehe
 *     `workers/scheduler.ts`). Jetzt entscheidet `RUN_WORKERS`, und der
 *     gewählte Zustand steht in der Startzeile und in `GET /ops/scheduler`.
 */

const identity = deploymentIdentity();
const app = buildApp({
  databaseUrl: env.databaseUrl(),
  cookieSecure: env.cookieSecure,
  logger: true,
});

app
  .listen({ port: env.port, host: "0.0.0.0" })
  .then(() => {
    log({
      requestId: "server-boot",
      correlationId: newCorrelationId(),
      operation: "server.start",
      message: `@fahrschul/api läuft auf Port ${env.port}`,
      details: {
        port: env.port,
        releaseChannel: identity.releaseChannel,
        version: identity.version,
        gitCommit: identity.gitCommit,
        // Wenn das hier `false` ist, MUSS ein getrennter Worker-Prozess laufen
        // (pnpm --filter @fahrschul/api worker) – sonst wird nichts zugestellt.
        workersInDiesemProzess: workersEnabledFromEnv(),
      },
    });
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
