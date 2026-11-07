/**
 * POST /api/v1/billing/checkout `{ plan, interval, seats?, code?, ref?, returnTo?, orderId, consents, consentHash }` →
 * `{ url, sessionId }` (P10, B4). B4: locked ("nicht eingerichtet") until Stripe AND the operator's legal texts are set up; both
 * consent boxes + the current wording are required and their evidence is stored BEFORE the session exists; `orderId` is the
 * idempotency key (a double click returns the same session); success / cancel URLs only on the site's own origin.
 * Stripe Checkout in subscription mode for the signed-in user: `client_reference_id` + metadata `supabase_user_id`,
 * 14-day trial for the first subscription (30 via a referral, optionally without a card), `allow_promotion_codes` – or
 * a pre-checked promotion code as `discounts` (the two exclude each other), `locale: de`, team seats as quantity.
 * The browser only follows the URL (redirect). 409 `already_subscribed` → the client opens the portal instead.
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { BILLING_INTERVALS } from "../../src/billing/types";
import { PAID_PLANS } from "../../src/billing/plans";
import { ORDER_ID_RE } from "../../src/legal/consentRecord";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, json, readJson, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { createCheckout, siteOrigin } from "./_lib/stripe";

const Body = z.object({
  plan: z.enum(PAID_PLANS),
  interval: z.enum(BILLING_INTERVALS),
  seats: z.number().int().min(1).max(1000).optional(),
  code: z.string().max(40).optional(),
  ref: z.string().max(20).optional(),
  returnTo: z.string().max(200).optional(),
  // B4: one UUID per order (idempotency key), both consent boxes ticked, the hash of the wording the person was shown
  orderId: z.string().regex(ORDER_ID_RE),
  consents: z.object({ terms: z.boolean(), immediateStart: z.boolean() }),
  consentHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export default handler(async (req, ctx) => {
  requireMethod(req, "POST");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("billing-checkout", user.id), 10, 600);
  const body = await readJson(req, Body, { maxBytes: 2048 });
  const out = await createCheckout(user, body, siteOrigin(req));
  await audit(
    user.id,
    "billing.checkout",
    { step: "session", plan: body.plan, interval: body.interval, code: !!body.code, ref: !!body.ref, order: body.orderId, consents: true },
    clientIp(req, ctx),
  );
  return json(out);
});

export const config: Config = { path: "/api/v1/billing/checkout", method: ["POST"] };
