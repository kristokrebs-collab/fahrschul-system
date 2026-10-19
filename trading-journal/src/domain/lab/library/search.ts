/** Search and filter of the strategy cards: every word must appear in the title, the idea, the origin or a parameter name. */
import { KIND_LABEL, STRATEGY_CARDS, type StrategyCard, type StrategyKind } from "./cards";

const fold = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

export function searchCards(query: string, kind: StrategyKind | "all" = "all", cards: readonly StrategyCard[] = STRATEGY_CARDS): StrategyCard[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return cards.filter((c) => {
    if (kind !== "all" && c.kind !== kind) return false;
    if (!words.length) return true;
    const hay = fold([c.title, c.sub, c.knownFrom, c.phase, KIND_LABEL[c.kind], ...c.params.map((p) => p.name), ...c.tfs].join(" "));
    return words.every((w) => hay.includes(w));
  });
}
