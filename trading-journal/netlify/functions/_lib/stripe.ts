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
 * REFERRAL_TRIAL_DAYS (30), REFERRAL_REWARD_CENTS (1000), SITE_ORIGIN.
 */
import { randomBytes } from "node:crypto";
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
import { audit } from "./audit";
import type { AuthUser } from "./auth";
import { envOptional, type ServerEnvName } from "./env";
import { HttpError } from "./http";
import { paymentsConfigured, planOf } from "./plan";
import { supabaseAdmin } from "./supabase";

/* ------------------------------------------------------------------ env */

/** Optional billing env names beyond `SERVER_ENV` (documented in `.env.example`). */
type BillingEnvName = ServerEnvName | "STRIPE_TRIAL_CARDLESS" | "STRIPE_AUTOMATIC_TAX" | "REFERRAL_TRIAL_DAYS" | "REFERRAL_REWARD_CENTS";

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
  };
  checkout: { sessions: { create(params: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }> } };
  billingPortal: { sessions: { create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }> } };
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>;
    update(id: string, params: Stripe.SubscriptionUpdateParams): Promise<Stripe.Subscription>;
    list(params: Stripe.SubscriptionListParams): Promise<{ data: Stripe.Subscription[] }>;
    cancel(id: string, params?: Stripe.SubscriptionCancelParams): Promise<Stripe.Subscription>;
  };
  invoices: { list(params: Stripe.InvoiceListParams): Promise<{ data: Stripe.Invoice[] }> };
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
  "id,user_id,stripe_customer_id,status,plan,price_id,interval,seats,amount,currency,current_period_end,cancel_at_period_end,cancel_at,canceled_at,trial_end,pause_resumes_at,has_payment_method,ref_code,last_event_at,updated_at";

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

/** The best plan a user is entitled to: own granting subscriptions and a team seat of an owner with a live team plan. */
export async function recomputePlan(userId: string): Promise<PlanInfo> {
  const sb = supabaseAdmin();
  const own = await subscriptionRows(userId);
  const candidates: PlanInfo[] = own.filter((r) => grantsPlan(r.status)).map((r) => ({ plan: r.plan, status: r.status, trialEnd: r.trial_end }));
  const seat = await sb.from("team_seats").select("owner_id").eq("member_id", userId).maybeSingle();
  const ownerId = validUuid((seat.data as { owner_id?: string } | null)?.owner_id);
  if (ownerId) {
    const team = (await subscriptionRows(ownerId)).find((r) => r.plan === "team" && grantsPlan(r.status));
    if (team) candidates.push({ plan: "team", status: team.status, trialEnd: null });
  }
  const statusRank = (s: PlanStatus) => (s === "active" ? 3 : s === "trialing" ? 2 : 1);
  const best = candidates.sort((a, b) => PLAN_RANK[b.plan] - PLAN_RANK[a.plan] || statusRank(b.status) - statusRank(a.status))[0];
  const latest = own[0];
  const info: PlanInfo = best ?? { plan: "free", status: latest?.status ?? "none", trialEnd: null };
  const { error } = await sb.from("profiles").update({ plan: info.plan, plan_status: info.status, trial_end: info.trialEnd }).eq("id", userId);
  if (error) dbFail("profiles plan write", error);
  return info;
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
  if (row.plan === "team") await recomputeMembers(userId);
  return { userId, row, plan };
}

async function recomputeMembers(ownerId: string): Promise<void> {
  const { data, error } = await supabaseAdmin().from("team_seats").select("member_id").eq("owner_id", ownerId).limit(1000);
  if (error) {
    if (!isMissingTable(error)) console.error("[fn] team_seats read failed", error.code);
    return;
  }
  for (const m of (data ?? []) as { member_id: string }[]) await recomputePlan(m.member_id);
}

/* ------------------------------------------------------------------ team seats (P12 links them to groups) */

/** Seats of the owner's live team subscription and how many are taken (the owner takes one). */
export async function seatUsage(ownerId: string): Promise<{ seats: number; used: number }> {
  const team = (await subscriptionRows(ownerId)).find((r) => r.plan === "team" && grantsPlan(r.status));
  const { count } = await supabaseAdmin().from("team_seats").select("member_id", { count: "exact", head: true }).eq("owner_id", ownerId);
  return { seats: team?.seats ?? 0, used: 1 + (count ?? 0) };
}

/** Gives `memberId` a seat of the owner's team plan (409 `no_seats` when all are taken, 402 without a team plan). */
export async function assignSeat(ownerId: string, memberId: string): Promise<PlanInfo> {
  if (ownerId === memberId) throw new HttpError(422, "invalid_member");
  const usage = await seatUsage(ownerId);
  if (usage.seats === 0) throw new HttpError(402, "plan_required", "Dafür brauchst du den Team-Tarif.");
  if (usage.used >= usage.seats) throw new HttpError(409, "no_seats", "Alle Sitzplätze sind belegt. Erhöhe die Anzahl im Kundenportal.");
  const { error } = await supabaseAdmin().from("team_seats").insert({ owner_id: ownerId, member_id: memberId });
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "seat_taken", "Dieses Mitglied hat schon einen Team-Sitz.");
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
  return {
    enabled,
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

/** True when the user already had a trial (no second one). */
export async function trialUsed(userId: string, rows?: readonly SubscriptionRow[]): Promise<boolean> {
  const list = rows ?? (await subscriptionRows(userId));
  if (list.some((r) => r.trial_end)) return true;
  return (await planOf(userId)).trialEnd !== null;
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

/** Creates a Stripe Checkout session for the signed-in user (redirect URL). */
export async function createCheckout(user: AuthUser, body: CheckoutRequest, origin: string): Promise<CheckoutResponse> {
  const priceId = priceIdFor(body.plan, body.interval);
  if (!billingConfigured() || !priceId) throw new HttpError(503, "billing_unavailable", OFF_MESSAGE);
  const rows = await subscriptionRows(user.id);
  if (rows.some((r) => grantsPlan(r.status) || r.status === "paused")) {
    throw new HttpError(409, "already_subscribed", "Du hast schon ein Abo. Tarif wechseln oder kündigen kannst du im Kundenportal.");
  }
  const used = await trialUsed(user.id, rows);
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
  const customer = await ensureCustomer(user);
  const team = body.plan === "team";
  const cat = PLAN_CATALOG.team;
  const seats = team ? Math.max(cat.minSeats ?? 2, Math.min(cat.maxSeats ?? 50, Math.round(body.seats ?? cat.minSeats ?? 2))) : 1;
  const { path, hash } = safeReturnTo(body.returnTo);
  const meta: Record<string, string> = { supabase_user_id: user.id, plan: body.plan, interval: body.interval, ...(ref ? { ref } : {}) };
  const cardless = days > 0 && cardlessTrial();
  const tax = automaticTax();
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    locale: "de",
    line_items: [
      { price: priceId, quantity: seats, ...(team ? { adjustable_quantity: { enabled: true, minimum: cat.minSeats ?? 2, maximum: cat.maxSeats ?? 50 } } : {}) },
    ],
    success_url: `${origin}${path}?billing=success&session_id={CHECKOUT_SESSION_ID}${hash}`,
    cancel_url: `${origin}${path}?billing=cancel${hash}`,
    metadata: meta,
    subscription_data: {
      metadata: meta,
      ...(days > 0 ? { trial_period_days: days } : {}),
      ...(cardless ? { trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
    },
    ...(cardless ? { payment_method_collection: "if_required" as const } : {}),
    // allow_promotion_codes and discounts are mutually exclusive: a pre-checked code is applied, otherwise the field shows
    ...(discounts ? { discounts } : { allow_promotion_codes: true }),
    ...(tax
      ? { automatic_tax: { enabled: true }, customer_update: { address: "auto" as const, name: "auto" as const }, tax_id_collection: { enabled: true } }
      : {}),
    billing_address_collection: tax ? "required" : "auto",
  };
  const session = await stripeCall("checkout", () => stripeApi().checkout.sessions.create(params));
  if (!session.url) throw new HttpError(502, "billing_unavailable", STRIPE_DOWN);
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

/** Applies the referrer's pending credits to their Stripe balance (negative balance = credit on the next invoices). */
export async function applyPendingCredits(referrerId: string, customerId: string): Promise<number> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("affiliate_ledger")
    .select("id,amount,currency")
    .eq("referrer_id", referrerId)
    .eq("kind", "credit")
    .eq("status", "pending")
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
async function freshSubscription(id: string): Promise<Stripe.Subscription | null> {
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
    trialUsed: rows.some((r) => r.trial_end) || plan.trialEnd !== null,
    team,
  };
}
