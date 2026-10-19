/**
 * Transform-free row geometry for the table's absolutely positioned layers (row highlight, detail ghost).
 *
 * Layout offsets ignore CSS transforms, so a row caught mid-press (`scale .995`), mid-enter (`y`) or mid-reorder
 * (`layout="position"`) still reports the box it is heading to – a bounding-client-rect read would bake the
 * in-flight transform into the layer.
 */

/** The part of an `HTMLElement` the offset walk needs (structural, so tests can pass plain objects). */
export interface OffsetNode {
  offsetTop: number;
  offsetLeft: number;
  offsetParent: OffsetNode | Element | null;
}

export interface RowBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Position of `el` in the coordinate space of `root` (its padding box, scroll-independent – exactly what an
 * `absolute` child of `root` uses), found by summing offsets along the `offsetParent` chain. `null` when the chain
 * never reaches `root` (`root` not positioned, element detached, jsdom).
 */
export function offsetWithin(el: OffsetNode, root: unknown): { top: number; left: number } | null {
  let top = 0;
  let left = 0;
  let node: OffsetNode | null = el;
  while (node && node !== root) {
    top += node.offsetTop;
    left += node.offsetLeft;
    const parent: OffsetNode | Element | null = node.offsetParent;
    node = parent && "offsetTop" in parent ? (parent as OffsetNode) : null;
  }
  return node === root ? { top, left } : null;
}

/** Box of a row inside `root`; falls back to rect deltas (+ scroll) when the offset chain does not reach `root`. */
export function measureRow(row: HTMLElement, root: HTMLElement): RowBox {
  const at = offsetWithin(row, root);
  if (at) return { top: at.top, left: at.left, width: row.offsetWidth, height: row.offsetHeight };
  const w = root.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  return { top: r.top - w.top + root.scrollTop, left: r.left - w.left + root.scrollLeft, width: r.width, height: r.height };
}

/** Pulls a box in by `dy` on top and bottom (the hover pill floats between the row rules). Never negative. */
export function insetBox(box: RowBox, dy: number): RowBox {
  const d = Math.min(dy, box.height / 2);
  return { top: box.top + d, left: box.left, width: box.width, height: box.height - 2 * d };
}

export function sameBox(a: RowBox | null, b: RowBox | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}
