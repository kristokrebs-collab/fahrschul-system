import { config } from '../config.js'
import { log, errText } from '../core/logger.js'
import type { ComponentHealth } from '@jarvis/shared'
import { nowIso } from '../util/time.js'

/**
 * Read-only adapters to the two sibling systems.
 *
 * Boundary rules, enforced here rather than trusted to the model:
 *  - Only GET. The adapter has no code path that can write, publish, or trade.
 *  - Separate credentials per system, injected from env, never logged, never
 *    forwarded to the model, never shared between adapters.
 *  - A circuit breaker keeps one sick sibling from degrading JARVIS itself.
 *  - Unconfigured means unconfigured: we return `not_configured` and the
 *    assistant says so. We never synthesise plausible-looking numbers.
 */

export type SiblingKind = 'social-autopilot' | 'finance-crypto'

export interface SiblingResponse<T = unknown> {
  ok: boolean
  configured: boolean
  data: T | null
  error: string | null
  fetched_at: string
  source_system: SiblingKind
  /** Verbatim upstream endpoint, so a citation can point at where it came from. */
  endpoint: string | null
}

interface Breaker {
  failures: number
  openUntil: number
}

const breakers = new Map<SiblingKind, Breaker>()
const FAILURE_THRESHOLD = 3
const OPEN_MS = 60_000

function breakerFor(kind: SiblingKind): Breaker {
  let b = breakers.get(kind)
  if (!b) { b = { failures: 0, openUntil: 0 }; breakers.set(kind, b) }
  return b
}

export function resetBreakers(): void {
  breakers.clear()
}

function settings(kind: SiblingKind) {
  return kind === 'social-autopilot' ? config.adapters.social : config.adapters.finance
}

/** Only these paths may be requested. The model cannot reach arbitrary URLs. */
const ALLOWED_PATHS: Record<SiblingKind, string[]> = {
  'social-autopilot': ['/api/status', '/api/summary', '/api/posts/recent', '/api/schedule/upcoming'],
  'finance-crypto': ['/api/status', '/api/summary', '/api/portfolio/overview', '/api/alerts/active'],
}

export async function querySibling<T = unknown>(
  kind: SiblingKind, path: string, timeoutMs = 8000,
): Promise<SiblingResponse<T>> {
  const at = nowIso()
  const base = { fetched_at: at, source_system: kind, endpoint: null as string | null }

  const cfg = settings(kind)

  // Path allowlist first: a request for an unlisted path is malformed
  // regardless of whether the sibling happens to be configured, and saying so
  // is more useful than "not configured" when a caller guessed a URL.
  if (!ALLOWED_PATHS[kind].includes(path)) {
    return { ok: false, configured: !!cfg.url, data: null, ...base,
      error: `Pfad ${path} ist für ${kind} nicht freigegeben.` }
  }
  if (!cfg.url) {
    return { ok: false, configured: false, data: null, ...base,
      error: `${kind} ist nicht konfiguriert. Es liegen keine Daten vor.` }
  }
  if (config.offline) {
    return { ok: false, configured: true, data: null, ...base,
      error: 'Offline-Modus aktiv – Schwestersystem wird nicht abgefragt.' }
  }

  const breaker = breakerFor(kind)
  if (Date.now() < breaker.openUntil) {
    return { ok: false, configured: true, data: null, ...base,
      error: `${kind} ist vorübergehend deaktiviert (zu viele Fehler). Nächster Versuch in ` +
             `${Math.ceil((breaker.openUntil - Date.now()) / 1000)}s.` }
  }

  const endpoint = new URL(path, cfg.url).href
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (cfg.token) headers.authorization = `Bearer ${cfg.token}`

    const res = await fetch(endpoint, {
      method: 'GET',                       // never anything else — see boundary rules
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json() as T
    breaker.failures = 0
    return { ok: true, configured: true, data, error: null, ...base, endpoint }
  } catch (e) {
    breaker.failures++
    if (breaker.failures >= FAILURE_THRESHOLD) {
      breaker.openUntil = Date.now() + OPEN_MS
      log.warn('Circuit Breaker geöffnet', { kind, failures: breaker.failures })
    }
    const msg = errText(e)
    log.warn('Schwestersystem nicht erreichbar', { kind, path, error: msg })
    return { ok: false, configured: true, data: null, ...base, endpoint,
      error: `${kind} nicht erreichbar: ${msg}` }
  }
}

export async function siblingHealth(kind: SiblingKind): Promise<ComponentHealth> {
  const cfg = settings(kind)
  const label = kind === 'social-autopilot' ? 'Social Autopilot' : 'Finance & Crypto'
  if (!cfg.url) {
    return { name: label, status: 'not_configured', checked_at: nowIso(),
      detail_de: 'Keine URL hinterlegt – Abfragen liefern keine Daten.' }
  }
  const r = await querySibling(kind, '/api/status', 4000)
  return {
    name: label,
    status: r.ok ? 'ok' : 'down',
    detail_de: r.ok ? `Erreichbar (nur lesend), Stand ${r.fetched_at}` : (r.error ?? 'Unbekannter Fehler'),
    checked_at: nowIso(),
  }
}

/**
 * Renders a sibling response for the model. Failure is stated explicitly so the
 * assistant reports "keine Daten" instead of inventing a portfolio value.
 */
export function siblingToContext(r: SiblingResponse): string {
  if (!r.configured) return `[${r.source_system}] NICHT KONFIGURIERT – keine Daten verfügbar.`
  if (!r.ok) return `[${r.source_system}] ABRUF FEHLGESCHLAGEN: ${r.error} – keine Daten verfügbar.`
  return [
    `[${r.source_system}] Abgerufen ${r.fetched_at} von ${r.endpoint} (nur lesend):`,
    JSON.stringify(r.data, null, 1).slice(0, 6000),
  ].join('\n')
}
