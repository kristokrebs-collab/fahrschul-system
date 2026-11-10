/**
 * F06 / F15 – the strategy library: every card builds a valid draft in all three settings, the typical values on the card
 * ARE the values of the draft, the drafts run through the lab strategy on a fixture series without error, the cards carry
 * no promises, and search / filter work.
 */
import { describe, expect, it } from "vitest";
import { customStrategy, DEFAULT_FEES, runBacktest, type EngineCfg } from "@/domain/backtest/index";
import { STRATEGY_CARDS, KIND_ORDER, LEVELS, buildCard, cardById, searchCards, valueText, valuesOf } from "@/domain/lab/library";
import { customKey, sanitizeCustom, summarizeCustom, validateCustom } from "@/domain/lab/rules/tree";
import { TF_SEC, type CustomConfig } from "@/domain/lab/rules/types";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import { walk } from "./lab.helpers";

const engine: EngineCfg = { capital: 10_000, riskPct: 0.01, maxLeverage: 5, compounding: true, costs: { fees: DEFAULT_FEES, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "none" } } };
const FUNDING = Array.from({ length: 400 }, (_, k) => ({ t: Date.UTC(2026, 0, 1) + k * 8 * 3_600_000, rate: Math.sin(k / 3) * 0.0004 }));

describe("Bibliothek: Umfang und Aufbau", () => {
  it("mindestens 25 Karten, eindeutige IDs, alle fünf Typen vertreten", () => {
    expect(STRATEGY_CARDS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(STRATEGY_CARDS.map((c) => c.id)).size).toBe(STRATEGY_CARDS.length);
    for (const k of KIND_ORDER) expect(STRATEGY_CARDS.some((c) => c.kind === k), k).toBe(true);
  });

  it("die geforderten Strategien sind da", () => {
    const ids = STRATEGY_CARDS.map((c) => c.id);
    for (const id of ["ema-cross", "golden-cross", "ema200-pullback", "rsi-rebound", "connors-rsi2", "bollinger-reversion", "bollinger-squeeze", "macd-cross", "turtle-20", "turtle-55", "supertrend", "adx-trend", "stochastic-reversal", "ichimoku-cloud", "keltner-squeeze", "vwap-reversion", "orb-asia", "orb-london", "orb-ny", "inside-bar", "heikin-ashi", "chandelier", "volume-spike", "golden-pocket", "funding-contrarian", "weekend-range", "box-breakout", "mcb-ladder", "mcb-bottom-rsi"]) expect(ids, id).toContain(id);
  });

  it("jede Karte nennt Herkunft, Marktphase, Schwächen, Zeiteinheiten und typische Werte mit Erklärung", () => {
    for (const c of STRATEGY_CARDS) {
      expect(c.title.length, c.id).toBeGreaterThan(4);
      expect(c.sub.length, c.id).toBeGreaterThan(30);
      expect(c.knownFrom.length, c.id).toBeGreaterThan(30);
      expect(c.phase.length, c.id).toBeGreaterThan(15);
      expect(c.weaknesses.length, c.id).toBeGreaterThanOrEqual(2);
      expect(c.tfs.length, c.id).toBeGreaterThanOrEqual(2);
      expect(c.params.length, c.id).toBeGreaterThanOrEqual(2);
      for (const p of c.params) {
        expect(p.what.length, `${c.id}.${p.key}`).toBeGreaterThan(20);
        expect(p.v).toHaveLength(3);
        for (const x of p.v) expect(Number.isFinite(x)).toBe(true);
      }
    }
  });

  it("keine Leistungsversprechen und keine erfundenen Ergebnisse auf den Karten", () => {
    const text = STRATEGY_CARDS.map((c) => [c.title, c.sub, c.knownFrom, c.phase, ...c.weaknesses, ...c.params.map((p) => p.what)].join(" ")).join(" ");
    expect(text).not.toMatch(/\d+\s?%\s*(Gewinn|Trefferquote|Win-?Rate|Rendite|Erfolgs)/i);
    expect(text).not.toMatch(/\b(garantiert|sicher(er)? Gewinn|profitabel|schlägt den Markt|funktioniert zuverlässig|gewinnbringend)\b/i);
    // „Win-Rate“ / „Profit“ nur in Verneinung oder gar nicht
    expect(text).not.toMatch(/Win-?Rate von|Profit-?Faktor von/i);
  });
});

describe("Bibliothek: jede Karte lädt einen gültigen Entwurf", () => {
  for (const card of STRATEGY_CARDS) {
    it(`${card.id}: alle drei Einstellungen sind gültig, gesäubert und unterschiedlich`, () => {
      const keys = new Set<string>();
      for (const level of LEVELS) {
        const cfg = buildCard(card, level);
        expect(validateCustom(cfg, { funding: true }).filter((i) => i.level === "error"), `${card.id} ${level}`).toEqual([]);
        expect(sanitizeCustom(cfg)).toEqual(cfg);
        expect(summarizeCustom(cfg)[0]).toMatch(/^(Long|Short) wenn /);
        expect(cfg.interval).toBe(card.tfs[0]);
        keys.add(customKey(cfg));
      }
      expect(keys.size, "konservativ / Standard / aggressiv ergeben verschiedene Regeln").toBeGreaterThan(1);
    });

    it(`${card.id}: jeder typische Wert wirkt wirklich auf den Entwurf (eine Zahl, eine Quelle)`, () => {
      const base = valuesOf(card, "standard");
      const ref = customKey(buildCard(card, "standard"));
      for (const p of card.params) {
        const other = p.v.find((x) => x !== base[p.key]);
        if (other === undefined) continue; // the same in all three settings
        const changed = card.make({ ...base, [p.key]: other });
        // the draft must differ, except where the engine clamps the number away (checked below)
        expect(customKey(changed), `${card.id}.${p.key}`).not.toBe(ref);
      }
    });
  }
});

describe("Bibliothek: die Entwürfe laufen auf einer Fixture-Kerzenreihe ohne Fehler", () => {
  let totalTrades = 0;
  for (const card of STRATEGY_CARDS) {
    it(`${card.id} (Standard)`, () => {
      const config: CustomConfig = buildCard(card, "standard");
      const input = { config, signal: DEFAULT_SIGNAL_CFG, funding: card.needs === "funding" ? FUNDING : null };
      const data: Record<string, ReturnType<typeof walk>> = {};
      for (const iv of customStrategy.intervals(input)) data[iv] = walk(iv === "1d" ? 700 : 1500, TF_SEC[iv], 17 + card.id.length);
      const exec = data[config.interval]!;
      const prep = customStrategy.prepare(data, input, exec[400]!.t * 1000).result();
      const strat = customStrategy.build(prep, {});
      const run = runBacktest(prep.bars, strat, engine, { from: prep.start, to: prep.bars.length - 1, equity: false, atr: prep.atr, secLen: TF_SEC[config.interval] });
      expect(Array.isArray(run.trades)).toBe(true);
      for (const t of run.trades) {
        expect(Number.isFinite(t.pnl)).toBe(true);
        expect(Number.isFinite(t.r)).toBe(true);
      }
      totalTrades += run.trades.length;
      // the funnel (the diagnosis' input) is computable too
      const f = customStrategy.funnel?.(prep, {}, { from: prep.start, to: prep.bars.length - 1 });
      expect(f?.nodes.length).toBeGreaterThan(0);
    }, 60_000);
  }
  it("zusammen erzeugen die Karten auf der Fixture-Reihe Trades (kein Karteileichen-Satz)", () => {
    expect(totalTrades).toBeGreaterThan(20);
  });
});

describe("Bibliothek: Suche und Filter", () => {
  it("findet über Titel, Herkunft und Parameternamen; jedes Wort muss passen", () => {
    expect(searchCards("turtle").map((c) => c.id).sort()).toEqual(["turtle-20", "turtle-55"]);
    expect(searchCards("Wolke").map((c) => c.id)).toContain("ichimoku-cloud");
    expect(searchCards("opening range london").map((c) => c.id)).toEqual(["orb-london"]);
    expect(searchCards("ADX").map((c) => c.id)).toContain("adx-trend");
    expect(searchCards("zzzz")).toEqual([]);
    expect(searchCards("")).toHaveLength(STRATEGY_CARDS.length);
  });
  it("filtert nach Typ", () => {
    const trend = searchCards("", "trend");
    expect(trend.length).toBeGreaterThan(3);
    expect(trend.every((c) => c.kind === "trend")).toBe(true);
    expect(searchCards("turtle", "trend")).toEqual([]);
  });
  it("Werte-Text mit Einheit und deutschem Komma", () => {
    const c = cardById("bollinger-reversion")!;
    const mult = c.params.find((p) => p.key === "mult")!;
    expect(valueText(mult, 0)).toBe("2,5 σ");
    expect(valueText(mult, 1)).toBe("2 σ");
  });
});
