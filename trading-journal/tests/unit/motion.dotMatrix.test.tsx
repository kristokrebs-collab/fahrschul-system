import { render, screen, waitFor } from "@testing-library/react";
import { motionValue } from "motion/react";
import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIGIT_GLYPHS,
  DotMatrix,
  LOADER_FRAMES,
  METER_BASELINE,
  PULSE_FRAMES,
  SNAKE_FRAMES,
  WAVE_FRAMES,
  approach,
  chevronFrames,
  frameIndexAt,
  glowOf,
  glyphFor,
  meterColumn,
  meterFrame,
  normalizeFrame,
  signedMeterColumn,
  textFrame,
  type Frame,
} from "@/motion/DotMatrix";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

afterEach(() => {
  fx.reduced = false;
});

const dims = (f: Frame) => [f.length, ...new Set(f.map((r) => r.length))];
const litMask = (f: Frame) => f.map((r) => r.map((v) => (v > 0 ? 1 : 0)));
const onCircles = (root: HTMLElement) => Array.from(root.querySelectorAll("svg > g:last-of-type > circle"));
const opacities = (root: HTMLElement) => onCircles(root).map((c) => Number(c.getAttribute("opacity")));
const q = (f: Frame) => f.flat().map((v) => Math.round(v * 100) / 100);

describe("DotMatrix frame generators", () => {
  it("keeps the original 5 × 7 digit glyphs", () => {
    expect(DIGIT_GLYPHS).toHaveLength(10);
    for (const g of DIGIT_GLYPHS) expect(dims(g)).toEqual([7, 5]);
    expect(DIGIT_GLYPHS[1]?.[0]).toEqual([0, 0, 1, 0, 0]);
    expect(DIGIT_GLYPHS[8]?.[3]).toEqual([0, 1, 1, 1, 0]);
  });

  it("composes text frames with one blank column between glyphs", () => {
    const f = textFrame("12");
    expect(dims(f)).toEqual([7, 11]);
    expect(f.map((r) => r.slice(0, 5))).toEqual(DIGIT_GLYPHS[1]);
    expect(f.map((r) => r[5])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(f.map((r) => r.slice(6))).toEqual(DIGIT_GLYPHS[2]);
    expect(dims(textFrame("-1.5"))).toEqual([7, 3 + 1 + 5 + 1 + 1 + 1 + 5]);
    expect(textFrame("−")).toEqual(textFrame("-"));
    expect(glyphFor("x")).toEqual(glyphFor(" "));
    expect(textFrame("")).toEqual([[], [], [], [], [], [], []]);
  });

  it("generates the animated presets with the original frame counts", () => {
    expect(LOADER_FRAMES).toHaveLength(12);
    expect(PULSE_FRAMES).toHaveLength(16);
    expect(WAVE_FRAMES).toHaveLength(24);
    expect(SNAKE_FRAMES).toHaveLength(49);
    for (const f of [...LOADER_FRAMES, ...PULSE_FRAMES, ...WAVE_FRAMES, ...SNAKE_FRAMES]) expect(dims(f)).toEqual([7, 7]);
  });

  it("loader: 8 trailing dots, head at full brightness, tail never below .2", () => {
    for (const f of LOADER_FRAMES) {
      const lit = f.flat().filter((v) => v > 0);
      expect(lit.length).toBeGreaterThan(4);
      expect(lit.length).toBeLessThanOrEqual(8);
      expect(Math.min(...lit)).toBeGreaterThanOrEqual(0.2);
    }
    expect(Math.max(...(LOADER_FRAMES[0]?.flat() ?? []))).toBe(1);
  });

  it("pulse keeps the centre lit and wave lights every column", () => {
    for (const f of PULSE_FRAMES) expect(f[3]?.[3]).toBe(1);
    for (const f of WAVE_FRAMES) for (let c = 0; c < 7; c++) expect(Math.max(...f.map((r) => r[c] ?? 0))).toBe(1);
  });

  it("snake spirals in with a 5-cell fading tail", () => {
    expect(SNAKE_FRAMES[0]?.[0]?.[0]).toBe(1);
    expect(SNAKE_FRAMES[0]?.flat().filter((v) => v > 0)).toHaveLength(1);
    const f4 = SNAKE_FRAMES[4] as Frame;
    expect(f4.flat().filter((v) => v > 0).sort()).toEqual([0.2, 0.4, 0.6, 0.8, 1].map((v) => expect.closeTo(v, 5)));
    expect(f4[0]?.slice(0, 5)).toEqual([expect.closeTo(0.2, 5), expect.closeTo(0.4, 5), expect.closeTo(0.6, 5), expect.closeTo(0.8, 5), 1]);
  });

  it("chevrons march one column per frame in their direction", () => {
    const right = chevronFrames(1, 9);
    const left = chevronFrames(-1, 9);
    expect(right).toHaveLength(4);
    for (const f of right) expect(dims(f)).toEqual([5, 9]);
    const shift = (m: number[][], by: number) => m.map((r) => r.map((_, c) => r[(c - by + r.length * 4) % r.length] ?? 0));
    // with a 4-column period on 9 columns compare the interior only
    const inner = (m: number[][]) => m.map((r) => r.slice(1, 8));
    expect(inner(litMask(right[1] as Frame))).toEqual(inner(shift(litMask(right[0] as Frame), 1)));
    expect(inner(litMask(left[1] as Frame))).toEqual(inner(shift(litMask(left[0] as Frame), -1)));
    // `›` points right: the middle row is the right-most cell of each chevron
    expect(right[0]?.map((r) => r[2])).toEqual([0, 0, expect.any(Number), 0, 0]);
    expect(right[0]?.[2]?.[2]).toBeGreaterThan(0);
  });

  it("maps elapsed time to frame indices without drift", () => {
    expect(frameIndexAt(0, 12, 10)).toBe(0);
    expect(frameIndexAt(500, 12, 12)).toBe(6);
    expect(frameIndexAt(1000, 12, 12)).toBe(0);
    expect(frameIndexAt(10_000, 12, 12, false)).toBe(11);
    expect(frameIndexAt(500, 12, 1)).toBe(0);
    expect(frameIndexAt(500, 0, 12)).toBe(0);
  });

  it("normalizes frames to the grid and clamps values", () => {
    expect(normalizeFrame([[2, -1, Number.NaN]], 2, 4)).toEqual([
      [1, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
  });
});

describe("DotMatrix meter", () => {
  it("lights an unsigned VU column from the bottom with the original brightness tiers", () => {
    expect(meterColumn(0, 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(meterColumn(1, 7)).toEqual([1, 1, 1, 0.8, 0.8, 0.6, 0.6]);
    const half = meterColumn(0.5, 7); // 3.5 cells lit → the 4th from the bottom is half bright
    expect(half.slice(4)).toEqual([0.8, 0.6, 0.6]);
    expect(half[3]).toBeCloseTo(0.4);
    expect(half.slice(0, 3)).toEqual([0, 0, 0]);
    expect(meterColumn(7, 7)).toEqual(meterColumn(1, 7));
  });

  it("mirrors a signed column around the centre baseline", () => {
    const up = signedMeterColumn(1, 7);
    expect(up[3]).toBe(METER_BASELINE);
    expect(up.slice(0, 3).every((v) => v > 0)).toBe(true);
    expect(up.slice(4)).toEqual([0, 0, 0]);
    const down = signedMeterColumn(-0.5, 7); // 1.5 of 3 cells below the centre
    expect(down.slice(0, 3)).toEqual([0, 0, 0]);
    expect(down[4]).toBeCloseTo(0.7);
    expect(down[5]).toBeCloseTo(0.425);
    expect(down[6]).toBe(0);
    expect(signedMeterColumn(Number.NaN, 7)).toEqual([0, 0, 0, METER_BASELINE, 0, 0, 0]);
  });

  it("builds a row-major meter frame, one column per level", () => {
    const f = meterFrame([0, 1, 0.5], 7);
    expect(dims(f)).toEqual([7, 3]);
    expect(f.map((r) => r[1])).toEqual(meterColumn(1, 7));
    expect(f.map((r) => r[0])).toEqual(meterColumn(0, 7));
  });

  it("phosphor rises fast and decays slowly, snapping when close", () => {
    expect(approach(0, 1, 16)).toBeCloseTo(1 - Math.exp(-16 / 40));
    expect(approach(1, 0, 16)).toBeCloseTo(Math.exp(-16 / 120));
    expect(approach(0.999, 1, 16)).toBe(1);
    expect(approach(0.5, 0.5, 16)).toBe(0.5);
    expect(glowOf(0.4)).toBe(0);
    expect(glowOf(1)).toBe(1);
    expect(glowOf(0.75)).toBeCloseTo(0.5);
  });
});

describe("<DotMatrix>", () => {
  it("renders a static glyph with a static label and no live region", () => {
    const { container } = render(<DotMatrix text="7" label="Sieben" />);
    const img = screen.getByRole("img", { name: "Sieben" });
    expect(img).not.toHaveAttribute("aria-live");
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelectorAll("circle")).toHaveLength(35 * 3);
    expect(opacities(img)).toEqual(q(DIGIT_GLYPHS[7] as Frame));
  });

  it("is decorative without a label and uses per-instance gradient/filter ids", () => {
    const { container } = render(
      <>
        <DotMatrix preset="loader" />
        <DotMatrix preset="pulse" />
      </>,
    );
    const roots = container.querySelectorAll("[data-matrix]");
    expect(roots).toHaveLength(2);
    for (const r of roots) expect(r).toHaveAttribute("aria-hidden", "true");
    const ids = Array.from(container.querySelectorAll("radialGradient, filter")).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    // exactly one blur filter per matrix (shared glow layer), never one per pixel
    expect(container.querySelectorAll("feGaussianBlur")).toHaveLength(2);
  });

  it("plays an animated preset without React renders and fades through the phosphor", async () => {
    let commits = 0;
    const { container } = render(
      <Profiler id="matrix" onRender={() => commits++}>
        <DotMatrix preset="loader" fps={60} label="Lädt" />
      </Profiler>,
    );
    const mounted = commits;
    const root = screen.getByRole("img", { name: "Lädt" });
    const first = opacities(root).join();
    await waitFor(() => expect(opacities(root).join()).not.toBe(first), { timeout: 1000 });
    expect(container.querySelectorAll("circle")).toHaveLength(49 * 3);
    expect(commits).toBe(mounted);
  });

  it("goes idle on a static frame: no attribute writes once settled", async () => {
    render(<DotMatrix pattern={[[0.3, 0.7, 0.1]]} label="Muster" />);
    const root = screen.getByRole("img", { name: "Muster" });
    expect(opacities(root)).toEqual([0.3, 0.7, 0.1]);
    await new Promise((r) => setTimeout(r, 60));
    const spy = vi.spyOn(Element.prototype, "setAttribute");
    await new Promise((r) => setTimeout(r, 120));
    expect(spy.mock.calls.filter(([name]) => name === "opacity")).toHaveLength(0);
    spy.mockRestore();
  });

  it("under reduced motion shows one static frame and no glow", async () => {
    fx.reduced = true;
    const { container } = render(<DotMatrix preset="loader" fps={60} label="Lädt" />);
    const root = screen.getByRole("img", { name: "Lädt" });
    expect(container.querySelector("filter")).toBeNull();
    expect(opacities(root)).toEqual(q(LOADER_FRAMES[0] as Frame));
    await new Promise((r) => setTimeout(r, 120));
    expect(opacities(root)).toEqual(q(LOADER_FRAMES[0] as Frame));
  });

  it("meter mode scrolls the sampled MotionValue into the grid (signed: buys up, sells down)", async () => {
    const level = motionValue(0);
    const { container } = render(<DotMatrix meter={level} signed cols={6} sampleMs={20} label="Orderflow" />);
    const root = screen.getByRole("img", { name: "Orderflow" });
    expect(container.querySelectorAll("svg > g:last-of-type > circle")).toHaveLength(7 * 6);
    // centre baseline is lit from the first paint
    expect(opacities(root).slice(3 * 6, 4 * 6).every((v) => v > 0)).toBe(true);
    level.set(1);
    await waitFor(
      () => {
        const o = opacities(root);
        const top = o.slice(0, 3 * 6);
        const bottom = o.slice(4 * 6);
        expect(Math.max(...top)).toBeGreaterThan(0.5);
        expect(Math.max(...bottom)).toBe(0);
      },
      { timeout: 1500 },
    );
    // signed rows above the centre use the buy tone gradient, below the sell tone
    const fills = onCircles(root).map((c) => c.getAttribute("fill"));
    expect(fills[0]).toMatch(/-fg\)$/);
    expect(fills[6 * 6]).toMatch(/-signal\)$/);
  });
});
