/**
 * Risk-of-Ruin card (P03): the chance to lose 30 % / 50 % of the account at a chosen risk per trade – simulated over
 * the next 500 trades from the trader's own R multiples (worker / idle chunks) as the headline (`NumberCascade`: the
 * digits rain and lock in), the analytic infinite-horizon value (Cramér-Lundberg) beside it, the trader's own median
 * risk per trade, Half-Kelly as the sane upper bound, and the ruin curve: how fast the risk tips when the stake grows
 * (analytic, bars growing staggered, the chosen stake marked, Half-Kelly as a dashed line).
 */
import { motion } from "motion/react";
import { useMemo, useRef } from "react";
import { aggregate } from "@/domain/agg";
import { CARD_TITLES, explainRuin, finite, median, riskPctOf, ROR_TRADES, ruinAnalytic, type RatioReport } from "@/domain/analytics";
import type { AccountView } from "@/domain/account";
import type { Settings } from "@/domain/types";
import { cn } from "@/lib/cn";
import { n1, pct } from "@/lib/format";
import { NumberCascade } from "@/motion/fx/NumberCascade";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { DotUnit } from "@/primitives/DotUnit";
import { EmptyState, progressLine } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { Segmented } from "@/primitives/Segmented";
import { useAnalyseUi } from "./analyseStore";
import { sampleKey, useRiskOfRuin } from "./hooks";
import { AnaCard, SEG_TOUCH, Stat } from "./ui";

/** A single ruin headline from fewer trades would read as a fact – below this the card says why it waits. */
export const ROR_MIN_TRADES = 20;
const RISKS = [0.005, 0.01, 0.02, 0.03] as const;
const RUINS = [0.3, 0.5] as const;
/** Stakes of the ruin curve. */
const CURVE = [0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05] as const;
const CURVE_H = 84;

const riskLabel = (f: number) => `${n1(f * 100).replace(",0", "")} %`;
const probText = (p: number | null) => (p == null ? "–" : p < 0.001 ? "< 0,1 %" : pct(p, false));

function RuinCurve({ winRate, payoff, ruinAt, risk, halfKelly }: { winRate: number; payoff: number; ruinAt: number; risk: number; halfKelly: number | null }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const values = CURVE.map((f) => ruinAnalytic(winRate, payoff, f, ruinAt) ?? 0);
  const near = CURVE.reduce((best, f, i) => (Math.abs(f - risk) < Math.abs(CURVE[best]! - risk) ? i : best), 0);
  const hk = halfKelly != null && halfKelly > 0 ? CURVE.findIndex((f) => f >= halfKelly) : -1;
  const on = seen || reduced;
  return (
    <div className="grid gap-1.5" data-testid="ror-curve">
      <span className="label">Ruin-Risiko je Einsatz · analytisch</span>
      <div ref={ref} className="relative grid items-end gap-1" style={{ height: CURVE_H, gridTemplateColumns: `repeat(${CURVE.length}, minmax(0, 1fr))` }} role="img" aria-label={`Ruin-Wahrscheinlichkeit je Risiko pro Trade: ${CURVE.map((f, i) => `${riskLabel(f)} ${probText(values[i]!)}`).join(", ")}`}>
        {values.map((v, i) => (
          <div key={i} className="relative h-full">
            <motion.span
              aria-hidden="true"
              className={cn("absolute inset-x-0 bottom-0 rounded-t-[3px]", i === near ? (v >= 0.05 ? "bg-loss" : v >= 0.01 ? "bg-warn" : "bg-win") : v >= 0.05 ? "bg-loss/35" : v >= 0.01 ? "bg-warn/35" : "bg-win/30")}
              style={{ height: `${Math.max(3, v * 100)}%`, originY: 1 }}
              initial={reduced ? false : { scaleY: 0 }}
              animate={{ scaleY: on ? 1 : 0 }}
              transition={{ ...spring.enter, delay: reduced ? 0 : i * stagger.reveal }}
            />
          </div>
        ))}
        {hk > 0 && (
          <span aria-hidden="true" className="absolute inset-y-0 border-l border-dashed border-white/40" style={{ left: `${(hk / CURVE.length) * 100}%` }}>
            <span className="absolute -top-0.5 left-1 whitespace-nowrap font-mono text-[9.5px] text-mute">½ Kelly</span>
          </span>
        )}
      </div>
      <div className="grid text-center font-mono text-[9.5px] text-faint" style={{ gridTemplateColumns: `repeat(${CURVE.length}, minmax(0, 1fr))` }} aria-hidden="true">
        {CURVE.map((f, i) => (
          <span key={f} className={cn(i === near && "text-fg", i % 2 === 1 && i !== near && "max-sm:invisible")}>
            {riskLabel(f).replace(" %", "")}
          </span>
        ))}
      </div>
    </div>
  );
}

export function RiskOfRuinCard({ view, settings, rep }: { view: AccountView; settings: Settings; rep: RatioReport }) {
  const chosen = useAnalyseUi((s) => s.rorRisk);
  const ruinAt = useAnalyseUi((s) => s.rorRuin);
  const set = useAnalyseUi((s) => s.set);
  const closed = view.closed;
  const g = useMemo(() => aggregate(closed), [closed]);
  const ownRaw = useMemo(() => median(finite(closed.map((t) => riskPctOf(t, { settings })))), [closed, settings]);
  const own = ownRaw != null && ownRaw > 0 && ownRaw < 0.5 ? ownRaw : null;
  // the own median snaps to a preset when it is one (1 % stays "1 %", not "Ø 1 %")
  const ownPreset = own != null ? (RISKS.find((r) => Math.abs(r - own) < 5e-4) ?? null) : null;
  const risk = chosen ?? ownPreset ?? own ?? 0.01;
  const rs = useMemo(() => finite(closed.map((t) => t.r)), [closed]);
  // the win / loss model in R when the trades carry R (the same base as the simulation), else in money (aggregate())
  const model = useMemo(() => {
    const up = rs.filter((r) => r > 0);
    const down = rs.filter((r) => r < 0);
    if (rs.length >= ROR_MIN_TRADES && up.length && down.length) {
      const avgUp = up.reduce((a, b) => a + b, 0) / up.length;
      const avgDown = -down.reduce((a, b) => a + b, 0) / down.length;
      return { winRate: up.length / (up.length + down.length), payoff: avgUp / avgDown, sample: rs };
    }
    const decisive = g.wins + g.losses;
    if (decisive && g.wins && g.payoff != null && g.payoff > 0) return { winRate: g.wins / decisive, payoff: g.payoff, sample: undefined };
    return null;
  }, [rs, g]);
  const enough = closed.length >= ROR_MIN_TRADES && model != null;
  const input = enough && model ? { winRate: model.winRate, payoff: model.payoff, riskPerTrade: risk, ruinAt, sample: model.sample } : null;
  const key = `${sampleKey(rs)}:${model ? `${model.winRate.toFixed(6)}:${model.payoff.toFixed(6)}` : "-"}:${risk}:${ruinAt}`;
  const run = useRiskOfRuin(input, { runs: 2000, trades: ROR_TRADES, seed: 1 }, key);
  const res = run.result;
  const sim = res?.simulated ?? null;
  const halfKelly = rep.metrics.halfKelly.value;
  const ownOption = own != null && ownPreset == null;
  const options = [...(ownOption ? [{ v: "own", label: `Ø ${riskLabel(own!)}` }] : []), ...RISKS.map((r) => ({ v: String(r), label: riskLabel(r) }))];
  const current = chosen != null ? String(chosen) : ownOption ? "own" : String(risk);
  return (
    <AnaCard
      title={CARD_TITLES.ruin}
      explain={() => explainRuin(res?.analytic ?? null, sim, risk, ruinAt, ROR_TRADES)}
      data-testid="ana-ror"
      note={enough ? `Verlust von ${Math.round(ruinAt * 100)} % des Kontos in den nächsten ${ROR_TRADES} Trades${own != null ? ` · dein Ø Risiko pro Trade: ${riskLabel(own)}` : ""}` : undefined}
    >
      {!enough ? (
        <EmptyState title="Noch keine Ruin-Rechnung" text={`Risk of Ruin braucht mindestens ${ROR_MIN_TRADES} abgeschlossene Trades mit Gewinnen und Verlusten – bisher ${closed.length}.`} line={progressLine(closed.length, ROR_MIN_TRADES)} />
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="label">Risiko pro Trade</span>
              <Segmented size="sm" aria-label="Risiko pro Trade" options={options} value={current} onChange={(v) => set({ rorRisk: v === "own" ? null : Number(v) })} className={SEG_TOUCH} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="label">Ruin ab</span>
              <Segmented<`${(typeof RUINS)[number]}`> size="sm" aria-label="Ruin ab" options={RUINS.map((r) => ({ v: `${r}` as const, label: `−${Math.round(r * 100)} %` }))} value={`${ruinAt}`} onChange={(v) => set({ rorRuin: Number(v) as 0.3 | 0.5 })} className={SEG_TOUCH} />
            </div>
          </div>
          <div className="grid justify-items-start gap-1" data-testid="ror-value" data-state={run.status}>
            <span className="label">Ruin-Wahrscheinlichkeit</span>
            <span className={cn("dot-num text-[clamp(44px,9vw,64px)] leading-none", sim == null ? "text-mute" : sim < 0.01 ? "text-win" : sim < 0.05 ? "text-warn" : "text-loss")}>
              {sim == null ? (
                "–"
              ) : (
                <>
                  {sim < 0.001 ? "< 0,1" : <NumberCascade value={sim * 100} decimals={1} />}
                  <DotUnit> %</DotUnit>
                </>
              )}
            </span>
            <span className="text-[12px] text-mute">simuliert mit {input?.sample ? `deinen ${rs.length} R-Werten` : "Win-Rate und Payoff"}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Analytisch" value={probText(res?.analytic ?? null)} sub="unendlich viele Trades" />
            <Stat label="Half-Kelly" value={halfKelly == null ? "–" : halfKelly <= 0 ? "keine Edge" : pct(halfKelly, false)} tone={halfKelly != null && halfKelly > 0 && risk > halfKelly ? "text-warn" : undefined} sub={halfKelly != null && halfKelly > 0 ? (risk > halfKelly ? "du riskierst mehr" : "Obergrenze") : "Obergrenze"} />
          </div>
          {model && <RuinCurve winRate={model.winRate} payoff={model.payoff} ruinAt={ruinAt} risk={risk} halfKelly={halfKelly} />}
        </div>
      )}
    </AnaCard>
  );
}
