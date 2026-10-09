/**
 * Hochrechnung milestone rail on scroll-driven animations (ScrollTimeline): one WAAPI animation per dot fill and stem
 * on the document's scroll timeline over the milestone's own scroll range — no scroll listener, no scrollY read.
 */
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { milestoneProgress, milestoneTrack, milestoneVisual, RAIL_SAMPLES, TIMELINE, useMilestoneRail } from "@/views/overview/projectionTimeline";

describe("milestoneTrack", () => {
  it("spans 74 % → 49 % of the viewport above the dot and samples the visual", () => {
    const t = milestoneTrack(2000, 1000)!;
    expect(t.start).toBe(2000 - TIMELINE.revealFrom * 1000);
    expect(t.end).toBe(2000 - TIMELINE.revealTo * 1000);
    expect(t.dot).toHaveLength(RAIL_SAMPLES + 1);
    expect(t.dot[0]).toEqual({ transform: "scale(0.0000)" });
    expect(t.dot.at(-1)).toEqual({ transform: "scale(1.0000)" });
    expect(t.stem.at(-1)).toEqual({ transform: "scaleY(1.0000)" });
    // every sample is the visual at that scroll offset
    for (let k = 0; k <= RAIL_SAMPLES; k++) {
      const s = t.start + ((t.end - t.start) * k) / RAIL_SAMPLES;
      const v = milestoneVisual(milestoneProgress(2000 - s, 1000));
      expect(t.dot[k]).toEqual({ transform: `scale(${v.dot.toFixed(4)})` });
      expect(t.stem[k]).toEqual({ transform: `scaleY(${v.stem.toFixed(4)})` });
    }
  });

  it("starts at scroll 0 for a dot near the top (with its progress there); null when complete at the top", () => {
    const t = milestoneTrack(600, 1000)!;
    expect(t.start).toBe(0);
    expect(t.end).toBeCloseTo(110);
    const v = milestoneVisual(milestoneProgress(600, 1000));
    expect(t.stem[0]).toEqual({ transform: `scaleY(${v.stem.toFixed(4)})` });
    expect(milestoneTrack(400, 1000)).toBeNull();
  });
});

describe("useMilestoneRail with ScrollTimeline", () => {
  const animate = vi.fn();
  const anims: { cancel: ReturnType<typeof vi.fn> }[] = [];
  class FakeScrollTimeline {
    constructor(public options: unknown) {}
  }
  const saved = {
    animate: Element.prototype.animate,
    offsetTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop")!,
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!,
  };

  beforeEach(() => {
    animate.mockReset();
    anims.length = 0;
    animate.mockImplementation(() => {
      const a = { cancel: vi.fn() };
      anims.push(a);
      return a;
    });
    (window as unknown as { ScrollTimeline: unknown }).ScrollTimeline = FakeScrollTimeline;
    Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
    // jsdom has no layout: offsets come from data attributes
    Object.defineProperty(HTMLElement.prototype, "offsetTop", { configurable: true, get(this: HTMLElement) { return Number(this.dataset.top ?? 0); } });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return Number(this.dataset.h ?? 0); } });
  });
  afterEach(() => {
    delete (window as unknown as { ScrollTimeline?: unknown }).ScrollTimeline;
    Element.prototype.animate = saved.animate;
    Object.defineProperty(HTMLElement.prototype, "offsetTop", saved.offsetTop);
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offsetHeight);
    vi.restoreAllMocks();
  });

  function Rail({ top = 1500 }: { top?: number }) {
    const list = useRef<HTMLDListElement>(null);
    useMilestoneRail(list, true, 3);
    return (
      <dl ref={list} data-top={top}>
        <span data-tl-rail="" />
        <span data-tl-stem="" />
        <span data-tl-stem="" />
        {[0, 1, 2].map((i) => (
          <span key={`d${i}`} data-tl-dot="">
            <span />
          </span>
        ))}
        {[0, 1, 2].map((i) => (
          <div key={`r${i}`} data-tl-row="" data-top={i * 40} data-h={40} />
        ))}
      </dl>
    );
  }

  it("animates every fill and stem on the document scroll timeline over its range, without a scroll listener", () => {
    const listen = vi.spyOn(window, "addEventListener");
    const scrollY = vi.spyOn(window, "scrollY", "get");
    const { unmount } = render(<Rail />);
    expect(listen.mock.calls.some(([type]) => type === "scroll")).toBe(false);
    expect(scrollY).not.toHaveBeenCalled();
    // 3 fills + 2 stems
    expect(animate).toHaveBeenCalledTimes(5);
    const vh = window.innerHeight;
    const fills = animate.mock.calls.filter(([frames]) => String(frames[0].transform).startsWith("scale("));
    expect(fills).toHaveLength(3);
    fills.forEach(([frames, opts], i) => {
      const t = milestoneTrack(1500 + i * 40 + 20, vh)!;
      expect(frames).toEqual(t.dot);
      expect(opts).toMatchObject({ rangeStart: `${t.start.toFixed(1)}px`, rangeEnd: `${t.end.toFixed(1)}px`, fill: "both" });
      expect(opts.timeline).toBeInstanceOf(FakeScrollTimeline);
    });
    unmount();
    expect(anims.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
  });

  it("rebuilds only when the geometry changed", () => {
    const { container } = render(<Rail />);
    expect(animate).toHaveBeenCalledTimes(5);
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(animate).toHaveBeenCalledTimes(5);
    (container.querySelector("dl") as HTMLElement).dataset.top = "1700";
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(animate).toHaveBeenCalledTimes(10);
    expect(anims.slice(0, 5).every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
  });
});
