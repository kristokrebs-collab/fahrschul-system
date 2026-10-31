/**
 * The last finished search of the Muster-Entdecker, in memory only (gone with the tab). The assistant reads it to answer
 * „Was haben meine Gewinner gemeinsam?“ – it never starts a search itself: what was not computed stays missing, and the answer
 * says where to compute it. `at` is when the search finished (shown as the „Stand“).
 */
import type { DiscoveryResult } from "@/domain/discovery/types";

export interface DiscoveryMemory {
  result: DiscoveryResult;
  /** epoch ms the search finished */
  at: number;
  source: "backtest" | "journal";
  label: string | null;
}

let last: DiscoveryMemory | null = null;

export function rememberDiscovery(m: DiscoveryMemory): void {
  last = m;
}

export const lastDiscovery = (): DiscoveryMemory | null => last;

/** Test hook. */
export function __forgetDiscovery(): void {
  last = null;
}
