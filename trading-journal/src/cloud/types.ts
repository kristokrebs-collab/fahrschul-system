/** Shared cloud types (no runtime code). */

export type Aal = "aal1" | "aal2";

export interface CloudUser {
  id: string;
  email: string | null;
  /** Assurance level of the current session (aal2 after a TOTP challenge). */
  aal: Aal;
  /** At least one verified MFA factor exists. */
  mfaEnrolled: boolean;
}

export interface MfaFactor {
  id: string;
  friendlyName: string | null;
  status: "verified" | "unverified";
  createdAt: string | null;
}

/** What the login sheet shows. */
export type AuthView =
  | "signin" // e-mail + password
  | "magic" // magic link
  | "signup" // register
  | "reset" // send a reset link
  | "sent" // "check your inbox" (magic link / reset / confirmation)
  | "mfa" // TOTP challenge after the password (aal1 → aal2)
  | "newPassword" // after the reset link (PASSWORD_RECOVERY)
  | "account" // signed in: who, sync, sign out
  | "welcome"; // success: wordmark + first sync

/** Where the sheet morphed from (the header pill owns a `layoutId`, other entries slide in). */
export type AuthSheetSource = "pill" | "card" | "banner" | "callback";
