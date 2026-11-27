/**
 * Tariff contract per function (A1, `docs/TARIFE.md`): for every point F01–F74 of the build plan the plan it needs, the
 * parts that need a higher one and the quotas that bound it. PURE – imports only `./types` and `./plans`, so the Netlify
 * functions, the cron and the browser read the SAME table (and the main bundle does not carry it: only lazy pages and tests do).
 *
 * How it hangs together with the rest (a unit test keeps all of it honest, `tests/unit/billing.tariff.test.ts`):
 *   - `plans.ts` decides WHAT each plan includes (`PLAN_FEATURES`) and HOW MUCH (`PLAN_LIMITS`) – the one table the gates read;
 *   - the register (`src/app/features.ts`) carries a `gate` on every entry that code really gates (`<Gate>`, `useEntitlement`,
 *     `requireFeature`); the register entries of one F-ID agree with `core` / `extras` of its row here, or the test fails;
 *   - this file adds the contract per F-ID: name, goal, `core` (the feature the function needs at its heart, `null` = free),
 *     `extras` (parts above it) and `limits` (the quotas that bound it).
 * Changing a plan = change `plans.ts` (and the gate in the register); changing what an F-ID needs = this row AND the register.
 */
import { FEATURES, GOAL_IDS, LIMIT_KEYS, PLAN_IDS, type Feature, type GoalId, type LimitKey, type PlanId } from "./types";
import { PLAN_LIMITS, minPlanFor, planIncludes } from "./plans";

export interface FunctionTariff {
  /** `F01` … `F74` – the point of the build plan (`docs/COVERAGE.md`). */
  fid: string;
  /** Short German name of the point. */
  name: string;
  /** The goal it serves (the tile of the page "Funktionen"). */
  goal: GoalId;
  /** The plan feature the function needs at its heart; `null` = every plan (Free) can use it. */
  core: Feature | null;
  /** Parts of the function that need MORE than `core` (each a plan feature). */
  extras: readonly Feature[];
  /** The quotas that bound it (`PLAN_LIMITS`); the function still works at 0 only where `core` does not need the quota. */
  limits: readonly LimitKey[];
}

const row = (fid: string, name: string, goal: GoalId, core: Feature | null, extras: readonly Feature[], limits: readonly LimitKey[]): FunctionTariff => ({ fid, name, goal, core, extras, limits });

/** One row per point of the build plan, in order. */
export const FUNCTION_TARIFF: readonly FunctionTariff[] = [
  row("F01", "Persönliche Marktampel", "heute", null, [], []),
  row("F02", "Chancenmonitor", "pruefen", null, ["boxScanner"], []),
  row("F03", "Erweiterte Top-Trader-Auswertung", "pruefen", null, [], []),
  row("F04", "Box-zu-Box und relevante Zonen", "pruefen", null, [], []),
  row("F05", "Preis- und RSI-Struktur über Zeiteinheiten", "pruefen", null, [], []),
  row("F06", "Zusätzliche Strategiebausteine", "pruefen", null, ["backtestLab"], []),
  row("F07", "Fehlausbruchs- und Squeeze-Monitor", "pruefen", null, [], []),
  row("F08", "Dynamischer Tages- und Szenarioplan", "heute", null, [], []),
  row("F09", "Eigene Schlüsselmarken", "heute", null, [], []),
  row("F10", "Warum handeln oder auslassen?", "pruefen", null, [], []),
  row("F11", "Persönlicher Regelbaukasten", "testen", "backtestLab", [], []),
  row("F12", "„Diese Idee testen“", "testen", "backtestLab", [], []),
  row("F13", "Creator- und Strategieimport", "testen", "backtestLab", [], []),
  row("F14", "TradingView-/Pine-Zugangswege", "testen", "backtestLab", ["apiAccess"], ["tvConnections"]),
  row("F15", "Versionen und persönliche Vorlagen", "testen", null, ["backtestLab"], []),
  row("F16", "Vollständiger Backtest", "testen", "backtestLab", [], []),
  row("F17", "Varianten- und Filtervergleich", "testen", "backtestLab", [], []),
  row("F18", "Strategie-Prüfbericht", "testen", "backtestLab", [], []),
  row("F19", "Historisch ähnliche Situationen", "pruefen", null, [], []),
  row("F20", "Kosten- und Belastungstest", "planen", "monteCarlo", ["backtestLab"], ["simulationsPerDay"]),
  row("F21", "Überwachung bei geschlossenem Browser", "heute", "boxScanner", [], ["alertChannels", "phoneCallsPerMonth"]),
  row("F22", "Mehrstufige, ruhige Alarme", "heute", null, [], ["alertChannels", "phoneCallsPerMonth"]),
  row("F23", "Virtuelles Konto je Strategie", "testen", "backtestLab", [], []),
  row("F24", "Mensch-Regelwerk-KI-Vergleich", "auswerten", "analyticsPro", [], []),
  row("F25", "Vollständige Signalbilanz", "lernen", "coach", [], []),
  row("F26", "Historisches Datenarchiv", "daten", null, [], []),
  row("F27", "Daten- und Alarmqualität", "heute", null, ["coach"], ["alertChannels"]),
  row("F28", "Persönlicher Signal-Posteingang", "lernen", "coach", ["apiAccess"], ["tvConnections"]),
  row("F29", "Automatischer Screenshot-Import", "daten", null, ["shotExtract"], ["shotExtractPerDay", "screenshotStorageMb"]),
  row("F30", "Börsen-/CSV-Import und Fills", "daten", null, ["csvImport", "exchangeSync", "shotExtract"], ["shotExtractPerDay", "exchangeConnections", "backgroundSyncConnections"]),
  row("F31", "Zustandsaufnahme vor der Entscheidung", "lernen", null, [], []),
  row("F32", "Verpasste Chancen und gemeinsame Vorzeichen", "lernen", "coach", ["backtestLab"], []),
  row("F33", "Rückblick und Alternativsimulation", "lernen", "replay", [], ["simulationsPerDay"]),
  row("F34", "Persönliche Signalfilter", "auswerten", null, ["analyticsPro"], ["savedViews"]),
  row("F35", "Fehlerkosten und Ausführungsunterschiede", "lernen", "coach", [], []),
  row("F36", "Verhaltensmuster und freiwillige Pausen", "heute", "growth", ["coach"], []),
  row("F37", "Wochenreview und Wochenexperiment", "lernen", "coach", ["reports"], []),
  row("F38", "Lernmodus und Replay-Training", "wachsen", "replay", [], []),
  row("F39", "Positionsgrößenrechner", "pruefen", null, ["riskLive"], []),
  row("F40", "Gesamtrisiko und Abhängigkeiten", "risiko", "riskLive", [], []),
  row("F41", "Persönliche Verlustlimits", "planen", null, ["riskLive"], []),
  row("F42", "Margin-, Funding- und Kontraktdetails", "risiko", null, ["csvImport", "riskLive"], ["exchangeConnections"]),
  row("F43", "Ereigniskalender und Strategiefilter", "heute", null, [], []),
  row("F44", "Praktische Ausführbarkeit", "planen", null, [], []),
  row("F45", "Creator-Playbooks", "testen", "community", ["backtestLab"], []),
  row("F46", "Mentor- und Teammodus", "community", "mentor", [], ["groups"]),
  row("F47", "Gemeinsame Chartfälle und Replays", "community", "community", [], []),
  row("F48", "Kontextbezogene Lerninhalte", "konto", null, [], []),
  row("F49", "Strategie passt zu mir?", "testen", "backtestLab", [], []),
  row("F50", "Nachvollziehbare Community-Ergebnisse", "community", "community", [], []),
  row("F51", "Konto, Cloud und Gerätewechsel", "konto", null, [], []),
  row("F52", "Abo und Nutzungskontingente", "konto", null, [], []),
  row("F53", "Backups und Wiederherstellung", "daten", null, [], []),
  row("F54", "Berichte und Datenexport", "auswerten", "reports", [], []),
  row("F55", "Klare mobile Oberfläche", "konto", null, [], []),
  row("F56", "Zuverlässige Integrationen", "daten", null, ["exchangeSync"], ["exchangeConnections", "backgroundSyncConnections"]),
  row("F57", "Öffentliche Ergebnisbelege", "community", "community", [], []),
  row("F58", "Interaktive Produktdemo", "konto", null, [], []),
  row("F59", "Creator-Kooperation und Vertrieb", "konto", null, [], []),
  row("F60", "Persönlicher Monatsnutzen", "auswerten", "reports", [], []),
  row("F61", "Täglicher Check-in beim ersten Öffnen", "heute", "growth", [], []),
  row("F62", "Chart umdrehen und den eigenen Bias prüfen", "pruefen", null, [], []),
  row("F63", "Visuelles Labor und Zeichenwerkzeuge", "pruefen", null, [], []),
  row("F64", "TradingView-, Pine- und Indikator-Adapter", "testen", "backtestLab", [], []),
  row("F65", "Break-even, Stop-Nachziehen und flexible Ausstiege", "planen", null, ["backtestLab"], []),
  row("F66", "Hintergrund-KI-Forschung", "testen", "backtestLab", [], []),
  row("F67", "Intelligenter Branchen- und Vergleichsscreener", "aktien", null, ["boxScanner"], []),
  row("F68", "Zahlen-, Erwartungs- und Ereignismonitor", "aktien", null, ["stockAnalysis"], []),
  row("F69", "Langfristige Investmentanalyse und Kaufthese", "aktien", null, [], []),
  row("F70", "Kryptobuchhaltung und Transaktionsbuch", "auswerten", "reports", [], []),
  row("F71", "Weltweite Ranglisten mit aussagekräftiger Performance", "community", "community", [], []),
  row("F72", "Kontakte, Teilen, Gruppen und Zusammenarbeit", "community", "community", [], ["groups"]),
  row("F73", "Frei gestaltbares Strategielabor mit Ergebnisdiagnose", "testen", "backtestLab", [], []),
  row("F74", "KI-Assistent mit Kontext, Mikrofon und Aktionen", "konto", null, [], ["coachAiPerDay"]),
];

/** `F01` … `F74`. */
export const FUNCTION_IDS: readonly string[] = FUNCTION_TARIFF.map((t) => t.fid);
export const FUNCTION_COUNT = FUNCTION_TARIFF.length;

const BY_FID = new Map(FUNCTION_TARIFF.map((t) => [t.fid, t] as const));

/** The contract row of a point of the build plan; `undefined` for an unknown id. */
export const tariffOf = (fid: string): FunctionTariff | undefined => BY_FID.get(fid);

/** The cheapest plan that can use the function at all (its `core`; Free when it has none). */
export function startPlanOf(t: FunctionTariff): PlanId {
  return t.core ? minPlanFor(t.core) : "free";
}

/** The cheapest plan that has the whole function: `core` and every extra. */
export function fullPlanOf(t: FunctionTariff): PlanId {
  let best: PlanId = startPlanOf(t);
  for (const f of t.extras) {
    const p = minPlanFor(f);
    if (PLAN_IDS.indexOf(p) > PLAN_IDS.indexOf(best)) best = p;
  }
  return best;
}

/** What `plan` gets of the function: all of it, the core only (extras missing), or nothing. */
export type FunctionAccess = "voll" | "teilweise" | "nein";

export function accessOf(t: FunctionTariff, plan: PlanId): FunctionAccess {
  if (t.core && !planIncludes(plan, t.core)) return "nein";
  return t.extras.every((f) => planIncludes(plan, f)) ? "voll" : "teilweise";
}

/** The goal groups of the contract: every F-ID under its goal, in the order of the day. */
export function tariffByGoal(): { goal: GoalId; rows: FunctionTariff[] }[] {
  return GOAL_IDS.map((goal) => ({ goal, rows: FUNCTION_TARIFF.filter((t) => t.goal === goal) })).filter((g) => g.rows.length > 0);
}

/**
 * A plain, comparable picture of the whole contract (features and limits per plan, plan per F-ID). The server and the
 * client both build it from THIS module; the test compares the two sides and the document `docs/TARIFE.md` is written from it.
 */
export function tariffSnapshot(): {
  features: Record<PlanId, Feature[]>;
  limits: Record<PlanId, Record<LimitKey, number | "unbegrenzt">>;
  functions: Record<string, { start: PlanId; full: PlanId; access: Record<PlanId, FunctionAccess> }>;
} {
  const features = {} as Record<PlanId, Feature[]>;
  const limits = {} as Record<PlanId, Record<LimitKey, number | "unbegrenzt">>;
  for (const p of PLAN_IDS) {
    features[p] = FEATURES.filter((f) => planIncludes(p, f));
    limits[p] = Object.fromEntries(LIMIT_KEYS.map((k) => [k, Number.isFinite(PLAN_LIMITS[p][k]) ? PLAN_LIMITS[p][k] : "unbegrenzt"])) as Record<LimitKey, number | "unbegrenzt">;
  }
  const functions: Record<string, { start: PlanId; full: PlanId; access: Record<PlanId, FunctionAccess> }> = {};
  for (const t of FUNCTION_TARIFF) functions[t.fid] = { start: startPlanOf(t), full: fullPlanOf(t), access: Object.fromEntries(PLAN_IDS.map((p) => [p, accessOf(t, p)])) as Record<PlanId, FunctionAccess> };
  return { features, limits, functions };
}
