/**
 * The structure view for a consumer that only needs it sometimes (the Markt chart's price lines): without `on` nothing is
 * loaded, retained or run (`null`); with it the store is imported on demand (own chunk) and retained while mounted.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { TrendView } from "./store";

type StoreModule = typeof import("./store");

let loaded: StoreModule | null = null;
let loading: Promise<StoreModule> | null = null;
function loadStore(): Promise<StoreModule> {
  loading ??= import("./store").then((m) => (loaded = m));
  return loading;
}

const noSubscribe = (): (() => void) => () => undefined;
const noView = (): null => null;

export function useTrendView(on: boolean): TrendView | null {
  const [store, setStore] = useState<StoreModule | null>(loaded);
  useEffect(() => {
    if (!on || store) return;
    let alive = true;
    void loadStore().then((m) => alive && setStore(m));
    return () => {
      alive = false;
    };
  }, [on, store]);
  useEffect(() => (on && store ? store.retainTrendlines() : undefined), [on, store]);
  return useSyncExternalStore(store && on ? store.subscribeTrendlines : noSubscribe, store && on ? store.getTrendlines : noView, noView);
}
