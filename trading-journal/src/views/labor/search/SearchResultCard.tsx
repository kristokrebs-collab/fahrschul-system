/**
 * The result of a search, factual: verdict (bestanden / verworfen) with the first failed criterion as the reason, the winner's rules, training
 * against final test, its rank among all variants in the final test with the distribution (the selection bias made visible), the
 * multiple-test correction, the six criteria as they were fixed beforehand, and what is needed to repeat the search (seed, model version,
 * data stand). A rejection is shown in plain ink, not in red (it is no loss); nothing here celebrates.
 */
import { CRITERIA_BY_FAMILY, type DatasetInfo, type SearchFamily, type SectionStats } from "@/domain/lab/search";
import { cn } from "@/lib/cn";
import { date, dateTime } from "@/lib/format";
import type { SearchSummary } from "./searchStore";
import { sourceNameOf } from "./searchStore";
import { SEARCH } from "./strings";
import { Kpi, numText, pctText, rText } from "../ui";

const de = (x: number, d = 2): string => x.toFixed(d).replace(".", ",").replace("-", "−");
const pTxt = (p: number | null): string => (p == null ? "–" : p < 0.001 ? "< 0,001" : de(p, 3));

function SectionKpis({ title, s, testId }: { title: string; s: SectionStats; testId: string }) {
  return (
    <div className="grid gap-2" data-testid={testId}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{title}</span>
      <div className="grid grid-cols-2 gap-2">
        <Kpi label={SEARCH.trades}>{s.n}</Kpi>
        <Kpi label={SEARCH.expectancy} tone={(s.avgR ?? 0) > 0 ? "text-win" : (s.avgR ?? 0) < 0 ? "text-loss" : undefined}>
          {rText(s.avgR)}
        </Kpi>
        <Kpi label={SEARCH.winRate}>{s.winRate == null ? "–" : pctText(s.winRate, 0, false)}</Kpi>
        <Kpi label={SEARCH.pLine}>{pTxt(s.pEdge)}</Kpi>
      </div>
      <p className="num text-[11px] text-faint">
        {SEARCH.maxDd} {numText(s.maxDdR, 1)} R · {SEARCH.cost} {s.avgCostR == null ? "–" : `${numText(s.avgCostR)} R`}
      </p>
    </div>
  );
}

function Distribution({ s }: { s: SearchSummary }) {
  const d = s.distribution;
  const w = s.winner?.oos.avgR;
  if (!d) return null;
  const max = Math.max(1, ...d.counts);
  const pos = w == null ? null : Math.max(0, Math.min(1, (w - d.min) / Math.max(1e-9, d.max - d.min)));
  const zero = Math.max(0, Math.min(1, (0 - d.min) / Math.max(1e-9, d.max - d.min)));
  const med = s.rank?.quantiles?.p50;
  return (
    <figure className="grid gap-1.5" data-testid="search-distribution" aria-label={SEARCH.distTitle}>
      <figcaption className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{SEARCH.distTitle}</figcaption>
      <div className="relative flex items-end gap-px" style={{ height: 64 }} aria-hidden="true">
        {d.counts.map((c, i) => (
          <span key={i} className="flex-1 rounded-t-sm bg-white/25" style={{ height: `${Math.max(3, (c / max) * 100)}%` }} />
        ))}
        {zero > 0 && zero < 1 && <span className="absolute inset-y-0 w-px bg-white/40" style={{ left: `${zero * 100}%` }} />}
        {pos != null && (
          <span className="absolute inset-y-0 w-0.5 bg-win" style={{ left: `calc(${pos * 100}% - 1px)` }}>
            <span className="absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-win" />
          </span>
        )}
      </div>
      <p className="num text-[11px] text-faint">
        {SEARCH.distWinner} {rText(w ?? null)} · {SEARCH.distNote(med == null ? "–" : rText(med), s.rank?.topTenMedianOos == null ? null : rText(s.rank.topTenMedianOos))}
      </p>
    </figure>
  );
}

function DatasetLine({ d }: { d: DatasetInfo }) {
  const at = (ms: number) => date(new Date(ms));
  return (
    <li className="num text-[11.5px] leading-snug text-faint" data-testid={`search-dataset-${d.family}`}>
      {SEARCH.familyName[d.family]}: {SEARCH.repro.data(d.symbol, d.interval === "1d" ? "1T" : d.interval, d.window, d.unit, at(d.fromT), at(d.toT), sourceNameOf(d.source))}
      {d.fixture ? ` · ${SEARCH.demo}` : ""}
    </li>
  );
}

export function SearchResultCard({ summary, className }: { summary: SearchSummary; className?: string }) {
  const w = summary.winner;
  const passed = summary.verdict.passed;
  const family: SearchFamily | null = summary.winnerFamily;
  const needs = family ? CRITERIA_BY_FAMILY[family] : null;
  const demo = summary.datasets.some((d) => d.fixture);
  return (
    <div className={cn("grid gap-4", className)} data-testid="search-result" data-passed={passed ? "true" : "false"}>
      <div className="grid gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{SEARCH.verdictLabel}</span>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <b className={cn("text-[24px] font-semibold leading-none tracking-tight", passed && "text-win")} data-testid="search-verdict">
            {passed ? SEARCH.passed : SEARCH.rejected}
          </b>
          <span className="text-[12px] text-mute">{SEARCH.passedSub}</span>
        </div>
        <p className="max-w-[68ch] text-[13px] leading-relaxed text-mute" data-testid="search-reason">
          {summary.verdict.reason}
        </p>
      </div>

      {w && (
        <>
          <div className="grid gap-1.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
              {SEARCH.winnerLabel} · {SEARCH.familyName[w.variant.family]} · Variante {w.variant.id + 1}
            </span>
            <p className="text-[13px] leading-relaxed text-fg" data-testid="search-winner-text">
              {w.text}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SectionKpis title={SEARCH.is} s={w.is} testId="search-is" />
            <SectionKpis title={SEARCH.oos} s={w.oos} testId="search-oos" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid content-start gap-1.5" data-testid="search-rank">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{SEARCH.rankTitle}</span>
              <p className="text-[13px] text-fg">{summary.rank?.rank != null ? SEARCH.rank(summary.rank.rank, summary.rank.of) : SEARCH.rankNone}</p>
              <p className="text-[11.5px] leading-snug text-faint">{SEARCH.rankSub}</p>
              <p className="text-[12.5px] font-medium text-fg">{SEARCH.bias}</p>
              {summary.deflation && (
                <p className="num text-[11.5px] leading-snug text-faint" data-testid="search-multi">
                  <span className="text-mute">{SEARCH.multiTitle}: </span>
                  {SEARCH.multi(`p = ${pTxt(summary.deflation.isP)}`, `p = ${pTxt(summary.deflation.adjP)}`, summary.deflation.trials)}
                </p>
              )}
            </div>
            <Distribution s={summary} />
          </div>
        </>
      )}

      {summary.verdict.checks.length > 0 && (
        <details className="rounded-xl border border-line px-3 py-2" data-testid="search-criteria">
          <summary className="touch-hit cursor-pointer text-[12.5px] font-medium text-fg">{SEARCH.criteriaTitle}</summary>
          <p className="mt-2 text-[12px] leading-snug text-faint">{SEARCH.criteriaLead}</p>
          <ul className="mt-2 grid gap-1.5">
            {summary.verdict.checks.map((c) => (
              <li key={c.id} className="grid grid-cols-[1.25rem_1fr] gap-x-2 text-[12.5px] leading-snug" data-testid={`search-check-${c.id}`} data-ok={c.ok ? "true" : "false"}>
                <span aria-hidden="true" className={cn("text-center font-mono", c.ok ? "text-win" : "text-warn")}>
                  {c.ok ? "✓" : "×"}
                </span>
                <span>
                  <span className="text-fg">
                    {SEARCH.criteria[c.id].label}
                    <span className="sr-only">{c.ok ? " – erfüllt" : " – verfehlt"}</span>
                  </span>
                  <span className="num block text-[11.5px] text-faint">
                    {c.value} · verlangt: {c.need}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {needs && family === "orb" && <p className="mt-2 text-[11.5px] leading-snug text-faint">Eröffnungs-Range: ein Trade je Tag, darum gelten ≥ {needs.minIsTrades} Trades im Training und ≥ {needs.minOosTrades} im Endtest.</p>}
        </details>
      )}

      <details className="rounded-xl border border-line px-3 py-2" data-testid="search-repro">
        <summary className="touch-hit cursor-pointer text-[12.5px] font-medium text-fg">{SEARCH.repro.title}</summary>
        <ul className="mt-2 grid gap-1">
          <li className="num text-[11.5px] text-faint" data-testid="search-seed">
            {SEARCH.repro.line(summary.seed, summary.model)}
          </li>
          {summary.datasets.map((d) => (
            <DatasetLine key={d.family} d={d} />
          ))}
          <li className="num text-[11.5px] text-faint">Stand der Suche: {dateTime(new Date(summary.at))}</li>
          <li className="text-[11.5px] text-faint">{SEARCH.repro.same}</li>
        </ul>
      </details>

      <p className="text-[11.5px] leading-snug text-faint">
        {demo && (
          <b className="mr-1 font-semibold text-fg" data-testid="search-demo">
            {SEARCH.demo}.
          </b>
        )}
        {SEARCH.disclaimer}
      </p>
    </div>
  );
}
