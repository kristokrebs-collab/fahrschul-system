import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { layerRole, PAGE_ENTER_X, pageDirection, PageHost } from "@/app/PageHost";
import { MotionRoot } from "@/motion/MotionRoot";
import { spring } from "@/motion/tokens";
import { detachShell, restoreScroll } from "@/store/router";
import type { Page } from "@/store/uiStore";

const effects = { mounted: 0, cleaned: 0 };

/** Stateful page with an effect: proves the keep-alive layer keeps state and only reconnects effects. */
function Counter() {
  const [n, setN] = useState(0);
  useEffect(() => {
    effects.mounted += 1;
    return () => {
      effects.cleaned += 1;
    };
  }, []);
  return (
    <button type="button" onClick={() => setN((v) => v + 1)}>
      Übersicht {n}
    </button>
  );
}

function renderPage(page: Page): ReactNode {
  if (page === "overview") return <Counter />;
  return <h1>{page}</h1>;
}

const KEEP: readonly Page[] = ["overview"];

/** A painted frame + the task after it: the host takes a new page one painted frame after it arrived. */
const afterPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
/** Hands the host a new page and waits for its switch commit. */
async function switchTo(rerender: () => void): Promise<void> {
  act(() => rerender());
  await act(async () => {
    await afterPaint();
  });
}

function host(page: Page, onT?: (t: boolean) => void) {
  return (
    <MotionRoot>
      <PageHost page={page} renderPage={renderPage} keepAlive={KEEP} onTransitioning={onT} />
    </MotionRoot>
  );
}

afterEach(() => {
  detachShell();
  effects.mounted = 0;
  effects.cleaned = 0;
});

describe("PageHost pure helpers", () => {
  it("slides in tab order", () => {
    expect(pageDirection("overview", "trades")).toBe(1);
    expect(pageDirection("settings", "setups")).toBe(-1);
  });

  it("spring.pageEnter is spring.enter with 0.5 px / 2 px·s⁻¹ rest thresholds on the PAGE_ENTER_X slide (0…100 string keyframes)", () => {
    const { restDelta, restSpeed, ...base } = spring.pageEnter;
    expect(base).toEqual(spring.enter);
    expect(restDelta).toBeCloseTo((0.5 / PAGE_ENTER_X) * 100);
    expect(restSpeed).toBeCloseTo((2 / PAGE_ENTER_X) * 100);
  });

  it("assigns layer roles; keep-alive pages stay parked, others unmount", () => {
    expect(layerRole("trades", "trades", "overview", KEEP)).toBe("current");
    expect(layerRole("overview", "trades", "overview", KEEP)).toBe("leaving");
    expect(layerRole("overview", "trades", null, KEEP)).toBe("parked");
    expect(layerRole("setups", "trades", null, KEEP)).toBeNull();
  });
});

describe("PageHost", () => {
  it("keeps the overview alive while hidden: state survives, effects reconnect, other pages unmount after their exit", async () => {
    const onT = vi.fn();
    const { rerender } = render(host("overview", onT));
    act(() => screen.getByRole("button", { name: "Übersicht 0" }).click());
    expect(screen.getByRole("button", { name: "Übersicht 1" })).toBeInTheDocument();
    expect(effects.mounted).toBe(1);

    await switchTo(() => rerender(host("trades", onT)));
    expect(onT).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("heading", { name: "trades" })).toBeInTheDocument();
    await waitFor(() => expect(onT).toHaveBeenLastCalledWith(false), { timeout: 1500 });
    // parked once the switch has settled and the main thread is idle (never inside the entrance)
    const parked = document.querySelector<HTMLElement>("[data-page='overview']");
    await waitFor(() => expect(parked?.getAttribute("data-page-role")).toBe("parked"), { timeout: 1500 });
    // hidden, not unmounted: the DOM stays (display:none), the effect was cleaned up
    expect(parked).toHaveAttribute("inert");
    expect(screen.queryByRole("button", { name: /Übersicht/ })).toBeNull();
    expect(screen.getByText("Übersicht 1", { selector: "button" })).toBeInTheDocument();
    expect(effects.cleaned).toBe(1);

    await switchTo(() => rerender(host("overview", onT)));
    expect(screen.getByRole("button", { name: "Übersicht 1" })).toBeInTheDocument();
    expect(effects.mounted).toBe(2);
    await waitFor(() => expect(onT).toHaveBeenLastCalledWith(false), { timeout: 1500 });
    // the non-keep-alive page is gone once its exit played
    await waitFor(() => expect(screen.queryByRole("heading", { name: "trades" })).toBeNull());
  });

  it("collapses the leaving page after its exit, parks it only when idle; a switch back before that re-mounts nothing", async () => {
    const onT = vi.fn();
    const { rerender } = render(host("overview", onT));
    // (the previous test's tree unmounts after the counters were reset)
    const base = { ...effects };
    const button = screen.getByRole("button", { name: "Übersicht 0" });
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
    await switchTo(() => rerender(host("trades", onT)));
    const overview = document.querySelector<HTMLElement>("[data-page='overview']");
    expect(overview?.getAttribute("data-page-role")).toBe("leaving");
    // hidden from AT, but not inert / pointer-events none (both restyled the whole fading page); focus left it at the
    // switch and its buttons ignore pointer input while it leaves
    expect(overview).toHaveAttribute("aria-hidden", "true");
    expect(overview).not.toHaveAttribute("inert");
    expect(overview?.className).not.toContain("pointer-events-none");
    expect(document.activeElement).not.toBe(button);
    act(() => button.click());
    expect(screen.getByText("Übersicht 0", { selector: "button" })).toBeInTheDocument();
    // exit played (120 ms): out of the scroll extent, still alive (no effect cleanup yet)
    await waitFor(() => expect(overview?.style.height).toBe("0px"), { timeout: 1000 });
    expect(overview?.style.overflow).toBe("hidden");
    expect(overview?.getAttribute("data-page-role")).toBe("leaving");
    expect(effects).toEqual(base);
    // back before it was parked: shown again without a re-mount, the layer is restored at once
    await switchTo(() => rerender(host("overview", onT)));
    expect(overview?.getAttribute("data-page-role")).toBe("current");
    expect(overview?.style.height).toBe("");
    expect(overview?.style.overflow).toBe("");
    await waitFor(() => expect(onT).toHaveBeenLastCalledWith(false), { timeout: 1500 });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "trades" })).toBeNull(), { timeout: 1500 });
    expect(effects).toEqual(base);
  });

  it("a page shown again before it was parked gets its height back before the queued scroll restore runs (no clamp)", async () => {
    const { rerender } = render(host("overview"));
    await switchTo(() => rerender(host("trades")));
    const overview = document.querySelector<HTMLElement>("[data-page='overview']");
    await waitFor(() => expect(overview?.style.height).toBe("0px"), { timeout: 1000 });
    // the layer's height at the moment the restore scrolls the window (a collapsed layer clamped the restore)
    const heights: string[] = [];
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {
      heights.push(overview?.style.height ?? "gone");
    });
    try {
      restoreScroll("overview", true);
      await switchTo(() => rerender(host("overview")));
      expect(heights).toEqual([""]);
    } finally {
      scrollTo.mockRestore();
    }
  });

  it("keyboard: focus in the page that leaves moves to the shown page's title, and focus landing in the leaving page later goes there too", async () => {
    const { rerender } = render(host("overview"));
    const button = screen.getByRole("button", { name: "Übersicht 0" });
    act(() => button.focus());
    await switchTo(() => rerender(host("trades")));
    const title = screen.getByRole("heading", { name: "trades" });
    // the next Tab continues in the page on screen, never in the invisible one that leaves (a reader hears its title)
    expect(document.activeElement).toBe(title);
    expect(title).toHaveAttribute("tabindex", "-1");
    expect(title.style.outline).toBe("none");
    // e.g. Tab from the shown page's end / the back button: focus lands in the leaving page → sent on
    act(() => title.blur());
    expect(title).not.toHaveAttribute("tabindex");
    expect(title.style.outline).toBe("");
    act(() => button.focus());
    expect(document.activeElement).toBe(title);
  });

  it("a page without a title takes focus on its layer (the Übersicht)", async () => {
    const { rerender } = render(host("trades"));
    const title = screen.getByRole("heading", { name: "trades" });
    // a control inside the Trades page switched to the Übersicht
    title.setAttribute("tabindex", "0");
    act(() => title.focus());
    await switchTo(() => rerender(host("overview")));
    const overview = document.querySelector<HTMLElement>("[data-page='overview']");
    expect(document.activeElement).toBe(overview);
    expect(overview).toHaveAttribute("tabindex", "-1");
  });

  it("the entering page takes no input while it is still invisible (the leaving page fades above nothing it could act on)", async () => {
    const onT = vi.fn();
    const { rerender } = render(host("trades", onT));
    await switchTo(() => rerender(host("overview", onT)));
    const overview = document.querySelector<HTMLElement>("[data-page='overview']");
    expect(overview?.getAttribute("data-page-role")).toBe("current");
    expect(overview?.style.opacity).toBe("0");
    // a tap meant for the fading Trades page lands on the invisible Übersicht: swallowed
    act(() => screen.getByText("Übersicht 0", { selector: "button" }).click());
    expect(screen.getByText("Übersicht 0", { selector: "button" })).toBeInTheDocument();
    // once the leaving page has faded (120 ms) the new page fades in and takes input
    await waitFor(() => expect(document.querySelector("[data-page='trades']")?.getAttribute("style") ?? "").toContain("height: 0px"), { timeout: 1000 });
    act(() => screen.getByRole("button", { name: "Übersicht 0" }).click());
    expect(screen.getByRole("button", { name: "Übersicht 1" })).toBeInTheDocument();
    await waitFor(() => expect(onT).toHaveBeenLastCalledWith(false), { timeout: 1500 });
  });

  it("takes a new page one painted frame later (the tap's own response is painted first); the latest page wins", async () => {
    const onT = vi.fn();
    const { rerender } = render(host("overview", onT));
    act(() => rerender(host("trades", onT)));
    // not yet: the dock answers the tap in this frame, the page follows after it was painted
    expect(document.querySelector("[data-page='trades']")).toBeNull();
    expect(onT).not.toHaveBeenCalled();
    // a second tap before the first one was taken: only the latest page is switched to
    act(() => rerender(host("settings", onT)));
    await act(async () => {
      await afterPaint();
    });
    expect(document.querySelector("[data-page='settings']")?.getAttribute("data-page-role")).toBe("current");
    expect(document.querySelector("[data-page='trades']")).toBeNull();
    expect(onT).toHaveBeenCalledWith(true);
  });

  it("SH-02: the entering page stays invisible while the leaving page fades (never two pages over each other)", async () => {
    const onT = vi.fn();
    const { rerender } = render(host("overview", onT));
    await switchTo(() => rerender(host("settings", onT)));
    const entering = document.querySelector<HTMLElement>("[data-page='settings']");
    expect(entering?.style.opacity).toBe("0");
    await new Promise((r) => setTimeout(r, 60));
    // halfway through the 120 ms exit: the new page has not started to fade in
    expect(Number(entering?.style.opacity || 0)).toBe(0);
    await waitFor(() => expect(onT).toHaveBeenLastCalledWith(false), { timeout: 1500 });
    expect(entering?.style.opacity).toBe("");
  });

  it("ends every switch at transform/filter none (no containing block for fixed ghosts)", async () => {
    const onT = vi.fn();
    const { rerender } = render(host("overview", onT));
    await switchTo(() => rerender(host("settings", onT)));
    await waitFor(() => expect(onT).toHaveBeenLastCalledWith(false), { timeout: 1500 });
    const layer = document.querySelector<HTMLElement>("[data-page='settings']");
    expect(layer?.style.transform).toBe("none");
    expect(layer?.style.filter).toBe("none");
    expect(layer?.style.opacity).toBe("");
  });

  it("applies a queued scroll restore at the commit that shows the page and holds the leaving page in place", async () => {
    const setScrollY = (y: number) => Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    setScrollY(300);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((opts?: ScrollToOptions | number) => {
      if (typeof opts === "object" && typeof opts.top === "number") setScrollY(opts.top);
    });
    const { rerender } = render(host("overview"));
    // the store already moved on (navigate), the shell still shows the overview: nothing scrolls yet
    restoreScroll("trades", true);
    expect(scrollTo).not.toHaveBeenCalled();
    await switchTo(() => rerender(host("trades")));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
    // the window jumped up 300 px; the fading overview is moved by the same distance, so it does not jump on screen
    const leaving = document.querySelector<HTMLElement>("[data-page='overview']");
    expect(leaving?.getAttribute("data-page-role")).toBe("leaving");
    expect(leaving?.style.top).toBe("-300px");
    scrollTo.mockRestore();
    setScrollY(0);
  });

  it("pre-renders a keep-alive page hidden when the app starts elsewhere (no effects until shown)", () => {
    render(host("trades"));
    expect(screen.getByRole("heading", { name: "trades" })).toBeInTheDocument();
    expect(screen.getByText("Übersicht 0", { selector: "button" })).not.toBeVisible();
    expect(effects.mounted).toBe(0);
  });
});
