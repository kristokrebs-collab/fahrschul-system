/**
 * Behaviour timeline (P04): every event of the detectors, newest first, grouped by day – severity dot, the behaviour,
 * the evidence line and the triggering trade (opens the trade detail). Filter chips per behaviour with their count
 * (only behaviours that occurred). Rows cascade in once (`RevealGroup` / `RevealItem`); 6 per page (the card sits beside
 * the plan and ends with its row – Reihen-Regel), "Ältere anzeigen" loads 6 more. Read-only: the journal is the source, nothing here is stored.
 */
import { useMemo, useState } from "react";
import { BEHAVIOR_LABEL, BEHAVIOR_ORDER, triggerOf, type BehaviorEvent, type BehaviorKey } from "@/domain/coach";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { localDateKey } from "@/lib/dates";
import { signed, time as fmtTime } from "@/lib/format";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { openTrade } from "@/views/insights/ui";
import { useCoachUi } from "./coachStore";
import { SeverityDot } from "./ui";

/** newest six first: the timeline sits beside the plan (~330 px) and ends with it; „Ältere anzeigen“ pages on */
const PAGE = 6;

const dayLabel = (key: string): string => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
};

export function TimelineCard({ events, trades, className }: { events: readonly BehaviorEvent[]; trades: ReadonlyMap<string, EnrichedTrade>; className?: string }) {
  const filter = useCoachUi((s) => s.timelineKey);
  const setFilter = useCoachUi((s) => s.setTimelineKey);
  const [limit, setLimit] = useState(PAGE);
  // events of the trades in this account view only
  const own = useMemo(() => events.filter((e) => trades.has(triggerOf(e))), [events, trades]);
  const counts = useMemo(() => {
    const m = new Map<BehaviorKey, number>();
    for (const e of own) m.set(e.key, (m.get(e.key) ?? 0) + 1);
    return BEHAVIOR_ORDER.filter((k) => m.has(k)).map((k) => [k, m.get(k)!] as const);
  }, [own]);
  const shown = useMemo(() => [...own].filter((e) => filter === "all" || e.key === filter).reverse(), [own, filter]);
  const page = shown.slice(0, limit);
  const days = useMemo(() => {
    const out: { key: string; items: BehaviorEvent[] }[] = [];
    for (const e of page) {
      const k = localDateKey(new Date(e.at));
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(e);
      else out.push({ key: k, items: [e] });
    }
    return out;
  }, [page]);

  return (
    <Card title="Timeline" note={own.length ? `${own.length} Muster erkannt · Regeln in jedem Eintrag` : undefined} className={className} data-testid="coach-timeline">
      {own.length === 0 ? (
        <EmptyState title="Keine Muster" text="Der Coach hat in diesem Konto kein Revenge, Tilt, Overtrading oder anderes Muster gefunden." line={false} />
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Nach Muster filtern">
            {[["all", own.length] as const, ...counts].map(([k, n]) => (
              <button
                key={k}
                type="button"
                aria-pressed={filter === k}
                onClick={() => {
                  setFilter(k);
                  setLimit(PAGE);
                }}
                className={cn("touch-hit inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors pointer-coarse:min-h-11", filter === k ? "border-fg/40 bg-white/[0.08] text-fg" : "border-line-2 text-mute hover:text-fg")}
              >
                {k === "all" ? "Alle" : BEHAVIOR_LABEL[k]}
                <span className="num font-mono text-faint">{n}</span>
              </button>
            ))}
          </div>
          <ol className="grid gap-4" aria-label="Erkannte Muster, neueste zuerst">
            {days.map((d) => (
              <li key={d.key} className="grid gap-1.5">
                <span className="label">{dayLabel(d.key)}</span>
                <RevealGroup as="ul" className="grid">
                  {d.items.map((e, i) => {
                    const t = trades.get(triggerOf(e));
                    return (
                      <RevealItem key={`${e.key}-${triggerOf(e)}-${i}`} as="li" className="border-b border-line/60 last:border-b-0">
                        <button type="button" onClick={() => openTrade(triggerOf(e))} className="grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-1.5 py-2 text-left hover:bg-white/[0.03]" data-testid="coach-timeline-row">
                          <SeverityDot severity={e.severity} />
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium text-fg">{BEHAVIOR_LABEL[e.key]}</span>
                            {e.note && <span className="block text-[11.5px] leading-snug text-mute [overflow-wrap:anywhere]">{e.note}</span>}
                          </span>
                          <span className="grid justify-items-end text-[11px]">
                            <span className="num font-mono text-faint">{fmtTime(new Date(e.at))}</span>
                            {t && t.result !== "open" && <span className={cn("num font-mono", (t.pnl ?? 0) >= 0 ? "text-win" : "text-loss")}>{signed(t.pnl, 0)}</span>}
                          </span>
                        </button>
                      </RevealItem>
                    );
                  })}
                </RevealGroup>
              </li>
            ))}
          </ol>
          {shown.length > limit && (
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="touch-hit justify-self-start text-[12px] text-mute hover:text-fg">
              Ältere anzeigen ({shown.length - limit})
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
