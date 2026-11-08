/**
 * POST /api/v1/billing/subscribe – the order paid INSIDE the app (Paket V: Stripe Elements). Same body as `billing-checkout`
 * (`{ plan, interval, seats?, code?, ref?, orderId, consents, consentHash }`), same lock, same consent evidence, the order id is the
 * idempotency key. Answers `{ kind, clientSecret, subscriptionId, trialDays }`:
 * - `setup` (trial): the browser confirms the card with Stripe.js `confirmCardSetup`, then calls this route again with
 *   `{ …same body, setupIntent: "seti_…" }` → `created` (the subscription with the trial and the card as default; the
 *   `setup_intent.succeeded` webhook makes the same one if that call never arrives);
 * - `payment` (no trial): the browser pays the first invoice with `confirmCardPayment`; the subscription stays `incomplete` until then.
 * The card number never reaches this function – only Stripe's ids. "Aktiv" is still only what the webhook writes (`billing/status`).
 * 409 `embedded_unavailable` with Stripe Tax on (the address is asked by Stripe Checkout only → the client uses `billing/checkout`).
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
import { assertRunning } from "./_lib/killswitch";
import { completeEmbedded, createEmbedded } from "./_lib/stripe";

const Body = z.object({
  plan: z.enum(PAID_PLANS),
  interval: z.enum(BILLING_INTERVALS),
  seats: z.number().int().min(1).max(1000).optional(),
  code: z.string().max(40).optional(),
  ref: z.string().max(20).optional(),
  returnTo: z.string().max(200).optional(),
  orderId: z.string().regex(ORDER_ID_RE),
  consents: z.object({ terms: z.boolean(), immediateStart: z.boolean() }),
  consentHash: z.string().regex(/^[0-9a-f]{64}$/),
  setupIntent: z.string().max(100).optional(),
});

export default handler(async (req, ctx) => {
  requireMethod(req, "POST");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  assertRunning("checkout");
  await enforceRateLimit(rateKey("billing-subscribe", user.id), 20, 600);
  const body = await readJson(req, Body, { maxBytes: 2048 });
  if (body.setupIntent) {
    const out = await completeEmbedded(user, { orderId: body.orderId, setupIntent: body.setupIntent });
    await audit(user.id, "billing.checkout", { step: "embedded-created", plan: body.plan, interval: body.interval, order: body.orderId }, clientIp(req, ctx));
    return json(out);
  }
  const out = await createEmbedded(user, body);
  await audit(
    user.id,
    "billing.checkout",
    { step: `embedded-${out.kind}`, plan: body.plan, interval: body.interval, code: !!body.code, ref: !!body.ref, order: body.orderId, consents: true },
    clientIp(req, ctx),
  );
  return json(out);
});

export const config: Config = { path: "/api/v1/billing/subscribe", method: ["POST"] };
