import { createHash } from 'node:crypto'
import { config } from '../config.js'
import { log, errText } from '../core/logger.js'

/**
 * Pluggable embedding providers.
 *
 * `quality` is reported honestly all the way to the UI, because the difference
 * matters to the owner: a `lexical` provider finds documents that share
 * wording, a `semantic` one finds documents that share *meaning*. We never
 * present the former as the latter.
 */

export type EmbeddingQuality = 'none' | 'lexical' | 'semantic'

export interface EmbeddingProvider {
  readonly name: string
  readonly model: string
  readonly dim: number
  readonly quality: EmbeddingQuality
  embed(texts: string[]): Promise<Float32Array[]>
  health(): Promise<{ ok: boolean; detail: string }>
}

/* ── Vector helpers ──────────────────────────────────────────────────────── */

export function normalise(v: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!
  const norm = Math.sqrt(sum)
  if (norm === 0) return v
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / norm
  return v
}

/** Both inputs must already be L2-normalised — then dot product *is* cosine. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!
  return dot
}

export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

export function fromBlob(b: Buffer): Float32Array {
  // Copy: the Buffer may be a view into a larger pooled allocation.
  const copy = new Uint8Array(b.byteLength)
  copy.set(b)
  return new Float32Array(copy.buffer)
}

/* ── local-lexical: offline, deterministic, zero-download ────────────────── */

const STOP_DE = new Set([
  'der', 'die', 'das', 'und', 'oder', 'ist', 'sind', 'ein', 'eine', 'einen', 'einem', 'einer',
  'den', 'dem', 'des', 'für', 'mit', 'von', 'zu', 'im', 'in', 'am', 'an', 'auf', 'aus', 'bei',
  'nicht', 'auch', 'sich', 'dass', 'wie', 'als', 'wenn', 'nach', 'über', 'the', 'a', 'an', 'of',
  'to', 'and', 'or', 'is', 'are', 'for', 'with', 'from', 'that', 'this', 'it', 'in', 'on', 'at',
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // ä→a, ö→o, ü→u, é→e
    .replace(/ß/g, 'ss')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_DE.has(t))
}

function hash32(s: string, seed: number): number {
  const h = createHash('sha1').update(`${seed}:${s}`).digest()
  return h.readUInt32BE(0)
}

/**
 * Signed hashing trick over words + character 4-grams.
 *
 * Character n-grams are what make this useful for German: "Fahrschulverwaltung"
 * and "Fahrschule" share n-grams even though they are different tokens, and a
 * typo costs a few n-grams rather than the whole term. It is a real vector
 * space with meaningful cosine similarity — it is *not* a neural embedding and
 * will not connect "Auto" to "Fahrzeug". Reported as quality `lexical`.
 */
export class LocalLexicalProvider implements EmbeddingProvider {
  readonly name = 'local-lexical'
  readonly model = 'hashed-ngram-v1'
  readonly dim = 384
  readonly quality: EmbeddingQuality = 'lexical'

  private vec(text: string): Float32Array {
    const out = new Float32Array(this.dim)
    const words = tokenize(text)
    const counts = new Map<string, number>()
    const bump = (f: string, w: number) => counts.set(f, (counts.get(f) ?? 0) + w)

    for (const w of words) {
      bump(`w:${w}`, 1)
      const padded = `^${w}$`
      for (let i = 0; i + 4 <= padded.length; i++) bump(`g:${padded.slice(i, i + 4)}`, 0.5)
    }
    for (let i = 0; i + 1 < words.length; i++) bump(`b:${words[i]}_${words[i + 1]}`, 0.7)

    for (const [feature, count] of counts) {
      const idx = hash32(feature, 1) % this.dim
      const sign = (hash32(feature, 2) & 1) === 0 ? 1 : -1
      out[idx] = out[idx]! + sign * (1 + Math.log(count))   // sublinear TF
    }
    return normalise(out)
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.vec(t))
  }

  async health() {
    return { ok: true, detail: 'Lokal, offline, deterministisch (lexikalisch – keine Synonyme)' }
  }
}

/* ── Remote providers ────────────────────────────────────────────────────── */

abstract class HttpProvider implements EmbeddingProvider {
  abstract readonly name: string
  abstract readonly model: string
  abstract readonly dim: number
  readonly quality: EmbeddingQuality = 'semantic'
  protected abstract request(texts: string[]): Promise<number[][]>

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (config.offline) throw new Error('Offline-Modus: externe Embeddings deaktiviert')
    const out: Float32Array[] = []
    // Batch to stay under provider payload limits and keep retries cheap.
    for (let i = 0; i < texts.length; i += 64) {
      const rows = await this.request(texts.slice(i, i + 64))
      for (const r of rows) out.push(normalise(Float32Array.from(r)))
    }
    return out
  }

  async health() {
    if (config.offline) return { ok: false, detail: 'Offline-Modus aktiv' }
    try {
      await this.embed(['gesundheitspruefung'])
      return { ok: true, detail: `${this.name}/${this.model} erreichbar` }
    } catch (e) {
      return { ok: false, detail: errText(e) }
    }
  }
}

class VoyageProvider extends HttpProvider {
  readonly name = 'voyage'
  readonly model = config.embeddings.model ?? 'voyage-3'
  readonly dim = 1024
  protected async request(texts: string[]): Promise<number[][]> {
    const key = config.embeddings.voyageKey
    if (!key) throw new Error('VOYAGE_API_KEY fehlt')
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: texts, model: this.model, input_type: 'document' }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const j = await res.json() as { data: Array<{ embedding: number[] }> }
    return j.data.map((d) => d.embedding)
  }
}

class OpenAIProvider extends HttpProvider {
  readonly name = 'openai'
  readonly model = config.embeddings.model ?? 'text-embedding-3-small'
  readonly dim = 1536
  protected async request(texts: string[]): Promise<number[][]> {
    const key = config.embeddings.openaiKey
    if (!key) throw new Error('OPENAI_API_KEY fehlt')
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: texts, model: this.model }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const j = await res.json() as { data: Array<{ embedding: number[] }> }
    return j.data.map((d) => d.embedding)
  }
}

/** Local neural embeddings via an Ollama daemon — semantic quality, stays on-box. */
class OllamaProvider extends HttpProvider {
  readonly name = 'ollama'
  readonly model = config.embeddings.model ?? 'nomic-embed-text'
  readonly dim = 768
  protected async request(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${config.embeddings.ollamaUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const j = await res.json() as { embeddings: number[][] }
    return j.embeddings
  }
  override async embed(texts: string[]): Promise<Float32Array[]> {
    // Ollama runs on localhost, so the offline kill switch does not apply.
    const out: Float32Array[] = []
    for (let i = 0; i < texts.length; i += 32) {
      for (const r of await this.request(texts.slice(i, i + 32))) out.push(normalise(Float32Array.from(r)))
    }
    return out
  }
}

class NoneProvider implements EmbeddingProvider {
  readonly name = 'none'; readonly model = 'none'; readonly dim = 0
  readonly quality: EmbeddingQuality = 'none'
  async embed(): Promise<Float32Array[]> { return [] }
  async health() { return { ok: true, detail: 'Semantische Suche deaktiviert – nur Volltext (BM25)' } }
}

let provider: EmbeddingProvider | null = null

export function embeddings(): EmbeddingProvider {
  if (provider) return provider
  const want = config.embeddings.provider
  switch (want) {
    case 'voyage': provider = new VoyageProvider(); break
    case 'openai': provider = new OpenAIProvider(); break
    case 'ollama': provider = new OllamaProvider(); break
    case 'none': provider = new NoneProvider(); break
    case 'local-lexical': provider = new LocalLexicalProvider(); break
    default:
      log.warn('Unbekannter Embedding-Provider, fallback auf local-lexical', { want })
      provider = new LocalLexicalProvider()
  }
  return provider
}

/** Test hook: swap the provider without touching process env. */
export function setEmbeddingProvider(p: EmbeddingProvider | null): void {
  provider = p
}
