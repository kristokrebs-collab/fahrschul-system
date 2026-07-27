/**
 * Marken-Wissensbasis.
 *
 * Kernregel des gesamten Systems: Eine Aussage darf nur veroeffentlicht
 * werden, wenn sie durch eine Tatsache mit Status VERIFIED gedeckt ist.
 * Alles andere ist Entwurfsmaterial und wird vom Fact Verifier blockiert.
 */
import { all, get, run, nowIso, parseJson } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { recordEvent } from '../observability/logger.js';

export type VerificationStatus =
  | 'VERIFIED'
  | 'NEEDS_OWNER_CONFIRMATION'
  | 'EXPIRED'
  | 'REJECTED';

export interface BrandFact {
  id: string;
  category: string;
  fact_key: string;
  value: string;
  verification_status: VerificationStatus;
  source: string;
  source_url: string | null;
  verified_by: string | null;
  verified_at: string | null;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function listFacts(filter?: { status?: VerificationStatus; category?: string }): BrandFact[] {
  const clauses: string[] = [];
  const params: any[] = [];
  if (filter?.status) {
    clauses.push('verification_status = ?');
    params.push(filter.status);
  }
  if (filter?.category) {
    clauses.push('category = ?');
    params.push(filter.category);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<BrandFact>(
    `SELECT * FROM brand_facts ${where} ORDER BY category, fact_key`,
    ...params,
  );
}

export function getFact(category: string, key: string): BrandFact | undefined {
  return get<BrandFact>(
    'SELECT * FROM brand_facts WHERE category = ? AND fact_key = ?',
    category,
    key,
  );
}

export interface UpsertFactInput {
  category: string;
  factKey: string;
  value: string;
  status: VerificationStatus;
  source: string;
  sourceUrl?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
  actor: string;
}

export function upsertFact(input: UpsertFactInput): BrandFact {
  const existing = getFact(input.category, input.factKey);
  const now = nowIso();
  const verifiedAt = input.status === 'VERIFIED' ? now : null;
  const verifiedBy = input.status === 'VERIFIED' ? input.actor : null;

  if (existing) {
    run(
      `UPDATE brand_facts
       SET value = ?, verification_status = ?, source = ?, source_url = ?,
           verified_by = ?, verified_at = ?, expires_at = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      input.value,
      input.status,
      input.source,
      input.sourceUrl ?? null,
      verifiedBy,
      verifiedAt,
      input.expiresAt ?? null,
      input.notes ?? null,
      now,
      existing.id,
    );
    recordEvent({
      kind: 'brand.fact.updated',
      actor: input.actor,
      entityType: 'brand_fact',
      entityId: existing.id,
      message: `Marken-Tatsache aktualisiert: ${input.category}/${input.factKey} -> ${input.status}`,
      detail: { previousStatus: existing.verification_status, newStatus: input.status },
    });
    return getFact(input.category, input.factKey)!;
  }

  const id = newId('fact');
  run(
    `INSERT INTO brand_facts
      (id, category, fact_key, value, verification_status, source, source_url,
       verified_by, verified_at, expires_at, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    input.category,
    input.factKey,
    input.value,
    input.status,
    input.source,
    input.sourceUrl ?? null,
    verifiedBy,
    verifiedAt,
    input.expiresAt ?? null,
    input.notes ?? null,
    now,
    now,
  );
  recordEvent({
    kind: 'brand.fact.created',
    actor: input.actor,
    entityType: 'brand_fact',
    entityId: id,
    message: `Marken-Tatsache angelegt: ${input.category}/${input.factKey} (${input.status})`,
  });
  return getFact(input.category, input.factKey)!;
}

/**
 * Setzt abgelaufene Tatsachen auf EXPIRED. Wird vom Scheduler taeglich
 * aufgerufen; verhindert, dass eine einmal bestaetigte Aussage
 * (z. B. ein Kurstermin) auf unbestimmte Zeit als wahr gilt.
 */
export function expireStaleFacts(): number {
  const r = run(
    `UPDATE brand_facts
     SET verification_status = 'EXPIRED', updated_at = ?
     WHERE verification_status = 'VERIFIED'
       AND expires_at IS NOT NULL
       AND expires_at < ?`,
    nowIso(),
    nowIso(),
  );
  if (r.changes > 0) {
    recordEvent({
      kind: 'brand.fact.expired',
      actor: 'system:scheduler',
      severity: 'warn',
      message: `${r.changes} Marken-Tatsache(n) sind abgelaufen und benoetigen erneute Bestaetigung.`,
    });
  }
  return r.changes;
}

/** Alle Zahlen/Behauptungen, auf die sich Texte stuetzen duerfen. */
export function verifiedFactIndex(): Map<string, BrandFact> {
  const map = new Map<string, BrandFact>();
  for (const f of listFacts({ status: 'VERIFIED' })) {
    map.set(`${f.category}/${f.fact_key}`, f);
  }
  return map;
}

// --- Phrasen ----------------------------------------------------------------

export interface BrandPhrase {
  id: string;
  kind: 'preferred' | 'forbidden' | 'local_term';
  text: string;
  note: string | null;
}

export function listPhrases(kind?: BrandPhrase['kind']): BrandPhrase[] {
  return kind
    ? all<BrandPhrase>('SELECT * FROM brand_phrases WHERE kind = ? ORDER BY text', kind)
    : all<BrandPhrase>('SELECT * FROM brand_phrases ORDER BY kind, text');
}

export function addPhrase(
  kind: BrandPhrase['kind'],
  text: string,
  note: string | null,
  actor: string,
): void {
  run(
    `INSERT INTO brand_phrases (id, kind, text, note, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(kind, text) DO UPDATE SET note = excluded.note`,
    newId('phr'),
    kind,
    text,
    note,
    nowIso(),
  );
  recordEvent({
    kind: 'brand.phrase.added',
    actor,
    message: `Phrase (${kind}) hinterlegt: "${text}"`,
  });
}

// --- Saeulen und Zielgruppen ------------------------------------------------

export interface ContentPillar {
  id: string;
  pillar_key: string;
  name: string;
  description: string;
  target_share: number;
  active: number;
}

export function listPillars(): ContentPillar[] {
  return all<ContentPillar>('SELECT * FROM content_pillars WHERE active = 1 ORDER BY pillar_key');
}

export interface AudienceSegment {
  id: string;
  segment_key: string;
  name: string;
  description: string;
  objections_json: string;
  active: number;
}

export function listSegments(): (AudienceSegment & { objections: string[] })[] {
  return all<AudienceSegment>(
    'SELECT * FROM audience_segments WHERE active = 1 ORDER BY segment_key',
  ).map((s) => ({ ...s, objections: parseJson<string[]>(s.objections_json, []) }));
}

// --- Brand Voice Dokument ---------------------------------------------------

export interface BrandVoiceVersion {
  id: string;
  version: number;
  markdown: string;
  active: number;
  change_summary: string;
  created_at: string;
  created_by: string;
}

export function activeBrandVoice(): BrandVoiceVersion | undefined {
  return get<BrandVoiceVersion>('SELECT * FROM brand_voice_versions WHERE active = 1');
}

export function publishBrandVoice(markdown: string, changeSummary: string, actor: string): number {
  const maxRow = get<{ v: number | null }>(
    'SELECT MAX(version) AS v FROM brand_voice_versions',
  );
  const version = (maxRow?.v ?? 0) + 1;
  run('UPDATE brand_voice_versions SET active = 0 WHERE active = 1');
  run(
    `INSERT INTO brand_voice_versions (id, version, markdown, active, change_summary, created_at, created_by)
     VALUES (?,?,?,1,?,?,?)`,
    newId('bv'),
    version,
    markdown,
    changeSummary,
    nowIso(),
    actor,
  );
  recordEvent({
    kind: 'brand.voice.published',
    actor,
    message: `Brand Voice v${version} aktiviert: ${changeSummary}`,
  });
  return version;
}

// --- Onboarding-Interview ---------------------------------------------------

export interface OnboardingAnswer {
  id: string;
  question_key: string;
  question: string;
  answer: string | null;
  challenged: number;
  challenge_note: string | null;
  answered_at: string | null;
  answered_by: string | null;
}

export function onboardingQuestions(): OnboardingAnswer[] {
  return all<OnboardingAnswer>('SELECT * FROM onboarding_answers ORDER BY rowid');
}

/** Naechste offene Frage - das Interview laeuft bewusst eine Frage nach der anderen. */
export function nextOnboardingQuestion(): OnboardingAnswer | undefined {
  return get<OnboardingAnswer>(
    `SELECT * FROM onboarding_answers
     WHERE answer IS NULL OR (challenged = 1 AND challenge_note IS NOT NULL AND answered_at IS NULL)
     ORDER BY rowid LIMIT 1`,
  );
}

/**
 * Vage Antworten werden zurueckgewiesen statt hingenommen. Eine Marke, die
 * "wir sind freundlich und professionell" sagt, hat noch nichts gesagt.
 */
const VAGUE_MARKERS = [
  'freundlich',
  'professionell',
  'zuverlaessig',
  'zuverlässig',
  'kompetent',
  'gute qualitaet',
  'gute qualität',
  'guter service',
  'alles',
  'weiss nicht',
  'weiß nicht',
  'keine ahnung',
  'irgendwas',
  'normal',
];

export function assessAnswerQuality(answer: string): { vague: boolean; reason: string | null } {
  const normalized = answer.trim().toLowerCase();
  if (normalized.length < 25) {
    return {
      vague: true,
      reason:
        'Antwort ist zu kurz, um daraus Inhalte abzuleiten. Bitte ein konkretes Beispiel, eine Zahl oder eine Situation ergaenzen.',
    };
  }
  const hasConcrete = /\d/.test(normalized) || normalized.includes('zum beispiel') || normalized.includes('z.b');
  const vagueHits = VAGUE_MARKERS.filter((m) => normalized.includes(m));
  if (vagueHits.length > 0 && !hasConcrete) {
    return {
      vague: true,
      reason:
        `Die Antwort enthaelt Allgemeinplaetze (${vagueHits.join(', ')}) ohne konkreten Beleg. ` +
        'Jede Fahrschule wuerde das Gleiche sagen. Bitte eine konkrete Situation, einen Satz aus dem Alltag oder eine Zahl nennen.',
    };
  }
  return { vague: false, reason: null };
}

export function answerOnboarding(
  questionKey: string,
  answer: string,
  actor: string,
): { accepted: boolean; challenge: string | null } {
  const q = get<OnboardingAnswer>(
    'SELECT * FROM onboarding_answers WHERE question_key = ?',
    questionKey,
  );
  if (!q) throw new Error(`Unbekannte Onboarding-Frage: ${questionKey}`);

  const quality = assessAnswerQuality(answer);
  if (quality.vague && q.challenged === 0) {
    run(
      'UPDATE onboarding_answers SET challenged = 1, challenge_note = ?, answer = ? WHERE question_key = ?',
      quality.reason,
      answer,
      questionKey,
    );
    return { accepted: false, challenge: quality.reason };
  }

  run(
    `UPDATE onboarding_answers
     SET answer = ?, answered_at = ?, answered_by = ?, challenge_note = NULL
     WHERE question_key = ?`,
    answer,
    nowIso(),
    actor,
    questionKey,
  );
  recordEvent({
    kind: 'brand.onboarding.answered',
    actor,
    message: `Onboarding-Frage beantwortet: ${questionKey}`,
  });
  return { accepted: true, challenge: null };
}
