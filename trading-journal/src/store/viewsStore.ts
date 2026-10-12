/**
 * Saved views of `Alle Trades` (Journal v3, P06): a named snapshot of the trade filter, the extra filters
 * (`uiStore.tradeExtra`, incl. the v3 ranges) and the sort. Persisted in `storageKey("views")` (`tj2-views` /
 * `tj2share-views`) – a UI preference like `tj2-ui`, never part of a backup and never synced.
 *
 * `applyView(id)` writes the snapshot into `uiStore` in one update; `matchView(state)` tells which saved view the
 * current filter state is (the trades page shows its name).
 */
import { create } from "zustand";
import type { TradeFilter } from "@/domain/types";
import { newId } from "@/lib/ids";
import { jsonEqual } from "./merge3";
import { readJson, storageKey, writeJson } from "./storage";
import { DEFAULT_TRADE_EXTRA, DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT, useUi, type TradeExtraFilter, type TradeSort } from "./uiStore";

export const VIEWS_KEY = storageKey("views");
/** More than this many views make the picker useless; the oldest beyond it are dropped on save. */
export const MAX_VIEWS = 24;

export interface SavedView {
  id: string;
  name: string;
  filter: TradeFilter;
  extra: TradeExtraFilter;
  sort: TradeSort;
  createdAt: string;
}

export interface ViewsState {
  views: SavedView[];
  /** Saves the current (or the given) filter state under `name`; an existing view with the same name is replaced. */
  saveView(name: string, state?: ViewSnapshot): SavedView | null;
  deleteView(id: string): void;
  renameView(id: string, name: string): void;
  /** Applies a saved view to `uiStore` (filter, extra filter and sort in one update). */
  applyView(id: string): boolean;
}

export interface ViewSnapshot {
  filter: TradeFilter;
  extra: TradeExtraFilter;
  sort: TradeSort;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One stored view, tolerant: unknown keys of the filters are dropped, missing ones defaulted. */
export function parseView(raw: unknown): SavedView | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string" || !raw.name.trim()) return null;
  const f = isObj(raw.filter) ? raw.filter : {};
  const filter: TradeFilter = {
    q: typeof f.q === "string" ? f.q : DEFAULT_TRADE_FILTER.q,
    setup: typeof f.setup === "string" ? f.setup : DEFAULT_TRADE_FILTER.setup,
    result: (["all", "win", "loss", "open", "be"] as const).includes(f.result as TradeFilter["result"]) ? (f.result as TradeFilter["result"]) : "all",
    side: f.side === "long" || f.side === "short" ? f.side : "all",
    acc: f.acc === "makro" || f.acc === "scalp" ? f.acc : "all",
  };
  const sRaw = isObj(raw.sort) ? raw.sort : {};
  const sort: TradeSort = {
    k: (["date", "pnl", "r", "setup"] as const).includes(sRaw.k as TradeSort["k"]) ? (sRaw.k as TradeSort["k"]) : DEFAULT_TRADE_SORT.k,
    dir: sRaw.dir === 1 ? 1 : -1,
  };
  return { id: raw.id, name: raw.name.trim(), filter, extra: parseExtra(raw.extra), sort, createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "" };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const STRENGTHS = ["all", "none", "0", "1", "2", "3", "4"] as const;

/** Extra filter of a stored view (only known keys, typed). */
export function parseExtra(raw: unknown): TradeExtraFilter {
  const e = isObj(raw) ? raw : {};
  const out: TradeExtraFilter = {
    mistake: typeof e.mistake === "string" ? e.mistake : DEFAULT_TRADE_EXTRA.mistake,
    strength: STRENGTHS.includes(e.strength as TradeExtraFilter["strength"]) ? (e.strength as TradeExtraFilter["strength"]) : "all",
  };
  for (const k of ["from", "to", "pair", "exchange"] as const) if (typeof e[k] === "string" && e[k]) out[k] = e[k] as string;
  if (e.market === "perp" || e.market === "spot") out.market = e.market;
  if (Array.isArray(e.tags)) {
    const tags = e.tags.filter((x): x is string => typeof x === "string" && x.trim() !== "");
    if (tags.length) out.tags = tags;
  }
  for (const k of ["pnlMin", "pnlMax", "rMin", "rMax", "holdMin", "holdMax", "levMin", "levMax", "ratingMin"] as const) {
    const v = num(e[k]);
    if (v != null) out[k] = v;
  }
  if (e.group === true) out.group = true;
  return out;
}

function load(): SavedView[] {
  const raw = readJson<unknown>(VIEWS_KEY, []);
  if (!Array.isArray(raw)) return [];
  const out: SavedView[] = [];
  for (const r of raw) {
    const v = parseView(r);
    if (v && !out.some((x) => x.id === v.id)) out.push(v);
  }
  return out;
}

function current(): ViewSnapshot {
  const s = useUi.getState();
  return { filter: s.tradeFilter, extra: s.tradeExtra, sort: s.tradeSort };
}

/** Comparable form of a snapshot (unset optional keys and empty tag lists are equal to absent ones). */
function snapshotKey(s: ViewSnapshot): unknown {
  return { filter: s.filter, extra: parseExtra(s.extra), sort: s.sort };
}

export const useViews = create<ViewsState>()((set, get) => ({
  views: load(),
  saveView: (name, state = current()) => {
    const label = name.trim().slice(0, 40);
    if (!label) return null;
    const existing = get().views.find((v) => v.name.toLowerCase() === label.toLowerCase());
    const view: SavedView = {
      id: existing?.id ?? newId("v_"),
      name: label,
      filter: { ...state.filter },
      extra: parseExtra(state.extra),
      sort: { ...state.sort },
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const rest = get().views.filter((v) => v.id !== view.id);
    const views = [...rest, view].slice(-MAX_VIEWS);
    set({ views });
    writeJson(VIEWS_KEY, views);
    return view;
  },
  deleteView: (id) => {
    const views = get().views.filter((v) => v.id !== id);
    if (views.length === get().views.length) return;
    set({ views });
    writeJson(VIEWS_KEY, views);
  },
  renameView: (id, name) => {
    const label = name.trim().slice(0, 40);
    if (!label) return;
    const views = get().views.map((v) => (v.id === id ? { ...v, name: label } : v));
    set({ views });
    writeJson(VIEWS_KEY, views);
  },
  applyView: (id) => {
    const v = get().views.find((x) => x.id === id);
    if (!v) return false;
    useUi.getState().applyTradeView({ filter: v.filter, extra: v.extra, sort: v.sort });
    return true;
  },
}));

/** The saved view the given state equals (filter, extra and sort), else `null`. */
export function matchView(views: readonly SavedView[], state: ViewSnapshot): SavedView | null {
  const key = snapshotKey(state);
  return views.find((v) => jsonEqual(snapshotKey(v), key)) ?? null;
}

/** Re-reads the stored views (another tab saved one). */
export function reloadViews(): void {
  useViews.setState({ views: load() });
}
