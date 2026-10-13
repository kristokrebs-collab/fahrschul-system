/**
 * Box snapshot contract (`src/market/boxes/snapshot.ts`, Wave 0): the stored `Trade.boxSnap` is read defensively.
 */
import { describe, expect, it } from "vitest";
import { boxGradeOf, boxSnapOf, parseBoxSnapshot, resolveTradeBoxes, type BoxSnapshot } from "@/market/boxes/snapshot";
import { DIMENSIONS } from "@/domain/analytics/dimensions";
import type { EnrichedTrade } from "@/domain/types";

const SNAP: BoxSnapshot = {
  v: 1,
  symbol: "BTCUSDT",
  tf: "4h",
  at: 1_790_000_000_000,
  source: "live",
  phase: "breakout",
  dir: 1,
  pos: 1.1,
  zone: "top",
  box: { top: 86_000, bottom: 84_000, grade: "stark", quality: 70 },
  setup: { kind: "breakout", grade: "A", score: 80, side: "long", entry: 86_100, stop: 85_400, rr: 2.1, targets: [87_500] },
  htf: { tf: "1d", phase: "inside", dir: 0 },
  rsi: { last: 61, breakUp: true, breakDown: false },
};

describe("box snapshot", () => {
  it("parses a valid snapshot and reads the grade", () => {
    expect(parseBoxSnapshot(SNAP)).toBe(SNAP);
    expect(boxGradeOf({ boxSnap: SNAP })).toBe("A");
    expect(boxGradeOf({ boxSnap: { ...SNAP, setup: null } })).toBeNull();
  });

  it("rejects missing, foreign or malformed values", () => {
    expect(boxGradeOf({})).toBeNull();
    expect(parseBoxSnapshot(null)).toBeNull();
    expect(parseBoxSnapshot({ ...SNAP, v: 2 })).toBeNull();
    expect(parseBoxSnapshot({ ...SNAP, tf: "15m" })).toBeNull();
    expect(parseBoxSnapshot({ ...SNAP, at: "x" })).toBeNull();
    expect(boxGradeOf({ boxSnap: { ...SNAP, setup: { ...SNAP.setup, grade: "Z" } } })).toBeNull();
  });

  it("resolveTradeBoxes resolves a snapshot or null", async () => {
    const r = await resolveTradeBoxes("2026-10-02T10:00", "long");
    expect(r === null || parseBoxSnapshot(r) !== null).toBe(true);
  });
});

describe("box snapshot of another pair (review MM-6)", () => {
  it("readers ignore a snapshot whose symbol is not the trade's pair", () => {
    expect(boxSnapOf({ pair: "BTC/USDT", boxSnap: SNAP })).toBe(SNAP);
    expect(boxSnapOf({ pair: "BINANCE:BTCUSDT.P", boxSnap: SNAP })).toBe(SNAP);
    expect(boxSnapOf({ pair: "ETH/USDT", boxSnap: SNAP })).toBeNull();
    expect(boxGradeOf({ pair: "ETH/USDT", boxSnap: SNAP })).toBeNull();
    expect(boxGradeOf({ pair: "BTC/USDT", boxSnap: SNAP })).toBe("A");
    // no readable pair: nothing contradicts the stored context
    expect(boxGradeOf({ pair: "", boxSnap: SNAP })).toBe("A");
  });

  it("Analyse „Box-Note“: an ETH trade carrying BTC's box lands in „Ohne Box“, not in BTC's grade", () => {
    const ctx = { settings: { setups: [], capital: { makro: 0, scalp: 0 } } };
    const keys = (pair: string) => DIMENSIONS.box.keys({ pair, boxSnap: SNAP } as unknown as EnrichedTrade, ctx);
    expect(keys("BTC/USDT")).toEqual(["A"]);
    expect(keys("ETH/USDT")).not.toContain("A");
  });
});
