/**
 * Building blocks of the Risiko page (P05): the card frame with the breach beam (one red `BorderBeam` lap per new
 * breach, `fire` key), the reveal cell, number formatting and a small labelled value.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { n0, n2 } from "@/lib/format";
import { Reveal } from "@/motion/Reveal";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Card, type CardProps } from "@/primitives/Card";

export { SEG_TOUCH } from "@/views/insights/ui";

/** Signal red of the single accent (BorderBeam head). */
export const SIGNAL_HEX = "#e5202e";

/** A Card with an optional red beam lap (`beam` = a key that changes on every new breach; falsy = none). */
export function RiskCard({ beam, children, className, ...rest }: CardProps & { beam?: string | number | false | null }) {
  return (
    <div className={cn("relative h-full rounded-2xl", className)}>
      <Card {...rest}>{children}</Card>
      {beam ? <BorderBeam fire={beam} size={120} colorFrom={SIGNAL_HEX} colorTo="#ffb3b8" borderWidth={1.5} /> : null}
    </div>
  );
}

/** Grid cell that reveals once (ends at `transform: none`) and lets its card fill the row height. */
export function Cell({ index, span, children }: { index: number; span: string; children: ReactNode }) {
  return (
    <Reveal index={index} className={cn("flex min-w-0 flex-col [&>*]:flex-1", span)}>
      {children}
    </Reveal>
  );
}

/** "1.234 USDT" / "−56 USDT" (signed when asked). */
export function money(v: number | null | undefined, cur: string, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const s = n0(Math.abs(v));
  const sign = v < 0 ? "−" : signed && v > 0 ? "+" : "";
  return `${sign}${s} ${cur}`;
}

/** Percent with a comma: 0.0123 → "1,2 %" (digits 1) / "1,23 %" (digits 2). */
export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return `${(v * 100).toFixed(digits).replace(".", ",").replace("-", "−")} %`;
}

/** Price with sensible precision. */
export function priceText(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  if (Math.abs(v) >= 1000) return n0(v);
  if (Math.abs(v) >= 1) return n2(v);
  return String(Number(v.toPrecision(4))).replace(".", ",");
}

/** Quantity with up to 4 significant decimals. */
export function qtyText(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  if (v >= 100) return n0(v);
  if (v >= 1) return n2(v);
  return String(Number(v.toPrecision(4))).replace(".", ",");
}

/** Label + value block. */
export function Metric({ label, children, sub, className, tone }: { label: ReactNode; children: ReactNode; sub?: ReactNode; className?: string; tone?: string }) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1", className)}>
      <span className="label !text-[10px]">{label}</span>
      <span className={cn("num truncate font-mono text-[15px] font-medium leading-tight text-fg", tone)}>{children}</span>
      {sub != null && <span className="num truncate text-[11px] text-faint">{sub}</span>}
    </div>
  );
}
