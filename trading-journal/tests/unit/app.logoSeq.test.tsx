/**
 * The logo sequence (`src/app/logoSeq.ts`, `LogoMark.tsx`): strokes strictly one after the other, ≤ 1.2 s, once per session, replay on demand,
 * the mark itself is configuration (operator decision E10).
 */
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LogoMark } from "@/app/LogoMark";
import { LOGO_MARKS, LOGO_SEQ_KEY, LOGO_TOTAL_MS, logoSeen, logoTimeline, markWindow, markLogoSeen, replayLogo } from "@/app/logoSeq";
import { applyMotionMode, useMotionPref } from "@/motion/profile";

const marks = (...counts: number[]) => counts.map((n) => ({ paths: Array.from({ length: n }, (_, i) => `M0 ${i}h1`) }));

describe("logoTimeline", () => {
  it("every stroke starts when the one before it has finished – no overlap, no gap – and the whole is within 1.2 s", () => {
    for (const m of [marks(3), marks(1), marks(3, 2), marks(1, 1, 1, 1), marks(5, 7, 2)]) {
      const slots = logoTimeline(m);
      expect(slots.length).toBe(m.reduce((n, x) => n + x.paths.length, 0));
      expect(slots[0]!.start).toBe(0);
      for (let i = 1; i < slots.length; i++) expect(slots[i]!.start).toBe(slots[i - 1]!.start + slots[i - 1]!.duration);
      const last = slots[slots.length - 1]!;
      expect(last.start + last.duration).toBeLessThanOrEqual(LOGO_TOTAL_MS);
      expect(LOGO_TOTAL_MS).toBeLessThanOrEqual(1200);
    }
  });

  it("logo 1 is finished before logo 2 starts", () => {
    const slots = logoTimeline(marks(3, 2));
    const a = markWindow(slots, 0)!;
    const b = markWindow(slots, 1)!;
    expect(a.end).toBeLessThanOrEqual(b.start);
    expect(slots.filter((s) => s.mark === 0)).toHaveLength(3);
    expect(markWindow(slots, 5)).toBeNull();
  });

  it("nothing to draw, nothing planned", () => {
    expect(logoTimeline([])).toEqual([]);
  });
});

describe("the configured mark", () => {
  it("is the ₿ sign as three strokes (the operator replaces it, E10)", () => {
    expect(LOGO_MARKS).toHaveLength(1);
    expect(LOGO_MARKS[0]!.paths).toHaveLength(3);
    for (const d of LOGO_MARKS[0]!.paths) expect(d).toMatch(/^M[\d. -]+/);
  });
});

describe("LogoMark", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useMotionPref.setState({ mode: "system" });
    applyMotionMode("system");
  });

  it("renders every stroke with its length (pathLength 1) and rests drawn; the session flag is set once it has played", async () => {
    expect(logoSeen()).toBe(false);
    const { container } = render(<LogoMark />);
    const paths = container.querySelectorAll("path[data-logo-stroke]");
    expect(paths).toHaveLength(3);
    expect(Array.from(paths).every((p) => p.getAttribute("pathLength") === "1")).toBe(true);
    // jsdom has no Web Animations: it finishes at once and rests without a dash left behind
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector("svg")!.getAttribute("data-logo")).toBe("rest");
    expect(Array.from(paths).every((p) => !(p as SVGPathElement).style.strokeDasharray)).toBe(true);
  });

  it("`still` (the tile's back face) and reduced motion never draw", () => {
    const a = render(<LogoMark still />);
    expect(a.container.querySelector("svg")!.getAttribute("data-logo")).toBe("rest");
    a.unmount();
    useMotionPref.setState({ mode: "reduced" });
    const b = render(<LogoMark />);
    expect(b.container.querySelector("svg")!.getAttribute("data-logo")).toBe("rest");
  });

  it("a session that has seen it does not play again; the replay does", async () => {
    markLogoSeen();
    expect(sessionStorage.getItem(LOGO_SEQ_KEY)).toBe("1");
    const { container } = render(<LogoMark />);
    expect(container.querySelector("svg")!.getAttribute("data-logo")).toBe("rest");
    act(() => replayLogo());
    // the replay starts (strokes wait undrawn for a frame) and ends by itself
    expect(["run", "rest"]).toContain(container.querySelector("svg")!.getAttribute("data-logo"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(container.querySelector("svg")!.getAttribute("data-logo")).toBe("rest");
  });

  it("two logos: the second is there during its window only; at rest the first (the brand mark) stays", () => {
    const two = [
      { id: "a", label: "A", paths: ["M1 1h4", "M1 5h4"] },
      { id: "b", label: "B", paths: ["M2 2h6"] },
    ];
    const { container } = render(<LogoMark marks={two} still />);
    expect(container.querySelectorAll("[data-logo-mark]")).toHaveLength(1);
    expect(container.querySelectorAll("path")).toHaveLength(2);
  });
});
