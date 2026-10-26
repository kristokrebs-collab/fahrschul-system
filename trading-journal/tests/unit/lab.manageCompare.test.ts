/**
 * F65 – Verwaltungsvergleich im Labor: dieselben Signale mit anderer Verwaltung nach dem Einstieg. Rechnung der Kennzahlen von
 * Hand, die Hüllen der Strategie, und der Zusatzlauf auf einem ECHTEN Lauf (BTCUSDT-Fixtures): jede Variante gleicht einem
 * eigenen Lauf mit denselben Regeln im Regelbaum (zwei Wege zum selben Ergebnis), die Zeile „Stop unverändert“ ist der Lauf ohne
 * Verwaltung, und nichts sieht eine Kerze, die der Lauf nicht kannte.
 */
import { describe, expect, it } from "vitest";
import { createLabJob, type BtStrategy, type EntrySignal, type RunResult } from "@/domain/backtest/index";
import { counted, MANAGE_VARIANTS, managed, manageStatsOf, medianOf } from "@/domain/lab/extras";
import { createExtraJob } from "@/domain/lab/extras/job";
import { defaultCustom, sanitizeCustom } from "@/domain/lab";
import { chain, ENGINE, realInput, T0, trade } from "./lab.extras.helpers";

const sig = (over: Partial<EntrySignal> = {}): EntrySignal => ({ side: "long", stop: 95, target: 110, maxBars: null, tag: "T", ...over });
const run = (trades: ReturnType<typeof trade>[]): RunResult => ({ trades, equity: [], from: T0, to: T0 + 400 * 3_600_000, capital: 10_000, skipped: 0, skippedGap: 0, skippedRisk: 0, signals: trades.length });

describe("Kennzahlen eines Laufs, von Hand", () => {
  it("Median, längste Verlustserie, Kosten, gebundene Zeit und was die Verwaltung getan hat", () => {
    const ts = [
      trade(2, { reason: "target", bars: 10, fees: 1, funding: 0.5, slippage: 0.25 }),
      trade(-1, { reason: "stop", bars: 4, fees: 1, slippage: 0.25 }),
      trade(-0.05, { reason: "breakeven", bars: 6, fees: 1 }),
      trade(0.6, { reason: "trail", bars: 8, fees: 1.5 }),
      trade(1.2, { reason: "target", bars: 12, fees: 2, partials: [{ index: 3, time: T0, price: 105, qty: 1, pnl: 5, fee: 0.1 }] }),
      trade(-0.4, { reason: "stop", bars: 2, fees: 1, ambiguous: true }),
    ];
    const s = manageStatsOf(run(ts));
    expect(s.n).toBe(6);
    // R sortiert: −1, −0,4, −0,05, 0,6, 1,2, 2 → Median (−0,05 + 0,6) / 2 = 0,275
    expect(s.medianR).toBeCloseTo(0.275, 12);
    expect(s.sumR).toBeCloseTo(2.35, 12);
    expect(s.avgR).toBeCloseTo(2.35 / 6, 12);
    expect(s.avgBars).toBeCloseTo((10 + 4 + 6 + 8 + 12 + 2) / 6, 12);
    expect(s.costs).toBeCloseTo(1 + 0.5 + 0.25 + 1 + 0.25 + 1 + 1.5 + 2 + 1, 12);
    expect(s.longestLosing).toBe(2); // Stop (−1) und Break-even (−0,05, Kosten drücken ihn unter null) hintereinander; +0,6 beendet die Serie
    expect(s.movedOut).toBe(2);
    expect(s.partials).toBe(1);
    expect(s.acted).toBe(3);
    expect(s.ambiguous).toBe(1);
  });
  it("ohne Trades: alles leer, nichts erfunden", () => {
    const s = manageStatsOf(run([]));
    expect(s).toMatchObject({ n: 0, medianR: null, avgBars: null, costs: 0, longestLosing: 0, movedOut: 0, acted: 0 });
  });
  it("medianOf: ungerade, gerade, leer", () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([])).toBeNull();
  });
  it("die Verlustserie: Verluste in Folge, ein Gewinn beendet sie", () => {
    const ts = chain([-1, -1, 1, -0.5, -0.5, -0.5, 2]);
    expect(manageStatsOf(run(ts)).longestLosing).toBe(3);
  });
});

describe("Die Hüllen der Strategie", () => {
  const inner = (s: EntrySignal | null): BtStrategy => ({ start: 5, signalAt: (i) => (i === 7 ? s : null) });

  it("managed ersetzt nur die Verwaltung: Stop, Ziel, Richtung, Zeit-Stop und Zeitpunkt bleiben", () => {
    const mg = { breakEven: { after: { kind: "r" as const, value: 1 }, to: "entry" as const } };
    const own = { trail: { kind: "atr" as const, value: 3, activateR: 0 } };
    const s = managed(inner(sig({ manage: own, maxBars: 12, grade: "A" })), mg);
    expect(s.start).toBe(5);
    expect(s.signalAt(6)).toBeNull();
    expect(s.signalAt(7)).toEqual({ side: "long", stop: 95, target: 110, maxBars: 12, tag: "T", grade: "A", manage: mg });
    // null = ohne Verwaltung: auch die eigene fällt weg
    expect("manage" in managed(inner(sig({ manage: own })), null).signalAt(7)!).toBe(false);
    // die Eingabe bleibt unverändert
    const original = sig({ manage: own });
    managed(inner(original), mg).signalAt(7);
    expect(original.manage).toBe(own);
  });

  it("counted verändert nichts und zählt die Signale mit eigener Verwaltung", () => {
    const seen = { managed: 0 };
    const a = sig({ manage: { trail: { kind: "pct", value: 3, activateR: 1 } } });
    const s = counted(inner(a), seen);
    expect(s.signalAt(7)).toBe(a);
    expect(seen.managed).toBe(1);
    const s2 = counted(inner(sig()), seen);
    s2.signalAt(7);
    expect(seen.managed).toBe(1);
  });

  it("die acht Varianten des Bauplans: Break-even 0,5 / 1 / 1,5 R, Netto, Trailing, Teilziel – jede mit Satz", () => {
    expect(MANAGE_VARIANTS.map((v) => v.id)).toEqual(["none", "be05", "be1", "be15", "be1net", "trail2", "trail3", "partial"]);
    expect(MANAGE_VARIANTS[0]!.mgmt).toBeNull();
    for (const v of MANAGE_VARIANTS) {
      expect(v.label.length).toBeGreaterThan(5);
      expect(v.detail.endsWith(".")).toBe(true);
    }
    expect(MANAGE_VARIANTS.find((v) => v.id === "be05")!.mgmt!.breakEven).toEqual({ after: { kind: "r", value: 0.5 }, to: "entry" });
    expect(MANAGE_VARIANTS.find((v) => v.id === "be1net")!.mgmt!.breakEven!.to).toBe("net");
  });
});

describe("Zusatzlauf auf einem echten Lauf", () => {
  const input = realInput();
  const base = createLabJob(input).result();
  const out = createExtraJob({ base: input, what: "manage" }).result();
  if (out.what !== "manage") throw new Error("kein Vergleich");
  const rows = out.compare.rows;
  const row = (id: string) => rows.find((r) => r.id === id)!;

  it("die Zeilen: ohne eigene Verwaltung des Laufs keine Zeile „Wie im Lauf“; „Stop unverändert“ ist der Lauf selbst", () => {
    expect(rows.map((r) => r.id)).toEqual(["none", "be05", "be1", "be15", "be1net", "trail2", "trail3", "partial"]);
    expect(out.compare.barMs).toBe(4 * 3600_000);
    expect(base.stats.n).toBeGreaterThan(5);
    expect(row("none").stats!.n).toBe(base.stats.n);
    expect(row("none").stats!.sumR).toBeCloseTo(base.trades.reduce((s, t) => s + t.r, 0), 9);
    expect(row("none").dSumR).toBeNull();
    expect(row("none").stoppedBeforeTarget).toBeNull();
    for (const r of rows.slice(1)) expect(r.dSumR).toBeCloseTo(r.stats!.sumR - row("none").stats!.sumR, 9);
  }, 120_000);

  it("jede Variante gleicht einem eigenen Lauf mit denselben Regeln im Regelbaum (zwei Wege, ein Ergebnis)", () => {
    const withExits = (exits: Partial<ReturnType<typeof defaultCustom>["exits"]>) =>
      createLabJob({ ...input, custom: { ...input.custom!, config: sanitizeCustom({ ...input.custom!.config, exits: { ...input.custom!.config.exits, ...exits } }) } }).result();
    const same = (id: string, r: ReturnType<typeof withExits>) => {
      const s = row(id).stats!;
      expect(s.n, id).toBe(r.stats.n);
      expect(s.sumR, id).toBeCloseTo(r.trades.reduce((a, t) => a + t.r, 0), 9);
      expect(s.net, id).toBeCloseTo(r.stats.net, 6);
    };
    same("be05", withExits({ breakEven: { on: true, trigger: "r", value: 0.5, to: "entry" } }));
    same("be1", withExits({ breakEven: { on: true, trigger: "r", value: 1, to: "entry" } }));
    same("be15", withExits({ breakEven: { on: true, trigger: "r", value: 1.5, to: "entry" } }));
    same("be1net", withExits({ breakEven: { on: true, trigger: "r", value: 1, to: "net" } }));
    same("trail2", withExits({ trail: { on: true, kind: "atr", value: 2, activateR: 1 } }));
    same("trail3", withExits({ trail: { on: true, kind: "atr", value: 3, activateR: 1 } }));
    same("partial", withExits({ partial: { on: true, atR: 1, fracPct: 50, thenBreakEven: true } }));
  }, 180_000);

  it("Ausstopper vor dem Ziel: nie mehr als die Trades, die der verschobene Stop beendete, und nie mehr als die mit Zwilling", () => {
    for (const r of rows.slice(1)) {
      expect(r.movedTwins, r.id).not.toBeNull();
      expect(r.stoppedBeforeTarget!, r.id).toBeLessThanOrEqual(r.movedTwins!);
      expect(r.movedTwins!, r.id).toBeLessThanOrEqual(r.stats!.movedOut);
    }
    // ein Break-even bei +0,5 R greift früher als bei +1,5 R: es beendet mindestens so viele Trades mit einem verschobenen Stop
    expect(row("be05").stats!.movedOut).toBeGreaterThanOrEqual(row("be15").stats!.movedOut);
    // das Teilziel nimmt in jedem Trade, der +1 R erreicht, einen Teil mit – und ändert damit mindestens so viele Trades wie es Teilfüllungen gibt
    expect(row("partial").stats!.acted).toBeGreaterThanOrEqual(row("partial").stats!.partials);
  }, 120_000);

  it("deterministisch; eine Idee mit eigener Verwaltung bekommt vorn die Zeile „Wie im gezeigten Lauf“ – gleich dem Lauf", () => {
    const again = createExtraJob({ base: input, what: "manage" }).result();
    expect(again).toEqual(out);
    const own = realInput({ custom: { ...input.custom!, config: sanitizeCustom({ ...input.custom!.config, exits: { ...input.custom!.config.exits, breakEven: { on: true, trigger: "r", value: 1, to: "entry" } } }) } });
    const ownRun = createLabJob(own).result();
    const res = createExtraJob({ base: own, what: "manage" }).result();
    if (res.what !== "manage") throw new Error("kein Vergleich");
    expect(res.compare.rows.map((r) => r.id)[0]).toBe("asRun");
    const asRun = res.compare.rows[0]!.stats!;
    expect(asRun.n).toBe(ownRun.stats.n);
    expect(asRun.sumR).toBeCloseTo(ownRun.trades.reduce((s, t) => s + t.r, 0), 9);
    // und „Stop unverändert“ ist weiterhin der Lauf ohne Verwaltung, also der des Laufs oben
    expect(res.compare.rows.find((r) => r.id === "none")!.stats!.sumR).toBeCloseTo(row("none").stats!.sumR, 9);
  }, 180_000);

  it("ohne Kerzen im Zeitraum: Zeilen ohne Zahlen, nichts erfunden", () => {
    const empty = createExtraJob({ base: realInput({ toMs: realInput().fromMs + 1000 }), what: "manage" }).result();
    if (empty.what !== "manage") throw new Error("kein Vergleich");
    for (const r of empty.compare.rows) expect(r.stats === null || r.stats.n === 0).toBe(true);
  }, 120_000);
});

void ENGINE;
