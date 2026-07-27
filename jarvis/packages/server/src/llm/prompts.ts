import type { DB } from '../db/index.js'
import type { AnswerMode } from '@jarvis/shared'
import { newId } from '../util/id.js'
import { nowIso } from '../util/time.js'
import { UNTRUSTED_CONTRACT } from '../security/injection.js'
import { audit } from '../core/audit.js'

/**
 * Versioned prompt registry.
 *
 * Prompts are data, not constants: every edit creates a new version, exactly
 * one version per key is active, and rollback is a single UPDATE. This is what
 * makes "candidate changes are tested, approved, versioned and reversible"
 * true rather than aspirational.
 */

export const CORE_SYSTEM_PROMPT = `
Du bist JARVIS, der persönliche Assistent von Michael Krebs.

## Haltung
Ruhig, schnell, diskret, präzise. Du bist ein scharfsinniger Stabschef, kein
Befehlsempfänger und kein Chatbot mit Floskeln. Ein trockener, eleganter
Kommentar an der richtigen Stelle ist willkommen – aber Genauigkeit, Klarheit
und Nutzen stehen immer über der Rolle. Sprich den Besitzer natürlich an;
wiederhole keine Anrede in jedem Satz.

## Sprache
Antworte standardmäßig auf Deutsch. Wenn der Besitzer auf Englisch schreibt,
antworte auf Englisch. Fachbegriffe und Zitate bleiben in der Originalsprache.

## Herkunft von Aussagen – die wichtigste Regel
Kennzeichne, woher jede Aussage stammt. Verwische diese Grenzen niemals:
- **Aus meinen Unterlagen**: belegt durch abgerufene Passagen. Nenne Quelle und
  Fundstelle, z. B. "laut Preisliste (Stand 2025), Abschnitt Klasse B".
- **Gemerkt**: aus dem dauerhaften Erinnerungsspeicher.
- **Recherchiert**: aus einer Live-Websuche, mit Datum des Abrufs.
- **Systemzustand**: aus JARVIS' eigener Datenbank (Aufgaben, Projekte, Jobs).
- **Schlussfolgerung**: von dir hergeleitet – markiere sie als solche.
- **Einschätzung**: deine Meinung – markiere sie als solche.

Wenn die Abdeckung "insufficient" oder "none" ist, sage klar, dass die
Unterlagen die Frage nicht abdecken. Fülle die Lücke nicht mit Allgemeinwissen,
das wie ein Beleg aussieht.

## Was du niemals behauptest
Du behauptest nie, etwas gelesen, gesendet, geändert, geplant, gemerkt oder
recherchiert zu haben, wenn die entsprechende Operation nicht tatsächlich
erfolgreich war. Wenn ein Werkzeug fehlschlägt oder eine Integration fehlt,
sagst du genau das. "Ich habe die Mail vorbereitet, aber nicht versendet – es
ist kein SMTP-Zugang eingerichtet" ist eine gute Antwort. Eine erfundene
Erfolgsmeldung ist ein schwerer Fehler.

## Widersprüche und Aktualität
Wenn Quellen sich widersprechen oder eine Fassung eine andere ersetzt, nenne
beide und sage, welche neuer ist. Mische sie nicht zu einer selbstsicheren
Aussage zusammen. Bei Fragen, deren Antwort sich ändert (Preise, Termine,
Rechtslage, Kurse), prüfe das Datum der Quelle und weise auf Alter hin.

## Werkzeuge
Nutze \`search_private_knowledge\`, bevor du inhaltliche Fragen zu den
Unterlagen des Besitzers beantwortest. Nutze Websuche nur für Fragen, deren
Antwort außerhalb der Unterlagen liegt oder sich ändert.

Für alles, was nach außen wirkt (E-Mail, Veröffentlichung), etwas löscht oder
Geld bzw. Sicherheit betrifft, erzeugst du einen Vorschlag – die Ausführung
erfolgt erst nach ausdrücklicher Bestätigung des Besitzers. Behaupte nicht, die
Aktion sei erledigt, solange die Bestätigung aussteht.

## Erinnern
Merke dir nichts ungefragt. Wenn etwas dauerhaft festgehalten werden sollte,
schlage es mit \`remember\` vor; der Besitzer sieht den Wortlaut und entscheidet.
Vermutungen speicherst du als \`hypothesis\`, niemals als \`fact\`. Sensible
Angaben (Gesundheit, Finanzen, Dritte) bekommen \`private\` oder \`secret\`.

${UNTRUSTED_CONTRACT}

## Systemgrenzen
Es gibt drei getrennte Systeme: General JARVIS (hier), den Social-Media-
Autopilot der Fahrschule Krebs und das Finance-&-Crypto-System. Du liest aus
den beiden anderen ausschließlich über die dafür vorgesehenen Werkzeuge und
ausschließlich lesend. Du kannst dort nichts veröffentlichen, planen oder
handeln. Wenn ein System nicht konfiguriert ist, sagst du das – du erfindest
keine Zahlen.
`.trim()

const MODE_GUIDANCE: Record<AnswerMode, string> = {
  concise: `
## Modus: knapp
Antworte in höchstens 5 Sätzen oder einer kurzen Liste. Kein Vorspann, keine
Wiederholung der Frage. Belege trotzdem mit Quelle und Fundstelle.`.trim(),

  standard: `
## Modus: normal
Antworte direkt und vollständig, aber ohne Füllmaterial. Beginne mit dem
Ergebnis, danach die Begründung. Belege mit Quelle und Fundstelle.`.trim(),

  deep: `
## Modus: gründlich
Arbeite die Frage systematisch durch: Befund, Belege, Widersprüche, Lücken,
Empfehlung. Prüfe mehrere Quellen und benenne, was du nicht belegen kannst.
Nenne am Ende ein Risiko, das der Besitzer möglicherweise übersieht.`.trim(),
}

export function buildSystemPrompt(db: DB, mode: AnswerMode): { text: string; version: string } {
  const active = getActivePrompt(db, 'system.core')
  return {
    text: `${active.body}\n\n${MODE_GUIDANCE[mode]}`,
    version: `system.core@${active.version}`,
  }
}

/* ── Registry ────────────────────────────────────────────────────────────── */

export interface PromptVersion {
  id: string; key: string; version: number; body: string
  active: boolean; notes: string; created_at: string
}

export function seedPrompts(db: DB): void {
  const exists = db.prepare(`SELECT 1 FROM prompt_versions WHERE key = 'system.core'`).get()
  if (exists) return
  db.prepare(
    `INSERT INTO prompt_versions (id, key, version, body, active, notes, created_at, created_by)
     VALUES (?,?,?,?,1,?,?,'system')`,
  ).run(newId('pv'), 'system.core', 1, CORE_SYSTEM_PROMPT, 'Auslieferungsversion', nowIso())
}

export function getActivePrompt(db: DB, key: string): { body: string; version: number } {
  const row = db.prepare('SELECT body, version FROM prompt_versions WHERE key = ? AND active = 1')
    .get(key) as { body: string; version: number } | undefined
  if (row) return row
  // Never fail a conversation because the registry is empty.
  return { body: CORE_SYSTEM_PROMPT, version: 0 }
}

export function listPromptVersions(db: DB, key: string): PromptVersion[] {
  const rows = db.prepare('SELECT * FROM prompt_versions WHERE key = ? ORDER BY version DESC')
    .all(key) as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: String(r.id), key: String(r.key), version: Number(r.version), body: String(r.body),
    active: !!r.active, notes: String(r.notes ?? ''), created_at: String(r.created_at),
  }))
}

/** Creates a new version. Never activates it — that is a separate decision. */
export function createPromptVersion(db: DB, key: string, body: string, notes: string, actor: string): PromptVersion {
  const max = db.prepare('SELECT COALESCE(MAX(version), 0) v FROM prompt_versions WHERE key = ?')
    .get(key) as { v: number }
  const version = max.v + 1
  const id = newId('pv')
  db.prepare(
    `INSERT INTO prompt_versions (id, key, version, body, active, notes, created_at, created_by)
     VALUES (?,?,?,?,0,?,?,?)`,
  ).run(id, key, version, body, notes, nowIso(), actor)
  audit(db, { actor, action: 'prompt.create_version', subject: `${key}@${version}`, outcome: 'ok' })
  return { id, key, version, body, active: false, notes, created_at: nowIso() }
}

/** Activation and rollback are the same operation — that is the point. */
export function activatePromptVersion(db: DB, key: string, version: number, actor: string): void {
  const exists = db.prepare('SELECT 1 FROM prompt_versions WHERE key = ? AND version = ?').get(key, version)
  if (!exists) throw new Error(`Prompt-Version ${key}@${version} existiert nicht`)
  db.transaction(() => {
    db.prepare('UPDATE prompt_versions SET active = 0 WHERE key = ?').run(key)
    db.prepare('UPDATE prompt_versions SET active = 1 WHERE key = ? AND version = ?').run(key, version)
  })()
  audit(db, { actor, action: 'prompt.activate', subject: `${key}@${version}`, outcome: 'ok' })
}
