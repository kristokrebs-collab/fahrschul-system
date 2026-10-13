/**
 * Building blocks of the Labor page (P07): the reveal cell (ends at `transform: none`), a labelled KPI, the chip
 * picker, money / percent / R formatting and the section title (Analyse page's letter rise).
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { DASH, INFINITY_SIGN, n0 } from "@/lib/format";
import { Reveal } from "@/motion/Reveal";
import { radius, spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export { SectionTitle } from "@/views/analyse/ui";
export { SEG_TOUCH } from "@/views/insights/ui";

/** Grid cell that reveals once and lets its card fill the row height. */
export function Cell({ index, span, children, className }: { index: number; span: string; children: ReactNode; className?: string }) {
  return (
    <Reveal index={index} className={cn("flex min-w-0 flex-col [&>*]:flex-1", span, className)}>
      {children}
    </Reveal>
  );
}

const dec = (v: number, d: number) => v.toFixed(d).replace(".", ",").replace("-", "−");

/** "+12,3 %" (fraction in). */
export const pctText = (v: number | null | undefined, d = 1, sign = true): string => (v == null || !Number.isFinite(v) ? DASH : `${sign && v > 0 ? "+" : ""}${dec(v * 100, d)} %`);
/** "+0,42 R". */
export const rText = (v: number | null | undefined, d = 2): string => (v == null || !Number.isFinite(v) ? DASH : `${v > 0 ? "+" : ""}${dec(v, d)} R`);
/** "1.234 USDT" / "−56 USDT". */
export const moneyText = (v: number | null | undefined, cur = "USDT", sign = true): string => (v == null || !Number.isFinite(v) ? DASH : `${sign && v > 0 ? "+" : v < 0 ? "−" : ""}${n0(Math.abs(v))} ${cur}`);
export const pfText = (v: number | null | undefined): string => (v == null ? DASH : v === Infinity ? INFINITY_SIGN : dec(v, 2));
export const numText = (v: number | null | undefined, d = 2): string => (v == null || !Number.isFinite(v) ? DASH : dec(v, d));

/** A labelled value tile. */
export function Kpi({ label, children, sub, tone, className }: { label: string; children: ReactNode; sub?: ReactNode; tone?: string; className?: string }) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</span>
      <span className={cn("num whitespace-nowrap font-mono text-[15px] font-medium leading-tight", tone)}>{children}</span>
      {sub != null && <span className="num truncate text-[11px] text-faint">{sub}</span>}
    </div>
  );
}

/** Chips with one selected value (role radiogroup); the selection glides (`layoutId`). */
export function ChipPick<T extends string | number>({ value, options, onChange, label, id, className }: { value: T; options: readonly { v: T; label: string }[]; onChange: (v: T) => void; label: string; id: string; className?: string }) {
  const reduced = useReducedFx();
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            className={cn("relative isolate min-h-9 rounded-full border px-3 text-[12px] font-medium transition-colors duration-200 pointer-coarse:min-h-11", on ? "border-transparent text-fg" : "border-line-2 text-mute hover:border-white/30 hover:text-fg")}
          >
            {/* the ink thumb of `Segmented` (PR #3), not a white pill: the one white surface is the primary action (P1-06) */}
            {on && <motion.span layoutId={`labor-chip-${id}`} aria-hidden="true" className="absolute -inset-px -z-10 border border-line-2 bg-ink-750" style={{ borderRadius: radius.pill }} transition={reduced ? { duration: 0 } : spring.segment} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small field label + control. */
export function FieldRow({ label, htmlFor, children, hint, className }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">
          {label}
        </label>
      ) : (
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{label}</span>
      )}
      {children}
      {hint != null && <span className="text-[11px] text-faint">{hint}</span>}
    </div>
  );
}
