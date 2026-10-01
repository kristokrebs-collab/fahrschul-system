import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnDef, type Row } from "@tanstack/react-table";
import { AnimatePresence, frame, motion, useIsPresent, type TargetAndTransition, type Transition } from "motion/react";
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { cn } from "@/lib/cn";
import { isScrolling } from "@/motion/scrollGate";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useUi, type SortKey, type TradeSort } from "@/store/uiStore";
import { RowHighlight, type RowHighlightHandle } from "./RowHighlight";
import { measureRow, type RowBox } from "./rowGeometry";
import { CheckCount, EntryExit, PnlCell, RCell, ResultBadge, SideTag, TradeSetupChips, accountLine, dateLines } from "./tradeCells";
import { sortArrow } from "./tradesModel";

export interface TradesTableProps {
  /** Already filtered + sorted (see `tradesModel.ts`). */
  rows: readonly EnrichedTrade[];
  setups: readonly Setup[];
  sort: TradeSort;
  onSort: (k: SortKey) => void;
  /** `layoutDependency` key – changes whenever order or set change (`rowsKey(listKey(filter, sort), rows)`). */
  listKey: string;
  /** Row activation (click / Enter). The table opens the detail itself (`openDetail(id, "table")`) when omitted. */
  onOpen?: (id: string) => void;
  className?: string;
}

interface Ghost extends RowBox {
  id: string;
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

/* Row motion: enter fades up (staggered), exit fades out with a short slide to the left, press dips the row. */
const ROW_FROM = { opacity: 0, y: 6, x: 0 };
const ROW_SHOWN = { opacity: 1, y: 0, x: 0 };
const ROW_EXIT: TargetAndTransition = { opacity: 0, x: -8, transition: tween.exit };
const ROW_EXIT_REDUCED: TargetAndTransition = { opacity: 0, transition: tween.exit };
const ROW_PRESS = { scale: 0.995 };
const ROW_TRANSITION_REDUCED: Transition = { layout: spring.layout };

/** `enterDelay`: 0 for the rows of a freshly shown list, `stagger.insert` for rows inserted while it is shown. */
function rowTransition(i: number, enterDelay: number): Transition {
  const delay = enterDelay + Math.min(i, stagger.max) * stagger.rows;
  return { layout: spring.layout, opacity: { ...tween.fade, delay }, y: { ...spring.enter, delay }, x: spring.enter, scale: spring.press };
}

/**
 * `Alle Trades` table (bundle `H$`, Plan 6.2) on `@tanstack/react-table`: `Datum ↕ | Richtung | Grundlage ↕ |
 * Einstieg → Ausstieg | Check | P&L ↕ | R ↕ | Ergebnis`. Sorting is owned by `uiStore.tradeSort` (bundle rules), the
 * table only renders.
 *
 * - Rows are `motion.tr` (`layout="position"`, `layoutDependency`) inside `AnimatePresence` (sync mode – popLayout
 *   would pull rows out of the table layout): enter `{opacity 0, y 6}` staggered `min(i, 12) · .02`, exit opacity +
 *   `x −8`. An exiting row is `data-exiting`, `tabIndex −1`, `inert` and click-through; once the exits finished the
 *   remaining rows glide shut (the settle tick feeds their `layoutDependency`).
 * - The rows are transparent, so they must never slide through each other: a sort (a pure permutation) re-keys the
 *   `AnimatePresence` – the rows remount in their new order and re-run the staggered enter instead of FLIP-crossing –
 *   and rows inserted into the shown list (a widened filter) wait `stagger.insert` so their siblings make room first.
 * - One `RowHighlight` glides between hovered/focused rows; rows dip to `.995` on press.
 * - Sort headers carry a rotating chevron that slides between columns (`layoutId="sort-indicator-{useId}"`).
 * - Rule 13: the detail morph runs over an absolutely positioned ghost `motion.div layoutId="trade-{id}"` measured with
 *   `frame.read` (transform-free offsets) – never over the `<tr>`; the wrapper is `motion.div layoutScroll`.
 *
 * `content-visibility: auto` is deliberately not used on the rows: containment does not apply to internal table
 * boxes (a no-op on `<tr>`), and on cell content it would let off-screen rows drop out of the auto column sizing.
 */
export function TradesTable({ rows, setups, sort, onSort, listKey, onOpen, className }: TradesTableProps) {
  const detail = useUi((s) => s.detail);
  const openDetail = useUi((s) => s.openDetail);
  const reduced = useReducedFx();
  const uid = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const highlight = useRef<RowHighlightHandle>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [settled, setSettled] = useState(0);
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
    (id: string, el: HTMLElement) => {
      const wrap = wrapRef.current;
      if (!wrap) {
        open(id);
        return;
      }
      pendingOpen.current = id;
      frame.read(() => setGhost({ id, ...measureRow(el, wrap) }));
    },
    [open],
  );

  // the rows moved (filter, sort, insert, delete, exits done): the highlight follows its row or leaves
  useEffect(() => {
    highlight.current?.sync();
  }, [listKey, settled]);

  const onExitComplete = useCallback(() => setSettled((n) => n + 1), []);

  // one presence group per sort order; rows mounted after the group's first frame are inserts (`stagger.insert`)
  const groupKey = `${sort.k}:${sort.dir}`;
  const [readyGroup, setReadyGroup] = useState<string | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReadyGroup(groupKey));
    return () => cancelAnimationFrame(id);
  }, [groupKey]);
  const enterDelay = readyGroup === groupKey ? stagger.insert : 0;

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
      col.display({ id: "pnl", header: "P&L", cell: ({ row }) => <PnlCell value={row.original.pnl} /> }),
      col.display({ id: "r", header: "R", cell: ({ row }) => <RCell value={row.original.r} /> }),
      col.display({ id: "result", header: "Ergebnis", cell: ({ row }) => <ResultBadge t={row.original} /> }),
    ],
    [setups],
  );

  // TanStack returns non-memoisable functions; the compiler skips this component (fine – rows are memoised below).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: rows as EnrichedTrade[], columns, getCoreRowModel: getCoreRowModel(), getRowId: (t) => t.id });
  const rowLayoutKey = useMemo(() => `${listKey}~${settled}`, [listKey, settled]);

  return (
    <motion.div ref={wrapRef} layoutScroll className={cn("relative -mx-2 overflow-x-auto px-2", className)}>
      <RowHighlight ref={highlight} root={wrapRef} id={uid} />
      <table className="relative w-full min-w-[900px] border-collapse text-[13px]">
        <thead className="text-left text-[10.5px] text-faint">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const id = h.column.id as ColumnId;
                const sortKey = SORTABLE[id];
                return (
                  <th key={h.id} scope="col" className={CELL[id].th} aria-sort={sortKey ? (sort.k === sortKey ? (sort.dir === 1 ? "ascending" : "descending") : "none") : undefined}>
                    {sortKey ? (
                      <SortHeader k={sortKey} label={String(h.column.columnDef.header)} sort={sort} onSort={onSort} indicatorId={`sort-indicator-${uid}`} />
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody data-trade-list="" onPointerLeave={() => highlight.current?.hover(null)}>
          <AnimatePresence key={groupKey} onExitComplete={onExitComplete}>
            {table.getRowModel().rows.map((row, i) => (
              <TradeRow key={row.id} row={row} index={i} enterDelay={enterDelay} layoutKey={rowLayoutKey} reduced={reduced} onActivate={activate} highlight={highlight} />
            ))}
          </AnimatePresence>
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

interface TradeRowProps {
  row: Row<EnrichedTrade>;
  index: number;
  /** Base delay of this row's enter (only read at mount): 0 in a fresh list, `stagger.insert` for an insert. */
  enterDelay: number;
  layoutKey: string;
  reduced: boolean;
  onActivate: (id: string, el: HTMLElement) => void;
  highlight: RefObject<RowHighlightHandle | null>;
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * One table row. Memoised: the table re-renders for the detail ghost and the settle tick, the cells only when their
 * trade, position or layout key change. While exiting it leaves the tab order and hit-testing at once
 * (`tbody tr[tabindex='0']` counts present rows only).
 */
const TradeRow = memo(function TradeRow({ row, index, enterDelay, layoutKey, reduced, onActivate, highlight }: TradeRowProps) {
  const present = useIsPresent();
  return (
    <motion.tr
      layout="position"
      layoutDependency={layoutKey}
      initial={reduced ? false : ROW_FROM}
      animate={ROW_SHOWN}
      exit={reduced ? ROW_EXIT_REDUCED : ROW_EXIT}
      transition={reduced ? ROW_TRANSITION_REDUCED : rowTransition(index, enterDelay)}
      whileTap={present && !reduced ? ROW_PRESS : undefined}
      tabIndex={present ? 0 : -1}
      inert={!present || undefined}
      data-trade-id={row.id}
      data-exiting={present ? undefined : ""}
      onClick={(e: MouseEvent<HTMLTableRowElement>) => onActivate(row.id, e.currentTarget)}
      onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onActivate(row.id, e.currentTarget);
        }
      }}
      // rows scrolling under a resting pointer fire `pointerenter` without a move: ignored while scrolling (scroll
      // gate); the first real move afterwards picks the row up (`hover()` returns early for an unchanged row)
      onPointerEnter={(e: PointerEvent<HTMLTableRowElement>) => {
        if (e.pointerType !== "touch" && !isScrolling()) highlight.current?.hover(e.currentTarget);
      }}
      onPointerMove={(e: PointerEvent<HTMLTableRowElement>) => {
        if (e.pointerType !== "touch" && !isScrolling()) highlight.current?.hover(e.currentTarget);
      }}
      onFocus={(e: FocusEvent<HTMLTableRowElement>) => {
        if (e.target === e.currentTarget && isFocusVisible(e.currentTarget)) highlight.current?.focus(e.currentTarget);
      }}
      onBlur={(e: FocusEvent<HTMLTableRowElement>) => {
        if (e.target === e.currentTarget) highlight.current?.focus(null);
      }}
      className={cn("cursor-pointer border-t border-line focus-visible:outline-none", !present && "pointer-events-none")}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className={CELL[cell.column.id as ColumnId].td}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </motion.tr>
  );
});

const CHEVRON_PATH = "M2.5 3.75 5 6.25l2.5-2.5";

export interface SortHeaderProps {
  k: SortKey;
  label: string;
  sort: TradeSort;
  onSort: (k: SortKey) => void;
  /** Shared `layoutId` of the active-column indicator (unique per table) – it slides when the sort column changes. */
  indicatorId?: string;
}

/**
 * Sortable header button: `text-signal` on the active column (Plan 2.5 "Tabellen-Kopf"). The direction is the ` ↑`/` ↓`
 * text (screen-reader only, so `Datum ↓` stays the button's text) plus an `aria-hidden` signal chip whose chevron
 * flips on `spring.plus` and slides to the newly sorted column. Inactive columns hint a faint chevron on hover/focus.
 */
export function SortHeader({ k, label, sort, onSort, indicatorId }: SortHeaderProps) {
  const active = sort.k === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={cn("group/sort inline-flex items-center gap-1.5 uppercase tracking-[0.1em] transition-colors hover:text-fg", active && "text-signal")}
    >
      {label}
      {active && <span className="sr-only">{sortArrow(sort.dir)}</span>}
      <span aria-hidden="true" className="relative grid size-4 place-items-center">
        {active ? (
          <motion.span
            layoutId={indicatorId}
            layoutDependency={k}
            className="grid size-4 place-items-center bg-signal/15"
            style={{ borderRadius: radius.pill }}
            transition={{ layout: spring.layout }}
          >
            <motion.span className="grid size-2.5 place-items-center" initial={false} animate={{ rotate: sort.dir === 1 ? 180 : 0 }} transition={spring.plus}>
              <Chevron />
            </motion.span>
          </motion.span>
        ) : (
          <Chevron className="opacity-0 transition-opacity duration-200 group-hover/sort:opacity-50 group-focus-visible/sort:opacity-50" />
        )}
      </span>
    </button>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 10" className={cn("size-2.5", className)}>
      <path d={CHEVRON_PATH} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
