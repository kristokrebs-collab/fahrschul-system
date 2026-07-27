/**
 * Tests der Sicherheits- und Rechte-Grundlagen.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, seedMinimal, makeOwner, makeEditor, publishableAsset, draftItem } from './helpers.js';
import { review } from '../agents/orchestrator.js';
import { buildApprovalCard, decide } from '../domain/approval.js';
import {
  hashPassword, verifyPassword, encryptSecret, decryptSecret,
  contentHash, canonicalize, redact, newSessionToken, sha256,
} from '../security/crypto.js';
import { login, resolveSession, logout, requireRole, AuthError, hasRole } from '../security/auth.js';
import { ingestAsset, setClearance, publishBlockers, isPublishable, parseMediaQuery, searchMediaNatural, autoPrivacyCheck } from '../domain/media.js';
import { publicConfig } from '../config/env.js';
import { get, run, nowIso } from '../db/index.js';

describe('Kryptographie', () => {
  test('Passwoerter werden gesalzen gehasht und korrekt geprueft', () => {
    const a = hashPassword('ein-sicheres-passwort-2026');
    const b = hashPassword('ein-sicheres-passwort-2026');
    assert.notEqual(a, b, 'Gleiches Passwort muss unterschiedliche Hashes ergeben (Salt).');
    assert.equal(verifyPassword('ein-sicheres-passwort-2026', a), true);
    assert.equal(verifyPassword('falsches-passwort-2026', a), false);
  });

  test('Zu kurze Passwoerter werden abgelehnt', () => {
    assert.throws(() => hashPassword('kurz'), /mindestens 12/i);
  });

  test('Secrets werden authentifiziert verschluesselt und sind kontextgebunden', () => {
    const cipher = encryptSecret('geheimes-token-123', 'meta:instagram');
    assert.ok(!cipher.includes('geheimes'), 'Der Klartext darf nicht im Chiffretext auftauchen.');
    assert.equal(decryptSecret(cipher, 'meta:instagram'), 'geheimes-token-123');
    assert.throws(
      () => decryptSecret(cipher, 'meta:facebook'),
      'Ein Chiffretext darf nicht in einem anderen Kontext entschluesselbar sein.',
    );
  });

  test('Der Inhalts-Hash ist unabhaengig von der Schluesselreihenfolge', () => {
    const a = contentHash({ b: 2, a: 1, nested: { y: 2, x: 1 } });
    const b = contentHash({ a: 1, nested: { x: 1, y: 2 }, b: 2 });
    assert.equal(a, b);
    assert.notEqual(a, contentHash({ a: 1, b: 3, nested: { x: 1, y: 2 } }));
  });

  test('Kanonisierung ignoriert undefined-Werte', () => {
    assert.equal(canonicalize({ a: 1, b: undefined }), canonicalize({ a: 1 }));
  });

  test('Redaction entfernt bekannte Token-Muster', () => {
    const line = 'Fehler mit access_token=EAAB1234567890abcdefghijklmnop und key';
    const safe = redact(line);
    assert.ok(!safe.includes('EAAB1234567890abcdefghijklmnop'), `Token nicht maskiert: ${safe}`);
    assert.ok(safe.includes('REDACTED'));
  });

  test('Sitzungstoken werden nur als Hash gespeichert', () => {
    const { token, hash } = newSessionToken();
    assert.notEqual(token, hash);
    assert.equal(sha256(token), hash);
  });
});

describe('Authentifizierung und Rollen', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('security-auth'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('Anmeldung mit falschem Passwort schlaegt fehl', () => {
    makeOwner();
    assert.throws(() => login('owner0@test.local', 'falsch-falsch-falsch', {}), /falsch/i);
  });

  test('Eine gueltige Sitzung wird aufgeloest, eine abgemeldete nicht mehr', () => {
    const owner = makeOwner();
    const result = login(owner.email, 'test-passwort-mindestens-12', {});
    assert.equal(resolveSession(result.token)?.id, owner.id);
    logout(result.token);
    assert.equal(resolveSession(result.token), null);
  });

  test('Eine abgelaufene Sitzung wird abgelehnt', () => {
    const owner = makeOwner();
    const result = login(owner.email, 'test-passwort-mindestens-12', {});
    run(
      'UPDATE sessions SET expires_at = ? WHERE token_hash = ?',
      new Date(Date.now() - 1000).toISOString(),
      sha256(result.token),
    );
    assert.equal(resolveSession(result.token), null);
  });

  test('Rollenhierarchie: owner > editor > viewer', () => {
    const owner = { id: '1', email: 'o', role: 'owner' as const, displayName: 'O' };
    const editor = { id: '2', email: 'e', role: 'editor' as const, displayName: 'E' };
    const viewer = { id: '3', email: 'v', role: 'viewer' as const, displayName: 'V' };

    assert.equal(hasRole(owner, 'owner'), true);
    assert.equal(hasRole(editor, 'owner'), false);
    assert.equal(hasRole(editor, 'editor'), true);
    assert.equal(hasRole(viewer, 'editor'), false);
    assert.equal(hasRole(null, 'viewer'), false);

    assert.throws(() => requireRole(editor, 'owner'), (e: Error) => e instanceof AuthError && (e as AuthError).status === 403);
    assert.throws(() => requireRole(null, 'viewer'), (e: Error) => (e as AuthError).status === 401);
  });

  test('Die oeffentliche Konfiguration enthaelt keine Secrets', () => {
    const cfg = JSON.stringify(publicConfig());
    for (const forbidden of ['encryptionKey', 'sessionSecret', 'accessToken', 'password', 'apiKey']) {
      assert.ok(!cfg.toLowerCase().includes(forbidden.toLowerCase()), `publicConfig enthaelt ${forbidden}`);
    }
  });
});

describe('Medienrechte', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('security-media'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('Ein neu aufgenommenes Asset ist nicht veroeffentlichungsfaehig', () => {
    const asset = ingestAsset({
      source: 'test', sourceRef: 'a1', kind: 'image',
      url: 'https://example.invalid/a.jpg', tags: ['pkw'], searchText: 'Pkw', actor: 'test',
    });
    assert.equal(asset.consent_status, 'UNKNOWN');
    assert.equal(asset.rights_status, 'UNKNOWN');
    assert.equal(isPublishable(asset), false, 'Die blosse Existenz einer Datei ist keine Einwilligung.');
    assert.ok(publishBlockers(asset).length >= 2);
  });

  test('Eine abgelaufene Lizenz sperrt das Asset', () => {
    const owner = makeOwner();
    const asset = ingestAsset({
      source: 'test', sourceRef: 'a2', kind: 'image',
      url: 'https://example.invalid/b.jpg', tags: [], searchText: '', actor: 'test',
    });
    const cleared = setClearance({
      assetId: asset.id,
      consent: 'NOT_REQUIRED',
      rights: 'LICENSED',
      licence: 'Stockfoto',
      licenceExpiresAt: new Date(Date.now() - 86400_000).toISOString(),
      actorUserId: owner.id,
      actor: 'test',
    });
    assert.equal(isPublishable(cleared), false);
    assert.ok(publishBlockers(cleared).some((b) => /abgelaufen/i.test(b)));
  });

  test('Ein sichtbares Kennzeichen sperrt das Asset auch bei geklaerten Rechten', () => {
    const owner = makeOwner();
    const asset = ingestAsset({
      source: 'test', sourceRef: 'a3', kind: 'image',
      url: 'https://example.invalid/c.jpg', tags: [], searchText: '', actor: 'test',
    });
    const cleared = setClearance({
      assetId: asset.id,
      consent: 'NOT_REQUIRED',
      rights: 'OWNED',
      platesVisible: 'YES',
      actorUserId: owner.id,
      actor: 'test',
    });
    assert.equal(isPublishable(cleared), false);
    assert.ok(publishBlockers(cleared).some((b) => /Kennzeichen/i.test(b)));
  });

  test('Die automatische Vorpruefung erkennt Personenbezug', () => {
    const asset = ingestAsset({
      source: 'test', sourceRef: 'a4', kind: 'image',
      url: 'https://example.invalid/d.jpg',
      tags: ['fahrlehrer', 'portrait'],
      searchText: 'Fahrlehrer mit Schueler im Fahrzeug',
      actor: 'test',
    });
    const findings = autoPrivacyCheck(asset);
    assert.ok(findings.some((f) => f.code === 'PRIVACY_FACES' && f.blocking));
  });

  test('Die Suchanfrage wird nachvollziehbar interpretiert', () => {
    const q = parseMediaQuery('finde authentisches LKW-Material bei Nacht, nicht in den letzten 60 Tagen benutzt');
    assert.ok(q.terms.includes('lkw'), `Begriffe: ${q.terms.join(', ')}`);
    assert.ok(q.terms.includes('nacht'));
    assert.equal(q.unusedForDays, 60);
  });

  test('Ausschluesse werden erkannt', () => {
    const q = parseMediaQuery('saubere Fulda Aussenaufnahme ohne schueler');
    assert.ok(q.exclude.includes('schueler'), `Ausschluesse: ${q.exclude.join(', ')}`);
  });

  test('Typ und Ausrichtung werden erkannt', () => {
    const q = parseMediaQuery('hochkant video vom simulator');
    assert.equal(q.kind, 'video');
    assert.equal(q.orientation, 'portrait');
  });

  test('Die Suche liefert standardmaessig nur freigegebenes Material', () => {
    const owner = makeOwner();
    const asset = ingestAsset({
      source: 'test', sourceRef: 'a5', kind: 'video',
      url: 'https://example.invalid/e.mp4', width: 1080, height: 1920,
      tags: ['simulator'], searchText: 'Simulator Aufnahme', actor: 'test',
    });

    assert.equal(searchMediaNatural('simulator').hits.length, 0, 'Ungeklaertes Material darf nicht erscheinen.');
    assert.ok(searchMediaNatural('simulator', { onlyPublishable: false }).hits.length > 0);

    setClearance({
      assetId: asset.id, consent: 'NOT_REQUIRED', rights: 'OWNED',
      platesVisible: 'NO', minorsPresent: 'NO', actorUserId: owner.id, actor: 'test',
    });
    assert.ok(searchMediaNatural('simulator').hits.length > 0, 'Nach der Freigabe muss es erscheinen.');
  });

  test('Jeder Treffer traegt eine Begruendung', () => {
    const hits = searchMediaNatural('simulator').hits;
    assert.ok(hits.length > 0);
    assert.ok(hits[0].reasons.length > 0, 'Ein Treffer ohne Begruendung ist nicht erklaerbar.');
  });
});

describe('Unveraenderliches Protokoll', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('security-events'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('Ereignisse koennen nicht geaendert oder geloescht werden', () => {
    run(
      `INSERT INTO events (at, kind, severity, actor, message) VALUES (?,?,?,?,?)`,
      nowIso(), 'test.event', 'info', 'test', 'Testeintrag',
    );
    assert.throws(() => run(`UPDATE events SET message = 'manipuliert' WHERE kind = 'test.event'`), /unveraenderlich/i);
    assert.throws(() => run(`DELETE FROM events WHERE kind = 'test.event'`), /unveraenderlich/i);
  });

  test('Freigabe-Entscheidungen koennen nicht geloescht werden', () => {
    // Der Trigger feuert pro Zeile - es muss also wirklich eine Freigabe geben.
    const owner = makeOwner();
    const asset = publishableAsset(owner);
    const item = draftItem({ assetIds: [asset.id] });
    review(item.id, 'test');
    const card = buildApprovalCard(item.id);
    decide({
      itemId: item.id,
      decision: 'approve_once',
      userId: owner.id,
      userRole: 'owner',
      actor: 'test',
      seenHash: card.contentHash,
    });

    const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM approvals');
    assert.ok(Number(count?.n) > 0, 'Voraussetzung: mindestens eine Freigabe existiert.');

    assert.throws(
      () => run(`DELETE FROM approvals WHERE content_item_id = ?`, item.id),
      /nicht geloescht/i,
      'Eine getroffene Freigabeentscheidung muss unloeschbar sein (Widerruf statt Loeschung).',
    );

    // Der Widerruf ist der vorgesehene Weg und muss funktionieren.
    run('UPDATE approvals SET revoked_at = ?, revoked_reason = ? WHERE content_item_id = ?',
      nowIso(), 'Test-Widerruf', item.id);
    const revoked = get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM approvals WHERE content_item_id = ? AND revoked_at IS NOT NULL',
      item.id,
    );
    assert.equal(Number(revoked?.n), 1);
  });
});
