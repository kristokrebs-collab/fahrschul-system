/**
 * Links of the community (P12). The router is P14's; these helpers define the hash shapes it routes:
 * - share link `<origin><base>#share/<token>` → the public `SharedView` (no login, no store) – a hash route, so it can
 *   never collide with the `/teilen/` edition path;
 * - invitation `<origin><base>#community?invite=<CODE>` → the Community page opens the join sheet.
 */

export const SHARE_ROUTE = "share/";
export const INVITE_PARAM = "invite";

const base = (): string => {
  const b = typeof import.meta !== "undefined" ? (import.meta.env?.BASE_URL ?? "/") : "/";
  return b.endsWith("/") ? b : `${b}/`;
};
const origin = (): string => (typeof location !== "undefined" ? location.origin : "");

/** Absolute share link of a token. */
export function shareUrl(token: string): string {
  return `${origin()}${base()}#${SHARE_ROUTE}${encodeURIComponent(token)}`;
}

/** Absolute invitation link of a code. */
export function inviteUrl(code: string): string {
  return `${origin()}${base()}#community?${INVITE_PARAM}=${encodeURIComponent(code)}`;
}

/** The share token of a hash (`#share/<token>`), or null. */
export function parseShareHash(hash: string): string | null {
  const m = /^#?share\/([A-Za-z0-9_-]{22})\/?$/.exec(hash.trim());
  return m ? m[1]! : null;
}

/** The invitation code of a hash (`#community?invite=CODE`) or a search string (`?invite=CODE`), or null. */
export function parseInvite(hashOrSearch: string): string | null {
  const q = hashOrSearch.includes("?") ? hashOrSearch.slice(hashOrSearch.indexOf("?") + 1) : "";
  const code = new URLSearchParams(q).get(INVITE_PARAM)?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9]{10}$/.test(code) ? code : null;
}

/** Removes the invitation from the address bar (keeps the page hash) once it was handled. */
export function clearInviteFromUrl(): void {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  const h = location.hash;
  if (!parseInvite(h)) return;
  const page = h.slice(0, h.indexOf("?"));
  history.replaceState(history.state, "", `${location.pathname}${location.search}${page}`);
}
