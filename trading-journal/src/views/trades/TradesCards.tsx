import { AnimatePresence, motion, useIsPresent, type TargetAndTransition, type Transition } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { cn } from "@/lib/cn";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useUi } from "@/store/uiStore";
import { useInsertHold } from "./TradesTable";
import { CheckCount, EntryExit, PnlCell, RCell, ResultBadge, SideTag, TradeSetupChips, accountLine, dateLines } from "./tradeCells";

export interface TradesCardsProps {
  rows: readonly EnrichedTrade[];
  setups: readonly Setup[];
  /** `layoutDependency` (`rowsKey(listKey(filter, sort), rows)`). */
  listKey: string;
  /** Sort identity (`{k}:{dir}`): a new order re-keys the list (remount + staggered enter instead of crossing FLIPs). */
  sortKey?: string;
  onOpen?: (id: string) => void;
  className?: string;
}

const CARD_FROM = { opacity: 0, y: 6 };
const CARD_SHOWN = { opacity: 1, y: 0 };
const CARD_PRESS = { scale: 0.98 };
const ITEM_EXIT: TargetAndTransition = { opacity: 0, scale: 0.98, transition: tween.exit };
const ITEM_EXIT_REDUCED: TargetAndTransition = { opacity: 0, transition: tween.exit };
const CARD_TRANSITION_REDUCED: Transition = { layout: spring.layout };

function cardTransition(i: number): Transition {
  const delay = Math.min(i, stagger.max) * stagger.rows;
  return { layout: spring.layout, y: { ...spring.enter, delay }, opacity: { ...tween.fade, delay }, scale: spring.press };
}

/**
 * Mobile card list below `md` (NEW, Plan 6.2 / 3.3 "TradesCards"): one card per trade with the table's data.
 * Cards are `motion.button layout` with `layoutId="trade-{id}"` (source of the detail morph; not while the detail
 * comes from a chart marker), enter `{opacity:0, y:6}` staggered `min(i, 12) · .02`, press `scale .98`
 * (`spring.press`). No x offset (390 px must not scroll).
 *
 * Same choreography as the table (TR-02): removed cards fade out IN PLACE (sync `AnimatePresence`, `tween.exit`,
 * `inert`, `data-exiting`) and only then do the survivors glide shut (the settle tick feeds their
 * `layoutDependency`); inserted cards are held (`useInsertHold`) until their siblings made room; a new sort order re-keys
 * the list (staggered re-enter instead of crossing FLIPs). The card's height follows on the body's `AutoHeight`.
 */
export function TradesCards({ rows, setups, listKey, sortKey = "", onOpen, className }: TradesCardsProps) {
  const detailSource = useUi((s) => s.detail.source);
  const openDetail = useUi((s) => s.openDetail);
  const reduced = useReducedFx();
  const shareLayout = detailSource !== "marker";
  const [settled, setSettled] = useState(0);
  const onExitComplete = useCallback(() => setSettled((n) => n + 1), []);
  const layoutKey = useMemo(() => `${listKey}~${settled}`, [listKey, settled]);
  // cards mounted after the group's first frame are inserts
  const [readyGroup, setReadyGroup] = useState<string | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReadyGroup(sortKey));
    return () => cancelAnimationFrame(id);
  }, [sortKey]);
  const inserting = readyGroup === sortKey;

  return (
    <ul className={cn("relative grid gap-2", className)} aria-label="Trades" data-trade-list="">
      <AnimatePresence key={sortKey} onExitComplete={onExitComplete}>
        {rows.map((t, i) => (
          <TradeCard
            key={t.id}
            t={t}
            index={i}
            insert={inserting}
            setups={setups}
            listKey={layoutKey}
            shareLayout={shareLayout}
            reduced={reduced}
            onOpen={onOpen ?? openDetail}
          />
        ))}
      </AnimatePresence>
    </ul>
  );
}

interface TradeCardProps {
  t: EnrichedTrade;
  index: number;
  /** Mounted into a list that was already shown (read at mount): held by `useInsertHold` before it enters. */
  insert: boolean;
  setups: readonly Setup[];
  listKey: string;
  shareLayout: boolean;
  reduced: boolean;
  onOpen: (id: string, source: "table") => void;
}

const TradeCard = memo(function TradeCard({ t, index, insert, setups, listKey, shareLayout, reduced, onOpen }: TradeCardProps) {
  const present = useIsPresent();
  const held = useInsertHold(insert && !reduced);
  const { day, clock } = dateLines(t);
  return (
    <motion.li exit={reduced ? ITEM_EXIT_REDUCED : ITEM_EXIT} inert={!present || undefined} data-exiting={present ? undefined : ""}>
      <motion.button
        type="button"
        layout
        layoutId={shareLayout ? `trade-${t.id}` : undefined}
        layoutDependency={listKey}
        style={{ borderRadius: radius.card }}
        initial={reduced ? false : CARD_FROM}
        animate={held ? CARD_FROM : CARD_SHOWN}
        whileTap={present && !reduced ? CARD_PRESS : undefined}
        transition={reduced ? CARD_TRANSITION_REDUCED : cardTransition(index)}
        onClick={() => onOpen(t.id, "table")}
        data-trade-id={t.id}
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
              <PnlCell value={t.pnl} />
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
              <RCell value={t.r} />
            </span>
            <span>
              <span className="text-faint">Check </span>
              <CheckCount t={t} />
            </span>
          </span>
        </div>
      </motion.button>
    </motion.li>
  );
});
