import type { DB } from '../db/index.js'
import type { SystemStatus, ComponentHealth } from '@jarvis/shared'
import { config } from '../config.js'
import { nowIso } from '../util/time.js'
import { queueStats } from '../core/queue.js'
import { verifyAuditChain } from '../core/audit.js'
import { indexStats } from '../knowledge/indexer.js'
import { embeddings } from '../knowledge/embeddings.js'
import { llmHealth } from '../llm/client.js'
import { siblingHealth } from '../adapters/sibling.js'
import { hasMasterKey } from '../core/crypto.js'
import { errText } from '../core/logger.js'

const startedAt = Date.now()

/**
 * System status.
 *
 * Every component reports one of ok / degraded / down / not_configured, in
 * German, with a reason. "not_configured" is a first-class state: it is the
 * honest answer for an integration the owner has not set up, and it must never
 * be dressed up as "ok".
 */
export async function systemStatus(db: DB): Promise<SystemStatus> {
  const components: ComponentHealth[] = []
  const at = nowIso()

  // Database
  try {
    const integrity = db.pragma('integrity_check', { simple: true })
    const ok = integrity === 'ok'
    components.push({
      name: 'Datenbank (SQLite)', status: ok ? 'ok' : 'degraded', checked_at: at,
      detail_de: ok ? `WAL-Modus, Integrität geprüft` : `Integritätsprüfung: ${String(integrity)}`,
    })
  } catch (e) {
    components.push({ name: 'Datenbank (SQLite)', status: 'down', checked_at: at, detail_de: errText(e) })
  }

  // Embeddings
  const emb = embeddings()
  try {
    const h = await emb.health()
    components.push({
      name: `Embeddings (${emb.name})`,
      status: emb.quality === 'none' ? 'not_configured' : h.ok ? (emb.quality === 'lexical' ? 'degraded' : 'ok') : 'down',
      detail_de: h.detail, checked_at: at,
    })
  } catch (e) {
    components.push({ name: `Embeddings (${emb.name})`, status: 'down', checked_at: at, detail_de: errText(e) })
  }

  components.push(await llmHealth())
  components.push(await siblingHealth('social-autopilot'))
  components.push(await siblingHealth('finance-crypto'))

  components.push({
    name: 'Verschlüsselung (Master-Key)',
    status: hasMasterKey() ? 'ok' : 'not_configured',
    detail_de: hasMasterKey()
      ? 'AES-256-GCM aktiv für vertrauliche Erinnerungen und Zugangsdaten'
      : 'JARVIS_MASTER_KEY fehlt – vertrauliche Erinnerungen werden abgelehnt statt im Klartext gespeichert.',
    checked_at: at,
  })

  const q = queueStats(db)
  components.push({
    name: 'Job-Warteschlange',
    status: q.dead > 0 ? 'degraded' : 'ok',
    detail_de: q.dead > 0
      ? `${q.dead} Job(s) endgültig fehlgeschlagen – bitte prüfen`
      : `${q.pending} wartend, ${q.running} laufend`,
    checked_at: at,
  })

  const chain = verifyAuditChain(db)
  components.push({
    name: 'Audit-Log',
    status: chain.valid ? 'ok' : 'down',
    detail_de: chain.valid
      ? `${chain.entries} Einträge, Hash-Kette intakt`
      : `Hash-Kette gebrochen ab Eintrag ${chain.brokenAt} – möglicher Eingriff in die Datenbank`,
    checked_at: at,
  })

  if (config.offline) {
    components.push({
      name: 'Netzwerk', status: 'degraded', checked_at: at,
      detail_de: 'Offline-Modus aktiv – keine ausgehenden Verbindungen außer localhost.',
    })
  }

  return {
    version: config.version,
    started_at: nowIso(startedAt),
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
    offline_mode: config.offline,
    components,
    queue: { pending: q.pending, running: q.running, failed: q.failed, dead: q.dead },
    index: indexStats(db),
    audit: { entries: chain.entries, chain_valid: chain.valid },
  }
}
