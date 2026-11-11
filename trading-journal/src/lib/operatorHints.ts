/**
 * Setup hints for the OPERATOR (which environment variable is missing, which migration to run) are not for visitors (Launch-Audit D1,
 * B10: the account page of a build without the cloud told every visitor „Für Betreiber: VITE_SUPABASE_URL …“). They show in the dev
 * server and when the address asks for them: `?debug` in the search or in the hash query (`/?debug`, `#konto?debug`), any value.
 */
export function wantsOperatorHints(href: string): boolean {
  try {
    const u = new URL(href);
    if (u.searchParams.has("debug")) return true;
    const q = u.hash.indexOf("?");
    return q >= 0 && new URLSearchParams(u.hash.slice(q + 1)).has("debug");
  } catch {
    return false;
  }
}

export function operatorHints(): boolean {
  if (import.meta.env.DEV) return true;
  return typeof location !== "undefined" && wantsOperatorHints(location.href);
}
