/**
 * GET /api/v1/billing/status[?invoices=1] – what the pricing page, the plan card and the client gates need (P10):
 * - always `config` (payments set up?, trial days, real Stripe prices, buyable plans) – also for anonymous visitors;
 * - with a bearer token: the effective plan (`profiles`, written only by the webhook), the current subscription, whether
 *   a trial was used, team seats, and with `invoices=1` the newest invoices from Stripe.
 * The client never sends a plan; it only reads this. A session of a 2FA account that has not entered its code yet (aal1)
 * gets the signed-out answer until it has.
 */
import type { Config } from "@netlify/functions";
import { mfaSatisfied, optionalUser } from "./_lib/auth";
import { clientIp, handler, json, requireMethod } from "./_lib/http";
import { hashIp } from "./_lib/audit";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { billingStatus } from "./_lib/stripe";

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  const user = await optionalUser(req);
  await enforceRateLimit(rateKey("billing-status", user?.id ?? hashIp(clientIp(req, ctx)) ?? "anon"), 120, 600);
  const invoices = new URL(req.url).searchParams.get("invoices") === "1";
  // a 2FA account before the code step sees what a visitor sees – no plan details, no invoices (review SEC-01)
  const verified = user && (await mfaSatisfied(user)) ? user : null;
  return json(await billingStatus(verified, { invoices }));
});

export const config: Config = { path: "/api/v1/billing/status", method: ["GET"] };
