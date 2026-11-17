/**
 * Aktien-Kerzen für den Handelsplan – dieselbe Form wie die Krypto-Kerzen (`PlanCandles`, der `Candle`-Typ der Marktschicht), aus
 * dem Aktien-Datenvertrag (`@/market/stocks`: ok | stale | unavailable mit Grund, Quelle und Stand). Der Rechenkern merkt keinen
 * Unterschied; was die Quelle ehrlich anders macht, steht hier:
 *
 *  - Yahoo Finance ist inoffiziell und kann verzögert sein. Eine Kerze zählt erst als geschlossen, wenn die Uhr ihr Ende
 *    überschritten hat UND die Quelle aufgeholt hat (eine spätere Kerze liegt vor, oder der letzte Handel liegt nach ihrem Ende,
 *    oder eine Minute ist vergangen) – die Regel des Skills trader-entry ("it waits a minute at most").
 *  - 5- und 15-Minuten-Kerzen reichen bei Yahoo nur wenige Wochen zurück (der Vertrag erlaubt höchstens einen Monat). Ein älterer
 *    Tag wird nicht abgefragt, sondern mit dem Grund abgelehnt.
 *  - 30-Minuten-Kerzen gibt es bei Yahoo nicht: sie werden aus je zwei geschlossenen 15-Minuten-Kerzen gebaut; ein halber Block ist
 *    nie "geschlossen".
 *  - Fällt die Quelle aus, steht der Grund da. Ein früher gespeicherter Stand wird als solcher gekennzeichnet (nicht aktuell). Es
 *    wird nie ein Wert erfunden.
 * Reguläre Handelszeit nur (der Server wirft Vor- und Nachhandel weg).
 */
import { dayKeyLabel } from "@/domain/plan/time";
import { stockData } from "@/market/stocks/client";
import { nyParts } from "@/market/stocks/session";
import { isStockSymbol, SOURCE_NAME, STOCK_INTERVAL_MS, type StockCandle, type StockDataContract, type StockInterval } from "@/market/stocks/types";
import type { Candle } from "../types";
import type { LoadRequest, PlanCandles, PlanInterval } from "./candles";
import { PLAN_INTERVAL_MS } from "./candles";

export const STOCK_SOURCE_LABEL = SOURCE_NAME.yahoo ?? "Yahoo Finance (inoffiziell)";

/** What the source says about itself – shown among the assumptions of step 1. */
export const STOCK_NOTES: readonly string[] = [
  "Die Kerzen kommen von Yahoo Finance über einen Server der App. Die Quelle ist inoffiziell und ohne Garantie, sie kann ohne Vorwarnung sperren, und ihre Kurse können verzögert sein. Die App kennt die Verzögerung nicht – sie zeigt, wann die neueste Kerze schloss und wann abgerufen wurde.",
  "Grenze der Quelle: 5- und 15-Minuten-Kerzen gibt es nur für die letzten rund vier Wochen (die App fragt höchstens einen Monat ab). Ein älterer Tag lässt sich nicht nachrechnen.",
];

/** A candle the clock has closed counts only when the source has caught up – or this long after its end. */
export const CATCH_UP_MS = 60_000;

/** The source interval a plan interval is read from, and how many of them make one plan candle. */
const BASE: Readonly<Record<PlanInterval, { fetch: StockInterval; per: number }>> = {
  "5m": { fetch: "5m", per: 1 },
  "15m": { fetch: "15m", per: 1 },
  "30m": { fetch: "15m", per: 2 },
  "1h": { fetch: "1h", per: 1 },
};

const DAY_MS = 86_400_000;
const dayNumber = (key: string): number => Date.parse(`${key}T00:00:00Z`) / DAY_MS;

/**
 * Which range word asks for the session of `sessionDate` (a New York day) when today is `today`. `5d` covers every day up to four
 * calendar days back (five trading days span at least five), `1mo` every day up to 28 days back – further back the contract has no
 * intraday range, and the answer is a reason, not a request.
 */
export function rangeFor(interval: StockInterval, sessionDate: string, today: string): { range: string } | { error: string } {
  const days = Math.round(dayNumber(today) - dayNumber(sessionDate));
  if (days <= 0) return { range: "1d" };
  if (days <= 4) return { range: "5d" };
  if (days <= 28) return { range: "1mo" };
  const name = interval === "5m" ? "5-Minuten" : "15-Minuten";
  return { error: `Yahoo Finance liefert ${name}-Kerzen nur für die letzten rund vier Wochen; der ${dayKeyLabel(sessionDate)} liegt ${days} Tage zurück. Wähle einen jüngeren Tag.` };
}

const clean = (x: number): number => Math.round(x * 10_000) / 10_000;

interface BuildOpts {
  /** when the source fetched the data (ms) */
  fetchMs: number;
  /** the last trade the source reports (ms), `null` = it does not say */
  marketTime: number | null;
  stockIvMs: number;
  planIvMs: number;
  /** open times wanted, both inclusive */
  from: number;
  to: number;
}

/** Source candles → plan candles: prices cleaned of float noise, `closed` only when the source has caught up, aggregated if needed. */
export function buildCandles(source: readonly StockCandle[], o: BuildOpts): Candle[] {
  const sorted = [...source].sort((a, b) => a.time - b.time);
  const last = sorted.length - 1;
  const base = sorted.map((c, i) => {
    const end = c.time + o.stockIvMs;
    const caughtUp = i < last || (o.marketTime != null && o.marketTime >= end) || o.fetchMs - end >= CATCH_UP_MS;
    return { time: c.time, open: clean(c.open), high: clean(c.high), low: clean(c.low), close: clean(c.close), volume: c.volume, closed: c.closed && caughtUp };
  });
  const per = Math.round(o.planIvMs / o.stockIvMs);
  const out: Candle[] = [];
  if (per <= 1) {
    for (const c of base) out.push({ ...c, closeTime: c.time + o.planIvMs - 1 });
  } else {
    const buckets = new Map<number, typeof base>();
    for (const c of base) {
      const start = Math.floor(c.time / o.planIvMs) * o.planIvMs;
      const b = buckets.get(start);
      if (b) b.push(c);
      else buckets.set(start, [c]);
    }
    for (const [start, members] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
      const first = members[0]!;
      const lastM = members[members.length - 1]!;
      out.push({
        time: start,
        open: first.open,
        high: Math.max(...members.map((m) => m.high)),
        low: Math.min(...members.map((m) => m.low)),
        close: lastM.close,
        volume: members.reduce((s, m) => s + m.volume, 0),
        // a bucket is closed only when all its members are there and closed – a missing half is no closed candle
        closed: members.length === per && members.every((m) => m.closed),
        closeTime: start + o.planIvMs - 1,
      });
    }
  }
  return out.filter((c) => c.time >= o.from && c.time <= o.to);
}

export interface StockPlanDeps {
  data: () => StockDataContract;
  now: () => number;
}

const defaultDeps = (): StockPlanDeps => ({ data: () => stockData(), now: () => Date.now() });

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });

/** The candles of a window for the Handelsplan: from the stock data contract, with its honest failures. */
export async function loadStockPlanCandles(req: LoadRequest, deps: StockPlanDeps = defaultDeps()): Promise<PlanCandles> {
  const now = deps.now();
  const none = (patch: Partial<PlanCandles>): PlanCandles => ({ candles: [], source: "yahoo", fetchedAt: null, fromCache: true, error: null, sourceLabel: STOCK_SOURCE_LABEL, notes: STOCK_NOTES, marketTime: null, ...patch });
  if (!isStockSymbol(req.symbol)) return none({ error: `„${req.symbol}“ ist kein US-Aktienkürzel (ein bis fünf Buchstaben, zum Beispiel AAPL oder BRK.B).` });
  const map = BASE[req.interval];
  if (req.to < req.from) return none({});
  const planIv = PLAN_INTERVAL_MS[req.interval];
  const r = rangeFor(map.fetch, nyParts(req.to).date, nyParts(now).date);
  if ("error" in r) return none({ error: r.error });
  if (req.signal?.aborted) throw abortError();
  const res = await deps.data().bars(req.symbol, map.fetch, { range: r.range, ...(req.fresh ? { fresh: true } : {}), ...(req.signal ? { signal: req.signal } : {}) });
  if (req.signal?.aborted || (res.status === "unavailable" && res.reason === "aborted")) throw abortError();
  if (res.status === "unavailable") return none({ error: `${STOCK_SOURCE_LABEL}: ${res.message}` });

  const meta = res.data.meta;
  const fetchMs = res.fetchedAt ?? res.receivedAt;
  const candles = buildCandles(res.data.candles, { fetchMs, marketTime: meta.marketTime, stockIvMs: STOCK_INTERVAL_MS[map.fetch], planIvMs: planIv, from: req.from, to: req.to });
  const notes = [...STOCK_NOTES, ...(meta.currency && meta.currency !== "USD" ? [`Yahoo meldet die Währung ${meta.currency}; die App rechnet in USD und rechnet nicht um.`] : [])];
  return {
    candles,
    source: "yahoo",
    fetchedAt: fetchMs,
    fromCache: res.status === "stale",
    error: res.status === "stale" ? `${STOCK_SOURCE_LABEL}: ${res.message}` : null,
    sourceLabel: STOCK_SOURCE_LABEL,
    notes,
    marketTime: meta.marketTime,
  };
}
