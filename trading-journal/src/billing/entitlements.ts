/**
 * Entitlements contract (Wave 0 – owner P10). Signatures are final (`useEntitlement`, `useLimit`, `usePlan`, `<Gate>`).
 *
 * Usage (P14 sets the gates according to `plans.ts`):
 * ```tsx
 * <Gate feature="monteCarlo" fallback={<UpgradeTeaser feature="monteCarlo" />}><MonteCarloCard /></Gate>
 * const canSync = useEntitlement("exchangeSync");
 * ```
 * Rules (mirrors `netlify/functions/_lib/plan.ts` `requireFeature` – the server enforces, this is the client's view):
 * - no billing in this build (file builds, `file://`, claude.ai, no Supabase env) → everything unlocked;
 * - payments not set up (no Stripe env / no functions) → everything unlocked, the pricing page says so honestly;
 * - payments set up → the effective plan's features (`plans.ts`): the server's plan of the signed-in user (cached
 *   per user across reloads), Free when signed out.
 * The plan is never decided here – it comes from `/api/v1/billing/status`, which reads `profiles.plan` (webhook-written).
 */
import type { ReactNode } from "react";
import { useCloudSession } from "@/cloud/session";
import { limitOf, planIncludes } from "./plans";
import { currentMode, effectivePlanOf, useBilling, useBillingMode, useEffectivePlan } from "./store";
import type { Feature, LimitKey, PlanInfo } from "./types";

export * from "./types";

/** Whether the signed-in user's plan includes `feature` (always true while nothing is gated). */
export function useEntitlement(feature: Feature): boolean {
  const mode = useBillingMode();
  const plan = useEffectivePlan();
  return mode !== "open" || planIncludes(plan.plan, feature);
}

/**
 * `useEntitlement` outside React (P14: e.g. the screenshot upload deciding cloud vs. device) – the same rules, read
 * once from the stores at call time.
 */
export function entitledNow(feature: Feature): boolean {
  const mode = currentMode();
  if (mode !== "open") return true;
  const session = useCloudSession.getState();
  const userId = session.phase === "signedIn" ? (session.user?.id ?? null) : null;
  const { account, cached } = useBilling.getState();
  return planIncludes(effectivePlanOf(mode, userId, account, cached).plan, feature);
}

/** Numeric limit of the user's plan (`Infinity` = unlimited, also while nothing is gated). */
export function useLimit(key: LimitKey): number {
  const mode = useBillingMode();
  const plan = useEffectivePlan();
  return mode !== "open" ? Infinity : limitOf(plan.plan, key);
}

/** Effective plan of the signed-in user (free when signed out or without payments). */
export function usePlan(): PlanInfo {
  return useEffectivePlan();
}

export interface GateProps {
  feature: Feature;
  /** Rendered instead of `children` when the feature is not included (e.g. an `UpgradeTeaser`). Default: nothing. */
  fallback?: ReactNode;
  children?: ReactNode;
}

/** Renders `children` when the plan includes `feature`, else `fallback`. */
export function Gate({ feature, fallback = null, children }: GateProps): ReactNode {
  return useEntitlement(feature) ? (children ?? null) : fallback;
}
