/**
 * POST /api/v1/stripe/webhook – Stripe → us (P10). The RAW body is verified against `stripe-signature` with
 * `STRIPE_WEBHOOK_SECRET` (`constructEventAsync`, 300 s tolerance) before anything is parsed; then the event runs once
 * (`stripe_events` idempotency) through `handleStripeEvent`:
 * checkout.session.completed · customer.subscription.created / updated / deleted / paused / resumed / trial_will_end ·
 * invoice.paid · invoice.payment_failed. Subscription events re-read the subscription from Stripe (order-safe) and
 * recompute `profiles.plan`. 2xx = done (also for ignored types), 4xx = bad signature, 5xx / 409 = Stripe retries.
 * Register: Stripe Dashboard → Webhooks → `https://<site>/api/v1/stripe/webhook` with exactly these events.
 */
import type { Config } from "@netlify/functions";
import { handler, HttpError, json, requireMethod } from "./_lib/http";
import { reportPaymentsConfig } from "./_lib/plan";
import { processEvent, verifyWebhook } from "./_lib/stripe";

/** Stripe events are far below this; anything bigger is not from Stripe. */
const MAX_BYTES = 1024 * 1024;

export default handler(async (req) => {
  requireMethod(req, "POST");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) throw new HttpError(413, "payload_too_large");
  // the raw text – never req.json() first: the signature covers the exact bytes
  const raw = await req.text();
  if (raw.length > MAX_BYTES) throw new HttpError(413, "payload_too_large");
  const event = await verifyWebhook(raw, req.headers.get("stripe-signature"));
  const { result } = await processEvent(event);
  await reportPaymentsConfig(); // payments are evidently on (review STOR-01)
  return json({ received: true, result });
});

export const config: Config = { path: "/api/v1/stripe/webhook", method: ["POST"] };
