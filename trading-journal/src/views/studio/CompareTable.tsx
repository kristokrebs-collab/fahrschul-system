/**
 * The comparison table of `compareStrategies` – one row per strategy: rank, trades, win rate, Ø R, profit factor, max
 * drawdown, the test window's own figures, the multiple-testing-adjusted p and the sample size. On a wide screen a real table,
 * on a phone one card per strategy (no sideways scrolling of the page). Shared by "Alle testen" and the version comparison.
 */
import { MIN_TEST_TRADES, type CompareResult, type CompareRow } from "@/domain/strategytext";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { numText, pctText, pfText, rText } from "@/views/labor/ui";
import { STUDIO } from "./strings";

const T = STUDIO.compare.table;

export interface RowLabel {
  name: string;
  /** "v2", "Entwurf" … */
  tag: string;
}

const pText = (p: number | null): string => (p == null ? T.none : p < 0.001 ? "< 0,001" : numText(p, 3));
const winText = (v: number | null | undefined): string => (v == null ? T.none : `${Math.round(v * 100)} %`);
const SAMPLE_TONE: Record<string, BadgeTone> = { none: "warn", tiny: "warn", small: "warn", ok: "mute", good: "mute" };

/** Ranked rows first (by rank), the rest in the order they were given. */
export function sortedRows(result: CompareResult): CompareRow[] {
  return [...result.rows].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
}

function testLine(r: CompareRow): string {
  const t = r.test;
  if (!t) return T.none;
  return `${T.testNote(t.n)} · Ø ${rText(t.avgR)}`;
}
function testLine2(r: CompareRow): string {
  const t = r.test;
  if (!t) return "";
  return `${winText(t.winRate)} · PF ${pfText(t.pf)} · DD ${pctText(-t.maxDD, 0, false)}`;
}

export function CompareTable({ result, labels }: { result: CompareResult; labels: Record<string, RowLabel> }) {
  const rows = sortedRows(result);
  const label = (r: CompareRow): RowLabel => labels[r.id] ?? { name: r.name, tag: "" };
  const thinTest = (r: CompareRow): boolean => r.test != null && r.test.n < MIN_TEST_TRADES;
  return (
    <>
      <div className="hidden overflow-x-auto md:block" data-testid="studio-cmp-table">
        <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-left text-[12.5px]">
          <caption className="sr-only">{STUDIO.compare.title}</caption>
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
              {[T.rank, T.name, T.trades, T.win, T.avgR, T.pf, T.dd, T.test, T.pAdj, T.sample].map((h, i) => (
                <th key={h} scope="col" className={cn("border-b border-line px-2 py-2 font-semibold", i >= 2 && i <= 6 && "text-right", i === 7 && "min-w-40")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const l = label(r);
              return (
                <tr key={r.id} data-testid={`studio-cmp-row-${r.id}`} data-rank={r.rank ?? undefined} data-status={r.status}>
                  <td className="border-b border-line px-2 py-2.5 font-mono text-[13px] text-fg">{r.rank ?? T.none}</td>
                  <td className="border-b border-line px-2 py-2.5">
                    <span className="block max-w-56 truncate font-medium text-fg">{l.name}</span>
                    {l.tag && <span className="font-mono text-[10.5px] text-faint">{l.tag}</span>}
                  </td>
                  {r.status === "ok" && r.all ? (
                    <>
                      <td className="num border-b border-line px-2 py-2.5 text-right font-mono">{r.all.n}</td>
                      <td className="num border-b border-line px-2 py-2.5 text-right font-mono">{winText(r.all.winRate)}</td>
                      <td className={cn("num border-b border-line px-2 py-2.5 text-right font-mono", (r.all.avgR ?? 0) > 0 ? "text-win" : (r.all.avgR ?? 0) < 0 ? "text-loss" : undefined)}>{rText(r.all.avgR)}</td>
                      <td className="num border-b border-line px-2 py-2.5 text-right font-mono">{pfText(r.all.pf)}</td>
                      <td className="num border-b border-line px-2 py-2.5 text-right font-mono">{pctText(-r.all.maxDD, 1, false)}</td>
                      <td className={cn("border-b border-line px-2 py-2.5", thinTest(r) && "text-faint")}>
                        <span className="num block font-mono">{testLine(r)}</span>
                        <span className="num block font-mono text-[11px] text-faint">{testLine2(r)}</span>
                      </td>
                      <td className="num border-b border-line px-2 py-2.5 font-mono">{pText(r.pAdj)}</td>
                      <td className="border-b border-line px-2 py-2.5">
                        <Badge tone={SAMPLE_TONE[r.sample] ?? "mute"}>{STUDIO.compare.sample[r.sample] ?? r.sample}</Badge>
                      </td>
                    </>
                  ) : (
                    <td colSpan={8} className="border-b border-line px-2 py-2.5 text-warn">
                      {r.reason ?? T.none}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ol className="grid gap-2 md:hidden" aria-label={STUDIO.compare.title} data-testid="studio-cmp-cards">
        {rows.map((r) => {
          const l = label(r);
          return (
            <li key={r.id} className="grid gap-2 rounded-xl border border-line bg-ink-950/50 p-3" data-testid={`studio-cmp-card-${r.id}`} data-rank={r.rank ?? undefined}>
              <div className="flex items-start gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line-2 font-mono text-[12px] text-fg">{r.rank ?? T.none}</span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg">{l.name}</span>
                  {l.tag && <span className="font-mono text-[10.5px] text-faint">{l.tag}</span>}
                </div>
                {r.status === "ok" && <Badge tone={SAMPLE_TONE[r.sample] ?? "mute"}>{STUDIO.compare.sample[r.sample] ?? r.sample}</Badge>}
              </div>
              {r.status === "ok" && r.all ? (
                <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-[12px]">
                  {(
                    [
                      [T.trades, String(r.all.n)],
                      [T.win, winText(r.all.winRate)],
                      [T.avgR, rText(r.all.avgR)],
                      [T.pf, pfText(r.all.pf)],
                      [T.dd, pctText(-r.all.maxDD, 1, false)],
                      [T.pAdj, pText(r.pAdj)],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="grid gap-0.5">
                      <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">{k}</dt>
                      <dd className="num font-mono text-fg">{v}</dd>
                    </div>
                  ))}
                  <div className="col-span-3 grid gap-0.5">
                    <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">{T.test}</dt>
                    <dd className={cn("num font-mono", thinTest(r) ? "text-faint" : "text-fg")}>
                      {testLine(r)}
                      {testLine2(r) && <span className="block text-[11px] text-faint">{testLine2(r)}</span>}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-[12.5px] text-warn">{r.reason ?? T.none}</p>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
