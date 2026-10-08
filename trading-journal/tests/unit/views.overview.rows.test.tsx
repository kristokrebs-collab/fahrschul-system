/**
 * Design pass v3 (decision 22): every overview card fills its grid row — charts take the free height (`fill`), the
 * Checkliste shows `Wirkung je Punkt` only in its free height.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { EquityChart, type EquityPoint } from "@/chart/EquityChart";
import { MonthlyBars, type MonthBucket } from "@/chart/MonthlyBars";
import type { Agg } from "@/domain/agg";
import type { ChecklistItemStats } from "@/domain/checklist";
import { impactRows } from "@/views/overview/ChecklistCard";

if (typeof globalThis.ResizeObserver === "undefined") {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
}

const agg = (winRate: number | null, n = 2): Agg => ({ n, winRate }) as unknown as Agg;
const item = (text: string, delta: number | null, n = 4): ChecklistItemStats => ({ text, n, withChecked: agg(0.5), withoutChecked: agg(0.5), delta });

describe("overview rows", () => {
  it("impactRows: only items with both sides, strongest difference first (ties: more trades)", () => {
    const rows = impactRows([item("a", 0.1), item("b", null), item("c", -0.6), item("d", 0.6, 9), item("e", 0)]);
    expect(rows.map((r) => r.text)).toEqual(["d", "c", "a", "e"]);
  });

  it("EquityChart fill: grows in a flex column with its height as the minimum; default keeps the fixed height", () => {
    const points = [{ i: 0, v: 100 }, { i: 1, v: 120 }] as unknown as EquityPoint[];
    const { container, rerender } = render(<EquityChart points={points} start={100} balance={120} currency="USDT" fill />);
    const box = container.querySelector<HTMLElement>("[class*='eq-area']")!;
    expect(box.className).toContain("flex-1");
    expect(box.style.minHeight).toBe("268px");
    expect(box.style.height).toBe("");
    rerender(<EquityChart points={points} start={100} balance={120} currency="USDT" />);
    expect(box.className).not.toContain("flex-1");
    expect(box.style.height).toBe("268px");
  });

  it("MonthlyBars fill: the chart grows with 240 px as its minimum", () => {
    const months = [{ key: "2026-01", label: "Jan 26", net: 100, n: 1, wins: 1, winRate: 1 }] as unknown as MonthBucket[];
    const { container } = render(<MonthlyBars months={months} currency="USDT" fill />);
    const chart = container.querySelector<HTMLElement>("[role=img]")!;
    expect(chart.className).toContain("flex-1");
    expect(chart.style.minHeight).toBe("240px");
  });
});
