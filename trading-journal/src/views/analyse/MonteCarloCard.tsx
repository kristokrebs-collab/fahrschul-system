/**
 * Monte Carlo card (P03): 2000 seeded paths of the next 50 / 100 / 250 trades, drawn as a fan.
 *
 * Choreography (once per result, on first view):
 * 1. 120 pale paths are drawn into a canvas one after another (`tween.draw` spread over the paths, each path left to
 *    right over `tween.reveal`): an incremental rAF loop (only the new segments per frame, no clear, no layout read,
 *    asleep when done);
 * 2. then a clip-path wipe (`tween.draw`) uncovers the p5–p95 band, the p25–p75 core and the median, and ONE red
 *    signal line crosses the card (`SpotlightSweep`);
 * 3. `ScrubTimeline` scrubs through the runs: the scrubbed run is the red path, its end and max drawdown are written
 *    straight into the DOM (a MotionValue subscription – zero React renders per scrub).
 * While the worker simulates, `DotMatrixText` waves "SIM" (only shown when it takes longer than a beat).
 * Reduced motion: the finished picture at once.
 */
import { themePaint } from "@/lib/themePaint";
import { motion, useMotionValue } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ANA_EMPTY,
  breakdownUnit,
  CARD_TITLES,
  ddProbability,
  ddQuantile,
  explainMonteCarlo,
  finite,
  type MonteCarloResult,
} from "@/domain/analytics";
import type { AccountView } from "@/domain/account";
import { cn } from "@/lib/cn";
import { pct0 } from "@/lib/format";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { SpotlightSweep } from "@/motion/fx/SpotlightSweep";
import { createFrameLoop } from "@/motion/pulse/engine";
import { ScrubTimeline, type ScrubMarker } from "@/motion/pulse/ScrubTimeline";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { EmptyState } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { Segmented } from "@/primitives/Segmented";
import { useAnalyseUi, type McHorizon, type McMethod } from "./analyseStore";
import { sampleKey, useMonteCarlo } from "./hooks";
import { AnaCard, SEG_TOUCH, Stat, softTone, unitText } from "./ui";

/** Paths drawn into the fan. */
export const FAN_PATHS = 120;
export const MC_MIN_TRADES = 10;
const FAN_H = 220;
const PAD = { l: 4, r: 4, t: 10, b: 10 };

const HORIZONS = [50, 100, 250] as const;
const METHODS = [
  { v: "bootstrap" as const, label: "Bootstrap" },
  { v: "reshuffle" as const, label: "Mischen" },
];

export interface FanGeometry {
  w: number;
  h: number;
  /** canvas points per kept path */
  pts: { x: number; y: number }[][];
  /** svg path data per kept path (the scrubbed run) */
  pathD: string[];
  band: string;
  core: string;
  median: string;
  /** y of the start value */
  startY: number;
  lo: number;
  hi: number;
}

/** Pure: the fan's geometry in CSS pixels (shared by the canvas and the SVG overlay). */
export function fanGeometry(res: MonteCarloResult, w: number, h: number): FanGeometry | null {
  if (!res.bands.length || w <= 0) return null;
  const n = res.horizon;
  let lo = Infinity;
  let hi = -Infinity;
  for (const vals of [...res.bands.map((b) => b.values), ...res.paths]) {
    for (const v of vals) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (!(hi - lo > 1e-9)) {
    hi += 1;
    lo -= 1;
  }
  const x = (i: number) => PAD.l + (n ? i / n : 0) * (w - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (h - PAD.t - PAD.b);
  const line = (vals: readonly number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const area = (top: readonly number[], bottom: readonly number[]) => `${line(top)}${[...bottom].reverse().map((v, j) => `L${x(bottom.length - 1 - j).toFixed(1)} ${y(v).toFixed(1)}`).join("")}Z`;
  const band = (p: number) => res.bands.find((b) => b.p === p)!.values;
  const pts = res.paths.map((p) => p.map((v, i) => ({ x: x(i), y: y(v) })));
  return {
    w,
    h,
    pts,
    pathD: res.paths.map((p) => line(p)),
    band: area(band(95), band(5)),
    core: area(band(75), band(25)),
    median: line(band(50)),
    startY: y(res.bands[0]!.values[0]!),
    lo,
    hi,
  };
}

/** Incremental fan draw: path k starts at k · stagger and runs over `pathS`; returns false when done. */
function drawStep(ctx: CanvasRenderingContext2D, pts: FanGeometry["pts"], drawn: number[], t: number, staggerS: number, pathS: number): boolean {
  let busy = false;
  ctx.beginPath();
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k]!;
    const prog = Math.min(1, Math.max(0, (t - k * staggerS) / pathS));
    const upto = Math.round(prog * (p.length - 1));
    if (prog < 1) busy = true;
    const from = drawn[k]!;
    if (upto <= from) continue;
    ctx.moveTo(p[from]!.x, p[from]!.y);
    for (let i = from + 1; i <= upto; i++) ctx.lineTo(p[i]!.x, p[i]!.y);
    drawn[k] = upto;
  }
  ctx.stroke();
  return busy;
}

function Fan({ res, unit, cur, start }: { res: MonteCarloResult; unit: "R" | "money"; cur: string; start: number }) {
  const reduced = useReducedFx();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hl = useRef<SVGPathElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState(0);
  const seen = useSeenOnce(wrap);
  const geo = useMemo(() => fanGeometry(res, w, FAN_H), [res, w]);
  // the band shows once the fan of THIS result has been drawn (set from the loop's end – never during render)
  const [drawnFor, setDrawnFor] = useState<MonteCarloResult | null>(null);
  const animated = useRef<MonteCarloResult | null>(null);
  const bandOn = reduced || drawnFor === res;

  // width: once and on resize (one read each)
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

  // canvas: staggered draw once per result (first view), instant redraw on resize / reduced motion
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || !geo) return;
    const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    c.width = Math.round(geo.w * dpr);
    c.height = Math.round(geo.h * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, geo.w, geo.h);
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(242,242,242,0.075)";
    const drawn = geo.pts.map(() => 0);
    if (reduced || animated.current === res || !seen) {
      if (!(reduced || animated.current === res)) return;
      drawStep(ctx, geo.pts, drawn, Infinity, 0, 1);
      // an animation cut short (resize) still ends with the band
      const id = requestAnimationFrame(() => setDrawnFor(res));
      return () => cancelAnimationFrame(id);
    }
    animated.current = res;
    const staggerS = tween.draw.duration / Math.max(1, geo.pts.length);
    const pathS = tween.reveal.duration;
    let t = 0;
    const loop = createFrameLoop((dt) => {
      t += dt;
      const busy = drawStep(ctx, geo.pts, drawn, t, staggerS, pathS);
      if (!busy) setDrawnFor(res);
      return busy;
    });
    loop.wake();
    return () => loop.stop();
  }, [geo, res, reduced, seen]);

  // the scrubbed run: red path + readout, straight to the DOM
  const runs = res.paths.length;
  const finals = useMemo(() => res.paths.map((p) => p[p.length - 1]!), [res]);
  const order = useMemo(() => finals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]), [finals]);
  const medianRun = order[Math.floor(order.length / 2)]?.[1] ?? 0;
  const time = useMotionValue(medianRun);
  // a new result starts on its median run
  useEffect(() => time.set(medianRun), [time, medianRun]);
  const pathDD = useMemo(
    () =>
      res.paths.map((p) => {
        let peak = p[0]!;
        let dd = 0;
        for (const v of p) {
          if (v > peak) peak = v;
          dd = Math.max(dd, peak - v);
        }
        return dd;
      }),
    [res],
  );
  useLayoutEffect(() => {
    const apply = (raw: number) => {
      const k = Math.max(0, Math.min(runs - 1, Math.round(raw)));
      if (hl.current && geo) hl.current.setAttribute("d", geo.pathD[k] ?? "");
      if (readout.current) readout.current.textContent = `Lauf ${k + 1}: Ende ${unitText((finals[k] ?? start) - start, unit, cur)} · max. Drawdown ${unitText(-(pathDD[k] ?? 0), unit, cur)}`;
    };
    apply(time.get());
    return time.on("change", apply);
  }, [time, geo, runs, finals, pathDD, unit, cur, start]);

  const markers: ScrubMarker[] = order.length
    ? [
        { at: order[0]![1], label: "Schlechtester Lauf", tone: "loss" },
        { at: medianRun, label: "Median-Lauf", tone: "fg" },
        { at: order[order.length - 1]![1], label: "Bester Lauf", tone: "win" },
      ]
    : [];

  return (
    <div className="grid gap-3">
      <div ref={wrap} className="relative overflow-hidden rounded-xl border border-line bg-ink-950/60" style={{ height: FAN_H }} data-testid="mc-fan" data-drawn={bandOn ? "true" : "false"}>
        <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 h-full w-full" />
        {geo && (
          <motion.svg
            aria-hidden="true"
            viewBox={`0 0 ${geo.w} ${geo.h}`}
            className="absolute inset-0 h-full w-full"
            initial={reduced ? false : { clipPath: "inset(0 100% 0 0)" }}
            animate={{ clipPath: bandOn ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)" }}
            transition={tween.draw}
          >
            <line x1={0} x2={geo.w} y1={geo.startY} y2={geo.startY} stroke={themePaint("#5f5f5f")} strokeDasharray="3 4" strokeWidth={1} />
            <path d={geo.band} fill="rgb(242 242 242 / 0.05)" stroke="rgb(242 242 242 / 0.22)" strokeDasharray="2 3" strokeWidth={1} />
            <path d={geo.core} fill="rgb(242 242 242 / 0.08)" />
            <path d={geo.median} fill="none" stroke={themePaint("#f2f2f2")} strokeWidth={1.6} strokeLinejoin="round" />
            <path ref={hl} fill="none" stroke={themePaint("#e5202e")} strokeWidth={1.6} strokeLinejoin="round" opacity={0.95} />
          </motion.svg>
        )}
        {bandOn && !reduced && <SpotlightSweep play={1} playOnView={false} />}
        <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-ink-950/70 px-1.5 py-0.5 font-mono text-[10px] text-faint">p5–p95 · Median</span>
      </div>
      <span ref={readout} className="num min-h-4 font-mono text-[11.5px] leading-snug text-mute" data-testid="mc-readout" />
      {runs > 1 && (
        <ScrubTimeline
          label="Simulierte Läufe durchgehen"
          total={runs - 1}
          time={time}
          step={1}
          bigStep={10}
          markers={markers}
          formatTime={(t) => `Lauf ${Math.round(t) + 1}`}
          playSeconds={tween.draw.duration * 12}
          className="!p-2.5 sm:!p-3"
        />
      )}
    </div>
  );
}

/** The probability rows "P(Drawdown ≥ x)" with bars growing from the left. */
function DdRisk({ res, thresholds }: { res: MonteCarloResult; thresholds: { x: number; label: string }[] }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLUListElement>(null);
  const seen = useSeenOnce(ref);
  return (
    <ul ref={ref} className="grid gap-1.5" aria-label="Wahrscheinlichkeit eines Drawdowns">
      {thresholds.map((t, i) => {
        const p = ddProbability(res, t.x);
        return (
          <li key={t.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.2rem] items-center gap-2 text-[12px]">
            <span className="truncate text-mute">Drawdown ≥ {t.label}</span>
            <span className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <motion.span
                className={cn("absolute inset-y-0 left-0 w-full origin-left rounded-full", p >= 0.5 ? "bg-loss/70" : p >= 0.2 ? "bg-warn/70" : "bg-white/40")}
                initial={reduced ? false : { scaleX: 0 }}
                animate={{ scaleX: seen || reduced ? p : 0 }}
                transition={{ ...spring.enter, delay: reduced ? 0 : i * stagger.reveal }}
              />
            </span>
            <span className={cn("num text-right font-mono", p >= 0.5 ? "text-loss" : "text-fg")}>{pct0(p)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function MonteCarloCard({ view, cur }: { view: AccountView; cur: string }) {
  const horizon = useAnalyseUi((s) => s.mcHorizon);
  const method = useAnalyseUi((s) => s.mcMethod);
  const set = useAnalyseUi((s) => s.set);
  const closed = view.closed;
  const unit = useMemo(() => breakdownUnit(closed), [closed]);
  const sample = useMemo(() => {
    const xs = unit === "R" ? finite(closed.map((t) => t.r)) : closed.map((t) => t.pnl ?? 0);
    return xs.length >= MC_MIN_TRADES ? xs : null;
  }, [closed, unit]);
  const opts = { runs: 2000, horizon, method, seed: 1, keepPaths: FAN_PATHS, start: 0 };
  const key = `${sampleKey(sample)}:${unit}:${horizon}:${method}`;
  const mc = useMonteCarlo(sample, opts, key);
  const res = mc.result;
  const thresholds =
    unit === "R"
      ? [5, 10, 20].map((x) => ({ x, label: `${x} R` }))
      : [0.1, 0.2, 0.3].map((f) => ({ x: f * view.start, label: `${Math.round(f * 100)} % Kapital` }));
  const busy = mc.status === "running";
  return (
    <AnaCard
      title={CARD_TITLES.monteCarlo}
      explain={() => explainMonteCarlo(res, unit, cur)}
      data-testid="ana-mc"
      note={sample ? `2000 Läufe · ${unit === "R" ? "in R" : `in ${cur}`} · gezogen aus ${sample.length} Trades` : undefined}
    >
      {!sample ? (
        <EmptyState title={ANA_EMPTY.monteCarlo.title} text={ANA_EMPTY.monteCarlo.text} />
      ) : (
        <div className="relative grid gap-4" data-state={mc.status}>
          <div className="flex flex-wrap items-center gap-2" data-testid="mc-controls">
            <Segmented<`${McHorizon}`> size="sm" aria-label="Horizont" options={HORIZONS.map((h) => ({ v: `${h}` as const, label: `${h} Trades` }))} value={`${horizon}`} onChange={(v) => set({ mcHorizon: Number(v) as McHorizon })} className={SEG_TOUCH} />
            <Segmented<McMethod> size="sm" aria-label="Methode" options={METHODS} value={method} onChange={(v) => set({ mcMethod: v })} className={SEG_TOUCH} />
          </div>
          {res && res.final ? (
            <>
              <Fan res={res} unit={unit} cur={cur} start={0} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Median" value={unitText(res.final.p50, unit, cur)} tone={softTone(res.final.p50)} sub={`nach ${res.horizon} Trades`} />
                <Stat label="Schlechte 5 %" value={unitText(res.final.p5, unit, cur)} tone={softTone(res.final.p5)} sub="5. Perzentil" />
                <Stat label="Gute 5 %" value={unitText(res.final.p95, unit, cur)} tone={softTone(res.final.p95)} sub="95. Perzentil" />
                <Stat label="Max. DD (95 %)" value={unitText(-(ddQuantile(res, 0.95) ?? 0), unit, cur)} tone="text-loss" sub={res.longestLoss ? `bis ${res.longestLoss.p95} Verluste in Folge` : undefined} />
              </div>
              <DdRisk res={res} thresholds={thresholds} />
              {sample.length < 30 && <p className="text-[12px] text-warn">Aus {sample.length} Trades gezogen – ein grober Ausblick, belastbar ab etwa 30.</p>}
            </>
          ) : (
            <div className="grid place-items-center rounded-xl border border-line bg-ink-950/60" style={{ height: FAN_H }} />
          )}
          {(busy || (!res && mc.status !== "error")) && (
            <motion.div
              className="pointer-events-none absolute left-1/2 top-[160px] flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full border border-line-2 bg-ink-900/90 px-4 py-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...tween.fade, delay: res ? stagger.lead : 0 }}
              data-testid="mc-busy"
            >
              <DotMatrixText text="SIM" preset="wave" cycles={Infinity} size={3} gap={1.5} tone="mute" presetTone="signal" decorative />
              <span className="text-[12px] text-mute">Simuliere …</span>
            </motion.div>
          )}
          {mc.status === "error" && <p className="text-[12px] text-loss">Die Simulation ist fehlgeschlagen. Lade die Seite neu.</p>}
        </div>
      )}
    </AnaCard>
  );
}
