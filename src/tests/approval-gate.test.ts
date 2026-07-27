/**
 * Tests des Freigabe-Gates.
 *
 * Das ist die wichtigste Invariante des Systems: nichts wird ohne
 * ausdrueckliche Freigabe des Inhabers oeffentlich, und eine Freigabe gilt
 * nur fuer genau den Inhalt, der freigegeben wurde.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, seedMinimal, makeOwner, makeEditor, publishableAsset, draftItem } from './helpers.js';
import { decide, buildApprovalCard, validApproval, ApprovalError, revokeApproval } from '../domain/approval.js';
import { updateContentItem, getContentItem, computeContentHash, setState } from '../domain/content.js';
import { enqueue, QueueError } from '../queue/publisher.js';
import { review } from '../agents/orchestrator.js';
import { setClearance } from '../domain/media.js';
import { run, get } from '../db/index.js';

describe('Freigabe-Gate', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => {
    ctx = withTestDb('approval-gate');
    seedMinimal();
  });
  after(() => ctx.cleanup());

  test('Ein Beitrag ohne Freigabe kann nicht in die Warteschlange', () => {
    const owner = makeOwner();
    const asset = publishableAsset(owner);
    const item = draftItem({ assetIds: [asset.id] });
    review(item.id, 'test');

    assert.throws(
      () => enqueue(item.id, 'test'),
      (err: Error) => err instanceof QueueError && /keine gueltige Freigabe/i.test(err.message),
      'Ein unfreigegebener Beitrag darf nicht eingereiht werden.',
    );
  });

  test('Der Datenbank-Trigger blockiert auch bei umgangener Anwendungsschicht', () => {
    const owner = makeOwner();
    const asset = publishableAsset(owner);
    const item = draftItem({ assetIds: [asset.id] });
    review(item.id, 'test');

    // Bewusst am Servicecode vorbei direkt in die Tabelle schreiben.
    assert.throws(
      () =>
        run(
          `INSERT INTO publish_jobs
            (id, content_item_id, approval_id, platform, account_id, idempotency_key, approved_hash,
             state, run_at, created_at, updated_at)
           VALUES ('job_hack', ?, 'apr_nonexistent', 'sandbox', ?, 'key_hack', ?, 'queued', ?, ?, ?)`,
          item.id,
          ctx.accountId,
          item.content_hash,
          new Date().toISOString(),
          new Date().toISOString(),
          new Date().toISOString(),
        ),
      /nicht freigegeben|keine gueltige Freigabe/i,
      'Der DB-Trigger muss einen Job ohne Freigabe ablehnen.',
    );
  });

  test('Nur der Inhaber darf freigeben, ein Editor nicht', () => {
    const owner = makeOwner();
    const editor = makeEditor();
    const asset = publishableAsset(owner);
    const item = draftItem({ assetIds: [asset.id] });
    review(item.id, 'test');
    const card = buildApprovalCard(item.id);

    assert.throws(
      () =>
        decide({
          itemId: item.id,
          decision: 'approve_once',
          userId: editor.id,
          userRole: 'editor',
          actor: 'editor',
          seenHash: card.contentHash,
        }),
      (err: Error) => err instanceof ApprovalError && (err as ApprovalError).code === 'FORBIDDEN_ROLE',
    );

    // Der Inhaber darf.
    const result = decide({
      itemId: item.id,
      decision: 'approve_once',
      userId: owner.id,
      userRole: 'owner',
      actor: 'owner',
      seenHash: card.contentHash,
    });
    assert.equal(result.item.state, 'approved');
  });

  test('Eine Aenderung nach der Freigabe entwertet die Freigabe', () => {
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
      actor: 'owner',
      seenHash: card.contentHash,
    });
    assert.ok(validApproval(item.id), 'Direkt nach der Freigabe muss sie gueltig sein.');

    const updated = updateContentItem(item.id, { caption: 'Voellig anderer Text ueber Fulda.' }, 'Test', 'test');
    assert.equal(updated.hashChanged, true);
    assert.equal(updated.approvalInvalidated, true);
    assert.equal(updated.item.state, 'awaiting_approval');
    assert.equal(validApproval(item.id), undefined, 'Nach der Aenderung darf keine gueltige Freigabe mehr existieren.');
  });

  test('Eine nicht veroeffentlichungsrelevante Aenderung entwertet die Freigabe NICHT', () => {
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
      actor: 'owner',
      seenHash: card.contentHash,
    });

    // Shotlist ist interne Produktionsinformation und aendert nichts am Ergebnis.
    const updated = updateContentItem(item.id, { shotList: [{ t: '0-2s', shot: 'Neu' }] }, 'Interne Notiz', 'test');
    assert.equal(updated.hashChanged, false, 'Interne Felder duerfen den Hash nicht aendern.');
    assert.equal(updated.approvalInvalidated, false);
    assert.ok(validApproval(item.id), 'Die Freigabe muss weiterhin gelten.');
  });

  test('Eine veraltete Freigabekarte wird abgelehnt', () => {
    const owner = makeOwner();
    const asset = publishableAsset(owner);
    const item = draftItem({ assetIds: [asset.id] });
    review(item.id, 'test');
    const card = buildApprovalCard(item.id);

    // Jemand anderes aendert den Inhalt, waehrend die Karte offen ist.
    updateContentItem(item.id, { caption: 'Parallel geaendert in Bad Hersfeld.' }, 'Parallel', 'jemand');
    review(item.id, 'test');

    assert.throws(
      () =>
        decide({
          itemId: item.id,
          decision: 'approve_once',
          userId: owner.id,
          userRole: 'owner',
          actor: 'owner',
          seenHash: card.contentHash, // veralteter Hash
        }),
      (err: Error) => err instanceof ApprovalError && (err as ApprovalError).code === 'STALE_VIEW',
    );
  });

  test('Ein zurueckgezogenes Nutzungsrecht stoppt einen bereits freigegebenen Beitrag', () => {
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
      actor: 'owner',
      seenHash: card.contentHash,
    });

    // Einwilligung wird zurueckgezogen.
    setClearance({
      assetId: asset.id,
      consent: 'WITHDRAWN',
      rights: 'OWNED',
      actorUserId: owner.id,
      actor: 'owner',
    });

    const recheck = review(item.id, 'test');
    assert.equal(recheck.passed, false, 'Nach Widerruf der Einwilligung darf die Pruefung nicht bestehen.');
    assert.ok(
      recheck.blocking.some((b) => b.code === 'RIGHTS_ASSET'),
      'Es muss ein Rechte-Befund erscheinen.',
    );

    const card2 = buildApprovalCard(item.id);
    assert.equal(card2.canApprove, false);
  });

  test('Idempotenz: zwei Einreihungen derselben Freigabe erzeugen einen Job', () => {
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
      actor: 'owner',
      seenHash: card.contentHash,
    });

    const a = enqueue(item.id, 'owner');
    const b = enqueue(item.id, 'owner');
    assert.equal(a.id, b.id, 'Dieselbe Freigabe darf nur einen Job erzeugen.');

    const count = get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM publish_jobs WHERE content_item_id = ?',
      item.id,
    );
    assert.equal(Number(count?.n), 1);
  });

  test('Ein Widerruf setzt einen eingeplanten Beitrag zurueck', () => {
    const owner = makeOwner();
    const asset = publishableAsset(owner);
    const item = draftItem({ assetIds: [asset.id] });
    review(item.id, 'test');
    const card = buildApprovalCard(item.id);
    decide({
      itemId: item.id,
      decision: 'schedule',
      userId: owner.id,
      userRole: 'owner',
      actor: 'owner',
      seenHash: card.contentHash,
      scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
    });
    assert.equal(getContentItem(item.id)!.state, 'scheduled');

    revokeApproval(item.id, 'Inhaber hat es sich anders ueberlegt', 'owner');
    assert.equal(getContentItem(item.id)!.state, 'awaiting_approval');
    assert.equal(validApproval(item.id), undefined);
  });

  test('Der Hash deckt genau die veroeffentlichungsrelevanten Felder ab', () => {
    const owner = makeOwner();
    const asset = publishableAsset(owner);
    const item = draftItem({ assetIds: [asset.id] });

    const before = computeContentHash(getContentItem(item.id)!);

    // Plattformwechsel muss den Hash aendern.
    updateContentItem(item.id, { platform: 'facebook' }, 'Plattformwechsel', 'test');
    assert.notEqual(computeContentHash(getContentItem(item.id)!), before);

    // Zurueck: gleicher Inhalt, gleicher Hash - der Hash ist stabil.
    updateContentItem(item.id, { platform: 'sandbox' }, 'Zurueck', 'test');
    assert.equal(computeContentHash(getContentItem(item.id)!), before);
  });
});
