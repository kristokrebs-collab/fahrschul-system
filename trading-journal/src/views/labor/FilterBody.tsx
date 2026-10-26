/**
 * Varianten- und Filtervergleich (F17): switch optional filters on (RSI-Zone, höherer Trend, Retest – only what the data of
 * the run supports; Top-Trader and the rest stay locked WITH their reason) and run the same set-up with and without them.
 * The table shows each variant against the run without filters (trades, net R, hit rate), then the contribution of every
 * filter alone and on top of the others, with the reminder that contributions overlap.
 */
import { useMemo } from "react";
import type { HistInterval } from "@/domain/backtest/index";
import { activeFilters, filterInfos, FILTER_LIMITS, type FilterCompare, type FilterContribution, type FilterDelta, type FilterId, type FilterRow } from "@/domain/lab/filters";
import { cn } from "@/lib/cn";
import { Switch } from "@/motion/Switch";
import { Badge } from "@/primitives/Badge";
import { EventFilterRow } from "./EventFilter";
import { Block, countDelta, deltaTone, ppText, RunBar, ScrollTable, signedText, TH, THL } from "./ExtraParts";
import { cancelExtra, runFilters, useExtras } from "./extrasStore";
import { useLabor } from "./laborStore";
import { LABOR } from "./strings";
import { ChipPick, pctText, rText } from "./ui";

const X = LABOR.extras;
const F = X.filters;

const RSI_OPTIONS = [60, 65, 70, 75, 80].filter((v) => v >= FILTER_LIMITS.rsiLimit.min && v <= FILTER_LIMITS.rsiLimit.max);
const TREND_OPTIONS = [10, 20, 50].filter((v) => v >= FILTER_LIMITS.trendLen.min && v <= FILTER_LIMITS.trendLen.max);

export default function FilterBody() {
  const result = useLabor((s) => s.result);
  const slice = useExtras((s) => s.filters);
  const sel = useExtras((s) => s.selection);
  const interval = (result?.interval ?? "4h") as HistInterval;
  const strategy = result?.strategy ?? "custom";
  const infos = useMemo(() => filterInfos(strategy, interval, sel), [strategy, interval, sel]);
  const active = useMemo(() => activeFilters(sel, strategy, interval), [sel, strategy, interval]);
  if (!result) return null;
  const cmp = slice.status === "done" ? slice.result : null;
  return (
    <div className="grid gap-5" data-testid="labor-filters">
      <Block title={F.title} sub={F.note} id="labor-filter-choose">
        <ul className="grid gap-2.5" aria-label={F.choose}>
          {infos
            .filter((info) => info.id !== "event")
            .map((info) => (
            <FilterRowItem key={info.id} id={info.id} label={info.label} sub={info.sub} available={info.available} reason={info.reason} />
          ))}
          <EventFilterRow />
        </ul>
        {result.strategy === "custom" && <p className="text-[11.5px] leading-snug text-faint">{F.customNote}</p>}
        <RunBar slice={slice} onRun={() => void runFilters()} onCancel={() => cancelExtra("filters")} label="Vergleich rechnen" id="labor-filters" disabled={active.length === 0} disabledReason={F.none} hint={X.prepNote} />
      </Block>
      {cmp && <Result cmp={cmp} />}
    </div>
  );
}

function FilterRowItem({ id, label, sub, available, reason }: { id: FilterId; label: string; sub: string; available: boolean; reason: string | null }) {
  const sel = useExtras((s) => s.selection);
  const on = sel.on.includes(id) && available;
  const setOn = useExtras((s) => s.setFilterOn);
  const setParam = useExtras((s) => s.setFilterParam);
  return (
    <li className={cn("grid gap-2 rounded-xl border border-line bg-ink-950/50 p-3.5", !available && "opacity-80")} data-testid="labor-filter" data-filter={id} data-available={available ? "true" : "false"}>
      <div className="flex items-start gap-3">
        <Switch size="sm" checked={on} disabled={!available} onCheckedChange={(v) => setOn(id, v)} aria-label={label} aria-describedby={!available ? `labor-filter-why-${id}` : undefined} data-testid={`labor-filter-switch-${id}`} className="mt-0.5 shrink-0" />
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
            {label}
            {!available && <Badge tone="mute">{F.locked}</Badge>}
          </p>
          <p className="text-[12px] leading-snug text-faint">{sub}</p>
          {!available && reason && (
            <p id={`labor-filter-why-${id}`} className="text-[12px] leading-snug text-mute" data-testid="labor-filter-reason">
              {reason}
            </p>
          )}
        </div>
      </div>
      {on && id === "rsi" && (
        <div className="grid gap-1.5 pl-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{F.rsiLimit}</span>
          <ChipPick id="labor-filter-rsi" label={F.rsiLimit} value={sel.rsiLimit} options={RSI_OPTIONS.map((v) => ({ v, label: String(v) }))} onChange={(v) => setParam("rsiLimit", v)} />
        </div>
      )}
      {on && id === "trend" && (
        <div className="grid gap-1.5 pl-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{F.trendLen}</span>
          <ChipPick id="labor-filter-trend" label={F.trendLen} value={sel.trendLen} options={TREND_OPTIONS.map((v) => ({ v, label: String(v) }))} onChange={(v) => setParam("trendLen", v)} />
        </div>
      )}
    </li>
  );
}

function Result({ cmp }: { cmp: FilterCompare }) {
  const base = cmp.rows.find((r) => r.id === "base");
  const n = base?.stats?.n ?? 0;
  return (
    <>
      <Block title={F.table} sub={F.vsBase} id="labor-filter-result">
        <ScrollTable label={F.table} min="40rem" testId="labor-filter-table">
          <thead>
            <tr>
              <th className={THL}>{F.variant}</th>
              <th className={TH}>{F.trades}</th>
              <th className={TH}>{F.netR}</th>
              <th className={TH}>{F.dNetR}</th>
              <th className={TH}>{F.winRate}</th>
              <th className={TH}>{F.dWin}</th>
              <th className={TH}>{F.rejected}</th>
            </tr>
          </thead>
          <tbody>
            {cmp.rows.map((r) => (
              <VariantRow key={r.id} r={r} />
            ))}
          </tbody>
        </ScrollTable>
        {n < 20 && <p className="text-[11.5px] leading-snug text-faint">{F.few(n)}</p>}
      </Block>
      {cmp.contributions.length > 0 && (
        <Block title={F.contribution} sub={F.vsBase} id="labor-filter-contrib">
          <ScrollTable label={F.contribution} min="40rem" testId="labor-contrib-table">
            <thead>
              <tr>
                <th className={THL} rowSpan={2}>
                  Filter
                </th>
                <th className={cn(TH, "text-center")} colSpan={3}>
                  {F.alone}
                </th>
                <th className={cn(TH, "border-l border-line text-center")} colSpan={3}>
                  {F.marginal}
                </th>
              </tr>
              <tr>
                {[0, 1].flatMap((g) => [F.dTrades, F.dNetR, F.dWin].map((h) => (
                  <th key={`${g}${h}`} className={cn(TH, g === 1 && h === F.dTrades && "border-l border-line")}>
                    {h}
                  </th>
                )))}
              </tr>
            </thead>
            <tbody>
              {cmp.contributions.map((c) => (
                <ContribRow key={c.id} c={c} rows={cmp.rows} />
              ))}
            </tbody>
          </ScrollTable>
          <div className="grid gap-1 rounded-xl border border-line bg-ink-950/50 p-3.5" data-testid="labor-filter-overlap">
            <h4 className="text-[12.5px] font-semibold">{F.overlapTitle}</h4>
            <p className="text-[12px] leading-snug text-mute">{cmp.overlap ? F.overlap(cmp.overlap.blocked, cmp.overlap.multi) : F.overlapNone}</p>
          </div>
          <p className="text-[11.5px] leading-snug text-faint">{F.caution}</p>
        </Block>
      )}
    </>
  );
}

function VariantRow({ r }: { r: FilterRow }) {
  const s = r.stats;
  return (
    <tr className={cn("border-t border-line", r.id === "base" && "bg-white/[0.03]")} data-testid="labor-filter-row" data-variant={r.id}>
      <th scope="row" className="py-1.5 pr-2 text-left font-medium text-fg/90">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {r.label}
          {s && s.n < 10 && s.n > 0 && <Badge tone="warn">{F.thin}</Badge>}
        </span>
        {s && s.n === 0 && r.id !== "base" && <span className="block text-[11px] font-normal text-faint">{F.allBlocked}</span>}
        {s && r.id !== "base" && r.blocked === 0 && <span className="block text-[11px] font-normal text-faint">{F.noEffect}</span>}
      </th>
      {s ? (
        <>
          <td className="num py-1.5 text-right font-mono">{s.n}</td>
          <td className={cn("num py-1.5 text-right font-mono", s.sumR > 0 ? "text-win" : s.sumR < 0 ? "text-loss" : "")}>{rText(s.sumR)}</td>
          <td className={cn("num py-1.5 text-right font-mono", deltaTone(r.delta?.dSumR, true, 0.005))}>{r.delta ? signedText(r.delta.dSumR) : "–"}</td>
          <td className="num py-1.5 text-right font-mono">{pctText(s.winRate, 0, false)}</td>
          <td className={cn("num py-1.5 text-right font-mono", deltaTone(r.delta?.dWinRate, true, 0.005))}>{r.delta ? ppText(r.delta.dWinRate, 0) : "–"}</td>
          <td className="num py-1.5 text-right font-mono">{r.id === "base" ? "–" : F.rejectedOf(r.blocked, r.asked, r.unknown)}</td>
        </>
      ) : (
        <td colSpan={6} className="py-1.5 text-right text-faint">
          –
        </td>
      )}
    </tr>
  );
}

function Cells({ d, edge }: { d: FilterDelta | null; edge?: boolean }) {
  if (!d) {
    return (
      <td colSpan={3} className={cn("py-1.5 text-center text-[11.5px] text-faint", edge && "border-l border-line")}>
        {F.noMarginal}
      </td>
    );
  }
  return (
    <>
      <td className={cn("num py-1.5 text-right font-mono", edge && "border-l border-line")}>{countDelta(d.dN)}</td>
      <td className={cn("num py-1.5 text-right font-mono", deltaTone(d.dSumR, true, 0.005))}>{signedText(d.dSumR)}</td>
      <td className={cn("num py-1.5 text-right font-mono", deltaTone(d.dWinRate, true, 0.005))}>{ppText(d.dWinRate, 0)}</td>
    </>
  );
}

function ContribRow({ c, rows }: { c: FilterContribution; rows: FilterRow[] }) {
  const own = rows.find((r) => r.id === `only:${c.id}`);
  return (
    <tr className="border-t border-line" data-testid="labor-contrib-row" data-filter={c.id}>
      <th scope="row" className="py-1.5 pr-2 text-left font-medium text-fg/90">
        {c.label}
        {own && own.blocked === 0 && <span className="block text-[11px] font-normal text-faint">{F.noEffect}</span>}
      </th>
      <Cells d={c.alone} />
      <Cells d={c.marginal} edge />
    </tr>
  );
}
