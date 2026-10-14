/**
 * The lazy cloud chunk (P09): Supabase client, auth state, every auth / 2FA / session action and the sync controller.
 * Load it through `ensureCloud()` (`runtime.ts`), never statically – the bundle without a login stays Supabase-free.
 *
 * - `createClient` with `auth.storageKey = KEYS.cloudAuth` (`tj2-sb-auth` / `tj2share-sb-auth` – the editions never
 *   share a login on one origin), PKCE flow (magic link / OAuth / reset come back as `?code=`; the hash router keeps
 *   its `#page`), auto refresh.
 * - `onAuthStateChange` never calls Supabase inside the callback (supabase-js deadlocks); it defers a refresh that
 *   writes the session store (`session.ts`).
 * - The access token getter is registered for `apiFetch` (`setAccessTokenProvider`).
 */
import { createClient, type AuthChangeEvent, type Factor, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { pushToast } from "@/store/uiStore";
import { KEYS } from "@/store/storage";
import { apiFetch, setAccessTokenProvider } from "./api";
import { authErrorText, type AuthErrorText } from "./authErrors";
import { cloudConfig, type OAuthProvider } from "./env";
import { ACCOUNT_PRIVACY_KEYS, onPrivacyChange, parsePrivacy, setPrivacy, usePrivacy, type PrivacyPrefs } from "./privacy";
import { openAuthSheet, SIGNED_OUT, useCloudSession } from "./session";
import { activeSync, startSyncController } from "./sync/controller";
import type { MfaFactor } from "./types";

let client: SupabaseClient | null = null;

/** The one browser client (created on first use). Throws when the cloud is not configured. */
export function getClient(): SupabaseClient {
  if (client) return client;
  const cfg = cloudConfig();
  if (!cfg) throw new Error("Cloud nicht eingerichtet");
  client = createClient(cfg.url, cfg.publishableKey, {
    auth: { storageKey: KEYS.cloudAuth, flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { headers: { "x-client-info": "trading-journal-web" } },
  });
  return client;
}

/** Tests: inject a fake client (`null` forgets it). */
export function setClientForTests(c: SupabaseClient | null): void {
  client = c;
  initialized = null;
}

/** Payload of a JWT (no verification – the server verifies; this only reads `session_id` / `aal`). */
export function jwtClaims(token: string | null | undefined): Record<string, unknown> {
  const part = token?.split(".")[1];
  if (!part) return {};
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toFactors(list: readonly Factor[] | undefined): MfaFactor[] {
  return (list ?? [])
    .filter((f) => f.factor_type === "totp")
    .map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null, status: f.status === "verified" ? "verified" : "unverified", createdAt: f.created_at ?? null }));
}

/** Reads the session (+ factors, assurance level) into the session store. */
export async function refreshAuthState(opts: { factors?: boolean } = {}): Promise<Session | null> {
  const sb = getClient();
  const { data } = await sb.auth.getSession();
  const session = data.session;
  if (!session) {
    useCloudSession.setState({ phase: "signedOut", ...SIGNED_OUT });
    return null;
  }
  const user = session.user;
  let factors = toFactors(user.factors);
  if (opts.factors) {
    const listed = await sb.auth.mfa.listFactors().catch(() => null);
    if (listed && !listed.error) factors = toFactors(listed.data.all);
  }
  const claims = jwtClaims(session.access_token);
  const aal = claims.aal === "aal2" ? "aal2" : "aal1";
  const verified = factors.some((f) => f.status === "verified");
  useCloudSession.setState({
    phase: "signedIn",
    user: { id: user.id, email: user.email ?? null, aal, mfaEnrolled: verified },
    needsMfa: verified && aal !== "aal2",
    factors,
    provider: typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : null,
    emailConfirmed: !!user.email_confirmed_at,
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    sessionId: typeof claims.session_id === "string" ? claims.session_id : null,
  });
  return session;
}

/** Best-effort audit row for an event that happened against Supabase Auth directly. */
export function auditEvent(action: string, meta?: Record<string, string | boolean>): void {
  void apiFetch("/audit", { method: "POST", body: { action, meta } }).catch(() => undefined);
}

let lastSignedInUser: string | null = null;

async function onAuthEvent(event: AuthChangeEvent): Promise<void> {
  const session = await refreshAuthState({ factors: event === "SIGNED_IN" || event === "MFA_CHALLENGE_VERIFIED" || event === "USER_UPDATED" });
  const s = useCloudSession.getState();
  if (event === "PASSWORD_RECOVERY") {
    openAuthSheet("newPassword", "callback");
    return;
  }
  if (event === "SIGNED_IN" && session && lastSignedInUser !== session.user.id) {
    lastSignedInUser = session.user.id;
    auditEvent("auth.signin", { provider: s.provider ?? "email" });
    void adoptProfilePrivacy();
    if (s.sheet.open && ["signin", "magic", "signup", "sent"].includes(s.sheet.view)) {
      useCloudSession.setState({ sheet: { ...s.sheet, view: s.needsMfa ? "mfa" : "welcome" } });
    } else if (s.needsMfa) openAuthSheet("mfa", "callback");
  }
  if (event === "SIGNED_OUT") lastSignedInUser = null;
}

let initialized: Promise<void> | null = null;
let stopController: (() => void) | null = null;

/** Clears a failed / used auth callback from the URL (keeps the hash route). */
function cleanCallbackUrl(): { error: AuthErrorText | null } {
  try {
    const u = new URL(location.href);
    const code = u.searchParams.get("error_code") ?? u.searchParams.get("error");
    const desc = u.searchParams.get("error_description");
    const params = ["code", "error", "error_code", "error_description", "sb_flow_id"];
    if (!params.some((p) => u.searchParams.has(p))) return { error: null };
    for (const p of params) u.searchParams.delete(p);
    history.replaceState(history.state, "", u.toString());
    return { error: code || desc ? authErrorText({ code: code ?? undefined, message: desc ?? "" }) : null };
  } catch {
    return { error: null };
  }
}

/** One-time setup: token provider, auth listener, session restore (incl. a callback in the URL), sync controller. */
export function initClient(): Promise<void> {
  return (initialized ??= (async () => {
    const st = useCloudSession.getState();
    if (st.phase === "idle" || st.phase === "off") useCloudSession.setState({ phase: "loading" });
    const sb = getClient();
    setAccessTokenProvider(async () => (await sb.auth.getSession()).data.session?.access_token ?? null);
    sb.auth.onAuthStateChange((event) => {
      // never await Supabase inside this callback (it runs under the auth lock)
      setTimeout(() => void onAuthEvent(event).catch(() => undefined), 0);
    });
    const session = await refreshAuthState({ factors: true }).catch(() => {
      useCloudSession.setState({ phase: "signedOut", ...SIGNED_OUT });
      return null;
    });
    const { error } = cleanCallbackUrl();
    if (error) pushToast({ kind: "error", title: "Anmeldung nicht möglich", detail: error.message });
    if (session) {
      lastSignedInUser = session.user.id;
      void adoptProfilePrivacy();
      if (useCloudSession.getState().needsMfa) openAuthSheet("mfa", "callback");
    }
    stopController ??= startSyncController(sb);
    onPrivacyChange((next, changed) => void pushProfilePrivacy(next, changed));
  })());
}

/* ------------------------------------------------------------------ privacy mirror (profiles.privacy) */

async function adoptProfilePrivacy(): Promise<void> {
  const uid = useCloudSession.getState().user?.id;
  if (!uid) return;
  const { data, error } = await getClient().from("profiles").select("privacy").eq("id", uid).maybeSingle();
  if (error || !data) return;
  const remote = (data as { privacy?: unknown }).privacy;
  const local = usePrivacy.getState();
  const hasRemote = remote && typeof remote === "object" && ACCOUNT_PRIVACY_KEYS.some((k) => typeof (remote as Record<string, unknown>)[k] === "boolean");
  if (hasRemote) {
    const parsed = parsePrivacy(remote, local);
    setPrivacy(Object.fromEntries(ACCOUNT_PRIVACY_KEYS.map((k) => [k, parsed[k]])), { silent: true });
  } else if (ACCOUNT_PRIVACY_KEYS.some((k) => local[k])) {
    await pushProfilePrivacy(local, [...ACCOUNT_PRIVACY_KEYS]);
  }
}

async function pushProfilePrivacy(next: PrivacyPrefs, changed: (keyof PrivacyPrefs)[]): Promise<void> {
  const uid = useCloudSession.getState().user?.id;
  if (!uid || !changed.some((k) => (ACCOUNT_PRIVACY_KEYS as readonly string[]).includes(k))) return;
  const sb = getClient();
  const { data } = await sb.from("profiles").select("privacy").eq("id", uid).maybeSingle();
  const cur = (data as { privacy?: Record<string, unknown> } | null)?.privacy ?? {};
  const privacy = { ...cur, ...Object.fromEntries(ACCOUNT_PRIVACY_KEYS.map((k) => [k, next[k]])) };
  const { error } = await sb.from("profiles").update({ privacy }).eq("id", uid);
  if (error) pushToast({ kind: "error", title: "Datenschutz-Einstellung nicht gespeichert", detail: "Sie gilt vorerst nur auf diesem Gerät." });
  else auditEvent("privacy.update", Object.fromEntries(ACCOUNT_PRIVACY_KEYS.map((k) => [k, next[k]])));
}

/* ------------------------------------------------------------------ auth actions */

export type ActionResult<T = undefined> = ({ ok: true } & (T extends undefined ? object : { value: T })) | ({ ok: false } & AuthErrorText);

function fail(e: unknown): { ok: false } & AuthErrorText {
  return { ok: false, ...authErrorText(e) };
}

/** Where e-mail links and OAuth return to: this edition's root (personal `/`, share `/teilen/`). */
export function redirectUrl(): string {
  return `${location.origin}${import.meta.env.BASE_URL || "/"}`;
}

export async function signInPassword(email: string, password: string): Promise<ActionResult<{ mfa: boolean }>> {
  try {
    const { error } = await getClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) return fail(error);
    await refreshAuthState({ factors: true });
    return { ok: true, value: { mfa: useCloudSession.getState().needsMfa } };
  } catch (e) {
    return fail(e);
  }
}

/** Register; `confirm` = the project wants the e-mail confirmed first (no session yet). */
export async function signUp(email: string, password: string): Promise<ActionResult<{ confirm: boolean }>> {
  try {
    const { data, error } = await getClient().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectUrl() } });
    if (error) return fail(error);
    // an existing, confirmed address answers with an obfuscated user without identities
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return fail({ code: "user_already_exists" });
    if (data.session) await refreshAuthState({ factors: true });
    return { ok: true, value: { confirm: !data.session } };
  } catch (e) {
    return fail(e);
  }
}

export async function sendMagicLink(email: string): Promise<ActionResult> {
  try {
    const { error } = await getClient().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectUrl(), shouldCreateUser: true } });
    return error ? fail(error) : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function signInOAuth(provider: OAuthProvider): Promise<ActionResult> {
  try {
    const { error } = await getClient().auth.signInWithOAuth({ provider, options: { redirectTo: redirectUrl() } });
    return error ? fail(error) : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function sendPasswordReset(email: string): Promise<ActionResult> {
  try {
    const { error } = await getClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectUrl() });
    return error ? fail(error) : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function resendConfirmation(email: string): Promise<ActionResult> {
  try {
    const { error } = await getClient().auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: redirectUrl() } });
    return error ? fail(error) : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** New password (after the reset link, or "Passwort ändern" while signed in). */
export async function updatePassword(password: string, reason: "reset" | "change"): Promise<ActionResult> {
  try {
    const { error } = await getClient().auth.updateUser({ password });
    if (error) return fail(error);
    auditEvent(reason === "reset" ? "auth.password.reset" : "auth.password.change");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function signOutScope(scope: "local" | "global" | "others"): Promise<ActionResult> {
  try {
    if (scope !== "local") auditEvent(scope === "others" ? "auth.sessions.revoke" : "auth.signout.all");
    else auditEvent("auth.signout");
    const { error } = await getClient().auth.signOut({ scope });
    if (error && scope !== "local") return fail(error);
    if (scope !== "others") useCloudSession.setState({ phase: "signedOut", ...SIGNED_OUT });
    return { ok: true };
  } catch (e) {
    if (scope === "local") {
      useCloudSession.setState({ phase: "signedOut", ...SIGNED_OUT });
      return { ok: true };
    }
    return fail(e);
  }
}

/* ------------------------------------------------------------------ 2FA (TOTP) */

export interface TotpEnrollment {
  factorId: string;
  /** `data:image/svg+xml…` QR of the otpauth URI. */
  qr: string;
  secret: string;
  uri: string;
}

/** Starts a TOTP enrollment (removes a half-finished one first). */
export async function enrollTotp(friendlyName = "Authenticator"): Promise<ActionResult<TotpEnrollment>> {
  try {
    const sb = getClient();
    const listed = await sb.auth.mfa.listFactors();
    for (const f of listed.data?.all ?? []) if (f.factor_type === "totp" && f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
    const name = `${friendlyName} ${new Date().toISOString().slice(0, 10)}`;
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: name });
    if (error || !data) return fail(error);
    // supabase-js prefixes the raw SVG with `data:image/svg+xml;utf-8,` unencoded – re-encode so `#` / `%` in the
    // markup cannot break the URL
    const raw = data.totp.qr_code;
    const body = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
    const qr = body.trimStart().startsWith("<") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}` : raw;
    return { ok: true, value: { factorId: data.id, qr, secret: data.totp.secret, uri: data.totp.uri } };
  } catch (e) {
    return fail(e);
  }
}

/** Verifies a code for a factor (enrollment confirm or the login step-up) → session aal2. */
export async function verifyTotp(factorId: string, code: string, reason: "enroll" | "challenge"): Promise<ActionResult> {
  try {
    const { error } = await getClient().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) return fail(error);
    await refreshAuthState({ factors: true });
    auditEvent(reason === "enroll" ? "auth.mfa.enroll" : "auth.mfa.verify");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** The step-up after a password login: verifies against the first verified factor. */
export async function verifyLoginCode(code: string): Promise<ActionResult> {
  const f = useCloudSession.getState().factors.find((x) => x.status === "verified");
  if (!f) return fail({ code: "insufficient_aal" });
  return verifyTotp(f.id, code, "challenge");
}

/** Removes 2FA (needs an aal2 session). */
export async function unenrollTotp(factorId: string): Promise<ActionResult> {
  try {
    const { error } = await getClient().auth.mfa.unenroll({ factorId });
    if (error) return fail(error);
    await getClient().auth.refreshSession().catch(() => undefined);
    await refreshAuthState({ factors: true });
    auditEvent("auth.mfa.unenroll");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** "Jetzt synchronisieren": full reconcile of the running sync (false when none runs). */
export async function syncNow(): Promise<boolean> {
  const a = activeSync();
  if (!a) return false;
  await a.engine.syncNow();
  return true;
}

/* ------------------------------------------------------------------ sessions */

export interface DeviceSession {
  id: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  userAgent: string | null;
  ip: string | null;
  aal: string | null;
  current: boolean;
}

/** The account's sessions (devices), this device first (`my_sessions()`). */
export async function listSessions(): Promise<ActionResult<DeviceSession[]>> {
  try {
    const { data, error } = await getClient().rpc("my_sessions");
    if (error) return fail(error);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    return {
      ok: true,
      value: rows.map((r) => ({
        id: String(r.id),
        createdAt: str(r.created_at),
        lastActiveAt: str(r.refreshed_at) ?? str(r.updated_at) ?? str(r.created_at),
        userAgent: str(r.user_agent),
        ip: str(r.ip),
        aal: str(r.aal),
        current: r.is_current === true,
      })),
    };
  } catch (e) {
    return fail(e);
  }
}
