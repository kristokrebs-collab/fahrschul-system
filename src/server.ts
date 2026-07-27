/**
 * HTTP-Server und Prozessstart.
 *
 * Reihenfolge beim Start ist bewusst gewaehlt:
 *   1. Migrationen anwenden (harter Abbruch bei Fehler)
 *   2. Prompts sicherstellen, Inhaberkonto anlegen falls noetig
 *   3. Statische Auslieferung + API
 *   4. Worker starten (nur wenn ENABLE_WORKERS gesetzt ist)
 *
 * Statische Dateien werden ohne zusaetzliche Abhaengigkeit ausgeliefert.
 * Der Pfad wird gegen das Web-Verzeichnis kanonisiert, damit `..` nicht aus
 * dem Verzeichnis herausfuehren kann.
 */
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, PROJECT_ROOT } from './config/env.js';
import { migrate, getDb, closeDb } from './db/index.js';
import { log, recordEvent } from './observability/logger.js';
import { bootstrapOwner, purgeExpiredSessions } from './security/auth.js';
import { ensureDefaultPrompts } from './agents/prompts.js';
import { registerApi } from './routes/api.js';
import { startScheduler, stopScheduler } from './workers/scheduler.js';

const WEB_ROOT = resolve(PROJECT_ROOT, 'web');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Keine Header loggen - dort steht das Sitzungscookie drin.
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(cookie, { secret: config.sessionSecret });

  // Globales Limit. Einzelne Routen verschaerfen es ueber
  // `config.rateLimit` (siehe /api/auth/login in routes/api.ts).
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    allowList: (req) => req.url === '/api/health',
  });

  await registerApi(app);

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    reply.header(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; " +
        "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; " +
        "font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    if (config.isProd) {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  // --- Statische Auslieferung der PWA --------------------------------
  app.get('/*', async (req, reply) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Unbekannter API-Endpunkt.' });
    }

    const relative = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(WEB_ROOT, relative);

    // Kanonisieren und pruefen, dass wir das Web-Verzeichnis nicht verlassen.
    const resolved = resolve(filePath);
    if (!resolved.startsWith(WEB_ROOT)) {
      return reply.code(403).send({ error: 'Zugriff verweigert.' });
    }

    try {
      const info = await stat(resolved);
      if (info.isDirectory()) filePath = join(resolved, 'index.html');
      else filePath = resolved;
    } catch {
      // Single-Page-App: unbekannte Pfade liefern die Shell.
      filePath = join(WEB_ROOT, 'index.html');
    }

    try {
      const content = await readFile(filePath);
      const ext = extname(filePath);
      reply.header('content-type', MIME[ext] ?? 'application/octet-stream');
      if (ext === '.html' || filePath.endsWith('sw.js')) {
        reply.header('cache-control', 'no-cache');
      } else {
        reply.header('cache-control', 'public, max-age=300');
      }
      return reply.send(content);
    } catch {
      return reply.code(404).send({ error: 'Nicht gefunden.' });
    }
  });

  return app;
}

async function main() {
  log.info('Starte Fahrschule Krebs Social Autopilot.', {
    env: config.nodeEnv,
    database: config.databasePath,
  });

  const migration = migrate();
  log.info('Migrationen geprueft.', {
    applied: migration.applied,
    alreadyApplied: migration.alreadyApplied.length,
  });

  ensureDefaultPrompts();
  const bootstrap = bootstrapOwner();
  if (bootstrap.created) log.warn(bootstrap.note);
  else log.info(bootstrap.note);

  purgeExpiredSessions();

  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });

  recordEvent({
    kind: 'system.started',
    actor: 'system',
    message: `Dienst gestartet auf ${config.host}:${config.port} (${config.nodeEnv}).`,
  });

  if (config.enableWorkers) {
    startScheduler();
    log.info('Hintergrundprozesse gestartet.');
  } else {
    log.warn('ENABLE_WORKERS=false - Warteschlange und Zeitplan laufen in diesem Prozess NICHT.');
  }

  const shutdown = async (signal: string) => {
    log.info(`${signal} empfangen, fahre herunter.`);
    stopScheduler();
    try {
      await app.close();
      recordEvent({ kind: 'system.stopped', actor: 'system', message: `Beendet nach ${signal}.` });
    } finally {
      closeDb();
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// Nur starten, wenn direkt ausgefuehrt - beim Import in Tests passiert nichts.
const invokedDirectly =
  !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    log.critical('Start fehlgeschlagen.', { error: (err as Error).message });
    process.stderr.write(`${(err as Error).stack}\n`);
    process.exit(1);
  });
}

export { getDb };
