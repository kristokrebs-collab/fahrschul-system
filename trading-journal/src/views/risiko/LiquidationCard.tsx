/**
 * `Liquidation` (P05): the calculator's planned position and every open leg with a liquidation – distance in % and in
 * ATR, closest first ("trade the best": the five most dangerous). Each row has a danger bar that fills towards red the
 * closer the liquidation is (scaleX on first view, `spring.enter`, staggered). Every computed price says "Näherung";
 * a liquidation in front of the stop is flagged.
 */
import { DotUnit } from "@/primitives/DotUnit";
import { motion } from "motion/react";
import { useRef } from "react";
import { liquidationPrice, type MaintTier } from "@/domain/risk";
import { cn } from "@/lib/cn";
import { NumberCascade } from "@/motion/fx";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { EmptyState } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import type { CalcModel } from "./CalculatorCard";
import type { LiqRow } from "./model";
import { RISIKO } from "./strings";
import { RiskCard, pct, priceText } from "./ui";

const S = RISIKO.liq;
/** Distance at which the danger bar is empty (20 %). */
const SAFE_DIST = 0.2;

function Row({ r, index, planned }: { r: LiqRow; index: number; planned?: boolean }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLLIElement>(null);
  const seen = useSeenOnce(ref);
  const danger = r.distPct == null ? 0 : Math.max(0.04, 1 - Math.min(1, r.distPct / SAFE_DIST));
  const tone = r.distPct == null ? "bg-white/20" : r.distPct < 0.02 ? "bg-loss" : r.distPct < 0.05 ? "bg-warn" : "bg-white/45";
  return (
    <li ref={ref} className={cn("grid gap-1.5 rounded-xl border px-3 py-2.5", r.beforeStop ? "border-loss/35 bg-loss/[0.05]" : "border-line bg-ink-950/40")} data-testid="liq-row" data-planned={planned ? "1" : undefined}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 truncate text-[12.5px] text-fg">
          {r.label}
          {r.leverage != null && <span className="ml-1.5 font-mono text-[11px] text-faint">{String(r.leverage).replace(".", ",")}×</span>}
        </span>
        <span className="num font-mono text-[12px] text-fg">
          {r.liq != null ? priceText(r.liq) : "–"}
          {!r.given && r.liq != null && <span className="ml-1 text-[10px] text-faint">≈</span>}
        </span>
      </div>
      <span className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
        <motion.span
          className={cn("absolute inset-y-0 left-0 w-full rounded-full", tone)}
          style={{ originX: 0 }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: seen || reduced ? danger : 0 }}
          transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(index, stagger.max) * stagger.reveal }}
        />
      </span>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="num font-mono text-mute">
          {r.distPct != null ? `${S.distance} ${pct(r.distPct)}` : S.none}
          {r.distAtr != null && ` · ${r.distAtr.toFixed(1).replace(".", ",")} ATR`}
        </span>
        {r.beforeStop ? <Badge tone="loss">{S.beforeStop}</Badge> : !r.given && r.liq != null ? <span className="text-faint">{S.approx}</span> : null}
      </div>
    </li>
  );
}

/** The calculator's planned position as a liquidation row (null without a valid sizing). */
export function plannedRow(m: CalcModel, tiers: readonly MaintTier[], atr: number | null): LiqRow | null {
  const s = m.sizing;
  if (!s.ok) return null;
  const r = liquidationPrice({ side: m.side, entry: m.entry, qty: s.qty, leverage: s.leverage, mode: "isolated", tiers, atr });
  if (!r) return null;
  return {
    id: "planned",
    label: `${S.planned} · ${m.side === "long" ? "Long" : "Short"}`,
    side: m.side,
    price: m.entry,
    liq: r.price,
    given: false,
    distPct: r.distPct,
    distAtr: r.distAtr,
    beforeStop: r.price != null && (m.side === "long" ? r.price >= m.stop : r.price <= m.stop),
    leverage: s.leverage,
  };
}

export function LiquidationCard({ rows, planned }: { rows: readonly LiqRow[]; planned: LiqRow | null }) {
  const shown = rows.slice(0, 5);
  const nearest = [planned, ...shown].filter((r): r is LiqRow => r != null && r.distPct != null).sort((a, b) => a.distPct! - b.distPct!)[0] ?? null;
  const empty = !planned && shown.length === 0;
  return (
    <RiskCard title={S.title} note={S.note} data-testid="risk-liq" beam={shown.some((r) => r.distPct != null && r.distPct < 0.02) ? `liq:${shown[0]!.id}` : null}>
      {empty ? (
        <EmptyState title={S.empty} text={S.emptyText} line={false} />
      ) : (
        <div className="grid gap-3">
          {nearest?.distPct != null && (
            <div className="flex flex-wrap items-end justify-between gap-2" data-testid="liq-nearest">
              <div className="grid gap-1">
                <span className="label !text-[10px]">{S.nearest}</span>
                <span className={cn("dot-num text-[34px] leading-none", nearest.distPct < 0.05 ? "text-loss" : "text-fg")}>
                  <NumberCascade value={nearest.distPct * 100} decimals={1} />
                  <DotUnit> %</DotUnit>
                </span>
              </div>
              <span className="max-w-[16rem] text-right text-[11.5px] text-mute">{nearest.label}</span>
            </div>
          )}
        <ul className="grid gap-2">
          {planned && <Row r={planned} index={0} planned />}
          {shown.map((r, i) => (
            <Row key={r.id} r={r} index={i + (planned ? 1 : 0)} />
          ))}
        </ul>
        </div>
      )}
    </RiskCard>
  );
}
