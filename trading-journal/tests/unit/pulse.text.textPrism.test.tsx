import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { springAt } from "@/motion/pulse/engine";
import { CONFIG, TextPrism, splitOffset } from "@/motion/pulse/TextPrism";
import { springStep } from "@/motion/pulse/textKit";

describe("springStep (exact, frame-rate independent)", () => {
  it("matches the closed-form spring from rest", () => {
    for (const t of [0.05, 0.1, 0.2, 0.4]) expect(springStep(0, 0, 1, t).x).toBeCloseTo(springAt(t, CONFIG.spring), 6);
  });
  it("gives the same path at 60, 120 and 240 Hz", () => {
    const run = (hz: number) => {
      let s = { x: 0, v: 0 };
      for (let i = 0; i < hz * 0.3; i++) s = springStep(s.x, s.v, 100, 1 / hz);
      return s.x;
    };
    expect(run(60)).toBeCloseTo(run(240), 6);
    expect(run(120)).toBeCloseTo(run(240), 6);
  });
  it("overshoots about 1.5 % (stiffness 350, damping 30)", () => {
    let max = 0;
    for (let t = 0; t < 1; t += 0.001) max = Math.max(max, springStep(0, 0, 100, t).x);
    expect(max).toBeGreaterThan(100.8);
    expect(max).toBeLessThan(102.5);
  });
});

describe("splitOffset", () => {
  it("is gain · velocity, clamped to 14 px at 48 px type (scales with the font)", () => {
    expect(splitOffset(100, 48)).toBeCloseTo(2, 6);
    expect(splitOffset(5000, 48)).toBe(14);
    expect(splitOffset(-5000, 48)).toBe(-14);
    expect(splitOffset(5000, 24)).toBe(7);
  });
});

describe("<TextPrism>", () => {
  it("keeps one accessible copy of the text; lens and copies are aria-hidden", () => {
    const { container } = render(<TextPrism text="+1.240 €" />);
    const root = container.querySelector('[data-pulse="text-prism"]') as HTMLElement;
    const lens = root.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(lens.children).toHaveLength(3);
    expect(lens.style.opacity).toBe("0");
    expect(root.firstElementChild!.textContent).toBe("+1.240 €");
    expect(root.firstElementChild!.getAttribute("aria-hidden")).toBeNull();
  });
  it("renders children as content", () => {
    const { getAllByText } = render(
      <TextPrism>
        <b>42</b>
      </TextPrism>,
    );
    expect(getAllByText("42")).toHaveLength(4);
  });
});
