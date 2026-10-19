/**
 * Mood & result (P08): how mood, stress, energy and sleep (day check-ins) and stress / confidence in the trade (P06
 * psyche) go with the result. "Trade the best": only the clearest factor(s) with enough data are shown – each bucket
 * as a diverging bar (Ø R right green / left red) that grows from the zero line on first view, with n and the verdict.
 * Under the minimum sample the card says so honestly instead of guessing.
 */
import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { MIN_FACTOR_N, strongestFactors, type PsychFactor } from "@/domain/psych";
import { cn } from "@/lib/cn";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { EmptyState, progressLine } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { Segmented } from "@/primitives/Segmented";
import { WACHSTUM } from "./strings";
import { SEG_TOUCH } from "./ui";

const SHORT: Readonly<Record<PsychFactor["key"], string>> = { mood: "Stimmung", stress: "Stress", energy: "Energie", sleep: "Schlaf", tradeStress: "Trade-Stress", confidence: "Zuversicht" };

const fmt = (v: number | null, unit: "R" | "money", cur: string) => {
  if (v == null) return "–";
  const s = unit === "R" ? `${Math.abs(v).toFixed(2).replace(".", ",")} R` : `${Math.round(Math.abs(v)).toLocaleString("de-DE")} ${cur}`;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}`;
};

function FactorBars({ f, cur }: { f: PsychFactor; cur: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLUListElement>(null);
  const seen = useSeenOnce(ref);
  const max = Math.max(1e-9, ...f.buckets.map((b) => Math.abs(b.avg ?? 0)));
  return (
    <ul ref={ref} className="grid gap-1.5" data-testid="mood-buckets">
      {f.buckets.map((b, i) => {
        const v = b.avg ?? 0;
        const w = Math.abs(v) / max;
        const best = f.best === b;
        return (
          <li key={b.key} className="grid grid-cols-[84px_minmax(0,1fr)_108px] items-center gap-2 text-[11.5px]">
            <span className={cn("truncate", best ? "font-medium text-fg" : "text-mute")}>{b.label}</span>
            <span className="relative h-3.5 rounded-sm bg-white/[0.04]" role="img" aria-label={`${b.label}: Ø ${fmt(b.avg, f.unit, cur)}, ${b.n} ${f.scope === "day" ? "Tage" : "Trades"}`}>
              <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
              <motion.span
                aria-hidden="true"
                className={cn("absolute inset-y-0.5 rounded-[2px]", v >= 0 ? "left-1/2 origin-left bg-win/80" : "right-1/2 origin-right bg-loss/80")}
                style={{ width: `${w * 50}%` }}
                initial={reduced ? false : { scaleX: 0 }}
                animate={seen || reduced ? { scaleX: 1, transitionEnd: { transform: "none" } } : { scaleX: 0 }}
                transition={{ ...spring.enter, delay: reduced ? 0 : i * stagger.reveal }}
              />
            </span>
            <span className={cn("num whitespace-nowrap text-right font-mono", v > 0 ? "text-win" : v < 0 ? "text-loss" : "text-mute")}>
              {fmt(b.avg, f.unit, cur)} <span className="text-faint">· {b.n}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function MoodCard({ factors, cur, className }: { factors: readonly PsychFactor[]; cur: string; className?: string }) {
  const strong = useMemo(() => strongestFactors(factors, 3), [factors]);
  const [sel, setSel] = useState<string | null>(null);
  const f = strong.find((x) => x.key === sel) ?? strong[0] ?? null;
  const days = factors.find((x) => x.key === "mood")?.n ?? 0;
  const stressDays = factors.find((x) => x.key === "stress")?.n ?? 0;
  const covered = Math.max(days, stressDays);
  return (
    <Card
      title={WACHSTUM.psyche.mood}
      note={f ? `${f.scope === "day" ? "Je Tag" : "Je Trade"} · Ø ${f.unit === "R" ? "R" : cur} pro Trade` : undefined}
      action={strong.length > 1 ? <Segmented aria-label="Faktor" size="sm" className={SEG_TOUCH} options={strong.map((x) => ({ v: x.key, label: SHORT[x.key] }))} value={f?.key ?? null} onChange={setSel} /> : undefined}
      className={className}
      data-testid="growth-mood"
      data-factor={f?.key ?? ""}
    >
      {f ? (
        <div className="grid gap-3">
          <p className="text-[13px] leading-relaxed text-fg" data-testid="mood-verdict">
            {f.verdict}
          </p>
          <FactorBars f={f} cur={cur} />
          <p className="text-[10.5px] text-faint">Korrelation (Rang) ρ = {f.rho == null ? "–" : f.rho.toFixed(2).replace(".", ",").replace("-", "−")} · Muster, kein Beweis.</p>
        </div>
      ) : (
        // the whole card waits for check-ins → the empty state with the honest progress line („3 / 8 Tage“)
        <div className="flex flex-1 flex-col" data-testid="mood-empty">
          <EmptyState title={WACHSTUM.psyche.noFactorTitle} text={WACHSTUM.psyche.noFactor} line={progressLine(covered, MIN_FACTOR_N, "Tage")} className="flex-1" />
        </div>
      )}
    </Card>
  );
}
