/**
 * Durchgehender Praxislauf ("vertical slice").
 *
 * Er beweist die geforderte Kette an echten Daten und echtem Code:
 *
 *   1. Grunddaten und Archivimport
 *   2. Ein Asset wird vom Inhaber freigegeben
 *   3. Themenrecherche -> Wochenplan -> Produktion
 *   4. Alle Pruefungen laufen; ein absichtlich schlechter Beitrag wird blockiert
 *   5. Der gute Beitrag wird vom Inhaber freigegeben
 *   6. Zustellung an das kontrollierte Testziel, Zustellpruefung
 *   7. Kennzahlen -> zwei getrennte Bewertungen
 *   8. Lead wird zugeordnet -> Business Impact steigt
 *   9. Postmortem und Lernbericht
 *
 * Der Lauf endet mit einer Zusammenfassung. Jeder Schritt, der nicht
 * funktioniert, laesst den Lauf mit Fehlercode enden.
 */
import { migrate, get, run, nowIso } from '../db/index.js';
import { seed } from './seed.js';
import { importHiggsfieldArchive } from './import-higgsfield.js';
import { createUser, login } from '../security/auth.js';
import { setClearance, searchMediaNatural } from '../domain/media.js';
import { researchOpportunities, buildWeeklyPlan, persistPlan } from '../agents/creative.js';
import { runProductionPipeline, review } from '../agents/orchestrator.js';
import {
  getContentItem,
  updateContentItem,
  createContentItem,
  computeContentHash,
} from '../domain/content.js';
import { buildApprovalCard, decide } from '../domain/approval.js';
import { enqueue, tick, listJobs } from '../queue/publisher.js';
import { ingestMetrics, computeAndStoreScores } from '../domain/analytics.js';
import { ingestMessage, updateLead } from '../domain/inbox.js';
import { runPostmortem, generateLearningReport, runRegressionSuite } from '../domain/learning.js';
import { createBackup } from './backup.js';

const OUT: string[] = [];
function step(n: string, detail: string) {
  const line = `  ${n.padEnd(58)} ${detail}`;
  OUT.push(line);
  process.stdout.write(`${line}\n`);
}
function fail(message: string): never {
  process.stderr.write(`\nFEHLGESCHLAGEN: ${message}\n`);
  process.exit(1);
}

export async function runE2E(): Promise<void> {
  process.stdout.write('\n=== Durchgehender Praxislauf ===\n\n');

  // 1 -------------------------------------------------------------------
  migrate();
  const seedResult = seed();
  step('1. Grunddaten', `${seedResult.facts} Marken-Tatsachen`);

  const archive = importHiggsfieldArchive('system:e2e');
  step('   Archivimport', `${archive.imported} neu, ${archive.flagged} zur Sichtung`);

  // Inhaber-Konto fuer den Lauf
  let owner = get<any>(`SELECT * FROM users WHERE role = 'owner' LIMIT 1`);
  if (!owner) {
    owner = createUser({
      email: 'e2e-owner@fahrschule-krebs.local',
      password: 'e2e-durchlauf-passwort-2026',
      role: 'owner',
      displayName: 'E2E Inhaber',
      actor: 'system:e2e',
    });
  }
  const session = login(owner.email, 'e2e-durchlauf-passwort-2026', {}) as any;
  step('   Anmeldung', `${session?.user?.role ?? owner.role} angemeldet`);

  // 2 -------------------------------------------------------------------
  const candidates = searchMediaNatural('lkw depot', { onlyPublishable: false, limit: 5 });
  if (candidates.hits.length === 0) fail('Kein Asset im Archiv gefunden.');
  const assetId = candidates.hits[0].asset.id;

  const beforeClearance = searchMediaNatural('lkw depot', { onlyPublishable: true, limit: 5 });
  if (beforeClearance.hits.length > 0) {
    fail('Ein Asset war ohne Rechteklaerung veroeffentlichungsfaehig. Das Rechte-Gate greift nicht.');
  }
  step('2. Rechte-Gate vor Freigabe', 'kein Asset veroeffentlichungsfaehig (korrekt)');

  const cleared = setClearance({
    assetId,
    consent: 'NOT_REQUIRED',
    rights: 'OWNED',
    licence: 'Eigenproduktion (synthetisch, Higgsfield)',
    platesVisible: 'NO',
    minorsPresent: 'NO',
    facesPresent: 'NO',
    note: 'Synthetisches Markenbild, keine Personen erkennbar. Freigegeben im E2E-Lauf.',
    actorUserId: owner.id,
    actor: 'e2e:owner',
  });
  if (cleared.review_status !== 'APPROVED') fail('Asset wurde nach Freigabe nicht APPROVED.');
  step('   Asset freigegeben', `${assetId} -> ${cleared.review_status}`);

  // 3 -------------------------------------------------------------------
  const research = await researchOpportunities(6, 'system:e2e');
  step('3. Themenrecherche', `${research.created} Chancen (${research.mode})`);

  const drafts = buildWeeklyPlan(3, 'system:e2e');
  const planIds = persistPlan(drafts, null, 'system:e2e');
  step('   Wochenplan', `${planIds.length} Positionen`);

  // 4 -------------------------------------------------------------------
  const pipeline = await runProductionPipeline(planIds[0], 'system:e2e');
  step(
    '4. Produktion + Pruefung',
    `${pipeline.review.blocking.length} blockierend, ${pipeline.review.warnings.length} Hinweise`,
  );

  // Ein absichtlich schlechter Beitrag muss blockiert werden.
  const bad = createContentItem({
    platform: 'instagram',
    accountId: get<any>(`SELECT id FROM platform_accounts WHERE platform='sandbox'`)?.id ?? null,
    format: 'reel',
    title: 'Absichtlich schlechter Testbeitrag',
    hookVariants: ['Heute moechten wir euch etwas zeigen'],
    script: 'Wir sind stolz darauf, Ihr Partner fuer Mobilitaet zu sein.',
    shotList: [],
    edl: [],
    onScreenText: [],
    subtitlesSrt: null,
    caption:
      'Wir sind stolz darauf, Ihr Partner fuer Mobilitaet zu sein! Mit einer Bestehensquote von 98 % ' +
      'bringen wir dich sicher ans Ziel. Tauche ein in die Welt des Fahrens! Markiere 3 Freunde!',
    altText: '',
    cta: 'Jetzt zuschlagen!',
    hashtags: ['#a', '#b', '#c', '#d', '#e', '#f', '#g'],
    storyFollowup: [],
    assetIds: [],
    actor: 'system:e2e',
  });
  const badReview = review(bad.id, 'system:e2e');
  if (badReview.passed) fail('Ein offensichtlich schlechter Beitrag hat alle Pruefungen bestanden.');
  const codes = badReview.blocking.map((b) => b.code);
  for (const expected of ['FACT_PASS_RATE', 'VOICE_AI_CLICHE', 'PLATFORM_TOO_MANY_HASHTAGS', 'A11Y_ALT_TEXT']) {
    if (!codes.includes(expected)) fail(`Erwarteter Blockiergrund ${expected} fehlt. Gefunden: ${codes.join(', ')}`);
  }
  step('   Schlechter Beitrag blockiert', `${codes.length} Gruende: ${codes.slice(0, 4).join(', ')}`);

  // 5 -------------------------------------------------------------------
  const sandboxAccount = get<any>(`SELECT id FROM platform_accounts WHERE platform = 'sandbox'`);
  run(`UPDATE platform_accounts SET status = 'connected' WHERE id = ?`, sandboxAccount.id);

  // Guten Beitrag auf das Testziel umstellen und sauber machen.
  updateContentItem(
    pipeline.itemId,
    {
      platform: 'sandbox',
      accountId: sandboxAccount.id,
      assetIds: [assetId],
      altText:
        'Dunkle Aufnahme eines Lkw-Fuehrerhauses auf dem Betriebshof, seitliches Licht auf Grill und Reifen.',
      caption:
        'Klasse CE in Fulda: Viele unterschaetzen, wie viel Zeit das Rangieren am Anfang frisst. ' +
        'Wir gehen mit dir die Standardsituationen auf dem Uebungsplatz durch, bevor du auf die Strasse gehst.\n\n' +
        'Schreib uns deine Wunschklasse und ob Fulda oder Bad Hersfeld besser passt.',
      cta: 'Schreib uns deine Wunschklasse und deinen Standort.',
      hashtags: ['#fahrschulekrebs', '#fulda', '#badhersfeld', '#klassece', '#lkwführerschein'],
      hookVariants: [
        'Rangieren mit dem Lkw sieht einfacher aus, als es ist.',
        'Was in der ersten CE-Stunde auf dem Uebungsplatz wirklich passiert.',
        'Der Fehler, den fast jeder CE-Anfaenger in Fulda macht.',
      ],
      subtitlesSrt:
        '1\n00:00:00,000 --> 00:00:03,000\nRangieren mit dem Lkw sieht einfacher aus, als es ist.\n\n' +
        '2\n00:00:03,000 --> 00:00:06,000\nWir gehen die Standardsituationen mit dir durch.\n',
    },
    'E2E: auf Testziel umgestellt und Text konkretisiert',
    'system:e2e',
  );
  const goodReview = review(pipeline.itemId, 'system:e2e');
  if (!goodReview.passed) {
    fail(`Der gute Beitrag wird blockiert: ${goodReview.blocking.map((b) => `${b.code}: ${b.message}`).join(' | ')}`);
  }
  step('5. Guter Beitrag', 'alle Pruefungen bestanden, wartet auf Freigabe');

  const card = buildApprovalCard(pipeline.itemId);
  if (!card.canApprove) fail(`Freigabekarte blockiert: ${card.blockingReasons.join(' | ')}`);
  if (card.accountIsPublic) fail('Das Testziel ist faelschlich als oeffentlich markiert.');

  // Beweis, dass eine Aenderung nach der Freigabe die Freigabe entwertet.
  const approvedOnce = decide({
    itemId: pipeline.itemId,
    decision: 'approve_once',
    userId: owner.id,
    userRole: 'owner',
    actor: 'e2e:owner',
    seenHash: card.contentHash,
  });
  if (approvedOnce.item.state !== 'approved') fail('Freigabe hat den Zustand nicht auf approved gesetzt.');

  const tamper = updateContentItem(
    pipeline.itemId,
    { caption: `${card.preview.caption}\n\nNachtraeglich geaenderter Satz.` },
    'E2E: Test der Hash-Bindung',
    'system:e2e',
  );
  if (!tamper.approvalInvalidated) fail('Eine Aenderung nach der Freigabe hat die Freigabe NICHT entwertet.');
  if (tamper.item.state !== 'awaiting_approval') fail('Zustand nach Aenderung ist nicht awaiting_approval.');
  step('   Hash-Bindung', 'Aenderung nach Freigabe hat die Freigabe korrekt entwertet');

  // Erneute Pruefung und erneute Freigabe.
  const reReview = review(pipeline.itemId, 'system:e2e');
  if (!reReview.passed) fail(`Nach der Aenderung blockiert: ${reReview.blocking.map((b) => b.code).join(', ')}`);
  const card2 = buildApprovalCard(pipeline.itemId);
  decide({
    itemId: pipeline.itemId,
    decision: 'publish_now',
    userId: owner.id,
    userRole: 'owner',
    actor: 'e2e:owner',
    seenHash: card2.contentHash,
    note: 'E2E-Freigabe auf das kontrollierte Testziel.',
  });
  step('   Erneute Freigabe', 'durch den Inhaber, publish_now');

  // 6 -------------------------------------------------------------------
  const job = enqueue(pipeline.itemId, 'e2e:owner', nowIso());
  const duplicate = enqueue(pipeline.itemId, 'e2e:owner', nowIso());
  if (duplicate.id !== job.id) fail('Idempotenz verletzt: zwei Jobs fuer dieselbe Freigabe.');
  step('6. Warteschlange', `Job ${job.id}, Doppelanlage korrekt verhindert`);

  await tick(5);
  await tick(5);
  const finished = listJobs({ limit: 5 }).find((j) => j.id === job.id);
  if (!finished) fail('Job nach dem Lauf nicht gefunden.');
  if (finished.state !== 'succeeded') {
    fail(`Job endete im Zustand "${finished.state}": ${finished.last_error ?? 'kein Fehler hinterlegt'}`);
  }
  if (!finished.verified_at) fail('Job gilt als erfolgreich, wurde aber nie beim Ziel geprueft.');
  step('   Zustellung + Pruefung', `${finished.state}, bestaetigt ${finished.verified_at?.slice(11, 19)}`);

  const publishedItem = getContentItem(pipeline.itemId)!;
  if (publishedItem.state !== 'published') fail(`Beitragszustand ist ${publishedItem.state}, erwartet published.`);

  // 7 -------------------------------------------------------------------
  const metrics = await ingestMetrics(pipeline.itemId, 't24h', 'system:e2e');
  const scoresBefore = computeAndStoreScores(pipeline.itemId, 't24h');
  step(
    '7. Kennzahlen',
    `Quelle ${metrics.source}, Reichweite ${metrics.metrics.reach ?? '-'}`,
  );
  step(
    '   Zwei getrennte Bewertungen',
    `Virality ${scoresBefore.virality.score} (${scoresBefore.virality.confidence}), ` +
      `Business ${scoresBefore.business.score} (${scoresBefore.business.confidence})`,
  );

  // 8 -------------------------------------------------------------------
  const message = ingestMessage({
    platform: 'sandbox',
    externalId: `e2e-${Date.now()}`,
    kind: 'dm',
    authorHandle: 'testperson',
    body: 'Hallo, ich moechte mich fuer Klasse CE anmelden. Wann ist der naechste Termin in Fulda? Was kostet das ungefaehr?',
    contentItemId: pipeline.itemId,
    actor: 'system:e2e',
  });
  if (message.classification !== 'high_value_lead') {
    fail(`Nachricht wurde als "${message.classification}" eingestuft, erwartet high_value_lead.`);
  }
  const lead = get<any>('SELECT * FROM leads WHERE message_id = ?', message.id);
  if (!lead) fail('Zu einer hochwertigen Anfrage wurde kein Lead angelegt.');
  updateLead(lead.id, { stage: 'registered', registered_at: nowIso(), revenue_cents: 289000 }, 'e2e:owner');

  const scoresAfter = computeAndStoreScores(pipeline.itemId, 't24h');
  if ((scoresAfter.business.score ?? 0) <= (scoresBefore.business.score ?? 0)) {
    fail('Eine Anmeldung mit Umsatz hat den Business Impact nicht erhoeht.');
  }
  step(
    '8. Lead-Zuordnung',
    `${message.classification}, Lead-Wert ${message.lead_score}; Business ${scoresBefore.business.score} -> ${scoresAfter.business.score}`,
  );

  // 9 -------------------------------------------------------------------
  const postmortem = runPostmortem(pipeline.itemId, 'system:e2e');
  step('9. Postmortem', `${postmortem.failureClass}: ${postmortem.smallestSafeChange.slice(0, 60)}...`);

  const regression = runRegressionSuite();
  const failed = regression.filter((r) => !r.passed);
  if (failed.length > 0) {
    fail(`Regressionstests fehlgeschlagen: ${failed.map((f) => `${f.name} - ${f.detail}`).join(' | ')}`);
  }
  step('   Regressionstests', `${regression.length} Tests bestanden`);

  const report = generateLearningReport('system:e2e', 7);
  step('   Lernbericht', `${report.markdown.split('\n').length} Zeilen`);

  const backup = createBackup();
  step('   Sicherung', `${(backup.bytes / 1024).toFixed(0)} kB, Pruefsumme ${backup.checksum.slice(0, 12)}`);

  process.stdout.write('\n=== Praxislauf vollstaendig bestanden ===\n');
  process.stdout.write(
    `\nBeitrag: ${pipeline.itemId}\nZustand: published (kontrolliertes Testziel, NICHT oeffentlich)\n` +
      `Virality: ${scoresAfter.virality.score} | Business Impact: ${scoresAfter.business.score}\n` +
      `Hinweis: ${scoresAfter.note ?? '-'}\n\n`,
  );
}

const invokedDirectly = process.argv[1]?.endsWith('e2e.js');
if (invokedDirectly) {
  runE2E().catch((err) => {
    process.stderr.write(`\nFEHLER: ${(err as Error).stack}\n`);
    process.exit(1);
  });
}
