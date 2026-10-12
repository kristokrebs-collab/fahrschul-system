/// <reference types="node" />
/**
 * Journal v3 trade fields (Wave-0 contract): optional, additive, lenient. Legacy records must normalise, validate,
 * derive and export exactly as before; present fields are coerced, malformed ones dropped.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeSettings, normalizeTrade } from "@/domain/normalize";
import { TradeSchema } from "@/domain/schemas";
import { enrichTrades } from "@/domain/enrich";
import { tradesToCsv } from "@/domain/csv";
import { validateTrades } from "@/store/migrate";
import type { Trade } from "@/domain/types";

const FIX = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/tj2-v0.json"), "utf8")) as {
  "tj2-settings": unknown;
  "tj2-trades": Record<string, unknown>[];
};

const V3_KEYS = [
  "exitDate", "market", "exchange", "exchangeAccount", "externalId", "syncSource", "syncedAt", "qty", "fills", "fundingFees",
  "slippage", "plannedEntry", "margin", "marginMode", "liqPrice", "positionId", "groupId", "hedgeOf", "tags", "rating",
  "screenshots", "annotations", "mae", "mfe", "maeR", "mfeR", "atrPct", "stopHistory", "targets", "psych", "origin", "boxSnap",
] as const;

const FULL = {
  exitDate: "2026-10-02T14:05:30",
  market: "perp",
  exchange: "bitunix",
  exchangeAccount: "Haupt",
  externalId: "123456789",
  syncSource: "bitunix-api",
  syncedAt: "2026-10-02T12:06:00.000Z",
  qty: 0.25,
  fills: [
    { id: "f1", at: "2026-10-02T10:00", side: "open", price: 84000, qty: 0.25, fee: 4.2, kind: "entry" },
    { id: "f2", at: "2026-10-02T14:05", side: "close", price: 85000, qty: 0.25, kind: "exit", venueTradeId: "x9" },
  ],
  fundingFees: 1.5,
  slippage: 0.8,
  plannedEntry: 83990,
  margin: 4200,
  marginMode: "isolated",
  liqPrice: 70000,
  positionId: "p1",
  groupId: "g1",
  hedgeOf: "t_other",
  tags: ["Breakout", "London"],
  rating: 4,
  screenshots: [{ id: "s1", store: "idb", key: "shot-1", w: 1200, h: 800 }],
  annotations: [{ id: "a1", kind: "hline", points: [{ time: 1_790_000_000, price: 84500 }], color: "#fff" }],
  mae: 300,
  mfe: 1200,
  maeR: 0.3,
  mfeR: 1.2,
  atrPct: 1.8,
  stopHistory: [{ at: "2026-10-02T11:00", price: 84000, source: "manual" }],
  targets: [{ price: 85000, pct: 50, hit: true }, { price: 86000, pct: 50 }],
  psych: { stress: 2, confidence: 4, flags: ["fomo"], exitReason: "Ziel", preNote: "ruhig", postNote: "gut" },
  origin: { kind: "api", botId: "b1" },
  boxSnap: { v: 1, grade: "A", anything: [1, 2] },
};

const base = (): Record<string, unknown> => ({
  id: "t_v3",
  account: "scalp",
  side: "long",
  status: "closed",
  date: "2026-10-02T10:00",
  pair: "BTCUSDT",
  timeframe: "4h",
  entry: 84000,
  stop: 83000,
  target: 86000,
  exit: 85000,
  size: 21000,
  leverage: 5,
  fees: 8,
  pnlManual: null,
  setups: [],
  checks: {},
  conviction: 3,
  followedPlan: true,
  emotion: "Ruhig",
  reason: "",
  notes: "",
  chart: "",
  pnl: null,
  r: null,
  createdAt: "2026-10-02T10:00:00.000Z",
  updatedAt: "2026-10-02T10:00:00.000Z",
});

describe("journal v3 trade fields – backward compatibility", () => {
  it("legacy fixture trades gain no new keys and keep every value", () => {
    for (const raw of FIX["tj2-trades"]) {
      const t = normalizeTrade(raw);
      for (const k of V3_KEYS) expect(k in t).toBe(false);
      expect(TradeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("P&L, R and the CSV export of legacy trades are unchanged by present v3 fields", () => {
    const settings = normalizeSettings(FIX["tj2-settings"]);
    const legacy = FIX["tj2-trades"].map(normalizeTrade);
    const withV3 = FIX["tj2-trades"].map((raw) => normalizeTrade({ ...raw, tags: ["x"], rating: 5, mae: 1, origin: { kind: "manual" } }));
    const a = enrichTrades(legacy, settings);
    const b = enrichTrades(withV3, settings);
    expect(b.map((t) => [t.pnl, t.r, t.risk, t.rr, t.result])).toEqual(a.map((t) => [t.pnl, t.r, t.risk, t.rr, t.result]));
    expect(tradesToCsv(b, settings)).toBe(tradesToCsv(a, settings));
  });
});

describe("journal v3 trade fields – normalisation", () => {
  it("a complete v3 record survives verbatim (idempotent) and validates", () => {
    const t = normalizeTrade({ ...base(), ...FULL });
    for (const k of V3_KEYS) expect(t[k as keyof Trade]).toEqual(FULL[k]);
    expect(normalizeTrade(t)).toEqual(t);
    expect(TradeSchema.safeParse(t).success).toBe(true);
    expect(validateTrades([t]).valid).toHaveLength(1);
  });

  it("coerces form strings and venue spellings", () => {
    const t = normalizeTrade({
      ...base(),
      qty: "0,5",
      liqPrice: "",
      marginMode: "ISOLATION",
      externalId: 987654321,
      rating: "4",
      tags: [" Breakout ", "Breakout", 7, ""],
      market: "SWAP",
    });
    expect(t.qty).toBe(0.5);
    expect(t.liqPrice).toBeNull();
    expect(t.marginMode).toBe("isolated");
    expect(t.externalId).toBe("987654321");
    expect(t.rating).toBe(4);
    expect(t.tags).toEqual(["Breakout"]);
    expect("market" in t).toBe(false);
    expect(normalizeTrade({ ...base(), marginMode: "Cross" }).marginMode).toBe("cross");
  });

  it("drops malformed values instead of quarantining the trade", () => {
    const t = normalizeTrade({
      ...base(),
      exitDate: 12,
      rating: 7,
      tags: "Breakout",
      fills: [null, { price: "x", qty: 1 }, { price: 100, qty: 0 }, { price: "84000", qty: "0,1", side: "close", kind: "bogus" }],
      screenshots: [{ id: "a", store: "url", url: "javascript:alert(1)" }, { id: "b", store: "url", url: "https://x.test/a.png" }, { store: "idb" }],
      annotations: [{ id: "a", kind: "circle", points: [] }, { id: "b", kind: "text", points: [{ time: "1", price: null }] }, { id: "c", kind: "trend", points: [{ time: 1, price: 2 }, { time: "x", price: 3 }] }],
      stopHistory: [{ at: "2026-10-02T11:00", price: "83.500" }, { price: "nope" }],
      targets: [{ price: 1, pct: "50", hit: "yes" }, { pct: 50 }],
      psych: "angespannt",
      origin: { kind: "sorcery" },
    });
    expect("exitDate" in t).toBe(false);
    expect(t.rating).toBeNull();
    expect("tags" in t).toBe(false);
    expect(t.fills).toEqual([{ id: "f3", at: "", side: "close", price: 84000, qty: 0.1, kind: "exit" }]);
    expect(t.screenshots).toEqual([{ id: "b", store: "url", url: "https://x.test/a.png" }]);
    expect(t.annotations).toEqual([{ id: "c", kind: "trend", points: [{ time: 1, price: 2 }] }]);
    expect(t.stopHistory).toEqual([{ at: "2026-10-02T11:00", price: 83.5 }]);
    expect(t.targets).toEqual([{ price: 1, pct: 50, hit: false }]);
    expect("psych" in t).toBe(false);
    expect("origin" in t).toBe(false);
    expect(TradeSchema.safeParse(t).success).toBe(true);
  });

  it("psych scales and flags are clamped", () => {
    const t = normalizeTrade({ ...base(), psych: { stress: 9, confidence: "3", flags: ["fomo", 1, "fomo"], extra: true } });
    expect(t.psych).toEqual({ stress: null, confidence: 3, flags: ["fomo"], extra: true });
  });
});
