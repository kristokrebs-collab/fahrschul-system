/**
 * Auth session state of the cloud (P09) – a light zustand store, no Supabase import. The lazy client chunk
 * (`client.ts`) writes it from `onAuthStateChange`; the UI reads it (`useCloudSession`, `useCloudUser`).
 *
 * Phases: `off` (no cloud in this build) · `idle` (cloud available, nothing checked yet) · `loading` (client chunk /
 * session being restored) · `signedOut` · `signedIn`. `needsMfa`: signed in with a password but the account has 2FA –
 * the session is aal1 and the database refuses the journal until the code is entered (aal2).
 */
import { create } from "zustand";
import { cloudEnabled } from "./env";
import type { AuthSheetSource, AuthView, CloudUser, MfaFactor } from "./types";

export type CloudPhase = "off" | "idle" | "loading" | "signedOut" | "signedIn";

export interface AuthSheetState {
  open: boolean;
  view: AuthView;
  source: AuthSheetSource;
  /** E-mail the views share (typed once, kept across view switches). */
  email: string;
  /** Short line under the title (e.g. after the reset link was used). */
  notice: string | null;
  /** True from the first open on: the lazy sheet stays mounted so its exit animation can run. */
  mounted: boolean;
  /** The view before the current one (slide direction of the switch). */
  prev: AuthView;
  /** What the `sent` view talks about. */
  sent: "magic" | "reset" | "confirm";
}

export interface CloudSessionState {
  phase: CloudPhase;
  user: CloudUser | null;
  needsMfa: boolean;
  factors: MfaFactor[];
  /** `email`, `google`, … of the current sign-in. */
  provider: string | null;
  emailConfirmed: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  /** `session_id` claim of the current access token (marks "this device" in the session list). */
  sessionId: string | null;
  sheet: AuthSheetState;
}

const SHEET_CLOSED: AuthSheetState = { open: false, view: "signin", source: "card", email: "", notice: null, mounted: false, prev: "signin", sent: "magic" };

export const SIGNED_OUT: Omit<CloudSessionState, "phase" | "sheet"> = {
  user: null,
  needsMfa: false,
  factors: [],
  provider: null,
  emailConfirmed: false,
  createdAt: null,
  lastSignInAt: null,
  sessionId: null,
};

export const useCloudSession = create<CloudSessionState>()(() => ({
  phase: cloudEnabled() ? "idle" : "off",
  ...SIGNED_OUT,
  sheet: SHEET_CLOSED,
}));

/** Signed-in user (null when signed out or without cloud). */
export function useCloudUserState(): CloudUser | null {
  return useCloudSession((s) => s.user);
}

/** Opens the login sheet (`view` defaults to the account panel when signed in, else the password form). */
export function openAuthSheet(view?: AuthView, source: AuthSheetSource = "card"): void {
  const s = useCloudSession.getState();
  const next: AuthView = view ?? (s.phase === "signedIn" ? (s.needsMfa ? "mfa" : "account") : "signin");
  useCloudSession.setState({ sheet: { ...s.sheet, open: true, view: next, prev: next, source, notice: null, mounted: true } });
}

export function closeAuthSheet(): void {
  const s = useCloudSession.getState();
  useCloudSession.setState({ sheet: { ...s.sheet, open: false, notice: null } });
}

/** Switches the open sheet to another view (keeps the typed e-mail). */
export function setAuthView(view: AuthView, patch: Partial<Pick<AuthSheetState, "email" | "notice" | "sent">> = {}): void {
  const s = useCloudSession.getState();
  useCloudSession.setState({ sheet: { ...s.sheet, ...patch, view, prev: s.sheet.view } });
}

/** Remembers the e-mail typed in any view. */
export function setAuthEmail(email: string): void {
  const s = useCloudSession.getState();
  if (s.sheet.email !== email) useCloudSession.setState({ sheet: { ...s.sheet, email } });
}

/** Tests: back to the initial state. */
export function resetCloudSession(): void {
  useCloudSession.setState({ phase: cloudEnabled() ? "idle" : "off", ...SIGNED_OUT, sheet: SHEET_CLOSED });
}
