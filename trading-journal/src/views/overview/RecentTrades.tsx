import { AnimatePresence, motion, PresenceContext, useIsPresent, type Variants } from "motion/react";
import { useContext, useMemo, useRef, useState, type Ref } from "react";
import { RESULT_LABELS, RESULT_TONES } from "@/domain/defaults";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { cn } from "@/lib/cn";
import { tradeTime } from "@/lib/dates";
import { colorClass, date as fmtDate, signed, time as fmtTime } from "@/lib/format";
import { HoverPill, useHoverGroup, type HoverGroupBinding } from "@/motion/HoverPill";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { SetupChips } from "@/primitives/SetupChip";
import { useAccountView, useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";

export const RECENT_TITLE = "Letzte Trades";
export const RECENT_ALL = "Alle ansehen →";
export const RECENT_EMPTY_TITLE = "Noch keine Trades";
export const RECENT_EMPTY_TEXT = "Trag deinen ersten Trade ein. Alle Zahlen im Journal rechnen sich dann automatisch.";
export const RECENT_EMPTY_CTA = "Ersten Trade eintragen";
export const RECENT_COUNT = 6;

/** Press feedback of a row: as subtle as a morph source, the detail morph takes over right after. */
const PRESS_SCALE = 0.985;

/**
 * Pure: does a row that just entered the list mark a newly saved trade (highlight sweep)? Rows also enter at the
 * bottom of a full list when a newer trade was deleted – those only slide in.
 */
export function isFreshInsert(index: number, count: number, max = RECENT_COUNT): boolean {
  return !(count >= max && index === count - 1);
}

/**
 * `true` once the list goes from empty to its first trade within one account: that first row must drop in (with
 * the sweep) although its `AnimatePresence` mounts fresh. Account switches and the initial render stay instant.
 * Derived while rendering from the previous render's state (React's "adjusting state" pattern, no effect).
 */
function useAnimateFirstInsert(acc: string, count: number): boolean {
  const [s, setS] = useState({ acc, empty: count === 0, animate: false });
  if (s.acc !== acc) setS({ acc, empty: count === 0, animate: false });
  else if (s.empty !== (count === 0)) setS({ acc, empty: count === 0, animate: count > 0 });
  return s.animate;
}

/** Row states: `hidden` until the card is first seen (cascade), `shown` at rest; new rows drop in from `enter`. */
const ROW: Variants = {
  hidden: { opacity: 0, y: 8 },
  enter: { opacity: 0, y: -12, scale: 0.97, filter: "blur(4px)" },
  shown: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transitionEnd: { filter: "none" },
    transition: { default: { ...tween.reveal, delay: Math.min(i, stagger.max) * stagger.rows }, y: { ...spring.enter, delay: Math.min(i, stagger.max) * stagger.rows }, scale: spring.enter },
  }),
};
const ROW_REDUCED: Variants = { hidden: { opacity: 1 }, enter: { opacity: 0 }, shown: { opacity: 1, transition: tween.crossfade } };

const SWEEP_TINT = { win: "bg-win/[0.10]", loss: "bg-loss/[0.10]", fg: "bg-white/[0.06]" } as const;
const SWEEP_BAND = { win: "via-win/30", loss: "via-loss/30", fg: "via-white/20" } as const;
const SWEEP_RAIL = { win: "bg-win", loss: "bg-loss", fg: "bg-fg" } as const;

/**
 * One-shot "just saved" highlight on a newly inserted row: a tone wash that decays, a light band sweeping left → right
 * and a 2 px rail growing down the left edge – transform/opacity only, unmounted when the last layer has faded.
 */
function FreshSweep({ tone, onDone }: { tone: keyof typeof SWEEP_TINT; onDone: () => void }) {
  return (
    <span aria-hidden="true" data-fx="fresh" className="pointer-events-none absolute inset-y-0.5 inset-x-0 overflow-hidden rounded-xl">
      <motion.span className={cn("absolute inset-0", SWEEP_TINT[tone])} initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ ...tween.flash, delay: tween.draw.duration * 0.6 }} />
      <motion.span
        className={cn("absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent to-transparent", SWEEP_BAND[tone])}
        initial={{ x: "-100%" }}
        animate={{ x: "200%" }}
        transition={tween.draw}
      />
      <motion.span
        className={cn("absolute inset-y-1.5 left-0 w-0.5 rounded-full", SWEEP_RAIL[tone])}
        style={{ originY: 0 }}
        initial={{ scaleY: 0, opacity: 1 }}
        animate={{ scaleY: 1, opacity: [1, 1, 0] }}
        transition={{ scaleY: spring.enter, opacity: { ...tween.flash, duration: tween.draw.duration + tween.flash.duration, times: [0, 0.55, 1] } }}
        // the rail is the longest of the three layers: unmount only after it (and the wash before it) are gone
        onAnimationComplete={onDone}
      />
    </span>
  );
}

interface RowProps {
  t: EnrichedTrade;
  index: number;
  count: number;
  seen: boolean;
  listKey: string;
  shareIds: boolean;
  pressing: boolean;
  hovered: boolean;
  bind: HoverGroupBinding;
  setups: readonly Pick<Setup, "id" | "name" | "color">[];
  onOpen: (id: string) => void;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Animated list row (21st.dev "Animated List"): `layout="position"` so inserts push the rest down and removals
 * close the gap (`popLayout`), first-view cascade, new rows drop in with the fresh sweep. The button keeps the
 * conditional `trade-{id}` / `trade-side-{id}` / `trade-pnl-{id}` morph ids into the detail.
 */
function Row({ t, index, count, seen, listKey, shareIds, pressing, hovered, bind, setups, onOpen, ref }: RowProps) {
  const reduced = useReducedFx();
  const present = useIsPresent();
  const presence = useContext(PresenceContext);
  const press = usePressable({ scale: PRESS_SCALE, disabled: pressing });
  // rows present on the first render never sweep; a row mounted later is an insert (decided once, at mount)
  const [sweep, setSweep] = useState(() => !reduced && presence?.initial !== false && isFreshInsert(index, count));
  const tone = t.pnl == null || t.pnl === 0 ? "fg" : t.pnl > 0 ? "win" : "loss";
  return (
    <motion.div
      ref={ref}
      layout="position"
      layoutDependency={listKey}
      custom={index}
      variants={reduced ? ROW_REDUCED : ROW}
      initial="enter"
      animate={seen ? "shown" : "hidden"}
      exit={{ opacity: 0, scale: 0.98, transition: tween.exit }}
      transition={{ layout: spring.layout }}
      aria-hidden={present ? undefined : true}
      inert={!present}
      data-exiting={present ? undefined : ""}
      className={cn("relative", index > 0 && "border-t border-line")}
      {...bind}
    >
      <HoverPill show={hovered} group="recent" className="inset-y-0.5" />
      {/* an insert made before the card was ever seen plays its highlight on first view instead of off-screen */}
      {sweep && seen && <FreshSweep tone={tone} onDone={() => setSweep(false)} />}
      <motion.button
        type="button"
        layoutId={shareIds ? `trade-${t.id}` : undefined}
        layoutDependency={t.id}
        whileTap={press.whileTap}
        transition={{ ...press.transition, layout: spring.detail }}
        style={{ borderRadius: radius.hover }}
        onClick={() => onOpen(t.id)}
        data-trade-id={t.id}
        className="relative z-10 grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2.5 text-left"
      >
        <span className="num font-mono text-[11px] leading-tight text-mute">
          {fmtDate(tradeTime(t))}
          <br />
          {fmtTime(tradeTime(t))}
        </span>
        <span className="grid min-w-0 gap-1">
          <span className="flex items-center gap-2 text-xs">
            <motion.span layoutId={shareIds ? `trade-side-${t.id}` : undefined} layout="position" className={cn("font-semibold uppercase tracking-wide", t.side === "short" ? "text-loss" : "text-win")}>
              {t.side === "short" ? "▼ Short" : "▲ Long"}
            </motion.span>
            <span className="text-faint">{t.account === "makro" ? "Makro" : "Scalp"}</span>
          </span>
          <SetupChips items={setups} />
        </span>
        <span className="grid justify-items-end gap-1">
          <motion.span layoutId={shareIds ? `trade-pnl-${t.id}` : undefined} layout="position" className={cn("num font-mono text-[13.5px] font-medium", colorClass(t.pnl))}>
            {t.pnl == null ? "–" : signed(t.pnl)}
          </motion.span>
          <Badge tone={RESULT_TONES[t.result]}>{RESULT_LABELS[t.result]}</Badge>
        </span>
      </motion.button>
    </motion.div>
  );
}

/**
 * `Letzte Trades` (Bundle `Ohe`, Plan 6.1): the 6 newest trades incl. open ones as an animated list – rows cascade
 * in the first time the card is seen, a newly saved trade drops in from the top with a win/loss highlight sweep,
 * removed rows fade while the rest close up, rows give press feedback. Hover pill `recent`; row =
 * `motion.button layoutId="trade-{id}"` (+ `trade-side-{id}`, `trade-pnl-{id}`) → `openDetail(id, "recent")`.
 * The shared ids are dropped while a detail opened from a chart marker or the table is shown (Plan 3.3 rule "Quelle").
 */
export function RecentTrades() {
  const settings = useJournal((s) => s.settings);
  const acc = useUi((s) => s.acc);
  const detail = useUi((s) => s.detail);
  const openDetail = useUi((s) => s.openDetail);
  const openEditor = useUi((s) => s.openEditor);
  const view = useAccountView(acc);
  const rows = useMemo(() => [...view.list].sort((a, b) => +tradeTime(b) - +tradeTime(a)).slice(0, RECENT_COUNT), [view.list]);
  const hover = useHoverGroup<string>();
  const body = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(body);
  const animateFirst = useAnimateFirstInsert(acc, rows.length);
  const shareIds = detail.source !== "marker" && detail.source !== "table";
  const listKey = rows.map((t) => t.id).join(",");
  const open = (id: string) => openDetail(id, "recent");

  const setupsOf = (t: EnrichedTrade) => (t.setups || []).map((id) => settings.setups.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => Boolean(s));

  return (
    <Card
      title={RECENT_TITLE}
      action={
        rows.length ? (
          <button type="button" onClick={() => navigate("trades")} className="label !text-fg hover:!text-signal">
            {RECENT_ALL}
          </button>
        ) : undefined
      }
    >
      {/* always mounted: the first-view cascade is armed by the card, also when it starts empty */}
      <div ref={body} className="flex flex-1 flex-col">
        {rows.length ? (
          <div className="relative grid" data-trade-list="">
            {/* keyed by account: switching accounts swaps the whole list instead of animating six unrelated inserts */}
            <AnimatePresence key={acc} mode="popLayout" initial={animateFirst}>
              {rows.map((t, i) => (
                <Row
                  key={t.id}
                  t={t}
                  index={i}
                  count={rows.length}
                  seen={seen}
                  listKey={listKey}
                  shareIds={shareIds}
                  pressing={detail.id === t.id}
                  hovered={hover.hovered === t.id}
                  bind={hover.bind(t.id)}
                  setups={setupsOf(t)}
                  onOpen={open}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <EmptyState
            title={RECENT_EMPTY_TITLE}
            text={RECENT_EMPTY_TEXT}
            action={
              <Button variant="primary" size="sm" className="mt-2" onClick={() => openEditor()}>
                {RECENT_EMPTY_CTA}
              </Button>
            }
          />
        )}
      </div>
    </Card>
  );
}
