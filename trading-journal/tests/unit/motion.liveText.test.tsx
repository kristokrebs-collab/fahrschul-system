import { act, render, screen, waitFor } from "@testing-library/react";
import { motionValue } from "motion/react";
import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveText, formatLive } from "@/motion/LiveText";
import { PING_MIN_INTERVAL_MS, PulseDot, pingAllowed } from "@/motion/PulseDot";
import { FLASH_COOLDOWN_MS, ValueFlash, flashDirection } from "@/motion/ValueFlash";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

afterEach(() => {
  fx.reduced = false;
});

describe("formatLive", () => {
  it("formats de-DE with options, custom formatters and a dash for non-finite values", () => {
    expect(formatLive(86100, undefined, { decimals: 1 })).toBe("86.100,0");
    expect(formatLive(-0.0123, undefined, { decimals: 2, suffix: " %", signed: true })).toBe("−0,01 %");
    expect(formatLive(1.2, undefined, { decimals: 2, signed: true, suffix: " % 24h" })).toBe("+1,20 % 24h");
    expect(formatLive(42, (n) => `≈${n}`)).toBe("≈42");
    expect(formatLive(Number.NaN)).toBe("–");
    expect(formatLive(Number.POSITIVE_INFINITY, (n) => String(n))).toBe("–");
  });
});

describe("<LiveText>", () => {
  it("renders the MotionValue as text and follows it without React renders", async () => {
    const mv = motionValue(86100);
    let commits = 0;
    render(
      <Profiler id="live" onRender={() => commits++}>
        <LiveText source={mv} decimals={1} className="dot-num" />
      </Profiler>,
    );
    const el = screen.getByText("86.100,0");
    expect(el.className).toContain("tabular-nums");
    const mounted = commits;
    act(() => {
      for (let i = 1; i <= 20; i++) mv.set(86100 + i);
    });
    await waitFor(() => expect(el.textContent).toBe("86.120,0"));
    expect(commits).toBe(mounted);
  });

  it("glides to the new value with smooth, and jumps under reduced motion", async () => {
    const mv = motionValue(100);
    const { unmount } = render(<LiveText source={mv} smooth />);
    const el = screen.getByText("100");
    act(() => mv.set(200));
    await waitFor(() => {
      const n = Number(el.textContent);
      expect(n).toBeGreaterThan(100);
      expect(n).toBeLessThan(200);
    });
    await waitFor(() => expect(el.textContent).toBe("200"), { timeout: 2000 });
    unmount();

    fx.reduced = true;
    const raw = motionValue(5);
    render(<LiveText source={raw} smooth />);
    const plain = screen.getByText("5");
    act(() => raw.set(9));
    await waitFor(() => expect(plain.textContent).toBe("9"));
  });

  it("flash layers are decorative and the text stays the only content", async () => {
    const mv = motionValue(10);
    const { container } = render(<LiveText source={mv} flash aria-label="Preis" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.textContent).toBe("10");
    const [up, down] = Array.from(root.querySelectorAll("[aria-hidden='true']")) as HTMLElement[];
    expect(up?.className).toContain("bg-win/15");
    expect(down?.className).toContain("bg-loss/15");
    expect(up?.className).toContain("pointer-events-none");
    act(() => mv.set(11));
    await waitFor(() => expect(Number(up?.style.opacity)).toBeGreaterThan(0));
    expect(down?.style.opacity).toBe("0");
  });
});

describe("ValueFlash", () => {
  it("derives the direction, ignoring equal values, tiny moves and non-finite input", () => {
    expect(flashDirection(1, 2)).toBe(1);
    expect(flashDirection(2, 1)).toBe(-1);
    expect(flashDirection(2, 2)).toBe(0);
    expect(flashDirection(100, 100.4, 0.5)).toBe(0);
    expect(flashDirection(100, 99, 0.5)).toBe(-1);
    expect(flashDirection(Number.NaN, 1)).toBe(0);
    expect(FLASH_COOLDOWN_MS).toBeGreaterThan(0);
  });

  it("wraps children untouched and flashes on React value changes", async () => {
    const { container, rerender } = render(
      <ValueFlash value={5}>
        <span>5 USDT</span>
      </ValueFlash>,
    );
    expect(container.textContent).toBe("5 USDT");
    const [up, down] = Array.from(container.querySelectorAll("[aria-hidden='true']")) as HTMLElement[];
    rerender(
      <ValueFlash value={3}>
        <span>3 USDT</span>
      </ValueFlash>,
    );
    await waitFor(() => expect(Number(down?.style.opacity)).toBeGreaterThan(0));
    expect(up?.style.opacity).toBe("0");
  });

  it("uses a calm underline under reduced motion", () => {
    fx.reduced = true;
    const { container } = render(
      <ValueFlash value={1}>
        <span>1</span>
      </ValueFlash>,
    );
    const layers = Array.from(container.querySelectorAll("[aria-hidden='true']"));
    expect(layers.every((l) => l.className.includes("h-0.5"))).toBe(true);
  });
});

describe("<PulseDot>", () => {
  it("throttles trade pings to 4 Hz", () => {
    expect(PING_MIN_INTERVAL_MS).toBe(250);
    expect(pingAllowed(-Infinity, 0)).toBe(true);
    expect(pingAllowed(1000, 1200)).toBe(false);
    expect(pingAllowed(1000, 1250)).toBe(true);
  });

  it("is decorative by default and labelled on request", () => {
    const { container, rerender } = render(<PulseDot tone="warn" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    rerender(<PulseDot tone="live" label="Live" />);
    expect(screen.getByRole("img", { name: "Live" })).toHaveAttribute("data-tone", "live");
  });

  it("renders rings and ping layers, and only a static dot under reduced motion", () => {
    const ping = motionValue(0);
    const { container, unmount } = render(<PulseDot rings={2} ping={ping} size={8} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe("8px");
    expect(root.children).toHaveLength(5); // 2 rings + ping + core + flash
    for (const c of Array.from(root.children)) expect(c).toHaveAttribute("aria-hidden", "true");
    unmount();

    fx.reduced = true;
    const { container: c2 } = render(<PulseDot rings={2} ping={ping} />);
    expect((c2.firstElementChild as HTMLElement).children).toHaveLength(1);
  });

  it("fires a ping on a MotionValue change", async () => {
    const ping = motionValue(0);
    const { container } = render(<PulseDot rings={0} ping={ping} />);
    const [pingLayer] = Array.from((container.firstElementChild as HTMLElement).children) as HTMLElement[];
    act(() => ping.set(1));
    await waitFor(() => expect(Number(pingLayer?.style.opacity)).toBeGreaterThan(0));
  });
});
