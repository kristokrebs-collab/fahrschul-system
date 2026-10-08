import type { Scenario, ScenarioKey } from "@/domain/trigger";
import type { MarketLevels } from "@/domain/types";
import { n0 } from "@/lib/format";

/** Title of the neutral scenario (no long trigger, no bear case) – the same words as the domain's range scenario. */
export const RANGE_TITLE = "Range, kein Trigger";

/**
 * Decision 13 (2026-10-08): the Übersicht no longer shows a general SHORT trigger – the Einstiegs-Check (multi-TF
 * signal check, long and short) replaced it. The stored `shortTrigger` stays untouched in the settings (no data is
 * deleted); a 4H close under it simply reads as the neutral range on the overview (market panel, scenario toast), and
 * the range text names only the long trigger and the invalidation. The long trigger stays: it is a standalone plan
 * level (4H close above it = the long scenario with its targets and stop) and never needed the short level as a pair.
 * Bear and long pass through unchanged. Pure.
 */
export function overviewScenario(sc: Scenario | null, m: Pick<MarketLevels, "longTrigger" | "invalidation">): Scenario | null {
  if (!sc || (sc.key !== "short" && sc.key !== "range")) return sc;
  const floor = m.invalidation > 0 ? `, über der Invalidierung ${n0(m.invalidation)}` : "";
  return { key: "range", tone: "mute", title: RANGE_TITLE, detail: `4H-Schluss unter dem Long-Trigger ${n0(m.longTrigger)}${floor}. Abwarten – den Einstieg prüft der Einstiegs-Check.` };
}

/** A scenario key persisted before decision 13 (`short`) compares as the neutral range it is shown as now. */
export const shownScenarioKey = (k: ScenarioKey): ScenarioKey => (k === "short" ? "range" : k);
