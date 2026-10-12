/**
 * Box snapshot contract (`src/market/boxes/snapshot.ts`, Wave 0): the stored `Trade.boxSnap` is read defensively.
 */
import { describe, expect, it } from "vitest";
import { boxGradeOf, parseBoxSnapshot, resolveTradeBoxes, type BoxSnapshot } from "@/market/boxes/snapshot";

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
