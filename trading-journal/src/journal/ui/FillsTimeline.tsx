import { motion } from "motion/react";
import { useRef } from "react";
import type { FillStats } from "@/domain/fills";
import { FILL_KIND_LABELS } from "@/domain/fills";
import { cn } from "@/lib/cn";
import { date as fmtDate, price as fmtPrice, time as fmtTime } from "@/lib/format";
import { useFirstInView } from "@/motion/inView";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

const SHORT: Record<string, string> = { entry: "E", add: "+", partial: "T", exit: "X" };

/** x position (0–1) of each fill: by time when every fill has one, else evenly spaced. */
export function fillPositions(times: readonly number[]): number[] {
  const n = times.length;
  if (n <= 1) return times.map(() => 0.5);
  const ok = times.every((t) => Number.isFinite(t));
  const lo = ok ? Math.min(...times) : 0;
  const hi = ok ? Math.max(...times) : 0;
  return times.map((t, i) => (ok && hi > lo ? (t - lo) / (hi - lo) : i / (n - 1)));
}

/**
 * Mini milestone rail of a position's fills (the `MilestoneRail` pattern, compact for the 460 px detail): the rail draws
 * itself left → right on first view (`tween.draw`), every fill pops on `spring.pop` when the line reaches it (open =
 * white, a partial / final exit tinted by its P&L), with a one-letter code (E / + / T / X); below, the fills as a list.
 * An ordered list with the real text; rail and dots are decorative.
 */
export function FillsTimeline({ stats, className }: { stats: FillStats; className?: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useFirstInView(ref, !reduced);
  const run = reduced || seen;
  const fills = stats.ordered;
  const pnlOf = new Map(stats.parts.map((p) => [p.id, p.pnl] as const));
  const xs = fillPositions(fills.map((f) => (f.at ? new Date(f.at).getTime() : NaN)));
  const draw = tween.draw.duration;
  return (
    <div ref={ref} className={cn("grid gap-2", className)}>
      <div aria-hidden="true" className="relative mx-3 h-7">
        <span className="absolute inset-x-0 top-[9px] h-px bg-line-2" />
        <motion.span className="absolute inset-x-0 top-[9px] h-px origin-left bg-fg/70" initial={reduced ? false : { scaleX: 0 }} animate={run ? { scaleX: 1 } : undefined} transition={reduced ? { duration: 0 } : tween.draw} />
        {fills.map((f, i) => {
          const pnl = pnlOf.get(f.id);
          const tone = f.side === "open" ? "bg-fg" : pnl == null || pnl === 0 ? "bg-mute" : pnl > 0 ? "bg-win" : "bg-loss";
          return (
            <motion.span
              key={f.id}
              className="absolute top-0 grid -translate-x-1/2 justify-items-center gap-0.5"
              style={{ left: `${xs[i]! * 100}%` }}
              initial={reduced ? false : { scale: 0, opacity: 0 }}
              animate={run ? { scale: 1, opacity: 1 } : undefined}
              transition={reduced ? { duration: 0 } : { scale: { ...spring.pop, delay: xs[i]! * draw + Math.min(i, stagger.max) * stagger.rows }, opacity: { ...tween.fade, delay: xs[i]! * draw } }}
            >
              <span className={cn("size-[11px] rounded-full border-2 border-ink-850", tone)} />
              <span className="font-mono text-[9.5px] leading-none text-faint">{SHORT[f.kind] ?? "·"}</span>
            </motion.span>
          );
        })}
      </div>
      <ol className="grid gap-y-0.5 text-[11.5px]" aria-label="Fills der Position">
        {fills.map((f) => {
          const d = f.at ? new Date(f.at) : null;
          const pnl = pnlOf.get(f.id);
          return (
            <li key={f.id} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-line/60 pb-0.5">
              <span className="shrink-0 text-faint">
                {FILL_KIND_LABELS[f.kind]}
                {d && !Number.isNaN(+d) ? <span className="ml-1 font-mono text-[10px]">{`${fmtDate(d)} ${fmtTime(d)}`}</span> : null}
              </span>
              <span className={cn("num whitespace-nowrap font-mono", pnl == null ? "text-fg/85" : pnl > 0 ? "text-win" : pnl < 0 ? "text-loss" : "text-fg/85")}>
                {fmtPrice(f.price)} × {f.qty.toLocaleString("de-DE", { maximumFractionDigits: 6 })}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
