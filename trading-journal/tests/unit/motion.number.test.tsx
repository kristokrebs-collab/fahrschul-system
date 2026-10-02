import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInViewObserverForTests } from "@/motion/inView";
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

describe("MotionNumber flash", () => {
  it("pre-renders two hidden tint layers and keeps a single accessible label", () => {
    render(<MotionNumber value={10} flash />);
    const el = screen.getByLabelText("10");
    const layers = el.querySelectorAll("[aria-hidden='true'].text-win, [aria-hidden='true'].text-loss");
    expect(layers).toHaveLength(2);
    layers.forEach((l) => expect(l.className).toContain("opacity-0"));
  });

  it("an up-move lights the win layer, a down-move the loss layer", async () => {
    const { rerender } = render(<MotionNumber value={10} flash />);
    const up = () => screen.getByLabelText(/./).querySelector<HTMLElement>(".text-win[aria-hidden='true']");
    const down = () => screen.getByLabelText(/./).querySelector<HTMLElement>(".text-loss[aria-hidden='true']");
    rerender(<MotionNumber value={12} flash />);
    await waitFor(() => expect(Number(up()?.style.opacity || 0)).toBeGreaterThan(0));
    expect(Number(down()?.style.opacity || 0)).toBe(0);
    rerender(<MotionNumber value={5} flash />);
    await waitFor(() => expect(Number(down()?.style.opacity || 0)).toBeGreaterThan(0));
    expect(up()?.style.opacity).toBe("0");
  });

  it("does not flash on mount", () => {
    render(<MotionNumber value={10} flash />);
    const up = screen.getByLabelText("10").querySelector<HTMLElement>(".text-win[aria-hidden='true']");
    expect(up?.style.opacity ?? "").toBe("");
  });
});

describe("MotionNumber gate / countOnReveal (shared IntersectionObserver)", () => {
  type Cb = (entries: { target: Element; isIntersecting: boolean }[]) => void;
  let created = 0;
  let cb: Cb = () => {};
  beforeEach(() => {
    created = 0;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(c: Cb) {
          created += 1;
          cb = c;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    resetInViewObserverForTests();
  });
  afterEach(() => {
    resetInViewObserverForTests();
    vi.unstubAllGlobals();
  });

  it("gated numbers share one observer", () => {
    render(
      <>
        <MotionNumber value={1} gate />
        <MotionNumber value={2} gate />
        <MotionNumber value={3} gate />
      </>,
    );
    expect(created).toBe(1);
  });

  it("countOnReveal holds 0 until in view, then counts up to the value (label is final throughout)", async () => {
    render(<MotionNumber value={1234} countOnReveal />);
    const el = screen.getByLabelText("1.234");
    expect(el.textContent).toBe("0");
    act(() => cb([{ target: el, isIntersecting: true }]));
    await waitFor(() => expect(el.textContent).toBe("1.234"), { timeout: 3000 });
  });
});

describe("MotionNumber countOnReveal without IntersectionObserver", () => {
  it("renders the final value right away", () => {
    render(<MotionNumber value={1234} countOnReveal />);
    expect(screen.getByLabelText("1.234").textContent).toBe("1.234");
  });
});
