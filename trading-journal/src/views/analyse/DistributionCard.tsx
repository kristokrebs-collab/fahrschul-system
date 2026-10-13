/**
 * Distribution card (P03): histogram of the trade results in money or R (nice, zero-aligned bins; bars grow from the
 * base line, staggered, `spring.enter`), skew and excess kurtosis, Hampel outliers popping out above their bin with a
 * dashed ring (`spring.pop`), the key numbers WITHOUT the best 1 / 3 / 5 trades and the profit concentration.
 */
import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { aggregate } from "@/domain/agg";
import { CARD_TITLES, distributionReport, explainDistribution, type DistributionReport } from "@/domain/analytics";
import type { AccountView } from "@/domain/account";
import { cn } from "@/lib/cn";
import { n2, pct0, pf as fmtPf, signed } from "@/lib/format";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { EmptyState, progressLine } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { Segmented } from "@/primitives/Segmented";
import { memoClosed } from "./hooks";
import { AnaCard, SEG_TOUCH, Stat, softTone, unitText } from "./ui";

const H = 140;

function Histogram({ rep, cur }: { rep: DistributionReport; cur: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const max = Math.max(1, ...rep.bins.map((b) => b.n));
  const binOf = (v: number) => rep.bins.findIndex((b, i) => v >= b.lo && (v < b.hi || i === rep.bins.length - 1));
  const outliers = rep.outliers.slice(0, 6);
  const on = seen || reduced;
  const fmt = (v: number) => (rep.unit === "R" ? `${signed(v, 1)} R` : `${signed(v, 0)}`);
  const zeroBin = rep.bins.findIndex((b) => b.lo === 0);
  const zeroAt = zeroBin >= 0 ? zeroBin / rep.bins.length : -1;
  return (
    <div className="grid gap-1">
      <div ref={ref} className="relative grid items-end gap-[3px]" style={{ height: H, gridTemplateColumns: `repeat(${rep.bins.length}, minmax(0, 1fr))` }} role="img" aria-label={`Histogramm von ${rep.n} Trades, ${rep.outliers.length} Ausreißer`} data-testid="dist-hist">
        {rep.bins.map((b, i) => {
          const h = b.n / max;
          const pos = b.lo >= 0;
          return (
            <div key={i} className="relative h-full">
              <motion.span
                aria-hidden="true"
                className={cn("absolute inset-x-0 bottom-0 rounded-t-[3px]", pos ? "bg-win/70" : "bg-loss/70")}
                style={{ height: `${Math.max(b.n ? 3 : 0, h * 100)}%`, originY: 1 }}
                initial={reduced ? false : { scaleY: 0 }}
                animate={{ scaleY: on ? 1 : 0 }}
                transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.reveal }}
              />
            </div>
          );
        })}
        {outliers.map((o, k) => {
          const i = binOf(o.value);
          if (i < 0) return null;
          const b = rep.bins[i]!;
          return (
            <motion.span
              key={o.trade.id}
              aria-hidden="true"
              title={`${fmt(o.value)} · ${n2(Math.abs(o.z))} σ`}
              className="absolute grid size-6 place-items-center rounded-full border border-dashed border-signal/80"
              style={{ left: `${((i + 0.5) / rep.bins.length) * 100}%`, bottom: `${Math.min(88, (b.n / max) * 100 + 4)}%`, x: "-50%" }}
              initial={reduced ? false : { scale: 0, opacity: 0 }}
              animate={on ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ ...spring.pop, delay: reduced ? 0 : stagger.lead * 4 + k * stagger.reveal }}
            >
              <span className="size-1.5 rounded-full bg-signal" />
            </motion.span>
          );
        })}
      </div>
      <div className="relative h-3 font-mono text-[9.5px] text-faint" aria-hidden="true">
        <span className="absolute left-0">{fmt(rep.bins[0]?.lo ?? 0)}</span>
        {zeroAt > 0.08 && zeroAt < 0.92 && (
          <span className="absolute -translate-x-1/2" style={{ left: `${zeroAt * 100}%` }}>
            0
          </span>
        )}
        <span className="absolute right-0">{fmt(rep.bins[rep.bins.length - 1]?.hi ?? 0)}</span>
      </div>
      {rep.outliers.length > 0 && (
        <p className="text-[11.5px] text-mute">
          <span className="text-signal">◌</span> {rep.outliers.length} Ausreißer: {rep.outliers.slice(0, 4).map((o) => unitText(o.value, rep.unit, cur, rep.unit === "R" ? 2 : 0)).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** Share of the gross profit: best trade, next two, next two, everything else (one stacked bar). */
function Concentration({ rep }: { rep: DistributionReport }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const c = rep.concentration;
  if (c.top1 == null) return null;
  const parts = [
    { label: "Bester Trade", v: c.top1, cls: "bg-win" },
    { label: "Platz 2–3", v: c.top3 != null ? c.top3 - c.top1 : 0, cls: "bg-win/60" },
    { label: "Platz 4–5", v: c.top5 != null && c.top3 != null ? c.top5 - c.top3 : 0, cls: "bg-win/35" },
  ];
  const rest = Math.max(0, 1 - parts.reduce((s, p) => s + p.v, 0));
  let acc = 0;
  return (
    <div ref={ref} className="grid gap-1.5" data-testid="dist-concentration">
      <span className="label">Woher dein Gewinn kommt</span>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-white/[0.07]" role="img" aria-label={`Anteil am Bruttogewinn: bester Trade ${pct0(c.top1)}, Top 3 ${pct0(c.top3)}, Top 5 ${pct0(c.top5)}`}>
        {parts.map((p, i) => {
          const left = acc;
          acc += p.v;
          return (
            <motion.span
              key={p.label}
              aria-hidden="true"
              className={cn("absolute inset-y-0 origin-left", p.cls)}
              style={{ left: `${left * 100}%`, width: `${p.v * 100}%` }}
              initial={reduced ? false : { scaleX: 0 }}
              animate={{ scaleX: seen || reduced ? 1 : 0 }}
              transition={{ ...spring.enter, delay: reduced ? 0 : i * stagger.lead }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-mute">
        {parts.map((p) => (
          <span key={p.label}>
            {p.label} <span className="num font-mono text-fg">{pct0(p.v)}</span>
          </span>
        ))}
        <span>
          Rest <span className="num font-mono text-fg">{pct0(rest)}</span>
        </span>
      </div>
    </div>
  );
}

export function DistributionCard({ view, cur }: { view: AccountView; cur: string }) {
  const hasR = view.closed.filter((t) => t.r != null && Number.isFinite(t.r)).length >= 5;
  const [unitPick, setUnit] = useState<"money" | "R">("money");
  const unit = hasR ? unitPick : "money";
  const rep = useMemo(() => memoClosed(view.closed, `dist:${unit}`, () => distributionReport(view.closed, unit)), [view.closed, unit]);
  const g = useMemo(() => aggregate(view.closed), [view.closed]);
  const w3 = rep.withoutTop.find((x) => x.k === 3);
  return (
    <AnaCard
      title={CARD_TITLES.distribution}
      explain={() => explainDistribution(rep, cur)}
      data-testid="ana-dist"
      action={
        hasR ? (
          <Segmented<"money" | "R">
            size="sm"
            aria-label="Einheit"
            options={[
              { v: "money", label: cur },
              { v: "R", label: "R" },
            ]}
            value={unit}
            onChange={setUnit}
            className={SEG_TOUCH}
          />
        ) : undefined
      }
    >
      {rep.n < 5 ? (
        <EmptyState title="Noch zu wenig Trades" text="Die Verteilung braucht mindestens 5 abgeschlossene Trades." line={progressLine(rep.n, 5)} />
      ) : (
        <div className="grid gap-4">
          <Histogram key={unit} rep={rep} cur={cur} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Ø · Median" value={unitText(rep.mean, unit, cur, unit === "R" ? 2 : 0)} sub={`Median ${unitText(rep.median, unit, cur, unit === "R" ? 2 : 0)}`} tone={softTone(rep.mean)} />
            <Stat label="Schiefe" value={rep.skew == null ? "–" : n2(rep.skew)} sub={rep.skew == null ? "ab 3 Trades" : rep.skew > 0.3 ? "große Gewinne" : rep.skew < -0.3 ? "große Verluste" : "symmetrisch"} />
            <Stat label="Kurtosis" value={rep.kurt == null ? "–" : n2(rep.kurt)} sub={rep.kurt == null ? "ab 4 Trades" : rep.kurt > 1 ? "dicke Ränder" : "normale Ränder"} />
            <Stat label="Top 3 am Gewinn" value={rep.concentration.top3 == null ? "–" : pct0(rep.concentration.top3)} tone={rep.concentration.top3 != null && rep.concentration.top3 > 0.6 ? "text-warn" : undefined} sub="Anteil Bruttogewinn" />
          </div>
          <Concentration rep={rep} />
          {w3 && (
            <div className="grid gap-1.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5 text-[12.5px]" data-testid="dist-without">
              <span className="label">Ohne deine 3 besten Trades</span>
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="num font-mono">
                  Netto <span className={softTone(w3.g.net)}>{signed(w3.g.net, 0)}</span> <span className="text-faint">statt {signed(g.net, 0)}</span>
                </span>
                <span className="num font-mono">
                  PF {fmtPf(w3.g.pf)} <span className="text-faint">statt {fmtPf(g.pf)}</span>
                </span>
                <span className="num font-mono">
                  WR {pct0(w3.g.winRate)} <span className="text-faint">statt {pct0(g.winRate)}</span>
                </span>
              </span>
            </div>
          )}
        </div>
      )}
    </AnaCard>
  );
}
