/**
 * Server-side plan lookup (Wave-0 contract, owner P09/P10). The plan is NEVER taken from the client: it comes from
 * `profiles.plan` / `plan_status` / `trial_end`, which only the Stripe webhook (service role) writes.
 * P10 adds the feature matrix (`src/billing/plans.ts`) and a `requireFeature` on top.
 */
import { FREE_PLAN, grantsPlan, isPlanId, isPlanStatus, type PlanId, type PlanInfo } from "../../../src/billing/types";
import { HttpError } from "./http";
import { supabaseAdmin } from "./supabase";

export type { PlanId, PlanInfo };

export interface ProfilePlanRow {
  plan: unknown;
  plan_status: unknown;
  trial_end: unknown;
  seats?: unknown;
}

/** Effective plan of a profile row: a paid plan only counts while its status grants access, else "free". */
export function effectivePlan(row: ProfilePlanRow | null | undefined): PlanInfo {
  if (!row) return { ...FREE_PLAN };
  const status = isPlanStatus(row.plan_status) ? row.plan_status : "none";
  const plan = isPlanId(row.plan) && (row.plan === "free" || grantsPlan(status)) ? row.plan : "free";
  const out: PlanInfo = { plan, status, trialEnd: typeof row.trial_end === "string" ? row.trial_end : null };
  if (typeof row.seats === "number" && row.seats > 0) out.seats = row.seats;
  return out;
}

/** Plan of `userId` from `profiles`; free when the row is missing or unreadable. */
export async function planOf(userId: string): Promise<PlanInfo> {
  const { data, error } = await supabaseAdmin().from("profiles").select("plan, plan_status, trial_end").eq("id", userId).maybeSingle();
  if (error) console.error("[fn] planOf failed", error.code);
  return effectivePlan((data as ProfilePlanRow | null) ?? null);
}

/** Throws 402 `plan_required` unless the user's effective plan is one of `plans`. */
export async function requirePlan(userId: string, plans: readonly PlanId[]): Promise<PlanInfo> {
  const info = await planOf(userId);
  if (!plans.includes(info.plan)) throw new HttpError(402, "plan_required", undefined, { required: plans, plan: info.plan });
  return info;
}
