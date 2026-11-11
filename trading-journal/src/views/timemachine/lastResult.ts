/**
 * The last finished run of the Zeitmaschine, in memory only (gone with the tab). The assistant reads it to answer „Wie stehen die
 * Chancen für meinen Plan?“ – it never starts a run itself: what was not computed stays missing, and the answer says where to
 * compute it. `at` is when the run finished (shown as the „Stand“).
 */
import type { TmResult } from "@/domain/timemachine/types";

export interface TimeMachineMemory {
  result: TmResult;
  /** epoch ms the run finished */
  at: number;
  /** where the candles came from, when the host said */
  source: string | null;
}

let last: TimeMachineMemory | null = null;

export function rememberTimeMachine(m: TimeMachineMemory): void {
  last = m;
}

export const lastTimeMachine = (): TimeMachineMemory | null => last;

/** Test hook. */
export function __forgetTimeMachine(): void {
  last = null;
}
