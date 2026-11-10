/**
 * Weekly progress (P08) over 12 ISO weeks – process numbers only: Ø discipline and the journaling rate as lines that
 * draw themselves left → right (`EquityDraw`: clip-path + a glowing head, zero renders), check-in days and rule breaks
 * as columns rising from the baseline (scaleY, staggered). Weeks without data are gaps, never fake zeros; each panel
 * shows its change between the last 4 weeks and the 4 before.
 */
import { DotUnit } from "@/primitives/DotUnit";
import { motion } from "motion/react";
import { useRef } from "react";
import { seriesTrend, type WeekPoint } from "@/domain/growth";
import { cn } from "@/lib/cn";
import { EquityDraw } from "@/motion/fx";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { useSeenOnce } from "@/primitives/revealValue";
import { WACHSTUM } from "./strings";

function trendText(d: number | null, unit: string, digits = 0): string {
  if (d == null) return "noch kein Vergleich";
  const v = Math.abs(d).toFixed(digits).replace(".", ",");
  return `${d > 0 ? "+" : d < 0 ? "−" : "±"}${v}${unit} gg. 4 Wochen davor`;
}

function LinePanel({ title, points, pick, unit, scale = 1, testId }: { title: string; points: readonly WeekPoint[]; pick: (p: WeekPoint) => number | null; unit: string; scale?: number; testId: string }) {
  const vals = points.map(pick).filter((x): x is number => x != null).map((x) => x * scale);
  const d = seriesTrend(points, pick);
  const last = vals.length ? vals[vals.length - 1]! : null;
  return (
    <div className="grid min-w-0 content-start gap-2 rounded-2xl border border-line bg-ink-950/40 p-3.5" data-testid={testId} data-points={vals.length}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label !text-[10px]">{title}</span>
        <span className="dot-num text-[20px] leading-none">
          {last == null ? (
            "–"
          ) : (
            <>
              {Math.round(last)}
              <DotUnit>{unit}</DotUnit>
            </>
          )}
        </span>
      </div>
      {vals.length >= 2 ? <EquityDraw values={vals} height={74} tone={d != null && d < 0 ? "loss" : "win"} baseline={null} label={`${title}: ${vals.map((v) => Math.round(v)).join(", ")}`} /> : <div className="grid h-[74px] place-items-center text-[11px] text-faint">Noch zu wenig Wochen</div>}
      <span className={cn("text-[10.5px]", d == null ? "text-faint" : d > 0 ? "text-win" : d < 0 ? "text-loss" : "text-faint")}>{trendText(d == null ? null : d * scale, unit)}</span>
    </div>
  );
}

function Columns({ title, points, pick, tone, good, testId }: { title: string; points: readonly WeekPoint[]; pick: (p: WeekPoint) => number; tone: "fg" | "loss"; good: "up" | "down"; testId: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const vals = points.map(pick);
  const max = Math.max(1, ...vals);
  const d = seriesTrend(points, (p) => pick(p));
  const better = d == null || d === 0 ? null : good === "up" ? d > 0 : d < 0;
  return (
    <div ref={ref} className="grid min-w-0 content-start gap-2 rounded-2xl border border-line bg-ink-950/40 p-3.5" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label !text-[10px]">{title}</span>
        <span className="dot-num text-[20px] leading-none">{vals[vals.length - 1] ?? 0}</span>
      </div>
      <div className="flex h-[74px] items-end gap-[3px]" role="img" aria-label={`${title}: ${vals.join(", ")}`}>
        {vals.map((v, i) => (
          <motion.span
            key={points[i]!.key}
            title={`${points[i]!.label}: ${v}`}
            className={cn("flex-1 origin-bottom rounded-t-[3px]", v ? (tone === "loss" ? "bg-loss/80" : "bg-fg/75") : "bg-white/[0.06]")}
            style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
            initial={reduced ? false : { scaleY: 0 }}
            animate={seen || reduced ? { scaleY: 1, transitionEnd: { transform: "none" } } : { scaleY: 0 }}
            transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.reveal }}
          />
        ))}
      </div>
      <span className={cn("text-[10.5px]", better == null ? "text-faint" : better ? "text-win" : "text-loss")}>{trendText(d, "", 1)}</span>
    </div>
  );
}

export function ProgressCard({ points, className }: { points: readonly WeekPoint[]; className?: string }) {
  return (
    <Card title={WACHSTUM.progress.weekly} note={`${points[0]?.label ?? ""} – ${points[points.length - 1]?.label ?? ""}`} className={className} data-testid="growth-progress">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <LinePanel title="Ø Disziplin" points={points} pick={(p) => p.discipline} unit=" %" testId="progress-discipline" />
        <LinePanel title="Journaling" points={points} pick={(p) => p.journal} unit=" %" scale={100} testId="progress-journal" />
        <Columns title="Check-in-Tage" points={points} pick={(p) => p.checkins} tone="fg" good="up" testId="progress-checkins" />
        <Columns title="Regelbrüche" points={points} pick={(p) => p.ruleBreaks} tone="loss" good="down" testId="progress-breaks" />
      </div>
    </Card>
  );
}
