/**
 * GET /api/v1/account/backups – the signed-in user's nightly cloud backups (Konto → Daten → Cloud-Backups).
 * - without `day`: `{ items: [{ day, size }] }`, newest first;
 * - `?day=YYYY-MM-DD`: that backup as JSON in the app's backup format – the client restores it through
 *   `importBackup` (snapshot first, then merge / replace), exactly like a file.
 * aal2 when 2FA is enrolled; 30 requests per 10 minutes.
 */
import type { Config } from "@netlify/functions";
import { BACKUP_BUCKET, listBackups } from "./_lib/account";
import { requireUser } from "./_lib/auth";
import { handler, HttpError, json, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { supabaseAdmin } from "./_lib/supabase";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default handler(async (req) => {
  requireMethod(req, "GET");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("account-backups", user.id), 30, 600);
  const day = new URL(req.url).searchParams.get("day");
  const files = await listBackups(user.id);
  if (!day) return json({ items: files.map((f) => ({ day: f.day, size: f.size })) });
  if (!DAY.test(day)) throw new HttpError(400, "invalid_day");
  const file = files.find((f) => f.day === day);
  if (!file) throw new HttpError(404, "not_found", "Dieses Backup gibt es nicht (mehr).");
  const { data, error } = await supabaseAdmin().storage.from(BACKUP_BUCKET).download(file.path);
  if (error || !data) {
    console.error("[fn] backup download failed");
    throw new HttpError(502, "storage_unavailable", "Der Dateispeicher antwortet gerade nicht.");
  }
  let backup: unknown;
  try {
    backup = JSON.parse(await data.text());
  } catch {
    throw new HttpError(500, "backup_corrupt", "Dieses Backup ist beschädigt.");
  }
  return json(backup);
});

export const config: Config = { path: "/api/v1/account/backups", method: ["GET"] };
