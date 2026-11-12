import { afterEach, describe, expect, it, vi } from "vitest";
import { START_DELAY_MS, SCROLL_QUIET_MS, startIdlePrerender } from "@/primitives/idlePrerender";

function cells(n: number): HTMLElement {
  const root = document.createElement("div");
  for (let i = 0; i < n; i++) {
    const c = document.createElement("div");
    c.dataset.defer = "";
    c.id = `c${i}`;
    root.appendChild(c);
  }
  document.body.appendChild(root);
  return root;
}

describe("idle first render of deferred cells", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("renders one cell per idle period, top to bottom, and hands it back to content-visibility:auto", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const root = cells(3);
    const stop = startIdlePrerender(root);
    const c0 = root.querySelector<HTMLElement>("#c0")!;
    vi.advanceTimersByTime(START_DELAY_MS - 1);
    expect(c0.style.contentVisibility).toBe("");
    // without requestIdleCallback (jsdom) a short timer stands in for the idle period
    vi.advanceTimersByTime(1 + 120);
    expect(c0.style.contentVisibility).toBe("visible");
    expect(root.querySelector<HTMLElement>("#c1")!.style.contentVisibility).toBe("");
    vi.advanceTimersByTime(40);
    expect(c0.style.contentVisibility).toBe("");
    expect(c0.dataset.prerendered).toBe("");
    vi.advanceTimersByTime(1000);
    expect(root.querySelectorAll("[data-prerendered]")).toHaveLength(3);
    stop();
  });

  it("waits while the page scrolls and stops cleanly", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const root = cells(2);
    const stop = startIdlePrerender(root);
    vi.advanceTimersByTime(START_DELAY_MS - 10);
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(130);
    expect(root.querySelectorAll("[data-prerendered]")).toHaveLength(0);
    vi.advanceTimersByTime(SCROLL_QUIET_MS - 130 + 120);
    expect(root.querySelector<HTMLElement>("#c0")!.style.contentVisibility).toBe("visible");
    stop();
    // a stopped run leaves no cell half-done
    expect(root.querySelector<HTMLElement>("#c0")!.style.contentVisibility).toBe("");
    expect(root.querySelectorAll("[data-prerendered]")).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    expect(root.querySelectorAll("[data-prerendered]")).toHaveLength(0);
  });
});
