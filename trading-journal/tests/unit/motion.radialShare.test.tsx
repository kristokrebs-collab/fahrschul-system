import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INERT_EXEMPT_SELECTOR } from "@/motion/a11y";
import { fanLayout, RADIAL_ITEM, stepIndex } from "@/motion/radialLayout";
import { RadialShare, type RadialTarget } from "@/motion/RadialShare";

const fx = vi.hoisted(() => ({ reduced: true }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

afterEach(() => {
  fx.reduced = true;
});

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("fan geometry (pure)", () => {
  const hub = { w: 96, h: 32 };
  const view = { w: 390, h: 844 };

  it("opens upwards from a trigger in the middle of the screen", () => {
    const f = fanLayout({ n: 4, origin: { x: 195, y: 500 }, viewport: view, hub });
    expect(f.centerAngle).toBe(-90);
    expect(f.clamped).toBe(false);
    for (const o of f.offsets) expect(o.y).toBeLessThan(0);
    // symmetric around the vertical axis
    expect(f.offsets[0]!.x).toBeCloseTo(-f.offsets[3]!.x, 6);
  });

  it("keeps every target fully on screen at every edge and corner of a phone", () => {
    const spots = [
      { x: 30, y: 400 }, // left edge
      { x: 360, y: 400 }, // right edge
      { x: 195, y: 28 }, // top edge (the fan has to turn downwards)
      { x: 195, y: 820 }, // bottom edge
      { x: 24, y: 24 },
      { x: 366, y: 24 },
      { x: 24, y: 820 },
      { x: 366, y: 820 },
    ];
    for (const n of [1, 2, 3, 4, 5]) {
      for (const origin of spots) {
        const f = fanLayout({ n, origin, viewport: view, hub });
        expect(f.offsets).toHaveLength(n);
        for (const o of f.offsets) {
          const x = origin.x + o.x;
          const y = origin.y + o.y;
          expect(x - RADIAL_ITEM / 2).toBeGreaterThanOrEqual(0);
          expect(x + RADIAL_ITEM / 2).toBeLessThanOrEqual(view.w);
          expect(y - RADIAL_ITEM / 2).toBeGreaterThanOrEqual(0);
          expect(y + RADIAL_ITEM / 2).toBeLessThanOrEqual(view.h);
        }
      }
    }
  });

  it("targets never overlap each other and keep off the trigger (each keeps its own ≥ 44 px touch area)", () => {
    for (const n of [2, 3, 4, 5]) {
      const f = fanLayout({ n, origin: { x: 195, y: 500 }, viewport: view, hub });
      for (let i = 0; i < n; i++) {
        const a = f.offsets[i]!;
        // clear of the trigger box
        expect(Math.abs(a.x) >= hub.w / 2 + RADIAL_ITEM / 2 || Math.abs(a.y) >= hub.h / 2 + RADIAL_ITEM / 2).toBe(true);
        for (let j = i + 1; j < n; j++) expect(dist(a, f.offsets[j]!)).toBeGreaterThanOrEqual(RADIAL_ITEM);
      }
    }
  });

  it("a tiny window falls back to pushing each target inside, and says so", () => {
    const f = fanLayout({ n: 4, origin: { x: 60, y: 60 }, viewport: { w: 120, h: 120 }, hub });
    expect(f.clamped).toBe(true);
    for (const o of f.offsets) {
      expect(60 + o.x).toBeGreaterThanOrEqual(RADIAL_ITEM / 2);
      expect(60 + o.x).toBeLessThanOrEqual(120 - RADIAL_ITEM / 2);
    }
  });

  it("is deterministic", () => {
    const a = fanLayout({ n: 3, origin: { x: 20, y: 300 }, viewport: view, hub });
    const b = fanLayout({ n: 3, origin: { x: 20, y: 300 }, viewport: view, hub });
    expect(a).toEqual(b);
  });

  it("stepIndex wraps and skips disabled targets", () => {
    expect(stepIndex(0, 1, [false, false, false])).toBe(1);
    expect(stepIndex(2, 1, [false, false, false])).toBe(0);
    expect(stepIndex(0, -1, [false, false, false])).toBe(2);
    expect(stepIndex(0, 1, [false, true, false])).toBe(2);
    expect(stepIndex(0, 1, [true, true])).toBe(-1);
    expect(stepIndex(1, 1, [true, false])).toBe(1);
  });
});

function Harness({ onSelect, extra }: { onSelect: (id: string) => void; extra?: Partial<RadialTarget> }) {
  const [closedDialog, setClosedDialog] = useState(false);
  const targets: RadialTarget[] = [
    { id: "copy", label: "Kopieren", icon: <i>c</i>, onSelect: () => onSelect("copy") },
    { id: "image", label: "Bild", icon: <i>b</i>, onSelect: () => onSelect("image"), ...extra },
    { id: "link", label: "Link", icon: <i>l</i>, onSelect: () => onSelect("link") },
  ];
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape") setClosedDialog(true);
      }}
    >
      <RadialShare targets={targets} label="Teilen" icon={<b>*</b>} />
      {closedDialog && <p data-testid="dialog-closed">zu</p>}
    </div>
  );
}

describe("RadialShare", () => {
  it("is closed at rest: a menu button with aria-haspopup, no fan in the DOM", () => {
    render(<Harness onSelect={vi.fn()} />);
    const t = screen.getByTestId("share-button");
    expect(t).toHaveAttribute("aria-haspopup", "menu");
    expect(t).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on click: a menu of menuitems with the words as names, focus on the first, exempt from the dialog's inert rule", async () => {
    render(<Harness onSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("share-button"));
    const menu = await screen.findByRole("menu");
    expect(screen.getByTestId("share-button")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitem").map((e) => e.getAttribute("aria-label"))).toEqual(["Kopieren", "Bild", "Link"]);
    expect(screen.getByRole("menuitem", { name: "Kopieren" })).toHaveFocus();
    // the fan lives in <body> under a layer the dialog's isolation leaves alone
    expect(menu.closest("[data-radial-share]")).not.toBeNull();
    expect(menu.closest(INERT_EXEMPT_SELECTOR)).not.toBeNull();
  });

  it("arrow keys step through the targets (wrapping), Home / End jump, the trigger shows the active word", async () => {
    render(<Harness onSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("share-button"));
    await screen.findByRole("menu");
    const keys = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
    keys("ArrowRight");
    expect(screen.getByRole("menuitem", { name: "Bild" })).toHaveFocus();
    expect(screen.getByTestId("share-button")).toHaveAttribute("aria-label", "Teilen: Bild");
    keys("ArrowDown");
    expect(screen.getByRole("menuitem", { name: "Link" })).toHaveFocus();
    keys("ArrowRight");
    expect(screen.getByRole("menuitem", { name: "Kopieren" })).toHaveFocus();
    keys("ArrowLeft");
    expect(screen.getByRole("menuitem", { name: "Link" })).toHaveFocus();
    keys("Home");
    expect(screen.getByRole("menuitem", { name: "Kopieren" })).toHaveFocus();
    keys("End");
    expect(screen.getByRole("menuitem", { name: "Link" })).toHaveFocus();
    // roving tab stop: only the active target is tabbable
    expect(screen.getAllByRole("menuitem").filter((e) => e.tabIndex === 0)).toHaveLength(1);
  });

  it("Escape closes only the fan, gives the focus back to the trigger and never reaches the dialog under it", async () => {
    render(<Harness onSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("share-button"));
    await screen.findByRole("menu");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(screen.getByTestId("share-button")).toHaveFocus();
    expect(screen.queryByTestId("dialog-closed")).toBeNull();
  });

  it("Tab closes the fan and keeps the focus on the trigger", async () => {
    render(<Harness onSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("share-button"));
    await screen.findByRole("menu");
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(screen.getByTestId("share-button")).toHaveFocus();
  });

  it("choosing a target closes the fan and runs exactly that target once", async () => {
    const pick = vi.fn();
    render(<Harness onSelect={pick} />);
    fireEvent.click(screen.getByTestId("share-button"));
    await screen.findByRole("menu");
    fireEvent.click(screen.getByRole("menuitem", { name: "Link" }));
    await waitFor(() => expect(pick).toHaveBeenCalledWith("link"));
    expect(pick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("a disabled target is skipped by the keys and cannot be chosen", async () => {
    const pick = vi.fn();
    render(<Harness onSelect={pick} extra={{ disabled: true, hint: "geht gerade nicht" }} />);
    fireEvent.click(screen.getByTestId("share-button"));
    await screen.findByRole("menu");
    const keys = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
    keys("ArrowRight");
    expect(screen.getByRole("menuitem", { name: "Link" })).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitem", { name: "Bild" }));
    expect(pick).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Bild" })).toHaveAttribute("aria-disabled", "true");
  });

  it("a press outside closes it; ArrowDown on the trigger opens it from the keyboard", async () => {
    render(<Harness onSelect={vi.fn()} />);
    screen.getByTestId("share-button").focus();
    fireEvent.keyDown(screen.getByTestId("share-button"), { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    const layer = menu.closest("[data-radial-share]")!;
    fireEvent.pointerDown(layer.firstElementChild!);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("a resize closes the fan (its place was measured once)", async () => {
    render(<Harness onSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("share-button"));
    await screen.findByRole("menu");
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("each target is 48 px, never below the 44 px touch minimum", async () => {
    render(<Harness onSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("share-button"));
    await screen.findByRole("menu");
    for (const el of screen.getAllByRole("menuitem")) {
      expect(el.style.width).toBe("48px");
      expect(el.style.height).toBe("48px");
    }
  });
});
