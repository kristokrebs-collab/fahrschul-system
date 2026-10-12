/**
 * POST /api/v1/billing/portal (P10) – two kinds of request:
 * - `{ flow: "manage" | "cancel" | "update" | "payment", returnTo? }` → `{ url }`: a Stripe Customer Portal session,
 *   deep-linked into the cancel (`subscription_cancel`), plan-change or payment-method flow;
 * - `{ action: "cancel" | "resume" | "pause", reason?, comment?, months? }` → `{ subscription, plan }`: the in-app
 *   change of the user's OWN subscription – "Jetzt kündigen" (at period end, reason → Stripe cancellation_details),
 *   "Kündigung zurücknehmen", "Pausieren" (1–3 months, no invoices, no paid features while paused).
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { CANCEL_REASONS, PORTAL_ACTIONS, PORTAL_FLOWS } from "../../src/billing/contract";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { changeSubscription, createPortal, siteOrigin } from "./_lib/stripe";

const Body = z.object({
  flow: z.enum(PORTAL_FLOWS).optional(),
  action: z.enum(PORTAL_ACTIONS).optional(),
  reason: z.enum(CANCEL_REASONS).optional(),
  comment: z.string().max(1000).optional(),
  months: z.number().int().min(1).max(3).optional(),
  returnTo: z.string().max(200).optional(),
});

export default handler(async (req, ctx) => {
  requireMethod(req, "POST");
  const user = await requireUser(req);
  await enforceRateLimit(rateKey("billing-portal", user.id), 20, 600);
  const body = await readJson(req, Body, { maxBytes: 4096 });
  if (body.action) {
    if (body.flow) throw new HttpError(422, "invalid_body", "Entweder flow oder action.");
    return json(await changeSubscription(user.id, body.action, { reason: body.reason, comment: body.comment, months: body.months }));
  }
  const flow = body.flow ?? "manage";
  const url = await createPortal(user.id, flow, siteOrigin(req), body.returnTo);
  await audit(user.id, "billing.portal", { flow }, clientIp(req, ctx));
  return json({ url });
});

export const config: Config = { path: "/api/v1/billing/portal", method: ["POST"] };
