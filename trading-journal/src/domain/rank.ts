/**
 * Setup ranking – bundle `rT` (sort) and `nT` (sort keys) for the "Entscheidungsgrundlagen" card and setups tab.
 */
import type { AccountId, Setup } from "./types";
import type { SetupStats } from "./account";

export type RankKey = "winRate" | "net" | "n" | "avgR";

/** Bundle `nT`: segmented control options. */
export const RANK_KEYS: readonly { v: RankKey; label: string }[] = [
  { v: "winRate", label: "Win-Rate" },
  { v: "net", label: "P&L" },
  { v: "n", label: "Trades" },
  { v: "avgR", label: "Ø R" },
];
export const DEFAULT_RANK_KEY: RankKey = "winRate";

export type Rankable = { n: number } & Partial<Record<RankKey, number | null>>;

/** Bundle `rT`: descending by key (null → −∞), ties → more trades first. Stable. */
export function rankSetups<T extends Rankable>(list: readonly T[], key: RankKey): T[] {
  const val = (x: T): number => {
    const v = x[key];
    return v == null ? -Infinity : v;
  };
  return [...list].sort((a, b) => val(b) - val(a) || b.n - a.n);
}

/** Setups tab visibility: all, or account matches, or "both". */
export function setupVisibleFor(setup: Pick<Setup, "account">, acc: "all" | AccountId): boolean {
  return acc === "all" || setup.account === acc || setup.account === "both";
}

/** Split ranked setup stats into the table (n > 0) and the chip row (n === 0). */
export function splitRanked<T extends Rankable>(ranked: readonly T[]): { used: T[]; unused: T[] } {
  return { used: ranked.filter((x) => x.n > 0), unused: ranked.filter((x) => !x.n) };
}

/** Convenience: ranked stats with `id` mirrored from `setup.id` (as the bundle does before sorting). */
export function rankSetupStats(stats: readonly SetupStats[], key: RankKey = DEFAULT_RANK_KEY): (SetupStats & { id: string })[] {
  return rankSetups(
    stats.map((c) => ({ ...c, id: c.setup.id })),
    key,
  );
}

export const RANKING_EMPTY_TEXT =
  "Noch keine Trades zugeordnet. Sobald du Trades mit Grundlage einträgst, erscheint hier das Ranking.";

export const rT = rankSetups;
export const nT = RANK_KEYS;
