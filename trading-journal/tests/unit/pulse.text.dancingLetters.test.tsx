import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seeded } from "@/motion/pulse/engine";
import { CONFIG, DancingLetters, DancingSvgWord, createDancer, throwTarget } from "@/motion/pulse/DancingLetters";

function stubHover() {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("hover"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
}

describe("throwTarget", () => {
  it("stays within the fitted ranges and is deterministic", () => {
    const a = seeded(5);
    const b = seeded(5);
    for (let i = 0; i < 200; i++) {
      const t = throwTarget(a, 100);
      expect(throwTarget(b, 100)).toEqual(t);
      expect(t.scale).toBeGreaterThanOrEqual(CONFIG.scaleMin);
      expect(t.scale).toBeLessThanOrEqual(CONFIG.scaleMax);
      expect(t.y).toBeGreaterThanOrEqual(-CONFIG.yMaxEm * 0.7 * 100);
      expect(t.y).toBeLessThanOrEqual(CONFIG.yMaxEm * 100);
      expect(Math.abs(t.rot)).toBeLessThanOrEqual(CONFIG.rotMax);
    }
  });
});

/** Rest transform (never `none`: a none ↔ transform switch would restyle the subtree). */
const REST = "translate(0px,0px)";

describe("createDancer", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("throws a letter, holds ~1.4 s, then glides back to rest and sleeps", () => {
    const d = createDancer();
    d.setText("AB");
    const els = [document.createElement("span"), document.createElement("span")];
    els.forEach((el, i) => d.register(i, el));
    d.setEnabled(true);
    d.poke(0);
    vi.advanceTimersByTime(150);
    expect(els[0]!.style.transform).toMatch(/translate3d\(0,.+px,0\) rotate\(.+deg\) scale\(.+\)/);
    expect(els[1]!.style.transform).toBe(REST);
    expect(els[0]!.style.willChange).toBe("transform");
    vi.advanceTimersByTime(1100);
    expect(els[0]!.style.transform).not.toBe(REST); // still held
    vi.advanceTimersByTime(4000);
    expect(els[0]!.style.transform).toBe(REST);
    expect(els[0]!.style.willChange).toBe("");
    d.destroy();
  });

  it("does nothing while disabled (touch devices, reduced motion)", () => {
    const d = createDancer();
    d.setText("A");
    const el = document.createElement("span");
    d.register(0, el);
    d.poke(0);
    vi.advanceTimersByTime(200);
    expect(el.style.transform).toBe(REST);
  });
});

describe("<DancingLetters>", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the word once for assistive tech and one aria-hidden span per letter", () => {
    const { container, getByText } = render(<DancingLetters text="TRADE" />);
    expect(getByText("TRADE")).toHaveClass("sr-only");
    const hidden = container.querySelector('[aria-hidden="true"]')!;
    expect(hidden.children).toHaveLength(5);
  });

  it("SVG word: one HTML box + <svg> per visible letter carrying every layer, transformed by the dancer", () => {
    stubHover();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
    const { container } = render(
      <DancingSvgWord text="TJ X" label="TJ X">
        {(ch) => (
          <>
            <text data-layer="a">{ch}</text>
            <text data-layer="b">{ch}</text>
          </>
        )}
      </DancingSvgWord>,
    );
    const root = container.querySelector('[data-pulse="dancing-svg-word"]') as HTMLElement;
    expect(root.getAttribute("aria-label")).toBe("TJ X");
    const cells = root.querySelectorAll<HTMLElement>("[data-letter]");
    expect(cells).toHaveLength(3);
    expect(cells[0]!.querySelectorAll("text")).toHaveLength(2);
    // registered with the dancer (jsdom has no layout, throws are covered by the createDancer tests)
    expect(cells[1]!.style.transformOrigin).toBe("50% 50%");
    vi.useRealTimers();
  });
});
