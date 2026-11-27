/**
 * Deterministische 5-Minuten-Kerzen für den Scanner „Wer bricht aus?“ (Unit- und e2e-Tests). Die Kerzen sind erfunden und stehen
 * ausdrücklich als TEST-Daten da – die App selbst zeigt nie etwas anderes als die Antwort der Börse. Je Markt ein Drehbuch rund um
 * den Beginn einer Sitzung (`openMs`), immer dieselben Zahlen:
 *
 *   Spanne (Kerzen 0–5, 30 Minuten):  Hoch = Preis × 1,0015 (Kerze 1), Tief = Preis × 0,9985 (Kerze 2)
 *   Ausbruch (Kerze 8, schließt 45 Minuten nach Beginn): Schluss = Preis × 1,0045 (Long) bzw. × 0,9955 (Short),
 *     also 0,30 % jenseits der Kante; ihr Volumen = `volume` × 100, alle anderen Kerzen 100 → Volumen-Faktor = `volume`
 *   Trend: vor der Sitzung läuft der Kurs 1 % in die Richtung des Ausbruchs (`with`: EMA 50 liegt passend) oder 3 % dagegen
 *     (`against`: der EMA 50 liegt noch auf der falschen Seite)
 *   `inside`: bleibt in der Spanne · `gap`: Kerze 2 der Spanne fehlt (die App sagt „Keine Kerzen“, sie rät nicht)
 *
 * Erwartete Noten bei „jetzt“ = Beginn + 2 Stunden: LTC A+ (Short, 4,0×), BNB A+ (Long, 2,5×), SUI A (Long, 1,6×), XRP B (Long, 1,0×
 * mit Trend), DOGE C (Long, 1,0× gegen den Trend); BTC, ETH, SOL, ADA, AVAX, LINK in der Spanne; TON ohne Kerzen.
 */
import type { Candle } from "../../../src/market/types";

export const IV = 300_000;
/** New Yorker Sitzung vom Dienstag 24.11.2026: 9:30 EST = 14:30 UTC. */
export const BREAKOUT_OPEN = Date.UTC(2026, 10, 24, 14, 30);
/** „Jetzt“ der Tests: zwei Stunden nach Beginn (16:30 UTC, 17:30 in Berlin). */
export const BREAKOUT_NOW = BREAKOUT_OPEN + 120 * 60_000 + 20_000;
export const BREAK_SLOT = 8;

export interface Scenario {
  price: number;
  kind: "long" | "short" | "inside" | "gap";
  volume?: number;
  trend?: "with" | "against";
}

export const BREAKOUT_SCENARIOS: Readonly<Record<string, Scenario>> = {
  BTCUSDT: { price: 76_000, kind: "inside" },
  ETHUSDT: { price: 2240, kind: "inside" },
  SOLUSDT: { price: 89.8, kind: "inside" },
  XRPUSDT: { price: 1.158, kind: "long", volume: 1, trend: "with" },
  BNBUSDT: { price: 698.9, kind: "long", volume: 2.5, trend: "with" },
  DOGEUSDT: { price: 0.0715, kind: "long", volume: 1, trend: "against" },
  ADAUSDT: { price: 0.181, kind: "inside" },
  AVAXUSDT: { price: 8.26, kind: "inside" },
  LINKUSDT: { price: 10.75, kind: "inside" },
  LTCUSDT: { price: 51.9, kind: "short", volume: 4, trend: "with" },
  SUIUSDT: { price: 0.8538, kind: "long", volume: 1.6, trend: "with" },
  TONUSDT: { price: 1.6, kind: "gap" },
};

export const BREAKOUT_EXPECT = {
  LTCUSDT: { grade: "A+", side: "short", volumeX: 4, level: 51.9 * 0.9985 },
  BNBUSDT: { grade: "A+", side: "long", volumeX: 2.5, level: 698.9 * 1.0015 },
  SUIUSDT: { grade: "A", side: "long", volumeX: 1.6, level: 0.8538 * 1.0015 },
  XRPUSDT: { grade: "B", side: "long", volumeX: 1, level: 1.158 * 1.0015 },
  DOGEUSDT: { grade: "C", side: "long", volumeX: 1, level: 0.0715 * 1.0015 },
} as const;

const wiggle = (k: number): number => ((((k * 7) % 9) - 4) / 4) * 0.0004;

/** Close of the candle in `slot` (5-minute steps after the open; negative = before the session). */
function closeAt(sc: Scenario, slot: number): number {
  const p = sc.price;
  const dir = sc.kind === "short" ? -1 : 1;
  if (slot < 0) {
    const breaks = sc.kind === "long" || sc.kind === "short";
    // `with`: the price came 1 % from the other side over 25 hours (the EMA trails behind it); `against`: it fell / rose 3 % against the
    // breakout within the last 5 hours, so the EMA 50 still stands on the wrong side when the range breaks
    const against = sc.trend === "against";
    const slope = !breaks ? 0 : against ? 0.03 * dir : -0.01 * dir;
    return p * (1 + slope * Math.min(1, -slot / (against ? 60 : 300))) * (1 + wiggle(slot + 10_000) * 0.5);
  }
  if (slot < BREAK_SLOT || sc.kind === "inside" || sc.kind === "gap") return p * (1 + wiggle(slot));
  if (slot === BREAK_SLOT) return p * (1 + dir * 0.0045);
  return p * (1 + dir * (0.0045 + Math.min(0.002, (slot - BREAK_SLOT) * 0.0001))) * (1 + wiggle(slot) * 0.5);
}

/** The candles of `symbol`: `bars` candles up to the one that is running at `now`. */
export function breakoutCandles(symbol: string, now: number = BREAKOUT_NOW, openMs: number = BREAKOUT_OPEN, bars = 499): Candle[] {
  const sc = BREAKOUT_SCENARIOS[symbol];
  if (!sc) return [];
  const lastOpen = Math.floor(now / IV) * IV;
  const out: Candle[] = [];
  for (let t = lastOpen - (bars - 1) * IV; t <= lastOpen; t += IV) {
    const slot = Math.round((t - openMs) / IV);
    if (sc.kind === "gap" && slot === 2) continue;
    const open = closeAt(sc, slot - 1);
    const close = closeAt(sc, slot);
    let high = Math.max(open, close) * 1.0002;
    let low = Math.min(open, close) * 0.9998;
    if (slot === 1) high = sc.price * 1.0015;
    if (slot === 2) low = sc.price * 0.9985;
    const breakBar = slot === BREAK_SLOT && (sc.kind === "long" || sc.kind === "short");
    out.push({ time: t, open, high, low, close, volume: breakBar ? 100 * (sc.volume ?? 1) : 100, closed: t + IV <= now, closeTime: t + IV - 1 });
  }
  return out;
}

const s = (x: number): string => String(Number(x.toPrecision(10)));

/** The same candles as Binance's `klines` rows (strings, like the real answer). */
export function breakoutKlineRows(symbol: string, now: number = BREAKOUT_NOW, limit = 499, openMs: number = BREAKOUT_OPEN): unknown[][] {
  return breakoutCandles(symbol, now, openMs, limit).map((c) => [c.time, s(c.open), s(c.high), s(c.low), s(c.close), s(c.volume), c.closeTime, s(c.volume * c.close), 100, s(c.volume / 2), s((c.volume / 2) * c.close), "0"]);
}

/** The same candles as Bybit's `kline` answer (newest first, strings). */
export function breakoutBybitBody(symbol: string, now: number = BREAKOUT_NOW, limit = 499, openMs: number = BREAKOUT_OPEN): unknown {
  const list = breakoutCandles(symbol, now, openMs, limit)
    .map((c) => [String(c.time), s(c.open), s(c.high), s(c.low), s(c.close), s(c.volume), s(c.volume * c.close)])
    .reverse();
  return { retCode: 0, retMsg: "OK", result: { category: "linear", symbol, list }, time: now };
}
