import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, type DB } from '../src/db/index.js'
import {
  writeMemory, updateMemory, forgetMemory, restoreMemory, purgeMemory, getMemory,
  listMemories, recall, proposeMemory, decideProposal, pendingProposals,
  applyRetention, memoriesToContext,
} from '../src/memory/service.js'
import {
  createUser, login, resolveSession, logout, changePassword,
  beginTotpEnrolment, confirmTotpEnrolment, revokeAllSessions,
} from '../src/auth/service.js'
import { hasMasterKey, encryptSecret, decryptSecret, totpAt, verifyTotp, hashPassword, verifyPassword } from '../src/core/crypto.js'
import { plus, DAY } from '../src/util/time.js'
import { roleAllows } from '@jarvis/shared'

let db: DB
beforeEach(() => { db = testDb() })

const draft = (over: Partial<Parameters<typeof writeMemory>[1]> = {}) => ({
  kind: 'preference' as const, subject: 'Anrede', content: 'Michael wird geduzt.',
  sensitivity: 'internal' as const, confidence: 0.9, provenance: 'Test', ...over,
})

describe('Kryptographie', () => {
  it('verschlüsselt und entschlüsselt verlustfrei', () => {
    const secret = 'Sehr geheime Notiz mit Umlauten: äöüß'
    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })

  it('erzeugt bei gleicher Eingabe unterschiedliche Chiffrate (frischer IV)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'))
  })

  it('erkennt manipulierte Chiffrate (GCM-Authentifizierung)', () => {
    const blob = encryptSecret('original')
    const parts = blob.split(':')
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from('boese').toString('base64')}`
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('verifiziert Passwörter und lehnt falsche ab', () => {
    const h = hashPassword('EinLangesPasswort123')
    expect(verifyPassword('EinLangesPasswort123', h)).toBe(true)
    expect(verifyPassword('falsch', h)).toBe(false)
  })

  it('erzeugt gültige TOTP-Codes mit Drift-Toleranz', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const now = Date.now()
    expect(verifyTotp(secret, totpAt(secret, Math.floor(now / 30_000)), now)).toBe(true)
    expect(verifyTotp(secret, totpAt(secret, Math.floor(now / 30_000) - 1), now)).toBe(true)
    expect(verifyTotp(secret, '000000', now)).toBe(false)
  })
})

describe('Erinnerungsspeicher', () => {
  it('speichert und liest eine Erinnerung', () => {
    const m = writeMemory(db, draft(), null, 'user:test')
    expect(getMemory(db, m.id)?.content).toBe('Michael wird geduzt.')
  })

  it('verschlüsselt vertrauliche Inhalte auf der Platte', () => {
    if (!hasMasterKey()) return   // requires JARVIS_MASTER_KEY in the environment
    const m = writeMemory(db, draft({ sensitivity: 'private', content: 'Blutdruckwerte 130/85' }), null, 'user:test')
    const raw = db.prepare('SELECT content, encrypted FROM memories WHERE id = ?').get(m.id) as
      { content: string; encrypted: number }
    expect(raw.encrypted).toBe(1)
    expect(raw.content).not.toContain('Blutdruck')
    expect(raw.content.startsWith('v1:')).toBe(true)
    // …but reads through the service transparently.
    expect(getMemory(db, m.id)?.content).toBe('Blutdruckwerte 130/85')
  })

  it('findet auch verschlüsselte Inhalte über recall', () => {
    if (!hasMasterKey()) return
    writeMemory(db, draft({ sensitivity: 'private', subject: 'Gesundheit', content: 'Allergie gegen Penicillin' }), null, 'u')
    expect(recall(db, 'Penicillin').length).toBeGreaterThan(0)
  })

  it('schreibt jede Änderung in die Revisionshistorie', () => {
    const m = writeMemory(db, draft(), null, 'u')
    updateMemory(db, m.id, { content: 'Michael wird gesiezt.' }, 'u')
    const revs = db.prepare('SELECT count(*) n FROM memory_revisions WHERE memory_id = ?').get(m.id) as { n: number }
    expect(revs.n).toBe(1)
    expect(getMemory(db, m.id)?.revision).toBe(2)
  })

  it('löscht weich und stellt wieder her', () => {
    const m = writeMemory(db, draft(), null, 'u')
    expect(forgetMemory(db, m.id, 'u', 'Test')).toBe(true)
    expect(listMemories(db)).toHaveLength(0)
    expect(listMemories(db, { includeDeleted: true })).toHaveLength(1)
    expect(restoreMemory(db, m.id, 'u')).toBe(true)
    expect(listMemories(db)).toHaveLength(1)
  })

  it('entfernt beim endgültigen Löschen auch die Historie', () => {
    const m = writeMemory(db, draft(), null, 'u')
    updateMemory(db, m.id, { content: 'geändert' }, 'u')
    purgeMemory(db, m.id, 'u')
    expect(getMemory(db, m.id)).toBeNull()
    expect((db.prepare('SELECT count(*) n FROM memory_revisions WHERE memory_id=?').get(m.id) as { n: number }).n).toBe(0)
  })

  it('stuft Vermutungen bei der Suche zurück', () => {
    writeMemory(db, draft({ kind: 'fact', subject: 'Kaffee', content: 'Michael trinkt Kaffee schwarz.', confidence: 1 }), null, 'u')
    writeMemory(db, draft({ kind: 'hypothesis', subject: 'Kaffee', content: 'Michael mag vielleicht Espresso.', confidence: 1 }), null, 'u')
    const hits = recall(db, 'Kaffee')
    expect(hits[0]!.kind).toBe('fact')
  })

  it('markiert Vermutungen im Modellkontext deutlich', () => {
    const m = writeMemory(db, draft({ kind: 'hypothesis' }), null, 'u')
    expect(memoriesToContext([m])).toContain('VERMUTUNG')
  })

  it('speichert nichts ohne genehmigten Vorschlag', () => {
    const { proposal, committed } = proposeMemory(db, 'create', draft(), 'Wirkt nützlich')
    expect(proposal.status).toBe('pending')
    expect(committed).toBeNull()
    expect(listMemories(db)).toHaveLength(0)
    expect(pendingProposals(db)).toHaveLength(1)
  })

  it('speichert nach Genehmigung', () => {
    const { proposal } = proposeMemory(db, 'create', draft(), 'Grund')
    const m = decideProposal(db, proposal.id, true, 'user:test')
    expect(m).toBeTruthy()
    expect(listMemories(db)).toHaveLength(1)
  })

  it('übernimmt Korrekturen des Besitzers bei der Genehmigung', () => {
    const { proposal } = proposeMemory(db, 'create', draft(), 'Grund')
    const m = decideProposal(db, proposal.id, true, 'user:test', { content: 'Vom Besitzer korrigiert.' })
    expect(m?.content).toBe('Vom Besitzer korrigiert.')
  })

  it('speichert nach Ablehnung nichts', () => {
    const { proposal } = proposeMemory(db, 'create', draft(), 'Grund')
    expect(decideProposal(db, proposal.id, false, 'user:test')).toBeNull()
    expect(listMemories(db)).toHaveLength(0)
  })

  it('genehmigt automatisch nur bei passender enger Regel', () => {
    db.prepare(
      `INSERT INTO memory_rules (id, pattern, kind, max_sensitivity, auto_approve, created_at, created_by)
       VALUES ('r1','Anrede%','preference','internal',1,datetime('now'),'user:test')`,
    ).run()
    const { proposal, committed } = proposeMemory(db, 'create', draft(), 'Grund')
    expect(proposal.status).toBe('auto_approved')
    expect(committed).toBeTruthy()
  })

  it('automatisiert niemals geheime Erinnerungen', () => {
    db.prepare(
      `INSERT INTO memory_rules (id, pattern, kind, max_sensitivity, auto_approve, created_at, created_by)
       VALUES ('r1','%','*','secret',1,datetime('now'),'user:test')`,
    ).run()
    const { proposal } = proposeMemory(db, 'create', draft({ sensitivity: 'secret' }), 'Grund')
    expect(proposal.status).toBe('pending')
  })

  it('lässt Löschungen nie automatisch zu', () => {
    db.prepare(
      `INSERT INTO memory_rules (id, pattern, kind, max_sensitivity, auto_approve, created_at, created_by)
       VALUES ('r1','%','*','internal',1,datetime('now'),'user:test')`,
    ).run()
    const m = writeMemory(db, draft(), null, 'u')
    const { proposal } = proposeMemory(db, 'delete', draft(), 'weg damit', null, m.id)
    expect(proposal.status).toBe('pending')
    expect(listMemories(db)).toHaveLength(1)
  })

  it('lässt abgelaufene Erinnerungen verfallen', () => {
    writeMemory(db, draft({ expires_at: plus(-DAY) }), null, 'u')
    expect(applyRetention(db).expired).toBe(1)
    expect(listMemories(db)).toHaveLength(0)
  })

  it('entfernt weich gelöschte Erinnerungen nach der Karenzzeit endgültig', () => {
    const m = writeMemory(db, draft(), null, 'u')
    forgetMemory(db, m.id, 'u')
    db.prepare('UPDATE memories SET deleted_at = ? WHERE id = ?').run(plus(-40 * DAY), m.id)
    expect(applyRetention(db, 30).purged).toBe(1)
    expect(getMemory(db, m.id)).toBeNull()
  })
})

describe('Authentifizierung', () => {
  const pw = 'EinSehrLangesPasswort1'

  it('legt ein Konto an und meldet an', () => {
    createUser(db, 'michael', pw, 'owner')
    const r = login(db, 'michael', pw, undefined)
    expect(r.ok).toBe(true)
    expect(resolveSession(db, r.token)?.username).toBe('michael')
  })

  it('lehnt kurze Passwörter ab', () => {
    expect(() => createUser(db, 'x', 'kurz', 'owner')).toThrow(/12 Zeichen/)
  })

  it('gibt bei unbekanntem Benutzer und falschem Passwort dieselbe Meldung', () => {
    createUser(db, 'michael', pw, 'owner')
    const unknown = login(db, 'niemand', pw, undefined)
    const wrong = login(db, 'michael', 'falschfalschfalsch', undefined)
    expect(unknown.error).toBe(wrong.error)   // no user-enumeration oracle
  })

  it('sperrt das Konto nach zu vielen Fehlversuchen', () => {
    createUser(db, 'michael', pw, 'owner')
    for (let i = 0; i < 5; i++) login(db, 'michael', 'falschesPasswort', undefined)
    const r = login(db, 'michael', pw, undefined)   // correct password, still locked
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/gesperrt/)
  })

  it('speichert niemals das Sitzungstoken im Klartext', () => {
    createUser(db, 'michael', pw, 'owner')
    const r = login(db, 'michael', pw, undefined)
    const stored = db.prepare('SELECT id FROM sessions').get() as { id: string }
    expect(stored.id).not.toBe(r.token)
    expect(stored.id).toHaveLength(64)   // sha256 hex
  })

  it('macht abgemeldete Sitzungen sofort ungültig', () => {
    createUser(db, 'michael', pw, 'owner')
    const r = login(db, 'michael', pw, undefined)
    logout(db, r.token)
    expect(resolveSession(db, r.token)).toBeNull()
  })

  it('lehnt abgelaufene Sitzungen ab', () => {
    createUser(db, 'michael', pw, 'owner')
    const r = login(db, 'michael', pw, undefined)
    db.prepare('UPDATE sessions SET expires_at = ?').run(plus(-1000))
    expect(resolveSession(db, r.token)).toBeNull()
  })

  it('widerruft alle Sitzungen beim Passwortwechsel', () => {
    createUser(db, 'michael', pw, 'owner')
    const a = login(db, 'michael', pw, undefined)
    const user = resolveSession(db, a.token)!
    changePassword(db, user.id, pw, 'NeuesLangesPasswort1')
    expect(resolveSession(db, a.token)).toBeNull()
    expect(login(db, 'michael', 'NeuesLangesPasswort1', undefined).ok).toBe(true)
  })

  it('verlangt nach Aktivierung einen zweiten Faktor', () => {
    if (!hasMasterKey()) return
    createUser(db, 'michael', pw, 'owner')
    const user = resolveSession(db, login(db, 'michael', pw, undefined).token)!
    const { secret } = beginTotpEnrolment(db, user.id, 'michael')
    expect(confirmTotpEnrolment(db, user.id, totpAt(secret, Math.floor(Date.now() / 30_000)))).toBe(true)

    const noCode = login(db, 'michael', pw, undefined)
    expect(noCode.ok).toBe(false)
    expect(noCode.needsTotp).toBe(true)

    const withCode = login(db, 'michael', pw, totpAt(secret, Math.floor(Date.now() / 30_000)))
    expect(withCode.ok).toBe(true)
  })

  it('speichert das TOTP-Geheimnis verschlüsselt', () => {
    if (!hasMasterKey()) return
    createUser(db, 'michael', pw, 'owner')
    const user = resolveSession(db, login(db, 'michael', pw, undefined).token)!
    const { secret } = beginTotpEnrolment(db, user.id, 'michael')
    const raw = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(user.id) as { totp_secret: string }
    expect(raw.totp_secret).not.toContain(secret)
    expect(raw.totp_secret.startsWith('v1:')).toBe(true)
  })
})

describe('Rollen', () => {
  it('gibt dem Besitzer alle Rechte', () => {
    expect(roleAllows('owner', 'actions.decide')).toBe(true)
    expect(roleAllows('owner', 'memory.write')).toBe(true)
  })

  it('beschränkt Gäste auf Lesezugriffe', () => {
    expect(roleAllows('guest', 'sources.read')).toBe(true)
    expect(roleAllows('guest', 'memory.write')).toBe(false)
    expect(roleAllows('guest', 'actions.decide')).toBe(false)
    expect(roleAllows('guest', 'eval.approve')).toBe(false)
  })
})
