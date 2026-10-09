import { useMemo, useState } from "react";
import { disciplineDays, EMPTY, explainRecap, RECAP_MIN_TRADES, recap, TITLES, type RecapKind } from "@/domain/insights";
import { cn } from "@/lib/cn";
import { tradeTime } from "@/lib/dates";
import { date as fmtDate, pct0, signed } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { Badge } from "@/primitives/Badge";
import { EmptyState } from "@/primitives/EmptyState";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { useInsightsUi } from "./insightsStore";
import { InsightCard, SEG_TOUCH, Stat, openTrade, softTone, useInsightsBase } from "./ui";

const CHIP = "inline-flex min-h-9 items-center gap-2 rounded-full border border-line-2 px-3 text-[12px] text-mute hover:text-fg pointer-coarse:min-h-11";

const KINDS = [
  { v: "week" as const, label: "Woche" },
  { v: "month" as const, label: "Monat" },
];

/**
 * `Rückblick` (Tradezella weekly / monthly recap, in the app): current week or month (the previous one while the
 * current has fewer than 4 trades), one plain sentence, net, win rate, day win rate, Edge-Score change, Ø discipline,
 * best session, biggest leak; best / worst trade open the trade, the best day opens in the calendar.
 */
export function RecapCard() {
  const { view, settings, cur } = useInsightsBase();
  const notes = useJournal((s) => s.days);
  const focusDay = useInsightsUi((s) => s.focusDay);
  const [kind, setKind] = useState<RecapKind>("week");
  const [now] = useState(() => new Date());
  const days = useMemo(() => disciplineDays({ list: view.list, settings, notes }), [view.list, settings, notes]);
  const r = useMemo(() => recap({ closed: view.closed, start: view.start, setups: settings.setups, currency: cur, days }, kind, now), [view.closed, view.start, settings.setups, cur, days, kind, now]);
  const g = r.g;
  const period = r.range.offset === 0 ? (kind === "week" ? "diese Woche" : "dieser Monat") : kind === "week" ? "letzte Woche" : "letzter Monat";

  return (
    <InsightCard
      title={TITLES.recap}
      explain={explainRecap}
      note={g.n && !r.enough ? `vorläufig – ein Rückblick braucht ${RECAP_MIN_TRADES} Trades` : undefined}
      action={<Segmented<RecapKind> size="sm" aria-label="Zeitraum" options={KINDS} value={kind} onChange={setKind} className={SEG_TOUCH} />}
      data-testid="insights-recap"
    >
      {!g.n ? (
        <EmptyState title={EMPTY.recap.title} text={EMPTY.recap.text} />
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="mute">{r.range.label}</Badge>
              <span className="text-[11.5px] text-faint">{period}</span>
            </div>
            <p className="text-[15px] leading-snug text-fg">{r.sentence}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Netto" value={<MotionNumber value={g.net} signed suffix={` ${cur}`} tone="auto" countOnReveal />} sub={`${g.n} Trades`} />
            <Stat label="Win-Rate" value={pct0(g.winRate)} sub={`${g.wins} G · ${g.losses} V`} />
            <Stat label="Tage im Plus" value={pct0(r.dayWinRate)} sub={`${r.tradingDays} Handelstage`} />
            <Stat
              label="Edge-Score"
              value={r.edge == null ? "–" : String(r.edge)}
              sub={r.edgeDelta == null ? "–" : r.edgeDelta === 0 ? "±0 im Zeitraum" : `${signed(r.edgeDelta, 0)} im Zeitraum`}
            />
            <Stat label="Disziplin" value={r.discipline == null ? "–" : `${Math.round(r.discipline)} %`} sub="Ø Tagesscore" />
            <Stat label="Session" value={r.bestSession?.label ?? "–"} sub={r.bestSession ? `beste · ${signed(r.bestSession.g.net, 0)} ${cur}` : "beste ab 2 Trades"} />
            <Stat className="col-span-2" label="Größtes Leck" value={r.leak?.tag ?? "keins"} tone={r.leak ? "text-danger-text" : "text-win"} sub={r.leak ? `${signed(r.leak.excess, 0)} ${cur} gegenüber sauberen Trades` : "keine teuren Fehler"} />
          </div>
          <div className="flex flex-wrap gap-2">
            {g.best && (g.best.pnl ?? 0) > 0 && (
              <button type="button" onClick={() => openTrade(g.best!.id)} className={CHIP}>
                Bester Trade <span className={cn("num font-mono", softTone(g.best.pnl))}>{signed(g.best.pnl, 0)}</span>
                <span className="text-faint">{fmtDate(tradeTime(g.best))}</span>
              </button>
            )}
            {g.worst && (g.worst.pnl ?? 0) < 0 && (
              <button type="button" onClick={() => openTrade(g.worst!.id)} className={CHIP}>
                Schlechtester Trade <span className={cn("num font-mono", softTone(g.worst.pnl))}>{signed(g.worst.pnl, 0)}</span>
                <span className="text-faint">{fmtDate(tradeTime(g.worst))}</span>
              </button>
            )}
            {r.bestDay && (
              <button type="button" onClick={() => focusDay(r.bestDay!.key)} className={CHIP}>
                Bester Tag <span className="num font-mono text-win">{signed(r.bestDay.net, 0)}</span>
                <span className="text-faint">{fmtDate(new Date(r.bestDay.key + "T12:00"))}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </InsightCard>
  );
}
