/**
 * Weekday × time heatmap (P03): 7 × 12 cells (two-hour blocks, local time), coloured by Ø R / Ø P&L (green / red,
 * stronger = more), cascading in from the BEST cell (`HeatGridReveal`: Chebyshev rings, capped stagger, one signal
 * ring on the origin). A tap on a cell shows its numbers below (state of one line, not per cell).
 */
import { useMemo, useState } from "react";
import { CARD_TITLES, explainHeatmap, heatGrid, HEAT_DAYS, HEAT_HOURS, HEAT_MIN_N, type HeatCell } from "@/domain/analytics";
import type { AccountView } from "@/domain/account";
import { cn } from "@/lib/cn";
import { pct0 } from "@/lib/format";
import { HeatGridReveal, heatColor } from "@/motion/fx/HeatGridReveal";
import { EMPTY_LINE_CLOSED, EmptyState } from "@/primitives/EmptyState";
import { memoClosed } from "./hooks";
import { AnaCard, unitText } from "./ui";

const DAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"] as const;
const blockText = (b: number) => `${HEAT_HOURS[b]}–${String(b * 2 + 2).padStart(2, "0")} Uhr`;

export function HeatmapCard({ view, cur }: { view: AccountView; cur: string }) {
  const grid = useMemo(() => memoClosed(view.closed, "heat", () => heatGrid(view.closed)), [view.closed]);
  const [sel, setSel] = useState<number | null>(null);
  // trade the best: the three strongest cells with enough trades
  const top = useMemo(() => grid.cells.filter((c) => c.trades.length >= HEAT_MIN_N && c.value != null && c.value > 0).sort((a, b) => b.value! - a.value!).slice(0, 3), [grid]);
  const cell: HeatCell | null = sel != null ? (grid.cells[sel] ?? null) : grid.best;
  const label = (c: HeatCell) => `${DAY_NAMES[c.day]} ${blockText(c.block)}: ${c.trades.length ? `${c.trades.length === 1 ? "1 Trade" : `${c.trades.length} Trades`}, Ø ${unitText(c.value, grid.unit, cur, grid.unit === "R" ? 2 : 0)}, Win-Rate ${pct0(c.g.winRate)}` : "keine Trades"}`;
  return (
    <AnaCard title={CARD_TITLES.heatmap} explain={explainHeatmap} data-testid="ana-heat" note={`Ø ${grid.unit === "R" ? "R" : cur} pro Trade · Ortszeit · beste Zelle ab ${HEAT_MIN_N} Trades`}>
      {!view.closed.length ? (
        <EmptyState title="Noch keine Trades" text="Die Heatmap zeigt, zu welcher Zeit du gut handelst." line={EMPTY_LINE_CLOSED} />
      ) : (
        <div className="grid gap-3">
          <div className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-x-1.5 gap-y-1">
            <span aria-hidden="true" />
            <div className="grid grid-cols-12 text-center font-mono text-[9px] text-faint" aria-hidden="true">
              {HEAT_HOURS.map((h, i) => (
                <span key={h} className={cn(i % 2 === 1 && "max-sm:invisible")}>
                  {h}
                </span>
              ))}
            </div>
            <div className="grid grid-rows-7 gap-[3px] text-[10px] text-faint" aria-hidden="true">
              {HEAT_DAYS.map((d) => (
                <span key={d} className="flex items-center">
                  {d}
                </span>
              ))}
            </div>
            <HeatGridReveal cols={12} origin={grid.best?.i ?? 0} ring={!!grid.best} className="gap-[3px]" role="group" aria-label="Ergebnis nach Wochentag und Uhrzeit">
              {grid.cells.map((c) => {
                // fewer trades than the minimum → paler (an honest cell: one lucky trade is not a strong hour)
                const t = c.value == null || !grid.maxAbs ? 0 : (c.value / grid.maxAbs) * Math.min(1, c.trades.length / HEAT_MIN_N);
                const on = (sel ?? grid.best?.i) === c.i;
                return (
                  <button
                    key={c.i}
                    type="button"
                    aria-label={label(c)}
                    aria-pressed={on}
                    onClick={() => setSel(c.i)}
                    data-testid="heat-cell"
                    data-best={grid.best?.i === c.i ? "true" : undefined}
                    className={cn("relative aspect-square w-full rounded-[5px] outline-offset-1", on ? "outline outline-1 outline-white/70" : "outline-transparent")}
                    style={{ background: c.trades.length ? heatColor(t, "diverging") : "rgb(var(--veil-rgb, 255 255 255) / 0.025)" }}
                  >
                    {c.trades.length > 0 && c.trades.length < HEAT_MIN_N && <span aria-hidden="true" className="absolute right-[3px] top-[3px] size-[3px] rounded-full bg-white/40" />}
                  </button>
                );
              })}
            </HeatGridReveal>
          </div>
          <div className="min-h-[38px] rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-[12.5px]" data-testid="heat-detail">
            {cell ? (
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-semibold text-fg">
                  {DAY_NAMES[cell.day]} · {blockText(cell.block)}
                  {grid.best?.i === cell.i && <span className="ml-2 rounded-full bg-win/15 px-1.5 py-px text-[10.5px] font-medium text-win">beste Zelle</span>}
                </span>
                <span className="num font-mono text-mute">{cell.trades.length === 1 ? "1 Trade" : `${cell.trades.length} Trades`}</span>
                {cell.trades.length > 0 && (
                  <>
                    <span className="num font-mono text-mute">WR {pct0(cell.g.winRate)}</span>
                    <span className={cn("num font-mono", cell.value != null && cell.value > 0 ? "text-win" : cell.value != null && cell.value < 0 ? "text-loss" : "text-fg")}>Ø {unitText(cell.value, grid.unit, cur, grid.unit === "R" ? 2 : 0)}</span>
                  </>
                )}
              </span>
            ) : (
              <span className="text-faint">Noch keine Zelle mit {HEAT_MIN_N} Trades – tippe eine Zelle an.</span>
            )}
          </div>
          {top.length > 0 && (
            <div className="grid gap-1.5" data-testid="heat-top">
              <span className="label">Deine besten Zeiten</span>
              <ol className="grid gap-1">
                {top.map((c, i) => (
                  <li key={c.i} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="min-w-0 truncate">
                      <span className="num mr-2 font-mono text-faint">{i + 1}</span>
                      <span className="text-fg">{DAY_NAMES[c.day]}</span> <span className="text-mute">{blockText(c.block)}</span>
                    </span>
                    <span className="num shrink-0 font-mono text-win">
                      Ø {unitText(c.value, grid.unit, cur, grid.unit === "R" ? 2 : 0)} <span className="text-faint">· {c.trades.length}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {grid.worst && (
            <p className="text-[12px] text-mute">
              Schwächste Zeit: <span className="text-loss">{DAY_NAMES[grid.worst.day]} {blockText(grid.worst.block)}</span> ({grid.worst.trades.length} Trades, Ø {unitText(grid.worst.value, grid.unit, cur, grid.unit === "R" ? 2 : 0)})
            </p>
          )}
        </div>
      )}
    </AnaCard>
  );
}
