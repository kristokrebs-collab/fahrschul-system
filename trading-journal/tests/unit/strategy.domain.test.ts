import { describe, expect, it } from "vitest";
import { normalizeSettings } from "@/domain/normalize";
import type { Setup, Trade } from "@/domain/types";
import {
  classifyTrade,
  classifyUntagged,
  compareStrategies,
  examplesOf,
  exitFollowed,
  extrasKey,
  extrasOf,
  hasStrategyData,
  historyModel,
  isFilterActive,
  libraryFacets,
  marketKey,
  matchesLibrary,
  strategyConformity,
  strategyOf,
  tradeConformity,
  withStrategy,
  EMPTY_LIBRARY_FILTER,
  type StrategyExtras,
} from "@/domain/strategy";
import { explainPlaybook, playbookStats } from "@/views/setups/playbook";
import { mkTrade } from "./domain.fixtures";
import { enrich, settingsWith, utc } from "./insights.fixtures";

const base: Setup = { id: "s_x", name: "Box-Ausbruch", account: "both", color: "#6f9dc9", desc: "Ausbruch aus der Box mit Schlusskurs", checklist: [{ id: "c1", text: "Schluss über der Box" }, { id: "c2", text: "RSI-Linie gebrochen" }] };

const extras: StrategyExtras = {
  entryCriteria: [{ id: "e1", text: "  Schluss über Widerstand " }, { id: "e2", text: "" }],
  exitCriteria: [{ id: "x1", text: "Ziel an der nächsten Box" }],
  riskModel: { riskPct: 1, maxLeverage: 4, minRR: 2, stop: "box" },
  tags: ["Breakout", "Breakout", " Swing "],
  examples: ["t1"],
  markets: ["BTC/USDT", "BINANCE:ETHUSDT.P"],
  tf: ["4h"],
  auto: { boxKinds: ["breakout", "retest"], minGrade: "A", minStrength: null, sessions: [], sides: ["long"] },
};

describe("Strategie-Beschreibung (Passthrough an settings.setups)", () => {
  it("liest fehlende Felder mit Defaults und verwirft falsche Typen", () => {
    const x = strategyOf({ ...base, tags: [1, "a", "a"], riskModel: { riskPct: "x", maxLeverage: 3 }, auto: { boxKinds: ["nope", "range"] } } as unknown as Setup);
    expect(x.tags).toEqual(["a"]);
    expect(x.riskModel).toEqual({ riskPct: null, maxLeverage: 3, minRR: null, stop: null });
    expect(x.auto.boxKinds).toEqual(["range"]);
    expect(x.entryCriteria).toEqual([]);
    expect(hasStrategyData(strategyOf(base))).toBe(false);
  });

  it("schreibt nur gefüllte Teile, säubert sie und überlebt normalizeSettings", () => {
    const s = withStrategy(base, extras);
    expect(Object.keys(withStrategy(base, extrasOf(strategyOf(base))))).toEqual(Object.keys(base));
    const raw = s as unknown as Record<string, unknown>;
    expect(raw.entryCriteria).toEqual([{ id: "e1", text: "Schluss über Widerstand" }]);
    expect(raw.tags).toEqual(["Breakout", "Swing"]);
    expect(raw.markets).toEqual(["BTCUSDT", "ETHUSDT"]);
    const settings = normalizeSettings(JSON.parse(JSON.stringify({ ...settingsWith(), setups: [s] })));
    const back = strategyOf(settings.setups[0]!);
    expect(back.exitCriteria).toEqual([{ id: "x1", text: "Ziel an der nächsten Box" }]);
    expect(back.riskModel.minRR).toBe(2);
    expect(back.auto.sides).toEqual(["long"]);
    expect(extrasKey(extrasOf(back))).toBe(extrasKey(extras));
  });

  it("normalisiert Marktnamen", () => {
    expect(marketKey("BINANCE:BTCUSDT.P")).toBe("BTCUSDT");
    expect(marketKey("eth/usdt")).toBe("ETHUSDT");
  });
});

const boxSnap = (side: "long" | "short", kind: string, grade: string) => ({ v: 1, symbol: "BTCUSDT", tf: "4h", at: 1, source: "live", phase: "breakout", dir: 1, pos: 1.1, zone: "top", box: null, setup: { kind, grade, score: 80, side, entry: 1, stop: 1, rr: 2, targets: [] }, htf: null, rsi: null });

describe("Automatische Klassifizierung", () => {
  const range: Setup = { id: "s_r", name: "Range-Support", account: "both", color: "#46a6a0", desc: "Long an der Unterkante der Box", checklist: [] };
  const mtf: Setup = { id: "s_mtf", name: "Multi-TF Signal", account: "both", color: "#8c83cf", desc: "", checklist: [] };
  const setups = [withStrategy(base, extras), range, mtf];

  it("erkennt ein Box-Setup beim Einstieg über die Regeln und nennt die Gründe", () => {
    const t = mkTrade({ id: "a", date: utc(2026, 3, 3, 9), pair: "BTC/USDT", timeframe: "4h", boxSnap: boxSnap("long", "breakout", "A+") });
    const s = classifyTrade(t, setups);
    expect(s[0]!.setupId).toBe("s_x");
    expect(s[0]!.level).toBe("hoch");
    expect(s[0]!.reasons.some((r) => r.ok && r.text.includes("Ausbruch"))).toBe(true);
    const short = classifyTrade({ ...t, side: "short", boxSnap: boxSnap("short", "breakout", "A") }, setups);
    expect(short[0]!.setupId).not.toBe("s_x");
  });

  it("erkennt einen gültigen Einstiegs-Check als Multi-TF-Setup", () => {
    const signal = { at: "2026-03-02T10:00:00.000Z", side: "long", score: 80, strength: 3, tiers: 3, label: "x", valid: true, rsiOk: true, zoneOk: true, zone: null, tfs: [] };
    const s = classifyTrade(mkTrade({ id: "b", date: utc(2026, 3, 3, 9), pair: "SOL/USDT", timeframe: "1h", signal }), setups);
    expect(s[0]!.setupId).toBe("s_mtf");
  });

  it("ohne Hinweise bleibt die Konfidenz niedrig; die Historie lernt mit", () => {
    const plain = mkTrade({ id: "c", date: utc(2026, 3, 3, 9), pair: "XRP/USDT", timeframe: "15m" });
    expect(classifyTrade(plain, [range, mtf])[0]!.level).toBe("niedrig");
    const history = Array.from({ length: 12 }, (_, i) => mkTrade({ id: `h${i}`, date: utc(2026, 2, 1 + i, 9), pair: "XRP/USDT", timeframe: "15m", setups: ["s_r"] }));
    const learned = classifyTrade(plain, [range, mtf], { history: historyModel(history) });
    expect(learned[0]!.setupId).toBe("s_r");
    expect(learned[0]!.confidence).toBeGreaterThan(classifyTrade(plain, [range, mtf])[0]!.confidence);
    expect(learned[0]!.reasons.some((r) => r.text.includes("XRPUSDT"))).toBe(true);
  });

  it("schlägt für ungetaggte Trades nur sichere Zuordnungen vor", () => {
    const trades: Trade[] = [
      mkTrade({ id: "u1", date: utc(2026, 3, 3, 9), boxSnap: boxSnap("long", "breakout", "A+") }),
      mkTrade({ id: "u2", date: utc(2026, 3, 4, 9), pair: "DOGE/USDT", timeframe: "5m" }),
      mkTrade({ id: "tagged", date: utc(2026, 3, 5, 9), setups: ["s_r"] }),
    ];
    const out = classifyUntagged(trades, setups);
    expect(out.map((o) => o.tradeId)).toEqual(["u1"]);
    expect(out[0]!.best.setupId).toBe("s_x");
  });
});

describe("Konformität und Exit-Treue", () => {
  const x = strategyOf(withStrategy(base, extras));
  const settings = settingsWith();
  const mk = (p: Partial<Trade> & { id: string }) => enrich([mkTrade({ date: utc(2026, 3, 3, 9), entry: 100, stop: 99, target: 102, size: 2000, leverage: 3, setups: ["s_x"], ...p })], settings)[0]!;

  it("Exit am Ziel / am Stop ist planmäßig, manuell daneben ein Bruch, ohne Angaben nicht messbar", () => {
    expect(exitFollowed(mk({ id: "a", exit: 102 }))).toBe("plan");
    expect(exitFollowed(mk({ id: "b", exit: 99.1 }))).toBe("plan");
    expect(exitFollowed(mk({ id: "c", exit: 100.6, psych: { exitReason: "Manuell" } }))).toBe("break");
    expect(exitFollowed(mk({ id: "d", exit: 100.6 }))).toBe("unknown");
    expect(exitFollowed(mk({ id: "e", exit: 100.6, psych: { exitReason: "Ziel an der nächsten Box" } }), x)).toBe("plan");
    expect(exitFollowed(mk({ id: "f", exit: 97 }))).toBe("break"); // −3 R: stop not respected
    expect(exitFollowed(mk({ id: "g", exit: 102, stopHistory: [{ at: "x", price: 99 }, { at: "y", price: 98 }] }))).toBe("break");
    expect(exitFollowed(mk({ id: "h", status: "open", exit: null }))).toBe("unknown");
  });

  it("Score aus Checkliste, Plan, Risiko-Modell, Stop, Exit und Markt", () => {
    const full = tradeConformity(mk({ id: "a", exit: 102, checks: { "s_x:c1": true, "s_x:c2": true }, followedPlan: true }), x, 5000);
    expect(full.score).toBe(100);
    const gaps = tradeConformity(mk({ id: "b", exit: 100.6, psych: { exitReason: "Manuell" }, checks: { "s_x:c1": true }, followedPlan: false, leverage: 10, pair: "SOL/USDT" }), x, 5000);
    expect(gaps.score).toBeLessThan(50);
    expect(gaps.parts.checklist).toBe(0.5);
    expect(gaps.parts.exit).toBe(0);
    const s = strategyConformity(x, [mk({ id: "a", exit: 102, checks: { "s_x:c1": true, "s_x:c2": true }, followedPlan: true }), mk({ id: "b", exit: 99, followedPlan: false })], settings);
    expect(s.n).toBe(2);
    expect(s.exit).toMatchObject({ rate: 1, plan: 2, breaks: 0 });
    expect(s.weakest).toBe("checklist");
  });

  it("ein gesetzter Stop allein ergibt keinen Score (braucht einen planbezogenen Teil)", () => {
    const bare = strategyOf({ id: "s_x", name: "Leer", account: "both", color: "#999", desc: "", checklist: [] });
    const c = tradeConformity(mk({ id: "a", exit: 100.6 }), bare, 5000);
    expect(Object.keys(c.parts)).toEqual(["stop"]);
    expect(c.score).toBeNull();
  });

  it("Playbook zeigt Exit-Treue, Konformität und Beispiele (additiv)", () => {
    const setup = withStrategy(base, extras);
    const list = [mk({ id: "t1", exit: 102, checks: { "s_x:c1": true, "s_x:c2": true }, followedPlan: true }), mk({ id: "t2", exit: 100.6, psych: { exitReason: "Manuell" } })];
    const pb = playbookStats(setup, list, { capital: settings.capital });
    expect(pb.strategy).toMatchObject({ n: 2, exitN: 2, exitRate: 0.5, examples: 1 });
    expect(pb.strategy!.score).toBeGreaterThan(0);
    const rows = explainPlaybook({ setup } as never, pb, "USDT").rows.map((r) => r[0]);
    expect(rows.slice(-3)).toEqual(["Exit-Treue", "Konformität", "Beispiele"]);
  });
});

describe("Vergleich, Bibliothek, Beispiele", () => {
  const settings = settingsWith();
  const a: Setup = { ...base, id: "s_a", name: "A" };
  const b: Setup = { ...base, id: "s_b", name: "B" };
  const trades = enrich(
    [
      ...Array.from({ length: 12 }, (_, i) => mkTrade({ id: `a${i}`, date: utc(2026, 2, 1 + i), entry: 100, stop: 99, size: 1000, exit: i % 4 === 0 ? 99 : 102, setups: ["s_a"] })),
      ...Array.from({ length: 12 }, (_, i) => mkTrade({ id: `b${i}`, date: utc(2026, 2, 1 + i, 15), entry: 100, stop: 99, size: 1000, exit: i % 2 === 0 ? 99 : 100.5, setups: ["s_b"] })),
    ],
    settings,
  );

  it("vergleicht mit Intervallen und wählt den Sieger nach der unteren Grenze von Ø R", () => {
    const c = compareStrategies([b, a], trades, settings);
    expect(c.bestId).toBe("s_a");
    expect(c.rows.find((r) => r.id === "s_a")!.rCI!.lo).toBeGreaterThan(0);
    expect(c.pairs).toHaveLength(1);
    expect(c.pairs[0]!.a.label).toBe("A");
    expect(c.verdict).toContain("A führt");
    expect(compareStrategies([a, b], [], settings).verdict).toContain("Keine abgeschlossenen Trades");
  });

  it("filtert die Bibliothek nach Text, Tags, Markt, Timeframe und Trades", () => {
    const x = withStrategy(base, extras);
    expect(matchesLibrary(x, { ...EMPTY_LIBRARY_FILTER, q: "widerstand" })).toBe(true);
    expect(matchesLibrary(x, { ...EMPTY_LIBRARY_FILTER, q: "range" })).toBe(false);
    expect(matchesLibrary(x, { ...EMPTY_LIBRARY_FILTER, tags: ["Breakout"], market: "ETH/USDT", tf: "4h" })).toBe(true);
    expect(matchesLibrary(x, { ...EMPTY_LIBRARY_FILTER, withTrades: true }, 0)).toBe(false);
    expect(isFilterActive(EMPTY_LIBRARY_FILTER)).toBe(false);
    expect(libraryFacets([x, base]).markets).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("Beispiele: gewählte zuerst, dann die besten regelkonformen Gewinner", () => {
    const ex = examplesOf({ id: "s_a", examples: ["a1", "nope"] }, trades);
    expect(ex.picked.map((t) => t.id)).toEqual(["a1"]);
    expect(ex.suggested.length).toBeGreaterThan(0);
    expect(ex.suggested.every((t) => (t.pnl ?? 0) > 0 && t.id !== "a1")).toBe(true);
  });
});
