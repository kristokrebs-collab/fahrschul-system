import { create } from "zustand";
import type { TradeFilter } from "@/domain/types";
import { KEYS, readJson, writeJson } from "./storage";

/* ---------------------------------------------------------------- types */

export const PAGES = ["overview", "trades", "setups", "settings"] as const;
export type Page = (typeof PAGES)[number];
/** Page keys of the original bundle (`o|t|s|e`). */
export const PAGE_KEYS: Record<Page, "o" | "t" | "s" | "e"> = { overview: "o", trades: "t", setups: "s", settings: "e" };

export type AccFilter = "all" | "makro" | "scalp";
export type SortKey = "date" | "pnl" | "r" | "setup";
export interface TradeSort {
  k: SortKey;
  dir: -1 | 1;
}
export type DetailSource = "recent" | "table" | "marker" | null;
export interface DetailState {
  id: string | null;
  source: DetailSource;
}
export interface EditorState {
  open: boolean;
  tradeId?: string;
  fromFab: boolean;
}
export interface SetupEditorState {
  open: boolean;
  setupId?: string;
  fromTrade: boolean;
}
export type ChartInterval = "1m" | "1h" | "4h";
export type ChartPane = "ratio" | "oi" | "cvd";
export interface ChartPrefs {
  interval: ChartInterval;
  rangeDays: number;
  pane: ChartPane;
  open: boolean;
}

export type ToastKind = "success" | "error" | "signal" | "info";
export interface ToastInput {
  kind: ToastKind;
  title: string;
  value?: string;
  valueTone?: "win" | "loss";
  detail?: string;
  /** Override auto-dismiss (ms); `0` keeps the toast until dismissed. */
  duration?: number;
}
export interface Toast extends ToastInput {
  id: number;
}

/** Non-journal preferences, persisted in `tj2-ui` (never part of a backup). */
export interface UiPrefs {
  theme: "dark" | "light";
  hideLocalBanner: boolean;
  sparkline: "readings" | "live";
  topTraderBase: "accounts" | "positions";
  useProxy: boolean;
  chart: ChartPrefs;
  flags: Record<string, boolean>;
}

/** Bundle `y0`. */
export const DEFAULT_TRADE_FILTER: TradeFilter = { q: "", setup: "all", result: "all", side: "all", acc: "all" };
export const DEFAULT_TRADE_SORT: TradeSort = { k: "date", dir: -1 };
export const DEFAULT_CHART: ChartPrefs = { interval: "4h", rangeDays: 90, pane: "ratio", open: true };
export const DEFAULT_PREFS: UiPrefs = {
  theme: "dark",
  hideLocalBanner: false,
  sparkline: "readings",
  topTraderBase: "accounts",
  useProxy: false,
  chart: DEFAULT_CHART,
  flags: {},
};

/** Auto-dismiss durations of the bundle toast island. */
export const TOAST_MS = { default: 2800, signal: 5200 } as const;

export interface UiState extends UiPrefs {
  page: Page;
  acc: AccFilter;
  tradeFilter: TradeFilter;
  tradeSort: TradeSort;
  detail: DetailState;
  editor: EditorState;
  setupEditor: SetupEditorState;
  transitioning: boolean;
  toasts: Toast[];

  setPage(page: Page): void;
  setAcc(acc: AccFilter): void;
  setTradeFilter(patch: Partial<TradeFilter>): void;
  resetTradeFilter(): void;
  setTradeSort(sort: TradeSort): void;
  /** Same column flips direction; a new column starts with `setup → 1`, everything else `−1` (bundle). */
  toggleSort(k: SortKey): void;
  openDetail(id: string, source: Exclude<DetailSource, null>): void;
  closeDetail(): void;
  openEditor(opts?: { tradeId?: string; fromFab?: boolean }): void;
  closeEditor(): void;
  openSetupEditor(opts?: { setupId?: string; fromTrade?: boolean }): void;
  closeSetupEditor(): void;
  setTransitioning(v: boolean): void;
  pushToast(t: ToastInput): number;
  dismissToast(id: number): void;
  setPref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void;
  setChart(patch: Partial<ChartPrefs>): void;
  setFlag(name: string, value: boolean): void;
}

/* ---------------------------------------------------------- persistence */

const PREF_KEYS: ReadonlyArray<keyof UiPrefs> = ["theme", "hideLocalBanner", "sparkline", "topTraderBase", "useProxy", "chart", "flags"];

function pickPrefs(s: UiPrefs): UiPrefs {
  return {
    theme: s.theme,
    hideLocalBanner: s.hideLocalBanner,
    sparkline: s.sparkline,
    topTraderBase: s.topTraderBase,
    useProxy: s.useProxy,
    chart: s.chart,
    flags: s.flags,
  };
}

/** Reads `tj2-ui`, tolerating missing/invalid values field by field. */
export function loadPrefs(): UiPrefs {
  const raw = readJson<Partial<UiPrefs> | null>(KEYS.ui, null);
  if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
  const chart: Partial<ChartPrefs> = raw.chart && typeof raw.chart === "object" ? raw.chart : {};
  return {
    theme: raw.theme === "light" ? "light" : "dark",
    hideLocalBanner: raw.hideLocalBanner === true,
    sparkline: raw.sparkline === "live" ? "live" : "readings",
    topTraderBase: raw.topTraderBase === "positions" ? "positions" : "accounts",
    useProxy: raw.useProxy === true,
    chart: {
      interval: chart.interval === "1m" || chart.interval === "1h" ? chart.interval : DEFAULT_CHART.interval,
      rangeDays: typeof chart.rangeDays === "number" && chart.rangeDays > 0 ? chart.rangeDays : DEFAULT_CHART.rangeDays,
      pane: chart.pane === "oi" || chart.pane === "cvd" ? chart.pane : DEFAULT_CHART.pane,
      open: chart.open !== false,
    },
    flags: raw.flags && typeof raw.flags === "object" ? { ...raw.flags } : {},
  };
}

/**
 * Tiny persist helper: writes `pick(state)` to `key` whenever it changes (shallow compare of the picked keys).
 * Returns an unsubscribe function.
 */
export function persistSlice<S, T extends object>(
  subscribe: (listener: (state: S, prev: S) => void) => () => void,
  key: string,
  pick: (s: S) => T,
): () => void {
  return subscribe((state, prev) => {
    const a = pick(state);
    const b = pick(prev);
    for (const k of Object.keys(a) as Array<keyof T>) {
      if (a[k] !== b[k]) {
        writeJson(key, a);
        return;
      }
    }
  });
}

/* ------------------------------------------------------------------ store */

let toastSeq = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

export const useUi = create<UiState>()((set, get) => ({
  ...loadPrefs(),
  page: "overview",
  acc: "all",
  tradeFilter: DEFAULT_TRADE_FILTER,
  tradeSort: DEFAULT_TRADE_SORT,
  detail: { id: null, source: null },
  editor: { open: false, fromFab: false },
  setupEditor: { open: false, fromTrade: false },
  transitioning: false,
  toasts: [],

  setPage: (page) => set({ page }),
  setAcc: (acc) => set({ acc }),
  setTradeFilter: (patch) => set((s) => ({ tradeFilter: { ...s.tradeFilter, ...patch } })),
  resetTradeFilter: () => set({ tradeFilter: DEFAULT_TRADE_FILTER }),
  setTradeSort: (tradeSort) => set({ tradeSort }),
  toggleSort: (k) =>
    set((s) => ({
      tradeSort: s.tradeSort.k === k ? { k, dir: s.tradeSort.dir === 1 ? -1 : 1 } : { k, dir: k === "setup" ? 1 : -1 },
    })),
  openDetail: (id, source) => {
    if (get().transitioning) return;
    set({ detail: { id, source } });
  },
  closeDetail: () => set({ detail: { id: null, source: null } }),
  openEditor: (opts = {}) => set({ editor: { open: true, tradeId: opts.tradeId, fromFab: opts.fromFab === true } }),
  closeEditor: () => set((s) => ({ editor: { ...s.editor, open: false } })),
  openSetupEditor: (opts = {}) =>
    set({ setupEditor: { open: true, setupId: opts.setupId, fromTrade: opts.fromTrade === true } }),
  closeSetupEditor: () => set((s) => ({ setupEditor: { ...s.setupEditor, open: false } })),
  setTransitioning: (transitioning) => set({ transitioning }),
  pushToast: (t) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    const ms = t.duration ?? (t.kind === "signal" ? TOAST_MS.signal : TOAST_MS.default);
    if (ms > 0) toastTimers.set(id, setTimeout(() => get().dismissToast(id), ms));
    return id;
  },
  dismissToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) clearTimeout(timer);
    toastTimers.delete(id);
    set((s) => (s.toasts.some((t) => t.id === id) ? { toasts: s.toasts.filter((t) => t.id !== id) } : s));
  },
  setPref: (key, value) => set({ [key]: value } as Pick<UiPrefs, typeof key>),
  setChart: (patch) => set((s) => ({ chart: { ...s.chart, ...patch } })),
  setFlag: (name, value) => set((s) => ({ flags: { ...s.flags, [name]: value } })),
}));

persistSlice(useUi.subscribe, KEYS.ui, pickPrefs);

/** Convenience for non-React code (`pushToast({ kind: "error", title: "Export fehlgeschlagen" })`). */
export function pushToast(t: ToastInput): number {
  return useUi.getState().pushToast(t);
}

export { PREF_KEYS };
