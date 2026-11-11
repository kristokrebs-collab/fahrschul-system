/**
 * The Zustellprotokoll entry of an e-mail that the older paths send themselves (the key-level summary of `alert-watch-cron`, the test mail of
 * `alert-test`): one `alert_deliveries` row with the final status, no event. Best effort by design – the log must never break a mail, and
 * without migration 0014 it is simply not written. Codes only: no address, no text.
 */
import { supabaseAdmin } from "../supabase";

export async function logEmailDelivery(userId: string, kind: "alarm" | "test", outcome: { ok: true; ref: string | null } | { ok: false; code: string }): Promise<void> {
  try {
    await supabaseAdmin()
      .from("alert_deliveries")
      .insert({
        user_id: userId,
        event_id: null,
        kind,
        channel: "email",
        status: outcome.ok ? "sent" : "failed",
        reason: outcome.ok ? null : outcome.code.slice(0, 40),
        attempts: 1,
        provider_ref: outcome.ok ? (outcome.ref ?? null) : null,
      });
  } catch {
    /* the log is a courtesy, not a dependency */
  }
}
