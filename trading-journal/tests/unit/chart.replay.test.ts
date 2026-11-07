import { describe, expect, it } from "vitest";
import { buildReplaySeries, replayAt, replayKey, timeAtX, xAtTime } from "@/chart/replay";
import { replayValueText } from "@/chart/EquityChart";

const t = (pnl: number) => ({ pnl });
const points = [
  { v: 1000, t: null },
  { v: 1100, t: t(100) },
  { v: 1050, t: t(-50) },
  { v: 1050, t: t(0) },
  { v: 1250, t: t(200) },
];

describe("equity replay math", () => {
  const s = buildReplaySeries(points);

  it("builds cumulative wins with the aggregate rule (pnl > 0)", () => {
    expect(s.wins).toEqual([0, 1, 1, 1, 2]);
    expect(s.pnl).toEqual([null, 100, -50, 0, 200]);
  });

  it("interpolates the balance and counts trades the playhead reached", () => {
    expect(replayAt(s, 0)).toEqual({ t: 0, k: 0, balance: 1000, winRate: null });
    expect(replayAt(s, 0.5).balance).toBe(1050);
    expect(replayAt(s, 0.5).k).toBe(0);
    const f = replayAt(s, 2);
    expect(f.k).toBe(2);
    expect(f.winRate).toBe(0.5);
    expect(replayAt(s, 3.999999999).k).toBe(4);
    expect(replayAt(s, 99)).toEqual({ t: 4, k: 4, balance: 1250, winRate: 0.5 });
    expect(replayAt(s, -3).t).toBe(0);
  });

  it("maps time ↔ x piecewise linearly over the plotted points", () => {
    const xs = [62, 162, 262, 362, 462];
    expect(xAtTime(xs, 0)).toBe(62);
    expect(xAtTime(xs, 1.5)).toBe(212);
    expect(xAtTime(xs, 9)).toBe(462);
    expect(timeAtX(xs, 0)).toBe(0);
    expect(timeAtX(xs, 212)).toBe(1.5);
    expect(timeAtX(xs, 999)).toBe(4);
    expect(timeAtX([10], 50)).toBe(0);
  });

  it("slider keys step whole trades, Shift by five, Home/End to the ends", () => {
    expect(replayKey("ArrowLeft", false, 4, 4)).toBe(3);
    expect(replayKey("ArrowLeft", false, 2.4, 4)).toBe(2);
    expect(replayKey("ArrowRight", false, 2.4, 4)).toBe(3);
    expect(replayKey("ArrowLeft", true, 4, 4)).toBe(0);
    expect(replayKey("ArrowRight", true, 0, 12)).toBe(5);
    expect(replayKey("Home", false, 3, 4)).toBe(0);
    expect(replayKey("End", false, 1, 4)).toBe(4);
    expect(replayKey("a", false, 1, 4)).toBeNull();
  });

  it("describes the slider value in German", () => {
    expect(replayValueText(0, 4, 1000, null, "USDT")).toBe("Start · Kontostand 1.000 USDT");
    expect(replayValueText(2, 4, 1050, 0.5, "USDT")).toBe("Trade 2 von 4 · Kontostand 1.050 USDT · Win-Rate 50 %");
  });
});
