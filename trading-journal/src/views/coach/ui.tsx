/**
 * Building blocks of the coach and the reports (P04): verdict badges, the chart of an answer (bars grow from their
 * origin on `spring.enter`, staggered `stagger.rows`; lines draw with `EquityDraw`), a number that flashes once when it
 * lands (`ValueFlash`), severity dots and the evidence-trade cascade (`StaggerItem` under a stagger parent).
 * Everything ends at `transform: none`; reduced motion shows the final state.
 */
import { motion, type Variants } from "motion/react";
import { useRef, type ReactNode } from "react";
import type { BehaviorSeverity, EdgeLabel } from "@/domain/coach";
import type { ChartSpec, Tone } from "@/domain/coach/nlq";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { pct0, pf as fmtPf, r as fmtR, signed } from "@/lib/format";
import { EquityDraw } from "@/motion/fx/EquityDraw";
import { useFirstInView } from "@/motion/inView";
import { STAGGER_HIDDEN, STAGGER_SHOWN, StaggerItem, withSectionStagger } from "@/motion/Stagger";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { ValueFlash } from "@/motion/ValueFlash";
import { Badge } from "@/primitives/Badge";
import { TradeRows } from "@/views/insights/ui";

export const TONE_TEXT: Readonly<Record<Tone | "warn", string>> = { win: "text-win", loss: "text-loss", fg: "text-fg", mute: "text-mute", warn: "text-warn" };

/** "klar" / "Tendenz" / "zu wenig Daten" as a badge (`leak`: a clear leak is red, not green). */
export function VerdictBadge({ verdict, leak = false, className }: { verdict: EdgeLabel; leak?: boolean; className?: string }) {
  return (
    <Badge tone={verdict === "klar" ? (leak ? "loss" : "win") : verdict === "Tendenz" ? "warn" : "mute"} dot={verdict === "klar"} className={className}>
      {verdict}
    </Badge>
  );
}

const SEV_DOT: Readonly<Record<BehaviorSeverity, string>> = { 1: "bg-warn/70", 2: "bg-loss", 3: "bg-signal shadow-[0_0_0_3px_rgb(229_32_46/0.22)]" };
const SEV_LABEL: Readonly<Record<BehaviorSeverity, string>> = { 1: "Hinweis", 2: "Warnung", 3: "Kritisch" };

/** Severity dot (with an sr-only word). */
export function SeverityDot({ severity, className }: { severity: BehaviorSeverity; className?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", SEV_DOT[severity])} />
      <span className="sr-only">{SEV_LABEL[severity]}</span>
    </span>
  );
}

/** A number that flashes once (green up / red down) when `landed` turns true – the answer's facts as they arrive. */
export function LandingValue({ raw, landed, children, className }: { raw: number | null; landed: boolean; children: ReactNode; className?: string }) {
  return (
    <ValueFlash value={raw == null || !Number.isFinite(raw) ? null : landed ? raw : 0} className={className}>
      {children}
    </ValueFlash>
  );
}

const fmtUnit = (v: number, unit: Extract<ChartSpec, { type: "bars" }>["unit"], cur: string): string =>
  unit === "pct" ? pct0(v) : unit === "R" ? fmtR(v) : unit === "count" ? `${Math.round(v)}` : unit === "ratio" ? fmtPf(v) : `${signed(v, 0)} ${cur}`;

const BAR_TONE: Readonly<Record<Tone, string>> = { win: "bg-win/70", loss: "bg-loss/70", fg: "bg-white/55", mute: "bg-white/20" };

/** Horizontal bars of an answer (signed values grow from the zero line, others from the left). */
export function AnswerBars({ spec, cur, label, className }: { spec: Extract<ChartSpec, { type: "bars" }>; cur: string; label: string; className?: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useFirstInView(ref, !reduced);
  const on = seen || reduced;
  const signedAxis = spec.unit === "money" || spec.unit === "R";
  const max = Math.max(1e-9, ...spec.rows.map((r) => Math.abs(r.value)));
  const hasNeg = signedAxis && spec.rows.some((r) => r.value < 0);
  return (
    <div ref={ref} role="img" aria-label={label} className={cn("grid gap-1.5", className)}>
      {spec.rows.map((row, i) => {
        const frac = Math.abs(row.value) / max;
        const neg = row.value < 0;
        const left = hasNeg ? (neg ? 50 - frac * 50 : 50) : 0;
        const width = hasNeg ? frac * 50 : frac * 100;
        return (
          <div key={`${row.label}-${i}`} aria-hidden="true" className="grid grid-cols-[minmax(0,5.5rem)_minmax(3rem,1fr)_auto] items-center gap-2 text-[11.5px] sm:grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] sm:gap-2.5">
            <span className={cn("truncate", row.highlight ? "font-semibold text-fg" : "text-mute")}>{row.label}</span>
            <span className="relative h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
              {hasNeg && <span className="absolute inset-y-0 left-1/2 w-px bg-white/20" />}
              <motion.span
                className={cn("absolute inset-y-0 rounded-full", BAR_TONE[row.tone], row.highlight && "ring-1 ring-fg/40")}
                style={{ left: `${left}%`, width: `${width}%`, originX: neg ? 1 : 0 }}
                initial={reduced ? false : { scaleX: 0 }}
                animate={{ scaleX: on ? 1 : 0 }}
                transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.rows + stagger.lead }}
              />
            </span>
            <span className={cn("num font-mono", row.highlight ? "text-fg" : "text-mute")}>
              {fmtUnit(row.value, spec.unit, cur)}
              <span className="ml-1 text-faint">· {row.n}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The chart of an answer: bars or a drawn line. */
export function AnswerChart({ spec, cur, label, className }: { spec: ChartSpec; cur: string; label: string; className?: string }) {
  if (spec.type === "line") return <EquityDraw values={spec.values} height={84} label={`${label}: ${spec.label}`} className={className} />;
  return <AnswerBars spec={spec} cur={cur} label={label} className={className} />;
}

/** Stagger parent of the evidence rows: `stagger.sections` apart, after `stagger.lead`. */
const EVIDENCE_PARENT: Variants = { [STAGGER_HIDDEN]: {}, [STAGGER_SHOWN]: { transition: withSectionStagger(tween.reveal, stagger.lead) } };

/** Evidence trades cascading in (each row a `StaggerItem` under a stagger parent; rows open the trade detail). */
export function EvidenceTrades({ trades, group, play = true, className }: { trades: readonly EnrichedTrade[]; group: string; play?: boolean; className?: string }) {
  const reduced = useReducedFx();
  if (!trades.length) return null;
  return (
    <motion.div className={cn("grid", className)} initial={reduced ? false : STAGGER_HIDDEN} animate={play || reduced ? STAGGER_SHOWN : STAGGER_HIDDEN} variants={EVIDENCE_PARENT}>
      {trades.map((t) => (
        <StaggerItem key={t.id}>
          <TradeRows trades={[t]} group={group} extra={(x) => `${x.pair || "–"}${x.r != null ? ` · ${fmtR(x.r)}` : ""}`} />
        </StaggerItem>
      ))}
    </motion.div>
  );
}

/** Small label/value row used in the coach cards. */
export function KV({ label, value, tone = "fg", className }: { label: ReactNode; value: ReactNode; tone?: Tone | "warn"; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-baseline justify-between gap-3 border-b border-line/70 py-1.5 text-[12.5px] last:border-b-0", className)}>
      <span className="min-w-0 truncate text-mute">{label}</span>
      <span className={cn("num shrink-0 text-right font-mono", TONE_TEXT[tone])}>{value}</span>
    </div>
  );
}

/** The "n Trades · min. N" sample line every coach number carries. */
export function SampleLine({ n, minN, className }: { n: number; minN?: number; className?: string }) {
  return (
    <span className={cn("num font-mono text-[10.5px] tracking-wide text-faint", className)}>
      n {n}
      {minN != null ? ` · min. ${minN}` : ""}
    </span>
  );
}
