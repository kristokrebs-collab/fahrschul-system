/**
 * Zeitmaschine · part (b): every earlier occasion on the real candles. The level trigger is checked on a hand-built series with
 * a known answer (limit fills, the target that cannot count inside a limit fill's candle, the stop that can, the time stop, the
 * order that must come back to the level from the right side, the trade the data ended on); the other triggers on the real
 * BTCUSDT bars by properties (no overlap, no look-ahead, limit fills at the level or better, the engine gives the same trade).
 */
import { describe, expect, it } from "vitest";
import { atrSeries } from "@/domain/backtest/bars";
import { runBacktest } from "@/domain/backtest/engine";
import { HistoryJob, relativeOf, triggerText, TM_SEC, type Bar, type Relative, type TmEvent, type TmInput } from "@/domain/timemachine";
import { engineCfg, onceAtStart, signalOf } from "@/domain/timemachine/play";
import { btc4h, input, ZERO_COSTS } from "./timemachine.helpers";
import { defaultOptions } from "@/domain/timemachine";

const DAY = 86_400;
const T0 = 1_700_000_000 - (1_700_000_000 % DAY);

/** o, h, l, c → bars of one day each, after `warm` flat warm-up bars around 105 (range ±1, ATR ≈ 2). */
function series(rows: [number, number, number, number][], warm = 20, mid = 105): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < warm; i++) out.push({ t: T0 + i * DAY, o: mid, h: mid + 1, l: mid - 1, c: mid });
  rows.forEach(([o, h, l, c], k) => out.push({ t: T0 + (warm + k) * DAY, o, h, l, c }));
  return out;
}

/** The hand-built market: the story is in the comments of the test. */
const LONG_ROWS: [number, number, number, number][] = [
  [105, 105.5, 99, 100.5], //  20  touches 100 from above → limit buy at 100; the high of this candle must NOT count as the target
  [100.5, 104.5, 100.2, 104], //  21  target 104 reached → +2 R after 2 candles
  [104, 105, 101, 103], //  22  no touch
  [103, 104, 97, 98], //  23  touches 100 → fill; the same candle reaches the stop 98 → −1 R after 1 candle
  [98, 103, 97, 102], //  24  the price is BELOW the level: nothing to fill
  [102, 103, 101, 102], //  25  back above, no touch
  [102, 102, 99.5, 101], //  26  touches → fill; low 99.5 stays above the stop
  [101, 102, 100.2, 101.5], //  27
  [101.5, 103, 101, 102], //  28  third candle: time stop at the close 102 → +1 R
  [102, 103, 101.5, 102],
  [102, 103, 101.5, 102],
  [102, 103, 101.5, 102],
  [102, 103, 101.5, 102],
  [102, 103, 101.5, 102],
  [102, 103, 101.5, 102], //  34 (index 34 − 20 = row 14)
  [102, 103, 99, 101], //  row 15 = candle 35: touches → fill, but the data ends before the third candle
  [101, 103, 100.5, 102], //  row 16 = candle 36: the last candle (the trade of candle 35 is not over)
];

function levelInput(bars: Bar[], over: Partial<TmInput> = {}): TmInput {
  return input({ bars, interval: "1d", plan: { side: "long", entry: 100, stop: 98, target: 104 }, trigger: { kind: "level" }, horizon: 3, costs: ZERO_COSTS, ...over });
}

function runHistory(inp: TmInput, relFrom?: Relative) {
  const rel = relFrom ?? relativeOf(inp.plan, inp.bars as Bar[], inp.trigger);
  if ("ok" in rel) throw new Error(rel.why);
  const job = new HistoryJob(inp, inp.bars, rel, TM_SEC[inp.interval]);
  while (!job.step(performance.now() + 1000)) {
    /* to the end */
  }
  return job.result();
}

describe("Vorfälle auf Kerzen von Hand", () => {
  const bars = series(LONG_ROWS);
  const h = runHistory(levelInput(bars));

  it("findet genau die drei Vorfälle mit ihren Ausgängen und R", () => {
    expect(h.events.map((e) => [e.reason, Math.round(e.r * 1e9) / 1e9, e.bars, e.kind])).toEqual([
      ["target", 2, 2, "limit"],
      ["stop", -1, 1, "limit"],
      ["time", 1, 3, "limit"],
    ]);
    expect(h.n).toBe(3);
    expect(h.target.k).toBe(1);
    expect(h.stop.k).toBe(1);
    expect(h.neither.k).toBe(1);
  });

  it("das Ziel zählt in der Kerze eines Limit-Einstiegs nicht (Reihenfolge von Hoch und Tief unbekannt), der Stop schon", () => {
    // Kerze 20 hat ein Hoch von 105,5 ≥ Ziel 104: ohne die Regel wäre der erste Vorfall sofort „Ziel“ nach EINER Kerze
    expect(h.events[0]!.bars).toBe(2);
    expect(h.events[1]!.bars).toBe(1);
  });

  it("Zeiten und Preise: Einstieg auf dem Niveau, Ausstieg am Ziel bzw. am Schlusskurs des Zeitstopps", () => {
    const [a, , c] = h.events as [TmEvent, TmEvent, TmEvent];
    expect(a.entry).toBe(100);
    expect(a.entryT).toBe((T0 + 20 * DAY) * 1000);
    expect(a.exitT).toBe((T0 + 21 * DAY) * 1000); // das Ziel-Limit füllt in Kerze 21 (Zeitpunkt = Beginn der Kerze, wie in der Engine)
    expect(c.exitT).toBe((T0 + 29 * DAY) * 1000); // Zeitstopp zum Schluss von Kerze 28 = Beginn von 29
  });

  it("derselbe Preis von unten ist kein Einstieg: nach dem Stop (Kurs 98 < 100) wartet die Suche, bis der Kurs wieder oben war", () => {
    // Kerze 24 öffnet bei 98 und hat ein Tief von 97: wäre die Seite egal, gäbe es hier einen weiteren Einstieg
    expect(h.events.map((e) => e.i)).toEqual([20, 23, 26]);
  });

  it("ein Einstieg, dessen Trade am Ende der Daten noch offen ist, zählt nicht mit", () => {
    expect(h.openAtEnd).toBe(1);
    expect(h.unfilled).toBe(0);
    expect(h.skippedGap).toBe(0);
    expect(h.expectancy!.n).toBe(3);
    expect(h.expectancy!.mean).toBeCloseTo((2 - 1 + 1) / 3, 12);
  });

  it("Short spiegelt Long (die Kerzen an 200 gespiegelt, Niveau 100): dieselben Ausgänge", () => {
    const mirrored = bars.map((b) => ({ t: b.t, o: 200 - b.o, h: 200 - b.l, l: 200 - b.h, c: 200 - b.c }));
    const s = runHistory(levelInput(mirrored, { plan: { side: "short", entry: 100, stop: 102, target: 96 } }));
    expect(s.events.map((e) => [e.reason, Math.round(e.r * 1e9) / 1e9, e.bars])).toEqual([
      ["target", 2, 2],
      ["stop", -1, 1],
      ["time", 1, 3],
    ]);
    expect(s.openAtEnd).toBe(1);
  });

  it("Gebühren und Slippage kosten R: dieselben Ausgänge, jedes R kleiner", () => {
    const costs = { fees: { exchange: "t", makerBps: 2, takerBps: 5 }, slippage: { kind: "fixed", bps: 5 } as const, funding: { kind: "none" } as const };
    const c = runHistory(levelInput(bars, { costs }));
    expect(c.events.map((e) => e.reason)).toEqual(h.events.map((e) => e.reason));
    c.events.forEach((e, k) => expect(e.r).toBeLessThan(h.events[k]!.r));
  });
});

describe("Vorfälle auf echten BTCUSDT-Kerzen (4h)", { timeout: 60_000 }, () => {
  const bars = btc4h();
  const atr = atrSeries(bars);
  const base = (over: Partial<TmInput>): TmInput => ({ symbol: "BTCUSDT", plan: { side: "long", entry: bars.at(-1)!.c, stop: bars.at(-1)!.c * 0.98, target: bars.at(-1)!.c * 1.04 }, bars, interval: "4h", costs: { fees: { exchange: "t", makerBps: 2, takerBps: 5 }, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "flat", ratePer8h: 0.0001 } }, startMs: null, ...defaultOptions("4h"), ...over });

  it("gleiche Abstände je Schluss: viele Vorfälle, nie zwei Positionen zugleich, jeder Vorfall = derselbe Trade in der Engine", () => {
    const inp = base({ trigger: { kind: "close" } });
    const h = runHistory(inp);
    expect(h.n).toBeGreaterThan(40);
    for (let k = 1; k < h.events.length; k++) expect(h.events[k]!.entryT).toBeGreaterThanOrEqual(h.events[k - 1]!.exitT);
    const cfg = engineCfg(inp.costs);
    for (const e of h.events.slice(0, 12)) {
      const d = e.i - 1; // Entscheidung am Schluss der Kerze davor, Füllung zur Eröffnung von e.i
      const strat = onceAtStart(signalOf(inp.plan, e.stop, e.target, inp.horizon, inp.manage));
      // dieselbe Engine auf den GANZEN Kerzen, Signal nur in Kerze d
      // (die Kerzen enden mit der Sitzung: die Engine bewertet Funding am Rand mit dem Schluss der letzten Kerze, nicht mit einer späteren)
      const res = runBacktest(bars.slice(0, d + inp.horizon + 1), { start: d, signalAt: (i) => (i === d ? strat.signal : null) }, cfg, { from: d, to: Math.min(bars.length - 1, d + inp.horizon + 1), atr, secLen: 14_400, equity: false });
      const t = res.trades[0]!;
      expect(t.r).toBeCloseTo(e.r, 9);
      expect(t.exitTime).toBe(e.exitT);
      expect(t.reason).toBe(e.reason);
    }
  });

  it("sieht nur die Vergangenheit: schneidet man die Kerzen nach einem Vorfall ab, bleiben alle früheren Vorfälle gleich", () => {
    const inp = base({ trigger: { kind: "close" } });
    const rel = relativeOf(inp.plan, bars, inp.trigger);
    if ("ok" in rel) throw new Error(rel.why);
    const full = runHistory(inp, rel);
    const cutAt = full.events[20]!.i + inp.horizon + 2;
    // der Plan bleibt derselbe (seine Abstände in ATR sind die vom Planzeitpunkt); nur die Kerzen danach fehlen
    const cut = runHistory({ ...inp, bars: bars.slice(0, cutAt) }, rel);
    // die Vorfälle bis zum letzten, der vor dem Schnitt komplett ausgespielt war, sind identisch
    const done = full.events.filter((e) => e.i + inp.horizon <= cutAt);
    expect(done.length).toBeGreaterThan(10);
    expect(cut.events.slice(0, done.length)).toEqual(done);
  });

  it("Limit-Aufträge füllen zum Niveau oder besser, Stop-Aufträge zum Niveau oder schlechter", () => {
    const px = bars.at(-1)!.c;
    const lim = runHistory(base({ plan: { side: "long", entry: px - 400, stop: px - 400 - 700, target: px - 400 + 1400 }, trigger: { kind: "close" }, costs: { fees: { exchange: "t", makerBps: 0, takerBps: 0 }, slippage: { kind: "none" }, funding: { kind: "none" } } }));
    expect(lim.n).toBeGreaterThan(20);
    const window = (e: TmEvent): number[] => Array.from({ length: 4 }, (_, k) => e.i - 1 - k);
    for (const e of lim.events) {
      expect(e.kind).toBe("limit");
      // der Auftrag wurde an einem der letzten 4 Schlüsse davor gesetzt: Niveau = Schluss − 400 · ATR(damals) ÷ ATR(heute)
      const levels = window(e).map((d) => bars[d]!.c - 400 * (atr[d]! / atr.at(-1)!));
      expect(levels.some((lv) => e.entry <= lv + 1e-6)).toBe(true);
    }
    const stp = runHistory(base({ plan: { side: "long", entry: px + 400, stop: px - 300, target: px + 1400 }, trigger: { kind: "close" }, costs: { fees: { exchange: "t", makerBps: 0, takerBps: 0 }, slippage: { kind: "none" }, funding: { kind: "none" } } }));
    expect(stp.events.length).toBeGreaterThan(20);
    for (const e of stp.events) {
      expect(e.kind).toBe("stop");
      const levels = window(e).map((d) => bars[d]!.c + 400 * (atr[d]! / atr.at(-1)!));
      expect(levels.some((lv) => e.entry >= lv - 1e-6)).toBe(true);
    }
  });

  it("Range-Trigger mit Einstieg jetzt: ein Vorfall entsteht nur in dem Moment, in dem der Schluss in die Zone der Spanne kommt", () => {
    const inp = base({ trigger: { kind: "range", lookback: 20 } });
    const h = runHistory(inp);
    const rel = relativeOf(inp.plan, bars, inp.trigger);
    if ("ok" in rel) throw new Error(rel.why);
    expect(rel.kind).toBe("market");
    expect(h.n).toBeGreaterThan(5);
    const pos = (j: number): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = j - 19; k <= j; k++) {
        lo = Math.min(lo, bars[k]!.l);
        hi = Math.max(hi, bars[k]!.h);
      }
      return (bars[j]!.c - lo) / (hi - lo);
    };
    for (const e of h.events) {
      // Entscheidung am Schluss der Kerze vor dem Einstieg: dort kommt der Schluss in die Zone, eine Kerze davor war er draußen
      expect(Math.abs(pos(e.i - 1) - rel.rangePos!)).toBeLessThanOrEqual(0.1 + 1e-12);
      expect(Math.abs(pos(e.i - 2) - rel.rangePos!)).toBeGreaterThan(0.1);
    }
    expect(triggerText(inp.trigger, "market")).toContain("Zone");
  });

  it("Preisniveau: nur Berührungen von der Seite, aus der der Kurs kam; ein Niveau, das nie erreicht wurde, ergibt keinen Vorfall", () => {
    const last = bars.at(-1)!.c;
    const never = runHistory(base({ plan: { side: "long", entry: last * 3, stop: last * 3 * 0.98, target: last * 3 * 1.04 }, trigger: { kind: "level" } }));
    expect(never.n).toBe(0);
    expect(never.events).toEqual([]);
    const mid = runHistory(base({ plan: { side: "long", entry: last * 0.97, stop: last * 0.95, target: last * 1.0 }, trigger: { kind: "level" } }));
    for (const e of mid.events) {
      // Limit-Kauf unter dem Kurs: die Kerze davor schloss darüber
      const k = bars.findIndex((b) => b.t * 1000 === e.entryT);
      expect(bars[k - 1]!.c).toBeGreaterThan(last * 0.97);
    }
  });
});
