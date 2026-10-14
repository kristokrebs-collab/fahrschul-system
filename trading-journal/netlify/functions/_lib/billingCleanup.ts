/**
 * Billing side of an account deletion (P09 ↔ P10 contract). `account-delete` calls `cancelBillingForUser(userId)`
 * BEFORE anything is deleted; when it throws, nothing is deleted (a running subscription must never keep charging an
 * account that no longer exists).
 *
 * Until P10 lands this talks to Stripe directly with the SDK (only the three calls below). P10 may replace the body
 * with its own `cancelSubscription()` from `_lib/stripe.ts` – keep the signature and the "throw = abort" rule.
 *
 * Which customers belong to the user: `subscriptions.stripe_customer_id` (P10 table, skipped while it does not exist)
 * plus a Stripe search on `metadata['supabase_user_id']` (P10 sets it on the customer and the subscription).
 * Invoices stay at Stripe (German retention duties); only the subscriptions are cancelled.
 */
import { isMissingTable } from "./account";
import { envOptional } from "./env";
import { HttpError } from "./http";
import { planOf } from "./plan";
import { supabaseAdmin } from "./supabase";

/** The part of the Stripe SDK this module uses (structural, so tests inject a fake). */
export interface StripeLike {
  customers: { search(params: { query: string; limit?: number }): Promise<{ data: { id: string }[] }> };
  subscriptions: {
    list(params: { customer: string; status: "all"; limit: number }): Promise<{ data: { id: string; status: string }[] }>;
    cancel(id: string, params?: { invoice_now?: boolean; prorate?: boolean }): Promise<{ id: string; status: string }>;
  };
}

type StripeFactory = (secretKey: string) => Promise<StripeLike>;

const defaultFactory: StripeFactory = async (key) => {
  const { default: Stripe } = await import("stripe");
  return new Stripe(key) as unknown as StripeLike;
};
let factory: StripeFactory = defaultFactory;

/** Tests: inject a fake Stripe (`null` restores the SDK). */
export function setStripeForTests(f: StripeFactory | null): void {
  factory = f ?? defaultFactory;
}

/** Subscription statuses that may still bill or be resumed. */
const OPEN_STATUSES = new Set(["trialing", "active", "past_due", "unpaid", "paused", "incomplete"]);

export interface BillingCleanupResult {
  /** Subscriptions cancelled now. */
  canceled: number;
  /** Customers looked at. */
  customers: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function knownCustomers(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin().from("subscriptions").select("stripe_customer_id").eq("user_id", userId);
  if (error) {
    if (!isMissingTable(error)) console.error("[fn] subscriptions read failed", error.code);
    return [];
  }
  return [...new Set(((data ?? []) as { stripe_customer_id?: unknown }[]).map((r) => r.stripe_customer_id).filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/**
 * Cancels every open subscription of the user immediately. Throws `HttpError` 409 `subscription_active` when the
 * profile shows a running plan but Stripe is not configured, 502 `billing_unavailable` when Stripe fails.
 */
export async function cancelBillingForUser(userId: string): Promise<BillingCleanupResult> {
  if (!UUID.test(userId)) throw new HttpError(400, "invalid_user");
  const plan = await planOf(userId);
  const known = await knownCustomers(userId);
  const open = OPEN_STATUSES.has(plan.status);
  const key = envOptional("STRIPE_SECRET_KEY");
  if (!key) {
    if (open || known.length) throw new HttpError(409, "subscription_active", "Dein Abo läuft noch. Kündige es zuerst unter Konto → Abo, dann kannst du das Konto löschen.");
    return { canceled: 0, customers: 0 };
  }
  try {
    const stripe = await factory(key);
    const found = await stripe.customers.search({ query: `metadata['supabase_user_id']:'${userId}'`, limit: 10 });
    const customers = [...new Set([...known, ...found.data.map((c) => c.id)])];
    let canceled = 0;
    for (const customer of customers) {
      const subs = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
      for (const s of subs.data) {
        if (!OPEN_STATUSES.has(s.status)) continue;
        await stripe.subscriptions.cancel(s.id, { invoice_now: false, prorate: false });
        canceled++;
      }
    }
    return { canceled, customers: customers.length };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error("[fn] stripe cleanup failed", e instanceof Error ? e.name : typeof e);
    throw new HttpError(502, "billing_unavailable", "Das Abo konnte gerade nicht gekündigt werden. Dein Konto wurde nicht gelöscht – bitte versuche es später erneut.");
  }
}
