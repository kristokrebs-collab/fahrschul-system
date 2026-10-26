import { AnimatePresence, motion, type TargetAndTransition, type Transition } from "motion/react";
import { useCallback, useDeferredValue, useMemo, type ReactNode } from "react";
import { FeatureLinks } from "@/app/FeatureLinks";
import { aggregate } from "@/domain/agg";
import { EMOTIONS } from "@/domain/defaults";
import { spring, tween } from "@/motion/tokens";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button, Card, EmptyState } from "@/primitives";
import { useEnriched, useJournal } from "@/store/journalStore";
import { openScreenshotImport } from "@/journal/ocr/store";
import { storageKey } from "@/store/storage";
import { useUi, type SortKey } from "@/store/uiStore";
import { PageHeader as SharedPageHeader } from "@/views/setups/PageHeader";
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
export const TRADES_LEAD_FILL = { storageKey: storageKey("fill-trades"), highlight: "öffnet den Trade" } as const;

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
        text="Trag deinen ersten Trade ein – oder lies ihn mit „Screenshot importieren“ aus einem Bild."
        line={false}
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
      <PageHeader
        title="Alle Trades"
        lead={TRADES_LEAD}
        count={all.length}
        leadFill={TRADES_LEAD_FILL}
        action={
          <Button size="sm" onClick={() => openScreenshotImport()} data-testid="trades-shot-import">
            Screenshot importieren
          </Button>
        }
      />
      <Card>
        {/* a journal without trades has nothing to filter: the bar would only stand over an empty list */}
        {all.length > 0 && (
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
        )}
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
      {/* what happens to a trade after it is in the list (its sheets) and the other ways to get trades in */}
      <FeatureLinks
        items={
          state === "empty"
            ? [
                { id: "csv-import", label: "CSV-Import" },
                { id: "backup", label: "Backup einspielen" },
              ]
            : [
                { id: "replay", label: "Trade-Replay" },
                { id: "was-waere-wenn", label: "Was wäre wenn" },
                { id: "csv-import", label: "CSV-Import" },
                { id: "berichte", label: "Berichte" },
              ]
        }
      />
    </div>
  );
}

const tradeUnit = (n: number) => (n === 1 ? "Trade" : "Trades");

/**
 * The page header of the journal: the shared `PageHeader` (signal dot, word stagger, lead recipe, count pill – the
 * count rolls when trades are added or deleted, label `{n} Trades`), so every page opens the same way.
 */
export function PageHeader({ title, lead, count, action, leadFill }: { title: string; lead: string; count?: number; action?: ReactNode; leadFill?: { storageKey: string; highlight?: string } }) {
  return <SharedPageHeader title={title} lead={lead} count={count} countUnit={tradeUnit} action={action} leadFill={leadFill} />;
}
