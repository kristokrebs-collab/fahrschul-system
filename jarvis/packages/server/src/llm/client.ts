import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import type { ComponentHealth } from '@jarvis/shared'
import { nowIso } from '../util/time.js'
import { errText } from '../core/logger.js'

/**
 * Anthropic client wrapper.
 *
 * The one rule: when no key is configured, this returns null rather than a
 * stub. Callers must handle the null and degrade visibly — a fake client that
 * returns canned text would let JARVIS appear to answer when it cannot.
 */

let client: Anthropic | null = null
let checked = false

export function llm(): Anthropic | null {
  if (checked) return client
  checked = true
  if (!config.llm.apiKey) return (client = null)
  client = new Anthropic({
    apiKey: config.llm.apiKey,
    ...(config.llm.baseUrl ? { baseURL: config.llm.baseUrl } : {}),
    maxRetries: 2,
    timeout: 10 * 60 * 1000,
  })
  return client
}

export function llmConfigured(): boolean {
  return !!config.llm.apiKey
}

/** Test hook so the orchestrator can be exercised without a network call. */
export function setLlmClient(c: Anthropic | null): void {
  client = c
  checked = true
}

export async function llmHealth(): Promise<ComponentHealth> {
  const at = nowIso()
  if (!llmConfigured()) {
    return {
      name: 'Sprachmodell (Anthropic)', status: 'not_configured', checked_at: at,
      detail_de: 'ANTHROPIC_API_KEY fehlt. Quellen-Suche und Erinnerungen funktionieren, ' +
                 'freie Antworten nicht.',
    }
  }
  if (config.offline) {
    return {
      name: 'Sprachmodell (Anthropic)', status: 'degraded', checked_at: at,
      detail_de: 'Offline-Modus aktiv – keine Modellaufrufe.',
    }
  }
  const c = llm()
  if (!c) return { name: 'Sprachmodell (Anthropic)', status: 'down', checked_at: at, detail_de: 'Client nicht initialisiert' }
  try {
    // Cheapest possible liveness probe: count tokens, no generation.
    await c.messages.countTokens({
      model: config.llm.model,
      messages: [{ role: 'user', content: 'ping' }],
    })
    return {
      name: 'Sprachmodell (Anthropic)', status: 'ok', checked_at: at,
      detail_de: `${config.llm.model} erreichbar`,
    }
  } catch (e) {
    return {
      name: 'Sprachmodell (Anthropic)', status: 'down', checked_at: at,
      detail_de: `Nicht erreichbar: ${errText(e)}`,
    }
  }
}

/** Server-side research tools. Only attached when the turn is allowed to go online. */
export function webTools() {
  return [
    { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 6 },
    { type: 'web_fetch_20260209' as const, name: 'web_fetch' as const, max_uses: 6, citations: { enabled: true } },
  ]
}
