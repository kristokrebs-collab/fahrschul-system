/**
 * Tests der pruefenden Agenten.
 *
 * Diese Tests sind die Regressionssicherung fuer die Vetorechte. Faellt einer
 * um, kann Material an einer Schutzinstanz vorbei.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, seedMinimal, makeOwner, publishableAsset, draftItem } from './helpers.js';
import { brandVoiceGuardian, factVerifier, privacyReviewer, complianceReviewer, redTeamCritic } from '../agents/reviewers.js';
import { updateContentItem, getContentItem } from '../domain/content.js';
import { review } from '../agents/orchestrator.js';

function itemWith(patch: Record<string, unknown>) {
  const owner = makeOwner();
  const asset = publishableAsset(owner);
  const item = draftItem({ assetIds: [asset.id] });
  if (Object.keys(patch).length) {
    updateContentItem(item.id, patch, 'Testanpassung', 'test');
  }
  return getContentItem(item.id)!;
}

describe('Brand Voice Guardian', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('reviewers-voice'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('laesst einen konkreten, lokalen Beitrag durch', () => {
    const findings = brandVoiceGuardian(itemWith({}));
    assert.equal(findings.filter((f) => f.blocking).length, 0, JSON.stringify(findings.filter((f) => f.blocking)));
  });

  test('blockiert verbotene Formulierungen', () => {
    const findings = brandVoiceGuardian(itemWith({
      caption: 'Wir sind Ihr Partner fuer Mobilitaet in Fulda und begleiten dich zur Klasse B.',
    }));
    assert.ok(findings.some((f) => f.code === 'VOICE_FORBIDDEN_PHRASE' && f.blocking));
  });

  test('blockiert generisches KI-Marketing', () => {
    const findings = brandVoiceGuardian(itemWith({
      caption: 'Tauche ein in die Welt des Fahrens in Fulda! Auf das naechste Level mit Klasse B.',
    }));
    assert.ok(findings.some((f) => f.code === 'VOICE_AI_CLICHE' && f.blocking));
  });

  test('blockiert einen Beitrag ohne jedes markenspezifische Detail', () => {
    const findings = brandVoiceGuardian(itemWith({
      caption: 'Der Weg zum eigenen Auto beginnt mit einem Entschluss. Wir begleiten dich dabei gerne.',
      onScreenText: [],
      cta: 'Melde dich bei uns.',
      script: 'Wir freuen uns auf dich.',
    }));
    assert.ok(
      findings.some((f) => f.code === 'VOICE_GENERIC' && f.blocking),
      'Ein Beitrag, den jede Fahrschule posten koennte, muss blockiert werden.',
    );
  });

  test('erkennt Ortsbezug als markenspezifisch', () => {
    const findings = brandVoiceGuardian(itemWith({
      caption: 'Am Kreisverkehr in Bad Hersfeld ordnen sich viele zu frueh ein. Wir ueben das vorher.',
      onScreenText: [],
      script: 'Wir ueben das vorher gemeinsam.',
    }));
    assert.equal(findings.filter((f) => f.code === 'VOICE_GENERIC').length, 0);
    assert.ok(findings.some((f) => f.code === 'VOICE_SPECIFIC'));
  });
});

describe('Fact Verifier', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('reviewers-fact'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('blockiert eine unbelegte Bestehensquote', () => {
    const findings = factVerifier(itemWith({
      caption: 'In Fulda liegt unsere Bestehensquote bei 98 % - komm zu uns fuer Klasse B.',
    }));
    assert.ok(findings.some((f) => f.code === 'FACT_PASS_RATE' && f.blocking));
  });

  test('blockiert einen unbelegten Preis', () => {
    const findings = factVerifier(itemWith({
      caption: 'Klasse B in Fulda ab 1990 Euro. Melde dich jetzt.',
    }));
    assert.ok(findings.some((f) => f.code === 'FACT_PRICE' && f.blocking));
  });

  test('blockiert einen Superlativ', () => {
    const findings = factVerifier(itemWith({
      caption: 'Die beste Fahrschule in Fulda fuer Klasse B - wir ueben mit dir jede Strecke.',
    }));
    assert.ok(findings.some((f) => f.code === 'FACT_SUPERLATIVE' && f.blocking));
  });

  test('blockiert ein Garantieversprechen', () => {
    const findings = factVerifier(itemWith({
      caption: 'Bei uns in Fulda wirst du garantiert bestehen, versprochen.',
    }));
    assert.ok(findings.some((f) => f.code === 'FACT_GUARANTEE' && f.blocking));
  });

  test('blockiert eine unbestaetigte Mengenangabe, auch wenn sie in der Datenbank steht', () => {
    // "18 Fahrlehrer" ist als NEEDS_OWNER_CONFIRMATION hinterlegt, nicht VERIFIED.
    const findings = factVerifier(itemWith({
      caption: 'Unsere 18 Fahrlehrer in Fulda bringen dich sicher durch die Ausbildung.',
    }));
    assert.ok(
      findings.some((f) => f.code === 'FACT_COUNT' && f.blocking),
      'Eine nur recherchierte, nicht bestaetigte Zahl darf nicht durchgehen.',
    );
  });

  test('laesst einen Beitrag ohne Tatsachenbehauptung durch', () => {
    const findings = factVerifier(itemWith({}));
    assert.equal(findings.filter((f) => f.blocking).length, 0);
  });
});

describe('Privacy Reviewer', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('reviewers-privacy'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('blockiert ein Kennzeichen im Text', () => {
    const findings = privacyReviewer(itemWith({
      caption: 'Unser Fahrzeug FD-AB 123 steht bereit fuer deine Fahrstunde in Fulda.',
    }));
    assert.ok(findings.some((f) => f.code === 'PII_PLATE' && f.blocking));
  });

  test('blockiert einen Bezug zu Minderjaehrigen', () => {
    const findings = privacyReviewer(itemWith({
      caption: 'Unsere juengste Fahrschuelerin in Fulda ist 17 Jahre alt und macht BF17.',
    }));
    assert.ok(findings.some((f) => f.code === 'PII_MINOR' && f.blocking));
  });

  test('blockiert ein Item ohne Medium', () => {
    const owner = makeOwner();
    const item = draftItem({ assetIds: [] });
    const findings = privacyReviewer(getContentItem(item.id)!);
    assert.ok(findings.some((f) => f.code === 'RIGHTS_NO_ASSET' && f.blocking));
  });
});

describe('Platform Compliance Reviewer', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('reviewers-compliance'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('blockiert zu viele Hashtags auf Instagram', () => {
    const findings = complianceReviewer(itemWith({
      platform: 'instagram',
      hashtags: ['#a1', '#b2', '#c3', '#d4', '#e5', '#f6'],
    }));
    assert.ok(findings.some((f) => f.code === 'PLATFORM_TOO_MANY_HASHTAGS' && f.blocking));
  });

  test('blockiert fehlenden Alternativtext', () => {
    const findings = complianceReviewer(itemWith({ platform: 'instagram', altText: '' }));
    assert.ok(findings.some((f) => f.code === 'A11Y_ALT_TEXT' && f.blocking));
  });

  test('blockiert fehlende Untertitel bei Video', () => {
    const findings = complianceReviewer(itemWith({ platform: 'instagram', subtitlesSrt: null }));
    assert.ok(findings.some((f) => f.code === 'A11Y_SUBTITLES' && f.blocking));
  });

  test('blockiert Interaktions-Koeder', () => {
    const findings = complianceReviewer(itemWith({
      caption: 'Markiere 3 Freunde, die den Fuehrerschein in Fulda brauchen!',
    }));
    assert.ok(findings.some((f) => f.code === 'PLATFORM_ENGAGEMENT_BAIT' && f.blocking));
  });

  test('blockiert eine unbekannte Plattform', () => {
    const findings = complianceReviewer(itemWith({ platform: 'mystery' }));
    assert.ok(findings.some((f) => f.code === 'PLATFORM_UNKNOWN' && f.blocking));
  });
});

describe('Red-Team Critic', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('reviewers-redteam'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('erkennt Verharmlosung von Verkehrssicherheit', () => {
    const findings = redTeamCritic(itemWith({
      caption: 'An der Ampel in Fulda einfach mal Gas geben, ist kein Problem wenn keiner guckt.',
    }));
    assert.ok(findings.some((f) => f.code === 'RISK_SAFETY_TRIVIALIZED'));
  });

  test('erkennt Spott ueber Fahrschueler', () => {
    const findings = redTeamCritic(itemWith({
      caption: 'Diese Einparkversuche in Fulda waren echt peinlich, der Lachnummer des Tages.',
    }));
    assert.ok(findings.some((f) => f.code === 'RISK_LEARNER_MOCKERY'));
  });

  test('erkennt vergleichende Aussagen ueber Mitbewerber', () => {
    const findings = redTeamCritic(itemWith({
      caption: 'Andere Fahrschulen in Fulda lassen dich warten - bei uns geht es sofort los.',
    }));
    assert.ok(findings.some((f) => f.code === 'RISK_COMPETITOR'));
  });

  test('warnt bei abgenutztem Hook, blockiert aber nicht', () => {
    const findings = redTeamCritic(itemWith({
      hookVariants: ['Heute moechten wir euch etwas zeigen', 'Zweite Variante', 'Dritte Variante'],
    }));
    const weak = findings.find((f) => f.code === 'CRIT_WEAK_HOOK');
    assert.ok(weak);
    assert.equal(weak!.blocking, false, 'Der Red-Team Critic hat kein Vetorecht.');
  });
});

describe('Orchestrator', () => {
  let ctx: ReturnType<typeof withTestDb>;
  before(() => { ctx = withTestDb('reviewers-orchestrator'); seedMinimal(); });
  after(() => ctx.cleanup());

  test('Ein Befund des Red-Team Critic blockiert nicht', () => {
    const owner = makeOwner();
    const asset = publishableAsset(owner);
    const item = draftItem({ assetIds: [asset.id] });
    updateContentItem(item.id, {
      hookVariants: ['Heute moechten wir euch etwas zeigen', 'B', 'C'],
    }, 'Schwacher Hook', 'test');

    const result = review(item.id, 'test');
    assert.equal(result.passed, true, 'Ein nicht-vetoberechtigter Agent darf die Freigabe nicht verhindern.');
    assert.ok(result.warnings.some((w) => w.code === 'CRIT_WEAK_HOOK'));
  });

  test('Eine Korrektur loest die Blockade auf', () => {
    const owner = makeOwner();
    const asset = publishableAsset(owner);
    const item = draftItem({ assetIds: [asset.id] });

    updateContentItem(item.id, { caption: 'Bestehensquote 99 % in Fulda!' }, 'Fehlerhaft', 'test');
    assert.equal(review(item.id, 'test').passed, false);

    updateContentItem(item.id, {
      caption: 'Klasse CE in Fulda: Rangieren ueben wir auf dem Uebungsplatz, bevor du auf die Strasse gehst.',
    }, 'Korrigiert', 'test');
    const after = review(item.id, 'test');
    assert.equal(after.passed, true, JSON.stringify(after.blocking));
  });
});
