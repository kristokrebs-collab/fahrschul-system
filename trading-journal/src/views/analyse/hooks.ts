/**
 * Data hooks of the Analyse page (P03): the account view of the Hero's account switch, one memo per `view.closed`
 * (`memoClosed` – every card that needs the ratio report shares one computation), and the Monte Carlo / risk-of-ruin
 * runs (worker or idle chunks, aborted when the input changes).
 */
import { useEffect, useMemo, useState } from "react";
import { runMonteCarlo, runRiskOfRuin, isAbort, ratioReport, type MonteCarloOptions, type MonteCarloResult, type RatioReport, type RiskOfRuinInput, type RiskOfRuinResult } from "@/domain/analytics";
import type { AccountView } from "@/domain/account";
import type { EnrichedTrade } from "@/domain/types";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

/** Account view of the Hero's switch (`uiStore.acc`) + settings. */
export function useAnalyseBase() {
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const settings = useJournal((s) => s.settings);
  return { acc, view, settings, cur: settings.currency };
}

const memo = new WeakMap<readonly EnrichedTrade[], Map<string, unknown>>();

/** One computation per `closed` array and key (the account view is memoised by the store, so this is stable). */
export function memoClosed<T>(closed: readonly EnrichedTrade[], key: string, fn: () => T): T {
  let m = memo.get(closed);
  if (!m) memo.set(closed, (m = new Map()));
  if (!m.has(key)) m.set(key, fn());
  return m.get(key) as T;
}

/** The ratio report of an account view (shared by the hero, the widgets and the explainers). */
export function useRatios(view: AccountView): RatioReport {
  return useMemo(() => memoClosed(view.closed, `ratios:${view.start}`, () => ratioReport(view.closed, view)), [view]);
}

export type RunState<T> = { status: "idle" | "running" | "done" | "error"; result: T | null };

type Slot<T> = { key: string; result: T | null; error: boolean };

/**
 * Runs `task` whenever `key` changes (key = the input's fingerprint; the inputs themselves are rebuilt per render).
 * State is only set from the task's callbacks; "running" is derived (the stored result belongs to an older key), so
 * the previous result stays visible while the next one is computed.
 */
function useTask<T>(active: boolean, key: string, task: (signal: AbortSignal) => Promise<T>): RunState<T> {
  const [slot, setSlot] = useState<Slot<T>>({ key: "", result: null, error: false });
  useEffect(() => {
    if (!active) return;
    const ctl = new AbortController();
    task(ctl.signal).then(
      (result) => setSlot({ key, result, error: false }),
      (e) => {
        if (!isAbort(e)) setSlot({ key, result: null, error: true });
      },
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the fingerprint of the task's inputs
  }, [active, key]);
  if (!active) return { status: "idle", result: null };
  if (slot.key !== key) return { status: "running", result: slot.result };
  return { status: slot.error ? "error" : "done", result: slot.result };
}

/** Monte Carlo of `sample` (worker / idle); the previous result stays while a new one runs. */
export function useMonteCarlo(sample: readonly number[] | null, opts: MonteCarloOptions, key: string): RunState<MonteCarloResult> {
  return useTask(!!sample?.length, key, (signal) => runMonteCarlo(sample ?? [], opts, { signal }));
}

/** Risk of ruin (worker / idle). */
export function useRiskOfRuin(input: RiskOfRuinInput | null, opts: { runs?: number; trades?: number; seed?: number }, key: string): RunState<RiskOfRuinResult> {
  return useTask(!!input, key, (signal) => (input ? runRiskOfRuin(input, opts, { signal }) : Promise.reject(new Error("no input"))));
}
