/**
 * Freigabe-Gate.
 *
 * Es gibt genau einen Weg, wie ein Inhalt oeffentlich werden kann:
 *   awaiting_approval -> (Owner-Entscheidung) -> approved/scheduled -> publish_job
 *
 * Der Weg ist dreifach abgesichert:
 *   1. Diese Servicefunktionen pruefen Rolle, Rechte, Fakten und Hash.
 *   2. `publish_jobs` traegt den freigegebenen Hash und wird gegen den
 *      aktuellen Inhalt geprueft (siehe queue/publisher).
 *   3. Ein DB-Trigger lehnt jeden Job ab, dessen Item nicht freigegeben ist
 *      oder dessen Hash nicht passt (Migration 10).
 *
 * Selbst wenn die Anwendungsschicht einen Fehler hat, kann kein
 * unfreigegebener Inhalt in die Warteschlange gelangen.
 */
import { all, get, run, nowIso, tx } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { recordEvent } from '../observability/logger.js';
import {
  ContentItem,
  getContentItem,
  computeContentHash,
  openFindings,
  assetRightsBlockers,
  publishRelevantView,
  setState,
} from './content.js';

export type ApprovalDecision =
  | 'approve_once'
  | 'approve_with_edits'
  | 'reject'
  | 'return_to_concept'
  | 'schedule'
  | 'publish_now'
  | 'cancel';

export interface Approval {
  id: string;
  content_item_id: string;
  content_hash: string;
  decision: ApprovalDecision;
  decided_by: string;
  decided_at: string;
  note: string | null;
  edits_json: string;
  scheduled_for: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export interface ApprovalCard {
  item: ContentItem;
  platform: string;
  accountLabel: string;
  accountIsPublic: boolean;
  preview: ReturnType<typeof publishRelevantView>;
  assets: { id: string; kind: string; url: string | null; blockers: string[] }[];
  publishAt: string | null;
  rightsChecks: { label: string; ok: boolean; detail: string }[];
  factChecks: { label: string; ok: boolean; detail: string }[];
  unresolvedRisks: { code: string; severity: string; message: string; blocking: boolean }[];
  objective: string | null;
  versionHistory: { version: number; change_summary: string; created_at: string; created_by: string }[];
  canApprove: boolean;
  blockingReasons: string[];
  contentHash: string;
}

/**
 * Baut die Freigabekarte: exakt das, was veroeffentlicht wuerde, plus alle
 * offenen Risiken. Wenn `canApprove` false ist, nennt `blockingReasons`
 * den Grund im Klartext - keine ausgegrauten Buttons ohne Erklaerung.
 */
export function buildApprovalCard(itemId: string): ApprovalCard {
  const item = getContentItem(itemId);
  if (!item) throw new Error(`Content-Item ${itemId} nicht gefunden.`);

  const preview = publishRelevantView(item);
  const findings = openFindings(itemId);
  const rightsBlockers = assetRightsBlockers(item);

  const assets = preview.assetIds.map((id) => {
    const a = get<any>('SELECT id, kind, url FROM media_assets WHERE id = ?', id);
    return {
      id,
      kind: a?.kind ?? 'unbekannt',
      url: a?.url ?? null,
      blockers: rightsBlockers.filter((b) => b.startsWith(`Asset ${id}:`)),
    };
  });

  const account = item.account_id
    ? get<any>('SELECT * FROM platform_accounts WHERE id = ?', item.account_id)
    : null;

  const rightsChecks = [
    {
      label: 'Nutzungsrechte aller Medien geklaert',
      ok: rightsBlockers.length === 0,
      detail: rightsBlockers.length === 0 ? 'Alle referenzierten Assets sind freigegeben.' : rightsBlockers.join(' | '),
    },
    {
      label: 'Keine erkennbaren Kennzeichen / Dokumente',
      ok: !rightsBlockers.some((b) => b.includes('Kennzeichen')),
      detail: rightsBlockers.filter((b) => b.includes('Kennzeichen')).join(' | ') || 'Keine Beanstandung.',
    },
  ];

  const factFindings = findings.filter((f) => f.code.startsWith('FACT_'));
  const factChecks = [
    {
      label: 'Alle Tatsachenbehauptungen belegt',
      ok: factFindings.length === 0,
      detail: factFindings.length === 0 ? 'Keine unbelegte Behauptung gefunden.' : factFindings.map((f) => f.message).join(' | '),
    },
  ];

  const blockingReasons: string[] = [];
  if (item.state === 'published') blockingReasons.push('Beitrag ist bereits veroeffentlicht.');
  if (item.state === 'cancelled') blockingReasons.push('Beitrag wurde abgebrochen.');
  for (const f of findings.filter((f) => f.blocking === 1)) {
    blockingReasons.push(`${f.code}: ${f.message}`);
  }
  for (const b of rightsBlockers) blockingReasons.push(b);
  if (!item.account_id) {
    blockingReasons.push('Kein Zielkonto zugeordnet. Bitte in den Einstellungen ein Konto verbinden und zuweisen.');
  } else if (account && account.status !== 'connected') {
    blockingReasons.push(
      `Zielkonto "${account.handle}" ist nicht verbunden (Status: ${account.status}). Veroeffentlichung wuerde fehlschlagen.`,
    );
  }

  const versionHistory = all<any>(
    'SELECT version, change_summary, created_at, created_by FROM content_versions WHERE content_item_id = ? ORDER BY version DESC LIMIT 20',
    itemId,
  );

  const planItem = item.plan_item_id
    ? get<any>('SELECT objective FROM plan_items WHERE id = ?', item.plan_item_id)
    : null;

  return {
    item,
    platform: item.platform,
    accountLabel: account ? `${account.display_name} (@${account.handle})` : 'kein Konto zugeordnet',
    accountIsPublic: account ? account.is_public === 1 : false,
    preview,
    assets,
    publishAt: item.scheduled_for,
    rightsChecks,
    factChecks,
    unresolvedRisks: findings.map((f) => ({
      code: f.code,
      severity: f.severity,
      message: f.message,
      blocking: f.blocking === 1,
    })),
    objective: planItem?.objective ?? null,
    versionHistory,
    canApprove: blockingReasons.length === 0,
    blockingReasons,
    contentHash: item.content_hash,
  };
}

export interface DecisionInput {
  itemId: string;
  decision: ApprovalDecision;
  userId: string;
  userRole: string;
  actor: string;
  note?: string | null;
  edits?: { field: string; value: unknown }[];
  scheduledFor?: string | null;
  /**
   * Der Hash, den der Freigebende auf dem Bildschirm hatte. Stimmt er nicht
   * mehr mit dem aktuellen Inhalt ueberein, wurde parallel geaendert und die
   * Entscheidung wird abgelehnt.
   */
  seenHash: string;
}

export class ApprovalError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

const APPROVING_DECISIONS: ApprovalDecision[] = [
  'approve_once',
  'approve_with_edits',
  'schedule',
  'publish_now',
];

/**
 * Nimmt eine Freigabeentscheidung entgegen.
 * Nur die Rolle `owner` darf freigeben. `editor` darf vorbereiten und
 * ablehnen, aber nichts oeffentlich machen.
 */
export function decide(input: DecisionInput): { approval: Approval; item: ContentItem } {
  const item = getContentItem(input.itemId);
  if (!item) throw new ApprovalError(`Content-Item ${input.itemId} nicht gefunden.`, 'NOT_FOUND');

  const isApproving = APPROVING_DECISIONS.includes(input.decision);

  if (isApproving && input.userRole !== 'owner') {
    throw new ApprovalError(
      'Nur der Inhaber darf Inhalte freigeben. Ihre Rolle erlaubt Vorbereitung, aber keine Veroeffentlichung.',
      'FORBIDDEN_ROLE',
    );
  }

  // Schutz gegen "der Inhalt hat sich geaendert, waehrend die Karte offen war".
  const currentHash = computeContentHash(item);
  if (currentHash !== item.content_hash) {
    run('UPDATE content_items SET content_hash = ? WHERE id = ?', currentHash, item.id);
  }
  if (isApproving && input.seenHash !== currentHash) {
    throw new ApprovalError(
      'Der Inhalt wurde geaendert, seit die Freigabekarte geoeffnet wurde. Bitte erneut pruefen und dann freigeben.',
      'STALE_VIEW',
    );
  }

  if (isApproving) {
    const card = buildApprovalCard(input.itemId);
    if (!card.canApprove) {
      throw new ApprovalError(
        `Freigabe nicht moeglich: ${card.blockingReasons.join(' | ')}`,
        'BLOCKED',
      );
    }
  }

  return tx(() => {
    // Bei einer neuen Entscheidung werden aeltere offene Freigaben widerrufen,
    // damit es immer genau eine gueltige Freigabe pro Inhalt gibt.
    run(
      `UPDATE approvals SET revoked_at = ?, revoked_reason = ?
       WHERE content_item_id = ? AND revoked_at IS NULL`,
      nowIso(),
      'Ersetzt durch eine neuere Entscheidung.',
      input.itemId,
    );

    const id = newId('apr');
    run(
      `INSERT INTO approvals
        (id, content_item_id, content_hash, decision, decided_by, decided_at, note, edits_json, scheduled_for)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id,
      input.itemId,
      currentHash,
      input.decision,
      input.userId,
      nowIso(),
      input.note ?? null,
      JSON.stringify(input.edits ?? []),
      input.scheduledFor ?? item.scheduled_for ?? null,
    );

    let newState: ContentItem['state'];
    switch (input.decision) {
      case 'approve_once':
      case 'approve_with_edits':
        newState = 'approved';
        break;
      case 'schedule':
        newState = 'scheduled';
        if (input.scheduledFor) {
          run('UPDATE content_items SET scheduled_for = ? WHERE id = ?', input.scheduledFor, input.itemId);
        }
        break;
      case 'publish_now':
        newState = 'approved';
        break;
      case 'reject':
        newState = 'rejected';
        break;
      case 'return_to_concept':
        newState = 'draft';
        break;
      case 'cancel':
        newState = 'cancelled';
        break;
    }
    run('UPDATE content_items SET state = ?, updated_at = ? WHERE id = ?', newState, nowIso(), input.itemId);

    recordEvent({
      kind: 'approval.decided',
      actor: input.actor,
      entityType: 'content_item',
      entityId: input.itemId,
      severity: isApproving ? 'warn' : 'info',
      message: `Freigabeentscheidung "${input.decision}" durch ${input.actor}. Neuer Zustand: ${newState}.`,
      detail: {
        approvalId: id,
        contentHash: currentHash,
        note: input.note ?? null,
        scheduledFor: input.scheduledFor ?? null,
      },
    });

    return {
      approval: get<Approval>('SELECT * FROM approvals WHERE id = ?', id)!,
      item: getContentItem(input.itemId)!,
    };
  });
}

/** Aktuell gueltige Freigabe fuer einen Inhalt, sofern der Hash noch passt. */
export function validApproval(itemId: string): Approval | undefined {
  const item = getContentItem(itemId);
  if (!item) return undefined;
  return get<Approval>(
    `SELECT * FROM approvals
     WHERE content_item_id = ? AND content_hash = ? AND revoked_at IS NULL
       AND decision IN ('approve_once','approve_with_edits','schedule','publish_now')
     ORDER BY decided_at DESC LIMIT 1`,
    itemId,
    item.content_hash,
  );
}

export function revokeApproval(itemId: string, reason: string, actor: string): number {
  const r = run(
    `UPDATE approvals SET revoked_at = ?, revoked_reason = ?
     WHERE content_item_id = ? AND revoked_at IS NULL`,
    nowIso(),
    reason,
    itemId,
  );
  if (r.changes > 0) {
    const item = getContentItem(itemId);
    if (item && ['approved', 'scheduled'].includes(item.state)) {
      setState(itemId, 'awaiting_approval', actor, 'Freigabe widerrufen');
    }
    recordEvent({
      kind: 'approval.revoked',
      actor,
      severity: 'warn',
      entityType: 'content_item',
      entityId: itemId,
      message: `Freigabe widerrufen: ${reason}`,
    });
  }
  return r.changes;
}

export function approvalQueue(): ApprovalCard[] {
  const items = all<ContentItem>(
    `SELECT * FROM content_items
     WHERE state IN ('awaiting_approval','in_review')
     ORDER BY COALESCE(scheduled_for, updated_at) ASC
     LIMIT 50`,
  );
  return items.map((i) => buildApprovalCard(i.id));
}

export function approvalHistory(itemId: string): Approval[] {
  return all<Approval>(
    'SELECT * FROM approvals WHERE content_item_id = ? ORDER BY decided_at DESC',
    itemId,
  );
}
