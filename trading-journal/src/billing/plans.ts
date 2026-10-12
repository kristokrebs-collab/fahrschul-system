/**
 * Plan catalog – feature matrix, limits and list prices per plan (P10). OWNER-EDITABLE: change prices, highlights,
 * which plan includes which feature and the limits here; the client gates (`useEntitlement`, `<Gate>`) and the server
 * (`netlify/functions/_lib/plan.ts` `requireFeature`) read the SAME table, so a change applies to both.
 *
 * PURE: no imports outside `./types`, no React, no `@/…` alias – the Netlify functions import this file by relative path.
 *
 * Prices: `LIST_PRICES` are the owner's list prices (cents, EUR, gross). The pricing page shows them until the server
 * reports the real Stripe prices (`/api/v1/billing/status` → `config.prices`), which then win – the page never shows a
 * price that Stripe would not charge. The Stripe price ids live in the server env (`STRIPE_PRICE_<PLAN>_<MONTHLY|YEARLY>`).
 */
import { FEATURES, LIMIT_KEYS, PLAN_IDS, type BillingInterval, type Feature, type LimitKey, type PlanId } from "./types";

export const PAID_PLANS = ["pro", "premium", "team"] as const;
export type PaidPlanId = (typeof PAID_PLANS)[number];

export const isPaidPlan = (v: unknown): v is PaidPlanId => typeof v === "string" && (PAID_PLANS as readonly string[]).includes(v);

/** Order of the plans (higher = more). `bestPlan` picks the highest granted one. */
export const PLAN_RANK: Readonly<Record<PlanId, number>> = { free: 0, pro: 1, premium: 2, team: 3 };

/* ------------------------------------------------------------------ features */

export type FeatureGroup = "sync" | "analyse" | "coach" | "tools" | "team";

export interface FeatureInfo {
  /** Short German name (pricing table row, upgrade sheet title). */
  label: string;
  /** One sentence: what it does for the trader. */
  pitch: string;
  group: FeatureGroup;
}

export const FEATURE_INFO: Readonly<Record<Feature, FeatureInfo>> = {
  cloudSync: { label: "Cloud-Sync", pitch: "Dein Journal auf allen Geräten – offline zuerst, lokal immer dabei.", group: "sync" },
  csvImport: { label: "CSV-Import", pitch: "Bestehende Trades aus Tabellen und Börsen-Exporten übernehmen.", group: "sync" },
  exchangeSync: { label: "Börsen-Sync", pitch: "Trades kommen automatisch von der Börse – kein Abtippen mehr.", group: "sync" },
  screenshotsCloud: { label: "Screenshots in der Cloud", pitch: "Chart-Screenshots sicher gespeichert und auf jedem Gerät da.", group: "sync" },
  apiAccess: { label: "API & Webhooks", pitch: "TradingView-Alerts und eigene Tools direkt anbinden.", group: "sync" },
  analyticsPro: { label: "Profi-Statistik", pitch: "Sharpe, Sortino und Breakdowns mit ehrlicher Unsicherheit.", group: "analyse" },
  monteCarlo: { label: "Monte Carlo & Ruin-Risiko", pitch: "Wie robust ist dein Edge über tausend mögliche Verläufe?", group: "analyse" },
  riskLive: { label: "Live-Risiko", pitch: "Limits, Exposure und Szenarien in Echtzeit im Blick.", group: "analyse" },
  replay: { label: "Trade-Replay", pitch: "Jeden Trade Kerze für Kerze nachspielen.", group: "analyse" },
  boxScanner: { label: "Box-Scanner", pitch: "Viele Märkte gleichzeitig auf Ausbrüche prüfen – mit Alarm.", group: "analyse" },
  coach: { label: "Coach", pitch: "Erkennt Revenge-Trades, Overtrading und deine teuersten Muster.", group: "coach" },
  coachAi: { label: "KI-Coach", pitch: "Formuliert deine Wochenanalyse in klaren, persönlichen Worten.", group: "coach" },
  reports: { label: "Berichte", pitch: "Wochen- und Monatsberichte auf Knopfdruck.", group: "coach" },
  reportsPdf: { label: "PDF-Export", pitch: "Berichte als PDF – für dich, dein Archiv oder deinen Mentor.", group: "coach" },
  growth: { label: "Ziele & Gewohnheiten", pitch: "Challenges, Streaks und Routinen, die dich dranbleiben lassen.", group: "coach" },
  backtestLab: { label: "Backtest-Labor", pitch: "Strategien gegen Historie testen – Walk-Forward inklusive.", group: "tools" },
  customDashboards: { label: "Eigene Dashboards", pitch: "Cockpit-Layouts genau für deinen Workflow.", group: "tools" },
  community: { label: "Community", pitch: "Gruppen und Ranglisten – anonym und nur mit Zustimmung.", group: "team" },
  mentor: { label: "Mentor-Modus", pitch: "Trades gezielt mit Mentor oder Schülern teilen.", group: "team" },
};

const FREE_FEATURES: readonly Feature[] = ["cloudSync", "csvImport", "community"];
const PRO_FEATURES: readonly Feature[] = [
  ...FREE_FEATURES,
  "screenshotsCloud",
  "exchangeSync",
  "analyticsPro",
  "monteCarlo",
  "riskLive",
  "coach",
  "reports",
  "replay",
  "boxScanner",
  "growth",
];
const PREMIUM_FEATURES: readonly Feature[] = [...PRO_FEATURES, "apiAccess", "coachAi", "reportsPdf", "backtestLab", "mentor", "customDashboards"];

/** Which plan includes which feature (owner-editable). Every feature must be in `team`. */
export const PLAN_FEATURES: Readonly<Record<PlanId, ReadonlySet<Feature>>> = {
  free: new Set(FREE_FEATURES),
  pro: new Set(PRO_FEATURES),
  premium: new Set(PREMIUM_FEATURES),
  team: new Set(FEATURES),
};

/** Numeric limits per plan (`Infinity` = unlimited; owner-editable). Team limits are per seat. */
export const PLAN_LIMITS: Readonly<Record<PlanId, Readonly<Record<LimitKey, number>>>> = {
  free: { exchangeConnections: 0, screenshotStorageMb: 0, savedViews: 3, dashboards: 1, groups: 1, coachAiPerDay: 0 },
  pro: { exchangeConnections: 1, screenshotStorageMb: 2048, savedViews: 25, dashboards: 3, groups: 3, coachAiPerDay: 0 },
  premium: { exchangeConnections: 5, screenshotStorageMb: 20480, savedViews: Infinity, dashboards: Infinity, groups: 10, coachAiPerDay: 50 },
  team: { exchangeConnections: 5, screenshotStorageMb: 20480, savedViews: Infinity, dashboards: Infinity, groups: Infinity, coachAiPerDay: 50 },
};

export const LIMIT_INFO: Readonly<Record<LimitKey, { label: string; unit?: string }>> = {
  exchangeConnections: { label: "Börsen-Verbindungen" },
  screenshotStorageMb: { label: "Screenshot-Speicher", unit: "MB" },
  savedViews: { label: "Gespeicherte Ansichten" },
  dashboards: { label: "Dashboards" },
  groups: { label: "Gruppen" },
  coachAiPerDay: { label: "KI-Coach pro Tag" },
};

/* ------------------------------------------------------------------ catalog */

export interface PlanCatalogEntry {
  id: PlanId;
  name: string;
  /** One line under the name. */
  tagline: string;
  /** The strongest 4 points ("trade the best") – the full matrix is in the comparison table. */
  highlights: readonly string[];
  /** Short word on the plan card art (dot-matrix, A–Z / digits only). */
  glyph: string;
  /** The page's recommended plan (one BorderBeam lap, "Beliebt"). */
  recommended?: boolean;
  /** Team: priced per seat, `minSeats`…`maxSeats`. */
  perSeat?: boolean;
  minSeats?: number;
  maxSeats?: number;
}

export const PLAN_CATALOG: Readonly<Record<PlanId, PlanCatalogEntry>> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Für den Start – dein Journal, deine Daten.",
    highlights: ["Journal, Übersicht & Kalender", "Cloud-Sync auf allen Geräten", "CSV-Import", "Local-first: alles bleibt bei dir"],
    glyph: "FREE",
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Für Trader, die ihren Edge messen wollen.",
    highlights: ["Börsen-Sync – Trades kommen automatisch", "Coach findet deine teuersten Fehler", "Profi-Statistik & Monte Carlo", "Trade-Replay & Box-Scanner"],
    glyph: "PRO",
    recommended: true,
  },
  premium: {
    id: "premium",
    name: "Premium",
    tagline: "Das volle Labor für Vollzeit-Trader.",
    highlights: ["Alles aus Pro", "KI-Coach mit Wochenanalyse", "Backtest-Labor, API & Webhooks", "5 Börsen · 20 GB Screenshots"],
    glyph: "MAX",
  },
  team: {
    id: "team",
    name: "Team",
    tagline: "Für Trading-Gruppen, Mentoren und Desks.",
    highlights: ["Alles aus Premium – je Sitz", "Gemeinsame Gruppen & Mentor-Modus", "Eine Rechnung für alle", "Ab 2 Sitzen"],
    glyph: "TEAM",
    perSeat: true,
    minSeats: 2,
    maxSeats: 50,
  },
};

/** List prices in cents (EUR, gross) – per seat for `team`. Owner-editable; Stripe's real prices win at runtime. */
export const LIST_PRICES: Readonly<Record<PaidPlanId, Readonly<Record<BillingInterval, number>>>> = {
  pro: { month: 1200, year: 12000 },
  premium: { month: 2400, year: 24000 },
  team: { month: 1900, year: 19000 },
};

export const CURRENCY = "eur";
/** Default trial (server: `TRIAL_DAYS`). */
export const DEFAULT_TRIAL_DAYS = 14;
/** Trial for visitors that came through a referral link (server: `REFERRAL_TRIAL_DAYS`). */
export const DEFAULT_REFERRAL_TRIAL_DAYS = 30;
/** Credit for the referrer once a referred trader paid the first invoice (server: `REFERRAL_REWARD_CENTS`). */
export const DEFAULT_REFERRAL_REWARD_CENTS = 1000;

/* ------------------------------------------------------------------ helpers */

/** Whether `plan` includes `feature`. */
export function planIncludes(plan: PlanId, feature: Feature): boolean {
  return PLAN_FEATURES[plan].has(feature);
}

/** Limit `key` of `plan` (`Infinity` = unlimited). */
export function limitOf(plan: PlanId, key: LimitKey): number {
  return PLAN_LIMITS[plan][key];
}

/** The cheapest plan that includes `feature` (Free when everyone has it). */
export function minPlanFor(feature: Feature): PlanId {
  for (const p of PLAN_IDS) if (planIncludes(p, feature)) return p;
  return "team";
}

/** The cheapest PAID plan that includes `feature` (what the upgrade sheet offers). */
export function upgradePlanFor(feature: Feature): PaidPlanId {
  const p = minPlanFor(feature);
  return p === "free" ? "pro" : p;
}

/** Highest-ranked plan of a list (`free` for none). */
export function bestPlan(plans: readonly PlanId[]): PlanId {
  return plans.reduce<PlanId>((best, p) => (PLAN_RANK[p] > PLAN_RANK[best] ? p : best), "free");
}

/** Features `plan` adds over `base` (upgrade sheet: "Das bekommst du dazu"). */
export function featuresGained(plan: PlanId, base: PlanId): Feature[] {
  return FEATURES.filter((f) => planIncludes(plan, f) && !planIncludes(base, f));
}

/** Monthly equivalent of a yearly price (cents, rounded). */
export function monthlyOfYearly(yearCents: number): number {
  return Math.round(yearCents / 12);
}

/** Savings of paying yearly vs 12 × monthly, in whole percent (0 when yearly is not cheaper). */
export function yearlySavingsPct(monthCents: number, yearCents: number): number {
  const full = monthCents * 12;
  if (full <= 0 || yearCents >= full) return 0;
  return Math.round(((full - yearCents) / full) * 100);
}

/** Price after a coupon (cents, never below 0). */
export function discounted(amountCents: number, coupon: { percentOff?: number | null; amountOff?: number | null }): number {
  let out = amountCents;
  if (coupon.percentOff) out = Math.round(out * (1 - coupon.percentOff / 100));
  if (coupon.amountOff) out -= coupon.amountOff;
  return Math.max(0, out);
}

/** Comparison table rows (feature rows grouped; limits as extra rows). */
export const COMPARISON_GROUPS: readonly { group: FeatureGroup; label: string }[] = [
  { group: "sync", label: "Daten & Sync" },
  { group: "analyse", label: "Analyse" },
  { group: "coach", label: "Coach & Wachstum" },
  { group: "tools", label: "Werkzeuge" },
  { group: "team", label: "Gemeinsam" },
];

/** Contract check (tests): every feature has info, every limit key a value, `team` has everything. */
export function catalogProblems(): string[] {
  const out: string[] = [];
  for (const f of FEATURES) {
    if (!FEATURE_INFO[f]) out.push(`feature ${f} has no info`);
    if (!PLAN_FEATURES.team.has(f)) out.push(`team misses ${f}`);
  }
  for (const p of PLAN_IDS) for (const k of LIMIT_KEYS) if (typeof PLAN_LIMITS[p][k] !== "number") out.push(`${p} misses limit ${k}`);
  for (let i = 1; i < PLAN_IDS.length; i++) {
    const lower = PLAN_IDS[i - 1]!;
    const higher = PLAN_IDS[i]!;
    for (const f of PLAN_FEATURES[lower]) if (!PLAN_FEATURES[higher].has(f)) out.push(`${higher} drops ${f} of ${lower}`);
  }
  return out;
}
