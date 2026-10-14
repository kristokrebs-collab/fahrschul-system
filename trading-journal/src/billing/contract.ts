/**
 * Wire contract of the billing functions (P10) – request / response shapes shared by the client (`src/billing/api.ts`)
 * and the Netlify functions (`netlify/functions/billing-*.mts`, imported by relative path). PURE: types and tiny
 * validators only, no `@/…` alias, no React.
 *
 * Routes (all JSON, errors in the shared envelope `{ error: { code, message } }`):
 * - GET  /api/v1/billing/status[?invoices=1]  → `BillingStatus` (config always; plan / subscription when signed in)
 * - POST /api/v1/billing/checkout             `CheckoutRequest` → `CheckoutResponse` (Stripe Checkout URL)
 * - POST /api/v1/billing/portal               `PortalRequest` → `PortalResponse` (portal URL, or the changed subscription)
 * - POST /api/v1/billing/code                 `{ code }` → `CodeLookup` (promotion code preview)
 * - GET  /api/v1/billing/referral[?code=…]    → `ReferralInfo` (own code + stats) / `ReferralCheck` (public check)
 * - POST /api/v1/stripe/webhook               Stripe only (raw body + `stripe-signature`)
 */
import type { PaidPlanId } from "./plans";
import type { BillingInterval, PlanId, PlanInfo, PlanStatus } from "./types";

export interface PriceInfo {
  /** Cents (per seat for team). */
  amount: number;
  currency: string;
  interval: BillingInterval;
}

/** Why payments are not available (`enabled: false`). */
export type BillingOffReason = "stripe_missing" | "functions_missing" | "no_cloud";

export interface BillingConfig {
  /** Stripe is configured (secret key + at least one price) – checkout works. */
  enabled: boolean;
  reason?: BillingOffReason;
  trialDays: number;
  referralTrialDays: number;
  /** Trial without a card (`payment_method_collection: if_required`). */
  cardless: boolean;
  /** Real Stripe prices per plan / interval (missing = not configured or Stripe unreachable). */
  prices: Partial<Record<PaidPlanId, Partial<Record<BillingInterval, PriceInfo>>>>;
  /** Plans that can be bought right now (a configured price id). */
  available: PaidPlanId[];
  /**
   * The AI coach can actually answer (`ANTHROPIC_API_KEY` set on the server). Without it the pricing page never sells
   * "KI-Coach" (Review F06); absent (older server / no functions) counts as off.
   */
  coachAi?: boolean;
}

export interface SubscriptionSummary {
  id: string;
  plan: PlanId;
  status: PlanStatus;
  interval: BillingInterval | null;
  seats: number;
  /** ISO end of the current period (renewal or end date). */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** ISO date the subscription will end (cancellation scheduled), null when it renews. */
  cancelAt: string | null;
  trialEnd: string | null;
  /** ISO date collection resumes (paused), null when not paused. */
  pausedUntil: string | null;
  /** Cents per period (all seats), null when unknown. */
  amount: number | null;
  currency: string | null;
  /** A payment method is on file (false during a card-less trial). */
  hasPaymentMethod: boolean | null;
}

export interface InvoiceSummary {
  id: string;
  number: string | null;
  status: string | null;
  /** Cents. */
  total: number;
  currency: string;
  /** ISO creation date. */
  created: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
}

export interface TeamSeats {
  seats: number;
  used: number;
}

export interface BillingStatus {
  config: BillingConfig;
  /** Effective plan of the signed-in user; null when the request was anonymous. */
  plan: PlanInfo | null;
  subscription: SubscriptionSummary | null;
  /** Only with `?invoices=1` (newest first, ≤ 6); null when not requested / unavailable. */
  invoices: InvoiceSummary[] | null;
  /** The user has a Stripe customer (portal available). */
  hasCustomer: boolean;
  /** The user already used a trial (no second one). */
  trialUsed: boolean;
  /** Team owner: seats bought / used. */
  team: TeamSeats | null;
}

export interface CheckoutRequest {
  plan: PaidPlanId;
  interval: BillingInterval;
  /** Team seats (2–50); ignored for the other plans. */
  seats?: number;
  /** Customer-facing promotion code (re-validated on the server). */
  code?: string;
  /** Referral code (`?ref=`). */
  ref?: string;
  /** Same-origin path (+ hash) to return to, e.g. `/#preise`. */
  returnTo?: string;
}

export interface CheckoutResponse {
  url: string;
  sessionId: string;
}

export const PORTAL_FLOWS = ["manage", "cancel", "update", "payment"] as const;
export type PortalFlow = (typeof PORTAL_FLOWS)[number];

export const PORTAL_ACTIONS = ["cancel", "resume", "pause"] as const;
export type PortalAction = (typeof PORTAL_ACTIONS)[number];

/** Stripe's `cancellation_details.feedback` values. */
export const CANCEL_REASONS = [
  "too_expensive",
  "missing_features",
  "unused",
  "switched_service",
  "too_complex",
  "low_quality",
  "customer_service",
  "other",
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export interface PortalRequest {
  /** Open the Stripe customer portal (optionally deep-linked into a flow). */
  flow?: PortalFlow;
  /** Change the subscription directly (in-app cancellation, undo, pause). */
  action?: PortalAction;
  reason?: CancelReason;
  comment?: string;
  /** pause: months (1–3). */
  months?: number;
  returnTo?: string;
}

export interface PortalResponse {
  url?: string;
  subscription?: SubscriptionSummary | null;
  plan?: PlanInfo;
}

export interface CodeLookup {
  valid: boolean;
  code: string;
  percentOff?: number | null;
  /** Cents. */
  amountOff?: number | null;
  currency?: string | null;
  duration?: "once" | "repeating" | "forever";
  durationInMonths?: number | null;
  /** Only for customers without a payment so far. */
  firstTimeOnly?: boolean;
  /** Restricted to some products. */
  restricted?: boolean;
  /** German note (why invalid, or the terms). */
  message?: string;
}

export interface ReferralCheck {
  valid: boolean;
  trialDays: number;
}

export interface LedgerEntry {
  id: number;
  kind: "credit" | "commission" | "reversal";
  /** Cents. */
  amount: number;
  currency: string;
  status: "pending" | "applied" | "paid" | "void";
  createdAt: string;
}

export interface ReferralInfo {
  code: string;
  /** Path to share (`/?ref=CODE`); the client prefixes its origin. */
  path: string;
  trialDays: number;
  /** Credit per paying referral (cents), null for affiliates (commission instead). */
  rewardCents: number | null;
  /** Affiliate commission in percent, null for normal referrals. */
  commissionPct: number | null;
  currency: string;
  stats: { signups: number; paying: number };
  earned: { pending: number; applied: number };
  ledger: LedgerEntry[];
}

/* ------------------------------------------------------------------ validators (client + server) */

/** Referral codes: 6–12 upper-case letters / digits (normalised to upper case). */
export const REF_CODE_RE = /^[A-Z0-9]{6,12}$/;

export function normalizeRefCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return REF_CODE_RE.test(c) ? c : null;
}

/** Stripe promotion codes: letters, digits and dashes (3–40). */
export const PROMO_CODE_RE = /^[A-Za-z0-9-]{3,40}$/;

export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return PROMO_CODE_RE.test(c) ? c : null;
}

/**
 * A safe same-origin return target: a path (no `//`, no scheme, ≤ 200 chars) and an optional `#hash` of the hash router.
 * Anything else falls back to `/#preise`.
 */
export function safeReturnTo(raw: unknown, fallback = "/#preise"): { path: string; hash: string } {
  const parse = (s: string) => {
    const m = /^(\/(?!\/)[A-Za-z0-9._~\-/]*)(#[A-Za-z0-9_\-/=&.]*)?$/.exec(s);
    return m ? { path: m[1]!, hash: m[2] ?? "" } : null;
  };
  if (typeof raw === "string" && raw.length <= 200) {
    const ok = parse(raw);
    if (ok) return ok;
  }
  return parse(fallback) ?? { path: "/", hash: "" };
}
