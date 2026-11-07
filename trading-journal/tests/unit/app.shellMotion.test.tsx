/**
 * Runde 10 – the shell's richer motion: the sidebar's peek (an overlay over the page, never a shift), the once-per-session icon
 * draw-in, the directed page slide, the burger, the centre button's glint, the tightened menu and the finder's hits.
 * Pixels and frames are measured in `tests/e2e/shell-motion.spec.ts`; here the logic and the markup contracts.
 */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

import { Burger } from "@/app/Burger";
import { closeCommandNav, CommandNav, openCommandNav } from "@/app/CommandNav";
import { Dock } from "@/app/Dock";
import { HeaderTicker } from "@/app/HeaderTicker";
import { NAV_GROUPS } from "@/app/navGroups";
import { pageDirection, pageShiftPx } from "@/app/PageHost";
import { DRAW_KEY, DRAW_MS, prepareStrokes, redrawStrokes, useIdleCycle } from "@/app/shellFx";
import { Sidebar } from "@/app/Sidebar";
import { peekOpen, PEEK } from "@/app/useSidebarPeek";
import { priceMv } from "@/market/motionValues";
import { MotionRoot } from "@/motion/MotionRoot";
import { NAV_ORDER, PAGES, SLIDE_ORDER, useUi } from "@/store/uiStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const realMatchMedia = window.matchMedia;
/** A screen `width` px wide; `hover` = a mouse; `reduce` = reduced motion (the hook is mocked above). */
function screen_(width: number, { hover = true, reduce = false }: { hover?: boolean; reduce?: boolean } = {}) {
  fx.reduced = reduce;
  window.matchMedia = ((q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    let matches = (min ? width >= Number(min[1]) : true) && (max ? width <= Number(max[1]) : true);
    if (/max-height/.test(q)) matches = false;
    if (/hover:\s*hover/.test(q)) matches = hover;
    else if (/pointer/.test(q)) matches = false;
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

afterEach(() => {
  fx.reduced = false;
  vi.restoreAllMocks();
  window.matchMedia = realMatchMedia;
  document.documentElement.style.removeProperty("--sidebar-w");
  vi.useRealTimers();
});

describe("sidebar peek: the decision", () => {
  const rest = { hover: false, focus: false, held: false, dismissed: false };
  it("opens on hover, keyboard focus or a touch hold; only while the rail is not pinned; Escape beats all", () => {
    expect(peekOpen(rest, true)).toBe(false);
    expect(peekOpen({ ...rest, hover: true }, true)).toBe(true);
    expect(peekOpen({ ...rest, focus: true }, true)).toBe(true);
    expect(peekOpen({ ...rest, held: true }, true)).toBe(true);
    expect(peekOpen({ ...rest, hover: true }, false)).toBe(false);
    expect(peekOpen({ hover: true, focus: true, held: true, dismissed: true }, true)).toBe(false);
  });
  it("is hurried by nothing: a crossing pointer does not open it, a slip off the edge does not close it", () => {
    expect(PEEK.openMs).toBeGreaterThanOrEqual(80);
    expect(PEEK.closeMs).toBeGreaterThan(PEEK.openMs * 2);
    expect(PEEK.longPressMs).toBeGreaterThanOrEqual(400);
  });
});

describe("sidebar: the rail peeks over the page", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    useUi.setState({ page: "overview", sidebar: "auto", sidebarClosed: null, editor: { open: false, fromFab: false } });
  });
  const aside = () => screen.getByRole("complementary", { name: "Hauptnavigation" });
  const frame = () => aside().parentElement as HTMLElement;
  const mount = () =>
    render(
      <MotionRoot>
        <Sidebar />
      </MotionRoot>,
    );

  it("the page keeps its 64 px: the slot never grows, the open aside is only unclipped (`data-open`), the frame takes no pointer", async () => {
    screen_(1024);
    mount();
    const slot = frame().parentElement as HTMLElement;
    expect(slot.style.width).toBe("64px");
    expect(aside().hasAttribute("data-expanded")).toBe(false);
    expect(aside().hasAttribute("data-open")).toBe(false);
    expect(frame().className).toContain("pointer-events-none");
    expect(aside().className).toContain("pointer-events-auto");
    fireEvent.pointerEnter(aside(), { pointerType: "mouse" });
    // a pointer that only crosses does not open it
    expect(aside().hasAttribute("data-open")).toBe(false);
    await waitFor(() => expect(aside().hasAttribute("data-open")).toBe(true), { timeout: 1500 });
    expect(frame().hasAttribute("data-peek")).toBe(true);
    // an overlay: nothing the page depends on moved
    expect(slot.style.width).toBe("64px");
    expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe("64px");
    // leaving closes it after a pause, not at once
    fireEvent.pointerLeave(aside(), { pointerType: "mouse" });
    expect(aside().hasAttribute("data-open")).toBe(true);
    await waitFor(() => expect(aside().hasAttribute("data-open")).toBe(false), { timeout: 1500 });
  });

  it("a pointer that returns within the pause keeps it open", async () => {
    screen_(1024);
    mount();
    fireEvent.pointerEnter(aside(), { pointerType: "mouse" });
    await waitFor(() => expect(aside().hasAttribute("data-open")).toBe(true), { timeout: 1500 });
    fireEvent.pointerLeave(aside(), { pointerType: "mouse" });
    fireEvent.pointerEnter(aside(), { pointerType: "mouse" });
    await new Promise((r) => setTimeout(r, PEEK.closeMs + 120));
    expect(aside().hasAttribute("data-open")).toBe(true);
  });

  it("keyboard focus opens it at once; Escape closes it and it stays closed until focus comes back", async () => {
    screen_(1024);
    mount();
    // jsdom has no keyboard modality: say the focus is a keyboard one
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, sel: string) {
      return sel === ":focus-visible" ? true : matches.call(this, sel);
    });
    const link = within(aside()).getByRole("link", { name: "Trades" });
    act(() => link.focus());
    await waitFor(() => expect(aside().hasAttribute("data-open")).toBe(true));
    fireEvent.keyDown(aside(), { key: "Escape" });
    await waitFor(() => expect(aside().hasAttribute("data-open")).toBe(false));
    // leaving focus and coming back re-arms it
    act(() => link.blur());
    act(() => within(aside()).getByRole("link", { name: "Markt" }).focus());
    await waitFor(() => expect(aside().hasAttribute("data-open")).toBe(true));
  });

  it("touch (no hover): the foot button opens the names first, the next tap pins; a tap outside lets go", async () => {
    screen_(1024, { hover: false });
    mount();
    const toggle = screen.getByTestId("sidebar-toggle");
    fireEvent.click(toggle);
    expect(aside().hasAttribute("data-open")).toBe(true);
    expect(aside().hasAttribute("data-expanded")).toBe(false);
    // a tap outside ends it
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(aside().hasAttribute("data-open")).toBe(false));
    // open again, then the second tap pins
    fireEvent.click(toggle);
    expect(aside().hasAttribute("data-open")).toBe(true);
    fireEvent.click(toggle);
    expect(useUi.getState().sidebar).toBe("open");
    expect(aside().hasAttribute("data-expanded")).toBe(true);
  });

  it("touch: a long press on a row opens the names and the lifted finger does not open the page", async () => {
    screen_(1024, { hover: false });
    mount();
    const link = within(aside()).getByRole("link", { name: "Trades" });
    fireEvent.pointerDown(link, { pointerType: "touch", clientX: 30, clientY: 100 });
    await waitFor(() => expect(aside().hasAttribute("data-open")).toBe(true), { timeout: 1500 });
    fireEvent.pointerUp(link, { pointerType: "touch" });
    fireEvent.click(link);
    expect(useUi.getState().page).toBe("overview");
    // a normal tap afterwards navigates
    fireEvent.pointerDown(link, { pointerType: "touch", clientX: 30, clientY: 100 });
    fireEvent.pointerUp(link, { pointerType: "touch" });
    fireEvent.click(link);
    expect(useUi.getState().page).toBe("trades");
  });

  it("every row carries its index (`--i`) for the staggered labels; the rail names rows by aria-label while the words wait, clipped", () => {
    screen_(1024);
    mount();
    const rows = Array.from(aside().querySelectorAll<HTMLElement>("li[style]"));
    expect(rows.map((r) => r.style.getPropertyValue("--i"))).toEqual(NAV_GROUPS.flatMap((g) => g.pages).map((_, i) => String(i)));
    const link = within(aside()).getByRole("link", { name: "Handelsplan" });
    expect(link).toHaveAttribute("aria-label", "Handelsplan");
    expect(link.querySelector(".sb-lbl")).not.toBeNull();
    // a row is as wide as it can be hit (the rail's 48 px at rest, the full row once the panel is open – `shell-motion.css`)
    expect(link.className).toContain("sb-row");
    // the spring is a CSS curve, written once on the frame
    expect(frame().style.getPropertyValue("--sb-ease")).toMatch(/^linear\(/);
    expect(frame().style.getPropertyValue("--sb-ms")).toMatch(/^\d+ms$/);
  });

  it("pinned open (the reader's „Anheften“): no clip, the group titles fold their rows, nothing peeks", () => {
    screen_(1700);
    useUi.setState({ sidebar: "open" });
    mount();
    expect(aside().hasAttribute("data-expanded")).toBe(true);
    expect(frame().hasAttribute("data-open")).toBe(true);
    expect(frame().hasAttribute("data-peek")).toBe(false);
    fireEvent.pointerEnter(aside(), { pointerType: "mouse" });
    expect(frame().hasAttribute("data-peek")).toBe(false);
    expect(screen.getAllByTestId("sidebar-group-toggle")).toHaveLength(4);
    expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe("256px");
  });
});

describe("icon draw-in: once per session, never under reduced motion", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useUi.setState({ page: "overview", sidebar: "auto", sidebarClosed: null, editor: { open: false, fromFab: false } });
  });
  const mount = () =>
    render(
      <MotionRoot>
        <Sidebar />
      </MotionRoot>,
    );

  it("plays on the first load (the strokes get their length), is flagged for the session and ends by itself", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    screen_(1024);
    const { container, unmount } = mount();
    const frame = container.querySelector<HTMLElement>(".sb")!;
    expect(frame.getAttribute("data-draw")).toBe("run");
    const shapes = container.querySelectorAll(".sb-ico :is(path, circle, rect, line, polyline)");
    expect(shapes.length).toBeGreaterThan(19);
    expect(Array.from(shapes).every((s) => s.getAttribute("pathLength") === "1")).toBe(true);
    expect(sessionStorage.getItem(DRAW_KEY)).toBe("1");
    act(() => {
      vi.advanceTimersByTime(DRAW_MS + 50);
    });
    expect(frame.hasAttribute("data-draw")).toBe(false);
    unmount();
    // the same session: never again
    const again = mount();
    expect(again.container.querySelector(".sb")!.hasAttribute("data-draw")).toBe(false);
  });

  it("reduced motion: everything is simply there", () => {
    screen_(1024, { reduce: true });
    const { container } = mount();
    expect(container.querySelector(".sb")!.hasAttribute("data-draw")).toBe(false);
    expect(sessionStorage.getItem(DRAW_KEY)).toBeNull();
  });

  it("`prepareStrokes` is idempotent; `redrawStrokes` marks the icon for a moment and does nothing under reduced motion", async () => {
    const host = document.createElement("span");
    host.innerHTML = '<svg><path d="M0 0L5 5"/><circle r="2"/></svg>';
    prepareStrokes(host);
    prepareStrokes(host);
    expect(host.querySelector("path")!.getAttribute("pathLength")).toBe("1");
    expect(host.querySelector("circle")!.getAttribute("pathLength")).toBe("1");
    const stop = redrawStrokes(host, false);
    await waitFor(() => expect(host.hasAttribute("data-redraw")).toBe(true));
    stop();
    expect(host.hasAttribute("data-redraw")).toBe(false);
    redrawStrokes(host, true)();
    expect(host.hasAttribute("data-redraw")).toBe(false);
  });
});

describe("useIdleCycle: now and then, never a loop", () => {
  beforeEach(() => vi.useFakeTimers());
  const opts = { active: true, firstMs: 1000, everyMs: 5000, max: 2 };
  it("counts one round after the first wait, then every gap, and stops at `max`", () => {
    const { result } = renderHook(() => useIdleCycle(opts, false));
    expect(result.current).toBe(0);
    act(() => void vi.advanceTimersByTime(999));
    expect(result.current).toBe(0);
    act(() => void vi.advanceTimersByTime(2));
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current).toBe(2);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(2);
  });
  it("does nothing while inactive or under reduced motion", () => {
    const off = renderHook(() => useIdleCycle({ ...opts, active: false }, false));
    const reduced = renderHook(() => useIdleCycle(opts, true));
    act(() => void vi.advanceTimersByTime(30_000));
    expect(off.result.current).toBe(0);
    expect(reduced.result.current).toBe(0);
  });
  it("skips a round while the tab is hidden", () => {
    const { result } = renderHook(() => useIdleCycle(opts, false));
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => void vi.advanceTimersByTime(1500));
    expect(result.current).toBe(0);
    state.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(1100);
    });
    expect(result.current).toBe(1);
    state.mockRestore();
  });
});

describe("page switch: directed by the navigation", () => {
  it("the slide grows with the groups crossed: 12 px inside a group, 16 px to the neighbour (the usual Übersicht ↔ Trades), up to 24", () => {
    expect(pageShiftPx("trades", "plan")).toBe(12);
    expect(pageShiftPx("overview", "markt")).toBe(12);
    expect(pageShiftPx("overview", "trades")).toBe(16);
    expect(pageShiftPx("trades", "analyse")).toBe(20);
    expect(pageShiftPx("trades", "settings")).toBe(24);
    expect(pageShiftPx("settings", "trades")).toBe(24);
    // never longer than 24, never shorter than 12, for any pair
    for (const a of PAGES) {
      for (const b of PAGES) {
        const px = pageShiftPx(a, b);
        expect(px).toBeGreaterThanOrEqual(12);
        expect(px).toBeLessThanOrEqual(24);
      }
    }
  });
  it("the direction follows the order the reader sees: the bottom bar's tabs by default, the sidebar's groups on request", () => {
    // bottom bar: Übersicht, Trades, Markt first
    expect(pageDirection("overview", "trades")).toBe(1);
    expect(pageDirection("trades", "overview", SLIDE_ORDER)).toBe(-1);
    // sidebar: Erfassen (Trades) stands above Prüfen (Übersicht)
    expect(pageDirection("trades", "overview", NAV_ORDER)).toBe(1);
    expect(pageDirection("overview", "trades", NAV_ORDER)).toBe(-1);
    expect(pageDirection("settings", "setups", NAV_ORDER)).toBe(-1);
  });
});

describe("burger", () => {
  it("is three bars that carry `data-open` for the cross; decorative", () => {
    const { container, rerender } = render(<Burger open={false} />);
    const el = container.querySelector(".burger")!;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.querySelectorAll("i")).toHaveLength(3);
    expect(el.hasAttribute("data-open")).toBe(false);
    rerender(<Burger open />);
    expect(container.querySelector(".burger")!.hasAttribute("data-open")).toBe(true);
  });
});

describe("header ticker: the price rolls", () => {
  it("shows the odometer (readable label, de-DE) once there is a price, a dash before", () => {
    screen_(1280);
    act(() => priceMv.jump(0));
    const { container } = render(<HeaderTicker />);
    expect(container.querySelector("[data-rolling-digits]")).toBeNull();
    expect(container.textContent).toContain("–");
    act(() => priceMv.jump(65432.1));
    const digits = container.querySelector("[data-rolling-digits]");
    expect(digits).not.toBeNull();
    expect(digits!.querySelector(".sr-only")!.textContent).toBe("65.432,1");
    expect(container.querySelector("[data-header-ticker]")).toHaveAttribute("aria-hidden", "true");
    act(() => priceMv.jump(0));
  });
});

describe("bottom bar: the centre button glints now and then", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useUi.setState({ page: "overview", editor: { open: false, fromFab: false } });
  });
  it("a halo and one light pass after 6 s – not while the editor is open; the button keeps its name and action", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    screen_(390, { hover: false });
    render(
      <MotionRoot>
        <Dock />
      </MotionRoot>,
    );
    expect(document.querySelector(".fab-halo")).toBeNull();
    act(() => void vi.advanceTimersByTime(6100));
    expect(document.querySelector(".fab-halo")).not.toBeNull();
    expect(document.querySelector(".fab-sheen")).not.toBeNull();
    const bar = screen.getByRole("toolbar", { name: "Navigation" });
    expect(within(bar).getByRole("button", { name: "Trade eintragen" })).toBeInTheDocument();
    // the editor takes over: the sheen goes with the disc
    act(() => useUi.getState().openEditor({ fromFab: true }));
    expect(document.querySelector(".fab-sheen")).toBeNull();
  });
  it("reduced motion: none of it", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    screen_(390, { hover: false, reduce: true });
    render(
      <MotionRoot>
        <Dock />
      </MotionRoot>,
    );
    act(() => void vi.advanceTimersByTime(60_000));
    expect(document.querySelector(".fab-halo")).toBeNull();
  });
});

describe("menu: a bottom sheet on a phone, the wipe from 768 px; the burger turns into the cross; the finder opens softly", () => {
  beforeEach(async () => {
    installDomPolyfills();
    await bootFixtureJournal();
    useUi.setState({ page: "overview", editor: { open: false, fromFab: false } });
  });
  const mountNav = () =>
    render(
      <MotionRoot>
        <CommandNav />
      </MotionRoot>,
    );
  const settleClosed = async () => {
    act(() => closeCommandNav(true));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull(), { timeout: 3000 });
  };

  it("390 px: the head is the sheet's handle (a grabber shows it) and the close button starts as the burger, then the cross", async () => {
    screen_(390, { hover: false });
    mountNav();
    act(() => openCommandNav());
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    const handle = dialog.querySelector("[data-sheet-handle]");
    expect(handle).not.toBeNull();
    expect(handle!.querySelector("span.rounded-full")).not.toBeNull();
    const burger = within(dialog).getByRole("button", { name: "Navigation schließen" }).querySelector(".burger")!;
    await waitFor(() => expect(burger.hasAttribute("data-open")).toBe(true));
    await settleClosed();
  });

  it("1024 px: the wipe – no sheet handle", async () => {
    screen_(1024);
    mountNav();
    act(() => openCommandNav());
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    expect(dialog.querySelector("[data-sheet-handle]")).toBeNull();
    await settleClosed();
  });

  it("the finder: the answers' box is folded and inert until something is typed; the hits carry their index; the box keeps the last answers while it folds", async () => {
    screen_(1024);
    mountNav();
    act(() => openCommandNav());
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    const finder = within(dialog).getByTestId("nav-finder");
    const box = () => finder.querySelector<HTMLElement>(".sf-panel-in")!;
    expect(box().hasAttribute("inert")).toBe(true);
    const input = within(dialog).getByRole("combobox", { name: "Was willst du tun?" });
    fireEvent.change(input, { target: { value: "Wochenbericht" } });
    const list = await within(dialog).findByTestId("nav-finder-results", undefined, { timeout: 10_000 });
    expect(box().hasAttribute("inert")).toBe(false);
    const hits = Array.from(list.querySelectorAll("li"));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.getAttribute("data-i"))).toEqual(hits.map((_, i) => String(i)));
    expect(hits.every((h) => h.className.includes("sf-opt"))).toBe(true);
    // emptied: inert at once (no tab stop in a folding box), the answers leave once it is shut
    fireEvent.change(input, { target: { value: "" } });
    expect(box().hasAttribute("inert")).toBe(true);
    expect(within(dialog).queryByTestId("nav-finder-results")).not.toBeNull();
    await waitFor(() => expect(within(dialog).queryByTestId("nav-finder-results")).toBeNull(), { timeout: 2500 });
    await settleClosed();
  });
});
