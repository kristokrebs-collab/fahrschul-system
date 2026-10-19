/**
 * F06 – the added building blocks (Donchian, ADX / DI, Stochastic, Keltner, Ichimoku, CCI, Williams %R, OBV, VWAP, Opening
 * Range, Inside Bar, Heikin-Ashi, pivot break, Fibonacci, Supertrend, Chandelier, funding) and the new modes of Bollinger /
 * MACD: series maths with HAND-COMPUTED values, each block on hand-built bars, parameter limits, the lock reasons, the
 * no-look-ahead guarantee on real BTCUSDT bars, and a plausibility check against TradingView's own indicator values.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Bar } from "@/domain/backtest/index";
import { BLOCKS, BLOCK_ORDER, defaultParams, makeCtx, sanitizeParams } from "@/domain/lab/rules/blocks";
import { bollingerSeries, macdSeries } from "@/domain/lab/rules/indicators";
import { atrRma, cciSeries, chandelierSeries, dmiSeries, fundingSeries, heikinAshi, ichimokuSeries, keltnerSeries, obvSeries, pivotLevels, stochSeries, supertrendSeries, trueRange, vwapSeries, williamsRSeries, windowExtreme } from "@/domain/lab/rules/series";
import { blockAvailability, FUNDING_LOCK, newGroup, newLeaf, validateCustom } from "@/domain/lab/rules/tree";
import { defaultCustom } from "@/domain/lab/rules/tree";
import { FALSE, TRUE, UNKNOWN, type BlockId, type CustomConfig, type LeafParams } from "@/domain/lab/rules/types";
import { DEFAULT_SIGNAL_CFG, rsi } from "@/domain/signals";
import { walk } from "./lab.helpers";

const H4: Bar[] = (JSON.parse(readFileSync("tests/unit/fixtures/binance-btcusdt-4h.json", "utf8")) as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));

const T0 = Date.UTC(2026, 0, 5) / 1000; // a Monday 00:00 UTC
const mk = (i: number, o: number, h: number, l: number, c: number, v?: number, sec = 3600): Bar => ({ t: T0 + i * sec, o, h, l, c, ...(v !== undefined ? { v } : {}) });
/** bars with high/low ±0.5 around the close */
const closes = (cs: number[], sec = 3600): Bar[] => cs.map((c, i) => mk(i, c, c + 0.5, c - 0.5, c, undefined, sec));

const evalBlock = (id: BlockId, bars: readonly Bar[], over: LeafParams = {}, extra: { tfSec?: number; funding?: { t: number; rate: number }[] | null } = {}): Uint8Array => {
  const p = sanitizeParams(id, { ...defaultParams(id), ...over });
  const r = BLOCKS[id].eval(makeCtx(bars, DEFAULT_SIGNAL_CFG, null, extra), p);
  return r instanceof Uint8Array ? r : r.result();
};
const arr = (a: Uint8Array): number[] => Array.from(a);

describe("Reihen von Hand gerechnet", () => {
  it("windowExtreme: Maximum / Minimum über genau N Kerzen, davor NaN", () => {
    expect(windowExtreme([1, 3, 2, 5, 4], 3, true)).toEqual([NaN, NaN, 3, 5, 5]);
    expect(windowExtreme([1, 3, 2, 5, 4], 3, false)).toEqual([NaN, NaN, 1, 2, 2]);
  });

  it("trueRange: erste Kerze Hoch − Tief, danach das Maximum der drei Abstände", () => {
    const b = [mk(0, 10, 12, 9, 11), mk(1, 11, 14, 12, 13), mk(2, 13, 13.5, 10, 11)];
    expect(trueRange(b)).toEqual([3, 3, 3.5]); // 14 − 11 = 3 (Lücke nach oben); 13.5 − 10 = 3.5
  });

  it("ADX / DI in einem sauberen Aufwärtstrend: +DI = 50, −DI = 0, ADX = 100", () => {
    const b = Array.from({ length: 40 }, (_, i) => mk(i, i + 0.5, i + 2, i, i + 1)); // TR = 2, +DM = 1, −DM = 0
    const d = dmiSeries(b, 5, 5);
    expect(d.plus[39]).toBeCloseTo(50, 9);
    expect(d.minus[39]).toBeCloseTo(0, 9);
    expect(d.adx[39]).toBeCloseTo(100, 9);
    expect(Number.isNaN(d.adx[5])).toBe(true); // ADX braucht DI-Länge + Glättung
  });

  it("Stochastic: %K = 100 × (Schluss − Tief) / (Hoch − Tief) über N Kerzen", () => {
    const b = [mk(0, 9, 10, 8, 9), mk(1, 9, 12, 9, 11), mk(2, 11, 11, 9, 10), mk(3, 10, 13, 10, 12.5)];
    const s = stochSeries(b, 3, 1, 1);
    expect(s.k[2]).toBeCloseTo(50, 9); // (10 − 8) / (12 − 8)
    expect(s.k[3]).toBeCloseTo(87.5, 9); // (12,5 − 9) / (13 − 9)
    const smooth = stochSeries(b, 3, 2, 2);
    expect(smooth.k[3]).toBeCloseTo((50 + 87.5) / 2, 9);
  });

  it("CCI: (typischer Preis − Mittel) / (0,015 × mittlere Abweichung)", () => {
    const b = [1, 2, 6].map((x, i) => mk(i, x, x, x, x)); // hlc3 = 1, 2, 6 → Mittel 3, Abweichung (2 + 1 + 3) / 3 = 2
    expect(cciSeries(b, 3)[2]).toBeCloseTo((6 - 3) / (0.015 * 2), 9); // = 100
  });

  it("Williams %R: −100 × (Hoch − Schluss) / (Hoch − Tief)", () => {
    const b = [mk(0, 9, 10, 8, 9), mk(1, 9, 12, 9, 11), mk(2, 11, 11, 9, 10)];
    expect(williamsRSeries(b, 3)[2]).toBeCloseTo(-50, 9); // (10 − 12) / (12 − 8) × 100
  });

  it("OBV: ±Volumen je nach Richtung des Schlusses, gleich = unverändert", () => {
    const b = [10, 11, 10, 10, 12].map((c, i) => mk(i, c, c, c, c, [5, 3, 2, 4, 1][i]));
    expect(obvSeries(b)).toEqual([0, 3, 1, 1, 2]);
  });

  it("VWAP: Volumen-gewichteter typischer Preis, Neustart beim Wechsel des Ankers, ohne Volumen NaN", () => {
    const b = [mk(0, 10, 10, 10, 10, 1), mk(1, 20, 20, 20, 20, 3), mk(24, 30, 30, 30, 30, 2)];
    const v = vwapSeries(b, (t) => Math.floor(t / 86_400));
    expect(v[0]).toBe(10);
    expect(v[1]).toBeCloseTo((10 + 60) / 4, 12);
    expect(v[2]).toBe(30); // neuer Tag
    expect(Number.isNaN(vwapSeries([mk(0, 1, 1, 1, 1)], (t) => t)[0])).toBe(true);
  });

  it("Heikin-Ashi: erste Kerze und die Folgekerze von Hand", () => {
    const ha = heikinAshi([mk(0, 10, 14, 8, 12), mk(1, 12, 16, 11, 15)]);
    expect(ha.c[0]).toBe(11); // (10 + 14 + 8 + 12) / 4
    expect(ha.o[0]).toBe(11); // (10 + 12) / 2
    expect(ha.c[1]).toBe(13.5); // (12 + 16 + 11 + 15) / 4
    expect(ha.o[1]).toBe(11); // (11 + 11) / 2
    expect(ha.h[1]).toBe(16);
    expect(ha.l[1]).toBe(11); // kein unterer Docht
  });

  it("Pivots: erst nach den rechten Kerzen bestätigt, nie rückwirkend", () => {
    const b = [1, 3, 2, 5, 4].map((h, i) => mk(i, h - 0.3, h, h - 0.5, h - 0.2));
    const pv = pivotLevels(b, 1, 1);
    expect(pv.hi.map((x) => (Number.isNaN(x) ? null : x))).toEqual([null, null, 3, 3, 5]);
    expect(pv.hiAt.map((x) => (Number.isNaN(x) ? null : x))).toEqual([null, null, 1, 1, 3]);
    expect(pv.lo[3]).toBe(1.5); // Tief der Kerze 2, bestätigt in Kerze 3
    expect(Number.isNaN(pv.lo[2]!)).toBe(true);
  });

  it("Funding: der Wert gilt ab der Zahlung, Mittel über N Zahlungen, davor NaN", () => {
    const H = 3600;
    const pts = [
      { t: 0, rate: 0.0001 },
      { t: 8 * H * 1000, rate: 0.0003 },
      { t: 16 * H * 1000, rate: -0.0002 },
    ];
    const bars: Bar[] = Array.from({ length: 18 }, (_, i) => ({ t: i * H, o: 1, h: 1, l: 1, c: 1 }));
    const one = fundingSeries(bars, H, pts, 1);
    expect(one[6]).toBeCloseTo(0.01, 12); // Kerze 6 schließt um 07:00 – erst die erste Zahlung bekannt
    expect(one[7]).toBeCloseTo(0.03, 12); // schließt um 08:00 = Zahlungszeit
    expect(one[17]).toBeCloseTo(-0.02, 12);
    const two = fundingSeries(bars, H, pts, 2);
    expect(Number.isNaN(two[6]!)).toBe(true);
    expect(two[7]).toBeCloseTo(0.02, 12);
  });

  it("Ichimoku: die Wolke in Kerze i sind die Werte von vor 25 Kerzen (Verschiebung 26 wie bei TradingView)", () => {
    const b = walk(120, 3600, 3);
    const ic = ichimokuSeries(b, 9, 26, 52, 26);
    const mid = (end: number, len: number): number => (Math.max(...b.slice(end - len + 1, end + 1).map((x) => x.h)) + Math.min(...b.slice(end - len + 1, end + 1).map((x) => x.l))) / 2;
    const i = 100;
    const j = i - 25;
    expect(ic.cloudA[i]).toBeCloseTo((mid(j, 9) + mid(j, 26)) / 2, 9);
    expect(ic.cloudB[i]).toBeCloseTo(mid(j, 52), 9);
    expect(ic.tenkan[i]).toBeCloseTo(mid(i, 9), 9);
    expect(Number.isNaN(ic.cloudA[49]!)).toBe(true); // Kijun gilt ab Kerze 25, dazu 25 Kerzen Verschiebung
    expect(Number.isFinite(ic.cloudA[50]!)).toBe(true);
    expect(Number.isNaN(ic.cloudB[75]!)).toBe(true); // Senkou B gilt ab Kerze 51, dazu 25
    expect(Number.isFinite(ic.cloudB[76]!)).toBe(true);
  });

  it("Supertrend: Aufwärtstrend unter dem Kurs, Wechsel nach einem Einbruch; Chandelier genauso", () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
    const down = Array.from({ length: 40 }, (_, i) => 218 - i * 4);
    const b = closes([...up, ...down]);
    const st = supertrendSeries(b, 10, 3);
    expect(st.dir[59]).toBe(1);
    expect(st.line[59]!).toBeLessThan(b[59]!.c);
    expect(st.dir[99]).toBe(-1);
    expect(st.line[99]!).toBeGreaterThan(b[99]!.c);
    expect(Number.isNaN(st.dir[5]!)).toBe(true); // vor der ATR
    const ch = chandelierSeries(b, 22, 3);
    expect(ch.dir[59]).toBe(1);
    expect(ch.longStop[59]!).toBeLessThan(b[59]!.c);
    expect(ch.dir[99]).toBe(-1);
    // der Long-Stopp steigt nur, solange der Schluss darüber bleibt
    for (let i = 40; i < 59; i++) expect(ch.longStop[i + 1]!).toBeGreaterThanOrEqual(ch.longStop[i]!);
  });

  it("Keltner: Mitte ± Faktor × ATR", () => {
    const b = walk(80, 3600, 5);
    const kc = keltnerSeries(b, 20, 10, 2);
    const a = atrRma(b, 10);
    expect(kc.upper[60]! - kc.mid[60]!).toBeCloseTo(2 * a[60]!, 9);
    expect(kc.mid[60]! - kc.lower[60]!).toBeCloseTo(2 * a[60]!, 9);
  });
});

describe("Bausteine auf handgebauten Kerzen", () => {
  it("Donchian: Ausbruch über das Hoch der N Kerzen davor – nicht das eigene; davor unbekannt", () => {
    const b = closes([10, 10, 10, 10, 12]);
    expect(arr(evalBlock("donchian", b, { len: 3, mode: "breakUp", basis: "close" }))).toEqual([UNKNOWN, UNKNOWN, UNKNOWN, FALSE, TRUE]);
    // mit dem Hoch statt dem Schluss: Kerze 3 hat Hoch 10,5, das Hoch der 3 davor ist ebenfalls 10,5 → kein Ausbruch
    const wick = [...b.slice(0, 4), mk(4, 10, 10.7, 9.5, 10.2)];
    expect(evalBlock("donchian", wick, { len: 3, mode: "breakUp", basis: "wick" })[4]).toBe(TRUE);
    expect(evalBlock("donchian", wick, { len: 3, mode: "breakUp", basis: "close" })[4]).toBe(FALSE);
    expect(evalBlock("donchian", closes([10, 10, 10, 10, 8]), { len: 3, mode: "breakDown" })[4]).toBe(TRUE);
    expect(evalBlock("donchian", closes([10, 12, 10, 10, 11.6]), { len: 4, mode: "aboveMid" })[4]).toBe(TRUE); // Mitte = (12,5 + 9,5) / 2 = 11
  });

  it("Inside Bar: Mutterkerze, Inside Bar, Schluss über dem Hoch der Mutter", () => {
    const b = [mk(0, 10, 12, 8, 11), mk(1, 10, 11, 9, 10), mk(2, 10, 13, 10, 12.5), mk(3, 12, 12.6, 11, 11)];
    expect(arr(evalBlock("insideBar", b, { mode: "breakUp" }))).toEqual([UNKNOWN, UNKNOWN, TRUE, FALSE]);
    expect(arr(evalBlock("insideBar", b, { mode: "breakDown" }))).toEqual([UNKNOWN, UNKNOWN, FALSE, FALSE]);
    expect(arr(evalBlock("insideBar", b, { mode: "inside" }))).toEqual([UNKNOWN, TRUE, FALSE, TRUE]); // Kerze 3 liegt in Kerze 2
    expect(evalBlock("insideBar", b, { mode: "breakUp", within: 2 })[3]).toBe(TRUE); // innerhalb der letzten 2 Kerzen
  });

  it("ADX: Trendstärke und +DI über −DI im sauberen Aufwärtstrend; im Abwärtstrend Trend nach unten", () => {
    const up = Array.from({ length: 60 }, (_, i) => mk(i, i + 0.5, i + 2, i, i + 1));
    expect(evalBlock("adx", up, { mode: "trendUp", level: 25 })[59]).toBe(TRUE);
    expect(evalBlock("adx", up, { mode: "trendDown", level: 25 })[59]).toBe(FALSE);
    expect(evalBlock("adx", up, { mode: "adxBelow", level: 25 })[59]).toBe(FALSE);
    expect(evalBlock("adx", up, { mode: "adxAbove", level: 25 })[5]).toBe(UNKNOWN);
    const down = Array.from({ length: 60 }, (_, i) => mk(i, 100 - i, 100 - i + 0.5, 98 - i, 99 - i));
    expect(evalBlock("adx", down, { mode: "trendDown", level: 25 })[59]).toBe(TRUE);
  });

  it("Stochastic: %K kreuzt %D nach oben – mit Extrembereich nur, wenn beide vorher darunter lagen", () => {
    // fällt tief, dreht nach oben
    const cs = [...Array.from({ length: 30 }, (_, i) => 100 - i), 71, 72, 74, 78, 83];
    const b = closes(cs);
    const free = evalBlock("stoch", b, { mode: "kdUp", zone: "any", within: 1 });
    const hits = arr(free).flatMap((v, i) => (v === TRUE ? [i] : []));
    expect(hits.length).toBeGreaterThan(0);
    const extreme = evalBlock("stoch", b, { mode: "kdUp", zone: "extreme", level: 20 });
    expect(arr(extreme).filter((v) => v === TRUE).length).toBeGreaterThan(0);
    // ein Kreuz bei hohen Werten fällt im Extrembereich durch
    const high = closes([...Array.from({ length: 30 }, (_, i) => 50 + i), 79, 78, 77, 79.5, 80, 81]);
    const hf = arr(evalBlock("stoch", high, { mode: "kdUp", zone: "any" }));
    const he = arr(evalBlock("stoch", high, { mode: "kdUp", zone: "extreme", level: 20 }));
    expect(hf.some((v, i) => v === TRUE && he[i] === FALSE)).toBe(true);
    expect(arr(evalBlock("stoch", b, { mode: "below", level: 20 })).slice(28, 34)).toContain(TRUE);
  });

  it("CCI / Williams %R: Kreuzung des Niveaus nach oben nach einem Einbruch", () => {
    const cs = [...Array.from({ length: 30 }, (_, i) => 100 + (i % 3)), 80, 79, 85, 95, 100];
    const b = closes(cs);
    expect(arr(evalBlock("cci", b, { mode: "below", level: -100 })).slice(30, 33)).toContain(TRUE);
    const cross = arr(evalBlock("cci", b, { mode: "crossUp", level: -100, within: 1 }));
    expect(cross.some((v) => v === TRUE)).toBe(true);
    const w = arr(evalBlock("willr", b, { mode: "crossUp", level: -80 }));
    expect(w.some((v) => v === TRUE)).toBe(true);
    expect(evalBlock("willr", b, { mode: "below", level: -80 })[5]).toBe(UNKNOWN);
  });

  it("OBV: braucht Volumen – ohne bleibt es unbekannt; mit Volumen steigt OBV über seinen Durchschnitt", () => {
    const noVol = closes(Array.from({ length: 40 }, (_, i) => 100 + i));
    expect(new Set(arr(evalBlock("obv", noVol, { mode: "above" })))).toEqual(new Set([UNKNOWN]));
    const withVol = noVol.map((b) => ({ ...b, v: 10 }));
    expect(evalBlock("obv", withVol, { mode: "above", len: 5 })[39]).toBe(TRUE);
    expect(evalBlock("obv", withVol, { mode: "newHigh", n: 10 })[39]).toBe(TRUE);
    expect(evalBlock("obv", withVol, { mode: "below", len: 5 })[39]).toBe(FALSE);
  });

  it("VWAP: Abstand unter dem Tages-VWAP; Session-VWAP auf großen Kerzen ist unbekannt mit Grund", () => {
    const b = [mk(0, 100, 100, 100, 100, 10), mk(1, 100, 100, 100, 100, 10), mk(2, 97, 97, 97, 97, 1)];
    // VWAP nach 3 Kerzen = (100·10 + 100·10 + 97·1) / 21 = 99,857…; 97 liegt 2,86 % darunter
    expect(evalBlock("vwap", b, { anchor: "day", mode: "belowBy", dist: 2 })[2]).toBe(TRUE);
    expect(evalBlock("vwap", b, { anchor: "day", mode: "belowBy", dist: 3 })[2]).toBe(FALSE);
    expect(evalBlock("vwap", b, { anchor: "day", mode: "below" })[2]).toBe(TRUE);
    expect(BLOCKS.vwap.check?.({ ...defaultParams("vwap"), anchor: "session" }, 14_400)).toMatch(/höchstens 1h/);
    expect(BLOCKS.vwap.check?.({ ...defaultParams("vwap"), anchor: "session" }, 3600)).toBeNull();
    const four = Array.from({ length: 6 }, (_, i) => mk(i, 1, 1, 1, 1, 1, 14_400));
    expect(new Set(arr(evalBlock("vwap", four, { anchor: "session", mode: "above" }, { tfSec: 14_400 })))).toEqual(new Set([UNKNOWN]));
  });

  it("Opening Range: erster Schluss über der Spanne in der Gültigkeit; davor / danach falsch; Spanne passt zur Kerze", () => {
    // London 07:00 UTC, 60 Minuten, 1h-Kerzen, ein Tag ab 05:00
    const base = Date.UTC(2026, 0, 5, 5) / 1000;
    const hb = (h: number, hi: number, lo: number, c: number, o = c): Bar => ({ t: base + (h - 5) * 3600, o, h: hi, l: lo, c });
    const day = [hb(5, 100, 95, 98), hb(6, 100, 96, 99), hb(7, 110, 100, 105), hb(8, 112, 104, 111), hb(9, 113, 108, 112), hb(10, 109, 100, 103), hb(11, 115, 104, 114), hb(12, 118, 110, 117), hb(13, 120, 112, 119)];
    const p = { session: "london", minutes: 60, validHours: 4, mode: "up" };
    expect(arr(evalBlock("orb", day, { ...p, first: "first" }, { tfSec: 3600 }))).toEqual([FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE]);
    // jede Kerze: 08 (111), 09 (112) und 11 (114) schließen über 110; 12:00 liegt hinter dem Fenster (08 + 4 h)
    expect(arr(evalBlock("orb", day, { ...p, first: "all" }, { tfSec: 3600 }))).toEqual([FALSE, FALSE, FALSE, TRUE, TRUE, FALSE, TRUE, FALSE, FALSE]);
    expect(arr(evalBlock("orb", day, { ...p, mode: "down" }, { tfSec: 3600 })).filter((v) => v === TRUE)).toHaveLength(0);
    expect(BLOCKS.orb.check?.({ ...defaultParams("orb"), minutes: 15 }, 3600)).toMatch(/passt nicht/);
    expect(BLOCKS.orb.check?.({ ...defaultParams("orb"), minutes: 60 }, 900)).toBeNull();
    // unvollständige Spanne (die Kerze 07:00 fehlt): unbekannt statt eines erfundenen Ausbruchs
    const hole = day.filter((_, i) => i !== 2);
    expect(evalBlock("orb", hole, { ...p }, { tfSec: 3600 })[2]).toBe(UNKNOWN);
  });

  it("Heikin-Ashi: grüne Kerzen in Folge im Aufwärtstrend, Farbwechsel nach einer Wende", () => {
    const up = closes(Array.from({ length: 40 }, (_, i) => 100 + i * 2));
    expect(evalBlock("heikin", up, { mode: "bull", n: 3 })[39]).toBe(TRUE);
    expect(evalBlock("heikin", up, { mode: "bear", n: 3 })[39]).toBe(FALSE);
    expect(evalBlock("heikin", up, { mode: "bull", n: 3 })[10]).toBe(UNKNOWN);
    expect(evalBlock("heikin", up, { mode: "strongBull", n: 3 })[39]).toBe(TRUE);
    const turn = closes([...Array.from({ length: 30 }, (_, i) => 200 - i * 2), ...Array.from({ length: 12 }, (_, i) => 142 + i * 4)]);
    const ha = heikinAshi(turn);
    const firstGreen = ha.c.findIndex((c, i) => i > 30 && c > ha.o[i]!);
    const flips = arr(evalBlock("heikin", turn, { mode: "flipUp", within: 1 })).flatMap((v, i) => (v === TRUE ? [i] : []));
    expect(flips).toEqual([firstGreen]);
  });

  it("Pivot-Bruch: erster Schluss über dem bestätigten Pivot-Hoch; vor der Bestätigung unbekannt", () => {
    const b = closes([10, 12, 11, 10.5, 11, 13]);
    // Pivot-Hoch Kerze 1 (12,5), bestätigt in Kerze 2 (links 1, rechts 1)
    const r = arr(evalBlock("pivotBreak", b, { mode: "up", left: 1, right: 1 }));
    expect(r[0]).toBe(UNKNOWN);
    expect(r[1]).toBe(UNKNOWN);
    expect(r.slice(2, 5)).toEqual([FALSE, FALSE, FALSE]);
    expect(r[5]).toBe(TRUE);
  });

  it("Fibonacci Golden Pocket: Schluss in der Zone 0,618–0,65 des letzten Aufwärts-Swings", () => {
    const cs = [100, 98, 95, 92, 90, 93, 96, 100, 104, 108, 110, 108, 105, 102, 100, 98, 97.4, 97.4, 95];
    const b = closes(cs);
    const r = arr(evalBlock("fib", b, { dir: "long", len: 2, from: 0.618, to: 0.65, basis: "close" }));
    // Swing: Tief 89,5 (Kerze 4), Hoch 110,5 (Kerze 10) → Zone [110,5 − 0,65 × 21 ; 110,5 − 0,618 × 21] = [96,85 ; 97,522]
    expect(r[16]).toBe(TRUE);
    expect(r[17]).toBe(TRUE);
    expect(r[13]).toBe(FALSE);
    expect(r[18]).toBe(FALSE); // 95 liegt unterhalb der Zone
    expect(r[2]).toBe(UNKNOWN); // noch kein Swing bestätigt
    expect(arr(evalBlock("fib", b, { dir: "short", len: 2, basis: "close" }))[16]).toBe(FALSE); // der letzte Swing geht nach oben
    expect(sanitizeParams("fib", { from: 0.7, to: 0.5 })).toMatchObject({ from: 0.5, to: 0.7 });
  });

  it("Supertrend / Chandelier: Wechsel auf Aufwärtstrend genau einmal nach der Wende", () => {
    const cs = [...Array.from({ length: 50 }, (_, i) => 200 - i * 2), ...Array.from({ length: 30 }, (_, i) => 102 + i * 3)];
    const b = closes(cs);
    for (const id of ["supertrend", "chandelier"] as const) {
      const flips = arr(evalBlock(id, b, { mode: "flipUp", within: 1 })).flatMap((v, i) => (v === TRUE ? [i] : []));
      expect(flips, id).toHaveLength(1);
      expect(flips[0]!, id).toBeGreaterThan(50);
      expect(evalBlock(id, b, { mode: "up" })[79], id).toBe(TRUE);
      expect(evalBlock(id, b, { mode: "down" })[49], id).toBe(TRUE);
      expect(evalBlock(id, b, { mode: "up" })[3], id).toBe(UNKNOWN);
    }
  });

  it("Ichimoku: Wolkenausbruch nach oben, Lage zur Wolke und Wolkenfarbe", () => {
    const cs = [...Array.from({ length: 90 }, (_, i) => 200 - i * 0.5), ...Array.from({ length: 40 }, (_, i) => 155 + i * 3)];
    const b = closes(cs);
    const brk = arr(evalBlock("ichimoku", b, { mode: "breakUp", within: 1 }));
    expect(brk.filter((v) => v === TRUE)).toHaveLength(1);
    const at = brk.indexOf(TRUE);
    expect(evalBlock("ichimoku", b, { mode: "aboveCloud" })[at]).toBe(TRUE);
    expect(evalBlock("ichimoku", b, { mode: "belowCloud" })[at - 1]).not.toBe(TRUE);
    expect(evalBlock("ichimoku", b, { mode: "aboveCloud" })[30]).toBe(UNKNOWN);
    expect(evalBlock("ichimoku", b, { mode: "redCloud" })[89]).toBe(TRUE);
  });

  it("Keltner / Bollinger: Rückkehr in den Kanal und Squeeze mit Fenster", () => {
    const cs = [...Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i) * 0.3), 90, 100.2, 100.1];
    const b = closes(cs);
    const kc = arr(evalBlock("keltner", b, { mode: "backInLower", len: 20, atrLen: 10, mult: 2 }));
    expect(kc[81]).toBe(TRUE);
    expect(kc[80]).toBe(FALSE);
    const bb = arr(evalBlock("bollinger", b, { mode: "backInLower", len: 20, mult: 2 }));
    expect(bb[81]).toBe(TRUE);
    expect(bb[80]).toBe(FALSE);
    const mid = arr(evalBlock("bollinger", b, { mode: "midUp", len: 20, mult: 2 }));
    expect(mid.some((v) => v === TRUE)).toBe(true);
    // Squeeze: ruhige Phase, dann Ausbruch – der enge Zustand zählt noch 5 Kerzen danach
    const quiet = closes([...Array.from({ length: 150 }, (_, i) => 100 + ((i * 37) % 11) - (i % 3) * 3), ...Array.from({ length: 30 }, (_, i) => 100 + (i % 2) * 0.2)]);
    const s1 = arr(evalBlock("bollinger", quiet, { mode: "squeeze", lookback: 120, pct: 20, within: 1 }));
    const s5 = arr(evalBlock("bollinger", quiet, { mode: "squeeze", lookback: 120, pct: 20, within: 5 }));
    for (let i = 0; i < s1.length; i++) if (s1[i] === TRUE) expect(s5[i]).toBe(TRUE);
    const squeezeKc = arr(evalBlock("keltner", quiet, { mode: "squeeze", len: 20, atrLen: 20, mult: 1.5 }));
    expect(squeezeKc.some((v) => v === TRUE)).toBe(true);
  });

  it("MACD-Histogramm: positiv / steigend nach einer Drehung nach oben", () => {
    const cs = [...Array.from({ length: 110 }, (_, i) => 300 - i), ...Array.from({ length: 20 }, (_, i) => 190 + i * 2)];
    const b = closes(cs);
    const m = macdSeries(cs, 12, 26, 9);
    const rising = arr(evalBlock("macd", b, { mode: "histRising" }));
    const falling = arr(evalBlock("macd", b, { mode: "histFalling" }));
    for (const i of [100, 114, 120, 129]) {
      expect(rising[i], `steigend ${i}`).toBe(m.hist[i]! > m.hist[i - 1]! ? TRUE : FALSE);
      expect(falling[i], `fallend ${i}`).toBe(m.hist[i]! < m.hist[i - 1]! ? TRUE : FALSE);
    }
    expect(rising[114]).toBe(TRUE); // kurz nach der Wende nimmt das Momentum zu
    expect(evalBlock("macd", b, { mode: "histNeg" })[109]).toBe(TRUE);
    expect(evalBlock("macd", b, { mode: "histPos" })[129]).toBe(m.hist[129]! > 0 ? TRUE : FALSE);
    expect(evalBlock("macd", b, { mode: "histRising" })[40]).toBe(UNKNOWN);
  });
});

describe("Funding-Extrem: nur mit der Funding-Historie des Laufs", () => {
  const b = Array.from({ length: 30 }, (_, i) => mk(i, 1, 1, 1, 1));
  const pts = Array.from({ length: 4 }, (_, k) => ({ t: (T0 + k * 8 * 3600) * 1000, rate: k === 2 ? -0.0004 : 0.0001 }));
  it("ohne Historie bleibt jeder Wert unbekannt (nie wahr)", () => {
    expect(new Set(arr(evalBlock("funding", b, { mode: "below" }, { tfSec: 3600 })))).toEqual(new Set([UNKNOWN]));
    expect(new Set(arr(evalBlock("funding", b, { mode: "below" }, { tfSec: 3600, funding: [] })))).toEqual(new Set([UNKNOWN]));
  });
  it("mit Historie: unter dem Niveau ab der Zahlung, die es auslöst", () => {
    const r = arr(evalBlock("funding", b, { mode: "below", level: -0.02 }, { tfSec: 3600, funding: pts }));
    expect(r[14]).toBe(FALSE); // schließt 15:00 – bekannt 0,01 %
    expect(r[15]).toBe(TRUE); // schließt 16:00 = Zahlung −0,04 %
    expect(r[23]).toBe(FALSE); // schließt 24:00 – 0,01 %
    expect(evalBlock("funding", b, { mode: "above", level: 0.005 }, { tfSec: 3600, funding: pts })[14]).toBe(TRUE);
  });
  it("gesperrt mit Grund, wenn der Lauf keine Historie lädt – und nur dann geprüft", () => {
    expect(blockAvailability("funding", "4h", { funding: false })).toEqual({ ok: false, reason: FUNDING_LOCK });
    expect(blockAvailability("funding", "4h", { funding: true }).ok).toBe(true);
    expect(blockAvailability("funding", "4h").ok).toBe(true);
    const cfg: CustomConfig = { ...defaultCustom(), long: newGroup("g1", "and", [newLeaf("n1", "funding")]) };
    expect(validateCustom(cfg, { funding: false }).some((i) => i.level === "error" && /Funding-Historie/.test(i.text))).toBe(true);
    expect(validateCustom(cfg, { funding: true }).some((i) => i.level === "error")).toBe(false);
    expect(validateCustom(cfg).some((i) => i.level === "error")).toBe(false);
  });
  it("Parameter-Prüfung des Bausteins steht in der Validierung (Opening Range passt nicht zur Kerzenlänge)", () => {
    const leaf = { ...newLeaf("n1", "orb"), params: { ...defaultParams("orb"), minutes: 15 } };
    const cfg: CustomConfig = { ...defaultCustom(), interval: "1h", long: newGroup("g1", "and", [leaf]) };
    expect(validateCustom(cfg).some((i) => i.level === "error" && i.node === "n1" && /passt nicht/.test(i.text))).toBe(true);
  });
});

describe("Parameter: Grenzen und Spiegelung", () => {
  it("klemmt jede Zahl in ihren Bereich und stellt Abhängigkeiten her", () => {
    expect(sanitizeParams("adx", { len: 1, smooth: 999, level: 100 })).toMatchObject({ len: 2, smooth: 100, level: 60 });
    expect(sanitizeParams("stoch", { kLen: 1, kSmooth: 0, dSmooth: 99 })).toMatchObject({ kLen: 3, kSmooth: 1, dSmooth: 20 });
    expect(sanitizeParams("orb", { minutes: 1, validHours: 99 })).toMatchObject({ minutes: 5, validHours: 12 });
    expect(sanitizeParams("ichimoku", { conv: 40, base: 26, spanB: 20 })).toMatchObject({ conv: 25, base: 26, spanB: 27 });
    expect(sanitizeParams("funding", { level: 9, avgN: 99 })).toMatchObject({ level: 1, avgN: 9 });
    expect(sanitizeParams("supertrend", { atrLen: 0, factor: 99 })).toMatchObject({ atrLen: 2, factor: 10 });
  });

  it("jeder neue Baustein: Standard gültig, Spiegelung gültig und Klartext vorhanden", () => {
    const NEW: BlockId[] = ["donchian", "adx", "stoch", "keltner", "ichimoku", "cci", "willr", "obv", "vwap", "orb", "insideBar", "heikin", "pivotBreak", "fib", "funding", "supertrend", "chandelier"];
    for (const id of NEW) {
      expect(BLOCK_ORDER).toContain(id);
      const d = defaultParams(id);
      expect(sanitizeParams(id, d)).toEqual(d);
      const m = BLOCKS[id].mirror(d);
      expect(sanitizeParams(id, m)).toEqual(m);
      expect(BLOCKS[id].text(d)).toMatch(/\S{3}/);
      expect(BLOCKS[id].label).toMatch(/[A-Za-zÄÖÜäöü]/);
      for (const o of BLOCKS[id].params.filter((p) => p.kind === "select")) for (const opt of o.options!) {
        const p = sanitizeParams(id, { ...d, [o.key]: opt.v });
        expect(p[o.key]).toBe(opt.v);
        expect(BLOCKS[id].text(p)).not.toMatch(/undefined|NaN/);
        expect(sanitizeParams(id, BLOCKS[id].mirror(p))).toEqual(BLOCKS[id].mirror(p));
      }
    }
  });

  it("Spiegelung kehrt Richtung und Niveau um", () => {
    expect(BLOCKS.stoch.mirror({ ...defaultParams("stoch"), mode: "below", level: 20 })).toMatchObject({ mode: "above", level: 80 });
    expect(BLOCKS.willr.mirror({ ...defaultParams("willr"), mode: "below", level: -80 })).toMatchObject({ mode: "above", level: -20 });
    expect(BLOCKS.cci.mirror({ ...defaultParams("cci"), level: -100 })).toMatchObject({ level: 100 });
    expect(BLOCKS.funding.mirror({ ...defaultParams("funding"), mode: "below", level: -0.02 })).toMatchObject({ mode: "above", level: 0.02 });
    expect(BLOCKS.fib.mirror({ ...defaultParams("fib"), dir: "long" })).toMatchObject({ dir: "short" });
  });
});

describe("Kein Blick in die Zukunft (echte BTCUSDT-4h-Kerzen und Zufallsgang mit Volumen)", () => {
  const CUTS = [300, 600, 950, 1300, 1499];
  const CASES: [BlockId, LeafParams][] = [
    ["donchian", { mode: "breakUp", len: 30, basis: "wick", within: 2 }],
    ["donchian", { mode: "aboveMid", len: 40 }],
    ["adx", { mode: "trendUp" }],
    ["adx", { mode: "diDown", within: 3 }],
    ["stoch", { mode: "kdUp", zone: "extreme", within: 3 }],
    ["keltner", { mode: "closeAbove" }],
    ["keltner", { mode: "squeeze", within: 4 }],
    ["ichimoku", { mode: "breakUp", within: 3 }],
    ["ichimoku", { mode: "tkUp", within: 3 }],
    ["cci", { mode: "crossUp", within: 2 }],
    ["willr", { mode: "crossUp", within: 2 }],
    ["insideBar", { mode: "breakUp", within: 2 }],
    ["heikin", { mode: "flipUp", within: 2 }],
    ["heikin", { mode: "bull", n: 4 }],
    ["pivotBreak", { mode: "up", within: 3 }],
    ["fib", { dir: "long", basis: "touch" }],
    ["fib", { dir: "short" }],
    ["supertrend", { mode: "flipUp", within: 3 }],
    ["chandelier", { mode: "flipDown", within: 3 }],
    ["bollinger", { mode: "backInLower", within: 2 }],
    ["bollinger", { mode: "squeeze", within: 5, lookback: 60 }],
    ["macd", { mode: "histRising" }],
  ];
  for (const [id, p] of CASES) {
    it(`${id} ${String(p.mode ?? p.dir)}: der Wert in Kerze i ist mit der bis i abgeschnittenen Historie derselbe`, () => {
      const full = evalBlock(id, H4, p, { tfSec: 14_400 });
      for (const i of CUTS) {
        const cut = evalBlock(id, H4.slice(0, i + 1), p, { tfSec: 14_400 });
        expect(cut[i]).toBe(full[i]);
        expect(cut[i - 9]).toBe(full[i - 9]);
        expect(cut[i - 61]).toBe(full[i - 61]);
      }
    }, 60_000);
  }

  const W = walk(1500, 3600, 11);
  const VOL: [BlockId, LeafParams][] = [
    ["obv", { mode: "crossUp", within: 2 }],
    ["obv", { mode: "newHigh", n: 30 }],
    ["vwap", { anchor: "day", mode: "belowBy", dist: 0.5 }],
    ["vwap", { anchor: "session", mode: "crossUp", within: 2 }],
    ["orb", { session: "london", minutes: 60, mode: "up" }],
    ["orb", { session: "ny", minutes: 120, mode: "down", first: "all" }],
    ["funding", { mode: "below", level: 0, avgN: 2 }],
  ];
  const FUND = Array.from({ length: 200 }, (_, k) => ({ t: Date.UTC(2026, 0, 1) + k * 8 * 3_600_000, rate: Math.sin(k) * 0.0003 }));
  for (const [id, p] of VOL) {
    it(`${id} ${String(p.mode)}: gleiche Werte bei abgeschnittener Historie`, () => {
      const full = evalBlock(id, W, p, { tfSec: 3600, funding: FUND });
      for (const i of [400, 800, 1200, 1499]) {
        const cut = evalBlock(id, W.slice(0, i + 1), p, { tfSec: 3600, funding: FUND });
        expect(cut[i]).toBe(full[i]);
        expect(cut[i - 5]).toBe(full[i - 5]);
        expect(cut[i - 70]).toBe(full[i - 70]);
      }
    }, 60_000);
  }
});

describe("Plausibilität gegen TradingView (BINANCE:BTCUSDT 1D, 2026-10-19)", () => {
  // Die Werte stammen aus dem Screener des TradingView-Connectors. Dessen Tageskerze deckt sich nicht Kerze für Kerze mit
  // `get-ohlcv` (heutiges Hoch / Tief / Schluss weichen um etwa 0,1 % ab), deshalb gelten die Toleranzen unten – sie sind
  // die Differenz durch die Datenquelle, nicht durch die Formel. Beweis für die Formeln: ADX, DI, Stochastic, CCI, %R und die
  // Wolke stimmen auf Zehntel genau mit.
  const fx = JSON.parse(readFileSync("tests/unit/fixtures/tv-binance-btcusdt-1d-indicators.json", "utf8")) as { bars: number[][]; tv: Record<string, number> };
  const bars: Bar[] = fx.bars.map(([t, o, h, l, c, v]) => ({ t: t!, o: o!, h: h!, l: l!, c: c!, v: v! }));
  const i = bars.length - 1;
  const close = bars.map((b) => b.c);
  const tv = fx.tv;

  it("ADX, +DI, −DI (Wilder, 14 / 14)", () => {
    const d = dmiSeries(bars, 14, 14);
    expect(Math.abs(d.adx[i]! - tv.ADX!)).toBeLessThan(0.6);
    expect(Math.abs(d.plus[i]! - tv["ADX+DI"]!)).toBeLessThan(0.6);
    expect(Math.abs(d.minus[i]! - tv["ADX-DI"]!)).toBeLessThan(0.6);
  });

  it("Stochastic (14, 3, 3), CCI (20) und Williams %R (14)", () => {
    const s = stochSeries(bars, 14, 3, 3);
    expect(Math.abs(s.k[i]! - tv["Stoch.K"]!)).toBeLessThan(1.5);
    expect(Math.abs(s.d[i]! - tv["Stoch.D"]!)).toBeLessThan(1.5);
    expect(Math.abs(cciSeries(bars, 20)[i]! - tv.CCI20!)).toBeLessThan(5);
    expect(Math.abs(williamsRSeries(bars, 14)[i]! - tv["W.R"]!)).toBeLessThan(2);
  });

  it("Bollinger (20, 2σ), RSI 14, MACD 12 / 26 / 9", () => {
    const bb = bollingerSeries(close, 20, 2);
    expect(Math.abs(bb.mid[i]! / tv.SMA20! - 1)).toBeLessThan(0.0025);
    expect(Math.abs(bb.upper[i]! / tv["BB.upper"]! - 1)).toBeLessThan(0.0025);
    expect(Math.abs(bb.lower[i]! / tv["BB.lower"]! - 1)).toBeLessThan(0.0025);
    expect(Math.abs(rsi(close, 14)[i]! - tv.RSI!)).toBeLessThan(0.5);
    const m = macdSeries(close, 12, 26, 9);
    // MACD reagiert auf die abweichenden Tageskerzen der Quelle am stärksten (Differenz ≈ 20 bei Werten um 70 / 410)
    expect(Math.abs(m.macd[i]! - tv["MACD.macd"]!)).toBeLessThan(30);
    expect(Math.abs(m.sig[i]! - tv["MACD.signal"]!)).toBeLessThan(30);
    expect(Math.sign(m.macd[i]! - m.sig[i]!)).toBe(Math.sign(tv["MACD.macd"]! - tv["MACD.signal"]!));
  });

  it("Ichimoku (9, 26, 52): Tenkan, Kijun und die Wolke in der heutigen Kerze (Verschiebung 25 wie TradingView)", () => {
    const ic = ichimokuSeries(bars, 9, 26, 52, 26);
    expect(Math.abs(ic.tenkan[i]! / tv["Ichimoku.CLine"]! - 1)).toBeLessThan(0.002);
    expect(Math.abs(ic.kijun[i]! / tv["Ichimoku.BLine"]! - 1)).toBeLessThan(0.002);
    expect(Math.abs(ic.cloudA[i]! / tv["Ichimoku.Lead1"]! - 1)).toBeLessThan(0.002);
    expect(Math.abs(ic.cloudB[i]! / tv["Ichimoku.Lead2"]! - 1)).toBeLessThan(0.002);
  });
});
