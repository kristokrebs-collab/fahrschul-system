/**
 * Generative Agenten: Recherche, Strategie, Archivkuration, Produktion.
 *
 * Jeder dieser Agenten hat zwei Betriebsarten:
 *
 *  - `anthropic`: Claude erzeugt den Entwurf, anschliessend laufen die
 *    pruefenden Agenten darueber. Der Guardian kann jeden Entwurf verwerfen.
 *  - `deterministic`: ohne LLM-Zugangsdaten wird aus der Markendatenbank
 *    komponiert - belegte Fakten, definierte Saeulen, hinterlegte Phrasen,
 *    Ortsbezug. Das Ergebnis ist bewusst nuechtern und wird in der Oberflaeche
 *    als solches gekennzeichnet. Es wird nicht als vollwertige Generierung
 *    ausgegeben.
 *
 * In beiden Faellen gilt: kein Text verlaesst diesen Modul-Pfad ohne
 * anschliessende Pruefung durch reviewers.ts.
 */
import { all, get, run, nowIso, parseJson } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { recordEvent } from '../observability/logger.js';
import {
  listPillars,
  listSegments,
  listPhrases,
  verifiedFactIndex,
  activeBrandVoice,
} from '../domain/brand.js';
import { searchMediaNatural, searchMedia, MediaQuery, SearchHit } from '../domain/media.js';
import { generateJson, llmMode, LlmUnavailableError } from './llm.js';
import { activePrompt } from './prompts.js';

// ---------------------------------------------------------------------------
// Local Audience Researcher
// ---------------------------------------------------------------------------

export type OpportunityKind =
  | 'durable_brand_topic'
  | 'local_opportunity'
  | 'platform_trend'
  | 'short_lived_trend'
  | 'regulatory_topic';

export interface OpportunityScores {
  audienceRelevance: number;
  localRelevance: number;
  originality: number;
  likelyRetention: number;
  likelySaves: number;
  likelyInquiryIntent: number;
  productionEffort: number;
  rightsRisk: number;
  reputationalRisk: number;
  shelfLife: number;
}

/**
 * Gewichtung. Geschaeftswirkung zaehlt mehr als Reichweite: `likelyInquiryIntent`
 * hat das hoechste positive Gewicht, Risiken werden abgezogen.
 */
const SCORE_WEIGHTS: Record<keyof OpportunityScores, number> = {
  audienceRelevance: 1.4,
  localRelevance: 1.3,
  originality: 1.0,
  likelyRetention: 1.1,
  likelySaves: 0.9,
  likelyInquiryIntent: 1.8,
  productionEffort: -0.7,
  rightsRisk: -1.2,
  reputationalRisk: -1.6,
  shelfLife: 0.6,
};

export function scoreOpportunity(scores: OpportunityScores): {
  total: number;
  explanation: { dimension: string; value: number; weight: number; contribution: number }[];
} {
  const explanation = (Object.keys(SCORE_WEIGHTS) as (keyof OpportunityScores)[]).map((k) => {
    const value = Math.max(0, Math.min(10, scores[k] ?? 0));
    const weight = SCORE_WEIGHTS[k];
    return { dimension: k, value, weight, contribution: Math.round(value * weight * 10) / 10 };
  });
  const total = Math.round(explanation.reduce((s, e) => s + e.contribution, 0) * 10) / 10;
  return { total, explanation };
}

export interface OpportunityDraft {
  title: string;
  kind: OpportunityKind;
  summary: string;
  evidence: string[];
  scores: OpportunityScores;
  shelfLifeDays: number;
  requiresVerification: boolean;
  /**
   * Bindung an Saeule, Zielgruppe und den konkreten Einwand. Ohne diese
   * Bindung vergibt der Wochenplan Aufhaenger, Thema und Adressat unabhaengig
   * voneinander - das Ergebnis sind Beitraege, die drei verschiedene Dinge
   * gleichzeitig sagen wollen.
   */
  pillarKey?: string | null;
  segmentKey?: string | null;
  objection?: string | null;
}

const OPPORTUNITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    opportunities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['durable_brand_topic', 'local_opportunity', 'platform_trend', 'short_lived_trend', 'regulatory_topic'],
          },
          summary: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          shelfLifeDays: { type: 'integer' },
          requiresVerification: { type: 'boolean' },
          scores: {
            type: 'object',
            additionalProperties: false,
            properties: {
              audienceRelevance: { type: 'integer' },
              localRelevance: { type: 'integer' },
              originality: { type: 'integer' },
              likelyRetention: { type: 'integer' },
              likelySaves: { type: 'integer' },
              likelyInquiryIntent: { type: 'integer' },
              productionEffort: { type: 'integer' },
              rightsRisk: { type: 'integer' },
              reputationalRisk: { type: 'integer' },
              shelfLife: { type: 'integer' },
            },
            required: [
              'audienceRelevance','localRelevance','originality','likelyRetention','likelySaves',
              'likelyInquiryIntent','productionEffort','rightsRisk','reputationalRisk','shelfLife',
            ],
          },
        },
        required: ['title', 'kind', 'summary', 'evidence', 'shelfLifeDays', 'requiresVerification', 'scores'],
      },
    },
  },
  required: ['opportunities'],
};

function brandContextBlock(): string {
  const facts = [...verifiedFactIndex().values()]
    .map((f) => `- [BELEGT] ${f.category}/${f.fact_key}: ${f.value}`)
    .join('\n');
  const pillars = listPillars().map((p) => `- ${p.name}: ${p.description}`).join('\n');
  const segments = listSegments()
    .map((s) => `- ${s.name}: ${s.description}. Einwaende: ${s.objections.join('; ') || 'keine erfasst'}`)
    .join('\n');
  const forbidden = listPhrases('forbidden').map((p) => p.text).join(', ') || 'keine erfasst';
  const preferred = listPhrases('preferred').map((p) => p.text).join(', ') || 'keine erfasst';
  const voice = activeBrandVoice()?.markdown ?? 'Noch kein Brand-Voice-Dokument hinterlegt.';

  return [
    '## Markenstimme', voice,
    '', '## Belegte Tatsachen (NUR diese duerfen behauptet werden)', facts || '- keine belegten Tatsachen hinterlegt',
    '', '## Inhaltssaeulen', pillars || '- keine',
    '', '## Zielgruppen', segments || '- keine',
    '', `## Bevorzugte Formulierungen: ${preferred}`,
    `## Verbotene Formulierungen: ${forbidden}`,
  ].join('\n');
}

/** Themenvorrat ohne LLM: leitet aus Saeulen x Zielgruppen konkrete Ansaetze ab. */
function deterministicOpportunities(limit: number): OpportunityDraft[] {
  const pillars = listPillars();
  const segments = listSegments();
  const drafts: OpportunityDraft[] = [];

  for (const pillar of pillars) {
    for (const segment of segments) {
      if (drafts.length >= limit) break;
      const objection = segment.objections[0] ?? null;
      if (!objection) continue;
      drafts.push({
        title: `${pillar.name} beantwortet: "${objection}" (${segment.name})`,
        kind: 'durable_brand_topic',
        summary:
          `Beitrag aus der Saeule "${pillar.name}", der den konkreten Einwand "${objection}" ` +
          `der Zielgruppe ${segment.name} direkt aufloest. Grundlage: ${pillar.description}`,
        evidence: [
          `Einwand aus der hinterlegten Zielgruppendefinition ${segment.segment_key}`,
          `Saeule ${pillar.pillar_key} mit Zielanteil ${Math.round(pillar.target_share * 100)} %`,
        ],
        scores: {
          audienceRelevance: 8,
          localRelevance: 6,
          originality: 5,
          likelyRetention: 6,
          likelySaves: 6,
          likelyInquiryIntent: 8,
          productionEffort: 4,
          rightsRisk: 1,
          reputationalRisk: 1,
          shelfLife: 9,
        },
        shelfLifeDays: 365,
        requiresVerification: false,
        pillarKey: pillar.pillar_key,
        segmentKey: segment.segment_key,
        objection,
      });
    }
  }
  return drafts.slice(0, limit);
}

export async function researchOpportunities(
  limit: number,
  actor: string,
): Promise<{ mode: string; created: number; opportunities: OpportunityDraft[] }> {
  const mode = llmMode();
  let drafts: OpportunityDraft[];

  if (mode === 'anthropic') {
    try {
      const result = await generateJson<{ opportunities: OpportunityDraft[] }>({
        system: activePrompt('local_audience_researcher'),
        user: [
          brandContextBlock(),
          '',
          `Erarbeite ${limit} konkrete Themenchancen fuer die naechsten 30 Tage.`,
          'Bewerte jede Chance auf allen zehn Dimensionen von 0 bis 10.',
          'productionEffort, rightsRisk und reputationalRisk sind Kosten: hoeher = schlechter.',
          'Markiere requiresVerification=true bei jeder Aussage, die eine Zahl, einen Preis,',
          'eine Rechtslage oder eine Leistungsbehauptung enthaelt.',
          'Antworte ausschliesslich mit dem JSON-Objekt.',
        ].join('\n'),
        schema: OPPORTUNITY_SCHEMA,
        effort: 'high',
        maxTokens: 12000,
      });
      drafts = result.opportunities ?? [];
    } catch (err) {
      if (!(err instanceof LlmUnavailableError)) {
        recordEvent({
          kind: 'agent.research.llm_failed',
          actor,
          severity: 'warn',
          message: `LLM-Recherche fehlgeschlagen, fallback auf deterministische Ableitung: ${(err as Error).message}`,
        });
      }
      drafts = deterministicOpportunities(limit);
    }
  } else {
    drafts = deterministicOpportunities(limit);
  }

  let created = 0;
  for (const d of drafts) {
    const { total } = scoreOpportunity(d.scores);
    const existing = get<{ id: string }>('SELECT id FROM opportunities WHERE title = ?', d.title);
    if (existing) continue;
    run(
      `INSERT INTO opportunities
        (id, title, kind, summary, evidence_json, scores_json, total_score, shelf_life_days,
         requires_verification, status, source, discovered_at, expires_at,
         pillar_key, segment_key, objection)
       VALUES (?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?)`,
      newId('opp'),
      d.title,
      d.kind,
      d.summary,
      JSON.stringify(d.evidence ?? []),
      JSON.stringify(d.scores),
      total,
      d.shelfLifeDays ?? 30,
      d.requiresVerification ? 1 : 0,
      mode === 'anthropic' ? 'claude_research' : 'deterministic_derivation',
      nowIso(),
      new Date(Date.now() + (d.shelfLifeDays ?? 30) * 86400_000).toISOString(),
      d.pillarKey ?? null,
      d.segmentKey ?? null,
      d.objection ?? null,
    );
    created++;
  }

  recordEvent({
    kind: 'agent.research.completed',
    actor,
    message: `Themenrecherche (${mode}): ${created} neue Chancen erfasst.`,
  });
  return { mode, created, opportunities: drafts };
}

// ---------------------------------------------------------------------------
// Chief Content Strategist
// ---------------------------------------------------------------------------

/**
 * Themensaettigung: wie oft wurde eine Saeule zuletzt bespielt?
 * Verhindert, dass ein gut laufendes Thema die Ausspielung dominiert.
 */
export function pillarSaturation(days = 30): Record<string, number> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = all<{ pillar: string; n: number }>(
    'SELECT pillar, COUNT(*) AS n FROM plan_items WHERE created_at >= ? GROUP BY pillar',
    since,
  );
  const total = rows.reduce((s, r) => s + Number(r.n), 0) || 1;
  const out: Record<string, number> = {};
  for (const p of listPillars()) out[p.pillar_key] = 0;
  for (const r of rows) out[r.pillar] = Number(r.n) / total;
  return out;
}

/** Formatmischung mit Zielanteilen. Verhindert eine reine Reel-Monokultur. */
const FORMAT_MIX: { format: string; share: number; platform: string }[] = [
  { format: 'reel', share: 0.34, platform: 'instagram' },
  { format: 'carousel', share: 0.22, platform: 'instagram' },
  { format: 'image', share: 0.14, platform: 'instagram' },
  { format: 'story', share: 0.16, platform: 'instagram' },
  { format: 'poll', share: 0.06, platform: 'instagram' },
  { format: 'short', share: 0.08, platform: 'youtube' },
];

export interface PlanItemDraft {
  platform: string;
  objective: string;
  audienceSegment: string;
  pillar: string;
  hook: string;
  angle: string;
  format: string;
  durationS: number | null;
  requiredMedia: string[];
  script: Record<string, unknown>;
  cta: string;
  proposedPublishAt: string;
  hypothesis: string;
  riskFlags: string[];
  opportunityId: string | null;
}

/** Sendeplatz-Vorschlaege. Bewusst konservativ und ohne Nachtstunden. */
const SLOTS = [
  { day: 1, hour: 17 },
  { day: 2, hour: 12 },
  { day: 3, hour: 18 },
  { day: 4, hour: 16 },
  { day: 5, hour: 15 },
  { day: 6, hour: 11 },
  { day: 0, hour: 19 },
];

function nextSlot(index: number, from: Date): string {
  const slot = SLOTS[index % SLOTS.length];
  const d = new Date(from);
  d.setDate(d.getDate() + Math.floor(index / SLOTS.length) * 7);
  const delta = (slot.day - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  d.setHours(slot.hour, 0, 0, 0);
  return d.toISOString();
}

export function buildWeeklyPlan(count: number, actor: string): PlanItemDraft[] {
  const pillars = listPillars();
  const segments = listSegments();
  const saturation = pillarSaturation();
  const opportunities = all<any>(
    `SELECT * FROM opportunities WHERE status IN ('new','shortlisted')
     ORDER BY total_score DESC LIMIT ?`,
    count * 2,
  );

  // Saeulen mit dem groessten Rueckstand auf ihren Zielanteil zuerst.
  const ranked = [...pillars].sort(
    (a, b) =>
      (b.target_share - (saturation[b.pillar_key] ?? 0)) -
      (a.target_share - (saturation[a.pillar_key] ?? 0)),
  );

  const drafts: PlanItemDraft[] = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    const mix = FORMAT_MIX[i % FORMAT_MIX.length];
    const opportunity = opportunities[i] ?? null;

    // Stammt der Aufhaenger aus einer Themenchance, bestimmen deren Saeule und
    // Zielgruppe auch den Rest des Beitrags. Nur wenn keine Chance vorliegt,
    // greift der Saettigungsausgleich als Ersatzauswahl. Sonst entstuenden
    // Beitraege, deren Hook, Thema und Adressat auseinanderlaufen.
    const pillar =
      (opportunity?.pillar_key && pillars.find((p) => p.pillar_key === opportunity.pillar_key)) ||
      ranked[i % ranked.length];
    const segment =
      (opportunity?.segment_key && segments.find((s) => s.segment_key === opportunity.segment_key)) ||
      segments[i % Math.max(segments.length, 1)];

    const objection =
      opportunity?.objection ?? segment?.objections?.[0] ?? 'Unsicherheit vor dem ersten Termin';
    const hook = opportunity
      ? String(opportunity.title).slice(0, 110)
      : `${objection} - so laeuft es bei uns wirklich`;

    drafts.push({
      platform: mix.platform,
      objective:
        i % 4 === 3
          ? 'Qualifizierte Anfrage ueber Direktnachricht ausloesen'
          : 'Vertrauen aufbauen und Einwand aufloesen',
      audienceSegment: segment?.segment_key ?? 'unbekannt',
      pillar: pillar?.pillar_key ?? 'allgemein',
      hook,
      angle: opportunity
        ? String(opportunity.summary).slice(0, 300)
        : `Konkreter Ablauf statt Werbeversprechen: ${pillar?.description ?? ''}`,
      format: mix.format,
      durationS: ['reel', 'short'].includes(mix.format) ? 25 : null,
      requiredMedia: ['reel', 'short', 'story'].includes(mix.format)
        ? ['video hochkant']
        : ['bild hochkant'],
      // Der Einwand wird mitgefuehrt, damit die Produktion denselben
      // beantwortet, den die Planung gemeint hat.
      script: { structure: ['Hook', 'Problem', 'Konkrete Antwort', 'Beleg', 'CTA'], objection },
      cta:
        i % 4 === 3
          ? 'Schreib uns eine Nachricht mit deiner Wunschklasse - wir melden uns mit einem Termin.'
          : 'Speicher dir den Beitrag, wenn du gerade ueberlegst anzufangen.',
      proposedPublishAt: nextSlot(i, now),
      hypothesis:
        `Wenn wir ${objection} konkret beantworten, steigt der Anteil gespeicherter Beitraege ` +
        'und wir erhalten mehr Direktnachrichten mit Klassenangabe.',
      riskFlags: opportunity?.requires_verification ? ['Faktenpruefung erforderlich'] : [],
      opportunityId: opportunity?.id ?? null,
    });
  }

  recordEvent({
    kind: 'agent.strategy.plan_built',
    actor,
    message: `Wochenplan mit ${drafts.length} Positionen erstellt (Saettigungsausgleich aktiv).`,
    detail: { saturation },
  });
  return drafts;
}

export function persistPlan(drafts: PlanItemDraft[], strategyId: string | null, actor: string): string[] {
  const ids: string[] = [];
  for (const d of drafts) {
    const id = newId('pln');
    run(
      `INSERT INTO plan_items
        (id, strategy_id, opportunity_id, platform, objective, audience_segment, pillar, hook, angle,
         format, duration_s, required_media_json, script_json, cta, proposed_publish_at, hypothesis,
         risk_flags_json, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'planned',?,?)`,
      id,
      strategyId,
      d.opportunityId,
      d.platform,
      d.objective,
      d.audienceSegment,
      d.pillar,
      d.hook,
      d.angle,
      d.format,
      d.durationS,
      JSON.stringify(d.requiredMedia),
      JSON.stringify(d.script),
      d.cta,
      d.proposedPublishAt,
      d.hypothesis,
      JSON.stringify(d.riskFlags),
      nowIso(),
      nowIso(),
    );
    if (d.opportunityId) {
      run('UPDATE opportunities SET status = ? WHERE id = ?', 'planned', d.opportunityId);
    }
    ids.push(id);
  }
  recordEvent({
    kind: 'agent.strategy.plan_persisted',
    actor,
    message: `${ids.length} Planpositionen gespeichert.`,
  });
  return ids;
}

// ---------------------------------------------------------------------------
// Archive and Rights Curator
// ---------------------------------------------------------------------------

/**
 * Waehlt Bestandsmaterial aus. Grundsatz aus dem Auftrag: vorhandenes,
 * echtes Material hat Vorrang vor Generierung. Diese Funktion generiert
 * daher nie - sie sucht, bewertet und meldet ehrlich, was sie gefunden hat.
 *
 * Die Suche laeuft in drei Stufen, weil eine enge Themensuche sonst bei jedem
 * Beitrag ins Leere laeuft und das Ergebnis ein Beitrag ohne Medium waere:
 *   1. exakte Themensuche
 *   2. breitere Suche nur ueber die Saeule
 *   3. bestes verfuegbares Material des passenden Typs
 *
 * `onlyPublishable: true` gilt auf ALLEN Stufen. Der Rechtefilter wird nie
 * gelockert - eine breitere Suche findet mehr Kandidaten, aber niemals
 * ungeklaerte.
 */
export function curateAssets(
  query: string,
  needed: number,
  opts?: { kind?: 'image' | 'video'; orientation?: 'portrait' | 'landscape' | 'square' },
): { hits: SearchHit[]; sufficient: boolean; note: string; tier: string } {
  const base = {
    onlyPublishable: true as const,
    limit: Math.max(needed * 4, 12),
    ...(opts?.kind ? { kind: opts.kind } : {}),
  };

  // Stufe 1: exakte Themensuche, inklusive gewuenschter Ausrichtung.
  const exact = searchMediaNatural(query, {
    ...base,
    ...(opts?.orientation ? { orientation: opts.orientation } : {}),
  }).hits;
  if (exact.length >= needed) {
    return {
      hits: exact.slice(0, needed),
      sufficient: true,
      tier: 'themengenau',
      note: `${exact.length} themengenaue freigegebene Assets gefunden, ${needed} verwendet.`,
    };
  }

  // Stufe 2: ohne Ausrichtungsvorgabe, nur die ersten beiden Begriffe.
  const broadTerms = query.split(/\s+/).filter((w) => w.length > 3).slice(0, 2).join(' ');
  const broad = broadTerms ? searchMediaNatural(broadTerms, base).hits : [];
  const merged = dedupeHits([...exact, ...broad]);
  if (merged.length >= needed) {
    return {
      hits: merged.slice(0, needed),
      sufficient: true,
      tier: 'thematisch verwandt',
      note:
        `Keine themengenauen Treffer, daher thematisch verwandtes Material verwendet ` +
        `(Suchbegriffe "${broadTerms}"). Bitte vor der Freigabe pruefen, ob das Bild zum Text passt.`,
    };
  }

  // Stufe 3: bestes verfuegbares freigegebenes Material des passenden Typs.
  const anyPublishable = searchMedia({
    terms: [],
    exclude: [],
    onlyPublishable: true,
    limit: Math.max(needed * 3, 10),
    ...(opts?.kind ? { kind: opts.kind } : {}),
  } as MediaQuery);
  const all = dedupeHits([...merged, ...anyPublishable]);

  if (all.length >= needed) {
    return {
      hits: all.slice(0, needed),
      sufficient: true,
      tier: 'bestverfuegbar',
      note:
        `Kein thematisch passendes Material gefunden. Es wurde das beste verfuegbare freigegebene ` +
        `Material (${opts?.kind ?? 'beliebiger Typ'}) eingesetzt. Der Bezug zwischen Bild und Aussage ` +
        'ist dadurch schwach - vor der Freigabe pruefen oder passendes Material aufnehmen.',
    };
  }

  // Nichts Freigegebenes vorhanden: erklaeren, woran es liegt.
  const blocked = searchMediaNatural(query, {
    onlyPublishable: false,
    limit: 20,
    ...(opts?.kind ? { kind: opts.kind } : {}),
  }).hits.filter((h) => h.blockers.length > 0);

  return {
    hits: all,
    sufficient: false,
    tier: 'unzureichend',
    note:
      `Nur ${all.length} von ${needed} benoetigten freigegebenen Assets vorhanden. ` +
      (blocked.length > 0
        ? `${blocked.length} passende Assets sind wegen fehlender Rechte- oder Einwilligungsklaerung gesperrt. ` +
          'Diese im Medienarchiv freigeben oder neues Material aufnehmen.'
        : 'Es existiert kein freigegebenes Material dieses Typs im Archiv.'),
  };
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    if (seen.has(h.asset.id)) continue;
    seen.add(h.asset.id);
    out.push(h);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reel/Shorts Producer + Carousel and Copy Specialist
// ---------------------------------------------------------------------------

export interface ProductionPackage {
  title: string;
  hookVariants: string[];
  script: string;
  shotList: { t: string; shot: string; note: string }[];
  edl: { start: number; end: number; source: string; action: string }[];
  onScreenText: string[];
  subtitlesSrt: string;
  caption: string;
  coverConcept: string;
  altText: string;
  cta: string;
  hashtags: string[];
  storyFollowup: { step: number; type: string; content: string }[];
  pinComment: string;
  firstHourPlan: string;
}

const PACKAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    hookVariants: { type: 'array', items: { type: 'string' } },
    script: { type: 'string' },
    shotList: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { t: { type: 'string' }, shot: { type: 'string' }, note: { type: 'string' } },
        required: ['t', 'shot', 'note'],
      },
    },
    edl: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          start: { type: 'number' },
          end: { type: 'number' },
          source: { type: 'string' },
          action: { type: 'string' },
        },
        required: ['start', 'end', 'source', 'action'],
      },
    },
    onScreenText: { type: 'array', items: { type: 'string' } },
    subtitlesSrt: { type: 'string' },
    caption: { type: 'string' },
    coverConcept: { type: 'string' },
    altText: { type: 'string' },
    cta: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    storyFollowup: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { step: { type: 'integer' }, type: { type: 'string' }, content: { type: 'string' } },
        required: ['step', 'type', 'content'],
      },
    },
    pinComment: { type: 'string' },
    firstHourPlan: { type: 'string' },
  },
  required: [
    'title','hookVariants','script','shotList','edl','onScreenText','subtitlesSrt','caption',
    'coverConcept','altText','cta','hashtags','storyFollowup','pinComment','firstHourPlan',
  ],
};

function srtFrom(lines: string[], perLine = 3): string {
  return lines
    .map((line, i) => {
      const start = i * perLine;
      const end = start + perLine;
      const fmt = (s: number) =>
        `00:00:${String(Math.floor(s)).padStart(2, '0')},${String(Math.round((s % 1) * 1000)).padStart(3, '0')}`;
      return `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${line}\n`;
    })
    .join('\n');
}

/**
 * Deterministische Komposition aus Markendaten. Kein erfundener Fakt, kein
 * Superlativ, kein Preis - der Fact Verifier wuerde das ohnehin blockieren.
 */
function composePackage(plan: any, assets: SearchHit[]): ProductionPackage {
  const segment = listSegments().find((s) => s.segment_key === plan.audience_segment);
  const pillar = listPillars().find((p) => p.pillar_key === plan.pillar);
  // Den Einwand nehmen, den die Planung gemeint hat - nicht irgendeinen der
  // Zielgruppe. Sonst beantwortet der Bildtext eine andere Frage als der Hook.
  const planned = parseJson<{ objection?: string }>(plan.script_json, {});
  const objection =
    planned.objection ?? segment?.objections?.[0] ?? 'Unsicherheit vor dem ersten Fahrtermin';
  const isVideo = ['reel', 'short', 'story', 'video'].includes(plan.format);

  // Der Einwand als Frage, ohne doppeltes Fragezeichen.
  const question = objection.replace(/[?.!]+$/, '');

  const hookVariants = [
    `${question}? Die ehrliche Antwort.`,
    `Diese Frage bekommen wir in Fulda fast jede Woche: ${question}?`,
    `${question} - wir sagen es dir, bevor du fragst.`,
  ];

  const onScreenText = [
    `${question}?`,
    'Die ehrliche Antwort',
    'Fahrschule Krebs · Fulda und Bad Hersfeld',
  ];

  // Handlungsaufruf passend zur Zielgruppe. Ein Betrieb speichert keinen
  // Beitrag - er will einen Ansprechpartner.
  const ctaBySegment: Record<string, string> = {
    betriebe: 'Schreib uns, wie viele Mitarbeitende es betrifft und welche Klasse - wir melden uns mit einem Terminvorschlag.',
    berufskraftfahrer: 'Schreib uns deine Klasse und ab wann du starten koenntest - wir sagen dir, was geht.',
    eltern: 'Schreib uns, welche Klasse fuer Ihr Kind infrage kommt - wir erklaeren den Ablauf in Ruhe.',
    adaptiert: 'Schreib uns, welche Anpassung du brauchst - wir klaeren vorab, was bei uns moeglich ist.',
    motorrad: 'Schreib uns deine Wunschklasse (A1, A2 oder A) - wir sagen dir, was du mitbringen musst.',
    quereinsteiger: 'Schreib uns, wann du Zeit hast - Abend und Samstag gehen bei uns auch.',
    fahranfaenger: 'Schreib uns deine Wunschklasse und ob Fulda oder Bad Hersfeld besser passt.',
  };
  const cta = ctaBySegment[plan.audience_segment] ?? plan.cta;

  // Der Begleittext beantwortet den Einwand - er beschreibt nicht den Beitrag.
  // `plan.angle` ist interne Planungssprache und bleibt bewusst draussen.
  const caption = [
    `${question}?`,
    '',
    'Diese Frage hoeren wir oft - und die ehrliche Antwort haengt davon ab, was du ' +
      'genau brauchst. Deshalb erklaeren wir dir den Ablauf lieber konkret, statt eine ' +
      'Zahl in den Raum zu stellen, die am Ende nicht stimmt.',
    '',
    'Wir bilden in Fulda und Bad Hersfeld aus.',
    '',
    cta,
  ].join('\n');

  const lines = [
    hookVariants[0],
    `Diese Frage hoeren wir oft: ${question}?`,
    'Die ehrliche Antwort haengt davon ab, was du genau brauchst - deshalb erklaeren wir den Ablauf konkret.',
    cta,
  ];

  return {
    title: plan.hook.slice(0, 120),
    hookVariants,
    script: lines.join('\n\n'),
    shotList: assets.map((a, i) => ({
      t: `${i * 4}-${i * 4 + 4}s`,
      shot: `Archivmaterial ${a.asset.id} (${a.asset.kind})`,
      note: a.reasons.slice(0, 2).join('; '),
    })),
    edl: assets.map((a, i) => ({
      start: i * 4,
      end: i * 4 + 4,
      source: a.asset.id,
      action: i === 0 ? 'Hook, harter Schnitt auf Bewegung' : 'Schnitt auf Beat',
    })),
    onScreenText,
    subtitlesSrt: isVideo ? srtFrom(lines) : '',
    caption,
    coverConcept:
      'Dunkler Hintergrund, ein Fahrzeug leicht angeschnitten, Textzeile links oben, ' +
      'crimsonfarbene Lichtkante als einziges Farbsignal.',
    altText:
      `${plan.format === 'carousel' ? 'Bildstrecke' : 'Aufnahme'} aus dem Alltag der Fahrschule Krebs in Fulda: ` +
      `${assets[0]?.asset.search_text?.slice(0, 120) || 'Fahrzeug und Ausbildungssituation'}.`,
    cta,
    hashtags: ['#fahrschulekrebs', '#fulda', '#badhersfeld', '#führerschein', '#fahrschule'],
    storyFollowup: [
      { step: 1, type: 'frage', content: `Was haelt dich gerade noch ab? (${objection})` },
      { step: 2, type: 'antwort', content: 'Antworten sammeln und im naechsten Beitrag aufgreifen.' },
    ],
    pinComment: `Deine Frage zum Ablauf? Schreib sie hier rein - wir antworten heute noch.`,
    firstHourPlan:
      'Erste Stunde: alle Kommentare beantworten, beste Frage anpinnen, Story mit Verweis ' +
      'auf den Beitrag posten, Direktnachrichten innerhalb von 30 Minuten beantworten.',
  };
}

export async function produce(
  planItemId: string,
  actor: string,
): Promise<{ mode: string; pkg: ProductionPackage; assets: SearchHit[]; assetNote: string }> {
  const plan = get<any>('SELECT * FROM plan_items WHERE id = ?', planItemId);
  if (!plan) throw new Error(`Planposition ${planItemId} nicht gefunden.`);

  const required = parseJson<string[]>(plan.required_media_json, []);
  const wantsVideo = required.some((r) => r.toLowerCase().includes('video'));
  const needed = plan.format === 'carousel' ? 4 : 2;

  const curation = curateAssets(
    `${plan.pillar} ${plan.hook} ${required.join(' ')}`,
    needed,
    { kind: wantsVideo ? 'video' : 'image', orientation: 'portrait' },
  );

  const mode = llmMode();
  let pkg: ProductionPackage;

  if (mode === 'anthropic') {
    try {
      const agentKey = ['reel', 'short', 'story'].includes(plan.format)
        ? 'reel_shorts_producer'
        : 'carousel_copy_specialist';
      pkg = await generateJson<ProductionPackage>({
        system: activePrompt(agentKey),
        user: [
          brandContextBlock(),
          '',
          '## Planposition',
          `Plattform: ${plan.platform} | Format: ${plan.format} | Dauer: ${plan.duration_s ?? '-'}s`,
          `Ziel: ${plan.objective}`,
          `Zielgruppe: ${plan.audience_segment}`,
          `Saeule: ${plan.pillar}`,
          `Hook-Ansatz: ${plan.hook}`,
          `Blickwinkel: ${plan.angle}`,
          `Handlungsaufruf: ${plan.cta}`,
          `Hypothese: ${plan.hypothesis}`,
          '',
          '## Verfuegbares Bestandsmaterial (NUR diese IDs verwenden)',
          curation.hits
            .map((h) => `- ${h.asset.id} (${h.asset.kind}, ${h.asset.orientation}): ${h.asset.search_text.slice(0, 140)}`)
            .join('\n') || '- kein freigegebenes Material verfuegbar',
          '',
          'Erzeuge das vollstaendige Veroeffentlichungspaket als JSON.',
          'Harte Regeln: hoechstens 5 Hashtags. Keine Zahl, kein Preis, keine Quote, kein Superlativ,',
          'kein Testimonial - es sei denn, der Wert steht woertlich in den belegten Tatsachen oben.',
          'Mindestens ein konkreter Ortsbezug (Fulda oder Bad Hersfeld). Idiomatisches Deutsch,',
          'keine uebersetzt klingenden Wendungen, keine Marketingfloskeln.',
        ].join('\n'),
        schema: PACKAGE_SCHEMA,
        effort: 'high',
        maxTokens: 14000,
      });
    } catch (err) {
      recordEvent({
        kind: 'agent.production.llm_failed',
        actor,
        severity: 'warn',
        entityType: 'plan_item',
        entityId: planItemId,
        message: `LLM-Produktion fehlgeschlagen, deterministische Komposition genutzt: ${(err as Error).message}`,
      });
      pkg = composePackage(plan, curation.hits);
    }
  } else {
    pkg = composePackage(plan, curation.hits);
  }

  run('UPDATE plan_items SET status = ?, updated_at = ? WHERE id = ?', 'in_production', nowIso(), planItemId);
  recordEvent({
    kind: 'agent.production.completed',
    actor,
    entityType: 'plan_item',
    entityId: planItemId,
    message: `Produktionspaket erstellt (${mode}). ${curation.note}`,
  });

  return { mode, pkg, assets: curation.hits, assetNote: curation.note };
}
