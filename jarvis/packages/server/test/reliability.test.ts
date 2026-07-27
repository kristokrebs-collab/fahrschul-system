import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, type DB } from '../src/db/index.js'
import {
  enqueue, claim, complete, fail, requestCancel, queueStats, recoverOrphans, Worker, JobCancelled,
} from '../src/core/queue.js'
import { audit, verifyAuditChain, recentAudit } from '../src/core/audit.js'
import { proposeAction, decideAction, recoverInFlightActions, loadAction, pendingActions } from '../src/tools/actions.js'
import { querySibling, siblingHealth, resetBreakers, siblingToContext } from '../src/adapters/sibling.js'
import { nowIso, plus } from '../src/util/time.js'

let db: DB
beforeEach(() => { db = testDb(); resetBreakers() })

describe('Job-Warteschlange', () => {
  it('dedupliziert über den Idempotenzschlüssel', () => {
    const a = enqueue(db, 'test', { x: 1 }, { idempotencyKey: 'k' })
    const b = enqueue(db, 'test', { x: 2 }, { idempotencyKey: 'k' })
    expect(b.id).toBe(a.id)
    expect(queueStats(db).pending).toBe(1)
  })

  it('erlaubt einen erneuten Versuch nach endgültigem Fehlschlag', () => {
    const a = enqueue(db, 'test', {}, { idempotencyKey: 'k', maxAttempts: 1 })
    const claimed = claim(db, 'w')!
    fail(db, claimed, 'kaputt')
    expect(queueStats(db).dead).toBe(1)
    // A dead job must not block the owner from re-running the same work.
    const b = enqueue(db, 'test', {}, { idempotencyKey: 'k' })
    expect(b.id).not.toBe(a.id)
    expect(b.status).toBe('pending')
  })

  it('gibt einen Job nur an einen Worker aus', () => {
    enqueue(db, 'test', {})
    expect(claim(db, 'w1')).toBeTruthy()
    expect(claim(db, 'w2')).toBeNull()
  })

  it('respektiert die Priorität', () => {
    enqueue(db, 'test', { n: 'low' }, { priority: 9 })
    enqueue(db, 'test', { n: 'high' }, { priority: 1 })
    expect(JSON.parse(claim(db, 'w')!.payload).n).toBe('high')
  })

  it('führt Jobs mit Zukunftstermin noch nicht aus', () => {
    enqueue(db, 'test', {}, { runAt: plus(60_000) })
    expect(claim(db, 'w')).toBeNull()
  })

  it('verschiebt fehlgeschlagene Jobs mit Backoff statt sie zu verlieren', () => {
    enqueue(db, 'test', {}, { maxAttempts: 3 })
    const job = claim(db, 'w')!
    expect(fail(db, job, 'zeitweiliger Fehler')).toBe('retry')
    expect(queueStats(db).pending).toBe(1)
    expect(claim(db, 'w')).toBeNull()   // backoff is in effect
  })

  it('markiert Jobs nach erschöpften Versuchen als dead statt sie stillschweigend zu verwerfen', () => {
    enqueue(db, 'test', {}, { maxAttempts: 2 })
    let job = claim(db, 'w')!
    fail(db, job, 'fehler 1')
    db.prepare('UPDATE jobs SET run_at = ? WHERE id = ?').run(nowIso(), job.id)
    job = claim(db, 'w')!
    expect(fail(db, job, 'fehler 2')).toBe('dead')
    expect(queueStats(db).dead).toBe(1)
  })

  it('nimmt einen Job nach Ablauf der Lease wieder auf', () => {
    enqueue(db, 'test', {})
    const job = claim(db, 'tot')!
    db.prepare('UPDATE jobs SET lease_until = ? WHERE id = ?').run(plus(-1000), job.id)
    const retaken = claim(db, 'lebendig')
    expect(retaken?.id).toBe(job.id)
    expect(retaken?.attempts).toBe(2)
  })

  it('stellt nach einem Neustart hängende Jobs wieder her', () => {
    enqueue(db, 'test', {})
    claim(db, 'w')
    expect(queueStats(db).running).toBe(1)
    expect(recoverOrphans(db)).toBe(1)          // simulates process restart
    expect(queueStats(db).pending).toBe(1)
    expect(claim(db, 'neu')).toBeTruthy()
  })

  it('bricht wartende Jobs sofort ab', () => {
    const job = enqueue(db, 'test', {})
    expect(requestCancel(db, job.id)).toBe(true)
    expect(queueStats(db).cancelled).toBe(1)
  })

  it('führt registrierte Handler aus und speichert das Ergebnis', async () => {
    const worker = new Worker(db, 'w-test', 1, 10)
    let ran = false
    worker.register('demo', async (ctx) => { ran = true; return { echo: ctx.payload.v } })
    enqueue(db, 'demo', { v: 42 })
    worker.start()
    await new Promise((r) => setTimeout(r, 400))
    await worker.stop()
    expect(ran).toBe(true)
    const row = db.prepare(`SELECT status, result FROM jobs WHERE kind='demo'`).get() as { status: string; result: string }
    expect(row.status).toBe('done')
    expect(JSON.parse(row.result).echo).toBe(42)
  })

  it('respektiert kooperative Abbrüche im Handler', async () => {
    const worker = new Worker(db, 'w-cancel', 1, 10)
    worker.register('slow', async (ctx) => {
      for (let i = 0; i < 40; i++) { ctx.checkCancelled(); await new Promise((r) => setTimeout(r, 10)) }
    })
    const job = enqueue(db, 'slow', {})
    worker.start()
    await new Promise((r) => setTimeout(r, 80))
    requestCancel(db, job.id)
    await new Promise((r) => setTimeout(r, 300))
    await worker.stop()
    expect((db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id) as { status: string }).status)
      .toBe('cancelled')
  })
})

describe('Audit-Log', () => {
  it('verkettet Einträge und erkennt nachträgliche Änderungen', () => {
    audit(db, { actor: 'system', action: 'a', outcome: 'ok' })
    audit(db, { actor: 'system', action: 'b', outcome: 'ok' })
    audit(db, { actor: 'system', action: 'c', outcome: 'ok' })
    expect(verifyAuditChain(db).valid).toBe(true)

    db.prepare(`UPDATE audit_log SET action='manipuliert' WHERE seq=2`).run()
    const broken = verifyAuditChain(db)
    expect(broken.valid).toBe(false)
    expect(broken.brokenAt).toBeTruthy()
  })

  it('erkennt das Löschen eines Eintrags', () => {
    audit(db, { actor: 'system', action: 'a', outcome: 'ok' })
    audit(db, { actor: 'system', action: 'b', outcome: 'ok' })
    audit(db, { actor: 'system', action: 'c', outcome: 'ok' })
    db.prepare('DELETE FROM audit_log WHERE seq = 2').run()
    expect(verifyAuditChain(db).valid).toBe(false)
  })

  it('redigiert Geheimnisse, bevor sie geschrieben werden', () => {
    audit(db, {
      actor: 'system', action: 'test', outcome: 'ok',
      detail: { password: 'geheim', api_key: 'sk-ant-123', harmlos: 'sichtbar' },
    })
    const entry = recentAudit(db, 1)[0] as { detail: Record<string, unknown> }
    expect(entry.detail.password).toBe('[redigiert]')
    expect(entry.detail.api_key).toBe('[redigiert]')
    expect(entry.detail.harmlos).toBe('sichtbar')
  })
})

describe('Aktions-Lebenszyklus', () => {
  const ctx = () => ({ db, actor: 'user:test', conversationId: null, projectId: null })

  it('führt Lesezugriffe direkt aus', async () => {
    const { preview, executed } = await proposeAction(db, 'search_private_knowledge', { query: 'test' }, ctx(), '')
    expect(preview.status).toBe('executed')
    expect(executed?.ok).toBe(true)
  })

  it('hält schreibende Aktionen bis zur Bestätigung an', async () => {
    const { preview, executed } = await proposeAction(db, 'create_task', { title: 'Reifen wechseln' }, ctx(), '')
    expect(preview.status).toBe('pending')
    expect(executed).toBeNull()
    // Nothing may have happened yet.
    expect((db.prepare('SELECT count(*) n FROM tasks').get() as { n: number }).n).toBe(0)
  })

  it('führt erst nach Freigabe aus', async () => {
    const { preview } = await proposeAction(db, 'create_task', { title: 'Öl prüfen' }, ctx(), '')
    const out = await decideAction(db, preview.id, true, ctx())
    expect(out.preview.status).toBe('executed')
    expect((db.prepare('SELECT count(*) n FROM tasks').get() as { n: number }).n).toBe(1)
  })

  it('führt nach Ablehnung nichts aus', async () => {
    const { preview } = await proposeAction(db, 'create_task', { title: 'Nicht machen' }, ctx(), '')
    const out = await decideAction(db, preview.id, false, ctx())
    expect(out.preview.status).toBe('rejected')
    expect(out.result).toBeNull()
    expect((db.prepare('SELECT count(*) n FROM tasks').get() as { n: number }).n).toBe(0)
  })

  it('führt eine Aktion auch bei doppelter Freigabe nur einmal aus', async () => {
    const { preview } = await proposeAction(db, 'create_task', { title: 'Einmalig' }, ctx(), '')
    await decideAction(db, preview.id, true, ctx())
    await expect(decideAction(db, preview.id, true, ctx())).rejects.toThrow(/bereits/)
    expect((db.prepare('SELECT count(*) n FROM tasks').get() as { n: number }).n).toBe(1)
  })

  it('lehnt abgelaufene Bestätigungen ab', async () => {
    const { preview } = await proposeAction(db, 'create_task', { title: 'Zu spät' }, ctx(), '')
    db.prepare('UPDATE actions SET expires_at = ? WHERE id = ?').run(plus(-1000), preview.id)
    await expect(decideAction(db, preview.id, true, ctx())).rejects.toThrow(/abgelaufen/)
    expect(loadAction(db, preview.id)?.status).toBe('expired')
  })

  it('meldet einen Werkzeugfehler als Fehler, nicht als Erfolg', async () => {
    const { preview } = await proposeAction(db, 'complete_task', { task_id: 'gibt-es-nicht' }, ctx(), '')
    const out = await decideAction(db, preview.id, true, ctx())
    expect(out.result?.ok).toBe(false)
    expect(out.preview.status).toBe('failed')
  })

  it('markiert nach einem Absturz laufende Aktionen als unklar statt als erledigt', async () => {
    const { preview } = await proposeAction(db, 'create_task', { title: 'Mitten drin' }, ctx(), '')
    await decideAction(db, preview.id, true, ctx())
    db.prepare(`UPDATE actions SET status='executing' WHERE id=?`).run(preview.id)

    expect(recoverInFlightActions(db)).toBe(1)
    const after = loadAction(db, preview.id)!
    expect(after.status).toBe('failed')
    expect(after.error).toMatch(/unbekannt/i)
  })

  it('listet offene Bestätigungen', async () => {
    await proposeAction(db, 'create_task', { title: 'A' }, ctx(), '')
    await proposeAction(db, 'create_task', { title: 'B' }, ctx(), '')
    expect(pendingActions(db)).toHaveLength(2)
  })
})

describe('Schwestersystem-Adapter', () => {
  it('meldet "nicht konfiguriert" statt Daten zu erfinden', async () => {
    const r = await querySibling('finance-crypto', '/api/summary')
    expect(r.configured).toBe(false)
    expect(r.ok).toBe(false)
    expect(r.data).toBeNull()
    expect(r.error).toMatch(/nicht konfiguriert/)
  })

  it('gibt dem Modell einen unmissverständlichen Hinweis', async () => {
    const r = await querySibling('social-autopilot', '/api/status')
    expect(siblingToContext(r)).toMatch(/NICHT KONFIGURIERT|keine Daten/)
  })

  it('lehnt nicht freigegebene Pfade ab', async () => {
    const r = await querySibling('finance-crypto', '/api/admin/withdraw' as never)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/nicht freigegeben/)
  })

  it('meldet den Gesundheitszustand als not_configured', async () => {
    expect((await siblingHealth('social-autopilot')).status).toBe('not_configured')
  })
})
