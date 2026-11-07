/**
 * Cockpit dashboards (P13): several named boards, each an ordered list of widgets with a width, persisted per device
 * in `storageKey("cockpit")` (`{ v, active, boards }`, layout only – never journal data). Pure reducers below (tested)
 * + a small zustand store that writes through on every change. Unknown widget ids survive in storage (a package that
 * is not loaded right now keeps its place) and are simply not rendered.
 */
import { create } from "zustand";
import { storageKey } from "@/store/storage";
import { snapSpan, SPANS, type Span } from "./registry";

export const COCKPIT_KEY = storageKey("cockpit");
export const COCKPIT_VERSION = 1;
export const MAX_BOARDS = 4;
export const MAX_ITEMS = 24;
export const NAME_MAX = 24;

export interface BoardItem {
  id: string;
  span: Span;
}

export interface Board {
  id: string;
  name: string;
  items: BoardItem[];
}

export interface CockpitData {
  v: number;
  active: string;
  boards: Board[];
}

/** The two starter boards. "Trade the best": the strongest signals of the journal first – equity, hit rate, which setup earns money, the risk limits. */
export const DEFAULT_BOARDS: readonly Board[] = [
  {
    id: "main",
    name: "Mein Cockpit",
    items: [
      { id: "ov-equity", span: 8 },
      { id: "ov-winrate", span: 4 },
      { id: "ov-ranking", span: 7 },
      { id: "in-findings", span: 5 },
      { id: "risk-limits", span: 7 },
      { id: "ana-heatmap", span: 5 },
      { id: "ov-recent", span: 7 },
      { id: "ov-monthly", span: 5 },
    ],
  },
  {
    id: "risk",
    name: "Risiko",
    items: [
      { id: "risk-limits", span: 7 },
      { id: "risk-exposure", span: 5 },
      { id: "risk-calc", span: 7 },
      { id: "ana-ruin", span: 5 },
      { id: "ana-streaks", span: 12 },
    ],
  },
];

export function defaultData(): CockpitData {
  return { v: COCKPIT_VERSION, active: DEFAULT_BOARDS[0]!.id, boards: DEFAULT_BOARDS.map((b) => ({ ...b, items: b.items.map((i) => ({ ...i })) })) };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Lenient parse of the stored layout (anything broken → the defaults, item by item where possible). */
export function parseCockpit(raw: string | null): CockpitData {
  if (!raw) return defaultData();
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return defaultData();
  }
  if (!isObj(v) || !Array.isArray(v.boards)) return defaultData();
  const boards: Board[] = [];
  const seenBoards = new Set<string>();
  for (const b of v.boards.slice(0, MAX_BOARDS)) {
    if (!isObj(b) || typeof b.id !== "string" || !b.id || seenBoards.has(b.id)) continue;
    seenBoards.add(b.id);
    const seen = new Set<string>();
    const items: BoardItem[] = [];
    for (const it of Array.isArray(b.items) ? b.items.slice(0, MAX_ITEMS) : []) {
      if (!isObj(it) || typeof it.id !== "string" || !it.id || seen.has(it.id)) continue;
      seen.add(it.id);
      items.push({ id: it.id, span: snapSpan(typeof it.span === "number" ? it.span : 6) });
    }
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, NAME_MAX) : "Dashboard";
    boards.push({ id: b.id, name, items });
  }
  if (!boards.length) return defaultData();
  const active = typeof v.active === "string" && boards.some((b) => b.id === v.active) ? v.active : boards[0]!.id;
  return { v: COCKPIT_VERSION, active, boards };
}

/* ------------------------------------------------------------------------------------------------- pure reducers */

const mapBoard = (d: CockpitData, id: string, fn: (b: Board) => Board): CockpitData => ({ ...d, boards: d.boards.map((b) => (b.id === id ? fn(b) : b)) });

export function addItem(d: CockpitData, boardId: string, widgetId: string, span: Span): CockpitData {
  return mapBoard(d, boardId, (b) => (b.items.some((i) => i.id === widgetId) || b.items.length >= MAX_ITEMS ? b : { ...b, items: [...b.items, { id: widgetId, span }] }));
}

export function removeItem(d: CockpitData, boardId: string, widgetId: string): CockpitData {
  return mapBoard(d, boardId, (b) => ({ ...b, items: b.items.filter((i) => i.id !== widgetId) }));
}

/** One step narrower (-1) or wider (+1) along `SPANS`. */
export function resizeItem(d: CockpitData, boardId: string, widgetId: string, dir: 1 | -1): CockpitData {
  return mapBoard(d, boardId, (b) => ({
    ...b,
    items: b.items.map((i) => {
      if (i.id !== widgetId) return i;
      const k = SPANS.indexOf(i.span);
      const next = SPANS[Math.max(0, Math.min(SPANS.length - 1, k + dir))]!;
      return { ...i, span: next };
    }),
  }));
}

/** Applies a new order of ids (unknown ids ignored, missing items kept at the end). */
export function reorderItems(d: CockpitData, boardId: string, ids: readonly string[]): CockpitData {
  return mapBoard(d, boardId, (b) => {
    const by = new Map(b.items.map((i) => [i.id, i]));
    const out: BoardItem[] = [];
    for (const id of ids) {
      const it = by.get(id);
      if (it) {
        out.push(it);
        by.delete(id);
      }
    }
    return { ...b, items: [...out, ...by.values()] };
  });
}

export function addBoard(d: CockpitData, id: string, name?: string): CockpitData {
  if (d.boards.length >= MAX_BOARDS) return d;
  const n = d.boards.length + 1;
  const label = (name?.trim() || `Dashboard ${n}`).slice(0, NAME_MAX);
  return { ...d, active: id, boards: [...d.boards, { id, name: label, items: [] }] };
}

export function renameBoard(d: CockpitData, id: string, name: string): CockpitData {
  const clean = name.trim().slice(0, NAME_MAX);
  return clean ? mapBoard(d, id, (b) => ({ ...b, name: clean })) : d;
}

export function deleteBoard(d: CockpitData, id: string): CockpitData {
  if (d.boards.length <= 1) return d;
  const boards = d.boards.filter((b) => b.id !== id);
  return { ...d, boards, active: d.active === id ? boards[0]!.id : d.active };
}

/** The board back to its starter layout (a starter board) or empty (a board of its own). */
export function resetBoard(d: CockpitData, id: string): CockpitData {
  const starter = DEFAULT_BOARDS.find((b) => b.id === id);
  return mapBoard(d, id, (b) => ({ ...b, items: starter ? starter.items.map((i) => ({ ...i })) : [] }));
}

/* --------------------------------------------------------------------------------------------------------- store */

function read(): CockpitData {
  try {
    return parseCockpit(localStorage.getItem(COCKPIT_KEY));
  } catch {
    return defaultData();
  }
}

function write(d: CockpitData): void {
  try {
    localStorage.setItem(COCKPIT_KEY, JSON.stringify(d));
  } catch {
    // storage blocked: the layout lasts for this session
  }
}

interface CockpitState extends CockpitData {
  editing: boolean;
  /** widgets added in this session that still play their entrance */
  fresh: string[];
}

export const useCockpit = create<CockpitState>(() => ({ ...read(), editing: false, fresh: [] }));

function commit(next: CockpitData): void {
  const { v, active, boards } = next;
  useCockpit.setState({ v, active, boards });
  write({ v, active, boards });
}

const data = (): CockpitData => {
  const s = useCockpit.getState();
  return { v: s.v, active: s.active, boards: s.boards };
};

export const cockpit = {
  setActive(id: string): void {
    if (useCockpit.getState().boards.some((b) => b.id === id)) commit({ ...data(), active: id });
  },
  setEditing(editing: boolean): void {
    useCockpit.setState({ editing });
  },
  add(widgetId: string, span: Span): void {
    const d = data();
    commit(addItem(d, d.active, widgetId, span));
    useCockpit.setState((s) => ({ fresh: [...s.fresh.filter((f) => f !== widgetId), widgetId] }));
  },
  settled(widgetId: string): void {
    useCockpit.setState((s) => ({ fresh: s.fresh.filter((f) => f !== widgetId) }));
  },
  remove(widgetId: string): void {
    const d = data();
    commit(removeItem(d, d.active, widgetId));
  },
  resize(widgetId: string, dir: 1 | -1): void {
    const d = data();
    commit(resizeItem(d, d.active, widgetId, dir));
  },
  reorder(ids: readonly string[]): void {
    const d = data();
    commit(reorderItems(d, d.active, ids));
  },
  newBoard(): void {
    const id = `b_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    commit(addBoard(data(), id));
    useCockpit.setState({ editing: true });
  },
  rename(name: string): void {
    const d = data();
    commit(renameBoard(d, d.active, name));
  },
  deleteActive(): void {
    const d = data();
    commit(deleteBoard(d, d.active));
  },
  reset(): void {
    const d = data();
    commit(resetBoard(d, d.active));
  },
};
