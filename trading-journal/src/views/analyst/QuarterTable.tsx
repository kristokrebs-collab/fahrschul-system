/**
 * The last quarters as a table (from `lg`) or as one card per quarter (below): revenue, margins, profit, EPS, free cash flow,
 * financial debt and share count, each with its change against the year before. A figure that was derived (not filed as a
 * single quarter) carries `*`, an approximate one `≈`; a missing one says "keine Daten" – never a dash that could be a zero.
 */
import type { AnalystResult, Cell, Comparison, Delta, QuarterRow } from "@/domain/analyst";
import { dateDe, levelText, money, perShare, pctText, pointsText, quarterLabel, shareCount, calendarLabel } from "@/domain/analyst";
import { DERIVATION_TEXT } from "@/domain/analyst/texts";
import { cn } from "@/lib/cn";
import { Badge } from "@/primitives/Badge";
import { Disclosure } from "./parts";
import { AN } from "./strings";

interface View {
  key: string;
  label: string;
  main: string | null;
  sub?: string | null;
  mark?: string;
  title?: string;
}

const mark = (...cells: (Cell | null | undefined)[]): { mark?: string; title?: string } => {
  const d = cells.find((c) => c && c.derived && c.derived !== "calc");
  const approx = cells.some((c) => c?.approx);
  if (!d) return {};
  return { mark: approx ? "≈*" : "*", title: `abgeleitet: ${DERIVATION_TEXT[d.derived as keyof typeof DERIVATION_TEXT]}${approx ? " – näherungsweise" : ""}` };
};

/** "+16,4 % zum Vorjahr", or why there is no percentage (a base of zero or below would mislead). */
const chg = (d: Delta | undefined, compact: boolean): string | null => (d ? (d.pct != null ? `${pctText(d.pct)}${compact ? "" : " zum Vorjahr"}` : compact ? "ohne %" : "Vorjahr null oder negativ: ohne Prozent") : null);

/** The figures of one quarter as label / value / change, in the order of the table. */
export function viewsOf(r: QuarterRow, c: Comparison, cur: string, compact = false): View[] {
  const yoy = c.yoy;
  const pts = (v: number | null): string | null => (v != null ? `${pointsText(v)}${compact ? "" : " zum Vorjahr"}` : null);
  return [
    { key: "revenue", label: "Umsatz", main: r.revenue ? money(r.revenue.value, cur) : null, sub: chg(yoy.revenue, compact), ...mark(r.revenue) },
    { key: "gross", label: "Bruttomarge", main: r.grossMargin != null ? levelText(r.grossMargin) : null, sub: pts(c.marginYoy.gross), ...mark(r.grossProfit, r.revenue) },
    { key: "op", label: "Operative Marge", main: r.operatingMargin != null ? levelText(r.operatingMargin) : null, sub: pts(c.marginYoy.operating), ...mark(r.operatingIncome, r.revenue) },
    { key: "netm", label: "Nettomarge", main: r.netMargin != null ? levelText(r.netMargin) : null, sub: pts(c.marginYoy.net), ...mark(r.netIncome, r.revenue) },
    { key: "net", label: "Nettoergebnis", main: r.netIncome ? money(r.netIncome.value, cur) : null, sub: chg(yoy.netIncome, compact), ...mark(r.netIncome) },
    { key: "eps", label: "EPS (verwässert)", main: r.epsDiluted ? perShare(r.epsDiluted.value, cur) : null, sub: chg(yoy.epsDiluted, compact), ...mark(r.epsDiluted) },
    { key: "fcf", label: "Freier Cashflow", main: r.freeCashFlow ? money(r.freeCashFlow.value, cur) : null, sub: chg(yoy.freeCashFlow, compact), ...mark(r.operatingCashFlow, r.capex) },
    { key: "debt", label: "Finanzschulden", main: r.debt ? money(r.debt.value, cur) : null, sub: r.netDebt != null ? (r.netDebt >= 0 ? `netto ${money(r.netDebt, cur)}` : `Nettoguthaben ${money(-r.netDebt, cur)}`) : null },
    { key: "shares", label: "Aktien (Ø, verwässert)", main: r.sharesDiluted ? shareCount(r.sharesDiluted.value) : null, sub: chg(yoy.sharesDiluted, compact) },
  ];
}

function Value({ v }: { v: View }) {
  return (
    <span title={v.title}>
      {v.main ? (
        <>
          <span className="num font-mono">{v.main}</span>
          {v.mark ? <span className="text-warn"> {v.mark}</span> : null}
        </>
      ) : (
        <span className="text-faint">{AN.noData}</span>
      )}
    </span>
  );
}

function Earnings({ r, newest, filingsMissing }: { r: QuarterRow; newest: boolean; filingsMissing: boolean }) {
  const f = r.earnings8k;
  if (!f) return <span className="text-faint">{filingsMissing ? AN.noData : AN.none8k}</span>;
  return (
    <a href={f.indexUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg" data-testid={newest ? "earnings-link-newest" : undefined}>
      {AN.earningsOf(dateDe(f.filed))}
    </a>
  );
}

export interface QuarterTableProps {
  result: AnalystResult;
  /** the filings list could not be read */
  filingsMissing: boolean;
  /** the press release of the newest earnings 8-K, when one was found */
  pressUrl: string | null;
  pressFiled: string | null;
}

const CARDS_SHOWN = 3;

function QuarterCard({ q, views, newest, filingsMissing, pressUrl, hasEarnings }: { q: QuarterRow; views: View[]; newest: boolean; filingsMissing: boolean; pressUrl: string | null; hasEarnings: boolean }) {
  return (
    <li className="grid gap-2.5 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid="analyst-card" data-end={q.end} data-derived={q.derived ? "1" : "0"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[14px] font-semibold">
          {quarterLabel(q)} <span className="num font-mono text-[12px] font-normal text-mute">bis {dateDe(q.end)}</span>
        </p>
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] text-faint">{calendarLabel(q.calendar)}</span>
          {q.derived ? <Badge tone="warn">abgeleitet *</Badge> : null}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {views.map((v) => (
          <div key={v.key} className="min-w-0" data-metric={v.key}>
            <dt className="text-[11px] text-mute">{v.label}</dt>
            <dd className="text-[13px]">
              <Value v={v} />
              {v.sub ? <span className="num block font-mono text-[11px] text-mute">{v.sub}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-[12px] text-mute">
        <Earnings r={q} newest={newest} filingsMissing={filingsMissing} />
        {newest && pressUrl && hasEarnings ? (
          <>
            {" · "}
            <a href={pressUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg" data-testid="press-link-m">
              {AN.pressRelease}
            </a>
          </>
        ) : null}
      </p>
    </li>
  );
}

export function QuarterTable({ result, filingsMissing, pressUrl, pressFiled }: QuarterTableProps) {
  const cur = result.currency;
  const rows = result.quarters.map((q, i) => ({ q, compact: viewsOf(q, result.comparisons[i]!, cur, true), full: viewsOf(q, result.comparisons[i]!, cur, false) }));
  const hasEarnings = (result.quarters[0]?.earnings8k ?? null) !== null;
  const head = rows.slice(0, CARDS_SHOWN);
  const tail = rows.slice(CARDS_SHOWN);
  const card = (r: (typeof rows)[number], i: number) => <QuarterCard key={r.q.end} q={r.q} views={r.full} newest={i === 0} filingsMissing={filingsMissing} pressUrl={pressUrl} hasEarnings={hasEarnings} />;
  return (
    <div className="grid gap-3" data-testid="analyst-quarters">
      {/* from lg: one table; the small line under a figure is the change against the same quarter a year earlier */}
      <div className="hidden lg:block">
        <table className="w-full border-separate border-spacing-0 text-left text-[12px]" data-testid="analyst-table">
          <caption className="sr-only">{AN.quartersTitle}</caption>
          <thead>
            <tr className="text-[10.5px] uppercase tracking-[0.08em] text-mute">
              <th scope="col" className="border-b border-line py-2 pr-3 font-semibold">Quartal</th>
              {rows[0]?.compact.map((v) => (
                <th key={v.key} scope="col" className="border-b border-line px-2 py-2 font-semibold">
                  {v.label}
                </th>
              ))}
              <th scope="col" className="border-b border-line py-2 pl-2 font-semibold">Meldung</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ q, compact }, i) => (
              <tr key={q.end} data-testid="analyst-row" data-end={q.end} data-derived={q.derived ? "1" : "0"} className={cn(i === 0 && "bg-white/[0.025]")}>
                <th scope="row" className="border-b border-line/60 py-2.5 pr-3 align-top font-normal">
                  <span className="block whitespace-nowrap font-semibold">{quarterLabel(q)}</span>
                  <span className="num block font-mono text-[11px] text-mute">{dateDe(q.end)}</span>
                  <span className="block whitespace-nowrap text-[11px] text-faint">{calendarLabel(q.calendar)}</span>
                </th>
                {compact.map((v) => (
                  <td key={v.key} className="border-b border-line/60 px-2 py-2.5 align-top" data-metric={v.key}>
                    <Value v={v} />
                    {v.sub ? <span className="num mt-0.5 block whitespace-nowrap font-mono text-[11px] text-mute">{v.sub}</span> : null}
                  </td>
                ))}
                <td className="border-b border-line/60 py-2.5 pl-2 align-top">
                  <Earnings r={q} newest={i === 0} filingsMissing={filingsMissing} />
                  {i === 0 && pressUrl && hasEarnings ? (
                    <a href={pressUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 block underline underline-offset-2 hover:text-fg" data-testid="press-link">
                      {AN.pressRelease}
                      {pressFiled ? ` (${dateDe(pressFiled)})` : ""}
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* below lg: one card per quarter, the older ones behind a disclosure */}
      <div className="grid gap-2.5 lg:hidden" data-testid="analyst-cards">
        <ul className="grid gap-2.5">{head.map((r, i) => card(r, i))}</ul>
        {tail.length > 0 && (
          <Disclosure title="Ältere Quartale" count={tail.length} testId="analyst-older">
            <ul className="grid gap-2.5">{tail.map((r, i) => card(r, i + CARDS_SHOWN))}</ul>
          </Disclosure>
        )}
      </div>
      <p className="text-[11.5px] leading-relaxed text-mute" data-testid="analyst-legend">
        <span className="hidden lg:inline">{AN.tableLegend} </span>
        {AN.derivedLegend}
      </p>
    </div>
  );
}
