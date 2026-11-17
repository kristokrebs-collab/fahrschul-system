/**
 * Which tickers of the Congress rows are on the trader's watchlist. A filing prints `BRK.B` or `BRK/B`, the watchlist stores
 * `BRK.B`, Yahoo writes `BRK-B`: all of them are the same key. Pure.
 */

/** A ticker as one comparable key (upper case, class separator a dot), `""` for none. */
export function tickerKey(t: string | null | undefined): string {
  return (t ?? "").trim().toUpperCase().replace(/[-/]/g, ".");
}

/** The keys of the watchlist's stocks (`settings.watchlist` items; crypto pairs are ignored). */
export function watchSet(items: readonly { kind?: string; symbol: string }[]): Set<string> {
  const out = new Set<string>();
  for (const i of items) if (i.kind === undefined || i.kind === "stock") out.add(tickerKey(i.symbol));
  out.delete("");
  return out;
}

export const isWatched = (ticker: string | null | undefined, watch: ReadonlySet<string>): boolean => {
  const k = tickerKey(ticker);
  return k !== "" && watch.has(k);
};
