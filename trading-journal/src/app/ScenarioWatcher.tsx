import { useEffect } from "react";
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

  useEffect(() => {
    if (!k4) return;
    const closed = lastClosed4h(k4.data);
    if (!closed) return;
    const sc = scenario(closed.c, levels);
    if (!sc) return;
    const last = readJson<TriggerLast | null>(TRIGGER_LAST_KEY, null);
    if (!last) {
      writeJson(TRIGGER_LAST_KEY, { key: sc.key, close4hAt: closed.t } satisfies TriggerLast);
      return;
    }
    if (last.key === sc.key || closed.t <= last.close4hAt) return;
    pushToast({ kind: "signal", title: SCENARIO_TOAST_TITLE(sc), value: SCENARIO_TOAST_VALUE(closed.c), duration: SCENARIO_TOAST_MS });
    writeJson(TRIGGER_LAST_KEY, { key: sc.key, close4hAt: closed.t } satisfies TriggerLast);
  }, [k4, levels, pushToast]);

  return null;
}
