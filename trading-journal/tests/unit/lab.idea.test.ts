import { describe, expect, it } from "vitest";
import { boxSetups, type BoxState, type RsiLineState } from "@/domain/boxes";
import { BLOCKS, defaultParams, makeCtx, sanitizeParams, sessionOfSec } from "@/domain/lab/rules/blocks";
import { classifyBoxReason, ideaFromBoxSetup, ideaFromCombo, ideaFromSignal, symbolOfPair, translateIdea, type IdeaFactor, type VerdictLike } from "@/domain/lab/idea";
import { leavesOf, validateCustom } from "@/domain/lab/rules/tree";
import { sessionOf } from "@/domain/insights/time";
import type { Bar } from "@/domain/signals";

const base = (over: Partial<BoxState>): BoxState => ({
  boxes: [], levels: [], phase: "inside", dir: 0, price: 100, pos: 0.1, zone: "bottom", pending: 0, pendingBack: false, targets: [], up: [], down: [], barsSince: null, progress: null, atr: 1,
  box: { i0: 0, i1: 49, formedAt: 20, t0: 0, t1: 50, top: 110, topIn: 109, bottom: 100, bottomIn: 101, mid: 105, height: 10, atr: 1, touchesTop: 3, touchesBottom: 3, sweeps: 1, brk: 0, brkI: null, quality: 80, grade: "stark" },
  ...over,
});
const rsiUp = { rsi: [], last: 45, res: null, sup: null, breakUp: { kind: "res", a: { i: 1, v: 60 }, b: { i: 9, v: 50 }, slope: -1.2, touches: 3, brokeAt: 10 }, breakDown: null, ageUp: 1, ageDown: null, distRes: null, distSup: null } as RsiLineState;

describe("Box-Setup → Idee (F12)", () => {
  it("jede Begründung echter Setups wird erkannt (sonst würde sie nur als Lücke auftauchen)", () => {
    const states: BoxState[] = [
      base({ price: 100.5 }),
      base({ price: 109.5, zone: "top", pos: 0.95 }),
      base({ price: 110.5, pending: 1, pos: 1.05, zone: "top" }),
      base({ phase: "breakout", dir: 1, price: 112, pos: 1.2, zone: "top", targets: [{ price: 120, kind: "box", label: "x", zone: null, i: null }], up: [{ price: 120, kind: "box", label: "x", zone: null, i: null }], barsSince: 1 }),
      base({ phase: "retest", dir: 1, price: 110.2, pos: 1.02, zone: "top", barsSince: 4 }),
      base({ phase: "failed", dir: 1, price: 108, pos: 0.8, zone: "top" }),
    ];
    const seen = new Set<string>();
    for (const st of states)
      for (const rsi of [rsiUp, null, { ...rsiUp, breakUp: null, breakDown: rsiUp.breakUp, ageDown: 1, ageUp: null } as RsiLineState])
        for (const bias of [1, -1, null] as const)
          for (const s of boxSetups(st, rsi, bias, null)) for (const r of s.reasons) seen.add(r.text);
    expect(seen.size).toBeGreaterThan(8);
    const unknown = [...seen].filter((t) => classifyBoxReason(t) === "other");
    // the only reasons without a class are the "close still pending" ones – they are listed as not met
    expect(unknown.every((t) => /Kerzenschluss abwarten/.test(t))).toBe(true);
  });

  it("Ausbruch Long: Breakout-Baustein mit Boxlänge, Stop und Ziel aus dem Plan, Lücken mit Grund", () => {
    const st = base({ phase: "breakout", dir: 1, price: 112, pos: 1.2, zone: "top", barsSince: 1, up: [{ price: 124, kind: "box", label: "Ziel", zone: null, i: null }], targets: [{ price: 124, kind: "box", label: "Ziel", zone: null, i: null }] });
    const s = boxSetups(st, rsiUp, 1, { ...st, phase: "breakout", dir: 1 })[0]!;
    expect(s.kind).toBe("breakout");
    const d = ideaFromBoxSetup({ kind: "box", symbol: "ETHUSDT", tf: "4h", setup: s, boxBars: 50 });
    expect(d.testable).toBe(true);
    expect(d.blocked).toBeNull();
    expect(d.symbol).toBe("ETHUSDT");
    expect(d.config.interval).toBe("4h");
    expect(d.config.sides).toBe("long");
    const ls = leavesOf(d.config.long);
    expect(ls.map((l) => l.block)).toEqual(expect.arrayContaining(["breakout", "rsiLine"]));
    expect(ls.find((l) => l.block === "breakout")!.params).toMatchObject({ mode: "up", n: 50 });
    expect(d.config.stop.kind).toBe("percent");
    expect(d.config.stop.pct).toBeCloseTo((Math.abs(s.entry - s.stop) / s.entry) * 100, 1);
    expect(d.config.target).toEqual({ kind: "r", r: Math.round((s.rr ?? 0) * 10) / 10 });
    // top traders + box quality + higher timeframe: listed, with a reason, never dropped silently
    const gaps = d.gaps.map((g) => g.what).join(" | ");
    expect(gaps).toMatch(/Top Trader/);
    expect(gaps).toMatch(/Box stark/);
    expect(gaps).toMatch(/Höherer Timeframe/);
    expect(d.gaps.every((g) => g.why.length > 10)).toBe(true);
    expect(d.notes.join(" ")).toMatch(/Näherung/);
    expect(validateCustom(d.config).filter((i) => i.level === "error")).toEqual([]);
  });

  it("Short spiegelt die Seite; 1W läuft auf 1D und sagt es", () => {
    const st = base({ phase: "breakout", dir: -1, price: 98, pos: -0.2, zone: "bottom", barsSince: 1, targets: [], up: [], down: [{ price: 85, kind: "box", label: "Ziel", zone: null, i: null }] });
    const s = boxSetups(st, { ...rsiUp, breakUp: null, breakDown: rsiUp.breakUp, ageDown: 1 } as RsiLineState, -1, null)[0]!;
    expect(s.side).toBe("short");
    const d = ideaFromBoxSetup({ kind: "box", symbol: null, tf: "1w", setup: s, boxBars: null });
    expect(d.config.sides).toBe("short");
    expect(d.config.interval).toBe("1d");
    expect(d.symbol).toBeNull();
    expect(leavesOf(d.config.short).find((l) => l.block === "breakout")!.params).toMatchObject({ mode: "down", n: 20 });
    expect(d.gaps.some((g) => g.what === "Zeiteinheit 1W")).toBe(true);
    expect(d.notes.join(" ")).toMatch(/Standard, die Boxlänge war unbekannt/);
    // no target (no CRV) → no fixed target, said openly
    expect(s.rr).toBeNull();
    expect(d.config.target.kind).toBe("none");
    expect(d.gaps.some((g) => g.what === "Ziel des Plans")).toBe(true);
  });

  it("Range-Setup: Premium/Discount als benannte Näherung; Fehlausbruch ohne Regel ist nicht testbar", () => {
    const range = boxSetups(base({ price: 100.5 }), null, null, null).find((x) => x.kind === "range")!;
    const d = ideaFromBoxSetup({ kind: "box", symbol: "BTCUSDT", tf: "1d", setup: range, boxBars: 50 });
    expect(leavesOf(d.config.long).map((l) => l.block)).toEqual(["zone", "rsiLine"]);
    expect(leavesOf(d.config.long)[1]!.not).toBe(true); // „Keine gebrochene RSI-Aufwärtslinie“ stays a condition (NOT)
    expect(d.notes.join(" ")).toMatch(/Näherung: „unteres Viertel der Box“ wird als Discount-Zone/);
    const fake = boxSetups(base({ phase: "failed", dir: 1, price: 108, pos: 0.8, zone: "top" }), null, null, null).find((x) => x.kind === "fakeout")!;
    const f = ideaFromBoxSetup({ kind: "box", symbol: "BTCUSDT", tf: "4h", setup: fake, boxBars: 50 });
    expect(f.testable).toBe(false);
    expect(f.blocked).toMatch(/keine Regel/);
    expect(f.gaps.some((g) => g.what === "Fehlausbruch")).toBe(true);
  });

  it("nicht erfüllte Begründungen werden als Hinweis genannt, nicht zur Regel", () => {
    const s = boxSetups(base({ phase: "breakout", dir: 1, price: 112, pos: 1.2, zone: "top", barsSince: 1 }), null, null, null)[0]!;
    const d = ideaFromBoxSetup({ kind: "box", symbol: "BTCUSDT", tf: "4h", setup: s, boxBars: 40 });
    expect(leavesOf(d.config.long).map((l) => l.block)).not.toContain("rsiLine");
    expect(d.notes.join(" ")).toMatch(/nicht erfüllt und deshalb nicht Teil der Regeln: .*Top Trader/);
  });
});

const verdict = (over: Partial<VerdictLike> = {}): VerdictLike => ({ side: "long", valid: true, strength: 3, label: "Sehr starker Long-Einstieg", state: "confirmed", ...over });

describe("Einstiegs-Check → Idee (F12)", () => {
  it("nutzt die MCB-Leiter mit der Stärke des Urteils und nennt Top-Trader und Lage als Lücken", () => {
    const d = ideaFromSignal({ kind: "signal", symbol: "SOLUSDT", baseTf: "30m", verdict: verdict() });
    expect(d.testable).toBe(true);
    expect(d.symbol).toBe("SOLUSDT");
    expect(d.config.interval).toBe("1h");
    const l = leavesOf(d.config.long)[0]!;
    expect(l.block).toBe("mcbLadder");
    expect(l.params).toMatchObject({ mode: "validLong", minStrength: 3 });
    expect(d.gaps.map((g) => g.what)).toEqual(["Top-Trader-Teil", "Lage-Ampel"]);
    expect(d.notes.join(" ")).toMatch(/Takt 1h \(dein Check läuft auf 30m\)/);
  });

  it("der Bonuspunkt der Top-Trader wird nicht mitgetestet; ungültig → Stärke 1; vorläufig wird gesagt", () => {
    const withBonus = ideaFromSignal({ kind: "signal", symbol: null, baseTf: "4h", verdict: verdict({ strength: 4, parts: [{ id: "traders", bonus: true, ok: true, data: true }] }) });
    expect(leavesOf(withBonus.config.long)[0]!.params.minStrength).toBe(3);
    expect(withBonus.config.interval).toBe("4h");
    expect(withBonus.notes.join(" ")).toMatch(/ohne den Bonuspunkt/);
    const none = ideaFromSignal({ kind: "signal", symbol: null, baseTf: "1h", verdict: verdict({ side: "short", valid: false, strength: 0, state: "provisional", label: "Short: nur 1h bestätigt" }) });
    expect(none.config.sides).toBe("short");
    expect(leavesOf(none.config.short)[0]!.params).toMatchObject({ mode: "validShort", minStrength: 1 });
    expect(none.notes.join(" ")).toMatch(/kein gültiger Short-Einstieg/);
    expect(none.notes.join(" ")).toMatch(/vorläufig/);
  });
});

const f = (dim: string, key: string, label = key): IdeaFactor => ({ dim, key, label });

describe("Journal-Kombination → Idee (F12)", () => {
  it("Setup + Wochentag + Session: Zeitfilter wird Regel, das Setup eine Lücke", () => {
    const d = ideaFromCombo({ kind: "combo", label: "Box-Breakout · Montag · London", factors: [f("setup", "s1", "Box-Breakout"), f("weekday", "0", "Montag"), f("session", "london", "London"), f("side", "long", "Long"), f("asset", "ETH/USDT", "ETH/USDT")] });
    expect(d.testable).toBe(true);
    expect(d.symbol).toBe("ETHUSDT");
    const ls = leavesOf(d.config.long);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ block: "timeWindow", params: { weekday: "mon", session: "london" } });
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0]!.what).toMatch(/Box-Breakout/);
    expect(d.notes.join(" ")).toMatch(/UTC/);
    expect(d.notes.join(" ")).toMatch(/keinen Einstiegsauslöser/);
    expect(d.config.name).toBe("Idee: Box-Breakout");
  });

  it("Signal-Stärke und Timeframe: MCB-Leiter; ohne Richtung startet der Test mit Long und sagt es", () => {
    const d = ideaFromCombo({ kind: "combo", label: "Stärke 3 · 15m", factors: [f("strength", "3"), f("timeframe", "15m")] });
    expect(d.config.interval).toBe("1h");
    expect(leavesOf(d.config.long)[0]!.params).toMatchObject({ mode: "validLong", minStrength: 3 });
    expect(d.gaps.some((g) => /Timeframe 15m/.test(g.what))).toBe(true);
    expect(d.notes.join(" ")).toMatch(/Richtung: der Test startet mit Long/);
  });

  it("Verhalten und Gefühl sind Lücken; ohne jede Regel ist die Idee nicht testbar", () => {
    const d = ideaFromCombo({ kind: "combo", label: "Revenge · Müde", factors: [f("behavior", "revenge", "Revenge"), f("emotion", "tired", "Müde")] });
    expect(d.testable).toBe(false);
    expect(d.gaps.map((g) => g.what)).toEqual(["Revenge", "Müde"]);
    expect(d.blocked).toMatch(/keine Regel/);
    expect(translateIdea({ kind: "combo", label: "x", factors: [f("weekday", "9")] }).gaps[0]!.why).toMatch(/nicht lesbar/);
  });

  it("symbolOfPair erkennt nur Binance-USDT-Symbole", () => {
    expect(symbolOfPair("BTC/USDT")).toBe("BTCUSDT");
    expect(symbolOfPair("btcusdt.p")).toBe("BTCUSDT");
    expect(symbolOfPair("EUR/USD")).toBeNull();
  });
});

describe("Baustein Wochentag / Session (UTC)", () => {
  const bar = (t: number): Bar => ({ t, o: 1, h: 1, l: 1, c: 1 });
  // 2026-03-02 is a Monday
  const monday = Date.UTC(2026, 2, 2) / 1000;
  const bars = Array.from({ length: 24 * 7 }, (_, i) => bar(monday + i * 3600));
  const run = (p: Record<string, string>): Uint8Array => {
    const r = BLOCKS.timeWindow.eval(makeCtx(bars), sanitizeParams("timeWindow", p));
    return r instanceof Uint8Array ? r : r.result();
  };

  it("Montag in der London-Session: genau 7:00–12:59 UTC", () => {
    const out = run({ weekday: "mon", session: "london" });
    expect([...out].map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0)).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it("nur Wochenende: Samstag und Sonntag; ohne Einschränkung: alles", () => {
    const we = run({ session: "weekend" });
    expect([...we].filter((v) => v === 1)).toHaveLength(48);
    expect([...run({})].every((v) => v === 1)).toBe(true);
  });

  it("die Sessions sind dieselben wie in der Auswertung „Zeit & Session“", () => {
    for (let h = 0; h < 24 * 7; h++) {
      const t = monday + h * 3600;
      expect(sessionOfSec(t)).toBe(sessionOf(new Date(t * 1000)));
    }
  });

  it("Standardwerte, Spiegelung und Text sind gültig", () => {
    const d = defaultParams("timeWindow");
    expect(BLOCKS.timeWindow.text(d)).toMatch(/ohne Einschränkung/);
    expect(BLOCKS.timeWindow.text({ weekday: "fri", session: "ny" })).toBe("Kerze öffnet am Freitag in der Session New York (UTC)");
    expect(BLOCKS.timeWindow.mirror({ weekday: "fri", session: "ny" })).toEqual({ weekday: "fri", session: "ny" });
  });
});
