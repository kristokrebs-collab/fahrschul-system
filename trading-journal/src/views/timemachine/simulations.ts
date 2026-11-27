/**
 * The app's simulation store: IndexedDB first (memory where the browser has none), the cloud only while signed in with the sync
 * allowed. Light on purpose (no Supabase import): the cloud adapter and the client chunk are loaded at the first upload.
 */
import { useEffect, useState } from "react";
import { cloudEnabled } from "@/cloud/env";
import { readPrivacy } from "@/cloud/privacy";
import { ensureCloud, useSyncGate } from "@/cloud/runtime";
import { useCloudSession } from "@/cloud/session";
import type { SimulationRecord } from "@/domain/timemachine/record";
import { createSimulationStore, idbSimStorage, memorySimStorage, type SimCloud, type SimulationStore } from "./simStore";

/** Signed in, the second factor done, the sync switched on for this device and the plan allows it. */
export function canSyncSimulations(): boolean {
  if (!cloudEnabled()) return false;
  const s = useCloudSession.getState();
  return s.phase === "signedIn" && s.user != null && !s.needsMfa && readPrivacy().sync && useSyncGate.getState().entitled;
}

const appCloud: SimCloud = {
  allowed: canSyncSimulations,
  async remote() {
    const user = useCloudSession.getState().user;
    if (!user) throw new Error("Nicht angemeldet");
    const [{ getClient }, { createSupabaseSimulations }] = await Promise.all([ensureCloud(), import("./simCloud")]);
    return createSupabaseSimulations(getClient(), user.id);
  },
};

let current: SimulationStore | null = null;

export interface SignInWatch {
  /** the sync is allowed right now (default: `canSyncSimulations`) */
  allowed?: () => boolean;
  /** calls `fn` after every change of the login state; returns the unsubscribe (default: the cloud session store) */
  subscribe?: (fn: () => void) => () => void;
}

/**
 * A login that comes AFTER simulations were saved: what is `local` / `pending` goes up, and the figures other devices saved come down
 * (without their paths). Runs once at the start when the sync is already allowed, then at every sign-in / finished second factor.
 * Nothing happens while signed out. Returns the unsubscribe.
 */
export function syncOnSignIn(store: SimulationStore, opts: SignInWatch = {}): () => void {
  const allowed = opts.allowed ?? canSyncSimulations;
  const subscribe = opts.subscribe ?? ((fn) => useCloudSession.subscribe(() => fn()));
  let running = false;
  let again = false;
  const run = (): void => {
    if (!allowed()) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    void store
      .flush()
      .then(() => store.pull())
      .catch(() => undefined)
      .finally(() => {
        running = false;
        if (again) {
          again = false;
          run();
        }
      });
  };
  run();
  return subscribe(run);
}

/** The one store of the app (created on first use). */
export function simulations(): SimulationStore {
  if (!current) {
    const made = createSimulationStore(idbSimStorage() ?? memorySimStorage(), appCloud);
    current = made;
    syncOnSignIn(made, { subscribe: (fn) => useCloudSession.subscribe((s, prev) => ((s.phase === "signedIn" && prev.phase !== "signedIn") || (prev.needsMfa && !s.needsMfa) ? fn() : undefined)) });
  }
  return current;
}

/** Tests: another store (`null` forgets it). */
export function setSimulationsForTests(s: SimulationStore | null): void {
  current = s;
}

export type TradeSimulation = { status: "loading" } | { status: "none" } | { status: "found"; record: SimulationRecord };

/** The saved simulation of a trade (re-read when a save, removal or sync changes the store). */
export function useTradeSimulation(tradeId: string | null): TradeSimulation {
  const [state, setState] = useState<{ id: string | null; value: TradeSimulation }>({ id: null, value: { status: "loading" } });
  useEffect(() => {
    if (!tradeId) return;
    let dead = false;
    const store = simulations();
    const read = () =>
      void store.forTrade(tradeId).then(
        (r) => !dead && setState({ id: tradeId, value: r ? { status: "found", record: r } : { status: "none" } }),
        () => !dead && setState({ id: tradeId, value: { status: "none" } }),
      );
    read();
    const off = store.subscribe(read);
    return () => {
      dead = true;
      off();
    };
  }, [tradeId]);
  if (!tradeId) return { status: "none" };
  return state.id === tradeId ? state.value : { status: "loading" };
}
