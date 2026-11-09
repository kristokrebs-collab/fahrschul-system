import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOrbLoop, ORB_MAX_STEP, type OrbLoopEnv } from "@/motion/orbLoop";
import { bucketAlpha, bucketOf, fibonacciSphere, hash01, ORB_BUCKETS, ORB_DOTS, orbFrame, orbStill, type OrbVariant } from "@/motion/orbMath";
import { OrbStill, ThinkingOrb } from "@/motion/ThinkingOrb";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

afterEach(() => {
  fx.reduced = false;
});

const VARIANTS: OrbVariant[] = ["search", "calc", "plan"];

describe("orb frames (pure)", () => {
  it("gives the fixed number of dots, all inside the unit square, with sane radius and opacity", () => {
    for (const v of VARIANTS) {
      for (const t of [0, 0.4, 1.7, 5.1, 23.9]) {
        const dots = orbFrame(v, t);
        expect(dots).toHaveLength(ORB_DOTS[v]);
        for (const d of dots) {
          expect(Math.hypot(d.x, d.y)).toBeLessThanOrEqual(1.45);
          expect(Math.abs(d.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(d.y)).toBeLessThanOrEqual(1);
          expect(d.r).toBeGreaterThan(0);
          expect(d.r).toBeLessThan(0.3);
          expect(d.a).toBeGreaterThanOrEqual(0);
          expect(d.a).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("is a pure function of (variant, t): same input → same dots, a later t → other dots", () => {
    for (const v of VARIANTS) {
      expect(orbFrame(v, 1.234)).toEqual(orbFrame(v, 1.234));
      expect(orbFrame(v, 0.5)).not.toEqual(orbFrame(v, 1.5));
    }
  });

  it("the still symbol is one frame of the animation", () => {
    for (const v of VARIANTS) expect(orbStill(v)).toEqual(orbFrame(v, { search: 1.1, calc: 2.3, plan: 0.55 }[v]));
  });

  it("the ball turns: near dots are bigger and brighter than far ones", () => {
    const dots = orbFrame("search", 0);
    const bright = dots.filter((d) => d.a > 0.6);
    const faint = dots.filter((d) => d.a < 0.3);
    expect(bright.length).toBeGreaterThan(5);
    expect(faint.length).toBeGreaterThan(5);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(bright.map((d) => d.r))).toBeGreaterThan(avg(faint.map((d) => d.r)));
  });

  it("the ring has one bright head that walks around", () => {
    const head = (t: number) => orbFrame("plan", t).reduce((best, d, i, all) => (d.a > all[best]!.a ? i : best), 0);
    const first = head(0.0);
    const later = head(0.6);
    expect(first).not.toBe(later);
    // after exactly one lap the head is back
    expect(head(2.2 * 3)).toBe(head(0));
  });

  it("fibonacci points lie on the unit sphere and hash01 stays in [0,1)", () => {
    for (const [x, y, z] of fibonacciSphere(40)) expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    for (let i = 0; i < 200; i++) {
      const h = hash01(i, 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it("opacity buckets cover 0…1 without a gap", () => {
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(1)).toBe(ORB_BUCKETS - 1);
    expect(bucketOf(0.5)).toBe(2);
    for (let b = 0; b < ORB_BUCKETS; b++) expect(bucketOf(bucketAlpha(b))).toBe(b);
  });
});

/** A fake animation-frame clock: `tick(ms)` runs the pending callback at `now + ms`. */
function fakeEnv() {
  let now = 0;
  let nextId = 1;
  let pending: { id: number; cb: (t: number) => void } | null = null;
  let hidden = false;
  const raf = vi.fn((cb: (t: number) => void) => {
    pending = { id: nextId++, cb };
    return pending.id;
  });
  const caf = vi.fn((id: number) => {
    if (pending?.id === id) pending = null;
  });
  const env: OrbLoopEnv = { raf, caf, hidden: () => hidden };
  return {
    env,
    raf,
    caf,
    tick(ms: number) {
      now += ms;
      const p = pending;
      pending = null;
      p?.cb(now);
    },
    hide(v: boolean) {
      hidden = v;
    },
    isPending: () => pending !== null,
  };
}

describe("orb loop (no frames unless it must run)", () => {
  it("requests a frame only while active, in view and the tab is visible", () => {
    const c = fakeEnv();
    const draw = vi.fn();
    const loop = createOrbLoop(draw, c.env);
    expect(loop.running()).toBe(true);
    c.tick(16);
    c.tick(16);
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(3);

    // scrolled out of view → the pending frame is cancelled, no further request
    loop.set({ inView: false });
    expect(loop.running()).toBe(false);
    expect(c.isPending()).toBe(false);
    const callsOffscreen = c.raf.mock.calls.length;
    c.tick(500);
    expect(c.raf.mock.calls.length).toBe(callsOffscreen);

    // back on screen → it runs again
    loop.set({ inView: true });
    expect(loop.running()).toBe(true);
    loop.dispose();
    expect(c.isPending()).toBe(false);
  });

  it("stops for a hidden tab (visibilitychange) and resumes when it is visible again", () => {
    const c = fakeEnv();
    const loop = createOrbLoop(vi.fn(), c.env);
    c.hide(true);
    loop.visibility();
    expect(loop.running()).toBe(false);
    expect(c.isPending()).toBe(false);
    c.hide(false);
    loop.visibility();
    expect(loop.running()).toBe(true);
    loop.dispose();
  });

  it("an orb that is not active never starts and shows one still frame", () => {
    const c = fakeEnv();
    const draw = vi.fn();
    const loop = createOrbLoop(draw, c.env, { active: false });
    expect(loop.running()).toBe(false);
    expect(c.raf).not.toHaveBeenCalled();
    expect(draw).toHaveBeenCalledTimes(1);
    loop.dispose();
  });

  it("time is time based and clamped: a long pause does not fast-forward", () => {
    const c = fakeEnv();
    const loop = createOrbLoop(vi.fn(), c.env);
    c.tick(16); // first frame: no step yet
    c.tick(1000); // a 1 s stall counts as one clamped step
    expect(loop.time()).toBeCloseTo(ORB_MAX_STEP, 6);
    c.tick(8.333); // a 120 Hz frame advances ≈ 8.3 ms
    expect(loop.time()).toBeCloseTo(ORB_MAX_STEP + 0.008333, 5);
    loop.dispose();
  });

  it("after a pause the clock continues where it stopped", () => {
    const c = fakeEnv();
    const loop = createOrbLoop(vi.fn(), c.env);
    c.tick(16);
    c.tick(50);
    const t = loop.time();
    loop.set({ active: false });
    c.tick(60_000);
    loop.set({ active: true });
    expect(loop.time()).toBeCloseTo(t, 6);
    c.tick(16);
    c.tick(16);
    expect(loop.time() - t).toBeLessThan(0.05);
    loop.dispose();
  });
});

describe("ThinkingOrb", () => {
  it("is decorative without a label and an image with one", () => {
    const { container, rerender } = render(<ThinkingOrb variant="search" />);
    expect(container.querySelector("[data-thinking-orb]")).toHaveAttribute("aria-hidden", "true");
    rerender(<ThinkingOrb variant="search" label="Verbindung wird geprüft" />);
    expect(screen.getByRole("img", { name: "Verbindung wird geprüft" })).toBeInTheDocument();
  });

  it("reduced motion renders the static symbol only (no canvas, no frames)", () => {
    fx.reduced = true;
    const { container } = render(<ThinkingOrb variant="calc" size={32} />);
    expect(container.querySelector("canvas")).toBeNull();
    const svg = container.querySelector("svg[data-orb-still]");
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("circle")).toHaveLength(ORB_DOTS.calc);
    expect(container.querySelector("[data-orb-active]")).toBeNull();
  });

  it("an inactive orb is the still symbol too and keeps its box", () => {
    const { container } = render(<ThinkingOrb variant="plan" size={36} active={false} />);
    expect(container.querySelector("canvas")).toBeNull();
    const box = container.querySelector<HTMLElement>("[data-thinking-orb]")!;
    expect(box.style.width).toBe("36px");
    expect(box.style.height).toBe("36px");
  });

  it("the still symbol carries the dots of the variant", () => {
    for (const v of VARIANTS) {
      const { container, unmount } = render(<OrbStill variant={v} />);
      expect(container.querySelectorAll("circle")).toHaveLength(ORB_DOTS[v]);
      unmount();
    }
  });
});
