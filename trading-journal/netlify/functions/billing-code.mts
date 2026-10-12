/**
 * POST /api/v1/billing/code `{ code }` → `CodeLookup` (P10): preview of a Stripe promotion code for the pricing page
 * (percent / amount off, duration, restrictions, German terms). Works signed out; rate-limited per hashed IP (and per
 * user) so codes cannot be enumerated. The checkout re-validates the code – this answer is only a preview.
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { hashIp } from "./_lib/audit";
import { optionalUser } from "./_lib/auth";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { billingConfigured, lookupCode, OFF_MESSAGE } from "./_lib/stripe";

const Body = z.object({ code: z.string().min(1).max(60) });

export default handler(async (req, ctx) => {
  requireMethod(req, "POST");
  const user = await optionalUser(req);
  await enforceRateLimit(rateKey("billing-code", hashIp(clientIp(req, ctx)) ?? "anon"), 10, 60, { failClosed: true });
  if (user) await enforceRateLimit(rateKey("billing-code-user", user.id), 30, 3600, { failClosed: true });
  const { code } = await readJson(req, Body, { maxBytes: 512 });
  if (!billingConfigured()) throw new HttpError(503, "billing_unavailable", OFF_MESSAGE);
  return json(await lookupCode(code));
});

export const config: Config = { path: "/api/v1/billing/code", method: ["POST"] };
