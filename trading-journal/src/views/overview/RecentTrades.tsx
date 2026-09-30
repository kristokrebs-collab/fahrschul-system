import { motion } from "motion/react";
import { useMemo } from "react";
import { RESULT_LABELS, RESULT_TONES } from "@/domain/defaults";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { tradeTime } from "@/lib/dates";
import { colorClass, date as fmtDate, signed, time as fmtTime } from "@/lib/format";
import { HoverPill, useHoverGroup } from "@/motion/HoverPill";
import { radius, spring } from "@/motion/tokens";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { SetupChips } from "@/primitives/SetupChip";
import { useAccountView, useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";

export const RECENT_TITLE = "Letzte Trades";
export const RECENT_ALL = "Alle ansehen →";
export const RECENT_EMPTY_TITLE = "Noch keine Trades";
export const RECENT_EMPTY_TEXT = "Trag deinen ersten Trade ein. Alle Zahlen im Journal rechnen sich dann automatisch.";
export const RECENT_EMPTY_CTA = "Ersten Trade eintragen";
export const RECENT_COUNT = 6;

/**
 * `Letzte Trades` (Bundle `Ohe`, Plan 6.1): the 6 newest trades incl. open ones, hover pill `recent`, row =
 * `motion.button layoutId="trade-{id}"` (+ `trade-side-{id}`, `trade-pnl-{id}`) → `openDetail(id, "recent")`.
 * The shared ids are dropped while a detail opened from a chart marker is shown (Plan 3.3 rule "Quelle").
 */
export function RecentTrades() {
  const settings = useJournal((s) => s.settings);
  const acc = useUi((s) => s.acc);
  const detail = useUi((s) => s.detail);
  const openDetail = useUi((s) => s.openDetail);
  const openEditor = useUi((s) => s.openEditor);
  const view = useAccountView(acc);
  const rows = useMemo(() => [...view.list].sort((a, b) => +tradeTime(b) - +tradeTime(a)).slice(0, RECENT_COUNT), [view.list]);
  const hover = useHoverGroup<string>();
  const shareIds = detail.source !== "marker" && detail.source !== "table";

  const setupsOf = (t: EnrichedTrade) => (t.setups || []).map((id) => settings.setups.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => Boolean(s));

  return (
    <Card
      title={RECENT_TITLE}
      action={
        rows.length ? (
          <button type="button" onClick={() => navigate("trades")} className="label !text-fg hover:!text-signal">
            {RECENT_ALL}
          </button>
        ) : undefined
      }
    >
      {rows.length ? (
        <div className="grid">
          {rows.map((t, i) => (
            <div key={t.id} className={cn("relative", i > 0 && "border-t border-line")} {...hover.bind(t.id)}>
              <HoverPill show={hover.hovered === t.id} group="recent" className="inset-y-0.5" />
              <motion.button
                type="button"
                layoutId={shareIds ? `trade-${t.id}` : undefined}
                layoutDependency={t.id}
                transition={{ layout: spring.detail }}
                style={{ borderRadius: radius.hover }}
                onClick={() => openDetail(t.id, "recent")}
                className="relative z-10 grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2.5 text-left"
              >
                <span className="num font-mono text-[11px] leading-tight text-mute">
                  {fmtDate(tradeTime(t))}
                  <br />
                  {fmtTime(tradeTime(t))}
                </span>
                <span className="grid min-w-0 gap-1">
                  <span className="flex items-center gap-2 text-xs">
                    <motion.span layoutId={shareIds ? `trade-side-${t.id}` : undefined} layout="position" className={cn("font-semibold uppercase tracking-wide", t.side === "short" ? "text-loss" : "text-win")}>
                      {t.side === "short" ? "▼ Short" : "▲ Long"}
                    </motion.span>
                    <span className="text-faint">{t.account === "makro" ? "Makro" : "Scalp"}</span>
                  </span>
                  <SetupChips items={setupsOf(t)} />
                </span>
                <span className="grid justify-items-end gap-1">
                  <motion.span layoutId={shareIds ? `trade-pnl-${t.id}` : undefined} layout="position" className={cn("num font-mono text-[13.5px] font-medium", colorClass(t.pnl))}>
                    {t.pnl == null ? "–" : signed(t.pnl)}
                  </motion.span>
                  <Badge tone={RESULT_TONES[t.result]}>{RESULT_LABELS[t.result]}</Badge>
                </span>
              </motion.button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title={RECENT_EMPTY_TITLE}
          text={RECENT_EMPTY_TEXT}
          action={
            <Button variant="primary" size="sm" className="mt-2" onClick={() => openEditor()}>
              {RECENT_EMPTY_CTA}
            </Button>
          }
        />
      )}
    </Card>
  );
}
