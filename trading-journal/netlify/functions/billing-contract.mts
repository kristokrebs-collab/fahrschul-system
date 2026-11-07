/**
 * Cancel (§ 312k BGB) and withdraw (§ 356a BGB) WITHOUT a login (B4) – two public routes, rate-limited, no account details in
 * any answer (nobody can probe who has a contract):
 *
 *   POST /api/v1/billing/contract          `{ kind: "cancel" | "withdraw", email, name?, contract? }` → `ContractReceipt`
 *     stores the declaration with its receipt time and mails a confirmation link to the account's own address (a login of
 *     that address skips the mail: it executes at once and mails the confirmation afterwards).
 *   POST /api/v1/billing/contract/confirm  `{ token }` → `ContractConfirmResponse` – the link of the mail: executes once.
 *
 * ENTWURF – Prüfung durch Anwalt nötig; path and reasons: `docs/RECHT/kuendigung-widerruf.md`.
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { CONTRACT_KINDS } from "../../src/billing/contract";
import { ipRateId } from "./_lib/audit";
import { optionalUser } from "./_lib/auth";
import { confirmContract, declareContract } from "./_lib/contractRequest";
import { clientIp, handler, json, readJson, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { siteOrigin } from "./_lib/stripe";

const Declare = z.object({
  kind: z.enum(CONTRACT_KINDS),
  email: z.string().max(254),
  name: z.string().max(120).optional(),
  contract: z.string().max(300).optional(),
});
const Confirm = z.object({ token: z.string().min(32).max(64) });

export default handler(async (req, ctx) => {
  requireMethod(req, "POST");
  const ip = clientIp(req, ctx);
  const path = new URL(req.url).pathname;
  await enforceRateLimit(rateKey("billing-contract-ip", ipRateId(ip) ?? "anon"), 20, 3600, { failClosed: true });
  if (path.endsWith("/confirm")) {
    const body = await readJson(req, Confirm, { maxBytes: 1024 });
    return json(await confirmContract(body.token, { ip }));
  }
  const body = await readJson(req, Declare, { maxBytes: 2048 });
  // a stale / invalid token must never break the PUBLIC flow: the declaration then simply counts as a visitor's
  const signedIn = await optionalUser(req).catch(() => null);
  return json(await declareContract(body, { signedIn, origin: siteOrigin(req), ip }));
});

export const config: Config = { path: ["/api/v1/billing/contract", "/api/v1/billing/contract/confirm"], method: ["POST"] };
