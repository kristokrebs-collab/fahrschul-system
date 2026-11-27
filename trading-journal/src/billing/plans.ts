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
import { FEATURES, GOAL_IDS, LIMIT_KEYS, PLAN_IDS, type BillingInterval, type Feature, type GoalId, type LimitKey, type PlanId } from "./types";

export const PAID_PLANS = ["pro", "premium", "team"] as const;
export type PaidPlanId = (typeof PAID_PLANS)[number];

export const isPaidPlan = (v: unknown): v is PaidPlanId => typeof v === "string" && (PAID_PLANS as readonly string[]).includes(v);

/** Order of the plans (higher = more). `bestPlan` picks the highest granted one. */
export const PLAN_RANK: Readonly<Record<PlanId, number>> = { free: 0, pro: 1, premium: 2, team: 3 };

/* ------------------------------------------------------------------ features */

/**
 * The goals of a trader, in the order of the day. The tiles of the page "Funktionen" (`src/app/features.ts`
 * `FEATURE_GROUPS`) and the groups of the price comparison read THIS list, so a goal has one name everywhere.
 */
export const GOAL_NAME: Readonly<Record<GoalId, string>> = {
  heute: "Heute vorbereiten",
  pruefen: "Trade prüfen & Chart",
  aktien: "Aktien beobachten & bewerten",
  planen: "Trade planen",
  risiko: "Risiko & Disziplin",
  testen: "Strategie entwickeln & testen",
  lernen: "Aus Fehlern lernen",
  auswerten: "Auswerten & Berichte",
  wachsen: "Üben & Wachsen",
  daten: "Trades eintragen & Daten",
  community: "Community & Teilen",
  konto: "Konto, Einstellungen & Hilfe",
};

export interface FeatureInfo {
  /** Short German name (pricing table row, upgrade sheet title). */
  label: string;
  /** One sentence: what it does for the trader. */
  pitch: string;
  /** The goal it serves – the comparison on the pricing page is grouped by it. */
  goal: GoalId;
}

export const FEATURE_INFO: Readonly<Record<Feature, FeatureInfo>> = {
  cloudSync: { label: "Cloud-Sync", pitch: "Dein Journal auf allen Geräten – offline zuerst, lokal immer dabei.", goal: "daten" },
  csvImport: { label: "CSV-Import", pitch: "Bestehende Trades aus Tabellen und Börsen-Exporten übernehmen.", goal: "daten" },
  // honest scope (review F10): the API sync speaks Bitunix; every other venue comes in through its CSV export
  exchangeSync: { label: "Automatischer Börsen-Sync", pitch: "Trades kommen von allein von Bitunix – eine Börse lässt sich schon in Free von Hand abgleichen, andere per CSV-Export.", goal: "daten" },
  screenshotsCloud: { label: "Screenshots in der Cloud", pitch: "Chart-Screenshots sicher gespeichert und auf jedem Gerät da.", goal: "daten" },
  apiAccess: { label: "API & Webhooks", pitch: "TradingView-Alerts und eigene Tools direkt anbinden.", goal: "daten" },
  analyticsPro: { label: "Profi-Statistik", pitch: "Sharpe, Sortino und Breakdowns mit ehrlicher Unsicherheit.", goal: "auswerten" },
  monteCarlo: { label: "Monte Carlo & Ruin-Risiko", pitch: "Wie robust ist dein Edge über tausend mögliche Verläufe?", goal: "risiko" },
  riskLive: { label: "Live-Risiko", pitch: "Limits, Exposure und Szenarien in Echtzeit im Blick.", goal: "risiko" },
  replay: { label: "Trade-Replay", pitch: "Jeden Trade Kerze für Kerze nachspielen.", goal: "lernen" },
  boxScanner: { label: "Box-Scanner", pitch: "Viele Märkte gleichzeitig auf Ausbrüche prüfen – mit Alarm.", goal: "pruefen" },
  coach: { label: "Coach", pitch: "Erkennt Revenge-Trades, Overtrading und deine teuersten Muster.", goal: "lernen" },
  coachAi: { label: "KI-Coach", pitch: "Formuliert deine Wochenanalyse in klaren, persönlichen Worten.", goal: "lernen" },
  reports: { label: "Berichte", pitch: "Wochen- und Monatsberichte auf Knopfdruck.", goal: "auswerten" },
  reportsPdf: { label: "PDF-Export", pitch: "Berichte als PDF – für dich, dein Archiv oder deinen Mentor.", goal: "auswerten" },
  growth: { label: "Ziele & Gewohnheiten", pitch: "Challenges, Streaks und Routinen, die dich dranbleiben lassen.", goal: "wachsen" },
  backtestLab: { label: "Backtest-Labor", pitch: "Strategien gegen Historie testen – Walk-Forward inklusive.", goal: "testen" },
  customDashboards: { label: "Eigene Dashboards", pitch: "Cockpit-Layouts genau für deinen Workflow.", goal: "konto" },
  shotExtract: { label: "Screenshot-Import", pitch: "Liest Einstieg, Ausstieg, Stop und Ergebnis aus Börsen-Screenshots – du prüfst nur die unsicheren Werte.", goal: "daten" },
  // honest scope: reported numbers of US filers from SEC filings (no consensus, no price data), a DCF range and a thesis with refutation criteria
  stockAnalysis: { label: "Aktien-Analyse", pitch: "Quartalszahlen aus den SEC-Berichten, DCF-Spanne und überwachte Kaufthese – ohne Konsens, ohne Kursdaten.", goal: "aktien" },
  community: { label: "Community", pitch: "Gruppen und Ranglisten – anonym und nur mit Zustimmung.", goal: "community" },
  mentor: { label: "Mentor-Modus", pitch: "Trades gezielt mit Mentor oder Schülern teilen.", goal: "community" },
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
  "stockAnalysis",
];
const PREMIUM_FEATURES: readonly Feature[] = [...PRO_FEATURES, "apiAccess", "coachAi", "reportsPdf", "backtestLab", "mentor", "customDashboards", "shotExtract"];

/** Which plan includes which feature (owner-editable). Every feature must be in `team`. */
export const PLAN_FEATURES: Readonly<Record<PlanId, ReadonlySet<Feature>>> = {
  free: new Set(FREE_FEATURES),
  pro: new Set(PRO_FEATURES),
  premium: new Set(PREMIUM_FEATURES),
  team: new Set(FEATURES),
};

/**
 * Numeric limits per plan (`Infinity` = unlimited; owner-editable). Team limits are per seat.
 *
 * Tariff contract A1 (`docs/TARIFE.md`): the values marked "Vorschlag" there are proposals the operator releases (E8); this
 * table is the ONE place they are read from – the price page, the account page, the server (`requireLimit`) and the cron.
 * Free: one read-only exchange connection with manual sync and one TradingView connection (the operator's decision).
 */
export const PLAN_LIMITS: Readonly<Record<PlanId, Readonly<Record<LimitKey, number>>>> = {
  free: {
    exchangeConnections: 1,
    backgroundSyncConnections: 0,
    tvConnections: 1,
    alertChannels: 1,
    phoneCallsPerMonth: 0,
    screenshotStorageMb: 0,
    shotExtractPerDay: 0,
    coachAiPerDay: 0,
    simulationsPerDay: 20,
    savedViews: 3,
    dashboards: 1,
    groups: 1,
  },
  pro: {
    exchangeConnections: 1,
    backgroundSyncConnections: 1,
    tvConnections: 1,
    alertChannels: 2,
    phoneCallsPerMonth: 0,
    screenshotStorageMb: 2048,
    shotExtractPerDay: 0,
    coachAiPerDay: 0,
    simulationsPerDay: 200,
    savedViews: 25,
    dashboards: 3,
    groups: 3,
  },
  premium: {
    exchangeConnections: 5,
    backgroundSyncConnections: 5,
    tvConnections: 5,
    alertChannels: 3,
    phoneCallsPerMonth: 30,
    screenshotStorageMb: 20480,
    shotExtractPerDay: 20,
    coachAiPerDay: 50,
    simulationsPerDay: Infinity,
    savedViews: Infinity,
    dashboards: Infinity,
    groups: 10,
  },
  team: {
    exchangeConnections: 5,
    backgroundSyncConnections: 5,
    tvConnections: 5,
    alertChannels: 3,
    phoneCallsPerMonth: 60,
    screenshotStorageMb: 20480,
    shotExtractPerDay: 20,
    coachAiPerDay: 50,
    simulationsPerDay: Infinity,
    savedViews: Infinity,
    dashboards: Infinity,
    groups: Infinity,
  },
};

export interface LimitDetail {
  label: string;
  unit?: string;
  /**
   * `live` = the function exists and the limit is read where it is used (shown on the price page and in the account).
   * `geplant` = defined in the contract, but the function behind it is not built yet (a later package): NOT shown anywhere
   * a customer could read it as a promise – flip to `live` together with the package that enforces it.
   */
  state: "live" | "geplant";
  /** Where it is enforced (the tariff document says it honestly): the package or the file. */
  enforcedBy: string;
}

export const LIMIT_INFO: Readonly<Record<LimitKey, LimitDetail>> = {
  exchangeConnections: { label: "Börsen-Verbindungen", state: "live", enforcedBy: "Server: exchange-connect (requireLimit)" },
  backgroundSyncConnections: { label: "Automatischer Abgleich im Hintergrund", state: "live", enforcedBy: "Server: exchange-sync-cron (Tarif-Prüfung je Verbindung)" },
  tvConnections: { label: "TradingView-Verbindungen", state: "geplant", enforcedBy: "Paket B3 (TradingView-Verbindung)" },
  alertChannels: { label: "Alarm-Kanäle", state: "live", enforcedBy: "Server: alerts-prefs (Kanäle) und alerts-cron (Zustellung)" },
  phoneCallsPerMonth: { label: "Telefon-Anrufe pro Monat", state: "live", enforcedBy: "Server: alerts-phone und alerts-cron (Anruf-Zähler in der Datenbank)" },
  screenshotStorageMb: { label: "Screenshot-Speicher", unit: "MB", state: "live", enforcedBy: "Datenbank: Speicher-Richtlinien des Buckets screenshots" },
  shotExtractPerDay: { label: "Screenshot-Import pro Tag", state: "live", enforcedBy: "Server: shot-extract (Tageszähler)" },
  coachAiPerDay: { label: "KI-Coach pro Tag", state: "live", enforcedBy: "Server: coach-ask, assistant-route, strategy-compile (Tageszähler)" },
  simulationsPerDay: { label: "Simulationen pro Tag", state: "geplant", enforcedBy: "Paket A3 (Zeitmaschine persistent)" },
  savedViews: { label: "Gespeicherte Ansichten", state: "live", enforcedBy: "Browser: Ansichtenleiste (useLimit)" },
  dashboards: { label: "Dashboards", state: "live", enforcedBy: "Browser: Cockpit (useLimit)" },
  groups: { label: "Gruppen", state: "live", enforcedBy: "Server: social-groups (requireLimit)" },
};

/** The order the limits are listed in (price page, account, document). */
export const LIMIT_ORDER: readonly LimitKey[] = [
  "exchangeConnections",
  "backgroundSyncConnections",
  "tvConnections",
  "alertChannels",
  "phoneCallsPerMonth",
  "screenshotStorageMb",
  "shotExtractPerDay",
  "coachAiPerDay",
  "simulationsPerDay",
  "savedViews",
  "dashboards",
  "groups",
];

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

/** Premium's AI highlight – sold only where the AI coach works (`highlightsFor`, Review F06). */
export const COACH_AI_HIGHLIGHT = "KI-Coach mit Wochenanalyse";

export const PLAN_CATALOG: Readonly<Record<PlanId, PlanCatalogEntry>> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Für den Start – dein Journal, deine Daten.",
    highlights: ["Journal, Übersicht & Kalender", "Cloud-Sync auf allen Geräten", "CSV-Import und 1 Börse lesend (von Hand)", "Local-first: alles bleibt bei dir"],
    glyph: "FREE",
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Für Trader, die ihren Edge messen wollen.",
    highlights: [
      "Bitunix-Sync – Trades kommen automatisch",
      "Coach findet deine teuersten Fehler",
      "Profi-Statistik & Monte Carlo",
      "Trade-Replay & Box-Scanner",
    ],
    glyph: "PRO",
    recommended: true,
  },
  premium: {
    id: "premium",
    name: "Premium",
    tagline: "Das volle Labor für Vollzeit-Trader.",
    highlights: ["Alles aus Pro", COACH_AI_HIGHLIGHT, "Backtest-Labor, API & Webhooks", "5 Bitunix-Verbindungen · 20 GB Screenshots"],
    glyph: "PREMIUM",
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

/**
 * Features / limits that only exist where the server can deliver them: the AI coach needs `ANTHROPIC_API_KEY`
 * (`BillingConfig.coachAi`). Not offered → not listed in highlights, comparison or upgrade sheet (Review F06: Premium
 * sold "KI-Coach mit Wochenanalyse" although the button never appeared without the key).
 */
/** What Premium's highlight says instead while the AI coach is not offered (features Premium really adds). */
export const COACH_AI_FALLBACK_HIGHLIGHT = "Berichte als PDF & eigene Dashboards";

export interface Offer {
  coachAi: boolean;
}

// `Offer.coachAi` = "the server has an AI key" (`ANTHROPIC_API_KEY`): the screenshot import (vision) needs the same key.
const NEEDS_AI_KEY: readonly (Feature | LimitKey)[] = ["coachAi", "coachAiPerDay", "shotExtract", "shotExtractPerDay"];
export const featureOffered = (f: Feature, o: Offer): boolean => !NEEDS_AI_KEY.includes(f) || o.coachAi;
/** A limit is offered when the function behind it exists (`LIMIT_INFO[k].state`) and the server can deliver it (AI key). */
export const limitOffered = (k: LimitKey, o: Offer): boolean => LIMIT_INFO[k].state === "live" && (!NEEDS_AI_KEY.includes(k) || o.coachAi);

/** The plan's highlights as they can honestly be sold right now. */
export function highlightsFor(plan: PlanId, o: Offer): string[] {
  return PLAN_CATALOG[plan].highlights.map((h) => (h === COACH_AI_HIGHLIGHT && !o.coachAi ? COACH_AI_FALLBACK_HIGHLIGHT : h));
}

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

/** The cheapest paid plan above `current` whose limit for `key` exceeds `used` (Premium when none does). */
export function upgradePlanForLimit(key: LimitKey, current: PlanId, used: number): PaidPlanId {
  for (const p of PAID_PLANS) if (PLAN_RANK[p] > PLAN_RANK[current] && PLAN_LIMITS[p][key] > used) return p;
  return "premium";
}

/**
 * Automatic sync in the background (the cron): the plan has the feature `exchangeSync` AND a quota for it. Free syncs its
 * one read-only connection by hand only. The server cron, `exchangePlanState` and the account card read THIS.
 */
export function autoSyncAllowed(plan: PlanId): boolean {
  return planIncludes(plan, "exchangeSync") && limitOf(plan, "backgroundSyncConnections") > 0;
}

/**
 * Manual use of a read-only exchange connection (connect, sync by hand, open positions, import): the plan has a quota for
 * connections (Free: 1). Replaces the old rule "needs the feature `exchangeSync`", which left Free without any connection.
 */
export function exchangeAccessAllowed(plan: PlanId): boolean {
  return limitOf(plan, "exchangeConnections") > 0;
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

/** Comparison table groups: the goals of a trader (the same names as the tiles of the page "Funktionen"), in the order of the day. */
export const COMPARISON_GOALS: readonly { goal: GoalId; label: string }[] = GOAL_IDS.map((goal) => ({ goal, label: GOAL_NAME[goal] }));

/** The features of one goal, in the order of `FEATURES`. */
export const featuresOfGoal = (goal: GoalId): Feature[] => FEATURES.filter((f) => FEATURE_INFO[f].goal === goal);

/**
 * The cheapest plan from which `key` is more than nothing (limit > 0), `null` when no plan has it.
 * Used by the tariff document and the "next step" line of a function whose quota is 0 in the user's plan.
 */
export function minPlanForLimit(key: LimitKey): PlanId | null {
  for (const p of PLAN_IDS) if (PLAN_LIMITS[p][key] > 0) return p;
  return null;
}

/** Contract check (tests): every feature has info, every limit key a value, `team` has everything, the limits fit the features. */
export function catalogProblems(): string[] {
  const out: string[] = [];
  for (const f of FEATURES) {
    if (!FEATURE_INFO[f]) out.push(`feature ${f} has no info`);
    else if (!(GOAL_IDS as readonly string[]).includes(FEATURE_INFO[f].goal)) out.push(`feature ${f} has an unknown goal`);
    if (!PLAN_FEATURES.team.has(f)) out.push(`team misses ${f}`);
  }
  for (const p of PLAN_IDS) for (const k of LIMIT_KEYS) if (typeof PLAN_LIMITS[p][k] !== "number") out.push(`${p} misses limit ${k}`);
  for (const k of LIMIT_KEYS) if (!LIMIT_INFO[k]) out.push(`limit ${k} has no info`);
  if (LIMIT_ORDER.length !== LIMIT_KEYS.length || LIMIT_KEYS.some((k) => !LIMIT_ORDER.includes(k))) out.push("LIMIT_ORDER is not the list of limit keys");
  for (let i = 1; i < PLAN_IDS.length; i++) {
    const lower = PLAN_IDS[i - 1]!;
    const higher = PLAN_IDS[i]!;
    for (const f of PLAN_FEATURES[lower]) if (!PLAN_FEATURES[higher].has(f)) out.push(`${higher} drops ${f} of ${lower}`);
    // a higher plan never gets less of anything (team limits are per seat and equal Premium's or more)
    for (const k of LIMIT_KEYS) if (PLAN_LIMITS[higher][k] < PLAN_LIMITS[lower][k]) out.push(`${higher} has a smaller limit ${k} than ${lower}`);
  }
  // the automatic background sync is the feature `exchangeSync` – the limit says how many connections it may serve
  for (const p of PLAN_IDS) {
    if (PLAN_FEATURES[p].has("exchangeSync") !== PLAN_LIMITS[p].backgroundSyncConnections > 0) out.push(`${p}: exchangeSync and backgroundSyncConnections disagree`);
    if (PLAN_LIMITS[p].backgroundSyncConnections > PLAN_LIMITS[p].exchangeConnections) out.push(`${p}: more background syncs than connections`);
  }
  return out;
}
