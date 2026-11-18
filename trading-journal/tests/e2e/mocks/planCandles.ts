/**
 * Deterministische 5-Minuten-Kerzen für den Handelsplan (Unit- und e2e-Tests): BTCUSDT, New Yorker Sitzung vom Montag
 * 19.10.2026 (EDT, UTC−4, Beginn 13:30 UTC). Die Kerzen sind erfunden und stehen ausdrücklich als Test-Daten da; sie hängen
 * NICHT an der Uhr – jede Anfrage nach einem Zeitfenster bekommt immer dieselben Zahlen.
 *
 *   Range 13:30–13:45 UTC (Kerzen 0–2):  Hoch 100 250, Tief 99 880, Mitte 100 065, Höhe 370, Ø-Volumen 166,67
 *   Kerze 3 (13:45): Docht bis 100 260, Schluss 100 240 – innerhalb der Range, löst nichts aus
 *   Kerze 4 (13:50): Schluss 100 380 über dem Hoch → Signal Long um 13:55 UTC (9:55 New Yorker Zeit) zu 100 380
 *   alles davor und danach: ruhiger Füller zwischen 100 030,5 und 100 170,5 (True Range je Kerze 60–100; mit einer Nachkommastelle,
 *   daher liest die App den Kursschritt 0,1 aus den Kerzen)
 *
 * Handrechnung des Plans (Stop Range-Mitte, Ziel 2R, Konto Scalp 5 000, Risiko 1 %, Gebühr/Slippage je 0,05 %):
 *   Stop 100 065 · Risiko 315 · Ziel 101 010 · 0,037 BTC (Positionsdeckel bindet) · Verlust am Stop 17,21 USDT.
 */
import type { Candle } from "../../../src/market/types";

export const PLAN_DAY = "2026-10-19";
export const PLAN_OPEN = Date.UTC(2026, 9, 19, 13, 30);
export const IV = 300_000;

export const PLAN_EXPECT = {
  rangeHigh: 100250,
  rangeLow: 99880,
  rangeMid: 100065,
  signalPrice: 100380,
  signalClose: PLAN_OPEN + 5 * IV, // 13:55 UTC
  stop: 100065,
  target: 101010,
  risk: 315,
  qty: 0.037,
  notional: 3714.06,
  maxLoss: 17.214435,
} as const;

/** open, high, low, close, volume of the explicit session candles (slot = 5-minute steps after 13:30 UTC) */
const SESSION: Record<number, [number, number, number, number, number]> = {
  0: [100000, 100200, 99900, 100100, 300],
  1: [100100, 100250, 99950, 100050, 100],
  2: [100050, 100220, 99880, 100150, 100],
  3: [100150, 100260, 100100, 100240, 100],
  4: [100240, 100400, 100230, 100380, 150],
};

function filler(t: number): [number, number, number, number, number] {
  const k = Math.floor(t / IV);
  const w = ((k * 7) % 9) - 4;
  const o = 100100.5 + w * 10;
  const c = 100100.5 + ((((k + 1) * 7) % 9) - 4) * 10;
  return [o, Math.max(o, c) + 30, Math.min(o, c) - 30, c, 100];
}

/** The candle that opens at `t` (ms, a multiple of 5 minutes). */
export function planCandle(t: number): [number, number, number, number, number] {
  const slot = (t - PLAN_OPEN) / IV;
  return SESSION[slot] ?? filler(t);
}

/** Candles whose open time lies in `[from, to]`, at most `limit`, ascending – what the exchange answers. */
export function planCandles(from: number, to: number, limit = 1500, now = Infinity): Candle[] {
  const out: Candle[] = [];
  for (let t = Math.ceil(from / IV) * IV; t <= to && out.length < limit; t += IV) {
    const [open, high, low, close, volume] = planCandle(t);
    out.push({ time: t, open, high, low, close, volume, closed: t + IV - 1 < now, closeTime: t + IV - 1 });
  }
  return out;
}

/** The same candles as Binance's `klines` rows (strings, like the real answer). */
export function planKlineRows(from: number, to: number, limit = 1500, now = Infinity): unknown[][] {
  return planCandles(from, to, limit, now).map((c) => [c.time, String(c.open), String(c.high), String(c.low), String(c.close), String(c.volume), c.closeTime, String(c.volume * c.close), 100, String(c.volume / 2), String((c.volume / 2) * c.close), "0"]);
}
