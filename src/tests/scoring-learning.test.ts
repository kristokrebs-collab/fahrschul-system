/**
 * Tests der Bewertung, der Experimente und der Aenderungssteuerung.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, seedMinimal, makeOwner, publishableAsset, draftItem } from './helpers.js';
import { viralityScore, businessImpactScore, normalize, computeAndStoreScores } from '../domain/analytics.js';
import { createExperiment, assign, analyze, conclude } from '../domain/experiments.js';
import { proposeChange, testProposal, applyProposal, rollbackProposal, runRegressionSuite, addBenchmarkExample } from '../domain/learning.js';
import { classify, ingestMessage } from '../domain/inbox.js';
import { activePrompt, promptVersions } from '../agents/prompts.js';
import { review } from '../agents/orchestrator.js';
import { run, get, nowIso } from '../db/index.js';

describe('Bewertung', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('scoring'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('Kennzahlen werden auf kanonische Namen abgebildet', () => {
    const m = normalize({ post_impressions: 500, post_impressions_unique: 300, saved: 12, likes: 40 });
    assert.equal(m.impressions, 500);
    assert.equal(m.reach, 300);
    assert.equal(m.saved, 12);
    assert.equal(m.replays, 200, 'Wiedergaben ergeben sich aus Impressionen minus Reichweite.');
  });

  test('Hohe Reichweite ohne Anfragen: Virality hoch, Business Impact niedrig', () => {
    const metrics = { reach: 100_000, impressions: 140_000, nonFollowerReach: 92_000, saved: 800, shares: 400 };
    const v = viralityScore(metrics, 1000);
    const b = businessImpactScore(metrics, { qualified: 0, appointments: 0, registrations: 0, revenueCents: null });

    assert.ok(v.score! > 60, `Virality sollte hoch sein, war ${v.score}`);
    assert.ok(b.score! < 15, `Business Impact sollte niedrig sein, war ${b.score}`);
    assert.match(b.summary, /keine einzige qualifizierte Anfrage/i,
      'Das System muss diesen Fall ausdruecklich benennen.');
  });

  test('Wenig Reichweite mit Anmeldung: Business Impact hoch', () => {
    const metrics = { reach: 400, impressions: 500, saved: 3 };
    const b = businessImpactScore(metrics, { qualified: 3, appointments: 2, registrations: 2, revenueCents: 400000 });
    assert.ok(b.score! > 55, `Business Impact sollte hoch sein, war ${b.score}`);
    assert.equal(b.confidence, 'high');
  });

  test('Fehlende Daten senken die Konfidenz statt heimlich den Wert', () => {
    const sparse = viralityScore({ reach: 1000 }, 1000);
    const full = viralityScore(
      { reach: 1000, nonFollowerReach: 600, saved: 20, shares: 10, avgWatchTimeS: 9, follows: 5 },
      1000,
    );
    assert.equal(sparse.confidence, 'low');
    assert.equal(full.confidence, 'high');
    assert.ok(sparse.components.some((c) => c.normalized === null));
  });

  test('Ohne jede Kennzahl gibt es keine Bewertung, keinen Nullwert', () => {
    const v = viralityScore({}, 1000);
    assert.equal(v.score, null);
    assert.equal(v.confidence, 'none');
  });

  test('Die beiden Bewertungen werden getrennt gespeichert', () => {
    const owner = makeOwner();
    const asset = publishableAsset(owner);
    const item = draftItem({ assetIds: [asset.id] });
    run(
      `INSERT INTO metric_snapshots (id, content_item_id, platform, window_key, collected_at, source, metrics_json)
       VALUES ('met_t', ?, 'sandbox', 't24h', ?, 'sandbox', ?)`,
      item.id, nowIso(),
      JSON.stringify({ canonical: { reach: 5000, saved: 50, shares: 20, nonFollowerReach: 4000 }, raw: {}, missing: [] }),
    );
    const scores = computeAndStoreScores(item.id, 't24h');
    assert.ok(scores.virality.score !== null);
    assert.ok(scores.business.score !== null);
    assert.notEqual(scores.virality.score, scores.business.score);
    assert.ok(scores.note, 'Sandbox-Kennzahlen muessen als solche gekennzeichnet werden.');
  });
});

describe('Experimente', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('experiments'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('Ein Sieger wird ohne Mindeststichprobe nicht ausgerufen', () => {
    const owner = makeOwner();
    const exp = createExperiment({
      name: 'Hook-Test',
      hypothesis: 'Ein Frage-Hook bindet laenger als eine Aussage.',
      variable: 'hook',
      variants: ['frage', 'aussage'],
      minSamplePerVariant: 5,
      actor: 'test',
    });

    // Nur zwei Beitraege - deutlich unter der Mindeststichprobe.
    for (let i = 0; i < 2; i++) {
      const asset = publishableAsset(owner);
      const item = draftItem({ assetIds: [asset.id] });
      assign(exp.id, item.id, 'test');
      run(
        `INSERT INTO scores (id, content_item_id, window_key, virality_score, business_score, computed_at)
         VALUES (?,?, 't7d', ?, ?, ?)`,
        `scr_${i}`, item.id, 50 + i * 30, 20 + i * 40, nowIso(),
      );
    }

    const analysis = analyze(exp.id);
    assert.equal(analysis.readyToConclude, false);
    assert.match(analysis.blockingReason ?? '', /Mindeststichprobe/i);
    assert.throws(() => conclude(exp.id, 'test'), /unseri/i);
  });

  test('Stoergroessen werden ungefragt benannt', () => {
    const owner = makeOwner();
    const exp = createExperiment({
      name: 'CTA-Test',
      hypothesis: 'Ein konkreter CTA bringt mehr Nachrichten.',
      variable: 'cta',
      variants: ['konkret', 'allgemein'],
      minSamplePerVariant: 2,
      actor: 'test',
    });

    // Beitraege mit stark unterschiedlichen Sendezeiten.
    const hours = [8, 22, 9, 23];
    for (let i = 0; i < 4; i++) {
      const asset = publishableAsset(owner);
      const item = draftItem({ assetIds: [asset.id] });
      const d = new Date();
      d.setHours(hours[i]);
      run('UPDATE content_items SET scheduled_for = ? WHERE id = ?', d.toISOString(), item.id);
      assign(exp.id, item.id, 'test');
      run(
        `INSERT INTO scores (id, content_item_id, window_key, virality_score, business_score, computed_at)
         VALUES (?,?, 't7d', ?, ?, ?)`,
        `scr_c${i}`, item.id, 40, 30 + i, nowIso(),
      );
    }

    const analysis = analyze(exp.id);
    assert.ok(
      analysis.confounders.some((c) => /Sendezeit/i.test(c)),
      `Sendezeit-Stoergroesse muss benannt werden. Gefunden: ${analysis.confounders.join(' | ')}`,
    );
  });

  test('Ein Vorsprung kleiner als die Streuung gilt als Rauschen', () => {
    const owner = makeOwner();
    const exp = createExperiment({
      name: 'Rauschtest',
      hypothesis: 'Variante A ist besser.',
      variable: 'cover',
      variants: ['a', 'b'],
      minSamplePerVariant: 2,
      actor: 'test',
    });
    // Grosse Streuung innerhalb der Gruppen, kleiner Unterschied dazwischen.
    const values = { a: [10, 90], b: [12, 86] };
    let i = 0;
    for (const [variant, scores] of Object.entries(values)) {
      for (const s of scores) {
        const asset = publishableAsset(owner);
        const item = draftItem({ assetIds: [asset.id] });
        run(
          `INSERT INTO experiment_assignments (id, experiment_id, content_item_id, variant, assigned_at)
           VALUES (?,?,?,?,?)`,
          `exa_r${i}`, exp.id, item.id, variant, nowIso(),
        );
        run(
          `INSERT INTO scores (id, content_item_id, window_key, virality_score, business_score, computed_at)
           VALUES (?,?, 't7d', 40, ?, ?)`,
          `scr_r${i}`, item.id, s, nowIso(),
        );
        i++;
      }
    }
    const analysis = analyze(exp.id);
    assert.match(analysis.verdict, /Rauschen/i, `Erwartet Rausch-Hinweis, war: ${analysis.verdict}`);
  });
});

describe('Aenderungssteuerung', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('governance'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('Ein Vorschlag zur Umgehung der Freigabe wird automatisch abgewiesen', () => {
    const p = proposeChange({
      title: 'Beitraege automatisch veroeffentlichen',
      rationale: 'Spart Zeit, wenn wir die Freigabe ueberspringen.',
      targetKind: 'rule',
      targetRef: 'approval_gate',
      currentValue: 'manuell',
      proposedValue: 'automatisch veroeffentlichen ohne Freigabe',
      evidence: {},
      actor: 'test',
    });
    assert.equal(p.risk_class, 'forbidden');
    assert.equal(p.state, 'rejected');
    assert.throws(() => testProposal(p.id, 'test'), /abgewiesen/i);
  });

  test('Ein Vorschlag zur Abschwaechung der Rechtepruefung wird abgewiesen', () => {
    const p = proposeChange({
      title: 'Medien ohne Einwilligung zulassen',
      rationale: 'Wir haben zu wenig freigegebenes Material.',
      targetKind: 'rule',
      targetRef: 'rights_gate',
      currentValue: 'streng',
      proposedValue: 'Assets ohne Einwilligung erlauben',
      evidence: {},
      actor: 'test',
    });
    assert.equal(p.risk_class, 'forbidden');
  });

  test('Ein zulaessiger Prompt-Vorschlag durchlaeuft Tests, Freigabe und Rollback', () => {
    const owner = makeOwner();

    addBenchmarkExample({
      label: 'strong', platform: 'instagram', format: 'reel',
      payload: {
        caption: 'Am Kreisverkehr in Fulda ordnen sich viele zu frueh ein. Wir ueben das vorher gemeinsam.',
        hookVariants: ['Kreisverkehr Fulda', 'Spurwahl', 'Vor der Pruefung'],
        altText: 'Blick auf einen Kreisverkehr in Fulda.',
        hashtags: ['#fahrschulekrebs', '#fulda'],
        cta: 'Schreib uns deine Wunschklasse.',
      },
      reason: 'Konkret und lokal.', actor: 'test',
    });
    addBenchmarkExample({
      label: 'weak', platform: 'instagram', format: 'reel',
      payload: {
        caption: 'Bestehensquote 98 %! Tauche ein in die Welt des Fahrens!',
        hookVariants: ['Heute moechten wir euch etwas zeigen'],
        altText: '', hashtags: ['#a', '#b', '#c', '#d', '#e', '#f'], cta: 'Jetzt!',
      },
      reason: 'Unbelegte Quote und Floskeln.', actor: 'test',
    });

    const before = activePrompt('reel_shorts_producer');
    const p = proposeChange({
      title: 'Produzenten-Prompt praeziser fassen',
      rationale: 'Die Hooks waren zuletzt zu aehnlich.',
      targetKind: 'prompt',
      targetRef: 'reel_shorts_producer',
      currentValue: before,
      proposedValue: `${before}\n\nZusatz: Die drei Hooks muessen inhaltlich verschieden sein.`,
      evidence: { observation: 'Drei Beitraege mit fast identischen Hooks' },
      actor: 'test',
    });
    assert.equal(p.risk_class, 'medium');
    assert.equal(p.state, 'proposed');

    const tested = testProposal(p.id, 'test');
    assert.equal(tested.passed, true, JSON.stringify(tested.results.filter((r) => !r.passed)));

    // Ohne bestandene Tests keine Anwendung - hier sind sie bestanden.
    applyProposal(p.id, owner.id, 'owner');
    assert.notEqual(activePrompt('reel_shorts_producer'), before, 'Der Prompt muss sich geaendert haben.');
    assert.ok(activePrompt('reel_shorts_producer').includes('inhaltlich verschieden'));

    rollbackProposal(p.id, 'owner');
    assert.equal(activePrompt('reel_shorts_producer'), before, 'Rollback muss die alte Fassung reaktivieren.');
    assert.ok(promptVersions('reel_shorts_producer').length >= 2, 'Beide Versionen bleiben erhalten.');
  });

  test('Ein Vorschlag ohne bestandene Tests kann nicht angewandt werden', () => {
    const owner = makeOwner();
    const p = proposeChange({
      title: 'Irgendeine Aenderung',
      rationale: 'Test',
      targetKind: 'schedule',
      targetRef: 'posting_times',
      currentValue: 'a',
      proposedValue: 'b',
      evidence: {},
      actor: 'test',
    });
    assert.throws(() => applyProposal(p.id, owner.id, 'owner'), /Tests bestanden|Zustand/i);
  });

  test('Die Regressionssuite prueft die Freigabe-Invariante mit', () => {
    const results = runRegressionSuite();
    const invariant = results.find((r) => r.name === 'invariant_approval_trigger');
    assert.ok(invariant, 'Die Suite muss den Freigabe-Trigger pruefen.');
    assert.equal(invariant!.passed, true);
  });
});

describe('Posteingang', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('inbox'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('erkennt eine hochwertige Anfrage', () => {
    const r = classify('Hallo, ich moechte mich fuer Klasse B anmelden. Wann ist der naechste Termin in Fulda?');
    assert.equal(r.classification, 'high_value_lead');
    assert.ok(r.leadScore >= 55);
  });

  test('priorisiert Sicherheit ueber kommerzielle Einordnung', () => {
    const r = classify('Es gab einen Unfall bei der Fahrstunde, was kostet die Reparatur?');
    assert.equal(r.classification, 'urgent_safety');
  });

  test('erkennt eine Beschwerde', () => {
    const r = classify('Ich bin sehr unzufrieden, der Fahrlehrer war unfreundlich.');
    assert.equal(r.classification, 'complaint');
  });

  test('erkennt Spam und setzt den Lead-Wert auf null', () => {
    const r = classify('Gratis Follower fuer dich! Investiere jetzt in Krypto, schreib mir bei WhatsApp +49123');
    assert.equal(r.classification, 'spam');
    assert.equal(r.leadScore, 0);
  });

  test('speichert den Absender nur gehasht', () => {
    const msg = ingestMessage({
      platform: 'sandbox',
      externalId: 'test-1',
      kind: 'dm',
      authorHandle: 'max.mustermann',
      body: 'Was kostet Klasse B in Fulda?',
      actor: 'test',
    });
    assert.ok(!msg.author_handle_hash.includes('max'), 'Der Handle darf nicht im Klartext gespeichert werden.');
    assert.ok(msg.author_handle_hash.length > 20);
  });

  test('legt zu einer hochwertigen Anfrage automatisch einen Lead an', () => {
    const msg = ingestMessage({
      platform: 'sandbox',
      externalId: 'test-2',
      kind: 'dm',
      authorHandle: 'interessent',
      body: 'Ich moechte mich fuer Klasse CE anmelden, wann ist der naechste Termin in Bad Hersfeld?',
      actor: 'test',
    });
    const lead = get<any>('SELECT * FROM leads WHERE message_id = ?', msg.id);
    assert.ok(lead, 'Zu einer hochwertigen Anfrage muss ein Lead entstehen.');
    assert.equal(lead.licence_class, 'CE');
    assert.equal(lead.location, 'Bad Hersfeld');
  });
});
