import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reducedState = vi.hoisted(() => ({ value: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => reducedState.value }));

import { TactileHighlight, highlightAt, highlightOutAt } from "@/motion/pulse/TactileHighlight";

const parts = (container: HTMLElement) => {
  const root = container.querySelector('[data-pulse="tactile-highlight"]') as HTMLElement;
  const [tab, bar, , lit] = Array.from(root.children) as HTMLElement[];
  return { root, tab: tab!, bar: bar!, lit: lit! };
};

describe("highlightAt (measured)", () => {
  it("tab pops .72 → 1 in 15 ms, holds 30 ms, retracts ease-in by 87 ms", () => {
    expect(highlightAt(0).tab).toBeCloseTo(0.72, 6);
    expect(highlightAt(30).tab).toBe(1);
    expect(highlightAt(45 + 21).tab).toBeCloseTo(0.75, 6);
    expect(highlightAt(88).tab).toBe(0);
  });
  it("wipe p = 1 - e^(-(t-90)/150): 19 % @33, 58 % @125 ms after the delay", () => {
    expect(highlightAt(90).p).toBe(0);
    expect(highlightAt(90 + 33).p).toBeCloseTo(0.1975, 3);
    expect(highlightAt(90 + 125).p).toBeCloseTo(0.5654, 3);
    expect(highlightAt(90 + 360).p).toBeCloseTo(0.9093, 3);
    expect(highlightAt(1300)).toEqual({ tab: 0, p: 1, done: true });
  });
  it("wipe-out decays with the same constant", () => {
    expect(highlightOutAt(150, 1).p).toBeCloseTo(Math.exp(-1), 6);
    expect(highlightOutAt(5000, 1)).toEqual({ p: 0, done: true });
  });
});

describe("<TactileHighlight>", () => {
  beforeEach(() => {
    reducedState.value = false;
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => vi.useRealTimers());

  it("static by default: bar on, duplicate fully revealed, real text readable once", () => {
    const { container, getAllByText } = render(
      <p>
        Fazit: <TactileHighlight>Long</TactileHighlight>
      </p>,
    );
    const { bar, lit, tab } = parts(container);
    expect(bar.style.transform).toBe("scale(1.0000,1)");
    expect(lit.style.clipPath).toBe("inset(0 0.000% 0 0)");
    expect(lit.getAttribute("aria-hidden")).toBe("true");
    expect(tab.getAttribute("aria-hidden")).toBe("true");
    expect(getAllByText("Long")).toHaveLength(2);
  });

  it("active: wipes in (tab first), reveals the duplicate with the bar, wipes out on false", () => {
    const onDone = vi.fn();
    const { container, rerender } = render(<TactileHighlight active={false} onDone={onDone}>Long</TactileHighlight>);
    const { bar, lit, tab } = parts(container);
    expect(bar.style.transform).toBe("scale(0.0000,1)");
    rerender(<TactileHighlight active onDone={onDone}>Long</TactileHighlight>);
    act(() => void vi.advanceTimersByTime(32));
    expect(tab.style.opacity).toBe("1");
    act(() => void vi.advanceTimersByTime(200));
    expect(tab.style.opacity).toBe("0");
    const scale = parseFloat(bar.style.transform.slice(8));
    expect(scale).toBeGreaterThan(0.3);
    expect(scale).toBeLessThan(0.9);
    const clipRight = parseFloat(lit.style.clipPath.split(" ")[1]!);
    expect(clipRight).toBeCloseTo((1 - scale) * 100, 1);
    act(() => void vi.advanceTimersByTime(1200));
    expect(bar.style.transform).toBe("scale(1.0000,1)");
    expect(onDone).toHaveBeenCalledTimes(1);
    rerender(<TactileHighlight active={false} onDone={onDone}>Long</TactileHighlight>);
    act(() => void vi.advanceTimersByTime(1500));
    expect(bar.style.transform).toBe("scale(0.0000,1)");
  });

  it("playOnView: plays once (jsdom has no IntersectionObserver → plays on mount)", () => {
    const onDone = vi.fn();
    const { container } = render(<TactileHighlight playOnView onDone={onDone}>Long</TactileHighlight>);
    act(() => void vi.advanceTimersByTime(1500));
    expect(parts(container).bar.style.transform).toBe("scale(1.0000,1)");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reduced motion: final marker immediately", () => {
    reducedState.value = true;
    const onDone = vi.fn();
    const { container } = render(<TactileHighlight playOnView onDone={onDone} tone="signal">Long</TactileHighlight>);
    expect(parts(container).bar.style.transform).toBe("scale(1.0000,1)");
    expect(parts(container).root.dataset.tone).toBe("signal");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("tab={false} renders no tab and still wipes; padX sets the bar and copy padding", () => {
    const { container } = render(
      <TactileHighlight active tab={false} padX={0}>
        Long
      </TactileHighlight>,
    );
    const root = container.querySelector('[data-pulse="tactile-highlight"]') as HTMLElement;
    expect(root.querySelectorAll("i")).toHaveLength(1);
    expect(root.style.padding).toBe("0px 0em");
    act(() => void vi.advanceTimersByTime(1500));
    expect((root.querySelector("i") as HTMLElement).style.transform).toBe("scale(1.0000,1)");
  });
});
