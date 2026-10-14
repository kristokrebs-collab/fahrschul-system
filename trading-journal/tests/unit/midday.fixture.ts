/**
 * A fixed midday for view tests whose journals put "today's" trades minutes before now (the P05 day loss and pause, the
 * P08 readiness). CI runs in UTC at any hour: at 00:10 the loss closed "20 min ago" was yesterday's, the day loss read
 * 70 instead of 160 and the pause "1 Verlust" instead of "2 Verluste in Folge".
 */
import { vi } from "vitest";

/** Today at 12:30 local time (ms). */
export function middayToday(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 30).getTime();
}

/**
 * Pins `Date` alone at today's midday, time flowing on from there (timers, `performance` and the animations stay real).
 * Call before building the journal; undo with `vi.useRealTimers()`.
 */
export function pinMidday(): void {
  vi.useFakeTimers({ toFake: ["Date"], now: middayToday(), shouldAdvanceTime: true });
}
