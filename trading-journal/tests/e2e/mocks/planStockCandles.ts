/**
 * Deterministische Aktien-Kerzen für den Handelsplan (Unit- und e2e-Tests): AAPL, eine reguläre US-Sitzung. Die Kerzen sind
 * erfunden und stehen ausdrücklich als Test-Daten da; sie hängen NICHT an der Uhr – der Tag ist ein Parameter, die Zahlen sind
 * immer dieselben. (Ein Test sucht sich einen jungen Handelstag, damit die Quelle ihn noch ausliefert; die Handrechnung bleibt.)
 *
 *   Range 9:30–9:45 (Kerzen 0–2):  Hoch 185,60 · Tief 184,50 · Mitte 185,05 · Höhe 1,10 · Ø-Volumen 70 000
 *   Kerze 3 (9:45): Hoch 185,55, Schluss 185,40 – innerhalb der Range, löst nichts aus
 *   Kerze 4 (9:50): Schluss 185,90 über dem Hoch → Signal Long um 9:55 New Yorker Zeit zu 185,90 (Volumen 75 000 = 1,07×)
 *   alles danach: ruhiger Füller zwischen 185,45 und 186,35 (auf dem Cent)
 *
 * Handrechnung des Plans (Stop Range-Mitte, Ziel 2R, Konto Scalp 5 000, Risiko 1 %, Gebühr/Slippage je 0,05 %):
 *   Stop 185,05 · Risiko 0,85 (0,457 %) · Ziel 187,60 · Verlust je Stück 0,85 + 0,0005 × (185,90 + 185,05) + 0,0005 × 185,05 = 1,128
 *   Verlust-Grenze 50 ÷ 1,128 = 44,3 · Positionsdeckel 3 750 ÷ 185,90 = 20,17 · Kaufkraft 4 500 ÷ 185,90 = 24,2
 *   → 20 Stück (der Deckel bindet) = 3 718,00 USD · Verlust am Stop 22,56 USD · Ampel grün.
 */
import { sessionOf } from "../../../src/market/stocks/session";

export const STOCK_SYMBOL = "AAPL";
export const MIN5 = 300_000;
export const HOUR = 3_600_000;

export const STOCK_EXPECT = {
  rangeHigh: 185.6,
  rangeLow: 184.5,
  rangeMid: 185.05,
  signalPrice: 185.9,
  /** minutes after the open at which the signal candle closes (9:55) */
  signalAfterMin: 25,
  stop: 185.05,
  target: 187.6,
  risk: 0.85,
  lossPerUnit: 1.128,
  qty: 20,
  notional: 3718,
  maxLoss: 22.56,
} as const;

/** open, high, low, close, volume of the explicit candles (slot = 5-minute steps after the open) */
const SESSION: Record<number, [number, number, number, number, number]> = {
  0: [185.0, 185.6, 184.6, 185.2, 90_000],
  1: [185.2, 185.5, 184.8, 185.0, 60_000],
  2: [185.0, 185.4, 184.5, 185.3, 60_000],
  3: [185.3, 185.55, 185.2, 185.4, 50_000],
  4: [185.4, 186.1, 185.35, 185.9, 75_000],
};

const cents = (x: number): number => Math.round(x * 100) / 100;

function filler(slot: number): [number, number, number, number, number] {
  const w = ((slot * 7) % 9) - 4;
  const o = cents(185.9 + w * 0.05);
  const c = cents(185.9 + ((((slot + 1) * 7) % 9) - 4) * 0.05);
  return [o, cents(Math.max(o, c) + 0.1), cents(Math.min(o, c) - 0.1), c, 40_000];
}

/** The regular session of a New York day (`YYYY-MM-DD`), `null` on a weekend or holiday. */
export const stockOpen = (day: string): number => {
  const s = sessionOf(day);
  if (!s) throw new Error(`${day} is no trading day`);
  return s.openMs;
};

/** The wire bars `[time, o, h, l, c, v]` of the 5-minute candles of `day` (all 78, or the first `count`). */
export function stockSessionBars(day: string, count = 78): number[][] {
  const open = stockOpen(day);
  const out: number[][] = [];
  for (let slot = 0; slot < count; slot++) {
    const [o, h, l, c, v] = SESSION[slot] ?? filler(slot);
    out.push([open + slot * MIN5, o, h, l, c, v]);
  }
  return out;
}

/** Trading days before `day` (exclusive), newest first. */
export function tradingDaysBefore(day: string, n: number): string[] {
  const out: string[] = [];
  let t = Date.parse(`${day}T00:00:00Z`);
  while (out.length < n) {
    t -= 86_400_000;
    const key = new Date(t).toISOString().slice(0, 10);
    if (sessionOf(key)) out.push(key);
  }
  return out;
}

/** The most recent trading day before `ref` (a `Date.now()`-like value) that is at least `minAge` days old – for tests that need "a past day the source still serves". */
export function recentTradingDay(ref: number, minAge = 2): string {
  let t = Math.floor(ref / 86_400_000) * 86_400_000 - minAge * 86_400_000;
  for (let i = 0; i < 20; i++, t -= 86_400_000) {
    const key = new Date(t).toISOString().slice(0, 10);
    if (sessionOf(key)) return key;
  }
  throw new Error("no trading day found");
}

/** A small deterministic generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hourly (`1h`: 7 candles a day from 9:30) or daily (`1d`: one at the open) wire bars for the `days` trading days before `endDay`
 * (exclusive), oldest first – a seeded random walk around 180, valid OHLC (high ≥ open, close ≥ low …).
 */
export function stockHistoryBars(interval: "1h" | "1d", endDay: string, days: number, seed = 7): number[][] {
  const next = rng(seed);
  const list = tradingDaysBefore(endDay, days).reverse();
  let price = 180;
  const out: number[][] = [];
  const step = (): [number, number, number, number] => {
    const o = price;
    const c = o * (1 + (next() - 0.5) * (interval === "1d" ? 0.03 : 0.008));
    const h = Math.max(o, c) * (1 + next() * 0.003);
    const l = Math.min(o, c) * (1 - next() * 0.003);
    price = c;
    return [o, h, l, c].map((x) => Math.round(x * 100) / 100) as [number, number, number, number];
  };
  for (const day of list) {
    const open = stockOpen(day);
    if (interval === "1d") {
      const [o, h, l, c] = step();
      out.push([open, o, h, l, c, 50_000_000]);
    } else {
      for (let k = 0; k < 7; k++) {
        const [o, h, l, c] = step();
        out.push([open + k * HOUR, o, h, l, c, 7_000_000]);
      }
    }
  }
  return out;
}
