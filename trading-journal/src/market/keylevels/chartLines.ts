/**
 * The user's own key levels as chart lines (`KeyLine`, drawn by `src/chart/levels.ts`): price, a short title with the
 * status in words, and the status itself (weight / dash). Only own, enabled levels of the chart's symbol; the five fixed
 * levels keep their lines.
 *
 * The overview chart is part of the first load, the evaluation is not: without an own level nothing is loaded, retained or
 * run (`undefined` is returned); with one, the status store is imported on demand (own chunk) and the lines first appear
 * without a status word, then follow the status.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { keyLevelsOfSettings } from "@/domain/keylevels/config";
import type { LevelStatus } from "@/domain/keylevels/types";
import { useJournal } from "@/store/journalStore";
import type { KeyLine } from "@/chart/levels";
import { tvSymbolToBinance } from "../symbol";

type StoreModule = typeof import("./store");

const WORD: Record<LevelStatus, string> = { waiting: "wartet", provisional: "vorläufig", confirmed: "bestätigt", invalidated: "ungültig", unknown: "keine Daten" };
const short = (s: string): string => (s.length > 16 ? `${s.slice(0, 15)}…` : s);
const noSubscribe = (): (() => void) => () => undefined;
const noView = (): null => null;

let loaded: StoreModule | null = null;
let loading: Promise<StoreModule> | null = null;
function loadStore(): Promise<StoreModule> {
  loading ??= import("./store").then((m) => (loaded = m));
  return loading;
}

export function useKeyLines(tvSymbol: string): readonly KeyLine[] | undefined {
  const raw = useJournal((s) => s.settings.keyLevels);
  const symbol = tvSymbolToBinance(tvSymbol);
  const wanted = useMemo(() => keyLevelsOfSettings({ keyLevels: raw }).levels.filter((l) => l.enabled && l.symbol === symbol), [raw, symbol]);
  const on = wanted.length > 0;
  const [store, setStore] = useState<StoreModule | null>(loaded);
  useEffect(() => {
    if (!on || store) return;
    let alive = true;
    void loadStore().then((m) => alive && setStore(m));
    return () => {
      alive = false;
    };
  }, [on, store]);
  useEffect(() => (on && store ? store.retainKeyLevels() : undefined), [on, store]);
  const view = useSyncExternalStore(store && on ? store.subscribeKeyLevels : noSubscribe, store && on ? store.getKeyLevels : noView, noView);
  const sig = on ? JSON.stringify(wanted.map((l) => [l.id, l.price, l.name, view?.entries.find((e) => e.level.id === l.id)?.evaluation.status ?? "unknown"])) : "";
  return useMemo(() => {
    if (!on) return undefined;
    return wanted.map((l): KeyLine => {
      const known = view?.entries.find((e) => e.level.id === l.id)?.evaluation.status;
      return { id: l.id, price: l.price, title: known ? `${short(l.name)} · ${WORD[known]}` : short(l.name), status: known ?? "unknown" };
    });
    // `sig` carries everything the lines show; `view` / `wanted` identities change without a visible difference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}
