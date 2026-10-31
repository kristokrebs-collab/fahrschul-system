/**
 * Device-side state of the daily check-in prompt (F61): the injectable clock and "Später". Everything that must hold on
 * EVERY device – answered, skipped – lives in the synced day entry (`checkin.status`), not here. "Später" is per device
 * (`storageKey("checkin-snooze")` = `{ day, until }`, every access in try/catch via `@/store/storage`; a private window just
 * starts without) and ends with the day.
 */
import { create } from "zustand";
import { checkinConfigOf, deviceTimeZone, snoozeFor, type Snooze } from "@/domain/checkin";
import { useJournal } from "@/store/journalStore";
import { readJsonDetailed, storageKey, writeJson } from "@/store/storage";

export const SNOOZE_KEY = storageKey("checkin-snooze");

let clock: () => number = () => Date.now();
/** The clock of the check-in (tests inject theirs; `null` restores the real one). */
export function setCheckinClock(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now());
}
export const checkinNow = (): number => clock();

function readSnooze(): Snooze | null {
  const r = readJsonDetailed<unknown>(SNOOZE_KEY);
  if (r.status !== "ok" || typeof r.value !== "object" || r.value === null) return null;
  const v = r.value as Record<string, unknown>;
  return typeof v.day === "string" && typeof v.until === "number" && Number.isFinite(v.until) ? { day: v.day, until: v.until } : null;
}

export const useSnooze = create<{ snooze: Snooze | null }>()(() => ({ snooze: readSnooze() }));

/** "Später": ask again at the reminder time (else in two hours) – on this device only. */
export function snoozeCheckin(now: number = checkinNow()): Snooze {
  const snooze = snoozeFor(now, checkinConfigOf(useJournal.getState().settings), deviceTimeZone());
  writeJson(SNOOZE_KEY, snooze);
  useSnooze.setState({ snooze });
  return snooze;
}

/** `{ prompt: false }` = this device does not ask (the account-wide switch is `settings.checkin.prompt`). */
export const DEVICE_KEY = storageKey("checkin-device");

function readDeviceOff(): boolean {
  const r = readJsonDetailed<unknown>(DEVICE_KEY);
  return r.status === "ok" && typeof r.value === "object" && r.value !== null && (r.value as Record<string, unknown>).prompt === false;
}

export const useDevicePrompt = create<{ off: boolean }>()(() => ({ off: readDeviceOff() }));

/** Switches the daily prompt on / off for THIS device only. */
export function setDevicePrompt(on: boolean): void {
  writeJson(DEVICE_KEY, { prompt: on });
  useDevicePrompt.setState({ off: !on });
}

/** Forgets the snooze (tests). */
export function resetSnooze(): void {
  writeJson(SNOOZE_KEY, null);
  useSnooze.setState({ snooze: null });
}
