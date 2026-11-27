/**
 * The card every part of the demo sits in: a title, the mark „Beispiel – nicht deine Daten“ in the header (on EVERY card, so no
 * figure of the demo can be mistaken for the trader's own), the content, and a calm last line – the source of the candles where the
 * card uses them, and „Keine professionelle Finanzberatung.“.
 */
import type { ReactNode } from "react";
import { Badge } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { DEMO, DEMO_TAG } from "./strings";

export function DemoCard({ step, title, lead, children, candles = false, className }: { step: string; title: string; lead?: ReactNode; children: ReactNode; /** the card uses the example candles: name their source */ candles?: boolean; className?: string }) {
  return (
    <Card title={title} action={
        <span data-testid="demo-tag">
          <Badge tone="warn" dot>
            {DEMO_TAG}
          </Badge>
        </span>
      } data-testid="demo-card" data-step={step} className={className}>
      <div className="grid min-w-0 gap-4">
        {lead != null && <p className="max-w-[68ch] text-[13px] leading-relaxed text-mute">{lead}</p>}
        {children}
        <p className="max-w-[72ch] text-[11.5px] leading-relaxed text-mute" data-testid="demo-foot">
          {candles ? `${DEMO.sourceCandles}. ` : ""}
          {DEMO.noAdvice}
        </p>
      </div>
    </Card>
  );
}

/** A labelled number of a card: the label says what, the value is the figure, `sub` its interval or sample. */
export function Fig({ label, value, sub, tone, testId }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "win" | "loss"; testId?: string }) {
  return (
    <div className="grid min-w-0 content-start gap-1 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid={testId}>
      <span className="text-[10px] font-semibold uppercase leading-tight tracking-[0.08em] text-mute">{label}</span>
      <span className={`num font-mono text-[18px] font-medium leading-tight ${tone === "win" ? "text-win" : tone === "loss" ? "text-loss" : "text-fg"}`}>{value}</span>
      {sub != null && <span className="num text-[11px] leading-snug text-mute">{sub}</span>}
    </div>
  );
}
