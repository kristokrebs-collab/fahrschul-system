/**
 * Entitlements contract (Wave 0 – owner P10). Signatures are final; until P10 lands everything is unlocked:
 * `useEntitlement` → true, `useLimit` → Infinity, `<Gate>` renders its children, `usePlan` → free.
 *
 * Usage (P14 sets the gates according to `plans.ts`):
 * ```tsx
 * <Gate feature="monteCarlo" fallback={<UpgradeTeaser feature="monteCarlo" />}><MonteCarloCard /></Gate>
 * const canSync = useEntitlement("exchangeSync");
 * ```
 * The client view is a convenience – the functions enforce the plan server-side (`_lib/plan.ts` `planOf`).
 */
import type { ReactNode } from "react";
import { FREE_PLAN, type Feature, type LimitKey, type PlanInfo } from "./types";

export * from "./types";

/** Whether the signed-in user's plan includes `feature`. STUB: always true until P10. */
export function useEntitlement(feature: Feature): boolean {
  void feature;
  return true;
}

/** Numeric limit of the user's plan (`Infinity` = unlimited). STUB: always Infinity until P10. */
export function useLimit(key: LimitKey): number {
  void key;
  return Infinity;
}

/** Effective plan of the signed-in user (free when signed out). STUB: always free until P10. */
export function usePlan(): PlanInfo {
  return FREE_PLAN;
}

export interface GateProps {
  feature: Feature;
  /** Rendered instead of `children` when the feature is not included (e.g. an `UpgradeTeaser`). Default: nothing. */
  fallback?: ReactNode;
  children?: ReactNode;
}

/** Renders `children` when the plan includes `feature`, else `fallback`. STUB: always the children until P10. */
export function Gate({ children }: GateProps): ReactNode {
  return children ?? null;
}
