/**
 * When does the daily check-in ask? (F61) One pure decision from the clock, the configured zone and what the journal
 * already knows – so it is testable with an injected clock and gives the same answer on every device:
 *
 * - the "day" is the calendar day of the configured time zone (`dayKeyIn`), so after midnight the next day asks again and a
 *   23 h / 25 h day is still exactly one day;
 * - a day with a stored outcome – answered ("Erledigt"/saved) or "Heute überspringen" – never asks again, on ANY device: the
 *   outcome lives in the synced day entry. A second device that has not synced yet is held back until the first sync has
 *   landed (`synced`), so it does not ask for what the first device already answered;
 * - "Später" is a per-device snooze (until the reminder time, else two hours) and ends with the day;
 * - it never asks before the intro / onboarding is done, while any dialog or editor is open, or when the trader turned the
 *   prompt off. A missing check-in stays missing – nothing here ever fills a day in.
 */
import type { DayNotes } from "../types";
import { checkinStatusOf, type CheckinStatus } from "../psych/checkin";
import type { CheckinConfig } from "./config";
import { effectiveTimeZone } from "./config";
import { dayKeyIn, nextWallTime, parseClock } from "./day";

/** "Später" without a reminder time asks again after this long. */
export const SNOOZE_MS = 2 * 3_600_000;

export interface Snooze {
  /** the day (zone key) it was snoozed on – a new day ignores it */
  day: string;
  /** instant (ms) the prompt may ask again */
  until: number;
}

export interface PromptEnv {
  /** the clock (injected in tests) */
  now: number;
  config: CheckinConfig;
  /** this device's zone (used when none is configured) */
  deviceTz: string;
  days: DayNotes;
  /** the journal is loaded and – with a cloud login – the first sync has landed (or gave up) */
  synced: boolean;
  /** intro finished AND onboarding finished / skipped / not needed */
  introDone: boolean;
  /** an editor, detail, sheet or dialog is open */
  blocked: boolean;
  snooze: Snooze | null;
}

export type PromptWhy = "disabled" | "answered" | "skipped" | "not-ready" | "blocked" | "snoozed";

export type PromptDecision = { show: true; day: string } | { show: false; day: string; why: PromptWhy };

export function decidePrompt(env: PromptEnv): PromptDecision {
  const tz = effectiveTimeZone(env.config, env.deviceTz);
  const day = dayKeyIn(env.now, tz);
  if (!env.config.prompt) return { show: false, day, why: "disabled" };
  const status: CheckinStatus | null = checkinStatusOf(env.days[day]);
  if (status === "done") return { show: false, day, why: "answered" };
  if (status === "skipped") return { show: false, day, why: "skipped" };
  if (!env.synced || !env.introDone) return { show: false, day, why: "not-ready" };
  if (env.snooze && env.snooze.day === day && env.now < env.snooze.until) return { show: false, day, why: "snoozed" };
  if (env.blocked) return { show: false, day, why: "blocked" };
  return { show: true, day };
}

/** The snooze "Später" sets: until today's reminder time when it is still ahead, else `SNOOZE_MS` from now. */
export function snoozeFor(now: number, config: Pick<CheckinConfig, "timeZone" | "reminder">, deviceTz: string): Snooze {
  const tz = effectiveTimeZone(config, deviceTz);
  const day = dayKeyIn(now, tz);
  const minutes = parseClock(config.reminder);
  if (minutes != null) {
    const at = nextWallTime(now, tz, minutes);
    // only a reminder that falls on the same day counts; past it, the two hours
    if (dayKeyIn(at, tz) === day) return { day, until: at };
  }
  return { day, until: now + SNOOZE_MS };
}

/** The check-in of `day` is filled in on a later day than it describes. */
export const isLateFill = (day: string, now: number, config: Pick<CheckinConfig, "timeZone">, deviceTz: string): boolean => day < dayKeyIn(now, effectiveTimeZone(config, deviceTz));
