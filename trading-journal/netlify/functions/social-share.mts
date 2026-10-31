/**
 * Share links (P12) – the owner's side. Signed in (aal2 when 2FA is on).
 *   GET    /api/v1/social/share          → `{ shares }` (own links, newest first, ≤ 50)
 *   POST   /api/v1/social/share          `{ payload, expiresInDays }` → 201 `{ share }`
 *   DELETE /api/v1/social/share/:id      → `{ ok }` (revoked at once; the public read answers 404 from then on)
 * The payload is the redacted trade / setup / figures card (`src/social/redact.ts`) or an Ergebnisbeleg (the full R list of a
 * period, `proofBuild.ts`; up to 500 trades, 64 KB in the database) and is re-validated with the STRICT
 * schema here – unknown keys (P&L, size, notes, …) are a 422, never stored. 20 new links per hour. The token is 16
 * random bytes (base64url) – a capability URL; the public read is `social-shared.mts`.
 */
import type { Config } from "@netlify/functions";
import { CreateShareSchema } from "../../src/social/contract";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { createShare, listShares, revokeShare } from "./_lib/social/shares";

const BASE = "/api/v1/social/share";

export default handler(async (req, ctx) => {
  requireMethod(req, "GET", "POST", "DELETE");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  const ip = clientIp(req, ctx);
  const rest = new URL(req.url).pathname.replace(/\/+$/, "").slice(BASE.length).split("/").filter(Boolean);
  const method = req.method.toUpperCase();

  if (method === "GET" && rest.length === 0) {
    await enforceRateLimit(rateKey("social-share-list", user.id), 120, 600);
    return json({ shares: await listShares(user.id) });
  }
  if (method === "POST" && rest.length === 0) {
    await enforceRateLimit(rateKey("social-share", user.id), 20, 3600);
    const body = await readJson(req, CreateShareSchema, { maxBytes: 32 * 1024 });
    const share = await createShare(user.id, body.payload, body.expiresInDays);
    await audit(user.id, "social.share", { kind: share.kind, expiresInDays: body.expiresInDays }, ip);
    return json({ share }, { status: 201 });
  }
  if (method === "DELETE" && rest.length === 1) {
    await enforceRateLimit(rateKey("social-share-revoke", user.id), 60, 600);
    await revokeShare(user.id, rest[0]!);
    await audit(user.id, "social.share.revoke", { id: rest[0] }, ip);
    return json({ ok: true });
  }
  throw new HttpError(405, "method_not_allowed");
});

export const config: Config = { path: ["/api/v1/social/share", "/api/v1/social/share/*"], method: ["GET", "POST", "DELETE"] };
