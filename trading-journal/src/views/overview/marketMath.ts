/**
 * Pure helpers behind the live market panel and the top-trader card: display precision, the live 24 h change,
 * the order-flow meter window, health / price change keys (what a view must re-render for) and the instants at
 * which `deriveMarket` changes by time alone. No React, no MotionValues – unit-tested in isolation.
 */
import { pct } from "@/lib/format";
import { lastPrice, type FeedHealth, type FeedSnapshot, type ProviderHealth, type TopTraderBase } from "@/market";
import { scenario, TRIGGER_REACH_THRESHOLD, type ScenarioKey } from "@/domain/trigger";
import type { MarketLevels } from "@/domain/types";

const H4_MS = 14_400_000;
const W1_MS = 7 * 86_400_000;
/** `closedBar` counts a bar as closed from one minute before its close time (bundle `UM`). */
const CLOSE_GRACE_MS = 60_000;
/** `legacyStatus` turns the panel to "veraltet" when the price is older than this. */
export const STALE_PRICE_MS = 120_000;

/** Decimals of the live price by magnitude: BTC trades in 0.1 ticks, small caps need more places. */
export function priceDecimals(price: number | null | undefined): number {
  if (price == null || !Number.isFinite(price) || price >= 1000) return 1;
  if (price >= 10) return 2;
  if (price >= 1) return 3;
  return 5;
}

/** Live 24 h change in % from the last price and the 24 h reference open; `NaN` while either is unknown. */
export function change24h(price: number, open24h: number): number {
  return price > 0 && open24h > 0 ? (price / open24h - 1) * 100 : NaN;
}

/**
 * Minimum move between two price flashes: ten display ticks, i.e. one step of the last-but-one displayed digit (1 USD
 * at BTC with its tenths dimmed, 0,1 at a 2-decimal price). Together with `FLASH_MIN_INTERVAL_MS` the wash marks real
 * moves instead of staying lit through the bid/ask ping-pong of single prints.
 */
export function priceFlashStep(price: number | null | undefined): number {
  return 10 ** (1 - priceDecimals(price));
}

/**
 * Price-flash filter: the direction of a move of at least `minMove` away from the last flashed price (`anchor`),
 * and the new anchor. A non-positive price (unknown, symbol switch) resets; the first known price only anchors.
 */
export function priceTick(anchor: number, price: number, minMove: number): { anchor: number; dir: -1 | 0 | 1 } {
  if (!(price > 0)) return { anchor: 0, dir: 0 };
  if (!(anchor > 0)) return { anchor: price, dir: 0 };
  const d = price - anchor;
  if (d === 0 || Math.abs(d) < minMove) return { anchor, dir: 0 };
  return { anchor: price, dir: d > 0 ? 1 : -1 };
}

/** `{value} > 0 ? value : fallback` for MotionValues where `0` means "not known yet". */
export function orFallback(value: number, fallback: number | null | undefined): number {
  return value > 0 ? value : (fallback ?? 0);
}

/* ------------------------------------------------------------------ order flow */

/** Sampling window of the order-flow meter (one meter column per window). */
export const FLOW_WINDOW_MS = 100;
/** Per-window decay of the volume peak the meter is normalised to (≈ 4.6 s half-life at 100 ms windows). */
export const FLOW_PEAK_DECAY = 0.985;
/** Quiet windows after which the sampler stops (the meter has settled on its baseline by then). */
export const FLOW_QUIET_WINDOWS = 30;

export interface FlowWindow {
  /** buy / sell accumulator readings at the end of the previous window */
  buy: number;
  sell: number;
  /** decaying maximum of the per-window traded volume */
  peak: number;
}

export function createFlowWindow(buy: number, sell: number): FlowWindow {
  return { buy, sell, peak: 0 };
}

/**
 * One meter column from the monotonic taker accumulators: the window's net aggressive volume
 * `(Δbuy − Δsell)` relative to the decaying volume peak, square-root compressed so single small prints stay
 * visible next to bursts. `+1` = the strongest recent burst, all aggressive buyers; `0` = no trade in the window.
 * A decreasing accumulator means the symbol was re-bound (values reset): that window reads as empty.
 */
export function flowWindowStep(state: FlowWindow, buy: number, sell: number): number {
  let db = buy - state.buy;
  let ds = sell - state.sell;
  state.buy = buy;
  state.sell = sell;
  if (!(db >= 0) || !(ds >= 0)) {
    db = 0;
    ds = 0;
    state.peak = 0;
  }
  const total = db + ds;
  state.peak = Math.max(total, state.peak * FLOW_PEAK_DECAY);
  if (!(total > 0)) return 0;
  const v = (db - ds) / state.peak;
  return Math.sign(v) * Math.sqrt(Math.min(1, Math.abs(v)));
}

/** Share of aggressive buying (0..1) from the decayed imbalance `[−1, 1]`; `NaN` before any traded volume. */
export function buyShare(imbalance: number, volume: number): number {
  if (!(volume > 0) || !Number.isFinite(imbalance)) return NaN;
  return Math.min(1, Math.max(0, (1 + imbalance) / 2));
}

/* ------------------------------------------------------------------ trigger distances */

/** Reach of the proximity bar: a trigger 2 % away shows an empty bar, at the level it is full. */
export const PROXIMITY_RANGE = 0.02;

/** `Long-Trigger in +0,42 %` – the same label `evaluateTrigger` builds, from any price. */
export function distanceLabel(kind: "long" | "short", trigger: number, price: number): string {
  if (!(price > 0)) return `${kind === "long" ? "Long" : "Short"}-Trigger in –`;
  const d = kind === "long" ? (trigger - price) / price : (price - trigger) / price;
  return `${kind === "long" ? "Long" : "Short"}-Trigger in ${pct(d)}`;
}

/** Proximity 0..1 of a trigger level (1 = at the level). */
export function triggerProximity(kind: "long" | "short", trigger: number, price: number, range = PROXIMITY_RANGE): number {
  if (!(price > 0)) return 0;
  const d = kind === "long" ? (trigger - price) / price : (price - trigger) / price;
  return 1 - Math.min(1, Math.abs(d) / range);
}

/**
 * Every price-dependent flag of the trigger engine as one key (`in Reichweite` long/short, zone warning,
 * long invalidation). The panel re-evaluates the trigger only when this key changes, never per tick.
 */
export function triggerFlagsKey(price: number | null, m: MarketLevels, scenarioKey: ScenarioKey | null | undefined): string {
  if (price == null || !(price > 0)) return "none";
  const toLong = (m.longTrigger - price) / price;
  const toShort = (price - m.shortTrigger) / price;
  const longReach = toLong >= 0 && toLong < TRIGGER_REACH_THRESHOLD;
  const shortReach = toShort >= 0 && toShort < TRIGGER_REACH_THRESHOLD;
  const zone = price >= m.zoneLow && price <= m.zoneHigh;
  const invalid = scenarioKey === "long" && price < m.longStop;
  return `${+longReach}${+shortReach}${+zone}${+invalid}`;
}

/** Scenario the forming (unclosed) bar would trigger – the change signal of the `würde … auslösen` preview. */
export function formingScenarioKey(bars: readonly { close: number; closed: boolean }[] | undefined, m: MarketLevels): string {
  const last = bars?.[bars.length - 1];
  if (!last || last.closed) return "";
  return scenario(last.close, m)?.key ?? "";
}

/* ------------------------------------------------------------------ health keys */

function feedKey(f: FeedHealth): string {
  const offlineMinute = f.state === "offline" && f.lastDataAt !== undefined ? Math.floor(f.lastDataAt / 60_000) : "";
  return `${f.state}:${f.source}:${f.reason ?? ""}:${f.lastDataAt === undefined ? 0 : 1}:${f.consecutiveFailures > 0 ? 1 : 0}:${f.detail ?? ""}:${offlineMinute}`;
}

/**
 * The health fields the market panel derives from (`legacyStatus`, source badge, status-label detail, refresh
 * ring). `lastDataAt` moves with every WS second, so only its presence counts – this keeps the panel still while
 * the stream is healthy.
 */
export function panelHealthKey(h: ProviderHealth): string {
  return [h.online ? 1 : 0, h.ws.connectedAt ?? 0, feedKey(h.feeds.aggTrade), feedKey(h.feeds.markPrice), h.feeds.ticker24h.nextRefreshAt ?? 0].join("|");
}

/** The health fields `deriveTopTrader` and the card's status note read for `base`. */
export function topTraderHealthKey(h: ProviderHealth, base: TopTraderBase): string {
  const primary = base === "positions" ? h.feeds.topPositionRatio : h.feeds.topAccountRatio;
  return [feedKey(primary), feedKey(h.feeds.topPositionRatio), feedKey(h.feeds.globalAccountRatio)].join("|");
}

/* ------------------------------------------------------------------ time */

/**
 * Instants at which `deriveMarket(feeds, health, { now })` changes by the passage of time alone: the price turning
 * stale, the forming 4 h bar counting as closed (one minute early) and leaving the "running" slot, the forming
 * weekly bar counting as closed.
 */
export function viewDeadlines(feeds: FeedSnapshot): number[] {
  const out: number[] = [];
  const lp = lastPrice(feeds);
  if (lp) out.push(lp.provenance.asOf + STALE_PRICE_MS + 1);
  const k4 = feeds.kline_4h?.data;
  const f4 = k4?.[k4.length - 1];
  if (f4) out.push(f4.time + H4_MS - CLOSE_GRACE_MS, f4.time + H4_MS);
  const kw = feeds.kline_1w?.data;
  const fw = kw?.[kw.length - 1];
  if (fw) out.push(fw.time + W1_MS - CLOSE_GRACE_MS);
  return out;
}

/** The earliest deadline after `now`, or `null`. */
export function nextDeadline(deadlines: readonly number[], now: number): number | null {
  let next: number | null = null;
  for (const d of deadlines) if (d > now && (next === null || d < next)) next = d;
  return next;
}
