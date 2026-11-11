import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reducedState = vi.hoisted(() => ({ value: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => reducedState.value }));

import { CONFIG, TextMorph, morphLayer } from "@/motion/pulse/TextMorph";

const words = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(':scope > span[aria-hidden="true"]')).map((s) => s.textContent);

describe("morphLayer (measured curve)", () => {
  it("blur = 8/f - 8 (cap 100), opacity = f^0.4", () => {
    expect(morphLayer(0)).toEqual({ blur: 100, opacity: 0 });
    expect(morphLayer(0.5).blur).toBeCloseTo(8, 6);
    expect(morphLayer(0.5).opacity).toBeCloseTo(Math.pow(0.5, 0.4), 6);
    expect(morphLayer(0.05).blur).toBe(100);
    expect(morphLayer(1)).toEqual({ blur: 0, opacity: 1 });
  });
});

describe("<TextMorph>", () => {
  beforeEach(() => {
    reducedState.value = false;
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => vi.useRealTimers());

  it("morphs between controlled texts through the threshold filter, then rests", () => {
    const onEnd = vi.fn();
    const { container, rerender } = render(<TextMorph text="LIVE" onMorphEnd={onEnd} />);
    const root = container.querySelector('[data-pulse="text-morph"]') as HTMLElement;
    expect(words(root)).toEqual(["LIVE", ""]);
    const filterId = root.querySelector("filter")!.id;
    expect(filterId).toMatch(/^pulse-tm-[\w-]+$/);
    expect(root.querySelector("feColorMatrix")!.getAttribute("values")).toContain(`${CONFIG.thresholdK} ${CONFIG.thresholdB}`);

    rerender(<TextMorph text="VERZÖGERT" onMorphEnd={onEnd} />);
    expect(root.hasAttribute("data-morphing")).toBe(true);
    expect(root.style.filter).toContain(filterId);
    expect(words(root).sort()).toEqual(["LIVE", "VERZÖGERT"]);
    act(() => void vi.advanceTimersByTime(500));
    expect(root.hasAttribute("data-morphing")).toBe(true);
    act(() => void vi.advanceTimersByTime(600));
    expect(root.hasAttribute("data-morphing")).toBe(false);
    expect(root.style.filter).toBe("");
    expect(words(root)).toContain("VERZÖGERT");
    expect(words(root)).not.toContain("LIVE");
    expect(onEnd).toHaveBeenCalledWith("VERZÖGERT");
    expect(root.querySelector(".sr-only")!.textContent).toBe("VERZÖGERT");
  });

  it("cycles words on hold 1000 + morph 1000", () => {
    const onEnd = vi.fn();
    const { container } = render(<TextMorph cycle={["A", "B", "C"]} onMorphEnd={onEnd} />);
    const root = container.querySelector('[data-pulse="text-morph"]') as HTMLElement;
    expect(words(root)).toContain("A");
    act(() => void vi.advanceTimersByTime(CONFIG.holdMs + CONFIG.morphMs + 50));
    expect(onEnd).toHaveBeenLastCalledWith("B");
    act(() => void vi.advanceTimersByTime(CONFIG.holdMs + CONFIG.morphMs + 50));
    expect(onEnd).toHaveBeenLastCalledWith("C");
    expect(root.querySelector(".sr-only")!.textContent).toBe("C");
  });

  it("reduced motion: hard swap, no filter", () => {
    reducedState.value = true;
    const { container, rerender } = render(<TextMorph text="LIVE" />);
    const root = container.querySelector('[data-pulse="text-morph"]') as HTMLElement;
    rerender(<TextMorph text="OFFLINE" />);
    expect(root.hasAttribute("data-morphing")).toBe(false);
    expect(root.style.filter).toBe("");
    expect(words(root)).toContain("OFFLINE");
    expect(words(root)).not.toContain("LIVE");
  });
});
