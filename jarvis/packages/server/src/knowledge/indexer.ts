import { readdir, stat, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DB } from '../db/index.js'
import { config } from '../config.js'
import { newId, stableId } from '../util/id.js'
import { nowIso } from '../util/time.js'
import { sha256 } from '../core/crypto.js'
import { log, errText } from '../core/logger.js'
import { audit } from '../core/audit.js'
import { extractFile, isSupported, type Segment } from './extract.js'
import { embeddings, toBlob } from './embeddings.js'

/**
 * Ingestion: filesystem → sources → chunks → FTS + vectors → relations.
 *
 * Originals are never modified or moved. Re-running is cheap and idempotent:
 * a source whose content hash is unchanged is skipped entirely.
 */

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'dist', 'build', '__pycache__', '.venv', 'data'])
const MAX_BYTES = 25 * 1024 * 1024

export interface IngestStats {
  scanned: number
  indexed: number
  skipped_unchanged: number
  skipped_unsupported: number
  failed: number
  chunks: number
  embedded: number
  errors: Array<{ path: string; error: string }>
}

function emptyStats(): IngestStats {
  return {
    scanned: 0, indexed: 0, skipped_unchanged: 0, skipped_unsupported: 0,
    failed: 0, chunks: 0, embedded: 0, errors: [],
  }
}

/**
 * Guard against path traversal: a caller-supplied path must resolve to a real
 * location *inside* one of the configured roots. Prefix string comparison alone
 * is not enough — `/srv/sources-evil` starts with `/srv/sources`.
 */
export function assertInsideRoots(candidate: string, roots = config.sourceRoots): string {
  const abs = resolve(candidate)
  for (const root of roots) {
    const r = resolve(root)
    if (abs === r || abs.startsWith(r.endsWith(sep) ? r : r + sep)) return abs
  }
  throw new Error(`Pfad liegt außerhalb der freigegebenen Quellordner: ${candidate}`)
}

export async function walk(root: string, out: string[] = []): Promise<string[]> {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env.example') continue
    const full = join(root, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      await walk(full, out)
    } else if (e.isFile()) {
      out.push(full)
    }
  }
  return out
}

/* ── Chunking ────────────────────────────────────────────────────────────── */

const TARGET_CHARS = 1400
const OVERLAP_CHARS = 180
/** Below this, a section is too small to stand alone and gets merged forward. */
const MIN_CHUNK_CHARS = 400

export interface Chunk { text: string; loc: string; ord: number }

/**
 * Segments arrive at natural boundaries (page, heading, sheet block).
 *
 * Citation precision is the goal, so we keep those boundaries wherever the
 * result is still a substantial chunk: a citation reading "Preisliste — Klasse
 * B" is useful to a person, "Preisliste — Zeile 1–40" is not. Sections shorter
 * than MIN_CHUNK_CHARS are merged forward, oversized ones are split on sentence
 * boundaries with an overlap so a fact spanning a cut survives intact somewhere.
 */
export function chunkSegments(segments: Segment[]): Chunk[] {
  const out: Chunk[] = []
  let ord = 0
  let buf = ''
  let locFirst: string | null = null
  let locLast: string | null = null

  const label = () =>
    !locFirst ? '' : locFirst === locLast ? locFirst : `${locFirst} … ${locLast}`

  const push = (text: string, loc: string) => {
    const t = text.trim()
    if (t.length < 3) return
    out.push({ text: t, loc, ord: ord++ })
  }
  const flush = () => {
    if (buf.trim() && locFirst) push(buf, label())
    buf = ''; locFirst = null; locLast = null
  }

  for (const seg of segments) {
    const text = seg.text.trim()
    if (!text) continue

    if (text.length > TARGET_CHARS * 1.5) {
      flush()
      const pieces = splitLong(text)
      pieces.forEach((piece, i) =>
        push(piece, pieces.length > 1 ? `${seg.loc} (Teil ${i + 1}/${pieces.length})` : seg.loc))
      continue
    }

    // Start a new chunk when merging would overflow, or when the buffer already
    // stands on its own and this segment opens a distinct section.
    const wouldOverflow = buf.length + text.length + 2 > TARGET_CHARS
    const standsAlone = buf.length >= MIN_CHUNK_CHARS && seg.loc !== locLast
    if (buf && (wouldOverflow || standsAlone)) flush()

    if (!locFirst) locFirst = seg.loc
    locLast = seg.loc
    buf = buf ? `${buf}\n\n${text}` : text
  }
  flush()
  return out
}

function splitLong(text: string): string[] {
  const sentences = text.split(/(?<=[.!?…])\s+|\n{2,}/)
  const parts: string[] = []
  let cur = ''
  for (const s of sentences) {
    if (cur.length + s.length + 1 > TARGET_CHARS && cur) {
      parts.push(cur.trim())
      cur = cur.slice(Math.max(0, cur.length - OVERLAP_CHARS))   // carry overlap forward
    }
    cur += (cur ? ' ' : '') + s
    // A single "sentence" can still be huge (minified JSON, a wall of text).
    while (cur.length > TARGET_CHARS * 2) {
      parts.push(cur.slice(0, TARGET_CHARS).trim())
      cur = cur.slice(TARGET_CHARS - OVERLAP_CHARS)
    }
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts.filter((p) => p.length > 2)
}

/* ── Indexing one file ───────────────────────────────────────────────────── */

export interface IndexOpts {
  domain?: string
  sensitivity?: string
  trust?: 'owner' | 'third_party' | 'web'
  tags?: string[]
  force?: boolean
  /**
   * Roots this call is allowed to read from. Defaults to the configured source
   * roots. `ingestRoots` threads its own roots through here — without it, a
   * scan of any other directory would fail every file on the traversal guard.
   */
  roots?: string[]
}

export async function indexFile(db: DB, path: string, opts: IndexOpts = {}): Promise<{
  status: 'indexed' | 'unchanged' | 'unsupported' | 'failed'
  sourceId?: string; chunks?: number; error?: string
}> {
  const abs = assertInsideRoots(path, opts.roots ?? config.sourceRoots)
  if (!isSupported(abs)) return { status: 'unsupported' }

  const st = await stat(abs)
  if (st.size > MAX_BYTES) return { status: 'failed', error: `Datei zu groß (${Math.round(st.size / 1e6)} MB)` }

  const uri = pathToFileURL(abs).href
  const sourceId = stableId('src', uri)
  const bytes = await readFile(abs)
  const contentHash = sha256(bytes)

  const existing = db.prepare('SELECT id, content_hash FROM sources WHERE id = ?').get(sourceId) as
    { id: string; content_hash: string } | undefined
  if (existing && existing.content_hash === contentHash && !opts.force) {
    db.prepare('UPDATE sources SET indexed_at = ?, active = 1, error = NULL WHERE id = ?').run(nowIso(), sourceId)
    return { status: 'unchanged', sourceId }
  }

  let extraction
  try {
    extraction = await extractFile(abs)
  } catch (e) {
    const msg = errText(e)
    db.prepare(
      `INSERT INTO sources (id, uri, title, kind, domain, content_hash, bytes, created_at, modified_at,
         indexed_at, tags, meta, sensitivity, trust, active, error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)
       ON CONFLICT(id) DO UPDATE SET error=excluded.error, indexed_at=excluded.indexed_at, active=0`,
    ).run(sourceId, uri, basename(abs), 'unknown', opts.domain ?? 'general-jarvis', contentHash, st.size,
      nowIso(st.birthtime), nowIso(st.mtime), nowIso(), '[]', '{}',
      opts.sensitivity ?? 'internal', opts.trust ?? 'owner', msg)
    return { status: 'failed', sourceId, error: msg }
  }

  const chunks = chunkSegments(extraction.segments)

  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO sources (id, uri, title, kind, domain, content_hash, bytes, created_at, modified_at,
         indexed_at, tags, meta, sensitivity, trust, active, error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,NULL)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, kind=excluded.kind, content_hash=excluded.content_hash,
         bytes=excluded.bytes, modified_at=excluded.modified_at, indexed_at=excluded.indexed_at,
         meta=excluded.meta, tags=excluded.tags, active=1, error=NULL`,
    ).run(sourceId, uri, extraction.title, extraction.kind, opts.domain ?? 'general-jarvis',
      contentHash, st.size, nowIso(st.birthtime), nowIso(st.mtime), nowIso(),
      JSON.stringify(opts.tags ?? []), JSON.stringify(extraction.meta),
      opts.sensitivity ?? 'internal', opts.trust ?? 'owner')

    // Replace chunks wholesale: partial diffing would leave stale passages that
    // the retriever could still cite. Cascades clean up FTS rows and vectors.
    db.prepare('DELETE FROM chunks WHERE source_id = ?').run(sourceId)
    const ins = db.prepare(
      `INSERT INTO chunks (id, source_id, ord, text, loc, token_est, hash, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    for (const c of chunks) {
      ins.run(`${sourceId}:${c.ord}`, sourceId, c.ord, c.text, c.loc,
        Math.ceil(c.text.length / 4), sha256(c.text), nowIso())
    }
  })
  write()

  linkSameFolder(db, sourceId, abs)
  detectSupersession(db, sourceId, extraction.title, contentHash, basename(abs))

  return { status: 'indexed', sourceId, chunks: chunks.length }
}

/** Cheap structural signal: files in one folder are usually about one thing. */
function linkSameFolder(db: DB, sourceId: string, abs: string): void {
  const folder = dirname(abs)
  const prefix = pathToFileURL(folder).href + '/'
  const siblings = db.prepare(
    `SELECT id FROM sources WHERE id != ? AND active = 1 AND uri LIKE ? AND uri NOT LIKE ? LIMIT 40`,
  ).all(sourceId, `${prefix}%`, `${prefix}%/%`) as Array<{ id: string }>
  const ins = db.prepare(
    `INSERT OR IGNORE INTO relations (id, from_id, to_id, kind, weight, created_at) VALUES (?,?,?,?,?,?)`,
  )
  for (const s of siblings) {
    ins.run(newId('rel'), sourceId, s.id, 'same_folder', 0.3, nowIso())
    ins.run(newId('rel'), s.id, sourceId, 'same_folder', 0.3, nowIso())
  }
}

/**
 * Version detection. `Angebot_v2.pdf` supersedes `Angebot_v1.pdf`.
 *
 * Both the document title and the filename are considered, because the version
 * marker lives in whichever the author happened to use — "Preisliste (Stand
 * 2025).md" carries it in the heading, "preisliste_v2.md" in the filename.
 *
 * We only *mark* supersession. The older file is never deleted or hidden; the
 * retriever demotes it and says so, which is the owner's call to make, not ours.
 */
function detectSupersession(db: DB, sourceId: string, title: string, hash: string, filename: string): void {
  const mineStem = versionStem([title, filename])
  if (mineStem.length < 4) return
  const mine = versionOf([title, filename])
  if (mine === null) return

  const candidates = db.prepare(
    `SELECT id, title, uri FROM sources WHERE id != ? AND active = 1 AND content_hash != ?`,
  ).all(sourceId, hash) as Array<{ id: string; title: string; uri: string }>

  for (const c of candidates) {
    const cName = uriBasename(c.uri)
    if (versionStem([c.title, cName]) !== mineStem) continue

    const theirs = versionOf([c.title, cName])
    // Only claim supersession when the two can actually be ordered.
    if (theirs === null || theirs === mine) continue

    const [olderId, newerId] = mine > theirs ? [c.id, sourceId] : [sourceId, c.id]
    db.prepare('UPDATE sources SET superseded_by = ? WHERE id = ?').run(newerId, olderId)
    db.prepare(
      `INSERT OR IGNORE INTO relations (id, from_id, to_id, kind, weight, created_at) VALUES (?,?,?,?,?,?)`,
    ).run(newId('rel'), newerId, olderId, 'supersedes', 1.0, nowIso())
  }
}

function uriBasename(uri: string): string {
  try { return decodeURIComponent(uri.split('/').pop() ?? '') } catch { return '' }
}

/** Strips every version marker so two revisions of one document share a stem. */
function versionStem(hints: string[]): string {
  const longest = hints
    .map((h) => h.toLowerCase()
      .replace(/\.[a-z0-9]{1,5}$/, '')
      .replace(/\(([^)]*)\)/g, ' $1 ')
      .replace(/[ _-]*(v|version|rev|fassung|stand)[ _.-]*\d+(\.\d+)*/g, ' ')
      .replace(/[ _-]*\d{4}[-_.]?\d{2}[-_.]?\d{2}/g, ' ')
      .replace(/\b(19|20)\d{2}\b/g, ' ')
      .replace(/\b(final|endgueltig|neu|new|alt|old|kopie|copy)\b/g, ' ')
      .replace(/[^a-z0-9äöüß]+/g, ' ').trim())
    .sort((a, b) => b.length - a.length)[0]
  return longest ?? ''
}

/** A comparable version number: explicit marker, full date, or bare year. */
export function versionOf(hints: string[]): number | null {
  for (const hint of hints) {
    const h = hint.toLowerCase()
    const d = h.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/)
    if (d) return Number(`${d[1]}${d[2]}${d[3]}`)
    const m = h.match(/(?:^|[ _(-])(?:v|version|rev|fassung|stand)[ _.-]*(\d+)/)
    if (m?.[1]) return Number(m[1])
    const y = h.match(/\b(19|20)(\d{2})\b/)
    if (y) return Number(`${y[1]}${y[2]}`)
  }
  return null
}

/* ── Embedding backfill ──────────────────────────────────────────────────── */

export async function embedPending(db: DB, limit = 400): Promise<number> {
  const provider = embeddings()
  if (provider.quality === 'none') return 0

  const rows = db.prepare(
    `SELECT c.id, c.text FROM chunks c
      LEFT JOIN embeddings e ON e.chunk_id = c.id AND e.model = ?
      WHERE e.chunk_id IS NULL LIMIT ?`,
  ).all(provider.model, limit) as Array<{ id: string; text: string }>
  if (!rows.length) return 0

  const vectors = await provider.embed(rows.map((r) => r.text))
  const ins = db.prepare(
    `INSERT INTO embeddings (chunk_id, provider, model, dim, vec, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(chunk_id) DO UPDATE SET
       provider=excluded.provider, model=excluded.model, dim=excluded.dim,
       vec=excluded.vec, created_at=excluded.created_at`,
  )
  db.transaction(() => {
    rows.forEach((r, i) => {
      const v = vectors[i]
      if (!v) return
      ins.run(r.id, provider.name, provider.model, v.length, toBlob(v), nowIso())
    })
  })()
  return rows.length
}

/* ── Full scan ───────────────────────────────────────────────────────────── */

export async function ingestRoots(
  db: DB, roots = config.sourceRoots, opts: IndexOpts = {},
  onProgress?: (done: number, total: number) => void,
): Promise<IngestStats> {
  const stats = emptyStats()
  const files: string[] = []
  for (const root of roots) await walk(root, files)
  stats.scanned = files.length

  for (const [i, f] of files.entries()) {
    try {
      const r = await indexFile(db, f, { ...opts, roots })
      if (r.status === 'indexed') { stats.indexed++; stats.chunks += r.chunks ?? 0 }
      else if (r.status === 'unchanged') stats.skipped_unchanged++
      else if (r.status === 'unsupported') stats.skipped_unsupported++
      else { stats.failed++; stats.errors.push({ path: relative(config.root, f), error: r.error ?? 'unbekannt' }) }
    } catch (e) {
      stats.failed++
      stats.errors.push({ path: relative(config.root, f), error: errText(e) })
    }
    onProgress?.(i + 1, files.length)
  }

  // Mark sources whose file has disappeared; keep the row so citations in old
  // conversations still resolve to "diese Quelle existiert nicht mehr".
  const known = new Set(files.map((f) => pathToFileURL(resolve(f)).href))
  const orphans = db.prepare(`SELECT id, uri FROM sources WHERE active = 1 AND uri LIKE 'file:%'`)
    .all() as Array<{ id: string; uri: string }>
  for (const o of orphans) {
    if (!known.has(o.uri)) {
      db.prepare(`UPDATE sources SET active = 0, error = 'Datei nicht mehr gefunden' WHERE id = ?`).run(o.id)
    }
  }

  try {
    let n = 0, batch = 0
    do { batch = await embedPending(db); n += batch } while (batch > 0)
    stats.embedded = n
  } catch (e) {
    log.warn('Embedding-Backfill fehlgeschlagen', { error: errText(e) })
    stats.errors.push({ path: '(embeddings)', error: errText(e) })
  }

  audit(db, {
    actor: 'system', action: 'index.scan', outcome: stats.failed ? 'error' : 'ok',
    detail: { scanned: stats.scanned, indexed: stats.indexed, failed: stats.failed, chunks: stats.chunks },
  })
  log.info('Indexlauf abgeschlossen', { ...stats, errors: stats.errors.length })
  return stats
}

export function indexStats(db: DB) {
  const s = db.prepare('SELECT count(*) n FROM sources WHERE active = 1').get() as { n: number }
  const c = db.prepare('SELECT count(*) n FROM chunks').get() as { n: number }
  const e = db.prepare('SELECT count(*) n FROM embeddings').get() as { n: number }
  return { sources: s.n, chunks: c.n, embedded: e.n }
}
