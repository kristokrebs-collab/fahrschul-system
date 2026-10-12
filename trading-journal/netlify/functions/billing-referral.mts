/**
 * GET /api/v1/billing/referral (P10)
 * - `?code=ABCD2345` (public, rate-limited per hashed IP) → `ReferralCheck` `{ valid, trialDays }` for the `?ref=`
 *   landing; never reveals who owns the code;
 * - signed in, no `code` → `ReferralInfo`: the user's own code (created on first call), share path, stats (sign-ups,
 *   paying) and the credit / commission ledger.
 */
import type { Config } from "@netlify/functions";
import { normalizeRefCode } from "../../src/billing/contract";
import { hashIp } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, json, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { referralInfo, referralTrialDays, referrerOf } from "./_lib/stripe";

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  const raw = new URL(req.url).searchParams.get("code");
  if (raw !== null) {
    await enforceRateLimit(rateKey("billing-ref-check", hashIp(clientIp(req, ctx)) ?? "anon"), 20, 60, { failClosed: true });
    const code = normalizeRefCode(raw);
    const valid = !!code && (await referrerOf(code)) !== null;
    return json({ valid, trialDays: valid ? referralTrialDays() : 0 });
  }
  const user = await requireUser(req);
  await enforceRateLimit(rateKey("billing-referral", user.id), 60, 600);
  return json(await referralInfo(user.id));
});

export const config: Config = { path: "/api/v1/billing/referral", method: ["GET"] };
