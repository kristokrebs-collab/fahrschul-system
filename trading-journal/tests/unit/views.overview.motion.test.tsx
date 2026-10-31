import { act, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import type { MotionValue } from "motion/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { fakeMarket } = await import("./views.overview.harness");
  return { ...actual, ...fakeMarket(actual).overrides };
});

import type { Trade } from "@/domain/types";
import { tradeTime } from "@/lib/dates";
import { resetInViewObserverForTests } from "@/motion/inView";
import { MotionRoot } from "@/motion/MotionRoot";
import { stagger } from "@/motion/tokens";
import { Button } from "@/primitives/Button";
import { EmptyState } from "@/primitives/EmptyState";
import { breathingFrames, EMPTY_GLYPH, EMPTY_GLYPH_FRAMES } from "@/primitives/emptyGlyph";
import { crossing, RingGauge } from "@/primitives/RingGauge";
import { useRevealValue, useSeenOnce } from "@/primitives/revealValue";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { barDelay, isFreshInsert, rankRollDirection, RECENT_COUNT, RecentTrades } from "@/views/overview";

type Entry = { target: Element; isIntersecting: boolean };

/** Records every observer (the shared one and motion's own) so a test can put elements in / out of view. */
class FakeIO {
  static instances: FakeIO[] = [];
  observed = new Set<Element>();
  constructor(public cb: (entries: Entry[]) => void) {
    FakeIO.instances.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
  takeRecords() {
    return [];
  }
}

/** Reports every observed element as (not) intersecting. */
function emitAll(isIntersecting: boolean) {
  act(() => {
    for (const io of [...FakeIO.instances]) for (const target of [...io.observed]) io.cb([{ target, isIntersecting }]);
  });
}

function useFakeIO() {
  beforeEach(() => {
    FakeIO.instances = [];
    vi.stubGlobal("IntersectionObserver", FakeIO);
    resetInViewObserverForTests();
  });
  afterEach(() => {
    resetInViewObserverForTests();
    vi.unstubAllGlobals();
  });
}

describe("overview motion – pure helpers", () => {
  it("crossing() reports the direction the drawn arc passed the marker", () => {
    expect(crossing(0.4, 0.6, 0.5)).toBe(1);
    expect(crossing(0.4, 0.5, 0.5)).toBe(1);
    expect(crossing(0.6, 0.4, 0.5)).toBe(-1);
    expect(crossing(0.2, 0.3, 0.5)).toBe(0);
    expect(crossing(0.6, 0.7, 0.5)).toBe(0);
    expect(crossing(0.4, 0.6, null)).toBe(0);
    expect(crossing(Number.NaN, 0.6, 0.5)).toBe(0);
  });

  it("breathingFrames() keeps the glyph's shape and breathes every lit dot between the floor and 1", () => {
    const frames = breathingFrames(EMPTY_GLYPH, 24, 0.22);
    expect(frames).toHaveLength(24);
    expect(EMPTY_GLYPH_FRAMES).toHaveLength(24);
    for (const f of frames) {
      expect(f).toHaveLength(7);
      f.forEach((row, r) => {
        expect(row).toHaveLength(7);
        row.forEach((v, c) => {
          if (EMPTY_GLYPH[r]?.[c]) {
            expect(v).toBeGreaterThanOrEqual(0.22);
            expect(v).toBeLessThanOrEqual(1);
          } else expect(v).toBe(0);
        });
      });
    }
    // every lit dot peaks and dims within one loop, and neighbours along the wave are out of phase
    const peak = (r: number, c: number) => Math.max(...frames.map((f) => f[r]?.[c] ?? 0));
    const low = (r: number, c: number) => Math.min(...frames.map((f) => f[r]?.[c] ?? 1));
    expect(peak(0, 2)).toBeGreaterThan(0.95);
    expect(low(0, 2)).toBeLessThan(0.3);
    expect(frames[0]?.[0]?.[2]).not.toBeCloseTo(frames[0]?.[6]?.[4] ?? 0, 2);
  });

  it("isFreshInsert() marks inserts but not a row that slid up into a full list's last slot", () => {
    expect(isFreshInsert(0, RECENT_COUNT)).toBe(true);
    expect(isFreshInsert(3, RECENT_COUNT)).toBe(true);
    expect(isFreshInsert(RECENT_COUNT - 1, RECENT_COUNT)).toBe(false);
    expect(isFreshInsert(2, 3)).toBe(true);
  });

  it("rankRollDirection() rolls a climbing row down (smaller number from above)", () => {
    expect(rankRollDirection(3, 1)).toBe("down");
    expect(rankRollDirection(1, 3)).toBe("up");
  });

  it("barDelay() leads by one beat and caps the stagger", () => {
    expect(barDelay(0)).toBe(stagger.lead);
    expect(barDelay(2)).toBeCloseTo(stagger.lead + 2 * stagger.reveal);
    expect(barDelay(500)).toBeCloseTo(stagger.lead + stagger.max * stagger.reveal);
  });
});

describe("useRevealValue / useSeenOnce", () => {
  useFakeIO();

  function Probe({ target, onMv, onReveal }: { target: number; onMv: (mv: MotionValue<number>) => void; onReveal?: () => void }) {
    const ref = useRef<HTMLSpanElement>(null);
    const mv = useRevealValue(ref, target, { transition: { duration: 0.03 }, onReveal });
    onMv(mv);
    return <span ref={ref} />;
  }

  it("rests at 0 until first in view, then animates to the target (once) and follows later changes", async () => {
    let mv: MotionValue<number> | null = null;
    const onReveal = vi.fn();
    const { rerender } = render(<Probe target={0.8} onMv={(m) => (mv = m)} onReveal={onReveal} />);
    expect(mv!.get()).toBe(0);
    emitAll(false);
    expect(mv!.get()).toBe(0);
    emitAll(true);
    expect(onReveal).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mv!.get()).toBeCloseTo(0.8, 3));
    emitAll(false);
    emitAll(true);
    expect(onReveal).toHaveBeenCalledTimes(1);
    rerender(<Probe target={0.3} onMv={(m) => (mv = m)} onReveal={onReveal} />);
    await waitFor(() => expect(mv!.get()).toBeCloseTo(0.3, 3));
  });

  it("starts at the target without an IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    let mv: MotionValue<number> | null = null;
    render(<Probe target={0.42} onMv={(m) => (mv = m)} />);
    expect(mv!.get()).toBe(0.42);
  });

  it("useSeenOnce flips once when the element is first in view", () => {
    const seen: boolean[] = [];
    function SeenProbe() {
      const ref = useRef<HTMLDivElement>(null);
      seen.push(useSeenOnce(ref));
      return <div ref={ref} />;
    }
    render(<SeenProbe />);
    expect(seen.at(-1)).toBe(false);
    emitAll(true);
    expect(seen.at(-1)).toBe(true);
  });
});

describe("RingGauge", () => {
  useFakeIO();

  it("pops the needle and draws the arc only once in view, turning the pass colour past the marker", async () => {
    const { container } = render(
      <MotionRoot>
        <RingGauge value={0.7} marker={0.5} color="#f2f2f2" passColor="#3ddc84" aria-label="Win-Rate 70 %" />
      </MotionRoot>,
    );
    expect(screen.getByRole("img", { name: "Win-Rate 70 %" })).toBeInTheDocument();
    const arcs = container.querySelectorAll("svg circle");
    const passArc = arcs[2] as SVGCircleElement;
    expect(passArc.getAttribute("stroke")).toBe("#3ddc84");
    expect(passArc.style.opacity).toBe("0");
    emitAll(true);
    await waitFor(() => expect(passArc.style.opacity).toBe("1"), { timeout: 3000 });
  });
});

describe("EmptyState", () => {
  useFakeIO();

  it("renders the texts once, a breathing glyph, and shines the CTA once it is seen", () => {
    const { container } = render(
      <MotionRoot>
        <EmptyState title="Noch keine Trades" text="Trag deinen ersten Trade ein." action={<Button variant="primary">Ersten Trade eintragen</Button>} />
      </MotionRoot>,
    );
    expect(screen.getAllByText("Noch keine Trades")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Ersten Trade eintragen" })).toBeInTheDocument();
    expect(container.querySelector('[data-matrix="frames"]')).toHaveAttribute("aria-hidden", "true");
    const shine = screen.getByRole("button", { name: "Ersten Trade eintragen" }).parentElement as HTMLElement;
    const ants = container.querySelector(".fx-ants") as HTMLElement;
    expect(shine).not.toHaveAttribute("data-shine");
    emitAll(false);
    expect(ants).toHaveAttribute("data-idle");
    emitAll(true);
    expect(shine).toHaveAttribute("data-shine");
    expect(ants).not.toHaveAttribute("data-idle");
  });
});

describe("RecentTrades animated list", () => {
  beforeAll(() => installDomPolyfills());
  useFakeIO();
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  const rowButtons = () => screen.getAllByRole("button").filter((b) => /Long|Short/.test(b.textContent ?? ""));

  function newestTrade(): Trade {
    const trades = useJournal.getState().trades;
    return [...trades].sort((a, b) => +tradeTime(b) - +tradeTime(a))[0] as Trade;
  }

  it("sweeps only a newly inserted trade, keeps the accessible row count and hides the leaving row", async () => {
    const { container } = render(
      <MotionRoot>
        <RecentTrades />
      </MotionRoot>,
    );
    const before = rowButtons().length;
    emitAll(true);
    expect(container.querySelectorAll('[data-fx="fresh"]')).toHaveLength(0);
    const base = newestTrade();
    const fresh: Trade = { ...base, id: "t-fresh", date: "2099-01-01T10:00", createdAt: "2099-01-01T10:00:00.000Z", updatedAt: "2099-01-01T10:00:00.000Z" };
    await act(async () => {
      useJournal.getState().applySnapshot({ trades: [...useJournal.getState().trades, fresh] });
    });
    expect(rowButtons()).toHaveLength(Math.min(RECENT_COUNT, before + 1));
    const sweeps = container.querySelectorAll('[data-fx="fresh"]');
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]?.parentElement?.querySelector("button")?.textContent).toContain("01.01.99");
    if (before === RECENT_COUNT) {
      const leaving = container.querySelectorAll("[data-exiting]");
      expect(leaving).toHaveLength(1);
      expect(leaving[0]).toHaveAttribute("aria-hidden", "true");
      expect(leaving[0]).toHaveAttribute("inert");
    }
  });

  it("swaps the list without sweeps when the account changes", async () => {
    const { container } = render(
      <MotionRoot>
        <RecentTrades />
      </MotionRoot>,
    );
    emitAll(true);
    await act(async () => {
      useUi.getState().setAcc("makro");
    });
    expect(container.querySelectorAll('[data-fx="fresh"]')).toHaveLength(0);
    expect(container.querySelectorAll("[data-exiting]")).toHaveLength(0);
  });

  it("holds the highlight of an insert made before the card was ever seen until it is", async () => {
    const { container } = render(
      <MotionRoot>
        <RecentTrades />
      </MotionRoot>,
    );
    const base = newestTrade();
    const fresh: Trade = { ...base, id: "t-unseen", date: "2099-02-01T10:00", createdAt: "2099-02-01T10:00:00.000Z", updatedAt: "2099-02-01T10:00:00.000Z" };
    await act(async () => {
      useJournal.getState().applySnapshot({ trades: [...useJournal.getState().trades, fresh] });
    });
    expect(container.querySelectorAll('[data-fx="fresh"]')).toHaveLength(0);
    emitAll(true);
    expect(container.querySelectorAll('[data-fx="fresh"]')).toHaveLength(1);
  });

  it("drops the very first trade in (with the sweep) after the empty state", async () => {
    const all = useJournal.getState().trades;
    await act(async () => {
      useJournal.getState().applySnapshot({ trades: [] });
    });
    const { container } = render(
      <MotionRoot>
        <RecentTrades />
      </MotionRoot>,
    );
    expect(screen.getByText("Noch keine Trades")).toBeInTheDocument();
    emitAll(true);
    await act(async () => {
      useJournal.getState().applySnapshot({ trades: [all[0] as Trade] });
    });
    expect(rowButtons()).toHaveLength(1);
    expect(container.querySelectorAll('[data-fx="fresh"]')).toHaveLength(1);
  });
});
