import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testDb, type DB } from '../src/db/index.js'
import { ingestRoots, chunkSegments, indexFile, versionOf } from '../src/knowledge/indexer.js'
import { retrieve, buildFtsQuery, detectConflicts } from '../src/knowledge/retrieval.js'
import { LocalLexicalProvider, setEmbeddingProvider, cosine } from '../src/knowledge/embeddings.js'

/**
 * Retrieval behaviour. These are the tests that catch the failure the owner
 * actually cares about: an answer that looks sourced but is not.
 */

let db: DB
let root: string

beforeAll(async () => {
  setEmbeddingProvider(new LocalLexicalProvider())
  root = mkdtempSync(join(tmpdir(), 'jarvis-test-'))
  mkdirSync(join(root, 'fahrschule'), { recursive: true })

  writeFileSync(join(root, 'fahrschule', 'preisliste_v1.md'),
    '# Preisliste (Stand 2023)\n\n## Klasse B\n- Grundbetrag: 350 EUR\n- Fahrstunde: 55 EUR\n')
  writeFileSync(join(root, 'fahrschule', 'preisliste_v2.md'),
    '# Preisliste (Stand 2025)\n\n## Klasse B\n- Grundbetrag: 420 EUR\n- Fahrstunde: 65 EUR\n')
  writeFileSync(join(root, 'fahrschule', 'theorie.md'),
    '# Theorieunterricht\n\nZwoelf Doppelstunden Grundstoff sind Pflicht.\n' +
    'Die Anmeldung bei der Fahrerlaubnisbehoerde dauert vier bis sechs Wochen.\n')
  writeFileSync(join(root, 'segeln.md'),
    '# Segeln\n\nDer Sportbootfuehrerschein See wird beim DSV abgelegt.\n')

  db = testDb()
  await ingestRoots(db, [root], {}, undefined)
})

describe('FTS-Abfragebau', () => {
  it('neutralisiert FTS-Operatoren aus natürlicher Sprache', () => {
    // "OR", "*", quotes and NEAR must never reach FTS5 as syntax.
    const { expr } = buildFtsQuery('Was kostet B197 — inkl. MwSt? OR NEAR("x")')
    expect(() => db.prepare('SELECT 1 FROM chunks_fts WHERE chunks_fts MATCH ?').all(expr)).not.toThrow()
  })

  it('erzeugt Präfixvarianten für lange Begriffe (deutsche Komposita)', () => {
    const { expr } = buildFtsQuery('Fahrerlaubnisbehoerde')
    expect(expr).toContain('*')
  })

  it('liefert einen leeren Ausdruck für reine Stoppwörter', () => {
    expect(buildFtsQuery('der die das und').expr).toBe('')
  })
})

describe('Chunking', () => {
  it('führt kurze Abschnitte zusammen und behält beide Fundstellen', () => {
    const chunks = chunkSegments([
      { text: 'Kurz eins.', loc: 'Kapitel A' },
      { text: 'Kurz zwei.', loc: 'Kapitel B' },
    ])
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.loc).toBe('Kapitel A … Kapitel B')
  })

  it('teilt überlange Abschnitte mit erkennbarer Teilnummer', () => {
    const long = 'Satz eins. '.repeat(600)
    const chunks = chunkSegments([{ text: long, loc: 'Seite 1' }])
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]!.loc).toMatch(/Seite 1 \(Teil 1\/\d+\)/)
  })

  it('verwirft leere Segmente', () => {
    expect(chunkSegments([{ text: '   ', loc: 'x' }])).toHaveLength(0)
  })
})

describe('Versionserkennung', () => {
  it('liest die Version aus Dateinamen und Titeln', () => {
    expect(versionOf(['preisliste_v2.md'])).toBe(2)
    expect(versionOf(['Preisliste (Stand 2025)'])).toBe(2025)
    expect(versionOf(['bericht_2025-03-14.pdf'])).toBe(20250314)
    expect(versionOf(['ohne marker'])).toBeNull()
  })

  it('markiert die ältere Preisliste als ersetzt', () => {
    const rows = db.prepare('SELECT title, superseded_by FROM sources').all() as
      Array<{ title: string; superseded_by: string | null }>
    const old = rows.find((r) => r.title.includes('2023'))
    const recent = rows.find((r) => r.title.includes('2025'))
    expect(old?.superseded_by).toBeTruthy()
    expect(recent?.superseded_by).toBeNull()
  })
})

describe('Hybride Suche', () => {
  it('findet die richtige Quelle und stellt die neuere Fassung nach vorn', async () => {
    const r = await retrieve(db, 'Was kostet eine Fahrstunde?')
    expect(r.citations.length).toBeGreaterThan(0)
    expect(r.citations[0]!.source_title).toContain('2025')
  })

  it('schließt thematisch fremde Quellen aus', async () => {
    // The bug this guards: an OR-ed query making every document a "hit", so an
    // answer about prices cites an unrelated note and looks sourced.
    const r = await retrieve(db, 'Was kostet eine Fahrstunde?')
    expect(r.citations.map((c) => c.source_title)).not.toContain('Segeln')
  })

  it('meldet unzureichende Abdeckung statt zu raten', async () => {
    const r = await retrieve(db, 'Wie repariere ich einen Dieselmotor mit Turbolader?')
    expect(['insufficient', 'none']).toContain(r.coverage)
  })

  it('meldet Widersprüche zwischen ersetzten Fassungen', async () => {
    const r = await retrieve(db, 'Grundbetrag Klasse B')
    expect(r.conflicts.some((c) => c.reason === 'superseded_version')).toBe(true)
  })

  it('begrenzt die Trefferzahl pro Quelle', async () => {
    const r = await retrieve(db, 'Preisliste Klasse B Grundbetrag', { maxPerSource: 1, limit: 6 })
    const perSource = new Map<string, number>()
    for (const c of r.citations) perSource.set(c.source_id, (perSource.get(c.source_id) ?? 0) + 1)
    expect([...perSource.values()].every((n) => n <= 1)).toBe(true)
  })

  it('liefert für jede Fundstelle eine lesbare Ortsangabe', async () => {
    const r = await retrieve(db, 'Anmeldung Fahrerlaubnisbehoerde')
    expect(r.citations.length).toBeGreaterThan(0)
    for (const c of r.citations) expect(c.loc.length).toBeGreaterThan(2)
  })

  it('erkennt widersprüchliche Beträge zum gleichen Stichwort', () => {
    const conflicts = detectConflicts(db, [
      {
        chunk_id: 'a', source_id: 's1', source_uri: 'file:///a', source_title: 'Angebot A',
        passage: 'Der Grundbetrag beträgt 350 EUR pro Kurs.', loc: 'S. 1', score: 1,
        lexical_score: 1, semantic_score: 1, modified_at: null, freshness: 'unknown', superseded_by: null,
      },
      {
        chunk_id: 'b', source_id: 's2', source_uri: 'file:///b', source_title: 'Angebot B',
        passage: 'Der Grundbetrag beträgt 420 EUR pro Kurs.', loc: 'S. 1', score: 1,
        lexical_score: 1, semantic_score: 1, modified_at: null, freshness: 'unknown', superseded_by: null,
      },
    ])
    expect(conflicts.some((c) => c.reason === 'contradictory_values')).toBe(true)
  })
})

describe('Indexierung', () => {
  it('überspringt unveränderte Dateien beim zweiten Lauf', async () => {
    const stats = await ingestRoots(db, [root])
    expect(stats.skipped_unchanged).toBeGreaterThan(0)
    expect(stats.indexed).toBe(0)
  })

  it('verweigert Pfade außerhalb der freigegebenen Ordner', async () => {
    await expect(indexFile(db, '/etc/passwd')).rejects.toThrow(/außerhalb/)
  })

  it('verweigert Traversal-Versuche mit ..', async () => {
    await expect(indexFile(db, join(root, '..', '..', 'etc', 'hosts'))).rejects.toThrow(/außerhalb/)
  })
})

describe('Lokale lexikalische Embeddings', () => {
  const p = new LocalLexicalProvider()

  it('erzeugt normalisierte Vektoren', async () => {
    const [v] = await p.embed(['Fahrschule Krebs Preisliste'])
    const norm = Math.sqrt([...v!].reduce((s, x) => s + x * x, 0))
    expect(norm).toBeCloseTo(1, 5)
  })

  it('bewertet verwandte Texte höher als fremde', async () => {
    const [a, b, c] = await p.embed([
      'Preisliste Fahrstunde Grundbetrag',
      'Grundbetrag und Fahrstunde laut Preisliste',
      'Segeln auf der Ostsee mit dem Sportboot',
    ])
    expect(cosine(a!, b!)).toBeGreaterThan(cosine(a!, c!))
  })

  it('ist deterministisch', async () => {
    const [x] = await p.embed(['gleicher Text'])
    const [y] = await p.embed(['gleicher Text'])
    expect(cosine(x!, y!)).toBeCloseTo(1, 6)
  })
})

// Cleanup is best-effort; tmpdir is reclaimed by the OS regardless.
process.on('exit', () => { try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ } })
