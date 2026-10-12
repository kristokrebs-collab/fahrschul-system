/**
 * Lauf (P07): the stage of a backtest.
 * - Running: a `RadarSweep` scan band over the chart surface, a dot-matrix snake loader with the percentage
 *   (`DotMatrixText`) and the phase rolling in (`TextRoll`) – ≤ ~8 React updates per second, the band is CSS.
 * - Done: the equity draws itself with a glowing head (`EquityDraw`, driven by ONE MotionValue); the trades appear on
 *   the curve as the head passes them – a capped ripple sequence (`spawnMarkerRipple`, at most `RIPPLE_CAP` sonars,
 *   the rest just pop), imperatively, zero renders per frame. KPIs cascade in (`NumberCascade`), the race against buy &
 *   hold grows (`scaleX`).
 * Reduced motion: everything at its end state at once.
 */
import { animate, AnimatePresence, motion, useMotionValue } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LabResult } from "@/domain/backtest/index";
import { spawnMarkerRipple } from "@/chart/overlays";
import { cn } from "@/lib/cn";
import { DotMatrix } from "@/motion/DotMatrix";
import { DotMatrixText, EquityDraw, EQUITY_DRAW, equityPoints, FX_HEX, NumberCascade, playWaapi, RadarSweep, useFxPlay } from "@/motion/fx";
import { TextRoll } from "@/motion/TextRoll";
import { ease, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { useLabor } from "./laborStore";
import { LABOR } from "./strings";
import { Kpi, moneyText, numText, pctText, pfText, rText } from "./ui";

/** Sonars of the trade sequence (later trades only pop). */
export const RIPPLE_CAP = 24;
const STAGE_H = 210;

export function RunCard({ className }: { className?: string }) {
  const status = useLabor((s) => s.status);
  const result = useLabor((s) => s.result);
  const runSeq = useLabor((s) => s.runSeq);
  const error = useLabor((s) => s.error);
  const busy = status === "loading" || status === "running";
  return (
    <Card
      title={LABOR.runTitle}
      action={result && !busy ? <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">{result.symbol} · {result.interval === "1d" ? "1D" : result.interval} · {result.stats.n} Trades</span> : undefined}
      className={className}
      data-testid="labor-run"
      data-status={status}
    >
      <div className="relative overflow-hidden rounded-2xl border border-line bg-ink-950/50" style={{ height: STAGE_H + 24 }}>
        <AnimatePresence mode="wait" initial={false}>
          {busy ? (
            <Busy key="busy" />
          ) : result ? (
            <Stage key={`r-${runSeq}`} result={result} runSeq={runSeq} />
          ) : (
            <Idle key="idle" text={status === "error" || status === "cancelled" ? (error ?? LABOR.errors.failed) : LABOR.idleHint} tone={status === "error" ? "error" : "idle"} />
          )}
        </AnimatePresence>
      </div>
      {result && !busy && <Kpis result={result} runSeq={runSeq} />}
      {result && !busy && <Race result={result} runSeq={runSeq} />}
      {status === "error" && result && <p role="alert" className="mt-3 text-[12.5px] text-[#ff8a90]">{error}</p>}
    </Card>
  );
}

function Idle({ text, tone }: { text: string; tone: "idle" | "error" }) {
  return (
    <motion.div className="absolute inset-0 grid place-items-center p-6 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={tween.fade}>
      <div className="grid justify-items-center gap-3">
        <DotMatrix text={tone === "error" ? "!" : "--"} tone={tone === "error" ? "signal" : "mute"} size={4} gap={2} glow={false} />
        <p role={tone === "error" ? "alert" : undefined} className={cn("max-w-[42ch] text-[13px]", tone === "error" ? "text-[#ff8a90]" : "text-mute")}>
          {text}
        </p>
      </div>
    </motion.div>
  );
}

function Busy() {
  const progress = useLabor((s) => s.progress);
  const phase = useLabor((s) => s.phase);
  const load = useLabor((s) => s.load);
  const pct = Math.max(0, Math.min(99, Math.floor(progress * 100)));
  const label = phase === "load" ? (load.total ? LABOR.loading(load.done, load.total) : LABOR.phases.load) : LABOR.phases[phase];
  return (
    <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={tween.fade} data-testid="labor-busy">
      <RadarSweep active variant="band" tone="signal" className="absolute inset-0" />
      <div className="absolute inset-0 grid place-items-center">
        {/* a progressbar, never a live region (the toast island is the only one) */}
        <div className="grid justify-items-center gap-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} %, ${label}`} aria-label="Backtest läuft">
          <DotMatrixText text={`${pct}%`} width={4} preset="snake" presetPosition="before" cycles={Infinity} presetTone="signal" size={5} gap={2} decorative />
          <span className="font-mono text-[12px] text-mute" aria-hidden="true">
            <TextRoll text={label} mode="morph" />
          </span>
          <span aria-hidden="true" className="h-[3px] w-48 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.span className="block h-full origin-left rounded-full bg-fg" animate={{ scaleX: progress }} transition={tween.bar} />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function Stage({ result, runSeq }: { result: LabResult; runSeq: number }) {
  const reduced = useReducedFx();
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const progress = useMotionValue(reduced ? 1 : 0);
  const [width, setWidth] = useState(0);
  const values = useMemo(() => result.equity.map((p) => p.equity), [result.equity]);
  const capital = result.equity[0]?.equity ?? 0;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setWidth(Math.round(el.clientWidth));
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // trade dots on the curve: x by exit time, y on the drawn line
  const dots = useMemo(() => {
    if (!width || values.length < 2) return [];
    const pts = equityPoints(values, width, STAGE_H, EQUITY_DRAW.pad, capital);
    const t0 = result.equity[0]!.t;
    const t1 = result.equity[result.equity.length - 1]!.t;
    const span = Math.max(1, t1 - t0);
    return result.trades.map((t) => {
      const f = Math.min(1, Math.max(0, (t.exitTime - t0) / span));
      const k = Math.min(pts.length - 1, Math.round(f * (pts.length - 1)));
      return { id: t.id, f, x: pts[k]!.x, y: pts[k]!.y, win: t.pnl > 0 };
    });
  }, [width, values, capital, result.equity, result.trades]);

  // the draw: ONE MotionValue drives the line, the head and the trade dots
  useFxPlay(rootRef, runSeq, true, !reduced, () => {
    progress.set(0);
    animate(progress, 1, { duration: tween.draw.duration * 1.6, ease: ease.out });
  });
  useLayoutEffect(() => {
    const host = dotsRef.current;
    const layer = layerRef.current;
    if (!host) return;
    const els = Array.from(host.children) as HTMLElement[];
    const shown = new Set<number>();
    let ripples = 0;
    const apply = (p: number) => {
      dots.forEach((d, i) => {
        const el = els[i];
        if (!el) return;
        const on = reduced || p >= d.f - 1e-6;
        if (on && !shown.has(i)) {
          shown.add(i);
          el.style.opacity = "1";
          el.style.transform = "translate(-50%, -50%) scale(1)";
          if (!reduced) {
            playWaapi(el, [{ transform: "translate(-50%, -50%) scale(0)" }, { transform: "translate(-50%, -50%) scale(1.6)" }, { transform: "translate(-50%, -50%) scale(1)" }], { duration: tween.flash.duration * 0.6, ease: "easeOut" });
            if (layer && ripples < RIPPLE_CAP && p < 1) {
              ripples++;
              spawnMarkerRipple(layer, { x: d.x, y: d.y }, d.win ? FX_HEX.win : FX_HEX.loss);
            }
          }
        } else if (!on && shown.has(i)) {
          shown.delete(i);
          el.style.opacity = "0";
        }
      });
    };
    apply(progress.get());
    return progress.on("change", apply);
  }, [dots, progress, reduced]);

  const label = `Equity von ${moneyText(capital, "USDT", false)} auf ${moneyText(values[values.length - 1] ?? capital, "USDT", false)} über ${result.stats.n} Trades`;
  return (
    <motion.div ref={rootRef} className="absolute inset-x-0 top-3" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={tween.fade} data-testid="labor-equity">
      <EquityDraw values={values} baseline={capital} height={STAGE_H} progress={progress} label={label} />
      <div ref={dotsRef} aria-hidden="true" className="pointer-events-none absolute inset-0">
        {dots.map((d) => (
          <span
            key={d.id}
            className={cn("absolute size-[7px] rounded-full ring-2 ring-ink-900", d.win ? "bg-win" : "bg-loss")}
            style={{ left: d.x, top: d.y, opacity: 0, transform: "translate(-50%, -50%) scale(0)" }}
          />
        ))}
      </div>
      <div ref={layerRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" />
    </motion.div>
  );
}

function Kpis({ result, runSeq }: { result: LabResult; runSeq: number }) {
  const s = result.stats;
  const ciPct = s.winRateCI ? `${Math.round(s.winRateCI.lo * 100)}–${Math.round(s.winRateCI.hi * 100)} %` : undefined;
  const ciR = s.rCI ? `${numText(s.rCI.lo)} … ${numText(s.rCI.hi)}` : undefined;
  return (
    <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="labor-kpis">
      <Kpi label={LABOR.kpi.net} tone={s.net > 0 ? "text-win" : s.net < 0 ? "text-loss" : undefined} sub={pctText(s.netPct)}>
        <NumberCascade value={Math.round(s.net)} signed play={runSeq} suffix=" USDT" />
      </Kpi>
      <Kpi label={LABOR.kpi.trades} sub={result.skipped ? LABOR.skipped(result.skipped) : `${s.wins} G · ${s.losses} V`}>
        <NumberCascade value={s.n} play={runSeq} />
      </Kpi>
      <Kpi label={LABOR.kpi.winRate} sub={ciPct ? `80 %: ${ciPct}` : undefined}>
        {s.winRate == null ? "–" : <NumberCascade value={Math.round(s.winRate * 100)} suffix=" %" play={runSeq} />}
      </Kpi>
      <Kpi label={LABOR.kpi.avgR} tone={(s.avgR ?? 0) > 0 ? "text-win" : (s.avgR ?? 0) < 0 ? "text-loss" : undefined} sub={ciR ? `80 %: ${ciR}` : undefined}>
        {rText(s.avgR)}
      </Kpi>
      <Kpi label={LABOR.kpi.pf}>{pfText(s.pf)}</Kpi>
      <Kpi label={LABOR.kpi.dd} tone={s.maxDD > 0.2 ? "text-loss" : undefined}>
        {pctText(-s.maxDD, 1, false)}
      </Kpi>
      <Kpi label={LABOR.kpi.sharpe}>{numText(s.sharpeAnnual)}</Kpi>
      <Kpi label={LABOR.kpi.exposure} sub={s.avgBars != null ? `Ø ${numText(s.avgBars, 1)} Kerzen` : undefined}>
        {pctText(s.exposure, 0, false)}
      </Kpi>
    </dl>
  );
}

function Race({ result, runSeq }: { result: LabResult; runSeq: number }) {
  const reduced = useReducedFx();
  const cap = result.equity[0]?.equity ?? 0;
  const hold = result.buyHold.length && cap > 0 ? result.buyHold[result.buyHold.length - 1]!.equity / cap - 1 : null;
  const mine = result.stats.netPct;
  const max = Math.max(0.01, Math.abs(mine), Math.abs(hold ?? 0));
  const rows: { label: string; v: number | null; tone: string }[] = [
    { label: LABOR.raceStrategy, v: mine, tone: mine >= 0 ? "bg-win" : "bg-loss" },
    { label: LABOR.raceHold, v: hold, tone: "bg-white/35" },
  ];
  return (
    <div className="mt-3 grid gap-1.5" role="group" aria-label={LABOR.race} data-testid="labor-race">
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{LABOR.race}</span>
      {rows.map((r, i) => (
        <div key={r.label} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-2 text-[12px]">
          <span className="text-mute">{r.label}</span>
          <span className="relative h-2 overflow-hidden rounded-full bg-white/[0.05]">
            <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
            {r.v != null && (
              <motion.span
                key={`${runSeq}-${i}`}
                aria-hidden="true"
                className={cn("absolute inset-y-0 rounded-full", r.tone)}
                style={{ left: r.v >= 0 ? "50%" : `${50 - (Math.abs(r.v) / max) * 50}%`, width: `${(Math.abs(r.v) / max) * 50}%`, originX: r.v >= 0 ? 0 : 1 }}
                initial={reduced ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ ...spring.enter, delay: reduced ? 0 : 0.3 + i * 0.12 }}
              />
            )}
          </span>
          <span className={cn("num text-right font-mono", r.v == null ? "text-faint" : r.v >= 0 ? "text-win" : "text-loss")}>{pctText(r.v)}</span>
        </div>
      ))}
    </div>
  );
}
