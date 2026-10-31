/**
 * URL state of the billing flows (P10): the `?ref=` landing (kept 30 days in storage, sent with the checkout) and the
 * return from Stripe (`?billing=success&session_id=…`, `?billing=cancel`, `?billing=portal`). Both are removed from the
 * address bar right after reading (`history.replaceState`, the hash route stays).
 */
import { normalizeRefCode, safeReturnTo } from "./contract";
import { readJson, removeKey, storageKey, writeJson } from "@/store/storage";

export const REF_KEY = storageKey("billing-ref");
/** How long a referral stays attributed to this browser. */
export const REF_TTL_MS = 30 * 86_400_000;

export type BillingReturn = { kind: "success"; sessionId: string | null } | { kind: "cancel" } | { kind: "portal" };

/** `?billing=…` of a search string. */
export function parseReturn(search: string): BillingReturn | null {
  const p = new URLSearchParams(search);
  const kind = p.get("billing");
  if (kind === "success") {
    const sid = p.get("session_id");
    return { kind: "success", sessionId: sid && /^cs_[A-Za-z0-9_]{6,200}$/.test(sid) ? sid : null };
  }
  if (kind === "cancel") return { kind: "cancel" };
  if (kind === "portal") return { kind: "portal" };
  return null;
}

/** Removes the given query params from the address bar (keeps path + hash). */
export function stripParams(names: readonly string[]): void {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const n of names) {
      if (url.searchParams.has(n)) {
        url.searchParams.delete(n);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* no history API – the params stay, harmless */
  }
}

/** Reads and clears the Stripe return of this page load. */
export function takeReturn(): BillingReturn | null {
  if (typeof window === "undefined") return null;
  const r = parseReturn(window.location.search);
  if (r) stripParams(["billing", "session_id"]);
  return r;
}

interface StoredRef {
  code: string;
  at: number;
}

/** Reads `?ref=` of this page load into storage (and out of the address bar). Returns the code. */
export function captureReferral(now: number = Date.now()): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("ref");
  if (raw === null) return null;
  stripParams(["ref"]);
  const code = normalizeRefCode(raw);
  if (!code) return null;
  writeJson(REF_KEY, { code, at: now } satisfies StoredRef);
  return code;
}

/** The referral code attributed to this browser (null after `REF_TTL_MS`). */
export function storedReferral(now: number = Date.now()): string | null {
  const r = readJson<StoredRef | null>(REF_KEY, null);
  if (!r || typeof r.code !== "string" || typeof r.at !== "number") return null;
  if (now - r.at > REF_TTL_MS) {
    removeKey(REF_KEY);
    return null;
  }
  return normalizeRefCode(r.code);
}

export function clearReferral(): void {
  removeKey(REF_KEY);
}

/** Where Stripe should send the user back: this page (path + hash route), validated like the server does. */
export function currentReturnTo(): string {
  if (typeof window === "undefined") return "/#preise";
  const { path, hash } = safeReturnTo(`${window.location.pathname}${window.location.hash}`);
  return `${path}${hash}`;
}
