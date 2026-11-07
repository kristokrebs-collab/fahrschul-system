/**
 * `returnTo` (A4): back to the task you came for. A person who asks the finder for "Gruppe beitreten" and meets a login, a
 * plan wall or a missing connection does not want to start over afterwards. Before the app sends them there it notes WHAT they
 * wanted and WHICH condition has to come true first; when it does (`ReturnHost`), the original task opens – the page, the
 * card, the sheet – exactly as if they had just picked it.
 *
 *   target   a function of the register (`feature:<id>`) or a page (`page:<page>`) – nothing else (no free URL: no open redirect)
 *   wait     `signedIn` (login done) · `entitled` (the plan includes a feature) · `connected` (an exchange account is linked)
 *
 * It survives a reload (the e-mail link of a login opens the app anew): kept in `sessionStorage` for this tab only, for at
 * most `RETURN_TTL_MS`. A deep link can carry it too: `#konto?returnTo=feature:backup` (router: `Route.returnTo`) means "after
 * the login go to Backup"; the router writes it here and takes it out of the address.
 *
 * Pure state + parsing; the effect (navigate, open) is in `ReturnHost.tsx`.
 */
import { create } from "zustand";
import { parseOrderParam } from "@/billing/purchase/order";
import { storageKey } from "@/store/storage";
import { PAGES, type Page } from "@/store/uiStore";

/** `order`: the purchase order (B4) – `<plan>.<interval>.<seats>`, e.g. `pro.year.1`; after the login the order sheet opens with exactly this choice. */
export type ReturnTarget = { kind: "feature"; id: string } | { kind: "page"; page: Page } | { kind: "order"; order: string };
export type ReturnWait = { on: "signedIn" } | { on: "entitled"; feature: string } | { on: "connected" };

export interface ReturnTo {
  target: ReturnTarget;
  wait: ReturnWait;
  /** what the person wanted, in words ("Gruppen") – for the note that says where it continues */
  label: string;
  /** set time (ms) */
  at: number;
}

/** A pending return is forgotten after this long (a login mail that is answered next day should not jump anywhere). */
export const RETURN_TTL_MS = 30 * 60_000;
const KEY = storageKey("return-to");
const FEATURE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** A plan feature key (`src/billing/types.ts`: camelCase such as `boxScanner`). */
const PLAN_FEATURE = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;

/** `feature:<id>` / `page:<page>` → target; anything else (including unknown pages, free URLs, scripts) → `null`. */
export function parseReturnParam(raw: string | null | undefined): ReturnTarget | null {
  if (!raw || raw.length > 60) return null;
  const i = raw.indexOf(":");
  if (i < 0) return null;
  const kind = raw.slice(0, i);
  const rest = raw.slice(i + 1);
  if (kind === "feature" && FEATURE_ID.test(rest)) return { kind: "feature", id: rest };
  if (kind === "page" && (PAGES as readonly string[]).includes(rest)) return { kind: "page", page: rest as Page };
  if (kind === "order" && parseOrderParam(rest)) return { kind: "order", order: rest };
  return null;
}

export const formatReturnParam = (t: ReturnTarget): string => (t.kind === "feature" ? `feature:${t.id}` : t.kind === "order" ? `order:${t.order}` : `page:${t.page}`);

/** The hash of a login / plan page that brings the person back to `target` afterwards. */
export const returnHash = (page: Page, target: ReturnTarget): string => `#${page}?returnTo=${formatReturnParam(target)}`;

function sanitize(v: unknown, now: number): ReturnTo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<ReturnTo> & { target?: unknown };
  const target = o.target && typeof o.target === "object" ? parseReturnParam(formatReturnLike(o.target as Record<string, unknown>)) : null;
  const w = o.wait as { on?: unknown; feature?: unknown } | undefined;
  const on = w?.on;
  let wait: ReturnWait | null = null;
  if (on === "signedIn" || on === "connected") wait = { on };
  else if (on === "entitled" && typeof w?.feature === "string" && PLAN_FEATURE.test(w.feature)) wait = { on: "entitled", feature: w.feature };
  const at = typeof o.at === "number" ? o.at : 0;
  if (!target || !wait || now - at > RETURN_TTL_MS || at > now + 60_000) return null;
  return { target, wait, label: typeof o.label === "string" ? o.label.slice(0, 80) : "", at };
}

function formatReturnLike(t: Record<string, unknown>): string {
  return t.kind === "feature" ? `feature:${String(t.id)}` : t.kind === "page" ? `page:${String(t.page)}` : t.kind === "order" ? `order:${String(t.order)}` : "";
}

function read(): ReturnTo | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw), Date.now()) : null;
  } catch {
    return null;
  }
}

function write(v: ReturnTo | null): void {
  try {
    if (v) sessionStorage.setItem(KEY, JSON.stringify(v));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode: the return then lives in memory only (it is lost with a reload) */
  }
}

export const useReturnTo = create<{ pending: ReturnTo | null }>(() => ({ pending: read() }));

/** Notes what the person wanted and what has to happen first (replaces an earlier note). */
export function setReturnTo(target: ReturnTarget, wait: ReturnWait, label = ""): void {
  const pending: ReturnTo = { target, wait, label, at: Date.now() };
  write(pending);
  useReturnTo.setState({ pending });
}

export function clearReturnTo(): void {
  write(null);
  if (useReturnTo.getState().pending) useReturnTo.setState({ pending: null });
}

/** The pending return while it is still fresh (an expired one is dropped on the way). */
export function peekReturnTo(now = Date.now()): ReturnTo | null {
  const p = useReturnTo.getState().pending;
  if (!p) return null;
  if (now - p.at > RETURN_TTL_MS) {
    clearReturnTo();
    return null;
  }
  return p;
}
