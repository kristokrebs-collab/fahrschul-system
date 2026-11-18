import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CONFIG, Marquee, marqueeCopies, marqueeOffset } from "@/motion/pulse/Marquee";

describe("Marquee math", () => {
  it("offset is time × speed wrapped seamlessly into [0, loop)", () => {
    expect(CONFIG.speed).toBe(52);
    expect(marqueeOffset(1000, 52, 300)).toBeCloseTo(52);
    expect(marqueeOffset(10_000, 52, 300)).toBeCloseTo(520 - 300);
    expect(marqueeOffset((300 / 52) * 1000, 52, 300)).toBeCloseTo(0, 6);
    expect(marqueeOffset(-1000, 52, 300)).toBeCloseTo(248);
    expect(marqueeOffset(5000, 52, 0)).toBe(0);
  });

  it("frame-rate independent: the same elapsed time gives the same offset however it is sampled", () => {
    const at = (ms: number) => marqueeOffset(ms, 52, 412);
    const step120 = Array.from({ length: 121 }, (_, i) => at((i * 1000) / 120)).at(-1);
    const step60 = Array.from({ length: 61 }, (_, i) => at((i * 1000) / 60)).at(-1);
    expect(step120).toBeCloseTo(step60!, 9);
  });

  it("copies cover the viewport plus one loop", () => {
    expect(marqueeCopies(1000, 300)).toBe(5);
    expect(marqueeCopies(200, 300)).toBe(2);
    expect(marqueeCopies(200, 0)).toBe(2);
  });
});

describe("<Marquee>", () => {
  it("renders the real content once and aria-hidden inert duplicates, labelled marquee region", () => {
    render(
      <Marquee aria-label="Journal-Statistik">
        <span>13 Trades</span>
      </Marquee>,
    );
    const region = screen.getByRole("marquee", { name: "Journal-Statistik" });
    expect(screen.getAllByText("13 Trades").length).toBeGreaterThanOrEqual(2);
    const copies = region.firstElementChild!.children;
    expect(copies[0]).not.toHaveAttribute("aria-hidden");
    for (let i = 1; i < copies.length; i++) {
      expect(copies[i]).toHaveAttribute("aria-hidden", "true");
      expect(copies[i]).toHaveAttribute("inert");
    }
    expect(screen.getAllByText("13 Trades", { ignore: "[aria-hidden] *" })).toHaveLength(1);
  });

  it("paused holds the drift (loop asleep, no will-change) and resumes when released", () => {
    const ui = (paused: boolean) => (
      <Marquee aria-label="Band" paused={paused}>
        <span>Win-Rate</span>
      </Marquee>
    );
    const { rerender } = render(ui(true));
    const track = screen.getByRole("marquee", { name: "Band" }).firstElementChild as HTMLElement;
    expect(track.style.willChange).toBe("");
    rerender(ui(false));
    expect(track.style.willChange).toBe("transform");
    rerender(ui(true));
    expect(track.style.willChange).toBe("");
  });
});
