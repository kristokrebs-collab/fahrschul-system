/**
 * Questions to the own journal in German (P04 NLQ): `askJournal(question, data)` = `parseQuestion` → `answerIntent`,
 * plus `suggestQuestions(data)` for the chips. Deterministic and offline – the optional LLM (`coach-ask` function)
 * only rephrases the computed facts of an `Answer`, it never answers by itself.
 */
import type { EnrichedTrade } from "../../types";
import type { BehaviorKey } from "../events";
import { pairKey } from "../../grouping";
import { behaviorReport } from "../behaviors";
import { answerIntent, type Answer, type AnswerData } from "./answer";
import { assetBase, parseQuestion, type Intent, type ParseContext } from "./parse";

export * from "./lexicon";
export * from "./parse";
export * from "./answer";

/** The chip question of each behaviour (all understood by the parser). */
export const BEHAVIOR_QUESTION: Readonly<Record<BehaviorKey, string>> = {
  revenge: "Was kosten mich Revenge-Trades?",
  tilt: "Was kostet mich Tilt?",
  overtrading: "Was kostet mich Overtrading?",
  fomo: "Was kosten mich FOMO-Einstiege?",
  stopMoved: "Wie oft habe ich den Stop verschoben?",
  earlyProfit: "Wie oft bin ich zu früh raus?",
  lossAversion: "Was kostet mich Verlustangst?",
  overconfidence: "Was kostet mich Selbstüberschätzung?",
  impulsive: "Wie oft war ich impulsiv?",
  boredom: "Was kosten mich Langeweile-Trades?",
  ruleViolation: "Wie oft habe ich Regeln gebrochen?",
};

/** Parse context of a journal: its setups, the asset bases and tags it trades. */
export function parseContextOf(closed: readonly EnrichedTrade[], data: Pick<AnswerData, "settings" | "now">): ParseContext {
  const assets = new Set<string>();
  const tags = new Set<string>();
  for (const t of closed) {
    const k = pairKey(t.pair || "");
    if (k) assets.add(assetBase(k));
    for (const tag of t.tags ?? []) if (typeof tag === "string" && tag.trim()) tags.add(tag.trim());
  }
  return { setups: data.settings.setups, assets: [...assets], tags: [...tags], now: data.now };
}

/** Answers a German question about the journal. */
export function askJournal(question: string, data: AnswerData): Answer {
  const intent: Intent = parseQuestion(question, parseContextOf(data.closed, data));
  return answerIntent(intent, data);
}

/**
 * Question chips for the chat: the strongest questions for THIS journal first (its most expensive behaviour, its
 * setups, both sides), each of which the parser understands.
 */
export function suggestQuestions(data: AnswerData, max = 6): string[] {
  const out: string[] = [];
  const closed = data.closed;
  if (!closed.length) return [];
  const rep = behaviorReport(data.events, closed);
  if (rep.worst) out.push(BEHAVIOR_QUESTION[rep.worst.key]);
  const known = new Set(data.settings.setups.map((s) => s.id));
  if (closed.some((t) => (t.setups ?? []).some((id) => known.has(id)))) out.push("Was ist mein bestes Setup?");
  out.push("Wie war letzte Woche?");
  if (closed.some((t) => t.side === "short") && closed.some((t) => t.side !== "short")) out.push("Vergleiche Long und Short");
  out.push("Welche Session ist am profitabelsten?");
  out.push("An welchem Wochentag verliere ich am meisten?");
  out.push("Mein größter Verlust");
  out.push("Win-Rate diesen Monat");
  return [...new Set(out)].slice(0, max);
}
