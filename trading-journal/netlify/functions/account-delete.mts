/**
 * POST /api/v1/account/delete `{ confirm: "LÖSCHEN" }` – DSGVO Art. 17. Order (each step aborts the rest on failure):
 * 1. verified user, aal2 when 2FA is enrolled, 3 attempts per hour (fail closed);
 * 2. cancel open Stripe subscriptions (`_lib/billingCleanup.ts`, P10 contract) – nothing is deleted when that fails;
 * 3. audit row (survives without the user id);
 * 4. a team owner's seats are released one by one (`releaseOwnedSeats`): every member's plan is recomputed – the cascade
 *    alone would leave them on the Team plan for free (review MONEY-01);
 * 5. delete the user's files in the private buckets (`screenshots/<id>/…`, `backups/<id>/…`);
 * 6. `auth.admin.deleteUser` – cascades profiles, journal_docs, exchange_connections (P10–P12 tables cascade too; the
 *    owner's groups go with them). The `customer.subscription.deleted` webhook that follows is acknowledged as
 *    `ignored` (the user no longer exists).
 * The browser keeps its local journal (local-first: never deleted automatically).
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { DELETE_CONFIRM_WORD, removeUserFiles, USER_BUCKETS } from "./_lib/account";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { cancelBillingForUser } from "./_lib/billingCleanup";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { releaseOwnedSeats } from "./_lib/stripe";
import { supabaseAdmin } from "./_lib/supabase";

const Body = z.object({ confirm: z.string() });

export default handler(async (req, ctx) => {
  requireMethod(req, "POST");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("account-delete", user.id), 3, 3600, { failClosed: true });
  const body = await readJson(req, Body, { maxBytes: 1024 });
  if (body.confirm.trim().toUpperCase() !== DELETE_CONFIRM_WORD) throw new HttpError(422, "confirm_mismatch", `Bitte tippe ${DELETE_CONFIRM_WORD} zur Bestätigung.`);

  const billing = await cancelBillingForUser(user.id);
  const ip = clientIp(req, ctx);
  await audit(user.id, "account.delete", { step: "start", canceledSubscriptions: billing.canceled }, ip);
  const releasedSeats = await releaseOwnedSeats(user.id);

  const files: Record<string, number> = {};
  for (const bucket of USER_BUCKETS) files[bucket] = await removeUserFiles(bucket, user.id);

  const { error } = await supabaseAdmin().auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[fn] deleteUser failed", error.status ?? "");
    await audit(user.id, "account.delete", { step: "failed" }, ip);
    throw new HttpError(502, "delete_failed", "Das Konto konnte gerade nicht gelöscht werden. Bitte versuche es später erneut.");
  }
  await audit(null, "account.delete", { step: "done", files }, ip);
  return json({ deleted: true, canceledSubscriptions: billing.canceled, releasedSeats, files });
});

export const config: Config = { path: "/api/v1/account/delete", method: ["POST"] };
