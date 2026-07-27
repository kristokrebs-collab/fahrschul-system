/**
 * Grunddaten.
 *
 * Die Trennung der Verifikationsstatus ist bewusst und wichtig:
 *
 *  VERIFIED                  - stammt direkt aus dem Auftrag des Inhabers.
 *  NEEDS_OWNER_CONFIRMATION  - aus oeffentlich zugaenglichen Quellen recherchiert.
 *                              Plausibel, aber vom Inhaber nicht bestaetigt.
 *                              Diese Angaben duerfen NICHT in Beitraegen
 *                              behauptet werden, solange der Status steht.
 *
 * Es ist kein Versehen, dass die Zahl der Fahrlehrer und das Gruendungsjahr
 * unbestaetigt sind. Genau solche Zahlen landen sonst ungeprueft in einem
 * Beitrag.
 */
import { migrate, run, get, nowIso } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { upsertFact, addPhrase, publishBrandVoice, activeBrandVoice } from '../domain/brand.js';
import { ensureDefaultPrompts } from '../agents/prompts.js';
import { ensureAccount } from '../integrations/registry.js';
import { addBenchmarkExample } from '../domain/learning.js';
import { setFollowerBase } from '../domain/analytics.js';
import { log } from '../observability/logger.js';

const ACTOR = 'system:seed';

const FACTS: {
  category: string;
  key: string;
  value: string;
  status: 'VERIFIED' | 'NEEDS_OWNER_CONFIRMATION';
  source: string;
  sourceUrl?: string;
  notes?: string;
}[] = [
  // --- Aus dem Auftrag des Inhabers -----------------------------------
  { category: 'unternehmen', key: 'name', value: 'Fahrschule Krebs GmbH', status: 'VERIFIED', source: 'Auftrag des Inhabers' },
  { category: 'standort', key: 'hauptregion', value: 'Fulda', status: 'VERIFIED', source: 'Auftrag des Inhabers' },
  { category: 'standort', key: 'zweitstandort', value: 'Bad Hersfeld', status: 'VERIFIED', source: 'Auftrag des Inhabers' },
  { category: 'angebot', key: 'kern', value: 'Fahrausbildung in mehreren Fuehrerscheinklassen: Pkw, Motorrad, Lkw, Bus, Berufskraftfahrer-Qualifikation, Seminare', status: 'VERIFIED', source: 'Auftrag des Inhabers' },
  { category: 'sprache', key: 'primaer', value: 'Deutsch', status: 'VERIFIED', source: 'Auftrag des Inhabers' },
  { category: 'ziel', key: 'geografisch', value: 'Organische Aufmerksamkeit und lokale Nachfrage in Fulda und Bad Hersfeld dominieren, bevor weiter expandiert wird', status: 'VERIFIED', source: 'Auftrag des Inhabers' },

  // --- Recherchiert, unbestaetigt --------------------------------------
  { category: 'standort', key: 'adresse_fulda', value: 'Am Bahnhof 3, 36037 Fulda', status: 'NEEDS_OWNER_CONFIRMATION', source: 'Oeffentliche Verzeichnisse (Websuche)', notes: 'Vor jeder Nennung in einem Beitrag bestaetigen.' },
  { category: 'standort', key: 'adresse_bad_hersfeld', value: 'Bahnhofstr. 20, 36251 Bad Hersfeld', status: 'NEEDS_OWNER_CONFIRMATION', source: 'Oeffentliche Verzeichnisse (Websuche)' },
  { category: 'unternehmen', key: 'gruendung', value: 'Gegruendet 1965 von Guenter Krebs', status: 'NEEDS_OWNER_CONFIRMATION', source: 'Oeffentliche Verzeichnisse (Websuche)', notes: 'Jahreszahl und Person unbedingt bestaetigen lassen, bevor sie in einem Beitrag auftaucht.' },
  { category: 'team', key: 'anzahl_fahrlehrer', value: '18 Fahrlehrerinnen und Fahrlehrer', status: 'NEEDS_OWNER_CONFIRMATION', source: 'Oeffentliche Verzeichnisse (Websuche)', notes: 'Personalzahlen aendern sich. Ohne Bestaetigung nicht verwenden.' },
  { category: 'angebot', key: 'klassen_detail', value: 'Ausbildung fuer Motorrad, Pkw, Lkw, Bus, Traktor und Anhaenger', status: 'NEEDS_OWNER_CONFIRMATION', source: 'Oeffentliche Verzeichnisse (Websuche)' },
  { category: 'angebot', key: 'intensivkurse', value: 'Strukturierte Intensivkurse in Theorie und/oder Praxis', status: 'NEEDS_OWNER_CONFIRMATION', source: 'Oeffentliche Verzeichnisse (Websuche)' },
  { category: 'kanal', key: 'instagram', value: '@fahrschulekrebs', status: 'NEEDS_OWNER_CONFIRMATION', source: 'Oeffentliche Verzeichnisse (Websuche)' },
  { category: 'kanal', key: 'facebook', value: 'facebook.com/fahrschulekrebs', status: 'NEEDS_OWNER_CONFIRMATION', source: 'Oeffentliche Verzeichnisse (Websuche)' },

  // --- Ausdruecklich offene Punkte -------------------------------------
  { category: 'differenzierung', key: 'simulator', value: 'Simulatortraining vorhanden', status: 'NEEDS_OWNER_CONFIRMATION', source: 'Aus dem Auftrag als "zu pruefen" uebernommen' },
  { category: 'differenzierung', key: 'behindertengerecht', value: 'Behindertengerechte Fahrausbildung', status: 'NEEDS_OWNER_CONFIRMATION', source: 'Aus dem Auftrag als "zu pruefen" uebernommen' },
  { category: 'differenzierung', key: 'fuhrpark', value: 'Umfangreicher Fuhrpark', status: 'NEEDS_OWNER_CONFIRMATION', source: 'Aus dem Auftrag als "zu pruefen" uebernommen', notes: 'Ohne konkrete Fahrzeugzahl bleibt das eine Behauptung.' },
  { category: 'differenzierung', key: 'digitale_lerninhalte', value: 'Digitale Lerninhalte fuer die Theorie', status: 'NEEDS_OWNER_CONFIRMATION', source: 'Aus dem Auftrag als "zu pruefen" uebernommen' },
];

const PILLARS: { key: string; name: string; description: string; share: number }[] = [
  { key: 'ablauf', name: 'Ablauf und Erwartung', description: 'Was in Theorie, erster Fahrstunde, Sonderfahrt und Pruefung konkret passiert - Schritt fuer Schritt, ohne Beschoenigung.', share: 0.2 },
  { key: 'einwaende', name: 'Einwaende aufloesen', description: 'Die Gruende, aus denen Menschen den Start aufschieben: Angst, Zeit, Kosten, schlechte Erfahrungen anderer.', share: 0.18 },
  { key: 'klassen', name: 'Fuehrerscheinklassen', description: 'Welche Klasse fuer welchen Bedarf, mit ihren echten Voraussetzungen und Unterschieden.', share: 0.15 },
  { key: 'beruf', name: 'Berufskraftfahrer und Betriebe', description: 'Lkw, Bus, Weiterbildung, Betriebe als Auftraggeber - eine eigene Zielgruppe mit eigener Sprache.', share: 0.12 },
  { key: 'lokal', name: 'Fulda und Bad Hersfeld', description: 'Kreuzungen, Strecken, Pruefgebiete, Stadtverkehr - Ortskenntnis, die kein ueberregionaler Anbieter hat.', share: 0.12 },
  { key: 'technik', name: 'Technik und Simulator', description: 'Simulator, digitale Lerninhalte, Fahrzeugtechnik - sofern vom Inhaber bestaetigt.', share: 0.08 },
  { key: 'menschen', name: 'Menschen im Betrieb', description: 'Fahrlehrerinnen und Fahrlehrer, Arbeitsalltag, Haltung zur Verkehrssicherheit. Nur mit dokumentierter Einwilligung.', share: 0.09 },
  { key: 'angebot', name: 'Angebot und Anmeldung', description: 'Direkte Beitraege mit klarem Handlungsaufruf. Bewusst der kleinste Anteil.', share: 0.06 },
];

const SEGMENTS: { key: string; name: string; description: string; objections: string[] }[] = [
  {
    key: 'fahranfaenger',
    name: 'Jugendliche und junge Erwachsene',
    description: 'Erstfuehrerschein Klasse B oder BF17, meist zwischen 16 und 21, entscheiden im Freundeskreis.',
    objections: [
      'Ich habe Angst vor der ersten Fahrstunde',
      'Was, wenn ich durch die Theoriepruefung falle',
      'Wie lange dauert das insgesamt',
      'Ich weiss nicht, was am Ende wirklich zusammenkommt',
    ],
  },
  {
    key: 'eltern',
    name: 'Eltern',
    description: 'Zahlen oft mit, entscheiden mit, achten auf Sicherheit und Verlaesslichkeit statt auf den Preis.',
    objections: [
      'Faehrt mein Kind danach wirklich sicher',
      'Werden die Kosten am Ende viel hoeher als geplant',
      'Bekommt mein Kind regelmaessig Termine oder zieht sich das ewig',
    ],
  },
  {
    key: 'quereinsteiger',
    name: 'Berufliche Quereinsteiger',
    description: 'Erwachsene, die spaeter anfangen oder eine zusaetzliche Klasse fuer den Beruf brauchen.',
    objections: [
      'Bin ich mit Mitte 30 zu spaet dran',
      'Ich kann nur abends oder samstags',
      'Ich hatte schon mal eine Fahrschule und es lief schlecht',
    ],
  },
  {
    key: 'berufskraftfahrer',
    name: 'Berufskraftfahrer',
    description: 'Lkw, Bus, Weiterbildungspflicht, oft mit Zeitdruck und klarer Kostenrechnung.',
    objections: [
      'Wie schnell bekomme ich die Klasse',
      'Passt das neben Schichtdienst',
      'Uebernimmt mein Arbeitgeber das',
    ],
  },
  {
    key: 'betriebe',
    name: 'Betriebe und Fuhrparks',
    description: 'Unternehmen, die mehrere Mitarbeitende ausbilden oder weiterbilden lassen.',
    objections: [
      'Koennt ihr mehrere Leute gleichzeitig nehmen',
      'Wie planbar sind die Termine',
      'Bekomme ich eine saubere Abrechnung',
    ],
  },
  {
    key: 'motorrad',
    name: 'Motorradfahrerinnen und -fahrer',
    description: 'Klasse A/A2/A1 oder Aufstieg, oft saisonal im Fruehjahr.',
    objections: [
      'Lohnt sich der Aufstieg von A2 auf A',
      'Wie viele Sonderfahrten brauche ich wirklich',
      'Startet ihr im Fruehjahr rechtzeitig',
    ],
  },
  {
    key: 'adaptiert',
    name: 'Menschen mit Anpassungsbedarf',
    description: 'Fahrausbildung mit angepasster Technik oder besonderem Betreuungsbedarf.',
    objections: [
      'Habt ihr ein passend umgebautes Fahrzeug',
      'Kennt ihr euch mit dem Gutachten aus',
      'Nehmt ihr euch die Zeit, die ich brauche',
    ],
  },
];

const BRAND_VOICE = `# Brand Voice - Fahrschule Krebs GmbH

## Wer spricht
Ein erfahrener Fahrlehrer aus Osthessen, der schon alles gesehen hat und trotzdem
jeden Anfaenger ernst nimmt. Er redet nicht wie eine Werbeagentur und nicht wie
ein Behoerdenschreiben.

## Tonlage
- **Direkt statt geschwollen.** "So laeuft die erste Fahrstunde ab" statt
  "Wir begleiten Sie auf Ihrer individuellen Mobilitaetsreise".
- **Konkret statt allgemein.** Eine benannte Kreuzung schlaegt zehn Adjektive.
- **Ruhig statt laut.** Keine Ausrufezeichen-Ketten, keine Versalien.
- **Gelegentlich trocken humorvoll.** Nie auf Kosten von Fahrschuelern.
- **Sicherheit ist nicht verhandelbar.** Kein Augenzwinkern bei Regelverstoessen.

## Was wir nie tun
- Zahlen erfinden. Keine Bestehensquote, kein Preis, keine Kundenzahl ohne Beleg.
- Ueber Mitbewerber reden.
- Kuenstliche Verknappung erzeugen ("nur noch heute").
- Menschen zeigen, die dem nicht ausdruecklich zugestimmt haben.
- Uebersetztes Englisch schreiben ("macht Sinn", "am Ende des Tages").

## Woran ein guter Beitrag zu erkennen ist
Er enthaelt mindestens ein Detail, das nur zu uns passt: eine Strecke in Fulda,
eine konkrete Klasse, eine Situation aus unserem Alltag. Koennte ihn jede
beliebige Fahrschule unveraendert posten, ist er wertlos - egal wie huebsch er aussieht.

## Handlungsaufruf
Wir fragen nach etwas Konkretem: Wunschklasse, Standort, Wunschzeitraum.
"Schreib uns" allein reicht nicht - es macht die Antwort fuer beide Seiten teuer.

## Visuelle Regeln
Dunkle, ruhige Bildsprache. Ein einziges Farbsignal in Crimson (#E11D48), immer
als Licht aus einer echten Quelle, nie als Farbflaeche. Kein CGI-Look, keine
Neon-Aesthetik, keine ueberladenen Overlays. Hochkant fuer Reels und Stories.

## Lokale Begriffe
"Fahrstunde" (nicht "Session"), "Theorieunterricht" (nicht "Theorie-Class"),
"Pruefung" (nicht "Test"), "Fahrschueler" (nicht "Kunde") im redaktionellen Text.
`;

function seedPillarsAndSegments(): void {
  for (const p of PILLARS) {
    run(
      `INSERT INTO content_pillars (id, pillar_key, name, description, target_share, active)
       VALUES (?,?,?,?,?,1)
       ON CONFLICT(pillar_key) DO UPDATE SET
         name = excluded.name, description = excluded.description, target_share = excluded.target_share`,
      newId('pil'),
      p.key,
      p.name,
      p.description,
      p.share,
    );
  }
  for (const s of SEGMENTS) {
    run(
      `INSERT INTO audience_segments (id, segment_key, name, description, objections_json, active)
       VALUES (?,?,?,?,?,1)
       ON CONFLICT(segment_key) DO UPDATE SET
         name = excluded.name, description = excluded.description, objections_json = excluded.objections_json`,
      newId('seg'),
      s.key,
      s.name,
      s.description,
      JSON.stringify(s.objections),
    );
  }
}

const ONBOARDING_QUESTIONS: { key: string; question: string }[] = [
  { key: 'gruendung', question: 'In welchem Jahr wurde die Fahrschule gegruendet, und von wem? Bitte nur bestaetigen, was Sie belegen koennen.' },
  { key: 'fahrlehrer_anzahl', question: 'Wie viele Fahrlehrerinnen und Fahrlehrer arbeiten aktuell bei Ihnen? Die Zahl erscheint sonst nirgends in einem Beitrag.' },
  { key: 'fuhrpark', question: 'Wie viele Fahrzeuge haben Sie, aufgeschluesselt nach Klasse? Eine konkrete Zahl ist mehr wert als "umfangreicher Fuhrpark".' },
  { key: 'simulator', question: 'Haben Sie einen Fahrsimulator? Wenn ja: welches Modell, und wofuer setzen Sie ihn konkret ein?' },
  { key: 'behindertengerecht', question: 'Bieten Sie behindertengerechte Fahrausbildung an? Wenn ja: welche Anpassungen sind an welchem Fahrzeug moeglich?' },
  { key: 'geschichte', question: 'Erzaehlen Sie eine konkrete Situation aus dem letzten Jahr, die zeigt, wie Sie arbeiten. Mit Datum, Ort und dem, was tatsaechlich passiert ist.' },
  { key: 'lieblingssatz', question: 'Welchen Satz sagen Sie oder Ihre Fahrlehrer im Unterricht immer wieder? Woertlich, so wie er faellt.' },
  { key: 'verbotene_themen', question: 'Ueber welche Themen soll auf keinen Fall gepostet werden? Und welche Formulierungen moegen Sie nicht hoeren?' },
  { key: 'pruefgebiet', question: 'Welche Strecken oder Kreuzungen im Pruefgebiet Fulda und Bad Hersfeld sind bei Fahrschuelern gefuerchtet? Namen bitte konkret.' },
  { key: 'haeufigste_frage', question: 'Was ist die Frage, die Ihnen am Telefon am haeufigsten gestellt wird? Woertlich.' },
];

function seedOnboarding(): void {
  for (const q of ONBOARDING_QUESTIONS) {
    run(
      `INSERT INTO onboarding_answers (id, question_key, question) VALUES (?,?,?)
       ON CONFLICT(question_key) DO NOTHING`,
      newId('onb'),
      q.key,
      q.question,
    );
  }
}

function seedBenchmarks(): void {
  const existing = get<{ n: number }>('SELECT COUNT(*) AS n FROM benchmark_examples');
  if ((existing?.n ?? 0) > 0) return;

  addBenchmarkExample({
    label: 'strong',
    platform: 'instagram',
    format: 'reel',
    payload: {
      title: 'Kreisverkehr Fulda Nord',
      hookVariants: [
        'Am Kreisverkehr Fulda Nord scheitern die meisten in der Pruefung.',
        'Drei Ausfahrten, zwei Spuren, ein haeufiger Fehler.',
        'Der Kreisverkehr, vor dem hier jeder Fahrschueler Respekt hat.',
      ],
      script: 'Am Kreisverkehr Fulda Nord passiert derselbe Fehler immer wieder: zu frueh eingeordnet. Wir zeigen die Spurwahl fuer alle drei Ausfahrten.',
      onScreenText: ['Kreisverkehr Fulda Nord', 'Spur zu frueh gewechselt', 'So geht es richtig'],
      subtitlesSrt: '1\n00:00:00,000 --> 00:00:03,000\nAm Kreisverkehr Fulda Nord\n',
      caption:
        'Am Kreisverkehr Fulda Nord passiert derselbe Fehler immer wieder: zu frueh eingeordnet und dann in der falschen Spur. Wir gehen mit dir die Spurwahl fuer alle drei Ausfahrten durch, bevor du in der Pruefung dort landest.\n\nSchreib uns deine Wunschklasse und ob Fulda oder Bad Hersfeld besser passt.',
      altText:
        'Blick aus dem Fahrzeug auf einen zweispurigen Kreisverkehr in Fulda mit Wegweisern zu drei Ausfahrten.',
      cta: 'Schreib uns deine Wunschklasse und deinen Standort.',
      hashtags: ['#fahrschulekrebs', '#fulda', '#führerschein', '#klasseb', '#fahrschule'],
      assetIds: [],
    },
    reason:
      'Konkreter Ortsbezug, benannter Fehler, klarer Handlungsaufruf mit Rueckfrage, fuenf Hashtags, ' +
      'keine unbelegte Zahl. Genau so soll ein Beitrag aussehen.',
    actor: ACTOR,
  });

  addBenchmarkExample({
    label: 'weak',
    platform: 'instagram',
    format: 'reel',
    payload: {
      title: 'Generisch',
      hookVariants: ['Heute moechten wir euch etwas zeigen'],
      script: 'Wir sind stolz darauf, unser Partner fuer Mobilitaet zu sein.',
      onScreenText: ['Dein Führerschein'],
      subtitlesSrt: '1\n00:00:00,000 --> 00:00:03,000\nDein Führerschein\n',
      caption:
        'Wir sind stolz darauf, Ihr Partner fuer Mobilitaet zu sein! Mit einer Bestehensquote von 98 % bringen wir dich sicher ans Ziel. Tauche ein in die Welt des Fahrens!',
      altText: 'Bild von einem Auto',
      cta: 'Melde dich jetzt!',
      hashtags: ['#fahrschule', '#auto', '#führerschein', '#driving', '#car', '#fun', '#lifestyle'],
      assetIds: [],
    },
    reason:
      'Unbelegte Bestehensquote, Marketingfloskeln, kein Ortsbezug, generischer Alternativtext, ' +
      'zu viele Hashtags. Muss weiterhin blockiert werden.',
    actor: ACTOR,
  });
}

export function seed(): { facts: number; note: string } {
  migrate();
  ensureDefaultPrompts(ACTOR);

  for (const f of FACTS) {
    upsertFact({
      category: f.category,
      factKey: f.key,
      value: f.value,
      status: f.status,
      source: f.source,
      sourceUrl: f.sourceUrl ?? null,
      notes: f.notes ?? null,
      actor: ACTOR,
    });
  }

  seedPillarsAndSegments();
  seedOnboarding();
  seedBenchmarks();

  for (const p of ['fahrstunde', 'theorieunterricht', 'pruefgebiet', 'sonderfahrt', 'ueberlandfahrt']) {
    addPhrase('local_term', p, null, ACTOR);
  }
  for (const p of ['Wir fahren die Strecke vorher gemeinsam ab', 'Das ueben wir, bis es sitzt']) {
    addPhrase('preferred', p, 'Formulierung aus dem Alltag', ACTOR);
  }
  for (const [text, note] of [
    ['Partner fuer Mobilitaet', 'Agenturdeutsch'],
    ['auf das naechste Level', 'Floskel'],
    ['Tauche ein', 'Floskel'],
    ['guenstigste Fahrschule', 'Preisbehauptung ohne Beleg'],
    ['garantiert bestehen', 'Unzulaessiges Versprechen'],
    ['Bestehensquote', 'Nur mit belegter Zahl und Quelle verwendbar'],
  ]) {
    addPhrase('forbidden', text, note, ACTOR);
  }

  if (!activeBrandVoice()) {
    publishBrandVoice(BRAND_VOICE, 'Ausgangsfassung aus dem Auftrag und der Recherche', ACTOR);
  }

  // Sandbox ist immer verfuegbar; die oeffentlichen Konten werden angelegt,
  // aber bleiben "unconfigured", bis Zugangsdaten hinterlegt sind.
  ensureAccount({ platform: 'sandbox', handle: 'testziel', displayName: 'Kontrolliertes Testziel', isPublic: false });
  ensureAccount({ platform: 'instagram', handle: 'fahrschulekrebs', displayName: 'Fahrschule Krebs GmbH', isPublic: true });
  ensureAccount({ platform: 'facebook', handle: 'fahrschulekrebs', displayName: 'Fahrschule Krebs Gmbh Fulda', isPublic: true });

  setFollowerBase('instagram', 1000);
  setFollowerBase('facebook', 1000);
  setFollowerBase('sandbox', 500);

  const needsConfirmation = FACTS.filter((f) => f.status === 'NEEDS_OWNER_CONFIRMATION').length;
  const note =
    `${FACTS.length} Marken-Tatsachen angelegt, davon ${needsConfirmation} mit Status ` +
    'NEEDS_OWNER_CONFIRMATION. Diese duerfen NICHT in Beitraegen behauptet werden, bis der ' +
    'Inhaber sie bestaetigt hat. Der Fact Verifier blockiert jeden Beitrag, der sie verwendet.';

  log.info(note);
  return { facts: FACTS.length, note };
}

const invokedDirectly = process.argv[1]?.endsWith('seed.js');
if (invokedDirectly) {
  const result = seed();
  process.stdout.write(`\nGrunddaten angelegt.\n${result.note}\n`);
  process.stdout.write(`Zeitpunkt: ${nowIso()}\n`);
}
