/**
 * Zentrale Konfiguration.
 *
 * Grundsaetze:
 *  - Secrets werden ausschliesslich hier aus der Prozessumgebung gelesen.
 *  - Es gibt keinen Codepfad, der ein Secret an das Frontend, in Logs oder in
 *    eine API-Antwort schreibt. `publicConfig()` ist die einzige Funktion, die
 *    Konfiguration nach aussen gibt, und sie ist eine Allowlist.
 *  - Fehlende Pflichtwerte fuehren zu einem lauten Start-Fehler, nicht zu einem
 *    stillen Default.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(here, '..', '..');

/** Minimaler .env-Parser (keine Dependency, keine Shell-Expansion). */
function loadDotEnv(): void {
  const path = resolve(PROJECT_ROOT, '.env');
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

function str(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(
      `Konfigurationsfehler: Umgebungsvariable ${key} fehlt. Siehe .env.example.`,
    );
  }
  return v;
}

function optional(key: string): string | null {
  const v = process.env[key];
  return v === undefined || v === '' ? null : v;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Konfigurationsfehler: ${key} ist keine ganze Zahl.`);
  }
  return n;
}

const nodeEnv = str('NODE_ENV', 'development');
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

/**
 * In Produktion sind ENCRYPTION_KEY und SESSION_SECRET Pflicht.
 * In Entwicklung/Test wird ein deterministischer, klar als unsicher
 * gekennzeichneter Wert verwendet, damit `npm test` ohne Setup laeuft.
 */
function requiredSecret(key: string, devFallback: string): string {
  const v = optional(key);
  if (v) {
    if (!/^[0-9a-fA-F]{64}$/.test(v)) {
      throw new Error(
        `Konfigurationsfehler: ${key} muss 32 Byte hex sein (64 Zeichen). ` +
          `Erzeugen mit: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      );
    }
    return v;
  }
  if (isProd) {
    throw new Error(
      `Konfigurationsfehler: ${key} ist in NODE_ENV=production zwingend erforderlich.`,
    );
  }
  return devFallback;
}

export const config = {
  nodeEnv,
  isProd,
  isTest,
  port: int('PORT', 8080),
  host: str('HOST', '0.0.0.0'),
  publicBaseUrl: str('PUBLIC_BASE_URL', 'http://localhost:8080'),
  databasePath: resolve(PROJECT_ROOT, str('DATABASE_PATH', './data/autopilot.db')),
  backupDir: resolve(PROJECT_ROOT, str('BACKUP_DIR', './data/backups')),
  logLevel: str('LOG_LEVEL', 'info'),
  enableWorkers: bool('ENABLE_WORKERS', true),
  cookieSecure: bool('COOKIE_SECURE', isProd),
  inboxRetentionDays: int('INBOX_RETENTION_DAYS', 180),

  encryptionKey: requiredSecret(
    'ENCRYPTION_KEY',
    'dev0000000000000000000000000000000000000000000000000000000000dev',
  ),
  sessionSecret: requiredSecret(
    'SESSION_SECRET',
    'dev1111111111111111111111111111111111111111111111111111111111dev',
  ),

  bootstrapOwnerEmail: optional('BOOTSTRAP_OWNER_EMAIL'),
  bootstrapOwnerPassword: optional('BOOTSTRAP_OWNER_PASSWORD'),

  meta: {
    graphVersion: str('META_GRAPH_VERSION', 'v21.0'),
    accessToken: optional('META_ACCESS_TOKEN'),
    igBusinessAccountId: optional('INSTAGRAM_BUSINESS_ACCOUNT_ID'),
    facebookPageId: optional('FACEBOOK_PAGE_ID'),
  },
  tiktok: {
    accessToken: optional('TIKTOK_ACCESS_TOKEN'),
    openId: optional('TIKTOK_OPEN_ID'),
  },
  youtube: {
    accessToken: optional('YOUTUBE_ACCESS_TOKEN'),
    channelId: optional('YOUTUBE_CHANNEL_ID'),
  },
  higgsfield: {
    apiKey: optional('HIGGSFIELD_API_KEY'),
    apiBase: str('HIGGSFIELD_API_BASE', 'https://api.higgsfield.ai'),
  },
} as const;

/**
 * Einzige Konfiguration, die das Frontend erhaelt. Bewusst eine Allowlist:
 * neue Felder muessen hier explizit ergaenzt werden, ein versehentliches
 * Durchreichen von Secrets ist damit ausgeschlossen.
 */
export function publicConfig() {
  return {
    appName: 'Fahrschule Krebs Social Autopilot',
    environment: config.nodeEnv,
    baseUrl: config.publicBaseUrl,
    version: '1.0.0',
  };
}

/** Namen der Secret-Umgebungsvariablen - fuer Redaction in Logs. */
export const SECRET_ENV_KEYS = [
  'ENCRYPTION_KEY',
  'SESSION_SECRET',
  'BOOTSTRAP_OWNER_PASSWORD',
  'META_ACCESS_TOKEN',
  'TIKTOK_ACCESS_TOKEN',
  'YOUTUBE_ACCESS_TOKEN',
  'HIGGSFIELD_API_KEY',
] as const;
