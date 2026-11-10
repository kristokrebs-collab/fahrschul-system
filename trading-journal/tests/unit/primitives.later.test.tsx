import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Later, LATER_LAND_FROM, LATER_SCROLL_QUIET_MS, resetLaterForTests } from "@/primitives/Later";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

class FakeIO {
  static last: FakeIO | null = null;
  observed = new Set<Element>();
  constructor(
    public cb: (entries: { target: Element; isIntersecting: boolean }[]) => void,
    public init?: IntersectionObserverInit,
  ) {
    FakeIO.last = this;
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
  show(el: Element) {
    act(() => this.cb([{ target: el, isIntersecting: true }]));
  }
}

/** A manual idle scheduler: `runIdle()` runs the oldest pending callback. */
let idle: (() => void)[] = [];
const runIdle = () => act(() => idle.shift()?.());

describe("Later", () => {
  beforeEach(() => {
    idle = [];
    FakeIO.last = null;
    vi.stubGlobal("IntersectionObserver", FakeIO);
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => idle.push(cb));
    vi.stubGlobal("cancelIdleCallback", () => undefined);
    resetLaterForTests();
  });
  afterEach(() => {
    resetLaterForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders the children at once without IntersectionObserver / requestIdleCallback (jsdom, SSR)", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("IntersectionObserver", undefined);
    render(
      <Later>
        <p>Karte</p>
      </Later>,
    );
    expect(screen.getByText("Karte")).toBeInTheDocument();
  });

  it("`now` mounts at once", () => {
    render(
      <Later now>
        <p>Karte</p>
      </Later>,
    );
    expect(screen.getByText("Karte")).toBeInTheDocument();
  });

  it("shows the fallback first, then mounts one card per idle slice in page order", () => {
    render(
      <>
        <Later fallback={<i>f1</i>}>
          <p>eins</p>
        </Later>
        <Later fallback={<i>f2</i>}>
          <p>zwei</p>
        </Later>
        <Later fallback={<i>f3</i>}>
          <p>drei</p>
        </Later>
      </>,
    );
    expect(screen.getByText("f1")).toBeInTheDocument();
    expect(screen.queryByText("eins")).toBeNull();
    runIdle();
    expect(screen.getByText("eins")).toBeInTheDocument();
    expect(screen.queryByText("zwei")).toBeNull();
    runIdle();
    expect(screen.getByText("zwei")).toBeInTheDocument();
    expect(screen.queryByText("drei")).toBeNull();
    runIdle();
    expect(screen.getByText("drei")).toBeInTheDocument();
    expect(idle).toHaveLength(0);
  });

  it("a card that comes near the viewport mounts at once, ahead of the queue", () => {
    render(
      <>
        <Later fallback={<i>f1</i>}>
          <p>eins</p>
        </Later>
        <Later fallback={<i>f2</i>}>
          <p>zwei</p>
        </Later>
      </>,
    );
    const second = screen.getByText("f2").parentElement as HTMLElement;
    expect(FakeIO.last?.init?.rootMargin).toMatch(/^\d+px 0px$/);
    FakeIO.last?.show(second);
    expect(screen.getByText("zwei")).toBeInTheDocument();
    expect(screen.queryByText("eins")).toBeNull();
    runIdle();
    expect(screen.getByText("eins")).toBeInTheDocument();
  });

  it("waits while the page scrolls", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    render(
      <Later fallback={<i>f1</i>}>
        <p>eins</p>
      </Later>,
    );
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    runIdle();
    expect(screen.queryByText("eins")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(LATER_SCROLL_QUIET_MS + 5);
    });
    runIdle();
    expect(screen.getByText("eins")).toBeInTheDocument();
  });

  it("leaves the queue when it unmounts first", () => {
    const { unmount } = render(
      <Later fallback={<i>f1</i>}>
        <p>eins</p>
      </Later>,
    );
    unmount();
    expect(() => runIdle()).not.toThrow();
  });

  describe("the landing (Runde 13): the cell brightens in once instead of a hard cut", () => {
    /** A cell with a recording `animate` (jsdom has no WAAPI). */
    function cellWith(opacity: string) {
      const calls: { frames: Keyframe[]; timing: KeyframeAnimationOptions }[] = [];
      const cell = document.createElement("div");
      cell.style.opacity = opacity;
      (cell as unknown as { animate: unknown }).animate = (frames: Keyframe[], timing: KeyframeAnimationOptions) => {
        calls.push({ frames, timing });
        return { cancel: () => undefined, play: () => undefined, currentTime: 0 };
      };
      document.body.appendChild(cell);
      return { cell, calls };
    }
    afterEach(() => {
      fx.reduced = false;
      document.body.innerHTML = "";
    });

    it("a deferred card: one opacity run on its cell when it lands – from LATER_LAND_FROM to 1, nothing else animated", () => {
      const { cell, calls } = cellWith("1");
      render(
        <Later fallback={<i>f</i>}>
          <p>Karte</p>
        </Later>,
        { container: cell },
      );
      expect(calls).toHaveLength(0);
      runIdle();
      expect(screen.getByText("Karte")).toBeInTheDocument();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.frames).toEqual([{ opacity: LATER_LAND_FROM }, { opacity: 1 }]);
      expect(Number(calls[0]!.timing.duration)).toBeLessThanOrEqual(250);
      expect(LATER_LAND_FROM).toBeGreaterThan(0); // never a blink through zero: the cell keeps its shape
    });

    it("no run under reduced motion, for a card that mounts at once, or in a cell its own reveal still hides", () => {
      fx.reduced = true;
      const a = cellWith("1");
      render(<Later fallback={<i>f</i>}><p>eins</p></Later>, { container: a.cell });
      runIdle();
      expect(screen.getByText("eins")).toBeInTheDocument();
      expect(a.calls).toHaveLength(0);

      fx.reduced = false;
      const b = cellWith("1");
      render(<Later now><p>zwei</p></Later>, { container: b.cell });
      expect(b.calls).toHaveLength(0);

      const c = cellWith("0");
      render(<Later fallback={<i>f</i>}><p>drei</p></Later>, { container: c.cell });
      runIdle();
      expect(screen.getByText("drei")).toBeInTheDocument();
      expect(c.calls).toHaveLength(0);
    });
  });
});
