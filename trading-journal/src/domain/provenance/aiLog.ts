/**
 * `settings.aiLog` – das KI-Protokoll (F24): welcher KI-Helfer der App wann gefragt wurde, mit welchem Modell (und welcher
 * Version, soweit der Server sie nennt), und ob die App die Antwort übernommen hat. Versioniertes Passthrough
 * (`{ v: 1, entries: [{ id, helper, model, version, at, adopted, ref }] }`), höchstens 100 Einträge (die ältesten fallen
 * heraus), eine Id-Liste, damit der Cloud- und Zwei-Tab-Merge je Eintrag arbeitet. Lesen ist nachsichtig (`aiLogCfgOf`),
 * Schreiben behält jeden unbekannten Schlüssel der Wurzel und jeden Eintrag, den diese Version nicht lesen kann (`rejected`) –
 * das Muster von `settings.watchlist` und `settings.keyLevels`.
 *
 * Was NICHT drinsteht: keine Frage, keine Antwort, kein Strategietext, keine Zahl aus dem Journal. Ein Eintrag sagt nur
 * „Helfer X, Modell Y, Zeitpunkt Z, übernommen ja / nein / offen“.
 *
 * „Übernommen“ heißt je Helfer etwas anderes (`AI_HELPERS[].adopted`):
 *   assistant  mindestens eine vorgeschlagene Frage hat die lokale Prüfung bestanden und wurde beantwortet
 *   studio     die Lesart des Modells hat die strengen Prüfungen bestanden und ersetzt die lokale Lesart im Editor
 *   coach      der umformulierte Text hat die Zahlenprüfung bestanden und wurde gezeigt
 *   optimizer  der Vorschlag wurde gespeichert oder als Herausforderer gestartet (verworfen = abgelehnt) – das Suchverfahren ist
 *              kein Sprachmodell, `model` bleibt leer
 */
export const AI_LOG_VERSION = 1 as const;
export const MAX_AI_LOG = 100;

export type AiHelper = "assistant" | "studio" | "coach" | "optimizer";

export interface AiHelperInfo {
  id: AiHelper;
  label: string;
  /** one sentence: what the helper does */
  what: string;
  /** one sentence: what „übernommen“ means for it */
  adopted: string;
}

export const AI_HELPERS: readonly AiHelperInfo[] = [
  { id: "assistant", label: "Assistent (Sprachhilfe)", what: "Ordnet eine freie Frage einer Frage zu, die die App selbst beantworten kann.", adopted: "Mindestens eine zugeordnete Frage hat die lokale Prüfung bestanden und wurde beantwortet." },
  { id: "studio", label: "Strategie-Übersetzer (Studio)", what: "Liest einen Strategietext als Regeln für das Labor.", adopted: "Die Lesart hat alle strengen Prüfungen bestanden und ersetzt die lokale Lesart im Editor." },
  { id: "coach", label: "Coach (Umformulierung)", what: "Formuliert eine fertig berechnete Coach-Antwort um.", adopted: "Der Text hat die Zahlenprüfung bestanden und wurde gezeigt." },
  { id: "optimizer", label: "Optimierer (Suchverfahren)", what: "Schlägt im Hintergrund bessere Einstellungen für eine Strategie vor – ein Suchverfahren, kein Sprachmodell.", adopted: "Der Vorschlag wurde gespeichert oder als Herausforderer gestartet; abgelehnt = nicht übernommen." },
];
export const AI_HELPER_LABEL: Readonly<Record<AiHelper, string>> = Object.fromEntries(AI_HELPERS.map((h) => [h.id, h.label])) as Record<AiHelper, string>;
export const isAiHelper = (v: unknown): v is AiHelper => typeof v === "string" && AI_HELPERS.some((h) => h.id === v);

export interface AiLogEntry {
  id: string;
  helper: AiHelper;
  /** the model as the server reported it, `null` when none was involved (optimizer) or the server named none */
  model: string | null;
  /** the dated snapshot inside the model id (`…-20250805`), `null` when the id carries none */
  version: string | null;
  /** ms */
  at: number;
  /** taken over (true), not taken over (false), not decided / not applicable (null) */
  adopted: boolean | null;
  /** an id the entry points to (the optimizer's proposal) – never text */
  ref?: string;
}

export interface ParsedAiLog {
  v: typeof AI_LOG_VERSION;
  entries: AiLogEntry[];
  /** stored entries this version could not read – written back untouched */
  rejected: unknown[];
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** `claude-opus-4-1-20250805` → `{ model, version: "20250805" }`; an id without a date has no known version. */
export function splitModel(raw: string | null | undefined): { model: string | null; version: string | null } {
  const model = typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 80) : null;
  const m = model ? /-(20\d{6})$/.exec(model) : null;
  return { model, version: m ? m[1]! : null };
}

export function normalizeEntry(raw: unknown): AiLogEntry | null {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id || !isAiHelper(raw.helper)) return null;
  if (typeof raw.at !== "number" || !Number.isFinite(raw.at) || raw.at <= 0) return null;
  const { model, version } = splitModel(typeof raw.model === "string" ? raw.model : null);
  const e: AiLogEntry = {
    ...raw,
    id: raw.id.slice(0, 60),
    helper: raw.helper,
    model,
    version: typeof raw.version === "string" && raw.version.trim() ? raw.version.trim().slice(0, 20) : version,
    at: raw.at,
    adopted: typeof raw.adopted === "boolean" ? raw.adopted : null,
  };
  if (typeof raw.ref === "string" && raw.ref.trim()) e.ref = raw.ref.trim().slice(0, 80);
  else delete e.ref;
  return e;
}

export const EMPTY_AI_LOG: ParsedAiLog = Object.freeze({ v: AI_LOG_VERSION, entries: [], rejected: [] }) as ParsedAiLog;

/** `settings.aiLog` (anything) → the log. Duplicated ids keep the first; entries beyond the limit are dropped (oldest first). */
export function aiLogCfgOf(raw: unknown): ParsedAiLog {
  if (!isObj(raw)) return EMPTY_AI_LOG;
  const entries: AiLogEntry[] = [];
  const rejected: unknown[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(raw.entries) ? raw.entries : []) {
    const e = normalizeEntry(x);
    if (!e) rejected.push(x);
    else if (!seen.has(e.id)) {
      seen.add(e.id);
      entries.push(e);
    }
  }
  entries.sort((a, b) => a.at - b.at);
  return { v: AI_LOG_VERSION, entries: entries.slice(-MAX_AI_LOG), rejected };
}

export const aiLogOfSettings = (s: { aiLog?: unknown } | null | undefined): ParsedAiLog => aiLogCfgOf(s?.aiLog);

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}

/** `settings.aiLog` with `entries` written – unknown root keys and unreadable entries survive. Returns the SAME object when nothing changes. */
export function withAiLog(raw: unknown, entries: readonly AiLogEntry[]): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const cur = aiLogCfgOf(raw);
  const next: Record<string, unknown> = { ...prev, v: AI_LOG_VERSION, entries: [...entries.slice(-MAX_AI_LOG), ...cur.rejected] };
  return isObj(raw) && JSON.stringify(canon(prev)) === JSON.stringify(canon(next)) ? (raw as Record<string, unknown>) : next;
}

export interface AiLogInput {
  helper: AiHelper;
  model?: string | null;
  adopted?: boolean | null;
  ref?: string;
  /** ms; default `now` */
  at?: number;
}

/** The entry an input makes (id and time are the caller's). */
export function entryOf(input: AiLogInput, id: string, now: number): AiLogEntry {
  const { model, version } = splitModel(input.model);
  const e: AiLogEntry = { id, helper: input.helper, model, version, at: input.at ?? now, adopted: input.adopted ?? null };
  if (input.ref) e.ref = input.ref.slice(0, 80);
  return e;
}

/** `entries` plus the new entry (oldest dropped beyond the limit). */
export function appendEntry(entries: readonly AiLogEntry[], input: AiLogInput, id: string, now: number): AiLogEntry[] {
  return [...entries, entryOf(input, id, now)].sort((a, b) => a.at - b.at).slice(-MAX_AI_LOG);
}

/** Decision on an entry that was open (`null`) – an already decided entry keeps its answer. */
export function decideEntry(entries: readonly AiLogEntry[], id: string, adopted: boolean): AiLogEntry[] {
  return entries.map((e) => (e.id === id && e.adopted == null ? { ...e, adopted } : e));
}

export interface AiLogRow {
  helper: AiHelper;
  label: string;
  calls: number;
  adopted: number;
  notAdopted: number;
  open: number;
  /** models seen, most used first (`model` null = „kein Sprachmodell / nicht genannt“ is left out) */
  models: { model: string; version: string | null; n: number }[];
  first: number | null;
  last: number | null;
}

/** One row per helper that has entries (fixed order). */
export function summarizeAiLog(entries: readonly AiLogEntry[]): AiLogRow[] {
  const rows: AiLogRow[] = [];
  for (const h of AI_HELPERS) {
    const mine = entries.filter((e) => e.helper === h.id);
    if (!mine.length) continue;
    const models = new Map<string, { model: string; version: string | null; n: number }>();
    for (const e of mine) {
      if (!e.model) continue;
      const cur = models.get(e.model);
      if (cur) cur.n++;
      else models.set(e.model, { model: e.model, version: e.version, n: 1 });
    }
    const at = mine.map((e) => e.at);
    rows.push({
      helper: h.id,
      label: h.label,
      calls: mine.length,
      adopted: mine.filter((e) => e.adopted === true).length,
      notAdopted: mine.filter((e) => e.adopted === false).length,
      open: mine.filter((e) => e.adopted == null).length,
      models: [...models.values()].sort((a, b) => b.n - a.n || a.model.localeCompare(b.model)),
      first: Math.min(...at),
      last: Math.max(...at),
    });
  }
  return rows;
}
