/**
 * How hard the optimiser may work (pure). It runs in short slices ("Zeitscheiben") of `sliceMs` of work, followed by a pause
 * that makes the share of busy time equal to `duty` – a duty of 0.2 means: for every 10 ms of calculation, 40 ms of rest. The
 * host reads the environment (tab visibility, battery, data-saver, pointer) and asks for the duty; the user can choose a
 * power ("Schonend" / "Normal" / "Volle Leistung") as the upper bound. On a phone or with a hidden tab or a low battery it
 * never burns the CPU: duty at most 0.1–0.3, and the note says why.
 */
import type { Power } from "./config";

export interface ThrottleEnv {
  hidden: boolean;
  /** Data-Saver / Save-Data requested by the browser or the OS */
  saveData: boolean;
  /** the battery is low (≤ 20 %) and not charging */
  batteryLow: boolean;
  /** a touch-first device (phone, tablet) */
  coarse: boolean;
  power: Power;
}

export interface Throttle {
  /** share of busy time, 0.05 … 0.9 */
  duty: number;
  /** length of one slice of work (ms) */
  sliceMs: number;
  /** why it is slowed down (German), null at the chosen full speed */
  reason: string | null;
}

export const DEFAULT_THROTTLE: Throttle = { duty: 0.6, sliceMs: 40, reason: null };

export function throttleFor(env: ThrottleEnv): Throttle {
  let duty = env.power === "full" ? 0.85 : env.power === "gentle" ? 0.2 : env.coarse ? 0.3 : 0.6;
  let reason: string | null = null;
  if (env.power === "gentle") reason = "Schonend gewählt";
  else if (env.coarse && env.power === "normal") reason = "Gedrosselt auf dem Handy";
  if (env.hidden && duty > 0.1) {
    duty = 0.1;
    reason = "Gedrosselt, weil die App im Hintergrund ist";
  }
  if ((env.batteryLow || env.saveData) && duty > 0.1) {
    duty = 0.1;
    reason = env.batteryLow ? "Gedrosselt wegen schwachem Akku" : "Gedrosselt wegen Datensparmodus";
  }
  return { duty, sliceMs: env.coarse || env.hidden ? 20 : 40, reason };
}

/** Milliseconds of rest after `workedMs` of work for a duty cycle. */
export const restAfter = (workedMs: number, duty: number): number => Math.round((Math.max(1, workedMs) * (1 - duty)) / Math.max(0.05, duty));
