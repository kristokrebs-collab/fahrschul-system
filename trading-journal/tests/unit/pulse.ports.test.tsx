/**
 * P01 pulse ports: ScrubTimeline, MilestoneRail, MagnifyRow, FullscreenWipe, GlyphZoom, ReelWindow, CardSpread,
 * OrbitSpread, LaunchGrid – pure choreography helpers, reduced-motion end states, zero React renders per frame,
 * finite loops, a11y contracts.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { motionValue } from "motion/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

import * as pulse from "@/motion/pulse";
import { CardSpread, dealRotation, fanPose } from "@/motion/pulse/CardSpread";
import { FullscreenWipe, WipeItem, wipeItemDelay } from "@/motion/pulse/FullscreenWipe";
import { CONFIG as GLYPH, GlyphZoom, deepestPoint, glyphCamera } from "@/motion/pulse/GlyphZoom";
import { CONFIG as LAUNCH, LaunchGrid, LaunchSlot, launchAt } from "@/motion/pulse/LaunchGrid";
import { MagnifyRow, magnifyBell, magnifyLayout } from "@/motion/pulse/MagnifyRow";
import { MilestoneRail, pinnedReveal, segmentSeconds } from "@/motion/pulse/MilestoneRail";
import { OrbitSpread, orbitPose, orbitProgress } from "@/motion/pulse/OrbitSpread";
import { CONFIG as REEL, ReelWindow, collapseAt, reelAt, reelStart, spreadAt } from "@/motion/pulse/ReelWindow";
import { ScrubTimeline, formatSeconds, playStep, scrubKey, spanProgress, timeAtX } from "@/motion/pulse/ScrubTimeline";
import { stagger, tween } from "@/motion/tokens";

const FAKE: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] };

beforeEach(() => {
  fx.reduced = false;
});
afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-safe-fx");
});

it("the pulse barrel exports every port with its CONFIG", () => {
  for (const name of ["ScrubTimeline", "MilestoneRail", "MagnifyRow", "FullscreenWipe", "GlyphZoom", "ReelWindow", "CardSpread", "OrbitSpread", "LaunchGrid"]) expect(pulse).toHaveProperty(name);
  for (const name of ["SCRUB_TIMELINE_CONFIG", "MILESTONE_RAIL_CONFIG", "MAGNIFY_ROW_CONFIG", "FULLSCREEN_WIPE_CONFIG", "GLYPH_ZOOM_CONFIG", "REEL_WINDOW_CONFIG", "CARD_SPREAD_CONFIG", "ORBIT_SPREAD_CONFIG", "LAUNCH_GRID_CONFIG"]) expect(pulse).toHaveProperty(name);
});

/* ------------------------------------------------------------------ ScrubTimeline */

describe("ScrubTimeline", () => {
  const spans = [
    { id: "a", label: "Asia-Range", start: 0, duration: 4, meta: "Range" },
    { id: "b", label: "Einstieg", start: 5, duration: 2, tone: "win" as const },
  ];

  it("pure time math", () => {
    expect(spanProgress(spans[1]!, 4)).toBe(0);
    expect(spanProgress(spans[1]!, 6)).toBe(0.5);
    expect(spanProgress({ start: 3, duration: 0 }, 3)).toBe(1);
    expect(scrubKey("ArrowRight", false, 5, 10, 1, 3)).toBe(6);
    expect(scrubKey("ArrowLeft", true, 5, 10, 1, 3)).toBe(2);
    expect(scrubKey("End", false, 5, 10, 1, 3)).toBe(10);
    expect(scrubKey("x", false, 5, 10, 1, 3)).toBeNull();
    expect(timeAtX(150, 100, 200, 10)).toBe(2.5);
    expect(timeAtX(0, 100, 200, 10)).toBe(0);
    expect(playStep(9, 1, 10, 10, 1, false)).toEqual([10, true]);
    expect(playStep(9.5, 1, 10, 10, 1, true)[0]).toBeCloseTo(0.5);
    expect(formatSeconds(5.25)).toBe("5,3 s");
  });

  it("a slider whose time writes the DOM without React renders", () => {
    const t = motionValue(0);
    let commits = 0;
    const { container } = render(
      <Profiler id="scrub" onRender={() => commits++}>
        <ScrubTimeline label="Replay" total={10} spans={spans} time={t} />
      </Profiler>,
    );
    const slider = screen.getByRole("slider", { name: "Replay" });
    expect(screen.getByRole("list", { name: "Replay" }).children).toHaveLength(2);
    const mounted = commits;
    act(() => t.set(6));
    expect(slider).toHaveAttribute("aria-valuenow", "6.000");
    expect(slider).toHaveAttribute("aria-valuetext", "6,0 s");
    const rows = container.querySelectorAll("[data-started]");
    expect(rows.length).toBe(4); // label + bar of both rows
    act(() => t.set(2));
    expect(container.querySelectorAll("[data-started]").length).toBe(2);
    expect(commits).toBe(mounted);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(t.get()).toBeCloseTo(2.1);
    fireEvent.keyDown(slider, { key: "End" });
    expect(t.get()).toBe(10);
  });

  it("plays from the clock, stops at the end (finite) and commits once", () => {
    vi.useFakeTimers(FAKE);
    const t = motionValue(10);
    const onCommit = vi.fn();
    render(<ScrubTimeline label="Replay" total={10} spans={spans} time={t} playSeconds={2} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "Abspielen" }));
    expect(t.get()).toBe(0);
    act(() => void vi.advanceTimersByTime(1000));
    expect(t.get()).toBeGreaterThan(3);
    expect(t.get()).toBeLessThan(10);
    act(() => void vi.advanceTimersByTime(2000));
    expect(t.get()).toBe(10);
    expect(onCommit).toHaveBeenCalledWith(10);
    expect(screen.getByRole("button", { name: "Abspielen" })).toBeInTheDocument();
  });

  it("reduced motion: no auto-play", () => {
    fx.reduced = true;
    vi.useFakeTimers(FAKE);
    const t = motionValue(4);
    render(<ScrubTimeline label="Replay" total={10} time={t} autoPlay />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(t.get()).toBe(4);
  });
});

/* ------------------------------------------------------------------ MilestoneRail */

const ITEMS = [
  { id: "a", title: "Regeln", date: "Woche 1" },
  { id: "b", title: "20 Trades", text: "mit Screenshot" },
  { id: "c", title: "Nur A+" },
];

describe("MilestoneRail", () => {
  it("draw timing stays ≈ tween.draw and the pinned reveal runs 74 % → 49 %", () => {
    expect(segmentSeconds(3)).toBeCloseTo(tween.draw.duration / 2);
    expect(segmentSeconds(40)).toBeGreaterThanOrEqual(stagger.lead);
    expect(pinnedReveal(800, 1000)).toBe(0);
    expect(pinnedReveal(490, 1000)).toBe(1);
    expect(pinnedReveal(615, 1000)).toBeCloseTo(0.5);
  });

  it("an ordered list with the current step; reduced motion is static", () => {
    fx.reduced = true;
    const { rerender } = render(<MilestoneRail items={ITEMS} active={1} label="Plan" />);
    const list = screen.getByRole("list", { name: "Plan" });
    expect(list.tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("mit Screenshot")).toBeVisible();
    // pinned falls back to the plain horizontal row under reduced motion
    rerender(<MilestoneRail items={ITEMS} orientation="horizontal" pinned label="Plan" />);
    expect(screen.getByRole("list", { name: "Plan" })).toHaveAttribute("data-orientation", "horizontal");
  });

  it("pinned: a sticky section whose track follows the scroll", () => {
    render(<MilestoneRail items={ITEMS} orientation="horizontal" pinned label="Roadmap" />);
    const section = document.querySelector('[data-orientation="pinned"]') as HTMLElement;
    expect(section).not.toBeNull();
    expect(section.style.height).toMatch(/calc\(.*100svh.*\)/);
    expect(section.style.height).toMatch(/\d+px/);
    expect(screen.getByRole("list", { name: "Roadmap" }).children).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ MagnifyRow */

describe("MagnifyRow", () => {
  it("windowed Gaussian bell and a symmetric, centred magnification", () => {
    expect(magnifyBell(0)).toBe(1);
    expect(magnifyBell(140)).toBe(0);
    expect(magnifyBell(48)).toBeGreaterThan(magnifyBell(96));
    const { scale, shift } = magnifyLayout(5, 2 * 50 + 22, 1, 44, 6);
    expect(scale[2]).toBeCloseTo(1.8);
    expect(shift[2]).toBeCloseTo(0);
    expect(shift[1]).toBeCloseTo(-shift[3]!);
    expect(magnifyLayout(5, 122, 0, 44, 6).scale.every((s) => s === 1)).toBe(true);
  });

  it("a toolbar with roving focus and labelled buttons", () => {
    const onSelect = vi.fn();
    render(<MagnifyRow label="Gruppen" items={["Alle", "Scalper", "Swing"].map((l, i) => ({ id: l, label: l, icon: <svg />, active: i === 0, onSelect: i === 2 ? onSelect : undefined }))} />);
    const bar = screen.getByRole("toolbar", { name: "Gruppen" });
    const [a, b, c] = screen.getAllByRole("button");
    expect(a).toHaveAttribute("tabindex", "0");
    expect(b).toHaveAttribute("tabindex", "-1");
    a!.focus();
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(b).toHaveFocus();
    fireEvent.keyDown(bar, { key: "End" });
    expect(c).toHaveFocus();
    fireEvent.click(c!);
    expect(onSelect).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Alle" })).toHaveAttribute("aria-pressed", "true");
  });
});

/* ------------------------------------------------------------------ FullscreenWipe */

describe("FullscreenWipe", () => {
  it("content follows the pack stagger from 620 ms", () => {
    expect(wipeItemDelay(0)).toBeCloseTo(0.62);
    expect(wipeItemDelay(2)).toBeCloseTo(0.81);
  });

  it("a portalled dialog: Escape closes; autoCloseMs closes by itself", () => {
    vi.useFakeTimers(FAKE);
    const onClose = vi.fn();
    const { rerender } = render(
      <FullscreenWipe open onClose={onClose} label="Bericht bereit" autoCloseMs={3000}>
        <WipeItem index={0}>
          <h2>Bericht bereit.</h2>
        </WipeItem>
      </FullscreenWipe>,
    );
    const dialog = screen.getByRole("dialog", { name: "Bericht bereit" });
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByRole("button", { name: "Schließen" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(3100));
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(
      <FullscreenWipe open={false} onClose={onClose} label="Bericht bereit">
        <span />
      </FullscreenWipe>,
    );
  });

  it("closing wipes the panel out and unmounts it", async () => {
    fx.reduced = true;
    const { rerender } = render(
      <FullscreenWipe open onClose={() => {}} label="Bericht bereit">
        <p>Inhalt</p>
      </FullscreenWipe>,
    );
    expect(screen.getByRole("dialog", { name: "Bericht bereit" })).toBeInTheDocument();
    rerender(
      <FullscreenWipe open={false} onClose={() => {}} label="Bericht bereit">
        <p>Inhalt</p>
      </FullscreenWipe>,
    );
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 2000 });
  });

  it("reduced motion: no red curtain", () => {
    fx.reduced = true;
    render(
      <FullscreenWipe open onClose={() => {}} label="Ziel erreicht">
        <p>Glückwunsch</p>
      </FullscreenWipe>,
    );
    expect(screen.getByRole("dialog", { name: "Ziel erreicht" })).toBeInTheDocument();
    expect(document.querySelector(".bg-signal.z-\\[77\\]")).toBeNull();
  });
});

/* ------------------------------------------------------------------ GlyphZoom */

describe("GlyphZoom", () => {
  it("camera: scale grows from 1 to e^span, roll to −5°", () => {
    expect(glyphCamera(0, 3.4).scale).toBe(1);
    expect(Math.abs(glyphCamera(0, 3.4).roll)).toBe(0);
    const end = glyphCamera(1, 3.4);
    expect(end.scale).toBeCloseTo(Math.exp(3.4));
    expect(end.roll).toBe(GLYPH.roll);
    expect(glyphCamera(0.5, 3.4).scale).toBeLessThan(glyphCamera(0.8, 3.4).scale);
  });

  it("deepest point of a stroke is its centre", () => {
    const w = 21;
    const h = 9;
    const ink = new Uint8Array(w * h);
    for (let y = 1; y < 8; y++) for (let x = 2; x < 19; x++) ink[y * w + x] = 1;
    const p = deepestPoint(ink, w, h);
    expect(p.y).toBe(4);
    expect(p.d).toBeGreaterThanOrEqual(3);
  });

  it("the content stays inert until the stroke covers the stage", () => {
    const p = motionValue(0);
    const { container } = render(
      <GlyphZoom word="+2,1R" progress={p} label="Share-Karte" className="h-40">
        <button type="button">Teilen</button>
      </GlyphZoom>,
    );
    const stage = screen.getByRole("group", { name: "Share-Karte" });
    const content = container.querySelector('[data-pulse="glyph-zoom"] > div') as HTMLElement;
    expect(content).toHaveAttribute("inert");
    expect(content).toHaveAttribute("aria-hidden", "true");
    expect(stage).not.toHaveAttribute("data-covered");
    act(() => p.set(GLYPH.cover + 0.01));
    expect(stage).toHaveAttribute("data-covered");
    expect(content).not.toHaveAttribute("inert");
    expect(screen.getByText("+2,1R")).toHaveClass("sr-only");
  });

  it("reduced motion: opening jumps to the revealed content", () => {
    fx.reduced = true;
    const onDone = vi.fn();
    render(
      <GlyphZoom word="NEU" open label="Widget" onDone={onDone}>
        <p>Inhalt</p>
      </GlyphZoom>,
    );
    expect(screen.getByRole("group", { name: "Widget" })).toHaveAttribute("data-covered");
  });

  it("open dives over time and stops (finite loop)", () => {
    vi.useFakeTimers(FAKE);
    const onDone = vi.fn();
    const { rerender } = render(
      <GlyphZoom word="WIN" label="Dive" duration={1} onDone={onDone}>
        <p>x</p>
      </GlyphZoom>,
    );
    rerender(
      <GlyphZoom word="WIN" open label="Dive" duration={1} onDone={onDone}>
        <p>x</p>
      </GlyphZoom>,
    );
    act(() => void vi.advanceTimersByTime(1200));
    expect(onDone).toHaveBeenCalledWith(true);
    expect(screen.getByRole("group", { name: "Dive" })).toHaveAttribute("data-covered");
  });
});

/* ------------------------------------------------------------------ ReelWindow */

describe("ReelWindow", () => {
  it("cuts accelerate into the collapse, then the spread", () => {
    expect(reelStart(0, 7)).toBe(0);
    expect(reelStart(6, 7)).toBeCloseTo(REEL.lastCut);
    expect(reelStart(1, 7)).toBeLessThan(reelStart(6, 7) - reelStart(5, 7));
    expect(reelAt(0, 4)).toBe(0);
    expect(reelAt(REEL.lastCut + 1, 4)).toBe(3);
    expect(reelAt(REEL.collapseAt + REEL.collapseDur + 1, 4)).toBe(-1);
    expect(collapseAt(REEL.collapseAt - 1)).toBe(0);
    expect(collapseAt(REEL.collapseAt + REEL.collapseDur)).toBe(1);
    expect(spreadAt(REEL.spreadAt + REEL.spreadDur)).toBe(1);
  });

  it("reduced motion: the tableau at rest, swapped lines, labelled figure", () => {
    fx.reduced = true;
    const { container } = render(<ReelWindow label="Beispiele" lines={["Deine Setups", "in Bewegung"]} swapLines={["Trade the best.", "Vergiss den Rest."]} reels={[1, 2, 3].map((i) => <span key={i}>Reel {i}</span>)} />);
    const fig = screen.getByRole("figure", { name: "Beispiele" });
    expect(fig).toBeInTheDocument();
    const cards = container.querySelectorAll('[data-pulse="reel-window"] > div.absolute.overflow-hidden.rounded-\\[1\\.2cqw\\]');
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(Number((c as HTMLElement).style.opacity)).toBe(1);
      expect((c as HTMLElement).style.transform).toBe("translate(-50%,-50%)");
    }
    expect(fig.textContent).toContain("Trade the best.");
  });
});

/* ------------------------------------------------------------------ CardSpread */

describe("CardSpread", () => {
  it("fan poses: a compact stack opens into the diagonal fan", () => {
    const a = fanPose(0, 8, 0);
    const b = fanPose(0, 8, 1);
    expect(Math.abs(b.x)).toBeGreaterThan(Math.abs(a.x));
    expect(a.scale).toBeCloseTo(0.68);
    expect(b.scale).toBe(1);
    expect(dealRotation(0, 3)).toBe(-dealRotation(2, 3));
    expect(dealRotation(1, 3)).toBe(0);
  });

  it("deal: the cards keep their layout, visible at once under reduced motion", () => {
    fx.reduced = true;
    const { container } = render(
      <CardSpread className="grid grid-cols-3" label="Tarife">
        <article>Free</article>
        <article>Pro</article>
        <article>Premium</article>
      </CardSpread>,
    );
    const items = container.querySelectorAll('[data-variant="deal"] > div');
    expect(items).toHaveLength(3);
    for (const i of items) expect((i as HTMLElement).style.opacity).toBe("");
  });

  it("deal: dealt on view, ending at transform none (finite)", () => {
    vi.useFakeTimers(FAKE);
    const { container } = render(
      <CardSpread label="Tarife">
        <article>Free</article>
        <article>Pro</article>
      </CardSpread>,
    );
    const items = Array.from(container.querySelectorAll('[data-variant="deal"] > div')) as HTMLElement[];
    act(() => void vi.advanceTimersByTime(50));
    expect(items[1]!.style.transform).toMatch(/rotate/);
    act(() => void vi.advanceTimersByTime(3000));
    for (const i of items) expect(i.style.transform).toBe("none");
  });

  it("fan: a toggle button with aria-expanded", () => {
    fx.reduced = true;
    const onOpenChange = vi.fn();
    render(
      <CardSpread variant="fan" label="Strategien" cards={[<i key="1" />, <i key="2" />]} onOpenChange={onOpenChange} autoplay={false}>
        <h3>Strategien im Vergleich</h3>
      </CardSpread>,
    );
    const btn = screen.getByRole("button", { name: "Strategien" });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });
});

/* ------------------------------------------------------------------ OrbitSpread */

describe("OrbitSpread", () => {
  it("the measured opening curve and the depth of the ring", () => {
    expect(orbitProgress(0)).toBe(0);
    expect(orbitProgress(1400)).toBeCloseTo(0.52);
    expect(orbitProgress(5000)).toBe(1);
    const front = orbitPose(4, 8, 1); // θ = 90° → bottom / front
    const back = orbitPose(0, 8, 1); // θ = −90° → top / back
    expect(front.scale).toBeGreaterThan(back.scale);
    expect(front.z).toBeGreaterThan(back.z);
    expect(orbitPose(0, 8, 0).rotate).toBe(-12);
  });

  it("reduced motion: the open ring and the copy at once; arrows turn the ring", () => {
    fx.reduced = true;
    const { container } = render(
      <OrbitSpread label="Profil" listLabel="Eigenschaften" items={["A", "B", "C", "D", "E", "F"].map((k) => <span key={k}>{k}</span>)}>
        <h3>Dein Profil.</h3>
      </OrbitSpread>,
    );
    const group = screen.getByRole("group", { name: "Profil" });
    expect(group).toHaveAttribute("data-open");
    expect(screen.getByRole("list", { name: "Eigenschaften" }).children).toHaveLength(6);
    const first = container.querySelector("li") as HTMLElement;
    const before = first.style.transform;
    fireEvent.keyDown(group, { key: "ArrowRight" });
    act(() => void 0);
    expect(first.style.transform).not.toBe(before);
  });
});

/* ------------------------------------------------------------------ LaunchGrid */

describe("LaunchGrid", () => {
  it("the end frame is at rest: flat camera, aside home, hud sharp, last slot shown", () => {
    const f = launchAt(LAUNCH.end, 4, 5);
    expect(f.panel).toBe(1);
    expect(Math.abs(f.camRot)).toBeLessThan(0.05);
    expect(f.aside.x).toBe(0);
    expect(f.hud).toEqual({ o: 1, y: 0, blur: 0 });
    expect(f.slot).toEqual([0, 0, 0, 1]);
    expect(f.cards[0]!.o).toBe(1);
    expect(f.cards[1]!.o).toBe(0); // collapsed under the hero card
    const mid = launchAt(1.0, 4, 5);
    expect(mid.slot.filter((o) => o > 0).length).toBeGreaterThanOrEqual(1);
    expect(launchAt(0, 4, 5).panel).toBe(0);
  });

  it("reduced motion: the rest frame, real readable content, last slot visible", () => {
    fx.reduced = true;
    const { container } = render(
      <LaunchGrid label="PRO" slots={["Gefühl", "Disziplin"]} hud={<button type="button">Pro starten</button>} aside={<p>12 €</p>}>
        <h2>
          Trade mit <LaunchSlot />
        </h2>
      </LaunchGrid>,
    );
    expect(screen.getByRole("region", { name: "PRO" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pro starten" })).toBeVisible();
    const slots = container.querySelectorAll("h2 [style]");
    expect(Number((slots[1] as HTMLElement).style.opacity)).toBe(1);
    expect(Number((slots[0] as HTMLElement).style.opacity)).toBe(0);
  });

  it("runs once to rest (finite) without blur under safe-fx", () => {
    vi.useFakeTimers(FAKE);
    document.documentElement.setAttribute("data-safe-fx", "");
    const onDone = vi.fn();
    const { container } = render(
      <LaunchGrid label="PRO" hud={<span>Los</span>} onDone={onDone}>
        <h2>Hallo</h2>
      </LaunchGrid>,
    );
    const hud = container.querySelector('[data-pulse="launch-grid"] > div:last-child') as HTMLElement;
    act(() => void vi.advanceTimersByTime(LAUNCH.hud.t0 * 1000 + 150));
    expect(hud.style.filter).toBe("none");
    act(() => void vi.advanceTimersByTime(3000));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(hud.style.transform).toBe("none");
  });
});
