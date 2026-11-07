/**
 * Verifies the caller's Supabase JWT (Wave-0 contract, owner P09). The client sends `Authorization: Bearer <access
 * token>` (`apiFetch` does it). Verification uses `auth.getClaims(jwt)` – local JWKS check with asymmetric signing
 * keys, otherwise a round trip to the Auth server.
 */
import { HttpError } from "./http";
import { supabaseAdmin } from "./supabase";

export type Aal = "aal1" | "aal2";

export interface AuthUser {
  id: string;
  email: string | null;
  aal: Aal;
  sessionId: string | null;
  /** The verified access token (for user-scoped Supabase calls). */
  jwt: string;
}

export interface RequireUserOptions {
  /**
   * `true`: the session must be aal2 (TOTP verified). `"ifEnrolled"`: aal2 only when the user has a verified factor
   * (account deletion, exchange keys). Default: aal1 is enough.
   */
  aal2?: boolean | "ifEnrolled";
}

/** Token of an `Authorization: Bearer …` header, or null. */
export function bearerToken(req: Request): string | null {
  const m = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1]! : null;
}

/** Verified user of the request. Throws 401 `unauthenticated` / `invalid_token`, 403 `mfa_required`. */
export async function requireUser(req: Request, opts: RequireUserOptions = {}): Promise<AuthUser> {
  const jwt = bearerToken(req);
  if (!jwt) throw new HttpError(401, "unauthenticated");
  const sb = supabaseAdmin();
  const { data, error } = await sb.auth.getClaims(jwt);
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string" || !claims.sub || claims.role !== "authenticated") {
    throw new HttpError(401, "invalid_token", "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.");
  }
  const user: AuthUser = {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    aal: claims.aal === "aal2" ? "aal2" : "aal1",
    sessionId: typeof claims.session_id === "string" ? claims.session_id : null,
    jwt,
  };
  if (opts.aal2) await assertAal2(user, opts.aal2);
  return user;
}

/** The German 403 of a session that still needs the TOTP step. */
export const MFA_REQUIRED_MESSAGE = "Bitte bestätige zuerst mit deinem Authenticator-Code.";

/**
 * Throws 403 `mfa_required` unless the session satisfies the aal2 rule – `true`: always aal2, `"ifEnrolled"`: aal2 as
 * soon as the user has a verified factor (the database rule `public.mfa_satisfied()`, 0001 / 0005).
 */
export async function assertAal2(user: AuthUser, mode: true | "ifEnrolled" = "ifEnrolled"): Promise<void> {
  if (user.aal === "aal2") return;
  const required = mode === true || (await hasVerifiedFactor(user.id));
  if (required) throw new HttpError(403, "mfa_required", MFA_REQUIRED_MESSAGE);
}

/** `true` when the session may see account data: aal2, or the user has no verified factor (fails closed). */
export async function mfaSatisfied(user: AuthUser): Promise<boolean> {
  return user.aal === "aal2" || !(await hasVerifiedFactor(user.id));
}

/** Like `requireUser`, but `null` when no Authorization header is sent (public endpoints with optional login). */
export async function optionalUser(req: Request, opts: RequireUserOptions = {}): Promise<AuthUser | null> {
  return req.headers.has("authorization") ? requireUser(req, opts) : null;
}

async function hasVerifiedFactor(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().auth.admin.mfa.listFactors({ userId });
  // Fail closed: if the factors cannot be read, demand aal2.
  if (error || !data) return true;
  return data.factors.some((f) => f.status === "verified");
}
