import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canObserveInView, observeInView, observeReveal, resetInViewObserverForTests, REVEAL_AMOUNT, REVEAL_SCREEN_SHARE, revealReached } from "@/motion/inView";

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
  emit(target: Element, isIntersecting: boolean) {
    this.cb([{ target, isIntersecting }]);
  }
}

describe("observeInView (shared IntersectionObserver)", () => {
  beforeEach(() => {
    FakeIO.instances = [];
    vi.stubGlobal("IntersectionObserver", FakeIO);
    resetInViewObserverForTests();
  });
  afterEach(() => {
    resetInViewObserverForTests();
    vi.unstubAllGlobals();
  });

  it("uses ONE observer for every element and routes entries to the element's listeners", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const onA = vi.fn();
    const onB = vi.fn();
    const offA = observeInView(a, onA);
    observeInView(b, onB);
    expect(FakeIO.instances).toHaveLength(1);
    const io = FakeIO.instances[0] as FakeIO;
    expect(io.observed.size).toBe(2);
    io.emit(a, true);
    expect(onA).toHaveBeenCalledWith(true);
    expect(onB).not.toHaveBeenCalled();
    offA();
    expect(io.observed.has(a)).toBe(false);
    io.emit(a, false);
    expect(onA).toHaveBeenCalledTimes(1);
  });

  it("keeps observing until the last listener of an element leaves", () => {
    const el = document.createElement("div");
    const off1 = observeInView(el, () => {});
    const off2 = observeInView(el, () => {});
    const io = FakeIO.instances[0] as FakeIO;
    off1();
    expect(io.observed.has(el)).toBe(true);
    off2();
    expect(io.observed.has(el)).toBe(false);
  });

  it("is a no-op without IntersectionObserver", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("IntersectionObserver", undefined);
    expect(canObserveInView()).toBe(false);
    const off = observeInView(document.createElement("div"), () => {});
    expect(() => off()).not.toThrow();
  });
});

describe("reveal trigger (revealReached / observeReveal)", () => {
  const ROOT = 744; // a 390 × 844 phone, viewport shrunk by 2 × 50 px

  it("fires at 15 % of an element that fits the screen, not before", () => {
    expect(revealReached(0.1, 80, ROOT)).toBe(false);
    expect(revealReached(REVEAL_AMOUNT, 120, ROOT)).toBe(true);
  });

  it("fires for an element too tall for 15 % ever to be on screen (a fifth of the screen is enough)", () => {
    // 6 000 px card: at most 744 px = 12.4 % can be visible – the old rule never revealed it
    expect(revealReached(0.12, 744, ROOT)).toBe(true);
    expect(revealReached(0.02, 120, ROOT)).toBe(false);
    expect(revealReached(0.03, ROOT * REVEAL_SCREEN_SHARE, ROOT)).toBe(true);
  });

  it("never fires without a viewport height and no ratio", () => {
    expect(revealReached(0.01, 500, 0)).toBe(false);
  });

  describe("observer", () => {
    interface RevealEntry {
      target: Element;
      isIntersecting: boolean;
      intersectionRatio: number;
      intersectionRect: { height: number };
      rootBounds: { height: number } | null;
    }
    class RevealIO {
      static last: RevealIO | null = null;
      observed = new Set<Element>();
      constructor(
        public cb: (entries: RevealEntry[]) => void,
        public init: IntersectionObserverInit,
      ) {
        RevealIO.last = this;
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
    }
    beforeEach(() => {
      RevealIO.last = null;
      vi.stubGlobal("IntersectionObserver", RevealIO);
      resetInViewObserverForTests();
    });
    afterEach(() => {
      resetInViewObserverForTests();
      vi.unstubAllGlobals();
    });
    const entry = (target: Element, ratio: number, h: number): RevealEntry => ({ target, isIntersecting: true, intersectionRatio: ratio, intersectionRect: { height: h }, rootBounds: { height: ROOT } });

    it("watches with the 50 px margin, fires once and lets go of the element", () => {
      const el = document.createElement("div");
      const onReach = vi.fn();
      observeReveal(el, onReach);
      const io = RevealIO.last as RevealIO;
      expect(io.init.rootMargin).toBe("-50px");
      expect(io.observed.has(el)).toBe(true);
      io.cb([entry(el, 0.05, 40)]);
      expect(onReach).not.toHaveBeenCalled();
      io.cb([entry(el, 0.2, 200)]);
      expect(onReach).toHaveBeenCalledTimes(1);
      expect(io.observed.has(el)).toBe(false);
      io.cb([entry(el, 0.3, 300)]);
      expect(onReach).toHaveBeenCalledTimes(1);
    });

    it("reveals a tall element by the screen share", () => {
      const el = document.createElement("div");
      const onReach = vi.fn();
      observeReveal(el, onReach);
      (RevealIO.last as RevealIO).cb([entry(el, 0.05, 300)]);
      expect(onReach).toHaveBeenCalledTimes(1);
    });

    it("the cancel stops watching", () => {
      const el = document.createElement("div");
      const onReach = vi.fn();
      const off = observeReveal(el, onReach);
      const io = RevealIO.last as RevealIO;
      off();
      expect(io.observed.has(el)).toBe(false);
      io.cb([entry(el, 1, 500)]);
      expect(onReach).not.toHaveBeenCalled();
    });
  });
});
