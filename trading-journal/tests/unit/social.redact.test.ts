import { describe, expect, it } from "vitest";
import { enrichTrade } from "@/domain/enrich";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { CreateShareSchema, parseSharePayload, SharedTradeSchema } from "@/social/contract";
import { redactSetup, redactStats, redactTrade, sharedDetails } from "@/social/redact";
import { socialStats } from "@/social/metrics";
import { mkTrade, settings } from "./domain.fixtures";

function enriched(over: Record<string, unknown> = {}): EnrichedTrade {
  const s = settings();
  const t = mkTrade({
    id: "t1",
    pair: "BTCUSDT",
    side: "long",
    date: "2026-10-01T09:45",
    exitDate: "2026-10-01T13:15",
    entry: 60000,
    stop: 59000,
    target: 63000,
    exit: 62000,
    size: 20000,
    leverage: 4,
    fees: 12,
    notes: "Konto 20k, Plan B",
    reason: "Bauchgefühl",
    emotion: "Ruhig",
    tags: ["A+", "Breakout"],
    mistakes: ["zu früh"],
    rating: 4,
    maeR: 0.35,
    mfeR: 2.4,
    setups: [s.setups[0]!.id],
    ...over,
  });
  return enrichTrade(t, s);
}

const MONEY = /20000|20\.000|"size"|"pnl"|"fees"|notes|reason|Konto|Bauchgefühl|account/;

describe("Schwärzung", () => {
  it("Standard: R, Bewegung, Tag – keine Euro-Beträge, keine Notizen, keine Preise, keine Uhrzeit", () => {
    const p = redactTrade(enriched());
    expect(p).toMatchObject({ v: 1, kind: "trade", pair: "BTCUSDT", side: "long", day: "2026-10-01", result: "win", r: 1.96, movePct: 3.3, rating: 4, maeR: 0.35, mfeR: 2.4 });
    expect(JSON.stringify(p)).not.toMatch(MONEY);
    expect(p.entry).toBeUndefined();
    expect(p.time).toBeUndefined();
    expect(p.setups).toBeUndefined();
    expect(p.tags).toBeUndefined();
    expect(sharedDetails(p)).toEqual([]);
    expect(SharedTradeSchema.safeParse(p).success).toBe(true);
  });

  it("Details nur auf Wunsch", () => {
    const s = settings();
    const p = redactTrade(enriched(), { prices: true, time: true, setups: true, tags: true }, s.setups);
    expect(p).toMatchObject({ entry: 60000, exit: 62000, stop: 59000, target: 63000, leverage: 4, time: "09:45", holdMin: 210, setups: [s.setups[0]!.name], tags: ["A+", "Breakout"], mistakes: ["zu früh"], emotion: "Ruhig" });
    expect(sharedDetails(p).sort()).toEqual(["prices", "setups", "tags", "time"]);
    expect(JSON.stringify(p)).not.toMatch(/20000|"pnl"|notes|Konto/);
  });

  it("offener Trade, kaputte Werte", () => {
    const p = redactTrade(enriched({ status: "open", exit: null, exitDate: undefined, pair: "", rating: 9, timeframe: "viel-zu-lang-xyz" }));
    expect(p.result).toBe("open");
    expect(p.pair).toBe("-");
    expect(p.rating).toBeNull();
    expect(p.timeframe!.length).toBeLessThanOrEqual(8);
  });

  it("der strikte Server-Vertrag lehnt alles Fremde ab", () => {
    const p = redactTrade(enriched());
    expect(parseSharePayload(p)).not.toBeNull();
    expect(parseSharePayload({ ...p, pnl: 400 })).toBeNull();
    expect(parseSharePayload({ ...p, notes: "x" })).toBeNull();
    expect(parseSharePayload({ ...p, r: 1e9 })).toBeNull();
    expect(CreateShareSchema.safeParse({ payload: p, expiresInDays: 3 }).success).toBe(false);
    expect(CreateShareSchema.parse({ payload: p }).expiresInDays).toBe(30);
  });

  it("Setup ohne persönliche Daten: keine Beispiel-Trades, Risiko nur in % / R", () => {
    const base: Setup = { id: "s_x", name: "Box-Breakout", account: "scalp", color: "#e5202e", desc: "Ausbruch aus der 4h-Box", checklist: [{ id: "c1", text: "Box bestätigt" }, { id: "c2", text: "  " }] };
    const setup = { ...base, entryCriteria: [{ id: "k1", text: "Close über Box" }], exitCriteria: [], riskModel: { riskPct: 1, maxLeverage: 5, minRR: 2, stop: "box" }, tags: ["Momentum"], examples: ["t_secret"], markets: ["btcusdt"], tf: ["4h"] } as unknown as Setup;
    const p = redactSetup(setup, { trades: 31, winRate: 54.84, expectancyR: 0.417 });
    expect(p).toMatchObject({ kind: "setup", name: "Box-Breakout", checklist: ["Box bestätigt"], entryCriteria: ["Close über Box"], risk: { riskPct: 1, maxLeverage: 5, minRR: 2, stop: "box" }, markets: ["BTCUSDT"], tf: ["4h"], stats: { trades: 31, winRate: 54.8, expectancyR: 0.42 } });
    expect(JSON.stringify(p)).not.toContain("t_secret");
    expect(redactSetup(base).risk).toBeNull();
    expect(redactSetup(base).stats).toBeNull();
  });

  it("Kennzahlen-Karte", () => {
    const s = socialStats([], Date.now());
    expect(redactStats(s)).toEqual({ v: 1, kind: "stats", windowDays: 90, trades: 0, expectancyR: null, winRate: null, discipline: null, consistency: null });
  });
});
