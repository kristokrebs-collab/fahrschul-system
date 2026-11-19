/**
 * The order (B4) as pure data: what the person is about to buy, what it costs, when it renews, what the order button may
 * do. No React, no store – `tests/unit/billing.purchase.order.test.ts` holds every rule. ENTWURF – Prüfung durch Anwalt nötig;
 * the sentences quote `src/legal/consentTexts.ts` (never re-worded here).
 *
 * Honesty rules: the yearly saving is computed from the prices that are SHOWN (`LIST_PRICES` unless Stripe reports real
 * ones) and only when the yearly price is really lower; tax is never shown as an amount we do not know (never "0,00"); the
 * price after a trial is named; the renewal date is a real date.
 */
import type { BillingConfig } from "../contract";
import { displayPrice } from "../format";
import { PLAN_CATALOG, type PaidPlanId } from "../plans";
import type { BillingInterval } from "../types";

export interface OrderDraft {
  plan: PaidPlanId;
  interval: BillingInterval;
  /** Team only (2–50); other plans are always 1. */
  seats: number;
}

export const seatsFor = (plan: PaidPlanId, seats: number): number => {
  if (plan !== "team") return 1;
  const cat = PLAN_CATALOG.team;
  return Math.max(cat.minSeats ?? 2, Math.min(cat.maxSeats ?? 50, Math.round(seats)));
};

/** The draft with plan-specific seats applied. */
export const normalizeDraft = (d: OrderDraft): OrderDraft => ({ plan: d.plan, interval: d.interval, seats: seatsFor(d.plan, d.seats) });

/* ------------------------------------------------------------------ yearly saving */

export interface YearlySaving {
  /** 12 × monthly – yearly, in cents (0 when yearly is not cheaper). */
  cents: number;
  /** Whole percent, rounded (the "−17 %" of the toggle). */
  pct: number;
  /** Whole months that are free, or `null` when the saving is not a whole number of months. */
  monthsFree: number | null;
}

/**
 * What paying yearly saves against 12 monthly payments – per seat/unit price, from the two prices given (cents). Pure
 * arithmetic on the prices that are shown, so the claim "Jährlich −X %" always has a calculation behind it.
 */
export function yearlySaving(monthCents: number, yearCents: number): YearlySaving {
  const full = monthCents * 12;
  if (monthCents <= 0 || yearCents >= full) return { cents: 0, pct: 0, monthsFree: null };
  const cents = full - yearCents;
  const months = cents / monthCents;
  return { cents, pct: Math.round((cents / full) * 100), monthsFree: Number.isInteger(months) ? months : null };
}

/** The saving of a plan from the displayed prices (Stripe's real price wins over the list price, exactly like the cards). */
export function planSaving(plan: PaidPlanId, prices?: BillingConfig["prices"] | null): YearlySaving {
  return yearlySaving(displayPrice(plan, "month", prices).amount, displayPrice(plan, "year", prices).amount);
}

/** `−17 %` for the toggle label, `null` when there is no saving (then the label says plainly "Jährlich"). */
export const savingLabel = (s: YearlySaving): string | null => (s.pct > 0 ? `−${s.pct} %` : null);

/* ------------------------------------------------------------------ dates */

/** `d` plus `n` whole days (UTC arithmetic: no daylight-saving drift). */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** `d` plus one billing interval; a 31st that the target month does not have lands on its last day (31 Jan + 1 month = 28/29 Feb). */
export function addInterval(d: Date, interval: BillingInterval): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const [ty, tm] = interval === "year" ? [y + 1, m] : [m === 11 ? y + 1 : y, (m + 1) % 12];
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(day, last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}

/** Date of the first payment: after the trial, or at the order. */
export const firstPaymentDate = (now: Date, trialDays: number): Date => addDays(now, Math.max(0, trialDays));

/** `12.11.2026` (German, Berlin time – the day the person sees on the invoice). */
export function formatOrderDay(d: Date, tz = "Europe/Berlin"): string {
  return d.toLocaleDateString("de-DE", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" });
}

/* ------------------------------------------------------------------ the summary */

export interface OrderSummary {
  draft: OrderDraft;
  /** Price per unit (seat) and interval, cents. */
  unitCents: number;
  /** unit × seats, cents (before a promotion code, before tax). */
  totalCents: number;
  /** After a promotion code preview (equal to `totalCents` without one). */
  payCents: number;
  currency: string;
  /** Trial days of this order (0 = none: the first payment is today). */
  trialDays: number;
  /** First payment (after the trial, else today). */
  firstPayment: Date;
  /** The renewal after that payment. */
  renewal: Date;
  saving: YearlySaving;
  /** Stripe Tax is on: the next step shows the tax. */
  automaticTax: boolean;
  /** The price is Stripe's real price (true) or the owner's list price (false). */
  live: boolean;
}

export function summarize(
  draft: OrderDraft,
  opts: {
    prices?: BillingConfig["prices"] | null;
    trialDays?: number;
    now?: Date;
    automaticTax?: boolean;
    /** A previewed promotion code (percent and/or amount off the FIRST payment; never shown as the permanent price). */
    coupon?: { percentOff?: number | null; amountOff?: number | null } | null;
  } = {},
): OrderSummary {
  const d = normalizeDraft(draft);
  const now = opts.now ?? new Date();
  const trialDays = Math.max(0, Math.round(opts.trialDays ?? 0));
  const price = displayPrice(d.plan, d.interval, opts.prices);
  const totalCents = price.amount * d.seats;
  let payCents = totalCents;
  if (opts.coupon?.percentOff) payCents = Math.round(payCents * (1 - opts.coupon.percentOff / 100));
  if (opts.coupon?.amountOff) payCents -= opts.coupon.amountOff;
  payCents = Math.max(0, payCents);
  const firstPayment = firstPaymentDate(now, trialDays);
  return {
    draft: d,
    unitCents: price.amount,
    totalCents,
    payCents,
    currency: price.currency,
    trialDays,
    firstPayment,
    renewal: addInterval(firstPayment, d.interval),
    saving: planSaving(d.plan, opts.prices),
    automaticTax: opts.automaticTax === true,
    live: price.live,
  };
}

/* ------------------------------------------------------------------ the order button */

export type OrderBlock = "terms" | "immediate" | "closed" | "busy" | "signedOut";

/**
 * May the order button send the order? `closed` (purchase flow not open), `signedOut` (the button then leads to the login and
 * back), `terms` / `immediate` (a box is not ticked), `busy` (a request runs – the double-click guard of the browser side;
 * the server's idempotency key is the other half).
 */
export function orderReadiness(s: { open: boolean; signedIn: boolean; terms: boolean; immediate: boolean; busy: boolean }): { ok: boolean; blocked: OrderBlock | null; missing: ("terms" | "immediate")[] } {
  const missing: ("terms" | "immediate")[] = [];
  if (!s.terms) missing.push("terms");
  if (!s.immediate) missing.push("immediate");
  if (!s.open) return { ok: false, blocked: "closed", missing };
  if (s.busy) return { ok: false, blocked: "busy", missing };
  if (!s.signedIn) return { ok: false, blocked: "signedOut", missing };
  if (missing.length) return { ok: false, blocked: missing[0]!, missing };
  return { ok: true, blocked: null, missing };
}

/* ------------------------------------------------------------------ return to the order after the login */

const ORDER_PARAM = /^([a-z]+)\.(month|year)\.(\d{1,2})$/;

/** `pro.year.1` – the order in the grammar of `returnTo` (`order:<plan>.<interval>.<seats>`). */
export const formatOrderParam = (d: OrderDraft): string => `${d.plan}.${d.interval}.${seatsFor(d.plan, d.seats)}`;

/** Inverse of `formatOrderParam`; anything else (an unknown plan, a free plan, a free-form string) is `null`. */
export function parseOrderParam(raw: string | null | undefined): OrderDraft | null {
  const m = raw ? ORDER_PARAM.exec(raw) : null;
  if (!m) return null;
  const plan = m[1];
  if (plan !== "pro" && plan !== "premium" && plan !== "team") return null;
  return normalizeDraft({ plan, interval: m[2] as BillingInterval, seats: Number(m[3]) });
}
