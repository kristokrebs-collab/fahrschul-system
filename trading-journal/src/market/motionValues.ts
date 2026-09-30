/**
 * High-frequency values live in MotionValues (Plan 4.2 "aggTrade wird pro Frame koalesziert"): the WS
 * updates them without a React render; `RollingDigits` and the chart price line subscribe directly.
 * `frame.update` coalesces to at most one `set()` per animation frame.
 */
import { frame, motionValue, type MotionValue } from "motion/react";
import type { MarketDataProvider } from "./types";

/** last traded price (`aggTrade.p`, fallback ticker) */
export const priceMv: MotionValue<number> = motionValue(0);
export const bidMv: MotionValue<number> = motionValue(0);
export const askMv: MotionValue<number> = motionValue(0);
export const markMv: MotionValue<number> = motionValue(0);
/** funding rate (raw, e.g. 0.0001) */
export const fundingMv: MotionValue<number> = motionValue(0);
/** ms until next funding (for the countdown) */
export const nextFundingMv: MotionValue<number> = motionValue(0);
/** receivedAt of the last price tick (LivePill age without renders) */
export const priceReceivedAtMv: MotionValue<number> = motionValue(0);

type Pending = { price?: number; bid?: number; ask?: number; mark?: number; funding?: number; nextFunding?: number; receivedAt?: number };
let pending: Pending = {};
let scheduled = false;

function flush(): void {
  scheduled = false;
  const p = pending;
  pending = {};
  if (p.price !== undefined) priceMv.set(p.price);
  if (p.bid !== undefined) bidMv.set(p.bid);
  if (p.ask !== undefined) askMv.set(p.ask);
  if (p.mark !== undefined) markMv.set(p.mark);
  if (p.funding !== undefined) fundingMv.set(p.funding);
  if (p.nextFunding !== undefined) nextFundingMv.set(p.nextFunding);
  if (p.receivedAt !== undefined) priceReceivedAtMv.set(p.receivedAt);
}

function queue(patch: Pending): void {
  pending = { ...pending, ...patch };
  if (scheduled) return;
  scheduled = true;
  frame.update(flush, false);
}

/** Immediate flush (tests / unmount). */
export function flushMotionValues(): void {
  if (scheduled) flush();
}

/**
 * Subscribes the MotionValues to a provider. Seeds from the current snapshot, then coalesces WS ticks per
 * frame. Returns an unsubscribe function.
 */
export function bindMotionValues(provider: MarketDataProvider): () => void {
  const seedAgg = provider.get("aggTrade");
  const seedTicker = provider.get("ticker24h");
  const seedBook = provider.get("bookTop");
  const seedMark = provider.get("markPrice");
  const seed: Pending = {};
  if (seedAgg) {
    seed.price = seedAgg.data.price;
    seed.receivedAt = seedAgg.receivedAt;
  } else if (seedTicker) {
    seed.price = seedTicker.data.lastPrice;
    seed.receivedAt = seedTicker.receivedAt;
  }
  if (seedBook) {
    seed.bid = seedBook.data.bid;
    seed.ask = seedBook.data.ask;
  }
  if (seedMark) {
    seed.mark = seedMark.data.markPrice;
    seed.funding = seedMark.data.fundingRate;
    seed.nextFunding = seedMark.data.nextFundingTime;
  }
  if (Object.keys(seed).length) queue(seed);

  const offs = [
    provider.subscribe("aggTrade", (v) => queue({ price: v.data.price, receivedAt: v.receivedAt })),
    provider.subscribe("ticker24h", (v) => {
      // only when no trade stream is serving the price
      if (!provider.get("aggTrade")) queue({ price: v.data.lastPrice, receivedAt: v.receivedAt });
    }),
    provider.subscribe("bookTop", (v) => queue({ bid: v.data.bid, ask: v.data.ask })),
    provider.subscribe("markPrice", (v) => queue({ mark: v.data.markPrice, funding: v.data.fundingRate, nextFunding: v.data.nextFundingTime })),
  ];
  return () => {
    for (const off of offs) off();
  };
}
