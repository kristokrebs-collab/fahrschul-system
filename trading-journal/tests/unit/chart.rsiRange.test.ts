import { describe, expect, it } from "vitest";
import { rsiRange } from "@/chart/rsiPane";

const base = (min: number, max: number) => () => ({ priceRange: { minValue: min, maxValue: max } });

describe("RSI pane scale", () => {
  it("keeps the 30 / 70 guides in view with a little air around a calm line", () => {
    expect(rsiRange(base(40, 58)).priceRange).toEqual({ minValue: 26, maxValue: 74 });
  });
  it("follows an excursion beyond the guides and never leaves 0–100", () => {
    expect(rsiRange(base(18, 83)).priceRange).toEqual({ minValue: 14, maxValue: 87 });
    expect(rsiRange(base(1, 99)).priceRange).toEqual({ minValue: 0, maxValue: 100 });
  });
  it("falls back to the guides when the series has no data yet", () => {
    expect(rsiRange(() => null).priceRange).toEqual({ minValue: 26, maxValue: 74 });
  });
});
