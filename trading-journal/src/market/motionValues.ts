/**
 * High-frequency values live in MotionValues (Plan 4.2 "aggTrade wird pro Frame koalesziert"): the WS
 * updates them without a React render; `RollingDigits`, the chart's forming candle and the live labels
 * subscribe directly. Ticks are queued and flushed once per animation frame (`frame.update`); everything that
 * must not be lost to that coalescing (traded quantity, trade count, order flow) is accumulated in the queue.
 *
 * Reset strategy: values are scoped to the bound SYMBOL. `bindMotionValues()` for a different symbol than the
 * previous binding zeroes everything (price, book, mark, funding, 24 h open, trade time, tick direction,
 * volume accumulators, order flow, trade count) before seeding from the new provider. Re-binding the same
 * symbol (period change, `Cache leeren`, restart) keeps every value, so nothing visibly jumps. Consumers never
 * reset anything; they derive windows by differencing the monotonic accumulators.
 */
import { cancelFrame, frame, motionValue, type MotionValue } from "motion/react";
import type { AggTrade, MarketDataProvider, Stamped, Ticker24h } from "./types";

/** last traded price (`aggTrade.p`, fallback ticker) */
export const priceMv: MotionValue<number> = motionValue(0);
export const bidMv: MotionValue<number> = motionValue(0);
export const askMv: MotionValue<number> = motionValue(0);
export const markMv: MotionValue<number> = motionValue(0);
/** funding rate (raw, e.g. 0.0001) */
export const fundingMv: MotionValue<number> = motionValue(0);
/** next funding time (ms UTC); countdown = `nextFundingMv − nowMv` */
export const nextFundingMv: MotionValue<number> = motionValue(0);
/** receivedAt of the last price tick (LivePill age without renders) */
export const priceReceivedAtMv: MotionValue<number> = motionValue(0);
/**
 * Exchange time (ms UTC) of the last trade (`aggTrade.T`; the ticker time while the REST/Bybit fallback serves the
 * price). Set before `priceMv` in the same flush, so a `priceMv` listener always reads the matching time
 * (the chart buckets the forming bar with it).
 */
export const tradeTimeMv: MotionValue<number> = motionValue(0);
/**
 * Direction of the last price move: `+1` up-tick, `−1` down-tick. Zero-ticks (same-price prints) keep the
 * previous direction, so colours never flicker to neutral between moves; `0` only until the first move after a
 * symbol switch. Computed per flushed frame (net move of the frame), set before `priceMv`.
 */
export const tickDirMv: MotionValue<number> = motionValue(0);
/**
 * 24 h reference open = `ticker24h.lastPrice / (1 + priceChangePercent / 100)`, `0` until known. Live 24 h change
 * in % = `(priceMv / open24hMv − 1) · 100` (moves with every trade instead of every 30-s ticker poll).
 */
export const open24hMv: MotionValue<number> = motionValue(0);
/** Taker volume (base asset) since the symbol was bound: `buyVolMv + sellVolMv`. Monotonic. */
export const volAccumMv: MotionValue<number> = motionValue(0);
/** Aggressive BUY volume (taker = buyer, `aggTrade.m === false`) since the symbol was bound. Monotonic. */
export const buyVolMv: MotionValue<number> = motionValue(0);
/** Aggressive SELL volume (taker = seller, `aggTrade.m === true`) since the symbol was bound. Monotonic. */
export const sellVolMv: MotionValue<number> = motionValue(0);
/**
 * Order-flow imbalance in `[−1, +1]`: `(buy − sell) / (buy + sell)` over exponentially decayed taker volume
 * (half-life `ORDER_FLOW_HALF_LIFE_MS` in trade time). `+1` = only aggressive buyers lately, `0` = balanced / no
 * flow yet. Bind a meter straight to it (`scaleX`, `x`). Decay is applied per trade, which leaves the ratio exact
 * between trades (both sides decay alike), so the value only changes when a trade prints.
 */
export const flowImbalanceMv: MotionValue<number> = motionValue(0);
/**
 * Count of price prints since the symbol was bound (aggTrade events, including the fallback's ticker-derived
 * prints). Changes at most once per frame; subscribe for a heartbeat that also fires on same-price trades.
 */
export const tradeCountMv: MotionValue<number> = motionValue(0);

/** Half-life of the decayed order flow behind `flowImbalanceMv`. */
export const ORDER_FLOW_HALF_LIFE_MS = 15_000;
const FLOW_DECAY_PER_MS = Math.LN2 / ORDER_FLOW_HALF_LIFE_MS;

interface Pending {
  price?: number;
  receivedAt?: number;
  tradeTime?: number;
  bid?: number;
  ask?: number;
  mark?: number;
  funding?: number;
  nextFunding?: number;
  open24h?: number;
  /** seed values carry no direction (first price of a binding, or a symbol switch) */
  seed: boolean;
  buyQty: number;
  sellQty: number;
  prints: number;
  flowDirty: boolean;
}

const emptyPending = (): Pending => ({ seed: false, buyQty: 0, sellQty: 0, prints: 0, flowDirty: false });

let pending: Pending = emptyPending();
let scheduled = false;
let boundSymbol: string | null = null;

/** Decayed taker volume per side as of `at` (trade time); see `flowImbalanceMv`. */
const flow = { buy: 0, sell: 0, at: 0 };

function addFlow(qty: number, isBuyerMaker: boolean, time: number): void {
  if (flow.at > 0 && time > flow.at) {
    const k = Math.exp(-(time - flow.at) * FLOW_DECAY_PER_MS);
    flow.buy *= k;
    flow.sell *= k;
  }
  if (time > flow.at) flow.at = time;
  if (isBuyerMaker) flow.sell += qty;
  else flow.buy += qty;
}

/** Pure: imbalance of two non-negative volumes (`0` without volume). */
export function flowImbalance(buy: number, sell: number): number {
  const total = buy + sell;
  return total > 0 ? (buy - sell) / total : 0;
}

/** Pure: 24 h reference open from a ticker (`null` when the change is not a usable percentage). */
export function open24hFrom(t: Pick<Ticker24h, "lastPrice" | "priceChangePercent">): number | null {
  const base = 1 + t.priceChangePercent / 100;
  if (!(t.lastPrice > 0) || !(base > 0) || !Number.isFinite(base)) return null;
  return t.lastPrice / base;
}

function flush(): void {
  scheduled = false;
  const p = pending;
  pending = emptyPending();
  // Everything a `priceMv` listener may read (time, direction, book, 24 h open, flow) is set first; price last.
  if (p.tradeTime !== undefined) tradeTimeMv.set(p.tradeTime);
  if (p.receivedAt !== undefined) priceReceivedAtMv.set(p.receivedAt);
  if (p.bid !== undefined) bidMv.set(p.bid);
  if (p.ask !== undefined) askMv.set(p.ask);
  if (p.mark !== undefined) markMv.set(p.mark);
  if (p.funding !== undefined) fundingMv.set(p.funding);
  if (p.nextFunding !== undefined) nextFundingMv.set(p.nextFunding);
  if (p.open24h !== undefined) open24hMv.set(p.open24h);
  if (p.buyQty > 0 || p.sellQty > 0) {
    buyVolMv.set(buyVolMv.get() + p.buyQty);
    sellVolMv.set(sellVolMv.get() + p.sellQty);
    volAccumMv.set(volAccumMv.get() + p.buyQty + p.sellQty);
  }
  if (p.flowDirty) flowImbalanceMv.set(flowImbalance(flow.buy, flow.sell));
  if (p.prints > 0) tradeCountMv.set(tradeCountMv.get() + p.prints);
  if (p.price !== undefined) {
    const prev = priceMv.get();
    if (!p.seed && prev > 0 && p.price !== prev) tickDirMv.set(p.price > prev ? 1 : -1);
    priceMv.set(p.price);
  }
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  frame.update(flush, false);
}

function queueTrade(t: AggTrade, receivedAt: number): void {
  pending.price = t.price;
  pending.receivedAt = receivedAt;
  pending.tradeTime = t.time;
  pending.prints += 1;
  if (t.qty > 0 && Number.isFinite(t.qty)) {
    if (t.isBuyerMaker) pending.sellQty += t.qty;
    else pending.buyQty += t.qty;
    addFlow(t.qty, t.isBuyerMaker, t.time);
    pending.flowDirty = true;
  }
  schedule();
}

function queueTicker(v: Stamped<Ticker24h>, withPrice: boolean): void {
  const open = open24hFrom(v.data);
  if (open !== null) pending.open24h = open;
  if (withPrice) {
    pending.price = v.data.lastPrice;
    pending.receivedAt = v.receivedAt;
    pending.tradeTime = v.asOf;
  }
  schedule();
}

/** Immediate flush (tests / unmount). */
export function flushMotionValues(): void {
  if (!scheduled) return;
  cancelFrame(flush);
  flush();
}

const SYMBOL_SCOPED: readonly MotionValue<number>[] = [
  priceMv,
  bidMv,
  askMv,
  markMv,
  fundingMv,
  nextFundingMv,
  priceReceivedAtMv,
  tradeTimeMv,
  tickDirMv,
  open24hMv,
  volAccumMv,
  buyVolMv,
  sellVolMv,
  flowImbalanceMv,
  tradeCountMv,
];

function resetSymbolScope(): void {
  if (scheduled) cancelFrame(flush);
  scheduled = false;
  pending = emptyPending();
  flow.buy = 0;
  flow.sell = 0;
  flow.at = 0;
  // `jump` (not `set`) also zeroes the velocity, so the next symbol's first move does not inherit the old one's
  for (const mv of SYMBOL_SCOPED) mv.jump(0);
}

/**
 * Subscribes the MotionValues to a provider. Seeds from the current snapshot, then coalesces WS ticks per
 * frame. Returns an unsubscribe function. See the module doc for the reset strategy.
 */
export function bindMotionValues(provider: MarketDataProvider): () => void {
  if (boundSymbol !== null && boundSymbol !== provider.symbol) resetSymbolScope();
  boundSymbol = provider.symbol;

  const seedAgg = provider.get("aggTrade");
  const seedTicker = provider.get("ticker24h");
  const seedBook = provider.get("bookTop");
  const seedMark = provider.get("markPrice");
  if (seedAgg) {
    pending.price = seedAgg.data.price;
    pending.receivedAt = seedAgg.receivedAt;
    pending.tradeTime = seedAgg.data.time;
    pending.seed = true;
  }
  if (seedTicker) queueTicker(seedTicker, !seedAgg);
  if (!seedAgg && seedTicker) pending.seed = true;
  if (seedBook) {
    pending.bid = seedBook.data.bid;
    pending.ask = seedBook.data.ask;
  }
  if (seedMark) {
    pending.mark = seedMark.data.markPrice;
    pending.funding = seedMark.data.fundingRate;
    pending.nextFunding = seedMark.data.nextFundingTime;
  }
  if (seedAgg || seedTicker || seedBook || seedMark) schedule();

  const offs = [
    provider.subscribe("aggTrade", (v) => queueTrade(v.data, v.receivedAt)),
    // the ticker always refreshes the 24 h open; it carries the price only when no trade stream serves it
    provider.subscribe("ticker24h", (v) => queueTicker(v, !provider.get("aggTrade"))),
    provider.subscribe("bookTop", (v) => {
      pending.bid = v.data.bid;
      pending.ask = v.data.ask;
      schedule();
    }),
    provider.subscribe("markPrice", (v) => {
      pending.mark = v.data.markPrice;
      pending.funding = v.data.fundingRate;
      pending.nextFunding = v.data.nextFundingTime;
      schedule();
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
