import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Celebrate, MAX_PARTICLES, PARTICLE_COLORS, ballistic, burstParticles, celebrateFrom, mulberry32 } from "@/motion/Celebrate";
import { CELEBRATION_TTL_MS, MAX_CELEBRATIONS, celebrate, useUi } from "@/store/uiStore";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

beforeEach(() => {
  useUi.setState({ celebrations: [] });
});
afterEach(() => {
  fx.reduced = false;
  vi.useRealTimers();
});

describe("uiStore.celebrate", () => {
  it("queues bursts with defaults, unique ids and a seed", () => {
    const a = celebrate({ x: 100, y: 200 });
    const b = useUi.getState().celebrate({ x: 1, y: 2, tone: "fg", kind: "record" });
    expect(b).toBeGreaterThan(a);
    const [first, second] = useUi.getState().celebrations;
    expect(first).toMatchObject({ id: a, x: 100, y: 200, tone: "win", kind: "win" });
    expect(second).toMatchObject({ id: b, tone: "fg", kind: "record" });
    expect(Number.isInteger(first?.seed)).toBe(true);
  });

  it("keeps at most MAX_CELEBRATIONS (dropping the oldest) and sanitises coordinates", () => {
    const ids = Array.from({ length: MAX_CELEBRATIONS + 2 }, (_, i) => celebrate({ x: i, y: Number.NaN }));
    const list = useUi.getState().celebrations;
    expect(list.map((c) => c.id)).toEqual(ids.slice(-MAX_CELEBRATIONS));
    expect(list.every((c) => c.y === 0)).toBe(true);
  });

  it("endCelebration removes one burst and ignores unknown ids", () => {
    const a = celebrate({ x: 0, y: 0 });
    const b = celebrate({ x: 0, y: 0 });
    const before = useUi.getState();
    useUi.getState().endCelebration(9_999);
    expect(useUi.getState()).toBe(before);
    useUi.getState().endCelebration(a);
    expect(useUi.getState().celebrations.map((c) => c.id)).toEqual([b]);
  });

  it("prunes bursts nobody played after the TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    celebrate({ x: 0, y: 0 });
    vi.setSystemTime(1_000_000 + CELEBRATION_TTL_MS + 1);
    const fresh = celebrate({ x: 5, y: 5 });
    expect(useUi.getState().celebrations.map((c) => c.id)).toEqual([fresh]);
  });
});

describe("burst particles", () => {
  const base = { x: 200, y: 300, tone: "win" as const, seed: 42 };

  it("is deterministic per seed", () => {
    expect(burstParticles({ ...base, kind: "win" })).toEqual(burstParticles({ ...base, kind: "win" }));
    expect(burstParticles({ ...base, kind: "win" })).not.toEqual(burstParticles({ ...base, kind: "win", seed: 43 }));
    const r = mulberry32(7);
    const xs = Array.from({ length: 50 }, r);
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("sizes the burst by kind, capped at MAX_PARTICLES", () => {
    expect(burstParticles({ ...base, kind: "win" })).toHaveLength(28);
    expect(burstParticles({ ...base, kind: "streak" })).toHaveLength(36);
    expect(burstParticles({ ...base, kind: "record" })).toHaveLength(MAX_PARTICLES);
  });

  it("uses Nothing dots only: white + win green, one red signal dot for a record", () => {
    const win = burstParticles({ ...base, kind: "win" });
    expect(new Set(win.map((p) => p.color))).toEqual(new Set([PARTICLE_COLORS.white, PARTICLE_COLORS.win]));
    const record = burstParticles({ ...base, kind: "record" });
    const red = record.filter((p) => p.color === PARTICLE_COLORS.signal);
    expect(red).toHaveLength(1);
    expect(red[0]?.record).toBe(true);
    const fg = burstParticles({ ...base, tone: "fg", kind: "streak" });
    expect(fg.filter((p) => p.color === PARTICLE_COLORS.white).length).toBeGreaterThan(fg.length / 2);
  });

  it("starts at the origin, ends invisible and stays transform/opacity only", () => {
    for (const p of burstParticles({ ...base, kind: "streak" })) {
      const off = p.size / 2;
      expect(p.transform[0]).toBe(`translate3d(${base.x - off}px, ${base.y - off}px, 0) scale(0.3)`);
      expect(p.opacity[0]).toBe(1);
      expect(p.opacity.at(-1)).toBe(0);
      expect(p.transform).toHaveLength(p.opacity.length);
      expect(p.duration).toBeGreaterThan(0.9);
      expect(p.duration).toBeLessThan(1.5);
    }
  });

  it("flies up first, then falls (gravity + drag)", () => {
    expect(ballistic(0, -500, 0)).toEqual({ x: 0, y: 0 });
    const early = ballistic(100, -500, 0.3);
    expect(early.y).toBeLessThan(-80);
    expect(early.x).toBeGreaterThan(0);
    expect(ballistic(0, -500, 1.2).y).toBeGreaterThan(early.y);
  });
});

describe("<Celebrate>", () => {
  it("renders nothing until a burst is queued, then a decorative fixed, clipped layer", () => {
    const { container } = render(<Celebrate />);
    expect(container.firstChild).toBeNull();
    act(() => {
      celebrate({ x: 50, y: 60 });
    });
    const layer = container.querySelector("[data-celebrate]") as HTMLElement;
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer.className).toContain("pointer-events-none");
    expect(layer.className).toContain("fixed");
    expect(layer.className).toContain("overflow-hidden");
    // ring + 28 dots
    expect(layer.querySelectorAll("[data-burst] > span")).toHaveLength(1 + 28);
  });

  it("under reduced motion plays only the ring", () => {
    fx.reduced = true;
    const { container } = render(<Celebrate />);
    act(() => {
      celebrate({ x: 50, y: 60, kind: "record" });
    });
    expect(container.querySelectorAll("[data-burst] > span")).toHaveLength(1);
    expect(container.querySelector("[data-record]")).toBeNull();
  });

  it("removes a finished burst from the store", async () => {
    fx.reduced = true; // shortest timeline (tween.flash)
    const { container } = render(<Celebrate />);
    act(() => {
      celebrate({ x: 1, y: 1 });
    });
    await waitFor(() => expect(useUi.getState().celebrations).toHaveLength(0), { timeout: 2000 });
    expect(container.firstChild).toBeNull();
  });

  it("celebrateFrom bursts from the element centre in the next frame", async () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ left: 100, top: 40, width: 80, height: 30, right: 180, bottom: 70, x: 100, y: 40, toJSON: () => ({}) });
    celebrateFrom(el, { kind: "streak", tone: "fg", squash: false });
    expect(useUi.getState().celebrations).toHaveLength(0);
    await waitFor(() => expect(useUi.getState().celebrations).toHaveLength(1));
    expect(useUi.getState().celebrations[0]).toMatchObject({ x: 140, y: 55, kind: "streak", tone: "fg" });
    celebrateFrom(null);
    el.remove();
  });
});
