import Anthropic from '@anthropic-ai/sdk'
import type { DB } from '../db/index.js'
import { config } from '../config.js'
import { encryptSecret, decryptSecret, hasMasterKey } from '../core/crypto.js'
import { audit } from '../core/audit.js'
import { nowIso } from '../util/time.js'
import { errText, log } from '../core/logger.js'

/**
 * Where the Anthropic key comes from.
 *
 * Two sources, checked in this order:
 *   1. `ANTHROPIC_API_KEY` in the environment — wins, because an operator who
 *      sets it explicitly (systemd, Docker secret) means it.
 *   2. An owner-entered key stored AES-256-GCM encrypted in `settings`.
 *
 * The second exists so connecting the brain does not require editing a file on
 * the server. The key is write-only across the API: it is validated with a real
 * call before it is stored, and no endpoint ever returns it — only a masked
 * hint and which source is active.
 */

const SETTING_KEY = 'llm.api_key'

export type KeySource = 'env' | 'database' | null

export function llmKeySource(db: DB): KeySource {
  if (config.llm.apiKey) return 'env'
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY) as
    { value: string } | undefined
  return row ? 'database' : null
}

/** The effective key, or null. Never log or return this value. */
export function getLlmKey(db: DB): string | null {
  if (config.llm.apiKey) return config.llm.apiKey
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY) as
    { value: string } | undefined
  if (!row) return null
  try {
    return decryptSecret(row.value)
  } catch (e) {
    // A changed or missing master key must not look like "no key configured" —
    // that would send the owner hunting for the wrong problem.
    log.error('Gespeicherter API-Schlüssel nicht entschlüsselbar', { error: errText(e) })
    return null
  }
}

/** `sk-ant-…KJ8s` — enough to recognise which key is active, useless if leaked. */
export function maskKey(key: string): string {
  if (key.length <= 12) return '••••'
  return `${key.slice(0, 8)}…${key.slice(-4)}`
}

export interface KeyCheck {
  ok: boolean
  detail_de: string
  model?: string
  /** Distinguishes "wrong key" from "key fine, model not available to you". */
  code?: 'invalid_key' | 'model_unavailable' | 'network' | 'offline' | 'unknown'
}

/**
 * Validates a key against the real API before we commit to it.
 *
 * `models.retrieve` is the right probe: it costs nothing, and it separates the
 * two failure modes an owner actually hits — a bad key (401) versus a key that
 * works but has no access to the configured model (404).
 */
export async function checkLlmKey(key: string, model = config.llm.model): Promise<KeyCheck> {
  // Format first: it is local and free, so an obviously wrong value gets a
  // useful answer even offline, instead of "cannot check right now".
  if (!/^sk-ant-/.test(key.trim())) {
    return {
      ok: false, code: 'invalid_key',
      detail_de: 'Das sieht nicht nach einem Anthropic-Schlüssel aus (erwartet wird ein Wert, der mit „sk-ant-“ beginnt).',
    }
  }
  if (config.offline) {
    return {
      ok: false, code: 'offline',
      detail_de: 'Offline-Modus ist aktiv – der Schlüssel kann nicht gegen die API geprüft werden. ' +
                 'Setze JARVIS_OFFLINE=false und versuche es erneut.',
    }
  }

  const client = new Anthropic({
    apiKey: key.trim(),
    ...(config.llm.baseUrl ? { baseURL: config.llm.baseUrl } : {}),
    maxRetries: 1,
    timeout: 20_000,
  })

  try {
    const m = await client.models.retrieve(model)
    return { ok: true, model: m.id, detail_de: `Verbunden. Modell ${m.id} ist verfügbar.` }
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 401 || status === 403) {
      return { ok: false, code: 'invalid_key', detail_de: 'Der Schlüssel wurde abgelehnt (401/403). Bitte prüfen, ob er gültig und aktiv ist.' }
    }
    if (status === 404) {
      return {
        ok: false, code: 'model_unavailable',
        detail_de: `Der Schlüssel ist gültig, aber das Modell „${model}“ ist für ihn nicht verfügbar. ` +
                   'Passe JARVIS_MODEL an ein freigeschaltetes Modell an.',
      }
    }
    return { ok: false, code: status ? 'unknown' : 'network', detail_de: `Prüfung fehlgeschlagen: ${errText(e)}` }
  }
}

/** Validates, then stores encrypted. Refuses rather than storing in cleartext. */
export async function setLlmKey(db: DB, key: string, actor: string): Promise<KeyCheck> {
  if (!hasMasterKey()) {
    return {
      ok: false, code: 'unknown',
      detail_de: 'JARVIS_MASTER_KEY fehlt. Ohne Master-Key wird kein Zugangsdatum gespeichert – ' +
                 'erzeuge einen mit „npm run jarvis -- keygen“ und trage ihn in .env ein.',
    }
  }

  const check = await checkLlmKey(key)
  if (!check.ok) {
    audit(db, { actor, action: 'llm.key_rejected', outcome: 'denied', detail: { code: check.code } })
    return check
  }

  db.prepare(
    `INSERT INTO settings (key, value, encrypted, updated_at) VALUES (?,?,1,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = 1, updated_at = excluded.updated_at`,
  ).run(SETTING_KEY, encryptSecret(key.trim()), nowIso())

  audit(db, {
    actor, action: 'llm.key_set', outcome: 'ok',
    detail: { source: 'database', model: check.model, masked: maskKey(key.trim()) },
  })
  log.info('Anthropic-Schlüssel hinterlegt', { model: check.model })
  return check
}

export function clearLlmKey(db: DB, actor: string): boolean {
  const r = db.prepare('DELETE FROM settings WHERE key = ?').run(SETTING_KEY)
  if (r.changes) audit(db, { actor, action: 'llm.key_cleared', outcome: 'ok' })
  return r.changes > 0
}

/** What the UI is allowed to see. Never contains the key itself. */
export function llmKeyInfo(db: DB) {
  const source = llmKeySource(db)
  const key = getLlmKey(db)
  return {
    configured: !!key,
    source,
    masked: key ? maskKey(key) : null,
    model: config.llm.model,
    // An env-provided key cannot be changed from the UI — say so instead of
    // offering a button that silently does nothing.
    editable: source !== 'env',
    offline: config.offline,
    master_key_present: hasMasterKey(),
  }
}
