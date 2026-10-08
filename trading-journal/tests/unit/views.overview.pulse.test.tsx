import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { digitsOnlyChange, StatusPill } from "@/motion/StatusPill";
import { EmptyState, EMPTY_LINE } from "@/primitives/EmptyState";
import { fitValue } from "@/primitives/StatTile";
import { verdictKey } from "@/primitives/VerdictPanel";
import { MARKET_TILE_IDS, MARKET_TILES_KEY, parseTileOrder, useMarketTileOrder } from "@/views/overview/marketTiles";
import { milestoneProgress, milestoneVisual } from "@/views/overview/projectionTimeline";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("market tile order (tj2-ui-market-tiles)", () => {
  it("validates stored ids: unknown and duplicate ids dropped, missing tiles appended", () => {
    expect(parseTileOrder(null)).toEqual([...MARKET_TILE_IDS]);
    expect(parseTileOrder("not json")).toEqual([...MARKET_TILE_IDS]);
    expect(parseTileOrder('{"a":1}')).toEqual([...MARKET_TILE_IDS]);
    expect(parseTileOrder('["book","oops","book",3,"oi"]')).toEqual(["book", "oi", "funding", "taker"]);
  });

  it("reads once and persists every reorder", () => {
    localStorage.setItem(MARKET_TILES_KEY, '["taker","funding"]');
    let api: ReturnType<typeof useMarketTileOrder> | null = null;
    function Probe() {
      api = useMarketTileOrder();
      return null;
    }
    render(<Probe />);
    expect(api![0]).toEqual(["taker", "funding", "oi", "book"]);
    act(() => api![1](["book", "taker", "funding", "oi", "evil"]));
    expect(api![0]).toEqual(["book", "taker", "funding", "oi"]);
    expect(JSON.parse(localStorage.getItem(MARKET_TILES_KEY)!)).toEqual(["book", "taker", "funding", "oi"]);
  });
});

describe("projection milestone rail", () => {
  it("runs 0 → 1 while the dot travels from 74 % to 49 % of the viewport", () => {
    expect(milestoneProgress(900, 1000)).toBe(0);
    expect(milestoneProgress(740, 1000)).toBe(0);
    expect(milestoneProgress(615, 1000)).toBeCloseTo(0.5);
    expect(milestoneProgress(490, 1000)).toBe(1);
    expect(milestoneProgress(-50, 1000)).toBe(1);
  });

  it("stem draws with p^2.2, the dot fills from p 0.25", () => {
    expect(milestoneVisual(0)).toEqual({ stem: 0, dot: 0 });
    expect(milestoneVisual(0.25).dot).toBe(0);
    expect(milestoneVisual(0.5).stem).toBeCloseTo(Math.pow(0.5, 2.2));
    expect(milestoneVisual(1)).toEqual({ stem: 1, dot: 1 });
  });
});

describe("verdict key word", () => {
  it("marks short leads only", () => {
    expect(verdictKey("Im Plus. Weiter so.")).toEqual({ key: "Im Plus", sep: ".", rest: " Weiter so." });
    expect(verdictKey("Unter 1: Die Verluste sind größer als die Gewinne.")?.key).toBe("Unter 1");
    expect(verdictKey("Zwischen 1,5 und 2: solides System.")?.key).toBe("Zwischen 1,5 und 2");
    expect(verdictKey("Kein Warnsignal.")).toEqual({ key: "Kein Warnsignal", sep: ".", rest: "" });
    expect(verdictKey("Du liegst 3,2 Prozentpunkte über deiner Break-even-Win-Rate. Das System ist profitabel.")).toBeNull();
    expect(verdictKey("Genug Trades für belastbare Kennzahlen.")).toBeNull();
    expect(verdictKey("ohne Satzzeichen")).toBeNull();
  });
});

describe("StatTile value fit (MO-01)", () => {
  it("caps at 17 px and shrinks by the tile's container width", () => {
    expect(fitValue(0)).toBeUndefined();
    expect(fitValue(16)).toBe("min(17px, calc((100cqw - 26px) / 9.60))");
  });
});

describe("StatusPill label morph (ST-02)", () => {
  it("swaps digit-only changes, morphs word changes after the pill has grown", () => {
    expect(digitsOnlyChange("Zuletzt 01:39", "Zuletzt 01:40")).toBe(true);
    expect(digitsOnlyChange("Live", "Offline")).toBe(false);
  });

  it("holds the old word while a longer one waits for the width, then settles to plain text", async () => {
    vi.useFakeTimers();
    // jsdom has no layout: the new word's sizer reports wider than the old one
    const widths = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return (this.textContent ?? "").length * 7;
    });
    const { rerender } = render(<StatusPill tone="live" expanded label="Live" />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    rerender(<StatusPill tone="warn" expanded label="Zuletzt 01:39 · veraltet" />);
    const phase = () => document.querySelector("[data-label-phase]")?.getAttribute("data-label-phase") ?? "rest";
    expect(phase()).toBe("grow");
    // the visible (morph) cell still carries the OLD word while the pill widens
    expect(document.querySelector("[data-pulse='text-morph'] .sr-only")?.textContent).toBe("Live");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(["morph", "rest"]).toContain(phase());
    widths.mockRestore();
  });
});

describe("EmptyState typed line", () => {
  it("keeps title / text / CTA and adds the status line (typed at once without an observer)", () => {
    render(<EmptyState title="Noch keine Kurve" text="Text" action={<button type="button">CTA</button>} />);
    expect(screen.getByText("Noch keine Kurve")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CTA" })).toBeInTheDocument();
    expect(document.querySelector("[data-pulse='typewriter'] .sr-only")?.textContent).toBe(EMPTY_LINE);
  });

  it("line={false} renders no line", () => {
    render(<EmptyState title="Keine Treffer" line={false} />);
    expect(document.querySelector("[data-pulse='typewriter']")).toBeNull();
  });
});
