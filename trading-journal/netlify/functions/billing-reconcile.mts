/**
 * Scheduled (@daily, published deploys only): the daily comparison with Stripe (`_lib/billingReconcile.ts`) – open subscriptions are
 * read again and written, profiles with a paid plan are recomputed, surplus team seats are removed, referral credits whose hold has run
 * out reach the Stripe balance. It is the safety net behind the webhook (Runde 11): a missed event or a race can no longer leave a plan
 * standing for good. Without `STRIPE_SECRET_KEY` only the database part runs.
 */
import type { Config } from "@netlify/functions";
import { reconcileBilling } from "./_lib/billingReconcile";
import { errorFrom, json } from "./_lib/http";

export default async (): Promise<Response> => {
  try {
    const result = await reconcileBilling();
    console.log("[fn] billing-reconcile", JSON.stringify(result));
    return json(result);
  } catch (e) {
    return errorFrom(e);
  }
};

export const config: Config = { schedule: "@daily" };
