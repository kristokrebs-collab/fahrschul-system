/**
 * Plan / feature vocabulary (Wave 0 – owner P10). PURE: no imports, no React – the Netlify functions import this file
 * by relative path (`../../../src/billing/types`), so it must never depend on `@/…` modules or build defines.
 *
 * Contract rules: ids are persisted (`profiles.plan`, `subscriptions`) – add new ones, never rename or remove.
 * The feature matrix and limits per plan live in `plans.ts` (P10).
 */

export const PLAN_IDS = ["free", "pro", "premium", "team"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** `profiles.plan_status` – Stripe subscription status, plus "none" for never subscribed. */
export const PLAN_STATUSES = ["none", "trialing", "active", "past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Gate-able features (`<Gate feature>`, `useEntitlement`, server `planOf`). */
export const FEATURES = [
  "cloudSync", // P09 sync across devices
  "screenshotsCloud", // P06 screenshots in Supabase Storage
  "exchangeSync", // P11 automatic exchange sync (cron)
  "csvImport", // P11 CSV importers
  "apiAccess", // P11 REST API + TradingView webhooks
  "analyticsPro", // P03 breakdowns with CI, ratios
  "monteCarlo", // P03 Monte Carlo / risk of ruin
  "riskLive", // P05 live limits, exposure, scenarios
  "coach", // P04 rule-based coach
  "coachAi", // P04 optional LLM wording (Premium)
  "reports", // P04 period reports
  "reportsPdf", // P04 PDF export
  "backtestLab", // P07 backtest lab, walk-forward
  "replay", // P06 trade replay
  "boxScanner", // P02 multi-symbol box scanner + alerts
  "growth", // P08 goals, challenges, habits
  "community", // P12 groups, leaderboards
  "mentor", // P12 mentor / student
  "customDashboards", // P13 cockpit layouts
] as const;
export type Feature = (typeof FEATURES)[number];

/** Numeric limits per plan (`useLimit`); `Infinity` = unlimited. */
export const LIMIT_KEYS = ["exchangeConnections", "screenshotStorageMb", "savedViews", "dashboards", "groups", "coachAiPerDay"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** Effective plan of a user (server: `planOf(userId)`, client: `usePlan()`). */
export interface PlanInfo {
  plan: PlanId;
  status: PlanStatus;
  /** ISO end of the trial, `null` when none. */
  trialEnd: string | null;
  /** Team seats (team plan only). */
  seats?: number;
}

export const FREE_PLAN: Readonly<PlanInfo> = Object.freeze({ plan: "free", status: "none", trialEnd: null });

export const isPlanId = (v: unknown): v is PlanId => typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
export const isPlanStatus = (v: unknown): v is PlanStatus => typeof v === "string" && (PLAN_STATUSES as readonly string[]).includes(v);
export const isFeature = (v: unknown): v is Feature => typeof v === "string" && (FEATURES as readonly string[]).includes(v);

/** Statuses that grant the paid plan's features (past_due keeps access during Stripe's dunning window). */
export function grantsPlan(status: PlanStatus): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}
