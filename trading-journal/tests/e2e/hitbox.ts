/// <reference lib="dom" />
/**
 * In-page touch-target audit: every visible interactive element must take a tap anywhere in a 44 × 44 CSS px square
 * around its centre (Apple HIG / WCAG 2.5.5). Measured by HIT TESTING (`elementsFromPoint` at the centre and at
 * ±21.5 px on both axes), not by box size, so the `.touch-hit` / `.touch-hit-y` pseudo-element areas count and a
 * neighbour whose own area covers the point counts against the element. A point outside the viewport counts as a
 * hit (screen edge). The element is scrolled to the middle of its scroll container(s) first (sticky header, dock and
 * sheet footer out of the way).
 */
export interface HitBoxMiss {
  name: string;
  /** element box */
  w: number;
  h: number;
  /** tappable extent through the centre (capped at the probe radius × 2) */
  ew: number;
  eh: number;
  /** what took the missed probe instead */
  stolenBy: string;
  where: string;
}

export const HIT_SELECTOR =
  'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="radio"], [role="tab"], [role="switch"], [role="checkbox"], [role="option"], [role="slider"], [role="link"], [role="menuitem"], [tabindex="0"]';

/** Runs in the page (`page.evaluate(auditHitBoxes, { selector, root })`). */
export async function auditHitBoxes({ selector, root, min = 44 }: { selector: string; root?: string; min?: number }): Promise<HitBoxMiss[]> {
  const R = Math.ceil(min / 2);
  const scope: ParentNode = (root && document.querySelector(root)) || document;
  const raf = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const label = (el: Element): string =>
    (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("placeholder") || el.getAttribute("title") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 50);
  const short = (el: Element | null): string => (el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}「${label(el)}」` : "nothing");
  const visible = (el: HTMLElement): boolean => {
    if (el.closest('[inert], [aria-hidden="true"], [hidden]')) return false;
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    let o = 1;
    for (let n: Element | null = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") return false;
      o *= Number(cs.opacity);
    }
    return o > 0.05;
  };
  const fixedish = (el: Element): boolean => {
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === "fixed" || p === "sticky") return true;
    }
    return false;
  };
  /** the probe at (x, y) lands on `el` (or its label / a descendant); outside the viewport = a screen edge */
  const takes = (el: Element, x: number, y: number): [boolean, Element | null] => {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return [true, null];
    const hit = document.elementFromPoint(x, y);
    if (!hit) return [true, null];
    if (hit === el || el.contains(hit)) return [true, hit];
    const lab = hit.closest("label");
    if (lab && (lab as HTMLLabelElement).control === el) return [true, hit];
    return [false, hit];
  };
  /** contiguous tappable px from the centre in one direction (capped at the radius) */
  const extent = (el: Element, cx: number, cy: number, dx: number, dy: number): number => {
    let d = 0;
    while (d < R && takes(el, cx + dx * (d + 1), cy + dy * (d + 1))[0]) d++;
    return d;
  };

  const els = Array.from(scope.querySelectorAll<HTMLElement>(selector));
  const out: HitBoxMiss[] = [];
  for (const el of els) {
    if (!visible(el)) continue;
    // to the middle of its scroll container(s) (the page, or a sheet / dialog body) – sticky bars out of the way
    if (!fixedish(el) || el.closest('[role="dialog"]')) {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      await raf();
    }
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // tappable extent through the centre on both axes (the centre itself must take the tap: else something covers it)
    const [centreOk, centreHit] = takes(el, cx, cy);
    const ew = centreOk ? extent(el, cx, cy, -1, 0) + extent(el, cx, cy, 1, 0) + 1 : 0;
    const eh = centreOk ? extent(el, cx, cy, 0, -1) + extent(el, cx, cy, 0, 1) + 1 : 0;
    // 2 px of slack: the probe walks whole px from a fractional centre (DPR 1.75 / 3 layouts), so a 44 px area can
    // measure 42–44
    if (ew >= min - 2 && eh >= min - 2) continue;
    let stolen: Element | null = centreOk ? null : centreHit;
    if (!stolen)
      for (const [x, y] of [
        [cx - R - 1, cy],
        [cx + R + 1, cy],
        [cx, cy - R - 1],
        [cx, cy + R + 1],
      ] as const) {
        const [t, hit] = takes(el, x, y);
        if (!t) {
          stolen = hit;
          break;
        }
      }
    const where = el.closest("header") ? "header" : el.closest('[role="toolbar"][aria-label="Navigation"]') ? "dock" : el.closest("footer") ? "footer" : el.closest('[role="dialog"]') ? `dialog ${el.closest('[role="dialog"]')?.getAttribute("aria-label") ?? ""}` : (el.closest("[data-testid]")?.getAttribute("data-testid") ?? el.closest("section[aria-label], article[aria-label]")?.getAttribute("aria-label") ?? "page");
    out.push({ name: short(el), w: Math.round(r.width), h: Math.round(r.height), ew, eh, stolenBy: short(stolen), where });
  }
  window.scrollTo({ top: 0, behavior: "instant" });
  return out;
}
