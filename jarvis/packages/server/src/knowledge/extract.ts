import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { errText, log } from '../core/logger.js'

/**
 * Extraction never mutates the original file. We read bytes, produce text
 * segments with a human-readable location label, and leave the source alone.
 * The `loc` label is what the UI shows on a source card ("Seite 4"), so it has
 * to be meaningful to a person, not just to the retriever.
 */

export interface Segment {
  text: string
  loc: string
}

export interface Extraction {
  kind: string
  title: string
  segments: Segment[]
  meta: Record<string, unknown>
}

export const SUPPORTED = new Set([
  '.md', '.markdown', '.txt', '.text', '.rst', '.org',
  '.pdf', '.docx', '.xlsx', '.xlsm', '.csv', '.tsv',
  '.json', '.jsonl', '.ndjson', '.html', '.htm', '.xml',
  '.log', '.yml', '.yaml', '.ts', '.js', '.py', '.sql',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
])

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

export function isSupported(path: string): boolean {
  return SUPPORTED.has(extname(path).toLowerCase())
}

export async function extractFile(path: string): Promise<Extraction> {
  const ext = extname(path).toLowerCase()
  const title = basename(path)
  const st = await stat(path)
  const base = { size: st.size, mtime: st.mtime.toISOString() }

  if (IMAGE_EXT.has(ext)) return extractImage(path, title, base)

  switch (ext) {
    case '.pdf': return extractPdf(path, title, base)
    case '.docx': return extractDocx(path, title, base)
    case '.xlsx': case '.xlsm': return extractSpreadsheet(path, title, base)
    case '.csv': case '.tsv': return extractDelimited(path, title, base, ext === '.tsv' ? '\t' : ',')
    case '.json': return extractJson(path, title, base)
    case '.jsonl': case '.ndjson': return extractJsonl(path, title, base)
    case '.html': case '.htm': case '.xml': return extractHtml(path, title, base)
    default: return extractText(path, title, base)
  }
}

/* ── Plain text & markdown ───────────────────────────────────────────────── */

async function extractText(path: string, title: string, meta: Record<string, unknown>): Promise<Extraction> {
  const raw = await readFile(path, 'utf8')
  const ext = extname(path).toLowerCase()
  const kind = ext === '.md' || ext === '.markdown' ? 'markdown' : 'text'
  const docTitle = mdTitle(raw) ?? title
  return {
    kind, title: docTitle,
    segments: kind === 'markdown' ? splitMarkdown(raw, docTitle) : splitByLines(raw),
    meta: { ...meta, lines: raw.split('\n').length },
  }
}

function mdTitle(raw: string): string | null {
  const m = raw.match(/^#\s+(.{1,120})$/m)
  return m?.[1]?.trim() ?? null
}

/**
 * Markdown splits on headings so a citation lands on a *section*, which is what
 * a person recognises, rather than on an arbitrary offset.
 */
function splitMarkdown(raw: string, docTitle?: string): Segment[] {
  const lines = raw.split('\n')
  const out: Segment[] = []
  let buf: string[] = []
  let heading = 'Anfang'
  let startLine = 1

  // Citations render as "«Titel» — «loc»", so a section heading identical to the
  // document title would print the same words twice. Call it what it is instead.
  const label = (h: string) => (docTitle && h.trim() === docTitle.trim() ? 'Einleitung' : h)

  // The heading alone is the location label: it is what the owner recognises
  // when they see the citation, and it stays readable when two adjacent
  // sections are merged into one chunk. Line numbers add noise, not meaning.
  const flush = (_endLine: number) => {
    const text = buf.join('\n').trim()
    if (text) out.push({ text, loc: label(heading) })
    buf = []
  }

  lines.forEach((line, i) => {
    const h = line.match(/^(#{1,4})\s+(.+)$/)
    if (h) {
      flush(i)
      heading = h[2]!.trim().slice(0, 80)
      startLine = i + 1
    }
    buf.push(line)
  })
  flush(lines.length)
  return out.length ? out : splitByLines(raw)
}

function splitByLines(raw: string, perSegment = 60): Segment[] {
  const lines = raw.split('\n')
  const out: Segment[] = []
  for (let i = 0; i < lines.length; i += perSegment) {
    const text = lines.slice(i, i + perSegment).join('\n').trim()
    if (text) out.push({ text, loc: `Zeile ${i + 1}–${Math.min(i + perSegment, lines.length)}` })
  }
  return out
}

/* ── PDF ─────────────────────────────────────────────────────────────────── */

async function extractPdf(path: string, title: string, meta: Record<string, unknown>): Promise<Extraction> {
  try {
    // Legacy build is the CommonJS-friendly one that runs without a Worker.
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(await readFile(path))
    const doc = await pdfjs.getDocument({
      data, useSystemFonts: true, isEvalSupported: false, useWorkerFetch: false,
    }).promise

    const segments: Segment[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const text = content.items
        .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
        .join(' ').replace(/\s+/g, ' ').trim()
      if (text) segments.push({ text, loc: `Seite ${p}` })
      page.cleanup()
    }
    const info = await doc.getMetadata().catch(() => null)
    await doc.destroy()

    const docTitle = (info?.info?.Title as string | undefined)?.trim()
    if (!segments.length) {
      // A PDF of scans has pages but no text layer. Say so rather than
      // indexing an empty document that will silently never match.
      return {
        kind: 'pdf', title: docTitle || title, segments: [],
        meta: { ...meta, pages: doc.numPages, no_text_layer: true },
      }
    }
    return {
      kind: 'pdf', title: docTitle || title, segments,
      meta: { ...meta, pages: doc.numPages, author: info?.info?.Author ?? null },
    }
  } catch (e) {
    log.warn('PDF-Extraktion fehlgeschlagen', { path, error: errText(e) })
    throw new Error(`PDF konnte nicht gelesen werden: ${errText(e)}`)
  }
}

/* ── Office ──────────────────────────────────────────────────────────────── */

async function extractDocx(path: string, title: string, meta: Record<string, unknown>): Promise<Extraction> {
  const mammoth: any = await import('mammoth')
  const { value } = await mammoth.extractRawText({ path })
  const text = String(value ?? '')
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const segments: Segment[] = []
  for (let i = 0; i < paras.length; i += 6) {
    const slice = paras.slice(i, i + 6).join('\n\n')
    segments.push({ text: slice, loc: `Absatz ${i + 1}–${Math.min(i + 6, paras.length)}` })
  }
  return { kind: 'docx', title, segments, meta: { ...meta, paragraphs: paras.length } }
}

async function extractSpreadsheet(path: string, title: string, meta: Record<string, unknown>): Promise<Extraction> {
  const XLSX: any = await import('xlsx')
  const wb = XLSX.read(await readFile(path), { type: 'buffer', cellDates: true })
  const segments: Segment[] = []
  for (const sheetName of wb.SheetNames as string[]) {
    const sheet = wb.Sheets[sheetName]
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false })
    if (!rows.length) continue
    const header = (rows[0] ?? []).map((c) => String(c ?? '')).join(' | ')
    // Keep the header on every chunk: a row of numbers means nothing without it.
    for (let i = 1; i < rows.length; i += 40) {
      const block = rows.slice(i, i + 40)
        .map((r) => r.map((c) => String(c ?? '')).join(' | '))
        .filter((l) => l.replace(/[\s|]/g, '').length > 0)
      if (!block.length) continue
      segments.push({
        text: `Blatt "${sheetName}"\n${header}\n${block.join('\n')}`,
        loc: `${sheetName}!Zeile ${i + 1}–${Math.min(i + 40, rows.length)}`,
      })
    }
  }
  return { kind: 'xlsx', title, segments, meta: { ...meta, sheets: wb.SheetNames } }
}

async function extractDelimited(
  path: string, title: string, meta: Record<string, unknown>, sep: string,
): Promise<Extraction> {
  const raw = await readFile(path, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim())
  if (!lines.length) return { kind: 'csv', title, segments: [], meta }
  const header = lines[0]!
  const segments: Segment[] = []
  for (let i = 1; i < lines.length; i += 40) {
    segments.push({
      text: [header, ...lines.slice(i, i + 40)].join('\n'),
      loc: `Zeile ${i + 1}–${Math.min(i + 40, lines.length)}`,
    })
  }
  return { kind: 'csv', title, segments, meta: { ...meta, rows: lines.length - 1, separator: sep } }
}

/* ── Structured ──────────────────────────────────────────────────────────── */

async function extractJson(path: string, title: string, meta: Record<string, unknown>): Promise<Extraction> {
  const raw = await readFile(path, 'utf8')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return extractText(path, title, meta) }

  // A JSON array of records reads much better as one segment per record group.
  if (Array.isArray(parsed)) {
    const segments: Segment[] = []
    for (let i = 0; i < parsed.length; i += 20) {
      segments.push({
        text: JSON.stringify(parsed.slice(i, i + 20), null, 1),
        loc: `Eintrag ${i + 1}–${Math.min(i + 20, parsed.length)}`,
      })
    }
    return { kind: 'json', title, segments, meta: { ...meta, entries: parsed.length } }
  }
  return {
    kind: 'json', title,
    segments: splitByLines(JSON.stringify(parsed, null, 2), 80),
    meta: { ...meta, top_level_keys: Object.keys(parsed as object).slice(0, 50) },
  }
}

async function extractJsonl(path: string, title: string, meta: Record<string, unknown>): Promise<Extraction> {
  const lines = (await readFile(path, 'utf8')).split('\n').filter((l) => l.trim())
  const segments: Segment[] = []
  for (let i = 0; i < lines.length; i += 20) {
    segments.push({ text: lines.slice(i, i + 20).join('\n'), loc: `Zeile ${i + 1}–${Math.min(i + 20, lines.length)}` })
  }
  return { kind: 'chat_export', title, segments, meta: { ...meta, records: lines.length } }
}

async function extractHtml(path: string, title: string, meta: Record<string, unknown>): Promise<Extraction> {
  const raw = await readFile(path, 'utf8')
  return { kind: 'html', title: htmlTitle(raw) ?? title, segments: splitByLines(htmlToText(raw), 40), meta }
}

export function htmlTitle(html: string): string | null {
  return html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null
}

/** Strip markup to readable text. Script/style bodies are dropped entirely. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ── Images ──────────────────────────────────────────────────────────────── */

/**
 * We index image *metadata*, not pixels — there is no OCR in this build. That
 * is a stated limitation: an image is findable by filename and dimensions, not
 * by the text printed inside it.
 */
async function extractImage(path: string, title: string, meta: Record<string, unknown>): Promise<Extraction> {
  const buf = await readFile(path)
  const dims = pngSize(buf) ?? jpegSize(buf)
  const descr = [
    `Bilddatei: ${title}`,
    dims ? `Abmessungen: ${dims.w}×${dims.h} Pixel` : null,
    `Größe: ${Math.round(Number(meta.size ?? 0) / 1024)} KB`,
    `Hinweis: Bildinhalt ist nicht per OCR erfasst; nur Dateiname und Metadaten sind durchsuchbar.`,
  ].filter(Boolean).join('\n')
  return {
    kind: 'image', title,
    segments: [{ text: descr, loc: 'Metadaten' }],
    meta: { ...meta, ...(dims ?? {}), ocr: false },
  }
}

function pngSize(b: Buffer): { w: number; h: number } | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

function jpegSize(b: Buffer): { w: number; h: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const marker = b[i + 1]!
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
    }
    i += 2 + b.readUInt16BE(i + 2)
  }
  return null
}
