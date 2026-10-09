import { motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import type { Explanation } from "@/domain/explain";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { tradeTime } from "@/lib/dates";
import { colorClass, date as fmtDate, signed, time as fmtTime } from "@/lib/format";
import { HoverPillFor, useHoverStore } from "@/motion/HoverPill";
import { radius } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { Card } from "@/primitives/Card";
import { Collapse, Expander } from "@/primitives/Expander";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { ExplanationView } from "@/views/overview/explainer";

/**
 * Detail source for trades opened from the Auswertung. `"insights"` is a detached source (`DETACHED_DETAIL_SOURCES`):
 * the recent-trades list drops its shared `trade-{id}` ids, so the detail enters on its own instead of flying out of
 * an unrelated row.
 */
export const DETAIL_SOURCE = "insights" as const;

/** Opens the trade detail dialog. */
export function openTrade(id: string): void {
  useUi.getState().openDetail(id, DETAIL_SOURCE);
}

/** Current account view + settings – every Auswertung card reads the Hero's Gesamt / Makro / Scalp switch. */
export function useInsightsBase() {
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const settings = useJournal((s) => s.settings);
  return { acc, view, settings, cur: settings.currency };
}

export interface InsightCardProps {
  title: string;
  /** subject of the info toggle (`Details zeigen: {label}`), default = title */
  label?: string;
  /** built lazily, only while the explainer is open */
  explain?: () => Explanation;
  action?: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  innerClassName?: string;
  className?: string;
  "data-testid"?: string;
}

/** Card with the overview's `+` info toggle that unfolds the explainer (same pattern as the checklist card). */
export function InsightCard({ title, label, explain, action, note, children, innerClassName, className, "data-testid": testId }: InsightCardProps) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <Card
      title={title}
      note={note}
      className={className}
      innerClassName={innerClassName}
      data-testid={testId}
      action={
        action || explain ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {action}
            {explain && <Expander open={open} onToggle={() => setOpen((o) => !o)} label={label ?? title} controls={regionId} className="touch-hit" />}
          </div>
        ) : undefined
      }
    >
      {explain && (
        <Collapse open={open} id={regionId} className="mb-4">
          {open && <ExplanationView d={explain()} className="!mt-0" />}
        </Collapse>
      )}
      {children}
    </Card>
  );
}

/** Small segmented-control classes: taller hit targets on coarse pointers. */
export const SEG_TOUCH = "pointer-coarse:[&>button]:min-h-11 pointer-coarse:[&>button]:min-w-11 pointer-coarse:[&>button]:justify-center";

/** Compact label/value tile. */
export function Stat({ label, value, sub, tone, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; className?: string }) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5", className)}>
      <span className="break-words text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{label}</span>
      <span className={cn("num truncate font-mono text-[15px] font-medium leading-tight", tone)}>{value}</span>
      {sub != null && <span className="num truncate text-[11px] text-faint">{sub}</span>}
    </div>
  );
}

const PRESS = 0.985;

/** One trade as a tappable row (date · time · side · account → P&L); opens the trade detail. */
export function TradeRows({ trades, group, extra, className, timeOnly = false }: { trades: readonly EnrichedTrade[]; group: string; extra?: (t: EnrichedTrade) => ReactNode; className?: string; timeOnly?: boolean }) {
  const hover = useHoverStore<string>();
  const press = usePressable({ scale: PRESS });
  return (
    <ul className={cn("grid", className)}>
      {trades.map((t, i) => (
        <li key={t.id} className={cn("relative", i > 0 && "border-t border-line")} {...hover.bind(t.id)}>
          <HoverPillFor store={hover} id={t.id} group={group} className="inset-y-0.5" />
          <motion.button
            type="button"
            onClick={() => openTrade(t.id)}
            whileTap={press.whileTap}
            transition={press.transition}
            style={{ borderRadius: radius.hover }}
            data-trade-id={t.id}
            className="relative z-10 grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-2 text-left"
          >
            <span className="flex min-w-0 items-center gap-2 text-[12.5px]">
              <span className="num shrink-0 font-mono text-[11px] text-mute">
                {timeOnly ? fmtTime(tradeTime(t)) : `${fmtDate(tradeTime(t))} ${fmtTime(tradeTime(t))}`}
              </span>
              <span className={cn("shrink-0 font-semibold uppercase tracking-wide text-[11px]", t.side === "short" ? "text-loss" : "text-win")}>{t.side === "short" ? "▼ Short" : "▲ Long"}</span>
              <span className="min-w-0 truncate text-faint">{extra ? extra(t) : t.account === "makro" ? "Makro" : "Scalp"}</span>
            </span>
            <span className={cn("num font-mono text-[13px]", t.result === "open" ? "text-mute" : colorClass(t.pnl))}>{t.result === "open" ? "offen" : signed(t.pnl, 0)}</span>
          </motion.button>
        </li>
      ))}
    </ul>
  );
}

/** Up to `max` trades, newest first, plus "+n weitere". */
export function TradeList({ trades, group, max = 8, extra }: { trades: readonly EnrichedTrade[]; group: string; max?: number; extra?: (t: EnrichedTrade) => ReactNode }) {
  const sorted = [...trades].sort((a, b) => +tradeTime(b) - +tradeTime(a));
  const shown = sorted.slice(0, max);
  return (
    <div className="grid gap-1">
      <TradeRows trades={shown} group={group} extra={extra} />
      {sorted.length > max && <span className="px-2 text-[11px] text-faint">+{sorted.length - max} weitere – alle in der Trades-Liste</span>}
    </div>
  );
}

/** Tone class of a P&L value (0 / null → mute instead of fg, for secondary numbers). */
export const softTone = (v: number | null | undefined): string => (v == null || v === 0 || !Number.isFinite(v) ? "text-mute" : v > 0 ? "text-win" : "text-loss");
