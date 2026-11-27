/**
 * Synchronous "is a cloud login about to take over?" checks (P09) – used by `bootJournal` before any cloud code is
 * loaded, and by the cloud host to decide whether the Supabase chunk must load at all. No Supabase import.
 */
import { hasClaudeRuntime } from "@/store/capability";
import { KEYS, readRaw } from "@/store/storage";
import { cloudEnabled } from "./env";
import { readPrivacy } from "./privacy";

/** The URL carries a Supabase auth callback (PKCE `?code=`, or an error / implicit token in the fragment). */
export function hasAuthCallback(href: string = typeof location === "undefined" ? "" : location.href): boolean {
  try {
    const u = new URL(href);
    if (u.searchParams.has("code") || u.searchParams.has("error_description")) return true;
    return /(^|[#&])(access_token|error_description)=/.test(u.hash);
  } catch {
    return false;
  }
}

/** A Supabase session of THIS edition is stored (`KEYS.cloudAuth`). */
export function hasStoredSession(): boolean {
  return readRaw(KEYS.cloudAuth) !== null;
}

/**
 * True when the cloud host will most likely switch to the sync adapter right after boot: cloud configured, not on
 * claude.ai, sync on for this device, and a stored session or an auth callback.
 */
export function cloudSessionHint(): boolean {
  if (!cloudEnabled() || hasClaudeRuntime()) return false;
  if (!readPrivacy().sync) return false;
  return hasStoredSession() || hasAuthCallback();
}
