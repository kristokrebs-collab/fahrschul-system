/**
 * Purchase-flow rules of the server (B4): who may start a checkout, what is kept as evidence, where Stripe may send the
 * person back. ENTWURF – Prüfung durch Anwalt nötig; nothing here claims compliance.
 *
 * - `purchaseGate()`: the purchase flow is LOCKED ("nicht eingerichtet") while Stripe is not set up OR the operator's legal
 *   texts (Impressum, Datenschutz, AGB – the same rule as `legalComplete` in `src/legal/config.ts`, read from the same
 *   `VITE_LEGAL_*` names, which the operator sets for BOTH the build and the functions) are incomplete.
 * - `checkConsents()`: both boxes of the order sheet must be ticked and the browser must have shown the CURRENT wording
 *   (hash of the text it displayed = hash of the text the server knows); then `storeConsents()` writes the evidence BEFORE the
 *   Checkout Session exists (no evidence → no checkout; a missing migration 0016 fails closed).
 * - `returnUrls()`: success / cancel URLs only on the site's own origin (`SITE_ORIGIN` when set), the path from a strict
 *   whitelist grammar – never an open redirect.
 */
import { CONSENT_KINDS, CONSENT_TEXT, CONSENT_TEXT_VERSION, ORDER_ID_RE, consentHash, consentSetHash, type ConsentKind } from "../../../src/legal/consentRecord";
import { safeReturnTo, type PurchaseBlock } from "../../../src/billing/contract";
import { isMissingTable } from "./account";
import { mailConfig } from "./alertWatch/mail";
import { envOptional, type ServerEnvName } from "./env";
import { HttpError } from "./http";
import { paymentsConfigured } from "./plan";
import { supabaseAdmin } from "./supabase";

/* ------------------------------------------------------------------ the gate */

const lenv = (name: string): string => (envOptional(name as ServerEnvName) ?? "").trim();

/** `https:` URL or a same-site path – the rule of `safeLegalUrl` in `src/legal/config.ts`. */
function legalUrl(v: string): boolean {
  if (!v) return false;
  if (v.startsWith("/") && !v.startsWith("//")) return true;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** Same rule as `legalComplete(legalConfig())` of the browser: Impressum (own page or operator + address + e-mail), Datenschutz URL, AGB URL. */
export function legalReady(): boolean {
  const impressum = legalUrl(lenv("VITE_LEGAL_IMPRESSUM_URL")) || (!!lenv("VITE_LEGAL_OPERATOR") && !!lenv("VITE_LEGAL_ADDRESS").replace(/[|\n]/g, "").trim() && !!lenv("VITE_LEGAL_EMAIL"));
  return impressum && legalUrl(lenv("VITE_LEGAL_DATENSCHUTZ_URL")) && legalUrl(lenv("VITE_LEGAL_AGB_URL"));
}

export interface PurchaseGate {
  open: boolean;
  blockedBy: PurchaseBlock[];
}

export function purchaseGate(): PurchaseGate {
  const blockedBy: PurchaseBlock[] = [];
  if (!paymentsConfigured()) blockedBy.push("stripe");
  if (!legalReady()) blockedBy.push("legal");
  return { open: blockedBy.length === 0, blockedBy };
}

/** Contract e-mails (cancel / withdraw confirmations) can be sent: `RESEND_API_KEY` + a valid `ALERT_FROM`. */
export const contractMailReady = (): boolean => mailConfig() !== null;

export const LEGAL_LOCK_MESSAGE = "Die Bestellung ist noch nicht freigeschaltet: Impressum, AGB und Datenschutz des Betreibers fehlen.";

/** 503 `purchase_closed` (or `billing_unavailable` without Stripe) – never a fake purchase. */
export function assertPurchaseOpen(): void {
  const g = purchaseGate();
  if (g.open) return;
  if (g.blockedBy.includes("stripe")) throw new HttpError(503, "billing_unavailable", "Zahlungen sind noch nicht eingerichtet.");
  throw new HttpError(503, "purchase_closed", LEGAL_LOCK_MESSAGE, { blockedBy: g.blockedBy });
}

/* ------------------------------------------------------------------ consents */

export interface OrderConsents {
  terms: boolean;
  immediateStart: boolean;
}

/** The wording the server knows, hashed once per process (the texts are constants). */
let hashCache: Promise<string> | null = null;
export const serverConsentHash = (): Promise<string> => (hashCache ??= consentSetHash());

/**
 * Throws 422 `consent_required` unless BOTH boxes are ticked, 409 `consent_outdated` when the browser showed another wording
 * than the server's. Returns the hash.
 */
export async function checkConsents(consents: OrderConsents, shownHash: string): Promise<string> {
  if (consents.terms !== true || consents.immediateStart !== true) {
    throw new HttpError(422, "consent_required", "Bitte bestätige beide Kästchen vor der Bestellung.");
  }
  const mine = await serverConsentHash();
  if (shownHash !== mine) throw new HttpError(409, "consent_outdated", "Die Bestelltexte wurden aktualisiert. Bitte lade die Seite neu und bestätige noch einmal.");
  return mine;
}

export interface OrderRef {
  userId: string;
  orderId: string;
  plan: string;
  interval: string;
  seats: number;
}

/**
 * Writes the evidence of both consents (who · when · exactly what): idempotent per (user, order, kind) – a double click or a
 * retry writes nothing twice. Fail closed: without the table (migration 0016 not applied) or on any error nothing is
 * checked out. Returns the time of the consent (server clock; the first write wins on a retry).
 */
export async function storeConsents(o: OrderRef): Promise<string> {
  if (!ORDER_ID_RE.test(o.orderId)) throw new HttpError(422, "invalid_body", "Ungültige Bestellung.");
  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const rows = await Promise.all(
    CONSENT_KINDS.map(async (kind: ConsentKind) => ({
      user_id: o.userId,
      order_id: o.orderId,
      kind,
      text_hash: await consentHash(kind),
      text_version: CONSENT_TEXT_VERSION,
      consent_text: CONSENT_TEXT[kind],
      plan: o.plan,
      interval: o.interval,
      seats: o.seats,
      given_at: now,
    })),
  );
  const { error } = await sb.from("consents").upsert(rows, { onConflict: "user_id,order_id,kind", ignoreDuplicates: true });
  if (error) {
    console.error("[fn] consents write failed", error.code ?? "");
    if (isMissingTable(error)) throw new HttpError(503, "consent_unavailable", "Die Bestellung ist noch nicht eingerichtet: der Zustimmungsnachweis kann nicht gespeichert werden.");
    throw new HttpError(503, "consent_unavailable", "Die Zustimmung konnte nicht gespeichert werden. Bitte versuche es gleich noch einmal.");
  }
  const { data } = await sb.from("consents").select("given_at").eq("user_id", o.userId).eq("order_id", o.orderId).eq("kind", "immediate_start").maybeSingle();
  const at = (data as { given_at?: string } | null)?.given_at;
  return typeof at === "string" ? new Date(at).toISOString() : now;
}

/** Links the evidence to the Checkout Session that was created for it. */
export async function linkConsentSession(userId: string, orderId: string, sessionId: string): Promise<void> {
  const { error } = await supabaseAdmin().from("consents").update({ checkout_session_id: sessionId }).eq("user_id", userId).eq("order_id", orderId);
  if (error) console.error("[fn] consents link failed", error.code ?? "");
}

/* ------------------------------------------------------------------ redirects */

/**
 * `origin` accepted for redirect URLs: the configured `SITE_ORIGIN` when there is one (any other origin – a forged Host
 * header – is refused), else the request's own http(s) origin.
 */
export function assertSameOrigin(origin: string): string {
  const configured = envOptional("SITE_ORIGIN")?.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(configured) && configured !== origin) {
    throw new HttpError(500, "server_misconfigured", "Der Server ist nicht vollständig eingerichtet.");
  }
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(origin)) throw new HttpError(500, "server_misconfigured", "Der Server ist nicht vollständig eingerichtet.");
  return origin;
}

/**
 * Stripe's success and cancel URLs: `origin` + a path of the whitelist grammar (`safeReturnTo`: no `//`, no scheme, no
 * backslash, ≤ 200 chars) + `?billing=…`. The result is re-parsed: it must lie on the very same origin.
 */
export function returnUrls(origin: string, returnTo: string | undefined): { success: string; cancel: string } {
  const base = assertSameOrigin(origin);
  const { path, hash } = safeReturnTo(returnTo);
  const success = `${base}${path}?billing=success&session_id={CHECKOUT_SESSION_ID}${hash}`;
  const cancel = `${base}${path}?billing=cancel${hash}`;
  for (const u of [success, cancel]) {
    if (new URL(u.replace("{CHECKOUT_SESSION_ID}", "cs_x")).origin !== new URL(base).origin) throw new HttpError(422, "invalid_body", "Ungültige Rücksprung-Adresse.");
  }
  return { success, cancel };
}
