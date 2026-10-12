/**
 * POST /api/v1/feedback (P12) `{ kind: "bug"|"idea"|"praise"|"other"|"report", message, page?, target?, meta? }`
 * → 201 `{ ok, duplicate?, hidden? }`. Feedback works without an account (stored without a user); a report
 * (`kind: "report"`, `target: { type: "comment"|"review"|"share"|"group", id }`) needs a login and a target the reporter
 * can see. 10 per 10 min per user, 5 per 10 min per IP hash when signed out. Nothing but the given text is stored – no
 * IP, no user agent.
 */
import type { Config } from "@netlify/functions";
import { FeedbackSchema } from "../../src/social/contract";
import { hashIp } from "./_lib/audit";
import { optionalUser } from "./_lib/auth";
import { clientIp, handler, json, readJson, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { submitFeedback } from "./_lib/social/feedback";

export default handler(async (req, ctx) => {
  requireMethod(req, "POST");
  const user = await optionalUser(req);
  if (user) await enforceRateLimit(rateKey("feedback", user.id), 10, 600);
  else await enforceRateLimit(rateKey("feedback-anon", hashIp(clientIp(req, ctx)) ?? "anon"), 5, 600, { failClosed: true });
  const body = await readJson(req, FeedbackSchema, { maxBytes: 8 * 1024 });
  return json(await submitFeedback(user?.id ?? null, body), { status: 201 });
});

export const config: Config = { path: "/api/v1/feedback", method: ["POST"] };
