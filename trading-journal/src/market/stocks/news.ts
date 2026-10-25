/**
 * News sources of the news monitor (F68). A source turns tickers into headlines and says honestly how it went:
 * `load` answers one `StockResult` per ticker (`ok | stale | unavailable(reason)`), like every other call of the stock
 * contract. Yahoo Finance headlines are registered here; **further sources plug in with `registerNewsSource`** – the SEC 8-K
 * feed of another agent, later company IR pages. A source keeps its own function / env / rate limit; this file only
 * merges what they return and reports each source's state ("Quelle nicht erreichbar, Stand …", never a silent gap).
 *
 * ```ts
 * // src/market/stocks/newsSources.ts – the one place that imports the extra sources
 * registerNewsSource({ id: "sec-edgar", label: "SEC EDGAR (8-K)", load: async (symbols, opts) => … });
 * ```
 */
import { stockData } from "./client";
import type { NewsItem, StockResult, StockSourceId, UnavailableReason } from "./types";

export interface NewsLoadOptions {
  fresh?: boolean;
  signal?: AbortSignal;
}

export interface NewsSource {
  id: StockSourceId;
  /** how the monitor names it ("Yahoo Finance", "SEC EDGAR (8-K)") */
  label: string;
  load(symbols: readonly string[], opts: NewsLoadOptions): Promise<Record<string, StockResult<NewsItem[]>>>;
}

const registry = new Map<string, NewsSource>();

/** Adds (or replaces, by id) a source; returns the function that removes it again. */
export function registerNewsSource(source: NewsSource): () => void {
  registry.set(source.id, source);
  return () => {
    if (registry.get(source.id) === source) registry.delete(source.id);
  };
}

export const newsSources = (): NewsSource[] => [...registry.values()];

/** Yahoo Finance headlines – always there. */
export const YAHOO_NEWS_SOURCE: NewsSource = {
  id: "yahoo-rss",
  label: "Yahoo Finance",
  load: (symbols, opts) => stockData().news(symbols, opts),
};
registerNewsSource(YAHOO_NEWS_SOURCE);

export interface SourceStatus {
  id: StockSourceId;
  label: string;
  /** `ok` every ticker answered · `partial` some did not · `stale` only old data · `unavailable` nothing */
  status: "ok" | "partial" | "stale" | "unavailable";
  reason?: UnavailableReason;
  message?: string;
  /** newest headline time the source delivered, `null` = none */
  asOf: number | null;
  /** when the newest answer was received */
  receivedAt: number | null;
  okSymbols: number;
  failedSymbols: number;
}

export interface NewsBatch {
  items: NewsItem[];
  sources: SourceStatus[];
}

const max = (a: number | null, b: number | null): number | null => (a == null ? b : b == null ? a : Math.max(a, b));

export function summarize(source: NewsSource, results: Readonly<Record<string, StockResult<NewsItem[]>>>): SourceStatus {
  let ok = 0;
  let stale = 0;
  let failed = 0;
  let asOf: number | null = null;
  let receivedAt: number | null = null;
  let reason: UnavailableReason | undefined;
  let message: string | undefined;
  for (const r of Object.values(results)) {
    if (r.status === "unavailable") {
      failed++;
      reason ??= r.reason;
      message ??= r.message;
      continue;
    }
    if (r.status === "stale") {
      stale++;
      reason ??= r.reason;
      message ??= r.message;
    } else ok++;
    asOf = max(asOf, r.asOf);
    receivedAt = max(receivedAt, r.receivedAt);
  }
  const answered = ok + stale;
  const status: SourceStatus["status"] = answered === 0 ? "unavailable" : ok === 0 ? "stale" : failed + stale > 0 ? "partial" : "ok";
  return { id: source.id, label: source.label, status, ...(reason ? { reason } : {}), ...(message ? { message } : {}), asOf, receivedAt, okSymbols: answered, failedSymbols: failed };
}

/**
 * Asks every registered source (in parallel) for the headlines of `symbols`. A source that throws is reported as
 * unavailable – one broken source never hides the others.
 */
export async function loadNews(symbols: readonly string[], opts: NewsLoadOptions = {}, sources: readonly NewsSource[] = newsSources()): Promise<NewsBatch> {
  const items: NewsItem[] = [];
  const statuses = await Promise.all(
    sources.map(async (src): Promise<SourceStatus> => {
      let results: Record<string, StockResult<NewsItem[]>>;
      try {
        results = await src.load(symbols, opts);
      } catch {
        return { id: src.id, label: src.label, status: "unavailable", reason: "network", message: "Die Quelle konnte nicht abgefragt werden.", asOf: null, receivedAt: null, okSymbols: 0, failedSymbols: symbols.length };
      }
      for (const r of Object.values(results)) if (r.status !== "unavailable") items.push(...r.data);
      return summarize(src, results);
    }),
  );
  return { items, sources: statuses };
}
