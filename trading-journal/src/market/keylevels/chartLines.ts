/**
 * The user's own key levels as chart lines (`KeyLine`, drawn by `src/chart/levels.ts`): price, a short title with the
 * status in words, and the status itself (weight / dash). Only own, enabled levels of the chart's symbol; the five fixed
 * levels keep their lines. Without such a level nothing is retained and `undefined` is returned (no evaluation runs).
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { keyLevelsOfSettings } from "@/domain/keylevels";
import { useJournal } from "@/store/journalStore";
import type { KeyLine } from "@/chart/levels";
import { tvSymbolToBinance } from "../symbol";
import { getKeyLevels, retainKeyLevels, subscribeKeyLevels } from "./store";

const WORD = { waiting: "wartet", provisional: "vorläufig", confirmed: "bestätigt", invalidated: "ungültig", unknown: "keine Daten" } as const;
const short = (s: string): string => (s.length > 16 ? `${s.slice(0, 15)}…` : s);

export function useKeyLines(tvSymbol: string): readonly KeyLine[] | undefined {
  const raw = useJournal((s) => s.settings.keyLevels);
  const symbol = tvSymbolToBinance(tvSymbol);
  const wanted = useMemo(() => keyLevelsOfSettings({ keyLevels: raw }).levels.filter((l) => l.enabled && l.symbol === symbol), [raw, symbol]);
  const on = wanted.length > 0;
  useEffect(() => (on ? retainKeyLevels() : undefined), [on]);
  const view = useSyncExternalStore(subscribeKeyLevels, getKeyLevels, getKeyLevels);
  const sig = on ? JSON.stringify(wanted.map((l) => [l.id, l.price, l.name, view.entries.find((e) => e.level.id === l.id)?.evaluation.status ?? "unknown"])) : "";
  return useMemo(() => {
    if (!on) return undefined;
    return wanted.map((l): KeyLine => {
      const status = view.entries.find((e) => e.level.id === l.id)?.evaluation.status ?? "unknown";
      return { id: l.id, price: l.price, title: `${short(l.name)} · ${WORD[status]}`, status };
    });
    // `sig` carries everything the lines show; `view` / `wanted` identities change without a visible difference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}
