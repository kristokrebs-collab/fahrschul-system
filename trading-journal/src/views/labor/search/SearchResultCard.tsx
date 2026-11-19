/**
 * The result of a search, factual: verdict (bestanden / verworfen) with the first failed criterion as the reason; after „bestanden“ the rule
 * card „Was machen wir wann?“ (entry, initial stop, when the stop moves, target / exit, size from the trader's OWN risk, „gilt nur, solange …“),
 * after „verworfen“ a plain „keine Regel zum Handeln“; the stop management of the winner against the other two (training = selection, final
 * test = comparison only); the drawdown risk and the best / worst case from resampling the winner's final-test trades (never a forecast);
 * training against final test, the rank among all variants, the multiple-test correction, the six criteria as fixed beforehand, what is needed
 * to repeat the search, and the legal line with the cost assumptions. A rejection is shown in plain ink, not in red (it is no loss); nothing here
 * celebrates.
 */
import { memo } from "react";
import { atrSeries } from "@/domain/backtest/bars";
import { CRITERIA_BY_FAMILY, ruleParts, sizeCandidate, STOP_NAME, STOP_RULES, type DatasetInfo, type SearchFamily, type SectionStats } from "@/domain/lab/search";
import { cn } from "@/lib/cn";
import { date, dateTime, n0, n2, price } from "@/lib/format";
import type { SearchSummary } from "./searchStore";
import { sourceNameOf, useSearch } from "./searchStore";
import { defaultAccount, useOwnRisk } from "./ownRisk";
import { SEARCH } from "./strings";
import { Kpi, numText, pctText, rText } from "../ui";

const de = (x: number, d = 2): string => x.toFixed(d).replace(".", ",").replace("-", "−");
const pTxt = (p: number | null): string => (p == null ? "–" : p < 0.001 ? "< 0,001" : de(p, 3));
const pct1 = (x: number): string => `${de(x * 100, 1)} %`;
const pEq = (p: number | null | undefined): string => (p == null ? "p = –" : p < 0.001 ? "p < 0,001" : `p = ${de(p, 3)}`);
const LABEL = "text-[10px] font-semibold uppercase tracking-[0.1em] text-faint";

function SectionKpis({ title, s, testId }: { title: string; s: SectionStats; testId: string }) {
  return (
    <div className="grid gap-2" data-testid={testId}>
      <span className={LABEL}>{title}</span>
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
      <figcaption className={LABEL}>{SEARCH.distTitle}</figcaption>
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

const P = SEARCH.plan;

/** „Was machen wir wann?“ – only after „bestanden“: the winner's rules as actions, the size from the trader's own risk, and what they rest on. */
function PlanCard({ summary }: { summary: SearchSummary }) {
  const w = summary.winner!;
  const wd = summary.datasets.find((d) => d.family === summary.winnerFamily);
  const acc = defaultAccount(wd?.interval);
  const own = useOwnRisk(acc);
  const { riskPct, capital, limits } = own;
  const bars = useSearch((s) => s.bars);
  const parts = ruleParts(w.variant, w.stop);
  // an example from the latest candles (trend family: the stop is k × ATR; the opening range's stop depends on the day's range)
  // (the React compiler memoises this; the card itself is `memo`)
  const example = (() => {
    const v = w.variant;
    if (v.family !== "trend" || bars.length < 20 || riskPct == null) return null;
    const last = bars[bars.length - 1]!;
    const atr = atrSeries(bars)[bars.length - 1] ?? 0;
    if (!(atr > 0)) return null;
    const dir = v.side === "long" ? 1 : -1;
    const stop = last.c - dir * v.stopAtr * atr;
    const sizing = sizeCandidate(
      { side: v.side, entry: last.c, stop, target: last.c + dir * v.stopAtr * atr * v.targetR, maxBars: v.maxBars, stopPct: ((v.stopAtr * atr) / last.c) * 100, targetR: v.targetR, stopAtr: v.stopAtr },
      { capital, riskPct, feePct: limits.feePct, slippagePct: limits.slippagePct, maxLeverage: limits.leverageRule[acc] ?? null },
    );
    return sizing.kind === "ok" ? { dist: v.stopAtr * atr, pct: (v.stopAtr * atr) / last.c, qty: sizing.sizing.qty, notional: sizing.sizing.notional } : null;
  })();
  const accName = acc === "scalp" ? "Konto Scalp" : "Konto Makro";
  const sizeText =
    own.riskPct == null
      ? P.sizeNeedRisk
      : own.capital == null || !(own.capital > 0)
        ? P.sizeNeedCapital
        : P.sizeOwn(`${n2(own.riskPct * 100)} %`, `${n0(own.capital)} USDT`, `${n0(own.capital * own.riskPct)} USDT`, accName);
  const ok = summary.verdict.checks.filter((c) => c.ok).length;
  const holds = P.holdsLines(w.oos.n, pEq(w.oos.pEdge), summary.deflation?.trials ?? 0, pEq(summary.deflation?.adjP), ok, summary.verdict.checks.length);
  return (
    <section className="grid gap-3 rounded-xl border border-line bg-ink-950/50 px-3 py-3" data-testid="search-plan" aria-label={P.title}>
      <div className="grid gap-1">
        <h3 className="text-[15px] font-semibold text-fg">{P.title}</h3>
        <p className="text-[11.5px] leading-snug text-faint">{P.note}</p>
      </div>
      <ul className="sx-plan">
        <li data-testid="search-plan-entry">
          <span>{P.entry}</span>
          <span>{parts.entry}</span>
        </li>
        <li data-testid="search-plan-stop">
          <span>{P.stop}</span>
          <span>{parts.stop}</span>
        </li>
        <li data-testid="search-plan-manage">
          <span>{P.manage}</span>
          <span>{parts.manage}</span>
        </li>
        <li data-testid="search-plan-exit">
          <span>{P.exit}</span>
          <span>{parts.exit}</span>
        </li>
        <li data-testid="search-plan-size">
          <span>{P.size}</span>
          <span>
            {sizeText}
            {example && <span className="mt-1 block text-[12px] text-mute">{P.sizeExample(price(example.dist), pct1(example.pct), n2(example.qty), n0(example.notional))}</span>}
          </span>
        </li>
        <li data-testid="search-plan-holds">
          <span>{P.holds}</span>
          <span>
            {holds.map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
            {wd && <span className="mt-1 block text-[12px] text-mute">{P.holdsMarket(wd.symbol, wd.interval === "1d" ? "1T" : wd.interval, date(new Date(wd.fromT)), date(new Date(wd.toT)))}</span>}
          </span>
        </li>
      </ul>
    </section>
  );
}

const S = SEARCH.stops;

/** „Wann ziehen wir den Stop nach?“ – the three stop rules of the winner's entry: training (part of the selection) and final test (comparison only). */
function StopPanel({ summary }: { summary: SearchSummary }) {
  const st = summary.winner!.stops;
  const ruleName = STOP_NAME[st.rule];
  const vsName = STOP_NAME[st.vs];
  const nums = st.diffAvgR == null || st.lo == null || st.hi == null || st.p == null ? null : ([rText(st.diffAvgR), rText(st.lo), rText(st.hi), pTxt(st.p)] as const);
  const line = !nums ? S.fewPairs : st.declared ? S.declared(ruleName, vsName, ...nums, st.pairs) : S.measured(ruleName, vsName, ...nums, st.pairs);
  const verdict = !nums ? null : st.declared ? null : summary.verdict.passed ? S.notProven : S.notPassed;
  const lines = STOP_RULES.map((r) => st.lines.find((l) => l.rule === r)!).filter(Boolean);
  return (
    <section className="grid content-start gap-2" data-testid="search-stops" data-rule={st.rule} data-declared={st.declared ? "true" : "false"} aria-label={S.title}>
      <span className={LABEL}>{S.title}</span>
      <p className="text-[12px] leading-snug text-faint">{S.lead}</p>
      <div className="overflow-x-auto">
        <table className="sx-table">
          <thead>
            <tr>
              <th scope="col">{S.rule}</th>
              <th scope="col">{S.training}</th>
              <th scope="col">{S.test}</th>
              <th scope="col">{S.testSum}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.rule} data-win={l.rule === st.rule ? "1" : "0"} data-testid={`search-stop-${l.rule}`}>
                <td>
                  {STOP_NAME[l.rule]}
                  {l.rule === st.rule && <span className="sr-only"> ({S.winner})</span>}
                </td>
                <td>{rText(l.isAvgR)}</td>
                <td>{rText(l.oosAvgR)}</td>
                <td>
                  {rText(l.oosSumR, 1)} · {l.oosN}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={cn("text-[12.5px] leading-snug", st.declared ? "text-fg" : "text-mute")} data-testid="search-stops-line">
        {line}
      </p>
      {verdict && <p className="text-[12px] leading-snug text-faint">{verdict}</p>}
    </section>
  );
}

const R = SEARCH.risk;

/** Drawdown risk and best / worst case from resampling the winner's final-test trades. */
function RiskPanel({ summary }: { summary: SearchSummary }) {
  const r = summary.winner!.risk;
  if (!r) {
    return (
      <section className="grid gap-1.5" data-testid="search-risk" aria-label={R.title}>
        <span className={LABEL}>{R.title}</span>
        <p className="text-[12.5px] text-mute">{R.none}</p>
      </section>
    );
  }
  return (
    <section className="grid content-start gap-2" data-testid="search-risk" data-n={r.n} aria-label={R.title}>
      <span className={LABEL}>{R.title}</span>
      <p className="text-[12px] leading-snug text-faint">{R.note(r.n, r.trades)}</p>
      <div className="sx-bars">
        <div className="sx-cell" data-testid="search-risk-actual">
          <span>{R.actual}</span>
          <b>−{numText(r.ddR, 1)} R</b>
          <small>−{pct1(r.ddPct)}</small>
        </div>
        <div className="sx-cell">
          <span>{R.typical}</span>
          <b>−{numText(r.ddRq.p50, 1)} R</b>
          <small>−{pct1(r.ddPctQ.p50)}</small>
        </div>
        <div className="sx-cell" data-testid="search-risk-p95">
          <span>{R.bad}</span>
          <b>−{numText(r.ddRq.p95, 1)} R</b>
          <small>−{pct1(r.ddPctQ.p95)}</small>
        </div>
      </div>
      <p className="text-[11.5px] text-faint">{R.pct(pct1(r.riskPct))}</p>
      <span className={cn(LABEL, "mt-1")}>
        {R.sumTitle} ({r.trades})
      </span>
      <div className="sx-bars" data-testid="search-risk-sum">
        <div className="sx-cell">
          <span>{R.worst}</span>
          <b>{rText(r.sumRq.p5, 1)}</b>
        </div>
        <div className="sx-cell">
          <span>{R.mid}</span>
          <b>{rText(r.sumRq.p50, 1)}</b>
        </div>
        <div className="sx-cell">
          <span>{R.best}</span>
          <b>{rText(r.sumRq.p95, 1)}</b>
        </div>
      </div>
      <p className="text-[12px] leading-snug text-mute">
        {R.pLoss(pct1(r.pLoss))}
        {r.trades < 15 ? ` ${R.few}` : ""}
      </p>
    </section>
  );
}

/** Memoised: a replay („Nochmal ansehen“) re-renders the section, never this long card. */
export const SearchResultCard = memo(function SearchResultCard({ summary, className }: { summary: SearchSummary; className?: string }) {
  const w = summary.winner;
  const passed = summary.verdict.passed;
  const family: SearchFamily | null = summary.winnerFamily;
  const needs = family ? CRITERIA_BY_FAMILY[family] : null;
  const demo = summary.datasets.some((d) => d.fixture);
  const c = summary.costs;
  return (
    <div className={cn("grid gap-4", className)} data-testid="search-result" data-passed={passed ? "true" : "false"}>
      <div className="grid gap-1.5">
        <span className={LABEL}>{SEARCH.verdictLabel}</span>
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

      {w && passed && <PlanCard summary={summary} />}
      {!passed && (
        <div className="grid gap-1 rounded-xl border border-line px-3 py-2.5" data-testid="search-plan-none">
          <b className="text-[13px] font-semibold text-fg">{P.none}</b>
          <p className="text-[12.5px] leading-snug text-mute">{P.noneWhy(summary.verdict.reason)}</p>
        </div>
      )}

      {w && (
        <>
          <div className="grid gap-1.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5">
            <span className={LABEL}>
              {SEARCH.winnerLabel} · {SEARCH.familyName[w.variant.family]} · Variante {w.variant.id + 1}
            </span>
            <p className="text-[13px] leading-relaxed text-fg" data-testid="search-winner-text">
              {w.text}
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <StopPanel summary={summary} />
            <RiskPanel summary={summary} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SectionKpis title={SEARCH.is} s={w.is} testId="search-is" />
            <SectionKpis title={SEARCH.oos} s={w.oos} testId="search-oos" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid content-start gap-1.5" data-testid="search-rank">
              <span className={LABEL}>{SEARCH.rankTitle}</span>
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
            {summary.verdict.checks.map((ch) => (
              <li key={ch.id} className="grid grid-cols-[1.25rem_1fr] gap-x-2 text-[12.5px] leading-snug" data-testid={`search-check-${ch.id}`} data-ok={ch.ok ? "true" : "false"}>
                <span aria-hidden="true" className={cn("text-center font-mono", ch.ok ? "text-win" : "text-warn")}>
                  {ch.ok ? "✓" : "×"}
                </span>
                <span>
                  <span className="text-fg">
                    {SEARCH.criteria[ch.id].label}
                    <span className="sr-only">{ch.ok ? " – erfüllt" : " – verfehlt"}</span>
                  </span>
                  <span className="num block text-[11.5px] text-faint">
                    {ch.value} · verlangt: {ch.need}
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

      <p className="text-[11.5px] leading-snug text-faint" data-testid="search-legal">
        {demo && (
          <b className="mr-1 font-semibold text-fg" data-testid="search-demo">
            {SEARCH.demo}.
          </b>
        )}
        {SEARCH.legal(`${de(c.takerBps / 100, 2)} %`, `${de(c.makerBps / 100, 2)} %`, c.slippage, c.funding)}
      </p>
    </div>
  );
});
