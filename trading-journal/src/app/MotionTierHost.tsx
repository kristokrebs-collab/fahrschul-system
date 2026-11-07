import { effectivePlanNow, useEffectivePlan } from "@/billing/store";
import { useMotionTierSync } from "@/motion/tier";

/**
 * Leaf host of the plan's motion profile (`src/motion/tier.ts`): keeps `html[data-motion-tier]` in step with the SERVER-CONFIRMED plan (the billing
 * store's effective plan: Free without payments, without a login or while the plan is unknown) and answers `setMotionTier` from the same store.
 * Renders nothing; a plan change plays the short introduction.
 */
const readPlan = () => effectivePlanNow().plan;

export function MotionTierHost() {
  const plan = useEffectivePlan().plan;
  useMotionTierSync(plan, readPlan);
  return null;
}
