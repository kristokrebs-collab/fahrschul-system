/**
 * `@/motion/fx` (P01): pure helpers, reduced-motion end states, zero React renders while running, finite / sleeping
 * loops (also off screen) and no blur under `html[data-safe-fx]`.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { motionValue } from "motion/react";
import { readFileSync } from "node:fs";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));
const celebrate = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/motion/Celebrate", async (orig) => ({
  ...(await orig<typeof import("@/motion/Celebrate")>()),
  celebrateFrom: (...args: unknown[]) => void celebrate.calls.push(args),
}));

import { glyphFor, textFrame } from "@/motion/DotMatrix";
import { BreakoutStreak, BREAKOUT_STREAK, streakAt, streakDuration, streakParticles } from "@/motion/fx/BreakoutStreak";
import { celebrateRecord, celebrateStreak, STREAK_ECHO_FROM } from "@/motion/fx/celebrate";
import { CoachStream, streamCount, streamPace } from "@/motion/fx/CoachStream";
import { ConfidenceMeter, confidenceFrame, confidenceTone } from "@/motion/fx/ConfidenceMeter";
import { easeInOutCubic, expApproach, monotoneCurve, progressIn, smoothstep } from "@/motion/fx/curve";
import { DISSOLVE, DissolveOut, dissolveGrid, dissolveOrder, dissolvePath } from "@/motion/fx/DissolveOut";
import { DotMatrixText, matrixText } from "@/motion/fx/DotMatrixText";
import { EquityDraw, equityPoints, pointAt } from "@/motion/fx/EquityDraw";
import { GlowBreak } from "@/motion/fx/GlowBreak";
import { HeatGridReveal, heatColor, heatDelay } from "@/motion/fx/HeatGridReveal";
import { LiquidGauge, waveDecay, waveKick } from "@/motion/fx/LiquidGauge";
import { NumberCascade, lockAt, rainDigit } from "@/motion/fx/NumberCascade";
import { RadarSweep } from "@/motion/fx/RadarSweep";
import { SplitFlap, flapChars, flapDirection } from "@/motion/fx/SplitFlap";
import { SpotlightSweep } from "@/motion/fx/SpotlightSweep";
import * as fxBarrel from "@/motion/fx";
import { resetInViewObserverForTests } from "@/motion/inView";
import { stagger, tween } from "@/motion/tokens";

const FAKE: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] };

/** WAAPI stub: jsdom has no `Element.animate`; records every started animation. */
function stubAnimate() {
  const calls: { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  const proto = HTMLElement.prototype as unknown as { animate?: unknown };
  const had = Object.prototype.hasOwnProperty.call(proto, "animate");
  const prev = proto.animate;
  proto.animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    calls.push({ el: this, keyframes, options });
    return { cancel() {}, play() {}, onfinish: null, currentTime: 0 } as unknown as Animation;
  };
  return {
    calls,
    restore() {
      if (had) proto.animate = prev;
      else delete proto.animate;
    },
  };
}

/** Controllable IntersectionObserver for the shared observer (`inView.ts`). */
function installIO(initial = true) {
  const targets = new Set<Element>();
  let cb: IntersectionObserverCallback | null = null;
  class IO {
    constructor(c: IntersectionObserverCallback) {
      cb = c;
    }
    observe(el: Element) {
      targets.add(el);
      queueMicrotask(() => cb?.([{ isIntersecting: initial, target: el } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }
    unobserve(el: Element) {
      targets.delete(el);
    }
    disconnect() {
      targets.clear();
    }
    takeRecords() {
      return [];
    }
  }
  const prev = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = IO as unknown as typeof IntersectionObserver;
  resetInViewObserverForTests();
  return {
    report(visible: boolean) {
      for (const t of targets) cb?.([{ isIntersecting: visible, target: t } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    },
    restore() {
      globalThis.IntersectionObserver = prev;
      resetInViewObserverForTests();
    },
  };
}

beforeEach(() => {
  fx.reduced = false;
});
afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-safe-fx");
});

/* ------------------------------------------------------------------ tokens + barrel */

describe("tokens (P01)", () => {
  it("adds finite fx timings; only the scan loop repeats forever (declared exception) and its CSS mirror matches", () => {
    expect(tween.glow.repeat).toBe(2);
    expect(tween.scan.repeat).toBe(Infinity);
    for (const t of [tween.sweep, tween.streak, tween.heat, tween.cascade, tween.dissolve, tween.wave]) {
      expect(t.duration).toBeGreaterThan(0);
      expect("repeat" in t).toBe(false);
    }
    expect(stagger.heat * 30).toBeGreaterThan(stagger.heatMax); // the cap matters for big grids
    const css = readFileSync("src/styles/tokens.css", "utf8");
    expect(css).toContain(`animation: fx-spin ${tween.scan.duration}s linear infinite`);
    expect(css).toContain(`animation: fx-scan ${tween.scan.duration}s linear infinite`);
    expect(css).toMatch(/\[data-scanning\]:not\(\[data-offscreen\]\) \.fx-radar__sweep/);
  });

  it("the barrel exports every effect", () => {
    for (const name of ["GlowBreak", "BreakoutStreak", "RadarSweep", "LiquidGauge", "EquityDraw", "HeatGridReveal", "SplitFlap", "CoachStream", "ConfidenceMeter", "NumberCascade", "DissolveOut", "SpotlightSweep", "celebrateStreak", "celebrateRecord", "DotMatrixText"]) {
      expect(fxBarrel).toHaveProperty(name);
    }
  });
});

describe("curve helpers", () => {
  it("monotone curve passes its keys without overshoot", () => {
    const f = monotoneCurve([
      [0, 0],
      [0.5, 0.1],
      [0.8, 0.9],
      [1, 1],
    ]);
    expect(f(-1)).toBe(0);
    expect(f(0.5)).toBeCloseTo(0.1);
    expect(f(2)).toBe(1);
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.01) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y).toBeLessThanOrEqual(1 + 1e-9);
      prev = y;
    }
  });

  it("exp approach, smoothstep, progress and ease", () => {
    expect(expApproach(1, 2, 5, 10)).toBe(0);
    expect(expApproach(3, 2, 5, 10)).toBeCloseTo(10 * (1 - Math.exp(-5)));
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(progressIn(1, 3, 2)).toBe(0.5);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });
});

/* ------------------------------------------------------------------ DotMatrix glyphs + DotMatrixText */

describe("DotMatrix glyphs and DotMatrixText", () => {
  it("knows '/', the upper-case letters and the arrows; lower case stays blank", () => {
    const blank = JSON.stringify(glyphFor(" "));
    for (const ch of ["/", "A", "P", "R", "O", "Z", "↑", "↓", "!", "?"]) {
      const g = glyphFor(ch);
      expect(g).toHaveLength(7);
      expect(JSON.stringify(g)).not.toBe(blank);
      expect(g.flat().some((v) => v === 1)).toBe(true);
    }
    expect(JSON.stringify(glyphFor("x"))).toBe(blank);
    expect(textFrame("1/5")[0]).toHaveLength(5 + 1 + 3 + 1 + 5);
  });

  it("matrixText upper-cases and pads for a fixed grid", () => {
    expect(matrixText("a+")).toBe("A+");
    expect(matrixText("5", 3)).toBe("  5");
    expect(matrixText("5", 3, "left")).toBe("5  ");
  });

  it("is an image with its text as the name, or decorative; the preset rests after its cycles", () => {
    vi.useFakeTimers(FAKE);
    const { rerender } = render(<DotMatrixText text="A+" preset="chevrons" cycles={1} />);
    const img = screen.getByRole("img", { name: "A+" });
    expect(img.querySelectorAll("[data-matrix]")).toHaveLength(2);
    expect(img.querySelector('[data-matrix="chevrons"]')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(2000));
    rerender(<DotMatrixText text="3/4" decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(document.querySelector('[data-fx="dot-matrix-text"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("reduced motion: activity glyphs (wave, snake) are dropped, a direction (chevrons) stays", () => {
    fx.reduced = true;
    const { container, rerender } = render(<DotMatrixText text="SCAN" preset="wave" />);
    expect(container.querySelectorAll("[data-matrix]")).toHaveLength(1);
    rerender(<DotMatrixText text="A+" preset="chevrons" />);
    expect(container.querySelector('[data-matrix="chevrons"]')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ GlowBreak */

describe("GlowBreak", () => {
  it("breathes 3× and pings finite rings (WAAPI, aria-hidden)", () => {
    const anim = stubAnimate();
    try {
      const { container, rerender } = render(<GlowBreak x={40} y={20} tone="loss" rings={2} />);
      const root = container.querySelector('[data-fx="glow-break"]')!;
      expect(root).toHaveAttribute("aria-hidden", "true");
      expect(root).toHaveAttribute("data-tone", "loss");
      expect(anim.calls).toHaveLength(3); // halo + 2 rings
      for (const c of anim.calls) {
        expect(Number.isFinite(c.options.iterations)).toBe(true);
        expect(c.options.iterations).toBe(3);
        for (const k of c.keyframes) expect(Object.keys(k).filter((p) => p !== "offset").every((p) => p === "opacity" || p === "transform")).toBe(true);
      }
      rerender(<GlowBreak x={40} y={20} tone="loss" rings={2} play={1} />);
      expect(anim.calls).toHaveLength(6);
    } finally {
      anim.restore();
    }
  });

  it("reduced motion: the resting glow, no rings, nothing animates", () => {
    fx.reduced = true;
    const anim = stubAnimate();
    try {
      const { container } = render(<GlowBreak tone="win" />);
      expect(anim.calls).toHaveLength(0);
      expect(container.querySelectorAll(".rounded-full.opacity-0")).toHaveLength(0);
    } finally {
      anim.restore();
    }
  });
});

/* ------------------------------------------------------------------ BreakoutStreak */

describe("BreakoutStreak", () => {
  it("particles: at most 40, deterministic, launched in order, travelling in the breakout direction", () => {
    expect(streakParticles(100)).toHaveLength(BREAKOUT_STREAK.maxParticles);
    expect(streakParticles(12, 3)).toEqual(streakParticles(12, 3));
    const ps = streakParticles(24, 9);
    const p = ps[0]!;
    expect(streakAt(p, p.delay - 0.01, "up", 200, 100)).toBeNull();
    expect(streakAt(p, p.delay + p.life + 0.01, "up", 200, 100)).toBeNull();
    const a = streakAt(p, p.delay + p.life * 0.2, "up", 200, 100)!;
    const b = streakAt(p, p.delay + p.life * 0.6, "up", 200, 100)!;
    expect(b.y).toBeLessThan(a.y);
    const r1 = streakAt(p, p.delay + p.life * 0.2, "right", 200, 100)!;
    const r2 = streakAt(p, p.delay + p.life * 0.6, "right", 200, 100)!;
    expect(r2.x).toBeGreaterThan(r1.x);
    expect(streakDuration(ps)).toBeLessThan(2);
  });

  it("draws on one canvas and stops after the burst (finite loop, no React renders)", () => {
    vi.useFakeTimers(FAKE);
    const ctx = { setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), strokeStyle: "", lineWidth: 1, lineCap: "", lineJoin: "", globalAlpha: 1 };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const onDone = vi.fn();
    let commits = 0;
    try {
      render(
        <Profiler id="streak" onRender={() => commits++}>
          <div style={{ position: "relative", width: 200, height: 100 }}>
            <BreakoutStreak direction="up" count={10} onDone={onDone} />
          </div>
        </Profiler>,
      );
      const mounted = commits;
      act(() => void vi.advanceTimersByTime(400));
      expect(ctx.stroke).toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(3000));
      expect(onDone).toHaveBeenCalledTimes(1);
      const strokes = ctx.stroke.mock.calls.length;
      act(() => void vi.advanceTimersByTime(1000));
      expect(ctx.stroke.mock.calls.length).toBe(strokes); // asleep
      expect(commits).toBe(mounted);
    } finally {
      spy.mockRestore();
    }
  });

  it("reduced motion: no canvas at all", () => {
    fx.reduced = true;
    const { container } = render(<BreakoutStreak />);
    expect(container.querySelector("canvas")).toBeNull();
  });
});

/* ------------------------------------------------------------------ RadarSweep */

describe("RadarSweep", () => {
  it("scans only while active, labelled as an image when named", () => {
    const { rerender } = render(<RadarSweep active={false} label="Scan pausiert" />);
    const radar = screen.getByRole("img", { name: "Scan pausiert" });
    expect(radar).not.toHaveAttribute("data-scanning");
    rerender(<RadarSweep active label="Scan läuft" />);
    expect(screen.getByRole("img", { name: "Scan läuft" })).toHaveAttribute("data-scanning");
    rerender(<RadarSweep active variant="band" />);
    const band = document.querySelector('[data-variant="band"]')!;
    expect(band).toHaveAttribute("aria-hidden", "true");
    expect(band).toHaveAttribute("data-scanning");
    expect(band.querySelector(".fx-scan__band")).not.toBeNull();
  });

  it("pauses off screen", async () => {
    const io = installIO(true);
    try {
      render(<RadarSweep active label="Scan" />);
      const radar = screen.getByRole("img", { name: "Scan" });
      await act(async () => {
        await Promise.resolve();
      });
      expect(radar).not.toHaveAttribute("data-offscreen");
      act(() => io.report(false));
      expect(radar).toHaveAttribute("data-offscreen");
    } finally {
      io.restore();
    }
  });

  it("reduced motion: never scans (static wedge)", () => {
    fx.reduced = true;
    render(<RadarSweep active label="Scan" />);
    expect(screen.getByRole("img", { name: "Scan" })).not.toHaveAttribute("data-scanning");
    expect(document.querySelector(".fx-radar__blip")).toBeNull();
  });
});

/* ------------------------------------------------------------------ LiquidGauge */

describe("LiquidGauge", () => {
  it("wave kick / decay are bounded and decay to flat within tween.wave", () => {
    expect(waveKick(0, 0.05)).toBeGreaterThan(0.35);
    expect(waveKick(0.9, 1)).toBe(1);
    expect(waveDecay(1, tween.wave.duration)).toBeLessThan(0.02);
  });

  it("is a meter; a change sloshes, then the loop sleeps at the exact level (no React renders)", () => {
    vi.useFakeTimers(FAKE);
    const level = motionValue(0.2);
    let commits = 0;
    const { container } = render(
      <Profiler id="liquid" onRender={() => commits++}>
        <LiquidGauge value={level} label="Tageslimit" />
      </Profiler>,
    );
    const meter = screen.getByRole("meter", { name: "Tageslimit" });
    expect(meter).toHaveAttribute("aria-valuenow", "20");
    const mounted = commits;
    act(() => level.set(0.9));
    expect(meter).toHaveAttribute("aria-valuenow", "90");
    const fill = container.querySelector('[data-fx="liquid-gauge"] > div') as HTMLElement;
    act(() => void vi.advanceTimersByTime(120));
    expect(fill.style.transform).not.toBe("translate3d(0,10.000%,0)"); // still moving
    act(() => void vi.advanceTimersByTime(4000));
    expect(fill.style.transform).toBe("translate3d(0,10.000%,0)");
    expect(meter).toHaveAttribute("data-danger");
    const t = fill.style.transform;
    act(() => void vi.advanceTimersByTime(500));
    expect(fill.style.transform).toBe(t);
    expect(commits).toBe(mounted);
  });

  it("reduced motion: the level jumps, no wave", () => {
    fx.reduced = true;
    const { container, rerender } = render(<LiquidGauge value={0.3} label="Limit" danger={null} />);
    rerender(<LiquidGauge value={0.5} label="Limit" danger={null} />);
    const fill = container.querySelector('[data-fx="liquid-gauge"] > div') as HTMLElement;
    expect(fill.style.transform).toBe("translate3d(0,50.000%,0)");
    for (const svg of container.querySelectorAll("svg")) expect((svg as unknown as HTMLElement).style.transform).toContain("scaleY(0");
  });
});

/* ------------------------------------------------------------------ EquityDraw */

describe("EquityDraw", () => {
  it("points span the box and pointAt interpolates", () => {
    const pts = equityPoints([10, 20, 15], 108, 58, 4);
    expect(pts[0]).toEqual({ x: 4, y: 54 });
    expect(pts[1]).toEqual({ x: 54, y: 4 });
    expect(pointAt(pts, 29).y).toBeCloseTo(29);
    expect(pointAt(pts, -5)).toEqual(pts[0]);
  });

  it("an external progress drives clip + head without React renders", () => {
    const p = motionValue(0);
    let commits = 0;
    const { container } = render(
      <Profiler id="eq" onRender={() => commits++}>
        <EquityDraw values={[1, 3, 2, 5]} progress={p} label="Kontostand" />
      </Profiler>,
    );
    expect(screen.getByRole("img", { name: "Kontostand" })).toHaveAttribute("data-tone", "win");
    const clip = container.querySelector('[data-fx="equity-draw"] > div') as HTMLElement;
    expect(clip.style.clipPath).toBe("inset(0 100% 0 0)");
    const mounted = commits;
    act(() => p.set(0.5));
    expect(clip.style.clipPath).toMatch(/^inset\(-20px [\d.]+px -20px -20px\)$/);
    act(() => p.set(1));
    expect(clip.style.clipPath).toBe("none");
    expect(commits).toBe(mounted);
  });

  it("reduced motion: fully drawn at once; safe-fx: no glow filter", () => {
    fx.reduced = true;
    document.documentElement.setAttribute("data-safe-fx", "");
    const { container } = render(<EquityDraw values={[5, 3, 1]} label="Verlauf" />);
    expect(screen.getByRole("img", { name: "Verlauf" })).toHaveAttribute("data-tone", "loss");
    expect((container.querySelector('[data-fx="equity-draw"] > div') as HTMLElement).style.clipPath).toBe("none");
    for (const path of container.querySelectorAll("path")) expect((path as unknown as HTMLElement).style.filter).toBe("");
  });
});

/* ------------------------------------------------------------------ HeatGridReveal */

describe("HeatGridReveal", () => {
  it("delays grow with the ring distance from the origin and are capped", () => {
    expect(heatDelay(0, 5, 0)).toBe(0);
    expect(heatDelay(6, 5, 0)).toBeCloseTo(stagger.heat); // (1,1) → ring 1
    expect(heatDelay(7, 5, [1, 2])).toBe(0);
    expect(heatDelay(899, 30, 0)).toBe(stagger.heatMax);
    expect(heatColor(1)).toContain("var(--color-win)");
    expect(heatColor(-0.5)).toContain("var(--color-loss)");
    expect(heatColor(0.5, "signal")).toContain("var(--color-signal)");
  });

  it("lays out the cells in `cols` columns; reduced motion: a static, visible grid", () => {
    fx.reduced = true;
    const { container } = render(
      <HeatGridReveal cols={3} origin={4} aria-label="Matrix" role="img">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i}>{i}</span>
        ))}
      </HeatGridReveal>,
    );
    const grid = screen.getByRole("img", { name: "Matrix" });
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(grid.children).toHaveLength(9);
    for (const cell of container.querySelectorAll('[data-fx="heat-grid"] > div')) expect((cell as HTMLElement).style.opacity).toBe("");
  });

  it("cascades on view; the cells end at transform none", async () => {
    const { container } = render(
      <HeatGridReveal cols={2}>
        {[1, 2, 3, 4].map((i) => (
          <span key={i}>{i}</span>
        ))}
      </HeatGridReveal>,
    );
    const grid = container.querySelector('[data-fx="heat-grid"]')!;
    expect(grid.getAttribute("data-run")).toBe("1");
    await vi.waitFor(() => {
      for (const cell of grid.children) expect((cell as HTMLElement).style.transform).toBe("none");
    });
  });
});

/* ------------------------------------------------------------------ SplitFlap */

describe("SplitFlap", () => {
  it("rolls up for later values, down for earlier ones", () => {
    const order = ["Tag", "Woche", "Monat"];
    expect(flapDirection("Tag", "Monat", order)).toBe("up");
    expect(flapDirection("Monat", "Woche", order)).toBe("down");
    expect(flapDirection("x", "y")).toBe("up");
    expect(flapChars("Q3", 4, "right")).toEqual([" ", " ", "Q", "3"]);
  });

  it("keeps the exact label accessible (single tile and tiles mode)", () => {
    const { rerender, container } = render(<SplitFlap text="Woche" />);
    expect(container.textContent).toContain("Woche");
    rerender(<SplitFlap text="Q3 2026" tiles minChars={8} />);
    expect(container.querySelector(".sr-only")?.textContent).toBe("Q3 2026");
    expect(container.querySelector('[data-tiles] > [aria-hidden="true"]')!.children).toHaveLength(8);
  });
});

/* ------------------------------------------------------------------ CoachStream */

describe("CoachStream", () => {
  it("pace shrinks for long chunks; counts from the chunk start", () => {
    expect(streamPace(10)).toBe(65);
    expect(streamPace(1000)).toBeLessThan(10);
    expect(streamCount(0, 5, 20, 65)).toBe(6);
    expect(streamCount(10_000, 5, 20, 65)).toBe(20);
  });

  it("types from the clock, continues (never restarts) when the text grows, full text sr-only", () => {
    vi.useFakeTimers(FAKE);
    const onCaughtUp = vi.fn();
    const { container, rerender } = render(<CoachStream text="Hallo Trader" onCaughtUp={onCaughtUp} />);
    const typed = () => container.querySelector('[data-fx="coach-stream"] > span[aria-hidden] > span')!.textContent;
    expect(container.querySelector(".sr-only")?.textContent).toBe("Hallo Trader");
    act(() => void vi.advanceTimersByTime(200));
    const mid = typed()!;
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.length).toBeLessThan(12);
    rerender(<CoachStream text="Hallo Trader, heute nur A+." onCaughtUp={onCaughtUp} />);
    expect(typed()!.length).toBeGreaterThanOrEqual(mid.length);
    act(() => void vi.advanceTimersByTime(5000));
    expect(typed()).toBe("Hallo Trader, heute nur A+.");
    expect(onCaughtUp).toHaveBeenCalled();
    expect(container.querySelector('[data-fx="coach-stream"]')).toHaveAttribute("data-caught-up");
  });

  it("thinking shows the shimmer label; reduced motion and `instant` show the full text at once", () => {
    const { rerender, container } = render(<CoachStream text="" thinking />);
    expect(screen.getByText("Coach denkt …")).toBeInTheDocument();
    fx.reduced = true;
    rerender(<CoachStream text="Fertig." />);
    expect(container.querySelector('[data-fx="coach-stream"] > span[aria-hidden] > span')!.textContent).toBe("Fertig.");
  });
});

/* ------------------------------------------------------------------ ConfidenceMeter */

describe("ConfidenceMeter", () => {
  it("lights the ramp by value and stays quiet below 40", () => {
    const f = confidenceFrame(50, 5, 10);
    const lit = (c: number) => f.some((row) => (row[c] ?? 0) > 0);
    expect(lit(4)).toBe(true);
    expect(lit(5)).toBe(false);
    expect(confidenceTone(80)).toBe("win");
    expect(confidenceTone(50)).toBe("fg");
    expect(confidenceTone(10)).toBe("mute");
  });

  it("is a meter with the value", () => {
    render(<ConfidenceMeter value={82.4} label="Sweep London" />);
    const m = screen.getByRole("meter", { name: "Sweep London" });
    expect(m).toHaveAttribute("aria-valuenow", "82");
    expect(m).toHaveAttribute("data-tone", "win");
  });
});

/* ------------------------------------------------------------------ NumberCascade */

describe("NumberCascade", () => {
  it("locks most significant first; rain digits are deterministic", () => {
    expect(lockAt(0, 4)).toBeLessThan(lockAt(3, 4));
    expect(lockAt(3, 4)).toBe(1);
    expect(rainDigit(7, 1, 2)).toBe(rainDigit(7, 1, 2));
    for (let s = 0; s < 50; s++) expect(rainDigit(3, s % 4, s)).toBeGreaterThanOrEqual(0);
  });

  it("rains, then lands exactly on the formatted value – without React renders", () => {
    vi.useFakeTimers(FAKE);
    let commits = 0;
    const { container } = render(
      <Profiler id="cascade" onRender={() => commits++}>
        <NumberCascade value={12480.5} decimals={2} suffix=" USDT" />
      </Profiler>,
    );
    const final = "12.480,50 USDT";
    expect(container.querySelector(".sr-only")?.textContent).toBe(final);
    const root = container.querySelector('[data-fx="number-cascade"]')!;
    const visual = () => root.querySelector('[aria-hidden="true"]')!.textContent;
    const mounted = commits;
    act(() => void vi.advanceTimersByTime(300));
    expect(root).toHaveAttribute("data-raining");
    act(() => void vi.advanceTimersByTime(tween.cascade.duration * 1000 + 200));
    expect(visual()).toBe(final);
    expect(root).not.toHaveAttribute("data-raining");
    expect(commits).toBe(mounted);
  });

  it("reduced motion: the final value at once", () => {
    fx.reduced = true;
    const { container } = render(<NumberCascade value={0.8} decimals={1} suffix=" %" />);
    expect(container.querySelector('[data-fx="number-cascade"] [aria-hidden="true"]')!.textContent).toBe("0,8 %");
  });
});

/* ------------------------------------------------------------------ DissolveOut */

describe("DissolveOut", () => {
  it("grid stays below the cell cap; order is a permutation; the path shrinks", () => {
    const g = dissolveGrid(1200, 800);
    expect(g.cols * g.rows).toBeLessThanOrEqual(DISSOLVE.maxCells);
    const order = dissolveOrder(12, 4);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(dissolvePath(order, 0, 4, 3, 10)).toBe("M0 0h40v10h-40zM0 10h40v10h-40zM0 20h40v10h-40z");
    expect(dissolvePath(order, 12, 4, 3, 10)).toBe("M0 0z");
  });

  it("steps the pixel clip, sinks and calls onDone after tween.dissolve", async () => {
    vi.useFakeTimers(FAKE);
    const onDone = vi.fn();
    const { rerender } = render(
      <DissolveOut active={false} onDone={onDone}>
        <span>Trade</span>
      </DissolveOut>,
    );
    rerender(
      <DissolveOut active onDone={onDone}>
        <span>Trade</span>
      </DissolveOut>,
    );
    const el = document.querySelector('[data-fx="dissolve"]') as HTMLElement;
    act(() => void vi.advanceTimersByTime((tween.dissolve.duration * 1000) / 2));
    expect(el.style.clipPath).toMatch(/^path\("/);
    expect(el.style.transform).toMatch(/translateY/);
    await act(async () => {
      vi.advanceTimersByTime(tween.dissolve.duration * 1000);
      await Promise.resolve();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(el.style.opacity).toBe("0");
  });

  it("reduced motion: a plain fade, then onDone", async () => {
    fx.reduced = true;
    const onDone = vi.fn();
    const { rerender } = render(
      <DissolveOut active={false} onDone={onDone}>
        <span>Trade</span>
      </DissolveOut>,
    );
    rerender(
      <DissolveOut active onDone={onDone}>
        <span>Trade</span>
      </DissolveOut>,
    );
    expect(document.querySelector('[data-fx="dissolve"]')).toHaveAttribute("aria-hidden", "true");
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});

/* ------------------------------------------------------------------ SpotlightSweep */

describe("SpotlightSweep", () => {
  it("one transform/opacity pass per play; reduced motion renders nothing", () => {
    const anim = stubAnimate();
    try {
      const { rerender, container } = render(<SpotlightSweep play={0} playOnView={false} />);
      expect(anim.calls).toHaveLength(0);
      rerender(<SpotlightSweep play={1} playOnView={false} />);
      expect(anim.calls).toHaveLength(1);
      expect(anim.calls[0]!.options.iterations).toBe(1);
      expect(container.querySelector('[data-fx="spotlight-sweep"]')).toHaveAttribute("aria-hidden", "true");
      fx.reduced = true;
      rerender(<SpotlightSweep play={2} playOnView={false} />);
      expect(container.querySelector('[data-fx="spotlight-sweep"]')).toBeNull();
    } finally {
      anim.restore();
    }
  });
});

/* ------------------------------------------------------------------ Celebrate presets */

describe("celebrate presets", () => {
  beforeEach(() => {
    celebrate.calls.length = 0;
  });

  it("streak: one streak burst, an echo from STREAK_ECHO_FROM; record: red-dot burst + echo", () => {
    vi.useFakeTimers(FAKE);
    const el = document.createElement("button");
    celebrateStreak(el, { streak: 2 });
    act(() => void vi.advanceTimersByTime(500));
    expect(celebrate.calls).toHaveLength(1);
    expect(celebrate.calls[0]![1]).toMatchObject({ kind: "streak", tone: "win" });
    celebrate.calls.length = 0;
    celebrateStreak(el, { streak: STREAK_ECHO_FROM });
    act(() => void vi.advanceTimersByTime(500));
    expect(celebrate.calls).toHaveLength(2);
    celebrate.calls.length = 0;
    celebrateRecord(el);
    act(() => void vi.advanceTimersByTime(500));
    expect(celebrate.calls.map((c) => (c[1] as { kind: string }).kind)).toEqual(["record", "win"]);
  });

  it("reduced motion: no follow-up bursts", () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
    vi.useFakeTimers(FAKE);
    try {
      celebrateRecord(document.body);
      act(() => void vi.advanceTimersByTime(500));
      expect(celebrate.calls).toHaveLength(1);
    } finally {
      window.matchMedia = mm;
    }
  });
});

/* ------------------------------------------------------------------ keyboard-free a11y guard */

describe("no live regions", () => {
  it("no fx renders aria-live", () => {
    render(
      <div>
        <RadarSweep active label="Scan" />
        <CoachStream text="Hallo" />
        <NumberCascade value={3} />
        <ConfidenceMeter value={50} />
        <LiquidGauge value={0.4} label="Limit" />
      </div>,
    );
    expect(document.querySelector("[aria-live]")).toBeNull();
    fireEvent.click(document.body);
  });
});
