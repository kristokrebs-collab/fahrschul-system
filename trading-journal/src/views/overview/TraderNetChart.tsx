/**
 * "Top-Trader netto" chart (canvas, own lazy chunk): the net curve of the big Binance accounts as an area around the zero
 * line (green above, red below), the price as a thin line on its own scale, a mark at the last sign change that stuck and
 * the newest point. Drawn in once with an ease-out wipe from left to right (`tween.draw`, first opening only; reduced
 * motion and later openings paint the finished chart at once), the flip mark fades in at the end. Hover / touch / the arrow
 * keys move a crosshair with a readout – straight to the DOM (one rAF per move, no React render, no layout read per
 * move). The box has a fixed height (`NET_CHART_H`), so nothing around it moves while it paints or resizes.
 *
 * Colours come from the live palette (`ink`), so the light theme repaints it (`useTheme`); the canvas is aria-hidden – the
 * wrapper is a keyboard-focusable group named by `chartLabel`, the readout is announced politely on key moves.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ink, withAlpha } from "@/chart/ink";
import type { TraderNetView } from "@/domain/signals";
import { createFrameLoop } from "@/motion/pulse/engine";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useTheme } from "@/store/themeStore";
import { chartLabel, dayLabel, NET_CHART_H, nearestIndex, netGeometry, readoutOf, type NetGeometry } from "./traderNetChart";

const FONT = "10px 'IBM Plex Mono', ui-monospace, Menlo, monospace";
const TIP_W = 190;
/** the wipe: ease-out quart ≈ `ease.out`, over `tween.draw.duration` */
const easeOut = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4);

function fillArea(ctx: CanvasRenderingContext2D, g: NetGeometry, v: TraderNetView, up: boolean): void {
  const pts = v.points;
  ctx.save();
  ctx.beginPath();
  if (up) ctx.rect(g.left, g.top, g.right - g.left, g.zeroY - g.top);
  else ctx.rect(g.left, g.zeroY, g.right - g.left, g.bottom - g.zeroY);
  ctx.clip();
  const color = up ? ink.win : ink.loss;
  const grad = ctx.createLinearGradient(0, g.zeroY, 0, up ? g.top : g.bottom);
  grad.addColorStop(0, withAlpha(color, 0.04));
  grad.addColorStop(1, withAlpha(color, 0.34));
  ctx.beginPath();
  ctx.moveTo(g.x(pts[0]!.t), g.zeroY);
  for (const p of pts) ctx.lineTo(g.x(p.t), g.y(p.net));
  ctx.lineTo(g.x(pts[pts.length - 1]!.t), g.zeroY);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(g.x(p.t), g.y(p.net)) : ctx.moveTo(g.x(p.t), g.y(p.net))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

/** Paints the whole chart; `progress` 0 … 1 is the wipe (1 = finished, with the flip mark). */
export function paintNet(ctx: CanvasRenderingContext2D, g: NetGeometry, v: TraderNetView, progress: number): void {
  const pts = v.points;
  ctx.clearRect(0, 0, g.w, g.h);
  ctx.font = FONT;
  ctx.textBaseline = "middle";
  // grid: ±max and the zero line, labels left
  ctx.lineWidth = 1;
  ctx.strokeStyle = ink.grid;
  ctx.beginPath();
  for (const y of [g.top, g.bottom]) {
    ctx.moveTo(g.left, Math.round(y) + 0.5);
    ctx.lineTo(g.right, Math.round(y) + 0.5);
  }
  ctx.stroke();
  ctx.strokeStyle = withAlpha(ink.fg, 0.32);
  ctx.beginPath();
  ctx.moveTo(g.left, Math.round(g.zeroY) + 0.5);
  ctx.lineTo(g.right, Math.round(g.zeroY) + 0.5);
  ctx.stroke();
  ctx.fillStyle = ink.axis;
  ctx.textAlign = "right";
  ctx.fillText(`+${g.max}`, g.left - 6, g.top + 1);
  ctx.fillText("0", g.left - 6, g.zeroY);
  ctx.fillText(`−${g.max}`, g.left - 6, g.bottom - 1);
  // time axis: first, middle, last day
  ctx.textBaseline = "alphabetic";
  const ty = g.h - 5;
  ctx.textAlign = "left";
  ctx.fillText(dayLabel(g.tMin), g.left, ty);
  ctx.textAlign = "center";
  ctx.fillText(dayLabel((g.tMin + g.tMax) / 2), (g.left + g.right) / 2, ty);
  ctx.textAlign = "right";
  ctx.fillText(dayLabel(g.tMax), g.right, ty);
  ctx.textBaseline = "middle";

  // the wipe
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, g.left + (g.right - g.left) * progress + 1, g.h);
  ctx.clip();
  fillArea(ctx, g, v, true);
  fillArea(ctx, g, v, false);
  // price: thin line on its own scale, broken where no candle covers a point
  if (g.pMin !== null) {
    ctx.beginPath();
    let pen = false;
    for (const p of pts) {
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
    ctx.strokeStyle = withAlpha(ink.fg, 0.7);
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  ctx.restore();

  // newest point + the flip mark appear with the end of the wipe
  const tail = Math.min(1, Math.max(0, (progress - 0.82) / 0.18));
  if (tail <= 0) return;
  ctx.save();
  ctx.globalAlpha = tail;
  const last = pts[pts.length - 1]!;
  const lastColor = last.net >= 0 ? ink.win : ink.loss;
  ctx.beginPath();
  ctx.arc(g.x(last.t), g.y(last.net), 3, 0, Math.PI * 2);
  ctx.fillStyle = lastColor;
  ctx.fill();
  const f = v.flip;
  if (f) {
    const fx = g.x(f.at);
    const color = f.to === "long" ? ink.win : ink.loss;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = withAlpha(color, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(fx) + 0.5, g.top);
    ctx.lineTo(Math.round(fx) + 0.5, g.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    // the crossing: a ring on the zero line and a small arrow head that points the way the net went
    ctx.beginPath();
    ctx.arc(fx, g.zeroY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = ink.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    const dir = f.to === "short" ? 1 : -1;
    const ay = g.zeroY + dir * -11;
    ctx.beginPath();
    ctx.moveTo(fx - 4, ay);
    ctx.lineTo(fx + 4, ay);
    ctx.lineTo(fx, ay + dir * 6);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    // label pill at the top, on the side with room
    const text = `${f.to === "long" ? "Long" : "Short"} ab ${dayLabel(f.at)}`;
    ctx.textAlign = "left";
    const tw = ctx.measureText(text).width + 12;
    const right = fx > g.w * 0.62;
    const bx = right ? fx - 6 - tw : fx + 6;
    ctx.fillStyle = withAlpha(ink.bg, 0.88);
    ctx.strokeStyle = withAlpha(color, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(bx, g.top + 4, tw, 17, 8.5);
    else ctx.rect(bx, g.top + 4, tw, 17);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, bx + 6, g.top + 13);
  }
  ctx.restore();
}

export interface TraderNetChartProps {
  view: TraderNetView;
  /** draw in with the ease-out wipe (the first opening); `false` paints the finished chart at once */
  animate: boolean;
  /** called once the wipe is done (so the next opening does not replay it) */
  onDrawn?: () => void;
}

export default function TraderNetChart({ view, animate, onDrawn }: TraderNetChartProps) {
  const reduced = useReducedFx();
  const theme = useTheme((s) => `${s.resolved}:${s.accent}`);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cross = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const tipStamp = useRef<HTMLSpanElement>(null);
  const tipNet = useRef<HTMLSpanElement>(null);
  const tipPrice = useRef<HTMLSpanElement>(null);
  const speak = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState(0);
  const geo = useMemo(() => netGeometry(view.points, w), [view.points, w]);
  const rectLeft = useRef(0);
  const raf = useRef(0);
  const idx = useRef(-1);
  const drawnOnce = useRef(false);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setW(Math.round(el.clientWidth));
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || !geo) return;
    const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    c.width = Math.round(geo.w * dpr);
    c.height = Math.round(geo.h * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduced || !animate || drawnOnce.current) {
      paintNet(ctx, geo, view, 1);
      drawnOnce.current = true;
      return;
    }
    let t = 0;
    const loop = createFrameLoop((dt) => {
      t += dt;
      const p = easeOut(t / tween.draw.duration);
      paintNet(ctx, geo, view, p);
      if (p >= 1) {
        drawnOnce.current = true;
        onDrawn?.();
        return false;
      }
      return true;
    });
    paintNet(ctx, geo, view, 0);
    loop.wake();
    return () => loop.stop();
    // the theme is a repaint signal (the palette is read while drawing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, view, reduced, animate, theme]);

  const show = useCallback(
    (i: number, announce: boolean) => {
      if (!geo || i < 0 || i >= view.points.length) return;
      idx.current = i;
      const p = view.points[i]!;
      const x = geo.x(p.t);
      const r = readoutOf(p);
      if (cross.current) {
        cross.current.style.transform = `translateX(${x.toFixed(1)}px)`;
        cross.current.style.opacity = "1";
      }
      if (dot.current) {
        dot.current.style.transform = `translate(${x.toFixed(1)}px, ${geo.y(p.net).toFixed(1)}px)`;
        dot.current.style.opacity = "1";
      }
      if (tip.current) {
        tip.current.style.transform = `translateX(${Math.max(2, Math.min(geo.w - TIP_W - 2, x < geo.w / 2 ? x + 12 : x - 12 - TIP_W)).toFixed(1)}px)`;
        tip.current.style.opacity = "1";
      }
      if (tipStamp.current) tipStamp.current.textContent = r.stamp;
      if (tipNet.current) tipNet.current.textContent = r.net;
      if (tipPrice.current) tipPrice.current.textContent = r.price;
      if (announce && speak.current) speak.current.textContent = r.speak;
    },
    [geo, view.points],
  );

  const hide = useCallback(() => {
    cancelAnimationFrame(raf.current);
    idx.current = -1;
    for (const el of [cross.current, tip.current, dot.current]) if (el) el.style.opacity = "0";
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // a tap elsewhere closes the readout a touch left open
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (idx.current >= 0 && wrap.current && !wrap.current.contains(e.target as Node)) hide();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [hide]);

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!geo) return;
    if (e.type === "pointerdown" || e.type === "pointerenter" || rectLeft.current === 0) rectLeft.current = e.currentTarget.getBoundingClientRect().left;
    const px = e.clientX - rectLeft.current;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => show(nearestIndex(view.points, geo, px), false));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = view.points.length;
    const cur = idx.current < 0 ? n - 1 : idx.current;
    const next = e.key === "ArrowLeft" ? cur - 1 : e.key === "ArrowRight" ? cur + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "Escape" ? -2 : null;
    if (next === null) return;
    e.preventDefault();
    if (next === -2) return hide();
    show(Math.min(n - 1, Math.max(0, next)), true);
  };

  return (
    <div
      ref={wrap}
      role="group"
      aria-label={chartLabel(view)}
      aria-roledescription="Diagramm"
      tabIndex={0}
      onPointerEnter={onMove}
      onPointerDown={onMove}
      onPointerMove={onMove}
      onPointerLeave={(e) => e.pointerType !== "touch" && (hide(), (rectLeft.current = 0))}
      onKeyDown={onKey}
      onBlur={hide}
      className="relative w-full select-none overflow-hidden rounded-xl border border-line bg-ink-950/40 outline-none focus-visible:border-white/50 [touch-action:pan-y]"
      style={{ height: NET_CHART_H }}
      data-testid="trader-net-chart"
      data-points={view.points.length}
      data-flip={view.flip ? String(Math.round(view.flip.at)) : "none"}
    >
      <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div ref={cross} className="absolute left-0 w-px bg-fg/45 opacity-0" style={{ top: 10, bottom: 20 }} />
        <span ref={dot} className="absolute left-0 top-0 -ml-[3.5px] -mt-[3.5px] size-[7px] rounded-full border border-fg bg-ink-950 opacity-0" />
        <div ref={tip} className="absolute left-0 top-1 grid gap-0.5 rounded-lg border border-line-2 bg-ink-900/95 px-2 py-1.5 font-mono text-[10.5px] leading-tight opacity-0" style={{ width: TIP_W }} data-testid="trader-net-tip">
          <span ref={tipStamp} className="text-faint" />
          <span ref={tipNet} className="text-fg" />
          <span ref={tipPrice} className="text-mute" />
        </div>
      </div>
      <span ref={speak} className="sr-only" aria-live="polite" />
    </div>
  );
}
