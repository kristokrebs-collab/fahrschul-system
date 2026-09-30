import { useEffect, useRef } from "react";
import { SCENARIO_TOAST_MS, SCENARIO_TOAST_TITLE, SCENARIO_TOAST_VALUE, scenario, type ScenarioKey } from "@/domain/trigger";
import { lastClosed4h, useFeed } from "@/market";
import { useJournal } from "@/store/journalStore";
import { readJson, writeJson } from "@/store/storage";
import { useUi } from "@/store/uiStore";

/** `tj2-trigger-last` (Plan 4.9): no duplicate toast after a reload. */
export const TRIGGER_LAST_KEY = "tj2-trigger-last";
interface TriggerLast {
  key: ScenarioKey;
  close4hAt: number;
}

/**
 * Bundle `$$`: toast `Neues Szenario: {title}` / `4H {n0(close4h)}` only when the scenario KEY changes
 * (5200 ms, kind `signal`). The last key + close time are persisted so a reload never re-toasts.
 */
export function ScenarioWatcher() {
  const k4 = useFeed("kline_4h");
  const levels = useJournal((s) => s.settings.market);
  const pushToast = useUi((s) => s.pushToast);

  // The feed object changes on every WS tick of the forming bar; only the last CLOSED bar matters.
  const closed = k4 ? lastClosed4h(k4.data) : null;
  const closedT = closed?.t ?? null;
  const closedC = closed?.c ?? null;
  const sc = closedC != null ? scenario(closedC, levels) : null;
  const key = sc?.key ?? null;
  // last persisted value, read once and kept here (no localStorage read per tick)
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
