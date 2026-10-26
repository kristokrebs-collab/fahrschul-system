/**
 * „Lücken in den geladenen Reihen“ (F27): the running gap display under the Live-Daten table. `usualStep` / `seriesGaps` worked out by
 * hand, then the rows with fixed series in place of the live feeds: lückenlos, a hole with the count of missing entries, a series
 * without fixed step (the step is read from the series), too few points to check, no data at all.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { seriesGaps, usualStep } from "@/domain/missed";
import { ddmmHHmm } from "@/market/format";
import { FeedGaps, GAP_STRINGS, gapSummaryText } from "@/views/settings/FeedGaps";
import { FEED_LABELS } from "@/views/settings/LiveDataCard";

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Date.UTC(2026, 9, 26, 0, 0, 0);

const feeds = vi.hoisted(() => ({ data: {} as Record<string, number[]> }));
vi.mock("@/market", () => ({
  useFeedSelect: (feed: string, select: (v: { data: Array<{ time: number }> } | undefined) => unknown) => {
    const t = feeds.data[feed];
    return select(t ? { data: t.map((time) => ({ time })) } : undefined);
  },
}));

describe("usualStep / seriesGaps", () => {
  it("the most usual distance, the smaller on a tie, nothing under 3 points", () => {
    expect(usualStep([0, 1, 2, 3, 5, 6])).toBe(1);
    expect(usualStep([0, 2, 4, 5, 6])).toBe(1); // 2 × 2 and 2 × 1: tie → the smaller
    expect(usualStep([0, 1])).toBeNull();
    expect(usualStep([5, 5, 5])).toBeNull(); // no positive distance
  });

  it("hourly points with one missing: one gap of 1, 12 points, the step is given", () => {
    const times = [0, 1, 2, 3, 5, 6, 7, 8].map((h) => T0 + h * H);
    const g = seriesGaps(times, H);
    expect(g).toMatchObject({ points: 8, first: T0, last: T0 + 8 * H, stepMs: H, inferred: false, missing: 1 });
    expect(g.gaps).toEqual([{ from: T0 + 4 * H, to: T0 + 4 * H, missing: 1 }]);
  });

  it("a 3-candle hole and a 1-candle hole are 4 missing in 2 gaps; a step of 1,4× is no gap, 1,6× is", () => {
    const g = seriesGaps([0, 1, 5, 6, 8].map((h) => T0 + h * H), H);
    expect(g.gaps.map((x) => x.missing)).toEqual([3, 1]);
    expect(g.missing).toBe(4);
    expect(seriesGaps([T0, T0 + 1.4 * H, T0 + 2.8 * H], H).gaps).toEqual([]);
    expect(seriesGaps([T0, T0 + 1.6 * H], H).gaps).toHaveLength(1);
  });

  it("without a given step it reads the usual distance of the series (funding every 8 h)", () => {
    const g = seriesGaps([0, 8, 16, 32, 40].map((h) => T0 + h * H));
    expect(g).toMatchObject({ stepMs: 8 * H, inferred: true, missing: 1 });
  });

  it("an empty series and one with too few points have no gap to find", () => {
    expect(seriesGaps([], H)).toMatchObject({ points: 0, first: null, last: null, gaps: [], missing: 0 });
    expect(seriesGaps([T0, T0 + 3 * H])).toMatchObject({ stepMs: null, gaps: [] });
  });
});

describe("the sentences", () => {
  it("lückenlos, with holes, too few points, no data", () => {
    const hourly = (hs: number[]) => seriesGaps(hs.map((h) => T0 + h * H), H);
    expect(gapSummaryText(hourly([0, 1, 2, 3]), "Kerzen")).toBe(`4 Kerzen · bis ${ddmmHHmm(T0 + 3 * H)} · lückenlos`);
    expect(gapSummaryText(hourly([0, 1, 4]), "Kerzen")).toBe(`3 Kerzen · bis ${ddmmHHmm(T0 + 4 * H)} · 1 Lücke, 2 fehlende Einträge; jüngste ${ddmmHHmm(T0 + 2 * H)} bis ${ddmmHHmm(T0 + 3 * H)}`);
    expect(gapSummaryText(seriesGaps([T0, T0 + H]), "Punkte")).toContain("zu wenig Punkte, um Lücken zu prüfen");
    expect(gapSummaryText(hourly([]), "Kerzen")).toBe(GAP_STRINGS.none);
  });
});

describe("FeedGaps", () => {
  it("one row per series, each with its own summary; a hole is marked, an empty series says so, nothing is filled", () => {
    feeds.data = {
      kline_1h: [0, 1, 2, 3, 4, 5].map((h) => T0 + h * H),
      kline_4h: [0, 4, 12, 16].map((h) => T0 + h * H), // one 4h candle (08:00) missing
      fundingHistory: [0, 8, 16, 24].map((h) => T0 + h * H),
    };
    render(<FeedGaps labels={FEED_LABELS} />);
    expect(screen.getByTestId("feed-gaps")).toHaveTextContent(GAP_STRINGS.lead);
    const h1 = screen.getByTestId("feed-gaps-kline_1h");
    expect(h1).toHaveAttribute("data-gaps", "0");
    expect(h1).toHaveTextContent("Kerzen 1h");
    expect(h1).toHaveTextContent("6 Kerzen");
    expect(h1).toHaveTextContent("lückenlos");
    const h4 = screen.getByTestId("feed-gaps-kline_4h");
    expect(h4).toHaveAttribute("data-gaps", "1");
    expect(h4).toHaveAttribute("data-missing", "1");
    expect(h4).toHaveTextContent("1 Lücke, 1 fehlender Eintrag");
    expect(within(h4).getByText(/Lücke/)).toHaveClass("text-warn");
    expect(screen.getByTestId("feed-gaps-fundingHistory")).toHaveTextContent("4 Punkte");
    expect(screen.getByTestId("feed-gaps-fundingHistory")).toHaveTextContent("lückenlos");
    expect(screen.getByTestId("feed-gaps-kline_1m")).toHaveTextContent(GAP_STRINGS.none);
    expect(screen.getByTestId("feed-gaps-kline_1m")).toHaveAttribute("data-points", "0");
    expect(screen.getAllByRole("listitem")).toHaveLength(14);
  });
});
