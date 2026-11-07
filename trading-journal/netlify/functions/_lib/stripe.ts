/**
 * Stripe billing for the functions (P10): the Stripe client, price / plan mapping from env, the subscription mirror
 * (`subscriptions`, `billing_customers`, migration 0002), the plan recompute that writes `profiles.plan`, Checkout /
 * Customer Portal sessions, in-app cancellation, promotion codes, referrals + affiliate ledger, team seats and the
 * webhook dispatcher.
 *
 * Rules
 * - The plan is NEVER taken from the client: only `recomputePlan` writes `profiles.plan / plan_status / trial_end`,
 *   from Stripe data the webhook (or a direct Stripe call of the user's own subscription) delivered.
 * - Webhooks are idempotent (`stripe_events`) and order-safe: subscription events re-read the subscription from Stripe
 *   (the latest state wins); a stale snapshot is never written over a newer one (`subscriptions.last_event_at`).
 * - Stripe is reached only from here; the browser only follows the Checkout / Portal URLs (redirects, no Stripe.js).
 * - Never log secrets, e-mails or full Stripe objects – ids and error codes only.
 *
 * Env (Netlify secrets, scope Functions): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_<PRO|PREMIUM|TEAM>_<MONTHLY|
 * YEARLY>, TRIAL_DAYS (14), optional STRIPE_TRIAL_CARDLESS (trial without card), STRIPE_AUTOMATIC_TAX (Stripe Tax),
 * REFERRAL_TRIAL_DAYS (30), REFERRAL_REWARD_CENTS (1000), REFERRAL_HOLD_DAYS (14), SITE_ORIGIN.
 *
 * Runde 11 (Sicherheits-Fixpaket, Paket A): the members of a team are re-checked on EVERY event of the owner's subscription (plan change,
 * fewer seats: the surplus loses its seat), a trial is used once per ADDRESS even across a deleted account (tombstone of the e-mail hash),
 * a referral credit needs a real payment of at least the credit and waits `REFERRAL_HOLD_DAYS` before it reaches the Stripe balance, a full
 * refund or a dispute takes it back (`charge.refunded`, `charge.dispute.created` → ledger `reversal`), and `recomputePlan` checks after
 * writing that nothing moved meanwhile. `_lib/billingReconcile.ts` compares everything with Stripe once a day.
 */
import { createHmac, randomBytes } from "node:crypto";
import Stripe from "stripe";
import {
  normalizePromoCode,
  normalizeRefCode,
  safeReturnTo,
  type BillingConfig,
  type BillingStatus,
  type CancelReason,
  type CheckoutRequest,
  type CheckoutResponse,
  type CodeLookup,
  type InvoiceSummary,
  type LedgerEntry,
  type PortalAction,
  type PortalFlow,
  type PriceInfo,
  type ReferralInfo,
  type SubscriptionSummary,
} from "../../../src/billing/contract";
import {
  DEFAULT_REFERRAL_REWARD_CENTS,
  DEFAULT_REFERRAL_TRIAL_DAYS,
  DEFAULT_TRIAL_DAYS,
  PAID_PLANS,
  PLAN_CATALOG,
  PLAN_RANK,
  isPaidPlan,
  type PaidPlanId,
} from "../../../src/billing/plans";
import {
  BILLING_INTERVALS,
  grantsPlan,
  isPlanId,
  isPlanStatus,
  type BillingInterval,
  type PlanId,
  type PlanInfo,
  type PlanStatus,
} from "../../../src/billing/types";
import { isMissingTable } from "./account";
import { audit, purposeKeys } from "./audit";
import type { AuthUser } from "./auth";
import { envOptional, type ServerEnvName } from "./env";
import { HttpError } from "./http";
import { paymentsConfigured, planOf } from "./plan";
import { assertPurchaseOpen, checkConsents, contractMailReady, linkConsentSession, purchaseGate, returnUrls, serverConsentHash, storeConsents } from "./purchase";
import { supabaseAdmin } from "./supabase";

/* ------------------------------------------------------------------ env */

/** Optional billing env names beyond `SERVER_ENV` (documented in `.env.example`). */
type BillingEnvName = ServerEnvName | "STRIPE_TRIAL_CARDLESS" | "STRIPE_AUTOMATIC_TAX" | "REFERRAL_TRIAL_DAYS" | "REFERRAL_REWARD_CENTS" | "REFERRAL_HOLD_DAYS";

const benv = (name: BillingEnvName): string | undefined => envOptional(name as ServerEnvName);

function benvInt(name: BillingEnvName, fallback: number, min: number, max: number): number {
  const n = Number(benv(name));
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function benvBool(name: BillingEnvName): boolean {
  return /^(1|true|yes|on)$/i.test(benv(name)?.trim() ?? "");
}

export const OFF_MESSAGE = "Zahlungen sind noch nicht eingerichtet.";
const STRIPE_DOWN = "Der Zahlungsdienst antwortet gerade nicht. Bitte versuche es gleich noch einmal.";

/** Env name of a price id, e.g. `STRIPE_PRICE_PRO_MONTHLY`. */
export function priceEnvName(plan: PaidPlanId, interval: BillingInterval): ServerEnvName {
  return `STRIPE_PRICE_${plan.toUpperCase()}_${interval === "month" ? "MONTHLY" : "YEARLY"}` as ServerEnvName;
}

export function priceIdFor(plan: PaidPlanId, interval: BillingInterval): string | null {
  return envOptional(priceEnvName(plan, interval)) ?? null;
}

/** Reverse lookup of a configured price id. */
export function planForPrice(priceId: string | null | undefined): { plan: PaidPlanId; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const plan of PAID_PLANS) for (const interval of BILLING_INTERVALS) if (priceIdFor(plan, interval) === priceId) return { plan, interval };
  return null;
}

/** Plans with at least one configured price. */
export function availablePlans(): PaidPlanId[] {
  return PAID_PLANS.filter((p) => BILLING_INTERVALS.some((i) => priceIdFor(p, i)));
}

export const billingConfigured = paymentsConfigured;
export const trialDays = (): number => benvInt("TRIAL_DAYS", DEFAULT_TRIAL_DAYS, 0, 60);
export const referralTrialDays = (): number => benvInt("REFERRAL_TRIAL_DAYS", DEFAULT_REFERRAL_TRIAL_DAYS, 0, 90);
export const referralRewardCents = (): number => benvInt("REFERRAL_REWARD_CENTS", DEFAULT_REFERRAL_REWARD_CENTS, 0, 100_000);
/** Days a referral credit waits (pending) before it is put on the referrer's Stripe balance – the time in which a refund or dispute can still arrive. */
export const REFERRAL_HOLD_DEFAULT_DAYS = 14;
export const referralHoldDays = (): number => benvInt("REFERRAL_HOLD_DAYS", REFERRAL_HOLD_DEFAULT_DAYS, 0, 120);
export const cardlessTrial = (): boolean => benvBool("STRIPE_TRIAL_CARDLESS");
export const automaticTax = (): boolean => benvBool("STRIPE_AUTOMATIC_TAX");

/** Origin for redirect URLs: `SITE_ORIGIN` (when it is a plain http(s) origin), else the request's own origin. */
export function siteOrigin(req: Request): string {
  const configured = envOptional("SITE_ORIGIN")?.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(configured)) return configured;
  return new URL(req.url).origin;
}

/* ------------------------------------------------------------------ client */

/** The part of the Stripe SDK used here (structural, so tests inject a fake). */
export interface StripeApi {
  customers: {
    create(params: Stripe.CustomerCreateParams, options?: Stripe.RequestOptions): Promise<{ id: string }>;
    createBalanceTransaction(id: string, params: Stripe.CustomerCreateBalanceTransactionParams, options?: Stripe.RequestOptions): Promise<{ id: string }>;
    list(params: Stripe.CustomerListParams): Promise<{ data: Stripe.Customer[] }>;
  };
  checkout: { sessions: { create(params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions): Promise<{ id: string; url: string | null }> } };
  billingPortal: { sessions: { create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }> } };
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>;
    update(id: string, params: Stripe.SubscriptionUpdateParams): Promise<Stripe.Subscription>;
    list(params: Stripe.SubscriptionListParams): Promise<{ data: Stripe.Subscription[] }>;
    cancel(id: string, params?: Stripe.SubscriptionCancelParams): Promise<Stripe.Subscription>;
  };
  invoices: { list(params: Stripe.InvoiceListParams): Promise<{ data: Stripe.Invoice[] }> };
  /** Which invoice a payment (PaymentIntent of a refunded / disputed charge) paid – the API 2025+ way (a charge no longer names its invoice). */
  invoicePayments: { list(params: Stripe.InvoicePaymentListParams): Promise<{ data: Stripe.InvoicePayment[] }> };
  promotionCodes: { list(params: Stripe.PromotionCodeListParams): Promise<{ data: Stripe.PromotionCode[] }> };
  prices: { retrieve(id: string): Promise<Stripe.Price> };
  webhooks: { constructEventAsync(payload: string, header: string, secret: string): Promise<Stripe.Event> };
}

let override: StripeApi | null = null;
let cached: { key: string; api: StripeApi } | null = null;

/** Tests: inject a fake Stripe (`null` restores the SDK). */
export function setStripeApiForTests(api: StripeApi | null): void {
  override = api;
  cached = null;
  priceCache = null;
}

/** The Stripe client; 503 `billing_unavailable` when no secret key is configured. */
export function stripeApi(): StripeApi {
  if (override) return override;
  const key = envOptional("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError(503, "billing_unavailable", OFF_MESSAGE);
  if (cached?.key !== key) {
    // the SDK pins its API version (stripe@23 → 2026-09-30.endive); retries are idempotent (SDK idempotency keys)
    const api = new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000, appInfo: { name: "trading-journal" } }) as unknown as StripeApi;
    cached = { key, api };
  }
  return cached.api;
}

/** Runs a Stripe call; SDK errors become 502 `billing_unavailable` (logged by type / code only). */
export async function stripeCall<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const err = e as { type?: string; code?: string; statusCode?: number };
    console.error(`[fn] stripe ${what} failed`, err.type ?? "", err.code ?? "", err.statusCode ?? "");
    // the same order (idempotency key) sent again with other details: never a second session, say so
    if (err.type === "StripeIdempotencyError") throw new HttpError(409, "order_changed", "Diese Bestellung wurde schon mit anderen Angaben gestartet. Bitte starte sie neu.");
    throw new HttpError(502, "billing_unavailable", STRIPE_DOWN);
  }
}

/* ------------------------------------------------------------------ mapping */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validUuid = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);
const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null;
const iso = (sec: number | null | undefined): string | null => (typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString() : null);

/** One `subscriptions` row (snake_case = the table). */
export interface SubscriptionRow {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  status: Exclude<PlanStatus, "none">;
  plan: PlanId;
  price_id: string | null;
  interval: BillingInterval | null;
  seats: number;
  amount: number | null;
  currency: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  canceled_at: string | null;
  trial_end: string | null;
  pause_resumes_at: string | null;
  has_payment_method: boolean | null;
  ref_code: string | null;
  last_event_at: string | null;
  updated_at?: string;
  created_at?: string;
}

/** Our status for a Stripe subscription: collection paused counts as `paused` (no payment → no paid features). */
export function mapStatus(status: string, pausedCollection: boolean): Exclude<PlanStatus, "none"> {
  if (pausedCollection && (status === "active" || status === "trialing")) return "paused";
  return isPlanStatus(status) && status !== "none" ? status : "incomplete";
}

/** Plan of a Stripe price: the env map, else `metadata.plan` / `lookup_key` (`pro_monthly`, …). */
export function planOfPrice(
  price: Pick<Stripe.Price, "id" | "metadata" | "lookup_key" | "recurring"> | null | undefined,
): { plan: PlanId; interval: BillingInterval | null } | null {
  if (!price) return null;
  const mapped = planForPrice(price.id);
  if (mapped) return mapped;
  const ri = price.recurring?.interval;
  const interval: BillingInterval | null = ri === "month" ? "month" : ri === "year" ? "year" : null;
  const meta = price.metadata?.plan;
  if (isPlanId(meta) && meta !== "free") return { plan: meta, interval };
  const lk = /^(pro|premium|team)[_-]/.exec(price.lookup_key ?? "");
  if (lk && isPaidPlan(lk[1])) return { plan: lk[1], interval };
  return null;
}

/** The row we store for a Stripe subscription. */
export function rowFromSubscription(sub: Stripe.Subscription, userId: string, eventAt?: number | null): SubscriptionRow {
  const item = sub.items?.data?.[0];
  const price = item?.price ?? null;
  const mapped = planOfPrice(price);
  if (!mapped) console.error("[fn] subscription with an unknown price", sub.id, price?.id ?? "");
  const seats = Math.max(1, Math.min(1000, item?.quantity ?? 1));
  const unit = typeof price?.unit_amount === "number" ? price.unit_amount : null;
  return {
    id: sub.id,
    user_id: userId,
    stripe_customer_id: idOf(sub.customer) ?? "",
    status: mapStatus(sub.status, !!sub.pause_collection),
    plan: mapped?.plan ?? "free",
    price_id: price?.id ?? null,
    interval: mapped?.interval ?? null,
    seats,
    amount: unit === null ? null : unit * seats,
    currency: price?.currency ?? sub.currency ?? null,
    current_period_end: iso(item?.current_period_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    cancel_at: iso(sub.cancel_at),
    canceled_at: iso(sub.canceled_at),
    trial_end: iso(sub.trial_end),
    pause_resumes_at: iso(sub.pause_collection?.resumes_at ?? null),
    has_payment_method: !!(sub.default_payment_method || sub.default_source),
    ref_code: normalizeRefCode(sub.metadata?.ref),
    last_event_at: iso(eventAt ?? null),
  };
}

const OPEN = new Set<string>(["trialing", "active", "past_due", "unpaid", "paused", "incomplete"]);

/** The subscription that matters for the UI: a granting one (best plan), else a paused / open one, else the newest. */
export function pickCurrent(rows: readonly SubscriptionRow[]): SubscriptionRow | null {
  const score = (r: SubscriptionRow) => (grantsPlan(r.status) ? 3000 : r.status === "paused" ? 2000 : OPEN.has(r.status) ? 1000 : 0) + PLAN_RANK[r.plan] * 10;
  return [...rows].sort((a, b) => score(b) - score(a) || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0] ?? null;
}

export function summaryOf(row: SubscriptionRow): SubscriptionSummary {
  return {
    id: row.id,
    plan: row.plan,
    status: row.status,
    interval: row.interval,
    seats: row.seats,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    cancelAt: row.cancel_at ?? (row.cancel_at_period_end ? row.current_period_end : null),
    trialEnd: row.trial_end,
    pausedUntil: row.status === "paused" ? row.pause_resumes_at : null,
    amount: row.amount,
    currency: row.currency,
    hasPaymentMethod: row.has_payment_method,
    startedAt: row.created_at ?? null,
  };
}

/** The invoice's subscription id (API 2025+: `parent.subscription_details.subscription`). */
export function invoiceSubscriptionId(inv: Stripe.Invoice): string | null {
  const viaParent = idOf(inv.parent?.subscription_details?.subscription);
  if (viaParent) return viaParent;
  return idOf((inv as unknown as { subscription?: unknown }).subscription);
}

/* ------------------------------------------------------------------ database */

function dbFail(what: string, error: { code?: string } | null | undefined): never {
  console.error(`[fn] ${what} failed`, error?.code ?? "");
  throw new HttpError(502, "db_unavailable", "Die Datenbank antwortet gerade nicht.");
}

const SUB_COLUMNS =
  "id,user_id,stripe_customer_id,status,plan,price_id,interval,seats,amount,currency,current_period_end,cancel_at_period_end,cancel_at,canceled_at,trial_end,pause_resumes_at,has_payment_method,ref_code,last_event_at,updated_at,created_at";

/** The user's subscription rows, newest first (empty while the table does not exist). */
export async function subscriptionRows(userId: string): Promise<SubscriptionRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("subscriptions")
    .select(SUB_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) {
    if (isMissingTable(error)) return [];
    dbFail("subscriptions read", error);
  }
  return (data ?? []) as unknown as SubscriptionRow[];
}

/** The user's Stripe customer (server-side only), or null. */
export async function customerIdOf(userId: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("billing_customers").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
  if (error && !isMissingTable(error)) dbFail("billing_customers read", error);
  const own = (data as { stripe_customer_id?: string } | null)?.stripe_customer_id;
  if (own) return own;
  return (await subscriptionRows(userId))[0]?.stripe_customer_id || null;
}

async function userForCustomer(customerId: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("billing_customers").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
  const viaCustomer = validUuid((data as { user_id?: string } | null)?.user_id);
  if (viaCustomer) return viaCustomer;
  const { data: sub } = await sb.from("subscriptions").select("user_id").eq("stripe_customer_id", customerId).limit(1).maybeSingle();
  return validUuid((sub as { user_id?: string } | null)?.user_id);
}

/** Postgres foreign-key violation: the user the row points to no longer exists (account deleted). */
const FK_VIOLATION = "23503";

/** Links the user to a Stripe customer (the first link wins; a deleted account is skipped). */
export async function linkCustomer(userId: string, customerId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("billing_customers")
    .upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error && !isMissingTable(error) && error.code !== "23505" && error.code !== FK_VIOLATION) dbFail("billing_customers write", error);
}

/** The owner's members in the order they joined (oldest first; ties by id) – the first `seats - 1` hold a seat that is paid for. */
async function seatMembers(ownerId: string): Promise<string[] | null> {
  const { data, error } = await supabaseAdmin().from("team_seats").select("member_id,created_at").eq("owner_id", ownerId).limit(1000);
  if (error) {
    if (!isMissingTable(error)) console.error("[fn] team_seats read failed", error.code);
    return null;
  }
  return ((data ?? []) as { member_id: string; created_at?: string | null }[])
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.member_id.localeCompare(b.member_id))
    .map((m) => m.member_id);
}

/** The owner's live team subscription (the one that pays for the seats), or undefined. */
async function liveTeam(ownerId: string): Promise<SubscriptionRow | undefined> {
  return (await subscriptionRows(ownerId)).find((r) => r.plan === "team" && grantsPlan(r.status));
}

/**
 * What a user is entitled to RIGHT NOW (read only): own granting subscriptions and a team seat of an owner with a live team plan –
 * but only while the seat lies within the seats the owner pays for (the owner takes one; the newest members are the surplus,
 * Runde 11 Linse 1 #1: a Portal downgrade must not leave the members on Team for good).
 */
async function computePlan(userId: string): Promise<PlanInfo> {
  const sb = supabaseAdmin();
  const own = await subscriptionRows(userId);
  const candidates: PlanInfo[] = own.filter((r) => grantsPlan(r.status)).map((r) => ({ plan: r.plan, status: r.status, trialEnd: r.trial_end }));
  const seat = await sb.from("team_seats").select("owner_id").eq("member_id", userId).maybeSingle();
  const ownerId = validUuid((seat.data as { owner_id?: string } | null)?.owner_id);
  if (ownerId) {
    const team = await liveTeam(ownerId);
    if (team) {
      const members = await seatMembers(ownerId);
      const paid = Math.max(0, team.seats - 1);
      if (members?.slice(0, paid).includes(userId)) candidates.push({ plan: "team", status: team.status, trialEnd: null });
    }
  }
  const statusRank = (s: PlanStatus) => (s === "active" ? 3 : s === "trialing" ? 2 : 1);
  const best = candidates.sort((a, b) => PLAN_RANK[b.plan] - PLAN_RANK[a.plan] || statusRank(b.status) - statusRank(a.status))[0];
  const latest = own[0];
  return best ?? { plan: "free", status: latest?.status ?? "none", trialEnd: null };
}

const samePlan = (a: PlanInfo, b: PlanInfo): boolean => a.plan === b.plan && a.status === b.status && a.trialEnd === b.trialEnd;

/**
 * The best plan a user is entitled to, written to `profiles` (the only writer of `plan / plan_status / trial_end`). Two events of one
 * subscription can arrive at the same moment: the one that READ older facts could write last and leave a ended subscription on Pro
 * (Linse 1 #13). So after every write the facts are read again; when they moved meanwhile, the newest state is written – the last writer
 * always wrote what it saw AFTER its write, so the profile converges on the real state (three rounds at most, the daily
 * `billing-reconcile` catches the rest).
 */
export async function recomputePlan(userId: string): Promise<PlanInfo> {
  const sb = supabaseAdmin();
  let info = await computePlan(userId);
  for (let round = 0; ; round++) {
    const { error } = await sb.from("profiles").update({ plan: info.plan, plan_status: info.status, trial_end: info.trialEnd }).eq("id", userId);
    if (error) dbFail("profiles plan write", error);
    if (round >= 2) return info;
    const check = await computePlan(userId);
    if (samePlan(info, check)) return info;
    info = check;
  }
}

export interface SyncResult {
  userId: string;
  row: SubscriptionRow;
  plan: PlanInfo;
  /** The stored row was newer – nothing written. */
  stale?: boolean;
}

/**
 * Stores a Stripe subscription and recomputes the plan of its user (and of the team members when it is a team plan).
 * `fresh`: the object was just read from Stripe (always written); otherwise a snapshot older than the stored
 * `last_event_at` is skipped. Returns null when the subscription cannot be attributed to a user.
 */
export async function syncSubscription(
  sub: Stripe.Subscription,
  opts: { eventAt?: number | null; userId?: string | null; fresh?: boolean } = {},
): Promise<SyncResult | null> {
  const sb = supabaseAdmin();
  const customer = idOf(sub.customer);
  const prev = await sb.from("subscriptions").select("user_id,last_event_at").eq("id", sub.id).maybeSingle();
  if (prev.error && !isMissingTable(prev.error)) dbFail("subscriptions read", prev.error);
  const prevRow = prev.data as { user_id?: string; last_event_at?: string | null } | null;
  // a subscription never moves between users: the first attribution wins
  const userId =
    validUuid(prevRow?.user_id) ?? validUuid(opts.userId) ?? validUuid(sub.metadata?.supabase_user_id) ?? (customer ? await userForCustomer(customer) : null);
  if (!userId || !customer) {
    console.error("[fn] subscription without a user", sub.id);
    return null;
  }
  const row = rowFromSubscription(sub, userId, opts.eventAt ?? null);
  const storedAt = prevRow?.last_event_at ? Date.parse(prevRow.last_event_at) : NaN;
  if (!opts.fresh && opts.eventAt && Number.isFinite(storedAt) && storedAt > opts.eventAt * 1000) {
    return { userId, row, plan: await planOf(userId), stale: true };
  }
  if (Number.isFinite(storedAt) && (!opts.eventAt || storedAt > opts.eventAt * 1000)) row.last_event_at = prevRow!.last_event_at!;
  const { error } = await sb.from("subscriptions").upsert(row, { onConflict: "id" });
  if (error) {
    // the account was deleted (its rows cascaded away, e.g. the `customer.subscription.deleted` that follows the
    // cancellation in account-delete): nothing to store – acknowledge instead of letting Stripe retry for days
    if (error.code === FK_VIOLATION) {
      console.error("[fn] subscription of a deleted account", sub.id);
      return null;
    }
    dbFail("subscriptions write", error);
  }
  await linkCustomer(userId, customer);
  // the referral travels in the subscription's metadata: book it on WHICHEVER event comes first – Stripe does not
  // order `invoice.paid` after `checkout.session.completed`, and a missing row would lose the credit / commission
  // (review MONEY-02). recordReferral is idempotent (first referrer wins).
  if (row.ref_code) await recordReferral(row.ref_code, userId, sub.id);
  const plan = await recomputePlan(userId);
  // EVERY event of the owner's subscription, not only a team one: after a switch from Team to Pro (Customer Portal) or fewer seats the
  // members must lose the plan / the seat at once (Linse 1 #1)
  await recomputeMembers(userId);
  return { userId, row, plan };
}

/**
 * Re-checks the members of an owner's team. While the owner has a live team subscription the seats beyond the paid ones are removed
 * (newest first – the owner takes one seat, `seats - 1` members stay); without one the seat rows stay (the owner may come back) but
 * every member's plan is recomputed, which no longer counts them. Called on every subscription event of the owner and by the daily
 * reconcile. Returns the number of seats removed.
 */
export async function recomputeMembers(ownerId: string): Promise<number> {
  const members = await seatMembers(ownerId);
  if (!members?.length) return 0;
  let removed = 0;
  const team = await liveTeam(ownerId);
  if (team) {
    for (const m of members.slice(Math.max(0, team.seats - 1))) {
      const { error } = await supabaseAdmin().from("team_seats").delete().eq("owner_id", ownerId).eq("member_id", m);
      if (error) dbFail("team_seats delete", error);
      removed++;
    }
    if (removed) await audit(ownerId, "billing.seats", { removed, seats: team.seats, members: members.length });
  }
  for (const m of members) await recomputePlan(m);
  return removed;
}

/* ------------------------------------------------------------------ team seats (P12 links them to groups) */

/** Seats of the owner's live team subscription and how many are taken (the owner takes one). */
export async function seatUsage(ownerId: string): Promise<{ seats: number; used: number }> {
  const team = (await subscriptionRows(ownerId)).find((r) => r.plan === "team" && grantsPlan(r.status));
  const { count } = await supabaseAdmin().from("team_seats").select("member_id", { count: "exact", head: true }).eq("owner_id", ownerId);
  return { seats: team?.seats ?? 0, used: 1 + (count ?? 0) };
}

const NO_SEATS = () => new HttpError(409, "no_seats", "Alle Sitzplätze sind belegt. Erhöhe die Anzahl im Kundenportal.");
const SEAT_TAKEN = () => new HttpError(409, "seat_taken", "Dieses Mitglied hat schon einen Team-Sitz.");
/** PostgREST / Postgres: the function does not exist (migration 0007 not applied yet). */
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

/**
 * Gives `memberId` a seat of the owner's team plan (409 `no_seats` when all are taken, 402 without a team plan).
 * Count and insert run in ONE transaction under a per-owner lock (`assign_team_seat`, migration 0007, review
 * MONEY-03): two members joining at the same moment can no longer both take the last seat. Without 0007 the old
 * two-step write is used.
 */
export async function assignSeat(ownerId: string, memberId: string): Promise<PlanInfo> {
  if (ownerId === memberId) throw new HttpError(422, "invalid_member");
  const usage = await seatUsage(ownerId);
  if (usage.seats === 0) throw new HttpError(402, "plan_required", "Dafür brauchst du den Team-Tarif.");
  if (usage.used >= usage.seats) throw NO_SEATS();
  const rpc = await supabaseAdmin().rpc("assign_team_seat", { p_owner: ownerId, p_member: memberId, p_seats: usage.seats });
  if (!rpc.error) {
    if (rpc.data === "no_seats") throw NO_SEATS();
    if (rpc.data === "seat_taken") throw SEAT_TAKEN();
    if (rpc.data === "invalid_member") throw new HttpError(422, "invalid_member");
    if (rpc.data !== "ok") dbFail("team_seats write", { code: "unexpected" });
    return recomputePlan(memberId);
  }
  if (rpc.error.code === "23505") throw SEAT_TAKEN();
  if (!MISSING_FUNCTION.has(rpc.error.code ?? "")) dbFail("team_seats write", rpc.error);
  const { error } = await supabaseAdmin().from("team_seats").insert({ owner_id: ownerId, member_id: memberId });
  if (error) {
    if (error.code === "23505") throw SEAT_TAKEN();
    dbFail("team_seats write", error);
  }
  return recomputePlan(memberId);
}

/** Frees the member's seat; their plan falls back to their own subscriptions. */
export async function releaseSeat(ownerId: string, memberId: string): Promise<PlanInfo> {
  const { error } = await supabaseAdmin().from("team_seats").delete().eq("owner_id", ownerId).eq("member_id", memberId);
  if (error && !isMissingTable(error)) dbFail("team_seats delete", error);
  return recomputePlan(memberId);
}

/**
 * Account deletion of a team owner (`account-delete`, BEFORE `auth.admin.deleteUser`): frees every seat of the team so
 * each member's plan is recomputed from their own subscriptions. The cascade alone would drop the seats without touching
 * the members' `profiles.plan` – they would keep the Team plan for free. Returns the number of members released.
 */
export async function releaseOwnedSeats(ownerId: string): Promise<number> {
  const { data, error } = await supabaseAdmin().from("team_seats").select("member_id").eq("owner_id", ownerId).limit(1000);
  if (error) {
    if (isMissingTable(error)) return 0;
    dbFail("team_seats read", error);
  }
  const members = ((data ?? []) as { member_id: string }[]).map((m) => m.member_id);
  for (const m of members) await releaseSeat(ownerId, m);
  return members.length;
}

/* ------------------------------------------------------------------ config + status */

let priceCache: { key: string; at: number; prices: BillingConfig["prices"] } | null = null;
const PRICE_TTL_MS = 10 * 60_000;

/** Real prices of the configured price ids (cached 10 min per instance; Stripe down → `{}`, the client shows list prices). */
export async function configuredPrices(now = Date.now()): Promise<BillingConfig["prices"]> {
  const ids = PAID_PLANS.flatMap((p) => BILLING_INTERVALS.map((i) => [p, i, priceIdFor(p, i)] as const)).filter(
    (x): x is readonly [PaidPlanId, BillingInterval, string] => !!x[2],
  );
  const key = ids.map((x) => x[2]).join(",");
  if (priceCache && priceCache.key === key && now - priceCache.at < PRICE_TTL_MS) return priceCache.prices;
  const prices: BillingConfig["prices"] = {};
  try {
    const api = stripeApi();
    const got = await Promise.all(ids.map(async ([plan, interval, id]) => [plan, interval, await api.prices.retrieve(id)] as const));
    for (const [plan, interval, p] of got) {
      if (typeof p.unit_amount !== "number" || !p.active) continue;
      const info: PriceInfo = { amount: p.unit_amount, currency: p.currency, interval: p.recurring?.interval === "year" ? "year" : interval };
      (prices[plan] ??= {})[interval] = info;
    }
    priceCache = { key, at: now, prices };
  } catch (e) {
    console.error("[fn] stripe prices failed", (e as { code?: string }).code ?? (e instanceof Error ? e.name : ""));
  }
  return prices;
}

export async function billingConfig(): Promise<BillingConfig> {
  const enabled = billingConfigured();
  const gate = purchaseGate();
  return {
    enabled,
    purchaseOpen: gate.open,
    ...(gate.open ? {} : { purchaseBlockedBy: gate.blockedBy }),
    automaticTax: automaticTax(),
    consentHash: await serverConsentHash(),
    mailReady: contractMailReady(),
    ...(enabled ? {} : { reason: "stripe_missing" as const }),
    trialDays: trialDays(),
    referralTrialDays: referralTrialDays(),
    cardless: cardlessTrial(),
    prices: enabled ? await configuredPrices() : {},
    available: enabled ? availablePlans() : [],
    // only sold where it works: the pricing page hides "KI-Coach" without a key (Review F06)
    coachAi: !!envOptional("ANTHROPIC_API_KEY"),
  };
}

/** Newest invoices of the customer (≤ 6). */
export async function listInvoices(customerId: string): Promise<InvoiceSummary[]> {
  const res = await stripeCall("invoices", () => stripeApi().invoices.list({ customer: customerId, limit: 6 }));
  return res.data
    .filter((i) => i.status !== "draft")
    .map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status ?? null,
      total: i.total,
      currency: i.currency,
      created: new Date(i.created * 1000).toISOString(),
      hostedUrl: i.hosted_invoice_url ?? null,
      pdfUrl: i.invoice_pdf ?? null,
    }));
}

/* ------------------------------------------------------------------ customers + checkout */

/** The user's Stripe customer, created on first use (metadata `supabase_user_id` – P09's deletion finds it by that). */
export async function ensureCustomer(user: Pick<AuthUser, "id" | "email">): Promise<string> {
  const existing = await customerIdOf(user.id);
  if (existing) return existing;
  const created = await stripeCall("customer create", () =>
    stripeApi().customers.create(
      { ...(user.email ? { email: user.email } : {}), preferred_locales: ["de"], metadata: { supabase_user_id: user.id } },
      { idempotencyKey: `tj-customer-${user.id}` },
    ),
  );
  await linkCustomer(user.id, created.id);
  const winner = (await customerIdOf(user.id)) ?? created.id;
  await applyPendingCredits(user.id, winner);
  return winner;
}

/**
 * The address in the one form a trial is remembered by: lower case, without a `+tag` in the local part, and for Gmail without dots –
 * so `Anna.Beispiel+neu@gmail.com` and `annabeispiel@gmail.com` are one person. Not an identity check, a speed bump for serial trials.
 */
export function trialEmailKey(email: string): string | null {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1 || e.length > 254) return null;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  local = local.split("+")[0] ?? local;
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return local ? `${local}@${domain}` : null;
}

/** HMAC of the trial key under EVERY key of the pepper ring, newest first (a rotated pepper must not give a second trial). Never the address itself. */
function trialHashes(email: string): string[] {
  const key = trialEmailKey(email);
  return key ? purposeKeys("trial-email").map((k) => createHmac("sha256", k).update(key).digest("hex")) : [];
}

/** True when this ADDRESS already had a trial under an account that has since been deleted (`trial_tombstones`, migration 0019). */
export async function trialTombstoned(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const hashes = trialHashes(email);
  if (!hashes.length) return false;
  for (const h of hashes) {
    const { data, error } = await supabaseAdmin().from("trial_tombstones").select("email_hash").eq("email_hash", h).maybeSingle();
    if (error) {
      if (isMissingTable(error)) return false;
      dbFail("trial_tombstones read", error);
    }
    if (data) return true;
  }
  return false;
}

/**
 * Account deletion: remembers that this address had a trial (only the keyed hash, no address, no user id) so the same address cannot
 * start the next trial the day after (Linse 1 #6). Only written when the account really had one. Best effort – never blocks the deletion.
 * Returns whether a tombstone was written.
 */
export async function recordTrialTombstone(userId: string, email: string | null | undefined): Promise<boolean> {
  try {
    if (!email || !(await trialUsed(userId))) return false;
    const hashes = trialHashes(email);
    const first = hashes[0];
    if (!first) return false;
    const { error } = await supabaseAdmin().from("trial_tombstones").upsert({ email_hash: first }, { onConflict: "email_hash", ignoreDuplicates: true });
    if (error) {
      if (!isMissingTable(error)) console.error("[fn] trial_tombstones write failed", error.code);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[fn] trial tombstone failed", e instanceof Error ? e.name : typeof e);
    return false;
  }
}

/** True when the user (or, with `email`, the address of a deleted account) already had a trial (no second one). */
export async function trialUsed(userId: string, rows?: readonly SubscriptionRow[], email?: string | null): Promise<boolean> {
  const list = rows ?? (await subscriptionRows(userId));
  if (list.some((r) => r.trial_end)) return true;
  if ((await planOf(userId)).trialEnd !== null) return true;
  return trialTombstoned(email);
}

/** A live promotion code by its customer-facing code (null when unknown / inactive / used up / expired). */
export async function findPromotionCode(code: string): Promise<Stripe.PromotionCode | null> {
  const list = await stripeCall("promotion codes", () => stripeApi().promotionCodes.list({ code, active: true, limit: 1, expand: ["data.promotion.coupon"] }));
  const pc = list.data[0];
  if (!pc || !pc.active) return null;
  if (pc.expires_at && pc.expires_at * 1000 < Date.now()) return null;
  if (pc.max_redemptions && pc.times_redeemed >= pc.max_redemptions) return null;
  const coupon = pc.promotion?.coupon;
  if (coupon && typeof coupon === "object" && !coupon.valid) return null;
  return pc;
}

const euro = (cents: number, currency = "eur") =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

/** Preview of a promotion code for the pricing page. */
export async function lookupCode(raw: string): Promise<CodeLookup> {
  const code = normalizePromoCode(raw);
  const invalid: CodeLookup = { valid: false, code: code ?? String(raw).slice(0, 40), message: "Dieser Code ist ungültig oder abgelaufen." };
  if (!code) return invalid;
  const pc = await findPromotionCode(code);
  const coupon = pc?.promotion?.coupon;
  if (!pc || !coupon || typeof coupon !== "object") return invalid;
  const value = coupon.percent_off
    ? `−${coupon.percent_off.toLocaleString("de-DE")} %`
    : coupon.amount_off
      ? `−${euro(coupon.amount_off, coupon.currency ?? "eur")}`
      : "";
  const span =
    coupon.duration === "forever"
      ? "dauerhaft"
      : coupon.duration === "once"
        ? "auf die erste Zahlung"
        : coupon.duration_in_months
          ? `für ${coupon.duration_in_months} ${coupon.duration_in_months === 1 ? "Monat" : "Monate"}`
          : "";
  return {
    valid: true,
    code: pc.code.toUpperCase(),
    percentOff: coupon.percent_off ?? null,
    amountOff: coupon.amount_off ?? null,
    currency: coupon.currency ?? null,
    duration: coupon.duration === "once" ? "once" : coupon.duration === "forever" ? "forever" : coupon.duration === "repeating" ? "repeating" : undefined,
    durationInMonths: coupon.duration_in_months ?? null,
    firstTimeOnly: pc.restrictions?.first_time_transaction ?? false,
    restricted: !!coupon.applies_to?.products?.length,
    message: [value, span].filter(Boolean).join(" ") || "Code gültig.",
  };
}

/**
 * The text Stripe shows next to ITS submit button (`custom_text.submit`, up to 1200 chars): the order creates a payment
 * obligation (§ 312j Abs. 3 BGB). Stripe's own button reads "Zahlen" / "Testversion starten" - that wording cannot be set to
 * "zahlungspflichtig bestellen" in Checkout, so this text states it right beside the button. A point for the lawyer.
 */
export function checkoutSubmitText(trialDays: number): string {
  const trial = trialDays > 0 ? ` Nach der Testphase (${trialDays} Tage) beginnt die Zahlung automatisch.` : "";
  return `Mit dem Klick auf den Button gibst du eine zahlungspflichtige Bestellung ab.${trial} Das Abo verlängert sich automatisch um die gewählte Laufzeit, bis du kündigst – jederzeit zum Ende der Laufzeit über „Verträge hier kündigen“ in der App.`;
}

/**
 * Creates a Stripe Checkout session for the signed-in user (redirect URL). Order of the checks: the purchase flow is open
 * (Stripe + the operator's legal texts), no running subscription, BOTH consents ticked with the CURRENT wording, the evidence
 * is stored - only then the session is created, with an idempotency key per order (a double click or a retried request
 * returns the SAME session; the same order with other details is refused as `order_changed`).
 */
export async function createCheckout(user: AuthUser, body: CheckoutRequest, origin: string): Promise<CheckoutResponse> {
  assertPurchaseOpen();
  const priceId = priceIdFor(body.plan, body.interval);
  if (!billingConfigured() || !priceId) throw new HttpError(503, "billing_unavailable", OFF_MESSAGE);
  const rows = await subscriptionRows(user.id);
  if (rows.some((r) => grantsPlan(r.status) || r.status === "paused")) {
    throw new HttpError(409, "already_subscribed", "Du hast schon ein Abo. Tarif wechseln oder kündigen kannst du im Kundenportal.");
  }
  const consentHash = await checkConsents(body.consents, body.consentHash);
  const used = await trialUsed(user.id, rows, user.email);
  let ref = normalizeRefCode(body.ref);
  const referrer = ref ? await referrerOf(ref) : null;
  if (!referrer || referrer === user.id) ref = null;
  const days = used ? 0 : ref ? referralTrialDays() : trialDays();
  let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
  if (body.code) {
    const code = normalizePromoCode(body.code);
    const pc = code ? await findPromotionCode(code) : null;
    if (!pc) throw new HttpError(422, "invalid_code", "Dieser Code ist ungültig oder abgelaufen.");
    discounts = [{ promotion_code: pc.id }];
  }
  const team = body.plan === "team";
  const cat = PLAN_CATALOG.team;
  const seats = team ? Math.max(cat.minSeats ?? 2, Math.min(cat.maxSeats ?? 50, Math.round(body.seats ?? cat.minSeats ?? 2))) : 1;
  const consentAt = await storeConsents({ userId: user.id, orderId: body.orderId, plan: body.plan, interval: body.interval, seats });
  const customer = await ensureCustomer(user);
  const urls = returnUrls(origin, body.returnTo);
  const meta: Record<string, string> = {
    supabase_user_id: user.id,
    plan: body.plan,
    interval: body.interval,
    order_id: body.orderId,
    consent_at: consentAt,
    consent_hash: consentHash,
    ...(ref ? { ref } : {}),
  };
  // a trial WITHOUT a card only for Pro: Premium and Team carry the telephone, SMS and AI the operator pays per use (Linse 1 #6)
  const cardless = days > 0 && cardlessTrial() && body.plan === "pro";
  const tax = automaticTax();
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    locale: "de",
    line_items: [
      { price: priceId, quantity: seats, ...(team ? { adjustable_quantity: { enabled: true, minimum: cat.minSeats ?? 2, maximum: cat.maxSeats ?? 50 } } : {}) },
    ],
    success_url: urls.success,
    cancel_url: urls.cancel,
    metadata: meta,
    subscription_data: {
      metadata: meta,
      ...(days > 0 ? { trial_period_days: days } : {}),
      ...(cardless ? { trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
    },
    ...(cardless ? { payment_method_collection: "if_required" as const } : {}),
    // allow_promotion_codes and discounts are mutually exclusive: a pre-checked code is applied, otherwise the field shows
    ...(discounts ? { discounts } : { allow_promotion_codes: true }),
    // § 312j Abs. 3 BGB: Stripe's button cannot read "zahlungspflichtig bestellen" - `pay` + the text beside it say so
    submit_type: "pay",
    custom_text: { submit: { message: checkoutSubmitText(days) } },
    ...(tax
      ? { automatic_tax: { enabled: true }, customer_update: { address: "auto" as const, name: "auto" as const }, tax_id_collection: { enabled: true } }
      : {}),
    billing_address_collection: tax ? "required" : "auto",
  };
  const session = await stripeCall("checkout", () => stripeApi().checkout.sessions.create(params, { idempotencyKey: `tj-checkout-${user.id}-${body.orderId}` }));
  if (!session.url) throw new HttpError(502, "billing_unavailable", STRIPE_DOWN);
  await linkConsentSession(user.id, body.orderId, session.id);
  return { url: session.url, sessionId: session.id };
}

/* ------------------------------------------------------------------ portal + in-app changes */

export async function createPortal(userId: string, flow: PortalFlow, origin: string, returnTo?: string): Promise<string> {
  const customer = await customerIdOf(userId);
  if (!customer) throw new HttpError(404, "no_customer", "Du hast noch kein Abo – es gibt nichts zu verwalten.");
  const current = pickCurrent(await subscriptionRows(userId));
  const { path, hash } = safeReturnTo(returnTo);
  const returnUrl = `${origin}${path}?billing=portal${hash}`;
  let flowData: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;
  if (flow === "cancel" || flow === "update") {
    if (!current || !OPEN.has(current.status)) throw new HttpError(404, "no_subscription", "Es läuft gerade kein Abo.");
    flowData =
      flow === "cancel"
        ? {
            type: "subscription_cancel",
            subscription_cancel: { subscription: current.id },
            after_completion: { type: "redirect", redirect: { return_url: returnUrl } },
          }
        : { type: "subscription_update", subscription_update: { subscription: current.id } };
  } else if (flow === "payment") flowData = { type: "payment_method_update" };
  const session = await stripeCall("portal", () =>
    stripeApi().billingPortal.sessions.create({ customer, return_url: returnUrl, locale: "de", ...(flowData ? { flow_data: flowData } : {}) }),
  );
  return session.url;
}

/**
 * In-app changes of the user's OWN current subscription: `cancel` (at period end – the German "Jetzt kündigen" button,
 * with the reason as Stripe `cancellation_details`), `resume` (undo the cancellation / end a pause), `pause` (1–3
 * months without invoices; paused = no paid features). Writes the result right away (the webhook confirms it later).
 */
export async function changeSubscription(
  userId: string,
  action: PortalAction,
  opts: { reason?: CancelReason; comment?: string; months?: number } = {},
): Promise<{ subscription: SubscriptionSummary | null; plan: PlanInfo }> {
  const current = pickCurrent(await subscriptionRows(userId));
  if (!current || !OPEN.has(current.status)) throw new HttpError(404, "no_subscription", "Es läuft gerade kein Abo.");
  let params: Stripe.SubscriptionUpdateParams;
  if (action === "cancel") {
    const comment = opts.comment?.trim().slice(0, 500);
    params = { cancel_at_period_end: true, cancellation_details: { ...(opts.reason ? { feedback: opts.reason } : {}), ...(comment ? { comment } : {}) } };
  } else if (action === "resume") {
    params = { cancel_at_period_end: false, ...(current.status === "paused" || current.pause_resumes_at ? { pause_collection: "" as const } : {}) };
  } else if (action === "feedback") {
    // the optional reason AFTER the cancellation was confirmed (§ 312k: no question stands in front of the confirmation)
    if (!current.cancel_at_period_end) throw new HttpError(409, "not_canceled", "Es gibt keine Kündigung, zu der du etwas sagen könntest.");
    const comment = opts.comment?.trim().slice(0, 500);
    params = { cancellation_details: { ...(opts.reason ? { feedback: opts.reason } : {}), ...(comment ? { comment } : {}) } };
  } else {
    if (current.status !== "active" || current.cancel_at_period_end)
      throw new HttpError(409, "cannot_pause", "Pausieren geht nur bei einem laufenden, bezahlten Abo.");
    const months = Math.max(1, Math.min(3, Math.round(opts.months ?? 1)));
    params = { pause_collection: { behavior: "void", resumes_at: Math.floor(Date.now() / 1000) + months * 30 * 86_400 } };
  }
  const sub = await stripeCall(`subscription ${action}`, () => stripeApi().subscriptions.update(current.id, params));
  const res = await syncSubscription(sub, { userId, fresh: true, eventAt: Math.floor(Date.now() / 1000) });
  await audit(userId, "billing.subscription", { action, reason: opts.reason ?? null, plan: current.plan });
  return { subscription: res ? summaryOf(res.row) : null, plan: res?.plan ?? (await planOf(userId)) };
}

/**
 * Cancels every open subscription of the user IMMEDIATELY (no proration, invoices stay). For account deletion (P09
 * `billingCleanup.ts` may delegate here). Returns the number cancelled; Stripe errors throw (caller aborts).
 */
export async function cancelSubscription(userId: string): Promise<number> {
  const api = stripeApi();
  const customer = await customerIdOf(userId);
  if (!customer) return 0;
  const subs = await stripeCall("subscriptions list", () => api.subscriptions.list({ customer, status: "all", limit: 100 }));
  let n = 0;
  for (const s of subs.data) {
    if (!OPEN.has(s.status)) continue;
    await stripeCall("subscription cancel", () => api.subscriptions.cancel(s.id, { invoice_now: false, prorate: false }));
    n++;
  }
  return n;
}

/* ------------------------------------------------------------------ referrals */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A random 8-character referral code (no 0/O/1/I). */
export function newRefCode(bytes: Uint8Array = randomBytes(8)): string {
  return Array.from(bytes.slice(0, 8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** The user's referral code (created on first use) and their affiliate commission (null = normal referral). */
export async function referralCodeOf(userId: string): Promise<{ code: string; commissionPct: number | null }> {
  const sb = supabaseAdmin();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await sb.from("referral_codes").select("code,commission_pct").eq("user_id", userId).maybeSingle();
    if (error) dbFail("referral_codes read", error);
    const row = data as { code?: string; commission_pct?: number | string | null } | null;
    if (row?.code) return { code: row.code, commissionPct: row.commission_pct == null ? null : Number(row.commission_pct) };
    const ins = await sb.from("referral_codes").insert({ user_id: userId, code: newRefCode() });
    if (ins.error && ins.error.code !== "23505") dbFail("referral_codes write", ins.error);
  }
  throw new HttpError(503, "referral_unavailable");
}

/** Owner of a referral code, or null. */
export async function referrerOf(code: string): Promise<string | null> {
  const c = normalizeRefCode(code);
  if (!c) return null;
  const { data, error } = await supabaseAdmin().from("referral_codes").select("user_id").eq("code", c).maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error("[fn] referral lookup failed", error.code);
    return null;
  }
  return validUuid((data as { user_id?: string } | null)?.user_id);
}

/** Books a referral at the first subscription of the referred user (the first referrer wins; never a self-referral). */
export async function recordReferral(code: string, referredId: string, subscriptionId: string): Promise<void> {
  const referrer = await referrerOf(code);
  if (!referrer || referrer === referredId) return;
  const { error } = await supabaseAdmin()
    .from("referrals")
    .upsert(
      { referrer_id: referrer, referred_id: referredId, code: normalizeRefCode(code), status: "trialing", stripe_subscription_id: subscriptionId },
      { onConflict: "referred_id", ignoreDuplicates: true },
    );
  if (error && !isMissingTable(error) && error.code !== "23505") dbFail("referrals write", error);
}

/**
 * Applies the referrer's pending credits to their Stripe balance (negative balance = credit on the next invoices) – but only those
 * that have waited `REFERRAL_HOLD_DAYS` since the payment: a refund or a dispute of the referred person's first payment usually arrives
 * within that time, and a credit that already sits on the balance has to be taken back by a second booking (Linse 1 #3).
 */
export async function applyPendingCredits(referrerId: string, customerId: string, now = Date.now()): Promise<number> {
  const sb = supabaseAdmin();
  const cutoff = new Date(now - referralHoldDays() * 86_400_000).toISOString();
  const { data, error } = await sb
    .from("affiliate_ledger")
    .select("id,amount,currency")
    .eq("referrer_id", referrerId)
    .eq("kind", "credit")
    .eq("status", "pending")
    .lte("created_at", cutoff)
    .limit(50);
  if (error) {
    if (!isMissingTable(error)) console.error("[fn] ledger read failed", error.code);
    return 0;
  }
  let applied = 0;
  for (const row of (data ?? []) as { id: number; amount: number; currency: string }[]) {
    try {
      const txn = await stripeApi().customers.createBalanceTransaction(
        customerId,
        { amount: -Math.abs(row.amount), currency: row.currency, description: "Empfehlungs-Gutschrift" },
        { idempotencyKey: `tj-ref-credit-${row.id}` },
      );
      await sb.from("affiliate_ledger").update({ status: "applied", stripe_balance_txn_id: txn.id }).eq("id", row.id);
      applied++;
    } catch (e) {
      console.error("[fn] referral credit failed", (e as { code?: string }).code ?? "");
    }
  }
  return applied;
}

/** Commission months of an affiliate after the conversion. */
const COMMISSION_MONTHS = 12;

/** On `invoice.paid`: credit (referral) or commission (affiliate) for the referrer of the paying user. */
export async function rewardReferral(inv: Stripe.Invoice, subscriptionId: string | null): Promise<void> {
  if (!subscriptionId || inv.amount_paid <= 0) return;
  const sb = supabaseAdmin();
  const { data: subRow } = await sb.from("subscriptions").select("user_id,ref_code").eq("id", subscriptionId).maybeSingle();
  const stored = subRow as { user_id?: string; ref_code?: string | null } | null;
  const referredId = validUuid(stored?.user_id);
  if (!referredId) return;
  const readReferral = () => sb.from("referrals").select("id,referrer_id,status,converted_at").eq("referred_id", referredId).maybeSingle();
  let { data: ref, error } = await readReferral();
  // stored subscription with a code but no referral yet (an older row, or Stripe could not be re-read): book it now
  if (!error && !ref && stored?.ref_code) {
    await recordReferral(stored.ref_code, referredId, subscriptionId);
    ({ data: ref, error } = await readReferral());
  }
  if (error) {
    if (!isMissingTable(error)) console.error("[fn] referrals read failed", error.code);
    return;
  }
  const referral = ref as { id: number; referrer_id: string; status: string; converted_at: string | null } | null;
  if (!referral) return;
  const code = await sb.from("referral_codes").select("commission_pct").eq("user_id", referral.referrer_id).maybeSingle();
  const pct = (code.data as { commission_pct?: number | string | null } | null)?.commission_pct;
  const now = new Date().toISOString();
  if (pct != null && Number(pct) > 0) {
    const since = referral.converted_at ? Date.parse(referral.converted_at) : Date.now();
    if (Date.now() - since > COMMISSION_MONTHS * 31 * 86_400_000) return;
    const amount = Math.round((inv.amount_paid * Number(pct)) / 100);
    const ins = await sb
      .from("affiliate_ledger")
      .upsert(
        {
          referrer_id: referral.referrer_id,
          referral_id: referral.id,
          kind: "commission",
          amount,
          currency: inv.currency,
          status: "pending",
          stripe_invoice_id: inv.id,
        },
        { onConflict: "stripe_invoice_id,kind", ignoreDuplicates: true },
      );
    if (ins.error) dbFail("ledger write", ins.error);
  } else if (referral.status !== "paying") {
    const reward = referralRewardCents();
    // a real payment: at least what the credit is worth. An invoice of one cent (a 100 % code plus a cent) earned the referrer ten euros
    // for nothing (Linse 1 #3) – such a payment neither pays a credit nor counts as the conversion; a later full invoice still does
    if (reward > 0 && inv.amount_paid < reward) return;
    if (reward > 0) {
      const ins = await sb
        .from("affiliate_ledger")
        .upsert(
          {
            referrer_id: referral.referrer_id,
            referral_id: referral.id,
            kind: "credit",
            amount: reward,
            currency: inv.currency,
            status: "pending",
            stripe_invoice_id: inv.id,
          },
          { onConflict: "stripe_invoice_id,kind", ignoreDuplicates: true },
        );
      if (ins.error) dbFail("ledger write", ins.error);
      const customer = await customerIdOf(referral.referrer_id);
      if (customer) await applyPendingCredits(referral.referrer_id, customer);
    }
  }
  if (referral.status !== "paying")
    await sb
      .from("referrals")
      .update({ status: "paying", converted_at: referral.converted_at ?? now })
      .eq("id", referral.id);
}

/**
 * A refund or a dispute of the payment that earned a credit / commission takes it back (Linse 1 #3; the ledger kind `reversal` existed,
 * nothing wrote it). Per ledger row of that invoice:
 *  - still `pending` (waiting out the hold): `void` – it never reaches the balance;
 *  - `applied` (credit on the referrer's Stripe balance): a booking of the same amount the other way (positive balance transaction,
 *    idempotent per row) and a `reversal` row;
 *  - `paid` (a commission the operator paid out by hand): a `reversal` row, status `pending` – the operator settles it by hand.
 * The referral goes back to `canceled`, so a later REAL payment of that person can still earn the credit once. Idempotent per invoice
 * (`unique (stripe_invoice_id, kind)`); returns the number of ledger rows it changed.
 */
export async function reverseReferralForInvoice(invoiceId: string): Promise<number> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("affiliate_ledger")
    .select("id,referrer_id,referral_id,kind,amount,currency,status")
    .eq("stripe_invoice_id", invoiceId)
    .limit(10);
  if (error) {
    if (isMissingTable(error)) return 0;
    dbFail("ledger read", error);
  }
  const rows = (data ?? []) as { id: number; referrer_id: string; referral_id: number | null; kind: string; amount: number; currency: string; status: string }[];
  if (rows.some((r) => r.kind === "reversal")) return 0;
  let changed = 0;
  for (const row of rows) {
    if (row.kind !== "credit" && row.kind !== "commission") continue;
    if (row.status === "void") continue;
    let txnId: string | null = null;
    let status: "applied" | "pending" = "pending";
    if (row.status === "pending") {
      const up = await sb.from("affiliate_ledger").update({ status: "void" }).eq("id", row.id);
      if (up.error) dbFail("ledger write", up.error);
      changed++;
    } else if (row.status === "applied" && row.kind === "credit") {
      const customer = await customerIdOf(row.referrer_id);
      if (customer) {
        const txn = await stripeCall("balance reversal", () =>
          stripeApi().customers.createBalanceTransaction(
            customer,
            { amount: Math.abs(row.amount), currency: row.currency, description: "Empfehlungs-Gutschrift zurückgenommen (Erstattung oder Rückbuchung)" },
            { idempotencyKey: `tj-ref-reversal-${row.id}` },
          ),
        );
        txnId = txn.id;
        status = "applied";
      }
    }
    if (row.status === "applied" || row.status === "paid") {
      const ins = await sb.from("affiliate_ledger").upsert(
        {
          referrer_id: row.referrer_id,
          referral_id: row.referral_id,
          kind: "reversal",
          amount: row.amount,
          currency: row.currency,
          status,
          stripe_invoice_id: invoiceId,
          ...(txnId ? { stripe_balance_txn_id: txnId } : {}),
        },
        { onConflict: "stripe_invoice_id,kind", ignoreDuplicates: true },
      );
      if (ins.error) dbFail("ledger write", ins.error);
      changed++;
    }
    if (row.referral_id != null) await sb.from("referrals").update({ status: "canceled" }).eq("id", row.referral_id);
  }
  return changed;
}

/** The invoices a PaymentIntent paid (API 2025+: `invoice_payments`), plus the legacy `charge.invoice` when the object still has it. */
async function invoicesOfPayment(paymentIntent: string | null, legacyInvoice: unknown): Promise<string[]> {
  const out = new Set<string>();
  const legacy = idOf(legacyInvoice);
  if (legacy) out.add(legacy);
  if (paymentIntent) {
    const res = await stripeCall("invoice payments", () => stripeApi().invoicePayments.list({ payment: { type: "payment_intent", payment_intent: paymentIntent }, limit: 5 }));
    for (const p of res.data) {
      const id = idOf((p as { invoice?: unknown }).invoice);
      if (id) out.add(id);
    }
  }
  return [...out];
}

/** The user's referral page data (creates the code on first call). */
export async function referralInfo(userId: string): Promise<ReferralInfo> {
  const sb = supabaseAdmin();
  const { code, commissionPct } = await referralCodeOf(userId);
  const refs = await sb.from("referrals").select("status").eq("referrer_id", userId).limit(1000);
  const ledger = await sb
    .from("affiliate_ledger")
    .select("id,kind,amount,currency,status,created_at")
    .eq("referrer_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  const statuses = ((refs.data ?? []) as { status: string }[]).map((r) => r.status);
  const entries = (
    (ledger.data ?? []) as { id: number; kind: LedgerEntry["kind"]; amount: number; currency: string; status: LedgerEntry["status"]; created_at: string }[]
  ).map<LedgerEntry>((r) => ({
    id: r.id,
    kind: r.kind,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    createdAt: r.created_at,
  }));
  const sum = (pred: (e: LedgerEntry) => boolean) => entries.filter(pred).reduce((s, e) => s + (e.kind === "reversal" ? -e.amount : e.amount), 0);
  return {
    code,
    path: `/?ref=${code}`,
    trialDays: referralTrialDays(),
    rewardCents: commissionPct ? null : referralRewardCents(),
    commissionPct,
    currency: "eur",
    stats: { signups: statuses.length, paying: statuses.filter((s) => s === "paying").length },
    earned: { pending: sum((e) => e.status === "pending"), applied: sum((e) => e.status === "applied" || e.status === "paid") },
    ledger: entries,
  };
}

/* ------------------------------------------------------------------ webhook */

const SUB_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
]);

/** Re-reads a subscription from Stripe (latest state); null when that fails (the caller then uses the snapshot). */
export async function freshSubscription(id: string): Promise<Stripe.Subscription | null> {
  try {
    return await stripeApi().subscriptions.retrieve(id);
  } catch (e) {
    console.error("[fn] subscription re-read failed", id, (e as { code?: string }).code ?? "");
    return null;
  }
}

/** Handles one verified Stripe event; returns what happened. Throws to make Stripe retry. */
export async function handleStripeEvent(event: Stripe.Event): Promise<"processed" | "ignored"> {
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.mode !== "subscription") return "ignored";
    const userId = validUuid(s.client_reference_id) ?? validUuid(s.metadata?.supabase_user_id);
    const customer = idOf(s.customer);
    const subId = idOf(s.subscription);
    if (userId && customer) await linkCustomer(userId, customer);
    if (!subId) return "ignored";
    const sub = await freshSubscription(subId);
    if (!sub) throw new HttpError(502, "billing_unavailable", STRIPE_DOWN);
    const res = await syncSubscription(sub, { userId, eventAt: event.created, fresh: true });
    if (!res) return "ignored";
    const ref = normalizeRefCode(s.metadata?.ref ?? sub.metadata?.ref);
    if (ref) await recordReferral(ref, res.userId, sub.id);
    await audit(res.userId, "billing.checkout", { plan: res.row.plan, status: res.row.status, interval: res.row.interval, seats: res.row.seats });
    return "processed";
  }
  if (SUB_EVENTS.has(event.type)) {
    const snapshot = event.data.object as Stripe.Subscription;
    const fresh = await freshSubscription(snapshot.id);
    const res = await syncSubscription(fresh ?? snapshot, { eventAt: event.created, fresh: !!fresh });
    if (!res) return "ignored";
    if (event.type === "customer.subscription.deleted") {
      await supabaseAdmin().from("referrals").update({ status: "canceled" }).eq("stripe_subscription_id", snapshot.id).neq("status", "paying");
      await audit(res.userId, "billing.subscription", { event: "ended", plan: res.row.plan });
    } else if (event.type === "customer.subscription.trial_will_end") {
      await audit(res.userId, "billing.subscription", { event: "trial_will_end", trialEnd: res.row.trial_end });
    }
    return "processed";
  }
  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    // only a FULL refund takes a credit back (`refunded` is true only then; a partial one leaves the payment standing); a dispute always does
    const obj = event.data.object as Stripe.Charge | Stripe.Dispute;
    const isDispute = event.type === "charge.dispute.created";
    if (!isDispute && !(obj as Stripe.Charge).refunded) return "ignored";
    const paymentIntent = idOf((obj as { payment_intent?: unknown }).payment_intent);
    const invoices = await invoicesOfPayment(paymentIntent, (obj as { invoice?: unknown }).invoice);
    let changed = 0;
    for (const id of invoices) changed += await reverseReferralForInvoice(id);
    if (changed) console.error("[fn] referral booking reversed", event.type, changed);
    return changed ? "processed" : "ignored";
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const inv = event.data.object as Stripe.Invoice;
    const subId = invoiceSubscriptionId(inv);
    if (!subId) return "ignored";
    const sub = await freshSubscription(subId);
    const res = sub ? await syncSubscription(sub, { eventAt: event.created, fresh: true }) : null;
    if (event.type === "invoice.paid") await rewardReferral(inv, subId);
    else if (res) await audit(res.userId, "billing.subscription", { event: "payment_failed", attempt: inv.attempt_count });
    return "processed";
  }
  return "ignored";
}

/**
 * Idempotent processing of a verified event (`stripe_events`): an event already processed is acknowledged at once; a
 * delivery racing another one gets 409 (Stripe retries); a failure is recorded and rethrown (5xx → Stripe retries).
 */
export async function processEvent(event: Stripe.Event): Promise<{ result: "processed" | "ignored" | "duplicate" }> {
  const sb = supabaseAdmin();
  const seen = await sb.from("stripe_events").select("id,processed_at,attempts").eq("id", event.id).maybeSingle();
  const tracked = !seen.error;
  if (seen.error && !isMissingTable(seen.error)) dbFail("stripe_events read", seen.error);
  const row = seen.data as { processed_at?: string | null; attempts?: number } | null;
  if (row?.processed_at) return { result: "duplicate" };
  if (tracked) {
    if (!row) {
      const ins = await sb
        .from("stripe_events")
        .insert({ id: event.id, type: event.type.slice(0, 100), created_at: new Date(event.created * 1000).toISOString() });
      if (ins.error) {
        if (ins.error.code === "23505") throw new HttpError(409, "event_in_progress", "Dieses Ereignis wird gerade verarbeitet.");
        dbFail("stripe_events write", ins.error);
      }
    } else
      await sb
        .from("stripe_events")
        .update({ attempts: (row.attempts ?? 1) + 1, error: null })
        .eq("id", event.id);
  }
  try {
    const result = await handleStripeEvent(event);
    if (tracked) await sb.from("stripe_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", event.id);
    return { result };
  } catch (e) {
    const msg = e instanceof HttpError ? `${e.status} ${e.code}` : e instanceof Error ? e.name : "error";
    if (tracked)
      await sb
        .from("stripe_events")
        .update({ error: msg.slice(0, 300) })
        .eq("id", event.id);
    if (e instanceof HttpError) throw e.status < 500 && e.status !== 409 ? new HttpError(500, "webhook_failed") : e;
    console.error("[fn] webhook handler failed", event.type, msg);
    throw new HttpError(500, "webhook_failed");
  }
}

/** Verifies the raw body against `stripe-signature` (300 s tolerance). 400 on a bad signature, 503 without a secret. */
export async function verifyWebhook(raw: string, signature: string | null): Promise<Stripe.Event> {
  const secret = envOptional("STRIPE_WEBHOOK_SECRET");
  if (!secret || !envOptional("STRIPE_SECRET_KEY")) throw new HttpError(503, "billing_unavailable", OFF_MESSAGE);
  if (!signature) throw new HttpError(400, "invalid_signature", "Signatur fehlt.");
  try {
    return await stripeApi().webhooks.constructEventAsync(raw, signature, secret);
  } catch {
    throw new HttpError(400, "invalid_signature", "Signatur ungültig.");
  }
}

/* ------------------------------------------------------------------ status */

export async function billingStatus(user: AuthUser | null, opts: { invoices?: boolean } = {}): Promise<BillingStatus> {
  const config = await billingConfig();
  if (!user) return { config, plan: null, subscription: null, invoices: null, hasCustomer: false, trialUsed: false, team: null };
  const [plan, rows, customer] = await Promise.all([planOf(user.id), subscriptionRows(user.id), customerIdOf(user.id)]);
  const current = pickCurrent(rows);
  let invoices: InvoiceSummary[] | null = null;
  if (opts.invoices && customer && config.enabled) {
    try {
      invoices = await listInvoices(customer);
    } catch {
      invoices = null;
    }
  }
  const team = current?.plan === "team" && grantsPlan(current.status) ? await seatUsage(user.id) : null;
  return {
    config,
    plan,
    subscription: current ? summaryOf(current) : null,
    invoices,
    hasCustomer: !!customer,
    trialUsed: rows.some((r) => r.trial_end) || plan.trialEnd !== null || (await trialTombstoned(user.email)),
    team,
  };
}
