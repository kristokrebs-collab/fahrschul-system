import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import type { Agg } from "@/domain/agg";
import { cn } from "@/lib/cn";
import { colorClass, n2, pct0, pf as fmtPf, r as fmtR, signed } from "@/lib/format";
import { MorphCard } from "@/motion/MorphCard";
import { StaggerItem } from "@/motion/MorphDialog";
import { MotionNumber } from "@/motion/MotionNumber";
import { FormulaBlock, FormulaRows } from "@/primitives/FormulaBlock";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface KpiStripProps {
  /** Aggregate of the filtered closed trades (`aggregate(filtered.filter(t => t.result !== "open"))`). */
  closed: Agg;
  /** Total number of filtered trades incl. open ones. */
  count: number;
  currency: string;
  className?: string;
}

const OPEN_FROM = { opacity: 0, scale: 0.8 };
const OPEN_SHOWN = { opacity: 1, scale: 1 };
const OPEN_EXIT = { opacity: 0, scale: 0.8, transition: tween.exit };
const OPEN_TRANSITION = { scale: spring.pop, opacity: tween.fade };

/**
 * Small totals of the filtered set (NEW, Plan 6.2 KPI strip): `Netto`, `Trades`, `Win-Rate`.
 * Tiles blur-fade in one after another when the strip first shows (`RevealGroup`), the figures count up from 0 on
 * that first reveal, then roll between filter results; Netto and Win-Rate flash green/red by the direction of the
 * change (`MotionNumber flash`). All MotionValue-driven – no React render per frame. Reduced motion: static tiles,
 * instant values, no flash. Each tile is a morph source (`MorphCard`, tap / click / Enter): it opens how the figure
 * of THIS selection comes about (formula with the selection's numbers + the related figures) – nothing that looks
 * like a tile is dead on touch.
 */
export function KpiStrip({ closed, count, currency, className }: KpiStripProps) {
  const reduced = useReducedFx();
  const open = count - closed.n;
  return (
    <RevealGroup className={cn("mb-4 grid grid-cols-3 gap-2", className)} aria-label="Kennzahlen der Auswahl" role="group">
      <Tile id="kpi-net" label="Netto" title="Netto der Auswahl" body={() => <NetBody a={closed} currency={currency} />}>
        {closed.n ? <MotionNumber value={closed.net} decimals={2} signed tone="auto" flash countOnReveal revealKey="kpi-net" suffix={` ${currency}`} /> : <span className="text-faint">–</span>}
      </Tile>
      <Tile id="kpi-trades" label="Trades" title="Trades der Auswahl" body={() => <TradesBody a={closed} open={open} />}>
        <MotionNumber value={closed.n} decimals={0} countOnReveal revealKey="kpi-n" />
        <AnimatePresence initial={false}>
          {open > 0 && (
            <motion.span
              key="open"
              className="ml-1 inline-block origin-left text-xs text-mute"
              initial={reduced ? false : OPEN_FROM}
              animate={OPEN_SHOWN}
              exit={reduced ? undefined : OPEN_EXIT}
              transition={OPEN_TRANSITION}
            >
              +{open} offen
            </motion.span>
          )}
        </AnimatePresence>
      </Tile>
      <Tile id="kpi-wr" label="Win-Rate" title="Win-Rate der Auswahl" body={() => <WinRateBody a={closed} currency={currency} />}>
        {closed.winRate == null ? <span className="text-faint">–</span> : <MotionNumber value={closed.winRate * 100} decimals={0} suffix=" %" flash countOnReveal revealKey="kpi-wr" />}
      </Tile>
    </RevealGroup>
  );
}

function Tile({ id, label, title, body, children }: { id: string; label: string; title: string; body: () => ReactNode; children: ReactNode }) {
  return (
    <RevealItem className="min-w-0">
      <MorphCard id={id} title={title} body={body} borderRadius={12} className="h-full rounded-xl border border-line bg-ink-950/50 px-3 py-2 transition-colors hover:border-white/25">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</div>
        <div className="num mt-0.5 font-mono text-[14px] font-medium">{children}</div>
      </MorphCard>
    </RevealItem>
  );
}

const NOTE = "Nur die gefilterte Auswahl; offene Trades zählen erst mit dem Schließen.";

function NetBody({ a, currency }: { a: Agg; currency: string }) {
  return (
    <div className="grid gap-3">
      <StaggerItem>
        <FormulaBlock>
          Bruttogewinne {n2(a.gw)} − Bruttoverluste {n2(-a.gl)} = <span className={cn("font-semibold", colorClass(a.net))}>{`${signed(a.net)} ${currency}`}</span>
        </FormulaBlock>
      </StaggerItem>
      <StaggerItem>
        <FormulaRows
          rows={[
            ["Abgeschlossene Trades", String(a.n)],
            ["Gebühren", `${n2(a.fees)} ${currency}`],
            ["Profit-Faktor", fmtPf(a.pf)],
            ["Ø R", fmtR(a.avgR), colorClass(a.avgR)],
          ]}
        />
      </StaggerItem>
      <StaggerItem as="div" className="text-[12px] text-mute">
        {NOTE}
      </StaggerItem>
    </div>
  );
}

function TradesBody({ a, open }: { a: Agg; open: number }) {
  return (
    <div className="grid gap-3">
      <StaggerItem>
        <FormulaBlock>
          {a.wins} Gewinner + {a.losses} Verlierer + {a.be} Break-even = <span className="font-semibold">{a.n} abgeschlossen</span>
        </FormulaBlock>
      </StaggerItem>
      <StaggerItem>
        <FormulaRows
          rows={[
            ["Noch offen", String(Math.max(0, open))],
            ["Mit Stop (R berechenbar)", String(a.rN)],
            ["Mit ≥ 2 R", String(a.r2)],
          ]}
        />
      </StaggerItem>
      <StaggerItem as="div" className="text-[12px] text-mute">
        {NOTE}
      </StaggerItem>
    </div>
  );
}

function WinRateBody({ a, currency }: { a: Agg; currency: string }) {
  return (
    <div className="grid gap-3">
      <StaggerItem>
        <FormulaBlock>
          {a.wins} Gewinner ÷ {a.n} abgeschlossene Trades = <span className="font-semibold">{pct0(a.winRate)}</span>
        </FormulaBlock>
      </StaggerItem>
      <StaggerItem>
        <FormulaRows
          rows={[
            ["Ø Gewinn", a.avgWin == null ? "–" : `${signed(a.avgWin)} ${currency}`, colorClass(a.avgWin)],
            ["Ø Verlust", a.avgLoss == null ? "–" : `${signed(a.avgLoss)} ${currency}`, colorClass(a.avgLoss)],
            ["Gewinn/Verlust-Verhältnis", a.payoff == null ? "–" : n2(a.payoff)],
            ["Nötige Win-Rate (Break-even)", pct0(a.beWinRate)],
          ]}
        />
      </StaggerItem>
      <StaggerItem as="div" className="text-[12px] text-mute">
        {NOTE}
      </StaggerItem>
    </div>
  );
}
