/**
 * Strategie-Studio · the local text parser (`parseStrategyText`): a table of German strategy sentences (umlauts and their
 * ae/ue spellings, comma numbers, "unter / über / kreuzt / fällt unter", negations, sections per direction, filters, exits)
 * checked against the lab rules they must become – and, as important, the parts that must NOT be guessed: unclear
 * words, open questions, visible assumptions.
 */
import { describe, expect, it } from "vitest";
import { leavesOf, nodeText, validateCustom, type CustomConfig, type Group, type StopCfg, type TargetCfg, type TfId } from "@/domain/lab";
import { parseStrategyText, pruneAnswers, TEXT_MAX, type StrategyParse, type StrategySetup } from "@/domain/strategytext";

type LeafExp = [block: string, params: Record<string, number | string>, extra?: { not?: boolean; tf?: string }];

interface Case {
  text: string;
  sides?: "long" | "short" | "both";
  interval?: TfId;
  long?: LeafExp[];
  short?: LeafExp[];
  stop?: Partial<StopCfg>;
  target?: Partial<TargetCfg>;
  exits?: { breakEven?: Record<string, unknown>; trail?: Record<string, unknown>; partial?: Record<string, unknown>; maxBars?: number; exitOnOpposite?: boolean };
  setup?: Partial<StrategySetup>;
  /** exact number of unclear parts, or patterns every one of which must be matched by some unclear part */
  unclear?: number | RegExp[];
  /** ids of the questions that must be asked */
  asks?: string[];
  ready?: boolean;
}

const RSI_L: LeafExp = ["rsi", { mode: "below", level: 30 }];

const CASES: Case[] = [
  // ── the brief's example and its relatives ──────────────────────────────────────────────────────────────
  {
    text: "Long, wenn der RSI unter 30 fällt und der Kurs über dem EMA 200 liegt, Stop 1,5 ATR, Ziel 2R, nur in der London-Session",
    sides: "long",
    interval: "4h",
    long: [["rsi", { mode: "crossDown", level: 30, len: 14 }], ["maPrice", { type: "ema", len: 200, mode: "above" }], ["timeWindow", { session: "london", weekday: "any" }]],
    stop: { kind: "atr", atr: 1.5 },
    target: { kind: "r", r: 2 },
    unclear: 0,
    ready: true,
  },
  { text: "Kaufe wenn der RSI(14) unter 30 liegt und der Kurs über der 200er EMA schließt. Stop 2 ATR, Ziel 3R.", long: [["rsi", { mode: "below", level: 30, len: 14 }], ["maPrice", { type: "ema", len: 200, mode: "above" }]], stop: { kind: "atr", atr: 2 }, target: { r: 3 }, unclear: 0 },
  { text: "Short, wenn RSI über 70 und Kurs unter SMA 50, Stop 2 %, Ziel 1,5R", sides: "short", short: [["rsi", { mode: "above", level: 70 }], ["maPrice", { type: "sma", len: 50, mode: "below" }]], stop: { kind: "percent", pct: 2 }, target: { r: 1.5 }, unclear: 0 },
  // ── umlaut / spelling variants, number words, comma and point numbers ──────────────────────────────────
  { text: "long wenn rsi unter dreissig und kurs ueber ema zweihundert, stop zwei atr, ziel drei r", long: [["rsi", { mode: "below", level: 30 }], ["maPrice", { type: "ema", len: 200, mode: "above" }]], stop: { atr: 2 }, target: { r: 3 }, unclear: 0 },
  { text: "Long wenn der Kurs ueber der EMA 50 UND der EMA 200 liegt", long: [["maPrice", { len: 50, mode: "above" }], ["maPrice", { len: 200, mode: "above" }]], unclear: 0 },
  { text: "Long, RSI < 30, Kurs > EMA 200, SL 1.5 ATR, TP 2R", long: [RSI_L, ["maPrice", { type: "ema", len: 200, mode: "above" }]], stop: { atr: 1.5 }, target: { r: 2 }, unclear: 0 },
  { text: "Wenn RSI(14) < 30 → Long", long: [RSI_L], unclear: 0 },
  { text: "Long wenn RSI kleiner als 30 und der Kurs höher als die EMA 200 ist", long: [RSI_L, ["maPrice", { mode: "above", len: 200 }]], unclear: 0 },
  { text: "Long wenn RSI sinkt unter 30 oder ist unter 25", long: [["rsi", { mode: "crossDown", level: 30 }], ["rsi", { mode: "below", level: 25 }]], unclear: 0 },
  { text: "Long, RSI (21) unter 30", long: [["rsi", { len: 21, mode: "below", level: 30 }]], unclear: 0 },
  { text: "TP 2:1 SL 1.5 ATR long rsi<30", long: [RSI_L], stop: { atr: 1.5 }, target: { r: 2 }, unclear: 0 },
  { text: "Long RSI unter 30, CRV 1:3", long: [RSI_L], target: { r: 3 }, unclear: 0 },
  { text: "Take Profit bei 3R, Stop-Loss 1% unter Einstieg, Long wenn RSI unter 30", long: [RSI_L], stop: { kind: "percent", pct: 1 }, target: { r: 3 }, unclear: 0 },
  // ── indicators ────────────────────────────────────────────────────────────────────────────────────────
  { text: "Long wenn EMA 21 kreuzt EMA 55 nach oben, Stop 1 ATR, Ziel 2R auf dem 1h Chart", interval: "1h", long: [["maCross", { type: "ema", fast: 21, slow: 55, mode: "up" }]], stop: { atr: 1 }, unclear: 0 },
  { text: "Long wenn die EMA 20 und die EMA 50 sich nach oben kreuzen", long: [["maCross", { fast: 20, slow: 50, mode: "up" }]], unclear: 0 },
  { text: "Goldenes Kreuz Long, Stop 2 ATR", long: [["maCross", { type: "sma", fast: 50, slow: 200, mode: "up" }]], stop: { atr: 2 }, unclear: 0 },
  { text: "Long wenn der MACD die Signallinie nach oben kreuzt und der RSI nicht über 70 ist", long: [["macd", { mode: "crossUp" }], ["rsi", { mode: "above", level: 70 }, { not: true }]], unclear: 0 },
  { text: "Long wenn macd über null", long: [["macd", { mode: "aboveZero" }]], unclear: 0 },
  { text: "Long wenn MACD Histogramm positiv und steigend", long: [["macd", { mode: "histPos" }], ["macd", { mode: "histRising" }]], unclear: 0 },
  { text: "Long wenn RSI über 50, dann kreuzt MACD nach oben", long: [["rsi", { mode: "above", level: 50 }], ["macd", { mode: "crossUp" }]], unclear: 0 },
  { text: "Long bei Bollinger unteres Band berührt und Volumen doppelt so hoch wie der Durchschnitt, Stop 1,5 ATR", long: [["bollinger", { mode: "touchLower" }], ["volume", { mult: 2 }]], unclear: 0 },
  { text: "Short wenn der Kurs unter dem unteren Bollinger Band schließt", sides: "short", short: [["bollinger", { mode: "closeBelow" }]], unclear: 0 },
  { text: "Long wenn der Kurs nicht über der oberen Bollinger Band liegt", long: [["bollinger", { mode: "closeAbove" }, { not: true }]], unclear: 0 },
  { text: "Long wenn die Bollinger Bänder eng sind (Squeeze) und Kurs über EMA 20", long: [["bollinger", { mode: "squeeze" }], ["maPrice", { len: 20, mode: "above" }]], unclear: 0 },
  { text: "Long wenn Preis über VWAP und Volumen über dem 1,5-fachen", long: [["vwap", { mode: "above" }], ["volume", { mult: 1.5 }]], unclear: 0 },
  { text: "Long wenn CCI unter -100 und Williams %R unter -80", long: [["cci", { mode: "below", level: -100 }], ["willr", { mode: "below", level: -80 }]], unclear: 0 },
  { text: "Short wenn Stochastic %K kreuzt %D nach unten über 80", sides: "short", short: [["stoch", { mode: "kdDown", zone: "extreme" }]], unclear: 0 },
  { text: "Long wenn ADX über 25 und Supertrend dreht nach oben", long: [["adx", { mode: "adxAbove", level: 25 }], ["supertrend", { mode: "flipUp" }]], unclear: 0 },
  { text: "Long wenn Inside Bar nach oben ausbricht", long: [["insideBar", { mode: "breakUp" }]], unclear: 0 },
  { text: "Long wenn Heikin Ashi 3 grüne Kerzen in Folge", long: [["heikin", { mode: "bull", n: 3 }]], unclear: 0 },
  { text: "Long wenn ATR hoch ist", long: [["atrPct", { mode: "above" }]], unclear: 0 },
  { text: "Long wenn RSI-Trendlinie nach oben gebrochen wird", long: [["rsiLine", { mode: "breakUp" }]], unclear: 0 },
  { text: "Handle Ausbruch über das 20-Kerzen-Hoch mit Volumenbestätigung, Long, Stop unter dem Swing-Tief, Ziel 3R", long: [["breakout", { mode: "up", n: 20 }], ["volume", {}]], stop: { kind: "swing" }, target: { r: 3 }, unclear: 0 },
  { text: "Long mit Donchian 20 Ausbruch", long: [["donchian", { len: 20, mode: "breakUp" }]], unclear: 0 },
  { text: "Long wenn Schlusskurs über 65.000, Stop 2 %", long: [["keyLevel", { level: 65000, mode: "closeAbove" }]], stop: { pct: 2 }, unclear: 0 },
  { text: "Wenn der Kurs den Widerstand bei 70000 bricht, kaufe ich", long: [["keyLevel", { level: 70000, mode: "crossAbove" }]], unclear: 0 },
  { text: "Long wenn RSI zwischen 30 und 50, nicht am Wochenende", long: [["rsi", { mode: "above", level: 30 }], ["rsi", { mode: "below", level: 50 }], ["timeWindow", { session: "weekend" }, { not: true }]], unclear: 0 },
  { text: "Long wenn RSI(7) kreuzt 30 nach oben innerhalb der letzten 3 Kerzen", long: [["rsi", { len: 7, mode: "crossUp", level: 30, within: 3 }]], unclear: 0 },
  { text: "Long wenn der RSI auf dem Stundenchart unter 30 fällt und der Kurs im Tageschart über der EMA 200 liegt", sides: "long", interval: "1h", long: [["rsi", { mode: "crossDown" }, { tf: "exec" }], ["maPrice", { len: 200 }, { tf: "1d" }]], asks: [], unclear: 0 },
  // ── negations ──────────────────────────────────────────────────────────────────────────────────────────
  { text: "Long wenn RSI nicht unter 30 liegt", long: [["rsi", { mode: "below", level: 30 }, { not: true }]], unclear: 0 },
  { text: "Long wenn RSI unter 30 und kein Volumen-Spike", long: [RSI_L, ["volume", {}, { not: true }]], unclear: 0 },
  { text: "Kaufen, wenn der Preis nicht unter dem SMA 100 liegt", long: [["maPrice", { type: "sma", len: 100, mode: "below" }, { not: true }]], unclear: 0 },
  { text: "Long wenn Kurs unter EMA 200 liegt und RSI unter 30 und nicht in der Asien-Session", long: [["maPrice", { mode: "below" }], RSI_L, ["timeWindow", { session: "asia" }, { not: true }]], unclear: 0 },
  { text: "Long RSI unter 30 und nicht Freitag", long: [RSI_L, ["timeWindow", { weekday: "fri" }, { not: true }]], unclear: 0 },
  { text: "Short, wenn RSI über 70 und das Wochenende ausgeschlossen", sides: "short", short: [["rsi", { mode: "above" }], ["timeWindow", { session: "weekend" }, { not: true }]], unclear: 0 },
  { text: "Long ohne Wochenende, RSI unter 30", long: [RSI_L, ["timeWindow", { session: "weekend" }, { not: true }]], unclear: 0 },
  { text: "Nur Long. Kein Short. RSI unter 30", sides: "long", long: [RSI_L], unclear: 0 },
  // ── directions and sections ────────────────────────────────────────────────────────────────────────────
  { text: "Long: RSI unter 30. Short: RSI über 70. Beide mit Stop 1,5 ATR und Ziel 2R", sides: "both", long: [RSI_L], short: [["rsi", { mode: "above", level: 70 }]], stop: { atr: 1.5 }, target: { r: 2 }, unclear: 0, ready: true },
  { text: "Wenn RSI unter 30, dann long, wenn RSI über 70, dann short", sides: "both", long: [RSI_L], short: [["rsi", { mode: "above", level: 70 }]], unclear: 0 },
  { text: "Long und Short wenn der Kurs über EMA 200 kreuzt", sides: "both", long: [["maPrice", { mode: "crossUp", len: 200 }]], unclear: 0 },
  { text: "Verkaufe, wenn RSI überkauft", sides: "short", short: [["rsi", { mode: "above", level: 70 }]], unclear: 0 },
  { text: "Ich kaufe wenn der RSI überverkauft ist", long: [RSI_L], unclear: 0 },
  // ── time filters ───────────────────────────────────────────────────────────────────────────────────────
  { text: "Long nur Dienstag bis Donnerstag, wenn RSI unter 40", long: [["rsi", { level: 40 }]], unclear: 0 },
  { text: "Long wenn RSI unter 30 in der London und New York Session", long: [RSI_L], unclear: 0 },
  { text: "Kaufe bei RSI unter 30 aber nur am Montag", long: [RSI_L, ["timeWindow", { weekday: "mon" }]], unclear: 0 },
  { text: "Montag bis Freitag, Long wenn RSI unter 35, Zeitstop nach 20 Kerzen", long: [["rsi", { level: 35 }], ["timeWindow", { session: "weekend" }, { not: true }]], exits: { maxBars: 20 }, unclear: 0 },
  // ── exits and management ───────────────────────────────────────────────────────────────────────────────
  {
    text: "Long wenn Schlusskurs über 65.000, Stop 2 %, Break-even bei 1R, Trailing Stop 2 ATR, Teilgewinn 50 % bei 1R",
    long: [["keyLevel", { level: 65000 }]],
    stop: { kind: "percent", pct: 2 },
    exits: { breakEven: { on: true, trigger: "r", value: 1 }, trail: { on: true, kind: "atr", value: 2 }, partial: { on: true, atR: 1, fracPct: 50 } },
    unclear: 0,
  },
  { text: "Long wenn RSI unter 30, Stop 1,5 ATR, Ziel 2R, Stop auf Break-even bei +1R, Trailing 1,5 ATR ab 1,5R", long: [RSI_L], exits: { breakEven: { on: true, value: 1 }, trail: { on: true, kind: "atr", value: 1.5, activateR: 1.5 } }, unclear: 0 },
  { text: "Long wenn RSI unter 30, Hälfte der Position bei 1R verkaufen, Rest mit Trailing Stop 2 ATR", long: [RSI_L], exits: { partial: { on: true, atR: 1, fracPct: 50 }, trail: { on: true, value: 2 } }, unclear: 0 },
  { text: "Long mit Trailing-Stop 2 % und Break-even bei 2 %", exits: { breakEven: { on: true, trigger: "pct", value: 2 }, trail: { on: true, kind: "pct", value: 2 } }, ready: false, asks: ["needs:long"] },
  { text: "Long wenn RSI unter 30, nach 12 Stunden raus, Gegensignal Ausstieg", long: [RSI_L], exits: { maxBars: 3, exitOnOpposite: true }, unclear: 0 },
  { text: "Long wenn RSI unter 30, Zeitstop 3 Tage", long: [RSI_L], exits: { maxBars: 18 }, unclear: 0 },
  { text: "Long wenn RSI unter 30, kein Ziel, Trailing Stop 2 ATR", long: [RSI_L], target: { kind: "none" }, exits: { trail: { on: true } }, unclear: 0 },
  // ── market, risk, period, timeframe ────────────────────────────────────────────────────────────────────
  { text: "Long, RSI < 30, Kurs > EMA 200, SL 1.5 ATR, TP 2R, Risiko 1 % pro Trade, ETH, 4h, letzte 6 Monate", interval: "4h", setup: { symbol: "ETHUSDT", riskPct: 1, period: "6m" }, unclear: 0 },
  { text: "Long RSI unter 30 Risiko 0,5%", setup: { riskPct: 0.5 }, unclear: 0 },
  { text: "Long wenn BTC/USDT 4h RSI unter 30", setup: { symbol: "BTCUSDT" }, interval: "4h", unclear: 0 },
  { text: "Long auf SOL wenn RSI unter 30", setup: { symbol: "SOLUSDT" }, unclear: 0 },
  { text: "Zeitrahmen 1h, Long, RSI unter 30", interval: "1h", unclear: 0 },
  { text: "RSI 14 unter 30 auf 15 Minuten, long", interval: "15m", long: [["rsi", { len: 14, mode: "below", level: 30 }]], unclear: 0 },
  { text: "Long wenn RSI unter 30, über 2 Jahre", setup: { period: "2y" }, unclear: 0 },
  // ── mixed AND / OR, never guessed ──────────────────────────────────────────────────────────────────────
  { text: "Long wenn RSI unter 30 oder MACD kreuzt nach oben und Kurs über EMA 200", asks: ["op:long"], unclear: 0 },
  { text: "Wenn RSI unter 30 UND (Kurs über EMA 200 ODER MACD über 0), dann long", asks: ["op:long"], unclear: 0 },
  { text: "Long wenn RSI unter 30 oder RSI über 80", unclear: 0, asks: [] },
  // ── open questions and unclear parts (nothing is guessed) ──────────────────────────────────────────────
  { text: "Kaufe wenn RSI bei 30 ist", ready: false, asks: ["needs:long"], unclear: [/RSI 30/] },
  { text: "Wenn der Kurs über dem 200er Durchschnitt liegt und RSI überverkauft ist, dann Long", long: [["maPrice", { type: "sma", len: 200 }], RSI_L], asks: ["matype"], unclear: 0 },
  { text: "Long wenn der Kurs über dem gleitenden Durchschnitt 100 liegt", long: [["maPrice", { type: "sma", len: 100 }]], asks: ["matype"], unclear: 0 },
  { text: "Long wenn EMA 50 über EMA 200 und Kurs über EMA 50", long: [["maPrice", { len: 50 }]], unclear: [/Zustand zweier Durchschnitte/] },
  { text: "Kaufe den Aufwärtstrend im Pullback, Stop eng", ready: false, asks: ["needs:long", "trend"], unclear: [/Trend/, /Pullback/, /Stop/] },
  { text: "Long wenn Hammer Kerze am Support", ready: false, unclear: [/Kerzenmuster/, /Support/] },
  { text: "Ich will Bitcoin handeln, wenn der RSI unter 30 fällt", asks: ["side"], ready: false, setup: { symbol: "BTCUSDT" } },
  { text: "Mach was Gutes mit Bitcoin", ready: false, asks: ["side", "needs:long"], unclear: [/keiner Regel/] },
  { text: "Long, wenn RSI unter 30 ist, von 8 bis 12 Uhr", long: [RSI_L], asks: ["clock"], unclear: [/Uhrzeiten/] },
  { text: "Long wenn RSI unter 30 ohne Stop", long: [RSI_L], stop: { atr: 1.5 }, unclear: [/nie ohne Stop/] },
  { text: "Long wenn RSI unter 30, Stop 100 ATR, Ziel 50 R", long: [RSI_L], stop: { atr: 1.5 }, target: { r: 2 }, unclear: [/Stop 100/, /Ziel 50/] },
  { text: "Long wenn RSI unter 150", ready: false, unclear: [/außerhalb des Bereichs/] },
  { text: "Long wenn RSI unter 30 und Volumen niedrig", long: [RSI_L], unclear: [/niedriges Volumen/] },
  { text: "Long wenn EMA 9 über SMA 21 kreuzt", ready: false, unclear: [/EMA und SMA/] },
  { text: "Long wenn RSI unter 30, Frankfurt-Session", long: [RSI_L], asks: ["session-other"], unclear: [/Session/] },
  { text: "Long wenn Orderflow positiv ist", ready: false, unclear: [/Historie/] },
];

const leafOf = (l: ReturnType<typeof leavesOf>[number]): LeafExp => [l.block, l.params, { not: l.not === true, tf: l.tf }];

function expectLeaves(group: Group, want: LeafExp[], label: string): void {
  const got = leavesOf(group).filter((l) => want.length === 0 || true);
  // the expected list is a subsequence of the leaves in order (extra time filters etc. may follow)
  let at = 0;
  for (const w of want) {
    let found = false;
    for (; at < got.length; at++) {
      const g = leafOf(got[at]!);
      if (g[0] !== w[0]) continue;
      const ok = Object.entries(w[1]).every(([k, v]) => g[1][k] === v) && (w[2]?.not === undefined || g[2]!.not === w[2].not) && (w[2]?.tf === undefined || g[2]!.tf === w[2].tf);
      if (ok) {
        found = true;
        at++;
        break;
      }
    }
    expect(found, `${label}: ${w[0]} ${JSON.stringify(w[1])} not found in [${got.map((l) => `${l.block}${JSON.stringify(l.params)}`).join(" | ")}]`).toBe(true);
  }
}

describe("parseStrategyText · table", () => {
  for (const c of CASES) {
    it(c.text, () => {
      const r = parseStrategyText(c.text);
      const cfg: CustomConfig = r.rules;
      if (c.sides) expect(cfg.sides).toBe(c.sides);
      if (c.interval) expect(cfg.interval).toBe(c.interval);
      if (c.long) expectLeaves(cfg.long, c.long, "long");
      if (c.short) expectLeaves(cfg.short, c.short, "short");
      if (c.stop) expect(cfg.stop).toMatchObject(c.stop);
      if (c.target) expect(cfg.target).toMatchObject(c.target);
      if (c.exits?.breakEven) expect(cfg.exits.breakEven).toMatchObject(c.exits.breakEven);
      if (c.exits?.trail) expect(cfg.exits.trail).toMatchObject(c.exits.trail);
      if (c.exits?.partial) expect(cfg.exits.partial).toMatchObject(c.exits.partial);
      if (c.exits?.maxBars !== undefined) expect(cfg.exits.maxBars).toBe(c.exits.maxBars);
      if (c.exits?.exitOnOpposite !== undefined) expect(cfg.exits.exitOnOpposite).toBe(c.exits.exitOnOpposite);
      if (c.setup) expect(r.setup).toMatchObject(c.setup);
      if (typeof c.unclear === "number") expect(r.unclear.map((u) => `${u.phrase}: ${u.why}`), "unclear").toHaveLength(c.unclear);
      else if (c.unclear) for (const re of c.unclear) expect(r.unclear.some((u) => re.test(`${u.phrase} ${u.why}`)), `unclear ${re} in ${JSON.stringify(r.unclear)}`).toBe(true);
      for (const id of c.asks ?? []) expect(r.asks.map((a) => a.id), `asks ${id}`).toContain(id);
      if (c.ready !== undefined) expect(r.ready).toBe(c.ready);
      // the lab accepts what is handed over as ready (errors are the lab's own, unchanged)
      if (r.ready) expect(validateCustom(cfg).filter((i) => i.level === "error")).toEqual([]);
    });
  }
  it("covers more than forty sentences", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });
});

describe("parseStrategyText · what the trader reads", () => {
  const text = "Long, wenn der RSI unter 30 fällt und der Kurs über dem EMA 200 liegt, Stop 1,5 ATR, Ziel 2R, nur in der London-Session";
  const r = parseStrategyText(text);

  it("marks the trader's own words: every phrase is a span of the original text", () => {
    expect(r.understood.length).toBeGreaterThanOrEqual(6);
    for (const u of r.understood) {
      expect(text.slice(u.span.start, u.span.end).trim(), u.id).toBe(u.phrase);
      expect(u.meaning.length).toBeGreaterThan(3);
    }
    const byKind = Object.fromEntries(r.understood.map((u) => [u.kind + u.phrase.slice(0, 3), u.meaning]));
    expect(Object.values(byKind)).toEqual(expect.arrayContaining(["RSI(14) kreuzt nach unten 30", "Schluss über EMA 200", "Stop: 1,5 × ATR(14)", "Ziel bei 2 R", "Kerze öffnet in der Session London (UTC)"]));
    const phrases = r.understood.map((u) => u.phrase);
    expect(phrases).toEqual(expect.arrayContaining(["Long", "RSI unter 30 fällt", "Kurs über dem EMA 200 liegt", "Stop 1,5 ATR", "Ziel 2R", "nur in der London-Session"]));
  });

  it("lists every default as a visible, changeable assumption", () => {
    const ids = r.assumptionItems.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["interval", "within", "rsilen"]));
    for (const a of r.assumptionItems.filter((x) => x.options.length)) {
      expect(a.value, a.id).not.toBeNull();
      expect(a.options.map((o) => o.id)).toContain(a.value);
    }
    expect(r.assumptions).toHaveLength(r.assumptionItems.length);
    expect(r.questions).toHaveLength(r.asks.length);
  });

  it("keeps the flat shape the brief names", () => {
    expect(Object.keys(r)).toEqual(expect.arrayContaining(["rules", "understood", "unclear", "questions", "assumptions"]));
    expect(r.source).toBe("local");
  });

  it("never reads the same words twice (the stop's ATR is no volatility filter)", () => {
    expect(leavesOf(r.rules.long).map((l) => l.block)).toEqual(["rsi", "maPrice", "timeWindow"]);
  });
});

describe("parseStrategyText · answers complete the rules", () => {
  it("a side answer unblocks a text without direction", () => {
    const text = "Wenn der RSI unter 30 fällt";
    const open = parseStrategyText(text);
    expect(open.ready).toBe(false);
    expect(open.asks.find((a) => a.id === "side")?.blocking).toBe(true);
    const short = parseStrategyText(text, { answers: { side: "short" } });
    expect(short.rules.sides).toBe("short");
    expect(short.ready).toBe(true);
    expect(short.asks.find((a) => a.id === "side")?.chosen).toBe("short");
    const both = parseStrategyText(text, { answers: { side: "both" } });
    expect(both.rules.sides).toBe("both");
    expect(nodeText(both.rules.short)).toBe("RSI(14) kreuzt nach oben 70");
  });

  it("an EMA/SMA answer changes the average; an unanswered question uses the named provisional reading", () => {
    const text = "Long wenn Kurs über dem 200er Durchschnitt liegt";
    expect(leavesOf(parseStrategyText(text).rules.long)[0]!.params.type).toBe("sma");
    const ema = parseStrategyText(text, { answers: { matype: "ema" } });
    expect(leavesOf(ema.rules.long)[0]!.params.type).toBe("ema");
    expect(ema.asks.find((a) => a.id === "matype")?.chosen).toBe("ema");
  });

  it("a mixed AND / OR chain is read 'und' first by default and 'oder' first on request", () => {
    const text = "Long wenn RSI unter 30 oder MACD kreuzt nach oben und Kurs über EMA 200";
    const def = parseStrategyText(text);
    expect(nodeText(def.rules.long)).toBe("(RSI(14) unter 30 ODER (MACD(12,26,9) kreuzt die Signallinie nach oben UND Schluss über EMA 200))");
    const alt = parseStrategyText(text, { answers: { "op:long": "or-first" } });
    expect(nodeText(alt.rules.long)).toBe("(RSI(14) unter 30 ODER MACD(12,26,9) kreuzt die Signallinie nach oben) UND Schluss über EMA 200");
  });

  it("assumption chips change interval, stop, target and the event window", () => {
    const r = parseStrategyText("Long wenn RSI unter 30 fällt", {
      answers: { interval: "1h", stop: "pct2", target: "r3", within: "3", rsilen: "21" },
    });
    expect(r.rules.interval).toBe("1h");
    expect(r.rules.stop).toMatchObject({ kind: "percent", pct: 2 });
    expect(r.rules.target).toMatchObject({ kind: "r", r: 3 });
    expect(leavesOf(r.rules.long)[0]!.params).toMatchObject({ within: 3, len: 21 });
    expect(r.assumptionItems.find((a) => a.id === "interval")?.value).toBe("1h");
  });

  it("a trend word stays unclear until the trader picks what 'Trend' means", () => {
    const text = "Long im Aufwärtstrend wenn RSI unter 30";
    expect(parseStrategyText(text).unclear.some((u) => /Trend/.test(u.why))).toBe(true);
    const r = parseStrategyText(text, { answers: { trend: "ema200" } });
    const trend = leavesOf(r.rules.long).find((l) => l.block === "maPrice");
    expect(trend?.params).toMatchObject({ type: "ema", len: 200, mode: "above" });
    expect(trend?.tf).toBe("1d");
  });

  it("an RSI without a relation becomes a rule once the trader picks one", () => {
    const text = "Kaufe wenn RSI bei 30 ist";
    const open = parseStrategyText(text);
    const ask = open.asks.find((a) => a.id.startsWith("rel:"))!;
    expect(ask.options.map((o) => o.id)).toContain("below:30");
    const r = parseStrategyText(text, { answers: { [ask.id]: "crossUp:30" } });
    expect(leavesOf(r.rules.long)[0]!.params).toMatchObject({ mode: "crossUp", level: 30 });
    expect(r.ready).toBe(true);
  });

  it("a state of two averages becomes the rule of the trader's choice", () => {
    const text = "Long wenn EMA 50 über EMA 200";
    const ask = parseStrategyText(text).asks.find((a) => a.id.startsWith("mastate:"))!;
    expect(parseStrategyText(text, { answers: { [ask.id]: "cross" } }).rules.long.children.length).toBe(1);
    const price = parseStrategyText(text, { answers: { [ask.id]: "price" } });
    expect(leavesOf(price.rules.long)[0]!.params).toMatchObject({ len: 200, mode: "above" });
  });

  it("'Beide Richtungen' mirrors the short side and says so; the trader can switch it off", () => {
    const text = "In beide Richtungen: RSI unter 30";
    const r = parseStrategyText(text);
    expect(r.rules.sides).toBe("both");
    expect(nodeText(r.rules.short)).toBe("RSI(14) über 70");
    expect(r.assumptionItems.some((a) => a.id === "mirror")).toBe(true);
    expect(parseStrategyText(text, { answers: { mirror: "long" } }).rules.sides).toBe("long");
  });

  it("drops answers whose question is gone", () => {
    const r = parseStrategyText("Long wenn RSI unter 30");
    expect(pruneAnswers(r, { matype: "ema", interval: "1h", "op:long": "or-first" })).toEqual({ interval: "1h" });
  });
});

describe("parseStrategyText · honesty and robustness", () => {
  it("is deterministic and does not touch its input", () => {
    const text = "Long wenn RSI unter 30 und Kurs über EMA 200";
    const answers = { interval: "1h" };
    const a = parseStrategyText(text, { answers });
    const b = parseStrategyText(text, { answers });
    expect(a).toEqual(b);
    expect(answers).toEqual({ interval: "1h" });
  });

  it("empty and nonsense text give an empty, honest result", () => {
    for (const t of ["", "   ", "asdf qwer", "Hallo Welt"]) {
      const r = parseStrategyText(t);
      expect(r.ready, t).toBe(false);
      expect(r.understood.filter((u) => u.kind === "condition")).toEqual([]);
      expect(r.asks.some((a) => a.blocking)).toBe(true);
    }
  });

  it("reads at most TEXT_MAX characters and says so", () => {
    const r = parseStrategyText(`Long wenn RSI unter 30. ${"x ".repeat(TEXT_MAX)}`);
    expect(r.unclear.some((u) => /länger als/.test(u.why))).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(TEXT_MAX);
  });

  it("never throws on odd characters", () => {
    for (const t of ["RSI <<< 30 >>> ???", "💥 Long 💥 RSI unter 30 💥", "Long wenn RSI unter 3O", "((((((", "Stop Stop Stop Ziel Ziel", "RSI unter 30 und und und oder oder", "Kurs Kurs Kurs"]) {
      expect(() => parseStrategyText(t), t).not.toThrow();
    }
  });

  it("every parse result is a valid lab configuration (shape, ids, ranges)", () => {
    for (const c of CASES) {
      const r: StrategyParse = parseStrategyText(c.text);
      expect(r.rules.version).toBe(1);
      expect(r.rules.long.id).toBe("g1");
      expect(r.rules.short.id).toBe("g2");
      const ids = [r.rules.long, r.rules.short].flatMap((g) => leavesOf(g).map((l) => l.id));
      expect(new Set(ids).size, c.text).toBe(ids.length);
    }
  });

  it("uses the lab's own wording: no number comes from a model, the text is the lab's leaf text", () => {
    const r = parseStrategyText("Long wenn RSI unter 30");
    expect(r.understood.find((u) => u.kind === "condition")?.meaning).toBe(nodeText(r.rules.long));
  });
});
