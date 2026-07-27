import type {
  ChatEvent, ChatRequest, RetrievalResult, MemoryRecord, MemoryProposal,
  ActionPreview, Project, TaskItem, Briefing, SystemStatus, SessionUser,
  ImprovementProposal, ToolDescriptor,
} from '@jarvis/shared'

/**
 * Typed API client. Every mutating call carries `x-jarvis-client`, which is the
 * CSRF marker the server requires — a cross-site form post cannot set it.
 */

const BASE = ''

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message)
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'x-jarvis-client': 'web',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  const body = text ? (() => { try { return JSON.parse(text) } catch { return text } })() : null
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && 'message_de' in body)
      ? String((body as { message_de: string }).message_de)
      : `Fehler ${res.status}`
    throw new ApiError(res.status, msg, body)
  }
  return body as T
}

const get = <T>(p: string) => req<T>(p)
const post = <T>(p: string, b?: unknown) => req<T>(p, { method: 'POST', body: JSON.stringify(b ?? {}) })
const patch = <T>(p: string, b: unknown) => req<T>(p, { method: 'PATCH', body: JSON.stringify(b) })
const del = <T>(p: string) => req<T>(p, { method: 'DELETE' })

export const api = {
  /* Auth */
  me: () => get<{ user: SessionUser }>('/api/auth/me'),
  login: (username: string, password: string, totp?: string) =>
    post<{ user: SessionUser }>('/api/auth/login', { username, password, totp }),
  logout: () => post('/api/auth/logout'),
  changePassword: (current: string, next: string) => post('/api/auth/password', { current, next }),
  totpBegin: () => post<{ secret: string; uri: string }>('/api/auth/totp/begin'),
  totpConfirm: (code: string) => post('/api/auth/totp/confirm', { code }),
  totpDisable: (password: string) => post('/api/auth/totp/disable', { password }),
  sessions: () => get<{ sessions: unknown[] }>('/api/auth/sessions'),
  revokeAll: () => post('/api/auth/sessions/revoke-all'),

  /* Conversations */
  conversations: () => get<{ conversations: Array<{ id: string; title: string; updated_at: string; messages: number }> }>('/api/conversations'),
  conversation: (id: string) => get<{ conversation: unknown; messages: ChatMessage[] }>(`/api/conversations/${id}`),
  deleteConversation: (id: string) => del(`/api/conversations/${id}`),

  /* Knowledge */
  search: (query: string, limit = 10) => post<RetrievalResult>('/api/search', { query, limit }),
  sources: (q?: string) => get<{ sources: SourceRow[]; stats: { sources: number; chunks: number; embedded: number } }>(
    `/api/sources${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  source: (id: string) => get<{ source: SourceRow; chunks: Array<{ id: string; loc: string; text: string }>; related: Array<{ kind: string; id: string; title: string }> }>(`/api/sources/${id}`),
  reindex: (force = false) => post<{ job_id: string }>('/api/sources/reindex', { force }),
  graph: () => get<{ nodes: GraphNode[]; edges: GraphEdge[] }>('/api/graph'),

  /* Memory */
  memory: (q?: string, includeDeleted = false) => get<{ memories: MemoryRecord[]; proposals: MemoryProposal[] }>(
    `/api/memory?${new URLSearchParams({ ...(q ? { q } : {}), ...(includeDeleted ? { include_deleted: 'true' } : {}) })}`),
  createMemory: (m: Partial<MemoryRecord>) => post<{ memory: MemoryRecord }>('/api/memory', m),
  updateMemory: (id: string, patchBody: Partial<MemoryRecord>) => patch<{ memory: MemoryRecord }>(`/api/memory/${id}`, patchBody),
  forgetMemory: (id: string, purge = false) => del(`/api/memory/${id}${purge ? '?purge=true' : ''}`),
  restoreMemory: (id: string) => post(`/api/memory/${id}/restore`),
  decideProposal: (id: string, approve: boolean, edited?: Partial<MemoryRecord>) =>
    post<{ memory: MemoryRecord | null }>(`/api/memory/proposals/${id}/decide`, { approve, edited }),
  exportMemory: () => get<{ memories: MemoryRecord[] }>('/api/memory/export'),

  /* Projects & tasks */
  projects: () => get<{ projects: Project[] }>('/api/projects'),
  project: (id: string) => get<{ project: Project; notes: ProjectNote[]; tasks: TaskItem[] }>(`/api/projects/${id}`),
  createProject: (p: { name: string; category?: string; objective?: string }) => post<{ project: Project }>('/api/projects', p),
  updateProject: (id: string, p: Partial<Project>) => patch<{ project: Project }>(`/api/projects/${id}`, p),
  addNote: (id: string, kind: ProjectNote['kind'], body: string) => post<{ id: string }>(`/api/projects/${id}/notes`, { kind, body }),
  tasks: (status?: string) => get<{ tasks: TaskItem[] }>(`/api/tasks${status ? `?status=${status}` : ''}`),
  createTask: (t: { title: string; detail?: string; due_at?: string | null; priority?: number; project_id?: string | null }) =>
    post<{ task: TaskItem }>('/api/tasks', t),
  updateTask: (id: string, t: Partial<TaskItem>) => patch<{ task: TaskItem }>(`/api/tasks/${id}`, t),
  deleteTask: (id: string) => del(`/api/tasks/${id}`),
  briefing: () => get<{ briefing: Briefing; text: string }>('/api/briefing'),

  /* Actions */
  actions: () => get<{ pending: ActionPreview[]; recent: ActionPreview[] }>('/api/actions'),
  decideAction: (id: string, approve: boolean) =>
    post<{ action: ActionPreview; result: { ok: boolean; summary: string } | null }>(`/api/actions/${id}/decide`, { approve }),
  tools: () => get<{ tools: ToolDescriptor[] }>('/api/tools'),

  /* System */
  status: () => get<{ status: SystemStatus; config: Record<string, unknown> }>('/api/status'),
  audit: (action?: string, limit = 100) => get<{ entries: AuditEntry[]; chain: { valid: boolean; entries: number } }>(
    `/api/audit?${new URLSearchParams({ ...(action ? { action } : {}), limit: String(limit) })}`),
  jobs: () => get<{ stats: Record<string, number>; jobs: JobRow[] }>('/api/jobs'),
  cancelJob: (id: string) => post(`/api/jobs/${id}/cancel`),
  backup: () => post<{ backup: { path: string; bytes: number } }>('/api/backup'),

  /* Learning */
  evalMetrics: (days = 30) => get<EvalMetricsResponse>(`/api/eval/metrics?days=${days}`),
  correction: (c: CorrectionBody) => post<{ id: string; proposals: ImprovementProposal[] }>('/api/eval/corrections', c),
  proposals: () => get<{ proposals: ImprovementProposal[] }>('/api/eval/proposals'),
  decideImprovement: (id: string, status: 'approved' | 'rejected' | 'deployed' | 'rolled_back') =>
    post(`/api/eval/proposals/${id}/decide`, { status }),
  regression: () => get<{ cases: RegressionCase[] }>('/api/eval/regression'),
  addRegression: (c: { name: string; question: string; expectation: RegressionCase['expectation'] }) =>
    post<{ id: string }>('/api/eval/regression', c),
  runEval: (tier?: 'retrieval' | 'full') => post<{ run: EvalRun }>('/api/eval/run', { tier }),
  prompts: (key: string) => get<{ versions: PromptVersion[] }>(`/api/prompts/${key}`),
  createPrompt: (key: string, body: string, notes: string) => post(`/api/prompts/${key}`, { body, notes }),
  activatePrompt: (key: string, version: number) => post(`/api/prompts/${key}/activate`, { version }),
}

/* ── Streaming chat ──────────────────────────────────────────────────────── */

/**
 * POSTs a turn and parses the SSE response. Uses fetch + a reader rather than
 * EventSource because EventSource cannot POST a body or send headers.
 */
export async function streamChat(
  body: ChatRequest, onEvent: (e: ChatEvent) => void, signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-jarvis-client': 'web' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '')
    throw new ApiError(res.status, t || `Fehler ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by a blank line; a frame may split across chunks.
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue      // ': ping' keep-alives
        try { onEvent(JSON.parse(line.slice(6)) as ChatEvent) } catch { /* partial frame */ }
      }
    }
  }
}

/* ── Response shapes not covered by @jarvis/shared ───────────────────────── */

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  text: string
  citations: RetrievalResult['citations']
  mode: string | null
  created_at: string
  latency_ms: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
}

export interface SourceRow {
  id: string; title: string; uri: string; kind: string
  modified_at: string | null; indexed_at: string; active: number
  error: string | null; superseded_by: string | null; tags: string; bytes: number
}

export interface GraphNode { id: string; title: string; kind: string; modified_at: string | null; superseded_by: string | null; chunks: number }
export interface GraphEdge { from_id: string; to_id: string; kind: string; weight: number }
export interface ProjectNote { id: string; kind: 'decision' | 'open_question' | 'risk' | 'next_action'; body: string; resolved: number; created_at: string }
export interface AuditEntry { id: string; at: string; actor: string; action: string; subject: string; outcome: string; detail: Record<string, unknown> }
export interface JobRow { id: string; kind: string; status: string; attempts: number; max_attempts: number; last_error: string | null; created_at: string }
export interface PromptVersion { id: string; key: string; version: number; body: string; active: boolean; notes: string; created_at: string }
export interface RegressionCase {
  id: string; name: string; question: string; origin: string
  expectation: { must_contain: string[]; must_cite: string[]; must_not_contain: string[]; must_refuse: boolean }
}
export interface EvalRun { id: string; label: string; tier: string; passed: number; failed: number; score: number; cases: Array<{ name: string; passed: boolean; failures: string[] }> }
export interface CorrectionBody {
  message_id?: string | null
  category: string
  what_went_wrong: string
  expected?: string
  severity?: 'low' | 'medium' | 'high'
  question?: string
}
export interface EvalMetricsResponse {
  metrics: {
    window_days: number; interactions: number; corrections: number; correction_rate: number
    grounded_rate: number | null; avg_citations: number; p50_latency_ms: number; p95_latency_ms: number
    flag_counts: Record<string, number>; by_category: Record<string, number>
  }
  runs: Array<{ id: string; label: string; passed: number; failed: number; score: number; created_at: string }>
  corrections: Array<{ id: string; category: string; what_went_wrong: string; created_at: string }>
}
