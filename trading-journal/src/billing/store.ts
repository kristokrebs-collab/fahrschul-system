/**
 * Billing state of the client (P10) – a light zustand store, no Stripe, no Supabase import. It mirrors what the
 * server says (`/api/v1/billing/status`) and runs the redirect flows. It NEVER decides a plan itself: the plan comes
 * from the server (written there only by the Stripe webhook) – the local copy only keeps the gates steady across reloads.
 *
 * Modes (`useBillingMode`):
 * - `off`    – no cloud in this build (file builds, `file://`, claude.ai, missing Supabase env): no billing UI, nothing gated;
 * - `closed` – cloud yes, but payments are not set up (no Stripe env / no functions): honest hint, nothing gated;
 * - `open`   – payments work: the plan's feature matrix (`plans.ts`) applies; signed out = Free.
 */
import { create } from "zustand";
import { ApiError, FUNCTIONS_MISSING } from "@/cloud/api";
import { cloudEnabled } from "@/cloud/env";
import { hasStoredSession } from "@/cloud/hint";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { hasClaudeRuntime } from "@/store/capability";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { pushToast } from "@/store/uiStore";
import { checkReferral, fetchBillingStatus, fetchReferral, postCheckout, postCode, postPortal, redirectToStripe } from "./api";
import type {
  BillingConfig,
  BillingStatus,
  CancelReason,
  CodeLookup,
  InvoiceSummary,
  PortalAction,
  PortalFlow,
  ReferralInfo,
  SubscriptionSummary,
  TeamSeats,
} from "./contract";
import { DEFAULT_REFERRAL_TRIAL_DAYS, DEFAULT_TRIAL_DAYS, type PaidPlanId } from "./plans";
import { BILLING } from "./strings";
import { FREE_PLAN, isPlanId, isPlanStatus, type BillingInterval, type Feature, type PlanInfo } from "./types";
import { clearReferral, currentReturnTo, storedReferral, type BillingReturn } from "./url";

export type BillingMode = "off" | "closed" | "open";

export interface BillingAccount {
  userId: string;
  plan: PlanInfo;
  subscription: SubscriptionSummary | null;
  invoices: InvoiceSummary[] | null;
  hasCustomer: boolean;
  trialUsed: boolean;
  team: TeamSeats | null;
}

export interface CheckoutIntent {
  plan: PaidPlanId;
  interval: BillingInterval;
  seats?: number;
}

export type BillingBusy = "checkout" | "portal" | "change" | "code" | "referral";

export interface BillingState {
  config: BillingConfig | null;
  configState: "idle" | "loading" | "ready" | "error";
  account: BillingAccount | null;
  /** Last known plan of a user + whether the shop was closed (storage; steady gates across reloads). */
  cached: BillingCache | null;
  busy: BillingBusy | null;
  /** Last promotion code preview (valid or not). */
  promo: CodeLookup | null;
  /** `?ref=` attributed to this browser. */
  referral: { code: string; valid: boolean | null; trialDays: number | null } | null;
  referralInfo: ReferralInfo | null;
  upgrade: { open: boolean; feature: Feature | null; plan: PaidPlanId | null };
  cancelOpen: boolean;
  /** A checkout waiting for the login to finish. */
  pending: CheckoutIntent | null;
  /** The Stripe return of this page load (BillingHost shows it). */
  returned: BillingReturn | null;
  /** Monthly / yearly toggle (pricing page + upgrade sheet share it). */
  interval: BillingInterval;
  /** Team seats picked on the pricing page. */
  seats: number;
}

export interface BillingCache {
  userId: string | null;
  plan: PlanInfo | null;
  closed: boolean;
  at: number;
}

export const BILLING_CACHE_KEY = storageKey("billing");

function readCache(): BillingCache | null {
  const raw = readJson<Partial<BillingCache> | null>(BILLING_CACHE_KEY, null);
  if (!raw || typeof raw !== "object") return null;
  const p = raw.plan as Partial<PlanInfo> | null | undefined;
  const plan: PlanInfo | null =
    p && isPlanId(p.plan) && isPlanStatus(p.status) ? { plan: p.plan, status: p.status, trialEnd: typeof p.trialEnd === "string" ? p.trialEnd : null } : null;
  return { userId: typeof raw.userId === "string" ? raw.userId : null, plan, closed: raw.closed === true, at: typeof raw.at === "number" ? raw.at : 0 };
}

const INITIAL: BillingState = {
  config: null,
  configState: "idle",
  account: null,
  cached: null,
  busy: null,
  promo: null,
  referral: null,
  referralInfo: null,
  upgrade: { open: false, feature: null, plan: null },
  cancelOpen: false,
  pending: null,
  returned: null,
  interval: "year",
  seats: 3,
};

export const useBilling = create<BillingState>()(() => ({ ...INITIAL, cached: readCache() }));

/** Tests: back to the initial state (re-reads the storage cache). */
export function resetBilling(): void {
  useBilling.setState({ ...INITIAL, cached: readCache() }, true);
}

/* ------------------------------------------------------------------ derived */

/** Billing exists in this build at all (cloud configured, a web build, not on claude.ai). */
export function billingActive(): boolean {
  return cloudEnabled() && !hasClaudeRuntime();
}

/** Pure mode resolution (see the file comment). Unknown config: the cached "closed" flag, else open. */
export function modeOf(active: boolean, config: BillingConfig | null, cached: BillingCache | null): BillingMode {
  if (!active) return "off";
  if (config) return config.enabled ? "open" : "closed";
  return cached?.closed ? "closed" : "open";
}

/** Pure effective plan: Free unless the shop is open and the signed-in user's plan is known (server, else cache). */
export function effectivePlanOf(mode: BillingMode, userId: string | null, account: BillingAccount | null, cached: BillingCache | null, restoring = false): PlanInfo {
  if (mode !== "open") return FREE_PLAN;
  // a stored login is being restored (reload): the last known plan of this browser keeps the gates steady
  if (!userId) return restoring && cached?.userId && cached.plan ? cached.plan : FREE_PLAN;
  if (account?.userId === userId) return account.plan;
  if (cached?.userId === userId && cached.plan) return cached.plan;
  return FREE_PLAN;
}

export function currentMode(): BillingMode {
  const s = useBilling.getState();
  return modeOf(billingActive(), s.config, s.cached);
}

/** What this deployment can deliver (the AI coach only with a server key – `BillingConfig.coachAi`, Review F06). */
export function useOffer(): { coachAi: boolean } {
  const coachAi = useBilling((s) => s.config?.coachAi === true);
  return { coachAi };
}

export function useBillingMode(): BillingMode {
  const config = useBilling((s) => s.config);
  const cached = useBilling((s) => s.cached);
  return modeOf(billingActive(), config, cached);
}

/** The signed-in user's id when the session is live (null otherwise). */
function sessionUserId(): string | null {
  const s = useCloudSession.getState();
  return s.phase === "signedIn" ? (s.user?.id ?? null) : null;
}

export function useEffectivePlan(): PlanInfo {
  const mode = useBillingMode();
  const userId = useCloudSession((s) => (s.phase === "signedIn" ? (s.user?.id ?? null) : null));
  const restoring = useCloudSession((s) => s.phase === "idle" || s.phase === "loading") && hasStoredSession();
  const account = useBilling((s) => s.account);
  const cached = useBilling((s) => s.cached);
  return effectivePlanOf(mode, userId, account, cached, restoring);
}

/** Trial days the next checkout gets (none after a used trial; longer via a valid referral). */
export function useTrialDays(): number {
  const config = useBilling((s) => s.config);
  const account = useBilling((s) => s.account);
  const referral = useBilling((s) => s.referral);
  if (account?.trialUsed || account?.subscription) return 0;
  if (referral?.valid) return referral.trialDays ?? config?.referralTrialDays ?? DEFAULT_REFERRAL_TRIAL_DAYS;
  return config?.trialDays ?? DEFAULT_TRIAL_DAYS;
}

/* ------------------------------------------------------------------ loading */

const CLOSED_CONFIG = (reason: BillingConfig["reason"]): BillingConfig => ({
  enabled: false,
  reason,
  trialDays: DEFAULT_TRIAL_DAYS,
  referralTrialDays: DEFAULT_REFERRAL_TRIAL_DAYS,
  cardless: false,
  prices: {},
  available: [],
});

function persist(config: BillingConfig | null, account: BillingAccount | null, userId: string | null): void {
  const cache: BillingCache = { userId, plan: account?.plan ?? null, closed: config ? !config.enabled : false, at: Date.now() };
  writeJson(BILLING_CACHE_KEY, cache);
  useBilling.setState({ cached: cache });
}

/** `ApiError`s that mean "no billing functions on this host" (SPA fallback page / 404 route). */
function functionsMissing(e: unknown): boolean {
  return e instanceof ApiError && ((e.status === 0 && e.message === FUNCTIONS_MISSING) || e.status === 404 || e.status === 405);
}

let loadSeq = 0;

/** Loads config + (signed in) the account from the server. `invoices` also fetches the newest invoices. */
export async function loadBilling(opts: { invoices?: boolean } = {}): Promise<BillingStatus | null> {
  if (!billingActive()) return null;
  const userId = sessionUserId();
  const seq = ++loadSeq;
  if (!useBilling.getState().config) useBilling.setState({ configState: "loading" });
  try {
    const status = await fetchBillingStatus({ invoices: opts.invoices });
    if (seq !== loadSeq || sessionUserId() !== userId) return status;
    const prev = useBilling.getState().account;
    const account: BillingAccount | null =
      userId && status.plan
        ? {
            userId,
            plan: status.plan,
            subscription: status.subscription,
            invoices: status.invoices ?? (prev?.userId === userId ? prev.invoices : null),
            hasCustomer: status.hasCustomer,
            trialUsed: status.trialUsed,
            team: status.team,
          }
        : null;
    useBilling.setState({ config: status.config, configState: "ready", account });
    persist(status.config, account, userId);
    return status;
  } catch (e) {
    if (seq !== loadSeq) return null;
    if (functionsMissing(e)) {
      const config = CLOSED_CONFIG("functions_missing");
      useBilling.setState({ config, configState: "ready", account: null });
      persist(config, null, userId);
    } else useBilling.setState({ configState: "error" });
    return null;
  }
}

/** Drops the account (sign-out). */
export function clearAccount(): void {
  useBilling.setState({ account: null, referralInfo: null });
}

/* ------------------------------------------------------------------ flows */

function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : BILLING.loadFailed;
}

let busyTimer: ReturnType<typeof setTimeout> | null = null;

/** Keeps `busy` while the browser leaves for Stripe; a blocked / cancelled navigation frees it again. */
function holdBusyForRedirect(): void {
  if (busyTimer) clearTimeout(busyTimer);
  busyTimer = setTimeout(() => useBilling.setState({ busy: null }), 15_000);
}

/** bfcache return (back button from Stripe): the page comes back as it was left – free the buttons. */
export function releaseBusy(): void {
  if (busyTimer) clearTimeout(busyTimer);
  busyTimer = null;
  useBilling.setState({ busy: null });
}

/**
 * Starts Stripe Checkout. Signed out → the login sheet opens and the checkout continues after the login
 * (`pending`, BillingHost). Closed shop → an honest toast. A valid code / stored referral travel along.
 */
export async function startCheckout(intent: CheckoutIntent): Promise<void> {
  const s = useBilling.getState();
  if (s.busy) return;
  if (currentMode() !== "open") {
    pushToast({ kind: "info", title: BILLING.closedTitle, detail: BILLING.closedText });
    return;
  }
  if (!sessionUserId()) {
    // the sheet first: BillingHost continues the checkout once it is closed again (signed in) or drops it
    openAuthSheet("signup", "card");
    useBilling.setState({ pending: intent });
    return;
  }
  useBilling.setState({ busy: "checkout", pending: null });
  try {
    const code = s.promo?.valid ? s.promo.code : undefined;
    const res = await postCheckout({
      ...intent,
      ...(code ? { code } : {}),
      ...(storedReferral() ? { ref: storedReferral()! } : {}),
      returnTo: currentReturnTo(),
    });
    holdBusyForRedirect();
    redirectToStripe(res.url);
  } catch (e) {
    useBilling.setState({ busy: null });
    if (e instanceof ApiError && e.code === "already_subscribed") {
      pushToast({ kind: "info", title: BILLING.alreadySubscribed });
      await loadBilling();
      return;
    }
    if (e instanceof ApiError && e.status === 503 && e.code === "billing_unavailable") {
      const config = CLOSED_CONFIG("stripe_missing");
      useBilling.setState({ config });
      persist(config, useBilling.getState().account, sessionUserId());
    }
    if (e instanceof ApiError && e.code === "invalid_code") useBilling.setState({ promo: null });
    pushToast({ kind: "error", title: errorText(e) });
  }
}

/** Opens the Stripe Customer Portal (optionally deep-linked into a flow). */
export async function openPortal(flow: PortalFlow = "manage"): Promise<void> {
  if (useBilling.getState().busy) return;
  useBilling.setState({ busy: "portal" });
  try {
    const res = await postPortal({ flow, returnTo: currentReturnTo() });
    if (!res.url) throw new ApiError(0, "no_url", BILLING.loadFailed);
    holdBusyForRedirect();
    redirectToStripe(res.url);
  } catch (e) {
    useBilling.setState({ busy: null });
    pushToast({ kind: "error", title: errorText(e) });
  }
}

/** In-app change of the own subscription (cancel at period end, undo, pause). Resolves true on success. */
export async function changeSubscription(action: PortalAction, opts: { reason?: CancelReason; comment?: string; months?: number } = {}): Promise<boolean> {
  if (useBilling.getState().busy) return false;
  const userId = sessionUserId();
  useBilling.setState({ busy: "change" });
  try {
    const res = await postPortal({ action, ...opts });
    const account = useBilling.getState().account;
    if (userId && account?.userId === userId) {
      const next: BillingAccount = { ...account, subscription: res.subscription ?? account.subscription, plan: res.plan ?? account.plan };
      useBilling.setState({ account: next });
      persist(useBilling.getState().config, next, userId);
    }
    return true;
  } catch (e) {
    pushToast({ kind: "error", title: errorText(e) });
    return false;
  } finally {
    useBilling.setState({ busy: null });
  }
}

/** Previews a promotion code (the checkout applies it). */
export async function checkCode(raw: string): Promise<CodeLookup | null> {
  const code = raw.trim();
  if (!code || useBilling.getState().busy) return null;
  useBilling.setState({ busy: "code" });
  try {
    const res = await postCode(code);
    useBilling.setState({ promo: res });
    return res;
  } catch (e) {
    useBilling.setState({ promo: null });
    pushToast({ kind: "error", title: errorText(e) });
    return null;
  } finally {
    useBilling.setState({ busy: null });
  }
}

export function clearCode(): void {
  useBilling.setState({ promo: null });
}

/** Validates the stored `?ref=` once (public check); an unknown code is forgotten. */
export async function verifyReferral(): Promise<void> {
  const code = storedReferral();
  if (!code) {
    useBilling.setState({ referral: null });
    return;
  }
  const cur = useBilling.getState().referral;
  if (cur?.code === code && cur.valid !== null) return;
  useBilling.setState({ referral: { code, valid: null, trialDays: null } });
  try {
    const res = await checkReferral(code);
    if (!res.valid) clearReferral();
    useBilling.setState({ referral: res.valid ? { code, valid: true, trialDays: res.trialDays } : null });
  } catch {
    // offline / no functions: keep the code, the server checks it again at checkout
    useBilling.setState({ referral: { code, valid: null, trialDays: null } });
  }
}

/** The own referral code + stats (signed in). */
export async function loadReferral(): Promise<ReferralInfo | null> {
  if (!sessionUserId()) return null;
  try {
    const info = await fetchReferral();
    useBilling.setState({ referralInfo: info });
    return info;
  } catch (e) {
    if (!functionsMissing(e)) pushToast({ kind: "error", title: errorText(e) });
    return null;
  }
}

/* ------------------------------------------------------------------ sheets + toggles */

export function openUpgrade(feature: Feature | null = null, plan: PaidPlanId | null = null): void {
  useBilling.setState({ upgrade: { open: true, feature, plan } });
}

export function closeUpgrade(): void {
  useBilling.setState((s) => ({ upgrade: { ...s.upgrade, open: false } }));
}

export function openCancel(): void {
  useBilling.setState({ cancelOpen: true });
}

export function closeCancel(): void {
  useBilling.setState({ cancelOpen: false });
}

export function setBillingInterval(interval: BillingInterval): void {
  useBilling.setState({ interval });
}

export function setSeats(seats: number): void {
  useBilling.setState({ seats: Math.max(2, Math.min(50, Math.round(seats))) });
}

export function setReturned(r: BillingReturn | null): void {
  useBilling.setState({ returned: r });
}
