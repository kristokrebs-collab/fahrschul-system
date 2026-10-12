/**
 * `Risiko je Strategie` (P05): risk per trade in % of the start capital, per strategy (setup) or asset – the mean as a
 * bar on a shared axis (grows on first view, staggered), ± one standard deviation as a whisker, the maximum as a tick,
 * the per-trade limit as a dashed red line, and the consistency. "Trade the best": the steadiest strategy (n ≥ 5) is
 * marked with `TactileHighlight`.
 */
import { motion } from "motion/react";
import { useMemo, useRef } from "react";
import { riskSpread, type RiskSpreadRow } from "@/domain/risk";
import type { EnrichedTrade, Settings } from "@/domain/types";
import { cn } from "@/lib/cn";
import { TactileHighlight } from "@/motion/pulse";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { EmptyState } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { Segmented } from "@/primitives/Segmented";
import { useRiskUi } from "./riskStore";
import { RISIKO } from "./strings";
import { RiskCard, SEG_TOUCH, pct } from "./ui";

const S = RISIKO.spread;
const BY_OPTS = [
  { v: "setup" as const, label: S.by.setup },
  { v: "asset" as const, label: S.by.asset },
];
const ROWS_MAX = 6;

function SpreadRow({ r, axis, limit, steadiest, index }: { r: RiskSpreadRow; axis: number; limit: number; steadiest: boolean; index: number }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLLIElement>(null);
  const seen = useSeenOnce(ref);
  const on = seen || reduced;
  const x = (v: number) => `${Math.min(100, (v / axis) * 100).toFixed(2)}%`;
  const delay = reduced ? 0 : Math.min(index, stagger.max) * stagger.reveal;
  const label = (
    <span className="flex min-w-0 items-center gap-1.5">
      {r.color && <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden="true" />}
      <span className="truncate">{r.label}</span>
    </span>
  );
  return (
    <li ref={ref} className="grid gap-1.5" data-testid="spread-row" data-key={r.key}>
      <div className="flex min-w-0 items-baseline justify-between gap-2 text-[12.5px] text-fg">
        {steadiest ? (
          <TactileHighlight playOnView tone="invert" className="min-w-0">
            {label}
          </TactileHighlight>
        ) : (
          label
        )}
        <span className="num shrink-0 font-mono text-[11px] text-mute">
          {S.mean} {pct(r.mean, 2)} · {S.max} {pct(r.max, 2)} · n {r.n}
        </span>
      </div>
      <span className="relative block h-3 rounded-full bg-white/[0.05]" aria-hidden="true">
        <motion.span
          className={cn("absolute inset-y-0 left-0 rounded-full", r.over ? "bg-warn/55" : "bg-white/40")}
          style={{ width: x(r.mean), originX: 0 }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: on ? 1 : 0 }}
          transition={{ ...spring.enter, delay }}
        />
        {r.n > 1 && r.sd > 0 && (
          <motion.span
            className="absolute top-1/2 h-px -translate-y-1/2 bg-white/70"
            style={{ left: x(Math.max(0, r.mean - r.sd)), width: `calc(${x(r.mean + r.sd)} - ${x(Math.max(0, r.mean - r.sd))})` }}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: on ? 1 : 0 }}
            transition={{ ...tween.fade, delay: delay + (reduced ? 0 : stagger.lead) }}
          />
        )}
        <span className="absolute inset-y-[-3px] w-0.5 rounded-full bg-fg" style={{ left: x(r.max) }} />
        <span className="absolute inset-y-[-4px] w-px border-l border-dashed border-signal" style={{ left: x(limit) }} />
      </span>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
        <span>
          {S.consistency} {Math.round(r.consistency * 100)} %
        </span>
        {steadiest && <Badge tone="win">{S.steadiest}</Badge>}
        {r.over > 0 && <Badge tone="warn">{S.over(r.over)}</Badge>}
      </div>
    </li>
  );
}

export function RiskSpreadCard({ closed, settings, limit }: { closed: readonly EnrichedTrade[]; settings: Settings; limit: number }) {
  const by = useRiskUi((s) => s.spreadBy);
  const setBy = useRiskUi((s) => s.setSpreadBy);
  const sp = useMemo(() => riskSpread(closed, settings, by, limit), [closed, settings, by, limit]);
  const rows = sp.rows.slice(0, ROWS_MAX);
  const axis = Math.max(limit * 1.25, ...rows.map((r) => r.max)) || 0.01;
  return (
    <RiskCard
      title={S.title}
      note={S.note}
      action={<Segmented<"setup" | "asset"> aria-label="Risiko gruppieren nach" options={BY_OPTS} value={by} onChange={setBy} size="sm" className={SEG_TOUCH} />}
      data-testid="risk-spread"
    >
      {!rows.length ? (
        <EmptyState title={S.empty} text={sp.missing ? S.missing(sp.missing) : "Trag Stop und Größe ein – dann siehst du, wie gleichmäßig du riskierst."} line={false} />
      ) : (
        <div className="grid gap-3">
          <ul className="grid gap-3.5">
            {rows.map((r, i) => (
              <SpreadRow key={`${by}:${r.key}`} r={r} axis={axis} limit={limit} steadiest={sp.steadiest === r.key} index={i} />
            ))}
          </ul>
          <p className="text-[11px] text-faint">
            Rote Linie: Grenze pro Trade {pct(limit, 1)}
            {sp.missing ? ` · ${S.missing(sp.missing)}` : ""}
          </p>
        </div>
      )}
    </RiskCard>
  );
}
