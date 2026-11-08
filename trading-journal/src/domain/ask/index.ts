/**
 * "Frag dein Journal" (Paket F2) – a question in German, answered from the journal on the device: no model, no network, no guessing.
 *
 *   question → `parseQuestion` (closed set of question types, `@/domain/coach/nlq`) → filter / aggregate over the real closed trades
 *   (`answerIntent`: `aggregate`, the P03 breakdowns, the coach's behaviour events, the audit questions) → three result cards
 *   with the real numbers, the trades they are about and how reliable the sample is.
 *
 * It does not duplicate the Coach chat: it is the SAME engine (`askJournal`), shown as a bar with three cards, plus one guard the chat
 * does not have – a word of the question that no table knows ("Bitcoinn", "Wetter") ends in "so kann ich das noch nicht beantworten"
 * with three example questions, never in a number for a different question. Pure; see docs/FRAG-DEIN-JOURNAL.md for the question types.
 */
import { answerIntent, parseContextOf, parseQuestion, type Answer, type AnswerConfidence, type AnswerData, type AnswerFact, type ChartRow, type Tone } from "../coach/nlq";
import { pct0, pf as fmtPf, r as fmtR, signed } from "@/lib/format";
import { unknownWords } from "./words";

export { KNOWN, unknownWords } from "./words";

/** One result card: a label, the figure, a line of context. */
export interface AskCard {
  id: string;
  label: string;
  value: string;
  sub?: string;
  tone: Tone;
}

export type AskResult =
  | {
      status: "ok";
      question: string;
      /** how the question was read (chips) */
      reading: string[];
      title: string;
      text: string;
      /** up to three cards */
      cards: AskCard[];
      /** the trades the answer is about, newest first (open one in the trade detail) */
      tradeIds: string[];
      confidence: AnswerConfidence;
      kind: Answer["kind"];
      followUps: string[];
    }
  | {
      /** understood, but there is nothing in this selection – said plainly */
      status: "empty";
      question: string;
      reading: string[];
      title: string;
      text: string;
      cards: [];
      tradeIds: [];
      confidence: AnswerConfidence;
      kind: "empty";
      followUps: string[];
    }
  | {
      /** not understood: nothing is guessed */
      status: "unknown";
      question: string;
      reason: "blank" | "words" | "parse" | "clash";
      /** the words no table knows (reason "words") */
      unknown: string[];
      message: string;
      examples: string[];
    };

/** The closed set of question types (docs/FRAG-DEIN-JOURNAL.md), each with an example the parser answers. */
export const FRAGETYPEN = [
  { id: "outcomes", label: "Verluste einer Auswahl", example: "Verluste im Setup Breakout letzten Monat" },
  { id: "noStop", label: "Trades ohne Stopp", example: "Trades ohne Stopp" },
  { id: "checklist", label: "Checkliste ausgelassen", example: "Wie oft habe ich die Checkliste ausgelassen?" },
  { id: "noReview", label: "Trades ohne Review", example: "Trades ohne Review" },
  { id: "group", label: "Beste / schwächste Gruppe", example: "Beste Wochentage" },
  { id: "metric", label: "Eine Kennzahl", example: "Größter Verlust dieses Jahr" },
  { id: "compare", label: "Zwei Seiten oder Zeiträume vergleichen", example: "Vergleiche Long und Short" },
  { id: "behavior", label: "Verhaltensmuster", example: "Wie oft habe ich den Stop verschoben?" },
  { id: "summary", label: "Ein Zeitraum im Überblick", example: "Wie war letzte Woche?" },
] as const;

export const ASK_STRINGS = {
  unknown: "So kann ich das noch nicht beantworten.",
  blank: "Schreib eine Frage – zum Beispiel eine der unteren.",
  words: (w: readonly string[]) => `Ich kenne ${w.length === 1 ? "das Wort" : "die Wörter"} ${w.map((x) => `„${x}“`).join(", ")} nicht – und ich rate nicht.`,
  clash: "Das sind zwei Fragen in einer – bitte eine nach der anderen.",
  parse: "Ich finde darin keine Frage, die ich aus deinen Trades rechnen kann.",
  none: "Noch keine abgeschlossenen Trades – sobald du welche einträgst, kann ich dazu antworten.",
} as const;

const money = (v: number, cur: string): string => `${signed(v, 0)} ${cur}`;

const fmtUnit = (unit: "R" | "money" | "pct" | "count" | "ratio", v: number, cur: string): string => (unit === "R" ? fmtR(v) : unit === "pct" ? pct0(v) : unit === "count" ? `${Math.round(v)}` : unit === "ratio" ? fmtPf(v) : money(v, cur));

const factCard = (f: AnswerFact, i: number): AskCard => ({ id: `fact-${i}`, label: f.label, value: f.value, tone: f.tone });

const WEEKDAY_LONG: Readonly<Record<string, string>> = { Mo: "Montag", Di: "Dienstag", Mi: "Mittwoch", Do: "Donnerstag", Fr: "Freitag", Sa: "Samstag", So: "Sonntag" };

/** The ranked rows of a group answer: the sample minimum of the engine (3 trades) first, deterministic order. */
function rankedRows(rows: readonly ChartRow[], worst: boolean): ChartRow[] {
  const pool = rows.some((r) => r.n >= 3) ? rows.filter((r) => r.n >= 3) : [...rows];
  return [...pool].sort((a, b) => (worst ? a.value - b.value : b.value - a.value) || b.n - a.n || (a.label < b.label ? -1 : 1));
}

/** Up to three cards for an answer (pure; the numbers are the engine's own). */
export function cardsOf(a: Answer, cur: string): AskCard[] {
  if (a.kind === "empty" || a.kind === "unknown") return [];
  if (a.kind === "group" && a.chart?.type === "bars") {
    const unit = a.chart.unit;
    return rankedRows(a.chart.rows, a.intent.sort === "worst")
      .slice(0, 3)
      .map((r, i) => ({ id: `row-${i}`, label: a.intent.groupBy === "weekday" ? (WEEKDAY_LONG[r.label] ?? r.label) : r.label, value: fmtUnit(unit, r.value, cur), sub: `${r.n} Trade${r.n === 1 ? "" : "s"}`, tone: unit === "pct" || unit === "count" ? "fg" : r.value > 0 ? "win" : r.value < 0 ? "loss" : "mute" }));
  }
  if (a.kind === "compare" && a.facts.length >= 4) {
    const sides = a.intent.compare ? [a.intent.compare[0].label, a.intent.compare[1].label] : [a.intent.period?.label ?? "A", a.intent.period2?.label ?? "B"];
    return [factCard(a.facts[0]!, 0), factCard(a.facts[1]!, 1), { id: "fact-2", label: "Win-Rate", value: `${a.facts[2]!.value} · ${a.facts[3]!.value}`, sub: sides.join(" · "), tone: "fg" }];
  }
  const cards = a.facts.slice(0, 3).map(factCard);
  // the engine's "Schlechtester / Bester Trade" is a Verlust / Gewinn only when its sign says so – the label follows the number
  const first = a.facts[0];
  if (a.kind === "metric" && cards[0] && first?.raw != null && (a.intent.metric === "worst" || a.intent.metric === "best")) {
    cards[0] = { ...cards[0], label: a.intent.metric === "worst" ? (first.raw < 0 ? "Größter Verlust" : "Schwächster Trade") : first.raw > 0 ? "Größter Gewinn" : "Stärkster Trade" };
  }
  return cards;
}

/** Three example questions for THIS journal (a setup it has, a missing stop, the best weekdays) – each is answered by the parser. */
export function exampleQuestions(data: Pick<AnswerData, "closed" | "settings">): string[] {
  const used = new Set(data.closed.flatMap((t) => t.setups ?? []));
  const setup = data.settings.setups.find((s) => used.has(s.id)) ?? data.settings.setups[0];
  return [setup ? `Verluste im Setup ${setup.name} letzten Monat` : "Verluste letzten Monat", "Trades ohne Stopp", "Beste Wochentage"];
}

function unknown(question: string, reason: "blank" | "words" | "parse" | "clash", words: string[], data: AnswerData): AskResult {
  const why = reason === "words" ? ASK_STRINGS.words(words) : reason === "clash" ? ASK_STRINGS.clash : reason === "blank" ? ASK_STRINGS.blank : ASK_STRINGS.parse;
  return { status: "unknown", question, reason, unknown: words, message: reason === "blank" ? why : `${ASK_STRINGS.unknown} ${why}`, examples: exampleQuestions(data) };
}

/** Answers a German question from the journal. Never guesses: see `ASK_STRINGS`. */
export function askCards(question: string, data: AnswerData): AskResult {
  const q = question.trim().slice(0, 300);
  if (!q) return unknown(q, "blank", [], data);
  const ctx = parseContextOf(data.closed, data);
  const intent = parseQuestion(q, ctx);
  // every word must be accounted for: a word no table knows ends the question here – the rest is never answered in its place
  const words = unknownWords(intent.norm, { setups: ctx.setups, assets: ctx.assets, tags: ctx.tags });
  if (words.length) return unknown(q, "words", words, data);
  // an audit question next to a comparison / grouping / behaviour is two questions: not answered by dropping one of them
  if (intent.type === "unknown") return unknown(q, intent.audit ? "clash" : "parse", [], data);
  // "Wie war es?" names neither a period nor a selection: a summary of everything would be a guess at what was meant
  if (intent.type === "summary" && !intent.period && !intent.filters.length) return unknown(q, "parse", [], data);
  const a = answerIntent(intent, data);
  if (a.kind === "unknown") return unknown(q, "parse", [], data);
  if (a.kind === "empty") {
    return { status: "empty", question: q, reading: intent.understood, title: a.title, text: data.closed.length ? a.text : ASK_STRINGS.none, cards: [], tradeIds: [], confidence: a.confidence, kind: "empty", followUps: a.followUps };
  }
  return { status: "ok", question: q, reading: intent.understood, title: a.title, text: a.text, cards: cardsOf(a, data.currency), tradeIds: a.matched ?? a.trades, confidence: a.confidence, kind: a.kind, followUps: a.followUps };
}
