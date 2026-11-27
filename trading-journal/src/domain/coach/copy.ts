/**
 * German copy of the coach (P04): advice per behaviour (what to do, the cooldown the live watcher suggests), titles,
 * leads, labels and the principles the weekly lesson falls back to when the journal has nothing to say yet.
 * Tone: short, direct, factual – a trading coach, never a diagnosis (no clinical words).
 */
import type { BehaviorKey, BehaviorSeverity } from "./events";

export const COACH_TITLE = "Coach";
export const COACH_LEAD = "Dein Coach liest jeden Trade mit: Muster, Leaks und Edges – mit Belegen und ehrlicher Konfidenz.";
export const COACH_HIGHLIGHT = "Belegen";

export const BERICHTE_TITLE = "Berichte";
export const BERICHTE_LEAD = "Tag, Woche, Monat, Quartal, Jahr – dein Trading schwarz auf weiß, zum Exportieren und Drucken.";
export const BERICHTE_HIGHLIGHT = "schwarz auf weiß";

export const SEVERITY_LABEL: Readonly<Record<BehaviorSeverity, string>> = { 1: "Hinweis", 2: "Warnung", 3: "Kritisch" };

export interface BehaviorAdvice {
  /** imperative, one line */
  advice: string;
  /** suggested pause in minutes after a live hit (0 = none, -1 = rest of the day) */
  cooldownMin: number;
  /** what the detector looks at (explainer) */
  rule: string;
  /** goal title when it makes it into the plan */
  goal: string;
}

export const BEHAVIOR_ADVICE: Readonly<Record<BehaviorKey, BehaviorAdvice>> = {
  revenge: {
    advice: "Nach einem Verlust 30 Minuten Pause, dann erst der nächste Einstieg.",
    cooldownMin: 30,
    rule: "Einstieg bis 60 Min nach einem geschlossenen Verlust; schwerer bei größerer Position oder als Revenge markiert.",
    goal: "Keine Revenge-Trades",
  },
  tilt: {
    advice: "Zwei Verluste in Folge: Tag beenden oder Größe halbieren.",
    cooldownMin: 60,
    rule: "Weitere Trades am selben Tag nach zwei oder mehr Verlusten in Folge.",
    goal: "Nach 2 Verlusten Schluss für heute",
  },
  overtrading: {
    advice: "Tageslimit erreicht – heute keine weiteren Trades.",
    cooldownMin: -1,
    rule: "Mehr Trades pro Tag und Konto als deine Disziplin-Grenze, oder 4 Trades innerhalb einer Stunde.",
    goal: "Tageslimit an Trades einhalten",
  },
  fomo: {
    advice: "Nur an deinem Level einsteigen – ein verpasster Move ist kein Verlust.",
    cooldownMin: 15,
    rule: "Gefühl FOMO, Fehler-Tag „FOMO-Einstieg“ oder Einstieg deutlich schlechter als der geplante Preis.",
    goal: "Keine FOMO-Einstiege",
  },
  stopMoved: {
    advice: "Der Stop bleibt, wo er ist – nie weiter weg vom Einstieg ziehen.",
    cooldownMin: 0,
    rule: "Stop-Verlauf, in dem der Stop vom Einstieg weg verschoben wurde, oder ein Verlust deutlich über 1 R.",
    goal: "Stop nie verschieben",
  },
  earlyProfit: {
    advice: "Teilgewinn ja – den Rest mit Trailing-Stop zum Ziel laufen lassen.",
    cooldownMin: 0,
    rule: "Gewinner mit weniger als 35 % des maximalen Laufs oder weit unter dem geplanten R:R geschlossen.",
    goal: "Gewinner bis zum Plan laufen lassen",
  },
  lossAversion: {
    advice: "Verlierer nicht länger halten als Gewinner – der Stop entscheidet.",
    cooldownMin: 0,
    rule: "Verlierer mindestens doppelt so lange gehalten wie deine Gewinner im Median.",
    goal: "Verlierer nicht aussitzen",
  },
  overconfidence: {
    advice: "Nach einer Gewinnserie die Größe nicht erhöhen.",
    cooldownMin: 0,
    rule: "Nach drei Gewinnen in Folge mit mindestens 1,5× der üblichen Größe oder über der Hebel-Regel eingestiegen.",
    goal: "Größe nach Gewinnserien halten",
  },
  impulsive: {
    advice: "Erst Grundlage und Begründung, dann der Einstieg.",
    cooldownMin: 10,
    rule: "Einstieg ohne Grundlage und ohne Begründung, oder wenige Minuten nach dem letzten Ausstieg.",
    goal: "Jeder Trade mit Grundlage",
  },
  boredom: {
    advice: "Keine Grundlage, keine Überzeugung – kein Trade.",
    cooldownMin: 15,
    rule: "Niedrige Überzeugung (1–2) ohne Grundlage, oder als Langeweile markiert.",
    goal: "Keine Langeweile-Trades",
  },
  ruleViolation: {
    advice: "Stop, Hebel, Plan und Checkliste sind die Grenze – keine Ausnahmen.",
    cooldownMin: 0,
    rule: "Kein Stop, Hebel über der Regel, gegen den Plan, unvollständige Checkliste, Verlust oder Tagesverlust über der Grenze.",
    goal: "Null Regelverstöße",
  },
};

/** Principles of the weekly lesson when the journal has no data-driven lesson yet (rotates per ISO week). */
export const PRINCIPLES: readonly { lines: readonly string[]; highlight: string }[] = [
  { lines: ["Der Stop ist der Plan.", "Alles andere ist Hoffnung."], highlight: "Stop" },
  { lines: ["Trade the best,", "fuck the rest."], highlight: "best" },
  { lines: ["Größe ist Risiko.", "Risiko ist eine Entscheidung."], highlight: "Risiko" },
  { lines: ["Ein verpasster Trade", "kostet nichts."], highlight: "nichts" },
  { lines: ["Zwei Verluste in Folge?", "Pause. Nicht Rache."], highlight: "Pause" },
  { lines: ["Journal heißt:", "jeden Trade ehrlich ansehen."], highlight: "ehrlich" },
];

/** Rotating tips when the journal has nothing specific yet. */
export const GENERIC_TIPS: readonly string[] = ["Stop vor dem Einstieg", "Risiko pro Trade fix", "Nach Verlust: Pause", "Nur A-Setups", "Jeden Trade reviewen"];

export const FALLBACK_HELP =
  "Das habe ich nicht verstanden. Frag mich nach Kennzahlen (Win-Rate, P&L, Ø R, Profit-Faktor, Drawdown, Gebühren), nach Zeiträumen (heute, letzte Woche, September), nach Setups, Sessions, Wochentagen, Paaren – oder nach Verhalten wie Revenge oder FOMO.";

export const CONFIDENCE_HINT: Readonly<Record<"klar" | "Tendenz" | "zu wenig Daten", string>> = {
  klar: "Hält dem Zufall stand (FDR-korrigiert, stabil in beiden Hälften).",
  Tendenz: "Zeichnet sich ab – aber noch nicht sicher.",
  "zu wenig Daten": "Noch zu wenige Trades für eine Aussage.",
};
