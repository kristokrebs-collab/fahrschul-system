import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { bandBox, bandMask, BOTTOM_BANDS, BottomFade } from "@/app/BottomFade";
import { Dock, DOCK, DOCK_INTRO_KEY, dockBell, dockLayout } from "@/app/Dock";
import { scrollBar } from "@/app/Header";
import { priceStep, tickerChange, tickerChangePct, tickerDecimals, tickerJump, tickerPrice } from "@/app/HeaderTicker";
import { toastLifetime, toIslandToast } from "@/app/toasts";
import { MotionRoot } from "@/motion/MotionRoot";
import { INTRO_KEY } from "@/primitives/SplitText";
import { TOAST_MS, useUi } from "@/store/uiStore";

describe("dock magnification model", () => {
  it("windowed Gaussian bell (pack remix): 1 under the pointer, e^(−d²/2σ²) shape, 0 from `distance` on, symmetric", () => {
    expect(dockBell(0)).toBe(1);
    const g = (d: number) => Math.exp(-(d * d) / (2 * DOCK.sigma * DOCK.sigma));
    expect(dockBell(DOCK.sigma)).toBeCloseTo((g(DOCK.sigma) - g(DOCK.distance)) / (1 - g(DOCK.distance)), 12);
    // continuous at the window edge (no step when the pointer leaves the range)
    expect(dockBell(DOCK.distance - 0.01)).toBeLessThan(1e-4);
    // pack magnification amplitude: scale 1 + 0.8 under the pointer
    expect(DOCK.magnification / DOCK.base).toBeCloseTo(1.8, 12);
    expect(dockBell(DOCK.distance)).toBe(0);
    expect(dockBell(DOCK.distance + 50)).toBe(0);
    expect(dockBell(-37)).toBeCloseTo(dockBell(37), 12);
  });

  // five 44-px slots, 56 px apart (gap 12), centred on 0; slot 3 does not scale (a divider)
  const centres = [-112, -56, 0, 56, 112];
  const scalable = [true, true, true, false, true];

  it("rests at scale 1 / shift 0 when the amount is 0", () => {
    const scale: number[] = [];
    const shift: number[] = [];
    expect(dockLayout(centres, scalable, 0, 0, scale, shift)).toBe(0);
    expect(scale).toEqual([1, 1, 1, 1, 1]);
    expect(shift.every((s) => Math.abs(s) < 1e-9)).toBe(true);
  });

  it("magnifies the slot under the pointer to `magnification` and widens the row symmetrically", () => {
    const scale: number[] = [];
    const shift: number[] = [];
    const spread = dockLayout(centres, [true, true, true, true, true], 0, 1, scale, shift);
    expect(scale[2]).toBeCloseTo(DOCK.magnification / DOCK.base, 10);
    expect(shift[2]).toBeCloseTo(0, 10); // the hovered slot stays under the pointer
    expect(shift[1]).toBeCloseTo(-(shift[3] ?? 0), 10);
    // the outer edges move out by exactly half the total growth each
    const left = (centres[0] ?? 0) + (shift[0] ?? 0) - (DOCK.base / 2) * (scale[0] ?? 1);
    const right = (centres[4] ?? 0) + (shift[4] ?? 0) + (DOCK.base / 2) * (scale[4] ?? 1);
    expect(left).toBeCloseTo(-112 - 22 - spread / 2, 9);
    expect(right).toBeCloseTo(112 + 22 + spread / 2, 9);
  });

  it("neighbours never overlap and a divider moves without scaling", () => {
    const scale: number[] = [];
    const shift: number[] = [];
    for (const pointer of [-140, -60, -20, 10, 70, 130]) {
      dockLayout(centres, scalable, pointer, 1, scale, shift);
      expect(scale[3]).toBe(1);
      for (let k = 0; k < centres.length - 1; k++) {
        const rightEdge = (centres[k] ?? 0) + (shift[k] ?? 0) + (DOCK.base / 2) * (scale[k] ?? 1);
        const nextLeft = (centres[k + 1] ?? 0) + (shift[k + 1] ?? 0) - (DOCK.base / 2) * (scale[k + 1] ?? 1);
        expect(nextLeft - rightEdge).toBeGreaterThanOrEqual(12 - 1e-9);
      }
    }
  });

  it("unmeasured slots neither grow nor move the others", () => {
    const scale: number[] = [];
    const shift: number[] = [];
    expect(dockLayout([NaN, NaN], [true, true], 0, 1, scale, shift)).toBe(0);
    expect(scale).toEqual([1, 1]);
  });
});

describe("Dock", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useUi.setState({ page: "overview", editor: { open: false, fromFab: false } });
  });

  it("keeps the exact tab order and names, marks the page, and uses its own intro flag", () => {
    render(
      <MotionRoot>
        <Dock />
      </MotionRoot>,
    );
    const dock = screen.getByRole("toolbar", { name: "Navigation" });
    const names = within(dock)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Übersicht", "Trades", "Entscheidungsgrundlagen", "Einstellungen", "Trade eintragen"]);
    expect(within(dock).getByRole("button", { name: "Übersicht" })).toHaveAttribute("aria-current", "page");
    // tooltips are CSS-only and hidden from assistive tech (the button carries the name)
    expect(within(dock).queryByRole("tooltip")).toBeNull();
    expect(sessionStorage.getItem(DOCK_INTRO_KEY)).toBe("1");
    expect(sessionStorage.getItem(INTRO_KEY)).toBeNull();
    act(() => useUi.setState({ page: "trades" }));
    expect(within(dock).getByRole("button", { name: "Trades" })).toHaveAttribute("aria-current", "page");
    expect(within(dock).getByRole("button", { name: "Übersicht" })).not.toHaveAttribute("aria-current");
  });

  it("the FAB opens the editor from the dock and its disc leaves while the editor is open", () => {
    render(
      <MotionRoot>
        <Dock />
      </MotionRoot>,
    );
    const fab = screen.getByRole("button", { name: "Trade eintragen" });
    expect(fab.querySelector(".bg-gradient-to-br")).not.toBeNull();
    fireEvent.click(fab);
    expect(useUi.getState().editor).toEqual({ open: true, tradeId: undefined, fromFab: true });
    expect(fab.querySelector(".bg-gradient-to-br")).toBeNull();
  });
});

describe("header chrome", () => {
  it("progress bar is empty at the top and on pages that do not scroll", () => {
    expect(scrollBar(0, 1)).toBe(0);
    expect(scrollBar(120, 0.25)).toBe(0.25);
    expect(scrollBar(120, Number.NaN)).toBe(0);
    expect(scrollBar(120, 1.2)).toBe(1);
  });

  it("ticker formats price and live 24 h change de-DE, `–` while unknown", () => {
    expect(tickerDecimals(86_100)).toBe(1);
    expect(tickerDecimals(152.3)).toBe(2);
    expect(tickerDecimals(0.42)).toBe(5);
    expect(tickerPrice(86_100.44)).toBe("86.100,4");
    expect(tickerPrice(0)).toBe("–");
    expect(tickerChange(101.2, 100)).toBe("+1,20 %");
    expect(tickerChange(99.6, 100)).toBe("−0,40 %");
    expect(tickerChange(100.0001, 100)).toBe("0,00 %");
    expect(Object.is(tickerChangePct(99.99999, 100), -0)).toBe(false);
    expect(tickerChange(100, 0)).toBe("– %");
  });

  it("glide jumps on unknown prices and gaps, springs otherwise", () => {
    expect(tickerJump(0, 86_000)).toBe(true);
    expect(tickerJump(86_000, 0)).toBe(true);
    expect(tickerJump(86_000, 86_040)).toBe(false);
    expect(tickerJump(86_000, 90_000)).toBe(true);
  });

  it("flash steps only on significant moves; the first price anchors", () => {
    expect(priceStep(0, 86_000)).toEqual({ anchor: 86_000, dir: 0 });
    expect(priceStep(86_000, 86_000.1)).toEqual({ anchor: 86_000, dir: 0 });
    expect(priceStep(86_000, 86_001)).toEqual({ anchor: 86_001, dir: 1 });
    expect(priceStep(86_000, 85_999)).toEqual({ anchor: 85_999, dir: -1 });
    expect(priceStep(86_000, 0)).toEqual({ anchor: 0, dir: 0 });
  });
});

describe("edge blur", () => {
  it("bands ramp toward the edge; the outermost stays solid", () => {
    // the bottom strip runs on the plain-gradient perf fallback (no backdrop blur behind the dock)
    expect(BOTTOM_BANDS).toEqual([]);
    expect(bandMask({ blur: 2, from: 0.3, to: 0.8 }, "bottom")).toBe("linear-gradient(to bottom, transparent 0%, #000 33%, #000 66%, transparent 100%)");
    expect(bandMask({ blur: 5, from: 0.5, to: 1 }, "top")).toBe("linear-gradient(to top, transparent 0%, #000 33%)");
    expect(bandBox({ blur: 2, from: 0.3, to: 0.8 }, "bottom")).toEqual({ top: "30%", height: "50%" });
    expect(bandBox({ blur: 2, from: 0.3, to: 0.8 }, "top")).toEqual({ bottom: "30%", height: "50%" });
  });

  it("is decorative: aria-hidden, no pointer events", () => {
    const { container } = render(<BottomFade />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root.className).toContain("pointer-events-none");
  });
});

describe("toast adapter", () => {
  it("passes the store lifetime on, so the island's countdown matches the dismissal", () => {
    expect(toastLifetime({ kind: "info" })).toBe(TOAST_MS.default);
    expect(toastLifetime({ kind: "signal" })).toBe(TOAST_MS.signal);
    expect(toastLifetime({ kind: "success", duration: 0 })).toBe(0);
    expect(toIslandToast({ id: 1, kind: "info", title: "Hinweis" })).toEqual({
      id: 1,
      kind: "warn",
      title: "Hinweis",
      value: undefined,
      valueTone: undefined,
      detail: undefined,
      duration: TOAST_MS.default,
    });
  });
});
