import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CONFIG, WidgetGrid, moveId, resolveOrder, slotAt, useLift } from "@/motion/pulse/WidgetGrid";

const ITEMS = [
  { id: "funding", label: "Funding", node: <span>Funding 0.01 %</span> },
  { id: "oi", label: "Open Interest", node: <span>OI 8.1 Mrd</span> },
  { id: "taker", label: "Taker", node: <span>Taker 52 %</span> },
  { id: "spread", node: <span>Bid/Ask 0.1</span> },
];

function Harness({ log }: { log: string[][] }) {
  const [order, setOrder] = useState<string[]>(["funding", "oi", "taker", "spread"]);
  return (
    <WidgetGrid
      aria-label="Markt-Kacheln"
      items={ITEMS}
      order={order}
      onOrderChange={(ids) => {
        log.push(ids);
        setOrder(ids);
      }}
      className="grid grid-cols-2 gap-3"
    />
  );
}

const tiles = () => screen.getAllByRole("listitem");

describe("WidgetGrid logic", () => {
  it("resolveOrder keeps known ids, drops unknown/duplicates, appends missing", () => {
    expect(resolveOrder(ITEMS, ["taker", "x", "taker", "funding"])).toEqual(["taker", "funding", "oi", "spread"]);
    expect(resolveOrder(ITEMS, undefined)).toEqual(["funding", "oi", "taker", "spread"]);
  });

  it("moveId is an array move across several slots", () => {
    expect(moveId(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveId(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveId(["a", "b"], "a", 5)).toEqual(["a", "b"]);
  });

  it("slotAt hit-tests the tile centre against the inset slot boxes, skipping its own slot", () => {
    const slots = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 112, y: 0, w: 100, h: 100 },
      { x: 0, y: 112, w: 100, h: 100 },
    ];
    expect(slotAt(slots, 150, 50, 0, CONFIG.hitInset)).toBe(1);
    expect(slotAt(slots, 115, 50, 0, CONFIG.hitInset)).toBe(-1); // inside the inset margin
    expect(slotAt(slots, 50, 50, 0, CONFIG.hitInset)).toBe(-1); // own slot
    expect(slotAt(slots, 50, 160, 0, CONFIG.hitInset)).toBe(2);
  });
});

describe("WidgetGrid a11y + keyboard", () => {
  it("renders a list of focusable tiles with role description and position names (no live region)", () => {
    render(<Harness log={[]} />);
    expect(screen.getByRole("list", { name: "Markt-Kacheln" })).toBeInTheDocument();
    const t = tiles();
    expect(t).toHaveLength(4);
    expect(t[0]).toHaveAttribute("tabindex", "0");
    expect(t[0]).toHaveAttribute("aria-roledescription", CONFIG.roleDescription);
    expect(t[1]).toHaveAccessibleName("Open Interest, 2 von 4");
    expect(t[3]).toHaveAccessibleName("Bid/Ask 0.1 4 von 4");
    expect(t[0]).toHaveAccessibleDescription(CONFIG.hint);
    expect(document.querySelector("[aria-live]")).toBeNull();
  });

  it("Space grabs, arrows move (position name follows), Space drops and commits; focus stays on the tile", () => {
    const log: string[][] = [];
    render(<Harness log={log} />);
    const funding = tiles()[0]!;
    funding.focus();
    fireEvent.keyDown(funding, { key: " " });
    expect(funding).toHaveAttribute("data-grabbed");
    fireEvent.keyDown(funding, { key: "ArrowRight" });
    expect(funding).toHaveAccessibleName("Funding, 2 von 4");
    expect(screen.getByRole("listitem", { name: "Open Interest, 1 von 4" })).toBeInTheDocument();
    fireEvent.keyDown(funding, { key: "End" });
    expect(funding).toHaveAccessibleName("Funding, 4 von 4");
    fireEvent.keyDown(funding, { key: " " });
    expect(log).toEqual([["oi", "taker", "spread", "funding"]]);
    expect(tiles().map((t) => t.getAttribute("aria-label") ?? "")[3]).toBe("Funding, 4 von 4");
    expect(document.activeElement).toBe(screen.getByRole("listitem", { name: "Funding, 4 von 4" }));
  });

  it("Escape cancels the keyboard move without committing", () => {
    const log: string[][] = [];
    render(<Harness log={log} />);
    const taker = tiles()[2]!;
    taker.focus();
    fireEvent.keyDown(taker, { key: "Enter" });
    fireEvent.keyDown(taker, { key: "Home" });
    expect(taker).toHaveAccessibleName("Taker, 1 von 4");
    fireEvent.keyDown(taker, { key: "Escape" });
    expect(log).toEqual([]);
    expect(taker).toHaveAccessibleName("Taker, 3 von 4");
    expect(taker).not.toHaveAttribute("data-grabbed");
  });

  it("works uncontrolled", () => {
    render(<WidgetGrid items={ITEMS} />);
    const oi = tiles()[1]!;
    fireEvent.keyDown(oi, { key: " " });
    fireEvent.keyDown(oi, { key: "ArrowLeft" });
    fireEvent.keyDown(oi, { key: "Enter" });
    expect(tiles()[0]).toHaveAccessibleName("Open Interest, 1 von 4");
  });

  it("a pointer press shorter than the hold does not lift", () => {
    render(<Harness log={[]} />);
    const t = tiles()[0]!;
    fireEvent.pointerDown(t, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(t, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 });
    expect(t).not.toHaveAttribute("data-grabbed");
  });
});

describe("useLift", () => {
  it("lift/settle drive scale + glow MotionValues to the pack targets", async () => {
    const { result } = renderHook(() => useLift());
    expect(result.current.scale.get()).toBe(1);
    act(() => result.current.lift());
    await act(() => new Promise((r) => setTimeout(r, 600)));
    expect(result.current.scale.get()).toBeCloseTo(CONFIG.liftScale, 3);
    expect(result.current.glow.get()).toBeCloseTo(1, 2);
    act(() => result.current.settle());
    await act(() => new Promise((r) => setTimeout(r, 600)));
    expect(result.current.scale.get()).toBeCloseTo(1, 3);
    expect(result.current.glow.get()).toBeCloseTo(0, 2);
  });
});
