/**
 * The phone's floating glass bar (Runde 11, A5): one glass pill, a glass plate on the active tab (the marker), the active caption in full ink, and the step
 * down while the on-screen keyboard covers a text field.
 */
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dock, DOCK, keyboardOpen } from "@/app/Dock";
import { MotionRoot } from "@/motion/MotionRoot";
import { useUi } from "@/store/uiStore";

const realMatchMedia = window.matchMedia;
function phone() {
  window.matchMedia = ((q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const matches = (min ? 390 >= Number(min[1]) : true) && !/hover|pointer|reduce|max-height/.test(q);
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

describe("keyboardOpen (pure)", () => {
  it("only with a text field focused and more than 140 px of the screen lost at the bottom", () => {
    expect(keyboardOpen(800, { height: 480, offsetTop: 0 }, true)).toBe(true);
    expect(keyboardOpen(800, { height: 480, offsetTop: 0 }, false)).toBe(false);
    expect(keyboardOpen(800, { height: 700, offsetTop: 0 }, true)).toBe(false);
    // pinch-zoomed: the visual viewport scrolled down, nothing is covered
    expect(keyboardOpen(800, { height: 400, offsetTop: 400 }, true)).toBe(false);
    expect(keyboardOpen(800, null, true)).toBe(false);
  });
});

describe("the glass bar", () => {
  beforeEach(() => {
    phone();
    sessionStorage.setItem("tj2-dock-intro", "1");
    useUi.setState({ page: "trades", editor: { open: false, fromFab: false } });
  });
  afterEach(() => {
    window.matchMedia = realMatchMedia;
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
  });

  it("one pill behind the items; the plate sits on the active tab only; its caption is the semibold one", () => {
    const { container } = render(
      <MotionRoot>
        <Dock />
      </MotionRoot>,
    );
    expect(container.querySelectorAll(".dock-glass")).toHaveLength(1);
    expect(container.querySelectorAll(".dock-plate")).toHaveLength(1);
    const bar = screen.getByRole("toolbar", { name: "Navigation" });
    expect(within(bar).getByRole("button", { name: "Trades" }).querySelector(".dock-plate")).not.toBeNull();
    expect(within(bar).getByRole("button", { name: "Trades" }).querySelector("[data-dock-caption]")!.className).toContain("font-semibold");
    expect(within(bar).getByRole("button", { name: "Markt" }).querySelector("[data-dock-caption]")!.className).not.toContain("font-semibold");
    expect(DOCK.panelHeight).toBe(78);
    // the old tray pieces are gone
    expect(container.querySelectorAll(".rounded-l-2xl, .rounded-r-2xl")).toHaveLength(0);
  });

  it("steps down (`data-kb`) while the keyboard is up over a text field and comes back after", () => {
    const vv = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const { container } = render(
      <MotionRoot>
        <input aria-label="Notiz" />
        <Dock />
      </MotionRoot>,
    );
    const nav = container.querySelector<HTMLElement>('[data-layer="Dock"]')!;
    expect(nav.hasAttribute("data-kb")).toBe(false);
    act(() => screen.getByLabelText("Notiz").focus());
    // the keyboard opens: the visual viewport shrinks
    act(() => {
      vv.height = 450;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(nav.hasAttribute("data-kb")).toBe(true);
    act(() => {
      vv.height = 800;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(nav.hasAttribute("data-kb")).toBe(false);
  });
});
