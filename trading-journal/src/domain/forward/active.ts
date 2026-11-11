/**
 * Does `settings.forward` hold an account that still needs the app's attention (running, paused, or ended but not yet wound
 * up)? A dependency-free check: the host that decides whether to load the forward test's chunk uses it, so it must not pull
 * the domain in.
 */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function hasActiveForward(raw: unknown): boolean {
  if (!isObj(raw) || !Array.isArray(raw.accounts)) return false;
  return raw.accounts.some((a) => isObj(a) && (a.status === "running" || a.status === "paused" || (a.status === "ended" && isObj(a.cursor) && a.cursor.done !== true)));
}
