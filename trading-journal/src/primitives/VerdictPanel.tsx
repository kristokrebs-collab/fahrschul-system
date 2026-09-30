import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { FormulaBlock, FormulaRows, type FormulaRow } from "@/primitives/FormulaBlock";

export type VerdictTone = "win" | "loss" | "warn" | "mute";

export const verdictTone: Record<VerdictTone, string> = {
  win: "border-win/30 bg-win/[0.07] text-win",
  loss: "border-loss/30 bg-loss/[0.07] text-loss",
  warn: "border-warn/30 bg-warn/[0.07] text-warn",
  mute: "border-line-2 bg-white/[0.03] text-mute",
};

export interface VerdictPanelProps {
  tone: VerdictTone;
  children: ReactNode;
  className?: string;
}

/** Plan 2.5 "Verdict-Panel": `rounded-xl border px-3 py-2 text-[13px]` + tone. */
export function VerdictPanel({ tone, children, className }: VerdictPanelProps) {
  return (
    <p className={cn("rounded-xl border px-3 py-2 text-[13px]", verdictTone[tone], className)}>
      {children}
    </p>
  );
}

export interface ExplainerData {
  title?: string;
  /** Plain-language description (`max-w-[70ch] text-[13px] leading-relaxed text-mute`). */
  what: ReactNode;
  formula?: ReactNode;
  rows?: readonly FormulaRow[];
  verdict?: { tone: VerdictTone; text: ReactNode } | null;
}

/**
 * Bundle `vi`: fact explainer (what · formula · rows · verdict). `bare` (inside MorphDialog) skips the
 * framed card and title.
 */
export function Explainer({ d, bare = false, className }: { d: ExplainerData; bare?: boolean; className?: string }) {
  return (
    <div className={cn("grid gap-3", !bare && "mt-3 rounded-2xl border border-line-2 bg-gradient-to-b from-ink-750 to-ink-850 p-4", className)}>
      {!bare && d.title && (
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
          <span className="label !text-fg">{d.title}</span>
        </div>
      )}
      <p className="max-w-[70ch] text-[13px] leading-relaxed text-mute">{d.what}</p>
      {d.formula && <FormulaBlock>{d.formula}</FormulaBlock>}
      {d.rows && d.rows.length > 0 && <FormulaRows rows={d.rows} />}
      {d.verdict && (
        <VerdictPanel tone={d.verdict.tone} className="text-[12.5px]">
          {d.verdict.text}
        </VerdictPanel>
      )}
    </div>
  );
}
