/**
 * GET /api/v1/account/backups – the signed-in user's nightly cloud backups (Konto → Daten → Cloud-Backups).
 * - without `day`: `{ items: [{ day, size }] }`, newest first;
 * - `?day=YYYY-MM-DD`: that backup as JSON in the app's backup format – the client restores it through
 *   `importBackup` (snapshot first, then merge / replace), exactly like a file. A backup above `INLINE_JSON_MAX`
 *   (Netlify's buffered responses end at 6 MB) is answered as `{ download: { url, … } }` – a short signed link to
 *   the file in Storage (review DSGVO-02).
 * Listing also removes staged account exports older than an hour.
 * aal2 when 2FA is enrolled; 30 requests per 10 minutes.
 */
import type { Config } from "@netlify/functions";
import { BACKUP_BUCKET, backupLink, fitsInline, INLINE_JSON_MAX, listBackups, removeStagedExports, STAGED_EXPORT_KEEP_MS } from "./_lib/account";
import { requireUser } from "./_lib/auth";
import { handler, HttpError, json, jsonText, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { supabaseAdmin } from "./_lib/supabase";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default handler(async (req) => {
  requireMethod(req, "GET");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("account-backups", user.id), 30, 600);
  const day = new URL(req.url).searchParams.get("day");
  const files = await listBackups(user.id);
  if (!day) {
    await removeStagedExports(user.id, { olderThanMs: STAGED_EXPORT_KEEP_MS });
    return json({ items: files.map((f) => ({ day: f.day, size: f.size })) });
  }
  if (!DAY.test(day)) throw new HttpError(400, "invalid_day");
  const file = files.find((f) => f.day === day);
  if (!file) throw new HttpError(404, "not_found", "Dieses Backup gibt es nicht (mehr).");
  if (file.size !== null && file.size > INLINE_JSON_MAX) return json({ download: await backupLink(file) });
  const { data, error } = await supabaseAdmin().storage.from(BACKUP_BUCKET).download(file.path);
  if (error || !data) {
    console.error("[fn] backup download failed");
    throw new HttpError(502, "storage_unavailable", "Der Dateispeicher antwortet gerade nicht.");
  }
  const text = await data.text();
  if (!fitsInline(text)) return json({ download: await backupLink(file) });
  try {
    JSON.parse(text);
  } catch {
    throw new HttpError(500, "backup_corrupt", "Dieses Backup ist beschädigt.");
  }
  return jsonText(text);
});

export const config: Config = { path: "/api/v1/account/backups", method: ["GET"] };
