import { act, render, waitFor } from "@testing-library/react";
import { motionValue } from "motion/react";
import { describe, expect, it, vi } from "vitest";
import { StatusPill } from "@/motion/StatusPill";

const pings = () => Array.from(document.querySelectorAll<HTMLElement>("[data-fx='ping']"));
const lit = () => pings().filter((p) => Number(p.style.opacity || 0) > 0).length;
const rotation = (el: Element | null | undefined) => Number(/rotate\((-?[\d.]+)deg\)/.exec((el as HTMLElement | null)?.style.transform ?? "")?.[1] ?? NaN);

describe("StatusPill liveness", () => {
  it("breathes a heartbeat only while live; pings are pre-rendered, hidden and aria-hidden", () => {
    const { rerender } = render(<StatusPill tone="live" expanded label="Live" />);
    expect(document.querySelector("[data-fx='heartbeat']")).not.toBeNull();
    expect(pings()).toHaveLength(3);
    pings().forEach((p) => expect(p.className).toContain("opacity-0"));
    // the pill is no live region any more (a11y review: its label ticks every second) – queried by its data hook
    const pill = document.querySelector("[data-status-pill]");
    expect(pill?.getAttribute("role")).toBeNull();
    expect(pill?.querySelector("[data-fx]")?.closest("[aria-hidden='true']")).not.toBeNull();
    rerender(<StatusPill tone="warn" expanded label="Verzögert" />);
    expect(document.querySelector("[data-fx='heartbeat']")).toBeNull();
  });

  it("pingKey fires one bright ping per change, at most 4 per second", async () => {
    const { rerender } = render(<StatusPill tone="live" expanded label="Live" pingKey={0} />);
    expect(lit()).toBe(0);
    rerender(<StatusPill tone="live" expanded label="Live" pingKey={1} />);
    rerender(<StatusPill tone="live" expanded label="Live" pingKey={2} />);
    await waitFor(() => expect(lit()).toBe(1));
  });

  it("pingOn pings from MotionValue changes without re-rendering", async () => {
    const mv = motionValue(1);
    render(<StatusPill tone="live" expanded label="Live" pingOn={mv} />);
    act(() => mv.set(2));
    await waitFor(() => expect(lit()).toBe(1));
  });
});

describe("StatusPill countdown ring", () => {
  it("a RingCycle is placed at its elapsed progress on mount (two compositor half-rings)", () => {
    // the ring reads Date.now() in its layout effect: on the wall clock, every ms between building the prop and the
    // mount turns the half-rings by 0.012° — under a loaded parallel run > 40 ms passed and 45° ± 0.5 failed. Frozen
    // Date: exactly half-way.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_790_000_000_000);
    try {
      const { container } = render(<StatusPill tone="live" expanded label="Live" ring={{ endsAt: Date.now() + 15_000, ms: 30_000 }} />);
      const halves = container.querySelectorAll("[data-fx='ring'] .overflow-hidden > span");
      expect(halves).toHaveLength(2);
      // half-way: the right half-ring has arrived (45°), the left one has not started (45°)
      expect(rotation(halves[0])).toBeCloseTo(45, 0);
      expect(rotation(halves[1])).toBeCloseTo(45, 0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a numeric progress still renders (start of the cycle → both halves hidden)", () => {
    const { container } = render(<StatusPill tone="warn" expanded label="Kein Live-Kurs" ring={0} spinning />);
    const halves = container.querySelectorAll("[data-fx='ring'] .overflow-hidden > span");
    expect(rotation(halves[0])).toBe(-135);
    expect(rotation(halves[1])).toBe(45);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });
});
