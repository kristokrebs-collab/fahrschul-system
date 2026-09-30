/**
 * Mapping of feeds onto the app's legacy fields (Plan 4.8). Pure functions over `Stamped` values and the
 * health snapshot; every derived number carries its provenance (`source`, `comparable`, `asOf`).
 */
import type { Candle, FeedHealth, FeedId, FeedValue, MarkPrice, ProviderHealth, RatioPoint, Source, Stamped, TakerPoint } from "./types";
import { lastClosed4h, weeklyClose, weeklyRsi, currentBar } from "./indicators";
import { hhmm, hhmmss, n0, n4 } from "./format";
import { STRINGS, fallbackBadge } from "./statusLabel";

export type TopTraderBase = "accounts" | "positions";
export type LegacyMarketStatus = "connecting" | "live" | "error" | "unavailable";

export type FeedSnapshot = { [F in FeedId]?: Stamped<FeedValue[F]> };

export interface Provenance {
  source: Source;
  comparable: boolean;
  asOf: number;
  receivedAt: number;
}

export interface MarketView {
  /** legacy card status, driven only by the price feed */
  status: LegacyMarketStatus;
  message?: string;
  /** last traded price (aggTrade → bookTop mid → ticker24h.lastPrice), never the mark price */
  price: number | null;
  priceSource: Provenance | null;
  /** header badge when a fallback serves the price, e.g. "Ersatzquelle Bybit" */
  sourceBadge?: string;
  /** 24 h change in % */
  change: number | null;
  close4h: number | null;
  close4hAt: number | null;
  closeW: number | null;
  closeWAt: number | null;
  rsiW: number | null;
  /** the running 4h close (for the "würde … auslösen" preview) */
  live4hClose: number | null;
  live4hCloseAt: number | null;
  /** receivedAt of the price feed (LivePill age) */
  updatedAt: number | null;
  nextTickerRefreshAt: number | null;
  mark: MarkPrice | null;
  fundingLine: FundingLine | null;
  openInterest: number | null;
  /** 24 h change of open interest in % (from openInterestHist) */
  openInterestChange24h: number | null;
  taker: TakerView | null;
  bid: number | null;
  ask: number | null;
}

export interface FundingLine {
  markText: string;
  fundingText: string;
  countdownText: string;
  /** `Mark {n0} · Funding {±0,0100 %} · nächstes Funding in {hh:mm:ss}` */
  text: string;
  fundingRate: number;
  nextFundingTime: number;
}

export interface TakerView {
  buySellRatio: number;
  /** buy share minus sell share of taker volume in percentage points (−100…100) */
  takerDelta: number;
  time: number;
}

export interface TopTraderView {
  /** `Top Trader Long %`: accounts or positions per `base` */
  longPct: number | null;
  /** second value: the other base */
  longPctPositions: number | null;
  longPctAccounts: number | null;
  globalLongPct: number | null;
  /** top-position long % − global long % (percentage points), replacement for Whale-vs-Retail */
  delta: number | null;
  /** consecutive trailing points with delta > 0 */
  deltaCandles: number;
  deltaSeries: DeltaPoint[];
  /** last 20 points of the Long % series (for the sparkline toggle) */
  sparkline: number[];
  base: TopTraderBase;
  /** provenance of the Long % series */
  provenance: Provenance | null;
  /** true when top-trader feeds are unavailable on the current source (Bybit) → `Nur mit Binance` */
  onlyBinance: boolean;
  /** period detail (bad_period / Bybit period mapping) */
  detail?: string;
  /** whether a virtual live reading may be built (top feed AND delta series live/stale) */
  liveReadingOk: boolean;
  /** health state of the Long % feed */
  state: FeedHealth["state"];
  asOf: number | null;
  taker: TakerView | null;
}

export interface DeltaPoint {
  time: number;
  delta: number;
}

const MINUS = "−";

function prov(s: Stamped<unknown>): Provenance {
  return { source: s.source, comparable: s.comparable, asOf: s.asOf, receivedAt: s.receivedAt };
}

/** `longPct` of the last point (already 0–100). */
export function lastLongPct(series: readonly RatioPoint[] | undefined): number | null {
  const last = series?.[series.length - 1];
  return last ? last.longPct : null;
}

export function topTraderLongPct(topAccounts: readonly RatioPoint[] | undefined, topPositions: readonly RatioPoint[] | undefined, base: TopTraderBase): number | null {
  return base === "positions" ? lastLongPct(topPositions) : lastLongPct(topAccounts);
}

/** Joins two ratio series by `time`; `delta = topPositionLongPct − globalLongPct` in percentage points. */
export function deltaSeries(topPositions: readonly RatioPoint[] | undefined, global: readonly RatioPoint[] | undefined): DeltaPoint[] {
  if (!topPositions || !global) return [];
  const g = new Map<number, number>();
  for (const p of global) g.set(p.time, p.longPct);
  const out: DeltaPoint[] = [];
  for (const p of topPositions) {
    const gl = g.get(p.time);
    if (gl !== undefined) out.push({ time: p.time, delta: p.longPct - gl });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Count of trailing points with `delta > 0` (from the end, stop at the first ≤ 0) — identical to the bundle's `oK`. */
export function deltaCandles(deltas: readonly number[]): number {
  let n = 0;
  for (let i = deltas.length - 1; i >= 0; i--) {
    if ((deltas[i] as number) > 0) n++;
    else break;
  }
  return n;
}

/** Taker buy share − sell share in percentage points: `(buy − sell) / (buy + sell) · 100`. */
export function takerDelta(p: TakerPoint | undefined): number | null {
  if (!p) return null;
  const total = p.buyVol + p.sellVol;
  if (!(total > 0)) return null;
  return ((p.buyVol - p.sellVol) / total) * 100;
}

export function takerView(series: readonly TakerPoint[] | undefined): TakerView | null {
  const last = series?.[series.length - 1];
  const d = takerDelta(last);
  if (!last || d === null) return null;
  return { buySellRatio: last.buySellRatio, takerDelta: d, time: last.time };
}

/** `V.pct` with 4 decimals and U+2212: `+0,0100 %`. */
export function fundingPct(rate: number): string {
  const pct = rate * 100;
  const abs = n4(Math.abs(pct));
  return `${pct < 0 ? MINUS : "+"}${abs} %`;
}

/** `Mark {n0} · Funding {±0,0100 %} · nächstes Funding in {hh:mm:ss}` */
export function fundingLine(mark: MarkPrice | undefined, now: number): FundingLine | null {
  if (!mark) return null;
  const markText = `Mark ${n0(mark.markPrice)}`;
  const fundingText = `Funding ${fundingPct(mark.fundingRate)}`;
  const countdownText = `nächstes Funding in ${hhmmss(mark.nextFundingTime - now)}`;
  return { markText, fundingText, countdownText, text: `${markText} · ${fundingText} · ${countdownText}`, fundingRate: mark.fundingRate, nextFundingTime: mark.nextFundingTime };
}

/** Last price: `aggTrade.price` → bookTop mid → `ticker24h.lastPrice` (never the mark price). */
export function lastPrice(feeds: FeedSnapshot): { price: number; provenance: Provenance } | null {
  const a = feeds.aggTrade;
  if (a && Number.isFinite(a.data.price)) return { price: a.data.price, provenance: prov(a) };
  const b = feeds.bookTop;
  if (b && Number.isFinite(b.data.bid) && Number.isFinite(b.data.ask)) return { price: (b.data.bid + b.data.ask) / 2, provenance: prov(b) };
  const t = feeds.ticker24h;
  if (t && Number.isFinite(t.data.lastPrice)) return { price: t.data.lastPrice, provenance: prov(t) };
  return null;
}

/** 24 h OI change in % from the history series (point ≥ 24 h before the last one). */
export function openInterestChange24h(hist: readonly { time: number; openInterest: number }[] | undefined): number | null {
  const last = hist?.[hist.length - 1];
  if (!hist || !last) return null;
  const target = last.time - 24 * 3_600_000;
  let ref: { time: number; openInterest: number } | undefined;
  for (const p of hist) {
    if (p.time <= target) ref = p;
    else break;
  }
  if (!ref || !(ref.openInterest > 0)) return null;
  return ((last.openInterest - ref.openInterest) / ref.openInterest) * 100;
}

/** Legacy card status from the price feeds only (Plan 4.4 "Mapping auf das Bestands-Enum"). */
export function legacyStatus(health: ProviderHealth, price: { provenance: Provenance } | null, now: number, retryInSec?: number): { status: LegacyMarketStatus; message?: string; sourceBadge?: string } {
  const agg = health.feeds.aggTrade;
  const mark = health.feeds.markPrice;
  const feed = agg.lastDataAt !== undefined || agg.state !== "connecting" ? agg : mark;
  if (feed.reason === "bad_symbol") return { status: "error", message: STRINGS.noPrice };
  if (!health.online || feed.state === "offline") {
    const at = price?.provenance.asOf ?? feed.lastDataAt;
    return { status: "error", message: at !== undefined ? `${STRINGS.offline} · ${STRINGS.standPrefix} ${hhmm(at)}` : STRINGS.offline };
  }
  if (!price) {
    if (feed.state === "connecting") return { status: "connecting", message: retryInSec !== undefined ? STRINGS.retrying(retryInSec) : undefined };
    return { status: "error", message: feed.consecutiveFailures > 0 && retryInSec !== undefined ? STRINGS.retrying(retryInSec) : STRINGS.noPrice };
  }
  const age = now - price.provenance.asOf;
  if (age > 120_000) return { status: "error", message: `${STRINGS.lastPrefix} ${hhmm(price.provenance.asOf)} · ${STRINGS.staleSuffix}` };
  if (feed.state === "connecting" && price.provenance.receivedAt < (health.ws.connectedAt ?? 0)) return { status: "connecting" };
  const badge = price.provenance.source !== "binance" && price.provenance.source !== "proxy" ? fallbackBadge(price.provenance.source) : undefined;
  return { status: "live", sourceBadge: badge, message: badge ? STRINGS.fallbackDetail : undefined };
}

export interface DeriveOptions {
  now?: number;
  /** `rsiW` from the TradingView MCP adapter overrides the local calculation when present */
  rsiWOverride?: number | null;
  retryInSec?: number;
}

/** Everything the legacy market panel needs, from the feed snapshot and the health. */
export function deriveMarket(feeds: FeedSnapshot, health: ProviderHealth, opts: DeriveOptions = {}): MarketView {
  const now = opts.now ?? Date.now();
  const lp = lastPrice(feeds);
  const legacy = legacyStatus(health, lp, now, opts.retryInSec);
  const k4 = feeds.kline_4h?.data ?? [];
  const kw = feeds.kline_1w?.data ?? [];
  const c4 = lastClosed4h(k4, now);
  const cw = weeklyClose(kw, now);
  const running4h = currentBar(k4, 14_400, now);
  const rsi = opts.rsiWOverride ?? (kw.length ? weeklyRsi(kw) : null);
  const mark = feeds.markPrice?.data ?? null;
  const oi = feeds.openInterest?.data.openInterest ?? null;
  const book = feeds.bookTop?.data;
  return {
    status: legacy.status,
    message: legacy.message,
    sourceBadge: legacy.sourceBadge,
    price: lp ? Math.round(lp.price) : null,
    priceSource: lp?.provenance ?? null,
    change: feeds.ticker24h?.data.priceChangePercent ?? null,
    close4h: c4?.c ?? null,
    close4hAt: c4?.t ?? null,
    closeW: cw?.c ?? null,
    closeWAt: cw?.t ?? null,
    rsiW: rsi,
    live4hClose: running4h?.close ?? null,
    live4hCloseAt: running4h ? running4h.time + 14_400_000 : null,
    updatedAt: lp?.provenance.receivedAt ?? null,
    nextTickerRefreshAt: health.feeds.ticker24h.nextRefreshAt ?? null,
    mark,
    fundingLine: fundingLine(mark ?? undefined, now),
    openInterest: oi,
    openInterestChange24h: openInterestChange24h(feeds.openInterestHist?.data),
    taker: takerView(feeds.takerRatio?.data),
    bid: book?.bid ?? null,
    ask: book?.ask ?? null,
  };
}

/** Top-trader card (Plan 4.8). `base` comes from `tj2-ui.topTraderBase` (default `accounts`). */
export function deriveTopTrader(feeds: FeedSnapshot, health: ProviderHealth, base: TopTraderBase = "accounts"): TopTraderView {
  const acc = feeds.topAccountRatio;
  const pos = feeds.topPositionRatio;
  const glob = feeds.globalAccountRatio;
  const primaryFeed: FeedId = base === "positions" ? "topPositionRatio" : "topAccountRatio";
  const primary = base === "positions" ? pos : acc;
  const h = health.feeds[primaryFeed];
  const onlyBinance = h.reason === "unsupported" || health.feeds.topPositionRatio.reason === "unsupported";
  const ds = deltaSeries(pos?.data, glob?.data);
  const deltas = ds.map((d) => d.delta);
  const last = ds[ds.length - 1];
  const dsOk = ["live", "stale"].includes(health.feeds.topPositionRatio.state) && ["live", "stale"].includes(health.feeds.globalAccountRatio.state);
  const liveOk = !onlyBinance && (h.state === "live" || h.state === "stale") && dsOk && primary !== undefined;
  const series = primary?.data ?? [];
  return {
    longPct: topTraderLongPct(acc?.data, pos?.data, base),
    longPctPositions: lastLongPct(pos?.data),
    longPctAccounts: lastLongPct(acc?.data),
    globalLongPct: lastLongPct(glob?.data),
    delta: last ? last.delta : null,
    deltaCandles: deltaCandles(deltas),
    deltaSeries: ds,
    sparkline: series.slice(-20).map((p) => p.longPct),
    base,
    provenance: primary ? prov(primary) : null,
    onlyBinance,
    detail: h.detail ?? health.feeds.globalAccountRatio.detail,
    liveReadingOk: liveOk,
    state: h.state,
    asOf: primary?.asOf ?? null,
    taker: takerView(feeds.takerRatio?.data),
  };
}

export interface VirtualReading {
  id: string;
  at: string;
  longPct: number;
  delta: number;
  deltaCandles: number;
  structure: boolean;
  rsi: boolean;
  note: string;
}

/** Virtual live reading (Plan 4.8) — `structure`/`rsi` stay the manual ticks of the last reading. Null in the Bybit fallback. */
export function virtualReading(tt: TopTraderView, last: { id?: string; structure?: boolean; rsi?: boolean } | undefined): VirtualReading | null {
  if (!tt.liveReadingOk || tt.longPct === null || tt.asOf === null) return null;
  return {
    id: last?.id ?? "",
    at: new Date(tt.asOf).toISOString(),
    longPct: tt.longPct,
    delta: tt.delta ?? 0,
    deltaCandles: tt.deltaCandles,
    structure: !!last?.structure,
    rsi: !!last?.rsi,
    note: "Live von Binance",
  };
}

/** Trigger distances (Plan 4.9): `distToLong = (longTrigger − price)/price`, `distToShort = (price − shortTrigger)/price`. */
export function triggerDistances(price: number | null, levels: { longTrigger: number; shortTrigger: number }): { toLong: number; toShort: number; longInReach: boolean; shortInReach: boolean } | null {
  if (price === null || !(price > 0)) return null;
  const toLong = (levels.longTrigger - price) / price;
  const toShort = (price - levels.shortTrigger) / price;
  return { toLong, toShort, longInReach: Math.abs(toLong) < 0.003, shortInReach: Math.abs(toShort) < 0.003 };
}

export function candlesClose(bars: readonly Candle[]): number[] {
  return bars.map((b) => b.close);
}
