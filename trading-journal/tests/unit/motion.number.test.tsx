import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MotionNumber, formatNumber, toneOf } from "@/motion/MotionNumber";

describe("formatNumber", () => {
  it("formats de-DE with U+2212 minus, sign, prefix and suffix", () => {
    expect(formatNumber(1234.5, { decimals: 2 })).toBe("1.234,50");
    expect(formatNumber(-1234.5, { decimals: 2 })).toBe("−1.234,50");
    expect(formatNumber(12, { signed: true })).toBe("+12");
    expect(formatNumber(0, { signed: true, decimals: 1 })).toBe("0,0");
    expect(formatNumber(3.14159, { decimals: 1, suffix: " %" })).toBe("3,1 %");
    expect(formatNumber(null)).toBe("–");
  });
  it("derives tones from the sign", () => {
    expect(toneOf(5)).toBe("win");
    expect(toneOf(-5)).toBe("loss");
    expect(toneOf(0)).toBe("fg");
    expect(toneOf(null)).toBe("fg");
  });
});

describe("MotionNumber", () => {
  it("renders the formatted value with tabular-nums and an accessible label", () => {
    render(<MotionNumber value={1520.4} decimals={2} signed suffix=" USDT" />);
    const el = screen.getByLabelText("+1.520,40 USDT");
    expect(el.className).toContain("tabular-nums");
    expect(el.textContent).toBe("+1.520,40 USDT");
  });

  it("renders the null placeholder", () => {
    render(<MotionNumber value={null} />);
    expect(screen.getByLabelText("–").textContent).toBe("–");
  });

  it("with tone=auto exposes only the current tone layer", () => {
    render(<MotionNumber value={-42} tone="auto" decimals={0} />);
    const wrapper = screen.getByLabelText("−42");
    const layers = Array.from(wrapper.querySelectorAll("span"));
    expect(layers).toHaveLength(3);
    const visible = layers.filter((l) => l.getAttribute("aria-hidden") !== "true");
    expect(visible).toHaveLength(1);
    expect(visible[0]?.className).toContain("text-loss");
    expect(visible[0]?.textContent).toBe("−42");
  });
});
