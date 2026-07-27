/**
 * Pruefende Agenten mit Vetorecht.
 *
 * Diese fuenf sind absichtlich deterministische Regelwerke und keine
 * LLM-Aufrufe. Begruendung: ein Vetorecht, das sich durch geschickte
 * Formulierung aushebeln laesst, ist keines. Regeln sind testbar,
 * reproduzierbar, in Millisekunden ausfuehrbar und immun gegen eine
 * Anweisung, die jemand in einen Kommentartext geschrieben hat.
 *
 * Jeder Agent liefert Findings. Ein Finding mit blocking=true verhindert die
 * Freigabe (durchgesetzt in domain/approval.ts und per DB-Trigger).
 */
import { ContentItem, publishRelevantView, assetRightsBlockers } from '../domain/content.js';
import { listPhrases, verifiedFactIndex, listSegments } from '../domain/brand.js';
import { parseJson } from '../db/index.js';

export interface Finding {
  agent: string;
  severity: 'info' | 'warn' | 'block';
  code: string;
  message: string;
  blocking: boolean;
  evidence?: Record<string, unknown>;
}

function textCorpus(item: ContentItem): string {
  const v = publishRelevantView(item);
  return [v.caption, v.script, v.onScreenText.join(' '), v.cta, v.altText, v.pinComment ?? '']
    .join('\n')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// 1. Brand Voice Guardian
// ---------------------------------------------------------------------------

/** Formulierungen, die nach generischem KI-Marketing klingen. */
const AI_MARKETING_CLICHES = [
  'in der heutigen schnelllebigen',
  'tauche ein in',
  'entfessle',
  'entfessele',
  'auf das naechste level',
  'auf das nächste level',
  'game changer',
  'revolutionaer',
  'revolutionär',
  'einzigartige moeglichkeit',
  'einzigartige möglichkeit',
  'verpasse nicht',
  'jetzt zuschlagen',
  'unglaubliche reise',
  'wir sind stolz darauf',
  'freuen uns, bekannt zu geben',
  'ihr partner fuer',
  'ihr partner für',
  'rundum sorglos',
  'aus einer hand',
  'nicht nur ... sondern auch',
];

/** Wendungen, die nach uebersetztem Englisch klingen statt nach Deutsch. */
const TRANSLATIONESE = [
  'macht sinn',
  'am ende des tages',
  'in 2025',
  'in 2026',
  'realisieren, dass',
  'einmal mehr',
  'wir haben dich abgedeckt',
  'lass uns eintauchen',
  'checke aus',
  'reach out',
  'stay tuned',
  'let us',
];

/** Belege dafuer, dass ein Beitrag konkret zu dieser Fahrschule gehoert. */
const LOCAL_MARKERS = [
  'fulda',
  'bad hersfeld',
  'hersfeld',
  'osthessen',
  'rhoen',
  'rhön',
  'vogelsberg',
  'am bahnhof',
  'bahnhofstr',
  'krebs',
];

export function brandVoiceGuardian(item: ContentItem): Finding[] {
  const findings: Finding[] = [];
  const agent = 'brand_voice_guardian';
  const corpus = textCorpus(item);
  const view = publishRelevantView(item);

  if (corpus.trim().length < 20) {
    findings.push({
      agent,
      severity: 'block',
      code: 'VOICE_EMPTY',
      message: 'Der Beitrag enthaelt praktisch keinen Text. Ohne Aussage keine Freigabe.',
      blocking: true,
    });
    return findings;
  }

  // Verbotene Begriffe des Inhabers.
  const forbidden = listPhrases('forbidden');
  const hits = forbidden.filter((p) => corpus.includes(p.text.toLowerCase()));
  for (const hit of hits) {
    findings.push({
      agent,
      severity: 'block',
      code: 'VOICE_FORBIDDEN_PHRASE',
      message: `Verbotene Formulierung verwendet: "${hit.text}"${hit.note ? ` (${hit.note})` : ''}`,
      blocking: true,
      evidence: { phrase: hit.text },
    });
  }

  const cliches = AI_MARKETING_CLICHES.filter((c) => corpus.includes(c));
  if (cliches.length > 0) {
    findings.push({
      agent,
      severity: 'block',
      code: 'VOICE_AI_CLICHE',
      message:
        `Der Text enthaelt generische Marketingfloskeln (${cliches.join(', ')}). ` +
        'So schreibt kein Mensch aus einer Fahrschule, sondern ein Textgenerator.',
      blocking: true,
      evidence: { cliches },
    });
  }

  const translationese = TRANSLATIONESE.filter((t) => corpus.includes(t));
  if (translationese.length > 0) {
    findings.push({
      agent,
      severity: 'warn',
      code: 'VOICE_TRANSLATIONESE',
      message: `Klingt uebersetzt statt idiomatisch deutsch: ${translationese.join(', ')}`,
      blocking: false,
      evidence: { translationese },
    });
  }

  // Der Spezifitaetstest: koennte dieser Beitrag unveraendert von jeder
  // beliebigen Fahrschule stammen? Dann taugt er nicht.
  const specificity: string[] = [];
  if (LOCAL_MARKERS.some((m) => corpus.includes(m))) specificity.push('lokaler Bezug');

  const preferred = listPhrases('preferred');
  if (preferred.some((p) => corpus.includes(p.text.toLowerCase()))) {
    specificity.push('markeneigene Formulierung');
  }
  const localTerms = listPhrases('local_term');
  if (localTerms.some((p) => corpus.includes(p.text.toLowerCase()))) {
    specificity.push('lokaler Fachbegriff');
  }

  // Ein belegter Fakt zaehlt ebenfalls als markenspezifisch.
  for (const fact of verifiedFactIndex().values()) {
    const needle = fact.value.toLowerCase().slice(0, 30);
    if (needle.length > 6 && corpus.includes(needle)) {
      specificity.push(`belegte Tatsache (${fact.category}/${fact.fact_key})`);
      break;
    }
  }
  // Konkrete Zahlen/Daten sind ebenfalls ein Spezifitaetssignal.
  if (/\b(klasse\s?[abcdelt]\w*|\d{1,2}\s?(jahre|stunden|uhr)|bf17|b196|b197)\b/i.test(corpus)) {
    specificity.push('konkrete Klassen-/Zeitangabe');
  }

  if (specificity.length === 0) {
    findings.push({
      agent,
      severity: 'block',
      code: 'VOICE_GENERIC',
      message:
        'Kein einziges markenspezifisches Detail gefunden - kein Ortsbezug, keine eigene ' +
        'Formulierung, kein belegter Fakt, keine konkrete Klassen- oder Zeitangabe. ' +
        'Dieser Beitrag koennte unveraendert von jeder Fahrschule stammen und wird abgelehnt.',
      blocking: true,
    });
  } else {
    findings.push({
      agent,
      severity: 'info',
      code: 'VOICE_SPECIFIC',
      message: `Markenspezifisch durch: ${specificity.join(', ')}.`,
      blocking: false,
      evidence: { specificity },
    });
  }

  // Ausrufezeichen-Inflation und Versalien-Schreien.
  const exclamations = (view.caption.match(/!/g) ?? []).length;
  if (exclamations > 3) {
    findings.push({
      agent,
      severity: 'warn',
      code: 'VOICE_SHOUTING',
      message: `${exclamations} Ausrufezeichen im Text. Wirkt gedraengt statt souveraen.`,
      blocking: false,
    });
  }
  const shoutWords = view.caption.split(/\s+/).filter((w) => w.length > 4 && w === w.toUpperCase() && /[A-ZÄÖÜ]/.test(w));
  if (shoutWords.length > 2) {
    findings.push({
      agent,
      severity: 'warn',
      code: 'VOICE_CAPS',
      message: `Mehrere Woerter komplett in Grossbuchstaben (${shoutWords.slice(0, 3).join(', ')}).`,
      blocking: false,
    });
  }

  if (!view.cta || view.cta.trim().length < 3) {
    findings.push({
      agent,
      severity: 'warn',
      code: 'VOICE_NO_CTA',
      message: 'Kein Handlungsaufruf hinterlegt. Reichweite ohne Anschlusshandlung bringt keine Anmeldung.',
      blocking: false,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 2. Fact and Regulation Verifier
// ---------------------------------------------------------------------------

/**
 * Behauptungsmuster, die belegt sein muessen. Bewusst breit gefasst -
 * lieber eine Rueckfrage zu viel als eine erfundene Zahl im Netz.
 */
const CLAIM_PATTERNS: { code: string; re: RegExp; label: string }[] = [
  { code: 'FACT_PASS_RATE', re: /(\d{1,3}\s?%|prozent)\s*(bestehens|erfolgs|durchfall)?|bestehensquote|erfolgsquote|durchfallquote/i, label: 'Quote oder Prozentangabe' },
  { code: 'FACT_PRICE', re: /\b\d{1,5}\s?(€|eur|euro)\b|preis(e|liste)?\s|kostet|ab nur|guenstigst|günstigst/i, label: 'Preisangabe' },
  { code: 'FACT_SUPERLATIVE', re: /\b(beste|groesste|größte|schnellste|einzige|nummer\s?1|marktfuehrer|marktführer|fuehrend|führend)\b/i, label: 'Superlativ' },
  { code: 'FACT_COUNT', re: /\b\d{2,6}\s?(schueler|schüler|kunden|fahrschueler|fahrschüler|bewertungen|jahre|fahrzeuge|fahrlehrer)\b/i, label: 'Mengenangabe' },
  { code: 'FACT_AWARD', re: /\b(ausgezeichnet|award|preistraeger|preisträger|zertifiziert|siegel|testsieger)\b/i, label: 'Auszeichnung' },
  { code: 'FACT_TESTIMONIAL', re: /["„][^"“]{25,}["“]\s*[-–—]\s*\w+/i, label: 'Zitat/Testimonial' },
  { code: 'FACT_GUARANTEE', re: /\b(garantie|garantiert|100\s?%|sicher bestehen|erfolgsgarantie)\b/i, label: 'Garantieversprechen' },
  { code: 'FACT_LEGAL', re: /\b(§|gesetzlich vorgeschrieben|laut stvo|nach fahrerlaubnisverordnung|fev\b|stvg)\b/i, label: 'Rechtsaussage' },
];

export function factVerifier(item: ContentItem): Finding[] {
  const findings: Finding[] = [];
  const agent = 'fact_verifier';
  const view = publishRelevantView(item);
  const corpus = [view.caption, view.script, view.onScreenText.join(' '), view.cta].join('\n');
  const facts = verifiedFactIndex();

  for (const pattern of CLAIM_PATTERNS) {
    const match = corpus.match(pattern.re);
    if (!match) continue;

    // Gibt es eine belegte Tatsache, die diese Behauptung stuetzt?
    const claimText = match[0].toLowerCase();
    let supported = false;
    let supportKey: string | null = null;
    for (const [key, fact] of facts) {
      const value = fact.value.toLowerCase();
      // Belegt, wenn der zitierte Wert im belegten Fakt vorkommt oder umgekehrt.
      const numbers = claimText.match(/\d+/g) ?? [];
      if (numbers.length > 0 && numbers.every((n) => value.includes(n))) {
        supported = true;
        supportKey = key;
        break;
      }
      if (value.includes(claimText.trim()) && claimText.trim().length > 5) {
        supported = true;
        supportKey = key;
        break;
      }
    }

    if (supported) {
      findings.push({
        agent,
        severity: 'info',
        code: `${pattern.code}_OK`,
        message: `${pattern.label} "${match[0].trim()}" ist durch ${supportKey} belegt.`,
        blocking: false,
      });
    } else {
      findings.push({
        agent,
        severity: 'block',
        code: pattern.code,
        message:
          `Unbelegte ${pattern.label}: "${match[0].trim()}". ` +
          'Es gibt keine als VERIFIED markierte Tatsache, die das deckt. ' +
          'Entweder die Aussage entfernen oder den Fakt vom Inhaber bestaetigen lassen.',
        blocking: true,
        evidence: { claim: match[0].trim(), pattern: pattern.code },
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 3. Privacy and Consent Reviewer
// ---------------------------------------------------------------------------

const PERSONAL_DATA_PATTERNS: { code: string; re: RegExp; message: string }[] = [
  {
    code: 'PII_PLATE',
    re: /\b(fd|hef|fz|slü|slue)[ -]?[a-z]{1,2}[ -]?\d{1,4}\b/i,
    message: 'Der Text enthaelt etwas, das wie ein Kfz-Kennzeichen aussieht.',
  },
  {
    code: 'PII_PHONE_PRIVATE',
    re: /\b(0\d{2,5}[ /-]?\d{4,9})\b/,
    message:
      'Der Text enthaelt eine Telefonnummer. Nur die offizielle Geschaeftsnummer verwenden, keine privaten Nummern.',
  },
  {
    code: 'PII_EMAIL',
    re: /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i,
    message: 'Der Text enthaelt eine E-Mail-Adresse. Pruefen, ob das die offizielle Adresse ist.',
  },
  {
    code: 'PII_MINOR',
    re: /\b(1[0-7]\s?jahre|minderjaehrig|minderjährig|unsere juengste|unsere jüngste)\b/i,
    message:
      'Moeglicher Bezug zu einer minderjaehrigen Person. Einwilligung der Erziehungsberechtigten erforderlich.',
  },
  {
    code: 'PII_NAMED_STUDENT',
    re: /\b(unser (fahrschueler|fahrschüler|schueler|schüler)|prueflings?|prüflings?)\s+[A-ZÄÖÜ][a-zäöüß]{2,}/,
    message:
      'Eine namentlich genannte Person aus dem Schuelerkreis. Ohne dokumentierte Einwilligung nicht veroeffentlichen.',
  },
];

export function privacyReviewer(item: ContentItem): Finding[] {
  const findings: Finding[] = [];
  const agent = 'privacy_consent_reviewer';
  const view = publishRelevantView(item);
  const raw = [view.caption, view.script, view.onScreenText.join(' '), view.altText].join('\n');

  for (const p of PERSONAL_DATA_PATTERNS) {
    const m = raw.match(p.re);
    if (m) {
      findings.push({
        agent,
        severity: 'block',
        code: p.code,
        message: `${p.message} Fundstelle: "${m[0].trim()}"`,
        blocking: true,
        evidence: { match: m[0].trim() },
      });
    }
  }

  // Rechte an allen referenzierten Medien - erneut geprueft, weil eine
  // zurueckgezogene Einwilligung auch einen fertigen Beitrag stoppen muss.
  for (const blocker of assetRightsBlockers(item)) {
    findings.push({
      agent,
      severity: 'block',
      code: 'RIGHTS_ASSET',
      message: blocker,
      blocking: true,
    });
  }

  if (view.assetIds.length === 0) {
    findings.push({
      agent,
      severity: 'block',
      code: 'RIGHTS_NO_ASSET',
      message: 'Dem Beitrag ist kein Medium zugeordnet. Ohne Medium gibt es nichts zu veroeffentlichen.',
      blocking: true,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 4. Platform Compliance Reviewer
// ---------------------------------------------------------------------------

interface PlatformRules {
  maxCaption: number;
  maxHashtags: number;
  requiresAltText: boolean;
  requiresSubtitles: boolean;
  videoFormats: string[];
}

const PLATFORM_RULES: Record<string, PlatformRules> = {
  instagram: { maxCaption: 2200, maxHashtags: 5, requiresAltText: true, requiresSubtitles: true, videoFormats: ['reel', 'story', 'video'] },
  facebook: { maxCaption: 63206, maxHashtags: 3, requiresAltText: true, requiresSubtitles: true, videoFormats: ['reel', 'video', 'story'] },
  tiktok: { maxCaption: 2200, maxHashtags: 5, requiresAltText: false, requiresSubtitles: true, videoFormats: ['video', 'reel'] },
  youtube: { maxCaption: 5000, maxHashtags: 3, requiresAltText: false, requiresSubtitles: true, videoFormats: ['short', 'video'] },
  sandbox: { maxCaption: 5000, maxHashtags: 30, requiresAltText: false, requiresSubtitles: false, videoFormats: ['reel', 'video', 'short', 'story'] },
};

/** Praktiken, die Plattformen abstrafen oder rechtlich heikel sind. */
const ENGAGEMENT_BAIT = [
  'markiere 3 freunde',
  'markiert 3 freunde',
  'teile diesen beitrag',
  'kommentiere ja',
  'like wenn du',
  'folgt uns fuer mehr',
  'folgt uns für mehr',
  'gewinnspiel',
  'verlosung',
];

export function complianceReviewer(item: ContentItem): Finding[] {
  const findings: Finding[] = [];
  const agent = 'platform_compliance_reviewer';
  const view = publishRelevantView(item);
  const rules = PLATFORM_RULES[item.platform];

  if (!rules) {
    findings.push({
      agent,
      severity: 'block',
      code: 'PLATFORM_UNKNOWN',
      message: `Unbekannte Plattform "${item.platform}". Keine Regeln hinterlegt, daher keine Freigabe.`,
      blocking: true,
    });
    return findings;
  }

  if (view.caption.length > rules.maxCaption) {
    findings.push({
      agent,
      severity: 'block',
      code: 'PLATFORM_CAPTION_TOO_LONG',
      message: `Text ist ${view.caption.length} Zeichen lang, erlaubt sind ${rules.maxCaption}.`,
      blocking: true,
    });
  }

  if (view.hashtags.length > rules.maxHashtags) {
    findings.push({
      agent,
      severity: 'block',
      code: 'PLATFORM_TOO_MANY_HASHTAGS',
      message:
        `${view.hashtags.length} Hashtags gesetzt, hinterlegte Obergrenze fuer ${item.platform} ist ${rules.maxHashtags}. ` +
        'Eine hoehere Zahl nur mit aktuellem, belegtem Plattform-Nachweis.',
      blocking: true,
      evidence: { hashtags: view.hashtags },
    });
  }
  const malformed = view.hashtags.filter((h) => !/^#[\p{L}\p{N}_]+$/u.test(h));
  if (malformed.length > 0) {
    findings.push({
      agent,
      severity: 'block',
      code: 'PLATFORM_HASHTAG_FORMAT',
      message: `Ungueltige Hashtags: ${malformed.join(', ')}`,
      blocking: true,
    });
  }

  if (rules.requiresAltText && (!view.altText || view.altText.trim().length < 10)) {
    findings.push({
      agent,
      severity: 'block',
      code: 'A11Y_ALT_TEXT',
      message:
        'Alternativtext fehlt oder ist zu kurz. Ohne Alternativtext ist der Beitrag fuer blinde ' +
        'Nutzer wertlos - fuer eine Fahrschule mit behindertengerechter Ausbildung besonders unpassend.',
      blocking: true,
    });
  }

  const isVideo = rules.videoFormats.includes(item.format);
  if (isVideo && rules.requiresSubtitles && (!view.subtitles || view.subtitles.trim().length < 10)) {
    findings.push({
      agent,
      severity: 'block',
      code: 'A11Y_SUBTITLES',
      message:
        'Untertiteldatei fehlt. Der ueberwiegende Teil der Wiedergaben laeuft ohne Ton, ' +
        'und ohne Untertitel ist das Video fuer gehoerlose Nutzer nicht zugaenglich.',
      blocking: true,
    });
  }

  const corpus = textCorpus(item);
  const bait = ENGAGEMENT_BAIT.filter((b) => corpus.includes(b));
  if (bait.length > 0) {
    findings.push({
      agent,
      severity: 'block',
      code: 'PLATFORM_ENGAGEMENT_BAIT',
      message:
        `Interaktions-Koeder erkannt (${bait.join(', ')}). Plattformen drosseln solche Beitraege, ` +
        'und Gewinnspiele brauchen zusaetzlich rechtssichere Teilnahmebedingungen.',
      blocking: true,
      evidence: { bait },
    });
  }

  if (!view.accountId) {
    findings.push({
      agent,
      severity: 'block',
      code: 'PLATFORM_NO_ACCOUNT',
      message: 'Kein Zielkonto zugeordnet.',
      blocking: true,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 5. Red-Team Critic
// ---------------------------------------------------------------------------

const REPUTATION_RISKS: { code: string; re: RegExp; message: string }[] = [
  {
    code: 'RISK_SAFETY_TRIVIALIZED',
    re: /\b(einfach mal gas|kein problem wenn|blitzer umgehen|nicht so schlimm|ausnahmsweise ohne|drueber weg|drüber weg)\b/i,
    message:
      'Der Text verharmlost eine Verkehrssituation. Fuer eine Fahrschule ist das der teuerste ' +
      'denkbare Reputationsschaden - Verkehrssicherheit ist das Produkt.',
  },
  {
    code: 'RISK_LEARNER_MOCKERY',
    re: /\b(peinlich|blamiert|voll versagt|so dumm|zu bloed|zu blöd|lachnummer|fail des tages)\b/i,
    message:
      'Der Text macht sich ueber Fahrschueler lustig. Die abgebildete Person ist ein zahlender ' +
      'Kunde und jeder potenzielle Kunde liest mit.',
  },
  {
    code: 'RISK_COMPETITOR',
    re: /\b(andere fahrschulen|die konkurrenz|bei denen|woanders zahlst du|im gegensatz zu anderen)\b/i,
    message:
      'Vergleichende Aussage ueber Mitbewerber. Wettbewerbsrechtlich heikel und wirkt unsouveraen.',
  },
  {
    code: 'RISK_DESPERATE',
    re: /\b(letzte chance|nur noch heute|schnell sein|ausverkauft|jetzt oder nie|begrenzte plaetze|begrenzte plätze)\b/i,
    message:
      'Kuenstliche Verknappung. Wirkt bei einer etablierten Fahrschule beduerftig statt begehrt - ' +
      'nur verwenden, wenn die Knappheit nachweislich stimmt.',
  },
  {
    code: 'RISK_MEDICAL_LEGAL',
    re: /\b(du darfst trotzdem|ist erlaubt auch wenn|brauchst du nicht|kein gutachten noetig|kein gutachten nötig)\b/i,
    message:
      'Aussage, die als Rechts- oder Eignungsberatung gelesen werden kann. Ohne juristische Pruefung nicht veroeffentlichen.',
  },
];

export function redTeamCritic(item: ContentItem): Finding[] {
  const findings: Finding[] = [];
  const agent = 'red_team_critic';
  const corpus = textCorpus(item);
  const view = publishRelevantView(item);

  for (const risk of REPUTATION_RISKS) {
    const m = corpus.match(risk.re);
    if (m) {
      findings.push({
        agent,
        severity: 'block',
        code: risk.code,
        message: `${risk.message} Fundstelle: "${m[0].trim()}"`,
        blocking: true,
        evidence: { match: m[0].trim() },
      });
    }
  }

  // Der Hook entscheidet ueber Reichweite. Ein schwacher Hook ist kein
  // Sperrgrund, aber der Inhaber soll es vor der Freigabe wissen.
  const hooks = parseJson<string[]>(item.hook_variants_json, []);
  if (hooks.length < 3) {
    findings.push({
      agent,
      severity: 'warn',
      code: 'CRIT_FEW_HOOKS',
      message: `Nur ${hooks.length} Hook-Variante(n). Ohne Alternativen gibt es nichts zu testen.`,
      blocking: false,
    });
  }
  const weakHookStarts = ['heute moechten wir', 'heute möchten wir', 'wusstest du schon', 'in diesem video', 'hallo zusammen', 'wir stellen vor'];
  const weak = hooks.filter((h) => weakHookStarts.some((w) => h.toLowerCase().startsWith(w)));
  if (weak.length > 0) {
    findings.push({
      agent,
      severity: 'warn',
      code: 'CRIT_WEAK_HOOK',
      message: `Abgenutzter Hook-Einstieg: ${weak.map((w) => `"${w}"`).join(', ')}. Die ersten zwei Sekunden entscheiden.`,
      blocking: false,
    });
  }

  // Zielgruppenbezug: spricht der Beitrag ueberhaupt jemanden konkret an?
  const segments = listSegments();
  const addressed = segments.filter((s) =>
    s.name
      .toLowerCase()
      .split(/[\s/]+/)
      .some((w) => w.length > 4 && corpus.includes(w)),
  );
  if (addressed.length === 0 && segments.length > 0) {
    findings.push({
      agent,
      severity: 'warn',
      code: 'CRIT_NO_SEGMENT',
      message:
        'Kein erkennbarer Bezug zu einer definierten Zielgruppe. Ein Beitrag fuer alle spricht meist niemanden an.',
      blocking: false,
    });
  }

  if (view.caption.length < 60) {
    findings.push({
      agent,
      severity: 'warn',
      code: 'CRIT_THIN_CAPTION',
      message: 'Sehr kurzer Begleittext. Wenig Kontext bedeutet wenig Anlass zu antworten.',
      blocking: false,
    });
  }
  return findings;
}

/** Alle fuenf pruefenden Agenten in fester Reihenfolge. */
export const REVIEW_AGENTS = [
  { key: 'brand_voice_guardian', name: 'Brand Voice Guardian', veto: true, run: brandVoiceGuardian },
  { key: 'fact_verifier', name: 'Fact and Regulation Verifier', veto: true, run: factVerifier },
  { key: 'privacy_consent_reviewer', name: 'Privacy and Consent Reviewer', veto: true, run: privacyReviewer },
  { key: 'platform_compliance_reviewer', name: 'Platform Compliance Reviewer', veto: true, run: complianceReviewer },
  { key: 'red_team_critic', name: 'Red-Team Critic', veto: false, run: redTeamCritic },
] as const;
