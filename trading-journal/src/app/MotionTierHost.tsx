import { useEffect } from "react";
import { onPlanChange } from "@/billing/planChange";
import { effectivePlanNow, useEffectivePlan } from "@/billing/store";
import { motionTierOf, setMotionTier, useMotionTierSync } from "@/motion/tier";

/**
 * Leaf host of the plan's motion profile (`src/motion/tier.ts`): keeps `html[data-motion-tier]` in step with the SERVER-CONFIRMED plan (the billing
 * store's effective plan: Free without payments, without a login or while the plan is unknown) and answers `setMotionTier` from the same store.
 * Also listens to `onPlanChange` (`billing/planChange.ts`: the purchase flow announces a plan the server confirmed). Renders nothing; a plan change
 * plays the short introduction.
 */
const readPlan = () => effectivePlanNow().plan;

export function MotionTierHost() {
  const plan = useEffectivePlan().plan;
  useMotionTierSync(plan, readPlan);
  // the purchase flow's hook: introduce the new profile at once, not after the next render (`setMotionTier` still takes only the tier the store confirms)
  useEffect(() => onPlanChange(({ to }) => void setMotionTier(motionTierOf(to))), []);
  return null;
}
