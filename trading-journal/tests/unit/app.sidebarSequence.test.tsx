/**
 * Runde 12 – the sidebar's first-load sequence: the rows wave in from the top (80 ms apart, 420 ms each), the glyphs draw STRICTLY one after
 * the other, once per page load, only after the intro's stage has lifted (it used to start at mount, played under the stage and was used up),
 * never on hover / route change / re-render, never under reduced motion, and nothing stays invisible.
 * Frames are measured in the real browser (`tests/e2e/sidebar-sequenz.spec.ts`); here the pure timeline and the markup contracts.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

import { Sidebar } from "@/app/Sidebar";
import { resetSequenceForTests, SEQ, SEQ_WAIT_MAX_MS, sequenceSeen, sidebarSequence } from "@/app/shellFx";
import { introCoversApp, resetIntroPendingForTests } from "@/intro/introBoot";
import { setIntroPhase } from "@/intro/introStore";
import { MotionRoot } from "@/motion/MotionRoot";
import { useUi } from "@/store/uiStore";

const realMatchMedia = window.matchMedia;
/** A screen `width` px wide with a mouse; motion is allowed for the intro's own check (the hook above is the sidebar's). */
function screenOf(width: number) {
  window.matchMedia = ((q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    let matches = (min ? width >= Number(min[1]) : true) && (max ? width <= Number(max[1]) : true);
    if (/max-height/.test(q)) matches = false;
    if (/hover:\s*hover/.test(q)) matches = true;
    else if (/pointer|reduced-motion/.test(q)) matches = false;
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

beforeEach(() => {
  sessionStorage.clear();
  resetSequenceForTests();
  resetIntroPendingForTests();
  setIntroPhase("off");
  useUi.setState({ page: "overview", sidebar: "auto", sidebarClosed: null, editor: { open: false, fromFab: false } });
  screenOf(1024);
});
afterEach(() => {
  fx.reduced = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.matchMedia = realMatchMedia;
  act(() => setIntroPhase("off"));
  document.documentElement.style.removeProperty("--sidebar-w");
});

const mount = () =>
  render(
    <MotionRoot>
      <Sidebar />
    </MotionRoot>,
  );
const frameOf = (c: HTMLElement) => c.querySelector<HTMLElement>(".sb")!;
const num = (v: string) => Number.parseFloat(v);
const SHAPE = ".sb-ico :is(path, circle, rect, line, polyline, ellipse)";

describe("sidebarSequence (pure timeline)", () => {
  const counts = [1, 3, 2, 4, 1, 2, 2, 3, 1, 2, 2, 1, 3, 2, 2, 1, 2, 4, 1];

  it("the rows wave in 70–90 ms apart, top to bottom, each taking 380–460 ms", () => {
    const { rows } = sidebarSequence(counts);
    expect(rows).toHaveLength(counts.length);
    expect(rows[0]!.start).toBe(0);
    for (let i = 1; i < rows.length; i++) {
      const step = rows[i]!.start - rows[i - 1]!.start;
      expect(step).toBeGreaterThanOrEqual(70);
      expect(step).toBeLessThanOrEqual(90);
    }
    for (const r of rows) {
      expect(r.duration).toBeGreaterThanOrEqual(380);
      expect(r.duration).toBeLessThanOrEqual(460);
    }
  });

  it("the glyphs draw strictly one after the other: a glyph is finished before the next one starts, and so is a stroke inside it", () => {
    const { glyphs } = sidebarSequence(counts);
    expect(glyphs).toHaveLength(counts.length);
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i]!;
      if (i > 0) expect(g.start).toBeGreaterThanOrEqual(glyphs[i - 1]!.start + glyphs[i - 1]!.duration);
      expect(g.strokes).toHaveLength(counts[i]!);
      expect(g.strokes[0]!.start).toBeGreaterThanOrEqual(g.start);
      for (let k = 1; k < g.strokes.length; k++) expect(g.strokes[k]!.start).toBeGreaterThanOrEqual(g.strokes[k - 1]!.start + g.strokes[k - 1]!.duration - 0.011);
      const last = g.strokes[g.strokes.length - 1]!;
      expect(last.start + last.duration).toBeLessThanOrEqual(g.start + g.duration + 0.011);
    }
  });

  it("ends when the last row has landed and the last glint is over; a glyph without strokes still gets a slot; no rows → nothing", () => {
    const seq = sidebarSequence(counts);
    const lastRow = seq.rows.at(-1)!;
    const lastGlyph = seq.glyphs.at(-1)!;
    expect(seq.totalMs).toBeGreaterThanOrEqual(lastRow.start + lastRow.duration);
    expect(seq.totalMs).toBeGreaterThanOrEqual(lastGlyph.start + lastGlyph.duration + SEQ.glintMs);
    // well inside what a first look can take: under 3 s for the 19 rows
    expect(seq.totalMs).toBeLessThan(3000);
    expect(sidebarSequence([0]).glyphs[0]!.strokes).toHaveLength(1);
    expect(sidebarSequence([])).toEqual({ rows: [], glyphs: [], totalMs: 0 });
  });
});

describe("introCoversApp (pure)", () => {
  it("the stage covers it; „off“ covers it only while the intro is about to start (the first render); build and done never", () => {
    expect(introCoversApp("stage", false)).toBe(true);
    expect(introCoversApp("off", true)).toBe(true);
    expect(introCoversApp("off", false)).toBe(false);
    expect(introCoversApp("build", true)).toBe(false);
    expect(introCoversApp("done", true)).toBe(false);
  });
});

describe("the sequence in the sidebar", () => {
  it("plays at the first look: rows get their slots top to bottom, every stroke starts only when the one before it is finished", () => {
    const { container } = mount();
    const frame = frameOf(container);
    expect(frame.getAttribute("data-draw")).toBe("run");
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".sb-rows > li"));
    expect(rows.length).toBe(19);
    const delays = rows.map((li) => num(li.style.getPropertyValue("--sq-d")));
    expect(delays[0]).toBe(0);
    for (let i = 1; i < delays.length; i++) expect(delays[i]! - delays[i - 1]!).toBe(SEQ.rowStepMs);
    const shapes = Array.from(container.querySelectorAll<SVGElement>(SHAPE));
    expect(shapes.length).toBeGreaterThan(19);
    expect(shapes.every((s) => s.getAttribute("pathLength") === "1")).toBe(true);
    // DOM order is the order of the rows and of the strokes inside them: the slots follow each other without overlap
    const slots = shapes.map((s) => ({ at: num(s.style.getPropertyValue("--gd")), len: num(s.style.getPropertyValue("--gm")) }));
    expect(slots.every((s) => Number.isFinite(s.at) && s.len > 0)).toBe(true);
    for (let i = 1; i < slots.length; i++) expect(slots[i]!.at).toBeGreaterThanOrEqual(slots[i - 1]!.at + slots[i - 1]!.len - 0.011);
    // each glyph's glint is written on its icon, after the glyph's last stroke
    for (const ico of Array.from(container.querySelectorAll<HTMLElement>(".sb-rows .sb-ico"))) {
      const strokes = Array.from(ico.querySelectorAll<SVGElement>("path, circle, rect, line, polyline, ellipse")).map((s) => num(s.style.getPropertyValue("--gd")) + num(s.style.getPropertyValue("--gm")));
      expect(num(ico.style.getPropertyValue("--ge"))).toBeGreaterThanOrEqual(Math.max(...strokes) - 0.011);
    }
  });

  it("ends by itself, keeps the strokes as they are and never starts again: not on hover, not on a route change, not on a re-render, not on a remount", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, unmount } = mount();
    const frame = frameOf(container);
    expect(frame.getAttribute("data-draw")).toBe("run");
    expect(sequenceSeen()).toBe(true);
    const total = sidebarSequence(Array.from(container.querySelectorAll(".sb-rows > li")).map((li) => li.querySelectorAll(SHAPE).length)).totalMs;
    act(() => void vi.advanceTimersByTime(total + 400));
    expect(frame.hasAttribute("data-draw")).toBe(false);
    // hover (the peek) and the keys
    const aside = screen.getByRole("complementary", { name: "Hauptnavigation" });
    fireEvent.pointerEnter(aside, { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(600));
    fireEvent.pointerLeave(aside, { pointerType: "mouse" });
    expect(frame.hasAttribute("data-draw")).toBe(false);
    // a route change and a re-render
    act(() => useUi.setState({ page: "trades" }));
    act(() => useUi.setState({ page: "markt" }));
    expect(frame.hasAttribute("data-draw")).toBe(false);
    // a remount (the window grows across 768 px)
    unmount();
    const again = mount();
    expect(frameOf(again.container).hasAttribute("data-draw")).toBe(false);
  });

  it("reduced motion: nothing animates, nothing is held back – and the one run is not used up", () => {
    fx.reduced = true;
    const { container } = mount();
    expect(frameOf(container).hasAttribute("data-draw")).toBe(false);
    expect(sequenceSeen()).toBe(false);
    expect(container.querySelector(".sb-rows > li")!.hasAttribute("style")).toBe(true);
    expect(container.querySelector(".sb-rows > li")!.getAttribute("style")).not.toContain("--sq-d");
  });

  it("waits while the intro's stage covers the app, then plays – once", () => {
    act(() => setIntroPhase("stage"));
    const { container } = mount();
    const frame = frameOf(container);
    expect(frame.getAttribute("data-draw")).toBe("wait");
    expect(sequenceSeen()).toBe(false);
    act(() => setIntroPhase("build"));
    expect(frame.getAttribute("data-draw")).toBe("run");
    expect(sequenceSeen()).toBe(true);
    expect(container.querySelector<HTMLElement>(".sb-rows > li")!.style.getPropertyValue("--sq-d")).toBe("0ms");
  });

  it("waits in the window BEFORE the stage starts too (the first render comes before the intro sets its phase) – the bug that hid it", () => {
    // a real browser, a fresh session, the overview: the intro is about to start although its phase still reads „off“
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0 Safari/537.36");
    const { container } = mount();
    const frame = frameOf(container);
    expect(frame.getAttribute("data-draw")).toBe("wait");
    act(() => setIntroPhase("stage"));
    expect(frame.getAttribute("data-draw")).toBe("wait");
    // the stage is skipped: straight to done
    act(() => setIntroPhase("done"));
    expect(frame.getAttribute("data-draw")).toBe("run");
  });

  it("no intro this session (it was seen, or another page was opened): the sequence starts at the first look", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0 Safari/537.36");
    sessionStorage.setItem("tj2-intro", "1");
    const { container } = mount();
    expect(frameOf(container).getAttribute("data-draw")).toBe("run");
  });

  it("waits in a hidden tab (animations keep their clock there) and plays when the tab is seen", () => {
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { container } = mount();
    const frame = frameOf(container);
    expect(frame.getAttribute("data-draw")).toBe("wait");
    state.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(frame.getAttribute("data-draw")).toBe("run");
  });

  it("nothing stays invisible: a stage that never lifts does not hold the rows back for ever", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => setIntroPhase("stage"));
    const { container } = mount();
    const frame = frameOf(container);
    expect(frame.getAttribute("data-draw")).toBe("wait");
    act(() => void vi.advanceTimersByTime(SEQ_WAIT_MAX_MS + 100));
    expect(frame.hasAttribute("data-draw")).toBe(false);
  });

  it("a folded group takes no slot: the visible rows follow each other without a gap", () => {
    useUi.setState({ sidebar: "open", sidebarClosed: ["auswerten", "konto"] });
    screenOf(1700);
    const { container } = mount();
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".sb-rows > li")).filter((li) => !li.closest('[data-fold="closed"]'));
    const delays = rows.map((li) => num(li.style.getPropertyValue("--sq-d")));
    expect(rows.length).toBeLessThan(19);
    expect(delays).toEqual(rows.map((_, i) => i * SEQ.rowStepMs));
  });
});

describe("icon-only parts name themselves", () => {
  it("rail rows: aria-label always (the name), the tooltip only while the names are not open; open, the words say it", () => {
    mount();
    const aside = screen.getByRole("complementary", { name: "Hauptnavigation" });
    const link = within(aside).getByRole("link", { name: "Trades" });
    expect(link).toHaveAttribute("aria-label", "Trades");
    expect(link).toHaveAttribute("title", "Trades");
    expect(within(aside).getByTestId("sidebar-toggle")).toHaveAttribute("title", "Seitenleiste anheften");
    expect(within(aside).getByTestId("sidebar-night")).toHaveAttribute("title", "Nachtmodus");
    expect(within(aside).getByTestId("sidebar-user").getAttribute("title")).toBe(within(aside).getByTestId("sidebar-user").getAttribute("aria-label"));
  });

  it("pinned open the rows show their words: no tooltip that would repeat them", () => {
    useUi.setState({ sidebar: "open" });
    screenOf(1700);
    mount();
    const aside = screen.getByRole("complementary", { name: "Hauptnavigation" });
    expect(within(aside).getByRole("link", { name: /Trades/ })).not.toHaveAttribute("title");
    expect(within(aside).getByTestId("sidebar-toggle")).not.toHaveAttribute("title");
  });
});
