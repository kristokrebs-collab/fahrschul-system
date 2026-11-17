/**
 * German money / date / status wording for the billing UI (P10). Pure helpers – unit-tested in billing.plans.test.ts.
 */
import type { PriceInfo, SubscriptionSummary } from "./contract";
import { CURRENCY, LIST_PRICES, discounted, monthlyOfYearly, type PaidPlanId } from "./plans";
import type { BillingInterval, PlanStatus } from "./types";

const money = new Map<string, Intl.NumberFormat>();

/** `1200` → `12 €`, `999` → `9,99 €` (whole euros without decimals). */
export function formatMoney(cents: number, currency: string = CURRENCY): string {
  const cur = currency.toUpperCase();
  const whole = cents % 100 === 0;
  const key = `${cur}:${whole}`;
  let f = money.get(key);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", { style: "currency", currency: cur, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    money.set(key, f);
  }
  return f.format(cents / 100).replace(/\u00a0/g, " ");
}

/** Just the number part for the big price digits: `1200` → `12`, `999` → `9,99`. */
export function priceDigits(cents: number): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("de-DE", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/** `12.11.2026` (empty for null / invalid). */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(+d) ? "" : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Whole days from `now` until `iso` (≥ 0; null for no date). */
export function daysUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - now) / 86_400_000));
}

export interface DisplayPrice {
  /** Cents per period (per seat for team). */
  amount: number;
  currency: string;
  /** Cents per month (yearly divided by 12). */
  perMonth: number;
  interval: BillingInterval;
  /** From Stripe (true) or the owner's list price (false). */
  live: boolean;
}

/** The price to show: Stripe's real price when the server reported it, else the list price. */
export function displayPrice(
  plan: PaidPlanId,
  interval: BillingInterval,
  live?: Partial<Record<PaidPlanId, Partial<Record<BillingInterval, PriceInfo>>>> | null,
): DisplayPrice {
  const real = live?.[plan]?.[interval];
  const amount = real?.amount ?? LIST_PRICES[plan][interval];
  return {
    amount,
    currency: real?.currency ?? CURRENCY,
    perMonth: interval === "year" ? monthlyOfYearly(amount) : amount,
    interval,
    live: !!real,
  };
}

/** Per-month price after a promotion code preview. */
export function withCoupon(p: DisplayPrice, coupon: { percentOff?: number | null; amountOff?: number | null } | null | undefined): DisplayPrice {
  if (!coupon || (!coupon.percentOff && !coupon.amountOff)) return p;
  const amount = discounted(p.amount, coupon);
  return { ...p, amount, perMonth: p.interval === "year" ? monthlyOfYearly(amount) : amount };
}

export const STATUS_LABEL: Readonly<Record<PlanStatus, string>> = {
  none: "Kein Abo",
  trialing: "Testphase",
  active: "Aktiv",
  past_due: "Zahlung offen",
  canceled: "Beendet",
  incomplete: "Zahlung unvollständig",
  incomplete_expired: "Abgelaufen",
  unpaid: "Unbezahlt",
  paused: "Pausiert",
};

export type StatusTone = "win" | "warn" | "loss" | "mute";

export function statusTone(sub: Pick<SubscriptionSummary, "status" | "cancelAtPeriodEnd"> | null): StatusTone {
  if (!sub) return "mute";
  if (sub.status === "past_due" || sub.status === "unpaid" || sub.status === "incomplete") return "loss";
  if (sub.cancelAtPeriodEnd || sub.status === "paused" || sub.status === "trialing") return "warn";
  if (sub.status === "active") return "win";
  return "mute";
}

/** One line under the plan name: what happens next. */
export function nextLine(sub: SubscriptionSummary | null, now: number = Date.now()): string {
  if (!sub) return "Kostenlos – ohne Laufzeit.";
  if (sub.status === "paused") return sub.pausedUntil ? `Pausiert bis ${formatDay(sub.pausedUntil)}.` : "Pausiert.";
  if (sub.status === "past_due" || sub.status === "unpaid") return "Die letzte Zahlung ist fehlgeschlagen.";
  if (sub.cancelAtPeriodEnd) return `Gekündigt – läuft bis ${formatDay(sub.cancelAt ?? sub.currentPeriodEnd)}.`;
  if (sub.status === "trialing") {
    const d = daysUntil(sub.trialEnd, now);
    return d === null ? "Testphase." : d === 0 ? "Testphase endet heute." : `Testphase – noch ${d} ${d === 1 ? "Tag" : "Tage"}.`;
  }
  if (sub.status === "active") return sub.currentPeriodEnd ? `Verlängert sich am ${formatDay(sub.currentPeriodEnd)}.` : "Aktiv.";
  if (sub.status === "canceled") return "Das Abo ist beendet.";
  return STATUS_LABEL[sub.status];
}
