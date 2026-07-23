import { buildApp } from "./app.js";
import { env } from "./env.js";

const app = buildApp({
  databaseUrl: env.databaseUrl(),
  cookieSecure: env.cookieSecure,
  logger: true,
});

app
  .listen({ port: env.port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`@fahrschul/api läuft auf Port ${env.port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
