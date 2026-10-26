import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const controls: { el: Element; keyframes: Record<string, unknown>; options: Record<string, unknown>; cancel: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return {
    ...actual,
    animate: vi.fn((el: Element, keyframes: Record<string, unknown>, options: Record<string, unknown>) => {
      const c = { el, keyframes, options, cancel: vi.fn(), stop: vi.fn() };
      controls.push(c);
      return { cancel: c.cancel, stop: c.stop, then: (f: () => void) => Promise.resolve().then(f) };
    }),
  };
});

import { PULSE_STALE_MS, PulseDriver } from "@/chart/overlays";
import { FLASH_MIN_INTERVAL_MS } from "@/motion/ValueFlash";

function nodes() {
  const make = () => document.createElement("span");
  return { root: make(), rings: [make(), make()], pingUp: make(), pingDown: make(), tintUp: make(), tintDown: make() };
}

beforeEach(() => {
  controls.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("PulseDriver", () => {
  it("positions by transform and shows / hides by opacity", () => {
    const n = nodes();
    const d = new PulseDriver(n, false);
    d.place({ x: 12.5, y: 40 });
    expect(n.root.style.transform).toBe("translate3d(12.5px, 40px, 0)");
    expect(n.root.style.opacity).toBe("1");
    d.place(null);
    expect(n.root.style.opacity).toBe("0");
  });

  it("breathes only while placed, active and printing; stops after the stale window", () => {
    const n = nodes();
    const d = new PulseDriver(n, false);
    d.place({ x: 1, y: 1 });
    d.setActive(true);
    const rings = () => controls.filter((c) => n.rings.includes(c.el as HTMLElement));
    expect(rings()).toHaveLength(0);

    d.tick(1);
    expect(rings().map((c) => c.options.delay)).toEqual([0, 0.8]);
    // a print tints the core win and pings once
    expect(controls.some((c) => c.el === n.tintUp)).toBe(true);
    expect(controls.some((c) => c.el === n.pingUp)).toBe(true);

    vi.advanceTimersByTime(PULSE_STALE_MS - 1);
    expect(rings().every((c) => c.cancel.mock.calls.length === 0)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(rings().every((c) => c.cancel.mock.calls.length === 1)).toBe(true);

    // inactive (off-screen / collapsed): the next print does not restart them
    d.setActive(false);
    const before = rings().length;
    d.tick(-1);
    expect(rings()).toHaveLength(before);
  });

  // contract changed on purpose (visual review "tick-flash-strobe"): a flip no longer re-tints at once – the tint is
  // limited to one per FLASH_MIN_INTERVAL_MS and a flip inside that gap only cuts it; pings stay capped at 4 Hz
  it("tints at most once per flash gap (a flip inside it only cuts the tint) and caps pings at 4 Hz", () => {
    const n = nodes();
    const d = new PulseDriver(n, false);
    d.place({ x: 1, y: 1 });
    d.setActive(true);
    d.tick(1);
    d.tick(1);
    expect(controls.filter((c) => c.el === n.pingUp)).toHaveLength(1);
    expect(controls.filter((c) => c.el === n.tintUp)).toHaveLength(1);
    d.tick(-1);
    expect(controls.filter((c) => c.el === n.pingDown)).toHaveLength(0);
    expect(controls.filter((c) => c.el === n.tintDown)).toHaveLength(0);
    expect(n.tintUp.style.opacity).toBe("0");
    expect(n.tintDown.style.opacity).toBe("0");
    vi.advanceTimersByTime(250);
    d.tick(-1);
    expect(controls.filter((c) => c.el === n.pingDown)).toHaveLength(1);
    expect(controls.filter((c) => c.el === n.tintDown)).toHaveLength(0);
    vi.advanceTimersByTime(FLASH_MIN_INTERVAL_MS);
    d.tick(-1);
    expect(controls.filter((c) => c.el === n.tintDown)).toHaveLength(1);
  });

  it("stays a static dot under reduced motion", () => {
    const n = nodes();
    const d = new PulseDriver(n, true);
    d.place({ x: 1, y: 1 });
    d.setActive(true);
    d.tick(1);
    d.tick(-1);
    expect(controls).toHaveLength(0);
    expect(n.root.style.opacity).toBe("1");
    d.destroy();
  });
});
