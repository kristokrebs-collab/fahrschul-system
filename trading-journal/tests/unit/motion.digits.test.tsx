import { act, render, screen, waitFor } from "@testing-library/react";
import { motionValue } from "motion/react";
import { describe, expect, it } from "vitest";
import { carryPosition, intDigitCount, RollingDigits } from "@/motion/RollingDigits";

const columns = (root: HTMLElement) => root.querySelectorAll(".w-\\[1ch\\]").length;
/**
 * The accessible text is an sr-only span (no `role="text"` / aria-label on a generic element any more – a11y review
 * "price-role-text"); this returns the odometer root that holds it.
 */
const digitsRoot = (text: string) => screen.getByText(text).closest<HTMLElement>("[data-rolling-digits]") as HTMLElement;
/** Visual separators (`.` / `,`) are aria-hidden spans of their own. */
const visualText = (root: HTMLElement) => Array.from(root.querySelectorAll("[aria-hidden='true']")).map((e) => e.textContent).join("");

describe("carryPosition (mechanical odometer)", () => {
  it("the lowest column follows the value continuously", () => {
    expect(carryPosition(86195.4, 1)).toBeCloseTo(86195.4);
  });

  it("higher columns sit exactly on their digit at rest", () => {
    // 86 195: hundreds column must show 1 – not half-way to 2
    expect(carryPosition(86195, 100) % 10).toBe(1);
    expect(carryPosition(86195, 10) % 10).toBe(9);
    expect(carryPosition(86195, 1000) % 10).toBe(6);
  });

  it("carries roll in lock-step with the lowest column passing 9 → 0", () => {
    expect(carryPosition(99.5, 10)).toBeCloseTo(9.5);
    expect(carryPosition(99.5, 100)).toBeCloseTo(0.5);
    expect(carryPosition(98.5, 100)).toBe(0); // tens still on 9, nothing carries yet
    expect(carryPosition(100, 100)).toBe(1);
  });
});

describe("intDigitCount", () => {
  it("counts integer digits (at least one)", () => {
    expect(intDigitCount(0)).toBe(1);
    expect(intDigitCount(9.99)).toBe(1);
    expect(intDigitCount(10)).toBe(2);
    expect(intDigitCount(86100.4)).toBe(5);
    expect(intDigitCount(100000)).toBe(6);
  });
});

describe("RollingDigits source mode", () => {
  it("renders the MotionValue with de-DE grouping, a decimal column and an integer label", () => {
    const mv = motionValue(86100.4);
    render(<RollingDigits source={mv} decimals={1} decimalClassName="text-mute" formatLabel={(v) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(v)} />);
    const el = digitsRoot("86.100");
    expect(columns(el)).toBe(6);
    expect(visualText(el)).toContain(".");
    expect(el.querySelector(".text-mute")?.textContent).toContain(",");
  });

  it("follows the source without React props, re-renders only for a new digit and throttles the label", async () => {
    const mv = motionValue(99990);
    render(<RollingDigits source={mv} />);
    const el = digitsRoot("99.990");
    expect(columns(el)).toBe(5);
    act(() => mv.set(100020));
    await waitFor(() => expect(columns(el)).toBe(6), { timeout: 2000 });
    await waitFor(() => expect(el.querySelector(".sr-only")?.textContent).toBe("100.020"), { timeout: 2000 });
  });

  it("shows a leading minus for negative values", () => {
    render(<RollingDigits source={motionValue(-1250)} />);
    const el = digitsRoot("−1.250");
    expect(visualText(el).startsWith("−")).toBe(true);
  });
});
