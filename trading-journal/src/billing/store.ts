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
import { clearReturnTo, peekReturnTo, setReturnTo } from "@/store/returnTo";
import { hasClaudeRuntime } from "@/store/capability";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { pushToast } from "@/store/uiStore";
import { checkReferral, fetchBillingStatus, fetchReferral, postCode, postPortal, redirectToStripe } from "./api";
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
import { announcePlanChange } from "./planChange";
import { formatOrderParam, normalizeDraft, type OrderDraft } from "./purchase/order";
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
  /** The confirmation mail of the last in-app cancellation (`sent` / `unavailable` = mail not set up), `null` = none yet. */
  cancelMail: "sent" | "unavailable" | null;
  /** The order sheet (B4, lazy chunk `purchase/`): open + what is being ordered. `loaded` keeps the chunk mounted for its exit. */
  order: { open: boolean; draft: OrderDraft | null; loaded: boolean; openedAt: number };
  /** The tariff detail sheet (B4): which plan. */
  detail: { open: boolean; plan: PaidPlanId | null };
  /** The management sheet of Konto (B4). */
  manageOpen: boolean;
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
  cancelMail: null,
  order: { open: false, draft: null, loaded: false, openedAt: 0 },
  detail: { open: false, plan: null },
  manageOpen: false,
  returned: null,
  interval: "year",
  // the Team card starts at the MINIMUM (2 seats: 2 × 190 € = 380 € per year) – the amount shown is the smallest amount that can be ordered
  seats: 2,
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
export function sessionUserId(): string | null {
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

/** The same answer as `useEffectivePlan`, without a hook (timers, the motion tier's source – `src/motion/tier.ts`). */
export function effectivePlanNow(): PlanInfo {
  const restoring = (useCloudSession.getState().phase === "idle" || useCloudSession.getState().phase === "loading") && hasStoredSession();
  const b = useBilling.getState();
  return effectivePlanOf(currentMode(), sessionUserId(), b.account, b.cached, restoring);
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

export const CLOSED_CONFIG = (reason: BillingConfig["reason"]): BillingConfig => ({
  enabled: false,
  reason,
  trialDays: DEFAULT_TRIAL_DAYS,
  referralTrialDays: DEFAULT_REFERRAL_TRIAL_DAYS,
  cardless: false,
  prices: {},
  available: [],
});

export function persist(config: BillingConfig | null, account: BillingAccount | null, userId: string | null): void {
  const cache: BillingCache = { userId, plan: account?.plan ?? null, closed: config ? !config.enabled : false, at: Date.now() };
  writeJson(BILLING_CACHE_KEY, cache);
  useBilling.setState({ cached: cache });
}

/** `ApiError`s that mean "no billing functions on this host" (SPA fallback page / 404 route). */
export function functionsMissing(e: unknown): boolean {
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
    // a plan the SERVER now reports differently from the last one this browser knew for the same user = a confirmed change
    const known = prev?.userId === userId ? prev.plan.plan : useBilling.getState().cached?.userId === userId ? (useBilling.getState().cached?.plan?.plan ?? null) : null;
    useBilling.setState({ config: status.config, configState: "ready", account });
    persist(status.config, account, userId);
    if (account && known && known !== account.plan.plan) announcePlanChange({ from: known, to: account.plan.plan });
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

export function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : BILLING.loadFailed;
}

let busyTimer: ReturnType<typeof setTimeout> | null = null;

/** Keeps `busy` while the browser leaves for Stripe; a blocked / cancelled navigation frees it again. */
export function holdBusyForRedirect(): void {
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
 * The purchase flow may start (B4): the shop is `open` (Stripe set up) AND the server says the operator's legal texts are
 * complete (`config.purchaseOpen`; absent = an older server = locked – never an invented "open").
 */
export function purchaseOpenOf(config: BillingConfig | null, mode: BillingMode): { open: boolean; blockedBy: ("stripe" | "legal")[] } {
  if (mode === "off") return { open: false, blockedBy: [] };
  if (mode === "closed" || !config || !config.enabled) return { open: false, blockedBy: ["stripe"] };
  if (config.purchaseOpen === true) return { open: true, blockedBy: [] };
  return { open: false, blockedBy: config.purchaseBlockedBy?.length ? config.purchaseBlockedBy : ["legal"] };
}

export function usePurchaseGate(): { open: boolean; blockedBy: ("stripe" | "legal")[] } {
  const config = useBilling((s) => s.config);
  const mode = useBillingMode();
  return purchaseOpenOf(config, mode);
}

/** Opens the order sheet for `draft` (the sheet itself lives in the lazy chunk `purchase/`). */
export function openOrder(draft: OrderDraft): void {
  useBilling.setState({ order: { open: true, draft: normalizeDraft(draft), loaded: true, openedAt: Date.now() }, detail: { open: false, plan: useBilling.getState().detail.plan } });
}

export function closeOrder(): void {
  useBilling.setState((s) => ({ order: { ...s.order, open: false } }));
}

export function openDetail(plan: PaidPlanId): void {
  useBilling.setState({ order: { ...useBilling.getState().order, loaded: true }, detail: { open: true, plan } });
}

export function closeDetail(): void {
  useBilling.setState((s) => ({ detail: { ...s.detail, open: false } }));
}

export function openManage(): void {
  useBilling.setState({ order: { ...useBilling.getState().order, loaded: true }, manageOpen: true });
}

export function closeManage(): void {
  useBilling.setState({ manageOpen: false });
}

/** Where the login (or the plan wall) sends the person back to: exactly this order, the choice stays (`returnTo` grammar `order:…`). */
export function noteOrderReturn(draft: OrderDraft): void {
  setReturnTo({ kind: "order", order: formatOrderParam(draft) }, { on: "signedIn" }, "Bestellung");
}

/** How long an order waits for the configuration before it is decided on what is known (ms). */
export const CONFIG_WAIT_MS = 8000;

/** Resolves when the billing configuration has arrived or failed – at the latest after `CONFIG_WAIT_MS`. Starts the load if nobody has. */
export function whenConfigSettled(timeoutMs: number = CONFIG_WAIT_MS): Promise<void> {
  const settled = (): boolean => {
    const st = useBilling.getState();
    return st.config !== null || st.configState === "ready" || st.configState === "error";
  };
  if (settled()) return Promise.resolve();
  if (useBilling.getState().configState === "idle") void loadBilling().catch(() => undefined);
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      resolve();
    };
    const stop = useBilling.subscribe(() => {
      if (settled()) finish();
    });
    const timer = setTimeout(finish, timeoutMs);
    if (settled()) finish();
  });
}

/**
 * The entry of every "buy" button (B4): closed purchase flow → an honest toast and nothing else; signed out → the order is
 * noted for `returnTo` and the login opens (after it the ReturnHost reopens THIS order); signed in → the order sheet opens
 * with the summary. The order itself is placed ONLY by the button of that sheet.
 */
export function requestOrder(intent: CheckoutIntent, opts: { waited?: boolean } = {}): void {
  const draft = normalizeDraft({ plan: intent.plan, interval: intent.interval, seats: intent.seats ?? useBilling.getState().seats });
  const s = useBilling.getState();
  // The server's configuration is still on its way (right after a sign-in, or a link that opens the app on an order): decide when it
  // is there, not on a guess. Before, „not loaded yet“ counted as „Stripe not connected“: the order of a mail link was dropped with
  // the toast „Zahlungen noch nicht eingerichtet“ although payments were set up (QA Runde 13, AUTH-06 end to end).
  if (!opts.waited && !s.config && billingActive() && (s.configState === "idle" || s.configState === "loading")) {
    void whenConfigSettled().then(() => requestOrder(intent, { waited: true }));
    return;
  }
  const gate = purchaseOpenOf(s.config, currentMode());
  if (!gate.open) {
    pushToast({ kind: "info", title: BILLING.closedTitle, detail: gate.blockedBy.includes("legal") && !gate.blockedBy.includes("stripe") ? BILLING.legalClosedText : BILLING.closedText });
    return;
  }
  if (!sessionUserId()) {
    noteOrderReturn(draft);
    openAuthSheet("signup", "card");
    return;
  }
  openOrder(draft);
}

/**
 * "Kostenlos starten": the registration WITHOUT an order. A note of an earlier, abandoned order is dropped first – the
 * sheet must not show (and the way back must not open) a purchase the person did not choose just now. No card, no payment.
 */
export function requestFree(): void {
  if (peekReturnTo()?.target.kind === "order") clearReturnTo();
  openAuthSheet("signup", "card");
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
      if (next.plan.plan !== account.plan.plan) announcePlanChange({ from: account.plan.plan, to: next.plan.plan });
    }
    if (action === "cancel") useBilling.setState({ cancelMail: res.mail ?? null });
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
  // the result page lives in the lazy chunk of the purchase flow: asking for it loads it
  useBilling.setState((s) => ({ returned: r, order: r ? { ...s.order, loaded: true } : s.order }));
}
