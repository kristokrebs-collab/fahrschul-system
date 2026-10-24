/**
 * `parseStrategyText` – the local, rule-based reader of a strategy written in German ("Long, wenn der RSI unter 30 fällt
 * und der Kurs über dem EMA 200 liegt, Stop 1,5 ATR, Ziel 2R, nur in der London-Session"). No network, no model, no
 * randomness: the same text and answers always give the same rules.
 *
 * What it will NOT do is guess: a part it cannot place is listed as unclear, a missing decision is a question with answer
 * chips (the answers complete the rules and are handed back in `options.answers`), and every default it had to take is an
 * assumption the trader sees and can change. The rules are the lab's own `CustomConfig`; whatever the lab refuses stays in
 * `issues`.
 */
import { buildParse } from "./build";
import { extractConditions } from "./conditions";
import { Ctx } from "./ctx";
import { scanGlobals } from "./globals";
import { foldWithNumbers } from "./normalize";
import { TEXT_MAX, type ParseOptions, type StrategyParse } from "./types";

export function parseStrategyText(text: string, options: ParseOptions = {}): StrategyParse {
  const src = text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text;
  const ctx = new Ctx(foldWithNumbers(src), src, options.answers ?? {});
  scanGlobals(ctx);
  extractConditions(ctx);
  const out = buildParse(ctx, src);
  if (text.length > TEXT_MAX) out.unclear.push({ id: "x-cut", phrase: "", span: null, why: `Der Text ist länger als ${TEXT_MAX} Zeichen – der Rest wurde nicht gelesen.` });
  return out;
}

/** The answers that still belong to a question or an assumption of `parse` (a changed text drops the rest). */
export function pruneAnswers(parse: Pick<StrategyParse, "asks" | "assumptionItems">, answers: Readonly<Record<string, string>>): Record<string, string> {
  const live = new Set([...parse.asks.map((a) => a.id), ...parse.assumptionItems.map((a) => a.id)]);
  return Object.fromEntries(Object.entries(answers).filter(([k]) => live.has(k)));
}
