/**
 * The assistant's evaluation tools: Prüfbericht / Belastung, Forward-Test, Trendlinien, Signale, Monatsnutzen, ähnliche
 * Situationen, „Passt zu dir?“, Strategie-Bibliothek. Routing (3–5 phrasings each, typos, no false hits on the journal
 * questions or on the tools that already exist) and the answers on fixture data – the figures in the expectations are
 * counted by hand in the comments, none is taken from the code under test. The data comes in through `ToolEnv.insight`
 * (no store, no candle feed, no clock); a few tests read the real stores to prove the default sources.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runStats, type BtTrade, type LabResult, type RunFunnel } from "@/domain/backtest/index";
import { defaultCustom } from "@/domain/lab/rules/tree";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import { newAccount, withAccounts, type ForwardAccount, type ForwardCompare, type StoredTrade } from "@/domain/forward";
import { KEY_TIMEFRAMES, type KeyTf } from "@/domain/keylevels";
import type { SignalOutcome } from "@/domain/missed";
import type { TrendlineAnalysis, TrendLineView } from "@/domain/trendlines";
import type { SimilarResult } from "@/domain/similar";
import type { ScenarioRow, ScenarioStats } from "@/domain/lab/stress/types";
import type { FilterCompare } from "@/domain/lab/filters";
import { respond, settled, type EngineEnv, type Reply } from "@/assistant/engine";
import { findCards, draftOfCard, valuesLine } from "@/assistant/insights/library";
import { periodMentioned } from "@/assistant/insights/period";
import type { InsightInputs } from "@/assistant/insights/types";
import { forgetInterests, interestsOf, removeInterest } from "@/assistant/interests";
import { EMPTY_MEMORY, learnInterest } from "@/assistant/memory";
import { INTEREST_QUESTION, suggestFor, topicLabel, type ToolReply } from "@/assistant/tools";
import { understand, type Plan } from "@/assistant/understand";
import { useLabor, __resetLabor } from "@/views/labor/laborStore";
import { useExtras, __resetExtras } from "@/views/labor/extrasStore";
import { COACH_SETTINGS, at, ct, enrichC } from "./coach.fixtures";
import { idea as fitIdea, journalRaw } from "./fit.fixtures";
import { chain, H as H_S, T0 } from "./lab.extras.helpers";
import { signalEvent } from "./missed.fixtures";

const NOW = new Date(at(3, 720)).getTime(); // Thursday 05.03.2026 12:00 local
const PARSE = { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: [], now: NOW };
const u = (q: string, prevTool: { tool: never; question: string } | null = null): Plan => understand(q, { parse: PARSE, prev: null, closed: 20, ...(prevTool ? { prevTool } : {}) });
const route = (q: string): string => {
  const p = u(q);
  return p.kind === "tool" ? p.tool : p.kind;
};

/* ------------------------------------------------------------------ routing */

const ROUTES: Record<string, string[]> = {
  audit: ["Hängt mein Backtest an wenigen Trades?", "Ist der Backtest nur wegen ein paar Ausreißern gut?", "Wie sieht der Prüfbericht aus?", "Haengt mein Backtst an einzelnen Gewinn-Trades?", "Gibt es Datenlücken im Backtest?"],
  stress: ["Wie lang war die längste Verlustserie?", "Wie viele Verlusttrades hintereinander im Backtest?", "Längste Verlustserie im Labor-Lauf", "Was passiert im Backtest bei doppelten Gebühren?", "Zeig mir den Belastungstets", "Wie tief war der Drawdown im Backtest?"],
  forward: ["Wie läuft mein Forward-Test?", "Hält das virtuelle Konto, was der Backtest zeigt?", "Forwadtest Ergebnis", "Wie steht mein Vorwärtstest?"],
  trend: ["Welche Zeiteinheiten haben eine Preis-Trendlinie in Annäherung?", "Gibt es einen Trendlinien-Bruch?", "Wie weit ist der Kurs von der nächsten Linie?", "Welche Zeiteinheiten sind gesperrt und warum?", "Trendlinine Retest"],
  signals: ["Welche Signale habe ich diese Woche ausgelassen und warum?", "Welche verpassten Signale hatten das Ziel zuerst?", "Wie ist die Trefferquote meiner Box-Setups?", "Singale diese Woche ausgelassen?", "Zeig mir meinen Signal-Posteingang"],
  quality: ["Wie lange war die App letzten Monat offen?", "Gab es Alarme mit mehr als 5 Minuten Verspätung?", "Wie zuverlässig sind meine Alarme?"],
  benefit: ["Was hat mir das Journal im September gebracht?", "Was bringt mir das Journal?", "Hat sich das Journal diesen Monat gelohnt?", "Was hat mir das Jurnal im Septmber gebarcht?"],
  situation: ["Wie ging es nach ähnlichen Situationen weiter?", "Wie oft ist der Kurs nach ähnlichen Kerzen gestiegen?", "Gibt es Gegenbeispiele zu ähnlichen Lagen?", "Was passierte nach vergleichbaren Situationen?"],
  fit: ["Passt diese Strategie zu mir?", "Passt der Backtest zu meinem Handelsstil?", "Ist diese Idee geeignet für mich?", "Pasts die Strategie zu mir?"],
  demands: ["Was verlangt die Idee von mir?", "Was muss ich für diese Strategie aushalten?", "Welche Anforderungen stellt der Backtest an mich?"],
  library: ["Gibt es eine Strategie mit Bollinger?", "Welche Werte nimmt man für die Supertrend-Strategie?", "Kennst du eine Strategie mit RSI?", "Zeig mir die Strategie-Bibliothek", "Gibts ne Strategie mit Bolinger?"],
};

describe("routing of the evaluation tools", () => {
  for (const [tool, phrasings] of Object.entries(ROUTES)) {
    it.each(phrasings)(`%s → ${tool}`, (q) => {
      expect(route(q)).toBe(tool);
    });
  }

  it("a plan carries the question as its argument and the learned topic", () => {
    const p = u("Hängt mein Backtest an wenigen Trades?");
    expect(p).toMatchObject({ kind: "tool", tool: "audit", topic: "audit", arg: "Hängt mein Backtest an wenigen Trades?" });
    expect(u("Hält das virtuelle Konto, was der Backtest zeigt?")).toMatchObject({ topic: "forward" });
    expect(u("Passt diese Strategie zu mir?")).toMatchObject({ topic: "fit" });
    expect(u("Was verlangt die Idee von mir?")).toMatchObject({ topic: "fit" });
  });

  it("journal questions stay journal questions", () => {
    for (const q of ["Win-Rate am Montag", "Wie ist meine Win-Rate am Montag?", "Wie war letzte Woche?", "Wie viel habe ich im September verdient?", "Was lief gut?", "Wie lang war meine längste Verlustserie?", "Wie ist meine Trefferquote bei Breakout?", "Ø R pro Setup", "Welche Strategie ist meine beste?", "Zeig mir meine Shorts von gestern", "Wie war der maximale Drawdown der Strategie Breakout?"]) expect(route(q), q).toBe("journal");
  });

  it("leaves the tools that already exist alone", () => {
    expect(route("Wo finde ich den Belastungstest?")).toBe("where");
    expect(route("Wo finde ich den Prüfbericht?")).toBe("where");
    expect(route("Wo finde ich die Strategie-Bibliothek?")).toBe("where");
    expect(route("Wo ist der Forward-Test?")).toBe("where");
    expect(route("Zeig mir ähnliche Situationen")).toBe("similar");
    expect(route("gab es schon mal eine ähnliche Marktlage?")).toBe("similar");
    expect(route("Teste diese Idee")).toBe("idea");
    expect(route("Ich will üben")).toBe("train");
    expect(route("Warum ist mein Backtest so schlecht?")).toBe("lab");
    expect(route("Was fehlt für meinen Einstieg?")).toBe("entry");
    expect(route("Wie läuft mein Wochenexperiment?")).toBe("experiment");
    expect(route("Merk dir: ich teste nur Strategien mit Bollinger")).toBe("memory");
    expect(route("öffne das Labor")).toBe("navigate");
  });

  it("a short follow-up continues the last evaluation with the new period", () => {
    const prev = { tool: "signals" as never, question: "Welche Signale habe ich diese Woche ausgelassen und warum?" };
    const p = u("und letzte Woche?", prev);
    expect(p).toMatchObject({ kind: "tool", tool: "signals", topic: "signals", arg: `${prev.question} und letzte Woche?` });
    // without a previous evaluation it is a plain journal follow-up question
    expect(u("und letzte Woche?").kind).toBe("journal");
    // a new question with its own tool is not swallowed by the follow-up
    expect(u("und wie läuft mein Forward-Test?", prev)).toMatchObject({ tool: "forward" });
  });

  it("the period of a question: the last mention wins, a month without a year is the latest one that has begun", () => {
    // NOW = Thursday 05.03.2026
    expect(periodMentioned("welche signale diese woche und letzte woche", NOW)?.period.key).toBe("2026-W09");
    expect(periodMentioned("was hat mir das journal im september gebracht", NOW)?.period.key).toBe("2025-09");
    expect(periodMentioned("im maerz", NOW)?.period.key).toBe("2026-03");
    expect(periodMentioned("im oktober 2024", NOW)?.period.key).toBe("2024-10");
    expect(periodMentioned("letzten monat", NOW)?.period.key).toBe("2026-02");
    expect(periodMentioned("wie ist es heute", NOW)?.period.key).toBe("2026-03-05");
    expect(periodMentioned("wie lang war die serie", NOW)).toBeNull();
  });
});

/* ------------------------------------------------------------------ harness */

function mk(insight: InsightInputs = {}, over: Partial<EngineEnv> = {}) {
  const spies = { go: vi.fn(), openFeature: vi.fn(), openSpot: vi.fn(), openReport: vi.fn(), similar: vi.fn(), applyIdea: vi.fn(() => true), openLibrary: vi.fn(), setMem: vi.fn() };
  const env: EngineEnv = {
    data: { closed: [], settings: COACH_SETTINGS, events: [], now: NOW, currency: "USDT", start: 20_000 },
    prev: null,
    mem: EMPTY_MEMORY,
    signal: { state: "loading", snapshot: null, message: null, updatedAt: null } as unknown as EngineEnv["signal"],
    recs: () => [],
    lab: null,
    newTrade: () => undefined,
    now: NOW,
    insight,
    ...spies,
    ...over,
  };
  return { env, spies };
}

async function ask(q: string, env: EngineEnv): Promise<ToolReply> {
  const turn = respond(q, env);
  expect(turn.later, `${q}: an evaluation tool answers later`).toBeDefined();
  const replies: Reply[] = await settled(turn);
  const r = replies[0];
  if (r?.kind !== "tool") throw new Error(`not a tool reply: ${r?.kind}`);
  return r.reply;
}

const act = (r: ToolReply, label: RegExp | string): (() => void) => {
  const a = r.actions.find((x) => (typeof label === "string" ? x.label === label : label.test(x.label)));
  if (!a) throw new Error(`no action ${String(label)} in ${r.actions.map((x) => x.label).join(" | ")}`);
  return a.run;
};

/* ------------------------------------------------------------------ Prüfbericht and Belastung */

const funnel = (over: Partial<RunFunnel> = {}): RunFunnel => ({ examined: 1000, nodes: [], edges: null, conflicts: null, candidates: null, blockedByPosition: null, signals: 0, skippedGap: 0, skippedRisk: 0, executed: 0, ...over });
const TO = T0 + 300 * H_S * 1000;
function labResult(trades: BtTrade[], over: Partial<LabResult> = {}): LabResult {
  const stats = runStats({ trades, equity: [], from: T0, to: TO, capital: 10_000, skipped: 0, skippedGap: 0, skippedRisk: 0, signals: trades.length });
  return {
    strategy: "custom",
    name: "Test",
    configKey: "k",
    symbol: "BTCUSDT",
    interval: "1h",
    params: {},
    specs: [],
    bars: 300,
    gaps: { gaps: 0, missing: 0 },
    from: T0,
    to: TO,
    stats,
    trades,
    skipped: 0,
    coverage: [{ interval: "1h", role: "exec", bars: 300, first: T0, last: TO, gaps: 0, missing: 0 }],
    expectedBars: 300,
    warmup: { wanted: 100, got: 120 },
    funnel: funnel({ signals: trades.length, executed: trades.length }),
    variants: [],
    split: { params: null, is: null, oos: null, isCurveR: [], oosCurveR: [], cutTime: null },
    wf: null,
    robust: { verdict: "wenig", text: "Zu wenig Trades", reasons: [] },
    ...over,
  } as unknown as LabResult;
}
const run = (rs: readonly number[], over: Partial<LabResult> = {}, riskPct: number | null = 1) => ({ lab: { result: labResult(chain(rs), over), bars: [], riskPct } });
// 12 trades: +5 +3 +1 +1 +1 and seven −1 → Σ = +4 R
const RS = [5, 3, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1];

describe("Prüfbericht: Hängt mein Backtest an wenigen Trades?", () => {
  it("names the number of trades, the result without the best 1 / 3 / 5 and calls it a hint, not proof", async () => {
    const { env, spies } = mk(run(RS));
    const r = await ask("Hängt mein Backtest an wenigen Trades?", env);
    expect(r.title).toBe("Das Ergebnis hängt an wenigen Trades");
    // without the best one: 3+1+1+1−7 = −1 R; with all: +4 R
    expect(r.text).toContain("Letzter Labor-Lauf (Test): Ohne die besten 1 von 12 Trades bleibt −1,00 R übrig (mit allen: +4,00 R).");
    expect(r.text).toMatch(/Hinweis, kein Beweis/);
    // three best out (5+3+1): 1+1−7 = −5 R; five best out: seven losers = −7 R. 3 of 12 is a quarter, so the row is thin
    expect(r.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Trades: 12", "Summe R: +4,00 R", "Ohne die besten 3: −5,00 R", "Ohne die besten 5: −7,00 R"]);
    expect(r.text).toMatch(/ein Fünftel oder mehr/);
    expect(r.tone).toBe("loss");
    // the button only opens: the register entry of the report
    act(r, "Prüfbericht öffnen")();
    expect(spies.openFeature).toHaveBeenCalledWith("pruefbericht");
    expect(spies.go).not.toHaveBeenCalled();
    expect(spies.setMem).not.toHaveBeenCalled();
  });

  it("broad results stay positive without the best five – and say what that does not mean", async () => {
    // ten +2 R and six −1 R: Σ = 14; without the five best (5 × 2 = 10): 5 × 2 − 6 = +4 R
    const { env } = mk(run([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1, -1, -1, -1]));
    const r = await ask("Ist der Backtest nur wegen ein paar Ausreißern gut?", env);
    expect(r.title).toBe("Auch ohne die besten Trades positiv");
    expect(r.text).toContain("Auch ohne die besten 5 von 16 Trades bleibt +4,00 R übrig.");
    expect(r.text).toMatch(/nichts über Trades, die noch kommen/);
  });

  it("under ten trades it refuses to judge and says why", async () => {
    const { env } = mk(run([3, -1, -1, 2, -1, 1, -1, 2]));
    const r = await ask("Hängt mein Backtest an wenigen Trades?", env);
    expect(r.title).toBe("Zu wenige Trades für diese Frage");
    expect(r.text).toContain("Mit 8 Trades lässt sich die Abhängigkeit von einzelnen Trades nicht beurteilen (ab 10 Trades wird sie gerechnet).");
    expect(r.facts.map((f) => f.label)).toEqual(["Trades", "Summe R"]);
  });

  it("data holes: counts, share of the candles and the trades that cannot be listed without candles", async () => {
    // 2 holes, 9 missing candles of 300 + 9 = 309 → 2,9 % (> 2 %)
    const holes = { gaps: { gaps: 2, missing: 9 }, coverage: [{ interval: "1h", role: "exec", bars: 300, first: T0, last: TO, gaps: 2, missing: 9 }] } as Partial<LabResult>;
    const { env } = mk(run(RS, holes));
    const r = await ask("Gibt es Datenlücken im Backtest?", env);
    expect(r.title).toBe("Der Lauf hat Datenlücken");
    expect(r.text).toContain("2 Lücken in der Ausführungsebene, zusammen 9 fehlende Kerzen (2,9 %).");
    expect(r.text).toContain("Das ist mehr als 2 % der Kerzen");
    expect(r.text).toContain("Die Kerzen des Laufs liegen nicht mehr vor");
    expect(r.facts.map((f) => f.value)).toEqual(["300 von 300", "2", "2,9 %"]);
  });

  it("without a finished run it says so, starts nothing and offers the lab", async () => {
    const { env, spies } = mk({ lab: null });
    const r = await ask("Hängt mein Backtest an wenigen Trades?", env);
    expect(r.title).toBe("Noch kein Labor-Lauf");
    expect(r.text).toContain("Ich starte nichts von mir aus.");
    act(r, "Labor öffnen")();
    expect(spies.openFeature).toHaveBeenCalledWith("labor");
  });
});

describe("Belastung: Wie lang war die längste Verlustserie?", () => {
  it("longest streak, worst stretches, deepest drawdown, order Monte Carlo", async () => {
    const { env, spies } = mk(run(RS));
    const r = await ask("Wie lang war die längste Verlustserie?", env);
    // the seven last trades are all losers: −7 R
    expect(r.text).toMatch(/Test, 12 Trades\) waren 7 Trades in Folge \(\d\d\.\d\d\.\d{4} bis \d\d\.\d\d\.\d{4}\), zusammen −7,00 R\./);
    // worst 3 in a row: −1 −1 −1 = −3; worst 5: −5; worst 10 (trades 3…12): 1+1+1−7 = −4
    expect(r.text).toContain("Die schwächsten Abschnitte am Stück: 3 Trades −3,00 R, 5 Trades −5,00 R, 10 Trades −4,00 R.");
    // cumulative R: 5 8 9 10 11 10 9 8 7 6 5 4 → peak 11, trough 4 → 7 R = 7 % of the account at 1 % risk
    expect(r.text).toContain("Tiefster Rückgang der aufsummierten R: 7,0 R");
    expect(r.text).toContain("etwa 7,0 % des Kontos bei 1,0 % Risiko je Trade");
    expect(r.text).toMatch(/Mischt man die Reihenfolge der 12 Trades 2\.?000-mal neu/);
    expect(r.text).toMatch(/Beobachtungen an 12 Trades/);
    expect(r.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Längste Serie: 7 Trades", "Rückgang: −7,0 R", "Trades: 12", "Summe R: +4,00 R"]);
    act(r, "Belastungstest öffnen")();
    expect(spies.openFeature).toHaveBeenCalledWith("belastungstest");
  });

  it("five trades: no order simulation, and it says why", async () => {
    // 3 −1 −1 2 −1: losers in a row 2 (−2 R); worst 3: min(1, 0, 0) = 0 at the earliest; all 5: +2; cumulative 3 2 1 3 2 → peak 3, trough 1 → 2 R
    const { env } = mk(run([3, -1, -1, 2, -1]));
    const r = await ask("Wie viele Verlusttrades hintereinander im Backtest?", env);
    expect(r.text).toContain("waren 2 Trades in Folge");
    expect(r.text).toContain("zusammen −2,00 R");
    expect(r.text).toContain("3 Trades 0,00 R, 5 Trades +2,00 R");
    expect(r.text).toContain("Tiefster Rückgang der aufsummierten R: 2,0 R");
    expect(r.text).toContain("Mit 5 Trades ist die Reihenfolge-Simulation zu grob. Ab 10 Trades wird sie gerechnet.");
  });

  it("no losing trade at all", async () => {
    const { env } = mk(run([1, 2, 1]));
    const r = await ask("Längste Verlustserie im Labor-Lauf", env);
    expect(r.text).toContain("hat unter 3 Trades keinen Verlusttrade");
    expect(r.facts[0]!.value).toBe("keine");
  });

  it("a neutral question without a lab run offers the journal question; naming the lab does not", async () => {
    const { env } = mk({ lab: null }, { data: { closed: enrichC(journalRaw()), settings: COACH_SETTINGS, events: [], now: NOW, currency: "USDT", start: 20_000 } });
    const r = await ask("Wie lang war die längste Verlustserie?", env);
    expect(r.title).toBe("Noch kein Labor-Lauf");
    expect(r.followUps).toEqual(["Wie lang war meine längste Verlustserie im Journal?"]);
    expect(route(r.followUps[0]!)).toBe("journal");
    const lab = await ask("Wie lang war die längste Verlustserie im Backtest?", env);
    expect(lab.followUps).toEqual([]);
  });
});

const stats = (n: number, sumR: number, maxDD: number): ScenarioStats => ({ n, sumR, avgR: n ? sumR / n : null, winRate: 0.4, pf: 1.2, maxDD, net: sumR * 100, netPct: sumR / 100 });
const row = (id: ScenarioRow["id"], label: string, st: ScenarioStats | null, dSumR: number | null, status: ScenarioRow["status"] = "ok"): ScenarioRow => ({ id, label, group: "costs", status, note: null, stats: st, dSumR, dMaxDD: null, dPf: null, dN: null });

describe("Belastungstest und Filtervergleich: nur, was schon gerechnet ist", () => {
  const done = {
    status: "done" as const,
    result: { v: 1 as const, rows: [row("base", "Basislauf", stats(12, 4, 0.05), null), row("fees2", "Gebühren ×2", stats(12, 3.2, 0.06), -0.8), row("slip2", "Slippage 2 bp", stats(12, 3.5, 0.055), -0.5, "approx"), row("combined", "Alles zusammen", stats(11, -0.5, 0.09), -4.5)] },
  };

  it("quotes the base, the weakest single row and the combination – with the stated assumption", async () => {
    const { env } = mk({ ...run(RS), stress: done });
    const r = await ask("Was passiert im Backtest bei doppelten Gebühren?", env);
    expect(r.title).toBe("Belastungstest des Laufs");
    expect(r.text).toContain("Basis 12 Trades, +4,00 R, größter Rückgang 5,0 %.");
    expect(r.text).toContain("Am meisten kostet „Gebühren ×2“: +3,20 R (−0,80 R gegenüber der Basis).");
    expect(r.text).toContain("Alles zusammen („Alles zusammen“): −0,50 R – das Ergebnis kippt ins Negative.");
    expect(r.text).toContain("1 Zeile ist mit einer genannten Annahme gerechnet, nicht gemessen.");
  });

  it("not computed: says where to start it and does not start it", async () => {
    const { env, spies } = mk({ ...run(RS), stress: { status: "idle", result: null } });
    const r = await ask("Was passiert im Backtest bei doppelten Gebühren?", env);
    expect(r.title).toBe("Belastungstest noch nicht gerechnet");
    expect(r.text).toContain("Ich starte ihn nicht.");
    act(r, "Belastungstest öffnen")();
    expect(spies.openFeature).toHaveBeenCalledWith("belastungstest");
    const running = await ask("Zeig mir den Belastungstest", mk({ ...run(RS), stress: { status: "running", result: null } }).env);
    expect(running.title).toBe("Belastungstest läuft");
  });

  it("filter comparison: only when computed", async () => {
    const compare = {
      v: 1,
      active: ["rsi"],
      rows: [
        { id: "base", label: "Ohne Filter", filters: [], stats: stats(12, 4, 0.05), asked: 0, blocked: 0, unknown: 0, delta: null },
        { id: "only:rsi", label: "Nur RSI-Zone", filters: ["rsi"], stats: stats(8, 5, 0.04), asked: 12, blocked: 6, unknown: 0, delta: { dN: -4, dSumR: 1, dAvgR: 0.3, dWinRate: 0.1 } },
      ],
      contributions: [],
      overlap: null,
    } as unknown as FilterCompare;
    const r = await ask("Wie wirkt sich der Filter im Backtest aus?", mk({ ...run(RS), filters: { status: "done", result: compare } }).env);
    expect(r.title).toBe("Filtervergleich des Laufs");
    expect(r.text).toContain("Ohne Filter: 12 Trades, +4,00 R. Nur RSI-Zone: 8 Trades, +5,00 R (+1,00 R gegenüber „Ohne Filter“, 6 Signale abgewiesen).");
    const none = await ask("Wie wirkt sich der Filter im Backtest aus?", mk({ ...run(RS), filters: { status: "idle", result: null } }).env);
    expect(none.title).toBe("Filtervergleich noch nicht gerechnet");
    expect(none.text).toContain("ich starte ihn nicht");
  });
});

/* ------------------------------------------------------------------ Forward-Test */

const stored = (i: number, pnl: number, r: number): StoredTrade => ({ id: `f${i}`, side: "long", entryTime: new Date(2026, 1, 21 + i, 9).getTime(), exitTime: new Date(2026, 1, 21 + i, 13).getTime(), entry: 100, exit: 100 + r, stop: 99, target: null, qty: 100, notional: 10_000, pnl, fees: 0, funding: 0, slippage: 0, r, move: r / 100, bars: 1, reason: "stop" });
function account(over: Partial<ForwardAccount> = {}): ForwardAccount {
  const base = newAccount({ id: "a1", name: "RSI-Idee", config: defaultCustom(), signal: DEFAULT_SIGNAL_CFG, symbol: "BTCUSDT", capital: 10_000, riskPct: 1, maxLeverage: 5, exchange: "binance", slippage: { kind: "fixed", bps: 2 }, funding: "none", source: { kind: "draft", label: "RSI" } }, new Date(2026, 1, 20, 12).getTime());
  return { ...base, startMs: new Date(2026, 1, 20, 12).getTime(), cursor: { ...base.cursor, t: Math.floor(new Date(2026, 2, 5, 8).getTime() / 1000), c: 100 }, ...over };
}
// pnl +200 −100 +100 −100 → equity 10 000 → 10 200 → 10 100 → 10 200 → 10 100; r +2 −1 +1 −1 → Ø +0,25 R
const FWD = account({ trades: [stored(0, 200, 2), stored(1, -100, -1), stored(2, 100, 1), stored(3, -100, -1)] });
const COMPARE: ForwardCompare = { level: "differs", headline: "Abweichung: Ø +0,25 R im Forward-Test gegenüber Ø +0,60 R im Rückblick.", rows: [], notes: ["Der Rückblick ist die Zeit VOR dem Start.", "Regeln, die man nach einem Rückblick aufstellt, sehen den Rückblick schon."], forwardN: 4, backtestN: 40, backtestDays: 365 };

describe("Forward-Test", () => {
  it("how it runs: sample first, then the figures with their uncertainty", async () => {
    const { env, spies } = mk({ forward: { accounts: [FWD], compare: {} } });
    const r = await ask("Wie läuft mein Forward-Test?", env);
    expect(r.title).toBe("RSI-Idee");
    expect(r.text).toContain("RSI-Idee (BTCUSDT 4h, läuft, seit 20.02.2026): 4 Trades, Trefferquote 50 % (80-%-Bereich 23–77 %), Ø +0,25 R");
    // equity 10 100 on 10 000 = +1,0 %; the largest drop: 10 200 → 10 100 = 100 / 10 200 = 0,98 % → 1,0 %
    expect(r.text).toContain("Stand +1,0 % auf das Startkapital, größter Rückgang 1,0 %");
    expect(r.text).toContain("verarbeitet bis 05.03. 12:00");
    expect(r.text).toContain("Bei 4 Trades sagen die Zahlen noch wenig – unter 10 Trades ist vieles Zufall.");
    expect(r.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Trades: 4", "Stand: +1,0 %", "Ø R: +0,25 R", "Rückgang: 1,0 %"]);
    act(r, "Forward-Test öffnen")();
    expect(spies.openSpot).toHaveBeenCalledWith("labor", "forward-section");
    expect(spies.setMem).not.toHaveBeenCalled();
  });

  it("does the virtual account hold what the backtest shows: the comparison only when the trader computed it", async () => {
    const withIt = await ask("Hält das virtuelle Konto, was der Backtest zeigt?", mk({ forward: { accounts: [FWD], compare: { a1: { status: "done", result: COMPARE } } } }).env);
    expect(withIt.title).toBe("Abweichung vom Backtest");
    expect(withIt.text).toContain("Abweichung: Ø +0,25 R im Forward-Test gegenüber Ø +0,60 R im Rückblick.");
    expect(withIt.text).toContain("Grundlage: 4 Forward-Trades gegen 40 Trades aus 365 Tagen vor dem Start.");
    const without = await ask("Hält das virtuelle Konto, was der Backtest zeigt?", mk({ forward: { accounts: [FWD], compare: {} } }).env);
    expect(without.title).toBe("Vergleich noch nicht gerechnet");
    expect(without.text).toContain("startet nur auf deinen Klick");
    expect(without.text).toContain("Mit 4 Trades wäre ein Urteil ohnehin zu früh: unter 10 Trades kann jede Abweichung Zufall sein.");
  });

  it("an account without a closed trade, a paused one, and no account at all", async () => {
    const fresh = account();
    const r = await ask("Wie läuft mein Forward-Test?", mk({ forward: { accounts: [{ ...fresh, status: "paused" }], compare: {} } }).env);
    expect(r.text).toContain("RSI-Idee (BTCUSDT 4h, pausiert, seit 20.02.2026): noch kein abgeschlossener Trade (Stand 05.03. 12:00).");
    const none = await ask("Wie läuft mein Forward-Test?", mk({ forward: { accounts: [], compare: {} } }).env);
    expect(none.title).toBe("Noch kein Forward-Test-Konto");
    expect(none.text).toContain("ich lege nichts an");
  });

  it("reads the accounts of settings.forward when nothing is handed in", async () => {
    const settings = { ...COACH_SETTINGS, forward: withAccounts(undefined, [FWD]) } as never;
    const { env } = mk(undefined, { data: { closed: [], settings, events: [], now: NOW, currency: "USDT", start: 20_000 } });
    const r = await ask("Forwardtest", env);
    expect(r.text).toContain("RSI-Idee (BTCUSDT 4h, läuft");
  });
});

/* ------------------------------------------------------------------ Trendlinien */

const line = (tf: KeyTf, kind: "down" | "up", o: Partial<TrendLineView> = {}): TrendLineView => ({ series: "price", kind, tf, a: { i: 10, v: 100 }, b: { i: 20, v: 98 }, aTime: 1, bTime: 2, confirmedTime: 3, brokeTime: null, slope: -0.2, touches: 3, value: 100, last: 99, dist: 1, distPct: 1, distAtr: 0.8, approach: false, brk: null, retest: null, lastIndex: 100, ...o });
const NONE = { active: null, broken: null };
const analysis = (tf: KeyTf, price: Partial<Record<"down" | "up", { active?: TrendLineView; broken?: TrendLineView }>>): TrendlineAnalysis =>
  ({ tf, status: "ok", bars: 200, need: 44, asOf: 1, close: 99, atr: 1, rsiLast: 50, price: { down: { ...NONE, ...price.down }, up: { ...NONE, ...price.up } }, rsi: { down: NONE, up: NONE } }) as unknown as TrendlineAnalysis;
const avail = (tf: KeyTf, ok = true, reason: string | null = null) => ({ tf, ok, reason });
const noRetest = { state: "none" as const, touchedAt: null, heldAt: null, failedAt: null };
function view(items: Partial<Record<KeyTf, { selected?: boolean; ok?: boolean; reason?: string; analysis?: TrendlineAnalysis | null }>>, state: "ok" | "idle" = "ok") {
  return {
    state,
    symbol: "BTCUSDT",
    cfg: { tfs: KEY_TIMEFRAMES.filter((t) => items[t]?.selected), chart: true },
    items: KEY_TIMEFRAMES.map((tf) => ({ tf, selected: items[tf]?.selected ?? false, avail: avail(tf, items[tf]?.ok ?? true, items[tf]?.reason ?? null), analysis: items[tf]?.analysis ?? null })),
  } as never;
}
const TREND = view({
  "1h": { selected: true, analysis: analysis("1h", { down: { active: line("1h", "down", { approach: true, distPct: 0.8, distAtr: 0.6 }) } }) },
  "2h": { selected: true, ok: false, reason: "Die 2h-Kerzen werden aus 1h gebaut, und die 1h-Kerzen sind noch nicht geladen." },
  "4h": { selected: true, analysis: analysis("4h", { up: { broken: line("4h", "up", { brk: { at: 98, age: 2, fresh: true }, retest: noRetest }) } }) },
  "1D": { selected: true, analysis: analysis("1D", { down: { active: line("1D", "down", { distPct: 3.5, distAtr: 1.9 }) }, up: { broken: line("1D", "up", { brk: { at: 90, age: 10, fresh: false }, retest: { ...noRetest, state: "pending" } }) } }) },
});

describe("Trendlinien", () => {
  it("which timeframes are in approach, break or retest – and which could not be analysed", async () => {
    const { env, spies } = mk({ trend: TREND });
    const r = await ask("Welche Zeiteinheiten haben eine Preis-Trendlinie in Annäherung, Bruch oder Retest?", env);
    expect(r.title).toBe("Trendlinien mit Bewegung");
    expect(r.text).toContain("Annäherung: 1h (Abwärtstrendlinie, Schluss 0,80 % (0,6 ATR) entfernt).");
    expect(r.text).toContain("Bruch (Retest steht aus): 4h (Aufwärtstrendlinie: Aufwärtstrendlinie nach unten gebrochen, 3 Berührungen).");
    expect(r.text).toContain("Retest: 1D (Aufwärtstrendlinie: Retest läuft, 3 Berührungen).");
    expect(r.text).toContain("Nicht ausgewertet: 2h (Die 2h-Kerzen werden aus 1h gebaut");
    expect(r.text).toMatch(/keine Prognose/);
    expect(r.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Annäherung: 1", "Bruch: 1", "Retest: 1", "Ausgewertet: 3"]);
    act(r, "Preis- & RSI-Struktur öffnen")();
    expect(spies.openFeature).toHaveBeenCalledWith("struktur");
  });

  it("how far is the price from the nearest line: the smallest distance of the unbroken lines", async () => {
    const r = await ask("Wie weit ist der Kurs von der nächsten Linie?", mk({ trend: TREND }).env);
    expect(r.title).toBe("Nächste Linie: 1h");
    expect(r.text).toContain("Die nächste Preislinie ist die Abwärtstrendlinie auf 1h: Der letzte Schluss liegt 0,80 % (0,6 ATR) unter der Linie (3 Berührungen). Weitere: 1D 3,50 % (1,9 ATR).");
    expect(r.facts.map((f) => f.value)).toEqual(["1h", "0,80 %", "3"]);
  });

  it("locked timeframes with the reason; a nothing-to-report answer; a market that is not running", async () => {
    const locked = await ask("Welche Zeiteinheiten sind gesperrt und warum?", mk({ trend: view({ "1h": { selected: true, analysis: analysis("1h", {}) }, "2h": { selected: true, ok: false, reason: "Quelle offline." } }) }).env);
    expect(locked.title).toBe("1 Zeiteinheit gesperrt");
    expect(locked.text).toContain("2h: Quelle offline.");
    const free = await ask("Welche Zeiteinheiten sind gesperrt und warum?", mk({ trend: view({ "1h": { selected: true, analysis: analysis("1h", {}) } }) }).env);
    expect(free.title).toBe("Keine Zeiteinheit gesperrt");
    const quiet = await ask("Gibt es einen Trendlinien-Bruch?", mk({ trend: view({ "4h": { selected: true, analysis: analysis("4h", { down: { active: line("4h", "down", { distPct: 4 }) } }) } }) }).env);
    expect(quiet.title).toBe("Keine Trendlinie in Annäherung, Bruch oder Retest");
    expect(quiet.text).toContain("Intakt, aber nicht nah: 4h.");
    const idle = await ask("Gibt es einen Trendlinien-Bruch?", mk({ trend: view({}, "idle") }).env);
    expect(idle.title).toBe("Der Live-Markt läuft gerade nicht");
    expect(idle.text).toContain("ich erfinde keine Linien");
  });

  it("without the live market the default source reports it as not running", async () => {
    const r = await ask("Welche Zeiteinheiten haben eine Trendlinie in Annäherung?", mk(undefined).env);
    expect(r.title).toBe("Der Live-Markt läuft gerade nicht");
  });
});

/* ------------------------------------------------------------------ Signale */

// Thursday 05.03.2026 12:00 is "now"; the week is KW 10 (02.03.–08.03.)
const ev = (key: string, day: number, min: number, over: Record<string, unknown> = {}) => signalEvent({ key, at: new Date(at(day, min)).getTime(), ...over });
const E0 = ev("e0", -3, 600); // Fri 27.02. 10:00 BTC long – last week
const E1 = { ...ev("e1", 0, 540), skip: "doubt" as const, skipAt: NOW }; // Mon 09:00 BTC long, left out: Zweifel am Signal
const E2 = ev("e2", 1, 600, { symbol: "ETHUSDT", side: "short" }); // Tue 10:00 ETH short – no trade, window over
const E3 = ev("e3", 2, 480); // Wed 08:00 BTC long – traded below
const E4 = ev("e4", 3, 600); // Thu 10:00 BTC long – the 6 hour window runs until 16:00
const C1 = ev("c1", 1, 700, { entry: false, kind: "breakout", side: null, symbol: "ETHUSDT" }); // context: never "missed"
const TRADES = enrichC([ct(at(-4, 480), { id: "t0", p: 100, pair: "ETH/USDT" }), ct(at(2, 510), { id: "t1", p: 200, pair: "BTC/USDT" })]);
const target = (r: number, basis: SignalOutcome["basis"] = "own"): SignalOutcome => ({ kind: "target", basis, sameBar: false, entry: 100, stop: 95, target: 110, rr: r, r, hitAt: 1, bars: 3, coveredUntil: 1, horizon: false, reason: null });
const stopOut: SignalOutcome = { ...target(2), kind: "stop", r: -1 };
const sig = (events = [E0, E1, E2, E3, E4, C1], outcomes = new Map<string, SignalOutcome>(), extra: Partial<NonNullable<InsightInputs["signals"]>> = {}): InsightInputs => ({ signals: { events, outcomes, log: [], presence: [], ...extra } });
const withTrades = (insight: InsightInputs) => mk(insight, { list: TRADES, data: { closed: TRADES, settings: COACH_SETTINGS, events: [], now: NOW, currency: "USDT", start: 20_000 } });

describe("Signale: Posteingang, Bilanz, Ausgang", () => {
  it("this week: gehandelt, bewusst ausgelassen with the reason, abgelaufen without a note, still running", async () => {
    const { env, spies } = withTrades(sig());
    const r = await ask("Welche Signale habe ich diese Woche ausgelassen und warum?", env);
    // KW 10 holds e1 e2 e3 e4 (e0 is last week, c1 is no entry): e3 is traded, e1 left out, e2 expired (window over), e4 still inside its window
    expect(r.text).toContain("KW 10 · 2026");
    expect(r.text).toContain("4 Einstiegs-Signale – 1 gehandelt, 1 bewusst ausgelassen, 1 abgelaufen ohne Vermerk, 1 noch im Zeitfenster.");
    expect(r.text).toContain("Gründe, die du angegeben hast: Zweifel am Signal (1×).");
    expect(r.text).toContain("Nicht gehandelt: 02.03. 09:00 BTCUSDT Long (Einstiegs-Check) – Zweifel am Signal; 03.03. 10:00 ETHUSDT Short (Einstiegs-Check) – kein Grund vermerkt.");
    expect(r.text).toContain("Ob ein Signal bewusst ausgelassen oder nur übersehen wurde, weiß die App nur dort, wo du „Ausgelassen – Grund“ gesetzt hast.");
    expect(r.title).toBe("2 Signale nicht gehandelt");
    expect(r.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Signale: 4", "Gehandelt: 1", "Ausgelassen: 1", "Abgelaufen: 1"]);
    act(r, "Posteingang öffnen")();
    expect(spies.openSpot).toHaveBeenCalledWith("coach", "inbox-card");
  });

  it("a follow-up „und letzte Woche?“ moves to the week before (KW 9: only e0)", async () => {
    const { env } = withTrades(sig());
    const r = await ask("Welche Signale habe ich diese Woche ausgelassen und warum? und letzte Woche?", env);
    expect(r.text).toContain("KW 9 · 2026");
    expect(r.text).toContain("1 Einstiegs-Signal – 0 gehandelt, 0 bewusst ausgelassen, 1 abgelaufen ohne Vermerk, 0 noch im Zeitfenster.");
  });

  it("an empty period and an empty archive are said, not filled", async () => {
    const empty = await ask("Welche Signale habe ich im Januar ausgelassen?", withTrades(sig()).env);
    expect(empty.title).toBe("Keine Signale in diesem Zeitraum");
    expect(empty.text).toContain("Das archivierte Material reicht bis 27.02.2026 zurück");
    const none = await ask("Welche Signale habe ich diese Woche ausgelassen?", withTrades(sig([])).env);
    expect(none.title).toBe("Noch keine Signale festgehalten");
    expect(none.text).toContain("lässt sich nicht nachtragen");
  });

  it("which missed signals reached the target first – only from known outcomes", async () => {
    // not traded: e0 e1 e2 (e3 traded, e4 still open). Outcomes: e0 target +2 R, e1 stop, e2 target +1,5 R (standard measure)
    const outcomes = new Map<string, SignalOutcome>([
      ["e0", target(2)],
      ["e1", stopOut],
      ["e2", target(1.5, "standard")],
    ]);
    const r = await ask("Welche verpassten Signale hatten das Ziel zuerst?", withTrades(sig(undefined, outcomes)).env);
    expect(r.title).toBe("2 Signale mit Ziel zuerst");
    expect(r.text).toContain("Stand: 3 von 3 nicht gehandelten Signalen ausgewertet – 2 erreichten das Ziel zuerst und 1 den Stopp zuerst; 0 sind noch offen, 0 nicht auswertbar.");
    // 2 of 3 = 67 %; Wilson 80 %: centre 0,608, half-width 0,287 → 32–89 %
    expect(r.text).toContain("Von den 3 entschiedenen waren das 67 % (80-%-Bereich 32–89 %).");
    expect(r.text).toContain("Ziel zuerst: 03.03. 10:00 ETHUSDT Short (Einstiegs-Check) +1,50 R (Standardmaß); 27.02. 10:00 BTCUSDT Long (Einstiegs-Check) +2,00 R.");
    expect(r.text).toContain("kein gebuchter Trade und ohne Gebühren, Slippage und Funding");
    expect(r.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Ziel zuerst: 2", "Stopp zuerst: 1", "Entschieden: 3", "Offen: 0"]);
  });

  it("a partly evaluated archive names the state: x of y evaluated, what is open, what the app still reads by itself", async () => {
    // not traded: e0 e1 e2 – e0 reached the target, e1 is still open, e2 has no result yet
    const openOut: SignalOutcome = { ...target(2), kind: "open", r: null, hitAt: null };
    const outcomes = new Map<string, SignalOutcome>([
      ["e0", target(2)],
      ["e1", openOut],
    ]);
    const r = await ask("Welche verpassten Signale hatten das Ziel zuerst?", withTrades(sig(undefined, outcomes)).env);
    expect(r.text).toContain("Stand: 2 von 3 nicht gehandelten Signalen ausgewertet – 1 erreichten das Ziel zuerst und 0 den Stopp zuerst; 1 sind noch offen, 0 nicht auswertbar, 1 noch ohne Ergebnis (die App wertet automatisch weiter aus).");
    expect(r.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Ziel zuerst: 1", "Stopp zuerst: 0", "Entschieden: 1", "Offen: 2"]);
    const hit = await ask("Wie ist die Trefferquote meiner Signale?", withTrades(sig(undefined, outcomes)).env);
    expect(hit.text).toContain("Stand: 2 von 5 ausgewertet, 3 noch ohne Ergebnis");
    expect(hit.text).not.toMatch(/Ausgänge berechnen/);
  });

  it("without known outcomes it names the state („0 von 3 ausgewertet“), says the app evaluates by itself, and loads nothing", async () => {
    const { env, spies } = withTrades(sig());
    const r = await ask("Welche verpassten Signale hatten das Ziel zuerst?", env);
    expect(r.title).toBe("Noch keine Ausgänge ausgewertet");
    expect(r.text).toContain("Stand: 0 von 3 nicht gehandelten Signalen ausgewertet.");
    expect(r.text).toContain("Die App wertet die Ausgänge selbst aus");
    expect(r.text).toContain("Ich rechne und lade nichts selbst.");
    expect(r.text).not.toMatch(/Ausgänge berechnen|mit „Ausgänge/);
    act(r, "Verpasste Chancen öffnen")();
    expect(spies.openFeature).toHaveBeenCalledWith("verpasste-chancen");
  });

  it("hit rate of the Box setups: sample, interval, mean R – and the word for the sample size", async () => {
    // five Box setups on SOL, all expired: two reached the target (+2 R), three the stop (−1 R)
    const box = [1, 2, 3, 4, 5].map((i) => ev(`b${i}`, 0, 600 + i * 30, { source: "box", kind: "setup", name: "Ausbruch Long", tf: "4h", strength: null, symbol: "SOLUSDT" }));
    const outcomes = new Map<string, SignalOutcome>([
      ["b1", target(2)],
      ["b2", target(2)],
      ["b3", stopOut],
      ["b4", stopOut],
      ["b5", stopOut],
    ]);
    const r = await ask("Wie ist die Trefferquote meiner Box-Setups?", withTrades(sig([...box, E3], outcomes)).env);
    expect(r.title).toBe("Trefferquote bei Box-Setups: 40 %");
    expect(r.text).toContain("Box-Setup: 5 Signale (0 gehandelt, 0 bewusst ausgelassen, 5 abgelaufen, 0 noch im Zeitfenster).");
    // 2 of 5 = 40 %; Wilson 80 %: centre 0,425, half-width 0,245 → 18–67 %; mean R (2 + 2 − 3) ÷ 5 = +0,2
    expect(r.text).toContain("Von 5 entschiedenen erreichten 2 das Ziel zuerst, 3 den Stopp: Trefferquote 40 % (80-%-Bereich 18–67 %), Ø +0,20 R");
    expect(r.text).toContain("Stichprobe: dünn.");
    expect(r.text).toContain("Die Trefferquote allein sagt nichts über den Gewinn");
    expect(r.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Signale: 5", "Entschieden: 5", "Trefferquote: 40 %", "Ø R: +0,20 R"]);
  });

  it("Box setups without an evaluated outcome: no rate, the state, no click asked for", async () => {
    const box = ev("b1", 0, 600, { source: "box", kind: "setup", name: "Ausbruch Long", tf: "4h", strength: null, symbol: "SOLUSDT" });
    const r = await ask("Wie ist die Trefferquote meiner Box-Setups?", withTrades(sig([box])).env);
    expect(r.title).toBe("Trefferquote bei Box-Setups: noch offen");
    expect(r.text).toContain("Stand: 0 von 1 ausgewertet.");
    expect(r.text).toContain("Die App wertet die Ausgänge selbst aus");
    expect(r.text).not.toMatch(/Ausgänge berechnen/);
    expect(r.facts[2]!.value).toBe("–");
    const absent = await ask("Wie ist die Trefferquote meiner Box-Setups?", withTrades(sig([E3])).env);
    expect(absent.title).toBe("Keine passenden Signale");
  });
});

describe("Qualität: Offenzeit und Verspätung", () => {
  // the app ran 20.02. 00:00 – 28.02. 00:00 (8 days) and 01.03. 12:00 – now (4 days); the span since the first beat is 13,5 days
  const presence = [
    { a: new Date(2026, 1, 20, 0).getTime(), b: new Date(2026, 1, 28, 0).getTime() },
    { a: new Date(2026, 2, 1, 12).getTime(), b: NOW },
  ];

  it("share of the time the app was open, the break and the honest window", async () => {
    const r = await ask("Wie lange war die App letzten Monat offen?", mk(sig([], new Map(), { presence })).env);
    // 12 days open of 13,5 → 88,9 % → 89 %; one break of 36 hours (28.02. 00:00 → 01.03. 12:00)
    expect(r.text).toContain("In den letzten 30 Tagen (die Aufzeichnung beginnt erst am 20.02.2026) war die App 89 % der Zeit offen (12 T von 13 T 12 Std).");
    expect(r.text).toContain("Gerechnet wird über 30 Tage, nicht über einen Kalendermonat.");
    expect(r.text).toContain("1 Unterbrechung von mindestens 10 Minuten, zusammen 36 Std; die jüngste: 28.02. 00:00 bis 01.03. 12:00 (36 Std).");
    expect(r.text).toContain("Alarme laufen nur bei offener App");
    expect(r.title).toBe("App 89 % der Zeit offen");
    expect(r.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["App offen: 89 %", "Unterbrechungen: 1"]);
    // no delay sentence when only the presence was asked
    expect(r.text).not.toContain("Verspätung");
  });

  it("without a trace the share is unknown, not guessed", async () => {
    const r = await ask("Wie lange war die App letzten Monat offen?", mk(sig([], new Map(), { presence: [] })).env);
    expect(r.title).toBe("Offenzeit unbekannt");
    expect(r.text).toContain("ist unbekannt");
  });

  it("alerts later than 5 minutes after the candle close, per source", async () => {
    const mkAlert = (key: string, source: "entry" | "box", delayMin: number, day: number) => {
      const t = new Date(at(day, 600)).getTime();
      return ev(key, day, 600, { source, barClose: t - delayMin * 60_000 });
    };
    // Einstiegs-Check 2, 7 and 1 minutes (one late), Box-zu-Box 6 minutes (late): 2 of 4
    const events = [mkAlert("a1", "entry", 2, 0), mkAlert("a2", "entry", 7, 1), mkAlert("a3", "entry", 1, 2), mkAlert("a4", "box", 6, 3)];
    const r = await ask("Gab es Alarme mit mehr als 5 Minuten Verspätung?", mk(sig(events)).env);
    expect(r.title).toBe("2 Alarme später als 5 Minuten");
    expect(r.text).toContain("Ja: 2 von 4 Alarmen (50 %) kamen mehr als 5 Minuten nach dem Schluss der Kerze, auf der das Signal beruht (letzte 30 Tage).");
    expect(r.text).toContain("Einstiegs-Check: 1 von 3, Median 2 Min, längster 7 Min; Box-zu-Box: 1 von 1, Median 6 Min, längster 6 Min.");
    expect(r.text).toContain("60 Sekunden Wartezeit");
    const none = await ask("Gab es Alarme mit mehr als 5 Minuten Verspätung?", mk(sig([ev("x", 0, 600)])).env);
    expect(none.title).toBe("Verspätung nicht messbar");
    expect(none.text).toContain("Noch kein Alarm mit bekanntem Kerzenschluss");
  });
});

/* ------------------------------------------------------------------ Monatsnutzen */

describe("Monatsnutzen: Was hat mir das Journal gebracht?", () => {
  const march = enrichC([ct(at(0, 600), { id: "m1", p: 300, pair: "ETH/USDT" }), ct(at(1, 600), { id: "m2", p: -100, pair: "BTC/USDT" })]);
  const data = (list = march) => ({ closed: list, settings: COACH_SETTINGS, events: [], now: NOW, currency: "USDT", start: 20_000 });

  it("counts what is recorded in the named month and flags a trace that does not reach back", async () => {
    // March: two trades (no stored entry check), four entry signals in the archive (e1 … e4; e0 is from February), one context event
    const { env, spies } = mk(sig(), { list: march, data: data() });
    const r = await ask("Was hat mir das Journal im März gebracht?", env);
    expect(r.title).toBe("Das Journal im März 2026");
    expect(r.text).toContain("2 Trades im Monat, davon 0 von 2 (0 %) mit einem Einstiegs-Check zum Zeitpunkt des Eintrags");
    expect(r.text).toContain("0 protokollierte Regelverstöße, 0 Tage über dem Tageslimit, 0 Trades über dem Limit pro Trade.");
    expect(r.text).toContain("Alarme: 4 Einstiegs-Signale festgehalten, 0 Meldungen gesendet.");
    expect(r.text).toContain("Gezählt wird nur, was protokolliert ist – keine Geldbeträge „gespart“");
    // the archive starts 27.02. (before March): complete – so no „Unvollständig“
    expect(r.text).not.toContain("Unvollständig");
    act(r, "Monatsbericht öffnen")();
    expect(spies.openReport).toHaveBeenCalledWith("2026-03");
    expect(spies.openSpot).toHaveBeenCalledWith("berichte", "benefit-card");
  });

  it("an archive that starts inside the month is named incomplete, never read as „none“", async () => {
    const { env } = mk(sig([E3, E4]), { list: march, data: data() });
    const r = await ask("Was hat mir das Journal im März gebracht?", env);
    expect(r.text).toContain("Unvollständig: Das Signalarchiv reicht nur bis 04.03.2026 zurück");
    const empty = await ask("Was hat mir das Journal im Oktober gebracht?", mk(sig([]), { list: march, data: data() }).env);
    expect(empty.title).toBe("Oktober 2025: nichts protokolliert");
  });
});

/* ------------------------------------------------------------------ ähnliche Situationen */

const share = (k: number, n: number, lo: number, hi: number) => ({ k, n, share: k / n, lo, hi });
function similarOk(): SimilarResult {
  const counter = (time: number, change: number) => ({ index: 5, time, distance: 0.5, values: {}, outcome: { up: 0.2, down: Math.abs(change), change, dir: "down", first: "down", firstBars: 2, ref: 100, last: 99, size: 1 } });
  return {
    status: "ok",
    tf: "4h",
    cfg: { features: ["rsi"], horizon: 12, unit: "r", maxHits: 40, maxDistance: 1.2, minGap: 12, lens: {} },
    bars: 480,
    need: 60,
    asOf: 1,
    features: ["rsi"],
    dropped: [],
    query: null,
    candidates: 400,
    hits: [],
    baseline: { n: 400, up: share(204, 400, 0.46, 0.56), medianChange: 0.1 },
    summary: {
      n: 24,
      up: share(14, 24, 0.41, 0.73),
      down: share(10, 24, 0.27, 0.59),
      flat: share(0, 24, 0, 0.1),
      change: { median: 0.6, q25: -0.4, q75: 1.5, mean: 0.5, sd: 1.2 },
      medianUp: 1.4,
      medianDown: 0.9,
      expectation: "up",
      counters: [counter(new Date(2026, 0, 12, 8).getTime(), -1.2), counter(new Date(2026, 0, 3, 16).getTime(), -0.4)],
      medianSetback: 0.8,
      touch: { up: 0.4, down: 0.3, both: 0.1, none: 0.2, medianBarsUp: 3, medianBarsDown: 4 },
    },
  } as unknown as SimilarResult;
}
const simIn = (result: SimilarResult | null, state: "ok" | "idle" | "waiting" = "ok", reason: string | null = null): InsightInputs => ({ similar: { state, tf: "4h", horizon: 12, unit: "r", reason, result } });

describe("Ähnliche Situationen: die Auswertung, nicht nur das Öffnen", () => {
  it("headline of the domain, the counter-examples, the yardstick and the reminder that it is no forecast", async () => {
    const { env, spies } = mk(simIn(similarOk()));
    const r = await ask("Wie ging es nach ähnlichen Situationen weiter?", env);
    expect(r.title).toBe("Ähnliche Situationen auf 4h");
    // 14 of 24 = 58 %; the domain's own headline
    expect(r.text).toContain("In 14 von 24 ähnlichen Situationen lag der Kurs nach 12 Kerzen höher (58 %, Spanne 41–73 %).");
    expect(r.text).toContain("Im Median lag der Kurs danach +0,6 R (mittlere Hälfte −0,4 R bis +1,5 R).");
    expect(r.text).toContain("Gegenbeispiele: 2 Fundstellen gingen den anderen Weg, der Rücklauf gegen die Mehrheit lag im Median bei 0,8 R; die größten: 12.01.2026 08:00 (−1,2 R), 03.01.2026 16:00 (−0,4 R).");
    expect(r.text).toContain("Im ganzen Zeitraum lag der Kurs nach 12 Kerzen in 51 % aller 400 Fälle höher; bei den ähnlichen sind es 58 %.");
    expect(r.text).toContain("Ähnlichkeit ist keine Prognose");
    expect(r.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Fundstellen: 24", "Höher: 58 %", "Tiefer: 42 %", "Gegenbeispiele: 2"]);
    // the button hands over to the existing „similar“ callback (navigate + scroll), the sheet closes
    act(r, "Ähnliche Situationen öffnen")();
    expect(spies.similar).toHaveBeenCalledTimes(1);
  });

  it("under 20 hits: „zu wenig Daten“, no shares", async () => {
    const few = { ...similarOk(), status: "few", summary: null, hits: new Array(7).fill({}) } as unknown as SimilarResult;
    const r = await ask("Wie ging es nach ähnlichen Situationen weiter?", mk(simIn(few)).env);
    expect(r.title).toBe("Zu wenig Daten für eine Auswertung");
    expect(r.text).toContain("Zu wenig Daten: 7 Fundstellen unter 400 vergleichbaren Kerzen. Ab 20 Fundstellen zeige ich eine Verteilung");
    expect(r.text).not.toContain("Höher");
    expect(r.facts.map((f) => f.value)).toEqual(["7", "20", "480"]);
  });

  it("no live market and a timeframe without candles are named; no other timeframe is substituted", async () => {
    const idle = await ask("Wie ging es nach ähnlichen Situationen weiter?", mk(simIn(null, "idle")).env);
    expect(idle.title).toBe("Der Live-Markt läuft gerade nicht");
    const waiting = await ask("Wie ging es nach ähnlichen Situationen weiter?", mk(simIn(null, "waiting", "Die 4h-Kerzen werden geladen.")).env);
    expect(waiting.title).toBe("Für 4h liegen keine Kerzen vor");
    expect(waiting.text).toContain("Es wird keine andere Zeiteinheit untergeschoben.");
    const real = await ask("Wie ging es nach ähnlichen Situationen weiter?", mk(undefined).env);
    expect(real.title).toBe("Der Live-Markt läuft gerade nicht");
  });
});

/* ------------------------------------------------------------------ Passt zu dir? */

// the idea and the journal of tests/unit/fit.test.ts (hand-computed there): 1 agreement, 7 frictions
function fitEnv(extra: InsightInputs = {}, closed = enrichC(journalRaw())) {
  const fi = fitIdea();
  const result = labResult(fi.trades.map((t) => ({ ...t, entryIndex: 0, exitIndex: 0 })) as unknown as BtTrade[], { name: "Test-Idee", from: fi.from, to: fi.to, stats: { maxDD: 0.06 } as never });
  const events = [{ key: "stopMoved", tradeIds: ["f3", "f9"], at: 0, severity: 2 }] as never;
  return mk({ lab: { result, bars: [], riskPct: 2 }, ...extra }, { data: { closed, settings: COACH_SETTINGS, events, now: NOW, currency: "USDT", start: 20_000 } });
}

describe("Passt diese Strategie zu mir? / Was verlangt die Idee von mir?", () => {
  it("agreements and frictions in the domain's own sentences, with both samples and no verdict", async () => {
    const { env, spies } = fitEnv();
    const r = await ask("Passt diese Strategie zu mir?", env);
    expect(r.title).toBe("Passt in 1 von 11 Punkten, 7 Reibungen");
    expect(r.text).toContain("Die Idee „Test-Idee“ (10 Trades) gegen dein Journal (24 abgeschlossene Trades): 1 Punkte stimmen überein, 7 reiben sich, 3 sind nicht beurteilbar.");
    expect(r.text).toContain("Haltedauer: Haltedauer Median 5 Std 30 Min; du schließt im Median nach 1 Std");
    expect(r.text).toContain("Verlustserien: Die Idee verlangt im Test bis zu 3 Verlusttrades in Folge auszuhalten; deine längste Serie waren 1.");
    expect(r.text).toContain("Trefferquote: Trefferquote im selben Bereich: 30 % bei der Idee, 50 % bei dir; die Spannen überlappen");
    expect(r.text).toContain("Das ist kein Gesamturteil und keine Empfehlung");
    expect(r.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Reibungen: 7", "Passt: 1", "Idee: Trades: 10", "Journal: Trades: 24"]);
    act(r, "Passt zu dir? öffnen")();
    expect(spies.openSpot).toHaveBeenCalledWith("labor", "labor-fit");
  });

  it("too few journal trades: the reason of the domain, no comparison", async () => {
    const r = await ask("Passt diese Strategie zu mir?", fitEnv({}, enrichC(journalRaw()).slice(0, 19)).env);
    expect(r.title).toBe("Noch kein Vergleich möglich");
    expect(r.text).toContain("Dein Journal hat 19 Trades abgeschlossen. Ab 20 bilde ich ein Profil");
  });

  it("what the idea asks: frequency, hold time, win rate, streak, drawdown, entry windows", async () => {
    // 10 trades over 28 days → 2,5 per week; median hold 5,5 h; 3 wins (30 %; Wilson 80 %: centre 0,328, half-width 0,174 → 15–50 %); 3 losers in a row; drawdown 3 R = 6 % at 2 % risk;
    // six Monday entries (60 %) in the London session, four on Saturday (weekend)
    const r = await ask("Was verlangt die Idee von mir?", fitEnv().env);
    expect(r.title).toBe("Das verlangt die Idee");
    expect(r.text).toContain("im Schnitt 2,5 Trades pro Woche;");
    expect(r.text).toContain("eine Haltedauer von im Median 5 Std 30 Min;");
    expect(r.text).toContain("eine Trefferquote von 30 % (80-%-Bereich 15–50 %), also auch 7 Verlusttrades auszuhalten;");
    expect(r.text).toContain("bis zu 3 Verlusttrades in Folge;");
    expect(r.text).toContain("einen Rückgang von bis zu 3,0 R (6,0 % des Kontos bei 2,0 % Risiko je Trade);");
    expect(r.text).toContain("Einstiege vor allem Montag (60 % der Einstiege) und London-Session (07–13 UTC) (60 % der Einstiege).");
    expect(r.text).toContain("keine Zusage für künftige Trades");
  });

  it("no lab run: both say so", async () => {
    const { env } = mk({ lab: null });
    expect((await ask("Passt diese Strategie zu mir?", env)).title).toBe("Noch kein Labor-Lauf");
    expect((await ask("Was verlangt die Idee von mir?", env)).title).toBe("Noch kein Labor-Lauf");
  });
});

/* ------------------------------------------------------------------ Strategie-Bibliothek */

describe("Strategie-Bibliothek", () => {
  it("finds the cards by their words, tolerates a typo, and names nothing that is not there", () => {
    expect(findCards(" gibt es eine strategie mit bollinger ").cards.map((c) => c.id)).toEqual(["bollinger-reversion", "bollinger-squeeze"]);
    expect(findCards(" gibts ne strategie mit bolinger ").cards.map((c) => c.id)).toEqual(["bollinger-reversion", "bollinger-squeeze"]);
    expect(findCards(" welche werte nimmt man fuer die supertrend strategie ").cards.map((c) => c.id)).toEqual(["supertrend"]);
    expect(findCards(" gibt es eine strategie mit zauberformel ").cards).toEqual([]);
    expect(findCards(" gibt es eine strategie ").keywords).toEqual([]);
  });

  it("typical values of a card: Standard first, the other two settings in brackets – the numbers of the card", async () => {
    const { env } = mk();
    const r = await ask("Welche Werte nimmt man für die Supertrend-Strategie?", env);
    expect(r.title).toBe("Supertrend (10, 3)");
    expect(r.text).toContain("Typische Werte – ATR-Länge: 10 Kerzen (konservativ 14, aggressiv 7); ATR-Faktor: 3 × (konservativ 4, aggressiv 2); Stop-Abstand: 2 × ATR (konservativ 2,5, aggressiv 1,5).");
    expect(r.text).toContain("bekannt heißt nicht wirksam");
    expect(r.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Typ: Trend", "ATR-Länge: 10 Kerzen", "ATR-Faktor: 3 ×", "Stop-Abstand: 2 × ATR"]);
    expect(valuesLine(findCards(" supertrend ").cards[0]!)).toContain("ATR-Faktor: 3 ×");
  });

  it("Bollinger: two cards, a button each – and loading only fills the lab draft (nothing is saved or started)", async () => {
    const { env, spies } = mk();
    const r = await ask("Gibt es eine Strategie mit Bollinger?", env);
    expect(r.title).toBe("2 passende Strategien");
    expect(r.actions.map((a) => a.label)).toEqual(["Bollinger-Reversion in Eigene Idee laden", "Bollinger-Squeeze-Ausbruch in Eigene Idee laden", "Bibliothek öffnen"]);
    act(r, /Squeeze-Ausbruch in Eigene Idee laden/)();
    expect(spies.applyIdea).toHaveBeenCalledTimes(1);
    const draft = (spies.applyIdea.mock.calls[0] as unknown as [ReturnType<typeof draftOfCard>])[0];
    expect(draft).toMatchObject({ source: "combo", testable: true, symbol: null, gaps: [] });
    expect(draft.origin).toContain("Bollinger-Squeeze");
    expect(draft.rules.length).toBeGreaterThan(0);
    expect(spies.go).toHaveBeenCalledWith("labor");
    expect(spies.setMem).not.toHaveBeenCalled();
    act(r, "Bibliothek öffnen")();
    expect(spies.openLibrary).toHaveBeenCalledTimes(1);
  });

  it("a single card gets the plain button; no card and no keyword are answered honestly", async () => {
    const { env } = mk();
    const one = await ask("Welche Werte nimmt man für die Supertrend-Strategie?", env);
    expect(one.actions.map((a) => a.label)).toEqual(["In Eigene Idee laden", "Bibliothek öffnen"]);
    const none = await ask("Gibt es eine Strategie mit Zauberformel?", env);
    expect(none.title).toBe("Keine passende Strategie");
    expect(none.text).toContain("Ich erfinde keine Strategie dazu.");
    const overview = await ask("Zeig mir die Strategie-Bibliothek", env);
    expect(overview.title).toMatch(/^\d+ Strategien in der Bibliothek$/);
  });
});

/* ------------------------------------------------------------------ learning */

describe("learning: the interests the trader shows by asking", () => {
  it("the topic of the plan is what is counted – only from the user's own questions", () => {
    const { env } = mk();
    const topics = ["Wie läuft mein Forward-Test?", "Hängt mein Backtest an wenigen Trades?", "Welche Signale habe ich diese Woche ausgelassen?", "Gibt es eine Strategie mit Bollinger?", "Win-Rate am Montag"].map((q) => respond(q, env).topic);
    expect(topics).toEqual(["forward", "audit", "signals", "library", "metric:winRate"]);
  });

  it("topics asked more often come first as suggestions, with the question that belongs to them", () => {
    let m = EMPTY_MEMORY;
    for (const t of ["forward", "forward", "trend", "trend", "trend", "library"]) m = learnInterest(m, t);
    // most asked first: trend (3×), forward (2×), library (1×), then the safe defaults
    expect(suggestFor({ mem: m })).toEqual([INTEREST_QUESTION.trend, INTEREST_QUESTION.forward, INTEREST_QUESTION.library, "Was lief gut?"]);
    // every topic of the tools has a question that the router sends to the same topic, and a label a person can read
    for (const [topic, q] of Object.entries(INTEREST_QUESTION)) {
      const p = u(q);
      expect(p.kind === "tool" && p.topic, q).toBe(topic);
      expect(topicLabel(topic)).not.toBe(topic);
    }
    expect(topicLabel("train")).toBe("Üben");
  });

  it("one interest can be forgotten on its own, or all of them – facts, style and the voice flag stay", () => {
    let m = learnInterest(learnInterest(EMPTY_MEMORY, "forward"), "trend");
    m = { ...m, facts: [{ id: "f1", text: "London", at: 1 }], style: "kurz" };
    // the panel lists them most asked first, ties by name
    expect(interestsOf(learnInterest(m, "trend"))).toEqual([
      ["trend", 2],
      ["forward", 1],
    ]);
    const one = removeInterest(m, "forward");
    expect(Object.keys(one.interests)).toEqual(["trend"]);
    expect(one.facts).toEqual(m.facts);
    expect(removeInterest(one, "forward")).toBe(one);
    const none = forgetInterests(m);
    expect(none.interests).toEqual({});
    expect(none.facts).toEqual(m.facts);
    expect(none.style).toBe("kurz");
    expect(forgetInterests(none)).toBe(none);
  });
});

/* ------------------------------------------------------------------ the default sources */

describe("default sources: the app's own stores, read when asked", () => {
  beforeEach(() => {
    __resetLabor();
    __resetExtras();
  });
  afterEach(() => {
    __resetLabor();
    __resetExtras();
  });

  it("the last Labor run and the risk of that run come from the lab store", async () => {
    useLabor.setState({ result: labResult(chain(RS)), bars: [], runCfg: { riskPct: 2 } as never });
    const r = await ask("Wie lang war die längste Verlustserie?", mk(undefined).env);
    expect(r.text).toContain("waren 7 Trades in Folge");
    // 7 R at 2 % risk per trade = 14 % of the account
    expect(r.text).toContain("etwa 14,0 % des Kontos bei 2,0 % Risiko je Trade");
  });

  it("scenarios and filters are quoted only if the extras store already holds them", async () => {
    useLabor.setState({ result: labResult(chain(RS)), bars: [], runCfg: { riskPct: 1 } as never });
    const before = await ask("Was passiert im Backtest bei doppelten Gebühren?", mk(undefined).env);
    expect(before.title).toBe("Belastungstest noch nicht gerechnet");
    useExtras.setState({ stress: { status: "done", progress: 1, result: { v: 1, rows: [row("base", "Basislauf", stats(12, 4, 0.05), null), row("fees2", "Gebühren ×2", stats(12, 3.2, 0.06), -0.8)] }, error: null } });
    const after = await ask("Was passiert im Backtest bei doppelten Gebühren?", mk(undefined).env);
    expect(after.title).toBe("Belastungstest des Laufs");
    expect(after.text).toContain("Am meisten kostet „Gebühren ×2“");
  });

  it("an empty signal archive is reported, not invented", async () => {
    const r = await ask("Welche Signale habe ich diese Woche ausgelassen?", mk(undefined).env);
    expect(r.title).toBe("Noch keine Signale festgehalten");
  });
});

