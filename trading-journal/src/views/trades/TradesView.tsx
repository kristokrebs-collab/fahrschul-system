import { useCallback, useMemo, type ReactNode } from "react";
import { aggregate } from "@/domain/agg";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { Button, Card, EmptyState } from "@/primitives";
import { useEnriched, useJournal } from "@/store/journalStore";
import { useUi, type SortKey } from "@/store/uiStore";
import { KpiStrip } from "./KpiStrip";
import { TradeFilters } from "./TradeFilters";
import { TradesCards } from "./TradesCards";
import { TradesTable } from "./TradesTable";
import { filterTrades, listKey, sortTrades } from "./tradesModel";

export interface TradesViewProps {
  /** Override of the `Trade eintragen` CTA (default: `useUi().openEditor()`). */
  onNew?: () => void;
  /** Override of the row activation (default: `useUi().openDetail(id, "table")`). */
  onOpen?: (id: string) => void;
  className?: string;
}

export const TRADES_LEAD = "Filtere nach Konto, Entscheidungsgrundlage, Ergebnis oder Richtung. Ein Klick auf eine Zeile öffnet den Trade.";

/**
 * View 2 `Alle Trades` (bundle `H$`, Plan 6.2): page header, one card with the filter bar, the KPI strip and the
 * table (≥ `md`) or the card list (< `md`; JS breakpoint so only one `trade-{id}` source is mounted at a time).
 * Filter + sort state come from `uiStore` (`tradeFilter` is mirrored into `#trades?…` by the router).
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

  const rows = useMemo(() => sortTrades(filterTrades(all, filter, settings.setups), sort, settings.setups), [all, filter, sort, settings.setups]);
  const closed = useMemo(() => aggregate(rows.filter((t) => t.result !== "open")), [rows]);
  const key = listKey(filter, sort);

  const onSort = useCallback((k: SortKey) => toggleSort(k), [toggleSort]);
  const newTrade = () => (onNew ? onNew() : openEditor());

  let body: ReactNode;
  if (all.length === 0) {
    body = (
      <EmptyState
        title="Noch keine Trades"
        text="Klick auf „Trade eintragen“, um loszulegen."
        action={
          <Button variant="primary" size="sm" className="mt-2" onClick={newTrade}>
            Trade eintragen
          </Button>
        }
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        title="Keine Treffer"
        text="Kein Trade passt zu diesen Filtern."
        action={
          <Button size="sm" className="mt-2" onClick={() => resetTradeFilter()}>
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
          <TradesTable rows={rows} setups={settings.setups} sort={sort} onSort={onSort} listKey={key} onOpen={onOpen} />
        ) : (
          <TradesCards rows={rows} setups={settings.setups} listKey={key} onOpen={onOpen} />
        )}
      </>
    );
  }

  return (
    <div className={className ?? "grid grid-cols-1 gap-5"}>
      <PageHeader title="Alle Trades" lead={TRADES_LEAD} count={all.length} />
      <Card>
        <TradeFilters filter={filter} onChange={setTradeFilter} setups={settings.setups} count={rows.length} closed={closed} />
        {body}
      </Card>
    </div>
  );
}

/** Bundle `aT`: `h1` 28 px with the signal dot + lead. `count` is appended as a muted mono figure (NEW). */
export function PageHeader({ title, lead, count, action }: { title: string; lead: string; count?: number; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight [text-wrap:balance]">
          <span className="mr-2 inline-block size-2 -translate-y-1 rounded-full bg-signal align-middle" aria-hidden="true" />
          {title}
          {count != null && (
            <span className="num ml-2 align-middle font-mono text-[15px] font-medium text-mute" aria-label={`${count} Trades`}>
              {count}
            </span>
          )}
        </h1>
        <p className="mt-1 max-w-[62ch] text-[13.5px] text-mute">{lead}</p>
      </div>
      {action}
    </div>
  );
}
