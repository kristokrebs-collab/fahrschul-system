import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canObserveInView, observeInView, resetInViewObserverForTests } from "@/motion/inView";

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
