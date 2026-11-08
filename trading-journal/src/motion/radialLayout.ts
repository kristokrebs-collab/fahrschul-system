/**
 * Radial share (R11): where the targets of the fan sit. PURE – no DOM, so the clamp at the screen edge is testable.
 *
 * The targets stand on an arc around the centre of the trigger. The arc prefers to open UPWARDS (−90°); when the trigger sits
 * at an edge the whole fan turns (in 12° steps, the smallest turn first) until every target is fully inside the viewport,
 * and the radius grows until no target touches the trigger itself. Targets never overlap each other (the angle between two
 * is chosen from their size), so each one keeps its own ≥ 44 px touch area.
 */

export interface RadialInput {
  /** Number of targets (1–6). */
  n: number;
  /** Centre of the trigger in viewport px. */
  origin: { x: number; y: number };
  /** Visible viewport size in px. */
  viewport: { w: number; h: number };
  /** Size of the trigger button (so the fan keeps off it). */
  hub: { w: number; h: number };
  /** Target diameter in px (default 48 – above the 44 px touch minimum). */
  item?: number;
  /** Free space kept between a target and the screen edge / its neighbour (px, default 8). */
  gap?: number;
  /** Preferred direction of the middle of the fan in degrees, 0 = right, −90 = up (default −90). */
  prefer?: number;
}

export interface RadialFan {
  /** Centre of each target relative to the trigger centre (px), in target order. */
  offsets: { x: number; y: number }[];
  /** Direction of the middle of the fan after the turn (degrees). */
  centerAngle: number;
  /** Angle between two neighbouring targets (degrees). */
  step: number;
  radius: number;
  /** `true` when no turn of the fan fitted the viewport and the targets were pushed inside one by one. */
  clamped: boolean;
}

const RAD = Math.PI / 180;
export const RADIAL_ITEM = 48;
const MIN_RADIUS = 68;
const TURN = 12;

const fitsView = (pts: { x: number; y: number }[], o: { x: number; y: number }, view: { w: number; h: number }, half: number, gap: number): boolean =>
  pts.every((p) => o.x + p.x >= gap + half && o.x + p.x <= view.w - gap - half && o.y + p.y >= gap + half && o.y + p.y <= view.h - gap - half);

/** Whether a target (a square of `item` px, centre `p`) touches the trigger's box (centred at 0, grown by `gap`). */
const touchesHub = (p: { x: number; y: number }, hub: { w: number; h: number }, item: number, gap: number): boolean =>
  Math.abs(p.x) < hub.w / 2 + item / 2 + gap && Math.abs(p.y) < hub.h / 2 + item / 2 + gap;

export function fanLayout({ n, origin, viewport, hub, item = RADIAL_ITEM, gap = 8, prefer = -90 }: RadialInput): RadialFan {
  const count = Math.max(1, Math.min(6, Math.round(n)));
  const half = item / 2;
  let radius = MIN_RADIUS;
  // the angle between neighbours from the chord that keeps `item + gap` between their centres; the radius first grows until
  // that is possible at all, then until no target touches the trigger
  const stepAt = (r: number): number => (count === 1 ? 0 : (2 * Math.asin(Math.min(1, (item + gap) / (2 * r)))) / RAD);
  const place = (centre: number, r: number): { x: number; y: number }[] => {
    const step = stepAt(r);
    return Array.from({ length: count }, (_, i) => {
      const a = (centre + (i - (count - 1) / 2) * step) * RAD;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    });
  };
  const centres: number[] = [prefer];
  for (let d = TURN; d <= 180; d += TURN) centres.push(prefer + d, prefer - d);

  // grow the radius until, for the preferred direction, the fan is clear of the trigger (this also settles the size for every turn)
  for (; radius < 200; radius += 4) if (!place(prefer, radius).some((p) => touchesHub(p, hub, item, gap / 2))) break;

  for (const c of centres) {
    const pts = place(c, radius);
    if (!fitsView(pts, origin, viewport, half, gap)) continue;
    if (pts.some((p) => touchesHub(p, hub, item, gap / 2))) continue;
    return { offsets: pts, centerAngle: c, step: stepAt(radius), radius, clamped: false };
  }
  // nothing fits (a tiny window): the preferred fan, every target pushed inside the viewport on its own
  const pts = place(prefer, radius).map((p) => ({
    x: Math.min(viewport.w - gap - half, Math.max(gap + half, origin.x + p.x)) - origin.x,
    y: Math.min(viewport.h - gap - half, Math.max(gap + half, origin.y + p.y)) - origin.y,
  }));
  return { offsets: pts, centerAngle: prefer, step: stepAt(radius), radius, clamped: true };
}

/** The next enabled index in `dir` (+1 / −1), wrapping; `from` itself when nothing else is enabled; −1 when all are disabled. */
export function stepIndex(from: number, dir: 1 | -1, disabled: readonly boolean[]): number {
  const n = disabled.length;
  if (!n || disabled.every(Boolean)) return -1;
  let i = from;
  for (let k = 0; k < n; k++) {
    i = (((i + dir) % n) + n) % n;
    if (!disabled[i]) return i;
  }
  return from;
}

/** Height the caption needs under / over the trigger (its pill plus the gap to the trigger). */
export const CAPTION_ROOM = 40;

/**
 * Where the caption of the open fan goes (Runde 12): on the side of the trigger AWAY from the fan – below it when the fan opens upwards, above
 * it when the fan turned downwards – so it never lies between a target and the trigger. `null` when that side has no room (a trigger at the
 * screen's edge): the trigger's own word then says what is active, and the caption is simply left out.
 */
export function captionSide(fan: Pick<RadialFan, "centerAngle">, at: { y: number }, viewport: { h: number }, hubH: number, gap = 8): "below" | "above" | null {
  const up = Math.sin(fan.centerAngle * RAD) < 0;
  if (up) return at.y + hubH / 2 + 10 + CAPTION_ROOM <= viewport.h - gap ? "below" : null;
  return at.y - hubH / 2 - 10 - CAPTION_ROOM >= gap ? "above" : null;
}
