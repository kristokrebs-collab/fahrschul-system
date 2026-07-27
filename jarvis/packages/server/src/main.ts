import { config } from './config.js'
import { getDb, closeDb, makeBackup } from './db/index.js'
import { log, errText } from './core/logger.js'
import { audit } from './core/audit.js'
import { Worker, enqueue, recoverOrphans } from './core/queue.js'
import { recoverInFlightActions, expireStaleActions } from './tools/actions.js'
import { ingestRoots, embedPending } from './knowledge/indexer.js'
import { applyRetention } from './memory/service.js'
import { synthesiseProposals } from './eval/outcomes.js'
import { runEval, seedRegressionCases } from './eval/runner.js'
import { seedPrompts } from './llm/prompts.js'
import { pruneSessions } from './auth/service.js'
import { buildServer } from './http/server.js'
import { nowIso, plus, HOUR, MINUTE } from './util/time.js'

/**
 * Entry point.
 *
 * Boot order matters: recover crashed state *before* accepting traffic, so a
 * restart never leaves a job wedged in `running` or an action stuck mid-flight
 * while the UI reports everything is fine.
 */

async function main() {
  const db = getDb()

  // 1 ─ Seeds (idempotent)
  seedPrompts(db)
  seedRegressionCases(db)

  // 2 ─ Crash recovery
  const orphans = recoverOrphans(db)
  const inFlight = recoverInFlightActions(db)
  const expired = expireStaleActions(db)
  pruneSessions(db)
  audit(db, {
    actor: 'system', action: 'server.start', outcome: 'ok',
    detail: { version: config.version, orphan_jobs: orphans, in_flight_actions: inFlight, expired_actions: expired },
  })

  // 3 ─ Background worker
  const worker = new Worker(db, `worker-${process.pid}`, 2, 400)
  worker
    .register('index.scan', async (ctx) => {
      const stats = await ingestRoots(db, config.sourceRoots, { force: !!ctx.payload.force }, (done, total) => {
        if (done % 25 === 0) ctx.heartbeat()
        ctx.checkCancelled()
      })
      return stats as unknown as Record<string, unknown>
    })
    .register('index.embed', async () => {
      let total = 0, batch = 0
      do { batch = await embedPending(db); total += batch } while (batch > 0)
      return { embedded: total }
    })
    .register('memory.retention', async () => applyRetention(db))
    .register('backup.create', async () => makeBackup(db))
    .register('eval.nightly', async () => {
      const run = await runEval(db, { tier: 'retrieval', label: `nightly-${nowIso().slice(0, 10)}`, actor: 'system' })
      return { score: run.score, passed: run.passed, failed: run.failed }
    })
    .register('eval.synthesise', async () => ({ created: synthesiseProposals(db).length }))
    .register('auth.prune', async () => ({ pruned: pruneSessions(db) }))
  worker.start()

  // 4 ─ Recurring maintenance. Idempotency keys are bucketed by period, so a
  //     restart storm cannot pile up duplicate work.
  const schedule = () => {
    const day = nowIso().slice(0, 10)
    const hour = nowIso().slice(0, 13)
    enqueue(db, 'memory.retention', {}, { idempotencyKey: `retention.${day}`, priority: 8 })
    enqueue(db, 'backup.create', {}, { idempotencyKey: `backup.${day}`, priority: 8 })
    enqueue(db, 'eval.nightly', {}, { idempotencyKey: `eval.${day}`, priority: 9 })
    enqueue(db, 'eval.synthesise', {}, { idempotencyKey: `synth.${day}`, priority: 9 })
    enqueue(db, 'auth.prune', {}, { idempotencyKey: `prune.${day}`, priority: 9 })
    enqueue(db, 'index.embed', {}, { idempotencyKey: `embed.${hour}`, priority: 7 })
  }
  schedule()
  const maintenance = setInterval(schedule, HOUR)
  maintenance.unref()

  // 5 ─ Initial index if the KB is empty (first run convenience)
  const chunks = db.prepare('SELECT count(*) n FROM chunks').get() as { n: number }
  if (chunks.n === 0) {
    enqueue(db, 'index.scan', {}, { idempotencyKey: `index.initial`, priority: 3, timeoutMs: 30 * MINUTE })
    log.info('Wissensbasis ist leer – erster Indexlauf eingeplant')
  }

  // 6 ─ HTTP
  const app = await buildServer()
  await app.listen({ host: config.host, port: config.port })
  log.info('JARVIS läuft', {
    url: `http://${config.host}:${config.port}`,
    version: config.version,
    llm: !!config.llm.apiKey,
    offline: config.offline,
  })

  /* Graceful shutdown: stop taking work, let in-flight jobs finish, close the
     DB cleanly so WAL is checkpointed. */
  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    log.info('Herunterfahren', { signal })
    clearInterval(maintenance)
    try { await worker.stop() } catch (e) { log.warn('Worker-Stopp', { error: errText(e) }) }
    try { await app.close() } catch (e) { log.warn('HTTP-Stopp', { error: errText(e) }) }
    audit(db, { actor: 'system', action: 'server.stop', outcome: 'ok', detail: { signal } })
    closeDb()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('unhandledRejection', (reason) => {
    log.error('Unbehandelte Promise-Ablehnung', { error: errText(reason) })
  })
  process.on('uncaughtException', (err) => {
    log.error('Nicht abgefangene Ausnahme', { error: err.message, stack: err.stack?.slice(0, 2000) })
    void shutdown('uncaughtException')
  })
}

main().catch((e) => {
  log.error('Startfehler', { error: errText(e) })
  process.exit(1)
})
