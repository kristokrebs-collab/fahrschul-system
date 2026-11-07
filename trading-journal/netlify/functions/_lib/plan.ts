/**
 * Server-side plan lookup (Wave-0 contract, owner P09/P10). The plan is NEVER taken from the client: it comes from
 * `profiles.plan` / `plan_status` / `trial_end`, which only the Stripe webhook (service role) writes.
 * P10 adds the feature matrix (`src/billing/plans.ts`) and `requireFeature` / `requireLimit` on top (end of this file).
 */
import { autoSyncAllowed, exchangeAccessAllowed, FEATURE_INFO, limitOf, PAID_PLANS, planIncludes, upgradePlanFor } from "../../../src/billing/plans";
import { FREE_PLAN, grantsPlan, isPlanId, isPlanStatus, type Feature, type LimitKey, type PlanId, type PlanInfo } from "../../../src/billing/types";
import { isMissingTable } from "./account";
import { envBool, envOptional, isProduction, type ServerEnvName } from "./env";
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

/* ------------------------------------------------------------------ feature gates (P10) */

/**
 * Payments are set up: `STRIPE_SECRET_KEY` plus at least one `STRIPE_PRICE_<PLAN>_<MONTHLY|YEARLY>`. Until then nothing
 * is gated – the client shows "Zahlungen noch nicht eingerichtet" and unlocks every feature, the server does the same.
 */
export function paymentsConfigured(): boolean {
  if (!envOptional("STRIPE_SECRET_KEY")) return false;
  return PAID_PLANS.some((p) => (["MONTHLY", "YEARLY"] as const).some((i) => !!envOptional(`STRIPE_PRICE_${p.toUpperCase()}_${i}` as ServerEnvName)));
}

/**
 * The plan gates are OPEN (everything free) only where that is meant: without Stripe in development, in a deploy preview, in the
 * tests – and in production only when the operator says so on purpose (`ALLOW_UNGATED=true`). A production deploy whose Stripe
 * variables are missing or mistyped therefore FAILS CLOSED (Runde 11, Linse 1 #10): every account counts as Free, the functions that
 * cost money (phone, SMS, AI, background sync) stay shut instead of becoming free for everybody.
 */
export function gatesOpen(): boolean {
  if (paymentsConfigured()) return false;
  return !isProduction() || envBool("ALLOW_UNGATED", false);
}

/** Production without a working Stripe set-up and without `ALLOW_UNGATED`: the server is closed, the operator must act (ops-status says so). */
export function failsClosed(): boolean {
  return !paymentsConfigured() && isProduction() && !envBool("ALLOW_UNGATED", false);
}

/**
 * Features that cost money every time they are used (an Anthropic call). A subscription in the dunning window (`past_due`)
 * keeps the plan's journal features – Stripe is still retrying the card – but NOT these, nor the telephone / SMS (`costPlanOf`):
 * nobody uses Premium's phone or AI on the operator's money while the payment is failing (Runde 11, Linse 1 + 3).
 */
export const COST_FEATURES: ReadonlySet<Feature> = new Set<Feature>(["coachAi", "shotExtract"]);

/** The plan for things that cost money per use: a `past_due` subscription counts as Free there. */
export function costPlan(info: PlanInfo): PlanInfo {
  return info.status === "past_due" ? { ...FREE_PLAN, status: info.status } : info;
}

/** `planOf` for the cost features (phone, SMS, AI): see `costPlan`. */
export async function costPlanOf(userId: string): Promise<PlanInfo> {
  return costPlan(await planOf(userId));
}

/**
 * Throws 402 `plan_required` (German message naming the feature, `details.required` = the cheapest paid plan with it)
 * unless the user's effective plan includes `feature` (`src/billing/plans.ts`). Not gated while the gates are open (`gatesOpen`).
 * The cost features (`COST_FEATURES`) are refused with 402 `payment_past_due` while the payment fails.
 */
export async function requireFeature(userId: string, feature: Feature): Promise<PlanInfo> {
  const base = await planOf(userId);
  const info = COST_FEATURES.has(feature) ? costPlan(base) : base;
  if (planIncludes(info.plan, feature) || gatesOpen()) return base;
  if (base.status === "past_due" && COST_FEATURES.has(feature)) {
    throw new HttpError(402, "payment_past_due", `${FEATURE_INFO[feature].label} ist pausiert, solange die letzte Zahlung nicht geklappt hat. Aktualisiere dein Zahlungsmittel im Kundenportal.`, { feature, plan: base.plan });
  }
  throw new HttpError(402, "plan_required", `${FEATURE_INFO[feature].label} ist in deinem Tarif nicht enthalten.`, { feature, required: upgradePlanFor(feature), plan: info.plan });
}

/**
 * Manual use of a read-only exchange connection (connect, sync by hand, open positions, import): the plan needs a
 * connection quota (`exchangeAccessAllowed`; Free: 1). Not gated while the gates are open (`gatesOpen`). The AUTOMATIC sync is a
 * different question (`autoSyncAllowed`, the cron) – both read `src/billing/plans.ts`, the browser too.
 */
export async function requireExchangeAccess(userId: string): Promise<PlanInfo> {
  const info = await planOf(userId);
  if (exchangeAccessAllowed(info.plan) || gatesOpen()) return info;
  throw new HttpError(402, "plan_required", "Börsen-Verbindungen sind in deinem Tarif nicht enthalten.", { feature: "exchangeSync", required: upgradePlanFor("exchangeSync"), plan: info.plan });
}

/** Throws 402 `plan_required` unless the plan syncs by itself in the background (Pro and up). Not gated while the gates are open (`gatesOpen`). */
export async function requireAutoSync(userId: string): Promise<PlanInfo> {
  const info = await planOf(userId);
  if (autoSyncAllowed(info.plan) || gatesOpen()) return info;
  throw new HttpError(402, "plan_required", `${FEATURE_INFO.exchangeSync.label} ist in deinem Tarif nicht enthalten.`, { feature: "exchangeSync", required: upgradePlanFor("exchangeSync"), plan: info.plan });
}

/**
 * Throws 402 `limit_reached` when `used` already reaches the plan's limit for `key` (e.g. a 2nd exchange connection on
 * Pro). Returns the limit (`Infinity` = unlimited). Not enforced while the gates are open (`gatesOpen`).
 */
export async function requireLimit(userId: string, key: LimitKey, used: number): Promise<number> {
  const info = await planOf(userId);
  const limit = limitOf(info.plan, key);
  if (used < limit || gatesOpen()) return limit;
  throw new HttpError(402, "limit_reached", "Das Limit deines Tarifs ist erreicht.", { key, limit, plan: info.plan });
}

let reportedPayments: boolean | null = null;

/**
 * Tells the database whether payments are switched on (`app_config` key 'billing', migration 0007): the storage
 * policies of the screenshots bucket gate uploads by plan only then (review STOR-01) – the Stripe keys live in the
 * Netlify env, which Postgres cannot see. Written once per function instance and whenever the answer changes; called
 * by billing/status (every client load) and the Stripe webhook. Never throws.
 */
export async function reportPaymentsConfig(): Promise<void> {
  // "on" = the plan gates are ENFORCED: payments are set up, or this is a production deploy that fails closed (`gatesOpen`)
  const on = !gatesOpen();
  if (reportedPayments === on) return;
  try {
    const { error } = await supabaseAdmin()
      .from("app_config")
      .upsert({ key: "billing", value: { paymentsEnabled: on }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (!error || isMissingTable(error)) reportedPayments = on; // without 0007 there is nothing to report
    else console.error("[fn] app_config write failed", error.code);
  } catch (e) {
    console.error("[fn] app_config write failed", e instanceof Error ? e.name : typeof e);
  }
}

/** Tests: forget what was reported. */
export function resetPaymentsReportForTests(): void {
  reportedPayments = null;
}
