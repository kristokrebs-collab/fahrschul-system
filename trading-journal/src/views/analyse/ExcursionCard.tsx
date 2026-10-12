/**
 * MAE / MFE card (P03): scatter of how far each measured trade ran against you (MAE, x) and for you (MFE, y) in R –
 * winners green, losers red, the 1 R lines dashed; the dots pop in staggered on first view (`spring.pop`). Below:
 * exit efficiency as a ring (how much of the best move the winners kept), entry precision (Ø MAE in R), money left on
 * the table and losers that had been ≥ 1 R up, plus the stop hint ("80 % deiner Gewinner …").
 */
import { motion } from "motion/react";
import { useMemo, useRef } from "react";
import { ANA_EMPTY, CARD_TITLES, excursionReport, explainExcursion, EXCURSION_MIN_N, type ExcursionReport } from "@/domain/analytics";
import type { AccountView } from "@/domain/account";
import { cn } from "@/lib/cn";
import { n0, n2, pct0 } from "@/lib/format";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { EmptyState } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { RingGauge } from "@/primitives/RingGauge";
import { memoClosed } from "./hooks";
import { AnaCard, Stat } from "./ui";

const H = 200;

function Scatter({ rep }: { rep: ExcursionReport }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const maxX = Math.max(1.5, ...rep.points.map((p) => p.maeR)) * 1.08;
  const maxY = Math.max(2, ...rep.points.map((p) => p.mfeR)) * 1.08;
  const pts = rep.points.slice(-300);
  return (
    <div className="grid grid-cols-[1.4rem_minmax(0,1fr)] gap-x-1">
      <span className="self-center text-[10px] text-faint [writing-mode:vertical-rl] rotate-180" aria-hidden="true">
        MFE (R) ↑
      </span>
      <div className="grid gap-1">
        <div ref={ref} className="relative overflow-hidden rounded-xl border border-line bg-ink-950/60" style={{ height: H }} role="img" aria-label={`Streudiagramm MAE gegen MFE von ${rep.n} Trades`} data-testid="mae-scatter">
          {/* 1 R guides */}
          <span aria-hidden="true" className="absolute inset-y-0 border-l border-dashed border-white/15" style={{ left: `${(1 / maxX) * 100}%` }} />
          <span aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-white/15" style={{ bottom: `${(1 / maxY) * 100}%` }} />
          <span aria-hidden="true" className="absolute bottom-1 font-mono text-[9px] text-faint" style={{ left: `calc(${(1 / maxX) * 100}% + 4px)` }}>
            1 R
          </span>
          {pts.map((p, i) => (
            <motion.span
              key={p.id}
              aria-hidden="true"
              className={cn("absolute size-[7px] rounded-full", p.result === "win" ? "bg-win/80" : p.result === "loss" ? "bg-loss/80" : "bg-white/50")}
              style={{ left: `${(p.maeR / maxX) * 100}%`, bottom: `${(p.mfeR / maxY) * 100}%`, x: "-50%", y: "50%" }}
              initial={reduced ? false : { scale: 0, opacity: 0 }}
              animate={seen || reduced ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ ...spring.pop, delay: reduced ? 0 : Math.min(i, stagger.max * 3) * stagger.rows }}
            />
          ))}
        </div>
        <span className="text-right text-[10px] text-faint" aria-hidden="true">
          MAE (R) → gegen dich
        </span>
      </div>
    </div>
  );
}

export function ExcursionCard({ view, cur }: { view: AccountView; cur: string }) {
  const rep = useMemo(() => memoClosed(view.closed, "excursion", () => excursionReport(view.closed)), [view.closed]);
  const enough = rep.n >= EXCURSION_MIN_N;
  const eff = rep.exitEfficiency.mean;
  return (
    <AnaCard title={CARD_TITLES.excursion} explain={() => explainExcursion(rep, cur)} data-testid="ana-excursion" note={`${rep.n} von ${rep.total} Trades gemessen`}>
      {!enough ? (
        <EmptyState title={ANA_EMPTY.excursion.title} text={`${ANA_EMPTY.excursion.text} Bisher ${rep.n} von mindestens ${EXCURSION_MIN_N}.`} />
      ) : (
        <div className="grid gap-4">
          <Scatter rep={rep} />
          <div className="flex flex-wrap items-center gap-4">
            <RingGauge value={eff} size={92} stroke={8} color="#3ddc84" aria-label={`Exit-Effizienz ${pct0(eff)}`}>
              <span className="grid justify-items-center">
                <span className="dot-num text-[19px] leading-none">{pct0(eff)}</span>
                <span className="text-[9px] uppercase tracking-[0.1em] text-faint">Exit</span>
              </span>
            </RingGauge>
            <div className="grid min-w-[15rem] flex-1 grid-cols-2 gap-2">
              <Stat label="Entry: Ø MAE" value={rep.entryEfficiency.mean == null ? "–" : `${n2(rep.entryEfficiency.mean)} R`} sub="vom Stop genutzt" />
              <Stat label="Liegengelassen" value={`${n0(rep.leftOnTable.money)} ${cur}`} tone={rep.leftOnTable.money > 0 ? "text-warn" : undefined} sub={`${rep.leftOnTable.n} Gewinner`} />
            </div>
          </div>
          <div className="grid gap-1.5 text-[12.5px] leading-snug">
            {rep.winnerMaeP80 != null && (
              <p className="text-mute">
                80 % deiner Gewinner liefen nie mehr als <span className="font-semibold text-fg">{n2(rep.winnerMaeP80)} R</span> gegen dich.
              </p>
            )}
            {rep.mfeMedian != null && (
              <p className="text-mute">
                Die Hälfte deiner Trades lief mindestens <span className="font-semibold text-fg">{n2(rep.mfeMedian)} R</span> in deine Richtung.
              </p>
            )}
            {rep.givenBack.length > 0 && (
              <p className="text-mute">
                <span className="font-semibold text-loss">{rep.givenBack.length}</span> Verlierer waren vorher mindestens 1 R im Plus.
              </p>
            )}
          </div>
        </div>
      )}
    </AnaCard>
  );
}
