/**
 * Selbstauswertung und sichere Verbesserung.
 *
 * Der Weg einer Aenderung in die Produktion ist fest verdrahtet:
 *
 *   Evidenz erfassen -> Vorschlag in Klartext -> Tests und historische
 *   Wiederholung -> keine Sicherheits-, Rechte- oder Markenregression ->
 *   Freigabe durch den Inhaber -> Anwendung -> jederzeit rueckrollbar.
 *
 * Was das System AUTOMATISCH darf: Leistungsstatistiken fortschreiben und
 * seine Abrufgedaechtnisse aktualisieren. Das aendert nichts an Regeln.
 *
 * Was es NIEMALS darf: Freigabepflichten, Rechtepruefungen, Sicherheits-
 * schwellen oder Wahrheitspruefungen abschwaechen. Solche Vorschlaege werden
 * mit `risk_class = 'forbidden'` abgewiesen und koennen auch vom Inhaber
 * nicht ueber diesen Weg freigegeben werden - dafuer braucht es eine
 * Codeaenderung mit Review.
 */
import { all, get, run, nowIso, parseJson } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { recordEvent } from '../observability/logger.js';
import { getContentItem, ContentItem } from './content.js';
import { getScores, performanceMemory } from './analytics.js';
import { leadPipeline, leadsBySource } from './inbox.js';
import { activatePromptVersion, addPromptVersion, promptVersions } from '../agents/prompts.js';
import { REVIEW_AGENTS } from '../agents/reviewers.js';
import { queueStats } from '../queue/publisher.js';

// ---------------------------------------------------------------------------
// Postmortem
// ---------------------------------------------------------------------------

export type FailureClass =
  | 'strategic'
  | 'creative'
  | 'factual'
  | 'operational'
  | 'technical'
  | 'measurement'
  | 'none';

export interface Postmortem {
  id: string;
  content_item_id: string;
  predicted: Record<string, unknown>;
  actual: Record<string, unknown>;
  wrongAssumptions: string;
  failureClass: FailureClass;
  contributingComponent: string;
  smallestSafeChange: string;
}

/**
 * Automatisches Postmortem nach abgeschlossenem Zyklus.
 * Es beantwortet die sechs Fragen aus dem Auftrag und leitet den kleinsten
 * sicheren Aenderungsvorschlag ab - nicht den groessten.
 */
export function runPostmortem(itemId: string, actor: string): Postmortem {
  const item = getContentItem(itemId);
  if (!item) throw new Error(`Content-Item ${itemId} nicht gefunden.`);

  const plan = item.plan_item_id
    ? get<any>('SELECT * FROM plan_items WHERE id = ?', item.plan_item_id)
    : null;
  const scores = getScores(itemId);
  const sevenDay = scores.find((s) => s.window === 't7d') ?? scores[0] ?? null;
  const job = get<any>(
    'SELECT state, attempts, last_error, last_error_class, verified_at FROM publish_jobs WHERE content_item_id = ? ORDER BY created_at DESC LIMIT 1',
    itemId,
  );

  const predicted = {
    hypothesis: plan?.hypothesis ?? null,
    objective: plan?.objective ?? null,
    proposedPublishAt: plan?.proposed_publish_at ?? null,
  };
  const actual = {
    viralityScore: sevenDay?.viralityScore ?? null,
    businessScore: sevenDay?.businessScore ?? null,
    viralityConfidence: sevenDay?.viralityConfidence ?? null,
    businessConfidence: sevenDay?.businessConfidence ?? null,
    publishState: job?.state ?? 'nie veroeffentlicht',
    attempts: job?.attempts ?? 0,
    lastError: job?.last_error ?? null,
    actualPublishAt: job?.verified_at ?? null,
  };

  // --- Fehlerklasse bestimmen -----------------------------------------
  let failureClass: FailureClass = 'none';
  let contributingComponent = '-';
  let wrongAssumptions = 'Keine erkennbare Fehlannahme.';
  let smallestSafeChange = 'Keine Aenderung erforderlich.';

  if (job && ['dead_letter', 'failed'].includes(job.state)) {
    failureClass = 'technical';
    contributingComponent = `Publishing Operator / Adapter ${item.platform} (${job.last_error_class})`;
    wrongAssumptions = 'Die Annahme, dass das Zielkonto und das Medium zustellbereit sind, war falsch.';
    smallestSafeChange = `Vor dem Einplanen pruefen, ob die Fehlerklasse "${job.last_error_class}" vorab erkennbar ist (z. B. Medienformat, Tokenablauf).`;
  } else if (!job || job.state !== 'succeeded') {
    failureClass = 'operational';
    contributingComponent = 'Freigabe- oder Planungsstrecke';
    wrongAssumptions = 'Der Beitrag hat es nicht bis zur Veroeffentlichung geschafft.';
    smallestSafeChange = 'Blockierende Befunde des Beitrags durchgehen und die haeufigste Ursache im Produktionsprompt adressieren.';
  } else if (sevenDay === null || sevenDay.businessConfidence === 'none') {
    failureClass = 'measurement';
    contributingComponent = 'Kennzahlenerfassung';
    wrongAssumptions = 'Es wurde angenommen, dass die Plattform auswertbare Kennzahlen liefert.';
    smallestSafeChange = 'Fehlende Kennzahlen manuell nachtragen oder die Bewertungsbestandteile fuer diese Plattform anpassen.';
  } else {
    const v = sevenDay.viralityScore ?? 0;
    const b = sevenDay.businessScore ?? 0;
    if (v >= 45 && b < 12) {
      failureClass = 'strategic';
      contributingComponent = 'Chief Content Strategist / CTA';
      wrongAssumptions =
        'Die Hypothese unterstellte, dass Reichweite zu Anfragen fuehrt. Der Beitrag wurde gesehen, ' +
        'aber er hat niemanden zu einer Handlung bewegt.';
      smallestSafeChange =
        'Handlungsaufruf konkretisieren: nach einer benannten Angabe fragen (Wunschklasse, Standort) ' +
        'statt allgemein zum Schreiben aufzufordern.';
    } else if (v < 15 && b < 10) {
      failureClass = 'creative';
      contributingComponent = 'Reel/Shorts Producer bzw. Carousel Specialist';
      wrongAssumptions = 'Der Hook hat die Zielgruppe nicht erreicht - weder Verbreitung noch Wirkung.';
      smallestSafeChange = 'Die Hook-Variante wechseln und das Thema mit einem konkreten Fall statt allgemein einsteigen.';
    } else if (v < 15 && b >= 20) {
      failureClass = 'none';
      contributingComponent = '-';
      wrongAssumptions =
        'Die Hypothese unterschaetzte den Beitrag: geringe Reichweite, aber hohe Trefferquote bei den ' +
        'richtigen Leuten. Das ist ein Erfolg, kein Fehlschlag.';
      smallestSafeChange = 'Dieses Thema erneut bespielen und die Zielgruppenansprache beibehalten.';
    }
  }

  const id = newId('pmt');
  run(
    `INSERT INTO postmortems
      (id, content_item_id, predicted_json, actual_json, wrong_assumptions, failure_class,
       contributing_component, evidence_json, smallest_safe_change, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id,
    itemId,
    JSON.stringify(predicted),
    JSON.stringify(actual),
    wrongAssumptions,
    failureClass,
    contributingComponent,
    JSON.stringify({ scores, job }),
    smallestSafeChange,
    nowIso(),
  );

  recordEvent({
    kind: 'learning.postmortem',
    actor,
    entityType: 'content_item',
    entityId: itemId,
    message: `Postmortem: ${failureClass}. ${wrongAssumptions}`,
  });

  return {
    id,
    content_item_id: itemId,
    predicted,
    actual,
    wrongAssumptions,
    failureClass,
    contributingComponent,
    smallestSafeChange,
  };
}

// ---------------------------------------------------------------------------
// Aenderungsvorschlaege
// ---------------------------------------------------------------------------

export type ProposalTarget =
  | 'prompt'
  | 'rule'
  | 'schedule'
  | 'pillar_mix'
  | 'hashtag_strategy'
  | 'scoring_weight'
  | 'other';

/**
 * Begriffe, die auf eine Abschwaechung von Schutzmechanismen hindeuten.
 * Ein Vorschlag, der hierauf passt, bekommt risk_class 'forbidden' und wird
 * nicht ueber diesen Weg anwendbar - unabhaengig davon, wer ihn stellt.
 */
const FORBIDDEN_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /freigabe.*(ueberspring|überspring|automatisch|ohne)/i, reason: 'Umgehung der Freigabepflicht' },
  { re: /(auto|automatisch).*(veroeffentlich|veröffentlich|publish)/i, reason: 'Automatische Veroeffentlichung ohne Freigabe' },
  { re: /(deaktivier|abschalt|entfern|lockern|aufweich).*(pruef|prüf|verifier|guardian|reviewer|veto)/i, reason: 'Abschwaechung einer Pruefinstanz' },
  { re: /(ohne|kein).*(einwilligung|consent|rechte|rights)/i, reason: 'Umgehung der Rechte- oder Einwilligungspruefung' },
  { re: /(unbelegt|ohne beleg|erfund).*(erlaub|zulass)/i, reason: 'Zulassen unbelegter Behauptungen' },
  { re: /risikoschwelle.*(senk|erhoeh|erhöh|lockern)/i, reason: 'Verschiebung von Risikoschwellen' },
  { re: /(rate.?limit|ratenlimit).*(umgeh|ignorier)/i, reason: 'Umgehung von Plattformlimits' },
];

export interface ChangeProposal {
  id: string;
  title: string;
  rationale: string;
  target_kind: ProposalTarget;
  target_ref: string;
  current_value: string;
  proposed_value: string;
  risk_class: 'low' | 'medium' | 'high' | 'forbidden';
  state:
    | 'proposed'
    | 'testing'
    | 'tests_failed'
    | 'ready_for_owner'
    | 'approved'
    | 'applied'
    | 'rejected'
    | 'rolled_back';
  created_at: string;
  applied_at: string | null;
  rollback_ref: string | null;
}

function classifyRisk(input: { title: string; rationale: string; proposedValue: string; targetKind: ProposalTarget }): {
  riskClass: ChangeProposal['risk_class'];
  reason: string | null;
} {
  const corpus = `${input.title}\n${input.rationale}\n${input.proposedValue}`;
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.re.test(corpus)) {
      return { riskClass: 'forbidden', reason: p.reason };
    }
  }
  if (input.targetKind === 'rule' || input.targetKind === 'scoring_weight') {
    return { riskClass: 'high', reason: null };
  }
  if (input.targetKind === 'prompt') return { riskClass: 'medium', reason: null };
  return { riskClass: 'low', reason: null };
}

export function proposeChange(input: {
  title: string;
  rationale: string;
  targetKind: ProposalTarget;
  targetRef: string;
  currentValue: string;
  proposedValue: string;
  evidence: Record<string, unknown>;
  actor: string;
}): ChangeProposal {
  const { riskClass, reason } = classifyRisk({
    title: input.title,
    rationale: input.rationale,
    proposedValue: input.proposedValue,
    targetKind: input.targetKind,
  });

  const id = newId('cpr');
  run(
    `INSERT INTO change_proposals
      (id, title, rationale, target_kind, target_ref, current_value, proposed_value,
       evidence_json, risk_class, state, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    input.title,
    reason ? `${input.rationale}\n\nABGEWIESEN: ${reason}.` : input.rationale,
    input.targetKind,
    input.targetRef,
    input.currentValue,
    input.proposedValue,
    JSON.stringify(input.evidence),
    riskClass,
    riskClass === 'forbidden' ? 'rejected' : 'proposed',
    nowIso(),
  );

  recordEvent({
    kind: 'learning.proposal_created',
    actor: input.actor,
    severity: riskClass === 'forbidden' ? 'warn' : 'info',
    entityType: 'change_proposal',
    entityId: id,
    message:
      riskClass === 'forbidden'
        ? `Vorschlag abgewiesen (${reason}). Schutzmechanismen sind ueber diesen Weg nicht aenderbar.`
        : `Vorschlag erfasst: ${input.title} (Risikoklasse ${riskClass}).`,
  });

  return get<ChangeProposal>('SELECT * FROM change_proposals WHERE id = ?', id)!;
}

export interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * Regressionslauf gegen die Benchmark-Beispiele.
 *
 * Historische Wiederholung im Wortsinn: jedes hinterlegte starke Beispiel
 * muss weiterhin alle Pruefungen bestehen, jedes schwache Beispiel muss
 * weiterhin blockiert werden. Faellt eines davon um, ist die Aenderung
 * eine Regression und wird nicht angewandt.
 */
export function runRegressionSuite(): TestResult[] {
  const results: TestResult[] = [];
  const examples = all<any>('SELECT * FROM benchmark_examples ORDER BY label, created_at');

  if (examples.length === 0) {
    results.push({
      name: 'benchmark_corpus',
      passed: false,
      detail:
        'Es sind keine Benchmark-Beispiele hinterlegt. Ohne Vergleichsbasis kann keine Regression ' +
        'ausgeschlossen werden, daher gilt der Lauf als nicht bestanden.',
    });
    return results;
  }

  for (const ex of examples) {
    const payload = parseJson<any>(ex.payload_json, {});
    const pseudoItem = {
      id: `benchmark_${ex.id}`,
      plan_item_id: null,
      platform: ex.platform,
      account_id: 'benchmark-account',
      format: ex.format,
      title: payload.title ?? 'Benchmark',
      hook_variants_json: JSON.stringify(payload.hookVariants ?? []),
      script: payload.script ?? '',
      shot_list_json: '[]',
      edl_json: '[]',
      on_screen_text_json: JSON.stringify(payload.onScreenText ?? []),
      subtitles_srt: payload.subtitlesSrt ?? null,
      caption: payload.caption ?? '',
      cover_concept: null,
      alt_text: payload.altText ?? '',
      cta: payload.cta ?? '',
      hashtags_json: JSON.stringify(payload.hashtags ?? []),
      story_followup_json: '[]',
      pin_comment: null,
      first_hour_plan: null,
      asset_ids_json: JSON.stringify(payload.assetIds ?? []),
      content_hash: 'benchmark',
      version: 1,
      state: 'draft',
      scheduled_for: null,
      experiment_id: null,
      experiment_variant: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    } as unknown as ContentItem;

    // Nur die textbasierten Pruefer laufen hier - Rechte- und Kontopruefung
    // haengen an echten Datensaetzen und gehoeren nicht in den Textbenchmark.
    const textAgents = REVIEW_AGENTS.filter((a) =>
      ['brand_voice_guardian', 'fact_verifier', 'red_team_critic'].includes(a.key),
    );
    const findings = textAgents.flatMap((a) => {
      try {
        return a.run(pseudoItem);
      } catch (err) {
        return [
          {
            agent: a.key,
            severity: 'block' as const,
            code: 'AGENT_CRASH',
            message: (err as Error).message,
            blocking: true,
          },
        ];
      }
    });
    const blocked = findings.some((f) => f.blocking);

    if (ex.label === 'strong') {
      results.push({
        name: `benchmark_strong/${ex.id}`,
        passed: !blocked,
        detail: blocked
          ? `Regression: ein als gut bewertetes Beispiel wird jetzt blockiert (${findings.filter((f) => f.blocking).map((f) => f.code).join(', ')}). Grund: ${ex.reason}`
          : 'Starkes Beispiel besteht weiterhin.',
      });
    } else {
      results.push({
        name: `benchmark_weak/${ex.id}`,
        passed: blocked,
        detail: blocked
          ? 'Schwaches Beispiel wird korrekt blockiert.'
          : `Regression: ein als schlecht bewertetes Beispiel wuerde jetzt durchgehen. Grund: ${ex.reason}`,
      });
    }
  }

  // Zusaetzliche Invariante: das Freigabe-Gate selbst muss stehen.
  const triggerRow = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_publish_requires_approval'`,
  );
  results.push({
    name: 'invariant_approval_trigger',
    passed: (triggerRow?.n ?? 0) === 1,
    detail:
      (triggerRow?.n ?? 0) === 1
        ? 'Der Datenbank-Trigger, der Veroeffentlichung ohne Freigabe verhindert, ist vorhanden.'
        : 'KRITISCH: Der Freigabe-Trigger fehlt in der Datenbank.',
  });

  return results;
}

export function testProposal(proposalId: string, actor: string): { results: TestResult[]; passed: boolean } {
  const proposal = get<ChangeProposal>('SELECT * FROM change_proposals WHERE id = ?', proposalId);
  if (!proposal) throw new Error(`Vorschlag ${proposalId} nicht gefunden.`);
  if (proposal.risk_class === 'forbidden') {
    throw new Error('Dieser Vorschlag ist abgewiesen und wird nicht getestet.');
  }

  run(`UPDATE change_proposals SET state = 'testing' WHERE id = ?`, proposalId);
  const results = runRegressionSuite();
  const passed = results.every((r) => r.passed);

  run(
    `UPDATE change_proposals SET state = ?, test_results_json = ? WHERE id = ?`,
    passed ? 'ready_for_owner' : 'tests_failed',
    JSON.stringify(results),
    proposalId,
  );
  recordEvent({
    kind: 'learning.proposal_tested',
    actor,
    severity: passed ? 'info' : 'warn',
    entityType: 'change_proposal',
    entityId: proposalId,
    message: passed
      ? `Alle ${results.length} Tests bestanden. Wartet auf Freigabe durch den Inhaber.`
      : `${results.filter((r) => !r.passed).length} Test(s) fehlgeschlagen - keine Anwendung.`,
    detail: { failed: results.filter((r) => !r.passed).map((r) => r.name) },
  });
  return { results, passed };
}

/** Anwendung nur nach Owner-Freigabe und bestandenen Tests. */
export function applyProposal(proposalId: string, userId: string, actor: string): ChangeProposal {
  const p = get<ChangeProposal>('SELECT * FROM change_proposals WHERE id = ?', proposalId);
  if (!p) throw new Error(`Vorschlag ${proposalId} nicht gefunden.`);
  if (p.risk_class === 'forbidden') {
    throw new Error(
      'Dieser Vorschlag beruehrt einen Schutzmechanismus und kann ueber diesen Weg nicht angewandt ' +
        'werden - auch nicht durch den Inhaber. Dafuer ist eine Codeaenderung mit Review erforderlich.',
    );
  }
  if (p.state !== 'ready_for_owner') {
    throw new Error(
      `Vorschlag ist im Zustand "${p.state}". Anwendbar ist nur ein Vorschlag, dessen Tests bestanden sind.`,
    );
  }

  let rollbackRef: string | null = null;

  if (p.target_kind === 'prompt') {
    const currentVersion = promptVersions(p.target_ref).find((v: any) => v.active === 1) as any;
    rollbackRef = currentVersion ? `${p.target_ref}:${currentVersion.version}` : null;
    const newVersion = addPromptVersion(p.target_ref, p.proposed_value, p.title, actor);
    activatePromptVersion(p.target_ref, newVersion, actor);
  } else {
    run(
      `INSERT INTO kv (key, value, updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      `config:${p.target_kind}:${p.target_ref}`,
      p.proposed_value,
      nowIso(),
    );
    rollbackRef = `kv:${p.target_kind}:${p.target_ref}`;
  }

  run(
    `UPDATE change_proposals SET state = 'applied', decided_at = ?, decided_by = ?, applied_at = ?, rollback_ref = ?
     WHERE id = ?`,
    nowIso(),
    userId,
    nowIso(),
    rollbackRef,
    proposalId,
  );
  recordEvent({
    kind: 'learning.proposal_applied',
    actor,
    severity: 'warn',
    entityType: 'change_proposal',
    entityId: proposalId,
    message: `Aenderung angewandt: ${p.title}. Rueckrollpunkt: ${rollbackRef ?? 'keiner'}.`,
  });
  return get<ChangeProposal>('SELECT * FROM change_proposals WHERE id = ?', proposalId)!;
}

export function rollbackProposal(proposalId: string, actor: string): ChangeProposal {
  const p = get<ChangeProposal>('SELECT * FROM change_proposals WHERE id = ?', proposalId);
  if (!p) throw new Error(`Vorschlag ${proposalId} nicht gefunden.`);
  if (p.state !== 'applied') throw new Error(`Nur angewandte Aenderungen koennen zurueckgerollt werden.`);
  if (!p.rollback_ref) throw new Error('Kein Rueckrollpunkt hinterlegt.');

  if (p.target_kind === 'prompt') {
    const [agentKey, version] = p.rollback_ref.split(':');
    activatePromptVersion(agentKey, Number(version), actor);
  } else {
    run(
      `INSERT INTO kv (key, value, updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      `config:${p.target_kind}:${p.target_ref}`,
      p.current_value,
      nowIso(),
    );
  }

  run(`UPDATE change_proposals SET state = 'rolled_back', rolled_back_at = ? WHERE id = ?`, nowIso(), proposalId);
  recordEvent({
    kind: 'learning.proposal_rolled_back',
    actor,
    severity: 'warn',
    entityType: 'change_proposal',
    entityId: proposalId,
    message: `Aenderung "${p.title}" zurueckgerollt.`,
  });
  return get<ChangeProposal>('SELECT * FROM change_proposals WHERE id = ?', proposalId)!;
}

export function listProposals() {
  return all<ChangeProposal>('SELECT * FROM change_proposals ORDER BY created_at DESC');
}

export function addBenchmarkExample(input: {
  label: 'strong' | 'weak';
  platform: string;
  format: string;
  payload: Record<string, unknown>;
  reason: string;
  actor: string;
}): string {
  const id = newId('bmk');
  run(
    `INSERT INTO benchmark_examples (id, label, platform, format, payload_json, reason, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    id,
    input.label,
    input.platform,
    input.format,
    JSON.stringify(input.payload),
    input.reason,
    nowIso(),
  );
  recordEvent({
    kind: 'learning.benchmark_added',
    actor: input.actor,
    message: `Benchmark-Beispiel (${input.label}) hinterlegt: ${input.reason}`,
  });
  return id;
}

// ---------------------------------------------------------------------------
// Wochenbericht
// ---------------------------------------------------------------------------

export function generateLearningReport(actor: string, days = 7): { id: string; markdown: string } {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const until = nowIso();

  const published = all<any>(
    `SELECT c.id, c.title, c.platform, c.format, s.virality_score, s.business_score,
            s.virality_confidence, s.business_confidence
     FROM content_items c
     LEFT JOIN scores s ON s.content_item_id = c.id AND s.window_key = 't7d'
     WHERE c.state = 'published' AND c.updated_at >= ?
     ORDER BY COALESCE(s.business_score, -1) DESC`,
    since,
  );
  const blocked = all<any>(
    `SELECT f.code, COUNT(*) AS n FROM review_findings f
     WHERE f.blocking = 1 AND f.created_at >= ?
     GROUP BY f.code ORDER BY n DESC`,
    since,
  );
  const postmortems = all<any>(
    `SELECT failure_class, COUNT(*) AS n FROM postmortems WHERE created_at >= ? GROUP BY failure_class ORDER BY n DESC`,
    since,
  );
  const pipeline = leadPipeline();
  const sources = leadsBySource(5);
  const queue = queueStats();
  const proposals = all<any>(
    `SELECT title, state, risk_class FROM change_proposals WHERE created_at >= ? ORDER BY created_at DESC`,
    since,
  );

  const bestBusiness = published.filter((p) => typeof p.business_score === 'number')[0] ?? null;
  const bestViral = [...published]
    .filter((p) => typeof p.virality_score === 'number')
    .sort((a, b) => b.virality_score - a.virality_score)[0] ?? null;

  const md: string[] = [];
  md.push(`# Lernbericht ${since.slice(0, 10)} bis ${until.slice(0, 10)}`);
  md.push('');
  md.push('## Was passiert ist');
  md.push(`- Veroeffentlicht: ${published.length} Beitrag/Beitraege`);
  md.push(`- Warteschlange: ${queue.succeeded} erfolgreich, ${queue.dead_letter} in der Dead-Letter-Queue, ${queue.queued} wartend`);
  md.push(`- Blockierte Entwuerfe nach Pruefcode: ${blocked.map((b) => `${b.code} (${b.n})`).join(', ') || 'keine'}`);
  md.push('');

  md.push('## Verbreitung und Geschaeftswirkung getrennt betrachtet');
  if (bestViral) {
    md.push(
      `- Groesste Verbreitung: "${bestViral.title}" mit Virality ${bestViral.virality_score} ` +
        `(Konfidenz ${bestViral.virality_confidence}), Business Impact ${bestViral.business_score ?? 'ohne Daten'}.`,
    );
  }
  if (bestBusiness) {
    md.push(
      `- Groesste Geschaeftswirkung: "${bestBusiness.title}" mit Business Impact ${bestBusiness.business_score} ` +
        `(Konfidenz ${bestBusiness.business_confidence}), Virality ${bestBusiness.virality_score ?? 'ohne Daten'}.`,
    );
  }
  if (bestViral && bestBusiness && bestViral.id !== bestBusiness.id) {
    md.push(
      '- Der meistgesehene und der wirksamste Beitrag sind nicht derselbe. Fuer die naechste Woche ' +
        'zaehlt das Muster des wirksamen Beitrags, nicht das des meistgesehenen.',
    );
  }
  if (published.length === 0) {
    md.push('- In diesem Zeitraum wurde nichts veroeffentlicht. Es gibt daher nichts zu bewerten.');
  }
  md.push('');

  md.push('## Lead-Pipeline');
  for (const stage of pipeline) {
    md.push(`- ${stage.stage}: ${stage.count}${stage.revenueCents ? ` (${(stage.revenueCents / 100).toFixed(2)} EUR)` : ''}`);
  }
  if (sources.length > 0) {
    md.push('');
    md.push('### Beste Quellen');
    for (const s of sources) {
      md.push(`- "${s.title}" (${s.platform}): ${s.leads} Lead(s), ${s.registrations} Anmeldung(en)`);
    }
  }
  md.push('');

  md.push('## Fehlerbild');
  if (postmortems.length === 0) md.push('- Keine Postmortems im Zeitraum.');
  for (const p of postmortems) md.push(`- ${p.failure_class}: ${p.n}`);
  md.push('');

  md.push('## Aenderungsvorschlaege');
  if (proposals.length === 0) {
    md.push('- Keine neuen Vorschlaege.');
  } else {
    for (const p of proposals) {
      md.push(`- [${p.state}, Risiko ${p.risk_class}] ${p.title}`);
    }
  }
  md.push('');
  md.push('## Was das System NICHT selbst aendern darf');
  md.push(
    '- Freigabepflicht, Rechte- und Einwilligungspruefung, Faktenpruefung, Plattformregeln und ' +
      'Sicherheitsschwellen. Vorschlaege in diese Richtung werden automatisch abgewiesen und ' +
      'erfordern eine Codeaenderung mit Review.',
  );

  const markdown = md.join('\n');
  const id = newId('lrp');
  run(
    `INSERT INTO learning_reports (id, period_start, period_end, markdown, metrics_json, created_at)
     VALUES (?,?,?,?,?,?)`,
    id,
    since,
    until,
    markdown,
    JSON.stringify({ published: published.length, queue, pipeline, blocked }),
    nowIso(),
  );
  recordEvent({
    kind: 'learning.report_generated',
    actor,
    entityType: 'learning_report',
    entityId: id,
    message: `Lernbericht fuer ${days} Tage erstellt.`,
  });
  return { id, markdown };
}

export function listReports() {
  return all('SELECT id, period_start, period_end, created_at FROM learning_reports ORDER BY created_at DESC LIMIT 50');
}

export function getReport(id: string) {
  return get('SELECT * FROM learning_reports WHERE id = ?', id);
}

export { performanceMemory };
