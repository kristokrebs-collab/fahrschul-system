import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EquityChart, equityAccent, equityTickLabel, nearestIndex, type EquityPoint } from "@/chart/EquityChart";
import { MonthlyBars, barDelay, monthFill, roundedBarPath, toBarIndex, type MonthBucket } from "@/chart/MonthlyBars";
import { resetInViewObserverForTests } from "@/motion/inView";
import type { Trade } from "@/domain/types";

// jsdom has no layout: give Recharts' ResponsiveContainer a real box
const rect = { x: 0, y: 0, width: 600, height: 268, top: 0, left: 0, right: 600, bottom: 268, toJSON: () => ({}) };
HTMLElement.prototype.getBoundingClientRect = () => rect as DOMRect;
if (typeof globalThis.ResizeObserver === "undefined") {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
}

/** An IntersectionObserver that reports every observed element as visible right away. */
function installVisibleObserver(): () => void {
  const prev = globalThis.IntersectionObserver;
  class IO {
    constructor(private readonly cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      queueMicrotask(() => this.cb([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.IntersectionObserver = IO as unknown as typeof IntersectionObserver;
  resetInViewObserverForTests();
  return () => {
    globalThis.IntersectionObserver = prev;
    resetInViewObserverForTests();
  };
}

const translateX = (el: Element | null): number => Number(/translateX\((-?[\d.]+)px\)/.exec((el as HTMLElement | null)?.style.transform ?? "")?.[1] ?? Number.NaN);

afterEach(() => {
  vi.restoreAllMocks();
});

function trade(id: string, pnl: number, date: string): Trade {
  return {
    id,
    account: "scalp",
    side: "long",
    status: "closed",
    date,
    pair: "BTC/USDT",
    timeframe: "1h",
    entry: 84000,
    stop: 83500,
    target: 85000,
    exit: 84500,
    size: 1000,
    leverage: 5,
    fees: 1,
    pnlManual: null,
    setups: [],
    checks: {},
    conviction: 3,
    followedPlan: true,
    emotion: "Ruhig",
    reason: "",
    notes: "",
    chart: "",
    pnl,
    r: 1,
    createdAt: date,
    updatedAt: date,
  };
}

const points: EquityPoint[] = [
  { i: 0, v: 10000, t: null },
  { i: 1, v: 10120.5, t: trade("a", 120.5, "2026-09-01T10:00") },
  { i: 2, v: 10060.5, t: trade("b", -60, "2026-09-03T14:00") },
];

const months: MonthBucket[] = [
  { key: "2026-08", label: "Aug 26", net: 320, n: 4, winRate: 0.75 },
  { key: "2026-09", label: "Sep 26", net: -80.25, n: 2, winRate: 0.5 },
];

describe("EquityChart", () => {
  it("renders an accessible SVG area chart from fixture data", () => {
    const { container } = render(<EquityChart points={points} start={10000} balance={10060.5} currency="USDT" />);
    expect(screen.getByRole("img", { name: "Kontostand-Verlauf" })).toBeInTheDocument();
    expect(container.querySelector("svg.recharts-surface")).not.toBeNull();
    expect(container.querySelector(".recharts-area")).not.toBeNull();
    expect(container.querySelectorAll("linearGradient")).toHaveLength(2);
  });
  it("marks the current balance with a live endpoint and reads points on hover without React state", async () => {
    const errors = vi.spyOn(console, "error");
    const warns = vi.spyOn(console, "warn");
    const restore = installVisibleObserver();
    try {
      const { container } = render(<EquityChart points={points} start={10000} balance={10060.5} currency="USDT" />);
      const now = container.querySelector("[data-fx='equity-now']");
      expect(now).not.toBeNull();
      expect(now?.getAttribute("aria-hidden")).toBe("true");
      await waitFor(() => expect(translateX(now)).toBeGreaterThan(0));
      // the draw-in finishes in jsdom too; the area is no longer clipped by the pending state
      await waitFor(() => expect((container.firstElementChild as HTMLElement).dataset.draw).toBe("done"));

      const wrap = container.firstElementChild as HTMLElement;
      act(() => {
        fireEvent.pointerMove(wrap, { clientX: translateX(now), clientY: 40 });
      });
      expect(wrap.textContent).toContain("Trade #2");
      expect(wrap.textContent).toContain("10.061 USDT");
      act(() => {
        fireEvent.pointerLeave(wrap);
      });
      expect(errors).not.toHaveBeenCalled();
      expect(warns).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("finds the nearest plotted point", () => {
    expect(nearestIndex([], 5)).toBe(-1);
    expect(nearestIndex([0, 10, 20], -4)).toBe(0);
    expect(nearestIndex([0, 10, 20], 6)).toBe(1);
    expect(nearestIndex([0, 10, 20], 14)).toBe(1);
    expect(nearestIndex([0, 10, 20], 16)).toBe(2);
    expect(nearestIndex([0, 10, 20], 99)).toBe(2);
  });

  it("chooses the accent by balance vs start", () => {
    expect(equityAccent(10060, 10000)).toBe("#f2f2f2");
    expect(equityAccent(9900, 10000)).toBe("#ff4d4f");
    expect(equityTickLabel(0)).toBe("Start");
    expect(equityTickLabel(7)).toBe("#7");
  });
});

describe("MonthlyBars", () => {
  it("renders bars with monochrome fills", () => {
    const { container } = render(<MonthlyBars months={months} currency="USDT" />);
    expect(screen.getByRole("img", { name: "P&L pro Monat" })).toBeInTheDocument();
    expect(container.querySelector("svg.recharts-surface")).not.toBeNull();
    expect(container.querySelector(".recharts-bar")).not.toBeNull();
    expect(monthFill(1)).toBe("#f2f2f2");
    expect(monthFill(-1)).toBe("#5f5f5f");
  });
  it("grows bars out of the zero line once in view, staggered and capped", async () => {
    const errors = vi.spyOn(console, "error");
    const restore = installVisibleObserver();
    try {
      const { container } = render(<MonthlyBars months={months} currency="USDT" />);
      await waitFor(() => expect(container.querySelectorAll("[data-bar]")).toHaveLength(2));
      const gain = container.querySelector<SVGPathElement>("[data-bar='0']");
      const loss = container.querySelector<SVGPathElement>("[data-bar='1']");
      // a gain grows from its bottom edge, a loss from its top edge (both sit on the zero line)
      expect(gain?.style.transformOrigin).toContain("100%");
      expect(loss?.style.transformOrigin.split(" ")[1]).toBe("0%");
      expect(errors).not.toHaveBeenCalled();
    } finally {
      restore();
    }
    expect(barDelay(0)).toBe(0);
    expect(barDelay(3)).toBeCloseTo(0.09);
    expect(barDelay(40)).toBe(barDelay(12));
    expect(toBarIndex(3)).toBe(3);
    expect(toBarIndex("4")).toBe(4);
    expect(toBarIndex(null)).toBe(-1);
    expect(toBarIndex(undefined)).toBe(-1);
  });

  it("rounds the correct end of the bar", () => {
    const pos = roundedBarPath({ x: 10, y: 20, width: 30, height: 50, positive: true })!;
    expect(pos.startsWith("M10,70 L10,24 Q10,20 14,20")).toBe(true);
    const neg = roundedBarPath({ x: 10, y: 20, width: 30, height: 50, positive: false })!;
    expect(neg.startsWith("M10,20 L40,20 L40,66")).toBe(true);
    expect(roundedBarPath({ x: 0, y: 0, width: 10, height: 0.2, positive: true })).toBeNull();
    // radius shrinks with tiny bars
    expect(roundedBarPath({ x: 0, y: 0, width: 4, height: 1, positive: true })).toContain("Q0,0 1,0");
  });
});
