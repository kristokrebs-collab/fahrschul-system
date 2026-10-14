import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reducedState = vi.hoisted(() => ({ value: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => reducedState.value }));

import { Typewriter, typedCount } from "@/motion/pulse/Typewriter";

const typed = (root: HTMLElement) => (root.children[root.children.length - 1] as HTMLElement).firstChild?.nodeValue ?? "";

describe("typedCount", () => {
  it("is floor(elapsed / 65) + 1, clamped", () => {
    expect(typedCount(-1, 10)).toBe(0);
    expect(typedCount(0, 10)).toBe(1);
    expect(typedCount(64, 10)).toBe(1);
    expect(typedCount(65, 10)).toBe(2);
    expect(typedCount(65 * 30, 31)).toBe(31);
    expect(typedCount(99999, 31)).toBe(31);
    expect(typedCount(0, 0)).toBe(0);
    expect(typedCount(100, 10, 25)).toBe(5);
  });
});

describe("<Typewriter>", () => {
  beforeEach(() => {
    reducedState.value = false;
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => vi.useRealTimers());

  const TEXT = "13 Trades · 4 Grundlagen";

  it("announces the text once and reserves the final box with an invisible copy", () => {
    const { container, getByText } = render(<Typewriter text={TEXT} />);
    expect(getByText(TEXT, { selector: ".sr-only" })).toBeInTheDocument();
    const root = container.querySelector('[data-pulse="typewriter"]') as HTMLElement;
    const placeholder = root.querySelector(".invisible")!;
    expect(placeholder.textContent).toBe(TEXT);
    expect(placeholder.getAttribute("aria-hidden")).toBe("true");
  });

  it("types from the clock and writes only on change", () => {
    const onDone = vi.fn();
    const { container } = render(<Typewriter text={TEXT} onDone={onDone} />);
    const root = container.querySelector('[data-pulse="typewriter"]') as HTMLElement;
    expect(typed(root)).toBe("");
    act(() => void vi.advanceTimersByTime(20));
    expect(typed(root)).toBe("1");
    act(() => void vi.advanceTimersByTime(65 * 5));
    expect(typed(root).length).toBeGreaterThanOrEqual(5);
    expect(typed(root).length).toBeLessThanOrEqual(7);
    expect(root.hasAttribute("data-typing")).toBe(true);
    act(() => void vi.advanceTimersByTime(65 * TEXT.length));
    expect(typed(root)).toBe(TEXT);
    expect(root.hasAttribute("data-typing")).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows the full text when no play is pending", () => {
    const { container } = render(<Typewriter text={TEXT} playOnMount={false} />);
    expect(typed(container.querySelector('[data-pulse="typewriter"]') as HTMLElement)).toBe(TEXT);
  });

  it("reduced motion: full text at once", () => {
    reducedState.value = true;
    const onDone = vi.fn();
    const { container } = render(<Typewriter text={TEXT} onDone={onDone} />);
    expect(typed(container.querySelector('[data-pulse="typewriter"]') as HTMLElement)).toBe(TEXT);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
