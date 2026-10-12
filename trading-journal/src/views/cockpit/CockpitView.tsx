import { Suspense, useEffect, useMemo, useState, type ComponentType, type KeyboardEvent } from "react";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { cn } from "@/lib/cn";
import { HoldButton } from "@/motion/HoldButton";
import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { GlyphZoom, WidgetGrid } from "@/motion/pulse";
import { Reveal } from "@/motion/Reveal";
import { Button } from "@/primitives/Button";
import { EmptyState } from "@/primitives/EmptyState";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { Skeleton } from "@/primitives/Skeleton";
import { useTheme } from "@/store/themeStore";
import { PageHeader } from "@/views/setups/PageHeader";
import { registerBuiltinWidgets } from "./builtins";
import { cockpit, MAX_BOARDS, useCockpit, type BoardItem } from "./cockpitStore";
import { COCKPIT_LEAD_FILL, COCKPIT_STRINGS as S } from "./copy";
import { getWidget, SPANS, useRegistryVersion, type CockpitWidget } from "./registry";
import { WidgetCatalog } from "./WidgetCatalog";

registerBuiltinWidgets();

/** Static class per span (Tailwind needs literal class names). */
export const SPAN_CLASS: Record<number, string> = {
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  12: "lg:col-span-12",
};

/** Edit mode: `WidgetGrid` takes one class for all tiles, so the spans go in as `:nth-child` rules (DOM order = order). */
export function spanRules(scope: string, items: readonly BoardItem[]): string {
  return `@media (min-width: 1024px){${items.map((it, i) => `[data-cockpit-grid="${scope}"]>[role=list]>:nth-child(${i + 1}){grid-column:span ${it.span}/span ${it.span}}`).join("")}}`;
}

/** One widget: own error boundary (a broken card never takes the dashboard down) and a skeleton while it loads. */
function WidgetSlot({ widget }: { widget: CockpitWidget }) {
  const W = widget.component as ComponentType;
  return (
    <ErrorBoundary variant="widget" label={widget.title}>
      <Suspense fallback={<Skeleton height={240} className="rounded-2xl" />}>
        <W />
      </Suspense>
    </ErrorBoundary>
  );
}

/** The new-widget entrance: the wall with "NEU" punched out stands over the tile, then the camera dives through. */
function FreshCover({ id }: { id: string }) {
  const light = useTheme((s) => s.resolved === "light");
  return (
    <GlyphZoom
      word={S.fresh}
      open
      label={S.freshLabel}
      wallColor={light ? "#fdfdfc" : "#111111"}
      className="absolute inset-0 z-30 rounded-2xl"
      onDone={(open) => {
        if (open) cockpit.settled(id);
      }}
    >
      <span />
    </GlyphZoom>
  );
}

function ViewGrid({ items, fresh }: { items: { item: BoardItem; widget: CockpitWidget }[]; fresh: readonly string[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12" data-testid="cockpit-grid">
      {items.map(({ item, widget }, i) => (
        <div key={item.id} className={cn("relative min-w-0", SPAN_CLASS[item.span])} data-widget={item.id}>
          <Reveal index={i % 3} className="h-full">
            <WidgetSlot widget={widget} />
          </Reveal>
          {fresh.includes(item.id) && <FreshCover id={item.id} />}
        </div>
      ))}
    </div>
  );
}

function EditTile({ item, widget }: { item: BoardItem; widget: CockpitWidget }) {
  const k = SPANS.indexOf(item.span);
  return (
    <div className="relative grid h-[280px] grid-rows-[auto_1fr] overflow-hidden rounded-2xl border border-dashed border-white/25 bg-ink-850" data-edit-tile={item.id}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-faint" fill="currentColor" aria-hidden="true">
            {[3, 8, 13].flatMap((y) => [5.5, 10.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />))}
          </svg>
          <span className="truncate text-[13px] font-semibold text-fg">{widget.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1" data-no-drag="">
          <button type="button" className="touch-hit grid size-7 place-items-center rounded-lg border border-line-2 text-[14px] text-fg disabled:opacity-30" aria-label={`${widget.title}: ${S.narrower}`} disabled={k <= 0} onClick={() => cockpit.resize(item.id, -1)}>
            −
          </button>
          <span className="w-10 text-center font-mono text-[11px] text-mute" aria-label={`Breite ${item.span} von 12`}>
            {S.span(item.span)}
          </span>
          <button type="button" className="touch-hit grid size-7 place-items-center rounded-lg border border-line-2 text-[14px] text-fg disabled:opacity-30" aria-label={`${widget.title}: ${S.wider}`} disabled={k >= SPANS.length - 1} onClick={() => cockpit.resize(item.id, 1)}>
            +
          </button>
          <button type="button" className="touch-hit ml-1 grid size-7 place-items-center rounded-lg border border-line-2 text-mute hover:border-loss/50 hover:text-loss" aria-label={`${widget.title}: ${S.remove}`} onClick={() => cockpit.remove(item.id)}>
            <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </span>
      </div>
      {/* live preview of the card, not interactive while arranging */}
      <div inert aria-hidden="true" className="pointer-events-none relative overflow-hidden p-2 opacity-60 [mask-image:linear-gradient(#000_70%,transparent)]">
        {/* a fixed height: cards that fill their grid row (`h-full`, e.g. the equity chart) need one to draw */}
        <div className="h-[320px] origin-top scale-[0.92]">
          <WidgetSlot widget={widget} />
        </div>
      </div>
    </div>
  );
}

/**
 * Workaround for the pulse `WidgetGrid` (P01): a KEYBOARD drop leaves its "a drag just ended" flag set (only a pointer
 * press on a tile clears it), so the next click inside the grid – mouse or Enter on "Entfernen" / "Breiter" – would be
 * swallowed as the end of a drag. After Space / Enter on a tile we hand the grid that one click on its own list
 * element (nothing there reacts to it), so the next real click works. Remove once WidgetGrid resets the flag itself.
 */
function settleKeyboardDrop(e: KeyboardEvent<HTMLDivElement>): void {
  if (e.key !== " " && e.key !== "Enter") return;
  const target = e.target as HTMLElement;
  if (target.getAttribute("role") !== "listitem") return;
  const list = target.closest('[role="list"]');
  list?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function EditGrid({ boardId, items }: { boardId: string; items: { item: BoardItem; widget: CockpitWidget }[] }) {
  const tiles = useMemo(() => items.map(({ item, widget }) => ({ id: item.id, label: widget.title, node: <EditTile item={item} widget={widget} /> })), [items]);
  const order = useMemo(() => items.map((i) => i.item.id), [items]);
  return (
    <div className="grid gap-3">
      <p className="text-[12px] text-mute">{S.editHint}</p>
      <style>{spanRules(boardId, items.map((i) => i.item))}</style>
      <div data-cockpit-grid={boardId} className="contents" onKeyUp={settleKeyboardDrop}>
        <WidgetGrid items={tiles} order={order} onOrderChange={(ids) => cockpit.reorder(ids)} aria-label={S.grid} className="grid grid-cols-1 gap-5 lg:grid-cols-12" />
      </div>
    </div>
  );
}

function BoardBar({ editing }: { editing: boolean }) {
  const boards = useCockpit((s) => s.boards);
  const active = useCockpit((s) => s.active);
  const board = boards.find((b) => b.id === active)!;
  const [name, setName] = useState(board.name);
  const [nameFor, setNameFor] = useState(board.id);
  if (nameFor !== board.id) {
    setNameFor(board.id);
    setName(board.name);
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Segmented aria-label={S.boards} options={boards.map((b) => ({ v: b.id, label: b.name }))} value={active} onChange={(id) => cockpit.setActive(id)} size="sm" />
        {boards.length < MAX_BOARDS && (
          <Button size="sm" onClick={() => cockpit.newBoard()} data-testid="cockpit-new-board">
            + {S.newBoard}
          </Button>
        )}
      </div>
      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={S.boardName}
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => cockpit.rename(name)}
            onKeyDown={(e) => {
              if (e.key === "Enter") cockpit.rename(name);
            }}
            wrapperClassName="w-44"
            className="py-1.5 text-[12.5px]"
          />
          <Button size="sm" onClick={() => cockpit.reset()}>
            {S.reset}
          </Button>
          {boards.length > 1 && (
            <HoldButton size="sm" variant="danger" onConfirm={() => cockpit.deleteActive()} holdLabel={S.deleteHold} aria-label={`${S.deleteBoard} (${S.deleteHold})`}>
              {S.deleteBoard}
            </HoldButton>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Cockpit (P13): your own dashboards from the cards of every page. `h1 Cockpit` (PageHeader), a board switcher,
 * "Anordnen" (edit mode: hold-to-lift drag with tilt and throw – pulse `WidgetGrid` –, widths, remove, rename,
 * reset, delete) and "Widget hinzufügen" (catalog sheet; a new widget enters through a `GlyphZoom` dive). Layout per
 * device in `storageKey("cockpit")`.
 */
export function CockpitView({ className }: { className?: string }) {
  useCloseMorphDialogOnUnmount();
  const version = useRegistryVersion();
  const boards = useCockpit((s) => s.boards);
  const active = useCockpit((s) => s.active);
  const editing = useCockpit((s) => s.editing);
  const fresh = useCockpit((s) => s.fresh);
  const [catalog, setCatalog] = useState(false);
  const board = boards.find((b) => b.id === active) ?? boards[0]!;
  const items = useMemo(() => {
    void version;
    return board.items.flatMap((item) => {
      const widget = getWidget(item.id);
      return widget ? [{ item, widget }] : [];
    });
  }, [board, version]);
  const present = useMemo(() => new Set(board.items.map((i) => i.id)), [board]);

  // leaving the page ends the edit mode
  useEffect(() => () => cockpit.setEditing(false), []);

  const add = (w: CockpitWidget) => {
    cockpit.add(w.id, w.defaultSpan as BoardItem["span"]);
  };

  // a freshly added widget scrolls into view once its tile exists
  const last = fresh[fresh.length - 1];
  useEffect(() => {
    if (!last || catalog) return;
    document.querySelector(`[data-widget="${CSS.escape(last)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [last, catalog]);

  return (
    <div className={cn("grid grid-cols-1 gap-5", className)} data-testid="cockpit">
      <PageHeader
        title={S.title}
        lead={S.lead}
        leadFill={COCKPIT_LEAD_FILL}
        count={items.length}
        countUnit={(n) => (n === 1 ? "Widget" : "Widgets")}
        action={
          <div className="flex flex-wrap items-center gap-2.5">
            <Button onClick={() => cockpit.setEditing(!editing)} aria-pressed={editing} data-testid="cockpit-arrange">
              {editing ? S.done : S.arrange}
            </Button>
            <Button variant="primary" onClick={() => setCatalog(true)} data-testid="cockpit-add">
              + {S.addWidget}
            </Button>
          </div>
        }
      />
      <BoardBar editing={editing} />
      {items.length === 0 ? (
        <EmptyState
          title={S.empty.title}
          text={S.empty.text}
          action={
            <Button variant="primary" onClick={() => setCatalog(true)}>
              {S.empty.action}
            </Button>
          }
          className="min-h-[320px]"
        />
      ) : editing ? (
        <EditGrid boardId={board.id} items={items} />
      ) : (
        <ViewGrid items={items} fresh={fresh} />
      )}
      <WidgetCatalog open={catalog} onClose={() => setCatalog(false)} present={present} onAdd={add} version={version} />
    </div>
  );
}
