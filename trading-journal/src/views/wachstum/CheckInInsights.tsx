/**
 * "Check-in und Handelstag" (F61): the daily check-in against what followed – how many trades, how many followed the plan,
 * the risk taken, the result in R and the quick re-entries. A correlation with its sample size (days, trades), explicitly
 * "keine Diagnose, keine Kausalität": only trades AFTER the check-in count, a skipped / late / missing check-in is left out
 * (and counted, so nothing is read as a good state), and under `MIN_CHECKIN_N` days a pair stays blank. Private: the data is
 * the trader's day journal and goes nowhere (no mentor, no community).
 */
import { useMemo } from "react";
import { BUILTIN_PREDICTORS, checkinConfigOf, correlationMatrix, deviceTimeZone, effectiveTimeZone, joinCheckins, MIN_CHECKIN_N, notableLines, OUTCOMES, type PredictorKey } from "@/domain/checkin";
import type { DayNotes, EnrichedTrade, Settings } from "@/domain/types";
import { cn } from "@/lib/cn";
import { Card } from "@/primitives/Card";
import { EmptyState, progressLine } from "@/primitives/EmptyState";
import { DAILY } from "./checkinStrings";

const I = DAILY.insights;
/** Column heads (the full names are the `title`s and the legend). */
const SHORT: Readonly<Record<string, string>> = { count: "Trades", adherence: "Plan", risk: "Risiko", result: "R", reentries: "Re-Entry" };
const rho = (v: number): string => v.toFixed(2).replace(".", ",").replace("-", "−");

export function CheckInInsights({ days, trades, settings, className }: { days: DayNotes; trades: readonly EnrichedTrade[]; settings: Settings; className?: string }) {
  const model = useMemo(() => {
    const config = checkinConfigOf(settings);
    const tz = effectiveTimeZone(config, deviceTimeZone());
    const joined = joinCheckins({ days, trades, tz, customIds: config.custom.map((q) => q.id) });
    const labels = new Map<PredictorKey, string>([...BUILTIN_PREDICTORS.map((p) => [p.key, p.label] as const), ...config.custom.map((q) => [`custom:${q.id}` as PredictorKey, q.label] as const)]);
    const predictors = [...labels.keys()].filter((k) => joined.rows.filter((r) => r.values[k] != null).length >= 3);
    const cells = correlationMatrix(joined.rows, predictors);
    const label = (p: PredictorKey) => labels.get(p) ?? p;
    return { joined, predictors, cells, label, lines: notableLines(cells, label) };
  }, [days, trades, settings]);
  const { stats } = model.joined;
  const enough = stats.used >= MIN_CHECKIN_N;
  const excluded = [
    stats.skipped > 0 && I.skipped(stats.skipped),
    stats.withoutCheckin > 0 && I.withoutCheckin(stats.withoutCheckin),
    stats.late > 0 && I.late(stats.late),
    stats.tradesFirst > 0 && I.tradesFirst(stats.tradesFirst),
    stats.noTrades > 0 && I.noTrades(stats.noTrades),
    stats.untimed > 0 && I.untimed(stats.untimed),
  ].filter((x): x is string => typeof x === "string");

  return (
    <Card title={I.title} note={I.note} className={className} data-testid="growth-checkin-insights" data-used={stats.used} data-trades={stats.trades}>
      <div className="grid gap-3.5">
        {stats.used === 0 ? (
          <div data-testid="insights-empty">
            <EmptyState title={I.none} text={I.onlyAfter} line={progressLine(0, MIN_CHECKIN_N, "Tage")} />
          </div>
        ) : (
          <>
            <p className="text-[13px]" data-testid="insights-sample">
              <span className="num font-mono font-semibold">{I.sample(stats.used, stats.trades)}</span> <span className="text-mute">· {I.onlyAfter}</span>
            </p>
            {!enough && (
              <p className="text-[12.5px] text-mute" data-testid="insights-too-little">
                {I.tooLittle(stats.used, MIN_CHECKIN_N)}
              </p>
            )}
            {enough && model.predictors.length > 0 && (
              <div className="grid gap-1.5" role="table" aria-label={I.matrix} data-testid="insights-matrix">
                <div role="row" className="grid grid-cols-[minmax(0,1.3fr)_repeat(5,minmax(0,1fr))] items-end gap-1 text-[10px] uppercase tracking-[0.08em] text-faint">
                  <span role="columnheader" className="sr-only">
                    Angabe
                  </span>
                  {OUTCOMES.map((o) => (
                    <abbr key={o.key} role="columnheader" title={o.label} className="text-right no-underline">
                      {SHORT[o.key]}
                    </abbr>
                  ))}
                </div>
                {model.predictors.map((p) => (
                  <div key={p} role="row" className="grid grid-cols-[minmax(0,1.3fr)_repeat(5,minmax(0,1fr))] items-center gap-1 text-[11.5px]" data-predictor={p}>
                    <span role="rowheader" className="truncate text-mute">
                      {model.label(p)}
                    </span>
                    {OUTCOMES.map((o) => {
                      const c = model.cells.find((x) => x.predictor === p && x.outcome === o.key);
                      const v = c?.rho ?? null;
                      return (
                        <span
                          key={o.key}
                          role="cell"
                          title={v == null ? `${model.label(p)} × ${o.label}: ${c?.n ?? 0} Tage – zu wenig Daten` : `${model.label(p)} × ${o.label}: ρ ${rho(v)}, ${c?.n} Tage`}
                          className={cn("num text-right font-mono", v == null ? "text-faint" : Math.abs(v) >= 0.3 ? "text-fg" : "text-mute")}
                        >
                          {v == null ? "–" : rho(v)}
                        </span>
                      );
                    })}
                  </div>
                ))}
                <p className="text-[10.5px] text-faint">Plan = Regelbefolgung · R = Ergebnis in R · Re-Entry = schnelle Wiedereinstiege (≤ 15 Min.). ρ = Rangkorrelation; – = unter {MIN_CHECKIN_N} Tage.</p>
              </div>
            )}
            {enough && model.lines.length > 0 && (
              <ul className="grid gap-1 text-[12.5px] leading-relaxed" data-testid="insights-lines">
                {model.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {excluded.length > 0 && (
          <p className="text-[11.5px] text-faint" data-testid="insights-excluded">
            {I.excluded}: {excluded.join(" · ")}.
          </p>
        )}
        <p className="text-[11.5px] font-medium text-mute" data-testid="insights-disclaimer">
          {I.disclaimer}
        </p>
      </div>
    </Card>
  );
}
