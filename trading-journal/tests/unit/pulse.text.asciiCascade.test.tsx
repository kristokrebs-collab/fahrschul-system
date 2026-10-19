import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reducedState = vi.hoisted(() => ({ value: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => reducedState.value }));

import { AsciiCascade, CONFIG, cascadeAt, createScrambler } from "@/motion/pulse/AsciiCascade";

const glyphText = (root: HTMLElement, layer = 0) => {
  const row = root.querySelector('[aria-hidden="true"]')!;
  const l = row.children[layer]!;
  return Array.from(l.querySelectorAll("[data-g]"))
    .map((g) => g.textContent)
    .join("");
};

describe("cascadeAt (measured timeline)", () => {
  it("falls with cubic ease-out, holds, rises and resolves at 1870 ms", () => {
    expect(cascadeAt(0).d).toBe(0);
    expect(cascadeAt(275).d).toBeCloseTo(1 - Math.pow(0.5, 3), 5);
    expect(cascadeAt(550).d).toBe(1);
    expect(cascadeAt(1000).d).toBe(1);
    expect(cascadeAt(1220).d).toBe(1);
    expect(cascadeAt(1520).d).toBeCloseTo(Math.pow(0.5, 3), 5);
    expect(cascadeAt(1820).d).toBeCloseTo(0, 6);
    expect(cascadeAt(1869).resolved).toBe(false);
    expect(cascadeAt(1870).resolved).toBe(true);
  });
  it("dims to 0.58 and fades the white layer with gain 1.6", () => {
    const bottom = cascadeAt(800);
    expect(bottom.opacity).toBeCloseTo(CONFIG.dimOpacity, 6);
    expect(bottom.white).toBe(0);
    expect(cascadeAt(0).white).toBe(1);
  });
  it("glows during the rise and fades after the resolve", () => {
    expect(cascadeAt(1000).glow).toBe(0);
    expect(cascadeAt(1600).glow).toBeGreaterThan(0);
    expect(cascadeAt(1870).glow).toBeCloseTo(CONFIG.glowPeak, 6);
    expect(cascadeAt(1870 + CONFIG.glowTail).glow).toBe(0);
    expect(cascadeAt(1870 + CONFIG.glowTail).done).toBe(true);
  });
});

describe("createScrambler", () => {
  it("is deterministic per seed and keeps whitespace", () => {
    const run = (seed: number) => {
      const s = createScrambler("TRADE JOURNAL", seed);
      const frames: string[] = [];
      for (let e = 0; e < 1870; e += 8) if (s.step(e)) frames.push(s.cur.join(""));
      return frames;
    };
    const a = run(42);
    expect(run(42)).toEqual(a);
    expect(run(43)).not.toEqual(a);
    for (const f of a) expect(f[5]).toBe(" ");
  });
  it("re-rolls once per 70 ms tick with glyphs from the charset (~70 % change chance)", () => {
    const s = createScrambler("CASCADECASCADE", 7);
    const pool = new Set(Array.from(CONFIG.chars));
    expect(s.step(100)).toBe(true);
    expect(s.step(110)).toBe(false); // same tick
    let changes = 0;
    let total = 0;
    let prev = s.cur.slice();
    for (let k = 2; k < 40; k++) {
      s.step(k * CONFIG.tick);
      for (let i = 0; i < prev.length; i++) {
        total++;
        if (s.cur[i] !== prev[i]) changes++;
        expect(pool.has(s.cur[i]!)).toBe(true);
      }
      prev = s.cur.slice();
    }
    // chance 0.7 minus same-glyph re-rolls (1/14) ≈ 0.65
    expect(changes / total).toBeGreaterThan(0.55);
    expect(changes / total).toBeLessThan(0.75);
  });
  it("starts letters after their onset jitter (≤ 60 ms)", () => {
    const s = createScrambler("ABCDEFGH", 3);
    for (const o of s.onset) expect(o).toBeLessThan(CONFIG.onsetJitter);
  });
});

describe("<AsciiCascade>", () => {
  beforeEach(() => {
    reducedState.value = false;
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces the text once and hides the glyph layers", () => {
    const { container, getByText } = render(<AsciiCascade text="JOURNAL" playOnMount={false} />);
    expect(getByText("JOURNAL")).toHaveClass("sr-only");
    const root = container.firstElementChild as HTMLElement;
    expect(root.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(glyphText(root)).toBe("JOURNAL");
  });

  it("scrambles, then resolves all glyphs at once and calls onDone once", () => {
    const onDone = vi.fn();
    const { container } = render(<AsciiCascade text="JOURNAL" seed={9} onDone={onDone} />);
    const root = container.firstElementChild as HTMLElement;
    act(() => void vi.advanceTimersByTime(400));
    expect(glyphText(root)).not.toBe("JOURNAL");
    expect(root.hasAttribute("data-playing")).toBe(true);
    act(() => void vi.advanceTimersByTime(1500));
    expect(glyphText(root)).toBe("JOURNAL");
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(600));
    expect(root.hasAttribute("data-playing")).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("replays when the numeric play trigger changes", () => {
    const onDone = vi.fn();
    const { rerender } = render(<AsciiCascade text="A" play={0} playOnMount={false} onDone={onDone} />);
    act(() => void vi.advanceTimersByTime(2500));
    expect(onDone).not.toHaveBeenCalled();
    rerender(<AsciiCascade text="A" play={1} playOnMount={false} onDone={onDone} />);
    act(() => void vi.advanceTimersByTime(2500));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reduced motion: final text, no scramble, onDone right away", () => {
    reducedState.value = true;
    const onDone = vi.fn();
    const { container } = render(<AsciiCascade text="JOURNAL" onDone={onDone} />);
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(300));
    const root = container.firstElementChild as HTMLElement;
    expect(glyphText(root)).toBe("JOURNAL");
    expect(root.hasAttribute("data-playing")).toBe(false);
  });
});
