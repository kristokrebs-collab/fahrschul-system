/**
 * Mapping of feeds onto the app's legacy fields (Plan 4.8). Pure functions over `Stamped` values and the
 * health snapshot; every derived number carries its provenance (`source`, `comparable`, `asOf`).
 */
import type { Candle, FeedHealth, FeedId, FeedValue, MarkPrice, ProviderHealth, RatioPoint, Source, Stamped, StatusLabel, TakerPoint } from "./types";
import { lastClosed4h, weeklyClose, weeklyRsi, currentBar } from "./indicators";
import { hhmm, hhmmss, n0, n4 } from "./format";
import { SOFT_FAILURE_CAUSE, SOFT_FAILURE_TEXT, STRINGS, fallbackBadge } from "./statusLabel";
import { cadenceLabel } from "./period";
import { PRICE_PREFER_MS, PRICE_REST_FALLBACK_MS, PRICE_STALE_MS } from "./feeds";
import { wsDown } from "./health";
import { isFileProtocol } from "@/edition";

export type TopTraderBase = "accounts" | "positions";
export type LegacyMarketStatus = "connecting" | "live" | "error" | "unavailable";
/**
 * How the shown last price arrives: `stream` (the trade stream delivers → LivePill), `poll` (a REST poll — the socket
 * is down and the ticker stands in every 5 s, or another exchange serves the price → `Kurs per Abfrage · 5 s`),
 * `waiting` (the socket is down and the REST stand-in is failing → `Verbinde …`, the price shown is still < 2 min old;
 * or back from the background with an older price while the stand-in's first request is on its way),
 * `none` (no usable price: connecting, offline, bad symbol, or nothing delivered for > 2 min → `Kein Live-Kurs`).
 */
export type PriceMode = "stream" | "poll" | "waiting" | "none";

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
  /** additive: how the shown price arrives (see `PriceMode`) — the card shows the LivePill only for `stream` */
  priceMode: PriceMode;
  /** additive: the status pill of the card in every mode (`Live`, `Kurs per Abfrage · 5 s`, `Verbinde …`, `Kein Live-Kurs`, `Offline`) */
  pill: StatusLabel;
  /** last traded price: the freshest of aggTrade → bookTop mid → ticker24h.lastPrice (see `lastPrice`), never the mark price */
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
  /** whether a virtual live reading may be built (top feed AND delta series live/stale, all from Binance / proxy) */
  liveReadingOk: boolean;
  /** health state of the Long % feed */
  state: FeedHealth["state"];
  /** time of the point Long % / Delta show (the 5-min point when the live series is newer) */
  asOf: number | null;
  taker: TakerView | null;
  /** additive: Long % comes from the 5-min live series (newer than the chosen-period point) */
  fromLive: boolean;
  /** additive: the feed whose health describes the shown value (live 5-min twin or the chosen-period feed) */
  readingFeed: FeedId;
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

/**
 * Last price, never the mark price: `aggTrade.price` → bookTop mid → `ticker24h.lastPrice` in that order of preference,
 * but only among the candidates within `PRICE_PREFER_MS` (5 s) of the NEWEST one (`asOf`, exchange clock). A trade price
 * older than that loses to a fresher book or ticker price, so a silent trade stream never keeps a frozen number on
 * screen while the 30-s ticker poll or the 5-s REST stand-in delivers (the Galaxy Tab showed 82.446,4 for 6 minutes
 * although the ticker it polled meanwhile said 82.080). While the stream delivers, the trade is at most a few hundred
 * milliseconds behind the ticker's `closeTime`, so it keeps winning.
 */
export function lastPrice(feeds: FeedSnapshot): { price: number; provenance: Provenance } | null {
  const candidates: { price: number; v: Stamped<unknown> }[] = [];
  const a = feeds.aggTrade;
  if (a && Number.isFinite(a.data.price)) candidates.push({ price: a.data.price, v: a });
  const b = feeds.bookTop;
  if (b && Number.isFinite(b.data.bid) && Number.isFinite(b.data.ask)) candidates.push({ price: (b.data.bid + b.data.ask) / 2, v: b });
  const t = feeds.ticker24h;
  if (t && Number.isFinite(t.data.lastPrice)) candidates.push({ price: t.data.lastPrice, v: t });
  if (candidates.length === 0) return null;
  let newest = -Infinity;
  for (const c of candidates) if (c.v.asOf > newest) newest = c.v.asOf;
  const pick = candidates.find((c) => c.v.asOf >= newest - PRICE_PREFER_MS) ?? candidates[0]!;
  return { price: pick.price, provenance: prov(pick.v) };
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

export interface LegacyStatus {
  status: LegacyMarketStatus;
  message?: string;
  sourceBadge?: string;
  priceMode: PriceMode;
  pill: StatusLabel;
}

const PRICE_POLL_SEC = Math.round(PRICE_REST_FALLBACK_MS / 1000);
const CONNECTING_PILL: StatusLabel = { tone: "muted", text: STRINGS.connecting };
const LIVE_PILL: StatusLabel = { tone: "live", text: STRINGS.live };

/** While the socket is down, a price received within this long (3 polls) counts as `Kurs per Abfrage`; older → `Verbinde …`. */
export const PRICE_POLL_FRESH_MS = 3 * PRICE_REST_FALLBACK_MS;

/**
 * Legacy card status from the price feeds only (Plan 4.4 "Mapping auf das Bestands-Enum") plus the honest pill:
 * - `stream`: the socket delivers → `live`, the card shows the LivePill with the trade's age;
 * - `poll`: the socket is down (silent, exhausted, reconnecting) and the REST stand-in delivered the shown price within
 *   the last 15 s (every 5 s), or another exchange polls it → `live`, pill `Kurs per Abfrage · 5 s` (+ `Ersatzquelle Bybit`);
 * - `waiting`: the socket is down and nothing fresher than 15 s arrived (the stand-in is failing or held back; the price
 *   shown is still < 2 min old) → `live`, pill `Verbinde …`; and back from the background / a device sleep with an older
 *   price while the stand-in's first request is on its way (armed now, nothing failed since) → `connecting`, `Verbinde …`
 *   for the few hundred ms it takes — never a `Kein Live-Kurs` flash on the way back;
 * - `none`: no price yet (`connecting`, `Verbinde …`), the device offline (`Offline`, `Offline · Stand HH:mm`), every
 *   source failed, bad symbol, or the shown price is older than `PRICE_STALE_MS` — neither stream nor REST
 *   delivered for 2 minutes → `error`, pill `Kein Live-Kurs`, footer `Zuletzt HH:mm · veraltet` of the price actually
 *   shown (`lastPrice` picks the freshest, so a fresher REST price never hides behind a stale trade).
 * A socket hiccup never reaches `Kein Live-Kurs`: the silence is detected after 10 s and the stand-in answers within a second.
 */
export function legacyStatus(health: ProviderHealth, price: { provenance: Provenance } | null, now: number, retryInSec?: number): LegacyStatus {
  const agg = health.feeds.aggTrade;
  const mark = health.feeds.markPrice;
  const feed = agg.lastDataAt !== undefined || agg.state !== "connecting" ? agg : mark;
  const noPrice = (message: string, detail?: string): LegacyStatus => ({ status: "error", message, priceMode: "none", pill: { tone: "error", text: STRINGS.noPrice, detail } });
  if (feed.reason === "bad_symbol") return noPrice(STRINGS.noPrice, feed.detail);
  if (!health.online || feed.state === "offline") {
    const at = price?.provenance.asOf ?? feed.lastDataAt;
    // the device is online but every source failed for the price: no "Offline" (the user's network works)
    if (health.online) return noPrice(at !== undefined ? `${STRINGS.lastPrefix} ${hhmm(at)} · ${STRINGS.staleSuffix}` : STRINGS.noPrice, feed.detail);
    const message = at !== undefined ? `${STRINGS.offline} · ${STRINGS.standPrefix} ${hhmm(at)}` : STRINGS.offline;
    return { status: "error", message, priceMode: "none", pill: { tone: "error", text: STRINGS.offline, detail: message } };
  }
  if (!price) {
    if (feed.state === "connecting") return { status: "connecting", message: retryInSec !== undefined ? STRINGS.retrying(retryInSec) : undefined, priceMode: "none", pill: CONNECTING_PILL };
    const message = feed.consecutiveFailures > 0 && retryInSec !== undefined ? STRINGS.retrying(retryInSec) : STRINGS.noPrice;
    return noPrice(message, message !== STRINGS.noPrice ? message : feed.detail);
  }
  const down = wsDown(health);
  const age = now - price.provenance.asOf;
  if (age > PRICE_STALE_MS) {
    const message = `${STRINGS.lastPrefix} ${hhmm(price.provenance.asOf)} · ${STRINGS.staleSuffix}`;
    // back from the background / a device sleep: nothing was tried while the timers slept (no REST failure, no source
    // move since — a move leaves its failure reason), and the resume armed the stand-in for right now
    const untried = agg.consecutiveFailures === 0 && (agg.reason === undefined || agg.reason === "ws_silent" || agg.reason === "ws_closed") && (agg.source === "binance" || agg.source === "proxy");
    const fetching = down && untried && agg.nextRefreshAt !== undefined && Math.abs(now - agg.nextRefreshAt) < 2 * PRICE_REST_FALLBACK_MS;
    if (fetching) return { status: "connecting", message, priceMode: "waiting", pill: { ...CONNECTING_PILL, detail: message } };
    return noPrice(message, message);
  }
  if (feed.state === "connecting" && price.provenance.receivedAt < (health.ws.connectedAt ?? 0)) return { status: "connecting", priceMode: "none", pill: CONNECTING_PILL };
  const other = price.provenance.source !== "binance" && price.provenance.source !== "proxy";
  if (other) {
    return { status: "live", sourceBadge: fallbackBadge(price.provenance.source), message: STRINGS.fallbackDetail, priceMode: "poll", pill: { tone: "warn", text: STRINGS.pricePolled(PRICE_POLL_SEC), detail: STRINGS.fallbackDetail } };
  }
  if (down) {
    // device clock on both sides (`receivedAt`): a skewed device clock never turns a fresh poll into `Verbinde …`
    if (now - price.provenance.receivedAt <= PRICE_POLL_FRESH_MS) return { status: "live", priceMode: "poll", pill: { tone: "warn", text: STRINGS.pricePolled(PRICE_POLL_SEC), detail: STRINGS.wsFallbackDetail } };
    // nothing fresh on its way right now: the stand-in is failing (or held back by the budget)
    const soft = agg.reason ? SOFT_FAILURE_TEXT[agg.reason] : undefined;
    return { status: "live", priceMode: "waiting", pill: { tone: "muted", text: STRINGS.connecting, detail: agg.detail ?? soft ?? STRINGS.wsFallbackDetail } };
  }
  return { status: "live", priceMode: "stream", pill: LIVE_PILL };
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
    priceMode: legacy.priceMode,
    pill: legacy.pill,
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

const BINANCE_DATA: readonly Source[] = ["binance", "proxy"];

/**
 * A ratio series usable for the live reading: data present, served by Binance (direct or through the proxy) both
 * per health and per value, and `live`/`stale` (or `fallback` on the proxy, which is Binance's own data).
 */
export function isBinanceSeries(health: ProviderHealth, feed: FeedId, v: Stamped<RatioPoint[]> | undefined): boolean {
  const h = health.feeds[feed];
  if (!h || !v || v.data.length === 0) return false;
  if (!BINANCE_DATA.includes(v.source) || !BINANCE_DATA.includes(h.source)) return false;
  return h.state === "live" || h.state === "stale" || (h.state === "fallback" && h.source === "proxy");
}

/** Newest of two optional points (the live one wins a tie). */
function newer(live: RatioPoint | undefined, main: RatioPoint | undefined): RatioPoint | undefined {
  if (!live) return main;
  if (!main) return live;
  return live.time >= main.time ? live : main;
}

/**
 * Top-trader card (Plan 4.8). `base` comes from `tj2-ui.topTraderBase` (default `accounts`).
 *
 * Long % and Delta show the NEWEST Binance snapshot: the 5-min live series (`*5m`) when it is newer than the
 * chosen-period point (ratios are snapshots, so the 5-min point at 14:00 equals the 1h point at 14:00 — the 5-min
 * series just has one more every 5 minutes). `Δ+ Kerzen`, the sparkline and the "Live reading" gate stay on the
 * chosen-period series (`settings.hyblock.timeframe`), as before.
 */
export function deriveTopTrader(feeds: FeedSnapshot, health: ProviderHealth, base: TopTraderBase = "accounts"): TopTraderView {
  const acc = feeds.topAccountRatio;
  const pos = feeds.topPositionRatio;
  const glob = feeds.globalAccountRatio;
  const primaryFeed: FeedId = base === "positions" ? "topPositionRatio" : "topAccountRatio";
  const liveFeed: FeedId = base === "positions" ? "topPositionRatio5m" : "topAccountRatio5m";
  const primary = base === "positions" ? pos : acc;
  const h = health.feeds[primaryFeed];
  const onlyBinance = h.reason === "unsupported" || health.feeds.topPositionRatio.reason === "unsupported";
  const ds = deltaSeries(pos?.data, glob?.data);
  const deltas = ds.map((d) => d.delta);
  const last = ds[ds.length - 1];
  const dsOk = isBinanceSeries(health, "topPositionRatio", pos) && isBinanceSeries(health, "globalAccountRatio", glob);
  const primaryOk = isBinanceSeries(health, primaryFeed, primary);

  // 5-min live twins (absent until the provider delivered them; never from Bybit/OKX)
  const liveOk = (f: FeedId, v: Stamped<RatioPoint[]> | undefined) => (isBinanceSeries(health, f, v) ? v!.data[v!.data.length - 1] : undefined);
  const liveAcc = liveOk("topAccountRatio5m", feeds.topAccountRatio5m);
  const livePos = liveOk("topPositionRatio5m", feeds.topPositionRatio5m);
  const liveGlob = liveOk("globalAccountRatio5m", feeds.globalAccountRatio5m);
  const liveTop = base === "positions" ? livePos : liveAcc;
  const mainTop = primaryOk ? primary!.data[primary!.data.length - 1] : undefined;
  const top = newer(liveTop, mainTop);
  const fromLive = !!top && top === liveTop;
  const liveDelta = livePos && liveGlob && livePos.time === liveGlob.time ? { time: livePos.time, delta: livePos.longPct - liveGlob.longPct } : undefined;
  const delta = liveDelta && (!last || !dsOk || liveDelta.time >= last.time) ? liveDelta : last;

  const longPct = top ? top.longPct : topTraderLongPct(acc?.data, pos?.data, base);
  const liveReadingOk = !onlyBinance && dsOk && top !== undefined && delta !== undefined;
  const series = primary?.data ?? [];
  const lastOf = (s: Stamped<RatioPoint[]> | undefined) => s?.data[s.data.length - 1];
  return {
    longPct,
    longPctPositions: newer(livePos, lastOf(pos))?.longPct ?? null,
    longPctAccounts: newer(liveAcc, lastOf(acc))?.longPct ?? null,
    globalLongPct: newer(liveGlob, lastOf(glob))?.longPct ?? null,
    delta: delta ? delta.delta : null,
    deltaCandles: deltaCandles(deltas),
    deltaSeries: ds,
    sparkline: series.slice(-20).map((p) => p.longPct),
    base,
    provenance: primary ? prov(primary) : null,
    onlyBinance,
    detail: h.detail ?? health.feeds.globalAccountRatio.detail,
    liveReadingOk,
    state: fromLive ? health.feeds[liveFeed].state : h.state,
    asOf: top ? top.time : (primary?.asOf ?? null),
    taker: takerView(feeds.takerRatio?.data),
    fromLive,
    readingFeed: fromLive ? liveFeed : primaryFeed,
  };
}

// ------------------------------------------------------------------ freshness (Top-Trader card note)

export type TopTraderFreshnessKind = "live" | "proxy" | "waiting" | "retrying" | "stale" | "blocked" | "offline" | "connecting";

export interface TopTraderFreshness {
  kind: TopTraderFreshnessKind;
  tone: StatusLabel["tone"];
  /** what is going on, e.g. `Binance liefert alle 5 min neu`, `Binance antwortet nicht (Netzwerk/CORS)` */
  lead: string;
  /** time of the shown point (`Stand HH:mm`) */
  standAt: number | null;
  /** next poll / retry / re-probe (countdown target), null when none is known */
  nextAt: number | null;
  /** countdown label: `nächste Daten` or `neuer Versuch` */
  nextLabel: string;
  /** tooltip: health detail of the feed (HTTP status, error text, period mapping) */
  detail?: string;
}

export const FRESHNESS = {
  everyFresh: (cadence: string) => `Binance liefert ${cadence} neu`,
  viaProxy: (cadence: string) => `Binance über EU-Proxy · ${cadence} neu`,
  retrying: "Binance antwortet nicht",
  blocked: "Binance blockiert (Region)",
  blockedProxy: "Binance blockiert · Daten über EU-Proxy",
  offline: "Offline",
  connecting: "Verbinde mit Binance …",
  stale: "veraltet",
  nextData: "nächste Daten",
  retry: "neuer Versuch",
  loading: "lädt …",
  manual: "letzte Ablesung",
  /** single-file version opened from disk: no proxy for the CORS-less futures data */
  fileCors: "Datei-Version: Browser liest Binance-Top-Trader nicht (CORS) – Web-Link nutzen",
} as const;

/**
 * What the Top-Trader card says about its numbers — distinguishes "Binance publishes every 5 min, next point in
 * m:ss" from "Binance does not answer, retry in m:ss" and "Binance blocked here". `periodMs` is the cadence of the
 * chosen-period series (`provider.specs.topAccountRatio.cadenceMs`); the live twins are 5 min.
 */
export function topTraderFreshness(tt: TopTraderView, health: ProviderHealth, periodMs?: number): TopTraderFreshness {
  const fh = health.feeds[tt.readingFeed];
  const cadenceMs = tt.fromLive ? 5 * 60_000 : periodMs;
  const cadence = cadenceMs ? cadenceLabel(cadenceMs) : "";
  const standAt = tt.asOf;
  const detail = fh?.detail;
  const base = { standAt, detail };
  if (!health.online) return { ...base, kind: "offline", tone: "error", lead: FRESHNESS.offline, nextAt: null, nextLabel: FRESHNESS.retry };
  if (health.primary.blocked) {
    if (tt.liveReadingOk && fh?.source === "proxy") return { ...base, kind: "proxy", tone: "warn", lead: FRESHNESS.blockedProxy, nextAt: fh.nextRefreshAt ?? null, nextLabel: FRESHNESS.nextData };
    return { ...base, kind: "blocked", tone: "warn", lead: FRESHNESS.blocked, nextAt: health.primary.nextProbeAt ?? null, nextLabel: FRESHNESS.retry };
  }
  if (!fh) return { ...base, kind: "connecting", tone: "muted", lead: FRESHNESS.connecting, nextAt: null, nextLabel: FRESHNESS.nextData };
  // the reading's feed, or any series the reading needs, is failing on its source
  const failing = [fh, health.feeds.topPositionRatio, health.feeds.globalAccountRatio].find((f) => f && f.consecutiveFailures > 0 && f.reason !== undefined && SOFT_FAILURE_CAUSE[f.reason] !== undefined);
  if (failing) {
    const why = SOFT_FAILURE_CAUSE[failing.reason!]!;
    // opened from disk there is no EU proxy: a CORS-less /futures/data stays unreadable — say what helps
    const lead = (failing.reason === "network" || failing.reason === "cors") && isFileProtocol() ? FRESHNESS.fileCors : `${FRESHNESS.retrying} (${why})`;
    return { standAt, detail: failing.detail ?? detail, kind: "retrying", tone: "warn", lead, nextAt: failing.nextRefreshAt ?? null, nextLabel: FRESHNESS.retry };
  }
  if (!tt.liveReadingOk) {
    if (tt.onlyBinance) return { ...base, kind: "blocked", tone: "warn", lead: STRINGS.onlyBinance, nextAt: health.primary.nextProbeAt ?? null, nextLabel: FRESHNESS.retry };
    if (fh.state === "connecting" || fh.lastDataAt === undefined) return { ...base, kind: "connecting", tone: "muted", lead: FRESHNESS.connecting, nextAt: fh.nextRefreshAt ?? null, nextLabel: FRESHNESS.nextData };
  }
  if (fh.state === "stale" || fh.state === "offline") return { ...base, kind: "stale", tone: "warn", lead: FRESHNESS.stale, nextAt: fh.nextRefreshAt ?? null, nextLabel: FRESHNESS.nextData };
  if (fh.source === "proxy") return { ...base, kind: "proxy", tone: "live", lead: FRESHNESS.viaProxy(cadence), nextAt: fh.nextRefreshAt ?? null, nextLabel: FRESHNESS.nextData };
  return { ...base, kind: "live", tone: "live", lead: cadence ? FRESHNESS.everyFresh(cadence) : SOURCE_LEAD, nextAt: fh.nextRefreshAt ?? null, nextLabel: FRESHNESS.nextData };
}
const SOURCE_LEAD = "Binance";

/** `m:ss` (minutes not padded), from milliseconds, never negative. */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * One line for the card note, recomputed every second on the shared clock:
 * `Binance liefert alle 5 min neu · Stand 14:05 · nächste Daten in 3:12`. A countdown that ran out reads `lädt …`.
 */
export function freshnessText(f: TopTraderFreshness, now: number, timeZone?: string): string {
  const parts: string[] = [f.lead];
  if (f.standAt !== null) parts.push(`${STRINGS.standPrefix} ${hhmm(f.standAt, timeZone)}`);
  if (f.nextAt !== null) parts.push(f.nextAt - now > 0 ? `${f.nextLabel} in ${mmss(f.nextAt - now)}` : f.nextLabel === FRESHNESS.retry ? `${FRESHNESS.retry} läuft …` : FRESHNESS.loading);
  return parts.join(" · ");
}

/**
 * Health signature of everything `deriveTopTrader` / `topTraderFreshness` read: re-derive the card only when one of
 * these changes (the provider replaces the health object several times a second while the socket is live).
 */
export function topTraderHealthSignature(h: ProviderHealth): string {
  const ids: FeedId[] = ["topAccountRatio", "topPositionRatio", "globalAccountRatio", "takerRatio", "topAccountRatio5m", "topPositionRatio5m", "globalAccountRatio5m"];
  const parts = ids.map((id) => {
    const f = h.feeds[id];
    if (!f) return "-";
    return `${f.state}:${f.source}:${f.reason ?? ""}:${f.consecutiveFailures}:${f.nextRefreshAt ?? 0}:${f.lastDataAt ?? 0}:${f.detail ?? ""}`;
  });
  return `${h.online ? 1 : 0}|${h.primary.blocked ? 1 : 0}|${h.primary.nextProbeAt ?? 0}|${String(h.proxy.usable)}|${parts.join("|")}`;
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
    note: tt.fromLive ? "Live von Binance · 5-min-Wert" : "Live von Binance",
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
