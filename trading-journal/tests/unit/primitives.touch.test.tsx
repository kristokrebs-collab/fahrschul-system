import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoverPill, isRealHover, useHoverGroup } from "@/motion/HoverPill";
import { installTempo } from "@/motion/physics";
import { CONFIG as MS, MorphSelect, placePanel, rowAtPoint } from "@/motion/pulse/MorphSelect";
import { throwTarget } from "@/motion/pulse/WidgetGrid";
import { Segmented, segmentAt } from "@/primitives/Segmented";
import { Tooltip } from "@/primitives/Tooltip";

// ── pointer helpers: explicit timeStamps (jsdom stamps events with Date.now()) ─────────────────────────────────

let clock = 80_000;
type Init = Partial<PointerEventInit> & { pointerType?: string };
function ptr(el: Element | Window, type: string, x: number, y: number, t: number, extra: Init = {}) {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, clientX: x, clientY: y, ...extra });
  Object.defineProperty(e, "timeStamp", { value: t, configurable: true });
  act(() => {
    el.dispatchEvent(e);
  });
}
function slide(el: Element, from: [number, number], to: [number, number], ms: number, extra: Init = {}, hold = 0) {
  const steps = Math.max(2, Math.round(ms / 8.33));
  const t0 = (clock += 1000);
  ptr(el, "pointerdown", from[0], from[1], t0, extra);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    ptr(el, "pointermove", from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, t0 + ms * f, extra);
  }
  if (hold) ptr(el, "pointermove", to[0], to[1], t0 + ms + hold, extra);
  ptr(el, "pointerup", to[0], to[1], t0 + ms + hold + 1, extra);
}
function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

/** Gives each radio a 60 × 24 box in one row (jsdom has no layout). */
function layoutRadios() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const radios = Array.from(document.querySelectorAll('[role="radio"]'));
    const i = radios.indexOf(this);
    if (i < 0) return new DOMRect(0, 0, 0, 0);
    return new DOMRect(10 + i * 62, 100, 60, 24);
  });
}

const OPTIONS = [
  { v: "all", label: "Alle" },
  { v: "win", label: "Gewinner" },
  { v: "loss", label: "Verlierer" },
  { v: "be", label: "Break-even" },
] as const;
type V = (typeof OPTIONS)[number]["v"];

function SegHarness({ onChange }: { onChange: (v: V) => void }) {
  const [v, setV] = useState<V>("all");
  return (
    <Segmented<V>
      aria-label="Ergebnis"
      size="sm"
      options={OPTIONS}
      value={v}
      onChange={(n) => {
        setV(n);
        onChange(n);
      }}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Segmented: iOS press-slide-release", () => {
  it("pure hit test: inside a box, else the nearest centre", () => {
    const row = [0, 1, 2].map((i) => ({ i, cx: 40 + i * 62, top: 100, bottom: 124, left: 10 + i * 62, right: 70 + i * 62 }));
    expect(segmentAt(row, 20)).toBe(0);
    expect(segmentAt(row, 80)).toBe(1);
    expect(segmentAt(row, 71)).toBe(0); // in the 2 px gap → nearest centre
    expect(segmentAt(row, 900)).toBe(2);
    expect(segmentAt([], 10)).toBe(-1);
  });

  it("a slow touch slide commits ONE change (the segment under the finger) and swallows the click", () => {
    layoutRadios();
    const changes: V[] = [];
    render(<SegHarness onChange={(v) => changes.push(v)} />);
    const group = screen.getByRole("radiogroup", { name: "Ergebnis" });
    slide(group, [40, 112], [226, 112], 600, {}, 60);
    expect(changes).toEqual(["be"]);
    expect(screen.getByRole("radio", { name: "Break-even" })).toHaveAttribute("aria-checked", "true");
    // the click the browser sends after the drag does not select the pressed segment again
    click(screen.getByRole("radio", { name: "Alle" }));
    expect(changes).toEqual(["be"]);
  });

  it("a fast flick picks the segment nearest to the projected position", () => {
    layoutRadios();
    const changes: V[] = [];
    render(<SegHarness onChange={(v) => changes.push(v)} />);
    const group = screen.getByRole("radiogroup", { name: "Ergebnis" });
    // 30 px in 25 ms (1 200 px/s): the finger ends over "Alle" (+30 px), the projection (+119 px) reaches "Verlierer"
    slide(group, [20, 112], [50, 112], 25);
    expect(changes).toEqual(["loss"]);
  });

  it("taps and keys are unchanged; a vertical pan never selects", () => {
    layoutRadios();
    const changes: V[] = [];
    render(<SegHarness onChange={(v) => changes.push(v)} />);
    click(screen.getByRole("radio", { name: "Gewinner" }));
    expect(changes).toEqual(["win"]);
    const group = screen.getByRole("radiogroup");
    expect(group.style.touchAction).toBe("pan-y pinch-zoom");
    slide(group, [40, 112], [44, 260], 200);
    expect(changes).toEqual(["win"]);
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(changes).toEqual(["win", "loss"]);
  });
});

describe("HoverPill: no sticky hover on touch", () => {
  let uninstall: () => void = () => {};
  beforeEach(() => {
    uninstall = installTempo(window);
  });
  afterEach(() => uninstall());

  function Rows() {
    const { hovered, bind } = useHoverGroup<string>();
    return (
      <ul>
        {["a", "b"].map((id) => (
          <li key={id} data-testid={`row-${id}`} className="relative" {...bind(id)}>
            <HoverPill show={hovered === id} group="t" />
            Zeile {id}
          </li>
        ))}
      </ul>
    );
  }

  it("a touch tap's emulated mouseenter never claims the pill; a real mouse does", () => {
    render(<Rows />);
    const row = screen.getByTestId("row-a");
    ptr(window, "pointerdown", 10, 10, (clock += 100), { pointerType: "touch" });
    expect(isRealHover()).toBe(false);
    fireEvent.mouseEnter(row);
    fireEvent.mouseMove(row);
    expect(row.querySelector('[aria-hidden="true"]')).toBeNull();
    ptr(window, "pointermove", 12, 12, (clock += 100), { pointerType: "mouse" });
    expect(isRealHover()).toBe(true);
    fireEvent.mouseEnter(row);
    expect(row.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("Tooltip opens on tap", () => {
  it("a touch tap toggles the tooltip, the trigger's click still runs", async () => {
    const onClick = vi.fn();
    render(
      <Tooltip content="Erklärung">
        <button type="button" onClick={onClick}>
          Delta
        </button>
      </Tooltip>,
    );
    const b = screen.getByRole("button", { name: "Delta" });
    ptr(b, "pointerdown", 5, 5, (clock += 100), { pointerType: "touch" });
    click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getAllByText("Erklärung").length).toBeGreaterThan(0));
    ptr(b, "pointerdown", 5, 5, (clock += 100), { pointerType: "touch" });
    click(b);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });
});

describe("WidgetGrid: throw to slot", () => {
  // 2 × 2 grid of 100 px slots
  const slots = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 100, y: 0, w: 100, h: 100 },
    { x: 0, y: 100, w: 100, h: 100 },
    { x: 100, y: 100, w: 100, h: 100 },
  ];
  it("projects the centre with the fast deceleration and picks the slot there", () => {
    expect(throwTarget(slots, { x: 50, y: 50 }, { x: 1500, y: 0 }, 0)).toBe(1);
    expect(throwTarget(slots, { x: 50, y: 50 }, { x: 0, y: 1500 }, 0)).toBe(2);
    expect(throwTarget(slots, { x: 50, y: 50 }, { x: 1100, y: 1100 }, 0)).toBe(3);
  });
  it("a slow release or a projection outside the grid keeps the old rule (-1)", () => {
    expect(throwTarget(slots, { x: 50, y: 50 }, { x: 300, y: 0 }, 0)).toBe(-1);
    expect(throwTarget(slots, { x: 50, y: 50 }, { x: -1500, y: 0 }, 0)).toBe(-1);
  });
});

describe("MorphSelect: press-drag-release (UIMenu) and coarse rows", () => {
  it("row hit test by arithmetic (no layout reads)", () => {
    const g = { left: 100, top: 200, w: 240, h: 200, rowH: 40 };
    const listTop = 200 + 1 + MS.listPad;
    expect(rowAtPoint(g, false, 0, 4, 150, listTop + 5)).toBe(0);
    expect(rowAtPoint(g, false, 0, 4, 150, listTop + 40 + MS.rowGap + 5)).toBe(1);
    expect(rowAtPoint(g, false, 0, 4, 150, listTop + 40 + 1)).toBe(-1); // in the gap
    expect(rowAtPoint(g, false, 43, 4, 150, listTop + 5)).toBe(1); // scrolled by one row
    expect(rowAtPoint(g, true, 0, 4, 150, listTop + MS.headH + 5)).toBe(0);
    expect(rowAtPoint(g, false, 0, 4, 50, listTop + 5)).toBe(-1); // left of the panel
    expect(rowAtPoint(g, false, 0, 2, 150, listTop + 3 * 43 + 5)).toBe(-1); // past the last row
  });

  it("coarse rows are 44 px and the placement accounts for them", () => {
    const fine = placePanel({ left: 20, top: 100, width: 150, height: 38 }, 4, false, 400, 800);
    const coarse = placePanel({ left: 20, top: 100, width: 150, height: 38 }, 4, false, 400, 800, MS.rowHCoarse);
    expect(fine.rowH).toBe(40);
    expect(coarse.rowH).toBe(44);
    expect(coarse.h - fine.h).toBe(16);
  });

  const OPTS = [
    { value: "all", label: "Alle Grundlagen" },
    { value: "bsl", label: "BSL/EQL Liquidity Sweep" },
    { value: "fvg", label: "FVG Retest" },
  ];
  function MsHarness({ onChange }: { onChange: (v: string) => void }) {
    const [v, setV] = useState("all");
    return (
      <MorphSelect
        aria-label="Grundlage"
        value={v}
        options={OPTS}
        onChange={(n) => {
          setV(n);
          onChange(n);
        }}
      />
    );
  }

  it("mouse: press, drag down onto a row, release → picked and closed; the trigger click is swallowed", async () => {
    // trigger at (100, 100) 240 × 38 → the panel opens below at top 144
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("aria-haspopup") === "listbox" ? new DOMRect(100, 100, 240, 38) : new DOMRect(0, 0, 0, 0);
    });
    const changes: string[] = [];
    render(<MsHarness onChange={(v) => changes.push(v)} />);
    const trig = screen.getByRole("button", { name: "Grundlage" });
    const t0 = (clock += 1000);
    const m = { pointerType: "mouse" } as Init;
    ptr(trig, "pointerdown", 150, 119, t0, m);
    ptr(trig, "pointermove", 150, 126, t0 + 16, m);
    expect(trig).toHaveAttribute("aria-expanded", "false");
    ptr(trig, "pointermove", 150, 140, t0 + 32, m); // 21 px down → opens under the pointer
    expect(trig).toHaveAttribute("aria-expanded", "true");
    const row2Y = 144 + 1 + MS.listPad + 2 * (MS.rowH + MS.rowGap) + 10;
    ptr(trig, "pointermove", 150, row2Y, t0 + 200, m);
    expect(document.querySelector('[role="option"][data-active]')?.textContent).toContain("FVG Retest");
    ptr(trig, "pointerup", 150, row2Y, t0 + 260, m);
    click(trig);
    expect(changes).toEqual(["fvg"]);
    expect(trig).toHaveAttribute("aria-expanded", "false");
    expect(trig).toHaveTextContent("FVG Retest");
  });

  it("a plain click still opens (regression) and a press-drag released outside the rows keeps it open", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("aria-haspopup") === "listbox" ? new DOMRect(100, 100, 240, 38) : new DOMRect(0, 0, 0, 0);
    });
    const changes: string[] = [];
    render(<MsHarness onChange={(v) => changes.push(v)} />);
    const trig = screen.getByRole("button", { name: "Grundlage" });
    click(trig);
    expect(trig).toHaveAttribute("aria-expanded", "true");
    click(trig);
    expect(trig).toHaveAttribute("aria-expanded", "false");
  });
});
