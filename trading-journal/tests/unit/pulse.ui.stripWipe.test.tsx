import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CONFIG, StripWipe, playStripWipe, stripReveal, stripWipeDuration } from "@/motion/pulse/StripWipe";

function sized(w = 400, h = 200) {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: w });
  Object.defineProperty(host, "clientHeight", { value: h });
  document.body.appendChild(host);
  return host;
}

describe("StripWipe timing (pack values)", () => {
  it("10 strips, 26 ms stagger, 420 ms width → 654 ms total", () => {
    expect(CONFIG.strips).toBe(10);
    expect(stripWipeDuration()).toBe(26 * 9 + 420);
  });

  it("strip i starts 26·i ms in; width easeOutQuart, height 1-exp(-t/45) snapping full at 420 ms", () => {
    expect(stripReveal(0, 0)).toEqual({ sx: 0, sy: 0 });
    expect(stripReveal(26 * 3, 3)).toEqual({ sx: 0, sy: 0 });
    const mid = stripReveal(26 * 3 + 210, 3);
    expect(mid.sx).toBeCloseTo(1 - Math.pow(0.5, 4), 6);
    expect(mid.sy).toBeCloseTo(1 - Math.exp(-210 / 45), 6);
    expect(stripReveal(45, 0).sy).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(stripReveal(420, 0)).toEqual({ sx: 1, sy: 1 });
    // left strips always lead
    const e = 200;
    for (let i = 1; i < 10; i++) expect(stripReveal(e, i).sx).toBeLessThanOrEqual(stripReveal(e, i - 1).sx);
  });
});

describe("playStripWipe", () => {
  it("builds 10 strips × 2 pieces covering the host, removes itself and calls onDone", async () => {
    const host = sized();
    const onDone = vi.fn();
    playStripWipe(host, "data:image/png;base64,AAAA", { onDone });
    const overlay = host.querySelector("[data-strip-wipe]") as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.style.pointerEvents).toBe("none");
    expect(overlay.children).toHaveLength(10);
    const widths = [...overlay.children].map((c) => parseFloat((c as HTMLElement).style.width));
    expect(widths.reduce((a, b) => a + b, 0)).toBe(400);
    expect(overlay.children[0]!.children).toHaveLength(2);
    await new Promise((r) => setTimeout(r, stripWipeDuration() + 150));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-strip-wipe]")).toBeNull();
  });

  it("reduced motion: instant, no overlay", () => {
    const host = sized();
    const onDone = vi.fn();
    playStripWipe(host, "x.png", { onDone, reduced: true });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(0);
  });

  it("cancel removes the overlay without onDone", () => {
    const host = sized();
    const onDone = vi.fn();
    const cancel = playStripWipe(host, "x.png", { onDone });
    cancel();
    expect(host.children).toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("<StripWipe>", () => {
  it("does not play on mount, plays on trigger change, ignores a null snapshot", () => {
    const { container, rerender } = render(<StripWipe trigger={1} from="a.png" />);
    const host = container.querySelector("[data-strip-wipe-host]") as HTMLElement;
    expect(host).toHaveClass("pointer-events-none");
    Object.defineProperty(host, "clientWidth", { value: 300 });
    Object.defineProperty(host, "clientHeight", { value: 100 });
    expect(host.children).toHaveLength(0);
    rerender(<StripWipe trigger={2} from="a.png" />);
    expect(host.querySelectorAll("[data-strip-wipe]")).toHaveLength(1);
    rerender(<StripWipe trigger={3} from="b.png" />);
    expect(host.querySelectorAll("[data-strip-wipe]")).toHaveLength(1);
    rerender(<StripWipe trigger={4} from={null} />);
    expect(host.querySelectorAll("[data-strip-wipe]")).toHaveLength(0);
  });
});
