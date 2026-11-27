import type { ReactNode } from "react";
import type { Explanation, FormulaSegment } from "@/domain/explain";
import { cn } from "@/lib/cn";
import { Explainer, type ExplainerData } from "@/primitives/VerdictPanel";
import type { FormulaRow } from "@/primitives/FormulaBlock";

/** Renders `FormulaSegment[]` (bold part `font-semibold text-fg`, colour class, `br` → line break). */
export function formulaNode(f: FormulaSegment[] | undefined): ReactNode {
  if (!f || f.length === 0) return undefined;
  return f.map((s, i) => (
    <span key={i} className={cn(s.bold && "font-semibold text-fg", s.cls)}>
      {s.br && <br />}
      {s.text}
    </span>
  ));
}

/** `ExplainRow` (`[label, value, cls?, subline?]`) → `FormulaRow` with the optional source line under the label. */
export function toExplainerData(d: Explanation): ExplainerData {
  const rows: FormulaRow[] = d.rows.map((r) => {
    const [label, value, cls, sub] = r;
    const l = sub ? (
      <span className="grid">
        <span>{label}</span>
        <span className="text-[11px] text-faint">{sub}</span>
      </span>
    ) : (
      label
    );
    return [l, value, cls] as const;
  });
  return { title: d.sheetTitle ?? d.title, what: d.what, formula: formulaNode(d.formula), rows, verdict: d.verdict };
}

/** `Explanation` (domain) → `Explainer` (primitive). `bare` inside MorphDialogs. */
export function ExplanationView({ d, bare = false, className }: { d: Explanation; bare?: boolean; className?: string }) {
  return <Explainer d={toExplainerData(d)} bare={bare} className={className} />;
}
