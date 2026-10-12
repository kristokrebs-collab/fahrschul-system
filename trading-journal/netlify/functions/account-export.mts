/**
 * GET /api/v1/account/export – DSGVO Art. 15 / 20: everything stored about the signed-in user as one JSON file
 * (journal in the app's backup format, profile, audit trail, connection metadata, file list; secrets excluded).
 * aal2 when the user has 2FA; 5 exports per hour.
 */
import type { Config } from "@netlify/functions";
import { collectExport } from "./_lib/account";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, json, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("account-export", user.id), 5, 3600);
  const data = await collectExport(user.id);
  await audit(user.id, "account.export", { trades: data.journal.counts.trades ?? 0 }, clientIp(req, ctx));
  const name = `trade-journal-konto-${data.exportedAt.slice(0, 10)}.json`;
  return json(data, { headers: { "content-disposition": `attachment; filename="${name}"` } });
});

export const config: Config = { path: "/api/v1/account/export", method: ["GET"] };
