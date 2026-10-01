import { useEffect, useRef } from "react";
import { SCENARIO_TOAST_MS, SCENARIO_TOAST_TITLE, SCENARIO_TOAST_VALUE, scenario, type ScenarioKey } from "@/domain/trigger";
import { lastClosed4h, useFeedSelect, type Candle, type Stamped } from "@/market";
import { useJournal } from "@/store/journalStore";
import { readJson, writeJson } from "@/store/storage";
import { useUi } from "@/store/uiStore";

/** `tj2-trigger-last` (Plan 4.9): no duplicate toast after a reload. */
export const TRIGGER_LAST_KEY = "tj2-trigger-last";
interface TriggerLast {
  key: ScenarioKey;
  close4hAt: number;
}

export interface Closed4h {
  /** close time, ms */
  t: number;
  /** close price */
  c: number;
}

/**
 * Last closed 4h bar as primitives. The closed bar is always among the last few bars, so only the tail is scanned
 * (the feed holds hundreds of bars and publishes per kline tick).
 */
export function selectClosed4h(v: Stamped<Candle[]> | undefined): Closed4h | null {
  const closed = v ? lastClosed4h(v.data.slice(-4)) : null;
  return closed ? { t: closed.t, c: closed.c } : null;
}

export const sameClosed4h = (a: Closed4h | null, b: Closed4h | null): boolean => a === b || (a !== null && b !== null && a.t === b.t && a.c === b.c);

/**
 * Bundle `$$`: toast `Neues Szenario: {title}` / `4H {n0(close4h)}` only when the scenario KEY changes
 * (5200 ms, kind `signal`). The last key + close time are persisted so a reload never re-toasts. Renders only when
 * the last CLOSED 4h bar changes, never per forming-bar tick.
 */
export function ScenarioWatcher() {
  const closed = useFeedSelect("kline_4h", selectClosed4h, sameClosed4h);
  const levels = useJournal((s) => s.settings.market);
  const pushToast = useUi((s) => s.pushToast);

  const closedT = closed?.t ?? null;
  const closedC = closed?.c ?? null;
  const sc = closedC != null ? scenario(closedC, levels) : null;
  const key = sc?.key ?? null;
  // last persisted value, read once and kept here (no localStorage read per render)
  const last = useRef<TriggerLast | null | undefined>(undefined);

  useEffect(() => {
    if (closedT == null || closedC == null || !sc || key == null) return;
    if (last.current === undefined) last.current = readJson<TriggerLast | null>(TRIGGER_LAST_KEY, null);
    const prev = last.current;
    const next: TriggerLast = { key, close4hAt: closedT };
    if (!prev) {
      last.current = next;
      writeJson(TRIGGER_LAST_KEY, next);
      return;
    }
    if (prev.key === key || closedT <= prev.close4hAt) return;
    pushToast({ kind: "signal", title: SCENARIO_TOAST_TITLE(sc), value: SCENARIO_TOAST_VALUE(closedC), duration: SCENARIO_TOAST_MS });
    last.current = next;
    writeJson(TRIGGER_LAST_KEY, next);
    // `sc` is derived from (closedC, levels) → keyed on the scenario key and the close time only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, closedT, closedC, pushToast]);

  return null;
}
