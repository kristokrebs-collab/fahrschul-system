/**
 * /api/v1/account/delete – DSGVO Art. 17, kept apart from ending a subscription (B1).
 *
 * GET → the deletion plan (read only): subscription state (`none` · `running` · `ending` · `issue`, period end), what the
 * deletion touches (trades, day notes, files) and the confirmation word. The app shows it first, then offers the export.
 *
 * POST `{ confirm: "LÖSCHEN", acknowledgeSubscription?: true }` – order (each step aborts the rest on failure):
 * 1. verified user, aal2 when 2FA is enrolled, 3 attempts per hour (fail closed);
 * 2. while a subscription runs, ends or has a payment problem the request must carry `acknowledgeSubscription: true`
 *    (409 `subscription_ack_required` otherwise) – the rule lives here, not only in the dialog;
 * 3. cancel open Stripe subscriptions immediately, without a pro-rata refund (`_lib/billingCleanup.ts`, P10 contract) –
 *    nothing is deleted when that fails;
 * 4. audit row (survives without the user id);
 * 5. a team owner's seats are released one by one (`releaseOwnedSeats`): every member's plan is recomputed (review MONEY-01);
 * 6. delete the user's files in the private buckets (`screenshots/<id>/…`, `backups/<id>/…`) and READ BOTH BUCKETS AGAIN:
 *    anything left is removed once more, and if files remain the account is NOT deleted (502 `storage_cleanup_incomplete` –
 *    the user can simply retry; nothing half-erased is reported as done);
 * 7. recovery codes of the second factor, then `auth.admin.deleteUser` (cascades profiles, journal_docs,
 *    exchange_connections and every per-user table – a static test keeps that list complete);
 * 8. `verifyErased` reads the per-user tables once more; the answer lists what is left (`leftovers`, empty when complete).
 * The `customer.subscription.deleted` webhook that follows is acknowledged as `ignored` (the user no longer exists).
 * The browser keeps its local journal (local-first: never deleted automatically). Invoices stay at Stripe (retention duty).
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { DELETE_CONFIRM_WORD, removeUserFiles, USER_BUCKETS } from "./_lib/account";
import { deletionPlan, leftoverFiles, verifyErased } from "./_lib/accountDeletion";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { cancelBillingForUser } from "./_lib/billingCleanup";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { removeRecovery } from "./_lib/mfaRecovery";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { releaseOwnedSeats } from "./_lib/stripe";
import { supabaseAdmin } from "./_lib/supabase";

const Body = z.object({ confirm: z.string().max(40), acknowledgeSubscription: z.boolean().optional() });

export default handler(async (req, ctx) => {
  requireMethod(req, "GET", "POST");
  const user = await requireUser(req, { aal2: "ifEnrolled" });

  if (req.method.toUpperCase() === "GET") {
    await enforceRateLimit(rateKey("account-delete-plan", user.id), 30, 3600);
    return json(await deletionPlan(user.id, DELETE_CONFIRM_WORD));
  }

  await enforceRateLimit(rateKey("account-delete", user.id), 3, 3600, { failClosed: true });
  const body = await readJson(req, Body, { maxBytes: 1024 });
  if (body.confirm.trim().toUpperCase() !== DELETE_CONFIRM_WORD) throw new HttpError(422, "confirm_mismatch", `Bitte tippe ${DELETE_CONFIRM_WORD} zur Bestätigung.`);

  const plan = await deletionPlan(user.id, DELETE_CONFIRM_WORD);
  if (plan.subscription.state !== "none" && body.acknowledgeSubscription !== true) {
    throw new HttpError(409, "subscription_ack_required", "Dein Abo läuft noch. Beim Löschen endet es sofort, ohne anteilige Erstattung. Bestätige das, oder beende nur das Abo unter Konto → Abo.", { state: plan.subscription.state, currentPeriodEnd: plan.subscription.currentPeriodEnd });
  }

  const billing = await cancelBillingForUser(user.id);
  const ip = clientIp(req, ctx);
  await audit(user.id, "account.delete", { step: "start", canceledSubscriptions: billing.canceled, subscription: plan.subscription.state }, ip);
  const releasedSeats = await releaseOwnedSeats(user.id);

  const files: Record<string, number> = {};
  for (const bucket of USER_BUCKETS) files[bucket] = await removeUserFiles(bucket, user.id);
  let left = await leftoverFiles(user.id);
  if (Object.values(left).some((n) => n > 0)) {
    // once more (a file written while the first pass ran), then stop rather than call it erased
    for (const bucket of USER_BUCKETS) files[bucket] = (files[bucket] ?? 0) + (await removeUserFiles(bucket, user.id));
    left = await leftoverFiles(user.id);
    if (Object.values(left).some((n) => n > 0)) {
      console.error("[fn] account delete: files left", JSON.stringify(left));
      await audit(user.id, "account.delete", { step: "failed", reason: "storage" }, ip);
      throw new HttpError(502, "storage_cleanup_incomplete", "Nicht alle Dateien ließen sich löschen. Dein Konto wurde nicht gelöscht – bitte versuche es gleich noch einmal.");
    }
  }

  await removeRecovery(user.id);
  const { error } = await supabaseAdmin().auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[fn] deleteUser failed", error.status ?? "");
    await audit(user.id, "account.delete", { step: "failed" }, ip);
    throw new HttpError(502, "delete_failed", "Das Konto konnte gerade nicht gelöscht werden. Bitte versuche es später erneut.");
  }
  const leftovers = await verifyErased(user.id);
  if (Object.keys(leftovers).length) console.error("[fn] account delete: rows left", JSON.stringify(leftovers));
  await audit(null, "account.delete", { step: "done", files, leftovers: Object.keys(leftovers).length }, ip);
  return json({ deleted: true, canceledSubscriptions: billing.canceled, releasedSeats, files, leftovers });
});

export const config: Config = { path: "/api/v1/account/delete", method: ["GET", "POST"] };
