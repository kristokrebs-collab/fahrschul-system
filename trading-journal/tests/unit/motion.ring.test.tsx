/**
 * Runde 12 – the voice ring (a variant of the thinking orb): the pure outline and looks, the still symbol, the three moods
 * (aktiv / denkt nach / ruhig-mono), the frame loop that rests at idle, in a hidden tab and under reduced motion, and no layout change.
 */
import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { easeLook, mixLook, RING_EASE_S, RING_LOOK, RING_POINTS, RING_RADIUS, RING_SETTLE_MS, RING_STILL_T, ringExtent, ringPath, ringPoints, ringSpin, type RingMood } from "@/motion/ringMath";
import { RingStill, ThinkingOrb } from "@/motion/ThinkingOrb";
import VoiceRingCanvas, { paintRing } from "@/motion/VoiceRingCanvas";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

const MOODS: RingMood[] = ["active", "think", "quiet"];
const radii = (mood: RingMood, t: number) => ringPoints(RING_LOOK[mood], t).map((p) => Math.hypot(p.x, p.y));
const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

describe("ring outline (pure)", () => {
  it("is a closed outline of fixed size, inside the box with room for the halo, at every moment of every mood", () => {
    for (const mood of MOODS) {
      for (const t of [0, 0.37, 1.3, 4.9, 31.2]) {
        for (let strand = 0; strand < RING_LOOK[mood].layers; strand++) {
          const pts = ringPoints(RING_LOOK[mood], t, strand);
          expect(pts).toHaveLength(RING_POINTS);
          expect(ringExtent(pts)).toBeLessThanOrEqual(0.78);
          expect(ringExtent(pts)).toBeGreaterThan(RING_RADIUS * 0.8);
        }
      }
    }
  });

  it("is a pure function of (look, t, strand): the same input gives the same points, a later t other ones, strands lie apart", () => {
    const look = RING_LOOK.active;
    expect(ringPoints(look, 1.234, 1)).toEqual(ringPoints(look, 1.234, 1));
    expect(ringPoints(look, 0.5)).not.toEqual(ringPoints(look, 1.5));
    expect(ringPoints(look, 1, 0)).not.toEqual(ringPoints(look, 1, 1));
  });

  it("moves softly: the neighbouring points never jump (no kinks), and the outline is a smooth closed curve (last point leads back to the first)", () => {
    for (const mood of MOODS) {
      const pts = ringPoints(RING_LOOK[mood], 2.2);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        // chord of one segment on a ring of radius ≈ .62 at 72 points ≈ .054
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.075);
      }
    }
  });

  it("the moods differ the way they are meant: active deforms the most, quiet is almost round and mono", () => {
    expect(spread(radii("active", 1.3))).toBeGreaterThan(spread(radii("think", 1.3)));
    expect(spread(radii("think", 1.3))).toBeGreaterThan(spread(radii("quiet", 1.3)));
    expect(spread(radii("quiet", 2.1))).toBeLessThan(RING_RADIUS * 0.12);
    expect(RING_LOOK.active.layers).toBe(3);
    expect(RING_LOOK.think.layers).toBe(2);
    expect(RING_LOOK.quiet.layers).toBe(1);
    // mono: no halo and no accent that runs round
    expect(RING_LOOK.quiet.glow).toBe(0);
    expect(RING_LOOK.quiet.spin).toBe(0);
    expect(RING_LOOK.think.spin).toBeGreaterThan(RING_LOOK.active.spin);
    expect(ringSpin(RING_LOOK.quiet, 7)).toBe(0);
    expect(ringSpin(RING_LOOK.think, 1)).toBeGreaterThan(ringSpin(RING_LOOK.active, 1));
  });

  it("the look eases from one mood to the next: no jump at dt 0, monotone towards the target, there after a few time constants", () => {
    const from = RING_LOOK.active;
    const to = RING_LOOK.quiet;
    expect(easeLook(from, to, 0)).toEqual(from);
    const one = easeLook(from, to, 1 / 60);
    expect(one.amp).toBeLessThan(from.amp);
    expect(one.amp).toBeGreaterThan(to.amp);
    expect(easeLook(from, to, RING_EASE_S).amp).toBeLessThan(one.amp);
    const late = easeLook(from, to, RING_EASE_S * 8);
    expect(late.amp).toBeCloseTo(to.amp, 3);
    expect(late.layers).toBe(1);
    expect(Number.isInteger(mixLook(from, to, 0.37).layers)).toBe(true);
    // frame-rate independent: one 100 ms step lands where ten 10 ms steps do
    let s = from;
    for (let i = 0; i < 10; i++) s = easeLook(s, to, 0.01);
    expect(s.amp).toBeCloseTo(easeLook(from, to, 0.1).amp, 6);
  });

  it("the still symbol is one frame of the animation, as path data", () => {
    for (const mood of MOODS) {
      const d = ringPath(ringPoints(RING_LOOK[mood], RING_STILL_T[mood]));
      expect(d.startsWith("M")).toBe(true);
      expect(d.endsWith("Z")).toBe(true);
      expect((d.match(/L/g) ?? []).length).toBe(RING_POINTS - 1);
    }
  });
});

/** A canvas context that only counts: frames (`clearRect`), strokes, the coordinates it was asked to draw at. */
function fakeContext() {
  const ctx = {
    calls: { clear: 0, stroke: 0 },
    xy: [] as number[],
    globalAlpha: 1,
    lineWidth: 0,
    strokeStyle: "" as string,
    lineJoin: "",
    lineCap: "",
    clearRect() {
      ctx.calls.clear++;
    },
    beginPath() {},
    closePath() {},
    moveTo(x: number, y: number) {
      ctx.xy.push(x, y);
    },
    lineTo(x: number, y: number) {
      ctx.xy.push(x, y);
    },
    stroke() {
      ctx.calls.stroke++;
    },
    setTransform() {},
  };
  return ctx;
}

describe("paintRing", () => {
  const palette = { fg: "#fff", signal: "#f00" };

  it("mono is ONE plain strand: a single stroke, no halo, no accent", () => {
    const ctx = fakeContext();
    paintRing(ctx as unknown as CanvasRenderingContext2D, 40, RING_LOOK.quiet, 1, palette);
    expect(ctx.calls.stroke).toBe(1);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("the active and thinking rings draw a two-pass halo and the strand for each strand plus the accent (a comet of three pieces and its halo)", () => {
    for (const mood of ["active", "think"] as const) {
      const ctx = fakeContext();
      paintRing(ctx as unknown as CanvasRenderingContext2D, 40, RING_LOOK[mood], 1, palette);
      expect(ctx.calls.stroke).toBe(RING_LOOK[mood].layers * 3 + 3 + 1);
      expect(ctx.globalAlpha).toBe(1);
    }
  });

  it("never draws outside its box (the halo stroke fits the margin), and the accent is the signal colour", () => {
    for (const mood of MOODS) {
      const ctx = fakeContext();
      paintRing(ctx as unknown as CanvasRenderingContext2D, 48, RING_LOOK[mood], 3.3, palette);
      for (const v of ctx.xy) {
        expect(v).toBeGreaterThan(48 * 0.1);
        expect(v).toBeLessThan(48 * 0.9);
      }
    }
    const ctx = fakeContext();
    paintRing(ctx as unknown as CanvasRenderingContext2D, 40, RING_LOOK.think, 1, palette);
    expect(ctx.strokeStyle).toBe("#f00");
  });
});

describe("RingStill / ThinkingOrb variant ring", () => {
  afterEach(() => {
    fx.reduced = false;
  });

  it("the still ring has the strands of its mood, the accent arc only where the ring has one, a halo unless mono", () => {
    for (const mood of MOODS) {
      const { container, unmount } = render(<RingStill mood={mood} size={32} />);
      const svg = container.querySelector("svg[data-ring-still]")!;
      expect(svg.getAttribute("data-ring-still")).toBe(mood);
      expect(svg).toHaveAttribute("aria-hidden", "true");
      const strokes = Array.from(svg.querySelectorAll("path"));
      const accent = strokes.filter((p) => p.getAttribute("stroke")?.includes("--color-signal")).length;
      const halo = strokes.filter((p) => p.hasAttribute("data-ring-halo")).length;
      expect(halo).toBe(RING_LOOK[mood].glow > 0 ? 2 : 0);
      expect(strokes.length - accent - halo).toBe(RING_LOOK[mood].layers);
      expect(accent).toBe(RING_LOOK[mood].spin > 0 ? 1 : 0);
      unmount();
    }
  });

  it("reduced motion renders the still ring only (no canvas, no frames), in its mood", () => {
    fx.reduced = true;
    const { container } = render(<ThinkingOrb variant="ring" mood="active" size={40} />);
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("svg[data-ring-still='active']")).not.toBeNull();
    expect(container.querySelector("[data-orb-active]")).toBeNull();
    expect(container.querySelector("[data-thinking-orb]")).toHaveAttribute("data-thinking-orb", "ring");
  });

  it("an inactive ring is the still ring too and keeps its box; decorative without a label, an image with one", () => {
    const { container, rerender } = render(<ThinkingOrb variant="ring" mood="quiet" size={36} active={false} />);
    expect(container.querySelector("canvas")).toBeNull();
    const box = container.querySelector<HTMLElement>("[data-thinking-orb]")!;
    expect(box.style.width).toBe("36px");
    expect(box.style.height).toBe("36px");
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(box).toHaveAttribute("data-ring-mood", "quiet");
    rerender(<ThinkingOrb variant="ring" mood="quiet" size={36} active={false} label="Antwort wird gebildet" />);
    expect(screen.getByRole("img", { name: "Antwort wird gebildet" })).toBeInTheDocument();
  });

  it("the box is the same size in every mood and for the still and the running ring (no layout change)", () => {
    const sizes = MOODS.map((mood) => {
      const { container, unmount } = render(<ThinkingOrb variant="ring" mood={mood} size={28} />);
      const box = container.querySelector<HTMLElement>("[data-thinking-orb]")!;
      const out = [box.style.width, box.style.height];
      unmount();
      return out.join("×");
    });
    expect(new Set(sizes)).toEqual(new Set(["28px×28px"]));
  });

  it("the dot variants are untouched: no ring attributes", () => {
    const { container } = render(<ThinkingOrb variant="search" active={false} />);
    const box = container.querySelector("[data-thinking-orb]")!;
    expect(box.getAttribute("data-thinking-orb")).toBe("search");
    expect(box.hasAttribute("data-ring-mood")).toBe(false);
  });
});

describe("VoiceRingCanvas: the frame loop", () => {
  let ctx: ReturnType<typeof fakeContext>;
  beforeEach(() => {
    vi.useFakeTimers();
    ctx = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  const frames = () => ctx.calls.clear;

  it("an active ring draws frames; one that is not active draws one still frame and requests no more", () => {
    const { rerender } = render(<VoiceRingCanvas mood="active" size={40} active />);
    advance(200);
    expect(frames()).toBeGreaterThan(5);
    rerender(<VoiceRingCanvas mood="active" size={40} active={false} />);
    advance(50);
    const after = frames();
    advance(1000);
    expect(frames()).toBe(after);
  });

  it("a QUIET ring moves for a moment and then rests: no endless loop at idle", () => {
    render(<VoiceRingCanvas mood="quiet" size={40} active />);
    advance(300);
    expect(frames()).toBeGreaterThan(5);
    advance(RING_SETTLE_MS + 300);
    const rest = frames();
    advance(2000);
    expect(frames()).toBe(rest);
  });

  it("a quiet ring that becomes active runs again; an active one that becomes quiet rests after the settle time", () => {
    const { rerender } = render(<VoiceRingCanvas mood="quiet" size={40} active />);
    advance(RING_SETTLE_MS + 300);
    const rest = frames();
    rerender(<VoiceRingCanvas mood="active" size={40} active />);
    advance(200);
    expect(frames()).toBeGreaterThan(rest + 5);
    rerender(<VoiceRingCanvas mood="quiet" size={40} active />);
    advance(RING_SETTLE_MS + 300);
    const again = frames();
    advance(1500);
    expect(frames()).toBe(again);
  });

  it("a hidden tab asks for no frame at all and the ring continues when the tab is seen again", () => {
    render(<VoiceRingCanvas mood="think" size={40} active />);
    advance(100);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    advance(50);
    const held = frames();
    advance(1500);
    expect(frames()).toBe(held);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    advance(200);
    expect(frames()).toBeGreaterThan(held + 5);
  });

  it("is a canvas of exactly its size, decorative, and stops cleanly on unmount", () => {
    const { container, unmount } = render(<VoiceRingCanvas mood="active" size={52} active />);
    const canvas = container.querySelector("canvas")!;
    expect(canvas.style.width).toBe("52px");
    expect(canvas.style.height).toBe("52px");
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveAttribute("data-orb-canvas");
    unmount();
    const stopped = frames();
    advance(500);
    expect(frames()).toBe(stopped);
  });
});
