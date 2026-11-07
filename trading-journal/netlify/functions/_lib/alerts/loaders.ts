/**
 * The real loaders of a run (network): the industry file (the same public Ken French download the Branchen-Trend page uses, cached per
 * instance), Binance's public top-trader ratio (futures data, no key, GET only; on 451 / 403 / 429 / network failure through the app's own
 * proxy, like the e-mail alarm) and the candles of the key levels (the e-mail alarm's market client). One run asks each thing at most once.
 */
import { gunzipSync } from "node:zlib";
import { keyLevelReading } from "../../../../src/domain/alerts/sources/keylevel";
import type { RatioPoint } from "../../../../src/domain/alerts/sources/whale";
import type { AlertReading } from "../../../../src/domain/alerts/types";
import type { IndustryDataset } from "../../../../src/domain/industryTrend/ampel";
import { serverWatchSet } from "../../../../src/domain/keylevels/serverAlerts";
import { KEY_TF_SOURCE } from "../../../../src/domain/keylevels/timeframes";
import { evaluateWatch } from "../../../../src/domain/keylevels/watch";
import { barsOfTf } from "../../../../src/market/keylevels/bars";
import { BINANCE_REST, mapRatio, ratioSchema } from "../../../../src/market/sources/binance";
import { fetchJson, RestError, type FetchLike } from "../../../../src/market/sources/http";
import type { Candle } from "../../../../src/market/types";
import { barsNeeded, createMarket, type Market } from "../alertWatch/market";
import type { IndustryDailyPayload } from "../../../../src/market/industry/wire";
import { loadIndustries } from "../industry/load";
import type { RunLoaders } from "./sources";

export interface LoaderOptions {
  fetch?: FetchLike;
  now: () => number;
  /** `https://site/api/binance`, or `null` */
  proxyBase: string | null;
  /** most candle requests of one run for key levels */
  maxRequests?: number;
}

/**
 * The industry answer (`IndustryDailyPayload`: gzip, base64, dates then returns, industry-major) as the dataset the signal reads. Every length
 * and the order of the days is checked against what the answer promised – a block that does not add up is refused (`null`), never half-used.
 * (The browser's `decodeIndustry` does the same with `DecompressionStream`; the server has Node's zlib.)
 */
export function decodeIndustryPayload(p: IndustryDailyPayload): IndustryDataset | null {
  try {
    const raw = gunzipSync(Buffer.from(p.data, "base64"));
    const T = p.days;
    const N = p.names.length;
    if (raw.length !== p.bytes || raw.length !== T * 4 + N * T * 2) return null;
    const dates = new Int32Array(T);
    for (let t = 0; t < T; t++) dates[t] = raw.readInt32LE(t * 4);
    const returns = new Int16Array(N * T);
    for (let k = 0; k < returns.length; k++) returns[k] = raw.readInt16LE(T * 4 + k * 2);
    if (dates[0] !== p.firstDay || dates[T - 1] !== p.lastDay) return null;
    for (let t = 1; t < T; t++) if (dates[t]! <= dates[t - 1]!) return null;
    return { names: p.names.slice(), dates, returns };
  } catch {
    return null;
  }
}

export function defaultLoaders(o: LoaderOptions): RunLoaders & { requests(): number } {
  let industry: Promise<IndustryDataset | null> | null = null;
  const ratios = new Map<string, Promise<RatioPoint[] | null>>();
  let market: Market | null = null;
  let prices: Promise<Map<string, number> | null> | null = null;
  const bars = new Map<string, Promise<Candle[] | null>>();
  let requests = 0;
  const cap = o.maxRequests ?? 40;
  const getMarket = (): Market => (market ??= createMarket({ fetch: o.fetch, now: o.now, proxyBase: o.proxyBase }));

  const bases: string[] = [BINANCE_REST, ...(o.proxyBase ? [o.proxyBase.replace(/\/+$/, "")] : [])];

  async function ratio(symbol: string): Promise<RatioPoint[] | null> {
    for (const base of bases) {
      try {
        requests += 1;
        const rows = await fetchJson(`${base}/futures/data/topLongShortPositionRatio?symbol=${encodeURIComponent(symbol)}&period=5m&limit=30`, ratioSchema, { fetch: o.fetch, timeoutMs: 7_000 });
        return mapRatio(rows).map((p) => ({ time: p.time, longPct: p.longPct }));
      } catch (e) {
        if (e instanceof RestError && e.kind === "bad_symbol") return null;
      }
    }
    return null;
  }

  return {
    requests: () => requests,
    industry() {
      industry ??= (async () => {
        try {
          return decodeIndustryPayload(await loadIndustries());
        } catch {
          return null;
        }
      })();
      return industry;
    },
    ratio(symbol) {
      let p = ratios.get(symbol);
      if (!p) ratios.set(symbol, (p = ratio(symbol)));
      return p;
    },
    async keyLevels(_userId, raw, now): Promise<AlertReading[]> {
      const set = serverWatchSet(raw);
      if (!set.levels.length) return [];
      const m = getMarket();
      prices ??= m.prices().then(
        (p) => p,
        () => null,
      );
      const known = await prices;
      if (!known) return [];
      const out: AlertReading[] = [];
      const memo = new Map<string, Candle[]>();
      for (const l of set.levels) {
        if (!known.has(l.symbol)) continue; // a symbol Binance does not know is not evaluated
        const feed = KEY_TF_SOURCE[l.tf].feed;
        const key = `${l.symbol}|${feed}`;
        let p = bars.get(key);
        if (!p) {
          if (requests >= cap) continue;
          requests += 1;
          bars.set(
            key,
            (p = m.sourceBars(l.symbol, feed, barsNeeded(l.tf, l.since, now)).then(
              (b) => b,
              () => null,
            )),
          );
        }
        const src = await p;
        if (!src) continue;
        const k = `${l.symbol}|${l.tf}`;
        let tfBars = memo.get(k);
        if (!tfBars) memo.set(k, (tfBars = barsOfTf(l.tf, src)));
        const entry = evaluateWatch(l, tfBars, now, set.alerts);
        const r = keyLevelReading(l, entry.evaluation, set.alerts, now);
        if (r) out.push(r);
      }
      return out;
    },
  };
}
