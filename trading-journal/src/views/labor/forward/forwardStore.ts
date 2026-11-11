/**
 * Runtime state of the forward test (F23), memory only: what each account is doing right now (loading candles, calculating,
 * the last check, an error with its reason) and the result of the comparison with the backtest. The accounts themselves
 * live in `settings.forward` (`@/domain/forward`).
 */
import { create } from "zustand";
import type { ForwardCompare, Lookback } from "@/domain/forward";

export type RunPhase = "idle" | "loading" | "calc";

export interface Runtime {
  phase: RunPhase;
  /** candle pages loaded / expected while loading */
  load: { done: number; total: number };
  /** ms, the last successful check (also when nothing was new) */
  checkedAt: number | null;
  error: string | null;
  /** the stored state had to be rebuilt from the candles in the last run */
  rebuilt: boolean;
}

export type CompareStatus = "idle" | "loading" | "calc" | "done" | "error";

export interface CompareState {
  status: CompareStatus;
  lookback: Lookback;
  result: ForwardCompare | null;
  error: string | null;
}

export const IDLE_RUNTIME: Runtime = { phase: "idle", load: { done: 0, total: 0 }, checkedAt: null, error: null, rebuilt: false };
export const IDLE_COMPARE: CompareState = { status: "idle", lookback: 365, result: null, error: null };

interface ForwardRuntimeState {
  byId: Record<string, Runtime>;
  compare: Record<string, CompareState>;
  patchRuntime(id: string, p: Partial<Runtime>): void;
  patchCompare(id: string, p: Partial<CompareState>): void;
  forget(id: string): void;
}

export const useForwardRuntime = create<ForwardRuntimeState>()((set) => ({
  byId: {},
  compare: {},
  patchRuntime: (id, p) => set((s) => ({ byId: { ...s.byId, [id]: { ...(s.byId[id] ?? IDLE_RUNTIME), ...p } } })),
  patchCompare: (id, p) => set((s) => ({ compare: { ...s.compare, [id]: { ...(s.compare[id] ?? IDLE_COMPARE), ...p } } })),
  forget: (id) =>
    set((s) => {
      const { [id]: _a, ...byId } = s.byId;
      const { [id]: _b, ...compare } = s.compare;
      void _a;
      void _b;
      return { byId, compare };
    }),
}));

/** Test hook. */
export function __resetForwardRuntime(): void {
  useForwardRuntime.setState({ byId: {}, compare: {} });
}
