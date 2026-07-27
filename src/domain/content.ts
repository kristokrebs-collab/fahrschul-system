/**
 * Content-Items: das veroeffentlichungsfaehige Paket.
 *
 * Zentrale Invariante: `content_hash` ist der Fingerabdruck genau jener
 * Felder, die bestimmen, was oeffentlich sichtbar wird. Eine Freigabe wird an
 * diesen Hash gebunden. Aendert jemand Medium, Aussage, CTA, Plattform oder
 * Zeitpunkt, aendert sich der Hash und die Freigabe verliert ihre Gueltigkeit.
 * Das ist die technische Umsetzung von "erneute Freigabe nach jeder
 * wesentlichen Aenderung".
 */
import { all, get, run, nowIso, parseJson, tx } from '../db/index.js';
import { newId, contentHash } from '../security/crypto.js';
import { recordEvent } from '../observability/logger.js';
import { getAsset, publishBlockers } from './media.js';

export type ContentState =
  | 'draft'
  | 'in_review'
  | 'rejected'
  | 'awaiting_approval'
  | 'approved'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';

export interface ContentItem {
  id: string;
  plan_item_id: string | null;
  platform: string;
  account_id: string | null;
  format: string;
  title: string;
  hook_variants_json: string;
  script: string;
  shot_list_json: string;
  edl_json: string;
  on_screen_text_json: string;
  subtitles_srt: string | null;
  caption: string;
  cover_concept: string | null;
  alt_text: string;
  cta: string;
  hashtags_json: string;
  story_followup_json: string;
  pin_comment: string | null;
  first_hour_plan: string | null;
  asset_ids_json: string;
  content_hash: string;
  version: number;
  state: ContentState;
  scheduled_for: string | null;
  experiment_id: string | null;
  experiment_variant: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Genau die Felder, die den oeffentlichen Eindruck bestimmen.
 * Bewusst NICHT enthalten: interne Notizen, Shotlist, EDL, Hook-Varianten,
 * die nicht gewaehlt wurden. Diese aendern nichts an dem, was der Nutzer sieht,
 * und sollen keine unnoetige Neu-Freigabe ausloesen.
 */
export interface PublishRelevantView {
  platform: string;
  accountId: string | null;
  format: string;
  caption: string;
  script: string;
  onScreenText: string[];
  subtitles: string | null;
  cta: string;
  hashtags: string[];
  altText: string;
  coverConcept: string | null;
  pinComment: string | null;
  assetIds: string[];
  scheduledFor: string | null;
}

export function publishRelevantView(item: ContentItem): PublishRelevantView {
  return {
    platform: item.platform,
    accountId: item.account_id,
    format: item.format,
    caption: item.caption,
    script: item.script,
    onScreenText: parseJson<string[]>(item.on_screen_text_json, []),
    subtitles: item.subtitles_srt,
    cta: item.cta,
    hashtags: parseJson<string[]>(item.hashtags_json, []),
    altText: item.alt_text,
    coverConcept: item.cover_concept,
    pinComment: item.pin_comment,
    assetIds: parseJson<string[]>(item.asset_ids_json, []),
    scheduledFor: item.scheduled_for,
  };
}

export function computeContentHash(item: ContentItem): string {
  return contentHash(publishRelevantView(item));
}

export interface CreateContentInput {
  planItemId?: string | null;
  platform: string;
  accountId?: string | null;
  format: string;
  title: string;
  hookVariants: string[];
  script: string;
  shotList: unknown[];
  edl: unknown[];
  onScreenText: string[];
  subtitlesSrt?: string | null;
  caption: string;
  coverConcept?: string | null;
  altText: string;
  cta: string;
  hashtags: string[];
  storyFollowup: unknown[];
  pinComment?: string | null;
  firstHourPlan?: string | null;
  assetIds: string[];
  scheduledFor?: string | null;
  experimentId?: string | null;
  experimentVariant?: string | null;
  actor: string;
}

export function createContentItem(input: CreateContentInput): ContentItem {
  const id = newId('itm');
  const now = nowIso();

  return tx(() => {
    run(
      `INSERT INTO content_items
        (id, plan_item_id, platform, account_id, format, title, hook_variants_json, script,
         shot_list_json, edl_json, on_screen_text_json, subtitles_srt, caption, cover_concept,
         alt_text, cta, hashtags_json, story_followup_json, pin_comment, first_hour_plan,
         asset_ids_json, content_hash, version, state, scheduled_for, experiment_id,
         experiment_variant, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'draft',?,?,?,?,?)`,
      id,
      input.planItemId ?? null,
      input.platform,
      input.accountId ?? null,
      input.format,
      input.title,
      JSON.stringify(input.hookVariants),
      input.script,
      JSON.stringify(input.shotList),
      JSON.stringify(input.edl),
      JSON.stringify(input.onScreenText),
      input.subtitlesSrt ?? null,
      input.caption,
      input.coverConcept ?? null,
      input.altText,
      input.cta,
      JSON.stringify(input.hashtags),
      JSON.stringify(input.storyFollowup),
      input.pinComment ?? null,
      input.firstHourPlan ?? null,
      JSON.stringify(input.assetIds),
      'pending',
      input.scheduledFor ?? null,
      input.experimentId ?? null,
      input.experimentVariant ?? null,
      now,
      now,
    );
    const item = get<ContentItem>('SELECT * FROM content_items WHERE id = ?', id)!;
    const hash = computeContentHash(item);
    run('UPDATE content_items SET content_hash = ? WHERE id = ?', hash, id);

    snapshotVersion(id, 1, 'Erstanlage', input.actor);
    recordEvent({
      kind: 'content.created',
      actor: input.actor,
      entityType: 'content_item',
      entityId: id,
      message: `Content-Item angelegt: "${input.title}" (${input.platform}/${input.format})`,
    });
    return get<ContentItem>('SELECT * FROM content_items WHERE id = ?', id)!;
  });
}

export function getContentItem(id: string): ContentItem | undefined {
  return get<ContentItem>('SELECT * FROM content_items WHERE id = ?', id);
}

export function listContentItems(filter?: { state?: ContentState; limit?: number }): ContentItem[] {
  if (filter?.state) {
    return all<ContentItem>(
      'SELECT * FROM content_items WHERE state = ? ORDER BY updated_at DESC LIMIT ?',
      filter.state,
      filter.limit ?? 100,
    );
  }
  return all<ContentItem>(
    'SELECT * FROM content_items ORDER BY updated_at DESC LIMIT ?',
    filter?.limit ?? 100,
  );
}

function snapshotVersion(
  itemId: string,
  version: number,
  changeSummary: string,
  actor: string,
): void {
  const item = get<ContentItem>('SELECT * FROM content_items WHERE id = ?', itemId)!;
  run(
    `INSERT INTO content_versions (id, content_item_id, version, snapshot_json, content_hash, change_summary, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(content_item_id, version) DO NOTHING`,
    newId('cv'),
    itemId,
    version,
    JSON.stringify(item),
    item.content_hash,
    changeSummary,
    nowIso(),
    actor,
  );
}

export function contentVersions(itemId: string) {
  return all(
    'SELECT id, version, content_hash, change_summary, created_at, created_by FROM content_versions WHERE content_item_id = ? ORDER BY version DESC',
    itemId,
  );
}

const MUTABLE_FIELDS: Record<string, string> = {
  title: 'title',
  script: 'script',
  caption: 'caption',
  altText: 'alt_text',
  cta: 'cta',
  coverConcept: 'cover_concept',
  pinComment: 'pin_comment',
  firstHourPlan: 'first_hour_plan',
  subtitlesSrt: 'subtitles_srt',
  platform: 'platform',
  accountId: 'account_id',
  format: 'format',
  scheduledFor: 'scheduled_for',
};
const MUTABLE_JSON_FIELDS: Record<string, string> = {
  hookVariants: 'hook_variants_json',
  onScreenText: 'on_screen_text_json',
  hashtags: 'hashtags_json',
  shotList: 'shot_list_json',
  edl: 'edl_json',
  storyFollowup: 'story_followup_json',
  assetIds: 'asset_ids_json',
};

export interface UpdateResult {
  item: ContentItem;
  hashChanged: boolean;
  previousHash: string;
  approvalInvalidated: boolean;
}

/**
 * Aktualisiert ein Content-Item und stellt fest, ob die Aenderung
 * veroeffentlichungsrelevant war. War sie es und lag eine Freigabe vor,
 * wird die Freigabe automatisch widerrufen und der Zustand faellt zurueck
 * auf `awaiting_approval`.
 */
export function updateContentItem(
  id: string,
  patch: Record<string, unknown>,
  changeSummary: string,
  actor: string,
): UpdateResult {
  const before = getContentItem(id);
  if (!before) throw new Error(`Content-Item ${id} nicht gefunden.`);
  if (['publishing', 'published'].includes(before.state)) {
    throw new Error(
      `Content-Item ${id} ist im Zustand "${before.state}" und kann nicht mehr geaendert werden.`,
    );
  }

  const sets: string[] = [];
  const params: any[] = [];
  for (const [key, column] of Object.entries(MUTABLE_FIELDS)) {
    if (key in patch) {
      sets.push(`${column} = ?`);
      params.push(patch[key] ?? null);
    }
  }
  for (const [key, column] of Object.entries(MUTABLE_JSON_FIELDS)) {
    if (key in patch) {
      sets.push(`${column} = ?`);
      params.push(JSON.stringify(patch[key] ?? []));
    }
  }
  if (sets.length === 0) {
    return { item: before, hashChanged: false, previousHash: before.content_hash, approvalInvalidated: false };
  }

  return tx(() => {
    const newVersion = before.version + 1;
    sets.push('version = ?', 'updated_at = ?');
    params.push(newVersion, nowIso(), id);
    run(`UPDATE content_items SET ${sets.join(', ')} WHERE id = ?`, ...params);

    const afterRaw = getContentItem(id)!;
    const newHash = computeContentHash(afterRaw);
    const hashChanged = newHash !== before.content_hash;
    run('UPDATE content_items SET content_hash = ? WHERE id = ?', newHash, id);

    let approvalInvalidated = false;
    if (hashChanged) {
      const openApproval = get<{ id: string }>(
        `SELECT id FROM approvals
         WHERE content_item_id = ? AND content_hash = ? AND revoked_at IS NULL
           AND decision IN ('approve_once','approve_with_edits','schedule','publish_now')`,
        id,
        before.content_hash,
      );
      if (openApproval) {
        run(
          'UPDATE approvals SET revoked_at = ?, revoked_reason = ? WHERE id = ?',
          nowIso(),
          `Inhalt wurde nach der Freigabe geaendert (${changeSummary}). Erneute Freigabe erforderlich.`,
          openApproval.id,
        );
        approvalInvalidated = true;
      }
      if (['approved', 'scheduled'].includes(afterRaw.state)) {
        run('UPDATE content_items SET state = ? WHERE id = ?', 'awaiting_approval', id);
        approvalInvalidated = true;
      }
    }

    snapshotVersion(id, newVersion, changeSummary, actor);
    recordEvent({
      kind: 'content.updated',
      actor,
      entityType: 'content_item',
      entityId: id,
      severity: approvalInvalidated ? 'warn' : 'info',
      message: approvalInvalidated
        ? `Content-Item geaendert - bestehende Freigabe wurde widerrufen: ${changeSummary}`
        : `Content-Item geaendert: ${changeSummary}`,
      detail: { hashChanged, previousHash: before.content_hash, newHash, version: newVersion },
    });

    return {
      item: getContentItem(id)!,
      hashChanged,
      previousHash: before.content_hash,
      approvalInvalidated,
    };
  });
}

export function setState(id: string, state: ContentState, actor: string, reason?: string): ContentItem {
  run('UPDATE content_items SET state = ?, updated_at = ? WHERE id = ?', state, nowIso(), id);
  recordEvent({
    kind: 'content.state_changed',
    actor,
    entityType: 'content_item',
    entityId: id,
    message: `Zustand -> ${state}${reason ? ` (${reason})` : ''}`,
  });
  return getContentItem(id)!;
}

// --- Pruefmeldungen ---------------------------------------------------------

export interface ReviewFinding {
  id: string;
  content_item_id: string;
  agent: string;
  severity: 'info' | 'warn' | 'block';
  code: string;
  message: string;
  blocking: number;
  evidence_json: string;
  resolved_at: string | null;
  created_at: string;
}

export function addFinding(
  itemId: string,
  agent: string,
  severity: 'info' | 'warn' | 'block',
  code: string,
  message: string,
  blocking: boolean,
  evidence: Record<string, unknown> = {},
): void {
  run(
    `INSERT INTO review_findings (id, content_item_id, agent, severity, code, message, blocking, evidence_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    newId('fnd'),
    itemId,
    agent,
    severity,
    code,
    message,
    blocking ? 1 : 0,
    JSON.stringify(evidence),
    nowIso(),
  );
}

export function clearFindings(itemId: string): void {
  run('DELETE FROM review_findings WHERE content_item_id = ? AND resolved_at IS NULL', itemId);
}

export function openFindings(itemId: string): ReviewFinding[] {
  return all<ReviewFinding>(
    'SELECT * FROM review_findings WHERE content_item_id = ? AND resolved_at IS NULL ORDER BY blocking DESC, created_at',
    itemId,
  );
}

export function resolveFinding(findingId: string, actor: string): void {
  run('UPDATE review_findings SET resolved_at = ? WHERE id = ?', nowIso(), findingId);
  recordEvent({
    kind: 'content.finding_resolved',
    actor,
    entityType: 'review_finding',
    entityId: findingId,
    message: 'Pruefmeldung als erledigt markiert.',
  });
}

/**
 * Rechteprüfung ueber alle im Item referenzierten Assets.
 * Wird sowohl vor der Freigabe als auch unmittelbar vor dem Publizieren
 * erneut ausgefuehrt - eine zurueckgezogene Einwilligung muss auch einen
 * bereits geplanten Beitrag stoppen.
 */
export function assetRightsBlockers(item: ContentItem): string[] {
  const ids = parseJson<string[]>(item.asset_ids_json, []);
  const blockers: string[] = [];
  for (const assetId of ids) {
    const asset = getAsset(assetId);
    if (!asset) {
      blockers.push(`Referenziertes Asset ${assetId} existiert nicht mehr.`);
      continue;
    }
    for (const b of publishBlockers(asset)) {
      blockers.push(`Asset ${assetId}: ${b}`);
    }
  }
  return blockers;
}
