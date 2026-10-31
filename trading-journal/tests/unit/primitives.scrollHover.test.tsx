/**
 * Hover machinery under a page that scrolls beneath a resting pointer: no rect read per scroll event (each forced a
 * style + layout whenever the page was dirty) — the rect is dropped, re-read once the scroll gate settled.
 */
import { fireEvent, render } from "@testing-library/react";
import { frame } from "motion/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dwell } from "@/motion/tokens";
import { registerGlow } from "@/primitives/glowField";
import { HoverRectTracker } from "@/primitives/hoverRect";
import { Magnetic } from "@/primitives/Magnetic";
import { Tilt } from "@/primitives/Tilt";

const box = { left: 100, top: 100, width: 200, height: 100, right: 300, bottom: 200, x: 100, y: 100, toJSON: () => ({}) } as DOMRect;
const nextFrame = () => new Promise<void>((resolve) => frame.postRender(() => resolve()));
const scroll = () => window.dispatchEvent(new Event("scroll"));
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, dwell.scrollSettle * 1000 + 60));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HoverRectTracker while the page scrolls", () => {
  it("drops the rect per scroll event and calls back once the scroll settled (no read meanwhile)", async () => {
    const el = document.createElement("div");
    const read = vi.spyOn(el, "getBoundingClientRect").mockReturnValue(box);
    const onChange = vi.fn();
    const t = new HoverRectTracker();
    t.enter(el, onChange);
    expect(read).toHaveBeenCalledTimes(1);
    scroll();
    scroll();
    scroll();
    expect(onChange).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    // the callback re-reads lazily: one measure for the whole scroll
    t.read();
    t.read();
    expect(read).toHaveBeenCalledTimes(2);
    // a resize (no scroll) still calls back at once
    await settle();
    window.dispatchEvent(new Event("resize"));
    expect(onChange).toHaveBeenCalledTimes(2);
    t.leave();
  });

  it("forgets a pending scroll-end callback on leave", async () => {
    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(box);
    const onChange = vi.fn();
    const t = new HoverRectTracker();
    t.enter(el, onChange);
    scroll();
    t.leave();
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("pointerenter of an element scrolling under a resting pointer", () => {
  it.each([
    ["Magnetic", (child: ReactNode) => <Magnetic>{child}</Magnetic>],
    ["Tilt", (child: ReactNode) => <Tilt>{child}</Tilt>],
  ])("%s: no rect read while scrolling, the first real move measures", async (_name, wrap) => {
    const read = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(box);
    const { getByTestId } = render(wrap(<span data-testid="inner">x</span>));
    const host = getByTestId("inner").parentElement!;
    scroll();
    fireEvent.pointerEnter(host, { pointerType: "mouse", clientX: 150, clientY: 150 });
    expect(read).not.toHaveBeenCalled();
    await settle();
    fireEvent.pointerMove(host, { pointerType: "mouse", clientX: 160, clientY: 150 });
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("glowField: a card scrolling into view under a resting pointer", () => {
  it("is measured once the scroll settled, not in the scroll", async () => {
    // jsdom has no IntersectionObserver: a fake one the test drives (observeInView creates its shared observer lazily)
    let report: ((entries: { target: Element; isIntersecting: boolean }[]) => void) | null = null;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (entries: { target: Element; isIntersecting: boolean }[]) => void) {
          report = cb;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const el = document.createElement("div");
    document.body.appendChild(el);
    const read = vi.spyOn(el, "getBoundingClientRect").mockReturnValue(box);
    const listener = vi.fn();
    const off = registerGlow(el, listener);
    report!([{ target: el, isIntersecting: false }]);
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 60, pointerType: "mouse" }));
    await nextFrame();
    expect(read).not.toHaveBeenCalled();
    // the page scrolls; the card comes into view under the resting pointer
    scroll();
    report!([{ target: el, isIntersecting: true }]);
    await nextFrame();
    await nextFrame();
    expect(read).not.toHaveBeenCalled();
    await settle();
    await nextFrame();
    expect(read).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(true, expect.any(Number));
    off();
    el.remove();
  });
});
