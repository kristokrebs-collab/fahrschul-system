/**
 * „Letzten Trade duplizieren“: what a new trade takes over from the last one – the SETTING of a trade (pair, side, setup,
 * size / leverage, timeframe, tags), never its outcome: no prices, no result, no times, no notes, no checklist, no
 * feelings. Pure; the editor (`TradeEditor`) and the trades page (`TradesView`) both use it.
 */
import type { Setup, Trade } from "@/domain/types";
import { price as fmtPrice } from "@/lib/format";
import type { TradeDraft } from "@/store/uiStore";

/** The trade that was made last: the newest `date` (the one the list shows on top), ties by creation time. */
export function lastTrade<T extends Pick<Trade, "date" | "createdAt">>(trades: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const t of trades) {
    if (!best || (t.date || "") > (best.date || "") || ((t.date || "") === (best.date || "") && (t.createdAt || "") > (best.createdAt || ""))) best = t;
  }
  return best;
}

export interface Carry {
  /** The pre-filled new trade (`openEditor({ draft })` takes it as is). Only keys that carry a value. */
  draft: TradeDraft;
  /** Phrases for the one-sentence confirmation, in reading order ("Symbol BTCUSDT", "Richtung Long" …). */
  taken: string[];
}

const SIDE_LABEL = { long: "Long", short: "Short" } as const;

/** What the new trade takes from `t`. `setups` resolves the setup ids to names for the sentence; unknown ids are carried silently. */
export function carryOver(t: Trade, setups: readonly Pick<Setup, "id" | "name">[], currency = "USDT"): Carry {
  const draft: TradeDraft = {};
  const taken: string[] = [];
  if (t.account) draft.account = t.account;
  if (t.pair) {
    draft.pair = t.pair;
    taken.push(`Symbol ${t.pair}`);
  }
  draft.side = t.side;
  taken.push(`Richtung ${SIDE_LABEL[t.side]}`);
  const ids = (t.setups ?? []).filter((id) => typeof id === "string" && id !== "");
  if (ids.length) {
    draft.setups = [...ids];
    const names = ids.map((id) => setups.find((s) => s.id === id)?.name).filter((n): n is string => Boolean(n));
    if (names.length) taken.push(`${names.length === 1 ? "Setup" : "Setups"} ${names.map((n) => `„${n}“`).join(", ")}`);
  }
  if (t.size != null && t.size > 0) {
    draft.size = t.size;
    taken.push(`Größe ${fmtPrice(t.size)} ${currency}`);
  }
  if (t.leverage != null && t.leverage > 0) {
    draft.leverage = t.leverage;
    taken.push(`Hebel ${fmtPrice(t.leverage)}x`);
  }
  if (t.timeframe) {
    draft.timeframe = t.timeframe;
    taken.push(`Zeitrahmen ${t.timeframe}`);
  }
  const tags = (t.tags ?? []).filter((x) => typeof x === "string" && x.trim() !== "");
  if (tags.length) {
    draft.tags = [...tags];
    taken.push(`${tags.length === 1 ? "Tag" : "Tags"} ${tags.join(", ")}`);
  }
  return { draft, taken };
}

/** "und" before the last phrase: `a, b und c`. */
function joinGerman(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}

/** The one sentence that says what was taken over – and what was left out. */
export function carrySentence(c: Carry): string {
  return `Vom letzten Trade übernommen: ${joinGerman(c.taken)} – ohne Preise, Ergebnis, Zeiten und Notizen.`;
}

export const DUPLICATE_LABEL = "Letzten Trade duplizieren";
/** The hint under the button before it is used. */
export const DUPLICATE_HINT = "Übernimmt Symbol, Richtung, Setup, Größe, Zeitrahmen und Tags – ohne Preise, Ergebnis, Zeiten und Notizen.";
