import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, join, isAbsolute } from 'node:path'
import { z } from 'zod'

/**
 * Configuration comes from the environment only. Nothing secret is ever written
 * to the repo, a log line, or the client bundle — `redactedConfig()` is what the
 * status endpoint is allowed to see.
 */

function loadDotEnv(file: string) {
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

const ROOT = resolve(process.env.JARVIS_ROOT ?? process.cwd())
loadDotEnv(join(ROOT, '.env'))

/** Parses the strings people actually write in a .env file. */
const envBool = z.preprocess((v) => {
  if (typeof v !== 'string') return v
  const s = v.trim().toLowerCase()
  if (['1', 'true', 'yes', 'ja', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'nein', 'off', ''].includes(s)) return false
  return v
}, z.boolean())

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JARVIS_HOST: z.string().default('127.0.0.1'),
  JARVIS_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  JARVIS_DATA_DIR: z.string().default('./data'),

  /** 32-byte hex or base64 key for AES-256-GCM envelope encryption of secrets. */
  JARVIS_MASTER_KEY: z.string().optional(),
  /** Cookie signing secret. Auto-generated and persisted on first run if unset. */
  JARVIS_SESSION_SECRET: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().optional(),
  JARVIS_MODEL: z.string().default('claude-opus-5'),
  JARVIS_MODEL_FAST: z.string().default('claude-haiku-4-5'),

  /** none | local-lexical | voyage | openai | ollama */
  JARVIS_EMBEDDINGS: z.string().default('local-lexical'),
  VOYAGE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default('http://127.0.0.1:11434'),
  JARVIS_EMBED_MODEL: z.string().optional(),

  /** Read-only adapter endpoints for the two sibling systems. */
  SOCIAL_AUTOPILOT_URL: z.string().optional(),
  SOCIAL_AUTOPILOT_TOKEN: z.string().optional(),
  FINANCE_CRYPTO_URL: z.string().optional(),
  FINANCE_CRYPTO_TOKEN: z.string().optional(),

  /**
   * Hard kill switch: blocks every outbound network call.
   *
   * NOT `z.coerce.boolean()` — that runs JS `Boolean("false")`, which is `true`,
   * so the env value `false` would silently enable offline mode.
   */
  JARVIS_OFFLINE: envBool.default(false),
  /** Comma-separated absolute paths JARVIS may read for ingestion. */
  JARVIS_SOURCE_ROOTS: z.string().default('./sources'),
  JARVIS_LOG_LEVEL: z.string().default('info'),
})

const env = Env.parse(process.env)

const dataDir = isAbsolute(env.JARVIS_DATA_DIR) ? env.JARVIS_DATA_DIR : join(ROOT, env.JARVIS_DATA_DIR)
mkdirSync(dataDir, { recursive: true })
mkdirSync(join(dataDir, 'backups'), { recursive: true })
mkdirSync(join(dataDir, 'uploads'), { recursive: true })

const sourceRoots = env.JARVIS_SOURCE_ROOTS.split(',')
  .map((p) => p.trim()).filter(Boolean)
  .map((p) => (isAbsolute(p) ? p : join(ROOT, p)))
for (const r of sourceRoots) mkdirSync(r, { recursive: true })

export const config = {
  env: env.NODE_ENV,
  root: ROOT,
  host: env.JARVIS_HOST,
  port: env.JARVIS_PORT,
  dataDir,
  dbPath: process.env.JARVIS_DB_PATH ?? join(dataDir, 'jarvis.db'),
  backupDir: join(dataDir, 'backups'),
  uploadDir: join(dataDir, 'uploads'),
  sourceRoots,
  masterKey: env.JARVIS_MASTER_KEY ?? null,
  sessionSecret: env.JARVIS_SESSION_SECRET ?? null,
  offline: env.JARVIS_OFFLINE,
  logLevel: env.JARVIS_LOG_LEVEL,
  llm: {
    apiKey: env.ANTHROPIC_API_KEY ?? null,
    baseUrl: env.ANTHROPIC_BASE_URL ?? null,
    model: env.JARVIS_MODEL,
    fastModel: env.JARVIS_MODEL_FAST,
  },
  embeddings: {
    provider: env.JARVIS_EMBEDDINGS,
    model: env.JARVIS_EMBED_MODEL ?? null,
    voyageKey: env.VOYAGE_API_KEY ?? null,
    openaiKey: env.OPENAI_API_KEY ?? null,
    ollamaUrl: env.OLLAMA_BASE_URL,
  },
  adapters: {
    social: { url: env.SOCIAL_AUTOPILOT_URL ?? null, token: env.SOCIAL_AUTOPILOT_TOKEN ?? null },
    finance: { url: env.FINANCE_CRYPTO_URL ?? null, token: env.FINANCE_CRYPTO_TOKEN ?? null },
  },
  version: '1.0.0',
} as const

export type Config = typeof config

/** Safe to serialise to the client / logs: booleans only, never key material. */
export function redactedConfig() {
  return {
    env: config.env,
    version: config.version,
    offline: config.offline,
    llm: { configured: !!config.llm.apiKey, model: config.llm.model, fast_model: config.llm.fastModel },
    embeddings: { provider: config.embeddings.provider },
    adapters: {
      social_autopilot: !!config.adapters.social.url,
      finance_crypto: !!config.adapters.finance.url,
    },
    master_key_set: !!config.masterKey,
    source_roots: config.sourceRoots.length,
  }
}
