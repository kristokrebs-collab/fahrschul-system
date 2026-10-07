import { AnimatePresence, motion, type TargetAndTransition, type Transition } from "motion/react";
import { Fragment, useCallback, useDeferredValue, useMemo, type ReactNode } from "react";
import { aggregate } from "@/domain/agg";
import { EMOTIONS } from "@/domain/defaults";
import { RollingDigits } from "@/motion/RollingDigits";
import { spring, stagger, tween } from "@/motion/tokens";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button, Card, EmptyState } from "@/primitives";
import { useEnriched, useJournal } from "@/store/journalStore";
import { storageKey } from "@/store/storage";
import { useUi, type SortKey } from "@/store/uiStore";
import { LeadFill } from "@/views/setups/LeadFill";
import { AutoHeight } from "./AutoHeight";
import { KpiStrip } from "./KpiStrip";
import { TradeFilters } from "./TradeFilters";
import { TradesCards } from "./TradesCards";
import { TradesTable } from "./TradesTable";
import { filterExtra, filterTrades, listKey, mistakeFilterTags, mistakesOf, rowsKey, searchSuggestions, signalOf, sortTrades } from "./tradesModel";

export interface TradesViewProps {
  /** Override of the `Trade eintragen` CTA (default: `useUi().openEditor()`). */
  onNew?: () => void;
  /** Override of the row activation (default: `useUi().openDetail(id, "table")`). */
  onOpen?: (id: string) => void;
  className?: string;
}

export const TRADES_LEAD = "Filtere nach Konto, Entscheidungsgrundlage, Ergebnis oder Richtung. Ein Klick auf eine Zeile öffnet den Trade.";
/** Subtitle recipe (same as the setups / settings pages): pixel fill once per session, then the marker on the key word. */
export const TRADES_LEAD_FILL = { storageKey: storageKey("fill-trades"), highlight: "Klick" } as const;

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
 * The card body switches between the list, `Keine Treffer` and the empty journal in sequence (TR-01): the leaving
 * body fades out in place (`tween.exit`), then the new one fades / scales in (`AnimatePresence mode="wait"`) while
 * the card's height follows on a spring (`AutoHeight`) – the two bodies are never drawn over each other. Reduced
 * motion: no scale, plain fades, no height spring. The text search runs on a deferred value (PF-01): typing stays
 * responsive while the list re-filters at lower priority.
 */
export function TradesView({ onNew, onOpen, className }: TradesViewProps) {
  const all = useEnriched();
  const settings = useJournal((s) => s.settings);
  const liveFilter = useUi((s) => s.tradeFilter);
  const deferredQ = useDeferredValue(liveFilter.q);
  const filter = useMemo(() => (deferredQ === liveFilter.q ? liveFilter : { ...liveFilter, q: deferredQ }), [liveFilter, deferredQ]);
  const setTradeFilter = useUi((s) => s.setTradeFilter);
  const extra = useUi((s) => s.tradeExtra);
  const setTradeExtra = useUi((s) => s.setTradeExtra);
  const resetTradeFilter = useUi((s) => s.resetTradeFilter);
  const sort = useUi((s) => s.tradeSort);
  const toggleSort = useUi((s) => s.toggleSort);
  const openEditor = useUi((s) => s.openEditor);
  const wide = useMediaQuery("(min-width: 768px)", true);
  const reduced = useReducedFx();

  const rows = useMemo(() => sortTrades(filterExtra(filterTrades(all, filter, settings.setups), extra), sort, settings.setups), [all, filter, extra, sort, settings.setups]);
  const closed = useMemo(() => aggregate(rows.filter((t) => t.result !== "open")), [rows]);
  const key = listKey(filter, sort, extra);
  // the additive filters only show once the journal has something to filter by (or while they are set)
  const usedMistakes = useMemo(() => all.some((t) => mistakesOf(t).length > 0), [all]);
  const mistakeTags = useMemo(() => (usedMistakes || extra.mistake !== "all" ? mistakeFilterTags(all, settings.mistakes) : []), [all, settings.mistakes, usedMistakes, extra.mistake]);
  const hasSignals = useMemo(() => all.some((t) => signalOf(t) != null), [all]);
  const layoutKey = useMemo(() => rowsKey(key, rows), [key, rows]);

  const suggestions = useMemo(() => searchSuggestions(all, settings.setups, EMOTIONS), [all, settings.setups]);
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
        line="Filter lockern oder zurücksetzen."
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
          <TradesCards rows={rows} setups={settings.setups} listKey={layoutKey} sortKey={`${sort.k}:${sort.dir}`} onOpen={onOpen} />
        )}
      </>
    );
  }

  return (
    <div className={className ?? "grid grid-cols-1 gap-5"}>
      <PageHeader title="Alle Trades" lead={TRADES_LEAD} count={all.length} leadFill={TRADES_LEAD_FILL} />
      <Card>
        <TradeFilters
          filter={liveFilter}
          onChange={setTradeFilter}
          setups={settings.setups}
          count={rows.length}
          closed={closed}
          suggestions={suggestions}
          extra={extra}
          onExtraChange={setTradeExtra}
          mistakeTags={mistakeTags}
          showStrength={hasSignals || extra.strength !== "all"}
        />
        <AutoHeight className="relative">
          <AnimatePresence mode="wait" initial={false}>
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
        </AutoHeight>
      </Card>
    </div>
  );
}

// px, not em: a unit change (em → 0) would make motion measure every word before animating (same as setups' PageHeader)
const WORD_FROM = { opacity: 0, y: 10, filter: "blur(4px)" };
const WORD_SHOWN = { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } };
const DOT_FROM = { scale: 0 };
const DOT_SHOWN = { scale: 1 };

/** The ember starts once the lead has faded in (same beat as the setups / settings headers). */
const FILL_AFTER_LEAD_S = 0.25;
const leadDelay = (i: number) => Math.min(i, stagger.max) * stagger.words;

/** `i`-th word of the title (count and lead follow as the next steps): blur-fade up, `stagger.words` apart. */
function wordTransition(i: number): Transition {
  const delay = leadDelay(i);
  return { default: { ...tween.reveal, delay }, y: { ...spring.enter, delay } };
}

/**
 * Bundle `aT`: `h1` 28 px with the signal dot + lead. `count` is appended as a muted mono figure (NEW) that rolls
 * when trades are added or deleted (`RollingDigits`, label `{n} Trades`).
 *
 * Page enter (21st.dev "Words Stagger"): the signal dot pops (`spring.pop`), the words rise 10 px out of a 4 px blur
 * 30 ms apart, the count and the lead follow. Only the inner spans animate – the `h1` itself is never transparent,
 * and under reduced motion everything renders in place (`initial={false}`). With `leadFill` the lead is the shared
 * pulse subtitle recipe (`LeadFill`: pixel fill with a signal-red ember once per session, then the marker wipe).
 */
export function PageHeader({ title, lead, count, action, leadFill }: { title: string; lead: string; count?: number; action?: ReactNode; leadFill?: { storageKey: string; highlight?: string } }) {
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
        <motion.div className="mt-1 max-w-[62ch] text-[13.5px] text-mute" initial={from(WORD_FROM)} animate={WORD_SHOWN} transition={wordTransition(words.length + 1)}>
          {leadFill ? (
            <LeadFill text={lead} storageKey={leadFill.storageKey} highlight={leadFill.highlight} delayMs={Math.round((leadDelay(words.length + 1) + FILL_AFTER_LEAD_S) * 1000)} />
          ) : (
            <p>{lead}</p>
          )}
        </motion.div>
      </div>
      {action}
    </div>
  );
}
