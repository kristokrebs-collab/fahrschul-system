/**
 * Plan limits of the alarms, read from the ONE tariff source (`src/billing/plans.ts`: `alertChannels`, `phoneCallsPerMonth`).
 *
 * While payments are not set up nothing is gated for the other features – but a telephone call COSTS money, so "open" does not mean
 * "unlimited": the limits of the highest plan with calls (Premium) apply, and the server-wide daily brake (`ALERT_PHONE_DAILY_MAX`, default
 * 50 calls a day over all accounts) and the account's day (`ALERT_PHONE_USER_DAILY_MAX`, default 5) always apply.
 */
import { limitOf } from "../../../../src/billing/plans";
import type { PlanId } from "../../../../src/billing/types";
import { envInt } from "../env";
import { effectivePlan, paymentsConfigured } from "../plan";
import { supabaseAdmin } from "../supabase";

export interface AlertLimits {
  alertChannels: number;
  phoneCallsPerMonth: number;
}

export function alertLimits(plan: PlanId): AlertLimits {
  const p: PlanId = paymentsConfigured() ? plan : "premium";
  return { alertChannels: limitOf(p, "alertChannels"), phoneCallsPerMonth: limitOf(p, "phoneCallsPerMonth") };
}

export interface PhoneBrakes {
  userDayMax: number;
  globalDayMax: number;
}

export const PHONE_USER_DAILY_DEFAULT = 5;
export const PHONE_GLOBAL_DAILY_DEFAULT = 50;

export function phoneBrakes(): PhoneBrakes {
  return {
    userDayMax: Math.max(0, envInt("ALERT_PHONE_USER_DAILY_MAX", PHONE_USER_DAILY_DEFAULT)),
    globalDayMax: Math.max(0, envInt("ALERT_PHONE_DAILY_MAX", PHONE_GLOBAL_DAILY_DEFAULT)),
  };
}

/** Effective plans of many accounts (one query per 100). A plan that cannot be read counts as free. */
export async function plansOf(ids: readonly string[]): Promise<Map<string, PlanId>> {
  const out = new Map<string, PlanId>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabaseAdmin().from("profiles").select("id, plan, plan_status, trial_end").in("id", chunk);
    if (error) {
      console.error("[fn] alerts plans failed", error.code ?? "");
      continue;
    }
    for (const r of (data ?? []) as { id: string; plan: unknown; plan_status: unknown; trial_end: unknown }[]) out.set(r.id, effectivePlan(r).plan);
  }
  return out;
}
