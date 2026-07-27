import type { DB } from '../db/index.js'
import type { Citation, RetrievalResult, RetrievalConflict } from '@jarvis/shared'
import { freshnessOf } from '@jarvis/shared'
import { embeddings, cosine, fromBlob, tokenize } from './embeddings.js'
import { log, errText } from '../core/logger.js'
import { ageDays } from '../util/time.js'

/**
 * Hybrid retrieval.
 *
 * Four independent signals, fused with Reciprocal Rank Fusion:
 *   1. lexical   — FTS5/BM25, exact terms and prefixes
 *   2. semantic  — cosine over embeddings (skipped when no provider)
 *   3. recency   — a mild decay so last month's price list beats 2019's
 *   4. relations — chunks from sources linked to a strong hit get a nudge
 *
 * RRF rather than score-normalised blending: BM25 and cosine live on different
 * scales that shift per query, and rank-based fusion is robust to that without
 * needing calibration.
 */

export interface RetrieveOpts {
  limit?: number
  domain?: string
  projectId?: string | null
  sourceKinds?: string[]
  maxPerSource?: number
  includeSuperseded?: boolean
  minScore?: number
}

interface Row {
  chunk_id: string
  source_id: string
  text: string
  loc: string
  title: string
  uri: string
  kind: string
  modified_at: string | null
  superseded_by: string | null
  trust: string
}

const RRF_K = 60
const DEFAULT_LIMIT = 8

/* ── FTS query construction ──────────────────────────────────────────────── */

/**
 * User text → an FTS5 MATCH expression.
 *
 * Everything is quoted, so punctuation and stray operators from natural German
 * ("Was kostet B197 — inkl. MwSt?") can never be parsed as FTS syntax. Longer
 * terms also get a prefix variant, which is what makes German compounds work.
 */
export function buildFtsQuery(query: string): { expr: string; terms: string[] } {
  const terms = [...new Set(tokenize(query))].slice(0, 24)
  if (!terms.length) return { expr: '', terms: [] }
  const parts = terms.map((t) => {
    const safe = t.replace(/"/g, '')
    return safe.length >= 5 ? `("${safe}" OR "${safe}"*)` : `"${safe}"`
  })
  return { expr: parts.join(' OR '), terms }
}

function baseFilter(opts: RetrieveOpts, params: unknown[]): string {
  const conds = ['s.active = 1']
  if (opts.domain) { conds.push('s.domain = ?'); params.push(opts.domain) }
  if (opts.sourceKinds?.length) {
    conds.push(`s.kind IN (${opts.sourceKinds.map(() => '?').join(',')})`)
    params.push(...opts.sourceKinds)
  }
  if (opts.projectId) {
    conds.push('s.id IN (SELECT source_id FROM project_sources WHERE project_id = ?)')
    params.push(opts.projectId)
  }
  return conds.join(' AND ')
}

/* ── Signal 1: lexical ───────────────────────────────────────────────────── */

function lexicalSearch(db: DB, query: string, opts: RetrieveOpts, k: number): Array<Row & { bm25: number }> {
  const { expr } = buildFtsQuery(query)
  if (!expr) return []
  const params: unknown[] = [expr]
  const where = baseFilter(opts, params)
  params.push(k)
  try {
    return db.prepare(
      `SELECT c.id AS chunk_id, c.source_id, c.text, c.loc,
              s.title, s.uri, s.kind, s.modified_at, s.superseded_by, s.trust,
              bm25(chunks_fts) AS bm25
         FROM chunks_fts
         JOIN chunks c ON c.seq = chunks_fts.rowid
         JOIN sources s ON s.id = c.source_id
        WHERE chunks_fts MATCH ? AND ${where}
        ORDER BY bm25 ASC
        LIMIT ?`,
    ).all(...params) as Array<Row & { bm25: number }>
  } catch (e) {
    log.warn('FTS-Abfrage fehlgeschlagen', { error: errText(e) })
    return []
  }
}

/* ── Signal 2: semantic ──────────────────────────────────────────────────── */

/**
 * Brute-force cosine over every stored vector.
 *
 * At personal-KB scale (tens of thousands of chunks) this is a few milliseconds
 * and always exact — no index to tune, rebuild, or silently drift. See
 * docs/ADR.md for the threshold at which this needs an ANN index instead.
 */
async function semanticSearch(
  db: DB, query: string, opts: RetrieveOpts, k: number,
): Promise<Array<Row & { sim: number }>> {
  const provider = embeddings()
  if (provider.quality === 'none') return []

  const [qv] = await provider.embed([query])
  if (!qv) return []

  const params: unknown[] = []
  const where = baseFilter(opts, params)
  const rows = db.prepare(
    `SELECT c.id AS chunk_id, c.source_id, c.text, c.loc,
            s.title, s.uri, s.kind, s.modified_at, s.superseded_by, s.trust, e.vec
       FROM embeddings e
       JOIN chunks c ON c.id = e.chunk_id
       JOIN sources s ON s.id = c.source_id
      WHERE e.model = ? AND ${where}`,
  ).all(provider.model, ...params) as Array<Row & { vec: Buffer }>

  const scored = rows.map((r) => {
    const { vec, ...rest } = r
    return { ...rest, sim: cosine(qv, fromBlob(vec)) }
  })
  scored.sort((a, b) => b.sim - a.sim)
  return scored.slice(0, k)
}

/* ── Fusion ──────────────────────────────────────────────────────────────── */

interface Fused extends Row {
  rrf: number
  lexical_score: number
  semantic_score: number
  /** Rank in each source list, or null if that signal never returned this chunk. */
  lex_rank: number | null
  sem_rank: number | null
  recency: number
  relation_boost: number
  score: number
}

function recencyWeight(modifiedAt: string | null): number {
  const days = ageDays(modifiedAt)
  if (days === null) return 0.5
  // Half-life of one year: recent enough to matter, gentle enough that an old
  // but perfectly-matching document is not buried.
  return Math.max(0.15, Math.exp(-Math.LN2 * (days / 365)))
}

export async function retrieve(db: DB, query: string, opts: RetrieveOpts = {}): Promise<RetrievalResult> {
  const started = Date.now()
  const limit = opts.limit ?? DEFAULT_LIMIT
  const pool = Math.max(limit * 6, 40)
  const provider = embeddings()

  const lex = lexicalSearch(db, query, opts, pool)
  let sem: Array<Row & { sim: number }> = []
  try {
    sem = await semanticSearch(db, query, opts, pool)
  } catch (e) {
    // Retrieval must degrade, not fail: BM25 alone is still a useful answer.
    log.warn('Semantische Suche fehlgeschlagen – nur Volltext', { error: errText(e) })
  }

  const byId = new Map<string, Fused>()
  const put = (r: Row): Fused => {
    let f = byId.get(r.chunk_id)
    if (!f) {
      f = {
        ...r, rrf: 0, lexical_score: 0, semantic_score: 0,
        lex_rank: null, sem_rank: null,
        recency: recencyWeight(r.modified_at), relation_boost: 0, score: 0,
      }
      byId.set(r.chunk_id, f)
    }
    return f
  }

  lex.forEach((r, i) => {
    const f = put(r)
    f.rrf += 1 / (RRF_K + i + 1)
    // bm25() returns negative numbers, more negative = better.
    f.lexical_score = Math.max(f.lexical_score, Math.max(0, -r.bm25))
    f.lex_rank = f.lex_rank === null ? i : Math.min(f.lex_rank, i)
  })
  sem.forEach((r, i) => {
    const f = put(r)
    f.rrf += 1 / (RRF_K + i + 1)
    f.semantic_score = Math.max(f.semantic_score, r.sim)
    f.sem_rank = f.sem_rank === null ? i : Math.min(f.sem_rank, i)
  })

  if (!byId.size) {
    return {
      citations: [], conflicts: [], coverage: 'none',
      semantic_enabled: provider.quality !== 'none',
      query_terms: buildFtsQuery(query).terms, took_ms: Date.now() - started,
    }
  }

  // Signal 4: sources related to a strong hit get a small lift. This is what
  // surfaces the appendix when the question matched the main document.
  const topSources = [...byId.values()]
    .sort((a, b) => b.rrf - a.rrf).slice(0, 5).map((f) => f.source_id)
  if (topSources.length) {
    const rel = db.prepare(
      `SELECT to_id, max(weight) w FROM relations
        WHERE from_id IN (${topSources.map(() => '?').join(',')}) GROUP BY to_id`,
    ).all(...topSources) as Array<{ to_id: string; w: number }>
    const weights = new Map(rel.map((r) => [r.to_id, r.w]))
    for (const f of byId.values()) {
      if (topSources.includes(f.source_id)) continue
      const w = weights.get(f.source_id)
      if (w) f.relation_boost = 0.15 * w
    }
  }

  for (const f of byId.values()) {
    // Superseded sources are demoted, never dropped — the owner still needs to
    // see that an older answer exists, flagged as such.
    const supersededPenalty = f.superseded_by && !opts.includeSuperseded ? 0.45 : 1
    f.score = (f.rrf * (1 + 0.35 * f.recency) + f.relation_boost) * supersededPenalty
  }

  const ranked = [...byId.values()].sort((a, b) => b.score - a.score)

  // Relevance floor.
  //
  // An OR-ed FTS query over a dense vector space means almost every chunk
  // scores *something*, and RRF compresses the spread (every hit starts around
  // 1/(k+1)), so a ratio test on the fused score barely discriminates. Filter
  // on the underlying evidence instead: a chunk survives if it matched a
  // keyword, or if its similarity is high in absolute *and* relative terms.
  // Without this, "Was kostet eine Fahrstunde?" cites an unrelated project note
  // and the answer looks sourced when it is not.
  const topSem = Math.max(...ranked.map((f) => f.semantic_score), 0)
  const semFloor = Math.max(0.10, topSem * 0.55)
  const survivors = ranked.filter((f) => {
    if (opts.minScore !== undefined && f.score < opts.minScore) return false
    if (f.lex_rank !== null) return true
    return f.semantic_score >= semFloor
  })

  // Diversity: cap chunks per source so one long document cannot monopolise
  // the answer and hide a contradicting second source.
  const maxPer = opts.maxPerSource ?? 3
  const perSource = new Map<string, number>()
  const picked: Fused[] = []
  for (const f of survivors) {
    const n = perSource.get(f.source_id) ?? 0
    if (n >= maxPer) continue
    perSource.set(f.source_id, n + 1)
    picked.push(f)
    if (picked.length >= limit) break
  }

  const citations: Citation[] = picked.map((f) => ({
    chunk_id: f.chunk_id,
    source_id: f.source_id,
    source_uri: f.uri,
    source_title: f.title,
    passage: f.text.length > 1200 ? f.text.slice(0, 1200) + '…' : f.text,
    loc: f.loc,
    score: Number(f.score.toFixed(6)),
    lexical_score: Number(f.lexical_score.toFixed(4)),
    semantic_score: Number(f.semantic_score.toFixed(4)),
    modified_at: f.modified_at,
    freshness: freshnessOf(f.modified_at),
    superseded_by: f.superseded_by,
  }))

  // Coverage describes how much the *evidence* supports an answer, and drives
  // whether the assistant is allowed to answer confidently or must say the
  // notes do not cover the question. It keys off signal quality, not raw score.
  const bestHit = picked[0]
  const hasKeywordEvidence = picked.some((f) => f.lex_rank !== null)
  const strongSemantic = (bestHit?.semantic_score ?? 0) >= 0.25
  const coverage: RetrievalResult['coverage'] =
    !bestHit ? 'none'
      : !hasKeywordEvidence && !strongSemantic ? 'insufficient'
        : citations.length >= 2 && (hasKeywordEvidence || strongSemantic) ? 'good'
          : 'partial'

  return {
    citations,
    conflicts: detectConflicts(db, citations),
    coverage,
    semantic_enabled: provider.quality !== 'none' && sem.length > 0,
    query_terms: buildFtsQuery(query).terms,
    took_ms: Date.now() - started,
  }
}

/* ── Conflict detection ──────────────────────────────────────────────────── */

const NUMBER_RE = /(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:\.\d+)?)\s*(€|EUR|Euro|%|Prozent)/gi

/**
 * Two kinds of conflict we can detect without a model:
 *  - a superseded version appearing next to the version that replaced it
 *  - the same labelled quantity carrying different values in two sources
 *
 * We report them; we never silently pick a winner and blend them into one
 * confident sentence.
 */
export function detectConflicts(db: DB, citations: Citation[]): RetrievalConflict[] {
  const conflicts: RetrievalConflict[] = []
  const present = new Set(citations.map((c) => c.source_id))

  for (const c of citations) {
    if (c.superseded_by && present.has(c.superseded_by)) {
      const newer = citations.find((x) => x.source_id === c.superseded_by)
      conflicts.push({
        // `topic` must not repeat what `a` already says — the UI prints all three.
        topic: 'Zwei Fassungen im Ergebnis',
        a: `${c.source_title} (${c.loc})`,
        b: `neuer: ${newer?.source_title ?? c.superseded_by}`,
        reason: 'superseded_version',
      })
    }
  }

  // Values keyed by the words immediately preceding them.
  const values = new Map<string, Array<{ value: string; source: string; loc: string }>>()
  for (const c of citations) {
    for (const m of c.passage.matchAll(NUMBER_RE)) {
      const at = m.index ?? 0
      const label = c.passage.slice(Math.max(0, at - 60), at)
        .split(/[\n.;:]/).pop()?.trim().toLowerCase().replace(/[^a-zäöüß0-9 ]/g, '').trim()
      if (!label || label.length < 4) continue
      const key = label.split(/\s+/).slice(-4).join(' ')
      const list = values.get(key) ?? []
      list.push({ value: `${m[1]} ${m[2]}`, source: c.source_title, loc: c.loc })
      values.set(key, list)
    }
  }
  for (const [label, list] of values) {
    if (list.length < 2) continue
    const distinct = [...new Set(list.map((v) => v.value.replace(/\s+/g, ' ')))]
    if (distinct.length < 2) continue
    const sources = [...new Set(list.map((v) => v.source))]
    if (sources.length < 2) continue
    conflicts.push({
      topic: label,
      a: `${list[0]!.value} (${list[0]!.source}, ${list[0]!.loc})`,
      b: `${list.find((v) => v.value !== list[0]!.value)?.value} (${sources[1]})`,
      reason: 'contradictory_values',
    })
  }

  return conflicts.slice(0, 6)
}

/** Formats retrieved passages for the model, tagged as untrusted data. */
export function citationsToContext(citations: Citation[]): string {
  if (!citations.length) return ''
  return citations.map((c, i) => {
    const flags = [
      c.freshness === 'stale' ? 'VERALTET' : null,
      c.superseded_by ? 'ERSETZT DURCH NEUERE FASSUNG' : null,
    ].filter(Boolean).join(', ')
    return [
      `[Q${i + 1}] ${c.source_title} — ${c.loc}${flags ? ` [${flags}]` : ''}`,
      `Geändert: ${c.modified_at ?? 'unbekannt'} | Quelle: ${c.source_uri}`,
      c.passage,
    ].join('\n')
  }).join('\n\n---\n\n')
}
