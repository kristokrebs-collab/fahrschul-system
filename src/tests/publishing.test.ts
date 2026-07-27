/**
 * Tests der Veroeffentlichungs-Warteschlange:
 * Idempotenz, Wiederholung, Dead-Letter-Queue, Zustellpruefung, Erholung.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, seedMinimal, makeOwner, publishableAsset, draftItem } from './helpers.js';
import { review } from '../agents/orchestrator.js';
import { buildApprovalCard, decide } from '../domain/approval.js';
import { enqueue, tick, listJobs, requeueDeadLetter, recoverStaleJobs, queueStats } from '../queue/publisher.js';
import { updateContentItem, getContentItem } from '../domain/content.js';
import { setClearance } from '../domain/media.js';
import { run, get, nowIso } from '../db/index.js';
import { existsSync, readFileSync } from 'node:fs';

function approvedItem() {
  const owner = makeOwner();
  const asset = publishableAsset(owner);
  const item = draftItem({ assetIds: [asset.id] });
  review(item.id, 'test');
  const card = buildApprovalCard(item.id);
  assert.equal(card.canApprove, true, `Karte blockiert: ${card.blockingReasons.join(' | ')}`);
  decide({
    itemId: item.id,
    decision: 'approve_once',
    userId: owner.id,
    userRole: 'owner',
    actor: 'owner',
    seenHash: card.contentHash,
  });
  return { item, asset, owner };
}

describe('Warteschlange', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('publishing'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('Der komplette Weg bis zur bestaetigten Zustellung', async () => {
    const { item } = approvedItem();
    const job = enqueue(item.id, 'owner', nowIso());
    assert.equal(job.state, 'queued');

    await tick(5);

    const done = listJobs({ limit: 10 }).find((j) => j.id === job.id)!;
    assert.equal(done.state, 'succeeded', `Zustand ${done.state}: ${done.last_error}`);
    assert.ok(done.verified_at, 'Ein Job gilt erst als erfolgreich, wenn die Zustellung geprueft wurde.');
    assert.ok(done.external_post_id);
    assert.equal(getContentItem(item.id)!.state, 'published');

    // Die Sandbox-Ablage muss tatsaechlich existieren.
    const file = done.external_url!.replace('file://', '');
    assert.ok(existsSync(file), 'Die abgelegte Datei muss existieren.');
    const record = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(record.isPublic, false, 'Das Testziel muss als nicht-oeffentlich gekennzeichnet sein.');
  });

  test('Eine Aenderung zwischen Einplanung und Zustellung bricht den Job ab', async () => {
    const { item } = approvedItem();
    const job = enqueue(item.id, 'owner', new Date(Date.now() + 3600_000).toISOString());

    // Inhalt aendern, waehrend der Job wartet.
    updateContentItem(item.id, { caption: 'Kurzfristig geaenderter Text ueber Fulda.' }, 'Aenderung', 'test');

    // Faellig machen und laufen lassen.
    run(`UPDATE publish_jobs SET run_at = ? WHERE id = ?`, nowIso(), job.id);
    await tick(5);

    const after = listJobs({ limit: 20 }).find((j) => j.id === job.id)!;
    assert.equal(after.state, 'cancelled', 'Ein geaenderter Inhalt darf nicht gesendet werden.');
    assert.match(after.last_error ?? '', /geaendert/i);
    assert.equal(getContentItem(item.id)!.state, 'awaiting_approval');
  });

  test('Ein zurueckgezogenes Recht bricht einen wartenden Job ab', async () => {
    const { item, asset, owner } = approvedItem();
    const job = enqueue(item.id, 'owner', new Date(Date.now() + 3600_000).toISOString());

    setClearance({
      assetId: asset.id,
      consent: 'WITHDRAWN',
      rights: 'OWNED',
      actorUserId: owner.id,
      actor: 'owner',
    });

    run(`UPDATE publish_jobs SET run_at = ? WHERE id = ?`, nowIso(), job.id);
    await tick(5);

    const after = listJobs({ limit: 20 }).find((j) => j.id === job.id)!;
    assert.equal(after.state, 'cancelled');
    assert.match(after.last_error ?? '', /Einwilligung|Rechte/i);
  });

  test('Ein fehlkonfiguriertes Ziel landet sichtbar in der Dead-Letter-Queue', async () => {
    const { item } = approvedItem();

    // Konto auf eine Plattform ohne Zugangsdaten umhaengen.
    const igAccount = get<{ id: string }>(
      `SELECT id FROM platform_accounts WHERE platform = 'instagram' LIMIT 1`,
    ) ?? (() => {
      run(
        `INSERT INTO platform_accounts (id, platform, handle, display_name, is_public, status, created_at)
         VALUES ('acc_ig_test','instagram','test','Test',1,'connected',?)`,
        nowIso(),
      );
      return { id: 'acc_ig_test' };
    })();

    const job = enqueue(item.id, 'owner', nowIso());
    run(`UPDATE publish_jobs SET platform = 'instagram', account_id = ? WHERE id = ?`, igAccount.id, job.id);

    await tick(5);
    const after = listJobs({ limit: 20 }).find((j) => j.id === job.id)!;
    assert.equal(after.state, 'dead_letter', 'Fehlende Zugangsdaten sind nicht wiederholbar.');
    assert.match(after.last_error ?? '', /META_ACCESS_TOKEN|nicht gesetzt/i);
    assert.equal(after.last_error_class, 'missing_credentials');
    assert.equal(getContentItem(item.id)!.state, 'failed');

    // Ein Alarm muss offen sein.
    const alert = get<{ code: string }>(
      `SELECT code FROM system_alerts WHERE code = 'PUBLISH_DEAD_LETTER' AND acknowledged_at IS NULL`,
    );
    assert.ok(alert, 'Ein endgueltiger Fehlschlag muss einen Alarm erzeugen.');
  });

  test('Ein Job aus der Dead-Letter-Queue laesst sich nur mit gueltiger Freigabe erneut einreihen', () => {
    const dead = listJobs({ state: 'dead_letter', limit: 5 })[0];
    assert.ok(dead, 'Voraussetzung: ein Job in der Dead-Letter-Queue.');

    // Freigabe entwerten.
    updateContentItem(dead.content_item_id, { caption: 'Nachtraeglich geaendert in Fulda.' }, 'Aenderung', 'test');
    assert.throws(
      () => requeueDeadLetter(dead.id, 'owner'),
      /keine gueltige Freigabe/i,
      'Eine Wiederaufnahme darf das Freigabe-Gate nicht umgehen.',
    );
  });

  test('Verwaiste Jobs werden nach Worker-Abbruch wieder aufgenommen', () => {
    const { item } = approvedItem();
    const job = enqueue(item.id, 'owner', nowIso());

    // Simuliert einen abgestuerzten Worker.
    run(
      `UPDATE publish_jobs SET state = 'running', locked_by = 'tot', locked_at = ? WHERE id = ?`,
      new Date(Date.now() - 30 * 60_000).toISOString(),
      job.id,
    );

    const recovered = recoverStaleJobs();
    assert.ok(recovered >= 1);
    const after = listJobs({ limit: 20 }).find((j) => j.id === job.id)!;
    assert.equal(after.state, 'queued');
    assert.equal(after.locked_by, null);
  });

  test('Die Statistik zaehlt alle Zustaende', () => {
    const stats = queueStats();
    for (const key of ['queued', 'running', 'succeeded', 'dead_letter', 'cancelled']) {
      assert.equal(typeof stats[key], 'number', `Zustand ${key} fehlt in der Statistik.`);
    }
  });
});
