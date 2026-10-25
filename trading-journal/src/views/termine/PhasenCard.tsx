/**
 * Karte „Ereignisphasen“ (F43, Strategiefilter): how the trades of the journal – or of the last backtest of this session –
 * behaved in the phases around appointments (0–2 h before / 0–4 h after Funding, expiry day, FOMC day, the first hour of the US
 * stock market, the weekend) against all other times. Per phase the sample (n), hit rate and Ø R inside and outside, the
 * difference with its 80 % interval, a verdict that respects the number of comparisons, and the reminder that this is an
 * observation of the past – no cause, no forecast. As a filter it can be tested in the Labor (Filtervergleich).
 */
import { useEffect, useMemo, useState } from "react";
import { analyzePhases, chanceNote, groupLine, phaseReading, toPhaseTrades, VERDICT_LABEL, type PhaseTrade } from "@/domain/events";
import { deviceTimeZone, wallStringToUtc } from "@/domain/events/zone";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { useEnriched } from "@/store/journalStore";
import { NO_ADVICE_TEXT } from "@/ui/AnalysisNote";
import { PHASEN as P } from "./strings";

type Source = "journal" | "backtest";

const VERDICT_TONE: Record<"klar" | "tendenz" | "offen" | "wenig", BadgeTone> = { klar: "steel", tendenz: "warn", offen: "mute", wenig: "mute" };

interface Backtest {
  label: string;
  trades: PhaseTrade[];
}

/** The last finished Labor run of this session – the Labor store is imported only when the trader asks for it. */
function useLastBacktest(enabled: boolean): { state: "off" | "loading" | "none" | "ok"; run: Backtest | null } {
  const [run, setRun] = useState<Backtest | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let off: (() => void) | undefined;
    let alive = true;
    void import("@/views/labor/laborStore").then(({ useLabor }) => {
      if (!alive) return;
      const read = (): void => {
        const r = useLabor.getState().result;
        setRun(
          r
            ? {
                label: `${r.name ?? r.strategy} · ${r.symbol} ${r.interval}`,
                trades: r.trades.map((t) => ({ id: t.id, at: t.entryTime, r: Number.isFinite(t.r) ? t.r : null, result: t.pnl > 0 ? "win" : t.pnl < 0 ? "loss" : "be" })),
              }
            : null,
        );
      };
      read();
      off = useLabor.subscribe(read);
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [enabled]);
  if (!enabled) return { state: "off", run: null };
  if (run === undefined) return { state: "loading", run: null };
  return run ? { state: "ok", run } : { state: "none", run: null };
}

export function PhasenCard() {
  const [source, setSource] = useState<Source>("journal");
  const enriched = useEnriched();
  const zone = deviceTimeZone();
  const bt = useLastBacktest(source === "backtest");

  const journal = useMemo(() => toPhaseTrades(enriched.filter((t) => t.result !== "open"), (wall) => wallStringToUtc(wall, zone)), [enriched, zone]);
  const trades = source === "journal" ? journal.trades : (bt.run?.trades ?? []);
  const report = useMemo(() => analyzePhases(trades), [trades]);
  const skipped = source === "journal" ? journal.skipped : 0;
  const empty = source === "journal" ? journal.trades.length === 0 : bt.state !== "ok" || trades.length === 0;
  const emptyText = source === "journal" ? P.noJournal : bt.state === "loading" ? "…" : P.noBacktest;

  return (
    <Card title={P.title} note={P.note} data-testid="phasen-card" data-source={source}>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <span id="phasen-src-l" className="label">
            {P.source}
          </span>
          <Segmented<Source> aria-labelledby="phasen-src-l" size="md" className="justify-self-start" value={source} onChange={setSource} options={[{ v: "journal", label: P.journal }, { v: "backtest", label: P.backtest }]} />
          {source === "backtest" && bt.run && (
            <p className="text-[12px] text-mute" data-testid="phasen-backtest-label">
              {bt.run.label}
            </p>
          )}
        </div>

        {empty ? (
          <p className="rounded-xl border border-line-2 bg-white/[0.03] px-3 py-2.5 text-[12.5px] leading-snug text-mute" data-testid="phasen-empty">
            {emptyText}
          </p>
        ) : (
          <>
            <p className="text-[12.5px] text-fg" data-testid="phasen-total">
              {P.total(groupLine(report.total))}
            </p>
            <ul className="grid gap-2.5" data-testid="phasen-list">
              {report.rows.map((row) => (
                <li key={row.def.id} className="grid gap-2 rounded-xl border border-line bg-ink-950/40 p-3" data-testid="phase-row" data-phase={row.def.id} data-verdict={row.verdict} data-n-inside={row.inside.n}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="text-[13px] font-semibold text-fg">{row.def.label}</h3>
                    <Badge tone={VERDICT_TONE[row.verdict]} title={VERDICT_LABEL[row.verdict]}>
                      {VERDICT_LABEL[row.verdict]}
                    </Badge>
                  </div>
                  <div className={cn("grid gap-2 sm:grid-cols-2", row.inside.n === 0 && "opacity-70")}>
                    <p className="grid gap-0.5 text-[12px] leading-snug">
                      <span className="text-faint">{P.inside}</span>
                      <span className="num text-fg" data-testid="phase-inside">
                        {groupLine(row.inside)}
                      </span>
                    </p>
                    <p className="grid gap-0.5 text-[12px] leading-snug">
                      <span className="text-faint">{P.outside}</span>
                      <span className="num text-fg" data-testid="phase-outside">
                        {groupLine(row.outside)}
                      </span>
                    </p>
                  </div>
                  <p className="text-[12px] leading-snug text-mute">{phaseReading(row)}</p>
                  <p className="text-[11px] leading-snug text-faint">
                    {P.rule}: {row.def.rule}
                    {row.unknown > 0 && ` ${P.unknown(row.unknown)}`}
                  </p>
                </li>
              ))}
            </ul>
            <p className="rounded-xl border border-line-2 bg-white/[0.03] px-3 py-2.5 text-[12px] leading-snug text-mute" role="note" data-testid="phasen-chance">
              {chanceNote(report)}
            </p>
            {source === "journal" && <p className="text-[11.5px] leading-snug text-faint">{P.zoneNote(zone)}</p>}
            {skipped > 0 && <p className="text-[11.5px] leading-snug text-faint">{P.skipped(skipped)}</p>}
            <p className="text-[11.5px] leading-snug text-faint">{P.labHint}</p>
          </>
        )}
        <p className="text-[12px] leading-relaxed text-mute">{NO_ADVICE_TEXT}</p>
      </div>
    </Card>
  );
}
