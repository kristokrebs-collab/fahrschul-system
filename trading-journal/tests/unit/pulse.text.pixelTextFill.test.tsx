import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reducedState = vi.hoisted(() => ({ value: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => reducedState.value }));

import { CONFIG, PixelTextFill, fillAt, scheduleFor, totalDuration } from "@/motion/pulse/PixelTextFill";

describe("scheduleFor (measured chain)", () => {
  it("uses the measured table for four lines (pre-roll removed)", () => {
    const s = scheduleFor(4);
    expect(s.map((l) => l.oStart)).toEqual([0, 1100, 2300, 3000]);
    expect(s.map((l) => l.oDur)).toEqual([1000, 950, 800, 800]);
    expect(s.map((l) => l.wStart)).toEqual([1100, 2300, 3000, 3800]);
    expect(s.map((l) => l.wDur)).toEqual([700, 600, 700, 550]);
    expect(totalDuration(s)).toBe(4350);
  });
  it("chains extra lines on the fourth line's rhythm (ember starts when the previous white starts)", () => {
    const s = scheduleFor(6);
    expect(s[4]).toEqual({ oStart: 3800, oDur: 800, wStart: 4600, wDur: 550 });
    expect(s[5]).toEqual({ oStart: 4600, oDur: 800, wStart: 5400, wDur: 550 });
  });
  it("one line = first measured line; speed scales every time", () => {
    expect(scheduleFor(1)).toEqual([{ oStart: 0, oDur: 1000, wStart: 1100, wDur: 700 }]);
    expect(scheduleFor(2, 2)[1]).toEqual({ oStart: 550, oDur: 475, wStart: 1150, wDur: 300 });
  });
});

describe("fillAt", () => {
  const line = { oStart: 0, oDur: 1000, wStart: 1100, wDur: 700 };
  it("ember accelerates (p^1.7), white is linear", () => {
    expect(fillAt(-10, line)).toEqual({ o: 0, w: 0 });
    expect(fillAt(500, line).o).toBeCloseTo(Math.pow(0.5, CONFIG.oPow), 6);
    expect(fillAt(1450, line).w).toBeCloseTo(0.5, 6);
    expect(fillAt(5000, line)).toEqual({ o: 1, w: 1 });
  });
});

describe("<PixelTextFill>", () => {
  beforeEach(() => {
    reducedState.value = false;
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the real lines as text and the effect copies aria-hidden", () => {
    const { container } = render(<PixelTextFill lines={["Disziplin", "schlägt Gefühl."]} />);
    const root = container.firstElementChild as HTMLElement;
    const bases = root.querySelectorAll("[data-ptf-base]");
    expect(Array.from(bases).map((b) => b.textContent)).toEqual(["Disziplin", "schlägt Gefühl."]);
    expect(root.querySelectorAll('[data-ptf-rev][aria-hidden="true"]')).toHaveLength(4);
  });

  it("runs the chain and ends filled, calling onDone once", () => {
    const onDone = vi.fn();
    const { container } = render(<PixelTextFill lines={["a", "b"]} onDone={onDone} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.state).toBe("running");
    act(() => void vi.advanceTimersByTime(totalDuration(scheduleFor(2)) - 100));
    expect(onDone).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(200));
    expect(root.dataset.state).toBe("filled");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("without a pending play it shows filled text (no grey flash)", () => {
    const { container } = render(<PixelTextFill lines={["a"]} playOnMount={false} />);
    expect((container.firstElementChild as HTMLElement).dataset.state).toBe("filled");
  });

  it("reduced motion: filled immediately, onDone called", () => {
    reducedState.value = true;
    const onDone = vi.fn();
    const { container } = render(<PixelTextFill lines={["a"]} onDone={onDone} />);
    expect((container.firstElementChild as HTMLElement).dataset.state).toBe("filled");
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
