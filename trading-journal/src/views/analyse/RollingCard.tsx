/**
 * Rolling card (P03): win rate / Ø R / profit factor / Sharpe over the last 10 / 20 / 50 trades at every trade, the
 * overall value as a dashed line, the current form (heiß / kalt / normal against the 80 % interval).
 *
 * `ScrubTimeline` drives one MotionValue (the trade index): the guide line moves by transform, the readout is written
 * into the DOM, the signed `DotMatrix` meter shows the window's Ø R as an R-VU meter (green up, red down) and the
 * `EquityDraw` of the equity in R draws up to the scrubbed trade – all without a React render per scrub.
 */
import { themePaint } from "@/lib/themePaint";
import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { aggregate } from "@/domain/agg";
import { ANA_EMPTY, CARD_TITLES, explainRolling, rollingStats, type RollingPoint } from "@/domain/analytics";
import type { AccountView } from "@/domain/account";
import { cn } from "@/lib/cn";
import { date as fmtDate, n2, pct0, r as fmtR } from "@/lib/format";
import { DotMatrix } from "@/motion/DotMatrix";
import { EquityDraw } from "@/motion/fx/EquityDraw";
import { ScrubTimeline } from "@/motion/pulse/ScrubTimeline";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { EmptyState } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { Segmented } from "@/primitives/Segmented";
import { useAnalyseUi } from "./analyseStore";
import { memoClosed } from "./hooks";
import { AnaCard, SEG_TOUCH } from "./ui";

type MetricKey = "winRate" | "expR" | "pf" | "sharpe";
const METRICS: { v: MetricKey; label: string }[] = [
  { v: "winRate", label: "Win-Rate" },
  { v: "expR", label: "Ø R" },
  { v: "pf", label: "PF" },
  { v: "sharpe", label: "Sharpe" },
];
const WINDOWS = [10, 20, 50] as const;
const H = 150;
/** PF above this is drawn at the cap (a window without losses has PF ∞). */
const PF_CAP = 5;

const valueOf = (p: RollingPoint, m: MetricKey): number | null => {
  const v = p[m];
  if (v == null || Number.isNaN(v)) return null;
  return m === "pf" ? Math.min(PF_CAP, v) : v;
};
const fmt = (v: number | null, m: MetricKey): string => (v == null ? "–" : m === "winRate" ? pct0(v) : m === "expR" ? fmtR(v) : m === "pf" && v >= PF_CAP ? `≥ ${PF_CAP}` : n2(v));

function Chart({ points, metric, overall, time }: { points: RollingPoint[]; metric: MetricKey; overall: number | null; time: MotionValue<number> }) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const guide = useRef<HTMLSpanElement>(null);
  const width = useRef(0);
  const seen = useSeenOnce(root);
  const vals = points.map((p) => valueOf(p, metric));
  const fin = vals.filter((v): v is number => v != null);
  let lo = Math.min(...fin, overall ?? Infinity, metric === "winRate" ? 0 : Infinity, metric === "pf" ? 0 : Infinity);
  let hi = Math.max(...fin, overall ?? -Infinity, metric === "winRate" ? 1 : -Infinity);
  if (!(hi - lo > 1e-9)) {
    hi += 1;
    lo -= 1;
  }
  const W = Math.max(1, points.length - 1);
  const y = (v: number) => 4 + (1 - (v - lo) / (hi - lo)) * (H - 8);
  let d = "";
  vals.forEach((v, i) => {
    if (v == null) return;
    d += `${d ? "L" : "M"}${i},${y(v).toFixed(2)}`;
  });
  const zero = lo < 0 && hi > 0 ? y(0) : null;

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => (width.current = el.clientWidth);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const apply = (t: number) => {
      const g = guide.current;
      if (!g) return;
      const i = Math.max(0, Math.min(W, Math.round(t)));
      g.style.transform = `translateX(${((i / W) * width.current).toFixed(1)}px)`;
    };
    apply(time.get());
    return time.on("change", apply);
  }, [time, W]);

  return (
    <div ref={root} className="relative" style={{ height: H }} aria-hidden="true" data-testid="rolling-chart">
      <motion.div
        className="absolute inset-0"
        initial={reduced ? false : { clipPath: "inset(0 100% 0 0)" }}
        animate={{ clipPath: seen || reduced ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)" }}
        transition={tween.draw}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
          {zero != null && <line x1={0} x2={W} y1={zero} y2={zero} stroke={themePaint("#2c2c2c")} vectorEffect="non-scaling-stroke" />}
          {overall != null && <line x1={0} x2={W} y1={y(metric === "pf" ? Math.min(PF_CAP, overall) : overall)} y2={y(metric === "pf" ? Math.min(PF_CAP, overall) : overall)} stroke={themePaint("#5f5f5f")} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
          <path d={d} fill="none" stroke={themePaint("#f2f2f2")} strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </motion.div>
      <span ref={guide} className="pointer-events-none absolute inset-y-0 left-0 w-px bg-signal/80" />
    </div>
  );
}

export function RollingCard({ view, cur }: { view: AccountView; cur: string }) {
  const window = useAnalyseUi((s) => s.rollingWindow);
  const set = useAnalyseUi((s) => s.set);
  const [metric, setMetric] = useState<MetricKey>("winRate");
  const rep = useMemo(() => memoClosed(view.closed, `rolling:${window}:${view.start}`, () => rollingStats(view.closed, view.start, window)), [view.closed, view.start, window]);
  const g = useMemo(() => aggregate(view.closed), [view.closed]);
  const overall = metric === "winRate" ? g.winRate : metric === "expR" ? g.avgR : metric === "pf" ? g.pf : null;
  const total = Math.max(1, rep.points.length - 1);
  const time = useMotionValue(total);
  // another window / journal: back to the newest trade
  useEffect(() => time.set(total), [time, total]);
  const readout = useRef<HTMLSpanElement>(null);
  // window Ø R → −1…1 (±2 R full scale) for the signed VU meter
  const meter = useTransform(time, (t) => {
    const p = rep.points[Math.max(0, Math.min(rep.points.length - 1, Math.round(t)))];
    const v = p?.expR ?? 0;
    return Math.max(-1, Math.min(1, v / 2));
  });
  const progress = useTransform(time, (t) => (total ? Math.max(0.02, Math.min(1, t / total)) : 1));
  useLayoutEffect(() => {
    const apply = (t: number) => {
      const p = rep.points[Math.max(0, Math.min(rep.points.length - 1, Math.round(t)))];
      const el = readout.current;
      if (!el || !p) return;
      el.textContent = `Trade ${p.i} · ${fmtDate(new Date(p.at))} · WR ${pct0(p.winRate)} · Ø ${fmtR(p.expR)} · PF ${fmt(valueOf(p, "pf"), "pf")}`;
    };
    apply(time.get());
    return time.on("change", apply);
  }, [time, rep]);
  const form = rep.form;
  return (
    <AnaCard
      title={CARD_TITLES.rolling}
      explain={() => explainRolling(rep, cur)}
      data-testid="ana-rolling"
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Segmented<`${(typeof WINDOWS)[number]}`> size="sm" aria-label="Fenster" options={WINDOWS.map((w) => ({ v: `${w}` as const, label: `${w}` }))} value={`${window}`} onChange={(v) => set({ rollingWindow: Number(v) as 10 | 20 | 50 })} className={SEG_TOUCH} />
        </div>
      }
    >
      {!rep.points.length ? (
        <EmptyState title={ANA_EMPTY.rolling(window).title} text={ANA_EMPTY.rolling(window).text} />
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented<MetricKey> size="sm" aria-label="Kennzahl" options={METRICS} value={metric} onChange={setMetric} className={SEG_TOUCH} />
            {form && (
              <Badge tone={form.verdict === "heiss" ? "win" : form.verdict === "kalt" ? "warn" : "mute"} dot ping={form.verdict !== "normal"}>
                {form.verdict === "heiss" ? "Form: heiß" : form.verdict === "kalt" ? "Form: kalt" : "Form: normal"}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-3">
            <Chart points={rep.points} metric={metric} overall={overall ?? null} time={time} />
            <div className="grid content-between justify-items-center gap-1" data-testid="rolling-vu">
              <span className="label !text-[9px]">Ø R</span>
              <DotMatrix meter={meter} signed rows={11} cols={9} size={3} gap={2} tone="win" negativeTone="loss" sampleMs={120} label="Ø R des Fensters als Pegel" />
              <span className="font-mono text-[9px] text-faint">±2 R</span>
            </div>
          </div>
          <span ref={readout} className={cn("num min-h-4 font-mono text-[11.5px] leading-snug text-mute")} data-testid="rolling-readout" />
          <ScrubTimeline label="Rollierendes Fenster durchgehen" total={total} time={time} step={1} bigStep={10} formatTime={(t) => `Trade ${rep.points[Math.round(t)]?.i ?? "–"}`} playSeconds={tween.draw.duration * 8} className="!p-2.5 sm:!p-3" />
          {rep.equityR.length > 2 && (
            <div className="grid gap-1">
              <span className="label">Equity in R</span>
              <EquityDraw values={rep.equityR} height={64} progress={progress} label={`Equity in R: ${fmtR(rep.equityR[rep.equityR.length - 1])} über ${rep.equityR.length - 1} Trades`} />
            </div>
          )}
        </div>
      )}
    </AnaCard>
  );
}
