/**
 * Cloud contract (Wave 0 – owner P09). Signatures are final; P09 filled in the stubs.
 *
 * Rules for every package:
 * - Local-first stays the default. Hide every cloud / billing / exchange / community surface when
 *   `!isCloudAvailable()` (file builds, missing env).
 * - This module must stay light: it never imports `@supabase/supabase-js` statically – the client is a lazy chunk
 *   (`client.ts`, loaded by `ensureCloud()` / the host) and only when a session exists or the user starts to sign in.
 * - Server calls go through `apiFetch("/billing/checkout", …)` → same-origin `/api/v1/billing/checkout` with the
 *   user's bearer token; errors arrive as `ApiError` (`status`, `code`, German `message`).
 */
import { useCloudSession } from "./session";
import type { CloudUser } from "./types";

export { cloudConfig, isCloudAvailable, cloudEnabled, oauthProviders, type CloudConfig, type CloudEnv, type OAuthProvider } from "./env";
export type { Aal, CloudUser, MfaFactor, AuthView, AuthSheetSource } from "./types";
export { setAccessTokenProvider, getAccessToken, API_BASE, ApiError, apiFetch, FUNCTIONS_MISSING, type ApiErrorBody, type ApiFetchInit } from "./api";
export { reportError, installErrorReporting, buildReport, type ErrorContext, type ErrorReport } from "./report";
export { useCloudSession, openAuthSheet, closeAuthSheet, setAuthView, type CloudPhase, type CloudSessionState } from "./session";
export { usePrivacy, setPrivacy, readPrivacy, useLeaderboardOptIn, type PrivacyPrefs } from "./privacy";
export { useSyncStatus, type SyncPhase, type SyncStatus } from "./sync/status";
export { cloudSessionHint, hasStoredSession } from "./hint";
export { ensureCloud, signOut } from "./runtime";

/** Signed-in user, or `null` (signed out, or cloud unavailable). */
export function useCloudUser(): CloudUser | null {
  return useCloudSession((s) => s.user);
}
