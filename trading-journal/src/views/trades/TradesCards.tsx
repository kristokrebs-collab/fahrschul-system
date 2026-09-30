import { motion } from "motion/react";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { cn } from "@/lib/cn";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useUi } from "@/store/uiStore";
import { CheckCount, EntryExit, PnlCell, RCell, ResultBadge, SideTag, TradeSetupChips, accountLine, dateLines } from "./tradeCells";

export interface TradesCardsProps {
  rows: readonly EnrichedTrade[];
  setups: readonly Setup[];
  /** `layoutDependency` (`listKey(filter, sort)`). */
  listKey: string;
  onOpen?: (id: string) => void;
  className?: string;
}

/**
 * Mobile card list below `md` (NEW, Plan 6.2 / 3.3 "TradesCards"): one card per trade with the table's data.
 * Cards are `motion.button layout` with `layoutId="trade-{id}"` (source of the detail morph; not while the detail
 * comes from a chart marker), enter `{opacity:0, y:6}` staggered `min(i, 12) · .02`, no exit.
 */
export function TradesCards({ rows, setups, listKey, onOpen, className }: TradesCardsProps) {
  const detail = useUi((s) => s.detail);
  const openDetail = useUi((s) => s.openDetail);
  const reduced = useReducedFx();
  const open = (id: string) => (onOpen ? onOpen(id) : openDetail(id, "table"));
  const shareLayout = detail.source !== "marker";

  return (
    <ul className={cn("grid gap-2", className)} aria-label="Trades">
      {rows.map((t, i) => {
        const { day, clock } = dateLines(t);
        return (
          <li key={t.id}>
            <motion.button
              type="button"
              layout
              layoutId={shareLayout ? `trade-${t.id}` : undefined}
              layoutDependency={listKey}
              style={{ borderRadius: radius.card }}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduced ? { layout: spring.layout } : { ...spring.layout, layout: spring.layout, opacity: { ...tween.fade, delay: Math.min(i, stagger.max) * stagger.rows } }}
              onClick={() => open(t.id)}
              className="grid w-full gap-2.5 rounded-2xl border border-line bg-ink-950/40 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SideTag t={t} />
                  <div className="text-[11.5px] text-faint">
                    {accountLine(t)} · {day} {clock}
                  </div>
                </div>
                <div className="grid justify-items-end gap-1">
                  <span className="num font-mono text-[14px] font-medium">
                    <PnlCell value={t.pnl} gate={!reduced} />
                  </span>
                  <ResultBadge t={t} />
                </div>
              </div>
              <TradeSetupChips t={t} setups={setups} />
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="num font-mono text-[12.5px]">
                  <EntryExit t={t} />
                </span>
                <span className="num flex items-center gap-3 font-mono text-xs">
                  <span>
                    <span className="text-faint">R </span>
                    <RCell value={t.r} gate={!reduced} />
                  </span>
                  <span>
                    <span className="text-faint">Check </span>
                    <CheckCount t={t} />
                  </span>
                </span>
              </div>
            </motion.button>
          </li>
        );
      })}
    </ul>
  );
}
