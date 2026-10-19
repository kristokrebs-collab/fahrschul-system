/**
 * `Serien` (P05): the losing streak to expect at the trader's win rate over the next 100 trades (analytic) and from his
 * own results (Monte Carlo, P03 engine, seeded), against the current streak – as a row of dots: the expected streak
 * outlined, the current losses lit red, popping in one after the other (`spring.pop`, `stagger.reveal`). The headline
 * number cascades in (`NumberCascade`); the cost of such a streak at the chosen risk per trade is spelled out.
 */
import { motion } from "motion/react";
import { useRef } from "react";
import type { StreakRisk } from "@/domain/risk";
import { cn } from "@/lib/cn";
import { NumberCascade } from "@/motion/fx";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { useSeenOnce } from "@/primitives/revealValue";
import { RISIKO } from "./strings";
import { Metric, RiskCard, pct } from "./ui";

const S = RISIKO.streak;
const MAX_DOTS = 14;
const TONE = { "zu wenig": "mute", normal: "win", "erhöht": "warn", akut: "loss" } as const;

function Dots({ expected, p95, current }: { expected: number; p95: number; current: number }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const n = Math.min(MAX_DOTS, Math.max(expected, p95, current, 1));
  return (
    <div ref={ref} className="flex flex-wrap gap-1.5" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const lit = i < current;
        const inExp = i < expected;
        const inP95 = i < p95;
        return (
          <motion.span
            key={i}
            className={cn("size-3.5 rounded-full border", lit ? "border-loss bg-loss shadow-[0_0_8px_rgb(255_77_79/0.55)]" : inExp ? "border-white/55 bg-white/[0.08]" : inP95 ? "border-dashed border-white/30" : "border-white/10")}
            initial={reduced ? false : { scale: 0, opacity: 0 }}
            animate={seen || reduced ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
            transition={{ ...spring.pop, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.reveal }}
          />
        );
      })}
    </div>
  );
}

export function StreakCard({ sr, riskPct }: { sr: StreakRisk; riskPct: number }) {
  const exp = Math.round(sr.expected);
  const p95 = sr.mc?.p95 ?? exp;
  const curLoss = sr.current.kind === "loss" ? sr.current.length : 0;
  const few = sr.status === "zu wenig";
  return (
    <RiskCard title={S.title} note={S.note} action={<Badge tone={TONE[sr.status]}>{S.status[sr.status]}</Badge>} data-testid="risk-streak" data-status={sr.status} beam={sr.status === "akut" ? `streak:${curLoss}` : null}>
      {few ? (
        <p className="text-[12.5px] text-mute">{S.few}</p>
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="grid gap-1">
              <span className="label !text-[10px]">{S.expected}</span>
              <span className="dot-num text-[40px] leading-none">
                <NumberCascade value={exp} />
              </span>
            </div>
            <Metric label={S.mc} sub="Median · 95 %">
              {sr.mc ? `${sr.mc.p50} · ${sr.mc.p95}` : "–"}
            </Metric>
            <Metric label={S.current} tone={curLoss ? "text-loss" : "text-win"}>
              {sr.current.kind ? `${sr.current.length} ${sr.current.kind === "loss" ? "Verluste" : "Gewinne"}` : "–"}
            </Metric>
            <Metric label={S.longest}>{sr.longestLoss}</Metric>
          </div>
          <Dots expected={exp} p95={p95} current={curLoss} />
          <p className="text-[12px] text-mute">{S.dd(Math.max(exp, p95), pct(sr.ddP95 ?? sr.ddExpected))}</p>
          <p className="text-[11px] text-faint">Risiko pro Trade {pct(riskPct, 2)} · Trefferquote {pct(sr.winRate, 0)} · {sr.n} Trades</p>
        </div>
      )}
    </RiskCard>
  );
}
