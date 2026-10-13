/**
 * GET /api/v1/account/export – DSGVO Art. 15 / 20: everything stored about the signed-in user as one JSON file
 * (journal in the app's backup format, profile, audit trail, connection metadata, file list with 24-h download links;
 * secrets excluded). aal2 when the user has 2FA; 5 exports per hour. An export above `INLINE_JSON_MAX` (Netlify's
 * buffered responses end at 6 MB) is staged in Storage and answered as `{ download: { url, bytes, expiresAt, name } }`
 * (review DSGVO-02).
 */
import type { Config } from "@netlify/functions";
import { collectExport, fitsInline, stageExport } from "./_lib/account";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, json, jsonText, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("account-export", user.id), 5, 3600);
  const data = await collectExport(user.id);
  await audit(user.id, "account.export", { trades: data.journal.counts.trades ?? 0 }, clientIp(req, ctx));
  const name = `trade-journal-konto-${data.exportedAt.slice(0, 10)}.json`;
  const text = JSON.stringify(data);
  if (!fitsInline(text)) return json({ download: await stageExport(user.id, name, text) });
  return jsonText(text, { headers: { "content-disposition": `attachment; filename="${name}"` } });
});

export const config: Config = { path: "/api/v1/account/export", method: ["GET"] };
