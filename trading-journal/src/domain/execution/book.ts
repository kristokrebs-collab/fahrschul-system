/**
 * Ausführbarkeit (F44), the order book: spread, depth around the middle and the price a market order of a given size would
 * get when it walks the book. Pure; a snapshot in, numbers out. Nothing here is a forecast – it describes one moment of the
 * book. A number that cannot be read from the snapshot is `null` (a one-sided or crossed book, a size the levels do not
 * cover), never a guess.
 *
 * Hand-checked in `tests/unit/execution.domain.test.ts`.
 */

export interface Level {
  price: number;
  qty: number;
}

export interface Book {
  /** best (highest) price first */
  bids: readonly Level[];
  /** best (lowest) price first */
  asks: readonly Level[];
  /** exchange time of the snapshot (ms) */
  time: number;
}

const ok = (l: Level): boolean => Number.isFinite(l.price) && Number.isFinite(l.qty) && l.price > 0 && l.qty > 0;

/** Levels as the exchange gives them (`[price, qty]`) → a clean book: invalid levels dropped, sides sorted best first. */
export function bookOf(bids: ReadonlyArray<readonly [number, number]>, asks: ReadonlyArray<readonly [number, number]>, time: number): Book {
  const lv = (rows: ReadonlyArray<readonly [number, number]>): Level[] => rows.map(([price, qty]) => ({ price, qty })).filter(ok);
  return { bids: lv(bids).sort((a, b) => b.price - a.price), asks: lv(asks).sort((a, b) => a.price - b.price), time };
}

export interface Touch {
  bid: number;
  ask: number;
  mid: number;
  /** ask − bid */
  spread: number;
  /** spread ÷ mid, in basis points (1 bp = 0,01 %) */
  spreadBps: number;
}

/** Best bid and ask. `null` when one side is empty or the book is crossed (bid ≥ ask: not a state to read a spread from). */
export function touchOf(b: Book): Touch | null {
  const bid = b.bids[0];
  const ask = b.asks[0];
  if (!bid || !ask || bid.price >= ask.price) return null;
  const mid = (bid.price + ask.price) / 2;
  const spread = ask.price - bid.price;
  return { bid: bid.price, ask: ask.price, mid, spread, spreadBps: (spread / mid) * 10_000 };
}

export interface Band {
  /** distance from the middle as a fraction (0,001 = 0,1 %) */
  pct: number;
  /** base units / quote value that stand on each side inside the band */
  bidQty: number;
  askQty: number;
  bidValue: number;
  askValue: number;
  /** the snapshot reaches the edge of the band on that side (else the numbers are a lower bound) */
  bidCovered: boolean;
  askCovered: boolean;
}

/** What stands within ±`pct` of the middle on each side. */
export function bandOf(b: Book, mid: number, pct: number): Band {
  const lo = mid * (1 - pct);
  const hi = mid * (1 + pct);
  let bidQty = 0;
  let bidValue = 0;
  let askQty = 0;
  let askValue = 0;
  for (const l of b.bids) {
    if (l.price < lo) break;
    bidQty += l.qty;
    bidValue += l.qty * l.price;
  }
  for (const l of b.asks) {
    if (l.price > hi) break;
    askQty += l.qty;
    askValue += l.qty * l.price;
  }
  const lastBid = b.bids[b.bids.length - 1];
  const lastAsk = b.asks[b.asks.length - 1];
  return { pct, bidQty, askQty, bidValue, askValue, bidCovered: !!lastBid && lastBid.price <= lo, askCovered: !!lastAsk && lastAsk.price >= hi };
}

export interface Fill {
  /** the quantity that was asked for / that the levels could fill */
  qty: number;
  filled: number;
  /** all of `qty` found levels */
  complete: boolean;
  /** volume-weighted average price of the filled part, `null` when nothing filled */
  avg: number | null;
  /** price of the last level touched, `null` when nothing filled */
  worst: number | null;
  levels: number;
}

/** Walks `levels` (best first) and takes `qty` from them. */
export function walk(levels: readonly Level[], qty: number): Fill {
  let left = qty;
  let value = 0;
  let filled = 0;
  let worst: number | null = null;
  let used = 0;
  for (const l of levels) {
    if (left <= 1e-12) break;
    const take = Math.min(left, l.qty);
    value += take * l.price;
    filled += take;
    left -= take;
    worst = l.price;
    used += 1;
  }
  return { qty, filled, complete: left <= qty * 1e-9 && qty > 0, avg: filled > 0 ? value / filled : null, worst, levels: used };
}

export interface Impact extends Fill {
  action: "buy" | "sell";
  /** best price on the side that is hit */
  touch: number;
  /** extra cost of walking the book beyond the best price, in basis points of the best price; `null` without a fill */
  impactBps: number | null;
  /** distance of the average price from the middle in bps (half the spread plus the impact); `null` without a fill */
  fromMidBps: number | null;
}

/** A market order of `qty` base units: a buy walks the asks, a sell walks the bids. `null` without a valid touch or size. */
export function marketImpact(b: Book, action: "buy" | "sell", qty: number): Impact | null {
  const t = touchOf(b);
  if (!t || !(qty > 0) || !Number.isFinite(qty)) return null;
  const f = walk(action === "buy" ? b.asks : b.bids, qty);
  const touch = action === "buy" ? t.ask : t.bid;
  return {
    ...f,
    action,
    touch,
    impactBps: f.avg === null ? null : (Math.abs(f.avg - touch) / touch) * 10_000,
    fromMidBps: f.avg === null ? null : (Math.abs(f.avg - t.mid) / t.mid) * 10_000,
  };
}
