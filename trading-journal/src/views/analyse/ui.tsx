/**
 * Building blocks of the Analyse page (P03): section titles (letters rise via `SplitText` on first view), the
 * significance badge, the confidence whisker (the interval grows out of its centre on `spring.enter`, staggered by
 * `stagger.reveal`, the estimate pops on `spring.pop`; ends at `transform: none`), unit formatting and a counting
 * value. Cards reuse the Auswertung's `InsightCard` (title, `+` explainer, action slot).
 */
import { motion } from "motion/react";
import { useRef, type ReactNode } from "react";
// the module, not the barrel: the setups compare sheet (first load) uses these helpers
import { SIG_LABEL, SIG_TONE, type Interval, type Significance } from "@/domain/analytics/stats";
import { cn } from "@/lib/cn";
import { DASH, INFINITY_SIGN, r as fmtR, signed } from "@/lib/format";
import { useFirstInView } from "@/motion/inView";
import { MotionNumber } from "@/motion/MotionNumber";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { useSeenOnce } from "@/primitives/revealValue";
import { SplitText } from "@/primitives/SplitText";
import { InsightCard, type InsightCardProps } from "@/views/insights/ui";

export { SEG_TOUCH, Stat, TradeRows, softTone } from "@/views/insights/ui";

/**
 * The Auswertung's `InsightCard` (title, `+` explainer, action slot) with the note moved into the body: in the card
 * header a long note takes the full row on phones and pushes the `+` onto a line of its own.
 */
export function AnaCard({ note, children, ...rest }: InsightCardProps) {
  return (
    <InsightCard {...rest}>
      {note != null && <p className="-mt-2 mb-4 text-xs leading-snug text-faint">{note}</p>}
      {children}
    </InsightCard>
  );
}

/** Detail source of trades opened from the Analyse page (detached, like the Auswertung's). */
export const ANA_DETAIL_SOURCE = "insights" as const;

/**
 * Section heading: the red signal dot + an `h2` whose letters rise once on first view (`SplitText`). `section` is the stable
 * name of the section (`data-section`): the page's `SectionNav` and the function register scroll to it.
 */
export function SectionTitle({ title, sub, id, section, className }: { title: string; sub?: string; id?: string; section?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedFx();
  const seen = useFirstInView(ref, !reduced);
  return (
    // the head of PR #3's „Auswertung“ (`InsightsSection`): the lead sits UNDER the title, never in a column of its own (P1-07)
    <div ref={ref} data-section={section} className={cn("grid min-w-0 gap-1.5 pt-6", className)}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-1.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
        <h2 id={id} className="label !text-fg">
          {seen && !reduced ? (
            <SplitText text={title} force />
          ) : (
            <span className={cn(!seen && !reduced && "opacity-0")}>{title}</span>
          )}
        </h2>
      </div>
      {sub && <p className="max-w-[60ch] text-[13px] text-mute">{sub}</p>}
    </div>
  );
}

/** "klar" / "Tendenz" / "offen" / "zu wenig" badge. */
export function SigBadge({ verdict, className }: { verdict: Significance; className?: string }) {
  return (
    <Badge tone={SIG_TONE[verdict] === "win" ? "win" : SIG_TONE[verdict] === "warn" ? "warn" : "mute"} className={className} dot={verdict === "klar"}>
      {SIG_LABEL[verdict]}
    </Badge>
  );
}

export type WhiskerTone = "win" | "loss" | "fg" | "mute";
const BAR: Record<WhiskerTone, string> = { win: "bg-win/45", loss: "bg-loss/45", fg: "bg-white/30", mute: "bg-white/15" };
const DOT: Record<WhiskerTone, string> = { win: "bg-win", loss: "bg-loss", fg: "bg-fg", mute: "bg-mute" };

/** Tone of an interval: clearly above 0 → win, clearly below → loss, straddling → fg. */
export const ciTone = (ci: Interval | null, value: number | null): WhiskerTone => (!ci || value == null ? "mute" : ci.lo > 0 ? "win" : ci.hi < 0 ? "loss" : "fg");

/** A common domain [min, max] (with 0 inside and 8 % padding) for whiskers that share an axis. */
export function whiskerDomain(items: readonly (Interval | null | undefined)[], values: readonly (number | null | undefined)[] = []): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const i of items) {
    if (!i) continue;
    if (Number.isFinite(i.lo)) lo = Math.min(lo, i.lo);
    if (Number.isFinite(i.hi)) hi = Math.max(hi, i.hi);
  }
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/**
 * Confidence whisker on a shared axis: track, zero line, the interval bar growing from its centre (scaleX on
 * `spring.enter`, staggered `index · stagger.reveal`), the estimate as a dot popping on `spring.pop`. Decorative
 * (the numbers are in the text next to it).
 */
export function CiWhisker({ ci, value, domain, tone, index = 0, className }: { ci: Interval | null; value: number | null; domain: [number, number]; tone?: WhiskerTone; index?: number; className?: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const [min, max] = domain;
  const span = max - min || 1;
  const pos = (v: number) => `${(Math.min(1, Math.max(0, (v - min) / span)) * 100).toFixed(2)}%`;
  const t = tone ?? ciTone(ci, value);
  const on = seen || reduced;
  const delay = reduced ? 0 : Math.min(index, stagger.max) * stagger.reveal;
  return (
    <div ref={ref} aria-hidden="true" className={cn("relative h-3 w-full", className)}>
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/[0.07]" />
      {min < 0 && max > 0 && <span className="absolute inset-y-0 w-px bg-white/25" style={{ left: pos(0) }} />}
      {ci && Number.isFinite(ci.lo) && Number.isFinite(ci.hi) && (
        <motion.span
          className={cn("absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full", BAR[t])}
          style={{ left: pos(ci.lo), width: `calc(${pos(ci.hi)} - ${pos(ci.lo)})`, originX: 0.5 }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: on ? 1 : 0 }}
          transition={{ ...spring.enter, delay }}
        />
      )}
      {value != null && Number.isFinite(value) && (
        <motion.span
          className={cn("absolute top-1/2 size-2 rounded-full ring-2 ring-ink-850", DOT[t])}
          style={{ left: pos(value), x: "-50%", y: "-50%" }}
          initial={reduced ? false : { scale: 0 }}
          animate={{ scale: on ? 1 : 0 }}
          transition={{ ...spring.pop, delay: delay + (reduced ? 0 : stagger.lead) }}
        />
      )}
    </div>
  );
}

/** Value in the breakdown unit: "+0,42 R" or "+120 USDT". */
export function unitText(v: number | null | undefined, unit: "R" | "money", cur: string, digits: 0 | 2 = 0): string {
  if (v == null || !Number.isFinite(v)) return v === Infinity ? INFINITY_SIGN : DASH;
  return unit === "R" ? fmtR(v) : `${signed(v, digits)} ${cur}`;
}

/** Interval text "−0,12 … +0,80 R". */
export function ciText(ci: Interval | null, unit: "R" | "money" | "pct" | "ratio", cur = ""): string {
  if (!ci) return DASH;
  const f = (v: number) => (unit === "pct" ? `${Math.round(v * 100)} %` : unit === "ratio" ? signed(v, 2).replace("+", "") : unit === "R" ? signed(v, 2) : signed(v, 0));
  return `${f(ci.lo)} … ${f(ci.hi)}${unit === "R" ? " R" : unit === "money" ? ` ${cur}` : ""}`;
}

/** A number that counts up on first view (MotionNumber, session-once per `revealKey`), or a dash. */
export function CountValue({ value, decimals = 2, suffix, signed: sgn, format, revealKey, className, tone = "none" }: { value: number | null; decimals?: number; suffix?: string; signed?: boolean; format?: (v: number) => string; revealKey?: string; className?: string; tone?: "auto" | "none" }): ReactNode {
  if (value == null || !Number.isFinite(value)) return <span className={className}>{value === Infinity ? INFINITY_SIGN : DASH}</span>;
  return <MotionNumber value={value} decimals={decimals} suffix={suffix} signed={sgn} format={format} countOnReveal revealKey={revealKey} tone={tone} className={className} />;
}
