/**
 * "Kontostand" equity curve – Recharts AreaChart, 1:1 with the bundle (Plan 5.7, brief read_stats §7).
 * Data shape = `stats.equity`: `[{ i: 0, v: start, t: null }, { i: 1, v, t: Trade }, …]`.
 *
 * Motion (all compositor, zero React renders after mount):
 * - draw-in: the area wipes open left to right (`clip-path`, `tween.draw`) the first time the chart is in view;
 * - "jetzt": a breathing dot at the last point (`PulseDot`), gliding (`spring.smooth`) and pinging on new data;
 * - hover: a cursor line, a point dot and a readout that glide between points (`spring.tooltip`); text is written
 *   through refs and positions through MotionValues, so moving the pointer never re-renders the chart;
 * - replay (pulse `agent-trace`): a slim scrub row under the plot. Dragging (or the slider keys) replays the curve –
 *   everything right of the playhead sinks under a veil, the readout runs trade #, balance and win rate live and the
 *   trade markers wake up as the playhead passes them; releasing glides back to "jetzt" and the overlays fade.
 *   One time value `t` drives it all (`replay.ts`), pointer samples are applied once per frame.
 * Recharts' own animation stays off (`isAnimationActive={false}`, bundle parity). Reduced motion: static, the
 * replay jumps (scrubbing itself stays, it is user-driven).
 */
import { animate, motion, useMotionValue, useSpring, useTransform, type AnimationPlaybackControls } from "motion/react";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis, usePlotArea, useXAxisScale, useYAxisScale } from "recharts";
import type { Trade } from "@/domain/types";
import { ChartContainer, type ChartConfig } from "@/ui/chart";
import { cn } from "@/lib/cn";
import { createFrameLoop, latestPointer } from "@/motion/pulse/engine";
import { canObserveInView, observeInView } from "@/motion/inView";
import { PulseDot } from "@/motion/PulseDot";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useHoverRect } from "@/primitives/hoverRect";
import { fmt, tradeTime } from "./format";
import { buildReplaySeries, replayAt, replayKey, timeAtX, xAtTime } from "./replay";
import { TOOLTIP_CLASS, placeTooltip } from "./tooltip";
import { axisTick } from "./AxisTick";

export interface EquityPoint {
  /** 0 = start, n = n-th closed trade */
  i: number;
  /** balance after trade `i` */
  v: number;
  t: Trade | null;
}

export interface EquityChartProps {
  points: EquityPoint[];
  /** start capital (reference line) */
  start: number;
  /** current balance → accent colour (`#f2f2f2` ≥ start, `#ff4d4f` below) */
  balance: number;
  currency: string;
  /** px, default 268 */
  height?: number;
  className?: string;
}

export const EQUITY_COLORS = {
  up: "#f2f2f2",
  down: "#ff4d4f",
  strokeStart: "#5f5f5f",
  grid: "#1c1c1c",
  ref: "#3a3a3a",
  tick: "#5f5f5f",
} as const;
export const TICK_STYLE = {
  fill: "#5f5f5f",
  fontSize: 11,
  fontFamily: "IBM Plex Mono, monospace",
} as const;

/** Axis labels as plain `<text>` (no Recharts `Text` measuring, no per-mount style read – `AxisTick.tsx`). */
export const TICK = axisTick(TICK_STYLE);

export const equityAccent = (balance: number, start: number): string => (balance >= start ? EQUITY_COLORS.up : EQUITY_COLORS.down);
export const equityTickLabel = (i: number): string => (i === 0 ? "Start" : "#" + i);

/** Pixel geometry of the plotted points (chart-relative px) and the plot area's vertical extent. */
export interface EquityGeometry {
  xs: number[];
  ys: number[];
  top: number;
  height: number;
}

/** Index of the point whose x is closest to `x` (`xs` ascending; `-1` when empty). */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] as number) <= x) lo = mid;
    else hi = mid;
  }
  return Math.abs((xs[hi] as number) - x) < Math.abs((xs[lo] as number) - x) ? hi : lo;
}

/** Changes when the curve's end changes (a new trade, an edit), not when the chart is resized. */
const endKeyOf = (points: readonly EquityPoint[]): string => {
  const last = points[points.length - 1];
  return `${points.length}:${last?.v ?? 0}`;
};

const config: ChartConfig = { v: { label: "Kontostand", color: "#f2f2f2" } };
const TIP_WIDTH = 188;
/** Pointer slack beyond the first/last point before the readout hides, px. */
const HOVER_SLACK = 12;

/** Replay scrubber (pulse `agent-trace`, Nothing palette). */
export const REPLAY = {
  label: "Replay",
  sliderLabel: "Kontostand-Verlauf abspielen",
  /** future part of the curve: card ink at this opacity (the pack's ghost bars) */
  veilClass: "bg-ink-900/80",
  /** marker fades: the pack's --dur-dim 160 ms on --ease-out */
  markerTransition: "opacity 160ms cubic-bezier(.22,.8,.3,1), transform 160ms cubic-bezier(.22,.8,.3,1), background-color 160ms cubic-bezier(.22,.8,.3,1)",
  /** more trades than this: no per-trade markers (the playhead and readout still run) */
  maxMarkers: 160,
} as const;

/** Slider value text, e.g. `Trade 7 von 13 · Kontostand 10.420 USDT · Win-Rate 57 %`. */
export function replayValueText(k: number, n: number, balance: number, winRate: number | null, currency: string): string {
  const wr = winRate == null ? "" : ` · Win-Rate ${Math.round(winRate * 100)} %`;
  return `${k === 0 ? "Start" : `Trade ${k} von ${n}`} · Kontostand ${fmt.n0(balance)} ${currency}${wr}`;
}

/** Reads the plotted coordinates from inside the chart (Recharts 3 scale hooks) and hands them out. */
function EquityProbe({ points, onGeometry }: { points: EquityPoint[]; onGeometry: (g: EquityGeometry, endKey: string) => void }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  useLayoutEffect(() => {
    if (!xScale || !yScale || !plot) return;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of points) {
      const x = xScale(p.i);
      const y = yScale(p.v);
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return;
      xs.push(x);
      ys.push(y);
    }
    onGeometry({ xs, ys, top: plot.y, height: plot.height }, endKeyOf(points));
  }, [xScale, yScale, plot, points, onGeometry]);
  return null;
}

export const EquityChart = memo(function EquityChart({ points, start, balance, currency, height = 268, className }: EquityChartProps) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedFx();
  const accent = equityAccent(balance, start);
  const freezeKey = useMemo(() => [points, start, accent] as const, [points, start, accent]);
  const fillId = `eqFill-${id}`;
  const strokeId = `eqStroke-${id}`;
  const box = useRef<HTMLDivElement>(null);
  const geom = useRef<EquityGeometry | null>(null);
  const tracker = useHoverRect();

  // "jetzt" endpoint
  const endX = useMotionValue(0);
  const endY = useMotionValue(0);
  const endOpacity = useMotionValue(0);
  const endPing = useMotionValue(0);
  const endKey = useRef<string | null>(null);
  const revealed = useRef(false);

  // hover readout
  const curX = useMotionValue(0);
  const curY = useMotionValue(0);
  const hover = useMotionValue(0);
  const tipXRaw = useMotionValue(0);
  const tipYRaw = useMotionValue(0);
  const tipX = useSpring(tipXRaw, spring.tooltip);
  const tipY = useSpring(tipYRaw, spring.tooltip);
  const cursor = useRef<HTMLDivElement>(null);
  const tipBox = useRef<HTMLDivElement>(null);
  const tipTitle = useRef<HTMLDivElement>(null);
  const tipPnl = useRef<HTMLSpanElement>(null);
  const tipBalance = useRef<HTMLSpanElement>(null);
  const active = useRef(-1);
  const tipHeight = useRef(0);
  const pnlTone = useRef<string | null>(null);
  const tipWin = useRef<HTMLSpanElement>(null);

  // replay: one time value (trade units) drives playhead, veil, markers, readout and slider
  const n = points.length - 1;
  const series = useMemo(() => buildReplaySeries(points), [points]);
  const replayT = useMotionValue(n);
  const replayOn = useMotionValue(0);
  const tipOpacity = useTransform(() => Math.max(hover.get(), replayOn.get()));
  const [markersOn, setMarkersOn] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const veilClip = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const headDot = useRef<HTMLDivElement>(null);
  const markerBox = useRef<HTMLDivElement>(null);
  const rp = useRef({
    w: 0,
    h: 0,
    active: false,
    dragging: false,
    boxLeft: 0,
    pending: null as number | null,
    k: -1,
    balanceText: "",
    awake: -1,
    glide: null as AnimationPlaybackControls | null,
    fade: null as AnimationPlaybackControls | null,
  });
  const latest = useRef({ series, n, currency, reduced });
  useLayoutEffect(() => {
    latest.current = { series, n, currency, reduced };
  });

  /** Applies replay time `t` to the DOM: transforms always, texts / attributes / markers only when they change. */
  const renderReplay = useCallback(
    (t: number) => {
      const g = geom.current;
      const r = rp.current;
      const { series: sr, n: last, currency: cur } = latest.current;
      if (!g || g.xs.length === 0) return;
      const f = replayAt(sr, t);
      const x = xAtTime(g.xs, f.t);
      const y = xAtTime(g.ys, f.t);
      const x0 = g.xs[0] as number;
      const span = Math.max(1, (g.xs[g.xs.length - 1] as number) - x0);
      if (thumb.current) thumb.current.style.transform = `translate3d(${(x - x0).toFixed(2)}px,0,0)`;
      if (fill.current) fill.current.style.transform = `scale3d(${((x - x0) / span).toFixed(4)},1,1)`;
      if (veil.current) veil.current.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
      if (head.current) head.current.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
      if (headDot.current) headDot.current.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`;
      const balanceText = `${fmt.n0(f.balance)} ${cur}`;
      if (f.k !== r.k || balanceText !== r.balanceText) {
        track.current?.setAttribute("aria-valuenow", String(f.k));
        track.current?.setAttribute("aria-valuetext", replayValueText(f.k, last, f.balance, f.winRate, cur));
      }
      // markers wake (or fall asleep again) only where the playhead crossed them since the last frame
      const mk = markerBox.current;
      if (mk && f.k !== r.awake) {
        const lo = Math.min(r.awake, f.k) + 1;
        const hi = Math.max(r.awake, f.k);
        for (let i = Math.max(1, lo); i <= hi; i++) {
          const m = mk.children[i - 1] as HTMLElement | undefined;
          if (m) m.toggleAttribute("data-awake", i <= f.k);
        }
        r.awake = f.k;
      }
      if (r.active) {
        if (f.k !== r.k) {
          const p = points[f.k];
          const tr = p?.t ?? null;
          if (tipTitle.current) tipTitle.current.textContent = tr ? `Trade #${f.k} · ${fmt.date(new Date(tradeTime(tr)))}` : "Start";
          if (tipPnl.current) {
            const pnl = tr?.pnl ?? null;
            tipPnl.current.textContent = tr ? `${fmt.signed(pnl)} ${cur}` : "–";
            const tone = !tr ? "text-mute" : pnl != null && pnl < 0 ? "text-loss" : "text-win";
            if (tone !== pnlTone.current) {
              pnlTone.current = tone;
              tipPnl.current.className = cn("num font-mono font-medium", tone);
            }
          }
          if (tipWin.current) tipWin.current.textContent = f.winRate == null ? "–" : `${Math.round(f.winRate * 100)} %`;
        }
        if (balanceText !== r.balanceText && tipBalance.current) tipBalance.current.textContent = balanceText;
        if (!tipHeight.current && tipBox.current) tipHeight.current = tipBox.current.offsetHeight;
        const pos = placeTooltip({ x, y }, { width: r.w, height: r.h }, { width: TIP_WIDTH, height: tipHeight.current || 96 });
        tipXRaw.jump(pos.x);
        tipYRaw.jump(pos.y);
        tipX.jump(pos.x);
        tipY.jump(pos.y);
      }
      r.k = f.k;
      r.balanceText = balanceText;
    },
    [points, tipX, tipY, tipXRaw, tipYRaw],
  );

  /** Geometry changed (resize, new data): track, veil band and markers follow; the current replay frame re-renders. */
  const placeReplay = useCallback(
    (g: EquityGeometry) => {
      const x0 = g.xs[0];
      const x1 = g.xs[g.xs.length - 1];
      if (x0 === undefined || x1 === undefined) return;
      if (track.current) {
        track.current.style.left = `${x0}px`;
        track.current.style.width = `${Math.max(0, x1 - x0)}px`;
      }
      if (veilClip.current) {
        veilClip.current.style.top = `${g.top}px`;
        veilClip.current.style.height = `${g.height}px`;
      }
      if (head.current) {
        head.current.style.top = `${g.top}px`;
        head.current.style.height = `${g.height}px`;
      }
      const mk = markerBox.current;
      const kNow = replayAt(latest.current.series, replayT.get()).k;
      if (mk) {
        for (let i = 1; i < g.xs.length; i++) {
          const m = mk.children[i - 1] as HTMLElement | undefined;
          if (!m) continue;
          m.style.transform = `translate3d(${(g.xs[i] as number).toFixed(2)}px,${(g.ys[i] as number).toFixed(2)}px,0)`;
          m.toggleAttribute("data-awake", i <= kNow);
        }
      }
      rp.current.w = box.current?.clientWidth ?? 0;
      rp.current.h = box.current?.clientHeight ?? 0;
      rp.current.k = -1;
      rp.current.awake = mk ? kNow : -1;
      renderReplay(replayT.get());
    },
    [renderReplay, replayT],
  );

  const onGeometry = useCallback(
    (g: EquityGeometry, key: string) => {
      geom.current = g;
      if (cursor.current) {
        cursor.current.style.top = `${g.top}px`;
        cursor.current.style.height = `${g.height}px`;
      }
      const n = g.xs.length - 1;
      const x = g.xs[n];
      const y = g.ys[n];
      if (x === undefined || y === undefined) return;
      placeReplay(g);
      const fresh = endKey.current !== null && endKey.current !== key;
      endKey.current = key;
      if (fresh && revealed.current && !reduced) {
        animate(endX, x, spring.smooth);
        animate(endY, y, spring.smooth);
        endPing.set(endPing.get() + 1);
      } else {
        endX.jump(x);
        endY.jump(y);
      }
    },
    [endX, endY, endPing, reduced, placeReplay],
  );

  // draw-in on first view: clipped before the first paint (CSS on `data-draw`), wiped open once 10 % is visible
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || revealed.current) return;
    if (reduced || !canObserveInView()) {
      revealed.current = true;
      endOpacity.jump(1);
      return;
    }
    el.dataset.draw = "pending";
    let area: SVGGElement | null = null;
    let wipe: AnimationPlaybackControls | null = null;
    const finish = () => {
      revealed.current = true;
      animate(endOpacity, 1, tween.fade);
      endPing.set(endPing.get() + 1);
    };
    const off = observeInView(el, (inView) => {
      if (!inView || wipe || revealed.current) return;
      area = el.querySelector<SVGGElement>(".eq-area");
      if (area) area.style.clipPath = "inset(0 100% 0 0)";
      el.dataset.draw = "done";
      if (!area) {
        finish();
        return;
      }
      const target = area;
      const run = animate(target, { clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"] }, tween.draw);
      wipe = run;
      run.then(() => {
        target.style.clipPath = "";
        finish();
      });
    });
    return () => {
      off();
      wipe?.stop();
      if (area) area.style.clipPath = "";
      el.dataset.draw = "done";
    };
  }, [reduced, endOpacity, endPing]);

  // markers mount on the first replay: place them before their first paint
  useLayoutEffect(() => {
    if (markersOn && geom.current) placeReplay(geom.current);
  }, [markersOn, placeReplay]);

  // replay time → DOM (frame-synced MotionValue events, no React render)
  useEffect(() => replayT.on("change", renderReplay), [replayT, renderReplay]);
  // new data while live: the playhead stays at "jetzt"
  useEffect(() => {
    if (!rp.current.active) replayT.jump(n);
  }, [n, replayT]);

  // pointer samples are only stored; one frame loop applies the latest per frame
  const scrubLoop = useRef<ReturnType<typeof createFrameLoop> | null>(null);
  useEffect(() => {
    const loop = createFrameLoop(() => {
      const r = rp.current;
      const g = geom.current;
      if (r.pending !== null && g) {
        replayT.jump(timeAtX(g.xs, r.pending));
        r.pending = null;
      }
      return r.dragging;
    });
    scrubLoop.current = loop;
    return () => loop.stop();
  }, [replayT]);

  const enterReplay = () => {
    const r = rp.current;
    r.glide?.stop();
    r.glide = null;
    if (r.active) return;
    r.active = true;
    r.k = -1;
    setMarkersOn(true);
    // the hover readout yields to the replay readout (same tooltip, + win-rate row)
    active.current = -1;
    hover.jump(0);
    box.current?.setAttribute("data-replay", "");
    tipHeight.current = 0;
    r.fade?.stop();
    if (latest.current.reduced) replayOn.jump(1);
    else r.fade = animate(replayOn, 1, tween.fade);
    renderReplay(replayT.get());
  };

  /** Back to live: the playhead glides to "jetzt" (the curve re-reveals), then the overlays fade. */
  const exitReplay = () => {
    const r = rp.current;
    if (!r.active || r.glide) return;
    const done = () => {
      r.glide = null;
      r.active = false;
      tipHeight.current = 0;
      box.current?.removeAttribute("data-replay");
    };
    const { n: last, reduced: red } = latest.current;
    if (red) {
      replayT.jump(last);
      replayOn.jump(0);
      done();
      return;
    }
    r.glide = animate(replayT, last, {
      ...spring.smooth,
      onComplete: () => {
        r.fade?.stop();
        r.fade = animate(replayOn, 0, { ...tween.exit, onComplete: done });
      },
    });
  };

  const onScrubDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !box.current) return;
    const r = rp.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    // one rect read per drag; pointer x is then chart-relative without layout reads
    r.boxLeft = box.current.getBoundingClientRect().left;
    r.dragging = true;
    enterReplay();
    r.pending = e.clientX - r.boxLeft;
    scrubLoop.current?.wake();
  };
  const onScrubMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = rp.current;
    if (!r.dragging) return;
    r.pending = latestPointer(e.nativeEvent).x - r.boxLeft;
    scrubLoop.current?.wake();
  };
  const onScrubUp = () => {
    const r = rp.current;
    if (!r.dragging) return;
    r.dragging = false;
    exitReplay();
  };
  const onScrubKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (rp.current.active) {
        e.preventDefault();
        exitReplay();
      }
      return;
    }
    const next = replayKey(e.key, e.shiftKey, replayT.get(), n);
    if (next === null) return;
    e.preventDefault();
    if (next >= n && !rp.current.active) return;
    enterReplay();
    replayT.jump(next);
    if (next >= n) exitReplay();
  };

  const hide = () => {
    if (active.current === -1) return;
    active.current = -1;
    if (reduced) hover.jump(0);
    else animate(hover, 0, tween.exit);
  };

  const paint = (i: number, g: EquityGeometry, bounds: { width: number; height: number }) => {
    const p = points[i];
    const px = g.xs[i];
    const py = g.ys[i];
    if (!p || px === undefined || py === undefined) return;
    const first = hover.get() === 0;
    const t = p.t;
    if (tipTitle.current) tipTitle.current.textContent = t ? `Trade #${p.i} · ${fmt.date(new Date(tradeTime(t)))}` : "Start";
    if (tipPnl.current) {
      const pnl = t?.pnl ?? null;
      tipPnl.current.textContent = t ? `${fmt.signed(pnl)} ${currency}` : "–";
      const tone = !t ? "text-mute" : pnl != null && pnl < 0 ? "text-loss" : "text-win";
      if (tone !== pnlTone.current) {
        pnlTone.current = tone;
        tipPnl.current.className = cn("num font-mono font-medium", tone);
      }
    }
    if (tipBalance.current) tipBalance.current.textContent = `${fmt.n0(p.v)} ${currency}`;
    // fixed width and row count: one measurement, never a layout read per move
    if (!tipHeight.current && tipBox.current) tipHeight.current = tipBox.current.offsetHeight;
    const pos = placeTooltip({ x: px, y: py }, bounds, {
      width: TIP_WIDTH,
      height: tipHeight.current || 80,
    });
    if (first || reduced) {
      curX.jump(px);
      curY.jump(py);
      tipXRaw.jump(pos.x);
      tipYRaw.jump(pos.y);
      tipX.jump(pos.x);
      tipY.jump(pos.y);
    } else {
      animate(curX, px, spring.tooltip);
      animate(curY, py, spring.tooltip);
      tipXRaw.set(pos.x);
      tipYRaw.set(pos.y);
    }
    if (first) {
      if (reduced) hover.jump(1);
      else animate(hover, 1, tween.fade);
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (rp.current.active) return;
    const g = geom.current;
    const rect = tracker.tracks(e.currentTarget) ? tracker.read() : tracker.enter(e.currentTarget);
    if (!g || !rect || g.xs.length === 0) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const firstX = g.xs[0] as number;
    const lastX = g.xs[g.xs.length - 1] as number;
    if (x < firstX - HOVER_SLACK || x > lastX + HOVER_SLACK || y < 0 || y > rect.height) {
      hide();
      return;
    }
    const i = nearestIndex(g.xs, x);
    if (i === active.current) return;
    active.current = i;
    paint(i, g, { width: rect.width, height: rect.height });
  };

  const onPointerLeave = () => {
    tracker.leave();
    if (!rp.current.active) hide();
  };

  return (
    <>
      <div
        ref={box}
        className={cn("relative w-full [&[data-draw=pending]_.eq-area]:[clip-path:inset(0_100%_0_0)]", className)}
        style={{ height }}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerCancel={onPointerLeave}
      >
        {/* frozen (static SVG) on the hidden keep-alive overview until points / start / colour or size change; hover and
            replay run on the HTML overlays and the kept geometry, so they never need the live chart */}
        <ChartContainer config={config} className="aspect-auto size-full" role="img" aria-label="Kontostand-Verlauf" freezeKey={freezeKey}>
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.32} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={EQUITY_COLORS.strokeStart} />
                <stop offset="100%" stopColor={accent} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={EQUITY_COLORS.grid} strokeDasharray="0" vertical={false} />
            <XAxis dataKey="i" tickLine={false} axisLine={false} minTickGap={28} tick={TICK} tickFormatter={equityTickLabel} />
            {/* five ticks on a ≥ 200 px plot never collide: interval 0 shows them all without measuring the labels */}
            <YAxis width={62} tickLine={false} axisLine={false} domain={["auto", "auto"]} interval={0} tick={TICK} tickFormatter={fmt.mio} />
            <ReferenceLine y={start} stroke={EQUITY_COLORS.ref} strokeDasharray="3 4" />
            <Area
              className="eq-area"
              type="linear"
              dataKey="v"
              stroke={`url(#${strokeId})`}
              strokeWidth={2}
              fill={`url(#${fillId})`}
              isAnimationActive={false}
              dot={false}
              activeDot={false}
            />
            <EquityProbe points={points} onGeometry={onGeometry} />
          </AreaChart>
        </ChartContainer>

        {/* hover: cursor line, point dot, readout */}
        <motion.div ref={cursor} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 w-px bg-faint" style={{ x: curX, opacity: hover }} />
        <motion.div aria-hidden="true" className="pointer-events-none absolute left-0 top-0" style={{ x: curX, y: curY, opacity: hover }}>
          <span className="absolute -left-[5px] -top-[5px] size-2.5 rounded-full border-2 border-ink-900" style={{ background: accent }} />
        </motion.div>
        <motion.div
          ref={tipBox}
          aria-hidden="true"
          className={cn("pointer-events-none absolute left-0 top-0 z-10 will-change-transform", TOOLTIP_CLASS)}
          style={{ x: tipX, y: tipY, opacity: tipOpacity, width: TIP_WIDTH }}
        >
          <div ref={tipTitle} className="text-mute" />
          <div className="mt-1 flex justify-between gap-4">
            <span className="text-mute">P&L</span>
            <span ref={tipPnl} className="num font-mono font-medium" />
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-mute">Kontostand</span>
            <span ref={tipBalance} className="num font-mono font-medium" />
          </div>
          <div className="hidden justify-between gap-4 [[data-replay]_&]:flex">
            <span className="text-mute">Win-Rate</span>
            <span ref={tipWin} className="num font-mono font-medium text-fg" />
          </div>
        </motion.div>

        {/* "jetzt": the current balance */}
        <motion.div aria-hidden="true" data-fx="equity-now" className="pointer-events-none absolute left-0 top-0" style={{ x: endX, y: endY, opacity: endOpacity }}>
          <span className="absolute -translate-x-1/2 -translate-y-1/2">
            <PulseDot tone={balance >= start ? "fg" : "loss"} size={7} rings={2} ping={endPing} />
          </span>
        </motion.div>

        {/* replay: veil over the future, sleeping / awake trade markers, playhead (all placed by `placeReplay`) */}
        <motion.div aria-hidden="true" data-fx="equity-replay" className="pointer-events-none absolute inset-0" style={{ opacity: replayOn }}>
          <div ref={veilClip} className="absolute inset-x-0 top-0 overflow-hidden">
            <div ref={veil} className={cn("absolute inset-y-0 left-0 w-full", REPLAY.veilClass)} />
          </div>
          {markersOn && n <= REPLAY.maxMarkers && (
            <div ref={markerBox} className="absolute inset-0">
              {points.slice(1).map((p) => (
                <span key={p.i} className="group/m absolute left-0 top-0">
                  <span
                    className={cn(
                      "absolute -left-[3px] -top-[3px] size-1.5 scale-[.55] rounded-full bg-faint opacity-40 group-data-[awake]/m:scale-100 group-data-[awake]/m:opacity-100",
                      (p.t?.pnl ?? 0) < 0 ? "group-data-[awake]/m:bg-loss" : (p.t?.pnl ?? 0) > 0 ? "group-data-[awake]/m:bg-win" : "group-data-[awake]/m:bg-mute",
                    )}
                    style={{ transition: REPLAY.markerTransition }}
                  />
                </span>
              ))}
            </div>
          )}
          <div ref={head} className="absolute left-0 top-0 w-px bg-fg/60" />
          <div ref={headDot} className="absolute left-0 top-0">
            <span className="absolute -left-1 -top-1 size-2 rounded-full border-2 border-ink-900" style={{ background: accent }} />
          </div>
        </motion.div>
      </div>

      {/* scrub row (pulse \`agent-trace\`): the track spans exactly the plotted x range, so thumb and playhead align */}
      <div className="relative mt-1.5 h-6">
        <span aria-hidden="true" className="label absolute left-0 top-1/2 -translate-y-1/2 !text-[9.5px] !text-faint">
          {REPLAY.label}
        </span>
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label={REPLAY.sliderLabel}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={n}
          aria-valuenow={n}
          // coarse pointers: the track's hit box grows to 44 px tall (10 px above and below the 24 px row)
          className="group/scrub absolute inset-y-0 left-[62px] right-2 cursor-ew-resize touch-none select-none rounded-full outline-none pointer-coarse:-inset-y-2.5"
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          onLostPointerCapture={onScrubUp}
          onKeyDown={onScrubKey}
          onBlur={() => {
            if (!rp.current.dragging) exitReplay();
          }}
        >
          <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/[0.08]">
            <span ref={fill} className="absolute inset-0 origin-left rounded-full bg-white/35" />
          </span>
          <span ref={thumb} aria-hidden="true" className="absolute left-0 top-1/2 block size-0">
            <span className="absolute -left-1.5 -top-1.5 size-3 rounded-full bg-fg shadow-[0_0_0_3px_rgb(4_4_4)] transition-transform duration-150 group-hover/scrub:scale-110 group-focus-visible/scrub:shadow-[0_0_0_3px_rgb(4_4_4),0_0_0_5px_rgb(255_255_255/0.45)] group-active/scrub:scale-125" />
          </span>
        </div>
      </div>
    </>
  );
});
