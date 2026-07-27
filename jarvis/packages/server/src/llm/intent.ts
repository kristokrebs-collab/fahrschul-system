/**
 * Cheap, deterministic intent classification.
 *
 * Runs before any model call so a "Guten Morgen" does not trigger a retrieval
 * sweep, a web search, and a knowledge-graph animation. Being wrong here is
 * cheap in one direction (an unnecessary retrieval costs milliseconds) and
 * expensive in the other (answering a factual question with no sources), so
 * the defaults lean towards retrieving.
 */

export type Intent =
  | 'smalltalk'
  | 'private_question'
  | 'current_info'
  | 'action_request'
  | 'memory_op'
  | 'system_query'

export interface IntentResult {
  intent: Intent
  retrieve: boolean
  allowWeb: boolean
  confidence: number
  reason: string
}

const SMALLTALK = /^\s*(hallo|hi|hey|servus|moin|guten (morgen|tag|abend)|na\b|wie geht|danke|dank(e )?dir|passt|ok(ay)?|alles klar|tschüss|bis später|gute nacht|super|prima|top)\b[\s!.?]*$/i

const CURRENT_INFO = /\b(heute|aktuell|gerade jetzt|neueste[nrs]?|letzte[nrs]? (woche|monat|tage)|news|nachricht(en)?|kurs|wetter|börse|schlagzeile|gesetzeslage|202[6-9]|jüngste)\b/i

const ACTION = /\b(schick|sende|versend|mail(e)?\b|schreib.*(mail|nachricht)|poste|veröffentlich|lösch|entferne|leg(e)? .* an|erstell|plane?\b|trag.*ein|termin|erinnere mich|führe .* aus|starte)\b/i

const MEMORY = /\b(merk(e)? dir|behalte|vergiss|erinnerst du|was weißt du über|aktualisiere was du|speicher(e)? dass|denk dran)\b/i

const SYSTEM = /\b(status|systemzustand|läuft|health|version|wie viele (quellen|dokumente|aufgaben)|index|backup|warteschlange|jobs?)\b/i

export function classifyIntent(message: string): IntentResult {
  const text = message.trim()

  if (text.length <= 40 && SMALLTALK.test(text)) {
    return {
      intent: 'smalltalk', retrieve: false, allowWeb: false, confidence: 0.9,
      reason: 'Kurze Begrüßung oder Bestätigung – keine Recherche nötig',
    }
  }
  if (MEMORY.test(text)) {
    return {
      intent: 'memory_op', retrieve: true, allowWeb: false, confidence: 0.8,
      reason: 'Bezieht sich auf den Erinnerungsspeicher',
    }
  }
  if (SYSTEM.test(text) && text.length < 120) {
    return {
      intent: 'system_query', retrieve: false, allowWeb: false, confidence: 0.7,
      reason: 'Frage zum Systemzustand',
    }
  }
  if (ACTION.test(text)) {
    return {
      intent: 'action_request', retrieve: true, allowWeb: false, confidence: 0.75,
      reason: 'Handlungsaufforderung – Kontext wird geladen, Ausführung erst nach Bestätigung',
    }
  }
  if (CURRENT_INFO.test(text)) {
    return {
      intent: 'current_info', retrieve: true, allowWeb: true, confidence: 0.8,
      reason: 'Frage nach aktuellen Informationen – Live-Recherche sinnvoll',
    }
  }
  return {
    intent: 'private_question', retrieve: true, allowWeb: true, confidence: 0.6,
    reason: 'Inhaltliche Frage – private Quellen zuerst',
  }
}
