/**
 * The three result charts of a lab run, drawn on a canvas (thousands of paths and points – SVG would be heavy):
 *   ScatterChart    „Auswahl gegen Endtest“: one dot per sampled variant; dots under the diagonal did worse after the selection – the picture of overfitting
 *   HistogramChart  the Sharpe of all variants, selection against end test, with the base and the candidate marked
 *   FanChart        10,000 simulated paths as percentile bands (5/25/50/75/95) plus a sample of paths for texture, log scale, drawn in
 *                   from the left with an ease-out (once, when it comes into view), crosshair with P05 / median / P95
 *
 * Rules (pulse-motion „design-linien“): never draw all paths – the bands come from all of them, the lines are a sample; colour = outcome (end value
 * at or above 1× green, below red), alpha instead of line weight; the number in the title is the honest count, the picture is the sample.
 * Colours follow the live palette (`ink`), the canvas redraws when the theme changes; reduced motion draws the finished picture at once.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { easeOutQuart, histogram, logTicks, nearestIndex, rangeOf, type MegatestResult } from "@/domain/industryTrend";
import { ink, inkIsPaper, subscribeInk, withAlpha } from "@/chart/ink";
import { cn } from "@/lib/cn";
import { canObserveInView, observeInView } from "@/motion/inView";
import { useReducedFx } from "@/motion/useReducedFx";
import { BRANCHEN } from "./strings";

const dec = (v: number, d = 2): string => v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const dpr = (): number => Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 2);
const FONT = '10.5px "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** A canvas that keeps its backing store at the CSS size × devicePixelRatio (≤ 2) and redraws on resize and on theme change. */
function useCanvas(draw: Draw) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  const frame = useRef(0);
  useEffect(() => {
    drawRef.current = draw;
  });
  const paint = useCallback(() => {
    const c = ref.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const k = dpr();
    const bw = Math.round(r.width * k);
    const bh = Math.round(r.height * k);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    drawRef.current(ctx, r.width, r.height);
  }, []);
  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      paint();
    });
  }, [paint]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    paint();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    ro?.observe(c);
    const off = subscribeInk(schedule);
    return () => {
      ro?.disconnect();
      off();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [paint, schedule]);
  useEffect(() => {
    paint();
  }, [draw, paint]);
  return { ref, paint, schedule };
}

function axisText(ctx: CanvasRenderingContext2D): void {
  ctx.font = FONT;
  ctx.fillStyle = ink.axis;
}

/* ------------------------------------------------------------------------------------------------- scatter */

export function ScatterChart({ result, className }: { result: MegatestResult; className?: string }) {
  const pts = result.streu;
  const base = result.basis.kennzahlen;
  const cand = result.kandidatin.kennzahlen;
  const draw = useMemo<Draw>(
    () => (ctx, W, H) => {
      const L = 38;
      const R = 10;
      const T = 10;
      const B = 30;
      const [lo, hi] = rangeOf([pts.map((p) => p[0]), pts.map((p) => p[1]), [base.devval.sharpe, base.endtest.sharpe, cand.devval.sharpe, cand.endtest.sharpe]], 0.06);
      const X = (v: number): number => L + ((v - lo) / (hi - lo)) * (W - L - R);
      const Y = (v: number): number => H - B - ((v - lo) / (hi - lo)) * (H - B - T);
      ctx.lineWidth = 1;
      ctx.strokeStyle = ink.grid;
      axisText(ctx);
      for (let v = Math.ceil(lo * 2) / 2; v <= hi; v += 0.5) {
        ctx.beginPath();
        ctx.moveTo(L, Y(v));
        ctx.lineTo(W - R, Y(v));
        ctx.stroke();
        ctx.fillText(dec(v, 1), 4, Y(v) + 3.5);
        if (W > 300) ctx.fillText(dec(v, 1), X(v) - 8, H - B + 14);
      }
      ctx.strokeStyle = ink.ref;
      ctx.beginPath();
      ctx.moveTo(L, H - B);
      ctx.lineTo(W - R, H - B);
      ctx.moveTo(L, T);
      ctx.lineTo(L, H - B);
      ctx.stroke();
      // the diagonal: end test = selection
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = withAlpha(ink.mute, 0.7);
      ctx.beginPath();
      ctx.moveTo(X(lo), Y(lo));
      ctx.lineTo(X(hi), Y(hi));
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [s, e] of pts) {
        ctx.fillStyle = e < s ? withAlpha(ink.loss, 0.32) : withAlpha(ink.win, 0.32);
        ctx.beginPath();
        ctx.arc(X(s), Y(e), 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      const mark = (s: number, e: number, fill: string, label: string, dy: number): void => {
        ctx.fillStyle = fill;
        ctx.strokeStyle = ink.bg;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(X(s), Y(e), 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fill();
        ctx.font = FONT;
        ctx.fillStyle = ink.fg;
        const tw = ctx.measureText(label).width;
        ctx.fillText(label, Math.min(Math.max(X(s) + 9, L + 2), W - R - tw), Y(e) + dy);
      };
      mark(base.devval.sharpe, base.endtest.sharpe, ink.fg, "Basis", 4);
      mark(cand.devval.sharpe, cand.endtest.sharpe, ink.signal, "Kandidatin", -8);
      ctx.fillStyle = ink.axis;
      ctx.font = FONT;
      ctx.fillText(BRANCHEN.ergebnis.scatter.x, L + 4, H - 6);
      ctx.save();
      ctx.translate(11, T + 6);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "right";
      ctx.fillText(BRANCHEN.ergebnis.scatter.y, 0, 0);
      ctx.restore();
    },
    [pts, base, cand],
  );
  const { ref } = useCanvas(draw);
  const below = useMemo(() => (pts.length ? pts.filter(([s, e]) => e < s).length / pts.length : 0), [pts]);
  const pct = `${Math.round(below * 100)} %`;
  return (
    <figure className={cn("grid gap-2", className)} data-testid="branchen-scatter">
      <canvas ref={ref} className="block h-[300px] w-full" role="img" aria-label={BRANCHEN.ergebnis.scatter.aria(pts.length, pct)} />
      <figcaption className="text-[12px] leading-relaxed text-mute" data-testid="branchen-scatter-note">
        {BRANCHEN.ergebnis.scatter.note(pts.length, result.n_varianten.toLocaleString("de-DE"), pct)}
      </figcaption>
    </figure>
  );
}

/* ----------------------------------------------------------------------------------------------- histogram */

export function HistogramChart({ result, className }: { result: MegatestResult; className?: string }) {
  const BINS = 24;
  const [lo, hi] = useMemo(() => rangeOf([result.hist_devval, result.hist_endtest], 0.02), [result.hist_devval, result.hist_endtest]);
  const a = useMemo(() => histogram(result.hist_devval, BINS, lo, hi), [result.hist_devval, lo, hi]);
  const b = useMemo(() => histogram(result.hist_endtest, BINS, lo, hi), [result.hist_endtest, lo, hi]);
  const base = result.basis.kennzahlen.endtest.sharpe;
  const cand = result.kandidatin.kennzahlen.endtest.sharpe;
  const draw = useMemo<Draw>(
    () => (ctx, W, H) => {
      const L = 8;
      const R = 8;
      const T = 14;
      const B = 26;
      const max = Math.max(1, ...a, ...b);
      const X = (v: number): number => L + ((v - lo) / (hi - lo)) * (W - L - R);
      const bw = (W - L - R) / BINS;
      const bar = (i: number, v: number, color: string, half: 0 | 1): void => {
        const hgt = (v / max) * (H - T - B);
        ctx.fillStyle = color;
        ctx.fillRect(L + i * bw + half * (bw / 2) + 0.5, H - B - hgt, bw / 2 - 1, hgt);
      };
      for (let i = 0; i < BINS; i++) {
        bar(i, a[i]!, withAlpha(ink.fg, 0.55), 0);
        bar(i, b[i]!, withAlpha(ink.signal, 0.85), 1);
      }
      ctx.strokeStyle = ink.ref;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L, H - B + 0.5);
      ctx.lineTo(W - R, H - B + 0.5);
      ctx.stroke();
      axisText(ctx);
      for (let v = Math.ceil(lo * 2) / 2; v <= hi; v += 0.5) ctx.fillText(dec(v, 1), X(v) - 8, H - 9);
      const line = (v: number, label: string, row: number): void => {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = ink.fg;
        ctx.beginPath();
        ctx.moveTo(X(v), T - 4);
        ctx.lineTo(X(v), H - B);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = FONT;
        ctx.fillStyle = ink.fg;
        const tw = ctx.measureText(label).width;
        ctx.fillText(label, Math.min(Math.max(X(v) + 4, L), W - R - tw), T + 4 + row * 13);
      };
      line(base, `Basis im Endtest ${dec(base)}`, 0);
      line(cand, `Kandidatin im Endtest ${dec(cand)}`, 1);
    },
    [a, b, lo, hi, base, cand],
  );
  const { ref } = useCanvas(draw);
  return (
    <figure className={cn("grid gap-2", className)} data-testid="branchen-hist">
      <canvas ref={ref} className="block h-[220px] w-full" role="img" aria-label={BRANCHEN.ergebnis.hist.aria} />
      <figcaption className="grid gap-1.5 text-[12px] leading-relaxed text-mute">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ background: withAlpha(ink.fg, 0.55) }} />
            {BRANCHEN.ergebnis.hist.sel}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ background: withAlpha(ink.signal, 0.85) }} />
            {BRANCHEN.ergebnis.hist.end}
          </span>
        </span>
        <span>{BRANCHEN.ergebnis.hist.note}</span>
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------------------------------------------ fan */

const FAN = { L: 46, T: 14, B: 28 } as const;
const fanR = (w: number): number => (w < 520 ? 14 : 66);

export function FanChart({ result, className }: { result: MegatestResult; className?: string }) {
  const mc = result.monte_carlo;
  const n = mc.baender["50"].length;
  const years = mc.horizont_tage / 252;
  const reduced = useReducedFx();
  const prog = useRef(reduced ? 1 : 0);
  const hov = useRef(-1);
  const [hovText, setHovText] = useState("");
  const [started, setStarted] = useState(() => reduced || !canObserveInView());
  const wrap = useRef<HTMLDivElement>(null);

  const geometry = useMemo(() => {
    const lo = Math.max(0.2, Math.min(...mc.baender["5"]) * 0.8);
    const hi = Math.max(...mc.baender["95"]) * 1.15;
    return { lo, hi, ll: Math.log(lo), lh: Math.log(hi) };
  }, [mc]);

  const draw = useMemo<Draw>(
    () => (ctx, W, H) => {
      const { L, T, B } = FAN;
      const R = fanR(W);
      const pw = W - L - R;
      const ph = H - T - B;
      const { lo, hi, ll, lh } = geometry;
      const X = (i: number): number => L + (i / (n - 1)) * pw;
      const Y = (v: number): number => T + ph - ((Math.log(Math.max(v, lo)) - ll) / (lh - ll)) * ph;
      const paper = inkIsPaper();
      ctx.lineWidth = 1;
      ctx.strokeStyle = ink.grid;
      axisText(ctx);
      for (const v of logTicks(lo, hi)) {
        ctx.beginPath();
        ctx.moveTo(L, Y(v));
        ctx.lineTo(L + pw, Y(v));
        ctx.stroke();
        ctx.fillText(`${v}×`, 6, Y(v) + 3.5);
      }
      for (let yr = 0; yr <= Math.floor(years); yr++) ctx.fillText(BRANCHEN.ergebnis.fan.tipYears(String(yr)), L + (yr / years) * pw - 6, H - 8);
      // start axis: a vertical line that fades out at both ends – the „fan“ opens from it
      const g = ctx.createLinearGradient(0, T, 0, T + ph);
      g.addColorStop(0, withAlpha(ink.fg, 0));
      g.addColorStop(0.5, withAlpha(ink.fg, 0.7));
      g.addColorStop(1, withAlpha(ink.fg, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(L, T);
      ctx.lineTo(L, T + ph);
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.rect(L - 4, 0, pw * prog.current + 8, H);
      ctx.clip();
      ctx.lineWidth = 1.1;
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = paper ? "source-over" : "lighter";
      const paths = (list: number[][], color: string): void => {
        ctx.strokeStyle = color;
        for (const p of list) {
          ctx.beginPath();
          p.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
          ctx.stroke();
        }
      };
      paths(mc.zeige_rot, withAlpha(ink.loss, 0.16));
      paths(mc.zeige_gruen, withAlpha(ink.win, 0.16));
      ctx.globalCompositeOperation = "source-over";
      const band = (upper: number[], lower: number[], color: string): void => {
        ctx.beginPath();
        upper.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
        for (let i = lower.length - 1; i >= 0; i--) ctx.lineTo(X(i), Y(lower[i]!));
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      };
      band(mc.baender["95"], mc.baender["5"], withAlpha(ink.fg, 0.07));
      band(mc.baender["75"], mc.baender["25"], withAlpha(ink.fg, 0.13));
      ctx.shadowColor = paper ? "transparent" : withAlpha(ink.fg, 0.7);
      ctx.shadowBlur = paper ? 0 : 12;
      ctx.strokeStyle = ink.fg;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      mc.baender["50"].forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
      // the stake: dashed 1×
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = withAlpha(ink.mute, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L, Y(1));
      ctx.lineTo(L + pw, Y(1));
      ctx.stroke();
      ctx.setLineDash([]);
      if (prog.current >= 1) {
        const ends: [string, string, number][] = [
          ["95", ink.win, mc.baender["95"][n - 1]!],
          ["50", ink.fg, mc.baender["50"][n - 1]!],
          ["5", ink.loss, mc.baender["5"][n - 1]!],
        ];
        for (const [, color, v] of ends) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(X(n - 1), Y(v), 4, 0, Math.PI * 2);
          ctx.fill();
          if (R > 40) {
            ctx.font = FONT;
            ctx.fillStyle = ink.fg;
            ctx.fillText(`${dec(v)}×`, X(n - 1) + 8, Y(v) + 3.5);
          }
        }
        const h = hov.current;
        if (h >= 0 && h < n) {
          const hx = X(h);
          ctx.strokeStyle = withAlpha(ink.mute, 0.7);
          ctx.beginPath();
          ctx.moveTo(hx, T);
          ctx.lineTo(hx, T + ph);
          ctx.stroke();
          const txt = `${BRANCHEN.ergebnis.fan.tipYears(dec((h / (n - 1)) * years, 1))}: P05 ${dec(mc.baender["5"][h]!)}× · Median ${dec(mc.baender["50"][h]!)}× · P95 ${dec(mc.baender["95"][h]!)}×`;
          ctx.font = FONT;
          const tw = ctx.measureText(txt).width + 16;
          const bx = Math.min(Math.max(hx - tw / 2, L), L + pw - tw);
          ctx.fillStyle = withAlpha(ink.bg, 0.92);
          ctx.fillRect(bx, T + 2, tw, 22);
          ctx.strokeStyle = ink.ref;
          ctx.strokeRect(bx + 0.5, T + 2.5, tw - 1, 21);
          ctx.fillStyle = ink.fg;
          ctx.fillText(txt, bx + 8, T + 17);
        }
      }
    },
    [mc, n, years, geometry],
  );
  const { ref, paint, schedule } = useCanvas(draw);

  // draw-in: the clip grows with an ease-out over 1.5 s, once, when the chart comes into view
  useEffect(() => {
    const el = wrap.current;
    if (started || !el) return;
    return observeInView(el, (inView) => {
      if (inView) setStarted(true);
    });
  }, [started]);
  useEffect(() => {
    if (!started) return;
    if (reduced) {
      prog.current = 1;
      paint();
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number): void => {
      prog.current = easeOutQuart((t - t0 - 250) / 1500);
      paint();
      if (prog.current < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [started, reduced, paint]);

  const textAt = useCallback(
    (i: number): string => (i < 0 ? "" : `${BRANCHEN.ergebnis.fan.tipYears(dec((i / (n - 1)) * years, 1))}: P05 ${dec(mc.baender["5"][i]!)}×, Median ${dec(mc.baender["50"][i]!)}×, P95 ${dec(mc.baender["95"][i]!)}×`),
    [mc, n, years],
  );
  const setHover = (i: number): void => {
    if (hov.current === i) return;
    hov.current = i;
    setHovText(textAt(i));
    schedule();
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>): void => {
    if (prog.current < 1) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - r.left - FAN.L) / (r.width - FAN.L - fanR(r.width));
    setHover(frac < 0 || frac > 1 ? -1 : nearestIndex(frac, n));
  };
  const onKey = (e: KeyboardEvent<HTMLCanvasElement>): void => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = hov.current < 0 ? (e.key === "ArrowRight" ? 0 : n - 1) : Math.min(n - 1, Math.max(0, hov.current + (e.key === "ArrowRight" ? 1 : -1)));
      setHover(next);
    } else if (e.key === "Escape") setHover(-1);
  };

  const fmt = (v: number): string => `${dec(v)}×`;
  return (
    <figure className={cn("grid gap-3", className)} data-testid="branchen-fan" ref={wrap}>
      <figcaption className="grid gap-0.5">
        <span className="text-[13px] font-medium text-fg" data-testid="branchen-fan-title">
          {BRANCHEN.ergebnis.fan.title(mc.pfade.toLocaleString("de-DE"))}
        </span>
        <span className="text-[12px] text-mute">{BRANCHEN.ergebnis.fan.sub}</span>
      </figcaption>
      <canvas
        ref={ref}
        tabIndex={0}
        className="block h-[300px] w-full touch-pan-y outline-none focus-visible:ring-1 focus-visible:ring-white/40 sm:h-[360px]"
        role="img"
        aria-label={BRANCHEN.ergebnis.fan.aria(mc.pfade.toLocaleString("de-DE"), fmt(mc.median), fmt(mc.p05), fmt(mc.p95))}
        aria-describedby="branchen-fan-hint"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(-1)}
        onKeyDown={onKey}
        onBlur={() => setHover(-1)}
        data-testid="branchen-fan-canvas"
      />
      <p id="branchen-fan-hint" className="sr-only">
        Mit den Pfeiltasten links und rechts wandert das Fadenkreuz, Escape blendet es aus.
      </p>
      <p className="sr-only" aria-live="polite" data-testid="branchen-fan-live">
        {hovText}
      </p>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-mute" aria-label="Legende">
        <li className="inline-flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: ink.win }} />
          {BRANCHEN.ergebnis.fan.legend.gain} ({Math.round(mc.anteil_gruen * 100)} %)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: ink.loss }} />
          {BRANCHEN.ergebnis.fan.legend.loss} ({Math.round(mc.p_verlust * 100)} %)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: ink.fg }} />
          {BRANCHEN.ergebnis.fan.legend.median}
        </li>
        <li>{BRANCHEN.ergebnis.fan.legend.bands}</li>
      </ul>
      <dl className="num grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="branchen-fan-stats">
        {(
          [
            [BRANCHEN.ergebnis.fan.stats.median, fmt(mc.median)],
            [BRANCHEN.ergebnis.fan.stats.p05, fmt(mc.p05)],
            [BRANCHEN.ergebnis.fan.stats.p95, fmt(mc.p95)],
            [BRANCHEN.ergebnis.fan.stats.loss, `${dec(mc.p_verlust * 100, 1)} %`],
            [BRANCHEN.ergebnis.fan.stats.dd, `${dec(mc.dd_median * 100, 0)} %`],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="grid min-w-0 content-start gap-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{k}</dt>
            <dd className="font-mono text-[15px] font-medium leading-tight text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[12px] leading-relaxed text-mute">
        In 5 % der Fälle liegt der größte Rückgang über {dec(mc.dd_p95 * 100, 0)} %. {BRANCHEN.ergebnis.fan.caveat}
      </p>
    </figure>
  );
}
