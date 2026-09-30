import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { AnimatePresence, frame, motion, type Transition } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { cn } from "@/lib/cn";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useUi, type SortKey, type TradeSort } from "@/store/uiStore";
import { CheckCount, EntryExit, PnlCell, RCell, ResultBadge, SideTag, TradeSetupChips, accountLine, dateLines } from "./tradeCells";

export interface TradesTableProps {
  /** Already filtered + sorted (see `tradesModel.ts`). */
  rows: readonly EnrichedTrade[];
  setups: readonly Setup[];
  sort: TradeSort;
  onSort: (k: SortKey) => void;
  /** `layoutDependency` key – changes whenever order or set change (`listKey(filter, sort)`). */
  listKey: string;
  /** Row activation (click / Enter). The table opens the detail itself (`openDetail(id, "table")`) when omitted. */
  onOpen?: (id: string) => void;
  className?: string;
}

interface Ghost {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

type ColumnId = "date" | "side" | "setup" | "prices" | "check" | "pnl" | "r" | "result";
const SORTABLE: Partial<Record<ColumnId, SortKey>> = { date: "date", setup: "setup", pnl: "pnl", r: "r" };

/** Bundle class strings per column (`H$`): header cells and body cells. */
const TH = "px-3 pb-3 font-semibold uppercase tracking-[0.1em]";
const CELL: Record<ColumnId, { th: string; td: string }> = {
  date: { th: "px-3 pb-3 font-semibold", td: "px-3 py-3" },
  side: { th: TH, td: "px-3 py-3" },
  setup: { th: "px-3 pb-3 font-semibold", td: "max-w-[260px] px-3 py-3" },
  prices: { th: TH, td: "num px-3 py-3 font-mono text-[12.5px]" },
  check: { th: `${TH} text-right`, td: "num px-3 py-3 text-right font-mono text-xs" },
  pnl: { th: "px-3 pb-3 font-semibold text-right", td: "num px-3 py-3 text-right font-mono font-medium" },
  r: { th: "px-3 pb-3 font-semibold text-right", td: "num px-3 py-3 text-right font-mono" },
  result: { th: TH, td: "px-3 py-3" },
};

const col = createColumnHelper<EnrichedTrade>();

/**
 * `Alle Trades` table (bundle `H$`, Plan 6.2) on `@tanstack/react-table`: `Datum ↕ | Richtung | Grundlage ↕ |
 * Einstieg → Ausstieg | Check | P&L ↕ | R ↕ | Ergebnis`. Sorting is owned by `uiStore.tradeSort` (bundle rules), the
 * table only renders; rows are `motion.tr` (`layout="position"`, `layoutDependency`), enter stagger `min(i, 12) · .02`.
 * Rule 13: the detail morph runs over an absolutely positioned ghost `motion.div layoutId="trade-{id}"` measured with
 * `frame.read` – never over the `<tr>`; the wrapper is `motion.div layoutScroll`.
 */
export function TradesTable({ rows, setups, sort, onSort, listKey, onOpen, className }: TradesTableProps) {
  const detail = useUi((s) => s.detail);
  const openDetail = useUi((s) => s.openDetail);
  const reduced = useReducedFx();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const pendingOpen = useRef<string | null>(null);

  const open = useCallback(
    (id: string) => {
      if (onOpen) onOpen(id);
      else openDetail(id, "table");
    },
    [onOpen, openDetail],
  );

  // Ghost first (Entscheidung 9): the source mounts, then the detail opens in the following effect so the
  // shared-layout target finds a measured predecessor.
  useEffect(() => {
    const id = pendingOpen.current;
    if (!ghost || !id || ghost.id !== id) return;
    pendingOpen.current = null;
    open(id);
  }, [ghost, open]);

  const activate = useCallback(
    (id: string, el: HTMLElement | null) => {
      const wrap = wrapRef.current;
      if (!wrap || !el) {
        open(id);
        return;
      }
      pendingOpen.current = id;
      frame.read(() => {
        const w = wrap.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        setGhost({ id, top: r.top - w.top + wrap.scrollTop, left: r.left - w.left + wrap.scrollLeft, width: r.width, height: r.height });
      });
    },
    [open],
  );

  const showGhost = ghost != null && detail.source === "table" && detail.id === ghost.id;

  const columns = useMemo<ColumnDef<EnrichedTrade, unknown>[]>(
    () => [
      col.display({
        id: "date",
        header: "Datum",
        cell: ({ row }) => {
          const { day, clock } = dateLines(row.original);
          return (
            <>
              <div className="num font-mono text-[12.5px]">{day}</div>
              <div className="text-[11.5px] text-faint">{clock}</div>
            </>
          );
        },
      }),
      col.display({
        id: "side",
        header: "Richtung",
        cell: ({ row }) => (
          <>
            <SideTag t={row.original} />
            <div className="text-[11.5px] text-faint">{accountLine(row.original)}</div>
          </>
        ),
      }),
      col.display({
        id: "setup",
        header: "Grundlage",
        cell: ({ row }) => <TradeSetupChips t={row.original} setups={setups} />,
      }),
      col.display({ id: "prices", header: "Einstieg → Ausstieg", cell: ({ row }) => <EntryExit t={row.original} /> }),
      col.display({ id: "check", header: "Check", cell: ({ row }) => <CheckCount t={row.original} /> }),
      col.display({
        id: "pnl",
        header: "P&L",
        cell: ({ row }) => <PnlCell value={row.original.pnl} gate={!reduced} />,
      }),
      col.display({
        id: "r",
        header: "R",
        cell: ({ row }) => <RCell value={row.original.r} gate={!reduced} />,
      }),
      col.display({ id: "result", header: "Ergebnis", cell: ({ row }) => <ResultBadge t={row.original} /> }),
    ],
    [setups, reduced],
  );

  // TanStack returns non-memoisable functions; the compiler skips this component (fine – rows re-render on data change only).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: rows as EnrichedTrade[], columns, getCoreRowModel: getCoreRowModel(), getRowId: (t) => t.id });

  const rowTransition = (i: number): Transition =>
    reduced ? { layout: spring.layout } : { layout: spring.layout, opacity: { ...tween.fade, delay: Math.min(i, stagger.max) * stagger.rows } };

  return (
    <motion.div ref={wrapRef} layoutScroll className={cn("relative -mx-2 overflow-x-auto px-2", className)}>
      <table className="w-full min-w-[900px] border-collapse text-[13px]">
        <thead className="text-left text-[10.5px] text-faint">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const id = h.column.id as ColumnId;
                const sortKey = SORTABLE[id];
                return (
                  <th key={h.id} scope="col" className={CELL[id].th} aria-sort={sortKey ? (sort.k === sortKey ? (sort.dir === 1 ? "ascending" : "descending") : "none") : undefined}>
                    {sortKey ? <SortHeader k={sortKey} label={String(h.column.columnDef.header)} sort={sort} onSort={onSort} /> : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, i) => (
            <motion.tr
              key={row.id}
              layout="position"
              layoutDependency={listKey}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={rowTransition(i)}
              tabIndex={0}
              data-trade-id={row.id}
              onClick={(e: MouseEvent<HTMLTableRowElement>) => activate(row.id, e.currentTarget)}
              onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  activate(row.id, e.currentTarget);
                }
              }}
              className="cursor-pointer border-t border-line transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.03] focus-visible:outline-none"
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className={CELL[cell.column.id as ColumnId].td}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </motion.tr>
          ))}
        </tbody>
      </table>
      <AnimatePresence>
        {showGhost && ghost && (
          <motion.div
            key={`ghost-${ghost.id}`}
            layoutId={`trade-${ghost.id}`}
            aria-hidden="true"
            data-testid="trade-ghost"
            className="pointer-events-none absolute z-[1] bg-ink-800/90"
            style={{ top: ghost.top, left: ghost.left, width: ghost.width, height: ghost.height, borderRadius: radius.card }}
            transition={{ layout: spring.detail }}
            initial={false}
            exit={{ opacity: 0, transition: tween.exit }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Sortable header button: `text-signal` + ` ↑`/` ↓` on the active column (Plan 2.5 "Tabellen-Kopf"). */
export function SortHeader({ k, label, sort, onSort }: { k: SortKey; label: string; sort: TradeSort; onSort: (k: SortKey) => void }) {
  const active = sort.k === k;
  return (
    <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 uppercase tracking-[0.1em] transition-colors hover:text-fg", active && "text-signal")}>
      {label}
      {active && (sort.dir === 1 ? " ↑" : " ↓")}
    </button>
  );
}
