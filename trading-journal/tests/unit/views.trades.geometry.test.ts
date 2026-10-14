import { describe, expect, it } from "vitest";
import { insetBox, offsetWithin, sameBox, type OffsetNode } from "@/views/trades/rowGeometry";

/** wrapper (positioned) ← table (offset 0/8) ← row (offset 41/0) – the shape a `<tr>` reports in a real browser. */
function chain() {
  const wrap: OffsetNode = { offsetTop: 300, offsetLeft: 20, offsetParent: null };
  const table: OffsetNode = { offsetTop: 0, offsetLeft: 8, offsetParent: wrap };
  const row: OffsetNode = { offsetTop: 41, offsetLeft: 0, offsetParent: table };
  return { wrap, table, row };
}

describe("rowGeometry.offsetWithin", () => {
  it("sums offsets along the offsetParent chain up to the root (root's own offset excluded)", () => {
    const { wrap, row } = chain();
    expect(offsetWithin(row, wrap)).toEqual({ top: 41, left: 8 });
  });
  it("is the element's own offset when its offsetParent is the root", () => {
    const { wrap, table } = chain();
    expect(offsetWithin(table, wrap)).toEqual({ top: 0, left: 8 });
  });
  it("null when the chain never reaches the root (root not positioned, detached, jsdom)", () => {
    const { row } = chain();
    const other: OffsetNode = { offsetTop: 0, offsetLeft: 0, offsetParent: null };
    expect(offsetWithin(row, other)).toBeNull();
    expect(offsetWithin({ offsetTop: 5, offsetLeft: 5, offsetParent: null }, other)).toBeNull();
  });
});

describe("rowGeometry.insetBox / sameBox", () => {
  const box = { top: 100, left: 8, width: 900, height: 57 };
  it("pulls the box in vertically only", () => {
    expect(insetBox(box, 2)).toEqual({ top: 102, left: 8, width: 900, height: 53 });
  });
  it("never inverts a short box", () => {
    expect(insetBox({ ...box, height: 3 }, 2)).toEqual({ top: 101.5, left: 8, width: 900, height: 0 });
  });
  it("compares by value", () => {
    expect(sameBox(box, { ...box })).toBe(true);
    expect(sameBox(box, { ...box, height: 58 })).toBe(false);
    expect(sameBox(null, null)).toBe(true);
    expect(sameBox(box, null)).toBe(false);
  });
});
