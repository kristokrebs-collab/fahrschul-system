import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntroCell } from "@/intro/IntroCell";
import { getIntroPhase, IntroLandContext, setIntroPhase, useIntroFlown, useIntroGate, useIntroLanded } from "@/intro/introStore";
import { resetInViewObserverForTests, useFirstInView } from "@/motion/inView";
import { SplitText } from "@/primitives/SplitText";

type Entry = { target: Element; isIntersecting: boolean };
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
  emitAll(isIntersecting: boolean) {
    this.cb(Array.from(this.observed, (target) => ({ target, isIntersecting })));
  }
}

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useFirstInView(ref);
  const gate = useIntroGate();
  return (
    <div ref={ref} data-testid="probe" data-seen={String(seen)} data-gate={String(gate)} data-landed={String(useIntroLanded())} data-flown={String(useIntroFlown())} />
  );
}

const io = () => FakeIO.instances[0];

describe("first-view gating by the intro", () => {
  beforeEach(() => {
    FakeIO.instances = [];
    vi.stubGlobal("IntersectionObserver", FakeIO);
    resetInViewObserverForTests();
    setIntroPhase("off");
  });
  afterEach(() => {
    act(() => setIntroPhase("off"));
    resetInViewObserverForTests();
    vi.unstubAllGlobals();
  });

  it("phase off: unchanged – observes at once and flips on first view", () => {
    render(<Probe />);
    const el = screen.getByTestId("probe");
    expect(el.dataset.gate).toBe("true");
    expect(io()?.observed.has(el)).toBe(true);
    act(() => io()!.emitAll(true));
    expect(el.dataset.seen).toBe("true");
  });

  it("does not observe while the stage covers the app; starts when the build begins", () => {
    act(() => setIntroPhase("stage"));
    render(<Probe />);
    const el = screen.getByTestId("probe");
    expect(el.dataset.gate).toBe("false");
    expect(io()?.observed.has(el) ?? false).toBe(false);
    act(() => setIntroPhase("build"));
    expect(io()!.observed.has(el)).toBe(true);
    act(() => io()!.emitAll(true));
    expect(el.dataset.seen).toBe("true");
  });

  it("waits for the surrounding cell to land", () => {
    const { rerender } = render(
      <IntroLandContext.Provider value={false}>
        <Probe />
      </IntroLandContext.Provider>,
    );
    const el = screen.getByTestId("probe");
    expect(el.dataset.gate).toBe("false");
    expect(io()?.observed.has(el) ?? false).toBe(false);
    rerender(
      <IntroLandContext.Provider value={true}>
        <Probe />
      </IntroLandContext.Provider>,
    );
    expect(io()!.observed.has(el)).toBe(true);
  });

  it("IntroCell: landed and never flown without an intro; not landed during the stage", () => {
    render(
      <IntroCell className="lg:col-span-12">
        <Probe />
      </IntroCell>,
    );
    const el = screen.getByTestId("probe");
    expect(el.parentElement).toHaveAttribute("data-intro-cell");
    expect(el.parentElement).toHaveClass("lg:col-span-12");
    expect(el.dataset.landed).toBe("true");
    expect(el.dataset.flown).toBe("false");
    act(() => setIntroPhase("stage"));
    expect(el.dataset.landed).toBe("false");
    act(() => setIntroPhase("done"));
    expect(el.dataset.landed).toBe("true");
  });
});

describe("SplitText and the intro", () => {
  afterEach(() => act(() => setIntroPhase("off")));

  it("renders static without an intro and never touches the session flag", () => {
    sessionStorage.clear();
    const { container } = render(<SplitText text="Trade Journal" />);
    expect(screen.getByText("Trade Journal")).toHaveClass("sr-only");
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength("Trade Journal".length);
    expect(sessionStorage.getItem("tj2-intro")).toBeNull();
    expect(getIntroPhase()).toBe("off");
  });

  it("holds its letters during the stage and reveals them on build (shimmer only while playing)", () => {
    act(() => setIntroPhase("stage"));
    const { container } = render(<SplitText text="TJ" />);
    const letter = () => container.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(letter().style.opacity).toBe("0");
    expect(container.querySelector(".bg-\\[linear-gradient\\(90deg\\,transparent_40\\%\\,rgb\\(255_255_255\\/0\\.3\\)_50\\%\\,transparent_60\\%\\)\\]")).toBeNull();
    act(() => setIntroPhase("build"));
    expect(container.querySelectorAll('span[aria-hidden="true"]').length).toBe(3); // 2 letters + shimmer band
    act(() => setIntroPhase("done"));
    expect(container.querySelectorAll('span[aria-hidden="true"]').length).toBe(2);
  });
});
