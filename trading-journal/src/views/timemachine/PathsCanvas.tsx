/**
 * „Alle Pfade“ – the canvas mode of the fan (A3): every simulated session as one faint line (up to all 10 000), drawn on a canvas
 * in time slices (in a worker on an OffscreenCanvas where the browser has one). The title keeps two numbers apart: „berechnet“ (the
 * sessions the figures rest on) and „gezeichnet“ (the lines on the canvas) – on a weak device the default is a labelled sample.
 * The axes, the stop and target lines and the median are an SVG layer on top (crisp, accessible); the numbers stay in the table of
 * the band view. A simulation, not a forecast.
 * Lazy chunk (`TimeMachineCard` imports it the first time „Alle Pfade“ is chosen).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { count, rPlain, rr, TM_INTERVAL_TEXT, type TmPaths, type TmResult } from "@/domain/timemachine";
import { ink, inkIsPaper, subscribeInk } from "@/chart/ink";
import { useReducedFx } from "@/motion/useReducedFx";
import { Segmented } from "@/primitives/Segmented";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { fanGeometry } from "./geometry";
import { createPaintEngine, isPaintAbort, type PaintEngine, type PaintEngineKind } from "./paintEngine";
import { alphaFor, sampleOf, SAMPLE_WEAK, weakDevice, type PaintStats } from "./pathPaint";
import { useWidth } from "./parts";
import { TM } from "./strings";

const H = 260;
const MODE_KEY = storageKey("tm-paths-mode");

export type DrawMode = "all" | "sample";

function initialMode(): DrawMode {
  const stored = readJson<unknown>(MODE_KEY, null);
  if (stored === "all" || stored === "sample") return stored;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return weakDevice(typeof navigator === "undefined" ? undefined : (navigator as unknown as { hardwareConcurrency?: number; deviceMemory?: number }), coarse) ? "sample" : "all";
}

const NUM = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const tickText = (v: number): string => (Math.abs(v) < 1e-9 ? "0" : `${v > 0 ? "+" : "−"}${NUM.format(Math.abs(v))}`);

export interface PathsCanvasProps {
  result: TmResult;
  /** every simulated path; `null` while they are (re)computed */
  paths: TmPaths | null;
  /** the recomputation of the paths failed */
  failed?: boolean;
  /** the paths are missing (a saved simulation): ask for them */
  onNeedPaths(): void;
  /** test / measurement hook: skip the worker and draw on the page */
  prefer?: PaintEngineKind;
}

export function PathsCanvas({ result, paths, failed, onNeedPaths, prefer }: PathsCanvasProps) {
  const reduced = useReducedFx();
  const wrap = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const w = useWidth(wrap, 560);
  const [mode, setModeState] = useState<DrawMode>(initialMode);
  const [engine, setEngine] = useState<PaintEngine | null>(null);
  const [engineFailed, setEngineFailed] = useState(false);
  const [state, setState] = useState<"waiting" | "drawing" | "done" | "error">("waiting");
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<PaintStats | null>(null);
  const [inkVersion, setInkVersion] = useState(0);
  const [weakDefault] = useState(() => initialMode() === "sample" && readJson<unknown>(MODE_KEY, null) == null);

  const setMode = (m: DrawMode) => {
    setModeState(m);
    writeJson(MODE_KEY, m);
  };

  useEffect(() => subscribeInk(() => setInkVersion((v) => v + 1)), []);
  useEffect(() => {
    if (!paths) onNeedPaths();
    // ask once per missing set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths == null]);

  // the engine: a worker with the canvas, else the page
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let made: PaintEngine | null = null;
    createPaintEngine(el, prefer ? { prefer } : {}).then(
      (e) => {
        if (cancelled) e.dispose();
        else {
          made = e;
          setEngine(e);
        }
      },
      () => !cancelled && setEngineFailed(true),
    );
    return () => {
      cancelled = true;
      made?.dispose();
      setEngine(null);
    };
  }, [prefer]);

  const computed = result.options.runs;
  const total = paths?.runs ?? 0;
  const plan = useMemo(() => sampleOf(total, mode === "all" ? total : SAMPLE_WEAK), [total, mode]);
  const geo = useMemo(() => fanGeometry(result.sim.fan, result.targetR, w, H), [result.sim.fan, result.targetR, w]);

  // draw (after a short beat for resizes); a new request replaces the one in flight
  useEffect(() => {
    if (!engine || !paths || !geo || plan.drawn === 0) return;
    const dpr = Math.min(2, typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1);
    let lastProgress = 0;
    const t = setTimeout(() => {
      setState("drawing");
      setProgress(0);
      engine
        .draw({
          geo: { w: geo.w, h: geo.h, box: geo.box, steps: result.sim.fan.steps.length - 1, lo: geo.lo, hi: geo.hi, targetR: result.targetR },
          style: { ink: ink.fg, lineWidth: 1, additive: !inkIsPaper() },
          plan,
          dpr,
          paths,
          onProgress: (done, tot) => {
            // a few updates a second are enough for a label (every slice would re-render the layer on top of the picture for nothing)
            const t = performance.now();
            if (t - lastProgress < 120 && done < tot) return;
            lastProgress = t;
            setProgress(tot ? done / tot : 1);
          },
        })
        .then(
          (s) => {
            setStats(s);
            setState("done");
            setProgress(1);
          },
          (e: unknown) => {
            if (!isPaintAbort(e)) setState("error");
          },
        );
    }, 60);
    return () => clearTimeout(t);
  }, [engine, paths, geo, plan, result.sim.fan.steps.length, result.targetR, inkVersion]);

  const n = result.sim.fan.steps.length - 1;
  const b = result.sim.fan.bands;
  const unit = TM_INTERVAL_TEXT[result.interval];
  const capped = paths != null && paths.runs < computed;
  const label = TM.paths.label(count(computed), count(plan.drawn), rr(b.p50[n]!), rr(b.p5[n]!), rr(b.p95[n]!), rPlain(result.targetR));
  const ptsAlpha = alphaFor(plan.drawn);

  return (
    <div className="grid gap-2" data-testid="tm-paths" data-state={paths ? state : "waiting"} data-computed={computed} data-drawn={plan.drawn} data-every={plan.every} data-engine={engine?.kind ?? ""} data-alpha={ptsAlpha.toFixed(3)} {...(stats ? { "data-paint-ms": Math.round(stats.totalMs), "data-max-slice-ms": Math.round(stats.maxSliceMs * 10) / 10, "data-batches": stats.batches, "data-batch": stats.batch } : {})}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="num font-mono text-[12.5px] text-fg" data-testid="tm-paths-title">
          {TM.paths.title(count(computed), count(paths ? plan.drawn : 0))}
          <span className="font-sans text-mute"> · {plan.every > 1 ? TM.paths.everyNth(plan.every) : TM.paths.allRuns}</span>
        </p>
        {paths && total > SAMPLE_WEAK && (
          <Segmented<DrawMode>
            aria-label={TM.paths.drawMode}
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { v: "all", label: TM.paths.drawAll(count(total)) },
              { v: "sample", label: TM.paths.drawSample(count(SAMPLE_WEAK)) },
            ]}
          />
        )}
      </div>
      <p className="text-[11.5px] leading-snug text-mute">{TM.paths.lead}</p>

      <div ref={wrap} className="relative min-w-0 overflow-hidden rounded-xl border border-line bg-ink-950/60" style={{ height: H }} role="img" aria-label={label}>
        <div ref={host} className="absolute inset-0" data-testid="tm-paths-host" />
        {geo && (
          <svg width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} className="pointer-events-none absolute left-0 top-0 block max-w-full" aria-hidden="true">
            {geo.yTicks.map((t) => (
              <g key={t}>
                <line x1={geo.box.l} x2={geo.w - geo.box.r} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--color-chart-grid, #1c1c1c)" strokeWidth={1} />
                <text x={geo.box.l - 6} y={geo.y(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--color-mute, #9b9b9b)" className="num font-mono">
                  {tickText(t)}
                </text>
              </g>
            ))}
            {geo.xTicks.map((t) => (
              <text key={t} x={geo.x(t)} y={geo.h - geo.box.b + 16} textAnchor={t === 0 ? "start" : t === n ? "end" : "middle"} fontSize={10} fill="var(--color-mute, #9b9b9b)" className="num font-mono">
                {t}
              </text>
            ))}
            <text x={geo.w - geo.box.r} y={geo.h - 5} textAnchor="end" fontSize={10} fill="var(--color-faint, #5f5f5f)" className="font-mono">
              {TM.fan.axisX} ({unit} je Kerze)
            </text>
            <line x1={geo.box.l} x2={geo.w - geo.box.r} y1={geo.zeroY} y2={geo.zeroY} stroke="var(--color-mute, #9b9b9b)" strokeWidth={1} strokeDasharray="1 4" strokeLinecap="round" />
            <line x1={geo.box.l} x2={geo.w - geo.box.r} y1={geo.stopY} y2={geo.stopY} stroke="var(--color-fg, #f2f2f2)" strokeOpacity={0.75} strokeWidth={1.2} strokeDasharray="6 4" data-line="stop" />
            <line x1={geo.box.l} x2={geo.w - geo.box.r} y1={geo.targetY} y2={geo.targetY} stroke="var(--color-fg, #f2f2f2)" strokeOpacity={0.9} strokeWidth={1.4} data-line="target" />
            <path d={geo.median} fill="none" stroke="var(--color-fg, #f2f2f2)" strokeWidth={1.8} strokeLinejoin="round" data-line="median" />
            <g fontSize={10.5} className="font-mono" fill="var(--color-fg, #f2f2f2)" paintOrder="stroke" stroke="var(--color-ink-950, #0a0a0a)" strokeWidth={3} strokeLinejoin="round">
              <text x={geo.w - geo.box.r - 4} y={geo.targetY - 5} textAnchor="end">
                {TM.fan.targetLine} {rr(result.targetR)}
              </text>
              <text x={geo.w - geo.box.r - 4} y={geo.stopY + 13} textAnchor="end">
                {TM.fan.stopLine} −1,00 R
              </text>
              <text x={geo.box.l + 4} y={geo.zeroY - 5} textAnchor="start" fill="var(--color-mute, #9b9b9b)">
                {TM.fan.entry}
              </text>
            </g>
          </svg>
        )}
        {(!paths || state === "waiting") && (
          <div className="absolute inset-0 grid place-items-center bg-ink-950/40 px-4 text-center text-[12.5px] text-mute" data-testid="tm-paths-wait">
            {!paths ? (failed ? TM.paths.failed : TM.paths.waiting) : null}
          </div>
        )}
        {paths && state === "drawing" && !reduced && (
          <div className="pointer-events-none absolute bottom-1.5 left-2 rounded-md bg-ink-950/70 px-2 py-0.5 font-mono text-[11px] text-mute" data-testid="tm-paths-progress">
            {TM.paths.drawing(String(Math.round(progress * 100)))}
          </div>
        )}
      </div>

      <div className="grid gap-1 text-[11.5px] leading-snug text-mute" aria-live="off">
        {state === "done" && stats && (
          <p className="num" data-testid="tm-paths-done">
            {TM.paths.done(String(Math.round(stats.totalMs)), engine?.kind === "worker" ? TM.paths.engineWorker : TM.paths.engineMain)}
          </p>
        )}
        {plan.every > 1 && (
          <p role="note" data-testid="tm-paths-sample">
            {TM.paths.sampleNote(count(plan.drawn), count(computed), plan.every)}
            {weakDefault && mode === "sample" ? ` ${TM.paths.weakNote}` : ""}
          </p>
        )}
        {capped && paths && <p role="note">{TM.paths.capNote(count(paths.runs), count(computed))}</p>}
        <p>{TM.paths.clipNote}</p>
        {(state === "error" || engineFailed) && (
          <p className="text-warn" role="alert" data-testid="tm-paths-error">
            {engineFailed ? TM.paths.noCanvas : TM.paths.failed}
          </p>
        )}
      </div>
    </div>
  );
}

export default PathsCanvas;
