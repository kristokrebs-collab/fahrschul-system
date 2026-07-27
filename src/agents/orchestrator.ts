/**
 * Orchestrator.
 *
 * Er fuehrt die Fachagenten in fester Reihenfolge aus und loest Konflikte
 * nach einer einfachen, nachvollziehbaren Rangordnung:
 *
 *   1. Brand Voice Guardian, Fact Verifier, Privacy Reviewer und
 *      Platform Compliance Reviewer haben Vetorecht. Ein einziges
 *      blockierendes Finding beendet den Weg zur Freigabe.
 *   2. Der Red-Team Critic kann nicht blockieren, aber seine Einwaende
 *      erscheinen auf der Freigabekarte. Der Inhaber entscheidet.
 *   3. Ueber allem steht das Freigabe-Gate: selbst ein makelloser Beitrag
 *      wird ohne ausdrueckliche Entscheidung des Inhabers nicht veroeffentlicht.
 *
 * Der Orchestrator erzeugt selbst nichts und hebt kein Veto auf. Er
 * protokolliert nur, wer was entschieden hat.
 */
import { all, get, run, nowIso, tx } from '../db/index.js';
import { recordEvent } from '../observability/logger.js';
import {
  createContentItem,
  getContentItem,
  ContentItem,
  addFinding,
  clearFindings,
  openFindings,
  setState,
} from '../domain/content.js';
import { recordUsage } from '../domain/media.js';
import { REVIEW_AGENTS, Finding } from './reviewers.js';
import { produce } from './creative.js';
import { llmMode } from './llm.js';

export interface AgentRole {
  key: string;
  name: string;
  responsibility: string;
  veto: boolean;
  implementation: 'rule_engine' | 'llm_or_deterministic' | 'service';
}

/** Die fuenfzehn geforderten Rollen und wo sie im System sitzen. */
export const AGENT_ROLES: AgentRole[] = [
  { key: 'chief_content_strategist', name: 'Chief Content Strategist', responsibility: '30-Tage-Strategie, Wochenplan, Formatmischung, Saettigungsausgleich', veto: false, implementation: 'llm_or_deterministic' },
  { key: 'local_audience_researcher', name: 'Local Audience Researcher', responsibility: 'Themenchancen fuer Fulda und Bad Hersfeld, Bewertung auf zehn Dimensionen', veto: false, implementation: 'llm_or_deterministic' },
  { key: 'brand_voice_guardian', name: 'Brand Voice Guardian', responsibility: 'Markenstimme, verbotene Phrasen, Spezifitaetstest, idiomatisches Deutsch', veto: true, implementation: 'rule_engine' },
  { key: 'archive_rights_curator', name: 'Archive and Rights Curator', responsibility: 'Auswahl freigegebenen Bestandsmaterials, Vorrang vor Generierung', veto: false, implementation: 'service' },
  { key: 'reel_shorts_producer', name: 'Reel/Shorts Producer', responsibility: 'Vertikale Kurzvideos: Hooks, Schnittliste, Untertitel, Cover', veto: false, implementation: 'llm_or_deterministic' },
  { key: 'carousel_copy_specialist', name: 'Carousel and Copy Specialist', responsibility: 'Bildstrecken, Einzelbilder, Begleittexte, Alternativtexte', veto: false, implementation: 'llm_or_deterministic' },
  { key: 'fact_verifier', name: 'Fact and Regulation Verifier', responsibility: 'Jede Zahl, jeder Preis, jede Rechtsaussage muss belegt sein', veto: true, implementation: 'rule_engine' },
  { key: 'privacy_consent_reviewer', name: 'Privacy and Consent Reviewer', responsibility: 'Personenbezug, Minderjaehrige, Kennzeichen, Dokumente, Rechtestatus', veto: true, implementation: 'rule_engine' },
  { key: 'platform_compliance_reviewer', name: 'Platform Compliance Reviewer', responsibility: 'Plattformregeln, Hashtag-Grenzen, Barrierefreiheit, Interaktions-Koeder', veto: true, implementation: 'rule_engine' },
  { key: 'publishing_operator', name: 'Publishing Operator', responsibility: 'Warteschlange, Idempotenz, Wiederholung, Zustellpruefung', veto: false, implementation: 'service' },
  { key: 'community_lead_analyst', name: 'Community and Lead Analyst', responsibility: 'Posteingang, Klassifikation, Antwortentwuerfe, Lead-Pipeline', veto: false, implementation: 'llm_or_deterministic' },
  { key: 'performance_analyst', name: 'Performance Analyst', responsibility: 'Kennzahlen, getrennte Virality- und Business-Bewertung', veto: false, implementation: 'service' },
  { key: 'experimentation_scientist', name: 'Experimentation Scientist', responsibility: 'Eine Variable je Test, Mindeststichprobe, Confounder benennen', veto: false, implementation: 'service' },
  { key: 'reliability_engineer', name: 'Reliability Engineer', responsibility: 'Health-Checks, Alarme, Dead-Letter-Queue, Wiederherstellung', veto: false, implementation: 'service' },
  { key: 'red_team_critic', name: 'Red-Team Critic', responsibility: 'Reputationsrisiken, schwache Hooks, fehlender Zielgruppenbezug', veto: false, implementation: 'rule_engine' },
];

export interface ReviewResult {
  itemId: string;
  findings: Finding[];
  blocking: Finding[];
  warnings: Finding[];
  passed: boolean;
  state: ContentItem['state'];
}

/**
 * Fuehrt alle pruefenden Agenten aus und schreibt die Befunde.
 * Bestehende offene Befunde werden vorher geloescht, damit eine Korrektur
 * nicht dauerhaft von einem alten Befund blockiert wird.
 */
export function review(itemId: string, actor: string): ReviewResult {
  const item = getContentItem(itemId);
  if (!item) throw new Error(`Content-Item ${itemId} nicht gefunden.`);

  return tx(() => {
    clearFindings(itemId);
    const findings: Finding[] = [];

    for (const agent of REVIEW_AGENTS) {
      let produced: Finding[];
      try {
        produced = agent.run(item);
      } catch (err) {
        // Ein abgestuerzter Pruefer darf niemals als "bestanden" gelten.
        produced = [
          {
            agent: agent.key,
            severity: 'block',
            code: 'REVIEW_AGENT_ERROR',
            message:
              `Der Pruefer "${agent.name}" ist mit einem Fehler abgebrochen: ${(err as Error).message}. ` +
              'Solange die Pruefung nicht durchlaeuft, gibt es keine Freigabe.',
            blocking: true,
          },
        ];
      }
      for (const f of produced) {
        // Nur Veto-berechtigte Agenten koennen wirklich blockieren.
        const blocking = f.blocking && (agent.veto || f.code === 'REVIEW_AGENT_ERROR');
        addFinding(itemId, f.agent, blocking ? 'block' : f.severity === 'block' ? 'warn' : f.severity, f.code, f.message, blocking, f.evidence ?? {});
        findings.push({ ...f, blocking });
      }
    }

    const blocking = findings.filter((f) => f.blocking);
    const warnings = findings.filter((f) => !f.blocking && f.severity !== 'info');
    const passed = blocking.length === 0;

    const newState = passed ? 'awaiting_approval' : 'in_review';
    run('UPDATE content_items SET state = ?, updated_at = ? WHERE id = ?', newState, nowIso(), itemId);

    recordEvent({
      kind: 'agent.review.completed',
      actor,
      entityType: 'content_item',
      entityId: itemId,
      severity: passed ? 'info' : 'warn',
      message: passed
        ? `Alle Pruefungen bestanden (${warnings.length} Hinweis(e)). Wartet auf Freigabe durch den Inhaber.`
        : `${blocking.length} blockierende(r) Befund(e): ${blocking.map((b) => b.code).join(', ')}`,
      detail: {
        blocking: blocking.map((b) => ({ code: b.code, agent: b.agent })),
        warnings: warnings.map((w) => ({ code: w.code, agent: w.agent })),
      },
    });

    return { itemId, findings, blocking, warnings, passed, state: newState as ContentItem['state'] };
  });
}

export interface PipelineResult {
  itemId: string;
  mode: string;
  assetNote: string;
  review: ReviewResult;
}

/**
 * Vollstaendiger Weg von einer Planposition zum freigabebereiten Beitrag:
 * Archivkuration -> Produktion -> Content-Item -> alle Pruefungen.
 * Endet immer VOR der Veroeffentlichung.
 */
export async function runProductionPipeline(
  planItemId: string,
  actor: string,
  opts?: { accountId?: string | null },
): Promise<PipelineResult> {
  const plan = get<any>('SELECT * FROM plan_items WHERE id = ?', planItemId);
  if (!plan) throw new Error(`Planposition ${planItemId} nicht gefunden.`);

  const { mode, pkg, assets, assetNote } = await produce(planItemId, actor);

  const accountId =
    opts?.accountId ??
    get<{ id: string }>(
      `SELECT id FROM platform_accounts WHERE platform = ? AND status = 'connected' ORDER BY is_public DESC LIMIT 1`,
      plan.platform,
    )?.id ??
    get<{ id: string }>('SELECT id FROM platform_accounts WHERE platform = ? LIMIT 1', plan.platform)?.id ??
    null;

  const item = createContentItem({
    planItemId,
    platform: plan.platform,
    accountId,
    format: plan.format,
    title: pkg.title,
    hookVariants: pkg.hookVariants ?? [],
    script: pkg.script ?? '',
    shotList: pkg.shotList ?? [],
    edl: pkg.edl ?? [],
    onScreenText: pkg.onScreenText ?? [],
    subtitlesSrt: pkg.subtitlesSrt ?? null,
    caption: pkg.caption ?? '',
    coverConcept: pkg.coverConcept ?? null,
    altText: pkg.altText ?? '',
    cta: pkg.cta ?? plan.cta,
    hashtags: (pkg.hashtags ?? []).slice(0, 5),
    storyFollowup: pkg.storyFollowup ?? [],
    pinComment: pkg.pinComment ?? null,
    firstHourPlan: pkg.firstHourPlan ?? null,
    assetIds: assets.map((a) => a.asset.id),
    scheduledFor: plan.proposed_publish_at,
    actor,
  });

  for (const a of assets) recordUsage(a.asset.id, item.id);
  run('UPDATE plan_items SET status = ?, updated_at = ? WHERE id = ?', 'produced', nowIso(), planItemId);

  const reviewResult = review(item.id, actor);

  recordEvent({
    kind: 'agent.pipeline.completed',
    actor,
    entityType: 'content_item',
    entityId: item.id,
    message:
      `Pipeline abgeschlossen (Erzeugungsmodus: ${mode}). ` +
      `${reviewResult.passed ? 'Bereit zur Freigabe.' : 'Blockiert.'} ${assetNote}`,
  });

  return { itemId: item.id, mode, assetNote, review: reviewResult };
}

/** Statusuebersicht fuer die Systemzustands-Ansicht. */
export function agentStatus() {
  const mode = llmMode();
  return AGENT_ROLES.map((role) => ({
    ...role,
    active:
      role.implementation === 'rule_engine' || role.implementation === 'service'
        ? true
        : mode === 'anthropic',
    note:
      role.implementation === 'llm_or_deterministic' && mode !== 'anthropic'
        ? 'Laeuft im deterministischen Kompositionsmodus - keine LLM-Zugangsdaten hinterlegt.'
        : role.implementation === 'rule_engine'
          ? 'Deterministisches Regelwerk (bewusst kein LLM, damit das Veto nicht verhandelbar ist).'
          : 'Aktiv.',
  }));
}

/**
 * Erneute Pruefung aller Beitraege, die noch nicht veroeffentlicht sind.
 * Wird taeglich vom Scheduler aufgerufen: eine zurueckgezogene Einwilligung
 * oder eine abgelaufene Lizenz muss auch einen bereits freigegebenen,
 * eingeplanten Beitrag wieder stoppen.
 */
export function revalidatePending(actor: string): { checked: number; nowBlocked: string[] } {
  const pending = all<ContentItem>(
    `SELECT * FROM content_items WHERE state IN ('awaiting_approval','approved','scheduled')`,
  );
  const nowBlocked: string[] = [];
  for (const item of pending) {
    const result = review(item.id, actor);
    if (!result.passed) {
      nowBlocked.push(item.id);
      if (['approved', 'scheduled'].includes(item.state)) {
        setState(item.id, 'in_review', actor, 'Erneute Pruefung ergab blockierende Befunde');
      }
    }
  }
  if (nowBlocked.length > 0) {
    recordEvent({
      kind: 'agent.revalidation.blocked',
      actor,
      severity: 'warn',
      message: `${nowBlocked.length} bereits freigegebene(r) Beitrag/Beitraege wurden bei erneuter Pruefung blockiert.`,
      detail: { items: nowBlocked },
    });
  }
  return { checked: pending.length, nowBlocked };
}

export { openFindings };
