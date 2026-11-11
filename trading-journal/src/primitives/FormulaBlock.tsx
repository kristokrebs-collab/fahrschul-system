import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Explainer formula: `font-mono text-[12px] leading-relaxed text-fg/90` in `rounded-xl border border-line bg-ink-950/70 px-3 py-2`. */
export function FormulaBlock({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-line bg-ink-950/70 px-3 py-2 font-mono text-[12px] leading-relaxed text-fg/90", className)}>{children}</div>;
}

/** `[label, value, valueClassName?]` */
export type FormulaRow = readonly [ReactNode, ReactNode, string?];

/** Explainer rows: `dl sm:grid-cols-2`, `dt text-mute`, `dd num font-mono font-medium`. */
export function FormulaRows({ rows, className }: { rows: readonly FormulaRow[]; className?: string }) {
  if (rows.length === 0) return null;
  return (
    <dl className={cn("grid gap-x-6 sm:grid-cols-2", className)}>
      {rows.map(([label, value, tone], i) => (
        <div key={i} className="flex justify-between gap-3 border-t border-line py-1.5 text-[12.5px]">
          <dt className="text-mute">{label}</dt>
          <dd className={cn("num text-right font-mono font-medium", tone ?? "text-fg")}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
