import Anthropic from '@anthropic-ai/sdk'
import type { DB } from '../db/index.js'
import { config } from '../config.js'
import type { ComponentHealth } from '@jarvis/shared'
import { nowIso } from '../util/time.js'
import { errText } from '../core/logger.js'
import { getLlmKey, llmKeySource } from './credentials.js'

/**
 * Anthropic client.
 *
 * Two rules:
 *  - With no key this returns `null` rather than a stub. Callers must handle
 *    the null and degrade visibly; a fake client that returns canned text would
 *    let JARVIS appear to answer when it cannot.
 *  - The client is rebuilt when the key changes, so entering a key in the UI
 *    takes effect immediately — no restart.
 */

let client: Anthropic | null = null
let cachedKey: string | null = null
/** Set by tests via `setLlmClient`; bypasses key resolution entirely. */
let forced: Anthropic | null = null

export function llm(db: DB): Anthropic | null {
  if (forced) return forced

  const key = getLlmKey(db)
  if (!key) { client = null; cachedKey = null; return null }
  if (client && cachedKey === key) return client

  cachedKey = key
  client = new Anthropic({
    apiKey: key,
    ...(config.llm.baseUrl ? { baseURL: config.llm.baseUrl } : {}),
    maxRetries: 2,
    timeout: 10 * 60 * 1000,
  })
  return client
}

export function llmConfigured(db: DB): boolean {
  return !!forced || !!getLlmKey(db)
}

/** Test hook: inject a client without touching credentials. */
export function setLlmClient(c: Anthropic | null): void {
  forced = c
  if (!c) { client = null; cachedKey = null }
}

export async function llmHealth(db: DB): Promise<ComponentHealth> {
  const at = nowIso()
  const name = 'Sprachmodell (Anthropic)'

  if (!llmConfigured(db)) {
    return {
      name, status: 'not_configured', checked_at: at,
      detail_de: 'Kein Anthropic-Schlüssel hinterlegt. Quellen-Suche, Zitate, Erinnerungen und ' +
                 'Aufgaben funktionieren; freie Antworten nicht. Verbinden unter „System → Zustand“.',
    }
  }
  if (config.offline) {
    return { name, status: 'degraded', checked_at: at, detail_de: 'Offline-Modus aktiv – keine Modellaufrufe.' }
  }

  const c = llm(db)
  if (!c) return { name, status: 'down', checked_at: at, detail_de: 'Client nicht initialisiert' }

  try {
    // Cheapest liveness probe: count tokens, no generation, no cost.
    await c.messages.countTokens({
      model: config.llm.model,
      messages: [{ role: 'user', content: 'ping' }],
    })
    const src = llmKeySource(db) === 'env' ? 'Umgebungsvariable' : 'verschlüsselt gespeichert'
    return { name, status: 'ok', checked_at: at, detail_de: `${config.llm.model} erreichbar (Schlüssel: ${src})` }
  } catch (e) {
    const status = (e as { status?: number }).status
    const hint = status === 401 || status === 403
      ? 'Der Schlüssel wurde abgelehnt – bitte neu verbinden.'
      : status === 404
        ? `Modell „${config.llm.model}“ ist für diesen Schlüssel nicht verfügbar.`
        : errText(e)
    return { name, status: 'down', checked_at: at, detail_de: `Nicht erreichbar: ${hint}` }
  }
}

/** Server-side research tools. Only attached when the turn may go online. */
export function webTools() {
  return [
    { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 6 },
    { type: 'web_fetch_20260209' as const, name: 'web_fetch' as const, max_uses: 6, citations: { enabled: true } },
  ]
}
