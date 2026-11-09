/**
 * The two network-backed lists of the page – watchlist quotes and the headlines – as small stores (memory only), so a
 * request outlives a re-render, a late answer of an older request never overwrites a newer one, and the cards just read.
 * Everything they hold has its stamp (`source`, `asOf`, `receivedAt`); a failure keeps its reason.
 */
import { create } from "zustand";
import type { WatchItem } from "@/domain/watchlist";
import { stockData } from "@/market/stocks/client";
import { loadNews, type NewsBatch } from "@/market/stocks/news";
import { REASON_TEXT } from "@/market/stocks/result";
import { cryptoClient } from "@/market/stocks/scanSources";
import type { Stamp, UnavailableReason } from "@/market/stocks/types";

export interface Quote {
  price: number;
  changePct: number | null;
  name: string | null;
  currency: string | null;
  /** the refresh failed and this is the last stored quote: why */
  stale?: string;
}

export interface QuoteState {
  /** the list this state belongs to (ids joined) */
  key: string;
  quotes: Record<string, Quote>;
  failed: { reason: UnavailableReason; message: string; n: number } | null;
  stamp: Stamp | null;
  loading: boolean;
  load(items: readonly WatchItem[], fresh: boolean): Promise<void>;
}

let quoteSeq = 0;

export const useQuotes = create<QuoteState>((set) => ({
  key: "",
  quotes: {},
  failed: null,
  stamp: null,
  loading: false,
  load: async (items, fresh) => {
    const my = ++quoteSeq;
    const key = items.map((i) => i.id).join("|");
    const stocks = items.filter((i) => i.kind === "stock").map((i) => i.symbol);
    const coins = items.filter((i) => i.kind === "crypto").map((i) => i.symbol);
    if (!stocks.length && !coins.length) {
      set({ key, quotes: {}, failed: null, stamp: null, loading: false });
      return;
    }
    set({ key, loading: true });
    const quotes: Record<string, Quote> = {};
    let failed: QuoteState["failed"] = null;
    let stamp: Stamp | null = null;
    const fail = (reason: UnavailableReason, message: string): void => {
      failed = { reason, message, n: (failed?.n ?? 0) + 1 };
    };
    if (stocks.length) {
      const res = await stockData().quotes(stocks, { fresh });
      for (const s of stocks) {
        const r = res[s];
        if (!r) continue;
        if (r.status === "unavailable") fail(r.reason, r.message);
        else {
          quotes[`stock:${s}`] = { price: r.data.price, changePct: r.data.changePct, name: r.data.name, currency: r.data.currency, ...(r.status === "stale" ? { stale: r.message } : {}) };
          if (!stamp || r.receivedAt > stamp.receivedAt) stamp = { source: r.source, asOf: r.asOf, receivedAt: r.receivedAt, ...(r.fetchedAt != null ? { fetchedAt: r.fetchedAt } : {}) };
        }
      }
    }
    if (coins.length) {
      const r = await cryptoClient().quotes(coins);
      if (!r.ok) fail(r.reason, r.message);
      else {
        stamp ??= r.stamp;
        for (const c of coins) {
          const q = r.data[c];
          if (q) quotes[`crypto:${c}`] = { price: q.price, changePct: q.changePct, name: null, currency: "USDT" };
          else fail("bad-symbol", REASON_TEXT["bad-symbol"]);
        }
      }
    }
    if (my !== quoteSeq) return;
    set({ key, quotes, failed, stamp, loading: false });
  },
}));

export interface NewsState {
  key: string;
  batch: NewsBatch | null;
  loading: boolean;
  /** when the list was assembled (ms) */
  at: number | null;
  load(symbols: readonly string[], fresh: boolean): Promise<void>;
}

let newsSeq = 0;

export const useNewsFeed = create<NewsState>((set) => ({
  key: "",
  batch: null,
  loading: false,
  at: null,
  load: async (symbols, fresh) => {
    const my = ++newsSeq;
    const key = symbols.join(",");
    if (!symbols.length) {
      set({ key, batch: null, loading: false, at: null });
      return;
    }
    set({ key, loading: true });
    const batch = await loadNews(symbols, { fresh });
    if (my !== newsSeq) return;
    set({ key, batch, loading: false, at: Date.now() });
  },
}));

/** Tests: forget what the feeds hold. */
export function resetFeedsForTests(): void {
  quoteSeq++;
  newsSeq++;
  useQuotes.setState({ key: "", quotes: {}, failed: null, stamp: null, loading: false });
  useNewsFeed.setState({ key: "", batch: null, loading: false, at: null });
}
