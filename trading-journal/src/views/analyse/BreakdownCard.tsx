/**
 * Breakdown card (P03): the closed trades by one of 22 dimensions (`MorphSelect`, router seam `#analyse?dim=`), every
 * bucket with n, win rate (Wilson), Ø R / Ø P&L with its 80 % interval as a whisker on a shared axis (growing out of
 * its centre, staggered) and its test against the rest after Benjamini-Hochberg. "Trade the best, fuck the rest":
 * the robust best bucket (highest LOWER bound) leads in a banner, marked with `TactileHighlight`; every "klar" row's
 * label gets the marker too. A row opens its trades.
 */
import { motion } from "motion/react";
import { useId, useMemo, useState } from "react";
import { ANA_EMPTY, breakdown, CARD_TITLES, DIMENSION_ORDER, DIMENSIONS, explainBreakdown, rowMean, type Breakdown, type BreakdownRow, type DimensionKey } from "@/domain/analytics";
import type { AccountView } from "@/domain/account";
import type { Settings } from "@/domain/types";
import { cn } from "@/lib/cn";
import { pct0 } from "@/lib/format";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { radius } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse } from "@/primitives/Expander";
import { useAnalyseUi } from "./analyseStore";
import { memoClosed } from "./hooks";
import { AnaCard, CiWhisker, SigBadge, TradeRows, ciText, unitText, whiskerDomain } from "./ui";

/** Rows shown before "Alle zeigen". */
export const BREAKDOWN_ROWS = 8;
const DIM_OPTIONS = DIMENSION_ORDER.map((k) => ({ value: k, label: DIMENSIONS[k].label, hint: DIMENSIONS[k].hint }));

/** Banner: the robust best and the bucket to avoid. */
function BestBanner({ b, cur }: { b: Breakdown; cur: string }) {
  if (!b.best && !b.worst) return null;
  const line = (r: BreakdownRow, tone: "win" | "loss") => {
    const m = rowMean(b, r);
    // only an interval entirely above / below zero earns the strong words
    const sure = !!m.ci && (tone === "win" ? m.ci.lo > 0 : m.ci.hi < 0);
    const title = tone === "win" ? (sure ? "Trade the best" : "Vorn · noch unsicher") : sure ? "Meiden" : "Hinten · noch unsicher";
    return (
      <div className={cn("grid gap-0.5 rounded-xl border px-3 py-2", !sure ? "border-line bg-ink-950/50" : tone === "win" ? "border-win/25 bg-win/[0.06]" : "border-loss/20 bg-loss/[0.05]")} data-sure={sure ? "true" : "false"}>
        <span className="label">{title}</span>
        <span className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
          <span className="font-semibold text-fg">
            {tone === "win" && sure ? (
              <TactileHighlight playOnView tab={false} padX={0.08}>
                {r.label}
              </TactileHighlight>
            ) : (
              r.label
            )}
          </span>
          <span className={cn("num font-mono text-[12.5px]", tone === "win" ? "text-win" : "text-loss")}>{unitText(m.mean, b.unit, cur, b.unit === "R" ? 2 : 0)}</span>
          <span className="num text-[11.5px] text-faint">
            80 %: {ciText(m.ci, b.unit, cur)} · {r.g.n} Trades
          </span>
        </span>
      </div>
    );
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="bd-banner">
      {b.best && line(b.best, "win")}
      {b.worst && line(b.worst, "loss")}
    </div>
  );
}

function Row({ b, r, i, domain, cur, open, onToggle }: { b: Breakdown; r: BreakdownRow; i: number; domain: [number, number]; cur: string; open: boolean; onToggle: () => void }) {
  const m = rowMean(b, r);
  const press = usePressable({ scale: 0.99 });
  const regionId = useId();
  const klar = r.test.verdict === "klar";
  return (
    <RevealItem as="li" className={cn("border-t border-line first:border-t-0", r.none && "opacity-70")} data-testid="bd-row" data-key={r.key} data-verdict={r.test.verdict}>
      <motion.button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={regionId}
        whileTap={press.whileTap}
        transition={press.transition}
        style={{ borderRadius: radius.hover }}
        className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-2 py-2 text-left hover:bg-white/[0.03] sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,9rem)_auto]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("min-w-0 truncate text-[13px]", r === b.best ? "font-semibold text-fg" : "text-fg")}>
            {klar ? (
              <TactileHighlight playOnView tab={false} padX={0.06} tone={m.mean != null && m.mean < 0 ? "signal" : "invert"}>
                {r.label}
              </TactileHighlight>
            ) : (
              r.label
            )}
          </span>
          <span className="num shrink-0 font-mono text-[10.5px] text-faint">{r.g.n}</span>
        </span>
        <SigBadge verdict={r.test.verdict} className="justify-self-end sm:order-last" />
        <CiWhisker ci={m.ci} value={m.mean} domain={domain} index={i} className="col-span-2 sm:col-span-1" />
        <span className="col-span-2 flex items-baseline justify-between gap-2 sm:col-span-1 sm:grid sm:justify-items-end sm:gap-0">
          <span className={cn("num font-mono text-[12.5px]", m.mean == null ? "text-mute" : m.mean > 0 ? "text-win" : m.mean < 0 ? "text-loss" : "text-fg")}>{unitText(m.mean, b.unit, cur, b.unit === "R" ? 2 : 0)}</span>
          <span className="num font-mono text-[10.5px] text-faint">WR {pct0(r.g.winRate)}</span>
        </span>
      </motion.button>
      <Collapse open={open} id={regionId}>
        <div className="px-1 pb-2">
          <TradeRows trades={[...r.trades].reverse().slice(0, 8)} group={`ana-bd-${b.dim}-${r.key}`} />
          {r.trades.length > 8 && <span className="px-2 text-[11px] text-faint">+{r.trades.length - 8} weitere</span>}
        </div>
      </Collapse>
    </RevealItem>
  );
}

export function BreakdownCard({ view, settings, cur }: { view: AccountView; settings: Settings; cur: string }) {
  const dim = useAnalyseUi((s) => s.dim);
  const set = useAnalyseUi((s) => s.set);
  const [all, setAll] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const b = useMemo(() => memoClosed(view.closed, `bd:${dim}:${settings.setups.length}:${settings.capital.makro}:${settings.capital.scalp}`, () => breakdown(view.closed, dim, { settings })), [view.closed, dim, settings]);
  const rows = all ? b.rows : b.rows.slice(0, BREAKDOWN_ROWS);
  const domain = useMemo(() => whiskerDomain(b.rows.map((r) => rowMean(b, r).ci), b.rows.map((r) => rowMean(b, r).mean)), [b]);
  return (
    <AnaCard
      title={CARD_TITLES.breakdown}
      explain={() => explainBreakdown(b, cur)}
      data-testid="ana-breakdown"
      note={`${b.unit === "R" ? "Ø R" : `Ø ${cur}`} mit 80-%-Intervall · jede Gruppe gegen den Rest getestet (FDR 10 %)`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <MorphSelect<DimensionKey>
          value={dim}
          onChange={(v) => {
            set({ dim: v });
            setOpenKey(null);
            setAll(false);
          }}
          options={DIM_OPTIONS}
          aria-label="Dimension"
          heading="Breakdown nach"
          size="sm"
          className="w-full sm:w-56"
          data-testid="bd-dim"
        />
        <span className="min-w-0 text-[11.5px] text-faint">{DIMENSIONS[dim].hint}</span>
      </div>
      {!b.rows.length || b.rows.every((r) => r.none) ? (
        <EmptyState title={ANA_EMPTY.breakdown.title} text={ANA_EMPTY.breakdown.text} />
      ) : (
        <div className="grid gap-3">
          <BestBanner b={b} cur={cur} />
          <RevealGroup as="ul" key={dim} className="grid" aria-label={`Breakdown nach ${b.label}`}>
            {rows.map((r, i) => (
              <Row key={r.key} b={b} r={r} i={i} domain={domain} cur={cur} open={openKey === r.key} onToggle={() => setOpenKey((k) => (k === r.key ? null : r.key))} />
            ))}
          </RevealGroup>
          {b.rows.length > BREAKDOWN_ROWS && (
            <button type="button" onClick={() => setAll((a) => !a)} className="touch-hit justify-self-start rounded-full border border-line-2 px-3 py-1 text-[12px] text-mute hover:text-fg">
              {all ? "Weniger zeigen" : `Alle ${b.rows.length} zeigen`}
            </button>
          )}
        </div>
      )}
    </AnaCard>
  );
}
