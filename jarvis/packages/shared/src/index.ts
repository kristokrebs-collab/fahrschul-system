/**
 * @jarvis/shared — the contract between server and web.
 *
 * Everything here is source-only TypeScript (no build step). Both the Fastify
 * server and the Vite web app import from this package, so a change to a wire
 * shape breaks the typecheck on both sides at once — which is the point.
 */
import { z } from 'zod'

export const SYSTEM_ID = 'general-jarvis' as const

/* ────────────────────────────────────────────────────────────────────────────
 * Permission domains
 *
 * The three systems the owner runs are separate failure/permission domains.
 * General JARVIS may *read summaries* from the other two through documented
 * adapters; it never shares their credentials, storage, or write scope.
 * ──────────────────────────────────────────────────────────────────────────── */
export const PermissionDomain = z.enum(['general-jarvis', 'social-autopilot', 'finance-crypto'])
export type PermissionDomain = z.infer<typeof PermissionDomain>

/* ────────────────────────────────────────────────────────────────────────────
 * Action risk taxonomy
 *
 * Every tool declares exactly one risk class. The class — not the tool's own
 * opinion — decides whether a confirmation card is required. See
 * `docs/PERMISSION-MATRIX.md` for the authoritative table.
 * ──────────────────────────────────────────────────────────────────────────── */
export const RiskClass = z.enum([
  'read_only',            // no state change anywhere
  'reversible_write',     // local, undoable (memory write, note edit, task create)
  'external_comm',        // leaves the machine and reaches a human (email, post)
  'destructive',          // deletes or overwrites without a cheap undo
  'financial_security',   // touches money, credentials, or security policy
])
export type RiskClass = z.infer<typeof RiskClass>

/** Risk classes that can never be auto-approved, whatever the owner configures. */
export const ALWAYS_CONFIRM: RiskClass[] = ['external_comm', 'destructive', 'financial_security']

export const ConfirmationMode = z.enum(['always', 'auto_if_rule', 'never_auto'])
export type ConfirmationMode = z.infer<typeof ConfirmationMode>

export const RISK_POLICY: Record<RiskClass, { confirm: ConfirmationMode; label_de: string }> = {
  read_only: { confirm: 'never_auto', label_de: 'Nur lesen' },
  reversible_write: { confirm: 'auto_if_rule', label_de: 'Umkehrbare Änderung' },
  external_comm: { confirm: 'always', label_de: 'Externe Kommunikation' },
  destructive: { confirm: 'always', label_de: 'Destruktiv' },
  financial_security: { confirm: 'always', label_de: 'Finanzen / Sicherheit' },
}

/* ────────────────────────────────────────────────────────────────────────────
 * Evidence provenance
 *
 * Every claim JARVIS surfaces carries one of these. The UI renders them with
 * distinct affordances so "I retrieved this" never looks like "I inferred this".
 * ──────────────────────────────────────────────────────────────────────────── */
export const ClaimKind = z.enum([
  'retrieved_private',  // from the owner's indexed sources, with passage citation
  'user_memory',        // from durable memory the owner approved
  'web_research',       // from a live fetch, with URL + retrieval timestamp
  'system_state',       // from JARVIS's own DB (tasks, projects, jobs)
  'inference',          // reasoned from the above; not itself a source
  'opinion',            // explicitly a judgement call
])
export type ClaimKind = z.infer<typeof ClaimKind>

/* ────────────────────────────────────────────────────────────────────────────
 * Memory
 * ──────────────────────────────────────────────────────────────────────────── */
export const MemoryKind = z.enum([
  'preference',   // durable owner preference
  'fact',         // verified fact about the owner's world
  'decision',     // a project decision and its rationale
  'commitment',   // a promise with a due date
  'hypothesis',   // inferred, explicitly NOT a fact — never surfaced as one
])
export type MemoryKind = z.infer<typeof MemoryKind>

export const Sensitivity = z.enum(['public', 'internal', 'private', 'secret'])
export type Sensitivity = z.infer<typeof Sensitivity>

/** Sensitivity levels that are encrypted at rest and never leave the machine. */
export const ENCRYPTED_AT_REST: Sensitivity[] = ['private', 'secret']

export const MemoryRecord = z.object({
  id: z.string(),
  kind: MemoryKind,
  subject: z.string().min(1).max(200),
  content: z.string().min(1).max(8000),
  sensitivity: Sensitivity,
  confidence: z.number().min(0).max(1),
  provenance: z.string(),
  source_conversation_id: z.string().nullable(),
  project_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  expires_at: z.string().nullable(),
  revision: z.number().int(),
  deleted_at: z.string().nullable(),
})
export type MemoryRecord = z.infer<typeof MemoryRecord>

/** A memory write JARVIS wants to make. Shown verbatim before it is committed. */
export const MemoryProposal = z.object({
  id: z.string(),
  op: z.enum(['create', 'update', 'delete']),
  target_id: z.string().nullable(),
  draft: MemoryRecord.pick({
    kind: true, subject: true, content: true, sensitivity: true,
    confidence: true, provenance: true, project_id: true,
  }).partial({ project_id: true }),
  rationale: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'auto_approved', 'expired']),
  created_at: z.string(),
})
export type MemoryProposal = z.infer<typeof MemoryProposal>

/* ────────────────────────────────────────────────────────────────────────────
 * Retrieval
 * ──────────────────────────────────────────────────────────────────────────── */
export const Citation = z.object({
  chunk_id: z.string(),
  source_id: z.string(),
  source_uri: z.string(),
  source_title: z.string(),
  passage: z.string(),
  loc: z.string(),                     // "Seite 3" / "Zeile 40-58" / "Blatt Umsatz!A1"
  score: z.number(),
  lexical_score: z.number(),
  semantic_score: z.number(),
  modified_at: z.string().nullable(),
  freshness: z.enum(['fresh', 'aging', 'stale', 'unknown']),
  superseded_by: z.string().nullable(),
})
export type Citation = z.infer<typeof Citation>

export const RetrievalConflict = z.object({
  topic: z.string(),
  a: z.string(),
  b: z.string(),
  reason: z.enum(['contradictory_values', 'superseded_version', 'divergent_dates']),
})
export type RetrievalConflict = z.infer<typeof RetrievalConflict>

export const RetrievalResult = z.object({
  citations: z.array(Citation),
  conflicts: z.array(RetrievalConflict),
  coverage: z.enum(['good', 'partial', 'insufficient', 'none']),
  semantic_enabled: z.boolean(),
  query_terms: z.array(z.string()),
  took_ms: z.number(),
})
export type RetrievalResult = z.infer<typeof RetrievalResult>

/* ────────────────────────────────────────────────────────────────────────────
 * Tools & actions
 * ──────────────────────────────────────────────────────────────────────────── */
export const ToolDescriptor = z.object({
  name: z.string(),
  title_de: z.string(),
  description: z.string(),
  domain: PermissionDomain,
  risk: RiskClass,
  reversible: z.boolean(),
  rollback_hint: z.string().nullable(),
  input_schema: z.record(z.unknown()),
  enabled: z.boolean(),
  requires_integration: z.string().nullable(),
})
export type ToolDescriptor = z.infer<typeof ToolDescriptor>

export const ActionPreview = z.object({
  id: z.string(),
  tool: z.string(),
  title_de: z.string(),
  risk: RiskClass,
  target: z.string(),                  // human-readable "what this touches"
  payload: z.record(z.unknown()),      // the EXACT payload that will be sent
  effects: z.array(z.string()),
  reversible: z.boolean(),
  rollback: z.string().nullable(),
  safety_review: z.object({
    verdict: z.enum(['allow', 'confirm', 'block']),
    findings: z.array(z.object({
      code: z.string(),
      severity: z.enum(['info', 'warn', 'critical']),
      message: z.string(),
    })),
    injection_score: z.number(),
    reviewed_by: z.literal('action-safety-reviewer'),
  }),
  // `executing` is observable: a crash mid-flight leaves the row here, and the
  // UI must be able to show "Ausgang unbekannt" rather than a false success.
  status: z.enum(['pending', 'approved', 'executing', 'rejected', 'executed', 'failed', 'expired']),
  conversation_id: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string(),
  result: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
})
export type ActionPreview = z.infer<typeof ActionPreview>

/* ────────────────────────────────────────────────────────────────────────────
 * Chat / streaming
 * ──────────────────────────────────────────────────────────────────────────── */
export const AnswerMode = z.enum(['concise', 'standard', 'deep'])
export type AnswerMode = z.infer<typeof AnswerMode>

export const ChatRequest = z.object({
  conversation_id: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  message: z.string().min(1).max(32000),
  mode: AnswerMode.default('standard'),
  allow_web: z.boolean().default(true),
  language: z.enum(['de', 'en', 'auto']).default('auto'),
})
export type ChatRequest = z.infer<typeof ChatRequest>

/** Server-sent events on `POST /api/chat`. Discriminated on `type`. */
export type ChatEvent =
  | { type: 'start'; conversation_id: string; message_id: string; model: string }
  | { type: 'status'; stage: string; detail?: string }
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'citations'; retrieval: RetrievalResult }
  | { type: 'memory_proposal'; proposal: MemoryProposal }
  | { type: 'action_preview'; action: ActionPreview }
  | { type: 'tool_call'; tool: string; risk: RiskClass; summary: string }
  | { type: 'tool_result'; tool: string; ok: boolean; summary: string }
  | { type: 'usage'; input_tokens: number; output_tokens: number; cache_read_input_tokens: number }
  | { type: 'error'; code: string; message_de: string; recoverable: boolean }
  | { type: 'done'; message_id: string; stop_reason: string | null }

/* ────────────────────────────────────────────────────────────────────────────
 * Projects / chief of staff
 * ──────────────────────────────────────────────────────────────────────────── */
export const ProjectStatus = z.enum(['active', 'paused', 'done', 'archived'])
export type ProjectStatus = z.infer<typeof ProjectStatus>

export const Project = z.object({
  id: z.string(),
  name: z.string().min(1).max(160),
  category: z.string(),
  objective: z.string(),
  current_state: z.string(),
  status: ProjectStatus,
  domain: PermissionDomain,
  created_at: z.string(),
  updated_at: z.string(),
})
export type Project = z.infer<typeof Project>

export const TaskItem = z.object({
  id: z.string(),
  project_id: z.string().nullable(),
  title: z.string().min(1).max(300),
  detail: z.string(),
  status: z.enum(['open', 'in_progress', 'blocked', 'done', 'cancelled']),
  priority: z.number().int().min(1).max(5),
  due_at: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
})
export type TaskItem = z.infer<typeof TaskItem>

export const Briefing = z.object({
  generated_at: z.string(),
  greeting_de: z.string(),
  overdue: z.array(TaskItem),
  due_today: z.array(TaskItem),
  upcoming: z.array(TaskItem),
  open_approvals: z.number().int(),
  open_memory_proposals: z.number().int(),
  projects: z.array(z.object({
    project: Project,
    open_tasks: z.number().int(),
    open_questions: z.array(z.string()),
    next_best_action: z.string().nullable(),
  })),
  conflicts: z.array(z.string()),
  blind_spot: z.object({ risk: z.string(), why: z.string() }).nullable(),
  degraded: z.array(z.string()),
})
export type Briefing = z.infer<typeof Briefing>

/* ────────────────────────────────────────────────────────────────────────────
 * System health
 * ──────────────────────────────────────────────────────────────────────────── */
export const ComponentHealth = z.object({
  name: z.string(),
  status: z.enum(['ok', 'degraded', 'down', 'not_configured']),
  detail_de: z.string(),
  checked_at: z.string(),
})
export type ComponentHealth = z.infer<typeof ComponentHealth>

export const SystemStatus = z.object({
  version: z.string(),
  started_at: z.string(),
  uptime_s: z.number(),
  offline_mode: z.boolean(),
  components: z.array(ComponentHealth),
  queue: z.object({
    pending: z.number().int(), running: z.number().int(),
    failed: z.number().int(), dead: z.number().int(),
  }),
  index: z.object({ sources: z.number().int(), chunks: z.number().int(), embedded: z.number().int() }),
  audit: z.object({ entries: z.number().int(), chain_valid: z.boolean() }),
})
export type SystemStatus = z.infer<typeof SystemStatus>

/* ────────────────────────────────────────────────────────────────────────────
 * Learning loop
 * ──────────────────────────────────────────────────────────────────────────── */
export const CorrectionCategory = z.enum([
  'knowledge_source', 'retrieval', 'reasoning_instruction', 'tool_use',
  'memory', 'integration', 'ui_wording', 'security_policy',
])
export type CorrectionCategory = z.infer<typeof CorrectionCategory>

export const OutcomeFlag = z.enum([
  'ungrounded_claim', 'bad_citation', 'wrong_tool', 'task_incomplete',
  'user_correction', 'stale_data', 'slow', 'failed_action',
  'retrieval_miss', 'memory_error', 'permission_mistake',
])
export type OutcomeFlag = z.infer<typeof OutcomeFlag>

export const ImprovementProposal = z.object({
  id: z.string(),
  category: CorrectionCategory,
  title_de: z.string(),
  rationale: z.string(),
  diff: z.string(),
  target: z.enum(['prompt', 'skill', 'retrieval_config', 'tool_config']),
  target_key: z.string(),
  evidence_correction_ids: z.array(z.string()),
  eval_before: z.number().nullable(),
  eval_after: z.number().nullable(),
  status: z.enum(['draft', 'evaluated', 'approved', 'rejected', 'deployed', 'rolled_back']),
  created_at: z.string(),
})
export type ImprovementProposal = z.infer<typeof ImprovementProposal>

/* ────────────────────────────────────────────────────────────────────────────
 * Auth
 * ──────────────────────────────────────────────────────────────────────────── */
export const Role = z.enum(['owner', 'guest'])
export type Role = z.infer<typeof Role>

export const SessionUser = z.object({
  id: z.string(),
  username: z.string(),
  role: Role,
  totp_enabled: z.boolean(),
})
export type SessionUser = z.infer<typeof SessionUser>

/** Capabilities gated by role. `owner` gets everything; `guest` is read-only. */
export const ROLE_CAPS: Record<Role, string[]> = {
  owner: ['*'],
  // A guest may look, never touch — and never see the key panel.
  guest: ['chat.read', 'sources.read', 'projects.read', 'memory.read', 'status.read'],
}

export function roleAllows(role: Role, cap: string): boolean {
  const caps = ROLE_CAPS[role]
  return caps.includes('*') || caps.includes(cap)
}

/* ────────────────────────────────────────────────────────────────────────────
 * Small shared helpers
 * ──────────────────────────────────────────────────────────────────────────── */
export function freshnessOf(modifiedAt: string | null, now = Date.now()): Citation['freshness'] {
  if (!modifiedAt) return 'unknown'
  const ageDays = (now - Date.parse(modifiedAt)) / 86_400_000
  if (Number.isNaN(ageDays)) return 'unknown'
  if (ageDays <= 90) return 'fresh'
  if (ageDays <= 365) return 'aging'
  return 'stale'
}

/** Not `Record<string, string>`: literal keys keep these non-optional at use sites. */
export const API_ERROR_DE = {
  no_llm_key: 'Kein Anthropic-API-Schlüssel konfiguriert. JARVIS kann suchen und Quellen zeigen, aber nicht frei antworten.',
  llm_unreachable: 'Das Sprachmodell ist nicht erreichbar. Antwort aus Quellen ist weiterhin möglich.',
  rate_limited: 'Zu viele Anfragen. Bitte kurz warten.',
  unauthorized: 'Nicht angemeldet.',
  forbidden: 'Diese Aktion ist für deine Rolle nicht freigegeben.',
  offline: 'Offline-Modus: externe Recherche ist deaktiviert.',
  integration_missing: 'Die benötigte Integration ist nicht konfiguriert.',
  action_expired: 'Die Bestätigung ist abgelaufen. Bitte neu anfordern.',
} as const
