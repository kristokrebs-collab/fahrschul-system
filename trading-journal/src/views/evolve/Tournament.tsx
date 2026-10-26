/**
 * The tournament: the current version and the proposals of every strategy side by side on their CONFIRMATION windows (the part
 * of the period no search ever used for a choice), ranked by Ø R × √Trades. It names the correction over ALL strategies and
 * variants and recommends nothing: a ranking of a handful of trades is mostly chance, and the text says so.
 */
import { cn } from "@/lib/cn";
import { Card } from "@/primitives/Card";
import { RANK_MIN_TRADES, type MultiResult } from "@/domain/evolve";
import { pctText, rText, toneOf } from "./fmt";
import { DISCLAIMER, EVOLVE } from "./strings";

const T = EVOLVE.tournament;

export function Tournament({ result }: { result: MultiResult }) {
  const rows = result.tournament;
  if (!rows.length) return null;
  const ranked = rows.filter((r) => r.rankValue != null);
  const multi = new Set(rows.map((r) => r.sid)).size > 1;
  const strategies = result.strategies.filter((s) => !s.error).length;
  return (
    <Card title={T.title} note={T.sub} data-testid="evolve-tournament">
      <div className="grid gap-3">
        {!multi && <p className="text-[12px] text-mute">{T.onlyOne}</p>}
        <div role="table" aria-label={T.title} className="grid gap-1.5 text-[12px]">
          <div role="row" className="hidden grid-cols-[2rem_minmax(0,1fr)_7rem_4rem_5rem_4rem] gap-2 px-3 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute sm:grid">
            <span role="columnheader">{T.cols.rank}</span>
            <span role="columnheader">{T.cols.who}</span>
            <span role="columnheader">{T.cols.version}</span>
            <span role="columnheader" className="text-right">{T.cols.trades}</span>
            <span role="columnheader" className="text-right">{T.cols.avgR}</span>
            <span role="columnheader" className="text-right">{T.cols.p}</span>
          </div>
          {rows.map((r) => (
            <div
              key={`${r.sid}:${r.proposalKey ?? "base"}`}
              role="row"
              data-testid="evolve-tournament-row"
              data-rank={r.rankValue != null ? ranked.indexOf(r) + 1 : ""}
              className={cn("flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2 sm:grid sm:grid-cols-[2rem_minmax(0,1fr)_7rem_4rem_5rem_4rem] sm:gap-x-2", r.proposalKey == null && "opacity-80")}
            >
              <span role="cell" className="num w-5 text-mute sm:w-auto">{r.rankValue != null ? ranked.indexOf(r) + 1 : "–"}</span>
              <span role="cell" className="min-w-0 flex-1 truncate font-medium sm:flex-none">{r.strategyName}</span>
              <span role="cell" className="text-mute">{r.label}</span>
              <span role="cell" className="num basis-full pl-8 text-mute sm:basis-auto sm:pl-0 sm:text-right">
                {r.n} Trades{r.rankValue == null ? ` · ${T.noRank}` : ""}
              </span>
              <span role="cell" className={cn("num sm:text-right", toneOf(r.avgR))}>{rText(r.avgR)}</span>
              <span role="cell" className="num text-mute sm:text-right">{r.p != null ? `Zufall ${pctText(r.p)}` : ""}</span>
            </div>
          ))}
        </div>
        {ranked.length === 0 || ranked.every((r) => r.n < RANK_MIN_TRADES * 2) ? <p className="text-[12px] text-warn">{T.few}</p> : null}
        <p className="text-[11.5px] leading-relaxed text-faint">{T.pNote(result.trialsRun, strategies, Math.round(result.trialsPrior))}</p>
        <p className="text-[11.5px] text-faint" data-testid="evolve-disclaimer">{DISCLAIMER}</p>
      </div>
    </Card>
  );
}
