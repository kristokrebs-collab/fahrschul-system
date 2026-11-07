/**
 * The big plot of the "Top-Trader: Netto Long/Short" card (canvas, part of the card's lazy chunk): the net of the big Binance
 * accounts as a soft area around the zero line (green above, red below), the price as a thin line on its own scale (axis on
 * the right), the time axis below, and an arrow with a label at the last sign change that stuck.
 *
 * Motion (all of it finite, none while nothing is on screen): the first time the plot is on screen the curve draws itself from
 * the left with an ease-out wipe (`tween.draw`, a small glowing head rides the tip), after it a ring pulses ONCE at the flip
 * (a DOM ring, `transform`/`opacity` only, WAAPI); a change of the range replays a shorter wipe; hovering the time axis lights the
 * area up (a second canvas with the same areas, cross-faded by `opacity`). Reduced motion = the finished picture at once, no ring,
 * no cross-fade.
 *
 * Reading: a crosshair follows the mouse / a finger / the arrow keys and fills a small readout (date, net in points, price) –
 * straight into the DOM, one rAF per move, no React render and no layout read per move (the position comes from the event).
 * Colours come from the live palette (`ink`), so the light theme repaints it (`useTheme`). The canvases are `aria-hidden`; the box
 * is a keyboard-focusable group named by `label`, the readout is announced politely on key moves. Its height is fixed (CSS), so
 * nothing around it moves while it paints or resizes.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ink, withAlpha } from "@/chart/ink";
import type { WhaleMark } from "@/domain/alerts/replay";
import { netDayText, type NetFlip, type NetGap, type NetPoint } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { playWaapi } from "@/motion/fx/shared";
import { useFirstInView } from "@/motion/inView";
import { createFrameLoop } from "@/motion/pulse/engine";
import { ease, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useTheme } from "@/store/themeStore";
import { nearestIndex, netGeometry, readoutOf, type NetGeometry } from "@/views/overview/traderNetChart";
import { gapAt, gapReadout, netTicks, pillPlacement, plotPad, plotStops, priceTicks, splitRuns, timeTicks, type PlotStop } from "./traderNetCardModel";
import { marksByTime, markText } from "./traderNetWal";

const FONT = "10px 'IBM Plex Mono', ui-monospace, Menlo, monospace";
const FONT_BOLD = "600 10.5px 'IBM Plex Mono', ui-monospace, Menlo, monospace";
const TIP_W = 196;
/** a replayed wipe (range switch) is shorter than the first draw-in */
const RE_WIPE_S = 0.65;
/** ease-out quart (the shape of `ease.out`) */
const easeOut = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4);

/** The net value at time `t` (linear between the two neighbours). */
function netAt(points: readonly NetPoint[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  return b.t > a.t ? a.net + ((b.net - a.net) * (Math.min(Math.max(t, a.t), b.t) - a.t)) / (b.t - a.t) : a.net;
}

/** Both halves of the area around zero: a soft vertical gradient (`strength` lifts it for the hover glow), the curve on top. A run is drawn on its own: nothing joins two runs across a gap. */
function fillAreas(ctx: CanvasRenderingContext2D, g: NetGeometry, runs: readonly (readonly NetPoint[])[], strength: number, stroke: boolean): void {
  for (const up of [true, false]) {
    ctx.save();
    ctx.beginPath();
    if (up) ctx.rect(g.left, g.top, g.right - g.left, g.zeroY - g.top);
    else ctx.rect(g.left, g.zeroY, g.right - g.left, g.bottom - g.zeroY);
    ctx.clip();
    const color = up ? ink.win : ink.loss;
    const grad = ctx.createLinearGradient(0, g.zeroY, 0, up ? g.top : g.bottom);
    grad.addColorStop(0, withAlpha(color, 0.03 * strength));
    grad.addColorStop(1, withAlpha(color, Math.min(0.9, 0.4 * strength)));
    ctx.fillStyle = grad;
    for (const pts of runs) {
      if (pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(g.x(pts[0]!.t), g.zeroY);
      for (const p of pts) ctx.lineTo(g.x(p.t), g.y(p.net));
      ctx.lineTo(g.x(pts[pts.length - 1]!.t), g.zeroY);
      ctx.closePath();
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.7;
      ctx.lineJoin = "round";
      for (const pts of runs) {
        if (pts.length === 1) {
          // a run of one point (the history has a gap on both sides): a dot, not a line
          ctx.beginPath();
          ctx.arc(g.x(pts[0]!.t), g.y(pts[0]!.net), 2.2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(g.x(p.t), g.y(p.net)) : ctx.moveTo(g.x(p.t), g.y(p.net))));
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/** The stretches without points: a faint band with dashed edges and, when it is wide enough, the words "keine Daten". Nothing is drawn inside. */
function paintGaps(ctx: CanvasRenderingContext2D, g: NetGeometry, gaps: readonly NetGap[]): void {
  if (!gaps.length) return;
  ctx.save();
  for (const gap of gaps) {
    const x0 = g.x(gap.from);
    const x1 = g.x(gap.to);
    if (x1 - x0 < 1) continue;
    ctx.fillStyle = withAlpha(ink.fg, 0.055);
    ctx.fillRect(x0, g.top, x1 - x0, g.bottom - g.top);
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = withAlpha(ink.fg, 0.32);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of [x0, x1]) {
      ctx.moveTo(Math.round(x) + 0.5, g.top);
      ctx.lineTo(Math.round(x) + 0.5, g.bottom);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (x1 - x0 >= 64) {
      ctx.fillStyle = withAlpha(ink.axis, 0.95);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("keine Daten", (x0 + x1) / 2, g.bottom - 12);
    }
  }
  ctx.restore();
}

/** The alert marks on the curve: a ring for a Vorwarnung, a filled diamond for a Bestätigung; green or red by the side; a mark the repeat block held back is faint. */
function paintMarks(ctx: CanvasRenderingContext2D, g: NetGeometry, pts: readonly NetPoint[], marks: readonly WhaleMark[]): void {
  if (!marks.length) return;
  const net = new Map(pts.map((p) => [p.t, p.net] as const));
  ctx.save();
  for (const m of marks) {
    const v = net.get(m.t);
    if (v === undefined) continue;
    const x = g.x(m.t);
    const y = g.y(v);
    const color = m.side === "green" ? ink.win : ink.loss;
    ctx.globalAlpha = m.suppressed ? 0.5 : 1;
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = color;
    ctx.beginPath();
    if (m.level === "warn") {
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = ink.bg;
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.moveTo(x, y - 6.5);
      ctx.lineTo(x + 6.5, y);
      ctx.lineTo(x, y + 6.5);
      ctx.lineTo(x - 6.5, y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = ink.bg;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The glow layer: the same areas, stronger, no axes – its `opacity` is what the time-axis hover animates. */
export function paintGlow(ctx: CanvasRenderingContext2D, g: NetGeometry, pts: readonly NetPoint[], gaps: readonly NetGap[] = []): void {
  ctx.clearRect(0, 0, g.w, g.h);
  fillAreas(ctx, g, splitRuns(pts, gaps), 1.7, false);
}

/** What the plot shows on top of the curve: the stretches without points and the alert marks. */
export interface PlotDecor {
  gaps: readonly NetGap[];
  marks: readonly WhaleMark[];
}

/** Paints the whole plot; `progress` 0 … 1 is the wipe (1 = finished, with the flip arrow and the newest point). */
export function paintPlot(ctx: CanvasRenderingContext2D, g: NetGeometry, pts: readonly NetPoint[], flip: NetFlip | null, progress: number, priceName = "BTC", decor: PlotDecor = { gaps: [], marks: [] }): void {
  ctx.clearRect(0, 0, g.w, g.h);
  const runs = splitRuns(pts, decor.gaps);
  ctx.font = FONT;
  ctx.lineWidth = 1;
  // grid and the net axis (left)
  const nticks = netTicks(g);
  ctx.strokeStyle = ink.grid;
  ctx.beginPath();
  for (const t of nticks) {
    if (t.v === 0) continue;
    ctx.moveTo(g.left, Math.round(t.y) + 0.5);
    ctx.lineTo(g.right, Math.round(t.y) + 0.5);
  }
  ctx.stroke();
  ctx.strokeStyle = withAlpha(ink.fg, 0.34);
  ctx.beginPath();
  ctx.moveTo(g.left, Math.round(g.zeroY) + 0.5);
  ctx.lineTo(g.right, Math.round(g.zeroY) + 0.5);
  ctx.stroke();
  ctx.fillStyle = ink.axis;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of nticks) ctx.fillText(t.label, g.left - 7, t.y + (t.v > 0 ? 1 : t.v < 0 ? -1 : 0));
  // the price axis (right)
  ctx.textAlign = "left";
  for (const t of priceTicks(g)) ctx.fillText(t.label, g.right + 7, t.y);
  // the two axes say what they measure, above the plot: points of net (left) and the price (right, its own scale)
  ctx.fillStyle = withAlpha(ink.axis, 0.85);
  ctx.textAlign = "right";
  ctx.fillText("Pkt.", g.left - 7, g.top - 9);
  ctx.textAlign = "left";
  ctx.fillText(priceName, g.right + 7, g.top - 9);
  ctx.fillStyle = ink.axis;
  // the time axis (below)
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const t of timeTicks(g)) {
    ctx.strokeStyle = ink.grid;
    ctx.beginPath();
    ctx.moveTo(Math.round(t.x) + 0.5, g.bottom);
    ctx.lineTo(Math.round(t.x) + 0.5, g.bottom + 4);
    ctx.stroke();
    ctx.fillText(t.label, t.x, g.h - 7);
  }
  ctx.textBaseline = "middle";
  paintGaps(ctx, g, decor.gaps);

  // the wipe: areas, curve, price line and the glowing head all live inside the growing clip
  const front = g.left + (g.right - g.left) * progress;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, front + 1, g.h);
  ctx.clip();
  fillAreas(ctx, g, runs, 1, true);
  if (g.pMin !== null) {
    ctx.beginPath();
    for (const run of runs) {
      let pen = false;
      for (const p of run) {
        if (p.price === null) {
          pen = false;
          continue;
        }
        const x = g.x(p.t);
        const y = g.yPrice(p.price);
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      }
    }
    ctx.strokeStyle = withAlpha(ink.fg, 0.78);
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  ctx.restore();
  const headT = g.tMin + progress * (g.tMax - g.tMin);
  if (progress > 0 && progress < 1 && !gapAt(decor.gaps, headT)) {
    // the head riding the tip of the curve (not inside a gap: nothing runs there)
    const hy = g.y(netAt(pts, headT));
    const c = hy <= g.zeroY ? ink.win : ink.loss;
    ctx.beginPath();
    ctx.arc(front, hy, 7, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(c, 0.22);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(front, hy, 3, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  }

  // the newest point and the flip arrow appear with the end of the wipe
  const tail = Math.min(1, Math.max(0, (progress - 0.82) / 0.18));
  if (tail <= 0) return;
  ctx.save();
  ctx.globalAlpha = tail;
  const last = pts[pts.length - 1]!;
  const lastColor = last.net >= 0 ? ink.win : ink.loss;
  ctx.beginPath();
  ctx.arc(g.x(last.t), g.y(last.net), 7, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(lastColor, 0.2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(g.x(last.t), g.y(last.net), 3.2, 0, Math.PI * 2);
  ctx.fillStyle = lastColor;
  ctx.fill();
  paintMarks(ctx, g, pts, decor.marks);
  if (flip) paintFlip(ctx, g, pts, flip);
  ctx.restore();
}

/** The arrow from the label down to the crossing, a ring on the zero line and a dashed guide below it. */
function paintFlip(ctx: CanvasRenderingContext2D, g: NetGeometry, pts: readonly NetPoint[], flip: NetFlip): void {
  const fx = g.x(flip.at);
  const color = flip.to === "long" ? ink.win : ink.loss;
  // dashed guide through the crossing
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = withAlpha(color, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(fx) + 0.5, g.zeroY);
  ctx.lineTo(Math.round(fx) + 0.5, g.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  // the label
  const text = `Umschlag zu ${flip.to === "long" ? "Long" : "Short"} · ${netDayText(flip.at)}`;
  ctx.font = FONT_BOLD;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const tw = Math.ceil(ctx.measureText(text).width) + 16;
  const ph = 20;
  const py = g.top - 6;
  const bx = pillPlacement(g, pts, fx, tw);
  ctx.fillStyle = withAlpha(ink.bg, 0.92);
  ctx.strokeStyle = withAlpha(color, 0.7);
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(bx, py, tw, ph, ph / 2);
  else ctx.rect(bx, py, tw, ph);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, bx + 8, py + ph / 2 + 0.5);
  // the arrow: a shaft from the label to just above the ring, a head pointing at the crossing
  const ax = Math.min(Math.max(fx, bx + 10), bx + tw - 10);
  const from = py + ph;
  const to = g.zeroY - 9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(ax, from);
  if (ax !== fx) ctx.lineTo(fx, from + 6);
  ctx.lineTo(fx, to - 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(fx - 4.5, to - 7);
  ctx.lineTo(fx + 4.5, to - 7);
  ctx.lineTo(fx, to);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  // the ring on the zero line
  ctx.beginPath();
  ctx.arc(fx, g.zeroY, 5, 0, Math.PI * 2);
  ctx.fillStyle = ink.bg;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.font = FONT;
}

export interface TraderNetPlotProps {
  /** the points of the chosen range (oldest first) */
  points: readonly NetPoint[];
  /** the last flip, only when its crossing lies inside the range */
  flip: NetFlip | null;
  /** changes with the range: the wipe replays (shorter) */
  windowKey: string;
  /** `BTC` – the name of the price line, for the label */
  priceName: string;
  /** accessible name of the plot */
  label: string;
  /** stretches without points inside the range: drawn as a band, the line breaks there */
  gaps?: readonly NetGap[];
  /** the alert rule's marks inside the range */
  marks?: readonly WhaleMark[];
}

const NO_GAPS: readonly NetGap[] = [];
const NO_MARKS: readonly WhaleMark[] = [];

export default function TraderNetPlot({ points, flip, windowKey, priceName, label, gaps = NO_GAPS, marks = NO_MARKS }: TraderNetPlotProps) {
  const reduced = useReducedFx();
  const theme = useTheme((s) => `${s.resolved}:${s.accent}`);
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const glow = useRef<HTMLCanvasElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const cross = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const dotPrice = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const tipStamp = useRef<HTMLSpanElement>(null);
  const tipNet = useRef<HTMLSpanElement>(null);
  const tipPrice = useRef<HTMLSpanElement>(null);
  const tipMark = useRef<HTMLSpanElement>(null);
  const speak = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** the range whose draw-in has finished (`data-drawn`, for the specs) */
  const [drawnKey, setDrawnKey] = useState<string | null>(null);
  const geo = useMemo(() => netGeometry(points as NetPoint[], size.w, size.h, plotPad(size.w)), [points, size.w, size.h]);
  const decor = useMemo<PlotDecor>(() => ({ gaps, marks }), [gaps, marks]);
  // the stops of the crosshair and the arrow keys: every point and every gap between two points
  const stops = useMemo<PlotStop[]>(() => plotStops(points, gaps), [points, gaps]);
  const markAt = useMemo(() => marksByTime(marks), [marks]);
  const seen = useFirstInView(wrap, !reduced);
  const raf = useRef(0);
  const idx = useRef(-1);
  // the wipe
  const progress = useRef(0);
  const wipedFor = useRef<string | null>(null);
  const wipeT = useRef(0);
  const wipeDur = useRef<number>(tween.draw.duration);
  const pulsed = useRef(false);
  const paintRef = useRef<() => void>(() => undefined);
  const loop = useRef<ReturnType<typeof createFrameLoop> | null>(null);
  const flipRef = useRef(flip);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === Math.round(el.clientWidth) && s.h === Math.round(el.clientHeight) ? s : { w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) }));
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** closes the readout, the crosshair and the glow */
  const hide = useCallback(() => {
    cancelAnimationFrame(raf.current);
    idx.current = -1;
    for (const el of [cross.current, tip.current, dot.current, dotPrice.current]) if (el) el.style.opacity = "0";
    if (glow.current) glow.current.style.opacity = "0";
  }, []);

  /** the ring at the flip: one pulse, compositor only */
  const pulse = useCallback(() => {
    if (pulsed.current || reduced || !flipRef.current) return;
    pulsed.current = true;
    playWaapi(ring.current, [{ transform: "scale(0.55)", opacity: 0.85 }, { transform: "scale(3.4)", opacity: 0 }], { duration: 1.1, ease: ease.out });
  }, [reduced]);

  useLayoutEffect(() => {
    flipRef.current = flip;
    const c = base.current;
    const gl = glow.current;
    if (!c || !gl || !geo) return;
    const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    const ctx = c.getContext("2d");
    const gctx = gl.getContext("2d");
    if (!ctx || !gctx) return;
    for (const cv of [c, gl]) {
      cv.width = Math.round(geo.w * dpr);
      cv.height = Math.round(geo.h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintRef.current = () => {
      paintPlot(ctx, geo, points, flip, progress.current, priceName, decor);
      if (progress.current >= 1) paintGlow(gctx, geo, points, gaps);
      else gctx.clearRect(0, 0, geo.w, geo.h);
    };
    // the first sight of the plot (and a changed range) draws it in; before that only the axes stand there
    if (reduced) {
      if (wipedFor.current !== null && wipedFor.current !== windowKey) hide();
      progress.current = 1;
      wipedFor.current = windowKey;
    } else if (!seen) {
      progress.current = 0;
    } else if (wipedFor.current !== windowKey) {
      const first = wipedFor.current === null;
      // a changed range: the readout of the old picture goes away with it
      if (!first) hide();
      wipedFor.current = windowKey;
      progress.current = 0;
      wipeT.current = 0;
      wipeDur.current = first ? tween.draw.duration : RE_WIPE_S;
      loop.current ??= createFrameLoop((dt) => {
        wipeT.current += dt;
        progress.current = easeOut(wipeT.current / wipeDur.current);
        paintRef.current();
        if (progress.current >= 1) {
          pulse();
          setDrawnKey(wipedFor.current);
          return false;
        }
        return true;
      });
      paintRef.current();
      loop.current.wake();
      return;
    }
    paintRef.current();
    // a draw-in that was stopped by a remount (StrictMode runs the cleanup and the setup again) goes on
    if (!reduced && seen && wipedFor.current === windowKey && progress.current < 1) loop.current?.wake();
    // the theme is a repaint signal (the palette is read while drawing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, points, flip, reduced, seen, windowKey, theme, priceName, hide, decor, gaps]);

  useEffect(() => () => loop.current?.stop(), []);

  /** the crosshair and the readout at stop `k` (a point, or a gap between two points – there is no value inside a gap) */
  const show = useCallback(
    (k: number, announce: boolean) => {
      const stop = stops[k];
      if (!geo || !stop) return;
      idx.current = k;
      let x: number;
      let line: { stamp: string; net: string; price: string; speak: string };
      let mark = "";
      if (stop.kind === "point") {
        const p = points[stop.i]!;
        x = geo.x(p.t);
        const r = readoutOf(p);
        line = { ...r, price: r.price.replace(/^Preis/, priceName), speak: r.speak.replace(/Preis /, `${priceName} `) };
        mark = (markAt.get(p.t) ?? []).map(markText).join(" · ");
        if (mark) line.speak += `. ${mark}`;
        if (dot.current) {
          dot.current.style.transform = `translate(${x.toFixed(1)}px, ${geo.y(p.net).toFixed(1)}px)`;
          dot.current.style.opacity = "1";
        }
        if (dotPrice.current) {
          const has = p.price !== null && geo.pMin !== null;
          dotPrice.current.style.transform = `translate(${x.toFixed(1)}px, ${has ? geo.yPrice(p.price as number).toFixed(1) : 0}px)`;
          dotPrice.current.style.opacity = has ? "1" : "0";
        }
      } else {
        x = (geo.x(stop.gap.from) + geo.x(stop.gap.to)) / 2;
        line = gapReadout(stop.gap);
        if (dot.current) dot.current.style.opacity = "0";
        if (dotPrice.current) dotPrice.current.style.opacity = "0";
      }
      if (cross.current) {
        cross.current.style.transform = `translateX(${x.toFixed(1)}px)`;
        cross.current.style.opacity = "1";
      }
      if (tip.current) {
        tip.current.style.transform = `translateX(${Math.max(2, Math.min(geo.w - TIP_W - 2, x < geo.w / 2 ? x + 14 : x - 14 - TIP_W)).toFixed(1)}px)`;
        tip.current.style.opacity = "1";
      }
      if (tipStamp.current) tipStamp.current.textContent = line.stamp;
      if (tipNet.current) tipNet.current.textContent = line.net;
      if (tipPrice.current) tipPrice.current.textContent = line.price;
      if (tipMark.current) tipMark.current.textContent = mark;
      if (announce && speak.current) speak.current.textContent = line.speak;
    },
    [geo, points, stops, markAt, priceName],
  );

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // a tap elsewhere closes the readout a touch left open
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (idx.current >= 0 && wrap.current && !wrap.current.contains(e.target as Node)) hide();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [hide]);

  /** the stop under a position: inside a gap the gap, else the nearest point */
  const stopAt = (px: number): number => {
    if (!geo) return -1;
    const t = geo.tMin + ((Math.min(Math.max(px, geo.left), geo.right) - geo.left) / (geo.right - geo.left)) * (geo.tMax - geo.tMin);
    const gap = gaps.length ? gapAt(gaps, t) : null;
    if (gap) return stops.findIndex((s) => s.kind === "gap" && s.gap.from === gap.from);
    const i = nearestIndex(points as NetPoint[], geo, px);
    return stops.findIndex((s) => s.kind === "point" && s.i === i);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!geo) return;
    // the position comes from the event (the layers do not take pointer events, so the target is the box itself)
    const ne = e.nativeEvent;
    const ox = Number.isFinite(ne.offsetX) && e.target === e.currentTarget ? ne.offsetX : e.clientX - e.currentTarget.getBoundingClientRect().left;
    const oy = Number.isFinite(ne.offsetY) && e.target === e.currentTarget ? ne.offsetY : e.clientY - e.currentTarget.getBoundingClientRect().top;
    // over the time axis the area lights up as well (the crosshair keeps following)
    if (glow.current) glow.current.style.opacity = oy > geo.bottom + 2 && progress.current >= 1 ? "1" : "0";
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => show(stopAt(ox), false));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = stops.length;
    const cur = idx.current < 0 ? n - 1 : idx.current;
    const next = e.key === "ArrowLeft" ? cur - 1 : e.key === "ArrowRight" ? cur + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "Escape" ? -2 : null;
    if (next === null) return;
    e.preventDefault();
    if (next === -2) return hide();
    show(Math.min(n - 1, Math.max(0, next)), true);
  };

  const fx = geo && flip ? geo.x(flip.at) : 0;
  const crossTop = geo ? geo.top : 10;
  const crossBottom = geo ? geo.h - geo.bottom : 20;
  return (
    <div
      ref={wrap}
      role="group"
      aria-label={label}
      aria-roledescription="Diagramm"
      tabIndex={0}
      onPointerEnter={onMove}
      onPointerDown={onMove}
      onPointerMove={onMove}
      onPointerLeave={(e) => e.pointerType !== "touch" && hide()}
      onKeyDown={onKey}
      onBlur={hide}
      className="relative h-[256px] w-full select-none overflow-hidden rounded-xl border border-line bg-ink-950/40 outline-none focus-visible:border-white/50 lg:h-[336px] [touch-action:pan-y]"
      data-testid="trader-net-plot"
      data-points={points.length}
      data-gaps={gaps.length}
      data-marks={marks.length}
      data-flip={flip ? String(Math.round(flip.at)) : "none"}
      data-drawn={reduced || drawnKey === windowKey ? "true" : "false"}
    >
      <canvas ref={base} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      <canvas ref={glow} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 h-full w-full opacity-0 transition-opacity duration-200 ease-out motion-reduce:transition-none")} data-testid="trader-net-glow" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {geo && flip && (
          <span className="absolute left-0 top-0 block" style={{ transform: `translate(${fx.toFixed(1)}px, ${geo.zeroY.toFixed(1)}px)` }}>
            <span ref={ring} className={cn("absolute -left-2.5 -top-2.5 block size-5 rounded-full border-2 opacity-0", flip.to === "long" ? "border-win" : "border-loss")} data-testid="trader-net-ring" />
          </span>
        )}
        <div ref={cross} className="absolute left-0 w-px bg-fg/45 opacity-0" style={{ top: crossTop, bottom: crossBottom }} />
        <span ref={dot} className="absolute left-0 top-0 -ml-[3.5px] -mt-[3.5px] size-[7px] rounded-full border border-fg bg-ink-950 opacity-0" />
        <span ref={dotPrice} className="absolute left-0 top-0 -ml-[3px] -mt-[3px] size-[6px] rounded-full bg-fg opacity-0" />
        <div ref={tip} className="absolute left-0 top-6 grid gap-0.5 rounded-lg border border-line-2 bg-ink-900/95 px-2.5 py-1.5 font-mono text-[10.5px] leading-tight opacity-0" style={{ width: TIP_W }} data-testid="trader-net-tip">
          <span ref={tipStamp} className="text-mute" />
          <span ref={tipNet} className="text-fg" />
          <span ref={tipPrice} className="text-mute" />
          <span ref={tipMark} className="text-fg empty:hidden" data-testid="trader-net-tip-mark" />
        </div>
      </div>
      <span ref={speak} className="sr-only" aria-live="polite" />
    </div>
  );
}
