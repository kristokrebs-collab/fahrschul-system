import { AnimatePresence, motion, type TargetAndTransition, type Transition } from "motion/react";
import { Fragment, useCallback, useMemo, type ReactNode } from "react";
import { aggregate } from "@/domain/agg";
import { RollingDigits } from "@/motion/RollingDigits";
import { spring, stagger, tween } from "@/motion/tokens";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button, Card, EmptyState } from "@/primitives";
import { useEnriched, useJournal } from "@/store/journalStore";
import { useUi, type SortKey } from "@/store/uiStore";
import { KpiStrip } from "./KpiStrip";
import { TradeFilters } from "./TradeFilters";
import { TradesCards } from "./TradesCards";
import { TradesTable } from "./TradesTable";
import { filterTrades, listKey, rowsKey, sortTrades } from "./tradesModel";

export interface TradesViewProps {
  /** Override of the `Trade eintragen` CTA (default: `useUi().openEditor()`). */
  onNew?: () => void;
  /** Override of the row activation (default: `useUi().openDetail(id, "table")`). */
  onOpen?: (id: string) => void;
  className?: string;
}

export const TRADES_LEAD = "Filtere nach Konto, Entscheidungsgrundlage, Ergebnis oder Richtung. Ein Klick auf eine Zeile öffnet den Trade.";

/** Which body the card shows; the key of the crossfade. */
type BodyState = "list" | "none" | "empty";

const BODY_FROM = { opacity: 0, scale: 0.98 };
const BODY_SHOWN = { opacity: 1, scale: 1 };
const BODY_EXIT: TargetAndTransition = { opacity: 0, scale: 0.98, transition: tween.exit };
const BODY_EXIT_REDUCED: TargetAndTransition = { opacity: 0, transition: tween.exit };
const BODY_TRANSITION: Transition = { opacity: tween.fade, scale: spring.enter };

/** Empty-state CTAs pop in; the target carries its own transition so the press release (Button `whileTap`) pops too. */
const CTA_FROM = { opacity: 0, scale: 0.9 };
const CTA_SHOWN: TargetAndTransition = { opacity: 1, scale: 1, transition: { scale: spring.pop, opacity: tween.fade } };

/**
 * View 2 `Alle Trades` (bundle `H$`, Plan 6.2): page header, one card with the filter bar, the KPI strip and the
 * table (≥ `md`) or the card list (< `md`; JS breakpoint so only one `trade-{id}` source is mounted at a time).
 * Filter + sort state come from `uiStore` (`tradeFilter` is mirrored into `#trades?…` by the router).
 *
 * The card body crossfades between the list, `Keine Treffer` and the empty journal (`AnimatePresence
 * mode="popLayout"`: the leaving body is lifted out of the flow, the new one mounts in the same commit – never
 * `wait`), `opacity` + `scale .98`, origin top. Reduced motion: no scale, the new body is there at once.
 */
export function TradesView({ onNew, onOpen, className }: TradesViewProps) {
  const all = useEnriched();
  const settings = useJournal((s) => s.settings);
  const filter = useUi((s) => s.tradeFilter);
  const setTradeFilter = useUi((s) => s.setTradeFilter);
  const resetTradeFilter = useUi((s) => s.resetTradeFilter);
  const sort = useUi((s) => s.tradeSort);
  const toggleSort = useUi((s) => s.toggleSort);
  const openEditor = useUi((s) => s.openEditor);
  const wide = useMediaQuery("(min-width: 768px)", true);
  const reduced = useReducedFx();

  const rows = useMemo(() => sortTrades(filterTrades(all, filter, settings.setups), sort, settings.setups), [all, filter, sort, settings.setups]);
  const closed = useMemo(() => aggregate(rows.filter((t) => t.result !== "open")), [rows]);
  const key = listKey(filter, sort);
  const layoutKey = useMemo(() => rowsKey(key, rows), [key, rows]);

  const onSort = useCallback((k: SortKey) => toggleSort(k), [toggleSort]);
  const newTrade = () => (onNew ? onNew() : openEditor());

  const state: BodyState = all.length === 0 ? "empty" : rows.length === 0 ? "none" : "list";
  const ctaMotion = { initial: reduced ? false : CTA_FROM, animate: CTA_SHOWN } as const;

  let body: ReactNode;
  if (state === "empty") {
    body = (
      <EmptyState
        title="Noch keine Trades"
        text="Klick auf „Trade eintragen“, um loszulegen."
        action={
          <Button variant="primary" size="sm" className="mt-2" onClick={newTrade} {...ctaMotion}>
            Trade eintragen
          </Button>
        }
      />
    );
  } else if (state === "none") {
    body = (
      <EmptyState
        title="Keine Treffer"
        text="Kein Trade passt zu diesen Filtern."
        action={
          <Button size="sm" className="mt-2" onClick={() => resetTradeFilter()} {...ctaMotion}>
            Filter zurücksetzen
          </Button>
        }
      />
    );
  } else {
    body = (
      <>
        <KpiStrip closed={closed} count={rows.length} currency={settings.currency} />
        {wide ? (
          <TradesTable rows={rows} setups={settings.setups} sort={sort} onSort={onSort} listKey={layoutKey} onOpen={onOpen} />
        ) : (
          <TradesCards rows={rows} setups={settings.setups} listKey={layoutKey} onOpen={onOpen} />
        )}
      </>
    );
  }

  return (
    <div className={className ?? "grid grid-cols-1 gap-5"}>
      <PageHeader title="Alle Trades" lead={TRADES_LEAD} count={all.length} />
      <Card>
        <TradeFilters filter={filter} onChange={setTradeFilter} setups={settings.setups} count={rows.length} closed={closed} />
        <div className="relative">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={state}
              className="origin-top"
              initial={reduced ? false : BODY_FROM}
              animate={BODY_SHOWN}
              exit={reduced ? BODY_EXIT_REDUCED : BODY_EXIT}
              transition={BODY_TRANSITION}
            >
              {body}
            </motion.div>
          </AnimatePresence>
        </div>
      </Card>
    </div>
  );
}

// px, not em: a unit change (em → 0) would make motion measure every word before animating (same as setups' PageHeader)
const WORD_FROM = { opacity: 0, y: 10, filter: "blur(4px)" };
const WORD_SHOWN = { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } };
const DOT_FROM = { scale: 0 };
const DOT_SHOWN = { scale: 1 };

/** `i`-th word of the title (count and lead follow as the next steps): blur-fade up, `stagger.words` apart. */
function wordTransition(i: number): Transition {
  const delay = Math.min(i, stagger.max) * stagger.words;
  return { default: { ...tween.reveal, delay }, y: { ...spring.enter, delay } };
}

/**
 * Bundle `aT`: `h1` 28 px with the signal dot + lead. `count` is appended as a muted mono figure (NEW) that rolls
 * when trades are added or deleted (`RollingDigits`, label `{n} Trades`).
 *
 * Page enter (21st.dev "Words Stagger"): the signal dot pops (`spring.pop`), the words rise 10 px out of a 4 px blur
 * 30 ms apart, the count and the lead follow. Only the inner spans animate – the `h1` itself is never transparent,
 * and under reduced motion everything renders in place (`initial={false}`).
 */
export function PageHeader({ title, lead, count, action }: { title: string; lead: string; count?: number; action?: ReactNode }) {
  const reduced = useReducedFx();
  const words = title.split(" ");
  const from = <T,>(target: T): T | false => (reduced ? false : target);
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight [text-wrap:balance]">
          <motion.span
            className="mr-2 inline-block size-2 -translate-y-1 rounded-full bg-signal align-middle"
            aria-hidden="true"
            initial={from(DOT_FROM)}
            animate={DOT_SHOWN}
            transition={spring.pop}
          />
          {words.map((word, i) => (
            <Fragment key={i}>
              {i > 0 && " "}
              <motion.span className="inline-block" initial={from(WORD_FROM)} animate={WORD_SHOWN} transition={wordTransition(i)}>
                {word}
              </motion.span>
            </Fragment>
          ))}
          {count != null && (
            <motion.span className="ml-2 inline-block align-middle" initial={from(WORD_FROM)} animate={WORD_SHOWN} transition={wordTransition(words.length)}>
              <RollingDigits value={count} aria-label={`${count} Trades`} className="num font-mono text-[15px] font-medium text-mute" />
            </motion.span>
          )}
        </h1>
        <motion.p className="mt-1 max-w-[62ch] text-[13.5px] text-mute" initial={from(WORD_FROM)} animate={WORD_SHOWN} transition={wordTransition(words.length + 1)}>
          {lead}
        </motion.p>
      </div>
      {action}
    </div>
  );
}
