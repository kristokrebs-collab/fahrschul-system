/**
 * State of the extra cards under the diagnosis (F20 stress scenarios, F17 filter comparison). Both repeat the SHOWN run's
 * set-up (`shownRunInput()`) through the lab's runner (worker or idle chunks) when the user asks; nothing is computed
 * before. A finished or running extra belongs to one run: a new run clears them. The filter choice is a per-viewer
 * convenience (localStorage, versioned, works without it).
 */
import { create } from "zustand";
import { isLabAbort, runExtra } from "@/domain/backtest/index";
import type { FilterCompare } from "@/domain/lab/filters";
import { sanitizeFilters, type FilterId, type FilterSelection } from "@/domain/lab/filters/types";
import type { StressRows } from "@/domain/lab/stress/types";
import { storageKey } from "@/store/storage";
import { shownRunInput, useLabor } from "./laborStore";
import { LABOR } from "./strings";

export type ExtraStatus = "idle" | "running" | "done" | "error" | "cancelled";

export interface ExtraSlice<R> {
  status: ExtraStatus;
  progress: number;
  result: R | null;
  error: string | null;
}

const idle = <R>(): ExtraSlice<R> => ({ status: "idle", progress: 0, result: null, error: null });

interface ExtrasState {
  stress: ExtraSlice<StressRows>;
  filters: ExtraSlice<FilterCompare>;
  selection: FilterSelection;
  setFilterOn(id: FilterId, on: boolean): void;
  setFilterParam(key: "rsiLimit" | "trendLen", value: number): void;
}

const SEL_KEY = storageKey("labor-filters");

function readSelection(): FilterSelection {
  try {
    const raw = globalThis.localStorage?.getItem(SEL_KEY);
    return sanitizeFilters(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeFilters(null);
  }
}

function writeSelection(sel: FilterSelection): void {
  try {
    globalThis.localStorage?.setItem(SEL_KEY, JSON.stringify(sel));
  } catch {
    /* private mode / quota: works without remembering */
  }
}

export const useExtras = create<ExtrasState>()((set, get) => ({
  stress: idle(),
  filters: idle(),
  selection: readSelection(),
  setFilterOn(id, on) {
    const cur = get().selection;
    const next = sanitizeFilters({ ...cur, on: on ? [...cur.on, id] : cur.on.filter((x) => x !== id) });
    writeSelection(next);
    // the shown comparison belongs to the old choice
    set({ selection: next, filters: get().filters.status === "running" ? get().filters : idle() });
  },
  setFilterParam(key, value) {
    const next = sanitizeFilters({ ...get().selection, [key]: value });
    writeSelection(next);
    set({ selection: next, filters: get().filters.status === "running" ? get().filters : idle() });
  },
}));

const ctl: Record<"stress" | "filters", AbortController | null> = { stress: null, filters: null };
let lastUi = 0;

function patch(kind: "stress" | "filters", p: Partial<Pick<ExtraSlice<unknown>, "status" | "progress" | "error">>): void {
  useExtras.setState((s) => (kind === "stress" ? { stress: { ...s.stress, ...p } } : { filters: { ...s.filters, ...p } }));
}

async function start(kind: "stress" | "filters"): Promise<void> {
  ctl[kind]?.abort();
  const input = shownRunInput();
  if (!input) {
    patch(kind, { status: "error", error: LABOR.extras.noRun, progress: 0 });
    return;
  }
  const mine = new AbortController();
  ctl[kind] = mine;
  useExtras.setState(kind === "stress" ? { stress: { status: "running", progress: 0, result: null, error: null } } : { filters: { status: "running", progress: 0, result: null, error: null } });
  try {
    const res = await runExtra(kind === "stress" ? { base: input, what: "stress" } : { base: input, what: "filters", filters: useExtras.getState().selection }, {
      signal: mine.signal,
      onProgress: (p) => {
        const t = Date.now();
        if (ctl[kind] !== mine || t - lastUi < 120) return;
        lastUi = t;
        patch(kind, { progress: p });
      },
    });
    if (ctl[kind] !== mine) return;
    if (res.what === "stress") useExtras.setState({ stress: { status: "done", progress: 1, result: res.rows, error: null } });
    else useExtras.setState({ filters: { status: "done", progress: 1, result: res.compare, error: null } });
  } catch (e) {
    if (ctl[kind] !== mine) return;
    if (isLabAbort(e) || (e instanceof Error && e.name === "AbortError")) patch(kind, { status: "cancelled", error: LABOR.extras.cancelled, progress: 0 });
    else {
      console.error("Labor: Zusatzlauf fehlgeschlagen", e);
      patch(kind, { status: "error", error: LABOR.extras.failed, progress: 0 });
    }
  } finally {
    if (ctl[kind] === mine) ctl[kind] = null;
  }
}

export const runStress = (): Promise<void> => start("stress");
export const runFilters = (): Promise<void> => start("filters");

export function cancelExtra(kind: "stress" | "filters"): void {
  ctl[kind]?.abort();
}

/** A new or reset run clears both extras (they described the old one) and stops what is still running. */
function clearAll(): void {
  ctl.stress?.abort();
  ctl.filters?.abort();
  ctl.stress = null;
  ctl.filters = null;
  useExtras.setState({ stress: idle(), filters: idle() });
}

useLabor.subscribe((s, prev) => {
  if (s.runSeq !== prev.runSeq || (s.result == null && prev.result != null)) clearAll();
});

/** Test hook. */
export function __resetExtras(): void {
  clearAll();
  useExtras.setState({ selection: sanitizeFilters(null) });
}
